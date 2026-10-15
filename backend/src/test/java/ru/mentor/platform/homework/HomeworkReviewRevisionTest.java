package ru.mentor.platform.homework;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** The grade and the status of a review are CAS-guarded by revision; a stale form never changes the sign (Q-06). */
class HomeworkReviewRevisionTest extends IdentityHttpTest {
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);

    private record Fixture(User teacher,User learner,String student,String lesson,String homework,String moves){}
    private Fixture fixture(String login)throws Exception {
        var teacher=teacher(login);String student=student(teacher,"Synthetic review student").get("id").asText();var learner=enroll(teacher,student,login+"-student");
        String lesson=lesson(teacher,student,"Reviewed lesson","2030-01-01");
        return new Fixture(teacher,learner,student,lesson,card(teacher,student)+"/lessons/"+lesson+"/homework",card(teacher,student)+"/moves");
    }
    private Map<String,Object> review(long revision,String status,String feedback,String grade){Map<String,Object> body=new HashMap<>(Map.of("revision",revision,"status",status,"feedback",feedback));body.put("grade",grade);return body;}
    private Map<String,Object> review(long revision,String status,String feedback){return Map.of("revision",revision,"status",status,"feedback",feedback);}
    private JsonNodeCheck stored(Fixture f)throws Exception{return new JsonNodeCheck(data(get(f.learner().client(),f.homework()),200).get("items").get(0));}
    private record JsonNodeCheck(tools.jackson.databind.JsonNode node){
        String status(){return node.get("status").asText();}String grade(){return node.has("grade")?node.get("grade").asText():null;}long revision(){return node.get("revision").asLong();}String feedback(){return node.get("feedback").asText();}
    }

    // Catches a stale revision changing the grade or the status, and a conflict bumping the revision or the reviewed instant.
    @Test void staleRevisionNeverChangesGradeOrStatus()throws Exception {
        var f=fixture("review-stale");var work=data(uploadHomework(f.learner(),f.homework(),"Main.java",TEXT,null),201);String path=f.homework()+"/"+work.get("id").asText()+"/review";
        CLOCK.advance(Duration.ofSeconds(1));
        var graded=data(write(f.teacher().client(),"PATCH",path,review(1,"reviewed","Хорошо","good")),200);assertEquals(2,graded.get("revision").asLong());assertEquals("good",graded.get("grade").asText());
        CLOCK.advance(Duration.ofSeconds(1));
        // The same stale revision with another grade, another status, or both: a conflict every time, and nothing moves.
        for(var stale:List.of(review(1,"reviewed","Хорошо","mistake"),review(1,"needs_revision","Переделать","dubious"),review(1,"needs_revision","Переделать"),review(3,"reviewed","Хорошо","excellent"),review(99,"reviewed","Хорошо","good"))){
            var response=write(f.teacher().client(),"PATCH",path,stale);assertEquals(409,response.statusCode(),stale.toString());assertEquals("REVISION_CONFLICT",data(response,409).get("code").asText());
            var now=stored(f);assertEquals("reviewed",now.status());assertEquals("good",now.grade());assertEquals(2,now.revision());assertEquals("Хорошо",now.feedback());assertEquals(graded.get("reviewedAt"),now.node().get("reviewedAt"));
        }
        var move=data(get(f.learner().client(),f.moves()),200).get("items").get(0);assertEquals("review",move.get("kind").asText());assertEquals("good",move.get("grade").asText());
        // Only the current revision changes the status; the grade travels with that save.
        var revised=data(write(f.teacher().client(),"PATCH",path,review(2,"needs_revision","Переделать","mistake")),200);
        assertEquals(3,revised.get("revision").asLong());assertEquals("needs_revision",revised.get("status").asText());assertEquals("mistake",revised.get("grade").asText());assertNotEquals(graded.get("reviewedAt"),revised.get("reviewedAt"));
        assertEquals(409,write(f.teacher().client(),"PATCH",path,review(2,"reviewed","Снова","excellent")).statusCode());assertEquals("mistake",stored(f).grade());assertEquals("needs_revision",stored(f).status());
        move=data(get(f.learner().client(),f.moves()),200).get("items").get(0);assertEquals("mistake",move.get("grade").asText());assertEquals("needs_revision",move.get("status").asText());
        assertEquals(2,data(get(f.learner().client(),f.moves()),200).get("total").asLong(),"One work and one review move, showing the current review.");
    }

    // Catches an omitted grade silently keeping the old sign, or a null grade being rejected as invalid.
    @Test void emptyGradeClearsTheSignWhileStatusAndFeedbackStay()throws Exception {
        var f=fixture("review-clear");var work=data(uploadHomework(f.learner(),f.homework(),"Main.java",TEXT,null),201);String path=f.homework()+"/"+work.get("id").asText()+"/review";
        CLOCK.advance(Duration.ofSeconds(1));var graded=data(write(f.teacher().client(),"PATCH",path,review(1,"reviewed","Отлично","excellent")),200);assertEquals("excellent",graded.get("grade").asText());
        // An absent grade field clears the sign.
        var cleared=data(write(f.teacher().client(),"PATCH",path,review(2,"reviewed","Отлично")),200);
        assertFalse(cleared.has("grade"));assertEquals("reviewed",cleared.get("status").asText());assertEquals("Отлично",cleared.get("feedback").asText());assertEquals(3,cleared.get("revision").asLong());
        assertNull(stored(f).grade());assertNull(jdbc.queryForObject("SELECT grade FROM homework_submission WHERE id=?",String.class,work.get("id").asText()));
        var move=data(get(f.learner().client(),f.moves()),200).get("items").get(0);assertEquals("review",move.get("kind").asText());assertFalse(move.has("grade"));
        // An explicit null grade clears it as well, also when the status changes in the same save.
        var regraded=data(write(f.teacher().client(),"PATCH",path,review(3,"reviewed","Отлично","good")),200);assertEquals("good",regraded.get("grade").asText());
        var nulled=data(write(f.teacher().client(),"PATCH",path,review(4,"needs_revision","Ещё раз",null)),200);
        assertFalse(nulled.has("grade"));assertEquals("needs_revision",nulled.get("status").asText());assertEquals(5,nulled.get("revision").asLong());assertNull(stored(f).grade());
        // Clearing with a stale revision is a conflict and the sign survives.
        data(write(f.teacher().client(),"PATCH",path,review(5,"reviewed","Готово","interesting")),200);
        assertEquals(409,write(f.teacher().client(),"PATCH",path,review(5,"reviewed","Готово")).statusCode());assertEquals("interesting",stored(f).grade());
        assertEquals(409,write(f.teacher().client(),"PATCH",path,review(5,"reviewed","Готово",null)).statusCode());assertEquals("interesting",stored(f).grade());
        // A new work of the same lesson starts without a sign and does not inherit the previous one.
        CLOCK.advance(Duration.ofSeconds(1));var again=data(uploadHomework(f.learner(),f.homework(),"Main.java",TEXT,null),201);assertFalse(again.has("grade"));assertEquals("submitted",again.get("status").asText());
        assertEquals("interesting",data(get(f.learner().client(),f.homework()),200).get("items").get(1).get("grade").asText());
    }

    // Catches two browsers of one teacher both grading the same revision: only one sign lands, the other must refresh.
    @Test void twoTeacherBrowsersCannotBothGradeTheSameRevision()throws Exception {
        var f=fixture("review-race");var work=data(uploadHomework(f.learner(),f.homework(),"Main.java",TEXT,null),201);String path=f.homework()+"/"+work.get("id").asText()+"/review";
        var second=login("review-race");
        try(var pool=Executors.newFixedThreadPool(2)){
            var go=new CountDownLatch(1);
            var a=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return write(f.teacher().client(),"PATCH",path,review(1,"reviewed","Первый","excellent"));});
            var b=pool.submit(()->{assertTrue(go.await(5,TimeUnit.SECONDS));return write(second,"PATCH",path,review(1,"needs_revision","Второй","mistake"));});
            go.countDown();var first=a.get(15,TimeUnit.SECONDS);var other=b.get(15,TimeUnit.SECONDS);
            assertEquals(List.of(200,409),java.util.stream.Stream.of(first.statusCode(),other.statusCode()).sorted().toList());
            var winner=json.readTree(first.statusCode()==200?first.body():other.body());var now=stored(f);
            assertEquals(2,now.revision());assertEquals(winner.get("grade").asText(),now.grade());assertEquals(winner.get("status").asText(),now.status());assertEquals(winner.get("feedback").asText(),now.feedback());
        }
    }
}
