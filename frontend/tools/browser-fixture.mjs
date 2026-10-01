// Compile BrowserFixture and its test dependency classpath before using this launcher.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile, open, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const frontend = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = path.dirname(frontend);
const lane = path.join(root, '.runtime', 'browser-fixtures');
await mkdir(lane, { recursive: true });
const runtime = await mkdtemp(path.join(lane, 'synthetic-'));
const server = createServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
if (port === 4173) throw new Error('Reserved live port');
const browserOrigin = `http://127.0.0.1:${port}`;
const dependencies = (await readFile(path.join(root, '.runtime', 'browser-fixture-classpath.txt'), 'utf8')).trim();
const classpath = [path.join(root, 'backend/target/test-classes'), path.join(root, 'backend/target/classes'), dependencies].join(path.delimiter);
const log = await open(path.join(runtime, 'backend.log'), 'w');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const backend = spawn(java, ['-Xmx768m', '-cp', classpath, 'ru.mentor.platform.support.BrowserFixture', runtime, browserOrigin], { cwd: root, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
let backendExit;
backend.on('exit', code => { backendExit = code ?? 1; });
backend.on('error', () => { backendExit = 1; });
try {
    const readyPath = path.join(runtime, 'ready.json');
    const deadline = Date.now() + 120_000;
    while (true) {
        if (backendExit !== undefined) throw new Error(`Synthetic backend exited; inspect ${path.join(runtime, 'backend.log')}`);
        try { await access(readyPath); break; } catch { /* startup pending */ }
        if (Date.now() > deadline) throw new Error(`Synthetic backend startup timed out; inspect ${path.join(runtime, 'backend.log')}`);
        await pause(250);
    }
    const ready = JSON.parse(await readFile(readyPath, 'utf8'));
    await writeFile(path.join(runtime, 'proxy.json'), JSON.stringify({ '/api/**': { target: ready.backendOrigin, secure: false, changeOrigin: false } }));
    console.log(`Synthetic browser runtime: ${runtime}`);
    const playwrightEnvironment = { ...process.env, MENTOR_BROWSER_FIXTURE: readyPath };
    delete playwrightEnvironment.NO_COLOR;
    const playwright = spawn(process.execPath, [path.join(frontend, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.integration.config.ts', ...process.argv.slice(2)], {
        cwd: frontend, windowsHide: true, stdio: 'inherit', env: playwrightEnvironment,
    });
    process.exitCode = await new Promise((resolve, reject) => { playwright.once('error', reject); playwright.once('exit', code => resolve(code ?? 1)); });
} finally {
    await writeFile(path.join(runtime, 'stop'), '');
    if (backendExit === undefined) await Promise.race([new Promise(resolve => backend.once('exit', resolve)), pause(15_000)]);
    if (backendExit === undefined) backend.kill();
    await rm(path.join(runtime, 'credentials.json'), { force: true });
    await log.close();
}
