package ru.mentor.platform.migration;

import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;

import ru.mentor.platform.MentorApplication;

import java.nio.ByteBuffer;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.util.*;

public final class LegacyImportCommand {
    private LegacyImportCommand() {}

    public static ImportReport run(String[] args) throws Exception {
        Set<String> valueFlags =
                Set.of(
                        "--source",
                        "--import-id",
                        "--target-workspace",
                        "--teacher-account",
                        "--environment-manifest",
                        "--environment-manifest-sha256",
                        "--environment-profiles-sha256",
                        "--report",
                        "--maximum-material-bytes");
        Map<String, String> options = new HashMap<>();
        boolean apply = false, dry = false;
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--apply")) {
                if (apply) throw invalid();
                apply = true;
            } else if (args[i].equals("--dry-run")) {
                if (dry) throw invalid();
                dry = true;
            } else {
                String key = args[i];
                if (!valueFlags.contains(key)
                        || i + 1 >= args.length
                        || args[i + 1].isBlank()
                        || options.put(key, args[++i]) != null) throw invalid();
            }
        }
        Set<String> required =
                Set.of(
                        "--source",
                        "--import-id",
                        "--environment-manifest",
                        "--environment-manifest-sha256",
                        "--environment-profiles-sha256",
                        "--report");
        if (apply == dry
                || !options.keySet().containsAll(required)
                || (apply
                        && (!options.containsKey("--target-workspace")
                                || !options.containsKey("--teacher-account")))
                || !options.get("--import-id").matches("[A-Za-z0-9_-]{1,100}")) throw invalid();
        long maximum = Long.parseLong(options.getOrDefault("--maximum-material-bytes", "67108864"));
        if (maximum < 1 || maximum > Integer.MAX_VALUE) throw invalid();
        Path source = Path.of(options.get("--source")),
                reportPath = Path.of(options.get("--report")).toAbsolutePath().normalize();
        Path sourcePath = source.toAbsolutePath().normalize();
        if (reportPath.startsWith(sourcePath)
                || (Files.exists(sourcePath)
                        && reportPath.getParent() != null
                        && reportPath.getParent().toRealPath().startsWith(sourcePath.toRealPath())))
            throw new IllegalArgumentException(
                    "The report must be outside the closed source snapshot.");
        // Create the report privately before any import write; inability to preserve the report is
        // an operator error.
        try (var output = privateReport(reportPath)) {
            ImportReport report;
            try {
                var plan =
                        new LegacyReader(maximum)
                                .read(
                                        source,
                                        Path.of(options.get("--environment-manifest")),
                                        options.get("--environment-manifest-sha256"),
                                        options.get("--environment-profiles-sha256"));
                if (dry)
                    report =
                            LegacyImportService.describe(
                                    options.get("--import-id"), plan, null, false, maximum);
                else {
                    if (!plan.teacherId().equals(options.get("--teacher-account")))
                        throw new IllegalArgumentException(
                                "Explicit teacher account selection differs from the sole source teacher.");
                    try (var context =
                            new SpringApplicationBuilder(MentorApplication.class)
                                    .web(WebApplicationType.NONE)
                                    .run(
                                            "--mentor.offline-import=true",
                                            "--mentor.blobs.cleanup-enabled=false",
                                            "--mentor.import.teacher-id="
                                                    + options.get("--teacher-account"),
                                            "--mentor.materials.maximum-bytes=" + maximum,
                                            "--mentor.practice.environment-manifest="
                                                    + options.get("--environment-manifest"),
                                            "--mentor.practice.environment-manifest-sha256="
                                                    + options.get("--environment-manifest-sha256"),
                                            "--mentor.practice.environment-profiles-sha256="
                                                    + options.get(
                                                            "--environment-profiles-sha256"))) {
                        report =
                                context.getBean(LegacyImportService.class)
                                        .apply(
                                                source,
                                                options.get("--import-id"),
                                                options.get("--target-workspace"));
                    }
                }
            } catch (Exception e) {
                report =
                        new ImportReport(
                                options.get("--import-id"),
                                "",
                                Map.of(),
                                Map.of(),
                                List.of(),
                                List.of(
                                        e instanceof IllegalArgumentException
                                                ? e.getMessage()
                                                : "Import did not complete. A live runtime, incomplete run or unavailable database may prevent startup; inspect the durable run before retrying."),
                                false);
            }
            byte[] bytes = LegacyReader.JSON.writeValueAsBytes(report);
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            while (buffer.hasRemaining()) output.write(buffer);
            output.force(true);
            return report;
        }
    }

    private static java.nio.channels.FileChannel privateReport(Path path) throws Exception {
        Path parent = path.getParent();
        if (parent == null
                || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(parent)
                || Files.exists(path, LinkOption.NOFOLLOW_LINKS))
            throw new IllegalArgumentException(
                    "Choose a new report file in an existing private directory.");
        FileAttribute<?> attribute;
        if (Files.getFileStore(parent).supportsFileAttributeView("posix"))
            attribute =
                    PosixFilePermissions.asFileAttribute(
                            PosixFilePermissions.fromString("rw-------"));
        else {
            var lookup = path.getFileSystem().getUserPrincipalLookupService();
            var owner = lookup.lookupPrincipalByName(System.getProperty("user.name"));
            var system = lookup.lookupPrincipalByName("SYSTEM");
            List<AclEntry> acl =
                    List.of(
                            AclEntry.newBuilder()
                                    .setType(AclEntryType.ALLOW)
                                    .setPrincipal(owner)
                                    .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                                    .build(),
                            AclEntry.newBuilder()
                                    .setType(AclEntryType.ALLOW)
                                    .setPrincipal(system)
                                    .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                                    .build());
            attribute =
                    new FileAttribute<List<AclEntry>>() {
                        public String name() {
                            return "acl:acl";
                        }

                        public List<AclEntry> value() {
                            return acl;
                        }
                    };
        }
        return java.nio.channels.FileChannel.open(
                path, Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE), attribute);
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException(
                "Supply exactly one import mode, source/import ID, trusted environment pins, and a new private report path; apply also requires target workspace and exact teacher account.");
    }
}
