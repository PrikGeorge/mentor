package ru.mentor.platform.practice;

import tools.jackson.databind.JsonNode;

import java.util.*;

/** Internal immutable DTO. No operator paths, dependency URLs or private provenance escape into jobs. */
public record JobPayload(
        String exerciseId,
        ExerciseRevision exerciseRevision,
        Mode mode,
        Map<String, String> files,
        JsonNode exercise,
        JsonNode environment,
        Map<String, Integer> limits) {
    public JobPayload {
        files = Map.copyOf(files);
        exercise = exercise.deepCopy();
        environment = environment.deepCopy();
        limits = Map.copyOf(limits);
    }

    public JsonNode exercise() {
        return exercise.deepCopy();
    }

    public JsonNode environment() {
        return environment.deepCopy();
    }

    public static JobPayload snapshot(
            PublishedExercise published, Mode mode, Map<String, String> files) {
        var raw = published.privateExercise();
        var json = PracticeJson.MAPPER;
        var exercise = json.createObjectNode();
        for (String key : List.of("className", "method", "parameterTypes"))
            exercise.set(key, raw.get(key).deepCopy());
        exercise.set("sourceFiles", json.valueToTree(new TreeSet<>(files.keySet())));
        exercise.set(
                "customTypes",
                raw.has("customTypes")
                        ? raw.get("customTypes").deepCopy()
                        : json.createObjectNode());
        var tests = exercise.putArray("tests");
        for (var t : raw.get("tests")) {
            if (mode == Mode.run && !t.path("sample").asBoolean()) continue;
            var test = json.createObjectNode();
            for (String key : List.of("name", "args", "expected"))
                test.set(key, t.get(key).deepCopy());
            test.set(
                    "unchangedArguments",
                    t.has("unchangedArguments")
                            ? t.get("unchangedArguments").deepCopy()
                            : json.createArrayNode());
            tests.add(test);
        }
        var environment = json.createObjectNode();
        for (String key : List.of("id", "revision", "imageDigest"))
            environment.set(key, published.environment().get(key));
        return new JobPayload(
                published.exerciseId(),
                published.revision(),
                mode,
                files,
                exercise,
                environment,
                Map.ofEntries(
                        Map.entry("compileMs", 15000),
                        Map.entry("caseMs", 3000),
                        Map.entry("testsMs", 10000),
                        Map.entry("jobMs", 90000),
                        Map.entry("outputBytes", 65536),
                        Map.entry("memoryMiB", 512),
                        Map.entry("compilerHeapMiB", 256),
                        Map.entry("jvmHeapMiB", 128),
                        Map.entry("cpus", 1),
                        Map.entry("pids", 128),
                        Map.entry("workMiB", 96),
                        Map.entry("tmpMiB", 16)));
    }

    static JobPayload decode(JsonNode n) {
        return new JobPayload(
                n.get("exerciseId").asText(),
                ExerciseRevision.fromJson(n.get("exerciseRevision")),
                Mode.valueOf(n.get("mode").asText()),
                SourceFiles.fromJson(n.get("files")),
                n.get("exercise"),
                n.get("environment"),
                PracticeJson.MAPPER.convertValue(
                        n.get("limits"),
                        new tools.jackson.core.type.TypeReference<Map<String, Integer>>() {}));
    }
}
