package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import java.util.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class LessonAudienceTest extends LessonHttpTest {
    @Test void privateProjectionAndExactWorkspaceCardLessonOwnership()throws Exception {
        var a=fixture("lesson-teacher-a");var b=fixture("lesson-teacher-b");var l=lesson(a,"Private lesson","2030-01-01","12:00",60);String path=lessonPath(a,l);
        var learner=enroll(a.teacher(),a.student(),"lesson-student");var otherCard=student(a.teacher(),"Other card");
        data(write(a.teacher().client(),"PUT",path+"/texts/teacherNotes",Map.of("revision",1,"markdown","secret-teacher-content")),200);
        for(String audience:List.of("","?audience=student")){
            var publicView=data(get(learner.client(),path+audience),200);assertFalse(publicView.has("teacherNotes"));assertFalse(publicView.toString().contains("secret-teacher-content"));
        }
        assertFalse(data(get(a.teacher().client(),path+"?audience=student"),200).has("teacherNotes"));
        assertEquals(404,get(learner.client(),path+"/texts/teacherNotes").statusCode());assertEquals(404,get(a.teacher().client(),path+"/texts/teacherNotes?audience=student").statusCode());
        assertEquals(404,get(admin,path).statusCode());assertEquals(404,get(b.teacher().client(),path).statusCode());
        String wrongCard=card(a.teacher(),otherCard.get("id").asText())+"/lessons/"+l.get("id").asText();
        var wrong=get(a.teacher().client(),wrongCard);assertEquals(404,wrong.statusCode());assertFalse(wrong.body().contains("secret-teacher-content"));assertFalse(wrong.body().contains("teacherNotes"));
        var head=admin.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).method("HEAD",HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());assertEquals(404,head.statusCode());
        assertEquals(404,write(learner.client(),"PUT",path+"/texts/studentNotes",Map.of("revision",1,"markdown","impersonation")).statusCode());
        assertEquals(400,get(a.teacher().client(),path+"?audience=teacher").statusCode());
        assertThrows(DataIntegrityViolationException.class,()->jdbc.update("INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,created_at) VALUES (?,?, 'foreign-lesson','foreign','2030-01-01','12:00',60,CURRENT_TIMESTAMP)",b.teacher().workspace(),a.student()));
        assertThrows(DataIntegrityViolationException.class,()->jdbc.update("INSERT INTO lesson_text(workspace_id,lesson_id,kind) VALUES (?,?,'studentNotes')",b.teacher().workspace(),l.get("id").asText()));
    }
    @Test void dashboardFocusIncludesDurationEndBoundaryMoscowMidnightAndAllPages()throws Exception {
        var f=fixture("lesson-focus");assertTrue(data(get(f.teacher().client(),f.path()+"/dashboard"),200).get("focus").isNull());
        LocalDate date=LocalDate.ofInstant(CLOCK.instant(),ZoneId.of("Europe/Moscow")).plusDays(1);
        var first=lesson(f,"Across midnight",date.toString(),"23:30",60);var future=lesson(f,"Later",date.plusDays(2).toString(),"12:00",30);
        Instant end=date.plusDays(1).atTime(0,30).atZone(ZoneId.of("Europe/Moscow")).toInstant();CLOCK.advance(Duration.between(CLOCK.instant(),end));
        // Re-login after deliberate test-clock advance beyond idle expiry.
        data(write(f.teacher().client(),"POST","/auth/login",Map.of("login","lesson-focus","password",PASSWORD)),200);
        var focus=data(get(f.teacher().client(),f.path()+"/dashboard"),200);assertEquals(2,focus.get("lessonCount").asInt());assertEquals(first.get("id").asText(),focus.get("focus").get("lesson").get("id").asText());assertTrue(focus.get("focus").get("upcoming").asBoolean());
        assertEquals(future.get("id").asText(),data(get(f.teacher().client(),f.path()+"/lessons?size=1"),200).get("items").get(0).get("id").asText());
        CLOCK.advance(Duration.ofSeconds(1));assertEquals(future.get("id").asText(),data(get(f.teacher().client(),f.path()+"/dashboard"),200).get("focus").get("lesson").get("id").asText());
        CLOCK.advance(Duration.ofDays(10));data(write(f.teacher().client(),"POST","/auth/login",Map.of("login","lesson-focus","password",PASSWORD)),200);
        var past=data(get(f.teacher().client(),f.path()+"/dashboard"),200);assertEquals(future.get("id").asText(),past.get("focus").get("lesson").get("id").asText());assertFalse(past.get("focus").get("upcoming").asBoolean());
        var publicDashboard=data(get(f.teacher().client(),f.path()+"/dashboard?audience=student"),200);assertFalse(publicDashboard.get("student").has("notes"));assertFalse(publicDashboard.get("focus").get("lesson").has("teacherNotes"));
    }
    @Test void historicalFocusUsesDeclaredMoscowZoneRatherThanFixedOffset()throws Exception {
        var f=fixture("lesson-history");lesson(f,"Historical","2012-01-01","12:00",60);
        Instant previous=CLOCK.instant();
        try {
            CLOCK.advance(Duration.between(previous,Instant.parse("2012-01-01T09:10:00Z")));
            var result=data(get(f.teacher().client(),f.path()+"/dashboard"),200);
            assertFalse(result.get("focus").get("upcoming").asBoolean()); // Europe/Moscow was UTC+04, end09:00Z; fixed+03 would still be current.
        } finally {
            // Authentication TTLs belong to the shared context; the historical instant must not escape this test.
            CLOCK.advance(Duration.between(CLOCK.instant(),previous));
        }
    }
    @Test void materialReaderChecksCurrentBindingPreparedBundleAndActualActor()throws Exception {
        var f=fixture("lesson-material");var l=lesson(f,"Materials","2030-01-01","12:00",60);String id=l.get("id").asText();var learner=enroll(f.teacher(),f.student(),"material-learner");
        var teacher=new ru.mentor.platform.shared.Actor(f.teacher().id(),f.teacher().workspace(),ru.mentor.platform.shared.Actor.Role.TEACHER,1);
        var student=new ru.mentor.platform.shared.Actor(learner.id(),learner.workspace(),ru.mentor.platform.shared.Actor.Role.STUDENT,1);
        var service=context.getBean(LessonService.class);var ref=service.requireReader(student,f.teacher().workspace(),f.student(),id);
        assertEquals(ref,service.requireMaterialReader(teacher,ref.workspaceId(),ref.studentId(),ref.id(),"catalog-bundle",false));
        assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->service.requireMaterialReader(student,ref.workspaceId(),ref.studentId(),ref.id(),"bundle-a",false)).status());
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='bundle-a' WHERE workspace_id=? AND id=?",ref.workspaceId(),ref.id());
        assertEquals(ref,service.requireMaterialReader(student,ref.workspaceId(),ref.studentId(),ref.id(),"bundle-a",false));
        assertEquals(ref,service.requireMaterialReader(teacher,ref.workspaceId(),ref.studentId(),ref.id(),"bundle-a",true));
        for(String bundle:new String[]{null,"bundle-b"})assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->service.requireMaterialReader(student,ref.workspaceId(),ref.studentId(),ref.id(),bundle,false)).status());
        jdbc.update("UPDATE lesson SET status='planned',bundle_id=NULL WHERE workspace_id=? AND id=?",ref.workspaceId(),ref.id());
        assertEquals(ref,service.requireMaterialReader(teacher,ref.workspaceId(),ref.studentId(),ref.id(),"bundle-a",false));
        assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->service.requireMaterialReader(teacher,ref.workspaceId(),ref.studentId(),ref.id(),"bundle-a",true)).status());
        data(write(admin,"PATCH","/admin/workspaces/"+ref.workspaceId()+"/access",Map.of("disabled",true)),204);
        assertEquals(404,assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->service.saveText(teacher,ref,TextKind.studentNotes,"old reference",1)).status());
    }
}
