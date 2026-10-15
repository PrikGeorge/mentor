package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class LessonConductedTest extends IdentityHttpTest {
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);

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

    // Catches a stale form flipping the mark, and unmarking a lesson taking the review or the grade of its homework with it.
    @Test void staleRevisionIsRefusedAndUnmarkingKeepsReviewsAndGrades()throws Exception {
        var teacher=teacher("conducted-stale");String student=student(teacher,"Stale student").get("id").asText();var learner=enroll(teacher,student,"conducted-stale-student");
        String lesson=lesson(teacher,student,"Reviewed lesson","2030-01-01"),path=card(teacher,student)+"/lessons/"+lesson,homework=path+"/homework",moves=card(teacher,student)+"/moves";
        var work=data(uploadHomework(learner,homework,"Main.java",TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));
        String review=homework+"/"+work.get("id").asText()+"/review";
        var graded=data(write(teacher.client(),"PATCH",review,Map.of("revision",1,"status","reviewed","feedback","Отлично","grade","excellent")),200);assertEquals("excellent",graded.get("grade").asText());CLOCK.advance(Duration.ofSeconds(1));
        var marked=data(write(teacher.client(),"PATCH",path,Map.of("revision",1,"conducted",true)),200);assertEquals(2,marked.get("revision").asLong());String heldAt=marked.get("conductedAt").asText();
        // The revision the first form still holds is stale: nothing changes, and the answer names the conflict.
        var stale=write(teacher.client(),"PATCH",path,Map.of("revision",1,"conducted",false));assertEquals(409,stale.statusCode());assertEquals("REVISION_CONFLICT",data(stale,409).get("code").asText());
        var current=data(get(teacher.client(),path),200);assertEquals(heldAt,current.get("conductedAt").asText());assertEquals(2,current.get("revision").asLong());
        assertEquals(409,write(teacher.client(),"PATCH",path,Map.of("revision",3,"conducted",false)).statusCode());
        assertEquals(409,write(teacher.client(),"PATCH",path,Map.of("revision",1,"title","Renamed")).statusCode());assertEquals("Reviewed lesson",data(get(teacher.client(),path),200).get("title").asText());
        var journal=data(get(learner.client(),moves),200);assertEquals(3,journal.get("total").asLong());assertEquals("conducted",journal.get("items").get(0).get("kind").asText());assertEquals("review",journal.get("items").get(1).get("kind").asText());
        // Unmarking removes only the held-lesson move; the review, its grade and the work stay.
        var unmarked=data(write(teacher.client(),"PATCH",path,Map.of("revision",2,"conducted",false)),200);assertFalse(unmarked.has("conductedAt"));assertEquals(3,unmarked.get("revision").asLong());
        journal=data(get(learner.client(),moves),200);assertEquals(2,journal.get("total").asLong());
        var reviewMove=journal.get("items").get(0);assertEquals("review",reviewMove.get("kind").asText());assertEquals("excellent",reviewMove.get("grade").asText());assertEquals("Отлично",reviewMove.get("detail").asText());assertEquals("reviewed",reviewMove.get("status").asText());
        assertEquals("homework",journal.get("items").get(1).get("kind").asText());
        var stored=data(get(learner.client(),homework),200).get("items").get(0);assertEquals("reviewed",stored.get("status").asText());assertEquals("excellent",stored.get("grade").asText());assertEquals(2,stored.get("revision").asLong());assertEquals(graded.get("reviewedAt"),stored.get("reviewedAt"));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM homework_submission WHERE grade='excellent' AND status='reviewed'",Integer.class));
        // Marking again after unmarking starts a new instant rather than reviving the old one.
        CLOCK.advance(Duration.ofSeconds(5));var remarked=data(write(teacher.client(),"PATCH",path,Map.of("revision",3,"conducted",true)),200);
        assertTrue(remarked.hasNonNull("conductedAt"));assertNotEquals(heldAt,remarked.get("conductedAt").asText());assertEquals(CLOCK.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS).toString(),remarked.get("conductedAt").asText());
        assertEquals(3,data(get(learner.client(),moves),200).get("total").asLong());
    }

    // Catches two browsers of the same teacher both winning the same revision, or the loser's stale form overwriting the winner.
    @Test void twoTeacherClientsRaceOnOneRevisionAndOnlyOneWins()throws Exception {
        var teacher=teacher("conducted-race");String student=student(teacher,"Race student").get("id").asText();
        String path=card(teacher,student)+"/lessons/"+lesson(teacher,student,"Raced lesson","2030-01-01");
        var second=login("conducted-race");assertEquals(teacher.id(),session(second).get("account").get("userId").asText());
        assertEquals(1,data(get(second,path),200).get("revision").asLong());
        try(var pool=Executors.newFixedThreadPool(2)){
            var go=new CountDownLatch(1);
            var a=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return write(teacher.client(),"PATCH",path,Map.of("revision",1,"conducted",true));});
            var b=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return write(second,"PATCH",path,Map.of("revision",1,"conducted",true,"title","Renamed by the second browser"));});
            go.countDown();var first=a.get(15,TimeUnit.SECONDS);var other=b.get(15,TimeUnit.SECONDS);
            assertEquals(List.of(200,409),java.util.stream.Stream.of(first.statusCode(),other.statusCode()).sorted().toList());
            var winner=json.readTree(first.statusCode()==200?first.body():other.body());assertEquals(2,winner.get("revision").asLong());assertTrue(winner.hasNonNull("conductedAt"));
            var loser=json.readTree(first.statusCode()==409?first.body():other.body());assertEquals("REVISION_CONFLICT",loser.get("code").asText());
            var stored=data(get(second,path),200);assertEquals(2,stored.get("revision").asLong());assertEquals(winner.get("conductedAt"),stored.get("conductedAt"));
            // The loser changed nothing: the title is the one the winner sent, whichever browser that was.
            assertEquals(first.statusCode()==200?"Raced lesson":"Renamed by the second browser",stored.get("title").asText());
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM lesson WHERE conducted_at IS NOT NULL",Integer.class));
        }
        // Both browsers refresh; the one that edits first moves the revision, the other must refresh again before unmarking.
        assertEquals(3,data(write(teacher.client(),"PATCH",path,Map.of("revision",2,"title","Refreshed")),200).get("revision").asLong());
        assertEquals(409,write(second,"PATCH",path,Map.of("revision",2,"conducted",false)).statusCode());
        var current=data(get(second,path),200);assertTrue(current.hasNonNull("conductedAt"));assertEquals("Refreshed",current.get("title").asText());
        assertEquals(4,data(write(second,"PATCH",path,Map.of("revision",3,"conducted",false)),200).get("revision").asLong());assertFalse(data(get(teacher.client(),path),200).has("conductedAt"));
    }
}
