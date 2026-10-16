# Эксплуатация Java / Angular

Платформа состоит из Angular, Spring Boot и PostgreSQL. Java-исполнитель запускается отдельно; только ему доступен Docker. Сайт хранит материалы и сдачи в закрытом хранилище и выдаёт их после проверки прав. Полные проекты ДЗ сохраняются для проверки преподавателем; автоматически выполняются только назначенные упражнения из доверенного каталога.

## Требования

Для запуска собранного сайта нужны Docker Engine с Compose v2 и PowerShell 7.2 или новее. На Windows административные скрипты используют дистрибутив WSL по умолчанию (`wsl --exec docker`) либо указанный в `MENTOR_WSL_DISTRIBUTION`; Docker Desktop должен предоставлять Linux engine выбранному дистрибутиву. Windows PowerShell 5.1 не подходит. Для резервирования нужен GnuPG 2 (`gpg`, `gpgconf`) и `tar`; на Windows GnuPG вызывается в том же выбранном дистрибутиве WSL. Node.js и Python не нужны во время работы сайта.

Для явного выбора на время текущей PowerShell-сессии задайте `$env:MENTOR_WSL_DISTRIBUTION = 'имя из wsl --list --quiet'`. Пустое/отсутствующее значение использует WSL default; неверное имя завершает команду ошибкой без перехода в другой дистрибутив. Docker, GnuPG, соединение backup fence и преобразование путей через `wslpath` используют один выбор. Поддерживаются локальные абсолютные Windows-пути; корень automount берётся из выбранного WSL, `/mnt/<drive>` не предполагается. Linux-скрипты вызывают Docker/GnuPG напрямую.

Смена дистрибутива или его automount может изменить Linux-пути в ранее созданном `compose.env`: проверьте настройки при таком переносе отдельно. Скрипты не переписывают существующую конфигурацию автоматически.

Для сборки нужны JDK 21, Maven Wrapper (Maven 3.9.11), Node.js 24.15.x и npm. Linux wrapper требует `unzip`: нельзя обходить проверку SHA256, подменяя ZIP архивом tar.gz. Версии зависимостей закреплены в `pom.xml` и `frontend/package-lock.json`. На Windows команды сборки выполняются из корня проекта:

```powershell
./mvnw.cmd verify
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run api:generate
npm.cmd --prefix frontend test -- --watch=false
npm.cmd --prefix frontend run build
```

Docker-тесты исполнителя требуют настоящего Linux Docker и Linux-путей для bind mounts. Windows CLI сам по себе не подтверждает эти проверки; используйте Linux checkout и `./mvnw -pl runner verify`. Не запускайте приемочные сценарии против рабочего сайта на порту 4173. Проверки браузера находятся в `frontend/e2e` и `frontend/integration`: вторые требуют отдельной синтетической PostgreSQL/Java среды, а сценарии тренажёра — настоящего исполнителя.

Формат Java backend проверяется Spotless в фазе Maven `validate`: обычные `test`, `package` и `verify`, включая CI и сборку Docker, останавливаются при нарушении формата. Исправление запускается явно: `./mvnw.cmd -pl backend spotless:apply` (Linux: `./mvnw -pl backend spotless:apply`); быстрая проверка без Docker — `./mvnw.cmd -pl backend validate`. Версии Spotless и google-java-format закреплены в `backend/pom.xml`; стиль AOSP применяется только к `backend/src/main/java/**/*.java`. Тесты, сгенерированный код и runner в эту область не входят. LF закреплён в `.gitattributes`, а сам форматтер использует UNIX-переводы строк и работает также в копиях без `.git`. Полное форматирование исходников хранится отдельным style-коммитом.

`npm.cmd --prefix frontend run test:ui -- --project=chromium` проверяет интерфейс с HTTP fixtures на отдельном порту 4202. Его можно переопределить переменной `MENTOR_UI_PORT`; порты 4173 и 4201 запрещены, чтобы не затронуть рабочий кабинет и dev-сервер. UI-отчёт сохраняется в `frontend/playwright-report/`, результаты — в `frontend/test-results/`; при падении сохраняются `trace.zip` и скриншот. Открыть трассу: из `frontend` выполните `npx playwright show-trace <путь-к-trace.zip>`. В CI UI-тесты имеют до двух повторов, отчёты хранятся 7 дней, включая flaky-прохождения.

Наборы `e2e` и `e2e:practice` также сохраняют trace при падении; отчёты лежат рядом с результатами внутри выделенного `.runtime`. Они не повторяются автоматически: повтор требует нового запуска фикстуры, поскольку сценарии меняют данные и создают аккаунты. Трассы содержат запросы и снимки страниц синтетического контура; не добавляйте их в Git и не запускайте запись против рабочего кабинета.

Отчёты покрытия: `npm.cmd --prefix frontend run test:coverage` выполняет Vitest и создаёт `frontend/coverage/mentor/index.html`, `lcov.info` и `coverage-summary.json`. `./mvnw.cmd -pl backend verify` выполняет backend-набор с JaCoCo и создаёт `backend/target/site/jacoco/index.html` и `jacoco.xml`; `-Djacoco.skip=true` отключает агент и отчёт. Агент инструментирует классы приложения; отчёт включает все production-классы backend. Один переиспользуемый Surefire fork заменяет данные предыдущего прогона; при переходе к нескольким fork потребуется отдельная настройка накопления. CI сохраняет отчёты 7 дней. Минимальные проценты не заданы; отчёты фиксируют исходный уровень для следующих задач.

Для настоящего backend подготовьте тестовый classpath (путь замените своим абсолютным путём), затем запустите отдельную синтетическую среду:

```powershell
./mvnw.cmd -pl backend test-compile dependency:build-classpath `
  -Dmdep.outputFile=C:/Projects/mentor/.runtime/browser-fixture-classpath.txt
npm.cmd --prefix frontend run e2e -- --project=chromium
```

`frontend/tools/browser-fixture.mjs` читает classpath из `.runtime/browser-fixture-classpath.txt` в корне репозитория (переопределяется переменной `MENTOR_BROWSER_CLASSPATH_FILE`, каталог классов — `MENTOR_BROWSER_CLASS_ROOT`, по умолчанию `backend/target`) и для каждого набора поднимает отдельные PostgreSQL в Testcontainers, Spring Boot и `ng serve` на свободном порту. Наборы: `task11` (карточка и предпросмотр), `task12` (материалы комплекта), `task13` (сдача ДЗ, повторная отправка с `Idempotency-Key`, ревью), `stage3-real` (материалы из продукта, «Проведено», комментарии к строкам, оценки, этапы маршрута, журнал ходов, «чей ход» и упражнение с размещением «Домашняя работа»), `tenant-isolation` (границы пространств и смена аккаунта в одной вкладке). Один набор запускается так: `npm.cmd --prefix frontend run e2e -- stage3-real.spec.ts --project=chromium`. Скриншоты и `backend.log` остаются в `.runtime/browser-fixtures/synthetic-*/`. Каталог упражнений для `stage3-real` публикует в синтетическое пространство тестовый `support/BrowserPracticeFixture.java` из `training/` с подставным manifest окружений; исполнителя в этом контуре нет, поэтому отправленная попытка остаётся «В очереди», а сценарий только фиксирует смену хода. На FAT32-диске `npm ci` и bind mount Testcontainers не работают: собирайте и запускайте наборы из NTFS-копии репозитория, а исходники правьте в основной.

Этот запуск включает реальные регистрацию, занятия, Markdown, файлы, ДЗ и ревью. Автопроверка Java проходит отдельным обязательным сценарием `e2e:practice` с `MENTOR_PRACTICE_FIXTURE`, указывающим на приватные метаданные выделенного тестового контура с PostgreSQL, private TLS и работающим исполнителем. Обычный `e2e` не является подтверждением запуска Java-кода. Не подставляйте в fixture адрес или credentials рабочего сайта.

После проверок соберите три образа с одним идентификатором релиза. Нужен BuildKit с Docker Buildx (`docker buildx version`); legacy builder с `DOCKER_BUILDKIT=0` не поддерживается:

```powershell
docker buildx build --load -f infra/backend/Dockerfile -t mentor-platform-backend:release-1 .
docker buildx build --load -f infra/frontend/Dockerfile -t mentor-platform-web:release-1 .
docker buildx build --load -f infra/runner-service/Dockerfile -t mentor-platform-runner:release-1 .
```

На Windows используйте эти команды внутри выбранного дистрибутива WSL с его Linux-путём проекта. Образы копируют только executable JAR или собранные публичные Angular-файлы. Старые `dist`, `data`, `private`, снимки и исходники заданий не должны становиться корнем публичной статики.

Корневой `.dockerignore` исключает все файлы данных по умолчанию; служебные Dockerfile/ignore по-прежнему читаются сборщиком. BuildKit применяет отдельный `Dockerfile.dockerignore` рядом с каждым из трёх сервисных Dockerfiles; именно он разрешает нужные исходники и prebuilt-артефакты. Персональные правила заменяют корневые, а не складываются с ними. При новом Dockerfile явно задайте его ограниченный контекст; не добавляйте широкие исключения в корневой файл и не отключайте фильтрацию ради успешного COPY. Разрешённые каталоги исходников, включая `frontend/`, должны содержать только материалы сборки: root fallback не защищает секрет, положенный внутрь разрешённого каталога. Учебные окружения runner собираются в своём минимальном временном каталоге, поэтому корневой ignore на них не влияет.

`pwsh -NoProfile -File infra/tests/docker-context.ps1` проверяет правила настоящим BuildKit на синтетических файлах: root fallback пуст, три профиля содержат необходимые source/prebuilt-файлы и исключают имитации приватных данных. На Windows используется выбранный WSL; тест не читает рабочие данные, не запускает сервисы и не публикует образы. В CI он выполняется в Linux job `images` перед сборкой приложения.

## Сканирование образов перед публикацией

CI собирает backend/web/runner с `push: false`, загружает их в локальный Docker и сканирует по image ID. Дополнительно проверяется закреплённый PostgreSQL из Compose. Trivy 0.76.0 загружается из конкретного релиза GitHub с проверкой SHA256 архива; базы уязвимостей обновляются при запуске. Полные JSON, состав пакетов, image IDs и версия сканера/баз сохраняются в artifact `image-vulnerability-reports` на 7 дней, включая неуспешные проверки.

`infra/check-image-scan.ps1` требует ожидаемый image ID, поддерживаемую схему отчёта и непустой состав OS-пакетов. Backend/runner дополнительно требуют Java-библиотеки из JAR; web — Go-пакеты Caddy; runner — Go-пакеты `/usr/local/bin/docker`. Отсутствие отчёта, ошибка сканера или неполный состав пакетов не считаются успешной проверкой. Любая HIGH/CRITICAL с непустой `FixedVersion` блокирует публикацию. Уязвимости без исправления остаются в полном отчёте и счётчике; исключений нет. Более низкие уровни тоже сохраняются. Настройки из `trivy.yaml` и `.trivyignore` не применяются.

При обновлении зависимостей сверяйте не только теги, но и собранные image IDs. В `pom.xml` временно переопределены Tomcat и оба Jackson BOM в пределах текущих веток Boot 4.1.1; Bouncy Castle закреплён в `backend/pom.xml`. Удалять overrides можно после включения исправлений в Boot BOM и повторных тестов/сканов. Оба JRE Dockerfile пока точечно обновляют `libssl3` до `3.0.2-0ubuntu1.30` по [USN-8847-1](https://ubuntu.com/security/notices/USN-8847-1): официальный закреплённый Jammy-образ содержит `.29`. Если пакет перестанет быть доступен, сборка остановится; обновите pin осознанно. После исправленного upstream digest удалите этот временный слой и повторите скан.

На 15.10.2026 официальный Caddy `2.11.7-alpine` ещё содержит четыре исправимые записи в Go `1.26.8` и `x/net 0.59.0`. Поэтому web Dockerfile собирает тот же Caddy `2.11.7` со стандартными модулями через закреплённый Go `1.26.9` и `x/net 0.60.0`: `infra/caddy/go.mod`/`go.sum`, `GOTOOLCHAIN=local`, `-mod=readonly`. Go на хосте не требуется; обычная сборка не меняет граф зависимостей. Runtime сохраняет официальный Caddy base и capability `cap_net_bind_service`; лицензия копируется в `/opt/mentor/licenses/`. Это [поддерживаемый способ сборки Caddy](https://caddyserver.com/docs/build). При обновлениях согласуйте builder digest и module lock, проверьте список стандартных модулей, smoke и Trivy. Вернуться к upstream-бинарнику можно после появления официального образа с исправлениями и повторного прохождения этих проверок.

Web и job-gateway используют один релизный `mentor-platform-web:${MENTOR_RELEASE}` и один просканированный Caddy binary. Gateway монтирует прежний `Jobs.Caddyfile`, который отдаёт только `/internal/v1/jobs/*`; Angular assets в образе не становятся доступны. `infra/tests/caddy-runtime.ps1 -Image <образ> -NodeExecutable <node>` проверяет один image ID в двух собственных контейнерах: HTTP web, TLS/HTTP1/HTTP2 gateway, передачу заголовков/body, закрытые маршруты, запрет статики и политику кеширования web. Кеширование (FE-13): файлы сборки Angular с хешем в имени (`main-*`, `chunk-*`, `styles-*`, шрифты `media/*`) отдаются с `Cache-Control: public, max-age=31536000, immutable`, отсутствующий хешированный файл — 404 `no-store` (а не страница приложения), Monaco лежит в `frontend/public/vendor/monaco/<версия>/` и тоже отдаётся как immutable; при обновлении Monaco положите его в каталог новой версии и поменяйте `MONACO_BASE` в `frontend/src/app/practice/monaco-loader.service.ts`, старый путь `/vendor/…` вне версии — 404. Страница приложения и прочее — `no-cache`; заголовки безопасности (CSP, Referrer-Policy, Permissions-Policy, nosniff) общие для страницы, файлов сборки и Monaco (воркер Monaco берёт CSP из своего ответа). Нужны Docker и Node на хосте; данные, сертификат, порты и сеть синтетические. CI запускает smoke до сканирования/архивирования; GitHub Actions подтверждается только реальным запуском CI.

Публикующий job имеет `packages: write` и запускается только для тега `release-*` после успешных backend/frontend/infra/image checks. Он получает архив уже проверенных трёх образов, сверяет SHA256 архива и image IDs после `docker load`, затем присваивает GHCR-теги без пересборки. Архив хранится 1 день. Браузерный прогон с настоящим backend, выделенный runner/practice-контур и репетиция миграций остаются отдельными воротами релиза; наличие CI image artifact их не заменяет. Публикация не переключает работающие контейнеры.

Локальная проверка уже собранного образа на Linux с PowerShell 7 и установленным проверенным Trivy той же версии (для остальных образов выберите профиль `web`, `runner` или `postgres`; PostgreSQL проверяется с `--pkg-types os`):

```powershell
$imageId = docker image inspect --format '{{.Id}}' mentor-platform-backend:release-1
if ($LASTEXITCODE -ne 0) { throw 'Image lookup failed' }
$report = Join-Path $PWD 'backend-image-report.json'
trivy image --config /dev/null --timeout 15m --image-src docker --scanners vuln --pkg-types os,library --list-all-pkgs --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL --ignore-unfixed=false --ignorefile /dev/null --format json --output $report $imageId
if ($LASTEXITCODE -ne 0) { throw 'Image scan failed' }
./infra/check-image-scan.ps1 -ReportFile $report -ExpectedImageId $imageId -Profile backend
```

При обновлении digest сначала сверяйте конкретный тег и OCI index в registry, затем пересобирайте и проверяйте итоговый образ: закрепление digest обеспечивает воспроизводимость, но не отсутствие уязвимостей. Проверка PostgreSQL здесь охватывает OS-пакеты; бинарник PostgreSQL, собранный из исходников, не обязательно обнаруживается сканером. Аналогично отсутствие версии main Go module ограничивает покрытие Caddy/Docker. Обновление `training/environments.json` меняет ревизии окружений и требует отдельной подготовки и проверки упражнений; это не обычное обновление сервисного образа.

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

Для переноса через Docker используйте `infra/cutover.ps1`: он выполняет эти проверки, шифрует исходный снимок и проверяет восстановление резервной копии целевой БД и объектов. Задайте явные значения для своего переноса:

```powershell
$transfer = @{
  Snapshot = 'C:/MentorPrivate/cutover/snapshot'
  ImportId = 'legacy-transfer-1'
  TargetWorkspace = 'mentor-workspace'
  TeacherAccount = '<точный id старого преподавателя>'
  EnvironmentManifest = 'C:/MentorPrivate/runner/environments.json'
  EnvironmentManifestSha256 = '<64 символа SHA256 доверенного manifest>'
  EnvironmentProfilesSha256 = '<64 символа SHA256 training/environments.json из снимка>'
  BackendImage = 'mentor-platform-backend:release-1'
}
./infra/cutover.ps1 @transfer -DryRun `
  -ReportDirectory C:/MentorPrivate/cutover/check-1

./infra/cutover.ps1 @transfer -Apply `
  -Approval C:/MentorPrivate/cutover/check-1/approval.json `
  -EnvironmentFile C:/MentorPrivate/platform/compose.env `
  -ProjectName mentor-platform `
  -BackupDestination C:/MentorPrivate/backups `
  -PassphraseFile C:/MentorPrivate/platform/backup-passphrase `
  -ReportDirectory C:/MentorPrivate/cutover/apply-1
```

Каждый каталог отчётов должен быть новым и находиться вне исходного снимка. Режим по умолчанию — dry-run; он не останавливает целевые сервисы и не меняет БД/объекты. Файл `approval.json` действителен 30 минут и связывает проверку с точными исходными файлами, образом, окружениями и выбранными владельцами. Перед apply проверка повторяется. Запущенный и настроенный backend целевого контура должны использовать тот же образ, что и importer.

При apply скрипт удерживает блокировку обслуживания от остановки backend/web до сохранения итогового отчёта. Готовая зашифрованная исходная копия может быть передана через `-SourceBackup <каталог>`; её содержимое и привязки проверяются заново. После успешного импорта **целевой сайт остаётся закрытым**: проверьте отчёт `operation.json`, данные и закрытый тестовый запуск перед явным открытием сайта.

Если importer успел создать незавершённый `import_run`, повторите dry-run в новом каталоге, затем apply с теми же параметрами и `-ResumeReceipt <путь к сохранённому operation.json>`. Скрипт использует проверенную копию целевого контура, сделанную до первой записи. Сохраняйте и подготовленный отчёт при аварийном завершении процесса; без него продолжение требует ручного разбора. Не подменяйте исходную копию резервной копией частично импортированной БД. Если импорт уже завершён, повтор того же ID выполняется без `-ResumeReceipt` и не дублирует записи. Скрипт не переключает ярлык и не запускает старый сайт при ошибке.

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

Для согласованного снимка скрипт останавливает backend, удерживает эксклюзивную SQL-блокировку и экспортированный PostgreSQL snapshot. После завершения `pg_dump` и копирования дампа и объектов в закрытый локальный каталог он проверяет и освобождает SQL-блокировку, затем возобновляет ранее работавший backend. Обход и SHA256 локальных файлов, запись manifest, упаковка, шифрование, offsite и проверка восстановления выполняются после возобновления; блокировка обслуживания удерживается до конца всей операции. Изначально остановленный backend не запускается. Окно остановки всё ещё включает создание и копирование снимка, но уже не зависит от времени его хеширования. Ошибка после возобновления помечает копию неуспешной и очищает локальный stage, не останавливая backend повторно. Отчёт содержит counts и SHA256 объектов, но не их содержимое.

`restore-test.ps1 -Backup <absolute-backup-dir> -PassphraseFile <absolute-file> -BackendImage <release-image>` расшифровывает данные только в новом закрытом временном каталоге, создаёт отдельные БД и object volume, сверяет counts/checksums и доступ UID10001, затем удаляет временные ресурсы. Команда не заменяет рабочую БД. `restore-report.json: completed=true` означает техническую проверку восстановления; вход и скачивание через приложение проверяются дополнительно при переносе/восстановлении рабочего контура.

### Проверка миграций на отдельном снимке (Q-18)

`migration/SnapshotMigrationSmoke.java` — CLI из test-classpath, не входящий в production JAR. Он принимает доверенный PostgreSQL custom dump (`pg_dump --format=custom`) предыдущей схемы, ожидаемый SHA256 и новый путь отчёта. Для копий `backup.ps1` берите `databaseSha256` из расшифрованного `manifest.json` (поле `receipt.sha256` относится к зашифрованному архиву). Подготовка или расшифровка настоящего снимка выполняется оператором отдельно; инструмент не ищет копии, не читает `compose.env` и не подключается к существующей БД. Дамп и отчёт держите вне Git, в закрытом каталоге (NTFS ACL на Windows, 0700/0600 на Linux); не загружайте их в CI artifacts.

Из NTFS checkout текущей версии с JDK 21 и доступным локальным Linux Docker:

```powershell
$smokeRoot = (Get-Location).Path
New-Item -ItemType Directory -Force (Join-Path $smokeRoot '.runtime') | Out-Null
$smokeClasspathFile = Join-Path $smokeRoot '.runtime/migration-smoke-classpath.txt'
./mvnw.cmd -pl backend test-compile dependency:build-classpath "-Dmdep.outputFile=$smokeClasspathFile"
if ($LASTEXITCODE -ne 0) { throw 'Cannot compile migration smoke' }
$smokeClasspath = @(
  (Join-Path $smokeRoot 'backend/target/test-classes'),
  (Join-Path $smokeRoot 'backend/target/classes'),
  (Get-Content -Raw $smokeClasspathFile).Trim()
) -join [IO.Path]::PathSeparator
& (Join-Path $env:JAVA_HOME 'bin/java') -cp $smokeClasspath ru.mentor.platform.migration.SnapshotMigrationSmoke `
  C:/MentorPrivate/rehearsal/database.dump '<SHA256 database.dump: manifest.databaseSha256>' `
  C:/MentorPrivate/rehearsal/migration-report-new.json
if ($LASTEXITCODE -ne 0) { throw 'Migration smoke failed; inspect the private report phase' }
```

На Linux используйте `./mvnw` и абсолютные Linux-пути. Docker должен быть локальным: порт БД публикуется только на `127.0.0.1`. Каждый запуск создаёт собственные PostgreSQL и bridge-сеть, случайный пароль; подключения к сетям приложения и host bind mounts отсутствуют. Bridge-сеть нужна для JDBC из хоста, в том числе Docker Desktop; исходящий трафик она не блокирует, поэтому это не песочница для недоверенного SQL. Снимок копируется после проверки порта и сети, SHA256 повторно проверяется внутри контейнера. Ресурсы этого запуска удаляются при завершении, исходный дамп и отчёт остаются у оператора.

Успех — код 0 и `completed: true` в новом JSON: версии до/после, число миграций, SHA256 и counts таблиц. Проверяются успешная Flyway history и checksums, наличие аккаунтов, применение хотя бы одной новой миграции, сохранение прежних строк history и counts существовавших таблиц, затем второй `migrate()` с нулём миграций и прежними counts/history/schema. Актуальная схема не засчитывается как проверка обновления. Миграция с намеренным изменением числа строк требует отдельной проверки преобразования, а не отключения защиты. Ошибка даёт код 1 и безопасный `phase`, без SQL, значений строк и текста исключения; существующий отчёт не перезаписывается.

`SnapshotMigrationSmokeTest` проверяет заполненный синтетический V14 dump до последней миграции из `db/migration` (с волны 4 — V16): Unicode, приватные/публичные тексты, ревизии, архив и пять индексов V15. Инструмент Q-18 готов; по решению владельца реальный прогон выполняет сам владелец при релизе по шагу «Q-18: smoke миграций на снимке» ниже. Агент не получает доступ к настоящим копиям. Синтетика не заменяет этот релизный прогон. CLI не запускает приложение, не проверяет файлы или вход пользователей и не перезапускает PostgreSQL: он дополняет `restore-test.ps1` и репетицию релиза ниже.

### Восстановление в рабочий контур

`restore-platform.ps1` заменяет данные **работающего** контура содержимым копии `backup.ps1` (`snapshot.tar.gpg` + `receipt.json`). По умолчанию выполняется только dry-run: скрипт сверяет SHA256 шифртекста с `receipt.json`, расшифровывает архив в закрытый каталог внутри `-ReportDirectory`, проверяет состав архива, контрольные суммы дампа и объектов, читает текущие counts рабочей БД, печатает план и записывает `restore-receipt.json` (`mode: dry-run`). Ничего не останавливается и не меняется; dry-run одновременно доказывает, что пароль копий восстановим. Контейнеры проекта должны существовать (хотя бы один запуск `start-platform.ps1`).

```powershell
./infra/restore-platform.ps1 -Backup C:/MentorPrivate/backups/mentor-backup-<метка> `
  -PassphraseFile C:/MentorPrivate/platform/backup-passphrase `
  -EnvironmentFile C:/MentorPrivate/platform/compose.env `
  -ProjectName mentor-platform `
  -ReportDirectory C:/MentorPrivate/restore/check-1

./infra/restore-platform.ps1 -Backup C:/MentorPrivate/backups/mentor-backup-<метка> `
  -PassphraseFile C:/MentorPrivate/platform/backup-passphrase `
  -EnvironmentFile C:/MentorPrivate/platform/compose.env `
  -ProjectName mentor-platform `
  -ReportDirectory C:/MentorPrivate/restore/apply-1 `
  -Apply -PreRestoreBackupDestination C:/MentorPrivate/backups
```

`-Apply` без `-PreRestoreBackupDestination` отклоняется: перед заменой скрипт обязан снять свежую копию текущего состояния через `backup.ps1 -VerifyRestore` — это единственный путь отката. `-SkipPreRestoreBackup` разрешает пропустить её с предупреждением; тогда прежние данные теряются безвозвратно. Каталог `-ReportDirectory` должен быть новым и находиться вне копии.

Порядок apply: блокировка обслуживания (та же, что у `backup.ps1` и `start-platform.ps1`), предварительная копия, `stop backend web`, затем в рабочем томе PostgreSQL `DROP DATABASE mentor WITH (FORCE)` и `CREATE DATABASE`, `pg_restore --no-owner`, сверка counts с манифестом копии; далее том объектов очищается, заполняется из копии, получает владельца UID10001 и проверяется чтением под этим UID и по контрольным суммам. Только после этого скрипт отпускает блокировку, вызывает `start-platform.ps1` и `status-platform.ps1` и пишет итоговый `restore-receipt.json` (`phase: complete`, `status`). Тома `spool`, `web_data`, `web_config` и исполнитель не затрагиваются; очередь проверок возвращается к состоянию копии.

При ошибке после остановки сервисов backend и web **остаются остановленными**, частично восстановленные данные не обслуживаются; `restore-receipt.json` содержит `phase: failed`, путь предварительной копии и `cleanupFailures`. Отката «назад» у скрипта нет: вернуть прежнее состояние можно только повторным `restore-platform.ps1 -Apply` из предварительной копии. Проверка на двойниках Docker/GnuPG: `infra/tests/restore-platform.ps1` (dry-run, отказ без решения об откате, повреждённый шифртекст и архив, сбой apply с закрытым контуром).

Ежедневный запуск: настройте `infra/systemd/mentor-backup.service`, `.timer` и `backup.env.example` под реальные пути. Нужны установленный `/usr/bin/pwsh`, Docker service, пользователь `mentor-ops` и доступ к Docker. Установите unit-файлы с правами 0644 и конфигурацию с 0600. Шаблон запускается в 03:15 по часовому поясу сервера со случайной задержкой до 10 минут. Это systemd-задача, а не автоматизация Codex.

Scheduled-режим требует явный `-OffsiteDirectory`: подключённое хранилище на другом хосте. Он сверяет SHA256 зашифрованной копии, автоматически проверяет восстановление и только после успеха удаляет распознанные завершённые копии старше 14 дней. Незавершённые и неизвестные каталоги не удаляются. Сам параметр не доказывает, что каталог находится вне хоста: оператор отвечает за реальное подключение и мониторинг доступности. При недоступном offsite задача завершается ошибкой; `failed.json` и status systemd должны попадать в мониторинг. Не храните пароль шифрования рядом с offsite-копиями.

### Ежедневная копия на Windows (Task Scheduler)

На Windows-хосте ту же ежедневную задачу регистрирует `infra/windows/register-backup-task.ps1`. Он создаёт задание Планировщика для текущего пользователя, которое запускает `pwsh` (тот же `pwsh.exe`, из которого выполнена регистрация, или `-PwshPath`) с обёрткой `infra/windows/run-backup-task.ps1`; обёртка вызывает `backup.ps1 -Scheduled` и проверяет результат. `-OffsiteDirectory` обязателен: без него регистрация отклоняется с объяснением, потому что `backup.ps1 -Scheduled` без offsite не запускается, а копия на том же диске не переживает потерю машины.

```powershell
./infra/windows/register-backup-task.ps1 -EnvironmentFile C:/MentorPrivate/platform/compose.env `
  -Destination C:/MentorPrivate/backups -OffsiteDirectory Z:/mentor-offsite `
  -PassphraseFile C:/MentorPrivate/platform/backup-passphrase -StartTime 03:15 -DryRun
```

`-DryRun` (или стандартный `-WhatIf`) печатает полный план — имя задачи, время, учётную запись, путь `pwsh`, аргументы, каталог журналов — и ничего не регистрирует; без него задача регистрируется (`-Force`, повторный запуск обновляет её). Параметры: `-TaskName` (по умолчанию `MentorPlatformBackup`), `-StartTime HH:mm` (по умолчанию 03:15 локального времени, как в systemd-таймере), `-LogDirectory` (по умолчанию `<Destination>/task-logs`), `-ProjectName`, `-LogonType Interactive|S4U`. Режим `Interactive` выбран по умолчанию: выбранный WSL и Docker Desktop доступны в сеансе вошедшего пользователя; `S4U` не хранит пароль, но требует проверить, что WSL и Docker Desktop доступны без интерактивного сеанса. Задача запускается при пропуске времени (`StartWhenAvailable`), не дублируется (`IgnoreNew`) и ограничена 2 часами. `-Unregister -TaskName <имя>` удаляет задание, не трогая копии и журналы.

Для задач Task Scheduler выбор `MENTOR_WSL_DISTRIBUTION` должен быть доступен в окружении учётной записи задачи, либо настройте WSL default этого пользователя. Значение `$env:` из открытой консоли не переносится автоматически в будущие запуски планировщика; wrapper работает с `-NoProfile`, поэтому PowerShell profile также не задаёт ему выбор. После устойчивой настройки окружения пользователя проверьте запуск из нового сеанса под тем же principal. Регистрация задачи не меняет WSL default и не сохраняет selector в аргументах.

Результат каждого запуска обёртка пишет в `<LogDirectory>/backup-<utc>.log` (все потоки `backup.ps1`) и `<LogDirectory>/last-run.json` (`ok`, `reason`, `backup`, `failedMarkers`, `log`). Запуск считается успешным, только если `backup.ps1` завершился без ошибки и за это время появился ровно один `receipt.json` с `completed`, `offsiteVerified` и `restoreVerified` = true, а `failed.json` не создавался. Иначе создаётся файл-маркер `<LogDirectory>/ALERT-<utc>.json` (маркеры не удаляются автоматически) и запись в журнал Windows «Application» от источника `MentorPlatformBackup`, событие 1001, уровень Error; успешный запуск пишет событие Information. Создание источника событий требует один раз запустить регистрацию из PowerShell с правами администратора; без этого запись идёт через `eventcreate.exe`, а маркер пишется всегда. Код возврата обёртки 1 при сбое, поэтому `Get-ScheduledTaskInfo -TaskName MentorPlatformBackup` показывает `LastTaskResult` ≠ 0.

Первая проверка после регистрации: `Start-ScheduledTask -TaskName MentorPlatformBackup`, затем прочитайте `last-run.json` и убедитесь, что в `-Destination` и offsite появилась копия с `restoreVerified: true`. Внешних сервисов уведомлений нет: маркер и журнал событий должны проверяться оператором или внешним мониторингом (INF-16). Проверка без Планировщика и Docker: `infra/tests/register-backup-task.ps1`.

## Хранение секретов и пароля копий

`initialize-platform.ps1 -Directory <каталог>` создаёт закрытый каталог конфигурации (0700 / Windows ACL только для пользователя и SYSTEM) с такими файлами:

| Файл | Что это | Где должен жить |
|---|---|---|
| `compose.env` | Параметры Compose: релиз, origin, порты и **абсолютные пути** к файлам секретов. Сам пароль не содержит | На хосте; копия в менеджере паролей для восстановления хоста |
| `secrets/spring.datasource.password` | Пароль PostgreSQL; монтируется в контейнеры `postgres` и `backend` | На хосте (читается контейнерами); копия в менеджере паролей |
| `worker-secrets/worker-credential` | Credential исполнителя; каталог монтируется в `backend` и копируется на хост исполнителя | На хосте платформы и исполнителя; копия в менеджере паролей |
| `backup-passphrase` | Симметричный пароль GnuPG (AES256) для `snapshot.tar.gpg`; одна строка из 64 hex-символов | **Вне хоста и вне каталогов копий**: менеджер паролей и офлайн-носитель. На хосте остаётся рабочий файл для `backup.ps1` |

Рядом с ними появляются служебные `<project>.maintenance.lock` и `<project>.cutover.lock` — это не секреты. Если каталог конфигурации дублируется (например, вторая копия для другого ярлыка), содержимое обеих копий должно совпадать.

Пароль копий — единственное, без чего резервные копии бесполезны. Он не должен храниться рядом с копиями ни локально, ни в offsite-каталоге: тот, кто получит диск или сетевую папку с копиями, получит и ключ, а потеря машины вместе с её диском уничтожит и копии, и пароль одновременно. `backup.ps1`, `restore-test.ps1` и `restore-platform.ps1` читают пароль только из файла, никогда не печатают его и не передают аргументами; `Test-MentorPassphraseFile` требует обычный UTF-8-файл без BOM с одной строкой длиной 32–4096 символов.

Куда переносить: запись в менеджере паролей (название, дата создания, для какого контура, путь к рабочему файлу) и офлайн-копия — USB-носитель или распечатка в запечатанном конверте, физически отдельно от хоста и от offsite-носителя. Сразу после `initialize-platform.ps1` (скрипт напоминает об этом предупреждением) и после каждой ротации.

Как проверить, что пароль восстановим — именно из внешнего хранилища, а не из рабочего файла:

1. Создайте новый закрытый временный файл и запишите в него пароль из менеджера одной строкой без завершающего перевода строки (например, `[IO.File]::WriteAllText($path,$secret,[Text.UTF8Encoding]::new($false))`).
2. На хосте платформы выполните `restore-platform.ps1` в режиме dry-run с этим файлом: он расшифровывает `snapshot.tar.gpg`, сверяет манифест, дамп и объекты, ничего не меняя. Вне хоста (где нет контейнеров платформы) используйте напрямую `sh infra/gpg-file.sh decrypt <файл-пароля> <snapshot.tar.gpg> <новый.tar>` (на Windows — внутри выбранного дистрибутива WSL), затем `tar -tf <новый.tar>` должен показать `manifest.json`, `database.dump`, `objects/`.
3. Удалите временный файл пароля и расшифрованный архив. Отметьте дату проверки в записи менеджера паролей.

Повторяйте проверку после каждой ротации и не реже раза в квартал; удобно совмещать с проверкой `restore-report.json` последней копии.

Чеклист ротации пароля копий:

1. Сгенерируйте новый пароль так же, как инициализация: 32 случайных байта в hex (`[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`), запишите в новый файл рядом со старым (например `backup-passphrase.new`, UTF-8 без BOM, без перевода строки).
2. Сохраните новый пароль в менеджере паролей и на офлайн-носителе с датой; старую запись не удаляйте — пометьте «до <дата> для копий, созданных ранее».
3. Снимите копию с новым файлом: `backup.ps1 ... -PassphraseFile <новый файл> -VerifyRestore`; `receipt.json` должен содержать `restoreVerified: true`.
4. Атомарно замените рабочий файл (`Move-Item <новый> backup-passphrase -Force`); на Linux восстановите права 0600. Если путь файла изменился, заново зарегистрируйте задачу (`register-backup-task.ps1` или systemd `backup.env`).
5. Старые копии остаются зашифрованными старым паролем: храните старую запись, пока существует хоть одна такая копия (по умолчанию scheduled-режим удаляет завершённые копии через 14 дней; ручные копии и копии переноса `cutover.ps1` живут дольше). Чтобы избавиться от старого пароля раньше, снимите свежую копию новым паролем и удалите старые каталоги вручную.
6. Удалите временные файлы и проверьте восстановимость нового пароля по шагам выше.

Пароль PostgreSQL и credential исполнителя ротируются отдельно (INF-10): для них контейнеры читают файлы при запуске/обращении, поэтому замена требует согласованного перезапуска.

## Обновление и откат релиза

Процедура проверена при обновлении локального кабинета 12 октября 2026 года; используйте её для каждого релиза. Перед началом: `git status --short` чист, выполнены ворота релиза (`docs/team/2026-10-15-team-and-backlog.md`, раздел 6), миграции Flyway добавлены новыми файлами, а не изменены.

1. **Копия текущего состояния.** `backup.ps1 ... -VerifyRestore` (раздел «Копии и восстановление»). Путь появившегося каталога `mentor-backup-<метка>` — точка отката; `receipt.json` должен содержать `restoreVerified: true`. Пока копия не готова, дальше не идите.

2. **Сборка образов с одним `MENTOR_RELEASE`.** Соберите JAR и Angular командами раздела «Требования» (`./mvnw.cmd -pl backend verify`, `npm.cmd --prefix frontend run build`), затем три образа с одним тегом (команды `docker buildx build --load` в том же разделе; `Dockerfile` копируют `backend/target/backend-0.1.0-SNAPSHOT.jar`, `frontend/dist/mentor/browser/` и `runner/target/runner-0.1.0-SNAPSHOT.jar`). Образ исполнителя пересобирается, только если менялся `runner/`; иначе исполнитель остаётся на своём релизе. Ловушки CRLF на Windows: `infra/gpg-file.sh` и `mvnw` закреплены в `.gitattributes` как LF — с CRLF ломаются шифрование копий и Linux-сборка; ресурсы `runner/src/main/resources/harness/` с CRLF меняют digest окружений, поэтому исполнитель собирается только из LF-checkout (например, клон внутри WSL), а не из рабочей копии с `core.autocrlf=true`. Контрольные суммы Flyway от переводов строк не зависят. Сборка на FAT32-диске ненадёжна: собирайте из NTFS-копии или из Linux-checkout.

3. **Q-18: smoke миграций на снимке.** Выполняет владелец перед переключением кабинета; агенту доступ к настоящим копиям не выдаётся. Из свежей копии шага 1 владелец отдельно расшифровывает `database.dump` и `manifest.json` в закрытый каталог вне Git. SHA256 берётся из `manifest.databaseSha256`, а не из receipt зашифрованного архива. Из NTFS checkout нового релиза с JDK 21 и локальным Linux Docker выполните (пути к расшифрованным файлам замените своими):

   ```powershell
   $q18Root = (Get-Location).Path
   $q18Dump = 'C:/MentorPrivate/rehearsal/database.dump'
   $q18Manifest = 'C:/MentorPrivate/rehearsal/manifest.json'
   $q18Report = 'C:/MentorPrivate/rehearsal/migration-report-new.json' # Новый, ещё не существующий файл.
   $q18Sha256 = (Get-Content -LiteralPath $q18Manifest -Raw | ConvertFrom-Json).databaseSha256
   New-Item -ItemType Directory -Force (Join-Path $q18Root '.runtime') | Out-Null
   $q18ClasspathFile = Join-Path $q18Root '.runtime/migration-smoke-classpath.txt'
   ./mvnw.cmd -pl backend test-compile dependency:build-classpath "-Dmdep.outputFile=$q18ClasspathFile"
   if ($LASTEXITCODE -ne 0) { throw 'Cannot compile Q-18 migration smoke' }
   $q18Classpath = @(
     (Join-Path $q18Root 'backend/target/test-classes'),
     (Join-Path $q18Root 'backend/target/classes'),
     (Get-Content -LiteralPath $q18ClasspathFile -Raw).Trim()
   ) -join [IO.Path]::PathSeparator
   & (Join-Path $env:JAVA_HOME 'bin/java') -cp $q18Classpath ru.mentor.platform.migration.SnapshotMigrationSmoke `
     $q18Dump $q18Sha256 $q18Report
   if ($LASTEXITCODE -ne 0) { throw 'Q-18 failed; inspect the private report phase' }
   if (-not (Get-Content -LiteralPath $q18Report -Raw | ConvertFrom-Json).completed) { throw 'Q-18 report is incomplete' }
   ```

   Ожидается код 0 и `completed: true` в новом отчёте: применена хотя бы одна новая миграция, прежние counts/history сохранены, повторный `migrate()` применил 0 миграций без изменения схемы. Актуальная схема не считается проверкой обновления. Инструмент создаёт и удаляет только собственную временную PostgreSQL; рабочая БД не меняется. Отчёт и dump остаются у владельца вне Git/CI artifacts. Ошибка блокирует переключение релиза; не отключайте проверки и не подменяйте её синтетическим прогоном. Этот шаг дополняет проверку приложения в следующем пункте.

4. **Репетиция на временной БД.** Новый backend должен мигрировать копию рабочих данных до запуска в рабочем контуре. Вариант со штатными скриптами: инициализируйте временный контур с новым релизом и свободным портом (`initialize-platform.ps1 -Directory <временный> -PublicOrigin http://127.0.0.1:<порт> -Release <новый>`), добавьте в его `compose.env` другую подсеть (`MENTOR_WEB_SUBNET`, `MENTOR_PROXY_IP`, `MENTOR_BACKEND_IP`, `MENTOR_PROXY_IP_REGEX`, как в `infra/tests/cutover-integration.ps1`) и свободный `MENTOR_HTTPS_PORT` вместо 8443, который занят рабочим контуром, запустите его `start-platform.ps1 -ProjectName <временный проект>`, затем `restore-platform.ps1 -Apply -SkipPreRestoreBackup` копией из шага 1 **с `-EnvironmentFile` и `-ProjectName` временного контура**. Скрипт восстановит старую схему и объекты, а финальный `start-platform.ps1` поднимет новый backend, который применит миграции. Критерии: `restore-receipt.json` временного контура `completed: true`, в `docker compose ... logs backend` Flyway сообщает об успешном применении новых версий без ошибок, `status-platform.ps1` временного контура выдаёт `ready: true`, счётчики существующих таблиц (`Get-MentorTableCounts` из `platform-common.ps1` или `restoredCounts` в receipt) не изменились, вход и открытие занятия работают по временному origin. После проверки удалите временный контур целиком: `docker compose --env-file <временный env> -f infra/compose.platform.yaml --project-name <временный проект> down --volumes`. Ручной вариант (так делалось 12 октября): `pg_dump` рабочей БД, временный PostgreSQL с теми же тегом и digest, что у сервиса `postgres` в текущем `infra/compose.platform.yaml`, `pg_restore --no-owner`, запуск нового образа backend с переменными окружения сервиса `backend` из `compose.platform.yaml`, указывающими на временную БД и временные файлы секретов, сверка счётчиков до и после; прямой запрос `/api/v1/auth/session` к такому backend требует заголовок `Host`, равный `MENTOR_PUBLIC_ORIGIN`. Ни один из вариантов не должен указывать на рабочие `--project-name`, подсеть или порт.

5. **Смена `MENTOR_RELEASE`.** В `compose.env` рабочего контура измените только значение `MENTOR_RELEASE=<новый>`, сохранив кодировку и переводы строк файла. Если каталог конфигурации существует в двух копиях (на этой машине — `E:\mentor-site\.runtime\platform\compose.env`, который читает `Start-Mentor.cmd`, и `%LOCALAPPDATA%\MentorPlatform\platform\compose.env`), измените обе: запуск со второй копии с прежним значением откатит образы без предупреждения. Запишите прежнее значение — оно нужно для отката.

6. **Запуск и проверка.** `start-platform.ps1 -EnvironmentFile <env>` выполняет `compose up --detach --no-build postgres backend web` (контейнеры backend и web пересоздаются из новых образов, тома сохраняются) и ждёт `200` от `/api/v1/auth/session` (до 120 попыток с шагом 0,5 с); успех — строка `Platform ready: <origin>`. Затем `status-platform.ps1 -EnvironmentFile <env>`: успех — JSON с `ready: true`, `database: "up"`, `web: "ready"` и код возврата 0; `worker: "unavailable"` означает лишь, что исполнитель не отмечался последние 60 секунд, и не блокирует релиз. Дополнительно: в логах backend нет ошибок Flyway, вход преподавателя и ученика, открытие занятия, скачивание файла, страница тренажёра. Если `start-platform.ps1` не дождался готовности, он сообщает об этом и ничего не откатывает — переходите к пункту 7.

7. **Откат.**
   - *Возврат образов.* Верните прежнее `MENTOR_RELEASE` в обоих `compose.env` и снова выполните `start-platform.ps1`. Flyway в `application.yaml` не настраивается, действуют значения по умолчанию: `validateOnMigrate=true` и `ignoreMigrationPatterns=*:future`, поэтому старый JAR считает уже применённые более новые версии «будущими», игнорирует их и запускается. Такой откат корректен, только если новые миграции были аддитивными: новые таблицы, nullable-колонки или колонки со значением по умолчанию, индексы. Откат образом **невозможен**, если миграция удалила или переименовала таблицы и колонки, которые читает старый код, изменила типы, добавила `NOT NULL` без умолчания в таблицы, куда старый код пишет, переписала данные в новый формат, либо новый код успел записать данные, которые старый код трактует иначе. Такие миграции отмечайте в описании релиза заранее. Изменённый файл уже применённой миграции ломает запуск любой версии (проверка контрольных сумм) — не редактируйте применённые миграции и не отключайте Flyway.
   - *Возврат данных.* Если откат образом невозможен или после обновления данные повреждены: верните прежнее `MENTOR_RELEASE`, затем `restore-platform.ps1 -Apply -PreRestoreBackupDestination <каталог копий>` с копией из шага 1 (раздел «Восстановление в рабочий контур»). Скрипт сам снимет копию текущего состояния, заменит БД и объекты и запустит контур прежним релизом. Данные, созданные после обновления, в рабочем контуре теряются; они остаются только в предварительной копии, снятой этим шагом.

Во время всей процедуры блокировка обслуживания исключает параллельные `backup.ps1`, `start-platform.ps1` и `cutover.ps1` для того же контура; запланированная копия, попавшая на окно обновления, завершится ошибкой и создаст алерт — это ожидаемо, повторите её вручную после проверки.

## Диагностика

Используйте `status-platform.ps1` и ограниченные Docker logs. Ответы API содержат requestId; при ошибке сохраняйте его. В рабочие журналы не следует добавлять тексты программ, пароли, cookie, токены приглашений или содержимое файлов. Зависшая очередь при доступном кабинете проверяется отдельно: private TLS, worker credential, manifest/digest и доступность исполнителя. Не превращайте сбой исполнителя в остановку кабинета и не удаляйте принятые попытки для «очистки» очереди.

При database outage сначала восстановите подключение/диск. При незавершённом импорте изучите его приватный отчёт и продолжите тот же import ID. Не обходите блокировку удалением `import_run` или выключением Flyway. Все команды удаления/восстановления должны явно указывать целевой compose project и отдельные volumes.
