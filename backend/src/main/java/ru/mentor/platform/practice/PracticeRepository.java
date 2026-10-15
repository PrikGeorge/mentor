package ru.mentor.platform.practice;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ru.mentor.platform.lessons.LessonRef;

import tools.jackson.databind.*;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Repository
public class PracticeRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = PracticeJson.MAPPER;

    public PracticeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private JsonNode parse(String s) {
        return json.readTree(s);
    }

    public String encode(Object v) {
        return json.writeValueAsString(v);
    }

    public Optional<PublishedExercise> current(String w, String id, boolean lock) {
        if (lock)
            jdbc.query(
                    "SELECT id FROM practice_exercise WHERE workspace_id=? AND id=? FOR UPDATE",
                    (r, n) -> r.getString(1),
                    w,
                    id);
        return jdbc
                .query(
                        "SELECT r.* FROM practice_exercise e JOIN practice_exercise_revision r ON r.workspace_id=e.workspace_id AND r.exercise_id=e.id AND r.revision_key=e.current_key WHERE e.workspace_id=? AND e.id=?",
                        (r, n) -> snapshot(r),
                        w,
                        id)
                .stream()
                .findFirst();
    }

    private PublishedExercise snapshot(ResultSet r) throws SQLException {
        return new PublishedExercise(
                r.getString("exercise_id"),
                ExerciseRevision.fromJson(parse(r.getString("revision_json"))),
                parse(r.getString("public_json")),
                parse(r.getString("private_json")),
                parse(r.getString("environment_json")),
                parse(r.getString("provenance_json")));
    }

    public Optional<String> snapshotHash(String w, String id, String key) {
        return jdbc
                .query(
                        "SELECT snapshot_hash FROM practice_exercise_revision WHERE workspace_id=? AND exercise_id=? AND revision_key=?",
                        (r, n) -> r.getString(1),
                        w,
                        id,
                        key)
                .stream()
                .findFirst();
    }

    public void publish(String w, PublishedExercise e, String hash, Instant now) {
        jdbc.update(
                "INSERT INTO practice_exercise(workspace_id,id) VALUES (?,?) ON CONFLICT DO NOTHING",
                w,
                e.exerciseId());
        jdbc.update(
                "INSERT INTO practice_exercise_revision(workspace_id,exercise_id,revision_key,revision_json,public_json,private_json,environment_json,provenance_json,snapshot_hash,created_at) VALUES (?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,?)",
                w,
                e.exerciseId(),
                e.revision().key(),
                encode(e.revision().toJson()),
                encode(e.publicProjection()),
                encode(e.privateExercise()),
                encode(e.environment()),
                encode(e.provenance()),
                hash,
                Timestamp.from(now));
        jdbc.update(
                "UPDATE practice_exercise SET current_key=? WHERE workspace_id=? AND id=?",
                e.revision().key(),
                w,
                e.exerciseId());
    }

    public List<JsonNode> catalog(String w, String student, int page, int size) {
        return jdbc.query(
                "SELECT r.public_json FROM practice_exercise e JOIN practice_exercise_revision r ON r.workspace_id=e.workspace_id AND r.exercise_id=e.id AND r.revision_key=e.current_key WHERE e.workspace_id=? AND (?::varchar IS NULL OR EXISTS(SELECT 1 FROM practice_assignment a WHERE a.workspace_id=e.workspace_id AND a.exercise_id=e.id AND a.student_id=? AND a.active)) ORDER BY e.id LIMIT ? OFFSET ?",
                (r, n) -> parse(r.getString(1)),
                w,
                student,
                student,
                size,
                (long) page * size);
    }

    public long catalogCount(String w, String student) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_exercise e WHERE workspace_id=? AND current_key IS NOT NULL AND (?::varchar IS NULL OR EXISTS(SELECT 1 FROM practice_assignment a WHERE a.workspace_id=e.workspace_id AND a.exercise_id=e.id AND a.student_id=? AND a.active))",
                Long.class,
                w,
                student,
                student);
    }

    public long setRevision(LessonRef l, boolean lock) {
        if (lock)
            jdbc.update(
                    "INSERT INTO practice_assignment_set(workspace_id,student_id,lesson_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",
                    l.workspaceId(),
                    l.studentId(),
                    l.id());
        return jdbc
                .query(
                        "SELECT revision FROM practice_assignment_set WHERE workspace_id=? AND student_id=? AND lesson_id=?"
                                + (lock ? " FOR UPDATE" : ""),
                        (r, n) -> r.getLong(1),
                        l.workspaceId(),
                        l.studentId(),
                        l.id())
                .stream()
                .findFirst()
                .orElse(0L);
    }

    public void bumpSet(LessonRef l) {
        jdbc.update(
                "UPDATE practice_assignment_set SET revision=revision+1 WHERE workspace_id=? AND student_id=? AND lesson_id=?",
                l.workspaceId(),
                l.studentId(),
                l.id());
    }

    private AssignmentRef assignment(ResultSet r) throws SQLException {
        return new AssignmentRef(
                r.getString("workspace_id"),
                r.getString("student_id"),
                r.getString("lesson_id"),
                r.getString("id"),
                r.getString("exercise_id"),
                Placement.from(r.getString("placement")),
                r.getBoolean("active"));
    }

    public List<AssignmentRef> assignments(LessonRef l) {
        return jdbc.query(
                "SELECT * FROM practice_assignment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND active ORDER BY position,id",
                (r, n) -> assignment(r),
                l.workspaceId(),
                l.studentId(),
                l.id());
    }

    public Optional<AssignmentRef> byExercise(LessonRef l, String exercise, boolean lock) {
        return jdbc
                .query(
                        "SELECT * FROM practice_assignment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND exercise_id=?"
                                + (lock ? " FOR UPDATE" : ""),
                        (r, n) -> assignment(r),
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        exercise)
                .stream()
                .findFirst();
    }

    public Optional<AssignmentRef> byId(LessonRef l, String id) {
        return jdbc
                .query(
                        "SELECT * FROM practice_assignment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?",
                        (r, n) -> assignment(r),
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        id)
                .stream()
                .findFirst();
    }

    public void deactivate(LessonRef l) {
        jdbc.update(
                "UPDATE practice_assignment SET active=false WHERE workspace_id=? AND lesson_id=?",
                l.workspaceId(),
                l.id());
    }

    public void activate(LessonRef l, String exercise, Placement placement, int position) {
        jdbc.update(
                "INSERT INTO practice_assignment(workspace_id,student_id,lesson_id,id,exercise_id,placement,active,position) VALUES (?,?,?,?,?,?,true,?) ON CONFLICT(workspace_id,lesson_id,exercise_id) DO UPDATE SET placement=EXCLUDED.placement,active=true,position=EXCLUDED.position",
                l.workspaceId(),
                l.studentId(),
                l.id(),
                UUID.randomUUID().toString(),
                exercise,
                placement.wire(),
                position);
    }

    public Optional<Draft> draft(AssignmentRef a, boolean lock) {
        return jdbc
                .query(
                        "SELECT * FROM practice_draft WHERE workspace_id=? AND assignment_id=?"
                                + (lock ? " FOR UPDATE" : ""),
                        (r, n) ->
                                new Draft(
                                        a.exerciseId(),
                                        ExerciseRevision.fromJson(
                                                parse(r.getString("exercise_revision"))),
                                        r.getLong("revision"),
                                        SourceFiles.fromJson(parse(r.getString("files"))),
                                        r.getTimestamp("updated_at").toInstant()),
                        a.workspaceId(),
                        a.id())
                .stream()
                .findFirst();
    }

    public void save(AssignmentRef a, Draft d) {
        jdbc.update(
                "INSERT INTO practice_draft(workspace_id,assignment_id,exercise_revision,revision,files,updated_at) VALUES (?,?,?::jsonb,?,?::jsonb,?) ON CONFLICT(workspace_id,assignment_id) DO UPDATE SET exercise_revision=EXCLUDED.exercise_revision,revision=EXCLUDED.revision,files=EXCLUDED.files,updated_at=EXCLUDED.updated_at",
                a.workspaceId(),
                a.id(),
                encode(d.exerciseRevision().toJson()),
                d.revision(),
                encode(d.files()),
                Timestamp.from(d.updatedAt()));
    }

    public void archive(AssignmentRef a, Draft d, Instant now) {
        jdbc.update(
                "INSERT INTO practice_draft_archive(workspace_id,id,assignment_id,exercise_revision,revision,files,updated_at,archived_at,reason) VALUES (?,?,?,?::jsonb,?,?::jsonb,?,?,'exercise_revision_changed')",
                a.workspaceId(),
                UUID.randomUUID().toString(),
                a.id(),
                encode(d.exerciseRevision().toJson()),
                d.revision(),
                encode(d.files()),
                Timestamp.from(d.updatedAt()),
                Timestamp.from(now));
    }

    private Map<String, Object> archive(ResultSet r, boolean detail) throws SQLException {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", r.getString("id"));
        out.put("assignmentId", r.getString("assignment_id"));
        out.put("exerciseId", r.getString("exercise_id"));
        out.put("exerciseRevision", parse(r.getString("exercise_revision")));
        out.put("revision", r.getLong("revision"));
        out.put("updatedAt", r.getTimestamp("updated_at").toInstant());
        Timestamp archived = r.getTimestamp("archived_at");
        out.put("archivedAt", archived == null ? null : archived.toInstant());
        out.put("reason", r.getString("reason"));
        if (detail) out.put("files", parse(r.getString("files")));
        return out;
    }

    public List<Map<String, Object>> archives(LessonRef l, String exercise, int page, int size) {
        return jdbc.query(
                "SELECT h.*,a.exercise_id FROM practice_draft_archive h JOIN practice_assignment a ON a.workspace_id=h.workspace_id AND a.id=h.assignment_id WHERE a.workspace_id=? AND a.student_id=? AND a.lesson_id=? AND (?::varchar IS NULL OR a.exercise_id=?) ORDER BY h.updated_at DESC,h.id DESC LIMIT ? OFFSET ?",
                (r, n) -> archive(r, false),
                l.workspaceId(),
                l.studentId(),
                l.id(),
                exercise,
                exercise,
                size,
                (long) page * size);
    }

    public long archiveCount(LessonRef l, String exercise) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_draft_archive h JOIN practice_assignment a ON a.workspace_id=h.workspace_id AND a.id=h.assignment_id WHERE a.workspace_id=? AND a.student_id=? AND a.lesson_id=? AND (?::varchar IS NULL OR a.exercise_id=?)",
                Long.class,
                l.workspaceId(),
                l.studentId(),
                l.id(),
                exercise,
                exercise);
    }

    public Optional<Map<String, Object>> archive(LessonRef l, String id) {
        return jdbc
                .query(
                        "SELECT h.*,a.exercise_id FROM practice_draft_archive h JOIN practice_assignment a ON a.workspace_id=h.workspace_id AND a.id=h.assignment_id WHERE a.workspace_id=? AND a.student_id=? AND a.lesson_id=? AND h.id=?",
                        (r, n) -> archive(r, true),
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        id)
                .stream()
                .findFirst();
    }
}
