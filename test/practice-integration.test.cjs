'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../server.cjs');

test('practice API is mounted behind the existing same-origin guards and closes its runner',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-practice-integration-'));
 let closed=false;
 const runner={status:async()=>({available:true,mode:'test',message:'Test runner'}),run:async()=>({status:'accepted',passed:1,total:1,tests:[{name:'example',status:'accepted'}]}),close(){closed=true}};
 const server=createServer({dataDir,practiceRunner:runner});
 await server.auth.setupTeacher({login:'teacher',password:'Passphrase-for-tests-2026!'});
 t.after(async()=>{
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(dataDir),os.tmpdir());
  assert.ok(path.basename(dataDir).startsWith('mentor-practice-integration-'));
  fs.rmSync(dataDir,{recursive:true,force:true});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-Mentor-Client':'web'},body:JSON.stringify({login:'teacher',password:'Passphrase-for-tests-2026!'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const catalog=await fetch(origin+'/api/practice/catalog',{headers:{Cookie:cookie}});
 assert.equal(catalog.status,200);
 const catalogData=await catalog.json();
 assert.ok(catalogData.exercises.some(item=>item.id==='list-task'));
 const response=await fetch(origin+'/api/students/michael/lessons/lesson-2026-09-27/practice/assignments',{
  method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example',Cookie:cookie,'X-Mentor-Client':'web'},body:JSON.stringify({assignments:[]})
 });
 assert.equal(response.status,403);
 const practice=await fetch(origin+'/api/students/michael/lessons/lesson-2026-09-27/practice',{headers:{Cookie:cookie}});
 const view=await practice.json();assert.equal(view.exercises.length,2);
 assert.equal((await fetch(origin+'/training/catalog.json')).status,404);
 assert.equal((await fetch(origin+'/data/practice/state.json')).status,404);
 await new Promise(resolve=>server.close(resolve));
 assert.equal(closed,true);
});
