package ru.mentor.platform.files;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.*;
import java.time.*;
import java.util.*;

@Repository
public class BlobRepository {
    public enum State {
        RESERVED,
        STAGED,
        ATTACHED,
        DELETING,
        DELETED
    }

    public record Reservation(
            String id,
            String key,
            String workspaceId,
            String studentId,
            String lessonId,
            String uploaderId,
            String leaseToken,
            Instant leaseUntil,
            Instant expiresAt,
            Instant settleAfter,
            State state,
            Long size,
            String sha256,
            String attachedBlobId) {}

    public record DeleteClaim(
            String reservationId, String key, String claimToken, Instant claimUntil) {}

    public record Stored(
            String id,
            String workspaceId,
            String studentId,
            String lessonId,
            String key,
            String filename,
            String contentType,
            long size,
            String sha256) {}

    private final JdbcTemplate jdbc;

    public BlobRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Instant instant(ResultSet r, String name) throws SQLException {
        return r.getTimestamp(name).toInstant();
    }

    private static final RowMapper<Reservation> RESERVATION =
            (r, n) ->
                    new Reservation(
                            r.getString("id"),
                            r.getString("object_key"),
                            r.getString("workspace_id"),
                            r.getString("student_id"),
                            r.getString("lesson_id"),
                            r.getString("uploader_id"),
                            r.getString("lease_token"),
                            instant(r, "lease_until"),
                            instant(r, "expires_at"),
                            instant(r, "settle_after"),
                            State.valueOf(r.getString("state")),
                            (Long) r.getObject("size"),
                            r.getString("sha256"),
                            r.getString("attached_blob_id"));

    public Reservation reserve(
            String id,
            String key,
            String workspace,
            String student,
            String uploader,
            String token,
            Instant now,
            Instant until) {
        return reserve(
                id,
                key,
                workspace,
                student,
                null,
                uploader,
                token,
                now,
                until,
                until,
                until.plusSeconds(90));
    }

    public Reservation reserve(
            String id,
            String key,
            String workspace,
            String student,
            String lesson,
            String uploader,
            String token,
            Instant now,
            Instant until,
            Instant expires,
            Instant settle) {
        jdbc.update(
                "INSERT INTO blob_reservation(id,object_key,workspace_id,student_id,lesson_id,uploader_id,lease_token,lease_until,expires_at,settle_after,state) VALUES (?,?,?,?,?,?,?,?,?,?,'RESERVED')",
                id,
                key,
                workspace,
                student,
                lesson,
                uploader,
                token,
                Timestamp.from(until),
                Timestamp.from(expires),
                Timestamp.from(settle));
        return find(key, false).orElseThrow();
    }

    public boolean renew(String id, String token, Instant now, Instant until) {
        return jdbc.update(
                        "UPDATE blob_reservation SET lease_until=least(?,expires_at) WHERE id=? AND lease_token=? AND state IN ('RESERVED','STAGED') AND lease_until>? AND expires_at>?",
                        Timestamp.from(until),
                        id,
                        token,
                        Timestamp.from(now),
                        Timestamp.from(now))
                == 1;
    }

    public boolean markStaged(
            String id, String token, long size, String sha, Instant now, Instant until) {
        return jdbc.update(
                        "UPDATE blob_reservation SET state='STAGED',size=?,sha256=?,lease_until=least(?,expires_at) WHERE id=? AND lease_token=? AND state='RESERVED' AND lease_until>? AND expires_at>?",
                        size,
                        sha,
                        Timestamp.from(until),
                        id,
                        token,
                        Timestamp.from(now),
                        Timestamp.from(now))
                == 1;
    }

    public Optional<Reservation> lockForAttach(String key) {
        return find(key, true);
    }

    private Optional<Reservation> find(String key, boolean lock) {
        return jdbc
                .query(
                        "SELECT * FROM blob_reservation WHERE object_key=?"
                                + (lock ? " FOR UPDATE" : ""),
                        RESERVATION,
                        key)
                .stream()
                .findFirst();
    }

    public void markAttached(String id, String blobId, Instant now) {
        if (jdbc.update(
                        "UPDATE blob_reservation SET state='ATTACHED',attached_blob_id=? WHERE id=? AND state='STAGED' AND lease_until>?",
                        blobId,
                        id,
                        Timestamp.from(now))
                != 1) throw new IllegalStateException("Attachment lease lost.");
    }

    public void insert(Reservation r, String id, String filename, String type, Instant now) {
        jdbc.update(
                "INSERT INTO stored_blob(workspace_id,id,student_id,lesson_id,reservation_id,filename,content_type,size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                r.workspaceId(),
                id,
                r.studentId(),
                r.lessonId(),
                r.id(),
                filename,
                type,
                r.size(),
                r.sha256(),
                Timestamp.from(now));
    }

    // Detaching returns the reservation to an already expired STAGED state, so the janitor deletes
    // the object like any abandoned upload.
    public boolean release(String workspace, String blobId, Instant now) {
        var found =
                jdbc
                        .query(
                                "SELECT reservation_id FROM stored_blob WHERE workspace_id=? AND id=?",
                                (r, n) -> r.getString(1),
                                workspace,
                                blobId)
                        .stream()
                        .findFirst();
        if (found.isEmpty()) return false;
        Timestamp at = Timestamp.from(now);
        if (jdbc.update(
                        "UPDATE blob_reservation SET state='STAGED',attached_blob_id=NULL,lease_until=?,expires_at=?,settle_after=? WHERE workspace_id=? AND id=? AND state='ATTACHED'",
                        at,
                        at,
                        at,
                        workspace,
                        found.get())
                != 1) return false;
        return jdbc.update(
                        "DELETE FROM stored_blob WHERE workspace_id=? AND id=?", workspace, blobId)
                == 1;
    }

    public Optional<Stored> stored(String workspace, String id) {
        return jdbc
                .query(
                        "SELECT b.*,r.object_key FROM stored_blob b JOIN blob_reservation r ON r.workspace_id=b.workspace_id AND r.id=b.reservation_id WHERE b.workspace_id=? AND b.id=? AND r.state='ATTACHED'",
                        (r, n) ->
                                new Stored(
                                        r.getString("id"),
                                        r.getString("workspace_id"),
                                        r.getString("student_id"),
                                        r.getString("lesson_id"),
                                        r.getString("object_key"),
                                        r.getString("filename"),
                                        r.getString("content_type"),
                                        r.getLong("size"),
                                        r.getString("sha256")),
                        workspace,
                        id)
                .stream()
                .findFirst();
    }

    public List<DeleteClaim> claimExpiredForDelete(Instant now, int batchSize, Duration lease) {
        return claimExpiredForDelete(now, batchSize, lease, Duration.ofSeconds(60));
    }

    public List<DeleteClaim> claimExpiredForDelete(
            Instant now, int batchSize, Duration lease, Duration grace) {
        var rows =
                jdbc.query(
                        "SELECT * FROM blob_reservation WHERE (state IN ('RESERVED','STAGED') AND lease_until<=?) OR (state='DELETING' AND claim_until<=?) ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED",
                        RESERVATION,
                        Timestamp.from(now.minus(grace)),
                        Timestamp.from(now),
                        batchSize);
        List<DeleteClaim> claims = new ArrayList<>();
        for (var row : rows) {
            String token = UUID.randomUUID().toString();
            Instant until = now.plus(lease);
            jdbc.update(
                    "UPDATE blob_reservation SET state='DELETING',claim_token=?,claim_until=? WHERE id=?",
                    token,
                    Timestamp.from(until),
                    row.id());
            claims.add(new DeleteClaim(row.id(), row.key(), token, until));
        }
        return claims;
    }

    public boolean markDeleted(String id, String token, Instant now) {
        // Before the late-write window closes, retain a reclaimable tombstone and delete again.
        return jdbc.update(
                        "UPDATE blob_reservation SET state='DELETED' WHERE id=? AND state='DELETING' AND claim_token=? AND claim_until>? AND settle_after<=?",
                        id,
                        token,
                        Timestamp.from(now),
                        Timestamp.from(now))
                == 1;
    }
}
