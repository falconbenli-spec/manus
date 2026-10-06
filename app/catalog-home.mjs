// مركز الخدمات — ما يراه الطالب: شاشة الدليل، وصفحة الفئة، وصفحة الخدمة (الدفعة الثانية، فوق ترحيل 131).
//
// هذه الوحدة **لا تحسب رقمًا ثانيًا**. كل عدّ على كل شاشة يأتي من `placementFor` (app/catalog-tree.mjs):
// جملةٌ واحدة على catalog_placement للجمهور المحلول، والترويسة هي مجموع بطاقات الفئات بالبناء. وما تضيفه
// هذه الوحدة فوق ذلك هو **تسمية** الصفوف وحدها: اسمُ كل بند ووصفه ومساره وزمنه بسنده. ولذلك تُختبر بقاعدة
// واحدة في tests/catalog-home.test.mjs: مجموع ما ترسمه البطاقات = ما تقوله الترويسة، لكل جمهور.
//
// وثلاث قواعد صدقٍ مفروضة هنا لا في الشاشة، فلا تستطيع شاشةٌ أن تتحايل عليها:
//   (1) **لا نسبة التزام.** `process-insight.mjs` يحسب on_time_percent اليوم، وصفر من 142 زمنًا متبنّى
//       (`service_target_adoptions` فارغ). فنسبةٌ فوق زمنٍ لم يتبنَّه إنسان أول وعدٍ تقطعه المنصة نيابةً
//       عمّن لم يَعِد. ما يُرسَل بدلها نصٌّ مكتوب في UNAVAILABLE.compliance، لا فراغ ولا صفر.
//   (2) **كل زمن يسافر بسنده.** `targetProvenance` هي المصدر الواحد، و`target.kind_name` يصل مع كل رقم.
//   (3) **الخدمة التي لا يراها هذا الحساب لا تُعرض ولا يُفتح بابها**: `catalog(db,u)` يمرّ على
//       `visibleSql` نفسه الذي يحكم التصفّح والبحث، وفتحُ رمزٍ خارجها يردّ **رفضًا مكتوبًا** بـrefuse().
import { refuse, actorOrRefuse } from './refusal.mjs';
import { now } from './db.mjs';
import * as v from './validation.mjs';
import { catalog } from './workflow.mjs';
import { can, capabilityName } from './access.mjs';
import { CATEGORIES, MY_TEAM_LENS, MY_TEAM_NOTE, placementFor, PINS, RANKING, RANKING_NAMES, RANKING_ZERO_REASONS, fillReason, isGroupCode, seasonFor, PROPOSAL_MARK, frontDoorView, isDepartmentOnly } from './catalog-tree.mjs';
// «لك» (الدفعة الرابعة): إشاراتٌ تملكها المنصة فعلًا — استعمالي أنا (usedServices)، ورصيدي، وخطوة رحلتي المستحقة.
import { usedServices } from './routing.mjs';
import { myJourneyRuns, journeyLens } from './journeys.mjs';
import { countNoun } from './static/arabic-count.mjs';
// رصيد الإجازة من المصدر الذي تقرؤه بطاقة الخيارات نفسها (leaveBalanceOptions): نوعًا نوعًا وللسنة الجارية، لا مجموعًا.
import { SERVICE_VARIANTS, enrichFields, CONFIDENTIAL_SERVICES, CLOSED_CIRCLE_SERVICES, leaveBalanceOptions } from './service-catalog.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';
import { normalize } from './arabic-text.mjs';
import { redact } from './pii.mjs';
import { riyadhToday } from './riyadh-time.mjs';
// ترتيب البحث نفسه الذي تشغّله الشاشة (وحدة متصفح نقية): يعدّ الخادم به نتائج البحث الذي يسجّله.
import { rankCatalog } from './static/catalog-search.mjs';
import { targetsByCode, targetProvenance, DERIVED_MARK } from './service-target.mjs';
import { audiencesFor, gatesFor, hiddenServiceCountFor, isHidden, refuseHidden, stopNote, switchOwners, CAPABILITY } from './service-availability.mjs';
import { annotateCatalog } from './module-routes.mjs';
import { serviceCard } from './service-cards.mjs';
// تسميات الحقول تتبع معجم سجل التعريفات (123) عند القراءة، كما تتبعه في /api/catalog وفي نموذج الطلب — فلا يسمّي
// قسم «ما الذي ستحتاجه؟» حقلًا باسمٍ غير الذي يراه الطالب في النموذج الذي تفتحه الصفحة نفسها.
import { termApplier } from './definitions.mjs';
// مسار الاعتماد بالعربية: الدالة القائمة في الواجهة (app/static/request-picker.mjs:68) لا نسخةٌ ثانية منها.
// وحدةٌ نقية بلا DOM كما هي module-services.mjs التي يقرؤها الخادم منذ البحث الشامل، فاستيرادها هنا يمنع
// أن يفترق «مسار طلبك» في بطاقة الدليل عن «مسار طلبك» في نافذة الطلب الجديد.
import { approvalTrail, routePreview, FEATURED_SERVICES, displayDepartment, ADMIN_AFFAIRS, interimExecutor } from './static/request-picker.mjs';

export const LENSES=Object.freeze(['need','department','journey']);
// ت1: الزيارة الأولى تفتح «حسب الإدارة» (شريط الإدارات بقطاعاتها ← صفحة الإدارة ← الخدمة). ومن اختار عدسةً تعود له عدسته.
export const DEFAULT_LENS='department';

// ما لا تستطيع المنصة قوله بصدق اليوم، بنصّه ومن يملكه وما يلزم بالضبط. تُرسَل إلى الشاشة فتُرسم
// «غير متاح» بسببها، ولا يُترك مكانها فراغًا ولا صفرًا ولا يُخترع لها رقم.
//
// **ولا رقم مكتوب في نصٍّ ثابت (مراجعة 23 سبتمبر).** «صفر من 142» و«صفر بطاقة منشورة» و«29 موظفًا وطلبان مكتملان» كانت
// حرفيّاتٍ تُرسم على ثلاث شاشات بجوار بلاطاتٍ تحسب الرقم نفسه، فتفترقان بعد أول تبنٍّ أو نشرٍ أو طلبٍ مكتمل. الرقم يُقاس
// عند القراءة في catalogFacts ويُحقن في مواضع {…} بـunavailableFor؛ والنصّ الثابت هنا يحمل المواضع لا الأرقام.
export const UNAVAILABLE=Object.freeze({
  compliance:Object.freeze({key:'compliance',label:'نسبة الالتزام بالمهلة',
    why:'المتبنّى من أزمنة الخدمات بقرارٍ مكتوب {adopted} من {of}، وما لم يُتبنَّ مشتقٌّ من بادئة الرمز. ونسبةٌ فوق زمنٍ لم يَعِد به أحد وعدٌ مركّب لا أصل له.',
    needs:'أن يتبنّى مالك الإجراء زمن الخدمة بقرار مكتوب، ثم حدٌّ أدنى لعدد الطلبات قبل عرض أي نسبة',
    owner:'مالك الإجراء المسمّى في بطاقة التعريف'}),
  eligibility:Object.freeze({key:'eligibility',label:'هل تنطبق عليك',
    why:'قواعد الأهلية عمودٌ فارغ على بطاقة التعريف (eligibility_rules)، والمنشور من بطاقات التعريف اليوم {published} من {of}. وآلية المزايا الستّ الحالات لم تُشغَّل قط على بيانات معتمدة.',
    needs:'قاعدة أهلية مكتوبة في بطاقة تعريف منشورة، وعندها تُعرض الحالات الست كما هي ومنها «بيانات ناقصة»',
    owner:'مالك الإجراء ومعدّ الدليل'}),
  documents:Object.freeze({key:'documents',label:'المستندات المطلوبة',
    why:'لم يعتمد أحد قائمة مستندات لهذه الخدمة: خيارات المجموعات الجديدة تُركت فارغة عمدًا، وعمود required_documents فارغ.',
    needs:'قائمة مستندات في بطاقة تعريف منشورة، أو docs[] للخيار في تعريف مجموعته',
    owner:'مالك الإجراء المسمّى في بطاقة التعريف'}),
  faq:Object.freeze({key:'faq',label:'الأسئلة المتكررة',
    why:'عمود faq أُضيف في الترحيل 131 ويبقى فارغًا؛ تحريره كيانٌ في سجل التعريفات لا محرّر ثانٍ.',
    needs:'تسجيل الأسئلة كيانًا في سجل التعريفات فتأتي معها المسودة والفرق المصنَّف والناشر الثاني',
    owner:'من يملك «إعداد الخدمات»'}),
  policy:Object.freeze({key:'policy',label:'السياسة المرجعية',
    why:'policy_reference نصّ حرّ بلا مفتاح إلى مادة، والمنشور من بطاقات التعريف اليوم {published} من {of}.',
    needs:'مرجع مُهيكل إلى مكتبة السياسات، وبطاقة تعريف منشورة تحمله',
    owner:'مالك الإجراء المسمّى في بطاقة التعريف'}),
  usage:Object.freeze({key:'usage',label:'الأكثر طلبًا في 30 يومًا',
    why:'القاعدة اليوم {employees}، والمكتمل من الطلبات {completed}. الإشارة على هذا الحجم إمّا لا تحرّك شيئًا وإمّا يحرّكها طلبٌ واحد من شخصٍ يعرفه الجميع.',
    needs:'عددُ طلباتٍ يجعل للإشارة معنى، وحدٌّ أدنى قبل عرض أي ترتيب',owner:'المالك'}),
  urgency:Object.freeze({key:'urgency',label:'علامة «عاجل»',
    why:'لا عمود أولوية ولا استعجال في جدول الطلبات، ولا أثر للاستعجال في ترتيب صندوق المعتمِد ولا في الساعة. وعلامةٌ بلا أثر أسوأ من غيابها.',
    needs:'عمود في الطلبات، وأثرٌ يراه إنسان في صندوق وارد المعتمِد، وسببٌ إلزامي مكتوب، وضابطٌ يمنع أن يصير الكل عاجلًا',
    owner:'المالك — وهو تغيير في محرّك سير العمل لا في الدليل'}),
  // الدفعة الرابعة: عدسة الرحلة صارت حيّة برحلة واحدة؛ ما بقي غائبًا هو السبع الأخرى، ويُقال بأسمائها في العدسة نفسها.
  journey:Object.freeze({key:'journey',label:'الرحلات السبع الأخرى',
    why:'رحلة واحدة مبنيّة («انضمام موظف جديد» من IT-NEW-ACCOUNT). السبع الباقيات (سفر عمل، مناسبة شخصية، تغيير بيانات، مغادرة موظف، مشروع جديد، عميل جديد، موسمي) مادّتها متفرقة ولا تعريف لها، ولا يُخترع لها تعريف.',
    needs:'لكل رحلة: طلبٌ أب مسمّى، وخطواتٌ بشرطها بشكل show_when، وقرار المالك في ما يُولَّد نيابةً عن الطالب',
    owner:'من يملك «إعداد الخدمات»'}),
  deflection:Object.freeze({key:'deflection',label:'نسبة إغناء البحث عن الطلب',
    why:'تتطلب معرفة أن الموظف قرأ جوابًا ولم يقدّم طلبًا لأنه اكتفى، وهو استنتاج نيّة لا قياس. أقصى ما يصدق قوله «بحوثٌ انتهت بلا تقديم»، وهي رقمٌ آخر ولا يجوز تسميته إغناءً.',
    needs:'لا يُحسب بصدق أصلًا؛ يُعرض عدد البحوث التي لم يتبعها تقديم باسمه الصحيح',
    owner:'المالك'}),
  finding_time:Object.freeze({key:'finding_time',label:'زمن العثور على الخدمة',
    why:'المنصة لا تسجّل توقيتًا في المتصفح إطلاقًا؛ ما يُسجَّل هو أحداث البحث والفتح والتقديم بختم الخادم وبلا هوية.',
    // ما ينقص ليس بيانًا (أحداث البحث والفتح والتقديم مختومة ومربوطة بمعرّف الجلسة في catalog_search_log منذ الدفعة الثالثة)،
    // بل قرار المالك في قياس الفرق بين ختمين: قياسٌ يقترب من «كم استغرق فلان» في شركة من بضع وعشرين نفسًا.
    needs:'قرار المالك في قياس الفرق بين ختمَي البحث والفتح المسجَّلين فعلًا — وهو قياس يقترب من «كم استغرق فلان» — ثم حدٌّ أدنى للعدد قبل عرض أي زمن',
    owner:'المالك'}),
  // الدفعة الثالثة: ما طلبته الكرّاسة في النموذج ولم يُبنَ، بسببه.
  autosave:Object.freeze({key:'autosave',label:'الحفظ التلقائي للمسودة',
    why:'تعديلاتك ما تنحفظ تلقائيًا. اضغط «حفظ المسودة» عشان تقدر ترجع وتكمل طلبك.',
    needs:'قرار المالك في ظهور المسودات التلقائية في «طلباتي»، ثم حفظٌ دوريّ يستدعي مسار المسودة القائم نفسه',
    owner:'المالك'}),
  prefill:Object.freeze({key:'prefill',label:'تعبئة الحقول من طلب سابق',
    why:'التعبئة من طلب سابق متاحة عند إعادة تقديم طلب منقضٍ فقط. في الطلب الجديد، عبّئ البيانات المناسبة لخدمتك.',
    needs:'تعميم مسار النسخ القائم على أي خدمة بحقولها الحيّة، ولا تُنسخ المرفقات أبدًا',
    owner:'من يملك «إعداد الخدمات»'})
});
/* ───── الحقائق المقيسة عند القراءة: ما تُحقَن به نصوص الغياب ─────────────── */
// الرقم الوحيد المسموح في نصّ غيابٍ رقمٌ قِيس في اللحظة نفسها بالجملة نفسها التي تحسبه بلاطة لوح الصحة:
// المتبنّى من الأزمنة (targetsByCode)، والمنشور من بطاقات التعريف، وحجم القاعدة (الحسابات النشطة غير مسؤول المنصة،
// كما يعدّها فهرس البحث)، والمكتمل من الطلبات. تُصاغ بتمييزٍ عربي صحيح ويُكتب «صفر» لا «0» في الجملة.
const EMPLOYEE_NOUN=['حساب نشط واحد','حسابان نشطان','حسابات نشطة','حسابًا نشطًا'];
const spelled=n=>n===0?'صفر':String(n);
export function catalogFacts(db,tenantId){
  const codes=db.prepare('SELECT DISTINCT code FROM services WHERE tenant_id=? AND active=1').all(tenantId).map(r=>r.code);
  const targets=targetsByCode(db,tenantId);
  const adopted=codes.filter(code=>targets.get(code)?.kind==='adopted').length;
  const published=db.prepare("SELECT COUNT(DISTINCT service_code) AS n FROM service_cards WHERE tenant_id=? AND status='published'").get(tenantId).n;
  const employees=db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").get(tenantId).n;
  const completed=db.prepare("SELECT COUNT(*) AS n FROM requests WHERE tenant_id=? AND status='completed'").get(tenantId).n;
  return {of:codes.length,adopted_n:adopted,published_n:published,employees_n:employees,completed_n:completed,
    adopted:spelled(adopted),published:spelled(published),employees:countNoun(employees,EMPLOYEE_NOUN),completed:spelled(completed)};
}
// نصوص الغياب بأرقامها المحقونة لحظة القراءة. facts يُمرَّر حين قِيس مرةً في الحمولة نفسها، فلا يُقاس مرتين.
export function unavailableFor(db,tenantId,keys,facts=catalogFacts(db,tenantId)){
  return keys.map(key=>{const gap=UNAVAILABLE[key];return {...gap,why:fillReason(gap.why,facts),needs:fillReason(gap.needs,facts)};});
}
// أوزان الترتيب بأسمائها وصفريها بسببه المحقون: يقرؤها صفّ «لك» ولوح الإدارة سواء.
export const rankingWeights=facts=>Object.entries(RANKING).map(([key,weight])=>({key,name:RANKING_NAMES[key],weight,zero_reason:RANKING_ZERO_REASONS[key]?fillReason(RANKING_ZERO_REASONS[key],facts):null}));

// ما يُرسَم «غير متاح» على كل شاشة من الأربع، وعلى النموذج. تُرسَل مع الحمولة فتقرأها الشاشة ولا تكتبها من عندها.
export const SCREEN_GAPS=Object.freeze({
  home:Object.freeze(['usage','journey','finding_time']),
  category:Object.freeze(['eligibility','compliance']),
  card:Object.freeze(['eligibility','usage','urgency']),
  page:Object.freeze(['eligibility','documents','faq','policy','compliance','urgency','autosave','prefill']),
  form:Object.freeze(['autosave','prefill','urgency'])
});
// مادّة بطاقة التعريف التي يكتبها مالكها (ت1): غيابها على صفحة الخدمة يُقال «لم يُكتب بعد. يكمله: <الإدارة المالكة>» لا «غير متاح».
export const DRAFT_GAPS=Object.freeze(['documents','eligibility','faq','policy']);

const OPEN_STATUSES=['draft','returned','pending','approved','in_progress'];
// الخدمة التي يبلغها من لم يجد خدمته. رمزٌ لا اسم: الاسم يُقرأ من صفّها الحيّ عند كل رسم.
export const FEEDBACK_SERVICE='IT-PLATFORM-FEEDBACK';
// أقصى ما تسرده «خدمات قريبة»: أخوة المجموعة أولًا ثم أخوة الفئة، ولا يُخترع بينهما رابط.
const NEARBY_LIMIT=6;
const groupOf=code=>SERVICE_VARIANTS.find(g=>g.code===code)??null;
const moduleOf=code=>MODULE_SERVICES.find(m=>m.code===code)??null;

// الزمن كما يصل الشاشة: الكمية وسندها معًا، ولا واحدة منهما بلا الأخرى. `label` هو النص الكامل الذي
// يقرؤه قارئ الشاشة، وفيه مقطع «مشتق من عائلة رمز الخدمة» حرفًا بحرف — عقدٌ مع القارئ تقرؤه الاختبارات.
const targetView=target=>target?{days:target.days,hours:target.hours,kind:target.kind,kind_name:target.kind_name,
  adopted:!!target.adopted,amount:target.amount,note:target.note,label:target.label,
  adopted_by_name:target.adopted_by_name??null,adopted_on:target.adopted_on??null}:null;

// بطاقة الدليل — مكوّن واحد لكل الأنماط الثلاثة (خدمة، مجموعة خيارات، وحدة بشاشة مخصصة)، بجمهورٍ وسيطًا
// لا بأربع نسخ. `items` هو ما تحمله البطاقة من بنود: واحدٌ للمفردة، وعددُ أعضائها للمجموعة — ومجموعه على
// بطاقات الفئة **هو** عدّاد بنود الفئة، فلا يبقى في الشاشة رقمان يفترقان.
function cardFor(row,context){
  const {services,targets,departments,members}=context;
  if(row.item_kind==='group'){
    const group=groupOf(row.item_key),mine=members.get(row.item_key)??[];
    const names=mine.map(m=>nameOf(m,context)).filter(Boolean);
    // مجموعةٌ أعضاؤها الحيّون وحداتٌ مخصصة وحدها (اليوم «إجازة» وعضوها HR-LEAVE): بابها شاشة الوحدة لا نافذة الخيارات —
    // نافذة الخيارات تُبنى من variantCatalog الذي يُسقط المجموعة حين لا رصيد لصاحب الحساب، فكان زرّها يُردّ بخطأ عارٍ
    // «الخدمة غير متاحة» لكل حسابٍ مبذور (مراجعة 23 سبتمبر). وحين لا يملك القارئ تصريح الوحدة يبقى الزرّ مرسومًا معطّلًا
    // بسببه المكتوب، لا حيًّا يُنقر فيُردّ.
    const modules=mine.filter(m=>m.item_kind==='module'),moduleOnly=mine.length>0&&modules.length===mine.length;
    const first=moduleOnly?moduleOf(modules[0].item_key):null;
    const allowed=!first||!first.capability||context.allows(first.capability);
    return {kind:'group',key:row.item_key,name:group?.name_ar??row.item_key,description:group?.description??'',
      department_id:group?.department_id??row.department_id??null,department:departments.get(group?.department_id)??'',
      section:group?.section??'',items:mine.length,options:names,
      // **بلا شارة زمن**: خيارات المجموعة تختلف أزمنتها، وشارةٌ واحدة فوقها تكذب على بعضها.
      target:null,path:[],handler:'',link:moduleOnly&&allowed?first?.href??null:null,module_name:moduleOnly?first?.path_ar??null:null,service_id:null,
      eligible:!moduleOnly||allowed,
      eligibility_reason:moduleOnly&&!allowed?`تُقدَّم من شاشتها المخصصة، وحسابك لا يملك تصريح «${context.capabilityName(first.capability)}». يمنحه مسؤول المنصة.`:null,
      // المجموعة بلا صفحة، وأعضاؤها لهم صفحات: كل عضو يحمل رابط صفحته فيبلغها الطالب من الفئة بضغطة واحدة
      // (الخيار الثاني في تكلفة الضغطات المعلنة: فئة ← رابط الخيار ← صفحة ← نموذج). والعضو الذي شاشتُه
      // وحدةٌ مخصصة يحمل رابط شاشته حين يملك القارئ تصريحها، ولا رابط له حين لا يملكه.
      href:'',members:mine.map(m=>({kind:m.item_kind,key:m.item_key,name:nameOf(m,context),href:memberHref(m,context)}))};
  }
  if(row.item_kind==='module'){
    const module=moduleOf(row.item_key);
    // **الحالة الوحيدة التي تحسبها المنصة اليوم لـ«يراها ولا يستطيع طلبها»**: بند شاشتُه وحدةٌ مخصصة
    // وحسابُ القارئ بلا تصريحها. تبقى البطاقة مرسومة ومقروءة بسببها — لا تُخفى، فإخفاؤها يترك الموظف
    // يبحث عن خدمة يعرف أنها موجودة. والأهلية بقواعدها ما زالت غير محسوبة، ومكتوبٌ ذلك في gaps.
    const allowed=!module?.capability||context.allows(module.capability);
    return {kind:'module',key:row.item_key,name:module?.name_ar??row.item_key,description:module?.description??'',
      department_id:module?.department_id??null,department:departments.get(module?.department_id)??'',
      section:module?.section??'',items:1,options:[],
      // الوحدة المخصصة لا زمن لها في service_directory: زمنُها زمنُ شاشتها، ولا يُخترع لها رقم.
      target:null,path:[],handler:'',link:allowed?module?.href??null:null,module_name:module?.path_ar??null,
      href:'',members:[],service_id:null,eligible:allowed,
      eligibility_reason:allowed?null:`تُقدَّم من شاشتها المخصصة، وحسابك لا يملك تصريح «${context.capabilityName(module.capability)}». يمنحه مسؤول المنصة.`};
  }
  const service=services.get(row.item_key);
  if(!service)return null;
  const list=[...departments].map(([id,name])=>({id,name})),trail=approvalTrail(service,list);
  // معاينة المسار تُبنى على الخدمة **ومعها سندها**، فتقرأ «خلال يوما عمل — مشتق … لم يتبنّه أحد بعد»
  // بدل رقمٍ عارٍ يُقرأ وعدًا. routePreview نفسها هي التي تفعل ذلك حين يصلها target (request-picker.mjs:95).
  const annotated={...service,target:targets.get(service.code)??null};
  return {kind:'service',key:service.code,name:service.name_ar,description:service.description,
    department_id:service.department_id,department:departments.get(service.department_id)??'',
    section:service.section??'',items:1,options:[],
    target:targetView(targets.get(service.code)),
    path:[...trail.steps,'تنفيذ'],handler:trail.handler,
    link:service.module_link??null,module_name:service.module_name??null,
    href:`#services/${service.code}`,members:[],service_id:service.id,eligible:true,eligibility_reason:null,
    preview:routePreview(annotated,list)};
}
function nameOf(row,context){
  if(row.item_kind==='module')return moduleOf(row.item_key)?.name_ar??row.item_key;
  return context.services.get(row.item_key)?.name_ar??row.item_key;
}
// رابط العضو: صفحة الخدمة لصفّ الخدمة، وشاشة الوحدة المخصصة لبند الوحدة حين يملك القارئ تصريحها. المجموعة
// لا رابط لها لأنها بلا صفحة (بابها زرّ الخيارات وحده).
function memberHref(row,context){
  if(row.item_kind==='service')return `#services/${row.item_key}`;
  if(row.item_kind==='module'){const module=moduleOf(row.item_key);return module&&(!module.capability||context.allows(module.capability))?module.href:'';}
  return '';
}

function readerContext(db,u){
  const services=annotateCatalog(db,u,catalog(db,u));
  const departments=new Map(db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id).map(d=>[d.id,d.name]));
  const targets=targetsByCode(db,u.tenant_id);
  // خدمةٌ بلا صفّ في service_directory تبقى بلا زمن في الخريطة، فيُحسب سندُها كما يفعل annotateTargets
  // بالضبط: لا تُترك بطاقةٌ بلا سند، ولا يُكتب لها رقم من مكان آخر.
  for(const service of services)if(!targets.has(service.code))
    targets.set(service.code,targetProvenance(db,u.tenant_id,service.code,{target_days:service.target_days??0,target_hours:service.target_hours??0}));
  return {services:new Map(services.map(s=>[s.code,s])),targets,departments,members:new Map(),
    allows:capability=>{try{return can(db,u,capability);}catch{return false;}},capabilityName};
}
// ملكية العرض (ت1، ق3 ود1): الإدارة التي تُعرض الخدمة في صفحتها، باسمها. تسميةٌ لا قرار — department_id كما هو.
function ownerOf(item,context){
  const id=displayDepartment(item);
  return {id,name:id===ADMIN_AFFAIRS.id?ADMIN_AFFAIRS.name:context.departments.get(id)??''};
}

/* ───── ت1: الباب الأمامي وصفحات الإدارات ─────────────────────────────────── */
// ما نُقل موضع عرضه إلى صفحة إدارته (DEPARTMENT_ONLY، د3/د4) يُبنى بطاقاتٍ كما يُبنى غيره، لكن تحت «فئةٍ» باسم إدارته لا تُرسم
// شبكةً ولا تدخل عدّاد الترويسة: يقرؤها البحث وحده (catalogEntries). المجموعة التي نُقل كل أعضائها بطاقةٌ هنا بأعضائها كلهم،
// والعضو المنقول من مجموعةٍ بقيت في الباب الأمامي بطاقةُ عضوٍ يحمل مجموعته.
function departmentOnly(view,context){
  const members=new Map();
  for(const row of view.rows.concat(view.department_rows))if(row.group_key){if(!members.has(row.group_key))members.set(row.group_key,[]);members.get(row.group_key).push(row);}
  const full={...context,members},shelves=new Map();
  for(const row of view.department_rows){
    const card=cardFor(row,full);if(!card)continue;
    const owner=ownerOf({code:card.key,department_id:card.department_id},context);
    if(!shelves.has(owner.id))shelves.set(owner.id,{key:`department:${owner.id}`,name:owner.name,department_id:owner.id,href:`#departments/${owner.id}`,department_page:true,cards:[],members:[]});
    const shelf=shelves.get(owner.id);
    if(row.item_kind==='group'||!row.group_key)shelf.cards.push(card);
    else shelf.members.push({...card,group_key:row.group_key,group_name:groupOf(row.group_key)?.name_ar??row.group_key});
  }
  return [...shelves.values()];
}
// «خدمات مختارة»: القائمة اليدوية الثابتة (FEATURED_SERVICES) محلولةً على الباب الأمامي لهذا الحساب — بطاقةً أو عضوَ مجموعة.
// ما لا يراه الحساب، أو ما نُقل إلى صفحة إدارته، لا يُرسم. لا عدّ ولا ترتيبٌ محسوب: «الأكثر طلبًا» يعود بعد بيانات حقيقية (م4).
function featuredFrom(categories){
  const found=new Map();
  for(const category of categories)for(const item of [...category.cards,...category.members])if(!found.has(item.key))found.set(item.key,item);
  return FEATURED_SERVICES.map(code=>found.get(code)).filter(item=>item&&!isDepartmentOnly(item.key))
    .map(item=>({key:item.key,kind:item.kind,name:item.name,href:item.href,description:item.description}));
}

// ما يقوله شريط الإعلان أعلى الشاشة: أي ترتيبٍ تعرضه هذه الصفحة، ومتى أُسقط، وكم بندًا ما زال بلا فئة،
// وكم خدمةً أوقفها المالك. الأربعة **أرقامٌ مستقلة**: الموقوفة لا تُطرح من العدّادين صامتةً، والبند بلا
// فئة يُقال عدده ولا يُخفى. وهذا السطر هو ما لم يكن في أيٍّ من الرسوم الخمسة، وغيابُه كان عطبًا مسمًّى.
const projectionNote=view=>({release_version:view.release_version,rebuilt_at:view.rebuilt_at,items_unplaced:view.items_unplaced,
  text:`هذه الصفحة تعرض ترتيب النسخة ${view.release_version} من شجرة الدليل${view.rebuilt_at?`، أُسقط في ${String(view.rebuilt_at).slice(0,10)}`:''}.`});

function myOpenRequests(db,u,limit=5){
  const marks=OPEN_STATUSES.map(()=>'?').join(',');
  return db.prepare(`SELECT r.id,r.title,r.status,r.updated_at,s.code AS service_code,s.name_ar AS service_name
    FROM requests r JOIN services s ON s.id=r.service_id
    WHERE r.tenant_id=? AND r.requester_id=? AND r.status IN (${marks}) ORDER BY r.updated_at DESC LIMIT ?`)
    .all(u.tenant_id,u.id,...OPEN_STATUSES,limit);
}

export function readLens(db,tenantId,userId){
  return db.prepare('SELECT last_lens,suggestions_hidden FROM catalog_preferences WHERE tenant_id=? AND user_id=?').get(tenantId,userId)??null;
}
// مرادفات الكيان بصورتها المطبَّعة، مفتاحها «النوع:الرمز»: جملةٌ واحدة، وما كتبه إنسان (curated) وما رُفع من بحث
// (from_search) بجانب ما جاء من الكود سواء — المرادف يوسّع ما يجد الخدمة أيًّا كان مصدره.
// ومرادفُ الخدمة السرّية المقترَح بيدٍ واحدة (note يبدأ بـPROPOSAL_MARK، الدفعة الرابعة) لا يقرؤه البحث حتى يؤكّده شخص ثانٍ.
export function synonymsFor(db,tenantId){
  const map={};
  for(const row of db.prepare('SELECT item_kind,item_key,normalized FROM service_synonyms WHERE tenant_id=? AND note NOT LIKE ? ORDER BY item_kind,item_key,normalized').all(tenantId,PROPOSAL_MARK+'|%'))
    (map[`${row.item_kind}:${row.item_key}`]??=[]).push(row.normalized);
  return map;
}

/* ───── «لك»: مقترحات بإشاراتٍ تملكها المنصة، وسببُ كل واحدة مكتوب ────────── */
// الدرجة تُحسب عند القراءة من الأوزان (RANKING) ولا تُخزَّن؛ والسرّي والمغلق (QUIET) لا يدخل الصفّ بأي إشارة —
// «طلبتها من قبل» على شاشةٍ قد يراها زميل تكشف واقعة. والصفّ يُخفى كله حين لا شيء يستحق، ولا يُملأ ببطاقات مخترعة.
// الإشارتان usage_30d وseasonal وزنهما صفر بقرار المالك وسببهما على شاشة الأوزان، فلا تُقرآن هنا أصلًا.
const TIMES=['مرة واحدة','مرتين','مرات','مرة'];
const FOR_YOU_LIMIT=6;
// الطلبات المقدَّمة فعلًا لكل رمز لصاحب الحساب (revision>0)، مجمَّعةً بالرمز فلا تنشقّ بعد إعادة التسمية.
export function submittedUses(db,u){
  return new Map(db.prepare(`SELECT s.code,COUNT(*) AS uses,MAX(r.created_at) AS last_at FROM requests r JOIN services s ON s.id=r.service_id
    WHERE r.tenant_id=? AND r.requester_id=? AND r.revision>0 GROUP BY s.code`).all(u.tenant_id,u.id).map(r=>[r.code,{uses:r.uses,last_at:r.last_at}]));
}
function forYou(db,u,categories,audiences,preference,facts){
  const hiddenRows=db.prepare('SELECT item_kind,item_key FROM catalog_hidden_suggestions WHERE tenant_id=? AND user_id=? ORDER BY hidden_at').all(u.tenant_id,u.id);
  const hidden=new Set(hiddenRows.map(r=>`${r.item_kind}:${r.item_key}`));
  const index=new Map();let order=0;
  for(const category of categories){
    for(const card of category.cards)index.set(`${card.kind}:${card.key}`,{card,order:order++});
    for(const member of category.members)index.set(`${member.kind}:${member.key}`,{card:member,order:order++});
  }
  const candidates=new Map();
  const add=(kind,key,signal,text,link=null)=>{
    if(kind==='service'&&QUIET.has(key))return;
    const id=`${kind}:${key}`,entry=index.get(id);
    if(!entry||!RANKING[signal])return;
    const candidate=candidates.get(id)??{id,kind,key,entry,score:0,reasons:[]};
    candidate.score+=RANKING[signal];
    candidate.reasons.push({key:signal,name:RANKING_NAMES[signal],weight:RANKING[signal],text,link});
    candidates.set(id,candidate);
  };
  for(const code of PINS)add(isGroupCode(code)?'group':'service',code,'pinned','مثبّتة من مالك الدليل');
  if(audiences.includes('manager'))for(const code of MY_TEAM_LENS)add('service',code,'audience_match','من عدسة فريقي');
  // «طلبتها N مرات» تعدّ ما **قُدّم فعلًا** (revision>0) — تعريف لوح جودة الكتالوج و«سياقك أنت» نفسه — لا المسودات التي يعدّها
  // الزرّ السريع في الرئيسية (usedServices، وسلوكه مثبَّت في اختبار مسجَّل). المسودة التي لم تُقدَّم ليست طلبًا على الخدمة.
  const submitted=submittedUses(db,u);
  for(const used of usedServices(db,u,6)){
    const mine=submitted.get(used.code);
    if(used.available&&mine)add('service',used.code,'my_usage',`طلبتها ${countNoun(mine.uses,TIMES)}، آخرها ${String(mine.last_at).slice(0,10)}`);
  }
  // رصيد الإجازة **نوعًا نوعًا وللسنة الجارية** من المصدر الذي تقرؤه بطاقة الخيارات نفسها (leaveBalanceOptions): الرقم الذي
  // يُطبع هنا هو ما تطبعه شاشة الإجازات لكل رصيد، لا مجموعًا عبر الأنواع والسنين لا تعرفه شاشة (مراجعة 23 سبتمبر).
  const balances=leaveBalanceOptions(db,u).filter(o=>Number.isFinite(o.available_days)&&o.available_days>0);
  if(balances.length){
    const year=balances.find(o=>o.balance_year)?.balance_year??null;
    add('group','VAR-LEAVE','balance',`رصيدك${year?` لسنة ${year}`:''} — ${balances.map(o=>`${o.name_ar}: ${o.unit_name==='يومًا'?countNoun(o.available_days,'day'):`${o.available_days} ${o.unit_name}`}`).join(' · ')}`);
  }
  for(const run of myJourneyRuns(db,u))if(run.status==='open')
    for(const step of db.prepare("SELECT s.item_kind,s.item_key FROM journey_run_steps s JOIN requests q ON q.id=s.child_request_id WHERE s.run_id=? AND q.status IN ('draft','returned')").all(run.id))
      add(step.item_kind,step.item_key,'journey_step_due',`خطوة مستحقة في رحلة «${run.name}»`,run.href);
  for(const candidate of candidates.values())if(candidate.entry.card.eligible===false){
    candidate.score+=RANKING.not_eligible;
    candidate.reasons.push({key:'not_eligible',name:RANKING_NAMES.not_eligible,weight:RANKING.not_eligible,text:candidate.entry.card.eligibility_reason,link:null});
  }
  const ranked=[...candidates.values()].filter(c=>!hidden.has(c.id)).sort((a,b)=>b.score-a.score||a.entry.order-b.entry.order).slice(0,FOR_YOU_LIMIT)
    .map(c=>({...c.entry.card,for_you:{score:c.score,reasons:c.reasons}}));
  const dismissed=hiddenRows.map(r=>{const entry=index.get(`${r.item_kind}:${r.item_key}`);return {kind:r.item_kind,key:r.item_key,name:entry?.card.name??r.item_key,in_tree:!!entry};});
  return {hidden_by_me:preference?.suggestions_hidden===1,items:ranked,dismissed,
    weights:rankingWeights(facts),
    note:'مقترحات من إشاراتٍ تملكها المنصة: استعمالك أنت، ورصيدك، ورحلتك المفتوحة، وعدسة فريقك. لا «الأكثر طلبًا» ولا موسم — وزنهما صفر بقرار مكتوب. والسرّي لا يدخل الصفّ.'};
}

// الموسم الجاري يعلّم بنوده شارةً خبرية «موسم: … حتى …» ولا يرفع ترتيبًا (وزنه صفر). تُطبَّق على البطاقات وأعضاء المجموعات
// في مكانها؛ وقائمة المواسم وسيطٌ ليُختبر السلوك على موسمٍ اصطناعي بلا كتابة موسمٍ مزيَّف في الكود.
export function markSeasons(categories,seasons){
  const live=new Map();
  for(const season of seasons)for(const code of season.items??[])if(!live.has(code))live.set(code,{key:season.key,name:season.name_ar,until:season.to,calendar:season.calendar});
  for(const category of categories)for(const item of [...category.cards,...category.members])item.season=live.get(item.key)??null;
  return categories;
}

/* ───── سجل البحث: ما بحث عنه الناس ولم يجدوه، بلا هوية ─────────────────────── */
// ثلاثة أحداث لجلسة بحثٍ واحدة يربطها معرّفٌ عشوائي يولّده المتصفح: searched (السؤال وعدد نتائجه) ثم opened (أي بطاقة
// وبأي مرتبة) ثم submitted (أي بند صار طلبًا). **لا user_id ولا department_id**، والجمهور وحده يُكتب. والنص يمرّ
// بحاجب app/pii.mjs ثم يُطبَّع فلا يُحفظ جوالٌ ولا بريد كُتب سهوًا في صندوق البحث.
// وعدد النتائج **يعدّه الخادم** بترتيب المتصفح نفسه (rankCatalog على الشجرة نفسها) لا بما يقوله المتصفح، فلا يُسجَّل
// «بلا نتيجة» بحثٌ وجد شيئًا ولا العكس. والسرّي والمغلق (CONFIDENTIAL_SERVICES, CLOSED_CIRCLE_SERVICES) يُبحث فيهما
// ولا يُسجَّل بحثهما: بحثٌ أصاب واحدًا منهما، أو فتحٌ أو تقديمٌ عليه، يُتخطّى بصمت — لا خطأ يُرى ولا صفّ يُكتب.
export const SEARCH_EVENTS=Object.freeze(['searched','opened','submitted']);
const QUIET=new Set([...CONFIDENTIAL_SERVICES,...CLOSED_CIRCLE_SERVICES]);
const isQuiet=item=>item?.kind==='service'&&QUIET.has(item.key);
export function logSearchEvent(db,supplied,input){
  const u=actorOrRefuse(db,supplied);
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لا يُكتب سجل البحث خارج معاملة قاعدة بيانات',
    missing:[{document:'معاملة قاعدة بيانات',why:'كل كتابة في المنصة تجري داخل معاملة واحدة',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'أعد المحاولة من شاشة مركز الخدمات'});
  v.object(input,['search_id','event','query','result_count','item_kind','item_key','position']);
  const searchId=String(input.search_id??'');
  if(!/^[0-9a-f]{32}$/.test(searchId))refuse(400,'search_id',{what:'معرّف جلسة البحث ليس اثنين وثلاثين خانة ست عشرية',
    missing:[{document:'معرّف عشوائي يولّده المتصفح لكل جلسة بحث',why:'هو ما يربط أحداث البحث الواحد بلا هوية',owner:'شاشة مركز الخدمات',owner_role:'requests.use'}],
    next:'أعد فتح مركز الخدمات؛ الشاشة تولّد المعرّف بنفسها'});
  const event=String(input.event??'');
  if(!SEARCH_EVENTS.includes(event))refuse(400,'event',{what:`«${event||'بلا قيمة'}» ليس حدثًا في سجل البحث`,
    missing:[{document:`أحد الأحداث: ${SEARCH_EVENTS.join('، ')}`,why:'الأحداث الثلاثة محروسة بقيد في الجدول',owner:'شاشة مركز الخدمات',owner_role:'requests.use'}],
    next:'أعد فتح مركز الخدمات'});
  const audience=audiencesFor(u).at(-1);
  const raw=typeof input.query==='string'?input.query:'';
  if(raw.length>200)refuse(400,'query',{what:'نص البحث يتجاوز مئتي حرف',missing:[],next:'اختصر ما كتبته في صندوق البحث'});
  const query=normalize(redact(raw).text);
  const at=now();
  if(event==='searched'){
    if(!query)return {logged:false,why:'بحث فارغ'};
    // العدّ بترتيب الشاشة نفسه على شجرة هذا الحساب: ما يقع فيه بندٌ سرّي لا يُكتب.
    const tree=catalogTree(db,u),hits=rankCatalog(tree,tree.synonyms,raw);
    if(hits.some(hit=>isQuiet(hit.item)))return {logged:false,why:'أصاب البحث بندًا سرّيًا أو مغلق الدائرة'};
    db.prepare('INSERT INTO catalog_search_log(tenant_id,search_id,event,audience,query_normalized,result_count,item_kind,item_key,position,at) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?)')
      .run(u.tenant_id,searchId,event,audience,query,hits.length,at);
    return {logged:true,result_count:hits.length};
  }
  const kind=String(input.item_kind??''),key=String(input.item_key??'').trim();
  if(!['service','module','benefit','group'].includes(kind)||key.length<2||key.length>60)refuse(400,'item',{what:'البند المفتوح بلا نوع أو رمز صالح',
    missing:[{document:'نوع البند ورمزه كما في بطاقة الدليل',why:'حدثا الفتح والتقديم يحملان بندًا',owner:'شاشة مركز الخدمات',owner_role:'requests.use'}],next:'أعد فتح مركز الخدمات'});
  if(isQuiet({kind,key}))return {logged:false,why:'بند سرّي أو مغلق الدائرة لا يُسجَّل'};
  const position=input.position===undefined||input.position===null?null:Number(input.position);
  if(position!==null&&(!Number.isInteger(position)||position<1||position>200))refuse(400,'position',{what:'مرتبة النتيجة خارج المدى 1–200',missing:[],next:'أعد فتح مركز الخدمات'});
  db.prepare('INSERT INTO catalog_search_log(tenant_id,search_id,event,audience,query_normalized,result_count,item_kind,item_key,position,at) VALUES(?,?,?,?,?,NULL,?,?,?,?)')
    .run(u.tenant_id,searchId,event,audience,query,kind,key,position,at);
  return {logged:true};
}

/* ───── شاشة الدليل وصفحة الفئة: حمولة واحدة، عدّادها من جملة واحدة ─────────── */

export function catalogTree(db,supplied){
  const u=actorOrRefuse(db,supplied);
  const audiences=audiencesFor(u);
  // الإسقاط كما يراه الحساب (placementFor)، ثم الباب الأمامي منه (ت1): الأربعون المنقولة إلى صفحات إداراتها تُرفع من الشبكة
  // والعدّادات و«لك» و«خدمات مختارة»، وتبقى للبحث في department_only. شرط الظهور نفسه لم يُمسّ.
  const view=frontDoorView(placementFor(db,u.tenant_id,audiences,gatesFor(db,u)));
  const context=readerContext(db,u);
  for(const row of view.rows)if(row.group_key){
    if(!context.members.has(row.group_key))context.members.set(row.group_key,[]);
    context.members.get(row.group_key).push(row);
  }
  const categories=view.categories.map(category=>{
    const cards=category.rows.filter(r=>r.browse===1).map(row=>cardFor(row,context)).filter(Boolean);
    // أعضاء المجموعات (browse=0) بطاقاتٍ كاملة للبحث وحده (الدفعة الثالثة): من يبحث عن «تعريف بنك» يصل «تعريف بالراتب»
    // بزرّ بدئها هي — ضغطتان — لا بطاقة «خطاب» ثم الخيار. لا تُرسم في الشبكة ولا تدخل عدّاد البطاقات: هي البنود نفسها
    // التي عُدّت في items تحت مجموعتها، وتحمل مفتاح مجموعتها واسمها ليُقال «تُبلَغ أيضًا من بطاقة …».
    const members=category.rows.filter(r=>r.browse===0&&r.item_kind!=='group').map(row=>{
      const card=cardFor(row,context);if(!card)return null;
      return {...card,group_key:row.group_key,group_name:groupOf(row.group_key)?.name_ar??row.group_key};}).filter(Boolean);
    return {key:category.key,name:category.name_ar,name_en:category.name_en,icon:category.icon,
      description:category.description,position:category.position,cards,members,
      // العدّادان من الصفوف نفسها التي بُنيت منها البطاقات، فلا جملة ثانية ولا رقمان يفترقان.
      cards_count:category.cards,items:category.items,
      drawn_items:cards.reduce((n,card)=>n+card.items,0)};
  });
  const preference=readLens(db,u.tenant_id,u.id);
  const lens=preference?.last_lens??DEFAULT_LENS;
  const department_only=departmentOnly(view,context);
  // الموسم بيوم الرياض: seasonFor تقرأ الشهر واليوم من Date بـUTC، فتُعطى يوم الرياض نصًّا لا لحظة الآن.
  markSeasons(categories,seasonFor(riyadhToday()));
  // الحقائق المقيسة مرةً واحدة للحمولة كلها: تُحقن في نصوص الغياب وفي سبب الوزن الصفري.
  const facts=catalogFacts(db,u.tenant_id);
  const suggestions=forYou(db,u,categories,audiences,preference,facts);
  // «فريقي» عدسةٌ على التعريف نفسه لا فئةٌ تاسعة: بطاقاتها مسرودة بأسمائها، وموسومة بأنها عُدّت في فئاتها.
  const teamLens=audiences.includes('manager')
    ?{note:MY_TEAM_NOTE,items:MY_TEAM_LENS.map(code=>{
        const service=context.services.get(code);
        return service?{key:code,name:service.name_ar,href:`#services/${code}`}:null;}).filter(Boolean)}
    :null;
  // مخرج «لم تجد خدمتك؟»: اسم الخدمة يصل من صفّها الحيّ لا من نصٍّ مكتوب في الشاشة — أُعيدت تسميتها مرة
  // («ملاحظة على المنصة أو اقتراح خدمة» ← «اقتراح تحسين على المنصة»)، والاسم المكتوب في شاشة يكذب بعد الثانية.
  // ومن لا يراها (موقوفة، أو خارج جمهوره) لا يُعطى رابطًا إلى بابٍ مغلق: يصل null فتسقط الجملة إلى الفئات.
  const feedback=context.services.get(FEEDBACK_SERVICE);
  return {audiences,lens,lenses:LENSES,
    suggestions_hidden:preference?.suggestions_hidden===1,
    totals:view.totals,categories,
    // ت1: خدمات صفحات الإدارات (د3/د4) للبحث وحده، ورقمُها يُقال بجوار الترويسة لا يُطرح صامتًا.
    department_only,department_only_items:department_only.reduce((n,shelf)=>n+shelf.members.length+shelf.cards.filter(card=>card.kind!=='group').length,0),
    featured:featuredFrom(categories),
    // مرادفات البنود بصورتها المطبَّعة (service_synonyms، من الكود وممّا كتبه إنسان): يقرؤها ترتيب البحث في المتصفح
    // (app/static/catalog-search.mjs) والخادم بالجملة نفسها. نحو تسعمئة سلسلة قصيرة.
    synonyms:synonymsFor(db,u.tenant_id),
    // الرقم الثالث المستقل: ما أوقفه المالك لا يدخل أيًّا من العدّادين ولا يُطرح بالصمت — ويُعدّ **لجمهور القارئ**:
    // خدمةٌ موقوفة لجمهورٍ لا يشمله لم تكن في دليله أصلًا فلا تُقال له «موقوفة» (مراجعة 23 سبتمبر).
    hidden_services:hiddenServiceCountFor(db,u.tenant_id,audiences),
    projection:projectionNote(view),my_team:teamLens,
    // «لك» بأسبابه، و«حسب الرحلة» بحمولتها حين تكون هي العدسة (الدفعة الرابعة).
    for_you:suggestions,
    journeys:lens==='journey'?journeyLens(db,u):null,
    feedback_service:feedback?{code:feedback.code,name:feedback.name_ar,href:`#services/${feedback.code}`}:null,
    open_requests:myOpenRequests(db,u),
    facts,
    gaps:{home:unavailableFor(db,u.tenant_id,SCREEN_GAPS.home,facts),category:unavailableFor(db,u.tenant_id,SCREEN_GAPS.category,facts),
      card:unavailableFor(db,u.tenant_id,SCREEN_GAPS.card,facts),form:unavailableFor(db,u.tenant_id,SCREEN_GAPS.form,facts)},
    note:'الترويسة هي مجموع بطاقات الفئات من الجملة نفسها، والموقوف يُذكر رقمًا ثالثًا مستقلًا. وما لا يُعرض هنا مكتوبٌ سببه في «غير متاح» لا مسكوتٌ عنه.'};
}

// كتابة التفضيل: عدسةٌ واحدة لكل حساب، بلا سبب ولا مُقرِّر ولا سجل — تفضيلٌ شخصيّ لا قرارَ منظمة،
// وحفظُ تاريخ ما اختاره شخصٌ لشاشته مراقبةٌ بلا غرض (تعليق الترحيل 131 نفسه).
export function setLens(db,supplied,input){
  const u=actorOrRefuse(db,supplied);
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لا يُحفظ تفضيل العدسة خارج معاملة قاعدة بيانات',
    missing:[{document:'معاملة قاعدة بيانات',why:'كل كتابة في المنصة تجري داخل معاملة واحدة',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'أعد المحاولة من شاشة مركز الخدمات'});
  v.object(input,['lens']);
  const lens=String(input.lens??'');
  if(!LENSES.includes(lens))refuse(400,'lens',{what:`«${lens||'بلا قيمة'}» ليست عدسةً في مركز الخدمات`,
    missing:[{document:`إحدى العدسات: ${LENSES.join('، ')}`,why:'العدسات مكتوبة في الكود ومحروسة بقيد في الجدول',owner:'من يملك إعداد الخدمات',owner_role:CAPABILITY}],
    next:'اختر العدسة من أزرار الشاشة لا من الرابط'});
  db.prepare(`INSERT INTO catalog_preferences(tenant_id,user_id,suggestions_hidden,last_lens,updated_at) VALUES(?,?,0,?,?)
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET last_lens=excluded.last_lens,updated_at=excluded.updated_at`)
    .run(u.tenant_id,u.id,lens,now());
  return {lens};
}

// «لا تقترح هذه عليّ» / «اقترحها من جديد»: صفٌّ يُدرَج أو يُحذف في catalog_hidden_suggestions. بلا حدث تدقيق عمدًا
// (تعليق الترحيل 131): تفضيلٌ شخصي لا قارئ له غير صاحبه، وحفظ تاريخ ما أخفاه شخص عن شاشته مراقبةٌ بلا غرض.
const SUGGESTION_KINDS=['service','module','benefit','group'];
export function hideSuggestion(db,supplied,input){
  const u=actorOrRefuse(db,supplied);
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لا يُحفظ تفضيل الاقتراح خارج معاملة قاعدة بيانات',
    missing:[{document:'معاملة قاعدة بيانات',why:'كل كتابة في المنصة تجري داخل معاملة واحدة',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'أعد المحاولة من شاشة مركز الخدمات'});
  v.object(input,['item_kind','item_key','hidden']);
  const kind=String(input.item_kind??''),key=String(input.item_key??'').trim();
  if(!SUGGESTION_KINDS.includes(kind)||key.length<2||key.length>60)refuse(400,'item',{what:'البند بلا نوع أو رمز صالح',
    missing:[{document:'نوع البند ورمزه كما في بطاقة «لك»',why:'التفضيل يُربط ببندٍ بعينه',owner:'شاشة مركز الخدمات',owner_role:'requests.use'}],next:'استعمل زرّ البطاقة نفسه لا الرابط'});
  if(input.hidden===false||input.hidden===0){
    db.prepare('DELETE FROM catalog_hidden_suggestions WHERE tenant_id=? AND user_id=? AND item_kind=? AND item_key=?').run(u.tenant_id,u.id,kind,key);
    return {item_kind:kind,item_key:key,hidden:false};
  }
  db.prepare('INSERT INTO catalog_hidden_suggestions(tenant_id,user_id,item_kind,item_key,hidden_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').run(u.tenant_id,u.id,kind,key,now());
  return {item_kind:kind,item_key:key,hidden:true};
}
// «أخفِ المقترحات» للصفّ كله، وضدّها: عمود suggestions_hidden في تفضيلات الحساب.
export function setSuggestionsHidden(db,supplied,input){
  const u=actorOrRefuse(db,supplied);
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لا يُحفظ تفضيل الصفّ خارج معاملة قاعدة بيانات',
    missing:[{document:'معاملة قاعدة بيانات',why:'كل كتابة في المنصة تجري داخل معاملة واحدة',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'أعد المحاولة من شاشة مركز الخدمات'});
  v.object(input,['hidden']);
  const hidden=input.hidden===true||input.hidden===1?1:0;
  // صفّ التفضيل الأول يُكتب بالعدسة الافتراضية نفسها (DEFAULT_LENS)، فلا يصير إخفاءُ المقترحات اختيارًا صامتًا لعدسة.
  db.prepare(`INSERT INTO catalog_preferences(tenant_id,user_id,suggestions_hidden,last_lens,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(tenant_id,user_id) DO UPDATE SET suggestions_hidden=excluded.suggestions_hidden,updated_at=excluded.updated_at`).run(u.tenant_id,u.id,hidden,DEFAULT_LENS,now());
  return {hidden:hidden===1};
}

/* ───── صفحة الخدمة: تسعة أقسام، كلٌّ من بياناته أو مكتوبٌ غيابُه ──────────── */

// ما الذي يحيط بالطالب الآن: مديره وإدارته وآخر طلبٍ قدّمه على الخدمة نفسها بحالته. الثلاثة مقروءة من
// جداول قائمة، ولا يُكتب منها شيء لم يُقرأ — ولا تُنسخ قيم طلبٍ سابق إلى نموذج جديد: مسار النسخ الوحيد
// في المنصة اليوم هو إعادة تقديم المنقضي، وتعميمه مسارٌ لا تحمله هذه الدفعة.
// «طلبٌ سابق» هنا هو ما **قُدّم فعلًا** (revision>0) — التعريف نفسه الذي يعدّ به لوح جودة الكتالوج «الطلبات المقدمة فعلًا»
// وتعدّ به «طلبتها N مرات» في «لك» (usedServices). المسودة التي لم تُقدَّم ليست طلبًا على الخدمة (مراجعة 23 سبتمبر).
function readerFacts(db,u,code){
  const manager=u.manager_id?db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(u.manager_id,u.tenant_id)?.name??null:null;
  const department=u.department_id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(u.department_id,u.tenant_id)?.name??null:null;
  const previous=db.prepare(`SELECT r.id,r.status,r.created_at FROM requests r JOIN services s ON s.id=r.service_id
    WHERE r.tenant_id=? AND r.requester_id=? AND s.code=? AND r.revision>0 ORDER BY r.created_at DESC LIMIT 1`).get(u.tenant_id,u.id,code)??null;
  const earlier=db.prepare(`SELECT COUNT(*) AS n FROM requests r JOIN services s ON s.id=r.service_id
    WHERE r.tenant_id=? AND r.requester_id=? AND s.code=? AND r.revision>0`).get(u.tenant_id,u.id,code).n;
  return {manager_name:manager,department_name:department,earlier_requests:earlier,
    last_request:previous?{id:previous.id,status:previous.status,on:String(previous.created_at).slice(0,10)}:null};
}

// «خدمات قريبة» اشتقاقًا لا بجدول علاقات مخترع، وبترتيبٍ له معنى: **أخوة المجموعة أولًا** (الخيارات التي تُبلَغ من
// البطاقة نفسها، فهي أقرب ما يكون إلى «كنت أقصد غيرها») **كلُّهم بلا سقف** — إسقاط الأخ الثامن كان يُخفي صفحة ADM-WORKSPACE
// عن كل أخوته (مراجعة 23 سبتمبر) — ثم بطاقات الفئة نفسها ستةً على الأكثر، ما عدا بطاقة المجموعة التي تسكنها هذه الخدمة:
// فقد ذُكرت في سطر «تُبلَغ أيضًا من بطاقة …» ولا تُذكر مرتين.
// والعضو الذي لا رابط له (وحدة مخصصة بلا تصريح) لا يُسرد: سطرٌ بلا باب نهايةٌ مسدودة لا خدمةٌ قريبة. والمجموعة القريبة
// تحمل بابها معها: نافذة الخيارات، أو شاشة وحدتها حين تكون أعضاؤها وحداتٍ وحدها، أو تعطيلها بسببه.
// ت1: القريب يبقى في موضع الخدمة نفسه — خدمة الباب الأمامي لا تسرد ما نُقل إلى صفحات الإدارات (view هنا الباب الأمامي)، وخدمة
// صفحة الإدارة تسرد أخوة مجموعتها ثم ما نُقل معها من فئتها (view الإسقاط كاملًا، وkeep يقصر الفئة على المنقول).
function nearbyOf(view,placement,code,context,keep=()=>true){
  if(!placement)return [];
  const members=new Map();
  for(const row of view.rows)if(row.group_key){if(!members.has(row.group_key))members.set(row.group_key,[]);members.get(row.group_key).push(row);}
  const fromGroup=placement.group_key
    ?(members.get(placement.group_key)??[]).filter(r=>r.item_key!==code).map(row=>({kind:row.item_kind,key:row.item_key,name:nameOf(row,context),href:memberHref(row,context),from:'group'}))
    :[];
  const fromCategory=view.rows.filter(r=>r.category_key===placement.category_key&&r.browse===1&&r.item_key!==code&&r.item_key!==placement.group_key&&keep(r))
    .map(row=>{const drawn=cardFor(row,{...context,members});return drawn?{kind:drawn.kind,key:drawn.key,name:drawn.name,href:drawn.href,items:drawn.items,from:'category',
      link:drawn.link??null,module_name:drawn.module_name??null,eligible:drawn.eligible!==false,eligibility_reason:drawn.eligibility_reason??null}:null;});
  return [...fromGroup.filter(item=>item.href),...fromCategory.filter(item=>item&&(item.href||item.kind==='group')).slice(0,NEARBY_LIMIT)];
}

// المستندات: من خيار المجموعة الذي يشير إلى هذه الخدمة، ومن عمود بطاقة التعريف المنشورة. لا يُخترع بند.
function documentsFor(code,published){
  const fromCard=(()=>{try{return JSON.parse(published?.required_documents??'[]');}catch{return [];}})();
  const fromOption=SERVICE_VARIANTS.flatMap(group=>Array.isArray(group.options)?group.options.filter(o=>o.service===code).flatMap(o=>o.docs??[]):[]);
  return [...new Set([...fromCard.filter(x=>typeof x==='string'&&x.trim()),...fromOption])];
}

export function servicePage(db,supplied,code){
  const u=actorOrRefuse(db,supplied);
  const wanted=String(code??'').toUpperCase();
  const audiences=audiencesFor(u);
  const view=placementFor(db,u.tenant_id,audiences,gatesFor(db,u)),front=frontDoorView(view);
  const context=readerContext(db,u);
  const service=context.services.get(wanted);
  // الموقوفة بـ129 لا تُعرض للطالب أصلًا، فلا يبلغ صفحتها من التصفّح. ومن بلغها برابطٍ قديم يقرأ سبب
  // الإيقاف بنصّه ومن يعيد التفعيل — لا «الخدمة غير متاحة».
  if(!service&&isHidden(db,u.tenant_id,'service',wanted)){
    const name=db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(u.tenant_id,wanted)?.name_ar??wanted;
    refuseHidden(db,u.tenant_id,'service',wanted,name);
  }
  if(!service){
    const owners=switchOwners(db,u.tenant_id);
    refuse(404,'not_available',{what:`لا تُفتح صفحة «${wanted}» بحسابك: هذه الخدمة ليست في دليلك`,
      missing:[{document:'خدمة في دليل حسابك برمز صحيح',
        why:'إمّا أن الرمز غير موجود، وإمّا أن هذه الخدمة لجمهور آخر لا يشمل حسابك — وشرط الظهور واحد في التصفّح والبحث معًا',
        owner:owners.length?owners.map(o=>o.name).join('، '):'مسؤول المنصة',owner_role:CAPABILITY}],
      next:'ارجع إلى مركز الخدمات وابحث بحاجتك بكلماتك، أو اطلب من مالك الدليل إتاحة هذه الخدمة لجمهورك',
      link:'#services'});
  }
  const placement=view.rows.find(r=>r.item_key===wanted&&r.item_kind==='service')??null;
  // ت1: خدمةٌ نُقل موضع عرضها إلى صفحة إدارتها (د3/د4) تُفتح برابطها المباشر كما كانت، وطريقها في الصفحة إلى إدارتها لا إلى فئة.
  const departmentOnly=isDepartmentOnly(wanted),owner=ownerOf(service,context);
  const category=departmentOnly?null:CATEGORIES.find(c=>c.key===placement?.category_key)??null;
  const group=placement?.group_key?groupOf(placement.group_key):null;
  const detail=serviceCard(db,u,wanted);
  const published=detail.published??null;
  const documents=documentsFor(wanted,published);
  const moved=new Set(front.department_rows);
  const siblings=departmentOnly?nearbyOf(view,placement,wanted,context,row=>moved.has(row)):nearbyOf(front,placement,wanted,context);
  const target=targetView(context.targets.get(wanted));
  const facts=catalogFacts(db,u.tenant_id);
  const gaps=unavailableFor(db,u.tenant_id,SCREEN_GAPS.page.filter(key=>{
    if(key==='documents')return documents.length===0;
    if(key==='policy')return !String(published?.policy_reference??'').trim();
    if(key==='faq'){try{return JSON.parse(published?.faq??'[]').length===0;}catch{return true;}}
    if(key==='eligibility'){try{return Object.keys(JSON.parse(published?.eligibility_rules??'{}')).length===0;}catch{return true;}}
    return true;}),facts)
    // مادّة البطاقة التي لم تُكتب (ت1): «لم يُكتب بعد. يكمله: <الإدارة المالكة>» — منصبٌ أو إدارة لا اسم شخص. منطق الغياب كما هو.
    // الشؤون الإدارية وحدة عرض بلا صفّ في departments ولا أحد يكتب باسمها: يكملها منفّذها المؤقت (مكتب الرئيس التنفيذي).
    .map(gap=>DRAFT_GAPS.includes(gap.key)&&owner.name?{...gap,pending:`لم يُكتب بعد. يكمله: ${owner.id===ADMIN_AFFAIRS.id?'مكتب الرئيس التنفيذي (منفّذ مؤقت)':owner.name}`}:gap);
  const [compliance]=unavailableFor(db,u.tenant_id,['compliance'],facts);
  const home=departmentOnly
    ?{label:owner.name,href:`#departments/${owner.id}`}
    :category?{label:category.name_ar,href:`#services/category/${category.key}`}:null;
  return {code:wanted,name:service.name_ar,description:service.description,
    breadcrumb:[{label:'الخدمات',href:'#services'},...(home?[home]:[]),{label:service.name_ar,href:''}],
    category:category?{key:category.key,name:category.name_ar}:null,
    // طريق العودة من الشريط الملتصق: الفئة، أو صفحة الإدارة لما نُقل إليها، أو «الخدمات».
    back:departmentOnly?{label:'العودة إلى صفحة الإدارة',href:`#departments/${owner.id}`}
      :category?{label:'العودة إلى الفئة',href:`#services/category/${category.key}`}:{label:'العودة إلى الخدمات',href:'#services'},
    placement:departmentOnly?{kind:'department',text:`تُعرض هذه الخدمة في صفحة «${owner.name}» ضمن خدماتها، لا في «حسب الحاجة». رابطها المباشر يبقى كما هو.`,href:`#departments/${owner.id}`}:{kind:'front'},
    owner:{id:owner.id,name:owner.name,interim:interimExecutor(service)},
    group:group?{key:group.code,name:group.name_ar}:null,
    department:context.departments.get(service.department_id)??'',section:service.section??'',
    // «ابدأ الطلب»: نموذج عام، أو شاشة التشغيل التي تنفّذ العمل فعلًا حين تكون جاهزة لهذا الحساب.
    start:{service_id:service.id,module_link:service.module_link??null,module_name:service.module_name??null,
      card_module:detail.service.module??null},
    facts:readerFacts(db,u,wanted),
    // حقول التعريف بتسمياتها كما يراها الطالب في النموذج: معجم سجل التعريفات يُطبَّق هنا كما يُطبَّق في /api/catalog.
    inputs:termApplier(db,u.tenant_id)(enrichFields(wanted,service.fields)),
    documents,
    workflow:detail.service.workflow,escalates_to:detail.service.escalates_to,
    lifecycle:detail.service.lifecycle,clock:detail.service.clock,audit_note:detail.service.audit,
    target,
    // **لا نسبة، ولا صفر، ولا فراغ**: نصٌّ يقول لماذا لا تُعرض وما يلزم قبل أول عرض — بالرقم المقيس لحظته لا المكتوب.
    compliance:{shown:false,...compliance},
    policy_reference:String(published?.policy_reference??'').trim()||null,
    readiness:detail.readiness,
    // صفر بطاقة تعريف منشورة اليوم: يُقال للطالب بصيغته لا بصيغة معدّ الدليل.
    documented:!!published,
    documentation_note:published?'تفاصيل هذه الصفحة من بطاقة تعريف اعتمدها مالك الإجراء.'
      :'تفاصيل هذه الخدمة لم يعتمدها مالكها بعد؛ ما تراه مشتقّ من تعريفها في النظام.',
    nearby:siblings,gaps,
    stopped_note:isHidden(db,u.tenant_id,'service',wanted)?stopNote(db,u.tenant_id,'service',wanted):null,
    derived_mark:DERIVED_MARK};
}
