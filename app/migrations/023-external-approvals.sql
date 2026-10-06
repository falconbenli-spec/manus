-- سجل الموافقات الخارجية: موظف مخول يوثق موافقة عميل وصلت خارج المنصة.
-- لا يوجد دخول للعميل، والسجل ليس توقيعًا إلكترونيًا منه.
CREATE TABLE client_approvers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  title TEXT NOT NULL,
  authority_basis TEXT NOT NULL CHECK(length(trim(authority_basis))>=10),
  authority_scope TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  revoked_on TEXT,
  revoked_by TEXT REFERENCES users(id),
  revoke_reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((revoked_on IS NULL)=(revoked_by IS NULL))
) STRICT;
CREATE TRIGGER client_approvers_fixed BEFORE UPDATE ON client_approvers
WHEN NEW.name<>OLD.name OR NEW.title<>OLD.title OR NEW.authority_basis<>OLD.authority_basis OR NEW.authority_scope<>OLD.authority_scope OR NEW.valid_from<>OLD.valid_from OR NEW.project_id<>OLD.project_id OR NEW.recorded_by<>OLD.recorded_by OR OLD.revoked_on IS NOT NULL
BEGIN SELECT RAISE(ABORT,'approver identity is fixed; revoke and record a new one'); END;
CREATE TRIGGER client_approvers_no_delete BEFORE DELETE ON client_approvers BEGIN SELECT RAISE(ABORT,'approvers are retained'); END;

CREATE TABLE external_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  studio_id TEXT NOT NULL REFERENCES studio_workspaces(id),
  output_id TEXT NOT NULL REFERENCES studio_outputs(id),
  output_version_id TEXT NOT NULL REFERENCES studio_output_versions(id),
  output_revision INTEGER NOT NULL CHECK(output_revision>0),
  output_digest TEXT NOT NULL,
  approver_id TEXT NOT NULL REFERENCES client_approvers(id),
  approver_snapshot TEXT NOT NULL CHECK(json_valid(approver_snapshot)),
  decision TEXT NOT NULL CHECK(decision IN ('approved','approved_with_conditions','changes_requested','rejected')),
  scope_note TEXT NOT NULL CHECK(length(trim(scope_note))>=10),
  channel TEXT NOT NULL CHECK(channel IN ('email','signed_document','meeting_minutes','message','call')),
  received_on TEXT NOT NULL,
  evidence_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending_evidence','documented','verified','withdrawn')),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification_note TEXT NOT NULL DEFAULT '',
  withdrawn_by TEXT REFERENCES users(id),
  withdrawn_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(verified_by IS NULL OR verified_by<>recorded_by),
  CHECK(status<>'verified' OR (verified_by IS NOT NULL AND length(trim(evidence_reference))>=10)),
  CHECK(status<>'documented' OR length(trim(evidence_reference))>=10)
) STRICT;
CREATE INDEX external_approvals_output ON external_approvals(output_id,output_revision);
-- ما قاله العميل وعلى أي نسخة لا يتغير بعد تسجيله؛ يتغير الدليل والحالة فقط.
CREATE TRIGGER external_approvals_fixed BEFORE UPDATE ON external_approvals
WHEN NEW.output_version_id<>OLD.output_version_id OR NEW.output_revision<>OLD.output_revision OR NEW.output_digest<>OLD.output_digest OR NEW.approver_id<>OLD.approver_id OR NEW.approver_snapshot<>OLD.approver_snapshot
  OR NEW.decision<>OLD.decision OR NEW.scope_note<>OLD.scope_note OR NEW.channel<>OLD.channel OR NEW.received_on<>OLD.received_on OR NEW.recorded_by<>OLD.recorded_by OR NEW.recorded_at<>OLD.recorded_at
  OR NEW.version<>OLD.version+1 OR OLD.status='withdrawn' OR (OLD.status='verified' AND NEW.status<>'withdrawn')
BEGIN SELECT RAISE(ABORT,'a recorded external approval keeps its content'); END;
CREATE TRIGGER external_approvals_no_delete BEFORE DELETE ON external_approvals BEGIN SELECT RAISE(ABORT,'external approvals are retained'); END;
