package ru.mentor.platform.migration;

import static ru.mentor.platform.migration.LegacyReader.*;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import ru.mentor.platform.files.*;
import ru.mentor.platform.identity.*;
import ru.mentor.platform.practice.*;

import tools.jackson.databind.*;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.function.*;

import javax.sql.DataSource;

@Service
@ConditionalOnNotWebApplication
public class LegacyImportService {
    @FunctionalInterface
    public interface Checkpoint {
        void reached(String name);
    }

    private record Blob(
            String id,
            String student,
            String lesson,
            String path,
            String filename,
            String type,
            long size,
            String sha,
            Instant createdAt) {}

    private final JdbcTemplate jdbc;
    private final DatabaseGate gate;
    private final TransactionTemplate transaction;
    private final BlobService blobs;
    private final BlobStore store;
    private final CatalogImport catalog;
    private final PasswordCodec passwords;
    private final Environment config;
    private final Clock clock;
    private final Checkpoint checkpoint;
    private final long maximum;

    public LegacyImportService(
            JdbcTemplate jdbc,
            DataSource source,
            PlatformTransactionManager manager,
            BlobService blobs,
            BlobStore store,
            CatalogImport catalog,
            PasswordCodec passwords,
            Environment config,
            Clock clock,
            ObjectProvider<Checkpoint> checkpoints) {
        this.jdbc = jdbc;
        gate = (DatabaseGate) source;
        transaction = new TransactionTemplate(manager);
        transaction.setTimeout(30);
        this.blobs = blobs;
        this.store = store;
        this.catalog = catalog;
        this.passwords = passwords;
        this.config = config;
        this.clock = clock;
        checkpoint = checkpoints.getIfAvailable(() -> name -> {});
        maximum = config.getProperty("mentor.materials.maximum-bytes", Long.class, 67108864L);
    }

    public ImportReport inspect(Path source, String id) {
        try {
            validateId(id);
            return report(id, read(source), null, false);
        } catch (Exception e) {
            return rejected(id, null, e);
        }
    }

    private Plan read(Path source) throws IOException {
        String approval = config.getProperty("mentor.practice.environment-manifest");
        if (approval == null) throw invalid("Operator environment approval is required.");
        return new LegacyReader(maximum)
                .read(
                        source,
                        Path.of(approval),
                        config.getProperty("mentor.practice.environment-manifest-sha256"),
                        config.getProperty("mentor.practice.environment-profiles-sha256"));
    }

    public ImportReport apply(Path source, String id, String workspace) {
        Plan plan = null;
        try {
            validateId(id);
            validateId(workspace);
            gate.requireOffline();
            plan = read(source);
            if (!plan.teacherId().equals(config.getProperty("mentor.import.teacher-id")))
                throw invalid(
                        "Explicit teacher account selection differs from the sole source teacher.");
            final Plan fixed = plan;
            var materials =
                    new MaterialConverter()
                            .convert(
                                    plan.root(),
                                    plan.manifest(),
                                    plan.content(),
                                    plan.mentoring(),
                                    workspace,
                                    maximum);
            var run = claim(plan, id, workspace);
            verifySourceLedger(plan, id);
            String generation = run.get("generation").toString();
            if (run.get("state").equals("completed")) {
                verifyLedger(id, workspace);
                verifySource(plan);
                verifyObjects(id, workspace);
                return JSON.readValue(run.get("report").toString(), ImportReport.class);
            }
            var lease =
                    new OfflineImportLease(
                            id,
                            plan.digest(),
                            workspace,
                            plan.teacherId(),
                            generation,
                            jdbc,
                            gate,
                            transaction);
            checkpoint.reached("run-created");
            verifyLedger(id, workspace);
            phase(lease, "skeleton", () -> skeleton(fixed, lease));
            checkpoint.reached("skeleton-attached");
            phase(lease, "practice", () -> practice(fixed, lease));
            checkpoint.reached("practice-attached");
            for (var object :
                    objects(plan, materials, ((Timestamp) run.get("created_at")).toInstant())) {
                if (hasEntity(id, "blob", object.id())) {
                    verifyObjectMetadata(workspace, object);
                    continue;
                }
                BlobStore.StagedBlob staged;
                try (var input =
                        Files.newInputStream(
                                safe(plan.root(), object.path()), LinkOption.NOFOLLOW_LINKS)) {
                    checkpoint.reached("before-stage");
                    staged =
                            blobs.stageForImport(
                                    lease,
                                    object.student(),
                                    object.lesson(),
                                    object.path(),
                                    input,
                                    maximum,
                                    object.size());
                }
                checkpoint.reached("blob-staged");
                if (staged.size() != object.size() || !staged.sha256().equals(object.sha()))
                    throw invalid("Staged blob differs from inspected source: " + object.path());
                lease.write(
                        () -> {
                            blobs.attachForImport(
                                    lease,
                                    object.student(),
                                    object.lesson(),
                                    staged,
                                    object.id(),
                                    object.createdAt(),
                                    object.filename(),
                                    object.type());
                            record(
                                    lease,
                                    "blob",
                                    object.id(),
                                    fingerprint("blob", workspace, object.id()));
                            return null;
                        });
                checkpoint.reached("blob-attached");
            }
            phase(lease, "materials", () -> materials(materials, lease));
            phase(lease, "homework", () -> homework(fixed, lease));
            checkpoint.reached("domain-attached");
            verifySource(plan);
            verifyObjects(id, workspace);
            verifyLedger(id, workspace);
            var completed = report(id, plan, materials, true);
            verifyCounts(completed.counts(), workspace, id);
            checkpoint.reached("before-finalize");
            lease.write(
                    () -> {
                        try {
                            verifySource(fixed);
                        } catch (IOException e) {
                            throw invalid("Source became unavailable before finalization.");
                        }
                        verifySourceLedger(fixed, id);
                        verifyLedger(id, workspace);
                        checkpoint.reached("finalize-transaction");
                        if (jdbc.update(
                                        "UPDATE import_run SET state='completed',completed_at=?,updated_at=?,report=?::jsonb WHERE id=? AND generation=? AND state='applying'",
                                        ts(clock.instant()),
                                        ts(clock.instant()),
                                        encode(completed),
                                        id,
                                        generation)
                                != 1)
                            throw new IllegalStateException(
                                    "Import finalization lost its generation.");
                        checkpoint.reached("before-finalize-commit");
                        return null;
                    });
            checkpoint.reached("after-finalize-commit");
            return completed;
        } catch (Exception e) {
            return rejected(id, plan, e);
        }
    }

    private Map<String, Object> claim(Plan p, String id, String w) {
        return transaction.execute(
                status -> {
                    var existing =
                            jdbc.queryForList("SELECT * FROM import_run WHERE id=? FOR UPDATE", id);
                    if (!existing.isEmpty()) {
                        var r = existing.getFirst();
                        if (!p.digest().equals(r.get("source_digest"))
                                || !w.equals(r.get("target_workspace"))
                                || !p.teacherId().equals(r.get("source_teacher_id"))
                                || !p.approvalHash().equals(r.get("approval_hash"))
                                || !p.profilesHash().equals(r.get("profiles_hash"))
                                || !text(p.content(), "sha").equals(r.get("content_revision")))
                            throw invalid(
                                    "Import ID is bound to different source, approval or workspace.");
                        if (!r.get("state").equals("completed")) {
                            String generation = UUID.randomUUID().toString();
                            jdbc.update(
                                    "UPDATE import_run SET generation=?,updated_at=? WHERE id=?",
                                    generation,
                                    ts(clock.instant()),
                                    id);
                            r.put("generation", generation);
                        }
                        return r;
                    }
                    if (jdbc.queryForObject(
                                    "SELECT count(*) FROM import_run WHERE state<>'completed'",
                                    Integer.class)
                            != 0) throw invalid("Another incomplete import owns this database.");
                    if (jdbc.queryForObject(
                                    "SELECT count(*) FROM workspace WHERE id=?", Integer.class, w)
                            != 0) throw invalid("Target workspace exists outside this import.");
                    for (var a : array(p.auth(), "accounts"))
                        if (jdbc.queryForObject(
                                        "SELECT count(*) FROM identity_account WHERE id=? OR login=?",
                                        Integer.class,
                                        text(a, "id"),
                                        text(a, "login"))
                                != 0)
                            throw invalid("Target account ID or login exists outside this import.");
                    Instant now = clock.instant();
                    jdbc.update(
                            "INSERT INTO import_run(id,source_digest,target_workspace,source_teacher_id,approval_hash,profiles_hash,state,generation,source_reference,content_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,'applying',?,?,?,?,?)",
                            id,
                            p.digest(),
                            w,
                            p.teacherId(),
                            p.approvalHash(),
                            p.profilesHash(),
                            UUID.randomUUID().toString(),
                            p.root().toString(),
                            text(p.content(), "sha"),
                            ts(now),
                            ts(now));
                    for (var f : p.files())
                        jdbc.update(
                                "INSERT INTO import_source_file(import_id,path,size,sha256) VALUES(?,?,?,?)",
                                id,
                                f.path(),
                                f.size(),
                                f.sha256());
                    return jdbc.queryForMap("SELECT * FROM import_run WHERE id=?", id);
                });
    }

    private void phase(OfflineImportLease lease, String kind, Runnable action) {
        if (hasEntity(lease.importId(), kind, lease.workspaceId())) return;
        lease.write(
                () -> {
                    action.run();
                    record(
                            lease,
                            kind,
                            lease.workspaceId(),
                            fingerprint(kind, lease.workspaceId(), lease.workspaceId()));
                    return null;
                });
    }

    private boolean hasEntity(String run, String kind, String id) {
        return jdbc.queryForObject(
                        "SELECT count(*) FROM import_entity WHERE import_id=? AND kind=? AND source_id=?",
                        Integer.class,
                        run,
                        kind,
                        id)
                == 1;
    }

    private void record(OfflineImportLease lease, String kind, String target, String hash) {
        lease.requireMutable();
        jdbc.update(
                "INSERT INTO import_entity(import_id,kind,source_id,target_id,fingerprint) VALUES(?,?,?,?,?)",
                lease.importId(),
                kind,
                target,
                target,
                hash);
    }

    private void skeleton(Plan p, OfflineImportLease lease) {
        String w = lease.workspaceId();
        Map<String, String> users = new HashMap<>();
        Instant teacherCreated = null;
        for (var a : array(p.auth(), "accounts")) {
            String role = text(a, "role").toUpperCase(Locale.ROOT), id = text(a, "id");
            String hash =
                    passwords.importLegacy(
                            JSON.treeToValue(a.get("passwordHash"), LegacyPasswordHash.class));
            jdbc.update(
                    "INSERT INTO identity_account(id,login,password_hash,role,disabled,auth_version,created_at) VALUES(?,?,?,?,?,?,?)",
                    id,
                    text(a, "login"),
                    hash,
                    role,
                    a.get("disabled").asBoolean(),
                    a.get("authVersion").asLong(),
                    ts(timestamp(a, "createdAt", false)));
            if (role.equals("STUDENT")) users.put(text(a, "studentId"), id);
            else teacherCreated = timestamp(a, "createdAt", false);
        }
        jdbc.update(
                "INSERT INTO workspace(id,owner_user_id,created_at) VALUES(?,?,?)",
                w,
                p.teacherId(),
                ts(teacherCreated));
        for (var s : array(p.mentoring(), "students"))
            jdbc.update(
                    "INSERT INTO student_profile(workspace_id,id,user_id,name,direction,goal,schedule,notes,student_roadmap,student_review,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    w,
                    text(s, "id"),
                    users.get(text(s, "id")),
                    text(s, "name"),
                    text(s, "direction"),
                    text(s, "goal"),
                    text(s, "schedule"),
                    text(s, "notes"),
                    optionalText(s, "studentRoadmap", true),
                    optionalText(s, "studentReview", true),
                    ts(timestamp(s, "createdAt", false)));
        for (var a : array(p.auth(), "accounts"))
            jdbc.update(
                    "INSERT INTO workspace_membership(user_id,workspace_id,role,student_id) VALUES(?,?,?,?)",
                    text(a, "id"),
                    w,
                    text(a, "role").toUpperCase(Locale.ROOT),
                    nullableText(a, "studentId"));
        for (var l : array(p.mentoring(), "lessons")) {
            jdbc.update(
                    "INSERT INTO lesson(workspace_id,id,student_id,title,local_date,local_time,time_zone,duration,status,bundle_id,created_at) VALUES(?,?,?,?,?,?,'Europe/Moscow',?,?,?,?)",
                    w,
                    text(l, "id"),
                    text(l, "studentId"),
                    text(l, "title"),
                    text(l, "date"),
                    text(l, "time"),
                    l.get("duration").asInt(),
                    text(l, "status"),
                    nullableText(l, "bundleId"),
                    ts(timestamp(l, "createdAt", false)));
            for (String kind : List.of("teacherNotes", "studentNotes", "reviewNotes"))
                jdbc.update(
                        "INSERT INTO lesson_text(workspace_id,lesson_id,kind,markdown) VALUES(?,?,?,?)",
                        w,
                        text(l, "id"),
                        kind,
                        optionalText(l, kind, kind.equals("reviewNotes")));
        }
        for (String kind : List.of("invitations", "resets"))
            for (var link : array(p.auth(), kind))
                jdbc.update(
                        "INSERT INTO import_revoked_link(import_id,kind,id,source_binding,token_hash,created_at,expires_at,used_at,source_revoked_at,imported_revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                        lease.importId(),
                        kind.equals("invitations") ? "invitation" : "reset",
                        text(link, "id"),
                        text(link, kind.equals("invitations") ? "studentId" : "accountId"),
                        text(link, "tokenHash"),
                        ts(timestamp(link, "createdAt", false)),
                        ts(timestamp(link, "expiresAt", false)),
                        ts(timestamp(link, "usedAt", true)),
                        ts(timestamp(link, "revokedAt", true)),
                        ts(clock.instant()));
    }

    private static List<JsonNode> practiceLessons(Plan plan) {
        List<JsonNode> out = new ArrayList<>();
        Set<String> existing = new HashSet<>();
        for (var p : array(plan.practice(), "lessons")) {
            out.add(p);
            existing.add(text(p, "lessonId"));
        }
        Set<String> available = new HashSet<>();
        for (var e : plan.catalog()) available.add(e.exercise().exerciseId());
        for (var l : array(plan.mentoring(), "lessons"))
            if (!existing.contains(text(l, "id"))
                    && text(l, "id").equals("lesson-2026-09-27")
                    && text(l, "studentId").equals("michael")
                    && text(l, "status").equals("prepared")
                    && "library-2026-09-27".equals(nullableText(l, "bundleId"))) {
                var p =
                        JSON.createObjectNode()
                                .put("studentId", "michael")
                                .put("lessonId", "lesson-2026-09-27");
                var assignments = p.putArray("assignments");
                for (String id : List.of("list-task", "grouping-task"))
                    if (available.contains(id))
                        assignments.addObject().put("exerciseId", id).put("placement", "class");
                for (String field : List.of("drafts", "draftArchives", "attempts", "submissions"))
                    p.putArray(field);
                out.add(p);
            }
        return out;
    }

    private void practice(Plan plan, OfflineImportLease lease) {
        String w = lease.workspaceId();
        catalog.publish(lease, plan.catalog(), clock.instant());
        for (var p : practiceLessons(plan)) {
            String sid = text(p, "studentId"), lid = text(p, "lessonId");
            jdbc.update(
                    "INSERT INTO practice_assignment_set(workspace_id,student_id,lesson_id) VALUES(?,?,?)",
                    w,
                    sid,
                    lid);
            Map<String, JsonNode> active = new LinkedHashMap<>();
            for (var a : array(p, "assignments")) active.put(text(a, "exerciseId"), a);
            Set<String> exercises = new LinkedHashSet<>(active.keySet());
            for (String kind : List.of("drafts", "draftArchives", "attempts"))
                for (var d : array(p, kind)) exercises.add(text(d, "exerciseId"));
            int position = 0;
            for (String exercise : exercises) {
                jdbc.update(
                        "INSERT INTO practice_exercise(workspace_id,id) VALUES(?,?) ON CONFLICT DO NOTHING",
                        w,
                        exercise);
                jdbc.update(
                        "INSERT INTO practice_assignment(workspace_id,student_id,lesson_id,id,exercise_id,placement,active,position) VALUES(?,?,?,?,?,?,?,?)",
                        w,
                        sid,
                        lid,
                        assignment(lid, exercise),
                        exercise,
                        active.containsKey(exercise)
                                ? text(active.get(exercise), "placement")
                                : "class",
                        active.containsKey(exercise),
                        position++);
            }
            for (var d : array(p, "drafts"))
                jdbc.update(
                        "INSERT INTO practice_draft(workspace_id,assignment_id,exercise_revision,revision,files,updated_at) VALUES(?,?,?::jsonb,?,?::jsonb,?)",
                        w,
                        assignment(lid, text(d, "exerciseId")),
                        encode(d.get("exerciseRevision")),
                        d.get("revision").asLong(),
                        encode(d.get("files")),
                        ts(timestamp(d, "updatedAt", false)));
            int ordinal = 0;
            for (var d : array(p, "draftArchives")) {
                String archiveId =
                        d.has("id") ? id(d, "id") : stable("archive", lid + "/" + ordinal);
                ordinal++;
                jdbc.update(
                        "INSERT INTO practice_draft_archive(workspace_id,id,assignment_id,exercise_revision,revision,files,updated_at,archived_at,reason) VALUES(?,?,?,?::jsonb,?,?::jsonb,?,?,'imported')",
                        w,
                        archiveId,
                        assignment(lid, text(d, "exerciseId")),
                        encode(d.get("exerciseRevision")),
                        d.get("revision").asLong(),
                        encode(d.get("files")),
                        ts(timestamp(d, "updatedAt", false)),
                        ts(timestamp(d, "archivedAt", true)));
            }
            for (var a : array(p, "attempts"))
                jdbc.update(
                        "INSERT INTO practice_attempt(workspace_id,id,assignment_id,account_id,exercise_id,exercise_revision,environment_revision,mode,files,created_at,job_state,result,historical_import_id) VALUES(?,?,?,NULL,?,?::jsonb,NULL,?,?::jsonb,?,'completed',?::jsonb,?)",
                        w,
                        text(a, "id"),
                        assignment(lid, text(a, "exerciseId")),
                        text(a, "exerciseId"),
                        encode(a.get("exerciseRevision")),
                        text(a, "mode"),
                        encode(a.get("files")),
                        ts(timestamp(a, "createdAt", false)),
                        encode(a.get("result")),
                        lease.importId());
        }
    }

    private List<Blob> objects(
            Plan plan, List<MaterialConverter.Material> materials, Instant importedAt) {
        Map<String, SourceFile> files = new HashMap<>();
        for (var f : plan.files()) files.put(f.path(), f);
        List<Blob> out = new ArrayList<>();
        for (var m : materials)
            if (m.sourceFile() != null) {
                var f = files.get(m.sourceFile());
                if (f == null) throw invalid("Material source absent from manifest.");
                out.add(
                        new Blob(
                                stable("material-blob", m.id()),
                                m.student(),
                                m.lesson(),
                                f.path(),
                                m.filename(),
                                m.contentType(),
                                f.size(),
                                f.sha256(),
                                importedAt));
            }
        for (var p : array(plan.practice(), "lessons"))
            for (var s : array(p, "submissions")) {
                String path = "data/practice/uploads/" + text(s, "blobId");
                var f = files.get(path);
                if (f == null) throw invalid("Homework source absent from manifest.");
                out.add(
                        new Blob(
                                text(s, "blobId"),
                                text(p, "studentId"),
                                text(p, "lessonId"),
                                path,
                                text(s, "filename"),
                                homeworkType(text(s, "filename")),
                                f.size(),
                                f.sha256(),
                                timestamp(s, "createdAt", false)));
            }
        return out;
    }

    private void materials(List<MaterialConverter.Material> materials, OfflineImportLease lease) {
        for (var m : materials)
            jdbc.update(
                    "INSERT INTO material(workspace_id,id,student_id,lesson_id,bundle_id,audience,kind,content_key,filename,content_type,title,payload,blob_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?)",
                    lease.workspaceId(),
                    m.id(),
                    m.student(),
                    m.lesson(),
                    m.bundle(),
                    m.audience(),
                    m.kind(),
                    m.key(),
                    m.filename(),
                    m.contentType(),
                    m.title(),
                    m.payload() == null ? null : encode(m.payload()),
                    m.sourceFile() == null ? null : stable("material-blob", m.id()));
    }

    private void homework(Plan plan, OfflineImportLease lease) {
        for (var p : array(plan.practice(), "lessons"))
            for (var s : array(p, "submissions"))
                jdbc.update(
                        "INSERT INTO homework_submission(workspace_id,student_id,lesson_id,id,blob_id,filename,size,created_at,comment,repository_url,status,feedback,reviewed_at,revision,historical_import_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
                        lease.workspaceId(),
                        text(p, "studentId"),
                        text(p, "lessonId"),
                        text(s, "id"),
                        text(s, "blobId"),
                        text(s, "filename"),
                        s.get("size").asLong(),
                        ts(timestamp(s, "createdAt", false)),
                        text(s, "comment"),
                        text(s, "repositoryUrl"),
                        text(s, "status"),
                        text(s, "feedback"),
                        ts(timestamp(s, "reviewedAt", true)),
                        lease.importId());
    }

    private void verifySource(Plan plan) throws IOException {
        var now = read(plan.root());
        if (!now.digest().equals(plan.digest())
                || !now.approvalHash().equals(plan.approvalHash())
                || !now.profilesHash().equals(plan.profilesHash()))
            throw invalid("Source or approval changed while importing.");
    }

    private void verifySourceLedger(Plan plan, String id) {
        var saved =
                jdbc.query(
                        "SELECT path,size,sha256 FROM import_source_file WHERE import_id=? ORDER BY path COLLATE \"C\"",
                        (r, n) -> new SourceFile(r.getString(1), r.getLong(2), r.getString(3)),
                        id);
        // Use Java's source-manifest ordering even when an operator chose a different database
        // locale.
        saved.sort(Comparator.comparing(SourceFile::path));
        if (!saved.equals(plan.files()))
            throw invalid("Durable source ledger differs from the closed snapshot.");
    }

    private void verifyObjectMetadata(String workspace, Blob b) throws IOException {
        var row =
                jdbc.queryForMap(
                        "SELECT b.*,r.object_key FROM stored_blob b JOIN blob_reservation r ON r.id=b.reservation_id WHERE b.workspace_id=? AND b.id=?",
                        workspace,
                        b.id());
        if (!b.student().equals(row.get("student_id"))
                || !Objects.equals(b.lesson(), row.get("lesson_id"))
                || !b.filename().equals(row.get("filename"))
                || !BlobService.contentType(b.type()).equals(row.get("content_type"))
                || b.size() != ((Number) row.get("size")).longValue()
                || !b.sha().equals(row.get("sha256")))
            throw invalid("Attached import blob metadata diverged.");
        verifyObject(row.get("object_key").toString(), b.size(), b.sha());
    }

    private void verifyObjects(String run, String workspace) throws IOException {
        for (var row :
                jdbc.queryForList(
                        "SELECT b.size,b.sha256,r.object_key FROM import_entity e JOIN stored_blob b ON b.workspace_id=? AND b.id=e.target_id JOIN blob_reservation r ON r.id=b.reservation_id WHERE e.import_id=? AND e.kind='blob'",
                        workspace,
                        run))
            verifyObject(
                    row.get("object_key").toString(),
                    ((Number) row.get("size")).longValue(),
                    row.get("sha256").toString());
    }

    private void verifyObject(String key, long size, String sha) throws IOException {
        try (var input = store.open(key)) {
            java.security.MessageDigest digest;
            try {
                digest = java.security.MessageDigest.getInstance("SHA-256");
            } catch (Exception impossible) {
                throw new IllegalStateException(impossible);
            }
            byte[] buffer = new byte[65536];
            long total = 0;
            for (int n; (n = input.read(buffer)) >= 0; ) {
                total += n;
                if (total > size) throw invalid("Attached blob exceeds source length.");
                digest.update(buffer, 0, n);
            }
            if (total != size || !HexFormat.of().formatHex(digest.digest()).equals(sha))
                throw invalid("Attached blob checksum differs from source.");
        }
    }

    private void verifyLedger(String run, String workspace) {
        for (var e :
                jdbc.queryForList(
                        "SELECT kind,target_id,fingerprint FROM import_entity WHERE import_id=?",
                        run))
            if (!fingerprint(e.get("kind").toString(), workspace, e.get("target_id").toString())
                    .equals(e.get("fingerprint")))
                throw invalid(
                        "Imported target data diverged from its recorded manifest: "
                                + e.get("kind"));
    }

    private String fingerprint(String kind, String w, String target) {
        Object values =
                switch (kind) {
                    case "skeleton" ->
                            List.of(
                                    rows(
                                            "SELECT to_jsonb(a) AS value FROM identity_account a JOIN workspace_membership m ON m.user_id=a.id WHERE m.workspace_id=? ORDER BY a.id",
                                            w),
                                    table("workspace", "id", w, "id"),
                                    table("workspace_membership", "workspace_id", w, "user_id"),
                                    table("student_profile", "workspace_id", w, "id"),
                                    table("lesson", "workspace_id", w, "id"),
                                    table("lesson_text", "workspace_id", w, "lesson_id,kind"),
                                    rows(
                                            "SELECT to_jsonb(l) AS value FROM import_revoked_link l JOIN import_run r ON r.id=l.import_id WHERE r.target_workspace=? ORDER BY l.kind,l.id",
                                            w));
                    case "practice" ->
                            List.of(
                                    table("practice_exercise", "workspace_id", w, "id"),
                                    table(
                                            "practice_exercise_revision",
                                            "workspace_id",
                                            w,
                                            "exercise_id,revision_key"),
                                    table(
                                            "practice_assignment_set",
                                            "workspace_id",
                                            w,
                                            "lesson_id"),
                                    table("practice_assignment", "workspace_id", w, "id"),
                                    table("practice_draft", "workspace_id", w, "assignment_id"),
                                    table("practice_draft_archive", "workspace_id", w, "id"),
                                    table("practice_attempt", "workspace_id", w, "id"));
                    case "blob" ->
                            rows(
                                    "SELECT to_jsonb(b) AS value FROM stored_blob b WHERE workspace_id=? AND id=? ORDER BY id",
                                    w,
                                    target);
                    case "materials" -> table("material", "workspace_id", w, "id");
                    case "homework" -> table("homework_submission", "workspace_id", w, "id");
                    default -> throw invalid("Unknown import ownership ledger entry.");
                };
        return sha(JSON.writeValueAsBytes(canonical(JSON.valueToTree(values))));
    }

    private List<JsonNode> table(String table, String field, String value, String order) {
        return rows(
                "SELECT to_jsonb(t) AS value FROM "
                        + table
                        + " t WHERE "
                        + field
                        + "=? ORDER BY "
                        + order,
                value);
    }

    private List<JsonNode> rows(String sql, Object... args) {
        return jdbc.query(sql, (r, n) -> PracticeJson.read(r.getString("value")), args);
    }

    private static JsonNode canonical(JsonNode n) {
        if (n.isObject()) {
            var out = JSON.createObjectNode();
            new TreeSet<>(n.propertyNames()).forEach(k -> out.set(k, canonical(n.get(k))));
            return out;
        }
        if (n.isArray()) {
            var out = JSON.createArrayNode();
            for (var item : n) out.add(canonical(item));
            return out;
        }
        return n;
    }

    private ImportReport report(
            String id, Plan plan, List<MaterialConverter.Material> materials, boolean completed) {
        return describe(id, plan, materials, completed, maximum);
    }

    public static ImportReport describe(
            String id,
            Plan plan,
            List<MaterialConverter.Material> materials,
            boolean completed,
            long maximum) {
        Map<String, Long> counts = new TreeMap<>();
        counts.put("accounts", (long) array(plan.auth(), "accounts").size());
        counts.put("students", (long) array(plan.mentoring(), "students").size());
        counts.put("lessons", (long) array(plan.mentoring(), "lessons").size());
        counts.put("sourceFiles", (long) plan.files().size());
        counts.put(
                "revokedLinks",
                (long) array(plan.auth(), "invitations").size()
                        + array(plan.auth(), "resets").size());
        long assignments = 0, drafts = 0, archives = 0, attempts = 0, submissions = 0;
        for (var p : practiceLessons(plan)) {
            Set<String> exercises = new HashSet<>();
            for (String kind : List.of("assignments", "drafts", "draftArchives", "attempts"))
                for (var item : array(p, kind)) exercises.add(text(item, "exerciseId"));
            assignments += exercises.size();
            drafts += array(p, "drafts").size();
            archives += array(p, "draftArchives").size();
            attempts += array(p, "attempts").size();
            submissions += array(p, "submissions").size();
        }
        counts.put("assignments", assignments);
        counts.put("drafts", drafts);
        counts.put("archives", archives);
        counts.put("attempts", attempts);
        counts.put("submissions", submissions);
        counts.put("jobs", 0L);
        if (materials == null)
            try {
                materials =
                        new MaterialConverter()
                                .convert(
                                        plan.root(),
                                        plan.manifest(),
                                        plan.content(),
                                        plan.mentoring(),
                                        "inspection-workspace",
                                        maximum);
            } catch (IOException e) {
                throw invalid("Material source unavailable.");
            }
        counts.put("materials", (long) materials.size());
        counts.put(
                "blobs",
                materials.stream().filter(m -> m.sourceFile() != null).count() + submissions);
        Map<String, String> checksums = new TreeMap<>();
        for (var f : plan.files()) checksums.put("source:" + f.path(), f.sha256());
        if (completed)
            for (var m : materials)
                if (m.payload() != null)
                    checksums.put("converted:" + m.id(), sha(JSON.writeValueAsBytes(m.payload())));
        return new ImportReport(
                id,
                plan.digest(),
                counts,
                checksums,
                List.of(
                        "Retain the closed source snapshot privately with the encrypted cutover backup.",
                        "Historical attempts: Версия окружения не сохранена"),
                List.of(),
                completed);
    }

    private void verifyCounts(Map<String, Long> expected, String w, String run) {
        Map<String, Long> actual = new HashMap<>();
        Map<String, String> tables =
                Map.ofEntries(
                        Map.entry("students", "student_profile"),
                        Map.entry("lessons", "lesson"),
                        Map.entry("materials", "material"),
                        Map.entry("blobs", "stored_blob"),
                        Map.entry("assignments", "practice_assignment"),
                        Map.entry("drafts", "practice_draft"),
                        Map.entry("archives", "practice_draft_archive"),
                        Map.entry("attempts", "practice_attempt"),
                        Map.entry("submissions", "homework_submission"),
                        Map.entry("jobs", "practice_job"));
        tables.forEach(
                (key, table) ->
                        actual.put(
                                key,
                                jdbc.queryForObject(
                                        "SELECT count(*) FROM " + table + " WHERE workspace_id=?",
                                        Long.class,
                                        w)));
        actual.put(
                "accounts",
                jdbc.queryForObject(
                        "SELECT count(*) FROM workspace_membership WHERE workspace_id=?",
                        Long.class,
                        w));
        actual.put(
                "sourceFiles",
                jdbc.queryForObject(
                        "SELECT count(*) FROM import_source_file WHERE import_id=?",
                        Long.class,
                        run));
        actual.put(
                "revokedLinks",
                jdbc.queryForObject(
                        "SELECT count(*) FROM import_revoked_link WHERE import_id=?",
                        Long.class,
                        run));
        if (!actual.equals(expected))
            throw invalid("Imported counts do not match the inspected source manifest.");
    }

    private static ImportReport rejected(String id, Plan plan, Exception e) {
        return new ImportReport(
                id,
                plan == null ? "" : plan.digest(),
                Map.of(),
                Map.of(),
                List.of(),
                List.of(
                        e instanceof IllegalArgumentException
                                ? e.getMessage()
                                : "Import did not complete; source and durable progress were retained. Resolve the failure and resume the same import ID."),
                false);
    }

    private static void validateId(String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,100}"))
            throw invalid("Invalid import or target workspace ID.");
    }

    private static Timestamp ts(Instant t) {
        return t == null ? null : Timestamp.from(t);
    }

    private static String encode(Object value) {
        return JSON.writeValueAsString(value);
    }

    private static String assignment(String lesson, String exercise) {
        return stable("assignment", lesson + "/" + exercise);
    }

    private static String stable(String kind, String key) {
        return UUID.nameUUIDFromBytes(
                        ("legacy-v1/" + kind + "/" + key).getBytes(StandardCharsets.UTF_8))
                .toString();
    }

    private static String homeworkType(String filename) {
        String n = filename.strip().toLowerCase(Locale.ROOT);
        return n.endsWith(".zip")
                ? "application/zip"
                : n.endsWith(".pdf")
                        ? "application/pdf"
                        : n.endsWith(".md")
                                ? "text/markdown; charset=UTF-8"
                                : "text/plain; charset=UTF-8";
    }
}
