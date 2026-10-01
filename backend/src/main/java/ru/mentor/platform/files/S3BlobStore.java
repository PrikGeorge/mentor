package ru.mentor.platform.files;
import java.io.*;
import java.nio.file.*;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.exception.SdkException;
public class S3BlobStore implements BlobStore {
    private final S3Client client;private final String bucket;private final Path spool;
    public S3BlobStore(S3Client client,String bucket,Path spool) {this.client=client;this.bucket=bucket;this.spool=spool;}
    public StagedBlob stage(String key,InputStream input,long max)throws IOException {
        BlobIO.key(key);BlobIO.privateDirectory(spool);Path file=spool.resolve(key+".part");boolean created=false;
        try {
            StagedBlob staged;
            try(var output=Files.newOutputStream(file,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)){created=true;staged=BlobIO.copy(key,input,output,max);}
            if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Upload cancelled.");
            client.putObject(r->r.bucket(bucket).key(key).ifNoneMatch("*"),RequestBody.fromFile(file));
            return staged;
        } catch(SdkException failed){throw new IOException("Object write unavailable.",failed);}
        finally {if(created)Files.deleteIfExists(file);}
    }
    public InputStream open(String key)throws IOException {
        BlobIO.key(key);
        try{return client.getObject(r->r.bucket(bucket).key(key));}
        catch(SdkException failed){throw new IOException("Object unavailable.",failed);}
    }
    public void delete(String key)throws IOException {
        BlobIO.key(key);
        try{client.deleteObject(r->r.bucket(bucket).key(key));BlobIO.privateDirectory(spool);Files.deleteIfExists(spool.resolve(key+".part"));}
        catch(SdkException failed){throw new IOException("Object deletion unavailable.",failed);}
    }
    public void close(){client.close();}
}
