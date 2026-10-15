package ru.mentor.platform.lessons;

import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class LessonRepository {
    private final JdbcTemplate jdbc;

    public LessonRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // number is the lesson's position in its student's calendar (date, time, creation, id
    // ascending), starting at 1.
    public record Metadata(
            LessonRef ref,
            String title,
            String date,
            String time,
            int duration,
            String status,
            String bundleId,
            long revision,
            Instant createdAt,
            Instant conductedAt,
            long number) {}

    public record Summary(Metadata metadata, boolean hasStudentNotes) {}

    private static final RowMapper<Metadata> MAPPER =
            (r, n) ->
                    new Metadata(
                            new LessonRef(
                                    r.getString("workspace_id"),
                                    r.getString("student_id"),
                                    r.getString("id")),
                            r.getString("title"),
                            r.getString("local_date"),
                            r.getString("local_time"),
                            r.getInt("duration"),
                            r.getString("status"),
                            r.getString("bundle_id"),
                            r.getLong("revision"),
                            r.getTimestamp("created_at").toInstant(),
                            r.getTimestamp("conducted_at") == null
                                    ? null
                                    : r.getTimestamp("conducted_at").toInstant(),
                            r.getLong("number"));
    private static final RowMapper<Summary> SUMMARY_MAPPER =
            (r, n) -> new Summary(MAPPER.mapRow(r, n), r.getBoolean("has_student_notes"));
    private static final String SELECT =
            "SELECT lesson.*,(SELECT count(*) FROM lesson o WHERE o.workspace_id=lesson.workspace_id AND o.student_id=lesson.student_id AND (o.local_date,o.local_time,o.created_at,o.id)<=(lesson.local_date,lesson.local_time,lesson.created_at,lesson.id)) AS number FROM lesson";
    // The browser previously used String.trim(); keep the same whitespace set without transferring
    // Markdown over JDBC.
    private static final String TRIM_WHITESPACE =
            "U&'\\0009\\000a\\000b\\000c\\000d\\0020\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff'";
    private static final String SUMMARY_SELECT =
            "SELECT lesson.*,row_number() OVER (PARTITION BY workspace_id,student_id ORDER BY local_date,local_time,created_at,id) AS number,"
                    + "EXISTS (SELECT 1 FROM lesson_text t WHERE t.workspace_id=lesson.workspace_id AND t.lesson_id=lesson.id AND t.kind='studentNotes' AND btrim(t.markdown,"
                    + TRIM_WHITESPACE
                    + ")<>'') AS has_student_notes FROM lesson";
    private static final String ORDER =
            " ORDER BY local_date DESC,local_time DESC,created_at DESC,id DESC";

    public Optional<Metadata> find(LessonRef ref) {
        return jdbc
                .query(
                        SELECT + " WHERE workspace_id=? AND student_id=? AND id=?",
                        MAPPER,
                        ref.workspaceId(),
                        ref.studentId(),
                        ref.id())
                .stream()
                .findFirst();
    }

    public List<Summary> list(String w, String student, int page, int size) {
        return jdbc.query(
                SUMMARY_SELECT
                        + " WHERE workspace_id=? AND student_id=?"
                        + ORDER
                        + " LIMIT ? OFFSET ?",
                SUMMARY_MAPPER,
                w,
                student,
                size,
                (long) page * size);
    }

    public List<Summary> allSummaries(String w, String student) {
        return jdbc.query(
                SUMMARY_SELECT + " WHERE workspace_id=? AND student_id=?" + ORDER,
                SUMMARY_MAPPER,
                w,
                student);
    }

    public List<Summary> allSummariesForStudents(String w, List<String> students) {
        if (students.isEmpty()) return List.of();
        List<Object> args = new ArrayList<>(List.of(w));
        args.addAll(students);
        return jdbc.query(
                SUMMARY_SELECT
                        + " WHERE workspace_id=? AND student_id IN ("
                        + String.join(",", Collections.nCopies(students.size(), "?"))
                        + ")"
                        + ORDER,
                SUMMARY_MAPPER,
                args.toArray());
    }

    public record ScheduleEntry(Summary summary, String studentName) {}

    // The teacher's calendar across active cards: numbers are counted over each card's whole
    // calendar first, then the date window is applied; the notes flag is computed only for the
    // window.
    public List<ScheduleEntry> schedule(String w, String from, String to) {
        return jdbc.query(
                "SELECT lesson.*,n.number,p.name AS student_name,EXISTS (SELECT 1 FROM lesson_text t WHERE t.workspace_id=lesson.workspace_id AND t.lesson_id=lesson.id AND t.kind='studentNotes' AND btrim(t.markdown,"
                        + TRIM_WHITESPACE
                        + ")<>'') AS has_student_notes FROM lesson"
                        + " JOIN (SELECT student_id,id,row_number() OVER (PARTITION BY student_id ORDER BY local_date,local_time,created_at,id) AS number FROM lesson WHERE workspace_id=?) n ON n.student_id=lesson.student_id AND n.id=lesson.id"
                        + " JOIN student_profile p ON p.workspace_id=lesson.workspace_id AND p.id=lesson.student_id AND p.archived_at IS NULL"
                        + " WHERE lesson.workspace_id=? AND lesson.local_date BETWEEN ? AND ?"
                        + " ORDER BY lesson.local_date,lesson.local_time,lesson.created_at,lesson.id",
                (r, n) ->
                        new ScheduleEntry(SUMMARY_MAPPER.mapRow(r, n), r.getString("student_name")),
                w,
                w,
                from,
                to);
    }

    public long count(String w, String student) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM lesson WHERE workspace_id=? AND student_id=?",
                Long.class,
                w,
                student);
    }

    public Metadata create(
            String w,
            String student,
            String title,
            String date,
            String time,
            int duration,
            Instant now) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,created_at) VALUES (?,?,?,?,?,?,?,?)",
                w,
                student,
                id,
                title,
                date,
                time,
                duration,
                Timestamp.from(now));
        for (TextKind kind : TextKind.values())
            jdbc.update(
                    "INSERT INTO lesson_text(workspace_id,lesson_id,kind) VALUES (?,?,?)",
                    w,
                    id,
                    kind.name());
        return find(new LessonRef(w, student, id)).orElseThrow();
    }

    public boolean update(
            Metadata old,
            String title,
            String date,
            String time,
            int duration,
            Instant conductedAt,
            long revision) {
        return update(
                old,
                title,
                date,
                time,
                duration,
                conductedAt,
                old.status(),
                old.bundleId(),
                revision);
    }

    public boolean update(
            Metadata old,
            String title,
            String date,
            String time,
            int duration,
            Instant conductedAt,
            String status,
            String bundleId,
            long revision) {
        return jdbc.update(
                        "UPDATE lesson SET title=?,local_date=?,local_time=?,duration=?,conducted_at=?,status=?,bundle_id=?,revision=revision+1 WHERE workspace_id=? AND student_id=? AND id=? AND revision=?",
                        title,
                        date,
                        time,
                        duration,
                        conductedAt == null ? null : Timestamp.from(conductedAt),
                        status,
                        bundleId,
                        old.ref().workspaceId(),
                        old.ref().studentId(),
                        old.ref().id(),
                        revision)
                == 1;
    }

    // Rows that would be orphaned or that carry student work; a lesson with any of them is not
    // deletable.
    public Map<String, Long> usage(LessonRef ref) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (String table :
                List.of(
                        "homework_submission",
                        "material",
                        "stored_blob",
                        "blob_reservation",
                        "code_comment"))
            out.put(
                    table,
                    jdbc.queryForObject(
                            "SELECT count(*) FROM "
                                    + table
                                    + " WHERE workspace_id=? AND student_id=? AND lesson_id=?",
                            Long.class,
                            ref.workspaceId(),
                            ref.studentId(),
                            ref.id()));
        // Drafts, their archives and attempts hang off the lesson's assignments.
        for (String table : List.of("practice_attempt", "practice_draft", "practice_draft_archive"))
            out.put(
                    table,
                    jdbc.queryForObject(
                            "SELECT count(*) FROM "
                                    + table
                                    + " t JOIN practice_assignment a ON a.workspace_id=t.workspace_id AND a.id=t.assignment_id WHERE a.workspace_id=? AND a.student_id=? AND a.lesson_id=?",
                            Long.class,
                            ref.workspaceId(),
                            ref.studentId(),
                            ref.id()));
        return out;
    }

    public boolean delete(LessonRef ref) {
        jdbc.update(
                "DELETE FROM practice_assignment WHERE workspace_id=? AND student_id=? AND lesson_id=?",
                ref.workspaceId(),
                ref.studentId(),
                ref.id());
        jdbc.update(
                "DELETE FROM practice_assignment_set WHERE workspace_id=? AND student_id=? AND lesson_id=?",
                ref.workspaceId(),
                ref.studentId(),
                ref.id());
        jdbc.update(
                "DELETE FROM lesson_text WHERE workspace_id=? AND lesson_id=?",
                ref.workspaceId(),
                ref.id());
        return jdbc.update(
                        "DELETE FROM lesson WHERE workspace_id=? AND student_id=? AND id=?",
                        ref.workspaceId(),
                        ref.studentId(),
                        ref.id())
                == 1;
    }

    public LessonText text(LessonRef ref, TextKind kind) {
        return jdbc
                .query(
                        "SELECT markdown,revision FROM lesson_text WHERE workspace_id=? AND lesson_id=? AND kind=?",
                        (r, n) -> new LessonText(kind, r.getString(1), r.getLong(2)),
                        ref.workspaceId(),
                        ref.id(),
                        kind.name())
                .stream()
                .findFirst()
                .orElseThrow(ru.mentor.platform.workspaces.WorkspaceAccess::missing);
    }

    public Map<TextKind, LessonText> texts(LessonRef ref) {
        Map<TextKind, LessonText> result = new EnumMap<>(TextKind.class);
        jdbc.query(
                "SELECT kind,markdown,revision FROM lesson_text WHERE workspace_id=? AND lesson_id=?",
                (RowCallbackHandler)
                        r -> {
                            var kind = TextKind.valueOf(r.getString(1));
                            result.put(kind, new LessonText(kind, r.getString(2), r.getLong(3)));
                        },
                ref.workspaceId(),
                ref.id());
        return result;
    }

    public boolean save(LessonRef ref, TextKind kind, String markdown, long revision) {
        return jdbc.update(
                        "UPDATE lesson_text SET markdown=?,revision=revision+1 WHERE workspace_id=? AND lesson_id=? AND kind=? AND revision=?",
                        markdown,
                        ref.workspaceId(),
                        ref.id(),
                        kind.name(),
                        revision)
                == 1;
    }
}
