package ru.mentor.platform.roadmap;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.web.bind.annotation.*;

import ru.mentor.platform.identity.SessionPolicy;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/students/{studentId}/roadmap")
public class RoadmapController {
    private final RoadmapService roadmap;
    private final SessionPolicy sessions;

    public RoadmapController(RoadmapService roadmap, SessionPolicy sessions) {
        this.roadmap = roadmap;
        this.sessions = sessions;
    }

    @GetMapping
    public RoadmapService.View get(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @RequestParam(required = false) String audience,
            HttpServletRequest r) {
        return roadmap.get(sessions.requireCurrent(r), workspaceId, studentId, audience);
    }

    @PutMapping
    public RoadmapService.View replace(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @RequestBody Map<String, Object> input,
            HttpServletRequest r) {
        return roadmap.replace(sessions.requireCurrent(r), workspaceId, studentId, input);
    }
}
