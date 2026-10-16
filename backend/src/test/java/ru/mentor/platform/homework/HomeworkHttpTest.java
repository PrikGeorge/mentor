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

/** Shared fixture and multipart client of the homework HTTP tests (split from HomeworkFlowTest) (Q-20). */
abstract class HomeworkHttpTest extends IdentityHttpTest {
    static final String BOUNDARY="mentor-synthetic-homework-boundary";
    static final byte[] TEXT="synthetic project bytes\n".getBytes(StandardCharsets.UTF_8);

    record Fixture(User teacher,User learner,String student,String lesson,String path){}

    Fixture fixture(String login)throws Exception {
        var teacher=teacher(login);String student=student(teacher,"Synthetic homework student").get("id").asText();var learner=enroll(teacher,student,login+"-student");String lesson=lesson(teacher,student,"Homework lesson");
        return new Fixture(teacher,learner,student,lesson,card(teacher,student)+"/lessons/"+lesson+"/homework");
    }
    String lesson(User teacher,String student,String title)throws Exception{return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title",title,"date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();}
    record Part(String name,String filename,byte[] bytes){}
    Part field(String name,String value){return new Part(name,null,value.getBytes(StandardCharsets.UTF_8));}
    HttpResponse<String> upload(User user,String path,String filename,byte[] bytes,String comment,String url)throws Exception{return upload(user,path,filename,bytes,comment,url,List.of());}
    HttpResponse<String> upload(User user,String path,String filename,byte[] bytes,String comment,String url,List<String> idempotencyKeys)throws Exception{return multipart(user,path,List.of(new Part("file",filename,bytes),field("comment",comment),field("repositoryUrl",url)),null,true,false,idempotencyKeys);}
    HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf)throws Exception {
        return multipart(user,path,parts,account,csrf,false);
    }
    HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf,boolean chunked)throws Exception {
        return multipart(user,path,parts,account,csrf,chunked,List.of());
    }
    HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf,boolean chunked,List<String> idempotencyKeys)throws Exception {
        var session=session(user.client());var body=new ByteArrayOutputStream();
        for(var part:parts){
            String disposition="--"+BOUNDARY+"\r\nContent-Disposition: form-data; name=\""+part.name()+"\""+(part.filename()==null?"":"; filename=\""+part.filename()+"\"")+"\r\n";
            body.write(disposition.getBytes(StandardCharsets.UTF_8));body.write((part.filename()==null?"Content-Type: text/plain; charset=UTF-8\r\n":"Content-Type: application/octet-stream\r\n").getBytes(StandardCharsets.UTF_8));body.write("\r\n".getBytes(StandardCharsets.UTF_8));body.write(part.bytes());body.write("\r\n".getBytes(StandardCharsets.UTF_8));
        }
        body.write(("--"+BOUNDARY+"--\r\n").getBytes(StandardCharsets.UTF_8));
        var request=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",account==null?user.id():account).header("Content-Type","multipart/form-data; boundary="+BOUNDARY);
        if(csrf)request.header("X-CSRF-TOKEN",session.get("csrfToken").asText());
        for(String key:idempotencyKeys)request.header("Idempotency-Key",key);
        byte[] bytes=body.toByteArray();var publisher=chunked?HttpRequest.BodyPublishers.ofInputStream(()->new ByteArrayInputStream(bytes)):HttpRequest.BodyPublishers.ofByteArray(bytes);
        return user.client().send(request.POST(publisher).build(),HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<byte[]> download(HttpClient client,String path,String method)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofByteArray());}
}
