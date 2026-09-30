package ru.mentor.runner;

import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import ru.mentor.runner.protocol.*;

public final class JobClient {
    public static final class LeaseLostException extends Exception { LeaseLostException() { super("Job lease is no longer owned by this worker"); } }
    private final URI base;
    private final Path credential;
    private final String workerId;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    public JobClient(URI base, Path credential, String workerId) {
        if(base.getHost()==null || base.getUserInfo()!=null || base.getQuery()!=null || base.getFragment()!=null || !("https".equals(base.getScheme()) || "http".equals(base.getScheme()) && Set.of("127.0.0.1","localhost","[::1]").contains(base.getHost()))) throw new IllegalArgumentException("Worker service requires TLS (loopback HTTP is for tests)");
        if(!workerId.matches("[a-zA-Z0-9_-]{1,100}")) throw new IllegalArgumentException("Invalid worker ID");
        this.base=URI.create(base.toString().replaceAll("/+$","")+"/"); this.credential=credential; this.workerId=workerId;
    }
    public Optional<JobLease> claim() throws Exception {
        var response=post("jobs/claim",new ClaimRequest().workerId(workerId));
        if(response.statusCode()==204) return Optional.empty();
        if(response.statusCode()!=200) throw new IllegalStateException("Job service rejected claim: "+response.statusCode());
        return Optional.of(Json.MAPPER.readValue(response.body(),JobLease.class));
    }
    public void heartbeat(JobLease lease) throws Exception { expectNoContent(post("jobs/"+id(lease)+"/heartbeat",new LeaseRequest().leaseToken(lease.getLeaseToken()))); }
    public void complete(JobLease lease, CheckResult result) throws Exception {
        if(Json.MAPPER.writeValueAsString(result).length()>32000 || result.getTotal()==null || result.getPassed()==null || result.getTotal()<0 || result.getPassed()<0 || result.getPassed()>result.getTotal() || result.getStatus()==CheckResult.StatusEnum.ACCEPTED && (result.getTotal()==0 || !result.getTotal().equals(result.getPassed()))) throw new IllegalArgumentException("Invalid completion");
        expectNoContent(post("jobs/"+id(lease)+"/complete",new CompleteRequest().leaseToken(lease.getLeaseToken()).result(result)));
    }
    private static String id(JobLease lease) { if(lease.getJobId()==null || !lease.getJobId().matches("[a-zA-Z0-9_-]{1,100}")) throw new IllegalArgumentException("Invalid job ID"); return lease.getJobId(); }
    private void expectNoContent(HttpResponse<byte[]> response) throws Exception {
        if(response.statusCode()==409 || response.statusCode()==401 || response.statusCode()==403) throw new LeaseLostException();
        if(response.statusCode()!=204) throw new IllegalStateException("Job service failed: "+response.statusCode());
    }
    private HttpResponse<byte[]> post(String path,Object body) throws Exception {
        // Reload on every request, allowing the operator to rotate the file without restarting.
        String token=Files.readString(credential).strip();
        if(!token.matches("[\\x21-\\x7e]{16,4096}")) throw new IllegalArgumentException("Invalid worker credential file");
        var request=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(5)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(Json.MAPPER.writeValueAsBytes(body))).build();
        // HttpRequest.timeout stops guarding once headers arrive on JDK 21. Bound the
        // complete body future as well, otherwise a stalled peer can outlive the lease.
        var response=http.sendAsync(request,ignored->new LimitedBody(4*1024*1024));
        try { return response.get(5,TimeUnit.SECONDS); }
        catch(TimeoutException|InterruptedException failure) { response.cancel(true); throw failure; }
    }
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final int maximum;
        private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> body=new CompletableFuture<>();
        private Flow.Subscription subscription;
        LimitedBody(int maximum) { this.maximum=maximum; }
        public CompletionStage<byte[]> getBody() { return body; }
        public void onSubscribe(Flow.Subscription subscription) { this.subscription=subscription; subscription.request(1); }
        public void onNext(List<ByteBuffer> chunks) {
            for(ByteBuffer chunk:chunks) {
                if(chunk.remaining()>maximum-bytes.size()) { subscription.cancel(); body.completeExceptionally(new IllegalArgumentException("Job response exceeds limit")); return; }
                byte[] copied=new byte[chunk.remaining()]; chunk.get(copied); bytes.writeBytes(copied);
            }
            subscription.request(1);
        }
        public void onError(Throwable error) { body.completeExceptionally(error); }
        public void onComplete() { body.complete(bytes.toByteArray()); }
    }
}
