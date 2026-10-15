package ru.mentor.platform.practice;

import java.time.Instant;
import java.util.Map;

public record Draft(
        String exerciseId,
        ExerciseRevision exerciseRevision,
        long revision,
        Map<String, String> files,
        Instant updatedAt) {
    public Draft {
        files = Map.copyOf(files);
    }
}
