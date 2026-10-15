package ru.mentor.platform.students;

import org.junit.jupiter.api.*;
import ru.mentor.platform.support.IdentityHttpTest;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StudentArchiveTest extends IdentityHttpTest {
    // Catches an archived card still queuing work, a student locked out of reading, and a stale revision silently archiving.
    @Test void archivedCardLeavesTheListsStaysReadableAndRefusesNewWork()throws Exception {
        var teacher=teacher("archive-teacher");String a=student(teacher,"Archived A").get("id").asText(),b=student(teacher,"Active B").get("id").asText();
        var learner=enroll(teacher,a,"archive-learner");String lesson=lesson(teacher,a),homework=card(teacher,a)+"/lessons/"+lesson+"/homework",queue="/workspaces/"+teacher.workspace()+"/homework/turns";
        assertEquals(201,upload(learner,homework,"work.java").statusCode());assertEquals(1,data(get(teacher.client(),queue),200).get("total").asInt());
        assertEquals(2,data(get(teacher.client(),students(teacher)),200).get("total").asInt());
        long revision=data(get(teacher.client(),card(teacher,a)),200).get("revision").asLong();
        assertEquals(409,write(teacher.client(),"PATCH",card(teacher,a),Map.of("revision",revision+5,"archived",true)).statusCode());
        assertEquals(400,write(teacher.client(),"PATCH",card(teacher,a),Map.of("revision",revision,"archived","yes")).statusCode());
        var archived=data(write(teacher.client(),"PATCH",card(teacher,a),Map.of("revision",revision,"archived",true,"direction","Java, выпуск")),200);
        assertTrue(archived.has("archivedAt"));assertEquals("Java, выпуск",archived.get("direction").asText());assertEquals(revision+2,archived.get("revision").asLong());
        String archivedAt=archived.get("archivedAt").asText();
        var active=data(get(teacher.client(),students(teacher)),200);assertEquals(1,active.get("total").asInt());assertEquals(b,active.get("items").get(0).get("id").asText());
        var only=data(get(teacher.client(),students(teacher)+"?archived=true"),200);assertEquals(1,only.get("total").asInt());assertEquals(a,only.get("items").get(0).get("id").asText());
        assertEquals(2,data(get(teacher.client(),students(teacher)+"?archived=all"),200).get("total").asInt());
        assertEquals(400,get(teacher.client(),students(teacher)+"?archived=maybe").statusCode());
        assertEquals(0,data(get(teacher.client(),queue),200).get("total").asInt());
        // The student keeps reading their card, lessons and history, but cannot send new work.
        var own=data(get(learner.client(),card(teacher,a)),200);assertEquals(archivedAt,own.get("archivedAt").asText());assertFalse(own.has("notes"));
        assertEquals(1,data(get(learner.client(),students(teacher)),200).get("total").asInt());
        assertEquals(1,data(get(learner.client(),card(teacher,a)+"/lessons"),200).get("total").asInt());assertEquals(1,data(get(learner.client(),homework),200).get("total").asInt());
        var refused=upload(learner,homework,"late.java");assertEquals(403,refused.statusCode());assertEquals("ARCHIVED",data(refused,403).get("code").asText());
        // Archiving twice keeps the first instant; restoring clears it and the queue returns.
        long again=archived.get("revision").asLong();
        assertEquals(archivedAt,data(write(teacher.client(),"PATCH",card(teacher,a),Map.of("revision",again,"archived",true)),200).get("archivedAt").asText());
        var restored=data(write(teacher.client(),"PATCH",card(teacher,a),Map.of("revision",again+1,"archived",false)),200);assertFalse(restored.has("archivedAt"));
        assertEquals(2,data(get(teacher.client(),students(teacher)),200).get("total").asInt());assertEquals(1,data(get(teacher.client(),queue),200).get("total").asInt());
        assertEquals(201,upload(learner,homework,"again.java").statusCode());
        assertEquals(404,write(learner.client(),"PATCH",card(teacher,a),Map.of("revision",restored.get("revision").asLong(),"archived",true)).statusCode());
    }

    private String lesson(User teacher,String student)throws Exception{return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title","Archive lesson","date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();}
    private HttpResponse<String> upload(User user,String path,String filename)throws Exception {
        String boundary="mentor-synthetic-archive-boundary";var session=session(user.client());var body=new ByteArrayOutputStream();
        body.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+filename+"\"\r\nContent-Type: application/octet-stream\r\n\r\nclass Work {}\n\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
        var request=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary="+boundary);
        return user.client().send(request.POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(),HttpResponse.BodyHandlers.ofString());
    }
}
