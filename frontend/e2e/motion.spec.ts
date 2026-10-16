import { expect, test, mockSession, type Page } from './fixtures';

// UX-28: motion plays only for changes in front of the user, and never with reduced motion.
// Synthetic data only: one teacher workspace, one pupil, one lesson with one work.
const student = {
    id: 's1',
    workspaceId: 'w1',
    userId: 'u1',
    revision: 1,
    createdAt: '2026-10-01T10:00:00Z',
    name: 'Анна Соколова',
    direction: 'Java backend',
    goal: '',
    schedule: '',
    notes: '',
    studentRoadmap: '',
    studentReview: '',
};
const lesson = {
    id: 'l1',
    workspaceId: 'w1',
    studentId: 's1',
    title: 'Коллекции: List и Map',
    date: '2030-01-01',
    time: '19:00',
    timeZone: 'Europe/Moscow',
    duration: 90,
    status: 'prepared',
    bundleId: null,
    revision: 1,
    createdAt: '2026-10-01T10:00:00Z',
    teacherNotes: '',
    studentNotes: 'Задания занятия',
    reviewNotes: '',
};
const { teacherNotes: _t, studentNotes: _s, reviewNotes: _r, ...summary } = lesson;
const lessonSummary = { ...summary, hasStudentNotes: true };
const work = (status: 'submitted' | 'reviewed') => ({
    id: 'h1',
    filename: 'orders.zip',
    size: 19000,
    createdAt: '2026-10-13T18:40:00Z',
    comment: '',
    repositoryUrl: '',
    status,
    feedback: status === 'reviewed' ? 'Хорошо' : '',
    revision: 1,
    ...(status === 'reviewed' ? { reviewedAt: '2026-10-14T10:00:00Z' } : {}),
});
const list = (items: unknown[]) => ({ items, page: 0, size: 25, total: items.length });

async function fixtures(page: Page, role: 'TEACHER' | 'STUDENT', state: { status: 'submitted' | 'reviewed' }) {
    await page.route('**/api/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const routes: Record<string, unknown> = {
            '/api/v1/workspaces/w1/students': list([student]),
            '/api/v1/workspaces/w1/students/s1': student,
            '/api/v1/workspaces/w1/students/s1/dashboard': { student, lessonCount: 1, focus: { lesson: lessonSummary, upcoming: true } },
            '/api/v1/workspaces/w1/students/dashboards': list([{ student, lessonCount: 1, focus: { lesson: lessonSummary, upcoming: true } }]),
            '/api/v1/workspaces/w1/students/s1/lessons': list([lessonSummary]),
            '/api/v1/workspaces/w1/students/s1/lessons/l1': lesson,
            '/api/v1/workspaces/w1/students/s1/lessons/l1/homework': list([work(state.status)]),
            '/api/v1/workspaces/w1/students/s1/lessons/l1/materials': list([]),
            '/api/v1/workspaces/w1/students/s1/moves': list([]),
            '/api/v1/workspaces/w1/students/s1/roadmap': { stages: [], revision: 0 },
            '/api/v1/workspaces/w1/students/s1/homework/turns': list([]),
            '/api/v1/workspaces/w1/homework/turns': list([]),
        };
        if (path in routes) await route.fulfill({ json: routes[path] });
        else await route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } });
    });
    await mockSession(page, { userId: role === 'TEACHER' ? 't1' : 'u1', workspaceId: 'w1', role, authVersion: 1 });
}

// Counts what the app asks the browser to animate and every view transition it starts or skips.
async function recordMotion(page: Page) {
    await page.addInitScript(() => {
        const log = { animate: [] as string[], started: 0, skipped: 0 };
        (window as unknown as { motionLog: typeof log }).motionLog = log;
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (
            this: Element,
            frames: Keyframe[] | PropertyIndexedKeyframes | null,
            options?: number | KeyframeAnimationOptions
        ) {
            const pseudo = typeof options === 'object' && options.pseudoElement ? options.pseudoElement : '';
            log.animate.push(`${this.className}${pseudo}`);
            return animate.call(this, frames, options);
        };
        const start = document.startViewTransition?.bind(document);
        if (start)
            document.startViewTransition = ((callback?: ViewTransitionUpdateCallback) => {
                log.started++;
                const transition = start(callback);
                const skip = transition.skipTransition.bind(transition);
                transition.skipTransition = () => {
                    log.skipped++;
                    skip();
                };
                return transition;
            }) as typeof document.startViewTransition;
    });
}
const motionLog = (page: Page) => page.evaluate(() => (window as unknown as { motionLog: { animate: string[]; started: number; skipped: number } }).motionLog);
const longAnimations = (page: Page) =>
    page.evaluate(() => document.getAnimations().filter((animation) => Number(animation.effect?.getComputedTiming().duration) > 1).length);

test.describe('with motion', () => {
    test.use({ reducedMotion: 'no-preference', viewport: { width: 1280, height: 900 } });

    test('the clock plays a move only when the turn changes on screen', async ({ page }) => {
        const state = { status: 'reviewed' as 'submitted' | 'reviewed' };
        await recordMotion(page);
        await fixtures(page, 'STUDENT', state);
        await page.goto('/learn/students/s1/lessons/l1/student/homework');
        await expect(page.locator('.homework-history .face.on')).toContainText('твой ход');
        expect((await motionLog(page)).animate.filter((entry) => entry.includes('face'))).toEqual([]);
        state.status = 'submitted';
        await page.getByRole('button', { name: 'Обновить историю' }).click();
        await expect(page.locator('.homework-history .face.on')).toContainText('ход у наставника');
        await expect.poll(async () => (await motionLog(page)).animate.filter((entry) => entry.includes('face')).length).toBeGreaterThan(0);
        // The same turn after a reload is only shown, not played.
        await page.reload();
        await expect(page.locator('.homework-history .face.on')).toContainText('ход у наставника');
        await page.getByRole('button', { name: 'Обновить историю' }).click();
        await expect(page.locator('.homework-history .face.on')).toContainText('ход у наставника');
        expect((await motionLog(page)).animate.filter((entry) => entry.includes('face'))).toEqual([]);
    });

    test('sections cross-fade, tabs of one lesson slide instead', async ({ page }) => {
        await recordMotion(page);
        await fixtures(page, 'TEACHER', { status: 'submitted' });
        await page.goto('/teacher/students');
        await expect(page.getByRole('heading', { name: 'Мои ученики' })).toBeVisible();
        expect((await motionLog(page)).started).toBe(0);
        await page.locator('a.student-card').first().click();
        await expect(page).toHaveURL('/teacher/students/s1');
        await expect.poll(async () => (await motionLog(page)).started).toBe(1);
        expect((await motionLog(page)).skipped).toBe(0);
        await page.goto('/teacher/students/s1/lessons/l1/teacher/review');
        await expect(page.getByRole('navigation', { name: 'Разделы занятия' })).toBeVisible();
        const before = await motionLog(page);
        await page.getByRole('navigation', { name: 'Разделы занятия' }).getByRole('link', { name: 'Материалы' }).click();
        await expect(page).toHaveURL('/teacher/students/s1/lessons/l1/teacher/materials');
        await expect.poll(async () => (await motionLog(page)).skipped).toBe(before.skipped + 1);
        await expect.poll(async () => (await motionLog(page)).animate.filter((entry) => entry.endsWith('::before')).length).toBeGreaterThan(0);
    });
});

test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });

    test('nothing moves: no transitions, no animations, the same final states', async ({ page }) => {
        const state = { status: 'reviewed' as 'submitted' | 'reviewed' };
        await recordMotion(page);
        await fixtures(page, 'STUDENT', state);
        await page.goto('/learn/students/s1/lessons/l1/student/homework');
        await expect(page.locator('.homework-history .face.on')).toContainText('твой ход');
        state.status = 'submitted';
        await page.getByRole('button', { name: 'Обновить историю' }).click();
        await expect(page.locator('.homework-history .face.on')).toContainText('ход у наставника');
        await page.getByRole('navigation', { name: 'Разделы занятия' }).getByRole('link', { name: 'Задания' }).click();
        await expect(page).toHaveURL(/\/student\/tasks/);
        const log = await motionLog(page);
        expect(log.started).toBe(0);
        expect(log.animate).toEqual([]);
        expect(await longAnimations(page)).toBe(0);
    });

    test('the login page shows its final frame at once', async ({ page }) => {
        await mockSession(page, null);
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
        expect(await longAnimations(page)).toBe(0);
    });
});
