package ru.mentor.runner;

import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import com.fasterxml.jackson.databind.JsonNode;

public final class EnvironmentBuilder {
    public record PreparedEnvironment(String id, String revision, String imageDigest, List<String> dependencies, List<String> annotationProcessors) {
        public PreparedEnvironment { dependencies=List.copyOf(dependencies); annotationProcessors=List.copyOf(annotationProcessors); }
    }
    public record EnvironmentManifest(Map<String, PreparedEnvironment> environments) {
        public EnvironmentManifest { environments=Map.copyOf(environments); }
    }
    /** Operator command only. Never called while consuming a job. No dependencies are downloaded. */
    public EnvironmentManifest prepare(Path profiles, Path cache) throws Exception {
        Map<String,PreparedEnvironment> environments=new LinkedHashMap<>();
        BoundedProcess processes=new BoundedProcess();
        for(JsonNode profile:Json.MAPPER.readTree(profiles.toFile())) {
            String id=profile.path("id").asText();
            if(!id.matches("[a-zA-Z0-9_-]{1,100}") || profile.path("javaVersion").asInt()!=21) throw new IllegalArgumentException("Invalid operator environment");
            var inspected=processes.run(List.of("docker","image","inspect",profile.path("dockerImage").asText()),null,null,Duration.ofSeconds(10),65536);
            if(!inspected.successful()) throw new IllegalStateException("Operator must first pull the approved JDK 21 base image");
            JsonNode base=Json.MAPPER.readTree(inspected.stdout()).get(0);
            if(!base.path("Os").asText().equals("linux") || base.path("RepoDigests").isEmpty()) throw new IllegalArgumentException("Base must have a Linux registry digest");
            String baseDigest=base.get("RepoDigests").get(0).asText();
            if(!baseDigest.matches("[a-zA-Z0-9._/:-]+@sha256:[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid base digest");
            Path context=Files.createTempDirectory("mentor-environment-");
            try {
                Files.createDirectory(context.resolve("deps"));
                List<String> dependencies=new ArrayList<>(), processors=new ArrayList<>();
                for(String resource:List.of("TrustedHarness.java","ContainerDeadline.java","Dockerfile","runner.policy")) {
                    try(var input=EnvironmentBuilder.class.getResourceAsStream("/harness/"+resource)) {
                        if(input==null) throw new IllegalStateException("Missing trusted image resource");
                        Files.copy(input,context.resolve(resource));
                    }
                }
                StringBuilder identity=new StringBuilder(profile.toString()).append(baseDigest);
                for(String name:List.of("TrustedHarness.java","ContainerDeadline.java","Dockerfile","runner.policy")) identity.append(sha(Files.readAllBytes(context.resolve(name))));
                int index=0;
                for(JsonNode dependency:profile.path("dependencies")) {
                    String name=dependency.path("groupId").asText()+"."+dependency.path("artifactId").asText()+"-"+dependency.path("version").asText()+".jar";
                    if(!name.matches("[a-zA-Z0-9._-]+\\.jar")) throw new IllegalArgumentException("Invalid dependency name");
                    Path jar=cache.resolve("jars").resolve(name);
                    byte[] content=Files.readAllBytes(jar);
                    if(!sha(content).equals(dependency.path("sha256").asText())) throw new IllegalArgumentException("Dependency SHA-256 mismatch: "+name);
                    String target="dependency-"+(index++)+".jar";
                    Files.write(context.resolve("deps").resolve(target),content);
                    dependencies.add("/opt/mentor/deps/"+target);
                }
                for(JsonNode processor:profile.path("annotationProcessors")) {
                    if(!processor.asText().matches("[a-zA-Z_$][a-zA-Z0-9_.$]*")) throw new IllegalArgumentException("Invalid annotation processor");
                    processors.add(processor.asText());
                }
                String revision=sha(identity.toString().getBytes(StandardCharsets.UTF_8));
                String tag="mentor-runner-env:"+revision;
                var existing=processes.run(List.of("docker","image","inspect",tag,"--format","{{.Id}}"),null,null,Duration.ofSeconds(10),4096);
                if(!existing.successful()) {
                    var build=processes.run(List.of("docker","build","--network=none","--pull=false","--build-arg","BASE_IMAGE="+baseDigest,"-t",tag,context.toString()),null,null,Duration.ofMinutes(2),65536);
                    if(!build.successful()) throw new IllegalStateException("Environment image build failed: "+build.stderr());
                }
                var image=processes.run(List.of("docker","image","inspect",tag,"--format","{{.Id}}"),null,null,Duration.ofSeconds(10),4096);
                String digest=image.stdout().trim();
                if(!image.successful() || !digest.matches("sha256:[a-f0-9]{64}")) throw new IllegalStateException("Cannot pin prepared image");
                environments.put(id,new PreparedEnvironment(id,revision,digest,dependencies,processors));
            } finally { deleteTree(context); }
        }
        if(environments.isEmpty()) throw new IllegalArgumentException("No approved environments");
        return new EnvironmentManifest(environments);
    }
    private static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    static void deleteTree(Path directory) throws java.io.IOException {
        // Only callers' freshly created temporary directories reach this method; never operator paths.
        try(var paths=Files.walk(directory)) { for(Path path:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path); }
    }
}
