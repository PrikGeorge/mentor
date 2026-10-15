package ru.mentor.platform.practice;

import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Shared source contract for templates, drafts and the later enqueue boundary. */
public final class SourceFiles {
    private SourceFiles() {}

    public static boolean javaPath(String name) {
        return name != null
                && name.matches("(?:[A-Za-z_$][A-Za-z0-9_$]*/)*[A-Za-z_$][A-Za-z0-9_$]*\\.java");
    }

    public static boolean wellFormed(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= text.length() || !Character.isLowSurrogate(text.charAt(i))) return false;
            } else if (Character.isLowSurrogate(c)) return false;
        }
        return true;
    }

    public static Map<String, String> fromJson(JsonNode node) {
        if (node == null || !node.isObject())
            throw new IllegalArgumentException("Source map required.");
        Map<String, String> files = new TreeMap<>();
        node.properties()
                .forEach(
                        e -> {
                            if (!e.getValue().isString())
                                throw new IllegalArgumentException("Java source must be text.");
                            files.put(e.getKey(), e.getValue().asText());
                        });
        return files;
    }

    public static Map<String, String> validate(Map<String, String> files, Set<String> declared) {
        if (files == null
                || files.isEmpty()
                || files.size() > 16
                || !files.keySet().equals(declared))
            throw new IllegalArgumentException("Submit exactly the declared Java files.");
        long total = 0;
        for (var e : files.entrySet()) {
            String s = e.getValue();
            if (!javaPath(e.getKey()) || s == null || s.indexOf(0) >= 0 || !wellFormed(s))
                throw new IllegalArgumentException("Invalid Java source.");
            int bytes = s.getBytes(StandardCharsets.UTF_8).length;
            if (bytes > 131072)
                throw new IllegalArgumentException("Java source exceeds its byte limit.");
            total += bytes;
        }
        if (total > 262144)
            throw new IllegalArgumentException("Java sources exceed their total byte limit.");
        return Collections.unmodifiableMap(new TreeMap<>(files));
    }
}
