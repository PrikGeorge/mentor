package ru.mentor.platform.shared;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private final ObjectMapper json;

    public ApiExceptionHandler(ObjectMapper json) {
        this.json = json;
    }

    @ExceptionHandler(ApiFailure.class)
    public void application(
            ApiFailure error, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, error);
    }

    // A non-numeric page or size, or a missing required parameter, is the caller's input error, not
    // a server failure.
    @ExceptionHandler({
        IllegalArgumentException.class,
        HttpMessageNotReadableException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
        org.springframework.web.bind.MissingServletRequestParameterException.class
    })
    public void validation(
            Exception ignored, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, new ApiFailure(400, "INVALID_INPUT", "Invalid request fields."));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public void contentType(
            Exception ignored, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, new ApiFailure(415, "INVALID_INPUT", "Send application/json."));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public void uploadTooLarge(
            Exception ignored, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(
                request,
                response,
                new ApiFailure(413, "INVALID_INPUT", "Multipart upload exceeds its byte limit."));
    }

    @ExceptionHandler(MultipartException.class)
    public void multipart(
            Exception ignored, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(
                request,
                response,
                new ApiFailure(400, "INVALID_INPUT", "Invalid multipart request."));
    }

    @ExceptionHandler({
        NoResourceFoundException.class,
        HttpRequestMethodNotSupportedException.class
    })
    public void unavailable(
            Exception ignored, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, new ApiFailure(404, "NOT_FOUND", "Resource unavailable."));
    }

    @ExceptionHandler(Exception.class)
    public void unexpected(
            Exception failure, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, internalError(request, failure));
    }

    // A violated constraint is the caller's conflict with existing data; only an unreachable store
    // is a 503.
    @ExceptionHandler(DataIntegrityViolationException.class)
    public void integrity(
            DataIntegrityViolationException failure,
            HttpServletRequest request,
            HttpServletResponse response)
            throws IOException {
        write(request, response, conflict(request, failure));
    }

    @ExceptionHandler({DataAccessException.class, CannotCreateTransactionException.class})
    public void database(
            Exception failure, HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        write(request, response, storageUnavailable(request, failure));
    }

    public static ApiFailure classify(HttpServletRequest request, RuntimeException failure) {
        if (failure instanceof ApiFailure api) return api;
        if (failure instanceof DataIntegrityViolationException) return conflict(request, failure);
        if (failure instanceof DataAccessException
                || failure instanceof CannotCreateTransactionException)
            return storageUnavailable(request, failure);
        return internalError(request, failure);
    }

    private static ApiFailure conflict(HttpServletRequest request, Exception failure) {
        log.warn(
                "{} {} requestId={} rejected by a database constraint: {}",
                request.getMethod(),
                request.getRequestURI(),
                requestId(request),
                failure.getClass().getSimpleName());
        return new ApiFailure(409, "CONFLICT", "The change conflicts with existing data.");
    }

    private static ApiFailure storageUnavailable(HttpServletRequest request, Exception failure) {
        log.error(
                "{} {} requestId={} storage unavailable: {}: {}",
                request.getMethod(),
                request.getRequestURI(),
                requestId(request),
                failure.getClass().getSimpleName(),
                failure.getMessage());
        return new ApiFailure(503, "AUTH_UNAVAILABLE", "Authentication storage unavailable.");
    }

    private static ApiFailure internalError(HttpServletRequest request, Exception failure) {
        log.error(
                "{} {} requestId={} failed",
                request.getMethod(),
                request.getRequestURI(),
                requestId(request),
                failure);
        return new ApiFailure(500, "INTERNAL_ERROR", "Request could not be completed.");
    }

    private static String requestId(HttpServletRequest request) {
        Object id = request.getAttribute("mentor.requestId");
        return id instanceof String value ? value : "-";
    }

    public void write(HttpServletRequest request, HttpServletResponse response, ApiFailure error)
            throws IOException {
        if (response.isCommitted()) return;
        response.resetBuffer();
        Object id = request.getAttribute("mentor.requestId");
        String requestId = id instanceof String value ? value : UUID.randomUUID().toString();
        response.setStatus(error.status());
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("X-Request-ID", requestId);
        response.setHeader("Cache-Control", "no-store");
        if (error.retryAfter() != null)
            response.setHeader("Retry-After", error.retryAfter().toString());
        response.getWriter()
                .write(
                        json.writeValueAsString(
                                new ApiProblem(
                                        error.status(),
                                        error.code(),
                                        error.getMessage(),
                                        Map.of(),
                                        requestId)));
    }
}
