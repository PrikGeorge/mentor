import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { components } from '../src/app/api/schema';
async function signOut(page: Page) { const menu = page.getByRole('button', { name: 'Меню', exact: true }); if (await menu.isVisible()) await menu.click(); else await page.locator('.profile-button').click(); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); }
test.describe.configure({ mode: 'serial' });
type Session = components['schemas']['Session'];
type Student = components['schemas']['TeacherStudentView'];
type Lesson = components['schemas']['TeacherLessonView'];
type Issue = components['schemas']['InvitationIssue'];
type User = { login: string; client: APIRequestContext; actor: components['schemas']['Actor'] };
const ready = JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!, 'utf8'));
const credentials = JSON.parse(readFileSync(ready.credentialsPath, 'utf8'));
const runtime = path.dirname(process.env['MENTOR_BROWSER_FIXTURE']!);
const clients: APIRequestContext[] = [];
let teacher: User, emptyTeacher: User, learner: User, emptyLearner: User, anna: Student, boris: Student, first: Lesson;
const prefix = () => `/workspaces/${teacher.actor.workspaceId}/students`;
const card = (id: string) => `${prefix()}/${id}`;
async function get<T>(client: APIRequestContext, route: string): Promise<T> {
    const response = await client.get('/api/v1' + route);
    expect(response.status(), `GET ${route}`).toBe(200);
    return response.json();
}
async function write<T>(client: APIRequestContext, method: string, route: string, body: unknown, status: number): Promise<T> {
    const session = await get<Session>(client, '/auth/session');
    const headers: Record<string, string> = { Origin: ready.browserOrigin, 'X-Mentor-Client': 'web', 'X-CSRF-TOKEN': session.csrfToken };
    if (session.account && !['/auth/login', '/auth/register', '/auth/reset-password'].includes(route)) headers['X-Mentor-Account'] = session.account.userId;
    const response = await client.fetch('/api/v1' + route, { method, headers, ...(body === undefined ? {} : { data: body }) });
    expect(response.status(), `${method} ${route}`).toBe(status);
    return status === 204 ? undefined as T : response.json();
}
test.beforeAll(async ({ playwright }) => {
    async function client() {
        const context = await playwright.request.newContext({ baseURL: ready.browserOrigin }); clients.push(context); return context;
    }
    const admin = await client();
    await write(admin, 'POST', '/auth/login', credentials, 200);
    async function register(issue: Issue, login: string): Promise<User> {
        const context = await client();
        const token = new URL(issue.link, ready.browserOrigin).searchParams.get('token');
        const session = await write<Session>(context, 'POST', '/auth/register', { token, login, password: credentials.password }, 200);
        expect(session.account).not.toBeNull(); return { login, client: context, actor: session.account! };
    }
    teacher = await register(await write<Issue>(admin, 'POST', '/admin/teacher-invitations', {}, 200), 'browser-teacher-a');
    emptyTeacher = await register(await write<Issue>(admin, 'POST', '/admin/teacher-invitations', {}, 200), 'browser-teacher-b');
    anna = await write<Student>(teacher.client, 'POST', prefix(), { name: 'Синтетическая Анна', direction: 'Java Backend', goal: 'Первая работа', notes: 'PRIVATE_ANNOTATION', studentRoadmap: 'Личный маршрут Анны' }, 201);
    boris = await write<Student>(teacher.client, 'POST', prefix(), { name: 'Синтетический Борис', notes: 'PRIVATE_BORIS' }, 201);
    learner = await register(await write<Issue>(teacher.client, 'POST', card(anna.id) + '/invitations', {}, 200), 'browser-student-a');
    emptyLearner = await register(await write<Issue>(teacher.client, 'POST', card(boris.id) + '/invitations', {}, 200), 'browser-student-b');
    const date = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    first = await write<Lesson>(teacher.client, 'POST', card(anna.id) + '/lessons', { title: 'Коллекции Анны', date, time: '12:00', duration: 60 }, 201);
    for (const [kind, markdown] of [['teacherNotes', 'PRIVATE_SCENARIO'], ['studentNotes', 'Задания только Анны']])
        await write(teacher.client, 'PUT', card(anna.id) + `/lessons/${first.id}/texts/${kind}`, { markdown, revision: 1 }, 200);

    // Verify actual server projections and ownership before browser presentation.
    const publicProfile = await get<Record<string, unknown>>(learner.client, card(anna.id));
    expect(publicProfile).not.toHaveProperty('notes');
    const publicLesson = await get<Record<string, unknown>>(learner.client, card(anna.id) + `/lessons/${first.id}`);
    expect(publicLesson).not.toHaveProperty('teacherNotes');
    const preview = await get<Record<string, unknown>>(teacher.client, card(anna.id) + `/lessons/${first.id}?audience=student`);
    expect(preview).not.toHaveProperty('teacherNotes');
    expect((await get<Session>(teacher.client, '/auth/session')).account?.role).toBe('TEACHER');
    expect((await learner.client.get('/api/v1' + card(boris.id))).status()).toBe(404);
    expect((await emptyTeacher.client.get('/api/v1' + card(anna.id))).status()).toBe(404);
    await write(teacher.client, 'PATCH', card(boris.id) + '/access', { disabled: true }, 204);
    expect((await emptyLearner.client.get('/api/v1' + card(boris.id))).status()).toBe(401);
    await write(teacher.client, 'PATCH', card(boris.id) + '/access', { disabled: false }, 204);
});
test.afterAll(async () => { for (const client of clients) await client.dispose(); });
async function login(page: Page, user: User) {
    await page.goto('/login');
    await page.locator('[name="login"]').fill(user.login);
    await page.locator('[name="password"]').fill(credentials.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(user.actor.role === 'STUDENT' ? '/learn' : '/teacher/students');
}
async function logout(page: Page) {
    await signOut(page); await expect(page).toHaveURL('/login');
}
for (const width of [1280, 390]) {
    test(`real isolated workspace, short create and public learner preview at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await login(page, teacher);
        await expect(page.getByRole('heading', { name: anna.name, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: boris.name, exact: true })).toBeVisible();
        await page.goto(`/teacher/students/${anna.id}`);
        await expect(page.getByRole('heading', { name: 'Доступ к кабинету', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Добавить занятие', exact: true }).click();
        await expect(page.locator('form')).toHaveCount(1);
        expect(await page.locator('form input').count()).toBe(4);
        const title = `Новое занятие ${width}`;
        await page.locator('[name="title"]').fill(title);
        const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(card(anna.id) + '/lessons'));
        await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
        const created = await createdResponse; expect(created.status()).toBe(201);
        const submitted = created.request().postDataJSON();
        expect(Object.keys(submitted).sort()).toEqual(['date', 'duration', 'time', 'title']);
        await expect(page).toHaveURL(new RegExp(`/teacher/students/${anna.id}/lessons/[^/]+$`));
        const lessonId = new URL(page.url()).pathname.split('/').at(-1)!;
        const lesson = await get<Lesson>(teacher.client, card(anna.id) + `/lessons/${lessonId}`);
        await expect(page).toHaveURL(`/teacher/students/${anna.id}/lessons/${lesson.id}`);
        await expect(page.getByRole('heading', { name: 'Подготовка занятия', exact: true })).toBeVisible();
        await expect(page.locator('h1')).toHaveCount(1);
        await page.screenshot({ path: path.join(runtime, `real-preparation-${width}.png`), fullPage: true });
        // Stale revision preserves the user's form against actual server conflict.
        await page.getByRole('button', { name: 'Изменить занятие', exact: true }).click();
        await page.locator('[name="title"]').fill('Сохранить введённое');
        await write(teacher.client, 'PATCH', card(anna.id) + `/lessons/${lesson.id}`, { title: 'Конкурирующее изменение', revision: lesson.revision }, 200);
        const conflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/lessons/${lesson.id}`));
        await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
        expect((await conflict).status()).toBe(409);
        await expect(page.locator('[name="title"]')).toHaveValue('Сохранить введённое');
        await expect(page.getByRole('alert')).toBeVisible();
        await page.goto(`/teacher/students/${anna.id}/lessons/${first.id}`);
        await page.getByRole('link', { name: 'Экран ученика ↗', exact: true }).click();
        await expect(page.getByText('Предпросмотр кабинета ученика · только чтение')).toBeVisible();
        await expect(page.getByText('Задания только Анны', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Изменить|Сохранить|Сдать/ })).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await expect(page.locator('footer')).toContainText('Кабинет ученика');
        const session = await page.request.get('/api/v1/auth/session');
        expect((await session.json()).account.role).toBe('TEACHER');
        await page.screenshot({ path: path.join(runtime, `real-preview-${width}.png`), fullPage: true });
        await logout(page);

        await login(page, learner);
        await expect(page.getByRole('heading', { name: anna.name, exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText(boris.name);
        await page.goto(`/learn/students/${anna.id}/lessons/${first.id}/student/tasks`);
        await expect(page.getByText('Задания только Анны', { exact: true })).toBeVisible();
        await expect(page.locator('h1')).toHaveCount(1);
        if (width === 390) await page.getByRole('button', { name: 'Меню', exact: true }).click();
        await expect(page.locator('.profile-name:visible, .mobile-me:visible b')).toContainText(anna.name);
        await expect(page.locator('.selected-student')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Разделы занятия' })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await expect(page.locator('footer')).not.toContainText('Кабинет наставника');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: path.join(runtime, `real-learner-${width}.png`), fullPage: true });
        if (width === 390) await page.getByRole('button', { name: 'Закрыть меню', exact: true }).click();
        await logout(page);

        await login(page, emptyLearner);
        await expect(page.getByRole('heading', { name: boris.name, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Занятий пока нет', exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Задания только Анны');
        await expect(page.locator('body')).not.toContainText('Миха');
        await logout(page);
        await login(page, emptyTeacher);
        await expect(page.getByRole('heading', { name: 'Учеников пока нет', exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText('Миха');
        await expect(page.locator('body')).not.toContainText(anna.name);
        expect(errors).toEqual([]);
    });
}
