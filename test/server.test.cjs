'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createServer } = require('../server.cjs');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-server-test-'));
  const dataDir = path.join(dir, 'data');
  const staticDir = path.join(dir, 'dist');
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Урок</title>');
  fs.writeFileSync(path.join(staticDir, 'example.java'), 'class Example {}');
  fs.writeFileSync(path.join(staticDir, 'content.js'), 'PRIVATE_CONTENT');
  fs.writeFileSync(path.join(staticDir, 'student.html'), 'PRIVATE_STUDENT_HTML');
  fs.mkdirSync(path.join(staticDir, 'downloads'));
  fs.writeFileSync(path.join(staticDir, 'downloads', 'old.zip'), 'PRIVATE_ZIP');
  fs.writeFileSync(path.join(dir, 'private.txt'), 'PRIVATE');
  const servers = [];
  let teacherReady = false;
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('mentor-server-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function start() {
    const server = createServer({ dataDir, staticDir });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (!teacherReady) { await server.auth.setupTeacher({ login: 'teacher', password: 'Passphrase-for-tests-2026!' }); teacherReady = true; }
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Mentor-Client': 'web' }, body: JSON.stringify({ login: 'teacher', password: 'Passphrase-for-tests-2026!' }) });
    assert.equal(login.status, 200);
    const { account, csrfToken } = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    return {
      server, origin,
      async call(route, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(origin + route, { method, headers: { Cookie: cookie, 'X-Mentor-Client': 'web', ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin, 'X-Mentor-Account': account.id, 'X-CSRF-Token': csrfToken } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, headers: response.headers, body: await response.json() };
      },
      authHeaders: { Cookie: cookie, Origin: origin, 'X-Mentor-Client': 'web', 'X-Mentor-Account': account.id, 'X-CSRF-Token': csrfToken },
      async registerStudent(studentId, loginName) {
        const principal = server.auth.session(cookie.split('=')[1]).principal;
        const invitation = server.auth.invite(principal, studentId);
        const registration = await fetch(origin + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Mentor-Client': 'web' }, body: JSON.stringify({ token: invitation.token, login: loginName, password: 'Student-passphrase-2026!' }) });
        assert.equal(registration.status, 201);
        const identity = await registration.json();
        const studentCookie = registration.headers.get('set-cookie').split(';')[0];
        return async (route, { method = 'GET', body } = {}) => {
          const response = await fetch(origin + route, { method, headers: { Cookie: studentCookie, 'X-Mentor-Client': 'web', ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin, 'X-Mentor-Account': identity.account.id, 'X-CSRF-Token': identity.csrfToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
          return { status: response.status, body: await response.json() };
        };
      },
    };
  }
  return { dir, dataDir, staticDir, start, ...(await start()) };
}

test('health identifies local application and state returns persisted initial lesson', async t => {
  const app = await fixture(t);
  assert.deepEqual((await app.call('/api/health')).body, { app: 'mentor-local', version: 1 });
  const state = await app.call('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.students[0].name, 'Михаэль');
  assert.equal(state.body.lessons[0].bundleId, 'library-2026-09-27');
  assert.equal(state.headers.get('cache-control'), 'no-store');
});

for (const [label, route, method, body] of [
  ['card creation', '/api/students', 'POST', { name: 'Late mutation' }],
  ['card update', '/api/students/michael', 'PATCH', { notes: 'Late mutation' }],
  ['lesson creation', '/api/students/michael/lessons', 'POST', { title: 'Late mutation', date: '2026-10-11', time: '10:00', duration: 60 }],
  ['lesson update', '/api/students/michael/lessons/lesson-2026-09-27', 'PATCH', { teacherNotes: 'Late mutation' }],
]) test(`revoking the teacher while ${label} body is pending prevents write and private response`, async t => {
  const app = await fixture(t);
  const file = path.join(app.dataDir, 'mentoring.json');
  const before = fs.readFileSync(file);
  let sawInitialCheck;
  const initialCheck = new Promise(resolve => { sawInitialCheck = resolve; });
  const originalAssert = app.server.auth.assertActive.bind(app.server.auth);
  app.server.auth.assertActive = principal => { const result = originalAssert(principal); sawInitialCheck(); return result; };
  const payload = JSON.stringify(body);
  let request;
  const responsePromise = new Promise((resolve, reject) => {
    request = http.request(app.origin + route, { method, headers: { ...app.authHeaders, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
  });
  request.write(payload.slice(0, 9));
  await initialCheck;
  app.server.auth.logout(app.authHeaders.Cookie.split('=')[1]);
  request.end(payload.slice(9));
  const result = await responsePromise;
  assert.equal(result.status, 401);
  assert.doesNotMatch(JSON.stringify(result.body), /Late mutation/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('students receive only their own projected state and cannot mutate cards or read another practice', async t => {
  const app = await fixture(t);
  await app.call('/api/students/michael', { method: 'PATCH', body: { notes: 'PRIVATE_A', studentRoadmap: 'ROADMAP_A' } });
  await app.call('/api/students/michael/lessons/lesson-2026-09-27', { method: 'PATCH', body: { teacherNotes: 'TEACHER_A', studentNotes: 'STUDENT_A' } });
  const b = (await app.call('/api/students', { method: 'POST', body: { name: 'B', notes: 'PRIVATE_B', studentRoadmap: 'ROADMAP_B' } })).body.student;
  const lessonB = (await app.call(`/api/students/${b.id}/lessons`, { method: 'POST', body: { title: 'B lesson', date: '2026-10-10', time: '14:00', duration: 60, teacherNotes: 'TEACHER_B' } })).body.lesson;
  const aCall = await app.registerStudent('michael', 'student-a');
  const bCall = await app.registerStudent(b.id, 'student-b');
  assert.equal((await fetch(app.origin + '/api/state')).status, 401);
  const a = await aCall('/api/state');
  const bState = await bCall('/api/state');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.students.map(item => item.id), ['michael']);
  assert.deepEqual(a.body.lessons.map(item => item.id), ['lesson-2026-09-27']);
  assert.equal(a.body.students[0].studentRoadmap, 'ROADMAP_A');
  assert.equal(a.body.lessons[0].studentNotes, 'STUDENT_A');
  assert.doesNotMatch(JSON.stringify(a.body), /PRIVATE_|TEACHER_|ROADMAP_B|B lesson/);
  assert.deepEqual(bState.body.students.map(item => item.id), [b.id]);
  assert.deepEqual(bState.body.lessons.map(item => item.id), [lessonB.id]);
  assert.doesNotMatch(JSON.stringify(bState.body), /PRIVATE_|TEACHER_|ROADMAP_A|STUDENT_A/);
  const teachingFile = path.join(app.dataDir, 'mentoring.json');
  const before = createHash('sha256').update(fs.readFileSync(teachingFile)).digest('hex');
  const practiceState = path.join(app.dataDir, 'practice', 'state.json');
  assert.equal(fs.existsSync(practiceState), false);
  assert.equal((await aCall('/api/practice/catalog')).status, 403);
  assert.equal((await aCall(`/api/students/${b.id}/lessons/${lessonB.id}/practice`)).status, 404);
  assert.equal(fs.existsSync(practiceState), false);
  assert.equal((await aCall('/api/students/michael', { method: 'PATCH', body: { notes: 'tamper' } })).status, 403);
  assert.equal(createHash('sha256').update(fs.readFileSync(teachingFile)).digest('hex'), before);
  assert.equal((await app.call('/api/state')).body.students.find(item => item.id === 'michael').notes, 'PRIVATE_A');
});

test('private content and downloads follow the authenticated owner, including HEAD', async t => {
  const app = await fixture(t);
  const b = (await app.call('/api/students', { method: 'POST', body: { name: 'B' } })).body.student;
  const aCall = await app.registerStudent('michael', 'student-a');
  const bCall = await app.registerStudent(b.id, 'student-b');
  const teacherContent = await app.call('/api/content');
  assert.equal(teacherContent.status, 200);
  assert.ok(Object.keys(teacherContent.body.docs).length > 0);
  const own = await aCall('/api/content');
  assert.equal(own.status, 200);
  assert.ok(Object.keys(own.body.docs).length > 0);
  assert.equal(Object.hasOwn(own.body.viewData, 'teacher'), false);
  const other = await bCall('/api/content');
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.docs, {});
  assert.deepEqual(other.body.code, {});
  assert.equal((await fetch(app.origin + '/api/content')).status, 401);
  const head = await fetch(app.origin + '/api/content', { method: 'HEAD', headers: { Cookie: app.authHeaders.Cookie } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const publicDownload = await fetch(app.origin + '/api/materials/student-lesson-2026-09-27');
  assert.equal(publicDownload.status, 401);
});

test('profile edits remain after HTTP server restart using the same local data directory', async t => {
  const app = await fixture(t);
  const created = await app.call('/api/students', { method: 'POST', body: { name: 'Анна', goal: 'Java' } });
  assert.equal(created.status, 201);
  const id = created.body.student.id;
  const patched = await app.call(`/api/students/${id}`, { method: 'PATCH', body: { notes: 'Новая заметка', schedule: 'Вторник' } });
  assert.equal(patched.status, 200);
  await new Promise(resolve => app.server.close(resolve));
  const restarted = await app.start();
  const state = (await restarted.call('/api/state')).body;
  assert.equal(state.students.find(student => student.id === id).notes, 'Новая заметка');
  assert.equal(state.students.length, 2);
});

test('HTTP validation returns comprehensible JSON without mutating state', async t => {
  const app = await fixture(t);
  const invalid = await app.call('/api/students', { method: 'POST', body: { name: '   ' } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /Имя/);
  assert.equal((await app.call('/api/state')).body.students.length, 1);
  const readonly = await app.call('/api/students/michael', { method: 'PATCH', body: { id: 'changed' } });
  assert.equal(readonly.status, 400);
});

test('lesson endpoints keep student ownership and prepared materials separate', async t => {
  const app = await fixture(t);
  const student = (await app.call('/api/students', { method: 'POST', body: { name: 'Олег' } })).body.student;
  const create = await app.call(`/api/students/${student.id}/lessons`, { method: 'POST', body: { title: 'Первое занятие', date: '2026-10-01', time: '15:00', duration: 60 } });
  assert.equal(create.status, 201);
  const lesson = create.body.lesson;
  assert.equal(lesson.bundleId, null);
  assert.equal(lesson.teacherNotes, '');
  assert.equal(lesson.studentNotes, '');
  const wrongStudent = await app.call(`/api/students/michael/lessons/${lesson.id}`, { method: 'PATCH', body: { title: 'Не тот ученик' } });
  assert.equal(wrongStudent.status, 404);
  const own = await app.call(`/api/students/${student.id}/lessons/${lesson.id}`, { method: 'PATCH', body: { teacherNotes: 'Спросить о HashMap', studentNotes: 'Подготовить пример' } });
  assert.equal(own.status, 200);
  assert.equal(own.body.lesson.teacherNotes, 'Спросить о HashMap');
  const readonly = await app.call('/api/students/michael/lessons/lesson-2026-09-27', { method: 'PATCH', body: { bundleId: null } });
  assert.equal(readonly.status, 400);
  assert.equal((await app.call('/api/state')).body.lessons[0].bundleId, 'library-2026-09-27');
});

test('cross-origin, opaque origin and cross-site writes cannot change local records', async t => {
  const app = await fixture(t);
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: 'null' }, { Origin: app.origin, 'Sec-Fetch-Site': 'cross-site' }]) {
    const result = await app.call('/api/students', { method: 'POST', body: { name: 'Чужой запрос' }, headers });
    assert.equal(result.status, 403);
  }
  assert.equal((await app.call('/api/state')).body.students.length, 1);
  // Node fetch replaces Host; a raw HTTP request exercises the actual guard.
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(app.origin + '/api/state', { headers: { Host: 'other.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
});

test('write endpoints reject non-JSON, malformed JSON and oversized bodies', async t => {
  const app = await fixture(t);
  for (const [route, method] of [['/api/students', 'POST'], ['/api/students/michael', 'PATCH']]) for (const [body, type, expected] of [['name=Anna', 'application/x-www-form-urlencoded', 415], ['{broken', 'application/json', 400], [' '.repeat(256 * 1024 - 1) + '{}', 'application/json', 413]]) {
    const response = await fetch(app.origin + route, { method, headers: { ...app.authHeaders, 'Content-Type': type }, body });
    assert.equal(response.status, expected);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await app.call('/api/state')).body.students.length, 1);
});

for (const [method, expected] of [['POST', 201], ['PATCH', 200]]) test(`${method} saves all three lesson notes at 200,000 units with UTF-8 and worst-case JSON escaping`, async t => {
  const app = await fixture(t);
  const route = '/api/students/michael/lessons' + (method === 'PATCH' ? '/lesson-2026-09-27' : '');
  const input = { title: 'Большой Markdown', date: '2026-10-01', time: '12:00', duration: 60 };
  const markdown = '    汉字😀\r\n\r\nParagraph with hard break  \r\nnext line\r\n'.repeat(5000).slice(0, 199996) + '  \r\n';
  // A control character takes six bytes when JSON.stringify escapes it.
  for (const notes of [markdown, '\u0000'.repeat(200000)]) {
    assert.equal(notes.length, 200000);
    const body = { ...input, teacherNotes: notes, studentNotes: notes, reviewNotes: notes };
    assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') > 256 * 1024);
    const result = await app.call(route, { method, body });
    assert.equal(result.status, expected);
    const saved = (await app.call('/api/state')).body.lessons.find(item => item.id === result.body.lesson.id);
    for (const field of ['teacherNotes', 'studentNotes', 'reviewNotes']) {
      assert.equal(result.body.lesson[field], notes);
      assert.equal(saved[field], notes);
    }
  }
});

test('lesson HTTP writes reject each note above 200,000 units without changing data or backup', async t => {
  const app = await fixture(t);
  const input = { title: 'Урок', date: '2026-10-01', time: '12:00', duration: 60 };
  await app.call('/api/students/michael/lessons/lesson-2026-09-27', { method: 'PATCH', body: { teacherNotes: 'Сохранённый текст' } });
  const file = path.join(app.dataDir, 'mentoring.json');
  const before = fs.readFileSync(file);
  const backup = fs.readFileSync(file + '.bak');
  for (const method of ['POST', 'PATCH']) for (const field of ['teacherNotes', 'studentNotes', 'reviewNotes']) {
    const route = '/api/students/michael/lessons' + (method === 'PATCH' ? '/lesson-2026-09-27' : '');
    const result = await app.call(route, { method, body: { ...input, [field]: '汉'.repeat(200001) } });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /200000/);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readFileSync(file + '.bak'), backup);
  }
});

for (const [label, route, method, maximum] of [
  ['lesson creation', '/api/students/michael/lessons', 'POST', 4 * 1024 * 1024],
  ['lesson update', '/api/students/michael/lessons/lesson-2026-09-27', 'PATCH', 4 * 1024 * 1024],
  ['profile creation', '/api/students', 'POST', 256 * 1024],
  ['profile update', '/api/students/michael', 'PATCH', 256 * 1024],
]) test(`${label} rejects a body one byte above its limit with and without Content-Length`, async t => {
  const app = await fixture(t);
  const file = path.join(app.dataDir, 'mentoring.json');
  const before = fs.readFileSync(file);
  const payload = ' '.repeat(maximum - 1) + '{}';
  for (const knownLength of [true, false]) {
    const result = await new Promise((resolve, reject) => {
      const request = http.request(app.origin + route, { method, headers: { ...app.authHeaders, 'Content-Type': 'application/json', ...(knownLength ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      request.on('error', reject);
      request.write(payload.slice(0, payload.length - 1));
      request.end(payload.slice(-1));
    });
    assert.equal(result.status, 413);
    assert.equal(typeof result.body.error, 'string');
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test('static files are UTF-8, cannot expose storage or escape the static root', async t => {
  const app = await fixture(t);
  const home = await fetch(app.origin + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html; charset=utf-8/);
  assert.match(await home.text(), /Урок/);
  const java = await fetch(app.origin + '/example.java');
  assert.equal(java.status, 404);
  for (const route of ['/content.js', '/student.html', '/downloads/old.zip']) for (const method of ['GET', 'HEAD']) {
    const result = await fetch(app.origin + route, { method });
    assert.equal(result.status, 404, `${method} ${route}`);
    assert.doesNotMatch(await result.text(), /PRIVATE_/);
  }
  for (const route of ['/data/mentoring.json', '/..%2fprivate.txt', '/.git/config', '/%2e%2e%5cprivate.txt']) {
    const response = await fetch(app.origin + route);
    assert.ok([400, 403, 404].includes(response.status), `Protected route ${route}`);
    assert.doesNotMatch(await response.text(), /PRIVATE|Михаэль/);
  }
});

test('corrupt storage after start produces safe error and is never overwritten by a write', async t => {
  const app = await fixture(t);
  const file = path.join(app.dataDir, 'mentoring.json');
  fs.writeFileSync(file, '{broken');
  const result = await app.call('/api/students', { method: 'POST', body: { name: 'Анна' } });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /повреждён/);
  assert.ok(!result.body.error.includes(app.dir));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('unknown records and unsupported routes fail instead of creating or deleting anything', async t => {
  const app = await fixture(t);
  const missing = await app.call('/api/students/missing', { method: 'PATCH', body: { name: 'Нет' } });
  assert.equal(missing.status, 404);
  const remove = await app.call('/api/students/michael', { method: 'DELETE' });
  assert.equal(remove.status, 415);
  const unknown = await app.call('/api/unknown');
  assert.equal(unknown.status, 404);
  assert.equal((await app.call('/api/state')).body.students.length, 1);
});
