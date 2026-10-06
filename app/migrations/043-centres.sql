-- المراكز التخصصية: تجميع خدمات قائمة تحت مركز له إدارة أم ومالك مسمى. المركز يبقى «مقترحًا» حتى يُسمى مالكه وتُربط به خدمة واحدة على الأقل.
-- الخدمة تبقى ملك إدارتها؛ المركز لا يغير مسار اعتمادها ولا صلاحياتها.
CREATE TABLE service_centres (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL CHECK(length(key) BETWEEN 3 AND 40 AND key NOT GLOB '*[^a-z_]*'),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  scope_note TEXT NOT NULL CHECK(length(trim(scope_note))>=10),
  department_id TEXT,
  owner_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('proposed','active','retired')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,key),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status<>'active' OR (owner_id IS NOT NULL AND department_id IS NOT NULL))
) STRICT;
CREATE TRIGGER service_centres_versioned BEFORE UPDATE ON service_centres WHEN NEW.version<>OLD.version+1 OR NEW.key<>OLD.key OR NEW.tenant_id<>OLD.tenant_id BEGIN SELECT RAISE(ABORT,'stale or re-keyed centre'); END;
CREATE TRIGGER service_centres_no_delete BEFORE DELETE ON service_centres BEGIN SELECT RAISE(ABORT,'centres are retired, not deleted'); END;
CREATE TABLE service_centre_services (
  centre_id TEXT NOT NULL REFERENCES service_centres(id),
  tenant_id TEXT NOT NULL,
  service_code TEXT NOT NULL,
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,service_code)
) STRICT;
