-- T09: an optional homework deadline per lesson. Late work is still accepted; the deadline only colours the lesson.
ALTER TABLE lesson ADD COLUMN homework_due_at TIMESTAMPTZ;
