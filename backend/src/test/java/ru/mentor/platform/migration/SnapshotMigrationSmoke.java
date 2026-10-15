package ru.mentor.platform.migration;

import ch.qos.logback.classic.Level;
import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;
import org.flywaydb.core.Flyway;
import org.slf4j.LoggerFactory;
import org.testcontainers.containers.Network;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Test-classpath tool: never connects to an existing database or starts the application. */
public final class SnapshotMigrationSmoke {
    private SnapshotMigrationSmoke() {}

    record Report(String snapshotSha256, String beforeVersion, String afterVersion, int migrationsExecuted,
                  Map<String, Long> beforeCounts, Map<String, Long> afterCounts) {}
    @FunctionalInterface interface Verification { void check(Connection connection) throws Exception; }

    /** Args contain paths and a checksum only, never credentials or a database URL. */
    public static void main(String[] args) {
        // PostgreSQL/Flyway errors can contain COPY data or SQL values from the private snapshot.
        ((ch.qos.logback.classic.Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)).setLevel(Level.OFF);
        Path report = null;
        String phase = "arguments";
        try {
            if (args.length != 3) throw new IllegalArgumentException("Expected dump, SHA256 and new report path");
            report = Path.of(args[2]);
            if (!report.isAbsolute() || !Files.isDirectory(report.getParent())) throw new IllegalArgumentException("Invalid report path");
            // Reserve a fresh report before reading a snapshot; an existing report is never overwritten.
            Files.createFile(report);
            phase = "snapshot-verification";
            Report result = verify(Path.of(args[0]), args[1], connection -> {});
            phase = "report";
            Files.writeString(report, new ObjectMapper().writeValueAsString(Map.of("completed", true, "result", result)));
            System.out.println("Snapshot migration verified; see the private report.");
        } catch (Exception failure) {
            if (failure instanceof CheckFailure check) phase = check.phase;
            else if (failure instanceof IllegalArgumentException && !phase.equals("arguments")) phase = "input";
            else if (failure instanceof org.flywaydb.core.api.FlywayException) phase = "flyway";
            if (report != null && !phase.equals("arguments")) {
                try { Files.writeString(report, new ObjectMapper().writeValueAsString(Map.of("completed", false, "phase", phase))); }
                catch (Exception ignored) { /* The process still fails; no private exception details are printed. */ }
            }
            System.err.println("Snapshot migration smoke failed in phase " + phase + "; no data or exception details were logged.");
            System.exit(1);
        }
    }

    static Report verify(Path dump, String expectedSha256, Verification probe) throws Exception {
        validateInput(dump, expectedSha256);
        // A dedicated bridge permits host JDBC on Docker Desktop; it does not block outbound traffic.
        // Only trusted dumps are accepted operationally. No application network is joined.
        try (Network network = Network.newNetwork();
             PostgreSQLContainer postgres = newDatabase().withNetwork(network)) {
            postgres.start();
            var bindings = postgres.getContainerInfo().getNetworkSettings().getPorts().getBindings().get(new ExposedPort(5432));
            require(bindings != null && bindings.length == 1 && "127.0.0.1".equals(bindings[0].getHostIp()), "loopback-binding");
            var networks = postgres.getContainerInfo().getNetworkSettings().getNetworks();
            require(networks.size() == 1 && networks.values().stream().allMatch(value -> network.getId().equals(value.getNetworkID())), "isolated-network");
            postgres.copyFileToContainer(MountableFile.forHostPath(dump, 0600), "/tmp/snapshot.dump");
            var copiedHash = postgres.execInContainer("sha256sum", "/tmp/snapshot.dump");
            require(copiedHash.getExitCode() == 0 && copiedHash.getStdout().startsWith(expectedSha256.toLowerCase() + " "), "copied-checksum");
            var restored = postgres.execInContainer("pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges",
                    "-U", postgres.getUsername(), "-d", postgres.getDatabaseName(), "/tmp/snapshot.dump");
            require(restored.getExitCode() == 0, "restore");
            var flyway = Flyway.configure().dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                    .locations("classpath:db/migration").cleanDisabled(true).baselineOnMigrate(false).ignoreMigrationPatterns(new String[0]).load();
            try (Connection connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())) {
                List<String> beforeHistory = history(connection);
                require(!beforeHistory.isEmpty(), "missing-history");
                var before = flyway.info().current();
                require(before != null && before.getVersion() != null, "missing-version");
                Map<String, Long> beforeCounts = counts(connection);
                require(beforeCounts.getOrDefault("identity_account", 0L) > 0, "empty-snapshot");
                // Migrate validates applied checksums; future versions are not ignored.
                var migrated = flyway.migrate();
                require(migrated.migrationsExecuted > 0, "no-pending-migrations");
                flyway.validate();
                List<String> afterHistory = history(connection);
                require(afterHistory.size() == beforeHistory.size() + migrated.migrationsExecuted
                        && afterHistory.subList(0, beforeHistory.size()).equals(beforeHistory), "history-preservation");
                Map<String, Long> afterCounts = counts(connection);
                for (var entry : beforeCounts.entrySet()) require(entry.getValue().equals(afterCounts.get(entry.getKey())), "row-counts");
                probe.check(connection);
                List<String> schema = schema(connection);
                require(flyway.migrate().migrationsExecuted == 0, "second-migration");
                flyway.validate();
                require(afterCounts.equals(counts(connection)) && afterHistory.equals(history(connection)) && schema.equals(schema(connection)), "restart-preservation");
                probe.check(connection);
                return new Report(expectedSha256.toLowerCase(), before.getVersion().getVersion(), flyway.info().current().getVersion().getVersion(),
                        migrated.migrationsExecuted, beforeCounts, afterCounts);
            }
        }
    }

    static PostgreSQLContainer newDatabase() {
        return new PostgreSQLContainer(DockerImageName.parse("postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24").asCompatibleSubstituteFor("postgres"))
                .withDatabaseName("mentor_migration_smoke").withUsername("synthetic").withPassword(UUID.randomUUID().toString())
                .withReuse(false).withLabel("ru.mentor.migration-smoke", "true")
                .withCreateContainerCmdModifier(command -> command.getHostConfig().withPortBindings(
                        new PortBinding(Ports.Binding.bindIp("127.0.0.1"), new ExposedPort(5432))));
    }

    private static void validateInput(Path dump, String expected) throws Exception {
        if (dump == null || !dump.isAbsolute() || !Files.isRegularFile(dump, LinkOption.NOFOLLOW_LINKS) || !Files.isReadable(dump))
            throw new IllegalArgumentException("Expected an absolute readable dump file");
        if (expected == null || !expected.matches("[A-Fa-f0-9]{64}")) throw new IllegalArgumentException("Expected SHA256");
        try (InputStream input = Files.newInputStream(dump)) {
            if (!java.util.Arrays.equals(input.readNBytes(5), new byte[]{'P', 'G', 'D', 'M', 'P'}))
                throw new IllegalArgumentException("Expected a custom-format PostgreSQL dump");
        }
        if (!sha256(dump).equalsIgnoreCase(expected)) throw new IllegalArgumentException("Snapshot checksum mismatch");
    }

    static String sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(path)) {
            byte[] bytes = new byte[65536]; int count;
            while ((count = input.read(bytes)) != -1) digest.update(bytes, 0, count);
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static Map<String, Long> counts(Connection connection) throws Exception {
        Map<String, Long> result = new LinkedHashMap<>();
        for (String table : rows(connection, "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'flyway_schema_history' ORDER BY tablename")) {
            try (var statement = connection.createStatement(); var values = statement.executeQuery("SELECT count(*) FROM public.\"" + table.replace("\"", "\"\"") + "\"")) {
                values.next(); result.put(table, values.getLong(1));
            }
        }
        return result;
    }

    private static List<String> history(Connection connection) throws Exception {
        try (var statement = connection.createStatement(); var values = statement.executeQuery("SELECT count(*) FROM flyway_schema_history WHERE NOT success")) {
            values.next(); require(values.getLong(1) == 0, "failed-history");
        }
        return rows(connection, "SELECT row_to_json(h)::text FROM flyway_schema_history h ORDER BY installed_rank");
    }

    private static List<String> schema(Connection connection) throws Exception {
        return rows(connection, """
                SELECT item FROM (
                  SELECT 'column:'||table_name||':'||column_name||':'||ordinal_position||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') AS item
                  FROM information_schema.columns WHERE table_schema='public'
                  UNION ALL SELECT 'index:'||indexname||':'||indexdef FROM pg_indexes WHERE schemaname='public'
                  UNION ALL SELECT 'constraint:'||c.relname||':'||k.conname||':'||pg_get_constraintdef(k.oid)
                  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
                ) s ORDER BY item
                """);
    }

    private static List<String> rows(Connection connection, String sql) throws Exception {
        List<String> result = new ArrayList<>();
        try (var statement = connection.createStatement(); var values = statement.executeQuery(sql)) {
            while (values.next()) result.add(values.getString(1));
        }
        return result;
    }

    private static void require(boolean condition, String phase) {
        if (!condition) throw new CheckFailure(phase);
    }

    /** Only our fixed check names may leave the process; database exception messages must not. */
    private static final class CheckFailure extends IllegalStateException {
        private final String phase;
        private CheckFailure(String phase) {
            super("Snapshot migration check failed: " + phase);
            this.phase = phase;
        }
    }
}
