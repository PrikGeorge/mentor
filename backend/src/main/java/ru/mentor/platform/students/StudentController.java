package ru.mentor.platform.students;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.Page;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/students")
public class StudentController {
    private final StudentService students;private final SessionPolicy sessions;
    public StudentController(StudentService students,SessionPolicy sessions){this.students=students;this.sessions=sessions;}
    @GetMapping public Page<Map<String,Object>> list(@PathVariable String workspaceId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,@RequestParam(required=false) String audience,HttpServletRequest r){return students.list(sessions.requireCurrent(r),workspaceId,page,size,audience);}
    @PostMapping public ResponseEntity<Map<String,Object>> create(@PathVariable String workspaceId,@RequestBody Map<String,Object> input,HttpServletRequest r){return ResponseEntity.status(201).body(students.create(sessions.requireCurrent(r),workspaceId,input));}
    @GetMapping("/{studentId}") public Map<String,Object> get(@PathVariable String workspaceId,@PathVariable String studentId,@RequestParam(required=false) String audience,HttpServletRequest r){return students.get(sessions.requireCurrent(r),workspaceId,studentId,audience);}
    @PatchMapping("/{studentId}") public Map<String,Object> update(@PathVariable String workspaceId,@PathVariable String studentId,@RequestBody Map<String,Object> input,HttpServletRequest r){return students.update(sessions.requireCurrent(r),workspaceId,studentId,input);}
}
