-- The teacher marks a lesson as held; until then the platform never claims it took place.
ALTER TABLE lesson ADD COLUMN conducted_at TIMESTAMPTZ;
