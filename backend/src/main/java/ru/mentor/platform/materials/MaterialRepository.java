package ru.mentor.platform.materials;
import org.springframework.stereotype.Repository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import java.util.*;

@Repository
public class MaterialRepository {
    public record Metadata(String id,String workspaceId,String studentId,String lessonId,String bundleId,String audience,String kind,String contentKey,String filename,String contentType,String title,String blobId,boolean teacherCode) {}
    public record Stored(Metadata metadata,String payload) {}
    private final JdbcTemplate jdbc;
    public MaterialRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
    private static final String COLUMNS="id,workspace_id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,blob_id,coalesce(payload->'teacher'='true'::jsonb,false) AS teacher_code";
    private static final RowMapper<Metadata> META=(r,n)->new Metadata(r.getString("id"),r.getString("workspace_id"),r.getString("student_id"),r.getString("lesson_id"),r.getString("bundle_id"),r.getString("audience"),r.getString("kind"),r.getString("content_key"),r.getString("filename"),r.getString("content_type"),r.getString("title"),r.getString("blob_id"),r.getBoolean("teacher_code"));
    public Optional<Stored> find(String workspace,String id){return jdbc.query("SELECT "+COLUMNS+",payload::text AS content FROM material WHERE workspace_id=? AND id=?",(r,n)->new Stored(META.mapRow(r,n),r.getString("content")),workspace,id).stream().findFirst();}
    public List<Metadata> list(String workspace,String student,String lesson){return jdbc.query("SELECT "+COLUMNS+" FROM material WHERE workspace_id=? AND student_id=? AND lesson_id IS NOT DISTINCT FROM ? ORDER BY id",META,workspace,student,lesson);}
}
