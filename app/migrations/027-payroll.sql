-- مسير الرواتب: إعداد ومراجعة واعتماد بثلاثة أشخاص مختلفين، وقسيمة لكل موظف بعد الاعتماد فقط.
-- الاحتساب يطبق عقودًا سارية وسياسة دورة رواتب اعتمدها مدير الموارد البشرية؛ لا نسب مكتوبة في الكود.
CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  cycle_policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  status TEXT NOT NULL CHECK(status IN ('draft','in_review','reviewed','approved','cancelled')),
  headcount INTEGER NOT NULL CHECK(headcount>=0),
  gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  deductions_minor INTEGER NOT NULL CHECK(deductions_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor=gross_minor-deductions_minor),
  prepared_by TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
  CHECK(approved_by IS NULL OR (approved_by<>prepared_by AND approved_by<>reviewed_by)),
  CHECK(status NOT IN ('reviewed','approved') OR reviewed_by IS NOT NULL),
  CHECK((status='approved')=(approved_by IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX payroll_runs_one_live ON payroll_runs(tenant_id,month) WHERE status<>'cancelled';
CREATE TRIGGER payroll_runs_locked BEFORE UPDATE ON payroll_runs
WHEN OLD.status IN ('approved','cancelled') OR NEW.version<>OLD.version+1 OR NEW.month<>OLD.month OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
  OR (OLD.status<>'draft' AND (NEW.gross_minor<>OLD.gross_minor OR NEW.deductions_minor<>OLD.deductions_minor OR NEW.headcount<>OLD.headcount))
BEGIN SELECT RAISE(ABORT,'an approved payroll run is locked; totals change only in draft'); END;
CREATE TRIGGER payroll_runs_no_delete BEFORE DELETE ON payroll_runs BEGIN SELECT RAISE(ABORT,'payroll runs are retained'); END;

CREATE TABLE payroll_lines (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  contract_id TEXT NOT NULL REFERENCES employment_contracts(id),
  paid_fraction_bp INTEGER NOT NULL CHECK(paid_fraction_bp BETWEEN 0 AND 10000),
  earnings TEXT NOT NULL CHECK(json_valid(earnings)),
  gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  unpaid_absence_minor INTEGER NOT NULL CHECK(unpaid_absence_minor>=0),
  social_insurance_minor INTEGER NOT NULL CHECK(social_insurance_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor=gross_minor-unpaid_absence_minor-social_insurance_minor),
  previous_net_minor INTEGER,
  variance_flag INTEGER NOT NULL CHECK(variance_flag IN (0,1)),
  variance_note TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL CHECK(json_valid(basis)),
  UNIQUE(run_id,user_id)
) STRICT;
-- السطور تُعاد حسابها في المسودة فقط، ويُكتب تبرير الفرق أثناء المراجعة فقط.
CREATE TRIGGER payroll_lines_locked_update BEFORE UPDATE ON payroll_lines
WHEN (SELECT status FROM payroll_runs WHERE id=OLD.run_id)<>'in_review' OR NEW.net_minor<>OLD.net_minor OR NEW.gross_minor<>OLD.gross_minor OR NEW.user_id<>OLD.user_id OR NEW.earnings<>OLD.earnings OR NEW.basis<>OLD.basis
BEGIN SELECT RAISE(ABORT,'payroll lines change only by recalculating a draft'); END;
CREATE TRIGGER payroll_lines_locked_delete BEFORE DELETE ON payroll_lines
WHEN (SELECT status FROM payroll_runs WHERE id=OLD.run_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'payroll lines change only by recalculating a draft'); END;
CREATE TRIGGER payroll_lines_locked_insert BEFORE INSERT ON payroll_lines
WHEN (SELECT status FROM payroll_runs WHERE id=NEW.run_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'payroll lines change only by recalculating a draft'); END;

CREATE TABLE payslip_views (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES payroll_lines(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  viewed_at TEXT NOT NULL
) STRICT;
