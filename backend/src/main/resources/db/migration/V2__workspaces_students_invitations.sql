ALTER TABLE identity_account ADD CONSTRAINT identity_account_id_role UNIQUE(id,role);
CREATE TABLE workspace (
    id VARCHAR(100) PRIMARY KEY,
    owner_user_id VARCHAR(100) NOT NULL UNIQUE,
    owner_role VARCHAR(16) NOT NULL DEFAULT 'TEACHER' CHECK(owner_role='TEACHER'),
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY(owner_user_id,owner_role) REFERENCES identity_account(id,role) ON DELETE CASCADE
);
CREATE TABLE student_profile (
    workspace_id VARCHAR(100) NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) UNIQUE REFERENCES identity_account(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL, direction VARCHAR(120) NOT NULL,
    goal TEXT NOT NULL, schedule TEXT NOT NULL, notes TEXT NOT NULL,
    student_roadmap TEXT NOT NULL, student_review TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0), created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,id,user_id)
);
CREATE TABLE workspace_membership (
    user_id VARCHAR(100) PRIMARY KEY,
    workspace_id VARCHAR(100) NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK(role IN ('TEACHER','STUDENT')),
    student_id VARCHAR(100), disabled BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK((role='TEACHER' AND student_id IS NULL) OR (role='STUDENT' AND student_id IS NOT NULL)),
    UNIQUE(user_id,workspace_id,student_id), UNIQUE(user_id,workspace_id,role),
    FOREIGN KEY(user_id,role) REFERENCES identity_account(id,role) ON DELETE CASCADE,
    CONSTRAINT membership_card_binding FOREIGN KEY(workspace_id,student_id,user_id) REFERENCES student_profile(workspace_id,id,user_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX workspace_one_teacher ON workspace_membership(workspace_id) WHERE role='TEACHER';
ALTER TABLE student_profile ADD CONSTRAINT student_membership_binding
    FOREIGN KEY(user_id,workspace_id,id) REFERENCES workspace_membership(user_id,workspace_id,student_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE workspace ADD CONSTRAINT workspace_owner_membership
    FOREIGN KEY(owner_user_id,id,owner_role) REFERENCES workspace_membership(user_id,workspace_id,role) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE identity_invitation (
    id VARCHAR(100) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE,
    issue_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('TEACHER','STUDENT')),
    issuer_id VARCHAR(100) NOT NULL REFERENCES identity_account(id),
    workspace_id VARCHAR(100), student_id VARCHAR(100),
    CHECK((kind='TEACHER' AND workspace_id IS NULL AND student_id IS NULL) OR (kind='STUDENT' AND workspace_id IS NOT NULL AND student_id IS NOT NULL)),
    FOREIGN KEY(workspace_id,student_id) REFERENCES student_profile(workspace_id,id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX invitation_one_pending_card ON identity_invitation(workspace_id,student_id) WHERE used_at IS NULL AND revoked_at IS NULL AND kind='STUDENT';
CREATE TABLE identity_password_reset (
    id VARCHAR(100) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE,
    issuer_id VARCHAR(100) NOT NULL REFERENCES identity_account(id),
    target_user_id VARCHAR(100) NOT NULL REFERENCES identity_account(id) ON DELETE CASCADE,
    target_auth_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX reset_one_pending_account ON identity_password_reset(target_user_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TABLE identity_audit (
    id VARCHAR(100) PRIMARY KEY, actor_id VARCHAR(100) NOT NULL REFERENCES identity_account(id),
    action VARCHAR(64) NOT NULL, target_id VARCHAR(100) NOT NULL, workspace_id VARCHAR(100), created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX student_profile_order ON student_profile(workspace_id,created_at,id);
CREATE INDEX invitation_order ON identity_invitation(kind,created_at,id);
