# Авторизация и регистрация — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Добавить вход, регистрацию ученика по приглашению и серверные права доступа, сохранив существующие занятия, решения и оформление.

**Architecture:** Отдельный auth-сервис хранит аккаунты и одноразовые токены, выдаёт серверные cookie-сессии. Общая политика проверяет пользователя до доступа к учебной базе, практике и файлам. Закрытые материалы выносятся из публичной сборки; UI запускается после загрузки сессии и разрешённого контента.

**Tech Stack:** Node.js 22+, CommonJS, node:http, node:crypto/scrypt, атомарное JSON-хранилище, браузерный JavaScript, существующий Monaco, node:test, Python Markdown compiler.

**Spec:** [Регистрация и доступ к кабинету](../specs/2026-09-30-auth-registration-design.md).

Статус: реализовано и проверено 30.09.2026. Независимое итоговое ревью завершено, подтверждённые замечания исправлены. Финальный набор: 233 теста, 232 PASS, 0 FAIL, 1 платформенный SKIP; compiler/check.cjs PASS. Рабочие учётные данные создаёт пользователь; публикация не выполнялась.

## Global Constraints

- Node.js 22+, CommonJS, существующий Node HTTP server и браузерный JavaScript; новые runtime npm-зависимости не требуются.
- Один процесс приложения; файловое хранилище не используется несколькими процессами одновременно.
- Существующие `data/mentoring.json`, `data/practice/**` и идентификаторы учеников/занятий сохраняются без миграции содержимого.
- Все тесты с записью используют отдельный временный `dataDir`. Рабочие учётные записи и приглашения при разработке не создаются.
- Русский интерфейс, текущая зелёная и песочная палитра, объединённая шапка и боковое меню сохраняются.
- Локально остаётся привязка к `127.0.0.1`; публикация, настройка домена и рассылка не выполняются этой задачей.
- На хостинге: HTTPS перед Node, `NODE_ENV=production`, `MENTOR_PUBLIC_ORIGIN=https://<домен>`, `MENTOR_JAVA_MODE=docker` либо `disabled`; при ошибке Docker перехода на локальную Java нет.
- Пароли, сессии и одноразовые токены не попадают в Git, URL query, журналы, `/api/state` или публичный контент.
- Сохранить уже существующие незакоммиченные изменения; перед исполнением сделать ограниченный снимок затрагиваемых файлов. Не выполнять автоматический `git add .`, commit, push или публикацию.

## Review Focus

- Два запроса одновременно погашают одно приглашение: ровно один аккаунт и одна успешная регистрация; тест Task 1.
- Старая вкладка сохраняет работу после смены аккаунта в другой: отказ до записи, предыдущий черновик не теряется и не показывается другому пользователю; Tasks 2 и 5.
- Прямой GET/HEAD старого ZIP, `content.js` или персонального HTML обходит UI: данные не возвращаются ни гостю, ни постороннему ученику; Task 4.
- Сессия/назначение меняется во время Java-проверки: результат относится к прежней попытке, отозванному пользователю не выдаётся приватный ответ; Task 3.
- Сбой записи, повреждение auth-файла или перезапуск во время регистрации: исходная учебная база цела, нет повторно действующего потраченного токена или открытого режима; Tasks 1 и 7.

## Карта файлов

- `lib/auth-passwords.cjs`: валидация/хеширование паролей, ограничение тяжёлых вычислений.
- `lib/auth-store.cjs`: формат accounts.json, lock единственного писателя, синхронные атомарные транзакции.
- `lib/auth-service.cjs`: аккаунты, приглашения, восстановление, сессии и их отзыв.
- `lib/request-security.cjs`, `lib/auth-api.cjs`: Origin/Host, лимиты, cookie, HTTP-контракты авторизации.
- `lib/access-policy.cjs`: правила ролей, владение, проекция учебной модели.
- `lib/materials-api.cjs`: частный manifest, разрешённый контент и скачивания.
- `scripts/auth-admin.cjs`: первоначальное создание преподавателя и аварийная смена его пароля, пока сервер остановлен.
- `dist/auth.js`, `dist/auth.css`: вход, регистрация, пароль и жизненный цикл сессии.
- `dist/account-access.js`: управление приглашениями/доступом из карточки ученика.
- `server.cjs`, `lib/practice-api.cjs`: подключение единой авторизации перед доступом к данным.
- `compile_content.py`, `dist/app.js`, `dist/student-cabinet.js`: перенос частных констант/снимков и использование разрешённого контента.
- `dist/index.html`, `dist/portal.js`, `dist/practice.js`: порядок запуска и завершения UI, привязка запросов/черновиков к аккаунту.
- `test/auth-*.test.cjs`, `test/access-policy.test.cjs`, `test/materials-access.test.cjs`: новые содержательные проверки.
- Существующие `test/server.test.cjs`, `test/practice-api.test.cjs`, `test/practice-integration.test.cjs`, `test/document-ui.test.cjs`, `test/practice-ui.test.cjs`, `check.cjs`, `README.md`: адаптация контрактов и проверки прежнего поведения.

## Контракты между задачами

`PublicAccount={id,login,role:'teacher'|'student',studentId:string|null}`; `Principal=PublicAccount & {authVersion:number, sessionHash:string}`. Клиент не присылает Principal — только сервер создаёт его из сессии.

`SessionIssue={account:PublicAccount, token:string, csrfToken:string}` — внутренний результат входа. HTTP передаёт token только в HttpOnly cookie. Ошибки модулей: `Error & {status:number,code:string,retryAfter?:number}`.

`PasswordHash={algorithm:'scrypt',N:131072,r:8,p:1,saltBase64:string,hashBase64:string}`. `SessionContext={principal:Principal,csrfToken:string}`. `AccessView={account:(PublicAccount & {disabled:boolean})|null,invitation:{id:string,expiresAt:string}|null}`. Время в JSON — ISO 8601 UTC; внутренние clock/сроки — миллисекунды. `AuthOptions={clock?:()=>number,publicOrigin?:string,production?:boolean}`; значения по умолчанию — Date.now, MENTOR_PUBLIC_ORIGIN и NODE_ENV. Опции конструктора задаются доверенным кодом сервера/тестами, никогда HTTP-запросом.

`createAuthService({dataDir,getStudent,clock?})` возвращает интерфейс ниже. `getStudent(id)` читает существующую карточку или возвращает null. `clock()` возвращает миллисекунды; по умолчанию Date.now.

- `setupTeacher({login,password}):Promise<PublicAccount>` — только CLI, если преподаватель ещё отсутствует.
- `login({login,password}):Promise<SessionIssue>`.
- `register({token,login,password}):Promise<SessionIssue>`.
- `session(token):{principal:Principal,csrfToken:string}|null`, `logout(token):void`.
- `changePassword(principal,{currentPassword,newPassword}):Promise<SessionIssue>`.
- `access(principal,studentId):AccessView`, где AccessView — JSON из spec `/access`.
- `invite(principal,studentId):{id,token,expiresAt}`, `revokeInvite(principal,studentId,id):void`.
- `setDisabled(principal,studentId,disabled):AccessView`.
- `issueReset(principal,studentId,currentPassword):Promise<{token,expiresAt}>`.
- `resetPassword({token,newPassword}):Promise<void>`.
- `resetTeacherPassword({login,newPassword}):Promise<void>` — только CLI, увеличивает authVersion.
- `assertActive(principal):void`, `close():void` — отзыв/освобождение lock.

## Task 1: Аккаунты, пароли и одноразовые токены

**Files:** создать `lib/auth-passwords.cjs`, `lib/auth-store.cjs`, `lib/auth-service.cjs`, `test/auth-store.test.cjs`, `test/auth-service.test.cjs`.

**Interfaces:** производит `createAuthService` и типы выше. Внутри: `hashPassword(password):Promise<PasswordHash>`, `verifyPassword(password,hash):Promise<boolean>`; `createAuthStore({dataDir}) → {read(),update(mutator),close()}`. `update` принимает синхронный mutator состояния и атомарно фиксирует результат, без await внутри.

- [x] **1. Написать тесты:** нормализация логина; соль различается для одного пароля; правильный/неверный пароль; Unicode/пробелы/8–128 символов/512 байт; неизвестный логин проходит фиктивный KDF; неизвестные role/studentId поля регистрации отвергаются. После invite→register проверять прежний studentId и неизменные хеши учебных файлов.
- [x] **2. Добавить проверки транзакций:** параллельный `Promise.allSettled([register(input),register(input)])` имеет один fulfilled; использованная/истёкшая/отозванная ссылка не действует; в accounts.json нет raw токена/пароля. Ошибка rename оставляет старое валидное состояние и не помечает регистрацию успешной. Повреждённый JSON не восстанавливается пустой базой. Второй писатель не получает lock.
- [x] **3. Выполнить `node --test test/auth-store.test.cjs test/auth-service.test.cjs`:** ожидается FAIL из-за отсутствующих модулей/методов, не из-за синтаксиса теста.
- [x] **4. Реализовать хранение и все методы сервиса по spec:** scrypt N=131072/r=8/p=1/maxmem=192 MiB, два активных KDF и очередь 8; приглашения 72 часа, reset 30 минут; уникальная связь с карточкой. Повторная проверка после KDF перед синхронным commit. Сессии в памяти 8 часов idle/7 дней absolute/пять штук; disabled/authVersion проверяются на каждом запросе.
- [x] **5. Проверить фальшивым clock границы срока ровно expiresAt, отзыв всех сессий при блокировке/reset и отсутствие сессий после создания нового сервиса. Повторить команду из шага 3; ожидается PASS.** Зафиксировать ограниченный diff этой задачи для ревью, без автоматического commit.

## Task 2: HTTP-вход, cookie, CSRF и первоначальный преподаватель

**Files:** создать `lib/request-security.cjs`, `lib/auth-api.cjs`, `scripts/auth-admin.cjs`, `test/auth-api.test.cjs`, `test/request-security.test.cjs`; изменить `server.cjs`.

**Interfaces:** потребляет auth-service. `createRequestSecurity({publicOrigin,production,clock?}) → {check(request,server,writing),limit(request,action,login?)}`. `action` — login/register/reset/other, определённый обработчиком, не телом запроса. `createAuthApi({auth,security,originFor}) → async handle(request,response,pathname):boolean`. `originFor(request):string` возвращает настроенный public origin либо уже проверенный локальный origin. `resolveAuth(request,auth,production)` возвращает SessionContext либо null; `requireMutation(request,session)` проверяет CSRF и ожидаемый accountId. Эти два helper экспортируются из auth-api.

- [x] **1. Написать HTTP-тесты** точных контрактов `/api/auth/*` и учительских `/access`, `/invitations`, `/password-reset` из spec. Проверять HttpOnly/SameSite/Path/отсутствие Domain; Secure/__Host- только production; токен не присутствует в JSON. Logout инвалидирует cookie, восстановление не входит автоматически. Учительская роль не появляется из request body.
- [x] **2. Добавить тесты защиты:** неверный/отсутствующий Origin, cross-site, content-type и собственный заголовок; чужой Host/X-Forwarded-*; неверный CSRF; `X-Mentor-Account` старой вкладки → 409 и ноль мутаций. Лимиты логина 10/15 минут, IP 100/15 минут, register/reset 20/15 минут, общий 120/мин; 429/Retry-After и сброс по clock. Переполнение таблицы/очереди не снимает блокировку.
- [x] **3. Запустить `node --test test/auth-api.test.cjs test/request-security.test.cjs`:** получить ожидаемый FAIL.
- [x] **4. Реализовать endpoints и cookie-обвязку.** Одинаковая 401 `Неверный логин или пароль.` при неизвестном/неверном/disabled. Публичный `/me` возвращает null гостю. Защита запросов выполняется до чтения JSON; auth body limit 16 KiB. Не включать CORS; origin для ссылок берётся из конфигурации, не из непроверенного Host.
- [x] **5. Реализовать CLI:** `node scripts/auth-admin.cjs setup` и `node scripts/auth-admin.cjs reset-teacher`, опциональный `--data-dir` только для выбора хранилища. Логин и пароль читаются с TTY, пароль без echo; не принимать пароль в argv/env. Команды не работают одновременно с сервером и не выводят пароль/хеш. Пустая auth-база показывает в UI необходимость первоначальной настройки, а не публичную регистрацию преподавателя.
- [x] **6. Повторить тесты и отдельный CLI smoke на временном dataDir, проверить production без HTTPS origin/с локальной Java отклоняется.** Обычный запуск и health остаются на loopback; `start-local.ps1` не требует cookie для health. Не запускать setup на рабочей базе.

## Task 3: Серверные права на базу и практику

**Files:** создать `lib/access-policy.cjs`, `test/access-policy.test.cjs`; изменить `server.cjs`, `lib/practice-api.cjs`, `test/server.test.cjs`, `test/practice-api.test.cjs`, `test/practice-integration.test.cjs`; при необходимости общий `test/helpers/auth.cjs`.

**Interfaces:** `requireTeacher(principal)`, `requireStudentOwner(principal,studentId)`, `requireLessonReader(principal,state,studentId,lessonId)`, `stateFor(principal,state)`; исключения по spec. `createPracticeApi(...)` получает `auth/access`, обработчик становится `handle(request,response,pathname,principal)`. Отсутствующий principal не допускается даже при прямом вызове модуля из тестов.

- [x] **1. Создать fixture teacher + student A + student B с разными данными и marker-строками в notes/teacherNotes.** Параметризовать все существующие endpoints из spec по гостю, владельцу, другому ученику и преподавателю. Проверять фактическое тело ответа и отсутствие запрещённых полей, не только status.
- [x] **2. Добавить проверки отказа до side effects:** чужой GET не создаёт practice lesson; запрещённый POST не читает большой upload и не вызывает runner; teacher preview не сохраняет черновик, не добавляет попытку/сдачу. Подмена sid/lid/eid/attemptId/submissionId, в том числе существующих по отдельности, не проходит.
- [x] **3. Запустить `node --test test/access-policy.test.cjs test/server.test.cjs test/practice-api.test.cjs test/practice-integration.test.cjs`:** ожидаемый FAIL по новым ограничениям.
- [x] **4. Встроить policy до store/practice dispatch и файловых операций.** Использовать allowlist полей из spec для stateFor, сохранять внутреннюю полную модель store. Каталог/assign/review/card mutations — teacher; draft/attempt/upload — student owner; чтение — teacher либо owner.
- [x] **5. Тестировать отложенный runner:** авторизованная попытка завершилась после logout/block; история принадлежит исходной цепочке, повторная проверка сессии запрещает выдачу приватного результата. Удаление назначения во время запуска не создаёт чужую попытку. Удалённое до начала запуска назначение не запускает runner.
- [x] **6. Повторить команду шага 3:** PASS, затем сверить неизменные хеши fixture учебных данных после запрещённых операций. Не ослаблять production-проверки ради прежних тестов; авторизовать fixtures явным входом.

## Task 4: Убрать обход через публичные материалы

**Files:** создать `lib/materials-api.cjs`, `test/materials-access.test.cjs`; изменить `compile_content.py`, `server.cjs`, `dist/app.js`, `dist/student-cabinet.js`, `test/document-ui.test.cjs`, `check.cjs`, `.gitignore`; генерация `private/materials/**` вместо частных файлов в `dist`.

**Interfaces:** `createMaterialsApi({root,store,access}) → {contentFor(principal), handle(request,response,pathname,principal):Promise<boolean>}`. `contentFor` выдаёт `{docs,code,viewData,sha?}`; `viewData.teacher` никогда не выдаётся ученику. `LESSON_UI.setContent(snapshot)` заменяет снимок; `LESSON_UI.content` — getter актуального снимка для student-cabinet. Manifest содержит `{id,file,studentId,lessonId?,bundleId?,audience,contentType,filename}` с явными безопасными путями.

- [x] **1. Написать тесты доступа к content/material IDs для четырёх ролей fixture:** ученик A не получает документы B; новый ученик не получает комплект Михаэля; teacher имеет приватные решения; student — только разрешённые docs и starter code. Неизвестный/путевой ID не читается с диска.
- [x] **2. Зафиксировать обходы:** анонимный и чужой GET/HEAD `/content.js`, `/downloads/teacher-lesson-2026-09-27.zip`, `/downloads/ListSolutions.java`, `/downloads/student-lesson-2026-09-27.zip`, `/student.html`, encoded traversal и symlink не выдают private bytes. Старые файлы специально оставить в тестовом staticRoot, чтобы доказать server deny, а не только отсутствие файла.
- [x] **3. Выполнить `node --test test/materials-access.test.cjs`:** ожидаемый FAIL на существующей раздаче статики.
- [x] **4. Перенести генерацию в private/materials и создать manifest.** Перенести персональные константы lesson/review/profile/goal из публичных JS в private viewData; шаблоны рендерят разрешённые значения. Не использовать JSONP/исполняемый snapshot. Чтение JSON сервером, фильтрация до отправки. Сохранить excerpts, полный код, маршрут/ревью и архивы без преподавательских решений у ученика.
- [x] **5. Разрешить публичную статику только по явному списку общих файлов и проверенному vendor-поддереву.** Закрытые старые пути всегда отклоняются. Обновить ссылки скачивания на `/api/materials/:id`, сохранить attachment/nosniff/no-store и containment. Самостоятельный HTML упаковать со стилями, без приватных URL и inline-действий; исходные content-файлы не менять без необходимости.
- [x] **6. Обновить check.cjs/document fixtures для новых мест генерации, проверить marker-строками отсутствие персональных сведений/решений в публичных JS.** `python compile_content.py` без `--refresh`; затем `node --test test/materials-access.test.cjs test/document-ui.test.cjs` и `node check.cjs` → PASS. Проверить ZIP и воспроизводимость повторной сборки.

## Task 5: Экран входа и безопасный жизненный цикл кабинета

**Files:** создать `dist/auth.js`, `dist/auth.css`, `test/auth-ui.test.cjs`; изменить `dist/index.html`, `dist/portal.js`, `dist/practice.js`, `test/practice-ui.test.cjs`.

**Interfaces:** `window.MENTOR_AUTH={start(),session(),request(path,options),subscribe(listener),logout(),showLogin(),showPasswordForm()}`; `session()` возвращает `{account,csrfToken}` либо null. request добавляет credentials/same-origin и заголовки защиты, не повторяет мутации автоматически после 401/409. События session-null/session-account запускают stop/start портала. `MENTOR_PRACTICE.beforeLogout():Promise<boolean>` возвращает false при отмене пользователем; `dispose({clearAccountCache?:boolean})` освобождает редакторы и запросы.

- [x] **1. Написать тесты входа/регистрации/выхода с поддельными API и DOM:** гостю не загружается private content; роль из cookie/me, query/hash не даёт teacher; безопасный внутренний next-route; нет редиректа на внешний URL. Токен из fragment очищается, не попадает в storage/referrer/логи. Показ пароля не меняет его значение.
- [x] **2. Написать проверки поздних ответов и смены аккаунта:** 401 останавливает autosave; 409 ACCOUNT_CHANGED не повторяет запись; новые cookie другой вкладки не дают старому draft отправиться от другого accountId. Повторный вход владельца восстанавливает его несохранённый текст, другой аккаунт не видит его. Учительский preview не создаёт draft session.
- [x] **3. Выполнить `node --test test/auth-ui.test.cjs test/practice-ui.test.cjs`:** получить FAIL по отсутствующим контрактам.
- [x] **4. Изменить boot:** сначала /me, затем параллельно /api/state и /api/content, setContent, затем запуск portal. Удалить автоматическую загрузку content.js и ранний refresh в portal.js; обрабатывать #login/#register/#reset-password/#account отдельно. Обёртка auth.request используется и portal, и practice. После смены пользователя все предыдущие generation/caches/DOM уничтожаются.
- [x] **5. Реализовать формы в прежнем стиле:** labels, autocomplete username/current-password/new-password, aria-live ошибки, disabled во время отправки, paste/password manager разрешены, Enter работает, повторные запросы не дублируются. Истёкшее приглашение объясняет необходимость новой ссылки, не показывает чужую карточку. Смена пароля доступна обоим ролям.
- [x] **6. Добавить accountId в draft recovery key и handshake мутаций.** Проверка session на focus и BroadcastChannel. Выход пытается сохранить, при ошибке предлагает экспорт/отмену/явный выход; не стирать unsaved молча. Старые anonymous recovery не присваиваются произвольному аккаунту; преподавателю локально доступен экспорт. Сохранить существующую защиту revision и compare-and-delete.
- [x] **7. Повторить тесты шага 3, проверить сохранение ранее открываемых deep links и сброс оболочки после выхода.** Никаких cookie/token в localStorage, пароли не сохраняются приложением.

## Task 6: Управление доступом из карточки ученика

**Files:** создать `dist/account-access.js`, `test/account-access.test.cjs`; изменить `dist/portal.js`, `dist/index.html`, `dist/auth.css`.

**Interfaces:** `window.MENTOR_ACCOUNT_ACCESS.mount(container,{studentId,auth})`, `dispose()`. Потребляет endpoints /access/invitations/password-reset Task 2 и `MENTOR_AUTH.request`. Показывает только metadata; raw ссылка видна только после создания и не запрашивается повторно.

- [x] **1. Написать тесты переходов:** нет аккаунта → приглашение → отозвано/истекло → зарегистрирован → disabled/enabled; повторный click не создаёт два приглашения. Ответ старой карточки не появляется в новой. Кнопки восстановления отсутствуют без аккаунта, кнопка приглашения — после регистрации.
- [x] **2. Запустить `node --test test/account-access.test.cjs`:** ожидаемый FAIL.
- [x] **3. Добавить компактный блок «Доступ к кабинету» в преподавательскую карточку.** Кнопки «Создать приглашение», «Копировать ссылку», «Отозвать», «Приостановить доступ», «Восстановить доступ», «Ссылка для смены пароля». При reset — поле текущего пароля преподавателя, очищаемое после запроса. Не отправлять ссылки автоматически и не хранить их в модели карточки.
- [x] **4. Кнопка выхода показывает текущий логин/роль, teacher preview помечен как просмотр.** В настоящем ученическом кабинете нет учительского управления. Проверить clipboard fallback без ложного сообщения «скопировано».
- [x] **5. Повторить тесты и браузерный цикл на временном dataDir:** создать карточку, скопировать приглашение, зарегистрироваться в отдельной сессии, увидеть прежние данные; блокировка делает старую cookie недействительной. Проверить компьютер, 390px и клавиатуру.

## Task 7: Сквозная проверка, сохранность и инструкция запуска

**Files:** создать `test/auth-integration.test.cjs`; изменить `README.md`, при необходимости `start-local.ps1` только для понятной первоначальной настройки, не для обхода входа.

**Interfaces:** полный `createServer({dataDir,staticDir,practiceCatalog,practiceRunner,authOptions?,materialsDir?})` с изолированными fixture-папками. Только clock/каталог/runner подменяются в тестах; нет `skipAuth` production-переключателя.

- [x] **1. Написать сквозной тест:** копия существующей mentoring/practice базы → setup teacher → invite существующего sid → register → login → own lesson → draft → attempt → upload → teacher review → logout → reset → login. Проверить исходные ID, ранее сохранённые файлы, попытки, отзывы и оригинальные рабочие хеши. Использовать fake runner для матрицы прав, один реальный Docker smoke для связки авторизации с проверкой.
- [x] **2. Проверить перезапуск и отказы:** accounts/invites сохраняются, сессии отзываются, использованный token остаётся использованным; повреждение accounts.json не открывает доступ. Пропавшая связанная карточка даёт отказ, не создаётся заново. Неавторизованный запрос не запускает runner и не меняет ни один файл данных.
- [x] **3. Выполнить `node --test` и `node check.cjs`:** все тесты PASS. `python compile_content.py` не возвращает закрытый снимок в dist. Проверить diff на секреты, временные fixtures и непреднамеренную правку старых данных.
- [x] **4. Браузерная приёмка в временной базе:** вход/регистрация/ошибки/выход, неверный invite, учитель и два ученика, прямые запрещённые URL, teacher preview, истечение сессии и несохранённый Monaco, смена аккаунта в другой вкладке, узкий экран. Сохранить скриншоты форм и кабинета без паролей/одноразовых ссылок. После проверки закрыть тестовые серверы/вкладки, вернуть viewport.
- [x] **5. Обновить README:** команды первоначального teacher setup/recovery при остановленном сервере; логин ученика и приглашения; резервная копия всего data включая auth; потеря сессий после рестарта; отказ от прежнего «screen=student — только отображение». Для будущего хостинга указать HTTPS origin, loopback reverse proxy с сохранением Host, отсутствие прямой раздачи private/project, Docker-only/disabled, один Node worker и лимит request body для существующего upload. Не публиковать сайт автоматически.
- [x] **6. Провести независимое итоговое ревью авторизации и данных; исправить подтверждённые замечания, повторить затронутые проверки.** Отчёт пользователю отделяет готовую реализацию от оставшегося пользовательского шага создания настоящего пароля и от будущего размещения на хостинге.

## Самопроверка плана

- Сценарии входа/приглашения/восстановления/выхода покрыты Tasks 1, 2, 5, 6.
- Права на данные и прямые скачивания покрыты Tasks 3, 4; backend не доверяет режиму UI.
- Все пять Review Focus имеют конкретные тесты, включая гонку, поздний ответ и отказ записи.
- Все новые интерфейсы имеют производящую задачу; приватный content загружается до рендера, а auth-сервис до dispatch.
- Локальные рабочие данные не используются для тестовых записей, существующий runner не переписывается.
- Пользователь подтвердил регистрацию по приглашению и реализацию субагентами. Spec прочитан вместе с планом; интеграционные файлы изменяются последовательно, границы доступа проходят отдельное ревью.


## Фактическая приёмка

Регистрация, восстановление пароля, ошибки токенов, сессии и гонки проверены HTTP/VM-тестами. В браузере проверены вход и выход преподавателя и двух учеников, редактор и сохранение в отдельной тестовой базе, просмотр преподавателем, запрет чужого кабинета, формы, очистка приватного DOM, клавиатура и ширина 390px. Новые пароли через браузер не вводились. Исходные mentoring.json и practice/state.json сохранили SHA256. Два прежних ZIP остались на диске после запрета автоматической очистки; сервер не раздаёт их по старым адресам. Рабочее дерево и резервный снимок сохранены без коммитов.
