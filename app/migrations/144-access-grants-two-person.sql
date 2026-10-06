-- ترحيل 144 — التصريح يمنحه غيرُ صاحبه: قيد المنح بيدين على access_grants.
--
-- العطب: grantAccess في app/access.mjs يكتب granted_by=u.id بلا شرط أن يكون الممنوح غير المانح،
-- وaccess_grants بلا قيد يمنع ذلك. فالأدمن الأول يمنح نفسه أي تصريح، ومنها الحساس. والتصريح الحساس
-- في هذا المنتج لا يفتحه امتياز الأدمن الأول وحده — capabilitiesFor وcan وholds كلها تشترط منحًا
-- مسجَّلًا — فلو منح نفسه المنحَ صار الشرط بلا معنى: من أراد التصريح كتبه لنفسه في سطر واحد.
--
-- والقاعدة نفسها مطبَّقة في المنتج على الجدولين الأقل خطرًا:
--   finance_grants     : CHECK(user_id<>granted_by)      — الترحيل 007
--   access_review_items: CHECK(reviewer_id<>subject_id)  — الترحيل 075، «لا أحد يراجع تصاريح نفسه»
--   access_grants      : (بلا قيد)                        — حتى هذا الترحيل
-- فالنمط معروف هنا، ولم يُطبَّق على الجدول الأقوى وحده. هذا الترحيل يسوّيه بالحرف نفسه.
--
-- ═══ لماذا نمط 124 و127 لا نمط 120 و143 ═══
-- جدولان يحيلان إلى access_grants بالاسم (الترحيل 075): access_review_items.grant_id
-- وaccess_revocation_requests.grant_id. وإعادة التسمية تعيد كتابة إحالتيهما — جُرِّبت على نسخة
-- من القاعدة الحية (141) فصارت الإحالة REFERENCES "access_grants_v1"(id) بالحرف — ثم يسقط الجدول
-- المُعاد تسميته فتبقى الإحالتان معلّقتين على جدول غير موجود، وهو عطبٌ صامت لا يظهر إلا عند أول إدراج.
-- فيُعاد البناء بالاسم نفسه كما في 124 و127: نسخة مؤقتة، ثم إسقاط، ثم إنشاء باسمه، ثم إعادة الصفوف.
-- وdefer_foreign_keys يؤجل المخالفات إلى الإغلاق، فإسقاط الأب ثم إعادة صفوفه يغلق المعاملة نظيفة
-- حتى لو كانت في الجدولين الابنين صفوفٌ تحيل إلى منحة.
--
-- ولا صفّ يسقط ولا فهرس: النسخ يتم بلا شرط ولا ترشيح، فلو وُجد صفّ مخالف (user_id=granted_by)
-- أسقط رسالةُ القيد المعاملةَ كلها ولم يُحذف صامتًا — والفحص قبل الكتابة على القاعدة الحية (الإصدار 141):
-- 102 صفًّا في access_grants، ولا صفَّ واحد فيها user_id=granted_by. والفهرسان يعودان باسميهما وتعريفهما.
PRAGMA defer_foreign_keys=ON;

CREATE TEMP TABLE access_grants_carry AS SELECT * FROM access_grants;

DROP TABLE access_grants;

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
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  -- التصريح يمنحه غيرُ صاحبه. الحرف نفسه في finance_grants (الترحيل 007).
  -- السحب لا يُمسّ هنا: revoked_by=user_id حالةٌ أخرى قرارُها ليس قرار هذا الترحيل.
  CHECK(user_id<>granted_by)
) STRICT;

INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at,revoked_at,revoked_by)
SELECT id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at,revoked_at,revoked_by FROM access_grants_carry;
DROP TABLE access_grants_carry;

CREATE UNIQUE INDEX access_grants_live ON access_grants(user_id,capability,coalesce(department_id,'*')) WHERE revoked_at IS NULL;
CREATE INDEX access_grants_user ON access_grants(tenant_id,user_id,revoked_at);
