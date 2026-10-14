-- Ordered learning-route stages of one card; the whole list is replaced at once under its own revision.
ALTER TABLE student_profile ADD COLUMN roadmap_revision BIGINT NOT NULL DEFAULT 1 CHECK(roadmap_revision>0);
CREATE TABLE roadmap_stage (
 workspace_id VARCHAR(100) NOT NULL, student_id VARCHAR(100) NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 29),
 title VARCHAR(200) NOT NULL, note VARCHAR(120) NOT NULL DEFAULT '',
 state VARCHAR(10) NOT NULL CHECK(state IN ('done','current','ahead')),
 PRIMARY KEY(workspace_id,student_id,position),
 FOREIGN KEY(workspace_id,student_id) REFERENCES student_profile(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX roadmap_single_current ON roadmap_stage(workspace_id,student_id) WHERE state='current';
