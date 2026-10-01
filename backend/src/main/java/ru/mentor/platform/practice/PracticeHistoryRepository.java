package ru.mentor.platform.practice;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.Page;

@Repository
public class PracticeHistoryRepository {
    public record Entry(String exerciseId, boolean active, boolean hasDraft, boolean hasAttempts, boolean hasArchives) {}

    private static final String HISTORY = """
        WITH history AS (
          SELECT a.exercise_id,a.active,
            EXISTS(SELECT 1 FROM practice_draft d WHERE d.workspace_id=a.workspace_id AND d.assignment_id=a.id) AS has_draft,
            EXISTS(SELECT 1 FROM practice_attempt t WHERE t.workspace_id=a.workspace_id AND t.assignment_id=a.id) AS has_attempts,
            EXISTS(SELECT 1 FROM practice_draft_archive r WHERE r.workspace_id=a.workspace_id AND r.assignment_id=a.id) AS has_archives
          FROM practice_assignment a
          WHERE a.workspace_id=? AND a.student_id=? AND a.lesson_id=?
        ), saved AS (SELECT * FROM history WHERE has_draft OR has_attempts OR has_archives)
        """;
    private final JdbcTemplate jdbc;
    public PracticeHistoryRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }

    public Page<Entry> list(LessonRef lesson, int page, int size) {
        long total=jdbc.queryForObject(HISTORY+"SELECT count(*) FROM saved",Long.class,lesson.workspaceId(),lesson.studentId(),lesson.id());
        var rows=jdbc.query(HISTORY+"SELECT * FROM saved ORDER BY exercise_id COLLATE \"C\" LIMIT ? OFFSET ?",
            (r,n)->new Entry(r.getString("exercise_id"),r.getBoolean("active"),r.getBoolean("has_draft"),r.getBoolean("has_attempts"),r.getBoolean("has_archives")),
            lesson.workspaceId(),lesson.studentId(),lesson.id(),size,(long)page*size);
        return new Page<>(rows,page,size,total);
    }
}
