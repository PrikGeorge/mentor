'use strict';

function deny(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
function identity(principal) {
  if (!principal) deny(401, 'UNAUTHORIZED', 'Войдите в аккаунт.');
  if (!['teacher', 'student'].includes(principal.role)) deny(403, 'FORBIDDEN', 'Недостаточно прав.');
}
function requireTeacher(principal) {
  identity(principal);
  if (principal.role !== 'teacher') deny(403, 'FORBIDDEN', 'Доступ разрешён преподавателю.');
}
function requireStudentOwner(principal, studentId) {
  identity(principal);
  if (principal.role !== 'student') deny(403, 'FORBIDDEN', 'Действие доступно ученику.');
  if (principal.studentId !== studentId) deny(404, 'NOT_FOUND', 'Ученик не найден.');
}
function requireLessonReader(principal, state, studentId, lessonId) {
  identity(principal);
  if (principal.role === 'student' && principal.studentId !== studentId) deny(404, 'NOT_FOUND', 'Занятие не найдено.');
  if (!state.students.some(student => student.id === studentId)) deny(404, 'NOT_FOUND', 'Ученик не найден.');
  const lesson = state.lessons.find(item => item.id === lessonId && item.studentId === studentId);
  if (!lesson) deny(404, 'NOT_FOUND', 'Занятие не найдено.');
  return lesson;
}
const STUDENT_FIELDS = ['id', 'name', 'direction', 'goal', 'schedule', 'studentRoadmap', 'studentReview', 'createdAt'];
const LESSON_FIELDS = ['id', 'studentId', 'date', 'time', 'duration', 'title', 'status', 'bundleId', 'studentNotes', 'reviewNotes', 'createdAt'];
function pick(record, fields) { return Object.fromEntries(fields.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]])); }
function stateFor(principal, state) {
  identity(principal);
  if (principal.role === 'teacher') return state;
  const student = state.students.find(item => item.id === principal.studentId);
  if (!student) deny(404, 'NOT_FOUND', 'Ученик не найден.');
  return { version: state.version, students: [pick(student, STUDENT_FIELDS)], lessons: state.lessons.filter(item => item.studentId === principal.studentId).map(item => pick(item, LESSON_FIELDS)) };
}
module.exports = { requireTeacher, requireStudentOwner, requireLessonReader, stateFor };
