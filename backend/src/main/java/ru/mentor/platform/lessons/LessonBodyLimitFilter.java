package ru.mentor.platform.lessons;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import ru.mentor.platform.shared.ApiFailure;

import java.io.*;
import java.nio.charset.StandardCharsets;

/** Bound every text PUT regardless of media type; after security, before any MVC converter. Other uploads stay streaming. */
@Component
@ConditionalOnWebApplication
@Order(0)
public class LessonBodyLimitFilter extends OncePerRequestFilter {
    static final int MAXIMUM = 4 * 1024 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest r) {
        return !r.getMethod().equals("PUT")
                || !r.getRequestURI()
                        .matches(
                                "/api/v1/workspaces/[^/]+/students/[^/]+/lessons/[^/]+/texts/[^/]+");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest r, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (r.getContentLengthLong() > MAXIMUM) throw oversized();
        byte[] body = r.getInputStream().readNBytes(MAXIMUM + 1);
        if (body.length > MAXIMUM) throw oversized();
        chain.doFilter(
                new HttpServletRequestWrapper(r) {
                    final ByteArrayInputStream bytes = new ByteArrayInputStream(body);
                    final ServletInputStream stream =
                            new ServletInputStream() {
                                public int read() {
                                    return bytes.read();
                                }

                                public int read(byte[] b, int offset, int length) {
                                    return bytes.read(b, offset, length);
                                }

                                public boolean isFinished() {
                                    return bytes.available() == 0;
                                }

                                public boolean isReady() {
                                    return true;
                                }

                                public void setReadListener(ReadListener listener) {
                                    throw new IllegalStateException("Async reading unsupported.");
                                }
                            };

                    public ServletInputStream getInputStream() {
                        return stream;
                    }

                    public BufferedReader getReader() {
                        return new BufferedReader(
                                new InputStreamReader(stream, StandardCharsets.UTF_8));
                    }
                },
                response);
    }

    private static ApiFailure oversized() {
        return new ApiFailure(413, "INVALID_INPUT", "Request body too large.");
    }
}
