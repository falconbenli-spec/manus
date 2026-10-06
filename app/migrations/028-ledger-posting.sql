-- ربط المستندات بالدفتر: خريطة حسابات معتمدة، وقيد واحد لكل مستند مصدر بسطور لا تُغيَّر يدويًا.
CREATE TABLE finance_account_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('receivable','revenue','output_vat','bank','salaries_expense','salaries_payable','social_insurance_payable')),
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
CREATE TRIGGER finance_account_mappings_fixed BEFORE UPDATE ON finance_account_mappings
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.purpose<>OLD.purpose OR NEW.account_id<>OLD.account_id OR NEW.cost_center_id<>OLD.cost_center_id OR NEW.effective_from<>OLD.effective_from OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a mapping is approved once and replaced by a new dated mapping'); END;
CREATE TRIGGER finance_account_mappings_no_delete BEFORE DELETE ON finance_account_mappings BEGIN SELECT RAISE(ABORT,'mappings are retained'); END;

CREATE TABLE finance_source_links (
  source_kind TEXT NOT NULL CHECK(source_kind IN ('tax_invoice','credit_note','ar_receipt','payroll_run')),
  source_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  journal_id TEXT NOT NULL UNIQUE REFERENCES finance_journals(id),
  expected_lines TEXT NOT NULL CHECK(json_valid(expected_lines)),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_kind,source_id)
) STRICT;
CREATE TRIGGER finance_source_links_no_update BEFORE UPDATE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;
CREATE TRIGGER finance_source_links_no_delete BEFORE DELETE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;
