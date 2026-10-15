# FE-04: единая привязка к сессии и данным

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Заменить повторные lifetime/generation/bound проверки общей утилитой без ослабления изоляции аккаунтов и занятий.

**Architecture:** `createBoundScope(readKey?)` создаётся в injection context компонента и запоминает поколение SessionStore. `current()` проверяет владельца и lifetime; `active()` также сравнивает сохранённый ключ с текущими inputs; `bind()` фиксирует ключ в точке сброса формы и отменяет прежние запросы; `capture()` защищает от позднего async-ответа; `track(source)` отменяет Observable при bind, смене сессии или destroy. Ключ — массив примитивов, сравнение по значениям. Без readKey привязка только к сессии активна сразу.

**Tech Stack:** Angular 22 signals/DestroyRef, RxJS, Vitest, Playwright.

**Spec:** `docs/team/2026-10-15-team-and-backlog.md`, FE-04; границы сессии из `AGENTS.md`.

## Global Constraints

- Роль FE; смежное B/UX/QA-ревью до строки в разделе 0. Один коммит FE-04, без push.
- Сохранить SessionStore.generation/scope и немедленный запрет старых обработчиков до следующего render.
- Роли, workspace, preview, ревизии, режим revalidation тренажёра и политика черновиков остаются доменными проверками.
- FE-05/resource — отдельная задача. Разметку, CSS, термины и полное форматирование файлов не менять.
- Все проверки идут в NTFS-копии на синтетических данных; 4173 и 4201 не используются.

## Review Focus

- Старый компонент не становится владельцем после logout/login, даже для того же userId.
- Изменение ключа input запрещает действие до effect; новая bind не оживляет старый callback при A→B→A.
- Destroy останавливает HTTP и поздние Promise/callback; stale errors не показываются новой форме.
- Предпросмотр и несовпадающий workspace остаются только для чтения; ревизия текста/сдачи входит в соответствующий ключ.
- Замороженный тренажёр сохраняет revalidate/export/защиту несохранённого кода в прежних допустимых состояниях.

## FE-04

**Files:** новый `frontend/src/app/core/bound-scope.ts` и соседний spec; владельцы в `homework`, `reviews`, `editor`, `lessons`, `students`, `materials`, `roadmap`, `practice`; карта и строка бэклога.

- [x] Написать unit-проверки lifetime/generation, input до bind, ABA capture, отмены/ошибок Observable и уничтожения; RED подтверждён, 8 проверок helper проходят.
- [x] Реализовать helper и перевести 12 владельцев и DomainPage с сохранением специфичных ключей и отмены.
- [x] Выполнить unit 248/248, build, lint (0 ошибок, 6 прежних предупреждений), UI 31/31 и реальный tenant-isolation 2/2; регрессии Markdown, ДЗ и тренажёра проходят.
- [x] Получить смежное B/UX/QA-ревью; исправить ABA продолжения Promise и debounce Markdown при неизменном тексте. Обновить AGENTS/раздел 0; изменения оформлены коммитом FE-04.

Открытые ворота релиза: FE-12 (старые `.pill` в full real e2e); runner verify не запускался, поскольку `cleanupExpired()` затрагивает чужие expired jobs на общем Docker daemon, требуется отдельный тестовый daemon; `e2e:practice` требует настроенный `MENTOR_PRACTICE_FIXTURE`. Эти ограничения не заменяются unit/UI-проверками.
