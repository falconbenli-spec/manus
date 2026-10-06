CREATE TABLE IF NOT EXISTS hr_competencies(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  levels_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  retired_by TEXT REFERENCES users(id),
  retired_at TEXT,
  retirement_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code)
);

CREATE TABLE IF NOT EXISTS hr_employee_competencies(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES users(id),
  competency_id TEXT NOT NULL REFERENCES hr_competencies(id),
  target_level INTEGER NOT NULL CHECK(target_level BETWEEN 1 AND 5),
  current_level INTEGER NOT NULL CHECK(current_level BETWEEN 1 AND 5),
  evidence TEXT NOT NULL,
  development_action TEXT NOT NULL,
  review_on TEXT NOT NULL,
  assessed_by TEXT NOT NULL REFERENCES users(id),
  assessed_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(tenant_id,employee_id,competency_id)
);

CREATE TABLE IF NOT EXISTS hr_performance_improvement_plans(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  objectives_json TEXT NOT NULL,
  support TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','hr_review','active','completed','extended','cancelled')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT,
  activated_by TEXT REFERENCES users(id),
  activated_at TEXT,
  acknowledged_at TEXT,
  employee_note TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  closure_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_pip_checkpoints(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES hr_performance_improvement_plans(id),
  progress TEXT NOT NULL CHECK(progress IN ('on_track','at_risk','off_track')),
  evidence TEXT NOT NULL,
  next_action TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_general_surveys(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  identity_mode TEXT NOT NULL CHECK(identity_mode IN ('named','anonymous')),
  audience_kind TEXT NOT NULL CHECK(audience_kind IN ('all','department')),
  department_id TEXT REFERENCES departments(id),
  opens_on TEXT NOT NULL,
  closes_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed','cancelled')),
  min_respondents INTEGER NOT NULL DEFAULT 5 CHECK(min_respondents>=5),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  opened_by TEXT REFERENCES users(id),
  opened_at TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((audience_kind='department' AND department_id IS NOT NULL) OR (audience_kind='all' AND department_id IS NULL)),
  CHECK(identity_mode='named' OR audience_kind='all')
);

CREATE TABLE IF NOT EXISTS hr_general_survey_questions(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  survey_id TEXT NOT NULL REFERENCES hr_general_surveys(id),
  position INTEGER NOT NULL CHECK(position>0),
  kind TEXT NOT NULL CHECK(kind IN ('rating','text','choice','yes_no')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(survey_id,position)
);

CREATE TABLE IF NOT EXISTS hr_general_survey_participants(
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  survey_id TEXT NOT NULL REFERENCES hr_general_surveys(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  responded_on TEXT NOT NULL,
  PRIMARY KEY(tenant_id,survey_id,user_id)
);

CREATE TABLE IF NOT EXISTS hr_general_survey_answers_named(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  survey_id TEXT NOT NULL REFERENCES hr_general_surveys(id),
  question_id TEXT NOT NULL REFERENCES hr_general_survey_questions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  value TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  UNIQUE(survey_id,question_id,user_id)
);

-- لا يحمل هذا الجدول اسمًا أو وقتًا أو ترتيبًا متسلسلًا يمكن ربطه بالمشارك.
CREATE TABLE IF NOT EXISTS hr_general_survey_answers_anonymous(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  survey_id TEXT NOT NULL REFERENCES hr_general_surveys(id),
  question_id TEXT NOT NULL REFERENCES hr_general_survey_questions(id),
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hr_competency_employee ON hr_employee_competencies(tenant_id,employee_id,review_on);
CREATE INDEX IF NOT EXISTS idx_hr_pip_employee ON hr_performance_improvement_plans(tenant_id,employee_id,status);
CREATE INDEX IF NOT EXISTS idx_hr_pip_checkpoint ON hr_pip_checkpoints(plan_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_hr_survey_window ON hr_general_surveys(tenant_id,status,opens_on,closes_on);

CREATE TRIGGER IF NOT EXISTS hr_competency_active_content_fixed
BEFORE UPDATE OF code,name,category,description,levels_json ON hr_competencies
WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'active competency content is fixed'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_questions_fixed_update
BEFORE UPDATE ON hr_general_survey_questions
WHEN (SELECT status FROM hr_general_surveys WHERE id=OLD.survey_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'opened survey questions are fixed'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_questions_fixed_delete
BEFORE DELETE ON hr_general_survey_questions
WHEN (SELECT status FROM hr_general_surveys WHERE id=OLD.survey_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'opened survey questions are fixed'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_questions_fixed_insert
BEFORE INSERT ON hr_general_survey_questions
WHEN (SELECT status FROM hr_general_surveys WHERE id=NEW.survey_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'opened survey questions are fixed'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_anonymous_identity_guard
BEFORE INSERT ON hr_general_survey_answers_anonymous
WHEN EXISTS(
  SELECT 1 FROM hr_general_surveys s
  WHERE s.id=NEW.survey_id AND (s.identity_mode<>'anonymous' OR s.audience_kind<>'all')
)
BEGIN SELECT RAISE(ABORT,'anonymous answer identity contract violated'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_anonymous_answers_fixed_update
BEFORE UPDATE ON hr_general_survey_answers_anonymous
BEGIN SELECT RAISE(ABORT,'anonymous survey answers are append only'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_anonymous_answers_fixed_delete
BEFORE DELETE ON hr_general_survey_answers_anonymous
BEGIN SELECT RAISE(ABORT,'anonymous survey answers are retained'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_named_answers_fixed_update
BEFORE UPDATE ON hr_general_survey_answers_named
BEGIN SELECT RAISE(ABORT,'named survey answers are append only'); END;

CREATE TRIGGER IF NOT EXISTS hr_general_survey_named_answers_fixed_delete
BEFORE DELETE ON hr_general_survey_answers_named
BEGIN SELECT RAISE(ABORT,'named survey answers are retained'); END;

CREATE TRIGGER IF NOT EXISTS hr_pip_checkpoints_fixed_update
BEFORE UPDATE ON hr_pip_checkpoints
BEGIN SELECT RAISE(ABORT,'performance improvement checkpoints are append only'); END;

CREATE TRIGGER IF NOT EXISTS hr_pip_checkpoints_fixed_delete
BEFORE DELETE ON hr_pip_checkpoints
BEGIN SELECT RAISE(ABORT,'performance improvement checkpoints are retained'); END;
