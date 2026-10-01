package ru.mentor.platform.practice;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.shared.ApiFailure;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.scheduling.annotation.*;
@Service
@EnableScheduling
public class JobQueue {
    /** Private operational aggregate, intentionally has no public HTTP route or payload identifiers. */
    public record Diagnostics(int waiting,int running,int retryPending,int configuredSlots,Instant lastWorkerSeenAt){}
    private final AttemptRepository repository;private final Clock clock;private final TransactionTemplate transaction;private final int waiting,slots;
    public JobQueue(AttemptRepository repository,Clock clock,PlatformTransactionManager manager,@Value("${mentor.runner.waiting-capacity:4}") int waiting,@Value("${mentor.runner.slots:1}") int slots){if(waiting<1||slots<1||waiting>1024||slots>128)throw new IllegalArgumentException("Invalid queue capacity.");this.repository=repository;this.clock=clock;this.transaction=new TransactionTemplate(manager);this.waiting=waiting;this.slots=slots;}
    @Transactional(propagation=Propagation.MANDATORY) public void admit(){repository.capacityLock();if(repository.waiting()>=waiting)throw new ApiFailure(429,"QUEUE_FULL","Practice queue is full. Retry later.");}
    public Optional<JobLease> claim(String workerId){if(workerId==null||workerId.isEmpty()||workerId.length()>100||!SourceFiles.wellFormed(workerId)||workerId.chars().anyMatch(Character::isISOControl))throw new IllegalArgumentException("Invalid worker ID.");
        return transaction.execute(status->{repository.capacityLock();Instant now=now();reconcile(now);repository.workerSeen(now);var next=repository.next("retry_pending");if(next.isEmpty()){if(repository.reserved()>=slots)return Optional.empty();next=repository.next("queued");}if(next.isEmpty())return Optional.empty();var job=next.get();String token=UUID.randomUUID().toString()+UUID.randomUUID();Instant deadline=now.plusSeconds(90),expiry=now.plusSeconds(30);repository.grant(job,workerId,hash(token),expiry,deadline);return Optional.of(new JobLease(job.id(),job.attempt(),token,expiry,deadline,job.payload()));});
    }
    public void heartbeat(String jobId,String leaseToken){boolean owned=Boolean.TRUE.equals(transaction.execute(status->{repository.capacityLock();Instant now=now();reconcile(now);var job=repository.job(jobId);if(job.isEmpty()||!owned(job.get(),leaseToken,now))return false;repository.workerSeen(now);repository.renew(job.get(),now.plusSeconds(30).isAfter(job.get().deadline())?job.get().deadline():now.plusSeconds(30));return true;}));if(!owned)throw stale();}
    public void complete(String jobId,String leaseToken,CheckResult result){
        var failure=transaction.execute(status->{repository.capacityLock();Instant now=now();reconcile(now);var maybe=repository.job(jobId);if(maybe.isEmpty())return stale();var job=maybe.get();String tokenHash=hash(leaseToken);var receipt=repository.receipt(jobId,tokenHash);
            if(receipt.isEmpty()&&!owned(job,leaseToken,now))return stale();result.validate(job.payload());String resultHash=hash(AttemptRepository.encode(canonical(result.value())));
            if(receipt.isPresent()){if(!receipt.get().equals(resultHash))return stale();repository.workerSeen(now);return null;}repository.receipt(job,tokenHash,resultHash,now);repository.finish(job,result);repository.workerSeen(now);return (ApiFailure)null;});if(failure!=null)throw failure;
    }
    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(fixedDelayString="${mentor.runner.reconcile-interval-ms:5000}",initialDelayString="${mentor.runner.reconcile-interval-ms:5000}")
    public void recover(){transaction.executeWithoutResult(status->{repository.capacityLock();reconcile(now());});}
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ) public Diagnostics diagnostics(){return new Diagnostics(repository.waiting(),repository.stateCount("running"),repository.stateCount("retry_pending"),slots,repository.lastWorkerSeen());}
    private void reconcile(Instant now){for(var job:repository.expired(now))repository.finish(job,CheckResult.unavailable());}
    private boolean owned(AttemptRepository.Job job,String token,Instant now){return token!=null&&job.state().equals("running")&&hash(token).equals(job.tokenHash())&&now.isBefore(job.lease())&&now.isBefore(job.deadline());}
    private Instant now(){return clock.instant().truncatedTo(ChronoUnit.MICROS);}
    static String hash(String input){if(input==null)throw new IllegalArgumentException("Lease token required.");return CatalogSource.sha(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    private static tools.jackson.databind.JsonNode canonical(tools.jackson.databind.JsonNode n){if(n.isObject()){var out=PracticeJson.MAPPER.createObjectNode();new TreeSet<>(n.propertyNames()).forEach(k->out.set(k,canonical(n.get(k))));return out;}if(n.isArray()){var out=PracticeJson.MAPPER.createArrayNode();for(var child:n)out.add(canonical(child));return out;}if(n.isNumber())return PracticeJson.MAPPER.valueToTree(n.decimalValue().stripTrailingZeros());return n;}
    private static ApiFailure stale(){return new ApiFailure(409,"LEASE_LOST","Worker lease is no longer owned.");}
}
