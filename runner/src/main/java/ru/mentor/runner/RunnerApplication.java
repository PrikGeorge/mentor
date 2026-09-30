package ru.mentor.runner;

import java.net.URI;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import ru.mentor.runner.protocol.*;

public final class RunnerApplication implements AutoCloseable {
    private final JobClient jobs;
    private final ContainerExecutor executor;
    private final ExecutorService execution=Executors.newSingleThreadExecutor();
    private final AtomicBoolean closed=new AtomicBoolean();
    public RunnerApplication(JobClient jobs, ContainerExecutor executor) {
        this.jobs=jobs; this.executor=executor; executor.cleanupExpired();
    }
    public boolean runOnce() throws Exception {
        if(closed.get()) return false;
        var claimed=jobs.claim(); if(claimed.isEmpty()) return false;
        JobLease lease=claimed.get();
        if(lease.getLeaseExpiresAt()==null || lease.getDeadlineAt()==null || !lease.getLeaseExpiresAt().toInstant().isAfter(Instant.now()) || !lease.getDeadlineAt().toInstant().isAfter(Instant.now())) return true;
        Future<CheckResult> work=null;
        try {
            // Revalidate ownership before creating any sandbox, and again immediately before completion.
            jobs.heartbeat(lease);
            work=execution.submit(()->executor.execute(lease));
            while(!closed.get()) {
                long remaining=lease.getDeadlineAt().toInstant().toEpochMilli()-System.currentTimeMillis();
                if(remaining<=0) throw new JobClient.LeaseLostException();
                try {
                    CheckResult result=work.get(Math.min(5000,remaining),TimeUnit.MILLISECONDS);
                    jobs.heartbeat(lease);
                    if(!closed.get()) jobs.complete(lease,result);
                    return true;
                } catch(TimeoutException waiting) { jobs.heartbeat(lease); }
            }
        } catch(Exception lostOrUncertain) {
            // Any failed heartbeat makes ownership uncertain. Never publish a replacement result.
            executor.cancel();
            if(lostOrUncertain instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally { if(work!=null && !work.isDone()) { work.cancel(true); executor.cancel(); } }
        return true;
    }
    public void close() { closed.set(true); executor.cancel(); execution.shutdownNow(); }
    public static void main(String[] args) throws Exception {
        Map<String,String> options=new HashMap<>();
        for(int index=0;index<args.length;index+=2) { if(index+1>=args.length || !args[index].startsWith("--")) throw new IllegalArgumentException("Expected named arguments"); options.put(args[index],args[index+1]); }
        if(options.containsKey("--prepare")) {
            var manifest=new EnvironmentBuilder().prepare(Path.of(options.get("--prepare")),Path.of(required(options,"--cache")));
            Json.MAPPER.writerWithDefaultPrettyPrinter().writeValue(Path.of(required(options,"--manifest")).toFile(),manifest);
            return;
        }
        String worker=required(options,"--worker");
        var manifest=Json.MAPPER.readValue(Path.of(required(options,"--manifest")).toFile(),EnvironmentBuilder.EnvironmentManifest.class);
        try(var app=new RunnerApplication(new JobClient(URI.create(required(options,"--service")),Path.of(required(options,"--credential")),worker),new ContainerExecutor(manifest,worker))) {
            Runtime.getRuntime().addShutdownHook(new Thread(app::close));
            while(!Thread.currentThread().isInterrupted() && !app.closed.get()) {
                try { if(!app.runOnce()) Thread.sleep(1000); }
                catch(InterruptedException stopped) { Thread.currentThread().interrupt(); }
                catch(Exception unavailable) { System.err.println("Worker service temporarily unavailable; retrying."); Thread.sleep(1000); }
            }
        }
    }
    private static String required(Map<String,String> options,String name) { return Objects.requireNonNull(options.get(name),"Missing "+name); }
}
