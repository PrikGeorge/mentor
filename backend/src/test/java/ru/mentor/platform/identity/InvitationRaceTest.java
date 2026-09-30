package ru.mentor.platform.identity;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import java.time.Duration;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class InvitationRaceTest extends IdentityHttpTest {
    @Test void oneWinner() throws Exception {
        var issue=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        String raw=token(issue); var a=client();var b=client();session(a);session(b);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);
            var first=pool.submit(()->{start.await();return write(a,"POST","/auth/register",Map.of("token",raw,"login","race-one","password",PASSWORD)).statusCode();});
            var second=pool.submit(()->{start.await();return write(b,"POST","/auth/register",Map.of("token",raw,"login","race-two","password",PASSWORD)).statusCode();});
            start.countDown(); var statuses=List.of(first.get(30,TimeUnit.SECONDS),second.get(30,TimeUnit.SECONDS));
            assertEquals(1,statuses.stream().filter(v->v==200).count()); assertEquals(1,statuses.stream().filter(v->v==409).count());
        }
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM workspace_membership",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM workspace",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_account WHERE role='TEACHER'",Integer.class));
        assertFalse(jdbc.queryForObject("SELECT token_hash FROM identity_invitation WHERE id=?",String.class,issue.get("id").asText()).contains(raw));
    }
    @Test void exactInvitationDeadlineAndRevocationAndReuse() throws Exception {
        var expired=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        CLOCK.advance(Duration.ofHours(72));
        assertEquals(409,write(client(),"POST","/auth/register",Map.of("token",token(expired),"login","expired","password",PASSWORD)).statusCode());
        // Re-authenticate administrator after advancing beyond idle expiry.
        data(write(admin,"POST","/auth/login",Map.of("login","admin","password",PASSWORD)),200);
        var revoked=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        data(write(admin,"DELETE","/admin/teacher-invitations/"+revoked.get("id").asText(),null),204);
        assertEquals(409,write(client(),"POST","/auth/register",Map.of("token",token(revoked),"login","revoked","password",PASSWORD)).statusCode());
        var used=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        data(write(client(),"POST","/auth/register",Map.of("token",token(used),"login","used-token","password",PASSWORD)),200);
        assertEquals(409,write(client(),"POST","/auth/register",Map.of("token",token(used),"login","used-again","password",PASSWORD)).statusCode());
        var list=data(get(admin,"/admin/teacher-invitations"),200);
        assertFalse(list.toString().contains("token_hash"));assertFalse(list.toString().contains(token(used)));
        Set<String> states=new HashSet<>();list.get("items").forEach(v->states.add(v.get("state").asText()));assertEquals(Set.of("expired","revoked","used"),states);
    }
    @Test void concurrentReplacementInvitationsLeaveOneUsableTokenAndOneCardAccount() throws Exception {
        var t=teacher("teacher-race");var s=student(t,"Synthetic card");String path=card(t,s.get("id").asText());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var start=new CountDownLatch(1);
            var one=pool.submit(()->{start.await();return data(write(t.client(),"POST",path+"/invitations",Map.of()),200);});
            var two=pool.submit(()->{start.await();return data(write(t.client(),"POST",path+"/invitations",Map.of()),200);});
            start.countDown();var issues=List.of(one.get(30,TimeUnit.SECONDS),two.get(30,TimeUnit.SECONDS));
            int winners=0;for(int i=0;i<2;i++)if(write(client(),"POST","/auth/register",Map.of("token",token(issues.get(i)),"login","student-race-"+i,"password",PASSWORD)).statusCode()==200)winners++;
            assertEquals(1,winners);
        }
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM workspace_membership WHERE role='STUDENT'",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM student_profile WHERE user_id IS NOT NULL",Integer.class));
        assertEquals(409,write(t.client(),"POST",path+"/invitations",Map.of()).statusCode());
    }
    @Test void resetExpiresAtThirtyMinutesAndIsSingleUseAndRevokesAllSessions() throws Exception {
        var t=teacher("teacher-reset"); var second=client();data(write(second,"POST","/auth/login",Map.of("login","teacher-reset","password",PASSWORD)),200);
        var expired=data(write(admin,"POST","/admin/teachers/"+t.id()+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        CLOCK.advance(Duration.ofMinutes(30));
        assertEquals(409,write(client(),"POST","/auth/reset-password",Map.of("token",token(expired),"password","synthetic-new-password")).statusCode());
        var active=data(write(admin,"POST","/admin/teachers/"+t.id()+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        data(write(admin,"POST","/auth/reset-password",Map.of("token",token(active),"password","synthetic-new-password")),204);
        assertTrue(session(admin).get("account").isNull()); assertTrue(session(t.client()).get("account").isNull()); assertTrue(session(second).get("account").isNull());
        assertEquals(409,write(client(),"POST","/auth/reset-password",Map.of("token",token(active),"password","synthetic-next-password")).statusCode());
        var login=data(write(t.client(),"POST","/auth/login",Map.of("login","teacher-reset","password","synthetic-new-password")),200);
        assertEquals(t.workspace(),login.get("account").get("workspaceId").asText());
    }
    @Test void registrationReplacesPreviouslyAuthenticatedCookieAndDuplicateLoginDoesNotConsumeToken() throws Exception {
        var issue=data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200);
        String priorCsrf=session(admin).get("csrfToken").asText();
        assertEquals(409,write(admin,"POST","/auth/register",Map.of("token",token(issue),"login","admin","password",PASSWORD)).statusCode());
        var registered=data(write(admin,"POST","/auth/register",Map.of("token",token(issue),"login","replaced-teacher","password",PASSWORD)),200);
        assertEquals("TEACHER",registered.get("account").get("role").asText());
        assertEquals("TEACHER",session(admin).get("account").get("role").asText());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM student_profile",Integer.class));
        var stale=admin.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(origin+"/api/v1/admin/teacher-invitations"))
            .header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account","admin").header("X-CSRF-TOKEN",priorCsrf).header("Content-Type","application/json")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{}")).build(),java.net.http.HttpResponse.BodyHandlers.ofString());
        assertEquals(409,stale.statusCode());
    }
    @Test void replacementMetadataAndResetRevocationFollowIssuanceOrderAtIdenticalClockTime() throws Exception {
        var t=teacher("teacher-replacement");var card=student(t,"Replacement student");String path=card(t,card.get("id").asText());
        var first=data(write(t.client(),"POST",path+"/invitations",Map.of()),200);
        var second=data(write(t.client(),"POST",path+"/invitations",Map.of()),200);
        // Deliberately order IDs opposite issuance order to make same-timestamp ordering deterministic.
        jdbc.update("UPDATE identity_invitation SET id='zz-earlier' WHERE id=?",first.get("id").asText());
        jdbc.update("UPDATE identity_invitation SET id='aa-latest' WHERE id=?",second.get("id").asText());
        var access=data(get(t.client(),path+"/access"),200);
        assertEquals("aa-latest",access.get("invitation").get("id").asText());assertEquals("pending",access.get("invitation").get("state").asText());
        assertEquals(409,write(client(),"POST","/auth/register",Map.of("token",token(first),"login","obsolete-student","password",PASSWORD)).statusCode());
        var learner=client();data(write(learner,"POST","/auth/register",Map.of("token",token(second),"login","replacement-student","password",PASSWORD)),200);
        var oldReset=data(write(t.client(),"POST",path+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        var newReset=data(write(t.client(),"POST",path+"/password-reset",Map.of("currentPassword",PASSWORD)),200);
        assertEquals(409,write(client(),"POST","/auth/reset-password",Map.of("token",token(oldReset),"password","synthetic-new-password")).statusCode());
        data(write(client(),"POST","/auth/reset-password",Map.of("token",token(newReset),"password","synthetic-new-password")),204);
        assertEquals("used",data(get(t.client(),path+"/access"),200).get("invitation").get("state").asText());
    }
    @Test void concurrentResetHasOneWinnerAndCannotOverwriteWinningPassword() throws Exception {
        var t=teacher("teacher-reset-race");String raw=token(data(write(admin,"POST","/admin/teachers/"+t.id()+"/password-reset",Map.of("currentPassword",PASSWORD)),200));
        var a=client();var b=client();session(a);session(b);String firstPassword="synthetic-first-new",secondPassword="synthetic-second-new";
        int first,second;
        try(var pool=Executors.newFixedThreadPool(2)){
            var start=new CountDownLatch(1);
            var one=pool.submit(()->{start.await();return write(a,"POST","/auth/reset-password",Map.of("token",raw,"password",firstPassword)).statusCode();});
            var two=pool.submit(()->{start.await();return write(b,"POST","/auth/reset-password",Map.of("token",raw,"password",secondPassword)).statusCode();});
            start.countDown();first=one.get(30,TimeUnit.SECONDS);second=two.get(30,TimeUnit.SECONDS);
        }
        assertEquals(Set.of(204,409),Set.of(first,second));assertTrue(session(t.client()).get("account").isNull());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM identity_password_reset WHERE used_at IS NOT NULL",Integer.class));
        data(write(t.client(),"POST","/auth/login",Map.of("login","teacher-reset-race","password",first==204?firstPassword:secondPassword)),200);
        assertEquals(401,write(client(),"POST","/auth/login",Map.of("login","teacher-reset-race","password",first==204?secondPassword:firstPassword)).statusCode());
    }
}
