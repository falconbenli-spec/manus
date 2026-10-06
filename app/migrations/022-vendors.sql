-- مركز الموردين داخل المشتريات: ملف موحد وتأهيل وبيانات دفع بتحقق مستقل.
-- المورد لا يملك حساب دخول؛ الموظف المخول يسجل ويتابع.
CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  supplier_key TEXT NOT NULL CHECK(supplier_key=upper(supplier_key) AND length(supplier_key) BETWEEN 3 AND 80),
  legal_name TEXT NOT NULL CHECK(length(trim(legal_name))>=3),
  legal_name_en TEXT NOT NULL DEFAULT '',
  trade_name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL CHECK(entity_type IN ('company','establishment','individual','foreign')),
  country TEXT NOT NULL CHECK(length(country)=2),
  entity_ref TEXT,
  vat_number TEXT,
  categories TEXT NOT NULL CHECK(json_valid(categories)),
  regions TEXT NOT NULL DEFAULT '',
  capacity_note TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  data_source TEXT NOT NULL CHECK(length(trim(data_source))>=3),
  legal_review_required INTEGER NOT NULL DEFAULT 0 CHECK(legal_review_required IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('draft','in_review','approved','conditional','rejected','suspended','requalification','merged')),
  condition_note TEXT NOT NULL DEFAULT '',
  valid_until TEXT,
  merged_into TEXT REFERENCES vendors(id),
  source_request_id TEXT,
  registered_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,code),
  UNIQUE(tenant_id,supplier_key),
  FOREIGN KEY(registered_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='merged')=(merged_into IS NOT NULL))
) STRICT;
CREATE INDEX vendors_ref ON vendors(tenant_id,entity_ref);
CREATE INDEX vendors_vat ON vendors(tenant_id,vat_number);
CREATE TRIGGER vendors_identity_fixed BEFORE UPDATE ON vendors
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.supplier_key<>OLD.supplier_key OR NEW.registered_by<>OLD.registered_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'vendor identity is fixed and the next version is required'); END;
CREATE TRIGGER vendors_no_delete BEFORE DELETE ON vendors BEGIN SELECT RAISE(ABORT,'vendors are retained'); END;

CREATE TABLE vendor_contacts (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  trusted_at TEXT,
  trusted_by TEXT REFERENCES users(id),
  trusted_basis TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((trusted_at IS NULL)=(trusted_by IS NULL))
) STRICT;

CREATE TABLE vendor_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  kind TEXT NOT NULL,
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  issued_on TEXT,
  expires_on TEXT,
  verification TEXT NOT NULL CHECK(verification IN ('pending','verified','rejected','not_applicable')),
  verification_note TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  superseded_by TEXT REFERENCES vendor_documents(id),
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX vendor_documents_expiry ON vendor_documents(vendor_id,expires_on);
CREATE TRIGGER vendor_documents_no_delete BEFORE DELETE ON vendor_documents BEGIN SELECT RAISE(ABORT,'vendor documents are retained'); END;

CREATE TABLE vendor_reviews (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  cycle INTEGER NOT NULL CHECK(cycle>0),
  kind TEXT NOT NULL CHECK(kind IN ('duplicate','technical','procurement','finance','legal')),
  decision TEXT NOT NULL CHECK(decision IN ('passed','failed','needs_info')),
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER vendor_reviews_no_update BEFORE UPDATE ON vendor_reviews BEGIN SELECT RAISE(ABORT,'vendor reviews are immutable'); END;
CREATE TRIGGER vendor_reviews_no_delete BEFORE DELETE ON vendor_reviews BEGIN SELECT RAISE(ABORT,'vendor reviews are immutable'); END;

CREATE TABLE vendor_decisions (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  valid_until TEXT,
  decided_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER vendor_decisions_no_update BEFORE UPDATE ON vendor_decisions BEGIN SELECT RAISE(ABORT,'vendor decisions are immutable'); END;
CREATE TRIGGER vendor_decisions_no_delete BEFORE DELETE ON vendor_decisions BEGIN SELECT RAISE(ABORT,'vendor decisions are immutable'); END;

-- بيانات الدفع: كل تغيير سجل مستقل؛ لا يصبح فعالًا إلا بتحقق شخص آخر مخول ماليًا.
CREATE TABLE vendor_bank_accounts (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  iban TEXT NOT NULL,
  iban_digest TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected','superseded')),
  collected_by TEXT NOT NULL REFERENCES users(id),
  collected_at TEXT NOT NULL,
  verification_method TEXT CHECK(verification_method IS NULL OR verification_method IN ('trusted_contact_callback','bank_letter','approved_channel')),
  verification_evidence TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  effective_from TEXT,
  CHECK(verified_by IS NULL OR verified_by<>collected_by),
  CHECK(status NOT IN ('verified','superseded') OR (verified_by IS NOT NULL AND effective_from IS NOT NULL AND verification_method IS NOT NULL AND length(trim(verification_evidence))>=3))
) STRICT;
CREATE INDEX vendor_bank_digest ON vendor_bank_accounts(iban_digest);
CREATE UNIQUE INDEX vendor_bank_one_pending ON vendor_bank_accounts(vendor_id) WHERE status='pending';
CREATE TRIGGER vendor_bank_fixed BEFORE UPDATE ON vendor_bank_accounts
WHEN NEW.iban<>OLD.iban OR NEW.iban_digest<>OLD.iban_digest OR NEW.vendor_id<>OLD.vendor_id OR NEW.collected_by<>OLD.collected_by OR NEW.collected_at<>OLD.collected_at OR NEW.bank_name<>OLD.bank_name OR NEW.account_holder<>OLD.account_holder
  OR NOT ((OLD.status='pending' AND NEW.status IN ('verified','rejected')) OR (OLD.status='verified' AND NEW.status='superseded'))
BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;
CREATE TRIGGER vendor_bank_no_delete BEFORE DELETE ON vendor_bank_accounts BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;

CREATE TABLE vendor_evaluations (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  purchase_id TEXT REFERENCES procurement_purchases(id),
  category TEXT NOT NULL,
  scores TEXT NOT NULL CHECK(json_valid(scores)),
  weights TEXT NOT NULL CHECK(json_valid(weights)),
  weighted_score INTEGER NOT NULL CHECK(weighted_score BETWEEN 100 AND 500),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=3),
  corrects_id TEXT REFERENCES vendor_evaluations(id),
  evaluator_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER vendor_evaluations_no_update BEFORE UPDATE ON vendor_evaluations BEGIN SELECT RAISE(ABORT,'evaluations are corrected by a new record'); END;
CREATE TRIGGER vendor_evaluations_no_delete BEFORE DELETE ON vendor_evaluations BEGIN SELECT RAISE(ABORT,'evaluations are corrected by a new record'); END;

-- استثناء مفوض لاستخدام مورد موقوف أو منتهي الوثائق في عملية شراء بعينها.
CREATE TABLE vendor_exceptions (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  purchase_id TEXT NOT NULL REFERENCES procurement_purchases(id),
  blocker TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(vendor_id,purchase_id)
) STRICT;
CREATE TRIGGER vendor_exceptions_no_update BEFORE UPDATE ON vendor_exceptions BEGIN SELECT RAISE(ABORT,'exceptions are immutable'); END;
CREATE TRIGGER vendor_exceptions_no_delete BEFORE DELETE ON vendor_exceptions BEGIN SELECT RAISE(ABORT,'exceptions are immutable'); END;
