package ru.mentor.platform.practice;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.core.env.MapPropertySource;
import java.nio.file.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import tools.jackson.databind.JsonNode;

/** Isolated real HTTP job client; credentials remain only in temporary synthetic files. */
abstract class AttemptHttpTest extends PracticeHttpTest {
    protected Path credential;protected final String workerSecret="synthetic-worker-only-credential";
    protected final HttpClient worker=HttpClient.newHttpClient();
    @BeforeEach void workerCredential()throws Exception {
        credential=temporary.resolve("worker-secret");Files.writeString(credential,workerSecret);
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("synthetic-runner",Map.of("mentor.runner.token-file",credential.toString())));
    }
    protected String attempts(Fixture f){return f.path()+"/exercises/list-task/attempts";}
    protected Map<String,Object> code(String content){return Map.of("exerciseRevision",1,"mode","run","files",Map.of("ListTask.java",content));}
    protected HttpResponse<String> enqueue(Fixture f,String key,Object body)throws Exception {
        return submit(f,key,json.writeValueAsBytes(body),false,"application/json");
    }
    protected HttpResponse<String> submit(Fixture f,String key,byte[] body,boolean chunked,String type,String... headers)throws Exception {
        var session=session(f.learner().client());
        var b=HttpRequest.newBuilder(URI.create(origin+"/api/v1"+attempts(f))).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",f.learner().id()).header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type",type);
        if(key!=null)b.header("Idempotency-Key",key);
        for(int i=0;i<headers.length;i+=2)b.header(headers[i],headers[i+1]);
        return f.learner().client().send(b.POST(chunked?HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(body)):HttpRequest.BodyPublishers.ofByteArray(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    protected HttpResponse<String> internal(String route,Object body,String bearer,String... browserHeader)throws Exception {
        var b=HttpRequest.newBuilder(URI.create(origin+"/internal/v1/jobs"+route)).header("Content-Type","application/json");
        if(bearer!=null)b.header("Authorization","Bearer "+bearer);
        for(int i=0;i<browserHeader.length;i+=2)b.header(browserHeader[i],browserHeader[i+1]);
        return worker.send(b.POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    protected JsonNode claim()throws Exception{return data(internal("/claim",Map.of("workerId","synthetic-worker"),workerSecret),200);}
    protected JsonNode result(JsonNode lease,String status){
        var result=json.createObjectNode();result.put("status",status);result.put("passed",status.equals("accepted")?lease.get("payload").get("exercise").get("tests").size():0);result.put("total",status.equals("error")||status.equals("unavailable")?0:lease.get("payload").get("exercise").get("tests").size());result.put("elapsedMs",5);
        var tests=result.putArray("tests");if(status.equals("accepted"))for(var selected:lease.get("payload").get("exercise").get("tests")){var t=tests.addObject();t.put("name",selected.get("name").asText());t.put("status","accepted");t.set("expected",selected.get("expected"));t.set("actual",selected.get("expected"));}
        return result;
    }
    protected HttpResponse<String> complete(JsonNode lease,Object result)throws Exception{return internal("/"+lease.get("jobId").asText()+"/complete",Map.of("leaseToken",lease.get("leaseToken").asText(),"result",result),workerSecret);}
    protected HttpResponse<String> heartbeat(JsonNode lease)throws Exception{return internal("/"+lease.get("jobId").asText()+"/heartbeat",Map.of("leaseToken",lease.get("leaseToken").asText()),workerSecret);}
    protected void restart() throws java.io.IOException {restartContext();}
}
