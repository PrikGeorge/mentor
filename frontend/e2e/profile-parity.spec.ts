import { test, expect, Page } from '@playwright/test';
import type { components } from '../src/app/api/schema';
type Summary = components['schemas']['MaterialSummary'];
const student: components['schemas']['TeacherStudentView'] = { id: 's1', workspaceId: 'w1', userId: null, name: 'Synthetic learner', direction: 'Java', goal: '', schedule: '', notes: 'PRIVATE_CARD', studentRoadmap: '', studentReview: '', revision: 1, createdAt: '2030-01-01T00:00:00Z' };
const lesson: components['schemas']['TeacherLessonView'] = { id: 'l1', workspaceId: 'w1', studentId: 's1', title: 'Synthetic lesson', date: '2030-01-01', time: '12:00', duration: 60, timeZone: 'Europe/Moscow', status: 'prepared', bundleId: 'b1', revision: 1, createdAt: '2030-01-01T00:00:00Z', teacherNotes: '', studentNotes: '', reviewNotes: '' };
const meta: Summary = { id: 'profile-id', workspaceId: 'w1', studentId: 's1', lessonId: null, bundleId: null, audience: 'teacher', kind: 'doc', contentKey: 'profile', filename: 'profile.md', contentType: 'text/markdown', title: 'Synthetic profile' };
const profileDocs = ['profile', 'projects', 'career', 'journal', 'core', 'course', 'roadmap'].map(key => ({ ...meta, id: 'exact-' + key, contentKey: key, title: 'Synthetic ' + key }));
const publicRoadmap = { ...meta, id: 'exact-public-roadmap', contentKey: 'student-roadmap', audience: 'student' as const }, publicGoal = { ...meta, id: 'public-profile-view', contentKey: 'arbitrary-card', audience: 'student' as const, kind: 'view' as const };
const teacherView = { ...meta, id: 'combined-teacher-view', lessonId: 'l1', bundleId: 'b1', contentKey: 'legacy-teacher-view', kind: 'view' as const }, guide = { ...teacherView, id: 'exact-guide', contentKey: 'guide', kind: 'doc' as const }, answer = { ...guide, id: 'exact-answer', contentKey: 'ListSolutions', kind: 'code' as const };
async function api(page: Page) {
    let role: 'TEACHER' | 'STUDENT' = 'TEACHER', lessonLists = 0;
    await page.route('**/api/v1/**', async (route) => {
        const u = new URL(route.request().url()), p = u.pathname, publicView = role === 'STUDENT' || u.searchParams.get('audience') === 'student';
        if (p === '/api/v1/auth/session') {
            await route.fulfill({ json: { account: { userId: role, workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' } });
            return;
        }
        if (p === '/api/v1/workspaces/w1/students/s1') {
            const { notes, ...publicStudent } = student;
            await route.fulfill({ json: publicView ? publicStudent : student });
            return;
        }
        if (p.endsWith('/students/s1/lessons')) {
            lessonLists++;
            await route.fulfill({ json: { items: [], page: 0, size: 25, total: 0 } });
            return;
        }
        if (p.endsWith('/lessons/l1')) {
            const { teacherNotes, ...publicLesson } = lesson;
            await route.fulfill({ json: publicView ? publicLesson : lesson });
            return;
        }
        if (p.endsWith('/materials') && p.includes('/students/')) {
            const rows = p.includes('/lessons/l1/') ? [teacherView, guide, answer] : [...profileDocs, publicRoadmap, publicGoal];
            await route.fulfill({ json: { items: rows.filter(row => !publicView || row.audience === 'student'), page: 0, size: 25, total: rows.filter(row => !publicView || row.audience === 'student').length } });
            return;
        }
        if (p.startsWith('/api/v1/workspaces/w1/materials/')) {
            const id = p.split('/').at(-1), row = [...profileDocs, publicRoadmap, publicGoal, teacherView, guide, answer].find(row => row.id === id && (!publicView || row.audience === 'student'));
            if (row) {
                let detail: unknown;
                if (row.kind === 'doc')
                    detail = { document: { title: row.title, intro: '', raw: 'synthetic raw', html: '', sections: [{ id: 'section-0', title: 'Synthetic section', html: row.contentKey === 'profile' ? '<p>PRIVATE_PROFILE</p><a href="#core/section-0">Core by keyboard</a><a href="#projects">Projects</a>' : row.contentKey === 'student-roadmap' ? '<p>PUBLIC_ROADMAP</p>' : '<p>DOC_' + row.contentKey + '</p>' }] } };
                else if (row.kind === 'code')
                    detail = { code: { text: 'PRIVATE_ANSWER_SOURCE', teacher: true, materialId: 'exact-answer-download' } };
                else
                    detail = { viewData: row.id === publicGoal.id ? { goalHtml: '<p>PUBLIC_GOAL</p>' } : { lessonHtml: '<p>PRIVATE_LESSON_VIEW</p>', reviewHtml: '<p>PRIVATE_REVIEW_VIEW</p>', profileFacts: '<p>PRIVATE_FACTS_VIEW</p>', resources: [['guide', 'Resource', 'Synthetic guide', 'Guide descriptor']], descriptors: { guide: ['Descriptor', 'DESC_VIEW'] }, answersCards: [['ListSolutions', 'Synthetic answer', 'ANSWER_VIEW']] } };
                await route.fulfill({ json: { ...row, ...detail } });
                return;
            }
        }
        await route.fulfill({ status: 404, json: { message: 'Synthetic unavailable' } });
    });
    return { role: (value: 'TEACHER' | 'STUDENT') => role = value, lessonLists: () => lessonLists };
}
for (const width of [1280, 390])
    test(`prepared profile public roadmap goal combined teacher view and keyboard targets at${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await api(page);
        await page.goto('/teacher/students/s1/profile');
        await expect(page.locator('main .sh h2')).toHaveText('Навыки и наблюдения');
        await expect(page.locator('.material-document')).toContainText('PRIVATE_PROFILE');
        expect(state.lessonLists()).toBe(0);
        if (width === 390)
            await page.getByRole('button', { name: 'Меню', exact: true }).click();
        await expect(page.locator('nav[aria-label="Карточка ученика"] a[href$="/profile"]')).toBeVisible();
        await expect(page.locator('nav[aria-label="Карточка ученика"] a[href$="/projects"]')).toBeVisible();
        if (width === 390)
            await page.getByRole('button', { name: 'Закрыть меню', exact: true }).click();
        const core = page.getByRole('link', { name: 'Core by keyboard', exact: true });
        await core.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/materials\/exact-core#section-0$/);
        await expect(page.locator('.material-document')).toContainText('DOC_core');
        expect(state.lessonLists()).toBe(0);
        await page.goto('/teacher/students/s1/lessons/l1/teacher/plan');
        for (const marker of ['PRIVATE_LESSON_VIEW', 'PRIVATE_REVIEW_VIEW', 'PRIVATE_FACTS_VIEW', 'DESC_VIEW', 'ANSWER_VIEW'])
            await expect(page.locator('.material-document')).toContainText(marker);
        await expect(page.locator('.material-document a[href$="/teacher/materials/exact-answer"]')).toBeVisible();
        state.role('STUDENT');
        await page.goto('/learn/students/s1/roadmap');
        await expect(page.locator('.material-document')).toContainText('PUBLIC_ROADMAP');
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await page.goto('/learn/students/s1/goal');
        await expect(page.locator('.material-document')).toContainText('PUBLIC_GOAL');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        state.role('TEACHER');
        await page.goto('/teacher/students/s1/roadmap?preview=student');
        await expect(page.locator('.material-document')).toContainText('PUBLIC_ROADMAP');
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await expect(page.locator('nav[aria-label="Кабинет ученика"] a[href$="/profile"]')).toHaveCount(0);
    });
