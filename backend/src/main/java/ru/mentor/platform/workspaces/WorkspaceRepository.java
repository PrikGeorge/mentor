package ru.mentor.platform.workspaces;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ru.mentor.platform.shared.Actor;

import java.time.Instant;
import java.util.*;

@Repository
public class WorkspaceRepository {
    private final JdbcTemplate jdbc;

    public WorkspaceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Membership(Actor actor, String studentId) {}

    public Optional<Membership> active(String userId) {
        return jdbc
                .query(
                        "SELECT a.id,m.workspace_id,m.role,a.auth_version,m.student_id FROM identity_account a JOIN workspace_membership m ON m.user_id=a.id AND m.role=a.role JOIN workspace w ON w.id=m.workspace_id WHERE a.id=? AND NOT a.disabled AND NOT m.disabled AND NOT w.disabled",
                        (r, n) ->
                                new Membership(
                                        new Actor(
                                                r.getString(1),
                                                r.getString(2),
                                                Actor.Role.valueOf(r.getString(3)),
                                                r.getLong(4)),
                                        r.getString(5)),
                        userId)
                .stream()
                .findFirst();
    }

    public boolean lockActive(String id) {
        return jdbc
                .query(
                        "SELECT disabled FROM workspace WHERE id=? FOR UPDATE",
                        (r, n) -> r.getBoolean(1),
                        id)
                .stream()
                .findFirst()
                .map(v -> !v)
                .orElse(false);
    }

    public boolean exists(String id) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM workspace WHERE id=?)", Boolean.class, id));
    }

    public void create(String id, String owner, Instant now) {
        jdbc.update(
                "INSERT INTO workspace(id,owner_user_id,created_at) VALUES (?,?,?)",
                id,
                owner,
                java.sql.Timestamp.from(now));
        addMembership(owner, id, "TEACHER", null);
    }

    public void addMembership(String user, String workspace, String role, String student) {
        jdbc.update(
                "INSERT INTO workspace_membership(user_id,workspace_id,role,student_id) VALUES (?,?,?,?)",
                user,
                workspace,
                role,
                student);
    }

    public void disable(String id, boolean disabled) {
        jdbc.update("UPDATE workspace SET disabled=? WHERE id=?", disabled, id);
    }

    public void revokeWorkspaceSessions(String id) {
        jdbc.update(
                "DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME IN (SELECT user_id FROM workspace_membership WHERE workspace_id=?)",
                id);
        jdbc.update(
                "UPDATE identity_account SET auth_version=auth_version+1 WHERE id IN (SELECT user_id FROM workspace_membership WHERE workspace_id=?)",
                id);
    }

    public String workspaceFor(String user) {
        return jdbc
                .query(
                        "SELECT workspace_id FROM workspace_membership WHERE user_id=?",
                        (r, n) -> r.getString(1),
                        user)
                .stream()
                .findFirst()
                .orElse(null);
    }
}
