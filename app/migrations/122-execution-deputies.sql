-- سلسلة التنفيذ التي لا تترك خدمة بلا منفذ — 21 سبتمبر 2026.
-- المسح الكامل لـ142 خدمة أثبت أن تبنّي «فصل المهام» يترك 13 خدمة مال وصلاحيات بلا منفذ، لأن 12 إدارة من 17
-- فيها حساب واحد غير إداري، وهو من اعتمد الطلب. النائب المنفذ (ترحيل 115) كان مخرجًا نظريًا: جدوله فارغ تمامًا،
-- ونائبه واحد لكل خدمة، ويسمّيه شخص واحد بلا من يقبله. هذا الترحيل يعيد بناء الجدول على ثلاث قواعد:
--   (1) حتى ثلاثة نواب لكل خدمة بترتيب رتبة، فلا يقف التنفيذ على غياب شخص واحد.
--   (2) التسمية فعل شخصين كبقية ما في المنصة: يقترحها من يدير الهيكل، ويقبلها غيره. المقترح وحده لا ينفّذ.
--   (3) السجل إلحاقي: لا حذف أبدًا، ولا تعديل إلا نقلة حالة معلنة تُبقي السند ومن سمّى ومتى كما كُتبا.
-- الجدول القديم لم يحمل صفًا واحدًا في أي نسخة، فإعادة بنائه بنقل الصفوف (وهي صفر) آمنة بالكامل.
-- الحلقة الثالثة — مرجع تصعيد الإدارة — لا جدول لها هنا: كل الإدارات السبع عشرة تحمل صف department_escalation
-- منذ تثبيت الكتالوج، فهي الشخص الثاني الموجود في البيانات أصلًا بلا أحد جديد يُسمّى.

DROP INDEX execution_deputies_user;
ALTER TABLE execution_deputies RENAME TO execution_deputies_v1;

CREATE TABLE execution_deputies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  -- الرتبة ترتيب اللجوء لا درجة الشخص: يُسأل نائب الرتبة 1 أولًا، فإن منعه فصل المهام فالذي يليه.
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
  user_id TEXT NOT NULL,
  -- لماذا هذا الشخص بعينه: يُقرأ في شاشة الطلب حين يصله، وفي فحص الكتالوج.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL CHECK(status IN ('proposed','accepted','withdrawn')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  withdrawn_by TEXT,
  withdrawn_at TEXT,
  PRIMARY KEY(tenant_id,service_code,rank),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(accepted_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(withdrawn_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يسمّي النائب ليس النائب، ومن يقبل التسمية ليس من سمّى: شخصان لا واحد.
  CHECK(proposed_by<>user_id),
  CHECK(accepted_by IS NULL OR accepted_by<>proposed_by),
  CHECK((accepted_by IS NULL)=(accepted_at IS NULL)),
  CHECK((withdrawn_by IS NULL)=(withdrawn_at IS NULL)),
  -- «مقبول» يعني أن ثانيًا قبله بالفعل؛ لا حالة مقبولة بلا قابل مسجل.
  CHECK(status<>'accepted' OR accepted_by IS NOT NULL),
  CHECK(status<>'withdrawn' OR withdrawn_by IS NOT NULL)
) STRICT;

-- لا بذرة: المنصة لا تسمّي نائبًا عن أحد. الجدول يبقى فارغًا حتى يسمّي من يملك الهيكل ويقبل غيره.
INSERT INTO execution_deputies(tenant_id,service_code,rank,user_id,basis,status,proposed_by,proposed_at)
  SELECT tenant_id,service_code,1,deputy_user_id,basis,'proposed',assigned_by,assigned_at FROM execution_deputies_v1;
DROP TABLE execution_deputies_v1;

CREATE INDEX execution_deputies_user ON execution_deputies(tenant_id,user_id,status);

-- الحذف ممنوع: نائب سُمّي يومًا يبقى في السجل ولو سُحب، فيبقى مقروءًا من نفّذ ولماذا وصله الطلب.
CREATE TRIGGER execution_deputies_no_delete BEFORE DELETE ON execution_deputies
BEGIN SELECT RAISE(ABORT,'execution deputies are an append-only trail; withdraw instead of deleting'); END;

-- التعديل الوحيد المسموح نقلةُ حالة معلنة: قبولُ مقترح، أو سحبُ مقترح أو مقبول، أو تسميةٌ جديدة في رتبة مسحوبة.
-- ما عدا ذلك — تغيير الشخص أو سنده أو من سمّاه تحت حالة قائمة — يُرفض، فلا يُبدَّل منفذٌ في مكانه بلا أثر.
CREATE TRIGGER execution_deputies_transitions BEFORE UPDATE ON execution_deputies
WHEN NOT (
  (OLD.status='proposed' AND NEW.status='accepted'
    AND NEW.user_id=OLD.user_id AND NEW.basis=OLD.basis AND NEW.proposed_by=OLD.proposed_by AND NEW.proposed_at=OLD.proposed_at
    AND NEW.accepted_by IS NOT NULL AND OLD.accepted_by IS NULL AND NEW.withdrawn_by IS NULL)
  OR (OLD.status IN ('proposed','accepted') AND NEW.status='withdrawn'
    AND NEW.user_id=OLD.user_id AND NEW.basis=OLD.basis AND NEW.proposed_by=OLD.proposed_by AND NEW.proposed_at=OLD.proposed_at
    AND NEW.accepted_by IS OLD.accepted_by AND NEW.accepted_at IS OLD.accepted_at AND NEW.withdrawn_by IS NOT NULL)
  OR (OLD.status='withdrawn' AND NEW.status='proposed'
    AND NEW.accepted_by IS NULL AND NEW.accepted_at IS NULL AND NEW.withdrawn_by IS NULL AND NEW.withdrawn_at IS NULL)
)
BEGIN SELECT RAISE(ABORT,'a deputy row moves only proposed→accepted, →withdrawn, or withdrawn→a fresh proposal'); END;
