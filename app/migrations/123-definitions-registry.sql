-- 123: سجل التعريفات وحقول المالك المخصّصة — «لا شيء مما يخص العمل مكتوب في الكود» على منصة شاشاتها مكتوبة باليد.
--
-- الشكل: سجل «طبقة فوق الكود» لا مُصيِّر عام. الشاشات الـ130 تبقى كما هي، والكود هو الافتراضي (النسخة 0 = لا طبقة).
-- السجل يحفظ ما غيّره إنسان وحده: وثيقة JSON واحدة لا تُعدَّل لكل كيان ولكل نسخة — النمط نفسه الذي تعمل به المنصة
-- مرتين أصلًا: صفوف services (app/workflow.mjs createService: حقول + سياسة اعتماد، نسخة n+1، لا تُحرَّر)
-- وform_definitions (app/forms.mjs draftDefinition/acceptDefinition). جداول الموجّه العشرة (entities, fields, layouts,
-- views, statuses, transitions, forms, translations, menus, sequences) صارت أقسام تلك الوثيقة الواحدة، لسببين:
--   (1) حقل يوضع في الترويسة ويُلزَم عند «الإصدار» ويُعرض عمودًا يجب أن يسري ويُسترجع دفعةً واحدة، لا على ثلاثة جداول.
--   (2) لهذا العمل رقم ترحيل واحد. كل ما قد يتطور يعيش في JSON بنسخة (spec_format)، لا في DDL.
--
-- ما ليس هنا عمدًا:
--   * لا بذرة. النسخة 0 هي افتراضات الكود، فلا صف هنا يعلو لائحة العمل 351743 ولا يسبقها. والحقول النظامية القائمة
--     لا تُخزَّن صفوفًا: كل وحدة مشاركة تسجّل واصفًا في الكود ويعكسه الخادم في المحرّر is_system:true، فلا قاموس ثانٍ ينحرف.
--   * لا جدول print_templates: لا شيء يُطبع في هذه المنصة (قرار المالك 20 سبتمبر).
--   * لا جداول menus ولا sequences ولا automations: القائمة مشتقة من التصاريح، وأرقام السجلات تمسّ قيود التفرّد وسلسلة
--     الفاتورة الإلكترونية، والأتمتة التي تعتمد أو تدفع تكسر «الخادم هو الحَكَم» و«المُعدّ غير المعتمِد».
--   * لا صفوف تصاريح: التصاريح كود في app/access.mjs.
--   * لا فهرس على مسارات JSON: القوائم محدودة بـ300 صف. فهرس على عمود مولَّد يحتاج رقم ترحيل آخر.
--   * لا رقم هوية ولا إقامة ولا جواز: يُرفض الحقل عند تعريفه والقيمة عند إدخالها (app/definitions.mjs وapp/custom-fields.mjs).
--
-- لا جدول قائم يُعاد بناؤه: لا يتغير عمود موجود، فـADD COLUMN تكفي ولا حاجة إلى RENAME → CREATE → INSERT SELECT → DROP.

-- ───── (1) قيم الحقول المخصّصة على جداول الكيانات الثلاثة الأولى ─────
-- عمود على الصف نفسه لا جدول جانبي: client_quotations_versioned (108) وopportunities_versioned (074) يفرضان version+1 على
-- كل UPDATE ويجمّدان الصف المقفل، فترث القيم المخصّصة القفل المتفائل والنهائية بلا زناد جديد. والثمن معروف ومحروس:
-- {...row} يحمل العمود الخام، فتكتب customFields.project() فوقه وتُنشر بعد الصف، ويزرع tests/definitions-leak.test.mjs
-- قيمة كناري في حقل محجوب ويؤكد غيابها عن كل مخرج.
ALTER TABLE clients ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields) AND json_type(custom_fields)='object');
ALTER TABLE opportunities ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields) AND json_type(custom_fields)='object');
ALTER TABLE client_quotations ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(custom_fields) AND json_type(custom_fields)='object');

-- ───── (2) نسخ التعريف: إلحاقية، والساري = أعلى نسخة ─────
-- لا عمود حالة يُقلَب ولا مؤشر يُنقل: «منشور» هو MAX(version)، و«حلّت محله نسخة أحدث» كل ما دونه، وكلاهما مشتق عند القراءة.
-- الاسترجاع نسخة جديدة تساوي وثيقتُها وثيقةَ نسخة أقدم (origin='rollback')، فيبقى التاريخ خطًّا واحدًا.
CREATE TABLE definition_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_key TEXT NOT NULL CHECK(entity_key GLOB '[a-z]*' AND entity_key NOT GLOB '*[^a-z_]*' AND length(entity_key) BETWEEN 3 AND 40),
  version INTEGER NOT NULL CHECK(version>=1),
  spec_format INTEGER NOT NULL DEFAULT 1 CHECK(spec_format>=1),
  spec TEXT NOT NULL CHECK(json_valid(spec) AND json_type(spec)='object'),
  -- بصمة الصف: الكيان والنسخة وبصمة سابقتها والوثيقة. سلسلة لكل كيان، يكسرها أي صف دُسّ أو بُدّل.
  digest TEXT NOT NULL CHECK(length(digest)=64),
  previous_digest TEXT NOT NULL DEFAULT '' CHECK(previous_digest='' OR length(previous_digest)=64),
  -- الخادم هو من يصنّف الفرق، لا من أعدّه: إضافة، أو تشديد، أو تخفيف.
  change_class TEXT NOT NULL CHECK(change_class IN ('additive','tightening','loosening')),
  change_summary TEXT NOT NULL CHECK(json_valid(change_summary)),
  origin TEXT NOT NULL CHECK(origin IN ('editor','rollback','import')),
  origin_ref TEXT,
  prepared_by TEXT NOT NULL,
  published_by TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=5),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,entity_key,version),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(published_by,tenant_id) REFERENCES users(id,tenant_id),
  -- الضابط يُشدَّد بشخص واحد ولا يُخفَّف بشخص واحد: القيد على الصف نفسه، فلا تتجاوزه وحدة ولا نص برمجي.
  CHECK(change_class<>'loosening' OR prepared_by<>published_by),
  CHECK((origin='editor')=(origin_ref IS NULL))
) STRICT;
CREATE INDEX definition_versions_live ON definition_versions(tenant_id,entity_key,version DESC);
CREATE TRIGGER definition_versions_fixed BEFORE UPDATE ON definition_versions
BEGIN SELECT RAISE(ABORT,'a published definition is not rewritten; a change is a new version'); END;
CREATE TRIGGER definition_versions_no_delete BEFORE DELETE ON definition_versions
BEGIN SELECT RAISE(ABORT,'published definitions are retained; roll back by publishing a new version'); END;
CREATE TRIGGER definition_versions_consecutive BEFORE INSERT ON definition_versions
WHEN NEW.version<>coalesce((SELECT MAX(version) FROM definition_versions WHERE tenant_id=NEW.tenant_id AND entity_key=NEW.entity_key),0)+1
BEGIN SELECT RAISE(ABORT,'definition versions are consecutive: the next version is the live one plus one'); END;
CREATE TRIGGER definition_versions_chained BEFORE INSERT ON definition_versions
WHEN NEW.previous_digest<>coalesce((SELECT digest FROM definition_versions WHERE tenant_id=NEW.tenant_id AND entity_key=NEW.entity_key AND version=NEW.version-1),'')
BEGIN SELECT RAISE(ABORT,'the definition chain is broken: previous_digest is not the digest of the version before'); END;

-- ───── (3) المسودة: ورقة عمل واحدة لكل كيان، تُمحى عند النشر أو التخلي ─────
-- المسودة ليست سجلًا: لا يفرضها الخادم على أحد، ولا يراها في المعاينة إلا معدّها. قفل متفائل بـrow_version،
-- وbase_version تقول على أي نسخة منشورة بُنيت، فمسودة بُنيت على نسخة لم تعد السارية تُرفض عند النشر.
-- origin/origin_ref: استرجاعٌ يخفّف ضابطًا لا ينشره شخص واحد، فينتظر ناشرًا ثانيًا هنا ويبقى مصدره «استرجاع» لا «محرّر».
CREATE TABLE definition_drafts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_key TEXT NOT NULL CHECK(entity_key GLOB '[a-z]*' AND entity_key NOT GLOB '*[^a-z_]*' AND length(entity_key) BETWEEN 3 AND 40),
  base_version INTEGER NOT NULL CHECK(base_version>=0),
  spec TEXT NOT NULL CHECK(json_valid(spec) AND json_type(spec)='object'),
  origin TEXT NOT NULL DEFAULT 'editor' CHECK(origin IN ('editor','rollback')),
  origin_ref TEXT,
  prepared_by TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
  -- NULL حتى تُسلَّم إلى ناشر ثانٍ. تعديل المسودة بعد تسليمها يعيدها NULL: الناشر ينشر ما رآه لا ما تغيّر بعده.
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,entity_key),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((origin='editor')=(origin_ref IS NULL))
) STRICT;
CREATE TRIGGER definition_drafts_versioned BEFORE UPDATE ON definition_drafts
WHEN NEW.row_version<>OLD.row_version+1 OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id OR NEW.entity_key<>OLD.entity_key
BEGIN SELECT RAISE(ABORT,'stale definition draft, or its preparer or entity was changed'); END;
-- الحذف مسموح (نشر أو تخلٍّ)، والتخلي حدث في سلسلة التدقيق.

-- ───── (4) الاستيراد: فحص أولًا، وتطبيق لاحقًا ─────
-- الفحص يحفظ الحزمة وتقرير الفرق وبصمات الساري على هذه البيئة لحظة الفحص. التطبيق يعيد التحقق من تلك البصمات، فإن
-- تغيّر الساري بين الفحص والتطبيق رُفض التطبيق وأُعيد الفحص: لا يُطبَّق فرق لم يُعرض.
CREATE TABLE definition_imports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_label TEXT NOT NULL DEFAULT '',
  bundle TEXT NOT NULL CHECK(json_valid(bundle) AND json_type(bundle)='object'),
  bundle_digest TEXT NOT NULL CHECK(length(bundle_digest)=64),
  diff TEXT NOT NULL CHECK(json_valid(diff)),
  target_digests TEXT NOT NULL CHECK(json_valid(target_digests) AND json_type(target_digests)='object'),
  worst_class TEXT NOT NULL CHECK(worst_class IN ('additive','tightening','loosening')),
  status TEXT NOT NULL CHECK(status IN ('checked','applied','abandoned')),
  checked_by TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  applied_by TEXT,
  applied_at TEXT,
  FOREIGN KEY(checked_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(applied_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='applied')=(applied_by IS NOT NULL)),
  CHECK((applied_by IS NULL)=(applied_at IS NULL)),
  -- حزمة تخفّف ضابطًا لا يطبّقها من فحصها.
  CHECK(worst_class<>'loosening' OR applied_by IS NULL OR applied_by<>checked_by)
) STRICT;
CREATE INDEX definition_imports_recent ON definition_imports(tenant_id,checked_at DESC);
-- اتجاه واحد ومرة واحدة: «فُحص» يصير «طُبِّق» أو «تُرك»، ولا يعود. والحزمة وتقريرها ومن فحصها لا تُمسّ.
CREATE TRIGGER definition_imports_frozen BEFORE UPDATE ON definition_imports
WHEN OLD.status<>'checked' OR NEW.bundle<>OLD.bundle OR NEW.bundle_digest<>OLD.bundle_digest OR NEW.diff<>OLD.diff
  OR NEW.target_digests<>OLD.target_digests OR NEW.worst_class<>OLD.worst_class OR NEW.source_label<>OLD.source_label
  OR NEW.checked_by<>OLD.checked_by OR NEW.checked_at<>OLD.checked_at OR NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id
BEGIN SELECT RAISE(ABORT,'an import check is fixed; it is applied or abandoned once'); END;
CREATE TRIGGER definition_imports_no_delete BEFORE DELETE ON definition_imports
BEGIN SELECT RAISE(ABORT,'import checks are retained'); END;

-- ───── (5) سجل «جرّب كمستخدم»: إلحاقي ─────
-- خفضُ تصاريح بهوية صاحبها، لا انتحال زميل: actor_id هو الشخص الحقيقي دائمًا. session_ref بصمة مشتقة
-- (sha256 لـ'view-as:'+token_hash) لا بصمة الجلسة نفسها، فلا يصير هذا الجدول طريقًا إلى جلسة أحد. جدول sessions لا يُمسّ.
-- الجلسة نشطة حين يكون آخر صف started/ended/expired لها هو started وعمره دون ثلاثين دقيقة؛ الحساب في app/view-as.mjs.
CREATE TABLE view_as_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT NOT NULL,
  session_ref TEXT NOT NULL CHECK(length(session_ref)=64),
  event TEXT NOT NULL CHECK(event IN ('started','screen','ended','expired')),
  persona TEXT NOT NULL CHECK(persona IN ('employee','manager','pm','hr')),
  -- لحدث screen: عائلة المسار (/api/pricing مثلًا). صف واحد لكل عائلة في الجلسة، لا صف لكل طلب.
  detail TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(event<>'started' OR length(trim(reason))>=10),
  CHECK(event<>'screen' OR length(detail)>0)
) STRICT;
CREATE INDEX view_as_events_session ON view_as_events(session_ref,seq DESC);
CREATE UNIQUE INDEX view_as_events_one_screen ON view_as_events(session_ref,detail) WHERE event='screen';
CREATE TRIGGER view_as_events_fixed BEFORE UPDATE ON view_as_events
BEGIN SELECT RAISE(ABORT,'the view-as record is not rewritten'); END;
CREATE TRIGGER view_as_events_no_delete BEFORE DELETE ON view_as_events
BEGIN SELECT RAISE(ABORT,'the view-as record is retained'); END;
