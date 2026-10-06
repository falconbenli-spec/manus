-- استحقاق الإجازات ومزايا الموظفين.
-- القاعدة الحاكمة: لا مدة استحقاق ولا نسبة ولا سقف ترحيل في الكود ولا في المخطط.
-- كل قاعدة سياسة مؤرخة بمصدرها يعتمدها مدير الموارد البشرية (hr.policy.accept)، والرصيد مشتق من حركات مقيدة بمصدرها.
CREATE TABLE leave_accrual_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  leave_type TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  accrual_unit TEXT NOT NULL CHECK(accrual_unit IN ('month','year')),
  accrual_milli INTEGER NOT NULL CHECK(accrual_milli>0),
  accrual_start TEXT NOT NULL CHECK(accrual_start IN ('hire','after_period')),
  waiting_days INTEGER NOT NULL CHECK(waiting_days>=0),
  carryover_allowed INTEGER NOT NULL CHECK(carryover_allowed IN (0,1)),
  carryover_cap_milli INTEGER CHECK(carryover_cap_milli IS NULL OR carryover_cap_milli>=0),
  cash_on_end_of_service INTEGER NOT NULL CHECK(cash_on_end_of_service IN (0,1)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  basis_confirmed_on TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),
  prepared_by TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,leave_type,effective_from),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((accrual_start='after_period')=(waiting_days>0)),
  CHECK((carryover_allowed=1)=(carryover_cap_milli IS NOT NULL))
) STRICT;
-- من أعدّ لا يعتمد، والمعتمد لا يُعدّل: التصحيح سياسة جديدة بتاريخ سريان جديد.
CREATE TRIGGER leave_accrual_policies_fixed BEFORE UPDATE ON leave_accrual_policies
WHEN OLD.status<>'draft' OR NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
  OR (NEW.status<>'draft' AND (NEW.leave_type<>OLD.leave_type OR NEW.accrual_unit<>OLD.accrual_unit OR NEW.accrual_milli<>OLD.accrual_milli OR NEW.effective_from<>OLD.effective_from OR NEW.body<>OLD.body OR NEW.basis<>OLD.basis))
BEGIN SELECT RAISE(ABORT,'an accepted accrual policy is replaced by a new dated policy, not edited'); END;
CREATE TRIGGER leave_accrual_policies_no_delete BEFORE DELETE ON leave_accrual_policies
BEGIN SELECT RAISE(ABORT,'accrual policies are retained'); END;

-- تشغيل مؤرخ يقيّد استحقاق فترة أو يرحّلها أو ينهي صلاحيتها. لا شيء منها يجري آليًا في الخفاء.
CREATE TABLE accrual_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('accrual','carryover','expiry')),
  leave_type TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL CHECK(period_to>=period_from),
  run_date TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  employees INTEGER NOT NULL CHECK(employees>=0),
  days_milli INTEGER NOT NULL,
  skipped TEXT NOT NULL CHECK(json_valid(skipped)),
  accepted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,kind,leave_type,period_key),
  FOREIGN KEY(policy_id,tenant_id) REFERENCES leave_accrual_policies(id,tenant_id),
  FOREIGN KEY(accepted_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER accrual_runs_no_update BEFORE UPDATE ON accrual_runs
BEGIN SELECT RAISE(ABORT,'an accrual run is immutable; re-running the same period changes nothing'); END;
CREATE TRIGGER accrual_runs_no_delete BEFORE DELETE ON accrual_runs
BEGIN SELECT RAISE(ABORT,'accrual runs are retained'); END;
CREATE TRIGGER accrual_runs_need_policy BEFORE INSERT ON accrual_runs
WHEN NOT EXISTS(SELECT 1 FROM leave_accrual_policies p WHERE p.id=NEW.policy_id AND p.tenant_id=NEW.tenant_id AND p.leave_type=NEW.leave_type AND p.status='accepted' AND p.effective_from<=NEW.period_to)
BEGIN SELECT RAISE(ABORT,'an accrual run needs a policy accepted by the HR manager and effective in its period'); END;

-- دفتر الحركات: الرصيد مشتق منه سطرًا سطرًا، ولكل سطر مصدره ومن اعتمده.
CREATE TABLE leave_accrual_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  balance_year INTEGER NOT NULL CHECK(balance_year BETWEEN 2000 AND 2200),
  kind TEXT NOT NULL CHECK(kind IN ('accrual','carryover_in','carryover_out','expiry','adjustment')),
  days_milli INTEGER NOT NULL CHECK(days_milli<>0),
  period_key TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  run_id TEXT,
  policy_id TEXT,
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  approved_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(run_id,tenant_id) REFERENCES accrual_runs(id,tenant_id),
  FOREIGN KEY(policy_id,tenant_id) REFERENCES leave_accrual_policies(id,tenant_id),
  CHECK((kind='adjustment')=(run_id IS NULL)),
  CHECK(kind<>'accrual' OR days_milli>0),
  CHECK(kind<>'carryover_in' OR days_milli>0),
  CHECK(kind<>'carryover_out' OR days_milli<0),
  CHECK(kind<>'expiry' OR days_milli<0),
  CHECK(run_id IS NOT NULL OR approved_by<>employee_id)
) STRICT;
-- إعادة تشغيل الفترة نفسها لا تكرر حركة: المفتاح موظف + نوع + حركة + فترة.
CREATE UNIQUE INDEX leave_accrual_run_once ON leave_accrual_entries(tenant_id,employee_id,leave_type,kind,period_key) WHERE run_id IS NOT NULL;
CREATE INDEX leave_accrual_scope ON leave_accrual_entries(tenant_id,employee_id,leave_type,balance_year,seq);
CREATE TRIGGER leave_accrual_entries_no_update BEFORE UPDATE ON leave_accrual_entries
BEGIN SELECT RAISE(ABORT,'the accrual ledger is append only; correct it with a reasoned adjustment'); END;
CREATE TRIGGER leave_accrual_entries_no_delete BEFORE DELETE ON leave_accrual_entries
BEGIN SELECT RAISE(ABORT,'the accrual ledger is append only'); END;
CREATE TRIGGER leave_accrual_not_negative BEFORE INSERT ON leave_accrual_entries
WHEN NEW.days_milli<0 AND (SELECT COALESCE(SUM(days_milli),0) FROM leave_accrual_entries WHERE tenant_id=NEW.tenant_id AND employee_id=NEW.employee_id AND leave_type=NEW.leave_type AND balance_year=NEW.balance_year)+NEW.days_milli<0
BEGIN SELECT RAISE(ABORT,'accrued leave cannot go negative'); END;

-- التأمين الطبي: وثيقة جماعية تُسجَّل كما هي لدى شركة التأمين. المنصة لا تتصل بأي شركة تأمين.
CREATE TABLE medical_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  insurer_name TEXT NOT NULL CHECK(length(trim(insurer_name))>=2),
  policy_number TEXT NOT NULL CHECK(length(trim(policy_number))>=2),
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL CHECK(effective_to>effective_from),
  tiers TEXT NOT NULL CHECK(json_valid(tiers) AND json_array_length(tiers)>0),
  renewal_notice_days INTEGER NOT NULL CHECK(renewal_notice_days BETWEEN 1 AND 365),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,policy_number),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER medical_policies_identity BEFORE UPDATE ON medical_policies
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'medical policy identity is immutable'); END;
CREATE TRIGGER medical_policies_no_delete BEFORE DELETE ON medical_policies
BEGIN SELECT RAISE(ABORT,'medical policies are retained'); END;

-- تسجيل الموظف في الوثيقة: الإضافة والحذف يجريان لدى شركة التأمين خارج المنصة، والمنصة تسجلهما وتذكّر.
CREATE TABLE medical_enrolments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  member_reference TEXT NOT NULL DEFAULT '',
  requested_on TEXT NOT NULL,
  confirmed_on TEXT,
  removed_on TEXT,
  removal_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('requested','active','removed')),
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(policy_id,tenant_id) REFERENCES medical_policies(id,tenant_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>employee_id),
  CHECK((status='requested' AND confirmed_on IS NULL AND removed_on IS NULL)
    OR (status='active' AND confirmed_on IS NOT NULL AND removed_on IS NULL)
    OR (status='removed' AND removed_on IS NOT NULL AND length(trim(removal_reason))>=3))
) STRICT;
CREATE UNIQUE INDEX medical_enrolment_open ON medical_enrolments(policy_id,employee_id) WHERE status<>'removed';
CREATE TRIGGER medical_enrolments_identity BEFORE UPDATE ON medical_enrolments
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.policy_id<>OLD.policy_id OR NEW.employee_id<>OLD.employee_id OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
  OR OLD.status='removed' OR NOT ((OLD.status='requested' AND NEW.status IN ('requested','active','removed')) OR (OLD.status='active' AND NEW.status IN ('active','removed')))
BEGIN SELECT RAISE(ABORT,'a removed enrolment is re-recorded, not edited'); END;
CREATE TRIGGER medical_enrolments_no_delete BEFORE DELETE ON medical_enrolments
BEGIN SELECT RAISE(ABORT,'enrolment history is retained'); END;

-- تابعو الموظف: صلة القرابة وتاريخ الميلاد فقط.
-- لا اسم ولا هوية ولا حقل نصي حر هنا، ولا أي بيان طبي: لا تشخيص ولا مطالبة ولا حالة صحية.
-- هذه بيانات شخصية لطرف ثالث؛ لا يراها إلا حامل hr.benefits.manage ولا تدخل تقريرًا ولا تصديرًا.
CREATE TABLE medical_dependants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  enrolment_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('spouse','child','parent','other')),
  birth_date TEXT NOT NULL,
  added_on TEXT NOT NULL,
  removed_on TEXT,
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(enrolment_id,tenant_id) REFERENCES medical_enrolments(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX medical_dependants_scope ON medical_dependants(tenant_id,enrolment_id);
CREATE TRIGGER medical_dependants_removal_only BEFORE UPDATE ON medical_dependants
WHEN NEW.version<>OLD.version+1 OR OLD.removed_on IS NOT NULL OR NEW.removed_on IS NULL
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.enrolment_id<>OLD.enrolment_id OR NEW.relation<>OLD.relation OR NEW.birth_date<>OLD.birth_date OR NEW.added_on<>OLD.added_on OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a dependant record is only closed by a removal date'); END;
CREATE TRIGGER medical_dependants_no_delete BEFORE DELETE ON medical_dependants
BEGIN SELECT RAISE(ABORT,'dependant history is retained'); END;
CREATE TRIGGER medical_dependants_open_enrolment BEFORE INSERT ON medical_dependants
WHEN NOT EXISTS(SELECT 1 FROM medical_enrolments e WHERE e.id=NEW.enrolment_id AND e.tenant_id=NEW.tenant_id AND e.status<>'removed')
BEGIN SELECT RAISE(ABORT,'dependants belong to an open enrolment'); END;
