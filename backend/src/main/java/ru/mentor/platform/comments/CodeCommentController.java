package ru.mentor.platform.comments;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.lessons.LessonRef;
import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api/v1/workspaces/{workspace}/students/{student}/lessons/{lesson}/code-comments")
public class CodeCommentController {
    public record CommentList(List<CodeCommentRepository.Comment> items) {}
    private final CodeCommentService comments;private final SessionPolicy sessions;
    public CodeCommentController(CodeCommentService comments,SessionPolicy sessions){this.comments=comments;this.sessions=sessions;}
    @GetMapping public ResponseEntity<CommentList> list(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@RequestParam String targetKind,@RequestParam String targetId,@RequestParam(required=false) String audience){
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new CommentList(comments.list(sessions.requireCurrent(r),new LessonRef(workspace,student,lesson),targetKind,targetId,audience)));
    }
    @PostMapping public ResponseEntity<CodeCommentRepository.Comment> create(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@RequestBody Map<String,Object> input)throws IOException {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(comments.create(sessions.requireCurrent(r),new LessonRef(workspace,student,lesson),input));
    }
    @DeleteMapping("/{id}") public ResponseEntity<Void> delete(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@PathVariable String id){
        comments.delete(sessions.requireCurrent(r),new LessonRef(workspace,student,lesson),id);return ResponseEntity.noContent().build();
    }
}
