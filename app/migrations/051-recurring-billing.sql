-- الفوترة الدورية والدفعات المقدمة والإيراد المؤجل — نموذج دخل الوكالة الذي لا تدعمه الفوترة الحالية.
-- قاعدة الوحدة كلها: الأتمتة تجهّز مسودة، والإنسان وحده يصدر. لا ترقيم هنا إطلاقًا؛ التسلسل بلا فجوات يبقى في tax_invoices عند الإصدار البشري.

CREATE TABLE billing_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  case_id TEXT REFERENCES commercial_cases(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  cadence TEXT NOT NULL CHECK(cadence IN ('monthly','quarterly')),
  issue_day INTEGER NOT NULL CHECK(issue_day BETWEEN 1 AND 28),
  -- بنود الفاتورة كما اتفق عليها العقد. المبالغ بالهللات وشاملة الضريبة، كما يتعامل ar_claims مع المبلغ.
  lines TEXT NOT NULL CHECK(json_valid(lines) AND json_array_length(lines)>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  total_minor INTEGER NOT NULL CHECK(total_minor>0),
  contract_reference TEXT NOT NULL CHECK(length(trim(contract_reference))>=5),
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','paused','ended')),
  stopped_reason TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(end_date IS NULL OR end_date>=start_date)
) STRICT;
-- الجدولة تغيّر حالتها فقط؛ تغيير المبالغ أو الدورية جدولة جديدة تحفظ تفسير ما وُلّد سابقًا.
CREATE TRIGGER billing_schedules_state_only BEFORE UPDATE ON billing_schedules
WHEN NEW.version<>OLD.version+1 OR OLD.status='ended'
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id OR NEW.case_id IS NOT OLD.case_id
  OR NEW.lines<>OLD.lines OR NEW.total_minor<>OLD.total_minor OR NEW.cadence<>OLD.cadence OR NEW.issue_day<>OLD.issue_day
  OR NEW.start_date<>OLD.start_date OR NEW.owner_id<>OLD.owner_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a schedule changes state only; its amounts are replaced by a new schedule'); END;
CREATE TRIGGER billing_schedules_no_delete BEFORE DELETE ON billing_schedules BEGIN SELECT RAISE(ABORT,'schedules are retained'); END;

-- مسودة فاتورة دورية: ما جهّزته الأتمتة للفترة. بلا رقم وبلا تسلسل وبلا بصمة — ليست مستندًا ضريبيًا.
CREATE TABLE billing_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  schedule_id TEXT NOT NULL REFERENCES billing_schedules(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  lines TEXT NOT NULL CHECK(json_valid(lines)),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  total_minor INTEGER NOT NULL CHECK(total_minor>0),
  status TEXT NOT NULL CHECK(status IN ('pending_review','issued','dismissed')),
  issued_invoice_id TEXT REFERENCES tax_invoices(id),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  -- منع التكرار: الفترة الواحدة لجدولة واحدة مسودة واحدة مهما تكرر التشغيل.
  UNIQUE(schedule_id,period_start),
  CHECK((status='pending_review')=(decided_by IS NULL AND decided_at IS NULL)),
  CHECK((status='issued')=(issued_invoice_id IS NOT NULL)),
  CHECK(status<>'dismissed' OR length(trim(decision_note))>=10)
) STRICT;
CREATE TRIGGER billing_drafts_never_born_issued BEFORE INSERT ON billing_drafts
WHEN NEW.status<>'pending_review' OR NEW.issued_invoice_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'a schedule generates a draft awaiting review, never an issued invoice'); END;
-- لا تُغلق المسودة إلا بفاتورة أصدرها شخص فعلًا في tax_invoices؛ الأتمتة لا تصدر ولا تُسند إصدارًا لم يقع.
CREATE TRIGGER billing_drafts_human_issue BEFORE UPDATE ON billing_drafts
WHEN NEW.issued_invoice_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.issued_invoice_id AND tenant_id=NEW.tenant_id AND kind='invoice' AND status='issued')
BEGIN SELECT RAISE(ABORT,'a draft closes only against an invoice a person actually issued'); END;
CREATE TRIGGER billing_drafts_decided_final BEFORE UPDATE ON billing_drafts
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'pending_review'
  OR NEW.schedule_id<>OLD.schedule_id OR NEW.period_start<>OLD.period_start OR NEW.lines<>OLD.lines OR NEW.total_minor<>OLD.total_minor
BEGIN SELECT RAISE(ABORT,'a decided draft is retained as it was'); END;
CREATE TRIGGER billing_drafts_no_delete BEFORE DELETE ON billing_drafts BEGIN SELECT RAISE(ABORT,'drafts are retained'); END;

-- سجل تشغيل الجدولة: مفتاحه (الجدولة، بداية الفترة) فيمنع توليد الفترة نفسها مرتين مهما أُعيد التشغيل.
CREATE TABLE billing_schedule_runs (
  schedule_id TEXT NOT NULL REFERENCES billing_schedules(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  draft_id TEXT REFERENCES billing_drafts(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('draft','stopped')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(schedule_id,period_start),
  CHECK((outcome='draft')=(draft_id IS NOT NULL))
) STRICT;
CREATE TRIGGER billing_schedule_runs_no_update BEFORE UPDATE ON billing_schedule_runs BEGIN SELECT RAISE(ABORT,'a run record is history'); END;

-- الدفعة المقدمة: التزام على الوكالة (إيراد مؤجل) لا إيراد. تُسجَّل من شخص ويؤكد قبضها شخص آخر.
CREATE TABLE advance_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  schedule_id TEXT REFERENCES billing_schedules(id),
  description TEXT NOT NULL CHECK(length(trim(description))>=3),
  agreement_reference TEXT NOT NULL CHECK(length(trim(agreement_reference))>=5),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_minor>=0 AND paid_minor<=amount_minor),
  received_on TEXT,
  status TEXT NOT NULL CHECK(status IN ('recorded','paid')),
  recorded_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(confirmed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(confirmed_by IS NULL OR confirmed_by<>recorded_by),
  CHECK((status='paid')=(confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND received_on IS NOT NULL AND paid_minor>0)),
  CHECK(status='paid' OR paid_minor=0)
) STRICT;
CREATE TRIGGER advance_invoices_amount_fixed BEFORE UPDATE ON advance_invoices
WHEN NEW.version<>OLD.version+1 OR OLD.status='paid'
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a confirmed advance is corrected by a new record'); END;
CREATE TRIGGER advance_invoices_no_delete BEFORE DELETE ON advance_invoices BEGIN SELECT RAISE(ABORT,'advances are retained'); END;

-- السحب من رصيد الدفعة المقدمة على فاتورة لاحقة.
CREATE TABLE advance_draws (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  advance_id TEXT NOT NULL REFERENCES advance_invoices(id),
  target_reference TEXT NOT NULL CHECK(length(trim(target_reference))>=3),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  applied_minor INTEGER NOT NULL DEFAULT 0 CHECK(applied_minor>=0 AND applied_minor<=amount_minor),
  status TEXT NOT NULL CHECK(status IN ('awaiting_payment','ready','partial','drawn')),
  requested_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status IN ('awaiting_payment','ready'))=(applied_minor=0)),
  CHECK((status='drawn')=(applied_minor=amount_minor))
) STRICT;
-- القاعدة التي لا يحرسها الكود وحده: مجموع المسحوب لا يتجاوز الرصيد المدفوع، ولا يُخطَّط سحب يتجاوز الدفعة نفسها.
CREATE TRIGGER advance_draws_within_paid_insert AFTER INSERT ON advance_draws
WHEN (SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=NEW.advance_id)>(SELECT paid_minor FROM advance_invoices WHERE id=NEW.advance_id)
BEGIN SELECT RAISE(ABORT,'drawn total exceeds the paid advance balance'); END;
CREATE TRIGGER advance_draws_within_paid_update AFTER UPDATE ON advance_draws
WHEN (SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=NEW.advance_id)>(SELECT paid_minor FROM advance_invoices WHERE id=NEW.advance_id)
BEGIN SELECT RAISE(ABORT,'drawn total exceeds the paid advance balance'); END;
CREATE TRIGGER advance_draws_within_advance AFTER INSERT ON advance_draws
WHEN (SELECT COALESCE(SUM(amount_minor),0) FROM advance_draws WHERE advance_id=NEW.advance_id)>(SELECT amount_minor FROM advance_invoices WHERE id=NEW.advance_id)
BEGIN SELECT RAISE(ABORT,'planned draws exceed the advance itself'); END;
CREATE TRIGGER advance_paid_floor BEFORE UPDATE OF paid_minor ON advance_invoices
WHEN NEW.paid_minor<(SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'the paid balance cannot drop below what was already drawn'); END;
CREATE TRIGGER advance_draws_versioned BEFORE UPDATE ON advance_draws
WHEN NEW.version<>OLD.version+1 OR NEW.advance_id<>OLD.advance_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.applied_minor<OLD.applied_minor
BEGIN SELECT RAISE(ABORT,'a draw only moves forward; reduce it with a new record'); END;
CREATE TRIGGER advance_draws_no_delete BEFORE DELETE ON advance_draws BEGIN SELECT RAISE(ABORT,'draws are retained'); END;

-- الاشتراك الدوري بالترحيل: خياران مستقلان يضبطهما صاحب العقد، ومن سجّل الاتفاق ليس صاحبه.
CREATE TABLE retainer_agreements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  -- الوحدة: الدقائق حين تكون الميزانية بالساعات، والهللات حين تكون بالمال.
  basis TEXT NOT NULL CHECK(basis IN ('hours','money')),
  carry_unused INTEGER NOT NULL DEFAULT 0 CHECK(carry_unused IN (0,1)),
  deduct_overage INTEGER NOT NULL DEFAULT 0 CHECK(deduct_overage IN (0,1)),
  contract_reference TEXT NOT NULL CHECK(length(trim(contract_reference))>=5),
  owner_id TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','ended')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,client_id,name),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(owner_id<>recorded_by)
) STRICT;
CREATE TRIGGER retainer_agreements_versioned BEFORE UPDATE ON retainer_agreements
WHEN NEW.version<>OLD.version+1 OR NEW.basis<>OLD.basis OR NEW.owner_id<>OLD.owner_id OR NEW.recorded_by<>OLD.recorded_by OR NEW.client_id<>OLD.client_id
BEGIN SELECT RAISE(ABORT,'the basis and the owner of an agreement are not rewritten'); END;
CREATE TRIGGER retainer_agreements_no_delete BEFORE DELETE ON retainer_agreements BEGIN SELECT RAISE(ABORT,'agreements are retained'); END;

-- الفترة: ميزانية ومستهلك ومرحَّل داخلًا ومرحَّل خارجًا. لا عمود مبلغ فاتورة هنا إطلاقًا:
-- الفوترة ثابتة بجدولتها، والترحيل يمس الاستحقاق وحده. المرحَّل خارجًا يكون سالبًا حين يُخصم الزائد من الفترة التالية.
CREATE TABLE retainer_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agreement_id TEXT NOT NULL REFERENCES retainer_agreements(id),
  period_month TEXT NOT NULL CHECK(period_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  budget_units INTEGER NOT NULL CHECK(budget_units>0),
  carried_in_units INTEGER NOT NULL DEFAULT 0,
  consumed_units INTEGER NOT NULL DEFAULT 0 CHECK(consumed_units>=0),
  carried_out_units INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  closed_by TEXT,
  closed_at TEXT,
  closing_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agreement_id,period_month),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='closed')=(closed_by IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK(status='closed' OR carried_out_units=0)
) STRICT;
CREATE TRIGGER retainer_periods_closed_final BEFORE UPDATE ON retainer_periods
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed'
  OR NEW.agreement_id<>OLD.agreement_id OR NEW.period_month<>OLD.period_month OR NEW.budget_units<>OLD.budget_units OR NEW.carried_in_units<>OLD.carried_in_units
BEGIN SELECT RAISE(ABORT,'a closed period is corrected by a new period, not edited'); END;
CREATE TRIGGER retainer_periods_no_delete BEFORE DELETE ON retainer_periods BEGIN SELECT RAISE(ABORT,'periods are retained'); END;

CREATE TABLE retainer_consumption (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES retainer_periods(id),
  units INTEGER NOT NULL CHECK(units>0),
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER retainer_consumption_open_only BEFORE INSERT ON retainer_consumption
WHEN (SELECT status FROM retainer_periods WHERE id=NEW.period_id)<>'open'
BEGIN SELECT RAISE(ABORT,'consumption belongs to an open period'); END;
CREATE TRIGGER retainer_consumption_no_update BEFORE UPDATE ON retainer_consumption BEGIN SELECT RAISE(ABORT,'consumption is corrected by a new record'); END;
CREATE TRIGGER retainer_consumption_no_delete BEFORE DELETE ON retainer_consumption BEGIN SELECT RAISE(ABORT,'consumption is corrected by a new record'); END;

-- العتبات إعداد يضبطه صاحب العقد بمستلميه، لا رقم ثابت في الكود.
CREATE TABLE retainer_alert_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  agreement_id TEXT NOT NULL REFERENCES retainer_agreements(id),
  threshold_bp INTEGER NOT NULL CHECK(threshold_bp BETWEEN 1 AND 20000),
  recipients TEXT NOT NULL CHECK(json_valid(recipients) AND json_array_length(recipients)>0),
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(agreement_id,threshold_bp),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- تنبيه داخل المنصة لا رسالة خارجية. مفتاحه (الفترة، العتبة) فلا يتكرر التنبيه نفسه مهما تكرر التسجيل.
CREATE TABLE retainer_alerts (
  period_id TEXT NOT NULL REFERENCES retainer_periods(id),
  threshold_bp INTEGER NOT NULL,
  consumed_units INTEGER NOT NULL,
  available_units INTEGER NOT NULL,
  recipients TEXT NOT NULL CHECK(json_valid(recipients)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(period_id,threshold_bp)
) STRICT;
CREATE TRIGGER retainer_alerts_no_update BEFORE UPDATE ON retainer_alerts BEGIN SELECT RAISE(ABORT,'an alert is history'); END;
