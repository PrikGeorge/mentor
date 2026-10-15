# Восстановление после сбоя и ротация секретов

Документ дополняет [java-angular.md](java-angular.md): там описаны обычный запуск, копии и обновление релиза, здесь — что делать, когда что-то уже сломалось, и как по расписанию менять секреты. Все команды выполняются из Windows PowerShell 7 (`%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe`), не из Git Bash: из Git Bash `pwsh` подхватывает GNU `tar` и ломает копии. Пути ниже — для рабочего контура на этой машине; на Linux-сервере те же скрипты работают с путями в стиле POSIX.

Общие обозначения: `$Env` — `E:\mentor-site\.runtime\platform\compose.env`; `$Backups` — `C:\Users\George\AppData\Local\MentorPlatform\backups`. Копия конфигурации лежит в `%LOCALAPPDATA%\MentorPlatform\platform\compose.env` и должна совпадать с `$Env` байт в байт.

## Как заметить сбой

- `infra/status-platform.ps1 -EnvironmentFile $Env` печатает JSON: `ready`, `database`, `backend`, `web`, `site`, `worker`, `queue`, `tls`, `warnings`. Код возврата 1, если платформа не готова.
- Задача Task Scheduler из `infra/windows/register-status-task.ps1` запускает эту проверку каждые 10 минут и шлёт алерт в Telegram через `infra/notify.ps1`, когда `ready` ложно, исполнитель не отвечает дольше заданных минут, на диске меньше порога свободного места или сертификат gateway истекает. Повтор одного и того же алерта подавляется на `-RepeatMinutes`.
- Пока задача не зарегистрирована, признак беды — жалоба ученика: кабинет не открывается, попытка тренажёра висит «В очереди» дольше минуты, сдача ДЗ не подтверждается.

## Сценарии

### Потеря машины целиком

Что нужно иметь заранее: копии в offsite-каталоге (`infra/backup.ps1 -OffsiteDirectory`), пароль копий `backup-passphrase` в менеджере паролей, доступ к репозиторию `github.com/PrikGeorge/mentor` и образы (собираются из исходников через `infra/*/Dockerfile` с `JAR_SOURCE=build`, `DIST_SOURCE=build`, см. [ci.yml](../../.github/workflows/ci.yml)).

1. На новой машине: Docker, PowerShell 7, клонировать репозиторий, собрать или скачать образы нужного релиза.
2. `infra/initialize-platform.ps1` создаёт каталог платформы, `compose.env` и секреты. Старый пароль PostgreSQL не нужен: копия восстанавливается в новую БД с новым паролем.
3. Положить `backup-passphrase` из менеджера паролей рядом с `compose.env` (так ожидают скрипты) и перенести каталог копии `mentor-backup-<метка>-<id>` с `snapshot.tar.gpg` и `receipt.json`.
4. `infra/restore-test.ps1` на копии — доказать, что она читается.
5. `infra/restore-platform.ps1 -Backup <каталог копии> -PassphraseFile <файл> -EnvironmentFile $Env -ReportDirectory <куда писать receipt>` — сначала без `-Apply` (план), затем с `-Apply -SkipPreRestoreBackup` (на пустом контуре предварительная копия не нужна).
6. `infra/start-platform.ps1 -EnvironmentFile $Env`, затем `infra/status-platform.ps1`. Критерий: `ready: true`, вход преподавателя, открывается карточка ученика с материалами.

### Потеря или порча тома PostgreSQL

Признак: `status-platform` показывает `database: unavailable` или backend падает на старте с ошибкой подключения; в логах Flyway нет записей о миграциях.

1. Остановить приём работ: `docker compose -p mentor-platform stop backend web` (через `infra/platform-common.ps1` это делает сам `restore-platform.ps1`).
2. Выбрать последнюю копию с `receipt.json`: `completed` и `restoreVerified` истинны.
3. `restore-platform.ps1 ... -Apply` без пропуска предварительной копии, если том ещё читается: скрипт сам снимает копию текущего состояния перед заменой. Если том не читается, добавить `-SkipPreRestoreBackup` и понимать, что данные между последней копией и сбоем потеряны.
4. После старта сверить счётчики таблиц с `receipt.json` восстановления и проверить последние занятия вручную.

### Потеря тома объектов (файлы ДЗ и материалов)

Признак: скачивание файла отвечает 404 или 500, в логах backend `storage unavailable` или ошибки чтения `/var/lib/mentor/objects`. База при этом цела.

Восстановление идёт тем же `restore-platform.ps1`: он всегда восстанавливает и БД, и объекты одной копии, потому что `stored_blob` ссылается на файлы по ключам. Восстановление только объектов без БД даст расхождение. Поэтому: копия → `-Apply` → проверка `GET .../homework/{id}/file` для нескольких работ.

### Истёк TLS-сертификат gateway исполнителя

Признак: `status-platform` показывает `worker: unavailable`, предупреждение `tls` о сроке; runner в логах пишет ошибку рукопожатия. Попытки копятся в очереди, данные не теряются.

1. `infra/issue-job-tls.ps1 -Directory <каталог TLS из compose.env> -Hostnames job-gateway,<имя хоста> -IpAddresses 127.0.0.1,<адрес>` выпускает новые `server.crt` и `server.key` и `truststore.p12` для runner. По умолчанию старый сертификат остаётся в truststore на время перехода, `-NoPreviousOverlap` отключает это.
2. Перезапустить gateway: `docker compose -p mentor-platform --profile runner restart job-gateway`.
3. Скопировать `truststore.p12` в каталог конфигурации runner и перезапустить runner (`compose.runner.yaml`).
4. `status-platform` должен показать `worker: available` в течение минуты; очередь разберётся сама.

`status-platform.ps1 -TlsWarningDays 30` предупреждает за месяц; задача статуса шлёт этот сигнал в Telegram.

### Зависший импорт прежнего кабинета

Признак: backend отказывается стартовать или возвращает 503 с упоминанием незавершённого `import_run`. Это предохранитель `migration/DatabaseGate`: он не даёт работать с базой, в которой перенос начат и не завершён.

Разбор описан в [java-angular.md](java-angular.md), раздел диагностики: либо довести импорт до конца той же командой `legacy-import`, либо восстановить копию, снятую до импорта. Не удалять записи `import_run` руками.

### Заполнился диск

Признак: PostgreSQL пишет `No space left on device`, backend отвечает 503, Docker не стартует контейнеры. На Windows растёт виртуальный диск WSL `ext4.vhdx`.

1. Освободить место, не трогая тома платформы: старые копии (`infra/backup.ps1` держит 14 дней, лишние каталоги в `$Backups` можно удалить), `docker image prune`, `docker builder prune`, старые worktree сборок в `C:\Users\George\.codex\worktrees`.
2. Проверить `docker system df`. Том `mentor-platform_spool` должен быть почти пуст: там живут только временные загрузки и подготовленные файлы попыток.
3. После освобождения `docker compose -p mentor-platform start`, `status-platform`. Если PostgreSQL не поднимается, восстановить из копии по сценарию тома.
4. Включить в задачу статуса порог `-MinFreeGB`, чтобы в следующий раз узнать раньше.

### Исполнитель не отвечает, очередь растёт

Признак: `status-platform`: `worker: unavailable`, `queue.waiting` растёт; ученики видят баннер «Исполнитель заданий сейчас не отвечает». Backend сам переводит просроченные задания в `retry_pending` и повторяет их, когда исполнитель вернётся; попытки не теряются.

1. На хосте runner: `docker compose -f infra/compose.runner.yaml logs --tail 100 runner`. Частые причины: истёк TLS gateway (сценарий выше), заменён `worker-credential` только с одной стороны, кончилось место под `MENTOR_RUNNER_SCRATCH`, Docker socket недоступен.
2. Перезапустить runner. Если он не видит gateway, проверить публикацию порта gateway (сеть `job_edge` в `compose.platform.yaml`) и адрес `MENTOR_JOB_SERVICE`.
3. Критерий: `worker: available`, `queue.waiting` уменьшается, свежая попытка в тренажёре завершается.

## Ротация секретов

Менять по календарю (раз в год) и немедленно при подозрении на утечку. Порядок важен: каждый шаг оставляет систему работоспособной.

### Пароль PostgreSQL

`infra/rotate-database-password.ps1 -EnvironmentFile $Env -PasswordFile <секрет spring.datasource.password> -MirrorPasswordFile <та же копия в %LOCALAPPDATA%>` без `-Apply` показывает план, с `-Apply` делает всё сам: генерирует новый пароль, меняет его в PostgreSQL через `ALTER USER` с SCRAM-хешем, атомарно переписывает файлы секрета, перезапускает backend и ждёт готовности. Если backend не поднялся, скрипт возвращает старый пароль. Старые копии базы от пароля PostgreSQL не зависят.

### Учётные данные исполнителя (`worker-credential`)

Файл лежит в двух каталогах: `worker-secrets` платформы (его читает backend) и `MENTOR_RUNNER_SECRETS` на хосте runner. Порядок: записать новый файл во временное имя рядом, затем атомарно переименовать в обоих местах, затем перезапустить runner. Backend перечитывает файл при каждом запросе, поэтому его перезапуск не нужен. Пока файлы различаются, runner получает 401 и очередь просто ждёт.

### Пароль копий (`backup-passphrase`)

Новый пароль действует только для новых копий: старые `snapshot.tar.gpg` остаются зашифрованы старым. Поэтому при ротации сохраняйте в менеджере паролей обе записи с датами, пока старые копии не вышли за срок хранения. После смены сразу снять копию с `-VerifyRestore`, чтобы убедиться, что новый пароль расшифровывает.

### TLS gateway

См. сценарий «Истёк TLS-сертификат gateway» выше: `issue-job-tls.ps1` рассчитан и на плановую ротацию с перекрытием сроков.

## Проверка готовности к сбою

Раз в квартал: восстановить последнюю копию через `restore-test.ps1` (изолированно), прогнать `infra/tests/restore-platform.ps1` и `infra/tests/issue-job-tls.ps1`, убедиться, что пароль копий из менеджера паролей расшифровывает свежий `snapshot.tar.gpg`, и что задача статуса реально доставляет сообщение (`infra/notify.ps1 -Message "проверка" -DryRun`, затем без `-DryRun`).
