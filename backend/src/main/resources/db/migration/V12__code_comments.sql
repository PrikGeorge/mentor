-- A teacher's remark on one line of a single-file homework or of a trainer attempt; visible to that student.
CREATE TABLE code_comment (
 workspace_id VARCHAR(100) NOT NULL, student_id VARCHAR(100) NOT NULL, lesson_id VARCHAR(100) NOT NULL,
 target_kind VARCHAR(10) NOT NULL CHECK(target_kind IN ('homework','attempt')), target_id VARCHAR(100) NOT NULL,
 id VARCHAR(100) NOT NULL, file VARCHAR(180) NOT NULL, line INTEGER NOT NULL CHECK(line BETWEEN 1 AND 100000),
 grade TEXT CHECK(grade IN ('excellent','good','interesting','dubious','mistake')),
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000), variant TEXT NOT NULL DEFAULT '' CHECK(char_length(variant)<=2000),
 created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id)
);
CREATE INDEX code_comment_target ON code_comment(workspace_id,student_id,lesson_id,target_kind,target_id,file,line,created_at);
