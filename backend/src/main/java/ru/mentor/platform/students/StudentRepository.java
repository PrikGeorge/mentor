package ru.mentor.platform.students;

import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
public class StudentRepository {
    private final JdbcTemplate jdbc;
    public StudentRepository(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public record Profile(StudentRef ref,long revision,Instant createdAt,Map<String,String> fields,Instant archivedAt){}
    private static final String COLUMNS="workspace_id,id,user_id,revision,created_at,name,direction,goal,schedule,notes,student_roadmap,student_review,archived_at";
    private static final RowMapper<Profile> MAPPER=(r,n)->new Profile(new StudentRef(r.getString(1),r.getString(2),r.getString(3)),r.getLong(4),r.getTimestamp(5).toInstant(),Map.of("name",r.getString(6),"direction",r.getString(7),"goal",r.getString(8),"schedule",r.getString(9),"notes",r.getString(10),"studentRoadmap",r.getString(11),"studentReview",r.getString(12)),r.getTimestamp(13)==null?null:r.getTimestamp(13).toInstant());
    public Optional<Profile> find(String w,String id,boolean lock){return jdbc.query("SELECT "+COLUMNS+" FROM student_profile WHERE workspace_id=? AND id=?"+(lock?" FOR UPDATE":""),MAPPER,w,id).stream().findFirst();}
    // archived: null lists every card, true only archived ones, false only active ones.
    public List<Profile> list(String w,String student,Boolean archived,int page,int size){
        List<Object> args=new ArrayList<>(List.of(w));String where=" WHERE workspace_id=?";if(student!=null){where+=" AND id=?";args.add(student);}if(archived!=null)where+=archived?" AND archived_at IS NOT NULL":" AND archived_at IS NULL";
        args.add(size);args.add((long)page*size);return jdbc.query("SELECT "+COLUMNS+" FROM student_profile"+where+" ORDER BY created_at,id LIMIT ? OFFSET ?",MAPPER,args.toArray());
    }
    public long count(String w,String student,Boolean archived){
        List<Object> args=new ArrayList<>(List.of(w));String where=" WHERE workspace_id=?";if(student!=null){where+=" AND id=?";args.add(student);}if(archived!=null)where+=archived?" AND archived_at IS NOT NULL":" AND archived_at IS NULL";
        return jdbc.queryForObject("SELECT count(*) FROM student_profile"+where,Long.class,args.toArray());
    }
    public boolean archive(String w,String id,long revision,Instant archivedAt){return jdbc.update("UPDATE student_profile SET archived_at=?,revision=revision+1 WHERE workspace_id=? AND id=? AND revision=?",archivedAt==null?null:Timestamp.from(archivedAt),w,id,revision)==1;}
    public Profile create(String w,Map<String,String> f,Instant now){String id=UUID.randomUUID().toString();jdbc.update("INSERT INTO student_profile(workspace_id,id,name,direction,goal,schedule,notes,student_roadmap,student_review,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",w,id,f.get("name"),f.get("direction"),f.get("goal"),f.get("schedule"),f.get("notes"),f.get("studentRoadmap"),f.get("studentReview"),Timestamp.from(now));return find(w,id,false).orElseThrow();}
    public boolean update(String w,String id,long revision,Map<String,String> f){return jdbc.update("UPDATE student_profile SET name=?,direction=?,goal=?,schedule=?,notes=?,student_roadmap=?,student_review=?,revision=revision+1 WHERE workspace_id=? AND id=? AND revision=?",f.get("name"),f.get("direction"),f.get("goal"),f.get("schedule"),f.get("notes"),f.get("studentRoadmap"),f.get("studentReview"),w,id,revision)==1;}
    public void bind(String w,String id,String user){jdbc.update("UPDATE student_profile SET user_id=?,revision=revision+1 WHERE workspace_id=? AND id=? AND user_id IS NULL",user,w,id);}
}
