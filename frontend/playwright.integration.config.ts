import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const fixturePath = process.env['MENTOR_BROWSER_FIXTURE'];
if (!fixturePath) throw new Error('Use node tools/browser-fixture.mjs after compiling the test-only backend fixture.');
const ready = JSON.parse(readFileSync(fixturePath, 'utf8'));
const runtime = path.dirname(fixturePath);
const port = new URL(ready.browserOrigin).port;
export default defineConfig({
    testDir: './integration', workers: 1, fullyParallel: false, timeout: 60_000,
    testMatch: ['task11.spec.ts', 'task12.spec.ts', 'task13.spec.ts', 'tenant-isolation.spec.ts'],
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    outputDir: path.join(runtime, 'browser-results'), reporter: 'list',
    use: { baseURL: ready.browserOrigin, viewport: { width: 1280, height: 900 }, trace: 'off' },
    webServer: {
        command: `"${process.execPath}" node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port ${port} --proxy-config "${path.join(runtime, 'proxy.json')}"`,
        url: ready.browserOrigin, reuseExistingServer: false, timeout: 60_000,
    },
});
