'use strict';
function fail(message, status = 403, code = 'FORBIDDEN', retryAfter) { throw Object.assign(new Error(message), { status, code, ...(retryAfter ? { retryAfter } : {}) }); }
function createRequestSecurity({ publicOrigin = process.env.MENTOR_PUBLIC_ORIGIN, production = process.env.NODE_ENV === 'production', clock = Date.now } = {}) {
  let configured;
  if (publicOrigin) {
    try { configured = new URL(publicOrigin); } catch { throw new Error('MENTOR_PUBLIC_ORIGIN должен быть корректным HTTPS origin.'); }
    if (configured.origin !== publicOrigin || configured.username || configured.password || (production && configured.protocol !== 'https:')) throw new Error('MENTOR_PUBLIC_ORIGIN должен быть корректным HTTPS origin без пути.');
  }
  if (production && !configured) throw new Error('Для production требуется HTTPS MENTOR_PUBLIC_ORIGIN.');
  const buckets = new Map();
  const admitted = new WeakSet();
  const MAX_KEYS = 10000;
  let global = { count: 0, expires: 0 };
  function check(request, server, writing) {
    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (port === 80) hosts.push('127.0.0.1', 'localhost');
    const host = request.headers.host;
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
    const health = !writing && request.method === 'GET' && request.url === '/api/health' && loopback && hosts.includes(host);
    if (!health && !(configured ? host === configured.host : hosts.includes(host))) fail('Недопустимый Host запроса.');
    if (!writing) return;
    const origin = configured ? configured.origin : `http://${host}`;
    if (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site' || request.headers['x-mentor-client'] !== 'web') fail('Изменения разрешены только из приложения.');
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) fail('Передайте данные в формате application/json.', 415, 'INVALID_INPUT');
  }
  function limit(request, action, login) {
    const now = clock();
    if (global.expires <= now) global = {count:0,expires:now+60000};
    // Admit before reading JSON, then apply identity buckets after parsing it.
    // Both phases belong to the same IncomingMessage and count globally once.
    if (!admitted.has(request)) {
      if (++global.count > 120) fail('Слишком много запросов. Попробуйте позже.',429,'RATE_LIMITED',Math.max(1,Math.ceil((global.expires-now)/1000)));
      admitted.add(request);
    }
    const ip = request.socket.remoteAddress || 'unknown';
    const rules = [];
    if (action === 'login') {
      rules.push([`login-ip:${ip}`,100,900000]);
      if (login !== undefined) {
        if (typeof login !== 'string' || login.length > 200) fail('Некорректный логин.',400,'INVALID_INPUT');
        rules.push([`login:${login.normalize('NFKC').trim().toLowerCase()}`,10,900000]);
      }
    } else if (action === 'register' || action === 'reset') rules.push([`registration-ip:${ip}`,20,900000]);
    // Expired buckets are removed; active blocks are never evicted for newcomers.
    for (const [key,bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    for (const [key,maximum,window] of rules) {
      let bucket=buckets.get(key);
      if (!bucket) {
        if (buckets.size >= MAX_KEYS) fail('Слишком много запросов. Попробуйте позже.',429,'RATE_LIMITED',Math.max(1,Math.ceil((Math.min(...Array.from(buckets.values(), b=>b.expires))-now)/1000)));
        bucket={count:0,expires:now+window};buckets.set(key,bucket);
      }
      if (++bucket.count > maximum) fail('Слишком много запросов. Попробуйте позже.',429,'RATE_LIMITED',Math.max(1,Math.ceil((bucket.expires-now)/1000)));
    }
  }
  return {check,limit};
}
module.exports={createRequestSecurity};
