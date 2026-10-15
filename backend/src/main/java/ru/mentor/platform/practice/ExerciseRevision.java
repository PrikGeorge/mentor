package ru.mentor.platform.practice;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;

import java.math.BigDecimal;

/** Scalar type is part of identity; numeric token formatting is not. */
public record ExerciseRevision(String key, JsonNode value) {
    public ExerciseRevision {
        if (key == null || value == null) throw new IllegalArgumentException("Revision required.");
        String canonical =
                value.isString()
                        ? "s:" + value.asText()
                        : value.isIntegralNumber() ? "n:" + value.asLong() : null;
        if (!key.equals(canonical)) throw new IllegalArgumentException("Invalid revision.");
        if (value.isString()) validateString(value.asText());
        else if (!value.canConvertToLong()
                || value.asLong() < 0
                || value.asLong() > 9007199254740991L)
            throw new IllegalArgumentException("Invalid revision.");
    }

    @JsonCreator
    public static ExerciseRevision fromJson(JsonNode value) {
        if (value == null) throw new IllegalArgumentException("Revision required.");
        if (value.isString()) {
            String s = value.asText();
            validateString(s);
            return new ExerciseRevision("s:" + s, JsonNodeFactory.instance.stringNode(s));
        }
        if (value.isNumber())
            try {
                BigDecimal n = value.decimalValue();
                long exact = n.longValueExact();
                if (exact < 0 || exact > 9007199254740991L)
                    throw new IllegalArgumentException("Invalid revision.");
                return new ExerciseRevision(
                        "n:" + exact, JsonNodeFactory.instance.numberNode(exact));
            } catch (ArithmeticException invalid) {
                throw new IllegalArgumentException("Invalid revision.");
            }
        throw new IllegalArgumentException("Revision must be a string or safe integer.");
    }

    @JsonValue
    public JsonNode toJson() {
        return value;
    }

    static void validateString(String s) {
        if (s.isEmpty() || s.length() > 100 || !SourceFiles.wellFormed(s))
            throw new IllegalArgumentException("Invalid revision.");
    }
}
