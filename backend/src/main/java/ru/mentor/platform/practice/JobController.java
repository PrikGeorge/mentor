package ru.mentor.platform.practice;

import static ru.mentor.platform.practice.PracticeJson.*;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Set;

@RestController
@RequestMapping("/internal/v1/jobs")
public class JobController {
    private final JobQueue queue;

    public JobController(JobQueue queue) {
        this.queue = queue;
    }

    @PostMapping(
            value = "/claim",
            consumes = {"application/json", "application/*+json"})
    public ResponseEntity<JobLease> claim(@RequestBody byte[] body) {
        var n = PracticeJson.read(body);
        fields(n, Set.of("workerId"), Set.of("workerId"));
        return queue.claim(text(n.get("workerId")))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping(
            value = "/{id}/heartbeat",
            consumes = {"application/json", "application/*+json"})
    public ResponseEntity<Void> heartbeat(@PathVariable String id, @RequestBody byte[] body) {
        var n = PracticeJson.read(body);
        fields(n, Set.of("leaseToken"), Set.of("leaseToken"));
        queue.heartbeat(id, token(n.get("leaseToken")));
        return ResponseEntity.noContent().build();
    }

    @PostMapping(
            value = "/{id}/complete",
            consumes = {"application/json", "application/*+json"})
    public ResponseEntity<Void> complete(@PathVariable String id, @RequestBody byte[] body) {
        var n = PracticeJson.read(body);
        fields(n, Set.of("leaseToken", "result"), Set.of("leaseToken", "result"));
        queue.complete(id, token(n.get("leaseToken")), new CheckResult(n.get("result")));
        return ResponseEntity.noContent().build();
    }

    private static String token(tools.jackson.databind.JsonNode n) {
        String t = text(n);
        if (t.isEmpty() || t.length() > 4096)
            throw new IllegalArgumentException("Lease token required.");
        return t;
    }
}
