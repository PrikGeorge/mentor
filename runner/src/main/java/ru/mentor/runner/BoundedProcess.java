package ru.mentor.runner;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Arguments are passed directly to the OS. Never invokes a shell. */
public final class BoundedProcess {
    public record ProcessResult(int exitCode, String stdout, String stderr, String reason) {
        public boolean successful() { return exitCode == 0 && reason == null; }
    }
    public ProcessResult run(List<String> command, Path directory, byte[] input, Duration timeout, int outputLimit) throws IOException, InterruptedException {
        if(timeout.isNegative() || timeout.isZero() || outputLimit < 1) throw new IllegalArgumentException("Invalid process bounds");
        ProcessBuilder builder=new ProcessBuilder(List.copyOf(command));
        if(directory!=null) builder.directory(directory.toFile());
        Process process=builder.start();
        AtomicInteger bytes=new AtomicInteger();
        AtomicReference<String> reason=new AtomicReference<>();
        ByteArrayOutputStream stdout=new ByteArrayOutputStream(), stderr=new ByteArrayOutputStream();
        try(var threads=Executors.newVirtualThreadPerTaskExecutor()) {
            var out=threads.submit(()->capture(process.getInputStream(),stdout,process,bytes,outputLimit,reason));
            var err=threads.submit(()->capture(process.getErrorStream(),stderr,process,bytes,outputLimit,reason));
            var writer=threads.submit(()->{ try(var stream=process.getOutputStream()) { if(input!=null) stream.write(input); } catch(IOException ignored) {} });
            try {
                if(!process.waitFor(Math.max(1,timeout.toMillis()),TimeUnit.MILLISECONDS)) { reason.compareAndSet(null,"timeout"); kill(process); }
                process.waitFor();
                // Closing on a killed process also unblocks a writer whose stdin was never consumed.
                writer.get(2,TimeUnit.SECONDS); out.get(2,TimeUnit.SECONDS); err.get(2,TimeUnit.SECONDS);
            } catch(ExecutionException|TimeoutException failure) { reason.compareAndSet(null,"io_error"); kill(process); }
            catch(InterruptedException interrupted) { kill(process); throw interrupted; }
            finally { if(process.isAlive()) kill(process); }
        }
        return new ProcessResult(process.exitValue(),stdout.toString(StandardCharsets.UTF_8),stderr.toString(StandardCharsets.UTF_8),reason.get());
    }
    private static void capture(InputStream input, ByteArrayOutputStream output, Process process, AtomicInteger count, int maximum, AtomicReference<String> reason) {
        byte[] buffer=new byte[4096];
        try(input) {
            int size;
            while((size=input.read(buffer))!=-1) {
                int before=count.getAndAdd(size);
                int retained=Math.max(0,Math.min(size,maximum-before));
                if(retained>0) output.write(buffer,0,retained);
                if(before+size>maximum) { reason.compareAndSet(null,"output_limit"); kill(process); break; }
            }
        } catch(IOException ignored) {}
    }
    private static void kill(Process process) {
        process.descendants().forEach(child->{ try { child.destroyForcibly(); } catch(Exception ignored) {} });
        process.destroyForcibly();
        try { process.getOutputStream().close(); } catch(IOException ignored) {}
    }
}
