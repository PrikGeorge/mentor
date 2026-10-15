package ru.mentor.platform.files;

import java.io.*;
import java.nio.file.*;

public class LocalBlobStore implements BlobStore {
    private final Path root;

    public LocalBlobStore(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    private Path path(String key) throws IOException {
        BlobIO.key(key);
        BlobIO.privateDirectory(root);
        return root.resolve(key);
    }

    public StagedBlob stage(String key, InputStream input, long max) throws IOException {
        Path destination = path(key);
        // Direct exclusive creation: unlinking an abandoned writer cannot later publish a renamed
        // object.
        try (var output =
                Files.newOutputStream(
                        destination,
                        StandardOpenOption.CREATE_NEW,
                        StandardOpenOption.WRITE,
                        LinkOption.NOFOLLOW_LINKS)) {
            return BlobIO.copy(key, input, output, max);
        }
    }

    public InputStream open(String key) throws IOException {
        Path file = path(key);
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
            throw new FileNotFoundException("Object unavailable.");
        return Files.newInputStream(file, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
    }

    public void delete(String key) throws IOException {
        Files.deleteIfExists(path(key));
    }
}
