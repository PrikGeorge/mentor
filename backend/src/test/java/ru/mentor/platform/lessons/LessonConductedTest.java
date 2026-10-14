package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LessonConductedTest extends IdentityHttpTest {
    // Catches numbering by creation instead of the calendar, an implicit "held" claim, a moving first mark and a student editing the mark.
    @Test void numberFollowsTheCalendarAndConductedIsAnExplicitTeacherMark() throws Exception {
        var teacher=teacher("lesson-conducted");String student=student(teacher,"Conducted student").get("id").asText();var learner=enroll(teacher,student,"lesson-conducted-student");
        String lessons=card(teacher,student)+"/lessons";
        var later=data(write(teacher.client(),"POST",lessons,Map.of("title","Later","date","2030-02-01","time","12:00","duration",60)),201);
        var earlier=data(write(teacher.client(),"POST",lessons,Map.of("title","Earlier","date","2030-01-01","time","12:00","duration",60)),201);
        assertEquals(1,earlier.get("number").asLong());assertEquals(2,data(get(teacher.client(),lessons+"/"+later.get("id").asText()),200).get("number").asLong());
        var page=data(get(learner.client(),lessons),200).get("items");assertEquals("Later",page.get(0).get("title").asText());assertEquals(2,page.get(0).get("number").asLong());assertEquals(1,page.get(1).get("number").asLong());
        assertFalse(earlier.has("conductedAt"));
        String path=lessons+"/"+earlier.get("id").asText();
        var marked=data(write(teacher.client(),"PATCH",path,Map.of("revision",1,"conducted",true)),200);
        assertTrue(marked.hasNonNull("conductedAt"));assertEquals("Earlier",marked.get("title").asText());assertEquals(2,marked.get("revision").asLong());
        var again=data(write(teacher.client(),"PATCH",path,Map.of("revision",2,"conducted",true,"title","Earlier lesson")),200);
        assertEquals(marked.get("conductedAt"),again.get("conductedAt"));assertEquals("Earlier lesson",again.get("title").asText());
        assertEquals(400,write(teacher.client(),"PATCH",path,Map.of("revision",3,"conducted","yes")).statusCode());
        assertEquals(404,write(learner.client(),"PATCH",path,Map.of("revision",3,"conducted",false)).statusCode());
        assertTrue(data(get(learner.client(),path),200).hasNonNull("conductedAt"));
        var move=data(get(learner.client(),card(teacher,student)+"/moves"),200).get("items").get(0);
        assertEquals("conducted",move.get("kind").asText());assertEquals("teacher",move.get("side").asText());assertEquals(earlier.get("id").asText(),move.get("lessonId").asText());
        var unmarked=data(write(teacher.client(),"PATCH",path,Map.of("revision",3,"conducted",false)),200);assertFalse(unmarked.has("conductedAt"));
        assertEquals(0,data(get(learner.client(),card(teacher,student)+"/moves"),200).get("total").asLong());
    }
}
