ALTER TABLE users ADD COLUMN admin_level TEXT CHECK(admin_level IS NULL OR admin_level IN ('scoped','super'));

CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK(length(trim(capability)) BETWEEN 3 AND 40),
  department_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT REFERENCES users(id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;

CREATE UNIQUE INDEX access_grants_live ON access_grants(user_id,capability,coalesce(department_id,'*')) WHERE revoked_at IS NULL;
CREATE INDEX access_grants_user ON access_grants(tenant_id,user_id,revoked_at);

-- الحساب الإداري القائم هو الأدمن الأول حتى يعيّن صاحب العمل غيره.
UPDATE users SET admin_level='super' WHERE role='admin';
