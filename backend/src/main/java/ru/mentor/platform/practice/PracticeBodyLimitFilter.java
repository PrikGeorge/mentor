package ru.mentor.platform.practice;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.filter.OncePerRequestFilter;
import ru.mentor.platform.shared.ApiFailure;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Security runs first. Bound all accepted media on code routes; leave text and multipart streaming policies separate. */
@Component @ConditionalOnWebApplication @Order(0)
public class PracticeBodyLimitFilter extends OncePerRequestFilter {
    public static final int MAXIMUM=1605632;
    @Override protected boolean shouldNotFilter(HttpServletRequest r){
        String route="/api/v1/workspaces/[^/]+/students/[^/]+/lessons/[^/]+/practice/exercises/[^/]+/";
        return !(r.getMethod().equals("PUT")&&r.getRequestURI().matches(route+"draft")||r.getMethod().equals("POST")&&r.getRequestURI().matches(route+"attempts"));
    }
    @Override protected void doFilterInternal(HttpServletRequest r,HttpServletResponse response,FilterChain chain)throws IOException,ServletException {
        if(r.getContentLengthLong()>MAXIMUM)throw oversized();byte[] body=r.getInputStream().readNBytes(MAXIMUM+1);if(body.length>MAXIMUM)throw oversized();
        chain.doFilter(new HttpServletRequestWrapper(r){
            final ByteArrayInputStream bytes=new ByteArrayInputStream(body);
            final ServletInputStream stream=new ServletInputStream(){public int read(){return bytes.read();}public int read(byte[] b,int offset,int length){return bytes.read(b,offset,length);}public boolean isFinished(){return bytes.available()==0;}public boolean isReady(){return true;}public void setReadListener(ReadListener listener){throw new IllegalStateException("Async reading unsupported.");}};
            public ServletInputStream getInputStream(){return stream;}
            public BufferedReader getReader(){return new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8));}
        },response);
    }
    private static ApiFailure oversized(){return new ApiFailure(413,"INVALID_INPUT","Request body too large.");}
}
