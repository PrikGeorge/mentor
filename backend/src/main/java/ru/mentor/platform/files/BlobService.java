package ru.mentor.platform.files;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.*;
import ru.mentor.platform.lessons.*;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.http.MediaType;
import jakarta.annotation.PreDestroy;
import ru.mentor.platform.migration.OfflineImportLease;
import java.util.function.*;

@Service
public class BlobService implements AutoCloseable {
    public record BlobRef(String id,long size,String sha256) {}
    private final BlobRepository repository;private final BlobStore store;private final StudentService students;private final LessonService lessons;private final WorkspaceAccess access;private final Clock clock;private final BlobPolicy policy;
    private final TransactionTemplate transaction,reservationTransaction;
    private final ExecutorService uploads=Executors.newVirtualThreadPerTaskExecutor();
    private final ScheduledExecutorService renewals=Executors.newScheduledThreadPool(2,r->{Thread t=new Thread(r,"blob-lease");t.setDaemon(true);return t;});
    public BlobService(BlobRepository repository,BlobStore store,StudentService students,LessonService lessons,WorkspaceAccess access,PlatformTransactionManager manager,Clock clock,BlobPolicy policy) {
        this.repository=repository;this.store=store;this.students=students;this.lessons=lessons;this.access=access;this.clock=clock;this.policy=policy;
        transaction=new TransactionTemplate(manager);transaction.setTimeout(10);
        reservationTransaction=new TransactionTemplate(manager);reservationTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);reservationTransaction.setTimeout(10);
    }
    public BlobStore.StagedBlob stage(Actor actor,StudentRef owner,InputStream input,long maximum,Long expected)throws IOException {return stage(actor,owner,null,input,maximum,expected);}
    public BlobStore.StagedBlob stage(Actor actor,LessonRef owner,InputStream input,long maximum,Long expected)throws IOException {
        lessons.requireReader(actor,owner.workspaceId(),owner.studentId(),owner.id());
        return stage(actor,students.requireReader(actor,owner.workspaceId(),owner.studentId()),owner.id(),input,maximum,expected);
    }
    private BlobStore.StagedBlob stage(Actor actor,StudentRef owner,String lesson,InputStream input,long maximum,Long expected)throws IOException {
        if(TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("Stage bytes before starting the domain attachment transaction.");
        if(input==null||maximum<0||(expected!=null&&(expected<0||expected>maximum)))throw new IllegalArgumentException("Invalid upload size.");
        var r=reservationTransaction.execute(status->{lockOwner(actor,owner,lesson);Instant now=clock.instant();return repository.reserve(UUID.randomUUID().toString(),UUID.randomUUID().toString(),owner.workspaceId(),owner.id(),lesson,actor.userId(),UUID.randomUUID().toString(),now,now.plus(policy.lease()),now.plus(policy.lifetime()),now.plus(policy.lifetime()).plus(policy.writeWindow()).plus(policy.grace()));});
        return streamReserved(r,input,maximum,expected,Supplier::get);
    }
    /** Called only by the non-web importer; an active/fabricated Actor is never used for historical ownership. */
    public BlobStore.StagedBlob stageForImport(OfflineImportLease lease,String student,String lesson,String sourcePath,InputStream input,long maximum,long expected)throws IOException {
        if(TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("Stage bytes outside the domain transaction.");
        if(input==null||expected<0||expected>maximum)throw new IllegalArgumentException("Invalid import size.");
        var r=lease.write(()->{lease.requireBinding(student,lesson);Instant now=clock.instant();var reserved=repository.reserve(UUID.randomUUID().toString(),UUID.randomUUID().toString(),lease.workspaceId(),student,lesson,lease.teacherId(),UUID.randomUUID().toString(),now,now.plus(policy.lease()),now.plus(policy.lifetime()),now.plus(policy.lifetime()).plus(policy.writeWindow()).plus(policy.grace()));lease.reservation(reserved.id(),sourcePath);return reserved;});
        return streamReserved(r,input,maximum,expected,operation->lease.write(operation));
    }
    private BlobStore.StagedBlob streamReserved(BlobRepository.Reservation r,InputStream input,long maximum,Long expected,Function<Supplier<Boolean>,Boolean> mutate)throws IOException {
        AtomicBoolean lost=new AtomicBoolean();AtomicReference<Future<?>> current=new AtomicReference<>();
        Runnable abort=()->{lost.set(true);var future=current.get();if(future!=null)future.cancel(true);try{input.close();}catch(IOException ignored){}};
        var renewal=renewals.scheduleAtFixedRate(()->{
            try {Instant now=clock.instant();if(!mutate.apply(()->repository.renew(r.id(),r.leaseToken(),now,now.plus(policy.lease()))))abort.run();}
            catch(RuntimeException unavailable){abort.run();}
        },policy.renewEvery().toMillis(),policy.renewEvery().toMillis(),TimeUnit.MILLISECONDS);
        InputStream guarded=new FilterInputStream(input){
            private void check()throws IOException {if(lost.get()||!clock.instant().isBefore(r.expiresAt())||Thread.currentThread().isInterrupted())throw new IOException("Upload lease ended.");}
            public int read()throws IOException {check();int b=in.read();check();return b;}
            public int read(byte[] b,int off,int len)throws IOException {check();int n=in.read(b,off,len);check();return n;}
        };
        Future<BlobStore.StagedBlob> future=uploads.submit(()->store.stage(r.key(),guarded,maximum));current.set(future);
        try {
            var staged=future.get(policy.lifetime().toMillis(),TimeUnit.MILLISECONDS);
            if(lost.get()||(expected!=null&&expected!=staged.size()))throw new IOException("Upload size or lease invalid.");
            Instant now=clock.instant();
            if(!mutate.apply(()->repository.markStaged(r.id(),r.leaseToken(),staged.size(),staged.sha256(),now,now.plus(policy.lease()))))throw new IOException("Upload lease ended.");
            return staged;
        } catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IOException("Upload interrupted.");}
        catch(TimeoutException|CancellationException timeout){throw new IOException("Upload deadline exceeded.");}
        catch(ExecutionException failure){if(failure.getCause() instanceof IOException io)throw io;throw new IOException("Upload failed.",failure.getCause());}
        finally {renewal.cancel(false);abort.run();}
    }
    @Transactional public BlobRef attach(Actor actor,StudentRef owner,BlobStore.StagedBlob staged,String filename,String type){return attach(actor,owner,null,staged,filename,type);}
    @Transactional public BlobRef attach(Actor actor,LessonRef owner,BlobStore.StagedBlob staged,String filename,String type){return attach(actor,students.requireReader(actor,owner.workspaceId(),owner.studentId()),owner.id(),staged,filename,type);}
    private BlobRef attach(Actor actor,StudentRef owner,String lesson,BlobStore.StagedBlob staged,String filename,String type){
        String safeName=filename(filename),safeType=contentType(type);
        if(staged==null)throw new IllegalArgumentException("Completed upload required.");BlobIO.key(staged.key());
        return transaction.execute(status->{
            lockOwner(actor,owner,lesson);return attachReserved(owner.workspaceId(),owner.id(),lesson,actor.userId(),staged,safeName,safeType,null,clock.instant(),null);
        });
    }
    public BlobRef attachForImport(OfflineImportLease lease,String student,String lesson,BlobStore.StagedBlob staged,String desiredId,Instant createdAt,String filename,String type){
        if(staged==null||desiredId==null||createdAt==null||filename==null||!java.nio.charset.StandardCharsets.UTF_8.newEncoder().canEncode(filename))throw new IllegalArgumentException("Invalid import attachment.");BlobIO.key(staged.key());
        String safeType=contentType(type);
        return transaction.execute(status->{lease.requireBinding(student,lesson);return attachReserved(lease.workspaceId(),student,lesson,lease.teacherId(),staged,filename,safeType,desiredId,createdAt,lease);});
    }
    private BlobRef attachReserved(String workspace,String student,String lesson,String uploader,BlobStore.StagedBlob staged,String safeName,String safeType,String desiredId,Instant createdAt,OfflineImportLease lease){
            var r=repository.lockForAttach(staged.key()).orElseThrow(WorkspaceAccess::missing);
            if(!r.workspaceId().equals(workspace)||!r.studentId().equals(student)||!Objects.equals(r.lessonId(),lesson)||!r.uploaderId().equals(uploader))throw WorkspaceAccess.missing();
            if(lease!=null)lease.requireReservation(r.id());
            if(!Objects.equals(r.size(),staged.size())||!Objects.equals(r.sha256(),staged.sha256()))throw conflict();
            if(r.state()==BlobRepository.State.ATTACHED){var existing=repository.stored(workspace,r.attachedBlobId()).orElseThrow(WorkspaceAccess::missing);if(!existing.filename().equals(safeName)||!existing.contentType().equals(safeType)||(desiredId!=null&&!desiredId.equals(existing.id())))throw conflict();return ref(existing);}
            if(r.state()!=BlobRepository.State.STAGED||!clock.instant().isBefore(r.leaseUntil()))throw conflict();
            String id=desiredId==null?UUID.randomUUID().toString():desiredId;repository.insert(r,id,safeName,safeType,createdAt);repository.markAttached(r.id(),id,clock.instant());return new BlobRef(id,r.size(),r.sha256());
    }
    private void lockOwner(Actor actor,StudentRef owner,String lesson){
        access.lockMember(actor,owner.workspaceId());students.lockCard(owner.workspaceId(),owner.id());students.requireReader(actor,owner.workspaceId(),owner.id());
        if(lesson!=null)lessons.requireReader(actor,owner.workspaceId(),owner.id(),lesson);
    }
    private BlobRepository.Stored readable(Actor actor,StudentRef owner,String lesson,String id){
        students.requireReader(actor,owner.workspaceId(),owner.id());if(lesson!=null)lessons.requireReader(actor,owner.workspaceId(),owner.id(),lesson);
        var found=repository.stored(owner.workspaceId(),id).orElseThrow(WorkspaceAccess::missing);
        if(!found.studentId().equals(owner.id())||!Objects.equals(found.lessonId(),lesson))throw WorkspaceAccess.missing();return found;
    }
    public BlobRef describe(Actor actor,StudentRef owner,String id){return ref(readable(actor,owner,null,id));}
    public BlobRef describe(Actor actor,LessonRef owner,String id){return ref(readable(actor,students.requireReader(actor,owner.workspaceId(),owner.studentId()),owner.id(),id));}
    public InputStream open(Actor actor,StudentRef owner,String id)throws IOException {return store.open(readable(actor,owner,null,id).key());}
    public InputStream open(Actor actor,LessonRef owner,String id)throws IOException {return store.open(readable(actor,students.requireReader(actor,owner.workspaceId(),owner.studentId()),owner.id(),id).key());}
    private static BlobRef ref(BlobRepository.Stored value){return new BlobRef(value.id(),value.size(),value.sha256());}
    public int cleanExpired(int maximum)throws IOException {
        if(maximum<1||maximum>1000)throw new IllegalArgumentException("Invalid cleanup batch.");
        var claims=reservationTransaction.execute(status->repository.claimExpiredForDelete(clock.instant(),maximum,policy.deleteLease(),policy.grace()));
        int deleted=0;IOException failed=null;
        for(var claim:claims)try{store.delete(claim.key());reservationTransaction.execute(status->repository.markDeleted(claim.reservationId(),claim.claimToken(),clock.instant()));deleted++;}
            catch(IOException error){if(failed==null)failed=new IOException("Object cleanup incomplete; reserved deletion will retry.");failed.addSuppressed(error);}
        if(failed!=null)throw failed;return deleted;
    }
    public static String filename(String value){
        if(value==null)throw new IllegalArgumentException("Filename required.");String clean=value.replaceAll("[\\p{Cntrl}\\\\/\"<>:|?*]","_").strip();
        if(clean.isEmpty()||clean.equals(".")||clean.equals(".."))clean="download";
        if(clean.length()>180)clean=clean.substring(0,Character.isHighSurrogate(clean.charAt(179))?179:180);
        if(!java.nio.charset.StandardCharsets.UTF_8.newEncoder().canEncode(clean))throw new IllegalArgumentException("Invalid filename.");return clean;
    }
    public static String contentType(String value){if(value==null||value.length()>200||value.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("Invalid media type.");return MediaType.parseMediaType(value).toString();}
    private static ApiFailure conflict(){return new ApiFailure(409,"BLOB_CONFLICT","Upload no longer attachable.");}
    @PreDestroy public void close(){renewals.shutdownNow();uploads.shutdownNow();}
}
