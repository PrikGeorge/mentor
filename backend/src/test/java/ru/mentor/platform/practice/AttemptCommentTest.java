package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AttemptCommentTest extends AttemptHttpTest {
    // Catches comments landing outside the attempt's files or lines, written by a student or read across workspaces, and trainer attempts missing from the moves.
    @Test void teacherCommentsAttemptLinesAndMovesShowTheAttempt() throws Exception {
        var f=fixture("attempt-comments");publish(f,source());assign(f,0,"list-task");
        var attempt=data(enqueue(f,"commented",code("class ListTask {\n    int x;\n}")),202);String id=attempt.get("id").asText();
        String comments=card(f.teacher(),f.student())+"/lessons/"+f.lesson()+"/code-comments",query=comments+"?targetKind=attempt&targetId="+id;
        var created=data(write(f.teacher().client(),"POST",comments,Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",2,"grade","dubious","body"," Поле не нужно ","variant","    final int x;\n\n")),201);
        assertEquals("Поле не нужно",created.get("body").asText());assertEquals("    final int x;",created.get("variant").asText());assertEquals("dubious",created.get("grade").asText());
        var items=data(get(f.learner().client(),query),200).get("items");assertEquals(1,items.size());assertEquals(2,items.get(0).get("line").asInt());assertEquals("ListTask.java",items.get(0).get("file").asText());
        assertEquals(items,data(get(f.teacher().client(),query+"&audience=student"),200).get("items"));
        for(var bad:List.<Map<String,Object>>of(
            Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",4,"body","outside"),
            Map.of("targetKind","attempt","targetId",id,"file","Other.java","line",1,"body","unknown file"),
            Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",1,"body","   "),
            Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",1,"body","mark","grade","brilliant"),
            Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",1,"body","extra","author","forged")))
            assertEquals(400,write(f.teacher().client(),"POST",comments,bad).statusCode(),bad.toString());
        assertEquals(404,write(f.teacher().client(),"POST",comments,Map.of("targetKind","attempt","targetId","missing","file","ListTask.java","line",1,"body","missing")).statusCode());
        assertEquals(404,write(f.learner().client(),"POST",comments,Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",1,"body","student")).statusCode());
        var foreign=fixture("attempt-comments-foreign");assertEquals(404,get(foreign.teacher().client(),query).statusCode());assertEquals(404,get(foreign.learner().client(),query).statusCode());
        var move=data(get(f.learner().client(),card(f.teacher(),f.student())+"/moves"),200).get("items").get(0);
        assertEquals("attempt",move.get("kind").asText());assertEquals("student",move.get("side").asText());assertEquals(id,move.get("refId").asText());
        assertEquals("queued",move.get("status").asText());assertEquals("run",move.get("detail").asText());assertFalse(move.has("passed"));assertFalse(move.get("subject").asText().isBlank());
        assertEquals(404,write(f.learner().client(),"DELETE",comments+"/"+created.get("id").asText(),null).statusCode());
        assertEquals(204,write(f.teacher().client(),"DELETE",comments+"/"+created.get("id").asText(),null).statusCode());
        assertEquals(0,data(get(f.learner().client(),query),200).get("items").size());
        assertEquals(404,write(f.teacher().client(),"DELETE",comments+"/"+created.get("id").asText(),null).statusCode());
    }

    // Catches the executor status leaking identifiers, claiming availability without a recent heartbeat, or answering foreign workspaces.
    @Test void workerStatusTellsWhetherTheExecutorIsAlive() throws Exception {
        var f=fixture("worker-status");String route="/workspaces/"+f.teacher().workspace()+"/practice/worker";
        assertEquals(Set.of("available","lastSeenAt","waiting","running"),data(get(f.learner().client(),route),200).propertyNames());
        publish(f,source());assign(f,0,"list-task");data(enqueue(f,"status",code("class ListTask {}")),202);
        var lease=claim();var seen=data(get(f.teacher().client(),route),200);assertTrue(seen.get("available").asBoolean());assertFalse(seen.get("lastSeenAt").isNull());assertTrue(seen.get("running").asInt()>=1);
        assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());
        java.time.Instant lastSeen=java.time.Instant.parse(data(get(f.learner().client(),route),200).get("lastSeenAt").asText());
        CLOCK.advance(java.time.Duration.ofMinutes(3));var stale=data(get(f.learner().client(),route),200);assertFalse(stale.get("available").asBoolean());assertEquals(lastSeen,java.time.Instant.parse(stale.get("lastSeenAt").asText()));
        var foreign=fixture("worker-foreign");assertEquals(404,get(foreign.learner().client(),route).statusCode());assertEquals(401,get(client(),route).statusCode());
    }

    // Catches a homework-placement trainer attempt missing from whose-turn, run attempts counted as moves, and a line comment not handing the move back.
    @Test void homeworkPlacementAttemptsDriveWhoseTurn() throws Exception {
        var f=fixture("attempt-turns");publish(f,source());
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework")))),200);
        String turns=card(f.teacher(),f.student())+"/homework/turns",queue="/workspaces/"+f.teacher().workspace()+"/homework/turns";
        assertEquals(0,data(get(f.learner().client(),turns),200).get("total").asInt());assertEquals(0,data(get(f.teacher().client(),queue),200).get("total").asInt());
        data(enqueue(f,"run-only",code("class ListTask {}")),202);
        assertEquals(0,data(get(f.teacher().client(),turns),200).get("total").asInt());
        String id=data(enqueue(f,"turn-1",Map.of("exerciseRevision",1,"mode","submit","files",Map.of("ListTask.java","class ListTask {\n    int x;\n}"))),202).get("id").asText();
        var turn=data(get(f.learner().client(),turns),200);assertEquals(1,turn.get("total").asInt());var item=turn.get("items").get(0);
        assertEquals("attempt",item.get("kind").asText());assertEquals(id,item.get("submissionId").asText());assertEquals("submitted",item.get("status").asText());assertEquals(f.lesson(),item.get("lessonId").asText());assertFalse(item.has("reviewedAt"));assertFalse(item.get("filename").asText().isBlank());
        var row=data(get(f.teacher().client(),queue),200).get("items").get(0);assertEquals("attempt",row.get("kind").asText());assertEquals("submitted",row.get("status").asText());assertEquals(1,row.get("awaitingReview").asLong());assertEquals(f.student(),row.get("studentId").asText());assertEquals("",row.get("comment").asText());
        data(write(f.teacher().client(),"POST",card(f.teacher(),f.student())+"/lessons/"+f.lesson()+"/code-comments",Map.of("targetKind","attempt","targetId",id,"file","ListTask.java","line",2,"body","Поле не нужно")),201);
        item=data(get(f.learner().client(),turns),200).get("items").get(0);assertEquals("reviewed",item.get("status").asText());assertTrue(item.has("reviewedAt"));
        row=data(get(f.teacher().client(),queue),200).get("items").get(0);assertEquals("reviewed",row.get("status").asText());assertEquals(0,row.get("awaitingReview").asLong());
        // A later homework file in the same lesson becomes the latest exchange again.
        assertEquals(1,data(get(f.teacher().client(),queue),200).get("total").asInt());
    }
}
