package ru.mentor.platform.migration;

import ru.mentor.platform.identity.*;
import ru.mentor.platform.practice.*;

import tools.jackson.databind.*;
import tools.jackson.databind.node.*;

import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.*;
import java.time.*;
import java.util.*;

/** Read-only canonical snapshot parser. Never opens legacy stores, evaluates code, or repairs source data. */
public final class LegacyReader {
    public static final ObjectMapper JSON = new ObjectMapper();

    public record SourceFile(String path, long size, String sha256) {}

    public record Plan(
            Path root,
            String digest,
            List<SourceFile> files,
            JsonNode mentoring,
            JsonNode auth,
            JsonNode practice,
            JsonNode manifest,
            JsonNode content,
            List<CatalogImport.Definition> catalog,
            String teacherId,
            String approvalHash,
            String profilesHash) {}

    private final long maximum;

    public LegacyReader(long maximum) {
        this.maximum = maximum;
    }

    public Plan read(Path source, Path approval, String approvalHash, String profilesHash)
            throws IOException {
        Path root = source.toAbsolutePath().normalize();
        if (!Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS) || unsafeLink(root))
            throw invalid("Snapshot root must be a closed real directory.");
        List<SourceFile> files = manifest(root);
        JsonNode mentoring = parse(root, "data/mentoring.json"),
                auth = parse(root, "data/auth/accounts.json");
        JsonNode practice =
                Files.exists(root.resolve("data/practice/state.json"), LinkOption.NOFOLLOW_LINKS)
                        ? parse(root, "data/practice/state.json")
                        : JSON.createObjectNode()
                                .put("version", 1)
                                .set("lessons", JSON.createArrayNode());
        JsonNode materials = parse(root, "private/materials/manifest.json");
        if (!materials.path("version").isIntegralNumber()
                || materials.path("version").asInt() != 1
                || !materials.path("materials").isArray())
            throw invalid("Invalid material manifest structure.");
        String snapshot = text(materials, "snapshot");
        Path snapshotPath = safe(root.resolve("private/materials"), snapshot);
        JsonNode content = parseFile(snapshotPath, "private/materials/" + snapshot);
        if (!content.path("docs").isObject()
                || !content.path("code").isObject()
                || !content.path("viewData").isObject()
                || !content.path("sha").isString())
            throw invalid("Invalid prepared content structure.");
        var students = unique(versionArray(mentoring, "students"), "student");
        var lessons = unique(array(mentoring, "lessons"), "lesson");
        validateMentoring(students, lessons);
        String teacher = validateAuth(auth, students);
        final List<CatalogImport.Definition> catalog;
        try {
            catalog =
                    CatalogImport.inspect(
                            root.resolve("training/catalog.json"),
                            approval,
                            approvalHash,
                            profilesHash);
        } catch (Exception bad) {
            throw invalid("Trusted catalog or environment approval is invalid.");
        }
        Set<String> catalogIds = new HashSet<>();
        for (var e : catalog) catalogIds.add(e.exercise().exerciseId());
        validatePractice(root, practice, lessons, catalogIds);
        // Converter validates every ownership edge and snapshot section before any database
        // mutation.
        new MaterialConverter()
                .convert(root, materials, content, mentoring, "inspection-workspace", maximum);
        var digest = JSON.createArrayNode();
        // The reserved @ marker sorts before real snapshot roots; the format version lives in
        // import_run.
        if (!Files.exists(root.resolve("data/practice/state.json"), LinkOption.NOFOLLOW_LINKS))
            digest.add(
                    JSON.createArrayNode().add("@optional/data/practice/state.json").add("absent"));
        for (var f : files)
            digest.add(JSON.createArrayNode().add(f.path()).add(f.size()).add(f.sha256()));
        return new Plan(
                root,
                sha(JSON.writeValueAsBytes(digest)),
                files,
                mentoring,
                auth,
                practice,
                materials,
                content,
                catalog,
                teacher,
                approvalHash,
                profilesHash);
    }

    public List<SourceFile> manifest(Path root) throws IOException {
        List<SourceFile> entries = new ArrayList<>();
        try (var tree = Files.walk(root)) {
            for (Path path : (Iterable<Path>) tree::iterator) {
                if (unsafeLink(path))
                    throw invalid("Snapshot contains a symlink or reparse point.");
                var attrs =
                        Files.readAttributes(
                                path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attrs.isDirectory()) continue;
                String name = root.relativize(path).toString().replace('\\', '/');
                if (!attrs.isRegularFile()
                        || !(name.startsWith("data/")
                                || name.startsWith("private/materials/")
                                || name.startsWith("training/")
                                || name.startsWith("content/")
                                || name.startsWith("code/")
                                || name.equals("operator-approval.json"))
                        || name.matches(".*(?:\\.lock|\\.tmp|\\.bak)$")
                        || name.contains("/sessions")
                        || name.contains("/training-cache/"))
                    throw invalid("Unsupported source entry: " + name);
                if (attrs.size() > maximum)
                    throw invalid("Source entry exceeds configured byte limit: " + name);
                entries.add(new SourceFile(name, attrs.size(), sha(path, maximum)));
                if (entries.size() > 100000)
                    throw invalid("Source manifest exceeds its entry limit.");
            }
        }
        entries.sort(Comparator.comparing(SourceFile::path));
        return List.copyOf(entries);
    }

    private void validateMentoring(Map<String, JsonNode> students, Map<String, JsonNode> lessons) {
        Map<String, Integer> limits =
                Map.of(
                        "name",
                        120,
                        "direction",
                        120,
                        "goal",
                        1000,
                        "schedule",
                        500,
                        "notes",
                        5000,
                        "studentRoadmap",
                        20000,
                        "studentReview",
                        20000);
        for (var entry : students.entrySet()) {
            JsonNode s = entry.getValue();
            timestamp(s, "createdAt", false);
            for (var field : limits.entrySet()) {
                String value =
                        legacyTrim(
                                optionalText(
                                        s,
                                        field.getKey(),
                                        Set.of("studentRoadmap", "studentReview")
                                                .contains(field.getKey())));
                if (value.length() > field.getValue()
                        || (field.getKey().equals("name") && value.isEmpty()))
                    throw invalid(
                            "Invalid profile field: " + entry.getKey() + "/" + field.getKey());
            }
        }
        for (var entry : lessons.entrySet()) {
            var l = entry.getValue();
            if (!students.containsKey(id(l, "studentId")))
                throw invalid("Lesson references an unknown student: " + entry.getKey());
            timestamp(l, "createdAt", false);
            String title = legacyTrim(text(l, "title"));
            if (title.isEmpty() || title.length() > 200)
                throw invalid("Invalid lesson title: " + entry.getKey());
            String date = text(l, "date"), time = text(l, "time");
            try {
                if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
                        || !LocalDate.parse(date).toString().equals(date)
                        || !time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))
                    throw new IllegalArgumentException();
            } catch (Exception bad) {
                throw invalid("Invalid local lesson date/time: " + entry.getKey());
            }
            number(l, "duration", 15, 240);
            if (!Set.of("planned", "prepared").contains(text(l, "status"))
                    || !(l.has("bundleId")
                            && (l.get("bundleId").isNull()
                                    || text(l, "bundleId").equals("library-2026-09-27"))))
                throw invalid("Invalid lesson preparation binding: " + entry.getKey());
            for (String field : List.of("teacherNotes", "studentNotes", "reviewNotes"))
                if (optionalText(l, field, field.equals("reviewNotes")).length() > 200000)
                    throw invalid(
                            "Lesson text exceeds UTF-16 limit: " + entry.getKey() + "/" + field);
        }
    }

    private String validateAuth(JsonNode auth, Map<String, JsonNode> students) {
        Map<String, JsonNode> accounts = unique(versionArray(auth, "accounts"), "account");
        Set<String> logins = new HashSet<>(), bindings = new HashSet<>();
        String teacher = null;
        try (var codec = new PasswordCodec()) {
            for (var a : accounts.values()) {
                String login = text(a, "login");
                if (!login.matches("[a-z0-9][a-z0-9._-]{2,31}")
                        || !logins.add(login)
                        || !a.path("disabled").isBoolean())
                    throw invalid("Invalid account metadata.");
                number(a, "authVersion", 1, 9007199254740991L);
                timestamp(a, "createdAt", false);
                try {
                    codec.importLegacy(
                            JSON.treeToValue(a.get("passwordHash"), LegacyPasswordHash.class));
                } catch (Exception bad) {
                    throw invalid("Invalid legacy password encoding.");
                }
                String role = text(a, "role");
                if (role.equals("teacher")) {
                    if (teacher != null || !a.has("studentId") || !a.get("studentId").isNull())
                        throw invalid("Snapshot must contain one unambiguous teacher.");
                    teacher = id(a, "id");
                } else if (!role.equals("student")
                        || !students.containsKey(id(a, "studentId"))
                        || !bindings.add(text(a, "studentId")))
                    throw invalid("Invalid account/card association.");
            }
        }
        if (teacher == null) throw invalid("Snapshot must contain exactly one teacher.");
        Set<String> ids = new HashSet<>(), hashes = new HashSet<>();
        for (String kind : List.of("invitations", "resets"))
            for (var link : array(auth, kind)) {
                if (!ids.add(id(link, "id"))
                        || !text(link, "tokenHash").matches("[a-f0-9]{64}")
                        || !hashes.add(text(link, "tokenHash")))
                    throw invalid("Invalid legacy link identity.");
                if (!text(link, "purpose")
                        .equals(kind.equals("invitations") ? "register" : "reset-password"))
                    throw invalid("Invalid legacy link purpose.");
                if (!timestamp(link, "expiresAt", false)
                        .isAfter(timestamp(link, "createdAt", false)))
                    throw invalid("Invalid legacy link interval.");
                timestamp(link, "usedAt", true);
                timestamp(link, "revokedAt", true);
                if (kind.equals("invitations")
                        ? !students.containsKey(id(link, "studentId"))
                        : !accounts.containsKey(id(link, "accountId")))
                    throw invalid("Unknown legacy link binding.");
            }
        return teacher;
    }

    private void validatePractice(
            Path root, JsonNode practice, Map<String, JsonNode> lessons, Set<String> catalog)
            throws IOException {
        Set<String> lessonKeys = new HashSet<>(),
                attemptIds = new HashSet<>(),
                archiveIds = new HashSet<>(),
                submissionIds = new HashSet<>();
        Map<String, String> blobs = new HashMap<>();
        for (var p : versionArray(practice, "lessons")) {
            String sid = id(p, "studentId"), lid = id(p, "lessonId");
            var lesson = lessons.get(lid);
            if (lesson == null || !text(lesson, "studentId").equals(sid) || !lessonKeys.add(lid))
                throw invalid("Invalid practice lesson association.");
            Set<String> assigned = new HashSet<>();
            for (var a : array(p, "assignments")) {
                String exercise = id(a, "exerciseId");
                if (!assigned.add(exercise)
                        || !Set.of("class", "homework").contains(text(a, "placement"))
                        || !catalog.contains(exercise))
                    throw invalid(
                            "Active assignment lacks a valid catalog definition: " + exercise);
            }
            Set<String> drafts = new HashSet<>();
            for (String kind : List.of("drafts", "draftArchives"))
                for (var d : array(p, kind)) {
                    String exercise = id(d, "exerciseId");
                    if (kind.equals("drafts") && !drafts.add(exercise))
                        throw invalid("Duplicate draft for lesson/exercise.");
                    revision(d);
                    number(d, "revision", 1, 9007199254740991L);
                    historicalFiles(d.get("files"));
                    timestamp(d, "updatedAt", false);
                    if (kind.equals("draftArchives")) {
                        if (d.has("id") && !archiveIds.add(id(d, "id")))
                            throw invalid("Duplicate historical archive identity.");
                        timestamp(d, "archivedAt", true);
                    }
                }
            for (var a : array(p, "attempts")) {
                if (!attemptIds.add(id(a, "id")))
                    throw invalid("Duplicate historical attempt identity.");
                id(a, "exerciseId");
                revision(a);
                historicalFiles(a.get("files"));
                timestamp(a, "createdAt", false);
                if (!Set.of("run", "submit").contains(text(a, "mode")))
                    throw invalid("Invalid historical attempt mode.");
                validateResult(a.get("result"));
            }
            for (var s : array(p, "submissions")) {
                if (!submissionIds.add(id(s, "id")))
                    throw invalid("Duplicate historical submission identity.");
                String blob = text(s, "blobId");
                if (!blob.matches("[a-f0-9-]{36}"))
                    throw invalid("Invalid historical blob identity.");
                String filename = text(s, "filename");
                if (filename.matches(".*[\\\\/\\x00-\\x1f\\x7f].*"))
                    throw invalid("Unsafe historical filename.");
                long size = number(s, "size", 1, 20971520);
                timestamp(s, "createdAt", false);
                timestamp(s, "reviewedAt", true);
                String status = text(s, "status");
                if (!Set.of("submitted", "reviewed", "needs_revision").contains(status))
                    throw invalid("Invalid homework status.");
                text(s, "feedback");
                text(s, "comment");
                text(s, "repositoryUrl");
                if (status.equals("submitted")
                        && (!text(s, "feedback").isEmpty()
                                || !s.path("reviewedAt").isMissingNode()
                                        && !s.path("reviewedAt").isNull()))
                    throw invalid("Submitted historical homework has review metadata.");
                Path file = safe(root.resolve("data/practice/uploads"), blob);
                if (Files.size(file) != size)
                    throw invalid("Historical blob size differs from metadata: " + blob);
                String metadata = sid + "/" + lid + "/" + JSON.writeValueAsString(s);
                String prior = blobs.putIfAbsent(blob, metadata);
                if (prior != null && !prior.equals(metadata))
                    throw invalid(
                            "Historical blob ID has inconsistent ownership or metadata: " + blob);
            }
        }
    }

    private static void validateResult(JsonNode result) {
        if (result == null
                || !result.isObject()
                || !Set.of(
                                "accepted",
                                "wrong_answer",
                                "compile_error",
                                "runtime_error",
                                "time_limit",
                                "error",
                                "unavailable")
                        .contains(text(result, "status")))
            throw invalid("Unsupported historical result shape.");
        number(result, "passed", 0, Integer.MAX_VALUE);
        number(result, "total", 0, Integer.MAX_VALUE);
        number(result, "elapsedMs", 0, Long.MAX_VALUE);
        if (result.has("diagnostics") && !result.get("diagnostics").isNull())
            text(result, "diagnostics");
        for (var t : array(result, "tests")) {
            text(t, "name");
            text(t, "status");
            for (String key : List.of("message", "stdout"))
                if (t.has(key) && !t.get(key).isNull()) text(t, key);
        }
    }

    private static void revision(JsonNode d) {
        try {
            ExerciseRevision.fromJson(d.get("exerciseRevision"));
        } catch (Exception bad) {
            throw invalid("Invalid typed exercise revision.");
        }
    }

    // Match ECMAScript String.trim for legacy validation only. Persist the original value
    // untouched.
    private static String legacyTrim(String value) {
        int start = 0, end = value.length();
        while (start < end && legacySpace(value.charAt(start))) start++;
        while (end > start && legacySpace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    private static boolean legacySpace(char c) {
        return c >= 0x09 && c <= 0x0d
                || c >= 0x2000 && c <= 0x200a
                || switch (c) {
                    case 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff -> true;
                    default -> false;
                };
    }

    private static void historicalFiles(JsonNode files) {
        if (files == null || !files.isObject() || files.size() > 16)
            throw invalid("Invalid historical source map.");
        for (var f : files.properties()) {
            if (!f.getKey().matches("[a-zA-Z0-9_$-]+(?:/[a-zA-Z0-9_$-]+)*\\.java")
                    || Arrays.stream(f.getKey().split("[/\\.]"))
                            .anyMatch(
                                    s ->
                                            Set.of("__proto__", "prototype", "constructor")
                                                    .contains(s))
                    || !f.getValue().isString()
                    || !SourceFiles.wellFormed(f.getValue().asText()))
                throw invalid("Invalid historical source file.");
        }
    }

    public static Map<String, JsonNode> unique(JsonNode values, String kind) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (var value : values)
            if (out.putIfAbsent(id(value, "id"), value) != null)
                throw invalid("Duplicate " + kind + " identity.");
        return out;
    }

    private static JsonNode versionArray(JsonNode n, String key) {
        if (!n.path("version").isIntegralNumber() || n.path("version").asInt() != 1)
            throw invalid("Unsupported legacy document version.");
        return array(n, key);
    }

    public static JsonNode array(JsonNode n, String key) {
        if (n == null || !n.path(key).isArray()) throw invalid("Array required: " + key);
        return n.get(key);
    }

    public static String text(JsonNode n, String key) {
        if (n == null
                || !n.path(key).isString()
                || !SourceFiles.wellFormed(n.path(key).asText())
                || n.path(key).asText().indexOf(0) >= 0)
            throw invalid("Valid text required: " + key);
        return n.get(key).asText();
    }

    public static String optionalText(JsonNode n, String key, boolean optional) {
        return optional && !n.has(key) ? "" : text(n, key);
    }

    public static String nullableText(JsonNode n, String key) {
        return !n.has(key) || n.get(key).isNull() ? null : text(n, key);
    }

    public static String id(JsonNode n, String key) {
        String id = text(n, key);
        if (!id.matches("[a-zA-Z0-9_-]{1,100}")) throw invalid("Invalid identity: " + key);
        return id;
    }

    public static long number(JsonNode n, String key, long min, long max) {
        var v = n.get(key);
        if (v == null
                || !v.isIntegralNumber()
                || !v.canConvertToLong()
                || v.asLong() < min
                || v.asLong() > max) throw invalid("Invalid integer: " + key);
        return v.asLong();
    }

    public static Instant timestamp(JsonNode n, String key, boolean nullable) {
        if (nullable && (!n.has(key) || n.get(key).isNull())) return null;
        String value = text(n, key);
        try {
            if (!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z"))
                throw new IllegalArgumentException();
            Instant t = Instant.parse(value);
            if (t.getNano() % 1000000 != 0) throw new IllegalArgumentException();
            return t;
        } catch (Exception bad) {
            throw invalid("Unsupported timestamp shape or precision: " + key);
        }
    }

    private JsonNode parse(Path root, String path) throws IOException {
        return parseFile(safe(root, path), path);
    }

    private JsonNode parseFile(Path path, String label) throws IOException {
        try {
            if (Files.size(path) > maximum)
                throw invalid("Source entry exceeds byte limit: " + label);
            String decoded =
                    StandardCharsets.UTF_8
                            .newDecoder()
                            .decode(ByteBuffer.wrap(Files.readAllBytes(path)))
                            .toString();
            if (decoded.startsWith("\uFEFF")) decoded = decoded.substring(1);
            JsonNode n = PracticeJson.read(decoded);
            unicode(n);
            return n;
        } catch (RuntimeException | CharacterCodingException bad) {
            throw invalid("Invalid JSON or Unicode at " + label);
        }
    }

    private static void unicode(JsonNode n) {
        if (n.isString() && (!SourceFiles.wellFormed(n.asText()) || n.asText().indexOf(0) >= 0))
            throw invalid("Invalid Unicode.");
        if (n.isObject())
            for (String key : n.propertyNames())
                if (!SourceFiles.wellFormed(key) || key.indexOf(0) >= 0)
                    throw invalid("Invalid Unicode key.");
        if (n.isContainer()) for (var child : n) unicode(child);
    }

    public static Path safe(Path root, String name) throws IOException {
        if (name == null
                || name.isEmpty()
                || name.contains("\\")
                || name.startsWith("/")
                || name.contains(":")
                || Arrays.stream(name.split("/", -1))
                        .anyMatch(p -> p.isEmpty() || p.equals(".") || p.equals("..")))
            throw invalid("Unsafe source path.");
        Path target = root.resolve(name).normalize();
        if (!target.startsWith(root)) throw invalid("Unsafe source path.");
        Path p = root;
        if (unsafeLink(p)) throw invalid("Source root is a symlink or reparse point.");
        for (Path part : root.relativize(target)) {
            p = p.resolve(part);
            if (unsafeLink(p)) throw invalid("Source path is a symlink or reparse point.");
        }
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS))
            throw invalid("Missing source file: " + name);
        return target;
    }

    private static boolean unsafeLink(Path path) throws IOException {
        if (Files.isSymbolicLink(path)) return true;
        return Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS)
                .isOther();
    }

    public static String sha(Path path, long maximum) throws IOException {
        try (var stream = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
            MessageDigest digest = digest();
            byte[] buffer = new byte[65536];
            long total = 0;
            for (int n; (n = stream.read(buffer)) >= 0; ) {
                total += n;
                if (total > maximum) throw invalid("Source changed or exceeds byte limit.");
                digest.update(buffer, 0, n);
            }
            return HexFormat.of().formatHex(digest.digest());
        }
    }

    public static String sha(byte[] bytes) {
        return HexFormat.of().formatHex(digest().digest(bytes));
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    public static IllegalArgumentException invalid(String message) {
        return new IllegalArgumentException(message);
    }
}
