package ru.mentor.platform.lessons;

import org.junit.jupiter.api.*;
import ru.mentor.platform.support.IdentityHttpTest;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LessonDeleteTest extends IdentityHttpTest {
    private static final Path RUNTIME=isolatedRuntime();
    private static Path isolatedRuntime(){
        try {
            Path root=Files.createTempDirectory("mentor-lesson-delete-test-");
            System.setProperty("mentor.blobs.type","local");System.setProperty("mentor.blobs.local-root",root.resolve("objects").toString());
            System.setProperty("mentor.blobs.spool-root",root.resolve("spool").toString());System.setProperty("mentor.blobs.cleanup-enabled","false");
            System.setProperty("spring.servlet.multipart.location",Files.createDirectory(root.resolve("multipart")).toString());return root;
        } catch(IOException failure){throw new ExceptionInInitializerError(failure);}
    }
    @AfterAll static void cleanupRuntime()throws IOException {
        for(String key:List.of("mentor.blobs.type","mentor.blobs.local-root","mentor.blobs.spool-root","mentor.blobs.cleanup-enabled","spring.servlet.multipart.location"))System.clearProperty(key);
        try(var paths=Files.walk(RUNTIME)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
    }

    // Catches a mistaken lesson that cannot be removed, a lesson with work vanishing, and numbers not closing the gap.
    @Test void emptyLessonsDisappearWhileLessonsWithWorkOrMaterialsStay()throws Exception {
        var teacher=teacher("delete-teacher");var other=teacher("delete-other");String student=student(teacher,"Delete student").get("id").asText();var learner=enroll(teacher,student,"delete-learner");
        String first=lesson(teacher,student,"2030-01-01"),second=lesson(teacher,student,"2030-01-08"),third=lesson(teacher,student,"2030-01-15");
        String base=card(teacher,student)+"/lessons/";
        assertEquals(3,data(get(teacher.client(),base+third),200).get("number").asLong());
        assertEquals(404,write(learner.client(),"DELETE",base+second,null).statusCode());assertEquals(404,write(other.client(),"DELETE",base+second,null).statusCode());
        assertEquals(204,write(teacher.client(),"DELETE",base+second,null).statusCode());
        assertEquals(404,get(teacher.client(),base+second).statusCode());assertEquals(404,write(teacher.client(),"DELETE",base+second,null).statusCode());
        assertEquals(2,data(get(teacher.client(),base+third),200).get("number").asLong());assertEquals(2,data(get(teacher.client(),card(teacher,student)+"/lessons"),200).get("total").asInt());
        // A material or a homework file keeps the lesson; removing the material frees it again.
        var doc=data(post(teacher,base+third+"/materials",Map.of("kind","doc","audience","student","markdown","text")),201);
        var busy=write(teacher.client(),"DELETE",base+third,null);assertEquals(409,busy.statusCode());assertEquals("LESSON_IN_USE",data(busy,409).get("code").asText());
        assertEquals(204,write(teacher.client(),"DELETE","/workspaces/"+teacher.workspace()+"/materials/"+doc.get("id").asText(),null).statusCode());
        assertEquals(204,write(teacher.client(),"DELETE",base+third,null).statusCode());
        assertEquals(201,upload(learner,base+first+"/homework","work.java").statusCode());
        assertEquals(409,write(teacher.client(),"DELETE",base+first,null).statusCode());
        assertEquals(1,data(get(teacher.client(),card(teacher,student)+"/lessons"),200).get("total").asInt());
    }

    private String lesson(User teacher,String student,String date)throws Exception{return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title","Lesson "+date,"date",date,"time","12:00","duration",60)),201).get("id").asText();}
    private HttpResponse<String> post(User user,String path,Map<String,String> fields)throws Exception {
        String boundary="mentor-synthetic-delete-boundary";var session=session(user.client());var body=new ByteArrayOutputStream();
        for(var field:fields.entrySet())body.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+field.getKey()+"\"\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"+field.getValue()+"\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(("--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
        return user.client().send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> upload(User user,String path,String filename)throws Exception {
        String boundary="mentor-synthetic-delete-boundary";var session=session(user.client());
        byte[] body=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+filename+"\"\r\nContent-Type: application/octet-stream\r\n\r\nclass Work {}\n\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
        return user.client().send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
}
