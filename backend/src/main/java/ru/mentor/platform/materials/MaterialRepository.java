package ru.mentor.platform.materials;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.*;

@Repository
public class MaterialRepository {
    public record Metadata(
            String id,
            String workspaceId,
            String studentId,
            String lessonId,
            String bundleId,
            String audience,
            String kind,
            String contentKey,
            String filename,
            String contentType,
            String title,
            String blobId,
            boolean teacherCode) {}

    public record Stored(Metadata metadata, String payload) {}

    private final JdbcTemplate jdbc;

    public MaterialRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLUMNS =
            "id,workspace_id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,blob_id,coalesce(payload->'teacher'='true'::jsonb,false) AS teacher_code";
    private static final RowMapper<Metadata> META =
            (r, n) ->
                    new Metadata(
                            r.getString("id"),
                            r.getString("workspace_id"),
                            r.getString("student_id"),
                            r.getString("lesson_id"),
                            r.getString("bundle_id"),
                            r.getString("audience"),
                            r.getString("kind"),
                            r.getString("content_key"),
                            r.getString("filename"),
                            r.getString("content_type"),
                            r.getString("title"),
                            r.getString("blob_id"),
                            r.getBoolean("teacher_code"));

    public Optional<Stored> find(String workspace, String id) {
        return jdbc
                .query(
                        "SELECT "
                                + COLUMNS
                                + ",payload::text AS content FROM material WHERE workspace_id=? AND id=?",
                        (r, n) -> new Stored(META.mapRow(r, n), r.getString("content")),
                        workspace,
                        id)
                .stream()
                .findFirst();
    }

    // Keep page, total and view descriptors under the same binding/audience policy as direct
    // material reads.
    private static String visibleWhere(boolean publicView) {
        return " FROM material WHERE workspace_id=? AND student_id=? AND lesson_id IS NOT DISTINCT FROM ?"
                + (publicView
                        ? " AND audience='student' AND NOT (kind='code' AND coalesce(payload->'teacher'='true'::jsonb,false))"
                        : "")
                + " AND (lesson_id IS NULL OR EXISTS (SELECT 1 FROM lesson l WHERE l.workspace_id=material.workspace_id AND l.student_id=material.student_id AND l.id=material.lesson_id"
                + (publicView
                        ? " AND l.status='prepared' AND material.bundle_id IS NOT NULL AND l.bundle_id=material.bundle_id"
                        : "")
                + "))";
    }

    public List<Metadata> list(
            String workspace,
            String student,
            String lesson,
            boolean publicView,
            int page,
            int size) {
        return jdbc.query(
                "SELECT " + COLUMNS + visibleWhere(publicView) + " ORDER BY id LIMIT ? OFFSET ?",
                META,
                workspace,
                student,
                lesson,
                size,
                (long) page * size);
    }

    public long count(String workspace, String student, String lesson, boolean publicView) {
        return jdbc.queryForObject(
                "SELECT count(*)" + visibleWhere(publicView),
                Long.class,
                workspace,
                student,
                lesson);
    }

    public List<Metadata> visible(
            String workspace, String student, String lesson, boolean publicView) {
        return jdbc.query(
                "SELECT " + COLUMNS + visibleWhere(publicView) + " ORDER BY id",
                META,
                workspace,
                student,
                lesson);
    }

    public boolean documentExists(
            String workspace, String student, String lesson, String audience, String contentKey) {
        return jdbc.queryForObject(
                        "SELECT count(*) FROM material WHERE workspace_id=? AND student_id=? AND lesson_id IS NOT DISTINCT FROM ? AND kind='doc' AND audience=? AND content_key=?",
                        Integer.class,
                        workspace,
                        student,
                        lesson,
                        audience,
                        contentKey)
                > 0;
    }

    public void insert(
            String workspace,
            String id,
            String student,
            String lesson,
            String bundle,
            String audience,
            String kind,
            String contentKey,
            String filename,
            String contentType,
            String title,
            String payload,
            String blobId) {
        jdbc.update(
                "INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,payload,blob_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?)",
                workspace,
                id,
                student,
                lesson,
                bundle,
                audience,
                kind,
                contentKey,
                filename,
                contentType,
                title,
                payload,
                blobId);
    }

    public boolean delete(String workspace, String id) {
        return jdbc.update("DELETE FROM material WHERE workspace_id=? AND id=?", workspace, id)
                == 1;
    }
}
