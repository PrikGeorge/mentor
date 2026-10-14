import { expect, test, Page } from '@playwright/test';
import type { components } from '../src/app/api/schema';
type Student = components['schemas']['TeacherStudentView'];
type Lesson = components['schemas']['TeacherLessonView'];
const anna: Student = { id: 's1', workspaceId: 'w1', userId: 'u1', revision: 1, createdAt: '2026-10-01T10:00:00Z', name: 'Тестовая Анна', direction: 'Java Backend', goal: 'Первая работа', schedule: 'Четверг', notes: 'PRIVATE_ANNOTATION', studentRoadmap: 'Индивидуальный маршрут Анны', studentReview: 'Отзыв из отдельного архива' };
const boris: Student = { ...anna, id: 's2', userId: 'u2', name: 'Тестовый Борис', goal: '', notes: 'PRIVATE_BORIS', studentRoadmap: '', studentReview: '' };
const planned: Lesson = { id: 'l1', workspaceId: 'w1', studentId: 's1', title: 'Коллекции Анны', date: '2026-10-02', time: '12:00', timeZone: 'Europe/Moscow', duration: 60, status: 'planned', bundleId: null, revision: 1, createdAt: '2026-10-01T10:00:00Z', teacherNotes: 'PRIVATE_SCENARIO', studentNotes: 'Задания только Анны', reviewNotes: 'Отзыв по этому занятию' };
function publicStudent(s: Student) { const { notes, ...view } = s; return view; }
function publicLesson(l: Lesson) { const { teacherNotes, ...view } = l; return view; }
async function fixtures(page: Page, kind: 'teacher' | 'anna' | 'boris' | 'new-teacher') {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const actor: components['schemas']['Actor'] = { userId: kind, workspaceId: kind === 'new-teacher' ? 'w2' : 'w1', role: ['anna', 'boris'].includes(kind) ? 'STUDENT' : 'TEACHER', authVersion: 1 };
    const students = kind === 'new-teacher' ? [] : [{ ...anna }, { ...boris }];
    let lessons = [{ ...planned }];
    let textFailures = 0;
    await page.route('**/api/v1/**', async (route) => {
        const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
        const publicView = actor.role === 'STUDENT' || url.searchParams.get('audience') === 'student';
        if (path === '/api/v1/auth/session') {
            await route.fulfill({ json: { account: actor, csrfToken: 'synthetic' } });
            return;
        }
        if (method !== 'GET') {
            expect(request.headers()['x-mentor-account']).toBe(actor.userId);
            expect(request.headers()['x-csrf-token']).toBe('synthetic');
            expect(request.headers()['x-mentor-client']).toBe('web');
        }
        const prefix = '/api/v1/workspaces/' + actor.workspaceId + '/students';
        if (path === prefix && method === 'GET') {
            const items = actor.role === 'STUDENT' ? students.filter(s => s.id === (kind === 'anna' ? 's1' : 's2')) : students;
            await route.fulfill({ json: { items: items.map(s => publicView ? publicStudent(s) : s), page: 0, size: 25, total: items.length } });
            return;
        }
        if (path === prefix && method === 'POST') {
            const input = request.postDataJSON();
            expect(input).not.toHaveProperty('revision');
            const s = { ...anna, ...input, id: 's-new', workspaceId: actor.workspaceId!, userId: null };
            students.push(s);
            await route.fulfill({ status: 201, json: s });
            return;
        }
        const match = path.slice(prefix.length).match(/^\/([^/]+)(.*)$/);
        const s = students.find(s => s.id === match?.[1]);
        const suffix = match?.[2];
        if (!s) {
            await route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic not found', fieldErrors: {}, requestId: 'synthetic' } });
            return;
        }
        if (suffix === '' && method === 'GET') {
            await route.fulfill({ json: publicView ? publicStudent(s) : s });
            return;
        }
        // The card's journal and roadmap panels: an empty exchange so far.
        if (suffix === '/moves') { await route.fulfill({ json: { items: [], page: 0, size: 10, total: 0 } }); return; }
        if (suffix === '/roadmap' && method === 'GET') { await route.fulfill({ json: { stages: [], revision: 0 } }); return; }
        if (suffix === '/access') {
            expect(actor.role).toBe('TEACHER');
            await route.fulfill({ json: { account: s.userId ? { userId: s.userId, login: s.id, disabled: false } : null, invitation: null } });
            return;
        }
        if (suffix === '/dashboard') {
            const own = lessons.filter(l => l.studentId === s.id);
            await route.fulfill({ json: { student: publicView ? publicStudent(s) : s, lessonCount: own.length, focus: own.length ? { lesson: publicView ? publicLesson(own[0]) : own[0], upcoming: true } : null } });
            return;
        }
        if (suffix === '/lessons' && method === 'GET') {
            const own = lessons.filter(l => l.studentId === s.id);
            await route.fulfill({ json: { items: own.map(l => publicView ? publicLesson(l) : l), page: 0, size: 25, total: own.length } });
            return;
        }
        if (suffix === '/lessons' && method === 'POST') {
            const input = request.postDataJSON();
            expect(Object.keys(input).sort()).toEqual(['date', 'duration', 'time', 'title']);
            if (input.title === 'Ошибка формы') {
                await route.fulfill({ status: 400, json: { status: 400, code: 'INVALID_INPUT', message: 'Синтетическая ошибка сохранения', fieldErrors: { title: 'Ошибка' }, requestId: 'synthetic' } });
                return;
            }
            const created = { ...planned, ...input, id: 'l-new', studentId: s.id, teacherNotes: '', studentNotes: '', reviewNotes: '' };
            lessons.push(created);
            await route.fulfill({ status: 201, json: created });
            return;
        }
        const lessonMatch = suffix?.match(/^\/lessons\/([^/]+)(.*)$/);
        const l = lessons.find(l => l.id === lessonMatch?.[1] && l.studentId === s.id);
        const tail = lessonMatch?.[2];
        if (l && tail === '' && method === 'GET') {
            await route.fulfill({ json: publicView ? publicLesson(l) : l });
            return;
        }
        if (l && tail?.startsWith('/texts/')) {
            const textKind = tail.slice(7) as components['schemas']['TextKind'];
            if (method === 'GET') {
                await route.fulfill({ json: { kind: textKind, markdown: l[textKind], revision: 4 } });
                return;
            }
            expect(request.postDataJSON().revision).toBe(4);
            if (textFailures++ === 0) {
                await route.fulfill({ status: 409, json: { status: 409, code: 'CONFLICT', message: 'Ревизия устарела', fieldErrors: {}, requestId: 'synthetic' } });
                return;
            }
            l[textKind] = request.postDataJSON().markdown;
            await route.fulfill({ json: { kind: textKind, markdown: l[textKind], revision: 5 } });
            return;
        }
        await route.fulfill({ status: 404 });
    });
    return errors;
}
async function learnerIdentity(page: Page) {
    // The learner's name is the profile in the header (desktop) or in the open mobile menu.
    await expect(page.locator('.profile-name:visible, .mobile-me:visible b')).toContainText(anna.name);
    await expect(page.locator('.selected-student')).toHaveCount(0);
    await expect(page.locator('.brand')).toHaveCount(1);
    await expect(page.locator('.site-footer')).toContainText('Кабинет ученика');
    await expect(page.locator('.site-footer')).not.toContainText('Кабинет наставника');
}
for (const width of [1280, 390]) {
    test(`teacher creation, text conflict and public preview at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await fixtures(page, 'teacher');
        await page.goto('/teacher/students');
        await expect(page.getByRole('heading', { name: 'Тестовая Анна', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Тестовый Борис', exact: true })).toBeVisible();
        await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Тестовая Анна', exact: true }) }).click();
        await expect(page.getByRole('heading', { name: 'Доступ к кабинету' })).toBeVisible();
        await page.getByRole('button', { name: 'Добавить занятие', exact: true }).click();
        await expect(page.locator('form')).toHaveCount(1);
        await page.locator('[name="title"]').fill('Ошибка формы');
        await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Синтетическая ошибка');
        await expect(page.locator('[name="title"]')).toHaveValue('Ошибка формы');
        await page.locator('[name="title"]').fill('Новое занятие');
        await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
        await expect(page).toHaveURL('/teacher/students/s1/lessons/l-new');
        await expect(page.getByRole('heading', { name: 'Подготовка занятия', exact: true })).toBeVisible();
        await expect(page.locator('h1')).toHaveCount(1);
        await page.getByRole('button', { name: 'Добавить сценарий', exact: true }).click();
        await page.locator('[name="markdown"]').fill('  только преподавателю  \n');
        await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Ревизия устарела');
        await expect(page.locator('[name="markdown"]')).toHaveValue('  только преподавателю  \n');
        await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
        await expect(page.locator('form')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`preparation-${width}.png`), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.getByRole('link', { name: 'Экран ученика ↗', exact: true }).click();
        await expect(page.getByText('Предпросмотр кабинета ученика · только чтение')).toBeVisible();
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Изменить|Сохранить|Сдать/ })).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('только преподавателю');
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        if (width === 390)
            await page.getByRole('button', { name: 'Меню', exact: true }).click();
        await expect(page.getByRole('navigation', { name: 'Разделы занятия' })).toBeVisible();
        await learnerIdentity(page);
        await expect(page.getByRole('link', { name: 'Домашняя работа', exact: true })).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`preview-${width}.png`), fullPage: true });
        expect(errors).toEqual([]);
    });
    test(`learner name, own selected lesson and menu at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await fixtures(page, 'anna');
        await page.goto('/learn');
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.getByText('Ближайшее занятие', { exact: true })).toBeVisible();
        await page.getByRole('link', { name: 'Открыть задания', exact: true }).click();
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.getByText('Задания только Анны', { exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await expect(page.getByRole('button', { name: /Изменить|Сохранить|Сдать/ })).toHaveCount(0);
        if (width === 390)
            await page.getByRole('button', { name: 'Меню', exact: true }).click();
        await expect(page.getByRole('navigation', { name: 'Разделы занятия' })).toBeVisible();
        await learnerIdentity(page);
        await expect(page.getByRole('link', { name: 'Домашняя работа', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: test.info().outputPath(`learner-${width}.png`), fullPage: true });
        expect(errors).toEqual([]);
    });
    test(`new teacher and second empty pupil receive no seeded materials at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await fixtures(page, 'new-teacher');
        await page.goto('/teacher/students');
        await expect(page.getByRole('heading', { name: 'Учеников пока нет', exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Миха');
        await page.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
        await page.locator('[name="name"]').fill('Новый ученик теста');
        await page.getByRole('button', { name: 'Добавить', exact: true }).click();
        await expect(page).toHaveURL('/teacher/students/s-new');
        await expect(page.getByRole('heading', { name: 'Занятий пока нет', exact: true })).toBeVisible();
        await fixtures(page, 'boris');
        await page.goto('/learn');
        await expect(page.getByRole('heading', { name: 'Тестовый Борис', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Занятий пока нет', exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Миха');
        await expect(page.locator('body')).not.toContainText('Задания только Анны');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
    if (width === 390)
        test('390px menu keeps its first recovery link clickable under a lesson header', async ({ page }) => {
            await fixtures(page, 'teacher');
            await page.goto('/teacher/students/s1/lessons/l1');
            await expect(page.locator('h1')).toHaveCount(1);
            await page.getByRole('button', { name: 'Меню', exact: true }).click();
            await page.getByRole('navigation', { name: 'Главное меню' }).getByRole('link', { name: 'Мои ученики', exact: true }).click({ timeout: 1500 });
            await expect(page).toHaveURL('/teacher/students');
        });
}
