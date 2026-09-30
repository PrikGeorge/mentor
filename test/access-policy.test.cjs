'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireTeacher, requireStudentOwner, requireLessonReader, stateFor } = require('../lib/access-policy.cjs');

const teacher = { id: 'teacher', role: 'teacher', studentId: null };
const owner = { id: 'a', role: 'student', studentId: 'student-a' };
const other = { id: 'b', role: 'student', studentId: 'student-b' };
const state = { version: 1, students: [
  { id: 'student-a', name: 'A', direction: 'Java', goal: 'Goal A', schedule: 'Monday', studentRoadmap: 'ROADMAP_A', studentReview: 'REVIEW_A', notes: 'PRIVATE_A', createdAt: '2026-09-30' },
  { id: 'student-b', name: 'B', direction: 'Java', goal: 'Goal B', schedule: 'Friday', studentRoadmap: 'ROADMAP_B', studentReview: 'REVIEW_B', notes: 'PRIVATE_B', createdAt: '2026-09-30' },
], lessons: [
  { id: 'lesson-a', studentId: 'student-a', title: 'A lesson', date: '2026-10-01', time: '12:00', duration: 60, status: 'prepared', bundleId: null, studentNotes: 'STUDENT_A', reviewNotes: 'LESSON_REVIEW_A', teacherNotes: 'TEACHER_A', createdAt: '2026-09-30' },
  { id: 'lesson-b', studentId: 'student-b', title: 'B lesson', date: '2026-10-02', time: '12:00', duration: 60, status: 'planned', bundleId: null, studentNotes: 'STUDENT_B', reviewNotes: 'LESSON_REVIEW_B', teacherNotes: 'TEACHER_B', createdAt: '2026-09-30' },
] };
const status = (fn, expected) => assert.throws(fn, error => error.status === expected);

test('state projection reveals only the owner card and allowlisted fields', () => {
  assert.deepEqual(stateFor(teacher, state), state);
  const result = stateFor(owner, state);
  assert.deepEqual(result, { version: 1,
    students: [{ id: 'student-a', name: 'A', direction: 'Java', goal: 'Goal A', schedule: 'Monday', studentRoadmap: 'ROADMAP_A', studentReview: 'REVIEW_A', createdAt: '2026-09-30' }],
    lessons: [{ id: 'lesson-a', studentId: 'student-a', title: 'A lesson', date: '2026-10-01', time: '12:00', duration: 60, status: 'prepared', bundleId: null, studentNotes: 'STUDENT_A', reviewNotes: 'LESSON_REVIEW_A', createdAt: '2026-09-30' }],
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|TEACHER_|STUDENT_B|ROADMAP_B|REVIEW_B/);
  assert.equal(result.students[0].studentReview, 'REVIEW_A', 'legacy archive stays available only to its owner');
});

test('role and object checks distinguish missing identity, wrong role and hidden object', () => {
  status(() => requireTeacher(null), 401);
  status(() => requireTeacher(owner), 403);
  requireTeacher(teacher);
  status(() => requireStudentOwner(null, 'student-a'), 401);
  status(() => requireStudentOwner(teacher, 'student-a'), 403);
  status(() => requireStudentOwner(other, 'student-a'), 404);
  requireStudentOwner(owner, 'student-a');
  status(() => requireLessonReader(null, state, 'student-a', 'lesson-a'), 401);
  status(() => requireLessonReader(other, state, 'student-a', 'lesson-a'), 404);
  status(() => requireLessonReader(owner, state, 'student-b', 'lesson-b'), 404);
  status(() => requireLessonReader(teacher, state, 'student-b', 'lesson-a'), 404);
  assert.equal(requireLessonReader(owner, state, 'student-a', 'lesson-a').id, 'lesson-a');
});
