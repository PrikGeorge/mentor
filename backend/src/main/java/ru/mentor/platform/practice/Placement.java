package ru.mentor.platform.practice;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum Placement {
    CLASS("class"),
    HOMEWORK("homework");
    private final String wire;

    Placement(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static Placement from(String value) {
        for (var p : values()) if (p.wire.equals(value)) return p;
        throw new IllegalArgumentException("Invalid placement.");
    }
}
