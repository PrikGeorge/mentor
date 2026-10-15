package ru.mentor.platform.practice;

import tools.jackson.databind.JsonNode;

import java.util.*;

/** Validated live worker result; only ResultProjection's explicit DTO is public. */
public record CheckResult(JsonNode value) {
    static final Set<String> VERDICTS =
            Set.of(
                    "accepted",
                    "wrong_answer",
                    "compile_error",
                    "runtime_error",
                    "time_limit",
                    "error",
                    "unavailable");
    static final Set<String> TEST_VERDICTS =
            Set.of("accepted", "wrong_answer", "runtime_error", "time_limit");

    public CheckResult {
        if (value == null) throw invalid();
        value = value.deepCopy();
    }

    public JsonNode value() {
        return value.deepCopy();
    }

    public String status() {
        return value.get("status").asText();
    }

    public boolean infrastructure() {
        return Set.of("error", "unavailable").contains(status());
    }

    public void validate(JobPayload payload) {
        var n = value;
        PracticeJson.fields(
                n,
                Set.of("status", "passed", "total", "elapsedMs", "diagnostics", "tests"),
                Set.of("status", "passed", "total", "elapsedMs", "tests"));
        if (!VERDICTS.contains(PracticeJson.text(n.get("status")))) throw invalid();
        int passed = (int) number(n.get("passed"), 100), total = (int) number(n.get("total"), 100);
        number(n.get("elapsedMs"), Long.MAX_VALUE);
        if (passed > total
                || !n.get("tests").isArray()
                || n.get("tests").size() > 100
                || PracticeJson.MAPPER.writeValueAsString(n).length() > 32000) throw invalid();
        var selected = payload.exercise().get("tests");
        if ((total != selected.size() && !(infrastructure() && total == 0))
                || n.get("tests").size() > total) throw invalid();
        if (n.has("diagnostics")) string(n.get("diagnostics"));
        int accepted = 0, index = 0;
        for (var t : n.get("tests")) {
            PracticeJson.fields(
                    t,
                    Set.of("name", "status", "expected", "actual", "message", "stdout"),
                    Set.of("name", "status"));
            String name = string(t.get("name")), status = string(t.get("status"));
            if (!TEST_VERDICTS.contains(status)
                    || !selected.get(index++).get("name").asText().equals(name)) throw invalid();
            if (status.equals("accepted")) accepted++;
            for (String field : List.of("message", "stdout"))
                if (t.has(field)) string(t.get(field));
            for (String field : List.of("expected", "actual"))
                if (t.has(field)) unicode(t.get(field));
        }
        if (passed != accepted
                || status().equals("accepted") && (total == 0 || passed != total || index != total)
                || status().equals("wrong_answer")
                        && (passed == total
                                || index != total
                                || java.util.stream.StreamSupport.stream(
                                                n.get("tests").spliterator(), false)
                                        .noneMatch(
                                                t ->
                                                        t.get("status")
                                                                .asText()
                                                                .equals("wrong_answer")))
                || status().equals("compile_error") && (passed != 0 || index != 0)) throw invalid();
    }

    private static long number(JsonNode n, long max) {
        if (n == null
                || !n.isIntegralNumber()
                || !n.canConvertToLong()
                || n.asLong() < 0
                || n.asLong() > max) throw invalid();
        return n.asLong();
    }

    private static String string(JsonNode n) {
        String text = PracticeJson.text(n);
        if (!SourceFiles.wellFormed(text)) throw invalid();
        return text;
    }

    private static void unicode(JsonNode n) {
        if (n.isString()) string(n);
        if (n.isNumber() && !Double.isFinite(n.decimalValue().doubleValue())) throw invalid();
        if (n.isObject())
            for (String key : n.propertyNames()) if (!SourceFiles.wellFormed(key)) throw invalid();
        if (n.isContainer()) for (var child : n) unicode(child);
    }

    static CheckResult unavailable() {
        return new CheckResult(
                PracticeJson.read(
                        "{\"status\":\"unavailable\",\"passed\":0,\"total\":0,\"elapsedMs\":0,\"diagnostics\":\"Worker lease expired.\",\"tests\":[]}"));
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Invalid worker result.");
    }
}
