package ru.mentor.platform.practice;

import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.*;

@Component
public class CatalogCommand {
    private final CatalogService catalog;

    public CatalogCommand(CatalogService catalog) {
        this.catalog = catalog;
    }

    public CatalogService.CatalogReport run(String[] args) {
        Set<String> flags =
                Set.of(
                        "--source",
                        "--workspace",
                        "--environment-manifest",
                        "--environment-manifest-sha256",
                        "--environment-profiles-sha256");
        Map<String, String> values = new HashMap<>();
        if (args.length != 10)
            throw new IllegalArgumentException("Supply the five operator catalog options.");
        for (int i = 0; i < args.length; i += 2)
            if (!flags.contains(args[i])
                    || args[i + 1].isEmpty()
                    || values.put(args[i], args[i + 1]) != null)
                throw new IllegalArgumentException("Invalid catalog options.");
        return catalog.publish(
                Path.of(values.get("--source")),
                values.get("--workspace"),
                Path.of(values.get("--environment-manifest")),
                values.get("--environment-manifest-sha256"),
                values.get("--environment-profiles-sha256"));
    }
}
