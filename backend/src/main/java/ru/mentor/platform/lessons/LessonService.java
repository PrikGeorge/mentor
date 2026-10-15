package ru.mentor.platform.lessons;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.WorkspaceAccess;

import java.time.*;
import java.util.*;

@Service
public class LessonService {
    private static final ZoneId ZONE = ZoneId.of("Europe/Moscow");
    private static final Set<String> FIELDS = Set.of("title", "date", "time", "duration");
    private final LessonRepository repository;
    private final StudentService students;
    private final Clock clock;

    public LessonService(LessonRepository repository, StudentService students, Clock clock) {
        this.repository = repository;
        this.students = students;
        this.clock = clock;
    }

    public LessonRef requireReader(
            Actor actor, String workspaceId, String studentId, String lessonId) {
        students.requireReader(actor, workspaceId, studentId);
        var ref = new LessonRef(workspaceId, studentId, lessonId);
        metadata(ref);
        return ref;
    }

    public LessonRef requireMaterialReader(
            Actor actor,
            String workspaceId,
            String studentId,
            String lessonId,
            String expectedBundleId,
            boolean studentProjection) {
        var ref = requireReader(actor, workspaceId, studentId, lessonId);
        var m = metadata(ref);
        if ((actor.role() == Actor.Role.STUDENT || studentProjection)
                && (!m.status().equals("prepared")
                        || expectedBundleId == null
                        || !expectedBundleId.equals(m.bundleId()))) throw WorkspaceAccess.missing();
        return ref;
    }

    public Page<Map<String, Object>> list(
            Actor actor, String w, String student, int page, int size, String audience) {
        new Page<>(List.of(), page, size, 0);
        students.requireReader(actor, w, student);
        publicView(actor, audience);
        return new Page<>(
                repository.list(w, student, page, size).stream()
                        .map(LessonService::summaryView)
                        .toList(),
                page,
                size,
                repository.count(w, student));
    }

    public Map<String, Object> get(Actor actor, LessonRef ref, String audience) {
        requireReader(actor, ref.workspaceId(), ref.studentId(), ref.id());
        return view(metadata(ref), publicView(actor, audience));
    }

    @Transactional
    public Map<String, Object> create(
            Actor actor, String w, String student, Map<String, Object> input) {
        students.lockTeacherCard(actor, w, student);
        checkFields(input, FIELDS);
        if (!input.keySet().equals(FIELDS))
            throw new IllegalArgumentException("Short form required.");
        return view(
                repository.create(
                        w,
                        student,
                        title(input.get("title")),
                        date(input.get("date")),
                        time(input.get("time")),
                        duration(input.get("duration")),
                        clock.instant()),
                false);
    }

    @Transactional
    public Map<String, Object> update(Actor actor, LessonRef ref, Map<String, Object> input) {
        lockTeacher(actor, ref);
        checkFields(
                input,
                Set.of("title", "date", "time", "duration", "conducted", "status", "revision"));
        long revision = revision(input.get("revision"));
        var old = metadata(ref);
        Object conducted = input.get("conducted");
        if (input.containsKey("conducted") && !(conducted instanceof Boolean))
            throw new IllegalArgumentException("Conducted must be a boolean.");
        // Marking keeps the first instant; unmarking clears it.
        Instant conductedAt =
                conducted == null
                        ? old.conductedAt()
                        : (Boolean) conducted
                                ? (old.conductedAt() == null
                                        ? clock.instant()
                                                .truncatedTo(java.time.temporal.ChronoUnit.MICROS)
                                        : old.conductedAt())
                                : null;
        // prepared publishes the lesson's materials to the student (the bundle id is minted once);
        // planned hides them again.
        String status = old.status(), bundleId = old.bundleId();
        if (input.containsKey("status")) {
            if (!(input.get("status") instanceof String s)
                    || !Set.of("planned", "prepared").contains(s))
                throw new IllegalArgumentException("Status must be planned or prepared.");
            status = s;
            if (s.equals("prepared") && bundleId == null) bundleId = UUID.randomUUID().toString();
        }
        String title = input.containsKey("title") ? title(input.get("title")) : old.title(),
                date = input.containsKey("date") ? date(input.get("date")) : old.date(),
                time = input.containsKey("time") ? time(input.get("time")) : old.time();
        int duration =
                input.containsKey("duration") ? duration(input.get("duration")) : old.duration();
        if (!repository.update(
                old, title, date, time, duration, conductedAt, status, bundleId, revision))
            throw conflict();
        return view(metadata(ref), false);
    }

    // Only a lesson without student work or stored content disappears; everything else stays as
    // history.
    @Transactional
    public void delete(Actor actor, LessonRef ref) {
        lockTeacher(actor, ref);
        var usage = repository.usage(ref);
        if (usage.values().stream().anyMatch(count -> count > 0))
            throw new ApiFailure(
                    409,
                    "LESSON_IN_USE",
                    "The lesson has works, materials or drafts; remove them first or keep the lesson.");
        if (!repository.delete(ref)) throw WorkspaceAccess.missing();
    }

    // Adding a material makes the lesson prepared under one bundle; call inside the material
    // transaction after locking the card.
    public String prepare(Actor actor, LessonRef ref) {
        lockTeacher(actor, ref);
        var old = metadata(ref);
        if (old.bundleId() != null && old.status().equals("prepared")) return old.bundleId();
        String bundleId = old.bundleId() == null ? UUID.randomUUID().toString() : old.bundleId();
        if (!repository.update(
                old,
                old.title(),
                old.date(),
                old.time(),
                old.duration(),
                old.conductedAt(),
                "prepared",
                bundleId,
                old.revision())) throw conflict();
        return bundleId;
    }

    public LessonText text(Actor actor, LessonRef ref, TextKind kind, String audience) {
        requireReader(actor, ref.workspaceId(), ref.studentId(), ref.id());
        if (publicView(actor, audience) && kind == TextKind.teacherNotes)
            throw WorkspaceAccess.missing();
        return repository.text(ref, kind);
    }

    @Transactional
    public LessonText saveText(
            Actor actor, LessonRef ref, TextKind kind, String markdown, long expectedRevision) {
        lockTeacher(actor, ref);
        if (kind == null || markdown == null || markdown.length() > 200000 || expectedRevision < 1)
            throw new IllegalArgumentException("Invalid text.");
        if (!repository.save(ref, kind, markdown, expectedRevision)) throw conflict();
        return repository.text(ref, kind);
    }

    public Map<String, Object> dashboard(Actor actor, String w, String student, String audience) {
        publicView(actor, audience);
        return summary(
                students.get(actor, w, student, audience), repository.allSummaries(w, student));
    }

    // The teacher's list in one request: a page of cards with lesson count and focus lesson,
    // instead of one dashboard call per card.
    public Page<Map<String, Object>> dashboards(
            Actor actor, String w, int page, int size, String archived) {
        var cards = students.list(actor, w, page, size, null, archived);
        var studentIds = cards.items().stream().map(profile -> (String) profile.get("id")).toList();
        Map<String, List<LessonRepository.Summary>> byStudent = new HashMap<>();
        for (var m : repository.allSummariesForStudents(w, studentIds))
            byStudent
                    .computeIfAbsent(m.metadata().ref().studentId(), k -> new ArrayList<>())
                    .add(m);
        List<Map<String, Object>> items = new ArrayList<>();
        for (var profile : cards.items())
            items.add(
                    summary(
                            profile,
                            byStudent.getOrDefault((String) profile.get("id"), List.of())));
        return new Page<>(items, page, size, cards.total());
    }

    private Map<String, Object> summary(
            Map<String, Object> profile, List<LessonRepository.Summary> all) {
        Comparator<LessonRepository.Summary> ascending =
                Comparator.comparing((LessonRepository.Summary m) -> start(m.metadata()))
                        .thenComparing(m -> m.metadata().createdAt())
                        .thenComparing(m -> m.metadata().ref().id());
        Instant now = clock.instant();
        var sorted = all.stream().sorted(ascending).toList();
        var next =
                sorted.stream()
                        .filter(
                                m ->
                                        !start(m.metadata())
                                                .plusSeconds(m.metadata().duration() * 60L)
                                                .isBefore(now))
                        .findFirst();
        var focus = next.orElse(sorted.isEmpty() ? null : sorted.getLast());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", profile);
        result.put("lessonCount", all.size());
        result.put(
                "focus",
                focus == null
                        ? null
                        : Map.of("lesson", summaryView(focus), "upcoming", next.isPresent()));
        return result;
    }

    private static Instant start(LessonRepository.Metadata m) {
        return LocalDate.parse(m.date()).atTime(LocalTime.parse(m.time())).atZone(ZONE).toInstant();
    }

    private void lockTeacher(Actor actor, LessonRef ref) {
        students.lockTeacherCard(actor, ref.workspaceId(), ref.studentId());
        metadata(ref);
    }

    private LessonRepository.Metadata metadata(LessonRef ref) {
        return repository.find(ref).orElseThrow(WorkspaceAccess::missing);
    }

    private static Map<String, Object> metadataView(LessonRepository.Metadata m) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", m.ref().id());
        result.put("workspaceId", m.ref().workspaceId());
        result.put("studentId", m.ref().studentId());
        result.put("title", m.title());
        result.put("date", m.date());
        result.put("time", m.time());
        result.put("timeZone", ZONE.getId());
        result.put("duration", m.duration());
        result.put("status", m.status());
        result.put("bundleId", m.bundleId());
        result.put("revision", m.revision());
        result.put("createdAt", m.createdAt().toString());
        result.put("number", m.number());
        if (m.conductedAt() != null) result.put("conductedAt", m.conductedAt().toString());
        return result;
    }

    static Map<String, Object> summaryView(LessonRepository.Summary summary) {
        var result = metadataView(summary.metadata());
        result.put("hasStudentNotes", summary.hasStudentNotes());
        return result;
    }

    private Map<String, Object> view(LessonRepository.Metadata m, boolean publicView) {
        var result = metadataView(m);
        repository
                .texts(m.ref())
                .forEach(
                        (k, v) -> {
                            if (!publicView || k != TextKind.teacherNotes)
                                result.put(k.name(), v.markdown());
                        });
        return result;
    }

    private static boolean publicView(Actor actor, String audience) {
        if (audience != null && !audience.equals("student"))
            throw new IllegalArgumentException("Invalid audience.");
        return actor.role() == Actor.Role.STUDENT || audience != null;
    }

    private static String title(Object value) {
        if (!(value instanceof String s)) throw new IllegalArgumentException("Title required.");
        String trimmed =
                s.replaceAll(
                        "^[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+|[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+$",
                        "");
        if (trimmed.isEmpty() || trimmed.length() > 200)
            throw new IllegalArgumentException("Invalid title.");
        return trimmed;
    }

    static String date(Object value) {
        if (!(value instanceof String s) || !s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
            throw new IllegalArgumentException("Invalid date.");
        try {
            LocalDate.parse(s);
        } catch (DateTimeException invalid) {
            throw new IllegalArgumentException("Invalid date.");
        }
        return s;
    }

    private static String time(Object value) {
        if (!(value instanceof String s) || !s.matches("([01][0-9]|2[0-3]):[0-5][0-9]"))
            throw new IllegalArgumentException("Invalid time.");
        return s;
    }

    private static int duration(Object value) {
        long n = revision(value);
        if (n < 15 || n > 240) throw new IllegalArgumentException("Invalid duration.");
        return (int) n;
    }

    static long revision(Object value) {
        if (!(value instanceof Number n) || n.longValue() < 1 || n.doubleValue() != n.longValue())
            throw new IllegalArgumentException("Integer revision required.");
        return n.longValue();
    }

    static void checkFields(Map<String, Object> input, Set<String> allowed) {
        if (!allowed.containsAll(input.keySet()))
            throw new IllegalArgumentException("Unknown field.");
    }

    private static ApiFailure conflict() {
        return new ApiFailure(409, "REVISION_CONFLICT", "Lesson changed. Refresh before saving.");
    }
}
