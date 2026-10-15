package ru.mentor.platform.support;

import org.junit.jupiter.api.*;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.util.Map;
import java.nio.file.Files;
import java.net.http.HttpClient;

import static org.junit.jupiter.api.Assertions.*;

/** Catches repeated server starts and state escaping from one HTTP test class into another. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestClassOrder(ClassOrderer.OrderAnnotation.class)
class SharedHttpRuntimeTest {
    private ConfigurableApplicationContext firstContext;
    private String firstOrigin;
    private HttpClient previousAdmin;

    @Nested @Order(1)
    class FirstClass extends IdentityHttpTest {
        @RepeatedTest(2) void advancesTheClockUsedByAuthenticationLimits() {
            var limits = context.getBean(ru.mentor.platform.identity.AuthRateLimiter.class);
            for (int i = 0; i < 20; i++) limits.admit("/api/v1/auth/register", "POST", "synthetic-clock-client");
        }

        @Test void leavesStateForTheNextClass() throws Exception {
            firstContext = context;
            firstOrigin = origin;
            previousAdmin = admin;
            teacher("previous-class-teacher");
            Files.writeString(runtimeRoot.resolve("objects/previous-test.txt"), "synthetic upload");
            Files.writeString(runtimeRoot.resolve("spool/previous-test.txt"), "synthetic spool");
            Files.writeString(runtimeRoot.resolve("multipart/previous-test.txt"), "synthetic part");
            jdbc.update("UPDATE practice_queue_control SET last_worker_seen_at=now()");
            context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("synthetic-runner", Map.of("mentor.runner.token-file", "previous-test-only")));
        }
    }

    @Nested @Order(2)
    class SecondClass extends IdentityHttpTest {
        @Test void reusesTheServerWithCleanDataAndSettings() throws Exception {
            assertAll(
                () -> assertSame(firstContext, context, "HTTP classes must reuse the Spring context"),
                () -> assertEquals(firstOrigin, origin),
                () -> assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM identity_account", Integer.class)),
                () -> assertNull(jdbc.queryForObject("SELECT last_worker_seen_at FROM practice_queue_control", Object.class)),
                () -> assertNull(context.getEnvironment().getPropertySources().get("synthetic-runner")),
                () -> assertFalse(Files.exists(runtimeRoot.resolve("objects/previous-test.txt"))),
                () -> assertFalse(Files.exists(runtimeRoot.resolve("spool/previous-test.txt"))),
                () -> assertFalse(Files.exists(runtimeRoot.resolve("multipart/previous-test.txt"))),
                () -> assertTrue(session(previousAdmin).get("account").isNull()),
                () -> assertEquals("ADMIN", session(admin).get("account").get("role").asText())
            );
        }
    }
}
