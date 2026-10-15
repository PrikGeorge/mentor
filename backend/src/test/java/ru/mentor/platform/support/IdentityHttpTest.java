package ru.mentor.platform.support;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.junit.jupiter.api.parallel.ResourceLock;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(HttpTestRuntime.Extension.class)
@Execution(ExecutionMode.SAME_THREAD)
@ResourceLock("mentor-http-runtime")
public abstract class IdentityHttpTest {
    protected static final String PASSWORD="synthetic-password-😀";
    protected ConfigurableApplicationContext context;
    protected JdbcTemplate jdbc;
    protected String origin;
    protected final ObjectMapper json=new ObjectMapper();
    protected HttpClient admin;
    HttpTestRuntime runtime;
    protected java.nio.file.Path runtimeRoot;
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
    @BeforeEach void seed() throws Exception {
        runtime.bind(this);
        runtime.reset();
        CLOCK.advance(Duration.ofDays(16));
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) VALUES ('admin','admin',?,'ADMIN')",runtime.passwordHash);
        admin=client(); assertEquals(200,write(admin,"POST","/auth/login",Map.of("login","admin","password",PASSWORD)).statusCode());
    }
    protected void restartContext() throws java.io.IOException {runtime.restart();runtime.bind(this);}
    protected HttpClient client(){return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();}
    protected HttpResponse<String> get(HttpClient c,String path) throws Exception {
        return c.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    protected JsonNode data(HttpResponse<String> r,int status){assertEquals(status,r.statusCode(),r.body());return r.body().isEmpty()?null:json.readTree(r.body());}
    protected JsonNode session(HttpClient c) throws Exception{return data(get(c,"/auth/session"),200);}
    protected HttpResponse<String> write(HttpClient c,String method,String path,Object body) throws Exception {return write(c,method,path,body,new String[0]);}
    /** A JSON write with extra request headers given as name/value pairs, e.g. an Idempotency-Key. */
    protected HttpResponse<String> write(HttpClient c,String method,String path,Object body,String... headers) throws Exception {
        JsonNode s=session(c);
        var b=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-CSRF-TOKEN",s.get("csrfToken").asText());
        if(!Set.of("/auth/login","/auth/register","/auth/reset-password").contains(path)&&!s.get("account").isNull())b.header("X-Mentor-Account",s.get("account").get("userId").asText());
        if(body!=null)b.header("Content-Type","application/json");
        for(int i=0;i<headers.length;i+=2)b.header(headers[i],headers[i+1]);
        return c.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    /** A second browser of an existing account: the same login on a fresh cookie jar. */
    protected HttpClient login(String login) throws Exception {HttpClient c=client();assertEquals(200,write(c,"POST","/auth/login",Map.of("login",login,"password",PASSWORD)).statusCode());return c;}
    protected String lesson(User teacher,String student,String title,String date) throws Exception {
        return data(write(teacher.client(),"POST",card(teacher,student)+"/lessons",Map.of("title",title,"date",date,"time","12:00","duration",60)),201).get("id").asText();
    }
    /** One homework file as the browser sends it: a multipart form with the file and an optional comment; needs an isolated blob runtime. */
    protected HttpResponse<String> uploadHomework(User user,String homeworkPath,String filename,byte[] bytes,String comment) throws Exception {
        String boundary="mentor-synthetic-upload-boundary";var session=session(user.client());var body=new java.io.ByteArrayOutputStream();
        body.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+filename+"\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        body.write(bytes);body.write("\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        if(comment!=null)body.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"comment\"\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"+comment+"\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        body.write(("--"+boundary+"--\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var request=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+homeworkPath)).timeout(Duration.ofSeconds(30)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","multipart/form-data; boundary="+boundary);
        return user.client().send(request.POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(),HttpResponse.BodyHandlers.ofString());
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
