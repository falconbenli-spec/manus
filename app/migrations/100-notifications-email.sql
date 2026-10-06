-- الإشعارات والبريد والتذكيرات ومهلة الخمول (P1 #6 وبنود P2 الأمنية في REF-APP-GAP-REPORT-20260919).
-- البريد مطفأ افتراضيًا: لا مزوّد ولا مفتاح في القاعدة. الإعداد متغيرات بيئة يضعها المالك، وبدونها يُحجب كل بريد.

-- 1) الإشعارات: موضوعات جديدة (حالات الموارد البشرية، التدريب، الأداء، كشوف الوقت، المهام والعمل الإضافي والغياب،
--    التذكيرات، تنبيهات الأمان) وعمود فئة يختار به الموظف ما يصله بالبريد.
--    دمج 20260919: ترحيل 099 (الحضور) أعاد بناء الجدول بقيد شكل على subject_kind (3–40 حرفًا لاتينيًا صغيرًا أو شرطة سفلية)
--    يقبل الموضوعات الجديدة كلها، والقائمة المسموحة في الكود (SUBJECT_LINKS في app/notices.mjs). لذلك لا يعيد هذا الترحيل
--    بناء الجدول مرة ثانية كما كان في فرعه، بل يضيف العمود وفهرسيه فقط (البديل الوارد في notifications-email.md §8).
--    هذا الترحيل يفترض أن 099 سبقه، وهو ما يضمنه ترتيب الأرقام.
ALTER TABLE notifications ADD COLUMN category TEXT CHECK(category IS NULL OR category IN ('approvals','my_requests','hr_cases','development','reminders','security'));
CREATE INDEX notifications_unread ON notifications(user_id,read_at);
CREATE INDEX notifications_created ON notifications(created_at);

-- 2) صندوق الصادر: كان حالة واحدة «blocked» لأحداث الطلبات المعتمدة. يحمل الآن قناتين:
--    event: الحدث القديم كما هو (لا موصل له، يبقى محجوبًا).
--    email: بريد إشعار لمستخدم؛ العنوان لا يُخزَّن هنا بل يُقرأ من سجل الموظف لحظة الإرسال.
--    notification_id بلا مرجع مُعلن عمدًا: إعادة بناء جدول الإشعارات لاحقًا لا تعيد كتابة هذا الجدول.
ALTER TABLE outbox RENAME TO outbox_v1;
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  channel TEXT NOT NULL DEFAULT 'event' CHECK(channel IN ('event','email')),
  request_id TEXT REFERENCES requests(id),
  notification_id TEXT,
  user_id TEXT REFERENCES users(id),
  category TEXT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'blocked' CHECK(status IN ('queued','sent','failed','blocked','suppressed')),
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  provider_id TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  sent_at TEXT,
  CHECK(channel<>'event' OR request_id IS NOT NULL),
  CHECK(channel<>'email' OR (notification_id IS NOT NULL AND user_id IS NOT NULL)),
  CHECK((status='sent')=(sent_at IS NOT NULL)),
  CHECK(provider_id IS NULL OR length(provider_id)<=200),
  CHECK(length(last_error)<=500)
) STRICT;
INSERT INTO outbox(id,tenant_id,channel,request_id,event_key,event_type,status,reason,created_at)
  SELECT id,tenant_id,'event',request_id,event_key,event_type,status,reason,created_at FROM outbox_v1;
DROP TABLE outbox_v1;
CREATE INDEX outbox_status ON outbox(tenant_id,channel,status,created_at);
CREATE INDEX outbox_sent ON outbox(tenant_id,channel,sent_at);

-- 3) عنوان البريد الوظيفي من سجل الموظف. تسجله الموارد البشرية؛ لا يُكتب في صندوق الصادر ولا في سجل التدقيق كاملًا.
ALTER TABLE employee_profiles ADD COLUMN work_email TEXT CHECK(work_email IS NULL OR (length(work_email)<=180 AND work_email LIKE '%_@_%._%' AND work_email NOT GLOB '*[ <>"]*'));

-- 4) تفضيلات البريد لكل مستخدم: الفئات التي تصله بالبريد. الإشعار داخل المنصة يصل دائمًا ولا يُطفأ.
CREATE TABLE notification_email_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  categories TEXT NOT NULL CHECK(json_valid(categories) AND json_type(categories)='array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL
) STRICT;

-- 5) مؤشر المخطِّط: الإشعارات قبل هذا الوقت لا تُرسل بالبريد أبدًا (لا يُغرق أحد بإشعارات قديمة عند التفعيل).
CREATE TABLE mail_delivery_state (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  planned_since TEXT NOT NULL
) STRICT;

-- 6) التذكيرات اليومية: سجل ما أُرسل (مفتاح لكل وثيقة ومرحلة، ولكل شخص ويوم) فلا يتكرر تذكير.
CREATE TABLE reminder_log (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reminder_key TEXT NOT NULL CHECK(length(reminder_key) BETWEEN 5 AND 300),
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,reminder_key)
) STRICT;
CREATE TRIGGER reminder_log_no_update BEFORE UPDATE ON reminder_log BEGIN SELECT RAISE(ABORT,'reminder log is append only'); END;
-- إعداد التذكيرات: عدد الأيام قبل تذكير المعتمد بطلب ينتظره، وملخص المديرين. القيم الأولى مسودة حتى يقرها المالك.
CREATE TABLE reminder_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  pending_approval_days INTEGER CHECK(pending_approval_days IS NULL OR pending_approval_days BETWEEN 1 AND 60),
  manager_digest INTEGER NOT NULL DEFAULT 1 CHECK(manager_digest IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
  basis TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
) STRICT;

-- 7) مهلة الخمول: آخر نشاط للجلسة، وسياسة الكيان. البذرة مسودة: 30 دقيقة للجلسات التي تحمل تصريحًا حساسًا
--    (أو حساب إدارة المنصة)، ولا مهلة لغيرها. تُطبَّق كما هي حتى يعتمد المالك قيمة أخرى.
ALTER TABLE sessions ADD COLUMN last_seen INTEGER;
ALTER TABLE security_settings ADD COLUMN idle_sensitive_minutes INTEGER DEFAULT 30 CHECK(idle_sensitive_minutes IS NULL OR idle_sensitive_minutes BETWEEN 5 AND 720);
ALTER TABLE security_settings ADD COLUMN idle_other_minutes INTEGER CHECK(idle_other_minutes IS NULL OR idle_other_minutes BETWEEN 5 AND 1440);
ALTER TABLE security_settings ADD COLUMN idle_policy_status TEXT NOT NULL DEFAULT 'draft' CHECK(idle_policy_status IN ('draft','approved'));
ALTER TABLE security_settings ADD COLUMN idle_policy_basis TEXT NOT NULL DEFAULT '';
INSERT INTO security_settings(tenant_id) SELECT id FROM tenants WHERE 1 ON CONFLICT(tenant_id) DO NOTHING;
