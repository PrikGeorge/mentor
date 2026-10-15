package ru.mentor.platform.lessons;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/students/{studentId}")
public class LessonController {
    private final LessonService lessons;private final SessionPolicy sessions;
    public LessonController(LessonService lessons,SessionPolicy sessions){this.lessons=lessons;this.sessions=sessions;}
    @GetMapping("/lessons") public Page<Map<String,Object>> list(@PathVariable String workspaceId,@PathVariable String studentId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,@RequestParam(required=false) String audience,HttpServletRequest r){return lessons.list(sessions.requireCurrent(r),workspaceId,studentId,page,size,audience);}
    @PostMapping("/lessons") public ResponseEntity<Map<String,Object>> create(@PathVariable String workspaceId,@PathVariable String studentId,@RequestBody Map<String,Object> input,HttpServletRequest r){return ResponseEntity.status(201).body(lessons.create(sessions.requireCurrent(r),workspaceId,studentId,input));}
    @GetMapping("/lessons/{lessonId}") public Map<String,Object> get(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@RequestParam(required=false) String audience,HttpServletRequest r){return lessons.get(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),audience);}
    @PatchMapping("/lessons/{lessonId}") public Map<String,Object> update(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@RequestBody Map<String,Object> input,HttpServletRequest r){return lessons.update(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),input);}
    @DeleteMapping("/lessons/{lessonId}") public ResponseEntity<Void> delete(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,HttpServletRequest r){lessons.delete(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId));return ResponseEntity.noContent().build();}
    @GetMapping("/lessons/{lessonId}/texts/{kind}") public LessonText text(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@PathVariable String kind,@RequestParam(required=false) String audience,HttpServletRequest r){return lessons.text(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),TextKind.valueOf(kind),audience);}
    @PutMapping("/lessons/{lessonId}/texts/{kind}") public LessonText save(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@PathVariable String kind,@RequestBody Map<String,Object> input,HttpServletRequest r){
        LessonService.checkFields(input,Set.of("markdown","revision"));if(!(input.get("markdown") instanceof String markdown))throw new IllegalArgumentException("Markdown required.");return lessons.saveText(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),TextKind.valueOf(kind),markdown,LessonService.revision(input.get("revision")));
    }
    @GetMapping("/dashboard") public Map<String,Object> dashboard(@PathVariable String workspaceId,@PathVariable String studentId,@RequestParam(required=false) String audience,HttpServletRequest r){return lessons.dashboard(sessions.requireCurrent(r),workspaceId,studentId,audience);}
}
