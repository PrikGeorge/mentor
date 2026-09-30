'use strict';
const crypto = require('node:crypto');
const { createAuthStore } = require('./auth-store.cjs');
const { hashPassword, verifyPassword, validatePassword } = require('./auth-passwords.cjs');
const HOUR = 3600000;
const publicAccount = account => ({ id: account.id, login: account.login, role: account.role, studentId: account.studentId });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
const unauthorized = () => fail(401, 'UNAUTHORIZED', 'Требуется вход в кабинет.');
const invalidCredentials = () => fail(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.');
const invalidToken = () => fail(400, 'INVALID_TOKEN', 'Ссылка недействительна или срок её действия истёк.');
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail(400, 'INVALID_INPUT', 'Недопустимые поля запроса.');
}
function normalizeLogin(value) {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', 'Укажите логин.');
  const login = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(login)) fail(400, 'INVALID_INPUT', 'Логин: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.');
  return login;
}
function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) invalidToken();
  return digest(token);
}

function createAuthService({ dataDir, getStudent, clock = Date.now } = {}) {
  if (typeof getStudent !== 'function' || typeof clock !== 'function') fail(500, 'AUTH_UNAVAILABLE', 'Не настроено хранилище учеников.');
  const store = createAuthStore({ dataDir });
  const sessions = new Map(); let closed = false;
  const dummy = { algorithm: 'scrypt', N: 131072, r: 8, p: 1, saltBase64: crypto.randomBytes(16).toString('base64'), hashBase64: crypto.randomBytes(64).toString('base64') };
  const iso = () => new Date(clock()).toISOString();
  function open() { if (closed) fail(503, 'AUTH_UNAVAILABLE', 'Сервис авторизации закрыт.'); }
  function studentExists(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !getStudent(id)) fail(404, 'NOT_FOUND', 'Ученик не найден.');
  }
  function liveSession(hash, touch) {
    open();
    const session = sessions.get(hash); if (!session) return null;
    const now = clock();
    const account = store.read().accounts.find(a => a.id === session.accountId);
    if (now >= session.createdAt + 7 * 24 * HOUR || now >= session.lastSeenAt + 8 * HOUR || !account || account.disabled || account.authVersion !== session.authVersion || (account.role === 'student' && !getStudent(account.studentId))) {
      sessions.delete(hash); return null;
    }
    if (touch) session.lastSeenAt = now;
    return { session, account };
  }
  function assertActive(principal) {
    if (!principal || typeof principal.sessionHash !== 'string') unauthorized();
    const live = liveSession(principal.sessionHash, false);
    if (!live || ['id', 'login', 'role', 'studentId', 'authVersion'].some(key => principal[key] !== live.account[key])) unauthorized();
    return live.account;
  }
  function teacher(principal, studentId) {
    const account = assertActive(principal);
    if (account.role !== 'teacher') fail(403, 'FORBIDDEN', 'Операция доступна преподавателю.');
    studentExists(studentId); return account;
  }
  function revokeSessions(accountId) {
    for (const [hash, session] of sessions) if (session.accountId === accountId) sessions.delete(hash);
  }
  function issueSession(account) {
    open();
    const now = clock();
    for (const [hash, session] of sessions) {
      if (now >= session.createdAt + 7 * 24 * HOUR || now >= session.lastSeenAt + 8 * HOUR) sessions.delete(hash);
    }
    const own = [...sessions].filter(([, s]) => s.accountId === account.id).sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (own.length >= 5) sessions.delete(own.shift()[0]);
    const token = secret(), csrfToken = secret();
    sessions.set(digest(token), { accountId: account.id, authVersion: account.authVersion, createdAt: now, lastSeenAt: now, csrfToken });
    return { account: publicAccount(account), token, csrfToken };
  }
  function activeToken(records, hash) {
    const record = records.find(r => r.tokenHash === hash);
    if (!record || record.usedAt !== null || record.revokedAt !== null || clock() >= Date.parse(record.expiresAt)) invalidToken();
    return record;
  }
  function availableLogin(state, login) {
    if (state.accounts.some(a => a.login === login)) fail(409, 'LOGIN_EXISTS', 'Этот логин уже занят.');
  }
  function newAccount(login, passwordHash, role, studentId) {
    return { id: crypto.randomUUID(), login, role, studentId, passwordHash, disabled: false, authVersion: 1, createdAt: iso() };
  }
  function revokeResets(state, accountId) {
    for (const reset of state.resets) if (reset.accountId === accountId && reset.usedAt === null && reset.revokedAt === null) reset.revokedAt = iso();
  }
  function access(principal, studentId) {
    teacher(principal, studentId);
    const state = store.read();
    const account = state.accounts.find(a => a.studentId === studentId);
    const invitation = state.invitations.find(r => r.studentId === studentId && r.usedAt === null && r.revokedAt === null && clock() < Date.parse(r.expiresAt));
    return { account: account ? { ...publicAccount(account), disabled: account.disabled } : null, invitation: invitation ? { id: invitation.id, expiresAt: invitation.expiresAt } : null };
  }
  return {
    async setupTeacher(input) {
      open(); fields(input, ['login', 'password']); const login = normalizeLogin(input.login); validatePassword(input.password);
      if (store.read().accounts.some(a => a.role === 'teacher')) fail(409, 'ACCOUNT_EXISTS', 'Преподаватель уже создан.');
      const passwordHash = await hashPassword(input.password); open();
      const account = store.update(state => {
        if (state.accounts.some(a => a.role === 'teacher')) fail(409, 'ACCOUNT_EXISTS', 'Преподаватель уже создан.');
        availableLogin(state, login); const account = newAccount(login, passwordHash, 'teacher', null); state.accounts.push(account); return account;
      });
      return publicAccount(account);
    },
    async login(input) {
      open(); fields(input, ['login', 'password']); const login = normalizeLogin(input.login);
      const original = store.read().accounts.find(a => a.login === login);
      const matches = await verifyPassword(input.password, original?.passwordHash || dummy); open();
      const current = store.read().accounts.find(a => a.login === login);
      if (!matches || !original || !current || current.id !== original.id || current.authVersion !== original.authVersion || current.disabled || (current.role === 'student' && !getStudent(current.studentId))) invalidCredentials();
      return issueSession(current);
    },
    async register(input) {
      open(); fields(input, ['token', 'login', 'password']); const hash = tokenHash(input.token), login = normalizeLogin(input.login); validatePassword(input.password);
      const invitation = activeToken(store.read().invitations, hash); studentExists(invitation.studentId);
      const passwordHash = await hashPassword(input.password); open();
      const account = store.update(state => {
        const current = activeToken(state.invitations, hash); studentExists(current.studentId); availableLogin(state, login);
        if (state.accounts.some(a => a.studentId === current.studentId)) fail(409, 'ACCOUNT_EXISTS', 'У ученика уже есть аккаунт.');
        const account = newAccount(login, passwordHash, 'student', current.studentId); state.accounts.push(account); current.usedAt = iso(); return account;
      });
      return issueSession(account);
    },
    session(token) {
      if (closed || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const hash = digest(token), live = liveSession(hash, true);
      return live ? { principal: { ...publicAccount(live.account), authVersion: live.account.authVersion, sessionHash: hash }, csrfToken: live.session.csrfToken } : null;
    },
    logout(token) { open(); if (typeof token === 'string') sessions.delete(digest(token)); },
    async changePassword(principal, input) {
      fields(input, ['currentPassword', 'newPassword']); const original = assertActive(principal); validatePassword(input.newPassword);
      if (!await verifyPassword(input.currentPassword, original.passwordHash)) invalidCredentials();
      assertActive(principal); const passwordHash = await hashPassword(input.newPassword); assertActive(principal);
      const account = store.update(state => {
        assertActive(principal); const account = state.accounts.find(a => a.id === original.id);
        account.passwordHash = passwordHash; account.authVersion++; revokeResets(state, account.id); return account;
      });
      revokeSessions(account.id); return issueSession(account);
    },
    access,
    invite(principal, studentId) {
      teacher(principal, studentId); const token = secret();
      return store.update(state => {
        teacher(principal, studentId);
        if (state.accounts.some(a => a.studentId === studentId)) fail(409, 'ACCOUNT_EXISTS', 'У ученика уже есть аккаунт.');
        for (const invitation of state.invitations) if (invitation.studentId === studentId && invitation.usedAt === null && invitation.revokedAt === null) invitation.revokedAt = iso();
        const record = { id: crypto.randomUUID(), purpose: 'register', studentId, tokenHash: digest(token), createdAt: iso(), expiresAt: new Date(clock() + 72 * HOUR).toISOString(), usedAt: null, revokedAt: null };
        state.invitations.push(record); return { id: record.id, token, expiresAt: record.expiresAt };
      });
    },
    revokeInvite(principal, studentId, id) {
      teacher(principal, studentId);
      store.update(state => {
        teacher(principal, studentId); const record = state.invitations.find(r => r.id === id && r.studentId === studentId);
        if (!record) fail(404, 'NOT_FOUND', 'Приглашение не найдено.');
        if (record.usedAt === null && record.revokedAt === null) record.revokedAt = iso();
      });
    },
    setDisabled(principal, studentId, disabled) {
      teacher(principal, studentId); if (typeof disabled !== 'boolean') fail(400, 'INVALID_INPUT', 'Укажите состояние доступа.');
      const account = store.update(state => {
        teacher(principal, studentId); const account = state.accounts.find(a => a.studentId === studentId);
        if (!account) fail(404, 'NOT_FOUND', 'Аккаунт ученика не найден.');
        account.disabled = disabled; if (disabled) account.authVersion++; return account;
      });
      if (disabled) revokeSessions(account.id); return access(principal, studentId);
    },
    async issueReset(principal, studentId, currentPassword) {
      const original = teacher(principal, studentId);
      if (!await verifyPassword(currentPassword, original.passwordHash)) invalidCredentials();
      teacher(principal, studentId); const token = secret();
      return store.update(state => {
        teacher(principal, studentId); const account = state.accounts.find(a => a.studentId === studentId);
        if (!account) fail(404, 'NOT_FOUND', 'Аккаунт ученика не найден.');
        revokeResets(state, account.id);
        const record = { id: crypto.randomUUID(), purpose: 'reset-password', accountId: account.id, tokenHash: digest(token), createdAt: iso(), expiresAt: new Date(clock() + HOUR / 2).toISOString(), usedAt: null, revokedAt: null };
        state.resets.push(record); return { token, expiresAt: record.expiresAt };
      });
    },
    async resetPassword(input) {
      open(); fields(input, ['token', 'newPassword']); const hash = tokenHash(input.token); validatePassword(input.newPassword);
      activeToken(store.read().resets, hash); const passwordHash = await hashPassword(input.newPassword); open();
      const accountId = store.update(state => {
        const reset = activeToken(state.resets, hash); const account = state.accounts.find(a => a.id === reset.accountId);
        if (!account || account.role !== 'student') invalidToken(); studentExists(account.studentId);
        account.passwordHash = passwordHash; account.authVersion++; reset.usedAt = iso(); revokeResets(state, account.id); return account.id;
      });
      revokeSessions(accountId);
    },
    async resetTeacherPassword(input) {
      open(); fields(input, ['login', 'newPassword']); const login = normalizeLogin(input.login); validatePassword(input.newPassword);
      const original = store.read().accounts.find(a => a.login === login && a.role === 'teacher');
      if (!original) fail(404, 'NOT_FOUND', 'Преподаватель не найден.');
      const passwordHash = await hashPassword(input.newPassword); open();
      const accountId = store.update(state => {
        const account = state.accounts.find(a => a.id === original.id && a.role === 'teacher');
        if (!account || account.authVersion !== original.authVersion) fail(409, 'ACCOUNT_CHANGED', 'Аккаунт изменился. Повторите команду.');
        account.passwordHash = passwordHash; account.authVersion++; return account.id;
      });
      revokeSessions(accountId);
    },
    assertActive(principal) { assertActive(principal); },
    close() { if (closed) return; closed = true; sessions.clear(); store.close(); },
  };
}
module.exports = { createAuthService };
