package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.Map;
import java.util.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;

class DraftRevisionTest extends PracticeHttpTest {
    @Test void malformedRawUtf8CannotBecomeReplacementSourceText()throws Exception {
        var f=fixture("practice-utf8");publish(f,source());assign(f,0,"list-task");String path=draftPath(f,"list-task");var session=session(f.learner().client());
        var bytes=new java.io.ByteArrayOutputStream();bytes.write("{\"exerciseRevision\":1,\"revision\":0,\"files\":{\"ListTask.java\":\"".getBytes(StandardCharsets.UTF_8));bytes.write(0xc3);bytes.write(0x28);bytes.write("\"}}".getBytes(StandardCharsets.UTF_8));
        var request=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.learner().id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","application/json").PUT(HttpRequest.BodyPublishers.ofByteArray(bytes.toByteArray())).build();
        assertEquals(400,f.learner().client().send(request,HttpResponse.BodyHandlers.ofString()).statusCode());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));
    }
    @Test void aggregateByteLimitAndSixteenDeclaredFileBoundaryUseRealHttp()throws Exception {
        var f=fixture("practice-aggregate");var source=source();var records=(tools.jackson.databind.node.ArrayNode)json.readTree(source.catalog().toFile());var exercise=(tools.jackson.databind.node.ObjectNode)records.get(2);var names=(tools.jackson.databind.node.ArrayNode)exercise.get("starterFiles");
        for(int i=0;i<14;i++){String name="demo/Extra"+i+".java";names.add(name);java.nio.file.Files.writeString(source.catalog().getParent().resolve("exercises/json-task/"+name),"class Extra"+i+" {}");}
        java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));assertEquals(3,publish(f,source).published());assign(f,0,"json-task");String path=draftPath(f,"json-task");Map<String,String> files=new TreeMap<>();for(var name:names)files.put(name.asText(),"");files.put("demo/JsonTask.java","a".repeat(131072));files.put("demo/ReaderFields.java","я".repeat(65536));assertEquals(200,write(f.learner().client(),"PUT",path,save(1,0,files)).statusCode());
        files.put("demo/Extra0.java","a");assertEquals(400,write(f.learner().client(),"PUT",path,save(1,1,files)).statusCode());files.put("demo/Extra0.java","");files.put("Extra17.java","");assertEquals(400,write(f.learner().client(),"PUT",path,save(1,1,files)).statusCode());
        assertEquals(1,data(get(f.learner().client(),path),200).get("revision").asLong());
    }
    @Test void importedHistoryPaginationKeepsNullArchiveTimeAndOmitsSourceInSummaries()throws Exception {
        var f=fixture("practice-history");publish(f,source());String assignment=assign(f,0,"list-task").get("exercises").get(0).get("assignmentId").asText();
        for(String id:List.of("archive-a","archive-b"))jdbc.update("INSERT INTO practice_draft_archive(workspace_id,id,assignment_id,exercise_revision,revision,files,updated_at,archived_at,reason) VALUES (?,?,?, '\"old\"'::jsonb,3,'{\"Legacy.java\":\"exact imported code\"}'::jsonb,'2020-01-01T00:00:00Z',NULL,'imported')",f.teacher().workspace(),id,assignment);
        assign(f,1);var page=data(get(f.learner().client(),f.path()+"/draft-archives?page=0&size=1&exerciseId=list-task"),200);assertEquals(2,page.get("total").asLong());assertEquals("archive-b",page.get("items").get(0).get("id").asText());assertTrue(page.get("items").get(0).get("archivedAt").isNull());assertFalse(page.get("items").get(0).has("files"));assertEquals("archive-a",data(get(f.teacher().client(),f.path()+"/draft-archives?page=1&size=1"),200).get("items").get(0).get("id").asText());
        assertEquals("exact imported code",data(get(f.learner().client(),f.path()+"/draft-archives/archive-a"),200).get("files").get("Legacy.java").asText());assertEquals(0,data(get(f.learner().client(),f.path()+"/draft-archives?exerciseId=absent"),200).get("total").asLong());assertEquals(404,get(f.learner().client(),draftPath(f,"list-task")).statusCode());
        assertEquals(400,get(f.learner().client(),f.path()+"/draft-archives?size=101").statusCode());assertEquals(400,get(f.learner().client(),f.path()+"?audience=teacher").statusCode());
    }
    @Test void exactDeclaredPackagePathsUnicodeAndUtf8SourceLimits()throws Exception {
        var f=fixture("practice-source");var source=source();publish(f,source);assign(f,0,"json-task","list-task");String path=draftPath(f,"json-task");
        Map<String,String> exact=Map.of("demo/JsonTask.java","я".repeat(65536),"demo/ReaderFields.java","😀".repeat(32768));assertEquals(200,write(f.learner().client(),"PUT",path,save(1,0,exact)).statusCode());
        int index=0;for(Map<String,String> invalid:List.of(Map.of("demo/JsonTask.java","missing"),Map.of("JsonTask.java","wrong","demo/ReaderFields.java","wrong"),Map.of("demo/JsonTask.java","я".repeat(65536)+"a","demo/ReaderFields.java",""),Map.of("demo/JsonTask.java","\0","demo/ReaderFields.java",""),Map.of("demo/JsonTask.java\n","","demo/ReaderFields.java","")))assertEquals(400,write(f.learner().client(),"PUT",path,save(1,1,invalid)).statusCode(),"Invalid source case "+index++);
        // Send the escaped malformed scalar unchanged; Java's HTTP UTF-8 encoder replaces a raw lone surrogate.
        assertEquals(400,raw(f.learner(),path,"{\"exerciseRevision\":1,\"revision\":1,\"files\":{\"demo/JsonTask.java\":\"\\ud800\",\"demo/ReaderFields.java\":\"\"}}",false,"application/json").statusCode());
        assertEquals(1,data(get(f.learner().client(),path),200).get("revision").asLong());
        assertEquals(400,write(f.learner().client(),"PUT",path,new HashMap<>(Map.of("exerciseRevision",1,"revision",1,"files",exact,"resetForRevision",false))).statusCode());
        var extra=new HashMap<>(save(1,1,exact));extra.put("environment","arbitrary");assertEquals(400,write(f.learner().client(),"PUT",path,extra).statusCode());
        var many=new TreeMap<String,String>();for(int i=0;i<17;i++)many.put("File"+i+".java","");assertThrows(IllegalArgumentException.class,()->SourceFiles.validate(many,many.keySet()));
        Map<String,String> total=Map.of("A.java","a".repeat(131072),"B.java","b".repeat(131072),"C.java","c");assertThrows(IllegalArgumentException.class,()->SourceFiles.validate(total,total.keySet()));
        assertEquals(400,write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",1,"assignments",List.of(Map.of("exerciseId","list-task","placement","class"),Map.of("exerciseId","list-task","placement","homework")))).statusCode());
    }
    @Test void concurrentDraftAndAssignmentCasHaveExactlyOneWinner()throws Exception {
        var f=fixture("practice-races");publish(f,source());assign(f,0,"list-task");String path=draftPath(f,"list-task");
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var gate=new java.util.concurrent.CountDownLatch(1);var a=pool.submit(()->{gate.await();return write(f.learner().client(),"PUT",path,save(1,0,Map.of("ListTask.java","// a"))).statusCode();});var b=pool.submit(()->{gate.await();return write(f.learner().client(),"PUT",path,save(1,0,Map.of("ListTask.java","// b"))).statusCode();});gate.countDown();assertEquals(Set.of(200,409),Set.of(a.get(30,java.util.concurrent.TimeUnit.SECONDS),b.get(30,java.util.concurrent.TimeUnit.SECONDS)));
            var assignmentGate=new java.util.concurrent.CountDownLatch(1);
            a=pool.submit(()->{assignmentGate.await();return write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",1,"assignments",List.of())).statusCode();});b=pool.submit(()->{assignmentGate.await();return write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",1,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework")))).statusCode();});assignmentGate.countDown();assertEquals(Set.of(200,409),Set.of(a.get(30,java.util.concurrent.TimeUnit.SECONDS),b.get(30,java.util.concurrent.TimeUnit.SECONDS)));
        }assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_assignment",Integer.class));
    }
    @Test void publicationAndSaveRaceCannotRelabelOldCode()throws Exception {
        var f=fixture("practice-publish-race");var source=source();publish(f,source);assign(f,0,"list-task");revision(source,"next");
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var gate=new java.util.concurrent.CountDownLatch(1);var publishing=pool.submit(()->{gate.await();return publish(f,source);});var saving=pool.submit(()->{gate.await();return write(f.learner().client(),"PUT",draftPath(f,"list-task"),save(1,0,Map.of("ListTask.java","old code")));});gate.countDown();assertEquals(1,publishing.get(30,java.util.concurrent.TimeUnit.SECONDS).published());int status=saving.get(30,java.util.concurrent.TimeUnit.SECONDS).statusCode();assertTrue(status==200||status==409);
            var draft=data(get(f.learner().client(),draftPath(f,"list-task")),200);if(status==200){assertTrue(draft.get("exerciseRevision").isNumber());assertEquals("old code",draft.get("files").get("ListTask.java").asText());}else{assertEquals(0,draft.get("revision").asLong());assertEquals("next",draft.get("exerciseRevision").asText());}
        }
    }
    @Test void queuedMemberWriteRechecksWorkspaceAfterPauseAndRunnableBoundaryDoesNotCreateDraft()throws Exception {
        var f=fixture("practice-pause");publish(f,source());assign(f,0,"list-task");var a=session(f.learner().client()).get("account");var actor=new ru.mentor.platform.shared.Actor(f.learner().id(),f.learner().workspace(),ru.mentor.platform.shared.Actor.Role.STUDENT,a.get("authVersion").asLong());var lesson=new ru.mentor.platform.lessons.LessonRef(f.teacher().workspace(),f.student(),f.lesson());var transaction=new org.springframework.transaction.support.TransactionTemplate(context.getBean(org.springframework.transaction.PlatformTransactionManager.class));
        transaction.executeWithoutResult(status->{var assignment=context.getBean(AssignmentService.class).requireActive(actor,lesson,"list-task");context.getBean(DraftService.class).requireRunnableDraft(actor,lesson,assignment,ExerciseRevision.fromJson(PracticeJson.read("1")));});assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));
        try(var connection=context.getBean(javax.sql.DataSource.class).getConnection();var pool=java.util.concurrent.Executors.newSingleThreadExecutor()){
            connection.setAutoCommit(false);try(var lock=connection.prepareStatement("SELECT id FROM workspace WHERE id=? FOR UPDATE")){lock.setString(1,f.teacher().workspace());lock.executeQuery().close();}
            var starting=new java.util.concurrent.CountDownLatch(1);var saving=pool.submit(()->{starting.countDown();return assertThrows(ru.mentor.platform.shared.ApiFailure.class,()->context.getBean(DraftService.class).save(actor,lesson,"list-task",ExerciseRevision.fromJson(PracticeJson.read("1")),Map.of("ListTask.java","blocked"),0,null));});assertTrue(starting.await(5,java.util.concurrent.TimeUnit.SECONDS));
            try(var pause=connection.prepareStatement("UPDATE workspace SET disabled=true WHERE id=?")){pause.setString(1,f.teacher().workspace());pause.executeUpdate();}connection.commit();assertEquals(404,saving.get(30,java.util.concurrent.TimeUnit.SECONDS).status());
        }assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));assertEquals(401,get(f.learner().client(),f.path()).statusCode());
    }
    @Test void typedScalarDomainAndDefensiveSnapshotCopies(){
        assertNotEquals(ExerciseRevision.fromJson(PracticeJson.read("1")),ExerciseRevision.fromJson(PracticeJson.read("\"1\"")));assertEquals("n:1",ExerciseRevision.fromJson(PracticeJson.read("1.0")).key());assertEquals("s: 1 ",ExerciseRevision.fromJson(PracticeJson.read("\" 1 \"")).key());
        for(String invalid:List.of("null","true","{}","[]","-1","1.5","9007199254740992","1.0000000000000000000001","\"\"","\""+"x".repeat(101)+"\"","\"\\ud800\""))assertThrows(IllegalArgumentException.class,()->ExerciseRevision.fromJson(PracticeJson.read(invalid)),invalid);
        assertEquals("n:0",ExerciseRevision.fromJson(PracticeJson.read("0")).key());assertEquals("n:9007199254740991",ExerciseRevision.fromJson(PracticeJson.read("9007199254740991")).key());
        var node=json.createObjectNode().put("id","before");var e=new PublishedExercise("x",ExerciseRevision.fromJson(PracticeJson.read("1")),node,node,node,node);node.put("id","mutated");((tools.jackson.databind.node.ObjectNode)e.privateExercise()).put("id","returned mutation");assertEquals("before",e.privateExercise().get("id").asText());
    }
    @Test void draftCodeBodyCapAppliesToDeclaredChunkedAndVendorJsonAfterSecurity()throws Exception {
        var f=fixture("practice-body");var s=source();publish(f,s);assign(f,0,"list-task");String path=draftPath(f,"list-task");
        for(boolean chunked:List.of(false,true)){
            long revision=chunked?1:0;String body=json.writeValueAsString(save(1,revision,Map.of("ListTask.java","class ListTask {}")));String exact=body+" ".repeat(1605632-body.getBytes(StandardCharsets.UTF_8).length);
            assertEquals(200,raw(f.learner(),path,exact,chunked,"application/vnd.mentor+json").statusCode());
            body=json.writeValueAsString(save(1,revision+1,Map.of("ListTask.java","must not persist")));String excessive=body+" ".repeat(1605633-body.getBytes(StandardCharsets.UTF_8).length);
            assertEquals(413,raw(f.learner(),path,excessive,chunked,"application/vnd.mentor+json").statusCode());
        }
        var session=session(f.learner().client());String huge=" ".repeat(1605633);
        var csrf=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.learner().id()).header("Content-Type","application/json").PUT(HttpRequest.BodyPublishers.ofString(huge)).build();assertEquals(403,f.learner().client().send(csrf,HttpResponse.BodyHandlers.ofString()).statusCode());
        var account=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account","old-account").header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","application/json").PUT(HttpRequest.BodyPublishers.ofString(huge)).build();assertEquals(409,f.learner().client().send(account,HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(2,data(get(f.learner().client(),path),200).get("revision").asLong());
    }
    @Test void rawDecimalRevisionIsExactBeforeScalarValidation()throws Exception {
        var f=fixture("practice-decimal");var source=source();publish(f,source);assign(f,0,"list-task");String path=draftPath(f,"list-task");
        String files=json.writeValueAsString(Map.of("ListTask.java","class ListTask {}"));
        assertEquals(400,raw(f.learner(),path,"{\"exerciseRevision\":1.0000000000000000000001,\"revision\":0,\"files\":"+files+"}",false,"application/json").statusCode());
        assertEquals(200,raw(f.learner(),path,"{\"exerciseRevision\":1.0,\"revision\":0,\"files\":"+files+"}",false,"application/json").statusCode());
        revision(source,9007199254740991L);publish(f,source);
        String decimal="{\"exerciseRevision\":9007199254740990.999,\"resetForRevision\":9007199254740991,\"revision\":1,\"files\":"+files+"}";
        assertEquals(400,raw(f.learner(),path,decimal,false,"application/vnd.mentor+json").statusCode());
    }
    @Test void typedRevisionResetArchivesExactPriorSourceAndNeverSubstitutesTemplate()throws Exception {
        var f=fixture("practice-reset");var source=source();assertEquals(3,publish(f,source).published());var assigned=assign(f,0,"list-task");String assignment=assigned.get("exercises").get(0).get("assignmentId").asText();String path=draftPath(f,"list-task");
        var missing=data(get(f.learner().client(),path),200);assertEquals(0,missing.get("revision").asLong());assertTrue(missing.get("updatedAt").isNull());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_draft",Integer.class));
        String code="  // точный код😀\nclass ListTask {}\n";var old=data(write(f.learner().client(),"PUT",path,save(1,0,Map.of("ListTask.java",code))),200);assertEquals(1,old.get("revision").asLong());
        assertEquals(409,write(f.learner().client(),"PUT",path,save(1,0,Map.of("ListTask.java","stale"))).statusCode());
        revision(source,"1");assertEquals(1,publish(f,source).published());var still=data(get(f.learner().client(),path),200);assertTrue(still.get("exerciseRevision").isNumber());assertEquals(code,still.get("files").get("ListTask.java").asText());
        assertTrue(data(get(f.learner().client(),f.path()),200).get("exercises").get(0).get("draft").get("outdated").asBoolean());
        assertEquals(409,write(f.learner().client(),"PUT",path,save("1",1,Map.of("ListTask.java","must-not-save"))).statusCode());
        var reset=new java.util.HashMap<>(save("1",1,Map.of("ListTask.java","// manual port\nclass ListTask {}")));reset.put("resetForRevision",1);
        assertEquals(409,write(f.learner().client(),"PUT",path,reset).statusCode());reset.put("resetForRevision","1");
        var current=data(write(f.learner().client(),"PUT",path,reset),200);assertEquals(2,current.get("revision").asLong());assertTrue(current.get("exerciseRevision").isString());assertEquals("// manual port\nclass ListTask {}",current.get("files").get("ListTask.java").asText());
        var history=data(get(f.learner().client(),f.path()+"/draft-archives"),200);assertEquals(1,history.get("total").asLong());var summary=history.get("items").get(0);assertFalse(summary.has("files"));assertEquals(assignment,summary.get("assignmentId").asText());assertEquals(old.get("updatedAt"),summary.get("updatedAt"));
        var archive=data(get(f.teacher().client(),f.path()+"/draft-archives/"+summary.get("id").asText()+"?audience=student"),200);assertEquals(code,archive.get("files").get("ListTask.java").asText());assertTrue(archive.get("exerciseRevision").isNumber());
        assign(f,1);assertEquals(404,write(f.learner().client(),"PUT",path,save("1",2,Map.of("ListTask.java","inactive"))).statusCode());assertEquals(current,data(get(f.learner().client(),path),200));assertEquals(1,data(get(f.learner().client(),f.path()+"/draft-archives"),200).get("total").asLong());
        assertEquals(assignment,assign(f,2,"list-task").get("exercises").get(0).get("assignmentId").asText());
        reset=new java.util.HashMap<>(save("1",2,Map.of("ListTask.java","same")));reset.put("resetForRevision",2);assertEquals(409,write(f.learner().client(),"PUT",path,reset).statusCode());
        assertEquals(403,write(f.teacher().client(),"PUT",path,save("1",2,Map.of("ListTask.java","teacher"))).statusCode());
    }
    @Test void emptyAssignmentsAreExplicitAndCasVersioned()throws Exception {
        var f=fixture("practice-empty");var empty=data(get(f.learner().client(),f.path()),200);
        assertEquals(0,empty.get("revision").asLong());assertEquals(0,empty.get("exercises").size());
        var saved=data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",java.util.List.of())),200);
        assertEquals(1,saved.get("revision").asLong());assertEquals(0,saved.get("exercises").size());
        assertEquals(409,write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",java.util.List.of())).statusCode());
        assertEquals(1,data(get(f.learner().client(),f.path()),200).get("revision").asLong());
    }
}
