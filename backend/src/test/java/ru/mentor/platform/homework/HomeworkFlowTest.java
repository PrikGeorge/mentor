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
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import ru.mentor.platform.lessons.LessonRef;
import static org.junit.jupiter.api.Assertions.*;

class HomeworkFlowTest extends IdentityHttpTest {
    private static final Path RUNTIME=isolatedRuntime();
    private static final String BOUNDARY="mentor-synthetic-homework-boundary";
    private static final byte[] TEXT="synthetic project bytes\n".getBytes(StandardCharsets.UTF_8);
    private static Path isolatedRuntime(){
        try {
            Path root=Files.createTempDirectory("mentor-homework-test-");
            System.setProperty("mentor.blobs.type","local");
            System.setProperty("mentor.blobs.local-root",root.resolve("objects").toString());
            System.setProperty("mentor.blobs.spool-root",root.resolve("spool").toString());
            System.setProperty("mentor.blobs.cleanup-enabled","false");
            System.setProperty("spring.servlet.multipart.location",Files.createDirectory(root.resolve("multipart")).toString());
            return root;
        } catch(IOException failure){throw new ExceptionInInitializerError(failure);}
    }
    @AfterAll static void cleanupRuntime()throws IOException {
        for(String key:List.of("mentor.blobs.type","mentor.blobs.local-root","mentor.blobs.spool-root","mentor.blobs.cleanup-enabled","spring.servlet.multipart.location"))System.clearProperty(key);
        try(var paths=Files.walk(RUNTIME)){for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
    }

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

    private record Fixture(User teacher,User learner,String student,String lesson,String path){}
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
        try(var parts=Files.list(RUNTIME.resolve("multipart"))){assertEquals(0,parts.count());}
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

    private Fixture fixture(String login)throws Exception {
        var teacher=teacher(login);String student=student(teacher,"Synthetic homework student").get("id").asText();var learner=enroll(teacher,student,login+"-student");String lesson=lesson(teacher,student,"Homework lesson");
        return new Fixture(teacher,learner,student,lesson,card(teacher,student)+"/lessons/"+lesson+"/homework");
    }
    private String lesson(User teacher,String student,String title)throws Exception{return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title",title,"date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();}
    private record Part(String name,String filename,byte[] bytes){}
    private Part field(String name,String value){return new Part(name,null,value.getBytes(StandardCharsets.UTF_8));}
    private HttpResponse<String> upload(User user,String path,String filename,byte[] bytes,String comment,String url)throws Exception{return upload(user,path,filename,bytes,comment,url,List.of());}
    private HttpResponse<String> upload(User user,String path,String filename,byte[] bytes,String comment,String url,List<String> idempotencyKeys)throws Exception{return multipart(user,path,List.of(new Part("file",filename,bytes),field("comment",comment),field("repositoryUrl",url)),null,true,false,idempotencyKeys);}
    private HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf)throws Exception {
        return multipart(user,path,parts,account,csrf,false);
    }
    private HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf,boolean chunked)throws Exception {
        return multipart(user,path,parts,account,csrf,chunked,List.of());
    }
    private HttpResponse<String> multipart(User user,String path,List<Part> parts,String account,boolean csrf,boolean chunked,List<String> idempotencyKeys)throws Exception {
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
    private HttpResponse<byte[]> download(HttpClient client,String path,String method)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofByteArray());}
}
