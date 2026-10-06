-- ترحيل 184 — الدعم بعد البيع: بلاغ العميل وتصعيده سجلٌّ مربوط بالعميل والصفقة وبمهلته (الحزمة 4، P4-CRM-5).
--
-- قبله: «شكوى أو ملاحظة عميل» (ACC-CLIENT-COMPLAINT) و«تصعيد حساب عميل» (ACC-ESCALATION) طلبان في دليل الخدمات بحقل نصي
-- اسمه «العميل»، فلا يُقرأ تاريخ ما بعد البيع على ملف العميل ولا على الصفقة، ولا مهلة رد تُقاس عليها.
--
-- هذا الترحيل:
--   (1) يربط سجل العقد بصفقته (contract_records.case_id)، ويحمل بندي العقد اللذين يتجاوزان افتراض المنصة (القرار D4 «كلاهما»):
--       مهلة الرد الأول على البلاغ بالساعات، وأيام الضمان بعد قبول المخرج. فارغان = العقد لا يقول شيئًا، فيسري المعتمد.
--   (2) بلاغ العميل (client_support_cases) بمهلته المحسوبة لحظة فتحه، وسجلّ أحداثه (client_support_events) إلحاقيًا.
-- المهلة لا تُخترع: مصدرها العقد أو القيمة المعتمدة crm.support_response_hours، وإلا تبقى «ما تحددت» (response_source='unset').
-- ومن يقرّ حلّ البلاغ ليس من سجّله (قيد في القاعدة لا في الشيفرة وحدها).

/* ───── (1) العقد وصفقته وبنود الدعم فيه ───── */
ALTER TABLE contract_records ADD COLUMN case_id TEXT REFERENCES commercial_cases(id);
ALTER TABLE contract_records ADD COLUMN support_response_hours INTEGER CHECK(support_response_hours IS NULL OR support_response_hours BETWEEN 1 AND 2160);
ALTER TABLE contract_records ADD COLUMN warranty_days INTEGER CHECK(warranty_days IS NULL OR warranty_days BETWEEN 0 AND 3650);
-- لكل صفقة سجل عقد واحد قائم (المسودة الملغاة لا تحجز الصفقة).
CREATE UNIQUE INDEX contract_records_deal ON contract_records(case_id) WHERE case_id IS NOT NULL AND status<>'cancelled';
-- صفقة العقد صفقةٌ لعميله نفسه، والطرف عميل.
CREATE TRIGGER contract_records_deal_same_client BEFORE INSERT ON contract_records
WHEN NEW.case_id IS NOT NULL AND (NEW.party_kind<>'client' OR NOT EXISTS(SELECT 1 FROM commercial_cases k
  WHERE k.id=NEW.case_id AND k.tenant_id=NEW.tenant_id AND k.client_id IS NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a contract record names a deal of its own client'); END;
CREATE TRIGGER contract_records_deal_same_client_update BEFORE UPDATE OF case_id,client_id,party_kind ON contract_records
WHEN NEW.case_id IS NOT NULL AND (NEW.party_kind<>'client' OR NOT EXISTS(SELECT 1 FROM commercial_cases k
  WHERE k.id=NEW.case_id AND k.tenant_id=NEW.tenant_id AND k.client_id IS NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a contract record names a deal of its own client'); END;
-- العقد الساري لا يُعدَّل (contract_records_in_force_not_edited في 057)؛ والأعمدة الثلاثة الجديدة تحت القاعدة نفسها.
CREATE TRIGGER contract_records_support_terms_fixed BEFORE UPDATE ON contract_records
WHEN OLD.status<>'draft' AND (NEW.case_id IS NOT OLD.case_id OR NEW.support_response_hours IS NOT OLD.support_response_hours
  OR NEW.warranty_days IS NOT OLD.warranty_days)
BEGIN SELECT RAISE(ABORT,'a contract in force keeps its deal and its support terms; a change is a numbered annex'); END;

/* ───── (2) بلاغ العميل ───── */
CREATE TABLE client_support_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  number TEXT NOT NULL CHECK(number GLOB 'SC-[0-9][0-9][0-9][0-9]*'),
  client_id TEXT NOT NULL,
  -- الصفقة: إلزامية للشكوى (بعد البيع على عمل بعينه)، واختيارية للتصعيد (الحساب كله قد يكون في خطر).
  case_id TEXT,
  -- سجل العقد الذي حكم المهلة لحظة الفتح، إن كان لبنده أثر.
  contract_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('complaint','escalation')),
  severity TEXT NOT NULL CHECK(severity IN ('high','medium','low')),
  risk TEXT CHECK(risk IS NULL OR risk IN ('churn','repeated_delay','scope_dispute','late_payment')),
  channel TEXT NOT NULL CHECK(channel IN ('email','phone','meeting','message','other')),
  -- لحظة وصول البلاغ من العميل (لا لحظة تسجيله): منها تبدأ المهلة.
  received_at TEXT NOT NULL CHECK(received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  statement TEXT NOT NULL CHECK(length(trim(statement))>=10),
  proposed_action TEXT NOT NULL DEFAULT '',
  -- المهلة كما سرت لحظة الفتح، ومصدرها. «unset» = لا عقد يقولها ولا قيمة معتمدة بعد، فلا موعد.
  response_hours INTEGER CHECK(response_hours IS NULL OR response_hours BETWEEN 1 AND 2160),
  response_source TEXT NOT NULL CHECK(response_source IN ('contract','adopted','unset')),
  response_due_at TEXT,
  -- الضمان: أيامه ومصدرها، وآخر يوم فيه (يوم رياض) من آخر قبول مخرج على الصفقة. فارغ = لا مدة أو لا قبول.
  warranty_days INTEGER CHECK(warranty_days IS NULL OR warranty_days BETWEEN 0 AND 3650),
  warranty_source TEXT NOT NULL CHECK(warranty_source IN ('contract','adopted','unset')),
  warranty_until TEXT CHECK(warranty_until IS NULL OR warranty_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  handler_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','responded','resolved','closed')),
  responded_at TEXT,
  responded_by TEXT,
  response_note TEXT NOT NULL DEFAULT '',
  resolution_kind TEXT CHECK(resolution_kind IS NULL OR resolution_kind IN ('fixed','warranty_fix','change_request','explained','no_fault')),
  resolution TEXT NOT NULL DEFAULT '',
  resolution_evidence TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  resolved_by TEXT,
  closed_at TEXT,
  closed_by TEXT,
  closure_note TEXT NOT NULL DEFAULT '',
  opened_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id),
  FOREIGN KEY(case_id,tenant_id) REFERENCES commercial_cases(id,tenant_id),
  FOREIGN KEY(contract_id,tenant_id) REFERENCES contract_records(id,tenant_id),
  FOREIGN KEY(handler_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(opened_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(responded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(resolved_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='escalation')=(risk IS NOT NULL)),
  CHECK(kind<>'complaint' OR case_id IS NOT NULL),
  CHECK((response_source='unset')=(response_hours IS NULL)),
  CHECK((response_hours IS NULL)=(response_due_at IS NULL)),
  CHECK((warranty_source='unset')=(warranty_days IS NULL)),
  CHECK(warranty_until IS NULL OR warranty_days IS NOT NULL),
  CHECK((status IN ('responded','resolved','closed'))=(responded_at IS NOT NULL AND responded_by IS NOT NULL)),
  CHECK((status IN ('resolved','closed'))=(resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_kind IS NOT NULL)),
  CHECK((status='closed')=(closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  -- فصل المهام: من يقرّ حلّ البلاغ ويقفله ليس من سجّل الحل.
  CHECK(closed_by IS NULL OR closed_by<>resolved_by)
) STRICT;
CREATE UNIQUE INDEX client_support_cases_number ON client_support_cases(tenant_id,number);
CREATE INDEX client_support_cases_client ON client_support_cases(client_id,status);
CREATE INDEX client_support_cases_deal ON client_support_cases(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX client_support_cases_handler ON client_support_cases(tenant_id,handler_id,status);

-- الصفقة وسجل العقد لعميل البلاغ نفسه.
CREATE TRIGGER client_support_cases_same_client BEFORE INSERT ON client_support_cases
WHEN (NEW.case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commercial_cases k WHERE k.id=NEW.case_id AND k.tenant_id=NEW.tenant_id AND k.client_id=NEW.client_id))
  OR (NEW.contract_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contract_records c WHERE c.id=NEW.contract_id AND c.tenant_id=NEW.tenant_id AND c.client_id=NEW.client_id))
BEGIN SELECT RAISE(ABORT,'a support case belongs to the customer of its deal and of its contract'); END;
-- ما وصل من العميل وما سرى من مهلة لحظة الفتح ثابت؛ والانتقال خطوة واحدة للأمام (أو إعادة الحل إلى المعالجة)، والمقفل نهائي.
CREATE TRIGGER client_support_cases_versioned BEFORE UPDATE ON client_support_cases
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.number<>OLD.number OR NEW.client_id<>OLD.client_id
  OR NEW.case_id IS NOT OLD.case_id OR NEW.contract_id IS NOT OLD.contract_id OR NEW.kind<>OLD.kind OR NEW.severity<>OLD.severity
  OR NEW.risk IS NOT OLD.risk OR NEW.channel<>OLD.channel OR NEW.received_at<>OLD.received_at OR NEW.statement<>OLD.statement
  OR NEW.response_hours IS NOT OLD.response_hours OR NEW.response_source<>OLD.response_source OR NEW.response_due_at IS NOT OLD.response_due_at
  OR NEW.warranty_days IS NOT OLD.warranty_days OR NEW.warranty_source<>OLD.warranty_source OR NEW.warranty_until IS NOT OLD.warranty_until
  OR NEW.opened_by<>OLD.opened_by OR NEW.created_at<>OLD.created_at
  OR (OLD.responded_at IS NOT NULL AND (NEW.responded_at IS NOT OLD.responded_at OR NEW.responded_by IS NOT OLD.responded_by))
  OR OLD.status='closed'
  OR NOT ((OLD.status=NEW.status) OR (OLD.status='open' AND NEW.status='responded') OR (OLD.status='responded' AND NEW.status='resolved')
    OR (OLD.status='resolved' AND NEW.status IN ('closed','responded')))
BEGIN SELECT RAISE(ABORT,'a support case keeps what the client said and its clock; it moves one step at a time, and a closed case is final'); END;
CREATE TRIGGER client_support_cases_no_delete BEFORE DELETE ON client_support_cases
BEGIN SELECT RAISE(ABORT,'support cases are retained'); END;

-- سجل الأحداث: كل خطوة بفاعلها ونصها، لا يُعدَّل ولا يُحذف.
CREATE TABLE client_support_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  support_case_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('opened','responded','resolved','returned','closed','reassigned')),
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(support_case_id,tenant_id) REFERENCES client_support_cases(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX client_support_events_case ON client_support_events(support_case_id,created_at);
CREATE TRIGGER client_support_events_append_only BEFORE UPDATE ON client_support_events
BEGIN SELECT RAISE(ABORT,'support history is append-only'); END;
CREATE TRIGGER client_support_events_no_delete BEFORE DELETE ON client_support_events
BEGIN SELECT RAISE(ABORT,'support history is append-only'); END;
