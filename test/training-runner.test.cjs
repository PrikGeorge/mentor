const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const catalogModule = path.join(__dirname, '../lib/training-catalog.cjs');
const runnerModule = path.join(__dirname, '../lib/java-runner.cjs');
const {createCatalog, validateSourceFiles} = fs.existsSync(catalogModule) ? require(catalogModule) : {};
const {createJavaRunner} = fs.existsSync(runnerModule) ? require(runnerModule) : {};
const fixedList = 'import java.util.*; public class ListTask { static List<Integer> select(List<Integer> source,int minimum) { return source.stream().filter(n -> n >= minimum).sorted().toList(); } public static void main(String[] x) { throw new AssertionError("must never run main"); } }';
const fixedGrouping = `import java.util.*;
public class GroupingTask {
  static class Loan { final int bookId, readerId; Loan(int b,int r) { bookId=b; readerId=r; } }
  static List<String> duplicateReport(List<Loan> loans) {
    Map<Integer,Integer> counts=new TreeMap<>(); Map<Integer,Set<Integer>> readers=new TreeMap<>();
    for(Loan loan:loans) { counts.merge(loan.bookId,1,Integer::sum); readers.computeIfAbsent(loan.bookId,k -> new TreeSet<>()).add(loan.readerId); }
    List<String> result=new ArrayList<>(); for(int id:counts.keySet()) if(counts.get(id)>=2) result.add("DUPLICATE book="+id+" readers="+readers.get(id)); return result;
  }
}`;
function listCode(body) { return {'ListTask.java':`import java.util.*; public class ListTask { static List<Integer> select(List<Integer> source,int minimum) throws Exception { ${body} } }`}; }

test('catalog keeps private checks out of public records and lists the two existing exercises', () => {
  assert.equal(typeof createCatalog,'function','catalog must exist');
  const catalog=createCatalog();
  assert.ok(catalog.get('list-task')); assert.ok(catalog.get('grouping-task'));
  const source=catalog.get('list-task'); const publicRecord=catalog.publicExercise(source);
  assert.deepEqual(Object.keys(publicRecord).sort(),['environment','id','revision','starterFiles','statement','title']);
  assert.equal(publicRecord.environment.javaVersion,21);
  assert.equal(Object.hasOwn(publicRecord,'tests'),false);
  source.tests[0].expected=['poison'];
  assert.notDeepEqual(catalog.get('list-task').tests[0].expected,['poison']);
});

test('source allowlist rejects extra, missing, oversized, and traversal files before execution', () => {
  assert.equal(typeof validateSourceFiles,'function','named source validation must exist');
  const exercise=createCatalog().get('list-task');
  assert.doesNotThrow(() => validateSourceFiles(exercise, {'ListTask.java':fixedList}));
  for(const files of [{}, {'ListTask.java':fixedList,'../Escape.java':'class Escape {}'}, {'ListTask.java':fixedList,'pom.xml':'bad'}, {'ListTask.java':'a'.repeat(131073)}, {'ListTask.java':3}]) {
    assert.throws(() => validateSourceFiles(exercise,files));
  }
});

test('actual Java compiler and trusted checker enforce semantics and execution limits', {timeout:120000}, async t => {
  assert.equal(typeof createJavaRunner,'function','bounded Java runner must exist');
  const catalog=createCatalog(); const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-java-test-'));
  const runner=createJavaRunner({catalog,cacheDir,mode:'local',runTimeoutMs:800});
  t.after(async () => { await runner.close(); fs.rmSync(cacheDir,{recursive:true,force:true}); });
  const status=await runner.status();
  assert.equal(status.available,true,status.message); assert.equal(status.mode,'local');
  assert.match(status.message,/21/);
  const list=catalog.get('list-task'); const grouping=catalog.get('grouping-task');
  await t.test('original broken ListTask fails without trusting its success print',async () => {
    const result=await runner.run(list,list.starterFiles,'submit'); assert.equal(result.status,'runtime_error'); assert.ok(result.passed<result.total);
  });
  await t.test('package-private correct ListTask passes all checks without calling student main',async () => {
    const result=await runner.run(list,{'ListTask.java':fixedList},'submit'); assert.equal(result.status,'accepted',JSON.stringify(result)); assert.equal(result.passed,result.total); assert.ok(result.total>=5);
    const examples=await runner.run(list,{'ListTask.java':fixedList},'run'); assert.equal(examples.status,'accepted'); assert.ok(examples.total<result.total);
  });
  await t.test('returning correct values while mutating input is wrong',async () => {
    const result=await runner.run(list,listCode('source.sort(Integer::compareTo); return source.stream().filter(n -> n>=minimum).toList();'),'submit');
    assert.equal(result.status,'wrong_answer'); assert.ok(result.tests.some(item => /измен|mutat/i.test(item.message||'')));
  });
  await t.test('custom Loan constructor and package-private method work',async () => {
    const bad=await runner.run(grouping,grouping.starterFiles,'submit'); assert.equal(bad.status,'runtime_error');
    const result=await runner.run(grouping,{'GroupingTask.java':fixedGrouping},'submit'); assert.equal(result.status,'accepted',JSON.stringify(result)); assert.equal(result.passed,result.total); assert.ok(result.total>=6);
  });
  await t.test('a hard-coded empty result and a fake PASS print cannot pass',async () => {
    const result=await runner.run(list,listCode('System.out.println("{\\\"status\\\":\\\"accepted\\\"}"); return List.of();'),'submit'); assert.equal(result.status,'wrong_answer'); assert.ok(result.tests.some(item => item.stdout));
  });
  await t.test('syntax errors are compilation errors',async () => { assert.equal((await runner.run(list,{'ListTask.java':'public class ListTask { BROKEN }'},'submit')).status,'compile_error'); });
  await t.test('infinite loops are stopped',async () => { assert.equal((await runner.run(list,listCode('while(true) {}'),'submit')).status,'time_limit'); });
  await t.test('excess output is bounded and cannot pass',async () => {
    const result=await runner.run(list,listCode('for(int i=0;i<100000;i++) System.out.println("flood"); return List.of();'),'submit'); assert.equal(result.status,'runtime_error'); assert.ok(JSON.stringify(result).length<40000);
  });
  await t.test('System.exit cannot manufacture successful completion',async () => { assert.equal((await runner.run(list,listCode('System.exit(0); return List.of();'),'submit')).status,'runtime_error'); });
  await t.test('student classes cannot write files, start processes, access network, or disable policy',async () => {
    const marker=path.join(cacheDir,'escaped.txt'); const quoted=JSON.stringify(marker);
    for(const body of [`java.nio.file.Files.writeString(java.nio.file.Path.of(${quoted}), "escaped"); return List.of();`, 'new ProcessBuilder("java","-version").start(); return List.of();', 'new java.net.Socket("127.0.0.1",9); return List.of();','System.setSecurityManager(null); return List.of();']) {
      const result=await runner.run(list,listCode(body),'run'); assert.equal(result.status,'runtime_error',JSON.stringify(result)); assert.match(result.tests[0].message,/AccessControlException|SecurityException/);
    }
    assert.equal(fs.existsSync(marker),false);
  });
  await t.test('unknown run modes and source injection fail closed',async () => {
    assert.equal((await runner.run(list,list.starterFiles,'execute-shell')).status,'error');
    assert.equal((await runner.run(list,{'../ListTask.java':fixedList},'submit')).status,'error');
  });
});

test('missing fixed library cache is reported unavailable without resolving student dependencies', async t => {
  assert.equal(typeof createJavaRunner,'function');
  const catalog=createCatalog(); const cacheDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-no-deps-'));
  const runner=createJavaRunner({catalog,cacheDir,mode:'local'});
  t.after(async () => {await runner.close(); fs.rmSync(cacheDir,{recursive:true,force:true});});
  const exercise=catalog.get('json-task'); assert.ok(exercise);
  const result=await runner.run(exercise,exercise.starterFiles,'submit'); assert.equal(result.status,'unavailable'); assert.match(result.diagnostics,/подготов|prepare/i);
});

test('prepared fixed dependencies compile and execute a packaged multi-file Java task',async t => {
  assert.equal(typeof createJavaRunner,'function');
  const cacheDir=process.env.TRAINING_CACHE_DIR || path.join(__dirname,'../.runtime/training-cache');
  if(!fs.existsSync(path.join(cacheDir,'dependencies.json'))) { t.skip('Run node scripts/prepare-training.cjs before dependency integration check.'); return; }
  const catalog=createCatalog(); const runner=createJavaRunner({catalog,cacheDir,mode:'local'}); t.after(() => runner.close());
  const exercise=catalog.get('json-task');
  const files={...exercise.starterFiles,'demo/JsonTask.java':`package demo; import com.fasterxml.jackson.databind.*; public class JsonTask { static String readerName(String json) throws Exception { return new ObjectMapper().readTree(json).path("reader").path("name").asText(); } }`};
  const result=await runner.run(exercise,files,'submit'); assert.equal(result.status,'accepted',JSON.stringify(result)); assert.equal(result.passed,result.total);
});

test('queued attempts snapshot source and enforce queue/close limits',async t => {
  const catalog=createCatalog(); const runner=createJavaRunner({catalog,mode:'local',maxQueue:1}); t.after(()=>runner.close());
  const files={'ListTask.java':fixedList};
  const first=runner.run(catalog.get('list-task'),files,'run');
  files['ListTask.java']='invalid Java';
  assert.equal((await runner.run(catalog.get('list-task'),files,'run')).status,'unavailable');
  assert.equal((await first).status,'accepted');
  await runner.close();
  assert.equal((await runner.run(catalog.get('list-task'),files,'run')).status,'unavailable');
});

test('caller cannot replace private checks and custom Loan field mutation fails',async t => {
  const catalog=createCatalog(); const runner=createJavaRunner({catalog,mode:'local'}); t.after(()=>runner.close());
  const list=catalog.get('list-task'); list.tests=[{name:'fake',args:[[],0],expected:[]}];
  assert.equal((await runner.run(list,listCode('return List.of();'),'submit')).status,'wrong_answer');
  const grouping=catalog.get('grouping-task');
  const mutated=fixedGrouping.replace('final int bookId, readerId','int bookId, readerId').replace('return result;','if(!loans.isEmpty()) loans.get(0).readerId=12345; return result;');
  const result=await runner.run(grouping,{'GroupingTask.java':mutated},'submit');
  assert.equal(result.status,'wrong_answer'); assert.ok(result.tests.some(item=>/измен/.test(item.message||'')));
});

test('thread creation and reflection into trusted code cannot bypass the local policy',async t => {
  const catalog=createCatalog(); const runner=createJavaRunner({catalog,mode:'local'}); t.after(()=>runner.close());
  for(const body of ['new Thread(() -> {}).start(); return List.of();','ClassLoader.getSystemClassLoader().loadClass("mentor.runner.TrustedHarness"); return List.of();']) {
    const result=await runner.run(catalog.get('list-task'),listCode(body),'run');
    assert.equal(result.status,'runtime_error'); assert.match(result.tests[0].message,/AccessControlException|SecurityException/);
  }
});

test('production fails closed when local execution is selected',async () => {
  const previous=process.env.NODE_ENV; process.env.NODE_ENV='production';
  const runner=createJavaRunner({mode:'local'});
  try { const status=await runner.status(); assert.equal(status.available,false); assert.match(status.message,/production/); }
  finally { await runner.close(); if(previous===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous; }
});

test('actual Docker runtime runs trusted checks, fixed dependencies and stops hung containers', {timeout:60000},async t => {
  const catalog=createCatalog(); const runner=createJavaRunner({catalog,mode:'docker',runTimeoutMs:1000}); t.after(()=>runner.close());
  const state=await runner.status();
  if(!state.available) { if(process.env.TRAINING_REQUIRE_DOCKER==='1') assert.fail(state.message); t.skip(state.message); return; }
  assert.equal(state.mode,'docker');
  assert.equal((await runner.run(catalog.get('list-task'),{'ListTask.java':fixedList},'submit')).status,'accepted');
  assert.equal((await runner.run(catalog.get('grouping-task'),{'GroupingTask.java':fixedGrouping},'submit')).status,'accepted');
  assert.equal((await runner.run(catalog.get('list-task'),listCode('while(true) {}'),'submit')).status,'time_limit');
  const exercise=catalog.get('json-task');
  const files={...exercise.starterFiles,'demo/JsonTask.java':'package demo; import com.fasterxml.jackson.databind.*; public class JsonTask { static String readerName(String json) throws Exception { return new ObjectMapper().readTree(json).path(ReaderFields.READER).path(ReaderFields.NAME).asText(); } }'};
  const result=await runner.run(exercise,files,'submit');
  assert.equal(result.status,'accepted',JSON.stringify(result));
});

test('custom Number cannot forge numeric output or mutation snapshots', {timeout:60000},async t => {
  const catalog=createCatalog();
  const forgedMutation=`import java.util.*; public class ListTask {
    static class Spoof extends Number {
      final String text; Spoof(String text){this.text=text;}
      public int intValue(){return 0;} public long longValue(){return 0;}
      public float floatValue(){return 0;} public double doubleValue(){return 0;}
      public String toString(){return text;}
    }
    static List<Integer> select(List<Integer> source,int minimum) {
      List<Integer> original=new ArrayList<>(source);
      List<Integer> answer=original.stream().filter(n -> n >= minimum).sorted().toList();
      if(!original.isEmpty()) {
        source.clear(); String serialized=original.toString();
        ((List)source).add(new Spoof(serialized.substring(1,serialized.length()-1)));
      }
      return answer;
    }
  }`;
  for(const mode of ['local','docker']) await t.test(mode,async t => {
    const runner=createJavaRunner({catalog,mode}); t.after(()=>runner.close());
    const status=await runner.status();
    if(mode==='docker' && !status.available) { if(process.env.TRAINING_REQUIRE_DOCKER==='1') assert.fail(status.message); t.skip(status.message); return; }
    assert.equal(status.available,true,status.message);
    const result=await runner.run(catalog.get('list-task'),{'ListTask.java':forgedMutation},'submit');
    assert.equal(result.status,'runtime_error',JSON.stringify(result));
    assert.equal(result.passed,0);
    assert.match(result.tests[0].message,/числ|number/i);
    for(const number of ['Double.NaN','Double.POSITIVE_INFINITY','Float.NEGATIVE_INFINITY']) {
      const nonFinite=await runner.run(catalog.get('list-task'),listCode(`return (List) List.of(${number});`),'run');
      assert.equal(nonFinite.status,'runtime_error',JSON.stringify(nonFinite));
      assert.match(nonFinite.tests[0].message,/конечн/);
    }
    const ordinary=await runner.run(catalog.get('list-task'),{'ListTask.java':fixedList},'submit');
    assert.equal(ordinary.status,'accepted',JSON.stringify(ordinary));
    assert.equal(ordinary.passed,6);
  });
});
