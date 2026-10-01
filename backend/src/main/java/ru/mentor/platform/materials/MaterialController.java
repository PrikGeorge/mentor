package ru.mentor.platform.materials;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.core.io.InputStreamResource;
import jakarta.servlet.http.HttpServletRequest;
import ru.mentor.platform.identity.SessionPolicy;
import ru.mentor.platform.shared.Page;
import ru.mentor.platform.files.BlobService;
import java.nio.charset.StandardCharsets;
import java.io.IOException;

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
    private static HttpHeaders headers(){HttpHeaders headers=new HttpHeaders();headers.setCacheControl("no-store");headers.set("X-Content-Type-Options","nosniff");return headers;}
}
