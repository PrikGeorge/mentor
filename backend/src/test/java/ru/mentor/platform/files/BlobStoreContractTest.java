package ru.mentor.platform.files;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.BindMode;
import com.github.dockerjava.api.model.Volume;
import org.testcontainers.containers.wait.strategy.Wait;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import java.io.*;
import java.nio.file.*;
import java.net.URI;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class BlobStoreContractTest {
    static final String IMAGE="adobe/s3mock:5.2.3@sha256:ab01a6946750f451ca215a47e91030695b260e4003b8a5a6201d25029b8fca92";
    static final GenericContainer<?> S3=new GenericContainer<>(IMAGE).withExposedPorts(9090)
        .withEnv("COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS","synthetic")
        .withEnv("COM_ADOBE_TESTING_S3MOCK_STORE_ROOT","/s3mockroot")
        .withEnv("COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT","true")
        .withCreateContainerCmdModifier(command->command.withVolumes(new Volume("/s3mockroot")))
        .waitingFor(Wait.forHttp("/favicon.ico").forPort(9090).forStatusCode(200));
    @TempDir Path temporary;
    @BeforeAll static void start(){S3.start();}
    @AfterAll static void stop(){S3.stop();}
    private BlobStore store(boolean remote)throws Exception {
        if(!remote)return new LocalBlobStore(temporary.resolve("local"));
        return remote(temporary);
    }
    static BlobStore remote(Path temporary)throws Exception {
        var client=S3Client.builder().endpointOverride(URI.create("http://"+S3.getHost()+":"+S3.getMappedPort(9090)))
            .region(Region.US_EAST_1).credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("synthetic","synthetic")))
            .forcePathStyle(true).httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(10)))
            .overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(30)).apiCallAttemptTimeout(Duration.ofSeconds(15))).build();
        return new S3BlobStore(client,"synthetic",temporary.resolve("spool"));
    }
    @Test void unkeyedInterruptedStreamDoesNotLeaveUndiscoverableObject()throws Exception {
        Path root=temporary.resolve("unkeyed");var store=new LocalBlobStore(root);
        assertThrows(IOException.class,()->store.stage(new InputStream(){int reads;public int read()throws IOException{if(reads++==0)return 65;throw new IOException("synthetic disconnect");}},10));
        try(var objects=Files.list(root)){assertEquals(0,objects.count(),"Unkeyed caller cannot clean an object whose identifier was never returned");}
    }
    @Test void reservationDeletionAlsoCleansTheS3SpoolAfterProcessLoss()throws Exception {
        String key=UUID.randomUUID().toString();CountDownLatch reading=new CountDownLatch(1),finish=new CountDownLatch(1);
        try(var store=remote(temporary);var pool=Executors.newVirtualThreadPerTaskExecutor()){
            var staged=pool.submit(()->store.stage(key,new InputStream(){public int read()throws IOException{reading.countDown();try{finish.await();}catch(InterruptedException e){throw new IOException(e);}return -1;}},10));
            assertTrue(reading.await(5,TimeUnit.SECONDS));Path localCopy;
            try(var files=Files.list(temporary.resolve("spool"))){localCopy=files.findFirst().orElseThrow();}
            finish.countDown();assertEquals(0,staged.get(10,TimeUnit.SECONDS).size());
            // Restore the observed on-disk spool file as if the process died before its finally cleanup.
            Files.writeString(localCopy,"synthetic orphan source");store.delete(key);
            assertFalse(Files.exists(localCopy),"Reservation cleanup must cover the private local spool as well as S3 bytes");
        }finally{finish.countDown();}
    }
    @Test void nativeLinuxSymlinksAreNeverReadable()throws Exception {
        try(var linux=new GenericContainer<>("eclipse-temurin:21-jdk-jammy@sha256:6adefddd4a20bceef702cedb0b03952fcd7691f9c7ccffe27014992abc0b46bd")
            .withFileSystemBind(Path.of("target/classes").toAbsolutePath().toString(),"/classes",BindMode.READ_ONLY)
            .withFileSystemBind(Path.of("target/test-classes").toAbsolutePath().toString(),"/tests",BindMode.READ_ONLY).withCommand("sleep","60")) {
            linux.start();var result=linux.execInContainer("java","-cp","/classes:/tests","ru.mentor.platform.files.LocalBlobNativeProbe");assertEquals(0,result.getExitCode(),result.getStdout()+result.getStderr());assertTrue(result.getStdout().contains("PASS native Linux"));
        }
    }
    @ParameterizedTest @ValueSource(booleans={false,true})
    void roundTripMeasuredContentAndBoundedFailures(boolean remote)throws Exception {
        try(var store=store(remote)) {
            if(remote){assertEquals("1000:1000",S3.getContainerInfo().getConfig().getUser());assertTrue(S3.getContainerInfo().getMounts().stream().anyMatch(m->"/s3mockroot".equals(m.getDestination().getPath())&&Boolean.TRUE.equals(m.getRW())));}
            var staged=store.stage(new ByteArrayInputStream("abc".getBytes()),3);
            assertNotNull(staged,"Staging must return a measured completed object");
            assertEquals(3,staged.size());assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",staged.sha256());
            try(var read=store.open(staged.key())){assertArrayEquals("abc".getBytes(),read.readAllBytes());}
            store.delete(staged.key());store.delete(staged.key());assertThrows(IOException.class,()->store.open(staged.key()));
            String overflow=UUID.randomUUID().toString();
            assertThrows(IOException.class,()->store.stage(overflow,new ByteArrayInputStream(new byte[4]),3));
            store.delete(overflow);assertThrows(IOException.class,()->store.open(overflow));
            String broken=UUID.randomUUID().toString();
            assertThrows(IOException.class,()->store.stage(broken,new InputStream(){public int read()throws IOException{throw new IOException("synthetic disconnect");}},10));
            store.delete(broken);assertThrows(IOException.class,()->store.open(broken));
            var empty=store.stage(new ByteArrayInputStream(new byte[0]),0);assertEquals(0,empty.size());store.delete(empty.key());
            assertThrows(IllegalArgumentException.class,()->store.open("../outside"));
        }
    }
}
