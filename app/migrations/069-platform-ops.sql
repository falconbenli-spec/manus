-- بنية تشغيل المنصة: طابور المهام الخلفية، وأعلام الميزات، وجرد مساعدي الذكاء الاصطناعي، وحزمة تقييمهم.

-- ───── طابور المهام ─────
-- المهمة تنفّذ ما قرره إنسان: تحمل من طلبها والفعل المعتمد الذي نشأت عنه. لا مهمة بلا مصدر.
-- idempotency_key فريد داخل الكيان: الطلب نفسه مرتين = مهمة واحدة.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK(length(type) BETWEEN 3 AND 80),
  payload TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload)),
  payload_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
  requested_by TEXT NOT NULL,
  source_entity TEXT NOT NULL CHECK(length(trim(source_entity))>0),
  source_id TEXT NOT NULL CHECK(length(trim(source_id))>0),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','dead','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  last_error TEXT NOT NULL DEFAULT '',
  locked_by TEXT,
  locked_until TEXT,
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='running')=(locked_by IS NOT NULL)),
  CHECK((status IN ('done','dead','cancelled'))=(finished_at IS NOT NULL))
) STRICT;
CREATE INDEX jobs_due ON jobs(tenant_id,status,due_at);
CREATE TRIGGER jobs_fixed BEFORE UPDATE ON jobs
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.type<>OLD.type OR NEW.payload<>OLD.payload OR NEW.idempotency_key<>OLD.idempotency_key
  OR NEW.requested_by<>OLD.requested_by OR NEW.source_entity<>OLD.source_entity OR NEW.source_id<>OLD.source_id
  OR OLD.status IN ('done','cancelled')
  OR (OLD.status='dead' AND NEW.status NOT IN ('queued','cancelled'))
  OR (NEW.status='done' AND OLD.status<>'running')
BEGIN SELECT RAISE(ABORT,'a finished job is never rewritten or run again'); END;
CREATE TRIGGER jobs_no_delete BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT,'jobs are retained'); END;

-- ───── أعلام الميزات ─────
-- expires_on إلزامي: علم بلا انتهاء دَين دائم. العلم المنتهي مطفأ حكمًا ولو بقي enabled=1.
CREATE TABLE feature_flags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL CHECK(length(key) BETWEEN 3 AND 60),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  scope TEXT NOT NULL CHECK(scope IN ('all','department','user')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  expires_on TEXT NOT NULL CHECK(expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'live' CHECK(status IN ('live','retired')),
  retired_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,key),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(updated_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='retired')=(retired_at IS NOT NULL)),
  CHECK(status='live' OR enabled=0)
) STRICT;
CREATE TABLE feature_flag_targets (
  flag_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY(flag_id,target_id),
  FOREIGN KEY(flag_id,tenant_id) REFERENCES feature_flags(id,tenant_id)
) STRICT;
CREATE TRIGGER feature_flags_versioned BEFORE UPDATE ON feature_flags
WHEN NEW.version<>OLD.version+1 OR NEW.key<>OLD.key OR NEW.tenant_id<>OLD.tenant_id OR OLD.status='retired'
BEGIN SELECT RAISE(ABORT,'a flag keeps its key, and a retired flag is never revived'); END;
CREATE TRIGGER feature_flags_no_delete BEFORE DELETE ON feature_flags BEGIN SELECT RAISE(ABORT,'flags are retired, not deleted'); END;

-- ───── جرد مساعدي الذكاء الاصطناعي ─────
-- لا «درجة ثقة» رقمية في أي عمود. data_leaves_kingdom فارغ = لم يُحدَّد بعد، وليس «لا».
CREATE TABLE ai_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  assistant_key TEXT NOT NULL CHECK(length(assistant_key) BETWEEN 3 AND 60),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('platform','manual')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','assessed','active','suspended')),
  owner_id TEXT,
  approved_assessment_id TEXT,
  next_review_on TEXT CHECK(next_review_on IS NULL OR next_review_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  last_reviewed_on TEXT,
  suspended_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,assistant_key),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status<>'active' OR (owner_id IS NOT NULL AND approved_assessment_id IS NOT NULL AND next_review_on IS NOT NULL)),
  CHECK(status<>'suspended' OR length(trim(suspended_reason))>=10)
) STRICT;
-- التقييم سجل مستقل بنسخ: المعتمد لا يُعدَّل، وإعادة التقييم نسخة جديدة تبقى معها القديمة.
CREATE TABLE ai_asset_assessments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  owner_id TEXT NOT NULL,
  data_categories TEXT NOT NULL CHECK(json_valid(data_categories) AND json_array_length(data_categories)>0),
  data_leaves_kingdom INTEGER NOT NULL CHECK(data_leaves_kingdom IN (0,1)),
  transfer_note TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high')),
  risk_notes TEXT NOT NULL CHECK(length(trim(risk_notes))>=20),
  mitigations TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','returned')),
  prepared_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(asset_id,revision),
  FOREIGN KEY(asset_id,tenant_id) REFERENCES ai_assets(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='submitted')=(decided_by IS NULL)),
  CHECK(decided_by IS NULL OR (decided_by<>prepared_by AND decided_by<>owner_id)),
  CHECK(data_leaves_kingdom=0 OR length(trim(transfer_note))>=10)
) STRICT;
CREATE UNIQUE INDEX ai_asset_assessments_one_open ON ai_asset_assessments(asset_id) WHERE status='submitted';
CREATE TRIGGER ai_asset_assessments_fixed BEFORE UPDATE ON ai_asset_assessments
WHEN OLD.status<>'submitted' OR NEW.asset_id<>OLD.asset_id OR NEW.revision<>OLD.revision OR NEW.owner_id<>OLD.owner_id OR NEW.data_categories<>OLD.data_categories
  OR NEW.data_leaves_kingdom<>OLD.data_leaves_kingdom OR NEW.transfer_note<>OLD.transfer_note OR NEW.risk_level<>OLD.risk_level OR NEW.risk_notes<>OLD.risk_notes
  OR NEW.mitigations<>OLD.mitigations OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'an assessment is decided once and replaced by a new revision, not edited'); END;
CREATE TRIGGER ai_asset_assessments_no_delete BEFORE DELETE ON ai_asset_assessments BEGIN SELECT RAISE(ABORT,'assessments are retained'); END;
-- لا تفعيل إلا بتقييم معتمد لهذا المساعد نفسه، اعتمده غير مُعِدّه وغير مالكه.
CREATE TRIGGER ai_assets_guard BEFORE UPDATE ON ai_assets
WHEN NEW.version<>OLD.version+1 OR NEW.assistant_key<>OLD.assistant_key OR NEW.tenant_id<>OLD.tenant_id
  OR (NEW.status='active' AND NOT EXISTS(SELECT 1 FROM ai_asset_assessments a WHERE a.id=NEW.approved_assessment_id AND a.asset_id=NEW.id AND a.status='approved' AND a.decided_by<>a.prepared_by AND a.owner_id=NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'an assistant is activated only by an approved risk assessment decided by someone other than its author'); END;
CREATE TRIGGER ai_assets_no_active_insert BEFORE INSERT ON ai_assets WHEN NEW.status<>'proposed'
BEGIN SELECT RAISE(ABORT,'an assistant enters the inventory as a proposal'); END;
CREATE TRIGGER ai_assets_no_delete BEFORE DELETE ON ai_assets BEGIN SELECT RAISE(ABORT,'inventory entries are retained'); END;

-- ───── حزمة التقييم ─────
CREATE TABLE eval_suites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  assistant_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,name),
  FOREIGN KEY(subject_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER eval_suites_versioned BEFORE UPDATE ON eval_suites
WHEN NEW.version<>OLD.version+1 OR NEW.assistant_key<>OLD.assistant_key OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'a suite keeps its assistant; edits advance its version'); END;
CREATE TRIGGER eval_suites_no_delete BEFORE DELETE ON eval_suites BEGIN SELECT RAISE(ABORT,'suites are archived, not deleted'); END;
-- الحالة الذهبية لا تُعدَّل: تعديلها يغيّر معنى المقارنة بين التشغيلات. تُسحب وتُضاف غيرها.
CREATE TABLE eval_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input TEXT NOT NULL CHECK(json_valid(input)),
  checks TEXT NOT NULL CHECK(json_valid(checks) AND json_array_length(checks)>0),
  acceptance TEXT NOT NULL CHECK(length(trim(acceptance))>=10),
  retired_at TEXT,
  retired_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(suite_id,tenant_id) REFERENCES eval_suites(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX eval_cases_suite ON eval_cases(suite_id,created_at);
CREATE TRIGGER eval_cases_fixed BEFORE UPDATE ON eval_cases
WHEN OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL OR NEW.title<>OLD.title OR NEW.input<>OLD.input OR NEW.checks<>OLD.checks OR NEW.acceptance<>OLD.acceptance OR NEW.suite_id<>OLD.suite_id
BEGIN SELECT RAISE(ABORT,'a golden case is retired and replaced, not edited'); END;
CREATE TRIGGER eval_cases_no_delete BEFORE DELETE ON eval_cases BEGIN SELECT RAISE(ABORT,'golden cases are retained'); END;
-- التشغيل دليل حوكمة مؤرّخ: لا يُعدَّل ولا يُحذف. لا يُحفظ نص الناتج، بل بصمته ونتائج الفحوص.
CREATE TABLE eval_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  assistant_key TEXT NOT NULL,
  instructions_version INTEGER,
  providers TEXT NOT NULL CHECK(json_valid(providers)),
  previous_run_id TEXT REFERENCES eval_runs(id),
  results TEXT NOT NULL CHECK(json_valid(results)),
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  regressions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(regressions)),
  recovered TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recovered)),
  run_by TEXT NOT NULL,
  run_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(suite_id,tenant_id) REFERENCES eval_suites(id,tenant_id),
  FOREIGN KEY(run_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(total=passed+failed+errors)
) STRICT;
CREATE INDEX eval_runs_suite ON eval_runs(suite_id,created_at);
CREATE TRIGGER eval_runs_fixed BEFORE UPDATE ON eval_runs BEGIN SELECT RAISE(ABORT,'an evaluation run is dated evidence and is never rewritten'); END;
CREATE TRIGGER eval_runs_no_delete BEFORE DELETE ON eval_runs BEGIN SELECT RAISE(ABORT,'evaluation runs are retained'); END;
