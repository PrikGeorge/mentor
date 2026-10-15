import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page, credentials: { login: string; password: string }, home: string | RegExp) {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Логин', exact: true }).fill(credentials.login);
    await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(home);
}

export async function openAccountMenu(page: Page) {
    // Preview has a read-only badge instead of an account menu.
    if (new URL(page.url()).searchParams.get('preview')) await page.goto('/');
    const mobileMenu = page.getByRole('button', { name: /^(Меню|Закрыть меню)$/ });
    const profileMenu = page.getByRole('button').and(page.locator('[aria-controls="profile-menu"]'));
    const trigger = mobileMenu.or(profileMenu);
    await expect(trigger).toBeVisible();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

export async function signOut(page: Page) {
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL('/login');
}
