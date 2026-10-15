package ru.mentor.platform.migration;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.Supplier;

/** Unforgeable outside this module; every mutation rechecks the durable generation on the protected SQL transaction. */
public final class OfflineImportLease {
    private final String id, digest, workspace, teacher, generation;
    private final JdbcTemplate jdbc;
    private final DatabaseGate gate;
    private final TransactionTemplate transaction;

    OfflineImportLease(
            String id,
            String digest,
            String workspace,
            String teacher,
            String generation,
            JdbcTemplate jdbc,
            DatabaseGate gate,
            TransactionTemplate transaction) {
        this.id = id;
        this.digest = digest;
        this.workspace = workspace;
        this.teacher = teacher;
        this.generation = generation;
        this.jdbc = jdbc;
        this.gate = gate;
        this.transaction = transaction;
    }

    public String importId() {
        return id;
    }

    public String workspaceId() {
        return workspace;
    }

    public String teacherId() {
        return teacher;
    }

    public void requireMutable() {
        gate.requireOffline();
        if (!TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Import mutation requires its fenced transaction.");
        var rows =
                jdbc.queryForList(
                        "SELECT generation FROM import_run WHERE id=? AND source_digest=? AND target_workspace=? AND source_teacher_id=? AND state='applying' FOR UPDATE",
                        id,
                        digest,
                        workspace,
                        teacher);
        if (rows.size() != 1 || !generation.equals(rows.getFirst().get("generation")))
            throw new IllegalStateException("Import generation no longer owns this run.");
    }

    public void requireBinding(String student, String lesson) {
        requireMutable();
        if (jdbc.queryForObject(
                                "SELECT count(*) FROM student_profile WHERE workspace_id=? AND id=?",
                                Integer.class,
                                workspace,
                                student)
                        != 1
                || lesson != null
                        && jdbc.queryForObject(
                                        "SELECT count(*) FROM lesson WHERE workspace_id=? AND student_id=? AND id=?",
                                        Integer.class,
                                        workspace,
                                        student,
                                        lesson)
                                != 1)
            throw new IllegalArgumentException("Import blob owner is not part of this workspace.");
    }

    public <T> T write(Supplier<T> action) {
        return transaction.execute(
                s -> {
                    requireMutable();
                    return action.get();
                });
    }

    public void reservation(String id, String path) {
        requireMutable();
        jdbc.update(
                "INSERT INTO import_blob_reservation(reservation_id,import_id,generation,source_path) VALUES(?,?,?,?)",
                id,
                this.id,
                generation,
                path);
    }

    public void requireReservation(String reservationId) {
        requireMutable();
        if (jdbc.queryForObject(
                        "SELECT count(*) FROM import_blob_reservation WHERE reservation_id=? AND import_id=? AND generation=?",
                        Integer.class,
                        reservationId,
                        id,
                        generation)
                != 1)
            throw new IllegalStateException(
                    "Blob reservation is not owned by this import generation.");
    }
}
