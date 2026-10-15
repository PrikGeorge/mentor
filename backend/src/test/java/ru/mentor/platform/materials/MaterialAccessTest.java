package ru.mentor.platform.materials;
import org.junit.jupiter.api.*;
import ru.mentor.platform.support.IdentityHttpTest;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.io.*;
import ru.mentor.platform.files.*;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.students.StudentService;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;
class MaterialAccessTest extends IdentityHttpTest {
    @Test void directUrls()throws Exception {
        var teacher=teacher("material-teacher");var student=student(teacher,"Synthetic material student");
        var page=data(get(teacher.client(),card(teacher,student.get("id").asText())+"/materials"),200);
        assertEquals(0,page.get("total").asInt());assertTrue(page.get("items").isEmpty());
    }
    @Test void authoritativeBindingAudienceAndProjection()throws Exception {
        var teacher=teacher("material-owner");var other=teacher("other-material-teacher");
        String a=student(teacher,"A").get("id").asText(),b=student(teacher,"B").get("id").asText();
        var learner=enroll(teacher,a,"material-learner");var foreign=enroll(teacher,b,"foreign-material-learner");
        String lesson=data(write(teacher.client(),"POST",card(teacher,a)+"/lessons",Map.of("title","Synthetic material lesson","date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='bundle-a' WHERE workspace_id=? AND id=?",teacher.workspace(),lesson);
        String doc=json.writeValueAsString(Map.of("title","Title","intro","intro","raw","  exact\n😀  ","html","<p>PUBLIC_TASK</p>","sections",List.of(Map.of("id","section-0","title","First","html","<p>body</p>","studentParts",List.of(0,1)))));
        insert(teacher,a,lesson,"bundle-a","student-doc","student","doc","public-doc",doc);
        insert(teacher,a,lesson,"bundle-a","teacher-doc","teacher","doc","private-doc",doc.replace("PUBLIC_TASK","PRIVATE_TEACHER_MARKER"));
        insert(teacher,a,null,null,"profile-doc","student","doc","profile-doc",doc);
        insert(teacher,a,lesson,"bundle-a","bad-code","student","code","code",json.writeValueAsString(Map.of("text","PRIVATE_TEACHER_MARKER","teacher",true,"materialId","teacher-download")));
        insert(teacher,a,lesson,"bundle-a","student-view","student","view","view",json.writeValueAsString(Map.of("goalHtml","<p>Goal</p>","lessonHtml","PRIVATE_TEACHER_MARKER","descriptors",Map.of("public-doc",List.of("p","d"),"private-doc",List.of("PRIVATE_TEACHER_MARKER","d")),"resources",List.of(List.of("public-doc","p","d","x"),List.of("private-doc","PRIVATE_TEACHER_MARKER","d","x")))));
        String base="/workspaces/"+teacher.workspace()+"/materials/";
        var value=data(get(learner.client(),base+"student-doc"),200);assertEquals("  exact\n😀  ",value.get("document").get("raw").asText());assertEquals("section-0",value.get("document").get("sections").get(0).get("id").asText());
        for(var client:List.of(foreign.client(),other.client(),admin))for(String method:List.of("GET","HEAD"))assertEquals(404,request(client,base+"student-doc",method).statusCode());
        for(String method:List.of("GET","HEAD"))assertEquals(401,request(client(),base+"student-doc",method).statusCode());
        assertEquals(404,get(learner.client(),base+"teacher-doc").statusCode());assertEquals(404,get(teacher.client(),base+"teacher-doc?audience=student").statusCode());
        assertEquals(404,get(learner.client(),base+"bad-code").statusCode());
        var view=data(get(learner.client(),base+"student-view"),200);assertFalse(view.toString().contains("PRIVATE_TEACHER_MARKER"));assertFalse(view.get("viewData").has("lessonHtml"));
        var list=data(get(learner.client(),card(teacher,a)+"/lessons/"+lesson+"/materials"),200);assertEquals(2,list.get("total").asInt());assertFalse(list.toString().contains("PUBLIC_TASK"));assertFalse(list.toString().contains("PRIVATE_TEACHER_MARKER"));
        assertEquals(1,data(get(learner.client(),card(teacher,a)+"/materials"),200).get("total").asInt());
        assertEquals("",request(learner.client(),base+"student-doc","HEAD").body());
        jdbc.update("UPDATE lesson SET bundle_id='different' WHERE workspace_id=? AND id=?",teacher.workspace(),lesson);
        assertEquals(404,get(learner.client(),base+"student-doc").statusCode());assertEquals(200,get(teacher.client(),base+"student-doc").statusCode());assertEquals(200,get(learner.client(),base+"profile-doc").statusCode());
        var legacy=teacher.client().send(HttpRequest.newBuilder(URI.create(origin+"/downloads/teacher-lesson-2026-09-27.zip")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(404,legacy.statusCode());assertFalse(legacy.body().contains("PRIVATE_TEACHER_MARKER"));
    }
    private HttpResponse<String> request(HttpClient client,String route,String method)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+route)).method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());}
    private void insert(User teacher,String student,String lesson,String bundle,String id,String audience,String kind,String key,String payload){jdbc.update("INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,payload) VALUES(?,?,?,?,?,?,?,?,?,'text/plain','Title',?::jsonb)",teacher.workspace(),id,student,lesson,bundle,audience,kind,key,"synthetic.txt",payload);}
    @Test void downloadHeadNeverOpensBytesAndUnauthorizedGetDoesNotLeak()throws Exception {
        var teacher=teacher("download-teacher");String a=student(teacher,"A").get("id").asText(),b=student(teacher,"B").get("id").asText();
        var learner=enroll(teacher,a,"download-learner");var foreign=enroll(teacher,b,"download-foreign");
        Actor actor=json.convertValue(session(teacher.client()).get("account"),Actor.class);var owner=context.getBean(StudentService.class).requireReader(actor,teacher.workspace(),a);var blobs=context.getBean(BlobService.class);
        var staged=blobs.stage(actor,owner,new ByteArrayInputStream("synthetic bytes".getBytes()),100,15L);
        var transaction=new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
        var blob=transaction.execute(status->{var attached=blobs.attach(actor,owner,staged,"Файл\r\n/path.pdf","application/pdf");jdbc.update("INSERT INTO material(workspace_id,id,student_id,audience,kind,filename,content_type,blob_id) VALUES(?,'download',?,'student','download',?,'application/pdf',?)",teacher.workspace(),a,"Файл\r\n/path.pdf",attached.id());return attached;});
        String route="/workspaces/"+teacher.workspace()+"/materials/download/file";
        var file=request(learner.client(),route,"GET");assertEquals(200,file.statusCode());assertEquals("synthetic bytes",file.body());assertEquals("15",file.headers().firstValue("Content-Length").orElseThrow());
        assertEquals("nosniff",file.headers().firstValue("X-Content-Type-Options").orElseThrow());assertEquals("no-store",file.headers().firstValue("Cache-Control").orElseThrow());
        String disposition=file.headers().firstValue("Content-Disposition").orElseThrow();assertTrue(disposition.contains("filename*="));assertFalse(disposition.contains("\r"));assertFalse(disposition.contains("/path"));
        var detail=data(get(learner.client(),route.substring(0,route.length()-5)),200);assertEquals(blob.id(),detail.get("blob").get("id").asText());assertFalse(detail.toString().contains(staged.key()));
        context.getBean(BlobStore.class).delete(staged.key());
        var head=request(learner.client(),route,"HEAD");assertEquals(200,head.statusCode());assertEquals("",head.body());assertEquals("15",head.headers().firstValue("Content-Length").orElseThrow());
        for(String method:List.of("GET","HEAD")){assertEquals(404,request(foreign.client(),route,method).statusCode());assertEquals(404,request(admin,route,method).statusCode());assertEquals(401,request(client(),route,method).statusCode());}
    }
    @Test void databaseRejectsSnapshotWithoutContent()throws Exception {
        var teacher=teacher("material-constraints");String student=student(teacher,"Synthetic constraint owner").get("id").asText();
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->jdbc.update("INSERT INTO material(workspace_id,id,student_id,audience,kind,filename,content_type) VALUES(?,'missing-payload',?,'student','doc','x.md','text/markdown')",teacher.workspace(),student));
    }
}
