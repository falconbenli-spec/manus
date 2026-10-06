-- الفاتورة الضريبية والإشعار الدائن من داخل المنصة (لا نظام محاسبي خارجي).
-- الترقيم متسلسل بلا فجوات ويُمنح عند الإصدار فقط؛ الفاتورة الصادرة لا تُعدل ولا تُحذف وتُصحح بإشعار دائن.
CREATE TABLE company_tax_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_name TEXT NOT NULL CHECK(length(trim(legal_name))>=3),
  vat_number TEXT NOT NULL CHECK(length(vat_number)=15 AND vat_number NOT GLOB '*[^0-9]*'),
  cr_number TEXT NOT NULL CHECK(length(cr_number)=10 AND cr_number NOT GLOB '*[^0-9]*'),
  address TEXT NOT NULL CHECK(json_valid(address)),
  effective_from TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by IS NULL OR approved_by<>recorded_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL))
) STRICT;
CREATE TRIGGER company_tax_profiles_fixed BEFORE UPDATE ON company_tax_profiles
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.legal_name<>OLD.legal_name OR NEW.vat_number<>OLD.vat_number OR NEW.cr_number<>OLD.cr_number OR NEW.address<>OLD.address OR NEW.effective_from<>OLD.effective_from OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a tax profile is approved once and replaced by a new record'); END;
CREATE TRIGGER company_tax_profiles_no_delete BEFORE DELETE ON company_tax_profiles BEGIN SELECT RAISE(ABORT,'tax profiles are retained'); END;

CREATE TABLE customer_tax_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  legal_name TEXT NOT NULL CHECK(length(trim(legal_name))>=3),
  vat_number TEXT CHECK(vat_number IS NULL OR (length(vat_number)=15 AND vat_number NOT GLOB '*[^0-9]*')),
  address TEXT NOT NULL CHECK(json_valid(address)),
  source TEXT NOT NULL CHECK(length(trim(source))>=3),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER customer_tax_profiles_no_update BEFORE UPDATE ON customer_tax_profiles BEGIN SELECT RAISE(ABORT,'customer tax data is replaced by a new record'); END;
CREATE TRIGGER customer_tax_profiles_no_delete BEFORE DELETE ON customer_tax_profiles BEGIN SELECT RAISE(ABORT,'customer tax data is retained'); END;

CREATE TABLE tax_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('invoice','credit_note')),
  claim_id TEXT NOT NULL REFERENCES ar_claims(id),
  original_invoice_id TEXT REFERENCES tax_invoices(id),
  project_id TEXT NOT NULL,
  sequence INTEGER CHECK(sequence IS NULL OR sequence>0),
  number TEXT,
  issued_at TEXT,
  supply_date TEXT NOT NULL,
  seller TEXT NOT NULL CHECK(json_valid(seller)),
  buyer TEXT NOT NULL CHECK(json_valid(buyer)),
  lines TEXT NOT NULL CHECK(json_valid(lines)),
  vat_category TEXT NOT NULL CHECK(vat_category IN ('standard','zero_rated','exempt','out_of_scope')),
  vat_basis_points INTEGER NOT NULL CHECK(vat_basis_points IN (0,1500)),
  vat_reason TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL CHECK(currency='SAR'),
  net_minor INTEGER NOT NULL CHECK(net_minor>0),
  vat_minor INTEGER NOT NULL CHECK(vat_minor>=0),
  total_minor INTEGER NOT NULL CHECK(total_minor=net_minor+vat_minor),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','pending','issued','rejected')),
  prepared_by TEXT NOT NULL,
  issued_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  chain_index INTEGER CHECK(chain_index IS NULL OR chain_index>0),
  previous_hash TEXT,
  hash TEXT,
  qr_tlv TEXT,
  -- لا اتصال بمنصة «فاتورة»: الحالة ثابتة حتى يُبنى الربط ويُثبت.
  reporting_status TEXT NOT NULL DEFAULT 'not_reported' CHECK(reporting_status='not_reported'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='credit_note')=(original_invoice_id IS NOT NULL)),
  CHECK(kind='invoice' OR length(trim(reason))>=10),
  CHECK((vat_category='standard' AND vat_basis_points=1500) OR (vat_category<>'standard' AND vat_basis_points=0 AND length(trim(vat_reason))>=10)),
  CHECK(issued_by IS NULL OR issued_by<>prepared_by),
  CHECK((status='issued')=(sequence IS NOT NULL AND number IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND hash IS NOT NULL AND qr_tlv IS NOT NULL AND chain_index IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX tax_invoices_sequence ON tax_invoices(tenant_id,kind,sequence) WHERE sequence IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_chain ON tax_invoices(tenant_id,chain_index) WHERE chain_index IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_number ON tax_invoices(tenant_id,number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_one_per_claim ON tax_invoices(claim_id) WHERE kind='invoice' AND status<>'rejected';
CREATE TRIGGER tax_invoices_fixed BEFORE UPDATE ON tax_invoices
WHEN OLD.status IN ('issued','rejected') OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.claim_id<>OLD.claim_id OR NEW.original_invoice_id IS NOT OLD.original_invoice_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
  OR (OLD.status='pending' AND (NEW.seller<>OLD.seller OR NEW.buyer<>OLD.buyer OR NEW.lines<>OLD.lines OR NEW.net_minor<>OLD.net_minor OR NEW.vat_minor<>OLD.vat_minor OR NEW.total_minor<>OLD.total_minor OR NEW.supply_date<>OLD.supply_date OR NEW.vat_category<>OLD.vat_category))
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','issued','rejected')))
BEGIN SELECT RAISE(ABORT,'issued tax documents are immutable; correct with a credit note'); END;
CREATE TRIGGER tax_invoices_no_delete BEFORE DELETE ON tax_invoices BEGIN SELECT RAISE(ABORT,'tax documents are retained'); END;
-- لا فجوات: الرقم التالي دائمًا هو الأكبر + 1 داخل الكيان والنوع.
CREATE TRIGGER tax_invoices_gapless BEFORE UPDATE OF sequence ON tax_invoices
WHEN NEW.sequence IS NOT NULL AND NEW.sequence<>COALESCE((SELECT MAX(sequence) FROM tax_invoices WHERE tenant_id=NEW.tenant_id AND kind=NEW.kind),0)+1
BEGIN SELECT RAISE(ABORT,'tax document numbers are sequential without gaps'); END;
