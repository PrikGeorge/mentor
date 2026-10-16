package ru.mentor.platform.lessons;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.*;

import ru.mentor.platform.identity.SessionPolicy;

import java.util.Map;

// T23: the calendar of one card for the student (and the teacher's preview of it).
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/students/{studentId}/schedule")
public class StudentScheduleController {
    private final ScheduleService schedule;
    private final SessionPolicy sessions;

    public StudentScheduleController(ScheduleService schedule, SessionPolicy sessions) {
        this.schedule = schedule;
        this.sessions = sessions;
    }

    @GetMapping
    public Map<String, Object> get(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @RequestParam String from,
            @RequestParam String to,
            HttpServletRequest r) {
        return schedule.studentSchedule(
                sessions.requireCurrent(r), workspaceId, studentId, from, to);
    }
}
