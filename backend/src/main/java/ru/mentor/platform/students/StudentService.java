package ru.mentor.platform.students;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.workspaces.*;
import java.time.Clock;
import java.util.*;

@Service
public class StudentService {
    private static final Map<String,Integer> FIELDS=Map.of("name",120,"direction",120,"goal",1000,"schedule",500,"notes",5000,"studentRoadmap",20000,"studentReview",20000);
    private final StudentRepository repository;private final WorkspaceAccess access;private final Clock clock;
    public StudentService(StudentRepository repository,WorkspaceAccess access,Clock clock){this.repository=repository;this.access=access;this.clock=clock;}
    public StudentRef requireReader(Actor actor,String workspaceId,String studentId){
        var m=access.requireMember(actor,workspaceId);
        if(actor.role()==Actor.Role.STUDENT&&!Objects.equals(m.studentId(),studentId))throw WorkspaceAccess.missing();
        return repository.find(workspaceId,studentId,false).orElseThrow(WorkspaceAccess::missing).ref();
    }
    public StudentRef lockTeacherCard(Actor actor,String workspace,String student){access.lockTeacher(actor,workspace);return lockCard(workspace,student);}
    public StudentRef lockCard(String workspace,String student){return repository.find(workspace,student,true).orElseThrow(WorkspaceAccess::missing).ref();}
    public void bind(String workspace,String student,String user){repository.bind(workspace,student,user);}
    public Page<Map<String,Object>> list(Actor actor,String w,int page,int size,String audience){
        new Page<>(List.of(),page,size,0);var m=access.requireMember(actor,w);boolean publicView=publicView(actor,audience);
        String own=actor.role()==Actor.Role.STUDENT?m.studentId():null;
        return new Page<>(repository.list(w,own,page,size).stream().map(p->view(p,publicView)).toList(),page,size,repository.count(w,own));
    }
    public Map<String,Object> get(Actor actor,String w,String id,String audience){requireReader(actor,w,id);return view(repository.find(w,id,false).orElseThrow(WorkspaceAccess::missing),publicView(actor,audience));}
    @Transactional public Map<String,Object> create(Actor actor,String w,Map<String,Object> input){access.lockTeacher(actor,w);return view(repository.create(w,values(input,null),clock.instant()),false);}
    @Transactional public Map<String,Object> update(Actor actor,String w,String id,Map<String,Object> input){
        lockTeacherCard(actor,w,id);var existing=repository.find(w,id,false).orElseThrow();
        Object rev=input.get("revision");if(!(rev instanceof Number n)||n.longValue()<1||n.doubleValue()!=n.longValue())throw new IllegalArgumentException("Revision required.");
        Map<String,Object> fields=new HashMap<>(input);fields.remove("revision");
        if(!repository.update(w,id,n.longValue(),values(fields,existing.fields())))throw new ApiFailure(409,"REVISION_CONFLICT","Profile changed. Refresh before saving.");
        return view(repository.find(w,id,false).orElseThrow(),false);
    }
    private static boolean publicView(Actor actor,String audience){if(audience!=null&&!audience.equals("student"))throw new IllegalArgumentException("Invalid audience.");return actor.role()==Actor.Role.STUDENT||audience!=null;}
    private static Map<String,Object> view(StudentRepository.Profile p,boolean publicView){
        Map<String,Object> out=new LinkedHashMap<>();out.put("id",p.ref().id());out.put("workspaceId",p.ref().workspaceId());out.put("userId",p.ref().userId());out.put("revision",p.revision());out.put("createdAt",p.createdAt().toString());p.fields().forEach((k,v)->{if(!publicView||!k.equals("notes"))out.put(k,v);});return out;
    }
    private static Map<String,String> values(Map<String,Object> input,Map<String,String> existing){
        if(!FIELDS.keySet().containsAll(input.keySet()))throw new IllegalArgumentException("Unknown field.");
        Map<String,String> out=new HashMap<>();FIELDS.forEach((key,max)->{
            Object raw=input.containsKey(key)?input.get(key):existing==null?(key.equals("direction")?"Java Backend":""):existing.get(key);
            if(!(raw instanceof String value))throw new IllegalArgumentException("Text required.");
            String normalized=value.replaceAll("^[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+|[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+$","");
            if(normalized.length()>max||(key.equals("name")&&normalized.isEmpty()))throw new IllegalArgumentException("Invalid field size.");out.put(key,normalized);
        });return out;
    }
}
