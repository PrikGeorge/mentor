package ru.mentor.platform.workspaces;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkspaceIsolationTest extends IdentityHttpTest {
    @Test void twoSpacesEnforceOwnershipProjectionsAndCompositeForeignKeys() throws Exception {
        var a=teacher("teacher-a");var b=teacher("teacher-b");var sa=student(a,"Student A");var sb=student(b,"Student B");
        String aId=sa.get("id").asText(),bId=sb.get("id").asText();var learner=enroll(a,aId,"learner-a");var otherCard=student(a,"Another A card");
        assertEquals(404,get(a.client(),card(b,bId)).statusCode()); assertEquals(404,get(a.client(),card(a,bId)).statusCode());
        assertEquals(404,get(admin,card(a,aId)).statusCode()); assertEquals(404,get(admin,students(a)).statusCode());
        var own=data(get(learner.client(),students(a)),200); assertEquals(1,own.get("total").asInt());assertEquals(aId,own.get("items").get(0).get("id").asText());assertFalse(own.toString().contains("notes"));
        assertEquals(2,data(get(a.client(),students(a)),200).get("total").asInt());
        assertEquals(404,get(learner.client(),card(a,otherCard.get("id").asText())).statusCode());
        assertEquals(404,write(learner.client(),"PATCH",card(a,aId),Map.of("revision",1,"notes","injected")).statusCode());
        assertFalse(data(get(a.client(),card(a,aId)+"?audience=student"),200).has("notes"));assertTrue(data(get(a.client(),card(a,aId)),200).has("notes"));
        assertEquals(400,get(a.client(),card(a,aId)+"?audience=teacher").statusCode());
        assertEquals(404,get(learner.client(),card(b,bId)).statusCode()); assertEquals(404,get(learner.client(),card(a,aId)+"/access").statusCode());
        assertEquals(400,write(a.client(),"PATCH",card(a,aId),Map.of("revision",1,"workspaceId",b.workspace(),"role","ADMIN")).statusCode());
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) SELECT 'cross-space-user','cross-space-user',password_hash,'STUDENT' FROM identity_account WHERE id='admin'");
        var fk=assertThrows(DataIntegrityViolationException.class,()->jdbc.update("INSERT INTO workspace_membership(user_id,workspace_id,role,student_id) VALUES (?,?, 'STUDENT',?)","cross-space-user",b.workspace(),aId));
        assertTrue(fk.getMostSpecificCause().getMessage().contains("membership_card_binding"));
        var access=context.getBean(WorkspaceAccess.class);
        assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->access.requireTeacher(new ru.mentor.platform.shared.Actor(a.id(),b.workspace(),ru.mentor.platform.shared.Actor.Role.TEACHER,1),b.workspace())).status());
        assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->access.requireTeacher(new ru.mentor.platform.shared.Actor(a.id(),a.workspace(),ru.mentor.platform.shared.Actor.Role.ADMIN,1),a.workspace())).status());
    }
    @Test void accountAndWorkspacePauseAreIndependentAndRevokeSessions() throws Exception {
        var a=teacher("teacher-pause");var s=student(a,"Paused student");String id=s.get("id").asText();var learner=enroll(a,id,"learner-pause");
        data(write(admin,"PATCH","/admin/teachers/"+a.id()+"/access",Map.of("disabled",true)),204);
        assertTrue(session(a.client()).get("account").isNull()); assertFalse(session(learner.client()).get("account").isNull());
        data(write(admin,"PATCH","/admin/workspaces/"+a.workspace()+"/access",Map.of("disabled",true)),204);
        assertTrue(session(learner.client()).get("account").isNull());
        data(write(admin,"PATCH","/admin/workspaces/"+a.workspace()+"/access",Map.of("disabled",false)),204);
        assertEquals(401,write(a.client(),"POST","/auth/login",Map.of("login","teacher-pause","password",PASSWORD)).statusCode());
        data(write(learner.client(),"POST","/auth/login",Map.of("login","learner-pause","password",PASSWORD)),200);
        data(write(admin,"PATCH","/admin/teachers/"+a.id()+"/access",Map.of("disabled",false)),204);
        data(write(a.client(),"POST","/auth/login",Map.of("login","teacher-pause","password",PASSWORD)),200);
        data(write(a.client(),"PATCH",card(a,id)+"/access",Map.of("disabled",true)),204);
        assertTrue(session(learner.client()).get("account").isNull()); assertFalse(session(a.client()).get("account").isNull());
        assertEquals(401,write(learner.client(),"POST","/auth/login",Map.of("login","learner-pause","password",PASSWORD)).statusCode());
        data(write(a.client(),"PATCH",card(a,id)+"/access",Map.of("disabled",false)),204);
        data(write(learner.client(),"POST","/auth/login",Map.of("login","learner-pause","password",PASSWORD)),200);
    }
    @Test void profileDefaultsLegacyTrimLimitsOptimisticRevisionAndNoAccountAccessBeforeSignup() throws Exception {
        var t=teacher("teacher-profile");var s=student(t,"\uFEFF Synthetic😀 \u00a0");String path=card(t,s.get("id").asText());
        assertEquals("Synthetic😀",s.get("name").asText());assertEquals("Java Backend",s.get("direction").asText());assertEquals(1,s.get("revision").asInt());
        assertTrue(data(get(t.client(),path+"/access"),200).get("account").isNull());
        assertEquals(409,write(t.client(),"PATCH",path+"/access",Map.of("disabled",true)).statusCode());
        assertEquals(400,write(t.client(),"POST",students(t),Map.of("name","😀".repeat(61))).statusCode());
        var updated=data(write(t.client(),"PATCH",path,Map.of("revision",1,"goal","  Goal  ","studentReview","archive")),200);
        assertEquals(2,updated.get("revision").asInt());assertEquals("Goal",updated.get("goal").asText());assertEquals("private-teacher-note",updated.get("notes").asText());
        assertEquals(409,write(t.client(),"PATCH",path,Map.of("revision",1,"goal","lost-update")).statusCode());
        assertEquals("Goal",data(get(t.client(),path),200).get("goal").asText());
    }
    @Test void resetIssuanceRequiresCurrentIssuerPasswordAndExactOwnershipAndPreservesWorkspaceAfterPasswordChange() throws Exception {
        var a=teacher("teacher-issuer");var b=teacher("teacher-other");var s=student(a,"Reset learner");String path=card(a,s.get("id").asText());var learner=enroll(a,s.get("id").asText(),"learner-reset");
        assertEquals(404,write(b.client(),"POST",path+"/password-reset",Map.of("currentPassword",PASSWORD)).statusCode());
        assertEquals(401,write(a.client(),"POST",path+"/password-reset",Map.of("currentPassword","synthetic-wrong")).statusCode());
        assertEquals(404,write(a.client(),"POST","/admin/teachers/"+b.id()+"/password-reset",Map.of("currentPassword",PASSWORD)).statusCode());
        var issue=data(write(a.client(),"POST",path+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        data(write(learner.client(),"POST","/auth/reset-password",Map.of("token",token(issue),"password","synthetic-reset-new")),204);
        assertTrue(session(learner.client()).get("account").isNull());
        var changed=data(write(a.client(),"POST","/auth/change-password",Map.of("currentPassword",PASSWORD,"newPassword","synthetic-teacher-new")),200);
        assertEquals(a.workspace(),changed.get("account").get("workspaceId").asText());assertEquals(a.workspace(),session(a.client()).get("account").get("workspaceId").asText());
    }
    @Test void studentRevokeIsScopedAndRecoveryDoesNotResumePausedAccountAndMembershipIsAuthoritative() throws Exception {
        var a=teacher("teacher-revoke");var b=teacher("teacher-foreign");var s=student(a,"Revoke student");String id=s.get("id").asText(),path=card(a,id);
        var invitation=data(write(a.client(),"POST",path+"/invitations",Map.of()),200);
        assertEquals(404,write(b.client(),"DELETE",path+"/invitations/"+invitation.get("id").asText(),null).statusCode());
        data(write(a.client(),"DELETE",path+"/invitations/"+invitation.get("id").asText(),null),204);
        assertEquals("revoked",data(get(a.client(),path+"/access"),200).get("invitation").get("state").asText());
        assertEquals(409,write(client(),"POST","/auth/register",Map.of("token",token(invitation),"login","revoked-learner","password",PASSWORD)).statusCode());
        var learner=enroll(a,id,"paused-learner");data(write(a.client(),"PATCH",path+"/access",Map.of("disabled",true)),204);
        var reset=data(write(a.client(),"POST",path+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        data(write(client(),"POST","/auth/reset-password",Map.of("token",token(reset),"password","synthetic-paused-new")),204);
        assertEquals(401,write(learner.client(),"POST","/auth/login",Map.of("login","paused-learner","password","synthetic-paused-new")).statusCode());
        data(write(a.client(),"PATCH",path+"/access",Map.of("disabled",false)),204);
        data(write(learner.client(),"POST","/auth/login",Map.of("login","paused-learner","password","synthetic-paused-new")),200);
        jdbc.update("UPDATE workspace_membership SET disabled=TRUE WHERE user_id=?",learner.id());
        assertTrue(session(learner.client()).get("account").isNull());
        assertEquals(401,write(learner.client(),"POST","/auth/login",Map.of("login","paused-learner","password","synthetic-paused-new")).statusCode());
    }
    @Test void anonymousRegistrationAndResetStillRequireCsrfEvenWithPriorAccountCookie() throws Exception {
        var issue=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        for(String path:List.of("/auth/register","/auth/reset-password")){
            var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("Content-Type","application/json")
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(path.endsWith("register")?Map.of("token",token(issue),"login","csrf-rejected","password",PASSWORD):Map.of("token",token(issue),"password",PASSWORD)))).build();
            assertEquals(403,admin.send(request,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        }
        assertEquals("ADMIN",session(admin).get("account").get("role").asText());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM workspace_membership",Integer.class));
    }
    // Catches access reads sharing a budget with strangers, and access writes escaping the shared write budget.
    @Test void accessWritesShareTheGlobalBudgetWhileAccessReadsStayFree() throws Exception {
        var t=teacher("teacher-limiter");var s=student(t,"Limit profile");String path=card(t,s.get("id").asText());
        CLOCK.advance(java.time.Duration.ofMinutes(1));
        for(int i=0;i<200;i++)assertEquals(200,get(t.client(),path+"/access").statusCode());
        for(int i=0;i<120;i++)assertEquals(400,write(t.client(),"PATCH",path+"/access",Map.of()).statusCode());
        var limited=write(t.client(),"PATCH",path+"/access",Map.of());assertEquals(429,limited.statusCode(),limited.body());assertEquals("60",limited.headers().firstValue("Retry-After").orElseThrow());
        for(int i=0;i<125;i++)assertEquals(200,get(t.client(),path).statusCode());assertEquals(200,get(t.client(),path+"/access").statusCode());
        CLOCK.advance(java.time.Duration.ofMinutes(1));assertEquals(400,write(t.client(),"PATCH",path+"/access",Map.of()).statusCode());
    }
}
