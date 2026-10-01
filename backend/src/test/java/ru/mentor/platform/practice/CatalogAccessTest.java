package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CatalogAccessTest extends PracticeHttpTest {
    @Test void undeclaredFilesCannotEnterATrustedExerciseSnapshot()throws Exception {
        var f=fixture("catalog-extra-source");var source=source();java.nio.file.Files.writeString(source.catalog().getParent().resolve("exercises/list-task/Hidden.java"),"class Hidden {}");
        assertEquals(0,publish(f,source).published());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_exercise_revision",Integer.class));
    }
    @Test void manifestMapIdentityDependencyOrderAndProcessorsMustMatchApproval()throws Exception {
        var f=fixture("catalog-pins");var source=source();String original=java.nio.file.Files.readString(source.manifest());
        for(int mode=0;mode<3;mode++){
            var manifest=(tools.jackson.databind.node.ObjectNode)json.readTree(original);var pin=(tools.jackson.databind.node.ObjectNode)manifest.get("environments").get("java21-jackson");
            if(mode==0)pin.put("id","other");else if(mode==1)((tools.jackson.databind.node.ArrayNode)pin.get("dependencies")).set(0,json.valueToTree("/opt/mentor/deps/dependency-2.jar"));else pin.putArray("annotationProcessors").add("some.UnapprovedProcessor");
            java.nio.file.Files.writeString(source.manifest(),json.writeValueAsString(manifest));assertFalse(publish(f,source).errors().isEmpty());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_exercise_revision",Integer.class));
        }
        java.nio.file.Files.writeString(source.manifest(),original);assertEquals(3,publish(f,source).published());
    }
    @Test void tenantOwnershipHistoryAndCompositeForeignKeysStayScoped()throws Exception {
        var own=fixture("catalog-own");var other=fixture("catalog-other");var source=source();publish(own,source);publish(other,source);assign(own,0,"list-task");assign(other,0,"list-task");
        String path=draftPath(own,"list-task");data(write(own.learner().client(),"PUT",path,save(1,0,java.util.Map.of("ListTask.java","private own student code"))),200);revision(source,"next");publish(own,source);var reset=new java.util.HashMap<>(save("next",1,java.util.Map.of("ListTask.java","next code")));reset.put("resetForRevision","next");data(write(own.learner().client(),"PUT",path,reset),200);
        String archive=data(get(own.learner().client(),own.path()+"/draft-archives"),200).get("items").get(0).get("id").asText();
        for(var c:java.util.List.of(other.teacher().client(),other.learner().client(),admin))for(String p:java.util.List.of(own.path(),path,own.path()+"/draft-archives",own.path()+"/draft-archives/"+archive,"/workspaces/"+own.teacher().workspace()+"/exercises")){var response=get(c,p);assertEquals(404,response.statusCode());assertFalse(response.body().contains("private own student code"));}
        var anotherCard=student(own.teacher(),"Other own card").get("id").asText();String anotherLesson=data(write(own.teacher().client(),"POST",card(own.teacher(),anotherCard)+"/lessons",java.util.Map.of("title","Other","date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();assertEquals(404,get(own.learner().client(),card(own.teacher(),anotherCard)+"/lessons/"+anotherLesson+"/practice").statusCode());
        assign(own,1);jdbc.update("UPDATE practice_exercise SET current_key=NULL WHERE workspace_id=? AND id='list-task'",own.teacher().workspace());assertEquals("next code",data(get(own.learner().client(),path),200).get("files").get("ListTask.java").asText());assertEquals("private own student code",data(get(own.learner().client(),own.path()+"/draft-archives/"+archive),200).get("files").get("ListTask.java").asText());
        String foreignAssignment=jdbc.queryForObject("SELECT id FROM practice_assignment WHERE workspace_id=?",String.class,other.teacher().workspace());assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("INSERT INTO practice_draft(workspace_id,assignment_id,exercise_revision,revision,files,updated_at) VALUES (?,?,'1'::jsonb,1,'{}'::jsonb,now())",own.teacher().workspace(),foreignAssignment));
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("INSERT INTO practice_assignment_set(workspace_id,student_id,lesson_id) VALUES (?,?,?)",other.teacher().workspace(),own.student(),own.lesson()));
        assertEquals(1,data(get(other.learner().client(),"/workspaces/"+other.teacher().workspace()+"/exercises"),200).get("items").get(0).get("revision").asInt());
    }
    @Test void publicationIsAtomicPinnedAndOldReplayNeverRollsBackCurrent()throws Exception {
        var f=fixture("catalog-atomic");var source=source();String original=java.nio.file.Files.readString(source.catalog());assertEquals(3,publish(f,source).published());
        revision(source,"new");assertEquals(1,publish(f,source).published());java.nio.file.Files.writeString(source.catalog(),original);assertEquals(0,publish(f,source).published());
        String path="/workspaces/"+f.teacher().workspace()+"/exercises";assertEquals("new",data(get(f.teacher().client(),path),200).get("items").get(2).get("revision").asText());
        var records=(tools.jackson.databind.node.ArrayNode)json.readTree(source.catalog().toFile());((tools.jackson.databind.node.ObjectNode)records.get(0)).put("revision",99);((tools.jackson.databind.node.ObjectNode)records.get(1)).put("method","java.lang.Runtime.exec");java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));assertFalse(publish(f,source).errors().isEmpty());assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM practice_exercise_revision",Integer.class));
        java.nio.file.Files.writeString(source.catalog(),original);var manifest=(tools.jackson.databind.node.ObjectNode)json.readTree(source.manifest().toFile());((tools.jackson.databind.node.ObjectNode)manifest.get("environments").get("java21")).put("imageDigest","mutable:latest");java.nio.file.Files.writeString(source.manifest(),json.writeValueAsString(manifest));assertFalse(publish(f,source).errors().isEmpty());
        var badHash=context.getBean(CatalogCommand.class).run(new String[]{"--source",source.catalog().toString(),"--workspace",f.teacher().workspace(),"--environment-manifest",source.manifest().toString(),"--environment-manifest-sha256","0".repeat(64),"--environment-profiles-sha256",sha(source.profiles())});assertFalse(badHash.errors().isEmpty());
        String privateSnapshot=jdbc.queryForObject("SELECT private_json::text FROM practice_exercise_revision WHERE exercise_id='grouping-task'",String.class);assertTrue(privateSnapshot.contains("constructorTypes"));assertTrue(privateSnapshot.contains("unchangedArguments"));
        String pin=jdbc.queryForObject("SELECT environment_json::text FROM practice_exercise_revision WHERE exercise_id='json-task'",String.class);assertTrue(pin.contains("sha256:"+"b".repeat(64)));assertTrue(pin.contains("/opt/mentor/deps/dependency-2.jar"));
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("UPDATE practice_exercise_revision SET private_json='{}'::jsonb"));
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("DELETE FROM practice_exercise_revision WHERE exercise_id='list-task' AND revision_key='n:1'"));
    }
    @Test void sourcePathsByteBoundsAndUnsupportedTypesAreRejectedBeforePublication()throws Exception {
        var f=fixture("catalog-source");var source=source();var records=(tools.jackson.databind.node.ArrayNode)json.readTree(source.catalog().toFile());var first=(tools.jackson.databind.node.ObjectNode)records.get(0);
        first.putArray("starterFiles").add("../ListTask.java");java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));assertFalse(publish(f,source).errors().isEmpty());assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_exercise_revision",Integer.class));
        first.putArray("starterFiles").add("ListTask.java");first.putArray("parameterTypes").add("java.lang.Runtime").add("int");java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));assertFalse(publish(f,source).errors().isEmpty());
        first.putArray("parameterTypes").add("java.util.List").add("int");java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));
        java.nio.file.Path file=source.catalog().getParent().resolve("exercises/list-task/ListTask.java");java.nio.file.Files.writeString(file,"я".repeat(65536));assertEquals(3,publish(f,source).published());
        first.put("revision",2);java.nio.file.Files.writeString(source.catalog(),json.writeValueAsString(records));java.nio.file.Files.writeString(file,"я".repeat(65536)+"a");assertFalse(publish(f,source).errors().isEmpty());
    }
    @Test void fractionalOperatorRevisionCannotRoundIntoAnInteger()throws Exception {
        var f=fixture("catalog-decimal");var source=source();String original=java.nio.file.Files.readString(source.catalog());
        for(String token:java.util.List.of("1.0000000000000000000001","9007199254740990.999")){
            java.nio.file.Files.writeString(source.catalog(),original.replaceFirst("\"revision\":1","\"revision\":"+token));var report=publish(f,source);assertEquals(0,report.published());assertFalse(report.errors().isEmpty(),"Fractional input must be rejected exactly");
        }
        java.nio.file.Files.writeString(source.catalog(),original.replaceFirst("\"revision\":1","\"revision\":1.0"));assertEquals(3,publish(f,source).published());
    }
    @Test void immutablePublicationPreservesExistingCatalogAndStudentProjection()throws Exception {
        var f=fixture("catalog-publish");var s=source();assertEquals(3,publish(f,s).published());assertTrue(publish(f,s).errors().isEmpty());assertEquals(0,publish(f,s).published());
        String path="/workspaces/"+f.teacher().workspace()+"/exercises";var catalog=data(get(f.teacher().client(),path+"?audience=student"),200);assertEquals(3,catalog.get("total").asLong());
        for(var exercise:catalog.get("items")){assertEquals(java.util.Set.of("id","revision","title","statement","environment","starterFiles"),exercise.propertyNames());assertEquals(java.util.Set.of("id","title","javaVersion","dependencies"),exercise.get("environment").propertyNames());}
        assertEquals(0,data(get(f.learner().client(),path),200).get("total").asLong());assign(f,0,"list-task","json-task");assertEquals(2,data(get(f.learner().client(),path),200).get("total").asLong());
        var foreign=fixture("catalog-foreign");assertEquals(404,write(foreign.teacher().client(),"PUT",foreign.path()+"/assignments",java.util.Map.of("revision",0,"assignments",java.util.List.of(java.util.Map.of("exerciseId","list-task","placement","class")))).statusCode());
        var records=(tools.jackson.databind.node.ArrayNode)json.readTree(s.catalog().toFile());((tools.jackson.databind.node.ObjectNode)records.get(0)).put("statement","changed private immutable revision");java.nio.file.Files.writeString(s.catalog(),json.writeValueAsString(records));
        var rejected=publish(f,s);assertEquals(0,rejected.published());assertFalse(rejected.errors().isEmpty());assertEquals(3,data(get(f.teacher().client(),path),200).get("total").asLong());
    }
    @Test void freshWorkspaceHasEmptyScopedCatalogAndAdminCannotReadIt()throws Exception {
        var f=fixture("catalog-empty");String path="/workspaces/"+f.teacher().workspace()+"/exercises";
        var catalog=data(get(f.teacher().client(),path),200);assertEquals(0,catalog.get("total").asLong());assertEquals(0,catalog.get("items").size());
        assertEquals(404,get(admin,path).statusCode());assertEquals(0,data(get(f.learner().client(),path),200).get("total").asLong());
    }
}
