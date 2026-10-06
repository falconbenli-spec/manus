-- حزم التعيين والمغادرة: رحلة واحدة متعددة الإدارات لموظف يبدأ أو يغادر.
--
-- الخطوات قالب يضعه مالك إجراء كل إدارة، ولذلك تبدأ الجداول فارغة: المنصة لا تعرف ماذا تفعل
-- إدارة الدعم التقني في يوم المباشرة ولا ماذا تسلّم المالية في يوم المغادرة، ولا تخترع قائمة نيابة عنهم.
--
-- لا مدة إشعار ولا مهلة نظامية في هذا المخطط ولا في الكود: تاريخ المباشرة أو آخر يوم عمل حقل
-- يدخله مدير الموارد البشرية ومعه سنده، والمدة المستهدفة لكل خطوة رقم يضعه مالك الإجراء نفسه.
--
-- إخلاء الطرف يُشتق مما تعرفه المنصة فعلًا عن الشخص (عهد، أصول، معدات، صلاحيات، سلف، طلبات،
-- مهام، اعتمادات معلقة، تفويضات، مشاريع)، لا من قالب عام. وقاعدته الجوهرية مفروضة بـCHECK:
-- لا أحد يخلي طرف نفسه.

CREATE TABLE lifecycle_step_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('onboarding','offboarding')),
  code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 2 AND 40),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  department_id TEXT NOT NULL,
  owner_role TEXT NOT NULL CHECK(owner_role IN ('manager','hr','it','pm','employee')),
  -- المدة المستهدفة بأيام عمل من فتح الحزمة. صفر = في اليوم نفسه. لا قيمة افتراضية في الكود.
  target_days INTEGER NOT NULL CHECK(target_days BETWEEN 0 AND 120),
  acceptance TEXT NOT NULL CHECK(length(trim(acceptance))>=10),
  depends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  defined_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,kind,code),
  UNIQUE(id,tenant_id,kind),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(defined_by,tenant_id) REFERENCES users(id,tenant_id),
  -- الاعتمادية لا تعبر الكيان ولا تعبر نوع الحزمة: خطوة مغادرة لا تعتمد على خطوة تعيين.
  FOREIGN KEY(depends_on,tenant_id,kind) REFERENCES lifecycle_step_templates(id,tenant_id,kind),
  -- الحلقة المباشرة ممنوعة هنا؛ الحلقة عبر سلسلة تُفحص عند الحفظ في الوحدة.
  CHECK(depends_on IS NULL OR depends_on<>id)
) STRICT;
CREATE INDEX lifecycle_templates_kind ON lifecycle_step_templates(tenant_id,kind,active);
CREATE TRIGGER lifecycle_templates_versioned BEFORE UPDATE ON lifecycle_step_templates
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.code<>OLD.code OR NEW.defined_by<>OLD.defined_by
BEGIN SELECT RAISE(ABORT,'a template keeps its code, kind and author; every change bumps its version'); END;
CREATE TRIGGER lifecycle_templates_no_delete BEFORE DELETE ON lifecycle_step_templates
BEGIN SELECT RAISE(ABORT,'a template is deactivated, not deleted: bundles already opened point at it'); END;

CREATE TABLE lifecycle_bundles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('onboarding','offboarding')),
  employee_id TEXT NOT NULL,
  -- مالك الحزمة: من تُصعَّد إليه الخطوة المتأخرة ومن يظهر له القرار في «بانتظار قراري».
  owner_id TEXT NOT NULL,
  -- تاريخ المباشرة أو آخر يوم عمل. المنصة لا تشتقه ولا تفترض له مهلة؛ يُدخل ومعه سنده.
  effective_date TEXT NOT NULL CHECK(effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  date_basis TEXT NOT NULL CHECK(length(trim(date_basis))>=10),
  status TEXT NOT NULL CHECK(status IN ('open','closed','cancelled')),
  opened_by TEXT NOT NULL REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  close_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(id,employee_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  -- صاحب الرحلة لا يفتحها ولا يملكها ولا يقفلها.
  CHECK(opened_by<>employee_id),
  CHECK(owner_id<>employee_id),
  CHECK(closed_by IS NULL OR closed_by<>employee_id),
  CHECK((status IN ('closed','cancelled'))=(closed_by IS NOT NULL)),
  CHECK(status='open' OR length(trim(close_note))>=10)
) STRICT;
CREATE UNIQUE INDEX lifecycle_bundles_one_open ON lifecycle_bundles(tenant_id,employee_id,kind) WHERE status='open';
CREATE INDEX lifecycle_bundles_owner ON lifecycle_bundles(tenant_id,owner_id,status);
CREATE TRIGGER lifecycle_bundles_versioned BEFORE UPDATE ON lifecycle_bundles
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.employee_id<>OLD.employee_id
  OR NEW.opened_by<>OLD.opened_by OR OLD.status IN ('closed','cancelled')
BEGIN SELECT RAISE(ABORT,'a settled bundle is final; its person and kind never change'); END;
CREATE TRIGGER lifecycle_bundles_no_delete BEFORE DELETE ON lifecycle_bundles BEGIN SELECT RAISE(ABORT,'bundles are retained'); END;

CREATE TABLE lifecycle_steps (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bundle_id TEXT NOT NULL,
  -- صاحب الرحلة منسوخ هنا حتى يستطيع CHECK منعه من إغلاق خطوة رحلته بنفسه.
  employee_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES lifecycle_step_templates(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  department_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  target_days INTEGER NOT NULL CHECK(target_days BETWEEN 0 AND 120),
  due_date TEXT NOT NULL CHECK(due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  acceptance TEXT NOT NULL CHECK(length(trim(acceptance))>=10),
  depends_on TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','done','cancelled')),
  evidence TEXT NOT NULL DEFAULT '',
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,bundle_id),
  UNIQUE(bundle_id,template_id),
  FOREIGN KEY(bundle_id,employee_id) REFERENCES lifecycle_bundles(id,employee_id),
  -- الاعتمادية تبقى داخل الحزمة نفسها.
  FOREIGN KEY(depends_on,bundle_id) REFERENCES lifecycle_steps(id,bundle_id),
  CHECK(depends_on IS NULL OR depends_on<>id),
  CHECK(owner_id<>employee_id),
  CHECK(closed_by IS NULL OR closed_by<>employee_id),
  CHECK((status='open')=(closed_by IS NULL)),
  -- «مغلقة» تعني مغلقة بدليلها: نسبة الاكتمال تُحسب من هذه ولا تقبل تقديرًا.
  CHECK(status<>'done' OR length(trim(evidence))>=10),
  CHECK(status<>'cancelled' OR length(trim(evidence))>=10)
) STRICT;
CREATE INDEX lifecycle_steps_owner ON lifecycle_steps(tenant_id,owner_id,status);
CREATE INDEX lifecycle_steps_bundle ON lifecycle_steps(bundle_id,status);
CREATE TRIGGER lifecycle_steps_versioned BEFORE UPDATE ON lifecycle_steps
WHEN NEW.version<>OLD.version+1 OR NEW.bundle_id<>OLD.bundle_id OR NEW.employee_id<>OLD.employee_id
  OR NEW.template_id<>OLD.template_id OR NEW.acceptance<>OLD.acceptance OR OLD.status IN ('done','cancelled')
BEGIN SELECT RAISE(ABORT,'a settled step is final; its acceptance criterion never changes after the bundle opened'); END;
CREATE TRIGGER lifecycle_steps_no_delete BEFORE DELETE ON lifecycle_steps BEGIN SELECT RAISE(ABORT,'steps are cancelled with a reason, not deleted'); END;

-- التصعيد قرار مسجل لمالك الحزمة على خطوة تجاوزت مدتها المستهدفة: يمدد الموعد أو ينقل المالك أو يوثق السبب.
CREATE TABLE lifecycle_escalations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bundle_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  new_due_date TEXT CHECK(new_due_date IS NULL OR new_due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  new_owner_id TEXT REFERENCES users(id),
  decided_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(step_id,bundle_id) REFERENCES lifecycle_steps(id,bundle_id)
) STRICT;
CREATE INDEX lifecycle_escalations_step ON lifecycle_escalations(step_id,created_at);
CREATE TRIGGER lifecycle_escalations_no_update BEFORE UPDATE ON lifecycle_escalations BEGIN SELECT RAISE(ABORT,'an escalation decision is never rewritten'); END;
CREATE TRIGGER lifecycle_escalations_no_delete BEFORE DELETE ON lifecycle_escalations BEGIN SELECT RAISE(ABORT,'escalation decisions are retained'); END;

CREATE TABLE lifecycle_clearance_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bundle_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  -- المصدر هو الجدول الذي عرفت منه المنصة هذا البند. لا بند بلا مصدر قائم.
  source TEXT NOT NULL CHECK(source IN ('custody','fixed_asset','equipment','access_grant','account','advance','request','request_task','project_task','approval_step','delegation','project')),
  source_id TEXT NOT NULL CHECK(length(trim(source_id))>0),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  detail TEXT NOT NULL DEFAULT '',
  -- مالي = يمنع اعتماد التسوية النهائية حتى يُغلق بدليله.
  financial INTEGER NOT NULL CHECK(financial IN (0,1)),
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor>=0),
  -- من ينفذ الفعل خارج المنصة. المنصة تُظهر ولا تنفذ: لا تسحب صلاحية ولا تعطل حسابًا.
  action_owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('open','cleared')),
  evidence TEXT NOT NULL DEFAULT '',
  cleared_by TEXT REFERENCES users(id),
  cleared_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bundle_id,source,source_id),
  FOREIGN KEY(bundle_id,employee_id) REFERENCES lifecycle_bundles(id,employee_id),
  -- جوهر إخلاء الطرف: لا أحد يخلي طرف نفسه، بأي دور وبأي تصريح.
  CHECK(cleared_by IS NULL OR cleared_by<>employee_id),
  CHECK((status='cleared')=(cleared_by IS NOT NULL)),
  CHECK(status<>'cleared' OR length(trim(evidence))>=10),
  -- بند مالي بلا مبلغ لا يُقاس؛ الصفر مسموح ويعني «قيمة غير مسجلة في المنصة» ويظل مانعًا.
  CHECK(financial=0 OR amount_minor IS NOT NULL)
) STRICT;
CREATE INDEX lifecycle_clearance_employee ON lifecycle_clearance_items(tenant_id,employee_id,status);
CREATE TRIGGER lifecycle_clearance_versioned BEFORE UPDATE ON lifecycle_clearance_items
WHEN NEW.version<>OLD.version+1 OR NEW.bundle_id<>OLD.bundle_id OR NEW.employee_id<>OLD.employee_id
  OR NEW.source<>OLD.source OR NEW.source_id<>OLD.source_id OR OLD.status='cleared'
BEGIN SELECT RAISE(ABORT,'a cleared item is final; a clearance item never changes the source it was derived from'); END;
CREATE TRIGGER lifecycle_clearance_no_delete BEFORE DELETE ON lifecycle_clearance_items BEGIN SELECT RAISE(ABORT,'clearance items are retained'); END;
