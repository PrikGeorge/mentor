'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../dist/portal-model.js');
const state = {students:[{id:'michael'},{id:'anna'}],lessons:[{id:'lesson-1',studentId:'michael'}]};

test('practice editor routes preserve the learner, lesson and exercise',()=>{
 const hash = R.lessonHref('michael','lesson-1','student','practice','list-task');
 const route = R.parseRoute(hash,state);
 assert.equal(route.kind,'lesson');
 assert.equal(route.student.id,'michael');
 assert.equal(route.lesson.id,'lesson-1');
 assert.equal(route.detail,'list-task');
 assert.equal(R.isStudentRoute(route),true);
 assert.equal(R.parseRoute(hash.replace('michael','anna'),state).kind,'missing');
});

test('teacher practice dashboard is a teacher route and malformed exercise paths fail',()=>{
 const dashboard = R.parseRoute(R.lessonHref('michael','lesson-1','teacher','practice'),state);
 assert.equal(dashboard.kind,'lesson');
 assert.equal(R.isStudentRoute(dashboard),false);
 for(const detail of ['../guide','list.task','x'.repeat(101)]){
  assert.equal(R.parseRoute(R.lessonHref('michael','lesson-1','student','practice',detail),state).kind,'missing');
 }
 assert.equal(R.parseRoute('#students/michael/lessons/lesson-1/student/tasks/list-task',state).kind,'missing');
});
