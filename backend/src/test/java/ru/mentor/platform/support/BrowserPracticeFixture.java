package ru.mentor.platform.support;

import org.springframework.context.ConfigurableApplicationContext;
import ru.mentor.platform.practice.CatalogCommand;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Publishes the trusted training catalog into one synthetic workspace under a generated environment manifest. No executor runs. */
final class BrowserPracticeFixture {
    private BrowserPracticeFixture() {}
    static void seed(ConfigurableApplicationContext context, Path request, Path complete, Path runtime) throws Exception {
        ObjectMapper json = context.getBean(ObjectMapper.class);
        Map<?,?> ids = json.readValue(Files.readString(request), Map.class);
        if (!ids.keySet().equals(Set.of("workspaceId"))) throw new IllegalArgumentException("ID-only practice fixture request");
        if (!(ids.get("workspaceId") instanceof String workspace) || !workspace.matches("[A-Za-z0-9-]{1,80}")) throw new IllegalArgumentException("Synthetic ID required");
        Path training = Path.of("training").toAbsolutePath().normalize();
        Path root = Files.createDirectories(runtime.resolve("catalog"));
        for (String file : List.of("catalog.json", "environments.json")) Files.copy(training.resolve(file), root.resolve(file), StandardCopyOption.REPLACE_EXISTING);
        Path exercises = training.resolve("exercises");
        try (var paths = Files.walk(exercises)) {
            for (Path p : paths.toList()) {
                Path target = root.resolve("exercises").resolve(exercises.relativize(p).toString());
                if (Files.isDirectory(p)) Files.createDirectories(target); else Files.copy(p, target, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        ObjectNode environments = json.createObjectNode();
        for (var profile : json.readTree(root.resolve("environments.json").toFile())) {
            ObjectNode e = environments.putObject(profile.get("id").asText());
            e.put("id", profile.get("id").asText()); e.put("revision", "a".repeat(64)); e.put("imageDigest", "sha256:" + "b".repeat(64));
            var deps = e.putArray("dependencies");
            for (int i = 0; i < profile.get("dependencies").size(); i++) deps.add("/opt/mentor/deps/dependency-" + i + ".jar");
            e.set("annotationProcessors", profile.get("annotationProcessors").deepCopy());
        }
        Path manifest = root.resolve("manifest.json");
        Files.writeString(manifest, json.writeValueAsString(Map.of("environments", environments)), StandardCharsets.UTF_8);
        var report = context.getBean(CatalogCommand.class).run(new String[]{"--source", root.resolve("catalog.json").toString(), "--workspace", workspace,
            "--environment-manifest", manifest.toString(), "--environment-manifest-sha256", sha(manifest), "--environment-profiles-sha256", sha(root.resolve("environments.json"))});
        Files.writeString(complete, json.writeValueAsString(Map.of("status", report.errors().isEmpty() ? "ready" : "rejected", "workspaceId", workspace, "published", report.published(), "errors", report.errors())));
    }
    private static String sha(Path p) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p))); }
}
