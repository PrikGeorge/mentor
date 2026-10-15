package ru.mentor.platform.materials;

import com.fasterxml.jackson.annotation.JsonValue;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.*;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.*;
import ru.mentor.platform.lessons.*;
import ru.mentor.platform.files.BlobService;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import java.io.*;
import java.util.*;
import org.springframework.web.util.UriUtils;
import java.nio.charset.StandardCharsets;

@Service
public class MaterialService {
    public record MaterialSummary(String id,String workspaceId,String studentId,String lessonId,String bundleId,String audience,String kind,String contentKey,String filename,String contentType,String title) {}
    public record MaterialView(@JsonValue Map<String,Object> fields) {}
    public record Download(MaterialSummary metadata,BlobService.BlobRef blob) {}
    private final MaterialRepository repository;private final StudentService students;private final LessonService lessons;private final BlobService blobs;private final ObjectMapper json;private final long maximumObjectBytes;private final TransactionTemplate transaction;
    public MaterialService(MaterialRepository repository,StudentService students,LessonService lessons,BlobService blobs,ObjectMapper json,PlatformTransactionManager manager,@Value("${mentor.materials.maximum-bytes:67108864}")long maximumObjectBytes){if(maximumObjectBytes<1)throw new IllegalArgumentException("Positive prepared-material limit required.");this.repository=repository;this.students=students;this.lessons=lessons;this.blobs=blobs;this.json=json;this.maximumObjectBytes=maximumObjectBytes;this.transaction=new TransactionTemplate(manager);}
    /** Trusted importers use this bound for BlobService.stage; browser uploads are bounded by MAXIMUM_UPLOAD below. */
    public long maximumObjectBytes(){return maximumObjectBytes;}
    public static final long MAXIMUM_UPLOAD=20971520,MAXIMUM_MARKDOWN=200000;
    private static final Set<String> AUDIENCES=Set.of("student","teacher");
    public record Authoring(String audience,String contentKey,String title) {}
    // The owning teacher adds a Markdown document to a lesson (or to the card when lesson is null). The first lesson material
    // makes the lesson prepared under one bundle; one document per role and audience, so the screens know which one to open.
    public MaterialSummary createDocument(Actor actor,String workspace,String student,String lesson,Authoring input,String markdown){
        String audience=audience(input.audience()),key=contentKey(input.contentKey()),title=title(input.title());
        if(markdown==null||markdown.isBlank()||markdown.length()>MAXIMUM_MARKDOWN||markdown.indexOf(0)>=0)throw new IllegalArgumentException("Markdown up to 200000 characters required.");
        students.requireReader(actor,workspace,student);if(actor.role()!=Actor.Role.TEACHER)throw new ApiFailure(403,"FORBIDDEN","Only the teacher can add materials.");
        var payload=MarkdownDocument.payload(markdown,title==null?"Материал":title);String heading=title!=null?title:(String)payload.get("title");
        String filename=(key==null?"material":key)+".md";
        return transaction.execute(status->{
            var owner=students.lockTeacherCard(actor,workspace,student);String bundle=lesson==null?null:lessons.prepare(actor,new LessonRef(workspace,student,lesson));
            if(key!=null&&repository.documentExists(workspace,student,lesson,audience,key))throw new ApiFailure(409,"MATERIAL_EXISTS","A document with this role already exists here. Delete it first.");
            String id=UUID.randomUUID().toString();repository.insert(workspace,id,owner.id(),lesson,bundle,audience,"doc",key,filename,"text/markdown;charset=UTF-8",heading,encode(payload),null);
            return summary(repository.find(workspace,id).orElseThrow().metadata());
        });
    }
    // The owning teacher uploads a file (kit archive, PDF, source) as a downloadable material; bytes are staged before the transaction.
    public MaterialSummary createFile(Actor actor,String workspace,String student,String lesson,Authoring input,InputStream content,String filename,String contentType,long expectedSize)throws IOException {
        String audience=audience(input.audience()),key=contentKey(input.contentKey()),title=title(input.title());
        String safeName=BlobService.filename(filename),safeType=BlobService.contentType(contentType==null||contentType.isBlank()?"application/octet-stream":contentType);
        if(content==null||expectedSize<=0)throw new IllegalArgumentException("Nonempty file required.");if(expectedSize>MAXIMUM_UPLOAD)throw new ApiFailure(413,"INVALID_INPUT","Material file exceeds its byte limit.");
        var card=students.requireReader(actor,workspace,student);if(actor.role()!=Actor.Role.TEACHER)throw new ApiFailure(403,"FORBIDDEN","Only the teacher can add materials.");
        var staged=lesson==null?blobs.stage(actor,card,content,MAXIMUM_UPLOAD,expectedSize):blobs.stage(actor,new LessonRef(workspace,student,lesson),content,MAXIMUM_UPLOAD,expectedSize);
        return transaction.execute(status->{
            var owner=students.lockTeacherCard(actor,workspace,student);String bundle=lesson==null?null:lessons.prepare(actor,new LessonRef(workspace,student,lesson));
            var blob=lesson==null?blobs.attach(actor,owner,staged,safeName,safeType):blobs.attach(actor,new LessonRef(workspace,student,lesson),staged,safeName,safeType);
            String id=UUID.randomUUID().toString();repository.insert(workspace,id,owner.id(),lesson,bundle,audience,"download",key,safeName,safeType,title==null?safeName:title,null,blob.id());
            return summary(repository.find(workspace,id).orElseThrow().metadata());
        });
    }
    // Only the owning teacher deletes; a download's bytes are released to the janitor together with the row.
    public void delete(Actor actor,String workspace,String id){
        transaction.execute(status->{
            var stored=repository.find(workspace,id).orElseThrow(WorkspaceAccess::missing).metadata();students.requireReader(actor,workspace,stored.studentId());
            if(actor.role()!=Actor.Role.TEACHER)throw new ApiFailure(403,"FORBIDDEN","Only the teacher can remove materials.");var owner=students.lockTeacherCard(actor,workspace,stored.studentId());
            if(!repository.delete(workspace,id))throw WorkspaceAccess.missing();
            if(stored.kind().equals("download")&&stored.blobId()!=null)blobs.release(actor,owner,stored.lessonId(),stored.blobId());
            return null;
        });
    }
    private static String audience(String value){if(value==null||!AUDIENCES.contains(value))throw new IllegalArgumentException("Audience must be student or teacher.");return value;}
    private static String contentKey(String value){if(value==null||value.isBlank())return null;if(!value.matches("[a-z][a-z0-9-]{0,39}"))throw new IllegalArgumentException("Invalid material role.");return value;}
    private static String title(String value){if(value==null)return null;String trimmed=value.strip();if(trimmed.isEmpty())return null;if(trimmed.length()>200||trimmed.indexOf(0)>=0)throw new IllegalArgumentException("Invalid title.");return trimmed;}
    private String encode(Object value){return json.writeValueAsString(value);}
    public MaterialView read(Actor actor,String workspace,String id){return read(actor,workspace,id,null);}
    public MaterialView read(Actor actor,String workspace,String id,String audience){
        boolean publicView=publicView(actor,audience);var stored=authorized(actor,workspace,id,publicView);var meta=stored.metadata();
        Map<String,Object> out=metadata(meta);
        if(meta.kind().equals("download")){out.put("blob",blob(actor,meta));out.put("downloadUrl","/api/v1/workspaces/"+segment(workspace)+"/materials/"+segment(id)+"/file");}
        else {
            JsonNode source=json.readTree(stored.payload());
            switch(meta.kind()){
                case "doc"->out.put("document",document(source));
                case "code"->out.put("code",code(source));
                case "view"->out.put("viewData",viewData(meta,source,publicView));
                default->throw WorkspaceAccess.missing();
            }
        }
        return new MaterialView(Collections.unmodifiableMap(out));
    }
    public Page<MaterialSummary> list(Actor actor,String workspace,String student,String lesson,int page,int size,String audience){
        new Page<>(List.of(),page,size,0);students.requireReader(actor,workspace,student);if(lesson!=null)lessons.requireReader(actor,workspace,student,lesson);
        boolean publicView=publicView(actor,audience);
        return new Page<>(repository.list(workspace,student,lesson,publicView,page,size).stream().map(MaterialService::summary).toList(),page,size,repository.count(workspace,student,lesson,publicView));
    }
    public Download download(Actor actor,String workspace,String id,String audience){var meta=authorized(actor,workspace,id,publicView(actor,audience)).metadata();if(!meta.kind().equals("download"))throw WorkspaceAccess.missing();return new Download(summary(meta),blob(actor,meta));}
    public InputStream open(Actor actor,String workspace,String id,String audience)throws IOException {
        var meta=authorized(actor,workspace,id,publicView(actor,audience)).metadata();if(!meta.kind().equals("download"))throw WorkspaceAccess.missing();
        return meta.lessonId()==null?blobs.open(actor,students.requireReader(actor,workspace,meta.studentId()),meta.blobId()):blobs.open(actor,new LessonRef(workspace,meta.studentId(),meta.lessonId()),meta.blobId());
    }
    private BlobService.BlobRef blob(Actor actor,MaterialRepository.Metadata m){return m.lessonId()==null?blobs.describe(actor,students.requireReader(actor,m.workspaceId(),m.studentId()),m.blobId()):blobs.describe(actor,new LessonRef(m.workspaceId(),m.studentId(),m.lessonId()),m.blobId());}
    private MaterialRepository.Stored authorized(Actor actor,String workspace,String id,boolean publicView){var stored=repository.find(workspace,id).orElseThrow(WorkspaceAccess::missing);authorize(actor,stored.metadata(),publicView);return stored;}
    private void authorize(Actor actor,MaterialRepository.Metadata m,boolean publicView){
        students.requireReader(actor,m.workspaceId(),m.studentId());
        if(publicView&&(!m.audience().equals("student")||(m.kind().equals("code")&&m.teacherCode())))throw WorkspaceAccess.missing();
        if(m.lessonId()!=null)lessons.requireMaterialReader(actor,m.workspaceId(),m.studentId(),m.lessonId(),m.bundleId(),publicView);
    }
    private static boolean publicView(Actor actor,String audience){if(audience!=null&&!audience.equals("student"))throw new IllegalArgumentException("Invalid audience.");return actor.role()==Actor.Role.STUDENT||audience!=null;}
    private static MaterialSummary summary(MaterialRepository.Metadata m){return new MaterialSummary(m.id(),m.workspaceId(),m.studentId(),m.lessonId(),m.bundleId(),m.audience(),m.kind(),m.contentKey(),m.filename(),m.contentType(),m.title());}
    private Map<String,Object> metadata(MaterialRepository.Metadata m){Map<String,Object> out=new LinkedHashMap<>();out.put("id",m.id());out.put("workspaceId",m.workspaceId());out.put("studentId",m.studentId());out.put("lessonId",m.lessonId());out.put("bundleId",m.bundleId());out.put("audience",m.audience());out.put("kind",m.kind());out.put("contentKey",m.contentKey());out.put("filename",m.filename());out.put("contentType",m.contentType());out.put("title",m.title());return out;}
    private static Map<String,Object> document(JsonNode source){
        Map<String,Object> out=strings(source,"title","intro","raw","html");List<Map<String,Object>> sections=new ArrayList<>();
        for(JsonNode section:array(source,"sections")){var value=strings(section,"id","title","html");if(section.has("studentParts")){List<Integer> parts=new ArrayList<>();for(JsonNode part:array(section,"studentParts")){if(!part.isInt()||part.intValue()<0)throw WorkspaceAccess.missing();parts.add(part.intValue());}value.put("studentParts",parts);}sections.add(value);}out.put("sections",sections);return out;
    }
    private static Map<String,Object> code(JsonNode source){var out=strings(source,"text","materialId");if(!source.path("teacher").isBoolean())throw WorkspaceAccess.missing();out.put("teacher",source.get("teacher").booleanValue());if(source.has("excerpt")){JsonNode excerpt=source.get("excerpt");int start=integer(excerpt,"start"),end=integer(excerpt,"end");if(end<start)throw WorkspaceAccess.missing();out.put("excerpt",Map.of("start",start,"end",end));}return out;}
    private Map<String,Object> viewData(MaterialRepository.Metadata meta,JsonNode source,boolean publicView){
        Map<String,Object> out=new LinkedHashMap<>();for(String key:List.of("goalHtml","lessonHtml","reviewHtml","profileFacts"))if(source.has(key)&&(!publicView||key.equals("goalHtml")))out.put(key,string(source,key));
        if(source.has("review")){var review=source.get("review");List<Map<String,Object>> priorities=new ArrayList<>();for(var priority:array(review,"priorities"))priorities.add(strings(priority,"sectionId","label"));out.put("review",Map.of("metadataParagraphs",integer(review,"metadataParagraphs"),"priorities",priorities));}
        Set<String> keys=new HashSet<>();for(var doc:repository.visible(meta.workspaceId(),meta.studentId(),meta.lessonId(),publicView))if(doc.kind().equals("doc"))keys.add(doc.contentKey());
        if(source.has("descriptors")){Map<String,Object> descriptors=new LinkedHashMap<>();JsonNode values=source.get("descriptors");if(!values.isObject())throw WorkspaceAccess.missing();for(var entry:values.properties())if(keys.contains(entry.getKey()))descriptors.put(entry.getKey(),tuple(entry.getValue(),2));out.put("descriptors",descriptors);}
        if(source.has("resources")){List<List<String>> resources=new ArrayList<>();for(var node:array(source,"resources")){var resource=tuple(node,4);if(keys.contains(resource.getFirst()))resources.add(resource);}out.put("resources",resources);}
        if(!publicView&&source.has("answersCards")){List<List<String>> cards=new ArrayList<>();for(var card:array(source,"answersCards"))cards.add(tuple(card,3));out.put("answersCards",cards);}return out;
    }
    private static Map<String,Object> strings(JsonNode node,String... keys){Map<String,Object> out=new LinkedHashMap<>();for(String key:keys)out.put(key,string(node,key));return out;}
    private static String string(JsonNode node,String key){if(!node.path(key).isString())throw WorkspaceAccess.missing();return node.get(key).asString();}
    private static JsonNode array(JsonNode node,String key){if(!node.path(key).isArray())throw WorkspaceAccess.missing();return node.get(key);}
    private static int integer(JsonNode node,String key){if(!node.path(key).isInt()||node.get(key).intValue()<0)throw WorkspaceAccess.missing();return node.get(key).intValue();}
    private static List<String> tuple(JsonNode node,int count){if(!node.isArray()||node.size()!=count)throw WorkspaceAccess.missing();List<String> result=new ArrayList<>();for(var item:node){if(!item.isString())throw WorkspaceAccess.missing();result.add(item.asString());}return result;}
    private static String segment(String value){return UriUtils.encodePathSegment(value,StandardCharsets.UTF_8);}
}
