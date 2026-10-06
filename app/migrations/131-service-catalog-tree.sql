-- شجرة مركز الخدمات: الإسقاط والمرادفات وحالة الإسقاط، ومعها جداول الدفعات التالية — 22 سبتمبر 2026.
--
-- الدليل اليوم قائمةٌ واحدة من 143 بندًا (142 صفًّا في services، وHR-LEAVE ليس صفًّا فيها
-- (app/static/module-services.mjs) ومع ذلك يُتصفَّح ويُبحث فيه ويفتح شاشته). ما ينقص ليصير شجرةً هو
-- موضعُ كل بند من عدسة حاجة الطالب: أي فئة، وهل له بطاقة في شبكتها أم يسكن مجموعة خيارات، ومن يراه.
--
-- ثلاث قواعد تحكم كل ما دون:
--   (1) **catalog_placement إسقاطٌ لا مصدر حقيقة.** يُمحى ويُعاد بناؤه كاملًا من الشجرة المكتوبة في
--       app/catalog-tree.mjs (النسخة صفر في عُرف 123: لا طبقة بعد)، كما يُعاد بناء search_index (047)
--       من مصادره. ولهذا لا قادح إلحاقيًّا عليه: محو صفٍّ مشتق لا يمحو قرارًا.
--   (2) **لا مفتاح أجنبي إلى services من أي جدول هنا.** رمز الخدمة ليس فريدًا فيها (فريدها
--       tenant_id+code+version)، ومن يربط بـservices.id يربط بنسخةٍ لا بخدمة. هكذا تفعل
--       service_directory (043) وservice_cards (045) وservice_availability (129) قبلنا.
--   (3) **الترحيل لا يبذر صفًّا واحدًا** ولا يكتب حدث تدقيق باسمه ولا يمسّ services ولا requests ولا
--       service_directory ولا service_availability ولا search_index. الحدث لفعل إنسان لا لترقية مخطط.
--
-- ولماذا الجداول الثمانية في ترحيل واحد وبعضها لا تقرؤه شاشةٌ بعد: لأن العمود لا يُضاف إلى جدول
-- مطبَّق بلا ترحيلٍ ثانٍ، والقرار المكتوب أن الدفعات الأربع تبني فوق مخططٍ واحد لا تتناوب على تعديله.
-- الجداول التي لا تقرؤها دفعةُ الأساس تبقى **فارغة**، وقيودها مفحوصة في tests/migration-131.test.mjs
-- كي لا يُثبَّت ما لم يُختبر.

-- ── 1. الإسقاط: موضع كل بند في الشجرة، لكل جمهور ─────────────────────────────────
CREATE TABLE catalog_placement (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- أربعة جماهير في القائمة منذ اليوم الأول لأن عمود CHECK لا يتوسّع بلا إعادة بناء. ولا يُدرج صفٌّ
  -- لـclient ولا vendor: لا دور لهما في users (schema.sql: employee, manager, hr, it, admin, pm)
  -- ولا أحد منهما يستطيع الدخول. فتح سطحٍ لهما مشروع مستقل لا فصلٌ في إعادة تصميم الدليل.
  audience TEXT NOT NULL CHECK(audience IN ('employee','manager','client','vendor')),
  -- service: رمز خدمة في الدليل. module: بندٌ شاشتُه وحدته المخصصة ولا صفّ له في services (HR-LEAVE).
  -- benefit: مفتاح ميزة. group: بطاقة مجموعة خيارات (VAR-*) تحلّ محل أعضائها في التصفّح.
  -- بلا النوع module تسقط الوحدة الثالثة والأربعون بعد المئة صامتةً، وهي ما يفعله كل من يبني على services وحدها.
  item_kind TEXT NOT NULL CHECK(item_kind IN ('service','module','benefit','group')),
  item_key TEXT NOT NULL CHECK(length(trim(item_key)) BETWEEN 2 AND 60),
  -- مفتاح الفئة: أحرف لاتينية صغيرة وشرطة سفلية، كمفاتيح الكيانات في 123 ومفاتيح المراكز في 043.
  category_key TEXT NOT NULL CHECK(category_key GLOB '[a-z]*' AND category_key NOT GLOB '*[^a-z_]*' AND length(category_key) BETWEEN 3 AND 40),
  -- المجموعة التي يسكنها هذا البند، أو '' لبطاقةٍ مفردة. العضوية تُشتق من SERVICE_VARIANTS عند
  -- الإسقاط ولا جدول عضوية لها: جدولٌ ثانٍ للعضوية مصدرٌ ثانٍ يفترق عن الأول بعد أول تحرير.
  group_key TEXT NOT NULL DEFAULT '' CHECK(length(group_key) BETWEEN 0 AND 60),
  -- هل لهذا البند بطاقة في شبكة الفئة؟ عضو المجموعة browse=0: يبقى **مُسنَدًا** فلا يسقط من العدّ ولا
  -- من items_unplaced، ويُبلَغ من بطاقة مجموعته ومن البحث. والعدّاد يفرّق: بطاقات = browse=1،
  -- وبنود = item_kind<>'group'. من هنا تستحيل «143 في الترويسة و134 في البطاقات».
  browse INTEGER NOT NULL DEFAULT 1 CHECK(browse IN (0,1)),
  position INTEGER NOT NULL DEFAULT 100 CHECK(position BETWEEN 0 AND 10000),
  -- «هل يرى هذا الجمهور البطاقة أصلًا» — وهو غير «هل يستطيع طلبها الآن». الأهلية تُحسب ولا تُخزَّن.
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  -- تصريح إضافي يلزم لرؤية البطاقة، أو '' لبطاقةٍ لا شرط لها. نصّ لا مفتاح أجنبي: التصاريح كودٌ في
  -- app/access.mjs بقرار 123 الصريح، والتحقق بـcan لا بإحالة. وهذا العمود يطرح ولا يمنح.
  required_capability TEXT NOT NULL DEFAULT '' CHECK(length(required_capability) BETWEEN 0 AND 40),
  department_id TEXT,
  -- أي نسخة من الشجرة أنتجت هذا الصف. 0 = افتراض الكود. بلا هذا العمود لا تعرف الشاشة أي ترتيب تعرض،
  -- ولا يُكتشف إسقاطٌ تخلّف عن نشرةٍ فشلت في منتصفها.
  release_version INTEGER NOT NULL CHECK(release_version>=0),
  projected_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,audience,item_kind,item_key),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;
-- «أعطني عناصر هذه الفئة مرتّبة» و«أعطني كل الفئات وعدد عناصرها» بلا قراءة الجدول كاملًا.
CREATE INDEX catalog_placement_category ON catalog_placement(tenant_id,audience,category_key,position,item_key);

-- ── 2. المرادفات: كلمات الناس ────────────────────────────────────────────────────
-- 3 إلى 8 لكل بند، فيها الدارج والإنجليزي والأخطاء الشائعة والأسماء القديمة بعد إعادة التسمية.
-- السابقة قائمة في المنصة مرة واحدة لكن للسياسات لا للخدمات: policy_search_terms (111). هذا نظيره
-- مربوطًا ببندٍ بعينه، وهو ما يحتاجه ترتيبُ نتيجةٍ لا مجردُ توسيع استعلام.
-- ولا يسرّب شيئًا: الظهور يحكمه شرط visibleSql في الاستعلام نفسه لا طريقةُ الوصول إليه، فمرادفٌ يقود
-- إلى خدمة سرّية لا يُظهر منها صفًّا لمن لا يراها.
CREATE TABLE service_synonyms (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  item_kind TEXT NOT NULL CHECK(item_kind IN ('service','module','benefit','group')),
  item_key TEXT NOT NULL CHECK(length(trim(item_key)) BETWEEN 2 AND 60),
  -- الكلمة كما كتبها الإنسان: تُعرض في شاشة الإدارة، فيعرف من يراجعها أنها «ورقه الراتب» لا صورتها المطبّعة.
  term TEXT NOT NULL CHECK(length(trim(term)) BETWEEN 2 AND 60),
  -- الصورة المطبّعة (app/arabic-text.mjs normalize). هي ما يُطابَق عليه، وهي جزء من المفتاح فلا يدخل
  -- مرادفان صورتهما واحدة. لا CHECK يفرض التطبيع: sqlite لا تطبّع العربية، والثبات تحرسه الوحدة
  -- ويثبته اختبار — وهو صريح النهج نفسه في policy_search_terms.
  normalized TEXT NOT NULL CHECK(length(trim(normalized)) BETWEEN 2 AND 60),
  -- من أين جاء: مكتوب بيد مسؤول الدليل، أو مرفوع من بحثٍ لم يجد شيئًا ثم اعتُمد، أو منقول من الكود.
  -- صفوف from_code وحدها تُمحى وتُعاد كتابتها مع كل إسقاط؛ ما كتبه إنسان لا يمسّه الإسقاط.
  source TEXT NOT NULL CHECK(source IN ('curated','from_search','from_code')),
  note TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,item_kind,item_key,normalized),
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX service_synonyms_term ON service_synonyms(tenant_id,normalized,item_kind,item_key);

-- ── 3. سجل البحث: ما بحث عنه الناس ولم يجدوه ─────────────────────────────────────
-- تيار أحداث إلحاقي يغذّي تقرير المرادفات ولوح صحة الدليل. **بلا هوية**: لا user_id ولا department_id.
-- البديل معرّفٌ عشوائي للبحث الواحد يربط أحداثه ولا يربط بحثين لشخص. والسبب مكتوب في المنصة أصلًا:
-- app/process-insight.mjs يرفض بالتصميم أي تجميع على شخص. وسجلٌّ يقول «من بحث عن الاستقالة» ليس مؤشرًا
-- بل مراقبة. والنص يُخزَّن مطبَّعًا بعد حاجب app/pii.mjs كما يفعل policy_questions (111).
CREATE TABLE catalog_search_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  search_id TEXT NOT NULL CHECK(length(search_id)=32),
  event TEXT NOT NULL CHECK(event IN ('searched','opened','submitted')),
  audience TEXT NOT NULL CHECK(audience IN ('employee','manager','client','vendor')),
  query_normalized TEXT NOT NULL DEFAULT '',
  result_count INTEGER CHECK(result_count IS NULL OR result_count>=0),
  item_kind TEXT CHECK(item_kind IS NULL OR item_kind IN ('service','module','benefit','group')),
  item_key TEXT,
  position INTEGER CHECK(position IS NULL OR position BETWEEN 1 AND 200),
  at TEXT NOT NULL,
  -- حدث البحث يحمل سؤالًا وعددًا؛ وحدثا الفتح والتقديم يحملان بندًا.
  CHECK(event<>'searched' OR (length(trim(query_normalized))>=1 AND result_count IS NOT NULL)),
  CHECK(event='searched' OR (item_key IS NOT NULL AND item_kind IS NOT NULL))
) STRICT;
CREATE TRIGGER catalog_search_log_no_update BEFORE UPDATE ON catalog_search_log
  BEGIN SELECT RAISE(ABORT,'the search log is append only'); END;
CREATE TRIGGER catalog_search_log_no_delete BEFORE DELETE ON catalog_search_log
  BEGIN SELECT RAISE(ABORT,'the search log is append only'); END;
-- فهرس جزئي لأن المطلوب أقلية الصفوف: «بحثٌ بلا نتيجة».
CREATE INDEX catalog_search_log_misses ON catalog_search_log(tenant_id,at) WHERE event='searched' AND result_count=0;
CREATE INDEX catalog_search_log_funnel ON catalog_search_log(search_id,seq);

-- ── 4 و5. الرحلة المنفَّذة: طلبٌ أب ولّد أبناء ────────────────────────────────────
CREATE TABLE journey_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  journey_key TEXT NOT NULL CHECK(journey_key GLOB '[a-z]*' AND journey_key NOT GLOB '*[^a-z_]*' AND length(journey_key) BETWEEN 3 AND 40),
  -- نسخة الشجرة التي بدأت عليها هذه الرحلة. القاعدة نفسها التي تحكم الطلب وخدمته: تعديل تعريف الرحلة
  -- غدًا لا يعيد كتابة ما مشت عليه رحلةُ أمس.
  definition_version INTEGER NOT NULL CHECK(definition_version>=0),
  -- الطلب الأب طلبٌ عادي في requests له خدمته ومساره، لا كائن جديد. ولهذا تعمل فيه الصلاحيات والتدقيق
  -- والإشعارات وصندوق الوارد بلا سطر جديد.
  parent_request_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  -- صاحب الرحلة قد لا يكون مقدّمها: «موظف جديد» تقدّمها الموارد البشرية عمّن لم يدخل المنصة بعد.
  subject_user_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  -- طلبٌ أب واحد لرحلة واحدة: لا تُولَّد الرحلة مرتين من زرٍّ ضُغط مرتين.
  UNIQUE(tenant_id,parent_request_id),
  FOREIGN KEY(parent_request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(requester_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(subject_user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='open')=(closed_at IS NULL))
) STRICT;
CREATE INDEX journey_runs_mine ON journey_runs(tenant_id,requester_id,status,started_at);
CREATE TRIGGER journey_runs_no_delete BEFORE DELETE ON journey_runs
  BEGIN SELECT RAISE(ABORT,'a journey that ran is retained'); END;
-- ما يتغيّر في الصف حالته وإغلاقه فقط. أما على أي طلبٍ مشت وبأي تعريف فلا.
CREATE TRIGGER journey_runs_fixed BEFORE UPDATE ON journey_runs
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.journey_key<>OLD.journey_key
  OR NEW.definition_version<>OLD.definition_version OR NEW.parent_request_id<>OLD.parent_request_id
  OR NEW.requester_id<>OLD.requester_id OR NEW.started_at<>OLD.started_at
BEGIN SELECT RAISE(ABORT,'a journey keeps the request and the definition it started on'); END;

CREATE TABLE journey_run_steps (
  run_id TEXT NOT NULL REFERENCES journey_runs(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 40),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  step_key TEXT NOT NULL CHECK(length(trim(step_key)) BETWEEN 2 AND 40),
  item_kind TEXT NOT NULL CHECK(item_kind IN ('service','module','benefit','group')),
  item_key TEXT NOT NULL CHECK(length(trim(item_key)) BETWEEN 2 AND 60),
  -- created: وُلد طلب ابن. skipped: الشرط لم يتحقق. blocked: تحقق الشرط ولم يمكن التوليد (خدمة موقوفة
  -- بـ129 مثلًا، أو لا منفّذ). والفرق بين الثلاثة هو ما يُقرأ في صفحة التتبع: «لم تُطلب» غير «تعذّرت».
  outcome TEXT NOT NULL CHECK(outcome IN ('created','skipped','blocked')),
  -- الشرط كما قُيِّم، بشكل show_when نفسه المفروض في app/validation.mjs. لغة شرطٍ ثانية في المنصة
  -- تعني مُقيِّمًا ثانيًا وثغرةً ثانية.
  condition_json TEXT NOT NULL CHECK(json_valid(condition_json)),
  reason TEXT NOT NULL DEFAULT '',
  child_request_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id,position),
  FOREIGN KEY(child_request_id,tenant_id) REFERENCES requests(id,tenant_id),
  CHECK((outcome='created')=(child_request_id IS NOT NULL)),
  -- skipped وblocked لا يمرّان بلا سبب مكتوب يُقرأ في صفحة التتبع.
  CHECK(outcome='created' OR length(trim(reason))>=4)
) STRICT;
-- الطلب الواحد ابنٌ لخطوة واحدة على الأكثر: لا يظهر طلب في رحلتين فيُحسب مرتين في أي عدّ.
CREATE UNIQUE INDEX journey_run_steps_child ON journey_run_steps(child_request_id) WHERE child_request_id IS NOT NULL;
CREATE TRIGGER journey_run_steps_no_delete BEFORE DELETE ON journey_run_steps
  BEGIN SELECT RAISE(ABORT,'journey steps are retained; a step that did not run says so in its outcome'); END;

-- ── 6 و7. التفضيلات الشخصية ──────────────────────────────────────────────────────
-- ولماذا ليستا إلحاقيتين وكل قرارٍ في هذه المنصة إلحاقي: لأن هاتين ليستا قرارًا مؤسسيًا. الإخفاء في 129
-- قرارُ منظمةٍ بسببٍ مكتوب يقرؤه غير صاحبه فسجلّه دليل؛ وإخفاء موظفٍ اقتراحًا عن نفسه تفضيلٌ لا قارئ له
-- غيره، وحفظ تاريخ ما أخفاه شخصٌ عن شاشته مراقبةٌ بلا غرض. ولهذا لا reason ولا decided_by ولا قادح.
CREATE TABLE catalog_preferences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  suggestions_hidden INTEGER NOT NULL DEFAULT 0 CHECK(suggestions_hidden IN (0,1)),
  last_lens TEXT NOT NULL DEFAULT 'need' CHECK(last_lens IN ('need','department','journey')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE TABLE catalog_hidden_suggestions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('service','module','benefit','group')),
  item_key TEXT NOT NULL CHECK(length(trim(item_key)) BETWEEN 2 AND 60),
  hidden_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id,item_kind,item_key),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- ── 8. حالة الإسقاط: ماذا تعرض الشاشة بالضبط ─────────────────────────────────────
-- نظير search_index_state (047): تصريحٌ بأن الصفحة تقرأ إسقاطًا، وأي نسخةٍ منه، ومتى أُسقِط، وكم بندًا
-- ليس في أي فئة. items_unplaced هو الرقم الذي يمنع العطب الصامت: 59 خدمة تسليمٍ للعملاء تسقط من
-- التصفّح بينما /api/catalog يعيدها. هدفه صفر، ويُعرض في لوح صحة الدليل.
CREATE TABLE catalog_projection_state (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  release_version INTEGER NOT NULL CHECK(release_version>=0),
  entries INTEGER NOT NULL CHECK(entries>=0),
  items_unplaced INTEGER NOT NULL DEFAULT 0 CHECK(items_unplaced>=0),
  rebuilt_at TEXT NOT NULL
) STRICT;

-- ── 9. أعمدة صفحة الخدمة على بطاقة التعريف القائمة (045) ─────────────────────────
-- صفحة الخدمة تحتاج تسعة أقسام، ستة منها مشتقة اليوم. والثلاثة الباقية — «هل تنطبق عليك» و«ما تحتاجه»
-- و«أسئلة شائعة» — موضعها service_cards لا جدولٌ جديد: هو بالفعل كائن المحتوى المنشور لكل خدمة بمفتاح
-- (tenant_id, service_code)، وفيه بالفعل دورة draft → published → superseded وقيد «الناشر غير المُعدّ»،
-- وفيه صفر صف اليوم فالإضافة لا تلمس بيانات أحد. وتفريق محتوى الخدمة على كائنين يعني نشرتين لصفحة
-- واحدة يمكن أن تفترقا.
ALTER TABLE service_cards ADD COLUMN short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE service_cards ADD COLUMN eligibility_rules TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(eligibility_rules) AND json_type(eligibility_rules)='object');
ALTER TABLE service_cards ADD COLUMN required_documents TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(required_documents) AND json_type(required_documents)='array');
ALTER TABLE service_cards ADD COLUMN faq TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(faq) AND json_type(faq)='array');

-- والقادح القائم service_cards_versioned يحرس أعمدةً **بالاسم** في استثناء الصف المنشور، والأعمدة
-- الأربعة الجديدة ليست فيه — فبطاقةٌ منشورة كانت ستستطيع تغيير قاعدة أهليتها وهي في طريقها إلى
-- superseded. إغفال هذا يفتح البابَ الوحيد الذي يسمح بتغيير شرط أهلية منشور بلا نسخة جديدة. فيُسقَط
-- القادح ويُعاد بناؤه بالأربعة مضافةً إلى الحراسة، بلا تغيير حرفٍ في بقيته.
DROP TRIGGER service_cards_versioned;
CREATE TRIGGER service_cards_versioned BEFORE UPDATE ON service_cards
WHEN NEW.version<>OLD.version+1 OR NEW.service_code<>OLD.service_code OR NEW.revision<>OLD.revision OR OLD.status='superseded'
  OR (OLD.status='published' AND NOT (NEW.status='superseded' AND NEW.outputs=OLD.outputs AND NEW.owner_id IS OLD.owner_id AND NEW.kpis=OLD.kpis AND NEW.acceptance_evidence=OLD.acceptance_evidence
    AND NEW.short_description=OLD.short_description AND NEW.eligibility_rules=OLD.eligibility_rules
    AND NEW.required_documents=OLD.required_documents AND NEW.faq=OLD.faq))
BEGIN SELECT RAISE(ABORT,'a published card is replaced by a new revision, not edited'); END;
