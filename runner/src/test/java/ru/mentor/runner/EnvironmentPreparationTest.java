package ru.mentor.runner;

import org.junit.jupiter.api.Test;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class EnvironmentPreparationTest {
    @Test void corruptedDependencyIsRejectedBeforeCreatingAnApprovedManifest() throws Exception {
        Path cache=Files.createTempDirectory("invalid-runner-dependencies-");
        try {
            Files.createDirectories(cache.resolve("jars"));
            Files.writeString(cache.resolve("jars/com.fasterxml.jackson.core.jackson-databind-2.18.3.jar"),"not the approved library");
            var failure=assertThrows(IllegalArgumentException.class,()->new EnvironmentBuilder().prepare(RunnerFixtures.ROOT.resolve("training/environments.json"),cache));
            assertTrue(failure.getMessage().contains("SHA-256 mismatch"));
        } finally { EnvironmentBuilder.deleteTree(cache); }
    }
}
