package ru.mentor.platform.practice;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.workspaces.WorkspaceAccess;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class AttemptService {
    private final AttemptRepository repository;
    private final PracticeAuthority authority;
    private final AssignmentService assignments;
    private final CatalogService catalog;
    private final DraftService drafts;
    private final JobQueue queue;
    private final Clock clock;

    public AttemptService(
            AttemptRepository repository,
            PracticeAuthority authority,
            AssignmentService assignments,
            CatalogService catalog,
            DraftService drafts,
            JobQueue queue,
            Clock clock) {
        this.repository = repository;
        this.authority = authority;
        this.assignments = assignments;
        this.catalog = catalog;
        this.drafts = drafts;
        this.queue = queue;
        this.clock = clock;
    }

    @Transactional
    public Attempt enqueue(
            Actor actor,
            LessonRef lesson,
            String exerciseId,
            ExerciseRevision revision,
            Map<String, String> files,
            Mode mode,
            String key) {
        key(key);
        if (revision == null || mode == null)
            throw new IllegalArgumentException("Invalid attempt.");
        files = SourceFiles.validate(files, files == null ? Set.of() : files.keySet());
        authority.student(actor, lesson);
        var history = assignments.requireHistoryByExercise(actor, lesson, exerciseId);
        String hash =
                CatalogSource.sha(
                        AttemptRepository.encode(
                                        List.of(revision.key(), mode.name(), new TreeMap<>(files)))
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var prior = repository.replay(history, actor.userId(), key);
        if (prior.isPresent()) {
            if (!prior.get().hash().equals(hash))
                throw new ApiFailure(
                        409,
                        "IDEMPOTENCY_CONFLICT",
                        "Idempotency key already used for another source.");
            return prior.get().attempt();
        }
        var active = assignments.requireActive(actor, lesson, exerciseId);
        var published = catalog.requireCurrent(actor, lesson, exerciseId, revision);
        drafts.requireRunnableDraft(actor, lesson, active, revision);
        files = SourceFiles.validate(files, published.starterFiles().keySet());
        // Task6 order through draft remains held; durable queue row then attempt/job are last.
        queue.admit();
        String id = UUID.randomUUID().toString();
        repository.insert(
                active,
                actor.userId(),
                key,
                hash,
                JobPayload.snapshot(published, mode, files),
                clock.instant().truncatedTo(ChronoUnit.MICROS),
                id,
                UUID.randomUUID().toString());
        return repository.detail(active, id).orElseThrow();
    }

    public Page<Attempt.Summary> list(
            Actor actor, LessonRef lesson, String exercise, int page, int size, String audience) {
        PracticeAuthority.audience(audience);
        new Page<>(List.of(), page, size, 0);
        var a = assignments.requireHistoryByExercise(actor, lesson, exercise);
        return new Page<>(repository.list(a, page, size), page, size, repository.count(a));
    }

    public Attempt detail(
            Actor actor, LessonRef lesson, String exercise, String id, String audience) {
        PracticeAuthority.audience(audience);
        var a = assignments.requireHistoryByExercise(actor, lesson, exercise);
        return repository.detail(a, id).orElseThrow(WorkspaceAccess::missing);
    }

    static void key(String key) {
        if (key == null || !key.matches("[A-Za-z0-9._:-]{1,128}"))
            throw new IllegalArgumentException("Valid Idempotency-Key required.");
    }
}
