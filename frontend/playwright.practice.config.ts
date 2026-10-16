import { defineConfig } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const fixturePath = process.env['MENTOR_PRACTICE_FIXTURE'];
if (!fixturePath) throw new Error('Use the isolated actual-worker private fixture after its owner releases it.');
let fixture: { publicOrigin: string };
try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch {
    throw new Error('Cannot read isolated worker metadata.');
}
const runtime = path.resolve('../.runtime/task14/real');
mkdirSync(runtime, { recursive: true });
export default defineConfig({
    testDir: './integration',
    testMatch: 'practice-real.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180000,
    outputDir: path.join(runtime, 'results'),
    reporter: [['list'], ['html', { outputFolder: path.join(runtime, 'playwright-report'), open: 'never' }]],
    use: { baseURL: fixture.publicOrigin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: { command: `"${process.execPath}" tools/practice-runtime.mjs`, url: fixture.publicOrigin, reuseExistingServer: false, timeout: 30000 },
});
