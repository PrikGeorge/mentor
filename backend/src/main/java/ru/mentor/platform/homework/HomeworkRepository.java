package ru.mentor.platform.homework;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ru.mentor.platform.lessons.LessonRef;

import java.sql.*;
import java.util.*;

@Repository
public class HomeworkRepository {
    public record Stored(Submission submission, String blobId) {}

    private final JdbcTemplate jdbc;

    public HomeworkRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private Submission submission(ResultSet r) throws SQLException {
        Timestamp reviewed = r.getTimestamp("reviewed_at");
        return new Submission(
                r.getString("id"),
                r.getString("filename"),
                r.getLong("size"),
                r.getTimestamp("created_at").toInstant(),
                r.getString("comment"),
                r.getString("repository_url"),
                ReviewStatus.valueOf(r.getString("status")),
                r.getString("feedback"),
                reviewed == null ? null : reviewed.toInstant(),
                r.getLong("revision"),
                r.getString("grade") == null ? null : Grade.valueOf(r.getString("grade")));
    }

    public List<Submission> list(LessonRef l, int page, int size) {
        return jdbc.query(
                "SELECT * FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                (r, n) -> submission(r),
                l.workspaceId(),
                l.studentId(),
                l.id(),
                size,
                (long) page * size);
    }

    public long count(LessonRef l) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=?",
                Long.class,
                l.workspaceId(),
                l.studentId(),
                l.id());
    }

    public Optional<Stored> find(LessonRef l, String id, boolean lock) {
        return jdbc
                .query(
                        "SELECT * FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?"
                                + (lock ? " FOR UPDATE" : ""),
                        (r, n) -> new Stored(submission(r), r.getString("blob_id")),
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        id)
                .stream()
                .findFirst();
    }

    public void insert(LessonRef l, Submission s, String blob) {
        insert(l, s, blob, null, null);
    }

    public void insert(
            LessonRef l, Submission s, String blob, String idempotencyKey, String payloadHash) {
        jdbc.update(
                "INSERT INTO homework_submission(workspace_id,student_id,lesson_id,id,blob_id,filename,size,created_at,comment,repository_url,status,feedback,revision,idempotency_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,'submitted','',1,?,?)",
                l.workspaceId(),
                l.studentId(),
                l.id(),
                s.id(),
                blob,
                s.filename(),
                s.size(),
                Timestamp.from(s.createdAt()),
                s.comment(),
                s.repositoryUrl(),
                idempotencyKey,
                payloadHash);
    }

    public record Replay(Submission submission, String payloadHash) {}

    // The earlier work created under this key within the same lesson, if any; the caller compares
    // the payload hash.
    public Optional<Replay> replay(LessonRef l, String idempotencyKey) {
        return jdbc
                .query(
                        "SELECT * FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=? AND idempotency_key=?",
                        (r, n) -> new Replay(submission(r), r.getString("payload_hash")),
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        idempotencyKey)
                .stream()
                .findFirst();
    }

    // An exchange is a homework file, or a submitted trainer attempt of an active
    // homework-placement exercise; the teacher's first
    // line comment on that attempt is the mentor's answer. Both branches are scoped by workspace
    // (two parameters).
    private static final String EXCHANGES =
            """
        SELECT h.workspace_id,h.student_id,h.lesson_id,h.id,'homework' AS kind,h.filename,h.comment,h.status,h.created_at,h.reviewed_at
        FROM homework_submission h WHERE h.workspace_id=?
        UNION ALL
        SELECT t.workspace_id,a.student_id,a.lesson_id,t.id,'attempt',COALESCE(r.public_json->>'title',t.exercise_id),'',
               CASE WHEN c.replied_at IS NULL THEN 'submitted' ELSE 'reviewed' END,t.created_at,c.replied_at
        FROM practice_attempt t JOIN practice_assignment a ON a.workspace_id=t.workspace_id AND a.id=t.assignment_id
        LEFT JOIN practice_exercise e ON e.workspace_id=t.workspace_id AND e.id=t.exercise_id
        LEFT JOIN practice_exercise_revision r ON r.workspace_id=e.workspace_id AND r.exercise_id=e.id AND r.revision_key=e.current_key
        LEFT JOIN LATERAL (SELECT min(cc.created_at) AS replied_at FROM code_comment cc WHERE cc.workspace_id=t.workspace_id AND cc.target_kind='attempt' AND cc.target_id=t.id) c ON true
        WHERE t.workspace_id=? AND a.placement='homework' AND a.active AND t.mode='submit'
        """;

    public List<HomeworkTurns.LessonTurn> lessonTurns(
            String workspace, String student, int page, int size) {
        return jdbc.query(
                "SELECT * FROM (SELECT DISTINCT ON (lesson_id) lesson_id,id,kind,filename,status,created_at,reviewed_at FROM ("
                        + EXCHANGES
                        + ") x WHERE student_id=? ORDER BY lesson_id,created_at DESC,id DESC) latest ORDER BY created_at DESC,lesson_id DESC LIMIT ? OFFSET ?",
                (r, n) ->
                        new HomeworkTurns.LessonTurn(
                                r.getString("lesson_id"),
                                r.getString("id"),
                                r.getString("kind"),
                                r.getString("filename"),
                                ReviewStatus.valueOf(r.getString("status")),
                                r.getTimestamp("created_at").toInstant(),
                                instant(r, "reviewed_at")),
                workspace,
                workspace,
                student,
                size,
                (long) page * size);
    }

    public long countLessonTurns(String workspace, String student) {
        return jdbc.queryForObject(
                "SELECT count(DISTINCT lesson_id) FROM (" + EXCHANGES + ") x WHERE student_id=?",
                Long.class,
                workspace,
                workspace,
                student);
    }

    // Per lesson only the latest exchange counts; per student the oldest one awaiting review wins
    // over the latest reviewed exchange.
    public List<HomeworkTurns.StudentTurn> studentTurns(String workspace, int page, int size) {
        return jdbc.query(
                """
            WITH latest AS (
              SELECT DISTINCT ON (student_id,lesson_id) student_id,lesson_id,id,kind,filename,comment,status,created_at,reviewed_at
              FROM ("""
                        + EXCHANGES
                        + """
              ) x ORDER BY student_id,lesson_id,created_at DESC,id DESC
            ), ranked AS (
              SELECT latest.*,count(*) FILTER (WHERE status='submitted') OVER (PARTITION BY student_id) AS awaiting,
                row_number() OVER (PARTITION BY student_id ORDER BY (status='submitted') DESC,CASE WHEN status='submitted' THEN created_at END ASC,created_at DESC,id DESC) AS position
              FROM latest
            )
            SELECT r.*,p.name AS student_name,l.title AS lesson_title,l.local_date AS lesson_date
            FROM ranked r JOIN student_profile p ON p.workspace_id=? AND p.id=r.student_id AND p.archived_at IS NULL
            JOIN lesson l ON l.workspace_id=? AND l.student_id=r.student_id AND l.id=r.lesson_id
            WHERE r.position=1
            ORDER BY (r.status='submitted') DESC,CASE WHEN r.status='submitted' THEN r.created_at END ASC,r.created_at DESC,r.student_id
            LIMIT ? OFFSET ?""",
                (r, n) ->
                        new HomeworkTurns.StudentTurn(
                                r.getString("student_id"),
                                r.getString("student_name"),
                                r.getString("lesson_id"),
                                r.getString("lesson_title"),
                                r.getString("lesson_date"),
                                r.getString("id"),
                                r.getString("kind"),
                                r.getString("filename"),
                                r.getString("comment"),
                                ReviewStatus.valueOf(r.getString("status")),
                                r.getTimestamp("created_at").toInstant(),
                                instant(r, "reviewed_at"),
                                r.getLong("awaiting")),
                workspace,
                workspace,
                workspace,
                workspace,
                size,
                (long) page * size);
    }

    public long countStudentTurns(String workspace) {
        return jdbc.queryForObject(
                "SELECT count(DISTINCT x.student_id) FROM ("
                        + EXCHANGES
                        + ") x JOIN student_profile p ON p.workspace_id=x.workspace_id AND p.id=x.student_id AND p.archived_at IS NULL",
                Long.class,
                workspace,
                workspace);
    }

    private static java.time.Instant instant(ResultSet r, String column) throws SQLException {
        Timestamp value = r.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    public void review(LessonRef l, Submission s) {
        jdbc.update(
                "UPDATE homework_submission SET status=?,feedback=?,reviewed_at=?,revision=?,grade=? WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?",
                s.status().name(),
                s.feedback(),
                Timestamp.from(s.reviewedAt()),
                s.revision(),
                s.grade() == null ? null : s.grade().name(),
                l.workspaceId(),
                l.studentId(),
                l.id(),
                s.id());
    }
}
