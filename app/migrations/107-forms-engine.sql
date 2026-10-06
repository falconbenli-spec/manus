-- محرك النماذج الإلكترونية وكتالوج نماذج الشركة (41 نموذجًا مرقمًا وما يلحق بها).
-- النماذج اليوم ملفات Word وGoogle Docs. هنا تصير سجلات: تعريف مؤرخ بنسخة، ونسخة مملوءة مرتبطة بمشروع،
-- وتحقق على الخادم، ومسار اعتماد إلكتروني، وسجل قابل للقراءة والمشاركة برابط.
--
-- قرار المالك (20 سبتمبر): «لا ما ابي شي يطبع وكل شي يكون الكتروني وطريقة الموافقات تكون إلكترونية».
-- فلا طباعة ولا محاكاة لتخطيط الورقة، ولا سطر توقيع ولا صورة توقيع ولا «وقّع وامسح ضوئيًا».
-- كل سطر توقيع في النموذج الأصلي صار خطوة اعتماد إلكترونية: من اعتمد، وبأي تصريح، وعلى أي نسخة تعريف
-- وأي نسخة مملوءة، ومتى — ومعها قيد في سلسلة التدقيق. لذلك لا جدول توقيعات هنا ولا يُضاف.
--
-- ثلاث قواعد تحكم الجداول أدناه:
-- 1) التعريف مسودة حتى يقبله مالك بشري غير من أعدّه. المقترح المزروع من الكتالوج بلا معِدّ (prepared_by NULL)
--    فلا يُحسب قبوله اعتمادًا ذاتيًا، ويبقى مسودة تحمل اقتباس مصدرها حتى يقبلها المالك.
-- 2) التعريف المقبول لا يُعدَّل: تعديله نسخة جديدة تحل محله. والنسخة المعتمدة من نموذج مملوء لا تُعدَّل كذلك:
--    تعديلها نسخة جديدة من السلسلة نفسها، والقديمة تبقى قابلة للقراءة باعتماداتها.
-- 3) التقديم نفسه إقرار إلكتروني من معدّ النموذج: هويته ووقته ونسخته محفوظة في صف النسخة وفي سلسلة التدقيق،
--    فلا يُطلب منه «توقيع» زائد على ذلك.

-- 1) تعريف النموذج، مؤرخ بنسخة. spec يحمل الأقسام والحقول وكتل التوقيع وسلسلة الاعتماد والمرفقات المسموحة.
CREATE TABLE form_definitions(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  form_key TEXT NOT NULL CHECK(form_key GLOB 'FORM-[A-Z0-9-]*'),
  version INTEGER NOT NULL CHECK(version>=1),
  title_ar TEXT NOT NULL CHECK(length(trim(title_ar))>=3),
  title_en TEXT NOT NULL DEFAULT '',
  department_code TEXT NOT NULL CHECK(length(trim(department_code))>=2),
  department_name TEXT NOT NULL CHECK(length(trim(department_name))>=2),
  -- خطوة النموذج في مسار العمل، 01–24. NULL = لم تُحدَّد بعد في المصدر.
  step_no INTEGER CHECK(step_no IS NULL OR (step_no BETWEEN 1 AND 24)),
  spec TEXT NOT NULL CHECK(json_valid(spec)),
  -- اقتباس المصدر: رمز الملف الأصلي أو القرار الذي بُني عليه التعريف. لا تعريف بلا مصدر مذكور.
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=3),
  sla_days INTEGER CHECK(sla_days IS NULL OR (sla_days BETWEEN 0 AND 120)),
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','superseded','retired')),
  prepared_by TEXT REFERENCES users(id),
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  effective_from TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,form_key,version),
  CHECK(status='draft' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND effective_from IS NOT NULL)),
  -- من أعدّ التعريف لا يقبله. المقترح المزروع بلا معِدّ، فالقابل أول بشر يمسه.
  CHECK(accepted_by IS NULL OR prepared_by IS NULL OR accepted_by<>prepared_by)
) STRICT;
CREATE INDEX form_definitions_catalogue ON form_definitions(tenant_id,status,department_code,step_no);
CREATE TRIGGER form_definitions_frozen BEFORE UPDATE ON form_definitions
WHEN OLD.status<>'draft' AND (NEW.spec<>OLD.spec OR NEW.title_ar<>OLD.title_ar OR NEW.form_key<>OLD.form_key
  OR NEW.version<>OLD.version OR NEW.source_note<>OLD.source_note OR NEW.prepared_by IS NOT OLD.prepared_by)
BEGIN SELECT RAISE(ABORT,'an accepted form definition is replaced by a new version, never edited'); END;
CREATE TRIGGER form_definitions_no_delete BEFORE DELETE ON form_definitions
BEGIN SELECT RAISE(ABORT,'form definitions are retained'); END;

-- 2) الأسماء البديلة. المصادر تعيد استعمال الرمز نفسه لنماذج مختلفة (MOD-01، MOD-02)، وملف «دليل الأسلوب»
-- يحمل رمز VD-03 ومضمونه CW-02. المعرّف الداخلي المستقر (form_key) يحسم ذلك، والرمز الأصلي يبقى اسمًا بديلًا
-- ولا يُقدَّم بديلٌ قط على أنه المعرّف: البحث بالاسم البديل يعيد كل ما يطابقه.
CREATE TABLE form_definition_aliases(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  form_key TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK(alias_kind IN ('code','file','name_ar','name_en')),
  alias TEXT NOT NULL CHECK(length(trim(alias))>=2),
  -- رمز مكرر في المصادر: يُعلَّم هنا حتى لا تعرضه الشاشة معرّفًا.
  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK(ambiguous IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(tenant_id,form_key,alias_kind,alias)
) STRICT;
CREATE INDEX form_definition_aliases_lookup ON form_definition_aliases(tenant_id,alias);

-- 3) النموذج المملوء. ينتمي إلى مشروع أو طلب أو فرصة أو مورد. النسخ تتسلسل داخل chain_id الواحد.
CREATE TABLE form_instances(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  form_key TEXT NOT NULL,
  definition_id TEXT NOT NULL REFERENCES form_definitions(id),
  chain_id TEXT NOT NULL,
  instance_version INTEGER NOT NULL DEFAULT 1 CHECK(instance_version>=1),
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('project','request','opportunity','supplier')),
  subject_id TEXT NOT NULL CHECK(length(trim(subject_id))>=1),
  project_id TEXT,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL CHECK(status IN ('draft','submitted','incomplete','under_review','returned','approved','rejected','cancelled','superseded')),
  created_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  superseded_by TEXT REFERENCES form_instances(id),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chain_id,instance_version),
  CHECK(subject_kind<>'project' OR project_id=subject_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id)
) STRICT;
CREATE INDEX form_instances_subject ON form_instances(tenant_id,subject_kind,subject_id);
CREATE INDEX form_instances_chain ON form_instances(chain_id,instance_version);
CREATE TRIGGER form_instances_frozen BEFORE UPDATE ON form_instances
WHEN OLD.status IN ('approved','rejected','cancelled','superseded')
  AND (NEW.payload<>OLD.payload OR NEW.definition_id<>OLD.definition_id OR NEW.instance_version<>OLD.instance_version
    OR NEW.created_by<>OLD.created_by OR NEW.chain_id<>OLD.chain_id)
BEGIN SELECT RAISE(ABORT,'a decided form keeps its content; editing it opens a new version of the chain'); END;
CREATE TRIGGER form_instances_no_delete BEFORE DELETE ON form_instances
BEGIN SELECT RAISE(ABORT,'filled forms are retained'); END;

-- 4) الاعتماد الإلكتروني. كل سطر توقيع في النموذج الأصلي صف هنا (from_signature=1): الدور، وهوية من اعتمد،
-- والتصريح الذي اعتمد به، ونسخة التعريف ونسخة النموذج اللتان اعتمدهما، ووقت القرار.
-- الخطوة المحمولة (carried_from) اعتماد نسخة سابقة لم يمسّه التعديل: يبقى بقرار صاحبه ووقته ونسخته،
-- ولا يُعاد سؤاله. ما مسّه التعديل وحده يُفتح من جديد.
CREATE TABLE form_approvals(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  instance_id TEXT NOT NULL REFERENCES form_instances(id),
  position INTEGER NOT NULL CHECK(position>=0),
  step_key TEXT NOT NULL,
  capability TEXT NOT NULL,
  title TEXT NOT NULL,
  -- 1 = هذه الخطوة كانت سطر توقيع في النموذج الورقي، وصارت اعتمادًا إلكترونيًا.
  from_signature INTEGER NOT NULL DEFAULT 0 CHECK(from_signature IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','returned','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  -- النسختان اللتان يخصهما القرار: تبقيان كما هما في الاعتماد المحمول إلى نسخة أحدث.
  definition_version INTEGER NOT NULL,
  instance_version INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  carried_from TEXT REFERENCES form_approvals(id),
  created_at TEXT NOT NULL,
  UNIQUE(instance_id,position),
  CHECK(status='pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
) STRICT;
CREATE INDEX form_approvals_open ON form_approvals(tenant_id,status,capability);
CREATE TRIGGER form_approvals_decided_frozen BEFORE UPDATE ON form_approvals
WHEN OLD.status<>'pending' AND (NEW.decided_by IS NOT OLD.decided_by OR NEW.decided_at IS NOT OLD.decided_at
  OR NEW.definition_version<>OLD.definition_version OR NEW.instance_version<>OLD.instance_version)
BEGIN SELECT RAISE(ABORT,'an electronic approval records who decided, on which version and when; it is never rewritten'); END;
CREATE TRIGGER form_approvals_no_delete BEFORE DELETE ON form_approvals
BEGIN SELECT RAISE(ABORT,'approval steps are retained'); END;
