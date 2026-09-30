package ru.mentor.platform.identity;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.session.web.http.CookieSerializer;
import ru.mentor.platform.shared.ApiFailure;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class AuthLimitsAndConfigurationTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"),ZoneOffset.UTC);
    @Test void loginIpBucketAndRegistrationResetBucketAreIndependent() {
        var limits = new AuthRateLimiter(clock);
        for(int i=0;i<100;i++) limits.admit("/api/v1/auth/login","POST","synthetic-ip");
        var blocked = assertThrows(ApiFailure.class,() -> limits.admit("/api/v1/auth/login","POST","synthetic-ip"));
        assertEquals(429,blocked.status()); assertEquals(900,blocked.retryAfter());
        // A separate limiter avoids the independent 120/minute bucket masking the 20/15min bucket.
        var register = new AuthRateLimiter(clock);
        for(int i=0;i<20;i++) register.admit(i%2==0 ? "/api/v1/auth/register" : "/api/v1/auth/reset-password","POST","synthetic-ip");
        var resetBlocked = assertThrows(ApiFailure.class,() -> register.admit("/api/v1/auth/reset-password","POST","synthetic-ip"));
        assertEquals(429,resetBlocked.status()); assertEquals(900,resetBlocked.retryAfter());
        register.admit("/api/v1/auth/register","POST","different-ip");
    }
    @Test void productionRequiresAnExactHttpsOrigin() {
        for(String origin : new String[]{"", "http://mentor.invalid", "https://mentor.invalid/", "https://user@mentor.invalid", "https://mentor.invalid?q=1", "https://mentor.invalid#x"}) {
            assertThrows(IllegalArgumentException.class,() -> new IdentityRequestFilter(null,null,null,true,origin));
        }
        assertDoesNotThrow(() -> new IdentityRequestFilter(null,null,null,true,"https://mentor.invalid"));
    }
    @Test void productionCookieIsSecureHttpOnlyAndHostOnly() {
        var serializer = new SecurityConfiguration().cookieSerializer(true);
        var request = new MockHttpServletRequest(); var response = new MockHttpServletResponse();
        serializer.writeCookieValue(new CookieSerializer.CookieValue(request,response,"synthetic-session"));
        String cookie = response.getHeader("Set-Cookie");
        assertNotNull(cookie); assertTrue(cookie.contains("Secure")); assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("SameSite=Lax")); assertFalse(cookie.toLowerCase().contains("domain="));
    }
    @Test void adminCommandRejectsPasswordArgumentsBeforeOpeningApplication() {
        assertThrows(IllegalArgumentException.class,() -> ru.mentor.platform.MentorApplication.main(new String[]{"admin","--password=synthetic-only"}));
    }
}
