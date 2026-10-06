// مركز الخدمات — لوح الإدارة في «إعداد الاعتماد» (الدفعة الرابعة): تسعة تبويبات، واحدٌ منها يكتب.
//
// ما يُقرأ هنا يُقرأ من مصادره الواحدة: الفئات من placementFor (الجملة نفسها التي ترسم الدليل)، والأوزان وصفراها
// من catalog-tree.mjs بنصّهما، وخريطة الحالات من القاموس، والرحلات من JOURNEYS وJOURNEYS_LATER. ولا سطح نشرٍ بعد:
// الشجرة كودٌ هو النسخة صفر، والتبويبان «المعاينة والنشر» و«الاستيراد/التصدير» مؤجَّلان بسببهما المكتوب لا مرسومين
// فارغين.
//
// **سطح الكتابة الوحيد هو المرادفات**: إضافة وحذف صفوف curated في service_synonyms، ولكلٍّ حدث تدقيق
// (catalog.synonym_added|removed) — المرادف قرار توجيه لا زينة (نقد المراجعة §4-3). ومرادفُ خدمةٍ سرّية أو مغلقة
// الدائرة فعلُ شخصين: يُقترح فيُكتب صفّه بعلامة PROPOSAL_MARK في note ولا يقرؤه البحث، ثم يؤكّده حاملُ التصريح آخر.
// الحالة في note لا في عمود: الترحيل 131 مطبَّق ولا يُمسّ.
import { audit, now } from './db.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { can, capabilityName } from './access.mjs';
import { CAPABILITY, hiddenServiceCount } from './service-availability.mjs';
import { CATEGORIES, AUDIENCES, placementFor, PINS, SEASONS, seasonFor, JOURNEYS, JOURNEYS_LATER, JOURNEY_VERSION,
  PROPOSAL_MARK, NAMING_RULE_DECISION, CATALOG_RENAMES, FIXED_NAMES } from './catalog-tree.mjs';
import { SERVICE_VARIANTS, CONFIDENTIAL_SERVICES, CLOSED_CIRCLE_SERVICES } from './service-catalog.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';
import { REQUEST_STATUSES, statusName, stageOf } from './static/vocabulary.mjs';
import { normalize } from './arabic-text.mjs';
import { redact } from './pii.mjs';
import { riyadhToday } from './riyadh-time.mjs';
// الحقائق المقيسة (المنشور من بطاقات التعريف، حجم القاعدة) وأوزان الترتيب بسببها المحقون: من الوحدة التي تقيسها للدليل نفسه.
import { catalogFacts, rankingWeights } from './catalog-home.mjs';

export const AUDIENCE_NAMES=Object.freeze({employee:'الموظف',manager:'المدير',client:'العميل',vendor:'المورّد'});
export const SOURCE_NAMES=Object.freeze({curated:'كتبه إنسان',from_search:'من بحثٍ لم يجد ثم اعتُمد',from_code:'من الكود'});
export const MISS_MIN_COUNT=3;
export const MISS_WINDOW_DAYS=30;
const QUIET=new Set([...CONFIDENTIAL_SERVICES,...CLOSED_CIRCLE_SERVICES]);
export const isQuietItem=(kind,key)=>kind==='service'&&QUIET.has(key);
const EXTERNAL_WHY='لا دور لعميل ولا لمورّد في users (employee, manager, hr, it, admin, pm) ولا أحد منهما يستطيع الدخول. سطحٌ لهما = أول مصادقة خارجية في تاريخ المنصة: إعادة بناء قيد الأدوار (جدول users يُعاد بناؤه)، وسياسة جلسات، وقصة عزل بيانات، وتحقق خارج القناة على PRC-VENDOR-BANK. مشروع مستقل لا فصلٌ في الدليل.';

function manager(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,CAPABILITY))refuse(403,'forbidden',{what:'لوح شجرة مركز الخدمات لحامل «إعداد الخدمات» وحده',
    missing:[{document:`تصريح «${capabilityName(CAPABILITY)}»`,why:'المرادفات قرار توجيه يُغيّر ما يجده الناس',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'اطلب التصريح من مسؤول المنصة، أو اقرأ الدليل من مركز الخدمات'});
  return u;
}
const inTransaction=(db,what)=>{if(!db.isTransaction)refuse(409,'transaction_required',{what,
  missing:[{document:'معاملة قاعدة بيانات',why:'كل كتابة في المنصة تجري داخل معاملة واحدة',owner:'مسؤول المنصة',owner_role:'admin'}],
  next:'أعد المحاولة من شاشة «إعداد الاعتماد»'});};

/* ───── الأسماء: من صفّها الحيّ وحده (C2) ─────────────────────────────────── */
const groupOf=code=>SERVICE_VARIANTS.find(g=>g.code===code)??null;
const moduleOf=code=>MODULE_SERVICES.find(m=>m.code===code)??null;
function nameOf(db,tenantId,kind,key){
  if(kind==='group')return groupOf(key)?.name_ar??key;
  if(kind==='module')return moduleOf(key)?.name_ar??key;
  return db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(tenantId,key)?.name_ar??key;
}
// البند الذي يقبل مرادفًا: صفٌّ في الإسقاط، أو خدمة في الجدول، أو وحدة مخصصة، أو مجموعة خيارات. غير ذلك يُرفض باسمه.
function itemOf(db,tenantId,kind,key){
  if(db.prepare('SELECT 1 FROM catalog_placement WHERE tenant_id=? AND item_kind=? AND item_key=?').get(tenantId,kind,key))return {kind,key};
  if(kind==='service'&&db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND code=?').get(tenantId,key))return {kind,key};
  if(kind==='module'&&moduleOf(key))return {kind,key};
  if(kind==='group'&&groupOf(key))return {kind,key};
  return null;
}
// حالة الاقتراح تُقرأ من note: «العلامة|معرّف المقترِح|ملاحظته».
export const proposalOf=note=>{
  const text=String(note??'');
  if(!text.startsWith(PROPOSAL_MARK+'|'))return null;
  const [,proposer='',...rest]=text.split('|');
  return {proposer,note:rest.join('|')};
};
export const proposalNote=(userId,note)=>`${PROPOSAL_MARK}|${userId}|${note}`;

/* ───── القراءة ─────────────────────────────────────────────────────────────── */

function categoriesTab(db,tenantId){
  const audiences=AUDIENCES.map(audience=>{
    // المدير فرقٌ فوق الموظف (C6): جمهوره يُحلّ اتحادًا كما تحلّه audiencesFor؛ والعميل والمورّد صفرٌ بسببهما.
    const resolved=audience==='manager'?['employee','manager']:[audience];
    // 'all': لوح الدليل يعدّ الشجرة كما يديرها لا كما يراها حساب، فلا يُنقص الشرط (138) من عدٍّ إداري.
    const view=placementFor(db,tenantId,resolved,'all');
    return {key:audience,name:AUDIENCE_NAMES[audience],resolved,rows:view.rows.length,
      categories:view.categories.map(c=>({key:c.key,name:c.name_ar,cards:c.cards,items:c.items})),totals:view.totals,
      why_empty:view.rows.length?null:EXTERNAL_WHY};
  });
  const state=db.prepare('SELECT * FROM catalog_projection_state WHERE tenant_id=?').get(tenantId)??null;
  return {audiences,all_categories:CATEGORIES.map(c=>({key:c.key,name:c.name_ar,name_en:c.name_en,position:c.position,description:c.description})),
    items_unplaced:state?.items_unplaced??0,release_version:state?.release_version??0,rebuilt_at:state?.rebuilt_at??null,entries:state?.entries??0,
    hidden_services:hiddenServiceCount(db,tenantId),
    note:'الشجرة كودٌ هو النسخة صفر (app/catalog-tree.mjs)؛ سطح النشر يأتي بعد أن تثبت أنها الشجرة الصحيحة. الفئات ثابتة الترتيب بترتيب المالك، ولا سحبٌ ولا إفلات قبل سطح النشر.',
    external_why:EXTERNAL_WHY};
}

// «بحثٌ بلا نتيجة»: الصورة المطبَّعة وحدها، ولا يظهر سطرٌ قبل ثلاث مرات في ثلاثين يومًا (نمط الحدّ الأدنى، نقد المراجعة
// §4-2). يقرؤه تبويب المرادفات ولوح الصحة من هنا سواء. والسرّي لا يُسجَّل بحثه أصلًا (logSearchEvent).
export function missesReport(db,tenantId){
  const since=new Date(Date.now()-MISS_WINDOW_DAYS*86400000).toISOString();
  const misses=db.prepare(`SELECT query_normalized AS query,COUNT(*) AS n,MAX(at) AS last_at FROM catalog_search_log
    WHERE tenant_id=? AND event='searched' AND result_count=0 AND at>=? GROUP BY query_normalized HAVING COUNT(*)>=? ORDER BY n DESC,last_at DESC LIMIT 50`).all(tenantId,since,MISS_MIN_COUNT);
  const below=db.prepare(`SELECT COUNT(DISTINCT query_normalized) AS n FROM catalog_search_log WHERE tenant_id=? AND event='searched' AND result_count=0 AND at>=?
    AND query_normalized NOT IN (SELECT query_normalized FROM catalog_search_log WHERE tenant_id=? AND event='searched' AND result_count=0 AND at>=? GROUP BY query_normalized HAVING COUNT(*)>=?)`).get(tenantId,since,tenantId,since,MISS_MIN_COUNT).n;
  return {misses,below_minimum:below,min_count:MISS_MIN_COUNT,window_days:MISS_WINDOW_DAYS,since};
}
function synonymsTab(db,tenantId){
  const rows=db.prepare(`SELECT s.*,x.name AS added_by_name FROM service_synonyms s LEFT JOIN users x ON x.id=s.added_by
    WHERE s.tenant_id=? ORDER BY s.item_kind,s.item_key,s.source,s.normalized`).all(tenantId);
  const byItem=new Map();
  for(const row of rows){
    const id=`${row.item_kind}:${row.item_key}`;
    if(!byItem.has(id))byItem.set(id,{kind:row.item_kind,key:row.item_key,name:nameOf(db,tenantId,row.item_kind,row.item_key),confidential:isQuietItem(row.item_kind,row.item_key),rows:[]});
    const proposal=proposalOf(row.note);
    byItem.get(id).rows.push({term:row.term,normalized:row.normalized,source:row.source,source_name:SOURCE_NAMES[row.source]??row.source,
      note:proposal?proposal.note:row.note,added_by:row.added_by,added_by_name:row.added_by_name??row.added_by,added_at:row.added_at,
      pending:!!proposal,proposed_by:proposal?.proposer??null,removable:row.source!=='from_code'});
  }
  // البنود بلا مرادف واحد تُسرد أيضًا: الإسقاط كله لا ما ورد في الجدول وحده.
  for(const row of db.prepare("SELECT DISTINCT item_kind,item_key FROM catalog_placement WHERE tenant_id=?").all(tenantId)){
    const id=`${row.item_kind}:${row.item_key}`;
    if(!byItem.has(id))byItem.set(id,{kind:row.item_kind,key:row.item_key,name:nameOf(db,tenantId,row.item_kind,row.item_key),confidential:isQuietItem(row.item_kind,row.item_key),rows:[]});
  }
  const items=[...byItem.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const {misses,below_minimum:below}=missesReport(db,tenantId);
  // ما لا يصل تقرير «بلا نتيجة» أبدًا، بأسمائه (مراجعة 23 سبتمبر): بحثٌ أصاب بندًا سرّيًا أو مغلق الدائرة لا يُسجَّل — قرار المالك
  // §8-7 في المواصفة — فحاجات الراتب والسلفة والتظلّم لا تدخل هذا التقرير، ويُقال ذلك هنا لا يُكتشف بالمصادفة.
  const excluded=[...QUIET].map(code=>({kind:'service',key:code,name:nameOf(db,tenantId,'service',code)}));
  return {items,totals:{items:items.length,rows:rows.length,curated:rows.filter(r=>r.source==='curated').length,from_code:rows.filter(r=>r.source==='from_code').length,
      pending:rows.filter(r=>proposalOf(r.note)).length,thin:items.filter(i=>i.rows.filter(r=>!r.pending).length<3).length},
    misses,misses_below_minimum:below,min_count:MISS_MIN_COUNT,window_days:MISS_WINDOW_DAYS,excluded_from_log:excluded,
    note:'سطح الكتابة الوحيد في هذا اللوح. صفوف الكود تُعاد كتابتها مع كل إسقاط فلا تُحذف من هنا؛ وما كتبه إنسان يُحذف بحدث تدقيق. مرادف الخدمة السرّية أو مغلقة الدائرة يُقترح ثم يؤكّده حامل تصريح آخر، ولا يدخل البحث قبل ذلك. والسرّي لا يُسجَّل بحثه أصلًا، فتقرير «بلا نتيجة» لا يحمل أثرًا لمن بحث عن تظلّم.'};
}

export function catalogAdmin(db,supplied){
  const u=actorOrRefuse(db,supplied);
  const manage=can(db,u,CAPABILITY);
  // me: ليعرف اللوح أن زرّ «تأكيد» لا يُرسم لمن اقترح المرادف نفسه (الخادم يرفضه على كل حال).
  const base={can_manage:manage,me:u.id,note:'شجرة مركز الخدمات كما تُقرأ من مصادرها: كل عدّ من placementFor، وكل وزن بنصّه، وكل ما لم يُبنَ مكتوبٌ سببه.'};
  if(!manage)return base;
  // يوم الرياض لا يوم UTC: الموسم يبدأ وينتهي بتقويم المستخدم، وnow() طابع UTC يتأخر يومًا بين 00:00 و03:00.
  const today=riyadhToday(),facts=catalogFacts(db,u.tenant_id);
  return {...base,facts,
    categories:categoriesTab(db,u.tenant_id),
    journeys:{version:JOURNEY_VERSION,
      built:JOURNEYS.map(j=>({key:j.key,name:j.name_ar,description:j.description,parent:{...j.parent,name:nameOf(db,u.tenant_id,j.parent.kind,j.parent.key)},audience:j.audience,
        steps:j.steps.map(s=>({key:s.key,item:s.item,name:nameOf(db,u.tenant_id,s.item.kind,s.item.key),condition:s.when?JSON.stringify(s.when):'بلا شرط',preset:s.preset??{},copy:s.copy??{}})),
        runs:db.prepare('SELECT status,COUNT(*) AS n FROM journey_runs WHERE tenant_id=? AND journey_key=? GROUP BY status').all(u.tenant_id,j.key)})),
      later:JOURNEYS_LATER.map(j=>({...j,status:'معرّفة لاحقًا'})),
      note:'التعريف كودٌ (النسخة صفر)؛ الشرط بشكل show_when نفسه ويُقيَّم بمُقيِّم الحقول. ولا فرع جنسيةٍ في «انضمام موظف جديد»: الأب بلا حقل إقامة، ولا خدمة إصدار إقامة يتفرّع إليها.'},
    synonyms:synonymsTab(db,u.tenant_id),
    pins:{rows:[...PINS],note:PINS.length?'':'لا شيء بعد: لا قرار تثبيت من مالك الدليل. المسار: PINS في app/catalog-tree.mjs (كود، النسخة صفر) حتى يوجد سطح نشر.'},
    seasons:{rows:SEASONS.map(s=>({...s})),live:seasonFor(new Date(today+'T00:00:00Z')).map(s=>s.key),today,
      note:SEASONS.length?'':'لا شيء بعد: لا موسم قرّره أحد. المسار: SEASONS في app/catalog-tree.mjs بنافذة سنوية ميلادية أو هجرية (أم القرى المحسوب) وبنودها؛ وزن الترتيب صفر بقرار المالك.'},
    card_fields:{link:'#service-cards',columns:['short_description','eligibility_rules','required_documents','faq'],published:facts.published_n,of:facts.of,
      note:`حقول صفحة الخدمة الأربعة أُضيفت في الترحيل 131 على بطاقة التعريف (service_cards) وتُحرَّر في شاشتها لا هنا. المنشور من بطاقات التعريف اليوم ${facts.published} من ${facts.of}.`},
    status_map:REQUEST_STATUSES.map(status=>{const stage=stageOf(status);return {status,status_name:statusName(status),stage:stage.stage,stage_name:stage.name_ar};}),
    ranking:{weights:rankingWeights(facts),
      note:'تُقرأ عند الرسم ولا تُخزَّن درجة: المدخلات تُخزَّن والناتج يُحسب، فيقرأ المدير سببًا يطابق النتيجة. ولا معاينة للأوزان قبل سطح نشر.'},
    publish:{deferred:true,why:'إسكان الشجرة في سجل التعريفات (123) يلزمه واصفٌ لا ينطبق عليه عقد registerEntity (جدول وشاشة وحالات ودوالّ load/list/readable)، ورفع SPEC_FORMAT رقمًا عامًّا للمنصة كلها، وتعليم مصنّف الفروق دلالات الترتيب. يأتي بعد أن تثبت الشجرة.',
      preview:{how:'«جرّب كمستخدم» (view_as) من قائمة الحساب: تُرى الشجرة كما يراها موظف أو مدير، بهوية صاحبها الحقيقية وبلا كتابة.',link:'#services'}},
    import_export:{deferred:true,why:'definition_imports لا يغطي الشجرة: هي كودٌ لا وثيقة كيان، ولا نسخة ثانية من آلية النقل تُبنى لسبعة أرقام وثماني فئات قبل سطح النشر.'},
    naming:{decision:NAMING_RULE_DECISION,renames:CATALOG_RENAMES.length,fixed:FIXED_NAMES.length,
      renamed:CATALOG_RENAMES.map(r=>({code:r.code,from:r.from,to:r.to,why:r.why})),fixed_codes:[...FIXED_NAMES]}};
}

/* ───── الكتابة: المرادفات ──────────────────────────────────────────────────── */

function readItem(db,tenantId,input){
  const kind=String(input.item_kind??''),key=String(input.item_key??'').trim();
  if(!['service','module','group','benefit'].includes(kind)||key.length<2||key.length>60)refuse(400,'item',{what:'البند بلا نوع أو رمز صالح',
    missing:[{document:'نوع البند ورمزه كما في لوح المرادفات',why:'المرادف يُربط ببندٍ بعينه',owner:'حامل «إعداد الخدمات»',owner_role:CAPABILITY}],next:'اختر البند من قائمة اللوح لا من الرابط'});
  const item=itemOf(db,tenantId,kind,key);
  if(!item)refuse(404,'item_not_found',{what:`لا بند «${key}» من نوع «${kind}» في الدليل`,
    missing:[{document:'بند في الإسقاط أو خدمة في الجدول أو وحدة مخصصة أو مجموعة خيارات',why:'مرادفٌ لبندٍ لا وجود له لا يجد شيئًا',owner:'حامل «إعداد الخدمات»',owner_role:CAPABILITY}],
    next:'اختر البند من قائمة اللوح'});
  return item;
}
export function addSynonym(db,supplied,input){
  const u=manager(db,supplied);
  inTransaction(db,'لا يُكتب مرادف خارج معاملة قاعدة بيانات');
  v.object(input,['item_kind','item_key','term','note']);
  const {kind,key}=readItem(db,u.tenant_id,input);
  const term=String(input.term??'').trim(),note=String(input.note??'').trim().slice(0,200);
  if(term.length<2||term.length>60)refuse(400,'term',{what:'المرادف أقصر من حرفين أو أطول من ستين',missing:[],next:'اكتب كلمة الناس كما يكتبونها، من حرفين إلى ستين'});
  const normalized=normalize(redact(term).text);
  if(normalized.length<2||normalized.length>60)refuse(400,'term',{what:'صورة المرادف المطبَّعة أقصر من حرفين: حرفٌ واحد يطابق كل شيء',missing:[],next:'اكتب كلمة أطول'});
  const existing=db.prepare('SELECT source,note FROM service_synonyms WHERE tenant_id=? AND item_kind=? AND item_key=? AND normalized=?').get(u.tenant_id,kind,key,normalized);
  if(existing)refuse(409,'synonym_exists',{what:`«${term}» مرادفٌ قائم لهذا البند (${SOURCE_NAMES[existing.source]??existing.source})`,missing:[],
    next:existing.source==='from_code'?'صفوف الكود تُحرَّر في app/catalog-tree.mjs أو في words[] المجموعة':'احذفه أولًا إن أردت تغييره'});
  const quiet=isQuietItem(kind,key),stamp=now();
  db.prepare("INSERT INTO service_synonyms(tenant_id,item_kind,item_key,term,normalized,source,note,added_by,added_at) VALUES(?,?,?,?,?,'curated',?,?,?)")
    .run(u.tenant_id,kind,key,term,normalized,quiet?proposalNote(u.id,note):note,u.id,stamp);
  audit(db,u,'service_synonym',`${kind}:${key}:${normalized}`,quiet?'catalog.synonym_proposed':'catalog.synonym_added',{},{item_kind:kind,item_key:key,term,normalized,pending:quiet},note);
  return {item_kind:kind,item_key:key,term,normalized,pending:quiet,
    next:quiet?'مرادف خدمة سرّية: لا يدخل البحث حتى يؤكّده حامل «إعداد الخدمات» آخر من اللوح نفسه':null};
}
export function confirmSynonym(db,supplied,input){
  const u=manager(db,supplied);
  inTransaction(db,'لا يُؤكَّد مرادف خارج معاملة قاعدة بيانات');
  v.object(input,['item_kind','item_key','normalized','note']);
  const {kind,key}=readItem(db,u.tenant_id,input);
  const normalized=String(input.normalized??'').trim(),reason=String(input.note??'').trim().slice(0,200);
  const row=db.prepare('SELECT * FROM service_synonyms WHERE tenant_id=? AND item_kind=? AND item_key=? AND normalized=?').get(u.tenant_id,kind,key,normalized)??null;
  const proposal=row?proposalOf(row.note):null;
  if(!row||!proposal)refuse(404,'proposal_not_found',{what:'لا مرادف مقترحًا بانتظار تأكيد لهذا البند بهذه الصورة',missing:[],next:'أعد فتح لوح المرادفات؛ ربما أُكّد أو حُذف'});
  if(proposal.proposer===u.id)refuse(403,'two_person',{what:'لا يؤكّد المقترِح مرادفه: مرادف الخدمة السرّية فعلُ شخصين',
    missing:[{document:'تأكيدٌ من حامل «إعداد الخدمات» آخر',why:'من يوجّه الناس إلى خدمة سرّية لا يكون وحده',owner:'حامل تصريح آخر',owner_role:CAPABILITY}],
    next:'اطلب من حامل تصريح آخر فتح اللوح والتأكيد'});
  db.prepare('UPDATE service_synonyms SET note=? WHERE tenant_id=? AND item_kind=? AND item_key=? AND normalized=?')
    .run(`أُكّد — ${proposal.note}`.trim(),u.tenant_id,kind,key,normalized);
  audit(db,u,'service_synonym',`${kind}:${key}:${normalized}`,'catalog.synonym_confirmed',{pending:true,proposed_by:proposal.proposer},{pending:false,term:row.term},reason);
  return {item_kind:kind,item_key:key,normalized,pending:false};
}
export function removeSynonym(db,supplied,input){
  const u=manager(db,supplied);
  inTransaction(db,'لا يُحذف مرادف خارج معاملة قاعدة بيانات');
  v.object(input,['item_kind','item_key','normalized','note']);
  const {kind,key}=readItem(db,u.tenant_id,input);
  const normalized=String(input.normalized??'').trim(),reason=String(input.note??'').trim().slice(0,200);
  const row=db.prepare('SELECT * FROM service_synonyms WHERE tenant_id=? AND item_kind=? AND item_key=? AND normalized=?').get(u.tenant_id,kind,key,normalized)??null;
  if(!row)refuse(404,'synonym_not_found',{what:'لا مرادف بهذه الصورة لهذا البند',missing:[],next:'أعد فتح لوح المرادفات'});
  if(row.source==='from_code')refuse(409,'from_code',{what:`«${row.term}» من الكود ويُعاد كتابته مع كل إسقاط، فلا يُحذف من هنا`,
    missing:[{document:'تحرير الكلمة في app/catalog-tree.mjs (CATALOG_WORDS أو CATALOG_RENAMES) أو في words[] المجموعة',why:'الإسقاط يمحو صفوف الكود ويعيد كتابتها',owner:'من يحرّر الكود',owner_role:'admin'}],
    next:'احذف الكلمة من مصدرها ثم شغّل المثبّت'});
  db.prepare('DELETE FROM service_synonyms WHERE tenant_id=? AND item_kind=? AND item_key=? AND normalized=?').run(u.tenant_id,kind,key,normalized);
  audit(db,u,'service_synonym',`${kind}:${key}:${normalized}`,'catalog.synonym_removed',{term:row.term,source:row.source,note:row.note},{},reason);
  return {item_kind:kind,item_key:key,normalized,removed:true};
}
