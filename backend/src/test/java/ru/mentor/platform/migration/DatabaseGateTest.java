package ru.mentor.platform.migration;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import ru.mentor.platform.MentorApplication;
import ru.mentor.platform.support.PostgresTest;
import javax.sql.DataSource;
import java.nio.file.Path;
import java.sql.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL sessions, including deliberate server-side connection loss. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DatabaseGateTest extends PostgresTest {
    static final String LOCK="1296387668,1229803591";
    @TempDir Path storage;
    ConfigurableApplicationContext runtime;
    @BeforeAll void database(){POSTGRES.start();}
    @AfterEach void stop(){if(runtime!=null){runtime.close();runtime=null;}}
    @AfterAll void databaseStop(){POSTGRES.stop();}
    Connection raw() throws Exception{return DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());}
    ConfigurableApplicationContext start(){return new SpringApplicationBuilder(MentorApplication.class).run("--server.port=0","--spring.datasource.url="+POSTGRES.getJdbcUrl(),"--spring.datasource.username="+POSTGRES.getUsername(),"--spring.datasource.password="+POSTGRES.getPassword(),"--mentor.blobs.local-root="+storage,"--mentor.blobs.cleanup-enabled=false");}
    boolean bool(Connection c,String sql)throws Exception{try(var s=c.createStatement();var r=s.executeQuery(sql)){r.next();return r.getBoolean(1);}}
    int integer(Connection c,String sql)throws Exception{try(var s=c.createStatement();var r=s.executeQuery(sql)){r.next();return r.getInt(1);}}

    @Test void liveRuntimeRefusesExclusiveMaintenanceBeforeAnyImportWrite()throws Exception{
        runtime=start();
        try(var other=raw()){
            assertFalse(bool(other,"SELECT pg_try_advisory_lock("+LOCK+")"),"A live runtime must hold the maintenance gate before accepting HTTP requests");
            assertEquals(8,integer(other,"SELECT count(*) FROM flyway_schema_history WHERE success"),"Guarded startup must still apply V8");
            assertEquals(0,integer(other,"SELECT count(*) FROM import_run"));
        }
    }

    @Test void checkedOutSqlConnectionStillBlocksImportAfterPresenceConnectionDies()throws Exception{
        runtime=start();var source=runtime.getBean(DataSource.class);
        try(var active=source.getConnection();var other=raw()){
            int activePid=integer(active,"SELECT pg_backend_pid()");
            int presence=integer(other,"SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=1296387668 AND objid=1229803591 AND pid<>"+activePid+" LIMIT 1");
            assertTrue(presence>0,"Runtime must own a distinct presence session");
            assertTrue(bool(other,"SELECT pg_terminate_backend("+presence+")"));
            assertFalse(bool(other,"SELECT pg_try_advisory_lock("+LOCK+")"),"The actual SQL session, not a separately polled boolean, must protect this checkout");
            assertEquals(1,integer(active,"SELECT 1"));
        }
        // A subsequent checkout may reacquire safely or refuse; it cannot bypass the shared gate.
        try(var next=source.getConnection();var other=raw()){
            assertFalse(bool(other,"SELECT pg_try_advisory_lock("+LOCK+")"));
        }catch(SQLException refused){assertNotNull(refused.getMessage());}
    }

    @Test void killedSqlTransactionRollsBackAndPoolReturnDoesNotLeakLocks()throws Exception{
        runtime=start();var source=runtime.getBean(DataSource.class);
        try(var active=source.getConnection();var other=raw()){
            active.setAutoCommit(false);active.createStatement().executeUpdate("INSERT INTO identity_account(id,login,password_hash,role) VALUES('gate-loss','gate-loss','synthetic','ADMIN')");
            int activePid=integer(active,"SELECT pg_backend_pid()");
            assertTrue(bool(other,"SELECT pg_terminate_backend("+activePid+")"));
            assertThrows(SQLException.class,active::commit);
            assertEquals(0,integer(other,"SELECT count(*) FROM identity_account WHERE id='gate-loss'"));
        }
        for(int i=0;i<5;i++)try(var ignored=source.getConnection()){}
        runtime.close();runtime=null;
        try(var other=raw()){assertTrue(bool(other,"SELECT pg_try_advisory_lock("+LOCK+")"),"Closing the runtime must release every borrowed and presence lock");}
    }
    @Test void refusedOfflineCliStillWritesFailureReportAndDoesNotChangeLiveDatabase()throws Exception{
        runtime=start();Path snapshot=LegacyFixture.create(java.nio.file.Files.createDirectory(storage.resolve("closed-snapshot"))),report=storage.resolve("refused-report.json");
        Map<String,String> settings=Map.of("spring.datasource.url",POSTGRES.getJdbcUrl(),"spring.datasource.username",POSTGRES.getUsername(),"spring.datasource.password",POSTGRES.getPassword(),"mentor.blobs.local-root",storage.resolve("unused-import-objects").toString());Map<String,String> previous=new HashMap<>();settings.forEach((k,v)->{previous.put(k,System.getProperty(k));System.setProperty(k,v);});
        try{
            var result=assertDoesNotThrow(()->LegacyImportCommand.run(new String[]{"--source",snapshot.toString(),"--import-id","live-refusal","--apply","--target-workspace","legacy-workspace","--teacher-account","account-fixture-teacher","--environment-manifest",snapshot.resolve("operator-approval.json").toString(),"--environment-manifest-sha256",LegacyFixture.sha(snapshot.resolve("operator-approval.json")),"--environment-profiles-sha256",LegacyFixture.sha(snapshot.resolve("training/environments.json")),"--report",report.toString()}));
            assertFalse(result.completed());assertFalse(result.errors().isEmpty());assertFalse(LegacyFixture.JSON.readTree(java.nio.file.Files.readString(report)).get("completed").asBoolean());
            try(var c=raw()){assertEquals(0,integer(c,"SELECT count(*) FROM import_run"));}
        }finally{previous.forEach((k,v)->{if(v==null)System.clearProperty(k);else System.setProperty(k,v);});}
    }
}
