-- سجلات حماية البيانات الشخصية. المنصة تسجّل وتذكّر ولا تفتي:
-- لا مدة احتفاظ ولا أساس نظامي مكتوب في هذا الملف ولا في الكود. كلاهما حقل يبدأ فارغًا،
-- ولا يُقبل إلا مع مصدره وتاريخ تأكيد صاحبه — والقيد أدناه هو ما يفرض ذلك، لا نية المستخدم.
-- كل مدة وكل أساس يبقى «يحتاج مراجعة قانونية» مهما اكتمل؛ المنصة لا تصدر رأيًا نظاميًا.

CREATE TABLE processing_activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=5),
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  subject_categories TEXT NOT NULL CHECK(length(trim(subject_categories))>=2),
  data_categories TEXT NOT NULL CHECK(length(trim(data_categories))>=2),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK(sensitive IN (0,1)),
  sensitive_note TEXT NOT NULL DEFAULT '',
  legal_basis TEXT NOT NULL DEFAULT '',
  legal_basis_source TEXT NOT NULL DEFAULT '',
  legal_basis_confirmed_on TEXT,
  internal_access TEXT NOT NULL DEFAULT '',
  retention_period TEXT NOT NULL DEFAULT '',
  retention_source TEXT NOT NULL DEFAULT '',
  retention_confirmed_on TEXT,
  disposal_action TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  next_review_date TEXT,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','suggested')),
  source_tables TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded')),
  supersedes_id TEXT REFERENCES processing_activities(id),
  prepared_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يُعِدّ لا يعتمد، ومالك النشاط لا يعتمد نشاطه بنفسه إن كان هو من أعدّه
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK(status='draft' OR approved_by IS NOT NULL),
  CHECK(sensitive=0 OR length(trim(sensitive_note))>=5),
  -- أساس نظامي بلا مصدر وتاريخ تأكيد = ادعاء. يُرفض على مستوى القاعدة.
  CHECK(length(trim(legal_basis))=0 OR (length(trim(legal_basis_source))>=10 AND legal_basis_confirmed_on IS NOT NULL)),
  CHECK(length(trim(retention_period))=0 OR (length(trim(retention_source))>=10 AND retention_confirmed_on IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX processing_activities_name ON processing_activities(tenant_id,name) WHERE status<>'superseded';
CREATE TRIGGER processing_activities_versioned BEFORE UPDATE ON processing_activities WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale activity'); END;
-- المعتمد لا يُعدَّل: يبقى كما هو، ولا يتغير منه إلا انتقاله إلى «محل نشاط جديد».
CREATE TRIGGER processing_activities_approved_frozen BEFORE UPDATE ON processing_activities
WHEN OLD.status='approved' AND (NEW.status<>'superseded' OR NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose OR NEW.legal_basis<>OLD.legal_basis
  OR NEW.retention_period<>OLD.retention_period OR NEW.data_categories<>OLD.data_categories OR NEW.owner_id<>OLD.owner_id
  OR NEW.approved_by IS NOT OLD.approved_by OR NEW.prepared_by<>OLD.prepared_by)
BEGIN SELECT RAISE(ABORT,'an approved activity is replaced by a new record, never edited'); END;
CREATE TRIGGER processing_activities_no_delete BEFORE DELETE ON processing_activities BEGIN SELECT RAISE(ABORT,'activities are superseded, not deleted'); END;

-- نقل البيانات خارج المملكة. النقل المشتق من المنصة نفسها يحمل slug ثابتًا ليُربط بحالته الفعلية.
CREATE TABLE data_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK(length(trim(recipient))>=2),
  country TEXT NOT NULL CHECK(length(trim(country))>=2),
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  data_categories TEXT NOT NULL CHECK(length(trim(data_categories))>=2),
  safeguard TEXT NOT NULL DEFAULT '',
  safeguard_source TEXT NOT NULL DEFAULT '',
  risk_assessment TEXT NOT NULL DEFAULT '',
  assessed_by TEXT,
  assessed_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  next_review_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assessed','approved','stopped')),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','platform')),
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,slug),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(assessed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من قيّم المخاطر لا يعتمد النقل بناءً على تقييمه
  CHECK(approved_by IS NULL OR approved_by<>assessed_by),
  CHECK((assessed_by IS NULL)=(assessed_at IS NULL)),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK(status<>'assessed' OR (assessed_by IS NOT NULL AND length(trim(risk_assessment))>=20)),
  CHECK(status<>'approved' OR (approved_by IS NOT NULL AND assessed_by IS NOT NULL AND length(trim(safeguard))>=5 AND length(trim(risk_assessment))>=20))
) STRICT;
CREATE TRIGGER data_transfers_versioned BEFORE UPDATE ON data_transfers WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale transfer'); END;
CREATE TRIGGER data_transfers_assessment_frozen BEFORE UPDATE ON data_transfers
WHEN OLD.assessed_by IS NOT NULL AND (NEW.risk_assessment<>OLD.risk_assessment OR NEW.assessed_by IS NOT OLD.assessed_by OR NEW.assessed_at IS NOT OLD.assessed_at)
BEGIN SELECT RAISE(ABORT,'a recorded assessment is not rewritten'); END;
CREATE TRIGGER data_transfers_no_delete BEFORE DELETE ON data_transfers BEGIN SELECT RAISE(ABORT,'transfers are stopped, not deleted'); END;

-- طلبات أصحاب البيانات. التحقق من الهوية خطوة إلزامية لا تُتجاوز، ومن يتحقق ليس من يرد.
CREATE TABLE subject_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reference TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK(request_type IN ('access','correct','delete','port','object')),
  requester_name TEXT NOT NULL CHECK(length(trim(requester_name))>=3),
  requester_kind TEXT NOT NULL CHECK(requester_kind IN ('employee','candidate','client_contact','vendor','other')),
  subject_user_id TEXT,
  request_detail TEXT NOT NULL CHECK(length(trim(request_detail))>=10),
  received_on TEXT NOT NULL,
  due_date TEXT,
  due_source TEXT NOT NULL DEFAULT '',
  identity_verified_by TEXT,
  identity_verified_at TEXT,
  identity_evidence TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','verified','answered','refused','closed')),
  answered_by TEXT,
  answered_at TEXT,
  response TEXT NOT NULL DEFAULT '',
  response_evidence TEXT NOT NULL DEFAULT '',
  refused_by TEXT,
  refused_at TEXT,
  refusal_reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,reference),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(subject_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(identity_verified_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(answered_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(refused_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((identity_verified_by IS NULL)=(identity_verified_at IS NULL)),
  CHECK(identity_verified_by IS NULL OR length(trim(identity_evidence))>=5),
  -- لا رد قبل تحقق، ولا يكون الراد هو المتحقق
  CHECK(answered_by IS NULL OR identity_verified_by IS NOT NULL),
  CHECK(answered_by IS NULL OR answered_by<>identity_verified_by),
  CHECK((answered_by IS NULL)=(answered_at IS NULL)),
  CHECK(status NOT IN ('verified','answered') OR identity_verified_by IS NOT NULL),
  CHECK(status<>'answered' OR (answered_by IS NOT NULL AND length(trim(response))>=10)),
  CHECK(status<>'refused' OR (refused_by IS NOT NULL AND length(trim(refusal_reason))>=10)),
  -- المهلة رقم نظامي: لا تُقبل بلا مصدر يذكر من أكدها ومتى
  CHECK(due_date IS NULL OR length(trim(due_source))>=10)
) STRICT;
CREATE TRIGGER subject_requests_versioned BEFORE UPDATE ON subject_requests WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale subject request'); END;
CREATE TRIGGER subject_requests_identity_frozen BEFORE UPDATE ON subject_requests
WHEN OLD.identity_verified_by IS NOT NULL AND (NEW.identity_verified_by IS NOT OLD.identity_verified_by OR NEW.identity_evidence<>OLD.identity_evidence OR NEW.identity_verified_at IS NOT OLD.identity_verified_at)
BEGIN SELECT RAISE(ABORT,'identity verification is recorded once'); END;
CREATE TRIGGER subject_requests_answer_frozen BEFORE UPDATE ON subject_requests
WHEN OLD.answered_by IS NOT NULL AND (NEW.response<>OLD.response OR NEW.answered_by IS NOT OLD.answered_by OR NEW.request_type<>OLD.request_type)
BEGIN SELECT RAISE(ABORT,'a recorded answer is not rewritten'); END;
CREATE TRIGGER subject_requests_no_delete BEFORE DELETE ON subject_requests BEGIN SELECT RAISE(ABORT,'subject requests are retained'); END;

-- جدول الاحتفاظ: تنبيه لا تنفيذ. المنصة لا تتلف شيئًا ولا تحسب مدة من عندها.
CREATE TABLE retention_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  data_category TEXT NOT NULL CHECK(length(trim(data_category))>=3),
  retention_period TEXT NOT NULL DEFAULT '',
  retention_source TEXT NOT NULL DEFAULT '',
  confirmed_on TEXT,
  disposal_action TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  next_check_date TEXT NOT NULL,
  last_checked_on TEXT,
  last_checked_by TEXT,
  last_check_note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,data_category),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(last_checked_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(length(trim(retention_period))=0 OR (length(trim(retention_source))>=10 AND confirmed_on IS NOT NULL)),
  CHECK((last_checked_by IS NULL)=(last_checked_on IS NULL))
) STRICT;
CREATE TRIGGER retention_rules_versioned BEFORE UPDATE ON retention_rules WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale retention rule'); END;
CREATE TRIGGER retention_rules_no_delete BEFORE DELETE ON retention_rules BEGIN SELECT RAISE(ABORT,'retention rules are deactivated, not deleted'); END;

-- الحوادث: مهلة الإبلاغ يدخلها المختص بمصدرها، والإقفال يحتاج معالجة ودروسًا ومن يقفلها ليس من رفعها.
CREATE TABLE privacy_incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  description TEXT NOT NULL CHECK(length(trim(description))>=20),
  impact TEXT NOT NULL CHECK(length(trim(impact))>=10),
  affected_count INTEGER CHECK(affected_count IS NULL OR affected_count>=0),
  discovered_on TEXT NOT NULL,
  occurred_on TEXT,
  notification_deadline TEXT,
  notification_deadline_source TEXT NOT NULL DEFAULT '',
  notified_on TEXT,
  notification_note TEXT NOT NULL DEFAULT '',
  remediation TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','contained','closed')),
  closed_by TEXT,
  closed_at TEXT,
  reported_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(reported_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(notification_deadline IS NULL OR length(trim(notification_deadline_source))>=10),
  CHECK((closed_by IS NULL)=(closed_at IS NULL)),
  CHECK(closed_by IS NULL OR closed_by<>reported_by),
  CHECK(status<>'closed' OR (closed_by IS NOT NULL AND length(trim(remediation))>=10 AND length(trim(lessons))>=10))
) STRICT;
CREATE TRIGGER privacy_incidents_versioned BEFORE UPDATE ON privacy_incidents WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale incident'); END;
CREATE TRIGGER privacy_incidents_closed_frozen BEFORE UPDATE ON privacy_incidents
WHEN OLD.status='closed' BEGIN SELECT RAISE(ABORT,'a closed incident is not rewritten'); END;
CREATE TRIGGER privacy_incidents_no_delete BEFORE DELETE ON privacy_incidents BEGIN SELECT RAISE(ABORT,'incidents are retained'); END;
