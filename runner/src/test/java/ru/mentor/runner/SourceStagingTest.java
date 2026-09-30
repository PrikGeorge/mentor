package ru.mentor.runner;

import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class SourceStagingTest {
    private final BoundedProcess processes=new BoundedProcess();

    @Test void nativeLinuxStagingRemainsHostPrivateButReadableThroughTheSandboxMount() throws Exception {
        String image=RunnerFixtures.prepare().environments().values().iterator().next().imageDigest();
        String volume="mentor-staging-test-"+UUID.randomUUID();
        Path probeCode=Files.createTempDirectory("mentor-staging-probe-");
        docker("volume","create",volume);
        try {
            // Mount only these two public class files; native builds may use restrictive class-file modes.
            Path packageDirectory=Files.createDirectories(probeCode.resolve("ru/mentor/runner"));
            for(String name:List.of("SourceStaging.class","SourceStagingProbe.class"))
                try(var resource=SourceStagingTest.class.getResourceAsStream(name)) {
                    assertNotNull(resource); Files.copy(resource,packageDirectory.resolve(name));
                }
            if(Files.getFileAttributeView(probeCode,PosixFileAttributeView.class)!=null)
                try(var paths=Files.walk(probeCode)) {
                    for(Path path:paths.toList()) Files.setPosixFilePermissions(path,
                        PosixFilePermissions.fromString(Files.isDirectory(path)?"rwxr-xr-x":"rw-r--r--"));
                }
            List<String> producer=List.of("run","--rm","--pull","never","--network","none","--user","0:0","--read-only",
                "--cap-drop","ALL","--security-opt","no-new-privileges","--pids-limit","64","--memory","256m",
                "--mount","type=volume,source="+volume+",target=/staging",
                "--mount","type=bind,source="+probeCode.toAbsolutePath()+",target=/probe,readonly",
                "--entrypoint","/bin/sh",image,"-c",
                "umask 077; exec java -Djava.io.tmpdir=/staging -cp /probe ru.mentor.runner.SourceStagingProbe");
            String parent=docker(producer.toArray(String[]::new)).trim();
            assertTrue(parent.matches("mentor-runner-input-[a-zA-Z0-9]+"),parent);

            // Mount just the approved subtree: the sandbox does not traverse the host-private parent.
            String mounted=docker("run","--rm","--pull","never","--network","none","--user","10001:10001","--read-only",
                "--cap-drop","ALL","--security-opt","no-new-privileges","--pids-limit","64","--memory","256m",
                "--tmpfs","/tmp:rw,nosuid,nodev,size=16m,mode=1777",
                "--mount","type=volume,source="+volume+",target=/input,volume-subpath="+parent+"/input,readonly",
                "--entrypoint","/bin/sh",image,"-c",
                "test \"$(id -u)\" = 10001 && ! touch /input/src/demo/nested/Task.java 2>/dev/null && "
                    +"javac -J-Xmx128m -d /tmp/classes /input/src/demo/nested/Task.java /input/src/demo/nested/Helper.java && "
                    +"java -Xmx64m -cp /tmp/classes demo.nested.Task");
            assertEquals("nested-ok",mounted.trim());

            // An unrelated local principal sees the parent, rather than receiving the sandbox's subtree mount.
            assertEquals("private",docker("run","--rm","--pull","never","--network","none","--user","10002:10002","--read-only",
                "--cap-drop","ALL","--security-opt","no-new-privileges",
                "--mount","type=volume,source="+volume+",target=/staging,readonly",
                "--entrypoint","/bin/sh",image,"-c",
                "test ! -r /staging/"+parent+"/input/src/demo/nested/Task.java && printf private").trim());

            var cleanup=new ArrayList<>(producer);
            cleanup.set(cleanup.size()-1,cleanup.getLast()+" cleanup");
            assertEquals("cleaned",docker(cleanup.toArray(String[]::new)).trim());
        } finally {
            try { docker("volume","rm",volume); } finally { EnvironmentBuilder.deleteTree(probeCode); }
        }
    }

    private String docker(String... arguments) throws Exception {
        var command=new ArrayList<>(List.of("docker")); command.addAll(List.of(arguments));
        var result=processes.run(command,null,null,Duration.ofSeconds(30),65536);
        assertTrue(result.successful(),result.reason()+"\n"+result.stderr()+result.stdout());
        return result.stdout();
    }
}
