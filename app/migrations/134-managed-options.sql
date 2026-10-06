-- 134: الخيارات المُدارة — «لازم يكون فيه خيارات لكل معلومه مهمه بكل المنصه» (قرار المالك).
--
-- القاعدة التي يطبّقها هذا الترحيل: كل معلومة مهمة إما **قائمة خيارات** يديرها المالك من المنصة (يضيف، يعطّل،
-- يعيد الترتيب، بسبب وتاريخ ومن غيّر)، وإما **قيمة باعتماد مؤرَّخ** قرّرها إنسان ومصدرها مسجَّل. لا شيء مهم يبقى
-- نصًّا حرًّا، ولا شيء مهم يبقى اختيارًا مدفونًا في الكود لا يبلغه المالك.
--
-- والحدّ الذي يعلو القاعدة: ما تثبّته اللائحة الموقّعة أو النظام لا يصير تفضيلًا. القائمة المثبّتة نظامًا تُفتح
-- **للقراءة فقط** ومعها مادتها، فيراها المالك ولا يوسّعها بصمت. هذه لا جدول لها هنا: واصفها في الكود
-- (governance='legally_fixed' + article) وكل مسار كتابة يرفضها باسم مادتها (app/options.mjs).
--
-- لماذا صفوف لا وثيقة JSON في سجل التعريفات (123)؟ اللغة من 123 تُنسخ بالحرف (value/label/tone، والتصنيفات الثلاث
-- additive/tightening/loosening، و«الخيار المنشور لا يُحذف بل يُعطَّل»)، لكن المخزن هنا صفوف لخمسة أسباب مفحوصة:
--   (1) خيارات 123 تعيش داخل وثيقة JSON («لا فهرس على مسارات JSON»)، ومركز تكلفة أمر الشراء يجب أن يكون **صفًّا
--       مُحالًا إليه**: finance_cost_centers صفٌّ فعلًا وledger.mjs يضمّه أصلًا. مسار JSON لا يصلح هدفًا لمفتاح أجنبي.
--   (2) لا تاريخ سريان في 123 (ترتيب نسخ فقط)، ونسبة الضريبة وبداية السنة المالية وإعادة ربط مركز التكلفة تحتاجه.
--   (3) مسودة واحدة لكل كيان (definition_drafts PRIMARY KEY): تصنيفات الموردين وأغراض الدفتر في وثيقة واحدة تعني محرِّرًا واحدًا.
--   (4) تصريح حسّاس واحد للوثيقة كلها (definitions.publish) يقلب فصل المهام: هذه القوائم يملكها اليوم
--       procurement.use وvendors.manage والتفويض المالي، كلٌّ لصاحبه.
--   (5) spec.system[key] لا يقبل إلا label وvisible_to، فلا يحمل قائمة خيارات حقل نظامي أصلًا.
--
-- ولا بذرة: النسخة 0 = افتراضات الكود، كما تقولها 123 بالحرف. الجداول الثلاثة تبدأ فارغة، وسلوك اليوم الأول
-- مطابق بايتًا بايت. الكتابة الوحيدة هنا هي ملء cost_center_id من مطابقة قائمة وواحدة لا غير.

-- ───── (1) طبقة المالك على القوائم ─────
-- صفٌّ هنا يعني أن إنسانًا أضاف أو عطّل أو أعاد ترتيب أو أعاد تسمية. ما لم يمسّه أحد لا صف له: الكود هو الافتراضي.
-- origin='code' صفٌّ يعدّل افتراضًا موجودًا في الكود (تعطيل، ترتيب، تسمية)، و'owner' خيارٌ أنشأه المالك من المنصة.
--
-- لماذا اتسع نمط value عن الحروف اللاتينية الصغيرة: قائمتان من السبع تحملان اليوم نصّهما المخزَّن قيمةً —
-- رمز مركز التكلفة بحروف كبيرة (SYNTHETIC-CC-1)، ووحدة القياس كلمةً عربية («نسخة»). تبديل ما يخزّنه العمود
-- يجعل السجل القديم غير مقروء، وهو بالضبط ما تمنعه القاعدة. فالقيمة نصٌّ مشذَّب بلا سطر جديد، والمفتاح هو ما استُخدم فعلًا.
CREATE TABLE option_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  list_key TEXT NOT NULL CHECK(list_key GLOB '[a-z]*' AND list_key NOT GLOB '*[^a-z._]*' AND length(list_key) BETWEEN 3 AND 60),
  value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 60 AND trim(value)=value AND value NOT GLOB '*'||char(10)||'*'),
  origin TEXT NOT NULL CHECK(origin IN ('code','owner')),
  label TEXT NOT NULL CHECK(length(trim(label))>=2),
  label_en TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra) AND json_type(extra)='object'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- ثلاث حالات لا اثنتان، و'base' هي الافتراضي: **الصفّ لا يدّعي حالةً لم يقرّرها إنسان**. إعادة الترتيب أو
  -- إعادة التسمية تنشئ الصفّ («مسٌّ» بالفعل) لكنها لا تقول شيئًا عن التشغيل، فتبقى الحالة موروثة من الكود.
  -- بلا هذه الحالة الثالثة كان الصفّ يُكتب 'active' عند أول مسّ، فيُفعِّل ترتيبٌ خيارًا شحنه الكود معطَّلًا.
  state TEXT NOT NULL DEFAULT 'base' CHECK(state IN ('base','active','disabled')),
  disabled_from TEXT CHECK(disabled_from IS NULL OR (length(disabled_from)=10 AND disabled_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
  -- الصف المرآة حين تكون القائمة مُحالة إلى جدول (مركز التكلفة ← finance_cost_centers.id). ليس مفتاحًا أجنبيًا
  -- لأن كل قائمة تُحيل إلى جدولها، والواصف في الكود هو من يقول أيّ جدول.
  ref_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  UNIQUE(tenant_id,list_key,value),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  -- «معطَّل» و«من أي تاريخ» وجهان لواقعة واحدة: أحدهما بلا الآخر سجلٌّ لا يُقرأ.
  CHECK((state='disabled')=(disabled_from IS NOT NULL)),
  -- خيارٌ أنشأه المالك لا أصل له في الكود يُورَث منه، فلا معنى لـ'base' عليه.
  CHECK(origin='code' OR state<>'base'),
  -- من أضاف خيارًا لا يعتمده: شكل finance_account_mappings (الترحيل 031) نفسه، لا شكل جديد.
  CHECK(approved_by IS NULL OR approved_by<>added_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL))
) STRICT;
CREATE INDEX option_values_list ON option_values(tenant_id,list_key,sort_order);
-- الخيار الذي استُعمل لا يُحذف بل يُعطَّل: سجلٌّ من ثلاث سنوات يجب أن يُقرأ اليوم كما كُتب.
CREATE TRIGGER option_values_no_delete BEFORE DELETE ON option_values
BEGIN SELECT RAISE(ABORT,'an option that has been used is disabled, never deleted'); END;
-- الهوية ثابتة، والنسخة ترتفع مرة واحدة في كل كتابة: قفل متفائل كما في بقية المنصة.
CREATE TRIGGER option_values_fixed BEFORE UPDATE ON option_values
WHEN NEW.value<>OLD.value OR NEW.list_key<>OLD.list_key OR NEW.origin<>OLD.origin OR NEW.tenant_id<>OLD.tenant_id
  OR NEW.added_by<>OLD.added_by OR NEW.added_at<>OLD.added_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'an option keeps its key, its origin and who added it; every change raises the version by one'); END;

-- ───── (2) سجل تغيّر القوائم: إلحاقي ─────
-- هذا هو «بسبب وتاريخ ومن غيّر». التصنيف يضعه الخادم لا الفاعل، والخريطة مكتوبة هنا فلا يُعاد اشتقاقها:
--   added      → loosening   (المجموعة المقبولة تتسع، فيراها ناشر ثانٍ حيث يلزم)
--   disabled   → tightening  (تضيق: لا استعمال جديد، والسجل القديم يبقى مقروءًا)
--   enabled    → loosening   (تتسع من جديد)
--   reordered  → additive
--   relabelled → additive
CREATE TABLE option_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  list_key TEXT NOT NULL CHECK(length(list_key) BETWEEN 3 AND 60),
  value TEXT NOT NULL,
  change TEXT NOT NULL CHECK(change IN ('added','disabled','enabled','reordered','relabelled')),
  class TEXT NOT NULL CHECK(class IN ('additive','tightening','loosening')),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('new_activity','superseded','error','policy_change','regulator','merged','other')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  effective_on TEXT NOT NULL CHECK(length(effective_on)=10 AND effective_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  -- «أخرى» ليست سببًا: من اختارها يكتب السبب كاملًا.
  CHECK(reason_code<>'other' OR length(trim(reason))>=20)
) STRICT;
CREATE INDEX option_changes_list ON option_changes(tenant_id,list_key,seq DESC);
CREATE TRIGGER option_changes_no_update BEFORE UPDATE ON option_changes
BEGIN SELECT RAISE(ABORT,'the option log is append only'); END;
CREATE TRIGGER option_changes_no_delete BEFORE DELETE ON option_changes
BEGIN SELECT RAISE(ABORT,'the option log is retained'); END;

-- ───── (3) القيمة ذات الأساس المعتمد ─────
-- النصف الثاني من قاعدة المالك: قيمة واحدة لا قائمة — قرّرها إنسان، ومعها أساسها ومصدرها وتاريخ سريانها.
-- الشكل مدموج من finance_account_mappings (مؤرّخ، يعتمده غير من سجّله، ولا يُحرَّر بعد الاعتماد) ومن سياسات اللائحة
-- (article يسمّي المادة حين تكون القيمة مقيَّدة، ويبقى فارغًا حين تكون الشركة حرة). القيمة الجديدة صفٌّ مؤرَّخ جديد
-- يحلّ محلّ سابقه، ولا يُعاد كتابة صفّ قديم أبدًا.
CREATE TABLE option_adoptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL CHECK(key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z._]*' AND length(key) BETWEEN 3 AND 60),
  value TEXT NOT NULL CHECK(json_valid(value)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  article TEXT NOT NULL DEFAULT '',
  effective_from TEXT NOT NULL CHECK(length(effective_from)=10 AND effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,key,effective_from),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(approved_by IS NULL OR approved_by<>recorded_by),
  CHECK((approved_by IS NULL)=(approved_at IS NULL))
) STRICT;
CREATE INDEX option_adoptions_live ON option_adoptions(tenant_id,key,effective_from DESC);
CREATE TRIGGER option_adoptions_fixed BEFORE UPDATE ON option_adoptions
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.key<>OLD.key OR NEW.value<>OLD.value
  OR NEW.basis<>OLD.basis OR NEW.article<>OLD.article OR NEW.effective_from<>OLD.effective_from OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'an adopted value is approved once and replaced by a new dated adoption'); END;
CREATE TRIGGER option_adoptions_no_delete BEFORE DELETE ON option_adoptions
BEGIN SELECT RAISE(ABORT,'adopted values are retained'); END;

-- ───── (4) مركز التكلفة: من نصّ يُطابَق بحروفه إلى صفٍّ مُحال إليه ─────
-- أغلى عيب في الجرد وأصمته في الاتجاهين: budgets.usableBudget يطابق النص بعد رفعه إلى الحروف الكبيرة، فـ«التسويق»
-- و«تسويق» إما يردّان طلبًا مخصّصه ظاهر على الشاشة، وإما يحجزان من مال مركز آخر. والمشتريات لا تصل أصلًا بأي رابط
-- إلى قائمة المالية التي بُني عليها الدفتر. العمود النصّي يبقى كما هو ولا يُمسّ — فالسجل القديم يُقرأ كما كُتب —
-- ويُضاف بجواره معرّف الصف.
ALTER TABLE procurement_purchases ADD COLUMN cost_center_id TEXT REFERENCES finance_cost_centers(id);
ALTER TABLE project_budgets ADD COLUMN cost_center_id TEXT REFERENCES finance_cost_centers(id);
-- الفهرس الفريد يُنشأ **بعد** الملء لا قبله، أدناه. كان قبله، والملء يطابق بـupper(trim) بينما UNIQUE(project_id,
-- cost_center) القائم يطابق تطبيع budgets.center (NFKC + رفع + طيّ الفراغات)، فمخصّصان بنصّين مثل 'CC-ONE' و'cc-one'
-- يمرّان القيد القديم ويتصادمان على المعرّف. جُرِّب: قاعدة قبل-134 فيها هذان الصفّان تسقط عند openDb بـ
-- `UNIQUE constraint failed: project_budgets.project_id, project_budgets.cost_center_id`، والترحيل في معاملة فيتراجع
-- كاملًا — أي أن المنصة لا تفتح أصلًا، برسالة لا تسمّي مشروعًا ولا صفًّا ولا خطوة تالية. البلوغ عبر التطبيق مسدود
-- اليوم، لكن الترحيل يجري على قاعدة حيّة لا يشهد أحد لمحتواها، فلا يُبنى على ظنّ.

-- الملء: مطابقة النص بعد التشذيب ورفع الحروف — وهو التطبيع الذي يستعمله الكود اليوم عدا طيّ الفراغات المتكررة،
-- فمرجعٌ كُتب بفراغين لا يُطابَق هنا ويبقى NULL قرارًا لا تخمينًا. ولا يُملأ صفٌّ إلا إذا طابقه **مركز نشط واحد
-- لا غير**: الملتبس وغير المطابق يبقيان NULL ويظهران في الشاشة بوصفهما بحاجة إلى قرار إنسان.
--
-- والقوادح الأربعة تُسقَط ثم تُعاد بنصّها حرفًا بحرف حول الملء — نمط الترحيل 031 نفسه — لسبب واحد: كلٌّ منها
-- يفرض على أي UPDATE أن يرفع النسخة أو أن ينقل الحالة نقلةً مسموحة، والملء ليس تغيير حالة ولا كتابة إنسان.
-- لو رُفعت النسخة لتغيّر عمودٌ كان قائمًا قبل الترحيل، وهو بالضبط ما لا يجوز: الترحيل يملأ العمود الجديد ولا يمسّ سواه.
DROP TRIGGER procurement_identity;
DROP TRIGGER project_budget_identity;
DROP TRIGGER project_budget_state;
DROP TRIGGER project_budget_approval;

UPDATE procurement_purchases SET cost_center_id=(
  SELECT c.id FROM finance_cost_centers c
  WHERE c.tenant_id=procurement_purchases.tenant_id AND c.active=1
    AND upper(trim(c.code))=upper(trim(procurement_purchases.cost_center))
) WHERE (
  SELECT COUNT(*) FROM finance_cost_centers c
  WHERE c.tenant_id=procurement_purchases.tenant_id AND c.active=1
    AND upper(trim(c.code))=upper(trim(procurement_purchases.cost_center))
)=1;
-- وشرطٌ ثانٍ على المخصصات وحدها: لا يُملأ صفٌّ يتصادم مع صفّ آخر في المشروع نفسه على المركز نفسه. مخصّصان
-- كُتب مرجعهما بحالتي أحرف مختلفتين مرّا من UNIQUE(project_id,cost_center) القديم؛ الملء لا يختار بينهما ولا
-- يُسقط الترحيل: يتركهما NULL — قرارًا لا تخمينًا، كما تركَ الملتبسَ وغيرَ المطابق — ويظهران في حمولة المخصصات
-- بـcost_center_id فارغًا، فيحسمهما إنسان بدمج المخصصين أو بإعادة تسمية أحدهما.
UPDATE project_budgets SET cost_center_id=(
  SELECT c.id FROM finance_cost_centers c
  WHERE c.tenant_id=project_budgets.tenant_id AND c.active=1
    AND upper(trim(c.code))=upper(trim(project_budgets.cost_center))
) WHERE (
  SELECT COUNT(*) FROM finance_cost_centers c
  WHERE c.tenant_id=project_budgets.tenant_id AND c.active=1
    AND upper(trim(c.code))=upper(trim(project_budgets.cost_center))
)=1 AND (
  SELECT COUNT(*) FROM project_budgets b
  WHERE b.tenant_id=project_budgets.tenant_id AND b.project_id=project_budgets.project_id
    AND upper(trim(b.cost_center))=upper(trim(project_budgets.cost_center))
)=1;

-- مخصّصان لمشروع واحد على المركز نفسه ممنوعان بالمعرّف كما هما ممنوعان بالنص (UNIQUE(project_id,cost_center) القائم).
CREATE UNIQUE INDEX project_budgets_center_id ON project_budgets(project_id,cost_center_id) WHERE cost_center_id IS NOT NULL;

-- إعادة القوادح الأربعة بنصّها من الترحيلين 005 و010، بلا حرف واحد مختلف.
CREATE TRIGGER procurement_identity BEFORE UPDATE ON procurement_purchases
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.requester_id<>OLD.requester_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'purchase identity and version are protected'); END;
CREATE TRIGGER project_budget_identity BEFORE UPDATE ON project_budgets
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.cost_center<>OLD.cost_center OR NEW.currency<>OLD.currency OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'budget identity and version are protected'); END;
CREATE TRIGGER project_budget_state BEFORE UPDATE ON project_budgets
WHEN NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','active','rejected')) OR (OLD.status IN ('active','rejected') AND NEW.status IN ('draft','closed')))
BEGIN SELECT RAISE(ABORT,'budget cannot skip review or reopen a closed period'); END;
CREATE TRIGGER project_budget_approval BEFORE UPDATE ON project_budgets WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM project_budget_decisions d WHERE d.budget_id=OLD.id AND d.revision=OLD.revision AND d.decision='approve' AND d.actor_id=NEW.approved_by AND d.actor_id<>OLD.prepared_by)
BEGIN SELECT RAISE(ABORT,'budget needs a separate saved decision'); END;

-- القادح بعد الملء لا قبله: الملء نفسه يمسّ صفوفًا غادرت المسودة، وهو التصحيح المصرّح به في هذا الترحيل وحده.
-- والقادح المطبَّق procurement_frozen (الترحيل 005) لا يعرف العمود الجديد، فكان سيبقى قابلًا للتعديل بعد التقديم.
CREATE TRIGGER procurement_center_frozen BEFORE UPDATE ON procurement_purchases
WHEN OLD.status<>'draft' AND (NEW.cost_center_id IS NOT OLD.cost_center_id)
BEGIN SELECT RAISE(ABORT,'submitted purchase is immutable'); END;
