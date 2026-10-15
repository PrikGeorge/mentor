-- Supporting indexes for foreign keys and hot filters that so far relied on primary keys only (backlog B-17).
-- Only CREATE INDEX IF NOT EXISTS: no constraint, cascade or data change; safe to re-run on a restored snapshot.

-- A student's own attempts are read per account inside one workspace (history, whose-turn, the journal); the primary
-- key (workspace_id,id) and practice_attempt_history (workspace_id,assignment_id,...) do not cover account_id.
CREATE INDEX IF NOT EXISTS practice_attempt_account ON practice_attempt(workspace_id,account_id);

-- identity_invitation.issuer_id references identity_account(id) without an index; listing or revoking the invitations
-- a teacher or the administrator issued, and FK checks on account removal, otherwise scan the table.
CREATE INDEX IF NOT EXISTS identity_invitation_issuer ON identity_invitation(issuer_id);

-- identity_audit grows without bound; rotation and "latest events" reads go by time, FK checks and per-actor history by actor.
CREATE INDEX IF NOT EXISTS identity_audit_created ON identity_audit(created_at);
CREATE INDEX IF NOT EXISTS identity_audit_actor ON identity_audit(actor_id);

-- blob_attached_fk (workspace_id,attached_blob_id) -> stored_blob(workspace_id,id) had no index on the referencing side;
-- deleting or releasing a stored object checked every reservation of the workspace.
CREATE INDEX IF NOT EXISTS blob_reservation_attached ON blob_reservation(workspace_id,attached_blob_id);
