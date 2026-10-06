-- ترحيل 186 — إنهاء العلاقة مع العميل وإعادة فتحها (الحزمة 4، P4-CRM-7).
--
-- قبله: «تغيير الحالة» إلى «مقفل» على ملف العميل سطر ملاحظة لا يفحص شيئًا: الذمم المفتوحة والبنود غير المسلَّمة والجدولة
-- الدورية (التي تبقى تجهّز مسودات فواتير لعميل مقفل) والعقود السارية وفريق الحساب تبقى كما كانت.
--
-- هذا الترحيل:
--   (1) client_offboardings: سجل إقفال أو إعادة فتح — سببه، وما فُحص لحظة طلبه، وما فعله القرار (الفريق والجهات والعلامات
--       والمعتمدون الخارجيون)، وأساس الاحتفاظ من سجل حماية البيانات لحظة القرار. يقرّه غير طالبه، وهو من سمّاه الطالب.
--   (2) clients.offboarding_id: السجل المعتمد الذي يقف خلف حالة الملف. الملف لا يُقفل إلا بسجل إقفال معتمد بيد غير طالبه، ولا يرجع
--       من الإقفال إلا بسجل إعادة فتح معتمد كذلك، ولا يولد مقفلًا. القاعدة تفرضها مهما كان الكاتب.
-- القيد على صفوف قائمة: عميل مقفل قبل هذا الترحيل يبقى مقفلًا بلا سجل خلفه (offboarding_id فارغ)، ورجوعه بسجل إعادة فتح كغيره.

CREATE TABLE client_offboardings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  number TEXT NOT NULL CHECK(number GLOB 'OFB-[0-9][0-9][0-9][0-9]*'),
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('close','reopen')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  -- ما صار بملفات علامات العميل وأدلة هويته عند الإقفال (سُلّمت، أُرشفت، أين): إلزامي حين للعميل علامات.
  assets_note TEXT NOT NULL DEFAULT '',
  checklist TEXT NOT NULL CHECK(json_valid(checklist) AND json_type(checklist)='array'),
  effects TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(effects) AND json_type(effects)='object'),
  retention TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(retention) AND json_type(retention)='object'),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','withdrawn')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approver_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  -- فصل المهام: المعتمد ليس الطالب، والقرار بيد المعتمد المسمّى وحده.
  CHECK(approver_id<>requested_by),
  CHECK(decided_by IS NULL OR decided_by=approver_id),
  CHECK((status IN ('approved','rejected'))=(decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(status NOT IN ('approved','rejected') OR length(trim(decision_note))>=5)
) STRICT;
CREATE UNIQUE INDEX client_offboardings_number ON client_offboardings(tenant_id,number);
-- طلب واحد معلّق لكل عميل.
CREATE UNIQUE INDEX client_offboardings_open ON client_offboardings(client_id) WHERE status='requested';
CREATE INDEX client_offboardings_approver ON client_offboardings(tenant_id,approver_id,status);
-- الإقفال لعميل غير مقفل، وإعادة الفتح لعميل مقفل.
CREATE TRIGGER client_offboardings_kind_matches BEFORE INSERT ON client_offboardings
WHEN NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id
  AND ((NEW.kind='close' AND c.status<>'closed') OR (NEW.kind='reopen' AND c.status='closed')))
BEGIN SELECT RAISE(ABORT,'close a client that is open, reopen a client that is closed'); END;
-- يُقرَّر مرة؛ وما طُلب وما فُحص لحظة الطلب ثابت.
CREATE TRIGGER client_offboardings_versioned BEFORE UPDATE ON client_offboardings
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'requested' OR NEW.tenant_id<>OLD.tenant_id OR NEW.number<>OLD.number
  OR NEW.client_id<>OLD.client_id OR NEW.kind<>OLD.kind OR NEW.reason<>OLD.reason OR NEW.assets_note<>OLD.assets_note
  OR NEW.checklist<>OLD.checklist OR NEW.requested_by<>OLD.requested_by OR NEW.requested_at<>OLD.requested_at OR NEW.approver_id<>OLD.approver_id
BEGIN SELECT RAISE(ABORT,'an offboarding record is decided once; what was requested and checked is fixed'); END;
CREATE TRIGGER client_offboardings_no_delete BEFORE DELETE ON client_offboardings
BEGIN SELECT RAISE(ABORT,'offboarding records are retained'); END;

/* ───── (2) حالة الملف خلفها سجل معتمد ───── */
ALTER TABLE clients ADD COLUMN offboarding_id TEXT REFERENCES client_offboardings(id);
CREATE TRIGGER clients_not_born_closed BEFORE INSERT ON clients
WHEN NEW.status='closed'
BEGIN SELECT RAISE(ABORT,'a client is closed only through an approved offboarding record'); END;
CREATE TRIGGER clients_closed_through_record BEFORE UPDATE OF status ON clients
WHEN NEW.status='closed' AND OLD.status<>'closed' AND (NEW.offboarding_id IS OLD.offboarding_id OR NOT EXISTS(SELECT 1 FROM client_offboardings o
  WHERE o.id=NEW.offboarding_id AND o.client_id=NEW.id AND o.kind='close' AND o.status='approved' AND o.decided_by<>o.requested_by))
BEGIN SELECT RAISE(ABORT,'a client is closed only through an approved offboarding record decided by someone other than its requester'); END;
CREATE TRIGGER clients_reopened_through_record BEFORE UPDATE OF status ON clients
WHEN OLD.status='closed' AND NEW.status<>'closed' AND (NEW.offboarding_id IS OLD.offboarding_id OR NOT EXISTS(SELECT 1 FROM client_offboardings o
  WHERE o.id=NEW.offboarding_id AND o.client_id=NEW.id AND o.kind='reopen' AND o.status='approved' AND o.decided_by<>o.requested_by))
BEGIN SELECT RAISE(ABORT,'a closed client is reopened only through an approved reopening record decided by someone other than its requester'); END;
CREATE TRIGGER clients_offboarding_link BEFORE UPDATE OF offboarding_id ON clients
WHEN NEW.offboarding_id IS NOT OLD.offboarding_id AND (NEW.offboarding_id IS NULL OR NOT EXISTS(SELECT 1 FROM client_offboardings o
  WHERE o.id=NEW.offboarding_id AND o.client_id=NEW.id AND o.status='approved'
    AND ((o.kind='close' AND NEW.status='closed') OR (o.kind='reopen' AND NEW.status<>'closed'))))
BEGIN SELECT RAISE(ABORT,'a client points at the approved record behind its current state'); END;
