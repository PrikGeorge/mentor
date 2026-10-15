---
name: ntfs-checks
description: Как запускать проверки платформы наставника на машине, где рабочая копия лежит на FAT32 (E:) — npm ci, Angular unit, lint, build, генерацию API-схемы, Playwright UI и real e2e, backend verify из NTFS-копии (git worktree на C:). Использовать перед каждым коммитом задачи и перед релизом, когда нужно получить числа ворот QA.
---

# Проверки из NTFS-копии

Рабочая копия на FAT32: там нет симлинков (workspace `tools/api` ломает `npm ci` с EISDIR) и Docker bind mount приходит пустым. Исходники правим в основной копии, проверяем в NTFS-копии.

## 1. Создать или освежить копию

Из корня основной копии (PowerShell):

```powershell
$wt = Join-Path $env:USERPROFILE '.codex\worktrees\<имя-задачи>'
git -c safe.directory='*' worktree add --detach $wt HEAD
```

FAT32 не хранит владельца файлов, поэтому Git пишет «dubious ownership»: в командах над основной копией и над worktree используй `git -c safe.directory='*' ...`. Глобальную конфигурацию Git не меняй без просьбы владельца.

Незакоммиченные правки переносить зеркалом исходников (только из PowerShell — в Git Bash `robocopy` ломается конвертацией путей MSYS):

```powershell
robocopy frontend\src "$wt\frontend\src" /MIR
robocopy frontend\e2e "$wt\frontend\e2e" /MIR
robocopy frontend\integration "$wt\frontend\integration" /MIR
robocopy backend\src "$wt\backend\src" /MIR
robocopy contracts "$wt\contracts" /MIR
```

Не копировать `node_modules`, `dist`, `.angular`, `target`. После коммита копию можно пересоздать от нового HEAD или продолжать зеркалить.

## 2. Node 24

Проектный Node лежит в `.runtime\toolchains\node-v24.15.0-win-x64` основной копии (системный может быть другой версии). В PowerShell 7:

```powershell
$node = (Resolve-Path '<корень основной копии>\.runtime\toolchains\node-v24.15.0-win-x64').Path
pwsh -File infra/use-node.ps1 -NodeDirectory $node -Command npm.cmd -Arguments '--prefix','frontend','ci'
```

В Windows PowerShell 5.1 `use-node.ps1` не работает (нет `IsPathFullyQualified`) — тогда добавь каталог Node в начало `PATH` на время команды. В Git Bash путь в `PATH` пишется в POSIX-форме (`/<диск>/<путь>/.runtime/toolchains/node-v24.15.0-win-x64`), форма `E:/...` не работает.

## 3. Frontend (в `$wt`)

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run api:generate      # затем сравнить schema.d.ts с основной копией (SHA256 или git diff)
npm.cmd --prefix frontend test -- --watch=false  # число тестов и файлов
npm.cmd --prefix frontend run lint               # 0 ошибок; прежние warnings — числом
npm.cmd --prefix frontend run build              # initial из вывода, бюджет 600 кБ
npx --prefix frontend prettier --check <изменённые файлы>
```

`api:check` в worktree без `.git` в каталоге frontend может вернуть код 129 — это не провал контракта; проверяй генерацию и сравнение файлов отдельно.

## 4. Playwright

- UI-фикстуры: `npm.cmd --prefix frontend run test:ui -- --project=chromium`. Порт 4202 (`MENTOR_UI_PORT`); 4201 занят dev-сервером владельца, 4173 — рабочий кабинет, оба запрещены. Chromium Playwright ставится в `%LOCALAPPDATA%\ms-playwright`.
- Real browser (`frontend/integration/`): сначала classpath фикстуры из `$wt`:

  ```powershell
  $cp = Join-Path $wt '.runtime\browser-fixture-classpath.txt'
  .\mvnw.cmd -B -q -pl backend test-compile dependency:build-classpath "-Dmdep.outputFile=$cp"
  ```

  Путь — абсолютный: относительный Maven разрешит от каталога модуля (`backend/.runtime`), а `browser-fixture.mjs` читает `.runtime` в корне. Аргумент `-D…=` — целиком в кавычках, иначе PowerShell его режет. Затем из `$wt\frontend`: `node tools\browser-fixture.mjs [integration/<spec>.spec.ts] --project=chromium`. Каждый lane поднимает свой PostgreSQL и Spring Boot, 1–2 минуты. Наборы: task11, task12, task13, stage3-real, tenant-isolation.
- `e2e:practice` требует `MENTOR_PRACTICE_FIXTURE` и выделенного контура с runner; без него gate записывается как открытый.

## 5. Backend

- Полный зелёный прогон — из `$wt`: `.\mvnw.cmd -B -pl backend verify` (Docker обязателен, около 5 минут; JaCoCo в `backend/target/site/jacoco/`). Spotless проверяется в `validate`; исправление — `.\mvnw.cmd -pl backend spotless:apply`.
- Быстрый прогон с основной копии допустим: `.\mvnw.cmd -pl backend test`; единственное известное средовое падение там — `BlobStoreContractTest.nativeLinuxSymlinksAreNeverReadable`.
- Не запускать в одной копии параллельно `verify` и `test-compile`/classpath (общий `target/`) — verify падает.
- Общие тестовые часы `IdentityHttpTest.CLOCK` сдвигаются другими классами: даты в новых тестах — от `CLOCK.instant()`.

## 6. Отчёт

Записывай для строки раздела 0: backend N/N (было M), unit N/N в K файлах (было M), lint 0 ошибок / W прежних warnings, build initial X кБ (было Y), UI N/N, real по lane, schema = contract. То, что не запускалось, называй прямо.

## Нельзя

Запускать compose против проекта `mentor-platform`, читать `compose.env`, `private/`, `data/` и копии; удалять чужие worktree (релизные `release-*` — точки отката).
