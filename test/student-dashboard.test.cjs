const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const routes=require('../dist/portal-model.js'),createCabinet=require('../dist/student-cabinet.js');
const browser={window:{},document:{getElementById(){return null;}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),browser);
browser.window.LESSON_UI.setContent(JSON.parse(fs.readFileSync(require.resolve('../private/materials/content.json'),'utf8')));
const ui=browser.window.LESSON_UI,cabinet=createCabinet(ui,routes);
const now=new Date('2026-09-30T09:30:00Z'); // 12:30 Moscow, independent of the host timezone.
const lesson=(id,date,time,duration=60)=>({id,studentId:'second',title:id,date,time,duration,status:'planned',studentNotes:''});

test('lesson focus chooses the nearest upcoming lesson instead of the furthest future date',()=>{
 const items=[lesson('far','2026-11-01','12:00'),lesson('past','2026-09-29','12:00'),lesson('near','2026-10-02','12:00')];
 const before=JSON.stringify(items),focus=routes.lessonFocus(items,now);
 assert.equal(focus.lesson.id,'near');assert.equal(focus.upcoming,true);assert.equal(JSON.stringify(items),before);
});
test('an ongoing Moscow lesson stays focused through its exact end time',()=>{
 const items=[lesson('later','2026-09-30','14:00'),lesson('ongoing','2026-09-30','12:00',60),lesson('ended','2026-09-30','11:00',60)];
 for(const instant of ['2026-09-30T09:30:00Z','2026-09-30T10:00:00Z']){
  const focus=routes.lessonFocus(items,new Date(instant));assert.equal(focus.lesson.id,'ongoing');assert.equal(focus.upcoming,true);
 }
 assert.equal(routes.lessonFocus(items,new Date('2026-09-30T10:00:00.001Z')).lesson.id,'later');
});
test('without upcoming lessons focus is the latest past lesson, or null for an empty list',()=>{
 const focus=routes.lessonFocus([lesson('older','2026-09-25','12:00'),lesson('recent','2026-09-29','12:00')],now);
 assert.equal(focus.lesson.id,'recent');assert.equal(focus.upcoming,false);assert.equal(routes.lessonFocus([],now),null);
});
test('home gives one isolated focused lesson before the goal and secondary destinations',()=>{
 const student={id:'second',name:'Анна',goal:'GOAL_SENTINEL',notes:'PRIVATE_NOTES'};
 const state={students:[student],lessons:[lesson('near','2026-10-02','12:00'),lesson('far','2026-11-01','12:00'),{...lesson('FOREIGN','2026-09-30','12:00'),studentId:'michael'}]};
 const html=cabinet.home(student,state,now);
 assert.match(html,/#students\/second\/lessons\/near\/student\/tasks/);
 assert.match(html,/#students\/second\/lessons\/near\/student\/homework/);
 assert.ok(html.indexOf('near')<html.indexOf('GOAL_SENTINEL'));
 assert.equal((html.match(/<article\b/g)||[]).length,1);
 for(const forbidden of ['FOREIGN','PRIVATE_NOTES','/lessons/far/','Твой маршрут: Java Backend'])assert.equal(html.includes(forbidden),false);
 const history=cabinet.page({kind:'profile',student,page:'lessons'},state);
 assert.match(history,/\/lessons\/far\//);assert.match(history,/\/lessons\/near\//);
});
test('empty students keep honest empty states and prepared status does not fabricate materials',()=>{
 const student={id:'empty',name:'Новый'},state={students:[student],lessons:[]};
 assert.match(cabinet.home(student,state,now),/Занятий пока нет/);
 for(const page of ['roadmap','review']){
  const html=cabinet.page({kind:'profile',student,page},state);
  assert.equal(html.includes('section-0'),false);assert.equal(html.includes(ui.content.sha),false);
 }
 state.lessons=[{...lesson('empty-materials','2026-10-02','12:00'),studentId:'empty',status:'prepared'}];
 const html=cabinet.home(student,state,now);
 assert.doesNotMatch(html,/Материалы готовы|Проведено|Завершено/);assert.match(html,/готовятся|не добавлены/);
});
test('roadmap leads with the nearest week and retains every stage body and route anchor',()=>{
 const student={id:'michael',name:'Михаэль'},doc=ui.content.docs['student-roadmap'];
 const html=cabinet.page({kind:'profile',student,page:'roadmap'},{lessons:[]});
 assert.ok(html.indexOf('id="section-2"')<html.indexOf('id="section-0"'));
 assert.equal((html.match(/<details class="roadmap-stage"/g)||[]).length,5);
 assert.match(html,/<details class="toc toc-disclosure"><summary>Разделы материала<\/summary><nav class="toc-links"/);
 for(const section of doc.sections){
  assert.equal((html.match(new RegExp('id="'+section.id+'"','g'))||[]).length,1);
  assert.ok(html.includes(section.html),'body preserved: '+section.id);
  assert.match(html,new RegExp('href="#students/michael/roadmap/'+section.id+'"'));
  assert.equal(routes.parseRoute('#students/michael/roadmap/'+section.id,{students:[student],lessons:[]}).detail,section.id);
 }
});
test('review prioritizes existing search and validator anchors and retains complete snapshot metadata',()=>{
 const student={id:'michael',name:'Михаэль'},doc=ui.content.docs['student-review'];
 const html=cabinet.lessonReview({kind:'lesson',student,audience:'student',page:'review',lesson:{id:'lesson-2026-09-27',studentId:'michael',bundleId:'library-2026-09-27'}});
 const priorities=html.match(/<section class="review-priorities"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(priorities);assert.match(priorities,/#students\/michael\/lessons\/lesson-2026-09-27\/student\/review\/section-3/);assert.match(priorities,/#students\/michael\/lessons\/lesson-2026-09-27\/student\/review\/section-2/);
 const metadata=html.match(/<details class="review-metadata"[^>]*>([\s\S]*?)<\/details>/)?.[1];
 assert.ok(metadata);assert.match(metadata,/27 сентября 2026/);
 assert.match(metadata,/deef9f94a1bee97161cfef4f9fb457f8b7c99713/);assert.match(metadata,/d5e42364aff0d930bee301a953b7a855518dab2a/);
 assert.match(html,/не автоматическое ревью/);
 for(const section of doc.sections){assert.ok(html.includes(section.html));assert.match(html,new RegExp('id="'+section.id+'"'));}
});
