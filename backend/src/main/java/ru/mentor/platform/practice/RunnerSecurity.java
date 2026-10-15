package ru.mentor.platform.practice;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.context.NullSecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

import ru.mentor.platform.shared.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Private job-only chain. Never authenticates an operator credential as a platform account. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication
public class RunnerSecurity {
    @Bean
    @Order(0)
    SecurityFilterChain runnerChain(
            HttpSecurity http, Environment environment, ApiExceptionHandler errors)
            throws Exception {
        return http.securityMatcher("/internal/v1/jobs/**")
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .securityContext(
                        s -> s.securityContextRepository(new NullSecurityContextRepository()))
                .requestCache(s -> s.disable())
                .csrf(s -> s.disable())
                .cors(s -> s.disable())
                .formLogin(s -> s.disable())
                .httpBasic(s -> s.disable())
                .logout(s -> s.disable())
                .authorizeHttpRequests(s -> s.anyRequest().authenticated())
                .exceptionHandling(
                        s ->
                                s.authenticationEntryPoint(
                                        (r, p, e) -> errors.write(r, p, ApiFailure.unauthorized())))
                .addFilterBefore(
                        new CredentialFilter(environment, errors),
                        AnonymousAuthenticationFilter.class)
                .build();
    }

    private static final class CredentialFilter extends OncePerRequestFilter {
        private final Environment environment;
        private final ApiExceptionHandler errors;

        CredentialFilter(Environment environment, ApiExceptionHandler errors) {
            this.environment = environment;
            this.errors = errors;
        }

        protected void doFilterInternal(
                HttpServletRequest r, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            response.setHeader("Cache-Control", "no-store");
            if (!valid(r)) {
                errors.write(r, response, ApiFailure.unauthorized());
                return;
            }
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(
                    new UsernamePasswordAuthenticationToken("runner", null, List.of()));
            SecurityContextHolder.setContext(context);
            chain.doFilter(r, response);
        }

        private boolean valid(HttpServletRequest r) {
            for (String name : Collections.list(r.getHeaderNames()))
                if (name.equalsIgnoreCase("Origin")
                        || name.toLowerCase(Locale.ROOT).startsWith("sec-fetch-")) return false;
            if (r.getCookies() != null)
                for (var cookie : r.getCookies())
                    if (cookie.getName().equals("SESSION")) return false;
            var authorization = Collections.list(r.getHeaders("Authorization"));
            if (authorization.size() != 1 || !authorization.get(0).startsWith("Bearer "))
                return false;
            String supplied = authorization.get(0).substring(7);
            if (!supplied.matches("[\\x21-\\x7e]{16,4096}")) return false;
            try {
                String file = environment.getProperty("mentor.runner.token-file");
                if (file == null || file.isBlank()) return false;
                String expected = Files.readString(Path.of(file)).strip();
                return expected.matches("[\\x21-\\x7e]{16,4096}")
                        && MessageDigest.isEqual(
                                expected.getBytes(StandardCharsets.US_ASCII),
                                supplied.getBytes(StandardCharsets.US_ASCII));
            } catch (Exception unavailable) {
                return false;
            }
        }
    }
}
