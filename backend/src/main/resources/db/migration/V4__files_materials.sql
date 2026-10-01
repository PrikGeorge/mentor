CREATE TABLE blob_reservation (
  id text PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  workspace_id text NOT NULL,
  student_id text NOT NULL,
  lesson_id text,
  uploader_id text NOT NULL REFERENCES identity_account(id),
  lease_token text NOT NULL,
  lease_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  settle_after timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('RESERVED','STAGED','ATTACHED','DELETING','DELETED')),
  size bigint CHECK (size>=0), sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  attached_blob_id text,
  claim_token text, claim_until timestamptz,
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,student_id) REFERENCES student_profile(workspace_id,id),
  FOREIGN KEY (workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id),
  CHECK (lease_until<=expires_at), CHECK (expires_at<=settle_after),
  CHECK (state NOT IN ('STAGED','ATTACHED') OR (size IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK ((state='ATTACHED')=(attached_blob_id IS NOT NULL))
);
CREATE INDEX blob_reservation_cleanup ON blob_reservation(state,lease_until,claim_until);
CREATE TABLE stored_blob (
  workspace_id text NOT NULL,id text NOT NULL,student_id text NOT NULL,lesson_id text,
  reservation_id text NOT NULL UNIQUE,
  filename text NOT NULL,content_type text NOT NULL,size bigint NOT NULL CHECK(size>=0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,student_id,id),
  FOREIGN KEY(workspace_id,reservation_id) REFERENCES blob_reservation(workspace_id,id),
  FOREIGN KEY(workspace_id,student_id) REFERENCES student_profile(workspace_id,id),
  FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id)
);
ALTER TABLE blob_reservation ADD CONSTRAINT blob_attached_fk FOREIGN KEY(workspace_id,attached_blob_id) REFERENCES stored_blob(workspace_id,id);
CREATE TABLE material (
  workspace_id text NOT NULL,id text NOT NULL,student_id text NOT NULL,lesson_id text,bundle_id text,
  audience text NOT NULL CHECK(audience IN ('teacher','student')),
  kind text NOT NULL CHECK(kind IN ('doc','code','view','download')),
  content_key text,filename text NOT NULL,content_type text NOT NULL,title text,
  payload jsonb,blob_id text,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,student_id) REFERENCES student_profile(workspace_id,id),
  FOREIGN KEY(workspace_id,student_id,lesson_id) REFERENCES lesson(workspace_id,student_id,id),
  FOREIGN KEY(workspace_id,student_id,blob_id) REFERENCES stored_blob(workspace_id,student_id,id),
  CHECK((lesson_id IS NULL)=(bundle_id IS NULL)),
  CHECK((kind='download' AND blob_id IS NOT NULL AND payload IS NULL) OR (kind<>'download' AND blob_id IS NULL AND payload IS NOT NULL AND jsonb_typeof(payload)='object'))
);
CREATE INDEX material_binding ON material(workspace_id,student_id,lesson_id,id);
