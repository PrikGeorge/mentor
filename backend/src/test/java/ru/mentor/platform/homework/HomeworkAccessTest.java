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

/** Who may submit and read homework, and that a review stays with its own lesson (Q-20). */
class HomeworkAccessTest extends HomeworkHttpTest {

    // Catches missing submission handling, file-cap off-by-one and a preview actor gaining write rights.
    @Test void boundariesAndOwnership()throws Exception {
        var f=fixture("hw-boundary");
        var first=data(upload(f.learner(),f.path(),"first.txt",TEXT,"",""),201);
        assertEquals(Set.of("id","filename","size","createdAt","comment","repositoryUrl","status","feedback","revision"),first.propertyNames());
        assertEquals("submitted",first.get("status").asText());assertEquals(1,first.get("revision").asLong());
        assertEquals("",first.get("feedback").asText());assertFalse(first.has("reviewedAt"));
        assertEquals(201,upload(f.learner(),f.path(),"maximum.PDF",new byte[20*1024*1024],"","").statusCode());
        assertEquals(413,upload(f.learner(),f.path(),"excessive.pdf",new byte[20*1024*1024+1],"","").statusCode());
        assertEquals(403,upload(f.teacher(),f.path()+"?audience=student","preview.txt",TEXT,"","").statusCode());
        assertEquals(2,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        String route=f.path()+"/"+first.get("id").asText()+"/file";
        var file=download(f.learner().client(),route,"GET");assertEquals(200,file.statusCode());assertArrayEquals(TEXT,file.body());
        assertEquals(Integer.toString(TEXT.length),file.headers().firstValue("Content-Length").orElseThrow());
        assertEquals("application/octet-stream",file.headers().firstValue("Content-Type").orElseThrow());
        assertEquals("no-store",file.headers().firstValue("Cache-Control").orElseThrow());assertEquals("nosniff",file.headers().firstValue("X-Content-Type-Options").orElseThrow());
        assertTrue(file.headers().firstValue("Content-Disposition").orElseThrow().contains("filename*="));
        String csp=file.headers().firstValue("Content-Security-Policy").orElseThrow();assertTrue(csp.contains("default-src 'none'"));assertTrue(csp.contains("sandbox"));
        var foreign=fixture("hw-foreign");
        for(var client:List.of(foreign.teacher().client(),foreign.learner().client(),admin))for(String method:List.of("GET","HEAD"))assertEquals(404,download(client,route,method).statusCode());
        assertEquals(401,download(client(),route,"GET").statusCode());
        String key=jdbc.queryForObject("SELECT r.object_key FROM stored_blob b JOIN blob_reservation r ON r.id=b.reservation_id WHERE b.workspace_id=? AND b.filename='first.txt'",String.class,f.teacher().workspace());
        context.getBean(BlobStore.class).delete(key);
        var head=download(f.learner().client(),route,"HEAD");assertEquals(200,head.statusCode());assertEquals(0,head.body().length);assertEquals(Integer.toString(TEXT.length),head.headers().firstValue("Content-Length").orElseThrow());
        assertFalse(first.toString().contains(key));
    }

    // Catches overwriting an earlier upload, a stale review succeeding, or feedback crossing lesson boundaries.
    @Test void lessonReviewDoesNotLeakToOtherLesson()throws Exception {
        var f=fixture("hw-review");String secondLesson=lesson(f.teacher(),f.student(),"Second homework lesson");
        String other=card(f.teacher(),f.student())+"/lessons/"+secondLesson+"/homework";
        var first=data(upload(f.learner(),f.path(),"one.java",TEXT," first comment "," https://example.invalid/repository "),201);
        CLOCK.advance(Duration.ofSeconds(1));var second=data(upload(f.learner(),f.path(),"two.md",TEXT,"","") ,201);
        assertNotEquals(first.get("id"),second.get("id"));assertEquals("first comment",first.get("comment").asText());assertEquals("https://example.invalid/repository",first.get("repositoryUrl").asText());
        String review=f.path()+"/"+first.get("id").asText()+"/review";
        var reviewed=data(write(f.teacher().client(),"PATCH",review,Map.of("revision",1,"status","needs_revision","feedback","  lesson-one feedback 😀  ")),200);
        assertEquals(2,reviewed.get("revision").asLong());assertEquals("needs_revision",reviewed.get("status").asText());assertEquals("lesson-one feedback 😀",reviewed.get("feedback").asText());assertTrue(reviewed.hasNonNull("reviewedAt"));
        assertEquals(409,write(f.teacher().client(),"PATCH",review,Map.of("revision",1,"status","reviewed","feedback","stale overwrite")).statusCode());
        assertEquals(403,write(f.learner().client(),"PATCH",review,Map.of("revision",2,"status","reviewed","feedback","student review")).statusCode());
        assertEquals(404,write(f.teacher().client(),"PATCH",other+"/"+first.get("id").asText()+"/review",Map.of("revision",2,"status","reviewed","feedback","wrong lesson")).statusCode());
        assertEquals(404,download(f.learner().client(),other+"/"+first.get("id").asText()+"/file","GET").statusCode());
        var latest=data(get(f.learner().client(),f.path()+"?page=0&size=1"),200);assertEquals(2,latest.get("total").asLong());assertEquals(second.get("id"),latest.get("items").get(0).get("id"));
        var old=data(get(f.learner().client(),f.path()+"?page=1&size=1"),200).get("items").get(0);assertEquals(reviewed,old);
        var empty=data(get(f.learner().client(),other),200);assertEquals(0,empty.get("total").asLong());assertFalse(empty.toString().contains("lesson-one feedback"));
        assertEquals(400,write(f.teacher().client(),"PATCH",review,Map.of("revision",2,"status","submitted","feedback","")).statusCode());
        assertEquals(400,write(f.teacher().client(),"PATCH",review,Map.of("revision",2,"status","reviewed","feedback","x".repeat(20001))).statusCode());
        assertEquals(3,data(write(f.teacher().client(),"PATCH",review,Map.of("revision",2,"status","reviewed","feedback","x".repeat(20000))),200).get("revision").asLong());
    }

    // Catches trusting the pre-upload actor after its membership has been revoked during streaming.
    @Test void longUploadRevalidatesStudentAccessBeforeFinalAttachment()throws Exception {
        var f=fixture("hw-revocation");var actor=json.convertValue(session(f.learner().client()).get("account"),Actor.class);
        var lesson=new LessonRef(f.teacher().workspace(),f.student(),f.lesson());var service=context.getBean(HomeworkService.class);
        var reading=new CountDownLatch(1);var resume=new CountDownLatch(1);
        InputStream blocked=new FilterInputStream(new ByteArrayInputStream(TEXT)){
            int count;
            public int read(byte[] b,int off,int length)throws IOException {
                if(count>=4){reading.countDown();try{if(!resume.await(15,TimeUnit.SECONDS))throw new IOException("Synthetic test gate timed out.");}catch(InterruptedException stopped){Thread.currentThread().interrupt();throw new InterruptedIOException();}}
                int n=in.read(b,off,Math.min(length,4));if(n>0)count+=n;return n;
            }
        };
        try(var pool=Executors.newSingleThreadExecutor()){
            var submitting=pool.submit(()->assertThrows(ApiFailure.class,()->service.submit(actor,lesson,blocked,"paused.txt","","")));
            try{assertTrue(reading.await(10,TimeUnit.SECONDS));assertEquals(204,write(f.teacher().client(),"PATCH",card(f.teacher(),f.student())+"/access",Map.of("disabled",true)).statusCode());}
            finally{resume.countDown();}
            assertEquals(404,submitting.get(20,TimeUnit.SECONDS).status());
        }
        assertEquals(0,data(get(f.teacher().client(),f.path()),200).get("total").asLong());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM blob_reservation WHERE state='STAGED'",Integer.class));
        CLOCK.advance(Duration.ofMinutes(10));assertEquals(1,context.getBean(BlobService.class).cleanExpired(100));
    }
}
