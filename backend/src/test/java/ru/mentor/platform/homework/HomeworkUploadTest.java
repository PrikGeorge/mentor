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

/** The multipart upload itself — shapes, limits, partial and repeated sends, storage failures (Q-20). */
class HomeworkUploadTest extends HomeworkHttpTest {

    // Catches permissive filename/ZIP/URL validation and character counts being confused with UTF16 units.
    @Test void unsafeMetadataAndEmptyFilesAreRejectedWithoutCreatingHistory()throws Exception {
        var f=fixture("hw-invalid");assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        for(String name:List.of("../work.txt","dir\\work.txt",".hidden.txt","work.txt ","work..","CON.txt","lpt9.pdf","bad:name.txt","work.exe","a".repeat(177)+".txt"))assertEquals(400,upload(f.learner(),f.path(),name,TEXT,"","").statusCode(),name);
        assertEquals(400,upload(f.learner(),f.path(),"empty.txt",new byte[0],"","").statusCode());
        assertEquals(400,upload(f.learner(),f.path(),"bad.zip",TEXT,"","").statusCode());
        for(String url:List.of("http://example.invalid/repo","https://user:password@example.invalid/repo","https:///","https://example.invalid/"+"x".repeat(2000)))assertEquals(400,upload(f.learner(),f.path(),"work.txt",TEXT,"",url).statusCode());
        assertEquals(400,upload(f.learner(),f.path(),"work.txt",TEXT,"😀".repeat(5000)+"x","").statusCode());
        assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        assertEquals(201,upload(f.learner(),f.path(),"a".repeat(176)+".txt",TEXT,"😀".repeat(5000),"https://example.invalid/").statusCode());
        for(byte[] signature:List.of(new byte[]{0x50,0x4b,3,4},new byte[]{0x50,0x4b,5,6},new byte[]{0x50,0x4b,7,8}))assertEquals(201,upload(f.learner(),f.path(),"signature.ZIP",signature,"","").statusCode());
    }

    // Catches accepting duplicate/unknown parts, an unbounded multipart request, and account-switch writes.
    @Test void multipartShapesAndAccountGuardsAreStrict()throws Exception {
        var f=fixture("hw-parts");assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        Part file=new Part("file","work.txt",TEXT);
        for(List<Part> parts:List.of(List.<Part>of(),List.of(file,file),List.of(file,field("extra","unknown")),List.of(file,field("comment","a"),field("comment","b"))))assertEquals(400,multipart(f.learner(),f.path(),parts,null,true).statusCode());
        assertEquals(413,multipart(f.learner(),f.path(),List.of(file,field("comment","x".repeat(21*1024*1024))),null,true).statusCode());
        assertEquals(409,multipart(f.learner(),f.path(),List.of(file),"old-account",true).statusCode());
        assertEquals(403,multipart(f.learner(),f.path(),List.of(file),null,false).statusCode());
        assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
    }

    // Catches committing attached bytes while the domain insertion fails, or announcing success before commit.
    @Test void databaseFailureDoesNotCreateSuccessfulSubmission()throws Exception {
        var f=fixture("hw-rollback");assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        jdbc.execute("CREATE FUNCTION synthetic_homework_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic domain rejection'; END $$");
        jdbc.execute("CREATE TRIGGER synthetic_homework_reject BEFORE INSERT ON homework_submission FOR EACH ROW EXECUTE FUNCTION synthetic_homework_reject()");
        try {
            assertEquals(503,upload(f.learner(),f.path(),"rollback.txt",TEXT,"","").statusCode());
            assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM blob_reservation WHERE state='ATTACHED'",Integer.class));
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM blob_reservation",Integer.class)>0);
            var keys=jdbc.queryForList("SELECT object_key FROM blob_reservation",String.class);
            CLOCK.advance(Duration.ofMinutes(10));context.getBean(BlobService.class).cleanExpired(100);
            for(String key:keys)assertThrows(IOException.class,()->context.getBean(BlobStore.class).open(key));
        } finally {jdbc.execute("DROP TRIGGER synthetic_homework_reject ON homework_submission");jdbc.execute("DROP FUNCTION synthetic_homework_reject()");}
    }

    // Catches relying on Content-Length for upload limits and committing a disconnected HTTP multipart body.
    @Test void chunkedUploadsAndDisconnectedSocketDoNotCommitPartialFiles()throws Exception {
        var f=fixture("hw-transport");
        assertEquals(201,multipart(f.learner(),f.path(),List.of(new Part("file","chunked.txt",TEXT)),null,true,true).statusCode());
        assertEquals(413,multipart(f.learner(),f.path(),List.of(new Part("file","chunked.txt",new byte[20*1024*1024+1])),null,true,true).statusCode());
        var session=session(f.learner().client());URI address=URI.create(origin);
        var cookieHeaders=f.learner().client().cookieHandler().orElseThrow().get(URI.create(origin+"/api/v1"+f.path()),Map.of());
        String cookie=String.join("; ",cookieHeaders.getOrDefault("Cookie",List.of()));assertFalse(cookie.isEmpty());
        var rawSession=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/auth/session")).header("Cookie",cookie).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(f.learner().id(),json.readTree(rawSession.body()).path("account").path("userId").asText(),"The raw socket fixture must have the same authenticated session.");
        try(var control=new Socket(address.getHost(),address.getPort())){
            control.setSoTimeout(10000);control.getOutputStream().write(("GET /api/v1/auth/session HTTP/1.1\r\nHost: "+address.getRawAuthority()+"\r\nCookie: "+cookie+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));control.getOutputStream().flush();
            String response=new String(control.getInputStream().readAllBytes(),StandardCharsets.UTF_8);assertTrue(response.startsWith("HTTP/1.1 200")&&response.contains(f.learner().id()),"Raw socket control must authenticate before the intentional disconnect.");
        }
        String headers="POST /api/v1"+f.path()+" HTTP/1.1\r\nHost: "+address.getRawAuthority()+"\r\nOrigin: "+origin+"\r\nX-Mentor-Client: web\r\nX-Mentor-Account: "+f.learner().id()+"\r\nX-CSRF-TOKEN: "+session.get("csrfToken").asText()+"\r\nCookie: "+cookie+"\r\nContent-Type: multipart/form-data; boundary="+BOUNDARY+"\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n";
        String partial="--"+BOUNDARY+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"disconnected.txt\"\r\nContent-Type: application/octet-stream\r\n\r\npartial";
        try(var socket=new Socket(address.getHost(),address.getPort())){
            socket.setSoTimeout(10000);socket.getOutputStream().write((headers+partial).getBytes(StandardCharsets.UTF_8));socket.getOutputStream().flush();socket.shutdownOutput();
            String response=new String(socket.getInputStream().readAllBytes(),StandardCharsets.UTF_8);assertTrue(response.isEmpty()||response.startsWith("HTTP/1.1 4"),()->"Disconnected request must never succeed: "+response.lines().findFirst().orElse("<closed without response>"));
        }
        assertEquals(1,data(get(f.learner().client(),f.path()),200).get("total").asLong());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        try(var parts=Files.list(runtimeRoot.resolve("multipart"))){assertEquals(0,parts.count());}
    }
    // Catches regex wildcard behavior accidentally allowing multiple filename control characters.
    @Test void serviceRejectsMultipleFilenameControlsBeforeStaging()throws Exception {
        var f=fixture("hw-name-control");var actor=json.convertValue(session(f.learner().client()).get("account"),Actor.class);
        var lesson=new LessonRef(f.teacher().workspace(),f.student(),f.lesson());var service=context.getBean(HomeworkService.class);
        for(String name:List.of("bad\nline\r.txt","bad\r\nname.pdf","bad\nname\n.md"))assertThrows(IllegalArgumentException.class,()->service.submit(actor,lesson,new ByteArrayInputStream(TEXT),name,"",""));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM blob_reservation",Integer.class));
    }

    // Catches incomplete upload bytes being attached, including a servlet's incorrect measured length.
    @Test void interruptedAndSizeMismatchedStreamsLeaveOnlyCollectibleReservations()throws Exception {
        var f=fixture("hw-stream");var actor=json.convertValue(session(f.learner().client()).get("account"),Actor.class);
        var lesson=new LessonRef(f.teacher().workspace(),f.student(),f.lesson());var service=context.getBean(HomeworkService.class);var closed=new AtomicBoolean();
        InputStream interrupted=new FilterInputStream(new ByteArrayInputStream(TEXT)){
            int count;
            public int read(byte[] b,int off,int length)throws IOException {if(count>=8)throw new IOException("synthetic disconnected source");int n=in.read(b,off,Math.min(length,4));if(n>0)count+=n;return n;}
            public void close()throws IOException {closed.set(true);super.close();}
        };
        assertThrows(IOException.class,()->service.submit(actor,lesson,interrupted,"interrupted.txt","",""));assertTrue(closed.get());
        assertThrows(IOException.class,()->service.submit(actor,lesson,new ByteArrayInputStream(TEXT),"mismatch.txt","","",(long)TEXT.length+1));
        assertEquals(0,data(get(f.learner().client(),f.path()),200).get("total").asLong());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        var keys=jdbc.queryForList("SELECT object_key FROM blob_reservation",String.class);assertEquals(2,keys.size());
        CLOCK.advance(Duration.ofMinutes(10));assertEquals(2,context.getBean(BlobService.class).cleanExpired(100));
        for(String key:keys)assertThrows(IOException.class,()->context.getBean(BlobStore.class).open(key));
    }

    // Catches a retry after a lost response creating a second work, and a reused key hiding another file or comment.
    @Test void sameIdempotencyKeyReturnsTheStoredWorkInsteadOfASecondCopy()throws Exception {
        var f=fixture("hw-idem");
        var first=data(upload(f.learner(),f.path(),"work.java",TEXT,"note","",List.of("retry-1")),201);
        assertEquals(first,data(upload(f.learner(),f.path(),"work.java",TEXT,"note","",List.of("retry-1")),201));
        assertEquals(1,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        var conflict=upload(f.learner(),f.path(),"work.java","other bytes\n".getBytes(StandardCharsets.UTF_8),"note","",List.of("retry-1"));
        assertEquals(409,conflict.statusCode());assertEquals("IDEMPOTENCY_CONFLICT",data(conflict,409).get("code").asText());
        assertEquals(409,upload(f.learner(),f.path(),"work.java",TEXT,"другой комментарий","",List.of("retry-1")).statusCode());
        assertEquals(409,upload(f.learner(),f.path(),"renamed.java",TEXT,"note","",List.of("retry-1")).statusCode());
        assertEquals(409,upload(f.learner(),f.path(),"work.java",TEXT,"note","https://example.test/repo",List.of("retry-1")).statusCode());
        for(List<String> keys:List.of(List.of(""),List.of("bad key"),List.of("a".repeat(129)),List.of("retry-2","retry-3")))assertEquals(400,upload(f.learner(),f.path(),"work.java",TEXT,"note","",keys).statusCode());
        assertEquals(1,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        // Another key and no key at all each create a new work; the same key in another lesson of the card is independent.
        assertNotEquals(first.get("id").asText(),data(upload(f.learner(),f.path(),"work.java",TEXT,"note","",List.of("retry-2")),201).get("id").asText());
        assertEquals(201,upload(f.learner(),f.path(),"work.java",TEXT,"note","").statusCode());
        assertEquals(3,data(get(f.learner().client(),f.path()),200).get("total").asLong());
        String other=card(f.teacher(),f.student())+"/lessons/"+lesson(f.teacher(),f.student(),"Second lesson")+"/homework";
        assertEquals(201,upload(f.learner(),other,"work.java",TEXT,"note","",List.of("retry-1")).statusCode());
        assertEquals(1,data(get(f.learner().client(),other),200).get("total").asLong());
    }
}
