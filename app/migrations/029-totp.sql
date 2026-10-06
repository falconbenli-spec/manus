-- التحقق بخطوتين (TOTP): سر مشفر خارج جدول المستخدمين، وخطوة زمنية لا يُعاد استخدامها، ورموز استرداد تُحفظ بصماتها فقط.
CREATE TABLE user_totp (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  secret TEXT NOT NULL,
  enabled_at TEXT,
  last_step INTEGER NOT NULL DEFAULT 0,
  recovery TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recovery)),
  created_at TEXT NOT NULL
) STRICT;
