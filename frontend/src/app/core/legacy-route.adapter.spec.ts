import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LegacyRouteAdapter } from './legacy-route.adapter';
import { Actor } from './session.store';
const teacher: Actor = { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 };
describe('LegacyRouteAdapter', () => {
    beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
    const cases = [
        ['/#students/s1/materials/import-profile-actual-id', '/teacher/students/s1/materials/import-profile-actual-id'],
        ['/?screen=student#students/s1/materials/public-goal-view/section-0', '/teacher/students/s1/materials/public-goal-view?preview=student#section-0'],
        ['/#students/s1/core/section-0', '/teacher/students/s1/core#section-0'],
        ['/#students/s1/lessons/2026-09-27/teacher/materials/import-material-id/section-0', '/teacher/students/s1/lessons/2026-09-27/teacher/materials/import-material-id#section-0'],
        ['/#students/s1/lessons/l1/teacher/guide/section-0', '/teacher/students/s1/lessons/l1/teacher/guide#section-0'],
        ['/#students/s1/lessons/l1/student/code/ListTask', '/teacher/students/s1/lessons/l1/student/code/ListTask'],
        ['/#students/s1/lessons/l1/student/practice/list-filter', '/teacher/students/s1/lessons/l1/student/practice/list-filter'],
        ['/?screen=student#students/s1/lessons/l1/student/tasks/section-0', '/teacher/students/s1/lessons/l1/student/tasks?preview=student#section-0'],
        ['/#students/%E0%A4%A/lessons/l1/teacher/guide', '/not-found'],
        ['/#students/s1/lessons/section-0', '/teacher/students/s1/lessons#section-0'],
        ['/#students/s1/lessons/section-0/teacher/guide', '/teacher/students/s1/lessons/section-0/teacher/guide'],
    ];
    for (const [legacy, expected] of cases) {
        it(`preserves or rejects ${legacy}`, () => {
            const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL(legacy, 'http://localhost:4201'), teacher);
            expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe(expected);
        });
    }
    it('preserves the learner lesson-list section zero', () => {
        const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL('http://localhost/#students/s1/lessons/section-0'), { ...teacher, role: 'STUDENT' });
        expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe('/learn/students/s1/lessons#section-0');
    });
    it('preserves an actual section-shaped lesson ID when the learner audience disambiguates it', () => {
        const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL('http://localhost/#students/s1/lessons/section-0/student/tasks'), { ...teacher, role: 'STUDENT' });
        expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe('/learn/students/s1/lessons/section-0/student/tasks');
    });
    it('preserves learner material IDs and refuses a private profile shortcut', () => {
        const adapter = TestBed.inject(LegacyRouteAdapter), router = TestBed.inject(Router), actor = { ...teacher, role: 'STUDENT' as const };
        expect(router.serializeUrl(adapter.resolve(new URL('http://localhost/#students/s1/materials/public-material-id'), actor)!)).toBe('/learn/students/s1/materials/public-material-id');
        expect(router.serializeUrl(adapter.resolve(new URL('http://localhost/#students/s1/profile'), actor)!)).toBe('/not-found');
    });
    it('prevents ADMIN navigating into lessons from a legacy link', () => {
        const tree = TestBed.inject(LegacyRouteAdapter).resolve(new URL('http://localhost/#students/s1'), { ...teacher, role: 'ADMIN', workspaceId: null });
        expect(tree && TestBed.inject(Router).serializeUrl(tree)).toBe('/not-found');
    });
});
