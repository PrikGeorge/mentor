package ru.mentor.platform.files;

import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;
import java.util.HexFormat;

final class BlobIO {
    private BlobIO() {}
    static String key(String key) {
        if(key==null||!key.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))
            throw new IllegalArgumentException("Invalid object identifier.");
        return key;
    }
    static void privateDirectory(Path directory)throws IOException {
        Path absolute=directory.toAbsolutePath().normalize(),part=absolute.getRoot();
        for(Path name:absolute) {
            part=part.resolve(name);
            if(Files.exists(part,LinkOption.NOFOLLOW_LINKS)) {
                if(Files.isSymbolicLink(part)||!Files.isDirectory(part,LinkOption.NOFOLLOW_LINKS))throw new IOException("Unsafe storage directory.");
            } else {
                try {Files.createDirectory(part,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));}
                catch(UnsupportedOperationException windows){Files.createDirectory(part);}
                catch(FileAlreadyExistsException concurrent){if(Files.isSymbolicLink(part)||!Files.isDirectory(part,LinkOption.NOFOLLOW_LINKS))throw new IOException("Unsafe storage directory.");}
            }
        }
    }
    static BlobStore.StagedBlob copy(String key,InputStream input,OutputStream output,long maximum)throws IOException {
        if(maximum<0)throw new IllegalArgumentException("Invalid byte limit.");
        MessageDigest hash;
        try {hash=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        long count=0;byte[] buffer=new byte[16384];int read;
        while((read=input.read(buffer))!=-1) {
            if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Upload cancelled.");
            if(read>maximum-count)throw new IOException("Object exceeds byte limit.");
            output.write(buffer,0,read);hash.update(buffer,0,read);count+=read;
        }
        if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Upload cancelled.");
        return new BlobStore.StagedBlob(key,count,HexFormat.of().formatHex(hash.digest()));
    }
}
