-- ترحيل 147 — وحدة «أيام التقويم» تدخل قيد المهل، وسقف القيمة يصير بحسب الوحدة.
--
-- السبب: سقفا مدة الصلاحية المؤقتة (تفويض الاعتماد، والتفويض المالي والنطاق المالي) صارا قرارًا يقترحه
-- المالك ويتبنّاه شخص ثانٍ كبقية المهل. ووحدتهما **أيام تقويم** لا أيام عمل: التفويض يغطي غيبةً تمرّ بالعطل
-- والإجازات، فعدُّها بأيام العمل يجعل المدة الفعلية أطول مما قرّره المالك. والقيد كان يعرف وحدتَي العمل وحدهما،
-- فكل اقتراح بأيام تقويم يسقط بـCHECK constraint failed — وهو نفس نمط «الرواق» (ترحيل 143): قيمةٌ دخلت الكود
-- ولم تدخل القيد.
--
-- وسقف القيمة: كان BETWEEN 1 AND 240 — وهو معقول لأيام العمل (سنة عمل تقريبًا) وقاصر عن أيام التقويم،
-- وسقف الصلاحية المالية 365. فالسقف يصير بحسب الوحدة لا فتحًا عامًّا: أيام العمل تبقى عند 240 بحرفها،
-- وأيام التقويم إلى 366 (سنة كبيسة). لا تتسع وحدةٌ قائمة ولا يُخفَّف قيدٌ قائم.
--
-- النمط المتّبع (120 و143): إعادة تسمية، ثم جدول بالقيد الموسَّع، ثم نقل الصفوف كما هي، ثم إسقاط القديم،
-- ثم إعادة الفهارس الثلاثة والمحفّزات الثلاثة **بنصّها** — فإسقاط الجدول يُسقطها معه، وغيابها يفتح ما كانت
-- تغلقه: المهلة تولد مقترحة، ولا تُعدَّل إلا في دورة حياتها، ولا تُحذف، ومقترحٌ واحد ومتبنًّى واحد لكل مفتاح.
-- ولا قيمة تتغير: الصفوف تُنقل بحروفها، ولا صفّ يُحذف.

-- ولماذا لا تُعاد تسمية الجدول القديم — وهو النمط المتبع في 120 و143:
--
-- لهذا الجدول **تابعون**: جدولان يشيران إليه بمفتاح أجنبي (approval_step_escalations وrequest_lapses)،
-- ومحفّزان يقرآنه. وإعادةُ التسمية الحديثة في SQLite تعيد كتابة كل إشارة إليه فيهم، فتصير تشير إلى الاسم
-- المؤقت، ثم يُسقط المؤقت فيبقون يشيرون إلى جدول غير موجود.
--
-- ولا يُعوَّل على PRAGMA legacy_alter_table لإيقاف ذلك: مُشغِّل الترحيلات يلفّ كل ترحيل في BEGIN IMMEDIATE،
-- و SQLite يتجاهل هذا التوجيه داخل معاملة. وقد جُرّب: بروفةٌ على نسخة من القاعدة الحية أعطت «صفر إشارة
-- لاسم مؤقت»، بينما قاعدةٌ جديدة تُبنى من الترحيلات كلها أعطت **إشارتين** في مفتاحَي الجدولين التابعين:
--   timer_row_id TEXT REFERENCES "workflow_timer_settings_v146"(id)
-- وظهر أثره في ثمانية عشر اختبارًا.
--
-- فالمتّبع هنا الإجراء الرسمي الذي لا يمسّ الاسم القديم إلا بالإسقاط: يُنشأ الجديد باسم مؤقت، وتُنقل
-- الصفوف، ويُسقط القديم، ثم يُسمّى الجديد باسمه. إعادة التسمية الأخيرة تعيد كتابة الإشارات إلى **الاسم
-- المؤقت** — ولا إشارة إليه أصلًا — وتترك إشارات الاسم الأصلي بحروفها، فتصح من جديد لحظة وجوده.
-- وdefer_foreign_keys تؤجّل فحص المفاتيح إلى نهاية المعاملة، فلا يُشتكى من الفجوة بين الإسقاط والتسمية.

-- والمحفّزان التابعان يُسقطان ويُعادان بنصّهما حول العملية: ALTER TABLE ... RENAME تفحص المخطط كله،
-- ومحفّزٌ يشير إلى جدول مُسقَط يُفشل الفحص («error in trigger …: no such table»). أما مفتاحا الجدولين
-- التابعين فلا يُمسّان أصلًا، لأن الاسم القديم لا يُعاد تسميته — يُسقط ويُعاد إنشاؤه.
PRAGMA defer_foreign_keys=ON;

DROP TRIGGER approval_step_escalation_timer;
DROP TRIGGER request_lapse_valid;

CREATE TABLE workflow_timer_settings_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  timer_key TEXT NOT NULL CHECK(length(timer_key) BETWEEN 3 AND 60 AND timer_key NOT GLOB '*[^a-z_]*'),
  unit TEXT NOT NULL CHECK(unit IN ('working_days','working_hours','calendar_days')),
  -- السقف بحسب الوحدة: أيام العمل كما كانت، وأيام التقويم إلى سنة كبيسة.
  value INTEGER NOT NULL CHECK(value BETWEEN 1 AND (CASE unit WHEN 'calendar_days' THEN 366 ELSE 240 END)),
  -- السند المكتوب: من قرر هذا الرقم ومتى ولماذا. رقم بلا سند رأي لا مهلة.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','adopted','superseded')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  adopted_by TEXT,
  adopted_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(adopted_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من اقترح المهلة لا يتبناها: القرار هوية ثانية.
  CHECK(adopted_by IS NULL OR adopted_by<>proposed_by),
  CHECK((adopted_by IS NULL)=(adopted_at IS NULL)),
  CHECK(status<>'adopted' OR adopted_by IS NOT NULL),
  CHECK(status<>'proposed' OR (adopted_by IS NULL AND superseded_at IS NULL)),
  CHECK((status='superseded')=(superseded_at IS NOT NULL))
) STRICT;

INSERT INTO workflow_timer_settings_new(id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at,adopted_by,adopted_at,superseded_at)
  SELECT id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at,adopted_by,adopted_at,superseded_at FROM workflow_timer_settings;

DROP TABLE workflow_timer_settings;
ALTER TABLE workflow_timer_settings_new RENAME TO workflow_timer_settings;

CREATE INDEX workflow_timer_history ON workflow_timer_settings(tenant_id,timer_key,proposed_at);
CREATE UNIQUE INDEX workflow_timer_one_adopted ON workflow_timer_settings(tenant_id,timer_key) WHERE status='adopted';
CREATE UNIQUE INDEX workflow_timer_one_proposed ON workflow_timer_settings(tenant_id,timer_key) WHERE status='proposed';

CREATE TRIGGER workflow_timer_starts_proposed BEFORE INSERT ON workflow_timer_settings
WHEN NEW.status<>'proposed'
BEGIN SELECT RAISE(ABORT,'a workflow timer is born proposed; a second person adopts it'); END;

CREATE TRIGGER workflow_timer_lifecycle_only BEFORE UPDATE ON workflow_timer_settings
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.timer_key<>OLD.timer_key OR NEW.unit<>OLD.unit OR NEW.value<>OLD.value
  OR NEW.basis<>OLD.basis OR NEW.proposed_by<>OLD.proposed_by OR NEW.proposed_at<>OLD.proposed_at
  OR OLD.status='superseded'
  OR NOT ((OLD.status='proposed' AND NEW.status IN ('adopted','superseded')) OR (OLD.status='adopted' AND NEW.status='superseded'))
  OR (OLD.status='adopted' AND (NEW.adopted_by IS NOT OLD.adopted_by OR NEW.adopted_at IS NOT OLD.adopted_at))
BEGIN SELECT RAISE(ABORT,'a workflow timer is never edited: it is adopted once, then replaced by a new row'); END;

CREATE TRIGGER workflow_timer_no_delete BEFORE DELETE ON workflow_timer_settings
BEGIN SELECT RAISE(ABORT,'workflow timer history is retained'); END;

-- المحفّزان التابعان يعودان بنصّهما بعد أن صار الجدول موجودًا باسمه.
CREATE TRIGGER approval_step_escalation_timer BEFORE INSERT ON approval_step_escalations
WHEN NEW.basis='timeout' AND NOT EXISTS(SELECT 1 FROM workflow_timer_settings t
  WHERE t.id=NEW.timer_row_id AND t.tenant_id=NEW.tenant_id AND t.timer_key='approval_escalation' AND t.status='adopted')
BEGIN SELECT RAISE(ABORT,'a timeout escalation acts only on the adopted approval_escalation timer'); END;

CREATE TRIGGER request_lapse_valid BEFORE INSERT ON request_lapses
WHEN NOT EXISTS(SELECT 1 FROM requests r WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.status='returned' AND r.revision=NEW.revision)
  OR NOT EXISTS(SELECT 1 FROM workflow_timer_settings t WHERE t.id=NEW.timer_row_id AND t.tenant_id=NEW.tenant_id
    AND t.timer_key='returned_expiry' AND t.status='adopted' AND NEW.waited_days>=t.value)
BEGIN SELECT RAISE(ABORT,'a request lapses only while returned, on the adopted returned_expiry timer, after waiting at least its value'); END;
