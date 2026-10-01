package ru.mentor.platform.files;

import org.springframework.context.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.core.env.Environment;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import java.nio.file.*;
import java.net.URI;
import java.time.Duration;

@Configuration(proxyBeanMethods=false)
public class BlobConfiguration {
    @Bean BlobPolicy blobPolicy(Environment e){return new BlobPolicy(Duration.ofSeconds(e.getProperty("mentor.blobs.lifetime-seconds",Long.class,300L)),Duration.ofSeconds(e.getProperty("mentor.blobs.lease-seconds",Long.class,60L)),Duration.ofSeconds(e.getProperty("mentor.blobs.renew-seconds",Long.class,15L)),Duration.ofSeconds(e.getProperty("mentor.blobs.grace-seconds",Long.class,60L)),Duration.ofSeconds(e.getProperty("mentor.blobs.delete-lease-seconds",Long.class,60L)),Duration.ofSeconds(30));}
    @Bean @ConditionalOnMissingBean(BlobStore.class) BlobStore blobStore(Environment e)throws Exception {
        String type=e.getProperty("mentor.blobs.type","local");
        if(type.equals("local"))return new LocalBlobStore(Path.of(e.getProperty("mentor.blobs.local-root",".runtime/private-blobs")));
        if(!type.equals("s3"))throw new IllegalArgumentException("Unknown blob adapter.");
        String access=Files.readString(Path.of(e.getRequiredProperty("mentor.blobs.s3.access-key-file"))).strip();
        String secret=Files.readString(Path.of(e.getRequiredProperty("mentor.blobs.s3.secret-key-file"))).strip();
        var builder=S3Client.builder().region(Region.of(e.getProperty("mentor.blobs.s3.region","us-east-1")))
            .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret)))
            .forcePathStyle(true).httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(15)))
            .overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(30)).apiCallAttemptTimeout(Duration.ofSeconds(15)));
        String endpoint=e.getProperty("mentor.blobs.s3.endpoint");
        if(endpoint!=null){URI uri=URI.create(endpoint);if(uri.getUserInfo()!=null||!java.util.Set.of("http","https").contains(uri.getScheme())||(e.getProperty("mentor.security.production",Boolean.class,false)&&!uri.getScheme().equals("https")))throw new IllegalArgumentException("Invalid S3 endpoint.");builder.endpointOverride(uri);}
        return new S3BlobStore(builder.build(),e.getRequiredProperty("mentor.blobs.s3.bucket"),Path.of(e.getProperty("mentor.blobs.spool-root",".runtime/blob-spool")));
    }
}
