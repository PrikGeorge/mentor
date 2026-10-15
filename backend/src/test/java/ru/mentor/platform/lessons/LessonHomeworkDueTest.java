package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LessonHomeworkDueTest extends IdentityHttpTest {
    private static final ZoneId MOSCOW=ZoneId.of("Europe/Moscow");
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);
    private static Map<String,Object> due(Instant at){var local=at.atZone(MOSCOW);return Map.of("date",local.toLocalDate().toString(),"time",String.format("%02d:%02d",local.getHour(),local.getMinute()));}
    private static Map<String,Object> lesson(String title,Instant start,Object due){
        var local=start.atZone(MOSCOW);Map<String,Object> body=new HashMap<>(Map.of("title",title,"date",local.toLocalDate().toString(),"time",String.format("%02d:%02d",local.getHour(),local.getMinute()),"duration",60));
        if(due!=null)body.put("homeworkDue",due);return body;
    }

    // Catches a deadline that is lost, leaks a wrong state, blocks late work, precedes the lesson or survives an explicit null.
    @Test void deadlineStatesFollowTheFirstWorkAndTheClock() throws Exception {
        var teacher=teacher("due-teacher");String student=student(teacher,"Due student").get("id").asText();var learner=enroll(teacher,student,"due-learner");
        String lessons=card(teacher,student)+"/lessons";
        Instant now=CLOCK.instant().truncatedTo(ChronoUnit.MINUTES),start=now.minus(Duration.ofHours(2)),deadline=now.plus(Duration.ofHours(1));
        var created=data(write(teacher.client(),"POST",lessons,lesson("With deadline",start,due(deadline))),201);
        assertEquals(due(deadline).get("date"),created.get("homeworkDue").get("date").asText());assertEquals(due(deadline).get("time"),created.get("homeworkDue").get("time").asText());
        assertEquals("open",created.get("homeworkDue").get("state").asText());
        String path=lessons+"/"+created.get("id").asText();
        // The student, the list, the dashboard focus and the schedule all carry the same deadline.
        assertEquals("open",data(get(learner.client(),path),200).get("homeworkDue").get("state").asText());
        assertEquals("open",data(get(learner.client(),lessons),200).get("items").get(0).get("homeworkDue").get("state").asText());
        String day=start.atZone(MOSCOW).toLocalDate().toString();
        assertEquals("open",data(get(teacher.client(),"/workspaces/"+teacher.workspace()+"/schedule?from="+day+"&to="+day),200).get("items").get(0).get("lesson").get("homeworkDue").get("state").asText());
        CLOCK.advance(Duration.ofHours(2));
        assertEquals("overdue",data(get(teacher.client(),path),200).get("homeworkDue").get("state").asText());
        assertEquals("overdue",data(get(teacher.client(),card(teacher,student)+"/dashboard"),200).get("focus").get("lesson").get("homeworkDue").get("state").asText());
        // Late work is accepted and turns the lesson into «late», for both roles.
        data(uploadHomework(learner,path+"/homework","Main.java",TEXT,null),201);
        assertEquals("late",data(get(teacher.client(),path),200).get("homeworkDue").get("state").asText());
        assertEquals("late",data(get(learner.client(),path),200).get("homeworkDue").get("state").asText());

        // Work before the deadline is on time, also when the deadline is set afterwards.
        Instant later=CLOCK.instant().truncatedTo(ChronoUnit.MINUTES);
        var second=data(write(teacher.client(),"POST",lessons,lesson("Set afterwards",later.minus(Duration.ofHours(1)),null)),201);
        assertFalse(second.has("homeworkDue"));String secondPath=lessons+"/"+second.get("id").asText();
        data(uploadHomework(learner,secondPath+"/homework","Main.java",TEXT,null),201);
        var dated=data(write(teacher.client(),"PATCH",secondPath,Map.of("revision",1,"homeworkDue",due(later.plus(Duration.ofDays(1))))),200);
        assertEquals("onTime",dated.get("homeworkDue").get("state").asText());assertEquals(2,dated.get("revision").asLong());
        // Absent keeps it, an unrelated change keeps it, null removes it.
        var kept=data(write(teacher.client(),"PATCH",secondPath,Map.of("revision",2,"title","Renamed")),200);assertEquals(dated.get("homeworkDue"),kept.get("homeworkDue"));
        Map<String,Object> clear=new HashMap<>();clear.put("revision",3);clear.put("homeworkDue",null);
        assertFalse(data(write(teacher.client(),"PATCH",secondPath,clear),200).has("homeworkDue"));

        // Validation: exact {date, time}, a real date and time, never before the lesson start (also after moving the lesson).
        for(Object bad:List.of(Map.of("date","2030-01-01"),Map.of("date","2030-01-01","time","12:00","zone","UTC"),Map.of("date","2030-02-30","time","12:00"),Map.of("date","2030-01-01","time","24:00"),"2030-01-01T12:00"))
            assertEquals(400,write(teacher.client(),"POST",lessons,lesson("Bad",Instant.parse("2030-01-01T09:00:00Z"),bad)).statusCode(),String.valueOf(bad));
        assertEquals(400,write(teacher.client(),"POST",lessons,lesson("Too early",Instant.parse("2030-01-01T09:00:00Z"),Map.of("date","2030-01-01","time","11:59"))).statusCode());
        var edge=data(write(teacher.client(),"POST",lessons,lesson("At start",Instant.parse("2030-01-01T09:00:00Z"),Map.of("date","2030-01-01","time","12:00"))),201);
        assertEquals("12:00",edge.get("homeworkDue").get("time").asText());
        assertEquals(400,write(teacher.client(),"PATCH",lessons+"/"+edge.get("id").asText(),Map.of("revision",1,"time","12:30")).statusCode());
        // Only the owning teacher sets it.
        assertEquals(404,write(learner.client(),"PATCH",path,Map.of("revision",1,"homeworkDue",due(later))).statusCode());
        JsonNode stored=data(get(teacher.client(),path),200);assertEquals("late",stored.get("homeworkDue").get("state").asText());
    }
}
