-- مسح دليل الخدمات 20 سبتمبر 2026 — العطبان 9 و1، ومعهما العطب 12.
-- ثلاث إضافات لا تمس جدولًا قائمًا في معناه: عمود ساعات بجوار عمود الأيام، وسجل تبنٍّ لزمن الخدمة،
-- ونائب منفذ مسمّى. الأعمدة والجداول كلها تحتمل الغياب، فالمنصة قبل هذا الترحيل تقرأ كما كانت.

-- ── العطب 9: زمن أقصر من يوم عمل ─────────────────────────────────────────────────
-- `setServiceTarget` كان يقبل أيامًا فقط (0–120)، و`computeClock` يحسب بالأيام، فأقصر ما يُكتب لبلاغ أمني
-- «يوم عمل واحد»: بلاغ الخميس ظهرًا يستحق الأحد. العمود يقبل NULL، ومعناه «الزمن بالأيام كما كان».
-- حين يوجد الاثنان يسود الأصغر أثرًا: الساعات. الحد 1–240 ساعة عمل (شهر عمل تقريبًا) حتى لا يُكتب رقم بلا معنى.
ALTER TABLE service_directory ADD COLUMN target_hours INTEGER
  CHECK(target_hours IS NULL OR (target_hours BETWEEN 1 AND 240));

-- زمن الخدمة الجديد مقترح لا قرار: يُعرض لمالك الإجراء فيتبناه أو يرفضه، ويُسجَّل قراره بسنده.
-- سجل إلحاقي، آخر صف لكل (خدمة، مقترح) هو الساري. decision='rejected' يبقى مسجلًا فلا يُعاد عرضه كأنه لم يُحسم.
CREATE TABLE service_target_adoptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('adopted','rejected','withdrawn')),
  target_days INTEGER CHECK(target_days IS NULL OR (target_days BETWEEN 0 AND 120)),
  target_hours INTEGER CHECK(target_hours IS NULL OR (target_hours BETWEEN 1 AND 240)),
  previous_days INTEGER,
  previous_hours INTEGER,
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  -- المتبنى يحمل زمنًا؛ المرفوض والمسحوب لا يحملان شيئًا يُطبَّق.
  CHECK(decision<>'adopted' OR target_days IS NOT NULL OR target_hours IS NOT NULL)
) STRICT;
CREATE INDEX service_target_adoptions_code ON service_target_adoptions(tenant_id,service_code,decided_at);
CREATE TRIGGER service_target_adoption_immutable BEFORE UPDATE ON service_target_adoptions
BEGIN SELECT RAISE(ABORT,'service target adoptions are an append-only trail'); END;
CREATE TRIGGER service_target_adoption_no_delete BEFORE DELETE ON service_target_adoptions
BEGIN SELECT RAISE(ABORT,'service target adoptions are an append-only trail'); END;

-- ── العطب 1: فصل المهام في شركة صغيرة ────────────────────────────────────────────
-- تبنّي «فصل المهام» (B3) يمنع من اعتمد أي خطوة من الاستلام والإغلاق. في إدارة فيها شخص واحد — وهي حال
-- 12 إدارة من 17 — لا يبقى منفذ، فيقف الطلب عند «معتمد» بـ409 no_executor. النائب المسمّى مخرج مسجَّل:
-- شخص بعينه من إدارة أخرى يُسمّى لخدمة بعينها، ولا يُستعمل إلا حين لا يبقى في الإدارة المنفذة منفذ غير معتمِدها.
-- ليس تعطيلًا لفصل المهام: النائب نفسه ممنوع إن كان قد اعتمد خطوة، أو كان صاحب الطلب أو المستفيد منه.
CREATE TABLE execution_deputies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  deputy_user_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,service_code),
  FOREIGN KEY(deputy_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(assigned_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يسمّي النائب ليس النائب.
  CHECK(assigned_by<>deputy_user_id)
) STRICT;
CREATE INDEX execution_deputies_user ON execution_deputies(tenant_id,deputy_user_id);
