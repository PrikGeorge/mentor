package ru.mentor.platform.support;

import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.identity.AuthService;
import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.*;

/** Test-only, isolated real-browser bootstrap. No HTTP test endpoints. */
public final class BrowserFixture {
    private BrowserFixture() {}
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected runtimeDirectory browserOrigin");
        Path runtime = Path.of(args[0]).toAbsolutePath().normalize();
        URI browser = URI.create(args[1]);
        if (!"http".equals(browser.getScheme()) || !"127.0.0.1".equals(browser.getHost())
                || browser.getPort() < 1 || browser.getPort() == 4173 || !browser.getRawPath().isEmpty()
                || browser.getRawQuery() != null || browser.getRawFragment() != null || browser.getUserInfo() != null)
            throw new IllegalArgumentException("Expected isolated loopback browser origin");
        Files.createDirectories(runtime);
        if (Files.exists(runtime.resolve("ready.json"))) throw new IllegalArgumentException("Use a fresh runtime directory");
        byte[] secret = new byte[24]; new SecureRandom().nextBytes(secret);
        String password = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        ObjectMapper json = new ObjectMapper();
        try (var postgres = new PostgreSQLContainer("postgres:17.6-alpine")
                .withDatabaseName("mentor_browser_synthetic").withUsername("synthetic").withPassword(password)) {
            postgres.start();
            var settings = Map.<String,Object>of("server.port", "0", "server.address", "127.0.0.1", "spring.datasource.url", postgres.getJdbcUrl(),
                "spring.datasource.username", postgres.getUsername(), "spring.datasource.password", password,
                "spring.config.import", "", "mentor.security.public-origin", browser.toString(), "mentor.security.production", "false");
            try (var context = new SpringApplicationBuilder(MentorApplication.class)
                    .initializers(app -> app.getEnvironment().getPropertySources().addFirst(new MapPropertySource("synthetic-browser", settings)))
                    .run()) {
                context.getBean(AuthService.class).createOrRestoreAdmin("browser-admin", password);
                Path credentials = runtime.resolve("credentials.json");
                privateWrite(credentials, json.writeValueAsString(Map.of("login", "browser-admin", "password", password)));
                String backend = "http://127.0.0.1:" + ((WebServerApplicationContext)context).getWebServer().getPort();
                Files.writeString(runtime.resolve("ready.json"), json.writeValueAsString(Map.of(
                    "backendOrigin", backend, "browserOrigin", browser.toString(), "credentialsPath", credentials.toString())));
                while (!Files.exists(runtime.resolve("stop"))) Thread.sleep(250);
            }
        } finally {
            Files.deleteIfExists(runtime.resolve("credentials.json"));
            Files.deleteIfExists(runtime.resolve("ready.json"));
        }
    }
    private static void privateWrite(Path path, String value) throws Exception {
        try { Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))); }
        catch (UnsupportedOperationException ignored) { Files.createFile(path); }
        Files.writeString(path, value);
    }
}
