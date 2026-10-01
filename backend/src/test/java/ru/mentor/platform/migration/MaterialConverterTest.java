package ru.mentor.platform.migration;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class MaterialConverterTest {
    @TempDir Path temporary;
    Path fixture()throws Exception{return LegacyFixture.create(Files.createDirectory(temporary.resolve(UUID.randomUUID().toString())));}
    ArrayNode answersResource(ObjectNode content){
        var tuple=LegacyFixture.JSON.createArrayNode().add("answers").add("  Synthetic answers  ").add("Original description\r\n").add("Teacher only");
        ((ArrayNode)content.path("viewData").path("teacher").get("resources")).add(tuple);return tuple;
    }
    List<MaterialConverter.Material> convert(Path root,ObjectNode manifest,ObjectNode content)throws Exception{return new MaterialConverter().convert(root,manifest,content,LegacyFixture.read(root,"data/mentoring.json"),"synthetic-workspace",67108864);}
    void secondAnswer(ObjectNode content,ObjectNode manifest,String lesson){
        var extraCode=((ObjectNode)content.path("code").get("ListSolutions")).deepCopy().put("materialId","second-teacher-download");((ObjectNode)content.get("code")).set("SecondSolutions",extraCode);
        var entries=(ArrayNode)manifest.get("materials");var extraCodeBinding=((ObjectNode)entries.get(7)).deepCopy().put("id","code-SecondSolutions").put("key","SecondSolutions").put("lessonId",lesson);var extraDownload=((ObjectNode)entries.get(8)).deepCopy().put("id","second-teacher-download").put("lessonId",lesson);entries.add(extraCodeBinding).add(extraDownload);
        ((ArrayNode)content.path("viewData").path("teacher").get("answersCards")).addArray().add("SecondSolutions").add("Other answer").add("Teacher only");
    }

    @Test void virtualAnswersResourceUsesReferencedTeacherCardsAndPreservesViewPayload()throws Exception{
        Path root=fixture();var content=LegacyFixture.read(root,"private/materials/content.json");var manifest=LegacyFixture.read(root,"private/materials/manifest.json");var tuple=answersResource(content);var teacher=content.path("viewData").path("teacher");
        secondAnswer(content,manifest,"lesson-2026-09-27");
        var converted=convert(root,manifest,content);var view=converted.stream().filter(m->m.kind().equals("view")&&m.audience().equals("teacher")&&m.payload().has("answersCards")).findFirst().orElseThrow();
        assertEquals("michael",view.student());assertEquals("lesson-2026-09-27",view.lesson());assertEquals("library-2026-09-27",view.bundle());
        assertEquals(teacher.get("answersCards"),view.payload().get("answersCards"));assertEquals(teacher.get("lessonHtml"),view.payload().get("lessonHtml"));assertTrue(java.util.stream.StreamSupport.stream(view.payload().get("resources").spliterator(),false).anyMatch(tuple::equals));
        for(String field:List.of("profileFacts","reviewHtml"))assertEquals(teacher.get(field),converted.stream().filter(m->m.payload()!=null&&m.payload().has(field)).findFirst().orElseThrow().payload().get(field));
        assertFalse(converted.stream().anyMatch(m->m.audience().equals("student")&&m.payload()!=null&&m.payload().toString().contains("Synthetic answers")));
    }
    @Test void virtualAnswersResourceRejectsMissingAndAmbiguousCardOwners()throws Exception{
        for(boolean mixed:List.of(false,true)){
            Path root=fixture();var content=LegacyFixture.read(root,"private/materials/content.json");var manifest=LegacyFixture.read(root,"private/materials/manifest.json");answersResource(content);var teacher=(ObjectNode)content.path("viewData").path("teacher");
            if(!mixed)teacher.remove("answersCards");
            else secondAnswer(content,manifest,"lesson-history");
            var failure=assertThrows(IllegalArgumentException.class,()->convert(root,manifest,content));assertEquals("Cannot establish teacher answers resource ownership.",failure.getMessage());
        }
    }
}
