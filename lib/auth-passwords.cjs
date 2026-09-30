'use strict';
const crypto = require('node:crypto');
const OPTIONS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
let active = 0;
const queue = [];

function error(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function validatePassword(password) {
  if (typeof password !== 'string' || !password.isWellFormed() || [...password].length < 8 || [...password].length > 128 || Buffer.byteLength(password, 'utf8') > 512) {
    throw error(400, 'INVALID_INPUT', 'Пароль должен содержать 8–128 символов и не больше 512 байт UTF-8.');
  }
}
function validPasswordHash(hash) {
  return hash && hash.algorithm === 'scrypt' && hash.N === OPTIONS.N && hash.r === 8 && hash.p === 1 &&
    typeof hash.saltBase64 === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(hash.saltBase64) && Buffer.from(hash.saltBase64, 'base64').length === 16 &&
    typeof hash.hashBase64 === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(hash.hashBase64) && Buffer.from(hash.hashBase64, 'base64').length === 64;
}
function derive(password, salt) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      const finish = (failure, key) => {
        active--;
        const next = queue.shift(); if (next) next();
        if (failure) reject(error(503, 'AUTH_UNAVAILABLE', 'Не удалось проверить пароль.'));
        else resolve(key);
      };
      try { crypto.scrypt(password, salt, 64, OPTIONS, finish); } catch (failure) { finish(failure); }
    };
    if (active < 2) run();
    else if (queue.length < 8) queue.push(run);
    else reject(Object.assign(error(429, 'AUTH_BUSY', 'Слишком много проверок пароля. Попробуйте позже.'), { retryAfter: 1 }));
  });
}
async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt);
  return { algorithm: 'scrypt', N: OPTIONS.N, r: 8, p: 1, saltBase64: salt.toString('base64'), hashBase64: key.toString('base64') };
}
async function verifyPassword(password, hash) {
  if (!validPasswordHash(hash)) throw error(500, 'AUTH_UNAVAILABLE', 'Повреждён хеш пароля.');
  if (typeof password !== 'string' || !password.isWellFormed() || Buffer.byteLength(password, 'utf8') > 512) return false;
  const key = await derive(password, Buffer.from(hash.saltBase64, 'base64'));
  return crypto.timingSafeEqual(key, Buffer.from(hash.hashBase64, 'base64'));
}
module.exports = { hashPassword, verifyPassword, validatePassword, validPasswordHash };
