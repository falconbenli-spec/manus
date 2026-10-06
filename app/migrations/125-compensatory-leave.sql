-- 125: الإجازة التعويضية عن ساعات العمل الإضافي (نظام العمل م107/1 كما عدلها المرسوم الملكي م/44، واللائحة التنفيذية م22 مكرر).
-- الأرقام النظامية (ساعة ونصف، 60 يومًا، 30 يومًا في السنة) لا تُكتب هنا: تسكن في كتلة compensatory من سياسة أنواع الإجازات
-- ولا تسري إلا باعتماد مدير الموارد البشرية (نمط 098 و099). هنا الدفاتر وقيودها فقط:
--   1) موافقة الموظف على الإجازة بدل الأجر: سجل ثابت بهويته ووقته ونص ما وافق عليه، ولا يكتبه أحد عنه.
--   2) دفتر الأرصدة (compensatory_credits): قيد واحد لكل طلب عمل إضافي معتمد اختار صاحبه الإجازة، بساعاته ومهلته.
--   3) دفتر الحركات (compensatory_movements): حجز وتحرير وخصم ورد على القيد نفسه، الأقدم أجلًا أولًا.
--   4) إحالات الصرف (compensatory_payouts): ما انقضت مهلته أو انتهت خدمة صاحبه يُقترح أجرًا إضافيًا في المسير بيد مُعد الرواتب.
-- لا شيء يُحذف ولا يُعدَّل في الجداول الأربعة، فما كسبه الموظف لا يختفي: إما إجازة مأخوذة أو أجر مقترح أو رصيد ظاهر.

-- اختيار التعويض هو موافقة الموظف (م107/1): لا يُقلب بعد تسجيله، لا إلى أجر ولا إلى إجازة. ترحيل 099 أضاف العمودين بلا تجميد.
CREATE TRIGGER overtime_requests_compensation_fixed BEFORE UPDATE ON overtime_requests
WHEN NEW.compensation<>OLD.compensation OR NEW.consent_at IS NOT OLD.consent_at
BEGIN SELECT RAISE(ABORT,'the compensation choice is the employee consent and is never rewritten'); END;

CREATE TABLE overtime_compensation_consents (
  overtime_request_id TEXT PRIMARY KEY REFERENCES overtime_requests(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES leave_type_policies(id),
  ratio_bp INTEGER NOT NULL CHECK(ratio_bp>=10000),
  use_within_days INTEGER NOT NULL CHECK(use_within_days BETWEEN 1 AND 366),
  overtime_minutes INTEGER NOT NULL CHECK(overtime_minutes>0),
  leave_minutes INTEGER NOT NULL,
  sentence TEXT NOT NULL CHECK(length(trim(sentence))>=40),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(leave_minutes>=overtime_minutes)
) STRICT;
CREATE INDEX overtime_compensation_consents_user ON overtime_compensation_consents(tenant_id,user_id);
-- الموافقة لصاحب الطلب وحده، وعلى طلبه الذي اختار فيه الإجازة، وبوقت الاختيار نفسه.
CREATE TRIGGER overtime_compensation_consents_own BEFORE INSERT ON overtime_compensation_consents
WHEN NOT EXISTS(SELECT 1 FROM overtime_requests o WHERE o.id=NEW.overtime_request_id AND o.tenant_id=NEW.tenant_id AND o.user_id=NEW.user_id
  AND o.compensation='time_off' AND o.consent_at=NEW.consent_at AND o.minutes=NEW.overtime_minutes)
BEGIN SELECT RAISE(ABORT,'compensatory consent belongs to the employee who recorded the overtime'); END;
-- INSERT OR REPLACE يحذف الصف القائم دون أن يُطلق مُشغِّل الحذف (recursive_triggers مطفأ في المنصة)، فيُعاد به كتابة موافقة مسجلة.
-- مُشغِّل ما قبل الإدراج يرى الصف القائم قبل حل التعارض فيرفض: الموافقة تُكتب مرة واحدة لكل طلب.
CREATE TRIGGER overtime_compensation_consents_once BEFORE INSERT ON overtime_compensation_consents
WHEN EXISTS(SELECT 1 FROM overtime_compensation_consents k WHERE k.overtime_request_id=NEW.overtime_request_id)
BEGIN SELECT RAISE(ABORT,'a recorded consent is immutable'); END;
CREATE TRIGGER overtime_compensation_consents_no_update BEFORE UPDATE ON overtime_compensation_consents BEGIN SELECT RAISE(ABORT,'a recorded consent is immutable'); END;
CREATE TRIGGER overtime_compensation_consents_no_delete BEFORE DELETE ON overtime_compensation_consents BEGIN SELECT RAISE(ABORT,'a recorded consent is retained'); END;

CREATE TABLE compensatory_credits (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  overtime_request_id TEXT NOT NULL UNIQUE REFERENCES overtime_requests(id),
  work_date TEXT NOT NULL CHECK(work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  overtime_minutes INTEGER NOT NULL CHECK(overtime_minutes>0),
  ratio_bp INTEGER NOT NULL CHECK(ratio_bp>=10000),
  leave_minutes INTEGER NOT NULL,
  expires_on TEXT NOT NULL CHECK(expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  policy_id TEXT NOT NULL REFERENCES leave_type_policies(id),
  -- legacy=1: طلب «وقت راحة بدل الأجر» اعتُمد قبل هذا الترحيل بلا قيد رصيد، فقيّده إنسان لاحقًا بالسياسة المعتمدة.
  legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1)),
  credited_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(credited_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(credited_by<>user_id),
  CHECK(leave_minutes>=overtime_minutes),
  CHECK(expires_on>=work_date)
) STRICT;
CREATE INDEX compensatory_credits_scope ON compensatory_credits(tenant_id,user_id,expires_on,seq);

CREATE TABLE compensatory_payouts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  credit_id TEXT NOT NULL REFERENCES compensatory_credits(id),
  cause TEXT NOT NULL CHECK(cause IN ('expired','service_ended')),
  leave_minutes INTEGER NOT NULL CHECK(leave_minutes>0),
  -- صفر في إحالة أخيرة جزئية استوفت سابقاتها كل الدقائق المعمولة بالجبر؛ مبلغها عندئذ من أجر الإجازة المستحقة.
  overtime_minutes INTEGER NOT NULL CHECK(overtime_minutes>=0),
  adjustment_id TEXT NOT NULL UNIQUE REFERENCES payroll_adjustments(id),
  suggested_minor INTEGER CHECK(suggested_minor IS NULL OR suggested_minor>=0),
  proposed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>user_id),
  CHECK(overtime_minutes<=leave_minutes)
) STRICT;
CREATE INDEX compensatory_payouts_credit ON compensatory_payouts(credit_id);

CREATE TABLE compensatory_movements (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credit_id TEXT NOT NULL REFERENCES compensatory_credits(id),
  request_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  kind TEXT NOT NULL CHECK(kind IN ('reserve','release','debit','refund')),
  used_minutes INTEGER NOT NULL,
  reserved_minutes INTEGER NOT NULL,
  -- أساس تحويل الأيام إلى ساعات يوم كُتبت الحركة: ساعات اليوم من سياسة ساعات العمل المعتمدة، ومعرّف تلك السياسة.
  daily_minutes INTEGER NOT NULL CHECK(daily_minutes BETWEEN 60 AND 720),
  working_time_policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,revision,kind,credit_id),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='reserve' AND used_minutes=0 AND reserved_minutes>0)
    OR (kind='release' AND used_minutes=0 AND reserved_minutes<0)
    OR (kind='debit' AND used_minutes>0 AND reserved_minutes=-used_minutes)
    OR (kind='refund' AND used_minutes<0 AND reserved_minutes=0))
) STRICT;
CREATE INDEX compensatory_movements_credit ON compensatory_movements(credit_id,seq);
CREATE INDEX compensatory_movements_request ON compensatory_movements(request_id,revision);

-- القيد لا يُكتب إلا عن طلب عمل إضافي معتمد اختار صاحبه الإجازة، وبدقائقه ويومه كما هي.
CREATE TRIGGER compensatory_credits_source BEFORE INSERT ON compensatory_credits
WHEN NOT EXISTS(SELECT 1 FROM overtime_requests o WHERE o.id=NEW.overtime_request_id AND o.tenant_id=NEW.tenant_id AND o.user_id=NEW.user_id
  AND o.status='approved' AND o.compensation='time_off' AND o.minutes=NEW.overtime_minutes AND o.work_date=NEW.work_date)
BEGIN SELECT RAISE(ABORT,'a compensatory credit needs an approved overtime request compensated by leave'); END;
-- والقيد كذلك: لا يُستبدل بـINSERT OR REPLACE قيد قائم بمعرّفه أو بطلبه أو برقمه التسلسلي.
CREATE TRIGGER compensatory_credits_once BEFORE INSERT ON compensatory_credits
WHEN EXISTS(SELECT 1 FROM compensatory_credits c WHERE c.id=NEW.id OR c.overtime_request_id=NEW.overtime_request_id OR c.seq=NEW.seq)
BEGIN SELECT RAISE(ABORT,'compensatory credits are append only'); END;
CREATE TRIGGER compensatory_credits_no_update BEFORE UPDATE ON compensatory_credits BEGIN SELECT RAISE(ABORT,'compensatory credits are append only'); END;
CREATE TRIGGER compensatory_credits_no_delete BEFORE DELETE ON compensatory_credits BEGIN SELECT RAISE(ABORT,'compensatory credits are append only'); END;

-- الحركة على قيد صاحبها، ولطلب إجازة صاحبها نفسه.
CREATE TRIGGER compensatory_movements_owner BEFORE INSERT ON compensatory_movements
WHEN NOT EXISTS(SELECT 1 FROM compensatory_credits c WHERE c.id=NEW.credit_id AND c.tenant_id=NEW.tenant_id AND c.user_id=NEW.user_id)
  OR NOT EXISTS(SELECT 1 FROM leave_requests r WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'a compensatory movement stays on its owner credit and leave request'); END;
-- القيد لا يُسحب منه أكثر مما بقي فيه: ساعاته ناقص المستعمل والمحجوز وما أُحيل إلى المسير ولم يُرفض.
CREATE TRIGGER compensatory_movements_not_overdrawn BEFORE INSERT ON compensatory_movements
WHEN NEW.kind='reserve' AND (SELECT leave_minutes FROM compensatory_credits WHERE id=NEW.credit_id)
  -(SELECT COALESCE(SUM(used_minutes+reserved_minutes),0) FROM compensatory_movements WHERE credit_id=NEW.credit_id)
  -(SELECT COALESCE(SUM(p.leave_minutes),0) FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.credit_id=NEW.credit_id AND a.status<>'rejected')
  <NEW.reserved_minutes
BEGIN SELECT RAISE(ABORT,'a compensatory credit cannot be overdrawn'); END;
CREATE TRIGGER compensatory_movements_reserved_nonnegative BEFORE INSERT ON compensatory_movements
WHEN (SELECT COALESCE(SUM(reserved_minutes),0) FROM compensatory_movements WHERE request_id=NEW.request_id AND credit_id=NEW.credit_id)+NEW.reserved_minutes<0
BEGIN SELECT RAISE(ABORT,'a compensatory reservation cannot be negative'); END;
CREATE TRIGGER compensatory_movements_refund_requires_debit BEFORE INSERT ON compensatory_movements
WHEN NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM compensatory_movements m WHERE m.request_id=NEW.request_id AND m.credit_id=NEW.credit_id AND m.kind='debit' AND m.used_minutes=-NEW.used_minutes)
BEGIN SELECT RAISE(ABORT,'a compensatory refund requires a matching debit'); END;
CREATE TRIGGER compensatory_movements_once BEFORE INSERT ON compensatory_movements
WHEN EXISTS(SELECT 1 FROM compensatory_movements m WHERE m.id=NEW.id OR m.seq=NEW.seq OR (m.request_id=NEW.request_id AND m.revision=NEW.revision AND m.kind=NEW.kind AND m.credit_id=NEW.credit_id))
BEGIN SELECT RAISE(ABORT,'compensatory movements are append only'); END;
CREATE TRIGGER compensatory_movements_no_update BEFORE UPDATE ON compensatory_movements BEGIN SELECT RAISE(ABORT,'compensatory movements are append only'); END;
CREATE TRIGGER compensatory_movements_no_delete BEFORE DELETE ON compensatory_movements BEGIN SELECT RAISE(ABORT,'compensatory movements are append only'); END;

-- الإحالة إلى المسير: حركة «عمل إضافي» لصاحب القيد نفسه، ولا تتجاوز ما بقي في القيد.
CREATE TRIGGER compensatory_payouts_source BEFORE INSERT ON compensatory_payouts
WHEN NOT EXISTS(SELECT 1 FROM compensatory_credits c WHERE c.id=NEW.credit_id AND c.tenant_id=NEW.tenant_id AND c.user_id=NEW.user_id)
  OR NOT EXISTS(SELECT 1 FROM payroll_adjustments a WHERE a.id=NEW.adjustment_id AND a.tenant_id=NEW.tenant_id AND a.user_id=NEW.user_id AND a.kind='overtime')
BEGIN SELECT RAISE(ABORT,'a compensatory payout is an overtime movement for the credit owner'); END;
CREATE TRIGGER compensatory_payouts_not_overdrawn BEFORE INSERT ON compensatory_payouts
WHEN (SELECT leave_minutes FROM compensatory_credits WHERE id=NEW.credit_id)
  -(SELECT COALESCE(SUM(used_minutes+reserved_minutes),0) FROM compensatory_movements WHERE credit_id=NEW.credit_id)
  -(SELECT COALESCE(SUM(p.leave_minutes),0) FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.credit_id=NEW.credit_id AND a.status<>'rejected')
  <NEW.leave_minutes
BEGIN SELECT RAISE(ABORT,'a compensatory payout cannot exceed what is left in the credit'); END;
-- مجموع ما يُرد من القيد إلى ساعات عمل إضافي في إحالاته غير المرفوضة لا يتجاوز ما عُمل: الجبر في كل إحالة لا يزيد دقيقة على الساعات الأصلية.
CREATE TRIGGER compensatory_payouts_overtime_ceiling BEFORE INSERT ON compensatory_payouts
WHEN (SELECT COALESCE(SUM(p.overtime_minutes),0) FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.credit_id=NEW.credit_id AND a.status<>'rejected')+NEW.overtime_minutes
  >(SELECT overtime_minutes FROM compensatory_credits WHERE id=NEW.credit_id)
BEGIN SELECT RAISE(ABORT,'compensatory payouts cannot return more overtime than was worked'); END;
CREATE TRIGGER compensatory_payouts_once BEFORE INSERT ON compensatory_payouts
WHEN EXISTS(SELECT 1 FROM compensatory_payouts p WHERE p.id=NEW.id OR p.adjustment_id=NEW.adjustment_id)
BEGIN SELECT RAISE(ABORT,'compensatory payouts are append only'); END;
CREATE TRIGGER compensatory_payouts_no_update BEFORE UPDATE ON compensatory_payouts BEGIN SELECT RAISE(ABORT,'compensatory payouts are append only'); END;
CREATE TRIGGER compensatory_payouts_no_delete BEFORE DELETE ON compensatory_payouts BEGIN SELECT RAISE(ABORT,'compensatory payouts are append only'); END;

-- مصدر رصيد جديد لشروط الطلب: «overtime» (ساعات العمل الإضافي). قيد CHECK في 098 يحصر المصادر في أربعة، والجدول STRICT
-- لا يُوسَّع قيده في مكانه، فيُعاد بناؤه مرة واحدة بالأعمدة والقيود نفسها وصفوفه كما هي. لا جدول آخر يحيل إليه،
-- ومشغّلاه وفهرسه يُسقطان مع الأصل ويُعادان على الجديد. دفتر الأيام leave_day_ledger لا يُمس: رصيد الساعات له دفتره أعلاه.
ALTER TABLE leave_request_terms RENAME TO leave_request_terms_v098;
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
  source TEXT NOT NULL CHECK(source IN ('opening','accrual','entitlement','none','overtime')),
  route TEXT NOT NULL CHECK(route IN ('manager_hr','manager_authority_hr')),
  pay_json TEXT NOT NULL CHECK(json_valid(pay_json)),
  document_required INTEGER NOT NULL CHECK(document_required IN (0,1)),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id,revision),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  CHECK(half_day=0 OR days_milli=500)
) STRICT;
INSERT INTO leave_request_terms SELECT request_id,revision,tenant_id,leave_type,policy_id,unit,days_milli,counted_dates_json,half_day,variant,event_date,source,route,pay_json,document_required,warnings_json,created_at FROM leave_request_terms_v098;
DROP TABLE leave_request_terms_v098;
CREATE INDEX leave_request_terms_type ON leave_request_terms(tenant_id,leave_type);
CREATE TRIGGER leave_request_terms_no_update BEFORE UPDATE ON leave_request_terms BEGIN SELECT RAISE(ABORT,'leave request terms are immutable'); END;
CREATE TRIGGER leave_request_terms_no_delete BEFORE DELETE ON leave_request_terms BEGIN SELECT RAISE(ABORT,'leave request terms are immutable'); END;
