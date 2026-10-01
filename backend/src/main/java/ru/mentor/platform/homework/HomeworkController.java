package ru.mentor.platform.homework;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.InputStreamResource;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.Page;
import tools.jackson.databind.JsonNode;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/workspaces/{workspace}/students/{student}/lessons/{lesson}/homework")
public class HomeworkController {
    private final HomeworkService homework;private final SessionPolicy sessions;
    public HomeworkController(HomeworkService homework,SessionPolicy sessions){this.homework=homework;this.sessions=sessions;}
    @GetMapping public ResponseEntity<Page<Submission>> list(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size){return ResponseEntity.ok().headers(headers()).body(homework.list(sessions.requireCurrent(r),new LessonRef(workspace,student,lesson),page,size));}
    @PostMapping(consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Submission> submit(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson)throws IOException,ServletException {
        var actor=sessions.requireCurrent(r);Map<String,Part> parts=new HashMap<>();
        for(var part:r.getParts())if(!Set.of("file","comment","repositoryUrl").contains(part.getName())||parts.put(part.getName(),part)!=null)throw new IllegalArgumentException("Invalid multipart fields.");
        Part file=parts.get("file");if(file==null||file.getSubmittedFileName()==null)throw new IllegalArgumentException("One file required.");
        // A servlet unquotes backslash escapes; reject the unsafe original rather than silently renaming it.
        String disposition=file.getHeader("Content-Disposition");
        if(disposition==null||disposition.indexOf('\\')>=0)throw new IllegalArgumentException("Unsafe filename.");
        String filename=ContentDisposition.parse(disposition).getFilename();
        try(var stream=file.getInputStream()){
            var result=homework.submit(actor,new LessonRef(workspace,student,lesson),stream,filename,field(parts.get("comment"),10000),field(parts.get("repositoryUrl"),2000),file.getSize());
            return ResponseEntity.status(201).headers(headers()).body(result);
        }
    }
    @PatchMapping(value="/{id}/review",consumes={MediaType.APPLICATION_JSON_VALUE,"application/*+json"})
    public ResponseEntity<Submission> review(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@PathVariable String id,@RequestBody JsonNode body){
        if(!body.isObject()||!body.propertyNames().equals(Set.of("revision","status","feedback"))||!body.get("revision").isIntegralNumber()||!body.get("revision").canConvertToLong()||!body.get("status").isString()||!body.get("feedback").isString())throw new IllegalArgumentException("Review fields required.");
        return ResponseEntity.ok().headers(headers()).body(homework.review(sessions.requireCurrent(r),new LessonRef(workspace,student,lesson),id,body.get("revision").asLong(),ReviewStatus.valueOf(body.get("status").asText()),body.get("feedback").asText()));
    }
    @RequestMapping(value="/{id}/file",method={RequestMethod.GET,RequestMethod.HEAD})
    public ResponseEntity<?> file(HttpServletRequest r,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@PathVariable String id)throws IOException {
        var actor=sessions.requireCurrent(r);var owner=new LessonRef(workspace,student,lesson);var file=homework.download(actor,owner,id);
        var headers=headers();headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);headers.setContentLength(file.blob().size());
        headers.setContentDisposition(ContentDisposition.attachment().filename(file.submission().filename(),StandardCharsets.UTF_8).build());headers.set("Content-Security-Policy","default-src 'none'; sandbox");
        if(r.getMethod().equals("HEAD"))return ResponseEntity.ok().headers(headers).build();
        return ResponseEntity.ok().headers(headers).body(new InputStreamResource(homework.open(actor,owner,id)));
    }
    private static String field(Part part,int limit)throws IOException {
        if(part==null)return "";if(part.getSubmittedFileName()!=null||part.getSize()>limit*3L)throw new IllegalArgumentException("Invalid form field.");
        try(var input=part.getInputStream()){byte[] bytes=input.readNBytes(limit*3+1);if(bytes.length>limit*3)throw new IllegalArgumentException("Invalid form field.");try{return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException malformed){throw new IllegalArgumentException("Invalid UTF8 form field.");}}
    }
    private static HttpHeaders headers(){HttpHeaders headers=new HttpHeaders();headers.setCacheControl("no-store");headers.set("X-Content-Type-Options","nosniff");return headers;}
}
