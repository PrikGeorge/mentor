package ru.mentor.platform.practice;

import org.junit.jupiter.api.Test;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** T09: a submitted attempt of a homework-placement exercise is the lesson's first work for its deadline; runs and class exercises are not. */
class HomeworkDueAttemptTest extends AttemptHttpTest {
    private static final ZoneId MOSCOW=ZoneId.of("Europe/Moscow");
    private String state(Fixture f)throws Exception{return data(get(f.teacher().client(),card(f.teacher(),f.student())+"/lessons/"+f.lesson()),200).get("homeworkDue").get("state").asText();}
    private void attempt(Fixture f,String exercise,String mode,String key,String file)throws Exception {
        var body=Map.of("exerciseRevision",1,"mode",mode,"files",Map.of(file,"class "+file.replace(".java","")+" {\n    int x;\n}"));
        data(write(f.learner().client(),"POST",f.path()+"/exercises/"+exercise+"/attempts",body,"Idempotency-Key",key),202);
        var lease=claim();assertEquals(204,complete(lease,result(lease,"accepted")).statusCode());
    }

    // Catches a run or a class-placement attempt counting as homework, and a homework submit not counting.
    @Test void onlyASubmittedHomeworkAttemptMeetsTheDeadline()throws Exception {
        var f=fixture("due-attempt");publish(f,source());
        data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",0,"assignments",List.of(Map.of("exerciseId","list-task","placement","homework"),Map.of("exerciseId","grouping-task","placement","class")))),200);
        // The shared test clock may have been moved far ahead by other classes, so the lesson and its deadline follow it.
        var start=CLOCK.instant().minus(Duration.ofHours(1)).truncatedTo(ChronoUnit.MINUTES).atZone(MOSCOW);var due=start.plusDays(2);
        data(write(f.teacher().client(),"PATCH",card(f.teacher(),f.student())+"/lessons/"+f.lesson(),Map.of("revision",1,
            "date",start.toLocalDate().toString(),"time",String.format("%02d:%02d",start.getHour(),start.getMinute()),
            "homeworkDue",Map.of("date",due.toLocalDate().toString(),"time",String.format("%02d:%02d",due.getHour(),due.getMinute())))),200);
        assertEquals("open",state(f));
        attempt(f,"list-task","run","due-run","ListTask.java");attempt(f,"grouping-task","submit","due-class","GroupingTask.java");
        assertEquals("open",state(f));
        attempt(f,"list-task","submit","due-submit","ListTask.java");
        assertEquals("onTime",state(f));
    }
}
