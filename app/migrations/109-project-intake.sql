-- سلسلة استلام المشروع وبواباتها، من دورة العمل المكتوبة للشركة:
--   BD-04 تسليم داخلي من تطوير الأعمال إلى التنفيذ، PM-01 استلام المشروع بقائمة وثائقه الثماني،
--   PM-02 محضر اجتماع الانطلاق، PM-03 طلب التغيير.
-- لا نموذج مشروع مواز: الجداول هنا تعلّق على projects وclients وusers القائمة ولا تكررها.
--
-- تعارض في المصادر يُسجَّل ولا يُحسم في الكود: مخطط الشركة يضع بعض نماذج الإدارات قبل التسعير،
-- بينما PM-01 يمنع بدء التنفيذ قبل الدفعة. القراءتان مدعومتان بإعداد، والافتراضي:
-- التحديد والدراسة مسموحان، والتنفيذ المدفوع ممنوع حتى تكتمل الوثائق وتتأكد الدفعة المقدمة.

CREATE TABLE project_handovers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  contract_reference TEXT NOT NULL CHECK(length(trim(contract_reference))>=5),
  -- حقول MOD-BD-04 كما في ملحق المصادر §3: تاريخ توقيع العقد وتاريخ اجتماع الانطلاق وقنوات التواصل.
  contract_signed_on TEXT NOT NULL,
  kickoff_planned_on TEXT,
  channels TEXT NOT NULL CHECK(length(trim(channels))>=3),
  -- المنصة أحادية العملة كما في سجل العقود (057): الريال وهللاته.
  contract_value_minor INTEGER NOT NULL CHECK(contract_value_minor>0),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  -- الدفعة المقدمة كما تقولها إدارة الأعمال وتاريخ تأكيدها عندها. هذا ليس تأكيد المالية:
  -- تأكيد المالية وثيقة مستقلة في قائمة PM-01 يسجلها حامل تصريح مالي، والبوابة تقرأ تلك لا هذه.
  advance_minor INTEGER NOT NULL CHECK(advance_minor>=0),
  advance_claimed_on TEXT,
  project_manager_id TEXT NOT NULL,
  services TEXT NOT NULL CHECK(json_valid(services)),
  timeline_start TEXT NOT NULL,
  timeline_end TEXT NOT NULL CHECK(timeline_end>=timeline_start),
  milestones TEXT NOT NULL CHECK(json_valid(milestones)),
  client_contacts TEXT NOT NULL CHECK(json_valid(client_contacts)),
  risks TEXT NOT NULL DEFAULT '',
  special_requirements TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','handed_over','received')),
  prepared_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(project_manager_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(advance_minor<=contract_value_minor),
  CHECK((advance_minor=0)=(advance_claimed_on IS NULL))
) STRICT;
CREATE INDEX project_handovers_client ON project_handovers(tenant_id,client_id);
CREATE TRIGGER project_handovers_versioned BEFORE UPDATE ON project_handovers
WHEN NEW.version<>OLD.version+1 OR NEW.project_id<>OLD.project_id OR NEW.client_id<>OLD.client_id OR NEW.prepared_by<>OLD.prepared_by
  OR (OLD.status='received' AND (NEW.contract_value_minor<>OLD.contract_value_minor OR NEW.contract_reference<>OLD.contract_reference))
BEGIN SELECT RAISE(ABORT,'a received handover is amended by a change request, not edited'); END;
CREATE TRIGGER project_handovers_no_delete BEFORE DELETE ON project_handovers BEGIN SELECT RAISE(ABORT,'handovers are retained'); END;

-- «توقيع الطرفين» في نموذج BD-04 الورقي هو هنا اعتماد إلكتروني: لا صورة توقيع ولا سطر فارغ ولا طباعة.
-- ما يُحفظ بديلًا عن التوقيع: الهوية والدور والتصريح الذي اعتُمد به ونسخة السجل وقت الاعتماد ووقته،
-- وسلسلة التدقيق التي تربطه بما قبله. الهويتان مسجلتان منفصلتين، ولا يعتمد شخص واحد الطرفين.
CREATE TABLE handover_approvals (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES project_handovers(id),
  side TEXT NOT NULL CHECK(side IN ('handing_over','receiving')),
  approved_by TEXT NOT NULL REFERENCES users(id),
  approver_role TEXT NOT NULL,
  approver_capability TEXT NOT NULL,
  record_version INTEGER NOT NULL CHECK(record_version>0),
  statement TEXT NOT NULL CHECK(length(trim(statement))>=10),
  approved_at TEXT NOT NULL,
  UNIQUE(handover_id,side)
) STRICT;
CREATE TRIGGER handover_approvals_one_person BEFORE INSERT ON handover_approvals
WHEN EXISTS(SELECT 1 FROM handover_approvals a WHERE a.handover_id=NEW.handover_id AND a.approved_by=NEW.approved_by)
BEGIN SELECT RAISE(ABORT,'one person does not approve both sides of a handover'); END;
CREATE TRIGGER handover_approvals_immutable BEFORE UPDATE ON handover_approvals BEGIN SELECT RAISE(ABORT,'an electronic approval is not edited'); END;
CREATE TRIGGER handover_approvals_no_delete BEFORE DELETE ON handover_approvals BEGIN SELECT RAISE(ABORT,'approvals are retained'); END;

-- جدول الدفعات كما في MOD-BD-04: المرحلة، القيمة، تاريخ الاستحقاق، شرط الاستحقاق، الحالة، ملاحظات.
-- الشرط نص إلزامي: دفعة بلا شرط استحقاق تتحول خلافًا عند التحصيل.
-- الحالة هنا وصف تخطيطي في محضر التسليم، وليست سجل تحصيل: التحصيل الفعلي في وحدات المالية.
CREATE TABLE handover_payment_terms (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES project_handovers(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 40),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  due_on TEXT,
  condition TEXT NOT NULL CHECK(length(trim(condition))>=5),
  term_status TEXT NOT NULL DEFAULT 'planned' CHECK(term_status IN ('planned','due','received')),
  notes TEXT NOT NULL DEFAULT '',
  is_advance INTEGER NOT NULL DEFAULT 0 CHECK(is_advance IN (0,1)),
  UNIQUE(handover_id,position)
) STRICT;
CREATE TRIGGER handover_payment_terms_no_delete BEFORE DELETE ON handover_payment_terms BEGIN SELECT RAISE(ABORT,'payment terms are replaced by a change request'); END;

-- المخرجات وجولات المراجعة لكل مخرج. عدد الجولات من العقد؛ ورقم القالب الافتراضي (جولتان في سجل التصميم)
-- يُسجَّل بمصدره template_default ويبقى بانتظار تأكيد صاحب العقد — ليس سياسة شركة.
CREATE TABLE project_deliverables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  handover_id TEXT NOT NULL REFERENCES project_handovers(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 60),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  unit TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  acceptance TEXT NOT NULL CHECK(length(trim(acceptance))>=5),
  revision_rounds INTEGER NOT NULL CHECK(revision_rounds BETWEEN 0 AND 20),
  rounds_source TEXT NOT NULL CHECK(rounds_source IN ('contract','template_default')),
  rounds_basis TEXT NOT NULL DEFAULT '',
  rounds_confirmed_by TEXT REFERENCES users(id),
  rounds_confirmed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(handover_id,position),
  -- جولات مأخوذة من العقد تحمل سندها؛ وافتراضي القالب يبقى غير مؤكد حتى يؤكده إنسان بسنده.
  CHECK(rounds_source<>'contract' OR length(trim(rounds_basis))>=5),
  CHECK((rounds_confirmed_by IS NULL)=(rounds_confirmed_at IS NULL))
) STRICT;
CREATE TRIGGER project_deliverables_no_delete BEFORE DELETE ON project_deliverables BEGIN SELECT RAISE(ABORT,'deliverables are changed by a change request'); END;

-- جولة مراجعة واحدة على مخرج واحد. العدّ لكل مخرج على حدة، لا لكل مشروع.
CREATE TABLE deliverable_rounds (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES project_deliverables(id),
  round_number INTEGER NOT NULL CHECK(round_number>=1),
  kind TEXT NOT NULL CHECK(kind IN ('included','extra')),
  item_reference TEXT NOT NULL CHECK(length(trim(item_reference))>=3),
  note TEXT NOT NULL DEFAULT '',
  change_request_id TEXT REFERENCES project_change_requests(id),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(deliverable_id,round_number),
  -- الجولة الإضافية لا تُسجَّل بلا طلب تغيير: العمل المجاني الصامت هو ما تمنعه هذه القاعدة.
  CHECK((kind='extra')=(change_request_id IS NOT NULL))
) STRICT;
CREATE TRIGGER deliverable_rounds_no_delete BEFORE DELETE ON deliverable_rounds BEGIN SELECT RAISE(ABORT,'recorded rounds are retained'); END;

-- PM-01: محضر استلام المشروع. قائمة الوثائق الثماني صفوف مستقلة لتحمل كل وثيقة مرجعها ومن قدّمها ومتى.
-- تنبيه المصدر (§3، MOD-PM-01): «لا يُبدأ في أي عمل تنفيذي قبل التحقق من استلام الدفعة المقدمة وتوقيع المحضر».
-- شرطان لا واحد: تأكيد المالية للدفعة، واعتماد المحضر من طرفيه. البوابة تفحصهما معًا.
CREATE TABLE project_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  handover_id TEXT NOT NULL REFERENCES project_handovers(id),
  number INTEGER NOT NULL CHECK(number>=1),
  received_on TEXT NOT NULL,
  received_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','executing')),
  execution_started_at TEXT,
  execution_started_by TEXT,
  execution_basis TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id),
  UNIQUE(handover_id),
  UNIQUE(tenant_id,number),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(received_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(execution_started_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((execution_started_at IS NULL)=(execution_started_by IS NULL)),
  CHECK((status='open')=(execution_started_at IS NULL))
) STRICT;
CREATE TRIGGER project_receipts_no_delete BEFORE DELETE ON project_receipts BEGIN SELECT RAISE(ABORT,'a receipt is the record that execution was allowed; it is retained'); END;

-- «التوقيعان» في MOD-PM-01 اعتماد إلكتروني بطرفيه: المُسلِّم مدير تطوير الأعمال، والمُستلِم مدير المشروع.
-- فهرس النماذج يذكر لـPM-01 ثلاثة معتمدين (مدير الإدارة + مدير الحسابات + EPMO) بينما متن النموذج يذكر توقيعين.
-- الطرفان المذكوران في المتن هما المطبَّقان هنا؛ ثالث الفهرس (EPMO) قرار مفتوح لأن المنصة بلا كيان EPMO.
CREATE TABLE receipt_approvals (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES project_receipts(id),
  side TEXT NOT NULL CHECK(side IN ('handing_over','receiving')),
  approved_by TEXT NOT NULL REFERENCES users(id),
  approver_role TEXT NOT NULL,
  approver_capability TEXT NOT NULL,
  record_version INTEGER NOT NULL CHECK(record_version>0),
  statement TEXT NOT NULL CHECK(length(trim(statement))>=10),
  approved_at TEXT NOT NULL,
  UNIQUE(receipt_id,side)
) STRICT;
CREATE TRIGGER receipt_approvals_one_person BEFORE INSERT ON receipt_approvals
WHEN EXISTS(SELECT 1 FROM receipt_approvals a WHERE a.receipt_id=NEW.receipt_id AND a.approved_by=NEW.approved_by)
BEGIN SELECT RAISE(ABORT,'one person does not approve both sides of a project receipt'); END;
CREATE TRIGGER receipt_approvals_immutable BEFORE UPDATE ON receipt_approvals BEGIN SELECT RAISE(ABORT,'an electronic approval is not edited'); END;
CREATE TRIGGER receipt_approvals_no_delete BEFORE DELETE ON receipt_approvals BEGIN SELECT RAISE(ABORT,'approvals are retained'); END;

CREATE TABLE receipt_documents (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES project_receipts(id),
  doc_key TEXT NOT NULL CHECK(doc_key IN ('signed_contract','approved_pricing','kickoff_minutes','creative_brief','payment_schedule','advance_confirmation','client_contacts','client_assets')),
  required INTEGER NOT NULL CHECK(required IN (0,1)),
  owner_role TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('missing','present')),
  reference TEXT NOT NULL DEFAULT '',
  -- صفر مبلغٌ مؤكَّد أيضًا: عقد بلا دفعة مقدمة تؤكده المالية كتابةً بصفر، ولا يمر بلا تأكيد.
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor>=0),
  confirmed_on TEXT,
  provided_by TEXT REFERENCES users(id),
  provided_at TEXT,
  reopened_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(receipt_id,doc_key),
  CHECK((status='present')=(provided_by IS NOT NULL)),
  CHECK((provided_by IS NULL)=(provided_at IS NULL)),
  CHECK(status<>'present' OR length(trim(reference))>=3),
  -- تأكيد المالية للدفعة المقدمة ليس خانة تُؤشَّر: يحمل المبلغ المؤكَّد وتاريخ تأكيده.
  CHECK(doc_key<>'advance_confirmation' OR status<>'present' OR (amount_minor IS NOT NULL AND confirmed_on IS NOT NULL))
) STRICT;
CREATE TRIGGER receipt_documents_no_delete BEFORE DELETE ON receipt_documents BEGIN SELECT RAISE(ABORT,'a checklist row is reopened, not deleted'); END;

-- PM-02: محضر اجتماع الانطلاق. كل بند من بنود المحضر حقل مستقل لأن غيابه سؤال يتكرر بعد شهر.
CREATE TABLE project_kickoffs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  receipt_id TEXT NOT NULL REFERENCES project_receipts(id),
  held_on TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('in_person','online','hybrid')),
  client_contact_name TEXT NOT NULL CHECK(length(trim(client_contact_name))>=2),
  agreed_scope TEXT NOT NULL CHECK(length(trim(agreed_scope))>=10),
  deliverables_note TEXT NOT NULL CHECK(length(trim(deliverables_note))>=10),
  milestones TEXT NOT NULL CHECK(json_valid(milestones)),
  revision_rounds_note TEXT NOT NULL CHECK(length(trim(revision_rounds_note))>=5),
  recurring_meetings TEXT NOT NULL CHECK(length(trim(recurring_meetings))>=5),
  approval_policy TEXT NOT NULL CHECK(length(trim(approval_policy))>=10),
  client_response_days INTEGER NOT NULL CHECK(client_response_days BETWEEN 1 AND 30),
  official_channel TEXT NOT NULL CHECK(length(trim(official_channel))>=3),
  special_constraints TEXT NOT NULL DEFAULT '',
  revision_policy TEXT NOT NULL CHECK(length(trim(revision_policy))>=10),
  -- «طلب التعديلات كتابيًا فقط» من النقاط التي يوضحها المحضر للعميل: إقرار صريح لا افتراض.
  written_changes_only INTEGER NOT NULL CHECK(written_changes_only IN (0,1)),
  delay_policy TEXT NOT NULL CHECK(length(trim(delay_policy))>=10),
  publication_policy TEXT NOT NULL CHECK(length(trim(publication_policy))>=10),
  cancellation_policy TEXT NOT NULL CHECK(length(trim(cancellation_policy))>=10),
  -- لا توقيع من العميل داخل المنصة: تأكيده للمحضر يوثّقه موظف بمرجع دليله، كما في سجل موافقات العملاء.
  client_acknowledgement TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorder_role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(receipt_id)
) STRICT;
CREATE TRIGGER project_kickoffs_immutable BEFORE UPDATE ON project_kickoffs BEGIN SELECT RAISE(ABORT,'minutes are a record of what was said; correct them with a change request'); END;
CREATE TRIGGER project_kickoffs_no_delete BEFORE DELETE ON project_kickoffs BEGIN SELECT RAISE(ABORT,'minutes are retained'); END;

-- الحضور يُسجَّل باختيار الأشخاص من دليل المنصة لجهة الشركة — بهويتهم ودورهم لا بأسماء مكتوبة —
-- وبأسماء حرة لحضور العميل مع جهة كل منهم، لأن العميل لا يدخل المنصة ولا يُنشأ له حساب.
CREATE TABLE kickoff_attendees (
  id TEXT PRIMARY KEY,
  kickoff_id TEXT NOT NULL REFERENCES project_kickoffs(id),
  side TEXT NOT NULL CHECK(side IN ('company','client')),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  title TEXT NOT NULL DEFAULT '',
  organisation TEXT NOT NULL CHECK(length(trim(organisation))>=2),
  attendee_role TEXT NOT NULL DEFAULT '',
  attended INTEGER NOT NULL CHECK(attended IN (0,1)),
  CHECK((side='client')=(user_id IS NULL)),
  CHECK((side='company')=(length(trim(attendee_role))>0))
) STRICT;

-- PM-03: طلب التغيير. التصنيف أربعة لا اثنان، وخطؤنا لا يُحمَّل على العميل آليًا.
CREATE TABLE project_change_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  receipt_id TEXT NOT NULL REFERENCES project_receipts(id),
  number INTEGER NOT NULL CHECK(number>=1),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  deliverable_id TEXT REFERENCES project_deliverables(id),
  round_number INTEGER CHECK(round_number IS NULL OR round_number>=1),
  classification TEXT NOT NULL CHECK(classification IN ('our_error','in_scope','extra_round','scope_change')),
  free_rounds_exhausted INTEGER NOT NULL CHECK(free_rounds_exhausted IN (0,1)),
  schedule_impact_days INTEGER NOT NULL DEFAULT 0 CHECK(schedule_impact_days BETWEEN -365 AND 365),
  budget_impact INTEGER NOT NULL CHECK(budget_impact IN (0,1)),
  extra_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(extra_cost_minor>=0),
  -- أثر الطلب على المخرج نفسه: جولات مشتراة أو كمية مضافة. يُطبَّق على المخرج عند تنفيذ الطلب لا قبله.
  added_rounds INTEGER NOT NULL DEFAULT 0 CHECK(added_rounds BETWEEN 0 AND 20),
  added_quantity INTEGER NOT NULL DEFAULT 0 CHECK(added_quantity BETWEEN 0 AND 1000),
  quotation_reference TEXT NOT NULL DEFAULT '',
  finance_decision TEXT CHECK(finance_decision IS NULL OR finance_decision IN ('approved','rejected')),
  finance_note TEXT NOT NULL DEFAULT '',
  finance_decided_by TEXT REFERENCES users(id),
  finance_decided_at TEXT,
  client_approval_reference TEXT NOT NULL DEFAULT '',
  client_approved_on TEXT,
  client_recorded_by TEXT REFERENCES users(id),
  start_date TEXT,
  -- «توقيع مدير المشروع» في PM-03 اعتماد إلكتروني: هويته ودوره ونسخة السجل ووقته، لا سطر توقيع.
  applied_by TEXT REFERENCES users(id),
  applied_role TEXT NOT NULL DEFAULT '',
  applied_record_version INTEGER,
  applied_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('raised','priced','approved','declined','applied')),
  raised_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(receipt_id,number),
  -- القاعدة التي طُلبت صراحة: خطؤنا لا يُسعَّر على العميل، لا بأثر مالي ولا بتكلفة إضافية ولا بعرض إضافي.
  CHECK(classification<>'our_error' OR (budget_impact=0 AND extra_cost_minor=0 AND quotation_reference='')),
  -- تغيير داخل النطاق لا يحمل تكلفة إضافية؛ فإن حملها فهو تغيير نطاق أو جولة إضافية باسمها الصحيح.
  CHECK(classification<>'in_scope' OR extra_cost_minor=0),
  CHECK((budget_impact=1)=(extra_cost_minor>0)),
  -- استنفاد الجولات المجانية يرفع عرضًا مسعّرًا لا عملًا صامتًا.
  CHECK(free_rounds_exhausted=0 OR classification IN ('our_error','extra_round','scope_change')),
  CHECK(classification<>'extra_round' OR deliverable_id IS NOT NULL),
  CHECK(added_rounds=0 OR (deliverable_id IS NOT NULL AND classification IN ('extra_round','scope_change'))),
  CHECK(added_quantity=0 OR (deliverable_id IS NOT NULL AND classification='scope_change')),
  CHECK((finance_decision IS NULL)=(finance_decided_by IS NULL)),
  CHECK((finance_decided_by IS NULL)=(finance_decided_at IS NULL)),
  CHECK((client_approved_on IS NULL)=(client_recorded_by IS NULL)),
  CHECK((applied_by IS NULL)=(applied_at IS NULL)),
  CHECK((applied_by IS NULL)=(applied_record_version IS NULL)),
  CHECK((status='applied')=(applied_by IS NOT NULL)),
  CHECK(status<>'applied' OR start_date IS NOT NULL)
) STRICT;
CREATE INDEX project_change_requests_receipt ON project_change_requests(receipt_id,status);
CREATE TRIGGER project_change_requests_no_delete BEFORE DELETE ON project_change_requests BEGIN SELECT RAISE(ABORT,'change requests are declined, not deleted'); END;

-- ما أعاد طلبُ التغيير فتحَه من اعتمادات الاستلام. يُكتب صراحةً ليُقرأ لاحقًا:
-- «أُعيد فتح التسعير وحده» جملة يجب أن يكون لها أثر، لا ادعاء في وصف.
CREATE TABLE change_request_reopenings (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL REFERENCES project_change_requests(id),
  doc_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
  created_at TEXT NOT NULL,
  UNIQUE(change_request_id,doc_key)
) STRICT;

-- إخلاء الطرف يشتق بنوده من الجداول القائمة (072). هذه الجداول الثلاثة مصادر جديدة له: مدير مشروع يغادر
-- ومحضر تسليم باسمه لم يُستلم، أو استلام مسجَّل باسمه، أو طلب تغيير رفعه ولم يُبت فيه — كلها تترك مشروعًا
-- بلا مسؤول مسمى في محضره. قيد CHECK في 072 لا يعرف هذه المصادر، فيُعاد بناء الجدول ليعرفها.
-- لا تتغير أعمدته ولا قيوده الأخرى ولا بياناته: التغيير الوحيد هو توسعة قائمة المصادر المسموحة.
CREATE TABLE lifecycle_clearance_items_109 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bundle_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('custody','fixed_asset','equipment','access_grant','account','advance','request','request_task','project_task','approval_step','delegation','project','project_handover','project_receipt','project_change_request')),
  source_id TEXT NOT NULL CHECK(length(trim(source_id))>0),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  detail TEXT NOT NULL DEFAULT '',
  financial INTEGER NOT NULL CHECK(financial IN (0,1)),
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor>=0),
  action_owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('open','cleared')),
  evidence TEXT NOT NULL DEFAULT '',
  cleared_by TEXT REFERENCES users(id),
  cleared_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bundle_id,source,source_id),
  FOREIGN KEY(bundle_id,employee_id) REFERENCES lifecycle_bundles(id,employee_id),
  CHECK(cleared_by IS NULL OR cleared_by<>employee_id),
  CHECK((status='cleared')=(cleared_by IS NOT NULL)),
  CHECK(status<>'cleared' OR length(trim(evidence))>=10),
  CHECK(financial=0 OR amount_minor IS NOT NULL)
) STRICT;
INSERT INTO lifecycle_clearance_items_109 SELECT id,tenant_id,bundle_id,employee_id,source,source_id,title,detail,financial,amount_minor,action_owner,status,evidence,cleared_by,cleared_at,version,created_at,updated_at FROM lifecycle_clearance_items;
DROP TABLE lifecycle_clearance_items;
ALTER TABLE lifecycle_clearance_items_109 RENAME TO lifecycle_clearance_items;
CREATE INDEX lifecycle_clearance_employee ON lifecycle_clearance_items(tenant_id,employee_id,status);
CREATE TRIGGER lifecycle_clearance_versioned BEFORE UPDATE ON lifecycle_clearance_items
WHEN NEW.version<>OLD.version+1 OR NEW.bundle_id<>OLD.bundle_id OR NEW.employee_id<>OLD.employee_id
  OR NEW.source<>OLD.source OR NEW.source_id<>OLD.source_id OR OLD.status='cleared'
BEGIN SELECT RAISE(ABORT,'a cleared item is final; a clearance item never changes the source it was derived from'); END;
CREATE TRIGGER lifecycle_clearance_no_delete BEFORE DELETE ON lifecycle_clearance_items BEGIN SELECT RAISE(ABORT,'clearance items are retained'); END;

-- قراءة البوابة: أي القراءتين سارية، بسندها ومن أقرّها. إعداد جديد يُسبق القديم ولا يمحوه.
CREATE TABLE project_intake_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  gate_reading TEXT NOT NULL CHECK(gate_reading IN ('block_paid_execution','documents_advisory')),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  confirmed_on TEXT NOT NULL,
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  superseded_at TEXT
) STRICT;
CREATE INDEX project_intake_settings_live ON project_intake_settings(tenant_id,superseded_at);

-- سياسة تصنيف التغيير: تبقى مسودة حتى يعتمدها غير من أعدّها. بلا اعتماد لا تُفرض على أحد،
-- والمنصة تعمل حينها بالتعريفات الأربعة كما وردت في نموذج الشركة وتقول ذلك في الشاشة.
CREATE TABLE change_classification_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  rules TEXT NOT NULL CHECK(json_valid(rules)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((approved_by IS NULL)=(decided_at IS NULL)),
  CHECK(status IN ('draft') OR approved_by IS NOT NULL)
) STRICT;
CREATE INDEX change_classification_policies_live ON change_classification_policies(tenant_id,status);
