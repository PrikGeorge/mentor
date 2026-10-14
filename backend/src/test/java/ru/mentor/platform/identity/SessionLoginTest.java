package ru.mentor.platform.identity;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import static org.junit.jupiter.api.Assertions.*;

class SessionLoginTest extends IdentityHttpTest {
    // Catches the header naming another account or an anonymous client receiving a login.
    @Test void sessionNamesOnlyTheSignedInLogin() throws Exception {
        assertFalse(session(client()).has("login"));
        var teacher=teacher("session-login-teacher");
        assertEquals("session-login-teacher",session(teacher.client()).get("login").asText());
        assertEquals("admin",session(admin).get("login").asText());
    }
}
