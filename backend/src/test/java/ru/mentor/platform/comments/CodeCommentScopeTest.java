package ru.mentor.platform.comments;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ru.mentor.platform.support.*;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** A line comment belongs to one target of one lesson of one card; the lesson in the route must own the target (Q-12). */
class CodeCommentScopeTest extends IdentityHttpTest {
    private static final Path RUNTIME=IsolatedBlobRuntime.create("mentor-comment-scope-test-");
    private static final byte[] SOURCE="class Main {\n  void run() {}\n}\n".getBytes(StandardCharsets.UTF_8);
    @TempDir Path temporary;
    @AfterAll static void cleanupRuntime()throws Exception{IsolatedBlobRuntime.cleanup(RUNTIME);}

    private record Fixture(User teacher,User learner,String student,String first,String second){
        String lesson(String id){return "/workspaces/"+teacher.workspace()+"/students/"+student+"/lessons/"+id;}
        String comments(String lesson){return lesson(lesson)+"/code-comments";}
    }
    private Fixture fixture(String login)throws Exception {
        var teacher=teacher(login);String student=student(teacher,"Synthetic comment student").get("id").asText();var learner=enroll(teacher,student,login+"-student");
        return new Fixture(teacher,learner,student,lesson(teacher,student,"First","2030-01-01"),lesson(teacher,student,"Second","2030-01-08"));
    }
    private String upload(Fixture f,String lesson)throws Exception{var r=data(uploadHomework(f.learner(),f.lesson(lesson)+"/homework","Main.java",SOURCE,null),201).get("id").asText();CLOCK.advance(Duration.ofSeconds(1));return r;}
    private Map<String,Object> comment(String kind,String target,String file,int line,String body){return Map.of("targetKind",kind,"targetId",target,"file",file,"line",line,"body",body);}
    private int count(Fixture f,String lesson,String kind,String target)throws Exception{return data(get(f.teacher().client(),f.comments(lesson)+"?targetKind="+kind+"&targetId="+target),200).get("items").size();}

    // Catches a comment attached through the route of another lesson of the same student, for a file and for a trainer attempt.
    @Test void targetOfAnotherLessonOfTheSameStudentIsNotFound()throws Exception {
        var f=fixture("comment-scope");String inFirst=upload(f,f.first()),inSecond=upload(f,f.second());
        for(var crossed:List.of(Map.entry(f.first(),inSecond),Map.entry(f.second(),inFirst))){
            var response=write(f.teacher().client(),"POST",f.comments(crossed.getKey()),comment("homework",crossed.getValue(),"Main.java",1,"wrong lesson"));
            assertEquals(404,response.statusCode(),crossed.toString());assertEquals("NOT_FOUND",data(response,404).get("code").asText());
        }
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM code_comment",Integer.class));
        // The same text through the right lesson is accepted, and each lesson lists only its own target.
        var own=data(write(f.teacher().client(),"POST",f.comments(f.first()),comment("homework",inFirst,"Main.java",1,"right lesson")),201);
        assertEquals(1,count(f,f.first(),"homework",inFirst));assertEquals(0,count(f,f.second(),"homework",inFirst));assertEquals(0,count(f,f.first(),"homework",inSecond));
        assertEquals(0,data(get(f.learner().client(),f.comments(f.second())+"?targetKind=homework&targetId="+inFirst),200).get("items").size());
        // A trainer attempt of the second lesson cannot be commented from the first, nor from a lesson of a stranger.
        TrainingCatalog.publish(context,json,temporary,f.teacher().workspace());
        data(write(f.teacher().client(),"PUT",f.lesson(f.second())+"/practice/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","class")))),200);
        String attempt=data(write(f.learner().client(),"POST",f.lesson(f.second())+"/practice/exercises/list-task/attempts",Map.of("exerciseRevision",1,"mode","run","files",Map.of("ListTask.java","class ListTask {\n    int x;\n}")),"Idempotency-Key","scope-1"),202).get("id").asText();
        assertEquals(404,write(f.teacher().client(),"POST",f.comments(f.first()),comment("attempt",attempt,"ListTask.java",1,"wrong lesson")).statusCode());
        assertEquals(201,write(f.teacher().client(),"POST",f.comments(f.second()),comment("attempt",attempt,"ListTask.java",1,"right lesson")).statusCode());
        // A kind mismatch is not a way around the scope: a file id as an attempt or an attempt id as a file is simply unknown.
        assertEquals(404,write(f.teacher().client(),"POST",f.comments(f.first()),comment("attempt",inFirst,"Main.java",1,"kind swap")).statusCode());
        assertEquals(404,write(f.teacher().client(),"POST",f.comments(f.second()),comment("homework",attempt,"ListTask.java",1,"kind swap")).statusCode());
        var foreign=fixture("comment-scope-foreign");
        assertEquals(404,write(foreign.teacher().client(),"POST",foreign.comments(foreign.first()),comment("homework",inFirst,"Main.java",1,"stranger")).statusCode());
        assertEquals(404,write(foreign.teacher().client(),"POST",f.comments(f.first()),comment("homework",inFirst,"Main.java",1,"stranger")).statusCode());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM code_comment",Integer.class));
        assertEquals(own.get("id").asText(),data(get(f.learner().client(),f.comments(f.first())+"?targetKind=homework&targetId="+inFirst),200).get("items").get(0).get("id").asText());
    }

    // Catches deleting one comment taking the comments of a resubmission or of the older work with it, and deletion through another lesson's route.
    @Test void deletingAfterAResubmissionLeavesEveryOtherCommentInPlace()throws Exception {
        var f=fixture("comment-delete");String first=upload(f,f.first());
        var c1=data(write(f.teacher().client(),"POST",f.comments(f.first()),comment("homework",first,"Main.java",1,"first work, line one")),201);
        var c3=data(write(f.teacher().client(),"POST",f.comments(f.first()),comment("homework",first,"Main.java",2,"first work, line two")),201);
        String again=upload(f,f.first());
        var c2=data(write(f.teacher().client(),"POST",f.comments(f.first()),comment("homework",again,"Main.java",2,"second work")),201);
        String other=upload(f,f.second());var c4=data(write(f.teacher().client(),"POST",f.comments(f.second()),comment("homework",other,"Main.java",3,"other lesson")),201);
        assertEquals(2,count(f,f.first(),"homework",first));assertEquals(1,count(f,f.first(),"homework",again));assertEquals(1,count(f,f.second(),"homework",other));
        // The route must name the lesson that owns the comment: the second lesson's route does not delete the first lesson's comment.
        assertEquals(404,write(f.teacher().client(),"DELETE",f.comments(f.second())+"/"+c1.get("id").asText(),null).statusCode());
        assertEquals(404,write(f.learner().client(),"DELETE",f.comments(f.first())+"/"+c1.get("id").asText(),null).statusCode());
        assertEquals(404,write(fixture("comment-delete-foreign").teacher().client(),"DELETE",f.comments(f.first())+"/"+c1.get("id").asText(),null).statusCode());
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM code_comment",Integer.class));
        assertEquals(204,write(f.teacher().client(),"DELETE",f.comments(f.first())+"/"+c1.get("id").asText(),null).statusCode());
        var remaining=data(get(f.learner().client(),f.comments(f.first())+"?targetKind=homework&targetId="+first),200).get("items");
        assertEquals(1,remaining.size());assertEquals(c3.get("id"),remaining.get(0).get("id"));assertEquals("first work, line two",remaining.get(0).get("body").asText());
        var resubmission=data(get(f.learner().client(),f.comments(f.first())+"?targetKind=homework&targetId="+again),200).get("items");assertEquals(1,resubmission.size());assertEquals(c2.get("id"),resubmission.get(0).get("id"));
        assertEquals(c4.get("id"),data(get(f.learner().client(),f.comments(f.second())+"?targetKind=homework&targetId="+other),200).get("items").get(0).get("id"));
        assertEquals(404,write(f.teacher().client(),"DELETE",f.comments(f.first())+"/"+c1.get("id").asText(),null).statusCode());
        assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM code_comment",Integer.class));
        // The works themselves are untouched by removing remarks.
        var works=data(get(f.learner().client(),f.lesson(f.first())+"/homework"),200);assertEquals(2,works.get("total").asLong());
        assertEquals(3,data(get(f.learner().client(),"/workspaces/"+f.teacher().workspace()+"/students/"+f.student()+"/moves"),200).get("total").asLong());
    }
}
