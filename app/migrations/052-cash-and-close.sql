-- التنبؤ النقدي وقائمة الإقفال وإطفاء المدفوعات المقدمة.
-- التنبؤ النقدي بلا جداول عمدًا: كل رقم فيه مشتق من مستندات المنصة وقت العرض، والسيناريوهات والرصيد الافتتاحي
-- معاملات إدخال تُحسب فورًا ولا تُحفظ، فلا يتحول تقدير إلى حقيقة مخزّنة يُبنى عليها لاحقًا.

-- قوالب مهام الإقفال: يضعها مالك إجراء الإقفال. تبدأ فارغة؛ المنصة لا تعرف قائمة مهام محاسبية لهذه الشركة.
CREATE TABLE close_task_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  owner_id TEXT NOT NULL,
  due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,title),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER close_templates_versioned BEFORE UPDATE ON close_task_templates WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id BEGIN SELECT RAISE(ABORT,'stale close template'); END;
CREATE TRIGGER close_templates_no_delete BEFORE DELETE ON close_task_templates BEGIN SELECT RAISE(ABORT,'close templates are deactivated, not deleted'); END;

-- فترة إقفال شهرية. قفل القيود نفسه موجود في app/finance.mjs عبر finance_periods.status؛
-- هذا الجدول لا يكرره بل يربط به: اعتماد الإقفال يقفل الفترة المحاسبية المرتبطة إن وُجدت.
CREATE TABLE close_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_key TEXT NOT NULL CHECK(period_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  finance_period_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved')),
  opened_by TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  ledger_locked INTEGER NOT NULL DEFAULT 0 CHECK(ledger_locked IN (0,1)),
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK(reopen_count>=0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,period_key),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(opened_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(finance_period_id,tenant_id) REFERENCES finance_periods(id,tenant_id),
  CHECK((status='approved')=(approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(trim(approval_note))>=10))
) STRICT;

CREATE TABLE close_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL REFERENCES close_periods(id),
  template_id TEXT REFERENCES close_task_templates(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  owner_id TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
  evidence TEXT NOT NULL DEFAULT '',
  completed_by TEXT REFERENCES users(id),
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(period_id,title),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='done')=(completed_by IS NOT NULL AND completed_at IS NOT NULL AND length(trim(evidence))>=5))
) STRICT;

-- من نفّذ مهمة في الفترة لا يعتمد إقفالها، ومن فتحها لا يعتمدها. يُفرض في الكود وهنا معًا.
CREATE TRIGGER close_period_approver_independent BEFORE UPDATE ON close_periods
WHEN NEW.status='approved' AND OLD.status<>'approved' AND (NEW.approved_by=OLD.opened_by OR EXISTS(SELECT 1 FROM close_tasks t WHERE t.period_id=OLD.id AND t.completed_by=NEW.approved_by))
BEGIN SELECT RAISE(ABORT,'whoever opens the close or executes one of its tasks does not approve it'); END;
CREATE TRIGGER close_period_tasks_complete BEFORE UPDATE ON close_periods
WHEN NEW.status='approved' AND OLD.status<>'approved' AND EXISTS(SELECT 1 FROM close_tasks t WHERE t.period_id=OLD.id AND t.status<>'done')
BEGIN SELECT RAISE(ABORT,'close approval requires every task completed with evidence'); END;
CREATE TRIGGER close_period_versioned BEFORE UPDATE ON close_periods
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.period_key<>OLD.period_key OR NEW.opened_by<>OLD.opened_by OR NEW.created_at<>OLD.created_at OR NEW.ledger_locked<OLD.ledger_locked
BEGIN SELECT RAISE(ABORT,'close period identity is fixed and a released ledger lock is not forgotten'); END;
CREATE TRIGGER close_period_no_delete BEFORE DELETE ON close_periods BEGIN SELECT RAISE(ABORT,'close history is immutable'); END;

-- المعتمد لا يُعدَّل: لا تُضاف مهمة إلى إقفال معتمد ولا تُغيَّر مهمة فيه إلا بعد فتح موثّق.
CREATE TRIGGER close_tasks_locked_insert BEFORE INSERT ON close_tasks
WHEN EXISTS(SELECT 1 FROM close_periods p WHERE p.id=NEW.period_id AND p.status='approved')
BEGIN SELECT RAISE(ABORT,'an approved close takes no new task'); END;
CREATE TRIGGER close_tasks_locked_update BEFORE UPDATE ON close_tasks
WHEN EXISTS(SELECT 1 FROM close_periods p WHERE p.id=OLD.period_id AND p.status='approved')
BEGIN SELECT RAISE(ABORT,'an approved close is not edited; reopen it with a documented reason first'); END;
CREATE TRIGGER close_tasks_evidence_final BEFORE UPDATE ON close_tasks
WHEN NEW.version<>OLD.version+1 OR NEW.period_id<>OLD.period_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at OR (OLD.status='done' AND (NEW.evidence<>OLD.evidence OR NEW.completed_by IS NOT OLD.completed_by))
BEGIN SELECT RAISE(ABORT,'a completed task keeps its executor and evidence'); END;
CREATE TRIGGER close_tasks_no_delete BEFORE DELETE ON close_tasks BEGIN SELECT RAISE(ABORT,'close tasks are retained'); END;
CREATE INDEX close_tasks_period ON close_tasks(period_id,status);

-- فتح إقفال معتمد: بسبب موثّق، ويعتمده شخص ثالث ليس طالب الفتح ولا معتمد الإقفال. الأثر يبقى في السجل.
CREATE TABLE close_reopenings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL REFERENCES close_periods(id),
  previous_approved_by TEXT NOT NULL REFERENCES users(id),
  previous_approved_at TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK(requested_by<>previous_approved_by),
  CHECK((status='pending')=(approved_by IS NULL)),
  CHECK(approved_by IS NULL OR (approved_by<>requested_by AND approved_by<>previous_approved_by AND length(trim(note))>=10))
) STRICT;
CREATE UNIQUE INDEX close_reopen_one_pending ON close_reopenings(period_id) WHERE status='pending';
CREATE TRIGGER close_reopen_final BEFORE UPDATE ON close_reopenings
WHEN OLD.status<>'pending' OR NEW.status='pending' OR NEW.version<>OLD.version+1 OR NEW.period_id<>OLD.period_id OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.previous_approved_by<>OLD.previous_approved_by
BEGIN SELECT RAISE(ABORT,'a reopening request is decided once and never rewritten'); END;
CREATE TRIGGER close_reopen_no_delete BEFORE DELETE ON close_reopenings BEGIN SELECT RAISE(ABORT,'reopening history is immutable'); END;

-- جدول إطفاء مدفوع مقدمًا أو استحقاق. الحسابان يختارهما المحاسب من دليل الحسابات؛ المنصة لا تفترض حسابًا.
CREATE TABLE amortization_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('prepaid','accrual')),
  invoice_id TEXT REFERENCES procurement_invoices(id),
  source_reference TEXT NOT NULL CHECK(length(trim(source_reference))>=3),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  total_minor INTEGER NOT NULL CHECK(total_minor>0 AND total_minor<=1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),
  months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 120),
  debit_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
  credit_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
  cost_center_id TEXT NOT NULL REFERENCES finance_cost_centers(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,kind,source_reference),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(debit_account_id<>credit_account_id),
  CHECK((status='cancelled')=(length(trim(cancel_reason))>=10))
) STRICT;
CREATE TRIGGER amortization_schedule_fixed BEFORE UPDATE ON amortization_schedules
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.total_minor<>OLD.total_minor OR NEW.months<>OLD.months
  OR NEW.starts_on<>OLD.starts_on OR NEW.ends_on<>OLD.ends_on OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
  OR NEW.debit_account_id<>OLD.debit_account_id OR NEW.credit_account_id<>OLD.credit_account_id OR OLD.status='cancelled'
BEGIN SELECT RAISE(ABORT,'an amortization schedule keeps its numbers; correct it by cancelling and preparing a new one'); END;
CREATE TRIGGER amortization_schedule_no_delete BEFORE DELETE ON amortization_schedules BEGIN SELECT RAISE(ABORT,'amortization history is immutable'); END;

-- قيد مقترح لشهر واحد. يُعتمد شهرًا شهرًا ولا يُرحَّل آليًا: الترحيل يبقى في الدفتر بيد من يملك تفويضه.
CREATE TABLE amortization_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  schedule_id TEXT NOT NULL REFERENCES amortization_schedules(id),
  period_key TEXT NOT NULL CHECK(period_key GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  entry_date TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position>0),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','cancelled')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(schedule_id,period_key),
  UNIQUE(schedule_id,position),
  CHECK((status='approved')=(approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(trim(approval_note))>=5))
) STRICT;
CREATE TRIGGER amortization_entry_independent BEFORE UPDATE ON amortization_entries
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM amortization_schedules s WHERE s.id=OLD.schedule_id AND s.prepared_by=NEW.approved_by)
BEGIN SELECT RAISE(ABORT,'whoever prepares the schedule does not approve its monthly entry'); END;
CREATE TRIGGER amortization_entry_final BEFORE UPDATE ON amortization_entries
WHEN OLD.status<>'proposed' OR NEW.version<>OLD.version+1 OR NEW.schedule_id<>OLD.schedule_id OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.amount_minor<>OLD.amount_minor OR NEW.period_key<>OLD.period_key OR NEW.entry_date<>OLD.entry_date OR NEW.position<>OLD.position OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a proposed entry is decided once and its numbers never change'); END;
CREATE TRIGGER amortization_entry_no_delete BEFORE DELETE ON amortization_entries BEGIN SELECT RAISE(ABORT,'proposed entries are retained'); END;
CREATE INDEX amortization_entries_period ON amortization_entries(tenant_id,period_key,status);
