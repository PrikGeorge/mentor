import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LegacyRouteAdapter } from './legacy-route.adapter';
import { Actor } from './session.store';
const teacher: Actor = { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 };
describe('LegacyRouteAdapter', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
  const cases = [
    ['/#students/s1/lessons/l1/teacher/guide/section-0', '/teacher/students/s1/lessons/l1/teacher/guide#section-0'],
    ['/#students/s1/lessons/l1/student/code/ListTask', '/teacher/students/s1/lessons/l1/student/code/ListTask'],
    ['/#students/s1/lessons/l1/student/practice/list-filter', '/teacher/students/s1/lessons/l1/student/practice/list-filter'],
    ['/?screen=student#students/s1/lessons/l1/student/tasks/section-0', '/teacher/students/s1/lessons/l1/student/tasks?preview=student#section-0'],
    ['/#students/%E0%A4%A/lessons/l1/teacher/guide', '/not-found'],
  ];
  for (const [legacy, expected] of cases) {
    it(`preserves or rejects ${legacy}`, () => {
      const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL(legacy, 'http://localhost:4201'), teacher);
      expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe(expected);
    });
  }
  it('prevents ADMIN navigating into lessons from a legacy link', () => {
    const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL('http://localhost/#students/s1'), { ...teacher, role: 'ADMIN', workspaceId: null });
    expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe('/not-found');
  });
});
