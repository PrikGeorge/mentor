# INF-19 — исправления найденных уязвимостей

Владелец INF, смежные B/INF и QA. База `60352d4`; один коммит без push. Рабочий контур не обновляется, исключения в политике сканера не добавляются.

- [x] Сверить Trivy, официальные release notes, Maven Central и OCI index manifests.
- [x] Сохранить Boot4.1.1; закрепить Tomcat11.0.27, Jackson BOM3.1.7/2.21.7 и BC1.86. Overrides временные, до исправленного Boot BOM.
- [x] PostgreSQL17.11-alpine с одинаковым index pin в действующих контурах/тестах; Docker CLI29.9.0; libssl3 3.0.2-0ubuntu1.30 в обеих JRE21 Jammy.
- [x] Caddy2.11.7 со стандартными модулями, Go1.26.9 по index digest и x/net0.60.0; committed go.mod/go.sum, GOTOOLCHAIN=local, CGO0, readonly/trimpath/upstream tags. Сохранены time/tzdata, copyright/SPDX, версия и лицензия; восстановлен setcap после COPY.
- [x] Web и job-gateway используют один просканированный web-образ, разные прежние Caddyfile. Никаких новых публичных маршрутов или четвёртого release artifact.
- [x] Реальные контекстные RED→GREEN, новый portable HTTP/TLS smoke обоих прокси, CI до scanner/archive/publish; карта и эксплуатация.
- [x] Backend verify, безопасные runner tests, реальные браузеры, сборки/сканы, archive save/load, смежное ревью и §0.

Проверено 15.10.2026:

- Backend verify209/209, 0 ошибок/пропусков. Первый запуск выявил несовместимость строкового Testcontainers-конструктора с tag@digest; явный DockerImageName/asCompatibleSubstituteFor и полный повтор прошли. Миграции/API не менялись.
- Runner JobClientTest/ResultVerifierTest/BoundedProcessTest8/8 и package. В JAR подтверждены Tomcat11.0.27, Jackson3.1.7/2.21.7 и BC1.86. CLI29.9.0 согласовал API1.48 с daemon28.0.1 командой version без запуска RunnerApplication.
- Fresh real e2e12/12 в пяти синтетических контурах с новым backend/PG17.11. Frontend unit306/306 (55 файлов), UI31/31, production build initial488.65kB, lint0ошибок/6прежнихwarnings. api:check wrapper завершился129, поскольку NTFS-копия без .git; generation прошла, результат перенесён в E: и обычный git diff --exit-code schema пуст. SHA256 двух generated копий совпал.
- Четыре реальные BuildKit context probes RED→GREEN: разрешены только go.mod/go.sum/main.go, лишние Go/env/secrets остаются canaries. Все13infra mocks, настоящий backup-fence на PG17.11, PowerShell parse46 скриптов, YAML CI/Compose, diff check.
- Новый caddy-runtime.ps1: 7 HTTP/TLS групп плюс readiness, web/Jobs validate и metadata/capability — 10 групп. Доверенный synthetic TLS, отказ недоверенному cert, HTTP1 и HTTP2 с Bearer/body/browser markers, Host/cookies, upload/download65537байт SHA256, private404 и отсутствие upstream-вызовов для root/index/API/настоящего Angular asset в gateway. Один inspect ID обоих контейнеров, собственные loopback-порты/network, cleanup0остатков. Выполнено Windows+WSL; Linux-ветка только подготовлена для CI, GitHub CI не запускался.
- Стандартные модули нового Caddy полностью совпали с официальным2.11.7 (135); binary build-info Go1.26.9/x/net0.60.0, CGO0, capability cap_net_bind_service=ep. Synthetic compose config подтвердил одинаковый web/gateway release image, прежние Jobs mount, сети и loopback port.
- Trivy0.76.0, vulnerability DB2026-10-15T01:13:01Z, JavaDB2026-10-15T00:58:48Z. Исправимые HIGH/CRITICAL: backend13→0, web21→0, runner31→0, PostgreSQL28→0; unfixed HC0. Всего находок всех уровней54/2/54/1. Официальный Caddy2.11.7 до досборки оставлял4 записи в stdlib/x/net; сохранён и его промежуточный отчёт. Исключений нет.
- Конечные IDs: backend7dce3bae…, web01391c58…, runner9e6b2015…, PostgreSQLb0f9560a…. Полные JSON/IDs/metadata: C:/Users/George/.codex/scratch/mentor-wave3-20261015/inf19-updated-reports/.
- Inventory: backend143OS+118JAR, web32OS+149Go, runner143OS+18JAR+1Go(stdlib), PostgreSQL45OS. Ограничение покрытия Docker CLI module graph и source-built PostgreSQL сохраняется; отсутствие иных находок не доказывает полного отсутствия CVE.
- Архив трёх конечных образов прошёл save/load с теми же image IDs; SHA2564C40DFB897EE13B5272D57B3D7F1221AB73F66EA8BD5177A134DEF7ABE5768D6. Собственные image tags, публикации не было.

Смежные B/INF и QA приняли код; замечания к старому статусу Q18 и промежуточному Caddy gate исправлены. Источники: [Boot BOM](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-dependencies/4.1.1/spring-boot-dependencies-4.1.1.pom), [Tomcat security](https://tomcat.apache.org/security-11.html), [BC1.86](https://www.bouncycastle.org/resources/new-release-bouncy-castle-java-1-86/), [USN8847](https://ubuntu.com/security/notices/USN-8847-1), [Caddy build](https://caddyserver.com/docs/build), [Caddy2.11.7 main](https://github.com/caddyserver/caddy/blob/v2.11.7/cmd/caddy/main.go), [Go release metadata](https://go.dev/dl/?mode=json), [Docker29.9.0](https://docs.docker.com/engine/release-notes/29/#2990), [PostgreSQL17.11](https://www.postgresql.org/docs/17/release-17-11.html).

Возврат к официальному Caddy binary — после исправленного upstream-образа и повторных module/smoke/scan проверок. Source-mode сборки, GitHub CI и рабочий контур не запускались. Реальный Q18 выполняет владелец при релизе (60352d4); полный runner на изолированном daemon и e2e:practice — отдельные ворота §6. Их результат записывается в итоговом отчёте волны3.