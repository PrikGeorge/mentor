package ru.mentor.platform.journal;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.StudentService;
import java.util.List;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/students/{studentId}/moves")
public class MoveController {
    private final MoveRepository moves;private final StudentService students;private final SessionPolicy sessions;
    public MoveController(MoveRepository moves,StudentService students,SessionPolicy sessions){this.moves=moves;this.students=students;this.sessions=sessions;}
    // All moves are student-visible facts; audience=student only has to be valid for a teacher preview.
    @GetMapping public ResponseEntity<Page<MoveRepository.Move>> list(@PathVariable String workspaceId,@PathVariable String studentId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,
                                                       @RequestParam(required=false) String lessonId,@RequestParam(required=false) String audience,HttpServletRequest r){
        new Page<>(List.of(),page,size,0);if(audience!=null&&!audience.equals("student"))throw new IllegalArgumentException("Invalid audience.");
        if(lessonId!=null&&(lessonId.isBlank()||lessonId.length()>100))throw new IllegalArgumentException("Invalid lesson.");
        students.requireReader(sessions.requireCurrent(r),workspaceId,studentId);
        var page_=new Page<>(moves.moves(workspaceId,studentId,lessonId,page,size),page,size,moves.count(workspaceId,studentId,lessonId));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(page_);
    }
}
