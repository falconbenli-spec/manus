-- المظهر: افتراضي الشركة وقفله، واختيار كل مستخدم (DESIGNS-ADDENDUM §هـ.1). لا تُعدَّل هجرة قائمة.
-- لا بذر: غياب الصف = void/dark غير مقفل. الصف الشخصي لا يُحذف عند القفل (يُتجاهل)، فيعود اختيار المستخدم حين يُرفع القفل.
-- version: رقم تفاؤلي يزيد مع كل كتابة؛ افتراضي الشركة يُرفض تغييره برقم قديم، والاختيار الشخصي آخر كتابة تغلب.
CREATE TABLE appearance_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  design TEXT NOT NULL DEFAULT 'void' CHECK(design IN ('void','field','slate')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK(theme IN ('auto','dark','light')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE user_appearance (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  design TEXT NOT NULL CHECK(design IN ('void','field','slate')),
  theme TEXT NOT NULL CHECK(theme IN ('auto','dark','light')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX user_appearance_tenant ON user_appearance(tenant_id);
