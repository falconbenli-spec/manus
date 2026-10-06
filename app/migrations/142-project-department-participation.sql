-- مشاركة الإدارة تبدأ بطلب من مدير المشروع، ثم قرار صريح من رئيس الإدارة المستقبلة.
-- السجلات السابقة تبقى كما هي ويظهر مصدرها بصدق؛ لا تُنسب بأثر رجعي إلى قرار لم يحدث.
CREATE TABLE project_department_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','returned')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  decision_role TEXT NOT NULL DEFAULT '',
  decision_capability TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_note='' AND decision_role='' AND decision_capability='')
    OR (status IN ('accepted','returned') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND length(trim(decision_note))>=10 AND decision_role='department_manager' AND decision_capability='projects.department_participation.decide'))
) STRICT;

CREATE UNIQUE INDEX project_department_requests_pending
  ON project_department_requests(project_id,department_id) WHERE status='pending';
CREATE INDEX project_department_requests_inbox
  ON project_department_requests(tenant_id,department_id,status,requested_at);

CREATE TRIGGER project_department_requests_no_delete BEFORE DELETE ON project_department_requests
BEGIN SELECT RAISE(ABORT,'project department requests are retained'); END;

CREATE TRIGGER project_department_requests_transition BEFORE UPDATE ON project_department_requests
WHEN OLD.status<>'pending'
  OR NEW.status NOT IN ('accepted','returned')
  OR NEW.version<>OLD.version+1
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id
  OR NEW.department_id<>OLD.department_id OR NEW.basis<>OLD.basis
  OR NEW.requested_by<>OLD.requested_by OR NEW.requested_at<>OLD.requested_at
BEGIN SELECT RAISE(ABORT,'a participation request has one immutable decision transition'); END;

-- دفاع داخل قاعدة البيانات: القرار لا يُقبل من حساب معطّل أو من إدارة أخرى، ويحترم مرجع التوجيه إن وُجد.
CREATE TRIGGER project_department_requests_decider BEFORE UPDATE ON project_department_requests
WHEN NEW.status IN ('accepted','returned') AND NOT EXISTS (
  SELECT 1 FROM users u
  WHERE u.id=NEW.decided_by AND u.tenant_id=NEW.tenant_id AND u.active=1
    AND u.role='manager' AND u.department_id=NEW.department_id
    AND (
      NOT EXISTS (SELECT 1 FROM department_routing r WHERE r.tenant_id=NEW.tenant_id AND r.department_id=NEW.department_id AND r.step_role='department_manager')
      OR EXISTS (SELECT 1 FROM department_routing r WHERE r.tenant_id=NEW.tenant_id AND r.department_id=NEW.department_id AND r.step_role='department_manager' AND r.user_id=u.id)
    )
)
BEGIN SELECT RAISE(ABORT,'the active routed receiving department manager decides participation'); END;

ALTER TABLE project_departments ADD COLUMN approval_source TEXT NOT NULL DEFAULT 'legacy_declared'
  CHECK(approval_source IN ('legacy_declared','actor_decision'));
ALTER TABLE project_departments ADD COLUMN request_id TEXT REFERENCES project_department_requests(id);
CREATE UNIQUE INDEX project_departments_request ON project_departments(request_id) WHERE request_id IS NOT NULL;

-- الطلب يبدأ معلّقًا؛ لا يجوز اختصار قرار الإدارة بإدراج قبول جاهز.
CREATE TRIGGER project_department_requests_start BEFORE INSERT ON project_department_requests
WHEN NEW.status<>'pending' OR NEW.version<>1
BEGIN SELECT RAISE(ABORT,'a participation request starts pending at version one'); END;

-- تبقى الروابط القديمة محفوظة، لكن أي رابط جديد يحتاج قرارًا مطابقًا من المسار المحروس.
CREATE TRIGGER project_departments_accepted_request BEFORE INSERT ON project_departments
WHEN NEW.approval_source<>'actor_decision' OR NEW.request_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM project_department_requests r WHERE r.id=NEW.request_id AND r.status='accepted'
    AND r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.department_id=NEW.department_id
    AND r.basis=NEW.basis AND r.requested_by=NEW.requested_by AND r.requested_at=NEW.requested_at
    AND r.decided_by=NEW.approved_by AND r.decided_at=NEW.approved_at
)
BEGIN SELECT RAISE(ABORT,'a new department link needs a matching accepted participation request'); END;
CREATE TRIGGER project_departments_fixed BEFORE UPDATE ON project_departments
BEGIN SELECT RAISE(ABORT,'department participation decisions are retained'); END;
CREATE TRIGGER project_departments_retained BEFORE DELETE ON project_departments
BEGIN SELECT RAISE(ABORT,'department participation decisions are retained'); END;
