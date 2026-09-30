'use strict';
const path = require('node:path');
const { createAuthService } = require('../lib/auth-service.cjs');
function cliError(message) { return Object.assign(new Error(message), { cliMessage: message }); }
function safeMessage(failure) {
  if(failure.cliMessage)return failure.cliMessage;
  const validation = new Set(['Пароль должен содержать 8–128 символов и не больше 512 байт UTF-8.','Укажите логин.','Логин: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.']);
  if(failure.code==='INVALID_INPUT'&&validation.has(failure.message))return failure.message;
  if(failure.code==='ACCOUNT_EXISTS')return 'Преподаватель уже создан. Для смены пароля используйте reset-teacher.';
  if(failure.code==='LOGIN_EXISTS')return 'Этот логин уже занят.';
  if(failure.code==='NOT_FOUND')return 'Преподаватель с таким логином не найден.';
  if(failure.code==='AUTH_BUSY')return 'Слишком много проверок пароля. Попробуйте позже.';
  if(failure.code==='AUTH_UNAVAILABLE')return failure.status===503?'Хранилище авторизации занято. Остановите сервер и повторите команду.':'Не удалось открыть или сохранить авторизацию. Проверьте хранилище и его резервную копию.';
  return 'Не удалось выполнить команду. Проверьте параметры, ввод и убедитесь, что сервер остановлен.';
}
function parseArguments(argv) {
  const [command,...rest]=argv;
  if(!['setup','reset-teacher'].includes(command)||!(rest.length===0||(rest.length===2&&rest[0]==='--data-dir'&&rest[1])))throw cliError('Использование: node scripts/auth-admin.cjs setup|reset-teacher [--data-dir <каталог>]. Логин и пароль вводятся только с терминала.');
  return {command,dataDir:rest.length?path.resolve(rest[1]):path.join(__dirname,'..','data')};
}
function prompt(label,hidden=false) {
  const input=process.stdin,output=process.stdout;
  output.write(label);
  return new Promise((resolve,reject)=>{
    let value='';
    const previous=input.isRaw;
    input.setRawMode(true);input.resume();input.setEncoding('utf8');
    function cleanup(){input.removeListener('data',onData);input.removeListener('error',onError);input.setRawMode(Boolean(previous));input.pause();output.write('\n');}
    function onError(){cleanup();reject(cliError('Не удалось прочитать ввод терминала.'));}
    function onData(chunk){
      for(const c of chunk){
        if(c==='\u0003'){cleanup();reject(cliError('Команда отменена.'));return;}
        if(c==='\r'||c==='\n'){cleanup();resolve(value);return;}
        if(c==='\u007f'||c==='\b'){if(value){value=value.slice(0,-1);if(!hidden)output.write('\b \b');}continue;}
        if(c<' '||c==='\u001b')continue;
        if(value.length>=1024){cleanup();reject(cliError('Ввод слишком длинный.'));return;}
        value+=c;if(!hidden)output.write(c);
      }
    }
    input.on('data',onData);input.on('error',onError);
  });
}
async function main(argv=process.argv.slice(2)) {
  const {command,dataDir}=parseArguments(argv);
  if(!process.stdin.isTTY||!process.stdout.isTTY||typeof process.stdin.setRawMode!=='function')throw cliError('Команда требует интерактивный TTY. Пароль нельзя передавать через argv, переменные окружения или pipe.');
  // Holding the auth store lock before prompting also excludes a running server.
  const auth=createAuthService({dataDir,getStudent:()=>null});
  try {
    const login=await prompt('Логин преподавателя: ');
    const password=await prompt(command==='setup'?'Пароль (8–128 символов): ':'Новый пароль (8–128 символов): ',true);
    const confirmation=await prompt('Повторите пароль: ',true);
    if(password!==confirmation)throw cliError('Пароли не совпадают.');
    if(command==='setup')await auth.setupTeacher({login,password});
    else await auth.resetTeacherPassword({login,newPassword:password});
    console.log(command==='setup'?'Преподаватель создан. Теперь запустите сервер и войдите.':'Пароль преподавателя обновлён. Все его сессии отозваны.');
  }finally{auth.close();}
}
if(require.main===module)main().catch(failure=>{console.error(safeMessage(failure));process.exitCode=1;});
module.exports={main};
