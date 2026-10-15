package ru.mentor.platform.identity;

import org.springframework.context.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.*;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.beans.factory.annotation.Value;
import java.time.Clock;
import ru.mentor.platform.shared.ApiExceptionHandler;
import ru.mentor.platform.shared.ApiFailure;

@Configuration(proxyBeanMethods=false)
public class SecurityConfiguration {
    @Bean @ConditionalOnMissingBean(Clock.class) Clock clock() { return Clock.systemUTC(); }
    @Bean CsrfTokenRepository csrfTokenRepository() { return new HttpSessionCsrfTokenRepository(); }
    @Bean @ConditionalOnWebApplication CookieSerializer cookieSerializer(@Value("${mentor.security.production:false}") boolean production) {
        DefaultCookieSerializer cookies = new DefaultCookieSerializer();
        cookies.setCookieName("SESSION"); cookies.setCookiePath("/"); cookies.setUseHttpOnlyCookie(true);
        cookies.setSameSite("Lax"); cookies.setUseSecureCookie(production); return cookies;
    }
    @Bean @ConditionalOnWebApplication SecurityFilterChain security(HttpSecurity http,SessionPolicy sessions,AuthRateLimiter limits,
            ApiExceptionHandler errors,CsrfTokenRepository csrf,@Value("${mentor.security.production:false}") boolean production,
            @Value("${mentor.security.public-origin:}") String origin) throws Exception {
        var filter = new IdentityRequestFilter(sessions,limits,errors,production,origin);
        var handler = new CsrfTokenRequestAttributeHandler(); // Header is the token provided explicitly by /auth/session.
        return http.securityContext(context -> context.securityContextRepository(new RequestAttributeSecurityContextRepository()))
            .requestCache(cache -> cache.disable())
            .csrf(config -> config.csrfTokenRepository(csrf).csrfTokenRequestHandler(handler))
            .formLogin(config -> config.disable()).httpBasic(config -> config.disable()).logout(config -> config.disable())
            .authorizeHttpRequests(auth -> auth.requestMatchers("/api/v1/auth/session","/api/v1/auth/login","/api/v1/auth/logout","/api/v1/auth/register","/api/v1/auth/reset-password","/actuator/health","/actuator/health/**").permitAll().anyRequest().authenticated())
            .exceptionHandling(config -> config.authenticationEntryPoint((request,response,failure) -> errors.write(request,response,ApiFailure.unauthorized()))
                .accessDeniedHandler((request,response,failure) -> errors.write(request,response,new ApiFailure(403,"FORBIDDEN","Request forbidden."))))
            .addFilterBefore(filter,CsrfFilter.class).build();
    }
}
