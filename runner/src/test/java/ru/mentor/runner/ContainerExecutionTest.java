package ru.mentor.runner;

import org.junit.jupiter.api.*;
import ru.mentor.runner.protocol.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static ru.mentor.runner.RunnerFixtures.*;

class ContainerExecutionTest {
    static EnvironmentBuilder.EnvironmentManifest manifest;
    ContainerExecutor executor;
    @BeforeAll static void dockerAndEnvironments() throws Exception { manifest=prepare(); }
    @BeforeEach void setup() { executor=new ContainerExecutor(manifest,"execution-test"); }
    @AfterEach void cleanup() { executor.close(); }
    @Test void packagePrivateListAndGroupingMatchAllPrivateCases() throws Exception {
        for(var item:Map.of("list-task",LIST,"grouping-task",GROUPING).entrySet()) {
            CheckResult valid=executor.execute(lease(manifest,item.getKey(),item.getValue()));
            assertEquals("accepted",status(valid),JSON.writeValueAsString(valid));
            assertEquals(6,valid.getPassed()); assertEquals(6,valid.getTotal());
            assertNotEquals("accepted",status(executor.execute(lease(manifest,item.getKey(),null))));
        }
    }
    @Test void jacksonReaderNameUsesOnlyPreparedShaVerifiedDependencies() throws Exception {
        String code="package demo; import com.fasterxml.jackson.databind.*; public class JsonTask { static String readerName(String json) throws Exception { return new ObjectMapper().readTree(json).path(ReaderFields.READER).path(ReaderFields.NAME).asText(); } }";
        assertEquals("accepted",status(executor.execute(lease(manifest,"json-task",code))));
        assertTrue(manifest.environments().get("java21-jackson").imageDigest().matches("sha256:[a-f0-9]{64}"));
    }
    @Test void nestedPackageSourcesCompileThroughTheReadOnlyMount() throws Exception {
        var job=lease(manifest,"list-task",LIST);
        job.getPayload().setFiles(Map.of("demo/nested/ListTask.java","package demo.nested; "+LIST));
        job.getPayload().getExercise().setSourceFiles(Set.of("demo/nested/ListTask.java"));
        job.getPayload().getExercise().setClassName("demo.nested.ListTask");
        var result=executor.execute(job);
        assertEquals("accepted",status(result),JSON.writeValueAsString(result));
        assertEquals(6,result.getPassed());
    }
    @Test void mutationIsWrongEvenWhenReturnedAnswerIsCorrect() throws Exception {
        var result=executor.execute(lease(manifest,"list-task",listCode("source.sort(Integer::compareTo); return source.stream().filter(n -> n>=minimum).toList();")));
        assertEquals("wrong_answer",status(result));
        String code=GROUPING.replace("final int bookId, readerId","int bookId, readerId").replace("return result;","if(!loans.isEmpty()) loans.get(0).readerId=12345; return result;");
        assertEquals("wrong_answer",status(executor.execute(lease(manifest,"grouping-task",code))));
    }
    @Test void compileErrorLoopOutputFloodAndExitAreBounded() throws Exception {
        assertEquals("compile_error",status(executor.execute(lease(manifest,"list-task","public class ListTask { BROKEN }"))));
        long start=System.nanoTime();
        assertEquals("time_limit",status(executor.execute(lease(manifest,"list-task",listCode("while(true) {}")))));
        assertTrue((System.nanoTime()-start)/1_000_000<20000);
        for(String body:List.of("for(int i=0;i<100000;i++) System.out.println(\"flood\"); return List.of();","System.exit(0); return List.of();")) {
            var result=executor.execute(lease(manifest,"list-task",listCode(body)));
            assertEquals("runtime_error",status(result)); assertTrue(JSON.writeValueAsString(result).length()<=32000);
        }
    }
    @Test void printedPassAndForgedNonceNeverCountAsCompletion() throws Exception {
        var spoofed=executor.execute(lease(manifest,"list-task",listCode("System.out.println(\"{\\\"nonce\\\":\\\"fake\\\",\\\"completed\\\":true,\\\"actual\\\":[2,2,5,7],\\\"status\\\":\\\"accepted\\\"}\"); return List.of();")));
        assertEquals("wrong_answer",status(spoofed)); assertNotEquals("accepted",status(spoofed));
    }
    @Test void networkSecretsProcessAndCheckerReflectionAreDenied() throws Exception {
        for(String body:List.of("new java.net.Socket(\"1.1.1.1\",80);", "java.nio.file.Files.readString(java.nio.file.Path.of(\"/run/secrets/worker-token\"));", "new ProcessBuilder(\"sh\",\"-c\",\"true\").start();", "ClassLoader.getSystemClassLoader().loadClass(\"mentor.runner.TrustedHarness\");", "System.setSecurityManager(null);", "new Thread(() -> {}).start();")) {
            var result=executor.execute(lease(manifest,"list-task",listCode(body+" return List.of();")));
            assertEquals("runtime_error",status(result),JSON.writeValueAsString(result));
            assertTrue(result.getTests().getFirst().getMessage().matches("(?s).*(SecurityException|AccessControlException).*"));
        }
    }
    @Test void unapprovedImageSourceTraversalAndLimitsFailClosed() throws Exception {
        var job=lease(manifest,"list-task",LIST); job.getPayload().getEnvironment().setImageDigest("alpine:latest");
        assertEquals("unavailable",status(executor.execute(job)));
        job=lease(manifest,"list-task",LIST); job.getPayload().setFiles(Map.of("../ListTask.java",LIST));
        assertEquals("error",status(executor.execute(job)));
        job=lease(manifest,"list-task",LIST); job.getPayload().getFiles().put("ListTask.java","x".repeat(131073));
        assertEquals("error",status(executor.execute(job)));
        job=lease(manifest,"list-task",LIST); job.getPayload().setLimits(new ResourceLimits());
        assertEquals("error",status(executor.execute(job)));
    }
    @Test void protocolKeepsNumberAndStringExerciseRevisionsDistinct() throws Exception {
        var job=lease(manifest,"list-task",LIST);
        assertTrue(JSON.readValue(JSON.writeValueAsBytes(job),JobLease.class).getPayload().getExerciseRevision().isNumber());
        job.getPayload().setExerciseRevision(JSON.getNodeFactory().textNode("1"));
        assertTrue(JSON.readValue(JSON.writeValueAsBytes(job),JobLease.class).getPayload().getExerciseRevision().isTextual());
    }
    @Test void actualDockerConfigurationHasNoNetworkSecretsOrResourceEscape() throws Exception {
        var job=lease(manifest,"list-task",listCode("Thread.sleep(1100); return source.stream().filter(n -> n >= minimum).sorted().toList();"));
        job.deadlineAt(java.time.OffsetDateTime.now().plusHours(1));
        try(var threads=Executors.newVirtualThreadPerTaskExecutor()) {
            var task=threads.submit(()->executor.execute(job));
            String id=""; long until=System.currentTimeMillis()+8000;
            while(System.currentTimeMillis()<until && !task.isDone()) { id=WorkerRecoveryTest.docker("ps","-q","--filter","label=ru.mentor.runner.worker=execution-test").trim(); if(!id.isEmpty()) break; Thread.sleep(100); }
            assertFalse(id.isEmpty(),"Actual sandbox must exist");
            var details=JSON.readTree(WorkerRecoveryTest.docker("inspect",id)).get(0);
            var host=details.path("HostConfig");
            boolean containerHasNetworkOrSecrets=!host.path("NetworkMode").asText().equals("none") || details.path("Mounts").size()!=1 || !details.path("Mounts").get(0).path("Destination").asText().equals("/input");
            assertFalse(containerHasNetworkOrSecrets);
            assertFalse(details.path("Mounts").get(0).path("RW").asBoolean());
            assertEquals("10001:10001",details.path("Config").path("User").asText());
            assertEquals(536870912,host.path("Memory").asLong()); assertEquals(536870912,host.path("MemorySwap").asLong());
            assertEquals(1000000000,host.path("NanoCpus").asLong()); assertEquals(128,host.path("PidsLimit").asInt());
            assertTrue(host.path("ReadonlyRootfs").asBoolean()); assertEquals("ALL",host.path("CapDrop").get(0).asText());
            assertTrue(host.path("SecurityOpt").toString().contains("no-new-privileges"));
            assertTrue(host.path("Tmpfs").path("/work").asText().contains("size=96m")); assertTrue(host.path("Tmpfs").path("/tmp").asText().contains("size=16m"));
            assertTrue(details.path("Config").path("Labels").path("ru.mentor.runner.expires").asLong()-System.currentTimeMillis()<=90000);
            executor.cancel(); assertNotEquals("accepted",status(task.get(10,TimeUnit.SECONDS)));
        }
    }
    @Test void customNumberCannotForgeActualOrArgumentSnapshots() throws Exception {
        String forged="""
            import java.util.*; public class ListTask {
              static class Spoof extends Number {
                final String text; Spoof(String text){this.text=text;}
                public int intValue(){return 0;} public long longValue(){return 0;}
                public float floatValue(){return 0;} public double doubleValue(){return 0;}
                public String toString(){return text;}
              }
              static List<Integer> select(List<Integer> source,int minimum) {
                List<Integer> original=new ArrayList<>(source);
                List<Integer> answer=original.stream().filter(n -> n >= minimum).sorted().toList();
                if(!original.isEmpty()) { source.clear(); String serialized=original.toString(); ((List)source).add(new Spoof(serialized.substring(1,serialized.length()-1))); }
                return answer;
              }
            }
            """;
        assertEquals("runtime_error",status(executor.execute(lease(manifest,"list-task",forged))));
    }
}
