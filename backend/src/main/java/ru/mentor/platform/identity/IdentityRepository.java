package ru.mentor.platform.identity;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import java.util.Optional;
import java.util.UUID;

@Repository
public class IdentityRepository {
    private final JdbcTemplate jdbc;
    public IdentityRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public record Account(String id,String login,String passwordHash,Actor.Role role,boolean disabled,long authVersion) {
        public Actor actor() { return new Actor(id,null,role,authVersion); }
    }
    public Optional<Account> findByLogin(String login) { return find("login",login); }
    public Optional<Account> findById(String id) { return find("id",id); }
    private Optional<Account> find(String column,String value) {
        return jdbc.query("SELECT id,login,password_hash,role,disabled,auth_version FROM identity_account WHERE " + column + " = ?",
            (rs,row) -> new Account(rs.getString(1),rs.getString(2),rs.getString(3),Actor.Role.valueOf(rs.getString(4)),rs.getBoolean(5),rs.getLong(6)),value).stream().findFirst();
    }
    public Actor replacePassword(Actor actor,String encoded) {
        int changed = jdbc.update("UPDATE identity_account SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND auth_version=? AND disabled=FALSE",encoded,actor.userId(),actor.authVersion());
        if(changed != 1) throw new ApiFailure(409,"ACCOUNT_CHANGED","Account changed. Sign in again.");
        return findById(actor.userId()).orElseThrow(ApiFailure::unauthorized).actor();
    }
    public Actor createOrRestoreAdmin(String login,String encoded) {
        var existing = findByLogin(login);
        if(existing.isPresent()) {
            Account account = existing.get();
            if(account.role() != Actor.Role.ADMIN) throw new ApiFailure(409,"LOGIN_EXISTS","Login already belongs to another account.");
            jdbc.update("UPDATE identity_account SET password_hash=?,disabled=FALSE,auth_version=auth_version+1 WHERE id=?",encoded,account.id());
            return findById(account.id()).orElseThrow().actor();
        }
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) VALUES (?,?,?,'ADMIN')",id,login,encoded);
        return new Actor(id,null,Actor.Role.ADMIN,1);
    }
    public void revokeOtherSessions(String userId,String keepSessionId) {
        jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=? AND SESSION_ID<>?",userId,keepSessionId);
    }
    public void revokeAllSessions(String userId) { jdbc.update("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME=?",userId); }
}
