import { expect, test } from '@playwright/test';

test('390px keyboard login keeps private assets out and navigates by role', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  let signedIn = false;
  const actor = { userId: 'synthetic-teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/session') { await route.fulfill({ json: { account: signedIn ? actor : null, csrfToken: signedIn ? 'synthetic-new' : 'synthetic-anonymous' } }); return; }
    if (url.pathname === '/api/v1/auth/login') {
      expect(route.request().postDataJSON()).toEqual({ login: 'synthetic', password: '  synthetic password  ' });
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-anonymous');
      expect(route.request().headers()['x-mentor-client']).toBe('web');
      expect(route.request().headers()['x-mentor-account']).toBeUndefined();
      signedIn = true; await route.fulfill({ json: { account: actor, csrfToken: 'synthetic-new' } }); return;
    }
    if (url.pathname === '/api/v1/auth/logout') {
      expect(route.request().headers()['x-csrf-token']).toBe('synthetic-new');
      expect(route.request().headers()['x-mentor-account']).toBe('synthetic-teacher');
      signedIn = false; await route.fulfill({ status: 204 }); return;
    }
    await route.fulfill({ status: 404, json: { status: 404, code: 'NOT_FOUND', message: 'Synthetic', fieldErrors: {}, requestId: 'synthetic' } });
  });
  await page.goto('/login');
  await page.screenshot({ path: test.info().outputPath('login-390.png'), fullPage: true });
  await page.keyboard.press('Tab'); await expect(page.getByText('К содержимому')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('textbox', { name: 'Логин' })).toBeFocused();
  await page.keyboard.type('synthetic'); await page.keyboard.press('Tab');
  await expect(page.locator('[name="password"]')).toBeFocused(); await page.keyboard.type('  synthetic password  ');
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/teacher/students');
  await expect(page.getByRole('heading', { name: 'Мои ученики' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('teacher-390.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Главное меню' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Преподаватели', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Сменить пароль' }).click();
  await expect(page.getByRole('heading', { name: 'Смена пароля' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(failures).toEqual([]);
});

test('legacy preview at 390px retains section zero and shows a read-only label', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: { account: { userId: 'synthetic', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 }, csrfToken: 'synthetic' } }));
  await page.goto('/?screen=student#students/s1/lessons/l1/student/tasks/section-0');
  await expect(page).toHaveURL('/teacher/students/s1/lessons/l1/student/tasks?preview=student#section-0');
  await expect(page.getByText('Предпросмотр кабинета ученика · только чтение')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('administrator page at 390px wraps long logins and issues manual links', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/session') { await route.fulfill({ json: { account: { userId: 'synthetic-admin', workspaceId: null, role: 'ADMIN', authVersion: 1 }, csrfToken: 'synthetic' } }); return; }
    if (url.pathname === '/api/v1/admin/teachers') { await route.fulfill({ json: { items: [{ userId: 't1', login: 'synthetic-teacher-'.repeat(10), workspaceId: 'w1', accountDisabled: false, workspaceDisabled: false }], page: 0, size: 25, total: 1 } }); return; }
    if (url.pathname === '/api/v1/admin/teacher-invitations' && route.request().method() === 'POST') { await route.fulfill({ json: { id: 'i1', link: '/register?token=synthetic-only', expiresAt: '2026-10-04T12:00:00Z' } }); return; }
    if (url.pathname === '/api/v1/admin/teacher-invitations') { await route.fulfill({ json: { items: [], page: 0, size: 25, total: 0 } }); return; }
    await route.fulfill({ status: 404 });
  });
  await page.goto('/admin/teachers');
  await expect(page.getByRole('button', { name: 'Блокировать аккаунт' })).toBeVisible();
  await page.getByRole('button', { name: '+ Пригласить преподавателя' }).click();
  await expect(page.getByRole('textbox', { name: 'Одноразовая ссылка' })).toHaveValue('http://127.0.0.1:4201/register?token=synthetic-only');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('admin-390.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'Одноразовая ссылка' }).focus();
  expect(await page.locator('[name="issuedLink"]').evaluate((input: HTMLInputElement) => input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

for (const path of ['/not-found', '/unknown/synthetic-page']) {
  test(`anonymous error page stays visible at ${path} and recovers to login`, async ({ page }) => {
    await page.route('**/api/v1/auth/session', route => route.fulfill({ json: { account: null, csrfToken: 'synthetic' } }));
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'В кабинет', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('link', { name: 'В кабинет', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  });
}
