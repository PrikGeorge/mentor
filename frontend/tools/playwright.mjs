import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Playwright enables FORCE_COLOR for child processes; avoid inheriting a contradictory NO_COLOR.
const env = { ...process.env };
delete env.NO_COLOR;
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, windowsHide: true, stdio: 'inherit',
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
