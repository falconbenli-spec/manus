-- خطابات الموظفين بخدمة ذاتية: الموظف يطلب، والموارد البشرية تعدّ، ومالك الإجراء يصدر.
-- القالب هو نص الخطاب كله. المنصة لا تكتب خطابًا ولا صيغة رسمية: تملأ عناصر نائبة معتمدة من سجلاتها فقط.
-- الراتب لا يُخزَّن هنا كمبلغ: يُشتق عند الإصدار من العقد الساري ويُثبَّت داخل نص الخطاب المُصدَر وحده.

-- أنواع الخطابات جدول لا قائمة في الكود. الصف بلا tenant_id نوع أساسي متاح لكل الكيانات،
-- وما له tenant_id يضيفه مالك الإجراء في كيانه.
CREATE TABLE letter_types (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 3 AND 40),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK((tenant_id IS NULL)=(created_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX letter_types_code ON letter_types(coalesce(tenant_id,'*'),code);
CREATE TRIGGER letter_types_versioned BEFORE UPDATE ON letter_types
WHEN NEW.version<>OLD.version+1 OR NEW.code<>OLD.code OR NEW.tenant_id IS NOT OLD.tenant_id OR OLD.tenant_id IS NULL
BEGIN SELECT RAISE(ABORT,'base letter types are shared and never rewritten'); END;
CREATE TRIGGER letter_types_no_delete BEFORE DELETE ON letter_types BEGIN SELECT RAISE(ABORT,'letter types are deactivated, not deleted'); END;
INSERT INTO letter_types(id,tenant_id,code,name,created_at) VALUES
  ('letter-type-employment',NULL,'employment','تعريف بالعمل','2026-01-01T00:00:00.000Z'),
  ('letter-type-salary',NULL,'salary','تعريف بالراتب','2026-01-01T00:00:00.000Z'),
  ('letter-type-experience',NULL,'experience','شهادة خبرة','2026-01-01T00:00:00.000Z'),
  ('letter-type-bank',NULL,'bank','تعريف لفتح حساب بنكي','2026-01-01T00:00:00.000Z'),
  ('letter-type-embassy',NULL,'embassy','تعريف لسفارة','2026-01-01T00:00:00.000Z');

-- قالب لكل نوع بنسخ مؤرخة يعتمدها مالك الإجراء، كما تعمل بطاقة الخدمة.
-- body يبدأ فارغًا ولا يكتبه الكود: يكتبه بشر بعناصر نائبة فقط، والمنشور لا يُعدَّل.
CREATE TABLE letter_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type_code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','published','superseded')),
  effective_from TEXT,
  prepared_by TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,type_code,revision),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(published_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='draft')=(published_by IS NULL)),
  CHECK(status='draft' OR (effective_from IS NOT NULL AND length(trim(body))>0)),
  -- من يعدّ القالب لا يعتمده.
  CHECK(published_by IS NULL OR published_by<>prepared_by)
) STRICT;
CREATE UNIQUE INDEX letter_templates_one_draft ON letter_templates(tenant_id,type_code) WHERE status='draft';
CREATE UNIQUE INDEX letter_templates_one_published ON letter_templates(tenant_id,type_code) WHERE status='published';
CREATE TRIGGER letter_templates_versioned BEFORE UPDATE ON letter_templates
WHEN NEW.version<>OLD.version+1 OR NEW.type_code<>OLD.type_code OR NEW.revision<>OLD.revision OR OLD.status='superseded'
  OR (OLD.status='published' AND NOT (NEW.status='superseded' AND NEW.body=OLD.body AND NEW.published_by=OLD.published_by))
BEGIN SELECT RAISE(ABORT,'a published template is replaced by a new revision, not edited'); END;
CREATE TRIGGER letter_templates_no_delete BEFORE DELETE ON letter_templates WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'published templates are retained'); END;

-- طلب الخطاب: صاحبه الموظف، ويمر بإعداد ثم إصدار. المُعِدّ ليس المُصدِر، ولا أحدهما صاحب الخطاب.
CREATE TABLE letter_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  type_code TEXT NOT NULL CHECK(length(trim(type_code))>=3),
  addressee TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('requested','prepared','issued','rejected','cancelled')),
  prepared_by TEXT,
  prepared_at TEXT,
  prepare_note TEXT NOT NULL DEFAULT '',
  issued_by TEXT,
  issued_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='issued')=(issued_by IS NOT NULL)),
  CHECK(status IN ('requested','cancelled','rejected') OR prepared_by IS NOT NULL),
  -- فصل المهام بالهوية: لا يُعِدّ الموظف خطاب نفسه ولا يصدره، ومن أعدّه لا يصدره.
  CHECK(prepared_by IS NULL OR prepared_by<>user_id),
  CHECK(issued_by IS NULL OR issued_by<>user_id),
  CHECK(issued_by IS NULL OR prepared_by IS NULL OR issued_by<>prepared_by)
) STRICT;
CREATE INDEX letter_requests_owner ON letter_requests(tenant_id,user_id,status);
CREATE TRIGGER letter_requests_versioned BEFORE UPDATE ON letter_requests
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.type_code<>OLD.type_code OR OLD.status IN ('issued','rejected','cancelled')
BEGIN SELECT RAISE(ABORT,'a decided letter request is not rewritten'); END;
CREATE TRIGGER letter_requests_no_delete BEFORE DELETE ON letter_requests BEGIN SELECT RAISE(ABORT,'letter requests are retained'); END;

-- الخطاب المُصدَر: نسخة مثبتة لا تُعدَّل، برقم مرجعي متسلسل بلا فجوات لكل سنة ورمز تحقق عشوائي.
-- body هو النص بعد ملء العناصر النائبة؛ لا عمود للمبلغ، فالراتب — إن كان القالب يطلبه — مثبت داخل النص وحده.
CREATE TABLE letters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL UNIQUE REFERENCES letter_requests(id),
  type_code TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES letter_templates(id),
  contract_id TEXT,
  user_id TEXT NOT NULL,
  year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2999),
  serial INTEGER NOT NULL CHECK(serial>0),
  reference TEXT NOT NULL,
  verify_code TEXT NOT NULL UNIQUE CHECK(length(verify_code) BETWEEN 8 AND 40),
  body TEXT NOT NULL CHECK(length(trim(body))>0),
  issued_on TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE(tenant_id,year,serial),
  UNIQUE(tenant_id,reference),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(issued_by<>prepared_by),
  CHECK(issued_by<>user_id)
) STRICT;
CREATE TRIGGER letters_immutable BEFORE UPDATE ON letters
BEGIN SELECT RAISE(ABORT,'an issued letter is never edited; cancel it with a new record'); END;
CREATE TRIGGER letters_no_delete BEFORE DELETE ON letters BEGIN SELECT RAISE(ABORT,'issued letters are retained'); END;

-- الإلغاء سجل جديد يبطل رمز التحقق، ولا يمس الخطاب المُصدَر.
CREATE TABLE letter_cancellations (
  id TEXT PRIMARY KEY,
  letter_id TEXT NOT NULL UNIQUE REFERENCES letters(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  cancelled_by TEXT NOT NULL,
  cancelled_at TEXT NOT NULL,
  FOREIGN KEY(cancelled_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER letter_cancellations_fixed BEFORE UPDATE ON letter_cancellations
BEGIN SELECT RAISE(ABORT,'a cancellation is recorded once'); END;
CREATE TRIGGER letter_cancellations_no_delete BEFORE DELETE ON letter_cancellations BEGIN SELECT RAISE(ABORT,'cancellations are retained'); END;
