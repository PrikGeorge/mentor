'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createStore } = require('../lib/store.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-store-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('mentor-store-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file: path.join(dir, 'mentoring.json'), store: createStore({ dataDir: dir }) };
}

test('fresh storage contains Michael and his prepared lesson', t => {
  const { store } = fixture(t);
  const state = store.getState();
  assert.equal(state.version, 1);
  assert.equal(state.students.length, 1);
  assert.equal(state.students[0].id, 'michael');
  assert.equal(state.students[0].name, 'Михаэль');
  assert.equal(state.lessons[0].studentId, 'michael');
  assert.equal(state.lessons[0].bundleId, 'library-2026-09-27');
  assert.equal(state.lessons[0].date, '2026-09-27');
  assert.equal(state.lessons[0].time, '12:00');
  assert.equal(state.lessons[0].status, 'prepared');
});

test('created profile survives reopening and backup retains previous revision', t => {
  const { dir, file, store } = fixture(t);
  const student = store.addStudent({ name: '  Анна  ', notes: 'Проверочный профиль' });
  assert.equal(student.name, 'Анна');
  assert.equal(student.direction, 'Java Backend');
  const reopened = createStore({ dataDir: dir });
  assert.equal(reopened.getState().students.find(item => item.id === student.id).notes, 'Проверочный профиль');
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).students.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).students.length, 2);
});

test('empty or oversized profile values fail without changing stored data', t => {
  const { file, store } = fixture(t);
  const before = fs.readFileSync(file, 'utf8');
  for (const input of [{ name: '' }, { name: '   ' }, { name: null }, { name: 15 }, { name: 'x'.repeat(121) }, { name: 'Олег', notes: 'x'.repeat(5001) }]) {
    assert.throws(() => store.addStudent(input), error => error.status === 400);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('new lessons belong only to selected student and have no inherited lesson bundle', t => {
  const { store } = fixture(t);
  const student = store.addStudent({ name: 'Анна' });
  const lesson = store.addLesson(student.id, { title: 'Коллекции', date: '2026-10-01', time: '18:30', duration: 60, teacherNotes: 'Обсудить Map', studentNotes: 'Решить задачу' });
  assert.equal(lesson.studentId, student.id);
  assert.equal(lesson.status, 'planned');
  assert.equal(lesson.bundleId, null);
  assert.equal(lesson.teacherNotes, 'Обсудить Map');
  assert.equal(lesson.reviewNotes, '');
  assert.equal(store.getState().lessons.filter(item => item.studentId === 'michael').length, 1);
  assert.throws(() => store.updateLesson('michael', lesson.id, { title: 'Чужое занятие' }), error => error.status === 404);
  assert.throws(() => store.addLesson('unknown', { title: 'Урок', date: '2026-10-01', time: '18:30', duration: 60 }), error => error.status === 404);
});

test('lesson reviews persist independently for each lesson and student', t => {
  const { dir, store } = fixture(t);
  const other = store.addStudent({ name: 'Анна' });
  store.updateStudent('michael', { studentReview: 'Старый архив без привязки к уроку' });
  store.updateLesson('michael', 'lesson-2026-09-27', { reviewNotes: '  Проверка первой работы  ' });
  const second = store.addLesson('michael', { title: 'Следующий урок', date: '2026-10-01', time: '12:00', duration: 60, reviewNotes: 'Разбор второй работы' });
  const empty = store.addLesson(other.id, { title: 'Другой ученик', date: '2026-10-02', time: '12:00', duration: 60 });
  store.updateLesson('michael', second.id, { title: 'Новое название' });
  assert.throws(() => store.updateLesson(other.id, second.id, { reviewNotes: 'Чужое ревью' }), error => error.status === 404);
  const state = createStore({ dataDir: dir }).getState();
  assert.equal(state.lessons.find(item => item.id === 'lesson-2026-09-27').reviewNotes, '  Проверка первой работы  ');
  assert.equal(state.lessons.find(item => item.id === second.id).reviewNotes, 'Разбор второй работы');
  assert.equal(state.lessons.find(item => item.id === empty.id).reviewNotes, '');
  assert.equal(state.students[0].studentReview, 'Старый архив без привязки к уроку');
  store.updateLesson('michael', second.id, { reviewNotes: '' });
  assert.equal(createStore({ dataDir: dir }).getState().lessons.find(item => item.id === second.id).reviewNotes, '');
});

test('lesson Markdown retains semantic indentation and line endings through saves and schedule edits', t => {
  const { dir, store } = fixture(t);
  const source = '    System.out.println(42);\r\n\r\nParagraph with hard break  \r\nnext line\r\n'.repeat(500);
  assert.ok(source.length > 20000);
  const lesson = store.addLesson('michael', {title:'  Markdown  ',date:'2026-10-01',time:'12:00',duration:60,teacherNotes:source,studentNotes:source,reviewNotes:source});
  assert.equal(lesson.title,'Markdown');
  store.updateLesson('michael',lesson.id,{time:'13:00'});
  const saved = createStore({dataDir:dir}).getState().lessons.find(item=>item.id===lesson.id);
  for(const field of ['teacherNotes','studentNotes','reviewNotes']){
    assert.equal(saved[field],source);
    assert.throws(()=>store.updateLesson('michael',lesson.id,{[field]:' '.repeat(200001)}),error=>error.status===400);
  }
});

test('legacy lesson reads add empty reviews in memory without rewriting data or backups', t => {
  const { dir, file, store } = fixture(t);
  const legacy = store.getState();
  legacy.students[0].studentReview = 'Архивное ревью, дата неизвестна';
  for (const lesson of legacy.lessons) delete lesson.reviewNotes;
  fs.writeFileSync(file, JSON.stringify(legacy));
  fs.writeFileSync(file + '.bak', 'unchanged backup bytes');
  const hash = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const before = [hash(file), hash(file + '.bak')];
  const reopened = createStore({ dataDir: dir });
  for (const state of [reopened.getState(), store.getState()]) {
    assert.equal(state.lessons[0].reviewNotes, '');
    assert.deepEqual(state.lessons.map(({ reviewNotes, ...lesson }) => lesson), legacy.lessons);
    assert.deepEqual(state.students, legacy.students);
  }
  assert.deepEqual([hash(file), hash(file + '.bak')], before);
});

for (const field of ['teacherNotes', 'studentNotes', 'reviewNotes']) test(`${field} accepts 200,000 UTF-16 units and rejects invalid values without writing`, t => {
  const { dir, file, store } = fixture(t);
  const input = { title: 'Урок', date: '2026-10-01', time: '12:00', duration: 60 };
  const notes = '😀'.repeat(100000);
  assert.equal(notes.length, 200000);
  const lesson = store.addLesson('michael', { ...input, [field]: notes });
  assert.equal(lesson[field], notes);
  const updated = store.updateLesson('michael', lesson.id, { [field]: 'я'.repeat(200000) });
  assert.equal(updated[field], 'я'.repeat(200000));
  assert.equal(createStore({ dataDir: dir }).getState().lessons.find(item => item.id === lesson.id)[field], updated[field]);
  const before = fs.readFileSync(file, 'utf8');
  const backup = fs.readFileSync(file + '.bak', 'utf8');
  for (const value of [notes + 'я', null, 42, {}, []]) {
    assert.throws(() => store.addLesson('michael', { ...input, [field]: value }), error => error.status === 400);
    assert.throws(() => store.updateLesson('michael', lesson.id, { [field]: value }), error => error.status === 400);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), backup);
});

test('profile fields retain their existing character limits', t => {
  const { file, store } = fixture(t);
  for (const [field, maximum] of [['name', 120], ['direction', 120], ['goal', 1000], ['schedule', 500], ['notes', 5000], ['studentRoadmap', 20000], ['studentReview', 20000]]) {
    const student = store.addStudent({ name: 'Ученик', [field]: 'я'.repeat(maximum) });
    assert.equal(student[field].length, maximum);
    const before = fs.readFileSync(file, 'utf8');
    const oversized = { [field]: 'я'.repeat(maximum + 1) };
    assert.throws(() => store.addStudent({ name: 'Ученик', ...oversized }), error => error.status === 400);
    assert.throws(() => store.updateStudent(student.id, oversized), error => error.status === 400);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('lesson validation rejects impossible dates, time and duration; accepts leap date', t => {
  const { store } = fixture(t);
  const input = { title: 'Урок', date: '2028-02-29', time: '09:05', duration: 60 };
  for (const patch of [{ date: '2026-02-29' }, { date: '2026-04-31' }, { date: '2026-13-01' }, { time: '24:00' }, { time: '9:05' }, { duration: 0 }, { duration: 14 }, { duration: 241 }, { duration: 60.5 }, { duration: '60' }, { title: ' ' }]) {
    assert.throws(() => store.addLesson('michael', { ...input, ...patch }), error => error.status === 400);
  }
  assert.equal(store.addLesson('michael', input).date, '2028-02-29');
});

test('profile and lesson edits persist while identity, bundle and status cannot be overwritten', t => {
  const { dir, store } = fixture(t);
  store.updateStudent('michael', { name: 'Михаэль', goal: 'Java junior' });
  store.updateLesson('michael', 'lesson-2026-09-27', { title: 'Новый заголовок', teacherNotes: 'Только преподавателю', studentNotes: 'Задание', time: '13:00' });
  for (const patch of [{ id: 'other' }, { bundleId: null }, { studentId: 'other' }, { status: 'completed' }]) {
    assert.throws(() => store.updateLesson('michael', 'lesson-2026-09-27', patch), error => error.status === 400);
  }
  assert.throws(() => store.updateStudent('michael', { id: 'other' }), error => error.status === 400);
  const state = createStore({ dataDir: dir }).getState();
  assert.equal(state.students[0].goal, 'Java junior');
  assert.equal(state.lessons[0].teacherNotes, 'Только преподавателю');
  assert.equal(state.lessons[0].bundleId, 'library-2026-09-27');
  assert.equal(state.lessons[0].time, '13:00');
});

test('callers cannot mutate persisted state by retaining a returned object', t => {
  const { store } = fixture(t);
  const state = store.getState();
  state.students[0].name = 'Изменено без сохранения';
  state.lessons.length = 0;
  assert.equal(store.getState().students[0].name, 'Михаэль');
  assert.equal(store.getState().lessons.length, 1);
});

test('damaged existing JSON and structurally invalid state are preserved, not silently reset', t => {
  const { dir, file, store } = fixture(t);
  for (const damaged of ['{broken', '{"version":1,"students":[],"lessons":[{"id":"orphan"}]}']) {
    fs.writeFileSync(file, damaged);
    assert.throws(() => createStore({ dataDir: dir }), /повреждён|формат/i);
    assert.throws(() => store.addStudent({ name: 'Анна' }), /повреждён|формат/i);
    assert.equal(fs.readFileSync(file, 'utf8'), damaged);
  }
});
