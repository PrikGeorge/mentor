package ru.mentor.platform.comments;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.homework.Grade;
import ru.mentor.platform.homework.HomeworkService;
import ru.mentor.platform.lessons.*;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.WorkspaceAccess;

import java.io.IOException;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class CodeCommentService {
    public static final int MAXIMUM_PER_TARGET = 200;
    private final CodeCommentRepository repository;
    private final LessonService lessons;
    private final StudentService students;
    private final HomeworkService homework;
    private final Clock clock;

    public CodeCommentService(
            CodeCommentRepository repository,
            LessonService lessons,
            StudentService students,
            HomeworkService homework,
            Clock clock) {
        this.repository = repository;
        this.lessons = lessons;
        this.students = students;
        this.homework = homework;
        this.clock = clock;
    }

    // Comments explain the student's own code, so they are student-visible; a preview audience only
    // has to be valid.
    public List<CodeCommentRepository.Comment> list(
            Actor actor, LessonRef lesson, String kind, String target, String audience) {
        if (audience != null && !audience.equals("student"))
            throw new IllegalArgumentException("Invalid audience.");
        lessons.requireReader(actor, lesson.workspaceId(), lesson.studentId(), lesson.id());
        return repository.list(lesson, kind(kind), id(target));
    }

    @Transactional
    public CodeCommentRepository.Comment create(
            Actor actor, LessonRef lesson, Map<String, Object> input) throws IOException {
        students.lockTeacherCard(actor, lesson.workspaceId(), lesson.studentId());
        lessons.requireReader(actor, lesson.workspaceId(), lesson.studentId(), lesson.id());
        if (!Set.of("targetKind", "targetId", "file", "line", "grade", "body", "variant")
                        .containsAll(input.keySet())
                || !input.keySet()
                        .containsAll(Set.of("targetKind", "targetId", "file", "line", "body")))
            throw new IllegalArgumentException("Comment fields required.");
        String kind = kind(input.get("targetKind")), target = id(input.get("targetId"));
        if (!(input.get("file") instanceof String file)
                || !(input.get("line") instanceof Integer line))
            throw new IllegalArgumentException("File and line required.");
        Object rawGrade = input.get("grade");
        if (rawGrade != null && !(rawGrade instanceof String))
            throw new IllegalArgumentException("Invalid grade.");
        String grade = rawGrade == null ? null : Grade.valueOf((String) rawGrade).name();
        String body = text(input.get("body")),
                variant = input.containsKey("variant") ? code(input.get("variant")) : "";
        String content =
                kind.equals("homework")
                        ? homeworkText(actor, lesson, target, file)
                        : attemptText(lesson, target, file);
        if (line < 1 || line > content.split("\n", -1).length)
            throw new IllegalArgumentException("Line outside the file.");
        if (repository.count(lesson, kind, target) >= MAXIMUM_PER_TARGET)
            throw new ApiFailure(409, "COMMENT_LIMIT", "Too many comments for this code.");
        var comment =
                new CodeCommentRepository.Comment(
                        UUID.randomUUID().toString(),
                        kind,
                        target,
                        file,
                        line,
                        grade,
                        body,
                        variant,
                        clock.instant().truncatedTo(ChronoUnit.MICROS));
        repository.insert(lesson, comment);
        return comment;
    }

    @Transactional
    public void delete(Actor actor, LessonRef lesson, String id) {
        students.lockTeacherCard(actor, lesson.workspaceId(), lesson.studentId());
        if (!repository.delete(lesson, id(id))) throw WorkspaceAccess.missing();
    }

    private String homeworkText(Actor actor, LessonRef lesson, String target, String file)
            throws IOException {
        var text = homework.text(actor, lesson, target);
        if (!text.filename().equals(file)) throw new IllegalArgumentException("Unknown file.");
        return text.text();
    }

    private String attemptText(LessonRef lesson, String target, String file) {
        var files = repository.attemptFiles(lesson, target).orElseThrow(WorkspaceAccess::missing);
        if (!files.containsKey(file)) throw new IllegalArgumentException("Unknown file.");
        return files.get(file);
    }

    private static String kind(Object value) {
        if (!(value instanceof String s) || !Set.of("homework", "attempt").contains(s))
            throw new IllegalArgumentException("Invalid target.");
        return s;
    }

    private static String id(Object value) {
        if (!(value instanceof String s) || s.isBlank() || s.length() > 100)
            throw new IllegalArgumentException("Invalid id.");
        return s;
    }

    private static String text(Object value) {
        if (!(value instanceof String s)) throw new IllegalArgumentException("Text required.");
        String trimmed = s.strip();
        if (trimmed.isEmpty() || trimmed.length() > 2000)
            throw new IllegalArgumentException("Invalid text length.");
        return trimmed;
    }

    // A code variant keeps its indentation; only trailing blank lines go.
    private static String code(Object value) {
        if (!(value instanceof String s) || s.length() > 2000)
            throw new IllegalArgumentException("Invalid variant.");
        return s.stripTrailing();
    }
}
