package ru.mentor.platform.lessons;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.support.JdbcQueryCounter;
import ru.mentor.platform.students.StudentService;
import tools.jackson.databind.JsonNode;

import javax.sql.DataSource;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class LessonSummaryTest extends LessonHttpTest {
    private static final Set<String> SUMMARY_FIELDS = Set.of(
        "id", "workspaceId", "studentId", "title", "date", "time", "timeZone", "duration", "status",
        "bundleId", "revision", "createdAt", "number", "hasStudentNotes"
    );

    // Catches list/dashboard responses carrying full private documents, whitespace-only notes counting as preparation,
    // or summary projection accidentally replacing the full detail/create/update representations.
    @Test void listAndDashboardSummariesKeepMetadataAndNotesPresenceWithoutDocuments() throws Exception {
        var f = fixture("summary-teacher");
        var learner = enroll(f.teacher(), f.student(), "summary-student");
        LocalDate date = LocalDate.ofInstant(CLOCK.instant(), ZoneId.of("Europe/Moscow")).plusDays(1);
        var first = lesson(f, "Notes present", date.toString(), "12:00", 60);
        var empty = lesson(f, "No notes", date.plusDays(1).toString(), "12:00", 60);
        var whitespace = lesson(f, "Whitespace notes", date.plusDays(2).toString(), "12:00", 60);
        assertTrue(first.has("studentNotes"), "Creation must keep the full lesson representation");
        String publicText = "  PUBLIC_NOTES\n" + "x".repeat(100_000);
        jdbc.update("UPDATE lesson_text SET markdown=? WHERE workspace_id=? AND lesson_id=? AND kind='studentNotes'",
            publicText, f.teacher().workspace(), first.get("id").asText());
        jdbc.update("UPDATE lesson_text SET markdown=? WHERE workspace_id=? AND lesson_id=? AND kind='studentNotes'",
            " \t\r\n\f\u000b\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff", f.teacher().workspace(), whitespace.get("id").asText());
        jdbc.update("UPDATE lesson_text SET markdown='PRIVATE_DOCUMENT' WHERE workspace_id=? AND kind IN ('teacherNotes','reviewNotes')",
            f.teacher().workspace());
        first = data(write(f.teacher().client(), "PATCH", lessonPath(f, first), Map.of("revision", 1, "conducted", true)), 200);
        assertEquals(publicText, first.get("studentNotes").asText(), "Update must keep the full lesson representation");
        assertEquals("PRIVATE_DOCUMENT", first.get("teacherNotes").asText());

        Map<String, Boolean> flags = Map.of(first.get("id").asText(), true, empty.get("id").asText(), false,
            whitespace.get("id").asText(), false);
        Map<String, JsonNode> details = new HashMap<>();
        for (var lesson : List.of(first, empty, whitespace)) {
            var detail = data(get(f.teacher().client(), lessonPath(f, lesson)), 200);
            assertTrue(detail.has("studentNotes"));
            assertEquals("PRIVATE_DOCUMENT", detail.get("teacherNotes").asText());
            details.put(detail.get("id").asText(), detail);
        }
        for (HttpClient client : List.of(f.teacher().client(), learner.client())) {
            var page = data(get(client, f.path() + "/lessons?size=2"), 200);
            assertEquals(3, page.get("total").asInt());
            assertEquals(2, page.get("items").size());
            assertEquals(3, page.get("items").get(0).get("number").asInt());
            assertEquals(2, page.get("items").get(1).get("number").asInt());
            for (var item : page.get("items")) assertSummary(item, details.get(item.get("id").asText()), flags.get(item.get("id").asText()));
            var last = data(get(client, f.path() + "/lessons?page=1&size=2"), 200).get("items").get(0);
            assertSummary(last, first, true);
            var dashboard = data(get(client, f.path() + "/dashboard"), 200);
            assertSummary(dashboard.get("focus").get("lesson"), first, true);
            assertTrue(dashboard.get("focus").get("upcoming").asBoolean());
            var dashboards = data(get(client, students(f.teacher()) + "/dashboards"), 200);
            assertSummary(dashboards.get("items").get(0).get("focus").get("lesson"), first, true);
        }
        var preview = data(get(f.teacher().client(), f.path() + "/lessons?audience=student"), 200);
        for (var item : preview.get("items")) assertSummary(item, details.get(item.get("id").asText()), flags.get(item.get("id").asText()));
        assertEquals(400, get(f.teacher().client(), f.path() + "/lessons?audience=teacher").statusCode());
        var learnerDetail = data(get(learner.client(), lessonPath(f, first)), 200);
        assertEquals(publicText, learnerDetail.get("studentNotes").asText());
        assertFalse(learnerDetail.has("teacherNotes"));
    }

    private void assertSummary(JsonNode summary, JsonNode detail, boolean notes) {
        Set<String> fields = new HashSet<>(SUMMARY_FIELDS);
        if (detail.has("conductedAt")) fields.add("conductedAt");
        assertEquals(fields, summary.propertyNames(), "Summary must contain metadata and presence only");
        for (String field : fields) if (!field.equals("hasStudentNotes")) assertEquals(detail.get(field), summary.get(field), field);
        assertEquals(notes, summary.get("hasStudentNotes").asBoolean());
        assertFalse(summary.toString().contains("PUBLIC_NOTES"));
        assertFalse(summary.toString().contains("PRIVATE_DOCUMENT"));
    }

    // Counts actual statements/result rows on PostgreSQL: adding lessons or focus cards must not add document queries,
    // and a dashboard page must not load lessons from students on other pages.
    @Test void queryCountStaysFixedAndDashboardReadsOnlyTheRequestedCards() throws Exception {
        var teacher = teacher("summary-sql-teacher");
        List<String> cards = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            String student = student(teacher, "Summary student " + i).get("id").asText();
            cards.add(student);
            lesson(teacher, student, "First " + i, "2030-01-01");
            lesson(teacher, student, "Second " + i, "2030-01-02");
            CLOCK.advance(Duration.ofSeconds(1));
        }
        var actor = new Actor(teacher.id(), teacher.workspace(), Actor.Role.TEACHER, 1);
        var counter = new JdbcQueryCounter(context.getBean(DataSource.class));
        var service = new LessonService(new LessonRepository(new JdbcTemplate(counter)), context.getBean(StudentService.class), CLOCK);

        assertEquals(1, service.list(actor, teacher.workspace(), cards.getFirst(), 0, 1, null).items().size());
        int smallListQueries = counter.queries();
        counter.reset();
        assertEquals(2, service.list(actor, teacher.workspace(), cards.getFirst(), 0, 2, null).items().size());
        assertEquals(smallListQueries, counter.queries(), "Listing another lesson must not issue another document query");
        assertEquals(2, counter.queries(), "One lesson page query and one count query");
        assertFalse(counter.columns().contains("markdown"), "Summary SQL must not transfer Markdown to Java");

        counter.reset();
        var one = service.dashboards(actor, teacher.workspace(), 0, 1, null);
        assertEquals(3, one.total());
        assertEquals(cards.getFirst(), one.items().getFirst().get("student") instanceof Map<?, ?> profile ? profile.get("id") : null);
        assertEquals(1, counter.queries());
        assertEquals(2, counter.rows(), "Only the first card's two lessons may cross JDBC");
        assertFalse(counter.columns().contains("markdown"));
        counter.reset();
        assertEquals(3, service.dashboards(actor, teacher.workspace(), 0, 3, null).items().size());
        assertEquals(1, counter.queries(), "Focus cards must share one metadata query");
        assertEquals(6, counter.rows());
        assertFalse(counter.columns().contains("markdown"));
        counter.reset();
        assertEquals(2, service.dashboard(actor, teacher.workspace(), cards.getFirst(), null).get("lessonCount"));
        assertEquals(1, counter.queries(), "The individual dashboard must not fetch the focus lesson's documents");
        assertFalse(counter.columns().contains("markdown"));
        counter.reset();
        assertTrue(service.dashboards(actor, teacher.workspace(), 3, 1, null).items().isEmpty());
        assertEquals(0, counter.queries(), "An empty card page needs no lesson query");
    }

}
