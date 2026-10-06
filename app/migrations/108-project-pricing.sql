-- محرك تسعير المشاريع (MOD-BD-02)، واستثناء الهامش (MOD-BD-03)، وعرض السعر للعميل.
-- يبني فوق ملفات العملاء (033-agency.sql) وبطاقات الأسعار والفرص (074-pipeline-estimates.sql) ولا يعدلهما.
--
-- أربع قواعد مفروضة هنا لا في الواجهة:
--   (1) لا رقم سياسة في الكود: نسبة الطوارئ (10%) والهامش المستهدف (20%) وكل عتبة صفوف في pricing_policies،
--       يدخلها مالك الإجراء بسندها من نموذج التسعير المعتمد في الشركة، ويعتمدها شخص آخر. المعتمد لا يُعدَّل: التغيير نسخة جديدة.
--   (2) هامش 100% أو أكثر مستحيل حسابيًا (قسمة على صفر أو على سالب): يرفضه CHECK على value_bp قبل أن يصل إلى أي معادلة.
--   (3) الصرف الإعلامي المسجَّل تكلفةً على المشروع لا يُحتسب مرتين حين يصل أيضًا فاتورةَ مورد: المرجع لا يتكرر في الورقة،
--       والتحقق من وصوله فاتورةً يجري عند الحفظ عبر مُحلِّل خارجي (لا تستورد هذه الوحدة وحدة الصرف الإعلامي).
--   (4) عرض السعر مربوط بإصدار بطاقة أسعار وبتاريخ صلاحية: رقم بلا بطاقة ولا صلاحية لا يُرسل إلى عميل.
--
-- قرار معلّق مقصود: من يُصدر عرض السعر للعميل. المصادر متعارضة (المشتريات في الفهرس، المالية في تبويب دورة العميل
-- وفي المخطط)، فالقراءتان محفوظتان في pricing_decisions ولا صف افتراضي: الإصدار مرفوض حتى يحسم المالك القرار.

-- ---------- سياسات التسعير: كل نسبة وعتبة ومهلة صف معتمد بسنده ----------
-- المفاتيح الخمسة كلها حقول في نموذج التسعير MOD-BD-02 أو في مسار RFQ/F-04، ولا قيمة لأي منها في الكود.
-- المهلتان منفصلتان قصدًا (التعارض 9): مهلة إصدار عرض العميل ساعة إلى ساعتين، ومهلة التحقق المالي يوم عمل واحد.
-- ساعتان ليستا يوم عمل، ولا يُجمعان في عداد واحد.
CREATE TABLE pricing_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  policy_key TEXT NOT NULL CHECK(policy_key IN ('contingency_rate','target_margin','minimum_margin','quotation_issue_sla_hours','finance_verification_sla_days')),
  revision INTEGER NOT NULL CHECK(revision>0),
  value_unit TEXT NOT NULL CHECK(value_unit IN ('percent','hours','working_days')),
  -- النسبة بنقاط الأساس (10000 = 100%)، وحدها الأعلى 9999: هامش 100% أو أكثر لا سعر له فلا يُخزَّن أصلًا.
  -- المهلة بوحدتها كما في المصدر: ساعات أو أيام عمل، لا تحويل بينهما.
  value_raw INTEGER NOT NULL CHECK(value_raw>=0),
  -- سند الرقم: أي نموذج في الشركة نصّ عليه وأين. لا رقم بلا مصدر مكتوب.
  source_reference TEXT NOT NULL CHECK(length(trim(source_reference))>=10),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected','retired')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,policy_key,revision),
  -- النسبة لا تبلغ 100%، والمهلة لا تكون صفرًا بوحدتها.
  CHECK(value_unit<>'percent' OR value_raw<=9999),
  CHECK(value_unit<>'hours' OR value_raw BETWEEN 1 AND 8760),
  CHECK(value_unit<>'working_days' OR value_raw BETWEEN 1 AND 260),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX pricing_policies_one_live ON pricing_policies(tenant_id,policy_key) WHERE status='approved';
CREATE UNIQUE INDEX pricing_policies_one_draft ON pricing_policies(tenant_id,policy_key) WHERE status='draft';
CREATE TRIGGER pricing_policies_fixed BEFORE UPDATE ON pricing_policies
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.policy_key<>OLD.policy_key OR NEW.revision<>OLD.revision
  OR NEW.value_raw<>OLD.value_raw OR NEW.value_unit<>OLD.value_unit OR NEW.source_reference<>OLD.source_reference OR NEW.basis<>OLD.basis
  OR NEW.effective_from<>OLD.effective_from OR NEW.prepared_by<>OLD.prepared_by
  OR OLD.status IN ('rejected','retired')
  OR (OLD.status='draft' AND NEW.status NOT IN ('approved','rejected'))
  OR (OLD.status='approved' AND (NEW.status<>'retired' OR NEW.decided_by<>OLD.decided_by OR NEW.decided_at<>OLD.decided_at))
BEGIN SELECT RAISE(ABORT,'an approved pricing policy is replaced by a new revision, not edited'); END;
CREATE TRIGGER pricing_policies_no_delete BEFORE DELETE ON pricing_policies
BEGIN SELECT RAISE(ABORT,'pricing policies are retained'); END;

-- ---------- القرارات المعلّقة: من يُصدر عرض السعر ----------
-- القراءتان محفوظتان نصًا في الوحدة؛ الصف هنا هو اختيار المالك بينهما بسنده. لا صف = لا قرار = لا إصدار.
CREATE TABLE pricing_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  decision_code TEXT NOT NULL CHECK(decision_code IN ('quotation_issuer')),
  revision INTEGER NOT NULL CHECK(revision>0),
  chosen_option TEXT NOT NULL CHECK(chosen_option IN ('procurement','finance')),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected','retired')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,decision_code,revision),
  UNIQUE(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX pricing_decisions_one_live ON pricing_decisions(tenant_id,decision_code) WHERE status='approved';
CREATE UNIQUE INDEX pricing_decisions_one_draft ON pricing_decisions(tenant_id,decision_code) WHERE status='draft';
CREATE TRIGGER pricing_decisions_fixed BEFORE UPDATE ON pricing_decisions
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.decision_code<>OLD.decision_code OR NEW.revision<>OLD.revision
  OR NEW.chosen_option<>OLD.chosen_option OR NEW.basis<>OLD.basis OR NEW.prepared_by<>OLD.prepared_by
  OR OLD.status IN ('rejected','retired')
  OR (OLD.status='draft' AND NEW.status NOT IN ('approved','rejected'))
  OR (OLD.status='approved' AND (NEW.status<>'retired' OR NEW.decided_by<>OLD.decided_by OR NEW.decided_at<>OLD.decided_at))
BEGIN SELECT RAISE(ABORT,'a settled decision is replaced by a new revision, not edited'); END;
CREATE TRIGGER pricing_decisions_no_delete BEFORE DELETE ON pricing_decisions
BEGIN SELECT RAISE(ABORT,'decisions are retained'); END;

-- ---------- ورقة التسعير ----------
CREATE TABLE pricing_sheets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  -- رقم العرض في النموذج.
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  scope_note TEXT NOT NULL CHECK(length(trim(scope_note))>=10),
  -- بيانات المشروع كما في رأس MOD-BD-02: نوع العقد، المدة، مدير المشروع المقترح، ملاحظات المراجعة.
  -- القطاع لا يُكرر هنا: مصدره المعتمد ملف العميل (clients.sector).
  contract_kind TEXT NOT NULL CHECK(contract_kind IN ('one_off','monthly_retainer')),
  duration_note TEXT NOT NULL CHECK(length(trim(duration_note))>=2),
  proposed_pm_id TEXT REFERENCES users(id),
  review_notes TEXT NOT NULL DEFAULT '',
  quoted_on TEXT NOT NULL CHECK(quoted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  -- إصدار بطاقة الأسعار مثبّت على الورقة: العرض يُقرأ بأسعار البطاقة التي بُني عليها ولو صدرت بطاقة أحدث بعده.
  price_card_id TEXT REFERENCES price_cards(id),
  price_card_effective_from TEXT NOT NULL DEFAULT '',
  rates_on TEXT NOT NULL CHECK(rates_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- لقطة السياسة بمعرّف نسختها: تغيّر السياسة بعد الحفظ لا يغيّر رقمًا قُرر عليه.
  contingency_rate_bp INTEGER NOT NULL CHECK(contingency_rate_bp BETWEEN 0 AND 9999),
  contingency_policy_id TEXT NOT NULL REFERENCES pricing_policies(id),
  target_margin_bp INTEGER NOT NULL CHECK(target_margin_bp BETWEEN 0 AND 9999),
  target_margin_policy_id TEXT NOT NULL REFERENCES pricing_policies(id),
  -- «الحد الأدنى المقبول» حقل في النموذج بلا قيمة في المصدر: يبقى NULL حتى تُعتمد سياسته، ولا يُخترع له رقم.
  minimum_margin_bp INTEGER CHECK(minimum_margin_bp IS NULL OR minimum_margin_bp BETWEEN 0 AND 9999),
  minimum_margin_policy_id TEXT REFERENCES pricing_policies(id),
  -- الخصم والرسوم الإدارية والضريبة: ثلاثة حسابات مستقلة، ولا واحد منها جزء من الهامش.
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor BETWEEN 0 AND 999999999999),
  discount_basis TEXT NOT NULL DEFAULT '',
  admin_fee_bp INTEGER NOT NULL DEFAULT 0 CHECK(admin_fee_bp BETWEEN 0 AND 10000),
  admin_fee_basis TEXT NOT NULL DEFAULT '',
  -- نسبة الضريبة يدخلها المستخدم بسندها؛ لا نسبة مفترضة في الكود ولا في الجدول.
  vat_rate_bp INTEGER NOT NULL CHECK(vat_rate_bp BETWEEN 0 AND 10000),
  vat_basis TEXT NOT NULL CHECK(length(trim(vat_basis))>=3),
  status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','rejected')),
  -- جولة الاعتماد: «يحتاج تعديل» يعيد الورقة مسودةً ويفتح جولة جديدة. قرارات الجولة السابقة تبقى كما كُتبت.
  approval_round INTEGER NOT NULL DEFAULT 1 CHECK(approval_round>0),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id),
  CHECK((status IN ('approved','rejected'))=(decided_at IS NOT NULL)),
  CHECK((price_card_id IS NULL)=(price_card_effective_from='')),
  CHECK((minimum_margin_bp IS NULL)=(minimum_margin_policy_id IS NULL)),
  CHECK(discount_minor=0 OR length(trim(discount_basis))>=5),
  CHECK(admin_fee_bp=0 OR length(trim(admin_fee_basis))>=5)
) STRICT;
CREATE INDEX pricing_sheets_client ON pricing_sheets(tenant_id,client_id,status);
CREATE TRIGGER pricing_sheets_same_tenant BEFORE INSERT ON pricing_sheets
WHEN NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id)
  OR (NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opportunities o WHERE o.id=NEW.opportunity_id AND o.client_id=NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a pricing sheet stays within one client of one tenant'); END;
CREATE TRIGGER pricing_sheets_versioned BEFORE UPDATE ON pricing_sheets
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('approved','rejected') OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.client_id<>OLD.client_id OR NEW.code<>OLD.code OR NEW.prepared_by<>OLD.prepared_by
  OR NEW.approval_round<OLD.approval_round
  OR (OLD.status='draft' AND NEW.status NOT IN ('draft','submitted'))
  -- المعروض على المقاعد الأربعة لا يتغير بينها: الأرقام تثبت من لحظة الإرسال حتى يُقرَّر فيها أو تُعاد للتعديل.
  OR (OLD.status='submitted' AND (NEW.name<>OLD.name OR NEW.scope_note<>OLD.scope_note
      OR NEW.contingency_rate_bp<>OLD.contingency_rate_bp OR NEW.target_margin_bp<>OLD.target_margin_bp
      OR coalesce(NEW.minimum_margin_bp,-1)<>coalesce(OLD.minimum_margin_bp,-1)
      OR NEW.discount_minor<>OLD.discount_minor OR NEW.admin_fee_bp<>OLD.admin_fee_bp OR NEW.vat_rate_bp<>OLD.vat_rate_bp
      OR NEW.contract_kind<>OLD.contract_kind OR NEW.duration_note<>OLD.duration_note
      OR coalesce(NEW.price_card_id,'')<>coalesce(OLD.price_card_id,'')))
BEGIN SELECT RAISE(ABORT,'a decided pricing sheet is final; a correction is a new sheet'); END;
CREATE TRIGGER pricing_sheets_no_delete BEFORE DELETE ON pricing_sheets
BEGIN SELECT RAISE(ABORT,'pricing sheets are retained'); END;

-- ---------- كتلة الاعتماد: التواقيع الأربعة أسفل النموذج، إلكترونية ----------
-- قرار المالك: لا توقيع مصوَّر ولا سطر توقيع. كل مقعد من المقاعد الأربعة حدث هوية: من قرر وبأي تصريح ومتى وعلى أي جولة.
-- القرار ثلاثي كما في النموذج: معتمد / مرفوض / يحتاج تعديل.
CREATE TABLE pricing_sheet_approvals (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  approval_round INTEGER NOT NULL CHECK(approval_round>0),
  seat TEXT NOT NULL CHECK(seat IN ('requesting_department','procurement_finance','epmo','vp_corporate_services')),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','returned')),
  capability TEXT NOT NULL CHECK(length(trim(capability))>=3),
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  UNIQUE(sheet_id,approval_round,seat)
) STRICT;
CREATE INDEX pricing_sheet_approvals_sheet ON pricing_sheet_approvals(sheet_id,approval_round);
-- لا يوقّع مقعدًا من أعدّ الورقة: الفصل بين من يسعّر ومن يعتمد قاعدة النموذج نفسه.
CREATE TRIGGER pricing_sheet_approvals_not_preparer BEFORE INSERT ON pricing_sheet_approvals
WHEN EXISTS(SELECT 1 FROM pricing_sheets s WHERE s.id=NEW.sheet_id AND (s.prepared_by=NEW.decided_by OR s.status<>'submitted' OR s.approval_round<>NEW.approval_round))
BEGIN SELECT RAISE(ABORT,'an approval seat is filled by someone other than the preparer, while the sheet awaits its current round'); END;
CREATE TRIGGER pricing_sheet_approvals_fixed BEFORE UPDATE ON pricing_sheet_approvals
BEGIN SELECT RAISE(ABORT,'a recorded approval is not rewritten'); END;
CREATE TRIGGER pricing_sheet_approvals_no_delete BEFORE DELETE ON pricing_sheet_approvals
BEGIN SELECT RAISE(ABORT,'approvals are retained across rounds'); END;

-- سطر التكلفة: مجموعة من مجموعات نموذج التسعير، بكمية أو ساعات (أجزاء المئة) × سعر وحدة بالهللات.
CREATE TABLE pricing_sheet_lines (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  line_no INTEGER NOT NULL CHECK(line_no>0),
  cost_group TEXT NOT NULL CHECK(cost_group IN ('internal_team','external_production','paid_media','operations','subscriptions_software')),
  description TEXT NOT NULL CHECK(length(trim(description))>=2),
  basis TEXT NOT NULL CHECK(basis IN ('quantity','hours')),
  quantity_centi INTEGER NOT NULL CHECK(quantity_centi BETWEEN 1 AND 100000000),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 100000000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 999999999999),
  -- مرجع التكلفة الخارجية للصرف الإعلامي: به يُكتشف الاحتساب المزدوج حين يصل الصرف نفسه فاتورةَ مورد.
  cost_reference_kind TEXT NOT NULL DEFAULT '' CHECK(cost_reference_kind IN ('','media_entry','supplier_invoice')),
  cost_reference_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(sheet_id,line_no),
  CHECK((cost_reference_kind='')=(cost_reference_id='')),
  CHECK(cost_reference_kind='' OR cost_group='paid_media')
) STRICT;
-- المرجع الواحد سطر واحد في الورقة الواحدة: أبسط صور الاحتساب المزدوج يمنعها المخطط نفسه.
CREATE UNIQUE INDEX pricing_sheet_lines_one_reference ON pricing_sheet_lines(sheet_id,cost_reference_kind,cost_reference_id) WHERE cost_reference_id<>'';
CREATE INDEX pricing_sheet_lines_reference ON pricing_sheet_lines(cost_reference_id) WHERE cost_reference_id<>'';
CREATE TRIGGER pricing_sheet_lines_draft_insert BEFORE INSERT ON pricing_sheet_lines
WHEN NOT EXISTS(SELECT 1 FROM pricing_sheets s WHERE s.id=NEW.sheet_id AND s.status='draft')
BEGIN SELECT RAISE(ABORT,'pricing lines change only while the sheet is a draft'); END;
CREATE TRIGGER pricing_sheet_lines_draft_delete BEFORE DELETE ON pricing_sheet_lines
WHEN NOT EXISTS(SELECT 1 FROM pricing_sheets s WHERE s.id=OLD.sheet_id AND s.status='draft')
BEGIN SELECT RAISE(ABORT,'pricing lines change only while the sheet is a draft'); END;
CREATE TRIGGER pricing_sheet_lines_fixed BEFORE UPDATE ON pricing_sheet_lines
BEGIN SELECT RAISE(ABORT,'a pricing line is replaced, not rewritten'); END;
CREATE TRIGGER pricing_sheets_submit_needs_lines BEFORE UPDATE OF status ON pricing_sheets
WHEN NEW.status='submitted' AND NOT EXISTS(SELECT 1 FROM pricing_sheet_lines l WHERE l.sheet_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'a pricing sheet without cost lines is not submitted'); END;

-- ---------- استثناء الهامش (MOD-BD-03) ----------
-- النموذج غير موجود في مجلد الشركة؛ الحقول هنا مقترحة ومعلّمة كذلك في docs/product/forms.
CREATE TABLE margin_exceptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  code TEXT NOT NULL,
  -- الهامش المطلوب قبوله وأثره بالريال، مقابل الهامش الذي تنص عليه السياسة وقت الطلب.
  requested_margin_bp INTEGER NOT NULL CHECK(requested_margin_bp BETWEEN -10000 AND 9999),
  policy_margin_bp INTEGER NOT NULL CHECK(policy_margin_bp BETWEEN 0 AND 9999),
  value_impact_minor INTEGER NOT NULL CHECK(value_impact_minor BETWEEN 0 AND 999999999999),
  justification TEXT NOT NULL CHECK(length(trim(justification))>=20),
  applies_to TEXT NOT NULL CHECK(length(trim(applies_to))>=5),
  attachments TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachments) AND json_array_length(attachments)<=20),
  expires_on TEXT NOT NULL CHECK(expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK((status='pending')=(decided_at IS NULL)),
  -- استثناء لا يخفض الهامش عن السياسة ليس استثناء.
  CHECK(requested_margin_bp<policy_margin_bp)
) STRICT;
CREATE UNIQUE INDEX margin_exceptions_one_open ON margin_exceptions(sheet_id) WHERE status IN ('pending','approved');
CREATE TRIGGER margin_exceptions_same_tenant BEFORE INSERT ON margin_exceptions
WHEN NOT EXISTS(SELECT 1 FROM pricing_sheets s WHERE s.id=NEW.sheet_id AND s.tenant_id=NEW.tenant_id AND s.status='approved')
BEGIN SELECT RAISE(ABORT,'a margin exception is raised on an approved pricing sheet of the same tenant'); END;
CREATE TRIGGER margin_exceptions_decided_once BEFORE UPDATE ON margin_exceptions
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected')
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.sheet_id<>OLD.sheet_id OR NEW.code<>OLD.code
  OR NEW.requested_margin_bp<>OLD.requested_margin_bp OR NEW.policy_margin_bp<>OLD.policy_margin_bp
  OR NEW.value_impact_minor<>OLD.value_impact_minor OR NEW.justification<>OLD.justification
  OR NEW.applies_to<>OLD.applies_to OR NEW.attachments<>OLD.attachments OR NEW.expires_on<>OLD.expires_on
  OR NEW.requested_by<>OLD.requested_by
BEGIN SELECT RAISE(ABORT,'a margin exception is decided once; a new request is a new record'); END;
CREATE TRIGGER margin_exceptions_no_delete BEFORE DELETE ON margin_exceptions
BEGIN SELECT RAISE(ABORT,'margin exceptions are retained'); END;

-- ---------- عرض السعر للعميل ----------
CREATE TABLE client_quotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  sheet_id TEXT NOT NULL REFERENCES pricing_sheets(id),
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','issued','accepted','rejected')),
  -- الدور الذي أصدر العرض فعلًا، ومعرّف القرار الذي أجاز له ذلك. لا إصدار بلا قرار مالك.
  issuer_role TEXT NOT NULL DEFAULT '' CHECK(issuer_role IN ('','procurement','finance')),
  issuer_decision_id TEXT REFERENCES pricing_decisions(id),
  current_version_id TEXT,
  issued_by TEXT REFERENCES users(id),
  issued_at TEXT,
  -- الفوز والخسارة كلاهما يبقى بسببه: العرض المرفوض لا يُحذف.
  outcome TEXT NOT NULL DEFAULT '' CHECK(outcome IN ('','won','lost')),
  outcome_reason TEXT NOT NULL DEFAULT '',
  outcome_recorded_by TEXT REFERENCES users(id),
  outcome_recorded_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id),
  CHECK(status='draft' OR issued_at IS NOT NULL),
  CHECK((issuer_role='')=(issued_at IS NULL)),
  CHECK((status IN ('accepted','rejected'))=(outcome<>'')),
  CHECK(outcome='' OR length(trim(outcome_reason))>=10),
  CHECK((outcome='')=(outcome_recorded_by IS NULL))
) STRICT;
CREATE INDEX client_quotations_client ON client_quotations(tenant_id,client_id,status);
CREATE TRIGGER client_quotations_same_sheet BEFORE INSERT ON client_quotations
WHEN NOT EXISTS(SELECT 1 FROM pricing_sheets s WHERE s.id=NEW.sheet_id AND s.tenant_id=NEW.tenant_id AND s.client_id=NEW.client_id AND s.status='approved')
BEGIN SELECT RAISE(ABORT,'a quotation is built on an approved pricing sheet of the same client'); END;
CREATE TRIGGER client_quotations_versioned BEFORE UPDATE ON client_quotations
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('accepted','rejected') OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.client_id<>OLD.client_id OR NEW.sheet_id<>OLD.sheet_id OR NEW.code<>OLD.code OR NEW.created_by<>OLD.created_by
BEGIN SELECT RAISE(ABORT,'a quotation with a recorded outcome is final'); END;
CREATE TRIGGER client_quotations_no_delete BEFORE DELETE ON client_quotations
BEGIN SELECT RAISE(ABORT,'quotations are retained, won or lost'); END;

-- نسخة العرض: لقطة الأرقام كاملة، مربوطة بإصدار بطاقة الأسعار وبتاريخ صلاحيتها.
CREATE TABLE quotation_versions (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES client_quotations(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  price_card_id TEXT NOT NULL REFERENCES price_cards(id),
  price_card_effective_from TEXT NOT NULL CHECK(price_card_effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_until TEXT NOT NULL CHECK(valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  margin_exception_id TEXT REFERENCES margin_exceptions(id),
  note TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(quotation_id,revision)
) STRICT;
CREATE TRIGGER quotation_versions_fixed BEFORE UPDATE ON quotation_versions
BEGIN SELECT RAISE(ABORT,'a quotation version is not rewritten; a change is a new revision'); END;
CREATE TRIGGER quotation_versions_no_delete BEFORE DELETE ON quotation_versions
BEGIN SELECT RAISE(ABORT,'quotation versions are retained'); END;
