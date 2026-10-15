package ru.mentor.platform.migration;

import static ru.mentor.platform.migration.LegacyReader.*;

import tools.jackson.databind.*;
import tools.jackson.databind.node.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

/** Converts precompiled payloads only. Raw Markdown and code are never rendered or normalized here. */
public final class MaterialConverter {
    public record Material(
            String id,
            String student,
            String lesson,
            String bundle,
            String audience,
            String kind,
            String key,
            String filename,
            String contentType,
            String title,
            JsonNode payload,
            String sourceFile) {}

    private record Binding(String student, String lesson, String bundle) {}

    public List<Material> convert(
            Path root,
            JsonNode manifest,
            JsonNode content,
            JsonNode mentoring,
            String workspace,
            long maximum)
            throws java.io.IOException {
        Map<String, JsonNode> students = unique(array(mentoring, "students"), "student"),
                lessons = unique(array(mentoring, "lessons"), "lesson");
        List<Material> result = new ArrayList<>();
        Map<String, Material> byId = new HashMap<>(),
                docs = new HashMap<>(),
                code = new HashMap<>();
        Set<String> consumed = new HashSet<>();
        for (var entry : array(manifest, "materials")) {
            String id = id(entry, "id"),
                    student = id(entry, "studentId"),
                    lesson = nullableText(entry, "lessonId"),
                    bundle = nullableText(entry, "bundleId"),
                    kind = text(entry, "kind"),
                    audience = text(entry, "audience"),
                    key = nullableText(entry, "key");
            if (!students.containsKey(student)
                    || (lesson == null) != (bundle == null)
                    || (lesson != null
                            && (!lessons.containsKey(lesson)
                                    || !text(lessons.get(lesson), "studentId").equals(student)))
                    || !Set.of("doc", "code", "view", "download").contains(kind)
                    || !Set.of("student", "teacher").contains(audience))
                throw invalid("Invalid material ownership: " + id);
            String file = text(entry, "file");
            Path source = safe(root.resolve("private/materials"), file);
            if (Files.size(source) > maximum)
                throw invalid("Material exceeds configured byte limit: " + id);
            JsonNode payload = null;
            String title = null;
            if (!kind.equals("download")) {
                if (!file.equals(text(manifest, "snapshot")) || key == null)
                    throw invalid("Invalid prepared payload location: " + id);
                payload =
                        switch (kind) {
                            case "doc" -> content.path("docs").get(key);
                            case "code" -> content.path("code").get(key);
                            default -> content.path("viewData").path("students").get(key);
                        };
                if (payload == null || !payload.isObject())
                    throw invalid("Missing prepared payload: " + id);
                if (kind.equals("doc")) {
                    if (!student.equals(text(payload, "studentId")))
                        throw invalid("Prepared document ownership differs: " + id);
                    document(payload);
                    title = text(payload, "title");
                } else if (kind.equals("code")) {
                    text(payload, "text");
                    id(payload, "materialId");
                    if (!payload.path("teacher").isBoolean()
                            || payload.path("teacher").asBoolean() != audience.equals("teacher"))
                        throw invalid("Code audience differs: " + id);
                    if (payload.has("excerpt")) {
                        long start = number(payload.get("excerpt"), "start", 0, Integer.MAX_VALUE),
                                end = number(payload.get("excerpt"), "end", 0, Integer.MAX_VALUE);
                        if (end < start) throw invalid("Invalid code excerpt: " + id);
                    }
                } else {
                    if (!audience.equals("student") || !key.equals(student))
                        throw invalid("Student view ownership differs: " + id);
                    view(payload);
                }
                consumed.add(kind + ":" + key);
                payload = payload.deepCopy();
            }
            String filename = text(entry, "filename"), type = text(entry, "contentType");
            try {
                ru.mentor.platform.files.BlobService.contentType(type);
            } catch (Exception bad) {
                throw invalid("Invalid material media type: " + id);
            }
            var material =
                    new Material(
                            id,
                            student,
                            lesson,
                            bundle,
                            audience,
                            kind,
                            key,
                            filename,
                            type,
                            title,
                            payload,
                            kind.equals("download") ? "private/materials/" + file : null);
            if (byId.putIfAbsent(id, material) != null)
                throw invalid("Duplicate material identity: " + id);
            result.add(material);
            if (kind.equals("doc") && docs.putIfAbsent(key, material) != null
                    || kind.equals("code") && code.putIfAbsent(key, material) != null)
                throw invalid("Ambiguous prepared content selector: " + id);
        }
        for (String key : content.path("docs").propertyNames())
            if (!consumed.contains("doc:" + key))
                throw invalid("Unbound prepared document: " + key);
        for (String key : content.path("code").propertyNames())
            if (!consumed.contains("code:" + key)) throw invalid("Unbound prepared code: " + key);
        for (String key : content.path("viewData").path("students").propertyNames())
            if (!consumed.contains("view:" + key)) throw invalid("Unbound student view: " + key);
        for (var m : result)
            if (m.kind().equals("code")) {
                var download = byId.get(text(m.payload(), "materialId"));
                if (download == null
                        || !download.kind().equals("download")
                        || !binding(m).equals(binding(download))
                        || !m.audience().equals(download.audience()))
                    throw invalid("Code download has a different ownership binding: " + m.id());
            }
        var teacher = content.path("viewData").get("teacher");
        if (teacher != null && !teacher.isNull()) result.addAll(teacherViews(teacher, docs, code));
        List<Material> converted = new ArrayList<>();
        for (var m : result) {
            JsonNode payload =
                    m.payload() == null ? null : rewrite(m.payload(), "", m, byId, workspace);
            converted.add(
                    new Material(
                            m.id(),
                            m.student(),
                            m.lesson(),
                            m.bundle(),
                            m.audience(),
                            m.kind(),
                            m.key(),
                            m.filename(),
                            m.contentType(),
                            m.title(),
                            payload,
                            m.sourceFile()));
        }
        return List.copyOf(converted);
    }

    private static void document(JsonNode payload) {
        for (String field : List.of("title", "intro", "html", "raw")) text(payload, field);
        for (var section : array(payload, "sections")) {
            for (String field : List.of("id", "title", "html")) text(section, field);
            if (section.has("studentParts"))
                for (var n : array(section, "studentParts"))
                    if (!n.isIntegralNumber() || !n.canConvertToInt() || n.asInt() < 0)
                        throw invalid("Invalid document section parts.");
        }
    }

    private static void view(JsonNode payload) {
        for (String field : List.of("goalHtml", "profileFacts", "lessonHtml", "reviewHtml"))
            if (payload.has(field)) text(payload, field);
        if (payload.has("review")) {
            var review = payload.get("review");
            number(review, "metadataParagraphs", 0, Integer.MAX_VALUE);
            for (var priority : array(review, "priorities")) {
                text(priority, "sectionId");
                text(priority, "label");
            }
        }
        if (payload.has("descriptors")) {
            if (!payload.get("descriptors").isObject()) throw invalid("Invalid descriptors.");
            for (var value : payload.get("descriptors")) tuple(value, 2);
        }
        if (payload.has("resources")) for (var value : array(payload, "resources")) tuple(value, 4);
        if (payload.has("answersCards"))
            for (var value : array(payload, "answersCards")) tuple(value, 3);
    }

    private static void tuple(JsonNode value, int size) {
        if (!value.isArray() || value.size() != size) throw invalid("Invalid prepared view tuple.");
        for (var item : value)
            if (!item.isString()) throw invalid("Invalid prepared view tuple text.");
    }

    private List<Material> teacherViews(
            JsonNode teacher, Map<String, Material> docs, Map<String, Material> code) {
        if (!teacher.isObject()
                || !Set.of(
                                "profileFacts",
                                "lessonHtml",
                                "reviewHtml",
                                "answersCards",
                                "descriptors",
                                "resources")
                        .containsAll(teacher.propertyNames()))
            throw invalid("Unsupported teacher view structure.");
        view(teacher);
        Map<Binding, ObjectNode> grouped = new LinkedHashMap<>();
        for (String field : List.of("profileFacts", "lessonHtml", "reviewHtml"))
            if (teacher.has(field)) {
                String html = text(teacher, field);
                Set<Binding> owners = new HashSet<>();
                var anchors = Pattern.compile("href=[\"']#([A-Za-z0-9_-]+)[\"']").matcher(html);
                while (anchors.find()) {
                    var doc = docs.get(anchors.group(1));
                    if (doc != null) owners.add(binding(doc));
                }
                if (owners.isEmpty()) {
                    for (String key :
                            switch (field) {
                                case "profileFacts" -> List.of("profile");
                                case "lessonHtml" -> List.of("lesson", "guide");
                                default -> List.of("student-review", "review");
                            })
                        if (docs.containsKey(key)) {
                            owners.add(binding(docs.get(key)));
                            break;
                        }
                }
                if (owners.size() != 1)
                    throw invalid("Cannot establish teacher view ownership: " + field);
                grouped.computeIfAbsent(owners.iterator().next(), b -> JSON.createObjectNode())
                        .put(field, html);
            }
        Set<Binding> answerOwners = new HashSet<>();
        if (teacher.has("answersCards"))
            for (var card : teacher.get("answersCards")) {
                Material owner = code.get(card.get(0).asText());
                if (owner == null || !owner.audience().equals("teacher"))
                    throw invalid("Unbound teacher answer card.");
                answerOwners.add(binding(owner));
                ((ArrayNode)
                                grouped.computeIfAbsent(
                                                binding(owner), b -> JSON.createObjectNode())
                                        .withArray("answersCards"))
                        .add(card.deepCopy());
            }
        if (teacher.has("descriptors"))
            for (var entry : teacher.get("descriptors").properties()) {
                Material owner = docs.get(entry.getKey());
                if (owner == null) throw invalid("Unbound teacher descriptor.");
                ((ObjectNode)
                                grouped.computeIfAbsent(
                                                binding(owner), b -> JSON.createObjectNode())
                                        .withObject("descriptors"))
                        .set(entry.getKey(), entry.getValue().deepCopy());
            }
        if (teacher.has("resources"))
            for (var entry : teacher.get("resources")) {
                Binding owner;
                if (entry.get(0).asText().equals("answers")) {
                    // Legacy answers is a virtual view. Its referenced teacher code supplies the
                    // only valid scope.
                    if (answerOwners.size() != 1)
                        throw invalid("Cannot establish teacher answers resource ownership.");
                    owner = answerOwners.iterator().next();
                } else {
                    Material document = docs.get(entry.get(0).asText());
                    if (document == null) throw invalid("Unbound teacher resource.");
                    owner = binding(document);
                }
                ((ArrayNode)
                                grouped.computeIfAbsent(owner, b -> JSON.createObjectNode())
                                        .withArray("resources"))
                        .add(entry.deepCopy());
            }
        List<Material> out = new ArrayList<>();
        for (var group : grouped.entrySet()) {
            var b = group.getKey();
            String id =
                    "import-view-"
                            + UUID.nameUUIDFromBytes(
                                    (b.student() + "/" + b.lesson() + "/" + b.bundle())
                                            .getBytes(StandardCharsets.UTF_8));
            out.add(
                    new Material(
                            id,
                            b.student(),
                            b.lesson(),
                            b.bundle(),
                            "teacher",
                            "view",
                            "legacy-teacher-view",
                            id + ".json",
                            "application/json; charset=utf-8",
                            "Legacy teacher view",
                            group.getValue(),
                            null));
        }
        return out;
    }

    private static Binding binding(Material m) {
        return new Binding(m.student(), m.lesson(), m.bundle());
    }

    private JsonNode rewrite(
            JsonNode value,
            String field,
            Material owner,
            Map<String, Material> targets,
            String workspace) {
        if (value.isObject()) {
            var out = JSON.createObjectNode();
            for (var entry : value.properties())
                out.set(
                        entry.getKey(),
                        rewrite(entry.getValue(), entry.getKey(), owner, targets, workspace));
            return out;
        }
        if (value.isArray()) {
            var out = JSON.createArrayNode();
            for (var child : value) out.add(rewrite(child, field, owner, targets, workspace));
            return out;
        }
        if (!value.isString()
                || !(field.equals("html")
                        || field.equals("intro")
                        || field.endsWith("Html")
                        || field.equals("profileFacts"))) return value.deepCopy();
        var matcher = Pattern.compile("/api/materials/([A-Za-z0-9_-]+)").matcher(value.asText());
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            Material target = targets.get(matcher.group(1));
            if (target == null
                    || !target.student().equals(owner.student())
                    || (owner.audience().equals("student") && !target.audience().equals("student")))
                throw invalid("Prepared link has no authorized material target: " + owner.id());
            String route =
                    "/api/v1/workspaces/"
                            + workspace
                            + "/materials/"
                            + target.id()
                            + (target.kind().equals("download") ? "/file" : "");
            matcher.appendReplacement(out, java.util.regex.Matcher.quoteReplacement(route));
        }
        matcher.appendTail(out);
        return JSON.getNodeFactory().stringNode(out.toString());
    }
}
