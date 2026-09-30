const test=require('node:test'),assert=require('node:assert/strict');
const createCabinet=require('../dist/student-cabinet.js'),routes=require('../dist/portal-model.js');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui={esc,heading:(a,b,c)=>`<h1>${b}</h1><p>${c}</p>`,content:{docs:{'student-roadmap':{studentId:'michael',intro:'MICHAEL_PLAN',sections:[]},'student-review':{studentId:'michael',lessonId:'lesson-2026-09-27',bundleId:'library-2026-09-27',intro:'MICHAEL_REVIEW',sections:[]}}}};
const cabinet=createCabinet(ui,routes);
const second={id:'second',name:'<script>name</script>',goal:'Java',notes:'PRIVATE_MENTOR_NOTES',studentRoadmap:'PUBLIC_PLAN',studentReview:'<img src=x onerror=alert(1)>'};
const state={students:[second],lessons:[{id:'own',studentId:'second',title:'My lesson',date:'2026-10-02',time:'12:00',duration:60,status:'planned',teacherNotes:'SECRET_ANSWER'},{id:'other',studentId:'michael',title:'FOREIGN_LESSON',date:'2026-09-27',time:'12:00',duration:60}]};
test('student dashboard and pages show only selected learner data and public texts',()=>{
 for(const suffix of ['', '/goal','/lessons','/roadmap','/review']){
  const html=cabinet.page(routes.parseRoute('#students/second'+suffix,state),state);
  for(const forbidden of ['PRIVATE_MENTOR_NOTES','SECRET_ANSWER','FOREIGN_LESSON','MICHAEL_PLAN','MICHAEL_REVIEW','<script>','<img'])assert.equal(html.includes(forbidden),false,forbidden+' in '+suffix);
 }
 assert.match(cabinet.page(routes.parseRoute('#students/second/roadmap',state),state),/PUBLIC_PLAN/);
 assert.doesNotMatch(cabinet.page(routes.parseRoute('#students/second/roadmap',state),state),/Дополнение/);
 assert.match(cabinet.home(second,state),/#students\/second\/lessons\/own\/student\/tasks/);
});
test('Michael receives prepared student-facing documents; blank new students have honest empty states',()=>{
 const michael={id:'michael',name:'Михаэль'};
 assert.match(cabinet.page({kind:'profile',student:michael,page:'roadmap'},state),/MICHAEL_PLAN/);
 assert.match(cabinet.lessonReview({kind:'lesson',student:michael,lesson:{id:'lesson-2026-09-27',studentId:'michael',bundleId:'library-2026-09-27'},audience:'student',page:'review'}),/MICHAEL_REVIEW/);
 assert.match(cabinet.page({kind:'profile',student:{id:'empty',name:'Новый'},page:'review'},state),/Проверок по занятиям пока нет/);
});

test('lesson sidebar retains the current learner and lesson and marks only the active section',()=>{
 const route=routes.parseRoute('#students/second/lessons/own/student/practice/list-task',state);
 const html=cabinet.navigation(route);
 assert.match(html,/aria-label="Разделы занятия"/);
 for(const page of ['tasks','practice','materials','homework','review'])assert.match(html,new RegExp('href="#students/second/lessons/own/student/'+page+'"'));
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 assert.match(html,/href="#students\/second\/lessons\/own\/student\/practice" class="active" aria-current="page"/);
 assert.doesNotMatch(html,/michael|\/teacher\/|FOREIGN_LESSON/);
 assert.equal(cabinet.lessonNavigation({...route,audience:'teacher'}),'');
 const source=cabinet.lessonNavigation({...route,page:'code',detail:'ListTask'});
 assert.match(source,/\/student\/materials" class="active" aria-current="page"/);
});
