package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** One lesson mixes homework files and submit attempts of a homework-placement exercise; the latest exchange decides whose turn it is (Q-08). */
class HomeworkTurnMixTest extends AttemptHttpTest {
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);

    private String homework(Fixture f){return card(f.teacher(),f.student())+"/lessons/"+f.lesson()+"/homework";}
    private JsonNode turn(Fixture f)throws Exception{var page=data(get(f.learner().client(),card(f.teacher(),f.student())+"/homework/turns"),200);assertEquals(1,page.get("total").asLong(),"One lesson, one turn.");return page.get("items").get(0);}
    private JsonNode row(Fixture f)throws Exception{var page=data(get(f.teacher().client(),"/workspaces/"+f.teacher().workspace()+"/homework/turns"),200);assertEquals(1,page.get("total").asLong());return page.get("items").get(0);}
    private String attempt(Fixture f,String exercise,String mode,String key,String file)throws Exception {
        var body=Map.of("exerciseRevision",1,"mode",mode,"files",Map.of(file,"class "+file.replace(".java","")+" {\n    int x;\n}"));
        var r=data(write(f.learner().client(),"POST",f.path()+"/exercises/"+exercise+"/attempts",body,"Idempotency-Key",key),202).get("id").asText();
        // A synthetic worker finishes every job at once so the single-slot queue never fills; the verdict plays no part in whose turn it is.
        var lease=claim();assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());CLOCK.advance(Duration.ofSeconds(1));return r;
    }
    private void expect(Fixture f,String kind,String id,String status)throws Exception {
        var turn=turn(f);assertEquals(kind,turn.get("kind").asText());assertEquals(id,turn.get("submissionId").asText());assertEquals(status,turn.get("status").asText());assertEquals(f.lesson(),turn.get("lessonId").asText());
        var row=row(f);assertEquals(kind,row.get("kind").asText());assertEquals(id,row.get("submissionId").asText());assertEquals(status,row.get("status").asText());assertEquals(status.equals("submitted")?1:0,row.get("awaitingReview").asLong());
        assertEquals(status.equals("submitted"),!turn.has("reviewedAt"));assertEquals(status.equals("submitted"),!row.has("reviewedAt"));
    }

    // Catches an older file outranking a newer attempt (or the reverse), run and class-placement attempts counting, and a review of the older work closing the newer one.
    @Test void latestOfFileOrHomeworkAttemptDecidesTheTurn()throws Exception {
        var f=fixture("turn-mix");publish(f,source());
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework"),Map.of("exerciseId","grouping-task","placement","class")))),200);
        var file=data(uploadHomework(f.learner(),homework(f),"Main.java",TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));
        expect(f,"homework",file.get("id").asText(),"submitted");
        // A submit attempt of the homework exercise is the newer exchange.
        String submitted=attempt(f,"list-task","submit","mix-submit-1","ListTask.java");
        expect(f,"attempt",submitted,"submitted");assertFalse(turn(f).get("filename").asText().isBlank());assertEquals("",row(f).get("comment").asText());
        // A class-placement attempt and a run attempt are not homework exchanges, however new.
        attempt(f,"grouping-task","submit","mix-class-1","GroupingTask.java");attempt(f,"list-task","run","mix-run-1","ListTask.java");
        expect(f,"attempt",submitted,"submitted");
        // Reviewing the older file does not answer the newer attempt.
        data(write(f.teacher().client(),"PATCH",homework(f)+"/"+file.get("id").asText()+"/review",Map.of("revision",1,"status","reviewed","feedback","Файл принят","grade","good")),200);CLOCK.advance(Duration.ofSeconds(1));
        expect(f,"attempt",submitted,"submitted");
        // The first line comment on the attempt is the mentor's answer; a second comment does not move the instant.
        String comments=card(f.teacher(),f.student())+"/lessons/"+f.lesson()+"/code-comments";
        var comment=data(write(f.teacher().client(),"POST",comments,Map.of("targetKind","attempt","targetId",submitted,"file","ListTask.java","line",2,"body","Поле не нужно")),201);CLOCK.advance(Duration.ofSeconds(1));
        expect(f,"attempt",submitted,"reviewed");assertEquals(comment.get("createdAt").asText(),turn(f).get("reviewedAt").asText());
        data(write(f.teacher().client(),"POST",comments,Map.of("targetKind","attempt","targetId",submitted,"file","ListTask.java","line",1,"body","И класс тоже")),201);CLOCK.advance(Duration.ofSeconds(1));
        assertEquals(comment.get("createdAt").asText(),turn(f).get("reviewedAt").asText());
        // Removing the exercise from the lesson takes its attempts out of the exchange; the reviewed file remains the latest.
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",1,"assignments",List.of(Map.of("exerciseId","grouping-task","placement","class")))),200);
        expect(f,"homework",file.get("id").asText(),"reviewed");
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",2,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework")))),200);
        expect(f,"attempt",submitted,"reviewed");
        // A new file after the answered attempt returns the move to the mentor; a later run attempt changes nothing.
        var second=data(uploadHomework(f.learner(),homework(f),"Main.java",TEXT," второй файл "),201);CLOCK.advance(Duration.ofSeconds(1));
        expect(f,"homework",second.get("id").asText(),"submitted");assertEquals("второй файл",row(f).get("comment").asText());
        attempt(f,"list-task","run","mix-run-2","ListTask.java");expect(f,"homework",second.get("id").asText(),"submitted");
        // And a new submit attempt takes the turn back from the file.
        String again=attempt(f,"list-task","submit","mix-submit-2","ListTask.java");expect(f,"attempt",again,"submitted");
        // The journal still lists every one of them: five attempts of any mode or placement, two files, one review.
        var moves=data(get(f.learner().client(),card(f.teacher(),f.student())+"/moves"),200);assertEquals(8,moves.get("total").asLong());
        var kinds=new ArrayList<String>();moves.get("items").forEach(m->kinds.add(m.get("kind").asText()));assertEquals(List.of("attempt","attempt","homework","review","attempt","attempt","attempt","homework"),kinds);
        moves.get("items").forEach(m->{if(m.get("kind").asText().equals("attempt"))assertEquals("accepted",m.get("status").asText());});
    }
}
