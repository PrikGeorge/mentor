package ru.mentor.platform.roadmap;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.StudentService;

import java.util.*;

@Service
public class RoadmapService {
    public static final int MAXIMUM_STAGES = 30;
    private static final Set<String> STATES = Set.of("done", "current", "ahead");

    public record View(List<RoadmapRepository.Stage> stages, long revision) {}

    private final RoadmapRepository repository;
    private final StudentService students;

    public RoadmapService(RoadmapRepository repository, StudentService students) {
        this.repository = repository;
        this.students = students;
    }

    // Stages are student-visible, so the teacher's preview audience only has to be valid.
    public View get(Actor actor, String workspace, String student, String audience) {
        if (audience != null && !audience.equals("student"))
            throw new IllegalArgumentException("Invalid audience.");
        students.requireReader(actor, workspace, student);
        return new View(
                repository.stages(workspace, student), repository.revision(workspace, student));
    }

    @Transactional
    public View replace(Actor actor, String workspace, String student, Map<String, Object> input) {
        students.lockTeacherCard(actor, workspace, student);
        if (!input.keySet().equals(Set.of("stages", "revision")))
            throw new IllegalArgumentException("Stages and revision required.");
        if (!(input.get("revision") instanceof Number n)
                || n.longValue() < 1
                || n.doubleValue() != n.longValue())
            throw new IllegalArgumentException("Integer revision required.");
        if (!(input.get("stages") instanceof List<?> raw) || raw.size() > MAXIMUM_STAGES)
            throw new IllegalArgumentException("At most " + MAXIMUM_STAGES + " stages.");
        List<RoadmapRepository.Stage> stages = new ArrayList<>();
        int current = 0;
        for (Object item : raw) {
            if (!(item instanceof Map<?, ?> stage)
                    || !Set.of("title", "note", "state").containsAll(stage.keySet())
                    || !stage.keySet().containsAll(Set.of("title", "state")))
                throw new IllegalArgumentException("Invalid stage.");
            String title = text(stage.get("title"), 200, false),
                    note = stage.containsKey("note") ? text(stage.get("note"), 120, true) : "";
            if (!(stage.get("state") instanceof String state) || !STATES.contains(state))
                throw new IllegalArgumentException("Invalid stage state.");
            if (state.equals("current") && ++current > 1)
                throw new IllegalArgumentException("Only one current stage.");
            stages.add(new RoadmapRepository.Stage(title, note, state));
        }
        if (!repository.replace(workspace, student, n.longValue(), stages))
            throw new ApiFailure(409, "REVISION_CONFLICT", "Route changed. Refresh before saving.");
        return new View(
                repository.stages(workspace, student), repository.revision(workspace, student));
    }

    private static String text(Object value, int limit, boolean blank) {
        if (!(value instanceof String s)) throw new IllegalArgumentException("Text required.");
        String trimmed =
                s.replaceAll(
                        "^[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+|[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+$",
                        "");
        if ((!blank && trimmed.isEmpty()) || trimmed.length() > limit)
            throw new IllegalArgumentException("Invalid text length.");
        return trimmed;
    }
}
