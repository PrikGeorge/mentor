const test=require('node:test');
const assert=require('node:assert/strict');
const {parseRoute,studentHref,lessonHref,hasPreparedBundle,isStudentRoute}=require('../dist/portal-model.js');
const state={students:[{id:'michael'},{id:'second'}],lessons:[{id:'lesson-2026-09-27',studentId:'michael',bundleId:'library-2026-09-27'},{id:'new',studentId:'second',bundleId:null}]};
test('landing is the student list, not an implicitly selected student',()=>assert.equal(parseRoute('',state).kind,'students'));
test('card and lesson retain the selected student',()=>{
 assert.equal(parseRoute('#students/second',state).student.id,'second');
 const r=parseRoute('#students/second/lessons/new/teacher/guide',state);
 assert.equal(r.student.id,'second');assert.equal(r.lesson.id,'new');assert.equal(r.audience,'teacher');
});
test('a lesson cannot appear under another student',()=>assert.equal(parseRoute('#students/second/lessons/lesson-2026-09-27',state).kind,'missing'));
test('student view cannot resolve a teacher guide or solution',()=>{
 assert.equal(parseRoute('#students/michael/lessons/lesson-2026-09-27/student/guide',state).kind,'missing');
 assert.equal(parseRoute('#students/michael/lessons/lesson-2026-09-27/student/code/ListSolutions',state).kind,'missing');
 assert.equal(parseRoute('#students/michael/lessons/lesson-2026-09-27/student/code/ListTask',state).kind,'lesson');
});
test('prepared material belongs only to the original student and lesson bundle',()=>{
 assert.equal(hasPreparedBundle(state.lessons[0]),true);assert.equal(hasPreparedBundle(state.lessons[1]),false);
 assert.equal(hasPreparedBundle({...state.lessons[0],studentId:'second'}),false);
});
test('links identify the student and lesson explicitly',()=>{
 assert.equal(studentHref('second'),'#students/second');
 assert.equal(lessonHref('second','new','student','homework'),'#students/second/lessons/new/student/homework');
});
test('unknown and malformed routes never fall back to Michael',()=>{
 for(const hash of ['#students/missing','#students/%zz','#students/michael/lessons/missing'])assert.equal(parseRoute(hash,state).kind,'missing');
});
test('long profile documents preserve table-of-contents anchors',()=>{
 const href=studentHref('michael','roadmap','section-4');
 const route=parseRoute(href,state);
 assert.equal(route.kind,'profile');assert.equal(route.detail,'section-4');
 assert.equal(parseRoute('#students/michael/roadmap/unknown',state).kind,'missing');
});
test('student cabinet has home, goal, lessons, roadmap and homework review',()=>{
 for(const page of ['', '/goal','/lessons','/roadmap','/review']){
  const route=parseRoute('#students/second'+page,state);
  assert.equal(route.student.id,'second');assert.equal(isStudentRoute(route),true);
 }
});
test('student cabinet excludes mentor observations, full journal and solutions',()=>{
 for(const hash of ['#students','#students/michael/profile','#students/michael/journal','#students/michael/lessons/lesson-2026-09-27/teacher/guide','#students/michael/lessons/lesson-2026-09-27/teacher/code/ListSolutions'])assert.equal(isStudentRoute(parseRoute(hash,state)),false);
 assert.equal(isStudentRoute(parseRoute('#students/michael/lessons/lesson-2026-09-27/student/tasks',state)),true);
});
