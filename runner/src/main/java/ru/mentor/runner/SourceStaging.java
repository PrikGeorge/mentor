package ru.mentor.runner;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;

/** Owns one attempt's already-validated sources and their host-private lifetime. */
final class SourceStaging implements AutoCloseable {
    private final Path parent;
    private SourceStaging(Path parent) { this.parent=parent; }
    Path input() { return parent.resolve("input"); }

    static SourceStaging create(Map<String,String> files) throws IOException {
        var staged=new SourceStaging(Files.createTempDirectory("mentor-runner-input-"));
        try {
            boolean posix=Files.getFileAttributeView(staged.parent,PosixFileAttributeView.class)!=null;
            if(posix) Files.setPosixFilePermissions(staged.parent,PosixFilePermissions.fromString("rwx------"));
            Path sources=Files.createDirectories(staged.input().resolve("src"));
            for(var entry:files.entrySet()) {
                Path file=sources.resolve(entry.getKey());
                Files.createDirectories(file.getParent());
                Files.writeString(file,entry.getValue());
            }
            // Docker mounts only this child. The 0700 parent still blocks unrelated host users;
            // explicit child modes let fixed UID 10001 read every package under any host umask.
            if(posix) try(var paths=Files.walk(staged.input())) {
                for(Path path:paths.toList()) Files.setPosixFilePermissions(path,
                    PosixFilePermissions.fromString(Files.isDirectory(path)?"rwxr-xr-x":"rw-r--r--"));
            }
            return staged;
        } catch(IOException | RuntimeException failure) {
            try { staged.close(); } catch(IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }

    @Override public void close() throws IOException {
        try(var paths=Files.walk(parent)) {
            for(Path path:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }
}
