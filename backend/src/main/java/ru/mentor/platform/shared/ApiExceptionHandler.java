package ru.mentor.platform.shared;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.CannotCreateTransactionException;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;

@RestControllerAdvice
public class ApiExceptionHandler {
    private final ObjectMapper json;
    public ApiExceptionHandler(ObjectMapper json) { this.json = json; }
    @ExceptionHandler(ApiFailure.class)
    public void application(ApiFailure error, HttpServletRequest request, HttpServletResponse response) throws IOException {
        write(request,response,error);
    }
    @ExceptionHandler({IllegalArgumentException.class,HttpMessageNotReadableException.class})
    public void validation(Exception ignored,HttpServletRequest request,HttpServletResponse response) throws IOException {
        write(request,response,new ApiFailure(400,"INVALID_INPUT","Invalid request fields."));
    }
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public void contentType(Exception ignored,HttpServletRequest request,HttpServletResponse response) throws IOException {
        write(request,response,new ApiFailure(415,"INVALID_INPUT","Send application/json."));
    }
    @ExceptionHandler({NoResourceFoundException.class,HttpRequestMethodNotSupportedException.class})
    public void unavailable(Exception ignored,HttpServletRequest request,HttpServletResponse response) throws IOException {
        write(request,response,new ApiFailure(404,"NOT_FOUND","Resource unavailable."));
    }
    @ExceptionHandler(Exception.class)
    public void unexpected(Exception ignored,HttpServletRequest request,HttpServletResponse response) throws IOException {
        write(request,response,new ApiFailure(500,"INTERNAL_ERROR","Request could not be completed."));
    }
    @ExceptionHandler({DataAccessException.class,CannotCreateTransactionException.class})
    public void database(Exception ignored,HttpServletRequest request,HttpServletResponse response) throws IOException {
        write(request,response,new ApiFailure(503,"AUTH_UNAVAILABLE","Authentication storage unavailable."));
    }
    public void write(HttpServletRequest request,HttpServletResponse response,ApiFailure error) throws IOException {
        if(response.isCommitted()) return;
        response.resetBuffer();
        Object id = request.getAttribute("mentor.requestId");
        String requestId = id instanceof String value ? value : UUID.randomUUID().toString();
        response.setStatus(error.status()); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("X-Request-ID",requestId); response.setHeader("Cache-Control","no-store");
        if(error.retryAfter() != null) response.setHeader("Retry-After",error.retryAfter().toString());
        response.getWriter().write(json.writeValueAsString(new ApiProblem(error.status(),error.code(),error.getMessage(),Map.of(),requestId)));
    }
}
