import type { ActivatedRouteSnapshot, Route } from '@angular/router';
import { routes } from '../app.routes';
import { shouldAnimate } from './route-motion';

// Root-to-leaf chains over the real route table: [parent path, child path] where the child lives under a parent.
const config = (path: string, parent?: string): Route => {
    const pool = parent ? (routes.find((route) => route.path === parent)?.children ?? []) : routes;
    const found = pool.find((route) => route.path === path);
    if (!found) throw new Error('No route ' + path);
    return found;
};
const snapshot = (...chain: Route[]) =>
    chain.reduceRight<ActivatedRouteSnapshot | null>(
        (child, routeConfig) => ({ routeConfig, data: routeConfig.data ?? {}, firstChild: child }) as unknown as ActivatedRouteSnapshot,
        null
    )!;
const at = (path: string, parent?: string) => (parent ? snapshot(config(parent), config(path, parent)) : snapshot(config(path)));
const calm = { reduced: false, accountChanged: false };

describe('Section transitions (UX-28 M3)', () => {
    it('cross-fades between different sections', () => {
        expect(shouldAnimate(at('', 'teacher/students'), at(':studentId', 'teacher/students'), calm)).toBe(true);
        expect(shouldAnimate(at('teacher/schedule'), at('', 'teacher/students'), calm)).toBe(true);
        expect(
            shouldAnimate(
                at(':studentId/lessons/:lessonId', 'teacher/students'),
                at(':studentId/lessons/:lessonId/:audience/:section', 'teacher/students'),
                calm
            )
        ).toBe(true);
        expect(shouldAnimate(at(':studentId/lessons', 'teacher/students'), at(':studentId/roadmap', 'teacher/students'), calm)).toBe(true);
    });

    it('skips when the routed screen stays (only query, or tabs inside one lesson screen)', () => {
        expect(shouldAnimate(at('teacher/schedule'), at('teacher/schedule'), calm)).toBe(false);
        const section = at(':studentId/lessons/:lessonId/:audience/:section', 'teacher/students');
        expect(shouldAnimate(section, at(':studentId/lessons/:lessonId/:audience/:section', 'teacher/students'), calm)).toBe(false);
    });

    it('skips another student or lesson on the same route: the routed screen stays and reloads in place', () => {
        expect(shouldAnimate(at(':studentId', 'teacher/students'), at(':studentId', 'teacher/students'), calm)).toBe(false);
        expect(shouldAnimate(at(':studentId/lessons/:lessonId', 'teacher/students'), at(':studentId/lessons/:lessonId', 'teacher/students'), calm)).toBe(false);
    });

    it('skips entering or leaving the trainer', () => {
        expect(
            shouldAnimate(
                at(':studentId/lessons/:lessonId/:audience/:section', 'teacher/students'),
                at(':studentId/lessons/:lessonId/:audience/practice', 'teacher/students'),
                calm
            )
        ).toBe(false);
        expect(
            shouldAnimate(at(':studentId/lessons/:lessonId/:audience/practice/:detail', 'teacher/students'), at(':studentId', 'teacher/students'), calm)
        ).toBe(false);
    });

    it('skips sign-in pages and the missing page', () => {
        expect(shouldAnimate(at('login'), at('', 'teacher/students'), calm)).toBe(false);
        expect(shouldAnimate(at('', 'teacher/students'), at('account/password'), calm)).toBe(false);
        expect(shouldAnimate(at('', 'teacher/students'), at('**'), calm)).toBe(false);
    });

    it('skips with reduced motion and whenever the account changed during the navigation', () => {
        const from = at('', 'teacher/students');
        const to = at(':studentId', 'teacher/students');
        expect(shouldAnimate(from, to, { reduced: true, accountChanged: false })).toBe(false);
        expect(shouldAnimate(from, to, { reduced: false, accountChanged: true })).toBe(false);
    });
});
