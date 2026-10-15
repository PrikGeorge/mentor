package ru.mentor.platform.practice;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Repository
public class AttemptRepository {
    private final JdbcTemplate jdbc;
    private final ResultProjection projection;

    public AttemptRepository(JdbcTemplate jdbc, ResultProjection projection) {
        this.jdbc = jdbc;
        this.projection = projection;
    }

    record Stored(Attempt attempt, String hash) {}

    record Job(
            String id,
            String workspace,
            String attempt,
            JobPayload payload,
            String state,
            int grants,
            String tokenHash,
            Instant lease,
            Instant deadline) {}

    private Attempt attempt(ResultSet r) throws SQLException {
        return new Attempt(
                r.getString("id"),
                r.getString("exercise_id"),
                ExerciseRevision.fromJson(PracticeJson.read(r.getString("exercise_revision"))),
                r.getString("environment_revision"),
                Mode.valueOf(r.getString("mode")),
                r.getString("job_state"),
                SourceFiles.fromJson(PracticeJson.read(r.getString("files"))),
                r.getString("result") == null
                        ? null
                        : projection.project(
                                new CheckResult(PracticeJson.read(r.getString("result")))),
                r.getTimestamp("created_at").toInstant());
    }

    Optional<Stored> replay(AssignmentRef a, String user, String key) {
        return jdbc
                .query(
                        "SELECT * FROM practice_attempt WHERE workspace_id=? AND assignment_id=? AND account_id=? AND idempotency_key=?",
                        (r, n) -> new Stored(attempt(r), r.getString("payload_hash")),
                        a.workspaceId(),
                        a.id(),
                        user,
                        key)
                .stream()
                .findFirst();
    }

    Optional<Attempt> detail(AssignmentRef a, String id) {
        return jdbc
                .query(
                        "SELECT * FROM practice_attempt WHERE workspace_id=? AND assignment_id=? AND id=?",
                        (r, n) -> attempt(r),
                        a.workspaceId(),
                        a.id(),
                        id)
                .stream()
                .findFirst();
    }

    List<Attempt.Summary> list(AssignmentRef a, int page, int size) {
        return jdbc.query(
                "SELECT * FROM practice_attempt WHERE workspace_id=? AND assignment_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
                (r, n) -> attempt(r).summary(),
                a.workspaceId(),
                a.id(),
                size,
                (long) page * size);
    }

    long count(AssignmentRef a) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_attempt WHERE workspace_id=? AND assignment_id=?",
                Long.class,
                a.workspaceId(),
                a.id());
    }

    void insert(
            AssignmentRef a,
            String user,
            String key,
            String hash,
            JobPayload p,
            Instant now,
            String attempt,
            String job) {
        jdbc.update(
                "INSERT INTO practice_attempt(workspace_id,id,assignment_id,account_id,exercise_id,exercise_revision,environment_revision,mode,files,created_at,idempotency_key,payload_hash,job_state) VALUES(?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?,?,'queued')",
                a.workspaceId(),
                attempt,
                a.id(),
                user,
                p.exerciseId(),
                encode(p.exerciseRevision().toJson()),
                p.environment().get("revision").asText(),
                p.mode().name(),
                encode(p.files()),
                Timestamp.from(now),
                key,
                hash);
        jdbc.update(
                "INSERT INTO practice_job(id,workspace_id,attempt_id,payload,created_at,state) VALUES(?,?,?,?::jsonb,?,'queued')",
                job,
                a.workspaceId(),
                attempt,
                encode(p),
                Timestamp.from(now));
    }

    void capacityLock() {
        jdbc.queryForObject(
                "SELECT id FROM practice_queue_control WHERE id=1 FOR UPDATE", Integer.class);
    }

    int waiting() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_job WHERE state='queued'", Integer.class);
    }

    int reserved() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_job WHERE state IN ('running','retry_pending')",
                Integer.class);
    }

    int stateCount(String state) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM practice_job WHERE state=?", Integer.class, state);
    }

    Instant lastWorkerSeen() {
        return jdbc.queryForObject(
                "SELECT last_worker_seen_at FROM practice_queue_control WHERE id=1",
                (r, n) -> instant(r, "last_worker_seen_at"));
    }

    void workerSeen(Instant now) {
        jdbc.update(
                "UPDATE practice_queue_control SET last_worker_seen_at=? WHERE id=1",
                Timestamp.from(now));
    }

    private Job job(ResultSet r) throws SQLException {
        return new Job(
                r.getString("id"),
                r.getString("workspace_id"),
                r.getString("attempt_id"),
                JobPayload.decode(PracticeJson.read(r.getString("payload"))),
                r.getString("state"),
                r.getInt("grants"),
                r.getString("token_hash"),
                instant(r, "lease_expires_at"),
                instant(r, "deadline_at"));
    }

    private static Instant instant(ResultSet r, String name) throws SQLException {
        Timestamp t = r.getTimestamp(name);
        return t == null ? null : t.toInstant();
    }

    Optional<Job> job(String id) {
        return jdbc
                .query("SELECT * FROM practice_job WHERE id=? FOR UPDATE", (r, n) -> job(r), id)
                .stream()
                .findFirst();
    }

    List<Job> expired(Instant now) {
        return jdbc.query(
                "SELECT * FROM practice_job WHERE state='running' AND (lease_expires_at<=? OR deadline_at<=?) ORDER BY id LIMIT 128 FOR UPDATE SKIP LOCKED",
                (r, n) -> job(r),
                Timestamp.from(now),
                Timestamp.from(now));
    }

    Optional<Job> next(String state) {
        return jdbc
                .query(
                        "SELECT * FROM practice_job WHERE state=? ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
                        (r, n) -> job(r),
                        state)
                .stream()
                .findFirst();
    }

    void grant(Job job, String worker, String hash, Instant lease, Instant deadline) {
        jdbc.update(
                "UPDATE practice_job SET state='running',grants=grants+1,worker_id=?,token_hash=?,lease_expires_at=?,deadline_at=? WHERE id=?",
                worker,
                hash,
                Timestamp.from(lease),
                Timestamp.from(deadline),
                job.id());
        state(job, "running", null);
    }

    void renew(Job job, Instant expiry) {
        jdbc.update(
                "UPDATE practice_job SET lease_expires_at=? WHERE id=?",
                Timestamp.from(expiry),
                job.id());
    }

    void finish(Job job, CheckResult result) {
        if (result.infrastructure() && job.grants() < 2) {
            jdbc.update(
                    "UPDATE practice_job SET state='retry_pending',worker_id=NULL,token_hash=NULL,lease_expires_at=NULL,deadline_at=NULL WHERE id=?",
                    job.id());
            return;
        }
        String state = result.infrastructure() ? "failed" : "completed";
        jdbc.update(
                "UPDATE practice_job SET state=?,worker_id=NULL,token_hash=NULL,lease_expires_at=NULL,deadline_at=NULL WHERE id=?",
                state,
                job.id());
        state(job, state, result);
    }

    private void state(Job job, String state, CheckResult result) {
        jdbc.update(
                "UPDATE practice_attempt SET job_state=?,result=?::jsonb WHERE workspace_id=? AND id=?",
                state,
                result == null ? null : encode(result.value()),
                job.workspace(),
                job.attempt());
    }

    Optional<String> receipt(String job, String token) {
        return jdbc
                .query(
                        "SELECT result_hash FROM practice_completion_receipt WHERE job_id=? AND token_hash=?",
                        (r, n) -> r.getString(1),
                        job,
                        token)
                .stream()
                .findFirst();
    }

    void receipt(Job job, String token, String resultHash, Instant now) {
        jdbc.update(
                "INSERT INTO practice_completion_receipt(job_id,token_hash,result_hash,completed_at) VALUES(?,?,?,?)",
                job.id(),
                token,
                resultHash,
                Timestamp.from(now));
    }

    static String encode(Object value) {
        return PracticeJson.MAPPER.writeValueAsString(value);
    }
}
