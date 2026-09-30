'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./lib/store.cjs');
const { createAuthService } = require('./lib/auth-service.cjs');
const { createRequestSecurity } = require('./lib/request-security.cjs');
const { createAuthApi, resolveAuth, requireMutation } = require('./lib/auth-api.cjs');
const { requireTeacher, requireStudentOwner, requireLessonReader, stateFor } = require('./lib/access-policy.cjs');
const { createMaterialsApi, publicStaticFile } = require('./lib/materials-api.cjs');

const BODY_LIMIT = 256 * 1024;
// Three 200,000-unit note fields fit even when JSON uses six-byte escapes.
const LESSON_BODY_LIMIT = 4 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.java': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.zip': 'application/zip', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

function error(message, status) {
  return Object.assign(new Error(message), { status });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function readBody(request, maximum = BODY_LIMIT) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) {
    request.resume();
    throw error('Передайте данные в формате application/json.', 415);
  }
  if (Number(request.headers['content-length']) > maximum) {
    request.resume();
    throw error('Запрос слишком большой. Сократите текст заметок.', 413);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maximum) {
        chunks.length = 0;
        reject(error('Запрос слишком большой. Сократите текст заметок.', 413));
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > maximum) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(error('Не удалось прочитать JSON. Проверьте данные запроса.', 400));
      }
    });
    request.on('aborted', () => reject(error('Передача данных прервана.', 400)));
    request.on('error', () => reject(error('Не удалось получить данные запроса.', 400)));
  });
}

async function staticFile(request, response, pathname, staticRoot) {
  if (!['GET', 'HEAD'].includes(request.method)) throw error('Этот способ запроса не поддерживается.', 405);
  const realFile = await publicStaticFile(staticRoot, pathname);
  if (!realFile) throw error('Файл не найден.', 404);
  const info = await fs.promises.stat(realFile);
  const data = request.method === 'HEAD' ? null : await fs.promises.readFile(realFile);
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(realFile).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size });
  response.end(data);
}

function createServer({ dataDir = path.join(__dirname, 'data'), staticDir = path.join(__dirname, 'dist'), practiceCatalog, practiceRunner, authOptions = {}, materialsDir } = {}) {
  const production = authOptions.production ?? process.env.NODE_ENV === 'production';
  const publicOrigin = authOptions.publicOrigin ?? process.env.MENTOR_PUBLIC_ORIGIN;
  const security = createRequestSecurity({ ...authOptions, production, publicOrigin });
  if (production && !['docker', 'disabled'].includes(process.env.MENTOR_JAVA_MODE)) throw new Error('В production требуется MENTOR_JAVA_MODE=docker либо disabled.');
  const store = createStore({ dataDir });
  const auth = createAuthService({ dataDir, getStudent: id => store.getState().students.find(student => student.id === id) || null, clock: authOptions.clock });
  const authApi = createAuthApi({ auth, security, production, originFor: request => publicOrigin || `http://${request.headers.host}` });
  const staticRoot = path.resolve(staticDir);
  let materialsApi;
  function materialsHandler() {
    if (!materialsApi) materialsApi = createMaterialsApi({ root: __dirname, materialsDir, store, access: { assertActive: principal => auth.assertActive(principal) } });
    return materialsApi;
  }
  let practiceApi, runner;
  function practiceHandler() {
    if (!practiceApi) {
      const { createCatalog } = require('./lib/training-catalog.cjs');
      const { createJavaRunner } = require('./lib/java-runner.cjs');
      const { createPracticeApi } = require('./lib/practice-api.cjs');
      const catalog = practiceCatalog || createCatalog();
      runner = practiceRunner || createJavaRunner({ catalog });
      practiceApi = createPracticeApi({ store, catalog, runner, dataDir, auth });
    }
    return practiceApi;
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const writing = !['GET', 'HEAD'].includes(request.method);
      security.check(request, server, writing);
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      } catch {
        throw error('Некорректный адрес запроса.', 400);
      }
      if (!pathname.startsWith('/api/')) {
        await staticFile(request, response, pathname, staticRoot);
        return;
      }
      if (!['GET', 'HEAD', 'POST', 'PATCH'].includes(request.method)) throw error('Этот способ запроса не поддерживается.', 405);
      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { app: 'mentor-local', version: 1 });
        return;
      }
      if (await authApi(request, response, pathname)) return;
      const session = resolveAuth(request, auth, production);
      if (!session) throw Object.assign(error('Войдите в аккаунт.', 401), { code: 'UNAUTHORIZED' });
      request.authContext = session;
      request.principal = session.principal;
      auth.assertActive(session.principal);
      if (writing) requireMutation(request, session);
      function liveTeacher() { auth.assertActive(session.principal); requireTeacher(session.principal); }
      if (pathname === '/api/content' || pathname.startsWith('/api/materials/')) {
        if (await materialsHandler().handle(request, response, pathname, session.principal)) return;
      }
      const practiceRoute = pathname.match(/^\/api\/students\/([^/]+)\/lessons\/([^/]+)\/(practice|homework)(?:\/(.*))?$/);
      if (pathname === '/api/practice/catalog') requireTeacher(session.principal);
      if (practiceRoute) {
        const [, studentId, lessonId, section, suffix = ''] = practiceRoute;
        const teacherAction = section === 'practice' && suffix === 'assignments' && request.method === 'POST' || section === 'homework' && /^[a-zA-Z0-9_-]+$/.test(suffix) && request.method === 'PATCH';
        const studentAction = section === 'practice' && /^exercises\/[^/]+\/(?:draft|attempts)$/.test(suffix) && ['PATCH', 'POST'].includes(request.method) || section === 'homework' && !suffix && request.method === 'POST';
        if (teacherAction) requireTeacher(session.principal);
        if (studentAction) requireStudentOwner(session.principal, studentId);
        requireLessonReader(session.principal, store.getState(), studentId, lessonId);
      }
      if (pathname === '/api/practice/catalog' || practiceRoute) {
        if (await practiceHandler()(request, response, pathname, session.principal)) return;
      }
      if (request.method === 'GET' && pathname === '/api/state') {
        sendJson(response, 200, stateFor(session.principal, store.getState()));
      } else if (request.method === 'POST' && pathname === '/api/students') {
        requireTeacher(session.principal);
        const input = await readBody(request);
        liveTeacher();
        sendJson(response, 201, { student: store.addStudent(input) });
      } else {
        const match = pathname.match(/^\/api\/students\/([a-zA-Z0-9_-]+)(?:\/lessons(?:\/([a-zA-Z0-9_-]+))?)?$/);
        if (!match) throw error('Запрошенный раздел не найден.', 404);
        const [, studentId, lessonId] = match;
        const hasLessons = pathname.includes('/lessons');
        if (!hasLessons && request.method === 'PATCH') {
          requireTeacher(session.principal);
          const input = await readBody(request);
          liveTeacher();
          sendJson(response, 200, { student: store.updateStudent(studentId, input) });
        } else if (hasLessons && !lessonId && request.method === 'POST') {
          requireTeacher(session.principal);
          const input = await readBody(request, LESSON_BODY_LIMIT);
          liveTeacher();
          sendJson(response, 201, { lesson: store.addLesson(studentId, input) });
        } else if (lessonId && request.method === 'PATCH') {
          requireTeacher(session.principal);
          const input = await readBody(request, LESSON_BODY_LIMIT);
          liveTeacher();
          sendJson(response, 200, { lesson: store.updateLesson(studentId, lessonId, input) });
        } else throw error('Этот способ запроса не поддерживается.', 405);
      }
    } catch (failure) {
      if (!response.headersSent && !response.destroyed) {
        const known = Number.isInteger(failure.status) && failure.status >= 400 && failure.status <= 599;
        if (known && failure.retryAfter) response.setHeader('Retry-After', String(failure.retryAfter));
        sendJson(response, known ? failure.status : 500, { error: known ? failure.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.', ...(known && failure.code ? { code: failure.code } : {}) });
      }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.auth = auth;
  server.on('close', () => { if (runner) runner.close(); auth.close(); });
  return server;
}

if (require.main === module) {
  try {
    const port = process.env.PORT ? Number(process.env.PORT) : 4173;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT должен быть целым числом от 1 до 65535.');
    const server = createServer();
    server.on('error', failure => {
      console.error(failure.code === 'EADDRINUSE' ? `Порт ${port} занят. Откройте уже запущенное приложение или остановите другой сервер.` : 'Не удалось запустить локальный сервер.');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Локальное приложение: http://127.0.0.1:${port}`));
  } catch (failure) {
    console.error(failure.message);
    process.exitCode = 1;
  }
}

module.exports = { createServer };
