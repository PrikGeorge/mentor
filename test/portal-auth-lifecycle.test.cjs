const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const routes = require('../dist/portal-model.js');

const teacher = {account:{id:'teacher-1',login:'mentor',role:'teacher',studentId:null},csrfToken:'csrf-teacher'};
const student = {account:{id:'student-1',login:'learner',role:'student',studentId:'s1'},csrfToken:'csrf-student'};
const state = {students:[{id:'s1',name:'Nina',direction:'Java',goal:'Learn',notes:'PRIVATE TEACHER NOTE'}],lessons:[]};
const tick = () => new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}

function portalBrowser({session=teacher,mutation,modelState=state,hash='#students/s1',noteEditor,markdown}={}){
  const elements=new Map(), chrome=new Map(), listeners={}, requests=[], toasts=[];
  const makeElement=()=>({innerHTML:'',textContent:'',dataset:{},href:'',open:false,disabled:false,classList:{toggle(){},remove(){}},addEventListener(){},querySelectorAll(){return []},querySelector(){return null},focus(){},setAttribute(){},removeAttribute(){},append(){}});
  function get(id){
    if(id==='practice-root')return null;
    if(!elements.has(id))elements.set(id,makeElement());
    return elements.get(id);
  }
  const dialog=get('editor-dialog'),dialogListeners={};dialog.addEventListener=(event,fn)=>{dialogListeners[event]=fn};dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false;dialogListeners.close?.()};
  const form=get('editor-form');form.fields=[['name','Nina'],['notes','PRIVATE TEACHER NOTE']];form.reportValidity=()=>true;form.addEventListener=(event,fn)=>{listeners[event]=fn};
  const brand=makeElement();brand.innerHTML='<span>Наставник</span>';brand.href='#students';chrome.set('.brand',brand);
  const foot=makeElement();foot.innerHTML='<span>Рабочий кабинет</span>';chrome.set('.sidebar-foot',foot);
  const footer=makeElement();footer.innerHTML='Кабинет наставника';chrome.set('.site-footer',footer);
  chrome.set('.topbar',makeElement());
  const document={title:'Кабинет наставника',body:makeElement(),getElementById:get,createElement:makeElement,querySelector:selector=>chrome.get(selector)||null,addEventListener:(event,fn)=>{listeners[event]=fn},querySelectorAll:()=>[]};
  const location={hash,search:''};
  let current=session,subscriber;
  const auth={session:()=>current,subscribe:fn=>{subscriber=fn},start:()=>subscriber(current),showLogin(){get('main').innerHTML='<p>Вход</p>'},showPasswordForm(){},request:async(url,options={})=>{requests.push({url,options});if(url==='/api/state')return modelState;if(url==='/api/content')return {docs:{}};return mutation?mutation(url,options):{student:modelState.students[0]}}};
  const window={LESSON_UI:{esc:String,heading:(eyebrow,title,description,actions='')=>`<h1>${title}</h1><p>${description}</p>${actions}`,icon:()=>'',setContent(){},doc:()=>'<p>Prepared content</p>',lesson:()=>'<p>Prepared plan</p>',notFound:()=>'<p>missing</p>',toast:value=>toasts.push(value)},MentorRoutes:routes,STUDENT_CABINET:{navigation:()=>'<nav>Student</nav>',lessonNavigation:()=>'<nav>Lesson</nav>',lessonReview:context=>`<p>${context.lesson.reviewNotes}</p>`,page:()=>'<p>Student dashboard</p>'},DOCUMENT_NAVIGATION:{mount(){},goTo(){}},MENTOR_AUTH:auth,MENTOR_PRACTICE:{dispose(){},mount(){}},MENTOR_ACCOUNT_ACCESS:{dispose(){},mount(){}},addEventListener:(event,fn)=>{listeners[event]=fn},scrollTo(){}};
  class FormDataFake{constructor(target){return target.fields}[Symbol.iterator](){return this.values()[Symbol.iterator]()}}
  window.MENTOR_LESSON_EDITOR=noteEditor;window.MENTOR_MARKDOWN=markdown;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/portal.js'),'utf8'),{window,document,location,URLSearchParams,Intl,Date,FormData:FormDataFake,requestAnimationFrame:fn=>fn(),console},{filename:'portal.js'});
  return {window,document,location,requests,toasts,brand,foot,footer,get,form,dialog,async ready(){await tick();await tick()},change(next){current=next;subscriber(next)},navigate(hash){location.hash=hash;listeners.hashchange()},openEditor(action='edit-student'){const button={dataset:{action},hasAttribute:()=>false};listeners.click({target:{closest:selector=>selector==='button'?button:null}});form.fields=[...get('editor-body').innerHTML.matchAll(/<input name="([^"]+)"[^>]*value="([^"]*)"|<textarea name="([^"]+)"[^>]*>([^<]*)<\/textarea>/g)].map(match=>[match[1]||match[3],match[2]??match[4]])},submit(){return listeners.submit({preventDefault(){},currentTarget:form})}};
}

test('stop clears private editor contents and resets the neutral page title',async()=>{
  const app=portalBrowser();await app.ready();app.openEditor();
  assert.match(app.get('editor-body').innerHTML,/PRIVATE TEACHER NOTE/);
  assert.equal(app.dialog.open,true);
  app.window.MENTOR_PORTAL.stop();
  assert.equal(app.dialog.open,false);
  assert.equal(app.get('editor-body').innerHTML,'');
  assert.equal(app.document.title,'Кабинет наставника');
});

test('late saved editor response cannot close or re-enable a new account form',async()=>{
  const old=deferred(),next=deferred();
  const app=portalBrowser({mutation:(url,options)=>options.expectedAccountId==='teacher-1'?old.promise:next.promise});
  await app.ready();app.openEditor();const first=app.submit();
  app.change(null);await app.ready();
  const replacement={account:{id:'teacher-2',login:'other',role:'teacher',studentId:null},csrfToken:'other'};
  app.change(replacement);await app.ready();app.openEditor();
  app.get('editor-body').innerHTML='NEW OWNER FORM';
  const second=app.submit();
  assert.equal(app.get('save-record').disabled,true);
  old.resolve({student:state.students[0]});await first;
  assert.equal(app.dialog.open,true);
  assert.equal(app.get('editor-body').innerHTML,'NEW OWNER FORM');
  assert.equal(app.get('save-record').disabled,true);
  assert.equal(app.toasts.length,0);
  next.resolve({student:state.students[0]});await second;
});

test('late rejected editor response cannot write an error into a new account form',async()=>{
  const old=deferred();const app=portalBrowser({mutation:()=>old.promise});
  await app.ready();app.openEditor();const first=app.submit();
  app.change(null);await app.ready();
  app.change({account:{id:'teacher-2',login:'other',role:'teacher',studentId:null},csrfToken:'other'});await app.ready();app.openEditor();
  old.reject(new Error('PRIVATE OLD ERROR'));await first;
  assert.equal(app.dialog.open,true);
  assert.doesNotMatch(app.get('form-error').textContent,/PRIVATE OLD ERROR/);
  assert.equal(app.get('editor-body').innerHTML.includes('PRIVATE OLD ERROR'),false);
});

test('student presentation chrome returns to neutral before teacher render',async()=>{
  const app=portalBrowser({session:student});await app.ready();
  assert.match(app.brand.innerHTML,/Nina/);
  assert.doesNotMatch(app.brand.innerHTML,/Мой кабинет/);
  assert.match(app.foot.innerHTML,/Кабинет ученика/);
  assert.match(app.footer.innerHTML,/Кабинет ученика/);
  app.change(null);await app.ready();
  assert.equal(app.brand.innerHTML,'<span>Наставник</span>');
  assert.equal(app.brand.href,'#students');
  assert.equal(app.foot.innerHTML,'<span>Рабочий кабинет</span>');
  assert.equal(app.footer.innerHTML,'Кабинет наставника');
  app.change(teacher);await app.ready();
  assert.equal(app.brand.innerHTML,'<span>Наставник</span>');
  assert.equal(app.footer.innerHTML,'Кабинет наставника');
});

function lessonState(prepared=false){return {students:[{...state.students[0],id:prepared?'michael':'s1'}],lessons:[{id:'l1',studentId:prepared?'michael':'s1',title:'Collections',date:'2026-10-01',time:'12:00',duration:60,status:prepared?'prepared':'planned',bundleId:prepared?'library-2026-09-27':null,teacherNotes:'Teacher plan',studentNotes:'Student tasks',reviewNotes:'Existing review'}]};}

test('new lesson collects only schedule fields and creates under the captured student',async()=>{
  const modelState=lessonState();
  const app=portalBrowser({modelState,mutation:async(url,options)=>{const lesson={id:'new-lesson',studentId:'s1',...JSON.parse(options.body)};modelState.lessons.push(lesson);return {lesson}}});
  await app.ready();app.openEditor('add-lesson');
  assert.deepEqual(app.form.fields.map(([name])=>name),['title','date','time','duration']);
  assert.doesNotMatch(app.get('editor-body').innerHTML,/<textarea/);
  assert.match(app.get('editor-body').innerHTML,/min="15" max="240"/);
  assert.equal(app.form.fields.find(([name])=>name==='date')[1],new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  app.form.fields=[['title','Streams'],['date','2026-10-02'],['time','18:30'],['duration','90']];
  app.navigate('#students');await app.submit();
  const request=app.requests.find(request=>request.options.method==='POST');
  assert.equal(request.url,'/api/students/s1/lessons');
  assert.deepEqual(JSON.parse(request.options.body),{title:'Streams',date:'2026-10-02',time:'18:30',duration:90});
  assert.equal(app.location.hash,'#students/s1/lessons/new-lesson');
  assert.equal(app.dialog.open,false);
});

for(const [mode,field,page,audience] of [
  ['edit-teacher-notes','teacherNotes','guide','teacher'],
  ['edit-student-notes','studentNotes','tasks','student'],
  ['edit-review','reviewNotes','review','teacher']
])test(`${mode} updates only its field and restores the originating lesson section`,async()=>{
  const modelState=lessonState(),origin=`#students/s1/lessons/l1/${audience}/${page}`;
  const app=portalBrowser({modelState,hash:origin,mutation:async(url,options)=>{Object.assign(modelState.lessons[0],JSON.parse(options.body));return {lesson:modelState.lessons[0]}}});
  await app.ready();assert.match(app.get('main').innerHTML,new RegExp(`data-action="${mode}"`));app.openEditor(mode);
  assert.equal(app.dialog.open,true);
  assert.deepEqual(app.form.fields,[[field,modelState.lessons[0][field]]]);
  const before={...modelState.lessons[0]};app.form.fields=[[field,'Updated content']];
  app.navigate('#students/s1');await app.submit();
  const request=app.requests.find(request=>request.options.method==='PATCH');
  assert.equal(request.url,'/api/students/s1/lessons/l1');
  assert.deepEqual(JSON.parse(request.options.body),{[field]:'Updated content'});
  assert.deepEqual(modelState.lessons[0],{...before,[field]:'Updated content'});
  assert.equal(app.location.hash,origin);
  app.navigate(origin);assert.match(app.get('main').innerHTML,/Updated content/);
});

for(const [prepared,mode,field,page,studentId] of [
  [false,'edit-review','reviewNotes','review','s1'],
  [true,'edit-teacher-notes','teacherNotes','guide','michael']
])test(`${mode} rerenders saved content while retaining the same section link`,async()=>{
  const modelState=lessonState(prepared),origin=`#students/${studentId}/lessons/l1/teacher/${page}/section-0`;
  const previous=modelState.lessons[0][field];
  const app=portalBrowser({modelState,hash:origin,mutation:async(url,options)=>{Object.assign(modelState.lessons[0],JSON.parse(options.body));return {lesson:modelState.lessons[0]}}});
  await app.ready();assert.ok(app.get('main').innerHTML.includes(previous));
  app.openEditor(mode);app.form.fields=[[field,'Freshly saved section content']];await app.submit();
  assert.equal(app.location.hash,origin);
  assert.match(app.get('main').innerHTML,/Freshly saved section content/);
  assert.equal(app.get('main').innerHTML.includes(previous),false);
});

test('metadata editing excludes note fields and returns to the overview',async()=>{
  const modelState=lessonState();const app=portalBrowser({modelState,hash:'#students/s1/lessons/l1',mutation:async()=>({lesson:modelState.lessons[0]})});
  await app.ready();app.openEditor('edit-lesson');
  assert.deepEqual(app.form.fields.map(([name])=>name),['title','date','time','duration']);
  await app.submit();assert.equal(app.location.hash,'#students/s1/lessons/l1');
  const request=app.requests.find(request=>request.options.method==='PATCH');
  assert.equal(request.url,'/api/students/s1/lessons/l1');
  assert.deepEqual(JSON.parse(request.options.body),{title:'Collections',date:'2026-10-01',time:'12:00',duration:60});
});

test('failed note save retains the input and permits retry',async()=>{
  const app=portalBrowser({modelState:lessonState(),hash:'#students/s1/lessons/l1/teacher/review',mutation:async()=>{throw new Error('Save unavailable')}});
  await app.ready();app.openEditor('edit-review');app.form.fields=[['reviewNotes','Unsent feedback']];await app.submit();
  assert.equal(app.dialog.open,true);assert.deepEqual(app.form.fields,[['reviewNotes','Unsent feedback']]);
  assert.equal(app.get('form-error').textContent,'Save unavailable');assert.equal(app.get('save-record').disabled,false);
});

test('lesson editors reject missing lesson and student targets',async()=>{
  const app=portalBrowser();await app.ready();
  for(const mode of ['edit-lesson','edit-teacher-notes','edit-student-notes','edit-review','unknown-mode']){app.openEditor(mode);assert.equal(app.dialog.open,false,mode);}
  app.navigate('#students');app.openEditor('add-lesson');assert.equal(app.dialog.open,false);
});

test('prepared lessons expose independent note actions even when their text is empty',async()=>{
  const modelState=lessonState(true);modelState.lessons[0].teacherNotes='';modelState.lessons[0].studentNotes='';
  const app=portalBrowser({modelState,hash:'#students/michael/lessons/l1'});await app.ready();
  assert.doesNotMatch(app.get('main').innerHTML,/data-action="edit-lesson"/);
  app.openEditor('edit-lesson');assert.equal(app.dialog.open,false);
  app.navigate('#students/michael/lessons/l1/teacher/guide');assert.match(app.get('main').innerHTML,/data-action="edit-teacher-notes"/);
  app.navigate('#students/michael/lessons/l1/student/tasks');assert.match(app.get('main').innerHTML,/data-action="edit-student-notes"/);
});

test('new lesson overview offers preparation actions without the empty material panels',async()=>{
  const modelState=lessonState();modelState.lessons[0].teacherNotes='';modelState.lessons[0].studentNotes='';
  const app=portalBrowser({modelState,hash:'#students/s1/lessons/l1'});await app.ready();
  const output=app.get('main').innerHTML;
  assert.match(output,/data-action="edit-teacher-notes"/);assert.match(output,/data-action="edit-student-notes"/);
  assert.match(output,/#students\/s1\/lessons\/l1\/teacher\/practice/);
  assert.doesNotMatch(output,/audience-split/);
});

test('lesson editor receives only its note field and freezes after FormData is captured',async()=>{
  const changes=[],modelState=lessonState();let disposed=0,markupOptions;
  const pending=deferred();
  const noteEditor={markup:options=>{markupOptions=options;return `<textarea name="${options.name}">${options.value}</textarea>`},mount:(root,options)=>{assert.equal(typeof options.render,'function');return {dispose(){disposed++},setBusy(value){changes.push(value);if(value)app.form.fields=[]}}}};
  const app=portalBrowser({modelState,hash:'#students/s1/lessons/l1',noteEditor,markdown:{render:value=>`<p>${value}</p>`},mutation:()=>pending.promise});
  await app.ready();app.openEditor('edit-student-notes');
  assert.equal(markupOptions.name,'studentNotes');
  app.form.fields=[['studentNotes','## Новое задание']];
  const saving=app.submit();assert.deepEqual(changes,[true]);
  const request=app.requests.find(x=>x.options.method==='PATCH');
  assert.deepEqual(JSON.parse(request.options.body),{studentNotes:'## Новое задание'});
  pending.reject(new Error('Попробуйте ещё раз'));await saving;
  assert.deepEqual(changes,[true,false]);assert.equal(disposed,0);
  app.dialog.close();assert.equal(disposed,1);
});

test('account changes dispose the mounted note editor before another account can open it',async()=>{
  let disposed=0;
  const noteEditor={markup:()=>'<textarea name="reviewNotes"></textarea>',mount:()=>({dispose(){disposed++},setBusy(){}})};
  const app=portalBrowser({modelState:lessonState(),hash:'#students/s1/lessons/l1',noteEditor,markdown:{render:String}});
  await app.ready();app.openEditor('edit-review');app.change(null);await app.ready();
  assert.equal(disposed,1);assert.equal(app.dialog.open,false);assert.equal(app.get('editor-body').innerHTML,'');
});

test('lesson notes use the shared renderer for both teacher and student content',async()=>{
  const app=portalBrowser({modelState:lessonState(),hash:'#students/s1/lessons/l1/teacher/guide',markdown:{render:value=>`<p data-rendered>${value}</p>`}});
  await app.ready();assert.match(app.get('main').innerHTML,/<p data-rendered>/);
  app.navigate('#students/s1/lessons/l1/student/tasks');assert.match(app.get('main').innerHTML,/<p data-rendered>/);
});
