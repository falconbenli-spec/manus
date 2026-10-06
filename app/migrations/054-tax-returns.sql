-- ورقة عمل الإقرار الضريبي وسجل ضريبة الاستقطاع وورقة وعاء الزكاة.
-- المنصة لا تقدّم إقرارًا ولا تتصل بأي جهة، ولا تعرف نسبة ضريبية من عندها:
-- كل نسبة إعداد مؤرّخ يدخله صاحبه بمصدره وتاريخ تأكيده ويؤكده شخص آخر، وتبقى مؤرّخة فتُطبَّق نسبة الفترة لا نسبة اليوم.
-- لا صفوف ابتدائية هنا: الجداول تبدأ فارغة، والرقم الفارغ أصدق من رقم مفترض.

CREATE TABLE tax_rate_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('vat','withholding')),
  -- تصنيف ضريبي يسميه صاحبه: للقيمة المضافة تصنيفات الدفتر، وللاستقطاع تصنيف الخدمة كما يحدده المختص.
  category TEXT NOT NULL CHECK(length(trim(category))>=2),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  -- النسبة بنقاط الأساس كما أدخلها صاحبها (10000 = 100%). حد المدى تحقق من صحة الإدخال لا نسبة نظامية.
  basis_points INTEGER NOT NULL CHECK(basis_points BETWEEN 0 AND 10000),
  effective_from TEXT NOT NULL,
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  confirmed_on TEXT NOT NULL,
  specialist_name TEXT NOT NULL CHECK(length(trim(specialist_name))>=3),
  recorded_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  confirmation_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,kind,category,effective_from),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(confirmed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL)),
  -- من أدخل النسبة لا يؤكدها.
  CHECK(confirmed_by IS NULL OR confirmed_by<>recorded_by)
) STRICT;
CREATE TRIGGER tax_rate_settings_fixed BEFORE UPDATE ON tax_rate_settings
WHEN OLD.confirmed_by IS NOT NULL OR NEW.version<>OLD.version+1 OR NEW.confirmed_by IS NULL
  OR NEW.kind<>OLD.kind OR NEW.category<>OLD.category OR NEW.basis_points<>OLD.basis_points OR NEW.effective_from<>OLD.effective_from
  OR NEW.source<>OLD.source OR NEW.specialist_name<>OLD.specialist_name OR NEW.confirmed_on<>OLD.confirmed_on OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a confirmed rate is replaced by a newer dated setting, never edited'); END;
CREATE TRIGGER tax_rate_settings_no_delete BEFORE DELETE ON tax_rate_settings BEGIN SELECT RAISE(ABORT,'dated rate settings are retained'); END;

-- ورقة عمل ضريبة القيمة المضافة لفترة ضريبية. أرقامها أرقام مُعِدّها، ولقطة الدفتر تُحفظ بجانبها ليظهر الفرق ولا يُخفى.
CREATE TABLE vat_worksheets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('draft','reviewed','filed','superseded')),
  sales_standard_minor INTEGER NOT NULL DEFAULT 0 CHECK(sales_standard_minor>=0),
  output_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK(output_vat_minor>=0),
  sales_zero_rated_minor INTEGER NOT NULL DEFAULT 0 CHECK(sales_zero_rated_minor>=0),
  sales_exempt_minor INTEGER NOT NULL DEFAULT 0 CHECK(sales_exempt_minor>=0),
  sales_out_of_scope_minor INTEGER NOT NULL DEFAULT 0 CHECK(sales_out_of_scope_minor>=0),
  purchases_minor INTEGER NOT NULL DEFAULT 0 CHECK(purchases_minor>=0),
  input_vat_minor INTEGER NOT NULL DEFAULT 0 CHECK(input_vat_minor>=0),
  adjustments_minor INTEGER NOT NULL DEFAULT 0,
  adjustments_note TEXT NOT NULL DEFAULT '',
  ledger_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ledger_snapshot)),
  -- مجموع فروق البنود عن الدفتر وقت آخر حفظ. صفر يعني أن الورقة تطابق الدفتر بندًا بندًا.
  variance_minor INTEGER NOT NULL DEFAULT 0 CHECK(variance_minor>=0),
  reconciliation_note TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  filed_by TEXT,
  filed_at TEXT,
  filing_reference TEXT NOT NULL DEFAULT '',
  filing_evidence TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,period_start,period_end,revision),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(reviewed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(filed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(period_end>period_start),
  CHECK(adjustments_minor=0 OR length(trim(adjustments_note))>=10),
  -- المُعِدّ ليس المراجع.
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
  CHECK((status='draft')=(reviewed_by IS NULL)),
  CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),
  -- لا تُقفل الورقة والفرق عن الدفتر غير مفسَّر.
  CHECK(status='draft' OR variance_minor=0 OR length(trim(reconciliation_note))>=10),
  -- التقديم فعل خارج المنصة: يُوثَّق بمرجعه ودليله ولا تدّعيه المنصة.
  CHECK(status IN ('draft','reviewed') OR (filed_by IS NOT NULL AND filed_at IS NOT NULL AND length(trim(filing_reference))>=3 AND length(trim(filing_evidence))>=10))
) STRICT;
CREATE UNIQUE INDEX vat_worksheets_open ON vat_worksheets(tenant_id,period_start,period_end) WHERE status IN ('draft','reviewed');
CREATE UNIQUE INDEX vat_worksheets_filed ON vat_worksheets(tenant_id,period_start,period_end) WHERE status='filed';
CREATE TRIGGER vat_worksheets_immutable BEFORE UPDATE ON vat_worksheets
WHEN NEW.version<>OLD.version+1 OR OLD.status='superseded'
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end OR NEW.revision<>OLD.revision OR NEW.prepared_by<>OLD.prepared_by
  OR (OLD.status<>'draft' AND (NEW.sales_standard_minor<>OLD.sales_standard_minor OR NEW.output_vat_minor<>OLD.output_vat_minor
    OR NEW.sales_zero_rated_minor<>OLD.sales_zero_rated_minor OR NEW.sales_exempt_minor<>OLD.sales_exempt_minor OR NEW.sales_out_of_scope_minor<>OLD.sales_out_of_scope_minor
    OR NEW.purchases_minor<>OLD.purchases_minor OR NEW.input_vat_minor<>OLD.input_vat_minor OR NEW.adjustments_minor<>OLD.adjustments_minor OR NEW.variance_minor<>OLD.variance_minor))
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','reviewed')) OR (OLD.status='reviewed' AND NEW.status='filed') OR (OLD.status='filed' AND NEW.status='superseded'))
BEGIN SELECT RAISE(ABORT,'a reviewed worksheet is corrected by a new revision, never edited'); END;
CREATE TRIGGER vat_worksheets_no_delete BEFORE DELETE ON vat_worksheets WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'reviewed worksheets are retained'); END;

-- تسمية خانات التصدير: المنصة لا تفترض ترقيم خانات نموذج رسمي؛ التعيين على المستخدم والمختص، ويُحفظ باسم من سماه.
CREATE TABLE vat_export_boxes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  line_key TEXT NOT NULL,
  box_label TEXT NOT NULL CHECK(length(trim(box_label))>=1),
  named_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,line_key),
  FOREIGN KEY(named_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- سجل ضريبة الاستقطاع على المدفوعات لغير المقيمين. المنصة تسجّل قرار المختص ولا تستنتجه.
CREATE TABLE withholding_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  payment_order_id TEXT REFERENCES payment_orders(id),
  beneficiary_name TEXT NOT NULL CHECK(length(trim(beneficiary_name))>=2),
  beneficiary_country TEXT NOT NULL CHECK(length(trim(beneficiary_country))>=2),
  service_kind TEXT NOT NULL CHECK(length(trim(service_kind))>=2),
  payment_date TEXT NOT NULL,
  payment_amount_minor INTEGER NOT NULL CHECK(payment_amount_minor>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  rate_setting_id TEXT NOT NULL REFERENCES tax_rate_settings(id),
  rate_basis_points INTEGER NOT NULL CHECK(rate_basis_points BETWEEN 0 AND 10000),
  withheld_minor INTEGER NOT NULL CHECK(withheld_minor>=0),
  remittance_due_date TEXT NOT NULL,
  due_date_basis TEXT NOT NULL CHECK(length(trim(due_date_basis))>=10),
  -- من أفتى بالتصنيف والنسبة وأثر الاتفاقيات ومتى: إلزامي، فالمنصة لا تصنّف خدمة ولا تقرأ اتفاقية.
  classified_by_name TEXT NOT NULL CHECK(length(trim(classified_by_name))>=3),
  classified_on TEXT NOT NULL,
  classification_note TEXT NOT NULL CHECK(length(trim(classification_note))>=10),
  treaty_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('recorded','remitted','cancelled')),
  remitted_on TEXT,
  remittance_reference TEXT NOT NULL DEFAULT '',
  remittance_evidence TEXT NOT NULL DEFAULT '',
  remitted_by TEXT,
  cancel_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(remitted_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(withheld_minor<=payment_amount_minor),
  CHECK((status='remitted')=(remitted_by IS NOT NULL AND remitted_on IS NOT NULL AND length(trim(remittance_reference))>=3 AND length(trim(remittance_evidence))>=10)),
  CHECK(status<>'cancelled' OR length(trim(cancel_note))>=10),
  -- من سجّل الاستقطاع لا يوثّق توريده وحده.
  CHECK(remitted_by IS NULL OR remitted_by<>recorded_by)
) STRICT;
CREATE UNIQUE INDEX withholding_entries_order ON withholding_entries(payment_order_id) WHERE payment_order_id IS NOT NULL AND status<>'cancelled';
CREATE TRIGGER withholding_entries_fixed BEFORE UPDATE ON withholding_entries
WHEN OLD.status<>'recorded' OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('remitted','cancelled')
  OR NEW.payment_amount_minor<>OLD.payment_amount_minor OR NEW.withheld_minor<>OLD.withheld_minor OR NEW.rate_basis_points<>OLD.rate_basis_points OR NEW.rate_setting_id<>OLD.rate_setting_id
  OR NEW.beneficiary_name<>OLD.beneficiary_name OR NEW.service_kind<>OLD.service_kind OR NEW.classified_by_name<>OLD.classified_by_name OR NEW.classification_note<>OLD.classification_note OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a withholding entry is documented once; correct it with a new entry'); END;
CREATE TRIGGER withholding_entries_no_delete BEFORE DELETE ON withholding_entries BEGIN SELECT RAISE(ABORT,'withholding entries are retained'); END;

-- ورقة وعاء الزكاة: هيكل فارغ ببنود يسميها المختص ويملؤها ويعتمدها. المنصة لا تحسب وعاءً ولا تفترض بندًا.
CREATE TABLE zakat_worksheets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  fiscal_year TEXT NOT NULL CHECK(length(fiscal_year)=4 AND fiscal_year NOT GLOB '*[^0-9]*'),
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('draft','reviewed','superseded')),
  specialist_name TEXT NOT NULL CHECK(length(trim(specialist_name))>=3),
  basis_note TEXT NOT NULL CHECK(length(trim(basis_note))>=10),
  prepared_by TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,fiscal_year,revision),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(reviewed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
  CHECK((status='draft')=(reviewed_by IS NULL)),
  CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX zakat_worksheets_open ON zakat_worksheets(tenant_id,fiscal_year) WHERE status<>'superseded';
CREATE TRIGGER zakat_worksheets_immutable BEFORE UPDATE ON zakat_worksheets
WHEN NEW.version<>OLD.version+1 OR OLD.status='superseded' OR NEW.fiscal_year<>OLD.fiscal_year OR NEW.revision<>OLD.revision OR NEW.prepared_by<>OLD.prepared_by
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','reviewed')) OR (OLD.status='reviewed' AND NEW.status='superseded'))
BEGIN SELECT RAISE(ABORT,'an approved zakat worksheet is replaced by a new revision'); END;
CREATE TRIGGER zakat_worksheets_no_delete BEFORE DELETE ON zakat_worksheets WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'zakat worksheets are retained'); END;

CREATE TABLE zakat_worksheet_lines (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT NOT NULL REFERENCES zakat_worksheets(id),
  position INTEGER NOT NULL CHECK(position>0),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  -- يبقى فارغًا حتى يملأه المختص: الفراغ أصدق من صفر مفترض.
  amount_minor INTEGER,
  source_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(worksheet_id,position)
) STRICT;
CREATE TRIGGER zakat_lines_draft_only_insert BEFORE INSERT ON zakat_worksheet_lines
WHEN (SELECT status FROM zakat_worksheets WHERE id=NEW.worksheet_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'lines belong to a draft worksheet only'); END;
CREATE TRIGGER zakat_lines_draft_only_update BEFORE UPDATE ON zakat_worksheet_lines
WHEN (SELECT status FROM zakat_worksheets WHERE id=OLD.worksheet_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'lines belong to a draft worksheet only'); END;
CREATE TRIGGER zakat_lines_draft_only_delete BEFORE DELETE ON zakat_worksheet_lines
WHEN (SELECT status FROM zakat_worksheets WHERE id=OLD.worksheet_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'lines belong to a draft worksheet only'); END;
