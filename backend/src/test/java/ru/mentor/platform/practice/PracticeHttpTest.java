package ru.mentor.platform.practice;

import ru.mentor.platform.support.IdentityHttpTest;
import java.util.Map;
import java.util.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.*;
import java.net.*;
import java.net.http.*;
import static org.junit.jupiter.api.Assertions.*;

abstract class PracticeHttpTest extends IdentityHttpTest {
    @TempDir Path temporary;
    protected record Source(Path catalog,Path manifest,Path profiles){}
    protected Source source()throws Exception {
        Path root=Files.createTempDirectory(temporary,"catalog-");
        for(String file:List.of("catalog.json","environments.json"))Files.copy(Path.of("../training").resolve(file),root.resolve(file));
        try(var paths=Files.walk(Path.of("../training/exercises"))){for(Path p:paths.toList()){Path target=root.resolve("exercises").resolve(Path.of("../training/exercises").relativize(p));if(Files.isDirectory(p))Files.createDirectories(target);else Files.copy(p,target);}}
        var environments=json.createObjectNode();for(var profile:json.readTree(root.resolve("environments.json").toFile())){
            var e=environments.putObject(profile.get("id").asText());e.put("id",profile.get("id").asText());e.put("revision","a".repeat(64));e.put("imageDigest","sha256:"+"b".repeat(64));var deps=e.putArray("dependencies");for(int i=0;i<profile.get("dependencies").size();i++)deps.add("/opt/mentor/deps/dependency-"+i+".jar");e.set("annotationProcessors",profile.get("annotationProcessors").deepCopy());
        }
        Path manifest=root.resolve("manifest.json");Files.writeString(manifest,json.writeValueAsString(Map.of("environments",environments)),StandardCharsets.UTF_8);
        return new Source(root.resolve("catalog.json"),manifest,root.resolve("environments.json"));
    }
    protected static String sha(Path p)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p)));}
    protected CatalogService.CatalogReport publish(Fixture f,Source s)throws Exception{return context.getBean(CatalogCommand.class).run(new String[]{"--source",s.catalog().toString(),"--workspace",f.teacher().workspace(),"--environment-manifest",s.manifest().toString(),"--environment-manifest-sha256",sha(s.manifest()),"--environment-profiles-sha256",sha(s.profiles())});}
    protected void revision(Source s,Object revision)throws Exception {var records=(ArrayNode)json.readTree(s.catalog().toFile());((ObjectNode)records.get(0)).set("revision",json.valueToTree(revision));Files.writeString(s.catalog(),json.writeValueAsString(records));}
    protected JsonNode assign(Fixture f,long revision,String... ids)throws Exception{return data(write(f.teacher().client(),"PUT",f.path()+"/assignments",Map.of("revision",revision,"assignments",Arrays.stream(ids).map(id->Map.of("exerciseId",id,"placement","class")).toList())),200);}
    protected String draftPath(Fixture f,String id){return f.path()+"/exercises/"+id+"/draft";}
    protected Map<String,Object> save(Object exerciseRevision,long revision,Map<String,String> files){return Map.of("exerciseRevision",exerciseRevision,"revision",revision,"files",files);}
    protected HttpResponse<String> raw(User user,String path,String body,boolean chunked,String type)throws Exception {
        var s=session(user.client());byte[] bytes=body.getBytes(StandardCharsets.UTF_8);var publisher=chunked?HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(bytes)):HttpRequest.BodyPublishers.ofByteArray(bytes);
        return user.client().send(HttpRequest.newBuilder(URI.create(origin+"/api/v1"+path)).header("Origin",origin).header("X-Mentor-Client","web").header("X-Mentor-Account",user.id()).header("X-CSRF-TOKEN",s.get("csrfToken").asText()).header("Content-Type",type).PUT(publisher).build(),HttpResponse.BodyHandlers.ofString());
    }
    protected record Fixture(User teacher,User learner,String student,String lesson,String path){}
    protected Fixture fixture(String login)throws Exception {
        var t=teacher(login);String s=student(t,"Synthetic practice student").get("id").asText();
        var u=enroll(t,s,login+"-student");
        String l=data(write(t.client(),"POST",card(t,s)+"/lessons",Map.of("title","Practice","date","2030-01-01","time","12:00","duration",60)),201).get("id").asText();
        return new Fixture(t,u,s,l,card(t,s)+"/lessons/"+l+"/practice");
    }
}
