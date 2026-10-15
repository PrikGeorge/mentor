package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ScheduleTest extends IdentityHttpTest {
    private String create(User teacher,String student,String title,String date,String time) throws Exception {
        return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title",title,"date",date,"time",time,"duration",60)),201).get("id").asText();
    }

    // Catches a window that renumbers lessons, leaks archived or foreign cards (even with colliding IDs), loses calendar order or exposes lesson texts.
    @Test void scheduleListsActiveCardsOfTheOwnWorkspaceInCalendarOrder() throws Exception {
        var teacher=teacher("schedule-teacher");var other=teacher("schedule-other");
        String anna=student(teacher,"Anna Schedule").get("id").asText(),boris=student(teacher,"Boris Schedule").get("id").asText(),gone=student(teacher,"Archived Schedule").get("id").asText();
        var learner=enroll(teacher,anna,"schedule-learner");
        create(teacher,anna,"A1","2030-01-01","12:00");String a2=create(teacher,anna,"A2","2030-01-07","18:00");create(teacher,boris,"B1","2030-01-07","09:30");
        String a3=create(teacher,anna,"A3","2030-01-13","12:00");create(teacher,anna,"A4","2030-01-14","12:00");create(teacher,gone,"C1","2030-01-08","12:00");
        long revision=data(get(teacher.client(),card(teacher,gone)),200).get("revision").asLong();
        data(write(teacher.client(),"PATCH",card(teacher,gone),Map.of("revision",revision,"archived",true)),200);
        data(write(teacher.client(),"PUT",card(teacher,anna)+"/lessons/"+a3+"/texts/studentNotes",Map.of("markdown","Задачи","revision",1)),200);
        data(write(teacher.client(),"PUT",card(teacher,anna)+"/lessons/"+a3+"/texts/teacherNotes",Map.of("markdown","private-plan","revision",1)),200);
        // A foreign workspace holding a card and a lesson with the very same IDs.
        jdbc.update("INSERT INTO student_profile(workspace_id,id,name,direction,goal,schedule,notes,student_roadmap,student_review,created_at) VALUES (?,?,'Foreign','','','','','','',now())",other.workspace(),anna);
        jdbc.update("INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,created_at) VALUES (?,?,?,'Foreign lesson','2030-01-07','10:00',60,now())",other.workspace(),anna,a2);
        String route="/workspaces/"+teacher.workspace()+"/schedule";
        var body=data(get(teacher.client(),route+"?from=2030-01-07&to=2030-01-13"),200);
        assertEquals("2030-01-07",body.get("from").asText());assertEquals("2030-01-13",body.get("to").asText());
        List<String> titles=new ArrayList<>();for(var item:body.get("items"))titles.add(item.get("lesson").get("title").asText());
        assertEquals(List.of("B1","A2","A3"),titles);
        var first=body.get("items").get(0);var second=body.get("items").get(1);var third=body.get("items").get(2);
        assertEquals("Boris Schedule",first.get("studentName").asText());assertEquals(1,first.get("lesson").get("number").asLong());
        assertEquals("Anna Schedule",second.get("studentName").asText());assertEquals(a2,second.get("lesson").get("id").asText());assertEquals(2,second.get("lesson").get("number").asLong());
        assertEquals(3,third.get("lesson").get("number").asLong());assertTrue(third.get("lesson").get("hasStudentNotes").asBoolean());assertFalse(second.get("lesson").get("hasStudentNotes").asBoolean());
        assertFalse(body.toString().contains("private-plan"));assertFalse(third.get("lesson").has("studentNotes"));
        assertEquals(1,data(get(other.client(),"/workspaces/"+other.workspace()+"/schedule?from=2030-01-07&to=2030-01-07"),200).get("items").size());
        assertEquals(0,data(get(teacher.client(),route+"?from=2030-01-02&to=2030-01-06"),200).get("items").size());
        // One to 31 days inclusive, real calendar dates, both bounds required.
        assertEquals(200,get(teacher.client(),route+"?from=2030-01-01&to=2030-01-31").statusCode());
        for(String query:List.of("?from=2030-01-01&to=2030-02-01","?from=2030-01-13&to=2030-01-07","?from=2030-02-30&to=2030-03-01","?from=2030-01-07","?to=2030-01-07","?from=7.1.2030&to=2030-01-07"))
            assertEquals(400,get(teacher.client(),route+query).statusCode(),query);
        // Only the teacher of this exact workspace: the student, another teacher, the administrator and an anonymous caller get nothing.
        assertEquals(404,get(learner.client(),route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(other.client(),route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(admin,route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(401,get(client(),route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(learner.client(),route+"?from=bad&to=bad").statusCode(),"access is checked before input");
    }
}
