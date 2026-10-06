-- ضريبة المدخلات وأوامر دفع الموردين، مع توسيع أغراض الربط المحاسبي وأنواع المستندات المصدر.
-- الجدولان التاليان يُعاد بناؤهما لأن قيود CHECK لا تُعدَّل في مكانها؛ تُنقل الصفوف كما هي.
DROP TRIGGER finance_account_mappings_fixed;
DROP TRIGGER finance_account_mappings_no_delete;
ALTER TABLE finance_account_mappings RENAME TO finance_account_mappings_v1;
CREATE TABLE finance_account_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('receivable','revenue','output_vat','bank','salaries_expense','salaries_payable','social_insurance_payable','payable','input_vat')),
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
INSERT INTO finance_account_mappings SELECT * FROM finance_account_mappings_v1;
DROP TABLE finance_account_mappings_v1;
CREATE TRIGGER finance_account_mappings_fixed BEFORE UPDATE ON finance_account_mappings
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.purpose<>OLD.purpose OR NEW.account_id<>OLD.account_id OR NEW.cost_center_id<>OLD.cost_center_id OR NEW.effective_from<>OLD.effective_from OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a mapping is approved once and replaced by a new dated mapping'); END;
CREATE TRIGGER finance_account_mappings_no_delete BEFORE DELETE ON finance_account_mappings BEGIN SELECT RAISE(ABORT,'mappings are retained'); END;

DROP TRIGGER finance_source_links_no_update;
DROP TRIGGER finance_source_links_no_delete;
ALTER TABLE finance_source_links RENAME TO finance_source_links_v1;
CREATE TABLE finance_source_links (
  source_kind TEXT NOT NULL CHECK(source_kind IN ('tax_invoice','credit_note','ar_receipt','payroll_run','supplier_payment')),
  source_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  journal_id TEXT NOT NULL UNIQUE REFERENCES finance_journals(id),
  expected_lines TEXT NOT NULL CHECK(json_valid(expected_lines)),
  linked_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_kind,source_id)
) STRICT;
INSERT INTO finance_source_links SELECT * FROM finance_source_links_v1;
DROP TABLE finance_source_links_v1;
CREATE TRIGGER finance_source_links_no_update BEFORE UPDATE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;
CREATE TRIGGER finance_source_links_no_delete BEFORE DELETE ON finance_source_links BEGIN SELECT RAISE(ABORT,'source links are immutable'); END;

-- ضريبة المدخلات على فاتورة المورد: تُسجل من الفاتورة الضريبية للمورد ويتحقق منها شخص آخر قبل أن تدخل أي تقرير.
CREATE TABLE procurement_invoice_tax (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  invoice_id TEXT NOT NULL REFERENCES procurement_invoices(id),
  supplier_vat_number TEXT NOT NULL CHECK(length(supplier_vat_number)=15 AND supplier_vat_number NOT GLOB '*[^0-9]*'),
  supplier_invoice_number TEXT NOT NULL CHECK(length(trim(supplier_invoice_number))>=1),
  invoice_date TEXT NOT NULL,
  vat_minor INTEGER NOT NULL CHECK(vat_minor>=0),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>recorded_by),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX procurement_invoice_tax_live ON procurement_invoice_tax(invoice_id) WHERE status<>'rejected';
CREATE TRIGGER procurement_invoice_tax_fixed BEFORE UPDATE ON procurement_invoice_tax
WHEN OLD.status<>'pending' OR NEW.invoice_id<>OLD.invoice_id OR NEW.vat_minor<>OLD.vat_minor OR NEW.supplier_vat_number<>OLD.supplier_vat_number OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a decided tax record is final'); END;
CREATE TRIGGER procurement_invoice_tax_no_delete BEFORE DELETE ON procurement_invoice_tax BEGIN SELECT RAISE(ABORT,'tax records are retained'); END;

-- أمر دفع المورد: «معتمد» لا يعني أن البنك نفّذ؛ التنفيذ يُسجل بمرجع بنكي ودليل بعد حدوثه خارج المنصة.
CREATE TABLE payment_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  payable_id TEXT NOT NULL REFERENCES procurement_payables(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  bank_account_id TEXT NOT NULL REFERENCES vendor_bank_accounts(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','executed','rejected','cancelled')),
  prepared_by TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  executed_on TEXT,
  bank_reference TEXT,
  execution_evidence TEXT NOT NULL DEFAULT '',
  execution_recorded_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((status='executed')=(executed_on IS NOT NULL AND bank_reference IS NOT NULL AND execution_recorded_by IS NOT NULL AND length(trim(execution_evidence))>=10)),
  CHECK(status NOT IN ('approved','executed') OR approved_by IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX payment_orders_live ON payment_orders(payable_id) WHERE status IN ('pending','approved','executed');
CREATE UNIQUE INDEX payment_orders_reference ON payment_orders(tenant_id,bank_reference) WHERE bank_reference IS NOT NULL;
CREATE TRIGGER payment_orders_fixed BEFORE UPDATE ON payment_orders
WHEN OLD.status IN ('executed','rejected','cancelled') OR NEW.version<>OLD.version+1 OR NEW.payable_id<>OLD.payable_id OR NEW.vendor_id<>OLD.vendor_id OR NEW.bank_account_id<>OLD.bank_account_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.prepared_by<>OLD.prepared_by
  OR NOT ((OLD.status='pending' AND NEW.status IN ('approved','rejected','cancelled')) OR (OLD.status='approved' AND NEW.status IN ('executed','cancelled')))
BEGIN SELECT RAISE(ABORT,'a payment order keeps its payee and amount; executed orders are final'); END;
CREATE TRIGGER payment_orders_no_delete BEFORE DELETE ON payment_orders BEGIN SELECT RAISE(ABORT,'payment orders are retained'); END;
