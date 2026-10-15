package ru.mentor.platform.students;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StudentDashboardsTest extends IdentityHttpTest {
    // Catches the list screen's single request disagreeing with the per-card dashboard, leaking archived cards, or showing foreign cards.
    @Test void dashboardsPageMatchesPerCardDashboardsAndRespectsArchiveAndWorkspace()throws Exception {
        var teacher=teacher("dashboards-teacher");var other=teacher("dashboards-other");
        String a=student(teacher,"Anna").get("id").asText(),b=student(teacher,"Boris").get("id").asText(),c=student(teacher,"Archived").get("id").asText();
        var learner=enroll(teacher,a,"dashboards-learner");
        LocalDate nextDate=LocalDate.ofInstant(CLOCK.instant(),ZoneId.of("Europe/Moscow")).plusDays(1);
        for(String date:List.of(nextDate.plusDays(7).toString(),nextDate.toString()))data(write(teacher.client(),"POST",card(teacher,a)+"/lessons",Map.of("title","Lesson "+date,"date",date,"time","12:00","duration",60)),201);
        long revision=data(get(teacher.client(),card(teacher,c)),200).get("revision").asLong();
        data(write(teacher.client(),"PATCH",card(teacher,c),Map.of("revision",revision,"archived",true)),200);
        String route=students(teacher)+"/dashboards";
        var page=data(get(teacher.client(),route),200);assertEquals(2,page.get("total").asInt());assertEquals(2,page.get("items").size());
        // Cards created in one instant order by id, so the items are looked up by card rather than by position.
        tools.jackson.databind.JsonNode anna=null,boris=null;for(var item:page.get("items")){String id=item.get("student").get("id").asText();if(id.equals(a))anna=item;if(id.equals(b))boris=item;}
        assertNotNull(anna);assertNotNull(boris);assertEquals(2,anna.get("lessonCount").asInt());
        assertEquals("Lesson "+nextDate,anna.get("focus").get("lesson").get("title").asText());assertTrue(anna.get("focus").get("upcoming").asBoolean());
        assertTrue(anna.get("student").has("notes"),"teacher sees the private note");
        assertEquals(0,boris.get("lessonCount").asInt());assertTrue(boris.get("focus").isNull());
        assertEquals(data(get(teacher.client(),card(teacher,a)+"/dashboard"),200),anna);
        assertEquals(c,data(get(teacher.client(),route+"?archived=true"),200).get("items").get(0).get("student").get("id").asText());
        assertEquals(3,data(get(teacher.client(),route+"?archived=all"),200).get("total").asInt());
        assertEquals(400,get(teacher.client(),route+"?archived=maybe").statusCode());
        // The student receives only their own card, in the public projection.
        var own=data(get(learner.client(),route),200);assertEquals(1,own.get("total").asInt());assertEquals(a,own.get("items").get(0).get("student").get("id").asText());
        assertFalse(own.get("items").get(0).get("student").has("notes"));assertFalse(own.get("items").get(0).get("focus").get("lesson").has("teacherNotes"));
        assertEquals(404,get(other.client(),route).statusCode());assertEquals(401,get(client(),route).statusCode());
    }
}
