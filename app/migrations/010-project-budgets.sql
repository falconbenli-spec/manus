CREATE TABLE project_finance_grants (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
 granted_role TEXT NOT NULL, granted_department_id TEXT NOT NULL, granted_by TEXT NOT NULL,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at>starts_at), reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
 revoked_at TEXT, revocation_reason TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(granted_by,tenant_id) REFERENCES users(id,tenant_id), CHECK(user_id<>granted_by)
) STRICT;
CREATE INDEX project_finance_grants_scope ON project_finance_grants(project_id,user_id,ends_at);
CREATE TRIGGER project_finance_grants_update BEFORE UPDATE ON project_finance_grants
WHEN OLD.revoked_at IS NOT NULL OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.granted_role<>OLD.granted_role OR NEW.granted_department_id<>OLD.granted_department_id OR NEW.granted_by<>OLD.granted_by OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at OR NEW.revoked_at IS NULL OR length(trim(COALESCE(NEW.revocation_reason,'')))<3 OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'financial scope only permits a dated revocation'); END;
CREATE TRIGGER project_finance_grants_delete BEFORE DELETE ON project_finance_grants BEGIN SELECT RAISE(ABORT,'financial scope history is retained'); END;

CREATE TABLE project_budgets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, cost_center TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='SAR'),
 cap_minor INTEGER NOT NULL CHECK(cap_minor BETWEEN 1 AND 1000000000000), valid_from TEXT NOT NULL, valid_until TEXT NOT NULL CHECK(valid_until>=valid_from),
 evidence TEXT NOT NULL, prepared_by TEXT NOT NULL, approved_by TEXT, status TEXT NOT NULL CHECK(status IN ('draft','pending','active','rejected','closed')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,cost_center), FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
 FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id), FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK(approved_by IS NULL OR prepared_by<>approved_by)
) STRICT;
CREATE TABLE project_budget_decisions (
 budget_id TEXT NOT NULL REFERENCES project_budgets(id), revision INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), decision TEXT NOT NULL CHECK(decision IN ('approve','return','reject')),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), evidence TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(budget_id,revision)
) STRICT;
CREATE TABLE project_budget_versions (
 budget_id TEXT NOT NULL REFERENCES project_budgets(id),version INTEGER NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),created_at TEXT NOT NULL,
 PRIMARY KEY(budget_id,version)
) STRICT;
CREATE TABLE project_budget_reservations (
 purchase_id TEXT PRIMARY KEY REFERENCES procurement_purchases(id),budget_id TEXT NOT NULL REFERENCES project_budgets(id),budget_revision INTEGER NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),status TEXT NOT NULL CHECK(status IN ('reserved','committed','released')),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX project_budget_usage ON project_budget_reservations(budget_id,status);
CREATE TRIGGER project_budget_initial BEFORE INSERT ON project_budgets WHEN NEW.status<>'draft' OR NEW.version<>1 OR NEW.revision<>1 OR NEW.approved_by IS NOT NULL BEGIN SELECT RAISE(ABORT,'budget starts as an unapproved draft'); END;
CREATE TRIGGER project_budget_identity BEFORE UPDATE ON project_budgets
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.cost_center<>OLD.cost_center OR NEW.currency<>OLD.currency OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'budget identity and version are protected'); END;
CREATE TRIGGER project_budget_state BEFORE UPDATE ON project_budgets
WHEN NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','active','rejected')) OR (OLD.status IN ('active','rejected') AND NEW.status IN ('draft','closed')))
BEGIN SELECT RAISE(ABORT,'budget cannot skip review or reopen a closed period'); END;
CREATE TRIGGER project_budget_frozen BEFORE UPDATE ON project_budgets
WHEN OLD.status<>'draft' AND NEW.status<>'draft' AND (NEW.cap_minor<>OLD.cap_minor OR NEW.valid_from<>OLD.valid_from OR NEW.valid_until<>OLD.valid_until OR NEW.evidence<>OLD.evidence OR NEW.prepared_by<>OLD.prepared_by OR NEW.revision<>OLD.revision)
BEGIN SELECT RAISE(ABORT,'budget values require a new draft revision'); END;
CREATE TRIGGER project_budget_approval BEFORE UPDATE ON project_budgets WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM project_budget_decisions d WHERE d.budget_id=OLD.id AND d.revision=OLD.revision AND d.decision='approve' AND d.actor_id=NEW.approved_by AND d.actor_id<>OLD.prepared_by)
BEGIN SELECT RAISE(ABORT,'budget needs a separate saved decision'); END;
CREATE TRIGGER project_budget_no_delete BEFORE DELETE ON project_budgets BEGIN SELECT RAISE(ABORT,'budget history is retained'); END;
CREATE TRIGGER budget_reservation_insert BEFORE INSERT ON project_budget_reservations
WHEN NEW.status<>'reserved' OR NEW.version<>1 OR NOT EXISTS(SELECT 1 FROM project_budgets b JOIN procurement_purchases p ON p.project_id=b.project_id AND p.tenant_id=b.tenant_id WHERE b.id=NEW.budget_id AND p.id=NEW.purchase_id AND p.status IN ('sourcing','awarded') AND p.requester_id<>NEW.created_by AND b.status='active' AND b.revision=NEW.budget_revision AND b.cap_minor>=NEW.amount_minor+COALESCE((SELECT SUM(amount_minor) FROM project_budget_reservations WHERE budget_id=b.id AND status<>'released'),0))
BEGIN SELECT RAISE(ABORT,'shared project allocation is missing or exhausted'); END;
CREATE TRIGGER budget_reservation_update BEFORE UPDATE ON project_budget_reservations
WHEN OLD.status<>'reserved' OR NEW.status NOT IN ('committed','released') OR NEW.purchase_id<>OLD.purchase_id OR NEW.budget_id<>OLD.budget_id OR NEW.budget_revision<>OLD.budget_revision OR NEW.amount_minor<>OLD.amount_minor OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'reservation can be committed or released once'); END;
CREATE TRIGGER budget_reservation_no_delete BEFORE DELETE ON project_budget_reservations BEGIN SELECT RAISE(ABORT,'reservation history is retained'); END;
CREATE TRIGGER purchase_award_budget BEFORE INSERT ON procurement_awards WHEN NOT EXISTS(SELECT 1 FROM project_budget_reservations r JOIN procurement_quotes q ON q.purchase_id=r.purchase_id WHERE r.purchase_id=NEW.purchase_id AND r.status='reserved' AND q.id=NEW.quote_id AND r.amount_minor=q.total_minor)
BEGIN SELECT RAISE(ABORT,'award needs an exact shared allocation reservation'); END;
CREATE TRIGGER purchase_order_budget BEFORE INSERT ON procurement_orders WHEN NOT EXISTS(SELECT 1 FROM project_budget_reservations r WHERE r.purchase_id=NEW.purchase_id AND r.status='committed' AND r.amount_minor=NEW.total_minor)
BEGIN SELECT RAISE(ABORT,'order needs a committed shared allocation'); END;
CREATE TRIGGER project_budget_decision_update BEFORE UPDATE ON project_budget_decisions BEGIN SELECT RAISE(ABORT,'budget decision is immutable'); END;
CREATE TRIGGER project_budget_decision_delete BEFORE DELETE ON project_budget_decisions BEGIN SELECT RAISE(ABORT,'budget decision is immutable'); END;
CREATE TRIGGER project_budget_version_update BEFORE UPDATE ON project_budget_versions BEGIN SELECT RAISE(ABORT,'budget snapshot is immutable'); END;
CREATE TRIGGER project_budget_version_delete BEFORE DELETE ON project_budget_versions BEGIN SELECT RAISE(ABORT,'budget snapshot is immutable'); END;
