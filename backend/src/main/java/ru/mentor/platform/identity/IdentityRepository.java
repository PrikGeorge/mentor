package ru.mentor.platform.identity;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import ru.mentor.platform.shared.Page;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class IdentityRepository {
    private final JdbcTemplate jdbc;

    public IdentityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Account(
            String id,
            String login,
            String passwordHash,
            Actor.Role role,
            boolean disabled,
            long authVersion) {
        public Actor actor() {
            return new Actor(id, null, role, authVersion);
        }
    }

    public Optional<Account> findByLogin(String login) {
        return find("login", login);
    }

    public Optional<Account> findById(String id) {
        return find("id", id);
    }

    private Optional<Account> find(String column, String value) {
        return jdbc
                .query(
                        "SELECT id,login,password_hash,role,disabled,auth_version FROM identity_account WHERE "
                                + column
                                + " = ?",
                        (rs, row) ->
                                new Account(
                                        rs.getString(1),
                                        rs.getString(2),
                                        rs.getString(3),
                                        Actor.Role.valueOf(rs.getString(4)),
                                        rs.getBoolean(5),
                                        rs.getLong(6)),
                        value)
                .stream()
                .findFirst();
    }

    public Actor replacePassword(Actor actor, String encoded) {
        int changed =
                jdbc.update(
                        "UPDATE identity_account SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND auth_version=? AND disabled=FALSE",
                        encoded,
                        actor.userId(),
                        actor.authVersion());
        if (changed != 1)
            throw new ApiFailure(409, "ACCOUNT_CHANGED", "Account changed. Sign in again.");
        var current = findById(actor.userId()).orElseThrow(ApiFailure::unauthorized);
        return new Actor(current.id(), actor.workspaceId(), current.role(), current.authVersion());
    }

    public Actor createOrRestoreAdmin(String login, String encoded) {
        var existing = findByLogin(login);
        if (existing.isPresent()) {
            Account account = existing.get();
            if (account.role() != Actor.Role.ADMIN)
                throw new ApiFailure(
                        409, "LOGIN_EXISTS", "Login already belongs to another account.");
            jdbc.update(
                    "UPDATE identity_account SET password_hash=?,disabled=FALSE,auth_version=auth_version+1 WHERE id=?",
                    encoded,
                    account.id());
            return findById(account.id()).orElseThrow().actor();
        }
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO identity_account(id,login,password_hash,role) VALUES (?,?,?,'ADMIN')",
                id,
                login,
                encoded);
        return new Actor(id, null, Actor.Role.ADMIN, 1);
    }

    public void revokeOtherSessions(String userId, String keepSessionId) {
        jdbc.update(
                "DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=? AND SESSION_ID<>?",
                userId,
                keepSessionId);
    }

    public void revokeAllSessions(String userId) {
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?", userId);
    }

    public Account create(String login, String encoded, Actor.Role role) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "INSERT INTO identity_account(id,login,password_hash,role) VALUES (?,?,?,?)",
                id,
                login,
                encoded,
                role.name());
        return findById(id).orElseThrow();
    }

    public Account lock(String id) {
        jdbc.queryForList("SELECT id FROM identity_account WHERE id=? FOR UPDATE", id);
        return findById(id).orElseThrow(ApiFailure::unauthorized);
    }

    public void disable(String id, boolean disabled) {
        jdbc.update(
                "UPDATE identity_account SET disabled=?,auth_version=auth_version+1 WHERE id=?",
                disabled,
                id);
        revokeAllSessions(id);
    }

    public void resetPassword(String id, String encoded, long version) {
        if (jdbc.update(
                        "UPDATE identity_account SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND auth_version=?",
                        encoded,
                        id,
                        version)
                != 1) throw new ApiFailure(409, "TOKEN_INVALID", "Link is unavailable.");
        revokeAllSessions(id);
    }

    public record TeacherView(
            String userId,
            String login,
            String workspaceId,
            boolean accountDisabled,
            boolean workspaceDisabled) {}

    public Page<TeacherView> teachers(int page, int size) {
        new Page<>(List.of(), page, size, 0);
        var items =
                jdbc.query(
                        "SELECT a.id,a.login,w.id,a.disabled,w.disabled FROM identity_account a JOIN workspace w ON w.owner_user_id=a.id WHERE a.role='TEACHER' ORDER BY a.created_at,a.id LIMIT ? OFFSET ?",
                        (r, n) ->
                                new TeacherView(
                                        r.getString(1),
                                        r.getString(2),
                                        r.getString(3),
                                        r.getBoolean(4),
                                        r.getBoolean(5)),
                        size,
                        (long) page * size);
        return new Page<>(
                items,
                page,
                size,
                jdbc.queryForObject("SELECT count(*) FROM workspace", Long.class));
    }
}
