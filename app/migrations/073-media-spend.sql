-- الصرف الإعلامي (المخطط مقابل الفعلي) وتقرير العميل الدوري.
--
-- لا اتصال بأي منصة إعلانية: الصرف الفعلي يدخله موظف أو يستورده من ملف CSV صدّره بنفسه،
-- وكل رقم يحمل نوع مصدره ومرجعه ومن أدخله ومتى. رقم بلا مصدر لا يُقبل، والقيد هنا في المخطط لا في الكود وحده.
-- العتبات إعداد يضبطه مالك الحملة بأساسه؛ لا نسبة ثابتة في الكود ولا قيمة افتراضية في المخطط.
-- التجاوز لا يوقف حملة: يظهر تنبيهًا ويحتاج إقرارًا مكتوبًا، لأن إيقاف حملة عميل قرار تجاري.

CREATE TABLE media_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  budget_reference TEXT NOT NULL CHECK(length(trim(budget_reference))>=5),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','superseded','discarded')),
  prepared_by TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,revision),UNIQUE(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يُعِدّ خطة الصرف لا يعتمدها.
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((status IN ('approved','superseded'))=(approved_by IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX media_plans_one_approved ON media_plans(campaign_id) WHERE status='approved';
CREATE UNIQUE INDEX media_plans_one_draft ON media_plans(campaign_id) WHERE status='draft';
CREATE TRIGGER media_plans_tenant BEFORE INSERT ON media_plans
WHEN NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.tenant_id=NEW.tenant_id AND c.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'a media plan belongs to its campaign tenant and client'); END;
-- المعتمد لا يُعدَّل: لا يتغير فيه إلا انتقاله إلى «حلّت محله نسخة أحدث».
CREATE TRIGGER media_plans_versioned BEFORE UPDATE ON media_plans
WHEN NEW.version<>OLD.version+1 OR NEW.campaign_id<>OLD.campaign_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.client_id<>OLD.client_id OR NEW.revision<>OLD.revision OR NEW.prepared_by<>OLD.prepared_by
  OR OLD.status IN ('superseded','discarded')
  OR (OLD.status='approved' AND (NEW.status<>'superseded' OR NEW.budget_reference<>OLD.budget_reference OR NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approval_note<>OLD.approval_note))
BEGIN SELECT RAISE(ABORT,'an approved media plan is replaced by a new revision, not edited'); END;
CREATE TRIGGER media_plans_no_delete BEFORE DELETE ON media_plans BEGIN SELECT RAISE(ABORT,'media plans are retained'); END;

CREATE TABLE media_plan_lines (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES media_plans(id),
  channel TEXT NOT NULL CHECK(length(channel)>=1),
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date>=start_date),
  planned_minor INTEGER NOT NULL CHECK(planned_minor BETWEEN 1 AND 1000000000000),
  target_metric TEXT NOT NULL CHECK(length(trim(target_metric))>=2),
  target_value INTEGER NOT NULL CHECK(target_value BETWEEN 1 AND 1000000000000),
  target_unit TEXT NOT NULL CHECK(length(trim(target_unit))>=1),
  created_at TEXT NOT NULL,
  UNIQUE(plan_id,channel),UNIQUE(id,plan_id)
) STRICT;
CREATE TRIGGER media_plan_lines_draft_only BEFORE INSERT ON media_plan_lines
WHEN (SELECT status FROM media_plans WHERE id=NEW.plan_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'lines are written while the plan is a draft'); END;
CREATE TRIGGER media_plan_lines_no_update BEFORE UPDATE ON media_plan_lines BEGIN SELECT RAISE(ABORT,'plan lines are rewritten with their draft, never edited in place'); END;
CREATE TRIGGER media_plan_lines_delete_draft BEFORE DELETE ON media_plan_lines
WHEN (SELECT status FROM media_plans WHERE id=OLD.plan_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'lines of a decided plan are retained'); END;

-- تعيين أعمدة ملف المنصة الإعلانية: يُحفظ لكل قناة ويُعاد استخدامه.
CREATE TABLE media_import_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL CHECK(length(channel)>=1),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  delimiter TEXT NOT NULL CHECK(delimiter IN ('comma','semicolon','tab','pipe')),
  date_format TEXT NOT NULL CHECK(date_format IN ('YYYY-MM-DD','DD/MM/YYYY','DD-MM-YYYY','MM/DD/YYYY')),
  header_rows INTEGER NOT NULL CHECK(header_rows BETWEEN 0 AND 20),
  columns TEXT NOT NULL CHECK(json_valid(columns)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,channel,name),UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
-- التعيين الذي استوردت به ملفات لا يُعاد كتابته: يوقف ويُنشأ غيره، فيبقى معنى كل دفعة قديمة مقروءًا.
CREATE TRIGGER media_import_profiles_versioned BEFORE UPDATE ON media_import_profiles
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.channel<>OLD.channel OR NEW.name<>OLD.name OR NEW.delimiter<>OLD.delimiter OR NEW.date_format<>OLD.date_format
  OR NEW.header_rows<>OLD.header_rows OR NEW.columns<>OLD.columns OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a column profile is deactivated and replaced, not rewritten'); END;
CREATE TRIGGER media_import_profiles_no_delete BEFORE DELETE ON media_import_profiles BEGIN SELECT RAISE(ABORT,'column profiles are deactivated, not deleted'); END;

-- دفعة استيراد: بصمة محتوى الملف تمنع استيراده مرتين في الكيان كله.
CREATE TABLE media_spend_imports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK(length(trim(file_name))>=3),
  file_digest TEXT NOT NULL CHECK(length(file_digest)=64 AND file_digest NOT GLOB '*[^0-9a-f]*'),
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('platform_screenshot','account_statement','invoice')),
  evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>=5),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
  total_minor INTEGER NOT NULL CHECK(total_minor>=0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  cancelled_by TEXT REFERENCES users(id),
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,file_digest),UNIQUE(id,tenant_id),
  FOREIGN KEY(plan_id,tenant_id) REFERENCES media_plans(id,tenant_id),
  FOREIGN KEY(profile_id,tenant_id) REFERENCES media_import_profiles(id,tenant_id),
  FOREIGN KEY(imported_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='cancelled')=(cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND length(trim(cancel_reason))>=10))
) STRICT;
CREATE TRIGGER media_spend_imports_versioned BEFORE UPDATE ON media_spend_imports
WHEN NEW.version<>OLD.version+1 OR OLD.status='cancelled' OR NEW.file_digest<>OLD.file_digest OR NEW.plan_id<>OLD.plan_id OR NEW.row_count<>OLD.row_count OR NEW.total_minor<>OLD.total_minor
  OR NEW.imported_by<>OLD.imported_by OR NEW.evidence_kind<>OLD.evidence_kind OR NEW.evidence_reference<>OLD.evidence_reference
BEGIN SELECT RAISE(ABORT,'an import batch is cancelled as a whole, never rewritten'); END;
CREATE TRIGGER media_spend_imports_no_delete BEFORE DELETE ON media_spend_imports BEGIN SELECT RAISE(ABORT,'import batches are retained'); END;

-- الصرف الفعلي. المصدر إلزامي بنوعه ومرجعه، ومن أدخله ومتى. لا تعديل ولا حذف: التصحيح بسطر جديد يحل محل القديم.
CREATE TABLE media_spend_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  spend_date TEXT NOT NULL CHECK(spend_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000000),
  evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('platform_screenshot','account_statement','invoice')),
  evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>=5),
  entry_method TEXT NOT NULL CHECK(entry_method IN ('manual','file_import')),
  import_id TEXT,
  import_line_no INTEGER,
  -- من دفع للمنصة: العميل من حسابه مباشرة، أو الوكالة بمالها نيابة عنه (التزام مالي يُربط بالمسار المالي).
  funding TEXT NOT NULL CHECK(funding IN ('client_direct','agency_on_behalf')),
  corrects_id TEXT REFERENCES media_spend_entries(id),
  correction_reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),UNIQUE(import_id,import_line_no),
  FOREIGN KEY(plan_id,tenant_id) REFERENCES media_plans(id,tenant_id),
  FOREIGN KEY(line_id,plan_id) REFERENCES media_plan_lines(id,plan_id),
  FOREIGN KEY(import_id,tenant_id) REFERENCES media_spend_imports(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((entry_method='file_import')=(import_id IS NOT NULL AND import_line_no IS NOT NULL)),
  CHECK(corrects_id IS NULL OR length(trim(correction_reason))>=10),
  CHECK(amount_minor>0 OR corrects_id IS NOT NULL)
) STRICT;
CREATE INDEX media_spend_entries_plan ON media_spend_entries(plan_id,line_id,spend_date);
CREATE UNIQUE INDEX media_spend_entries_one_correction ON media_spend_entries(corrects_id) WHERE corrects_id IS NOT NULL;
CREATE TRIGGER media_spend_entries_approved_plan BEFORE INSERT ON media_spend_entries
WHEN (SELECT status FROM media_plans WHERE id=NEW.plan_id) NOT IN ('approved','superseded')
  OR ((SELECT status FROM media_plans WHERE id=NEW.plan_id)='superseded' AND NEW.corrects_id IS NULL)
BEGIN SELECT RAISE(ABORT,'actual spend is recorded against an approved plan'); END;
CREATE TRIGGER media_spend_entries_no_update BEFORE UPDATE ON media_spend_entries BEGIN SELECT RAISE(ABORT,'a spend entry is corrected by a new entry'); END;
CREATE TRIGGER media_spend_entries_no_delete BEFORE DELETE ON media_spend_entries BEGIN SELECT RAISE(ABORT,'a spend entry is corrected by a new entry'); END;

-- ربط صرف الوكالة نيابة عن العميل بالمسار المالي القائم: أمر شراء داخلي معتمد، وفاتورة المورد إن سُجلت.
-- لا يُنشأ هنا التزام ولا مستحق ولا دفعة؛ هذه كلها تبقى في المشتريات والمدفوعات.
CREATE TABLE media_spend_commitments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entry_id TEXT NOT NULL UNIQUE,
  purchase_id TEXT NOT NULL,
  invoice_id TEXT,
  note TEXT NOT NULL CHECK(length(trim(note))>=5),
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  FOREIGN KEY(entry_id,tenant_id) REFERENCES media_spend_entries(id,tenant_id),
  FOREIGN KEY(purchase_id,tenant_id) REFERENCES procurement_purchases(id,tenant_id),
  FOREIGN KEY(purchase_id) REFERENCES procurement_orders(purchase_id),
  FOREIGN KEY(invoice_id,purchase_id) REFERENCES procurement_invoices(id,purchase_id),
  FOREIGN KEY(linked_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER media_spend_commitments_on_behalf BEFORE INSERT ON media_spend_commitments
WHEN (SELECT funding FROM media_spend_entries WHERE id=NEW.entry_id)<>'agency_on_behalf'
BEGIN SELECT RAISE(ABORT,'only spend paid by the agency on behalf of the client is a commitment'); END;
CREATE TRIGGER media_spend_commitments_no_update BEFORE UPDATE ON media_spend_commitments BEGIN SELECT RAISE(ABORT,'a commitment link is retained as recorded'); END;
CREATE TRIGGER media_spend_commitments_no_delete BEFORE DELETE ON media_spend_commitments BEGIN SELECT RAISE(ABORT,'a commitment link is retained as recorded'); END;

-- ما فوترناه للعميل من هذا الصرف: إشارة إلى استحقاق قائم في مسار الذمم، لا فاتورة تُنشأ هنا.
CREATE TABLE media_spend_billings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES ar_claims(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(plan_id,claim_id),
  FOREIGN KEY(plan_id,tenant_id) REFERENCES media_plans(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER media_spend_billings_claim BEFORE INSERT ON media_spend_billings
WHEN NOT EXISTS(SELECT 1 FROM ar_claims a WHERE a.id=NEW.claim_id AND a.tenant_id=NEW.tenant_id AND a.status='approved' AND a.currency='SAR' AND CAST(a.amount_minor AS INTEGER)>=NEW.amount_minor)
BEGIN SELECT RAISE(ABORT,'billing points to an approved SAR receivable of this tenant and never exceeds it'); END;
CREATE TRIGGER media_spend_billings_no_update BEFORE UPDATE ON media_spend_billings BEGIN SELECT RAISE(ABORT,'a billing link is retained as recorded'); END;
CREATE TRIGGER media_spend_billings_no_delete BEFORE DELETE ON media_spend_billings BEGIN SELECT RAISE(ABORT,'a billing link is retained as recorded'); END;

-- عتبة تنبيه يضبطها مالك الحملة بأساسها. لا قيمة افتراضية: حملة بلا عتبة تُعرض «بلا عتبات».
CREATE TABLE media_spend_thresholds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  threshold_bp INTEGER NOT NULL CHECK(threshold_bp BETWEEN 1 AND 100000),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  retired_by TEXT REFERENCES users(id),
  retired_at TEXT,
  retire_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((retired_at IS NULL)=(retired_by IS NULL)),
  CHECK(retired_at IS NULL OR length(trim(retire_reason))>=5)
) STRICT;
CREATE UNIQUE INDEX media_spend_thresholds_live ON media_spend_thresholds(campaign_id,threshold_bp) WHERE retired_at IS NULL;
CREATE TRIGGER media_spend_thresholds_owner BEFORE INSERT ON media_spend_thresholds
WHEN NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.id=NEW.campaign_id AND c.tenant_id=NEW.tenant_id AND c.owner_id=NEW.set_by)
BEGIN SELECT RAISE(ABORT,'thresholds are set by the campaign owner'); END;
CREATE TRIGGER media_spend_thresholds_versioned BEFORE UPDATE ON media_spend_thresholds
WHEN NEW.version<>OLD.version+1 OR OLD.retired_at IS NOT NULL OR NEW.threshold_bp<>OLD.threshold_bp OR NEW.basis<>OLD.basis OR NEW.campaign_id<>OLD.campaign_id OR NEW.set_by<>OLD.set_by OR NEW.set_at<>OLD.set_at
BEGIN SELECT RAISE(ABORT,'a threshold is retired and replaced, not edited'); END;
CREATE TRIGGER media_spend_thresholds_no_delete BEFORE DELETE ON media_spend_thresholds BEGIN SELECT RAISE(ABORT,'thresholds are retained'); END;

-- الإقرار المكتوب ببلوغ عتبة أو بتجاوز الميزانية المخططة. يُسجَّل مرة ولا يُعاد كتابته، ولا يوقف شيئًا بنفسه.
CREATE TABLE media_spend_acknowledgements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('threshold','over_budget')),
  threshold_id TEXT,
  observed_minor INTEGER NOT NULL CHECK(observed_minor>=0),
  planned_minor INTEGER NOT NULL CHECK(planned_minor>0),
  decision TEXT NOT NULL CHECK(decision IN ('continue','reduce','pause_requested')),
  note TEXT NOT NULL CHECK(length(trim(note))>=20),
  acknowledged_by TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  FOREIGN KEY(plan_id,tenant_id) REFERENCES media_plans(id,tenant_id),
  FOREIGN KEY(threshold_id,tenant_id) REFERENCES media_spend_thresholds(id,tenant_id),
  FOREIGN KEY(acknowledged_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='threshold')=(threshold_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX media_spend_ack_threshold ON media_spend_acknowledgements(plan_id,threshold_id) WHERE threshold_id IS NOT NULL;
CREATE UNIQUE INDEX media_spend_ack_over_budget ON media_spend_acknowledgements(plan_id) WHERE kind='over_budget';
CREATE TRIGGER media_spend_ack_no_update BEFORE UPDATE ON media_spend_acknowledgements BEGIN SELECT RAISE(ABORT,'an acknowledgement is written once'); END;
CREATE TRIGGER media_spend_ack_no_delete BEFORE DELETE ON media_spend_acknowledgements BEGIN SELECT RAISE(ABORT,'an acknowledgement is written once'); END;

-- ===== تقرير العميل الدوري =====
CREATE TABLE client_report_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly','quarterly','campaign_end')),
  sections TEXT NOT NULL CHECK(json_valid(sections)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(client_id,name),UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER client_report_templates_tenant BEFORE INSERT ON client_report_templates
WHEN NOT EXISTS(SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a template belongs to a client of the same tenant'); END;
CREATE TRIGGER client_report_templates_versioned BEFORE UPDATE ON client_report_templates
WHEN NEW.version<>OLD.version+1 OR NEW.client_id<>OLD.client_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by
BEGIN SELECT RAISE(ABORT,'a template keeps its client and is edited by version'); END;
CREATE TRIGGER client_report_templates_no_delete BEFORE DELETE ON client_report_templates BEGIN SELECT RAISE(ABORT,'templates are deactivated, not deleted'); END;

-- التقرير لقطة من بيانات المنصة ببصمتها. التعليق والخطوة التالية يكتبهما إنسان ويوقّع باسمه؛ لا نص يولده نموذج.
CREATE TABLE client_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  template_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  period_start TEXT NOT NULL CHECK(period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end TEXT NOT NULL CHECK(period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_end>=period_start),
  body TEXT NOT NULL CHECK(json_valid(body)),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  commentary TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','signed','superseded','discarded')),
  supersedes_id TEXT REFERENCES client_reports(id),
  prepared_by TEXT NOT NULL,
  signed_by TEXT REFERENCES users(id),
  signed_name TEXT NOT NULL DEFAULT '',
  signed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(template_id,tenant_id) REFERENCES client_report_templates(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من ولّد التقرير لا يوقّعه: ما يذهب لعميل يمر على شخصين.
  CHECK(signed_by IS NULL OR signed_by<>prepared_by),
  CHECK((status IN ('signed','superseded'))=(signed_by IS NOT NULL)),
  CHECK(signed_by IS NULL OR (length(trim(commentary))>=20 AND length(trim(signed_name))>=2 AND signed_at IS NOT NULL))
) STRICT;
CREATE INDEX client_reports_client ON client_reports(client_id,period_end);
CREATE UNIQUE INDEX client_reports_one_successor ON client_reports(supersedes_id) WHERE supersedes_id IS NOT NULL AND status<>'discarded';
CREATE TRIGGER client_reports_tenant BEFORE INSERT ON client_reports
WHEN NOT EXISTS(SELECT 1 FROM client_report_templates t WHERE t.id=NEW.template_id AND t.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'a report is generated from a template of the same client'); END;
-- الموقَّع لا يُعدَّل: لا يتغير فيه إلا انتقاله إلى «حلّ محله تقرير مصحَّح». والأرقام لا تُحرَّر في أي حالة.
CREATE TRIGGER client_reports_versioned BEFORE UPDATE ON client_reports
WHEN NEW.version<>OLD.version+1 OR NEW.body<>OLD.body OR NEW.digest<>OLD.digest OR NEW.client_id<>OLD.client_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.template_id<>OLD.template_id
  OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end OR NEW.prepared_by<>OLD.prepared_by OR NEW.supersedes_id IS NOT OLD.supersedes_id
  OR OLD.status IN ('superseded','discarded')
  OR (OLD.status='signed' AND (NEW.status<>'superseded' OR NEW.commentary<>OLD.commentary OR NEW.next_step<>OLD.next_step OR NEW.signed_by IS NOT OLD.signed_by OR NEW.signed_name<>OLD.signed_name OR NEW.signed_at IS NOT OLD.signed_at OR NEW.title<>OLD.title))
BEGIN SELECT RAISE(ABORT,'a signed client report is corrected by a new report; its figures are never edited'); END;
CREATE TRIGGER client_reports_no_delete BEFORE DELETE ON client_reports BEGIN SELECT RAISE(ABORT,'client reports are retained'); END;
