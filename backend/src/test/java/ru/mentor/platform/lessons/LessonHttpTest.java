package ru.mentor.platform.lessons;

import ru.mentor.platform.support.IdentityHttpTest;
import tools.jackson.databind.JsonNode;
import java.util.Map;

abstract class LessonHttpTest extends IdentityHttpTest {
    protected record Fixture(User teacher,String student,String path){}
    protected Fixture fixture(String login) throws Exception {var t=teacher(login);var s=student(t,"Synthetic lesson student");String id=s.get("id").asText();return new Fixture(t,id,card(t,id));}
    protected JsonNode lesson(Fixture f,String title,String date,String time,int duration) throws Exception {return data(write(f.teacher().client(),"POST",f.path()+"/lessons",Map.of("title",title,"date",date,"time",time,"duration",duration)),201);}
    protected String lessonPath(Fixture f,JsonNode lesson){return f.path()+"/lessons/"+lesson.get("id").asText();}
}
