package ru.mentor.platform.practice;

import tools.jackson.databind.JsonNode;

import java.util.Map;

/** Internal immutable snapshot, deliberately never returned by a controller. */
public record PublishedExercise(
        String exerciseId,
        ExerciseRevision revision,
        JsonNode publicProjection,
        JsonNode privateExercise,
        JsonNode environment,
        JsonNode provenance) {
    public PublishedExercise {
        publicProjection = publicProjection.deepCopy();
        privateExercise = privateExercise.deepCopy();
        environment = environment.deepCopy();
        provenance = provenance.deepCopy();
    }

    public JsonNode publicProjection() {
        return publicProjection.deepCopy();
    }

    public JsonNode privateExercise() {
        return privateExercise.deepCopy();
    }

    public JsonNode environment() {
        return environment.deepCopy();
    }

    public JsonNode provenance() {
        return provenance.deepCopy();
    }

    public Map<String, String> starterFiles() {
        return Map.copyOf(SourceFiles.fromJson(publicProjection.get("starterFiles")));
    }
}
