CREATE TABLE lesson (
    workspace_id VARCHAR(100) NOT NULL,
    student_id VARCHAR(100) NOT NULL,
    id VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    local_date VARCHAR(10) NOT NULL CHECK(local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    local_time VARCHAR(5) NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    time_zone VARCHAR(32) NOT NULL DEFAULT 'Europe/Moscow' CHECK(time_zone='Europe/Moscow'),
    duration INTEGER NOT NULL CHECK(duration BETWEEN 15 AND 240),
    status VARCHAR(16) NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','prepared')),
    bundle_id VARCHAR(100),
    revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,student_id,id),
    FOREIGN KEY(workspace_id,student_id) REFERENCES student_profile(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE lesson_text (
    workspace_id VARCHAR(100) NOT NULL,
    lesson_id VARCHAR(100) NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK(kind IN ('teacherNotes','studentNotes','reviewNotes')),
    markdown TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
    PRIMARY KEY(workspace_id,lesson_id,kind),
    FOREIGN KEY(workspace_id,lesson_id) REFERENCES lesson(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX lesson_order ON lesson(workspace_id,student_id,local_date DESC,local_time DESC,created_at DESC,id DESC);
