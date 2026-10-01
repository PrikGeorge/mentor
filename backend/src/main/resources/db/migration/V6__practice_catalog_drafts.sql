CREATE TABLE practice_exercise (
 workspace_id VARCHAR(100) NOT NULL REFERENCES workspace(id), id VARCHAR(100) NOT NULL,
 current_key VARCHAR(202), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE practice_exercise_revision (
 workspace_id VARCHAR(100) NOT NULL, exercise_id VARCHAR(100) NOT NULL, revision_key VARCHAR(202) NOT NULL,
 revision_json JSONB NOT NULL CHECK(jsonb_typeof(revision_json) IN ('number','string')),
 public_json JSONB NOT NULL, private_json JSONB NOT NULL, environment_json JSONB NOT NULL, provenance_json JSONB NOT NULL,
 snapshot_hash VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,exercise_id,revision_key),
 FOREIGN KEY(workspace_id,exercise_id) REFERENCES practice_exercise(workspace_id,id)
);
ALTER TABLE practice_exercise ADD FOREIGN KEY(workspace_id,id,current_key) REFERENCES practice_exercise_revision(workspace_id,exercise_id,revision_key);
CREATE FUNCTION practice_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published revisions are immutable'; END $$;
CREATE TRIGGER practice_revision_no_mutation BEFORE UPDATE OR DELETE ON practice_exercise_revision FOR EACH ROW EXECUTE FUNCTION practice_immutable_revision();
CREATE TABLE practice_assignment_set (
 workspace_id VARCHAR(100) NOT NULL, student_id VARCHAR(100) NOT NULL, lesson_id VARCHAR(100) NOT NULL,
 revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0), PRIMARY KEY(workspace_id,lesson_id),
 UNIQUE(workspace_id,student_id,lesson_id),
 FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id)
);
CREATE TABLE practice_assignment (
 workspace_id VARCHAR(100) NOT NULL, student_id VARCHAR(100) NOT NULL, lesson_id VARCHAR(100) NOT NULL,
 id VARCHAR(100) NOT NULL, exercise_id VARCHAR(100) NOT NULL, placement VARCHAR(16) NOT NULL CHECK(placement IN ('class','homework')),
 active BOOLEAN NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,lesson_id,exercise_id), UNIQUE(workspace_id,student_id,lesson_id,id),
 FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES practice_assignment_set(workspace_id,student_id,lesson_id),
 FOREIGN KEY(workspace_id,exercise_id) REFERENCES practice_exercise(workspace_id,id)
);
CREATE TABLE practice_draft (
 workspace_id VARCHAR(100) NOT NULL, assignment_id VARCHAR(100) NOT NULL,
 exercise_revision JSONB NOT NULL CHECK(jsonb_typeof(exercise_revision) IN ('number','string')),
 revision BIGINT NOT NULL CHECK(revision>0), files JSONB NOT NULL CHECK(jsonb_typeof(files)='object'), updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,assignment_id), FOREIGN KEY(workspace_id,assignment_id) REFERENCES practice_assignment(workspace_id,id)
);
CREATE TABLE practice_draft_archive (
 workspace_id VARCHAR(100) NOT NULL, id VARCHAR(100) NOT NULL, assignment_id VARCHAR(100) NOT NULL,
 exercise_revision JSONB NOT NULL CHECK(jsonb_typeof(exercise_revision) IN ('number','string')),
 revision BIGINT NOT NULL CHECK(revision>0), files JSONB NOT NULL CHECK(jsonb_typeof(files)='object'), updated_at TIMESTAMPTZ NOT NULL,
 archived_at TIMESTAMPTZ, reason VARCHAR(32) NOT NULL CHECK(reason IN ('exercise_revision_changed','imported')),
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,assignment_id) REFERENCES practice_assignment(workspace_id,id)
);
CREATE INDEX practice_assignment_student ON practice_assignment(workspace_id,student_id,active,exercise_id);
CREATE INDEX practice_archive_order ON practice_draft_archive(workspace_id,assignment_id,updated_at DESC,id DESC);
