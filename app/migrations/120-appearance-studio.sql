-- إضافة مدار 360 مع إبقاء جميع الاختيارات والقفل والإصدارات والافتراضي كما هي.
ALTER TABLE appearance_settings RENAME TO appearance_settings_v1;
CREATE TABLE appearance_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  design TEXT NOT NULL DEFAULT 'depth' CHECK(design IN ('depth','classic','void','field','slate','studio')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('auto','dark','light')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO appearance_settings(tenant_id,design,theme,locked,version,updated_by,updated_at)
  SELECT tenant_id,design,theme,locked,version,updated_by,updated_at FROM appearance_settings_v1;
DROP TABLE appearance_settings_v1;

ALTER TABLE user_appearance RENAME TO user_appearance_v1;
CREATE TABLE user_appearance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  design TEXT NOT NULL CHECK(design IN ('depth','classic','void','field','slate','studio')),
  theme TEXT NOT NULL CHECK(theme IN ('auto','dark','light')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO user_appearance(user_id,tenant_id,design,theme,version,updated_at)
  SELECT user_id,tenant_id,design,theme,version,updated_at FROM user_appearance_v1;
-- الفهرس انتقل مع الجدول القديم عند إعادة التسمية ويسقط بسقوطه، ثم يُنشأ باسمه نفسه على الجدول الجديد.
DROP TABLE user_appearance_v1;
CREATE INDEX user_appearance_tenant ON user_appearance(tenant_id);
