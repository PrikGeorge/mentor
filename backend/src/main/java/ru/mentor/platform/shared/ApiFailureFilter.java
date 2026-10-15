package ru.mentor.platform.shared;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.UUID;

/** The JDBC session filter can fail before MVC/security can produce the API error contract; the request id travels in MDC for the logs. */
@Component
@Order(SessionRepositoryFilter.DEFAULT_ORDER - 1)
public class ApiFailureFilter extends OncePerRequestFilter {
    private final ApiExceptionHandler errors;
    public ApiFailureFilter(ApiExceptionHandler errors) { this.errors = errors; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) { return !request.getRequestURI().startsWith("/api/v1/"); }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        String id = UUID.randomUUID().toString(); request.setAttribute("mentor.requestId",id); response.setHeader("X-Request-ID",id);
        MDC.put("requestId",id);
        try { chain.doFilter(request,response); }
        catch(RuntimeException failure) { errors.write(request,response,ApiExceptionHandler.classify(request,failure)); }
        finally { MDC.remove("requestId"); }
    }
}
