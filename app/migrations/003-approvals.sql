CREATE TABLE approval_delegations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  grantor_id TEXT NOT NULL,
  delegate_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','hr','it','pm')),
  department_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK(ends_at>starts_at),
  reason TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK(grantor_id<>delegate_id),
  FOREIGN KEY(grantor_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(delegate_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;
CREATE INDEX approval_delegations_scope ON approval_delegations(delegate_id,grantor_id,service_code,starts_at,ends_at);
CREATE TRIGGER delegation_immutable BEFORE UPDATE ON approval_delegations
WHEN OLD.revoked_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id
 OR NEW.grantor_id<>OLD.grantor_id OR NEW.delegate_id<>OLD.delegate_id
 OR NEW.service_code<>OLD.service_code OR NEW.role<>OLD.role OR NEW.department_id<>OLD.department_id
 OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR NEW.reason<>OLD.reason
 OR NEW.created_at<>OLD.created_at OR NEW.revoked_at IS NULL OR NEW.revocation_reason IS NULL
 OR length(trim(NEW.revocation_reason))<3 OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'delegation is immutable except revocation'); END;
CREATE TRIGGER delegation_no_delete BEFORE DELETE ON approval_delegations
BEGIN SELECT RAISE(ABORT,'delegation cannot be deleted'); END;
ALTER TABLE approval_steps ADD COLUMN decided_by TEXT REFERENCES users(id);
ALTER TABLE approval_steps ADD COLUMN delegation_id TEXT REFERENCES approval_delegations(id);
