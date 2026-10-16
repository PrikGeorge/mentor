package ru.mentor.platform.homework;

import org.junit.jupiter.api.*;
import ru.mentor.platform.support.IdentityHttpTest;
import ru.mentor.platform.files.BlobService;
import ru.mentor.platform.files.BlobStore;
import tools.jackson.databind.JsonNode;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import ru.mentor.platform.lessons.LessonRef;
import static org.junit.jupiter.api.Assertions.*;

/** The mentor side — inline text works, grades, line comments, turns and the review form (Q-20). */
class HomeworkReviewTest extends HomeworkHttpTest {
    // Catches archives being opened as text, marks without a known sign, line comments outside the file or by the student, and missing moves.
    @Test void singleTextWorksShowInlineWithGradesLineCommentsAndMoves()throws Exception {
        var f=fixture("hw-lines");byte[] source="class Main {\n  void run() {}\n}\n".getBytes(StandardCharsets.UTF_8);
        var text=data(upload(f.learner(),f.path(),"Main.java",source," single file ",""),201);CLOCK.advance(Duration.ofSeconds(1));
        var zip=data(upload(f.learner(),f.path(),"project.zip",new byte[]{0x50,0x4b,3,4},"",""),201);CLOCK.advance(Duration.ofSeconds(1));
        String textId=text.get("id").asText(),zipId=zip.get("id").asText();
        var view=data(get(f.learner().client(),f.path()+"/"+textId+"/text"),200);
        assertEquals(Set.of("filename","text"),view.propertyNames());assertEquals("Main.java",view.get("filename").asText());assertEquals(new String(source,StandardCharsets.UTF_8),view.get("text").asText());
        assertEquals(415,get(f.teacher().client(),f.path()+"/"+zipId+"/text").statusCode());
        assertEquals(404,get(fixture("hw-lines-foreign").teacher().client(),f.path()+"/"+textId+"/text").statusCode());
        String comments=card(f.teacher(),f.student())+"/lessons/"+f.lesson()+"/code-comments";
        var comment=data(write(f.teacher().client(),"POST",comments,Map.of("targetKind","homework","targetId",textId,"file","Main.java","line",2,"grade","good","body","Хорошее имя метода")),201);
        assertEquals(Set.of("id","targetKind","targetId","file","line","grade","body","variant","createdAt"),comment.propertyNames());
        assertEquals(1,data(get(f.learner().client(),comments+"?targetKind=homework&targetId="+textId),200).get("items").size());
        assertEquals(400,write(f.teacher().client(),"POST",comments,Map.of("targetKind","homework","targetId",textId,"file","Main.java","line",5,"body","outside")).statusCode());
        assertEquals(400,write(f.teacher().client(),"POST",comments,Map.of("targetKind","homework","targetId",textId,"file","Other.java","line",1,"body","wrong file")).statusCode());
        assertEquals(415,write(f.teacher().client(),"POST",comments,Map.of("targetKind","homework","targetId",zipId,"file","project.zip","line",1,"body","archive")).statusCode());
        assertEquals(404,write(f.learner().client(),"POST",comments,Map.of("targetKind","homework","targetId",textId,"file","Main.java","line",1,"body","student")).statusCode());
        assertEquals(400,get(f.teacher().client(),comments+"?targetKind=lesson&targetId="+textId).statusCode());
        String review=f.path()+"/"+textId+"/review";
        assertEquals(400,write(f.teacher().client(),"PATCH",review,Map.of("revision",1,"status","reviewed","feedback","","grade","brilliant")).statusCode());
        assertEquals(400,write(f.teacher().client(),"PATCH",review,Map.of("revision",1,"status","reviewed","feedback","","grade",5)).statusCode());
        var graded=data(write(f.teacher().client(),"PATCH",review,Map.of("revision",1,"status","reviewed","feedback","Готово","grade","excellent")),200);
        assertEquals("excellent",graded.get("grade").asText());
        var move=data(get(f.learner().client(),card(f.teacher(),f.student())+"/moves?lessonId="+f.lesson()),200);
        assertEquals(3,move.get("total").asLong());var latest=move.get("items").get(0);
        assertEquals("review",latest.get("kind").asText());assertEquals("teacher",latest.get("side").asText());assertEquals("excellent",latest.get("grade").asText());assertEquals("Готово",latest.get("detail").asText());assertEquals(1,latest.get("ordinal").asInt());
        var kinds=new ArrayList<String>();move.get("items").forEach(item->kinds.add(item.get("kind").asText()));assertEquals(List.of("review","homework","homework"),kinds);
        assertEquals(2,move.get("items").get(1).get("ordinal").asInt());
        assertEquals(0,data(get(f.teacher().client(),card(f.teacher(),f.student())+"/moves?lessonId=other"),200).get("total").asLong());
        Map<String,Object> clear=new HashMap<>(Map.of("revision",2,"status","needs_revision","feedback","Ещё раз"));clear.put("grade",null);
        assertFalse(data(write(f.teacher().client(),"PATCH",review,clear),200).has("grade"));
        assertEquals(404,get(fixture("hw-lines-moves").teacher().client(),card(f.teacher(),f.student())+"/moves").statusCode());
    }
    // Catches an older submission or a reviewed lesson hiding work awaiting review, and turns leaking across workspaces or to students.
    @Test void turnsKeepOnlyTheLatestExchangePerLessonAndQueueWorkAwaitingReview()throws Exception {
        var f=fixture("hw-turns");String second=lesson(f.teacher(),f.student(),"Second turn lesson");
        String secondPath=card(f.teacher(),f.student())+"/lessons/"+second+"/homework",lessonTurns=card(f.teacher(),f.student())+"/homework/turns",queue="/workspaces/"+f.teacher().workspace()+"/homework/turns";
        assertEquals(0,data(get(f.teacher().client(),queue),200).get("total").asLong());assertEquals(0,data(get(f.learner().client(),lessonTurns),200).get("total").asLong());
        var older=data(upload(f.learner(),f.path(),"older.txt",TEXT,"",""),201);CLOCK.advance(Duration.ofSeconds(1));
        var newer=data(upload(f.learner(),f.path(),"newer.txt",TEXT,"",""),201);CLOCK.advance(Duration.ofSeconds(1));
        var other=data(upload(f.learner(),secondPath,"other.txt",TEXT," awaiting comment ",""),201);CLOCK.advance(Duration.ofSeconds(1));
        data(write(f.teacher().client(),"PATCH",f.path()+"/"+newer.get("id").asText()+"/review",Map.of("revision",1,"status","needs_revision","feedback","again")),200);
        var lessons=data(get(f.learner().client(),lessonTurns),200);assertEquals(2,lessons.get("total").asLong());var items=lessons.get("items");
        assertEquals(second,items.get(0).get("lessonId").asText());assertEquals("submitted",items.get(0).get("status").asText());
        assertEquals(Set.of("lessonId","submissionId","kind","filename","status","createdAt"),items.get(0).propertyNames());assertEquals("homework",items.get(0).get("kind").asText());
        assertEquals(f.lesson(),items.get(1).get("lessonId").asText());assertEquals(newer.get("id"),items.get(1).get("submissionId"));assertNotEquals(older.get("id"),items.get(1).get("submissionId"));
        assertEquals("needs_revision",items.get(1).get("status").asText());assertTrue(items.get(1).hasNonNull("reviewedAt"));
        assertEquals(lessons,data(get(f.teacher().client(),lessonTurns+"?audience=student"),200));
        var row=data(get(f.teacher().client(),queue),200).get("items").get(0);
        assertEquals(f.student(),row.get("studentId").asText());assertEquals("Synthetic homework student",row.get("studentName").asText());assertEquals(second,row.get("lessonId").asText());
        assertEquals("Second turn lesson",row.get("lessonTitle").asText());assertEquals("2030-01-01",row.get("lessonDate").asText());assertEquals(other.get("id"),row.get("submissionId"));
        assertEquals("awaiting comment",row.get("comment").asText());assertEquals("submitted",row.get("status").asText());assertEquals(1,row.get("awaitingReview").asLong());assertFalse(row.has("reviewedAt"));
        var quiet=fixture("hw-turns-quiet");data(upload(quiet.learner(),quiet.path(),"quiet.txt",TEXT,"",""),201);
        assertEquals(1,data(get(quiet.teacher().client(),"/workspaces/"+quiet.teacher().workspace()+"/homework/turns"),200).get("total").asLong());
        data(write(f.teacher().client(),"PATCH",secondPath+"/"+other.get("id").asText()+"/review",Map.of("revision",1,"status","reviewed","feedback","")),200);
        row=data(get(f.teacher().client(),queue),200).get("items").get(0);assertEquals("reviewed",row.get("status").asText());assertEquals(0,row.get("awaitingReview").asLong());assertEquals(other.get("id"),row.get("submissionId"));
        assertEquals(404,get(f.learner().client(),queue).statusCode());assertEquals(404,get(admin,queue).statusCode());assertEquals(401,get(client(),queue).statusCode());
        for(var client:List.of(quiet.teacher().client(),quiet.learner().client()))assertEquals(404,get(client,lessonTurns).statusCode());
        assertEquals(404,get(quiet.teacher().client(),queue).statusCode());
        assertEquals(400,get(f.teacher().client(),queue+"?size=101").statusCode());assertEquals(400,get(f.teacher().client(),lessonTurns+"?audience=teacher").statusCode());
        assertEquals("no-store",get(f.teacher().client(),queue).headers().firstValue("Cache-Control").orElseThrow());
    }
    // Catches JSON coercion turning a fractional/string CAS token or numeric feedback into valid review input.
    @Test void reviewRequiresAnIntegerCounterAndTextFeedback()throws Exception {
        var f=fixture("hw-review-types");var submission=data(upload(f.learner(),f.path(),"review.txt",TEXT,"",""),201);
        String path=f.path()+"/"+submission.get("id").asText()+"/review";
        for(Object revision:List.of(1.5,"1",true))assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",revision,"status","reviewed","feedback","must not persist")).statusCode());
        assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"status","reviewed","feedback",17)).statusCode());
        var unchanged=data(get(f.learner().client(),f.path()),200).get("items").get(0);assertEquals(1,unchanged.get("revision").asLong());assertEquals("submitted",unchanged.get("status").asText());
    }
}
