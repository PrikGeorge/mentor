package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class PracticeHistoryTest extends AttemptHttpTest {
    @Test void attemptsRemainDiscoverableAfterRemovalAndDoNotDependOnSavedDrafts() throws Exception {
        var f=fixture("discovery-attempt");publish(f,source());assign(f,0,"list-task");
        var attempt=data(enqueue(f,"saved-attempt",code("// submitted immutable source")),202);
        var active=data(get(f.learner().client(),f.path()+"/history"),200).get("items").get(0);
        assertTrue(active.get("active").asBoolean());assertTrue(active.get("hasAttempts").asBoolean());assertFalse(active.get("hasDraft").asBoolean());
        assign(f,1);
        jdbc.update("UPDATE practice_exercise SET current_key=NULL WHERE workspace_id=? AND id='list-task'",f.teacher().workspace());
        for(var user:List.of(f.learner(),f.teacher())) {
            var item=data(get(user.client(),f.path()+"/history"),200).get("items").get(0);
            assertFalse(item.get("active").asBoolean());assertTrue(item.get("hasAttempts").asBoolean());
            assertFalse(item.get("hasDraft").asBoolean());assertFalse(item.get("hasArchives").asBoolean());
            var detail=data(get(user.client(),attempts(f)+"/"+attempt.get("id").asText()),200);
            assertEquals("// submitted immutable source",detail.get("files").get("ListTask.java").asText());
        }
    }
    @Test void discoversRemovedUnknownDraftAndArchiveWithoutCatalogOrPreparedMaterials() throws Exception {
        var f=fixture("discovery-student");publish(f,source());
        var assigned=assign(f,0,"list-task","grouping-task","json-task");
        String archiveAssignment=assigned.get("exercises").get(1).get("assignmentId").asText();
        data(write(f.learner().client(),"PUT",draftPath(f,"list-task"),save(1,0,Map.of("ListTask.java","// preserved draft"))),200);
        jdbc.update("INSERT INTO practice_draft_archive(workspace_id,id,assignment_id,exercise_revision,revision,files,updated_at,reason) VALUES (?,?,?,'\"old\"'::jsonb,1,'{\"Old.java\":\"private historical source\"}'::jsonb,now(),'imported')",f.teacher().workspace(),"old-archive",archiveAssignment);
        assign(f,1);
        // Emulate an imported historical exercise with no published definition.
        jdbc.update("INSERT INTO practice_exercise(workspace_id,id) VALUES (?,?)",f.teacher().workspace(),"obsolete-task");
        jdbc.update("UPDATE practice_assignment SET exercise_id='obsolete-task' WHERE workspace_id=? AND exercise_id='list-task'",f.teacher().workspace());
        for(var user:List.of(f.learner(),f.teacher())) {
            var response=get(user.client(),f.path()+"/history?size=1");
            var first=data(response,200);assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
            assertEquals(2,first.get("total").asLong());assertEquals("grouping-task",first.get("items").get(0).get("exerciseId").asText());
            var archive=first.get("items").get(0);assertFalse(archive.get("active").asBoolean());assertTrue(archive.get("hasArchives").asBoolean());assertFalse(archive.get("hasDraft").asBoolean());assertFalse(archive.get("hasAttempts").asBoolean());
            var second=data(get(user.client(),f.path()+"/history?page=1&size=1&audience=student"),200).get("items").get(0);
            assertEquals("obsolete-task",second.get("exerciseId").asText());assertTrue(second.get("hasDraft").asBoolean());assertFalse(second.get("active").asBoolean());
            Set<String> keys=new TreeSet<>();second.propertyNames().forEach(keys::add);assertEquals(Set.of("exerciseId","active","hasDraft","hasAttempts","hasArchives"),keys);
            assertEquals(0,data(get(user.client(),f.path()+"/history?page=100&size=1"),200).get("items").size());
            assertEquals("// preserved draft",data(get(user.client(),draftPath(f,"obsolete-task")),200).get("files").get("ListTask.java").asText());
        }
        assertEquals(0,data(get(f.learner().client(),f.path()),200).get("exercises").size());
    }

    @Test void exactCurrentAuthorityAndPaginationApplyToHistoryDiscovery() throws Exception {
        var f=fixture("discovery-authority");publish(f,source());assign(f,0,"list-task");
        assertEquals(0,data(get(f.learner().client(),f.path()+"/history"),200).get("total").asLong(),"Untouched active assignments are not saved history");
        var another=fixture("discovery-other");
        for(var c:List.of(admin,another.teacher().client(),another.learner().client()))assertEquals(404,get(c,f.path()+"/history").statusCode());
        assertEquals(401,get(client(),f.path()+"/history").statusCode());
        assertEquals(404,get(f.learner().client(),f.path().replace(f.lesson(),another.lesson())+"/history").statusCode());
        for(String query:List.of("page=-1","size=0","size=101","audience=teacher"))assertEquals(400,get(f.teacher().client(),f.path()+"/history?"+query).statusCode());
        jdbc.update("UPDATE workspace_membership SET disabled=true WHERE user_id=?",f.learner().id());
        assertEquals(401,get(f.learner().client(),f.path()+"/history").statusCode());
    }
}
