import { test, expect, type Page } from './fixtures';
import { openAccountMenu } from '../testing/browser-session';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { components } from '../src/app/api/schema';
const root = '/api/v1/workspaces/w1/students/s1/lessons/l1',
    practice = root + '/practice',
    url = '/learn/students/s1/lessons/l1/student/practice';
const student: components['schemas']['PublicStudentView'] = {
    id: 's1',
    workspaceId: 'w1',
    userId: 'student',
    name: 'Синтетическая Анна',
    direction: 'Java Backend',
    goal: '',
    schedule: '',
    studentRoadmap: '',
    studentReview: '',
    revision: 1,
    createdAt: '2030-01-01T00:00:00Z',
};
const lesson: components['schemas']['PublicLessonView'] = {
    id: 'l1',
    workspaceId: 'w1',
    studentId: 's1',
    number: 1,
    title: 'Практика коллекций',
    date: '2030-01-01',
    time: '12:00',
    duration: 60,
    timeZone: 'Europe/Moscow',
    status: 'planned',
    bundleId: null,
    revision: 1,
    createdAt: '2030-01-01T00:00:00Z',
    studentNotes: 'Материалы занятия',
    reviewNotes: '',
};
const exercise: components['schemas']['PublicExercise'] = {
    id: 'e1',
    revision: 1,
    title: 'Коллекции · синтетическая задача',
    statement: 'Сравните результат.\n\n```java\n// public reference\n```',
    environment: { id: 'java', title: 'Java без зависимостей', javaVersion: 21, dependencies: [] },
    starterFiles: { 'Task.java': 'class Task {}\n' },
};
async function fixture(page: Page, role: 'STUDENT' | 'TEACHER' = 'STUDENT', fallback = false) {
    let draft: components['schemas']['Draft'] = { exerciseId: 'e1', exerciseRevision: 1, revision: 0, files: exercise.starterFiles, updatedAt: null },
        catalog = { ...exercise },
        lost = true,
        posts = 0,
        polls = 0,
        logout = 0,
        sessionUnavailable = false;
    const intents = new Map<string, components['schemas']['Attempt']>();
    if (fallback) await page.route('**/vendor/monaco/vs/loader.js', (route) => route.abort());
    await page.route('**/api/v1/**', async (route) => {
        const request = route.request(),
            uri = new URL(request.url()),
            p = uri.pathname,
            publicView = role === 'STUDENT' || uri.searchParams.get('audience') === 'student';
        if (p === '/api/v1/auth/session') {
            if (sessionUnavailable) {
                await route.fulfill({ status: 503, json: { status: 503, message: 'Synthetic session unavailable' } });
                return;
            }
            await route.fulfill({
                json: { account: { userId: role === 'STUDENT' ? 'student' : 'teacher', workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' },
            });
            return;
        }
        if (p === '/api/v1/auth/logout') {
            logout++;
            await route.fulfill({ status: 204 });
            return;
        }
        if (p === '/api/v1/workspaces/w1/students/s1') {
            await route.fulfill({ json: publicView ? student : { ...student, notes: 'PRIVATE_NOTES' } });
            return;
        }
        if (p === root) {
            await route.fulfill({ json: publicView ? lesson : { ...lesson, teacherNotes: 'PRIVATE_SCENARIO' } });
            return;
        }
        if (p === root + '/materials') {
            await route.fulfill({ json: { items: [], page: 0, size: 25, total: 0 } });
            return;
        }
        if (p === '/api/v1/workspaces/w1/exercises') {
            await route.fulfill({ json: { items: [catalog], page: 0, size: 100, total: 1 } });
            return;
        }
        if (request.method() !== 'GET') {
            expect(request.headers()['x-mentor-account']).toBe(role === 'STUDENT' ? 'student' : 'teacher');
            expect(request.headers()['x-csrf-token']).toBe('synthetic');
            expect(request.headers()['x-mentor-client']).toBe('web');
        }
        if (p === practice) {
            await route.fulfill({
                json: {
                    revision: 0,
                    exercises: [
                        {
                            assignmentId: 'as1',
                            placement: 'class',
                            exercise: catalog,
                            draft: { ...draft, outdated: catalog.revision !== draft.exerciseRevision },
                        },
                    ],
                },
            });
            return;
        }
        if (p === practice + '/history') {
            await route.fulfill({ json: { items: [], page: 0, size: 100, total: 0 } });
            return;
        }
        if (p === practice + '/draft-archives') {
            await route.fulfill({ json: { items: [], page: 0, size: 25, total: 0 } });
            return;
        }
        if (p === practice + '/exercises/e1/draft') {
            if (request.method() === 'PUT') {
                expect(role).toBe('STUDENT');
                draft = { ...draft, ...request.postDataJSON(), revision: draft.revision + 1, updatedAt: '2030-01-01T00:00:00Z' };
            }
            await route.fulfill({ json: draft });
            return;
        }
        if (p === practice + '/exercises/e1/attempts') {
            if (request.method() === 'GET') {
                await route.fulfill({
                    json: { items: Array.from(intents.values()).map(({ files, ...summary }) => summary), page: 0, size: 25, total: intents.size },
                });
                return;
            }
            posts++;
            expect(role).toBe('STUDENT');
            const key = request.headers()['idempotency-key'];
            const body = request.postDataJSON();
            let attempt = intents.get(key);
            if (!attempt) {
                attempt = {
                    id: 'a' + (intents.size + 1),
                    exerciseId: 'e1',
                    ...body,
                    environmentRevision: 'synthetic',
                    jobState: 'queued',
                    result: null,
                    createdAt: '2030-01-01T00:00:00Z',
                };
                intents.set(key, attempt!);
            } else expect(body).toEqual({ files: attempt.files, exerciseRevision: attempt.exerciseRevision, mode: attempt.mode });
            if (lost) {
                lost = false;
                await route.abort();
                return;
            }
            await route.fulfill({ status: 202, json: attempt });
            return;
        }
        if (p.startsWith(practice + '/exercises/e1/attempts/')) {
            polls++;
            const attempt = Array.from(intents.values()).find((row) => row.id === p.split('/').at(-1));
            await route.fulfill({
                json: {
                    ...attempt,
                    jobState: 'completed',
                    result: {
                        status: 'accepted',
                        passed: 1,
                        total: 1,
                        elapsedMs: 2,
                        tests: [{ name: 'Публичный результат', status: 'accepted', expected: null, actual: null }],
                    },
                },
            });
            return;
        }
        await route.fulfill({ status: 404, json: { message: 'Synthetic missing' } });
    });
    return {
        failSession: () => (sessionUnavailable = true),
        posts: () => posts,
        polls: () => polls,
        logout: () => logout,
        publish: () => (catalog = { ...catalog, revision: 2, starterFiles: { 'Task.java': 'new template' } }),
        draft: () => draft,
    };
}
for (const width of [1280, 390]) {
    test(`practice lost response reload source catalog and explicit exit at${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await fixture(page, 'STUDENT', true);
        await page.goto(url);
        const textarea = page.getByRole('textbox', { name: 'Код Task.java' });
        await expect(textarea).toBeVisible();
        await textarea.fill('  unsaved student source\n');
        await page.getByRole('button', { name: 'Проверить примеры', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Ответ не получен');
        await page.getByRole('button', { name: 'Проверить примеры', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Все проверки пройдены' })).toBeVisible();
        expect(state.posts()).toBe(2);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Все проверки пройдены' })).toBeVisible();
        expect(state.posts()).toBe(2);
        await expect(textarea).toHaveValue('  unsaved student source\n');
        state.publish();
        await page.getByRole('button', { name: 'Обновить задания' }).click();
        await expect(page.getByText('Упражнение обновилось.', { exact: false })).toBeVisible();
        await expect(textarea).toHaveValue('  unsaved student source\n');
        await expect(page.getByRole('button', { name: 'Отправить на все проверки' })).toBeDisabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.evaluate(() => window.scrollTo(0, 0));
        const runtime = path.resolve('.runtime/task14');
        mkdirSync(runtime, { recursive: true });
        await page.screenshot({ path: path.join(runtime, `fixture-practice-${width}.png`) });
        await openAccountMenu(page);
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect(state.logout()).toBe(0);
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await openAccountMenu(page);
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
        const download = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Экспортировать и выйти' }).click();
        expect((await download).suggestedFilename()).toBe('practice-source.json');
        await expect(page).toHaveURL(/login$/);
        expect(state.logout()).toBe(1);
    });
    test(`practice local Monaco and teacher preview read-only at${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await fixture(page, 'TEACHER');
        await page.goto('/teacher/students/s1/lessons/l1/student/practice?preview=student');
        await expect(page.locator('.monaco-editor')).toBeVisible();
        await expect(page.getByRole('button', { name: /^(Проверить примеры|Отправить на все проверки)$/, includeHidden: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Назначения тренажёра' })).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('PRIVATE_');
        await expect(page.locator('.monaco-editor textarea')).toHaveAttribute('aria-label', /Код Task.java/);
        if (width === 390) await page.getByRole('button', { name: 'Меню', exact: true }).click();
        const sections = page.getByRole('navigation', { name: 'Разделы занятия', exact: true });
        await expect(sections.getByRole('link').and(page.locator('[aria-current="page"]'))).toHaveCount(1);
        await expect(sections.getByRole('link', { name: 'Тренажёр', exact: true })).toHaveAttribute('aria-current', 'page');
        expect(state.posts()).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
}

test('offline validation with denied storage keeps the native unload warning without restoring editing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
        Storage.prototype.setItem = function () {
            throw new Error('Synthetic storage unavailable');
        };
    });
    const state = await fixture(page, 'STUDENT', true);
    await page.goto(url);
    const textarea = page.getByRole('textbox', { name: 'Код Task.java' });
    await textarea.fill('only in-memory source');
    state.failSession();
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByRole('alert')).toContainText('Не удалось проверить сессию');
    await expect(page.locator('.practice-page')).toBeHidden();
    expect(state.posts()).toBe(0);
    const warning = page.waitForEvent('dialog');
    const reload = page.reload({ timeout: 1500 }).catch(() => null);
    const dialog = await warning;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await reload;
    await expect(page).toHaveURL(url);
    expect(
        await page.evaluate(() => ({
            source: (document.querySelector('.practice-editor textarea') as HTMLTextAreaElement).value,
            hidden: (document.querySelector('.practice-page') as HTMLElement).hidden,
        }))
    ).toEqual({ source: 'only in-memory source', hidden: true });
});
