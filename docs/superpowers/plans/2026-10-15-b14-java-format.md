# B-14: форматирование Java в Maven

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Проверять единый формат production-кода backend при обычной сборке Maven.

**Architecture:** Spotless с закреплённым Java-форматтером проверяет только `backend/src/main/java`. Исправление выполняется явной командой `spotless:apply`; CI использует существующий `verify`.

**Tech Stack:** Java 21, Maven Wrapper, [Spotless 3.10.4](https://github.com/diffplug/spotless/releases/tag/maven/3.10.4), [google-java-format 1.36.1](https://github.com/google/google-java-format/releases/tag/v1.36.1) AOSP. Версия 1.37.0 меняет API `Style` и несовместима с этой версией Spotless.

**Spec:** `docs/team/2026-10-15-team-and-backlog.md`, B-14 и процесс раздела 0.1.

## Global Constraints

- Одна задача за раз; роль B, смежное ревью INF и QA.
- Форматирование исходников — отдельный style-коммит; настройка, документация и строка статуса — коммит B-14. Без push.
- Не менять runtime-поведение, контракты, миграции, runner и тестовые исходники.
- Проверки с PostgreSQL выполняются в синтетическом NTFS-контуре; рабочий кабинет 4173 не используется.

## Review Focus

- Версии инструментов закреплены и поддерживают JDK 21.
- Проверка действительно включена в Maven lifecycle и не исправляет файлы сама.
- Повторный apply ничего не меняет; LF даёт одинаковый результат на Windows и Linux.
- Область применения не захватывает generated sources, runner или тесты.
- После форматирования остаются прежние инструкции скомпилированного кода и проходит backend verify.

## B-14

**Files:** `backend/pom.xml`, `.gitattributes`, `backend/src/main/java/**/*.java`, `AGENTS.md`, `docs/operations/java-angular.md`, таблица раздела 0 бэклога.

- [x] Закрепить версии Spotless/форматтера, ограничить includes и привязать check к validate.
- [x] Убедиться, что validate падает на исходном формате без изменения файлов: 103 нарушения.
- [x] Применить форматирование; проверить повторный apply, validate и неизменность инструкций bytecode: 103 файла, LF; инструкции, сигнатуры и константы 181 класса совпадают по `javap -p -c -s -constants`.
- [x] Выполнить backend verify на NTFS: 200/200, без пропусков; INF/QA-ревью принято, замечаний B-14 нет.
- [x] Сделать отдельный style-коммит исходников (`b6e16d9`); обновить карту, команды и строку B-14; настройка и документация находятся в отдельном коммите B-14, без push.
