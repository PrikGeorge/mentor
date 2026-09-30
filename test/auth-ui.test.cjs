'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../dist/auth.js'),'utf8');
function browser({hash='',search='',reply}={}){
 const calls=[],listeners={},windowListeners={},main={innerHTML:'',focus(){}};
 const location={hash,search,pathname:'/',origin:'https://mentor.example'};
 const history={replaceState(_state,_title,url){const mark=url.indexOf('#');location.hash=mark<0?'':url.slice(mark);}};
 const document={getElementById(id){return id==='main'?main:null},addEventListener(type,fn){listeners[type]=fn},body:{classList:{toggle(){}}}};
 const window={location,history,addEventListener(type,fn){windowListeners[type]=fn},BroadcastChannel:class{constructor(){this.onmessage=null}postMessage(){}},document};
 const fetch=async (url,options)=>{calls.push({url,options});const value=await reply(url,options);return {ok:value.status<400,status:value.status,json:async()=>value.body,text:async()=>JSON.stringify(value.body)};};
 // FormData is intentionally small: auth forms provide the same field entries as the browser API.
 class Fields{constructor(form){this.entriesValue=Object.entries(form.values)}[Symbol.iterator](){return this.entriesValue[Symbol.iterator]()}}
 const context=vm.createContext({window,document,location,history,fetch,FormData:Fields,Headers,URLSearchParams,console:{error(){throw new Error('auth leaked to console')}},Promise});
 vm.runInContext(source,context,{filename:'auth.js'});
 return {auth:window.MENTOR_AUTH,calls,main,location,listeners,windowListeners,window};
}
const guest={status:200,body:{account:null,csrfToken:null}};
const teacher={id:'teacher-1',login:'mentor',role:'teacher',studentId:null};
const student={id:'student-2',login:'learner',role:'student',studentId:'michael'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('guest bootstrap reads only /me and leaves private content unloaded',async()=>{
 const app=browser({reply:async()=>guest});
 await app.auth.start();
 assert.deepEqual(app.calls.map(call=>call.url),['/api/auth/me']);
 assert.equal(app.auth.session(),null);
 assert.match(app.main.innerHTML,/Вход/);
});

test('request binds mutation to captured account and rejects a stale owner locally',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:200,body:{ok:true}}});
 await app.auth.start();
 await app.auth.request('/api/students',{method:'POST',body:'{}',expectedAccountId:'teacher-1'});
 const sent=app.calls.at(-1).options;
 assert.equal(sent.credentials,'same-origin');
 assert.equal(sent.headers['X-Mentor-Account'],'teacher-1');
 assert.equal(sent.headers['X-CSRF-Token'],'csrf');
 assert.equal(sent.headers['X-Mentor-Client'],'web');
 assert.equal('expectedAccountId'in sent,false);
 const count=app.calls.length;
 await assert.rejects(app.auth.request('/api/students',{method:'POST',body:'{}',expectedAccountId:'other'}),error=>error.status===409&&error.code==='ACCOUNT_CHANGED');
 assert.equal(app.calls.length,count);
});

test('request preserves Headers supplied by a caller',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:200,body:{ok:true}}});
 await app.auth.start();await app.auth.request('/api/state',{headers:new Headers({'X-Trace':'flow-1'})});
 assert.equal(app.calls.at(-1).options.headers['x-trace'],'flow-1');
});

test('401 clears session and a 409 account change is never retried',async()=>{
 let fail=false;
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:fail?{status:409,body:{error:'Аккаунт изменился.',code:'ACCOUNT_CHANGED'}}:{status:401,body:{error:'Войдите.',code:'UNAUTHORIZED'}}});
 const events=[];app.auth.subscribe(value=>events.push(value?.account.id||null));await app.auth.start();
 await assert.rejects(app.auth.request('/api/state'),error=>error.status===401);
 assert.equal(app.auth.session(),null);
 assert.deepEqual(events,['teacher-1',null]);
 await app.auth.refresh();fail=true;
 const before=app.calls.length;
 await assert.rejects(app.auth.request('/api/students',{method:'POST',body:'{}'}),error=>error.status===409&&error.code==='ACCOUNT_CHANGED');
 assert.equal(app.calls.length,before+1);
});

test('expired session preserves an internal lesson route across a portal login redirect',async()=>{
 const lesson='#students/michael/lessons/library-2026-09-27/student/tasks';
 const app=browser({hash:lesson,reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:url==='/api/state'?{status:401,body:{error:'Войдите.',code:'UNAUTHORIZED'}}:{status:200,body:{account:teacher,csrfToken:'new-csrf'}}});
 app.auth.subscribe(value=>{if(!value)app.auth.showLogin()});
 await app.auth.start();await assert.rejects(app.auth.request('/api/state'),error=>error.status===401);
 assert.equal(app.location.hash,'#login');
 const form={dataset:{authForm:'login'},values:{login:'mentor',password:'secret'},querySelector(){return {textContent:'',hidden:true}},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 await app.listeners.submit({target:form,preventDefault(){}});
 assert.equal(app.location.hash,lesson);
});

test('explicit logout starts the next sign-in at its own account home',async()=>{
 const lesson='#students/michael/lessons/library-2026-09-27/student/tasks';
 const app=browser({hash:lesson,reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:url==='/api/auth/logout'?{status:204,body:null}:{status:200,body:{account:teacher,csrfToken:'new-csrf'}}});
 app.auth.subscribe(value=>{if(!value)app.auth.showLogin()});
 await app.auth.start();await app.auth.logout();
 const form={dataset:{authForm:'login'},values:{login:'mentor',password:'secret'},querySelector(){return {textContent:'',hidden:true}},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 await app.listeners.submit({target:form,preventDefault(){}});
 assert.equal(app.location.hash,'#students');
});

test('wrong current password leaves the active session and form error in place',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:401,body:{error:'Неверный текущий пароль.',code:'INVALID_CREDENTIALS'}}});
 await app.auth.start();app.auth.showPasswordForm();
 const alert={textContent:'',hidden:true},form={dataset:{authForm:'change-password'},values:{currentPassword:'wrong',newPassword:'replacement'},querySelector(){return alert},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 const original=app.main.innerHTML;
 await app.listeners.submit({target:form,preventDefault(){}});
 assert.equal(app.auth.session().account.id,'teacher-1');
 assert.equal(app.main.innerHTML,original);
 assert.equal(alert.hidden,false);assert.match(alert.textContent,/Неверный текущий пароль/);
});

test('wrong teacher confirmation password does not expire the session',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:401,body:{error:'Неверный текущий пароль.',code:'INVALID_CREDENTIALS'}}});
 await app.auth.start();
 await assert.rejects(app.auth.request('/api/students/michael/password-reset',{method:'POST',body:'{"currentPassword":"wrong"}',expectedAccountId:'teacher-1'}),error=>error.status===401&&error.code==='INVALID_CREDENTIALS');
 assert.equal(app.auth.session().account.id,'teacher-1');
});

test('registration token is removed from the fragment before any request and stays out of storage',async()=>{
 const app=browser({hash:'#register/one-time-secret',reply:async()=>guest});
 await app.auth.start();
 assert.equal(app.location.hash,'#register');
 assert.match(app.main.innerHTML,/Регистрация/);
 assert.doesNotMatch(JSON.stringify(app.calls),/one-time-secret/);
});

test('login form uses entered credentials and routes only to an internal student hash',async()=>{
 const app=browser({hash:'#students/michael/lessons/lesson-1/student/tasks',reply:async url=>url==='/api/auth/me'?guest:{status:200,body:{account:teacher,csrfToken:'csrf'}}});
 await app.auth.start();
 const form={dataset:{authForm:'login'},values:{login:'mentor',password:'secret'},querySelector(){return {textContent:'',hidden:true}},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 await app.listeners.submit({target:form,preventDefault(){}});
 assert.equal(JSON.parse(app.calls.at(-1).options.body).password,'secret');
 assert.equal(app.location.hash,'#students/michael/lessons/lesson-1/student/tasks');
 assert.equal(app.auth.session().account.role,'teacher');
});

test('external-looking next value does not navigate outside the app',async()=>{
 const app=browser({hash:'#login',search:'?next=https%3A%2F%2Fevil.example',reply:async url=>url==='/api/auth/me'?guest:{status:200,body:{account:teacher,csrfToken:'csrf'}}});
 await app.auth.start();
 const form={dataset:{authForm:'login'},values:{login:'mentor',password:'secret'},querySelector(){return {textContent:'',hidden:true}},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 await app.listeners.submit({target:form,preventDefault(){}});
 assert.equal(app.location.hash,'#students');
});

test('late login response cannot replace an account discovered by session refresh',async()=>{
 const login=deferred();let latest=guest;
 const app=browser({reply:async url=>url==='/api/auth/me'?latest:login.promise});
 await app.auth.start();
 const form={dataset:{authForm:'login'},values:{login:'mentor',password:'secret'},querySelector(){return {textContent:'',hidden:true}},querySelectorAll(){return [{disabled:false}]},matches(){return true},reportValidity(){return true}};
 const pending=app.listeners.submit({target:form,preventDefault(){}});await tick();
 latest={status:200,body:{account:student,csrfToken:'new-csrf'}};await app.auth.refresh();
 login.resolve({status:200,body:{account:teacher,csrfToken:'old-csrf'}});await pending;
 assert.equal(app.auth.session().account.id,'student-2');
});

test('late 401 from an old request cannot sign out a newly discovered account',async()=>{
 const state=deferred();let latest={status:200,body:{account:teacher,csrfToken:'old-csrf'}};
 const app=browser({reply:async url=>url==='/api/auth/me'?latest:state.promise});
 await app.auth.start();const pending=app.auth.request('/api/state');await tick();
 latest={status:200,body:{account:student,csrfToken:'new-csrf'}};await app.auth.refresh();
 state.resolve({status:401,body:{error:'Войдите.',code:'UNAUTHORIZED'}});
 await assert.rejects(pending,error=>error.status===409&&error.code==='ACCOUNT_CHANGED');
 assert.equal(app.auth.session().account.id,'student-2');
});

test('late logout cannot clear a different account or its draft cache',async()=>{
 const finish=deferred();let latest={status:200,body:{account:teacher,csrfToken:'old-csrf'}};
 const app=browser({reply:async url=>url==='/api/auth/me'?latest:finish.promise});
 const disposals=[];app.window.MENTOR_PRACTICE={beforeLogout:async()=>true,dispose:options=>disposals.push(options)};
 await app.auth.start();const pending=app.auth.logout();await tick();
 latest={status:200,body:{account:student,csrfToken:'new-csrf'}};await app.auth.refresh();
 finish.resolve({status:204,body:null});
 await assert.rejects(pending,error=>error.status===409&&error.code==='ACCOUNT_CHANGED');
 assert.equal(app.auth.session().account.id,'student-2');assert.deepEqual(disposals,[]);
});

test('logout does not POST for a new account while the old owner draft check is pending',async()=>{
 const flush=deferred();let latest={status:200,body:{account:teacher,csrfToken:'old-csrf'}};
 const app=browser({reply:async url=>url==='/api/auth/me'?latest:{status:204,body:null}});
 const disposals=[],cancels=[];app.window.MENTOR_PRACTICE={beforeLogout:()=>flush.promise,cancelLogout:options=>cancels.push(options),dispose:options=>disposals.push(options)};
 await app.auth.start();const pending=app.auth.logout();await tick();
 latest={status:200,body:{account:student,csrfToken:'new-csrf'}};await app.auth.refresh();
 flush.resolve(true);
 await assert.rejects(pending,error=>error.status===409&&error.code==='ACCOUNT_CHANGED');
 assert.equal(app.calls.filter(call=>call.url==='/api/auth/logout').length,0);
 assert.equal(app.auth.session().account.id,'student-2');assert.deepEqual(disposals,[]);
 assert.equal(cancels.length,1);assert.equal(cancels[0].accountId,'teacher-1');
});

test('logout holds the owner editor lock until the server confirms the session ended',async()=>{
 const response=deferred();
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:response.promise});
 let locked=false;const clear=[];
 app.window.MENTOR_PRACTICE={beforeLogout:async()=>{locked=true;return true},cancelLogout(){locked=false},dispose:options=>{clear.push(options);locked=false}};
 await app.auth.start();const pending=app.auth.logout();await tick();
 assert.equal(locked,true);assert.equal(app.calls.at(-1).url,'/api/auth/logout');
 response.resolve({status:204,body:null});assert.equal(await pending,true);
 assert.equal(clear.length,1);assert.equal(clear[0].accountId,'teacher-1');
});

test('failed logout releases only the captured owner lock and keeps the session',async()=>{
 const response=deferred();
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:response.promise});
 let locked=false;const cancels=[];
 app.window.MENTOR_PRACTICE={beforeLogout:async()=>{locked=true;return true},cancelLogout:options=>{cancels.push(options);locked=false},dispose(){throw Error('discarded after failed logout')}};
 await app.auth.start();const pending=app.auth.logout();await tick();assert.equal(locked,true);
 response.resolve({status:503,body:{error:'Сервер недоступен.',code:'UNAVAILABLE'}});
 await assert.rejects(pending,error=>error.status===503);
 assert.equal(locked,false);assert.equal(cancels.length,1);assert.equal(cancels[0].accountId,'teacher-1');
 assert.equal(app.auth.session().account.id,'teacher-1');
});

test('simultaneous logout clicks share one locked operation and one POST',async()=>{
 const response=deferred();let preparations=0,locked=false,cancels=0,disposals=0;
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:response.promise});
 app.window.MENTOR_PRACTICE={beforeLogout:async()=>{preparations++;locked=true;return true},cancelLogout:()=>{cancels++;locked=false},dispose:()=>{disposals++;locked=false}};
 await app.auth.start();
 const first=app.auth.logout(),second=app.auth.logout();await tick();
 assert.equal(preparations,1);assert.equal(app.calls.filter(call=>call.url==='/api/auth/logout').length,1);assert.equal(locked,true);
 response.resolve({status:503,body:{error:'Временно недоступно.',code:'UNAVAILABLE'}});
 await assert.rejects(first,error=>error.status===503);await assert.rejects(second,error=>error.status===503);
 assert.equal(cancels,1);assert.equal(disposals,0);assert.equal(locked,false);
});

test('confirmed logout clears only the captured account cache',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:204,body:null}});
 const disposals=[];app.window.MENTOR_PRACTICE={beforeLogout:async()=>true,dispose:options=>disposals.push(options)};
 await app.auth.start();assert.equal(await app.auth.logout(),true);
 assert.equal(app.auth.session(),null);assert.equal(disposals.length,1);
 assert.equal(disposals[0].clearAccountCache,true);assert.equal(disposals[0].accountId,'teacher-1');
});

test('cancelled logout keeps session and never calls the logout API',async()=>{
 const app=browser({reply:async url=>url==='/api/auth/me'?{status:200,body:{account:teacher,csrfToken:'csrf'}}:{status:204,body:null}});
 app.window.MENTOR_PRACTICE={beforeLogout:async()=>false,dispose(){throw Error('discarded without confirmation')}};
 await app.auth.start();const count=app.calls.length;
 assert.equal(await app.auth.logout(),false);
 assert.equal(app.calls.length,count);assert.equal(app.auth.session().account.id,'teacher-1');
});

test('show password changes only the input type',async()=>{
 const app=browser({reply:async()=>guest});await app.auth.start();
 const input={type:'password',value:'exact-secret'};
 const button={parentElement:{querySelector:()=>input},textContent:'Показать',setAttribute(){}};
 app.listeners.click({target:{closest:selector=>selector==='[data-auth-toggle]'?button:null}});
 assert.equal(input.type,'text');assert.equal(input.value,'exact-secret');
 app.listeners.click({target:{closest:selector=>selector==='[data-auth-toggle]'?button:null}});
 assert.equal(input.type,'password');assert.equal(input.value,'exact-secret');
});

function portalBrowser({session,request,search=''}={}){
 const source=fs.readFileSync(path.join(__dirname,'../dist/portal.js'),'utf8');
 const elements=new Map(),contents=[];let sessionListener;
 const element=()=>({innerHTML:'',textContent:'',dataset:{},open:false,classList:{toggle(){},remove(){}},addEventListener(){},querySelectorAll(){return []},querySelector(){return null},focus(){},setAttribute(){},close(){}});
 const document={body:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelector(){return element()},addEventListener(){}};
 const location={hash:'#students',search};
 const auth={session:()=>session,request,subscribe(fn){sessionListener=fn},start(){sessionListener(session)},showLogin(){document.getElementById('main').innerHTML='<p>login</p>'},showPasswordForm(){}};
 const window={LESSON_UI:{esc:String,setContent(value){contents.push(value)},icon:()=>'',notFound:()=>'<p>missing</p>',heading:()=>'<h1>error</h1>'},MentorRoutes:{parseRoute:()=>({kind:'missing'}),isStudentRoute:()=>false},STUDENT_CABINET:{navigation:()=>''},DOCUMENT_NAVIGATION:{mount(){},goTo(){}},MENTOR_AUTH:auth,MENTOR_PRACTICE:{dispose(){}},addEventListener(){},scrollTo(){}};
 vm.runInNewContext(source,{window,document,location,URLSearchParams,Intl,Date,FormData,requestAnimationFrame:fn=>fn(),console},{filename:'portal.js'});
 return {window,document,contents,change(value){session=value;sessionListener(value)}};
}

test('portal asks for no state or content when session is guest',()=>{
 const calls=[];const app=portalBrowser({session:null,request:path=>{calls.push(path);throw Error('private fetch')}});
 assert.deepEqual(calls,[]);assert.equal(app.document.getElementById('main').innerHTML,'<p>login</p>');
});

test('portal drops late private bootstrap after account switches',async()=>{
 const oldState=deferred(),oldContent=deferred(),snapshot={marker:'new'};
 const app=portalBrowser({session:{account:teacher,csrfToken:'a'},request:(path,options)=>{
  if(options.expectedAccountId==='teacher-1')return path==='/api/state'?oldState.promise:oldContent.promise;
  return Promise.resolve(path==='/api/state'?{students:[],lessons:[]}:snapshot);
 }});
 app.change({account:student,csrfToken:'b'});await tick();
 oldState.resolve({students:[{id:'foreign'}],lessons:[]});oldContent.resolve({marker:'old'});await tick();
 assert.equal(app.contents.at(-1),snapshot);
 assert.doesNotMatch(app.document.getElementById('main').innerHTML,/foreign/);
});
