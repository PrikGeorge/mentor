package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class LessonRevisionTest extends LessonHttpTest {
    @Test void independentFields() throws Exception {
        var f=fixture("lesson-revision");var l=lesson(f,"Lesson","2028-02-29","23:59",60);String path=lessonPath(f,l);String whitespace="  Привет😀\n\tcode  \n";
        try(var pool=Executors.newFixedThreadPool(2)){
            var gate=new CountDownLatch(1);
            var a=pool.submit(()->{gate.await();return write(f.teacher().client(),"PUT",path+"/texts/teacherNotes",Map.of("revision",1,"markdown",whitespace));});
            var b=pool.submit(()->{gate.await();return write(f.teacher().client(),"PUT",path+"/texts/studentNotes",Map.of("revision",1,"markdown","student text"));});
            gate.countDown();assertEquals(200,a.get(30,TimeUnit.SECONDS).statusCode());assertEquals(200,b.get(30,TimeUnit.SECONDS).statusCode());
        }
        assertEquals(409,write(f.teacher().client(),"PUT",path+"/texts/teacherNotes",Map.of("revision",1,"markdown","stale")).statusCode());
        assertEquals(whitespace,data(get(f.teacher().client(),path+"/texts/teacherNotes"),200).get("markdown").asText());
        var metadata=data(write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"title","  Updated  ")),200);
        assertEquals(2,metadata.get("revision").asInt());assertEquals("Updated",metadata.get("title").asText());assertEquals(whitespace,metadata.get("teacherNotes").asText());
        assertEquals(409,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"duration",90)).statusCode());
        assertEquals(60,data(get(f.teacher().client(),path),200).get("duration").asInt());
        assertEquals(2,data(get(f.teacher().client(),path+"/texts/studentNotes"),200).get("revision").asInt());
        assertEquals(1,data(get(f.teacher().client(),path+"/texts/reviewNotes"),200).get("revision").asInt());
    }
    @Test void utf16BoundaryAndRawJsonByteBoundaryForDeclaredAndChunkedBodies() throws Exception {
        var f=fixture("lesson-limits");String path=lessonPath(f,lesson(f,"Limits","2030-01-01","00:00",15))+"/texts/studentNotes";
        String allowed="😀".repeat(100000);data(write(f.teacher().client(),"PUT",path,Map.of("revision",1,"markdown",allowed)),200);
        assertEquals(400,write(f.teacher().client(),"PUT",path,Map.of("revision",2,"markdown",allowed+"я")).statusCode());
        String small=json.writeValueAsString(Map.of("revision",2,"markdown",""));
        String exact=small+" ".repeat(4*1024*1024-small.getBytes(StandardCharsets.UTF_8).length);
        assertEquals(200,raw(f,path,exact,false).statusCode());
        String excessive=exact+" ";
        assertEquals(413,raw(f,path,excessive,false).statusCode());assertEquals(413,raw(f,path,excessive,true).statusCode());
        assertEquals(3,data(get(f.teacher().client(),path),200).get("revision").asInt());assertEquals("",data(get(f.teacher().client(),path),200).get("markdown").asText());
    }
    private HttpResponse<String> raw(Fixture f,String path,String body,boolean chunked)throws Exception {
        var s=session(f.teacher().client());byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        var publisher=chunked?HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(bytes)):HttpRequest.BodyPublishers.ofByteArray(bytes);
        return f.teacher().client().send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.teacher().id()).header("X-CSRF-TOKEN",s.get("csrfToken").asText()).header("Content-Type","application/json").PUT(publisher).build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void strictMetadataDefaultsYearZeroAndShortFormOnly()throws Exception {
        var f=fixture("lesson-calendar");data(write(f.teacher().client(),"PATCH",f.path(),Map.of("revision",1,"studentReview","archive-only")),200);
        var l=lesson(f,"\uFEFF  Title😀 \u00a0","0000-02-29","00:00",240);String path=lessonPath(f,l);
        assertEquals("Title😀",l.get("title").asText());assertEquals("0000-02-29",l.get("date").asText());assertEquals("Europe/Moscow",l.get("timeZone").asText());assertEquals("planned",l.get("status").asText());assertTrue(l.get("bundleId").isNull());
        for(String kind:List.of("teacherNotes","studentNotes","reviewNotes")){assertEquals("",l.get(kind).asText());assertEquals(1,data(get(f.teacher().client(),path+"/texts/"+kind),200).get("revision").asInt());}
        for(Object bad:List.of("2027-02-29","2028-02-30","2028-2-01","10000-01-01"))assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"date",bad)).statusCode());
        for(Object bad:List.of("24:00","9:00","00:60"))assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"time",bad)).statusCode());
        for(Object bad:List.of(14,241,15.5))assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"duration",bad)).statusCode());
        assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1.5,"title","bad revision")).statusCode());
        assertEquals(400,write(f.teacher().client(),"POST",f.path()+"/lessons",Map.of("title","Title","date","2028-01-01","time","12:00","duration",60,"teacherNotes","injected")).statusCode());
        assertEquals(400,write(f.teacher().client(),"PATCH",path,Map.of("revision",1,"bundleId","forged")).statusCode());
        assertEquals(400,write(f.teacher().client(),"PUT",path+"/texts/studentNotes",Map.of("revision",1,"markdown","valid","extra",true)).statusCode());
    }
    @Test void bodyLimitDoesNotBypassCsrfAccountGuardOrConsumeFutureMultipart()throws Exception {
        var f=fixture("lesson-body-guards");String path=lessonPath(f,lesson(f,"Guards","2030-01-01","12:00",60))+"/texts/studentNotes";String large=" ".repeat(4*1024*1024+1);
        var s=session(f.teacher().client());
        var missingCsrf=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.teacher().id()).header("Content-Type","application/json").PUT(HttpRequest.BodyPublishers.ofString(large)).build();
        assertEquals(403,f.teacher().client().send(missingCsrf,HttpResponse.BodyHandlers.ofString()).statusCode());
        var stale=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account","old-account").header("X-CSRF-TOKEN",s.get("csrfToken").asText()).header("Content-Type","application/json").PUT(HttpRequest.BodyPublishers.ofString(large)).build();
        assertEquals(409,f.teacher().client().send(stale,HttpResponse.BodyHandlers.ofString()).statusCode());
        var unrelated=HttpRequest.newBuilder(URI.create(origin+"/api/v1/workspaces/"+f.teacher().workspace()+"/students/"+f.student()+"/upload-not-yet-implemented")).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.teacher().id()).header("X-CSRF-TOKEN",s.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary=synthetic").PUT(HttpRequest.BodyPublishers.ofString(large)).build();
        assertEquals(404,f.teacher().client().send(unrelated,HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
