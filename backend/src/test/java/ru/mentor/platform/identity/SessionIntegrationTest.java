package ru.mentor.platform.identity;

import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.support.PostgresTest;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.time.*;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SessionIntegrationTest extends PostgresTest {
    private ConfigurableApplicationContext context;
    private String origin;
    private final ObjectMapper json = new ObjectMapper();
    private static final MutableClock CLOCK = new MutableClock();

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> time = new AtomicReference<>(Instant.now());
        void advance(Duration duration) { time.updateAndGet(value -> value.plus(duration)); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return time.get(); }
    }
    @TestConfiguration(proxyBeanMethods=false) static class ClockConfiguration {
        @Bean @Primary Clock controlledClock() { return CLOCK; }
    }

    @BeforeAll void start() {
        POSTGRES.start();
        startContext(0);
    }
    private void startContext(int port) {
        context = new SpringApplicationBuilder(MentorApplication.class,ClockConfiguration.class).run("--server.port=" + port,
            "--spring.datasource.url=" + POSTGRES.getJdbcUrl(), "--spring.datasource.username=" + POSTGRES.getUsername(),
            "--spring.datasource.password=" + POSTGRES.getPassword());
        origin = "http://localhost:" + ((WebServerApplicationContext) context).getWebServer().getPort();
    }
    @AfterAll void stop() { if(context != null) context.close(); POSTGRES.stop(); }
    @BeforeEach void seed() {
        CLOCK.advance(Duration.ofDays(16));
        JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
        jdbc.update("DELETE FROM SPRING_SESSION");
        jdbc.update("DELETE FROM identity_account");
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) VALUES (?,?,?,?)", "synthetic-admin", "admin", context.getBean(PasswordCodec.class).importLegacy(PasswordCompatibilityTest.NODE_HASH), "ADMIN");
    }
    private HttpClient client() { return HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL)).build(); }
    private HttpResponse<String> get(HttpClient client, String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(origin + "/api/v1" + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> post(HttpClient client, String path, String body, String csrf, String account) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(origin + "/api/v1" + path)).header("Origin", origin).header("X-Mentor-Client", "web").header("Content-Type", "application/json");
        if(csrf != null) builder.header("X-CSRF-TOKEN", csrf);
        if(account != null) builder.header("X-Mentor-Account", account);
        return client.send(builder.POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build(), HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode session(HttpClient client) throws Exception {
        var response = get(client, "/auth/session");
        assertEquals(200, response.statusCode(), response.body());
        return json.readTree(response.body());
    }
    private JsonNode login(HttpClient client) throws Exception {
        String token = session(client).get("csrfToken").asText();
        var response = post(client,"/auth/login","{\"login\":\"admin\",\"password\":\"  Пароль😀8  \"}",token,null);
        assertEquals(200,response.statusCode(),response.body());
        return json.readTree(response.body());
    }

    private HttpRequest.Builder bodylessLogout(String csrf, String account) {
        var builder = HttpRequest.newBuilder(URI.create(origin + "/api/v1/auth/logout"))
            .header("Origin", origin).header("X-Mentor-Client", "web").POST(HttpRequest.BodyPublishers.noBody());
        if(csrf != null) builder.header("X-CSRF-TOKEN", csrf);
        if(account != null) builder.header("X-Mentor-Account", account);
        return builder;
    }

    @Test void authenticatedLogoutAcceptsNoBodyAndNoContentTypeAndRevokesSession() throws Exception {
        HttpClient client = client(); JsonNode actor = login(client);
        var request = bodylessLogout(actor.get("csrfToken").asText(), "synthetic-admin").build();
        assertTrue(request.headers().firstValue("Content-Type").isEmpty());
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(204, response.statusCode(), response.body());
        assertEquals("", response.body());
        assertEquals(0, context.getBean(JdbcTemplate.class).queryForObject(
            "SELECT count(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME='synthetic-admin'", Integer.class));
        assertTrue(session(client).get("account").isNull());
    }

    @Test void anonymousLogoutAcceptsNoBodyAndNoContentTypeAndInvalidatesSession() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        var request = bodylessLogout(csrf, null).build();
        assertTrue(request.headers().firstValue("Content-Type").isEmpty());
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(204, response.statusCode(), response.body());
        assertEquals("", response.body());
        assertEquals(0, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM SPRING_SESSION", Integer.class));
        assertTrue(session(client).get("account").isNull());
    }

    @Test void bodylessLogoutRetainsCsrfAccountOriginAndClientProtection() throws Exception {
        HttpClient anonymous = client(); String anonymousCsrf = session(anonymous).get("csrfToken").asText();
        assertEquals(403, anonymous.send(bodylessLogout(null, null).build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(403, anonymous.send(bodylessLogout(anonymousCsrf + "bad", null).build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        HttpClient authenticated = client(); String csrf = login(authenticated).get("csrfToken").asText();
        assertEquals(403, authenticated.send(bodylessLogout(null, "synthetic-admin").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(403, authenticated.send(bodylessLogout(csrf + "bad", "synthetic-admin").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        for(String account : new String[]{null, "old-tab-account"}) {
            var rejected = authenticated.send(bodylessLogout(csrf, account).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(409, rejected.statusCode(), rejected.body());
            assertEquals("ACCOUNT_CHANGED", json.readTree(rejected.body()).get("code").asText());
        }
        assertEquals(403, authenticated.send(bodylessLogout(csrf, "synthetic-admin").setHeader("Origin", "https://attacker.invalid").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(403, authenticated.send(bodylessLogout(csrf, "synthetic-admin").setHeader("X-Mentor-Client", "other").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(403, authenticated.send(bodylessLogout(csrf, "synthetic-admin").header("Sec-Fetch-Site", "cross-site").build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals("synthetic-admin", session(authenticated).get("account").get("userId").asText());
    }

    @Test void jsonPayloadAuthRoutesStillRequireJsonContentType() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        var loginRequest = HttpRequest.newBuilder(URI.create(origin + "/api/v1/auth/login"))
            .header("Origin", origin).header("X-Mentor-Client", "web").header("X-CSRF-TOKEN", csrf)
            .POST(HttpRequest.BodyPublishers.noBody()).build();
        assertEquals(415, client.send(loginRequest, HttpResponse.BodyHandlers.ofString()).statusCode());
        csrf = login(client).get("csrfToken").asText();
        var passwordRequest = HttpRequest.newBuilder(URI.create(origin + "/api/v1/auth/change-password"))
            .header("Origin", origin).header("X-Mentor-Client", "web").header("X-CSRF-TOKEN", csrf)
            .header("X-Mentor-Account", "synthetic-admin").header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString("synthetic")).build();
        assertEquals(415, client.send(passwordRequest, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test void anonymousCsrfLoginRotationAndLogoutShareOnePolicy() throws Exception {
        HttpClient client = client();
        var anonymous = get(client, "/auth/session");
        assertEquals(200, anonymous.statusCode(), anonymous.body());
        JsonNode initial = json.readTree(anonymous.body());
        assertTrue(initial.get("account").isNull());
        String token = initial.get("csrfToken").asText();
        assertFalse(token.isBlank());
        String cookie = anonymous.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(cookie.contains("HttpOnly")); assertTrue(cookie.contains("SameSite=Lax"));
        assertFalse(cookie.toLowerCase(Locale.ROOT).contains("domain="));
        var missingCsrf = post(client, "/auth/login", "{\"login\":\"admin\",\"password\":\"  Пароль😀8  \"}", null, null);
        assertEquals(403, missingCsrf.statusCode());
        var login = post(client, "/auth/login", "{\"login\":\" ＡＤＭＩＮ \",\"password\":\"  Пароль😀8  \"}", token, null);
        assertEquals(200, login.statusCode(), login.body());
        assertNotEquals(cookie.split(";",2)[0], login.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0]);
        JsonNode authenticated = session(client);
        assertEquals("synthetic-admin", authenticated.get("account").get("userId").asText());
        assertEquals("ADMIN", authenticated.get("account").get("role").asText());
        assertTrue(authenticated.get("account").get("workspaceId").isNull());
        assertFalse(login.body().contains("password")); assertFalse(login.body().contains("SESSION"));
        var logout = post(client, "/auth/logout", "{}", authenticated.get("csrfToken").asText(), "synthetic-admin");
        assertEquals(204, logout.statusCode(), logout.body());
        assertTrue(session(client).get("account").isNull());
    }

    @Test void rejectsAnonymousWritesAndUnknownLoginWithStructuredNonLeakingErrors() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        var write = post(client, "/auth/change-password", "{\"currentPassword\":\"test\",\"newPassword\":\"synthetic-new\"}", csrf, null);
        assertEquals(401, write.statusCode(), write.body());
        var unknown = post(client, "/auth/login", "{\"login\":\"unknown\",\"password\":\"synthetic-password\"}", csrf, null);
        assertEquals(401, unknown.statusCode(), unknown.body());
        JsonNode problem = json.readTree(unknown.body());
        assertEquals("INVALID_CREDENTIALS", problem.get("code").asText());
        assertEquals(401, problem.get("status").asInt());
        assertTrue(problem.get("fieldErrors").isObject()); assertFalse(problem.get("requestId").asText().isBlank());
        assertFalse(unknown.body().contains("synthetic-password")); assertFalse(unknown.body().contains(csrf));
    }

    @Test void sessionSurvivesApplicationRestartWithSamePostgres() throws Exception {
        HttpClient client = client(); login(client);
        int port = URI.create(origin).getPort();
        context.close(); startContext(port);
        JsonNode restored = session(client);
        assertEquals("synthetic-admin",restored.get("account").get("userId").asText());
        assertEquals(1,context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME='synthetic-admin'",Integer.class));
    }

    @Test void expiresAtIdleDeadlineAndAtAbsoluteDeadlineDespiteActivity() throws Exception {
        HttpClient idle = client(); login(idle);
        CLOCK.advance(Duration.ofHours(8));
        assertTrue(session(idle).get("account").isNull());
        HttpClient active = client(); login(active);
        for(int i=0;i<23;i++) {
            CLOCK.advance(Duration.ofHours(7));
            assertFalse(session(active).get("account").isNull());
        }
        CLOCK.advance(Duration.ofHours(7)); // exactly 7 days from authentication
        assertTrue(session(active).get("account").isNull());
    }

    @Test void rechecksDisabledAndAuthVersionOnEveryRequest() throws Exception {
        HttpClient disabled = client(); login(disabled);
        var jdbc = context.getBean(JdbcTemplate.class);
        jdbc.update("UPDATE identity_account SET disabled=TRUE WHERE id='synthetic-admin'");
        assertTrue(session(disabled).get("account").isNull());
        jdbc.update("UPDATE identity_account SET disabled=FALSE WHERE id='synthetic-admin'");
        HttpClient revoked = client(); login(revoked);
        jdbc.update("UPDATE identity_account SET auth_version=auth_version+1 WHERE id='synthetic-admin'");
        assertTrue(session(revoked).get("account").isNull());
    }

    @Test void mismatchedAccountPreventsPasswordWriteAndPasswordChangeRevokesOtherSessions() throws Exception {
        HttpClient owner = client(), other = client();
        JsonNode own = login(owner); login(other);
        String csrf = own.get("csrfToken").asText();
        String input = "{\"currentPassword\":\"  Пароль😀8  \",\"newPassword\":\"synthetic-new-password\"}";
        var mismatch = post(owner,"/auth/change-password",input,csrf,"old-tab-account");
        assertEquals(409,mismatch.statusCode(),mismatch.body());
        assertEquals("ACCOUNT_CHANGED",json.readTree(mismatch.body()).get("code").asText());
        assertEquals(1,context.getBean(JdbcTemplate.class).queryForObject("SELECT auth_version FROM identity_account WHERE id='synthetic-admin'",Long.class));
        var changed = post(owner,"/auth/change-password",input,csrf,"synthetic-admin");
        assertEquals(200,changed.statusCode(),changed.body());
        assertEquals(2,json.readTree(changed.body()).get("account").get("authVersion").asLong());
        assertEquals(2,session(owner).get("account").get("authVersion").asLong());
        assertTrue(session(other).get("account").isNull());
        var staleCsrf = post(owner,"/auth/logout","{}",csrf,"synthetic-admin");
        assertEquals(403,staleCsrf.statusCode());
        var encoded = context.getBean(JdbcTemplate.class).queryForObject("SELECT password_hash FROM identity_account WHERE id='synthetic-admin'",String.class);
        assertTrue(context.getBean(PasswordCodec.class).matches("synthetic-new-password",encoded));
        assertFalse(context.getBean(PasswordCodec.class).matches("  Пароль😀8  ",encoded));
    }

    @Test void normalizedLoginLimitReturns429AndExpiresAfterFifteenMinutes() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        for(int i=0;i<10;i++) {
            String login = i%2==0 ? "ＡＤＭＩＮ" : "admin";
            assertEquals(401,post(client,"/auth/login","{\"login\":\""+login+"\",\"password\":\"synthetic-wrong\"}",csrf,null).statusCode());
        }
        var blocked = post(client,"/auth/login","{\"login\":\"admin\",\"password\":\"  Пароль😀8  \"}",csrf,null);
        assertEquals(429,blocked.statusCode(),blocked.body());
        assertEquals("RATE_LIMITED",json.readTree(blocked.body()).get("code").asText());
        assertEquals("900",blocked.headers().firstValue("retry-after").orElseThrow());
        CLOCK.advance(Duration.ofMinutes(15));
        assertEquals(200,post(client,"/auth/login","{\"login\":\"admin\",\"password\":\"  Пароль😀8  \"}",csrf,null).statusCode());
    }

    @Test void authGlobalLimitDoesNotThrottleOtherApiPollingAndDoesNotTrustForwardedIp() throws Exception {
        HttpClient client = client(); login(client);
        // Two auth requests used by login; 118 further auth GETs reach the global boundary.
        for(int i=0;i<118;i++) assertEquals(200,get(client,"/auth/session").statusCode());
        var blocked = get(client,"/auth/session");
        assertEquals(429,blocked.statusCode(),blocked.body());
        assertEquals("60",blocked.headers().firstValue("retry-after").orElseThrow());
        for(int i=0;i<125;i++) assertEquals(404,get(client,"/polling-not-yet-implemented").statusCode());
        CLOCK.advance(Duration.ofMinutes(1));
        assertEquals(200,get(client,"/auth/session").statusCode());
    }

    @Test void rejectsCrossOriginInvalidFieldsAndCsrfTamperingWithoutLeakingInput() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        var cross = client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/auth/login"))
            .header("Origin","https://attacker.invalid").header("X-Mentor-Client","web").header("Content-Type","application/json")
            .header("X-CSRF-TOKEN",csrf).header("X-Forwarded-Host","attacker.invalid").header("Forwarded","host=attacker.invalid;proto=https")
            .POST(HttpRequest.BodyPublishers.ofString("{\"login\":\"admin\",\"password\":\"sensitive-synthetic\"}")).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(403,cross.statusCode(),cross.body()); assertFalse(cross.body().contains("sensitive-synthetic"));
        assertEquals(403,post(client,"/auth/login","{}",csrf+"bad",null).statusCode());
        assertEquals(400,post(client,"/auth/login","{\"login\":\"admin\",\"password\":\"sensitive-synthetic\",\"role\":\"ADMIN\"}",csrf,null).statusCode());
        assertEquals(400,post(client,"/auth/login","{\"login\":\"ab\",\"password\":\"sensitive-synthetic\"}",csrf,null).statusCode());
        JsonNode admin = login(client);
        assertEquals(400,post(client,"/auth/change-password","{\"currentPassword\":\"  Пароль😀8  \",\"newPassword\":\"bad\"}",admin.get("csrfToken").asText(),"synthetic-admin").statusCode());
        assertEquals(401,post(client,"/auth/change-password","{\"currentPassword\":\"synthetic-wrong\",\"newPassword\":\"synthetic-new\"}",admin.get("csrfToken").asText(),"synthetic-admin").statusCode());
    }

    @Test void adminBootstrapRestoresOnlyAdminAndRevokesExistingSessions() throws Exception {
        HttpClient client = client(); login(client);
        var auth = context.getBean(AuthService.class); var jdbc = context.getBean(JdbcTemplate.class);
        jdbc.update("UPDATE identity_account SET disabled=TRUE WHERE id='synthetic-admin'");
        var restored = auth.createOrRestoreAdmin(" ADMIN ","synthetic-admin-restored");
        assertEquals("synthetic-admin",restored.userId()); assertEquals(2,restored.authVersion());
        assertTrue(session(client).get("account").isNull());
        assertEquals(restored,auth.authenticate("admin","synthetic-admin-restored"));
        var created = auth.createOrRestoreAdmin("new-admin","synthetic-created-admin");
        assertNotEquals("synthetic-admin",created.userId()); assertEquals("ADMIN",created.role().name());
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) VALUES ('teacher-reference','teacher',?,'TEACHER')",PasswordCompatibilityTest.NODE_HASH.hashBase64());
        var blocked = assertThrows(ru.mentor.platform.shared.ApiFailure.class,() -> auth.createOrRestoreAdmin("teacher","synthetic-admin-restored"));
        assertEquals(409,blocked.status());
        assertEquals("TEACHER",jdbc.queryForObject("SELECT role FROM identity_account WHERE id='teacher-reference'",String.class));
    }

    @Test void requestPolicyDoesNotForceJsonOnFutureNonAuthUploadRoutes() throws Exception {
        HttpClient client = client(); JsonNode account = login(client);
        var response = client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/upload-not-yet-implemented"))
            .header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account","synthetic-admin")
            .header("X-CSRF-TOKEN",account.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary=synthetic")
            .POST(HttpRequest.BodyPublishers.ofString("--synthetic--\r\n")).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(404,response.statusCode(),response.body());
    }

    @Test void databaseOutageReturnsStructuredUnavailableInsteadOfFrameworkError() throws Exception {
        HttpClient client = client(); login(client);
        int port = URI.create(origin).getPort();
        context.getBean(com.zaxxer.hikari.HikariDataSource.class).close();
        try {
            var response = get(client,"/auth/session");
            assertEquals(503,response.statusCode(),response.body());
            var problem = json.readTree(response.body());
            assertEquals("AUTH_UNAVAILABLE",problem.get("code").asText());
            assertTrue(problem.get("fieldErrors").isObject()); assertFalse(problem.get("requestId").asText().isBlank());
            assertFalse(response.body().contains("SQLException")); assertFalse(response.body().contains("password"));
        } finally { context.close(); startContext(port); }
    }

    @Test void adminServicesStartWithoutWebServerAndReadPasswordFromPrivateConfigTree() throws Exception {
        java.nio.file.Path secrets = java.nio.file.Files.createTempDirectory("mentor-synthetic-secrets-");
        java.nio.file.Path passwordFile = secrets.resolve("spring.datasource.password");
        java.nio.file.Files.writeString(passwordFile,POSTGRES.getPassword());
        try(var adminContext = new SpringApplicationBuilder(MentorApplication.class)
            .web(org.springframework.boot.WebApplicationType.NONE).run(
                "--spring.datasource.url="+POSTGRES.getJdbcUrl(), "--spring.datasource.username="+POSTGRES.getUsername(),
                "--spring.config.import=configtree:"+secrets.toAbsolutePath().toString().replace('\\','/')+"/")) {
            assertEquals(1,adminContext.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM identity_account",Integer.class));
            assertNotNull(adminContext.getBean(AdminCommand.class));
            assertEquals("synthetic-admin",adminContext.getBean(AuthService.class).authenticate("admin","  Пароль😀8  ").userId());
            assertThrows(IllegalStateException.class,() -> adminContext.getBean(AdminCommand.class).run()); // Surefire has no interactive Console.
        } finally { java.nio.file.Files.deleteIfExists(passwordFile); java.nio.file.Files.deleteIfExists(secrets); }
    }

    @Test void loginIpLimitIgnoresClientSuppliedForwardedAddresses() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        for(int i=0;i<101;i++) {
            var response = client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/auth/login"))
                .header("Origin",origin).header("X-Mentor-Client","web").header("Content-Type","application/json").header("X-CSRF-TOKEN",csrf)
                .header("X-Forwarded-For","192.0.2."+(i%250+1)).header("Forwarded","for=192.0.2."+(i%250+1))
                .POST(HttpRequest.BodyPublishers.ofString("{}")).build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(i<100 ? 400 : 429,response.statusCode(),response.body());
        }
    }

    @Test void missingRequiredPasswordsReturnValidationErrorsBeforeAuthentication() throws Exception {
        HttpClient client = client(); String csrf = session(client).get("csrfToken").asText();
        var missing = post(client,"/auth/login","{\"login\":\"admin\"}",csrf,null);
        assertEquals(400,missing.statusCode(),missing.body());
        assertEquals("INVALID_INPUT",json.readTree(missing.body()).get("code").asText());
        var actor = login(client);
        var change = post(client,"/auth/change-password","{\"newPassword\":\"synthetic-new\"}",actor.get("csrfToken").asText(),"synthetic-admin");
        assertEquals(400,change.statusCode(),change.body());
    }
}
