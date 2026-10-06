// دليل البيانات المرجعية: دول · بنوك · بعثات دبلوماسية. (الترحيل 157)
//
// ما يفعله هذا الملف: قراءة الدليل والبحث فيه بالعربي والإنجليزي، وتسجيل صف وصل من مصدر موثوق، وإقرار
// المطابقة باسم إنسان، ومراجعة ما يخالف المسجَّل قبل أن يُكتب فوقه. وما لا يفعله: لا يبذر صفًا من ذاكرة
// أحد، ولا يحمل للكيان حالة تشغيلية.
//
// ‏**قيدان من المالك يحرسهما هذا الملف لا يشرحهما فقط:**
// (1) «Do not invent, guess, or manually substitute unverified institutions» — فكل كتابة تمرّ من
//     recordEntity، وهي ترفض صفًا بلا سلطة مصدر مكتوبة. الدليل يخرج من الترحيل فارغًا ويبقى فارغًا حتى
//     يصل مصدر. والفراغ يُقرأ في الشاشة جملةً تقول ما ينتظره الدليل ومن يملكه، لا «لا نتائج».
// (2) الدليل لا يعرض ولا يخزّن ولا يصنّف هل بدأ البنك نشاطه أو لم يبدأ. فلا عمود في الترحيل، ولا حقل
//     يُقبل هنا: rejectStatusKeys ترفض المفتاح في المُدخَل رفضًا مسموعًا. تجاهلُه بصمت كان سيجعل
//     كاتب الاستدعاء يظن أنه سجّل حالةً وهي لم تُسجَّل، وذلك أسوأ من الرفض.
//     ‏**وحارس المفاتيح وحده لا يكفي، وهذا ما كشفته قراءة ساما في 30 سبتمبر 2026:** المصدر الرسمي نفسه
//     ينشر الحالة داخل **قيمة** لا في اسم حقل — حقل نشاطه يقول لثلاثة بنوك إن النشاط لم يبدأ. فقيمةٌ
//     كهذه تمرّ من حارس المفاتيح كاملةً وتُطبع على الشاشة. ولهذا rejectStatusValues تفحص ما يُكتب لا
//     أسماءه، والقاعدة تحرس الشيء نفسه بقيود CHECK وقوادح في الترحيل 159. والبنك لا يُحذف بسبب هذه
//     العبارة: ترخيصه حقيقة المصدر، والممنوع نقل الحالة معه — فالحقل الحامل لها يُترك ولا يُنقل.
// (3) نطاق البعثات محسوم بقرار المالك (30 سبتمبر 2026): «واقصد السفارات الي عندنا» — البعثات المعتمدة
//     لدى المملكة، لا بعثات المملكة في الخارج. والنطاق مثبَّت في البنية لا في هذا التعليق: عمود
//     accreditation بقيمة واحدة، وقادح يرفض بعثةً دولتُها المُرسِلة هي المملكة (الترحيل 159).
//
// التطبيع: يُستعمل app/arabic-text.mjs كما هو — هو الذي يوحّد في المنصة صور الألف والتاء المربوطة والهمزات
// والتشكيل والتطويل والأرقام الهندية. **القيمة المخزَّنة لا تتغير أبدًا**: التطبيع نسخةٌ تُبنى وقت البحث
// وتُرمى بعده، فيقرأ الموظف الاسم كما كتبته الجهة التي تملكه.
// ولماذا يُصفّى في JS لا في SQL: الدليل بيانات مرجعية محدودة (مئات الصفوف: ~250 دولة، عشرات البنوك، ~150
// بعثة)، فالمسح عليها أرخص من عمودٍ مطبَّع مخزَّن — وذلك العمود يسكت ويتقادم أول مرة يُكتب صفٌّ بـSQL
// مباشرة من ترحيل أو سكربت، فيصير البحث لا يجد ما هو موجود ولا أحد يعرف لماذا.
import { readFileSync } from 'node:fs';
import { normalize, tokens, stem, withinDistance } from './arabic-text.mjs';
import { audit, now, transaction } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';

export const ENTITY_KINDS = ['country', 'bank', 'mission'];

// نطاق البعثات كما حسمه المالك: المعتمدة لدى المملكة. القيمة مفتاح القاعدة، والجملة ما يُكتب في الشاشة
// فوق القائمة — فيعرف القارئ قبل أن يبحث أن سفارات المملكة في الخارج ليست هنا، ولا يظن القائمة ناقصة.
export const MISSION_ACCREDITATION = 'accredited_to_kingdom';
export const MISSION_SCOPE_AR = 'السفارات والقنصليات المعتمدة لدى المملكة';
// رمز المملكة في ISO: هو ما يُفحص عليه النطاق، لأن الاسم يُكتب بصور كثيرة والرمز واحد.
const KINGDOM_ISO2 = 'SA';

// أنواع البعثات: المفتاح لاتيني ثابت في القاعدة، والاسم المعروض عربي كما يقولها الناس.
export const MISSION_TYPES = {
  embassy: 'سفارة',
  consulate_general: 'قنصلية عامة',
  consulate: 'قنصلية',
  permanent_mission: 'بعثة دائمة',
  interests_section: 'قسم رعاية مصالح',
  other: 'تمثيل آخر',
};

export const ALIAS_KINDS = {
  former_name: 'اسم سابق',
  abbreviation: 'اختصار',
  trade_name: 'اسم تجاري',
  transliteration: 'نقل حرفي',
  common_name: 'الاسم الشائع',
};

// المفاتيح التي لا يقبلها الدليل، بأي لغة: قيد المالك مفروض عند المدخل لا موصوفًا في تعليق.
const BANNED_RAW = ['active', 'inactive', 'operational', 'operating', 'operations', 'started',
  'startedoperations', 'status', 'state', 'live', 'islive', 'suspended', 'ceased', 'defunct', 'closed',
  'launch', 'launched', 'commenced', 'نشط', 'غير نشط', 'الحالة', 'حالة التشغيل', 'بدأ النشاط', 'لم يبدأ'];

const flat = key => normalize(key).replace(/[^\p{L}\p{N}]+/gu, '');
// القائمة تُطبَّع مرة واحدة كما يُطبَّع المفتاح المفحوص. بلا هذا تُقارن «الحالة» بالتاء المربوطة بمفتاحٍ
// طُبِّع إلى «الحاله» بالهاء فلا يتطابقان أبدًا، ويمرّ ما مُنع.
const BANNED = new Set(BANNED_RAW.map(flat));
export const bannedStatusKeys = () => [...BANNED];

// المفتاح يُفحص كلمةً كلمة لا حرفًا حرفًا. الحدّ عند حدود الكلمة: «isActive» تُفَكّ إلى is+active فتُمسك،
// و«bank_statement» تُفَكّ إلى bank+statement فلا تُمسك بحجة أن «state» بدايةُ «statement» — والفحص
// بالاحتواء وحده كان سيرفض حقلًا مشروعًا يومًا ويصير الحارس عائقًا يُلتف عليه.
const keyWords = key => normalize(String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isBannedKey = key => BANNED.has(flat(key)) || keyWords(key).some(word => BANNED.has(word));

function rejectStatusKeys(values, where) {
  for (const key of Object.keys(values ?? {})) {
    if (!isBannedKey(key)) continue;
    refuse(422, 'master_data_no_operational_status', {
      what: `الدليل ما يسجّل حالة تشغيلية للكيان، والحقل «${key}» في ${where} حالة تشغيلية`,
      next: 'احذف الحقل من الطلب. الدليل يقول من المؤسسة ومن يشهد عليها، ولا يقول هل بدأت نشاطها أو ما بدأت',
    });
  }
}

// العبارات الممنوعة داخل القيم. ليست كلمات مفردة مثل «نشط» لأن الكلمة المفردة تقع في أسماء مشروعة يومًا،
// والحارس الذي يرفض اسمًا صحيحًا يُلتَفّ عليه ويموت. هذه جُمَل تقول حالة التشغيل ولا تقولها إلا هي.
// ‏**والقائمة نفسها مكتوبة في قيود CHECK وقوادح الترحيل 159**، ويحرس تطابقهما اختبارٌ يقرأ ملف الترحيل
// ويطلب كل عبارة منها فيه: حارسان بقائمتين تفترقان أسوأ من حارس واحد، لأن أحدهما يُطمئن والآخر يمرّر.
export const OPERATIONAL_STATUS_PHRASES = Object.freeze([
  'بدأ النشاط', 'لم يباشر', 'متوقف عن',
  'not yet operational', 'not operational', 'ceased operation', 'commenced operation', 'under liquidation',
]);

// يعيد العبارة التي وُجدت، أو '' — فالمتصل يقدر يقولها في رسالته بدل «فيه شي ممنوع».
export function operationalStatusIn(value) {
  const haystack = normalize(String(value ?? '')).toLowerCase();
  return OPERATIONAL_STATUS_PHRASES.find(phrase => haystack.includes(normalize(phrase).toLowerCase())) ?? '';
}

function rejectStatusValues(values, where) {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value !== 'string') continue;
    const phrase = operationalStatusIn(value);
    if (!phrase) continue;
    refuse(422, 'master_data_no_operational_status', {
      what: `القيمة المكتوبة في «${key}» ضمن ${where} تقول حالة تشغيلية («${phrase}»)، والدليل ما ينقل هذا`,
      next: 'شِل العبارة من القيمة وسجّل المؤسسة كما هي. لو كانت جاية من المصدر نفسه، اترك الحقل الحامل لها ولا تنقله — المؤسسة تُسجَّل، والحالة ما تُنقل معها',
    });
  }
}

const text = value => (typeof value === 'string' ? value.trim() : '');

// ── القراءة ────────────────────────────────────────────────────────────────────
const COUNTRY_COLUMNS = 'id,iso2,iso3,iso_numeric,name_ar,name_en,source_authority,source_url,verified_by,verified_at,verification,created_at';
const BANK_COLUMNS = 'id,name_ar,name_en,short_name,country_id,licence_number,licence_authority,unified_number,commercial_registration,source_category,bic,source_authority,source_url,verified_by,verified_at,verification,created_at';
const MISSION_COLUMNS = 'id,country_id,mission_type,accreditation,city_ar,city_en,name_ar,name_en,source_authority,source_url,verified_by,verified_at,verification,created_at';

const TABLES = {
  country: { table: 'countries', columns: COUNTRY_COLUMNS, label: 'دولة' },
  bank: { table: 'banks', columns: BANK_COLUMNS, label: 'بنك' },
  // الاسم يقول النطاق: الدليل للبعثات المعتمدة لدى المملكة وحدها، فلا يُقرأ العنوان على أنه يشمل
  // سفارات المملكة في الخارج ثم يُظنّ ناقصًا.
  mission: { table: 'diplomatic_missions', columns: MISSION_COLUMNS, label: 'بعثة معتمدة لدى المملكة' },
};

function tableFor(kind) {
  const found = TABLES[kind];
  if (!found) throw new TypeError(`master-data: نوع غير معروف «${kind}» — النوع واحد من ${ENTITY_KINDS.join('، ')}`);
  return found;
}

export const listCountries = db => db.prepare(`SELECT ${COUNTRY_COLUMNS} FROM countries ORDER BY name_ar`).all();
export const listBanks = db => db.prepare(`SELECT ${BANK_COLUMNS} FROM banks ORDER BY name_ar`).all();
export const listMissions = db => db.prepare(`SELECT ${MISSION_COLUMNS} FROM diplomatic_missions ORDER BY city_ar, name_ar`).all();

export const listEntities = (db, kind) => {
  const { table, columns } = tableFor(kind);
  return db.prepare(`SELECT ${columns} FROM ${table} ORDER BY name_ar`).all();
};
export const entity = (db, kind, id) => {
  const { table, columns } = tableFor(kind);
  return db.prepare(`SELECT ${columns} FROM ${table} WHERE id=?`).get(id) ?? null;
};
export const country = (db, id) => entity(db, 'country', id);
export const bank = (db, id) => entity(db, 'bank', id);
export const mission = (db, id) => entity(db, 'mission', id);

export const aliasesFor = (db, kind, id) => {
  tableFor(kind);
  return db.prepare('SELECT seq,alias,alias_kind,source_authority,source_url,note,created_at FROM master_data_aliases WHERE entity_kind=? AND entity_id=? ORDER BY seq').all(kind, id);
};

// تاريخ الصف: صور ما كان، أحدثها أولًا. يُقرأ منه رقم الترخيص الذي كان مسجَّلًا يوم صُرف راتب.
export const revisionsFor = (db, kind, id) => {
  tableFor(kind);
  return db.prepare('SELECT seq,before_json,changed_at FROM master_data_revisions WHERE entity_kind=? AND entity_id=? ORDER BY seq DESC').all(kind, id)
    .map(row => ({ seq: row.seq, changed_at: row.changed_at, before: JSON.parse(row.before_json) }));
};

// سطر المصدر الذي يُقرأ في الشاشة: الجهة ومتى طُوبِق الصف عليها. ولا أسماء فاعلين في متن السطر — من
// اقترح ومن نفّذ يبقى في سجل التدقيق كما هو، لا في ما يقرؤه الموظف.
export function sourceLine(row) {
  if (!row) return '';
  const authority = text(row.source_authority) || 'بلا مصدر مسجَّل';
  return row.verification === 'verified' && row.verified_at
    ? `المصدر: ${authority} — مطابَق في ${String(row.verified_at).slice(0, 10)}`
    : `المصدر: ${authority} — ما زال غير مطابَق على المصدر`;
}

// مكان الأصول (الشعارات) — مُصمَّم وموثَّق ولا يُنزَّل منه شيء.
// شعار البنك علامة تجارية مملوكة لصاحبها، وتنزيلُها قرارُ المالك لا قرار وكيل. فالدليل يعرف **أين** يجلس
// الأصل إن وصل، ويعيد null حين لا يوجد، فترسم الشاشة الحرفين الأولين من الاسم مكانه. لا شبكة ولا ملف.
export const ASSET_ROOT = 'app/static/master-data';
export function logoAssetPath(kind, id) {
  tableFor(kind);
  if (!/^[a-z][a-z0-9_]*$/.test(String(id ?? ''))) return null;
  return `${ASSET_ROOT}/${kind}/${id}.svg`;
}

// ── البحث ──────────────────────────────────────────────────────────────────────
// خمس طرق مرتَّبة، لأن المطابقة الحرفية وحدها تسقط على فروق لا يقصدها من يبحث:
//   exact     الصورة المطبّعة نفسها.
//   prefix    بداية الاسم — من كتب حرفين يريد ما يبدأ بهما قبل ما يحتويهما.
//   substring داخل الاسم: «راجحي» داخل «مصرف الراجحي»، و«الراجحي» كذلك.
//   compact   الصورة بلا مسافات: «ALRAJHI» ← alrajhi داخل alrajhibank من «Al Rajhi Bank».
//             بلا هذه الطريقة لا يجد من كتب الاختصار ملتصقًا شيئًا، وهكذا يكتبه الناس فعلًا.
//   stem      الجذر الخفيف من arabic-text: «راجحي» و«الراجحي» جذرهما واحد، وكذلك صور الجمع والإضافة.
//   fuzzy     مسافة تحرير 1 على الكلمة الواحدة: خطأ الكتابة الصغير وحده، لا التقارب البعيد.
const RANK = { exact: 100, prefix: 80, substring: 60, compact: 50, stem: 40, fuzzy: 20 };
const FUZZY_MIN = 4;

const compactOf = value => normalize(value).replace(/[^\p{L}\p{N}]+/gu, '');

// الحقول التي يُبحث فيها لكل نوع، ومعها اسمٌ عربي يُقال للمستخدم «طابقت في…».
const SEARCHABLE = {
  country: [['name_ar', 'الاسم العربي'], ['name_en', 'الاسم الإنجليزي'], ['iso2', 'رمز ISO'], ['iso3', 'رمز ISO'], ['iso_numeric', 'رمز ISO الرقمي']],
  // الرقم الموحد والسجل التجاري يُبحث بهما: الموظف الذي يمسك ورقة من البنك يقرأ فيها رقمًا، ويكتبه
  // كما هو. ومن يكتب رقمًا ولا يجد شيئًا يظن البنك غير مسجَّل.
  bank: [['name_ar', 'الاسم العربي'], ['name_en', 'الاسم الإنجليزي'], ['short_name', 'الاختصار'], ['bic', 'رمز BIC'],
    ['licence_number', 'رقم الترخيص'], ['unified_number', 'الرقم الموحد'], ['commercial_registration', 'رقم السجل التجاري']],
  mission: [['name_ar', 'الاسم العربي'], ['name_en', 'الاسم الإنجليزي'], ['city_ar', 'المدينة'], ['city_en', 'المدينة']],
};

function scoreValue(query, value) {
  const wanted = normalize(query);
  const target = normalize(value);
  if (!wanted || !target) return null;
  if (target === wanted) return 'exact';
  if (target.startsWith(wanted)) return 'prefix';
  if (target.includes(wanted)) return 'substring';
  const compactTarget = compactOf(value);
  const compactWanted = compactOf(query);
  if (compactWanted && compactTarget.includes(compactWanted)) return 'compact';
  // الجذر: كل كلمة في الاستعلام تجد كلمة في الهدف يشاركها الجذر.
  const wantedStems = tokens(query).map(stem).filter(Boolean);
  const targetStems = tokens(value).map(stem).filter(Boolean);
  if (wantedStems.length && wantedStems.every(s => targetStems.some(t => t === s || t.startsWith(s) || s.startsWith(t)))) return 'stem';
  if (compactWanted.length >= FUZZY_MIN && targetStems.some(t => withinDistance(t, compactWanted, 1) >= 0)) return 'fuzzy';
  return null;
}

// البحث في الدليل. يعيد صفوفًا مرتَّبة بقوة المطابقة، وكل صف يقول في أي حقل طابق — فمن بحث بالاسم القديم
// يرى «طابقت في: اسم سابق» ويعرف لماذا ظهر له هذا الصف، بدل أن يشكّ في النتيجة.
export function searchMasterData(db, query, { kinds = ENTITY_KINDS, limit = 25 } = {}) {
  const wanted = normalize(query);
  if (!wanted) return [];
  const results = [];
  for (const kind of kinds) {
    tableFor(kind);
    const aliasRows = db.prepare('SELECT entity_id,alias,alias_kind FROM master_data_aliases WHERE entity_kind=?').all(kind);
    const aliasesById = new Map();
    for (const row of aliasRows) {
      if (!aliasesById.has(row.entity_id)) aliasesById.set(row.entity_id, []);
      aliasesById.get(row.entity_id).push(row);
    }
    for (const row of listEntities(db, kind)) {
      let best = null;
      for (const [field, fieldLabel] of SEARCHABLE[kind]) {
        const how = scoreValue(query, row[field]);
        if (how && (!best || RANK[how] > RANK[best.how])) best = { how, matched_on: fieldLabel, matched_value: row[field] };
      }
      // الأسماء البديلة: المرجع التاريخي يصل إلى الصف القائم. الاسم السابق يُطابَق كما يُطابَق الحالي،
      // ويُقال للمستخدم إنه اسم سابق — فلا يظن أن المؤسسة ما زالت تُسمّى به.
      for (const alias of aliasesById.get(row.id) ?? []) {
        const how = scoreValue(query, alias.alias);
        if (how && (!best || RANK[how] > RANK[best.how])) {
          best = { how, matched_on: ALIAS_KINDS[alias.alias_kind] ?? 'اسم بديل', matched_value: alias.alias };
        }
      }
      if (best) results.push({ kind, ...row, ...best, rank: RANK[best.how], source_line: sourceLine(row) });
    }
  }
  return results
    .sort((a, b) => b.rank - a.rank || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'))
    .slice(0, Math.max(1, limit));
}

// ── الكتابة: لا صف بلا مصدر ────────────────────────────────────────────────────
const REQUIRED = {
  country: ['id', 'iso2', 'iso3', 'name_ar', 'name_en', 'source_authority'],
  // ‏**country_id ليست مطلوبة للبنك**: قائمة ساما المرخَّصة لا تنشر موطن البنك، واستنباطه من اسمه
  // («بنك الكويت الوطني ← الكويت») تخمينٌ منعه المالك. وحقلٌ إلزامي لا ينشره المصدر لا يمنع الخطأ،
  // يفرضه: يُجبر المستورد على اختراع قيمة قبل أن يُسجَّل بنك واحد.
  bank: ['id', 'name_ar', 'name_en', 'source_authority'],
  mission: ['id', 'country_id', 'mission_type', 'city_ar', 'city_en', 'name_ar', 'name_en', 'source_authority'],
};
const ALLOWED = {
  country: [...REQUIRED.country, 'iso_numeric', 'source_url'],
  bank: [...REQUIRED.bank, 'country_id', 'short_name', 'licence_number', 'licence_authority',
    'unified_number', 'commercial_registration', 'source_category', 'bic', 'source_url'],
  mission: [...REQUIRED.mission, 'source_url'],
};

// نطاق البعثات يُفحص هنا قبل أن تفحصه القاعدة: رسالة القادح إنجليزية مكتوبة لمن يقرأ سجل الأخطاء،
// وهذه تُقرأ في الشاشة وتقول للمستخدم أيّ دليلٍ يقصد. والقاعدة تبقى الأرضية لا الواجهة — قادح الترحيل
// 159 يرفض الصف ولو كُتب من سكربت لا يمرّ من هنا.
function rejectOutOfScopeMission(db, values, where) {
  if (values?.accreditation !== undefined) {
    refuse(422, 'master_data_mission_scope', {
      what: `الدليل كله للبعثات المعتمدة لدى المملكة، وما فيه حقل يختار النوع في ${where}`,
      next: 'شِل حقل accreditation من الطلب. ولو المقصود سفارات المملكة في الخارج، فذاك دليل ثاني وقراره قرار المالك',
    });
  }
  const senderId = text(values?.country_id);
  const sender = senderId ? country(db, senderId) : null;
  if (sender?.iso2 === KINGDOM_ISO2) {
    refuse(422, 'master_data_mission_scope', {
      what: `الدولة المُرسِلة هنا هي المملكة، والدليل هذا لـ${MISSION_SCOPE_AR}`,
      next: 'لو تقصد سفارة دولة أجنبية عندنا، حطّ الدولة المُرسِلة (سفارة اليابان ← اليابان). ولو تقصد سفارة للمملكة في الخارج، فذاك دليل ثاني ما هو مبني، وقراره قرار المالك',
    });
  }
}

// تسجيل صف وصل من مصدر. الصف يُكتب **غير مطابَق** دائمًا: هذه الدالة تنقل ما قاله المصدر، ولا تشهد عليه.
// الشهادة فعلٌ ثانٍ باسم إنسان (attestVerification)، فلا يصير صفٌّ «مطابَقًا» بمجرد أن أدخله سكربت.
export function recordEntity(db, actorSupplied, kind, values = {}) {
  const actor = actorOrRefuse(db, actorSupplied);
  const { table, label } = tableFor(kind);
  rejectStatusKeys(values, `تسجيل ${label}`);
  rejectStatusValues(values, `تسجيل ${label}`);
  if (kind === 'mission') rejectOutOfScopeMission(db, values, `تسجيل ${label}`);

  const unknown = Object.keys(values).filter(key => !ALLOWED[kind].includes(key));
  if (unknown.length) {
    refuse(422, 'master_data_unknown_field', {
      what: `حقول ما يعرفها الدليل في تسجيل ${label}: ${unknown.join('، ')}`,
      next: `الحقول المقبولة: ${ALLOWED[kind].join('، ')}`,
    });
  }
  const missing = REQUIRED[kind].filter(key => !text(values[key]));
  if (missing.length) {
    refuse(422, 'master_data_source_required', {
      what: `ما يُسجَّل ${label} بلا هذه الحقول`,
      missing: missing.map(key => ({
        document: key === 'source_authority' ? 'سلطة المصدر — الجهة التي تقول هذا' : `الحقل «${key}»`,
        why: key === 'source_authority'
          ? 'صفٌّ بلا جهة قالته ما يُراجع ولا يُصحَّح، ويصير بعد شهر رقمًا ما يعرف أحد من أين جاء'
          : 'حقل مطلوب في هذا النوع',
        owner: 'مسؤول البيانات المرجعية',
        owner_role: 'admin',
      })),
      next: 'كمّل الحقول من المصدر الرسمي نفسه. وإن ما وصلك المصدر، خلّ الصف ما يُسجَّل — الدليل الفاضي أصدق من صف مخترع',
    });
  }

  const row = { created_at: now(), verification: 'unverified' };
  for (const key of ALLOWED[kind]) if (values[key] !== undefined) row[key] = text(values[key]);
  const columns = Object.keys(row);
  return transaction(db, () => {
    db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
      .run(...columns.map(key => row[key]));
    audit(db, actor, `master_data.${kind}`, row.id, 'record', {}, row, `تسجيل من مصدر: ${row.source_authority}`);
    return entity(db, kind, row.id);
  });
}

// إقرار المطابقة. هذا هو الفعل الذي يرفع verification إلى 'verified'، ولا يرفعها ترحيل ولا سكربت:
// المطابقة شهادة إنسان باسمه على أن الصف يطابق ما في المصدر، وتُقرأ بعد سنة باسمه.
export function attestVerification(db, actorSupplied, kind, id, { source_url = '' } = {}) {
  const actor = actorOrRefuse(db, actorSupplied);
  const { table, label } = tableFor(kind);
  const before = entity(db, kind, id);
  if (!before) {
    refuse(404, 'master_data_not_found', {
      what: `ما في ${label} بهذا المعرّف في الدليل`,
      next: 'سجّل الصف أول من مصدره، بعدها أقرّ مطابقته',
    });
  }
  if (before.verification === 'verified') {
    refuse(409, 'master_data_already_verified', {
      what: `${label} مطابَق أصلًا`,
      next: 'ما يحتاج إقرار ثاني. إن تغيّرت قيمة في المصدر، افتح مراجعة مصدر عليها',
    });
  }
  return transaction(db, () => {
    db.prepare(`UPDATE ${table} SET verification='verified', verified_by=?, verified_at=?, source_url=COALESCE(NULLIF(?,''),source_url) WHERE id=?`)
      .run(actor.id, now(), text(source_url), id);
    const after = entity(db, kind, id);
    audit(db, actor, `master_data.${kind}`, id, 'attest_verification', before, after, `مطابقة على المصدر: ${before.source_authority}`);
    return after;
  });
}

// ── مراجعة تغيّر المصدر ────────────────────────────────────────────────────────
// وصل المصدر بقيمة تخالف المسجَّل. ما يُكتب فوق صف الإنتاج هنا: يُسجَّل اقتراحًا ويقعد. والكتابة تصير
// فعلًا واحدًا لاحقًا باسم من قَبِل — لأن رقم ترخيصٍ يُصرف عليه راتب ما يتغير بتحديث آلي ما شافه أحد.
export function proposeSourceChange(db, actorSupplied, { kind, entity_id = null, proposed, source_authority, source_url = '', source_fetched_at, reason }) {
  const actor = actorOrRefuse(db, actorSupplied);
  tableFor(kind);
  rejectStatusKeys(proposed, 'المقترح');
  rejectStatusValues(proposed, 'المقترح');
  // ونطاق البعثة يُفحص في المقترح كذلك: مقترحٌ يحوّل الدولة المُرسِلة إلى المملكة يقلب البعثة إلى النوع
  // الآخر عند قبوله، فيصير الجدول خليطًا من باب المراجعة بعد أن مُنع من باب التسجيل.
  if (kind === 'mission') rejectOutOfScopeMission(db, proposed, 'المقترح');
  const gaps = [];
  if (!proposed || typeof proposed !== 'object' || !Object.keys(proposed).length) gaps.push({ document: 'القيم المقترحة', why: 'مراجعة بلا قيمة مقترحة ما فيها شي يُقرَّر', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source_authority)) gaps.push({ document: 'سلطة المصدر', why: 'من يقول هذا التغيير', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source_fetched_at)) gaps.push({ document: 'تاريخ وصول المصدر', why: 'قيمةٌ ما يُعرف متى قالها المصدر ما تُقارن بقيمة أحدث', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (text(reason).length < 4) gaps.push({ document: 'سبب المراجعة', why: 'سطر يقول لماذا، يُقرأ في الشاشة وفي سجل التدقيق', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (gaps.length) refuse(422, 'master_data_review_incomplete', { what: 'ما تُفتح مراجعة مصدر بلا هذه', missing: gaps, next: 'كمّلها من المصدر نفسه وأعد الطلب' });

  if (entity_id !== null) {
    const unknown = Object.keys(proposed).filter(key => !ALLOWED[kind].includes(key) || key === 'id');
    if (unknown.length) {
      refuse(422, 'master_data_unknown_field', {
        what: `حقول ما تُقترح على ${TABLES[kind].label} قائم: ${unknown.join('، ')}`,
        next: 'المعرّف ما يُعاد كتابته أبدًا — تغييره يقطع كل إحالة قديمة. والباقي لازم يكون من الحقول المعروفة',
      });
    }
    if (!entity(db, kind, entity_id)) {
      refuse(404, 'master_data_not_found', { what: 'ما في صف بهذا المعرّف يُراجَع', next: 'اترك entity_id فاضيًا إن كان المصدر يقترح كيانًا جديدًا' });
    }
  }

  const thread_id = `mdr_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return transaction(db, () => {
    db.prepare(`INSERT INTO master_data_source_reviews(tenant_id,thread_id,entity_kind,entity_id,state,proposed_json,source_authority,source_url,source_fetched_at,reason,actor_id,acted_at)
                VALUES(?,?,?,?,'proposed',?,?,?,?,?,?,?)`)
      .run(actor.tenant_id, thread_id, kind, entity_id, JSON.stringify(proposed), text(source_authority), text(source_url), text(source_fetched_at), text(reason), actor.id, now());
    audit(db, actor, `master_data.${kind}`, entity_id ?? thread_id, 'propose_source_change', {}, { thread_id, proposed }, text(reason));
    return reviewThread(db, thread_id);
  });
}

export function reviewThread(db, thread_id) {
  const rows = db.prepare('SELECT * FROM master_data_source_reviews WHERE thread_id=? ORDER BY seq').all(thread_id);
  if (!rows.length) return null;
  const opened = rows[0];
  const last = rows[rows.length - 1];
  return {
    thread_id,
    entity_kind: opened.entity_kind,
    entity_id: opened.entity_id,
    proposed: JSON.parse(opened.proposed_json),
    source_authority: opened.source_authority,
    source_url: opened.source_url,
    source_fetched_at: opened.source_fetched_at,
    state: last.state,
    reason: last.reason,
    decided_by: last.state === 'proposed' ? null : last.actor_id,
    decided_at: last.state === 'proposed' ? null : last.acted_at,
  };
}

// المراجعات المفتوحة: ما ينتظر قرار إنسان. الشاشة تقرأ هذه، ولا يتحرك صف إنتاج قبل قرار منها.
export function openReviews(db, tenant_id, kind = null) {
  const rows = db.prepare(`SELECT thread_id FROM master_data_source_reviews WHERE tenant_id=?${kind ? ' AND entity_kind=?' : ''} GROUP BY thread_id`)
    .all(...(kind ? [tenant_id, kind] : [tenant_id]));
  return rows.map(row => reviewThread(db, row.thread_id)).filter(thread => thread?.state === 'proposed');
}

// القرار. القبول هنا — وهنا وحده — يكتب القيم على صف الإنتاج، في المعاملة نفسها التي يُسجَّل فيها القرار:
// فلا يبقى مقترحٌ «مقبول» ما وصل الصف، ولا صفٌّ تغيّر بلا قرار مكتوب بجواره. وقادح التاريخ في الترحيل
// يحفظ صورة ما كان قبل الكتابة، فالقيمة القديمة تبقى مقروءة.
export function decideSourceChange(db, actorSupplied, { thread_id, accept, reason }) {
  const actor = actorOrRefuse(db, actorSupplied);
  const thread = reviewThread(db, thread_id);
  if (!thread) refuse(404, 'master_data_review_not_found', { what: 'ما في مراجعة بهذا الرقم', next: 'افتح قائمة المراجعات المفتوحة وخذ الرقم منها' });
  if (thread.state !== 'proposed') {
    refuse(409, 'master_data_review_decided', {
      what: `هذي المراجعة محسومة أصلًا (${thread.state === 'accepted' ? 'مقبولة' : 'مرفوضة'})`,
      next: 'إن تغيّر المصدر بعدها، افتح مراجعة جديدة يُقرأ سببها بجوار قرارها',
    });
  }
  if (text(reason).length < 4) {
    refuse(422, 'master_data_reason_required', {
      what: 'ما يُسجَّل قرار بلا سبب مكتوب',
      next: 'اكتب سطرًا يقول لماذا قبلت أو رفضت — يُقرأ بعد سنة في سجل التدقيق',
    });
  }
  const { table } = tableFor(thread.entity_kind);

  return transaction(db, () => {
    const before = thread.entity_id ? entity(db, thread.entity_kind, thread.entity_id) : null;
    db.prepare(`INSERT INTO master_data_source_reviews(tenant_id,thread_id,entity_kind,entity_id,state,proposed_json,source_authority,source_url,source_fetched_at,reason,actor_id,acted_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(actor.tenant_id, thread_id, thread.entity_kind, thread.entity_id, accept ? 'accepted' : 'rejected',
        JSON.stringify(thread.proposed), thread.source_authority, thread.source_url, thread.source_fetched_at,
        text(reason), actor.id, now());

    let after = before;
    if (accept && thread.entity_id) {
      const columns = Object.keys(thread.proposed);
      db.prepare(`UPDATE ${table} SET ${columns.map(c => `${c}=?`).join(',')} WHERE id=?`)
        .run(...columns.map(c => text(thread.proposed[c])), thread.entity_id);
      after = entity(db, thread.entity_kind, thread.entity_id);
    }
    audit(db, actor, `master_data.${thread.entity_kind}`, thread.entity_id ?? thread_id,
      accept ? 'accept_source_change' : 'reject_source_change', before ?? {}, after ?? { thread_id }, text(reason));
    return { thread: reviewThread(db, thread_id), row: after };
  });
}

// ── الأسماء البديلة ────────────────────────────────────────────────────────────
// الاسم القديم يُحفظ فما تنكسر مراجعة كُتبت به. الإضافة فعلٌ مستقل عن تصحيح الاسم، فيقدر من يصحّح أن
// يحفظ السابق في المعاملة نفسها.
export function addAlias(db, actorSupplied, kind, entity_id, { alias, alias_kind, source_authority, source_url = '', note = '' }) {
  const actor = actorOrRefuse(db, actorSupplied);
  tableFor(kind);
  const gaps = [];
  if (text(alias).length < 2) gaps.push({ document: 'الاسم البديل', why: 'حرف واحد يطابق كل شي', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!ALIAS_KINDS[alias_kind]) gaps.push({ document: 'نوع البديل', why: `واحد من: ${Object.keys(ALIAS_KINDS).join('، ')} — ومن يبحث لازم يعرف هل هذا اسم سابق ولا اختصار`, owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source_authority)) gaps.push({ document: 'سلطة المصدر', why: 'من يقول إن هذا الاسم كان لهذا الكيان', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (gaps.length) refuse(422, 'master_data_alias_incomplete', { what: 'ما يُضاف اسم بديل بلا هذه', missing: gaps, next: 'كمّلها وأعد الطلب' });
  if (!entity(db, kind, entity_id)) {
    refuse(404, 'master_data_not_found', { what: 'ما في صف بهذا المعرّف يُضاف له بديل', next: 'سجّل الصف أول من مصدره' });
  }
  return transaction(db, () => {
    db.prepare('INSERT INTO master_data_aliases(entity_kind,entity_id,alias,alias_kind,source_authority,source_url,note,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(kind, entity_id, text(alias), alias_kind, text(source_authority), text(source_url), text(note), now());
    audit(db, actor, `master_data.${kind}`, entity_id, 'add_alias', {}, { alias: text(alias), alias_kind }, `اسم بديل من: ${text(source_authority)}`);
    return aliasesFor(db, kind, entity_id);
  });
}

// ── تحميل قائمة من ملف مصدر ────────────────────────────────────────────────────
// المحمّل هو الطريق الوحيد الذي تدخل منه قائمةٌ كاملة، وهو يرفض ما لا سند له بدل أن يقبله ناقصًا.
// وكل صف يدخل منه يدخل **غير مطابَق**، لأنه يمرّ من recordEntity كغيره: الملف ينقل ما قاله المصدر،
// والشهادة على مطابقته فعلٌ ثانٍ باسم إنسان.
//
// ‏**لماذا لا معاملة واحدة تلفّ التحميل كله:** recordEntity تفتح معاملتها، وBEGIN داخل BEGIN يسقط في
// SQLite. فالبديل المأخوذ هنا هو الفحص الكامل قبل أول كتابة — الشكل، والسند، والعبارات الممنوعة،
// والتكرار داخل الملف، والتصادم مع الصفوف القائمة — حتى لا يبقى بعد بدء الكتابة سببٌ معروفٌ للتوقف
// في المنتصف. ولو وقع ما لم يُتوقَّع، فالمكتوب يبقى مكتوبًا ويقوله التقرير بالعدد، ولا يُترك التحميل
// يدّعي نجاحًا لم يقع.
const SOURCE_FILE_FIELDS = { bank: ['name_ar', 'name_en'], country: ['iso2', 'iso3', 'name_ar', 'name_en'], mission: ['mission_type', 'city_ar', 'city_en', 'name_ar', 'name_en'] };
// حقول اختيارية يقبلها الملف حين ينشرها المصدر. وما عداها يُرفض الملف لأجله: حقلٌ لا يعرفه الدليل
// يعني أن كاتب الملف ظنّ أنه يحفظ شيئًا وهو لم يُحفظ.
const SOURCE_FILE_EXTRAS = { bank: ['short_name', 'unified_number', 'commercial_registration', 'source_category', 'licence_number', 'licence_authority', 'bic', 'country_id'], country: ['iso_numeric'], mission: ['country_id'] };
// ما يكتبه المصدر مكان الرقم غير المنشور. يصير فراغًا: الشرطة تتكرر فتُسقط التفرّد، وتُقرأ رقمًا اسمه «-».
const PLACEHOLDERS = new Set(['-', '—', 'N/A', 'n/a', 'غير متوفر', 'لا يوجد']);
const fromSource = value => (PLACEHOLDERS.has(String(value ?? '').trim()) ? '' : text(value));

export function readSourceFile(path) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    refuse(422, 'master_data_source_file_unreadable', {
      what: `ما قدرت أقرأ ملف المصدر: ${error.message}`,
      next: 'تأكد أن الملف موجود وأنه JSON صحيح',
    });
  }
  const source = parsed?.source ?? {};
  const gaps = [];
  if (!ENTITY_KINDS.includes(source.kind)) gaps.push({ document: 'نوع القائمة (kind)', why: `واحد من: ${ENTITY_KINDS.join('، ')}`, owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source.authority_ar)) gaps.push({ document: 'سلطة المصدر (authority_ar)', why: 'الجهة التي تقول هذي القائمة. قائمة بلا جهة قالتها ما تُراجع ولا تُصحَّح', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source.page_url)) gaps.push({ document: 'عنوان الصفحة (page_url)', why: 'من أين قُرئت القائمة بالضبط، فيُفتح العنوان ويُقارن', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!text(source.read_at)) gaps.push({ document: 'تاريخ القراءة (read_at)', why: 'قائمةٌ ما يُعرف متى قُرئت ما تُقارن بقائمة أحدث', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (!Array.isArray(parsed?.rows) || !parsed.rows.length) gaps.push({ document: 'الصفوف (rows)', why: 'ملف بلا صفوف ما فيه شي يُحمَّل', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' });
  if (gaps.length) {
    refuse(422, 'master_data_source_file_incomplete', {
      what: 'ما يُحمَّل ملف مصدر بلا هذي — الصف اللي ما يعرف من قاله ما يدخل الدليل',
      missing: gaps,
      next: 'كمّل ترويسة الملف من المصدر نفسه وأعد المحاولة',
    });
  }
  return { source, rows: parsed.rows };
}

export function loadSourceFile(db, actorSupplied, path, { dry = false } = {}) {
  const actor = actorOrRefuse(db, actorSupplied);
  const { source, rows } = readSourceFile(path);
  const kind = source.kind;
  const { label } = tableFor(kind);
  const known = [...SOURCE_FILE_FIELDS[kind], ...SOURCE_FILE_EXTRAS[kind], 'id', 'source_key'];

  // الفحص الكامل أولًا: يُجمَع كل ما ينقص ويُقال مرة واحدة، فلا يُصلَح صفٌّ ويُعاد التحميل ليسقط على التالي.
  const faults = [];
  const seen = new Map();
  for (const [index, row] of rows.entries()) {
    const at = `الصف ${index + 1}${text(row?.id) ? ` (${text(row.id)})` : ''}`;
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(text(row?.id))) { faults.push(`${at}: المعرّف ناقص أو شكله غلط`); continue; }
    if (seen.has(text(row.id))) { faults.push(`${at}: المعرّف مكرر في الملف نفسه`); continue; }
    seen.set(text(row.id), index);
    for (const field of SOURCE_FILE_FIELDS[kind]) if (!text(row[field])) faults.push(`${at}: ناقصه «${field}»`);
    for (const key of Object.keys(row)) if (!known.includes(key)) faults.push(`${at}: حقل ما يعرفه الدليل «${key}»`);
    for (const [key, value] of Object.entries(row)) {
      const phrase = typeof value === 'string' ? operationalStatusIn(value) : '';
      if (phrase) faults.push(`${at}: «${key}» فيها عبارة حالة تشغيلية («${phrase}») — المؤسسة تُسجَّل والحالة ما تُنقل معها`);
    }
  }
  if (faults.length) {
    refuse(422, 'master_data_source_rows_unsupported', {
      what: `${faults.length} ملحوظة على صفوف ملف ${label}، وما كُتب ولا صف`,
      missing: faults.slice(0, 20).map(line => ({ document: line, why: 'الصف اللي ما يكتمل سنده ما يدخل الدليل', owner: 'مسؤول البيانات المرجعية', owner_role: 'admin' })),
      next: 'صحّح الملف من المصدر نفسه وأعد التحميل. وما تكمّل الناقص من عندك',
    });
  }

  const present = new Set(listEntities(db, kind).map(row => row.id));
  const pending = rows.filter(row => !present.has(text(row.id)));
  const report = {
    kind,
    authority: text(source.authority_ar),
    page_url: text(source.page_url),
    read_at: text(source.read_at),
    rows: rows.length,
    already_present: rows.length - pending.length,
    loaded: 0,
    dry,
  };
  // الجولة الجافة تفحص ولا تكتب: تُشغَّل على القائمة قبل التشغيل على القاعدة الحيّة.
  if (dry) { report.would_load = pending.length; return report; }

  for (const row of pending) {
    const values = { id: text(row.id), source_authority: text(source.authority_ar), source_url: text(source.page_url) };
    for (const field of [...SOURCE_FILE_FIELDS[kind], ...SOURCE_FILE_EXTRAS[kind]]) {
      const value = fromSource(row[field]);
      if (value) values[field] = value;
    }
    recordEntity(db, actor, kind, values);
    report.loaded += 1;
  }
  audit(db, actor, `master_data.${kind}`, 'source_file', 'load_source_file', {}, report,
    `تحميل ${report.loaded} صفًا من ${report.authority} — قُرئت في ${report.read_at}`);
  return report;
}

// ── حالة الدليل ────────────────────────────────────────────────────────────────
// الشاشة الفاضية تقول ما الناقص ومن يملكه، لا «لا نتائج». والفرق ليس تجميلًا: «لا نتائج» تقول للموظف
// إن بنكه غير موجود فيروح يسأل عن بنكه، و«ما وصل دليل البنوك بعد» تقول إن النقص عندنا لا عنده.
// ولا تُذكر في هذي الجُمل أسماء من نفّذ ولا مسارات ملفات: الموظف يقرأ ما ينقص ومن يملكه، وما عدا ذلك
// مكانه سجل التدقيق ووثيقة التسليم.
export const DIRECTORY_EMPTY = Object.freeze({
  bank: Object.freeze({
    title: 'ما وصل دليل البنوك بعد',
    what: 'قائمة البنوك ما تنكتب إلا من البنك المركزي السعودي. ولين توصل، المكان يبقى فاضي — ما نكتب بنك من عندنا.',
    authority: 'البنك المركزي السعودي (ساما)',
    next: 'وصّل قائمة ساما المرخّصة ونعبّيها منها',
  }),
  mission: Object.freeze({
    title: 'ما وصل دليل السفارات بعد',
    what: `هذا الدليل لـ${MISSION_SCOPE_AR}، ومصدره وزارة الخارجية — وقائمتها ما وصلتنا لين الحين.`,
    authority: 'وزارة الخارجية السعودية',
    next: 'وصّل دليل البعثات من الخارجية ونعبّيه منه',
  }),
  country: Object.freeze({
    title: 'ما وصلت قائمة الدول بعد',
    what: 'قائمة الدول ورموزها تنتظر مصدرًا رسميًّا يقولها. وما نكتبها من عندنا.',
    authority: 'ينتظر قرار المالك: أيّ جهة تُعتمد لقائمة الدول ورموز ISO',
    next: 'حدّد الجهة ونعبّي القائمة منها',
  }),
});

// ما يقوله هذا الملخص عن الصفوف: كم صفًا فيه، وكم منها مطابَق على مصدره. ولا يقول شيئًا عن المؤسسات
// نفسها: لا كم منها يعمل ولا كم بدأ — الدليل ما يعرف ذلك ولا يُسأل عنه.
export function directoryState(db, tenant_id = null) {
  const count = (table, where = '') => db.prepare(`SELECT count(*) c FROM ${table}${where}`).get().c;
  const state = {};
  for (const kind of ENTITY_KINDS) {
    const { table } = TABLES[kind];
    const rows = count(table);
    state[kind] = {
      rows,
      verified: count(table, " WHERE verification='verified'"),
      unverified: count(table, " WHERE verification='unverified'"),
      // نصّ الشاشة للنوع الفاضي وحده: القائمة الممتلئة تعرض نفسها ولا تحتاج اعتذارًا.
      empty_text: rows === 0 ? DIRECTORY_EMPTY[kind] : null,
    };
  }
  state.aliases = count('master_data_aliases');
  state.open_reviews = tenant_id ? openReviews(db, tenant_id).length : null;
  state.empty = ENTITY_KINDS.every(kind => state[kind].rows === 0);
  // سطرٌ واحد يُقرأ في الشاشة حين لا شيء في الدليل كله، بلهجة الناس وبلا مسار ملف.
  state.waiting_on = state.empty
    ? 'الدليل كله فاضي: ما وصلتنا قوائم البنوك ولا السفارات من جهاتها الرسمية، وما نكتبها من عندنا'
    : null;
  // وهذا للمشرف على الدليل لا للشاشة: أين يقرأ ما وصل وما لم يصل بالتفصيل.
  state.handover_note = 'docs/services/MASTER-DATA-SOURCES.md';
  return state;
}
