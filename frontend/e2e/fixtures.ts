import { test as base, expect, type Page } from '@playwright/test';
import type { components } from '../src/app/api/schema';

export { expect };
export type { Page };

// Uncaught browser errors fail every UI scenario, including those that replace their synthetic account.
export const test = base.extend<{ pageErrors: string[] }>({
    pageErrors: [
        async ({ page }, use) => {
            const errors: string[] = [];
            const record = (error: Error) => errors.push(error.message);
            page.on('pageerror', record);
            try {
                await use(errors);
            } finally {
                page.off('pageerror', record);
            }
            expect(errors, 'Uncaught browser errors').toEqual([]);
        },
        { auto: true },
    ],
});

type Actor = components['schemas']['Actor'];

// Install after scenario API routes. Login/logout/CSRF failure flows keep their own handlers.
export async function mockSession(page: Page, account: Actor | null | (() => Actor | null), login?: string) {
    await page.route('**/api/v1/auth/session', (route) =>
        route.fulfill({
            json: { account: typeof account === 'function' ? account() : account, csrfToken: 'synthetic', ...(login ? { login } : {}) },
        })
    );
}
