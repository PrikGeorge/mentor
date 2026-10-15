import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { components } from '../src/app/api/schema';
// Q-02: stage 3 of the redesign against the real backend — materials from the product, conducted mark, line comments,
// grades, roadmap stages, the moves journal and whose turn it is, including a homework-placement trainer exercise.
test.describe.configure({ mode: 'serial' });
type Session = components['schemas']['Session'];
type Actor = components['schemas']['Actor'];
type Student = components['schemas']['TeacherStudentView'];
type Lesson = components['schemas']['TeacherLessonView'];
type Issue = components['schemas']['InvitationIssue'];
type Turns = components['schemas']['LessonTurnPage'];
type User = { login: string; client: APIRequestContext; actor: Actor };
const ready = JSON.parse(readFileSync(process.env['MENTOR_BROWSER_FIXTURE']!, 'utf8'));
const credentials = JSON.parse(readFileSync(ready.credentialsPath, 'utf8'));
const runtime = path.dirname(process.env['MENTOR_BROWSER_FIXTURE']!);
const clients: APIRequestContext[] = [];
let teacher: User, learner: User, student: Student, lesson: Lesson, practiceLesson: Lesson;
let catalog: { status: string; published: number; errors: string[] };
const card = () => `/workspaces/${teacher.actor.workspaceId}/students/${student.id}`;
const lessonPath = (l: Lesson) => card() + `/lessons/${l.id}`;
const teacherRoute = (l: Lesson, tail = '') => `/teacher/students/${student.id}/lessons/${l.id}${tail}`;
const learnerRoute = (l: Lesson, section: string) => `/learn/students/${student.id}/lessons/${l.id}/student/${section}`;
const HOMEWORK = 'class Main {\n    static int sum(int a, int b) { return a + b; }\n    public static void main(String[] args) { System.out.println(sum(2, 3)); }\n}\n';
const SOLUTION = 'import java.util.ArrayList;\nimport java.util.List;\n\npublic class ListTask {\n    static List<Integer> select(List<Integer> source, int minimum) {\n        List<Integer> result = new ArrayList<>();\n        for (Integer number : source) if (number >= minimum) result.add(number);\n        result.sort(Integer::compareTo);\n        return result;\n    }\n}\n';
async function get<T>(client: APIRequestContext, route: string): Promise<T> { const response = await client.get('/api/v1' + route); expect(response.status(), `GET ${route}`).toBe(200); return response.json(); }
async function write<T>(client: APIRequestContext, method: string, route: string, body: unknown, status: number): Promise<T> {
    const session = await get<Session>(client, '/auth/session');
    const headers: Record<string, string> = { Origin: ready.browserOrigin, 'X-Mentor-Client': 'web', 'X-CSRF-TOKEN': session.csrfToken };
    if (session.account && !['/auth/login', '/auth/register'].includes(route)) headers['X-Mentor-Account'] = session.account.userId;
    const response = await client.fetch('/api/v1' + route, { method, headers, ...(body === undefined ? {} : { data: body }) });
    expect(response.status(), `${method} ${route}`).toBe(status);
    return status === 204 ? undefined as T : response.json();
}
test.beforeAll(async ({ playwright }) => {
    async function client() { const context = await playwright.request.newContext({ baseURL: ready.browserOrigin }); clients.push(context); return context; }
    const admin = await client(); await write(admin, 'POST', '/auth/login', credentials, 200);
    async function register(issue: Issue, login: string): Promise<User> {
        const context = await client(); const token = new URL(issue.link, ready.browserOrigin).searchParams.get('token');
        const session = await write<Session>(context, 'POST', '/auth/register', { token, login, password: credentials.password }, 200);
        return { login, client: context, actor: session.account! };
    }
    teacher = await register(await write<Issue>(admin, 'POST', '/admin/teacher-invitations', {}, 200), 'stage3-teacher');
    student = await write<Student>(teacher.client, 'POST', `/workspaces/${teacher.actor.workspaceId}/students`, { name: 'Синтетическая Вера', direction: 'Java', goal: 'Junior Java', notes: 'PRIVATE_STAGE3_NOTE' }, 201);
    learner = await register(await write<Issue>(teacher.client, 'POST', card() + '/invitations', {}, 200), 'stage3-student');
    practiceLesson = await write<Lesson>(teacher.client, 'POST', card() + '/lessons', { title: 'Тренажёр как домашняя работа', date: '2030-02-01', time: '12:00', duration: 60 }, 201);
    // The trusted training catalog is published into this synthetic workspace by the test-only fixture; no executor runs here.
    const temp = path.join(runtime, 'practice-seed-request.tmp'); writeFileSync(temp, JSON.stringify({ workspaceId: teacher.actor.workspaceId })); renameSync(temp, path.join(runtime, 'practice-seed-request.json'));
    const complete = path.join(runtime, 'practice-seed-complete.json');
    await expect.poll(() => existsSync(complete), { timeout: 30000 }).toBe(true);
    catalog = JSON.parse(readFileSync(complete, 'utf8'));
});
test.afterAll(async () => { for (const client of clients) await client.dispose(); });
async function login(page: Page, user: User) { await page.goto('/login'); await page.locator('[name=login]').fill(user.login); await page.locator('[name=password]').fill(credentials.password); await page.getByRole('button', { name: 'Войти', exact: true }).click(); await expect(page).toHaveURL(user.actor.role === 'STUDENT' ? '/learn' : '/teacher/students'); }
// The student preview replaces the profile menu with a read-only badge, so leave it before signing out.
async function logout(page: Page) { if (new URL(page.url()).searchParams.get('preview')) { await page.goto('/'); await page.locator('button.menu-button:visible, button.profile-button:visible').first().waitFor(); } const menu = page.locator('button.menu-button'); if (await menu.isVisible()) { if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click(); } else await page.locator('.profile-button').click(); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await expect(page).toHaveURL('/login'); }
async function capture(page: Page, name: string) { await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur?.(); window.scrollTo(0, 0); }); await page.screenshot({ path: path.join(runtime, name), fullPage: true }); }
async function addMaterial(page: Page, l: Lesson, audience: 'student' | 'teacher', contentKey: string, markdown: string) {
    const form = page.locator('mentor-material-form');
    await form.locator('select[name=kind]').selectOption('doc'); await form.locator('select[name=audience]').selectOption(audience); await form.locator('select[name=contentKey]').selectOption(contentKey);
    await form.locator('textarea[name=markdown]').fill(markdown);
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(lessonPath(l) + '/materials'));
    await form.getByRole('button', { name: 'Добавить материал', exact: true }).click();
    const response = await created; expect(response.status()).toBe(201); return response.json() as Promise<components['schemas']['MaterialSummary']>;
}
async function openReviewForm(review: import('@playwright/test').Locator) { const details = review.locator('details.submission-review'); await expect(details).toBeVisible(); if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await review.locator('summary').click(); await expect(review.locator('textarea')).toBeVisible(); }
test('real stage 3 flow: material publishes the lesson, homework, conducted mark, line comment, grade, roadmap, journal and turns', async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await login(page, teacher);
    // 1. The teacher creates a lesson in the product and adds Markdown materials; the first one makes the lesson prepared.
    await page.goto(`/teacher/students/${student.id}`);
    await page.getByRole('button', { name: 'Добавить занятие', exact: true }).click();
    await page.locator('[name=title]').fill('Коллекции и ревью');
    const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(card() + '/lessons'));
    await page.getByRole('button', { name: 'Создать занятие', exact: true }).click(); expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/teacher/students/${student.id}/lessons/[^/]+$`));
    lesson = await get<Lesson>(teacher.client, card() + '/lessons/' + new URL(page.url()).pathname.split('/').at(-1)!);
    expect(lesson.status).toBe('planned');
    await expect(page.getByText('Запланировано: материалы скрыты от ученика', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Разделы занятия' }).getByRole('link', { name: 'Материалы', exact: true }).click();
    await expect(page).toHaveURL(teacherRoute(lesson, '/teacher/materials'));
    await expect(page.getByText('Материалов пока нет. Добавьте первый документ или файл выше.', { exact: true })).toBeVisible();
    const doc = await addMaterial(page, lesson, 'student', 'student-materials', '# Материалы занятия\n\n## Списки\n\nArrayList хранит элементы по порядку.\n\n## Отображения\n\nHashMap связывает ключ и значение.');
    expect(doc.contentKey).toBe('student-materials');
    await expect(page.locator('.material-group', { hasText: 'Видно ученику' }).locator('.material-row strong', { hasText: 'Материалы занятия' })).toBeVisible();
    await addMaterial(page, lesson, 'teacher', 'guide', '# Методичка\n\nPRIVATE_STAGE3_GUIDE: вопросы для разбора.');
    await expect(page.locator('.material-group.private', { hasText: 'Только вам' }).locator('.material-row strong', { hasText: 'Методичка' })).toBeVisible();
    // A second document with the same role is refused by the server and explained in the form.
    const form = page.locator('mentor-material-form');
    await form.locator('select[name=audience]').selectOption('teacher'); await form.locator('select[name=contentKey]').selectOption('guide'); await form.locator('textarea[name=markdown]').fill('# Повтор');
    const repeat = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(lessonPath(lesson) + '/materials'));
    await form.getByRole('button', { name: 'Добавить материал', exact: true }).click(); expect((await repeat).status()).toBe(409);
    await expect(form.getByRole('alert')).toContainText('Документ с этой ролью уже есть');
    lesson = await get<Lesson>(teacher.client, lessonPath(lesson)); expect(lesson.status).toBe('prepared'); expect(lesson.bundleId).toBeTruthy();
    await page.goto(teacherRoute(lesson));
    await expect(page.getByText('Подготовлено: ученик видит материалы с пометкой «Видно ученику»', { exact: true })).toBeVisible();
    await page.goto(`/teacher/students/${student.id}`);
    const row = page.locator('tr.lesson-list-item', { hasText: 'Коллекции и ревью' });
    await expect(row.locator('.tag')).toHaveText(/Подготовлено/);
    await capture(page, 'real-stage3-prepared.png');
    await logout(page);
    // 2. The student reads the published material, never the teacher's, and hands in a single Java file.
    await login(page, learner);
    await page.goto(learnerRoute(lesson, 'materials'));
    const published = page.locator('.material-row', { hasText: 'Материалы занятия' }); await expect(published).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('Методичка'); await expect(page.locator('body')).not.toContainText('PRIVATE_');
    await published.click();
    await expect(page.locator('.doc-section h3', { hasText: 'Отображения' })).toBeVisible();
    await expect(page.locator('body')).toContainText('HashMap связывает ключ и значение.');
    await page.goto(learnerRoute(lesson, 'homework'));
    await page.locator('[name=homeworkFile]').setInputFiles({ name: 'Main.java', mimeType: 'text/plain', buffer: Buffer.from(HOMEWORK) });
    await page.locator('[name=comment]').fill('Первая версия');
    const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(lessonPath(lesson) + '/homework'));
    await page.getByRole('button', { name: 'Отправить на ревью', exact: true }).click(); expect((await uploaded).status()).toBe(201);
    await expect(page.getByText('Работа отправлена на ревью.', { exact: true })).toBeVisible();
    await expect(page.locator('.homework-history .clock .face.on')).toContainText('Наставник');
    await page.goto(`/learn/students/${student.id}/lessons`);
    await expect(page.getByRole('columnheader', { name: 'Чей ход' })).toBeVisible();
    const learnerRow = page.locator('tr.lesson-list-item', { hasText: 'Коллекции и ревью' });
    await expect(learnerRow.locator('.turn-cell')).toContainText('Ход у наставника');
    await expect(learnerRow.locator('.turn-cell')).toContainText('Работа отправлена');
    await logout(page);
    // 3. The teacher marks the lesson conducted, comments a line of the work, grades it and lays out the route.
    await login(page, teacher);
    await page.goto(teacherRoute(lesson));
    const conducted = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(lessonPath(lesson)));
    await page.getByRole('button', { name: 'Отметить проведённым', exact: true }).click(); expect((await conducted).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Снять отметку «Проведено»', exact: true })).toBeVisible();
    lesson = await get<Lesson>(teacher.client, lessonPath(lesson)); expect(lesson.conductedAt).toBeTruthy();
    await page.goto(teacherRoute(lesson, '/teacher/review'));
    const submission = page.locator('.homework-submission').first();
    await expect(submission.locator('h3')).toHaveText('Main.java');
    await expect(page.locator('.homework-history .clock .face.on')).toContainText('ход за вами');
    await submission.getByRole('button', { name: 'Открыть код и прокомментировать', exact: true }).click();
    await expect(submission.locator('.code-lines li')).toHaveCount(4);
    await submission.getByRole('button', { name: 'Комментарий к строке 2 файла Main.java', exact: true }).click();
    const note = submission.locator('.note-form');
    await note.locator('label.check-row', { hasText: 'сомнительно' }).click();
    await note.locator('textarea').first().fill('Назовите параметры по смыслу, а не a и b.');
    await note.locator('textarea.mono').fill('static int sum(int left, int right) { return left + right; }');
    const commented = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(lessonPath(lesson) + '/code-comments'));
    await note.getByRole('button', { name: 'Оставить комментарий', exact: true }).click(); expect((await commented).status()).toBe(201);
    const saved = submission.locator('.line-note[data-note]');
    await expect(saved).toHaveCount(1); await expect(saved).toContainText('Назовите параметры по смыслу'); await expect(saved).toContainText('сомнительно'); await expect(saved.locator('.code-view')).toContainText('int left, int right');
    await expect(submission.locator('.code-file .count')).toContainText('комментариев: 1');
    const review = submission.locator('mentor-lesson-review'); await openReviewForm(review);
    await review.locator('textarea').fill('Работа принята, посмотри комментарий к строке 2.');
    await review.locator('label.check-row', { hasText: 'хорошо' }).click();
    await review.locator('select').selectOption('reviewed');
    const reviewed = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/review'));
    await review.getByRole('button', { name: 'Сохранить ревью', exact: true }).click(); expect((await reviewed).status()).toBe(200);
    await expect(submission.locator('.pill')).toContainText('Проверено');
    await expect(submission.locator('.submission-feedback .grade-line')).toContainText('хорошо');
    await capture(page, 'real-stage3-review.png');
    await page.goto(`/teacher/students/${student.id}/roadmap`);
    await page.getByRole('button', { name: 'Наметить этапы', exact: true }).click();
    const editor = page.locator('.stage-editor');
    for (let i = 0; i < 2; i++) await editor.getByRole('button', { name: 'Добавить этап', exact: true }).click();
    const stages = editor.locator('ol > li'); await expect(stages).toHaveCount(2);
    await stages.nth(0).getByLabel('Этап 1', { exact: true }).fill('Основы Java'); await stages.nth(0).getByLabel('Статус').selectOption('done');
    await stages.nth(1).getByLabel('Этап 2', { exact: true }).fill('Коллекции'); await stages.nth(1).getByLabel('Пометка').fill('ноябрь 2026'); await stages.nth(1).getByLabel('Статус').selectOption('current');
    const routed = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(card() + '/roadmap'));
    await editor.getByRole('button', { name: 'Сохранить маршрут', exact: true }).click(); expect((await routed).status()).toBe(200);
    await expect(page.locator('.stages li')).toHaveCount(2); await expect(page.locator('.stages li').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.roadmap .count')).toHaveText('этап 2 из 2');
    const roadmap = await get<components['schemas']['Roadmap']>(teacher.client, card() + '/roadmap'); expect(roadmap.stages.map(stage => stage.state)).toEqual(['done', 'current']);
    // The teacher's card shows the journal and the lesson as conducted.
    await page.goto(`/teacher/students/${student.id}`);
    await expect(row.locator('.tag')).toHaveText(/Проведено/);
    const moves = page.locator('.moves-block .moves li');
    await expect(moves).toHaveCount(3);
    const log = page.locator('.moves-block .moves');
    for (const text of ['Вы · занятие проведено', 'Вы · работа принята', 'хорошо', `${student.name} · сдана работа`, 'Первая версия']) await expect(log).toContainText(text);
    await expect(moves.nth(2)).toContainText('сдана работа');
    await expect(page.locator('.card-turn .clock .face.on')).toContainText('ход у ученика');
    await capture(page, 'real-stage3-card.png');
    await logout(page);
    // 4. The student sees the moves, the route stage and that it is their turn; the teacher's private text never leaks.
    await login(page, learner);
    await expect(page.locator('.sheet').getByText('Этап маршрута', { exact: true })).toBeVisible();
    await expect(page.locator('.sheet .wide dd')).toContainText('2 из 2');
    const journal = page.locator('.moves-block .moves li'); await expect(journal).toHaveCount(3);
    for (const text of ['Наставник · занятие проведено', 'Наставник · работа принята', 'хорошо', 'Ты · сдана работа']) await expect(page.locator('.moves-block .moves')).toContainText(text);
    await expect(journal.nth(2)).toContainText('Ты · сдана работа');
    await expect(page.locator('body')).not.toContainText('PRIVATE_');
    await capture(page, 'real-stage3-learner-home.png');
    await page.goto(`/learn/students/${student.id}/lessons`);
    await expect(learnerRow.locator('.tag')).toHaveText(/Проведено/);
    await expect(learnerRow.locator('.turn-cell')).toContainText('Твой ход'); await expect(learnerRow.locator('.turn-cell')).toContainText('Наставник ответил');
    await learnerRow.getByRole('link', { name: 'Открыть отзыв', exact: true }).click();
    await expect(page).toHaveURL(learnerRoute(lesson, 'review'));
    await expect(page.locator('.submission-feedback')).toContainText('Работа принята, посмотри комментарий к строке 2.');
    await expect(page.locator('.submission-feedback .grade-line')).toContainText('хорошо');
    await page.getByRole('button', { name: 'Открыть код', exact: true }).click();
    await expect(page.locator('.line-note[data-note]')).toContainText('Назовите параметры по смыслу');
    await expect(page.getByRole('button', { name: /Комментарий к строке/ })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('PRIVATE_');
    await page.goto(`/learn/students/${student.id}/roadmap`);
    await expect(page.locator('.stages li')).toHaveCount(2); await expect(page.locator('.stages li').nth(1)).toContainText('ноябрь 2026');
    await expect(page.getByRole('button', { name: /этапы/ })).toHaveCount(0);
    const turns = await get<Turns>(learner.client, card() + '/homework/turns');
    expect(turns.items.map(turn => [turn.lessonId, turn.kind, turn.status])).toEqual([[lesson.id, 'homework', 'reviewed']]);
    expect(errors).toEqual([]);
});
test('real homework-placement exercise: a submitted attempt is the student\'s move (kind attempt) until the teacher comments a line', async ({ page, context }) => {
    test.setTimeout(180000);
    expect(catalog.status, JSON.stringify(catalog)).toBe('ready'); expect(catalog.published).toBeGreaterThan(0);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const worker = await get<components['schemas']['WorkerStatus']>(teacher.client, `/workspaces/${teacher.actor.workspaceId}/practice/worker`);
    if (!worker.available) test.info().annotations.push({ type: 'skipped-step', description: 'Исполнитель недоступен в синтетическом контуре: попытка остаётся в очереди, реальное выполнение Java не проверяется (см. e2e:practice).' });
    // The teacher assigns the trusted list exercise as homework.
    await login(page, teacher);
    await page.goto(teacherRoute(practiceLesson, '/teacher/practice'));
    const exercise = page.locator('.assignment-list > div', { hasText: 'Список: фильтрация' });
    await exercise.getByRole('checkbox').check();
    await exercise.locator('.placement select').selectOption('homework');
    const assigned = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(lessonPath(practiceLesson) + '/practice/assignments'));
    await page.getByRole('button', { name: 'Сохранить назначения', exact: true }).click(); expect((await assigned).status()).toBe(200);
    const practice = await get<components['schemas']['LessonPracticeView']>(teacher.client, lessonPath(practiceLesson) + '/practice');
    expect(practice.exercises.map(row => [row.exercise.id, row.placement])).toEqual([['list-task', 'homework']]);
    await logout(page);
    // The student solves it in the fallback editor (Monaco blocked at the network) and submits all checks.
    await login(page, learner);
    const devtools = await context.newCDPSession(page); await devtools.send('Network.enable'); await devtools.send('Network.setBlockedURLs', { urls: ['*/vendor/monaco/vs/loader.js'] });
    await page.goto(learnerRoute(practiceLesson, 'practice'));
    const tab = page.locator('.practice-exercises button', { hasText: 'Список: фильтрация' });
    await expect(tab).toContainText('Домашняя работа'); await tab.click();
    const code = page.getByRole('textbox', { name: 'Код ListTask.java', exact: true }); await expect(code).toBeVisible();
    await code.fill(SOLUTION);
    const drafted = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/draft'));
    await page.getByRole('button', { name: 'Сохранить код', exact: true }).click(); expect((await drafted).status()).toBe(200);
    await expect(page.getByText('Черновик сохранён', { exact: true })).toBeVisible();
    const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/attempts'));
    await page.getByRole('button', { name: 'Отправить на все проверки', exact: true }).click();
    const attempt = await (await accepted).json() as components['schemas']['Attempt']; expect(attempt.mode).toBe('submit');
    await expect(page.locator('.attempt-result h3')).toHaveText(worker.available ? /Все проверки пройдены|В очереди|Выполняется/ : 'В очереди');
    await devtools.send('Network.setBlockedURLs', { urls: [] }); await devtools.detach();
    let turns = await get<Turns>(learner.client, card() + '/homework/turns');
    expect(turns.items[0]).toMatchObject({ lessonId: practiceLesson.id, kind: 'attempt', status: 'submitted', submissionId: attempt.id });
    expect(turns.items[0].filename).toContain('Список');
    await page.goto(`/learn/students/${student.id}/lessons`);
    const row = page.locator('tr.lesson-list-item', { hasText: 'Тренажёр как домашняя работа' });
    await expect(row.locator('.turn-cell')).toContainText('Ход у наставника'); await expect(row.locator('.turn-cell')).toContainText('Решение упражнения отправлено');
    await page.goto('/learn');
    await expect(page.locator('.home-clock .face.on')).toContainText('Наставник');
    await expect(page.locator('.turn')).toContainText('Решение упражнения отправлено');
    await capture(page, 'real-stage3-attempt-turn.png');
    await logout(page);
    // The teacher is sent to the solution, answers with a line comment, and the move returns to the student.
    await login(page, teacher);
    await page.goto(`/teacher/students/${student.id}`);
    await expect(page.locator('.card-turn .clock .face.on')).toContainText('ход за вами');
    await page.locator('.card-turn').getByRole('link', { name: 'Открыть решение', exact: true }).click();
    await expect(page).toHaveURL(teacherRoute(practiceLesson, '/teacher/practice'));
    await page.locator('.practice-exercises button', { hasText: 'Список: фильтрация' }).click();
    await page.locator('.practice-history .history-row').first().click();
    const result = page.locator('.attempt-result'); await expect(result.locator('.code-lines li')).toHaveCount(SOLUTION.split('\n').length - 1);
    await result.getByRole('button', { name: 'Комментарий к строке 7 файла ListTask.java', exact: true }).click();
    await result.locator('.note-form textarea').first().fill('Хорошо, что исходный список не меняется.');
    const commented = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(lessonPath(practiceLesson) + '/code-comments'));
    await result.getByRole('button', { name: 'Оставить комментарий', exact: true }).click(); expect((await commented).status()).toBe(201);
    await expect(result.locator('.line-note[data-note]')).toContainText('исходный список не меняется');
    turns = await get<Turns>(teacher.client, card() + '/homework/turns');
    expect(turns.items[0]).toMatchObject({ lessonId: practiceLesson.id, kind: 'attempt', status: 'reviewed' });
    const moves = await get<components['schemas']['MovePage']>(learner.client, card() + `/moves?lessonId=${practiceLesson.id}`);
    expect(moves.items.map(move => move.kind)).toEqual(['attempt']);
    if (!worker.available) expect(moves.items[0].status).toBe('queued');
    await capture(page, 'real-stage3-attempt-comment.png');
    expect(errors).toEqual([]);
});
test('real stage 3 learner screens fit a 390px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await login(page, learner);
    await expect(page.locator('.moves-block .moves li').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'real-stage3-learner-home-390.png');
    await page.goto(`/learn/students/${student.id}/lessons`);
    // The phone layout stacks each row; the header is hidden, the turn cell keeps its words.
    await expect(page.locator('tr.lesson-list-item')).toHaveCount(2);
    await expect(page.locator('tr.lesson-list-item .turn-cell')).toHaveCount(2);
    await expect(page.locator('tr.lesson-list-item', { hasText: 'Коллекции и ревью' }).locator('.turn-cell')).toContainText('Твой ход');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'real-stage3-lessons-390.png');
    await page.goto(learnerRoute(lesson, 'review'));
    await page.getByRole('button', { name: 'Открыть код', exact: true }).click();
    await expect(page.locator('.line-note[data-note]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await capture(page, 'real-stage3-review-390.png');
    expect(errors).toEqual([]);
});
