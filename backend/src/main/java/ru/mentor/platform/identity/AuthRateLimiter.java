package ru.mentor.platform.identity;

import org.springframework.stereotype.Component;

import ru.mentor.platform.shared.ApiFailure;

import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * In-memory throttles for the authentication surface of one node.
 * Reads (the session poll every screen makes) are limited only per client address, so an anonymous visitor can no
 * longer exhaust a shared budget and lock everyone out. Writes share a global budget plus per-address buckets, and a
 * login is blocked only after repeated wrong passwords for that login, counted after the password check.
 */
@Component
public class AuthRateLimiter {
    static final int GLOBAL_WRITES_PER_MINUTE = 120,
            READS_PER_MINUTE_PER_IP = 600,
            LOGIN_FAILURES_PER_WINDOW = 20;

    private record Bucket(int count, long expires) {}

    private final Clock clock;
    private final Map<String, Bucket> buckets = new HashMap<>();
    private Bucket global = new Bucket(0, 0);

    public AuthRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public synchronized void admit(String path, String method, String ip) {
        long now = clock.millis();
        if (Set.of("GET", "HEAD", "OPTIONS").contains(method)) {
            count("read-ip:" + ip, READS_PER_MINUTE_PER_IP, 60_000, now);
            return;
        }
        if (global.expires() <= now) global = new Bucket(0, now + 60_000);
        global = new Bucket(global.count() + 1, global.expires());
        if (global.count() > GLOBAL_WRITES_PER_MINUTE) limited(global.expires(), now);
        if ("POST".equals(method)) {
            if (path.equals("/api/v1/auth/login")) count("login-ip:" + ip, 100, 900_000, now);
            else if (path.equals("/api/v1/auth/register")
                    || path.equals("/api/v1/auth/reset-password"))
                count("register-ip:" + ip, 20, 900_000, now);
        }
    }

    /** Refuses a login that already collected too many wrong passwords; a correct attempt is still verified first otherwise. */
    public synchronized void beforeLogin(String login) {
        long now = clock.millis();
        buckets.entrySet().removeIf(entry -> entry.getValue().expires() <= now);
        Bucket failures = buckets.get(failuresKey(login));
        if (failures != null && failures.count() >= LOGIN_FAILURES_PER_WINDOW)
            limited(failures.expires(), now);
    }

    /** Counted only after the password was checked and rejected, so knowing a login is not enough to block it. */
    public synchronized void loginFailed(String login) {
        long now = clock.millis();
        String key = failuresKey(login);
        buckets.entrySet().removeIf(entry -> entry.getValue().expires() <= now);
        Bucket failures = buckets.get(key);
        if (failures == null) {
            if (buckets.size() >= 10_000) buckets.clear();
            failures = new Bucket(0, now + 900_000);
        }
        buckets.put(key, new Bucket(failures.count() + 1, failures.expires()));
    }

    public synchronized void loginSucceeded(String login) {
        buckets.remove(failuresKey(login));
    }

    private static String failuresKey(String login) {
        return "login-failures:" + AuthService.normalizeLogin(login);
    }

    private void count(String key, int maximum, long window, long now) {
        buckets.entrySet().removeIf(entry -> entry.getValue().expires() <= now);
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            if (buckets.size() >= 10_000)
                limited(
                        buckets.values().stream()
                                .mapToLong(Bucket::expires)
                                .min()
                                .orElse(now + window),
                        now);
            bucket = new Bucket(0, now + window);
        }
        bucket = new Bucket(bucket.count() + 1, bucket.expires());
        buckets.put(key, bucket);
        if (bucket.count() > maximum) limited(bucket.expires(), now);
    }

    private static void limited(long expires, long now) {
        throw new ApiFailure(
                429,
                "RATE_LIMITED",
                "Too many authentication requests.",
                (int) Math.max(1, (expires - now + 999) / 1000));
    }
}
