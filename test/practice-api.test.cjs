'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStore } = require('../lib/store.cjs');
const { createPracticeApi } = require('../lib/practice-api.cjs');

const BASE = '/api/students/michael/lessons/lesson-2026-09-27';
const FILES = { 'ListTask.java': 'class ListTask {}' };
const ZIP = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');

// Catalog/runner are independent services built in parallel; storage and HTTP are real.
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-practice-api-'));
  const store = createStore({ dataDir: dir });
  const originalMentoring = fs.readFileSync(path.join(dir, 'mentoring.json'), 'utf8');
  const exercises = ['list-task', 'grouping-task'].map((id, index) => ({
    id, revision: 1, title: index ? 'Группировка' : 'Списки', statement: 'Решите задачу.', environmentId: 'jdk-21',
    starterFiles: index ? { 'GroupingTask.java': 'class GroupingTask {}' } : FILES,
    tests: [{ name: 'Тест', source: 'PRIVATE_CHECKER_SOURCE', file: 'SecretChecker.java' }],
  }));
  const environment = { id: 'jdk-21', title: 'Java 21', javaVersion: 21, dependencies: [] };
  const catalog = {
    list: () => exercises,
    get: id => exercises.find(item => item.id === id),
    environments: () => [environment],
    publicExercise: exercise => ({ id: exercise.id, revision: exercise.revision, title: exercise.title, statement: exercise.statement, environment, starterFiles: exercise.starterFiles }),
  };
  const runner = {
    status: options.status || (async () => ({ available: true, mode: 'test', message: 'Тестовое окружение' })),
    run: options.run || (async (exercise, files, mode) => ({ status: files['ListTask.java'].includes('correct') ? 'accepted' : 'wrong_answer', passed: files['ListTask.java'].includes('correct') ? 1 : 0, total: 1, elapsedMs: 2, tests: [{ name: 'Проверка', status: 'failed', expected: '2', actual: '1' }], privateSource: exercise.tests[0].source, files, mode })),
  };
  const principals = {
    student: { id: 'student-a', role: 'student', studentId: 'michael' },
    teacher: { id: 'teacher', role: 'teacher', studentId: null },
    other: { id: 'student-b', role: 'student', studentId: 'other' },
  };
  const servers = [];
  async function start() {
    const handle = createPracticeApi({ store, catalog, runner, dataDir: dir, auth: { assertActive(principal) { options.assertActive?.(principal); } } });
    const server = http.createServer(async (req, res) => {
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const principal = req.headers['x-test-role'] === 'guest' ? null : principals[req.headers['x-test-role'] || 'student'];
        if (!await handle(req, res, pathname, principal)) { res.writeHead(404); res.end('{}'); }
      } catch (error) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { server, origin, async call(route, method = 'GET', body, role = 'student') {
      const response = await fetch(origin + route, { method, headers: { 'x-test-role': role, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    } };
  }
  t.after(async () => {
    for (const server of servers) { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('mentor-practice-api-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, exercises, originalMentoring, start, principals, ...(await start()) };
}

test('catalog hides checker definitions and defaults exist only on the prepared Michael lesson', async t => {
  const app = await fixture(t);
  const catalog = await app.call('/api/practice/catalog', 'GET', undefined, 'teacher');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.exercises.length, 2);
  assert.doesNotMatch(JSON.stringify(catalog.body), /PRIVATE_CHECKER|SecretChecker|environmentId/);
  const initial = await app.call(BASE + '/practice');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.exercises.map(item => item.id), ['list-task', 'grouping-task']);
  assert.equal(initial.body.exercises[0].draft.revision, 0);
  assert.deepEqual(initial.body.exercises[0].draft.files, FILES);
  assert.equal(fs.readFileSync(path.join(app.dir, 'mentoring.json'), 'utf8'), app.originalMentoring);
  const student = app.store.addStudent({ name: 'Анна' });
  const lesson = app.store.addLesson(student.id, { title: 'Новое', date: '2026-10-02', time: '12:00', duration: 60 });
  assert.deepEqual((await app.call(`/api/students/${student.id}/lessons/${lesson.id}/practice`, 'GET', undefined, 'teacher')).body.exercises, []);
  const extra = app.store.addLesson('michael', { title: 'Следующее', date: '2026-10-03', time: '12:00', duration: 60 });
  assert.deepEqual((await app.call(`/api/students/michael/lessons/${extra.id}/practice`)).body.exercises, []);
});

test('guest and wrong student are denied before practice lesson creation or body parsing', async t => {
  const app = await fixture(t);
  const stateFile = path.join(app.dir, 'practice', 'state.json');
  assert.equal(fs.existsSync(stateFile), false);
  for (const role of ['guest', 'other']) {
    for (const [suffix, method] of [['/practice', 'GET'], ['/practice/exercises/list-task/draft', 'PATCH'], ['/homework', 'POST']]) {
      const result = await app.call(BASE + suffix, method, method === 'GET' ? undefined : { contentBase64: 'x'.repeat(10000) }, role);
      assert.equal(result.status, role === 'guest' ? 401 : 404, `${role} ${suffix}`);
    }
  }
  assert.equal(fs.existsSync(stateFile), false);
});

test('teacher can read practice but cannot create a draft, attempt or submission', async t => {
  const app = await fixture(t);
  assert.equal((await app.call(BASE + '/practice', 'GET', undefined, 'teacher')).status, 200);
  const before = fs.readFileSync(path.join(app.dir, 'practice', 'state.json'), 'utf8');
  for (const [route, method, body] of [
    ['/practice/exercises/list-task/draft', 'PATCH', { revision: 0, exerciseRevision: 1, files: FILES }],
    ['/practice/exercises/list-task/attempts', 'POST', { mode: 'run', exerciseRevision: 1, files: FILES }],
    ['/homework', 'POST', { filename: 'note.txt', contentBase64: 'aGk=' }],
  ]) assert.equal((await app.call(BASE + route, method, body, 'teacher')).status, 403);
  assert.equal(fs.readFileSync(path.join(app.dir, 'practice', 'state.json'), 'utf8'), before);
});

test('delayed runner stores the original attempt but withholds its result after revocation', async t => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  let active = true;
  const app = await fixture(t, { assertActive() { if (!active) throw Object.assign(new Error('Session revoked'), { status: 401, code: 'UNAUTHORIZED' }); }, run: async () => { started(); return finished; } });
  const pending = app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' });
  await running;
  active = false;
  finish({ status: 'accepted', passed: 1, total: 1, tests: [] });
  const response = await pending;
  assert.equal(response.status, 401);
  assert.doesNotMatch(JSON.stringify(response.body), /accepted|ListTask/);
  const history = JSON.parse(fs.readFileSync(path.join(app.dir, 'practice', 'state.json'), 'utf8'));
  assert.equal(history.lessons[0].attempts.length, 1);
  assert.equal(history.lessons[0].attempts[0].exerciseId, 'list-task');
});

test('assignment removal while Java runs prevents an attempt from being added', async t => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const app = await fixture(t, { run: async () => { started(); return finished; } });
  const pending = app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' });
  await running;
  assert.equal((await app.call(BASE + '/practice/assignments', 'POST', { assignments: [] }, 'teacher')).status, 200);
  finish({ status: 'accepted', passed: 1, total: 1, tests: [] });
  assert.equal((await pending).status, 404);
  const history = JSON.parse(fs.readFileSync(path.join(app.dir, 'practice', 'state.json'), 'utf8'));
  assert.equal(history.lessons[0].attempts.length, 0);
});

test('revoked teacher receives no private practice view after delayed assignment status', async t => {
  let started;
  const statusStarted = new Promise(resolve => { started = resolve; });
  let finish;
  const statusFinished = new Promise(resolve => { finish = resolve; });
  let active = true;
  const app = await fixture(t, {
    assertActive() { if (!active) throw Object.assign(new Error('Session revoked'), { status: 401, code: 'UNAUTHORIZED' }); },
    status: async () => { started(); return statusFinished; },
  });
  const pending = app.call(BASE + '/practice/assignments', 'POST', { assignments: [{ exerciseId: 'list-task', placement: 'class' }] }, 'teacher');
  await statusStarted;
  active = false;
  finish({ available: true, mode: 'test', message: 'Ready' });
  const response = await pending;
  assert.equal(response.status, 401);
  assert.doesNotMatch(JSON.stringify(response.body), /ListTask|submissions|draft|attempt/);
});

test('revoked session before launch does not call the runner or create practice storage', async t => {
  let runs = 0;
  const app = await fixture(t, { assertActive() { throw Object.assign(new Error('Session revoked'), { status: 401, code: 'UNAUTHORIZED' }); }, run: async () => { runs++; return { status: 'accepted', passed: 1, total: 1, tests: [] }; } });
  const file = path.join(app.dir, 'practice', 'state.json');
  assert.equal(fs.existsSync(file), false);
  const response = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' });
  assert.equal(response.status, 401);
  assert.equal(runs, 0);
  assert.equal(fs.existsSync(file), false);
});

test('drafts persist across restart and stale revisions preserve saved source', async t => {
  const app = await fixture(t);
  const route = BASE + '/practice/exercises/list-task/draft';
  const saved = await app.call(route, 'PATCH', { exerciseRevision: 1, files: { 'ListTask.java': 'class ListTask { int answer = 2; }' }, revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.revision, 1);
  const stale = await app.call(route, 'PATCH', { exerciseRevision: 1, files: FILES, revision: 0 });
  assert.equal(stale.status, 409);
  const restarted = await app.start();
  const view = await restarted.call(BASE + '/practice');
  assert.equal(view.body.exercises[0].draft.files['ListTask.java'], 'class ListTask { int answer = 2; }');
  assert.equal(view.body.exercises[0].draft.revision, 1);
  assert.equal(fs.readFileSync(path.join(app.dir, 'mentoring.json'), 'utf8'), app.originalMentoring);
});

test('catalog revision changes retain readable draft and need explicit reset before editing or checking', async t => {
  const app = await fixture(t);
  await app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: FILES, revision: 0 });
  app.exercises[0].revision = 2;
  const view = await app.call(BASE + '/practice');
  assert.equal(view.body.exercises[0].draft.outdated, true);
  assert.deepEqual(view.body.exercises[0].draft.files, FILES);
  assert.equal((await app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: FILES, revision: 1 })).status, 409);
  assert.equal((await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'submit' })).status, 409);
  const reset = await app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 2, files: FILES, revision: 1, resetForExerciseRevision: 2 });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.draft.revision, 2);
  assert.equal(reset.body.draft.outdated, false);
  const state = JSON.parse(fs.readFileSync(path.join(app.dir, 'practice', 'state.json'), 'utf8'));
  assert.deepEqual(state.lessons[0].draftArchives[0].files, FILES);
  assert.equal(state.lessons[0].draftArchives[0].exerciseRevision, 1);
});

test('attempts snapshot checked source and results independently from later draft changes', async t => {
  const app = await fixture(t);
  const submitted = { 'ListTask.java': 'class ListTask { /* correct */ }' };
  const result = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: submitted, mode: 'submit' });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.attempt.files, submitted);
  assert.equal(result.body.attempt.result.status, 'accepted');
  assert.equal(result.body.attempt.exerciseRevision, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_CHECKER|privateSource/);
  await app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: FILES, revision: 0 });
  const restarted = await app.start();
  const attempt = await restarted.call(BASE + `/practice/exercises/list-task/attempts/${result.body.attempt.id}`);
  assert.deepEqual(attempt.body.attempt.files, submitted);
  const summary = (await restarted.call(BASE + '/practice')).body.exercises[0].attempts[0];
  assert.equal(summary.id, result.body.attempt.id);
  assert.equal(Object.hasOwn(summary, 'files'), false);
});

test('first unsaved edits from an old exercise revision cannot be relabeled after a catalog update', async t => {
  let runs = 0;
  const app = await fixture(t, { run: async () => { runs++; throw new Error('must not run'); } });
  const initial = (await app.call(BASE + '/practice')).body.exercises[0];
  assert.equal(initial.revision, 1);
  assert.equal(initial.draft.revision, 0);
  app.exercises[0].revision = 2;
  const source = { 'ListTask.java': 'class ListTask { /* work for old statement */ }' };
  const draft = await app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: source, revision: 0 });
  const attempt = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: source, mode: 'submit' });
  assert.equal(draft.status, 409);
  assert.equal(attempt.status, 409);
  assert.equal(runs, 0);
  assert.equal((await app.call(BASE + '/practice')).body.exercises[0].draft.revision, 0);
});

test('every lesson endpoint verifies real student/lesson ownership', async t => {
  const app = await fixture(t);
  const other = app.store.addStudent({ name: 'Другой' });
  const wrong = `/api/students/${other.id}/lessons/lesson-2026-09-27`;
  for (const [suffix, method, body] of [
    ['/practice', 'GET'], ['/practice/assignments', 'POST', { assignments: [] }],
    ['/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: FILES, revision: 0 }],
    ['/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'submit' }],
    ['/practice/exercises/list-task/attempts/attempt-missing', 'GET'],
    ['/homework', 'POST', { filename: 'Main.java', contentBase64: Buffer.from('class Main{}').toString('base64') }],
    ['/homework/submission-missing/file', 'GET'], ['/homework/submission-missing', 'PATCH', { status: 'reviewed', feedback: 'OK' }],
  ]) assert.equal((await app.call(wrong + suffix, method, body, suffix === '/practice/assignments' || suffix === '/homework/submission-missing' ? 'teacher' : 'student')).status, 404, suffix);
});

test('assignments persist removals and arbitrary client checker/dependency fields are rejected', async t => {
  const app = await fixture(t);
  const changed = await app.call(BASE + '/practice/assignments', 'POST', { assignments: [{ exerciseId: 'grouping-task', placement: 'homework' }] }, 'teacher');
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.exercises.map(item => [item.id, item.placement]), [['grouping-task', 'homework']]);
  const restarted = await app.start();
  assert.deepEqual((await restarted.call(BASE + '/practice')).body.exercises.map(item => item.id), ['grouping-task']);
  for (const assignments of [[{ exerciseId: 'missing', placement: 'class' }], [{ exerciseId: '__proto__', placement: 'class' }], [{ exerciseId: 'list-task', placement: 'class', tests: [] }], [{ exerciseId: 'list-task', placement: 'other' }]]) {
    assert.equal((await app.call(BASE + '/practice/assignments', 'POST', { assignments }, 'teacher')).status, 400);
  }
  assert.equal((await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'submit' })).status, 404);
});

test('source validation allows declared files only and bounds total UTF8 size', async t => {
  const app = await fixture(t);
  const route = BASE + '/practice/exercises/list-task/draft';
  for (const files of [{}, { ...FILES, '../Escape.java': 'class Escape{}' }, { ...FILES, 'SecretChecker.java': 'class SecretChecker{}' }, JSON.parse('{"__proto__":"bad"}'), { 'ListTask.java': 3 }, { 'ListTask.java': 'Я'.repeat(140000) }, { 'ListTask.java': 'x'.repeat(128 * 1024 + 1) }]) {
    assert.equal((await app.call(route, 'PATCH', { exerciseRevision: 1, files, revision: 0 })).status, 400);
  }
  assert.equal((await app.call(route, 'PATCH', { exerciseRevision: 1, files: FILES, revision: 0, dependencies: ['evil'] })).status, 400);
  assert.equal((await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'shell' })).status, 400);
  const largeValid = { 'ListTask.java': '// ' + 'Я'.repeat(60000) };
  assert.equal((await app.call(route, 'PATCH', { exerciseRevision: 1, files: largeValid, revision: 0 })).status, 200);
});

test('homework file survives restart, is served only as attachment, and manual review persists', async t => {
  const app = await fixture(t);
  const uploaded = await app.call(BASE + '/homework', 'POST', { filename: 'решение.zip', contentBase64: ZIP.toString('base64'), comment: 'Нужна помощь', repositoryUrl: 'https://github.com/example/homework' });
  assert.equal(uploaded.status, 201);
  const submission = uploaded.body.submission;
  assert.equal(submission.status, 'submitted');
  assert.equal(submission.size, ZIP.length);
  assert.doesNotMatch(JSON.stringify(submission), /blobId|diskPath|storagePath/);
  const restarted = await app.start();
  const download = await fetch(restarted.origin + BASE + `/homework/${submission.id}/file`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), ZIP);
  const reviewed = await restarted.call(BASE + `/homework/${submission.id}`, 'PATCH', { status: 'needs_revision', feedback: 'Добавьте проверки.' }, 'teacher');
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.submission.feedback, 'Добавьте проверки.');
  assert.ok(Date.parse(reviewed.body.submission.reviewedAt));
  const view = await (await app.start()).call(BASE + '/practice');
  assert.equal(view.body.submissions[0].status, 'needs_revision');
  assert.equal(view.body.submissions[0].filename, 'решение.zip');
});

test('homework rejects traversal names, forbidden files, malformed ZIP/base64 and non-HTTPS repositories', async t => {
  const app = await fixture(t);
  const good = { filename: 'Main.java', contentBase64: Buffer.from('class Main{}').toString('base64'), comment: '', repositoryUrl: '' };
  for (const body of [
    { ...good, filename: '../Main.java' }, { ...good, filename: 'C:\\Main.java' }, { ...good, filename: 'file.exe' },
    { ...good, filename: 'bad\r\nname.java' }, { ...good, filename: '.java' }, { ...good, filename: 'file.java.' },
    { ...good, filename: 'CON.java' }, { ...good, filename: 'file.zip' }, { ...good, contentBase64: '@@@@' },
    { ...good, contentBase64: '' }, { ...good, repositoryUrl: 'javascript:alert(1)' },
    { ...good, repositoryUrl: 'http://example.com' }, { ...good, repositoryUrl: 'https://user:pass@example.com' },
    { ...good, path: '/tmp/evil' },
  ]) assert.equal((await app.call(BASE + '/homework', 'POST', body)).status, 400, JSON.stringify(body));
  assert.deepEqual((await app.call(BASE + '/practice')).body.submissions, []);
});

test('homework accepts 20 MiB, rejects one byte more and stays independent of normal JSON limit', async t => {
  const app = await fixture(t);
  const bytes = Buffer.alloc(20 * 1024 * 1024, 65);
  const accepted = await app.call(BASE + '/homework', 'POST', { filename: 'large.txt', contentBase64: bytes.toString('base64') });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.submission.size, 20 * 1024 * 1024);
  const tooLarge = await app.call(BASE + '/homework', 'POST', { filename: 'large.txt', contentBase64: Buffer.alloc(bytes.length + 1).toString('base64') });
  assert.equal(tooLarge.status, 413);
  assert.equal((await app.call(BASE + '/practice')).body.submissions.length, 1);
});

test('attempt/download lookup cannot cross lessons or exercise IDs', async t => {
  const app = await fixture(t);
  const attempt = (await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' })).body.attempt;
  const upload = (await app.call(BASE + '/homework', 'POST', { filename: 'note.txt', contentBase64: 'aGk=' })).body.submission;
  const lesson = app.store.addLesson('michael', { title: 'Другое', date: '2026-10-02', time: '12:00', duration: 60 });
  const otherBase = `/api/students/michael/lessons/${lesson.id}`;
  await app.call(otherBase + '/practice/assignments', 'POST', { assignments: [{ exerciseId: 'list-task', placement: 'class' }] }, 'teacher');
  assert.equal((await app.call(otherBase + `/practice/exercises/list-task/attempts/${attempt.id}`)).status, 404);
  assert.equal((await app.call(BASE + `/practice/exercises/grouping-task/attempts/${attempt.id}`)).status, 404);
  assert.equal((await app.call(otherBase + `/homework/${upload.id}/file`)).status, 404);
  assert.equal((await app.call(otherBase + `/homework/${upload.id}`, 'PATCH', { status: 'reviewed', feedback: '' }, 'teacher')).status, 404);
});

test('malformed request bodies have bounded safe errors and runner failure never reports success', async t => {
  const app = await fixture(t, { run: async () => { throw new Error('PRIVATE C:\\secret\\checker.java'); } });
  for (const [body, type, status] of [['{', 'application/json', 400], ['x', 'text/plain', 415], ['x'.repeat(2 * 1024 * 1024), 'application/json', 413]]) {
    const response = await fetch(app.origin + BASE + '/practice/exercises/list-task/draft', { method: 'PATCH', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const attempt = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'submit' });
  assert.equal(attempt.status, 201);
  assert.equal(attempt.body.attempt.result.status, 'error');
  assert.doesNotMatch(JSON.stringify(attempt.body), /PRIVATE|secret|checker.java/);
});

test('concurrent draft saves reject one stale writer without losing either accepted revision', async t => {
  const app = await fixture(t);
  const outcomes = await Promise.all(['first', 'second'].map(text => app.call(BASE + '/practice/exercises/list-task/draft', 'PATCH', { exerciseRevision: 1, files: { 'ListTask.java': `class ListTask { /* ${text} */ }` }, revision: 0 })));
  assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
  const winner = outcomes.find(item => item.status === 200).body.draft;
  const saved = (await app.call(BASE + '/practice')).body.exercises[0].draft;
  assert.deepEqual(saved.files, winner.files);
  assert.equal(saved.revision, 1);
});

test('result privacy filtering preserves URLs and omits private fields and absolute disk paths', async t => {
  const app = await fixture(t, { run: async () => ({ status: 'wrong_answer', passed: 0, total: 1, elapsedMs: 1, diagnostics: 'C:\\secret\\Checker.java:10 /tmp/private/Checker.java:4', privateSource: 'PRIVATE_CHECKER', tests: [{ name: 'Ссылка', status: 'failed', expected: 'https://example.org/docs', actual: 'http://example.org/docs', source: 'PRIVATE_CHECKER' }] }) });
  const response = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' });
  assert.equal(response.status, 201);
  assert.equal(response.body.attempt.result.tests[0].expected, 'https://example.org/docs');
  assert.equal(response.body.attempt.result.tests[0].actual, 'http://example.org/docs');
  assert.doesNotMatch(JSON.stringify(response.body), /secret|\/tmp\/private|PRIVATE_CHECKER/);
});

test('structured expected and actual results remain visible with bounded public output', async t => {
  const app = await fixture(t, { run: async () => ({ status: 'wrong_answer', passed: 0, total: 1, elapsedMs: 1, tests: [{ name: 'Список', status: 'failed', expected: [2, 2, 5, 7], actual: [7] }, ...Array.from({ length: 100 }, () => ({ name: 'Output', status: 'failed', expected: '\u0001'.repeat(20000), actual: '\u0001'.repeat(20000), stdout: '\u0001'.repeat(20000), message: '\u0001'.repeat(20000) }))] }) });
  const response = await app.call(BASE + '/practice/exercises/list-task/attempts', 'POST', { exerciseRevision: 1, files: FILES, mode: 'run' });
  assert.equal(response.status, 201);
  assert.equal(response.body.attempt.result.tests[0].expected, '[2,2,5,7]');
  assert.equal(response.body.attempt.result.tests[0].actual, '[7]');
  assert.ok(Buffer.byteLength(JSON.stringify(response.body.attempt.result)) < 256 * 1024);
});

test('chunked requests are subject to limits without relying on Content-Length', async t => {
  const app = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(app.origin + BASE + '/practice/exercises/list-task/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    for (let index = 0; index < 40; index++) request.write('x'.repeat(64 * 1024));
    request.end();
  });
  assert.equal(status, 413);
});

test('combined source size is bounded while valid JSON escaping exceeds the old server body limit', async t => {
  const app = await fixture(t);
  app.exercises[0].starterFiles = { 'a/One.java': '', 'b/Two.java': '', 'Three.java': '' };
  const route = BASE + '/practice/exercises/list-task/draft';
  const rejected = await app.call(route, 'PATCH', { exerciseRevision: 1, files: { 'a/One.java': 'x'.repeat(100000), 'b/Two.java': 'x'.repeat(100000), 'Three.java': 'x'.repeat(100000) }, revision: 0 });
  assert.equal(rejected.status, 400);
  const files = { 'a/One.java': '\u0001'.repeat(100000), 'b/Two.java': '', 'Three.java': '' };
  assert.ok(Buffer.byteLength(JSON.stringify(files)) > 256 * 1024);
  assert.equal((await app.call(route, 'PATCH', { exerciseRevision: 1, files, revision: 0 })).status, 200);
});
