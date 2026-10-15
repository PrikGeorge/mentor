package ru.mentor.platform.lessons;

import org.springframework.stereotype.Service;

import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.workspaces.WorkspaceAccess;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

// T04: the teacher's lessons of every active card in a Moscow date window, for the schedule
// screen and the "mark as held" reminder. Students and administrators have no such view.
@Service
public class ScheduleService {
    public static final int MAXIMUM_DAYS = 31;
    private final LessonRepository repository;
    private final WorkspaceAccess access;

    public ScheduleService(LessonRepository repository, WorkspaceAccess access) {
        this.repository = repository;
        this.access = access;
    }

    public Map<String, Object> schedule(Actor actor, String workspace, String from, String to) {
        access.requireTeacher(actor, workspace);
        String first = LessonService.date(from), last = LessonService.date(to);
        long days = ChronoUnit.DAYS.between(LocalDate.parse(first), LocalDate.parse(last)) + 1;
        if (days < 1 || days > MAXIMUM_DAYS)
            throw new IllegalArgumentException(
                    "The range must be from one to " + MAXIMUM_DAYS + " days.");
        List<Map<String, Object>> items = new ArrayList<>();
        for (var entry : repository.schedule(workspace, first, last)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("studentName", entry.studentName());
            item.put("lesson", LessonService.summaryView(entry.summary()));
            items.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("from", first);
        result.put("to", last);
        result.put("items", items);
        return result;
    }
}
