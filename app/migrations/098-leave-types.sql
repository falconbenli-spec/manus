-- 098: أنواع الإجازات النظامية بأحكامها (P1-02، اللائحة م80–94 وم105).
-- قيم اللائحة سياسة مسودة تستشهد بالمادة، ولا تسري إلا باعتماد مدير الموارد البشرية (نمط hr.policy.accept).
-- لا يُمس جدول من جداول الإجازات القائمة: الطلب القديم يبقى كما هو، وما يضيفه النوع النظامي يُحفظ في جداول جانبية
-- مرتبطة بنسخة الطلب (revision)، حتى تبقى قيود الترحيل 006 وسجلها كما كُتبت.

CREATE TABLE leave_type_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  parameters TEXT NOT NULL CHECK(json_valid(parameters)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL))
) STRICT;
CREATE INDEX leave_type_policies_live ON leave_type_policies(tenant_id,status,effective_from);
CREATE TRIGGER leave_type_policies_fixed BEFORE UPDATE ON leave_type_policies
WHEN OLD.status<>'draft' OR NEW.parameters<>OLD.parameters OR NEW.title<>OLD.title OR NEW.body<>OLD.body OR NEW.basis<>OLD.basis OR NEW.effective_from<>OLD.effective_from OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'a decided leave type policy is replaced by a new dated policy'); END;
CREATE TRIGGER leave_type_policies_no_delete BEFORE DELETE ON leave_type_policies BEGIN SELECT RAISE(ABORT,'leave type policies are retained'); END;

-- شروط النسخة المقدمة: النوع ووحدته وأيامه بالألف (نصف يوم = 500) ومصدر الرصيد ومسار الاعتماد ونسبة أجر كل يوم.
-- leave_requests.days يبقى عددًا صحيحًا كما قيده 006؛ القيمة الدقيقة هنا.
CREATE TABLE leave_request_terms (
  request_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  tenant_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES leave_type_policies(id),
  unit TEXT NOT NULL CHECK(unit IN ('working','calendar')),
  days_milli INTEGER NOT NULL CHECK(days_milli>0),
  counted_dates_json TEXT NOT NULL CHECK(json_valid(counted_dates_json)),
  half_day INTEGER NOT NULL DEFAULT 0 CHECK(half_day IN (0,1)),
  variant TEXT,
  event_date TEXT,
  source TEXT NOT NULL CHECK(source IN ('opening','accrual','entitlement','none')),
  route TEXT NOT NULL CHECK(route IN ('manager_hr','manager_authority_hr')),
  pay_json TEXT NOT NULL CHECK(json_valid(pay_json)),
  document_required INTEGER NOT NULL CHECK(document_required IN (0,1)),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id,revision),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  CHECK(half_day=0 OR days_milli=500)
) STRICT;
CREATE INDEX leave_request_terms_type ON leave_request_terms(tenant_id,leave_type);
CREATE TRIGGER leave_request_terms_no_update BEFORE UPDATE ON leave_request_terms BEGIN SELECT RAISE(ABORT,'leave request terms are immutable'); END;
CREATE TRIGGER leave_request_terms_no_delete BEFORE DELETE ON leave_request_terms BEGIN SELECT RAISE(ABORT,'leave request terms are immutable'); END;

-- دفتر الأيام بالألف للأنواع التي لا تُصرف من رصيد افتتاحي: رصيد محرك الاستحقاق (accrual) أو استحقاق سنوي
-- ثابت في السياسة (entitlement، مثل الطارئة 3 أيام). الحجز عند التقديم، والخصم عند الاعتماد النهائي، والرد عند الإلغاء.
CREATE TABLE leave_day_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  balance_year INTEGER NOT NULL CHECK(balance_year BETWEEN 2000 AND 2200),
  source TEXT NOT NULL CHECK(source IN ('accrual','entitlement')),
  request_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  kind TEXT NOT NULL CHECK(kind IN ('reserve','release','debit','refund')),
  used_milli INTEGER NOT NULL,
  reserved_milli INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,revision,kind),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='reserve' AND used_milli=0 AND reserved_milli>0)
    OR (kind='release' AND used_milli=0 AND reserved_milli<0)
    OR (kind='debit' AND used_milli>0 AND reserved_milli=-used_milli)
    OR (kind='refund' AND used_milli<0 AND reserved_milli=0))
) STRICT;
CREATE INDEX leave_day_ledger_scope ON leave_day_ledger(tenant_id,employee_id,leave_type,balance_year,seq);
CREATE UNIQUE INDEX leave_day_debit_once ON leave_day_ledger(request_id) WHERE kind='debit';
CREATE UNIQUE INDEX leave_day_refund_once ON leave_day_ledger(request_id) WHERE kind='refund';
CREATE TRIGGER leave_day_ledger_no_update BEFORE UPDATE ON leave_day_ledger BEGIN SELECT RAISE(ABORT,'leave day ledger is append only'); END;
CREATE TRIGGER leave_day_ledger_no_delete BEFORE DELETE ON leave_day_ledger BEGIN SELECT RAISE(ABORT,'leave day ledger is append only'); END;
CREATE TRIGGER leave_day_ledger_reserved_nonnegative BEFORE INSERT ON leave_day_ledger
WHEN (SELECT COALESCE(SUM(reserved_milli),0) FROM leave_day_ledger WHERE request_id=NEW.request_id)+NEW.reserved_milli<0
BEGIN SELECT RAISE(ABORT,'leave reservation cannot be negative'); END;
CREATE TRIGGER leave_day_refund_requires_debit BEFORE INSERT ON leave_day_ledger
WHEN NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM leave_day_ledger l WHERE l.request_id=NEW.request_id AND l.kind='debit' AND l.used_milli=-NEW.used_milli)
BEGIN SELECT RAISE(ABORT,'leave refund requires a matching debit'); END;

-- خطوة صاحب الصلاحية (م90 مرافقة المريض، م91 الاستثنائية فوق 5 أيام عمل): بعد المدير وقبل خدمات الموظف.
-- جدول مستقل لأن مراحل leave_decisions مقيدة في 006 بالمدير وخدمات الموظف.
CREATE TABLE leave_authority_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','return','reject')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,revision),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER leave_authority_no_update BEFORE UPDATE ON leave_authority_decisions BEGIN SELECT RAISE(ABORT,'leave decisions are immutable'); END;
CREATE TRIGGER leave_authority_no_delete BEFORE DELETE ON leave_authority_decisions BEGIN SELECT RAISE(ABORT,'leave decisions are immutable'); END;
CREATE TRIGGER leave_authority_no_self BEFORE INSERT ON leave_authority_decisions
WHEN EXISTS(SELECT 1 FROM leave_requests r WHERE r.id=NEW.request_id AND r.employee_id=NEW.actor_id)
BEGIN SELECT RAISE(ABORT,'leave self approval is forbidden'); END;

-- أثر الإجازة على الأجر: عند الاعتماد النهائي تُقترح حركة خصم في المسير (payroll_adjustments بحالة proposed)
-- لأيام المرضية بنسبة 75% أو بلا أجر، والإجازة بلا أجر. لا يُعتمد شيء آليًا: يعتمدها حامل payroll.approve.
CREATE TABLE leave_pay_effects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  dates_json TEXT NOT NULL CHECK(json_valid(dates_json)),
  lost_bp_days INTEGER NOT NULL CHECK(lost_bp_days>0),
  amount_minor INTEGER,
  adjustment_id TEXT REFERENCES payroll_adjustments(id),
  status TEXT NOT NULL CHECK(status IN ('proposed','unpriced','withdrawn')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  CHECK((status='unpriced')=(adjustment_id IS NULL AND amount_minor IS NULL) OR status='withdrawn')
) STRICT;
CREATE INDEX leave_pay_effects_request ON leave_pay_effects(request_id);
CREATE TRIGGER leave_pay_effects_fixed BEFORE UPDATE ON leave_pay_effects
WHEN NEW.request_id<>OLD.request_id OR NEW.month<>OLD.month OR NEW.dates_json<>OLD.dates_json OR NEW.amount_minor IS NOT OLD.amount_minor OR NEW.adjustment_id IS NOT OLD.adjustment_id OR NOT (NEW.status=OLD.status OR NEW.status='withdrawn')
BEGIN SELECT RAISE(ABORT,'a leave pay effect is only withdrawn'); END;
CREATE TRIGGER leave_pay_effects_no_delete BEFORE DELETE ON leave_pay_effects BEGIN SELECT RAISE(ABORT,'leave pay effects are retained'); END;

-- مستندات طلب الإجازة (التقرير الطبي وغيره) عبر files.mjs. قيد CHECK في 035 كان يحصر أنواع السجلات في أربعة،
-- فيُعاد بناء الجدول مرة واحدة بسجل أنواع يُضاف إليه بسطر INSERT في أي ترحيل لاحق بدل إعادة البناء كل مرة.
CREATE TABLE stored_file_entity_types (
  entity_type TEXT PRIMARY KEY CHECK(entity_type GLOB '[a-z]*' AND length(entity_type) BETWEEN 3 AND 60),
  added_in INTEGER NOT NULL
) STRICT;
INSERT INTO stored_file_entity_types VALUES('vendor',35),('external_approval',35),('employment_contract',35),('expense_claim',35),('leave_request',98);
ALTER TABLE stored_files RENAME TO stored_files_v035;
CREATE TABLE stored_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL REFERENCES stored_file_entity_types(entity_type),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
INSERT INTO stored_files SELECT id,tenant_id,entity_type,entity_id,label,filename,media_type,size,digest,content,restricted,uploaded_by,created_at FROM stored_files_v035;
DROP TABLE stored_files_v035;
CREATE INDEX stored_files_entity ON stored_files(tenant_id,entity_type,entity_id);
CREATE TRIGGER stored_files_no_update BEFORE UPDATE ON stored_files BEGIN SELECT RAISE(ABORT,'stored files are immutable'); END;
CREATE TRIGGER stored_files_no_delete BEFORE DELETE ON stored_files BEGIN SELECT RAISE(ABORT,'stored files are retained'); END;
CREATE TRIGGER stored_file_entity_types_no_delete BEFORE DELETE ON stored_file_entity_types BEGIN SELECT RAISE(ABORT,'file entity types are retained'); END;
