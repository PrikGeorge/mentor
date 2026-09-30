package ru.mentor.runner;

import ru.mentor.runner.protocol.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.security.SecureRandom;

public final class ContainerExecutor implements AutoCloseable {
    private static final List<String> FLAGS=List.of("--network","none","--user","10001:10001","--memory","512m","--memory-swap","512m","--cpus","1","--pids-limit","128","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--tmpfs","/work:rw,nosuid,nodev,noexec,size=96m,mode=1777","--tmpfs","/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777");
    private static final String LABEL="ru.mentor.runner";
    private final EnvironmentBuilder.EnvironmentManifest manifest;
    private final String workerId;
    private final BoundedProcess processes=new BoundedProcess();
    private final ResultVerifier verifier=new ResultVerifier();
    private final AtomicBoolean cancelled=new AtomicBoolean();
    private volatile String activeName;
    public ContainerExecutor(EnvironmentBuilder.EnvironmentManifest manifest, String workerId) {
        if(!workerId.matches("[a-zA-Z0-9_-]{1,100}")) throw new IllegalArgumentException("Invalid worker ID");
        this.manifest=manifest; this.workerId=workerId;
    }
    public synchronized CheckResult execute(JobLease supplied) {
        long started=System.currentTimeMillis();
        CheckResult result=new CheckResult(CheckResult.StatusEnum.ERROR,0,0,0L,new ArrayList<>());
        SourceStaging input=null; String container=null;
        cancelled.set(false);
        try {
            // Generated transport DTOs are mutable; execution owns a deep snapshot before its first side effect.
            JobLease lease=Json.MAPPER.readValue(Json.MAPPER.writeValueAsBytes(supplied),JobLease.class);
            long deadline=Math.min(lease.getDeadlineAt().toInstant().toEpochMilli(),started+90000);
            if(deadline<=started) return result.status(CheckResult.StatusEnum.TIME_LIMIT);
            JobPayload payload=lease.getPayload();
            validate(payload);
            var env=manifest.environments().get(payload.getEnvironment().getId());
            if(env==null || !env.revision().equals(payload.getEnvironment().getRevision()) || !env.imageDigest().equals(payload.getEnvironment().getImageDigest()) || !env.imageDigest().matches("sha256:[a-f0-9]{64}")) return result.status(CheckResult.StatusEnum.UNAVAILABLE).diagnostics("Окружение не подготовлено оператором.");
            input=SourceStaging.create(payload.getFiles());
            container="mentor-job-"+UUID.randomUUID(); activeName=container;
            List<String> command=new ArrayList<>(List.of("docker","run","-d","--rm","--pull","never","--name",container,"--label",LABEL+"=true","--label",LABEL+".worker="+workerId,"--label",LABEL+".expires="+deadline));
            command.addAll(FLAGS);
            command.addAll(List.of("--mount","type=bind,source="+input.input().toAbsolutePath()+",target=/input,readonly",env.imageDigest(),Long.toString(deadline)));
            var launched=processes.run(command,null,null,remaining(deadline,10000),65536);
            checkCancelled();
            if(!launched.successful()) return result.status(CheckResult.StatusEnum.UNAVAILABLE).diagnostics("Не удалось запустить контейнер проверки.");
            String classpath=env.dependencies().isEmpty()?"/work/classes":String.join(":",env.dependencies());
            List<String> compile=new ArrayList<>(List.of("javac","-J-Xmx256m","-J-XX:ActiveProcessorCount=1","-J-Dfile.encoding=UTF-8","-encoding","UTF-8","--release","21"));
            if(env.annotationProcessors().isEmpty()) compile.add("-proc:none");
            else compile.addAll(List.of("-processorpath",classpath,"-processor",String.join(",",env.annotationProcessors())));
            compile.addAll(List.of("-classpath",classpath,"-d","/work/classes"));
            for(String name:payload.getExercise().getSourceFiles()) compile.add("/input/src/"+name);
            var compiled=exec(container,compile,null,remaining(deadline,15000));
            checkCancelled();
            result.setTotal(payload.getExercise().getTests().size());
            if(!compiled.successful()) return result.status(CheckResult.StatusEnum.COMPILE_ERROR).diagnostics("timeout".equals(compiled.reason())?"Компиляция превысила 15 секунд.":"output_limit".equals(compiled.reason())?"Диагностика компилятора превысила допустимый объём.":ResultVerifier.sanitize(compiled.stderr()+compiled.stdout()));
            result.setStatus(CheckResult.StatusEnum.ACCEPTED);
            long testsDeadline=Math.min(deadline,System.currentTimeMillis()+10000);
            for(TestCase test:payload.getExercise().getTests()) {
                checkCancelled();
                if(System.currentTimeMillis()>=testsDeadline) { result.setStatus(CheckResult.StatusEnum.TIME_LIMIT); break; }
                byte[] random=new byte[32]; new SecureRandom().nextBytes(random); String nonce=HexFormat.of().formatHex(random);
                Map<String,Object> spec=new LinkedHashMap<>();
                spec.put("className",payload.getExercise().getClassName()); spec.put("method",payload.getExercise().getMethod()); spec.put("parameterTypes",payload.getExercise().getParameterTypes()); spec.put("customTypes",payload.getExercise().getCustomTypes()); spec.put("args",test.getArgs()); spec.put("nonce",nonce);
                List<String> paths=new ArrayList<>(List.of("/work/classes")); paths.addAll(env.dependencies()); spec.put("classPaths",paths);
                var execution=exec(container,List.of("java","-Xmx128m","-Xss512k","-XX:ActiveProcessorCount=1","-Dfile.encoding=UTF-8","-Dstdout.encoding=UTF-8","-Dstderr.encoding=UTF-8","-Djava.security.manager","-Djava.security.policy==/opt/mentor/runner.policy","-cp","/opt/mentor/trusted","mentor.runner.TrustedHarness"),Json.MAPPER.writeValueAsBytes(spec),remaining(testsDeadline,3000));
                checkCancelled();
                TestResult checked=verifier.verify(test,nonce,execution); result.getTests().add(checked);
                if(checked.getStatus()==TestResult.StatusEnum.ACCEPTED) result.setPassed(result.getPassed()+1);
                else if(result.getStatus()==CheckResult.StatusEnum.ACCEPTED || checked.getStatus()==TestResult.StatusEnum.RUNTIME_ERROR || checked.getStatus()==TestResult.StatusEnum.TIME_LIMIT) result.setStatus(CheckResult.StatusEnum.fromValue(checked.getStatus().toString()));
                if(checked.getStatus()==TestResult.StatusEnum.RUNTIME_ERROR || checked.getStatus()==TestResult.StatusEnum.TIME_LIMIT) break;
            }
            if(result.getStatus()==CheckResult.StatusEnum.ACCEPTED && (result.getTotal()==0 || !result.getPassed().equals(result.getTotal()))) result.setStatus(CheckResult.StatusEnum.ERROR);
        } catch(InterruptedException failure) {
            Thread.currentThread().interrupt(); result.setStatus(CheckResult.StatusEnum.ERROR); result.setDiagnostics("Аренда задания прекращена.");
        } catch(Exception failure) {
            result.setStatus(CheckResult.StatusEnum.ERROR); result.setDiagnostics("Некорректное задание или ошибка исполнителя.");
        } finally {
            boolean interrupted=Thread.interrupted();
            if(container!=null) remove(container);
            activeName=null;
            if(input!=null) try { input.close(); } catch(Exception ignored) {}
            result.setElapsedMs(System.currentTimeMillis()-started);
            if(interrupted) Thread.currentThread().interrupt();
        }
        return verifier.bounded(result);
    }
    private void validate(JobPayload payload) throws Exception {
        if(payload==null || payload.getExerciseRevision()==null || !(payload.getExerciseRevision().isTextual() || payload.getExerciseRevision().isNumber()) || payload.getMode()==null || payload.getEnvironment()==null) throw new IllegalArgumentException();
        Map<String,Integer> limits=Map.ofEntries(Map.entry("compileMs",15000),Map.entry("caseMs",3000),Map.entry("testsMs",10000),Map.entry("jobMs",90000),Map.entry("outputBytes",65536),Map.entry("memoryMiB",512),Map.entry("compilerHeapMiB",256),Map.entry("jvmHeapMiB",128),Map.entry("cpus",1),Map.entry("pids",128),Map.entry("workMiB",96),Map.entry("tmpMiB",16));
        if(!Json.MAPPER.valueToTree(limits).equals(Json.MAPPER.valueToTree(payload.getLimits()))) throw new IllegalArgumentException();
        var exercise=Objects.requireNonNull(payload.getExercise());
        if(exercise.getSourceFiles()==null || exercise.getSourceFiles().isEmpty() || exercise.getSourceFiles().size()>16 || new HashSet<>(exercise.getSourceFiles()).size()!=exercise.getSourceFiles().size() || !new HashSet<>(exercise.getSourceFiles()).equals(payload.getFiles().keySet())) throw new IllegalArgumentException();
        int total=0;
        for(var source:payload.getFiles().entrySet()) {
            if(!source.getKey().matches("(?:[a-zA-Z_$][a-zA-Z0-9_$]*/)*[a-zA-Z_$][a-zA-Z0-9_$]*\\.java") || source.getValue()==null || !StandardCharsets.UTF_8.newEncoder().canEncode(source.getValue())) throw new IllegalArgumentException();
            int bytes=source.getValue().getBytes(StandardCharsets.UTF_8).length;
            if(bytes>128*1024 || (total+=bytes)>256*1024) throw new IllegalArgumentException();
        }
        if(exercise.getTests()==null || exercise.getTests().isEmpty() || exercise.getTests().size()>100 || exercise.getCustomTypes()==null || exercise.getClassName()==null || exercise.getMethod()==null || exercise.getParameterTypes()==null) throw new IllegalArgumentException();
        for(TestCase test:exercise.getTests()) {
            if(test.getName()==null || test.getName().length()>200 || test.getArgs()==null || test.getArgs().size()!=exercise.getParameterTypes().size() || test.getUnchangedArguments()==null) throw new IllegalArgumentException();
            for(Integer index:test.getUnchangedArguments()) if(index==null || index<0 || index>=test.getArgs().size()) throw new IllegalArgumentException();
        }
    }
    private BoundedProcess.ProcessResult exec(String name,List<String> arguments,byte[] input,Duration timeout) throws Exception {
        List<String> command=new ArrayList<>(List.of("docker","exec","-i",name)); command.addAll(arguments);
        return processes.run(command,null,input,timeout,65536);
    }
    private static Duration remaining(long deadline,int limit) { return Duration.ofMillis(Math.max(1,Math.min(limit,deadline-System.currentTimeMillis()))); }
    private void checkCancelled() throws InterruptedException { if(cancelled.get() || Thread.currentThread().isInterrupted()) throw new InterruptedException(); }
    private void remove(String name) { try { processes.run(List.of("docker","rm","-f",name),null,null,Duration.ofSeconds(5),4096); } catch(Exception ignored) {} }
    public void cancel() { cancelled.set(true); String name=activeName; if(name!=null) remove(name); }
    public void cleanupExpired() {
        try {
            var list=processes.run(List.of("docker","ps","-aq","--filter","label="+LABEL+"=true"),null,null,Duration.ofSeconds(10),65536);
            if(!list.successful()) throw new IllegalStateException("Docker unavailable at startup");
            for(String id:list.stdout().split("\\s+")) if(!id.isBlank()) {
                var details=processes.run(List.of("docker","inspect",id),null,null,Duration.ofSeconds(5),65536);
                if(!details.successful()) continue;
                var labels=Json.MAPPER.readTree(details.stdout()).get(0).path("Config").path("Labels");
                if(workerId.equals(labels.path(LABEL+".worker").asText()) || labels.path(LABEL+".expires").asLong(0)<=System.currentTimeMillis()) remove(id);
            }
        } catch(Exception failure) { throw new IllegalStateException("Cannot clean up runner containers",failure); }
    }
    public void close() { cancel(); }
}
