package ru.mentor.platform.journal;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import ru.mentor.platform.support.*;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** The "Moves" journal of one card: four sources in one page, stable order and paging, lesson filter and workspace boundary (Q-05 / B-12). */
class MoveJournalTest extends IdentityHttpTest {
    private static final byte[] TEXT="class Main {}\n".getBytes(StandardCharsets.UTF_8);
    @TempDir Path temporary;

    private record Fixture(User teacher,User learner,String student,String first,String second){}
    private Fixture fixture(String login)throws Exception {
        var teacher=teacher(login);String student=student(teacher,"Synthetic moves student").get("id").asText();var learner=enroll(teacher,student,login+"-student");
        return new Fixture(teacher,learner,student,lesson(teacher,student,"First lesson","2030-01-01"),lesson(teacher,student,"Second lesson","2030-01-08"));
    }
    private String homework(Fixture f,String lesson){return card(f.teacher(),f.student())+"/lessons/"+lesson+"/homework";}
    private String moves(Fixture f){return card(f.teacher(),f.student())+"/moves";}
    private List<String> kinds(JsonNode page){var out=new ArrayList<String>();page.get("items").forEach(i->out.add(i.get("kind").asText()));return out;}
    private List<String> refs(JsonNode page){var out=new ArrayList<String>();page.get("items").forEach(i->out.add(i.get("refId").asText()));return out;}
    private String attempt(Fixture f,String lesson,String mode,String key)throws Exception {
        String practice=card(f.teacher(),f.student())+"/lessons/"+lesson+"/practice";
        var body=Map.of("exerciseRevision",1,"mode",mode,"files",Map.of("ListTask.java","class ListTask {\n    int x;\n}"));
        return data(write(f.learner().client(),"POST",practice+"/exercises/list-task/attempts",body,"Idempotency-Key",key),202).get("id").asText();
    }

    // Catches a source missing from the merge, ordinals counted per card instead of per lesson, a review hiding its grade, and the student side mislabeled.
    @Test void fourSourcesMergeIntoOneJournalWithPerLessonOrdinals()throws Exception {
        var f=fixture("moves-sources");
        var first=data(uploadHomework(f.learner(),homework(f,f.first()),"Main.java",TEXT," first try "),201);CLOCK.advance(Duration.ofSeconds(1));
        var second=data(uploadHomework(f.learner(),homework(f,f.first()),"Main.java",TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));
        var other=data(uploadHomework(f.learner(),homework(f,f.second()),"Other.java",TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));
        data(write(f.teacher().client(),"PATCH",homework(f,f.first())+"/"+second.get("id").asText()+"/review",Map.of("revision",1,"status","reviewed","feedback","Хорошо","grade","good")),200);CLOCK.advance(Duration.ofSeconds(1));
        TrainingCatalog.publish(context,json,temporary,f.teacher().workspace());
        data(write(f.teacher().client(),"PUT",card(f.teacher(),f.student())+"/lessons/"+f.second()+"/practice/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","class")))),200);
        String attempt=attempt(f,f.second(),"submit","moves-1");CLOCK.advance(Duration.ofSeconds(1));
        var conducted=data(write(f.teacher().client(),"PATCH",card(f.teacher(),f.student())+"/lessons/"+f.first(),Map.of("revision",1,"conducted",true)),200);
        var page=data(get(f.learner().client(),moves(f)),200);
        assertEquals(6,page.get("total").asLong());assertEquals(0,page.get("page").asInt());assertEquals(25,page.get("size").asInt());
        assertEquals(List.of("conducted","attempt","review","homework","homework","homework"),kinds(page));
        var items=page.get("items");
        var held=items.get(0);assertEquals("teacher",held.get("side").asText());assertEquals(f.first(),held.get("lessonId").asText());assertEquals(f.first(),held.get("refId").asText());assertEquals("First lesson",held.get("lessonTitle").asText());
        assertEquals(conducted.get("conductedAt").asText(),held.get("at").asText());assertEquals(Set.of("kind","side","at","lessonId","lessonTitle","refId"),held.propertyNames());
        var run=items.get(1);assertEquals("student",run.get("side").asText());assertEquals(attempt,run.get("refId").asText());assertEquals(f.second(),run.get("lessonId").asText());assertEquals("submit",run.get("detail").asText());assertEquals("queued",run.get("status").asText());assertFalse(run.get("subject").asText().isBlank());assertFalse(run.has("ordinal"));assertFalse(run.has("passed"));
        var review=items.get(2);assertEquals("teacher",review.get("side").asText());assertEquals(second.get("id").asText(),review.get("refId").asText());assertEquals("good",review.get("grade").asText());assertEquals("Хорошо",review.get("detail").asText());assertEquals("reviewed",review.get("status").asText());assertEquals(2,review.get("ordinal").asInt());assertEquals("Main.java",review.get("subject").asText());
        // Ordinals count the works of their own lesson: the second lesson's only file is its first.
        var late=items.get(3);assertEquals(other.get("id").asText(),late.get("refId").asText());assertEquals(1,late.get("ordinal").asInt());assertEquals(f.second(),late.get("lessonId").asText());assertEquals("Second lesson",late.get("lessonTitle").asText());assertEquals("submitted",late.get("status").asText());
        assertEquals(second.get("id").asText(),items.get(4).get("refId").asText());assertEquals(2,items.get(4).get("ordinal").asInt());assertEquals("reviewed",items.get(4).get("status").asText());
        assertEquals(first.get("id").asText(),items.get(5).get("refId").asText());assertEquals(1,items.get(5).get("ordinal").asInt());assertEquals("first try",items.get(5).get("detail").asText());assertEquals("student",items.get(5).get("side").asText());
        for(int i=1;i<items.size();i++)assertFalse(Instant.parse(items.get(i).get("at").asText()).isAfter(Instant.parse(items.get(i-1).get("at").asText())),"Newest first.");
        // The teacher reads the same journal, with or without the student preview; every move is a student-visible fact.
        assertEquals(page,data(get(f.teacher().client(),moves(f)),200));assertEquals(page,data(get(f.teacher().client(),moves(f)+"?audience=student"),200));
        assertEquals(400,get(f.teacher().client(),moves(f)+"?audience=teacher").statusCode());assertEquals(400,get(f.learner().client(),moves(f)+"?audience=teacher").statusCode());
        var response=get(f.learner().client(),moves(f));assertEquals("no-store",response.headers().firstValue("Cache-Control").orElseThrow());
        // Lesson filter: both the page and its total follow the lesson; an unknown lesson is simply empty, a malformed one is an error.
        var firstOnly=data(get(f.learner().client(),moves(f)+"?lessonId="+f.first()),200);assertEquals(4,firstOnly.get("total").asLong());assertEquals(List.of("conducted","review","homework","homework"),kinds(firstOnly));
        firstOnly.get("items").forEach(item->assertEquals(f.first(),item.get("lessonId").asText()));
        var secondOnly=data(get(f.teacher().client(),moves(f)+"?lessonId="+f.second()),200);assertEquals(2,secondOnly.get("total").asLong());assertEquals(List.of("attempt","homework"),kinds(secondOnly));
        assertEquals(0,data(get(f.learner().client(),moves(f)+"?lessonId=unknown-lesson"),200).get("total").asLong());
        assertEquals(400,get(f.learner().client(),moves(f)+"?lessonId=").statusCode());assertEquals(400,get(f.learner().client(),moves(f)+"?lessonId="+"x".repeat(101)).statusCode());
        assertEquals(0,data(get(f.learner().client(),moves(f)+"?lessonId="+"x".repeat(100)),200).get("total").asLong());
        // Another card's lesson id filters this card to nothing instead of reaching across.
        var foreign=fixture("moves-foreign");data(uploadHomework(foreign.learner(),homework(foreign,foreign.first()),"Foreign.java",TEXT,null),201);
        assertEquals(0,data(get(f.learner().client(),moves(f)+"?lessonId="+foreign.first()),200).get("total").asLong());
        // Workspace boundary: a foreign teacher, a foreign student, the administrator and an anonymous client all see nothing.
        for(var client:List.of(foreign.teacher().client(),foreign.learner().client(),admin))assertEquals(404,get(client,moves(f)).statusCode());
        assertEquals(404,get(f.learner().client(),moves(foreign)).statusCode());assertEquals(401,get(client(),moves(f)).statusCode());
        assertEquals(1,data(get(foreign.learner().client(),moves(foreign)),200).get("total").asLong());
    }

    // Catches pages that overlap or skip when many moves share one instant, and a sort that depends on insertion order.
    @Test void pagesAreStableWhenMovesShareOneInstant()throws Exception {
        var f=fixture("moves-paging");
        // The injected clock stands still: five files and a held lesson all carry the same timestamp.
        var ids=new ArrayList<String>();for(int i=0;i<5;i++)ids.add(data(uploadHomework(f.learner(),homework(f,f.first()),"Work"+i+".java",TEXT,null),201).get("id").asText());
        data(write(f.teacher().client(),"PATCH",card(f.teacher(),f.student())+"/lessons/"+f.second(),Map.of("revision",1,"conducted",true)),200);
        assertEquals(1,jdbc.queryForObject("SELECT count(DISTINCT created_at) FROM homework_submission WHERE workspace_id=?",Integer.class,f.teacher().workspace()));
        var all=data(get(f.learner().client(),moves(f)),200);assertEquals(6,all.get("total").asLong());assertEquals(6,all.get("items").size());
        var items=all.get("items");
        // Same instant: kind ascending, then id descending; the held lesson ('conducted') therefore precedes every file ('homework').
        assertEquals("conducted",items.get(0).get("kind").asText());assertEquals(f.second(),items.get(0).get("lessonId").asText());
        var files=refs(all).subList(1,6);var expected=new ArrayList<>(files);expected.sort(Comparator.reverseOrder());assertEquals(expected,files);
        assertEquals(new HashSet<>(ids),new HashSet<>(files));
        // Ordinals of simultaneous works follow the same id order, so the first listed file is the last work of the lesson.
        var ordinals=new ArrayList<Integer>();for(int i=1;i<6;i++)ordinals.add(items.get(i).get("ordinal").asInt());assertEquals(List.of(5,4,3,2,1),ordinals);
        for(int size:List.of(1,2,4,5)){
            var collected=new ArrayList<String>();int pages=(6+size-1)/size;
            for(int page=0;page<pages;page++){var p=data(get(f.learner().client(),moves(f)+"?page="+page+"&size="+size),200);assertEquals(6,p.get("total").asLong());assertEquals(page,p.get("page").asInt());assertEquals(size,p.get("size").asInt());assertEquals(Math.min(size,6-page*size),p.get("items").size());collected.addAll(refs(p));}
            assertEquals(refs(all),collected,"size="+size);
            var beyond=data(get(f.learner().client(),moves(f)+"?page="+pages+"&size="+size),200);assertEquals(6,beyond.get("total").asLong());assertEquals(0,beyond.get("items").size());
        }
        assertEquals(refs(all),refs(data(get(f.teacher().client(),moves(f)+"?audience=student&size=100"),200)));
        for(String query:List.of("size=0","size=101","page=-1","size=abc","page=1.5"))assertEquals(400,get(f.learner().client(),moves(f)+"?"+query).statusCode(),query);
        // A later move at a new instant lands on top; the filtered page keeps its own total.
        CLOCK.advance(Duration.ofSeconds(1));var newer=data(uploadHomework(f.learner(),homework(f,f.second()),"Later.java",TEXT,null),201);
        var top=data(get(f.learner().client(),moves(f)+"?size=1"),200);assertEquals(7,top.get("total").asLong());assertEquals(newer.get("id").asText(),top.get("items").get(0).get("refId").asText());assertEquals(1,top.get("items").get(0).get("ordinal").asInt());
        var secondOnly=data(get(f.learner().client(),moves(f)+"?lessonId="+f.second()+"&size=1"),200);assertEquals(2,secondOnly.get("total").asLong());assertEquals("homework",secondOnly.get("items").get(0).get("kind").asText());
        assertEquals("conducted",data(get(f.learner().client(),moves(f)+"?lessonId="+f.second()+"&size=1&page=1"),200).get("items").get(0).get("kind").asText());
    }

    // Catches run attempts or deleted lessons' moves lingering, and a resubmission not renumbering.
    @Test void attemptsAndResubmissionsKeepTheirPlaceInTheJournal()throws Exception {
        var f=fixture("moves-attempts");TrainingCatalog.publish(context,json,temporary,f.teacher().workspace());
        data(write(f.teacher().client(),"PUT",card(f.teacher(),f.student())+"/lessons/"+f.first()+"/practice/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework")))),200);
        String run=attempt(f,f.first(),"run","run-1");CLOCK.advance(Duration.ofSeconds(1));String submit=attempt(f,f.first(),"submit","submit-1");CLOCK.advance(Duration.ofSeconds(1));
        // Both modes are moves of the student; the same key replays the same attempt instead of a second move.
        assertEquals(submit,data(write(f.learner().client(),"POST",card(f.teacher(),f.student())+"/lessons/"+f.first()+"/practice/exercises/list-task/attempts",Map.of("exerciseRevision",1,"mode","submit","files",Map.of("ListTask.java","class ListTask {\n    int x;\n}")),"Idempotency-Key","submit-1"),202).get("id").asText());
        var page=data(get(f.learner().client(),moves(f)),200);assertEquals(2,page.get("total").asLong());assertEquals(List.of(submit,run),refs(page));
        assertEquals("submit",page.get("items").get(0).get("detail").asText());assertEquals("run",page.get("items").get(1).get("detail").asText());
        var first=data(uploadHomework(f.learner(),homework(f,f.first()),"Main.java",TEXT,null),201);CLOCK.advance(Duration.ofSeconds(1));
        data(write(f.teacher().client(),"PATCH",homework(f,f.first())+"/"+first.get("id").asText()+"/review",Map.of("revision",1,"status","needs_revision","feedback","Ещё раз")),200);CLOCK.advance(Duration.ofSeconds(1));
        var again=data(uploadHomework(f.learner(),homework(f,f.first()),"Main.java",TEXT,null),201);
        page=data(get(f.learner().client(),moves(f)+"?lessonId="+f.first()),200);assertEquals(5,page.get("total").asLong());
        assertEquals(List.of("homework","review","homework","attempt","attempt"),kinds(page));
        assertEquals(again.get("id").asText(),page.get("items").get(0).get("refId").asText());assertEquals(2,page.get("items").get(0).get("ordinal").asInt());
        assertEquals("needs_revision",page.get("items").get(1).get("status").asText());assertFalse(page.get("items").get(1).has("grade"));assertEquals(1,page.get("items").get(1).get("ordinal").asInt());
        assertEquals(0,data(get(f.learner().client(),moves(f)+"?lessonId="+f.second()),200).get("total").asLong());
    }
}
