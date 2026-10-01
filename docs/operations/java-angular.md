# Эксплуатация Java / Angular

Платформа состоит из Angular, Spring Boot и PostgreSQL. Java-исполнитель запускается отдельно; только ему доступен Docker. Сайт хранит материалы и сдачи в закрытом хранилище и выдаёт их после проверки прав. Полные проекты ДЗ сохраняются для проверки преподавателем; автоматически выполняются только назначенные упражнения из доверенного каталога.

## Требования

Для запуска собранного сайта нужны Docker Engine с Compose v2 и PowerShell 7.2 или новее. На Windows административные скрипты используют `wsl -d Ubuntu -- docker`; Docker Desktop должен предоставлять Linux engine этой WSL-системе. Windows PowerShell 5.1 не подходит. Для резервирования нужен GnuPG 2 (`gpg`, `gpgconf`) и `tar`; на Windows GnuPG вызывается внутри Ubuntu. Node.js и Python не нужны во время работы сайта.

Для сборки нужны JDK 21, Maven Wrapper (Maven 3.9.11), Node.js 24.15.x и npm. Linux wrapper требует `unzip`: нельзя обходить проверку SHA256, подменяя ZIP архивом tar.gz. Версии зависимостей закреплены в `pom.xml` и `frontend/package-lock.json`. На Windows команды сборки выполняются из корня проекта:

```powershell
./mvnw.cmd verify
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run api:generate
npm.cmd --prefix frontend test -- --watch=false
npm.cmd --prefix frontend run build
```

Docker-тесты исполнителя требуют настоящего Linux Docker и Linux-путей для bind mounts. Windows CLI сам по себе не подтверждает эти проверки; используйте Linux checkout и `./mvnw -pl runner verify`. Не запускайте приемочные сценарии против рабочего сайта на порту 4173. Проверки браузера находятся в `frontend/e2e` и `frontend/integration`: вторые требуют отдельной синтетической PostgreSQL/Java среды, а сценарии тренажёра — настоящего исполнителя.

`npm.cmd --prefix frontend run test:ui -- --project=chromium` проверяет интерфейс с HTTP fixtures. Для настоящего backend подготовьте тестовый classpath (путь замените своим абсолютным путём), затем запустите отдельную синтетическую среду:

```powershell
./mvnw.cmd -pl backend test-compile dependency:build-classpath `
  -Dmdep.outputFile=C:/Projects/mentor/.runtime/browser-fixture-classpath.txt
npm.cmd --prefix frontend run e2e -- --project=chromium
```

Этот запуск включает реальные регистрацию, занятия, Markdown, файлы, ДЗ и ревью. Автопроверка Java проходит отдельным обязательным сценарием `e2e:practice` с `MENTOR_PRACTICE_FIXTURE`, указывающим на приватные метаданные выделенного тестового контура с PostgreSQL, private TLS и работающим исполнителем. Обычный `e2e` не является подтверждением запуска Java-кода. Не подставляйте в fixture адрес или credentials рабочего сайта.

После проверок соберите три образа с одним идентификатором релиза:

```powershell
docker build -f infra/backend/Dockerfile -t mentor-platform-backend:release-1 .
docker build -f infra/frontend/Dockerfile -t mentor-platform-web:release-1 .
docker build -f infra/runner-service/Dockerfile -t mentor-platform-runner:release-1 .
```

На Windows используйте эти команды внутри Ubuntu с Linux-путём проекта. Образы копируют только executable JAR или собранные публичные Angular-файлы. Старые `dist`, `data`, `private`, снимки и исходники заданий не должны становиться корнем публичной статики.

## Первый запуск нового контура

Выберите новый закрытый каталог конфигурации. Инициализация создаст пароль PostgreSQL, credential исполнителя и отдельный пароль шифрования копий. Она не создаёт пользователей и не импортирует старые данные.

```powershell
./infra/initialize-platform.ps1 -Directory C:/MentorPrivate/platform `
  -PublicOrigin http://127.0.0.1:4174 -Release release-1
./infra/start-platform.ps1 -EnvironmentFile C:/MentorPrivate/platform/compose.env
./infra/status-platform.ps1 -EnvironmentFile C:/MentorPrivate/platform/compose.env
```

Пути должны быть абсолютными; каталог должен отсутствовать до инициализации. Для Linux замените пути, например на `/etc/mentor/platform`. Права каталога — 0700, Windows ACL ограничен текущим пользователем и SYSTEM. Сохраните пароль резервных копий отдельно от самих копий: без него восстановление невозможно.

`start-platform.ps1` использует готовые образы, запускает PostgreSQL/backend/web и проверяет `/api/v1/auth/session`. Рабочие данные не импортируются автоматически. Статус `worker: unavailable` означает задержку автопроверки, при этом кабинет продолжает работать. Скрипт статуса выводит агрегаты очереди и возраст заданий без кода учеников и секретов.

Первого администратора создают из интерактивного терминала с настроенными БД и secrets. В развернутом контуре используйте `docker compose` с теми же `--env-file`, `-f infra/compose.platform.yaml` и `--project-name`, что и при запуске:

```text
docker compose ... run --rm --no-deps backend admin
```

Команда запрашивает логин, пароль и подтверждение; пароль скрыт и не передаётся аргументом. Публичная регистрация не создаёт администратора. Администратор приглашает преподавателей, преподаватель приглашает ученика в свою карточку. Минимум пароля — 8 символов. Ссылки приглашения и восстановления одноразовые; старые ссылки и сессии при миграции не сохраняются действующими.

## Перенос старого кабинета

Не направляйте importer на работающие JSON-файлы. Сначала сохраните тексты и код в старых вкладках, остановите старый процесс и получите закрытый снимок. `snapshot-legacy.ps1` удерживает совместимую блокировку старого хранилища, копирует канонические файлы и сверяет байты до/после копирования:

```powershell
./infra/snapshot-legacy.ps1 -Source E:/mentor-site `
  -Destination C:/MentorPrivate/cutover/snapshot
```

Существующий `accounts.lock` не удаляется этой командой. Если старый процесс завершился аварийно, сначала установите владельца PID/hostname и убедитесь, что он больше не пишет. Не удаляйте неизвестные блокировки. Снимок находится вне дерева старого сайта и вне Git. Сессии, временные файлы и `.bak` не считаются записями импорта.

Java CLI выполняет предварительную проверку без подключения к БД и без записи объектов. Укажите доверенный manifest окружений, его SHA256 и SHA256 файла профилей из снимка:

```text
java -jar backend.jar legacy-import --source <snapshot> --import-id <id>
  --environment-manifest <approved-manifest.json>
  --environment-manifest-sha256 <sha256>
  --environment-profiles-sha256 <sha256>
  --report <new-private-report.json> --dry-run
```

Строки выше — одна команда. Отчёт должен иметь непустой `sourceDigest` и пустой `errors`; `completed` у dry-run остаётся false. Для применения нужны дополнительно `--apply`, `--target-workspace <id>` и `--teacher-account <точный id единственного старого преподавателя>`. Нельзя одновременно задавать `--dry-run` и `--apply`. Новый target workspace создаётся импортером; он не присоединяет данные к чужому существующему пространству.

Перед apply нужны зашифрованный исходный снимок, резервная копия целевой БД/объектов и успешный dry-run для тех же данных. Во время apply backend должен быть остановлен: импорт использует эксклюзивную блокировку PostgreSQL. Незавершённый import run запрещает обычный запуск. При сбое сохраните исходный снимок, ID импорта и отчёт; устраните причину и повторите тот же ID. Изменившийся источник или другая целевая workspace не принимаются как продолжение.

До открытия новой версии для записи проверьте counts/checksums, вход, занятия, Markdown, файлы, профильные материалы, черновики и историю. Исторические попытки без версии окружения доступны только для чтения с пояснением «Версия окружения не сохранена». После появления новых записей автоматический возврат к старым JSON запрещён: нужен отдельный план восстановления, сохраняющий новые данные.

## Исполнитель Java

Исполнитель размещается на отдельном Linux-хосте. Подготовьте доверенные окружения командой executable runner JAR:

```text
java -jar runner.jar --prepare training/environments.json
  --cache <private-build-cache> --manifest <approved-environments.json>
```

Задание не может выбирать image, shell-команду или свои зависимости. Оператор проверяет профили/зависимости и фиксирует digest каждого образа. При добавлении библиотек создавайте новый environment ID и сохраняйте старые образы для существующих ревизий и очереди. Замена существующего ID требует остановки новых запусков, завершения очереди и явной перепубликации каталога.

На стороне сайта профиль `runner` в `infra/compose.platform.yaml` включает частный HTTPS gateway. Укажите `MENTOR_JOB_BIND_ADDRESS` закрытого интерфейса, `MENTOR_JOB_ADDRESS`, `MENTOR_JOB_PORT` и `MENTOR_JOB_TLS_DIRECTORY` с `server.crt`/`server.key`. Не публикуйте этот порт в Интернет. Публичный Caddy отклоняет `/internal`.

Для `infra/compose.runner.yaml` задайте:

- `MENTOR_JOB_SERVICE`: проверяемый HTTPS URL, заканчивающийся `/internal/v1`.
- `MENTOR_RUNNER_CONFIG`: закрытый каталог с `environments.json` и `truststore.p12`, доверяющим сертификату gateway.
- `MENTOR_RUNNER_SECRETS`: закрытый каталог с `worker-credential`, совпадающим с серверным файлом.
- `MENTOR_DOCKER_SOCKET_GID`: фактический GID Docker socket на хосте исполнителя.
- `MENTOR_RUNNER_SCRATCH`: абсолютный путь, одинаковый на хосте и в контейнере; доступен UID10001.
- `MENTOR_WORKER_ID`: уникальное имя исполнителя.

Секрет и manifest монтируются только в сервис исполнителя. Изолированные задания получают только исходники и доверенный harness, без сети, Docker socket и секретов. Выполнение ограничено по памяти, CPU, процессам, выводу и времени. При ротации credential замените файл атомарно в обоих каталогах; монтируется каталог, чтобы замена была видна без перезапуска.

### Исполнитель на локальном компьютере

Для локальной разработки можно использовать `infra/compose.runner.local.yaml` поверх основного runner-файла. Он подключает исполнителя к существующей приватной сети `<platform-project>_jobs`. Для публичного размещения остаётся отдельный хост исполнителя.

В отдельном закрытом `local-runner.env` задайте параметры исполнителя из списка выше и `MENTOR_PLATFORM_JOBS_NETWORK=<platform-project>_jobs`. Здесь `MENTOR_JOB_SERVICE=https://job-gateway:8443/internal/v1`. Сертификат gateway должен содержать SAN `job-gateway`; `truststore.p12` содержит только его доверенный публичный сертификат. Локальный overlay использует пароль этого хранилища `changeit`: это не пароль пользователя и не защита приватного ключа.

```text
docker compose --env-file <platform.env> -f infra/compose.platform.yaml --project-name <platform-project> --profile runner up -d --no-build job-gateway
docker compose --env-file <local-runner.env> -f infra/compose.runner.yaml -f infra/compose.runner.local.yaml --project-name <runner-project> up -d --no-build
```

Приватный ключ остаётся только у gateway. Каталоги конфигурации и credential исполнителя должны читаться UID10001; scratch должен принадлежать ему и быть доступен для записи. На Linux используйте 0700 для этих каталогов и 0600 для файлов; на Windows сохраняйте приватный ACL и проверяйте чтение из контейнера. Не изменяйте права всей папки проекта. Sandbox-контейнеры не получают эти mounts.

Исполнитель и gateway имеют `restart: unless-stopped`: Docker поднимает их после перезапуска, если они не были остановлены вручную. Ярлык кабинета запускает PostgreSQL/backend/web. После ручного `down` исполнителя снова выполните вторую команду. Недоступность исполнителя отражается в статусе очереди и не запрещает пользоваться кабинетом.

## HTTPS и доступ

Для внешнего сервера используйте `initialize-platform.ps1 -Production -PublicOrigin https://ваш-домен` с фактическим доменом. Проверьте DNS, доступность 80/443 и выпуск сертификата Caddy. Origin не содержит путь или завершающий `/`. Это административная инструкция; скрипты не покупают хостинг и не публикуют данные самостоятельно.

Frontend и `/api/v1` обслуживаются с одного origin. Не включайте произвольный CORS. Сессионная cookie HttpOnly; в production она Secure. Прокси сохраняет Host/Origin и задаёт собственные заголовки IP/protocol; Tomcat доверяет только точному IP этого прокси. Если изменяете Docker subnet/IP, согласованно измените `MENTOR_PROXY_IP`, `MENTOR_BACKEND_IP`, `MENTOR_WEB_SUBNET`, `MENTOR_PROXY_IP_REGEX`. Не заменяйте точное правило доверием ко всем частным сетям.

## Копии и восстановление

```powershell
./infra/backup.ps1 -EnvironmentFile C:/MentorPrivate/platform/compose.env `
  -Destination C:/MentorPrivate/backups `
  -PassphraseFile C:/MentorPrivate/platform/backup-passphrase -VerifyRestore
```

Для согласованного снимка скрипт кратко останавливает backend, удерживает эксклюзивную SQL-блокировку и экспортированный PostgreSQL snapshot. После копирования БД и объектов backend возобновляется; шифрование выполняется над закрытой копией. Отчёт содержит counts и SHA256 объектов, но не их содержимое.

`restore-test.ps1 -Backup <absolute-backup-dir> -PassphraseFile <absolute-file> -BackendImage <release-image>` расшифровывает данные только в новом закрытом временном каталоге, создаёт отдельные БД и object volume, сверяет counts/checksums и доступ UID10001, затем удаляет временные ресурсы. Команда не заменяет рабочую БД. `restore-report.json: completed=true` означает техническую проверку восстановления; вход и скачивание через приложение проверяются дополнительно при переносе/восстановлении рабочего контура.

Ежедневный запуск: настройте `infra/systemd/mentor-backup.service`, `.timer` и `backup.env.example` под реальные пути. Нужны установленный `/usr/bin/pwsh`, Docker service, пользователь `mentor-ops` и доступ к Docker. Установите unit-файлы с правами 0644 и конфигурацию с 0600. Шаблон запускается в 03:15 по часовому поясу сервера со случайной задержкой до 10 минут. Это systemd-задача, а не автоматизация Codex.

Scheduled-режим требует явный `-OffsiteDirectory`: подключённое хранилище на другом хосте. Он сверяет SHA256 зашифрованной копии, автоматически проверяет восстановление и только после успеха удаляет распознанные завершённые копии старше 14 дней. Незавершённые и неизвестные каталоги не удаляются. Сам параметр не доказывает, что каталог находится вне хоста: оператор отвечает за реальное подключение и мониторинг доступности. При недоступном offsite задача завершается ошибкой; `failed.json` и status systemd должны попадать в мониторинг. Не храните пароль шифрования рядом с offsite-копиями.

## Диагностика

Используйте `status-platform.ps1` и ограниченные Docker logs. Ответы API содержат requestId; при ошибке сохраняйте его. В рабочие журналы не следует добавлять тексты программ, пароли, cookie, токены приглашений или содержимое файлов. Зависшая очередь при доступном кабинете проверяется отдельно: private TLS, worker credential, manifest/digest и доступность исполнителя. Не превращайте сбой исполнителя в остановку кабинета и не удаляйте принятые попытки для «очистки» очереди.

При database outage сначала восстановите подключение/диск. При незавершённом импорте изучите его приватный отчёт и продолжите тот же import ID. Не обходите блокировку удалением `import_run` или выключением Flyway. Все команды удаления/восстановления должны явно указывать целевой compose project и отдельные volumes.
