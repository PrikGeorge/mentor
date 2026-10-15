package ru.mentor.platform.materials;

import org.commonmark.Extension;
import org.commonmark.ext.gfm.tables.TablesExtension;
import org.commonmark.parser.Parser;
import org.commonmark.renderer.html.HtmlRenderer;

import java.util.*;

/**
 * Turns a teacher's Markdown into the stored "doc" payload: the title from the first level-one heading, an intro,
 * and one section per level-two heading. This is the same shape the kit publication scripts produce, so the
 * student and teacher screens render both sources identically.
 */
public final class MarkdownDocument {
    private static final List<Extension> EXTENSIONS = List.of(TablesExtension.create());
    private static final Parser PARSER = Parser.builder().extensions(EXTENSIONS).build();
    private static final HtmlRenderer RENDERER =
            HtmlRenderer.builder().extensions(EXTENSIONS).build();

    private MarkdownDocument() {}

    public static Map<String, Object> payload(String markdown, String fallbackTitle) {
        List<String> lines = markdown.lines().toList();
        String title =
                lines.stream()
                        .filter(line -> line.startsWith("# "))
                        .map(line -> line.substring(2).strip())
                        .filter(value -> !value.isEmpty())
                        .findFirst()
                        .orElse(fallbackTitle);
        List<Integer> starts = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++)
            if (lines.get(i).startsWith("## ") && !lines.get(i).substring(3).isBlank())
                starts.add(i);
        int bodyStart = lines.isEmpty() ? 0 : (lines.get(0).startsWith("# ") ? 1 : 0);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("title", title);
        if (starts.isEmpty()) {
            out.put("intro", "");
            out.put("raw", markdown);
            out.put("html", render(lines, bodyStart, lines.size()));
            out.put("sections", List.of());
            return out;
        }
        out.put("intro", render(lines, bodyStart, starts.get(0)));
        out.put("raw", markdown);
        out.put("html", "");
        List<Map<String, Object>> sections = new ArrayList<>();
        for (int position = 0; position < starts.size(); position++) {
            int start = starts.get(position),
                    end = position + 1 < starts.size() ? starts.get(position + 1) : lines.size();
            Map<String, Object> section = new LinkedHashMap<>();
            section.put("id", "section-" + position);
            section.put("title", lines.get(start).substring(3).strip());
            section.put("html", render(lines, start + 1, end));
            sections.add(section);
        }
        out.put("sections", sections);
        return out;
    }

    private static String render(List<String> lines, int from, int to) {
        if (from >= to) return "";
        return RENDERER.render(PARSER.parse(String.join("\n", lines.subList(from, to)) + "\n"))
                .strip();
    }
}
