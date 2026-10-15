package ru.mentor.platform.shared;

public class ApiFailure extends RuntimeException {
    private final int status;
    private final String code;
    private final Integer retryAfter;

    public ApiFailure(int status, String code, String message) {
        this(status, code, message, null);
    }

    public ApiFailure(int status, String code, String message, Integer retryAfter) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Integer retryAfter() {
        return retryAfter;
    }

    public static ApiFailure unauthorized() {
        return new ApiFailure(401, "UNAUTHORIZED", "Authentication required.");
    }
}
