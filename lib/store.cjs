'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROFILE_FIELDS = { name: [120, 'Имя'], direction: [120, 'Направление'], goal: [1000, 'Цель'], schedule: [500, 'Расписание'], notes: [5000, 'Заметки'], studentRoadmap: [20000, 'Маршрут ученика'], studentReview: [20000, 'Ревью для ученика'] };
const LESSON_FIELDS = { title: [200, 'Название занятия'], date: null, time: null, duration: null, teacherNotes: [200000, 'Заметки преподавателя'], studentNotes: [200000, 'Материалы ученика'], reviewNotes: [200000, 'Ревью занятия'] };

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkFields(input, fields) {
  if (!isObject(input)) fail('Нужен объект с полями формы.');
  for (const field of Object.keys(input)) {
    if (!Object.hasOwn(fields, field)) fail('В запросе есть поле, которое нельзя изменять.');
  }
}

function textValue(value, maximum, label, required = false, preserveWhitespace = false) {
  if (typeof value !== 'string') fail(`${label}: введите текст.`);
  const text = preserveWhitespace ? value : value.trim();
  if (required && !text) fail(`${label}: заполните поле.`);
  if (text.length > maximum) fail(`${label}: не больше ${maximum} символов.`);
  return text;
}

function profileValues(input, existing) {
  checkFields(input, PROFILE_FIELDS);
  const values = {};
  for (const [field, [maximum, label]] of Object.entries(PROFILE_FIELDS)) {
    const value = Object.hasOwn(input, field) ? input[field] : existing?.[field] ?? (field === 'direction' ? 'Java Backend' : '');
    values[field] = textValue(value, maximum, label, field === 'name');
  }
  return values;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function lessonValues(input, existing) {
  checkFields(input, LESSON_FIELDS);
  const values = {};
  for (const field of Object.keys(LESSON_FIELDS)) {
    const value = Object.hasOwn(input, field) ? input[field] : existing?.[field] ?? (field.endsWith('Notes') ? '' : undefined);
    if (LESSON_FIELDS[field]) {
      // Markdown indentation and trailing spaces are meaningful source characters.
      values[field] = textValue(value, ...LESSON_FIELDS[field], field === 'title', field.endsWith('Notes'));
    } else if (field === 'date') {
      if (!validDate(value)) fail('Укажите существующую дату в формате ГГГГ-ММ-ДД.');
      values.date = value;
    } else if (field === 'time') {
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('Укажите время в формате ЧЧ:ММ, от 00:00 до 23:59.');
      values.time = value;
    } else {
      if (!Number.isInteger(value) || value < 15 || value > 240) fail('Продолжительность должна быть целым числом от 15 до 240 минут.');
      values.duration = value;
    }
  }
  return values;
}

function seed() {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    students: [{ id: 'michael', name: 'Михаэль', direction: 'Java Backend', goal: 'Стажировка / junior в Москве', schedule: 'Пн и пт по 60 минут', notes: '5–9 часов самостоятельной работы в неделю', createdAt }],
    lessons: [{ id: 'lesson-2026-09-27', studentId: 'michael', date: '2026-09-27', time: '12:00', duration: 60, title: 'Из ошибки — в проверку. Списки и группировка', status: 'prepared', bundleId: 'library-2026-09-27', teacherNotes: '', studentNotes: '', reviewNotes: '', createdAt }],
  };
}

function validateState(state) {
  if (!isObject(state) || state.version !== 1 || !Array.isArray(state.students) || !Array.isArray(state.lessons)) throw new Error('format');
  const studentIds = new Set();
  const lessonIds = new Set();
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  for (const student of state.students) {
    if (!isObject(student) || !validId(student.id) || studentIds.has(student.id) || !Number.isFinite(Date.parse(student.createdAt))) throw new Error('format');
    // Additive fields: old local databases keep their existing records and lesson IDs.
    for (const field of ['studentRoadmap', 'studentReview']) if (!Object.hasOwn(student, field)) student[field] = '';
    profileValues(Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key => [key, student[key]])));
    studentIds.add(student.id);
  }
  for (const lesson of state.lessons) {
    if (!isObject(lesson) || !validId(lesson.id) || lessonIds.has(lesson.id) || !studentIds.has(lesson.studentId) || !Number.isFinite(Date.parse(lesson.createdAt))) throw new Error('format');
    if (!['planned', 'prepared'].includes(lesson.status) || (lesson.bundleId !== null && lesson.bundleId !== 'library-2026-09-27')) throw new Error('format');
    // A review belongs to this lesson; preserve unscoped profile reviews as an archive.
    if (!Object.hasOwn(lesson, 'reviewNotes')) lesson.reviewNotes = '';
    lessonValues(Object.fromEntries(Object.keys(LESSON_FIELDS).map(key => [key, lesson[key]])));
    lessonIds.add(lesson.id);
  }
  return state;
}

function createStore({ dataDir = path.join(__dirname, '..', 'data') } = {}) {
  const directory = path.resolve(dataDir);
  const file = path.join(directory, 'mentoring.json');
  fs.mkdirSync(directory, { recursive: true });

  function read() {
    try {
      return validateState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if (error.code && !['ENOENT'].includes(error.code)) fail('Не удалось прочитать локальные данные. Проверьте доступ к папке data.', 500);
      fail('Файл mentoring.json повреждён или имеет неподдерживаемый формат. Данные не изменены; проверьте резервную копию mentoring.json.bak.', 500);
    }
  }

  function write(state, keepBackup) {
    const temporary = path.join(directory, `.mentoring-${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n', 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      if (keepBackup) fs.copyFileSync(file, file + '.bak');
      fs.renameSync(temporary, file);
    } catch {
      fail('Не удалось сохранить изменения на диске. Проверьте доступ и свободное место в папке data.', 500);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  if (!fs.existsSync(file)) write(seed(), false);
  read(); // Never replace a damaged file with the seed.

  function findStudent(state, id) {
    const student = state.students.find(item => item.id === id);
    if (!student) fail('Ученик не найден.', 404);
    return student;
  }

  return {
    getState: read,
    addStudent(input) {
      const values = profileValues(input);
      const state = read();
      const student = { id: `student-${randomUUID()}`, ...values, createdAt: new Date().toISOString() };
      state.students.push(student);
      write(state, true);
      return student;
    },
    updateStudent(id, input) {
      const state = read();
      const student = findStudent(state, id);
      Object.assign(student, profileValues(input, student));
      write(state, true);
      return student;
    },
    addLesson(studentId, input) {
      const state = read();
      findStudent(state, studentId);
      const lesson = { id: `lesson-${randomUUID()}`, studentId, ...lessonValues(input), status: 'planned', bundleId: null, createdAt: new Date().toISOString() };
      state.lessons.push(lesson);
      write(state, true);
      return lesson;
    },
    updateLesson(studentId, lessonId, input) {
      const state = read();
      findStudent(state, studentId);
      const lesson = state.lessons.find(item => item.id === lessonId && item.studentId === studentId);
      if (!lesson) fail('Занятие этого ученика не найдено.', 404);
      Object.assign(lesson, lessonValues(input, lesson));
      write(state, true);
      return lesson;
    },
  };
}

module.exports = { createStore };
