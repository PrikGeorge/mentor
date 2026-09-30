package ru.mentor.runner;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import ru.mentor.runner.protocol.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class RunnerFixtures {
    static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule());
    static final Path ROOT = Path.of("..").toAbsolutePath().normalize();
    static final String LIST = "import java.util.*; public class ListTask { static List<Integer> select(List<Integer> source,int minimum) { return source.stream().filter(n -> n >= minimum).sorted().toList(); } public static void main(String[] x) { throw new AssertionError(); } }";
    static final String GROUPING = """
        import java.util.*;
        public class GroupingTask {
          static class Loan { final int bookId, readerId; Loan(int b,int r) { bookId=b; readerId=r; } }
          static List<String> duplicateReport(List<Loan> loans) {
            Map<Integer,Integer> counts=new TreeMap<>(); Map<Integer,Set<Integer>> readers=new TreeMap<>();
            for(Loan loan:loans) { counts.merge(loan.bookId,1,Integer::sum); readers.computeIfAbsent(loan.bookId,k -> new TreeSet<>()).add(loan.readerId); }
            List<String> result=new ArrayList<>(); for(int id:counts.keySet()) if(counts.get(id)>=2) result.add("DUPLICATE book="+id+" readers="+readers.get(id)); return result;
          }
        }
        """;
    static String listCode(String body) { return "import java.util.*; public class ListTask { static List<Integer> select(List<Integer> source,int minimum) throws Exception { " + body + " } }"; }
    static EnvironmentBuilder.EnvironmentManifest prepare() throws Exception {
        Process docker = new ProcessBuilder("docker","info","--format","{{.OSType}}").start();
        assertTrue(docker.waitFor(10, java.util.concurrent.TimeUnit.SECONDS), "Docker daemon must answer");
        assertEquals(0,docker.exitValue(),new String(docker.getErrorStream().readAllBytes()));
        assertEquals("linux",new String(docker.getInputStream().readAllBytes()).trim(),"Mandatory Linux Docker lane");
        return new EnvironmentBuilder().prepare(ROOT.resolve("training/environments.json"),ROOT.resolve(".runtime/training-cache"));
    }
    static JobLease lease(EnvironmentBuilder.EnvironmentManifest manifest, String exerciseId, String source) throws Exception {
        JsonNode entry = null;
        for(JsonNode item:JSON.readTree(ROOT.resolve("training/catalog.json").toFile())) if(item.path("id").asText().equals(exerciseId)) entry=item;
        assertNotNull(entry);
        ObjectNode exercise=JSON.createObjectNode();
        for(String key:List.of("className","method","parameterTypes","customTypes","tests")) if(entry.has(key)) exercise.set(key,entry.get(key).deepCopy());
        exercise.set("sourceFiles",entry.get("starterFiles"));
        if(!exercise.has("customTypes")) exercise.putObject("customTypes");
        for(JsonNode item:exercise.get("tests")) {
            ((ObjectNode)item).remove("sample");
            if(!item.has("unchangedArguments")) ((ObjectNode)item).putArray("unchangedArguments");
        }
        Map<String,String> files=new LinkedHashMap<>();
        for(JsonNode name:entry.get("starterFiles")) files.put(name.asText(),Files.readString(ROOT.resolve("training/exercises/"+exerciseId+"/"+name.asText())));
        if(source!=null) files.put(entry.get("starterFiles").get(0).asText(),source);
        var prepared=manifest.environments().get(entry.get("environmentId").asText());
        EnvironmentSnapshot environment = new EnvironmentSnapshot().id(entry.get("environmentId").asText()).revision(prepared==null?"missing":prepared.revision()).imageDigest(prepared==null?"sha256:"+"0".repeat(64):prepared.imageDigest());
        String limits="{\"compileMs\":15000,\"caseMs\":3000,\"testsMs\":10000,\"jobMs\":90000,\"outputBytes\":65536,\"memoryMiB\":512,\"compilerHeapMiB\":256,\"jvmHeapMiB\":128,\"cpus\":1,\"pids\":128,\"workMiB\":96,\"tmpMiB\":16}";
        JobPayload payload=new JobPayload().exerciseId(exerciseId).exerciseRevision(entry.get("revision")).mode(JobPayload.ModeEnum.SUBMIT).files(files).exercise(JSON.treeToValue(exercise,ExerciseSnapshot.class)).environment(environment).limits(JSON.readValue(limits,ResourceLimits.class));
        return new JobLease().jobId(UUID.randomUUID().toString()).attemptId(UUID.randomUUID().toString()).leaseToken("synthetic-lease").leaseExpiresAt(OffsetDateTime.now().plusSeconds(30)).deadlineAt(OffsetDateTime.now().plusSeconds(90)).payload(payload);
    }
    static String status(CheckResult result) { return result.getStatus().toString(); }
}
