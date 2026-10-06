-- ترحيل 145 — حساب راتب الموظف لا يسجّله صاحبه: قاعدة الشخصين تنزل من الكود إلى الجدول.
--
-- الجدول (الترحيل 031) يحمل نصف القاعدة فقط: CHECK(decided_by IS NULL OR decided_by<>recorded_by) يمنع أن يتحقق
-- المسجِّل من تسجيله. ولا شيء فيه يمنع أن يكون **المسجِّل هو صاحب الحساب نفسه**: من يحمل تصريح payroll.prepare
-- يسجّل آيبانه هو، ثم يتحقق منه زميل بحسن نية فيصير الحساب متحققًا ويدخل ملف التحويل. الحارس الوحيد اليوم أن
-- app/payroll-extras.mjs لا يمرّر user_id يساوي المسجِّل — وهو حارس كود واحد على مسار واحد، وأي إدخال مباشر
-- (سكربت، إصلاح يدوي، مسار جديد يُكتب غدًا) يمرّ من تحته. القيد هنا يجعل القاعدة قاعدةَ قاعدةِ بيانات لا عُرفَ كود.
--
-- فُحص قبل الكتابة: لا صفّ في القاعدة الحية (work/hr-design-preview-20260914.sqlite، عند الترحيل 141) يخالف القيد —
-- الجدول فيها فارغ — فلا صفّ يُسقَط ولا صفّ يُعدَّل. ولو وُجد صفّ مخالف لسقط الترحيل كله برسالة القيد، وهو المطلوب:
-- صفّ كهذا قرارٌ لصاحب المنصة لا يُحذف صامتًا.
--
-- النمط نفسه المتبع في 120 و143: إعادة تسمية، ثم جدول بالقيد المضاف، ثم نقل الصفوف كما هي، ثم إسقاط القديم.
-- وهنا يزيد على النمط شيء: الجدول يحمل زنادين (triggers) مع فهرسه. الزنادان ينتقلان مع الجدول عند إعادة التسمية
-- ويسقطان بسقوطه، فيُعادان بحرفهما بعده، كما يُعاد الفهرس. ولا يفتح إسقاطُ الجدول زناد المنع من الحذف:
-- الحذف الضمني الذي يجريه DROP TABLE لا يُشغّل الزنادات.
ALTER TABLE employee_bank_accounts RENAME TO employee_bank_accounts_v1;
CREATE TABLE employee_bank_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  iban_last4 TEXT NOT NULL CHECK(length(iban_last4)=4),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  effective_month TEXT NOT NULL CHECK(effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>recorded_by),
  CHECK((status='pending')=(decided_by IS NULL)),
  -- القاعدة المضافة: لا أحد يسجّل حساب راتبه هو.
  CHECK(recorded_by<>user_id)
) STRICT;
INSERT INTO employee_bank_accounts(id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,decided_by,decided_at,decision_note,effective_month,created_at)
  SELECT id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,decided_by,decided_at,decision_note,effective_month,created_at FROM employee_bank_accounts_v1;
DROP TABLE employee_bank_accounts_v1;
-- الفهرس والزنادان بحرفهما كما في الترحيل 031.
CREATE UNIQUE INDEX employee_bank_one_pending ON employee_bank_accounts(user_id) WHERE status='pending';
CREATE TRIGGER employee_bank_fixed BEFORE UPDATE ON employee_bank_accounts
WHEN OLD.status<>'pending' OR NEW.iban<>OLD.iban OR NEW.user_id<>OLD.user_id OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;
CREATE TRIGGER employee_bank_no_delete BEFORE DELETE ON employee_bank_accounts BEGIN SELECT RAISE(ABORT,'bank records keep their history'); END;
