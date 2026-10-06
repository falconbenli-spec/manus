-- الحزمة 4 (P4-HR-4): عكس المسير المعتمد، وتحويله وملف حماية الأجور مرة واحدة من مصدر واحد.
--
-- (1) عكس المسير المعتمد. كان المسير المعتمد لا يُمس أبدًا (مُطلِق payroll_runs_locked)، فمسيرٌ اعتُمد بخطأ قبل صرفه ليس له
--     طريق إلا أن يُصرف خطؤه ثم يُصحَّح أثرًا رجعيًا في شهر لاحق. صار للمسير المعتمد حالة «منعكس» (reversed) بمستند عكس مستقل
--     (payroll_run_reversals): يطلبه حامل إعداد الرواتب أو اعتمادها بسبب مكتوب، ويعتمده أو يرفضه حامل اعتماد غيره، وقبل أي تحويل
--     منفّذ لذلك المسير وقبل أي رفع موثَّق لملف أجوره (D6) — والشرطان في القاعدة نفسها لا في الكود وحده. المسير لا يُعدَّل ولا يُحذف:
--     ينتقل إلى «منعكس» حين يوجد عكسٌ معتمد له، وما سوى ذلك مقفل كما كان. والشهر يتحرر لمسير مصحَّح (الفهرس الحي يستثني المنعكس).
--
--     إعادة بناء payroll_runs لأن قيد الحالة (CHECK) لا يُعدَّل في مكانه. ستة جداول تحيل إليه بالاسم: payroll_lines وpayroll_adjustments
--     وpayroll_payments وpayroll_retro وleave_pay_effect_refunds وwps_exports — ولا واحد منها بـON DELETE CASCADE أو SET NULL
--     (tests/migration-175.test.mjs يعدّها ويتحقق من ذلك قبل البناء). فيُعاد البناء بالاسم نفسه على نمط 127 و144: نسخة مؤقتة، ثم
--     إسقاط، ثم إنشاء باسمه، ثم إعادة الصفوف؛ وdefer_foreign_keys يؤجل مخالفات الأبناء إلى الإغلاق فتُغلقها إعادة الصفوف بمعرّفاتها.
--     الإسقاط الضمني لا يُطلق المُطلِقات، ويسقط معه مُطلِقا الجدول وفهرسه فيُعادان هنا. ومُطلِقات الأبناء التي تقرأ payroll_runs في
--     جسمها تبقى كما هي، إلا payroll_adjustments_fixed فيُعاد ليُحرَّر حركات المسير المنعكس كما تُحرَّر حركات الملغى.
PRAGMA defer_foreign_keys=ON;

CREATE TEMP TABLE payroll_runs_carry AS SELECT * FROM payroll_runs;
DROP TRIGGER payroll_runs_locked;
DROP TRIGGER payroll_runs_no_delete;
DROP INDEX payroll_runs_one_live;
DROP TABLE payroll_runs;

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  cycle_policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  status TEXT NOT NULL CHECK(status IN ('draft','in_review','reviewed','approved','cancelled','reversed')),
  headcount INTEGER NOT NULL CHECK(headcount>=0),
  gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  deductions_minor INTEGER NOT NULL CHECK(deductions_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor=gross_minor-deductions_minor),
  prepared_by TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  inputs_digest TEXT,
  inputs_parts TEXT,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),
  CHECK(approved_by IS NULL OR (approved_by<>prepared_by AND approved_by<>reviewed_by)),
  CHECK(status NOT IN ('reviewed','approved','reversed') OR reviewed_by IS NOT NULL),
  -- المنعكس اعتُمد قبل أن يُعكس: يحمل معتمده كما حمله.
  CHECK((status IN ('approved','reversed'))=(approved_by IS NOT NULL))
) STRICT;
INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,reviewed_by,reviewed_at,review_note,approved_by,approved_at,decision_note,version,created_at,updated_at,inputs_digest,inputs_parts)
SELECT id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,reviewed_by,reviewed_at,review_note,approved_by,approved_at,decision_note,version,created_at,updated_at,inputs_digest,inputs_parts
FROM payroll_runs_carry;
DROP TABLE payroll_runs_carry;
-- مسيرٌ حيٌّ واحد للشهر: الملغى والمنعكس لا يحجزان الشهر عن مسيره المصحَّح.
CREATE UNIQUE INDEX payroll_runs_one_live ON payroll_runs(tenant_id,month) WHERE status NOT IN ('cancelled','reversed');

-- مستند العكس: يُطلب لمسير معتمد بشهره وصافيه كما هما، وينتظر قرار شخص ثانٍ، ويُقرَّر مرة. عكسٌ حيٌّ واحد للمسير.
CREATE TABLE payroll_run_reversals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  net_minor INTEGER NOT NULL CHECK(net_minor>=0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  -- يوم الرياض الذي اعتُمد فيه العكس: يُقرأ في السجل والإشعار. والقيد يعكس قيد المسير بتاريخه هو (آخر الشهر).
  reversed_on TEXT CHECK(reversed_on IS NULL OR reversed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='requested')=(decided_by IS NULL)),
  CHECK((decided_by IS NULL)=(decided_at IS NULL)),
  CHECK(status='requested' OR length(trim(decision_note))>=10),
  CHECK((status='approved')=(reversed_on IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX payroll_run_reversals_live ON payroll_run_reversals(run_id) WHERE status IN ('requested','approved');
CREATE INDEX payroll_run_reversals_tenant ON payroll_run_reversals(tenant_id,status);
CREATE TRIGGER payroll_run_reversals_shape BEFORE INSERT ON payroll_run_reversals
WHEN NEW.status<>'requested'
  OR NOT EXISTS(SELECT 1 FROM payroll_runs r WHERE r.id=NEW.run_id AND r.tenant_id=NEW.tenant_id AND r.status='approved' AND r.month=NEW.month AND r.net_minor=NEW.net_minor)
BEGIN SELECT RAISE(ABORT,'a reversal is requested for an approved run of its own tenant, with its month and net as they are, and waits for a second person'); END;
-- D6 في القاعدة: لا عكس بعد تحويلٍ منفّذ أو رفعٍ موثَّق — لا عند الطلب ولا عند الاعتماد.
CREATE TRIGGER payroll_run_reversals_before_payment BEFORE INSERT ON payroll_run_reversals
WHEN EXISTS(SELECT 1 FROM payroll_payments p WHERE p.run_id=NEW.run_id AND p.status='executed')
  OR EXISTS(SELECT 1 FROM wps_exports e WHERE e.run_id=NEW.run_id AND e.uploaded_on IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'a payroll run is reversed only before any transfer of it is executed and before any wage file of it is recorded as uploaded'); END;
CREATE TRIGGER payroll_run_reversals_approved_before_payment BEFORE UPDATE ON payroll_run_reversals
WHEN NEW.status='approved' AND (EXISTS(SELECT 1 FROM payroll_payments p WHERE p.run_id=NEW.run_id AND p.status='executed')
  OR EXISTS(SELECT 1 FROM wps_exports e WHERE e.run_id=NEW.run_id AND e.uploaded_on IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'a payroll run is reversed only before any transfer of it is executed and before any wage file of it is recorded as uploaded'); END;
CREATE TRIGGER payroll_run_reversals_decided BEFORE UPDATE ON payroll_run_reversals
WHEN OLD.status<>'requested' OR NEW.status='requested' OR NEW.version<>OLD.version+1
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.run_id<>OLD.run_id OR NEW.month<>OLD.month OR NEW.net_minor<>OLD.net_minor
  OR NEW.reason<>OLD.reason OR NEW.requested_by<>OLD.requested_by OR NEW.requested_at<>OLD.requested_at
BEGIN SELECT RAISE(ABORT,'a reversal is decided once, by someone other than its requester, and never rewritten'); END;
CREATE TRIGGER payroll_run_reversals_no_delete BEFORE DELETE ON payroll_run_reversals
BEGIN SELECT RAISE(ABORT,'payroll run reversals are retained'); END;

-- المسير المعتمد مقفل كما كان؛ تعديله الوحيد انتقاله إلى «منعكس» حين يوجد له عكس معتمد، ولا يتغيّر معه حرف آخر. والمنعكس نهائي.
CREATE TRIGGER payroll_runs_locked BEFORE UPDATE ON payroll_runs
WHEN OLD.status IN ('cancelled','reversed')
  OR (OLD.status='approved' AND (NEW.status<>'reversed'
    OR NOT EXISTS(SELECT 1 FROM payroll_run_reversals x WHERE x.run_id=OLD.id AND x.status='approved')
    OR NEW.headcount<>OLD.headcount OR NEW.gross_minor<>OLD.gross_minor OR NEW.deductions_minor<>OLD.deductions_minor OR NEW.net_minor<>OLD.net_minor
    OR NEW.cycle_policy_id<>OLD.cycle_policy_id OR NEW.reviewed_by IS NOT OLD.reviewed_by OR NEW.reviewed_at IS NOT OLD.reviewed_at OR NEW.review_note<>OLD.review_note
    OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at OR NEW.decision_note<>OLD.decision_note OR NEW.created_at<>OLD.created_at))
  OR (OLD.status<>'approved' AND NEW.status='reversed')
  OR NEW.version<>OLD.version+1 OR NEW.month<>OLD.month OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
  OR (OLD.status<>'draft' AND (NEW.gross_minor<>OLD.gross_minor OR NEW.deductions_minor<>OLD.deductions_minor OR NEW.headcount<>OLD.headcount
    OR NEW.inputs_digest IS NOT OLD.inputs_digest OR NEW.inputs_parts IS NOT OLD.inputs_parts))
  OR (NEW.inputs_parts IS NOT NULL AND NOT json_valid(NEW.inputs_parts))
BEGIN SELECT RAISE(ABORT,'an approved payroll run is locked: it changes only by moving to reversed under an approved reversal, and its totals and the digest of its inputs change only in draft'); END;
CREATE TRIGGER payroll_runs_no_delete BEFORE DELETE ON payroll_runs BEGIN SELECT RAISE(ABORT,'payroll runs are retained'); END;

-- حركات المسير المنعكس تتحرر لمسيره المصحَّح كما تتحرر حركات الملغى؛ وحركة مسير معتمد أو قيد المراجعة تبقى معه.
DROP TRIGGER payroll_adjustments_fixed;
CREATE TRIGGER payroll_adjustments_fixed BEFORE UPDATE ON payroll_adjustments
WHEN NEW.amount_minor<>OLD.amount_minor OR NEW.kind<>OLD.kind OR NEW.user_id<>OLD.user_id OR NEW.month<>OLD.month OR NEW.reason<>OLD.reason
  OR (OLD.status<>'proposed' AND NEW.status<>OLD.status)
  OR (OLD.run_id IS NOT NULL AND NEW.run_id IS NOT OLD.run_id AND (SELECT status FROM payroll_runs WHERE id=OLD.run_id) NOT IN ('draft','cancelled','reversed'))
BEGIN SELECT RAISE(ABORT,'a decided adjustment is final and stays with its locked run'); END;

-- (2) تحويل المسير. من اعتمد التحويل لا يسجّل تنفيذه (كان في الكود وحده)؛ والتحويل يُعدّ ويُعتمد ويُنفَّذ لمسير معتمد غير منعكس.
CREATE TRIGGER payroll_payments_executor BEFORE UPDATE ON payroll_payments
WHEN NEW.execution_recorded_by IS NOT NULL AND NEW.execution_recorded_by=NEW.approved_by
BEGIN SELECT RAISE(ABORT,'whoever approved a payroll transfer does not record its execution'); END;
CREATE TRIGGER payroll_payments_executor_insert BEFORE INSERT ON payroll_payments
WHEN NEW.execution_recorded_by IS NOT NULL AND NEW.execution_recorded_by=NEW.approved_by
BEGIN SELECT RAISE(ABORT,'whoever approved a payroll transfer does not record its execution'); END;
CREATE TRIGGER payroll_payments_live_run BEFORE INSERT ON payroll_payments
WHEN (SELECT status FROM payroll_runs WHERE id=NEW.run_id) IS NOT 'approved'
BEGIN SELECT RAISE(ABORT,'a payroll transfer is prepared, approved and executed only for an approved run that is not reversed'); END;
CREATE TRIGGER payroll_payments_live_run_update BEFORE UPDATE ON payroll_payments
WHEN NEW.status IN ('pending','approved','executed') AND (SELECT status FROM payroll_runs WHERE id=NEW.run_id) IS NOT 'approved'
BEGIN SELECT RAISE(ABORT,'a payroll transfer is prepared, approved and executed only for an approved run that is not reversed'); END;

-- (3) ملف حماية الأجور نسخة امتثال تُرفع مرة للمسير، ويُصدَّر من تحويله المعتمد بمجموعه (D7): البنك يأخذ ملف التحويل، والجهة تأخذ نسخة
--     الامتثال من السطور نفسها. كان كل تصدير للمسير يستطيع أن يوثّق رفعًا (الفهرس 067 غير فريد)، والملف لا يرتبط بتحويل.
ALTER TABLE wps_exports ADD COLUMN payment_id TEXT REFERENCES payroll_payments(id);
CREATE UNIQUE INDEX wps_exports_one_upload ON wps_exports(run_id) WHERE uploaded_on IS NOT NULL;
DROP TRIGGER wps_exports_fixed;
CREATE TRIGGER wps_exports_fixed BEFORE UPDATE ON wps_exports
WHEN NEW.version<>OLD.version+1 OR OLD.uploaded_on IS NOT NULL
  OR NEW.run_id<>OLD.run_id OR NEW.format_id<>OLD.format_id OR NEW.file_digest<>OLD.file_digest
  OR NEW.total_minor<>OLD.total_minor OR NEW.headcount<>OLD.headcount OR NEW.exported_by<>OLD.exported_by OR NEW.checks<>OLD.checks
  OR NEW.payment_id IS NOT OLD.payment_id
BEGIN SELECT RAISE(ABORT,'an export keeps its digest and checks; the manual upload is recorded once'); END;
CREATE TRIGGER wps_exports_from_payment BEFORE INSERT ON wps_exports
WHEN NEW.payment_id IS NULL OR NOT EXISTS(SELECT 1 FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id
  WHERE p.id=NEW.payment_id AND p.run_id=NEW.run_id AND p.status IN ('approved','executed') AND p.amount_minor=NEW.total_minor AND r.status='approved')
BEGIN SELECT RAISE(ABORT,'a wage file is exported from the approved transfer of its approved run, for the same total'); END;
CREATE TRIGGER wps_exports_upload_live BEFORE UPDATE OF uploaded_on ON wps_exports
WHEN NEW.uploaded_on IS NOT NULL AND ((SELECT status FROM payroll_runs WHERE id=NEW.run_id) IS NOT 'approved'
  OR (NEW.payment_id IS NOT NULL AND (SELECT status FROM payroll_payments WHERE id=NEW.payment_id) NOT IN ('approved','executed')))
BEGIN SELECT RAISE(ABORT,'a wage file upload is recorded for an approved run and its live transfer only'); END;
