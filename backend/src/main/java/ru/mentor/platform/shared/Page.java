package ru.mentor.platform.shared;

import java.util.List;

public record Page<T>(List<T> items, int page, int size, long total) {
    public Page {
        if (page < 0 || size < 1 || size > 100 || total < 0) throw new IllegalArgumentException("Invalid pagination.");
        items = List.copyOf(items);
    }
    public static final int DEFAULT_SIZE = 25;
}
