CREATE TABLE service_directory (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  section TEXT NOT NULL CHECK(length(trim(section)) BETWEEN 2 AND 60),
  sort_order INTEGER NOT NULL DEFAULT 100 CHECK(sort_order BETWEEN 0 AND 10000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,service_code)
) STRICT;

CREATE TABLE department_routing (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  step_role TEXT NOT NULL CHECK(step_role IN ('department_manager','hr','it','pm')),
  user_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(department_id,step_role),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));

CREATE INDEX users_department_role ON users(tenant_id,department_id,role,active);
CREATE INDEX users_manager ON users(tenant_id,manager_id,active);
CREATE INDEX requests_service_status ON requests(tenant_id,service_id,status);
CREATE INDEX approval_steps_request ON approval_steps(request_id,revision,status);
