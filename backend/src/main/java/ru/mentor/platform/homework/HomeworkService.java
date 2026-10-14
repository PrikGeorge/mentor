package ru.mentor.platform.homework;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.files.BlobService;
import ru.mentor.platform.lessons.*;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import ru.mentor.platform.shared.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class HomeworkService {
    public static final long MAXIMUM_FILE=20971520;
    public record Download(Submission submission,BlobService.BlobRef blob) {}
    private final HomeworkRepository repository;
    private final BlobService blobs;
    private final LessonService lessons;
    private final StudentService students;
    private final WorkspaceAccess access;
    private final Clock clock;
    private final TransactionTemplate transaction;
    public HomeworkService(HomeworkRepository repository,BlobService blobs,LessonService lessons,StudentService students,WorkspaceAccess access,Clock clock,PlatformTransactionManager manager){
        this.repository=repository;this.blobs=blobs;this.lessons=lessons;this.students=students;this.access=access;this.clock=clock;this.transaction=new TransactionTemplate(manager);
    }
    private void reader(Actor actor,LessonRef lesson){lessons.requireReader(actor,lesson.workspaceId(),lesson.studentId(),lesson.id());}
    private void student(Actor actor,LessonRef lesson){reader(actor,lesson);if(actor.role()!=Actor.Role.STUDENT)throw new ApiFailure(403,"FORBIDDEN","Only the student can submit homework.");}
    private void lock(Actor actor,LessonRef lesson){access.lockMember(actor,lesson.workspaceId());students.lockCard(lesson.workspaceId(),lesson.studentId());reader(actor,lesson);}
    public Page<Submission> list(Actor actor,LessonRef lesson,int page,int size){reader(actor,lesson);new Page<>(List.of(),page,size,0);return new Page<>(repository.list(lesson,page,size),page,size,repository.count(lesson));}
    // Whose turn it is: the latest submission per lesson of one card, readable by its teacher and its own student.
    public Page<HomeworkTurns.LessonTurn> lessonTurns(Actor actor,String workspace,String student,int page,int size,String audience){
        new Page<>(List.of(),page,size,0);if(audience!=null&&!audience.equals("student"))throw new IllegalArgumentException("Invalid audience.");
        students.requireReader(actor,workspace,student);
        return new Page<>(repository.lessonTurns(workspace,student,page,size),page,size,repository.countLessonTurns(workspace,student));
    }
    // The teacher's review queue: one row per student of the exact workspace, works awaiting review first and oldest first.
    public Page<HomeworkTurns.StudentTurn> studentTurns(Actor actor,String workspace,int page,int size){
        new Page<>(List.of(),page,size,0);access.requireTeacher(actor,workspace);
        return new Page<>(repository.studentTurns(workspace,page,size),page,size,repository.countStudentTurns(workspace));
    }
    public Submission submit(Actor actor,LessonRef lesson,InputStream input,String filename,String comment,String repositoryUrl)throws IOException {
        return submit(actor,lesson,input,filename,comment,repositoryUrl,null);
    }
    public Submission submit(Actor actor,LessonRef lesson,InputStream input,String filename,String comment,String repositoryUrl,Long expectedSize)throws IOException {
        return submit(actor,lesson,input,filename,comment,repositoryUrl,expectedSize,null);
    }
    // With an Idempotency-Key a retry after a lost response returns the work already stored instead of a second copy;
    // the same key with another file, comment or link is a conflict. Without a key every upload is a new work.
    public Submission submit(Actor actor,LessonRef lesson,InputStream input,String filename,String comment,String repositoryUrl,Long expectedSize,String idempotencyKey)throws IOException {
        student(actor,lesson);String name=filename(filename),note=form(comment,10000),url=repositoryUrl(repositoryUrl);
        if(idempotencyKey!=null&&!idempotencyKey.matches("[A-Za-z0-9._:-]{1,128}"))throw new IllegalArgumentException("Valid Idempotency-Key required.");
        if(input==null||(expectedSize!=null&&expectedSize<=0))throw new IllegalArgumentException("Nonempty file required.");
        if(expectedSize!=null&&expectedSize>MAXIMUM_FILE)throw oversized();
        try(var source=new PushbackInputStream(bounded(input),4)){
            byte[] prefix=source.readNBytes(4);if(prefix.length==0)throw new IllegalArgumentException("Nonempty file required.");
            if(name.toLowerCase(Locale.ROOT).endsWith(".zip")&&!zip(prefix))throw new IllegalArgumentException("Invalid ZIP signature.");
            source.unread(prefix);
            var staged=blobs.stage(actor,lesson,source,MAXIMUM_FILE,expectedSize);
            String hash=idempotencyKey==null?null:payloadHash(staged.sha256(),name,note,url);
            return transaction.execute(status->{
                lock(actor,lesson);student(actor,lesson);
                if(idempotencyKey!=null){
                    var prior=repository.replay(lesson,idempotencyKey);
                    // The staged bytes of a replay stay unattached; the reservation expires and the janitor removes them.
                    if(prior.isPresent()){if(!prior.get().payloadHash().equals(hash))throw new ApiFailure(409,"IDEMPOTENCY_CONFLICT","Idempotency key already used for another work.");return prior.get().submission();}
                }
                var blob=blobs.attach(actor,lesson,staged,name,"application/octet-stream");
                var submission=new Submission(UUID.randomUUID().toString(),name,blob.size(),clock.instant().truncatedTo(ChronoUnit.MICROS),note,url,ReviewStatus.submitted,"",null,1,null);
                repository.insert(lesson,submission,blob.id(),idempotencyKey,hash);return submission;
            });
        } catch(TooLarge failure){throw oversized();}
    }
    private static String payloadHash(String sha256,String filename,String comment,String repositoryUrl){
        try{
            var digest=java.security.MessageDigest.getInstance("SHA-256");
            for(String part:List.of(sha256,filename,comment,repositoryUrl)){digest.update(part.getBytes(StandardCharsets.UTF_8));digest.update((byte)0);}
            return HexFormat.of().formatHex(digest.digest());
        } catch(java.security.NoSuchAlgorithmException missing){throw new IllegalStateException(missing);}
    }
    public Submission review(Actor actor,LessonRef lesson,String id,long revision,ReviewStatus status,String feedback){return review(actor,lesson,id,revision,status,feedback,null);}
    public Submission review(Actor actor,LessonRef lesson,String id,long revision,ReviewStatus status,String feedback,Grade grade){
        String text=form(feedback,20000);if(revision<1||status==null||status==ReviewStatus.submitted)throw new IllegalArgumentException("Invalid review.");
        return transaction.execute(tx->{
            lock(actor,lesson);if(actor.role()!=Actor.Role.TEACHER)throw new ApiFailure(403,"FORBIDDEN","Only the teacher can review homework.");
            var existing=repository.find(lesson,id,true).orElseThrow(WorkspaceAccess::missing).submission();
            if(existing.revision()!=revision)throw new ApiFailure(409,"REVISION_CONFLICT","Review changed. Refresh before saving.");
            var changed=new Submission(existing.id(),existing.filename(),existing.size(),existing.createdAt(),existing.comment(),existing.repositoryUrl(),status,text,clock.instant().truncatedTo(ChronoUnit.MICROS),Math.addExact(revision,1),grade);
            repository.review(lesson,changed);return changed;
        });
    }
    public static final int MAXIMUM_TEXT=262144;
    public record TextFile(String filename,String text) {}
    // Only a single small UTF-8 text file is shown inline; archives stay closed and are never unpacked.
    public TextFile text(Actor actor,LessonRef lesson,String id)throws IOException {
        reader(actor,lesson);var submission=repository.find(lesson,id,false).orElseThrow(WorkspaceAccess::missing).submission();
        if(!submission.filename().toLowerCase(Locale.ROOT).matches(".*[.](java|txt|md)")||submission.size()>MAXIMUM_TEXT)throw notText();
        try(var input=open(actor,lesson,id)){
            byte[] bytes=input.readNBytes(MAXIMUM_TEXT+1);if(bytes.length>MAXIMUM_TEXT)throw notText();
            try{return new TextFile(submission.filename(),StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString());}
            catch(java.nio.charset.CharacterCodingException malformed){throw notText();}
        }
    }
    private static ApiFailure notText(){return new ApiFailure(415,"NOT_TEXT","Only a single UTF-8 text file up to 256 KiB can be shown.");}
    public Download download(Actor actor,LessonRef lesson,String id){reader(actor,lesson);var stored=repository.find(lesson,id,false).orElseThrow(WorkspaceAccess::missing);return new Download(stored.submission(),blobs.describe(actor,lesson,stored.blobId()));}
    public InputStream open(Actor actor,LessonRef lesson,String id)throws IOException {reader(actor,lesson);var stored=repository.find(lesson,id,false).orElseThrow(WorkspaceAccess::missing);return blobs.open(actor,lesson,stored.blobId());}
    private static String filename(String value){
        if(value==null||value.isEmpty()||value.length()>180||!wellFormed(value)||!value.equals(trim(value))||value.chars().anyMatch(c->c<32||c==127||"\\/<>:\"|?*".indexOf(c)>=0)||value.startsWith(".")||value.endsWith(".")||value.endsWith(" ")||value.matches("(?i)^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\..*)?$"))throw new IllegalArgumentException("Unsafe filename.");
        int dot=value.lastIndexOf('.');if(dot<0||!Set.of("zip","java","txt","md","pdf").contains(value.substring(dot+1).toLowerCase(Locale.ROOT)))throw new IllegalArgumentException("Unsupported homework file.");return value;
    }
    private static String repositoryUrl(String value){
        String url=form(value,2000);if(url.isEmpty())return url;
        URI parsed=URI.create(url);if(!"https".equalsIgnoreCase(parsed.getScheme())||parsed.getHost()==null||parsed.getHost().isEmpty()||parsed.getRawUserInfo()!=null)throw new IllegalArgumentException("HTTPS repository URL required.");return url;
    }
    private static String form(String value,int maximum){if(value==null)value="";if(value.length()>maximum||value.indexOf(0)>=0||!wellFormed(value))throw new IllegalArgumentException("Invalid form text.");return trim(value);}
    private static boolean wellFormed(String value){return StandardCharsets.UTF_8.newEncoder().canEncode(value);}
    // ECMAScript trim, matching the existing plain form fields; limits apply before trimming.
    private static String trim(String value){int start=0,end=value.length();while(start<end&&space(value.charAt(start)))start++;while(end>start&&space(value.charAt(end-1)))end--;return value.substring(start,end);}
    private static boolean space(char c){return c=='\t'||c=='\n'||c=='\u000b'||c=='\f'||c=='\r'||c=='\u2028'||c=='\u2029'||c=='\ufeff'||Character.getType(c)==Character.SPACE_SEPARATOR;}
    private static boolean zip(byte[] p){return p.length==4&&p[0]==0x50&&p[1]==0x4b&&((p[2]==3&&p[3]==4)||(p[2]==5&&p[3]==6)||(p[2]==7&&p[3]==8));}
    private static InputStream bounded(InputStream source){return new FilterInputStream(source){long count;private int measured(int n)throws IOException {if(n>0&&(count+=n)>MAXIMUM_FILE)throw new TooLarge();return n;}public int read()throws IOException {int value=in.read();if(value>=0)measured(1);return value;}public int read(byte[] b,int off,int len)throws IOException{return measured(in.read(b,off,(int)Math.min(len,MAXIMUM_FILE-count+1)));}};}
    private static class TooLarge extends IOException {}
    private static ApiFailure oversized(){return new ApiFailure(413,"INVALID_INPUT","Homework file exceeds its byte limit.");}
}
