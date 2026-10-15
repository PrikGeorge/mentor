package ru.mentor.platform.practice;

import java.time.Instant;
import java.util.Map;

public record Attempt(
        String id,
        String exerciseId,
        ExerciseRevision exerciseRevision,
        String environmentRevision,
        Mode mode,
        String jobState,
        Map<String, String> files,
        ResultProjection.PublicResult result,
        Instant createdAt) {
    public Attempt {
        files = Map.copyOf(files);
    }

    public record Summary(
            String id,
            String exerciseId,
            ExerciseRevision exerciseRevision,
            String environmentRevision,
            Mode mode,
            String jobState,
            ResultProjection.PublicResult result,
            Instant createdAt) {}

    public Summary summary() {
        return new Summary(
                id,
                exerciseId,
                exerciseRevision,
                environmentRevision,
                mode,
                jobState,
                result,
                createdAt);
    }
}
