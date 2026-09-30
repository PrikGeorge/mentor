'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validPasswordHash } = require('./auth-passwords.cjs');

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
const unavailable = () => fail(503, 'AUTH_UNAVAILABLE', 'Хранилище авторизации занято или закрыто.');
const corrupted = () => fail(500, 'AUTH_UNAVAILABLE', 'Хранилище авторизации повреждено. Проверьте резервную копию accounts.json.bak.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validate(state) {
  if (!object(state) || state.version !== 1 || !Array.isArray(state.accounts) || !Array.isArray(state.invitations) || !Array.isArray(state.resets)) corrupted();
  const ids = new Set(), logins = new Set(), students = new Set(); let teachers = 0;
  for (const a of state.accounts) {
    if (!object(a) || !id(a.id) || ids.has(a.id) || typeof a.login !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(a.login) || logins.has(a.login) || !['teacher', 'student'].includes(a.role) || typeof a.disabled !== 'boolean' || !Number.isSafeInteger(a.authVersion) || a.authVersion < 1 || !date(a.createdAt) || !validPasswordHash(a.passwordHash)) corrupted();
    if (a.role === 'teacher') { if (a.studentId !== null || ++teachers > 1) corrupted(); }
    else { if (!id(a.studentId) || students.has(a.studentId)) corrupted(); students.add(a.studentId); }
    ids.add(a.id); logins.add(a.login);
  }
  const tokenIds = new Set(), hashes = new Set();
  for (const [records, purpose] of [[state.invitations, 'register'], [state.resets, 'reset-password']]) {
    for (const record of records) {
      if (!object(record) || !id(record.id) || tokenIds.has(record.id) || record.purpose !== purpose || typeof record.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.tokenHash) || hashes.has(record.tokenHash) || !date(record.createdAt) || !date(record.expiresAt) || Date.parse(record.expiresAt) <= Date.parse(record.createdAt) || !(record.usedAt === null || date(record.usedAt)) || !(record.revokedAt === null || date(record.revokedAt))) corrupted();
      if (purpose === 'register' ? !id(record.studentId) : !ids.has(record.accountId)) corrupted();
      tokenIds.add(record.id); hashes.add(record.tokenHash);
    }
  }
  return state;
}

function createAuthStore({ dataDir } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) fail(500, 'AUTH_UNAVAILABLE', 'Не указан каталог данных.');
  const directory = path.join(path.resolve(dataDir), 'auth');
  try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch { fail(500, 'AUTH_UNAVAILABLE', 'Не удалось открыть каталог авторизации.'); }
  const file = path.join(directory, 'accounts.json'), lock = path.join(directory, 'accounts.lock');
  const owner = { pid: process.pid, hostname: os.hostname(), nonce: randomUUID() };
  let closed = false;

  function createLock() {
    const fd = fs.openSync(lock, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  try { createLock(); }
  catch (failure) {
    if (failure.code !== 'EEXIST') unavailable();
    // A second exclusive guard prevents two stale-lock reclaimers from deleting
    // each other's new writer lock. Uncertain process status always fails closed.
    const recovery = lock + '.recovery'; let guard;
    try {
      guard = fs.openSync(recovery, 'wx', 0o600);
      const raw = fs.readFileSync(lock, 'utf8'); const previous = JSON.parse(raw);
      if (!object(previous) || previous.hostname !== os.hostname() || !Number.isSafeInteger(previous.pid) || previous.pid < 1 || typeof previous.nonce !== 'string') unavailable();
      let dead = false;
      try { process.kill(previous.pid, 0); } catch (e) { if (e.code === 'ESRCH') dead = true; }
      if (!dead || fs.readFileSync(lock, 'utf8') !== raw) unavailable();
      fs.unlinkSync(lock); createLock();
    } catch { unavailable(); }
    finally {
      if (guard !== undefined) {
        let cleanupFailed = false;
        try { fs.closeSync(guard); } catch { cleanupFailed = true; }
        try { fs.unlinkSync(recovery); } catch { cleanupFailed = true; }
        if (cleanupFailed) { close(); unavailable(); }
      }
    }
  }

  function assertOpen() {
    if (closed) unavailable();
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).nonce !== owner.nonce) unavailable(); }
    catch { unavailable(); }
  }
  function close() {
    if (closed) return; closed = true;
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).nonce === owner.nonce) fs.unlinkSync(lock); }
    catch { /* Never remove an uncertain or replaced lock. */ }
  }
  function read() {
    assertOpen();
    try { return validate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { corrupted(); }
  }
  function syncedFile(target, bytes) {
    const descriptor = fs.openSync(target, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  }
  function write(state, backup) {
    const temporary = path.join(directory, `.accounts-${randomUUID()}.tmp`);
    const previous = temporary + '.bak';
    try {
      syncedFile(temporary, JSON.stringify(state, null, 2) + '\n');
      if (backup) { syncedFile(previous, fs.readFileSync(file)); fs.renameSync(previous, file + '.bak'); }
      fs.renameSync(temporary, file);
    } catch { fail(500, 'AUTH_UNAVAILABLE', 'Не удалось сохранить авторизацию. Данные не изменены.'); }
    finally { for (const target of [temporary, previous]) { try { fs.unlinkSync(target); } catch {} } }
  }
  try {
    if (!fs.existsSync(file)) {
      if (fs.existsSync(file + '.bak')) corrupted();
      write({ version: 1, accounts: [], invitations: [], resets: [] }, false);
    }
    read();
  } catch (failure) { close(); throw failure; }
  let updating = false;
  return {
    read,
    update(mutator) {
      assertOpen();
      if (typeof mutator !== 'function' || updating) fail(500, 'AUTH_UNAVAILABLE', 'Нужна синхронная транзакция.');
      updating = true;
      try {
        const state = read(); const result = mutator(state);
        if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); fail(500, 'AUTH_UNAVAILABLE', 'Асинхронная транзакция запрещена.'); }
        validate(state); assertOpen(); write(state, true); return result;
      } finally { updating = false; }
    },
    close,
  };
}
module.exports = { createAuthStore };
