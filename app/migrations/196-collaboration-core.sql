-- مساحة العمل التعاونية ترتبط بمصدر أعمال واحد، ولا تنسخ حقوله التشغيلية.
CREATE TABLE collaboration_spaces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('project','department','initiative')),
  target_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(tenant_id,target_kind,target_id),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE collaboration_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','member','internal_guest','external_guest')),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  removed_at TEXT,
  removed_by TEXT,
  removal_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(space_id,user_id),
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(removed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((removed_at IS NULL)=(removed_by IS NULL)),
  CHECK(removed_at IS NULL OR length(trim(removal_reason))>=5),
  CHECK(ends_at IS NULL OR ends_at>starts_at)
) STRICT;
CREATE INDEX collaboration_memberships_actor ON collaboration_memberships(tenant_id,user_id,removed_at,ends_at);
CREATE TRIGGER collaboration_external_guests_disabled BEFORE INSERT ON collaboration_memberships
WHEN NEW.role='external_guest'
BEGIN SELECT RAISE(ABORT,'external guests are disabled until an adopted access policy exists'); END;

CREATE TABLE work_lists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=1),
  kind TEXT NOT NULL DEFAULT 'active' CHECK(kind IN ('backlog','active','complete','archive')),
  position REAL NOT NULL CHECK(position>=0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(space_id,title),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX work_lists_order ON work_lists(space_id,position,id);

CREATE TABLE space_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title))>=2),
  accountable_id TEXT NOT NULL,
  start_on TEXT CHECK(start_on IS NULL OR start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_on TEXT CHECK(due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
  acceptance TEXT NOT NULL DEFAULT '',
  evidence TEXT,
  position REAL NOT NULL CHECK(position>=0),
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('request','project_task')),
  source_id TEXT,
  completed_at TEXT,
  completed_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(list_id,tenant_id) REFERENCES work_lists(id,tenant_id),
  FOREIGN KEY(accountable_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(completed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((source_kind IS NULL)=(source_id IS NULL)),
  CHECK(start_on IS NULL OR due_on IS NULL OR due_on>=start_on),
  CHECK((status='completed')=(completed_at IS NOT NULL)),
  CHECK((completed_at IS NULL)=(completed_by IS NULL)),
  CHECK(status='open' OR length(trim(COALESCE(evidence,'')))>=3)
) STRICT;
CREATE INDEX space_tasks_board ON space_tasks(space_id,list_id,status,position,id);
CREATE INDEX space_tasks_accountable ON space_tasks(tenant_id,accountable_id,status,due_on);

CREATE TABLE space_task_contributors (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(task_id,user_id),
  FOREIGN KEY(task_id,tenant_id) REFERENCES space_tasks(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE space_task_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body))>=1),
  created_at TEXT NOT NULL,
  edited_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(task_id,tenant_id) REFERENCES space_tasks(id,tenant_id),
  FOREIGN KEY(author_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX space_task_comments_task ON space_task_comments(task_id,created_at,id);

CREATE TABLE space_activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  space_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(space_id,tenant_id) REFERENCES collaboration_spaces(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(json_valid(details_json))
) STRICT;
CREATE INDEX space_activity_feed ON space_activity(space_id,seq DESC);

ALTER TABLE tasks ADD COLUMN list_id TEXT REFERENCES work_lists(id);
ALTER TABLE tasks ADD COLUMN sort_order REAL CHECK(sort_order IS NULL OR sort_order>=0);
ALTER TABLE tasks ADD COLUMN start_on TEXT CHECK(start_on IS NULL OR start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE tasks ADD COLUMN priority TEXT CHECK(priority IS NULL OR priority IN ('low','normal','high','urgent'));

