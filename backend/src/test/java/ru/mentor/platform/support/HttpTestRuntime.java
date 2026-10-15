package ru.mentor.platform.support;

import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.identity.PasswordCodec;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

/** One synthetic database/server per JUnit run; restart tests retain the database and replace the server. */
public final class HttpTestRuntime implements AutoCloseable {
    private final PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17.6-alpine")
        .withDatabaseName("mentor_http_test").withUsername("synthetic").withPassword("synthetic-only");
    final Path root;
    final String passwordHash;
    ConfigurableApplicationContext context;

    private HttpTestRuntime() throws IOException {
        root = Files.createTempDirectory("mentor-http-tests-");
        try {
            postgres.start();
            start();
            passwordHash = context.getBean(PasswordCodec.class).encode(IdentityHttpTest.PASSWORD);
        } catch (RuntimeException | IOException failure) {
            close();
            throw failure;
        }
    }

    private void start() throws IOException {
        Files.createDirectories(root.resolve("multipart"));
        context = new SpringApplicationBuilder(MentorApplication.class, IdentityHttpTest.ClockConfiguration.class).run(
            "--server.port=0", "--spring.config.import=", "--mentor.security.production=false", "--mentor.security.public-origin=",
            "--spring.datasource.url=" + postgres.getJdbcUrl(), "--spring.datasource.username=" + postgres.getUsername(),
            "--spring.datasource.password=" + postgres.getPassword(), "--mentor.blobs.type=local",
            "--mentor.blobs.local-root=" + root.resolve("objects"), "--mentor.blobs.spool-root=" + root.resolve("spool"),
            "--spring.servlet.multipart.location=" + root.resolve("multipart"), "--mentor.blobs.cleanup-enabled=false",
            "--mentor.runner.token-file=", "--mentor.runner.reconcile-interval-ms=86400000");
    }

    void reset() throws IOException {
        context.getEnvironment().getPropertySources().remove("synthetic-runner");
        var jdbc = context.getBean(JdbcTemplate.class);
        jdbc.execute("TRUNCATE identity_account, SPRING_SESSION, import_run CASCADE");
        jdbc.update("UPDATE practice_queue_control SET last_worker_seen_at=NULL");
        for (String directory : new String[]{"objects", "spool", "multipart"}) {
            Path path = root.resolve(directory);
            deleteTree(path);
            Files.createDirectories(path);
        }
    }

    void restart() throws IOException {
        var runner = context.getEnvironment().getPropertySources().get("synthetic-runner");
        context.close();
        start();
        if (runner != null) context.getEnvironment().getPropertySources().addFirst(runner);
    }

    void bind(IdentityHttpTest test) {
        test.runtime = this;
        test.runtimeRoot = root;
        test.context = context;
        test.jdbc = context.getBean(JdbcTemplate.class);
        test.origin = "http://localhost:" + ((WebServerApplicationContext) context).getWebServer().getPort();
    }

    @Override public void close() throws IOException {
        try {
            if (context != null) context.close();
        } finally {
            try { postgres.stop(); } finally { deleteTree(root); }
        }
    }

    private static void deleteTree(Path root) throws IOException {
        if (!Files.exists(root)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }

    public static final class Extension implements BeforeAllCallback {
        @Override public void beforeAll(ExtensionContext context) throws Exception {
            var store = context.getRoot().getStore(ExtensionContext.Namespace.create(HttpTestRuntime.class));
            HttpTestRuntime runtime = store.get(HttpTestRuntime.class, HttpTestRuntime.class);
            if (runtime == null) {
                runtime = new HttpTestRuntime();
                store.put(HttpTestRuntime.class, runtime);
            }
            runtime.bind((IdentityHttpTest) context.getRequiredTestInstance());
        }
    }
}
