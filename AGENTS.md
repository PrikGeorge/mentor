# Навигация по проекту для ИИ-агентов

Эта карта относится ко всему репозиторию. Пути ниже указаны относительно его корня. Проверено по исходникам 11 октября 2026 года.

## Быстрый старт: что читать сначала

1. [README.md](README.md) — назначение платформы, пользовательские сценарии и состояние перехода на Java / Angular.
2. Найдите нужную область в разделах ниже и откройте её исходники и соседние тесты.
3. [docs/operations/java-angular.md](docs/operations/java-angular.md) — подготовка окружения, запуск, приёмочные проверки, эксплуатация и перенос данных.
4. Перед правками выполните `git status --short`: в рабочей копии могут быть незакоммиченные изменения и новые файлы. Они тоже являются частью проекта; сохраняйте чужие изменения.

**Актуальная реализация: `frontend/` + `backend/` + `runner/`.** Корневые `server.cjs`, `lib/`, `dist/` и `test/` относятся к прежнему Node-кабинету. Корневой `dist/` и `frontend/dist/` — разные приложения.

Это платформа наставника: администратор приглашает преподавателей, преподаватель ведёт учеников и занятия, ученик читает материалы, решает упражнения и сдаёт ДЗ. PostgreSQL хранит данные и очередь проверок; приватное хранилище — файлы. Полные проекты ДЗ проверяет преподаватель, автоматически выполняются только упражнения из доверенного каталога.

## Карта каталогов

- [backend/](backend/) — Java 21 / Spring Boot 4.1, HTTP API, права доступа, PostgreSQL, файлы, очередь и импорт старых данных.
- [frontend/](frontend/) — Angular 22 / TypeScript 6, интерфейс и браузерные тесты. Исходники: `frontend/src/`; публичные ресурсы: `frontend/public/`.
- [runner/](runner/) — отдельный Java-процесс: получает задания от backend и выполняет их в Linux Docker.
- [contracts/](contracts/) — OpenAPI публичного API и внутреннего протокола исполнителя.
- [infra/](infra/) — Dockerfiles (multi-stage: `JAR_SOURCE`/`DIST_SOURCE` = build внутри образа или prebuilt с хоста), `infra/caddy/` — закреплённый модуль стандартного Caddy (Go только внутри builder, go.mod/go.sum); один просканированный web-образ обслуживает web и job-gateway с разными Caddyfile. Compose с лимитами ресурсов и healthcheck (backend по `/actuator/health/readiness`, web по внутреннему `/healthz`), Caddy (HSTS только на TLS, Permissions-Policy), PowerShell-скрипты запуска, переноса, резервирования, восстановления в рабочий контур (`restore-platform.ps1`, по умолчанию dry-run), выпуска TLS gateway (`issue-job-tls.ps1`), ротации пароля PostgreSQL (`rotate-database-password.ps1`, dry-run по умолчанию) и алертов (`notify.ps1`, `status-alerts.ps1`); `infra/windows/` — задачи Task Scheduler для ежедневной копии и проверки статуса каждые 10 минут; проверки скриптов на моках в `infra/tests/`. CI — [.github/workflows/ci.yml](.github/workflows/ci.yml).
- [training/](training/) — доверенный каталог упражнений, Java-заготовки и профили окружений для текущей платформы; также содержит прежний проверяющий Java-мост.
- [content/](content/) — исходные учебные Markdown/Java-материалы прежнего кабинета. Изменение файла здесь само по себе не обновляет записи текущей платформы в PostgreSQL.
- [docs/operations/](docs/operations/) — эксплуатационная документация, включая [disaster-recovery.md](docs/operations/disaster-recovery.md) (сценарии сбоев и ротация секретов); [docs/legacy/](docs/legacy/) — прежняя Node-инструкция; [docs/team/](docs/team/) — состав команды и сводный бэклог доработок по ролевым аудитам.
- [promo/](promo/) — маркетинговые материалы вне платформы: `promo/mentorship-reel/` — отдельный Remotion-проект вертикального ролика (свои `package.json` и `node_modules`, с `frontend/` не связан).
- [docs/superpowers/specs/](docs/superpowers/specs/) и [docs/superpowers/plans/](docs/superpowers/plans/) — дизайн и история реализации, полезные для понимания решений.
- `data/`, `private/`, `.runtime/` — локальные данные, закрытые материалы, конфигурация, кеши и артефакты работы. Для обычной навигации их содержимое читать не требуется.

Версии и зависимости: [pom.xml](pom.xml), [backend/pom.xml](backend/pom.xml), [runner/pom.xml](runner/pom.xml), [frontend/package.json](frontend/package.json), [frontend/package-lock.json](frontend/package-lock.json). Maven-модули — `backend` и `runner`, wrapper — `mvnw` / `mvnw.cmd` и `.mvn/`.

## Точки входа и связи

- **Запуск готового сайта на Windows:** [Start-Mentor.cmd](Start-Mentor.cmd) → [start-local.ps1](start-local.ps1) → [infra/start-platform.ps1](infra/start-platform.ps1) → [infra/compose.platform.yaml](infra/compose.platform.yaml). Требуются подготовленные настройки и образы; ярлык не собирает проект и не импортирует данные.
- **Браузер:** [frontend/src/main.ts](frontend/src/main.ts) → [app.config.ts](frontend/src/app/app.config.ts) и [layout/shell.component.ts](frontend/src/app/layout/shell.component.ts); URL определены в [app.routes.ts](frontend/src/app/app.routes.ts). Основные ветки: `/admin/teachers`, `/teacher/students`, `/teacher/schedule`, `/learn`. Все экраны после входа — ленивые чанки (`loadComponent`), в начальном бандле только вход и оболочка.
- **HTTP:** Angular → `/api/v1` → Spring Boot. [infra/proxy/Caddyfile](infra/proxy/Caddyfile) отдаёт Angular и проксирует API. В разработке [frontend/proxy.conf.json](frontend/proxy.conf.json) связывает Angular `4201` с backend `8081`.
- **Backend:** [MentorApplication.java](backend/src/main/java/ru/mentor/platform/MentorApplication.java). Без аргументов запускает сервер; режимы `admin`, `catalog`, `legacy-import` — отдельные административные команды. Настройки: [application.yaml](backend/src/main/resources/application.yaml).
- **Проверка упражнения:** backend `practice/AttemptService.java` → `practice/JobQueue.java` → внутренний `/internal/v1` → runner → результат и история в backend. Внутренний gateway: [infra/proxy/Jobs.Caddyfile](infra/proxy/Jobs.Caddyfile).
- **Runner:** [RunnerApplication.java](runner/src/main/java/ru/mentor/runner/RunnerApplication.java) → `JobClient.java`, `ContainerExecutor.java`, `SourceStaging.java`, `ResultVerifier.java` в том же пакете. Подготовка окружений — `EnvironmentBuilder.java` и режим `--prepare`. Развёртывание: [infra/compose.runner.yaml](infra/compose.runner.yaml).

## Где искать нужное изменение

### Интерфейс

Все пути в этом подразделе — внутри [frontend/src/app/](frontend/src/app/).

- `auth/`, `admin/` — вход, приглашения, пароли, управление преподавателями.
- `core/session.store.ts`, `core/session.interceptor.ts`, `core/role.guard.ts` — состояние сессии, HTTP и навигация по ролям; `core/platform-api.service.ts` — общие запросы API. `core/bound-scope.ts` — фиксированный владелец компонента и привязка к inputs: `current`/`active`, явный `bind` в точке сброса, `capture` для Promise и `track` для Observable (отмена при смене привязки, сессии и destroy). Роли, workspace и запрет записи в preview проверяет вызывающий компонент.
- `core/read-resource.ts` — загрузки через Angular `rxResource`: чистый снимок параметров, состояния idle/loading/resolved/error, отмена через bound scope, исходная ошибка и повтор загрузки. Loaders не меняют UI; локальные effects сбрасывают формы и применяют результат. Мутации, загрузка файлов и опрос попыток остаются отдельными операциями. В unit-тестах `students/domain-test-support.ts::renderResources` применяет первый асинхронный результат, не ожидая ещё не отвеченных HTTP-запросов.
- `layout/` — оболочка (шапка с разделами роли, меню профиля, мобильное меню, шапка и вкладки открытого занятия, баннер предпросмотра) и контекст пространства; глобальные стили — [frontend/src/styles.scss](frontend/src/styles.scss).
- Визуальный язык — дизайн-система «Наставник», направление D «Партия» (токены, правила и экраны — в Claude Design). Имена CSS-переменных в `styles.scss` совпадают с токенами (`--surface`, `--ink`, `--accent`…); тёмная тема — класс `.theme-dark` (тренажёр, выбор хранится в `localStorage` как настройка отображения). Иконки Lucide — `core/icon.component.ts` (`<mentor-icon name="…"/>`); шрифты Old Standard TT, Fira Sans, PT Mono подключены из `@fontsource` в `frontend/angular.json` (CSP не пускает внешние шрифты). Маркировка видимости: штриховка и «Только вам» — то, что ученик не видит.
- `students/` — список и карточка ученика; карточку используют также маршруты `/learn/students/...`. Общий контекст student/lesson/preview/editable — `students/domain-page.ts`, выбранный ученик и занятие — `layout/workspace-context.ts`. `student/` — главная страница ученика и вкладки (`student-navigation.component.ts`: вкладки карточки ученика у преподавателя и разделы открытого занятия у обеих ролей); это отдельная папка.
- `lessons/` — создание занятия и его страница, «Создать на основе» (форма `lesson-form` с входом `source`: выбор ученика и сводка копируемого); `editor/` — Markdown, импорт текста и предпросмотр.
- `schedule/` — расписание преподавателя `/teacher/schedule` (пункт шапки «Расписание»): «Сегодня» и «Неделя» по МСК, неделя в query `?view=week&from=`; календарная арифметика — `schedule-dates.ts`.
- `materials/` — чтение материалов и навигация по документам; `material-form.component.ts` — форма преподавателя для добавления документа или файла (отложенный чанк), удаление — в `material-view.component.ts`; `legacy-blocks.component.ts` отображает импортированные блоки внутри актуального приложения.
- `homework/`, `reviews/` — сдачи ДЗ (файлом или текстом: `homework/text-answer.ts` превращает введённый ответ в обычный однофайловый `.java`/`.md`, backend не различает способы), отзывы и оценки преподавателя (`homework/grade.component.ts`: знак оценки всегда со словом), часы «чей ход» (`homework/turn-clock.component.ts`: ход определяет последняя сдача занятия или отправленная попытка упражнения с размещением «Домашняя работа», `kind` хода — `homework`/`attempt`; ученик видит колонку ходов в своих занятиях).
- `roadmap/` — этапы маршрута ученика: просмотр и редактор преподавателя с ревизией. `journal/` — журнал «Ходы» на карточке и главной ученика. `comments/` — комментарии преподавателя к строкам кода: текстовая сдача ДЗ и попытка тренажёра. Статус занятия «Проведено / Подготовлено / Запланировано» — `lessons/lesson-status.ts` (ученик вместо неотмеченного прошедшего видит «Прошло»); напоминание «Отметьте проведённые» за 14 дней на расписании и строка на «Мои ученики» — `schedule/reminder.ts`.
- `practice/` — тренажёр, редактор кода, черновики и опрос попыток; выход с несохранённым кодом — `core/practice-exit.service.ts`.
- `core/legacy-route.adapter.ts` — совместимость старых ссылок. Слово `legacy` в имени отдельного файла не означает, что его можно удалить из текущего приложения.

### Сервер и данные

Java-пакеты расположены внутри [backend/src/main/java/ru/mentor/platform/](backend/src/main/java/ru/mentor/platform/). Обычная цепочка: контроллер → сервис → репозиторий с `JdbcTemplate`; текущая реализация не использует ORM.

- `identity/` — аутентификация, сессии, приглашения, пароли, административная CLI; начать с `AuthController.java`, `AuthService.java`, `SecurityConfiguration.java`. Лимиты `AuthRateLimiter`: чтения auth-маршрутов считаются только по адресу клиента (600/мин), записи — общий бюджет 120/мин плюс per-IP; логин блокируется после 20 неверных паролей за 15 минут, счётчик растёт только после проверки пароля. `/actuator/health/**` открыт без сессии для проб контейнера, остальной actuator не публикуется.
- `workspaces/` — пространства преподавателей и границы доступа; ключевой файл `WorkspaceAccess.java`.
- `students/` — карточки учеников, архив (`archived_at`: карточка вне списков и очереди, ученик читает, но не сдаёт), сводка списка одним запросом `GET /students/dashboards` (карточки страницы с числом занятий и ближайшим занятием, считает `LessonService.dashboards`); `lessons/` — занятия, тексты, создание на основе другого занятия (`source` в POST: копия сценария, заданий ученика и активных упражнений в той же транзакции), расписание преподавателя (`ScheduleController`/`ScheduleService`: `GET /workspaces/{id}/schedule?from&to`, окно до 31 дня, только активные карточки и только преподаватель пространства), номер занятия, отметка «Проведено», статус `planned`/`prepared` и удаление пустого занятия (DELETE, 409 при работах/материалах/черновиках); `materials/` — чтение и публикация материалов (POST документа или файла, DELETE; Markdown рендерит `MarkdownDocument` на сервере в тот же payload, что и скрипты комплектов; первый материал переводит занятие в `prepared`); `homework/` — сдачи, ревью, оценки, текст однофайловых работ и «чей ход» (`HomeworkTurnController`); срок ДЗ хранится в занятии (`homeworkDue`, состояние считает `LessonService`), подписи — `frontend/src/app/homework/homework-due.ts`. В этих пакетах искать соответствующие `*Controller`, `*Service`, `*Repository`.
- `roadmap/` — этапы маршрута ученика (GET/PUT с `revision`). `journal/` — журнал ходов только для чтения: `MoveRepository` объединяет сдачи, ревью, попытки тренажёра и проведённые занятия. `comments/` — комментарии к строкам кода; создаёт и удаляет только преподаватель-владелец карточки. Цель комментария — текстовая сдача `.java`/`.txt`/`.md` до 256 КиБ или попытка тренажёра. ZIP-проекты по-прежнему не распаковываются.
- Список занятий и `dashboard.focus.lesson` используют `LessonSummary`: метаданные и `hasStudentNotes`, без текстов. `LessonRepository` вычисляет наличие заданий в SQL; сводка списка учеников читает занятия только для карточек текущей страницы. Полные тексты остаются в detail/create/update занятия и `/texts/{kind}`.
- `MaterialRepository` фильтрует видимость материалов и выполняет пагинацию в SQL; страница, `total` и ссылки `viewData` используют общий фильтр привязки, аудитории и опубликованного комплекта. Прямое чтение и скачивание дополнительно проверяет `MaterialService.authorize`.
- `files/` — проверка доступа к объектам, загрузка и выдача файлов; `BlobStore.java` задаёт интерфейс, `LocalBlobStore.java` и `S3BlobStore.java` — реализации.
- `practice/` — каталог и версии упражнений (`CatalogService`), назначения (`AssignmentService`), черновики (`DraftService`), попытки (`AttemptService`), очередь (`JobQueue`), история (`PracticeHistoryService`), внутренний API (`JobController`, `RunnerSecurity`).
- `migration/` — импорт Node-данных и блокировка незавершённого переноса. Это действующая служебная часть Java-приложения.
- `shared/` — текущий пользователь (`Actor`), пагинация, формат ошибок и обработчики исключений: 5xx и ошибки БД пишутся в лог с `requestId` (он же в MDC и в заголовке `X-Request-ID`), нарушение ограничения БД — 409 `CONFLICT`, недоступность хранилища — 503.
- [backend/src/main/resources/db/migration/](backend/src/main/resources/db/migration/) — SQL-миграции Flyway: identity → пространства/ученики → занятия → файлы → ДЗ → каталог/черновики → очередь → импорт → оценки ДЗ → проведённые занятия → этапы маршрута → комментарии к коду → идемпотентность ДЗ → архив → индексы → срок ДЗ (V16). Изменения схемы оформляйте новой миграцией.

### Контракты и учебные упражнения

- [contracts/openapi.yaml](contracts/openapi.yaml) → `npm.cmd --prefix frontend run api:generate` → [frontend/src/app/api/schema.d.ts](frontend/src/app/api/schema.d.ts). Схему TypeScript не редактировать вручную; `npm.cmd --prefix frontend run api:check` падает, если она отстала от контракта. Серверные контроллеры/DTO поддерживаются вручную; `shared/ContractRouteCoverageTest` проверяет, что каждый маршрут контроллеров есть в контракте и наоборот.
- [contracts/runner.openapi.yaml](contracts/runner.openapi.yaml) → Maven-плагин в `runner/pom.xml` → `runner/target/generated-sources/openapi/`. Сгенерированные DTO исполнителя не править вручную.
- [training/catalog.json](training/catalog.json) — условия, версии, тесты и заготовки упражнений; [training/environments.json](training/environments.json) — фиксированные зависимости и контрольные суммы; [training/exercises/](training/exercises/) — Java-заготовки.
- [runner/src/main/resources/harness/](runner/src/main/resources/harness/) — актуальные `TrustedHarness.java`, Dockerfile, Java policy и ограничитель времени. `EnvironmentBuilder` берёт ресурсы отсюда. [training/runner/TrustedHarness.java](training/runner/TrustedHarness.java) — прежняя копия для Node-runner; её изменение не обновляет текущий Java-worker.
- Публикация каталога в текущий backend идёт через `practice/CatalogCommand.java` с явным workspace и проверенным manifest окружений. При изменении задания учитывайте его revision и уже сохранённые назначения/попытки.

## Команды и проверки

Команды ниже выполняются **из корня репозитория**. Для сборки нужны JDK 21 и Node.js `>=24.15.0 <25`; для инфраструктуры — PowerShell 7.2+ и Docker. На Windows используется Linux engine Docker Desktop с доступом из WSL default или дистрибутива `MENTOR_WSL_DISTRIBUTION`. Общий selector и преобразование путей через его `wslpath` — `infra/platform-common.ps1`; Windows mock-проверки — `infra/tests/platform-common.ps1`. Для Task Scheduler selector задаётся в окружении учётной записи задачи (см. эксплуатационную инструкцию). Backend-тесты с PostgreSQL используют Testcontainers и также требуют Docker.

```powershell
./mvnw.cmd -pl backend verify
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run api:generate
npm.cmd --prefix frontend test -- --watch=false
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run lint
```

Для portable Node на Windows используйте [infra/use-node.ps1](infra/use-node.ps1) с абсолютным `-NodeDirectory`: пример настройки есть в [frontend/README.md](frontend/README.md). Скрипт выбирает поддерживаемый Node только на время команды. Источник npm-команд — `frontend/package.json`.

- **Разработка UI:** `npm.cmd --prefix frontend run start -- --host 127.0.0.1`. Backend настраивается отдельно; `MENTOR_PUBLIC_ORIGIN` должен точно соответствовать адресу браузера, например `http://127.0.0.1:4201`.
- **Backend:** тесты по доменным пакетам — в [backend/src/test/java/ru/mentor/platform/](backend/src/test/java/ru/mentor/platform/). HTTP-тесты используют общий `support/HttpTestRuntime.java` со сбросом данных, сессий, файлов и runner-настроек; отдельные PostgreSQL-контуры — `support/PostgresTest.java`. Формат production Java проверяет Spotless в фазе `validate` (также при `test`, `package`, `verify`); исправление — `./mvnw.cmd -pl backend spotless:apply`. Конфигурация в [backend/pom.xml](backend/pom.xml), область — только `backend/src/main/java`, google-java-format AOSP, LF закреплён в `.gitattributes`. Полное форматирование оформляйте отдельным style-коммитом. `migration/SnapshotMigrationSmoke.java` — test-classpath CLI миграций доверенного custom dump в новой PostgreSQL (явные dump/SHA256/новый report, собственная bridge-сеть и loopback-порт); `SnapshotMigrationSmokeTest` проверяет его на синтетике. Настоящий снимок предоставляет оператор отдельно; команды и границы — в разделе Q-18 эксплуатационной инструкции.
- **Angular unit:** `*.spec.ts` рядом с исходниками; Vitest настраивается через [frontend/angular.json](frontend/angular.json). **Lint:** ESLint с angular-eslint (`frontend/eslint.config.js`, префикс селекторов `mentor`), Prettier по `frontend/.prettierrc` (ширина 160, одинарные кавычки); форматирование применяется к файлу при его правке, массового переформатирования не было.
- **Покрытие:** `npm.cmd --prefix frontend run test:coverage` создаёт HTML, LCOV и JSON summary в `frontend/coverage/mentor/`; обычный `test` остаётся без покрытия. `./mvnw.cmd -pl backend verify` создаёт JaCoCo HTML/XML в `backend/target/site/jacoco/` (один переиспользуемый Surefire fork, агент только для `ru.mentor.platform.*`). CI сохраняет оба отчёта 7 дней; порог покрытия пока не задан.
- **UI с HTTP fixtures:** `npm.cmd --prefix frontend run test:ui -- --project=chromium`; сценарии в [frontend/e2e/](frontend/e2e/), конфигурация — `frontend/playwright.config.ts`. Выделенный порт — `4202`, переопределяется `MENTOR_UI_PORT` (4173 и 4201 запрещены). Нужен установленный Chromium для Playwright. Общие UI-фикстуры — `frontend/e2e/fixtures.ts` (проверка pageerror в каждом тесте, синтетическая сессия); вход и меню аккаунта для UI/real — `frontend/testing/browser-session.ts`. Сценарии ошибок auth/CSRF хранят свои обработчики. Все браузерные наборы сохраняют trace и скриншот при падении и HTML-отчёт без автооткрытия; UI — в `frontend/test-results/` и `frontend/playwright-report/`, реальные сценарии — в своём `.runtime`. Только UI-фикстуры повторяются до двух раз в CI; real/practice требуют нового запуска с чистым контуром.
- **Браузер с настоящим backend:** `npm.cmd --prefix frontend run e2e -- --project=chromium`; сценарии в [frontend/integration/](frontend/integration/), запуск — `frontend/tools/browser-fixture.mjs`. Сначала скомпилируйте `support/BrowserFixture.java` и запишите classpath в `.runtime/browser-fixture-classpath.txt` по эксплуатационной инструкции. Каждый набор использует отдельные синтетические данные.
- **Реальная проверка Java из браузера:** `npm.cmd --prefix frontend run e2e:practice -- --project=chromium`; нужны предварительный production build Angular, выделенный контур с runner и `MENTOR_PRACTICE_FIXTURE`; путь к управляющему скрипту контура берётся из fixture и при заданном `MENTOR_PRACTICE_CONTROL_SCRIPT` должен с ним совпадать. Обычные `test:ui` и `e2e` не подтверждают исполнение Java.
- **Runner:** тесты в [runner/src/test/java/ru/mentor/runner/](runner/src/test/java/ru/mentor/runner/); `./mvnw -pl runner verify` выполняется в Linux checkout с настоящим Docker, подготовленными образами и зависимостями. Подготовка описана в [runner/README.md](runner/README.md) и эксплуатационной инструкции.
- **Инфраструктура:** проверки PowerShell в [infra/tests/](infra/tests/); выбирайте сценарий по изменённому скрипту и его параметрам. Для сервисных образов нужен BuildKit/Buildx: корневой `.dockerignore` исключает всё, персональные `Dockerfile.dockerignore` разрешают нужные файлы. `infra/tests/docker-context.ps1` проверяет это настоящим BuildKit на синтетическом контексте (отдельно от Windows mock job). `infra/tests/caddy-runtime.ps1 -Image <образ> -NodeExecutable <node>` проверяет web и TLS job-gateway на одном image ID с синтетическим backend; Node требуется на хосте. CI выполняет эти проверки до сканирования и публикации. `infra/check-image-scan.ps1` проверяет полный Trivy JSON по image ID и составу OS/JAR/Go-пакетов, блокирует исправимые HIGH/CRITICAL. CI сохраняет отчёты 7 дней и передаёт проверенные образы отдельному job публикации через архив с SHA256 без пересборки; описание — в разделе «Сканирование образов перед публикацией» эксплуатационной инструкции.

Полный `./mvnw verify` включает оба Java-модуля и требования runner. Собранный Angular находится в `frontend/dist/mentor/browser/`; JAR-файлы — в `backend/target/` и `runner/target/`. Эти выходные файлы не заменяют исходники. Исторические числа прошедших тестов в README не являются результатом текущей проверки.

## Прежняя реализация и документация

- `server.cjs`, `preview.cjs`, `lib/` — прежний Node-сервер и его прикладная логика.
- Корневые `dist/`, `test/`, `check.cjs`, `scripts/auth-admin.cjs`, `scripts/prepare-training.cjs` — прежний интерфейс, Node-тесты и служебные команды.
- `compile_content.py` — подготовка старых учебных материалов из локальных источников; `private/materials/` — закрытый результат. Это не сборка Angular.
- [docs/legacy/README-node.md](docs/legacy/README-node.md) описывает старый кабинет. В [training/README.md](training/README.md) также остались инструкции Node-runner: его локальные режимы и команды не описывают текущий Java-worker.
- [Дизайн миграции](docs/superpowers/specs/2026-10-01-java-angular-migration-design.md) объясняет архитектурные решения; [план миграции](docs/superpowers/plans/2026-10-01-java-angular-migration.md) — этапы работ. Формулировки «позже», `Task10` и т. п. в планах и отдельных README могут быть историческими. Текущее поведение сверяйте с кодом, конфигурацией и тестами.

## Важные границы при работе

- Разграничение workspace и ролей обеспечивает backend. Angular guards отвечают за навигацию; административная роль не открывает учебные данные всех преподавателей. Просмотр ученика преподавателем остаётся только для чтения.
- При смене аккаунта frontend очищает данные предыдущей сессии: сохраняйте механизм `SessionStore.generation` / `scope()` и отмену запросов. Не сохраняйте сессионные секреты и приватные материалы в публичных assets или браузерных хранилищах.
- Docker socket доступен исполнителю, а не web-backend. Задания получают только разрешённые исходники и доверенный harness; внутренний `/internal/v1` не публикуется через публичный Caddy.
- Рабочий адрес `127.0.0.1:4173` зарезервирован за кабинетом: acceptance-тесты запускаются в отдельных контурах с синтетическими аккаунтами. Адрес запуска берётся из конфигурации; Compose по умолчанию использует другой порт.
- Секреты, снимки, резервные копии и реальные данные не включаются в Git или публичную статику. См. [.gitignore](.gitignore); отдельные подпапки `private/` могут присутствовать в репозитории, поэтому не считать весь каталог автоматически игнорируемым.
- Перенос, восстановление и публикация каталога меняют данные: перед такой задачей прочитайте соответствующий раздел `docs/operations/java-angular.md`. Обычная сборка или запуск не должны повторно импортировать старый кабинет.
- При добавлении модуля, переносе точки входа или изменении команд обновляйте эту карту. Для каждой задачи открывайте только относящиеся к ней исходники и тесты, без обхода всего приватного хранилища.
