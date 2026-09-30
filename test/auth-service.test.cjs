'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuthService } = require('../lib/auth-service.cjs');
const { hashPassword, verifyPassword } = require('../lib/auth-passwords.cjs');
const PASSWORD = 'correct password with spaces';
const NEXT = 'a different long password';
const HOUR = 3600000;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-auth-service-'));
  fs.mkdirSync(path.join(dir, 'practice'));
  fs.writeFileSync(path.join(dir, 'mentoring.json'), '{"unchanged":"learning history"}');
  fs.writeFileSync(path.join(dir, 'practice', 'draft.json'), '{"code":"previous solution"}');
  const students = new Map([['first', { id: 'first' }], ['second', { id: 'second' }]]);
  let now = Date.parse('2026-09-30T12:00:00.000Z');
  const options = { dataDir: dir, getStudent: id => students.get(id) || null, clock: () => now };
  const auth = createAuthService(options);
  t.after(() => { auth.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { auth, dir, students, options, tick: ms => { now += ms; } };
}
async function teacher(auth) {
  await auth.setupTeacher({ login: ' Teacher ', password: PASSWORD });
  const issued = await auth.login({ login: 'TEACHER', password: PASSWORD });
  return auth.session(issued.token).principal;
}
async function student(auth, principal, id = 'first', login = 'student') {
  const invite = auth.invite(principal, id);
  return auth.register({ token: invite.token, login, password: PASSWORD });
}
const status = wanted => e => e.status === wanted && typeof e.code === 'string';

test('password hashes use distinct salts and verify without trimming or normalizing', async () => {
  const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
  assert.notEqual(a.saltBase64, b.saltBase64);
  assert.deepEqual([a.algorithm, a.N, a.r, a.p], ['scrypt', 131072, 8, 1]);
  assert.equal(Buffer.from(a.hashBase64, 'base64').length, 64);
  assert.equal(Buffer.from(a.saltBase64, 'base64').length, 16);
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword('wrong password with spaces', a), false);
  const spaced = await hashPassword(' ' + PASSWORD + ' ');
  assert.equal(await verifyPassword(PASSWORD, spaced), false);
  const unicode = await hashPassword('😀'.repeat(128));
  assert.equal(await verifyPassword('😀'.repeat(128), unicode), true);
  const longerPassword = await hashPassword('x'.repeat(15));
  assert.equal(await verifyPassword('x'.repeat(15), longerPassword), true);
  const composed = await hashPassword('é'.repeat(15));
  assert.equal(await verifyPassword('e\u0301'.repeat(15), composed), false);
  for (const bad of ['x'.repeat(7), 'x'.repeat(129), '😀'.repeat(129), '\ud800'.repeat(15), null]) {
    await assert.rejects(hashPassword(bad), status(400));
  }
});

test('password minimum is eight Unicode code points and whitespace remains significant', async () => {
  for (const bad of ['1234567', '😀'.repeat(7)]) {
    await assert.rejects(hashPassword(bad), status(400));
  }
  for (const password of ['12345678', '😀'.repeat(8), ' 123456 ']) {
    const hash = await hashPassword(password);
    assert.equal(await verifyPassword(password, hash), true);
    if (password.trim() !== password) assert.equal(await verifyPassword(password.trim(), hash), false);
  }
});

test('eight-character passwords work throughout teacher and student service lifecycles', async t => {
  const { auth } = fixture(t);
  await assert.rejects(auth.setupTeacher({ login: 'teacher', password: '1234567' }), status(400));
  await auth.setupTeacher({ login: 'teacher', password: '12345678' });
  const teacherLogin = await auth.login({ login: 'teacher', password: '12345678' });
  const principal = auth.session(teacherLogin.token).principal;
  const invite = auth.invite(principal, 'first');
  await assert.rejects(auth.register({ token: invite.token, login: 'student', password: '1234567' }), status(400));
  const registered = await auth.register({ token: invite.token, login: 'student', password: 'abcdefgh' });
  const pupil = auth.session(registered.token).principal;
  await assert.rejects(auth.changePassword(pupil, { currentPassword: 'abcdefgh', newPassword: '1234567' }), status(400));
  const changed = await auth.changePassword(pupil, { currentPassword: 'abcdefgh', newPassword: 'ijklmnop' });
  assert.equal(auth.session(registered.token), null);
  assert.ok(auth.session(changed.token));
  assert.ok(await auth.login({ login: 'student', password: 'ijklmnop' }));
  const reset = await auth.issueReset(principal, 'first', '12345678');
  await assert.rejects(auth.resetPassword({ token: reset.token, newPassword: '1234567' }), status(400));
  await auth.resetPassword({ token: reset.token, newPassword: 'qrstuvwx' });
  assert.equal(auth.session(changed.token), null);
  assert.ok(await auth.login({ login: 'student', password: 'qrstuvwx' }));
  await assert.rejects(auth.resetTeacherPassword({ login: 'teacher', newPassword: '1234567' }), status(400));
  await auth.resetTeacherPassword({ login: 'teacher', newPassword: '87654321' });
  assert.equal(auth.session(teacherLogin.token), null);
  assert.ok(await auth.login({ login: 'teacher', password: '87654321' }));
});

test('KDF limits bound work to two active and eight waiting tasks', async () => {
  const pending = Array.from({ length: 11 }, () => hashPassword(PASSWORD));
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 429).length, 1);
});

test('registration binds only invited existing card and does not touch learning files', async t => {
  const { auth, dir } = fixture(t);
  const principal = await teacher(auth);
  const before = ['mentoring.json', 'practice/draft.json'].map(file => fs.readFileSync(path.join(dir, file)));
  const invite = auth.invite(principal, 'first');
  for (const extra of [{ role: 'teacher' }, { studentId: 'second' }]) {
    await assert.rejects(auth.register({ token: invite.token, login: ' Student ', password: PASSWORD, ...extra }), status(400));
  }
  const issued = await auth.register({ token: invite.token, login: ' Student ', password: PASSWORD });
  assert.equal(issued.account.login, 'student'); assert.equal(issued.account.role, 'student');
  assert.equal(issued.account.studentId, 'first');
  assert.deepEqual(Object.keys(issued.account).sort(), ['id', 'login', 'role', 'studentId']);
  assert.equal(auth.session(issued.token).csrfToken, issued.csrfToken);
  ['mentoring.json', 'practice/draft.json'].forEach((file, i) => assert.deepEqual(fs.readFileSync(path.join(dir, file)), before[i]));
  const raw = fs.readFileSync(path.join(dir, 'auth/accounts.json'), 'utf8');
  for (const secret of [PASSWORD, invite.token, issued.token, issued.csrfToken]) assert.equal(raw.includes(secret), false);
  await assert.rejects(auth.setupTeacher({ login: 'other', password: PASSWORD }), status(409));
  assert.throws(() => auth.invite(principal, 'first'), status(409));
});

test('concurrent redemption yields exactly one account and one session', async t => {
  const { auth, dir } = fixture(t); const principal = await teacher(auth);
  const invite = auth.invite(principal, 'first');
  const input = { token: invite.token, login: 'student', password: PASSWORD };
  const results = await Promise.allSettled([auth.register(input), auth.register(input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'auth/accounts.json'))).accounts.length, 2);
  await assert.rejects(auth.register(input), status(400));
});

test('failed commit does not consume invite or create usable session', async t => {
  const { auth, dir } = fixture(t); const principal = await teacher(auth);
  const invite = auth.invite(principal, 'first'); const before = fs.readFileSync(path.join(dir, 'auth/accounts.json'), 'utf8');
  const rename = fs.renameSync; fs.renameSync = (from, to) => { if (to === path.join(dir, 'auth/accounts.json')) throw new Error('simulated final replacement error'); return rename(from, to); };
  try { await assert.rejects(auth.register({ token: invite.token, login: 'student', password: PASSWORD }), status(500)); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(dir, 'auth/accounts.json'), 'utf8'), before);
  assert.equal((await auth.register({ token: invite.token, login: 'student', password: PASSWORD })).account.studentId, 'first');
});

test('new invite revokes prior one; expiry and explicit revoke reject redemption', async t => {
  const { auth, tick } = fixture(t); const principal = await teacher(auth);
  const first = auth.invite(principal, 'first'); const next = auth.invite(principal, 'first');
  await assert.rejects(auth.register({ token: first.token, login: 'student', password: PASSWORD }), status(400));
  auth.revokeInvite(principal, 'first', next.id);
  assert.equal(auth.access(principal, 'first').invitation, null);
  await assert.rejects(auth.register({ token: next.token, login: 'student', password: PASSWORD }), status(400));
  const expiring = auth.invite(principal, 'first'); tick(72 * HOUR);
  await assert.rejects(auth.register({ token: expiring.token, login: 'student', password: PASSWORD }), status(400));
});

test('teacher authorization, owner sessions and existing cards are checked in service', async t => {
  const { auth, students } = fixture(t); const principal = await teacher(auth);
  const issued = await student(auth, principal); const pupil = auth.session(issued.token).principal;
  for (const operation of [() => auth.access(pupil, 'first'), () => auth.invite(pupil, 'second'), () => auth.revokeInvite(pupil, 'first', 'id'), () => auth.setDisabled(pupil, 'first', true)]) assert.throws(operation, status(403));
  await assert.rejects(auth.issueReset(pupil, 'first', PASSWORD), status(403));
  assert.throws(() => auth.access({ ...pupil, role: 'teacher' }, 'first'), status(401));
  assert.throws(() => auth.access(principal, 'missing'), status(404));
  students.delete('first'); assert.equal(auth.session(issued.token), null);
  assert.throws(() => auth.assertActive(pupil), status(401));
});

test('disabled account login is generic and re-enabling does not revive revoked sessions', async t => {
  const { auth } = fixture(t); const principal = await teacher(auth);
  const issued = await student(auth, principal); const pupil = auth.session(issued.token).principal;
  const unknown = await auth.login({ login: 'unknown', password: PASSWORD }).catch(e => e);
  const wrong = await auth.login({ login: 'student', password: NEXT }).catch(e => e);
  auth.setDisabled(principal, 'first', true);
  const blocked = await auth.login({ login: 'student', password: PASSWORD }).catch(e => e);
  assert.equal(unknown.code, wrong.code); assert.equal(blocked.code, wrong.code); assert.equal(blocked.message, unknown.message);
  assert.equal(auth.session(issued.token), null); assert.throws(() => auth.assertActive(pupil), status(401));
  auth.setDisabled(principal, 'first', false); assert.equal(auth.session(issued.token), null);
  assert.equal((await auth.login({ login: 'student', password: PASSWORD })).account.id, issued.account.id);
});

test('unknown login performs scrypt with real dummy parameters', async t => {
  const { auth } = fixture(t);
  const scrypt = crypto.scrypt; let observed;
  crypto.scrypt = function(password, salt, length, options, callback) { observed = { length, ...options }; return scrypt.call(this, password, salt, length, options, callback); };
  try { await assert.rejects(auth.login({ login: 'unknown', password: PASSWORD }), status(401)); }
  finally { crypto.scrypt = scrypt; }
  assert.deepEqual(observed, { length: 64, N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
});

test('session idle and absolute limits reject exactly at the deadline', async t => {
  const { auth, tick } = fixture(t); await teacher(auth);
  const idle = await auth.login({ login: 'teacher', password: PASSWORD }); tick(8 * HOUR);
  assert.equal(auth.session(idle.token), null);
  const absolute = await auth.login({ login: 'teacher', password: PASSWORD });
  for (let i = 0; i < 23; i++) { tick(7 * HOUR); assert.ok(auth.session(absolute.token)); }
  tick(7 * HOUR); assert.equal(auth.session(absolute.token), null);
});

test('sixth session evicts oldest, logout and restart revoke memory sessions', async t => {
  const { auth, tick, options } = fixture(t); await teacher(auth);
  const issued = [];
  for (let i = 0; i < 6; i++) { tick(1); issued.push(await auth.login({ login: 'teacher', password: PASSWORD })); }
  assert.equal(auth.session(issued[0].token), null); assert.ok(auth.session(issued[1].token));
  auth.logout(issued[1].token); assert.equal(auth.session(issued[1].token), null);
  auth.close(); const next = createAuthService(options);
  try { assert.equal(next.session(issued[5].token), null); }
  finally { next.close(); }
});

test('password change revokes all old sessions and requires current password', async t => {
  const { auth } = fixture(t); const principal = await teacher(auth);
  const issued = await student(auth, principal); const extra = await auth.login({ login: 'student', password: PASSWORD });
  const pupil = auth.session(issued.token).principal;
  await assert.rejects(auth.changePassword(pupil, { currentPassword: NEXT, newPassword: NEXT }), status(401));
  const next = await auth.changePassword(pupil, { currentPassword: PASSWORD, newPassword: NEXT });
  assert.equal(auth.session(issued.token), null); assert.equal(auth.session(extra.token), null); assert.ok(auth.session(next.token));
  await assert.rejects(auth.login({ login: 'student', password: PASSWORD }), status(401));
  assert.ok(await auth.login({ login: 'student', password: NEXT }));
});

test('reset requires teacher password, expires at thirty minutes and invalidates all sessions', async t => {
  const { auth, tick } = fixture(t); let principal = await teacher(auth);
  const issued = await student(auth, principal);
  await assert.rejects(auth.issueReset(principal, 'first', NEXT), status(401));
  const old = await auth.issueReset(principal, 'first', PASSWORD); const reset = await auth.issueReset(principal, 'first', PASSWORD);
  await assert.rejects(auth.resetPassword({ token: old.token, newPassword: NEXT }), status(400));
  await auth.resetPassword({ token: reset.token, newPassword: NEXT });
  assert.equal(auth.session(issued.token), null);
  await assert.rejects(auth.resetPassword({ token: reset.token, newPassword: PASSWORD }), status(400));
  assert.ok(await auth.login({ login: 'student', password: NEXT }));
  const expires = await auth.issueReset(principal, 'first', PASSWORD); tick(HOUR / 2);
  await assert.rejects(auth.resetPassword({ token: expires.token, newPassword: PASSWORD }), status(400));
  await auth.resetTeacherPassword({ login: ' TEACHER ', newPassword: NEXT });
  assert.throws(() => auth.assertActive(principal), status(401));
  assert.ok(await auth.login({ login: 'teacher', password: NEXT }));
});

test('session or card revoked while KDF runs cannot complete protected change or registration', async t => {
  const { auth, students } = fixture(t); const principal = await teacher(auth);
  const issued = await student(auth, principal); const pupil = auth.session(issued.token).principal;
  const pending = auth.changePassword(pupil, { currentPassword: PASSWORD, newPassword: NEXT });
  auth.logout(issued.token); await assert.rejects(pending, status(401));
  const invitation = auth.invite(principal, 'second');
  const register = auth.register({ token: invitation.token, login: 'another', password: PASSWORD });
  students.delete('second'); await assert.rejects(register, status(404));
});
