package ru.mentor.platform.support;

import java.io.IOException;
import java.nio.file.*;
import java.util.Comparator;
import java.util.List;

/** A throwaway local object store for one HTTP test class: set before the Spring context starts, cleared after it stops. */
public final class IsolatedBlobRuntime {
    private static final List<String> KEYS=List.of("mentor.blobs.type","mentor.blobs.local-root","mentor.blobs.spool-root","mentor.blobs.cleanup-enabled","spring.servlet.multipart.location");
    private IsolatedBlobRuntime(){}
    public static Path create(String prefix){
        try {
            Path root=Files.createTempDirectory(prefix);
            System.setProperty("mentor.blobs.type","local");
            System.setProperty("mentor.blobs.local-root",root.resolve("objects").toString());
            System.setProperty("mentor.blobs.spool-root",root.resolve("spool").toString());
            System.setProperty("mentor.blobs.cleanup-enabled","false");
            System.setProperty("spring.servlet.multipart.location",Files.createDirectory(root.resolve("multipart")).toString());
            return root;
        } catch(IOException failure){throw new ExceptionInInitializerError(failure);}
    }
    public static void cleanup(Path root)throws IOException {
        for(String key:KEYS)System.clearProperty(key);
        if(root==null||!Files.exists(root))return;
        try(var paths=Files.walk(root)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
    }
}
