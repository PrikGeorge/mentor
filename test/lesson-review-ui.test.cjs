const test=require('node:test'),assert=require('node:assert/strict');
const routes=require('../dist/portal-model.js'),createCabinet=require('../dist/student-cabinet.js');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const student={id:'michael',name:'Михаэль',studentReview:'LEGACY_REVIEW'};
const lesson={id:'lesson-2026-09-27',studentId:'michael',bundleId:'library-2026-09-27',title:'Списки',date:'2026-09-27',time:'12:00',duration:60,reviewNotes:'<script>lesson feedback</script>'};
const state={students:[student],lessons:[lesson]};
const doc={studentId:'michael',lessonId:lesson.id,bundleId:lesson.bundleId,intro:'PREPARED_REVIEW',sections:[{id:'section-0',title:'Проверка',html:'COMPLETE_REVIEW'}]};
const cabinet=createCabinet({esc,heading:(a,b,c)=>`<h1>${b}</h1><p>${c}</p>`,review:()=>'<p>TEACHER_TECHNICAL_REVIEW</p>',content:{docs:{'student-review':doc},viewData:{}}},routes);
test('review is a lesson route for both roles, with section deep links',()=>{
 for(const audience of ['student','teacher']){
  const ctx=routes.parseRoute(routes.lessonHref(student.id,lesson.id,audience,'review','section-0'),state);
  assert.equal(ctx.kind,'lesson');assert.equal(ctx.lesson.id,lesson.id);assert.equal(ctx.page,'review');assert.equal(ctx.detail,'section-0');
 }
});
test('lesson review contains only matching prepared review and escaped lesson feedback',()=>{
 const ctx={kind:'lesson',student,lesson,audience:'student',page:'review'};
 const html=cabinet.lessonReview(ctx);
 assert.match(html,/PREPARED_REVIEW/);assert.match(html,/COMPLETE_REVIEW/);assert.match(html,/&lt;script&gt;lesson feedback/);
 assert.match(html,/#students\/michael\/lessons\/lesson-2026-09-27\/student\/review\/section-0/);
 assert.doesNotMatch(html,/<script>|LEGACY_REVIEW/);
 for(const changed of [{...lesson,id:'another'}, {...lesson,bundleId:null}])assert.doesNotMatch(cabinet.lessonReview({...ctx,lesson:changed}),/PREPARED_REVIEW|COMPLETE_REVIEW/);
 assert.doesNotMatch(cabinet.lessonReview({...ctx,student:{id:'other'},lesson:{...lesson,studentId:'other'}}),/PREPARED_REVIEW/);
});
test('lesson navigation has its review and no repeated profile block or global review menu',()=>{
 const html=cabinet.navigation({kind:'lesson',student,lesson,audience:'student',page:'review'});
 assert.match(html,/\/student\/review" class="active" aria-current="page"/);
 assert.doesNotMatch(html,/selected-student|Ревью домашки|href="#students\/michael\/review"/);
});
test('prepared technical review is retained only in its matching teacher lesson',()=>{
 const ctx={kind:'lesson',student,lesson,audience:'teacher',page:'review'};
 assert.match(cabinet.lessonReview(ctx),/TEACHER_TECHNICAL_REVIEW/);
 assert.doesNotMatch(cabinet.lessonReview({...ctx,audience:'student'}),/TEACHER_TECHNICAL_REVIEW/);
 assert.doesNotMatch(cabinet.lessonReview({...ctx,lesson:{...lesson,id:'another'}}),/TEACHER_TECHNICAL_REVIEW/);
});
test('previous unlinked review remains an escaped archive without copying it into lessons',()=>{
 const html=cabinet.page({kind:'profile',student:{...student,studentReview:'<b>OLD_REVIEW</b>'},page:'review'},state);
 assert.match(html,/Предыдущий отзыв без привязки к занятию/);assert.match(html,/&lt;b&gt;OLD_REVIEW&lt;\/b&gt;/);
 assert.match(html,/#students\/michael\/lessons\/lesson-2026-09-27\/student\/review/);
 assert.doesNotMatch(html,/PREPARED_REVIEW|COMPLETE_REVIEW/);
 const lessons=cabinet.page({kind:'profile',student,page:'lessons'},state);
 assert.match(lessons,/Предыдущие отзывы/);assert.match(lessons,/#students\/michael\/review/);
});

test('lesson review uses the same Markdown renderer as the editor without formatting the legacy archive',()=>{
 const ui={esc,heading:()=>'',content:{docs:{},viewData:{}}};
 const calls=[];
 const withMarkdown=createCabinet(ui,routes,{render:text=>{calls.push(text);return '<h2>Итоги занятия</h2>'}});
 const html=withMarkdown.lessonReview({student,lesson:{...lesson,reviewNotes:'## Итоги занятия'},audience:'student'});
 assert.match(html,/<div class="markdown-body"><h2>Итоги занятия<\/h2><\/div>/);
 assert.deepEqual(calls,['## Итоги занятия']);
 withMarkdown.reviewArchive(student,state);
 assert.equal(calls.length,1);
});

test('indented review code renders exactly like its preview',()=>{
 const markdown=require('../dist/lesson-markdown.js');
 const ui={esc,content:{docs:{},viewData:{}}},source='    System.out.println(42);\n';
 const html=createCabinet(ui,routes,markdown).lessonReview({student,lesson:{...lesson,reviewNotes:source},audience:'student'});
 assert.ok(html.includes(markdown.render(source)));
 assert.match(html,/<pre><code>System.out.println\(42\);/);
});
