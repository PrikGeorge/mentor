package ru.mentor.platform.materials;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.InputStreamResource;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.Page;
import ru.mentor.platform.files.BlobService;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api/v1/workspaces/{workspace}")
public class MaterialController {
    private final MaterialService materials;private final SessionPolicy sessions;
    public MaterialController(MaterialService materials,SessionPolicy sessions){this.materials=materials;this.sessions=sessions;}
    @RequestMapping(value="/materials/{id}",method={RequestMethod.GET,RequestMethod.HEAD})
    public ResponseEntity<?> read(HttpServletRequest request,@PathVariable String workspace,@PathVariable String id,@RequestParam(required=false)String audience){
        var view=materials.read(sessions.requireCurrent(request),workspace,id,audience);return ResponseEntity.ok().headers(headers()).body(request.getMethod().equals("HEAD")?null:view);
    }
    @RequestMapping(value="/materials/{id}/file",method={RequestMethod.GET,RequestMethod.HEAD})
    public ResponseEntity<?> file(HttpServletRequest request,@PathVariable String workspace,@PathVariable String id,@RequestParam(required=false)String audience)throws IOException {
        var actor=sessions.requireCurrent(request);var download=materials.download(actor,workspace,id,audience);
        var headers=headers();headers.setContentType(MediaType.parseMediaType(BlobService.contentType(download.metadata().contentType())));headers.setContentLength(download.blob().size());
        headers.setContentDisposition(ContentDisposition.attachment().filename(BlobService.filename(download.metadata().filename()),StandardCharsets.UTF_8).build());
        if(request.getMethod().equals("HEAD"))return ResponseEntity.ok().headers(headers).build();
        return ResponseEntity.ok().headers(headers).body(new InputStreamResource(materials.open(actor,workspace,id,audience)));
    }
    @GetMapping("/students/{student}/materials")
    public ResponseEntity<Page<MaterialService.MaterialSummary>> profile(HttpServletRequest request,@PathVariable String workspace,@PathVariable String student,@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="25")int size,@RequestParam(required=false)String audience){return ResponseEntity.ok().headers(headers()).body(materials.list(sessions.requireCurrent(request),workspace,student,null,page,size,audience));}
    @GetMapping("/students/{student}/lessons/{lesson}/materials")
    public ResponseEntity<Page<MaterialService.MaterialSummary>> lesson(HttpServletRequest request,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson,@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="25")int size,@RequestParam(required=false)String audience){return ResponseEntity.ok().headers(headers()).body(materials.list(sessions.requireCurrent(request),workspace,student,lesson,page,size,audience));}
    @PostMapping(value="/students/{student}/materials",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MaterialService.MaterialSummary> createProfile(HttpServletRequest request,@PathVariable String workspace,@PathVariable String student)throws IOException,ServletException {return create(request,workspace,student,null);}
    @PostMapping(value="/students/{student}/lessons/{lesson}/materials",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MaterialService.MaterialSummary> createLesson(HttpServletRequest request,@PathVariable String workspace,@PathVariable String student,@PathVariable String lesson)throws IOException,ServletException {return create(request,workspace,student,lesson);}
    // One multipart form for both shapes: kind=doc carries markdown, kind=download carries exactly one file part.
    private ResponseEntity<MaterialService.MaterialSummary> create(HttpServletRequest request,String workspace,String student,String lesson)throws IOException,ServletException {
        var actor=sessions.requireCurrent(request);Map<String,Part> parts=new HashMap<>();
        for(var part:request.getParts())if(!Set.of("kind","audience","title","contentKey","markdown","file").contains(part.getName())||parts.put(part.getName(),part)!=null)throw new IllegalArgumentException("Invalid multipart fields.");
        String kind=field(parts.get("kind"),20);var input=new MaterialService.Authoring(field(parts.get("audience"),20),field(parts.get("contentKey"),60),field(parts.get("title"),200));
        MaterialService.MaterialSummary created;
        if(kind==null)throw new IllegalArgumentException("Kind must be doc or download.");
        if(kind.equals("doc")){
            if(parts.containsKey("file"))throw new IllegalArgumentException("A document has no file part.");
            created=materials.createDocument(actor,workspace,student,lesson,input,field(parts.get("markdown"),(int)MaterialService.MAXIMUM_MARKDOWN));
        } else if(kind.equals("download")){
            Part file=parts.get("file");if(file==null||file.getSubmittedFileName()==null||parts.containsKey("markdown"))throw new IllegalArgumentException("One file required.");
            String disposition=file.getHeader("Content-Disposition");if(disposition==null||disposition.indexOf('\\')>=0)throw new IllegalArgumentException("Unsafe filename.");
            try(var stream=file.getInputStream()){created=materials.createFile(actor,workspace,student,lesson,input,stream,ContentDisposition.parse(disposition).getFilename(),file.getContentType(),file.getSize());}
        } else throw new IllegalArgumentException("Kind must be doc or download.");
        return ResponseEntity.status(201).headers(headers()).body(created);
    }
    @DeleteMapping("/materials/{id}")
    public ResponseEntity<Void> delete(HttpServletRequest request,@PathVariable String workspace,@PathVariable String id){materials.delete(sessions.requireCurrent(request),workspace,id);return ResponseEntity.noContent().headers(headers()).build();}
    private static String field(Part part,int limit)throws IOException {
        if(part==null)return null;if(part.getSubmittedFileName()!=null||part.getSize()>limit*3L)throw new IllegalArgumentException("Invalid form field.");
        try(var input=part.getInputStream()){byte[] bytes=input.readNBytes(limit*3+1);if(bytes.length>limit*3)throw new IllegalArgumentException("Invalid form field.");try{return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException malformed){throw new IllegalArgumentException("Invalid UTF8 form field.");}}
    }
    private static HttpHeaders headers(){HttpHeaders headers=new HttpHeaders();headers.setCacheControl("no-store");headers.set("X-Content-Type-Options","nosniff");return headers;}
}
