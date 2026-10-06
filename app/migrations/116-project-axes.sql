-- محاور حالة المشروع الثمانية وإقفاله وبوابة الدفعة المقدمة.
--
-- المشكلة التي يعالجها هذا الترحيل (تدقيق دورة العميل 20 سبتمبر 2026، §5):
-- الحقل الواحد `commercial_cases.status='project_active'` يُسأل اليوم ثلاثة أسئلة مختلفة
-- — هل بدأ العمل؟ هل ما زال جاريًا؟ هل انتهى ولم يُقفل؟ — ولا يعرف إلا واحدًا منها:
-- أنه فُتح مشروع. فهو نهاية المحور التجاري استُعملت بديلًا عن محورين لا وجود لهما.
--
-- لا يُهجَر أي حقل قائم ولا يُحذف: `commercial_cases.status` يبقى كما هو محورًا تجاريًا،
-- وتُضاف حوله سبعة محاور أخرى، أربعة منها تُشتق من بيانات قائمة (القبول، الفوترة،
-- التحصيل، سداد المورد) وثلاثة تُخزَّن هنا لأنه لا مصدر لها في المنصة (جاهزية البدء،
-- تقدم التنفيذ، الإقفال النهائي). الاشتقاق في `app/project-axes.mjs`.
--
-- سداد المورد يُقرأ من `payment_orders` وحدها — المصدر الصادق — لا من
-- `procurement_purchases.payment_status` الذي يعيد نصًا ثابتًا (B3، يصلحه عمل مواز).

/* ───── 1. جدول الدفعات المتوقع من الاتفاق: منه تولد الدفعة المقدمة ───── */
-- الدفعة المقدمة ليست رقمًا يُكتب عند القبض: هي بند مُعلن في جدول دفعات الاتفاق،
-- يُتوقع أولًا ثم تؤكده المالية بمقبوض حقيقي. بند واحد على الأكثر لكل ملف يوسم «مقدمة».
CREATE TABLE case_payment_terms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  position INTEGER NOT NULL CHECK(position>=0 AND position<=40),
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(currency IN ('SAR','USD','EUR')),
  due_on TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '',
  is_advance INTEGER NOT NULL DEFAULT 0 CHECK(is_advance IN (0,1)),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(case_id,position)
) STRICT;
CREATE UNIQUE INDEX case_payment_terms_one_advance ON case_payment_terms(case_id) WHERE is_advance=1;
CREATE TRIGGER case_payment_terms_immutable BEFORE UPDATE ON case_payment_terms
BEGIN SELECT RAISE(ABORT,'a payment schedule is replaced, not edited'); END;

/* ───── 2. أمر شراء العميل (B5) ───── */
-- لا حقل ولا كيان اليوم؛ أقرب بديل نص `agreement_evidence` الحر. هنا سجل بمرجعه وقيمته
-- ودليله، يسجله مسؤول الحساب ويؤكده غيره. «سجّلتُ أنني رأيت أمر الشراء» ليست «تأكد أمر الشراء».
CREATE TABLE client_purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  project_id TEXT REFERENCES projects(id),
  po_number TEXT NOT NULL CHECK(length(trim(po_number))>=1),
  issued_on TEXT NOT NULL,
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
  UNIQUE(tenant_id,po_number),
  CHECK(confirmed_by IS NULL OR confirmed_by<>recorded_by),
  CHECK((status='confirmed')=(confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK((status='void')=(length(void_reason)>0))
) STRICT;
CREATE INDEX client_purchase_orders_case ON client_purchase_orders(case_id,status);

/* ───── 3. أمر المباشرة للمورد (B6) ───── */
-- `approve_order` أمر الشراء، لا إذن البدء. في أعمال الإنتاج والفعاليات هذا هو الفرق
-- بين «تعاقدنا» و«ابدأ التصوير غدًا». يصدره من اعتمد الأمر أو مراجع آخر، ولا يصدره الطالب.
CREATE TABLE commencement_authorisations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  purchase_id TEXT NOT NULL UNIQUE REFERENCES procurement_purchases(id),
  order_id TEXT NOT NULL REFERENCES procurement_orders(id),
  start_on TEXT NOT NULL,
  site_or_channel TEXT NOT NULL CHECK(length(trim(site_or_channel))>=3),
  scope_confirmation TEXT NOT NULL CHECK(length(trim(scope_confirmation))>=10),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER commencement_no_update BEFORE UPDATE ON commencement_authorisations
BEGIN SELECT RAISE(ABORT,'a commencement authorisation is issued once'); END;
CREATE TRIGGER commencement_no_delete BEFORE DELETE ON commencement_authorisations
BEGIN SELECT RAISE(ABORT,'a commencement authorisation is retained'); END;

/* ───── 4. مشاركة إدارة ثانية وحزم العمل (B7) ───── */
-- اليوم: كل عضو مشروع من إدارة الملف التجاري وتابع للمدير المباشر، وموظف إدارة أخرى
-- يُرد بـ400. مشروع متعدد الإدارات — الحالة الطبيعية في وكالة — لا يمكن تمثيله.
-- التوسعة ليست إلغاء القيد: هي قيد صريح مسجل، يطلبه مالك المشروع ويعتمده مدير الإدارة الأخرى.
CREATE TABLE project_departments (
  project_id TEXT NOT NULL REFERENCES projects(id),
  department_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY(project_id,department_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by<>requested_by)
) STRICT;

-- حزمة العمل: ما كان `tasks` جدولًا مسطحًا بلا إدارة ولا مرحلة. الحزمة تحمل الإدارة
-- المسؤولة ومرحلتها ومسؤولها، والمهمة تعلّق عليها.
CREATE TABLE work_packages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  department_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  phase TEXT NOT NULL CHECK(phase IN ('discovery','planning','production','review','delivery','closeout')),
  objective TEXT NOT NULL CHECK(length(trim(objective))>=10),
  lead_id TEXT NOT NULL,
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned','active','blocked','delivered','cancelled')),
  status_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(lead_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  UNIQUE(project_id,code),
  CHECK(planned_end>=planned_start)
) STRICT;
CREATE INDEX work_packages_project ON work_packages(project_id,department_id,status);

-- المهمة تعرف حزمتها. العمود يقبل NULL: المهام السابقة على هذا الترحيل تبقى بلا حزمة
-- وتُقرأ بسلوكها القديم، ولا تُنسب بأثر رجعي إلى حزمة لم تكن موجودة.
ALTER TABLE tasks ADD COLUMN work_package_id TEXT REFERENCES work_packages(id);
CREATE INDEX tasks_work_package ON tasks(work_package_id);

/* ───── 5. محور تقدم التنفيذ (المخزَّن) ───── */
CREATE TABLE project_execution_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  state TEXT NOT NULL CHECK(state IN ('not_started','mobilising','in_progress','on_hold','delivered')),
  note TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(changed_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

/* ───── 6. سجل حركة المحاور: كل انتقال يُقيَّد ولا يُمحى ───── */
CREATE TABLE project_axis_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  axis TEXT NOT NULL CHECK(axis IN ('commercial','readiness','execution','acceptance','invoicing','collection','supplier_settlement','closure')),
  from_state TEXT NOT NULL DEFAULT '',
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX project_axis_events_axis ON project_axis_events(project_id,axis,created_at);
CREATE TRIGGER project_axis_events_no_update BEFORE UPDATE ON project_axis_events
BEGIN SELECT RAISE(ABORT,'axis history is append only'); END;
CREATE TRIGGER project_axis_events_no_delete BEFORE DELETE ON project_axis_events
BEGIN SELECT RAISE(ABORT,'axis history is append only'); END;

/* ───── 7. إعفاء جاهزية البدء ───── */
-- قاعدة PM-01 تقول: لا تنفيذ مدفوع قبل دفعة مقدمة مؤكدة. والاستثناء ليس صمتًا:
-- إعفاء باسم من أعفى وسببه، بتصريح حساس، ويظهر في المحور نفسه لا خلفه.
CREATE TABLE readiness_waivers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  item TEXT NOT NULL CHECK(item IN ('client_po','advance')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  waived_by TEXT NOT NULL,
  waived_at TEXT NOT NULL,
  withdrawn_by TEXT,
  withdrawn_at TEXT,
  withdrawn_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(waived_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX readiness_waivers_live ON readiness_waivers(project_id,item) WHERE withdrawn_at IS NULL;

/* ───── 8. شهادة الإنجاز مستندًا (B9) ───── */
-- اليوم الشهادة نص داخل `commercial_reviews.evidence_json`: بلا رقم ولا حالة ولا طرفين.
-- هنا مستند مرقّم بطرفيه، مبني على القبول القائم لا بديلًا عنه: كل مخرج فيه مقبول أصلًا.
CREATE TABLE completion_certificates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  sequence INTEGER NOT NULL CHECK(sequence>0),
  number TEXT NOT NULL,
  scope_summary TEXT NOT NULL CHECK(length(trim(scope_summary))>=20),
  delivery_ids TEXT NOT NULL CHECK(json_valid(delivery_ids)),
  our_representative TEXT NOT NULL,
  customer_representative TEXT NOT NULL CHECK(length(trim(customer_representative))>=3),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('issued','acknowledged','void')),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  acknowledgement_evidence TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(acknowledged_by,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(tenant_id,sequence),
  UNIQUE(tenant_id,number),
  CHECK(acknowledged_by IS NULL OR acknowledged_by<>issued_by),
  CHECK((status='acknowledged')=(acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND length(acknowledgement_evidence)>0)),
  CHECK((status='void')=(length(void_reason)>0))
) STRICT;
CREATE INDEX completion_certificates_project ON completion_certificates(project_id,status);

/* ───── 9. الإقفال: فني ثم مالي ثم نهائي، وإعادة فتح مدققة ───── */
CREATE TABLE project_closures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
  case_id TEXT REFERENCES commercial_cases(id),
  technical_state TEXT NOT NULL DEFAULT 'open' CHECK(technical_state IN ('open','closed')),
  technical_closed_by TEXT,
  technical_closed_at TEXT,
  technical_note TEXT NOT NULL DEFAULT '',
  certificate_id TEXT REFERENCES completion_certificates(id),
  financial_state TEXT NOT NULL DEFAULT 'open' CHECK(financial_state IN ('open','closed')),
  financial_closed_by TEXT,
  financial_closed_at TEXT,
  financial_note TEXT NOT NULL DEFAULT '',
  final_state TEXT NOT NULL DEFAULT 'open' CHECK(final_state IN ('open','closed')),
  final_closed_by TEXT,
  final_closed_at TEXT,
  profitability_note TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(technical_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(financial_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(final_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  -- قفلان بيد واحدة ليسا قفلين: من أقفل فنيًا لا يقفل ماليًا.
  CHECK(technical_closed_by IS NULL OR financial_closed_by IS NULL OR technical_closed_by<>financial_closed_by),
  CHECK((technical_state='closed')=(technical_closed_by IS NOT NULL AND technical_closed_at IS NOT NULL AND certificate_id IS NOT NULL)),
  CHECK((financial_state='closed')=(financial_closed_by IS NOT NULL AND financial_closed_at IS NOT NULL)),
  -- الإقفال النهائي يشترط الاثنين، والربحية والدروس مكتوبتين.
  CHECK((final_state='closed')=(final_closed_by IS NOT NULL AND final_closed_at IS NOT NULL
    AND technical_state='closed' AND financial_state='closed'
    AND length(trim(profitability_note))>=20 AND length(trim(lessons))>=20))
) STRICT;
CREATE TRIGGER project_closures_versioned BEFORE UPDATE ON project_closures
WHEN NEW.version<>OLD.version+1 OR NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'closure changes carry the next version'); END;
CREATE TRIGGER project_closures_no_delete BEFORE DELETE ON project_closures
BEGIN SELECT RAISE(ABORT,'closure history is retained'); END;

-- إعادة الفتح ليست تراجعًا صامتًا: تصريح، وسبب، وما أُعيد فتحه بالضبط، ومن فعل.
CREATE TABLE project_closure_reopenings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  closure_id TEXT NOT NULL REFERENCES project_closures(id),
  scope TEXT NOT NULL CHECK(scope IN ('technical','financial','final')),
  from_state TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  capability TEXT NOT NULL,
  reopened_by TEXT NOT NULL,
  reopened_at TEXT NOT NULL,
  FOREIGN KEY(reopened_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX project_closure_reopenings_closure ON project_closure_reopenings(closure_id,reopened_at);
CREATE TRIGGER project_closure_reopenings_no_update BEFORE UPDATE ON project_closure_reopenings
BEGIN SELECT RAISE(ABORT,'a reopening is recorded once'); END;
CREATE TRIGGER project_closure_reopenings_no_delete BEFORE DELETE ON project_closure_reopenings
BEGIN SELECT RAISE(ABORT,'reopening history is append only'); END;

/* ───── 10. ربط الدفعة المقدمة القائمة بالمشروع ───── */
-- `advance_invoices` موجودة منذ ترحيل 051 بفصل تفويضات سليم: من سجّل الدفعة لا يؤكد قبضها.
-- الناقص كان ربطها بالمشروع والملف التجاري، فلم يكن لأي محور أن يقرأها. لا كيان ثانٍ
-- ولا `confirm_advance` ثانية: العمودان هما كل ما يلزم ليعرف المشروع دفعته المقدمة.
ALTER TABLE advance_invoices ADD COLUMN case_id TEXT REFERENCES commercial_cases(id);
ALTER TABLE advance_invoices ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX advance_invoices_project ON advance_invoices(project_id,status);

-- قيد «لا تُصحَّح دفعة مؤكدة إلا بسجل جديد» في 051 لم يكن يعرف العمودين الجديدين، فيُعاد
-- بناؤه ليحرس المشروع والملف كما يحرس المبلغ: دفعة أُسندت إلى مشروع لا تُحوَّل إلى غيره بصمت.
DROP TRIGGER advance_invoices_amount_fixed;
CREATE TRIGGER advance_invoices_amount_fixed BEFORE UPDATE ON advance_invoices
WHEN NEW.version<>OLD.version+1 OR OLD.status='paid'
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
  OR NEW.case_id IS NOT OLD.case_id OR NEW.project_id IS NOT OLD.project_id
BEGIN SELECT RAISE(ABORT,'a confirmed advance is corrected by a new record'); END;
