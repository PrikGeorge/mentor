CREATE TABLE import_run (
 id TEXT PRIMARY KEY, source_digest CHAR(64) NOT NULL, target_workspace TEXT NOT NULL UNIQUE,
 manifest_format TEXT NOT NULL DEFAULT 'mentor-source-manifest-v1' CHECK(manifest_format='mentor-source-manifest-v1'),
 source_teacher_id TEXT NOT NULL, approval_hash CHAR(64) NOT NULL, profiles_hash CHAR(64) NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('applying','completed')), generation TEXT NOT NULL,
 source_reference TEXT NOT NULL, content_revision TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 completed_at TIMESTAMPTZ, report JSONB,
 UNIQUE(id,target_workspace),
 CHECK((state='completed')=(completed_at IS NOT NULL))
);
CREATE TABLE import_source_file (
 import_id TEXT NOT NULL REFERENCES import_run(id), path TEXT NOT NULL,
 size BIGINT NOT NULL CHECK(size>=0), sha256 CHAR(64) NOT NULL,
 PRIMARY KEY(import_id,path)
);
CREATE TABLE import_entity (
 import_id TEXT NOT NULL REFERENCES import_run(id), kind TEXT NOT NULL, source_id TEXT NOT NULL,
 target_id TEXT NOT NULL, fingerprint CHAR(64) NOT NULL,
 PRIMARY KEY(import_id,kind,source_id)
);
CREATE TABLE import_blob_reservation (
 reservation_id TEXT PRIMARY KEY REFERENCES blob_reservation(id),
 import_id TEXT NOT NULL REFERENCES import_run(id), generation TEXT NOT NULL, source_path TEXT NOT NULL
);
CREATE TABLE import_revoked_link (
 import_id TEXT NOT NULL REFERENCES import_run(id), kind TEXT NOT NULL CHECK(kind IN ('invitation','reset')),
 id TEXT NOT NULL, source_binding TEXT NOT NULL, token_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, source_revoked_at TIMESTAMPTZ,
 imported_revoked_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(import_id,kind,id)
);
-- Legacy validation checks trimmed lengths but persists raw strings; online validators remain unchanged.
ALTER TABLE student_profile ALTER COLUMN name TYPE TEXT, ALTER COLUMN direction TYPE TEXT;
ALTER TABLE lesson ALTER COLUMN title TYPE TEXT;
ALTER TABLE homework_submission ADD COLUMN historical_import_id TEXT;
ALTER TABLE homework_submission ADD FOREIGN KEY(historical_import_id,workspace_id) REFERENCES import_run(id,target_workspace);
ALTER TABLE homework_submission DROP CONSTRAINT homework_submission_check;
ALTER TABLE homework_submission ADD CONSTRAINT homework_review_provenance CHECK(
 (status='submitted' AND reviewed_at IS NULL AND feedback='') OR
 (status<>'submitted' AND (reviewed_at IS NOT NULL OR historical_import_id IS NOT NULL))
);
-- Legacy attempts have no recorded author. Never infer one from today's card login.
ALTER TABLE practice_attempt ADD COLUMN historical_import_id TEXT;
ALTER TABLE practice_attempt ADD FOREIGN KEY(historical_import_id,workspace_id) REFERENCES import_run(id,target_workspace);
ALTER TABLE practice_attempt ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE practice_attempt ADD CONSTRAINT attempt_author_provenance CHECK(
 (historical_import_id IS NULL AND account_id IS NOT NULL AND environment_revision IS NOT NULL) OR
 (historical_import_id IS NOT NULL AND account_id IS NULL AND environment_revision IS NULL AND job_state IN ('completed','failed') AND idempotency_key IS NULL AND payload_hash IS NULL)
);
CREATE FUNCTION practice_import_has_no_job() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF EXISTS(SELECT 1 FROM practice_attempt WHERE workspace_id=NEW.workspace_id AND id=NEW.attempt_id AND historical_import_id IS NOT NULL) THEN RAISE EXCEPTION 'Imported attempts cannot execute jobs'; END IF; RETURN NEW; END $$;
CREATE TRIGGER practice_import_job_guard BEFORE INSERT OR UPDATE ON practice_job FOR EACH ROW EXECUTE FUNCTION practice_import_has_no_job();
CREATE OR REPLACE FUNCTION practice_immutable_attempt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF ROW(NEW.workspace_id,NEW.id,NEW.assignment_id,NEW.account_id,NEW.exercise_id,NEW.exercise_revision,NEW.environment_revision,NEW.mode,NEW.files,NEW.created_at,NEW.idempotency_key,NEW.payload_hash,NEW.historical_import_id)
 IS DISTINCT FROM ROW(OLD.workspace_id,OLD.id,OLD.assignment_id,OLD.account_id,OLD.exercise_id,OLD.exercise_revision,OLD.environment_revision,OLD.mode,OLD.files,OLD.created_at,OLD.idempotency_key,OLD.payload_hash,OLD.historical_import_id)
 THEN RAISE EXCEPTION 'Attempt snapshot is immutable'; END IF; RETURN NEW; END $$;
