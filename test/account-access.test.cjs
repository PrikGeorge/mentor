'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAccessController,renderAccess,copyAccessLink}=require('../dist/account-access.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(handler){const calls=[];const auth={session:()=>({account:{id:'teacher-account',role:'teacher'}}),request:async(path,options={})=>{calls.push({path,...options});return handler(path,options);}};return {auth,calls};}
test('clipboard failures never report successful copying',async()=>{
 assert.equal(await copyAccessLink(undefined,'one'),false);
 assert.equal(await copyAccessLink({writeText:async()=>{throw new Error('Denied');}},'two'),false);
 let copied;assert.equal(await copyAccessLink({writeText:async value=>{copied=value;}},'three'),true);assert.equal(copied,'three');
});
test('access lifecycle invites, revokes and toggles an existing account without retaining raw links',async()=>{
 let data={account:null,invitation:null};const f=fixture(async(path,options)=>{
  if(options.method==='POST'&&path.endsWith('/invitations')){data.invitation={id:'invite-1',expiresAt:'2026-10-03T10:00:00Z'};return {...data.invitation,url:'http://localhost/#register/test-token'};}
  if(path.endsWith('/revoke')){data.invitation=null;return null;}
  if(options.method==='PATCH'){data.account.disabled=JSON.parse(options.body).disabled;return structuredClone(data);}
  return structuredClone(data);
 });
 const c=createAccessController({studentId:'student-1',auth:f.auth});await c.load();assert.equal(c.snapshot().data.account,null);
 await c.invite();assert.equal(c.snapshot().data.invitation.id,'invite-1');assert.match(c.snapshot().link.url,/#register/);assert.match(renderAccess(c.snapshot()),/Копировать ссылку/);
 await c.revoke();assert.equal(c.snapshot().data.invitation,null);assert.equal(c.snapshot().link,null);
 data.account={id:'student-account',login:'learner',role:'student',studentId:'student-1',disabled:false};await c.load();assert.doesNotMatch(renderAccess(c.snapshot()),/Создать приглашение/);
 await c.setDisabled(true);assert.equal(c.snapshot().data.account.disabled,true);await c.setDisabled(false);assert.equal(c.snapshot().data.account.disabled,false);
 for(const call of f.calls)assert.equal(call.expectedAccountId,'teacher-account');c.dispose();assert.equal(c.snapshot().link,null);
});
test('double invitation click submits once and disposed card ignores a late response',async()=>{
 const pending=deferred();let accessCalls=0;const f=fixture((path,options)=>options.method==='POST'?pending.promise:(accessCalls++,{account:null,invitation:null}));
 const c=createAccessController({studentId:'first',auth:f.auth});await c.load();const first=c.invite();await c.invite();assert.equal(f.calls.filter(x=>x.method==='POST').length,1);c.dispose();pending.resolve({id:'old',url:'http://localhost/#register/old-token',expiresAt:'2026-10-03T10:00:00Z'});await first;assert.equal(c.snapshot().link,null);assert.equal(accessCalls,1);
});
test('password reset is unavailable without account and submitted password is not held in UI state',async()=>{
 let data={account:null,invitation:null};const f=fixture((path,options)=>path.endsWith('/password-reset')?{url:'http://localhost/#reset-password/test-token',expiresAt:'2026-09-30T12:30:00Z'}:data);
 const c=createAccessController({studentId:'one',auth:f.auth});await c.load();assert.doesNotMatch(renderAccess(c.snapshot()),/Ссылка для смены пароля/);await c.resetPassword('not sent');assert.equal(f.calls.length,1);
 data={account:{id:'s',login:'learner',disabled:false},invitation:null};await c.load();await c.resetPassword('temporary teacher password');assert.match(c.snapshot().link.url,/#reset-password/);assert.doesNotMatch(JSON.stringify(c.snapshot()),/temporary teacher password/);assert.equal(JSON.parse(f.calls.at(-1).body).currentPassword,'temporary teacher password');
});
test('controls escape account text and absence of teacher session prevents every request',async()=>{
 const html=renderAccess({busy:false,error:'<script>bad</script>',data:{account:{login:'<img src=x>',disabled:true},invitation:null},link:null});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/Восстановить доступ/);
 let calls=0;const c=createAccessController({studentId:'one',auth:{session:()=>({account:{id:'s',role:'student'}}),request:async()=>{calls++;}}});await c.load();await c.invite();assert.equal(calls,0);assert.equal(c.snapshot().data,null);
});
