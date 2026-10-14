import { expect, test, type Page } from '@playwright/test';

// Synthetic data only: one teacher workspace, one pupil, one held lesson with a single-file Java work.
const student = { id: 's1', workspaceId: 'w1', userId: 'u1', revision: 1, createdAt: '2026-10-01T10:00:00Z', name: 'Анна Соколова', direction: 'Java backend', goal: 'Junior Java через 6 месяцев', schedule: 'Вт и Пт, 19:00 МСК', notes: 'PRIVATE_NOTE', studentRoadmap: 'Коллекции, затем Spring', studentReview: '' };
const lessonBase = { id: 'l1', workspaceId: 'w1', studentId: 's1', title: 'Коллекции: List и Map', date: '2026-10-08', time: '19:00', timeZone: 'Europe/Moscow', duration: 90, status: 'prepared', bundleId: null, revision: 1, createdAt: '2026-10-01T10:00:00Z', number: 3, teacherNotes: 'PRIVATE_SCRIPT', studentNotes: 'Сгруппировать заказы по клиенту' };
const code = 'import java.util.*;\n\nclass Orders {\n    Map<String, List<String>> byClient = new HashMap<>();\n}\n';
const page = (items: unknown[]) => ({ items, page: 0, size: 25, total: items.length });

async function fixtures(page_: Page, role: 'TEACHER' | 'STUDENT') {
    const errors: string[] = [], writes: { method: string; path: string; body: unknown }[] = [];
    let lesson: Record<string, unknown> = { ...lessonBase };
    let submission: Record<string, unknown> = { id: 'h1', filename: 'Orders.java', size: code.length, createdAt: '2026-10-09T18:40:00Z', comment: 'Сделала через HashMap', repositoryUrl: '', status: 'submitted', feedback: '', revision: 1 };
    let roadmap = { stages: [{ title: 'Синтаксис Java', note: 'сентябрь', state: 'done' }, { title: 'Коллекции', note: 'октябрь', state: 'current' }, { title: 'Spring Boot', note: '', state: 'ahead' }], revision: 2 };
    let comments: Record<string, unknown>[] = role === 'STUDENT' ? [{ id: 'c1', targetKind: 'homework', targetId: 'h1', file: 'Orders.java', line: 4, grade: 'dubious', body: 'Тип поля лучше объявить через интерфейс и сделать private.', variant: '    private final Map<String, List<String>> byClient = new HashMap<>();', createdAt: '2026-10-10T09:00:00Z' }] : [];
    if (role === 'STUDENT') { lesson = { ...lesson, conductedAt: '2026-10-08T17:30:00Z' }; submission = { ...submission, status: 'reviewed', feedback: 'Хорошее решение, поправь тип поля.', grade: 'good', reviewedAt: '2026-10-10T09:05:00Z', revision: 2 }; }
    const moves = () => [
        ...(submission.reviewedAt ? [{ kind: 'review', side: 'teacher', at: submission.reviewedAt, lessonId: 'l1', lessonTitle: lessonBase.title, refId: 'h1', subject: 'Orders.java', detail: submission.feedback, status: submission.status, grade: submission.grade, ordinal: 1 }] : []),
        { kind: 'homework', side: 'student', at: submission.createdAt, lessonId: 'l1', lessonTitle: lessonBase.title, refId: 'h1', subject: 'Orders.java', detail: submission.comment, status: submission.status, ordinal: 1 },
        { kind: 'attempt', side: 'student', at: '2026-10-09T17:00:00Z', lessonId: 'l1', lessonTitle: lessonBase.title, refId: 'a1', subject: 'Группировка заказов', detail: 'submit', status: 'accepted', passed: 5, total: 5 },
        ...(lesson.conductedAt ? [{ kind: 'conducted', side: 'teacher', at: lesson.conductedAt, lessonId: 'l1', lessonTitle: lessonBase.title, refId: 'l1' }] : []),
    ];
    page_.on('pageerror', error => errors.push(error.message));
    await page_.route('**/api/v1/**', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
        const own = (value: Record<string, unknown>) => role === 'STUDENT' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'notes' && key !== 'teacherNotes')) : value;
        const card = '/api/v1/workspaces/w1/students/s1';
        if (method !== 'GET') {
            const body = request.postDataJSON?.() ?? null; writes.push({ method, path, body });
            if (path === card + '/lessons/l1' && method === 'PATCH') { lesson = { ...lesson, revision: (lesson.revision as number) + 1, ...(body.conducted ? { conductedAt: '2026-10-08T17:30:00Z' } : { conductedAt: undefined }) }; await route.fulfill({ json: own(lesson) }); return; }
            if (path === card + '/roadmap' && method === 'PUT') { roadmap = { stages: body.stages, revision: roadmap.revision + 1 }; await route.fulfill({ json: roadmap }); return; }
            if (path === card + '/lessons/l1/code-comments' && method === 'POST') { const comment = { id: 'c' + (comments.length + 1), createdAt: '2026-10-10T09:00:00Z', variant: '', ...body }; comments = [...comments, comment]; await route.fulfill({ status: 201, json: comment }); return; }
            if (path === card + '/lessons/l1/homework/h1/review' && method === 'PATCH') { submission = { ...submission, status: body.status, feedback: body.feedback, grade: body.grade ?? undefined, reviewedAt: '2026-10-10T09:05:00Z', revision: (submission.revision as number) + 1 }; await route.fulfill({ json: submission }); return; }
            await route.fulfill({ status: 405, json: { status: 405, code: 'SYNTHETIC', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } }); return;
        }
        const routes: Record<string, unknown> = {
            '/api/v1/auth/session': { account: { userId: role === 'TEACHER' ? 't1' : 'u1', workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic', login: role === 'TEACHER' ? 'mentor-demo' : 'anna-demo' },
            '/api/v1/workspaces/w1/students': page([own(student)]),
            [card]: own(student),
            [card + '/dashboard']: { student: own(student), lessonCount: 1, focus: { lesson: own(lesson), upcoming: false } },
            [card + '/lessons']: page([own(lesson)]),
            [card + '/lessons/l1']: own(lesson),
            [card + '/access']: { account: { userId: 'u1', login: 'anna-demo', disabled: false }, invitation: null },
            [card + '/lessons/l1/homework']: page([submission]),
            [card + '/lessons/l1/homework/h1/text']: { filename: 'Orders.java', text: code },
            [card + '/lessons/l1/code-comments']: { items: comments },
            [card + '/lessons/l1/materials']: page([]),
            [card + '/materials']: page([]),
            [card + '/roadmap']: roadmap,
            [card + '/moves']: { items: moves(), page: 0, size: Number(url.searchParams.get('size') ?? 10), total: moves().length },
            [card + '/homework/turns']: page([{ lessonId: 'l1', submissionId: 'h1', filename: 'Orders.java', status: submission.status, createdAt: submission.createdAt }]),
            '/api/v1/workspaces/w1/homework/turns': page([]),
        };
        if (path in routes) { await route.fulfill({ json: routes[path] }); return; }
        await route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } });
    });
    return { errors, writes };
}
// Also returns to the top so the hidden skip link (position: fixed) stays out of full-page screenshots.
const fits = async (page_: Page, width: number) => { expect(await page_.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); await page_.evaluate(() => window.scrollTo(0, 0)); };

for (const width of [1280, 390]) {
    test(`teacher marks the lesson held, comments a code line, grades the work and plans the roadmap at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await fixtures(page, 'TEACHER');
        await page.goto('/teacher/students/s1');
        if (width === 1280) await expect(page.locator('.profile-name').first()).toContainText('mentor-demo');
        await expect(page.locator('.moves-block')).toContainText('Анна Соколова · сдана работа');
        await expect(page.locator('.moves-block')).toContainText('проверка в тренажёре · тесты 5 из 5');
        await expect(page.locator('.lesson-table')).toContainText('3');
        await fits(page, width);
        await page.screenshot({ path: test.info().outputPath(`card-${width}.png`), fullPage: true });

        await page.goto('/teacher/students/s1/lessons/l1');
        await page.getByRole('button', { name: 'Отметить проведённым' }).click();
        await expect(page.getByRole('button', { name: 'Снять отметку «Проведено»' })).toBeVisible();
        await expect(page.locator('body')).toContainText('Проведено');
        expect(state.writes.find(write => write.method === 'PATCH' && write.path.endsWith('/lessons/l1'))?.body).toEqual({ revision: 1, conducted: true });

        await page.goto('/teacher/students/s1/lessons/l1/teacher/review');
        await page.getByRole('button', { name: 'Открыть код и прокомментировать' }).click();
        await expect(page.locator('.code-lines > li')).toHaveCount(5);
        await page.getByRole('button', { name: 'Комментарий к строке 4 файла Orders.java' }).click();
        const form = page.locator('.note-form');
        await form.getByText('сомнительно').click();
        await form.getByLabel('Комментарий', { exact: true }).fill('Тип поля лучше объявить через интерфейс.');
        await form.getByLabel(/Вариант кода/).fill('    private final Map<String, List<String>> byClient = new HashMap<>();');
        await form.getByRole('button', { name: 'Оставить комментарий' }).click();
        await expect(page.locator('.code-lines > li').nth(3).locator('.line-note')).toContainText('Тип поля лучше объявить через интерфейс.');
        await expect(page.locator('.code-lines > li').nth(3).locator('.ev.bad')).toContainText('сомнительно');
        await expect(page.locator('.code-lines > li').nth(3).locator('.line-note')).toBeFocused();
        expect(state.writes.find(write => write.method === 'POST')?.body).toMatchObject({ targetKind: 'homework', targetId: 'h1', file: 'Orders.java', line: 4, grade: 'dubious' });
        await fits(page, width);
        await page.screenshot({ path: test.info().outputPath(`code-review-${width}.png`), fullPage: true });

        const review = page.locator('.homework-review-form');
        await review.getByLabel('Обратная связь к этой работе').fill('Хорошее решение, поправь тип поля.');
        await review.getByText('отлично').click();
        await review.getByRole('button', { name: 'Сохранить ревью' }).click();
        await expect(page.locator('.submission-feedback .ev')).toContainText('отлично');
        expect(state.writes.find(write => write.path.endsWith('/review'))?.body).toEqual({ revision: 1, status: 'reviewed', feedback: 'Хорошее решение, поправь тип поля.', grade: 'excellent' });

        await page.goto('/teacher/students/s1/roadmap');
        await expect(page.locator('.roadmap .count')).toContainText('этап 2 из 3');
        await page.getByRole('button', { name: 'Изменить этапы' }).click();
        await page.getByRole('button', { name: 'Добавить этап' }).click();
        await page.getByLabel('Этап 4', { exact: true }).fill('Первое собеседование');
        await page.getByRole('button', { name: 'Сохранить маршрут' }).click();
        await expect(page.locator('.stages li')).toHaveCount(4);
        await expect(page.getByRole('button', { name: 'Изменить этапы' })).toBeFocused();
        expect(state.writes.find(write => write.method === 'PUT')?.body).toMatchObject({ revision: 2, stages: [{ title: 'Синтаксис Java' }, { title: 'Коллекции', state: 'current' }, { title: 'Spring Boot' }, { title: 'Первое собеседование', state: 'ahead' }] });
        await fits(page, width);
        await page.screenshot({ path: test.info().outputPath(`roadmap-${width}.png`), fullPage: true });
        expect(state.errors).toEqual([]);
    });

    test(`learner reads the grade, the line comments, the roadmap stage and the moves at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await fixtures(page, 'STUDENT');
        await page.goto('/learn');
        await expect(page.locator('.sheet')).toContainText('Этап маршрута');
        await expect(page.locator('.sheet')).toContainText('2 из 3');
        await expect(page.locator('.moves-block')).toContainText('Наставник · работа принята');
        await expect(page.locator('.moves-block')).toContainText('Ты · сдана работа');
        await expect(page.locator('.moves-block .ev')).toContainText('хорошо');
        await expect(page.locator('.callout')).toContainText('Занятие проведено');
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await fits(page, width);
        await page.screenshot({ path: test.info().outputPath(`learner-home-${width}.png`), fullPage: true });

        await page.goto('/learn/students/s1/lessons/l1/student/homework');
        await expect(page.locator('.submission-feedback .ev')).toContainText('хорошо');
        await page.getByRole('button', { name: 'Открыть код', exact: true }).click();
        await expect(page.locator('.line-note')).toContainText('через интерфейс');
        await expect(page.locator('.line-note pre')).toContainText('private final Map');
        await expect(page.locator('.add-note')).toHaveCount(0);
        await fits(page, width);
        await page.screenshot({ path: test.info().outputPath(`learner-code-${width}.png`), fullPage: true });

        await page.goto('/learn/students/s1/roadmap');
        await expect(page.locator('.stages [aria-current="step"]')).toContainText('Коллекции');
        await expect(page.getByRole('button', { name: 'Изменить этапы' })).toHaveCount(0);
        await fits(page, width);
        expect(state.writes).toEqual([]);
        expect(state.errors).toEqual([]);
    });
}
