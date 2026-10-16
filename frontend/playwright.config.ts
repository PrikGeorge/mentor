import { defineConfig } from '@playwright/test';
const port = Number(process.env['MENTOR_UI_PORT'] ?? 4202);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4173, 4201].includes(port)) {
    throw new Error('MENTOR_UI_PORT must be a test port (1024–65535), excluding 4173 and 4201.');
}
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    retries: process.env['CI'] ? 2 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: { baseURL: origin, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: { command: `npm run start -- --host 127.0.0.1 --port ${port}`, url: origin, reuseExistingServer: false, timeout: 60000 },
});
