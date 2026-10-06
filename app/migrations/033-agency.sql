-- تشغيل الوكالة: ملف العميل وعلاماته وجهات اتصاله وفريق حسابه، كتالوج الباقات التجارية، قوالب المشاريع، ساعات العمل، ورصيد العقد الدوري.
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  legal_name TEXT NOT NULL CHECK(length(trim(legal_name))>=3),
  trade_name TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prospect','active','paused','closed')),
  owner_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER clients_no_delete BEFORE DELETE ON clients BEGIN SELECT RAISE(ABORT,'clients are retained'); END;
CREATE TABLE client_members (
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY(client_id,user_id)
) STRICT;
CREATE TABLE client_brands (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  guideline_reference TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE client_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE client_links (
  client_id TEXT NOT NULL REFERENCES clients(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES commercial_cases(id),
  linked_by TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL,
  PRIMARY KEY(client_id,case_id)
) STRICT;

CREATE TABLE offerings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  family TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  content TEXT NOT NULL CHECK(json_valid(content)),
  pricing_model TEXT NOT NULL CHECK(pricing_model IN ('fixed','retainer','hourly','per_output','fee_plus_media')),
  price_minor INTEGER CHECK(price_minor IS NULL OR price_minor>0),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected','retired')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,code,revision),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by)
) STRICT;
CREATE TRIGGER offerings_fixed BEFORE UPDATE ON offerings
WHEN NEW.content<>OLD.content OR NEW.name<>OLD.name OR NEW.price_minor IS NOT OLD.price_minor OR NEW.pricing_model<>OLD.pricing_model OR NEW.code<>OLD.code OR NEW.revision<>OLD.revision
  OR NOT ((OLD.status='draft' AND NEW.status IN ('approved','rejected')) OR (OLD.status='approved' AND NEW.status='retired'))
BEGIN SELECT RAISE(ABORT,'an offering revision is fixed; publish a new revision'); END;
CREATE TRIGGER offerings_no_delete BEFORE DELETE ON offerings BEGIN SELECT RAISE(ABORT,'offerings are retained'); END;

CREATE TABLE project_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  service_kind TEXT NOT NULL,
  phases TEXT NOT NULL CHECK(json_valid(phases)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE project_template_uses (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES project_templates(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  start_date TEXT NOT NULL,
  tasks_created INTEGER NOT NULL,
  applied_by TEXT NOT NULL REFERENCES users(id),
  applied_at TEXT NOT NULL,
  UNIQUE(template_id,project_id)
) STRICT;

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 15 AND 960),
  billable INTEGER NOT NULL CHECK(billable IN (0,1)),
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  status TEXT NOT NULL CHECK(status IN ('logged','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>user_id)
) STRICT;
CREATE INDEX time_entries_user_date ON time_entries(user_id,work_date);
CREATE TRIGGER time_entries_fixed BEFORE UPDATE ON time_entries
WHEN OLD.status<>'logged' OR NEW.minutes<>OLD.minutes OR NEW.work_date<>OLD.work_date OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id
BEGIN SELECT RAISE(ABORT,'a decided time entry is final; log a correcting entry'); END;
CREATE TRIGGER time_entries_no_delete BEFORE DELETE ON time_entries
WHEN OLD.status<>'logged' BEGIN SELECT RAISE(ABORT,'a decided time entry is retained'); END;

CREATE TABLE retainers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  period_month TEXT NOT NULL CHECK(period_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  allowances TEXT NOT NULL CHECK(json_valid(allowances)),
  contract_reference TEXT NOT NULL CHECK(length(trim(contract_reference))>=5),
  carry_over_rule TEXT NOT NULL CHECK(length(trim(carry_over_rule))>=5),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(client_id,name,period_month)
) STRICT;
CREATE TABLE retainer_usage (
  id TEXT PRIMARY KEY,
  retainer_id TEXT NOT NULL REFERENCES retainers(id),
  deliverable_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  overage_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER retainer_usage_no_update BEFORE UPDATE ON retainer_usage BEGIN SELECT RAISE(ABORT,'usage is corrected by a new record'); END;
CREATE TRIGGER retainer_usage_no_delete BEFORE DELETE ON retainer_usage BEGIN SELECT RAISE(ABORT,'usage is corrected by a new record'); END;
