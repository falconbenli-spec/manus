-- ترحيل 160 — جاهزية التنفيذ المدفوع: ما كان ناقصًا في بوابة الترحيل 116 أمام شروط العقد نصًّا.
--
-- البوابة نفسها قائمة وتبقى واحدة (app/project-axes.mjs): جدول الدفعات يعلن الدفعة المقدمة، وadvance_invoices
-- تحمل قبضها المؤكد بيدين، وclient_purchase_orders تحمل أمر شراء العميل، وreadiness_waivers تحمل الإعفاء.
-- لا كيان موازٍ لأيٍّ منها. ما يضيفه هذا الترحيل هو ما لم تكن القاعدة تستطيع قوله:
--   ١. هل يشترط الاتفاق أمر شراء من العميل — كان يُستنتج من مجرد وجود جدول دفعات.
--   ٢. أمر الشراء بنسخ مرقّمة مربوطة بالاتفاق والعميل، وبنهاية صلاحية — كان صفًّا واحدًا لكل ملف لا يُصحَّح.
--   ٣. الإعفاء بيدين: طلبٌ من شخص واعتمادٌ من غيره — كان يكتبه حامل التصريح ويعتمده في خطوة واحدة، ويُعدَّل ويُحذف.
--   ٤. مرجع الحوالة في تأكيد الدفعة المقدمة، وانعكاسها — كانت الحوالة الواحدة تُؤكَّد مرتين، والمرتدّة تبقى «مقبوضة» أبدًا.
--
-- لم يُطبَّق على القاعدة الحية من هذا الفرع. طُبِّق على نسخة من آخر نسخة احتياطية (الفحص الخامس في scripts/gate.mjs):
-- السلامة سليمة، وصفر مخالفة مراجع، وسلسلة التدقيق متصلة. الصفوف القائمة تُنقل كما هي، ولا يُطبَّق عليها أي شرط
-- جديد بأثر رجعي — المُطلِقات الجديدة تحرس الإدراج والتعديل من بعد هذا الترحيل وحدهما.

/* ───── ١. شرط أمر الشراء في جدول الدفعات ───── */
-- الافتراض 1 لأن هذا ما كانت تفعله المنصة بكل جدول قبل هذا الترحيل: جدولٌ مسجَّل كان يعني أمر شراء مطلوبًا.
-- فالجداول القائمة تبقى على سلوكها بالحرف، والجديد يقول شرطه صراحةً عند تسجيله.
ALTER TABLE case_payment_terms ADD COLUMN requires_client_po INTEGER NOT NULL DEFAULT 1 CHECK(requires_client_po IN (0,1));

/* ───── ٢. أمر شراء العميل بنسخ ───── */
-- إعادة بناء لا إضافة أعمدة: القيد UNIQUE(tenant_id,po_number) كان يمنع النسخة الثانية من أمرٍ برقمه نفسه،
-- وتعديل العميل لأمره يبقي رقمه في الغالب. والتفرّد يصير: الرقم لا يُعلَّق على ملفين (مُطلِق)، والنسخة لا تتكرر في ملفها.
-- وsupersedes_id بلا REFERENCES عمدًا: السلسلة يحرسها المُطلِق بشرط أقوى (النسخة السابقة مباشرةً وفي الملف نفسه)،
-- ومرجعٌ ذاتي أثناء إعادة البناء كان سيربط الصفوف المنقولة بالجدول القديم لحظة حذفه.
CREATE TABLE client_purchase_orders_next (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  contract_id TEXT REFERENCES commercial_contracts(id),
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  supersedes_id TEXT,
  po_number TEXT NOT NULL CHECK(length(trim(po_number))>=1),
  issued_on TEXT NOT NULL,
  valid_until TEXT,
  scope TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL CHECK(currency IN ('SAR','USD','EUR')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  customer_representative TEXT NOT NULL CHECK(length(trim(customer_representative))>=3),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('recorded','confirmed','void')),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(confirmed_by,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(case_id,revision),
  CHECK((revision=1)=(supersedes_id IS NULL)),
  CHECK(valid_until IS NULL OR valid_until>=issued_on),
  CHECK(confirmed_by IS NULL OR confirmed_by<>recorded_by),
  CHECK((status='confirmed')=(confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK((status='void')=(length(void_reason)>0))
) STRICT;
-- الصفوف القائمة: نسخٌ مرقّمة بترتيب تسجيلها داخل ملفها، والاتفاق والعميل يُقرآن من الملف نفسه. الصلاحية فارغة
-- (لا تنتهي) والنطاق فارغ، لأنهما لم يُسألا يوم سُجّلت، ولا يُخترعان لها الآن.
INSERT INTO client_purchase_orders_next(id,tenant_id,case_id,contract_id,project_id,client_id,revision,supersedes_id,po_number,issued_on,valid_until,scope,currency,amount_minor,
    customer_representative,evidence,status,recorded_by,recorded_at,confirmed_by,confirmed_at,void_reason,version)
  SELECT o.id,o.tenant_id,o.case_id,(SELECT k.id FROM commercial_contracts k WHERE k.case_id=o.case_id),o.project_id,(SELECT l.client_id FROM client_links l WHERE l.case_id=o.case_id),
    ROW_NUMBER() OVER (PARTITION BY o.case_id ORDER BY o.recorded_at,o.id),LAG(o.id) OVER (PARTITION BY o.case_id ORDER BY o.recorded_at,o.id),
    o.po_number,o.issued_on,NULL,'',o.currency,o.amount_minor,o.customer_representative,o.evidence,o.status,o.recorded_by,o.recorded_at,o.confirmed_by,o.confirmed_at,o.void_reason,o.version
  FROM client_purchase_orders o;
DROP TABLE client_purchase_orders;
ALTER TABLE client_purchase_orders_next RENAME TO client_purchase_orders;
CREATE INDEX client_purchase_orders_case ON client_purchase_orders(case_id,revision);
CREATE INDEX client_purchase_orders_number ON client_purchase_orders(tenant_id,po_number);

-- النسخة الجديدة تمدّ سلسلة ملفها من آخرها، وتطابق اتفاقه ومشروعه وعميله المربوط وعملته وكيانه. الكود يرفض قبلها
-- برسالة تسمّي الناقص؛ وهذا الحارس لما يُكتب من خارجه — سكربت أو إصلاح يدوي أو مسار يُضاف غدًا.
CREATE TRIGGER client_purchase_orders_source BEFORE INSERT ON client_purchase_orders
WHEN NOT EXISTS(
    SELECT 1 FROM commercial_cases c
    JOIN commercial_contracts k ON k.id=NEW.contract_id AND k.case_id=c.id
    JOIN client_links l ON l.case_id=c.id AND l.client_id=NEW.client_id
    JOIN clients cl ON cl.id=l.client_id AND cl.tenant_id=c.tenant_id
    WHERE c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id AND NEW.project_id IS c.project_id
      AND NEW.currency=json_extract(k.snapshot,'$.currency')
      AND NEW.status='recorded' AND NEW.confirmed_by IS NULL AND NEW.confirmed_at IS NULL
      AND NEW.valid_until IS NOT NULL AND length(trim(NEW.scope))>=10)
  OR EXISTS(SELECT 1 FROM client_purchase_orders o WHERE o.tenant_id=NEW.tenant_id AND o.po_number=NEW.po_number AND o.case_id<>NEW.case_id)
  -- «IS» لا «=»: مقارنةٌ بفراغ (ملف بلا نسخة بعد) تعطي NULL في «=» فيسقط الشرط كله ولا يطلق المُطلِق، فتمرّ نسخة معلّقة على لا شيء.
  OR NOT (
    (NEW.revision=1 AND NEW.supersedes_id IS NULL AND NOT EXISTS(SELECT 1 FROM client_purchase_orders WHERE case_id=NEW.case_id))
    OR (NEW.supersedes_id IS (SELECT id FROM client_purchase_orders WHERE case_id=NEW.case_id ORDER BY revision DESC LIMIT 1)
      AND NEW.revision IS (SELECT MAX(revision) FROM client_purchase_orders WHERE case_id=NEW.case_id)+1))
BEGIN SELECT RAISE(ABORT,'a client purchase order version must extend its own case chain and match its agreement, project, client and tenant'); END;

-- النسخة لا تُعدَّل: التعديل الوحيد تأكيدها مرة واحدة وهي آخر نسخة في ملفها. نسخةٌ حلّت محلها أخرى لا تُؤكَّد،
-- لأن تأكيدها اعتمادٌ على ما لم يعد قائمًا. والتصحيح نسخة جديدة.
CREATE TRIGGER client_purchase_orders_final BEFORE UPDATE ON client_purchase_orders
WHEN NOT (
    OLD.status='recorded' AND NEW.status='confirmed' AND NEW.version=OLD.version+1
    AND NEW.confirmed_by IS NOT NULL AND NEW.confirmed_at IS NOT NULL
    AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id AND NEW.case_id=OLD.case_id AND NEW.contract_id IS OLD.contract_id
    AND NEW.project_id IS OLD.project_id AND NEW.client_id IS OLD.client_id AND NEW.revision=OLD.revision AND NEW.supersedes_id IS OLD.supersedes_id
    AND NEW.po_number=OLD.po_number AND NEW.issued_on=OLD.issued_on AND NEW.valid_until IS OLD.valid_until AND NEW.scope=OLD.scope
    AND NEW.currency=OLD.currency AND NEW.amount_minor=OLD.amount_minor AND NEW.customer_representative=OLD.customer_representative
    AND NEW.evidence=OLD.evidence AND NEW.recorded_by=OLD.recorded_by AND NEW.recorded_at=OLD.recorded_at AND NEW.void_reason=OLD.void_reason
    AND NOT EXISTS(SELECT 1 FROM client_purchase_orders o WHERE o.case_id=OLD.case_id AND o.revision>OLD.revision))
BEGIN SELECT RAISE(ABORT,'a client purchase order version is final: only the latest version is confirmed, once; a correction is a new version'); END;
CREATE TRIGGER client_purchase_orders_no_delete BEFORE DELETE ON client_purchase_orders
BEGIN SELECT RAISE(ABORT,'client purchase orders are retained'); END;

/* ───── ٣. الإعفاء بيدين ───── */
-- الطلب سجلٌّ مستقل باسم طالبه وسببه؛ والإعفاء لا يُكتب إلا على طلب معلق ومن غير طالبه. الكيان مربوط بالمشروع
-- بمفتاح مركّب، فلا يُعلَّق طلب كيانٍ على مشروع كيانٍ آخر.
CREATE TABLE readiness_waiver_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  item TEXT NOT NULL CHECK(item IN ('client_po','advance')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','authorised','declined')),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  waiver_id TEXT REFERENCES readiness_waivers(id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='pending')=(decided_by IS NULL AND decided_at IS NULL)),
  CHECK((status='authorised')=(waiver_id IS NOT NULL)),
  CHECK(status='pending' OR length(trim(decision_note))>=10)
) STRICT;
CREATE UNIQUE INDEX readiness_waiver_requests_pending ON readiness_waiver_requests(project_id,item) WHERE status='pending';
CREATE TRIGGER readiness_waiver_requests_decided_once BEFORE UPDATE ON readiness_waiver_requests
WHEN NOT (OLD.status='pending' AND NEW.status IN ('authorised','declined')
    AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id AND NEW.project_id=OLD.project_id AND NEW.item=OLD.item AND NEW.reason=OLD.reason
    AND NEW.requested_by=OLD.requested_by AND NEW.requested_at=OLD.requested_at)
BEGIN SELECT RAISE(ABORT,'an exemption request is decided once'); END;
CREATE TRIGGER readiness_waiver_requests_no_delete BEFORE DELETE ON readiness_waiver_requests
BEGIN SELECT RAISE(ABORT,'exemption requests are retained'); END;

-- الإعفاءات القائمة قبل هذا الترحيل تبقى بلا طلب (request_id فارغ) كما مُنحت؛ الشرط يحرس ما يُدرج من الآن.
ALTER TABLE readiness_waivers ADD COLUMN request_id TEXT REFERENCES readiness_waiver_requests(id);
CREATE TRIGGER readiness_waivers_authorised BEFORE INSERT ON readiness_waivers
WHEN NOT EXISTS(
    SELECT 1 FROM readiness_waiver_requests r JOIN projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id
    WHERE r.id=NEW.request_id AND r.status='pending' AND r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id
      AND r.item=NEW.item AND r.requested_by<>NEW.waived_by)
BEGIN SELECT RAISE(ABORT,'an exemption is authorised against a pending request by someone other than its requester'); END;
-- الإعفاء يُسحب مرة واحدة بسبب مكتوب ولا يُعدَّل غير ذلك، ولا يُحذف: هو سند كل فعل مضى عليه.
CREATE TRIGGER readiness_waivers_withdrawn_once BEFORE UPDATE ON readiness_waivers
WHEN NOT (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.withdrawn_by IS NOT NULL AND length(trim(NEW.withdrawn_reason))>=10
    AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id AND NEW.project_id=OLD.project_id AND NEW.item=OLD.item AND NEW.reason=OLD.reason
    AND NEW.waived_by=OLD.waived_by AND NEW.waived_at=OLD.waived_at AND NEW.request_id IS OLD.request_id)
BEGIN SELECT RAISE(ABORT,'an exemption is withdrawn once with a reason and is never edited'); END;
CREATE TRIGGER readiness_waivers_no_delete BEFORE DELETE ON readiness_waivers
BEGIN SELECT RAISE(ABORT,'exemptions are retained'); END;

/* ───── ٤. الدفعة المقدمة: مرجع الحوالة وانعكاسها ───── */
-- المرجع يُطبَّع في الكود (NFKC وأحرف كبيرة، كما في ar_receipts) ويتفرد داخل الكيان وحده، فلا يكشف مرجعٌ عند كيان وجودَه عند آخر.
-- الصفوف المؤكدة قبل هذا الترحيل بلا مرجع تبقى كما هي؛ الشرط على التأكيد من الآن.
ALTER TABLE advance_invoices ADD COLUMN receipt_reference TEXT;
CREATE UNIQUE INDEX advance_invoices_receipt_reference ON advance_invoices(tenant_id,receipt_reference) WHERE receipt_reference IS NOT NULL;
CREATE TRIGGER advance_invoices_confirmation_reference BEFORE UPDATE ON advance_invoices
WHEN OLD.status='recorded' AND NEW.status='paid' AND (NEW.receipt_reference IS NULL OR length(trim(NEW.receipt_reference))<3)
BEGIN SELECT RAISE(ABORT,'a confirmed advance names its bank reference'); END;
-- ترحيل 116 أضاف المشروع إلى الدفعة بلا ما يربط كيانيهما؛ دفعةٌ في كيان لا تُعلَّق على مشروع كيانٍ آخر.
CREATE TRIGGER advance_invoices_project_tenant BEFORE INSERT ON advance_invoices
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'an advance attaches only to a project of its own tenant'); END;

-- الانعكاس «سجل جديد» كما تقول رسالة ترحيل 051 نفسها ('a confirmed advance is corrected by a new record'): المؤكَّد لا يُعدَّل،
-- وما ارتدّ منه يُكتب بجانبه ويُطرح في كل قراءة. ولا ينعكس ما سُحب على فاتورة لاحقة: ذلك تصحيح فاتورة لا حوالة.
CREATE TABLE advance_reversals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  advance_id TEXT NOT NULL REFERENCES advance_invoices(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  reversed_by TEXT NOT NULL,
  reversed_at TEXT NOT NULL,
  FOREIGN KEY(reversed_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX advance_reversals_advance ON advance_reversals(advance_id);
CREATE TRIGGER advance_reversals_within_balance BEFORE INSERT ON advance_reversals
WHEN NOT EXISTS(SELECT 1 FROM advance_invoices a WHERE a.id=NEW.advance_id AND a.tenant_id=NEW.tenant_id AND a.status='paid'
    AND NEW.amount_minor+(SELECT COALESCE(SUM(amount_minor),0) FROM advance_reversals WHERE advance_id=a.id)
      +(SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=a.id)<=a.paid_minor)
BEGIN SELECT RAISE(ABORT,'a reversal reaches only the confirmed balance that was not drawn'); END;
CREATE TRIGGER advance_reversals_no_update BEFORE UPDATE ON advance_reversals
BEGIN SELECT RAISE(ABORT,'a reversal is a record, not an edit'); END;
CREATE TRIGGER advance_reversals_no_delete BEFORE DELETE ON advance_reversals
BEGIN SELECT RAISE(ABORT,'a reversal is a record, not an edit'); END;
-- حارسا السحب من ترحيل 051 يقارنان بالمدفوع وحده؛ بعد الانعكاس يصير السقف «المدفوع ناقص المعكوس». يُعادان بحرفهما
-- ورسالتهما، وتُزاد فقرة الطرح وحدها — SQLite لا تعدّل مُطلِقًا في مكانه.
DROP TRIGGER advance_draws_within_paid_insert;
CREATE TRIGGER advance_draws_within_paid_insert AFTER INSERT ON advance_draws
WHEN (SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=NEW.advance_id)
  >(SELECT paid_minor FROM advance_invoices WHERE id=NEW.advance_id)-(SELECT COALESCE(SUM(amount_minor),0) FROM advance_reversals WHERE advance_id=NEW.advance_id)
BEGIN SELECT RAISE(ABORT,'drawn total exceeds the paid advance balance'); END;
DROP TRIGGER advance_draws_within_paid_update;
CREATE TRIGGER advance_draws_within_paid_update AFTER UPDATE ON advance_draws
WHEN (SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=NEW.advance_id)
  >(SELECT paid_minor FROM advance_invoices WHERE id=NEW.advance_id)-(SELECT COALESCE(SUM(amount_minor),0) FROM advance_reversals WHERE advance_id=NEW.advance_id)
BEGIN SELECT RAISE(ABORT,'drawn total exceeds the paid advance balance'); END;
