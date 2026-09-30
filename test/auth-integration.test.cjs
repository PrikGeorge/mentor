'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('../server.cjs');
const {createStore}=require('../lib/store.cjs');
const {createPracticeStore}=require('../lib/practice-store.cjs');
const {createCatalog}=require('../lib/training-catalog.cjs');
const {createJavaRunner}=require('../lib/java-runner.cjs');
const BASE='/api/students/michael/lessons/lesson-2026-09-27';
const PASSWORD='Isolated integration password 2026!';
function tree(directory){
 const entries=[];
 function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())visit(file);else entries.push([path.relative(directory,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}}
 visit(directory);return entries.sort((a,b)=>a[0].localeCompare(b[0]));
}
async function fixture(t,{docker=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-auth-e2e-')),source=path.join(root,'before'),dataDir=path.join(root,'working');
 let before,server,origin;
 t.after(async()=>{try{await stop();if(before)assert.deepEqual(tree(source),before,'pre-auth source fixture remains byte-identical');}finally{fs.rmSync(root,{recursive:true,force:true});}});
 const store=createStore({dataDir:source});
 store.updateStudent('michael',{notes:'PRIVATE_TEACHER_MARKER',studentReview:'PUBLIC_REVIEW_MARKER'});
 const other=store.addStudent({name:'Другой ученик',notes:'OTHER_PRIVATE_MARKER'});
 const catalog=createCatalog(),exercise=catalog.get('list-task');
 const previous=createPracticeStore({dataDir:source});
 previous.ensureLesson('michael','lesson-2026-09-27',[{exerciseId:'list-task',placement:'class'}]);
 const historical=previous.addAttempt('michael','lesson-2026-09-27','list-task',exercise.revision,exercise.starterFiles,'submit',{status:'accepted',passed:1,total:1,tests:[]});
 const oldFile=previous.addSubmission('michael','lesson-2026-09-27',{filename:'previous.txt',comment:'Старая работа',repositoryUrl:''},Buffer.from('PREVIOUS_UPLOAD'));
 const reviewedFile=previous.reviewSubmission('michael','lesson-2026-09-27',oldFile.id,'reviewed','PREVIOUS_FEEDBACK');
 const uploadHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'practice/uploads',oldFile.blobId))).digest('hex');
 before=tree(source);fs.cpSync(source,dataDir,{recursive:true});
 let runs=0;
 function assertHistoryPreserved(){
  const stored=createPracticeStore({dataDir}).getLesson('michael','lesson-2026-09-27');
  assert.deepEqual(stored.attempts.find(a=>a.id===historical.id),historical,'entire historical attempt remains unchanged in the working copy');
  assert.deepEqual(stored.submissions.find(s=>s.id===oldFile.id),reviewedFile,'historical submission and feedback remain unchanged');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir,'practice/uploads',oldFile.blobId))).digest('hex'),uploadHash,'old uploaded bytes remain unchanged in the working copy');
 }
 const runner=docker?createJavaRunner({catalog,mode:'docker'}):{status:async()=>({available:true,mode:'test',message:'Fixture'}),run:async()=>{runs++;return {status:'accepted',passed:1,total:1,elapsedMs:1,tests:[{name:'example',status:'accepted'}],privateSource:'NEVER_RETURN_CHECKER'};},close(){}};
 async function start(){server=createServer({dataDir,practiceCatalog:catalog,practiceRunner:runner,authOptions:{production:false}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
 await start();await server.auth.setupTeacher({login:'teacher',password:PASSWORD});
 async function call(route,{session,method='GET',body,headers={}}={}){
  const response=await fetch(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Mentor-Client':'web',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken,'X-Mentor-Account':session.account.id}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let json=null;try{json=JSON.parse(text);}catch{}
  return {status:response.status,text,json,headers:response.headers};
 }
 const sessionOf=result=>({...result.json,cookie:result.headers.get('set-cookie').split(';')[0]});
 async function login(login='teacher',password=PASSWORD){const result=await call('/api/auth/login',{method:'POST',body:{login,password}});assert.equal(result.status,200,result.text);return sessionOf(result);}
 const teacher=await login();
 async function register(sid,login){const invite=await call(`/api/students/${sid}/invitations`,{session:teacher,method:'POST',body:{}});assert.equal(invite.status,201,invite.text);const token=invite.json.url.split('/').at(-1);const result=await call('/api/auth/register',{method:'POST',body:{token,login,password:PASSWORD}});assert.equal(result.status,201,result.text);return {...sessionOf(result),registrationToken:token};}
 return {dataDir,other,catalog,exercise,historical,oldFile,teacher,call,login,register,start,stop,sessionOf,assertHistoryPreserved,get runs(){return runs;},get server(){return server;},runner};
}

test('auth lifecycle preserves pre-existing learning history and closes data/material boundaries',async t=>{
 const f=await fixture(t),student=await f.register('michael','learner'),other=await f.register(f.other.id,'another');
 const own=await f.call('/api/state',{session:student});assert.equal(own.status,200);assert.deepEqual(own.json.students.map(s=>s.id),['michael']);assert.equal(own.json.lessons[0].id,'lesson-2026-09-27');assert.match(own.text,/PUBLIC_REVIEW_MARKER/);assert.doesNotMatch(own.text,/PRIVATE_TEACHER_MARKER|OTHER_PRIVATE_MARKER|teacherNotes|passwordHash/);
 const content=await f.call('/api/content',{session:student});assert.equal(content.status,200,content.text);assert.ok(content.json.docs.student);assert.equal(content.json.docs.guide,undefined);assert.equal(content.json.docs['student-review'].studentId,'michael');
 const otherContent=await f.call('/api/content',{session:other});assert.deepEqual(otherContent.json,{docs:{},code:{},viewData:{}});
 for(const route of ['/content.js','/student.html','/downloads/teacher-lesson-2026-09-27.zip','/downloads/ListSolutions.java','/data/auth/accounts.json'])for(const session of [undefined,student,other,f.teacher])for(const method of ['GET','HEAD'])assert.equal((await f.call(route,{session,method})).status,404,route);
 assert.equal((await f.call('/api/materials/teacher-lesson-2026-09-27',{session:student})).status,404);
 assert.equal((await f.call('/api/materials/student-lesson-2026-09-27',{session:other})).status,404);
 assert.equal((await f.call('/api/materials/student-lesson-2026-09-27',{session:student,method:'HEAD'})).status,200);
 const protectedBefore=tree(f.dataDir);
 assert.equal((await f.call(BASE+'/practice')).status,401);
 assert.equal((await f.call(BASE+'/practice',{session:other})).status,404);
 const attemptBody={files:f.exercise.starterFiles,mode:'submit',exerciseRevision:f.exercise.revision};
 assert.equal((await f.call(BASE+'/practice/exercises/list-task/attempts',{session:f.teacher,method:'POST',body:attemptBody})).status,403);
 assert.equal((await f.call(BASE+'/homework',{session:f.teacher,method:'POST',body:{filename:'never.txt',contentBase64:'eA=='}})).status,403);
 assert.equal(f.runs,0);assert.deepEqual(tree(f.dataDir),protectedBefore,'denied requests do not change persisted files');
 const existing=await f.call(BASE+'/practice',{session:student});assert.ok(existing.json.exercises[0].attempts.some(a=>a.id===f.historical.id));
 const files=Object.fromEntries(Object.entries(f.exercise.starterFiles).map(([name,source])=>[name,source+'\n// learner saved draft']));
 const draft=await f.call(BASE+'/practice/exercises/list-task/draft',{session:student,method:'PATCH',body:{files,exerciseRevision:f.exercise.revision,revision:0}});assert.equal(draft.status,200,draft.text);
 const attempt=await f.call(BASE+'/practice/exercises/list-task/attempts',{session:student,method:'POST',body:{...attemptBody,files}});assert.equal(attempt.status,201,attempt.text);assert.equal(attempt.json.attempt.result.status,'accepted');assert.doesNotMatch(attempt.text,/NEVER_RETURN_CHECKER/);assert.equal(f.runs,1);
 const upload=await f.call(BASE+'/homework',{session:student,method:'POST',body:{filename:'homework.txt',contentBase64:Buffer.from('MY_HOMEWORK').toString('base64'),comment:'На проверку',repositoryUrl:''}});assert.equal(upload.status,201,upload.text);
 const review=await f.call(BASE+'/homework/'+upload.json.submission.id,{session:f.teacher,method:'PATCH',body:{status:'reviewed',feedback:'Проверено преподавателем'}});assert.equal(review.status,200,review.text);
 assert.equal((await f.call(BASE+'/homework/'+f.oldFile.id+'/file',{session:student})).text,'PREVIOUS_UPLOAD');
 const stale=await f.call(BASE+'/practice/exercises/list-task/draft',{session:other,method:'PATCH',body:{files,exerciseRevision:f.exercise.revision,revision:1},headers:{'X-Mentor-Account':student.account.id,'X-CSRF-Token':student.csrfToken}});assert.equal(stale.status,409);assert.equal(stale.json.code,'ACCOUNT_CHANGED');
 assert.equal((await f.call('/api/auth/logout',{session:student,method:'POST',body:{}})).status,204);
 assert.equal((await f.call(BASE+'/practice',{session:student})).status,401);
 const reset=await f.call('/api/students/michael/password-reset',{session:f.teacher,method:'POST',body:{currentPassword:PASSWORD}});assert.equal(reset.status,201,reset.text);
 const nextPassword='Replacement integration password 2026!';
 assert.equal((await f.call('/api/auth/reset-password',{method:'POST',body:{token:reset.json.url.split('/').at(-1),newPassword:nextPassword}})).status,204);
 const renewed=await f.login('learner',nextPassword);
 const after=await f.call(BASE+'/practice',{session:renewed});assert.ok(after.json.exercises[0].attempts.some(a=>a.id===f.historical.id));assert.ok(after.json.exercises[0].attempts.some(a=>a.id===attempt.json.attempt.id));assert.ok(after.json.submissions.some(s=>s.feedback==='PREVIOUS_FEEDBACK'));assert.deepEqual(after.json.exercises[0].draft.files,files);
 f.assertHistoryPreserved();
 const pendingCard=await f.call('/api/students',{session:f.teacher,method:'POST',body:{name:'После перезапуска'}});assert.equal(pendingCard.status,201,pendingCard.text);
 const pendingInvite=await f.call(`/api/students/${pendingCard.json.student.id}/invitations`,{session:f.teacher,method:'POST',body:{}});assert.equal(pendingInvite.status,201,pendingInvite.text);
 await f.stop();await f.start();assert.equal((await f.call('/api/auth/me',{session:renewed})).json.account,null);
 assert.equal((await f.call('/api/auth/register',{method:'POST',body:{token:student.registrationToken,login:'replay',password:PASSWORD}})).status,400);
 assert.equal((await f.login('learner',nextPassword)).account.studentId,'michael');
 const registeredAfterRestart=await f.call('/api/auth/register',{method:'POST',body:{token:pendingInvite.json.url.split('/').at(-1),login:'after-restart',password:PASSWORD}});assert.equal(registeredAfterRestart.status,201,registeredAfterRestart.text);
 assert.equal(registeredAfterRestart.json.account.studentId,pendingCard.json.student.id);f.assertHistoryPreserved();
});

test('corrupt auth fails closed and a removed student invalidates its session without recreating a card',async t=>{
 const f=await fixture(t),student=await f.register('michael','learner');
 const file=path.join(f.dataDir,'mentoring.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
 state.students=state.students.filter(s=>s.id!=='michael');state.lessons=state.lessons.filter(l=>l.studentId!=='michael');fs.writeFileSync(file,JSON.stringify(state));const before=fs.readFileSync(file);
 assert.equal((await f.call(BASE+'/practice',{session:student})).status,401);assert.deepEqual(fs.readFileSync(file),before);
 await f.stop();const authFile=path.join(f.dataDir,'auth/accounts.json');fs.writeFileSync(authFile,'{corrupt');assert.throws(()=>createServer({dataDir:f.dataDir,authOptions:{production:false}}));assert.equal(fs.readFileSync(authFile,'utf8'),'{corrupt');
});

test('authenticated student executes Java through Docker while a teacher preview cannot start a run',async t=>{
 const f=await fixture(t,{docker:true});const status=await f.runner.status();assert.equal(status.available,true,status.message);assert.equal(status.mode,'docker');
 const student=await f.register('michael','learner');const body={files:{'ListTask.java':'import java.util.*; public class ListTask { static List<Integer> select(List<Integer> source, int minimum) { List<Integer> result = new ArrayList<>(); for (Integer number : source) if (number >= minimum) result.add(number); result.sort(Integer::compareTo); return result; } }'},mode:'submit',exerciseRevision:f.exercise.revision};
 assert.equal((await f.call(BASE+'/practice/exercises/list-task/attempts',{session:f.teacher,method:'POST',body})).status,403);
 const result=await f.call(BASE+'/practice/exercises/list-task/attempts',{session:student,method:'POST',body});assert.equal(result.status,201,result.text);assert.equal(result.json.attempt.result.status,'accepted',result.text);assert.equal(result.json.attempt.result.passed,f.exercise.tests.length);assert.equal(result.json.attempt.result.total,f.exercise.tests.length);assert.equal(result.json.attempt.result.tests.length,f.exercise.tests.length);
});
