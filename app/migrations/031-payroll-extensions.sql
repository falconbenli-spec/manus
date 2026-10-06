-- توسعة الرواتب: إضافات وخصومات معتمدة، سلف بأقساط، حسابات رواتب الموظفين، دفع المسير، وتسوية نهاية الخدمة.
-- وتُفتح قوائم أغراض الربط المحاسبي وأنواع المستندات المصدر ليتحقق منها الكود، فلا يُعاد بناء الجدول مع كل نوع جديد.
DROP TRIGGER finance_account_mappings_fixed;
DROP TRIGGER finance_account_mappings_no_delete;
ALTER TABLE finance_account_mappings RENAME TO finance_account_mappings_v2;
CREATE TABLE finance_account_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purpose TEXT NOT NULL CHECK(length(purpose) BETWEEN 3 AND 40 AND purpose NOT GLOB '*[^a-z_]*'),
  account_id TEXT NOT NULL,
  cost_center_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id,tenant_id) REFERENCES finance_accounts(id,tenant_id),
  FOREIGN KEY(cost_center_id,tenant_id) REFERENCES finance_cost_centers(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by IS NULL OR approved_by<>recorded_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL))
) STRICT;
INSERT INTO finance_account_mappings SELECT * FROM finance_account_mappings_v2;
DROP TABLE finance_account_mappings_v2;
CREATE TRIGGER finance_account_mappings_fixed BEFORE UPDATE ON finance_account_mappings
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.purpose<>OLD.purpose OR NEW.account_id<>OLD.account_id OR NEW.cost_center_id<>OLD.cost_center_id OR NEW.effective_from<>OLD.effective_from OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a mapping is approved once and replaced by a new dated mapping'); END;
CREATE TRIGGER finance_account_mappings_no_delete BEFORE DELETE ON finance_account_mappings BEGIN SELECT RAISE(ABORT,'mappings are retained'); END;

DROP TRIGGER finance_source_links_no_update;
DROP TRIGGER finance_source_links_no_delete;
ALTER TABLE finance_source_links RENAME TO finance_source_links_v2;
CREATE TABLE finance_source_links (
  source_kind TEXT NOT NULL CHECK(length(source_kind) BETWEEN 3 AND 40 AND source_kind NOT GLOB '*[^a-z_]*'),
  source_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  journal_id TEXT NOT NULL UNIQUE REFERENCES finance_journals(id),
  expected_lines TEXT NOT NULL CHECK(json_valid(expected_lines)),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_kind,source_id)
) STRICT;
INSERT INTO finance_source_links SELECT * FROM finance_source_links_v2;
DROP TABLE finance_source_links_v2;
CREATE TRIGGER finance_source_links_no_update BEFORE UPDATE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;
CREATE TRIGGER finance_source_links_no_delete BEFORE DELETE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;

-- سطور المسير: تُضاف الإضافات وقسط السلفة والخصومات الأخرى إلى معادلة الصافي.
CREATE TABLE payslip_views_keep AS SELECT * FROM payslip_views;
DROP TABLE payslip_views;
CREATE TABLE payroll_lines_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  contract_id TEXT NOT NULL REFERENCES employment_contracts(id),
  paid_fraction_bp INTEGER NOT NULL CHECK(paid_fraction_bp BETWEEN 0 AND 10000),
  earnings TEXT NOT NULL CHECK(json_valid(earnings)),
  gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  unpaid_absence_minor INTEGER NOT NULL CHECK(unpaid_absence_minor>=0),
  social_insurance_minor INTEGER NOT NULL CHECK(social_insurance_minor>=0),
  net_minor INTEGER NOT NULL,
  previous_net_minor INTEGER,
  variance_flag INTEGER NOT NULL CHECK(variance_flag IN (0,1)),
  variance_note TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL CHECK(json_valid(basis)),
  additions_minor INTEGER NOT NULL DEFAULT 0 CHECK(additions_minor>=0),
  advance_minor INTEGER NOT NULL DEFAULT 0 CHECK(advance_minor>=0),
  other_deductions_minor INTEGER NOT NULL DEFAULT 0 CHECK(other_deductions_minor>=0),
  adjustments TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(adjustments)),
  UNIQUE(run_id,user_id),
  CHECK(net_minor=gross_minor+additions_minor-unpaid_absence_minor-social_insurance_minor-advance_minor-other_deductions_minor),
  CHECK(net_minor>=0)
) STRICT;
INSERT INTO payroll_lines_next(id,run_id,user_id,contract_id,paid_fraction_bp,earnings,gross_minor,unpaid_absence_minor,social_insurance_minor,net_minor,previous_net_minor,variance_flag,variance_note,basis)
  SELECT id,run_id,user_id,contract_id,paid_fraction_bp,earnings,gross_minor,unpaid_absence_minor,social_insurance_minor,net_minor,previous_net_minor,variance_flag,variance_note,basis FROM payroll_lines;
DROP TABLE payroll_lines;
ALTER TABLE payroll_lines_next RENAME TO payroll_lines;
CREATE TRIGGER payroll_lines_locked_update BEFORE UPDATE ON payroll_lines
WHEN (SELECT status FROM payroll_runs WHERE id=OLD.run_id)<>'in_review' OR NEW.net_minor<>OLD.net_minor OR NEW.gross_minor<>OLD.gross_minor OR NEW.user_id<>OLD.user_id OR NEW.earnings<>OLD.earnings OR NEW.basis<>OLD.basis OR NEW.additions_minor<>OLD.additions_minor OR NEW.advance_minor<>OLD.advance_minor OR NEW.other_deductions_minor<>OLD.other_deductions_minor OR NEW.adjustments<>OLD.adjustments
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
INSERT INTO payslip_views SELECT * FROM payslip_views_keep;
DROP TABLE payslip_views_keep;

-- السلفة: يقترحها موظف الموارد البشرية ويعتمدها شخص آخر؛ أقساطها تدخل المسير شهرًا بشهر.
CREATE TABLE salary_advances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  installments INTEGER NOT NULL CHECK(installments BETWEEN 1 AND 24),
  first_month TEXT NOT NULL CHECK(first_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>proposed_by AND decided_by<>user_id)),
  CHECK((status='proposed')=(decided_by IS NULL))
) STRICT;
CREATE TRIGGER salary_advances_fixed BEFORE UPDATE ON salary_advances
WHEN OLD.status<>'proposed' OR NEW.amount_minor<>OLD.amount_minor OR NEW.installments<>OLD.installments OR NEW.user_id<>OLD.user_id OR NEW.first_month<>OLD.first_month
BEGIN SELECT RAISE(ABORT,'a decided advance is final'); END;
CREATE TRIGGER salary_advances_no_delete BEFORE DELETE ON salary_advances BEGIN SELECT RAISE(ABORT,'advances are retained'); END;

-- كل ما يدخل المسير غير العقد والحضور: عمل إضافي، مكافأة، بدل لمرة، خصم، قسط سلفة. لا يدخل إلا معتمدًا ومرة واحدة.
CREATE TABLE payroll_adjustments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('overtime','bonus','allowance','deduction','advance_installment')),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  advance_id TEXT REFERENCES salary_advances(id),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  run_id TEXT REFERENCES payroll_runs(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>proposed_by AND decided_by<>user_id)),
  CHECK((status='proposed')=(decided_by IS NULL)),
  CHECK((kind='advance_installment')=(advance_id IS NOT NULL))
) STRICT;
CREATE INDEX payroll_adjustments_month ON payroll_adjustments(tenant_id,month,status);
CREATE TRIGGER payroll_adjustments_fixed BEFORE UPDATE ON payroll_adjustments
WHEN NEW.amount_minor<>OLD.amount_minor OR NEW.kind<>OLD.kind OR NEW.user_id<>OLD.user_id OR NEW.month<>OLD.month OR NEW.reason<>OLD.reason
  OR (OLD.status<>'proposed' AND NEW.status<>OLD.status)
  OR (OLD.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id AND (SELECT status FROM payroll_runs WHERE id=OLD.run_id) NOT IN ('draft','cancelled'))
BEGIN SELECT RAISE(ABORT,'a decided adjustment is final and stays with its locked run'); END;
CREATE TRIGGER payroll_adjustments_no_delete BEFORE DELETE ON payroll_adjustments BEGIN SELECT RAISE(ABORT,'adjustments are retained'); END;

-- حساب راتب الموظف: آيبان مشفر، يقترحه موظف الموارد البشرية ويتحقق منه شخص آخر، كحسابات الموردين.
CREATE TABLE employee_bank_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  iban_last4 TEXT NOT NULL CHECK(length(iban_last4)=4),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  effective_month TEXT NOT NULL CHECK(effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>recorded_by),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX employee_bank_one_pending ON employee_bank_accounts(user_id) WHERE status='pending';
CREATE TRIGGER employee_bank_fixed BEFORE UPDATE ON employee_bank_accounts
WHEN OLD.status<>'pending' OR NEW.iban<>OLD.iban OR NEW.user_id<>OLD.user_id OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;
CREATE TRIGGER employee_bank_no_delete BEFORE DELETE ON employee_bank_accounts BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;

-- دفع المسير: يُعد ملف التحويل ثم يُعتمد ثم يوثَّق تنفيذه البنكي؛ الملف داخلي وليس قبولًا مصرفيًا ولا امتثالًا لحماية الأجور.
CREATE TABLE payroll_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  headcount INTEGER NOT NULL CHECK(headcount>0),
  file_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','executed','cancelled')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  executed_on TEXT,
  bank_reference TEXT,
  execution_evidence TEXT NOT NULL DEFAULT '',
  execution_recorded_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK(execution_recorded_by IS NULL OR execution_recorded_by<>prepared_by),
  CHECK((status='executed')=(executed_on IS NOT NULL AND bank_reference IS NOT NULL AND execution_recorded_by IS NOT NULL AND length(trim(execution_evidence))>=10))
) STRICT;
CREATE UNIQUE INDEX payroll_payments_live ON payroll_payments(run_id) WHERE status<>'cancelled';
CREATE TRIGGER payroll_payments_fixed BEFORE UPDATE ON payroll_payments
WHEN OLD.status IN ('executed','cancelled') OR NEW.version<>OLD.version+1 OR NEW.run_id<>OLD.run_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.file_digest<>OLD.file_digest OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'a payroll payment keeps its run and amount; executed payments are final'); END;
CREATE TRIGGER payroll_payments_no_delete BEFORE DELETE ON payroll_payments BEGIN SELECT RAISE(ABORT,'payroll payments are retained'); END;

-- تسوية نهاية الخدمة: مسودة محسوبة من سياسة معتمدة، بتصنيف سبب الإنهاء، ويعتمدها شخص آخر.
CREATE TABLE service_settlements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES employment_contracts(id),
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  end_reason TEXT NOT NULL CHECK(end_reason IN ('employer_termination','contract_expiry','resignation','other')),
  service_start TEXT NOT NULL,
  service_end TEXT NOT NULL,
  service_days INTEGER NOT NULL CHECK(service_days>0),
  wage_base_minor INTEGER NOT NULL CHECK(wage_base_minor>0),
  award_minor INTEGER NOT NULL CHECK(award_minor>=0),
  leave_days INTEGER NOT NULL DEFAULT 0 CHECK(leave_days BETWEEN 0 AND 365),
  leave_payout_minor INTEGER NOT NULL CHECK(leave_payout_minor>=0),
  advances_outstanding_minor INTEGER NOT NULL CHECK(advances_outstanding_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor=award_minor+leave_payout_minor-advances_outstanding_minor),
  basis TEXT NOT NULL CHECK(json_valid(basis)),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(prepared_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>prepared_by AND decided_by<>user_id)),
  CHECK((status='draft')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX service_settlements_live ON service_settlements(contract_id) WHERE status<>'rejected';
CREATE TRIGGER service_settlements_fixed BEFORE UPDATE ON service_settlements
WHEN OLD.status<>'draft' OR NEW.net_minor<>OLD.net_minor OR NEW.award_minor<>OLD.award_minor OR NEW.user_id<>OLD.user_id OR NEW.basis<>OLD.basis
BEGIN SELECT RAISE(ABORT,'a decided settlement is final'); END;
CREATE TRIGGER service_settlements_no_delete BEFORE DELETE ON service_settlements BEGIN SELECT RAISE(ABORT,'settlements are retained'); END;
