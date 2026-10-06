-- الأداء والتطوير والتعاقب (TAL-05..TAL-10).
-- التقييم: ذاتي ثم مدير بدليل لكل معيار، ثم معايرة من شخص ثالث، ثم إصدار، ثم إقرار أو تظلم واحد يقرره من لم يقيّم ولم يعاير.
-- لا ربط آلي بالراتب أو الترقية: الدرجة مدخل لقرار بشري موثق فقط.
CREATE TABLE review_cycles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  scale_max INTEGER NOT NULL CHECK(scale_max BETWEEN 3 AND 10),
  criteria TEXT NOT NULL CHECK(json_valid(criteria)),
  status TEXT NOT NULL CHECK(status IN ('draft','open','calibration','released')),
  created_by TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT,
  released_by TEXT REFERENCES users(id),
  released_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,name),
  CHECK(period_to>=period_from),
  CHECK(released_by IS NULL OR released_by<>created_by),
  CHECK((status='released')=(released_by IS NOT NULL))
) STRICT;
CREATE TRIGGER review_cycles_versioned BEFORE UPDATE ON review_cycles
WHEN NEW.version<>OLD.version+1 OR OLD.status='released' OR (OLD.status<>'draft' AND (NEW.criteria<>OLD.criteria OR NEW.scale_max<>OLD.scale_max OR NEW.period_from<>OLD.period_from OR NEW.period_to<>OLD.period_to))
BEGIN SELECT RAISE(ABORT,'an opened cycle keeps its criteria; a released cycle is final'); END;
CREATE TRIGGER review_cycles_no_delete BEFORE DELETE ON review_cycles BEGIN SELECT RAISE(ABORT,'review cycles are retained'); END;

CREATE TABLE performance_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES review_cycles(id),
  user_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('self','manager','submitted','calibrated','released','acknowledged','appealed','appeal_decided','excluded')),
  self_text TEXT NOT NULL DEFAULT '',
  self_submitted_at TEXT,
  self_skipped_note TEXT NOT NULL DEFAULT '',
  scores TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scores)),
  manager_score_bp INTEGER,
  manager_summary TEXT NOT NULL DEFAULT '',
  manager_submitted_at TEXT,
  final_score_bp INTEGER,
  calibration_note TEXT NOT NULL DEFAULT '',
  calibrated_by TEXT REFERENCES users(id),
  calibrated_at TEXT,
  acknowledged_at TEXT,
  appeal_text TEXT NOT NULL DEFAULT '',
  appealed_at TEXT,
  appeal_outcome TEXT CHECK(appeal_outcome IS NULL OR appeal_outcome IN ('upheld','changed')),
  appeal_note TEXT NOT NULL DEFAULT '',
  appeal_decided_by TEXT REFERENCES users(id),
  appeal_decided_at TEXT,
  excluded_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(cycle_id,user_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(reviewer_id<>user_id),
  CHECK(calibrated_by IS NULL OR (calibrated_by<>user_id AND calibrated_by<>reviewer_id)),
  CHECK(appeal_decided_by IS NULL OR (appeal_decided_by<>user_id AND appeal_decided_by<>reviewer_id AND appeal_decided_by<>calibrated_by)),
  CHECK(manager_score_bp IS NULL OR manager_score_bp BETWEEN 100 AND 1000),
  CHECK(final_score_bp IS NULL OR final_score_bp BETWEEN 100 AND 1000)
) STRICT;
CREATE INDEX performance_reviews_people ON performance_reviews(user_id,reviewer_id);
CREATE TRIGGER performance_reviews_versioned BEFORE UPDATE ON performance_reviews
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.cycle_id<>OLD.cycle_id OR NEW.reviewer_id<>OLD.reviewer_id
  OR OLD.status IN ('acknowledged','appeal_decided','excluded')
  OR (OLD.manager_submitted_at IS NOT NULL AND (NEW.scores<>OLD.scores OR NEW.manager_score_bp<>OLD.manager_score_bp OR NEW.manager_summary<>OLD.manager_summary))
  OR (OLD.self_submitted_at IS NOT NULL AND NEW.self_text<>OLD.self_text)
BEGIN SELECT RAISE(ABORT,'submitted review parts are final; corrections go through calibration or appeal'); END;
CREATE TRIGGER performance_reviews_no_delete BEFORE DELETE ON performance_reviews BEGIN SELECT RAISE(ABORT,'reviews are retained'); END;

CREATE TABLE training_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  provider TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('course','certification','workshop','conference','on_the_job')),
  hours INTEGER NOT NULL CHECK(hours BETWEEN 1 AND 2000),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','completed','cancelled')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  completion_reference TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(end_date>=start_date),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK(status<>'completed' OR length(trim(completion_reference))>=5)
) STRICT;
CREATE TRIGGER training_records_versioned BEFORE UPDATE ON training_records
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('rejected','completed','cancelled') OR NEW.user_id<>OLD.user_id OR NEW.title<>OLD.title OR NEW.hours<>OLD.hours
BEGIN SELECT RAISE(ABORT,'a closed training record is final'); END;
CREATE TRIGGER training_records_no_delete BEFORE DELETE ON training_records BEGIN SELECT RAISE(ABORT,'training records are retained'); END;

CREATE TABLE development_goals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  review_id TEXT REFERENCES performance_reviews(id),
  goal TEXT NOT NULL CHECK(length(trim(goal))>=10),
  measure TEXT NOT NULL CHECK(length(trim(measure))>=5),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','achieved','dropped')),
  set_by TEXT NOT NULL REFERENCES users(id),
  progress TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(progress)),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  closing_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='open')=(closed_by IS NULL)),
  CHECK(closed_by IS NULL OR closed_by<>user_id)
) STRICT;
CREATE TRIGGER development_goals_versioned BEFORE UPDATE ON development_goals
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'open' OR NEW.user_id<>OLD.user_id OR NEW.goal<>OLD.goal OR NEW.measure<>OLD.measure
BEGIN SELECT RAISE(ABORT,'a closed goal is final and a goal is not rewritten'); END;
CREATE TRIGGER development_goals_no_delete BEFORE DELETE ON development_goals BEGIN SELECT RAISE(ABORT,'goals are retained'); END;

CREATE TABLE succession_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  position_title TEXT NOT NULL CHECK(length(trim(position_title))>=3),
  holder_id TEXT REFERENCES users(id),
  criticality TEXT NOT NULL CHECK(criticality IN ('high','medium','low')),
  risk_note TEXT NOT NULL CHECK(length(trim(risk_note))>=10),
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(holder_id IS NULL OR holder_id<>created_by)
) STRICT;
CREATE UNIQUE INDEX succession_plans_one_active ON succession_plans(tenant_id,position_title) WHERE status='active';
CREATE TRIGGER succession_plans_versioned BEFORE UPDATE ON succession_plans WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale succession plan'); END;
CREATE TRIGGER succession_plans_no_delete BEFORE DELETE ON succession_plans BEGIN SELECT RAISE(ABORT,'succession plans are archived, not deleted'); END;

CREATE TABLE succession_candidates (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES succession_plans(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  readiness TEXT NOT NULL CHECK(readiness IN ('ready_now','one_two_years','three_plus_years')),
  strengths TEXT NOT NULL CHECK(length(trim(strengths))>=10),
  gaps TEXT NOT NULL CHECK(length(trim(gaps))>=10),
  development_action TEXT NOT NULL CHECK(length(trim(development_action))>=10),
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  removed_by TEXT REFERENCES users(id),
  removed_at TEXT,
  removal_note TEXT NOT NULL DEFAULT '',
  CHECK(added_by<>user_id),
  CHECK((removed_by IS NULL)=(removed_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX succession_candidates_one_live ON succession_candidates(plan_id,user_id) WHERE removed_at IS NULL;
CREATE TRIGGER succession_candidates_fixed BEFORE UPDATE ON succession_candidates
WHEN OLD.removed_at IS NOT NULL OR NEW.user_id<>OLD.user_id OR NEW.plan_id<>OLD.plan_id OR NEW.readiness<>OLD.readiness OR NEW.gaps<>OLD.gaps OR NEW.strengths<>OLD.strengths OR NEW.development_action<>OLD.development_action
BEGIN SELECT RAISE(ABORT,'a candidate assessment is replaced by removal and a new entry'); END;
CREATE TRIGGER succession_candidates_no_delete BEFORE DELETE ON succession_candidates BEGIN SELECT RAISE(ABORT,'candidate history is retained'); END;
