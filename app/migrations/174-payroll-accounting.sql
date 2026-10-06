-- الحزمة 4 (P4-HR-3): محاسبة الرواتب — مركز تكلفة الإدارة، وصرف السلفة.
--
-- (1) مركز تكلفة كل إدارة، مؤرَّخ، بيدين. كان قيد المسير يضع مصروف الرواتب كله على مركز واحد (مركز ربط غرض «مصروف الرواتب»)،
--     فلا تُعرف تكلفة الإدارة من الدفتر. صار سطر الموظف يذهب إلى مركز إدارته في آخر يوم من شهر المسير (orgOn في app/employees.mjs)،
--     والإدارة إلى مركزها من هذا الجدول: صفٌّ يسجّله حامل تفويض الإعداد المالي ويعتمده أو يرفضه شخص ثانٍ يحمل تفويض الاعتماد.
--     المعتمد لا يُعدَّل: تغيير مركز الإدارة صفٌّ جديد بتاريخ سريانه، ويبقى القديم يحكم ما قبله. وإدارةٌ بلا مركز معتمد سارٍ في
--     آخر الشهر تمنع بناء قيد المسير برفضٍ يسمّيها ومالك سدّها (department_cost_centre_missing)، ولا يُخمَّن لها مركز.
CREATE TABLE department_cost_centres (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  cost_center_id TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  recorded_by TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(cost_center_id,tenant_id) REFERENCES finance_cost_centers(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>recorded_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK((decided_by IS NULL)=(decided_at IS NULL)),
  CHECK(status='pending' OR length(trim(decision_note))>=3)
) STRICT;
-- ربطٌ واحد ينتظر القرار لكل إدارة: الثاني يُسجَّل بعد حسم الأول (اعتمادًا أو رفضًا)، فلا يقف بندان متعارضان أمام المعتمد.
CREATE UNIQUE INDEX department_cost_centres_one_pending ON department_cost_centres(tenant_id,department_id) WHERE status='pending';
CREATE INDEX department_cost_centres_live ON department_cost_centres(tenant_id,department_id,status,effective_from);
CREATE TRIGGER department_cost_centres_fixed BEFORE UPDATE ON department_cost_centres
WHEN OLD.status<>'pending' OR NEW.status='pending'
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.department_id<>OLD.department_id OR NEW.cost_center_id<>OLD.cost_center_id
  OR NEW.effective_from<>OLD.effective_from OR NEW.reason<>OLD.reason OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a department cost centre is decided once by a second person; a change is a new dated row'); END;
CREATE TRIGGER department_cost_centres_no_delete BEFORE DELETE ON department_cost_centres
BEGIN SELECT RAISE(ABORT,'department cost centres are retained'); END;

-- (2) صرف السلفة. كانت السلفة تُقترح وتُعتمد وتُسترد أقساطها من المسير، ولا يُسجَّل في أي موضع أنها صُرفت ولا متى ولا بأي مرجع،
--     فلا قيد لها: الأقساط تُخفّض «سلف الموظفين» في الدفتر ولم يرفعها شيء. صار الصرف حدثًا يُسجَّل مرة واحدة على سلفة معتمدة:
--     تاريخه (لا يسبق يوم اعتمادها بتوقيت الرياض) ومرجعه البنكي ودليله، بيد غير صاحب السلفة وغير مقترحها وغير معتمدها،
--     وهو مستند نوع «صرف سلفة» في الدفتر (app/payroll-ledger.mjs).
ALTER TABLE salary_advances ADD COLUMN disbursed_on TEXT CHECK(disbursed_on IS NULL OR disbursed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE salary_advances ADD COLUMN disbursement_reference TEXT;
ALTER TABLE salary_advances ADD COLUMN disbursement_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE salary_advances ADD COLUMN disbursed_by TEXT REFERENCES users(id);
ALTER TABLE salary_advances ADD COLUMN disbursement_recorded_at TEXT;
-- المقرَّرة نهائية كما كانت؛ الشيء الوحيد الذي يُضاف بعد الاعتماد صرفُها، مرة واحدة، كاملًا. والمقترحة لا تُصرف.
DROP TRIGGER salary_advances_fixed;
CREATE TRIGGER salary_advances_fixed BEFORE UPDATE ON salary_advances
WHEN NEW.amount_minor<>OLD.amount_minor OR NEW.installments<>OLD.installments OR NEW.user_id<>OLD.user_id OR NEW.first_month<>OLD.first_month
  OR (OLD.status='proposed' AND (NEW.disbursed_on IS NOT NULL OR NEW.disbursed_by IS NOT NULL OR NEW.disbursement_reference IS NOT NULL OR NEW.disbursement_recorded_at IS NOT NULL OR NEW.disbursement_evidence<>''))
  OR (OLD.status<>'proposed' AND (OLD.status<>'approved' OR OLD.disbursed_on IS NOT NULL OR NEW.disbursed_on IS NULL
    OR NEW.status<>OLD.status OR NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at OR NEW.decision_note<>OLD.decision_note
    OR NEW.reason<>OLD.reason OR NEW.proposed_by<>OLD.proposed_by OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at))
BEGIN SELECT RAISE(ABORT,'a decided advance is final; only the payout of an approved advance is recorded, once'); END;
CREATE TRIGGER salary_advances_payout_shape BEFORE UPDATE ON salary_advances
WHEN NEW.disbursed_on IS NOT NULL AND (NEW.disbursement_reference IS NULL OR length(trim(NEW.disbursement_reference))<3
  OR length(trim(NEW.disbursement_evidence))<10 OR NEW.disbursed_by IS NULL OR NEW.disbursement_recorded_at IS NULL
  OR NEW.disbursed_by IN (NEW.user_id,NEW.proposed_by,NEW.decided_by)
  OR NEW.disbursed_on<date(NEW.decided_at,'+3 hours'))
BEGIN SELECT RAISE(ABORT,'an advance payout is recorded whole, on or after its approval day, by someone other than the employee, its proposer and its approver'); END;
CREATE TRIGGER salary_advances_payout_insert BEFORE INSERT ON salary_advances
WHEN NEW.disbursed_on IS NOT NULL OR NEW.disbursed_by IS NOT NULL OR NEW.disbursement_reference IS NOT NULL OR NEW.disbursement_recorded_at IS NOT NULL OR NEW.disbursement_evidence<>''
BEGIN SELECT RAISE(ABORT,'an advance is paid out after it is approved, not when it is proposed'); END;
