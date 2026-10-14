package ru.mentor.platform.homework;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.Page;

@RestController
@RequestMapping("/api/v1/workspaces/{workspace}")
public class HomeworkTurnController {
    private final HomeworkService homework;private final SessionPolicy sessions;
    public HomeworkTurnController(HomeworkService homework,SessionPolicy sessions){this.homework=homework;this.sessions=sessions;}
    @GetMapping("/students/{student}/homework/turns")
    public ResponseEntity<Page<HomeworkTurns.LessonTurn>> lessons(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,@RequestParam(required=false) String audience){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Content-Type-Options","nosniff").body(homework.lessonTurns(sessions.requireCurrent(r),workspace,student,page,size,audience));
    }
    @GetMapping("/homework/turns")
    public ResponseEntity<Page<HomeworkTurns.StudentTurn>> students(HttpServletRequest r,@PathVariable String workspace,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Content-Type-Options","nosniff").body(homework.studentTurns(sessions.requireCurrent(r),workspace,page,size));
    }
}
