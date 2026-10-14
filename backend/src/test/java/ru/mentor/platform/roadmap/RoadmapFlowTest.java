package ru.mentor.platform.roadmap;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class RoadmapFlowTest extends IdentityHttpTest {
    // Catches stale overwrites, two current stages, unbounded lists, students editing their own route and cross-workspace reads.
    @Test void teacherReplacesStagesUnderRevisionAndStudentReadsThem() throws Exception {
        var teacher=teacher("roadmap-teacher");String student=student(teacher,"Roadmap student").get("id").asText();var learner=enroll(teacher,student,"roadmap-student");
        String path=card(teacher,student)+"/roadmap";
        var empty=data(get(learner.client(),path),200);assertEquals(0,empty.get("stages").size());assertEquals(1,empty.get("revision").asLong());
        List<Map<String,Object>> stages=List.of(Map.of("title"," Основы Java ","state","done"),Map.of("title","Коллекции","state","current","note","занятия 7–8"),Map.of("title","Собеседование","state","ahead","note","март 2027"));
        var saved=data(write(teacher.client(),"PUT",path,Map.of("stages",stages,"revision",1)),200);
        assertEquals(2,saved.get("revision").asLong());assertEquals(3,saved.get("stages").size());
        assertEquals("Основы Java",saved.get("stages").get(0).get("title").asText());assertEquals("",saved.get("stages").get(0).get("note").asText());assertEquals("current",saved.get("stages").get(1).get("state").asText());
        assertEquals(saved,data(get(learner.client(),path),200));assertEquals(saved,data(get(teacher.client(),path+"?audience=student"),200));
        assertEquals(409,write(teacher.client(),"PUT",path,Map.of("stages",List.of(),"revision",1)).statusCode());
        List<Map<String,Object>> many=new ArrayList<>();for(int i=0;i<31;i++)many.add(Map.of("title","Stage "+i,"state","ahead"));
        for(Object bad:List.of(List.of(Map.of("title","A","state","current"),Map.of("title","B","state","current")),List.of(Map.of("title","A","state","finished")),List.of(Map.of("title","  ","state","ahead")),
                List.of(Map.of("title","A","state","ahead","extra",true)),List.of(Map.of("title","x".repeat(201),"state","ahead")),List.of(Map.of("title","A","state","ahead","note","n".repeat(121))),many))
            assertEquals(400,write(teacher.client(),"PUT",path,Map.of("stages",bad,"revision",2)).statusCode(),bad.toString());
        assertEquals(400,write(teacher.client(),"PUT",path,Map.of("stages",List.of(),"revision",2,"extra",1)).statusCode());
        assertEquals(400,write(teacher.client(),"PUT",path,Map.of("stages",List.of(),"revision",1.5)).statusCode());
        assertEquals(404,write(learner.client(),"PUT",path,Map.of("stages",List.of(),"revision",2)).statusCode());
        var foreign=teacher("roadmap-foreign");assertEquals(404,get(foreign.client(),path).statusCode());assertEquals(404,get(admin,path).statusCode());assertEquals(400,get(teacher.client(),path+"?audience=teacher").statusCode());
        var cleared=data(write(teacher.client(),"PUT",path,Map.of("stages",List.of(),"revision",2)),200);assertEquals(0,cleared.get("stages").size());assertEquals(3,cleared.get("revision").asLong());
    }
}
