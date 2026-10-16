package ru.mentor.platform.lessons;

import org.springframework.stereotype.Service;

import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.WorkspaceAccess;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

// T04: the teacher's lessons of every active card in a Moscow date window, for the schedule
// screen and the "mark as held" reminder. T23 adds one card's window for the student's own
// calendar; administrators have neither view.
@Service
public class ScheduleService {
    public static final int MAXIMUM_DAYS = 31;
    private final LessonRepository repository;
    private final WorkspaceAccess access;
    private final StudentService students;
    private final Clock clock;

    public ScheduleService(
            LessonRepository repository,
            WorkspaceAccess access,
            StudentService students,
            Clock clock) {
        this.repository = repository;
        this.access = access;
        this.students = students;
        this.clock = clock;
    }

    public Map<String, Object> schedule(Actor actor, String workspace, String from, String to) {
        access.requireTeacher(actor, workspace);
        String first = LessonService.date(from), last = LessonService.date(to);
        requireWindow(first, last);
        List<Map<String, Object>> items = new ArrayList<>();
        var now = clock.instant();
        for (var entry : repository.schedule(workspace, first, last)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("studentName", entry.studentName());
            item.put("lesson", LessonService.summaryView(entry.summary(), now));
            items.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("from", first);
        result.put("to", last);
        result.put("items", items);
        return result;
    }

    // T23: the student's own calendar, also read by the workspace teacher in the preview. Access
    // is the lesson list's: another student, another teacher and administrators get 404.
    public Map<String, Object> studentSchedule(
            Actor actor, String workspace, String student, String from, String to) {
        students.requireReader(actor, workspace, student);
        String first = LessonService.date(from), last = LessonService.date(to);
        requireWindow(first, last);
        var now = clock.instant();
        List<Map<String, Object>> items = new ArrayList<>();
        for (var summary : repository.studentSchedule(workspace, student, first, last))
            items.add(LessonService.summaryView(summary, now));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("from", first);
        result.put("to", last);
        result.put("items", items);
        return result;
    }

    private static void requireWindow(String first, String last) {
        long days = ChronoUnit.DAYS.between(LocalDate.parse(first), LocalDate.parse(last)) + 1;
        if (days < 1 || days > MAXIMUM_DAYS)
            throw new IllegalArgumentException(
                    "The range must be from one to " + MAXIMUM_DAYS + " days.");
    }
}
