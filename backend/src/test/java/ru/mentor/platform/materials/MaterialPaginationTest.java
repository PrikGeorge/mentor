package ru.mentor.platform.materials;

import org.junit.jupiter.api.Test;
import ru.mentor.platform.support.IdentityHttpTest;
import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class MaterialPaginationTest extends IdentityHttpTest {
    @Test void visibilityPrecedesPaginationAndCountsOnlyTheRequestedBinding() throws Exception {
        var teacher = teacher("material-pages-owner");
        String student = student(teacher, "Material pages").get("id").asText();
        var learner = enroll(teacher, student, "material-pages-student");
        String lesson = data(write(teacher.client(), "POST", card(teacher, student) + "/lessons",
            Map.of("title", "Materials", "date", "2030-01-01", "time", "12:00", "duration", 60)), 201).get("id").asText();
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='current' WHERE workspace_id=? AND id=?", teacher.workspace(), lesson);
        insert(teacher, student, lesson, "current", "00-private", "teacher", "doc", "private", document(false));
        insert(teacher, student, lesson, "current", "01-solution", "student", "code", "solution", Map.of("teacher", true, "text", "PRIVATE", "materialId", "source"));
        insert(teacher, student, lesson, "old", "02-stale", "student", "doc", "stale", document(false));
        insert(teacher, student, lesson, "current", "03-public", "student", "doc", "public", document(false));
        insert(teacher, student, lesson, "current", "04-code", "student", "code", "code", Map.of("teacher", false, "text", "class Main {}", "materialId", "source"));
        // Only code uses the teacher flag; an unrelated document field must not hide the document.
        insert(teacher, student, lesson, "current", "05-docflag", "student", "doc", "docflag", document(true));
        insert(teacher, student, lesson, "current", "06-view", "student", "view", "view", Map.of(
            "descriptors", Map.of("public", List.of("Public", "Description"), "docflag", List.of("Later page", "Description"),
                "private", List.of("PRIVATE", "Description"), "stale", List.of("STALE", "Description")),
            "resources", List.of(List.of("public", "Public", "Description", "link"), List.of("docflag", "Later page", "Description", "link"),
                List.of("private", "PRIVATE", "Description", "link"), List.of("stale", "STALE", "Description", "link"))));
        insert(teacher, student, null, null, "profile-public", "student", "doc", "profile", document(false));
        insert(teacher, student, null, null, "profile-private", "teacher", "doc", "profile-private", document(false));
        // Distractors make each SQL binding predicate observable, including matching local IDs in another workspace.
        String otherStudent = student(teacher, "Other binding").get("id").asText();
        insert(teacher, otherStudent, null, null, "00-other-card", "student", "doc", "other", document(false));
        String otherLesson = lesson(teacher, student, "Other lesson", "2030-01-02");
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='current' WHERE workspace_id=? AND id=?", teacher.workspace(), otherLesson);
        insert(teacher, student, otherLesson, "current", "00-other-lesson", "student", "doc", "other", document(false));
        var foreignTeacher = teacher("material-pages-foreign");
        jdbc.update("INSERT INTO student_profile(workspace_id,id,name,direction,goal,schedule,notes,student_roadmap,student_review,created_at) SELECT ?,id,'Foreign','','','','','','',created_at FROM student_profile WHERE workspace_id=? AND id=?",
            foreignTeacher.workspace(), teacher.workspace(), student);
        jdbc.update("INSERT INTO lesson(workspace_id,student_id,id,title,local_date,local_time,duration,status,bundle_id,created_at) SELECT ?,student_id,id,'Foreign',local_date,local_time,duration,status,bundle_id,created_at FROM lesson WHERE workspace_id=? AND id=?",
            foreignTeacher.workspace(), teacher.workspace(), lesson);
        insert(foreignTeacher, student, null, null, "00-other-workspace-profile", "student", "doc", "foreign", document(false));
        insert(foreignTeacher, student, lesson, "current", "00-other-workspace-lesson", "student", "doc", "foreign", document(false));
        String route = card(teacher, student) + "/lessons/" + lesson + "/materials";
        for (HttpClient client : List.of(learner.client(), teacher.client())) {
            String audience = client == teacher.client() ? "&audience=student" : "";
            assertPage(client, route + "?size=2&page=0" + audience, 4, List.of("03-public", "04-code"));
            assertPage(client, route + "?size=2&page=1" + audience, 4, List.of("05-docflag", "06-view"));
            assertPage(client, route + "?size=2&page=2" + audience, 4, List.of());
            assertPage(client, route + "?size=100&page=2147483647" + audience, 4, List.of());
            assertPage(client, card(teacher, student) + "/materials?size=2" + audience, 1, List.of("profile-public"));
            var view = data(get(client, "/workspaces/" + teacher.workspace() + "/materials/06-view" +
                (client == teacher.client() ? "?audience=student" : "")), 200).get("viewData");
            assertEquals(Set.of("public", "docflag"), view.get("descriptors").propertyNames());
            assertEquals(2, view.get("resources").size());
            assertFalse(view.toString().contains("PRIVATE"));
            assertFalse(view.toString().contains("STALE"));
        }
        assertPage(teacher.client(), route + "?size=2", 7, List.of("00-private", "01-solution"));
        assertPage(teacher.client(), card(teacher, student) + "/materials?size=2", 2, List.of("profile-private", "profile-public"));

        jdbc.update("UPDATE lesson SET status='planned' WHERE workspace_id=? AND id=?", teacher.workspace(), lesson);
        assertPage(learner.client(), route, 0, List.of());
        assertPage(teacher.client(), route + "?audience=student", 0, List.of());
        assertPage(teacher.client(), route + "?size=2", 7, List.of("00-private", "01-solution"));
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='new-bundle' WHERE workspace_id=? AND id=?", teacher.workspace(), lesson);
        assertPage(learner.client(), route, 0, List.of());
        assertPage(learner.client(), card(teacher, student) + "/materials", 1, List.of("profile-public"));
        assertEquals(404, get(learner.client(), "/workspaces/" + teacher.workspace() + "/materials/03-public").statusCode());
        assertEquals(200, get(teacher.client(), "/workspaces/" + teacher.workspace() + "/materials/03-public").statusCode());
        assertEquals(400, get(teacher.client(), route + "?audience=teacher").statusCode());
        assertEquals(400, get(teacher.client(), route + "?size=0").statusCode());

        var other = enroll(teacher, otherStudent, "material-pages-other");
        assertEquals(404, get(other.client(), route).statusCode());
        assertEquals(404, get(admin, route).statusCode());
        assertEquals(404, get(teacher.client(), card(teacher, otherStudent) + "/lessons/" + lesson + "/materials").statusCode());
    }

    private void assertPage(HttpClient client, String route, long total, List<String> ids) throws Exception {
        JsonNode page = data(get(client, route), 200);
        assertEquals(total, page.get("total").asLong());
        List<String> actual = new ArrayList<>();
        for (var item : page.get("items")) {
            actual.add(item.get("id").asText());
            assertFalse(item.has("payload"));
            assertFalse(item.has("document"));
        }
        assertEquals(ids, actual);
    }

    private Map<String, Object> document(boolean teacher) {
        return Map.of("title", "Material", "intro", "", "raw", "Body", "html", "<p>Body</p>", "sections", List.of(), "teacher", teacher);
    }

    private void insert(User teacher, String student, String lesson, String bundle, String id, String audience, String kind, String key, Object payload) {
        jdbc.update("INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,payload) VALUES(?,?,?,?,?,?,?,?,?,'text/plain','Synthetic',?::jsonb)",
            teacher.workspace(), id, student, lesson, bundle, audience, kind, key, "material.txt", json.writeValueAsString(payload));
    }
}
