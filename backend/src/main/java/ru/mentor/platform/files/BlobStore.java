package ru.mentor.platform.files;

import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

public interface BlobStore extends AutoCloseable {
    record StagedBlob(String key, long size, String sha256) {}

    default StagedBlob stage(InputStream input, long maximumBytes) throws IOException {
        String key = UUID.randomUUID().toString();
        try {
            return stage(key, input, maximumBytes);
        } catch (IOException | RuntimeException failure) {
            try {
                delete(key);
            } catch (IOException cleanup) {
                failure.addSuppressed(cleanup);
            }
            throw failure;
        }
    }

    StagedBlob stage(String reservedKey, InputStream input, long maximumBytes) throws IOException;

    InputStream open(String key) throws IOException;

    void delete(String key) throws IOException;

    default void close() {}
}
