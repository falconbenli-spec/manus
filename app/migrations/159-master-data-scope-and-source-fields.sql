-- ترحيل 159 — نطاق البعثات، وحقول البنك كما يصدرها المصدر، وحارس القيم. 30 سبتمبر 2026.
--
-- ‏**ثلاثة أسباب، كلها من قراءة المصدر الرسمي نفسه في هذا اليوم، لا من رأي أحد.**
--
-- (1) ‏**المالك حسم نطاق البعثات.** سُئل عن المقصود فقال: «واقصد السفارات الي عندنا» — أي البعثات
--     المعتمدة لدى المملكة (سفارات الدول الأجنبية وقنصلياتها داخل المملكة)، لا بعثات المملكة في الخارج.
--     والترحيل 157 كان يحمل النوعين في جدول واحد بلا ما يفرّقهما، وكتب ذلك في تعليق. والتعليق لا يمنع
--     حِمْلًا: يكفي سكربت استيراد واحد من بوابة السفارات السعودية ليصير في الجدول صفّان لليابان — سفارتها
--     في الرياض وسفارة المملكة في طوكيو — ولا شيء في أيّ صفٍّ يقول أيّهما، فيقرأ الموظف عنوان طوكيو وهو
--     يطلب تصديقًا من الرياض. فالنطاق يُثبَّت في البنية: عمود accreditation بقيمة واحدة مسموحة، وقادح
--     يرفض بعثةً دولتُها المُرسِلة هي المملكة.
--     ولماذا قيمة واحدة لا قيمتان مفتوحتان: القيمتان المفتوحتان هما الخليط نفسه. ويوم يقرّر المالك ضمّ
--     بعثات المملكة في الخارج، يُوسَّع القيد بترحيل يُكتب سببه، وكل صف قديم يكون **موسومًا** بنوعه أصلًا
--     فلا يحتاج أحدٌ أن يخمّن ما كانت عليه الصفوف السابقة.
--
-- (2) ‏**قائمة ساما وصلت اليوم** (بمتصفح يشغّل جافاسكربت — وcurl كان يرجع HTTP 000؛ التفصيل والتاريخ
--     والعنوان في docs/services/MASTER-DATA-SOURCES.md). وظهر منها أن ساما **لا تنشر رقم ترخيص للبنك
--     ولا موطنه**. تنشر: الاسم العربي، والاسم الإنجليزي، والرقم الموحد، ورقم السجل التجاري، وتصنيفها هي
--     للبنك. فتُضاف الأعمدة بأسماء ما نُشر لا بأسماء نتمناها، ويبقى licence_number فارغًا لأنه **لم
--     يُورَّد**، لا لأن البنك بلا ترخيص.
--     وcountry_id يصير اختياريًّا للبنك: ساما لا تقول موطن البنك، واستنباطه من الاسم («بنك الكويت الوطني
--     ← الكويت») تخمينٌ منعه المالك بالحرف. والعمود الإلزامي هنا لم يكن حارسًا: كان يُجبر المستورد على
--     اختراع صفِّ دولةٍ برمز ISO من ذاكرته قبل أن يُسجَّل بنكٌ واحد — أي أنه كان يفرض المخالفة التي يُفترض
--     أن يمنعها. ومن يحتاج موطن البنك يومًا يجده حين ينشره مصدرٌ يقوله، أو لا يجده.
--
-- (3) ‏**وأخطر ما وصل: المصدر الرسمي نفسه ينشر الحالة التشغيلية.** حقل ActivityType في قائمة ساما يقول
--     لثلاثة بنوك: «مزاولة أعمال مصرفية (لم يبدأ النشاط)» / «Banking Business (Not yet operational)».
--     وهذا بالضبط ما منع المالك عرضَه وتخزينَه. فحارس أسماء الحقول (وهو قائم في app/master-data.mjs منذ
--     157) لا يكفي: العبارة هنا لا تأتي في **اسم حقل** بل داخل **قيمة**، فتدخل في اسم بنك أو في تصنيفه
--     وتُطبع على الشاشة والحارس لم يُمسّ. ولهذا يُضاف حارسٌ على القيم في الطبقتين: قيود CHECK أدناه،
--     ونظيرها في app/master-data.mjs برسالة تُقرأ. وقائمة العبارات واحدة في الملفين، ويحرس تطابقَها
--     اختبارٌ يقرأ هذا الملف ويطلب كل عبارة من قائمة الطبقة فيه.
--     ولا يُحذَف البنك بسبب هذه العبارة: البنك مرخَّص وهذه حقيقة ساما، والممنوع هو نقل الحالة معه. فالمحمّل
--     يتجاهل الحقل الذي يحملها ويسجّل البنك، ولا «يتجاوز» شيئًا.
--
-- ولا يبذر هذا الترحيل صفًا، كسابقه. البذر فعل محمّل باسم إنسان من ملف مصدر، لا فعل ملف SQL.

-- ————— 1) البعثات: النطاق في البنية —————
-- القيمة الواحدة المسموحة تقول في كل صف ما هو، فلا يصير الجدول خليطًا ولو أخطأ مستوردٌ يومًا.
ALTER TABLE diplomatic_missions ADD COLUMN accreditation TEXT NOT NULL DEFAULT 'accredited_to_kingdom'
  CHECK(accreditation='accredited_to_kingdom');

-- والتفرّد يحمل النطاق معه: يوم يُوسَّع القيد تكون البعثتان مفرّقتين في الفهرس أصلًا، ولا يُعاد بناء فهرس
-- على جدول ممتلئ — وذلك عمل يُؤجَّل عادةً حتى يُنسى.
DROP INDEX diplomatic_missions_unique;
CREATE UNIQUE INDEX diplomatic_missions_unique ON diplomatic_missions(
  accreditation, country_id, mission_type,
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    lower(trim(city_ar)),
    char(1611),''),char(1612),''),char(1613),''),char(1614),''),char(1615),''),char(1616),''),char(1617),''),char(1618),''),
    char(1600),''),char(1569),'')
);

-- دولةٌ مُرسِلةٌ هي المملكة تعني بعثةً للمملكة في الخارج، وذلك دليلٌ آخر لا هذا. والرمز ISO هو ما يُفحص
-- لا الاسم: الاسم يُكتب بعشر صور، والرمز واحد.
CREATE TRIGGER diplomatic_missions_sender_not_kingdom BEFORE INSERT ON diplomatic_missions
WHEN (SELECT iso2 FROM countries WHERE id=NEW.country_id)='SA'
  BEGIN SELECT RAISE(ABORT,'this directory holds only missions accredited to the Kingdom: a mission sent by the Kingdom belongs to a directory of its own'); END;
CREATE TRIGGER diplomatic_missions_sender_not_kingdom_on_update BEFORE UPDATE OF country_id ON diplomatic_missions
WHEN (SELECT iso2 FROM countries WHERE id=NEW.country_id)='SA'
  BEGIN SELECT RAISE(ABORT,'this directory holds only missions accredited to the Kingdom: a mission sent by the Kingdom belongs to a directory of its own'); END;

-- وحارس القيم على البعثة: العبارة الممنوعة لا تدخل في اسمها ولا في مدينتها.
CREATE TRIGGER diplomatic_missions_no_operational_status BEFORE INSERT ON diplomatic_missions
WHEN (SELECT count(*) FROM (SELECT 'بدأ النشاط' p UNION ALL SELECT 'لم يباشر' UNION ALL SELECT 'متوقف عن'
      UNION ALL SELECT 'not yet operational' UNION ALL SELECT 'not operational' UNION ALL SELECT 'ceased operation'
      UNION ALL SELECT 'commenced operation' UNION ALL SELECT 'under liquidation')
      WHERE instr(lower(NEW.name_ar||' '||NEW.name_en||' '||NEW.city_ar||' '||NEW.city_en), p)>0) > 0
  BEGIN SELECT RAISE(ABORT,'an operational-status phrase reached a directory value: the directory never records whether an institution has begun operating'); END;
CREATE TRIGGER diplomatic_missions_no_operational_status_on_update BEFORE UPDATE ON diplomatic_missions
WHEN (SELECT count(*) FROM (SELECT 'بدأ النشاط' p UNION ALL SELECT 'لم يباشر' UNION ALL SELECT 'متوقف عن'
      UNION ALL SELECT 'not yet operational' UNION ALL SELECT 'not operational' UNION ALL SELECT 'ceased operation'
      UNION ALL SELECT 'commenced operation' UNION ALL SELECT 'under liquidation')
      WHERE instr(lower(NEW.name_ar||' '||NEW.name_en||' '||NEW.city_ar||' '||NEW.city_en), p)>0) > 0
  BEGIN SELECT RAISE(ABORT,'an operational-status phrase reached a directory value: the directory never records whether an institution has begun operating'); END;

-- وتاريخ الصف يحمل النطاق: القادح يُعاد لأن json_object فيه يُعدّ الأعمدة بالاسم، وعمودٌ جديد لا يدخله
-- تلقائيًّا — فصورةُ ما كان تنقص عمودًا ولا يُنبِّه أحدٌ إلى ذلك.
DROP TRIGGER diplomatic_missions_keep_history;
CREATE TRIGGER diplomatic_missions_keep_history AFTER UPDATE ON diplomatic_missions BEGIN
  INSERT INTO master_data_revisions(entity_kind,entity_id,before_json,changed_at)
  VALUES('mission',OLD.id,json_object('id',OLD.id,'country_id',OLD.country_id,'mission_type',OLD.mission_type,
    'accreditation',OLD.accreditation,'city_ar',OLD.city_ar,'city_en',OLD.city_en,'name_ar',OLD.name_ar,'name_en',OLD.name_en,
    'source_authority',OLD.source_authority,'source_url',OLD.source_url,'verified_by',OLD.verified_by,
    'verified_at',OLD.verified_at,'verification',OLD.verification,'created_at',OLD.created_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- ————— 2) البنوك: إعادة بناء الجدول —————
-- ‏**لماذا إعادة بناء وليس ALTER:** المطلوب رفع NOT NULL عن country_id، وSQLite لا تُسقِط NOT NULL بـALTER.
-- والجدول فارغ اليوم، فالنقل بلا كلفة؛ ومع ذلك يُكتب INSERT…SELECT كاملًا ليعمل الترحيل على نسخة ممتلئة
-- من القائمة كما يعمل على قاعدة جديدة.
-- ولا جدولَ آخر في المنصة يشير إلى banks (فُحِص)، فالحذف والتسمية لا يقطعان مفتاحًا أجنبيًّا لأحد.

-- قادح master_data_aliases_entity_exists يقرأ banks، ويُحذف ويُعاد بعد النقل. والسبب دقيق: ALTER TABLE …
-- RENAME تُعيد تحليل كل قادح في المخطَّط، فقادحٌ يشير إلى جدولٍ محذوفٍ لحظةَ التسمية يُسقِط الترحيل كله.
DROP TRIGGER master_data_aliases_entity_exists;
DROP TRIGGER banks_keep_history;
DROP TRIGGER banks_no_delete;
DROP TRIGGER banks_id_fixed;

CREATE TABLE banks_rebuilt (
  id TEXT PRIMARY KEY CHECK(id GLOB '[a-z][a-z0-9_]*' AND length(id) BETWEEN 2 AND 40),
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar)) BETWEEN 2 AND 160),
  name_en TEXT NOT NULL CHECK(length(trim(name_en)) BETWEEN 2 AND 160),
  short_name TEXT NOT NULL DEFAULT '',
  -- اختياري بقصد: ساما لا تنشر موطن البنك، واستنباطه من اسمه تخمين. NULL تعني «ما نشره مصدر».
  country_id TEXT REFERENCES countries(id),
  licence_number TEXT NOT NULL DEFAULT '',
  licence_authority TEXT NOT NULL DEFAULT '',
  -- الرقم الموحد ورقم السجل التجاري كما تنشرهما ساما في صفحة الجهات المرخّصة، بعنوانَيهما عندها. وهما
  -- ليسا رقم ترخيص: ولهذا لم يُحشَرا في licence_number، لأن عمودًا اسمُه ترخيصٌ وفيه سجلٌّ تجاري يُقرأ
  -- بعد سنة على أنه ترخيص ولا أحد يعرف أن الاسم كان كذبًا.
  -- والمصدر يكتب '-' حيث لا ينشر رقمًا؛ و'-' تُخزَّن فراغًا لا شرطة: الشرطة قيمةٌ تتكرر فتُسقط التفرّد،
  -- وتُقرأ على أنها رقمٌ اسمه «-».
  unified_number TEXT NOT NULL DEFAULT '' CHECK(unified_number='' OR unified_number GLOB '[0-9][0-9]*'),
  commercial_registration TEXT NOT NULL DEFAULT '' CHECK(commercial_registration='' OR commercial_registration GLOB '[0-9][0-9]*'),
  -- تصنيف المصدر بحرفه («البنوك المحلية»، «البنوك الرقمية»، «فروع البنوك الأجنبية»). وهو تصنيف ترخيصٍ
  -- لا حالة تشغيل: لا يقول هل باشر البنك العمل، ولا يُقرأ يومًا على أنه يقول ذلك، ولا يُرشَّح به.
  source_category TEXT NOT NULL DEFAULT '',
  bic TEXT NOT NULL DEFAULT '' CHECK(bic='' OR bic GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][A-Z][A-Z0-9][A-Z0-9]*'),
  source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) BETWEEN 3 AND 160),
  source_url TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','verified')),
  created_at TEXT NOT NULL,
  CHECK((verified_by IS NULL)=(verified_at IS NULL)),
  CHECK(verification='unverified' OR verified_by IS NOT NULL),
  CHECK(licence_number='' OR length(trim(licence_authority))>=3),
  -- حارس القيم: العبارة التي ينشرها المصدر ولا يقبلها المالك. وهو قيدٌ لا قادح لأن القيد يفحص المنقول
  -- في INSERT…SELECT أدناه أيضًا: فلو حملت نسخةٌ ممتلئة عبارةً ممنوعة، سقط الترحيل وقال السبب، بدل أن
  -- تُهاجر العبارة إلى الجدول الجديد بصمت وتظهر على الشاشة بعدها.
  CHECK(instr(name_ar||' '||name_en||' '||short_name||' '||source_category, 'بدأ النشاط')=0),
  CHECK(instr(name_ar||' '||name_en||' '||short_name||' '||source_category, 'لم يباشر')=0),
  CHECK(instr(name_ar||' '||name_en||' '||short_name||' '||source_category, 'متوقف عن')=0),
  CHECK(instr(lower(name_ar||' '||name_en||' '||short_name||' '||source_category), 'not yet operational')=0),
  CHECK(instr(lower(name_ar||' '||name_en||' '||short_name||' '||source_category), 'not operational')=0),
  CHECK(instr(lower(name_ar||' '||name_en||' '||short_name||' '||source_category), 'ceased operation')=0),
  CHECK(instr(lower(name_ar||' '||name_en||' '||short_name||' '||source_category), 'commenced operation')=0),
  CHECK(instr(lower(name_ar||' '||name_en||' '||short_name||' '||source_category), 'under liquidation')=0)
) STRICT;

INSERT INTO banks_rebuilt(id,name_ar,name_en,short_name,country_id,licence_number,licence_authority,bic,
  source_authority,source_url,verified_by,verified_at,verification,created_at)
  SELECT id,name_ar,name_en,short_name,country_id,licence_number,licence_authority,bic,
    source_authority,source_url,verified_by,verified_at,verification,created_at FROM banks;

DROP TABLE banks;
ALTER TABLE banks_rebuilt RENAME TO banks;

CREATE UNIQUE INDEX banks_licence_number ON banks(licence_number) WHERE licence_number<>'';
CREATE UNIQUE INDEX banks_bic ON banks(bic) WHERE bic<>'';
-- الرقم الموحد والسجل التجاري فريدان حين يُورَّدان: رقمان متطابقان لكيانين أحدهما خطأ إدخال لا حقيقة.
-- والفهرس جزئي لأن الفراغ «لم يُورَّد» ويتكرر بلا حدّ — وهو حال بنكين في قائمة اليوم.
CREATE UNIQUE INDEX banks_unified_number ON banks(unified_number) WHERE unified_number<>'';
CREATE UNIQUE INDEX banks_commercial_registration ON banks(commercial_registration) WHERE commercial_registration<>'';
CREATE INDEX banks_country ON banks(country_id);

-- صورة ما كان تحمل الأعمدة الجديدة: بلا ذلك يُقرأ تاريخ الصف ناقصًا ولا يُنبِّه أحدٌ إلى النقص.
CREATE TRIGGER banks_keep_history AFTER UPDATE ON banks BEGIN
  INSERT INTO master_data_revisions(entity_kind,entity_id,before_json,changed_at)
  VALUES('bank',OLD.id,json_object('id',OLD.id,'name_ar',OLD.name_ar,'name_en',OLD.name_en,'short_name',OLD.short_name,
    'country_id',OLD.country_id,'licence_number',OLD.licence_number,'licence_authority',OLD.licence_authority,
    'unified_number',OLD.unified_number,'commercial_registration',OLD.commercial_registration,
    'source_category',OLD.source_category,'bic',OLD.bic,
    'source_authority',OLD.source_authority,'source_url',OLD.source_url,'verified_by',OLD.verified_by,
    'verified_at',OLD.verified_at,'verification',OLD.verification,'created_at',OLD.created_at),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER banks_no_delete BEFORE DELETE ON banks
  BEGIN SELECT RAISE(ABORT,'reference rows are never deleted: correct the row and keep the former value as an alias'); END;
CREATE TRIGGER banks_id_fixed BEFORE UPDATE OF id ON banks WHEN NEW.id<>OLD.id
  BEGIN SELECT RAISE(ABORT,'a stable identifier is never rewritten'); END;

-- ويُعاد القادح الذي حُذف قبل النقل، بنصّه كما كان في الترحيل 157.
CREATE TRIGGER master_data_aliases_entity_exists BEFORE INSERT ON master_data_aliases
WHEN NOT EXISTS(
  SELECT 1 FROM countries WHERE NEW.entity_kind='country' AND id=NEW.entity_id
  UNION ALL SELECT 1 FROM banks WHERE NEW.entity_kind='bank' AND id=NEW.entity_id
  UNION ALL SELECT 1 FROM diplomatic_missions WHERE NEW.entity_kind='mission' AND id=NEW.entity_id)
BEGIN SELECT RAISE(ABORT,'alias points at no such entity'); END;
