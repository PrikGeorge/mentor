package ru.mentor.platform.support;

import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.identity.IdentityRepository;
import ru.mentor.platform.workspaces.WorkspaceService;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.lessons.LessonService;
import ru.mentor.platform.files.BlobService;
import ru.mentor.platform.materials.MaterialService;
import ru.mentor.platform.shared.Actor;
import tools.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Fixed synthetic dataset. Request accepts only normal-API-created identity IDs. */
final class BrowserMaterialFixture {
    private BrowserMaterialFixture() {}
    static void seed(ConfigurableApplicationContext context, Path request, Path complete) throws Exception {
        ObjectMapper json = context.getBean(ObjectMapper.class);
        Map<?,?> ids = json.readValue(Files.readString(request), Map.class);
        if (!ids.keySet().equals(Set.of("userId", "workspaceId", "studentId", "lessonId"))) throw new IllegalArgumentException("ID-only material fixture request");
        String user = id(ids,"userId"), workspace = id(ids,"workspaceId"), student = id(ids,"studentId"), lesson = id(ids,"lessonId");
        var account = context.getBean(IdentityRepository.class).findById(user).orElseThrow();
        Actor actor = context.getBean(WorkspaceService.class).resolve(account).orElseThrow();
        if (actor.role() != Actor.Role.TEACHER || !workspace.equals(actor.workspaceId())) throw new IllegalArgumentException("Synthetic teacher binding");
        context.getBean(StudentService.class).requireReader(actor, workspace, student);
        var ref = context.getBean(LessonService.class).requireReader(actor, workspace, student, lesson);
        var jdbc = context.getBean(JdbcTemplate.class);
        var tx = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
        var blobs = context.getBean(BlobService.class);
        String bundle = "synthetic-material-bundle";
        tx.executeWithoutResult(status -> {
            jdbc.update("UPDATE lesson SET status='prepared',bundle_id=? WHERE workspace_id=? AND student_id=? AND id=?", bundle,workspace,student,lesson);
            insert(jdbc,workspace,student,lesson,bundle,"guide","teacher","doc","guide","guide.md","text/markdown","Методичка преподавателя", """
                {"title":"Методичка преподавателя","intro":"<p>PRIVATE_GUIDE</p>","raw":"## Синтетическая методичка","html":"","sections":[{"id":"section-0","title":"Подготовка","html":"<details class='explanation-details'><summary>Методическое пояснение</summary><p>PRIVATE_METHOD</p></details>","studentParts":[0,1,9]},{"id":"section-1","title":"Следующая часть","html":"<p>Обсуждение занятия</p>"}]}
                """);
            insert(jdbc,workspace,student,lesson,bundle,"tasks","student","doc","student","tasks.md","text/markdown","Задания ученика", """
                {"title":"Задания ученика","intro":"<p>Публичное вступление</p>","raw":"## Задания","html":"","sections":[{"id":"section-0","title":"Коллекции","html":"<p>Прочитайте исходную заготовку.</p><div><!-- task-code:ListTask:practice --></div><details class='explanation-details'><summary>Пояснение ученику</summary><p>Публичная подсказка</p></details>"},{"id":"section-1","title":"Следующая часть","html":"<p>Сравните результат</p>"}]}
                """);
            insert(jdbc,workspace,student,lesson,bundle,"code","student","code","ListTask","ListTask.java","text/plain","Исходная заготовка", """
                {"text":"package synthetic;\\n    class ListTask {}\\n// end","teacher":false,"materialId":"student-zip","excerpt":{"start":1,"end":2}}
                """);
            insert(jdbc,workspace,student,null,null,"profile","student","doc","goal","profile.md","text/markdown","Цель ученика", """
                {"title":"Цель ученика","intro":"<p>Профильный материал</p>","raw":"Профильный материал","html":"","sections":[]}
                """);
        });
        for (String audience : List.of("student", "teacher")) {
            byte[] bytes = ("synthetic-" + audience + "-bundle-bytes").getBytes(StandardCharsets.UTF_8);
            var staged = blobs.stage(actor, ref, new ByteArrayInputStream(bytes), context.getBean(MaterialService.class).maximumObjectBytes(), (long)bytes.length);
            tx.executeWithoutResult(status -> {
                String filename = "synthetic-" + audience + ".zip";
                var attached = blobs.attach(actor,ref,staged,filename,"application/zip");
                jdbc.update("INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,blob_id) VALUES(?,?,?,?,?,?,'download',? ,?,'application/zip',?,?)", workspace,audience+"-zip",student,lesson,bundle,audience,audience+"-bundle",filename,audience.equals("student")?"Комплект ученика":"Комплект преподавателя",attached.id());
            });
        }
        Files.writeString(complete,json.writeValueAsString(Map.of("status","ready","workspaceId",workspace,"studentId",student,"lessonId",lesson)));
    }
    private static String id(Map<?,?> ids,String key) {
        if (!(ids.get(key) instanceof String value) || !value.matches("[A-Za-z0-9-]{1,80}")) throw new IllegalArgumentException("Synthetic ID required");
        return value;
    }
    private static void insert(JdbcTemplate jdbc,String w,String s,String l,String b,String id,String audience,String kind,String key,String filename,String type,String title,String payload) {
        jdbc.update("INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?::jsonb)",w,id,s,l,b,audience,kind,key,filename,type,title,payload);
    }
}

