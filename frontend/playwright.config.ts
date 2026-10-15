import { defineConfig } from '@playwright/test';
export default defineConfig({
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:4201', viewport: { width: 390, height: 844 } },
    webServer: { command: 'npm run start -- --host 127.0.0.1', url: 'http://127.0.0.1:4201', reuseExistingServer: false, timeout: 60000 },
});
