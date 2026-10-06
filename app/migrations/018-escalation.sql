CREATE TABLE department_escalation (
  department_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
