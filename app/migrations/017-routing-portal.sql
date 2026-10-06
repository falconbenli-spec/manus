ALTER TABLE requests ADD COLUMN handling_department_id TEXT REFERENCES departments(id);
ALTER TABLE service_directory ADD COLUMN target_days INTEGER NOT NULL DEFAULT 0 CHECK(target_days BETWEEN 0 AND 120);

CREATE TABLE request_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES requests(id),
  from_department_id TEXT NOT NULL,
  to_department_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(to_department_id,tenant_id) REFERENCES departments(id,tenant_id),
  CHECK(from_department_id<>to_department_id)
) STRICT;

CREATE TABLE request_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES requests(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 180),
  assignee_id TEXT NOT NULL,
  due_date TEXT NOT NULL CHECK(due_date LIKE '____-__-__'),
  acceptance TEXT NOT NULL CHECK(length(trim(acceptance))>=3),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
  evidence TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  CHECK((status='open')=(settled_at IS NULL)),
  CHECK(status<>'completed' OR length(trim(coalesce(evidence,'')))>=3),
  FOREIGN KEY(assignee_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE INDEX request_tasks_open ON request_tasks(tenant_id,assignee_id,status);
CREATE INDEX request_transfers_request ON request_transfers(request_id);

CREATE TRIGGER request_task_settled_immutable BEFORE UPDATE ON request_tasks
WHEN OLD.status<>'open'
BEGIN SELECT RAISE(ABORT,'a settled request task is immutable'); END;

CREATE TRIGGER request_transfer_immutable BEFORE UPDATE ON request_transfers
BEGIN SELECT RAISE(ABORT,'transfers are an append-only trail'); END;
