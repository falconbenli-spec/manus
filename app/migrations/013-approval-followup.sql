CREATE TABLE approval_followups (
 id TEXT PRIMARY KEY,
 step_id TEXT NOT NULL UNIQUE REFERENCES approval_steps(id),
 request_id TEXT NOT NULL REFERENCES requests(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 recipient_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
 created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER approval_followup_pending BEFORE INSERT ON approval_followups
WHEN NOT EXISTS(SELECT 1 FROM approval_steps s JOIN requests r ON r.id=s.request_id WHERE s.id=NEW.step_id AND s.request_id=NEW.request_id AND s.approver_id=NEW.recipient_id AND s.status='pending' AND r.status='pending' AND s.revision=r.revision)
BEGIN SELECT RAISE(ABORT,'followup needs a current pending approval'); END;
CREATE TRIGGER approval_followup_update BEFORE UPDATE ON approval_followups BEGIN SELECT RAISE(ABORT,'followup is immutable'); END;
CREATE TRIGGER approval_followup_delete BEFORE DELETE ON approval_followups BEGIN SELECT RAISE(ABORT,'followup is immutable'); END;
