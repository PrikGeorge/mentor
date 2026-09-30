package ru.mentor.platform.identity;

import org.springframework.stereotype.Component;
import ru.mentor.platform.shared.ApiFailure;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;

@Component
public class AuthRateLimiter {
    private record Bucket(int count,long expires) {}
    private final Clock clock;
    private final Map<String,Bucket> buckets = new HashMap<>();
    private Bucket global = new Bucket(0,0);
    public AuthRateLimiter(Clock clock) { this.clock = clock; }
    public synchronized void admit(String path,String method,String ip) {
        long now = clock.millis();
        if(global.expires() <= now) global = new Bucket(0,now+60_000);
        global = new Bucket(global.count()+1,global.expires());
        if(global.count() > 120) limited(global.expires(),now);
        if("POST".equals(method)) {
            if(path.equals("/api/v1/auth/login")) count("login-ip:"+ip,100,900_000,now);
            else if(path.equals("/api/v1/auth/register") || path.equals("/api/v1/auth/reset-password")) count("register-ip:"+ip,20,900_000,now);
        }
    }
    public synchronized void login(String login) {
        count("login:"+AuthService.normalizeLogin(login),10,900_000,clock.millis());
    }
    private void count(String key,int maximum,long window,long now) {
        buckets.entrySet().removeIf(entry -> entry.getValue().expires() <= now);
        Bucket bucket = buckets.get(key);
        if(bucket == null) {
            if(buckets.size() >= 10_000) limited(buckets.values().stream().mapToLong(Bucket::expires).min().orElse(now+window),now);
            bucket = new Bucket(0,now+window);
        }
        bucket = new Bucket(bucket.count()+1,bucket.expires()); buckets.put(key,bucket);
        if(bucket.count() > maximum) limited(bucket.expires(),now);
    }
    private static void limited(long expires,long now) { throw new ApiFailure(429,"RATE_LIMITED","Too many authentication requests.",(int)Math.max(1,(expires-now+999)/1000)); }
}
