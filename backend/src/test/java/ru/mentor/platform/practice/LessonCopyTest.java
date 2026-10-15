package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** T05: «Создать на основе…» copies the scenario, the student's tasks and the active exercises, and nothing that belongs to the source lesson's own history. */
class LessonCopyTest extends AttemptHttpTest {
    private static Map<String,Object> lesson(String title,Object source){var body=new HashMap<String,Object>(Map.of("title",title,"date","2030-02-01","time","15:00","duration",90));if(source!=null)body.put("source",source);return body;}

    // Catches a copy that leaks the review or work of the source, loses exercise order or placement, crosses a workspace, or half-commits.
    @Test void copiesTextsAndActiveExercisesIntoAnotherCardOfTheSameTeacher()throws Exception {
        var f=fixture("lesson-copy");publish(f,source());String sourceCard=card(f.teacher(),f.student());String sourcePath=sourceCard+"/lessons/"+f.lesson();
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","json-task","placement","class"),Map.of("exerciseId","list-task","placement","homework"),Map.of("exerciseId","grouping-task","placement","class")))),200);
        // json-task leaves the lesson: its row stays inactive and must not be copied.
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",1,"assignments",List.of(Map.of("exerciseId","grouping-task","placement","class"),Map.of("exerciseId","list-task","placement","homework")))),200);
        for(var text:List.of(List.of("teacherNotes","PRIVATE_COPY_PLAN"),List.of("studentNotes","Задачи занятия"),List.of("reviewNotes","Итог исходного занятия")))
            data(write(f.teacher().client(),"PUT",sourcePath+"/texts/"+text.get(0),Map.of("markdown",text.get(1),"revision",1)),200);
        data(write(f.teacher().client(),"PATCH",sourcePath,Map.of("revision",1,"conducted",true,"homeworkDue",Map.of("date","2030-01-02","time","23:59"))),200);
        data(uploadHomework(f.learner(),sourcePath+"/homework","Main.java","class Main {}\n".getBytes(StandardCharsets.UTF_8),null),201);

        String other=student(f.teacher(),"Second copy student").get("id").asText();var otherLearner=enroll(f.teacher(),other,"lesson-copy-other");
        String lessons=card(f.teacher(),other)+"/lessons";
        var copy=data(write(f.teacher().client(),"POST",lessons,lesson("Копия",Map.of("studentId",f.student(),"lessonId",f.lesson()))),201);
        assertEquals("Копия",copy.get("title").asText());assertEquals(other,copy.get("studentId").asText());assertEquals("planned",copy.get("status").asText());
        assertEquals("PRIVATE_COPY_PLAN",copy.get("teacherNotes").asText());assertEquals("Задачи занятия",copy.get("studentNotes").asText());assertEquals("",copy.get("reviewNotes").asText());
        assertFalse(copy.has("conductedAt"));assertFalse(copy.has("homeworkDue"));assertTrue(copy.get("bundleId").isNull());
        String copyPath=lessons+"/"+copy.get("id").asText();
        assertEquals(0,data(get(f.teacher().client(),copyPath+"/homework"),200).get("total").asLong());
        // Exercises keep their order and placement under a fresh assignment set.
        var practice=data(get(otherLearner.client(),copyPath+"/practice"),200);
        List<String> order=new ArrayList<>();for(JsonNode e:practice.get("exercises"))order.add(e.get("exercise").get("id").asText()+":"+e.get("placement").asText());
        assertEquals(List.of("grouping-task:class","list-task:homework"),order);assertEquals(1,practice.get("revision").asLong());
        for(JsonNode e:practice.get("exercises"))assertEquals(0,e.get("draft").get("revision").asLong(),"No draft travels with the copy.");
        assertEquals(200,write(f.teacher().client(),"PUT",copyPath+"/practice/assignments",Map.of("revision",1,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework")))).statusCode());
        // The student of the new card reads the tasks but never the scenario; the source is untouched.
        var learnerView=data(get(otherLearner.client(),copyPath),200);assertFalse(learnerView.has("teacherNotes"));assertEquals("Задачи занятия",learnerView.get("studentNotes").asText());
        assertEquals("Итог исходного занятия",data(get(f.teacher().client(),sourcePath),200).get("reviewNotes").asText());
        // Copying into the same card works; empty sources copy nothing.
        String empty=data(write(f.teacher().client(),"POST",sourceCard+"/lessons",lesson("Пустое",null)),201).get("id").asText();
        var plain=data(write(f.teacher().client(),"POST",sourceCard+"/lessons",lesson("Из пустого",Map.of("studentId",f.student(),"lessonId",empty))),201);
        assertEquals("",plain.get("teacherNotes").asText());assertEquals(0,data(get(f.teacher().client(),sourceCard+"/lessons/"+plain.get("id").asText()+"/practice"),200).get("exercises").size());

        // Invalid or foreign sources are refused and leave no lesson behind.
        long before=data(get(f.teacher().client(),lessons),200).get("total").asLong();
        var foreign=fixture("lesson-copy-foreign");
        for(Object bad:List.of(Map.of("studentId",f.student()),Map.of("studentId",f.student(),"lessonId",f.lesson(),"extra","x"),Map.of("studentId","","lessonId",f.lesson()),"lesson-id"))
            assertEquals(400,write(f.teacher().client(),"POST",lessons,lesson("Bad",bad)).statusCode(),String.valueOf(bad));
        assertEquals(404,write(f.teacher().client(),"POST",lessons,lesson("Missing",Map.of("studentId",f.student(),"lessonId","missing"))).statusCode());
        assertEquals(404,write(f.teacher().client(),"POST",lessons,lesson("Foreign",Map.of("studentId",foreign.student(),"lessonId",foreign.lesson()))).statusCode());
        assertEquals(404,write(foreign.teacher().client(),"POST",card(foreign.teacher(),foreign.student())+"/lessons",lesson("Steal",Map.of("studentId",f.student(),"lessonId",f.lesson()))).statusCode());
        assertEquals(404,write(f.learner().client(),"POST",lessons,lesson("Learner",Map.of("studentId",f.student(),"lessonId",f.lesson()))).statusCode());
        assertEquals(before,data(get(f.teacher().client(),lessons),200).get("total").asLong());
        assertEquals(1,data(get(foreign.teacher().client(),card(foreign.teacher(),foreign.student())+"/lessons"),200).get("total").asLong());
    }
}
