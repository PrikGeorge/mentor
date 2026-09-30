'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function clone(value) { return structuredClone(value); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value); }
function validRevision(value) { return typeof value === 'string' && value.length > 0 && value.length <= 100 || Number.isSafeInteger(value) && value >= 0; }
function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function files(value) { return object(value) && Object.keys(value).length <= 16 && Object.entries(value).every(([name, source]) => typeof source === 'string' && /^[a-zA-Z0-9_$-]+(?:\/[a-zA-Z0-9_$-]+)*\.java$/.test(name) && !name.split(/[/.]/).some(part => ['__proto__', 'prototype', 'constructor'].includes(part))); }

function validateState(state) {
  if (!object(state) || state.version !== 1 || !Array.isArray(state.lessons)) throw new Error('format');
  const keys = new Set();
  for (const lesson of state.lessons) {
    if (!object(lesson) || !validId(lesson.studentId) || !validId(lesson.lessonId)) throw new Error('format');
    const key = lesson.studentId + '/' + lesson.lessonId;
    if (keys.has(key)) throw new Error('format');
    keys.add(key);
    for (const field of ['assignments', 'drafts', 'attempts', 'submissions', 'draftArchives']) if (!Array.isArray(lesson[field])) throw new Error('format');
    const assigned = new Set();
    for (const assignment of lesson.assignments) {
      if (!object(assignment) || !validId(assignment.exerciseId) || !['class', 'homework'].includes(assignment.placement) || assigned.has(assignment.exerciseId)) throw new Error('format');
      assigned.add(assignment.exerciseId);
    }
    for (const draft of [...lesson.drafts, ...lesson.draftArchives]) {
      if (!object(draft) || !validId(draft.exerciseId) || !validRevision(draft.exerciseRevision) || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || !files(draft.files) || !timestamp(draft.updatedAt)) throw new Error('format');
    }
    for (const attempt of lesson.attempts) {
      if (!object(attempt) || !validId(attempt.id) || !validId(attempt.exerciseId) || !validRevision(attempt.exerciseRevision) || !files(attempt.files) || !['run', 'submit'].includes(attempt.mode) || !timestamp(attempt.createdAt) || !object(attempt.result)) throw new Error('format');
    }
    for (const submission of lesson.submissions) {
      if (!object(submission) || !validId(submission.id) || !/^[a-f0-9-]{36}$/.test(submission.blobId) || typeof submission.filename !== 'string' || /[\\/\x00-\x1f\x7f]/.test(submission.filename) || !Number.isSafeInteger(submission.size) || submission.size < 1 || submission.size > 20 * 1024 * 1024 || !timestamp(submission.createdAt) || !['submitted', 'reviewed', 'needs_revision'].includes(submission.status) || typeof submission.feedback !== 'string' || typeof submission.comment !== 'string' || typeof submission.repositoryUrl !== 'string') throw new Error('format');
    }
  }
  return state;
}

function createPracticeStore({ dataDir = path.join(__dirname, '..', 'data') } = {}) {
  const directory = path.join(path.resolve(dataDir), 'practice');
  const uploadDirectory = path.join(directory, 'uploads');
  const stateFile = path.join(directory, 'state.json');
  fs.mkdirSync(uploadDirectory, { recursive: true });

  function read() {
    try { return validateState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); }
    catch { fail('Данные тренажёра повреждены или недоступны. Файл не изменён; проверьте резервную копию practice/state.json.bak.', 500); }
  }

  function atomicWrite(destination, data, backup = false) {
    const temporary = path.join(path.dirname(destination), `.practice-${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, data);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      if (backup) fs.copyFileSync(destination, destination + '.bak');
      fs.renameSync(temporary, destination);
    } catch { fail('Не удалось сохранить данные тренажёра. Проверьте доступ и свободное место на диске.', 500); }
    finally {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  function write(state) { atomicWrite(stateFile, JSON.stringify(validateState(state), null, 2) + '\n', true); }
  if (!fs.existsSync(stateFile)) atomicWrite(stateFile, JSON.stringify({ version: 1, lessons: [] }) + '\n');
  read();

  function findLesson(state, studentId, lessonId) {
    const lesson = state.lessons.find(item => item.studentId === studentId && item.lessonId === lessonId);
    if (!lesson) fail('Практика этого занятия не найдена.', 404);
    return lesson;
  }

  return {
    ensureLesson(studentId, lessonId, assignments = []) {
      if (!validId(studentId) || !validId(lessonId)) fail('Некорректный адрес занятия.', 404);
      const state = read();
      const found = state.lessons.find(item => item.studentId === studentId && item.lessonId === lessonId);
      if (found) return clone(found);
      const lesson = { studentId, lessonId, assignments: clone(assignments), drafts: [], draftArchives: [], attempts: [], submissions: [] };
      state.lessons.push(lesson);
      write(state);
      return clone(lesson);
    },
    getLesson(studentId, lessonId) { return clone(findLesson(read(), studentId, lessonId)); },
    setAssignments(studentId, lessonId, assignments) {
      const state = read();
      findLesson(state, studentId, lessonId).assignments = clone(assignments);
      write(state);
    },
    saveDraft(studentId, lessonId, exerciseId, exerciseRevision, sourceFiles, revision, resetForExerciseRevision) {
      const state = read();
      const lesson = findLesson(state, studentId, lessonId);
      const old = lesson.drafts.find(item => item.exerciseId === exerciseId);
      if (revision !== (old?.revision ?? 0)) fail('Черновик уже изменён в другом окне. Скопируйте свой код и загрузите актуальную версию.', 409);
      const outdated = old && old.exerciseRevision !== exerciseRevision;
      if (outdated && resetForExerciseRevision !== exerciseRevision) fail('Условие задания обновилось. Сохраните свой код и явно загрузите новую версию задания.', 409);
      if (outdated) lesson.draftArchives.push(clone(old));
      const draft = { exerciseId, exerciseRevision, files: clone(sourceFiles), revision: revision + 1, updatedAt: new Date().toISOString() };
      if (old) lesson.drafts[lesson.drafts.indexOf(old)] = draft;
      else lesson.drafts.push(draft);
      write(state);
      return clone(draft);
    },
    addAttempt(studentId, lessonId, exerciseId, exerciseRevision, sourceFiles, mode, result) {
      const state = read();
      const attempt = { id: `attempt-${randomUUID()}`, exerciseId, exerciseRevision, files: clone(sourceFiles), mode, result: clone(result), createdAt: new Date().toISOString() };
      findLesson(state, studentId, lessonId).attempts.push(attempt);
      write(state);
      return clone(attempt);
    },
    addSubmission(studentId, lessonId, metadata, data) {
      const state = read();
      const lesson = findLesson(state, studentId, lessonId);
      const blobId = randomUUID();
      const destination = path.join(uploadDirectory, blobId);
      const submission = { id: `submission-${randomUUID()}`, filename: metadata.filename, size: data.length, createdAt: new Date().toISOString(), comment: metadata.comment, repositoryUrl: metadata.repositoryUrl, status: 'submitted', feedback: '', blobId };
      atomicWrite(destination, data);
      try { lesson.submissions.push(submission); write(state); }
      catch (error) { try { fs.unlinkSync(destination); } catch {} throw error; }
      return clone(submission);
    },
    reviewSubmission(studentId, lessonId, submissionId, status, feedback) {
      const state = read();
      const submission = findLesson(state, studentId, lessonId).submissions.find(item => item.id === submissionId);
      if (!submission) fail('Сдача домашней работы не найдена.', 404);
      Object.assign(submission, { status, feedback, reviewedAt: new Date().toISOString() });
      write(state);
      return clone(submission);
    },
    readSubmissionFile(studentId, lessonId, submissionId) {
      const submission = findLesson(read(), studentId, lessonId).submissions.find(item => item.id === submissionId);
      if (!submission) fail('Сдача домашней работы не найдена.', 404);
      try {
        const root = fs.realpathSync(uploadDirectory);
        const target = fs.realpathSync(path.join(uploadDirectory, submission.blobId));
        if (!target.startsWith(root + path.sep)) fail('Файл домашней работы недоступен.', 404);
        const info = fs.statSync(target);
        if (!info.isFile() || info.size !== submission.size) fail('Файл домашней работы недоступен.', 404);
        return { submission: clone(submission), data: fs.readFileSync(target) };
      } catch { fail('Файл домашней работы недоступен.', 404); }
    },
  };
}

module.exports = { createPracticeStore };
