package ru.mentor.platform.support;

import org.springframework.context.ConfigurableApplicationContext;
import ru.mentor.platform.practice.CatalogCommand;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Publishes the repository's trusted exercise catalog into one synthetic workspace with a fabricated environment manifest. */
public final class TrainingCatalog {
    private TrainingCatalog(){}
    public static void publish(ConfigurableApplicationContext context,ObjectMapper json,Path temporary,String workspace)throws Exception {
        Path root=Files.createTempDirectory(temporary,"catalog-");
        for(String file:List.of("catalog.json","environments.json"))Files.copy(Path.of("../training").resolve(file),root.resolve(file));
        try(var paths=Files.walk(Path.of("../training/exercises"))){for(Path p:paths.toList()){Path target=root.resolve("exercises").resolve(Path.of("../training/exercises").relativize(p));if(Files.isDirectory(p))Files.createDirectories(target);else Files.copy(p,target);}}
        var environments=json.createObjectNode();
        for(var profile:json.readTree(root.resolve("environments.json").toFile())){
            var e=environments.putObject(profile.get("id").asText());e.put("id",profile.get("id").asText());e.put("revision","a".repeat(64));e.put("imageDigest","sha256:"+"b".repeat(64));
            var deps=e.putArray("dependencies");for(int i=0;i<profile.get("dependencies").size();i++)deps.add("/opt/mentor/deps/dependency-"+i+".jar");e.set("annotationProcessors",profile.get("annotationProcessors").deepCopy());
        }
        Path manifest=root.resolve("manifest.json");Files.writeString(manifest,json.writeValueAsString(Map.of("environments",environments)),StandardCharsets.UTF_8);
        context.getBean(CatalogCommand.class).run(new String[]{"--source",root.resolve("catalog.json").toString(),"--workspace",workspace,"--environment-manifest",manifest.toString(),"--environment-manifest-sha256",sha(manifest),"--environment-profiles-sha256",sha(root.resolve("environments.json"))});
    }
    private static String sha(Path p)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p)));}
}
