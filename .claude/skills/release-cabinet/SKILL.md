---
name: release-cabinet
description: Процедура выпуска релиза в рабочий кабинет 127.0.0.1:4173 (Docker-проект mentor-platform с настоящими данными учеников) по docs/operations/java-angular.md — сборка в NTFS-копии, образы с новым MENTOR_RELEASE, копия с -VerifyRestore, Q-18 на расшифрованном дампе, репетиция на временной БД, переключение MENTOR_RELEASE в обоих compose.env, проверка и запись в бэклог. Использовать только по прямой команде владельца «выпусти в кабинет».
---

# Релиз в кабинет 4173

Кабинет — живой контур с реальными данными. Каждый шаг ниже меняет или читает рабочие данные, поэтому релиз начинается **только по прямой команде владельца** в этом разговоре; команда на одну версию не распространяется на следующую. Источник истины — раздел «Обновление и откат релиза» в `docs/operations/java-angular.md`; этот скилл — порядок для этой машины. Агент `devops-sre` ревьюит план, `qa-lead` — числа ворот.

## Где что лежит

- Данные — в Docker-томах проекта `mentor-platform` (`_postgres`, `_objects`, `_spool`), не в папке проекта.
- Конфигурация в двух копиях, обе должны совпадать байт в байт (ASCII, LF): `.runtime\platform\compose.env` в корне репозитория (его читает `Start-Mentor.cmd`) и `%LOCALAPPDATA%\MentorPlatform\platform\compose.env`. Агент меняет в них только строку `MENTOR_RELEASE=` и не выводит остальное содержимое.
- Копии: `%LOCALAPPDATA%\MentorPlatform\backups\`. Закрытые каталоги репетиций: `%LOCALAPPDATA%\MentorPlatform\rehearsal\<релиз>\`.
- PowerShell 7: `%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe`.

## 0. Перед началом

1. `git status --short` чист, HEAD — нужный коммит, ворота раздела 6 бэклога пройдены и записаны.
2. Тег релиза: `local-<ГГГГММДД><буква>` (следующая буква после текущего). Запиши текущий `MENTOR_RELEASE` — это точка отката образом.
3. Определи объём: есть ли новые миграции (`git diff <прошлый релиз>..HEAD --stat -- backend/src/main/resources/db/migration`), менялись ли `backend/`, `frontend/`, `runner/`. Неаддитивная миграция (удаление, переименование, NOT NULL без умолчания, перезапись данных) делает откат образом невозможным — сообщи владельцу до релиза.

## 1. Сборка в NTFS-копии

Сборка и проверки идут в отдельной копии и рабочий контур не трогают, поэтому делаются до копии данных: так копия снимается непосредственно перед действиями с данными.

1. `git -c safe.directory='*' worktree add --detach (Join-Path $env:USERPROFILE '.codex\worktrees\release-<тег>') <коммит>` (скилл `ntfs-checks`).
2. В копии: `.\mvnw.cmd -B -pl backend verify`, `npm.cmd --prefix frontend ci`, unit, lint, `run build`. Числа — в отчёт.
3. Образы в WSL (Linux engine, BuildKit): `docker buildx build --load` с `--build-arg JAR_SOURCE=prebuilt` (backend) и `--build-arg DIST_SOURCE=prebuilt` (web), тег `<тег>`; команды и контексты — раздел «Требования» эксплуатации. Если менялся только frontend — backend не пересобирается, прежний образ получает новый тег `docker tag`. Runner — только если менялся `runner/`, и только из LF-checkout.
4. `docker compose -f infra/compose.platform.yaml --env-file <env> -p mentor-platform config -q` — синтаксис без запуска.

## 2. Копия текущего состояния

`infra/backup.ps1 -EnvironmentFile <env> -Destination (Join-Path $env:LOCALAPPDATA 'MentorPlatform\backups') -PassphraseFile <рабочий файл пароля> -VerifyRestore` — через pwsh 7 **из PowerShell или cmd, не из Git Bash** (иначе подхватывается GNU tar и архивирование падает). Backend останавливается на ~10 с. Нужен `receipt.json` с `completed` и `restoreVerified: true`; имя каталога `mentor-backup-<метка>` — точка отката данными. Без этого дальше не идти.

## 3. Q-18 на расшифрованном дампе (только если есть новые миграции)

Решение владельца (§0.1 бэклога): постоянного доступа к настоящим копиям у агента нет, реальный Q-18 выполняет владелец. Агент делает этот шаг и репетицию шага 4 только если владелец прямо поручил это **для этого релиза** (так выпускались local-20261015d и -15e); иначе агент готовит команду, а владелец запускает её и сообщает код возврата и `completed`. Расшифровать из копии шага 2 только `manifest.json` и `database.dump` в `%LOCALAPPDATA%\MentorPlatform\rehearsal\<тег>\`; SHA256 — `manifest.databaseSha256`. Команда — шаг 3 раздела «Обновление и откат релиза» эксплуатации, из NTFS-копии релиза, после завершения `verify` в ней (общий `target/`). Критерий: код 0, `completed: true`, применена ≥ 1 миграция, counts сохранены, повторный migrate = 0. Без новых миграций Q-18 неприменим — так и записать.

## 4. Репетиция на временной БД (если есть миграции или менялся backend)

Те же условия доступа к дампу, что в шаге 3. Штатный вариант — временный контур скриптами (`initialize-platform.ps1` с другим портом, своя подсеть и `MENTOR_HTTPS_PORT` вместо 8443, `restore-platform.ps1 -Apply -SkipPreRestoreBackup` с `-EnvironmentFile` и `-ProjectName` временного контура), критерии — шаг 4 эксплуатации, включая вход и открытие занятия по временному origin. Ручной вариант: тот же дамп → временный PostgreSQL той же версии, что у сервиса `postgres` в compose → новый backend-образ на нём со своим project name, сетью и портом. Критерии: Flyway применил новые версии без ошибок, readiness UP, counts таблиц равны (пробный запрос добавляет одну строку `spring_session` — это не расхождение), запрос к backend с заголовком `Host`, равным `MENTOR_PUBLIC_ORIGIN`. Всё временное удалить. После переключения удалить расшифрованный дамп, оставить только отчёт.

## 5. Переключение

1. В **обоих** `compose.env` заменить только значение `MENTOR_RELEASE` (побайтовая замена, без смены кодировки и переводов строк); сверить, что файлы совпадают.
2. Из корня репозитория: `infra/start-platform.ps1 -EnvironmentFile <env>` → «Platform ready»; `infra/status-platform.ps1 -EnvironmentFile <env>` → код 0, `ready: true`, `database: up`, `backend` и `web` — `healthy` (или `running`), `site: reachable`; `worker: unavailable` релиз не блокирует.
3. Логи backend — без ошибок Flyway; страница входа без ошибок консоли. Вход реальными аккаунтами агент не выполняет — ручная проверка обеими ролями остаётся у владельца.

## 6. Откат

- Образом: прежний `MENTOR_RELEASE` в обоих env и `start-platform.ps1` (корректно только при аддитивных миграциях).
- Данными (если миграция неаддитивна или данные повреждены): сначала вернуть прежний `MENTOR_RELEASE` в обоих env, затем `infra/restore-platform.ps1 -Backup <каталог копии шага 2> -PassphraseFile <файл пароля> -EnvironmentFile <env> -ProjectName mentor-platform -ReportDirectory <новый каталог вне копии>` — сначала dry-run, после него то же с `-Apply -PreRestoreBackupDestination (Join-Path $env:LOCALAPPDATA 'MentorPlatform\backups')` (раздел «Восстановление в рабочий контур»). Только по команде владельца: данные после обновления останутся лишь в предварительной копии.

## 7. Запись

Строка в таблицу раздела 0 бэклога: дата и время МСК, тег, коммит, имя копии (с сокращённым хэшем) и restoreVerified, Q-18 и репетиция (или «неприменимо, миграций нет»), ID образов, результат status, точка отката, что осталось владельцу. Отдельный docs-коммит `docs: record the release of … as <тег>`. Push — только по отдельной команде.

## Нельзя

Публиковать содержимое `compose.env`, паролей, копий и дампов в чат, Git, логи и заметки; использовать рабочие project name, подсеть или порт для репетиции; редактировать применённые миграции; вводить пароли реальных аккаунтов.
