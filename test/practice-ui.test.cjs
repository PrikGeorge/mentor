const test = require('node:test');
const assert = require('node:assert/strict');
const {createDraftSession, getDraftSession, formatError, validateUpload, allowedFiles, resultMarkup} = require('../dist/practice.js');

function storage() {
  const values = new Map();
  return {get length(){return values.size;},key:index=>[...values.keys()][index] || null,getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
const starter = {'Main.java': 'class Main {}', 'book/Book.java': 'package book; class Book {}'};
function draft(options = {}) { return createDraftSession({key:'test', accountId:'owner-1', exerciseRevision:'v1', starterFiles:starter, storage:storage(), send:async body => ({draft:{files:body.files, revision:body.revision + 1}}), ...options}); }

test('recovery belongs to its account and never claims an anonymous legacy backup', () => {
  const disk=storage();
  disk.setItem('mentor.practice.draft.test',JSON.stringify({files:{...starter,'Main.java':'anonymous code'},revision:0,exerciseRevision:'v1',dirty:true}));
  const first=draft({storage:disk,accountId:'owner-1'});
  assert.equal(first.snapshot().files['Main.java'],starter['Main.java']);
  first.edit('Main.java','owner one code');
  assert.ok(disk.getItem('mentor.practice.draft.owner-1.test'));
  assert.equal(draft({storage:disk,accountId:'owner-2'}).snapshot().files['Main.java'],starter['Main.java']);
  assert.equal(draft({storage:disk,accountId:'owner-1'}).snapshot().files['Main.java'],'owner one code');
  assert.ok(disk.getItem('mentor.practice.draft.test'));
});

test('session change freezes an unsaved draft and prevents later flush and editing', async () => {
  const disk=storage(); let active=true, sent=0;
  const state=draft({storage:disk,isOwnerActive:()=>active,send:async()=>{sent++; throw new Error('must not send');}});
  state.edit('Main.java','owner work'); active=false;
  assert.equal(await state.flush(),false);
  state.edit('Main.java','other user input');
  assert.equal(sent,0);
  assert.equal(state.snapshot().files['Main.java'],'owner work');
  assert.equal(state.snapshot().status,'frozen');
  assert.ok(disk.getItem('mentor.practice.draft.owner-1.test'));
});

test('401 and ACCOUNT_CHANGED freeze rather than retry a mutation', async () => {
  for (const failure of [{status:401,code:'UNAUTHORIZED'},{status:409,code:'ACCOUNT_CHANGED'}]) {
    let sent=0;
    const state=draft({send:async()=>{sent++;throw Object.assign(new Error('session changed'),failure);}});
    state.edit('Main.java','owner work');
    assert.equal(await state.flush(),false);
    assert.equal(await state.flush(),false);
    assert.equal(sent,1);
    assert.equal(state.snapshot().status,'frozen');
    assert.equal(state.snapshot().files['Main.java'],'owner work');
  }
});

test('confirmed logout removes only the recovery version owned by that view', () => {
  const disk=storage(), first=draft({storage:disk});
  first.edit('Main.java','old version');
  const second=draft({storage:disk}); second.edit('Main.java','newer tab');
  first.discardRecovery();
  assert.equal(draft({storage:disk}).snapshot().files['Main.java'],'newer tab');
  second.discardRecovery();
  assert.equal(disk.getItem('mentor.practice.draft.owner-1.test'),null);
});

test('logout does not delete a recovered record written by another tab', () => {
  const disk=storage(), otherTab=draft({storage:disk});
  otherTab.edit('Main.java','other tab backup');
  const recovered=draft({storage:disk});
  recovered.discardRecovery();
  assert.equal(draft({storage:disk}).snapshot().files['Main.java'],'other tab backup');
});

test('logout does not delete a newer reset backup from another tab', async () => {
  const disk=storage(), first=draft({storage:disk}), second=draft({storage:disk});
  await first.reset();
  await second.reset();
  first.discardRecovery();
  assert.ok(disk.getItem('mentor.practice.draft.owner-1.test.previous'));
});

function browserPractice(account, response, options={}) {
  const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
  const disk=storage(), calls=[], links=[], downloads=[], listeners=[];
  for (const [key,value] of options.storageEntries || []) disk.setItem(key,value);
  let currentAccount=account;
  const controls=new Map();
  const element=()=>({value:'',innerHTML:'',textContent:'',className:'',hidden:false,disabled:false,readOnly:false,addEventListener(){},setAttribute(){},updateOptions(){},append(){},click(){links.push('download');},remove(){}});
  const container={innerHTML:'',classList:{add(){}},addEventListener(){},removeEventListener(){},contains(){return true;},querySelector(selector){if(!controls.has(selector)) controls.set(selector,element()); return controls.get(selector);},querySelectorAll(){return [];}};
  const model=source=>({source,getValue(){return this.source;},setValue(value){this.source=value;},onDidChangeContent(){},dispose(){}});
  const window={document:{currentScript:null,body:{append(){}},createElement:()=>element()},location:{href:options.href || 'http://localhost/'},localStorage:disk,addEventListener(){},setTimeout,clearTimeout,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:local';},revokeObjectURL(){}},monaco:{editor:{createModel:model,defineTheme(){},create:()=>({addCommand(){},updateOptions(){},dispose(){},setModel(){},saveViewState(){},restoreViewState(){}})},KeyMod:{CtrlCmd:1},KeyCode:{Enter:2,KeyS:3}},MENTOR_AUTH:{session:()=>currentAccount?{account:currentAccount}:null,subscribe:listener=>{listeners.push(listener);return()=>{const at=listeners.indexOf(listener);if(at>=0)listeners.splice(at,1);};},request:async(path,opts)=>{calls.push({path,opts});return typeof response==='function'?response(path,opts):response;}},prompt:options.prompt || (()=>'cancel'),confirm:()=>true};
  class BrowserFormData { constructor(form){this.fields=form.fields;} get(name){return this.fields[name] ?? null;} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/practice.js'),'utf8'),{window,URL,AbortController,TextEncoder,Blob,FormData:BrowserFormData,console});
  return {window,container,disk,calls,links,downloads,controls,changeAccount(next){currentAccount=next;for(const listener of [...listeners])listener(next?{account:next}:null);}};
}

const browserExercise={id:'java-one',title:'Java one',statement:'Solve it',starterFiles:{'Main.java':'class Main {}'},revision:'v1',placement:'class',attempts:[]};
const browserData={exercises:[browserExercise],submissions:[],runner:{available:true,message:'Ready'}};

const teacherRoute={studentId:'s1',lessonId:'l1',page:'practice'};
function attempt(id,exerciseRevision='v1',mode='submit',status='accepted') {
  return {id,exerciseRevision,mode,createdAt:'2026-09-30T12:00:00Z',result:{status,passed:status==='accepted'?2:1,total:2,tests:[]}};
}
function teacherPractice(data,catalog=data.exercises,respond=()=>undefined) {
  const app=browserPractice({id:'teacher-1',role:'teacher'},(path,opts)=>{
    if(path==='/api/practice/catalog') return {exercises:catalog};
    const answer=respond(path,opts);
    return answer===undefined?data:answer;
  });
  // The real renderer supplies the target attributes. Retain each rendered node's
  // identity so a delayed request cannot write into a replacement task list.
  let html='', taskHTML='', targets=[];
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const collect=value=>{targets=[...value.matchAll(/<div data-practice-attempt-detail data-exercise="([^"]*)"><\/div>/g)].map(match=>({dataset:{exercise:decode(match[1])},innerHTML:'',focusCount:0,scrollCount:0,focus(){this.focusCount++;},scrollIntoView(){this.scrollCount++;}}));};
  Object.defineProperty(app.container,'innerHTML',{get:()=>html,set:value=>{html=value;taskHTML=value;collect(value);}});
  const tasks={get innerHTML(){return taskHTML;},set innerHTML(value){taskHTML=value;collect(value);}};
  app.controls.set('[data-practice-teacher-tasks]',tasks);
  app.container.querySelectorAll=selector=>selector==='[data-practice-attempt-detail]'?targets:[];
  return {...app,tasks,targets:()=>targets};
}
function assignmentSubmitEvent(fields) {
  const status={textContent:'',className:''}, submit={disabled:false}, selects=Object.entries(fields).map(([name,value])=>({name,value,disabled:false}));
  const form={dataset:{practiceForm:'assignments'},fields,elements:[...selects,submit],querySelector:selector=>selector==='[type="submit"]'?submit:status};
  return {form,status,submit,selects,event:{target:{closest:()=>form},preventDefault(){}}};
}
function practiceClick(action,fields={}) { return {target:{closest:()=>({dataset:{practiceAction:action,...fields},disabled:false})}}; }
function renderedTask(html,id) {
  const card=[...html.matchAll(/<article class="practice-teacher-task" data-practice-teacher-task="([^"]*)">([\s\S]*?)<\/article>/g)].find(match=>match[1]===id);
  assert.ok(card,'assigned task must render its own card: '+id);
  return card[2];
}

test('teacher task learning status only accepts a full check of the current revision and keeps all history', async () => {
  const exercises=[
    {...browserExercise,id:'solved',attempts:[attempt('latest-failure','v1','submit','wrong_answer'),attempt('accepted-current')]},
    {...browserExercise,id:'samples',attempts:[attempt('samples-only','v1','run')]},
    {...browserExercise,id:'old',revision:'v2',attempts:[attempt('accepted-old')]},
    {...browserExercise,id:'fresh',attempts:[]}
  ];
  const app=teacherPractice({...browserData,exercises}), view=app.window.MENTOR_PRACTICE.mount(app.container,teacherRoute); await view.ready;
  const solved=renderedTask(app.container.innerHTML,'solved'), samples=renderedTask(app.container.innerHTML,'samples'), old=renderedTask(app.container.innerHTML,'old'), fresh=renderedTask(app.container.innerHTML,'fresh');
  assert.match(solved,/Решено/);
  assert.match(solved,/Есть ошибки в решении/);
  assert.match(solved,/data-attempt="latest-failure">Код и результат/);
  assert.match(samples,/Примеры пройдены/);
  assert.doesNotMatch(samples,/Решено/);
  assert.match(old,/Попытки прошлой версии/);
  assert.match(old,/Для текущей версии попыток пока нет/);
  assert.doesNotMatch(old,/Решено|>Код и результат</);
  assert.match(fresh,/Не начато/);
  assert.match(fresh,/Попыток пока нет/);
  assert.doesNotMatch(fresh,/practice-teacher-history/);
  for(const [id,card] of [['solved',solved],['samples',samples],['old',old],['fresh',fresh]]) {
    assert.match(card,new RegExp('data-practice-attempt-detail data-exercise="'+id+'"'));
    if(id!=='fresh') assert.match(card,/<details class="practice-teacher-history"><summary>/);
    assert.match(card,new RegExp('href="#students/s1/lessons/l1/teacher/practice/'+id+'">Условие и код'));
  }
  assert.match(old,/data-attempt="accepted-old"/);
  assert.match(solved,/data-attempt="accepted-current"/);
  assert.ok(app.container.innerHTML.indexOf('data-practice-teacher-tasks')<app.container.innerHTML.indexOf('data-practice-form="assignments"'));
  assert.match(app.container.innerHTML,/<details class="practice-panel practice-assignment-editor"><summary>/);
});

test('teacher empty lesson opens the complete assignment catalog and links to pending homework review', async () => {
  const app=teacherPractice({...browserData,exercises:[],submissions:[{...reviewedHomework,status:'submitted'},{...reviewedHomework,id:'reviewed',status:'reviewed'},reviewedHomework]},[browserExercise]);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,teacherRoute); await view.ready;
  assert.match(app.container.innerHTML,/Задачи пока не назначены/);
  assert.match(app.container.innerHTML,/<details class="practice-panel practice-assignment-editor" open><summary>/);
  assert.match(app.container.innerHTML,/name="java-one"/);
  assert.match(app.container.innerHTML,/href="#students\/s1\/lessons\/l1\/teacher\/review"/);
  assert.match(app.container.innerHTML,/Ожидает проверки: 1/);
  assert.doesNotMatch(app.container.innerHTML,/data-practice-form="review"|data-practice-submission-card/);
});

test('teacher attempt results stay inside their task, switching and closing invalidate delayed responses and exports', async () => {
  const first=deferred(), second=deferred(), third=deferred();
  const exercises=[{...browserExercise,attempts:[attempt('one'),attempt('older')]},{...browserExercise,id:'task-two',attempts:[attempt('two')]}];
  const app=teacherPractice({...browserData,exercises},exercises,path=>path.endsWith('/attempts/one')?first.promise:path.endsWith('/attempts/two')?second.promise:path.endsWith('/attempts/older')?third.promise:undefined);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,teacherRoute); await view.ready;
  assert.equal(app.targets().length,2,'each assigned task needs its own attempt detail target');
  const [one,two]=app.targets();
  const loadingOne=view.openAttempt('java-one','one');
  assert.match(one.innerHTML,/Загружаем код/);
  const loadingTwo=view.openAttempt('task-two','two');
  assert.equal(one.innerHTML,'');
  second.resolve({attempt:{...attempt('two'),files:{'Main.java':'second source'}}}); await loadingTwo;
  first.resolve({attempt:{...attempt('one'),files:{'Main.java':'first source'}}}); await loadingOne;
  assert.equal(one.innerHTML,'');
  assert.match(two.innerHTML,/second source/);
  assert.equal(two.focusCount,1,'opening a result moves keyboard focus to its inline region');
  assert.equal(two.scrollCount,1,'history selections reveal the result above the history');
  await view.onClick(practiceClick('export-attempt'));
  assert.equal(await app.downloads[0].text(),'second source');
  const trigger={focusCount:0,focus(){this.focusCount++;}};
  const loadingThird=view.openAttempt('java-one','older',trigger);
  await view.onClick(practiceClick('export-attempt'));
  assert.equal(app.downloads.length,1,'a loading result cannot export the previously selected task');
  assert.match(one.innerHTML,/data-practice-action="close-attempt"/);
  await view.onClick(practiceClick('close-attempt'));
  assert.equal(trigger.focusCount,1,'closing restores focus to the result trigger');
  third.resolve({attempt:{...attempt('older'),files:{'Main.java':'closed source'}}}); await loadingThird;
  assert.equal(one.innerHTML,'');
  assert.equal(two.innerHTML,'');
  await view.onClick(practiceClick('export-attempt'));
  assert.equal(app.downloads.length,1);
});

test('saved assignments refresh task cards and invalidate an open or loading result without replacing the form', async () => {
  const delayed=deferred(), save=deferred(), next={...browserExercise,id:'task-two',title:'Next task',placement:'homework'};
  const initial={...browserData,exercises:[{...browserExercise,attempts:[attempt('one')]}]};
  const app=teacherPractice(initial,[browserExercise,next],(path,opts)=>opts.method==='POST'?save.promise:path.endsWith('/attempts/one')?delayed.promise:undefined);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,teacherRoute); await view.ready;
  const oldTarget=app.targets()[0], opening=view.openAttempt('java-one','one');
  const submission=assignmentSubmitEvent({'java-one':'','task-two':'homework'}), saving=view.onSubmit(submission.event);
  assert.ok(submission.selects.every(control=>control.disabled));
  save.resolve({...browserData,exercises:[next]}); await saving;
  assert.match(renderedTask(app.tasks.innerHTML,'task-two'),/Домашняя практика/);
  assert.doesNotMatch(app.tasks.innerHTML,/data-practice-teacher-task="java-one"/);
  assert.equal(submission.status.textContent,'Назначения сохранены.');
  assert.deepEqual(submission.selects.map(control=>[control.value,control.disabled]),[['',false],['homework',false]]);
  assert.deepEqual(JSON.parse(app.calls.find(call=>call.opts.method==='POST').opts.body),{assignments:[{exerciseId:'task-two',placement:'homework'}]});
  delayed.resolve({attempt:{...attempt('one'),files:{'Main.java':'removed task source'}}}); await opening;
  assert.equal(oldTarget.innerHTML,'');
  await view.onClick(practiceClick('export-attempt'));
  assert.equal(app.downloads.length,0);
  await view.openAttempt('java-one','one');
  assert.equal(app.calls.filter(call=>call.path.endsWith('/attempts/one')).length,1);
});

test('failed assignments retain task cards and selected catalog values for retry', async () => {
  const app=teacherPractice(browserData,[browserExercise],(path,opts)=>opts.method==='POST'?Promise.reject(new TypeError('offline')):undefined);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,teacherRoute); await view.ready;
  const before=app.tasks.innerHTML, submission=assignmentSubmitEvent({'java-one':'homework'});
  await view.onSubmit(submission.event);
  assert.equal(app.tasks.innerHTML,before);
  assert.equal(submission.selects[0].value,'homework');
  assert.equal(submission.selects[0].disabled,false);
  assert.match(submission.status.textContent,/сервер/);
  assert.equal(view.data.exercises[0].placement,'class');
});

test('teacher preview returns to lesson practice while student presentation returns to tasks', async () => {
  for(const presentation of [false,true]) {
    const app=browserPractice({id:'teacher-1',role:'teacher'},browserData);
    const view=app.window.MENTOR_PRACTICE.mount(app.container,{...teacherRoute,exerciseId:'java-one',presentation}); await view.ready;
    assert.match(app.container.innerHTML,presentation?/href="#students\/s1\/lessons\/l1\/student\/tasks"/:/href="#students\/s1\/lessons\/l1\/teacher\/practice"/);
  }
});

const reviewedHomework={id:'work-one',filename:'lesson-one.zip',size:2048,createdAt:'2026-09-29T12:00:00Z',status:'needs_revision',feedback:'Добавьте проверку пустого ввода.',reviewedAt:'2026-09-30T12:00:00Z',comment:'Моё решение',repositoryUrl:'https://example.test/lesson-one'};
function reviewSubmitEvent() {
  const status={textContent:'',className:''}, submit={disabled:false}, card={replacement:null,replaceWith(value){this.replacement=value;}};
  const form={dataset:{practiceForm:'review',submission:'work-one'},fields:{feedback:'  Теперь всё верно.  ',status:'reviewed'},elements:[submit],querySelector(selector){return selector==='[type="submit"]'?submit:status;},closest(){return card;}};
  return {form,status,card,event:{target:{closest:()=>form},preventDefault(){}}};
}

test('lesson review shows feedback and downloads without practice or editing controls for students and teacher previews', async () => {
  for (const [account,presentation] of [[{id:'student-1',role:'student'},false],[{id:'teacher-1',role:'teacher'},true]]) {
    const app=browserPractice(account,{...browserData,submissions:[reviewedHomework]});
    const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'review',presentation});
    await view.ready;
    assert.match(app.container.innerHTML,/Ревью сданных работ/);
    assert.match(app.container.innerHTML,/Нужна доработка/);
    assert.match(app.container.innerHTML,/Добавьте проверку пустого ввода\./);
    assert.match(app.container.innerHTML,/href="\/api\/students\/s1\/lessons\/l1\/homework\/work-one\/file" download/);
    assert.doesNotMatch(app.container.innerHTML,/Java one|practice-cards|data-practice-form=|Назначить упражнения|Сдать домашнюю работу/);
    assert.deepEqual(app.calls.map(call=>call.path),['/api/students/s1/lessons/l1/practice']);
    app.window.MENTOR_PRACTICE.dispose();
  }
});

test('lesson review loads submissions from the selected lesson after navigation', async () => {
  const app=browserPractice({id:'student-1',role:'student'},path=>({
    ...browserData,submissions:[path==='/api/students/s1/lessons/l1/practice'?reviewedHomework:{...reviewedHomework,id:'work-two',filename:'lesson-two.zip',feedback:'Разбор второго занятия.'}]
  }));
  let view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'review'}); await view.ready;
  assert.match(app.container.innerHTML,/lesson-one.zip/);
  view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l2',page:'review'}); await view.ready;
  assert.match(app.container.innerHTML,/lesson-two.zip/);
  assert.match(app.container.innerHTML,/Разбор второго занятия/);
  assert.doesNotMatch(app.container.innerHTML,/lesson-one.zip|Добавьте проверку пустого ввода/);
  assert.deepEqual(app.calls.map(call=>call.path),['/api/students/s1/lessons/l1/practice','/api/students/s1/lessons/l2/practice']);
  app.window.MENTOR_PRACTICE.dispose();
});

test('empty lesson review states that no work has been submitted without implying completed feedback', async () => {
  for (const account of [{id:'student-1',role:'student'},{id:'teacher-1',role:'teacher'}]) {
    const app=browserPractice(account,browserData);
    const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'review'}); await view.ready;
    assert.match(app.container.innerHTML,/По этому занятию ещё нет сданных работ/);
    assert.doesNotMatch(app.container.innerHTML,/Проверено|data-practice-form=|practice-cards/);
    app.window.MENTOR_PRACTICE.dispose();
  }
});

test('homework retains upload and submission status with a link to lesson review', async () => {
  const app=browserPractice({id:'student-1',role:'student'},{...browserData,submissions:[reviewedHomework]});
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'homework',presentation:true}); await view.ready;
  assert.match(app.container.innerHTML,/data-practice-form="upload"/);
  assert.match(app.container.innerHTML,/Нужна доработка/);
  assert.match(app.container.innerHTML,/href="#students\/s1\/lessons\/l1\/student\/review">Ревью по занятию →/);
  app.window.MENTOR_PRACTICE.dispose();
});

test('student and teacher preview review callbacks never submit feedback', async () => {
  for (const [account,presentation] of [[{id:'student-1',role:'student'},false],[{id:'teacher-1',role:'teacher'},true]]) {
    const app=browserPractice(account,{...browserData,submissions:[reviewedHomework]});
    const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'review',presentation}); await view.ready;
    await view.onSubmit(reviewSubmitEvent().event);
    assert.equal(app.calls.filter(call=>call.opts && call.opts.method).length,0);
    app.window.MENTOR_PRACTICE.dispose();
  }
});

test('teacher lesson review saves feedback through the lesson endpoint and replaces only the reviewed submission', async () => {
  const reviewed={...reviewedHomework,status:'reviewed',feedback:'Теперь всё верно.'};
  const app=browserPractice({id:'teacher-1',role:'teacher'},(path,opts)=>opts && opts.method==='PATCH'?{submission:reviewed}:{...browserData,submissions:[reviewedHomework,{...reviewedHomework,id:'work-other',filename:'other.zip'}]});
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'review',presentation:false}); await view.ready;
  assert.match(app.container.innerHTML,/data-practice-form="review" data-submission="work-one"/);
  assert.doesNotMatch(app.container.innerHTML,/data-practice-form="assignments"|practice-cards|Сдать домашнюю работу/);
  assert.deepEqual(app.calls.map(call=>call.path),['/api/students/s1/lessons/l1/practice']);
  const untouched=app.container.innerHTML, submission=reviewSubmitEvent(), created=[];
  app.window.document.createElement=tag=>{
    const element={innerHTML:'',setAttribute(){},append(note){this.note=note;}};
    if(tag==='template') element.content={querySelector:()=>({html:element.innerHTML,append(note){this.note=note;}})};
    created.push(element); return element;
  };
  await view.onSubmit(submission.event);
  const mutation=app.calls.find(call=>call.opts && call.opts.method==='PATCH');
  assert.equal(mutation.path,'/api/students/s1/lessons/l1/homework/work-one');
  assert.equal(mutation.opts.expectedAccountId,'teacher-1');
  assert.deepEqual(JSON.parse(mutation.opts.body),{status:'reviewed',feedback:'Теперь всё верно.'});
  assert.equal(app.container.innerHTML,untouched,'saving one card must preserve the other open review forms');
  assert.match(submission.card.replacement.html,/Теперь всё верно\./);
  assert.match(submission.card.replacement.html,/Проверено/);
  assert.doesNotMatch(submission.card.replacement.html,/other.zip/);
  assert.equal(submission.card.replacement.note.textContent,'Ревью сохранено.');
  assert.equal(view.data.submissions.find(item=>item.id==='work-one').status,'reviewed');
  app.window.MENTOR_PRACTICE.dispose();
});

test('teacher preview is read-only from session role even on a student presentation route', async () => {
  const app=browserPractice({id:'teacher-1',role:'teacher'},browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one',presentation:true});
  await view.ready;
  assert.match(app.container.innerHTML,/Только просмотр/);
  assert.equal(view.draft,undefined);
  assert.equal(app.disk.getItem('mentor.practice.draft.teacher-1.s1/l1/java-one'),null);
  await view.run('submit');
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method).length,0);
});

test('student draft mutations carry captured account identity and freeze when auth changes', async () => {
  const app=browserPractice({id:'student-1',role:'student'},(path,opts)=>opts && opts.method==='PATCH'?{draft:{files:JSON.parse(opts.body).files,revision:1,exerciseRevision:'v1'}}:browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one',presentation:false});
  await view.ready;
  view.draft.edit('Main.java','my answer');
  await view.draft.flush();
  const mutation=app.calls.find(call=>call.opts && call.opts.method==='PATCH');
  assert.equal(mutation.opts.expectedAccountId,'student-1');
  assert.equal(view.draft.snapshot().status,'saved');
});

test('a new account cannot see the previous owner draft and the owner can recover it later', async () => {
  const app=browserPractice({id:'student-1',role:'student'},browserData);
  const route={studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'};
  const first=app.window.MENTOR_PRACTICE.mount(app.container,route); await first.ready;
  first.draft.edit('Main.java','private work');
  app.changeAccount({id:'student-2',role:'student'});
  assert.equal(first.draft.snapshot().status,'frozen');
  assert.equal(await first.draft.flush(),false);
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method).length,0);
  app.window.MENTOR_PRACTICE.dispose();
  const second=app.window.MENTOR_PRACTICE.mount(app.container,route); await second.ready;
  assert.equal(second.draft.snapshot().files['Main.java'],'class Main {}');
  app.changeAccount({id:'student-1',role:'student'});
  app.window.MENTOR_PRACTICE.dispose();
  const restored=app.window.MENTOR_PRACTICE.mount(app.container,route); await restored.ready;
  assert.equal(restored.draft.snapshot().files['Main.java'],'private work');
});

test('late save reply after account change cannot mark the old draft as saved', async () => {
  const reply=deferred();
  const app=browserPractice({id:'student-1',role:'student'},(path,opts)=>opts && opts.method==='PATCH'?reply.promise:browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'});
  await view.ready;
  view.draft.edit('Main.java','owner work');
  const saving=view.draft.flush();
  app.changeAccount({id:'student-2',role:'student'});
  reply.resolve({draft:{files:{'Main.java':'owner work'},revision:1,exerciseRevision:'v1'}});
  assert.equal(await saving,false);
  assert.equal(view.draft.snapshot().status,'frozen');
  assert.equal(view.draft.snapshot().revision,0);
  assert.ok(app.disk.getItem('mentor.practice.draft.student-1.s1/l1/java-one'));
});

test('failed logout save offers cancellation and preserves unsaved recovery', async () => {
  const app=browserPractice({id:'student-1',role:'student'},(path,opts)=>opts && opts.method==='PATCH'?Promise.reject(new TypeError('offline')):browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'});
  await view.ready;
  view.draft.edit('Main.java','unsaved answer');
  assert.equal(await app.window.MENTOR_PRACTICE.beforeLogout(),false);
  assert.equal(view.draft.snapshot().files['Main.java'],'unsaved answer');
  assert.ok(app.disk.getItem('mentor.practice.draft.student-1.s1/l1/java-one'));
  view.draft.edit('Main.java','editing after cancellation');
  assert.equal(view.draft.snapshot().files['Main.java'],'editing after cancellation');
});

test('logout locks edits before flush, through delayed POST, and unlocks after failure', async () => {
  const save=deferred();
  const app=browserPractice({id:'student-1',role:'student'},(path,opts)=>opts && opts.method==='PATCH'?save.promise:browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'}); await view.ready;
  view.draft.edit('Main.java','saved at logout');
  const preparing=app.window.MENTOR_PRACTICE.beforeLogout();
  view.draft.edit('Main.java','typed during flush');
  assert.equal(view.draft.snapshot().files['Main.java'],'saved at logout');
  save.resolve({draft:{files:{'Main.java':'saved at logout'},revision:1,exerciseRevision:'v1'}});
  assert.equal(await preparing,true);
  assert.equal(view.draft.snapshot().locked,true);
  assert.equal(app.controls.get('[data-practice-code]').readOnly,true);
  view.draft.edit('Main.java','typed during logout POST');
  await view.run('submit');
  assert.equal(view.draft.snapshot().files['Main.java'],'saved at logout');
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method==='POST').length,0);
  app.window.MENTOR_PRACTICE.cancelLogout({accountId:'student-1'});
  assert.equal(view.draft.snapshot().locked,false);
  view.draft.edit('Main.java','editing after failed logout');
  assert.equal(view.draft.snapshot().files['Main.java'],'editing after failed logout');
});

test('pending logout refuses teacher mutations and cancellation restores them', async () => {
  const app=browserPractice({id:'teacher-1',role:'teacher'},browserData);
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice'}); await view.ready;
  assert.equal(await app.window.MENTOR_PRACTICE.beforeLogout(),true);
  await assert.rejects(view.request('/api/students/s1/lessons/l1/practice/assignments',{method:'POST',body:'{}'}));
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method==='POST').length,0);
  app.window.MENTOR_PRACTICE.cancelLogout({accountId:'teacher-1'});
  await view.request('/api/students/s1/lessons/l1/practice/assignments',{method:'POST',body:'{}'});
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method==='POST').length,1);
});

test('logout export choice downloads unsaved code and confirmed disposal compares recovery before removal', async () => {
  const app=browserPractice({id:'student-1',role:'student'},(path,opts)=>opts && opts.method==='PATCH'?Promise.reject(new TypeError('offline')):browserData,{prompt:()=> 'скачать'});
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'});
  await view.ready;
  view.draft.edit('Main.java','unsaved answer');
  assert.equal(await app.window.MENTOR_PRACTICE.beforeLogout(),true);
  assert.equal(app.links.length,1);
  assert.equal(await view.draft.flush(),false,'save shortcuts cannot send another mutation while logout is pending');
  assert.equal(app.calls.filter(call=>call.opts && call.opts.method==='PATCH').length,1);
  app.window.MENTOR_PRACTICE.dispose({clearAccountCache:true,accountId:'student-1'});
  assert.equal(app.disk.getItem('mentor.practice.draft.student-1.s1/l1/java-one'),null);
});

test('logging out the new account never clears old owner recovery when it has not opened practice', async () => {
  const app=browserPractice({id:'student-1',role:'student'},browserData);
  const route={studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'};
  const first=app.window.MENTOR_PRACTICE.mount(app.container,route); await first.ready;
  first.draft.edit('Main.java','owner one private work');
  app.changeAccount({id:'student-2',role:'student'});
  app.window.MENTOR_PRACTICE.dispose();
  app.window.MENTOR_PRACTICE.dispose({clearAccountCache:true,accountId:'student-2'});
  assert.equal(app.disk.getItem('mentor.practice.draft.student-1.s1/l1/java-one') !== null,true);
});

test('captured logout owner cleanup leaves another active account view and recovery intact', async () => {
  const app=browserPractice({id:'student-1',role:'student'},browserData);
  const route={studentId:'s1',lessonId:'l1',page:'practice',exerciseId:'java-one'};
  const first=app.window.MENTOR_PRACTICE.mount(app.container,route); await first.ready;
  first.draft.edit('Main.java','owner one private work');
  app.changeAccount({id:'student-2',role:'student'});
  const second=app.window.MENTOR_PRACTICE.mount(app.container,route); await second.ready;
  second.draft.edit('Main.java','owner two private work');
  app.window.MENTOR_PRACTICE.dispose({clearAccountCache:true,accountId:'student-1'});
  assert.equal(second.alive,true);
  assert.ok(app.disk.getItem('mentor.practice.draft.student-2.s1/l1/java-one'));
  assert.equal(app.disk.getItem('mentor.practice.draft.student-1.s1/l1/java-one'),null);
});

test('local teacher practice exports unclaimed legacy code without tagged account drafts', async () => {
  const legacy='mentor.practice.draft.s1/l1/java-one';
  const tagged='mentor.practice.draft.student-2.s1/l1/java-one';
  const app=browserPractice({id:'teacher-1',role:'teacher'},browserData,{storageEntries:[
    ['mentor.practice.draft.corrupt/old/task','{broken-json'],
    [legacy,JSON.stringify({owner:'old-tab',files:{'Main.java':'legacy local source'},revision:0,exerciseRevision:'v1',dirty:true})],
    [tagged,JSON.stringify({owner:'other-tab',accountId:'student-2',files:{'Main.java':'private account source'},revision:0,exerciseRevision:'v1',dirty:true})]
  ]});
  const view=app.window.MENTOR_PRACTICE.mount(app.container,{studentId:'s1',lessonId:'l1',page:'practice'}); await view.ready;
  assert.match(app.container.innerHTML,/data-practice-action="export-legacy"/);
  await view.onClick({target:{closest:()=>({dataset:{practiceAction:'export-legacy'},disabled:false})}});
  assert.equal(app.downloads.length,1);
  const exported=await app.downloads[0].text();
  assert.match(exported,/legacy local source/);
  assert.doesNotMatch(exported,/private account source/);
  assert.ok(app.disk.getItem(legacy),'export must not claim or delete the old record');
});

test('legacy export control is hidden outside localhost and from students', async () => {
  const entry=['mentor.practice.draft.s1/l1/java-one',JSON.stringify({files:{'Main.java':'old'},dirty:true})];
  const remote=browserPractice({id:'teacher-1',role:'teacher'},browserData,{href:'https://example.test/',storageEntries:[entry]});
  const teacher=remote.window.MENTOR_PRACTICE.mount(remote.container,{studentId:'s1',lessonId:'l1',page:'practice'}); await teacher.ready;
  assert.doesNotMatch(remote.container.innerHTML,/data-practice-action="export-legacy"/);
  const student=browserPractice({id:'student-1',role:'student'},browserData,{storageEntries:[entry]});
  const studentView=student.window.MENTOR_PRACTICE.mount(student.container,{studentId:'s1',lessonId:'l1',page:'practice'}); await studentView.ready;
  assert.doesNotMatch(student.container.innerHTML,/data-practice-action="export-legacy"/);
});

test('serial saves retain edits typed during the earlier request and only report saved after the latest reply', async () => {
  const calls = [], replies = [];
  const state = draft({send:body => { calls.push(body); const reply=deferred(); replies.push(reply); return reply.promise; }});
  state.edit('Main.java', 'first edit');
  const saving = state.flush();
  state.edit('Main.java', 'latest edit');
  assert.equal(state.snapshot().status, 'saving');
  replies[0].resolve({draft:{files:calls[0].files,revision:1}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length,2);
  assert.equal(calls[1].revision,1);
  assert.equal(calls[1].exerciseRevision,'v1');
  assert.equal(calls[1].files['Main.java'],'latest edit');
  assert.equal(state.snapshot().dirty,true);
  replies[1].resolve({draft:{files:calls[1].files,revision:2}});
  await saving;
  assert.equal(state.snapshot().status,'saved');
  assert.equal(state.snapshot().dirty,false);
});

test('navigation recovery preserves all editable files and refuses a stale browser copy overwrite', () => {
  const disk = storage();
  const first = draft({storage:disk});
  first.edit('Main.java','unsaved source');
  first.edit('book/Book.java','package book; class Book { int x; }');
  const restored = draft({storage:disk});
  assert.equal(restored.snapshot().files['Main.java'],'unsaved source');
  assert.equal(restored.snapshot().files['book/Book.java'],'package book; class Book { int x; }');
  const competing = draft({storage:disk,remoteDraft:{files:starter,revision:3,exerciseRevision:'v1'}});
  assert.equal(competing.snapshot().status,'conflict');
  assert.equal(competing.snapshot().files['Main.java'],'unsaved source');
});

test('409 retains local source and needs explicit conflict resolution before another save', async () => {
  let sent=0;
  const state=draft({send:async () => { sent++; throw Object.assign(new Error('Changed'),{status:409}); }});
  state.edit('Main.java','my work');
  assert.equal(await state.flush(),false);
  assert.equal(await state.flush(),false);
  assert.equal(sent,1);
  assert.equal(state.snapshot().status,'conflict');
  assert.equal(state.snapshot().files['Main.java'],'my work');
  state.resolveConflict({files:starter,revision:7,exerciseRevision:'v1'},true);
  assert.equal(state.snapshot().revision,7);
  assert.equal(state.snapshot().files['Main.java'],'my work');
});

test('only declared files can be edited and dependency or test files never enter payloads', () => {
  assert.deepEqual(allowedFiles(starter,{'Main.java':'answer','pom.xml':'injected','tests/Test.java':'injected'}),{'Main.java':'answer','book/Book.java':starter['book/Book.java']});
  const state=draft();
  assert.throws(() => state.edit('pom.xml','injected'),/файл/i);
});

test('outdated source stays intact until reset succeeds, then saves the explicit exercise reset token', async () => {
  const reply=deferred(); let body;
  const state=draft({exerciseRevision:'v2',remoteDraft:{files:{...starter,'Main.java':'old answer'},revision:4,exerciseRevision:'v1',outdated:true},send:value=>{body=value;return reply.promise;}});
  assert.equal(state.snapshot().status,'outdated');
  const resetting=state.reset();
  assert.equal(state.snapshot().files['Main.java'],'old answer');
  assert.equal(body.resetForExerciseRevision,'v2');
  assert.equal(body.exerciseRevision,'v2');
  assert.equal(body.revision,4);
  reply.resolve({draft:{files:starter,revision:5,exerciseRevision:'v2'}});
  assert.equal(await resetting,true);
  assert.equal(state.snapshot().files['Main.java'],starter['Main.java']);
});

test('storage failures do not masquerade as saved server drafts', async () => {
  const state=draft({storage:{getItem(){return null;},setItem(){throw new Error('Quota');},removeItem(){}},send:async()=>{throw new TypeError('Failed to fetch');}});
  state.edit('Main.java','still in memory');
  await state.flush();
  assert.equal(state.snapshot().localSaved,false);
  assert.equal(state.snapshot().dirty,true);
  assert.equal(state.snapshot().status,'error');
});

test('a changed exercise retains removed old files for export and locks edits during reset', async () => {
  const reply=deferred();
  const state=draft({exerciseRevision:'v2',starterFiles:{'New.java':'new starter'},remoteDraft:{files:{'Old.java':'irreplaceable old source'},revision:4,exerciseRevision:'v1',outdated:true},send:()=>reply.promise});
  assert.deepEqual(state.snapshot().files,{'Old.java':'irreplaceable old source'});
  const resetting=state.reset();
  assert.equal(state.snapshot().locked,true);
  reply.resolve({draft:{files:{'New.java':'new starter'},revision:5,exerciseRevision:'v2'}});
  await resetting;
  assert.equal(state.snapshot().locked,false);
  assert.deepEqual(state.snapshot().files,{'New.java':'new starter'});
});

test('example success never claims full-test acceptance', () => {
  const result={status:'accepted',passed:2,total:2,tests:[]};
  assert.match(resultMarkup(result,'run'),/Примеры пройдены/);
  assert.doesNotMatch(resultMarkup(result,'run'),/Все тесты пройдены/);
  assert.match(resultMarkup(result,'submit'),/Все тесты пройдены/);
});

test('a stale lesson response arriving after a completed save cannot replace the newer cached code', async () => {
  const cache=new Map(), config={key:'student/lesson/task',exerciseRevision:'v1',starterFiles:starter,storage:storage(),send:async body=>({draft:{files:body.files,revision:body.revision+1}})};
  const state=getDraftSession(config,cache);
  state.edit('Main.java','saved while navigating');
  await state.flush();
  const returned=getDraftSession({...config,remoteDraft:{files:starter,revision:0,exerciseRevision:'v1'}},cache);
  assert.equal(returned,state);
  assert.equal(returned.snapshot().files['Main.java'],'saved while navigating');
  const newer=getDraftSession({...config,remoteDraft:{files:{...starter,'Main.java':'another tab saved'},revision:2,exerciseRevision:'v1'}},cache);
  assert.equal(newer.snapshot().files['Main.java'],'another tab saved');
});

test('one tab cannot delete another tab recovery written while its save was in flight', async () => {
  const disk=storage(), reply=deferred();
  const first=draft({storage:disk}); first.edit('Main.java','first tab');
  const second=draft({storage:disk,send:()=>reply.promise}); second.edit('Main.java','second tab');
  const saving=second.flush();
  first.edit('Main.java','first tab newer unsaved code');
  reply.resolve({draft:{files:{...starter,'Main.java':'second tab'},revision:1}});
  await saving;
  assert.equal(first.snapshot().localSaved,true);
  assert.equal(draft({storage:disk}).snapshot().files['Main.java'],'first tab newer unsaved code');
});

test('a displaced recovery copy is never reported safe for closing the tab', async () => {
  const disk=storage();
  const first=draft({storage:disk}); first.edit('Main.java','first tab unsaved');
  const second=draft({storage:disk}); second.edit('Main.java','second tab saved');
  await second.flush();
  assert.equal(first.snapshot().dirty,true);
  assert.equal(first.snapshot().localSaved,false,'beforeunload must warn when the actual recovery no longer matches');
  assert.equal(first.snapshot().files['Main.java'],'first tab unsaved');
});

test('successful reset of a restored old backup cannot resurrect it on the next reload', async () => {
  const disk=storage(), oldFiles={'Old.java':'old starter'}, nextFiles={'New.java':'new starter'};
  const first=draft({storage:disk,starterFiles:oldFiles,exerciseRevision:'v1'});
  first.edit('Old.java','old unsaved answer');
  const newer=draft({storage:disk,starterFiles:nextFiles,exerciseRevision:'v2',send:async()=>({draft:{files:nextFiles,revision:1,exerciseRevision:'v2'}})});
  assert.equal(newer.snapshot().status,'outdated');
  await newer.reset();
  const reloaded=draft({storage:disk,starterFiles:nextFiles,exerciseRevision:'v2',remoteDraft:{files:nextFiles,revision:1,exerciseRevision:'v2'}});
  assert.equal(reloaded.snapshot().status,'saved');
  assert.deepEqual(reloaded.snapshot().files,nextFiles);
});

test('late loading of an old route cannot render over the active route', async () => {
  const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
  const calls=[], makeContainer=()=>({innerHTML:'',classList:{add(){}},addEventListener(){},removeEventListener(){}});
  const window={document:{currentScript:null},location:{href:'http://localhost/'},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,MENTOR_AUTH:{session:()=>({account:{id:'student-1',role:'student'}}),subscribe:()=>()=>{},request:()=>{const reply=deferred();calls.push(reply);return reply.promise;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/practice.js'),'utf8'),{window,URL,AbortController,TextEncoder,Blob,console});
  const oldContainer=makeContainer(),nextContainer=makeContainer();
  const old=window.MENTOR_PRACTICE.mount(oldContainer,{studentId:'one',lessonId:'one',page:'tasks',presentation:true});
  const next=window.MENTOR_PRACTICE.mount(nextContainer,{studentId:'two',lessonId:'two',page:'tasks',presentation:true});
  calls[1].resolve({exercises:[],submissions:[]});
  await next.ready;
  const currentHTML=nextContainer.innerHTML;
  calls[0].resolve({exercises:[{id:'old-task',title:'Old secret title'}],submissions:[]});
  await old.ready;
  assert.equal(nextContainer.innerHTML,currentHTML);
  assert.doesNotMatch(oldContainer.innerHTML,/Old secret title/);
  window.MENTOR_PRACTICE.dispose();
});

test('upload validation rejects oversized files, unsupported extensions and non-HTTPS repositories', () => {
  assert.match(validateUpload({name:'lesson.zip',size:21*1024*1024},''),/20/);
  assert.match(validateUpload({name:'lesson.exe',size:1},''),/ZIP/);
  assert.match(validateUpload({name:'lesson.java',size:1},'javascript:alert(1)'),/HTTPS/);
  assert.equal(validateUpload({name:'lesson.ZIP',size:1024},'https://example.org/repo'),'');
  assert.match(formatError(new TypeError('Failed to fetch')),/сервер/);
});
