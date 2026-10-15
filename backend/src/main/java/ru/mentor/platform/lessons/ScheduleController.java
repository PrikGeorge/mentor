package ru.mentor.platform.lessons;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.*;

import ru.mentor.platform.identity.SessionPolicy;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/schedule")
public class ScheduleController {
    private final ScheduleService schedule;
    private final SessionPolicy sessions;

    public ScheduleController(ScheduleService schedule, SessionPolicy sessions) {
        this.schedule = schedule;
        this.sessions = sessions;
    }

    @GetMapping
    public Map<String, Object> get(
            @PathVariable String workspaceId,
            @RequestParam String from,
            @RequestParam String to,
            HttpServletRequest r) {
        return schedule.schedule(sessions.requireCurrent(r), workspaceId, from, to);
    }
}
