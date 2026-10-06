-- ترحيل 157 — دليل البيانات المرجعية: دول · بنوك · بعثات دبلوماسية. 29 سبتمبر 2026.
--
-- ‏**هذا الترحيل يبني البنية ولا يبذر صفًا واحدًا. الجداول الثلاثة تخرج من هذا الترحيل فارغة، عن قصد.**
-- طلب المالك بالحرف: «Do not invent, guess, or manually substitute unverified institutions». ومصدر البنوك
-- الرسمي — البنك المركزي السعودي sama.gov.sa — لم يُوصَل من هذه البيئة (خمس محاولات بمسارات مختلفة، كلها
-- HTTP 000؛ وmofa.gov.sa وصل لكنه صفحة تُركَّب في المتصفح فلا تصل منها قائمة بعثات — التفصيل والتاريخ في
-- docs/services/MASTER-DATA-SOURCES.md). فالبذر من ذاكرة كاتب الترحيل كان سيضع في عمود source_authority
-- كلمة «SAMA» بجوار صفوف لم تمرّ على SAMA، وذلك كذبٌ في سجل يُدقَّق، لا نقصُ بيانات. الجدول الفارغ يقول
-- «لا أعرف» بصدق؛ الجدول المبذور من الذاكرة يقول «أعرف» كذبًا، ولا أحد بعد شهر يعرف أيّ صف جاء من أين.
-- ولهذا verification تبدأ 'unverified' ولا يرفعها ترحيل أبدًا: المطابقة مع المصدر إقرار إنسان باسمه
-- (كما في الترحيل 128 مع مواد اللائحة)، لا فعل ملف SQL.
--
-- ‏**قيد المالك الصريح والمتكرر: لا حقل حالة تشغيلية، إطلاقًا.**
-- «الدليل لا يعرض ولا يخزّن ولا يصنّف ما إذا كان البنك قد بدأ نشاطه أو لم يبدأ». فليس في الجداول الثلاثة
-- أدناه عمودٌ ولا قيدٌ ولا فهرسٌ باسم active أو operational أو started أو status أو ما يؤدي معناها، ولا
-- يُضاف واحد منها في ترحيل لاحق. ويحرس هذا القيدَ اختبارٌ يقرأ PRAGMA table_info لكل جدول كيان ويسقط إن
-- ظهر عمود كهذا (tests/master-data.test.mjs) — فالقيد مفروض بفحص لا بنيّة حسنة.
-- وتنبيه لمن يقرأ لاحقًا: عمود verification ليس حالة تشغيلية ولا يجوز استعماله كحالة تشغيلية. هو يقول
-- «هل طُوبِق هذا **الصف** على مصدره» لا «هل يعمل هذا **البنك**». الأول وصفٌ لجودة سجلّنا، والثاني حكمٌ على
-- المؤسسة رفضه المالك. من احتاج يومًا الثاني فليعد إلى المالك، لا إلى هذا العمود.
--
-- ولماذا لا tenant_id في جداول الكيانات: رمز الدولة ISO ورقم ترخيص البنك حقائق عن العالم لا عن كيان في
-- المنصة. ونسخةٌ لكل كيان تعني نسختين تتفرقان عن الحقيقة نفسها، وتُسقط التفرّد الذي طلبه المالك (ISO فريد،
-- والترخيص فريد) إلى تفرّد داخل الكيان وحده — فيصير للراجحي رقمُ ترخيصٍ في كيان ورقمٌ آخر في كيان ثانٍ.
-- المقترحات وحدها تحمل tenant_id، لأن من يقترح شخصٌ ينتمي إلى كيان.

-- ————— 1) الدول —————
-- المعرّف مستقر ومستقل عن اسم العرض ومستقل عن رمز ISO معًا. رموز ISO تتغير (CS صارت RS وME)، والاسم يُعاد
-- كتابته، فلو كان أحدهما مفتاحًا لتحوّل تغييرٌ في التسمية إلى صفٍّ جديد تنكسر عنده كل إحالة قديمة.
CREATE TABLE countries (
  id TEXT PRIMARY KEY CHECK(id GLOB '[a-z][a-z0-9_]*' AND length(id) BETWEEN 2 AND 40),
  iso2 TEXT NOT NULL CHECK(iso2 GLOB '[A-Z][A-Z]'),
  iso3 TEXT NOT NULL CHECK(iso3 GLOB '[A-Z][A-Z][A-Z]'),
  -- ISO 3166-1 numeric: نصّ لا عدد، لأن '004' ليست 4 وصفرُ الصدارة جزء من الرمز. فارغ حين لا يُورَّد.
  iso_numeric TEXT NOT NULL DEFAULT '' CHECK(iso_numeric='' OR iso_numeric GLOB '[0-9][0-9][0-9]'),
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar)) BETWEEN 2 AND 120),
  name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 2 AND 120),
  -- سلطة المصدر: من يقول هذا. اسمُ الجهة كما تُعرَف، لا «الإنترنت» ولا «معروف».
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  -- المطابقة إقرار إنسان باسمه: لا تاريخ تحقق بلا مُحقِّق، ولا مُحقِّق بلا تاريخ.
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified')),
  created_at TEXT NOT NULL,
  CHECK((verified_by IS NULL)=(verified_at IS NULL)),
  CHECK(verification='unverified' OR verified_by IS NOT NULL)
) STRICT;
-- التفرّد الذي طلبه المالك: رمز ISO فريد للدولة — بشكليه، فلا دولتان بـ'SA' ولا بـ'SAU'.
CREATE UNIQUE INDEX countries_iso2 ON countries(iso2);
CREATE UNIQUE INDEX countries_iso3 ON countries(iso3);
CREATE UNIQUE INDEX countries_iso_numeric ON countries(iso_numeric) WHERE iso_numeric<>'';

-- ————— 2) البنوك —————
-- ‏لا عمود حالة تشغيلية هنا. راجع رأس الملف.
CREATE TABLE banks (
  id TEXT PRIMARY KEY CHECK(id GLOB '[a-z][a-z0-9_]*' AND length(id) BETWEEN 2 AND 40),
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar)) BETWEEN 2 AND 160),
  name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 2 AND 160),
  -- الاختصار الذي يكتبه الموظف فعلًا («الراجحي»، «ALRAJHI»)، فارغ حين لا اختصار معروف.
  short_name TEXT NOT NULL DEFAULT '',
  country_id TEXT NOT NULL REFERENCES countries(id),
  -- رقم الترخيص إن وُجد، وفريدٌ حين يُورَّد: ترخيصان بالرقم نفسه أحدهما خطأ إدخال لا حقيقة.
  -- الفراغ يعني «لم يُورَّد» لا «لا ترخيص له»، والفهرس الجزئي يسمح بعشرات الفراغات ويمنع تكرار رقم حقيقي.
  licence_number TEXT NOT NULL DEFAULT '',
  -- ولا رقمَ ترخيصٍ بلا جهة قالته: الرقم بلا سلطته لا يُراجع ولا يُصحَّح.
  licence_authority TEXT NOT NULL DEFAULT '',
  -- BIC/SWIFT: معرّف مستقر تصدره ISO، يُستعمل في التحويلات. فريد حين يُورَّد.
  bic TEXT NOT NULL DEFAULT '' CHECK(bic='' OR bic GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][A-Z][A-Z0-9][A-Z0-9]*'),
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified')),
  created_at TEXT NOT NULL,
  CHECK((verified_by IS NULL)=(verified_at IS NULL)),
  CHECK(verification='unverified' OR verified_by IS NOT NULL),
  CHECK(licence_number='' OR length(trim(licence_authority))>=3)
) STRICT;
CREATE UNIQUE INDEX banks_licence_number ON banks(licence_number) WHERE licence_number<>'';
CREATE UNIQUE INDEX banks_bic ON banks(bic) WHERE bic<>'';
CREATE INDEX banks_country ON banks(country_id);

-- ————— 3) البعثات الدبلوماسية —————
-- country_id هي الدولة المُرسِلة (سفارة اليابان ← اليابان). التفرّد كما طلبه المالك: الدولة + نوع البعثة
-- + المدينة. فلليابان سفارة واحدة في الرياض وقنصلية عامة واحدة في جدة، ولا يُدخَل الصف مرتين بفارق مسافة
-- في الاسم — لأن المدينة تُطبَّع قبل المقارنة في الفهرس أدناه.
CREATE TABLE diplomatic_missions (
  id TEXT PRIMARY KEY CHECK(id GLOB '[a-z][a-z0-9_]*' AND length(id) BETWEEN 2 AND 60),
  country_id TEXT NOT NULL REFERENCES countries(id),
  mission_type TEXT NOT NULL CHECK(mission_type IN ('embassy','consulate_general','consulate','permanent_mission','interests_section','other')),
  city_ar TEXT NOT NULL CHECK(length(trim(city_ar)) BETWEEN 2 AND 80),
  city_en TEXT NOT NULL CHECK(length(trim(city_en)) BETWEEN 2 AND 80),
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar)) BETWEEN 2 AND 200),
  name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 2 AND 200),
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified')),
  created_at TEXT NOT NULL,
  CHECK((verified_by IS NULL)=(verified_at IS NULL)),
  CHECK(verification='unverified' OR verified_by IS NOT NULL)
) STRICT;
-- التفرّد على صورة موحَّدة من المدينة: «جدّة» و«جدة» و«Jeddah » مدينة واحدة، والقيمة المخزَّنة تبقى كما
-- كُتبت. ما يُوحَّد في الفهرس هو ما يوحّده app/arabic-text.mjs من صور الهمزة والتاء والتشكيل، بقدر ما تبلغه
-- دوال SQLite المتاحة بلا تبعية: الحركات تُزال، والألف بأشكالها ألف، والتاء المربوطة هاء، والمسافات تُقصّ.
CREATE UNIQUE INDEX diplomatic_missions_unique ON diplomatic_missions(
  country_id, mission_type,
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    lower(trim(city_ar)),
    char(1611),''),char(1612),''),char(1613),''),char(1614),''),char(1615),''),char(1616),''),char(1617),''),char(1618),''),
    char(1600),''),char(1569),'')
);
CREATE INDEX diplomatic_missions_country ON diplomatic_missions(country_id);

-- ————— 4) الأسماء البديلة —————
-- بنكٌ يتغير اسمه لا تتغير معه المراسلات والعقود التي كُتبت باسمه القديم: من بحث بـ«سامبا» بعد الدمج يجب
-- أن يصل إلى الصف القائم، لا إلى «لا نتائج». فالاسم القديم يُحفظ بديلًا بنوعه (former_name) ولا يُحذف أبدًا،
-- ويبقى id واحدًا فلا تنكسر إحالة.
-- والبديل يحمل سلطته هو: من يقول إن هذا الاسم كان لهذا الكيان.
CREATE TABLE master_data_aliases (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('country','bank','mission')),
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL CHECK(length(trim(alias)) BETWEEN 2 AND 200),
  alias_kind TEXT NOT NULL CHECK(alias_kind IN ('former_name','abbreviation','trade_name','transliteration','common_name')),
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX master_data_aliases_unique ON master_data_aliases(entity_kind,entity_id,lower(trim(alias)));
CREATE INDEX master_data_aliases_entity ON master_data_aliases(entity_kind,entity_id);
-- مفتاحٌ أجنبي إلى ثلاثة جداول لا يُكتب في SQLite، فالوجود يُفحص بقادح: بديلٌ لكيان غير موجود اسمٌ معلّق
-- لا يصل منه أحد إلى شيء.
CREATE TRIGGER master_data_aliases_entity_exists BEFORE INSERT ON master_data_aliases
WHEN NOT EXISTS(
  SELECT 1 FROM countries WHERE NEW.entity_kind='country' AND id=NEW.entity_id
  UNION ALL SELECT 1 FROM banks WHERE NEW.entity_kind='bank' AND id=NEW.entity_id
  UNION ALL SELECT 1 FROM diplomatic_missions WHERE NEW.entity_kind='mission' AND id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'alias points at no such entity'); END;

-- ————— 5) تاريخ الصفوف: كل تعديل يحفظ صورة ما كان —————
-- «تحفظ التاريخ»: لا يُعدَّل صفٌّ مرجعي فتضيع قيمته السابقة. الصورة السابقة تُكتب كاملة قبل الكتابة الجديدة،
-- فيُقرأ لاحقًا ما كان رقم الترخيص المسجَّل حين صُرف راتبٌ إلى هذا البنك، لا ما صار إليه بعد تصحيح.
CREATE TABLE master_data_revisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('country','bank','mission')),
  entity_id TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  changed_at TEXT NOT NULL
) STRICT;
CREATE INDEX master_data_revisions_entity ON master_data_revisions(entity_kind,entity_id,seq);

CREATE TRIGGER countries_keep_history AFTER UPDATE ON countries BEGIN
  INSERT INTO master_data_revisions(entity_kind,entity_id,before_json,changed_at)
  VALUES('country',OLD.id,json_object('id',OLD.id,'iso2',OLD.iso2,'iso3',OLD.iso3,'iso_numeric',OLD.iso_numeric,
    'name_ar',OLD.name_ar,'name_en',OLD.name_en,'source_authority',OLD.source_authority,'source_url',OLD.source_url,
    'verified_by',OLD.verified_by,'verified_at',OLD.verified_at,'verification',OLD.verification,'created_at',OLD.created_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER banks_keep_history AFTER UPDATE ON banks BEGIN
  INSERT INTO master_data_revisions(entity_kind,entity_id,before_json,changed_at)
  VALUES('bank',OLD.id,json_object('id',OLD.id,'name_ar',OLD.name_ar,'name_en',OLD.name_en,'short_name',OLD.short_name,
    'country_id',OLD.country_id,'licence_number',OLD.licence_number,'licence_authority',OLD.licence_authority,'bic',OLD.bic,
    'source_authority',OLD.source_authority,'source_url',OLD.source_url,'verified_by',OLD.verified_by,
    'verified_at',OLD.verified_at,'verification',OLD.verification,'created_at',OLD.created_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER diplomatic_missions_keep_history AFTER UPDATE ON diplomatic_missions BEGIN
  INSERT INTO master_data_revisions(entity_kind,entity_id,before_json,changed_at)
  VALUES('mission',OLD.id,json_object('id',OLD.id,'country_id',OLD.country_id,'mission_type',OLD.mission_type,
    'city_ar',OLD.city_ar,'city_en',OLD.city_en,'name_ar',OLD.name_ar,'name_en',OLD.name_en,
    'source_authority',OLD.source_authority,'source_url',OLD.source_url,'verified_by',OLD.verified_by,
    'verified_at',OLD.verified_at,'verification',OLD.verification,'created_at',OLD.created_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ولا حذفَ صامت: صفٌّ مرجعي أشارت إليه مسيّرات رواتب وعقود لا يُمحى، ورسالة الرفض تقول البديل بالحرف
-- («سجّل اسمه الجديد بديلًا») فلا يُترك القارئ مع «ممنوع» وحدها.
CREATE TRIGGER countries_no_delete BEFORE DELETE ON countries
  BEGIN SELECT RAISE(ABORT,'reference rows are never deleted: correct the row and keep the former value as an alias'); END;
CREATE TRIGGER banks_no_delete BEFORE DELETE ON banks
  BEGIN SELECT RAISE(ABORT,'reference rows are never deleted: correct the row and keep the former value as an alias'); END;
CREATE TRIGGER diplomatic_missions_no_delete BEFORE DELETE ON diplomatic_missions
  BEGIN SELECT RAISE(ABORT,'reference rows are never deleted: correct the row and keep the former value as an alias'); END;
CREATE TRIGGER master_data_aliases_no_delete BEFORE DELETE ON master_data_aliases
  BEGIN SELECT RAISE(ABORT,'an alias is what a reference used to say: it is never erased'); END;
CREATE TRIGGER master_data_aliases_no_update BEFORE UPDATE ON master_data_aliases
  BEGIN SELECT RAISE(ABORT,'an alias is not edited: add the corrected alias'); END;
CREATE TRIGGER master_data_revisions_no_update BEFORE UPDATE ON master_data_revisions
  BEGIN SELECT RAISE(ABORT,'row history is append only'); END;
CREATE TRIGGER master_data_revisions_no_delete BEFORE DELETE ON master_data_revisions
  BEGIN SELECT RAISE(ABORT,'row history is append only'); END;
-- والمعرّف لا يُعاد كتابته: تغييرُه يقطع كل إحالة قديمة بلا أثر، وهو الشيء الوحيد الذي لا يصلحه تصحيح لاحق.
CREATE TRIGGER countries_id_fixed BEFORE UPDATE OF id ON countries WHEN NEW.id<>OLD.id
  BEGIN SELECT RAISE(ABORT,'a stable identifier is never rewritten'); END;
CREATE TRIGGER banks_id_fixed BEFORE UPDATE OF id ON banks WHEN NEW.id<>OLD.id
  BEGIN SELECT RAISE(ABORT,'a stable identifier is never rewritten'); END;
CREATE TRIGGER diplomatic_missions_id_fixed BEFORE UPDATE OF id ON diplomatic_missions WHEN NEW.id<>OLD.id
  BEGIN SELECT RAISE(ABORT,'a stable identifier is never rewritten'); END;

-- ————— 6) مراجعة تغيّر المصدر: يُقترح ولا يُكتب فوق الإنتاج —————
-- وصل المصدر بقيمة تخالف المسجَّل — رقم ترخيص مختلف، أو اسم بنك بعد دمج، أو بعثة انتقلت مدينة. الكتابة
-- التلقائية فوق صف الإنتاج تعني أن تحديثًا آليًا يغيّر رقم ترخيصٍ يُصرف عليه راتب، بلا أن يراه أحد وبلا أن
-- يُسأل أحد. فالوارد يجلس هنا مقترحًا، والصف في الإنتاج لا يتحرك حتى يقبله إنسان باسمه.
-- السجل إلحاقي كـservice_availability قبله: الاقتراح صف، والقرار صف ثانٍ يشاركه thread_id، والحالة السارية
-- صاحبُ أكبر seq في الخيط. وseq تسلسل من القاعدة لا ختم وقت: ختمان في الملّي ثانية نفسها لا يحسمان أيهما
-- الأخير، والتسلسل يحسم.
CREATE TABLE master_data_source_reviews (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- خيط المراجعة: يجمع الاقتراح وقراره. يُولَّد عند الاقتراح ولا يُعاد استعماله.
  thread_id TEXT NOT NULL CHECK(length(trim(thread_id)) BETWEEN 6 AND 60),
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('country','bank','mission')),
  -- فارغ (NULL) حين يقترح المصدر كيانًا جديدًا لا وجود له بعد؛ ومملوء حين يقترح تغييرًا على صف قائم.
  entity_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('proposed','accepted','rejected')),
  -- القيم المقترحة كما وصلت من المصدر، حرفًا بحرف، بلا تنظيف: ما يُراجَع هو ما قاله المصدر لا ما فهمناه منه.
  proposed_json TEXT NOT NULL CHECK(json_valid(proposed_json)),
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  source_fetched_at TEXT NOT NULL,
  -- سطر يقول لماذا: يُقرأ في شاشة المراجعة، وفي سجل التدقيق بعد سنة. قرارٌ بلا سبب مكتوب يصير قرارًا
  -- لا يعرف أحد سببه ولا يجرؤ أحد على الرجوع عنه.
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 4 AND 400),
  actor_id TEXT NOT NULL REFERENCES users(id),
  acted_at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX master_data_reviews_thread ON master_data_source_reviews(thread_id,seq);
CREATE INDEX master_data_reviews_open ON master_data_source_reviews(tenant_id,entity_kind,state,seq);

CREATE TRIGGER master_data_reviews_no_update BEFORE UPDATE ON master_data_source_reviews
  BEGIN SELECT RAISE(ABORT,'a source review is append only: record the decision as a new row'); END;
CREATE TRIGGER master_data_reviews_no_delete BEFORE DELETE ON master_data_source_reviews
  BEGIN SELECT RAISE(ABORT,'a source review is append only: a proposal received is never erased'); END;
-- خيطٌ يبدأ بقرار يعني قبولَ ما لم يُقترح: القرار لا يكون أول صف في خيطه.
CREATE TRIGGER master_data_reviews_decision_needs_proposal BEFORE INSERT ON master_data_source_reviews
WHEN NEW.state<>'proposed' AND NOT EXISTS(SELECT 1 FROM master_data_source_reviews p WHERE p.thread_id=NEW.thread_id)
  BEGIN SELECT RAISE(ABORT,'nothing was proposed on this thread to decide'); END;
-- واقتراحٌ على خيط قائم يعني اقتراحين بقرار واحد: الخيط يُفتح مرة.
CREATE TRIGGER master_data_reviews_one_proposal BEFORE INSERT ON master_data_source_reviews
WHEN NEW.state='proposed' AND EXISTS(SELECT 1 FROM master_data_source_reviews p WHERE p.thread_id=NEW.thread_id)
  BEGIN SELECT RAISE(ABORT,'this review thread is already open: open a new thread'); END;
-- وخيطٌ حُسم لا يُحسم ثانية: القرار الأول هو القرار، ونقضُه اقتراحٌ جديد بخيط جديد يُقرأ سببه.
CREATE TRIGGER master_data_reviews_decided_once BEFORE INSERT ON master_data_source_reviews
WHEN NEW.state<>'proposed' AND EXISTS(SELECT 1 FROM master_data_source_reviews p WHERE p.thread_id=NEW.thread_id AND p.state<>'proposed')
  BEGIN SELECT RAISE(ABORT,'this review thread is already decided'); END;
