package ru.mentor.platform.identity;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import ru.mentor.platform.shared.*;
import java.io.IOException;
import java.net.URI;
import java.util.*;

final class IdentityRequestFilter extends OncePerRequestFilter {
    private final SessionPolicy sessions;
    private final AuthRateLimiter limits;
    private final ApiExceptionHandler errors;
    private final URI origin;
    IdentityRequestFilter(SessionPolicy sessions,AuthRateLimiter limits,ApiExceptionHandler errors,boolean production,String publicOrigin) {
        this.sessions = sessions; this.limits = limits; this.errors = errors;
        if(production && publicOrigin.isBlank()) throw new IllegalArgumentException("Production requires HTTPS public origin.");
        origin = publicOrigin.isBlank() ? null : URI.create(publicOrigin);
        if(origin != null && (origin.getHost()==null || origin.getUserInfo()!=null || origin.getQuery()!=null || origin.getFragment()!=null
            || (origin.getRawPath()!=null && !origin.getRawPath().isEmpty()) || !Set.of("http","https").contains(origin.getScheme())
            || (production && !origin.getScheme().equals("https")))) throw new IllegalArgumentException("Invalid public origin.");
    }
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
        if(request.getAttribute("mentor.requestId") == null) request.setAttribute("mentor.requestId",UUID.randomUUID().toString());
        try {
            checkOrigin(request);
            String path = request.getRequestURI();
            if(path.startsWith("/api/v1/auth/")) {
                response.setHeader("Cache-Control","no-store");
                limits.admit(path,request.getMethod(),request.getRemoteAddr());
            }
            Actor actor = sessions.current(request);
            if(actor != null) {
                SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor,null,List.of(new SimpleGrantedAuthority("ROLE_"+actor.role()))));
                if(writing(request) && !path.equals("/api/v1/auth/login") && !actor.userId().equals(request.getHeader("X-Mentor-Account")))
                    throw new ApiFailure(409,"ACCOUNT_CHANGED","Account changed. Refresh this tab.");
            }
            chain.doFilter(request,response);
        } catch(ApiFailure failure) { errors.write(request,response,failure); }
    }
    private void checkOrigin(HttpServletRequest request) {
        String host = request.getHeader("Host");
        String expected;
        if(origin != null) {
            if(!origin.getRawAuthority().equals(host)) forbidden();
            expected = origin.toString();
        } else {
            int port = request.getLocalPort();
            Set<String> hosts = port==80 ? Set.of("localhost","127.0.0.1","localhost:80","127.0.0.1:80") : Set.of("localhost:"+port,"127.0.0.1:"+port);
            if(!hosts.contains(host)) forbidden();
            expected = "http://"+host;
        }
        // Forwarded/X-Forwarded-* are deliberately never trusted; the edge must preserve the configured Host.
        if(writing(request)) {
            if(!expected.equals(request.getHeader("Origin")) || "cross-site".equals(request.getHeader("Sec-Fetch-Site")) || !"web".equals(request.getHeader("X-Mentor-Client"))) forbidden();
            String type = request.getContentType();
            if(request.getRequestURI().startsWith("/api/v1/auth/") && !request.getRequestURI().equals("/api/v1/auth/logout")
                && (type==null || !type.toLowerCase(Locale.ROOT).matches("application/json(?:\\s*;.*)?")))
                throw new ApiFailure(415,"INVALID_INPUT","Send application/json.");
        }
    }
    private static boolean writing(HttpServletRequest request) { return !Set.of("GET","HEAD","OPTIONS","TRACE").contains(request.getMethod()); }
    private static void forbidden() { throw new ApiFailure(403,"FORBIDDEN","Request forbidden."); }
}
