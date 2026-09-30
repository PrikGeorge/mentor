'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {isDeepStrictEqual}=require('node:util');
const {createCatalog,validateSourceFiles}=require('./training-catalog.cjs');
const {dependencyPaths}=require('./training-dependencies.cjs');
const {boundedProcess}=require('./training-process.cjs');

const TRUSTED_SOURCE=path.join(__dirname,'../training/runner/TrustedHarness.java');
const CACHE_DIR=path.join(__dirname,'../.runtime/training-cache');
const JAVA_FLAGS=['-Xmx128m','-Xss512k','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-Djava.security.manager'];
const COMPILE_FLAGS=['-J-Xmx256m','-J-XX:ActiveProcessorCount=2','-J-Dfile.encoding=UTF-8','-encoding','UTF-8','--release','21'];
const CONTAINER_FLAGS=['--network','none','--user','10001:10001','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/work:rw,nosuid,nodev,noexec,size=96m,mode=1777','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777'];
const emptyResult=(status,diagnostics)=>({status,passed:0,total:0,elapsedMs:0,diagnostics,tests:[]});
const okay=result=>result.code===0 && !result.reason;

function createJavaRunner({catalog=createCatalog(),cacheDir=CACHE_DIR,mode=process.env.MENTOR_JAVA_MODE||'auto',runTimeoutMs=3000,maxQueue=4}={}) {
  if(!['auto','local','docker','disabled'].includes(mode)) throw new Error('Неизвестный режим Java runner.');
  // All limits are host configuration; none are accepted from student requests.
  runTimeoutMs=Math.min(5000,Math.max(200,Number(runTimeoutMs)||3000));
  maxQueue=Math.min(8,Math.max(1,Number(maxQueue)||4));
  cacheDir=path.resolve(cacheDir);
  let closed=false, pending=0, chain=Promise.resolve(), statusPromise, localHarnessPromise;
  const abort=new AbortController();
  let localHarnessRoot;
  const execute=(command,args,options={})=>boundedProcess(command,args,{...options,signal:abort.signal});

  async function detect() {
    if(closed || mode==='disabled') return {available:false,mode:'disabled',message:'Проверка Java отключена.'};
    let dockerReason='Docker недоступен.';
    if(mode==='docker'||mode==='auto') {
      const info=await execute('docker',['info','--format','{{.OSType}}'],{timeoutMs:4000});
      if(okay(info) && info.stdout.trim()==='linux') {
        const image=catalog.environment(catalog.environments()[0].id).dockerImage;
        // The actual no-pull probe also handles Docker Desktop's transient inspect-by-tag failures.
        const version=await execute('docker',['run','--rm','--pull','never',...CONTAINER_FLAGS,image,'java','-version'],{timeoutMs:10000});
        if(okay(version) && /version "21\./.test(version.stdout+version.stderr)) return {available:true,mode:'docker',message:'Java 21 в Docker: сеть отключена, запуск ограничен по памяти, CPU, процессам, времени и выводу.'};
        dockerReason=`Образ Java 21 не подготовлен или не запускается. Выполните docker pull ${image} и проверьте Docker.`;
      }
      if(mode==='docker') return {available:false,mode:'docker',message:dockerReason};
    }
    if(process.env.NODE_ENV==='production') return {available:false,mode:'local',message:'Локальный Java runner запрещён в production. Настройте Docker.'};
    const [java,javac]=await Promise.all([execute('java',['-version'],{timeoutMs:4000}),execute('javac',['-version'],{timeoutMs:4000})]);
    if(!okay(java)||!okay(javac)||!/version "21\./.test(java.stdout+java.stderr)||!/javac 21\./.test(javac.stdout+javac.stderr)) return {available:false,mode:'local',message:'Нужен JDK 21: java и javac в PATH. '+(mode==='auto'?dockerReason:'')};
    return {available:true,mode:'local',message:'Java 21: локальный режим разработки с Java policy и ограничениями времени, памяти и вывода; это не системная изоляция.'+(mode==='auto'?' '+dockerReason:'')};
  }
  async function status() {
    if(closed) return {available:false,mode:'disabled',message:'Проверка Java остановлена.'};
    if(!statusPromise) statusPromise=detect().catch(()=>({available:false,mode,message:'Не удалось определить доступность окружения Java.'}));
    return {...await statusPromise};
  }
  async function localHarness() {
    if(!localHarnessPromise) localHarnessPromise=(async()=>{
      localHarnessRoot=await fs.mkdtemp(path.join(os.tmpdir(),'mentor-trusted-java-'));
      const compiled=await execute('javac',[...COMPILE_FLAGS,'-proc:none','-d',localHarnessRoot,TRUSTED_SOURCE],{cwd:localHarnessRoot,timeoutMs:15000});
      if(!okay(compiled)) throw new Error('Не удалось подготовить доверенную проверку. Преподавателю: проверьте JDK 21 и training/runner/TrustedHarness.java.');
      return localHarnessRoot;
    })();
    return localHarnessPromise;
  }
  function sanitizeDiagnostics(text,jobRoot) {
    return text.replaceAll(jobRoot+path.sep,'').replaceAll(jobRoot,'').replaceAll('/input/src/','').replaceAll(path.join(jobRoot,'src')+path.sep,'').slice(0,16000);
  }
  async function perform(provided,files,attemptMode) {
    const started=Date.now(); let jobRoot,containerName;
    const result=emptyResult('error');
    try {
      if(!['run','submit'].includes(attemptMode)) throw new Error('Режим проверки должен быть run или submit.');
      // Reload by ID so a browser-controlled object cannot replace private tests or environment.
      const exercise=catalog.get(provided?.id);
      if(!exercise || exercise.revision!==provided.revision) throw new Error('Упражнение изменилось или отсутствует. Обновите страницу.');
      validateSourceFiles(exercise,files);
      const cases=exercise.tests.filter(item=>attemptMode==='submit'||item.sample);
      result.total=cases.length;
      if(!cases.length) throw new Error('Для упражнения не определены проверки.');
      const state=await status();
      if(!state.available) return {...result,status:'unavailable',diagnostics:state.message,elapsedMs:Date.now()-started};
      const environment=catalog.environment(exercise.environmentId);
      let dependencies;
      try { dependencies=dependencyPaths(environment,cacheDir); } catch(error) { return {...result,status:'unavailable',diagnostics:error.message,elapsedMs:Date.now()-started}; }
      // Annotation processors execute inside javac; allow them only inside the container boundary.
      if(state.mode==='local' && environment.annotationProcessors.length) return {...result,status:'unavailable',diagnostics:'Профиль с annotation processors требует Docker.',elapsedMs:Date.now()-started};
      jobRoot=await fs.mkdtemp(path.join(os.tmpdir(),'mentor-java-job-'));
      await fs.chmod(jobRoot,0o755);
      await fs.mkdir(path.join(jobRoot,'src'),{recursive:true});
      await fs.mkdir(path.join(jobRoot,'classes'));
      await fs.mkdir(path.join(jobRoot,'deps'));
      for(const [name,source] of Object.entries(files)) { const target=path.join(jobRoot,'src',name); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,source); }
      const jars=[];
      for(let index=0;index<dependencies.length;index++) { const name=`dependency-${index}.jar`; await fs.copyFile(dependencies[index],path.join(jobRoot,'deps',name)); jars.push(name); }
      let compile,runCase;
      if(state.mode==='docker') {
        containerName=`mentor-java-${crypto.randomBytes(12).toString('hex')}`;
        await fs.copyFile(TRUSTED_SOURCE,path.join(jobRoot,'TrustedHarness.java'));
        await fs.writeFile(path.join(jobRoot,'runner.policy'),'grant codeBase "file:/work/trusted/-" { permission java.security.AllPermission; };\n');
        const startedContainer=await execute('docker',['run','-d','--rm','--pull','never','--name',containerName,...CONTAINER_FLAGS,'--mount',`type=bind,source=${jobRoot},target=/input,readonly`,environment.dockerImage,'sleep','90'],{timeoutMs:10000});
        if(!okay(startedContainer)) return {...result,status:'unavailable',diagnostics:'Не удалось запустить контейнер проверки. Проверьте Docker и подготовленный образ JDK 21.',elapsedMs:Date.now()-started};
        const dockerExec=(args,options)=>execute('docker',['exec','-i',containerName,...args],options);
        const checker=await dockerExec(['javac',...COMPILE_FLAGS,'-proc:none','-d','/work/trusted','/input/TrustedHarness.java'],{timeoutMs:15000});
        if(!okay(checker)) return {...result,status:'unavailable',diagnostics:'Не удалось подготовить доверенную проверку в Docker. Требуется проверка конфигурации преподавателем.',elapsedMs:Date.now()-started};
        const classpath=jars.map(name=>`/input/deps/${name}`).join(':')||'/work/classes';
        const processors=environment.annotationProcessors.length?['-processorpath',classpath,'-processor',environment.annotationProcessors.join(',')]:['-proc:none'];
        compile=await dockerExec(['javac',...COMPILE_FLAGS,...processors,'-classpath',classpath,'-d','/work/classes',...Object.keys(files).map(name=>`/input/src/${name}`)],{timeoutMs:15000});
        runCase=(spec,timeoutMs)=>dockerExec(['java',...JAVA_FLAGS,'-Djava.security.policy==/input/runner.policy','-cp','/work/trusted','mentor.runner.TrustedHarness'],{timeoutMs,input:JSON.stringify({...spec,classPaths:['/work/classes',...jars.map(name=>`/input/deps/${name}`)]})});
      } else {
        let trusted;
        try { trusted=await localHarness(); } catch(error) { return {...result,status:'unavailable',diagnostics:error.message,elapsedMs:Date.now()-started}; }
        const policy=path.join(jobRoot,'runner.policy');
        await fs.writeFile(policy,`grant codeBase "${pathToFileURL(trusted).href}/-" { permission java.security.AllPermission; };\n`);
        const classpath=jars.map(name=>path.join(jobRoot,'deps',name)).join(path.delimiter)||path.join(jobRoot,'classes');
        compile=await execute('javac',[...COMPILE_FLAGS,'-proc:none','-classpath',classpath,'-d',path.join(jobRoot,'classes'),...Object.keys(files).map(name=>path.join(jobRoot,'src',name))],{cwd:jobRoot,timeoutMs:15000});
        runCase=(spec,timeoutMs)=>execute('java',[...JAVA_FLAGS,`-Djava.security.policy==${policy}`,'-cp',trusted,'mentor.runner.TrustedHarness'],{cwd:jobRoot,timeoutMs,input:JSON.stringify({...spec,classPaths:[path.join(jobRoot,'classes'),...jars.map(name=>path.join(jobRoot,'deps',name))]})});
      }
      if(!okay(compile)) {
        result.status='compile_error';
        result.diagnostics=compile.reason==='timeout'?'Компиляция превысила 15 секунд.':compile.reason==='output_limit'?'Диагностика компилятора превысила допустимый объём.':sanitizeDiagnostics(compile.stderr||compile.stdout||'Компиляция прервана.',jobRoot);
      } else {
        result.status='accepted';
        for(const item of cases) {
          const testResult={name:item.name,status:'runtime_error',expected:item.expected};
          const remaining=45000-(Date.now()-started);
          if(remaining<=0) {testResult.status='time_limit';testResult.message='Превышено время всей проверки.';result.tests.push(testResult);result.status='time_limit';break;}
          const nonce=crypto.randomBytes(16).toString('hex');
          const spec={className:exercise.className,method:exercise.method,parameterTypes:exercise.parameterTypes,customTypes:exercise.customTypes||{},args:item.args,nonce};
          const execution=await runCase(spec,Math.min(runTimeoutMs,remaining));
          if(execution.reason==='timeout') {testResult.status='time_limit';testResult.message='Превышено время выполнения теста.';}
          else if(execution.reason==='output_limit') testResult.message='Превышен допустимый объём вывода.';
          else if(!okay(execution)) testResult.message='Проверяющий процесс завершился без результата.';
          else {
            try {
              const checked=JSON.parse(execution.stdout);
              if(checked.nonce!==nonce) throw new Error('Неверный ответ проверяющего процесса.');
              if(typeof checked.stdout==='string') testResult.stdout=checked.stdout.slice(0,16384);
              if(checked.status==='runtime_error') testResult.message=sanitizeDiagnostics(String(checked.message||'Ошибка выполнения.'),jobRoot);
              else {
                if(checked.completed!==true || !Object.hasOwn(checked,'actual') || !Array.isArray(checked.before) || !Array.isArray(checked.after)) throw new Error('Проверка не завершена.');
                testResult.actual=checked.actual;
                const mutation=(item.unchangedArguments||[]).some(index=>!isDeepStrictEqual(checked.before[index],checked.after[index]));
                testResult.status=!mutation && isDeepStrictEqual(checked.actual,item.expected)?'accepted':'wrong_answer';
                if(mutation) testResult.message='Решение изменило входные данные, которые должны оставаться неизменными.';
              }
            } catch {testResult.message='Проверяющий процесс не вернул корректный завершённый результат.';}
          }
          result.tests.push(testResult);
          if(testResult.status==='accepted') result.passed++;
          else if(result.status==='accepted'||['runtime_error','time_limit'].includes(testResult.status)) result.status=testResult.status;
          if(['runtime_error','time_limit'].includes(testResult.status)) break;
        }
        if(result.status==='accepted' && result.passed!==result.total) {result.status='error';result.diagnostics='Не все проверки завершены.';}
      }
    } catch(error) {result.status='error';result.diagnostics=error.message;}
    finally {
      if(containerName) await boundedProcess('docker',['rm','-f',containerName],{timeoutMs:5000,outputLimit:4096});
      if(jobRoot) await fs.rm(jobRoot,{recursive:true,force:true,maxRetries:3,retryDelay:100});
      result.elapsedMs=Date.now()-started;
    }
    return result;
  }
  async function run(exercise,files,attemptMode='submit') {
    if(closed) return emptyResult('unavailable','Проверка Java остановлена.');
    if(pending>=maxQueue) return emptyResult('unavailable','Очередь проверки заполнена. Повторите попытку позже.');
    // Snapshot source immediately: changing a draft while queued never changes an attempt.
    let snapshot;
    try { snapshot=structuredClone(files); } catch {return emptyResult('error','Некорректный код решения.');}
    const identity={id:exercise?.id,revision:exercise?.revision};
    pending++;
    const task=chain.then(()=>closed?emptyResult('unavailable','Проверка Java остановлена.'):perform(identity,snapshot,attemptMode));
    chain=task.catch(()=>{});
    try {return await task;} finally {pending--;}
  }
  async function close() {
    closed=true; abort.abort(); await chain;
    if(localHarnessRoot) await fs.rm(localHarnessRoot,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
  return {status,run,close};
}
module.exports={createJavaRunner};
