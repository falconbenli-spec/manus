-- ملفات الوثائق والأدلة، وإعدادات الأمان على مستوى الكيان.
CREATE TABLE stored_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('vendor','external_approval','employment_contract','expense_claim')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX stored_files_entity ON stored_files(tenant_id,entity_type,entity_id);
CREATE TRIGGER stored_files_no_update BEFORE UPDATE ON stored_files BEGIN SELECT RAISE(ABORT,'stored files are immutable'); END;
CREATE TRIGGER stored_files_no_delete BEFORE DELETE ON stored_files BEGIN SELECT RAISE(ABORT,'stored files are retained'); END;

CREATE TABLE security_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  require_mfa_for_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(require_mfa_for_sensitive IN (0,1)),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT
) STRICT;
