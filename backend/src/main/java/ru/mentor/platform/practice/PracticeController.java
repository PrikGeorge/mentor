package ru.mentor.platform.practice;

import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.*;
import tools.jackson.databind.JsonNode;
import java.util.*;
import static ru.mentor.platform.practice.PracticeJson.fields;
import static ru.mentor.platform.practice.PracticeJson.text;

@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}")
public class PracticeController {
    private final CatalogService catalog;private final AssignmentService assignments;private final DraftService drafts;private final SessionPolicy sessions;
    public PracticeController(CatalogService catalog,AssignmentService assignments,DraftService drafts,SessionPolicy sessions){this.catalog=catalog;this.assignments=assignments;this.drafts=drafts;this.sessions=sessions;}
    @GetMapping("/exercises") public Page<JsonNode> catalog(@PathVariable String workspaceId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,@RequestParam(required=false) String audience,HttpServletRequest r){return catalog.list(sessions.requireCurrent(r),workspaceId,page,size,audience);}
    private static final String P="/students/{studentId}/lessons/{lessonId}/practice";
    @GetMapping(P) public AssignmentService.LessonPracticeView practice(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@RequestParam(required=false) String audience,HttpServletRequest r){return assignments.read(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),audience);}
    @PutMapping(value=P+"/assignments",consumes={"application/json","application/*+json"}) public AssignmentService.LessonPracticeView replace(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@RequestBody byte[] body,HttpServletRequest r){
        JsonNode input=PracticeJson.read(body);
        fields(input,Set.of("revision","assignments"),Set.of("revision","assignments"));JsonNode values=input.get("assignments");if(!values.isArray())throw new IllegalArgumentException("Assignments required.");var list=new ArrayList<AssignmentService.AssignmentInput>();for(var a:values){fields(a,Set.of("exerciseId","placement"),Set.of("exerciseId","placement"));list.add(new AssignmentService.AssignmentInput(text(a.get("exerciseId")),Placement.from(text(a.get("placement")))));}return assignments.replace(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),counter(input.get("revision")),list);
    }
    @GetMapping(P+"/exercises/{exerciseId}/draft") public Draft draft(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@PathVariable String exerciseId,@RequestParam(required=false) String audience,HttpServletRequest r){return drafts.read(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),exerciseId,audience);}
    @PutMapping(value=P+"/exercises/{exerciseId}/draft",consumes={"application/json","application/*+json"}) public Draft save(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@PathVariable String exerciseId,@RequestBody byte[] body,HttpServletRequest r){JsonNode input=PracticeJson.read(body);fields(input,Set.of("exerciseRevision","revision","files","resetForRevision"),Set.of("exerciseRevision","revision","files"));return drafts.save(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),exerciseId,ExerciseRevision.fromJson(input.get("exerciseRevision")),SourceFiles.fromJson(input.get("files")),counter(input.get("revision")),input.has("resetForRevision")?ExerciseRevision.fromJson(input.get("resetForRevision")):null);}
    @GetMapping(P+"/draft-archives") public Page<Map<String,Object>> archives(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@RequestParam(required=false) String exerciseId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,@RequestParam(required=false) String audience,HttpServletRequest r){return drafts.archives(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),exerciseId,page,size,audience);}
    @GetMapping(P+"/draft-archives/{archiveId}") public Map<String,Object> archive(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String lessonId,@PathVariable String archiveId,@RequestParam(required=false) String audience,HttpServletRequest r){return drafts.archive(sessions.requireCurrent(r),new LessonRef(workspaceId,studentId,lessonId),archiveId,audience);}
    static long counter(JsonNode value){if(value==null||!value.isIntegralNumber()||!value.canConvertToLong()||value.asLong()<0)throw new IllegalArgumentException("Nonnegative revision required.");return value.asLong();}
}
