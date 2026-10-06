CREATE TABLE employee_profiles (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  job_title TEXT NOT NULL CHECK(length(trim(job_title)) BETWEEN 2 AND 120),
  employment_type TEXT NOT NULL CHECK(employment_type IN ('full_time','part_time','contract','intern')),
  join_date TEXT NOT NULL CHECK(join_date LIKE '____-__-__'),
  contract_end TEXT CHECK(contract_end IS NULL OR contract_end>join_date),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_notice','left')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE employee_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('national_id','iqama','work_permit','passport','contract','qualification','medical_insurance','other')),
  reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 2 AND 40),
  issued_on TEXT CHECK(issued_on IS NULL OR issued_on LIKE '____-__-__'),
  expires_on TEXT NOT NULL CHECK(expires_on LIKE '____-__-__'),
  note TEXT NOT NULL DEFAULT '',
  replaced_by TEXT REFERENCES employee_documents(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE employee_changes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK(change_type IN ('job_title','department','manager','employment_type','status','contract_end')),
  from_value TEXT NOT NULL,
  to_value TEXT NOT NULL CHECK(length(trim(to_value))>0),
  effective_from TEXT NOT NULL CHECK(effective_from LIKE '____-__-__'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  request_id TEXT REFERENCES requests(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  cancelled_at TEXT,
  CHECK(applied_at IS NULL OR cancelled_at IS NULL),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE INDEX employee_documents_expiry ON employee_documents(tenant_id,expires_on,replaced_by);
CREATE INDEX employee_changes_due ON employee_changes(tenant_id,effective_from,applied_at);

CREATE TRIGGER employee_change_immutable BEFORE UPDATE ON employee_changes
WHEN OLD.applied_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'a settled employee change is immutable'); END;

CREATE TRIGGER employee_document_no_delete BEFORE DELETE ON employee_documents
BEGIN SELECT RAISE(ABORT,'employee documents are archived, not deleted'); END;
