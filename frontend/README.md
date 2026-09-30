# Angular frontend

Run every npm command through `../infra/use-node.ps1` using the verified portable Node24.15.0 runtime. The helper requires an absolute Node directory and preserves the caller's PATH. Dependencies are pinned in package-lock.json. Angular uses TypeScript6; the isolated tools/api workspace uses TypeScript5 to satisfy openapi-typescript's peer dependency.

From the migration worktree root:

```powershell
$runtime = (Resolve-Path '.runtime/toolchains/node-v24.15.0-win-x64').Path
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','ci')
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','run','api:generate')
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','test','--','--watch=false')
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','run','build')
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','run','start','--','--host','127.0.0.1')
```

The dev frontend runs on 4201 and proxies `/api/**` to backend 8081. Configure the backend `MENTOR_PUBLIC_ORIGIN=http://127.0.0.1:4201` for the browser origin shown above, or its exact localhost equivalent if that is what you open. The proxy preserves Host and Origin (`changeOrigin:false`); it must not rewrite Origin. Production serves frontend and API from one HTTPS origin.

`npm run api:generate` reads the actual `../contracts/openapi.yaml`; never edit schema.d.ts manually. HttpClient uses typed operations from this generated schema. Cookies remain HttpOnly and are managed by the browser; no session credentials, private lesson data, or tokens are stored in assets/localStorage/sessionStorage. One-use links appear only in the issuing admin view for manual transfer.

`SessionStore.actor` and `generation` are readonly signals. `scope(observable)` cancels requests/subscriptions when the account changes. Domain views must bind caches to the generation and clear them at account changes. The shared interceptor cancels old domain HTTP requests and never retries mutations. Router guards help navigation; the backend checks all resource ownership and roles.

Task10 supplies the identity, admin and navigation shell. The teacher and learner route outlets are integration points for later domain tasks. Legacy routes keep student, lesson, audience, page, section/code/exercise and preview values; missing/malformed links go to `/not-found`.

Browser verification uses synthetic API fixtures and Chromium:

```powershell
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','exec','--','playwright','install','chromium')
./infra/use-node.ps1 -NodeDirectory $runtime -Command npm.cmd -Arguments @('--prefix','frontend','run','test:ui')
```

Full backend e2e acceptance belongs to the later migration acceptance task.
