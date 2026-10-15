package ru.mentor.platform.migration;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class SnapshotMigrationSmokeTest {
    private static final String PRIVATE_TEXT = "Приватно: заметки наставника\nНе публиковать 🧩";
    private static final String PUBLIC_TEXT = "# Открытый план\n\nКоллекции — следующий шаг 🙂";
    private static final String GOAL = "  Цель: первая работа — Java  ";
    // The newest Flyway version on the classpath: a populated V14 snapshot must reach it, however many migrations follow.
    private static final int LATEST = latestMigration();
    private static final Map<String, String> INDEX_DEFINITIONS = Map.of(
        "practice_attempt_account", "CREATE INDEX practice_attempt_account ON public.practice_attempt USING btree (workspace_id, account_id)",
        "identity_invitation_issuer", "CREATE INDEX identity_invitation_issuer ON public.identity_invitation USING btree (issuer_id)",
        "identity_audit_created", "CREATE INDEX identity_audit_created ON public.identity_audit USING btree (created_at)",
        "identity_audit_actor", "CREATE INDEX identity_audit_actor ON public.identity_audit USING btree (actor_id)",
        "blob_reservation_attached", "CREATE INDEX blob_reservation_attached ON public.blob_reservation USING btree (workspace_id, attached_blob_id)"
    );

    @TempDir Path temporary;

    @Test void restoresPopulatedV14DumpIntoAnotherDatabaseAndPreservesDataThroughTheLatestMigration() throws Exception {
        try (var source = SnapshotMigrationSmoke.newDatabase()) {
            initializeSource(source, "14");
            String sourceIdentity;
            try (var connection = DriverManager.getConnection(source.getJdbcUrl(), source.getUsername(), source.getPassword())) {
                sourceIdentity = scalar(connection, "SELECT system_identifier::text FROM pg_control_system()");
                assertEquals("0", scalar(connection, "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='identity_audit_actor'"));
            }

            Path dump = dumpSource(source, "populated-v14.dump");
            String checksum = SnapshotMigrationSmoke.sha256(dump);
            var report = SnapshotMigrationSmoke.verify(dump, checksum, connection -> {
                assertNotEquals(sourceIdentity, scalar(connection, "SELECT system_identifier::text FROM pg_control_system()"),
                    "The dump must be restored into a new PostgreSQL cluster, not migrated in its source database");
                assertSentinels(connection);
                assertIndexes(connection);
            });

            assertEquals("14", report.beforeVersion());
            assertEquals(String.valueOf(LATEST), report.afterVersion());
            assertEquals(LATEST - 14, report.migrationsExecuted());
            assertEquals(report.beforeCounts(), report.afterCounts());
            assertEquals(1L, report.afterCounts().get("identity_account"));
            assertEquals(2L, report.afterCounts().get("student_profile"));
            assertEquals(1L, report.afterCounts().get("lesson"));
            assertEquals(2L, report.afterCounts().get("lesson_text"));
            assertEquals(1L, report.afterCounts().get("identity_invitation"));
            assertEquals(1L, report.afterCounts().get("identity_audit"));

            Path cliReport = temporary.resolve("success-report.json");
            var cli = runCli(dump, checksum, cliReport);
            assertEquals(0, cli.exitCode(), cli.stderr());
            var json = new ObjectMapper().readTree(Files.readString(cliReport));
            assertTrue(json.get("completed").asBoolean());
            var result = json.get("result");
            assertEquals("14", result.get("beforeVersion").asText());
            assertEquals(String.valueOf(LATEST), result.get("afterVersion").asText());
            assertEquals(LATEST - 14, result.get("migrationsExecuted").asInt());
            assertEquals(checksum, result.get("snapshotSha256").asText());
            assertEquals(result.get("beforeCounts"), result.get("afterCounts"));
            assertEquals(2, result.get("afterCounts").get("student_profile").asInt());
            assertNoPrivateOutput(cli, dump.toString(), dump.getFileName().toString(), cliReport.toString(),
                cliReport.getFileName().toString(), PRIVATE_TEXT, PUBLIC_TEXT, "Синтетическая Анна", "Не публиковать");
        }
    }

    private static int latestMigration() {
        try (var files = Files.list(Path.of(SnapshotMigrationSmokeTest.class.getResource("/db/migration").toURI()))) {
            return files.map(file -> file.getFileName().toString()).filter(name -> name.matches("V\\d+__.*\\.sql"))
                .mapToInt(name -> Integer.parseInt(name.substring(1, name.indexOf("__")))).max().orElseThrow();
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @Test void rejectsAnAlreadyCurrentPopulatedSnapshot() throws Exception {
        try (var source = SnapshotMigrationSmoke.newDatabase()) {
            initializeSource(source, String.valueOf(LATEST));
            Path dump = dumpSource(source, "already-current.dump");
            var failure = assertThrows(IllegalStateException.class, () -> SnapshotMigrationSmoke.verify(
                dump, SnapshotMigrationSmoke.sha256(dump), connection -> fail("A snapshot without pending migrations must not reach the probe")));
            assertTrue(failure.getMessage().contains("no-pending-migrations"));
        }
    }

    @Test void rejectsAnAlteredAppliedMigrationChecksum() throws Exception {
        try (var source = SnapshotMigrationSmoke.newDatabase()) {
            initializeSource(source, "14");
            try (var connection = DriverManager.getConnection(source.getJdbcUrl(), source.getUsername(), source.getPassword());
                 var statement = connection.createStatement()) {
                assertEquals(1, statement.executeUpdate("UPDATE flyway_schema_history SET checksum=CASE WHEN checksum=0 THEN 1 ELSE 0 END WHERE version='14'"));
            }
            Path dump = dumpSource(source, "altered-history.dump");
            var failure = assertThrows(FlywayException.class, () -> SnapshotMigrationSmoke.verify(
                dump, SnapshotMigrationSmoke.sha256(dump), connection -> fail("An invalid migration history must not reach the probe")));
            assertTrue(failure.getMessage().toLowerCase(Locale.ROOT).contains("checksum"));
        }
    }

    @Test void rejectsMissingDumpBeforeOpeningADatabase() {
        assertThrows(IllegalArgumentException.class, () -> SnapshotMigrationSmoke.verify(
            temporary.resolve("missing.dump"), "0".repeat(64), connection -> fail("Invalid input reached the database probe")));
    }

    @Test void rejectsMalformedChecksumBeforeOpeningADatabase() throws Exception {
        Path dump = Files.writeString(temporary.resolve("invalid-sha.dump"), "PGDMPsynthetic");
        assertThrows(IllegalArgumentException.class, () -> SnapshotMigrationSmoke.verify(
            dump, "not-a-sha256", connection -> fail("Invalid input reached the database probe")));
    }

    @Test void rejectsChecksumMismatchBeforeOpeningADatabase() throws Exception {
        Path dump = Files.writeString(temporary.resolve("mismatched-sha.dump"), "PGDMPsynthetic");
        String actual = SnapshotMigrationSmoke.sha256(dump);
        String different = (actual.charAt(0) == '0' ? "1" : "0") + actual.substring(1);
        assertThrows(IllegalArgumentException.class, () -> SnapshotMigrationSmoke.verify(
            dump, different, connection -> fail("Invalid input reached the database probe")));
    }

    @Test void rejectsPlainSqlEvenWhenItsChecksumMatches() throws Exception {
        Path dump = Files.writeString(temporary.resolve("plain.sql"), "CREATE TABLE synthetic_probe (id integer);\n");
        assertThrows(IllegalArgumentException.class, () -> SnapshotMigrationSmoke.verify(
            dump, SnapshotMigrationSmoke.sha256(dump), connection -> fail("Invalid input reached the database probe")));
    }

    @Test void cliFailureWritesAnIncompleteReportWithoutLeakingInputOrPaths() throws Exception {
        String sentinel = "PRIVATE_SNAPSHOT_SENTINEL_61f0";
        Path directory = Files.createDirectory(temporary.resolve("PRIVATE_SNAPSHOT_DIRECTORY"));
        Path dump = Files.writeString(directory.resolve("private-source.dump"), "PGDMP" + sentinel);
        Path report = directory.resolve("private-report.json");
        String checksum = SnapshotMigrationSmoke.sha256(dump);
        String different = (checksum.charAt(0) == '0' ? "1" : "0") + checksum.substring(1);
        var cli = runCli(dump, different, report);
        assertNotEquals(0, cli.exitCode());
        var json = new ObjectMapper().readTree(Files.readString(report));
        assertFalse(json.get("completed").asBoolean());
        assertEquals("input", json.get("phase").asText());
        assertNoPrivateOutput(cli, sentinel, directory.toString(), directory.getFileName().toString(), dump.toString(),
            dump.getFileName().toString(), report.toString(), report.getFileName().toString());
        assertFalse(Files.readString(report).contains(sentinel));
        assertFalse(Files.readString(report).contains(directory.toString()));
    }

    @Test void cliDoesNotOverwriteAnExistingReport() throws Exception {
        Path dump = Files.writeString(temporary.resolve("private-source.dump"), "PGDMPPRIVATE_EXISTING_REPORT_INPUT");
        Path report = temporary.resolve("existing-report.json");
        String original = "PRIVATE_EXISTING_REPORT_SENTINEL\nKeep these exact bytes.\n";
        Files.writeString(report, original);
        var cli = runCli(dump, SnapshotMigrationSmoke.sha256(dump), report);
        assertNotEquals(0, cli.exitCode());
        assertEquals(original, Files.readString(report));
        assertNoPrivateOutput(cli, dump.toString(), dump.getFileName().toString(), report.toString(), report.getFileName().toString(),
            "PRIVATE_EXISTING_REPORT_INPUT", "PRIVATE_EXISTING_REPORT_SENTINEL");
    }

    private static void initializeSource(PostgreSQLContainer source, String version) throws Exception {
        source.start();
        var schema = Flyway.configure().dataSource(source.getJdbcUrl(), source.getUsername(), source.getPassword())
            .locations("classpath:db/migration").target(version).load();
        assertEquals(Integer.parseInt(version), schema.migrate().migrationsExecuted);
        try (var connection = DriverManager.getConnection(source.getJdbcUrl(), source.getUsername(), source.getPassword())) {
            seed(connection);
        }
    }

    private Path dumpSource(PostgreSQLContainer source, String name) throws Exception {
        var dumped = source.execInContainer("pg_dump", "-U", source.getUsername(), "-d", source.getDatabaseName(),
            "--format=custom", "--file=/tmp/source.dump");
        assertEquals(0, dumped.getExitCode(), dumped.getStderr());
        Path dump = temporary.resolve(name);
        source.copyFileFromContainer("/tmp/source.dump", dump.toString());
        return dump;
    }

    private record CliResult(int exitCode, String stdout, String stderr) {}

    private CliResult runCli(Path dump, String checksum, Path report) throws Exception {
        Path java = Path.of(System.getProperty("java.home"), "bin", "java");
        if (!Files.isRegularFile(java)) java = java.resolveSibling("java.exe");
        String classpath = System.getProperty("surefire.test.class.path", System.getProperty("java.class.path"));
        Path stdout = Files.createTempFile(temporary, "cli-stdout-", ".log");
        Path stderr = Files.createTempFile(temporary, "cli-stderr-", ".log");
        Process process = new ProcessBuilder(java.toString(), "-cp", classpath, SnapshotMigrationSmoke.class.getName(),
            dump.toString(), checksum, report.toString()).redirectOutput(stdout.toFile()).redirectError(stderr.toFile()).start();
        try {
            assertTrue(process.waitFor(60, TimeUnit.SECONDS), "Snapshot CLI did not exit within 60 seconds");
            return new CliResult(process.exitValue(), Files.readString(stdout), Files.readString(stderr));
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                assertTrue(process.waitFor(5, TimeUnit.SECONDS), "Snapshot CLI process could not be stopped");
            }
        }
    }

    private static void assertNoPrivateOutput(CliResult result, String... privateValues) {
        String output = result.stdout() + result.stderr();
        for (String value : privateValues) assertFalse(output.contains(value), "CLI output must not expose private input");
    }

    private static void seed(Connection connection) throws Exception {
        // The owner/workspace/membership references are deferred until this transaction commits.
        connection.setAutoCommit(false);
        try {
            try (var statement = connection.createStatement()) {
                statement.executeUpdate("INSERT INTO identity_account(id,login,password_hash,role,auth_version) VALUES('smoke-teacher','smoke-teacher','synthetic-not-a-password','TEACHER',4)");
                statement.executeUpdate("INSERT INTO workspace(id,owner_user_id,created_at) VALUES('smoke-workspace','smoke-teacher',TIMESTAMPTZ '2026-10-01 09:00:00+03')");
                statement.executeUpdate("INSERT INTO workspace_membership(user_id,workspace_id,role) VALUES('smoke-teacher','smoke-workspace','TEACHER')");
            }
            try (var statement = connection.prepareStatement("""
                INSERT INTO student_profile(workspace_id,id,name,direction,goal,schedule,notes,student_roadmap,student_review,
                    revision,roadmap_revision,created_at,archived_at)
                VALUES('smoke-workspace','active','Синтетическая Анна 🧩','Java',?,'Вт, 19:00 МСК',?,?, '',
                    7,3,TIMESTAMPTZ '2026-10-01 09:00:00+03',NULL),
                    ('smoke-workspace','archived','Синтетический архив','Java','','','','','Архивный отзыв',
                    11,4,TIMESTAMPTZ '2026-10-01 09:00:00+03',TIMESTAMPTZ '2026-10-10 12:00:00+03')
                """)) {
                statement.setString(1, GOAL);
                statement.setString(2, PRIVATE_TEXT);
                statement.setString(3, PUBLIC_TEXT);
                assertEquals(2, statement.executeUpdate());
            }
            try (var statement = connection.createStatement()) {
                statement.executeUpdate("""
                    INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,status,revision,created_at,conducted_at)
                    VALUES('smoke-workspace','active','smoke-lesson','Коллекции — разбор','2026-10-07','19:00',90,'prepared',9,
                        TIMESTAMPTZ '2026-10-01 09:00:00+03',TIMESTAMPTZ '2026-10-07 20:30:00+03')
                    """);
                statement.executeUpdate("""
                    INSERT INTO identity_invitation(id,token_hash,kind,issuer_id,workspace_id,student_id,created_at,expires_at)
                    VALUES('smoke-invitation',repeat('a',64),'STUDENT','smoke-teacher','smoke-workspace','active',
                        TIMESTAMPTZ '2026-10-01 09:00:00+03',TIMESTAMPTZ '2030-01-01 00:00:00+03')
                    """);
                statement.executeUpdate("""
                    INSERT INTO identity_audit(id,actor_id,action,target_id,workspace_id,created_at)
                    VALUES('smoke-audit','smoke-teacher','snapshot.synthetic','active','smoke-workspace',TIMESTAMPTZ '2026-10-01 09:00:00+03')
                    """);
            }
            try (var statement = connection.prepareStatement("""
                INSERT INTO lesson_text(workspace_id,lesson_id,kind,markdown,revision)
                VALUES('smoke-workspace','smoke-lesson','teacherNotes',?,5),
                    ('smoke-workspace','smoke-lesson','studentNotes',?,6)
                """)) {
                statement.setString(1, PRIVATE_TEXT);
                statement.setString(2, PUBLIC_TEXT);
                assertEquals(2, statement.executeUpdate());
            }
            connection.commit();
        } catch (Exception failure) {
            connection.rollback();
            throw failure;
        } finally {
            connection.setAutoCommit(true);
        }
    }

    private static void assertSentinels(Connection connection) throws Exception {
        try (var statement = connection.createStatement(); var row = statement.executeQuery(
            "SELECT * FROM student_profile WHERE workspace_id='smoke-workspace' AND id='active'")) {
            assertTrue(row.next());
            assertEquals("Синтетическая Анна 🧩", row.getString("name"));
            assertEquals(GOAL, row.getString("goal"));
            assertEquals(PRIVATE_TEXT, row.getString("notes"));
            assertEquals(PUBLIC_TEXT, row.getString("student_roadmap"));
            assertEquals(7, row.getLong("revision"));
            assertEquals(3, row.getLong("roadmap_revision"));
            assertEquals(Instant.parse("2026-10-01T06:00:00Z"), row.getTimestamp("created_at").toInstant());
            assertNull(row.getObject("archived_at"));
            assertFalse(row.next());
        }
        try (var statement = connection.createStatement(); var row = statement.executeQuery(
            "SELECT revision,roadmap_revision,student_review,archived_at FROM student_profile WHERE workspace_id='smoke-workspace' AND id='archived'")) {
            assertTrue(row.next());
            assertEquals(11, row.getLong("revision"));
            assertEquals(4, row.getLong("roadmap_revision"));
            assertEquals("Архивный отзыв", row.getString("student_review"));
            assertEquals(Instant.parse("2026-10-10T09:00:00Z"), row.getTimestamp("archived_at").toInstant());
        }
        try (var statement = connection.createStatement(); var row = statement.executeQuery(
            "SELECT title,revision,conducted_at FROM lesson WHERE workspace_id='smoke-workspace' AND id='smoke-lesson'")) {
            assertTrue(row.next());
            assertEquals("Коллекции — разбор", row.getString("title"));
            assertEquals(9, row.getLong("revision"));
            assertEquals(Instant.parse("2026-10-07T17:30:00Z"), row.getTimestamp("conducted_at").toInstant());
        }
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(
            "SELECT kind,markdown,revision FROM lesson_text WHERE workspace_id='smoke-workspace' AND lesson_id='smoke-lesson' ORDER BY kind")) {
            assertTrue(rows.next());
            assertEquals("studentNotes", rows.getString("kind"));
            assertEquals(PUBLIC_TEXT, rows.getString("markdown"));
            assertEquals(6, rows.getLong("revision"));
            assertTrue(rows.next());
            assertEquals("teacherNotes", rows.getString("kind"));
            assertEquals(PRIVATE_TEXT, rows.getString("markdown"));
            assertEquals(5, rows.getLong("revision"));
            assertFalse(rows.next());
        }
        assertEquals("4", scalar(connection, "SELECT auth_version FROM identity_account WHERE id='smoke-teacher'"));
        assertEquals("smoke-teacher", scalar(connection, "SELECT issuer_id FROM identity_invitation WHERE id='smoke-invitation'"));
        assertEquals("snapshot.synthetic", scalar(connection, "SELECT action FROM identity_audit WHERE id='smoke-audit'"));
    }

    private static void assertIndexes(Connection connection) throws Exception {
        Map<String, String> actual = new HashMap<>();
        try (var statement = connection.createStatement(); var rows = statement.executeQuery("""
            SELECT c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
            FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
            WHERE c.relnamespace='public'::regnamespace AND c.relname IN
                ('practice_attempt_account','identity_invitation_issuer','identity_audit_created','identity_audit_actor','blob_reservation_attached')
            """)) {
            while (rows.next()) {
                actual.put(rows.getString(1), rows.getString(2));
                assertTrue(rows.getBoolean(3), "Restored index must be valid: " + rows.getString(1));
                assertTrue(rows.getBoolean(4), "Restored index must be ready: " + rows.getString(1));
            }
        }
        assertEquals(INDEX_DEFINITIONS, actual);
    }

    private static String scalar(Connection connection, String sql) throws Exception {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            assertTrue(rows.next());
            String value = rows.getString(1);
            assertFalse(rows.next());
            return value;
        }
    }
}
