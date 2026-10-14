package ru.mentor.platform.journal;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.*;
import java.time.Instant;
import java.util.List;

/** Read model of the exchange between a student and the teacher: submissions, reviews, trainer attempts and held lessons. */
@Repository
public class MoveRepository {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Move(String kind,String side,Instant at,String lessonId,String lessonTitle,String refId,String subject,String detail,
                       String status,String grade,Integer passed,Integer total,Integer ordinal) {}
    // Every branch is scoped by workspace and student; submission ordinals count all works of their lesson.
    private static final String MOVES="""
        WITH sub AS (
          SELECT h.*,row_number() OVER (PARTITION BY h.lesson_id ORDER BY h.created_at,h.id) AS ordinal
          FROM homework_submission h WHERE h.workspace_id=? AND h.student_id=?
        )
        SELECT * FROM (
          SELECT 'homework' AS kind,'student' AS side,s.created_at AS at,s.lesson_id,l.title AS lesson_title,s.id AS ref_id,s.filename AS subject,s.comment AS detail,
                 s.status,NULL::text AS grade,NULL::int AS passed,NULL::int AS total,s.ordinal::int AS ordinal
          FROM sub s JOIN lesson l ON l.workspace_id=s.workspace_id AND l.student_id=s.student_id AND l.id=s.lesson_id
          UNION ALL
          SELECT 'review','teacher',s.reviewed_at,s.lesson_id,l.title,s.id,s.filename,left(s.feedback,300),s.status,s.grade,NULL,NULL,s.ordinal::int
          FROM sub s JOIN lesson l ON l.workspace_id=s.workspace_id AND l.student_id=s.student_id AND l.id=s.lesson_id WHERE s.reviewed_at IS NOT NULL
          UNION ALL
          SELECT 'attempt','student',t.created_at,a.lesson_id,l.title,t.id,COALESCE(r.public_json->>'title',t.exercise_id),t.mode,
                 COALESCE(t.result->>'status',t.job_state),NULL,(t.result->>'passed')::int,(t.result->>'total')::int,NULL
          FROM practice_attempt t JOIN practice_assignment a ON a.workspace_id=t.workspace_id AND a.id=t.assignment_id
          JOIN lesson l ON l.workspace_id=a.workspace_id AND l.student_id=a.student_id AND l.id=a.lesson_id
          LEFT JOIN practice_exercise e ON e.workspace_id=t.workspace_id AND e.id=t.exercise_id
          LEFT JOIN practice_exercise_revision r ON r.workspace_id=e.workspace_id AND r.exercise_id=e.id AND r.revision_key=e.current_key
          WHERE t.workspace_id=? AND a.student_id=?
          UNION ALL
          SELECT 'conducted','teacher',l.conducted_at,l.id,l.title,l.id,NULL,NULL,NULL,NULL,NULL,NULL,NULL
          FROM lesson l WHERE l.workspace_id=? AND l.student_id=? AND l.conducted_at IS NOT NULL
        ) moves WHERE (?::varchar IS NULL OR lesson_id=?)
        """;
    private final JdbcTemplate jdbc;
    public MoveRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public List<Move> moves(String workspace,String student,String lesson,int page,int size){
        return jdbc.query(MOVES+" ORDER BY at DESC,kind,ref_id DESC LIMIT ? OFFSET ?",(r,n)->move(r),workspace,student,workspace,student,workspace,student,lesson,lesson,size,(long)page*size);
    }
    public long count(String workspace,String student,String lesson){
        return jdbc.queryForObject("SELECT count(*) FROM ("+MOVES+") counted",Long.class,workspace,student,workspace,student,workspace,student,lesson,lesson);
    }
    private static Move move(ResultSet r)throws SQLException {
        return new Move(r.getString("kind"),r.getString("side"),r.getTimestamp("at").toInstant(),r.getString("lesson_id"),r.getString("lesson_title"),r.getString("ref_id"),
            r.getString("subject"),r.getString("detail"),r.getString("status"),r.getString("grade"),integer(r,"passed"),integer(r,"total"),integer(r,"ordinal"));
    }
    private static Integer integer(ResultSet r,String column)throws SQLException {int value=r.getInt(column);return r.wasNull()?null:value;}
}
