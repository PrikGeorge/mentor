package ru.mentor.platform.migration;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LegacyReaderTest {
    @TempDir Path temporary;
    Path fixture()throws Exception{return LegacyFixture.create(Files.createDirectory(temporary.resolve(UUID.randomUUID().toString())));}
    LegacyReader.Plan inspect(Path root)throws Exception{return new LegacyReader(67108864).read(root,root.resolve("operator-approval.json"),LegacyFixture.sha(root.resolve("operator-approval.json")),LegacyFixture.sha(root.resolve("training/environments.json")));}
    @Test void rejectsTraversalDuplicateJsonInvalidUnicodeDateTimestampAndActiveMissingDefinition()throws Exception{
        Path traversal=fixture();var manifest=LegacyFixture.read(traversal,"private/materials/manifest.json");((ObjectNode)manifest.path("materials").get(6)).put("file","../outside.java");LegacyFixture.save(traversal,"private/materials/manifest.json",manifest);assertThrows(Exception.class,()->inspect(traversal));
        Path duplicate=fixture();Path json=duplicate.resolve("data/mentoring.json");Files.writeString(json,Files.readString(json).replaceFirst("\"version\": 1","\"version\": 1, \"version\": 1"));assertThrows(Exception.class,()->inspect(duplicate));
        Path unicode=fixture();Path unicodeFile=unicode.resolve("data/mentoring.json");Files.writeString(unicodeFile,Files.readString(unicodeFile).replace("  Synthetic learner  ","\\uD800"));assertThrows(Exception.class,()->inspect(unicode));
        Path date=fixture();var dates=LegacyFixture.read(date,"data/mentoring.json");((ObjectNode)dates.path("lessons").get(0)).put("date","2026-02-30");LegacyFixture.save(date,"data/mentoring.json",dates);assertThrows(Exception.class,()->inspect(date));
        Path time=fixture();var times=LegacyFixture.read(time,"data/mentoring.json");((ObjectNode)times.path("lessons").get(0)).put("createdAt","2026-09-20T21:05:00.000001Z");LegacyFixture.save(time,"data/mentoring.json",times);assertThrows(Exception.class,()->inspect(time));
        Path active=fixture();var practice=LegacyFixture.read(active,"data/practice/state.json");((ObjectNode)practice.path("lessons").get(1).path("assignments").get(0)).put("exerciseId","retired-task");LegacyFixture.save(active,"data/practice/state.json",practice);assertThrows(Exception.class,()->inspect(active));
    }
    @Test void rejectsActualFilesystemLinkWithoutReadingEscapedSource()throws Exception{
        Path root=fixture(),outside=Files.createDirectory(temporary.resolve("outside")),link=root.resolve("private/materials/escape");Files.writeString(outside.resolve("marker.txt"),"Synthetic outside marker");
        if(System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win")){
            Process process=new ProcessBuilder("cmd.exe","/c","mklink","/J",link.toString(),outside.toString()).redirectErrorStream(true).start();String output=new String(process.getInputStream().readAllBytes());assertEquals(0,process.waitFor(),output);
        }else Files.createSymbolicLink(link,outside);
        assertThrows(Exception.class,()->inspect(root));assertEquals("Synthetic outside marker",Files.readString(outside.resolve("marker.txt")));
        Files.delete(link); // Remove only the synthetic link before recursive TempDir cleanup.
    }
    @Test void approvalHashAndTeacherViewBindingFailClosed()throws Exception{
        Path root=fixture();assertThrows(Exception.class,()->new LegacyReader(67108864).read(root,root.resolve("operator-approval.json"),"0".repeat(64),LegacyFixture.sha(root.resolve("training/environments.json"))));
        var content=LegacyFixture.read(root,"private/materials/content.json");((ObjectNode)content.path("viewData").path("teacher")).put("profileFacts","<a href=\"#profile\">One</a><a href=\"#guide\">Different binding</a>");LegacyFixture.save(root,"private/materials/content.json",content);assertThrows(Exception.class,()->inspect(root));
    }
    @Test void sourceDigestUsesFrozenEntryArrayAndDistinguishedAbsentMarker()throws Exception{
        Path root=fixture();Files.delete(root.resolve("data/practice/state.json"));var expected=LegacyFixture.JSON.createArrayNode();expected.addArray().add("@optional/data/practice/state.json").add("absent");
        try(var files=Files.walk(root)){for(var p:files.filter(Files::isRegularFile).sorted(Comparator.comparing(path->root.relativize(path).toString().replace('\\','/'))).toList())expected.addArray().add(root.relativize(p).toString().replace('\\','/')).add(Files.size(p)).add(LegacyFixture.sha(p));}
        assertEquals(LegacyReader.sha(LegacyFixture.JSON.writeValueAsBytes(expected)),inspect(root).digest());
    }
    @Test void legacyWhitespaceValidationUsesEcmaTrimWithoutChangingRawValue()throws Exception{
        Path root=fixture();var mentoring=LegacyFixture.read(root,"data/mentoring.json");String raw="\u00A0".repeat(130)+"X"+"\uFEFF".repeat(130);((ObjectNode)mentoring.path("students").get(0)).put("name",raw);LegacyFixture.save(root,"data/mentoring.json",mentoring);
        assertEquals(raw,inspect(root).mentoring().path("students").get(0).path("name").asText());
    }
}
