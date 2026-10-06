-- ترحيل 149 — «اليوم» يدخل قيد قاعدة البيانات مع الكود، لا بعده.
--
-- المظهر الثامن أُضيف إلى DESIGNS في app/preferences.mjs وسُجّل في theme-boot وapp.mjs وserver وsw
-- وindex.html وclassic.css. والقيد CHECK على الجدولين لا يعرف إلا السبعة، فبغير هذا الترحيل تسقط
-- كل محاولة لاختياره في التشغيل بالخطأ نفسه الذي وقع مع «الرواق» قبل الترحيل 143:
--   POST /api/account/appearance → ERR_SQLITE_ERROR: CHECK constraint failed: design IN ('depth',…,'riwaq')
-- والاختبارات وحدها لا تكشفه لأنها تقرأ قائمة الكود لا قيد الجدول — ولهذا يُكتب الترحيل في الدفعة نفسها.
--
-- النمط نفسه المتبع في 120 و143: إعادة تسمية، ثم جدول بالقيد الموسَّع، ثم نقل الصفوف كما هي.
-- لا قيمة تتغير: الافتراضي يبقى depth، والقفل والإصدارات والأختام تُنقل بحروفها، ولا صفّ يُحذف.
ALTER TABLE appearance_settings RENAME TO appearance_settings_v3;
CREATE TABLE appearance_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  design TEXT NOT NULL DEFAULT 'depth' CHECK(design IN ('depth','classic','void','field','slate','studio','riwaq','yawm')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('auto','dark','light')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO appearance_settings(tenant_id,design,theme,locked,version,updated_by,updated_at)
  SELECT tenant_id,design,theme,locked,version,updated_by,updated_at FROM appearance_settings_v3;
DROP TABLE appearance_settings_v3;

ALTER TABLE user_appearance RENAME TO user_appearance_v3;
CREATE TABLE user_appearance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  design TEXT NOT NULL CHECK(design IN ('depth','classic','void','field','slate','studio','riwaq','yawm')),
  theme TEXT NOT NULL CHECK(theme IN ('auto','dark','light')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO user_appearance(user_id,tenant_id,design,theme,version,updated_at)
  SELECT user_id,tenant_id,design,theme,version,updated_at FROM user_appearance_v3;
-- الفهرس انتقل مع الجدول القديم عند إعادة التسمية ويسقط بسقوطه، ثم يُنشأ باسمه نفسه على الجديد.
DROP TABLE user_appearance_v3;
CREATE INDEX user_appearance_tenant ON user_appearance(tenant_id);
