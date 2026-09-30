package ru.mentor.platform.support;

import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.identity.PasswordCodec;
import tools.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public abstract class IdentityHttpTest extends PostgresTest {
    protected static final String PASSWORD="synthetic-password-😀";
    protected ConfigurableApplicationContext context;
    protected JdbcTemplate jdbc;
    protected String origin;
    protected final ObjectMapper json=new ObjectMapper();
    protected HttpClient admin;
    protected static final MutableClock CLOCK=new MutableClock();
    public static class MutableClock extends Clock {
        final AtomicReference<Instant> time=new AtomicReference<>(Instant.now());
        public void advance(Duration d){time.updateAndGet(v->v.plus(d));}
        public ZoneId getZone(){return ZoneOffset.UTC;}
        public Clock withZone(ZoneId z){return this;}
        public Instant instant(){return time.get();}
    }
    @TestConfiguration(proxyBeanMethods=false) public static class ClockConfiguration {
        @Bean @Primary Clock testClock(){return CLOCK;}
    }
    private String passwordHash;
    @BeforeAll void start(){
        POSTGRES.start();
        context=new SpringApplicationBuilder(MentorApplication.class,ClockConfiguration.class).run("--server.port=0",
            "--spring.datasource.url="+POSTGRES.getJdbcUrl(),"--spring.datasource.username="+POSTGRES.getUsername(),"--spring.datasource.password="+POSTGRES.getPassword());
        origin="http://localhost:"+((WebServerApplicationContext)context).getWebServer().getPort();
        jdbc=context.getBean(JdbcTemplate.class); passwordHash=context.getBean(PasswordCodec.class).encode(PASSWORD);
    }
    @BeforeEach void seed() throws Exception {
        CLOCK.advance(Duration.ofDays(16));
        jdbc.execute("TRUNCATE identity_account, SPRING_SESSION CASCADE");
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) VALUES ('admin','admin',?,'ADMIN')",passwordHash);
        admin=client(); assertEquals(200,write(admin,"POST","/auth/login",Map.of("login","admin","password",PASSWORD)).statusCode());
    }
    @AfterAll void stop(){if(context!=null)context.close();POSTGRES.stop();}
    protected HttpClient client(){return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();}
    protected HttpResponse<String> get(HttpClient c,String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    protected JsonNode data(HttpResponse<String> r,int status){assertEquals(status,r.statusCode(),r.body());return r.body().isEmpty()?null:json.readTree(r.body());}
    protected JsonNode session(HttpClient c) throws Exception{return data(get(c,"/auth/session"),200);}
    protected HttpResponse<String> write(HttpClient c,String method,String path,Object body) throws Exception {
        JsonNode s=session(c);
        var b=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-CSRF-TOKEN",s.get("csrfToken").asText());
        if(!Set.of("/auth/login","/auth/register","/auth/reset-password").contains(path)&&!s.get("account").isNull())b.header("X-Mentor-Account",s.get("account").get("userId").asText());
        if(body!=null)b.header("Content-Type","application/json");
        return c.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    protected String token(JsonNode issue){return URI.create(issue.get("link").asText()).getRawQuery().substring("token=".length());}
    protected record User(HttpClient client,String id,String workspace){}
    protected User teacher(String login) throws Exception {
        String token=token(data(write(admin,"POST","/admin/teacher-invitations",Map.of()),200));
        HttpClient c=client(); JsonNode a=data(write(c,"POST","/auth/register",Map.of("token",token,"login",login,"password",PASSWORD)),200).get("account");
        assertEquals("TEACHER",a.get("role").asText());return new User(c,a.get("userId").asText(),a.get("workspaceId").asText());
    }
    protected String students(User t){return "/workspaces/"+t.workspace()+"/students";}
    protected String card(User t,String id){return students(t)+"/"+id;}
    protected JsonNode student(User t,String name) throws Exception{return data(write(t.client(),"POST",students(t),Map.of("name",name,"notes","private-teacher-note")),201);}
    protected User enroll(User t,String id,String login) throws Exception {
        var issue=data(write(t.client(),"POST",card(t,id)+"/invitations",Map.of()),200);
        HttpClient c=client(); var a=data(write(c,"POST","/auth/register",Map.of("token",token(issue),"login",login,"password",PASSWORD)),200).get("account");
        return new User(c,a.get("userId").asText(),a.get("workspaceId").asText());
    }
}
