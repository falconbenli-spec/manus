CREATE TABLE people_policies (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, department_id TEXT NOT NULL, hr_department_id TEXT NOT NULL,
 name TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT NOT NULL CHECK(effective_to>=effective_from),
 privacy_reference TEXT NOT NULL, synthetic INTEGER NOT NULL CHECK(synthetic=1), created_at TEXT NOT NULL,
 UNIQUE(id,tenant_id),
 FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
 FOREIGN KEY(hr_department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;
CREATE TABLE people_requisitions (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, policy_id TEXT NOT NULL, manager_id TEXT NOT NULL,
 title TEXT NOT NULL, need TEXT NOT NULL, plan_reference TEXT NOT NULL, budget_evidence TEXT NOT NULL,
 target_date TEXT NOT NULL, criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json)),
 status TEXT NOT NULL CHECK(status IN ('pending_need','open','rejected','filled','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,tenant_id),
 FOREIGN KEY(policy_id,tenant_id) REFERENCES people_policies(id,tenant_id),
 FOREIGN KEY(manager_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE people_candidates (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, requisition_id TEXT NOT NULL,
 name TEXT NOT NULL, contact TEXT NOT NULL, source TEXT NOT NULL,
 consent_evidence TEXT NOT NULL, privacy_reference TEXT NOT NULL, retention_until TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('applied','screened','interviewing','evaluated','offer_pending','offer_approved','accepted','onboarding','completed','rejected')),
 interview_date TEXT, reviewer_hr_id TEXT,
 offer_json TEXT CHECK(offer_json IS NULL OR json_valid(offer_json)), offer_revision INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,contact),
 FOREIGN KEY(requisition_id,tenant_id) REFERENCES people_requisitions(id,tenant_id),
 FOREIGN KEY(reviewer_hr_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX people_one_filled_vacancy ON people_candidates(requisition_id) WHERE status IN ('accepted','onboarding','completed');
CREATE TABLE people_versions (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 kind TEXT NOT NULL CHECK(kind IN ('requisition','candidate','offer','acceptance','onboarding')),
 revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at TEXT NOT NULL,
 UNIQUE(entity_id,kind,revision)
) STRICT;
CREATE TABLE people_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL,
 requisition_id TEXT NOT NULL, candidate_id TEXT, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 from_status TEXT NOT NULL, to_status TEXT NOT NULL, entity_version INTEGER NOT NULL,
 evidence TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(requisition_id,tenant_id) REFERENCES people_requisitions(id,tenant_id),
 FOREIGN KEY(candidate_id,tenant_id) REFERENCES people_candidates(id,tenant_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE people_evaluations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL, evaluator_id TEXT NOT NULL,
 scores_json TEXT NOT NULL CHECK(json_valid(scores_json)), recommendation TEXT NOT NULL CHECK(recommendation IN ('proceed','do_not_proceed')),
 evidence TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(candidate_id,evaluator_id),
 FOREIGN KEY(candidate_id,tenant_id) REFERENCES people_candidates(id,tenant_id),
 FOREIGN KEY(evaluator_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE people_onboarding_tasks (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
 title TEXT NOT NULL, owner_id TEXT NOT NULL, due_date TEXT NOT NULL, acceptance TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 evidence TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, completed_at TEXT,
 UNIQUE(id,tenant_id),
 FOREIGN KEY(candidate_id,tenant_id) REFERENCES people_candidates(id,tenant_id),
 FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX people_requisition_scope ON people_requisitions(tenant_id,manager_id,status);
CREATE INDEX people_candidate_scope ON people_candidates(tenant_id,requisition_id,status);
CREATE TRIGGER people_policies_no_update BEFORE UPDATE ON people_policies BEGIN SELECT RAISE(ABORT,'people policy versions are immutable'); END;
CREATE TRIGGER people_policies_no_delete BEFORE DELETE ON people_policies BEGIN SELECT RAISE(ABORT,'people policy versions are immutable'); END;
CREATE TRIGGER people_versions_no_update BEFORE UPDATE ON people_versions BEGIN SELECT RAISE(ABORT,'people submitted versions are immutable'); END;
CREATE TRIGGER people_versions_no_delete BEFORE DELETE ON people_versions BEGIN SELECT RAISE(ABORT,'people submitted versions are immutable'); END;
CREATE TRIGGER people_events_no_update BEFORE UPDATE ON people_events BEGIN SELECT RAISE(ABORT,'people decisions are append only'); END;
CREATE TRIGGER people_events_no_delete BEFORE DELETE ON people_events BEGIN SELECT RAISE(ABORT,'people decisions are append only'); END;
CREATE TRIGGER people_evaluations_no_update BEFORE UPDATE ON people_evaluations BEGIN SELECT RAISE(ABORT,'people evaluations are immutable'); END;
CREATE TRIGGER people_evaluations_no_delete BEFORE DELETE ON people_evaluations BEGIN SELECT RAISE(ABORT,'people evaluations are immutable'); END;
CREATE TRIGGER people_requisitions_no_delete BEFORE DELETE ON people_requisitions BEGIN SELECT RAISE(ABORT,'people requisition history is immutable'); END;
CREATE TRIGGER people_requisition_identity BEFORE UPDATE ON people_requisitions
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.policy_id<>OLD.policy_id OR NEW.manager_id<>OLD.manager_id OR NEW.title<>OLD.title OR NEW.need<>OLD.need OR NEW.plan_reference<>OLD.plan_reference OR NEW.budget_evidence<>OLD.budget_evidence OR NEW.target_date<>OLD.target_date OR NEW.criteria_json<>OLD.criteria_json OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'people requisition content is immutable'); END;
CREATE TRIGGER people_requisition_transition BEFORE UPDATE ON people_requisitions
WHEN NEW.version<>OLD.version+1 OR NOT ((OLD.status='pending_need' AND NEW.status IN ('open','rejected','cancelled')) OR (OLD.status='open' AND NEW.status IN ('open','filled','cancelled')))
BEGIN SELECT RAISE(ABORT,'invalid people requisition transition'); END;
CREATE TRIGGER people_candidates_no_delete BEFORE DELETE ON people_candidates BEGIN SELECT RAISE(ABORT,'candidate retention requires a separate authorized procedure'); END;
CREATE TRIGGER people_candidate_identity BEFORE UPDATE ON people_candidates
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.requisition_id<>OLD.requisition_id OR NEW.name<>OLD.name OR NEW.contact<>OLD.contact OR NEW.source<>OLD.source OR NEW.consent_evidence<>OLD.consent_evidence OR NEW.privacy_reference<>OLD.privacy_reference OR NEW.retention_until<>OLD.retention_until OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'candidate identity and submitted evidence are immutable'); END;
CREATE TRIGGER people_candidate_transition BEFORE UPDATE ON people_candidates
WHEN NEW.version<>OLD.version+1 OR NOT (
 (OLD.status='applied' AND NEW.status IN ('screened','rejected'))
 OR (OLD.status='screened' AND NEW.status IN ('interviewing','rejected'))
 OR (OLD.status='interviewing' AND NEW.status IN ('interviewing','evaluated','rejected'))
 OR (OLD.status='evaluated' AND NEW.status IN ('offer_pending','rejected'))
 OR (OLD.status='offer_pending' AND NEW.status IN ('offer_pending','offer_approved','rejected'))
 OR (OLD.status='offer_approved' AND NEW.status IN ('offer_pending','accepted','rejected'))
 OR (OLD.status='accepted' AND NEW.status='onboarding')
 OR (OLD.status='onboarding' AND NEW.status='completed'))
BEGIN SELECT RAISE(ABORT,'invalid candidate transition'); END;
CREATE TRIGGER people_offer_version BEFORE UPDATE ON people_candidates
WHEN (NEW.offer_json IS NOT OLD.offer_json OR NEW.offer_revision<>OLD.offer_revision)
 AND NOT (OLD.status IN ('evaluated','offer_pending','offer_approved') AND NEW.status='offer_pending' AND NEW.offer_revision=OLD.offer_revision+1)
BEGIN SELECT RAISE(ABORT,'offer changes require a new approval revision'); END;
CREATE TRIGGER people_interview_identity BEFORE UPDATE ON people_candidates
WHEN (NEW.interview_date IS NOT OLD.interview_date OR NEW.reviewer_hr_id IS NOT OLD.reviewer_hr_id)
 AND NOT (OLD.status='screened' AND NEW.status='interviewing')
BEGIN SELECT RAISE(ABORT,'interview assignment is immutable'); END;
CREATE TRIGGER people_task_no_delete BEFORE DELETE ON people_onboarding_tasks BEGIN SELECT RAISE(ABORT,'onboarding evidence cannot be deleted'); END;
CREATE TRIGGER people_task_identity BEFORE UPDATE ON people_onboarding_tasks
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.candidate_id<>OLD.candidate_id OR NEW.title<>OLD.title OR NEW.owner_id<>OLD.owner_id OR NEW.due_date<>OLD.due_date OR NEW.acceptance<>OLD.acceptance OR NEW.created_at<>OLD.created_at OR OLD.status<>'open' OR NEW.status<>'completed' OR NEW.evidence IS NULL OR length(trim(NEW.evidence))<3 OR NEW.completed_at IS NULL OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'onboarding identity and completed evidence are immutable'); END;
