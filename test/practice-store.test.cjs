'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPracticeStore } = require('../lib/practice-store.cjs');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-practice-store-'));
  t.after(() => {
    assert.equal(path.dirname(dataDir), os.tmpdir());
    assert.ok(path.basename(dataDir).startsWith('mentor-practice-store-'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, store: createPracticeStore({ dataDir }) };
}

test('practice storage survives a new instance without touching mentoring data', t => {
  const { dataDir, store } = fixture(t);
  fs.writeFileSync(path.join(dataDir, 'mentoring.json'), 'DO NOT CHANGE');
  store.ensureLesson('student-a', 'lesson-a', [{ exerciseId: 'list-task', placement: 'class' }]);
  store.saveDraft('student-a', 'lesson-a', 'list-task', 1, { 'ListTask.java': 'class ListTask {}' }, 0);
  const reopened = createPracticeStore({ dataDir });
  const lesson = reopened.getLesson('student-a', 'lesson-a');
  assert.equal(lesson.drafts[0].revision, 1);
  assert.equal(lesson.drafts[0].files['ListTask.java'], 'class ListTask {}');
  assert.equal(fs.readFileSync(path.join(dataDir, 'mentoring.json'), 'utf8'), 'DO NOT CHANGE');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'practice')).filter(name => name.endsWith('.tmp')), []);
});

test('corrupt practice state is never replaced or overwritten', t => {
  const { dataDir, store } = fixture(t);
  const file = path.join(dataDir, 'practice', 'state.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => store.ensureLesson('student-a', 'lesson-a', []), { status: 500 });
  assert.throws(() => createPracticeStore({ dataDir }), { status: 500 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('an atomic-write failure preserves prior state and cleans its temporary file', t => {
  const { dataDir, store } = fixture(t);
  store.ensureLesson('student-a', 'lesson-a', []);
  const file = path.join(dataDir, 'practice', 'state.json');
  const previous = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) { if (to === file) throw Object.assign(new Error('disk error'), { code: 'EIO' }); return rename(from, to); };
  try {
    assert.throws(() => store.setAssignments('student-a', 'lesson-a', [{ exerciseId: 'list-task', placement: 'homework' }]), { status: 500 });
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'practice')).filter(name => name.endsWith('.tmp')), []);
});

test('failed submission metadata write removes the unpublished blob and keeps prior state', t => {
  const { dataDir, store } = fixture(t);
  store.ensureLesson('student-a', 'lesson-a', []);
  const file = path.join(dataDir, 'practice', 'state.json');
  const previous = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) { if (to === file) throw Object.assign(new Error('disk error'), { code: 'EIO' }); return rename(from, to); };
  try {
    assert.throws(() => store.addSubmission('student-a', 'lesson-a', { filename: 'note.txt', comment: '', repositoryUrl: '' }, Buffer.from('text')), { status: 500 });
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), previous);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'practice', 'uploads')), []);
});

test('damaged attachment and forged storage path never expose unrelated disk files', t => {
  const { dataDir, store } = fixture(t);
  store.ensureLesson('student-a', 'lesson-a', []);
  const submission = store.addSubmission('student-a', 'lesson-a', { filename: 'note.txt', comment: '', repositoryUrl: '' }, Buffer.from('text'));
  fs.writeFileSync(path.join(dataDir, 'practice', 'uploads', submission.blobId), 'changed length');
  assert.throws(() => store.readSubmissionFile('student-a', 'lesson-a', submission.id), { status: 404 });
  const file = path.join(dataDir, 'practice', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.lessons[0].submissions[0].blobId = '../../mentoring.json';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => store.readSubmissionFile('student-a', 'lesson-a', submission.id), { status: 500 });
});
