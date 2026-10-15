package ru.mentor.platform.practice;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.Page;

@RestController
public class PracticeHistoryController {
    private final PracticeHistoryService history;
    private final SessionPolicy sessions;

    public PracticeHistoryController(PracticeHistoryService history, SessionPolicy sessions) {
        this.history = history;
        this.sessions = sessions;
    }

    @GetMapping(
            "/api/v1/workspaces/{workspaceId}/students/{studentId}/lessons/{lessonId}/practice/history")
    public ResponseEntity<Page<PracticeHistoryRepository.Entry>> list(
            @PathVariable String workspaceId,
            @PathVariable String studentId,
            @PathVariable String lessonId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String audience,
            HttpServletRequest request) {
        var entries =
                history.list(
                        sessions.requireCurrent(request),
                        new LessonRef(workspaceId, studentId, lessonId),
                        page,
                        size,
                        audience);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(entries);
    }
}
