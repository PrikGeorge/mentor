package ru.mentor.platform.materials;

import org.junit.jupiter.api.*;
import ru.mentor.platform.support.IdentityHttpTest;
import ru.mentor.platform.files.BlobService;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class MaterialAuthoringTest extends IdentityHttpTest {
    private static final Path RUNTIME=isolatedRuntime();
    private static final String BOUNDARY="mentor-synthetic-material-boundary";
    private static Path isolatedRuntime(){
        try {
            Path root=Files.createTempDirectory("mentor-material-authoring-");
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

    // Catches a lesson that never becomes prepared, a teacher-only document leaking to the student, and a deleted file lingering.
    @Test void teacherPublishesDocumentsAndFilesAndTheLessonBecomesPrepared()throws Exception {
        var teacher=teacher("author-teacher");String student=student(teacher,"Author student").get("id").asText();var learner=enroll(teacher,student,"author-learner");
        String lessonPath=card(teacher,student)+"/lessons/"+lesson(teacher,student),path=lessonPath+"/materials",base="/workspaces/"+teacher.workspace()+"/materials/";
        var before=data(get(teacher.client(),lessonPath),200);assertEquals("planned",before.get("status").asText());assertTrue(before.get("bundleId").isNull());
        assertEquals(0,data(get(learner.client(),path),200).get("total").asInt());
        var doc=data(post(teacher,path,List.of(field("kind","doc"),field("audience","student"),field("contentKey","student"),field("markdown","# Задания\n\nВступление.\n\n## Первая часть\n\nТекст **жирный**.\n\n## Вторая\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"))),201);
        assertEquals("doc",doc.get("kind").asText());assertEquals("Задания",doc.get("title").asText());assertEquals("student.md",doc.get("filename").asText());assertEquals("student",doc.get("contentKey").asText());
        var after=data(get(teacher.client(),lessonPath),200);assertEquals("prepared",after.get("status").asText());String bundle=after.get("bundleId").asText();
        assertEquals(bundle,doc.get("bundleId").asText());assertEquals(before.get("revision").asLong()+1,after.get("revision").asLong());
        var document=data(get(learner.client(),base+doc.get("id").asText()),200).get("document");
        assertEquals("<p>Вступление.</p>",document.get("intro").asText());assertEquals("",document.get("html").asText());assertEquals(2,document.get("sections").size());
        assertEquals("section-0",document.get("sections").get(0).get("id").asText());assertEquals("Первая часть",document.get("sections").get(0).get("title").asText());
        assertTrue(document.get("sections").get(0).get("html").asText().contains("<strong>жирный</strong>"));assertTrue(document.get("sections").get(1).get("html").asText().contains("<table>"));
        assertTrue(document.get("raw").asText().startsWith("# Задания"));
        var guide=data(post(teacher,path,List.of(field("kind","doc"),field("audience","teacher"),field("contentKey","guide"),field("title","Методичка"),field("markdown","Без заголовков, *курсив*."))),201);
        assertEquals("Методичка",guide.get("title").asText());assertEquals(bundle,guide.get("bundleId").asText());
        var plain=data(get(teacher.client(),base+guide.get("id").asText()),200).get("document");assertEquals("",plain.get("intro").asText());assertEquals("<p>Без заголовков, <em>курсив</em>.</p>",plain.get("html").asText());assertTrue(plain.get("sections").isEmpty());
        assertEquals(404,get(learner.client(),base+guide.get("id").asText()).statusCode());
        assertEquals(409,post(teacher,path,List.of(field("kind","doc"),field("audience","teacher"),field("contentKey","guide"),field("markdown","x"))).statusCode());
        assertEquals(201,post(teacher,path,List.of(field("kind","doc"),field("audience","student"),field("contentKey","guide"),field("markdown","x"))).statusCode());
        assertEquals(201,post(teacher,path,List.of(field("kind","doc"),field("audience","teacher"),field("markdown","no role, so no conflict"))).statusCode());
        assertEquals(201,post(teacher,path,List.of(field("kind","doc"),field("audience","teacher"),field("markdown","no role, so no conflict"))).statusCode());
        assertEquals(2,data(get(learner.client(),path),200).get("total").asInt());assertEquals(5,data(get(teacher.client(),path),200).get("total").asInt());
        byte[] zip={0x50,0x4b,3,4,1,2,3};
        var file=data(post(teacher,path,List.of(field("kind","download"),field("audience","student"),field("title","Комплект"),new Part("file","kit.zip","application/zip",zip))),201);
        assertEquals("download",file.get("kind").asText());assertEquals("kit.zip",file.get("filename").asText());assertEquals("Комплект",file.get("title").asText());assertEquals("application/zip",file.get("contentType").asText());
        var bytes=download(learner.client(),base+file.get("id").asText()+"/file");assertEquals(200,bytes.statusCode());assertArrayEquals(zip,bytes.body());
        // planned hides the kit from the student again; prepared republishes under the same bundle.
        var hidden=data(write(teacher.client(),"PATCH",lessonPath,Map.of("revision",after.get("revision").asLong(),"status","planned")),200);
        assertEquals("planned",hidden.get("status").asText());assertEquals(bundle,hidden.get("bundleId").asText());
        assertEquals(404,get(learner.client(),base+doc.get("id").asText()).statusCode());assertEquals(0,data(get(learner.client(),path),200).get("total").asInt());
        assertEquals(400,write(teacher.client(),"PATCH",lessonPath,Map.of("revision",hidden.get("revision").asLong(),"status","done")).statusCode());
        var republished=data(write(teacher.client(),"PATCH",lessonPath,Map.of("revision",hidden.get("revision").asLong(),"status","prepared")),200);
        assertEquals(bundle,republished.get("bundleId").asText());assertEquals(200,get(learner.client(),base+doc.get("id").asText()).statusCode());
        // A fresh lesson can be published explicitly before any material exists.
        String empty=card(teacher,student)+"/lessons/"+lesson(teacher,student);var published=data(write(teacher.client(),"PATCH",empty,Map.of("revision",1,"status","prepared")),200);
        assertEquals("prepared",published.get("status").asText());assertFalse(published.get("bundleId").isNull());assertNotEquals(bundle,published.get("bundleId").asText());
        // Deleting the file removes the row and leaves the bytes to the janitor.
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        assertEquals(204,write(teacher.client(),"DELETE",base+file.get("id").asText(),null).statusCode());
        assertEquals(404,get(learner.client(),base+file.get("id").asText()).statusCode());assertEquals(404,write(teacher.client(),"DELETE",base+file.get("id").asText(),null).statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        CLOCK.advance(Duration.ofMinutes(10));assertEquals(1,context.getBean(BlobService.class).cleanExpired(100));
        assertEquals(204,write(teacher.client(),"DELETE",base+doc.get("id").asText(),null).statusCode());
        assertEquals("prepared",data(get(teacher.client(),lessonPath),200).get("status").asText());
    }

    // Catches a student or another teacher writing materials, loose input, and a failed write leaving the lesson prepared.
    @Test void onlyTheOwningTeacherWritesAndInputIsStrict()throws Exception {
        var teacher=teacher("author-owner");var other=teacher("author-other");String student=student(teacher,"Guarded student").get("id").asText();var learner=enroll(teacher,student,"guarded-learner");
        String lessonPath=card(teacher,student)+"/lessons/"+lesson(teacher,student),path=lessonPath+"/materials",base="/workspaces/"+teacher.workspace()+"/materials/";
        List<Part> doc=List.of(field("kind","doc"),field("audience","student"),field("markdown","text"));
        assertEquals(403,post(learner,path,doc).statusCode());assertEquals(404,post(other,path,doc).statusCode());
        assertEquals(404,post(other,card(other,"missing")+"/materials",doc).statusCode());
        for(List<Part> invalid:List.<List<Part>>of(
            List.of(field("audience","student"),field("markdown","text")),
            List.of(field("kind","view"),field("audience","student"),field("markdown","text")),
            List.of(field("kind","doc"),field("audience","everyone"),field("markdown","text")),
            List.of(field("kind","doc"),field("audience","student"),field("contentKey","Bad Key"),field("markdown","text")),
            List.of(field("kind","doc"),field("audience","student"),field("markdown","   ")),
            List.of(field("kind","doc"),field("audience","student")),
            List.of(field("kind","doc"),field("audience","student"),field("title","t".repeat(201)),field("markdown","text")),
            List.of(field("kind","doc"),field("audience","student"),field("markdown","text"),new Part("file","x.md","text/markdown","x".getBytes(StandardCharsets.UTF_8))),
            List.of(field("kind","download"),field("audience","student")),
            List.of(field("kind","download"),field("audience","student"),new Part("file","..\\evil.zip","application/zip",new byte[]{1})),
            List.of(field("kind","download"),field("audience","student"),new Part("file","empty.zip","application/zip",new byte[0])),
            List.of(field("kind","doc"),field("audience","student"),field("markdown","text"),field("extra","field")),
            List.of(field("kind","doc"),field("kind","doc"),field("audience","student"),field("markdown","text"))))
            assertEquals(400,post(teacher,path,invalid).statusCode(),invalid.toString());
        assertEquals(413,post(teacher,path,List.of(field("kind","download"),field("audience","student"),new Part("file","big.zip","application/zip",new byte[20*1024*1024+1]))).statusCode());
        var lesson=data(get(teacher.client(),lessonPath),200);assertEquals("planned",lesson.get("status").asText());assertTrue(lesson.get("bundleId").isNull());assertEquals(1,lesson.get("revision").asLong());
        assertEquals(0,data(get(teacher.client(),path),200).get("total").asInt());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM stored_blob",Integer.class));
        // Card-level documents carry no lesson and no bundle and appear in the profile listing only.
        var roadmap=data(post(teacher,card(teacher,student)+"/materials",List.of(field("kind","doc"),field("audience","student"),field("contentKey","student-roadmap"),field("markdown","# Маршрут\n\n## Этап 1\n\nШаг."))),201);
        assertTrue(roadmap.get("lessonId").isNull());assertTrue(roadmap.get("bundleId").isNull());
        assertEquals(1,data(get(learner.client(),card(teacher,student)+"/materials"),200).get("total").asInt());assertEquals(0,data(get(learner.client(),path),200).get("total").asInt());
        assertEquals(409,post(teacher,card(teacher,student)+"/materials",List.of(field("kind","doc"),field("audience","student"),field("contentKey","student-roadmap"),field("markdown","again"))).statusCode());
        // Only the owner deletes.
        assertEquals(403,write(learner.client(),"DELETE",base+roadmap.get("id").asText(),null).statusCode());assertEquals(404,write(other.client(),"DELETE",base+roadmap.get("id").asText(),null).statusCode());
        assertEquals(200,get(learner.client(),base+roadmap.get("id").asText()).statusCode());
    }

    private String lesson(User teacher,String student)throws Exception{return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title","Material lesson","date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();}
    private record Part(String name,String filename,String contentType,byte[] bytes){}
    private static Part field(String name,String value){return new Part(name,null,null,value.getBytes(StandardCharsets.UTF_8));}
    private HttpResponse<String> post(User user,String path,List<Part> parts)throws Exception {
        var session=session(user.client());var body=new ByteArrayOutputStream();
        for(var part:parts){
            body.write(("--"+BOUNDARY+"\r\nContent-Disposition: form-data; name=\""+part.name()+"\""+(part.filename()==null?"":"; filename=\""+part.filename()+"\"")+"\r\n").getBytes(StandardCharsets.UTF_8));
            body.write((part.filename()==null?"Content-Type: text/plain; charset=UTF-8\r\n":"Content-Type: "+part.contentType()+"\r\n").getBytes(StandardCharsets.UTF_8));
            body.write("\r\n".getBytes(StandardCharsets.UTF_8));body.write(part.bytes());body.write("\r\n".getBytes(StandardCharsets.UTF_8));
        }
        body.write(("--"+BOUNDARY+"--\r\n").getBytes(StandardCharsets.UTF_8));
        var request=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary="+BOUNDARY);
        return user.client().send(request.POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(),HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<byte[]> download(HttpClient client,String path)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).GET().build(),HttpResponse.BodyHandlers.ofByteArray());}
}
