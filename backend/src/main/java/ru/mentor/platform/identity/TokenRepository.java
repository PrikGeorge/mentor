package ru.mentor.platform.identity;

import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;
import ru.mentor.platform.shared.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

/** Persistence for one-use identity grants; raw secrets never enter this repository. */
@Repository
public class TokenRepository {
    private final JdbcTemplate jdbc;
    public TokenRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public record Invitation(String id,String kind,String workspace,String student,Instant created,Instant expires,Instant used,Instant revoked){}
    public record Reset(String id,String user,long version,Instant expires,Instant used,Instant revoked){}
    public record InvitationView(String id,String state,Instant expiresAt,Instant createdAt){}
    private static Instant instant(java.sql.ResultSet r,String c)throws java.sql.SQLException{Timestamp t=r.getTimestamp(c);return t==null?null:t.toInstant();}
    private static final RowMapper<Invitation> INVITATION=(r,n)->new Invitation(r.getString("id"),r.getString("kind"),r.getString("workspace_id"),r.getString("student_id"),instant(r,"created_at"),instant(r,"expires_at"),instant(r,"used_at"),instant(r,"revoked_at"));
    public Optional<Invitation> invitation(String hash,boolean lock){return jdbc.query("SELECT * FROM identity_invitation WHERE token_hash=?"+(lock?" FOR UPDATE":""),INVITATION,hash).stream().findFirst();}
    public void issueInvitation(String id,String hash,String kind,String issuer,String w,String student,Instant now,Instant expiry){jdbc.update("INSERT INTO identity_invitation(id,token_hash,kind,issuer_id,workspace_id,student_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",id,hash,kind,issuer,w,student,Timestamp.from(now),Timestamp.from(expiry));}
    public void replaceCardInvitations(String w,String student,Instant now){jdbc.update("UPDATE identity_invitation SET revoked_at=? WHERE workspace_id=? AND student_id=? AND used_at IS NULL AND revoked_at IS NULL",Timestamp.from(now),w,student);}
    public boolean revokeInvitation(String id,String w,String student,Instant now){return jdbc.update("UPDATE identity_invitation SET revoked_at=? WHERE id=? AND "+(w==null?"kind='TEACHER'":"workspace_id=? AND student_id=?")+" AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?",w==null?new Object[]{Timestamp.from(now),id,Timestamp.from(now)}:new Object[]{Timestamp.from(now),id,w,student,Timestamp.from(now)})==1;}
    public InvitationView view(Invitation i,Instant now){return new InvitationView(i.id(),i.used()!=null?"used":i.revoked()!=null?"revoked":!now.isBefore(i.expires())?"expired":"pending",i.expires(),i.created());}
    public InvitationView latest(String w,String student,Instant now){return jdbc.query("SELECT * FROM identity_invitation WHERE workspace_id=? AND student_id=? ORDER BY issue_sequence DESC LIMIT 1",INVITATION,w,student).stream().findFirst().map(i->view(i,now)).orElse(null);}
    public Page<InvitationView> teacherInvitations(int page,int size,Instant now){new Page<>(List.of(),page,size,0);return new Page<>(jdbc.query("SELECT * FROM identity_invitation WHERE kind='TEACHER' ORDER BY created_at,id LIMIT ? OFFSET ?",INVITATION,size,(long)page*size).stream().map(i->view(i,now)).toList(),page,size,jdbc.queryForObject("SELECT count(*) FROM identity_invitation WHERE kind='TEACHER'",Long.class));}
    public void useInvitation(String id,Instant now){jdbc.update("UPDATE identity_invitation SET used_at=? WHERE id=?",Timestamp.from(now),id);}
    public Optional<Reset> reset(String hash,boolean lock){return jdbc.query("SELECT * FROM identity_password_reset WHERE token_hash=?"+(lock?" FOR UPDATE":""),(r,n)->new Reset(r.getString("id"),r.getString("target_user_id"),r.getLong("target_auth_version"),instant(r,"expires_at"),instant(r,"used_at"),instant(r,"revoked_at")),hash).stream().findFirst();}
    public void issueReset(String id,String hash,String issuer,String target,long version,Instant now,Instant expiry){jdbc.update("UPDATE identity_password_reset SET revoked_at=? WHERE target_user_id=? AND used_at IS NULL AND revoked_at IS NULL",Timestamp.from(now),target);jdbc.update("INSERT INTO identity_password_reset(id,token_hash,issuer_id,target_user_id,target_auth_version,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",id,hash,issuer,target,version,Timestamp.from(now),Timestamp.from(expiry));}
    public void useReset(String id,Instant now){jdbc.update("UPDATE identity_password_reset SET used_at=? WHERE id=?",Timestamp.from(now),id);}
    public void audit(String actor,String action,String target,String w,Instant now){jdbc.update("INSERT INTO identity_audit(id,actor_id,action,target_id,workspace_id,created_at) VALUES (?,?,?,?,?,?)",UUID.randomUUID().toString(),actor,action,target,w,Timestamp.from(now));}
}
