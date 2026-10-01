package ru.mentor.platform.migration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
class LegacyCliTest {
    @TempDir Path temporary;
    @Test void dryRunNeedsNoDatabaseAndWritesOnlyPrivateStructuralReport()throws Exception{
        Path root=LegacyFixture.create(Files.createDirectory(temporary.resolve("closed"))),report=temporary.resolve("inspection.json");
        String previous=System.getProperty("spring.datasource.url");System.setProperty("spring.datasource.url","jdbc:postgresql://127.0.0.1:1/must-not-open");
        try{
            var result=LegacyImportCommand.run(new String[]{"--source",root.toString(),"--import-id","cli-inspect","--dry-run","--environment-manifest",root.resolve("operator-approval.json").toString(),"--environment-manifest-sha256",LegacyFixture.sha(root.resolve("operator-approval.json")),"--environment-profiles-sha256",LegacyFixture.sha(root.resolve("training/environments.json")),"--report",report.toString()});
            assertTrue(result.errors().isEmpty(),result.errors().toString());assertFalse(result.completed());assertEquals(2,result.counts().get("accounts"));
            String output=Files.readString(report);assertTrue(output.contains("sourceDigest"));assertFalse(output.contains("passwordHash"));assertFalse(output.contains("saltBase64"));assertFalse(output.contains("tokenHash"));assertFalse(Files.exists(root.resolve(".lock")));
            var acl=Files.getFileAttributeView(report,java.nio.file.attribute.AclFileAttributeView.class);if(acl!=null){var lookup=report.getFileSystem().getUserPrincipalLookupService();var permitted=java.util.Set.of(lookup.lookupPrincipalByName(System.getProperty("user.name")),lookup.lookupPrincipalByName("SYSTEM"));assertTrue(acl.getAcl().stream().allMatch(a->permitted.contains(a.principal())),"Report ACL must exclude unrelated local users");}
        }finally{if(previous==null)System.clearProperty("spring.datasource.url");else System.setProperty("spring.datasource.url",previous);}
    }
    @Test void reportCannotMutateTheClosedSourceSnapshot()throws Exception{
        Path root=LegacyFixture.create(Files.createDirectory(temporary.resolve("closed"))),report=root.resolve("new-report.json");
        assertThrows(IllegalArgumentException.class,()->LegacyImportCommand.run(new String[]{"--source",root.toString(),"--import-id","cli-inspect","--dry-run","--environment-manifest",root.resolve("operator-approval.json").toString(),"--environment-manifest-sha256",LegacyFixture.sha(root.resolve("operator-approval.json")),"--environment-profiles-sha256",LegacyFixture.sha(root.resolve("training/environments.json")),"--report",report.toString()}));assertFalse(Files.exists(report));
    }
}
