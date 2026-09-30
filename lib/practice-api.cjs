'use strict';

const path = require('node:path');
const { createPracticeStore } = require('./practice-store.cjs');
const { requireTeacher, requireStudentOwner, requireLessonReader } = require('./access-policy.cjs');

const SOURCE_LIMIT = 256 * 1024;
// JSON escaping can expand one source byte to six bytes.
const CODE_BODY_LIMIT = SOURCE_LIMIT * 6 + 32 * 1024;
const HOMEWORK_LIMIT = 20 * 1024 * 1024;
const HOMEWORK_BODY_LIMIT = 4 * Math.ceil(HOMEWORK_LIMIT / 3) + 128 * 1024;
const FORM_BODY_LIMIT = 128 * 1024;
const RESULT_STATUSES = new Set(['accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'error', 'unavailable']);

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value); }
function fields(input, allowed) {
  if (!object(input)) fail('Передайте объект с полями формы.');
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('В запросе есть поле, которое нельзя изменять.');
}
function text(value, maximum, label, fallback = '') {
  if (value === undefined) value = fallback;
  if (typeof value !== 'string' || value.length > maximum) fail(`${label}: нужен текст не длиннее ${maximum} символов.`);
  return value.trim();
}
function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function readJson(request, maximum) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) { request.resume(); fail('Передайте данные в формате application/json.', 415); }
  if (Number(request.headers['content-length']) > maximum) { request.resume(); fail('Запрос слишком большой.', 413); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > maximum) { failed = true; chunks.length = 0; reject(Object.assign(new Error('Запрос слишком большой.'), { status: 413 })); }
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Не удалось прочитать JSON запроса.'), { status: 400 })); }
    });
    request.on('aborted', () => reject(Object.assign(new Error('Передача данных прервана.'), { status: 400 })));
    request.on('error', () => reject(Object.assign(new Error('Не удалось получить данные запроса.'), { status: 400 })));
  });
}

function validateFiles(value, exercise) {
  if (!object(value)) fail('Передайте файлы решения.');
  const allowed = Object.keys(exercise.starterFiles);
  const names = Object.keys(value);
  if (!names.length || names.length > 16 || names.length !== allowed.length || names.some(name => !Object.hasOwn(exercise.starterFiles, name))) fail('Изменять можно только объявленные Java-файлы задания.');
  let size = 0;
  const result = {};
  for (const name of names) {
    if (!/^[a-zA-Z0-9_$-]+(?:\/[a-zA-Z0-9_$-]+)*\.java$/.test(name) || name.split(/[/.]/).some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) fail('Недопустимое имя Java-файла.');
    if (typeof value[name] !== 'string' || value[name].includes('\0')) fail('Файл решения должен содержать Java-код в виде текста.');
    const fileSize = Buffer.byteLength(value[name], 'utf8');
    if (fileSize > 128 * 1024) fail('Один Java-файл не должен превышать 128 КиБ.');
    size += fileSize;
    if (size > SOURCE_LIMIT) fail('Код решения не должен превышать 256 КиБ.');
    result[name] = value[name];
  }
  return result;
}

function publicDraft(draft, exercise) {
  return draft ? { files: draft.files, updatedAt: draft.updatedAt, revision: draft.revision, exerciseRevision: draft.exerciseRevision, outdated: draft.exerciseRevision !== exercise.revision }
    : { files: structuredClone(exercise.starterFiles), updatedAt: null, revision: 0, exerciseRevision: exercise.revision, outdated: false };
}
function publicSubmission(item) {
  const result = {};
  for (const key of ['id', 'filename', 'size', 'createdAt', 'comment', 'repositoryUrl', 'status', 'feedback', 'reviewedAt']) if (Object.hasOwn(item, key)) result[key] = item[key];
  return result;
}
function publicAttempt(item, includeFiles = true) {
  const result = { id: item.id, createdAt: item.createdAt, mode: item.mode, exerciseRevision: item.exerciseRevision, result: item.result };
  if (includeFiles) result.files = item.files;
  return result;
}

function safeText(value, maximum = 16000) {
  if (typeof value !== 'string') return undefined;
  // Do not rewrite ordinary URLs or relative Java source filenames.
  return value.replace(/(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/][^\s"'<>]+/g, '[локальный путь]').replace(/(^|[\s(])\/(?:tmp|var|home|Users|private|workspace|app|opt|mnt|run|usr)\/[^\s"'<>:)]+/g, '$1[локальный путь]').slice(0, maximum);
}
function publicResult(value) {
  if (!object(value) || !RESULT_STATUSES.has(value.status)) return { status: 'error', passed: 0, total: 0, elapsedMs: 0, diagnostics: 'Не удалось завершить проверку.', tests: [] };
  const count = number => Number.isSafeInteger(number) && number >= 0 ? number : 0;
  const result = { status: value.status, passed: count(value.passed), total: count(value.total), elapsedMs: Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 ? value.elapsedMs : 0, tests: [] };
  // Cap aggregate output as well as individual values, including six-byte JSON escapes.
  let remainingCharacters = 32000;
  function resultText(value, maximum) {
    const text = safeText(value, Math.min(maximum, remainingCharacters));
    remainingCharacters -= text?.length || 0;
    return text;
  }
  if (value.status === 'accepted' && (!result.total || result.passed !== result.total)) result.status = 'error';
  if (typeof value.diagnostics === 'string') result.diagnostics = resultText(value.diagnostics, 16000);
  for (const item of Array.isArray(value.tests) ? value.tests.slice(0, 100) : []) {
    if (!object(item)) continue;
    const safe = {};
    for (const key of ['name', 'status', 'expected', 'actual', 'message', 'stdout']) {
      if (typeof item[key] === 'string') safe[key] = resultText(item[key], key === 'name' || key === 'status' ? 300 : 8000);
      else if (['expected', 'actual'].includes(key) && (typeof item[key] === 'number' || typeof item[key] === 'boolean' || item[key] === null)) safe[key] = item[key];
      else if (['expected', 'actual'].includes(key) && typeof item[key] === 'object') {
        try { safe[key] = resultText(JSON.stringify(item[key]), 8000); }
        catch { safe[key] = '[результат не удалось отобразить]'; }
      }
    }
    result.tests.push(safe);
  }
  return result;
}

function homeworkBody(input) {
  fields(input, ['filename', 'contentBase64', 'comment', 'repositoryUrl']);
  const filename = text(input.filename, 180, 'Имя файла');
  if (!filename || filename !== input.filename || /[\\/\x00-\x1f\x7f<>:"|?*]/.test(filename) || /^[.]/.test(filename) || /[. ]$/.test(filename) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) fail('Выберите файл с обычным безопасным именем без пути.');
  const extension = path.extname(filename).toLowerCase();
  if (!['.zip', '.java', '.txt', '.md', '.pdf'].includes(extension)) fail('Разрешены файлы ZIP, Java, TXT, Markdown и PDF.');
  const encoded = input.contentBase64;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) fail('Не удалось прочитать содержимое файла.');
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (bytes > HOMEWORK_LIMIT) fail('Файл домашней работы не должен превышать 20 МиБ.', 413);
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.toString('base64') !== encoded) fail('Не удалось прочитать содержимое файла.');
  if (extension === '.zip' && (data.length < 4 || !['504b0304', '504b0506', '504b0708'].includes(data.subarray(0, 4).toString('hex')))) fail('Файл ZIP не содержит сигнатуру архива.');
  const comment = text(input.comment, 10000, 'Комментарий');
  const repositoryUrl = text(input.repositoryUrl, 2000, 'Ссылка на репозиторий');
  if (repositoryUrl) {
    let url;
    try { url = new URL(repositoryUrl); } catch { fail('Укажите HTTPS-ссылку на репозиторий.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('Укажите HTTPS-ссылку на репозиторий без логина и пароля.');
  }
  return { metadata: { filename, comment, repositoryUrl }, data };
}

function createPracticeApi({ store, catalog, runner, dataDir, auth } = {}) {
  let practice;
  function practiceStore() { return practice ||= createPracticeStore({ dataDir }); }

  function current(principal) {
    if (!principal) throw Object.assign(new Error('Войдите в аккаунт.'), { status: 401, code: 'UNAUTHORIZED' });
    auth?.assertActive?.(principal);
  }

  function authorize(principal, studentId, lessonId, action) {
    current(principal);
    if (action === 'teacher') requireTeacher(principal);
    else if (action === 'student') requireStudentOwner(principal, studentId);
    requireLessonReader(principal, store.getState(), studentId, lessonId);
  }

  function ownLesson(studentId, lessonId) {
    const state = store.getState();
    if (!validId(studentId) || !validId(lessonId) || !state.students.some(item => item.id === studentId)) fail('Ученик не найден.', 404);
    const lesson = state.lessons.find(item => item.id === lessonId && item.studentId === studentId);
    if (!lesson) fail('Занятие этого ученика не найдено.', 404);
    const seeded = studentId === 'michael' && lessonId === 'lesson-2026-09-27' && lesson.status === 'prepared' && lesson.bundleId === 'library-2026-09-27';
    const defaults = seeded ? ['list-task', 'grouping-task'].filter(id => catalog.get(id)).map(exerciseId => ({ exerciseId, placement: 'class' })) : [];
    return practiceStore().ensureLesson(studentId, lessonId, defaults);
  }
  function assigned(lesson, id) {
    if (!validId(id) || !lesson.assignments.some(item => item.exerciseId === id)) fail('Задание не назначено этому занятию.', 404);
    const exercise = catalog.get(id);
    if (!exercise) fail('Задание не найдено в каталоге.', 404);
    return exercise;
  }
  async function view(studentId, lessonId) {
    const lesson = ownLesson(studentId, lessonId);
    let status;
    try {
      const value = await runner.status();
      status = { available: value.available === true, mode: safeText(value.mode, 100) || 'unavailable', message: safeText(value.message, 1000) || '' };
    } catch { status = { available: false, mode: 'unavailable', message: 'Окружение проверки недоступно.' }; }
    return {
      exercises: lesson.assignments.flatMap(assignment => {
        const exercise = catalog.get(assignment.exerciseId);
        return exercise ? [{ ...catalog.publicExercise(exercise), placement: assignment.placement, draft: publicDraft(lesson.drafts.find(item => item.exerciseId === exercise.id), exercise), attempts: lesson.attempts.filter(item => item.exerciseId === exercise.id).map(item => publicAttempt(item, false)).reverse() }] : [];
      }),
      submissions: lesson.submissions.map(publicSubmission).reverse(), runner: status,
    };
  }

  return async function handle(request, response, pathname, principal) {
    const match = pathname.match(/^\/api\/students\/([^/]+)\/lessons\/([^/]+)\/(practice|homework)(?:\/(.*))?$/);
    if (pathname !== '/api/practice/catalog' && !match) return false;
    try {
      current(principal);
      if (pathname === '/api/practice/catalog') {
        requireTeacher(principal);
        if (request.method !== 'GET') fail('Этот способ запроса не поддерживается.', 405);
        sendJson(response, 200, { exercises: catalog.list().map(exercise => catalog.publicExercise(exercise)), environments: catalog.environments() });
        return true;
      }
      const [, studentId, lessonId, section, suffix = ''] = match;
      const action = section === 'practice' && suffix === 'assignments' && request.method === 'POST' || section === 'homework' && /^[a-zA-Z0-9_-]+$/.test(suffix) && request.method === 'PATCH' ? 'teacher'
        : section === 'practice' && /^exercises\/[^/]+\/(?:draft|attempts)$/.test(suffix) && ['PATCH', 'POST'].includes(request.method) || section === 'homework' && !suffix && request.method === 'POST' ? 'student' : 'reader';
      authorize(principal, studentId, lessonId, action);
      const lesson = ownLesson(studentId, lessonId);
      if (section === 'practice' && !suffix && request.method === 'GET') { const result = await view(studentId, lessonId); authorize(principal, studentId, lessonId, 'reader'); sendJson(response, 200, result); }
      else if (section === 'practice' && suffix === 'assignments' && request.method === 'POST') {
        const input = await readJson(request, FORM_BODY_LIMIT);
        fields(input, ['assignments']);
        if (!Array.isArray(input.assignments) || input.assignments.length > 100) fail('Передайте список назначенных заданий.');
        const seen = new Set();
        const assignments = input.assignments.map(item => {
          fields(item, ['exerciseId', 'placement']);
          if (!validId(item.exerciseId) || !catalog.get(item.exerciseId) || seen.has(item.exerciseId) || !['class', 'homework'].includes(item.placement)) fail('Проверьте задания и место их выполнения.');
          seen.add(item.exerciseId);
          return { exerciseId: item.exerciseId, placement: item.placement };
        });
        authorize(principal, studentId, lessonId, 'teacher');
        ownLesson(studentId, lessonId);
        practiceStore().setAssignments(studentId, lessonId, assignments);
        const result = await view(studentId, lessonId);
        authorize(principal, studentId, lessonId, 'teacher');
        sendJson(response, 200, result);
      } else if (section === 'practice' && /^exercises\/[^/]+\/(?:draft|attempts(?:\/[^/]+)?)$/.test(suffix)) {
        const [, exerciseId, operation, attemptId] = suffix.split('/');
        const exercise = assigned(lesson, exerciseId);
        if (operation === 'draft' && request.method === 'PATCH' && !attemptId) {
          const input = await readJson(request, CODE_BODY_LIMIT);
          fields(input, ['files', 'revision', 'exerciseRevision', 'resetForExerciseRevision']);
          if (input.exerciseRevision !== exercise.revision) fail('Версия задания изменилась. Сохраните свой код и обновите страницу.', 409);
          if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('Укажите версию черновика.');
          if (Object.hasOwn(input, 'resetForExerciseRevision') && input.resetForExerciseRevision !== exercise.revision) fail('Версия задания уже изменилась. Загрузите условие заново.', 409);
          const files = validateFiles(input.files, exercise);
          authorize(principal, studentId, lessonId, 'student');
          assigned(ownLesson(studentId, lessonId), exerciseId);
          const draft = practiceStore().saveDraft(studentId, lessonId, exerciseId, exercise.revision, files, input.revision, input.resetForExerciseRevision);
          sendJson(response, 200, { draft: publicDraft(draft, exercise) });
        } else if (operation === 'attempts' && request.method === 'POST' && !attemptId) {
          const input = await readJson(request, CODE_BODY_LIMIT);
          fields(input, ['files', 'mode', 'exerciseRevision']);
          if (input.exerciseRevision !== exercise.revision) fail('Версия задания изменилась. Сохраните свой код и обновите страницу.', 409);
          if (!['run', 'submit'].includes(input.mode)) fail('Выберите запуск примеров или полную проверку.');
          const files = validateFiles(input.files, exercise);
          authorize(principal, studentId, lessonId, 'student');
          const latest = ownLesson(studentId, lessonId);
          assigned(latest, exerciseId);
          const draft = latest.drafts.find(item => item.exerciseId === exerciseId);
          if (draft && draft.exerciseRevision !== exercise.revision) fail('Условие задания обновилось. Сохраните свой код и явно загрузите новую версию задания.', 409);
          let result;
          try { result = publicResult(await runner.run(exercise, structuredClone(files), input.mode)); }
          catch { result = publicResult(null); }
          assigned(ownLesson(studentId, lessonId), exerciseId);
          const attempt = practiceStore().addAttempt(studentId, lessonId, exerciseId, exercise.revision, files, input.mode, result);
          authorize(principal, studentId, lessonId, 'student');
          sendJson(response, 201, { attempt: publicAttempt(attempt) });
        } else if (operation === 'attempts' && attemptId && request.method === 'GET') {
          const attempt = lesson.attempts.find(item => item.id === attemptId && item.exerciseId === exerciseId);
          if (!attempt) fail('Попытка этого задания не найдена.', 404);
          sendJson(response, 200, { attempt: publicAttempt(attempt) });
        } else fail('Этот способ запроса не поддерживается.', 405);
      } else if (section === 'homework' && !suffix && request.method === 'POST') {
        const { metadata, data } = homeworkBody(await readJson(request, HOMEWORK_BODY_LIMIT));
        authorize(principal, studentId, lessonId, 'student');
        ownLesson(studentId, lessonId);
        sendJson(response, 201, { submission: publicSubmission(practiceStore().addSubmission(studentId, lessonId, metadata, data)) });
      } else if (section === 'homework' && /^[a-zA-Z0-9_-]+\/file$/.test(suffix) && request.method === 'GET') {
        const { submission, data } = practiceStore().readSubmissionFile(studentId, lessonId, suffix.split('/')[0]);
        authorize(principal, studentId, lessonId, 'reader');
        const encoded = encodeURIComponent(submission.filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
        const fallback = submission.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        response.end(data);
      } else if (section === 'homework' && /^[a-zA-Z0-9_-]+$/.test(suffix) && request.method === 'PATCH') {
        const input = await readJson(request, FORM_BODY_LIMIT);
        fields(input, ['status', 'feedback']);
        if (!['reviewed', 'needs_revision'].includes(input.status)) fail('Выберите «Проверено» или «Нужна доработка».');
        const feedback = text(input.feedback, 20000, 'Обратная связь');
        authorize(principal, studentId, lessonId, 'teacher');
        ownLesson(studentId, lessonId);
        sendJson(response, 200, { submission: publicSubmission(practiceStore().reviewSubmission(studentId, lessonId, suffix, input.status, feedback)) });
      } else fail('Раздел практики не найден или способ запроса не поддерживается.', ['GET', 'POST', 'PATCH'].includes(request.method) ? 404 : 405);
    } catch (error) {
      const known = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
      if (!response.headersSent && !response.destroyed) sendJson(response, known ? error.status : 500, { error: known ? error.message : 'Не удалось выполнить запрос к тренажёру.', ...(known && error.code ? { code: error.code } : {}) });
    }
    return true;
  };
}

module.exports = { createPracticeApi };
