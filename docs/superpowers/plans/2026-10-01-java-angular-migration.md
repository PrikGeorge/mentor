# Java + Angular Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести существующий учебный кабинет на Java и Angular, сохранив данные и сценарии и добавив согласованное разделение независимых преподавателей.

**Architecture:** Spring Boot — модульный монолит с PostgreSQL, закрытым файловым хранилищем и отдельным Java-исполнителем. Angular работает с версионированным REST API того же origin. Разработка идёт рядом с текущей реализацией; после приёмки выполняется один перенос записей, без dual write.

**Tech Stack:** Java 21, Spring Boot 4.1, Maven Wrapper, PostgreSQL 17/Flyway, Spring Security/Session JDBC, Angular 22/TypeScript 6/RxJS 7, Node.js 24.15+ в пределах ветки 24, JUnit/Testcontainers, Angular tests, Playwright, Linux Docker.

**Spec:** [Согласованная спецификация](../specs/2026-10-01-java-angular-migration-design.md).

Статус: план подтверждён пользователем; выполняется в ветке codex/java-angular-migration. Выполнение и проверки фиксируются по задачам. Метод исполнения — субагенты, с учётом ранее высказанного предпочтения пользователя; независимые задачи можно выполнять параллельно после фиксации их общих контрактов. Самопроверку этого плана выполняет основной агент.

## Global Constraints

- Исходная реализация для переноса — текущая рабочая копия, включая изменённые и новые файлы, а не только последний Git-коммит.
- Публикация в интернете и покупка ресурсов не входят в этот перенос.
- Текущие локальные данные и работающий сервер остаются источником истины до переключения. Двойной записи в JSON и PostgreSQL нет.
- Для первой версии один преподаватель владеет одним пространством, аккаунт ученика связан с одним пространством и одной карточкой.
- Административная роль сама по себе не открывает учебные материалы всех преподавателей.
- Пароль: 8–128 Unicode-символов и до 512 байт UTF-8, без обрезания пробелов; некорректные Unicode-последовательности отклоняются.
- Один текст занятия — до 200 000 UTF-16 единиц, импортируемый файл — до 1 МиБ. Запрос сохранения текстов занятия допускает до 4 МиБ JSON.
- Полное ДЗ: ZIP, Java, TXT, Markdown или PDF до 20 МиБ. Файлы проектов не распаковываются и не исполняются.
- Ограничение общего размера исходников сохраняется: 256 КиБ UTF-8 на попытку; также сохранить текущие 16 файлов и 128 КиБ на файл.
- Приглашения действуют 72 часа, ссылки восстановления — 30 минут, сессии — 8 часов бездействия и 7 суток общего срока.
- Веб-бэкенд не имеет доступа к Docker. Для публичного размещения исполнитель находится на отдельной VM.
- CSS-переменные цветов, типографика, отступы и знакомые элементы переносятся в общий набор стилей. Новое оформление страниц в задачу не входит.
- Все автоматические проверки используют синтетические данные, временные каталоги и отдельную БД. Пароли, токены, реальные работы и резервные копии не попадают в Git или отчёты.

## Review Focus

- Угаданный ID файла/занятия и роль ADMIN: отсутствие чужого содержимого даже в GET/HEAD, ошибках и DTO; проверки Tasks 2, 4, 5, 15.
- Поздний ответ, импорт файла или автосохранение после смены аккаунта: старые данные не показываются и не отправляются от нового пользователя; Tasks 10, 12, 14.
- БД и объектное хранилище расходятся после сбоя: нет успешно объявленной сдачи без файла и нет удаления используемого объекта; Tasks 4, 5, 9, 15.
- Повтор HTTP и истёкшая аренда исполнителя: одна пользовательская попытка, одна итоговая запись, устаревший worker не перезаписывает результат; Tasks 7, 8, 14.
- Импорт пограничных старых данных: строковые ID/ревизии, scrypt, московское время и отсутствующие versus явно пустые назначения сохраняют смысл; Tasks 1, 6, 9.

## Карта файлов и владение

Обозначения путей ниже — точные механические префиксы, не произвольные расположения:

- `B/` = `backend/src/main/java/ru/mentor/platform/`; `BT/` = `backend/src/test/java/ru/mentor/platform/`.
- `DB/` = `backend/src/main/resources/db/migration/`.
- `R/` = `runner/src/main/java/ru/mentor/runner/`; `RT/` = `runner/src/test/java/ru/mentor/runner/`.
- `A/` = `frontend/src/app/`; frontend-тест лежит рядом с компонентом/сервисом с суффиксом `.spec.ts`.
- `contracts/openapi.yaml` — публичные HTTP-контракты; `contracts/runner.openapi.yaml` — внутренний протокол worker. Ими и нумерацией Flyway владеет основной интегратор.
- `pom.xml` — reactor только `backend`, `runner`; `backend/pom.xml`, `runner/pom.xml` — отдельные приложения. Общую Java-библиотеку доменных сущностей для worker не создавать.
- `A/api/schema.d.ts` генерируется из OpenAPI; `A/core/platform-api.service.ts` использует HttpClient и типы из схемы. Доменные Angular-сервисы добавляют методы своего раздела.
- `infra/compose.dev.yaml`, `infra/compose.platform.yaml`, `infra/compose.runner.yaml` — локальная среда и отдельные deployment-конфигурации платформы/исполнителя.

Существующие `lib/`, `dist/`, `training/`, `content/` и тесты используются как источники функционального соответствия. Не переводить их постепенно на новый API и не удалять в процессе переноса. Новые сущности располагаются по бизнес-модулям; контроллеры обращаются к сервисам, а не к репозиторию другого модуля.

## Общие контракты и команды

Все ID — строки. Новые ID — UUID; старые строки остаются неизменными. `Actor={userId, workspaceId:string|null, role:ADMIN|TEACHER|STUDENT, authVersion:number}` создаётся исключительно сервером. `Membership={userId,workspaceId,role,studentId:string|null,disabled}`. ADMIN без membership не является преподавателем. Доменные записи имеют ключ/unique constraint `(workspace_id,id)`, дочерние FK включают workspace; логины и ID аккаунтов уникальны глобально. Одинаковый идентификатор упражнения в двух пространствах не связывает их данные.

`ApiProblem={status,code,message,fieldErrors:Record<string,string>,requestId}`; `Page<T>={items:T[],page:number,size:number,total:number}`; page начинается с 0, size по умолчанию 25, максимум 100. Ошибки валидации — 400, остальные коды берутся из spec. Мутации передают `X-Mentor-Account` и CSRF; несовпадение аккаунта текущей сессии со старой вкладкой даёт 409 до записи. Анонимные login/register/reset используют CSRF без заголовка аккаунта.

Публичный корень `/api/v1`. `W=/workspaces/{workspaceId}`, `S=W/students/{studentId}`, `L=S/lessons/{lessonId}`. Это определения точных шаблонов путей в задачах, а не динамический выбор маршрута. Cookie выдаёт Spring Session; токен не передаётся в JSON. `GET /auth/session` возвращает `{account:Actor|null,csrfToken:string}` без потери анонимного CSRF. `POST /auth/logout` возвращает 204.

`ExerciseRevision` на проводе — JSON `string | number`; `1` и `"1"` различаются. В Java отдельный value object преобразует его в ключ `n:1`/`s:1`, сохраняя исходный JSON-тип. `Draft={exerciseId,exerciseRevision,revision:number,files:Record<string,string>,updatedAt}`. `Mode=run|submit`, `Placement=class|homework`.

`CheckResult={status,passed,total,elapsedMs,diagnostics?,tests}`; status — `accepted|wrong_answer|compile_error|runtime_error|time_limit|error|unavailable`. `Attempt={id,exerciseId,exerciseRevision,environmentRevision:string|null,mode,jobState,files,result:CheckResult|null,createdAt}`; `jobState=queued|running|completed|failed`. environmentRevision=null допускается только для импортированной истории без сохранённых сведений об окружении; новая попытка всегда фиксирует версию. Успех: только `total>0 && passed===total` и подтверждённый протокол harness. Снимок файлов включается при запросе детали попытки, не во все списки.

Команды выполняются из корня изолированной рабочей копии. Windows: `.\mvnw.cmd`; Linux: `./mvnw`. Все названия JUnit ниже заканчиваются на `Test` и исполняются Surefire, включая интеграционные тесты с Testcontainers. Для фронтенда используется `npm.cmd` после включения Node 24. Каждый RED-прогон должен падать по ожидаемой отсутствующей функции/поведению; ошибка окружения не считается RED. Каждый GREEN — exit 0, нужный тест действительно исполнен, обязательные Docker-тесты не пропущены.

Точечные изменения фиксируются после GREEN и ревью задачи: добавлять только перечисленные файлы, без `git add .`; исходный baseline и пользовательские изменения не смешивать с новой реализацией. Runtime-секреты читаются из файлов вне Git; значения секретов не печатаются в командах.

## Task 1: Работающий вход с PostgreSQL и совместимыми паролями

**Files:** создать `pom.xml`, `mvnw`, `mvnw.cmd`, `.mvn/wrapper/maven-wrapper.properties`, `backend/pom.xml`, `runner/pom.xml`, `B/MentorApplication.java`, `B/identity/PasswordCodec.java`, `B/identity/LegacyPasswordHash.java`, `B/identity/AuthController.java`, `B/identity/AuthService.java`, `B/identity/SessionPolicy.java`, `B/identity/IdentityRepository.java`, `B/identity/SecurityConfiguration.java`, `B/identity/AdminCommand.java`, `B/shared/Actor.java`, `B/shared/ApiProblem.java`, `B/shared/Page.java`, `B/shared/ApiExceptionHandler.java`, `DB/V1__identity.sql`, `backend/src/main/resources/application.yaml`, `infra/compose.dev.yaml`, `contracts/openapi.yaml`, `BT/identity/PasswordCompatibilityTest.java`, `BT/identity/SessionIntegrationTest.java`, `BT/support/PostgresTest.java`; изменить `.gitignore` только новыми build/runtime-исключениями.

**Interfaces:** `PasswordCodec.encode(String):String`, `matches(String,String):boolean`, `importLegacy(LegacyPasswordHash):String`; record `LegacyPasswordHash(String algorithm,int N,int r,int p,String saltBase64,String hashBase64)` соответствует старому JSON. `AuthService.authenticate(String login,String password):Actor`; `SessionPolicy.requireCurrent(HttpServletRequest):Actor`. HTTP: `/auth/session`, POST `/auth/login` `{login,password}`, `/auth/logout`, `/auth/change-password` `{currentPassword,newPassword}`. `AdminCommand` создаёт/восстанавливает администратора интерактивно без пароля в argv. Общие `Actor`, `Page<T>`, `ApiProblem` реализуют поля из контрактов выше; временный bootstrap ADMIN не зависит от ещё не созданных membership-таблиц Task 2.

- [x] **1. Подготовить проверяемый baseline:** применить workflow using-git-worktrees при исполнении; прежде сохранить manifest/hash снимка текущей рабочей копии с изменёнными и неигнорируемыми новыми файлами. В новом worktree воспроизвести именно эту копию, проверить изменённые/удалённые файлы и сохранить отдельный baseline-коммит без данных и секретов. Игнорируемые данные/материалы резервировать отдельно в закрытом каталоге, согласованно по времени; рабочий сервер не останавливать для начального read-only исследования. Baseline-тесты выполнять на синтетических данных. `node --test` и `node check.cjs` должны быть записаны в baseline-отчёт; check использует копию подготовленных материалов. Если материалы нужно собрать, `python compile_content.py` запускать только в изолированной копии.
- [x] **2. Создать минимальную Maven/Flyway-конфигурацию и RED-тесты входа.** Закрепить patch-версии выбранных веток, Java release=21, schema Spring Session через Flyway, Testcontainers PostgreSQL 17. Тестовый хеш получать из `lib/auth-passwords.cjs` только для искусственного пароля. Проверки: `assertTrue(codec.matches("  Пароль😀8  ", codec.importLegacy(hash))); assertFalse(codec.matches("Пароль😀8", encoded));` а также 7/8/128/129 Unicode-символов, 512/513 UTF-8 байт, lone surrogate, разные соли, неизвестный логин. `SessionIntegrationTest` проверяет cookie, CSRF, новый ID сессии после входа и запрет анонимной записи.
- [x] **3. RED:** `.\mvnw.cmd -pl backend -Dtest=PasswordCompatibilityTest,SessionIntegrationTest test` — ожидаемый FAIL. Создаваемая основа нужна этим тестам, отдельного фиктивного scaffold-теста нет.
- [x] **4. Реализовать интерфейсы:** Spring Security SCrypt N=131072/r=8/p=1/key64/salt16; два активных KDF и очередь 8. Логин NFKC/trim/lowercase с прежним форматом 3–32. Серверные JDBC-сессии, CSRF, recheck authVersion/disabled на запросе, idle 8h/absolute 7d, отзыв других сессий при смене пароля. Защищённые настройки proxy/origin; 10 login на логин/15m, 100/IP/15m, register/reset 20/IP/15m и 120 auth-запросов/min сохраняют прежние ограничения. Ограничения auth не применять глобально ко всем опросам очереди. POST login/logout и выдача анонимного CSRF должны работать в одной политике, без `csrf.disable()`.
- [x] **5. GREEN:** повторить команду шага 3. Дополнить тем же тестом рестарт контекста с той же БД, истечение по управляемому Clock, отзыв доступа, X-Mentor-Account mismatch, 429 и отсутствие сырого пароля/токена в API. Зафиксировать точечный commit `feat: add persistent Java authentication`.

## Task 2: Приглашения, пространства и карточки учеников

**Files:** создать `B/workspaces/WorkspaceAccess.java`, `B/workspaces/WorkspaceService.java`, `B/workspaces/WorkspaceRepository.java`, `B/identity/InvitationService.java`, `B/identity/InvitationController.java`, `B/identity/AccountAccessService.java`, `B/students/StudentService.java`, `B/students/StudentRepository.java`, `B/students/StudentController.java`, `B/students/StudentRef.java`, `DB/V2__workspaces_students_invitations.sql`, `BT/identity/InvitationRaceTest.java`, `BT/workspaces/WorkspaceIsolationTest.java`; расширить `IdentityRepository.java`, OpenAPI.

**Interfaces:** `WorkspaceAccess.requireTeacher(Actor,String workspaceId):void`; `StudentService.requireReader(Actor,String workspaceId,String studentId):StudentRef`; `StudentRef(String workspaceId,String id,String userId)` — публичный интерфейс students-модуля. `InvitationService.redeem(String token,String login,String password):Actor`. HTTP: POST `/admin/teacher-invitations`, DELETE `/admin/teacher-invitations/{id}`, GET `/admin/teachers`, PATCH `/admin/teachers/{id}/access`, PATCH `/admin/workspaces/{id}/access`, POST `/admin/teachers/{id}/password-reset`, POST `/auth/register`, POST `/auth/reset-password`; GET/POST `W/students`, GET/PATCH `S`, GET/PATCH `S/access`, POST `S/invitations`, DELETE `S/invitations/{id}`, POST `S/password-reset`. InvitationIssue возвращает ссылку только в ответе создания; списки содержат состояние/срок, без сырого токена. Контракты `StudentView` и `StudentInput` задаются здесь в OpenAPI по полям lib/store.cjs с явными teacher/student projections.

- [x] **1. RED-тесты:** `InvitationRaceTest.oneWinner` одновременно погашает один токен: `assertEquals(1, successfulRegistrations); assertEquals(1, createdMemberships);` истечение ровно через 72h/30m, повтор/отзыв запрещены. `WorkspaceIsolationTest` создаёт A/B и проверяет `teacherA -> studentB = 404`, `admin -> studentA content = 404`, подмену workspace/role, composite FK, disabled workspace и отзыв сессии.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=InvitationRaceTest,WorkspaceIsolationTest test`.
- [x] **3. Реализовать транзакции и endpoints:** user/workspace/membership создаются атомарно, токены хешируются, блокируются на погашение, новая ссылка карточки отзывает старую. Восстановление требует текущий пароль выдавшего и точное владение. Не давать teacher восстановить другого teacher/admin. StudentProfile может не иметь userId; после регистрации связь уникальна. Поля карточки и размеры брать из текущего `lib/store.cjs:PROFILE_FIELDS`, notes только teacher, studentReview — архив. Не добавлять удаление учеников.
- [x] **4. GREEN:** повторить команду; проверить два параллельных приглашения на одну карточку, pause/resume, невозможность зайти после блокировки и отсутствие автоматической админ-роли при создании teacher.
- [x] **5. Commit:** `feat: isolate teacher workspaces and invitations` — только Task 2.

## Task 3: Занятия и независимые ревизии текстов

**Files:** создать `B/lessons/LessonService.java`, `B/lessons/LessonRepository.java`, `B/lessons/LessonController.java`, `B/lessons/LessonRef.java`, `B/lessons/LessonText.java`, `B/lessons/TextKind.java`, `DB/V3__lessons_texts.sql`, `BT/lessons/LessonRevisionTest.java`, `BT/lessons/LessonAudienceTest.java`; расширить OpenAPI.

**Interfaces:** `LessonService.requireReader(Actor,String workspaceId,String studentId,String lessonId):LessonRef`; `LessonRef(String workspaceId,String studentId,String id)` используется materials/practice/homework. `saveText(Actor,LessonRef,TextKind kind,String markdown,long expectedRevision):LessonText`; `LessonText(kind,markdown,revision)` и `TextKind=teacherNotes|studentNotes|reviewNotes`. GET/POST `S/lessons`, GET/PATCH `L`, GET/PUT `L/texts/{kind}` `{markdown,revision}`, GET `S/dashboard`; `LessonView` в OpenAPI включает date/time/timeZone:"Europe/Moscow", duration, status:planned|prepared, bundleId, revision и доступные caller текстовые поля.

- [x] **1. RED:** `LessonRevisionTest.independentFields` проверяет два одновременных сохранения разных текстов и конфликт одного: `assertEquals(409, staleSave.status()); assertEquals(originalWhitespace, readBack.markdown());` 200000 UTF-16 units допустимы, 200001 — 400, тело >4 МиБ — 413. `LessonAudienceTest` проверяет отсутствие teacherNotes даже в JSON ошибок и 404 для чужого lesson/student сочетания.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=LessonRevisionTest,LessonAudienceTest test`.
- [x] **3. Реализовать:** отдельная optimistic revision на метаданные и каждый текст; без trim Markdown. Дата/время локальные плюс zone, createdAt UTC; правила валидности даты/длительности — как `lib/store.cjs`. Для dashboard использовать момент занятия и его конец, затем последнее по дате; продолжительность не терять при выборе текущего. Создание занятия принимает только короткую форму; материалы добавляются отдельно, архив отзывов не копируется.
- [x] **4. GREEN:** повторить тесты с кириллицей, emoji и занятиями около московской полуночи; отсутствие будущих и пустой список покрыты. Предпросмотр teacher читает student DTO, но не получает права сдачи работ.
- [x] **5. Commit:** `feat: preserve lessons and versioned Markdown texts`.

## Task 4: Закрытые файлы и подготовленные материалы

**Files:** создать `B/files/BlobStore.java`, `B/files/LocalBlobStore.java`, `B/files/S3BlobStore.java`, `B/files/BlobService.java`, `B/files/BlobRepository.java`, `B/materials/MaterialService.java`, `B/materials/MaterialController.java`, `B/materials/MaterialRepository.java`, `DB/V4__files_materials.sql`, `BT/files/BlobLifecycleTest.java`, `BT/materials/MaterialAccessTest.java`; расширить OpenAPI и dev compose тестовым S3-compatible сервисом с закреплённым образом.

**Interfaces:** `BlobStore.stage(InputStream,long maximumBytes):StagedBlob`, `open(String key):InputStream`, `delete(String key):void`; public record `BlobStore.StagedBlob(String key,long size,String sha256)`. `BlobService.attach(Actor,LessonRef,StagedBlob,String filename,String contentType):BlobRef`; public record `BlobService.BlobRef(String id,long size,String sha256)` не раскрывает ключ хранилища. `MaterialService.read(Actor,String workspaceId,String materialId):MaterialView`; `GET W/materials/{id}` и `/file` (также HEAD), GET `L/materials`. MaterialView — DTO в MaterialService и OpenAPI, с перечисленными ниже полями manifest/content. Материал может быть привязан непосредственно к StudentRef для страниц профиля, без выдуманного занятия.

- [x] **1. RED:** `MaterialAccessTest.directUrls` проверяет guest/studentB/teacherB/admin, GET/HEAD, teacher-only marker и архивный URL `/downloads/teacher-lesson-2026-09-27.zip`: `assertFalse(publicAssets.contains("PRIVATE_TEACHER_MARKER"));` `BlobLifecycleTest.failedAttach` моделирует DB failure/обрыв потока/неверный размер и доказывает отсутствие ready-записи и дальнейшую уборку только unattached staged blob.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=BlobLifecycleTest,MaterialAccessTest test`.
- [x] **3. Реализовать staged→attached lifecycle без притворной общей транзакции БД/S3:** staged объекты получают reservation ID; janitor не удаляет attached или ещё арендованные загрузки. Opaque keys и нормализованные Content-Disposition filenames, no-sniff, лимит потока независимо от Content-Length. Download авторизуется до чтения, и URL не раскрывает путь/ключ. Сохраняются аудитория, kind doc/code/view/download, bundle/lesson/profile-привязки, raw/html/sections/viewData и отдельные teacher/student комплекты.
- [x] **4. GREEN:** один и тот же контрактный набор для local и S3 адаптеров; чтение symlink/переход за корень локального хранилища запрещено. HEAD не отдаёт body, но применяет те же права. Проверить очистку после падения между записью объекта и commit БД.
- [x] **5. Commit:** `feat: store and serve private learning materials`.

## Task 5: Сдачи ДЗ и ревью по занятию

**Files:** создать `B/homework/HomeworkService.java`, `B/homework/HomeworkController.java`, `B/homework/HomeworkRepository.java`, `B/homework/Submission.java`, `B/homework/ReviewStatus.java`, `DB/V5__homework_submissions.sql`, `BT/homework/HomeworkFlowTest.java`; использовать BlobService/LessonService, расширить OpenAPI.

**Interfaces:** `submit(Actor,LessonRef,InputStream,String filename,String comment,String repositoryUrl):Submission`; `review(Actor,LessonRef,String id,long revision,ReviewStatus,String feedback):Submission`. HTTP GET/POST `L/homework` (POST multipart file/comment/repositoryUrl), GET/HEAD `L/homework/{id}/file`, PATCH `L/homework/{id}/review`; `Submission={id,filename,size,createdAt,comment,repositoryUrl,status,feedback,reviewedAt?,revision}`, status `submitted|reviewed|needs_revision`.

- [x] **1. RED:** `HomeworkFlowTest.boundariesAndOwnership`: `assertEquals(201, upload(bytes(20*1024*1024)).status()); assertEquals(413, upload(bytes(20*1024*1024+1)).status());` пустой файл/опасное имя/неверная ZIP signature/HTTP repository URL отвергаются; teacher preview POST — 403; чужой download — 404; DB failure не создаёт успешную сдачу. `lessonReviewDoesNotLeakToOtherLesson` проверяет принадлежность feedback.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=HomeworkFlowTest test`.
- [x] **3. Реализовать:** allowed extensions как spec, проверка ZIP header без распаковки, comment <=10000, URL <=2000 без userinfo, filename <=180 с прежними ограничениями Windows имён. Upload limit 20 МиБ, multipart request limit 21 МиБ; исходники проекта никогда не запускаются. Каждая отправка — отдельная версия сдачи, ревью использует optimistic revision, teacher read не превращается в student write.
- [x] **4. GREEN:** повторить тесты, включая disconnect, повторное ревью со старой revision и историю двух сдач. Никакой base64-копии целого файла в JSON.
- [x] **5. Commit:** `feat: add lesson-scoped homework submissions and reviews`.

## Task 6: Каталог, назначения и черновики тренажёра

**Files:** создать `B/practice/ExerciseRevision.java`, `B/practice/Mode.java`, `B/practice/Placement.java`, `B/practice/Draft.java`, `B/practice/CatalogService.java`, `B/practice/CatalogCommand.java`, `B/practice/AssignmentService.java`, `B/practice/DraftService.java`, `B/practice/PracticeRepository.java`, `B/practice/PracticeController.java`, `DB/V6__practice_catalog_drafts.sql`, `BT/practice/DraftRevisionTest.java`, `BT/practice/CatalogAccessTest.java`; расширить OpenAPI.

**Interfaces:** `ExerciseRevision.fromJson(JsonNode):ExerciseRevision`, `key():String`, `toJson():JsonNode`; `CatalogService.publish(Path source,String workspaceId):CatalogReport`, public record `CatalogService.CatalogReport(String workspaceId,int published,List<String> errors)`. `DraftService.save(Actor,LessonRef,String exerciseId,ExerciseRevision,Map<String,String> files,long revision,ExerciseRevision resetForRevision):Draft`. GET `W/exercises`, GET `L/practice`, PUT `L/practice/assignments` `{revision,assignments:[{exerciseId,placement}]}`, GET/PUT `L/practice/exercises/{id}/draft`. Назначение имеет внутренний стабильный assignmentId; снятие меняет active=false, не удаляет строку и её историю.

- [x] **1. RED:** `DraftRevisionTest` проверяет `assertNotEquals(fromJson(1),fromJson("1"));` stale revision=409, явный reset сохраняет архив прежнего кода, отсутствие reset не заменяет шаблон. `CatalogAccessTest` проверяет назначение чужого каталога=404, отсутствие private tests/команд в DTO, ровно объявленные Java paths, 128 КиБ на файл/256 КиБ суммарно/16 файлов.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=DraftRevisionTest,CatalogAccessTest test`.
- [x] **3. Реализовать публикацию доверенным оператором:** source — существующий формат `training/catalog.json` и environments, workspace явно задан CLI; неизменяемые snapshots ревизий и pinned environment. Имена файлов, Java/interface types, customTypes, dependencies, processors проходят allowlist. Student не управляет image/командами/сборкой. Public catalog для ученика содержит только назначенные ему упражнения, условия, шаблон и описание библиотек; приватные данные остаются внутри.
- [x] **4. GREEN:** проверки byte limits на кириллице, package path, неподдерживаемая ревизия, readonly teacher preview и пустые назначения. Старые архивы не требуют наличия текущего назначения и доступны владельцу/его преподавателю согласно read-policy.
- [x] **5. Commit:** `feat: version exercises assignments and practice drafts`.

## Task 7: Долговечные попытки, очередь и внутренний API

**Files:** создать `B/practice/Attempt.java`, `B/practice/CheckResult.java`, `B/practice/JobLease.java`, `B/practice/JobPayload.java`, `B/practice/AttemptService.java`, `B/practice/AttemptRepository.java`, `B/practice/JobQueue.java`, `B/practice/JobController.java`, `B/practice/RunnerSecurity.java`, `B/practice/ResultProjection.java`, `DB/V7__attempts_jobs.sql`, `contracts/runner.openapi.yaml`, `BT/practice/JobLeaseTest.java`, `BT/practice/AttemptIdempotencyTest.java`; расширить PracticeController и OpenAPI.

**Interfaces:** `AttemptService.enqueue(Actor,LessonRef,String exerciseId,ExerciseRevision,Map<String,String>,Mode,String idempotencyKey):Attempt`; POST `L/practice/exercises/{id}/attempts` → 202, GET список и `/{attemptId}`. `JobQueue.claim(String workerId):Optional<JobLease>`, `heartbeat(String jobId,String leaseToken):void`, `complete(String jobId,String leaseToken,CheckResult):void`; internal POST `/internal/v1/jobs/claim|{id}/heartbeat|{id}/complete`. `JobLease={jobId,attemptId,leaseToken,leaseExpiresAt,deadlineAt,payload}`, payload — immutable code/exercise/test/environment snapshot с разрешёнными resource limits.

- [x] **1. RED:** `AttemptIdempotencyTest` одновременно отправляет тот же ключ/код и ожидает один attempt+job; тот же ключ с другим payload — 409. `JobLeaseTest` проверяет два claim — одного владельца, сохранность после restart, истёкшую аренду, отклонение stale complete, второй infrastructure failure→failed, повтор complete с тем же результатом идемпотентен. Сравнения: `assertEquals(1, attemptCount); assertEquals(1, finalResultCount); assertEquals(409, staleWorkerStatus);`.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=JobLeaseTest,AttemptIdempotencyTest test`.
- [x] **3. Реализовать:** enqueue в одной транзакции, уникальный ключ account+assignment+idempotencyKey и hash payload; claim через PostgreSQL `FOR UPDATE SKIP LOCKED`. Lease 30s, heartbeat 5s, hard deadline 90s; максимум две попытки исполнения при инфраструктурном сбое. Проверки пользователя не retried. Начальная bounded queue: 4 ожидающих задания, один worker slot; лимит конфигурируется оператором и проверяется атомарно, overflow→429. Инвалидация сессии не стирает уже принятую попытку. Снятие назначения после 202 запрещает новые запуски, но прежняя попытка завершается и остаётся в истории преподавателя и самого ученика при активном членстве и доступном занятии. Блокировка аккаунта/пространства закрывает чтение; completion worker не восстанавливает пользовательский доступ. Это явное изменение синхронной legacy-семантики в пользу гарантии сохранности принятого задания; `AttemptIdempotencyTest.assignmentRevokedAfterEnqueue` закрепляет оба правила.
- [x] **4. GREEN:** проверить replay после restart, неподписанный/browser запрос на internal API, heartbeat после deadline, malformed result и `accepted` с total=0. Результат ограничить суммарно 32000 символов, private properties/host paths не выдавать; сохранять совместимый набор вердиктов и per-test details. Worker credential — отдельный rotating token из secret file, доступ только к job API по закрытой сети/TLS, не user-cookie.
- [x] **5. Commit:** `feat: persist practice jobs with leased execution`.

## Task 8: Java-исполнитель с реальной изоляцией

**Files:** создать `R/RunnerApplication.java`, `R/JobClient.java`, `R/ContainerExecutor.java`, `R/BoundedProcess.java`, `R/ResultVerifier.java`, `R/EnvironmentBuilder.java`, `runner/src/main/resources/runner.properties`, `runner/src/main/resources/harness/TrustedHarness.java`, `RT/ContainerExecutionTest.java`, `RT/WorkerRecoveryTest.java`, `infra/runner/Dockerfile`, `infra/runner/build-environments.ps1`; расширить runner/pom.xml.

**Interfaces:** `JobClient.claim():Optional<JobLease>`, `heartbeat(JobLease):void`, `complete(JobLease,CheckResult):void` по внутреннему контракту Task 7; `ContainerExecutor.execute(JobLease):CheckResult`; `BoundedProcess.run(List<String>,Path,byte[],Duration,int):ProcessResult`; `EnvironmentBuilder.prepare(Path profiles,Path cache):EnvironmentManifest`. Runner DTO генерируются из `contracts/runner.openapi.yaml` в `runner/target/generated-sources/openapi` с package `ru.mentor.runner.protocol`; это копия HTTP-схемы, не зависимость от backend-домена. ProcessResult определяется record в BoundedProcess, EnvironmentManifest — record в EnvironmentBuilder. Новые образы разрешает оператор и фиксирует digest; данные job не исполняются как shell-строка.

- [x] **1. RED:** `ContainerExecutionTest` портирует значимые проверки из `test/training-runner.test.cjs`: правильные/неправильные ListTask и GroupingTask, package-private method, Jackson readerName, mutation arguments, compile error, loop/output flood, `System.exit(0)`, поддельный PASS/nonce. Проверки: `assertEquals("accepted", valid.status()); assertNotEquals("accepted", spoofed.status()); assertFalse(containerHasNetworkOrSecrets);`. `WorkerRecoveryTest` моделирует потерю lease, завершение процесса worker, повтор доставки и очистку контейнера после рестарта.
- [x] **2. RED:** `.\mvnw.cmd -pl runner -Dtest=ContainerExecutionTest,WorkerRecoveryTest test`; отсутствие Linux Docker — ошибка обязательного lane, не skip.
- [x] **3. Реализовать:** перенести существующий TrustedHarness с лицензиями/атрибуцией и сохранить его протокол method/customTypes/unchangedArguments, защиту nonce/completed, структурное сравнение, JDK21 security policy и раздельные права checker/student classloader. Параметры Docker: network none, user 10001, RAM/swap 512m, CPU 1, pids 128, read-only, drop ALL, no-new-privileges, tmpfs work96m/tmp16m. JVM heap128m, compiler256m; compile15s, case3s, total tests10s, output64KiB на subprocess, job hard90s. Trusted PID1 завершает контейнер через 90s независимо от жизни worker; по lease loss worker завершает раньше. Secret files, Docker socket и user platform data не монтируются в песочницу; wrapper-host — единственный владелец Docker доступа.
- [x] **4. GREEN:** два приведённых теста на реальных контейнерах, разрешённый dependency image с SHA-256, отсутствие сети при исполнении и cleanup labelled expired containers. Вывод независимо ограничивается до разбора; never accept output-only PASS. При утрате lease worker прекращает контейнер и не подменяет результат. После crash контейнер имеет внешний предел жизни и убирается при startup worker.
- [x] **5. Commit:** `feat: execute Java practice in isolated worker containers`.

## Task 9: Проверяемый импорт старой системы

**Files:** создать `B/migration/LegacyImportCommand.java`, `B/migration/LegacyReader.java`, `B/migration/LegacyImportService.java`, `B/migration/ImportReport.java`, `B/migration/MaterialConverter.java`, `DB/V8__import_runs.sql`, `BT/migration/LegacyImportTest.java`, `backend/src/test/resources/legacy/golden/mentoring.json`, `backend/src/test/resources/legacy/golden/auth/accounts.json`, `backend/src/test/resources/legacy/golden/practice/state.json`, `backend/src/test/resources/legacy/golden/materials/manifest.json`; остальные golden blobs генерируются тестом из искусственных строк. Реальные accounts.json не копировать в test resources.

**Interfaces:** `LegacyImportService.inspect(Path source,String importId):ImportReport`, `apply(Path source,String importId,String targetWorkspaceId):ImportReport`; report `{importId,sourceDigest,counts,checksums,warnings,errors,completed}`. CLI `legacy-import --source <snapshot> --import-id <id> --dry-run`, затем `--apply`; принадлежность единственного legacy teacher устанавливается явно. CLI не открывает публичный HTTP server.

- [x] **1. RED:** `LegacyImportTest.preservesGoldenSnapshot` сравнивает ID/строки/локальное время/хеши всех blobs, password matches и тип exerciseRevision. Отдельные cases: practice record отсутствует / assignments=[]; ID michael и lesson-2026-09-27; Moscow 00:05; draft archive; отзыв без занятия; отключённый аккаунт; битый blob; повторный apply. `assertEquals(sourceChecksums,targetChecksums); assertEquals(0,dryRunWrites); assertEquals(firstCounts,secondCounts);`.
- [x] **2. RED:** `.\mvnw.cmd -pl backend -Dtest=LegacyImportTest test`.
- [x] **3. Реализовать полный manifest импорт:** mentoring/auth/practice + snapshots docs/code/viewData/sha + приватные downloads + catalog/profiles/шаблоны. Точный lazy default: sid=michael, lid=lesson-2026-09-27, status=prepared, bundle=library-2026-09-27, practice row отсутствует; назначить только существующие list-task/grouping-task. Архивные результаты — terminal attempts без запуска новых jobs; отсутствие старого определения версии не уничтожает историю, сохраняет архив code/result и пометку unavailable definition. Не приписывать такой попытке текущую версию окружения: сохранить null и пояснение «Версия окружения не сохранена». Для активных назначений отсутствие определения — блокирующая ошибка.
- [x] **4. GREEN:** импорт staged blobs с контрольной суммой до finalize; completed только после связного manifest. Dry-run не пишет БД/объекты. Повтор с тем же digest не дублирует; изменённый source для того же importId отклоняется. Активные старые ссылки отзываются, admin не создаётся автоматически, сессии не переносятся. Raw Markdown и специальные блоки legacy HTML проходят конвертер без потери аудитории; новый runtime не зависит от Python. Тестирует запуск на отсутствующих необязательных старых полях и падение до завершения импорта.
- [x] **5. Commit:** `feat: migrate legacy accounts content and practice history`.

## Task 10: Angular-вход, роли и совместимая навигация

**Files:** создать `frontend/package.json`, `frontend/package-lock.json`, `frontend/angular.json`, `frontend/tsconfig.json`, `frontend/proxy.conf.json`, `frontend/src/main.ts`, `A/app.config.ts`, `A/app.routes.ts`, `A/api/schema.d.ts`, `A/core/platform-api.service.ts`, `A/core/session.store.ts`, `A/core/session.interceptor.ts`, `A/core/legacy-route.adapter.ts`, `A/auth/auth-page.component.ts`, `A/admin/teachers-page.component.ts`, `A/layout/shell.component.ts`, `frontend/src/styles.scss`, `infra/use-node.ps1`, а также `session.store.spec.ts`, `legacy-route.adapter.spec.ts`, `auth-page.component.spec.ts` рядом с целями.

**Interfaces:** `SessionStore.load():Observable<SessionView>`, `signIn(login:string,password:string):Observable<Actor>`, `signOut():Observable<void>`, readonly signals `actor`, `generation`; `LegacyRouteAdapter.resolve(url:URL,actor:Actor):UrlTree|null`. SessionView — ответ `/auth/session`. `PlatformApi` использует типы `components`/`paths` из сгенерированного schema.d.ts; операция генерации `npm run api:generate` через закреплённый openapi-typescript. Base URL `/api/v1`, dev frontend 4201, backend 8081; proxy сохраняет единый браузерный origin. `use-node.ps1 -NodeDirectory <absolutePath> -Command <executable> -Arguments <string[]>` проверяет версию, меняет PATH только собственного процесса и запускает команду. При отсутствии совместимого runtime закрепить официальный архив Node24.15+ с проверкой SHA-256 под `.runtime/toolchains`; глобальный Node22 не заменять. Все npm-команды плана выполняются с этим runtime.

- [x] **1. Создать Angular-конфигурацию и RED-тесты входа:** `AuthPage` показывает приглашение/вход/reset/change-password по маршрутам; пароль не обрезается. `SessionStore` поздний ответ поколения 1 после login поколения 2: `expect(store.actor()?.userId).toBe('second'); expect(rendered).not.toContain('first-private');`. `LegacyRouteAdapter` сохраняет section-0, code detail, practice exercise и screen=student preview; malformed % encoding → not-found, не exception.
- [x] **2. RED:** `npm.cmd --prefix frontend test -- --watch=false`; выбрать только созданные spec-файлы средствами настроенного test builder при точечном повторе.
- [x] **3. Реализовать routes:** `/login`, `/register`, `/reset-password`, `/account/password`, `/admin/teachers`, `/teacher/students/...`, `/learn/...`; guards навигационные. CSRF обновляется после login/logout, credentials остаются same-origin, X-Mentor-Account добавляется к мутациям. Смена actor инвалидирует subscriptions/кеши, 401 сохраняет returnUrl без внешнего redirect и никогда не повторяет старый POST автоматически. CSRF берётся из `/auth/session` и отправляется заголовком `X-CSRF-TOKEN`; session cookie HttpOnly. Admin UI создаёт приглашения, отзывает их, блокирует/восстанавливает teacher/workspace и выдаёт reset с подтверждением пароля. Ссылки показываются для ручной передачи, рассылки нет. Тест F401 доказывает ноль повторов мутации после повторного входа.
- [x] **4. GREEN:** тесты и `npm.cmd --prefix frontend run build`; UI на 390px/клавиатуре, HttpOnly cookie не читается JS, приватные данные не в assets/localStorage. Повторять общую frontend-suite после новых компонентных изменений, не после чистой документации.
- [x] **5. Commit:** `feat: add Angular identity and role navigation`.

## Task 11: Карточки, расписание и страницы занятия

**Files:** создать `A/students/students-api.service.ts`, `A/students/students-page.component.ts`, `A/students/student-page.component.ts`, `A/students/student-form.component.ts`, `A/students/account-access.component.ts`, `A/lessons/lessons-api.service.ts`, `A/lessons/lesson-page.component.ts`, `A/lessons/lesson-form.component.ts`, `A/student/dashboard.component.ts`, `A/student/student-navigation.component.ts`; соответствующие `student-page.component.spec.ts`, `lesson-form.component.spec.ts`, `dashboard.component.spec.ts`.

**Interfaces:** `StudentsApi.list(workspaceId,page):Observable<Page<StudentView>>`, `save(workspaceId,studentId|null,input,revision?):Observable<StudentView>`; `LessonsApi.create(workspaceId,studentId,input):Observable<LessonView>`, `load(workspaceId,studentId,lessonId):Observable<LessonView>`. DTO aliases происходят из Task 3 OpenAPI; student view не содержит teacherNotes/notes. Shell принимает меню выбранного раздела и одну шапку занятия.

- [x] **1. RED:** тесты открытия следующего занятия/последнего прошедшего/пустой карточки, одна короткая форма создания и переход к подготовке после 201, ошибка сохранения удерживает поля, student name вместо «Мой кабинет», разделы занятия в меню. `expect(lessonCreatePayload).not.toHaveProperty('reviewNotes'); expect(studentMenu).not.toContain('Заметки наставника');`.
- [x] **2. RED:** `npm.cmd --prefix frontend test -- --watch=false`.
- [x] **3. Реализовать страницы с текущими цветами/отступами, названиями и смыслом:** карточка+account access, редактирование расписания, сценария и публичных полей раздельно, overview подготовки, teacher preview только чтение. Списки пагинированы; возврат сохраняет выбранного ученика/занятие. Ревью находится в занятии; архив общих отзывов явно отдельный.
- [x] **4. GREEN:** frontend unit tests; браузерный preview с двумя учениками и отдельным новым учителем на синтетической БД: пустые кабинеты не получают материалы Михаэля. Проверить desktop/390px и отсутствие двойных шапок.
- [x] **5. Commit:** `feat: port student and lesson workspaces to Angular`.

## Task 12: Markdown-редактор, импорт и чтение материалов

**Files:** создать `A/materials/materials-api.service.ts`, `A/materials/material-view.component.ts`, `A/materials/document-navigation.component.ts`, `A/editor/markdown-renderer.service.ts`, `A/editor/markdown-editor.component.ts`, `A/editor/markdown-import.service.ts`, `A/editor/lesson-text-api.service.ts`, их `markdown-renderer.service.spec.ts`, `markdown-editor.component.spec.ts`, `markdown-import.service.spec.ts`; добавить print styles.

**Interfaces:** `MarkdownRenderer.render(source:string):string` — единственный путь рендера; `MarkdownImport.read(file:File):Promise<string>`; `LessonTextApi.save(lesson:LessonRef,kind:TextKind,markdown:string,revision:number):Observable<LessonText>`; editor inputs `value`, `revision`, `kind`, outputs `saved`, `cancelled`. HTML в пользовательском Markdown отключён; Angular sanitization не обходится. Для поддерживаемых legacy блоков — отдельные безопасные Angular-компоненты, без blanket bypassSecurityTrustHtml.

- [x] **1. RED:** значимые пробелы/Java fence, undo после импорта, replace/append, UTF-8 fatal decoding, файл >1048576 bytes, текст 200000/200001 UTF-16 units. `expect(await importer.read(file)).toBe(exactSource); expect(render('<script>x</script>')).not.toContain('<script>');`. Позднее чтение файла после закрытия/смены урока не меняет новый редактор; 409 не заменяет введённый текст.
- [x] **2. RED:** `npm.cmd --prefix frontend test -- --watch=false`.
- [x] **3. Реализовать toolbar/selection/undo/preview и явное сохранение только одного текста. Не импортировать изображения автоматически; разрешить явные http/https/mailto ссылки по прежней политике. Материалы получают собственную навигацию/якоря, code viewer, комплекты и print styles; печать раскрывает методические пояснения и возвращает состояние после завершения.
- [x] **4. GREEN:** unit tests и браузерная проверка сохранения/повторного открытия 200000 units, ссылок оглавления, teacher/student комплектов и печати. HTML API и клиентский рендер не должны открыть закрытый сценарий ученику.
- [x] **5. Commit:** `feat: port Markdown editing and lesson materials`.

## Task 13: Angular-сдача домашней работы и ревью

**Files:** создать `A/homework/homework-api.service.ts`, `A/homework/homework-page.component.ts`, `A/reviews/lesson-review.component.ts`, `A/homework/homework-page.component.spec.ts`, `A/reviews/lesson-review.component.spec.ts`.

**Interfaces:** `HomeworkApi.submit(lesson:LessonRef,file:File,comment:string,repositoryUrl:string):Observable<Submission>`; `review(lesson,id,revision,status,feedback):Observable<Submission>`; `download(lesson,id):Observable<Blob>`. Отправка использует multipart FormData, content-type с boundary задаёт браузер.

- [x] **1. RED:** `expect(succeededBanner).toBeFalse()` после 413/503/обрыва upload; 20 МиБ допустимо, 20 МиБ+1 rejected до отправки; две сдачи — две строки истории, rejected review409 удерживает комментарий, другая lesson не показывает отзыв первой. Teacher preview не вызывает submit.
- [x] **2. RED:** `npm.cmd --prefix frontend test -- --watch=false`.
- [x] **3. Реализовать upload/progress/retry, описание допустимых файлов и историю. Общий reviewNotes и feedback к конкретной работе показываются раздельно внутри занятия. Никакой кнопки автоматической проверки полного архива; скачивание через authenticated API, object URL отзывается после использования.
- [x] **4. GREEN:** unit tests и browser полный цикл student upload → teacher needs_revision → student resubmit → teacher reviewed, включая клавиатуру и узкую ширину.
- [x] **5. Commit:** `feat: port homework submission and lesson feedback UI`.

## Task 14: Angular-тренажёр, восстановление и история

**Files:** создать `A/practice/practice-api.service.ts`, `A/practice/practice-page.component.ts`, `A/practice/monaco-editor.component.ts`, `A/practice/draft-recovery.service.ts`, `A/practice/attempt-poller.service.ts`, `A/practice/teacher-practice.component.ts`, а также `draft-recovery.service.spec.ts`, `attempt-poller.service.spec.ts`, `practice-page.component.spec.ts`; сохранить Monaco license при переносе ассетов.

**Interfaces:** `DraftRecovery.key(accountId,workspaceId,studentId,lessonId,exerciseId,exerciseRevision):string`, `save(key,files):void`, `read(key):Recovery|null`, `remove(key):void`; `AttemptPoller.watch(lesson:LessonRef,exerciseId:string,attemptId:string):Observable<Attempt>`. `PracticeApi.enqueue(lesson,exerciseId,files,exerciseRevision,mode,idempotencyKey):Observable<Attempt>` и методы draft/catalog/assignments из Tasks 6–7.

- [x] **1. RED:** после 202 и reload восстанавливается именно attempt ID; потерянный ответ повторяет тот же ключ, changed code создаёт новый. Poll 2s, network failure backoff 4/8/16/30s; terminal/401/смена страницы останавливает запросы. `expect(oldAccountWriteCount).toBe(0); expect(localDraft).toEqual(unsavedFiles);` при смене аккаунта, конфликте revision и недоступном storage. Failed Monaco загрузка оставляет доступный textarea.
- [x] **2. RED:** `npm.cmd --prefix frontend test -- --watch=false`.
- [x] **3. Реализовать редактор файлов рядом с условием/исходным кодом для чтения, explicit run/submit, статусы queued/running/результат, историю immutable code. Draft autosave имеет generation guard на аккаунт/занятие/ревизию; конфликт и обновление задания не заменяют код молча. Logout предлагает сохранить, экспортировать, отменить или явно выйти без сохранения; несовместимый recovery не выдаётся новому аккаунту. Teacher видит назначения и попытки, но не выполняет от ученика.
- [x] **4. GREEN:** unit tests и браузерная проверка с действующим Java-worker для двух исходных упражнений и Jackson; смена вкладки/сессии, серверный restart, неверное решение, отсутствие worker и обновление каталога. Публичные bundles не содержат teacher answers и checker source.
- [x] **5. Commit:** `feat: port code practice with resilient draft recovery`.

## Task 15: Приёмка, воспроизводимый запуск и контролируемый переход

**Files:** создать `infra/compose.platform.yaml`, `infra/compose.runner.yaml`, `infra/proxy/Caddyfile`, `infra/backend/Dockerfile`, `infra/frontend/Dockerfile`, `infra/backup.ps1`, `infra/restore-test.ps1`, `infra/start-platform.ps1`, `infra/cutover.ps1`, `frontend/playwright.config.ts`, `frontend/e2e/learning-flow.spec.ts`, `frontend/e2e/tenant-isolation.spec.ts`, `frontend/e2e/recovery.spec.ts`, `docs/operations/java-angular.md`; изменить `README.md`, `Start-Mentor.cmd`, `start-local.ps1` только после успешной приёмки. Резервные копии находятся вне Git.

**Interfaces:** `backup.ps1 -Destination <absoluteDirectory>` создаёт manifest БД+objects с checksums; `restore-test.ps1 -Backup <dir>` восстанавливает только в новую БД/новое хранилище и возвращает отчёт сравнения; `cutover.ps1 -Snapshot <dir> -DryRun` по умолчанию ничего не переключает. Применение `-Apply` возможно только с успешным report того же sourceDigest и готовой резервной копией. `start-platform.ps1` запускает собранную систему локально, без требования Node/Python runtime.

- [x] **1. Написать acceptance tests:** teacher invite → student register → lesson → Markdown → practice → homework → review, роли A/B/admin, прямые private URLs, два параллельных invite/submit. `expect(otherWorkspaceHttp.status()).toBe(404); expect(importReport.completed).toBe(true); expect(restoredChecksums).toEqual(backupChecksums);`. Playwright управляет отдельным тестовым контуром и синтетическим seed, никогда не портом 4173 рабочей системы.
- [x] **2. RED:** `npm.cmd --prefix frontend run e2e -- --project=chromium` — недостающий acceptance path фиксируется как FAIL, затем устраняются конкретные пробелы. Для real runner lane Docker обязателен; unavailable не считается успешной автопроверкой.
- [x] **3. Реализовать compose/start/backup/restore:** PostgreSQL и объекты приватные, отдельная сеть/host runner, web без Docker socket, HTTPS origin/proxy согласованы с cookie/CSRF. Health/readiness различают DB outage и unavailable worker; кабинет доступен при втором. Логи и метрики: requestId, job age/runtime, queue count, failed backup; логи не содержат private code/секретов. Nightly backup: согласованный snapshot в maintenance/read-only окне, шифрованная копия вне хоста, retention 14 дней и проверка восстановления на отдельном контуре. Backup job выполняется средствами deployment, не Codex Automation.
- [x] **4. GREEN:** `.\mvnw.cmd verify`, `npm.cmd --prefix frontend run api:generate` (нет неожиданного diff), `npm.cmd --prefix frontend test -- --watch=false`, `npm.cmd --prefix frontend run build`, `npm.cmd --prefix frontend run e2e -- --project=chromium`. Проверить `docker compose -f infra/compose.platform.yaml config` и runner config без вывода значений секретов; Windows запуск, Linux images, desktop/390px, keyboard, print. Восстановить тестовую резервную копию, сверить counts/checksums и пройти вход/скачивание. Одна итоговая независимая проверка всего изменения.
- [x] **5. Подготовить и выполнить локальный переход только после GREEN:** предупредить о коротком окне недоступности, завершить/экспортировать локальные несохранённые черновики, остановить записи legacy, получить финальный snapshot, apply import, выполнить smoke на закрытом от записей новом контуре. До открытия записей возможен возврат старой копии. После новых записей автоматический откат к старому JSON запрещён. Обновить локальный launcher, открыть новый кабинет; legacy snapshot сохранить. Для внешнего хостинга оставить проверенную инструкцию, не публиковать сайт без отдельного поручения.
- [x] **6. Commit:** `feat: validate and switch local mentor platform to Java and Angular`; в README указать команды установки/запуска/администрирования и честные результаты проверок, включая ограничения окружения. Невыполненные acceptance checks не помечать завершёнными.

Приёмка 01.10.2026: backend verify161 выполнен на Windows, runner verify24 отдельно в настоящем Linux/Docker; единый Windows reactor не выдаётся за проверку Linux sandbox. Angular185/build/API без diff; реальные обычные сценарии, импортированные страницы и итоговые Caddy/V8/container-runner1280/390 прошли. Зашифрованное восстановление проверено с входом/скачиванием; helper переноса прошёл7 реальных сценариев и отдельную Windows/native регрессию очистки. Итоговый независимый обзор соединений модулей дополнен отдельными независимыми обзорами окончательных parity/cutover изменений. Внешнее хранилище и systemd подготовлены как проверенные скрипты/шаблоны; реального внешнего развёртывания не было. После команды владельца «Запускай сайт» выполнен локальный переход: финальный закрытый снимок, импорт настоящих данных, точное сохранение учётных записей, зашифрованная копия с проверкой восстановления и установка нового launcher в исходный каталог. На рабочем4173 проверены принятая сборка, API и приватные GET/HEAD; реальный пароль владельца не запрашивался и не сбрасывался. Подробности и промежуточные ошибки служебного сценария записаны в task-15-actual-cutover-report.md.

## Порядок исполнения и разделение работы

- Последовательный фундамент: Tasks 1 → 2 → 3. После фиксации OpenAPI и LessonRef можно параллельно готовить Tasks 4/6 и Angular Tasks 10/11; frontend проверяется сначала через HTTP fixtures, затем обязательно с реальным backend.
- Files Task 4 → Homework Task 5; Practice Task 6 → Queue Task 7 → Worker Task 8. Draft/catalog и blob код имеют разных владельцев; общие contracts/Flyway редактирует интегратор последовательно.
- Import Task 9 после Tasks 1–8; материалы/Markdown Task 12 после 3/4/10, homework UI Task 13 после 5/10/11, practice UI Task 14 после 6/7/8/10/11.
- Task 15 завершает весь перенос. Реализация задач не начинается до проверки этого плана пользователем. Ранее согласованный выбор субагентов сохраняется; повторного выбора метода не требуется.

## Самопроверка покрытия

- Spec 1–3: baseline/current working copy, stack и отдельные runtime — Tasks 1, 8, 10, 15.
- Spec 4–5: tenant ownership, admin/invites, пароли, сессии — Tasks 1–2 и UI Task 10.
- Spec 6–7: весь текущий UI, ссылки, тексты, материалы, файлы, ДЗ — Tasks 3–5, 10–13.
- Spec 8: каталог/immutable revisions, очередь/worker, code recovery — Tasks 6–8, 14.
- Spec 9: OpenAPI, ошибки/пагинация, идемпотентность и диагностика — Tasks 1–7, 10, 15.
- Spec 10: JSON/пароли/blobs/legacy defaults, dry-run и rollback boundary — Tasks 9, 15.
- Spec 11: единая приёмка и отсутствие Node/Python runtime — Task 15; критерии этапов доказываются предыдущими задачами, не заменяются наличием сборки.

Пять Review Focus рисков имеют тесты в указанных задачах. Названия DTO и путей задаются в общих контрактах и расширяются в задачах-владельцах; дублирующие backend/frontend модели вручную не поддерживаются. Изменения опубликованного интерфейса сначала вносятся в OpenAPI и contract tests, затем в потребителей.
