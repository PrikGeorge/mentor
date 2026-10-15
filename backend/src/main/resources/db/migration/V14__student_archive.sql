-- A card that finished its course leaves the active lists but keeps its history; the student still reads, but no new work is accepted.
ALTER TABLE student_profile ADD COLUMN archived_at TIMESTAMPTZ;
