CREATE TABLE idempotency_keys (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,operation,key),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER step_identity_immutable BEFORE UPDATE ON approval_steps
WHEN OLD.id<>NEW.id OR OLD.request_id<>NEW.request_id OR OLD.revision<>NEW.revision
 OR OLD.position<>NEW.position OR OLD.approver_id<>NEW.approver_id
BEGIN SELECT RAISE(ABORT,'approval identity is immutable'); END;
CREATE TRIGGER decision_immutable BEFORE UPDATE ON approval_steps
WHEN OLD.status<>'pending'
BEGIN SELECT RAISE(ABORT,'approval decision is immutable'); END;
CREATE TRIGGER decision_valid BEFORE UPDATE ON approval_steps
WHEN NEW.status='pending' OR NEW.decided_at IS NULL
BEGIN SELECT RAISE(ABORT,'a pending step must receive a dated decision'); END;
CREATE TRIGGER decision_no_delete BEFORE DELETE ON approval_steps
BEGIN SELECT RAISE(ABORT,'approval history is immutable'); END;
CREATE TRIGGER decision_initial BEFORE INSERT ON approval_steps
WHEN NEW.status<>'pending' OR NEW.decided_at IS NOT NULL OR NEW.note<>''
BEGIN SELECT RAISE(ABORT,'new approval steps must be pending'); END;
