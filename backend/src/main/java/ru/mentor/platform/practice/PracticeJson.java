package ru.mentor.platform.practice;

import tools.jackson.databind.*;
import tools.jackson.databind.cfg.JsonNodeFeature;
import tools.jackson.databind.json.JsonMapper;

import java.util.Set;

/** Scoped parser: do not round fractional revisions before validating exact integrality. */
public final class PracticeJson {
    static final ObjectMapper MAPPER =
            JsonMapper.builder()
                    .enable(JsonNodeFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                    .enable(
                            DeserializationFeature.USE_BIG_INTEGER_FOR_INTS,
                            DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY,
                            DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    public static JsonNode read(String input) {
        try {
            return MAPPER.readTree(input);
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException("Invalid JSON.");
        }
    }

    public static JsonNode read(byte[] input) {
        try {
            return MAPPER.readTree(input);
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException("Invalid JSON.");
        }
    }

    static void fields(JsonNode input, Set<String> allowed, Set<String> required) {
        if (input == null
                || !input.isObject()
                || !allowed.containsAll(input.propertyNames())
                || !input.propertyNames().containsAll(required))
            throw new IllegalArgumentException("Invalid input fields.");
    }

    static String text(JsonNode value) {
        if (value == null || !value.isString())
            throw new IllegalArgumentException("Text required.");
        return value.asText();
    }

    private PracticeJson() {}
}
