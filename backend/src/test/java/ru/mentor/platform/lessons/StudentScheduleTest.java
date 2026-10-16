package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The student's own calendar of one card and the teacher's preview of it (T23). */
class StudentScheduleTest extends IdentityHttpTest {
    private String create(User teacher,String student,String title,String date,String time) throws Exception {
        return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title",title,"date",date,"time",time,"duration",60)),201).get("id").asText();
    }
    private List<String> titles(tools.jackson.databind.JsonNode body) {
        List<String> titles=new ArrayList<>();for(var item:body.get("items"))titles.add(item.get("title").asText());return titles;
    }

    // Catches a calendar that shows another card, renumbers by the window, hides an archived card from its own student,
    // exposes lesson texts or lets another student, teacher or the administrator read it.
    @Test void studentReadsOnlyTheOwnCardInCalendarOrder() throws Exception {
        var teacher=teacher("calendar-teacher");var other=teacher("calendar-other");
        String anna=student(teacher,"Anna Calendar").get("id").asText(),boris=student(teacher,"Boris Calendar").get("id").asText();
        var learner=enroll(teacher,anna,"calendar-anna");var neighbour=enroll(teacher,boris,"calendar-boris");
        create(teacher,anna,"A1","2030-01-01","12:00");String a2=create(teacher,anna,"A2","2030-01-07","18:00");create(teacher,boris,"B1","2030-01-07","09:30");
        String a3=create(teacher,anna,"A3","2030-01-13","12:00");create(teacher,anna,"A0","2030-01-07","08:00");create(teacher,anna,"A4","2030-01-14","12:00");
        data(write(teacher.client(),"PUT",card(teacher,anna)+"/lessons/"+a3+"/texts/studentNotes",Map.of("markdown","Задачи","revision",1)),200);
        data(write(teacher.client(),"PUT",card(teacher,anna)+"/lessons/"+a3+"/texts/teacherNotes",Map.of("markdown","private-plan","revision",1)),200);
        // A foreign workspace holding a card and a lesson with the very same IDs.
        jdbc.update("INSERT INTO student_profile(workspace_id,id,name,direction,goal,schedule,notes,student_roadmap,student_review,created_at) VALUES (?,?,'Foreign','','','','','','',now())",other.workspace(),anna);
        jdbc.update("INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,created_at) VALUES (?,?,?,'Foreign lesson','2030-01-08','10:00',60,now())",other.workspace(),anna,a2);
        String route=card(teacher,anna)+"/schedule";
        var body=data(get(learner.client(),route+"?from=2030-01-07&to=2030-01-13"),200);
        assertEquals("2030-01-07",body.get("from").asText());assertEquals("2030-01-13",body.get("to").asText());
        assertEquals(List.of("A0","A2","A3"),titles(body));
        var items=body.get("items");
        assertEquals(2,items.get(0).get("number").asLong());assertEquals(3,items.get(1).get("number").asLong());assertEquals(4,items.get(2).get("number").asLong());
        assertEquals(a2,items.get(1).get("id").asText());assertEquals(anna,items.get(1).get("studentId").asText());
        assertTrue(items.get(2).get("hasStudentNotes").asBoolean());assertFalse(items.get(1).get("hasStudentNotes").asBoolean());
        assertFalse(body.toString().contains("private-plan"));assertFalse(body.toString().contains("Задачи"));assertFalse(items.get(0).has("studentName"));
        // The teacher of the workspace reads the same calendar for the preview.
        assertEquals(List.of("A0","A2","A3"),titles(data(get(teacher.client(),route+"?from=2030-01-07&to=2030-01-13"),200)));
        // An archived card stays readable by its own student.
        long revision=data(get(teacher.client(),card(teacher,anna)),200).get("revision").asLong();
        data(write(teacher.client(),"PATCH",card(teacher,anna),Map.of("revision",revision,"archived",true)),200);
        assertEquals(List.of("A4"),titles(data(get(learner.client(),route+"?from=2030-01-14&to=2030-01-14"),200)));
        // One to 31 days inclusive, real calendar dates, both bounds required.
        assertEquals(200,get(learner.client(),route+"?from=2030-01-01&to=2030-01-31").statusCode());
        for(String query:List.of("?from=2030-01-01&to=2030-02-01","?from=2030-01-13&to=2030-01-07","?from=2030-02-30&to=2030-03-01","?from=2030-01-07","?to=2030-01-07","?from=7.1.2030&to=2030-01-07"))
            assertEquals(400,get(learner.client(),route+query).statusCode(),query);
        // Another student of the same workspace, another teacher, the administrator and an anonymous caller get nothing.
        assertEquals(404,get(neighbour.client(),route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(other.client(),"/workspaces/"+teacher.workspace()+"/students/"+anna+"/schedule?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(admin,route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(401,get(client(),route+"?from=2030-01-07&to=2030-01-13").statusCode());
        assertEquals(404,get(neighbour.client(),route+"?from=bad&to=bad").statusCode(),"access is checked before input");
        assertEquals(404,get(teacher.client(),"/workspaces/"+teacher.workspace()+"/students/missing-card/schedule?from=2030-01-07&to=2030-01-13").statusCode());
        // The neighbour's own calendar holds only the neighbour's lesson.
        assertEquals(List.of("B1"),titles(data(get(neighbour.client(),card(teacher,boris)+"/schedule?from=2030-01-07&to=2030-01-07"),200)));
    }
}
