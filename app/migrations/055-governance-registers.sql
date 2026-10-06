-- ثلاثة سجلات حوكمة: الأهداف والمبادرات، المخاطر، القرارات والالتزامات.
-- المنصة لا تخترع نسبة إنجاز ولا مقياس مخاطر: القياس إدخال موثّق بمصدره، ومقياس الاحتمال والأثر يعرّفه صاحب الإجراء في جدول إعدادات.
-- المسجَّل المعتمد لا يُعدَّل: التصحيح بسجل جديد يشير إلى القديم مع بقاء القديم.

-- ============ أ. الأهداف والمبادرات والمؤشرات ============
CREATE TABLE governance_objectives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  statement TEXT NOT NULL CHECK(length(trim(statement))>=10),
  owner_id TEXT NOT NULL,
  period_from TEXT NOT NULL CHECK(period_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_to TEXT NOT NULL CHECK(period_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_to>period_from),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closure_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,department_id,period_from,title),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status='open' OR length(trim(closure_note))>=5)
) STRICT;
CREATE INDEX governance_objectives_scope ON governance_objectives(tenant_id,status,period_from);
CREATE TRIGGER governance_objectives_initial BEFORE INSERT ON governance_objectives
WHEN NEW.status<>'open' OR NEW.version<>1 BEGIN SELECT RAISE(ABORT,'an objective starts open at version one'); END;
CREATE TRIGGER governance_objectives_frozen BEFORE UPDATE ON governance_objectives
WHEN OLD.status='closed' OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.department_id<>OLD.department_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a closed objective is never rewritten and every edit carries its version'); END;
CREATE TRIGGER governance_objectives_no_delete BEFORE DELETE ON governance_objectives
BEGIN SELECT RAISE(ABORT,'objectives are closed, not deleted'); END;

CREATE TABLE governance_initiatives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  objective_id TEXT NOT NULL REFERENCES governance_objectives(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  owner_id TEXT NOT NULL,
  due_date TEXT NOT NULL CHECK(due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- الميزانية اختيارية: رقم مخطط بالهللات، ومخصص مشروع قائم إن كان للمبادرة مخصص فعلًا.
  budget_minor INTEGER CHECK(budget_minor IS NULL OR budget_minor BETWEEN 0 AND 1000000000000),
  budget_id TEXT REFERENCES project_budgets(id),
  budget_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','running','done','stopped','cancelled')),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  outcome_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(objective_id,title),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يعتمد المبادرة ليس من اقترحها.
  CHECK(approved_by IS NULL OR approved_by<>proposed_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK(status IN ('proposed','cancelled') OR approved_by IS NOT NULL)
) STRICT;
CREATE INDEX governance_initiatives_objective ON governance_initiatives(objective_id,status);
CREATE INDEX governance_initiatives_owner ON governance_initiatives(tenant_id,owner_id,status);
CREATE TRIGGER governance_initiatives_initial BEFORE INSERT ON governance_initiatives
WHEN NEW.status<>'proposed' OR NEW.version<>1 OR NEW.approved_by IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM governance_objectives o WHERE o.id=NEW.objective_id AND o.tenant_id=NEW.tenant_id AND o.status='open')
  OR (NEW.budget_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_budgets b WHERE b.id=NEW.budget_id AND b.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'an initiative starts as an unapproved proposal under an open objective of the same tenant'); END;
CREATE TRIGGER governance_initiatives_path BEFORE UPDATE ON governance_initiatives
WHEN NEW.status<>OLD.status AND NOT (
  (OLD.status='proposed' AND NEW.status IN ('approved','cancelled')) OR
  (OLD.status='approved' AND NEW.status IN ('running','stopped','cancelled')) OR
  (OLD.status='running' AND NEW.status IN ('done','stopped')))
BEGIN SELECT RAISE(ABORT,'an initiative follows its path: proposed, approved, running, then done or stopped'); END;
CREATE TRIGGER governance_initiatives_frozen BEFORE UPDATE ON governance_initiatives
WHEN OLD.status IN ('done','stopped','cancelled') OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.objective_id<>OLD.objective_id OR NEW.proposed_by<>OLD.proposed_by OR NEW.created_at<>OLD.created_at
  OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by IS NULL OR NEW.approved_by<>OLD.approved_by OR NEW.approved_at<>OLD.approved_at))
  OR (OLD.status<>'proposed' AND (NEW.title<>OLD.title OR NEW.due_date<>OLD.due_date OR NEW.owner_id<>OLD.owner_id OR COALESCE(NEW.budget_minor,-1)<>COALESCE(OLD.budget_minor,-1) OR COALESCE(NEW.budget_id,'')<>COALESCE(OLD.budget_id,'')))
BEGIN SELECT RAISE(ABORT,'an approved initiative is corrected by a new record, never rewritten'); END;
CREATE TRIGGER governance_initiatives_no_delete BEFORE DELETE ON governance_initiatives
BEGIN SELECT RAISE(ABORT,'initiatives are cancelled, not deleted'); END;

CREATE TABLE governance_indicators (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  initiative_id TEXT NOT NULL REFERENCES governance_initiatives(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  unit TEXT NOT NULL CHECK(length(trim(unit))>=1),
  baseline_value REAL NOT NULL,
  target_value REAL NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('up','down')),
  -- مصدر القياس مكتوب: من أين يُقرأ الرقم ومن يقرؤه. بلا مصدر لا مؤشر.
  measurement_source TEXT NOT NULL CHECK(length(trim(measurement_source))>=10),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(initiative_id,title)
) STRICT;
CREATE TRIGGER governance_indicators_initial BEFORE INSERT ON governance_indicators
WHEN NEW.version<>1 OR NOT EXISTS(SELECT 1 FROM governance_initiatives i WHERE i.id=NEW.initiative_id AND i.tenant_id=NEW.tenant_id AND i.status NOT IN ('done','stopped','cancelled'))
BEGIN SELECT RAISE(ABORT,'an indicator belongs to a live initiative of the same tenant'); END;
CREATE TRIGGER governance_indicators_frozen BEFORE UPDATE ON governance_indicators
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.initiative_id<>OLD.initiative_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
  OR EXISTS(SELECT 1 FROM governance_measurements m WHERE m.indicator_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'an indicator that already carries measurements keeps its baseline, target and unit'); END;
CREATE TRIGGER governance_indicators_no_delete BEFORE DELETE ON governance_indicators
BEGIN SELECT RAISE(ABORT,'indicators are retained'); END;

-- القياس إدخال موثّق: قيمة ومصدر وتاريخ قياس ومن أدخله. لا يُعدَّل، والتصحيح قياس جديد يشير إلى المصحَّح.
CREATE TABLE governance_measurements (
  id TEXT PRIMARY KEY,
  indicator_id TEXT NOT NULL REFERENCES governance_indicators(id),
  value REAL NOT NULL,
  measured_on TEXT NOT NULL CHECK(measured_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  corrects_id TEXT REFERENCES governance_measurements(id),
  correction_reason TEXT NOT NULL DEFAULT '',
  CHECK(corrects_id IS NULL OR length(trim(correction_reason))>=5)
) STRICT;
CREATE INDEX governance_measurements_indicator ON governance_measurements(indicator_id,measured_on);
CREATE TRIGGER governance_measurements_correction BEFORE INSERT ON governance_measurements
WHEN NEW.corrects_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM governance_measurements m WHERE m.id=NEW.corrects_id AND m.indicator_id=NEW.indicator_id
    AND NOT EXISTS(SELECT 1 FROM governance_measurements c WHERE c.corrects_id=m.id))
BEGIN SELECT RAISE(ABORT,'a correction replaces one live measurement of the same indicator'); END;
CREATE TRIGGER governance_measurements_immutable BEFORE UPDATE ON governance_measurements
BEGIN SELECT RAISE(ABORT,'a measurement is corrected by a new measurement, never rewritten'); END;
CREATE TRIGGER governance_measurements_no_delete BEFORE DELETE ON governance_measurements
BEGIN SELECT RAISE(ABORT,'measurements are retained'); END;

-- ============ ب. سجل المخاطر ============
-- المقياس إعداد يعرّفه صاحب الإجراء: درجات الاحتمال والأثر ونطاقات الدرجة. المنصة لا تفرض 1–5 ولا مصفوفة جاهزة.
CREATE TABLE governance_risk_levels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('likelihood','impact')),
  value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 99),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  description TEXT NOT NULL DEFAULT '',
  defined_by TEXT NOT NULL REFERENCES users(id),
  defined_at TEXT NOT NULL,
  UNIQUE(tenant_id,kind,value)
) STRICT;
CREATE TABLE governance_risk_bands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  min_score INTEGER NOT NULL CHECK(min_score>=1),
  max_score INTEGER NOT NULL CHECK(max_score>=min_score),
  defined_by TEXT NOT NULL REFERENCES users(id),
  defined_at TEXT NOT NULL,
  UNIQUE(tenant_id,label),
  UNIQUE(tenant_id,min_score)
) STRICT;

CREATE TABLE governance_risks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  category TEXT NOT NULL CHECK(length(trim(category))>=2),
  owner_id TEXT NOT NULL,
  likelihood_value INTEGER NOT NULL,
  impact_value INTEGER NOT NULL,
  -- accept_proposed: قبول مقترح لم يعتمده أحد أعلى من المالك بعد. accept وحده هو القبول النافذ.
  response TEXT NOT NULL CHECK(response IN ('avoid','reduce','transfer','accept_proposed','accept')),
  existing_controls TEXT NOT NULL DEFAULT '',
  treatment_plan TEXT NOT NULL DEFAULT '',
  treatment_owner_id TEXT,
  treatment_due TEXT CHECK(treatment_due IS NULL OR treatment_due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  next_review_on TEXT NOT NULL CHECK(next_review_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  link_type TEXT CHECK(link_type IS NULL OR link_type IN ('initiative','project','obligation')),
  link_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closure_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,title),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(treatment_owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((link_type IS NULL)=(link_id IS NULL)),
  CHECK((treatment_owner_id IS NULL)=(treatment_due IS NULL)),
  -- استجابة غير القبول تلزمها خطة معالجة بمالك وموعد.
  CHECK(response IN ('accept','accept_proposed') OR (length(trim(treatment_plan))>=10 AND treatment_owner_id IS NOT NULL)),
  CHECK(status='open' OR length(trim(closure_note))>=5)
) STRICT;
CREATE INDEX governance_risks_review ON governance_risks(tenant_id,status,next_review_on);
CREATE INDEX governance_risks_link ON governance_risks(tenant_id,link_type,link_id);

CREATE TABLE governance_risk_acceptances (
  id TEXT PRIMARY KEY,
  risk_id TEXT NOT NULL REFERENCES governance_risks(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  accepted_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  accepted_at TEXT NOT NULL,
  CHECK(accepted_by<>owner_id)
) STRICT;
CREATE INDEX governance_risk_acceptances_risk ON governance_risk_acceptances(risk_id,owner_id);
-- الخطر المقبول يحتاج اعتماد شخص أعلى من مالكه في سلسلة الإدارة، لا أي شخص آخر.
CREATE TRIGGER governance_risk_acceptances_above BEFORE INSERT ON governance_risk_acceptances
WHEN NOT EXISTS(SELECT 1 FROM governance_risks r WHERE r.id=NEW.risk_id AND r.owner_id=NEW.owner_id AND r.status='open')
  OR NOT EXISTS(WITH RECURSIVE chain(id) AS (
      SELECT manager_id FROM users WHERE id=NEW.owner_id
      UNION SELECT u.manager_id FROM users u JOIN chain ON u.id=chain.id WHERE u.manager_id IS NOT NULL)
    SELECT 1 FROM chain WHERE id=NEW.accepted_by)
BEGIN SELECT RAISE(ABORT,'accepting a risk needs someone above its owner in the reporting line'); END;
CREATE TRIGGER governance_risk_acceptances_immutable BEFORE UPDATE ON governance_risk_acceptances
BEGIN SELECT RAISE(ABORT,'a recorded acceptance is never rewritten'); END;
CREATE TRIGGER governance_risk_acceptances_no_delete BEFORE DELETE ON governance_risk_acceptances
BEGIN SELECT RAISE(ABORT,'acceptances are retained'); END;

CREATE TABLE governance_risk_reviews (
  id TEXT PRIMARY KEY,
  risk_id TEXT NOT NULL REFERENCES governance_risks(id),
  reviewed_by TEXT NOT NULL REFERENCES users(id),
  reviewed_at TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=5),
  likelihood_value INTEGER NOT NULL,
  impact_value INTEGER NOT NULL,
  next_review_on TEXT NOT NULL CHECK(next_review_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
CREATE INDEX governance_risk_reviews_risk ON governance_risk_reviews(risk_id,reviewed_at);
CREATE TRIGGER governance_risk_reviews_immutable BEFORE UPDATE ON governance_risk_reviews
BEGIN SELECT RAISE(ABORT,'a recorded review is never rewritten'); END;
CREATE TRIGGER governance_risk_reviews_no_delete BEFORE DELETE ON governance_risk_reviews
BEGIN SELECT RAISE(ABORT,'reviews are retained'); END;

CREATE TRIGGER governance_risks_initial BEFORE INSERT ON governance_risks
WHEN NEW.version<>1 OR NEW.status<>'open' OR NEW.response='accept'
  OR NOT EXISTS(SELECT 1 FROM governance_risk_levels WHERE tenant_id=NEW.tenant_id AND kind='likelihood' AND value=NEW.likelihood_value)
  OR NOT EXISTS(SELECT 1 FROM governance_risk_levels WHERE tenant_id=NEW.tenant_id AND kind='impact' AND value=NEW.impact_value)
BEGIN SELECT RAISE(ABORT,'a risk opens at version one on the scale this company defined, and is never born already accepted'); END;
CREATE TRIGGER governance_risks_updated BEFORE UPDATE ON governance_risks
WHEN OLD.status='closed' OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
  OR NOT EXISTS(SELECT 1 FROM governance_risk_levels WHERE tenant_id=NEW.tenant_id AND kind='likelihood' AND value=NEW.likelihood_value)
  OR NOT EXISTS(SELECT 1 FROM governance_risk_levels WHERE tenant_id=NEW.tenant_id AND kind='impact' AND value=NEW.impact_value)
BEGIN SELECT RAISE(ABORT,'a closed risk is reopened by a new record, and the scale values must stay on the defined scale'); END;
-- القبول النافذ لا يُكتب إلا بوجود اعتماد مسجل باسم من اعتمده وسببه، لمالك الخطر نفسه.
CREATE TRIGGER governance_risks_accept BEFORE UPDATE ON governance_risks
WHEN NEW.response='accept' AND NOT EXISTS(SELECT 1 FROM governance_risk_acceptances a WHERE a.risk_id=NEW.id AND a.owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'an accepted risk needs a recorded acceptance from someone above its owner'); END;
CREATE TRIGGER governance_risks_link_insert BEFORE INSERT ON governance_risks
WHEN NEW.link_id IS NOT NULL AND NOT (
  (NEW.link_type='initiative' AND EXISTS(SELECT 1 FROM governance_initiatives i WHERE i.id=NEW.link_id AND i.tenant_id=NEW.tenant_id))
  OR (NEW.link_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.link_id AND p.tenant_id=NEW.tenant_id))
  OR (NEW.link_type='obligation' AND EXISTS(SELECT 1 FROM compliance_obligations o WHERE o.id=NEW.link_id AND o.tenant_id=NEW.tenant_id)))
BEGIN SELECT RAISE(ABORT,'the linked initiative, project or obligation is not in this tenant'); END;
CREATE TRIGGER governance_risks_link_update BEFORE UPDATE ON governance_risks
WHEN NEW.link_id IS NOT NULL AND NOT (
  (NEW.link_type='initiative' AND EXISTS(SELECT 1 FROM governance_initiatives i WHERE i.id=NEW.link_id AND i.tenant_id=NEW.tenant_id))
  OR (NEW.link_type='project' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.link_id AND p.tenant_id=NEW.tenant_id))
  OR (NEW.link_type='obligation' AND EXISTS(SELECT 1 FROM compliance_obligations o WHERE o.id=NEW.link_id AND o.tenant_id=NEW.tenant_id)))
BEGIN SELECT RAISE(ABORT,'the linked initiative, project or obligation is not in this tenant'); END;
CREATE TRIGGER governance_risks_no_delete BEFORE DELETE ON governance_risks
BEGIN SELECT RAISE(ABORT,'risks are closed with a reason, not deleted'); END;
-- درجة مستعملة في خطر مسجل لا تُسحب من المقياس، وإلا فقد الخطر معنى تقديره.
CREATE TRIGGER governance_risk_levels_in_use BEFORE DELETE ON governance_risk_levels
WHEN EXISTS(SELECT 1 FROM governance_risks r WHERE r.tenant_id=OLD.tenant_id
  AND ((OLD.kind='likelihood' AND r.likelihood_value=OLD.value) OR (OLD.kind='impact' AND r.impact_value=OLD.value)))
BEGIN SELECT RAISE(ABORT,'a scale level used by a registered risk is not removed'); END;
CREATE TRIGGER governance_risk_levels_immutable BEFORE UPDATE ON governance_risk_levels
BEGIN SELECT RAISE(ABORT,'a scale level is replaced, not edited in place'); END;

-- ============ ج. سجل القرارات والالتزامات ومحاضر الاجتماعات ============
CREATE TABLE governance_minutes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  meeting_date TEXT NOT NULL CHECK(meeting_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  location TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
  approved_by TEXT,
  approved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من أعدّ المحضر لا يعتمده.
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK((status='approved')=(approved_by IS NOT NULL))
) STRICT;
CREATE INDEX governance_minutes_scope ON governance_minutes(tenant_id,meeting_date);
CREATE TRIGGER governance_minutes_initial BEFORE INSERT ON governance_minutes
WHEN NEW.status<>'draft' OR NEW.version<>1 OR NEW.approved_by IS NOT NULL
BEGIN SELECT RAISE(ABORT,'a minute starts as an unapproved draft'); END;
CREATE TRIGGER governance_minutes_frozen BEFORE UPDATE ON governance_minutes
WHEN OLD.status='approved' OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'an approved minute is never rewritten'); END;
CREATE TRIGGER governance_minutes_no_delete BEFORE DELETE ON governance_minutes
BEGIN SELECT RAISE(ABORT,'minutes are retained'); END;

CREATE TABLE governance_minute_attendees (
  minute_id TEXT NOT NULL REFERENCES governance_minutes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  attendance TEXT NOT NULL CHECK(attendance IN ('present','absent','delegate')),
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(minute_id,user_id)
) STRICT;
CREATE TABLE governance_minute_items (
  id TEXT PRIMARY KEY,
  minute_id TEXT NOT NULL REFERENCES governance_minutes(id),
  position INTEGER NOT NULL CHECK(position>0),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(minute_id,position)
) STRICT;
CREATE TRIGGER governance_minute_attendees_sealed_insert BEFORE INSERT ON governance_minute_attendees
WHEN EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=NEW.minute_id AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'the attendees of an approved minute are sealed'); END;
CREATE TRIGGER governance_minute_attendees_sealed_delete BEFORE DELETE ON governance_minute_attendees
WHEN EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=OLD.minute_id AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'the attendees of an approved minute are sealed'); END;
CREATE TRIGGER governance_minute_attendees_no_update BEFORE UPDATE ON governance_minute_attendees
BEGIN SELECT RAISE(ABORT,'attendees are rewritten as a set while the minute is a draft'); END;
CREATE TRIGGER governance_minute_items_sealed_insert BEFORE INSERT ON governance_minute_items
WHEN EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=NEW.minute_id AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'the agenda of an approved minute is sealed'); END;
CREATE TRIGGER governance_minute_items_sealed_delete BEFORE DELETE ON governance_minute_items
WHEN EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=OLD.minute_id AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'the agenda of an approved minute is sealed'); END;
CREATE TRIGGER governance_minute_items_no_update BEFORE UPDATE ON governance_minute_items
BEGIN SELECT RAISE(ABORT,'agenda items are rewritten as a set while the minute is a draft'); END;

-- القرار المسجّل لا يُعدَّل إطلاقًا. العدول عنه قرار جديد يشير إليه.
CREATE TABLE governance_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  context TEXT NOT NULL CHECK(length(trim(context))>=10),
  alternatives TEXT NOT NULL CHECK(length(trim(alternatives))>=10),
  decision TEXT NOT NULL CHECK(length(trim(decision))>=10),
  impact TEXT NOT NULL CHECK(length(trim(impact))>=10),
  decided_by TEXT NOT NULL,
  decided_on TEXT NOT NULL CHECK(decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reference TEXT NOT NULL DEFAULT '',
  minute_id TEXT REFERENCES governance_minutes(id),
  reverses_id TEXT REFERENCES governance_decisions(id),
  reversal_reason TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(reverses_id IS NULL OR length(trim(reversal_reason))>=10)
) STRICT;
CREATE INDEX governance_decisions_scope ON governance_decisions(tenant_id,decided_on);
CREATE TRIGGER governance_decisions_links BEFORE INSERT ON governance_decisions
WHEN NEW.reverses_id=NEW.id
  OR (NEW.reverses_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governance_decisions d WHERE d.id=NEW.reverses_id AND d.tenant_id=NEW.tenant_id))
  OR (NEW.minute_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=NEW.minute_id AND m.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'a decision reverses an earlier decision and cites a minute of the same tenant'); END;
CREATE TRIGGER governance_decisions_immutable BEFORE UPDATE ON governance_decisions
BEGIN SELECT RAISE(ABORT,'a recorded decision is never edited; reverse it with a new decision that refers to it'); END;
CREATE TRIGGER governance_decisions_no_delete BEFORE DELETE ON governance_decisions
BEGIN SELECT RAISE(ABORT,'a recorded decision is never deleted'); END;

CREATE TABLE governance_commitments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  decision_id TEXT REFERENCES governance_decisions(id),
  minute_id TEXT REFERENCES governance_minutes(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  detail TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  due_date TEXT NOT NULL CHECK(due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  closure_evidence TEXT NOT NULL DEFAULT '',
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  -- كل التزام ناشئ عن قرار أو محضر، لا يقف وحده.
  CHECK(decision_id IS NOT NULL OR minute_id IS NOT NULL),
  CHECK(status<>'done' OR (length(trim(closure_evidence))>=5 AND closed_by IS NOT NULL)),
  CHECK(status<>'cancelled' OR (length(trim(closure_evidence))>=5 AND closed_by IS NOT NULL)),
  CHECK((closed_by IS NULL)=(closed_at IS NULL))
) STRICT;
CREATE INDEX governance_commitments_owner ON governance_commitments(tenant_id,owner_id,status,due_date);
CREATE INDEX governance_commitments_decision ON governance_commitments(decision_id);
CREATE TRIGGER governance_commitments_initial BEFORE INSERT ON governance_commitments
WHEN NEW.status<>'open' OR NEW.version<>1 OR NEW.closed_by IS NOT NULL
  OR (NEW.decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governance_decisions d WHERE d.id=NEW.decision_id AND d.tenant_id=NEW.tenant_id))
  OR (NEW.minute_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM governance_minutes m WHERE m.id=NEW.minute_id AND m.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'a commitment opens against a decision or minute of the same tenant'); END;
CREATE TRIGGER governance_commitments_frozen BEFORE UPDATE ON governance_commitments
WHEN OLD.status<>'open' OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id
  OR COALESCE(NEW.decision_id,'')<>COALESCE(OLD.decision_id,'') OR COALESCE(NEW.minute_id,'')<>COALESCE(OLD.minute_id,'')
  OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a closed commitment is neither reopened nor rewritten'); END;
CREATE TRIGGER governance_commitments_no_delete BEFORE DELETE ON governance_commitments
BEGIN SELECT RAISE(ABORT,'commitments are cancelled with evidence, not deleted'); END;
