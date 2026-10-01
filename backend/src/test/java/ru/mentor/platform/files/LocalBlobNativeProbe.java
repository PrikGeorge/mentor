package ru.mentor.platform.files;
import java.nio.file.*;
import java.io.*;
import java.util.*;
/** Invoked only by the Linux container contract test, using its native temporary filesystem. */
public final class LocalBlobNativeProbe {
    public static void main(String[] args)throws Exception {
        Path temp=Files.createTempDirectory("private-blob-probe"),root=temp.resolve("root"),outside=temp.resolve("outside");
        Files.createDirectories(root);Files.writeString(outside,"synthetic outside marker");String key=UUID.randomUUID().toString();
        Files.createSymbolicLink(root.resolve(key),outside);var store=new LocalBlobStore(root);
        denied(()->store.open(key));denied(()->store.open("../outside"));
        Path linked=temp.resolve("linked");Files.createSymbolicLink(linked,root);
        denied(()->new LocalBlobStore(linked).open(key));denied(()->new LocalBlobStore(linked.resolve("nested")).stage(new ByteArrayInputStream(new byte[1]),1));
        if(!Files.readString(outside).equals("synthetic outside marker"))throw new AssertionError("Outside file changed");
        System.out.println("PASS native Linux symlink object/root/component and traversal rejection");
        try(var paths=Files.walk(temp)){for(var path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
    }
    interface Operation {Object run()throws Exception;}
    static void denied(Operation operation)throws Exception {try{Object value=operation.run();if(value instanceof AutoCloseable close)close.close();throw new AssertionError("Unsafe path accepted");}catch(IOException|IllegalArgumentException expected){}}
}
