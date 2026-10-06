-- العهد والمصروفات والأصول الثابتة.
CREATE TABLE custodies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  holder_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','issued','closed','rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  issued_on TEXT,
  issue_reference TEXT,
  issued_by TEXT REFERENCES users(id),
  returned_minor INTEGER NOT NULL DEFAULT 0 CHECK(returned_minor>=0),
  return_reference TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(holder_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by IS NULL OR approved_by<>holder_id),
  CHECK(issued_by IS NULL OR issued_by<>holder_id),
  CHECK(closed_by IS NULL OR closed_by<>holder_id),
  CHECK(status NOT IN ('issued','closed') OR (issued_on IS NOT NULL AND issue_reference IS NOT NULL AND issued_by IS NOT NULL))
) STRICT;
CREATE TRIGGER custodies_fixed BEFORE UPDATE ON custodies
WHEN OLD.status IN ('closed','rejected') OR NEW.version<>OLD.version+1 OR NEW.holder_id<>OLD.holder_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.purpose<>OLD.purpose
BEGIN SELECT RAISE(ABORT,'a custody keeps its holder and amount; closed custodies are final'); END;
CREATE TRIGGER custodies_no_delete BEFORE DELETE ON custodies BEGIN SELECT RAISE(ABORT,'custodies are retained'); END;

CREATE TABLE expense_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  claimant_id TEXT NOT NULL,
  custody_id TEXT REFERENCES custodies(id),
  project_id TEXT,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('travel','hospitality','supplies','transport','subscriptions','production','other')),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  receipt_reference TEXT NOT NULL CHECK(length(trim(receipt_reference))>=3),
  status TEXT NOT NULL CHECK(status IN ('submitted','manager_approved','finance_approved','reimbursed','rejected')),
  manager_id TEXT REFERENCES users(id),
  manager_decided_at TEXT,
  finance_id TEXT REFERENCES users(id),
  finance_decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  reimbursed_on TEXT,
  reimbursement_reference TEXT,
  reimbursed_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(claimant_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  CHECK(manager_id IS NULL OR manager_id<>claimant_id),
  CHECK(finance_id IS NULL OR finance_id<>claimant_id),
  CHECK(reimbursed_by IS NULL OR reimbursed_by<>claimant_id),
  CHECK(status<>'reimbursed' OR (custody_id IS NULL AND reimbursed_on IS NOT NULL AND reimbursement_reference IS NOT NULL))
) STRICT;
-- الإيصال نفسه لا يُطالب به مرتين.
CREATE UNIQUE INDEX expense_claims_receipt ON expense_claims(tenant_id,claimant_id,expense_date,amount_minor,receipt_reference) WHERE status<>'rejected';
CREATE TRIGGER expense_claims_fixed BEFORE UPDATE ON expense_claims
WHEN OLD.status IN ('reimbursed','rejected') OR NEW.version<>OLD.version+1 OR NEW.claimant_id<>OLD.claimant_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.expense_date<>OLD.expense_date OR NEW.receipt_reference<>OLD.receipt_reference OR NEW.custody_id IS NOT OLD.custody_id
BEGIN SELECT RAISE(ABORT,'a claim keeps its receipt and amount; settled claims are final'); END;
CREATE TRIGGER expense_claims_no_delete BEFORE DELETE ON expense_claims BEGIN SELECT RAISE(ABORT,'claims are retained'); END;

CREATE TABLE fixed_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  category TEXT NOT NULL CHECK(category IN ('devices','cameras_production','furniture','vehicles','software','other')),
  acquired_on TEXT NOT NULL,
  cost_minor INTEGER NOT NULL CHECK(cost_minor>0),
  salvage_minor INTEGER NOT NULL DEFAULT 0 CHECK(salvage_minor>=0 AND salvage_minor<cost_minor),
  useful_months INTEGER NOT NULL CHECK(useful_months BETWEEN 1 AND 600),
  custodian_id TEXT REFERENCES users(id),
  location TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','active','disposed','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  disposed_on TEXT,
  disposal_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  CHECK(approved_by IS NULL OR approved_by<>recorded_by),
  CHECK((status='disposed')=(disposed_on IS NOT NULL))
) STRICT;
CREATE TRIGGER fixed_assets_fixed BEFORE UPDATE ON fixed_assets
WHEN NEW.version<>OLD.version+1 OR NEW.code<>OLD.code OR NEW.cost_minor<>OLD.cost_minor OR NEW.salvage_minor<>OLD.salvage_minor OR NEW.useful_months<>OLD.useful_months OR NEW.acquired_on<>OLD.acquired_on OR OLD.status IN ('disposed','rejected')
BEGIN SELECT RAISE(ABORT,'an asset keeps its cost basis; disposed assets are final'); END;
CREATE TRIGGER fixed_assets_no_delete BEFORE DELETE ON fixed_assets BEGIN SELECT RAISE(ABORT,'assets are retained'); END;

CREATE TABLE depreciation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  total_minor INTEGER NOT NULL CHECK(total_minor>0),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,month)
) STRICT;
CREATE TABLE depreciation_lines (
  run_id TEXT NOT NULL REFERENCES depreciation_runs(id),
  asset_id TEXT NOT NULL REFERENCES fixed_assets(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(run_id,asset_id)
) STRICT;
CREATE TRIGGER depreciation_runs_no_update BEFORE UPDATE ON depreciation_runs BEGIN SELECT RAISE(ABORT,'depreciation runs are immutable'); END;
CREATE TRIGGER depreciation_runs_no_delete BEFORE DELETE ON depreciation_runs BEGIN SELECT RAISE(ABORT,'depreciation runs are immutable'); END;
CREATE TRIGGER depreciation_lines_no_update BEFORE UPDATE ON depreciation_lines BEGIN SELECT RAISE(ABORT,'depreciation lines are immutable'); END;
CREATE TRIGGER depreciation_lines_no_delete BEFORE DELETE ON depreciation_lines BEGIN SELECT RAISE(ABORT,'depreciation lines are immutable'); END;
