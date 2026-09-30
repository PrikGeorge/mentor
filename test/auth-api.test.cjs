'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAuthApi, resolveAuth, requireMutation } = require('../lib/auth-api.cjs');
const { createRequestSecurity } = require('../lib/request-security.cjs');
const { createAuthService } = require('../lib/auth-service.cjs');
const password = 'Temp-test-password-123';
async function fixture(t, production = false) {
 const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-auth-http-'));
 const auth = createAuthService({ dataDir, getStudent: id => ['s1', 's2'].includes(id) ? { id } : null });
 await auth.setupTeacher({login:'teacher',password});
 const security = createRequestSecurity({production, publicOrigin: production ? 'https://mentor.test' : undefined});
 let server;
 const handle = createAuthApi({auth,security,originFor: req => production ? 'https://mentor.test' : `http://${req.headers.host}`, production});
 server=http.createServer(async(req,res)=>{ try { security.check(req,server,!['GET','HEAD'].includes(req.method)); if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)) {res.writeHead(404);res.end();} } catch(e) { if(e.retryAfter)res.setHeader('Retry-After',e.retryAfter);res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,code:e.code}));} });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));auth.close();fs.rmSync(dataDir,{recursive:true,force:true});});
 async function request(route, body, session, extra = {}, method = body === undefined ? 'GET' : 'POST', raw = false) {
  const host=production?'mentor.test':`127.0.0.1:${server.address().port}`;
  const headers={Host:host,Origin:production?'https://mentor.test':`http://${host}`,'Content-Type':'application/json','X-Mentor-Client':'web',...session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken,'X-Mentor-Account':session.account.id}:{},...extra};
  return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,json:text?JSON.parse(text):null,text}));});r.on('error',reject);r.end(body===undefined?undefined:raw?body:JSON.stringify(body));});
 }
 const login=await request('/api/auth/login',{login:'teacher',password});
 const teacher={...login.json,cookie:login.headers['set-cookie'][0].split(';')[0]};
 return {auth,request,teacher,login,dataDir};
}
test('local and production session cookies keep token out of JSON and me is public', async t=>{
 for(const prod of [false,true]) {const f=await fixture(t,prod);assert.equal(f.login.status,200);const cookie=f.login.headers['set-cookie'][0];assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Path=\//);assert.doesNotMatch(cookie,/Domain=/);assert.equal(/Secure/.test(cookie),prod);assert.equal(cookie.startsWith('__Host-mentor_session='),prod);assert.equal(Object.hasOwn(f.login.json,'token'),false);assert.deepEqual((await f.request('/api/auth/me')).json,{account:null,csrfToken:null});assert.equal((await f.request('/api/auth/me',undefined,f.teacher)).json.account.id,f.teacher.account.id);}
});
test('invitation registration and access preserve student binding and reject client role',async t=>{
 const f=await fixture(t);let invite=await f.request('/api/students/s1/invitations',{},f.teacher);assert.equal(invite.status,201);assert.match(invite.json.url,/#register\//);const token=invite.json.url.split('/').at(-1);
 assert.equal((await f.request('/api/auth/register',{token,login:'learner',password,role:'teacher'})).status,400);
 const register=await f.request('/api/auth/register',{token,login:'learner',password});assert.equal(register.status,201);assert.equal(register.json.account.role,'student');assert.equal(register.json.account.studentId,'s1');assert.equal(Object.hasOwn(register.json,'token'),false);
 const learner={...register.json,cookie:register.headers['set-cookie'][0].split(';')[0]};assert.equal((await f.request('/api/students/s1/access',undefined,learner)).status,403);
 assert.equal((await f.request('/api/students/s1/access',undefined,f.teacher)).json.account.id,learner.account.id);
 assert.equal((await f.request('/api/auth/login',{login:'teacher',password},learner)).status,409);
});

test('HTTP registration, password change and reset accept eight characters and reject seven', async t => {
 const f = await fixture(t);
 const invite = await f.request('/api/students/s1/invitations', {}, f.teacher);
 const token = invite.json.url.split('/').at(-1);
 const tooShort = await f.request('/api/auth/register', {token, login:'learner', password:'1234567'});
 assert.equal(tooShort.status, 400);
 assert.equal(tooShort.json.code, 'INVALID_INPUT');
 const registration = await f.request('/api/auth/register', {token, login:'learner', password:'12345678'});
 assert.equal(registration.status, 201);
 assert.match(tooShort.json.error, /8–128/);
 const learner = {...registration.json, cookie:registration.headers['set-cookie'][0].split(';')[0]};
 assert.equal((await f.request('/api/auth/login', {login:'learner', password:'12345678'})).status, 200);
 assert.equal((await f.request('/api/auth/change-password', {currentPassword:'12345678', newPassword:'1234567'}, learner)).status, 400);
 const change = await f.request('/api/auth/change-password', {currentPassword:'12345678', newPassword:'abcdefgh'}, learner);
 assert.equal(change.status, 200);
 assert.equal((await f.request('/api/auth/me', undefined, learner)).json.account, null);
 assert.equal((await f.request('/api/auth/login', {login:'learner', password:'abcdefgh'})).status, 200);
 const reset = await f.request('/api/students/s1/password-reset', {currentPassword:password}, f.teacher);
 const resetToken = reset.json.url.split('/').at(-1);
 assert.equal((await f.request('/api/auth/reset-password', {token:resetToken, newPassword:'1234567'})).status, 400);
 assert.equal((await f.request('/api/auth/reset-password', {token:resetToken, newPassword:'87654321'})).status, 204);
 assert.equal((await f.request('/api/auth/login', {login:'learner', password:'87654321'})).status, 200);
 assert.equal((await f.request('/api/auth/login', {login:'learner', password:'abcdefgh'})).status, 401);
});
test('CSRF and stale account reject mutations before reading body and account state stays intact',async t=>{
 const f=await fixture(t);for(const headers of [{'X-CSRF-Token':'bad'},{'X-Mentor-Account':'old'}]) {const r=await f.request('/api/students/s1/invitations',{},f.teacher,headers);assert.equal(r.status,headers['X-Mentor-Account']?409:403);if(r.status===409)assert.equal(r.json.code,'ACCOUNT_CHANGED');}
 assert.equal((await f.request('/api/students/s1/access',undefined,f.teacher)).json.invitation,null);
 let read=false;const request={headers:{'x-mentor-account':'old','x-csrf-token':'bad'},on(){read=true;}};assert.throws(()=>requireMutation(request,{principal:{id:'new'},csrfToken:'good'}),e=>e.status===409);assert.equal(read,false);
});
test('logout revokes session and password reset requires normal login',async t=>{
 const f=await fixture(t);const invite=await f.request('/api/students/s1/invitations',{},f.teacher);const token=invite.json.url.split('/').at(-1);const registration=await f.request('/api/auth/register',{token,login:'learner',password});const learner={...registration.json,cookie:registration.headers['set-cookie'][0].split(';')[0]};
 const reset=await f.request('/api/students/s1/password-reset',{currentPassword:password},f.teacher);assert.equal(reset.status,201);const result=await f.request('/api/auth/reset-password',{token:reset.json.url.split('/').at(-1),newPassword:'New-test-password-456'});assert.equal(result.status,204);assert.equal(result.headers['set-cookie'],undefined);assert.equal((await f.request('/api/auth/me',undefined,learner)).json.account,null);
 const logout=await f.request('/api/auth/logout',{},f.teacher);assert.equal(logout.status,204);assert.match(logout.headers['set-cookie'][0],/Max-Age=0/);assert.equal((await f.request('/api/auth/me',undefined,f.teacher)).json.account,null);
});
test('auth writes reject oversized body, missing Origin and return consistent login failures',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/auth/login',{login:'x',password:'x'.repeat(17000)})).status,413);
 assert.equal((await f.request('/api/auth/login',{login:'teacher',password},undefined,{Origin:''})).status,403);
 const unknown=await f.request('/api/auth/login',{login:'unknown',password});const wrong=await f.request('/api/auth/login',{login:'teacher',password:'Wrong-password-456'});assert.equal(unknown.status,401);assert.equal(wrong.status,401);assert.equal(unknown.json.error,'Неверный логин или пароль.');assert.equal(wrong.json.error,unknown.json.error);
});
test('changing password rotates session and invalidates previous cookie',async t=>{
 const f=await fixture(t);const change=await f.request('/api/auth/change-password',{currentPassword:password,newPassword:'Changed-password-567'},f.teacher);assert.equal(change.status,200);assert.notEqual(change.headers['set-cookie'][0].split(';')[0],f.teacher.cookie);assert.equal((await f.request('/api/auth/me',undefined,f.teacher)).json.account,null);const next={...change.json,cookie:change.headers['set-cookie'][0].split(';')[0]};assert.equal((await f.request('/api/auth/me',undefined,next)).json.account.id,f.teacher.account.id);
});
test('teacher can revoke invitations and suspend access; disabled login uses same generic error',async t=>{
 const f=await fixture(t);const revoked=await f.request('/api/students/s2/invitations',{},f.teacher);assert.equal((await f.request(`/api/students/s2/invitations/${revoked.json.id}/revoke`,{},f.teacher)).status,204);assert.equal((await f.request('/api/auth/register',{token:revoked.json.url.split('/').at(-1),login:'revoked',password})).status,400);
 const invite=await f.request('/api/students/s1/invitations',{},f.teacher);const registration=await f.request('/api/auth/register',{token:invite.json.url.split('/').at(-1),login:'learner',password});assert.equal(registration.status,201);const learner={...registration.json,cookie:registration.headers['set-cookie'][0].split(';')[0]};const disabled=await f.request('/api/students/s1/access',{disabled:true},f.teacher,{},'PATCH');assert.equal(disabled.status,200);assert.equal(disabled.json.account.disabled,true);assert.equal((await f.request('/api/auth/me',undefined,learner)).json.account,null);const login=await f.request('/api/auth/login',{login:'learner',password});assert.equal(login.status,401);assert.equal(login.json.error,'Неверный логин или пароль.');
});
test('HTTP rate failures include Retry-After and do not authorize forwarded Host',async t=>{
 const f=await fixture(t);for(let i=0;i<119;i++)assert.equal((await f.request('/api/auth/me')).status,200);const limited=await f.request('/api/auth/me');assert.equal(limited.status,429);assert.ok(Number(limited.headers['retry-after'])>0);assert.equal((await f.request('/api/auth/me',undefined,undefined,{Host:'evil.test','X-Forwarded-Host':'127.0.0.1'})).status,403);
});
test('global auth admission counts malformed, non-object and oversized JSON before reading it', async t => {
 const f = await fixture(t); // Login consumed one admission.
 const bodies = ['{', 'null', JSON.stringify({password:'x'.repeat(17000)})];
 for(let i=0;i<119;i++) {
  const result = await f.request('/api/auth/change-password', bodies[i%3], f.teacher, {}, 'POST', true);
  assert.equal(result.status, i%3===2?413:400);
 }
 const rejected = await f.request('/api/auth/change-password', '{', f.teacher, {}, 'POST', true);
 assert.equal(rejected.status,429);
 assert.equal(rejected.json.code,'RATE_LIMITED');
 assert.ok(Number(rejected.headers['retry-after'])>0);
});
test('production startup rejects missing HTTPS origin and local Java before creating data',()=>{
 const {createServer}=require('../server.cjs');const dataDir=path.join(os.tmpdir(),`mentor-no-start-${process.pid}-${Date.now()}`);assert.throws(()=>createServer({dataDir,authOptions:{production:true,publicOrigin:'http://mentor.test'}}));const previous=process.env.MENTOR_JAVA_MODE;try{process.env.MENTOR_JAVA_MODE='local';assert.throws(()=>createServer({dataDir,authOptions:{production:true,publicOrigin:'https://mentor.test'}}));}finally{if(previous===undefined)delete process.env.MENTOR_JAVA_MODE;else process.env.MENTOR_JAVA_MODE=previous;}assert.equal(fs.existsSync(dataDir),false);
});
test('real server requires session for data and rejects stale mutation before a write while health stays public',async t=>{
 const {createServer}=require('../server.cjs');const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-server-auth-'));const server=createServer({dataDir,authOptions:{production:false}});await server.auth.setupTeacher({login:'teacher',password});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(`${base}/api/health`)).status,200);assert.equal((await fetch(`${base}/api/state`)).status,401);
 const headers={Origin:base,'Content-Type':'application/json','X-Mentor-Client':'web'};const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers,body:JSON.stringify({login:'teacher',password})});assert.equal(login.status,200);const identity=await login.json();headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=identity.csrfToken;headers['X-Mentor-Account']='stale-account';const before=JSON.parse(fs.readFileSync(path.join(dataDir,'mentoring.json'),'utf8'));const stale=await fetch(`${base}/api/students`,{method:'POST',headers,body:JSON.stringify({name:'Must not appear'})});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'ACCOUNT_CHANGED');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'mentoring.json'),'utf8')),before);
});
test('CLI explains safe argv and non-TTY failures without echoing input or creating state',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-auth-cli-refuse-'));try{for(const [args,expected] of [[['setup','--data-dir',dataDir,'--password',password],/Использование:/],[['setup','--data-dir',dataDir],/интерактивный TTY/]]){const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/auth-admin.cjs'),...args],{input:`teacher\n${password}\n`,encoding:'utf8',env:{...process.env,MENTOR_PASSWORD:password}});assert.equal(result.status,1);assert.match(result.stderr,expected);assert.equal(result.stdout.includes(password),false);assert.equal(result.stderr.includes(password),false);assert.equal(fs.existsSync(path.join(dataDir,'auth','accounts.json')),false);}}finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
