package ru.mentor.platform.practice;

import static ru.mentor.platform.practice.PracticeJson.fields;
import static ru.mentor.platform.practice.PracticeJson.text;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.*;

import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.*;

import tools.jackson.databind.JsonNode;

import java.util.*;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}")
public class PracticeController {
    private final CatalogService catalog;
    private final AssignmentService assignments;
    private final DraftService drafts;
    private final SessionPolicy sessions;
    private final AttemptService attempts;
    private final JobQueue queue;
    private final ru.mentor.platform.workspaces.WorkspaceAccess access;
    private final java.time.Clock clock;

    public PracticeController(
            CatalogService catalog,
            AssignmentService assignments,
            DraftService drafts,
            SessionPolicy sessions,
            AttemptService attempts,
            JobQueue queue,
            ru.mentor.platform.workspaces.WorkspaceAccess access,
            java.time.Clock clock) {
        this.catalog = catalog;
        this.assignments = assignments;
        this.drafts = drafts;
        this.sessions = sessions;
        this.attempts = attempts;
        this.queue = queue;
        this.access = access;
        this.clock = clock;
    }

    @GetMapping("/exercises")
    public Page<JsonNode> catalog(
            @PathVariable String workspaceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return catalog.list(sessions.requireCurrent(r), workspaceId, page, size, audience);
    }

    // Whether the executor is alive, so a long queue gets an explanation instead of an endless
    // hourglass. Aggregates only, no job identifiers.
    @GetMapping("/practice/worker")
    public org.springframework.http.ResponseEntity<Map<String, Object>> worker(
            @PathVariable String workspaceId, HttpServletRequest r) {
        access.requireMember(sessions.requireCurrent(r), workspaceId);
        var d = queue.diagnostics();
        var seen = d.lastWorkerSeenAt();
        boolean available = seen != null && !seen.isBefore(clock.instant().minusSeconds(90));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("available", available);
        out.put("lastSeenAt", seen == null ? null : seen.toString());
        out.put("waiting", d.waiting());
        out.put("running", d.running());
        return org.springframework.http.ResponseEntity.ok()
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(out);
    }

    private static final String P = "/students/{studentId}/lessons/{lessonId}/practice";

    @GetMapping(P)
    public AssignmentService.LessonPracticeView practice(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return assignments.read(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                audience);
    }

    @PutMapping(
            value = P + "/assignments",
            consumes = {"application/json", "application/*+json"})
    public AssignmentService.LessonPracticeView replace(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @RequestBody byte[] body,
            HttpServletRequest r) {
        JsonNode input = PracticeJson.read(body);
        fields(input, Set.of("revision", "assignments"), Set.of("revision", "assignments"));
        JsonNode values = input.get("assignments");
        if (!values.isArray()) throw new IllegalArgumentException("Assignments required.");
        var list = new ArrayList<AssignmentService.AssignmentInput>();
        for (var a : values) {
            fields(a, Set.of("exerciseId", "placement"), Set.of("exerciseId", "placement"));
            list.add(
                    new AssignmentService.AssignmentInput(
                            text(a.get("exerciseId")), Placement.from(text(a.get("placement")))));
        }
        return assignments.replace(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                counter(input.get("revision")),
                list);
    }

    @GetMapping(P + "/exercises/{exerciseId}/draft")
    public Draft draft(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String exerciseId,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return drafts.read(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                exerciseId,
                audience);
    }

    @PutMapping(
            value = P + "/exercises/{exerciseId}/draft",
            consumes = {"application/json", "application/*+json"})
    public Draft save(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String exerciseId,
            @RequestBody byte[] body,
            HttpServletRequest r) {
        JsonNode input = PracticeJson.read(body);
        fields(
                input,
                Set.of("exerciseRevision", "revision", "files", "resetForRevision"),
                Set.of("exerciseRevision", "revision", "files"));
        return drafts.save(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                exerciseId,
                ExerciseRevision.fromJson(input.get("exerciseRevision")),
                SourceFiles.fromJson(input.get("files")),
                counter(input.get("revision")),
                input.has("resetForRevision")
                        ? ExerciseRevision.fromJson(input.get("resetForRevision"))
                        : null);
    }

    @GetMapping(P + "/draft-archives")
    public Page<Map<String, Object>> archives(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @RequestParam(required = false) String exerciseId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return drafts.archives(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                exerciseId,
                page,
                size,
                audience);
    }

    @GetMapping(P + "/draft-archives/{archiveId}")
    public Map<String, Object> archive(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String archiveId,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return drafts.archive(
                sessions.requireCurrent(r),
                new LessonRef(workspaceId, studentId, lessonId),
                archiveId,
                audience);
    }

    private static final String A = P + "/exercises/{exerciseId}/attempts";

    @PostMapping(
            value = A,
            consumes = {"application/json", "application/*+json"})
    public org.springframework.http.ResponseEntity<Attempt> enqueue(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String exerciseId,
            @RequestBody byte[] body,
            HttpServletRequest r) {
        var headers = Collections.list(r.getHeaders("Idempotency-Key"));
        if (headers.size() != 1)
            throw new IllegalArgumentException("One Idempotency-Key required.");
        var n = PracticeJson.read(body);
        fields(
                n,
                Set.of("exerciseRevision", "mode", "files"),
                Set.of("exerciseRevision", "mode", "files"));
        var attempt =
                attempts.enqueue(
                        sessions.requireCurrent(r),
                        new LessonRef(workspaceId, studentId, lessonId),
                        exerciseId,
                        ExerciseRevision.fromJson(n.get("exerciseRevision")),
                        SourceFiles.fromJson(n.get("files")),
                        Mode.valueOf(text(n.get("mode"))),
                        headers.get(0));
        String path =
                "/api/v1/workspaces/"
                        + segment(workspaceId)
                        + "/students/"
                        + segment(studentId)
                        + "/lessons/"
                        + segment(lessonId)
                        + "/practice/exercises/"
                        + segment(exerciseId)
                        + "/attempts/"
                        + segment(attempt.id());
        return org.springframework.http.ResponseEntity.accepted()
                .header("Cache-Control", "no-store")
                .location(java.net.URI.create(path))
                .body(attempt);
    }

    @GetMapping(A)
    public org.springframework.http.ResponseEntity<Page<Attempt.Summary>> attempts(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String exerciseId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return org.springframework.http.ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(
                        attempts.list(
                                sessions.requireCurrent(r),
                                new LessonRef(workspaceId, studentId, lessonId),
                                exerciseId,
                                page,
                                size,
                                audience));
    }

    @GetMapping(A + "/{attemptId}")
    public org.springframework.http.ResponseEntity<Attempt> attempt(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @PathVariable String exerciseId,
            @PathVariable String attemptId,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return org.springframework.http.ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(
                        attempts.detail(
                                sessions.requireCurrent(r),
                                new LessonRef(workspaceId, studentId, lessonId),
                                exerciseId,
                                attemptId,
                                audience));
    }

    private static String segment(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    static long counter(JsonNode value) {
        if (value == null
                || !value.isIntegralNumber()
                || !value.canConvertToLong()
                || value.asLong() < 0)
            throw new IllegalArgumentException("Nonnegative revision required.");
        return value.asLong();
    }
}
