package ru.mentor.platform.files;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.support.IdentityHttpTest;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.students.*;
import ru.mentor.platform.lessons.LessonService;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import java.io.*;
import java.nio.file.Path;
import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class BlobLifecycleTest extends IdentityHttpTest {
    @TempDir Path temporary;
    BlobService blobs;BlobStore storage;BlobRepository repository;TransactionTemplate transaction;Actor actor;StudentRef owner;User teacherAccount;
    @BeforeEach void setupBlob()throws Exception {
        var teacher=teacher("blob-teacher");teacherAccount=teacher;var student=student(teacher,"Synthetic blob owner");
        actor=json.convertValue(session(teacher.client()).get("account"),Actor.class);
        owner=context.getBean(StudentService.class).requireReader(actor,teacher.workspace(),student.get("id").asText());
        repository=context.getBean(BlobRepository.class);storage=new LocalBlobStore(temporary.resolve("objects"));
        var manager=context.getBean(PlatformTransactionManager.class);transaction=new TransactionTemplate(manager);
        blobs=new BlobService(repository,storage,context.getBean(StudentService.class),context.getBean(LessonService.class),context.getBean(WorkspaceAccess.class),manager,CLOCK,BlobPolicy.defaults());
    }
    @Test void failedAttach()throws Exception {
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,3L);
        assertNotNull(staged,"A completed reserved upload must be available for transactional attachment");
        assertThrows(RuntimeException.class,()->transaction.execute(status->{var attached=blobs.attach(actor,owner,staged,"source.txt","text/plain");assertNotNull(attached);jdbc.update("UPDATE stored_blob SET size=-1 WHERE id=?",attached.id());return null;}));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        assertEquals("STAGED",jdbc.queryForObject("SELECT state FROM blob_reservation WHERE object_key=?",String.class,staged.key()));
        CLOCK.advance(Duration.ofMinutes(10));assertEquals(1,blobs.cleanExpired(20));assertThrows(IOException.class,()->storage.open(staged.key()));
    }
    @AfterEach void closeUploads(){if(blobs!=null)blobs.close();}
    @Test void measuredSizeAndOwnershipCannotBeForged()throws Exception {
        assertThrows(IOException.class,()->blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,4L));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,null);assertNotNull(staged);
        assertThrows(RuntimeException.class,()->transaction.execute(s->blobs.attach(actor,owner,new BlobStore.StagedBlob(staged.key(),9,staged.sha256()),"x.txt","text/plain")));
        var ref=transaction.execute(s->blobs.attach(actor,owner,staged,"x.txt","text/plain"));assertNotNull(ref);
        assertEquals(ref,transaction.execute(s->blobs.attach(actor,owner,staged,"x.txt","text/plain")));
        assertThrows(RuntimeException.class,()->transaction.execute(s->blobs.attach(actor,owner,staged,"changed.txt","text/plain")));
        CLOCK.advance(Duration.ofMinutes(10));blobs.cleanExpired(20);
        try(var read=storage.open(staged.key())){assertEquals("abc",new String(read.readAllBytes()));}
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
    }
    @Test void cleanupRetainsTombstoneForLateWriterAndFencesRenewal()throws Exception {
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,null);assertNotNull(staged);
        var reserved=transaction.execute(s->repository.lockForAttach(staged.key()).orElseThrow());
        assertEquals(0,blobs.cleanExpired(20));
        CLOCK.advance(Duration.ofSeconds(121));assertEquals(1,blobs.cleanExpired(20));
        assertEquals("DELETING",jdbc.queryForObject("SELECT state FROM blob_reservation WHERE object_key=?",String.class,staged.key()));
        assertFalse(repository.renew(reserved.id(),reserved.leaseToken(),CLOCK.instant(),CLOCK.instant().plusSeconds(60)));
        storage.stage(staged.key(),new ByteArrayInputStream("late".getBytes()),4);
        CLOCK.advance(Duration.ofMinutes(10));assertEquals(1,blobs.cleanExpired(20));
        assertThrows(IOException.class,()->storage.open(staged.key()));
        assertEquals("DELETED",jdbc.queryForObject("SELECT state FROM blob_reservation WHERE object_key=?",String.class,staged.key()));
    }
    @Test void deleteFailureStaysClaimedAndRetriesWithoutDeletingAttached()throws Exception {
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,null);
        BlobStore delegate=storage;AtomicBoolean fail=new AtomicBoolean(true);
        BlobStore unreliable=new BlobStore(){public StagedBlob stage(String key,InputStream input,long max)throws IOException{return delegate.stage(key,input,max);}public InputStream open(String key)throws IOException{return delegate.open(key);}public void delete(String key)throws IOException{if(fail.getAndSet(false))throw new IOException("synthetic delete failure");delegate.delete(key);}};
        try(var cleaner=service(unreliable,BlobPolicy.defaults())){
            CLOCK.advance(Duration.ofMinutes(10));assertThrows(IOException.class,()->cleaner.cleanExpired(20));
            assertEquals("DELETING",jdbc.queryForObject("SELECT state FROM blob_reservation WHERE object_key=?",String.class,staged.key()));
            try(var read=storage.open(staged.key())){assertEquals(3,read.readAllBytes().length);}
            CLOCK.advance(Duration.ofSeconds(61));assertEquals(1,cleaner.cleanExpired(20));assertThrows(IOException.class,()->storage.open(staged.key()));
        }
    }
    @Test void uploadLeaseRenewsWhileBlockedAndLossStopsTheWriter()throws Exception {
        var policy=new BlobPolicy(Duration.ofMinutes(5),Duration.ofSeconds(60),Duration.ofMillis(40),Duration.ofSeconds(60),Duration.ofSeconds(60),Duration.ofSeconds(30));
        CountDownLatch reading=new CountDownLatch(1),release=new CountDownLatch(1);AtomicBoolean closed=new AtomicBoolean();
        InputStream source=new InputStream(){public int read()throws IOException{reading.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException("cancelled");}return -1;}public void close(){closed.set(true);release.countDown();}};
        try(var uploader=service(storage,policy);var pool=Executors.newVirtualThreadPerTaskExecutor()){
            var future=pool.submit(()->uploader.stage(actor,owner,source,10,null));assertTrue(reading.await(5,TimeUnit.SECONDS));
            var reserved=jdbc.query("SELECT * FROM blob_reservation",(r,n)->new String[]{r.getString("id"),r.getString("lease_token"),r.getTimestamp("lease_until").toInstant().toString()}).get(0);
            Instant original=Instant.parse(reserved[2]);CLOCK.advance(Duration.ofSeconds(30));
            // The renewal the writer's lease thread issues, driven here by the controlled clock instead of a wall-clock wait: it moves the lease, capped by the lifetime.
            Instant now=CLOCK.instant();assertTrue(repository.renew(reserved[0],reserved[1],now,now.plus(policy.lease())));
            Instant renewed=jdbc.queryForObject("SELECT lease_until FROM blob_reservation",java.sql.Timestamp.class).toInstant();
            // PostgreSQL keeps microseconds (rounded), so the stored lease may differ from the computed one by less than a millisecond.
            assertTrue(renewed.isAfter(original));assertTrue(Duration.between(now.plus(policy.lease()),renewed).abs().compareTo(Duration.ofMillis(1))<0);assertEquals(0,uploader.cleanExpired(20));
            // Past the lifetime no renewal succeeds, and the blocked writer is stopped by its own lease thread.
            CLOCK.advance(Duration.ofMinutes(6));Instant late=CLOCK.instant();assertFalse(repository.renew(reserved[0],reserved[1],late,late.plus(policy.lease())));
            assertThrows(ExecutionException.class,()->future.get(5,TimeUnit.SECONDS));assertTrue(closed.get());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));assertEquals(1,uploader.cleanExpired(20));
        }finally{release.countDown();}
    }
    @Test void concurrentAttachAndCleanupPreserveTheCommittedObject()throws Exception {
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),10,null);CountDownLatch locked=new CountDownLatch(1),commit=new CountDownLatch(1);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()){
            var attach=pool.submit(()->transaction.execute(status->{var ref=blobs.attach(actor,owner,staged,"race.txt","text/plain");locked.countDown();try{commit.await();}catch(InterruptedException e){throw new RuntimeException(e);}return ref;}));
            assertTrue(locked.await(5,TimeUnit.SECONDS));CLOCK.advance(Duration.ofMinutes(10));
            assertEquals(0,blobs.cleanExpired(20));commit.countDown();assertNotNull(attach.get(5,TimeUnit.SECONDS));
            assertEquals(0,blobs.cleanExpired(20));try(var input=storage.open(staged.key())){assertEquals("abc",new String(input.readAllBytes()));}
        }finally{commit.countDown();}
    }
    @Test void actualS3ObjectUsesTheSameDurableReservationAndCrashCleanup()throws Exception {
        BlobStoreContractTest.S3.start();
        try(var remote=BlobStoreContractTest.remote(temporary);var service=service(remote,BlobPolicy.defaults())){
            var staged=service.stage(actor,owner,new ByteArrayInputStream("abc".getBytes()),3,3L);
            assertThrows(RuntimeException.class,()->transaction.execute(status->{var ref=service.attach(actor,owner,staged,"x.txt","text/plain");jdbc.update("UPDATE stored_blob SET size=-1 WHERE id=?",ref.id());return null;}));
            CLOCK.advance(Duration.ofMinutes(10));assertEquals(1,service.cleanExpired(20));assertThrows(IOException.class,()->remote.open(staged.key()));
            var kept=service.stage(actor,owner,new ByteArrayInputStream("kept".getBytes()),4,4L);var attached=transaction.execute(status->service.attach(actor,owner,kept,"k.txt","text/plain"));assertNotNull(attached);
            CLOCK.advance(Duration.ofMinutes(10));assertEquals(0,service.cleanExpired(20));try(var input=remote.open(kept.key())){assertEquals("kept",new String(input.readAllBytes()));}remote.delete(kept.key());
        }finally{BlobStoreContractTest.S3.stop();}
    }
    private BlobService service(BlobStore store,BlobPolicy policy){return new BlobService(repository,store,context.getBean(StudentService.class),context.getBean(LessonService.class),context.getBean(WorkspaceAccess.class),context.getBean(PlatformTransactionManager.class),CLOCK,policy);}
    @Test void studentAttachmentRevalidatesOwnCardAndPausedAccount()throws Exception {
        var learner=enroll(teacherAccount,owner.id(),"blob-student");Actor studentActor=json.convertValue(session(learner.client()).get("account"),Actor.class);
        String other=student(teacherAccount,"Other student").get("id").asText();
        assertThrows(RuntimeException.class,()->blobs.stage(studentActor,new StudentRef(owner.workspaceId(),other,null),new ByteArrayInputStream(new byte[0]),0,0L));
        var staged=blobs.stage(studentActor,owner,new ByteArrayInputStream(new byte[0]),0,0L);
        var attached=transaction.execute(status->blobs.attach(studentActor,owner,staged,"empty.txt","text/plain"));assertNotNull(attached);assertEquals(0,attached.size());
        var pending=blobs.stage(studentActor,owner,new ByteArrayInputStream("pending".getBytes()),7,7L);
        assertEquals(204,write(teacherAccount.client(),"PATCH",card(teacherAccount,owner.id())+"/access",java.util.Map.of("disabled",true)).statusCode());
        assertThrows(RuntimeException.class,()->transaction.execute(status->blobs.attach(studentActor,owner,pending,"pending.txt","text/plain")));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        CLOCK.advance(Duration.ofMinutes(10));blobs.cleanExpired(20);assertThrows(IOException.class,()->storage.open(pending.key()));
        try(var input=storage.open(staged.key())){assertEquals(0,input.readAllBytes().length);}
    }
}
