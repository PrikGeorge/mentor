# INF-19 — сканирование образов перед публикацией

Владелец INF; смежные B/INF и QA. База `2beba62`, один коммит без push. Рабочий контур и готовые окружения упражнений не обновляются.

- [x] Сверить digest основных конкретных тегов с registry. Изменился только index Temurin JRE: `e9aaf731…` → `f04fb34e…`; JAVA_VERSION обоих `jdk-21.0.12.1+1`.
- [x] Обновить JRE pin в backend/runner Dockerfiles; сохранить остальные проверенные версии и index digests. Закрепить dev PostgreSQL тем же production digest.
- [x] Build/scan job с `contents: read`: три образа load без push, локальные image IDs, полные Trivy JSON с OS/library inventory и unfixed. Дополнительно проверить закреплённый PostgreSQL (OS packages).
- [x] Trivy 0.76.0: проверенный релиз и SHA256 Linux-64bit архива `e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7`, без latest installer. Сохранять версию/дату базы.
- [x] Проверка отчёта отклоняет чужой image ID, отсутствие ожидаемого inventory, ошибки сканера и HIGH/CRITICAL с исправлением. Никаких автоматических исключений.
- [x] Publish job с `packages: write` только после всех gates: загрузить сохранённые tar, сверить SHA256/image IDs, отправить те же образы без пересборки. Здесь публикация не выполняется.
- [x] Синтетические тесты policy, локальные сборки/сканирование, смежное ревью, документация/карта/§0 и коммит.

Источники: [Trivy 0.76.0](https://github.com/aquasecurity/trivy/releases/tag/v0.76.0), [образ и inventory](https://trivy.dev/docs/latest/references/configuration/cli/trivy_image/), [Java](https://trivy.dev/docs/latest/coverage/language/java/), [Go](https://trivy.dev/docs/latest/coverage/language/golang/), [проверка до push](https://docs.docker.com/build/ci/github-actions/test-before-push/). SHA архива получен из metadata immutable release GitHub, сравнивается перед запуском. Базы уязвимостей обновляются при проверке, их содержимое не фиксируется в Git.

Границы: сканер не гарантирует обнаружение CVE C-бинарников, собранных из исходников (PostgreSQL), или версии main Go module, если её нет в build info. Полный inventory сохраняется для оценки покрытия. Закрепление training JDK меняет revision окружений; оно не входит в эту правку. Q-18 на настоящем снимке, runner daemon и practice fixture остаются открытыми.

Проверено локально 15.10.2026:

- Тесты отчёта RED → GREEN; по QA добавлены проверки содержимого packages, отсутствующего Vulnerabilities, Go без Version и целевого пути Caddy. Все 12 mock-сценариев инфраструктуры прошли; PowerShell parse 53 файлов/CI-шагов, YAML parse, `bash -n` установщика и `git diff --check` прошли.
- Backend/web/runner собраны через prebuilt stages в собственной NTFS-копии; runner `package -DskipTests` успешен. Тесты приложения из предыдущих задач повторно не запускались. Все четыре реальных Trivy JSON имеют ожидаемые image IDs и состав пакетов; архив трёх образов прошёл save/load с совпавшими SHA256 и image IDs. GitHub Actions и публикация не запускались.
- Trivy 0.76.0, vulnerability DB обновлена `2026-10-15T01:13:01Z`, Java DB — `2026-10-15T00:58:48Z`. Полные локальные отчёты: `C:/Users/George/.codex/scratch/mentor-wave3-20261015/inf19-reports/`.
- **Новый release gate красный:** backend 13 исправимых HIGH/CRITICAL (OS libssl3, Tomcat, Bouncy Castle, Jackson); web 21 (Go stdlib и модули); runner 31 (libssl3, Jackson, Go stdlib); PostgreSQL 28 (OS-пакеты Alpine). Это количество находок по пакетам/образам, не уникальных CVE. Unfixed HIGH/CRITICAL: 0 во всех четырёх отчётах. Обновление digest того же тега JRE сохранило версию Java и не устранило эти находки. Их ремедиация остаётся открытой; CI должен блокировать публикацию текущего набора.
- Inventory: backend 143 OS + 118 JAR; web 32 OS + 146 Go; runner 143 OS + 18 JAR + только 1 Go (stdlib), PostgreSQL 45 OS. Для Docker CLI сканер видит только Go stdlib, а не полный граф модулей; отсутствие иных находок не доказывает безопасность CLI. Все отчёты сохранены без исключений/фильтрации.
