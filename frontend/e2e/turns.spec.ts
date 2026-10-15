import { expect, test, type Page } from '@playwright/test';

// Synthetic data only: one teacher workspace, one pupil, one lesson whose latest work awaits review.
const student = {
    id: 's1',
    workspaceId: 'w1',
    userId: 'u1',
    revision: 1,
    createdAt: '2026-10-01T10:00:00Z',
    name: 'Анна Соколова',
    direction: 'Java backend',
    goal: 'Junior Java через 6 месяцев',
    schedule: 'Вт и Пт, 19:00 МСК',
    notes: 'PRIVATE_NOTE',
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
    teacherNotes: 'PRIVATE_SCRIPT',
    studentNotes: 'Задания занятия',
    reviewNotes: '',
};
const lessonSummary = () => {
    const { teacherNotes, studentNotes, reviewNotes, ...summary } = lesson;
    return { ...summary, hasStudentNotes: !!studentNotes.trim() };
};
const submission = {
    id: 'h1',
    filename: 'orders-grouping.zip',
    size: 19000,
    createdAt: '2026-10-13T18:40:00Z',
    comment: 'Переделала через computeIfAbsent',
    repositoryUrl: '',
    status: 'submitted',
    feedback: '',
    revision: 1,
};
const page = (items: unknown[]) => ({ items, page: 0, size: 25, total: items.length });

async function fixtures(page_: Page, role: 'TEACHER' | 'STUDENT') {
    const errors: string[] = [];
    page_.on('pageerror', (error) => errors.push(error.message));
    await page_.route('**/api/v1/**', async (route) => {
        const url = new URL(route.request().url()),
            path = url.pathname;
        const own = (value: Record<string, unknown>) =>
            role === 'STUDENT' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'notes' && key !== 'teacherNotes')) : value;
        const routes: Record<string, unknown> = {
            '/api/v1/auth/session': { account: { userId: role === 'TEACHER' ? 't1' : 'u1', workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' },
            '/api/v1/workspaces/w1/students': page([own(student)]),
            '/api/v1/workspaces/w1/students/s1': own(student),
            '/api/v1/workspaces/w1/students/s1/dashboard': { student: own(student), lessonCount: 1, focus: { lesson: lessonSummary(), upcoming: true } },
            '/api/v1/workspaces/w1/students/dashboards': page([{ student: own(student), lessonCount: 1, focus: { lesson: lessonSummary(), upcoming: true } }]),
            '/api/v1/workspaces/w1/students/s1/lessons': page([lessonSummary()]),
            '/api/v1/workspaces/w1/students/s1/lessons/l1': own(lesson),
            '/api/v1/workspaces/w1/students/s1/access': { account: { userId: 'u1', login: 'anna', disabled: false }, invitation: null },
            '/api/v1/workspaces/w1/students/s1/lessons/l1/homework': page([submission]),
            '/api/v1/workspaces/w1/students/s1/lessons/l1/materials': page([]),
            '/api/v1/workspaces/w1/students/s1/moves': page([]),
            '/api/v1/workspaces/w1/students/s1/roadmap': { stages: [], revision: 0 },
            '/api/v1/workspaces/w1/students/s1/homework/turns': page([
                { lessonId: 'l1', submissionId: 'h1', filename: submission.filename, status: 'submitted', createdAt: submission.createdAt },
            ]),
            '/api/v1/workspaces/w1/homework/turns': page([
                {
                    studentId: 's1',
                    studentName: student.name,
                    lessonId: 'l1',
                    lessonTitle: lesson.title,
                    lessonDate: lesson.date,
                    submissionId: 'h1',
                    filename: submission.filename,
                    comment: submission.comment,
                    status: 'submitted',
                    createdAt: submission.createdAt,
                    awaitingReview: 1,
                },
            ]),
        };
        if (path in routes) {
            await route.fulfill({ json: routes[path] });
            return;
        }
        await route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } });
    });
    return errors;
}

for (const width of [1280, 390]) {
    test(`teacher sees whose turn it is in the queue, the card and the review tab at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await fixtures(page, 'TEACHER');
        await page.goto('/teacher/students');
        await expect(page.getByRole('heading', { name: 'Ход за вами', exact: true })).toBeVisible();
        await expect(page.locator('.queue')).toContainText('Переделала через computeIfAbsent');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: test.info().outputPath(`queue-${width}.png`), fullPage: true });
        await page.locator('.queue').getByRole('link', { name: 'Открыть ревью' }).click();
        await expect(page).toHaveURL('/teacher/students/s1/lessons/l1/teacher/review');
        await expect(page.locator('.homework-history .face.on')).toContainText('ход за вами');
        await page.goto('/teacher/students/s1');
        await expect(page.locator('.turn-cell')).toContainText('Ход за вами');
        await expect(page.locator('.card-turn').getByRole('link', { name: 'Открыть ревью' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: test.info().outputPath(`card-${width}.png`), fullPage: true });
        expect(errors).toEqual([]);
    });
    test(`learner sees that the move is the mentor's after sending work at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await fixtures(page, 'STUDENT');
        await page.goto('/learn');
        await expect(page.locator('.turn')).toContainText('Ход у наставника');
        await expect(page.locator('.home-clock .face.on')).toContainText('Наставник');
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: test.info().outputPath(`home-${width}.png`), fullPage: true });
        await page.goto('/learn/students/s1/lessons/l1/student/homework');
        await expect(page.locator('.homework-history .face.on')).toContainText('ход у наставника');
        await page.screenshot({ path: test.info().outputPath(`homework-${width}.png`), fullPage: true });
        expect(errors).toEqual([]);
    });
}
