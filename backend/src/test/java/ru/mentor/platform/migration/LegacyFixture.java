package ru.mentor.platform.migration;

import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Entirely synthetic source; opaque payloads are generated here, never copied from live data. */
final class LegacyFixture {
    static final ObjectMapper JSON=new ObjectMapper();
    static Path create(Path root)throws Exception {
        Path resources=Path.of(LegacyFixture.class.getResource("/legacy/golden").toURI());
        try(var files=Files.walk(resources)){
            for(Path p:files.filter(Files::isRegularFile).toList()){
                String name=resources.relativize(p).toString().replace('\\','/');
                String target=name.equals("mentoring.json")?"data/"+name:name.startsWith("auth/")||name.startsWith("practice/")?"data/"+name:name.startsWith("materials/")?"private/"+name:name;
                Path out=root.resolve(target);Files.createDirectories(out.getParent());Files.copy(p,out);
            }
        }
        JsonNode content=JSON.readTree(Files.readString(root.resolve("private/materials/content.json")));
        for(var doc:content.path("docs").properties())write(root,"content/"+doc.getKey()+".md",doc.getValue().path("raw").asText());
        for(var code:content.path("code").properties())write(root,"code/"+code.getKey()+".java",code.getValue().path("text").asText());
        write(root,"private/materials/downloads/ListTask.java",content.path("code").path("ListTask").path("text").asText());
        write(root,"private/materials/downloads/ListSolutions.java",content.path("code").path("ListSolutions").path("text").asText());
        write(root,"data/practice/uploads/10000000-0000-4000-8000-000000000001","Synthetic submission; this is not a real student file.\r\n");
        Path zip=root.resolve("private/materials/downloads/student-fixture.zip");
        try(var stream=new ZipOutputStream(Files.newOutputStream(zip))){var entry=new ZipEntry("pkg/ListTask.java");entry.setTime(0);stream.putNextEntry(entry);stream.write(content.path("code").path("ListTask").path("text").asText().getBytes(StandardCharsets.UTF_8));stream.closeEntry();}
        return root;
    }
    static void write(Path root,String path,String text)throws Exception{Path out=root.resolve(path);Files.createDirectories(out.getParent());Files.writeString(out,text,StandardCharsets.UTF_8);}
    static ObjectNode read(Path root,String path)throws Exception{return (ObjectNode)JSON.readTree(Files.readString(root.resolve(path)));}
    static void save(Path root,String path,JsonNode value)throws Exception{Files.writeString(root.resolve(path),JSON.writeValueAsString(value));}
    static String sha(Path path)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));}
}
