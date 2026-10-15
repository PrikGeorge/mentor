package ru.mentor.platform.homework;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Whose turn it is on the edge cases of the homework exchange: lesson dates, resubmission, review without a grade, idle students (Q-08). */
class HomeworkTurnsTest extends IdentityHttpTest {
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);

    private record Fixture(User teacher,User learner,String student){
        String turns(){return "/workspaces/"+teacher.workspace()+"/students/"+student+"/homework/turns";}
        String queue(){return "/workspaces/"+teacher.workspace()+"/homework/turns";}
        String homework(String lesson){return "/workspaces/"+teacher.workspace()+"/students/"+student+"/lessons/"+lesson+"/homework";}
    }
    private Fixture fixture(String login)throws Exception {var teacher=teacher(login);String student=student(teacher,"Synthetic turns student").get("id").asText();return new Fixture(teacher,enroll(teacher,student,login+"-student"),student);}
    private JsonNode upload(Fixture f,String lesson,String name)throws Exception{var r=data(uploadHomework(f.learner(),f.homework(lesson),name,TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));return r;}
    private JsonNode review(Fixture f,String lesson,JsonNode work,long revision,String status,String grade)throws Exception {
        Map<String,Object> body=new HashMap<>(Map.of("revision",revision,"status",status,"feedback","feedback"));if(grade!=null)body.put("grade",grade);
        var r=data(write(f.teacher().client(),"PATCH",f.homework(lesson)+"/"+work.get("id").asText()+"/review",body),200);CLOCK.advance(Duration.ofSeconds(1));return r;
    }
    private List<String> lessons(JsonNode page){var out=new ArrayList<String>();page.get("items").forEach(i->out.add(i.get("lessonId").asText()));return out;}
    private JsonNode row(Fixture f)throws Exception{var page=data(get(f.teacher().client(),f.queue()),200);assertEquals(1,page.get("total").asLong());return page.get("items").get(0);}

    // Catches turns sorted by the lesson calendar instead of the exchange, and the queue picking the newest instead of the oldest waiting work.
    @Test void turnsFollowTheExchangeNotTheLessonCalendar()throws Exception {
        var f=fixture("turns-calendar");
        String early=lesson(f.teacher(),f.student(),"Early","2030-01-01"),middle=lesson(f.teacher(),f.student(),"Middle","2030-02-01"),late=lesson(f.teacher(),f.student(),"Late","2030-03-01");
        var onLate=upload(f,late,"late.java");var onEarly=upload(f,early,"early.java");
        // The lesson with the later calendar date got the earlier work: turns list by exchange time, the queue waits on the oldest.
        var turns=data(get(f.learner().client(),f.turns()),200);assertEquals(2,turns.get("total").asLong());assertEquals(List.of(early,late),lessons(turns));
        turns.get("items").forEach(item->{assertEquals("submitted",item.get("status").asText());assertEquals("homework",item.get("kind").asText());assertFalse(item.has("reviewedAt"));});
        var row=row(f);assertEquals(late,row.get("lessonId").asText());assertEquals("Late",row.get("lessonTitle").asText());assertEquals("2030-03-01",row.get("lessonDate").asText());assertEquals(onLate.get("id"),row.get("submissionId"));assertEquals(2,row.get("awaitingReview").asLong());
        // Reviewing the oldest moves the queue to the next waiting work; the lesson order of the turns stays by time.
        review(f,late,onLate,1,"reviewed","good");
        row=row(f);assertEquals(early,row.get("lessonId").asText());assertEquals(onEarly.get("id"),row.get("submissionId"));assertEquals(1,row.get("awaitingReview").asLong());assertEquals("submitted",row.get("status").asText());
        turns=data(get(f.learner().client(),f.turns()),200);assertEquals(List.of(early,late),lessons(turns));assertEquals("reviewed",turns.get("items").get(1).get("status").asText());assertTrue(turns.get("items").get(1).hasNonNull("reviewedAt"));
        // Once nothing waits, the row shows the latest exchange, which is the review of the early lesson.
        review(f,early,onEarly,1,"needs_revision",null);
        row=row(f);assertEquals(early,row.get("lessonId").asText());assertEquals("needs_revision",row.get("status").asText());assertEquals(0,row.get("awaitingReview").asLong());assertTrue(row.hasNonNull("reviewedAt"));
        // The middle lesson never had work and never appears.
        assertEquals(2,data(get(f.learner().client(),f.turns()),200).get("total").asLong());assertFalse(lessons(data(get(f.learner().client(),f.turns()),200)).contains(middle));
        // Work on the middle lesson becomes the newest exchange and the only one waiting.
        var onMiddle=upload(f,middle,"middle.java");
        turns=data(get(f.learner().client(),f.turns()),200);assertEquals(List.of(middle,early,late),lessons(turns));
        row=row(f);assertEquals(middle,row.get("lessonId").asText());assertEquals(onMiddle.get("id"),row.get("submissionId"));assertEquals(1,row.get("awaitingReview").asLong());assertEquals("2030-02-01",row.get("lessonDate").asText());
    }

    // Catches a resubmission after "needs revision" staying on the student's side, and a review without a grade not counting as the mentor's answer.
    @Test void resubmissionReturnsTheMoveToTheMentorAndAnUngradedReviewHandsItBack()throws Exception {
        var f=fixture("turns-resubmit");String lesson=lesson(f.teacher(),f.student(),"Resubmitted","2030-01-01");
        var first=upload(f,lesson,"first.java");
        var row=row(f);assertEquals("submitted",row.get("status").asText());assertEquals(1,row.get("awaitingReview").asLong());
        // A review without any grade is still the mentor's answer: the student's turn.
        var reviewed=review(f,lesson,first,1,"needs_revision",null);assertFalse(reviewed.has("grade"));
        var turn=data(get(f.learner().client(),f.turns()),200).get("items").get(0);assertEquals("needs_revision",turn.get("status").asText());assertEquals(first.get("id"),turn.get("submissionId"));assertTrue(turn.hasNonNull("reviewedAt"));
        row=row(f);assertEquals("needs_revision",row.get("status").asText());assertEquals(0,row.get("awaitingReview").asLong());
        // The corrected work returns the move to the mentor: a new id, no reviewed instant, awaiting again.
        var second=upload(f,lesson,"second.java");
        turn=data(get(f.learner().client(),f.turns()),200).get("items").get(0);assertEquals("submitted",turn.get("status").asText());assertEquals(second.get("id"),turn.get("submissionId"));assertEquals("second.java",turn.get("filename").asText());assertFalse(turn.has("reviewedAt"));
        assertEquals(1,data(get(f.learner().client(),f.turns()),200).get("total").asLong(),"One lesson, one turn, whatever the number of works.");
        row=row(f);assertEquals("submitted",row.get("status").asText());assertEquals(second.get("id"),row.get("submissionId"));assertEquals(1,row.get("awaitingReview").asLong());assertFalse(row.has("reviewedAt"));
        // Reviewing the older work again does not move the turn: the latest exchange of the lesson is still the new work.
        review(f,lesson,first,2,"reviewed","good");
        turn=data(get(f.learner().client(),f.turns()),200).get("items").get(0);assertEquals("submitted",turn.get("status").asText());assertEquals(second.get("id"),turn.get("submissionId"));
        row=row(f);assertEquals(1,row.get("awaitingReview").asLong());assertEquals(second.get("id"),row.get("submissionId"));
        // Accepting the new work closes the exchange; the preview for the teacher equals the student's view.
        review(f,lesson,second,1,"reviewed","excellent");
        var turns=data(get(f.learner().client(),f.turns()),200);assertEquals("reviewed",turns.get("items").get(0).get("status").asText());assertEquals(turns,data(get(f.teacher().client(),f.turns()+"?audience=student"),200));
        row=row(f);assertEquals("reviewed",row.get("status").asText());assertEquals(0,row.get("awaitingReview").asLong());
    }

    // Catches an idle student appearing in the queue, a student without lessons breaking the lesson turns, and totals counting lessons instead of students.
    @Test void studentsWithoutWorkHaveNoTurnAndDoNotEnterTheQueue()throws Exception {
        var f=fixture("turns-idle");String lesson=lesson(f.teacher(),f.student(),"Planned only","2030-01-01");
        String idle=student(f.teacher(),"Idle student").get("id").asText();var idleLearner=enroll(f.teacher(),idle,"turns-idle-second");lesson(f.teacher(),idle,"Idle lesson","2030-01-02");
        String noLessons=student(f.teacher(),"No lessons").get("id").asText();
        String idleTurns="/workspaces/"+f.teacher().workspace()+"/students/"+idle+"/homework/turns",bareTurns="/workspaces/"+f.teacher().workspace()+"/students/"+noLessons+"/homework/turns";
        // Lessons without work give no turn; a card without lessons answers an empty page, not an error.
        for(String path:List.of(f.turns(),idleTurns,bareTurns)){var page=data(get(f.teacher().client(),path),200);assertEquals(0,page.get("total").asLong());assertEquals(0,page.get("items").size());}
        assertEquals(0,data(get(idleLearner.client(),idleTurns),200).get("total").asLong());
        var queue=data(get(f.teacher().client(),f.queue()),200);assertEquals(0,queue.get("total").asLong());assertEquals(0,queue.get("items").size());
        // Two works of one student make one queue row; the idle students still do not appear, and each student reads only their own turns.
        upload(f,lesson,"one.java");upload(f,lesson,"two.java");
        queue=data(get(f.teacher().client(),f.queue()),200);assertEquals(1,queue.get("total").asLong());assertEquals(f.student(),queue.get("items").get(0).get("studentId").asText());
        assertEquals(0,data(get(idleLearner.client(),idleTurns),200).get("total").asLong());assertEquals(404,get(idleLearner.client(),f.turns()).statusCode());assertEquals(404,get(f.learner().client(),idleTurns).statusCode());
        assertEquals(404,get(idleLearner.client(),f.queue()).statusCode());
        // The idle student's first work adds a second row, oldest waiting first.
        String idleLesson=data(get(f.teacher().client(),"/workspaces/"+f.teacher().workspace()+"/students/"+idle+"/lessons"),200).get("items").get(0).get("id").asText();
        data(uploadHomework(idleLearner,"/workspaces/"+f.teacher().workspace()+"/students/"+idle+"/lessons/"+idleLesson+"/homework","idle.java",TEXT,null),201);
        queue=data(get(f.teacher().client(),f.queue()),200);assertEquals(2,queue.get("total").asLong());assertEquals(f.student(),queue.get("items").get(0).get("studentId").asText());assertEquals(idle,queue.get("items").get(1).get("studentId").asText());
        assertEquals("Idle student",queue.get("items").get(1).get("studentName").asText());assertEquals(1,queue.get("items").get(1).get("awaitingReview").asLong());
        assertEquals(1,data(get(f.teacher().client(),f.queue()+"?page=1&size=1"),200).get("items").size());assertEquals(2,data(get(f.teacher().client(),f.queue()+"?page=1&size=1"),200).get("total").asLong());
    }
}
