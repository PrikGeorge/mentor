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
}
