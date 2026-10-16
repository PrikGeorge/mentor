import { test, expect, mockSession, type Page } from './fixtures';

// T23: the teacher's month view and the student's calendar on synthetic data, on a wide screen and a phone.
const NOW = new Date('2026-10-15T12:30:00Z'); // Thursday 15 October 2026, 15:30 in Moscow.
const summary = (id: string, studentId: string, date: string, time: string, number: number, extra: Record<string, unknown> = {}) => ({
    id,
    workspaceId: 'w1',
    studentId,
    title: 'Коллекции и ' + id,
    date,
    time,
    timeZone: 'Europe/Moscow',
    duration: 60,
    status: 'planned',
    bundleId: null,
    revision: 1,
    createdAt: '2026-10-01T10:00:00Z',
    number,
    hasStudentNotes: false,
    ...extra,
});
const anna = [
    summary('a1', 's1', '2026-10-05', '10:00', 1, { conductedAt: '2026-10-05T08:00:00Z' }),
    summary('a2', 's1', '2026-10-15', '15:00', 2),
    summary('a3', 's1', '2026-10-22', '18:00', 3),
];
const boris = [summary('b1', 's2', '2026-10-15', '09:00', 4), summary('b2', 's2', '2026-10-20', '19:30', 5), summary('b3', 's2', '2026-10-20', '20:30', 6)];
const student = {
    id: 's1',
    workspaceId: 'w1',
    userId: 'u-s1',
    revision: 1,
    createdAt: '2026-10-01T10:00:00Z',
    name: 'Анна Петрова',
    direction: 'Java',
    goal: 'Первая работа',
    schedule: 'Четверг',
    studentRoadmap: '',
    studentReview: '',
};

async function routes(page: Page) {
    await page.clock.setFixedTime(NOW);
    await page.route('**/api/v1/**', (route) =>
        route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } })
    );
    await page.route('**/api/v1/workspaces/w1/schedule?*', (route) => {
        const url = new URL(route.request().url());
        const from = url.searchParams.get('from')!,
            to = url.searchParams.get('to')!;
        const items = [...anna.map((lesson) => ({ studentName: 'Анна Петрова', lesson })), ...boris.map((lesson) => ({ studentName: 'Борис Иванов', lesson }))]
            .filter((item) => item.lesson.date >= from && item.lesson.date <= to)
            .sort((a, b) => (a.lesson.date + a.lesson.time).localeCompare(b.lesson.date + b.lesson.time));
        return route.fulfill({ json: { from, to, items } });
    });
    await page.route('**/api/v1/workspaces/w1/students/s1/schedule?*', (route) => {
        const url = new URL(route.request().url());
        const from = url.searchParams.get('from')!,
            to = url.searchParams.get('to')!;
        return route.fulfill({ json: { from, to, items: anna.filter((lesson) => lesson.date >= from && lesson.date <= to) } });
    });
    await page.route('**/api/v1/workspaces/w1/students/s1', (route) => route.fulfill({ json: student }));
}
async function noSideScroll(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
}

test('the teacher sees the month of every student, filters one and reads the next lessons', async ({ page }, testInfo) => {
    await routes(page);
    await mockSession(page, { userId: 'u-t', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/teacher/schedule?view=month');
    await expect(page.getByRole('button', { name: 'Месяц', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const grid = page.getByRole('table', { name: 'Октябрь 2026' });
    await expect(grid.getByRole('link', { name: /^10:00, Анна Петрова, занятие № 1/ })).toBeVisible();
    await expect(grid.getByRole('link', { name: /^19:30, Борис Иванов/ })).toBeVisible();
    const upcoming = page.getByRole('region', { name: 'Ближайшие занятия' });
    await expect(upcoming.getByText('Идёт сейчас')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('teacher-month-1280.png'), fullPage: true });
    await page.getByLabel('Ученик', { exact: true }).selectOption({ label: 'Борис Иванов' });
    await expect(page).toHaveURL(/student=s2/);
    await expect(grid.getByRole('link', { name: /Анна Петрова/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Следующий', exact: true }).click();
    await expect(page.locator('.month-label')).toHaveText('Ноябрь 2026');
    await expect(page.getByText('В этом месяце занятий нет.')).toBeVisible();
    await page.getByRole('button', { name: 'Этот месяц', exact: true }).click();
    await expect(page.locator('.month-label')).toBeFocused();
    await expect(page.locator('.month-label')).toHaveText('Октябрь 2026');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/teacher/schedule?view=month');
    await noSideScroll(page);
    await page.getByRole('button', { name: '20 октября, 2 занятия' }).click();
    await expect(page.getByRole('region', { name: 'Занятия: Вторник, 20 октября' }).getByRole('link')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('teacher-month-390.png'), fullPage: true });
});

test('the student opens their calendar from the header and the teacher previews it read-only', async ({ page }, testInfo) => {
    await routes(page);
    let actor = { userId: 'u-s1', workspaceId: 'w1', role: 'STUDENT' as const, authVersion: 1 };
    await mockSession(page, () => actor);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/learn/students/s1/calendar');
    await expect(page.getByRole('heading', { name: 'Календарь', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Календарь', exact: true }).first()).toHaveAttribute(
        'href',
        '/learn/students/s1/calendar'
    );
    const grid = page.getByRole('table', { name: 'Октябрь 2026' });
    await expect(grid.getByRole('link', { name: /^10:00, занятие № 1, .*Проведено$/ })).toBeVisible();
    await expect(grid.getByRole('link', { name: /Борис/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('student-calendar-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noSideScroll(page);
    await page.screenshot({ path: testInfo.outputPath('student-calendar-390.png'), fullPage: true });
    actor = { userId: 'u-t', workspaceId: 'w1', role: 'TEACHER' as never, authVersion: 1 };
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/teacher/students/s1/calendar?preview=student');
    await expect(page.getByRole('table', { name: 'Октябрь 2026' }).getByRole('link').first()).toHaveAttribute('href', /preview=student/);
    await expect(page.locator('.calendar-filter')).toHaveCount(0);
});
