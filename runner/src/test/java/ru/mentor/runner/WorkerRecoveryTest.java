package ru.mentor.runner;

import org.junit.jupiter.api.Test;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.time.OffsetDateTime;
import static org.junit.jupiter.api.Assertions.*;
import static ru.mentor.runner.RunnerFixtures.*;

class WorkerRecoveryTest {
    @Test void expiredDeadlineCannotExecuteOrManufactureCompletion() throws Exception {
        try(var executor=new ContainerExecutor(prepare(),"recovery-test")) {
            var job=lease(prepare(),"list-task",LIST).deadlineAt(OffsetDateTime.now().minusSeconds(1));
            assertEquals("time_limit",status(executor.execute(job)));
        }
    }
    @Test void leaseLossStopsContainerAndNeverCompletesThenRedeliverySucceeds() throws Exception {
        var manifest=prepare();
        var first=lease(manifest,"list-task",listCode("Thread.sleep(1100); return source.stream().filter(n -> n >= minimum).sorted().toList();"));
        var second=lease(manifest,"list-task",LIST).jobId(first.getJobId()).attemptId(first.getAttemptId()).leaseToken("replacement-lease");
        AtomicInteger claims=new AtomicInteger(), completions=new AtomicInteger(), heartbeats=new AtomicInteger();
        AtomicBoolean runningAtLeaseLoss=new AtomicBoolean();
        AtomicReference<String> token=new AtomicReference<>("synthetic-worker-secret-one");
        Path credential=Files.createTempFile("worker-credential-",".txt"); Files.writeString(credential,token.get());
        HttpServer service=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        service.createContext("/internal/v1/jobs/",exchange->{
            try {
                if(!("Bearer "+token.get()).equals(exchange.getRequestHeaders().getFirst("Authorization"))) { exchange.sendResponseHeaders(401,-1); return; }
                var body=JSON.readTree(exchange.getRequestBody());
                String path=exchange.getRequestURI().getPath();
                if(path.endsWith("/claim")) {
                    int count=claims.getAndIncrement();
                    if(count>1) { exchange.sendResponseHeaders(204,-1); return; }
                    byte[] response=JSON.writeValueAsBytes(count==0?first:second); exchange.sendResponseHeaders(200,response.length); exchange.getResponseBody().write(response);
                } else if(path.endsWith("/heartbeat")) {
                    int heartbeat=heartbeats.incrementAndGet();
                    boolean loss=body.path("leaseToken").asText().equals("synthetic-lease") && heartbeat>1;
                    if(loss) {
                        try { runningAtLeaseLoss.set(!docker("ps","-q","--filter","label=ru.mentor.runner.worker=lease-test").trim().isEmpty()); }
                        catch(Exception failure) { throw new java.io.IOException(failure); }
                    }
                    exchange.sendResponseHeaders(loss?409:204,-1);
                } else {
                    assertEquals("replacement-lease",body.path("leaseToken").asText());
                    assertEquals("accepted",body.path("result").path("status").asText()); completions.incrementAndGet(); exchange.sendResponseHeaders(204,-1);
                }
            } finally { exchange.close(); }
        });
        service.start();
        try(var worker=new RunnerApplication(new JobClient(URI.create("http://127.0.0.1:"+service.getAddress().getPort()+"/internal/v1/"),credential,"lease-test"),new ContainerExecutor(manifest,"lease-test"))) {
            assertTrue(worker.runOnce()); assertEquals(0,completions.get());
            assertTrue(heartbeats.get()>0);
            assertTrue(runningAtLeaseLoss.get(),"Lease must be lost during actual container execution");
            token.set("synthetic-worker-secret-two"); Files.writeString(credential,token.get());
            assertTrue(worker.runOnce()); assertEquals(1,completions.get()); assertFalse(worker.runOnce());
            assertEquals("",docker("ps","-aq","--filter","label=ru.mentor.runner.worker=lease-test").trim());
        } finally { service.stop(0); Files.deleteIfExists(credential); }
    }
    @Test void workerCrashLeavesAnIndependentContainerDeadlineAndStartupCleansAbandonedContainers() throws Exception {
        var manifest=prepare(); var job=lease(manifest,"list-task",listCode("while(true) {}"));
        job.deadlineAt(OffsetDateTime.now().plusSeconds(12));
        AtomicInteger claims=new AtomicInteger(), completed=new AtomicInteger();
        Path directory=Files.createTempDirectory("worker-crash-test-");
        Path credential=Files.writeString(directory.resolve("credential"),"synthetic-worker-crash-secret");
        Path environments=directory.resolve("manifest.json"); JSON.writeValue(environments.toFile(),manifest);
        HttpServer service=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        service.createContext("/internal/v1/jobs/",exchange->{
            try {
                exchange.getRequestBody().readAllBytes();
                if(exchange.getRequestURI().getPath().endsWith("/claim") && claims.getAndIncrement()==0) { byte[] bytes=JSON.writeValueAsBytes(job); exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes); }
                else { if(exchange.getRequestURI().getPath().endsWith("/complete")) completed.incrementAndGet(); exchange.sendResponseHeaders(204,-1); }
            } finally { exchange.close(); }
        });
        service.start();
        Process process=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-cp",System.getProperty("java.class.path"),"ru.mentor.runner.RunnerApplication","--service","http://127.0.0.1:"+service.getAddress().getPort()+"/internal/v1/","--credential",credential.toString(),"--manifest",environments.toString(),"--worker","crash-test").redirectErrorStream(true).redirectOutput(directory.resolve("worker.log").toFile()).start();
        try {
            long until=System.currentTimeMillis()+7000; String running="";
            while(System.currentTimeMillis()<until && process.isAlive()) { running=docker("ps","-q","--filter","label=ru.mentor.runner.worker=crash-test").trim(); if(!running.isEmpty()) break; Thread.sleep(100); }
            assertFalse(running.isEmpty(),"Worker must create a real container before crash: "+Files.readString(directory.resolve("worker.log")));
            process.destroyForcibly(); process.waitFor(5,TimeUnit.SECONDS);
            until=System.currentTimeMillis()+15000;
            while(System.currentTimeMillis()<until && !docker("ps","-q","--filter","label=ru.mentor.runner.worker=crash-test").trim().isEmpty()) Thread.sleep(200);
            assertEquals("",docker("ps","-aq","--filter","label=ru.mentor.runner.worker=crash-test").trim()); assertEquals(0,completed.get());
            String image=manifest.environments().get("java21").imageDigest();
            String stale=docker("run","-d","--rm","--network","none","--label","ru.mentor.runner=true","--label","ru.mentor.runner.worker=crash-test","--label","ru.mentor.runner.expires=1",image,Long.toString(System.currentTimeMillis()+90000)).trim();
            assertFalse(stale.isEmpty());
            try(var executor=new ContainerExecutor(manifest,"crash-test")) { executor.cleanupExpired(); }
            assertEquals("",docker("ps","-aq","--filter","label=ru.mentor.runner.worker=crash-test").trim());
        } finally { process.destroyForcibly(); service.stop(0); EnvironmentBuilder.deleteTree(directory); }
    }
    static String docker(String... args) throws Exception {
        List<String> command=new ArrayList<>(List.of("docker")); command.addAll(List.of(args));
        var process=new BoundedProcess().run(command,null,null,java.time.Duration.ofSeconds(10),256*1024);
        assertTrue(process.successful(),process.stderr()+" "+process.reason());
        return process.stdout();
    }
}
