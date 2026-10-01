package ru.mentor.platform.migration;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Value;
import ru.mentor.platform.files.*;
import org.springframework.jdbc.core.JdbcTemplate;
import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.identity.PasswordCodec;
import ru.mentor.platform.support.PostgresTest;
import tools.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.net.*;
import java.net.http.*;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LegacyImportTest extends PostgresTest {
    static final AtomicReference<Consumer<String>> EVENTS=new AtomicReference<>(name->{});
    static final AtomicBoolean LOST_COMMIT_REPLY=new AtomicBoolean();
    static final class FaultDataSource extends org.springframework.jdbc.datasource.AbstractDataSource implements AutoCloseable {
        final com.zaxxer.hikari.HikariDataSource pool=new com.zaxxer.hikari.HikariDataSource();
        FaultDataSource(org.springframework.core.env.Environment environment){pool.setJdbcUrl(environment.getRequiredProperty("spring.datasource.url"));pool.setUsername(environment.getRequiredProperty("spring.datasource.username"));pool.setPassword(environment.getRequiredProperty("spring.datasource.password"));}
        public Connection getConnection()throws SQLException{
            Connection actual=pool.getConnection();return (Connection)java.lang.reflect.Proxy.newProxyInstance(Connection.class.getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
                try{Object result=method.invoke(actual,args);if(method.getName().equals("commit")&&LOST_COMMIT_REPLY.compareAndSet(true,false))throw new SQLException("Synthetic lost COMMIT response after PostgreSQL committed","08006");return result;}catch(java.lang.reflect.InvocationTargetException error){throw error.getCause();}
            });
        }
        public Connection getConnection(String user,String password)throws SQLException{return getConnection();}
        public void close(){pool.close();}
    }
    @TestConfiguration(proxyBeanMethods=false) static class Faults {
        @Bean javax.sql.DataSource faultDataSource(org.springframework.core.env.Environment environment){return new FaultDataSource(environment);}
        @Bean LegacyImportService.Checkpoint checkpoint(){return name->EVENTS.get().accept(name);}
        @Bean @Primary BlobStore faultStore(@Value("${mentor.blobs.local-root}") String directory){
            var local=new LocalBlobStore(Path.of(directory));return new BlobStore(){
                public StagedBlob stage(java.io.InputStream input,long max)throws java.io.IOException{return stage(UUID.randomUUID().toString(),input,max);}
                public StagedBlob stage(String key,java.io.InputStream input,long max)throws java.io.IOException{EVENTS.get().accept("stream-started");return local.stage(key,input,max);}
                public java.io.InputStream open(String key)throws java.io.IOException{return local.open(key);}
                public void delete(String key)throws java.io.IOException{local.delete(key);}
            };
        }
    }
    @TempDir Path temporary;
    Path source,objects;
    ConfigurableApplicationContext context;
    JdbcTemplate jdbc;
    LegacyImportService importer;
    @BeforeAll void database(){POSTGRES.start();}
    @AfterAll void databaseStop(){POSTGRES.stop();}
    @BeforeEach void fixture()throws Exception{
        EVENTS.set(name->{});
        LOST_COMMIT_REPLY.set(false);
        try(var c=DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());var s=c.createStatement()){s.execute("DROP SCHEMA public CASCADE");s.execute("CREATE SCHEMA public");}
        source=LegacyFixture.create(Files.createDirectory(temporary.resolve(UUID.randomUUID().toString())));objects=temporary.resolve(UUID.randomUUID().toString());
    }
    void start()throws Exception{
        context=new SpringApplicationBuilder(MentorApplication.class,Faults.class).web(WebApplicationType.NONE).run(
            "--spring.datasource.url="+POSTGRES.getJdbcUrl(),"--spring.datasource.username="+POSTGRES.getUsername(),"--spring.datasource.password="+POSTGRES.getPassword(),
            "--mentor.offline-import=true","--mentor.blobs.local-root="+objects,"--mentor.blobs.cleanup-enabled=false","--mentor.import.teacher-id=account-fixture-teacher",
            "--mentor.practice.environment-manifest="+source.resolve("operator-approval.json"),"--mentor.practice.environment-manifest-sha256="+LegacyFixture.sha(source.resolve("operator-approval.json")),
            "--mentor.practice.environment-profiles-sha256="+LegacyFixture.sha(source.resolve("training/environments.json")));
        jdbc=context.getBean(JdbcTemplate.class);importer=context.getBean(LegacyImportService.class);
    }
    @AfterEach void stop(){if(context!=null){context.close();context=null;}}
    int count(String table){return jdbc.queryForObject("SELECT count(*) FROM "+table,Integer.class);}

    @Test void preservesGoldenSnapshot()throws Exception{
        start();var dry=importer.inspect(source,"golden");assertTrue(dry.errors().isEmpty(),dry.errors().toString());
        assertFalse(dry.completed());assertEquals(0,count("identity_account"));assertEquals(0,count("import_run"));assertEquals(0,count("blob_reservation"));
        var first=importer.apply(source,"golden","legacy-workspace");assertTrue(first.errors().isEmpty(),first.errors().toString());assertTrue(first.completed());
        var second=importer.apply(source,"golden","legacy-workspace");assertTrue(second.completed());assertEquals(first.counts(),second.counts());assertEquals(first.checksums(),second.checksums());
        assertEquals(2,count("identity_account"));assertEquals(2,count("student_profile"));assertEquals(4,count("lesson"));assertEquals(0,count("practice_job"));assertEquals(0,count("SPRING_SESSION"));
        var mentoring=LegacyFixture.read(source,"data/mentoring.json");
        assertEquals(mentoring.path("students").get(0).path("goal").asText(),jdbc.queryForObject("SELECT goal FROM student_profile WHERE id='michael'",String.class));
        assertEquals(mentoring.path("students").get(0).path("studentReview").asText(),jdbc.queryForObject("SELECT student_review FROM student_profile WHERE id='michael'",String.class));
        assertEquals("00:05",jdbc.queryForObject("SELECT local_time FROM lesson WHERE id='lesson-midnight'",String.class));assertEquals("Europe/Moscow",jdbc.queryForObject("SELECT time_zone FROM lesson WHERE id='lesson-midnight'",String.class));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM practice_assignment WHERE lesson_id='lesson-2026-09-27' AND active",Integer.class));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_assignment WHERE lesson_id='lesson-explicit-empty'",Integer.class));
        assertEquals("number",jdbc.queryForObject("SELECT jsonb_typeof(exercise_revision) FROM practice_draft",String.class));assertEquals("string",jdbc.queryForObject("SELECT jsonb_typeof(exercise_revision) FROM practice_draft_archive WHERE exercise_revision='\"1\"'::jsonb",String.class));
        assertEquals(2,count("practice_draft_archive"));assertEquals(2,count("practice_attempt"));assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM practice_attempt WHERE environment_revision IS NOT NULL",Integer.class));
        assertEquals("  synthetic-notes.txt  ",jdbc.queryForObject("SELECT filename FROM homework_submission",String.class));
        String hash=jdbc.queryForObject("SELECT password_hash FROM identity_account WHERE id='account-fixture-teacher'",String.class);assertTrue(context.getBean(PasswordCodec.class).matches("  Synthetic fixture 😀  ",hash));
        assertEquals(7,jdbc.queryForObject("SELECT auth_version FROM identity_account WHERE id='account-fixture-teacher'",Integer.class));
        assertEquals(0,count("identity_invitation"));assertEquals(0,count("identity_password_reset"));assertEquals(2,count("import_revoked_link"));
        assertEquals(11,jdbc.queryForObject("SELECT count(*) FROM material WHERE id NOT LIKE 'import-view-%'",Integer.class));
        String payload=jdbc.queryForObject("SELECT payload::text FROM material WHERE id='doc-student'",String.class);assertTrue(payload.contains("/api/v1/workspaces/legacy-workspace/materials/student-fixture-download/file"));assertTrue(payload.contains("explanation-details"));assertTrue(payload.contains("task-code:"));
        for(var row:jdbc.queryForList("SELECT b.sha256,r.object_key FROM stored_blob b JOIN blob_reservation r ON r.id=b.reservation_id"))assertEquals(row.get("sha256"),LegacyFixture.sha(objects.resolve(row.get("object_key").toString())));
        assertEquals(first.sourceDigest(),jdbc.queryForObject("SELECT source_digest FROM import_run",String.class));try(var sourceFiles=Files.walk(source)){assertEquals(sourceFiles.filter(Files::isRegularFile).count(),count("import_source_file"));}
    }

    @Test void durableSourceLedgerTamperRejectsCompletedReplay()throws Exception{
        start();assertTrue(importer.apply(source,"ledger","legacy-workspace").completed());
        jdbc.update("UPDATE import_source_file SET sha256=repeat('0',64) WHERE path='content/student.md'");
        assertFalse(importer.apply(source,"ledger","legacy-workspace").completed(),"Replay must verify the durable source ledger, not only imported domain rows");
    }
    @Test void partialBlobAttachmentResumesAndIncompleteRunRefusesWebStartup()throws Exception{
        start();EVENTS.set(name->{if(name.equals("blob-attached"))throw new IllegalStateException("synthetic crash");});
        assertFalse(importer.apply(source,"resume","legacy-workspace").completed());assertEquals(1,count("stored_blob"));assertEquals("applying",jdbc.queryForObject("SELECT state FROM import_run",String.class));
        String objectKey=jdbc.queryForObject("SELECT object_key FROM blob_reservation WHERE state='ATTACHED'",String.class);
        stop();assertThrows(Exception.class,()->new SpringApplicationBuilder(MentorApplication.class).run("--server.port=0","--spring.datasource.url="+POSTGRES.getJdbcUrl(),"--spring.datasource.username="+POSTGRES.getUsername(),"--spring.datasource.password="+POSTGRES.getPassword(),"--mentor.blobs.local-root="+objects,"--mentor.blobs.cleanup-enabled=false"));
        EVENTS.set(name->{});start();var resumed=importer.apply(source,"resume","legacy-workspace");assertTrue(resumed.completed(),resumed.errors().toString());assertTrue(Files.isRegularFile(objects.resolve(objectKey)));assertEquals(4,count("stored_blob"));
    }
    @Test void finalizedCommitWithLostResponseIsResolvedByReadOnlyReplay()throws Exception{
        start();EVENTS.set(name->{if(name.equals("before-finalize-commit"))LOST_COMMIT_REPLY.set(true);});
        assertFalse(importer.apply(source,"unknown-outcome","legacy-workspace").completed());assertEquals("completed",jdbc.queryForObject("SELECT state FROM import_run",String.class));int reservations=count("blob_reservation");
        stop();EVENTS.set(name->{});start();assertTrue(importer.apply(source,"unknown-outcome","legacy-workspace").completed());assertEquals(reservations,count("blob_reservation"));
    }
    @Test void killedActualFinalizationConnectionCannotReportSuccessAndCanResume()throws Exception{
        start();EVENTS.set(name->{if(name.equals("before-finalize-commit")){
            int pid=jdbc.queryForObject("SELECT pg_backend_pid()",Integer.class);
            try(var c=DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());var s=c.createStatement()){s.execute("SELECT pg_terminate_backend("+pid+")");}catch(Exception e){throw new RuntimeException(e);}
        }});
        assertFalse(importer.apply(source,"lost-connection","legacy-workspace").completed());stop();EVENTS.set(name->{});start();assertEquals("applying",jdbc.queryForObject("SELECT state FROM import_run",String.class));
        var resumed=importer.apply(source,"lost-connection","legacy-workspace");assertTrue(resumed.completed(),resumed.errors().toString());
    }
    @Test void disabledTeacherAndUnknownHistoricalAuthorDoNotNeedEnabledIdentity()throws Exception{
        var auth=LegacyFixture.read(source,"data/auth/accounts.json");((tools.jackson.databind.node.ObjectNode)auth.path("accounts").get(0)).put("disabled",true);LegacyFixture.save(source,"data/auth/accounts.json",auth);
        var practice=LegacyFixture.read(source,"data/practice/state.json");((tools.jackson.databind.node.ObjectNode)practice.path("lessons").get(1).path("submissions").get(0)).remove("reviewedAt");
        var mentoring=LegacyFixture.read(source,"data/mentoring.json");var oldLesson=((tools.jackson.databind.node.ObjectNode)mentoring.path("lessons").get(2)).deepCopy();oldLesson.put("id","without-login").put("studentId","fixture-second");((tools.jackson.databind.node.ArrayNode)mentoring.get("lessons")).add(oldLesson);LegacyFixture.save(source,"data/mentoring.json",mentoring);
        var row=LegacyFixture.JSON.createObjectNode().put("studentId","fixture-second").put("lessonId","without-login");for(String key:List.of("assignments","drafts","draftArchives","submissions"))row.putArray(key);var attempt=((tools.jackson.databind.node.ObjectNode)practice.path("lessons").get(1).path("attempts").get(1)).deepCopy();attempt.put("id","without-author");row.putArray("attempts").add(attempt);((tools.jackson.databind.node.ArrayNode)practice.get("lessons")).add(row);LegacyFixture.save(source,"data/practice/state.json",practice);
        start();var imported=importer.apply(source,"disabled","legacy-workspace");assertTrue(imported.completed(),imported.errors().toString());assertTrue(jdbc.queryForObject("SELECT disabled FROM identity_account WHERE role='TEACHER'",Boolean.class));assertNull(jdbc.queryForObject("SELECT account_id FROM practice_attempt WHERE id='without-author'",String.class));assertNull(jdbc.queryForObject("SELECT reviewed_at FROM homework_submission",Timestamp.class));
        assertThrows(Exception.class,()->jdbc.update("UPDATE homework_submission SET historical_import_id=NULL"));
        assertThrows(Exception.class,()->jdbc.update("INSERT INTO practice_attempt(workspace_id,id,assignment_id,account_id,exercise_id,exercise_revision,environment_revision,mode,files,created_at,job_state,result) SELECT workspace_id,'invalid-online',assignment_id,NULL,exercise_id,exercise_revision,'online-env',mode,files,created_at,job_state,result FROM practice_attempt LIMIT 1"));
        assertEquals(0,count("practice_job"));
    }
    @Test void absentPracticeAndExplicitEmptyAssignmentsRemainDifferent()throws Exception{
        start();var initial=importer.inspect(source,"absence");assertEquals(5L,initial.counts().get("assignments"));
        Files.delete(source.resolve("data/practice/state.json"));var absent=importer.inspect(source,"absence");assertTrue(absent.errors().isEmpty());assertEquals(2L,absent.counts().get("assignments"));assertNotEquals(initial.sourceDigest(),absent.sourceDigest());
        var mentoring=LegacyFixture.read(source,"data/mentoring.json");((tools.jackson.databind.node.ObjectNode)mentoring.path("lessons").get(0)).put("status","planned");LegacyFixture.save(source,"data/mentoring.json",mentoring);assertEquals(0L,importer.inspect(source,"absence").counts().get("assignments"));
    }
    @Test void changedSourceIdOrCorruptBlobNeverWritesImportRun()throws Exception{
        start();Files.writeString(source.resolve("data/practice/uploads/10000000-0000-4000-8000-000000000001"),"broken");var broken=importer.apply(source,"bad","legacy-workspace");assertFalse(broken.completed());assertFalse(broken.errors().isEmpty());assertEquals(0,count("import_run"));assertEquals(0,count("identity_account"));assertEquals(0,count("blob_reservation"));
    }
    @Test void changedDigestAndTargetCannotReuseCompletedImportIdentity()throws Exception{
        start();assertTrue(importer.apply(source,"fixed-source","legacy-workspace").completed());int before=count("stored_blob");
        assertFalse(importer.apply(source,"fixed-source","different-workspace").completed());
        var mentoring=LegacyFixture.read(source,"data/mentoring.json");((tools.jackson.databind.node.ObjectNode)mentoring.path("students").get(0)).put("goal","changed source");LegacyFixture.save(source,"data/mentoring.json",mentoring);
        assertFalse(importer.apply(source,"fixed-source","legacy-workspace").completed());assertEquals(before,count("stored_blob"));assertNotEquals("changed source",jdbc.queryForObject("SELECT goal FROM student_profile WHERE id='michael'",String.class));
    }
    @Test void sourceValidWhitespaceWidthsAndYearZeroRemainExact()throws Exception{
        var mentoring=LegacyFixture.read(source,"data/mentoring.json");String name=" ".repeat(130)+"Synthetic",title="Synthetic"+" ".repeat(220),markdown="😀".repeat(100000);
        ((tools.jackson.databind.node.ObjectNode)mentoring.path("students").get(0)).put("name",name);((tools.jackson.databind.node.ObjectNode)mentoring.path("lessons").get(0)).put("title",title).put("date","0000-02-29").put("teacherNotes",markdown);LegacyFixture.save(source,"data/mentoring.json",mentoring);
        start();var report=importer.apply(source,"raw","legacy-workspace");assertTrue(report.completed(),report.errors().toString());assertEquals(name,jdbc.queryForObject("SELECT name FROM student_profile WHERE id='michael'",String.class));assertEquals(title,jdbc.queryForObject("SELECT title FROM lesson WHERE id='lesson-2026-09-27'",String.class));assertEquals("0000-02-29",jdbc.queryForObject("SELECT local_date FROM lesson WHERE id='lesson-2026-09-27'",String.class));assertEquals(markdown,jdbc.queryForObject("SELECT markdown FROM lesson_text WHERE lesson_id='lesson-2026-09-27' AND kind='teacherNotes'",String.class));assertEquals("",jdbc.queryForObject("SELECT markdown FROM lesson_text WHERE lesson_id='lesson-midnight' AND kind='reviewNotes'",String.class));
    }
    @Test void importedPublicRuntimePreservesOwnershipProjectionAndHistory()throws Exception{
        var auth=LegacyFixture.read(source,"data/auth/accounts.json");var now=java.time.Instant.now().minusSeconds(60);var format=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();
        for(String kind:List.of("invitations","resets")){var link=(ObjectNode)auth.path(kind).get(0);link.put("createdAt",format.format(now)).put("expiresAt",format.format(now.plusSeconds(kind.equals("invitations")?72*3600:1800)));}
        LegacyFixture.save(source,"data/auth/accounts.json",auth);
        start();assertTrue(importer.apply(source,"http","legacy-workspace").completed());
        jdbc.update("INSERT INTO identity_account(id,login,password_hash,role) SELECT 'synthetic-admin','synthetic.admin',password_hash,'ADMIN' FROM identity_account WHERE role='TEACHER'");
        stop();String origin=startWeb();HttpClient student=login(origin,"fixture.student",200),teacher=login(origin,"fixture.teacher",200),admin=login(origin,"synthetic.admin",200);
        String root="/api/v1/workspaces/legacy-workspace",file=root+"/materials/student-fixture-download/file";
        var downloaded=request(student,origin,file,"GET");assertEquals(200,downloaded.statusCode());assertArrayEquals(Files.readAllBytes(source.resolve("private/materials/downloads/ListTask.java")),downloaded.body());
        assertEquals(200,request(teacher,origin,root+"/materials/teacher-fixture-download/file","GET").statusCode());
        for(String method:List.of("GET","HEAD")){
            var hidden=request(student,origin,root+"/materials/teacher-fixture-download/file",method);assertEquals(404,hidden.statusCode());assertFalse(new String(hidden.body()).contains("SYNTHETIC_TEACHER_ONLY"));
            assertEquals(404,request(admin,origin,file,method).statusCode());assertNotEquals(200,request(HttpClient.newHttpClient(),origin,file,method).statusCode());
        }
        String detail=root+"/students/michael/lessons/lesson-history/practice/exercises/retired-task/attempts/attempt-old";
        var old=request(student,origin,detail,"GET");assertEquals(200,old.statusCode());var value=LegacyFixture.JSON.readTree(old.body());assertTrue(value.get("environmentRevision").isNull());assertEquals("// exact old source\n",value.path("files").path("Old-task.java").asText());assertFalse(value.has("accountId"));assertFalse(value.has("historicalImportId"));
        assertEquals(200,request(teacher,origin,root+"/students/fixture-second/materials","GET").statusCode());assertEquals(404,request(student,origin,root+"/students/fixture-second/materials","GET").statusCode());
        assertEquals(404,request(student,origin,"/api/v1/import_runs","GET").statusCode());
        for(String kind:List.of("invitations","resets")){
            String token=Base64.getUrlEncoder().withoutPadding().encodeToString((kind.equals("invitations")?"i":"r").repeat(32).getBytes(java.nio.charset.StandardCharsets.UTF_8));assertEquals(auth.path(kind).get(0).path("tokenHash").asText(),LegacyReader.sha(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            var anonymous=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var session=LegacyFixture.JSON.readTree(request(anonymous,origin,"/api/v1/auth/session","GET").body());
            var body=new HashMap<String,String>();body.put("token",token);body.put("password","synthetic-new-password");if(kind.equals("invitations"))body.put("login","synthetic-new-learner");
            var rejected=anonymous.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/auth/"+(kind.equals("invitations")?"register":"reset-password"))).header("Origin",origin).header("X-Mentor-Client","web").header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(LegacyFixture.JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(409,rejected.statusCode(),rejected.body());assertTrue(rejected.body().contains("TOKEN_INVALID"));
        }
        login(origin,"fixture.student",200);assertEquals(3,jdbc.queryForObject("SELECT auth_version FROM identity_account WHERE login='fixture.student'",Integer.class));
    }
    @Test void disabledImportedTeacherCannotLoginWhileActiveStudentCan()throws Exception{
        var auth=LegacyFixture.read(source,"data/auth/accounts.json");((tools.jackson.databind.node.ObjectNode)auth.path("accounts").get(0)).put("disabled",true);LegacyFixture.save(source,"data/auth/accounts.json",auth);
        start();assertTrue(importer.apply(source,"disabled-login","legacy-workspace").completed());stop();String origin=startWeb();login(origin,"fixture.teacher",401);login(origin,"fixture.student",200);
    }
    @Test void sourceRevisionMetadataIsRetained()throws Exception{
        start();assertTrue(importer.apply(source,"revision","legacy-workspace").completed());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_name='import_run' AND column_name='content_revision'",Integer.class),"The source snapshot sha is a revision string and needs exact import provenance");
        assertEquals("synthetic-source-revision",jdbc.queryForObject("SELECT content_revision FROM import_run",String.class));
    }
    @Test void sourceChangesDuringReservedTransferCannotAttach()throws Exception{
        start();Path file=source.resolve("private/materials/downloads/ListTask.java");byte[] original=Files.readAllBytes(file);
        EVENTS.set(name->{if(name.equals("stream-started")){assertEquals(1,count("blob_reservation"));try{byte[] changed=original.clone();changed[0]='X';Files.write(file,changed);}catch(Exception e){throw new RuntimeException(e);}}});
        assertFalse(importer.apply(source,"changing","legacy-workspace").completed());assertEquals(0,count("stored_blob"));assertEquals("STAGED",jdbc.queryForObject("SELECT state FROM blob_reservation",String.class));
        EVENTS.set(name->{});Files.write(file,original);var resumed=importer.apply(source,"changing","legacy-workspace");assertTrue(resumed.completed(),resumed.errors().toString());assertEquals(4,count("stored_blob"));
        jdbc.update("UPDATE blob_reservation SET lease_until=now()-interval '200 seconds',expires_at=now()-interval '100 seconds',settle_after=now()-interval '60 seconds' WHERE state='STAGED'");
        assertEquals(1,context.getBean(BlobService.class).cleanExpired(100));assertEquals(4,count("stored_blob"));for(var row:jdbc.queryForList("SELECT object_key FROM blob_reservation WHERE state='ATTACHED'"))assertTrue(Files.exists(objects.resolve(row.get("object_key").toString())));
    }
    @Test void gateLossDuringReservedTransferCannotAttachAndStaleLeaseCannotWrite()throws Exception{
        start();EVENTS.set(name->{if(name.equals("stream-started")){assertEquals(1,count("blob_reservation"));killImportConnection();}});
        assertFalse(importer.apply(source,"stream-loss","legacy-workspace").completed());stop();EVENTS.set(name->{});start();assertEquals(0,count("stored_blob"));assertEquals("RESERVED",jdbc.queryForObject("SELECT state FROM blob_reservation",String.class));
        var resumed=importer.apply(source,"stream-loss","legacy-workspace");assertTrue(resumed.completed(),resumed.errors().toString());assertEquals(4,count("stored_blob"));
    }
    @Test void changedRunGenerationRejectsOldLeaseAndFinalization()throws Exception{
        start();EVENTS.set(name->{if(name.equals("before-finalize"))jdbc.update("UPDATE import_run SET generation='synthetically-replaced'");});
        assertFalse(importer.apply(source,"generation","legacy-workspace").completed());assertEquals("applying",jdbc.queryForObject("SELECT state FROM import_run",String.class));
        EVENTS.set(name->{});assertTrue(importer.apply(source,"generation","legacy-workspace").completed());
    }
    @Test void explicitHistoricalArchiveIdentityAndTimestampArePreserved()throws Exception{
        var practice=LegacyFixture.read(source,"data/practice/state.json");((ObjectNode)practice.path("lessons").get(1).path("draftArchives").get(0)).put("id","explicit-old-archive").put("archivedAt","2026-09-21T21:05:00.000Z");LegacyFixture.save(source,"data/practice/state.json",practice);
        start();var report=importer.apply(source,"archive-identity","legacy-workspace");assertTrue(report.completed(),report.errors().toString());assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM practice_draft_archive WHERE id='explicit-old-archive' AND archived_at='2026-09-21T21:05:00.000Z'::timestamptz",Integer.class));
    }
    void killImportConnection(){int pid=jdbc.queryForObject("SELECT pg_backend_pid()",Integer.class);try(var c=DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());var s=c.createStatement()){s.execute("SELECT pg_terminate_backend("+pid+")");}catch(Exception e){throw new RuntimeException(e);}}
    String startWeb(){context=new SpringApplicationBuilder(MentorApplication.class).run("--server.port=0","--spring.datasource.url="+POSTGRES.getJdbcUrl(),"--spring.datasource.username="+POSTGRES.getUsername(),"--spring.datasource.password="+POSTGRES.getPassword(),"--mentor.blobs.local-root="+objects,"--mentor.blobs.cleanup-enabled=false");jdbc=context.getBean(JdbcTemplate.class);return "http://localhost:"+((WebServerApplicationContext)context).getWebServer().getPort();}
    HttpClient login(String origin,String login,int status)throws Exception{
        var client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var session=LegacyFixture.JSON.readTree(request(client,origin,"/api/v1/auth/session","GET").body());
        var response=client.send(HttpRequest.newBuilder(URI.create(origin+"/api/v1/auth/login")).header("Origin",origin).header("X-Mentor-Client","web").header("X-CSRF-TOKEN",session.get("csrfToken").asText()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(LegacyFixture.JSON.writeValueAsString(Map.of("login",login,"password","  Synthetic fixture 😀  ")))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(status,response.statusCode(),response.body());return client;
    }
    HttpResponse<byte[]> request(HttpClient client,String origin,String path,String method)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(origin+path)).method(method,HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofByteArray());}
}
