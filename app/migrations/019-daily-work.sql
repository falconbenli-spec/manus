CREATE TABLE personal_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 180),
  notes TEXT NOT NULL DEFAULT '',
  due_date TEXT CHECK(due_date IS NULL OR due_date LIKE '____-__-__'),
  list TEXT NOT NULL DEFAULT 'today' CHECK(list IN ('today','week','later')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT,
  CHECK((status='done')=(done_at IS NOT NULL)),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX personal_tasks_owner ON personal_tasks(tenant_id,user_id,status,list,sort_order);
