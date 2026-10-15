# Команда платформы и бэклог доработок

Дата: 15 октября 2026. Источник: шесть ролевых аудитов исходников (только чтение, без сборки и запуска). Каждая роль прошла свою область репозитория и вернула список задач с приоритетами; этот документ сводит их в один бэклог, снимает дубли и расставляет волны. Полные таблицы по ролям — в конце.

Приоритеты: **P0** — риск потери данных или блокирует реальное использование; **P1** — нужно до публикации в интернет или заметно улучшает ежедневную работу; **P2** — техдолг и удобство; **P3** — идеи и улучшения. Оценка: S — до дня, M — 1–3 дня, L — неделя и больше.

## 0. Ход работ

| Дата | Что сделано | Коммит |
|---|---|---|
| 15.10.2026 | Волна 0 целиком: INF-01, INF-02, INF-03, INF-05, INF-14, Q-01, Q-04, UX-01, UX-09 | 208e52f |
| 15.10.2026 | Кабинет 4173 переведён на релиз local-20261015b (волны 0–1, V13+V14) в 04:01 МСК; копия перед переключением проверена восстановлением | ebb5534 |
| 15.10.2026 | Волна 1, T01: публикация материалов из продукта, статус занятия planned/prepared, форма и удаление материалов | eec54bf |
| 15.10.2026 | Волна 1: T02 (ход по упражнениям-ДЗ, `kind` хода), T06 (колонка ходов у ученика), T07 (архив ученика, удаление пустого занятия), UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, UX-08, Q-11 (статус исполнителя). Бюджет initial bundle поднят до 640 кБ до FE-01 | 01d6f6a |

| 15.10.2026 | Кабинет 4173 переведён на релиз local-20261015c (волна 2, без миграций) в 05:13 МСК; контейнеры healthy, копия проверена восстановлением | 367fb1a |
| 15.10.2026 | Волна 2: B-01 (лимитер: чтения per-IP, записи глобально), B-02 (блокировка после 20 неверных паролей, счёт после проверки), B-03 (логи 5xx с requestId в MDC), B-04/INF-06 (actuator, healthcheck backend и web, ожидание готовности без auth-маршрута), B-05/INF-11 (HSTS, Permissions-Policy), B-06 (409 CONFLICT на нарушение ограничений БД), B-10 (multipart на том spool), INF-07 (лимиты ресурсов), INF-08 (сеть job_edge для публикации gateway), INF-09 (issue-job-tls.ps1), INF-10 (rotate-database-password.ps1 и раздел ротации), INF-12 (multi-stage Dockerfile), INF-13 (ci.yml), INF-16 (notify.ps1, status-alerts, задача статуса), INF-21 (disaster-recovery.md), Q-09 (ContractRouteCoverageTest), Q-10 (api:check). Q-02/Q-03 — отдельная сессия: stage3-real.spec.ts, tenant-isolation переписан, найден и исправлен дефект колонки «Чей ход» у ученика | cd34409 |

| 15.10.2026 | Волна 3: FE-01 (все экраны после входа — ленивые чанки, initial 605 → 482 кБ, бюджет снова 600), FE-02 (GET /students/dashboards, список учеников без N+1), FE-03 (тренажёр разложен на exercise-list, exercise-statement, editor-panel, attempt-result, attempt-history, PracticeSessionStore; FE-08 и UX-22 в тренажёре), FE-06 (ESLint angular-eslint с префиксом mentor, Prettier, .editorconfig, `npm run lint` без ошибок), FE-14 (mentor-pagination, fileSize pipe, mentor-error-banner), UX-10…UX-17, UX-19…UX-22, UX-24 (валидация под полем, один `.tag`, сведённые стили, словарь терминов, фокус на подтверждение, индикатор вкладок), Q-05, Q-06, Q-08, Q-12, Q-15, B-17 (тесты журнала, конфликтов ревизий, граней ходов, комментариев; таймзависимость; индексы V15). Unit 206 → 223, UI 31, backend см. отчёт | см. git log |

Остаток волны 3: Q-14 (общий Spring-контекст), Q-16/Q-17 (trace Playwright, отчёт покрытия), B-07/B-08 (списки занятий и материалов в SQL), B-14 (форматтер Java), FE-04/FE-05 (единая привязка к сессии, resource()), FE-11/FE-12 (спеки без тестов, хрупкость e2e), UX-18, Q-18, INF-18…INF-20, INF-23. UX-20 в карточке ученика (student-page) не переведён на mentor-pagination.
Остаток волны 1: нет (Q-02/Q-03 закрыты отдельной сессией). UX-18 закрыт в составе T01. Из волны 2 не сделано: INF-15 в части сбора логов в агрегатор (включён только JSON-формат), B-09 (бюджет scrypt — покрыт лимитом памяти контейнера). Новое замечание из e2e: страница чужой карточки под `/learn/students/<id>/lessons` показывает сырое английское «Resource unavailable.» вместо русского сообщения (UX-26, S, `students/student-page.component.ts`, `shared/ApiExceptionHandler`).

## 1. Состав команды и роли

| Роль | Зона ответственности | Что ведёт в бэклоге |
|---|---|---|
| **Владелец продукта** (Георгий — наставник и единственный оператор) | Приоритеты, ответы на открытые вопросы, приёмка | Решения по разделу 4 |
| **Продакт-аналитик** | Сценарии трёх ролей, продуктовые разрывы, ценность функций | T-xx |
| **UX/UI-дизайнер** | Дизайн-система «Партия», состояния экранов, микрокопия, доступность, адаптивность | UX-xx |
| **Фронтенд-лид (Angular)** | Архитектура клиента, производительность, инварианты сессии, инженерная база | FE-xx |
| **Бэкенд-лид и безопасность (Java / Spring)** | API, границы workspace, данные, аутентификация, лимиты, наблюдаемость | B-xx |
| **DevOps / SRE** | Compose, образы, копии, восстановление, релизы, переезд на VPS, CI | INF-xx |
| **QA-лид** | Тестовая стратегия, покрытие, ворота релиза, интеграционные сценарии | Q-xx |

Правило работы: каждая задача имеет одного владельца-роль; смежные роли указаны в описании. Задачи, которые нашли две роли независимо, объединены (например, health-check нашли бэкенд и DevOps, лимитер — бэкенд и DevOps, контрактный тест — бэкенд и QA).

## 2. Общая картина

Что работает цельно: учебный цикл «занятие → тексты → упражнения → сдача → ревью → оценка → ходы → маршрут» собран на сервере и в интерфейсе последовательно. Права и изоляция пространств проверяются на каждом эндпоинте, SQL параметризован, ревизии защищены CAS, файловый контур аккуратен. Инфраструктура выше среднего: образы закреплены по digest, контейнеры без привилегий, резервная копия согласованна и проверяется восстановлением. Тесты: около 100 файлов, backend на настоящем PostgreSQL.

Главные разрывы, по которым сошлись несколько ролей:

1. **Материалы занятия нельзя добавить из приложения.** Таблица материалов заполняется только импортом, занятия из интерфейса никогда не становятся «Подготовлено», вкладка «Материалы» пуста, комплекты публикуются SQL-скриптами мимо продукта (T01, UX-18).
2. **Данные реальных учеников защищены копией, но не процедурой.** Нет скрипта восстановления в рабочий контур, копии делаются вручную, пароль шифрования лежит рядом с данными, у git нет remote, образы живут только на этой машине (INF-01…04).
3. **Прод-готовность для интернета.** Один глобальный лимит 120 запросов в минуту на анонимный запрос сессии даёт тривиальный отказ входа всем; блокировка логина до проверки пароля; ни одного лога ошибок; нет health-check; нет HSTS (B-01…05, INF-06, INF-11).
4. **Недавние функции проверены только фикстурами.** Оценки, «Проведено», маршрут, ходы, комментарии к коду не имеют ни одного сквозного теста с настоящим backend; интеграционный тест тренажёра привязан к удалённому пути и не запускается (Q-02…04).
5. **Форма кода.** Однострочники в шаблонах и сервисах на обоих концах, нет линтера и форматтера, 12 разных реализаций одного паттерна привязки к сессии (FE-03…06, B-14).
6. **Семантика штриховки перегружена.** Легенда обещает «штриховка всегда значит: ученик этого не видит», но она же означает «ход за вами» и «текущий этап» (UX-02).

## 3. Объединённый бэклог по волнам

### Волна 0. Защитить то, что уже работает (1–2 недели)

| ID | Задача | Роль | Приоритет | Оценка |
|---|---|---|---|---|
| INF-01 | Скрипт `restore-platform.ps1` и runbook восстановления в рабочий контур | DevOps | P0 | M |
| INF-02 | Ежедневная копия по Task Scheduler с обязательным offsite и алертом по `failed.json` | DevOps | P0 | S |
| INF-03 | Вынести пароль шифрования копий и секреты с машины, зафиксировать процедуру | DevOps | P0 | S |
| INF-04 | Git remote и хранение образов вне машины | DevOps | P0 | S |
| Q-01 | Идемпотентность сдачи ДЗ: повтор после «результат неизвестен» создаёт дубль | QA + Backend | P0 | M |
| UX-09 | Сбрасывать форму ДЗ после успешной отправки (та же причина дублей со стороны UI) | Design + Frontend | P1 | S |
| Q-04 | Починить `practice-real.spec.ts`: убрать зашитый путь удалённого worktree | QA | P0 | S |
| UX-01 | Добавить иконку `chevron-up`: кнопка «Поднять этап» рендерится пустой | Design + Frontend | P0 | S |
| INF-05 | Runbook обновления и отката релиза в репозитории, а не в памяти ассистента | DevOps | P1 | S |
| INF-14 | Расширить `.gitattributes`: LF для Dockerfile, Caddyfile, yaml, harness | DevOps | P1 | S |

### Волна 1. Закрыть продуктовые разрывы (3–4 недели)

| ID | Задача | Роль | Приоритет | Оценка |
|---|---|---|---|---|
| T01 | Загрузка материалов к занятию из UI с аудиторией и переводом в «Подготовлено» | Product + Backend + Frontend | P0 | L |
| UX-18 | Честный прогресс подготовки занятия (входит в T01) | Design | P2 | M |
| T02 | Часы «чей ход» учитывают упражнения тренажёра с размещением «Домашняя работа» | Product + Backend | P1 | M |
| T06 | Статус ДЗ и фильтр «ждут меня» в списке занятий ученика | Product + Frontend | P1 | S |
| T07 | Удаление и архивирование занятия, архивирование ученика | Product + Backend | P1 | M |
| UX-02 | Развести семантику штриховки: «ход» и «сейчас» другим приёмом | Design | P0 | M |
| UX-04 | Отметить вкладку «План» как приватную | Design | P1 | S |
| UX-05 | Подтверждение для блокировки аккаунта, пространства, приостановки доступа | Design + Frontend | P1 | M |
| UX-03 | Единое обращение к ученику на «ты» в тренажёре | Design | P1 | M |
| UX-08 | Единый формат дат, времени и часового пояса | Design + Frontend | P1 | S |
| UX-06 | Кнопка «+» комментария к строке: размер и видимость | Design | P1 | S |
| UX-07 | Тёмная тема тренажёра покрывает весь экран | Design + Frontend | P1 | M |
| Q-02 | Сквозной сценарий с настоящим backend для функций этапа 3 | QA | P0 | L |
| Q-03 | Браузерный тест смены аккаунта в одной вкладке с настоящим backend | QA | P0 | M |
| Q-11 | Сообщение ученику при простое исполнителя (открыть диагностику очереди) | QA + Backend + Frontend | P1 | M |

### Волна 2. Готовность к публикации в интернет (4–6 недель)

| ID | Задача | Роль | Приоритет | Оценка |
|---|---|---|---|---|
| B-01 / INF-17 | Вывести анонимный `GET /auth/session` из глобального лимита; лимит per-IP и per-session | Backend | P0 | M |
| B-02 | Считать неудачные попытки по логину после проверки пароля, мягкая блокировка | Backend | P1 | S |
| B-03 / INF-15 | Структурное логирование ошибок с `requestId`, JSON-формат, ротация | Backend + DevOps | P1 | M |
| B-04 / INF-06 | Actuator health и метрики, healthcheck backend и web в Compose, закрыть от публичного Caddy | Backend + DevOps | P1 | M |
| B-05 / INF-11 | HSTS и Permissions-Policy в Caddyfile, проверка `Secure` кук в production | Backend + DevOps | P1 | S |
| INF-07 / B-09 / B-10 | Лимиты памяти и CPU контейнеров; multipart вне tmpfs 128 МБ; бюджет scrypt | DevOps + Backend | P1 | S |
| INF-08 | Публикация job-gateway для внешнего runner-хоста (конфликт с internal-сетью) | DevOps | P1 | M |
| INF-09 | Выпуск и ротация TLS для gateway, мониторинг срока | DevOps | P1 | M |
| INF-10 | Процедура ротации секретов: PostgreSQL, worker-credential, пароль копий | DevOps | P1 | S |
| INF-12 | Multi-stage сборка образов без зависимости от Windows-хоста | DevOps | P1 | M |
| INF-13 / Q-13 / FE-18 | CI (GitHub Actions): backend verify, frontend test и build, infra-тесты, образы в GHCR | DevOps + QA | P1 | L |
| Q-09 / B-11 | Контрактный тест backend против `openapi.yaml` | QA + Backend | P1 | L |
| Q-10 | Проверка синхронности `schema.d.ts` с контрактом в воротах релиза | QA | P1 | S |
| INF-16 | Минимальный мониторинг: статус платформы по расписанию и алерт в Telegram или почту | DevOps | P2 | M |
| INF-21 | Документ восстановления после сбоя по сценариям | DevOps | P2 | M |
| B-06 | Классифицировать `DataAccessException`: не всё есть 503 | Backend | P2 | S |

### Волна 3. Техдолг и масштабируемость (параллельно, по мере сил)

| ID | Задача | Роль | Приоритет | Оценка |
|---|---|---|---|---|
| FE-06 | ESLint, Prettier, `.editorconfig` | Frontend | P1 | S |
| FE-01 | Lazy-ветки `teacher/**` и `learn/**`, снять предупреждение бюджета бандла | Frontend | P1 | M |
| FE-02 | Убрать N+1 на списке учеников (агрегирующий ответ backend) | Frontend + Backend | P1 | M |
| FE-03 | Разбить тренажёр на компоненты и store | Frontend | P1 | L |
| FE-04 / FE-05 | Единая утилита привязки к сессии; загрузка через `resource()` вместо HTTP в `effect` | Frontend | P1 | M |
| FE-07 | Очистка черновиков тренажёра из `localStorage` при выходе | Frontend | P1 | S |
| B-07 | Список занятий без полных текстов и без N+1 | Backend + Frontend | P2 | M |
| B-08 | Материалы: фильтрация и пагинация в SQL | Backend | P2 | M |
| B-14 | Форматтер Java в Maven, развернуть однострочники | Backend | P2 | M |
| B-12 / Q-05 / Q-06 / Q-08 / Q-12 | Выделенные backend-тесты: журнал, комментарии, ходы, маршрут, «Проведено» | Backend + QA | P1–P2 | M |
| B-13 / Q-14 / Q-20 | Разбить тесты-«простыни», общий контекст, ускорить набор | Backend + QA | P2 | L |
| Q-07 / FE-11 | Unit-spec для компонентов без тестов | QA + Frontend | P1–P2 | M |
| Q-15 / Q-16 / Q-17 | Убрать таймзависимость, trace в Playwright, отчёт покрытия | QA | P2 | S |
| UX-10 | Ошибки валидации под полем, единый механизм | Design + Frontend | P2 | M |
| UX-11 / UX-12 / UX-13 | Объединить `.pill` и `.tag`, свести дубли стилей, удалить мёртвый CSS | Design | P2–P3 | M |
| UX-14 / UX-15 / UX-24 | Единая микрокопия маркеров видимости, «только чтение», служебных подписей | Design | P2–P3 | S |
| UX-16 / UX-17 / UX-22 | Фокус на блок подтверждения, индикатор прокрутки вкладок, единый паттерн «ошибка + Повторить» | Design + Frontend | P2 | S |
| FE-08 / FE-09 | Markdown в `computed`, OnPush по умолчанию | Frontend | P2 | M |
| FE-10 / FE-14 / FE-17 | Централизовать ошибки HTTP, вынести дубли, общий сервис времени для часов | Frontend | P2 | M |
| FE-13 | Кэширование статики и Monaco в Caddy | Frontend + DevOps | P2 | S |
| INF-18 / INF-19 / INF-20 / INF-23 | Отвязать скрипты от имени WSL, сканирование образов, короче окно простоя копии, корневой `.dockerignore` | DevOps | P2–P3 | S–M |
| Q-18 | Smoke-тест миграций на снимке реальных данных | QA | P2 | M |

### Волна 4. Рост продукта (после волн 0–2)

| ID | Задача | Роль | Приоритет | Оценка |
|---|---|---|---|---|
| T03 | Уведомления (решение: пока не нужны, без волны; при возврате начать с Telegram-бота) | Product + Backend | P2 | L |
| T04 | Сводное расписание преподавателя «сегодня / неделя» | Product + Frontend + Backend | P1 | M |
| T05 | «Создать занятие на основе…» с копированием текстов и назначений | Product | P1 | M |
| T08 | Публикация каталога упражнений из кабинета (решение: CLI достаточно, пока преподаватель один) | Product + Backend | P3 | L |
| T09 | Срок сдачи ДЗ и подсветка просрочки | Product | P2 | M |
| T10 | Просмотр ZIP-сдачи в браузере с комментариями к строкам | Product + Backend | P2 | L |
| T11 | Статистика прогресса ученика | Product | P2 | M |
| T12 | Лента последних ходов всех учеников | Product | P2 | S |
| T13 | Текстовая сдача ДЗ без файла | Product + Frontend | P2 | S |
| T14 | Редактирование комментария и ответ ученика | Product + Backend | P2 | M |
| T15 | Серия занятий по расписанию | Product | P2 | M |
| T16 | Напоминание «отметьте проведённым», смягчить фразу ученику | Product + Design | P2 | S |
| T17 | Админка: имя, дата, число учеников, последний вход; единая зона времени | Product | P2 | S |
| T18–T22 | Имя преподавателя, экспорт отчёта, поиск, единый источник маршрута, журнал админ-действий | Product | P3 | S–M |
| INF-24 | S3-хранилище для VPS (INF-22 снят: runner на отдельной VM) | DevOps | P3 | L |
| UX-23 / UX-25 | Скелетоны вместо спиннера; тема Monaco из токенов | Design | P3 | S–M |
| FE-19…FE-24 | Константы маршрутов, Monaco без `setValue`, `revokeObjectURL`, зависимости, `index.html`, README | Frontend | P3 | S |
| Q-21…Q-24 | e2e чужого ученика, a11y через axe, legacy-ссылки сквозным тестом, runner-набор в WSL по расписанию | QA | P3 | S–M |

## 4. Решения владельца продукта (15 октября 2026)

1. **Материалы (T01): API + простой UI.** Сначала backend: POST материала с аудиторией «ученику / только вам» и перевод занятия в «Подготовлено». Этим API пользуются и скрипты публикации комплектов, и минимальная форма загрузки файла в кабинете. Скрипты перестают писать в БД напрямую. Полный редактор материалов не делаем.
2. **Каталог тренажёра (T08): CLI достаточно.** Команда `catalog` остаётся единственным путём публикации, пока преподаватель один. T08 опускается до P3 и уходит в волну 4.
3. **«Чей ход» (T02): считать автоматически.** Попытка `submit` по упражнению с размещением «Домашняя работа» — ход ученика; комментарий к строке или оценка преподавателя — ход наставника. Отдельная кнопка «сдал» не нужна.
4. **Уведомления (T03): пока не нужны, остаются в бэклоге.** Канал не выбран; задача без волны до переезда в интернет. При возврате к ней начать с исходящего Telegram-бота как варианта, работающего и с локального кабинета.
5. **Жизненный цикл ученика (T07): архив с доступом.** Карточка скрывается из списка и очереди ходов, доступна через фильтр «Архив»; ученик сохраняет вход и чтение материалов, но не может сдавать; возврат из архива в один клик. Удаление занятий — soft delete.
6. **Runner при переезде (INF-22): отдельная VM.** Исполнитель живёт на дешёвой второй машине, как требует `runner/README.md`. Публикация gateway (INF-08) и TLS (INF-09) остаются P1 волны 2; INF-22 в текущей формулировке (socket-proxy на том же хосте) не нужен.

Репозиторий владельца на GitHub: `https://github.com/PrikGeorge/mentor.git` (подключён как `origin`, см. INF-04).

## 5. План переезда на Linux VPS (из отчёта DevOps)

Код и Compose в основном готовы: production-режим формирует адрес и порты 80/443, Caddy сам получает сертификат, скрипты имеют Linux-ветки, systemd-unit для копий есть. Критический путь до переезда: INF-01 (restore в прод), INF-02 и INF-03 (копии уходят с машины, ключ отдельно), INF-04 (remote и образы вне машины). Далее: артефакты через registry или `docker save`, подготовка VPS, инициализация контура, перенос данных через копию, запуск и проверка, runner на отдельном хосте с рабочей публикацией gateway (INF-08, INF-09), эксплуатация по таймеру копий и алертам (INF-16).

## 6. Ворота релиза (из отчёта QA)

До появления CI выполняются вручную из NTFS-копии:

- `git status --short` чист, миграции Flyway новые, а не изменённые.
- Регенерация `schema.d.ts` и `git diff --exit-code` по нему.
- `./mvnw.cmd -pl backend verify` при запущенном Docker.
- `npm.cmd --prefix frontend test -- --watch=false`, затем production build.
- `npm.cmd --prefix frontend run test:ui -- --project=chromium`.
- Подготовить classpath фикстуры и `npm.cmd --prefix frontend run e2e -- --project=chromium`, включая `tenant-isolation`.
- Если менялся тренажёр или runner: `./mvnw -pl runner verify` в WSL и `e2e:practice` в выделенном контуре (после Q-04).
- Если менялись скрипты `infra/`: соответствующий сценарий из `infra/tests/`.
- Резервная копия до переключения релиза; ручная проверка кабинета после обновления с входом обеими ролями в одной вкладке.

## 7. Полные списки задач по ролям

Здесь сохранены исходные оценки аудиторов до решений раздела 4. Итоговые приоритеты задач T03, T08 и INF-22 — в разделе 3.

### 7.1. Продакт-аналитик (T)

| ID | Задача | Приоритет | Оценка | Область |
|---|---|---|---|---|
| T01 | Загрузка материалов к занятию из UI, аудитория, перевод в `prepared` | P0 | L | `materials/MaterialController`, `lessons/LessonService`, `material-view` |
| T02 | Ход в часах по упражнениям тренажёра с размещением `homework` | P1 | M | `homework/HomeworkTurns`, `turn-clock.component` |
| T03 | Уведомления: Telegram или почта, счётчик в шапке | P1 | L | новый модуль `notifications/`, `shell.component` |
| T04 | Сводное расписание преподавателя | P1 | M | `students-page`, `LessonController` |
| T05 | «Создать занятие на основе…» | P1 | M | `lesson-form`, `LessonService`, `AssignmentService` |
| T06 | Статус ДЗ и фильтр «ждут меня» у ученика | P1 | S | `student-page.component.ts:191-200` |
| T07 | Удаление и архивирование занятия, архивирование ученика | P1 | M | `LessonController`, `StudentController`, миграция V13 |
| T08 | Публикация каталога упражнений из кабинета | P1 | L | `practice/CatalogCommand`, `CatalogService` |
| T09 | Срок сдачи ДЗ `dueAt` и просрочка | P2 | M | контракт `LessonMetadataInput`, `turn-clock` |
| T10 | Просмотр ZIP-сдачи с комментариями к строкам | P2 | L | `HomeworkService.text`, `code-review.component` |
| T11 | Статистика прогресса ученика | P2 | M | `MoveRepository`, `student-page`, `dashboard` |
| T12 | Лента последних ходов всех учеников | P2 | S | `students-page`, `MoveController` |
| T13 | Текстовая сдача ДЗ без файла | P2 | S | `homework-page`, `homework-api.service` |
| T14 | Редактирование комментария, ответ ученика | P2 | M | `CodeCommentController`, `code-review.component` |
| T15 | Серия занятий по расписанию | P2 | M | `lesson-form.component.ts:231`, `LessonService` |
| T16 | Напоминание «отметьте проведённым», мягкая фраза ученику | P2 | S | `dashboard.component.ts:31`, `lesson-status.ts` |
| T17 | Админка: имя, дата, число учеников, последний вход, зона времени | P2 | S | `teachers-page`, `IdentityRepository.TeacherView` |
| T18 | Отображаемое имя преподавателя | P3 | S | `IdentityRepository`, `shell.component` |
| T19 | Экспорт отчёта по ученику | P3 | M | `student-page`, `MoveRepository` |
| T20 | Поиск по занятиям и материалам | P3 | S | `student-page`, `LessonController` |
| T21 | Единый источник свободного текста и этапов маршрута | P3 | S | `student-form.component.ts:276`, `roadmap.component` |
| T22 | Журнал административных действий в UI | P3 | M | `AccountAccessService`, `teachers-page` |

### 7.2. UX/UI-дизайнер (UX)

| ID | Задача | Приоритет | Оценка | Файлы |
|---|---|---|---|---|
| UX-01 | Иконка `chevron-up` в наборе | P0 | S | `core/icon.component.ts` |
| UX-02 | Развести семантику штриховки | P0 | M | `styles.scss` (`.tbl .num.mine`, `.stages .current .mark`, `.new-mark`) |
| UX-03 | Обращение к ученику на «ты» в тренажёре | P1 | M | `practice-workbench`, `practice-exit-dialog` |
| UX-04 | Вкладка «План» как приватная | P1 | S | `student-navigation.component.ts` |
| UX-05 | Подтверждение блокировок и приостановки доступа | P1 | M | `admin/teachers-page`, `students/account-access` |
| UX-06 | Кнопка «+» комментария: размер 44 px, контраст | P1 | S | `styles.scss` (`.code-lines .add-note`) |
| UX-07 | Тёмная тема на весь экран тренажёра; `.test-cells span.pass` | P1 | M | `styles.scss`, `shell.component` |
| UX-08 | Единый формат дат и часового пояса | P1 | S | `homework-page`, `teachers-page`, `practice-workbench`, `moves` |
| UX-09 | Сброс формы ДЗ после отправки | P1 | S | `homework-page.component.ts` |
| UX-10 | Ошибки валидации под полем | P2 | M | `auth-page`, `student-form`, `lesson-form`, `code-review`, `roadmap` |
| UX-11 | Объединить `.pill` и `.tag` | P2 | S | `styles.scss`, `lesson-status.ts` |
| UX-12 | Свести дубли «заголовок с линией», «блок в рамке», «раскрывашка» | P2 | M | `styles.scss` |
| UX-13 | Удалить мёртвый CSS (`.panel*`, `.lesson-cards`, `.turn-*`…) | P3 | S | `styles.scss` |
| UX-14 | Единая микрокопия маркера видимости | P2 | S | `markdown-editor`, `material-view`, `student-form` |
| UX-15 | Нормализовать «только чтение» | P3 | S | 5 компонентов |
| UX-16 | Фокус на появившийся блок подтверждения | P2 | S | `teachers-page`, `account-access` |
| UX-17 | Индикатор горизонтальной прокрутки вкладок | P2 | S | `styles.scss` (`.tabs`) |
| UX-18 | Честный прогресс подготовки занятия | P2 | M | `lesson-page` (`.prep`), `lesson-status.ts`, `dashboard` |
| UX-19 | Единый стиль текстовых ссылок и стрелок | P3 | S | `styles.scss`, 4 компонента |
| UX-20 | Одинаковая подпись пагинации | P3 | S | 4 компонента |
| UX-21 | Общий pipe размера файла | P3 | S | `material-view`, `homework-page` |
| UX-22 | Единый паттерн «ошибка + Повторить» | P2 | S | `homework-page`, `practice-workbench`, `lesson-page` |
| UX-23 | Скелетоны вместо спиннера | P3 | M | `dashboard`, `student-page`, `practice-workbench` |
| UX-24 | Микрокопия футера и служебных подписей | P3 | S | `shell`, `students-page`, `lesson-page` |
| UX-25 | Тема Monaco из токенов | P3 | S | `monaco-loader.service.ts` |

Разнобой терминов, который дизайнер предлагает зафиксировать в словаре: Сценарий / Методичка; Ревью / Отзыв / Обратная связь; Домашняя работа / работа / ДЗ; Упражнения / Задания / Задачи; Наставник / Преподаватель в текстах для ученика; «Только вам» и его пять вариантов; занятие / урок; предпросмотр / экран / кабинет ученика; статусы приглашения в двух написаниях.

### 7.3. Фронтенд-лид (FE)

| ID | Задача | Приоритет | Оценка | Файлы |
|---|---|---|---|---|
| FE-01 | Lazy-ветки `teacher/**` и `learn/**` | P1 | M | `app.routes.ts`, `student-page.component.ts` |
| FE-02 | Убрать N+1 на списке учеников | P1 | M | `students-page.component.ts:48`, контракт |
| FE-03 | Разбить `PracticeWorkbench` (35,7 КБ) | P1 | L | `practice/practice-workbench.component.ts` |
| FE-04 | Единая утилита привязки к сессии и уроку (12 реализаций) | P1 | M | новый `core/bound-scope.ts` |
| FE-05 | `resource()` вместо HTTP в `effect` (33 эффекта) | P1 | M | компоненты с загрузкой |
| FE-06 | ESLint, Prettier, `.editorconfig` | P1 | S | `frontend/package.json`, `angular.json` |
| FE-07 | Очистка черновиков из `localStorage` при выходе, TTL | P1 | S | `draft-recovery.service.ts`, `session.store.ts` |
| FE-08 | Markdown в `computed`, не в шаблоне | P2 | S | `lesson-page.component.ts:33,39`, `practice-workbench:39,41` |
| FE-09 | OnPush по умолчанию, методы шаблона в `computed` | P2 | M | все компоненты |
| FE-10 | Централизовать разбор ошибок HTTP | P2 | M | `platform-api.service.ts`, новый `core/api-error.ts` |
| FE-11 | Unit-spec для `students-page`, `account-access`, `roadmap`, `moves`, `student-form`, `workspace-context` | P2 | M | `src/app/**/*.spec.ts` |
| FE-12 | Снизить хрупкость e2e: `getByRole`, общие фикстуры | P2 | S | `frontend/e2e/*`, `playwright.config.ts` |
| FE-13 | Кэширование статики и Monaco | P2 | S | `infra/proxy/Caddyfile:38` |
| FE-14 | Вынести дубли: `initial`, формат даты, скачивание Blob, фокус, пагинация | P2 | S | новые `core/format.ts`, `core/download.ts`, `core/pagination.component.ts` |
| FE-15 | Кэш каталога материалов на поколение | P2 | M | `materials-api.service.ts:16-19` |
| FE-16 | Внешние `.html` для шаблонов больше 5 КБ | P2 | S | крупные компоненты |
| FE-17 | Общий сервис времени для часов (до 25 таймеров на списке) | P2 | S | `turn-clock.component.ts:36` |
| FE-18 | Покрытие и check-скрипт | P2 | S | `angular.json`, `package.json` |
| FE-19 | Константы маршрутов | P3 | S | `core/routes.ts` |
| FE-20 | Monaco без `setValue` при внешнем изменении | P3 | S | `monaco-editor.component.ts:43-49` |
| FE-21 | Отложенный `revokeObjectURL` | P3 | S | 3 файла |
| FE-22 | Гигиена зависимостей (`@types/markdown-it`, TS в `tools/api`) | P3 | S | `package.json` |
| FE-23 | `index.html`: favicon, `theme-color`, `description` | P3 | S | `src/index.html`, `public/` |
| FE-24 | Актуализировать `frontend/README.md` | P3 | S | `frontend/README.md` |

### 7.4. Бэкенд-лид и безопасность (B)

| ID | Задача | Приоритет | Оценка | Файлы |
|---|---|---|---|---|
| B-01 | Анонимный `GET /auth/session` вне глобального бакета; per-IP и per-session | P0 | M | `identity/AuthRateLimiter.java:18-20`, `IdentityRequestFilter.java:32-36` |
| B-02 | Попытки по логину после проверки пароля, мягкая блокировка | P1 | S | `AuthController.java:32`, `AuthRateLimiter.java:26-28` |
| B-03 | Логирование ошибок с `requestId` и MDC | P1 | M | `shared/ApiExceptionHandler.java:47-54`, `ApiFailureFilter.java:24-26` |
| B-04 | Actuator health и метрики, закрыть от публичного Caddy | P1 | M | `backend/pom.xml`, `application.yaml`, Compose |
| B-05 | HSTS и Permissions-Policy, `Secure` куки в production | P1 | S | `infra/proxy/Caddyfile:34-39` |
| B-06 | Классифицировать `DataAccessException` | P2 | S | `shared/ApiExceptionHandler.java` |
| B-07 | Список занятий без полных текстов и N+1 | P2 | M | `LessonService.java:24,53`, `LessonRepository.java:16,29` |
| B-08 | Материалы: фильтрация и пагинация в SQL | P2 | M | `MaterialService.java:42-75` |
| B-09 | Бюджет памяти под scrypt, план argon2id | P2 | M | `PasswordCodec.java:16-20` |
| B-10 | Multipart вне tmpfs 128 МБ | P2 | S | `application.yaml:9`, Compose `/tmp` |
| B-11 | Контрактный тест против `openapi.yaml` | P2 | M | `support/`, все контроллеры |
| B-12 | Выделенные тесты `journal`, `comments`, `turns`, `roadmap` | P2 | M | `backend/src/test/...` |
| B-13 | Разбить тесты-«простыни», общий контекст | P2 | L | `support/IdentityHttpTest.java:40-53` |
| B-14 | Форматтер Java в Maven | P2 | M | `pom.xml`, весь `backend/src/main/java` |
| B-15 | Единый планировщик, graceful shutdown | P3 | S | `JobQueue`, `BlobJanitor`, `BlobService` |
| B-16 | Дешевле аутентификация на запрос | P3 | M | `SessionPolicy.java:21-35`, `HomeworkController.java:49,53` |
| B-17 | Индексы под FK, ротация `identity_audit`, политика `ON DELETE` | P3 | S | миграция V13 |
| B-18 | Оптимизировать журнал «Ходы» (двойной UNION) | P3 | M | `journal/MoveRepository.java:44-49` |
| B-19 | Сроки сессии в конфиг | P3 | S | `SessionPolicy.java:29,44` |
| B-20 | Ограничения одного узла: лимитер в памяти | P3 | S | `AuthRateLimiter.java`, docs |

Проверено и не является проблемой: CSRF-защита, флаги кук и ротация id, отзыв сессий по `auth_version`, allow-list полей, path traversal, секреты только через файлы, runner-цепочка, очередь с `SKIP LOCKED` и лизами, CAS-ревизии, `Content-Disposition` и `nosniff`.

### 7.5. DevOps / SRE (INF)

| ID | Задача | Приоритет | Оценка | Файлы |
|---|---|---|---|---|
| INF-01 | `restore-platform.ps1` и runbook восстановления | P0 | M | `infra/restore-test.ps1`, `infra/backup.ps1`, docs |
| INF-02 | Ежедневная копия по Task Scheduler с offsite и алертом | P0 | S | новый `infra/windows/register-backup-task.ps1` |
| INF-03 | Пароль копий и секреты вне машины | P0 | S | `infra/initialize-platform.ps1`, docs |
| INF-04 | Git remote, образы вне машины | P0 | S | корень, docs |
| INF-05 | Runbook обновления и отката | P1 | S | `start-platform.ps1`, `status-platform.ps1`, docs |
| INF-06 | Health backend и web, `service_healthy` | P1 | M | `compose.platform.yaml`, `backend/pom.xml` |
| INF-07 | Лимиты ресурсов контейнеров | P1 | S | `compose.platform.yaml`, `compose.runner.yaml` |
| INF-08 | Публикация job-gateway с internal-сети | P1 | M | `compose.platform.yaml`, `compose.runner*.yaml`, `Jobs.Caddyfile` |
| INF-09 | TLS gateway: выпуск, ротация, мониторинг | P1 | M | `Jobs.Caddyfile`, новый `infra/issue-job-tls.ps1` |
| INF-10 | Ротация секретов | P1 | S | `initialize-platform.ps1`, docs |
| INF-11 | HSTS и security-заголовки production | P1 | S | `infra/proxy/Caddyfile` |
| INF-12 | Multi-stage сборка, имя JAR без версии | P1 | M | `infra/*/Dockerfile` |
| INF-13 | GitHub Actions | P1 | L | `.github/workflows/` |
| INF-14 | Расширить `.gitattributes` | P1 | S | `.gitattributes` |
| INF-15 | Политика логирования, JSON, сбор | P2 | M | `logback-spring.xml`, Compose |
| INF-16 | Мониторинг и алерты по `status-platform.ps1` | P2 | M | новый `infra/notify.ps1` |
| INF-17 | Health-трафик вне rate-limit | P2 | S | `AuthRateLimiter.java`, скрипты |
| INF-18 | Отвязать скрипты от имени WSL `Ubuntu` и `/mnt/<drive>` | P2 | S | `infra/platform-common.ps1` |
| INF-19 | Сканирование образов, обновление digest-пинов | P2 | S | Dockerfiles, `.github/` |
| INF-20 | Короче окно простоя копии | P2 | M | `infra/backup.ps1` |
| INF-21 | Документ восстановления после сбоя | P2 | M | новый `docs/operations/disaster-recovery.md` |
| INF-22 | Runner без прямого Docker socket | P3 | L | `runner-service/Dockerfile`, `ContainerExecutor.java` |
| INF-23 | Корневой `.dockerignore` или требование BuildKit | P3 | S | `.dockerignore`, docs |
| INF-24 | S3-хранилище для VPS | P3 | L | Compose, `backup.ps1`, `S3BlobStore` |

### 7.6. QA-лид (Q)

| ID | Задача | Приоритет | Оценка | Файлы |
|---|---|---|---|---|
| Q-01 | Идемпотентность сдачи ДЗ | P0 | M | `HomeworkController`, `HomeworkService`, `homework-page` |
| Q-02 | Интеграционный сценарий этапа 3 с настоящим backend | P0 | L | новый `frontend/integration/stage3-real.spec.ts` |
| Q-03 | Смена аккаунта в одной вкладке с настоящим backend | P0 | M | `frontend/integration/tenant-isolation.spec.ts` |
| Q-04 | Починить `practice-real.spec.ts` | P0 | S | `practice-real.spec.ts:15` |
| Q-05 | Тест журнала «Ходы»: пагинация, порядок, фильтр | P1 | M | новый `journal/MoveJournalTest.java` |
| Q-06 | Конфликт «Проведено» и оценки | P1 | S | `LessonConductedTest`, `HomeworkFlowTest` |
| Q-07 | Spec для `lesson-page` и `grade` | P1 | S | `lessons/`, `homework/` |
| Q-08 | Часы «чей ход» на граничных случаях | P1 | S | `turn-clock.component.spec.ts`, `e2e/turns.spec.ts` |
| Q-09 | Контрактный тест backend против `openapi.yaml` | P1 | L | `support/IdentityHttpTest.java` |
| Q-10 | Синхронность `schema.d.ts` с контрактом | P1 | S | `frontend/package.json` |
| Q-11 | Сообщение ученику при простое исполнителя | P1 | M | `JobQueue.diagnostics`, контракт, `practice-workbench` |
| Q-12 | Комментарий к сдаче чужого занятия того же ученика | P1 | S | `CodeCommentService`, `HomeworkFlowTest` |
| Q-13 | Скрипт «ворот релиза» | P2 | M | новый `infra/run-quality-gate.ps1` |
| Q-14 | Ускорить backend-набор | P2 | M | `support/IdentityHttpTest.java`, surefire |
| Q-15 | Убрать таймзависимость тестов | P2 | S | `JobLeaseTest.java:73-76`, `BlobLifecycleTest.java:83` |
| Q-16 | Playwright trace и retries | P2 | S | `playwright*.config.ts` |
| Q-17 | Отчёт покрытия Vitest и JaCoCo | P2 | S | `angular.json`, `backend/pom.xml` |
| Q-18 | Smoke миграций на снимке реальных данных | P2 | M | рядом с `DatabaseGateTest.java` |
| Q-19 | Автоматизировать `browser-fixture-classpath.txt` | P2 | S | `tools/browser-fixture.mjs`, docs |
| Q-20 | Разбить `HomeworkFlowTest` и `JobLeaseTest` | P3 | M | тесты backend |
| Q-21 | e2e-фикстура «ученик другого преподавателя» | P3 | S | `e2e/workspaces.spec.ts` |
| Q-22 | a11y через `@axe-core/playwright` | P3 | M | `e2e/stage3.spec.ts` |
| Q-23 | Legacy-ссылки сквозным тестом на импортированных ID | P3 | S | `integration/task12.spec.ts` |
| Q-24 | Runner-набор в WSL по расписанию | P3 | S | `runner/README.md` |

Матрица покрытия по доменам и уровням приведена в отчёте QA; главный вывод: backend покрыт глубоко, браузерный слой с настоящим backend остановился на сдаче ДЗ без оценки.
