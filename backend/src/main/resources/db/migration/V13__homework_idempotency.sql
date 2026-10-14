-- A student's retry after a lost response must not create a second work. The key is scoped to one lesson of one
-- card; the payload hash tells an honest replay (same file, comment and link) from a reused key with other content.
ALTER TABLE homework_submission ADD COLUMN idempotency_key VARCHAR(128), ADD COLUMN payload_hash VARCHAR(64);
ALTER TABLE homework_submission ADD CONSTRAINT homework_idempotency_pair CHECK((idempotency_key IS NULL)=(payload_hash IS NULL));
CREATE UNIQUE INDEX homework_submission_idempotency ON homework_submission(workspace_id,student_id,lesson_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
