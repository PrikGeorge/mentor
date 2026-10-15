package ru.mentor.platform.comments;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ru.mentor.platform.lessons.LessonRef;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class CodeCommentRepository {
    public record Comment(
            String id,
            String targetKind,
            String targetId,
            String file,
            int line,
            @JsonInclude(JsonInclude.Include.NON_NULL) String grade,
            String body,
            String variant,
            Instant createdAt) {}

    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    public CodeCommentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Comment> list(LessonRef l, String kind, String target) {
        return jdbc.query(
                "SELECT * FROM code_comment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND target_kind=? AND target_id=? ORDER BY file,line,created_at,id",
                (r, n) ->
                        new Comment(
                                r.getString("id"),
                                r.getString("target_kind"),
                                r.getString("target_id"),
                                r.getString("file"),
                                r.getInt("line"),
                                r.getString("grade"),
                                r.getString("body"),
                                r.getString("variant"),
                                r.getTimestamp("created_at").toInstant()),
                l.workspaceId(),
                l.studentId(),
                l.id(),
                kind,
                target);
    }

    public long count(LessonRef l, String kind, String target) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM code_comment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND target_kind=? AND target_id=?",
                Long.class,
                l.workspaceId(),
                l.studentId(),
                l.id(),
                kind,
                target);
    }

    public void insert(LessonRef l, Comment c) {
        jdbc.update(
                "INSERT INTO code_comment(workspace_id,student_id,lesson_id,target_kind,target_id,id,file,line,grade,body,variant,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                l.workspaceId(),
                l.studentId(),
                l.id(),
                c.targetKind(),
                c.targetId(),
                c.id(),
                c.file(),
                c.line(),
                c.grade(),
                c.body(),
                c.variant(),
                Timestamp.from(c.createdAt()));
    }

    public boolean delete(LessonRef l, String id) {
        return jdbc.update(
                        "DELETE FROM code_comment WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?",
                        l.workspaceId(),
                        l.studentId(),
                        l.id(),
                        id)
                == 1;
    }

    /** Exact files of an attempt made in this lesson of this card, or empty when it belongs elsewhere. */
    public Optional<Map<String, String>> attemptFiles(LessonRef l, String attempt) {
        return jdbc
                .query(
                        "SELECT t.files::text FROM practice_attempt t JOIN practice_assignment a ON a.workspace_id=t.workspace_id AND a.id=t.assignment_id WHERE t.workspace_id=? AND t.id=? AND a.student_id=? AND a.lesson_id=?",
                        (r, n) -> {
                            Map<String, String> files = new LinkedHashMap<>();
                            JsonNode node = json.readTree(r.getString(1));
                            node.propertyNames()
                                    .forEach(name -> files.put(name, node.get(name).asText()));
                            return files;
                        },
                        l.workspaceId(),
                        attempt,
                        l.studentId(),
                        l.id())
                .stream()
                .findFirst();
    }
}
