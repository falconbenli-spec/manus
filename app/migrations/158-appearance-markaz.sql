-- ترحيل 158 — «مركز الأثر» يدخل قيد قاعدة البيانات مع الكود، لا بعده.
--
-- المظهر التاسع أُضيف إلى DESIGNS في app/preferences.mjs وسُجّل في theme-boot.js وapp.mjs
-- وserver.mjs وsw.js وindex.html وclassic.css وappearance-ui.mjs. والقيد CHECK على الجدولين
-- لا يعرف إلا الثمانية، فبغير هذا الترحيل تسقط كل محاولة لاختياره في التشغيل بالخطأ نفسه
-- الذي وقع مع «الرواق» قبل 143 ومع «اليوم» قبل 149:
--   POST /api/account/appearance → ERR_SQLITE_ERROR: CHECK constraint failed: design IN (…)
--
-- وهذه ثالث مرة يتكرر فيها العيب نفسه، وقد أمسكه في كل مرة الاختبار «قيد القاعدة يقبل كل
-- تصميم في DESIGNS» — وهو الحارس الذي جعل التكرار مكشوفًا بدل أن يصل التشغيل.
--
-- النمط نفسه المتبع في 120 و143 و149: إعادة تسمية، ثم جدول بالقيد الموسَّع، ثم نقل الصفوف
-- كما هي. لا قيمة تتغير: الافتراضي يبقى depth، والقفل والإصدارات والأختام تُنقل بحروفها،
-- ولا صفّ يُحذف.
ALTER TABLE appearance_settings RENAME TO appearance_settings_v4;
CREATE TABLE appearance_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  design TEXT NOT NULL DEFAULT 'depth' CHECK(design IN ('depth','classic','void','field','slate','studio','riwaq','yawm','markaz')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('auto','dark','light')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO appearance_settings(tenant_id,design,theme,locked,version,updated_by,updated_at)
  SELECT tenant_id,design,theme,locked,version,updated_by,updated_at FROM appearance_settings_v4;
DROP TABLE appearance_settings_v4;

ALTER TABLE user_appearance RENAME TO user_appearance_v4;
CREATE TABLE user_appearance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  design TEXT NOT NULL CHECK(design IN ('depth','classic','void','field','slate','studio','riwaq','yawm','markaz')),
  theme TEXT NOT NULL CHECK(theme IN ('auto','dark','light')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO user_appearance(user_id,tenant_id,design,theme,version,updated_at)
  SELECT user_id,tenant_id,design,theme,version,updated_at FROM user_appearance_v4;
-- الفهرس انتقل مع الجدول القديم عند إعادة التسمية ويسقط بسقوطه، ثم يُنشأ باسمه نفسه على الجديد.
DROP TABLE user_appearance_v4;
CREATE INDEX user_appearance_tenant ON user_appearance(tenant_id);
