package ru.mentor.platform.roadmap;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class RoadmapRepository {
    public record Stage(String title, String note, String state) {}

    private final JdbcTemplate jdbc;

    public RoadmapRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Stage> stages(String workspace, String student) {
        return jdbc.query(
                "SELECT title,note,state FROM roadmap_stage WHERE workspace_id=? AND student_id=? ORDER BY position",
                (r, n) ->
                        new Stage(r.getString("title"), r.getString("note"), r.getString("state")),
                workspace,
                student);
    }

    public long revision(String workspace, String student) {
        return jdbc.queryForObject(
                "SELECT roadmap_revision FROM student_profile WHERE workspace_id=? AND id=?",
                Long.class,
                workspace,
                student);
    }

    /** Replaces every stage when the expected revision still holds; false means another save won. */
    public boolean replace(String workspace, String student, long expected, List<Stage> stages) {
        if (jdbc.update(
                        "UPDATE student_profile SET roadmap_revision=roadmap_revision+1 WHERE workspace_id=? AND id=? AND roadmap_revision=?",
                        workspace,
                        student,
                        expected)
                != 1) return false;
        jdbc.update(
                "DELETE FROM roadmap_stage WHERE workspace_id=? AND student_id=?",
                workspace,
                student);
        for (int i = 0; i < stages.size(); i++) {
            var s = stages.get(i);
            jdbc.update(
                    "INSERT INTO roadmap_stage(workspace_id,student_id,position,title,note,state) VALUES (?,?,?,?,?,?)",
                    workspace,
                    student,
                    i,
                    s.title(),
                    s.note(),
                    s.state());
        }
        return true;
    }
}
