const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../lib/store.cjs');
test('student roadmap and review are stored separately from private mentor notes',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-profile-'));
 const store=createStore({dataDir});
 const student=store.addStudent({name:'Другой ученик',notes:'Приватно',studentRoadmap:'Освоить Map',studentReview:'Проверь повтор ID'});
 const reopened=createStore({dataDir}).getState().students.find(s=>s.id===student.id);
 assert.equal(reopened.studentRoadmap,'Освоить Map');assert.equal(reopened.studentReview,'Проверь повтор ID');assert.equal(reopened.notes,'Приватно');
 assert.throws(()=>store.updateStudent(student.id,{studentReview:'я'.repeat(20001)}));
 assert.equal(createStore({dataDir}).getState().students.find(s=>s.id===student.id).studentReview,'Проверь повтор ID');
});
test('existing databases without student-facing texts keep all old data',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-legacy-'));
 const store=createStore({dataDir});const before=store.getState();
 for(const s of before.students){delete s.studentRoadmap;delete s.studentReview;}
 fs.writeFileSync(path.join(dataDir,'mentoring.json'),JSON.stringify(before));
 const updated=createStore({dataDir});const after=updated.getState();
 assert.equal(after.students[0].name,before.students[0].name);assert.deepEqual(after.lessons,before.lessons);
 assert.equal(after.students[0].studentRoadmap,'');assert.equal(after.students[0].studentReview,'');
 updated.updateStudent('michael',{studentRoadmap:'План для ученика'});
 assert.equal(createStore({dataDir}).getState().students[0].studentRoadmap,'План для ученика');
});
