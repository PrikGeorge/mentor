package ru.mentor.platform.identity;

import jakarta.annotation.PreDestroy;

import org.springframework.security.crypto.scrypt.SCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import ru.mentor.platform.shared.ApiFailure;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.*;
import java.util.function.Supplier;

@Component
public class PasswordCodec implements AutoCloseable {
    private static final String PREFIX = "{scrypt-mentor-v1}";
    private static final String PARAMETERS = "$110801$";
    private final SCryptPasswordEncoder encoder = new SCryptPasswordEncoder(131072, 8, 1, 64, 16);
    private final ThreadPoolExecutor kdf =
            new ThreadPoolExecutor(
                    2,
                    2,
                    0L,
                    TimeUnit.MILLISECONDS,
                    new ArrayBlockingQueue<>(8),
                    runnable -> {
                        Thread thread = new Thread(runnable, "mentor-password-kdf");
                        thread.setDaemon(true);
                        return thread;
                    },
                    new ThreadPoolExecutor.AbortPolicy());

    public String encode(String password) {
        validate(password);
        return derive(() -> PREFIX + encoder.encode(password));
    }

    public boolean matches(String password, String encoded) {
        if (!valid(password)) return false;
        if (!validEncoded(encoded))
            throw new ApiFailure(503, "AUTH_UNAVAILABLE", "Password verification unavailable.");
        return derive(() -> encoder.matches(password, encoded.substring(PREFIX.length())));
    }

    public String importLegacy(LegacyPasswordHash hash) {
        if (hash == null
                || !"scrypt".equals(hash.algorithm())
                || hash.N() != 131072
                || hash.r() != 8
                || hash.p() != 1
                || !canonicalBase64(hash.saltBase64(), 16)
                || !canonicalBase64(hash.hashBase64(), 64)) {
            throw new IllegalArgumentException("Invalid legacy password hash.");
        }
        return PREFIX + PARAMETERS + hash.saltBase64() + "$" + hash.hashBase64();
    }

    public static void validate(String password) {
        if (!valid(password))
            throw new IllegalArgumentException(
                    "Password must contain 8–128 Unicode characters and at most 512 UTF-8 bytes.");
    }

    private static boolean valid(String password) {
        if (password == null || password.length() > 256) return false;
        for (int i = 0; i < password.length(); i++) {
            char c = password.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= password.length() || !Character.isLowSurrogate(password.charAt(i)))
                    return false;
            } else if (Character.isLowSurrogate(c)) return false;
        }
        int characters = password.codePointCount(0, password.length());
        return characters >= 8
                && characters <= 128
                && password.getBytes(StandardCharsets.UTF_8).length <= 512;
    }

    private static boolean validEncoded(String encoded) {
        if (encoded == null || !encoded.startsWith(PREFIX + PARAMETERS)) return false;
        String[] parts = encoded.substring(PREFIX.length()).split("\\$", -1);
        return parts.length == 4 && canonicalBase64(parts[2], 16) && canonicalBase64(parts[3], 64);
    }

    private static boolean canonicalBase64(String input, int length) {
        if (input == null || input.length() != 4 * ((length + 2) / 3)) return false;
        try {
            byte[] bytes = Base64.getDecoder().decode(input);
            return bytes.length == length
                    && Base64.getEncoder().encodeToString(bytes).equals(input);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private <T> T derive(Supplier<T> work) {
        Future<T> future;
        try {
            future = kdf.submit(work::get);
        } catch (RejectedExecutionException failure) {
            if (kdf.isShutdown())
                throw new ApiFailure(503, "AUTH_UNAVAILABLE", "Password verification unavailable.");
            throw new ApiFailure(429, "AUTH_BUSY", "Password service busy. Try again later.", 1);
        }
        try {
            return future.get();
        } catch (InterruptedException failure) {
            future.cancel(true);
            kdf.remove((Runnable) future);
            Thread.currentThread().interrupt();
            throw new ApiFailure(503, "AUTH_UNAVAILABLE", "Password verification unavailable.");
        } catch (ExecutionException | CancellationException failure) {
            throw new ApiFailure(503, "AUTH_UNAVAILABLE", "Password verification unavailable.");
        }
    }

    @Override
    @PreDestroy
    public void close() {
        for (Runnable pending : kdf.shutdownNow())
            if (pending instanceof Future<?> future) future.cancel(false);
    }
}
