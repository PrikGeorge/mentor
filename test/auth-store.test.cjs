'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAuthStore } = require('../lib/auth-store.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-auth-store-'));
  const store = createAuthStore({ dataDir: dir });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, file: path.join(dir, 'auth', 'accounts.json') };
}

test('transactions reject promises and invalid states without modifying disk', t => {
  const { store, file } = fixture(t);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => store.update(async state => { state.accounts.push({}); }), e => e.status === 500);
  assert.throws(() => store.update(state => { state.accounts.push({}); }), e => e.status === 500);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const read = store.read(); read.accounts.push({});
  assert.equal(store.read().accounts.length, 0);
});

test('atomic replacement failure preserves prior state and previous backup', t => {
  const { store, file } = fixture(t);
  store.update(() => {});
  const before = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === file) throw new Error('simulated final replacement failure'); return rename(from, to); };
  try { assert.throws(() => store.update(() => {}), e => e.status === 500); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), before);
  assert.equal(store.read().version, 1);
});

test('second writer fails until close releases its lock', t => {
  const { dir, store } = fixture(t);
  assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 503);
  store.close();
  assert.throws(() => store.read(), e => e.status === 503);
  const next = createAuthStore({ dataDir: dir }); next.close();
});

test('malformed JSON and invalid schema fail closed and retain original bytes', t => {
  const { dir, file, store } = fixture(t);
  store.close();
  for (const bad of ['{"version":', '{"version":1,"accounts":[],"invitations":[],"resets":[{}]}']) {
    fs.writeFileSync(file, bad);
    assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 500);
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
  }
});

test('proven dead same-host writer is recovered, malformed lock is not', t => {
  const { dir, store } = fixture(t);
  store.close();
  const modulePath = path.resolve(__dirname, '../lib/auth-store.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).createAuthStore({dataDir:process.argv[1]}); process.exit(0);`, dir], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const next = createAuthStore({ dataDir: dir }); next.close();
  const lock = path.join(dir, 'auth', 'accounts.lock');
  fs.writeFileSync(lock, 'damaged');
  assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 503);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'damaged');
});

test('missing primary file with an existing backup is not silently reset', t => {
  const { dir, store, file } = fixture(t);
  store.update(() => {}); store.close(); fs.unlinkSync(file);
  assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 500);
  assert.equal(fs.existsSync(file), false);
});

test('filesystem initialization failures expose a structured storage error', t => {
  const { dir } = fixture(t);
  const blocked = path.join(dir, 'not-a-directory'); fs.writeFileSync(blocked, 'existing file');
  assert.throws(() => createAuthStore({ dataDir: blocked }), e => e.status === 500 && e.code === 'AUTH_UNAVAILABLE');
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'existing file');
});

test('failed recovery guard removal reports structured error and releases newly owned writer lock', t => {
  const { dir, file, store } = fixture(t); store.close();
  const modulePath = path.resolve(__dirname, '../lib/auth-store.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).createAuthStore({dataDir:process.argv[1]}); process.exit(0);`, dir], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const lock = path.join(dir, 'auth/accounts.lock'), recovery = lock + '.recovery';
  const before = fs.readFileSync(file, 'utf8');
  const unlink = fs.unlinkSync;
  fs.unlinkSync = target => {
    if (target === recovery) throw Object.assign(new Error('simulated recovery guard denial'), { code: 'EACCES' });
    return unlink(target);
  };
  try { assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 503 && e.code === 'AUTH_UNAVAILABLE'); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.existsSync(recovery), true);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.unlinkSync(recovery);
  const next = createAuthStore({ dataDir: dir }); next.close();
});

test('recovery cleanup never releases a replaced writer lock owned by another process', t => {
  const { dir, store } = fixture(t); store.close();
  const modulePath = path.resolve(__dirname, '../lib/auth-store.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).createAuthStore({dataDir:process.argv[1]}); process.exit(0);`, dir], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const lock = path.join(dir, 'auth/accounts.lock'), recovery = lock + '.recovery';
  const replacement = JSON.stringify({ pid: process.pid, hostname: os.hostname(), nonce: 'different-owner' });
  const unlink = fs.unlinkSync;
  fs.unlinkSync = target => {
    if (target === recovery) { fs.writeFileSync(lock, replacement); throw Object.assign(new Error('simulated replacement before cleanup'), { code: 'EACCES' }); }
    return unlink(target);
  };
  try { assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 503 && e.code === 'AUTH_UNAVAILABLE'); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(fs.readFileSync(lock, 'utf8'), replacement);
});

test('failed recovery guard close still removes guard and releases owned writer with structured error', t => {
  const { dir, store } = fixture(t); store.close();
  const modulePath = path.resolve(__dirname, '../lib/auth-store.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).createAuthStore({dataDir:process.argv[1]}); process.exit(0);`, dir], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const lock = path.join(dir, 'auth/accounts.lock'), recovery = lock + '.recovery';
  const open = fs.openSync, close = fs.closeSync; let descriptor;
  fs.openSync = (...args) => { const fd = open(...args); if (args[0] === recovery) descriptor = fd; return fd; };
  fs.closeSync = fd => { close(fd); if (fd === descriptor) { descriptor = undefined; throw Object.assign(new Error('simulated close failure'), { code: 'EIO' }); } };
  try { assert.throws(() => createAuthStore({ dataDir: dir }), e => e.status === 503 && e.code === 'AUTH_UNAVAILABLE'); }
  finally { fs.openSync = open; fs.closeSync = close; }
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.existsSync(recovery), false);
  const next = createAuthStore({ dataDir: dir }); next.close();
});
