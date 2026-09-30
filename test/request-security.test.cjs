'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestSecurity } = require('../lib/request-security.cjs');
const server = { address: () => ({ port: 4173 }) };
function req(headers = {}, ip = '127.0.0.1') { return { headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json', 'x-mentor-client': 'web', ...headers }, socket: { remoteAddress: ip }, method: 'POST', url: '/api/auth/login' }; }
function fails(fn, status, code) { assert.throws(fn, e => e.status === status && (!code || e.code === code)); }
test('writes reject missing/wrong Origin, cross-site, content type and client marker', () => {
  const s = createRequestSecurity({ production: false });
  s.check(req(), server, true);
  for (const headers of [{ origin: undefined }, { origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'x-mentor-client': undefined }]) fails(() => s.check(req(headers), server, true), 403);
  fails(() => s.check(req({ 'content-type': 'text/plain' }), server, true), 415);
});
test('Host cannot be authorized through forwarding headers; production requires exact HTTPS origin', () => {
  const local = createRequestSecurity({ production: false });
  fails(() => local.check(req({ host: 'evil.test', 'x-forwarded-host': '127.0.0.1:4173' }), server, false), 403);
  local.check(req({ 'x-forwarded-host': 'evil.test', 'x-forwarded-for': 'attacker' }), server, false);
  for (const publicOrigin of [undefined, 'http://mentor.test', 'https://mentor.test/path', 'https://mentor.test/?x=1']) assert.throws(() => createRequestSecurity({ production: true, publicOrigin }));
  const prod = createRequestSecurity({ production: true, publicOrigin: 'https://mentor.test' });
  prod.check(req({ host: 'mentor.test', origin: 'https://mentor.test' }), server, true);
  fails(() => prod.check(req({ host: 'evil.test', 'x-forwarded-host': 'mentor.test' }), server, false), 403);
  prod.check({ ...req(), method: 'GET', url: '/api/health' }, server, false);
});
test('login limit normalizes login, returns retry interval, and expires after fifteen minutes', () => {
  let now = 0; const s = createRequestSecurity({ production: false, clock: () => now });
  for (let i = 0; i < 10; i++) s.limit(req({}, String(i)), 'login', i % 2 ? ' Learner ' : 'learner');
  assert.throws(() => s.limit(req({}, 'new'), 'login', 'LEARNER'), e => e.status === 429 && e.retryAfter === 900);
  now = 900000; s.limit(req(), 'login', 'learner');
});
test('IP auth and register/reset limits use connection IP, not forwarded IP', () => {
  const s = createRequestSecurity({ production: false });
  for (let i = 0; i < 100; i++) s.limit(req({ 'x-forwarded-for': String(i) }), 'login', `user${i}`);
  fails(() => s.limit(req(), 'login', 'different'), 429);
  const t = createRequestSecurity({ production: false });
  for (let i = 0; i < 20; i++) t.limit(req(), i % 2 ? 'register' : 'reset');
  fails(() => t.limit(req(), 'register'), 429);
});
test('global minute limit and sustained key churn preserve active login blocks', () => {
  let now = 0; const s = createRequestSecurity({ production: false, clock: () => now });
  for (let i = 0; i < 120; i++) s.limit(req({}, String(i)), 'other');
  fails(() => s.limit(req({}, 'fresh'), 'other'), 429);
  now = 60000; s.limit(req(), 'other');
  const t = createRequestSecurity({ production: false, clock: () => now });
  for (let i = 0; i < 10; i++) t.limit(req({}, `first${i}`), 'login', 'blocked');
  for (let i = 0; i < 1000; i++) { now += 600; try { t.limit(req({}, `ip${i}`), 'login', `u${i}`); } catch(e) { assert.equal(e.status, 429); } }
  fails(() => t.limit(req({}, 'last'), 'login', 'blocked'), 429);
});
