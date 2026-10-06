-- الحزمة 4 (P4-HR-5): المسير الموازي والانتقال إلى المنصة.
--
-- الشهر الموازي (قرار D10 الموصى به): النظام السابق هو دافع الشهر وسجلّه، والمنصة تحسب الشهر نفسه وتقارنه بندًا بندًا
-- وموظفًا موظفًا ولا تدفعه. فالشهر المعلن موازيًا لا يُعدّ له دفع من المنصة ولا ملف حماية أجور ولا قيد من مسيرها — في الكود
-- برفض مسمّى، وهنا في القاعدة أيضًا لأن الدفع مرتين ضرر على المال لا يُصحَّح بسهولة.
--
-- مصدر النظام السابق (D8): ملف البنك المدفوع ومعه الكشف التفصيلي، يُستوردان دفعةً واحدة لكل شهر ويؤكدها شخص غير من استوردها.
-- المقارنة سجلٌّ يُضاف ولا يُعدَّل، تحفظ بصمة مدخلات الاحتساب (الترحيل 173) لتُعرف قديمةً حين تتغيّر مدخلاتها. وكل فرق يفسّره
-- شخص ثانٍ: لا من قارن، ولا من استورد الدفعة، ولا صاحب الأجر نفسه. والانتقال يقرره شخصان بعد أن يعتمد المالك حدّ الفروق
-- وعدد الشهور (D9) — قيمتان بلا رقم في الكود (app/payroll-parallel.mjs).
--
-- كل جدول هنا تاريخ: لا حذف، والتعديل الوحيد المسموح انتقال حالة واحد بيد شخص ثانٍ يُكتب سببه.

CREATE TABLE payroll_parallel_months (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL DEFAULT 'declared' CHECK(status IN ('declared','withdrawn')),
  declared_by TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  withdrawn_by TEXT,
  withdrawn_at TEXT,
  withdrawal_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(declared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='declared')=(withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdrawal_note IS NULL)),
  CHECK(withdrawn_by IS NULL OR (withdrawn_by<>declared_by AND length(trim(withdrawal_note))>=10)),
  UNIQUE(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX payroll_parallel_months_live ON payroll_parallel_months(tenant_id,month) WHERE status='declared';

CREATE TABLE payroll_legacy_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  parallel_month_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=10),
  -- الملفان لا يُخزَّنان (ملف البنك يحمل آيبانات): بصمة كلٍّ منهما تثبت أي ملف أُكِّد، والأرقام في السطور.
  breakdown_digest TEXT NOT NULL CHECK(length(breakdown_digest)=64),
  bank_digest TEXT NOT NULL CHECK(length(bank_digest)=64),
  employer_share_included INTEGER NOT NULL CHECK(employer_share_included IN (0,1)),
  headcount INTEGER NOT NULL CHECK(headcount>0),
  gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  deductions_minor INTEGER NOT NULL CHECK(deductions_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor=gross_minor-deductions_minor),
  paid_minor INTEGER NOT NULL CHECK(paid_minor=net_minor),
  status TEXT NOT NULL DEFAULT 'imported' CHECK(status IN ('imported','confirmed','rejected','withdrawn')),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  withdrawn_by TEXT,
  withdrawn_at TEXT,
  withdrawal_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(parallel_month_id,tenant_id) REFERENCES payroll_parallel_months(id,tenant_id),
  FOREIGN KEY(imported_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>imported_by),
  CHECK(withdrawn_by IS NULL OR withdrawn_by<>imported_by),
  CHECK((status='imported')=(decided_by IS NULL)),
  CHECK(decided_by IS NULL OR (decided_at IS NOT NULL AND length(trim(decision_note))>=10)),
  CHECK((status='withdrawn')=(withdrawn_by IS NOT NULL)),
  CHECK(withdrawn_by IS NULL OR (withdrawn_at IS NOT NULL AND length(trim(withdrawal_note))>=10)),
  UNIQUE(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX payroll_legacy_batches_live ON payroll_legacy_batches(tenant_id,month) WHERE status IN ('imported','confirmed');

-- سطر لكل موظف كما في كشف النظام السابق، ومعادلته محروسة: البنود ناقص الخصوم يساوي الصافي، والمدفوع في ملف البنك يساويه.
CREATE TABLE payroll_legacy_lines (
  batch_id TEXT NOT NULL REFERENCES payroll_legacy_batches(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  row_number INTEGER NOT NULL CHECK(row_number>=2),
  basic_minor INTEGER NOT NULL CHECK(basic_minor>=0),
  housing_minor INTEGER NOT NULL CHECK(housing_minor>=0),
  transport_minor INTEGER NOT NULL CHECK(transport_minor>=0),
  other_allowance_minor INTEGER NOT NULL CHECK(other_allowance_minor>=0),
  overtime_minor INTEGER NOT NULL CHECK(overtime_minor>=0),
  other_additions_minor INTEGER NOT NULL CHECK(other_additions_minor>=0),
  absence_deduction_minor INTEGER NOT NULL CHECK(absence_deduction_minor>=0),
  gosi_employee_minor INTEGER NOT NULL CHECK(gosi_employee_minor>=0),
  advance_minor INTEGER NOT NULL CHECK(advance_minor>=0),
  other_deductions_minor INTEGER NOT NULL CHECK(other_deductions_minor>=0),
  gosi_employer_minor INTEGER CHECK(gosi_employer_minor IS NULL OR gosi_employer_minor>=0),
  net_minor INTEGER NOT NULL CHECK(net_minor>=0),
  paid_minor INTEGER NOT NULL CHECK(paid_minor=net_minor),
  CHECK(net_minor=basic_minor+housing_minor+transport_minor+other_allowance_minor+overtime_minor+other_additions_minor
    -absence_deduction_minor-gosi_employee_minor-advance_minor-other_deductions_minor),
  PRIMARY KEY(batch_id,user_id),
  UNIQUE(batch_id,row_number)
) STRICT;

CREATE TABLE payroll_parallel_comparisons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month,6,2) BETWEEN '01' AND '12'),
  batch_id TEXT NOT NULL,
  run_id TEXT REFERENCES payroll_runs(id),
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  inputs_digest TEXT NOT NULL CHECK(length(inputs_digest)=64),
  inputs_parts TEXT NOT NULL CHECK(json_valid(inputs_parts)),
  legacy_headcount INTEGER NOT NULL CHECK(legacy_headcount>=0),
  platform_headcount INTEGER NOT NULL CHECK(platform_headcount>=0),
  legacy_net_minor INTEGER NOT NULL,
  platform_net_minor INTEGER NOT NULL,
  difference_count INTEGER NOT NULL CHECK(difference_count>=0),
  compared_by TEXT NOT NULL,
  compared_at TEXT NOT NULL,
  FOREIGN KEY(batch_id,tenant_id) REFERENCES payroll_legacy_batches(id,tenant_id),
  FOREIGN KEY(compared_by,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(id,tenant_id)
) STRICT;
CREATE INDEX payroll_parallel_comparisons_month ON payroll_parallel_comparisons(tenant_id,month,compared_at);

-- الفرق بند واحد لموظف واحد بالرقمين كما وقعا. «presence» موظف في جهة دون الأخرى، ورقمه صافيه في جهته.
CREATE TABLE payroll_parallel_differences (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  component TEXT NOT NULL CHECK(component IN ('presence','basic','housing','transport','other_allowance','overtime','other_additions',
    'absence_deduction','gosi_employee','advance','other_deductions','gosi_employer')),
  legacy_minor INTEGER,
  platform_minor INTEGER,
  delta_minor INTEGER NOT NULL,
  FOREIGN KEY(comparison_id,tenant_id) REFERENCES payroll_parallel_comparisons(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(component='presence' OR (legacy_minor IS NOT NULL AND platform_minor IS NOT NULL AND delta_minor=platform_minor-legacy_minor AND delta_minor<>0)),
  CHECK(component<>'presence' OR ((legacy_minor IS NULL)<>(platform_minor IS NULL) AND delta_minor=COALESCE(platform_minor,0)-COALESCE(legacy_minor,0))),
  UNIQUE(comparison_id,user_id,component),
  UNIQUE(id,tenant_id)
) STRICT;

-- التفسير لأرقام بعينها في دفعة بعينها: يبقى صالحًا لكل مقارنة لاحقة يقع فيها الفرق نفسه بأرقامه نفسها، ويسقط إن تغيّر أحد الرقمين.
CREATE TABLE payroll_parallel_explanations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  difference_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  component TEXT NOT NULL,
  legacy_minor INTEGER,
  platform_minor INTEGER,
  cause TEXT NOT NULL CHECK(length(cause) BETWEEN 2 AND 60),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  explained_by TEXT NOT NULL,
  explained_at TEXT NOT NULL,
  FOREIGN KEY(difference_id,tenant_id) REFERENCES payroll_parallel_differences(id,tenant_id),
  FOREIGN KEY(batch_id,tenant_id) REFERENCES payroll_legacy_batches(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(explained_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX payroll_parallel_explanations_key ON payroll_parallel_explanations(batch_id,user_id,component,COALESCE(legacy_minor,'absent'),COALESCE(platform_minor,'absent'));

-- الانتقال: أول شهر تدفعه المنصة بعد آخر شهر موازٍ، يقترحه معتمد ويؤكده غيره، ومعه لقطة الجاهزية التي قام عليها.
CREATE TABLE payroll_cutovers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  first_platform_month TEXT NOT NULL CHECK(first_platform_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(first_platform_month,6,2) BETWEEN '01' AND '12'),
  last_parallel_month TEXT NOT NULL CHECK(last_parallel_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(last_parallel_month,6,2) BETWEEN '01' AND '12'),
  readiness TEXT NOT NULL CHECK(json_valid(readiness)),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','confirmed','rejected')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(first_platform_month>last_parallel_month),
  CHECK(decided_by IS NULL OR decided_by<>proposed_by),
  CHECK((status='proposed')=(decided_by IS NULL)),
  CHECK(decided_by IS NULL OR (decided_at IS NOT NULL AND length(trim(decision_note))>=10))
) STRICT;
CREATE UNIQUE INDEX payroll_cutovers_open ON payroll_cutovers(tenant_id) WHERE status IN ('proposed','confirmed');

-- ───── الشهر الموازي ─────
CREATE TRIGGER payroll_parallel_months_declare BEFORE INSERT ON payroll_parallel_months
WHEN NEW.status<>'declared' OR NEW.withdrawn_by IS NOT NULL
  OR EXISTS(SELECT 1 FROM payroll_cutovers c WHERE c.tenant_id=NEW.tenant_id AND c.status='confirmed' AND c.first_platform_month<=NEW.month)
  OR EXISTS(SELECT 1 FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE r.tenant_id=NEW.tenant_id AND r.month=NEW.month AND p.status<>'cancelled')
  OR EXISTS(SELECT 1 FROM wps_exports x WHERE x.tenant_id=NEW.tenant_id AND x.month=NEW.month)
  OR EXISTS(SELECT 1 FROM finance_source_links l JOIN payroll_runs r ON r.id=l.source_id WHERE l.source_kind='payroll_run' AND r.tenant_id=NEW.tenant_id AND r.month=NEW.month)
BEGIN SELECT RAISE(ABORT,'a month the platform has paid, exported or booked, or one the cutover covers, is not declared a parallel month'); END;
CREATE TRIGGER payroll_parallel_months_fixed BEFORE UPDATE ON payroll_parallel_months
WHEN OLD.status<>'declared' OR NEW.status<>'withdrawn' OR NEW.version<>OLD.version+1
  OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.month IS NOT OLD.month OR NEW.basis IS NOT OLD.basis
  OR NEW.declared_by IS NOT OLD.declared_by OR NEW.declared_at IS NOT OLD.declared_at
BEGIN SELECT RAISE(ABORT,'a parallel month is declared once and only withdrawn, by a second person'); END;
CREATE TRIGGER payroll_parallel_months_withdraw BEFORE UPDATE ON payroll_parallel_months
WHEN NEW.status='withdrawn' AND (
  EXISTS(SELECT 1 FROM payroll_legacy_batches b WHERE b.parallel_month_id=OLD.id AND b.status IN ('imported','confirmed'))
  OR EXISTS(SELECT 1 FROM payroll_cutovers c WHERE c.tenant_id=OLD.tenant_id AND c.status='confirmed' AND c.first_platform_month>OLD.month))
BEGIN SELECT RAISE(ABORT,'a parallel month the legacy system paid stays parallel: its legacy batch stands, or the cutover already covers it'); END;
CREATE TRIGGER payroll_parallel_months_no_delete BEFORE DELETE ON payroll_parallel_months BEGIN SELECT RAISE(ABORT,'parallel month declarations are retained'); END;

-- ───── دفعة النظام السابق ─────
CREATE TRIGGER payroll_legacy_batches_month BEFORE INSERT ON payroll_legacy_batches
WHEN NEW.status<>'imported' OR NEW.decided_by IS NOT NULL OR NEW.withdrawn_by IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM payroll_parallel_months m WHERE m.id=NEW.parallel_month_id AND m.tenant_id=NEW.tenant_id AND m.month=NEW.month AND m.status='declared')
BEGIN SELECT RAISE(ABORT,'a legacy payroll batch is imported into a declared parallel month of its own tenant'); END;
CREATE TRIGGER payroll_legacy_batches_fixed BEFORE UPDATE ON payroll_legacy_batches
WHEN NEW.version<>OLD.version+1
  OR NOT ((OLD.status='imported' AND NEW.status IN ('confirmed','rejected')) OR (OLD.status='confirmed' AND NEW.status='withdrawn'))
  OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.parallel_month_id IS NOT OLD.parallel_month_id OR NEW.month IS NOT OLD.month
  OR NEW.source_note IS NOT OLD.source_note OR NEW.breakdown_digest IS NOT OLD.breakdown_digest OR NEW.bank_digest IS NOT OLD.bank_digest
  OR NEW.employer_share_included IS NOT OLD.employer_share_included OR NEW.headcount IS NOT OLD.headcount OR NEW.gross_minor IS NOT OLD.gross_minor
  OR NEW.deductions_minor IS NOT OLD.deductions_minor OR NEW.net_minor IS NOT OLD.net_minor OR NEW.paid_minor IS NOT OLD.paid_minor
  OR NEW.imported_by IS NOT OLD.imported_by OR NEW.imported_at IS NOT OLD.imported_at
  OR (OLD.status='confirmed' AND (NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at OR NEW.decision_note IS NOT OLD.decision_note))
BEGIN SELECT RAISE(ABORT,'a legacy payroll batch keeps its numbers; a second person confirms or rejects it once, and a confirmed batch is only withdrawn'); END;
CREATE TRIGGER payroll_legacy_batches_after_cutover BEFORE UPDATE ON payroll_legacy_batches
WHEN NEW.status='withdrawn' AND EXISTS(SELECT 1 FROM payroll_cutovers c WHERE c.tenant_id=OLD.tenant_id AND c.status='confirmed')
BEGIN SELECT RAISE(ABORT,'after the cutover the legacy batches of the parallel months are history and are not withdrawn'); END;
CREATE TRIGGER payroll_legacy_batches_no_delete BEFORE DELETE ON payroll_legacy_batches BEGIN SELECT RAISE(ABORT,'legacy payroll batches are retained'); END;
CREATE TRIGGER payroll_legacy_lines_owner BEFORE INSERT ON payroll_legacy_lines
WHEN NOT EXISTS(SELECT 1 FROM payroll_legacy_batches b JOIN users u ON u.tenant_id=b.tenant_id WHERE b.id=NEW.batch_id AND u.id=NEW.user_id AND b.status='imported')
BEGIN SELECT RAISE(ABORT,'a legacy line belongs to an employee of its batch tenant and is written while the batch is imported'); END;
CREATE TRIGGER payroll_legacy_lines_no_update BEFORE UPDATE ON payroll_legacy_lines BEGIN SELECT RAISE(ABORT,'legacy payroll lines are written once'); END;
CREATE TRIGGER payroll_legacy_lines_no_delete BEFORE DELETE ON payroll_legacy_lines BEGIN SELECT RAISE(ABORT,'legacy payroll lines are retained'); END;

-- ───── المقارنة وفروقها وتفسيرها ─────
CREATE TRIGGER payroll_parallel_comparisons_batch BEFORE INSERT ON payroll_parallel_comparisons
WHEN NOT EXISTS(SELECT 1 FROM payroll_legacy_batches b WHERE b.id=NEW.batch_id AND b.tenant_id=NEW.tenant_id AND b.month=NEW.month AND b.status='confirmed')
BEGIN SELECT RAISE(ABORT,'a parallel comparison is made against the confirmed legacy batch of the same month'); END;
CREATE TRIGGER payroll_parallel_comparisons_no_update BEFORE UPDATE ON payroll_parallel_comparisons BEGIN SELECT RAISE(ABORT,'a parallel comparison is a record; compare again instead'); END;
CREATE TRIGGER payroll_parallel_comparisons_no_delete BEFORE DELETE ON payroll_parallel_comparisons BEGIN SELECT RAISE(ABORT,'parallel comparisons are retained'); END;
CREATE TRIGGER payroll_parallel_differences_no_update BEFORE UPDATE ON payroll_parallel_differences BEGIN SELECT RAISE(ABORT,'a parallel difference is a record'); END;
CREATE TRIGGER payroll_parallel_differences_no_delete BEFORE DELETE ON payroll_parallel_differences BEGIN SELECT RAISE(ABORT,'parallel differences are retained'); END;
CREATE TRIGGER payroll_parallel_explanations_second_person BEFORE INSERT ON payroll_parallel_explanations
WHEN NOT EXISTS(SELECT 1 FROM payroll_parallel_differences d JOIN payroll_parallel_comparisons c ON c.id=d.comparison_id
    WHERE d.id=NEW.difference_id AND d.tenant_id=NEW.tenant_id AND c.batch_id=NEW.batch_id AND d.user_id=NEW.user_id AND d.component=NEW.component
      AND d.legacy_minor IS NEW.legacy_minor AND d.platform_minor IS NEW.platform_minor)
  OR EXISTS(SELECT 1 FROM payroll_parallel_differences d JOIN payroll_parallel_comparisons c ON c.id=d.comparison_id JOIN payroll_legacy_batches b ON b.id=c.batch_id
    WHERE d.id=NEW.difference_id AND NEW.explained_by IN (c.compared_by,b.imported_by,d.user_id))
BEGIN SELECT RAISE(ABORT,'a parallel difference is explained by a second person: not whoever compared it, imported its legacy batch, or is paid by it'); END;
CREATE TRIGGER payroll_parallel_explanations_no_update BEFORE UPDATE ON payroll_parallel_explanations BEGIN SELECT RAISE(ABORT,'an explanation is written once'); END;
CREATE TRIGGER payroll_parallel_explanations_no_delete BEFORE DELETE ON payroll_parallel_explanations BEGIN SELECT RAISE(ABORT,'explanations are retained'); END;

-- ───── الانتقال ─────
CREATE TRIGGER payroll_cutovers_proposal BEFORE INSERT ON payroll_cutovers
WHEN NEW.status<>'proposed' OR NEW.decided_by IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM payroll_parallel_months m WHERE m.tenant_id=NEW.tenant_id AND m.status='declared' AND m.month=NEW.last_parallel_month)
  OR EXISTS(SELECT 1 FROM payroll_parallel_months m WHERE m.tenant_id=NEW.tenant_id AND m.status='declared' AND m.month>NEW.last_parallel_month)
BEGIN SELECT RAISE(ABORT,'a cutover is proposed right after the last declared parallel month'); END;
CREATE TRIGGER payroll_cutovers_fixed BEFORE UPDATE ON payroll_cutovers
WHEN OLD.status<>'proposed' OR NEW.status NOT IN ('confirmed','rejected') OR NEW.version<>OLD.version+1
  OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.first_platform_month IS NOT OLD.first_platform_month
  OR NEW.last_parallel_month IS NOT OLD.last_parallel_month OR NEW.readiness IS NOT OLD.readiness OR NEW.note IS NOT OLD.note
  OR NEW.proposed_by IS NOT OLD.proposed_by OR NEW.proposed_at IS NOT OLD.proposed_at
  OR (NEW.status='confirmed' AND EXISTS(SELECT 1 FROM payroll_parallel_months m WHERE m.tenant_id=OLD.tenant_id AND m.status='declared' AND m.month>OLD.last_parallel_month))
BEGIN SELECT RAISE(ABORT,'a cutover proposal is confirmed or rejected once, by a second person, and is otherwise fixed'); END;
CREATE TRIGGER payroll_cutovers_no_delete BEFORE DELETE ON payroll_cutovers BEGIN SELECT RAISE(ABORT,'cutover decisions are retained'); END;

-- ───── الحارس على مسارات المال: الشهر الموازي يدفعه النظام السابق ─────
-- الكود يرفض هذه الثلاثة برفض مسمّى قبل أن تصل هنا (app/payroll-parallel-guard.mjs)؛ القادح يمنع ما يتجاوز الكود.
-- تنبيه للدمج: هذه القوادح على payroll_payments وwps_exports وfinance_source_links؛ ترحيلٌ لاحق يعيد بناء أحدها يعيد إنشاء قادحه.
CREATE TRIGGER payroll_payments_parallel_month BEFORE INSERT ON payroll_payments
WHEN EXISTS(SELECT 1 FROM payroll_runs r JOIN payroll_parallel_months m ON m.tenant_id=r.tenant_id AND m.month=r.month AND m.status='declared' WHERE r.id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'a parallel month is paid by the legacy system; the platform prepares no payment for it'); END;
CREATE TRIGGER wps_exports_parallel_month BEFORE INSERT ON wps_exports
WHEN EXISTS(SELECT 1 FROM payroll_parallel_months m WHERE m.tenant_id=NEW.tenant_id AND m.month=NEW.month AND m.status='declared')
BEGIN SELECT RAISE(ABORT,'a parallel month is paid by the legacy system; the platform exports no wage protection file for it'); END;
CREATE TRIGGER finance_source_links_parallel_month BEFORE INSERT ON finance_source_links
WHEN NEW.source_kind='payroll_run' AND EXISTS(SELECT 1 FROM payroll_runs r JOIN payroll_parallel_months m ON m.tenant_id=r.tenant_id AND m.month=r.month AND m.status='declared' WHERE r.id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'a parallel month is booked from the legacy payroll; the platform run of a parallel month is not journalized'); END;
