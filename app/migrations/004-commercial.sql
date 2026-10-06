CREATE TABLE commercial_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  contact TEXT NOT NULL,
  source TEXT NOT NULL,
  sector TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('lead','qualification_pending','qualification_rejected','qualified','quote_draft','quote_pending','quote_rejected','quote_approved','contracted','project_active')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  current_qualification_id TEXT,
  current_quote_id TEXT,
  project_id TEXT REFERENCES projects(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  UNIQUE(tenant_id,registration_number),
  UNIQUE(id,tenant_id)
) STRICT;

CREATE TABLE commercial_qualifications (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(case_id,revision)
) STRICT;
CREATE TABLE commercial_quotes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  qualification_id TEXT NOT NULL REFERENCES commercial_qualifications(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  digest TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(case_id,revision)
) STRICT;
CREATE TABLE commercial_contracts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES commercial_cases(id),
  quote_id TEXT NOT NULL UNIQUE REFERENCES commercial_quotes(id),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  agreement_evidence TEXT NOT NULL,
  customer_representative TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE commercial_project_baselines (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES commercial_cases(id),
  contract_id TEXT NOT NULL UNIQUE REFERENCES commercial_contracts(id),
  quote_id TEXT NOT NULL REFERENCES commercial_quotes(id),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE commercial_deliveries (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  contract_id TEXT NOT NULL REFERENCES commercial_contracts(id),
  line_index INTEGER NOT NULL CHECK(line_index>=0),
  revision INTEGER NOT NULL CHECK(revision>0),
  evidence TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(case_id,line_index,revision)
) STRICT;
CREATE TABLE commercial_changes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  contract_id TEXT NOT NULL REFERENCES commercial_contracts(id),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE commercial_change_tasks (
  change_id TEXT PRIMARY KEY REFERENCES commercial_changes(id),
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE commercial_reviews (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  kind TEXT NOT NULL CHECK(kind IN ('qualification','quote','delivery','change')),
  subject_id TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  approver_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json)),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK(requested_by<>approver_id),
  UNIQUE(kind,subject_id)
) STRICT;
CREATE INDEX commercial_owner ON commercial_cases(tenant_id,owner_id,status);
CREATE INDEX commercial_review_inbox ON commercial_reviews(approver_id,status,case_id);

CREATE TRIGGER commercial_case_identity BEFORE UPDATE ON commercial_cases
WHEN OLD.id<>NEW.id OR OLD.tenant_id<>NEW.tenant_id OR OLD.department_id<>NEW.department_id
 OR OLD.owner_id<>NEW.owner_id OR OLD.registration_number<>NEW.registration_number
 OR OLD.name<>NEW.name OR OLD.contact<>NEW.contact OR OLD.source<>NEW.source OR OLD.sector<>NEW.sector
 OR OLD.created_at<>NEW.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'commercial identity is fixed and changes require the next version'); END;
CREATE TRIGGER commercial_case_no_delete BEFORE DELETE ON commercial_cases
BEGIN SELECT RAISE(ABORT,'commercial history is immutable'); END;
CREATE TRIGGER commercial_qualification_no_update BEFORE UPDATE ON commercial_qualifications BEGIN SELECT RAISE(ABORT,'qualification versions are immutable'); END;
CREATE TRIGGER commercial_qualification_no_delete BEFORE DELETE ON commercial_qualifications BEGIN SELECT RAISE(ABORT,'qualification versions are immutable'); END;
CREATE TRIGGER commercial_quote_no_update BEFORE UPDATE ON commercial_quotes BEGIN SELECT RAISE(ABORT,'quote versions are immutable'); END;
CREATE TRIGGER commercial_quote_no_delete BEFORE DELETE ON commercial_quotes BEGIN SELECT RAISE(ABORT,'quote versions are immutable'); END;
CREATE TRIGGER commercial_contract_no_update BEFORE UPDATE ON commercial_contracts BEGIN SELECT RAISE(ABORT,'internal contracts are immutable'); END;
CREATE TRIGGER commercial_contract_no_delete BEFORE DELETE ON commercial_contracts BEGIN SELECT RAISE(ABORT,'internal contracts are immutable'); END;
CREATE TRIGGER commercial_baseline_no_update BEFORE UPDATE ON commercial_project_baselines BEGIN SELECT RAISE(ABORT,'project baselines are immutable'); END;
CREATE TRIGGER commercial_baseline_no_delete BEFORE DELETE ON commercial_project_baselines BEGIN SELECT RAISE(ABORT,'project baselines are immutable'); END;
CREATE TRIGGER commercial_delivery_no_update BEFORE UPDATE ON commercial_deliveries BEGIN SELECT RAISE(ABORT,'delivery versions are immutable'); END;
CREATE TRIGGER commercial_delivery_no_delete BEFORE DELETE ON commercial_deliveries BEGIN SELECT RAISE(ABORT,'delivery versions are immutable'); END;
CREATE TRIGGER commercial_change_no_update BEFORE UPDATE ON commercial_changes BEGIN SELECT RAISE(ABORT,'change requests are immutable'); END;
CREATE TRIGGER commercial_change_no_delete BEFORE DELETE ON commercial_changes BEGIN SELECT RAISE(ABORT,'change requests are immutable'); END;
CREATE TRIGGER commercial_change_task_no_update BEFORE UPDATE ON commercial_change_tasks BEGIN SELECT RAISE(ABORT,'change task links are immutable'); END;
CREATE TRIGGER commercial_change_task_no_delete BEFORE DELETE ON commercial_change_tasks BEGIN SELECT RAISE(ABORT,'change task links are immutable'); END;

CREATE TRIGGER commercial_review_initial BEFORE INSERT ON commercial_reviews
WHEN NEW.status<>'pending' OR NEW.decided_at IS NOT NULL OR NEW.note<>'' OR NEW.evidence_json<>'{}'
 OR NOT EXISTS(SELECT 1 FROM commercial_cases c JOIN users a ON a.tenant_id=c.tenant_id
 JOIN users r ON r.tenant_id=c.tenant_id WHERE c.id=NEW.case_id AND a.id=NEW.approver_id
 AND r.id=NEW.requested_by AND a.active=1 AND r.active=1)
BEGIN SELECT RAISE(ABORT,'commercial reviews start pending inside the same tenant'); END;
CREATE TRIGGER commercial_review_identity BEFORE UPDATE ON commercial_reviews
WHEN OLD.id<>NEW.id OR OLD.case_id<>NEW.case_id OR OLD.kind<>NEW.kind OR OLD.subject_id<>NEW.subject_id
 OR OLD.requested_by<>NEW.requested_by OR OLD.approver_id<>NEW.approver_id OR OLD.requested_at<>NEW.requested_at
BEGIN SELECT RAISE(ABORT,'commercial review identity is immutable'); END;
CREATE TRIGGER commercial_review_decision BEFORE UPDATE ON commercial_reviews
WHEN OLD.status<>'pending' OR NEW.status='pending' OR NEW.decided_at IS NULL OR length(trim(NEW.note))<3
BEGIN SELECT RAISE(ABORT,'commercial decisions are final and need a dated reason'); END;
CREATE TRIGGER commercial_review_no_delete BEFORE DELETE ON commercial_reviews BEGIN SELECT RAISE(ABORT,'commercial decisions are immutable'); END;
