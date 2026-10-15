package ru.mentor.platform.practice;

import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.stereotype.Component;

import ru.mentor.platform.migration.OfflineImportLease;

import java.nio.file.Path;
import java.time.Instant;
import java.util.*;

/** Offline-only admission; parser, immutable revision hash and publication are shared with catalog CLI. */
@Component
@ConditionalOnNotWebApplication
public class CatalogImport {
    public record Definition(PublishedExercise exercise, String hash) {}

    private final PracticeRepository repository;

    public CatalogImport(PracticeRepository repository) {
        this.repository = repository;
    }

    public static List<Definition> inspect(
            Path source, Path approval, String approvalHash, String profilesHash) throws Exception {
        return new CatalogSource()
                .load(source, approval, approvalHash, profilesHash).stream()
                        .map(e -> new Definition(e.exercise(), e.hash()))
                        .toList();
    }

    public void publish(OfflineImportLease lease, List<Definition> entries, Instant createdAt) {
        lease.requireMutable();
        for (var entry : entries) {
            var e = entry.exercise();
            var old =
                    repository.snapshotHash(
                            lease.workspaceId(), e.exerciseId(), e.revision().key());
            if (old.isPresent()) {
                if (!old.get().equals(entry.hash()))
                    throw new IllegalStateException(
                            "Imported catalog revision differs from its durable source.");
            } else repository.publish(lease.workspaceId(), e, entry.hash(), createdAt);
        }
    }
}
