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
- [infra/](infra/) — Dockerfiles, Compose, Caddy, PowerShell-скрипты запуска, переноса, резервирования и восстановления в рабочий контур (`restore-platform.ps1`, по умолчанию только dry-run); `infra/windows/` — задача Windows Task Scheduler для ежедневной копии с offsite и алертом; проверки скриптов в `infra/tests/`.
- [training/](training/) — доверенный каталог упражнений, Java-заготовки и профили окружений для текущей платформы; также содержит прежний проверяющий Java-мост.
- [content/](content/) — исходные учебные Markdown/Java-материалы прежнего кабинета. Изменение файла здесь само по себе не обновляет записи текущей платформы в PostgreSQL.
- [docs/operations/](docs/operations/) — эксплуатационная документация; [docs/legacy/](docs/legacy/) — прежняя Node-инструкция; [docs/team/](docs/team/) — состав команды и сводный бэклог доработок по ролевым аудитам.
- [promo/](promo/) — маркетинговые материалы вне платформы: `promo/mentorship-reel/` — отдельный Remotion-проект вертикального ролика (свои `package.json` и `node_modules`, с `frontend/` не связан).
- [docs/superpowers/specs/](docs/superpowers/specs/) и [docs/superpowers/plans/](docs/superpowers/plans/) — дизайн и история реализации, полезные для понимания решений.
- `data/`, `private/`, `.runtime/` — локальные данные, закрытые материалы, конфигурация, кеши и артефакты работы. Для обычной навигации их содержимое читать не требуется.

Версии и зависимости: [pom.xml](pom.xml), [backend/pom.xml](backend/pom.xml), [runner/pom.xml](runner/pom.xml), [frontend/package.json](frontend/package.json), [frontend/package-lock.json](frontend/package-lock.json). Maven-модули — `backend` и `runner`, wrapper — `mvnw` / `mvnw.cmd` и `.mvn/`.

## Точки входа и связи

- **Запуск готового сайта на Windows:** [Start-Mentor.cmd](Start-Mentor.cmd) → [start-local.ps1](start-local.ps1) → [infra/start-platform.ps1](infra/start-platform.ps1) → [infra/compose.platform.yaml](infra/compose.platform.yaml). Требуются подготовленные настройки и образы; ярлык не собирает проект и не импортирует данные.
- **Браузер:** [frontend/src/main.ts](frontend/src/main.ts) → [app.config.ts](frontend/src/app/app.config.ts) и [layout/shell.component.ts](frontend/src/app/layout/shell.component.ts); URL определены в [app.routes.ts](frontend/src/app/app.routes.ts). Основные ветки: `/admin/teachers`, `/teacher/students`, `/learn`.
- **HTTP:** Angular → `/api/v1` → Spring Boot. [infra/proxy/Caddyfile](infra/proxy/Caddyfile) отдаёт Angular и проксирует API. В разработке [frontend/proxy.conf.json](frontend/proxy.conf.json) связывает Angular `4201` с backend `8081`.
- **Backend:** [MentorApplication.java](backend/src/main/java/ru/mentor/platform/MentorApplication.java). Без аргументов запускает сервер; режимы `admin`, `catalog`, `legacy-import` — отдельные административные команды. Настройки: [application.yaml](backend/src/main/resources/application.yaml).
- **Проверка упражнения:** backend `practice/AttemptService.java` → `practice/JobQueue.java` → внутренний `/internal/v1` → runner → результат и история в backend. Внутренний gateway: [infra/proxy/Jobs.Caddyfile](infra/proxy/Jobs.Caddyfile).
- **Runner:** [RunnerApplication.java](runner/src/main/java/ru/mentor/runner/RunnerApplication.java) → `JobClient.java`, `ContainerExecutor.java`, `SourceStaging.java`, `ResultVerifier.java` в том же пакете. Подготовка окружений — `EnvironmentBuilder.java` и режим `--prepare`. Развёртывание: [infra/compose.runner.yaml](infra/compose.runner.yaml).

## Где искать нужное изменение

### Интерфейс

Все пути в этом подразделе — внутри [frontend/src/app/](frontend/src/app/).

- `auth/`, `admin/` — вход, приглашения, пароли, управление преподавателями.
- `core/session.store.ts`, `core/session.interceptor.ts`, `core/role.guard.ts` — состояние сессии, HTTP и навигация по ролям; `core/platform-api.service.ts` — общие запросы API.
- `layout/` — оболочка (шапка с разделами роли, меню профиля, мобильное меню, шапка и вкладки открытого занятия, баннер предпросмотра) и контекст пространства; глобальные стили — [frontend/src/styles.scss](frontend/src/styles.scss).
- Визуальный язык — дизайн-система «Наставник», направление D «Партия» (токены, правила и экраны — в Claude Design). Имена CSS-переменных в `styles.scss` совпадают с токенами (`--surface`, `--ink`, `--accent`…); тёмная тема — класс `.theme-dark` (тренажёр, выбор хранится в `localStorage` как настройка отображения). Иконки Lucide — `core/icon.component.ts` (`<mentor-icon name="…"/>`); шрифты Old Standard TT, Fira Sans, PT Mono подключены из `@fontsource` в `frontend/angular.json` (CSP не пускает внешние шрифты). Маркировка видимости: штриховка и «Только вам» — то, что ученик не видит.
- `students/` — список и карточка ученика; карточку используют также маршруты `/learn/students/...`. Общий контекст student/lesson/preview/editable — `students/domain-page.ts`, выбранный ученик и занятие — `layout/workspace-context.ts`. `student/` — главная страница ученика и вкладки (`student-navigation.component.ts`: вкладки карточки ученика у преподавателя и разделы открытого занятия у обеих ролей); это отдельная папка.
- `lessons/` — создание занятия и его страница; `editor/` — Markdown, импорт текста и предпросмотр.
- `materials/` — чтение материалов и навигация по документам; `material-form.component.ts` — форма преподавателя для добавления документа или файла (отложенный чанк), удаление — в `material-view.component.ts`; `legacy-blocks.component.ts` отображает импортированные блоки внутри актуального приложения.
- `homework/`, `reviews/` — сдачи ДЗ, отзывы и оценки преподавателя (`homework/grade.component.ts`: знак оценки всегда со словом), часы «чей ход» (`homework/turn-clock.component.ts`: ход определяет последняя сдача занятия или отправленная попытка упражнения с размещением «Домашняя работа», `kind` хода — `homework`/`attempt`; ученик видит колонку ходов в своих занятиях).
- `roadmap/` — этапы маршрута ученика: просмотр и редактор преподавателя с ревизией. `journal/` — журнал «Ходы» на карточке и главной ученика. `comments/` — комментарии преподавателя к строкам кода: текстовая сдача ДЗ и попытка тренажёра. Статус занятия «Проведено / Подготовлено / Запланировано» — `lessons/lesson-status.ts`.
- `practice/` — тренажёр, редактор кода, черновики и опрос попыток; выход с несохранённым кодом — `core/practice-exit.service.ts`.
- `core/legacy-route.adapter.ts` — совместимость старых ссылок. Слово `legacy` в имени отдельного файла не означает, что его можно удалить из текущего приложения.

### Сервер и данные

Java-пакеты расположены внутри [backend/src/main/java/ru/mentor/platform/](backend/src/main/java/ru/mentor/platform/). Обычная цепочка: контроллер → сервис → репозиторий с `JdbcTemplate`; текущая реализация не использует ORM.

- `identity/` — аутентификация, сессии, приглашения, пароли, административная CLI; начать с `AuthController.java`, `AuthService.java`, `SecurityConfiguration.java`.
- `workspaces/` — пространства преподавателей и границы доступа; ключевой файл `WorkspaceAccess.java`.
- `students/` — карточки учеников, архив (`archived_at`: карточка вне списков и очереди, ученик читает, но не сдаёт); `lessons/` — занятия, тексты, номер занятия, отметка «Проведено», статус `planned`/`prepared` и удаление пустого занятия (DELETE, 409 при работах/материалах/черновиках); `materials/` — чтение и публикация материалов (POST документа или файла, DELETE; Markdown рендерит `MarkdownDocument` на сервере в тот же payload, что и скрипты комплектов; первый материал переводит занятие в `prepared`); `homework/` — сдачи, ревью, оценки, текст однофайловых работ и «чей ход» (`HomeworkTurnController`). В этих пакетах искать соответствующие `*Controller`, `*Service`, `*Repository`.
- `roadmap/` — этапы маршрута ученика (GET/PUT с `revision`). `journal/` — журнал ходов только для чтения: `MoveRepository` объединяет сдачи, ревью, попытки тренажёра и проведённые занятия. `comments/` — комментарии к строкам кода; создаёт и удаляет только преподаватель-владелец карточки. Цель комментария — текстовая сдача `.java`/`.txt`/`.md` до 256 КиБ или попытка тренажёра. ZIP-проекты по-прежнему не распаковываются.
- `files/` — проверка доступа к объектам, загрузка и выдача файлов; `BlobStore.java` задаёт интерфейс, `LocalBlobStore.java` и `S3BlobStore.java` — реализации.
- `practice/` — каталог и версии упражнений (`CatalogService`), назначения (`AssignmentService`), черновики (`DraftService`), попытки (`AttemptService`), очередь (`JobQueue`), история (`PracticeHistoryService`), внутренний API (`JobController`, `RunnerSecurity`).
- `migration/` — импорт Node-данных и блокировка незавершённого переноса. Это действующая служебная часть Java-приложения.
- `shared/` — текущий пользователь (`Actor`), пагинация, формат ошибок и обработчики исключений.
- [backend/src/main/resources/db/migration/](backend/src/main/resources/db/migration/) — SQL-миграции Flyway: identity → пространства/ученики → занятия → файлы → ДЗ → каталог/черновики → очередь → импорт → оценки ДЗ → проведённые занятия → этапы маршрута → комментарии к коду. Изменения схемы оформляйте новой миграцией.

### Контракты и учебные упражнения

- [contracts/openapi.yaml](contracts/openapi.yaml) → `npm.cmd --prefix frontend run api:generate` → [frontend/src/app/api/schema.d.ts](frontend/src/app/api/schema.d.ts). Схему TypeScript не редактировать вручную; серверные контроллеры/DTO поддерживаются вручную и должны соответствовать контракту.
- [contracts/runner.openapi.yaml](contracts/runner.openapi.yaml) → Maven-плагин в `runner/pom.xml` → `runner/target/generated-sources/openapi/`. Сгенерированные DTO исполнителя не править вручную.
- [training/catalog.json](training/catalog.json) — условия, версии, тесты и заготовки упражнений; [training/environments.json](training/environments.json) — фиксированные зависимости и контрольные суммы; [training/exercises/](training/exercises/) — Java-заготовки.
- [runner/src/main/resources/harness/](runner/src/main/resources/harness/) — актуальные `TrustedHarness.java`, Dockerfile, Java policy и ограничитель времени. `EnvironmentBuilder` берёт ресурсы отсюда. [training/runner/TrustedHarness.java](training/runner/TrustedHarness.java) — прежняя копия для Node-runner; её изменение не обновляет текущий Java-worker.
- Публикация каталога в текущий backend идёт через `practice/CatalogCommand.java` с явным workspace и проверенным manifest окружений. При изменении задания учитывайте его revision и уже сохранённые назначения/попытки.

## Команды и проверки

Команды ниже выполняются **из корня репозитория**. Для сборки нужны JDK 21 и Node.js `>=24.15.0 <25`; для инфраструктуры — PowerShell 7.2+ и Docker. На Windows используется Linux engine Docker Desktop с доступом из WSL Ubuntu. Backend-тесты с PostgreSQL используют Testcontainers и также требуют Docker.

```powershell
./mvnw.cmd -pl backend verify
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run api:generate
npm.cmd --prefix frontend test -- --watch=false
npm.cmd --prefix frontend run build
```

Для portable Node на Windows используйте [infra/use-node.ps1](infra/use-node.ps1) с абсолютным `-NodeDirectory`: пример настройки есть в [frontend/README.md](frontend/README.md). Скрипт выбирает поддерживаемый Node только на время команды. Источник npm-команд — `frontend/package.json`.

- **Разработка UI:** `npm.cmd --prefix frontend run start -- --host 127.0.0.1`. Backend настраивается отдельно; `MENTOR_PUBLIC_ORIGIN` должен точно соответствовать адресу браузера, например `http://127.0.0.1:4201`.
- **Backend:** тесты находятся в [backend/src/test/java/ru/mentor/platform/](backend/src/test/java/ru/mentor/platform/), по доменным пакетам; общая PostgreSQL-основа — `support/PostgresTest.java`.
- **Angular unit:** `*.spec.ts` рядом с исходниками; Vitest настраивается через [frontend/angular.json](frontend/angular.json).
- **UI с HTTP fixtures:** `npm.cmd --prefix frontend run test:ui -- --project=chromium`; сценарии в [frontend/e2e/](frontend/e2e/), конфигурация — `frontend/playwright.config.ts`. Нужен установленный Chromium для Playwright.
- **Браузер с настоящим backend:** `npm.cmd --prefix frontend run e2e -- --project=chromium`; сценарии в [frontend/integration/](frontend/integration/), запуск — `frontend/tools/browser-fixture.mjs`. Сначала скомпилируйте `support/BrowserFixture.java` и запишите classpath в `.runtime/browser-fixture-classpath.txt` по эксплуатационной инструкции. Каждый набор использует отдельные синтетические данные.
- **Реальная проверка Java из браузера:** `npm.cmd --prefix frontend run e2e:practice -- --project=chromium`; нужны предварительный production build Angular, выделенный контур с runner и `MENTOR_PRACTICE_FIXTURE`; путь к управляющему скрипту контура берётся из fixture и при заданном `MENTOR_PRACTICE_CONTROL_SCRIPT` должен с ним совпадать. Обычные `test:ui` и `e2e` не подтверждают исполнение Java.
- **Runner:** тесты в [runner/src/test/java/ru/mentor/runner/](runner/src/test/java/ru/mentor/runner/); `./mvnw -pl runner verify` выполняется в Linux checkout с настоящим Docker, подготовленными образами и зависимостями. Подготовка описана в [runner/README.md](runner/README.md) и эксплуатационной инструкции.
- **Инфраструктура:** проверки PowerShell в [infra/tests/](infra/tests/); выбирайте сценарий по изменённому скрипту и его параметрам.

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
