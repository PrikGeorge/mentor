CREATE TABLE practice_queue_control(id INTEGER PRIMARY KEY CHECK(id=1),last_worker_seen_at TIMESTAMPTZ);
INSERT INTO practice_queue_control(id) VALUES(1);
ALTER TABLE practice_assignment ADD UNIQUE(workspace_id,id,exercise_id);
CREATE TABLE practice_attempt (
 workspace_id VARCHAR(100) NOT NULL, id VARCHAR(100) NOT NULL, assignment_id VARCHAR(100) NOT NULL,
 account_id VARCHAR(100) NOT NULL REFERENCES identity_account(id), exercise_id VARCHAR(100) NOT NULL,
 exercise_revision JSONB NOT NULL CHECK(jsonb_typeof(exercise_revision) IN ('number','string')),
 environment_revision VARCHAR(100), mode VARCHAR(10) NOT NULL CHECK(mode IN ('run','submit')),
 files JSONB NOT NULL CHECK(jsonb_typeof(files)='object'), created_at TIMESTAMPTZ NOT NULL,
 idempotency_key VARCHAR(128), payload_hash VARCHAR(64),
 job_state VARCHAR(16) NOT NULL CHECK(job_state IN ('queued','running','completed','failed')), result JSONB,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,account_id,assignment_id,idempotency_key),
 FOREIGN KEY(workspace_id,assignment_id,exercise_id) REFERENCES practice_assignment(workspace_id,id,exercise_id),
 FOREIGN KEY(workspace_id,exercise_id) REFERENCES practice_exercise(workspace_id,id),
 CHECK((job_state IN ('completed','failed'))=(result IS NOT NULL))
);
CREATE TABLE practice_job (
 id VARCHAR(100) PRIMARY KEY, workspace_id VARCHAR(100) NOT NULL, attempt_id VARCHAR(100) NOT NULL,
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 state VARCHAR(16) NOT NULL CHECK(state IN ('queued','running','retry_pending','completed','failed')),
 grants INTEGER NOT NULL DEFAULT 0 CHECK(grants BETWEEN 0 AND 2), worker_id VARCHAR(100),
 token_hash VARCHAR(64), lease_expires_at TIMESTAMPTZ, deadline_at TIMESTAMPTZ,
 UNIQUE(workspace_id,attempt_id), FOREIGN KEY(workspace_id,attempt_id) REFERENCES practice_attempt(workspace_id,id),
 CHECK((state='running')=(token_hash IS NOT NULL AND lease_expires_at IS NOT NULL AND deadline_at IS NOT NULL))
);
CREATE TABLE practice_completion_receipt (
 job_id VARCHAR(100) NOT NULL REFERENCES practice_job(id), token_hash VARCHAR(64) NOT NULL,
 result_hash VARCHAR(64) NOT NULL, completed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(job_id,token_hash)
);
CREATE INDEX practice_attempt_history ON practice_attempt(workspace_id,assignment_id,created_at DESC,id DESC);
CREATE INDEX practice_job_claim ON practice_job(state,created_at,id);
CREATE FUNCTION practice_immutable_job_payload() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Job snapshot is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER practice_job_payload_fixed BEFORE UPDATE ON practice_job FOR EACH ROW EXECUTE FUNCTION practice_immutable_job_payload();
CREATE FUNCTION practice_immutable_attempt_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF ROW(NEW.workspace_id,NEW.id,NEW.assignment_id,NEW.account_id,NEW.exercise_id,NEW.exercise_revision,NEW.environment_revision,NEW.mode,NEW.files,NEW.created_at,NEW.idempotency_key,NEW.payload_hash)
 IS DISTINCT FROM ROW(OLD.workspace_id,OLD.id,OLD.assignment_id,OLD.account_id,OLD.exercise_id,OLD.exercise_revision,OLD.environment_revision,OLD.mode,OLD.files,OLD.created_at,OLD.idempotency_key,OLD.payload_hash)
 THEN RAISE EXCEPTION 'Attempt snapshot is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER practice_attempt_snapshot_fixed BEFORE UPDATE ON practice_attempt FOR EACH ROW EXECUTE FUNCTION practice_immutable_attempt_snapshot();
