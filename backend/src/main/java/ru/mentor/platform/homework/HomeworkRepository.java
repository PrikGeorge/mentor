package ru.mentor.platform.homework;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ru.mentor.platform.lessons.LessonRef;
import java.sql.*;
import java.util.*;

@Repository
public class HomeworkRepository {
    public record Stored(Submission submission,String blobId) {}
    private final JdbcTemplate jdbc;
    public HomeworkRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
    private Submission submission(ResultSet r)throws SQLException {
        Timestamp reviewed=r.getTimestamp("reviewed_at");
        return new Submission(r.getString("id"),r.getString("filename"),r.getLong("size"),r.getTimestamp("created_at").toInstant(),
            r.getString("comment"),r.getString("repository_url"),ReviewStatus.valueOf(r.getString("status")),r.getString("feedback"),reviewed==null?null:reviewed.toInstant(),r.getLong("revision"));
    }
    public List<Submission> list(LessonRef l,int page,int size){
        return jdbc.query("SELECT * FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",(r,n)->submission(r),l.workspaceId(),l.studentId(),l.id(),size,(long)page*size);
    }
    public long count(LessonRef l){return jdbc.queryForObject("SELECT count(*) FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=?",Long.class,l.workspaceId(),l.studentId(),l.id());}
    public Optional<Stored> find(LessonRef l,String id,boolean lock){
        return jdbc.query("SELECT * FROM homework_submission WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?"+(lock?" FOR UPDATE":""),(r,n)->new Stored(submission(r),r.getString("blob_id")),l.workspaceId(),l.studentId(),l.id(),id).stream().findFirst();
    }
    public void insert(LessonRef l,Submission s,String blob){
        jdbc.update("INSERT INTO homework_submission(workspace_id,student_id,lesson_id,id,blob_id,filename,size,created_at,comment,repository_url,status,feedback,revision) VALUES(?,?,?,?,?,?,?,?,?,?,'submitted','',1)",
            l.workspaceId(),l.studentId(),l.id(),s.id(),blob,s.filename(),s.size(),Timestamp.from(s.createdAt()),s.comment(),s.repositoryUrl());
    }
    public void review(LessonRef l,Submission s){
        jdbc.update("UPDATE homework_submission SET status=?,feedback=?,reviewed_at=?,revision=? WHERE workspace_id=? AND student_id=? AND lesson_id=? AND id=?",
            s.status().name(),s.feedback(),Timestamp.from(s.reviewedAt()),s.revision(),l.workspaceId(),l.studentId(),l.id(),s.id());
    }
}
