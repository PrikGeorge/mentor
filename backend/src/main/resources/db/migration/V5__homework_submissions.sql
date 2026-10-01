ALTER TABLE stored_blob ADD CONSTRAINT stored_blob_lesson_identity UNIQUE(workspace_id,student_id,lesson_id,id);
CREATE TABLE homework_submission (
 workspace_id text NOT NULL,student_id text NOT NULL,lesson_id text NOT NULL,id text NOT NULL,
 blob_id text NOT NULL,filename text NOT NULL,size bigint NOT NULL CHECK(size>0 AND size<=20971520),
 created_at timestamptz NOT NULL,comment text NOT NULL,repository_url text NOT NULL,
 status text NOT NULL CHECK(status IN ('submitted','reviewed','needs_revision')),
 feedback text NOT NULL,reviewed_at timestamptz,revision bigint NOT NULL CHECK(revision>0),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,student_id,lesson_id,id),UNIQUE(workspace_id,blob_id),
 FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id),
 FOREIGN KEY(workspace_id,student_id,lesson_id,blob_id) REFERENCES stored_blob(workspace_id,student_id,lesson_id,id),
 CHECK((status='submitted' AND reviewed_at IS NULL AND feedback='') OR (status<>'submitted' AND reviewed_at IS NOT NULL))
);
CREATE INDEX homework_lesson_history ON homework_submission(workspace_id,student_id,lesson_id,created_at DESC,id DESC);
