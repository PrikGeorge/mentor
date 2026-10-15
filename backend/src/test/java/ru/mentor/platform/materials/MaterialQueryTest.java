package ru.mentor.platform.materials;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import ru.mentor.platform.files.BlobService;
import ru.mentor.platform.lessons.LessonService;
import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.Page;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.support.IdentityHttpTest;
import ru.mentor.platform.support.JdbcQueryCounter;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;

class MaterialQueryTest extends IdentityHttpTest {
    @Test void profilePageTransfersOnlyVisiblePageAndCountAsCollectionGrows() throws Exception {
        var teacher = teacher("material-query-profile");
        String student = student(teacher, "Profile material pupil").get("id").asText();
        var learner = enroll(teacher, student, "material-query-learner");
        var actor = new Actor(learner.id(), teacher.workspace(), Actor.Role.STUDENT, 1);
        var repository = context.getBean(MaterialRepository.class);
        for (int i = 0; i < 20; i++) {
            insert(repository, teacher.workspace(), student, null, null, id("visible", i), "student", false);
            insert(repository, teacher.workspace(), student, null, null, id("private", i), "teacher", false);
            insert(repository, teacher.workspace(), student, null, null, id("answer", i), "student", true);
        }
        var counter = new JdbcQueryCounter(context.getBean(DataSource.class));
        var service = measuredService(counter);
        var page = service.list(actor, teacher.workspace(), student, null, 1, 5, null);
        assertPage(page, "visible", 5, 5, 20);
        assertBounded(counter, 5);
        int queryCount = counter.queries();

        for (int i = 20; i < 40; i++)
            insert(repository, teacher.workspace(), student, null, null, id("visible", i), "student", false);
        counter.reset();
        assertPage(service.list(actor, teacher.workspace(), student, null, 1, 5, null), "visible", 5, 5, 40);
        assertBounded(counter, 5);
        assertEquals(queryCount, counter.queries(), "More stored materials must not add material queries");
    }

    @Test void lessonPageFiltersStaleBundlesBeforeOffsetAndKeepsCountForEmptyPage() throws Exception {
        var teacher = teacher("material-query-lesson");
        String student = student(teacher, "Lesson material pupil").get("id").asText();
        String lesson = lesson(teacher, student, "Prepared lesson", "2030-01-01");
        jdbc.update("UPDATE lesson SET status='prepared',bundle_id='current' WHERE workspace_id=? AND id=?", teacher.workspace(), lesson);
        var actor = new Actor(teacher.id(), teacher.workspace(), Actor.Role.TEACHER, 1);
        var repository = context.getBean(MaterialRepository.class);
        for (int i = 0; i < 30; i++) {
            insert(repository, teacher.workspace(), student, lesson, "current", id("visible", i), "student", false);
            insert(repository, teacher.workspace(), student, lesson, "obsolete", id("stale", i), "student", false);
            insert(repository, teacher.workspace(), student, lesson, "current", id("private", i), "teacher", false);
        }
        var counter = new JdbcQueryCounter(context.getBean(DataSource.class));
        var service = measuredService(counter);
        assertPage(service.list(actor, teacher.workspace(), student, lesson, 2, 7, "student"), "visible", 14, 7, 30);
        assertBounded(counter, 7);
        int queryCount = counter.queries();

        counter.reset();
        var empty = service.list(actor, teacher.workspace(), student, lesson, 10, 7, "student");
        assertTrue(empty.items().isEmpty());
        assertEquals(30, empty.total());
        assertBounded(counter, 0);
        assertEquals(queryCount, counter.queries(), "An empty page still needs the same bounded metadata/count queries");
    }

    private MaterialService measuredService(JdbcQueryCounter counter) {
        return new MaterialService(new MaterialRepository(new JdbcTemplate(counter)), context.getBean(StudentService.class),
            context.getBean(LessonService.class), context.getBean(BlobService.class), context.getBean(ObjectMapper.class),
            context.getBean(PlatformTransactionManager.class), MaterialService.MAXIMUM_UPLOAD);
    }
    private void insert(MaterialRepository repository, String workspace, String student, String lesson, String bundle,
                        String id, String audience, boolean teacherCode) {
        String payload = json.writeValueAsString(Map.of("teacher", teacherCode, "text", "synthetic-document".repeat(500)));
        repository.insert(workspace, id, student, lesson, bundle, audience, teacherCode ? "code" : "doc", null,
            id + ".txt", "text/plain", id, payload, null);
    }
    private static String id(String prefix, int index) { return prefix + "-" + String.format("%03d", index); }
    private void assertPage(Page<MaterialService.MaterialSummary> page, String prefix, int start, int size, int total) {
        assertEquals(total, page.total());
        List<String> expected = IntStream.range(start, start + size).mapToObj(i -> id(prefix, i)).toList();
        assertEquals(expected, page.items().stream().map(MaterialService.MaterialSummary::id).toList());
    }
    private void assertBounded(JdbcQueryCounter counter, int pageRows) {
        assertTrue(counter.rows() <= pageRows + 1, "JDBC must transfer only page metadata and at most one total row; got " + counter.rows());
        assertEquals(2, counter.queries(), "One material page query and one visible count query");
        assertFalse(counter.columns().contains("payload"));
        assertFalse(counter.columns().contains("content"));
        assertFalse(counter.columns().contains("text"));
    }
}
