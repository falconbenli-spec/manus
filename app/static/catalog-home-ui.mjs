// مركز الخدمات — شاشة الدليل وصفحة الفئة وبطاقة الدليل (الدفعة الثانية).
//
// **تسمية محسومة هنا ولا تُنقض بعدها:** `service_cards` (ترحيل 045) تبقى «بطاقة التعريف» باسمها وكيانها
// وشاشتها؛ وعنصرُ التصفّح في هذا الملف اسمه «بطاقة الدليل». لا كيان يُعاد تسميته، ولا مكوّن موازٍ يُنشأ:
// البطاقة هنا مكوّنٌ **واحد** يرسم الأنماط الثلاثة (خدمة، مجموعة خيارات، وحدة بشاشة مخصصة) بوسيطٍ لا
// بأربع نسخ، وتقرؤه الفئة ونتيجة البحث وعدسة «فريقي» سواء.
//
// وأربع قواعد رسمٍ مفروضة في هذا الملف:
//   (1) **كل موضع يطبع زمنًا يطبع سنده بجواره** (`target.kind_name`)، والرقم لا يُنطق عاريًا لقارئ الشاشة:
//       `aria-label` تحمل العبارة الكاملة من `targetLabel`.
//   (2) **لا نسبة التزام في أي موضع**: ما لا تحسبه المنصة بصدق يُرسم «غير متاح» بسببه وبما يلزمه.
//   (3) **عدّاد الترويسة هو مجموع البطاقات**: كلاهما من حمولةٍ واحدة بناها استعلامٌ واحد، وتختبره
//       tests/catalog-home.test.mjs على HTML المرسومة نفسها لا على الحمولة.
//   (4) **بطاقتان في ترتيب Tab**: الجسم يفتح صفحة الخدمة، و«ابدأ الطلب» يقفز إلى النموذج. هذا ما يحفظ
//       «الضغطتين» لمن يعرف ما يريد مع «اشرح قبل أن تسأل» لمن لا يعرف.
//
// العدّة من ctx.ui (app/static/kit.mjs) وحدها، والعبارات من app/static/vocabulary.mjs وحده، والأصناف
// القائمة (`rq-*`, `panel*`, `badge`, `btn`, `subtle`) كما هي. ولا نمط سطري ولا سكربت سطري (CSP).
import { countNoun } from './arabic-count.mjs';
import { icon, categoryIcon, CATEGORY_ICONS } from './icons.mjs';
import { metaFor, normalizeArabic, launcherResults, launcherShelves, departmentRail, departmentServices, displayDepartment, INTERIM_EXECUTOR } from './request-picker.mjs';
import { searchCatalog, directAnswer } from './catalog-search.mjs';
import { placeFor, NAV_DEST, ADMIN_ALT, NO_PAGE_ALT } from './nav-map.mjs';

export const SORT_KEYS=Object.freeze(['tree','name','time']);
export const SORT_NAMES=Object.freeze({tree:'ترتيب الشجرة',name:'الاسم',time:'الأقصر زمنًا'});
export const LENS_KEYS=Object.freeze(['need','department','journey']);
export const LENS_NAMES=Object.freeze({need:'حسب الحاجة',department:'حسب الإدارة',journey:'حسب الرحلة'});
// صور العدد للأسماء التي لا تسكن NOUNS (arabic-count.mjs): تمييزٌ عربي صحيح لا «8 فئة» ولا «62 بطاقة».
const CATEGORY_NOUN=['فئة واحدة','فئتان','فئات','فئة'],CARD_NOUN=['بطاقة واحدة','بطاقتان','بطاقات','بطاقة'],GAP_NOUN=['بندٌ واحد','بندان','بنود','بندًا'];
const JOURNEY_NOUN=['رحلة واحدة','رحلتان','رحلات','رحلة'],STEP_NOUN=['خطوة واحدة','خطوتان','خطوات','خطوة'];
// شارة الموسم خبرٌ لا ترتيب (وزنه صفر): «موسم: رمضان حتى 09-30» بتقويم الموسم نفسه.
const seasonText=season=>season?`موسم: ${season.name} حتى ${season.until}`:'';
// رمزٌ يمثّل الشيء لا الإدارة: رسوم من مكتبة الأيقونات الواحدة (icons.mjs، لغة SF البصرية بقرار
// المالك 1 أكتوبر 2026) وعليها aria-hidden، والمعنى في النص بجوارها لا فيها.
const glyphFor=key=>categoryIcon(key);
const cardCount=n=>countNoun(n,CARD_NOUN);

// شارة الزمن: الكمية ومعها حالُ الزمن حين لا يكون التزامًا تبنّاه أحد. الشارة ضيقة، والعبارة الكاملة
// تُقال في aria-label وفي صفحة الخدمة — فلا يُترك الرقم عاريًا في أيٍّ منهما.
const timeChip=target=>!target||target.kind==='unset'?'':target.adopted?target.amount:`${target.amount} · إرشادي`;
// وصفُ البطاقة لقارئ الشاشة، جملةً واحدة: الاسم، الوصف، المسار، ثم الزمن **بسنده كاملًا**.
// وبطاقة «لك» تنطق سببها («مقترحة لأن: طلبتها 3 مرات») لا الاسم وحده، وشارة الموسم تُقرأ حين تكون.
const cardLabel=item=>[item.name,item.description,
  item.path.length?`مسار الاعتماد: ${item.path.join(' ← ')}`:'',
  item.target&&item.target.kind!=='unset'?`الزمن المستهدف ${item.target.label}`:'',
  seasonText(item.season),
  item.kind==='group'?`${countNoun(item.items,'service')} داخل هذه المجموعة، لكلٍّ صفحتها: ${item.options.join('، ')}`:'',
  item.for_you?`مقترحة لأن: ${item.for_you.reasons.map(r=>r.text).join('؛ ')}`:'',
  item.eligible===false?`لا يُفتح منها طلب بحسابك الآن: ${item.eligibility_reason}`:''].filter(Boolean).join(' — ');
// أعضاء المجموعة في جسم بطاقتها **كلُّهم**، وكلُّ عضو له صفحة يصير رابطًا إليها — فصفحةُ الخيار على بُعد ضغطة من الفئة
// لا ثلاث. العضو بلا رابط (وحدة مخصصة بلا تصريح) يُكتب اسمه نصًّا. ولا سقف (مراجعة 23 سبتمبر): «وثلاث خدمات أخرى» نصًّا
// كانت تترك تسعة أعضاء بلا رابط من فئتهم، وصفحة ADM-WORKSPACE بلا رابط من أي شاشة تصفّح.
function memberList(item,e){
  const members=(item.members??[]).length?item.members:item.options.map(name=>({name,href:''}));
  return members.map(m=>m.href?`<a href="${e(m.href)}">${e(m.name)}</a>`:e(m.name)).join('، ');
}

// زر البدء. ثلاثة أبواب لا باب واحد، وكلها قائمة اليوم: نافذة الخيارات للمجموعة (data-action="pick-variant"
// وهو المعالج نفسه في app.mjs)، وشاشة الوحدة المخصصة حين تكون هي التي تنفّذ العمل، والنموذج العام.
// والبابُ المغلق لا يُرسم زرًّا ميتًا: يُرسم معطّلًا بسببه المكتوب.
// والمجموعة التي أعضاؤها وحداتٌ مخصصة وحدها («إجازة») تحمل link شاشتها من الخادم فيُرسم بابها رابطًا لا نافذة خيارات: نافذة
// الخيارات تُبنى من variantCatalog الذي يُسقطها بلا رصيد، فكان زرّها يُردّ بخطأ عارٍ لكل حساب مبذور (مراجعة 23 سبتمبر).
function startButton(item,e){
  if(item.eligible===false)return `<span class="btn outline small" aria-disabled="true">ابدأ الطلب<small class="subtle"> — ${e(item.eligibility_reason)}</small></span>`;
  if(item.kind==='group'&&!item.link)return `<button type="button" class="btn dark small" data-action="pick-variant" data-group="${e(item.key)}" aria-label="${e(`ابدأ الطلب: ${item.name} — اختر النوع أولًا`)}">ابدأ الطلب</button>`;
  if(item.link)return `<a class="btn dark small" href="${e(item.link)}" aria-label="${e(`ابدأ الطلب: ${item.name}${item.module_name?` — يُقدَّم من «${item.module_name}»`:''}`)}">ابدأ الطلب</a>`;
  return `<button type="button" class="btn dark small" data-action="pick-service" data-id="${e(item.service_id)}" aria-label="${e(`ابدأ الطلب: ${item.name}`)}">ابدأ الطلب</button>`;
}

// ── بطاقة الدليل ─────────────────────────────────────────────────────────────
// هدفان متتاليان في ترتيب Tab: الجسم ← صفحة الخدمة، و«ابدأ الطلب» ← النموذج. الشارات ليست أهدافًا
// (`.sc-chips > *{pointer-events:none}`) فلا تسرق النقرة من الجسم. وغيرُ المؤهلة **تبقى قابلة للتبئير**
// مع aria-disabled: من لا يستطيع الطلب يحق له قراءة السبب.
export function serviceCard(item,{e}){
  const meta=metaFor(item.department_id),time=timeChip(item.target);
  const chips=[time?`<span class="rq-chip is-time">${e(time)}</span>`:'',
    item.kind==='group'?`<span class="rq-chip">${e(countNoun(item.items,'service'))}</span>`:'',
    item.path.length?`<span class="rq-chip">${e(item.path.join(' ← '))}</span>`:'',
    item.module_name&&item.kind!=='module'?`<span class="rq-chip">${e(`يُقدَّم من «${item.module_name}»`)}</span>`:'',
    item.season?`<span class="rq-chip sc-season">${e(seasonText(item.season))}</span>`:''].filter(Boolean).join('');
  const body=item.kind==='group'?memberList(item,e):e(item.description);
  const reason=item.eligible===false?`<p class="vn-alert is-block" id="why-${e(item.key)}" role="note"><strong>ما تقدر تفتح منها طلب الحين</strong> ${e(item.eligibility_reason)}</p>`:'';
  // وصف الخدمة يُقصّ عند سطرين (والوصف الكامل في صفحتها)؛ وأعضاء المجموعة روابطُ فلا يُقصّون: رابطٌ مقصوص هدفٌ مخفيّ.
  const inside=`<span class="rq-row-text"><strong>${e(item.name)}</strong><span class="${item.kind==='group'?'sc-members':'sc-desc'}">${body}</span></span>`;
  const describe=item.eligible===false?` aria-describedby="why-${e(item.key)}"`:'';
  // ثلاث حالات، ولا رابعة. الخدمة لها صفحة فيفتحها جسمها — **وقراءتها مسموحة لمن لا يستطيع طلبها**، فلا
  // aria-disabled على رابط قراءة. والمجموعة والوحدة بلا صفحة: جسمها يفتح بابها من زرّ البدء وحده، فيكون
  // الجسم نصًّا. وغيرُ المؤهلة بلا صفحة تصير **زرًّا معطّلًا قابلًا للتبئير**: من لا يستطيع الطلب يحق له
  // أن يبلغ السبب بلوحة المفاتيح وبقارئ الشاشة، فلا يُترك النصّ خارج شجرة التبئير.
  const open=item.href
    ? `<a class="sc-open" href="${e(item.href)}" aria-label="${e(cardLabel(item))}"${describe}>${inside}</a>`
    : item.eligible===false
      ? `<button type="button" class="sc-open" aria-disabled="true"${describe} aria-label="${e(cardLabel(item))}">${inside}</button>`
      : `<div class="sc-open">${inside}</div>`;
  // عضو مجموعة يُعرض في نتيجة البحث ببطاقته هو، ويُقال بجواره من أي بطاقةٍ يُبلَغ أيضًا — لا يُخفى الطريق الثاني.
  const via=item.group_name?`<span class="sc-via">${e(`تُبلَغ أيضًا من بطاقة «${item.group_name}»`)}</span>`:'';
  return `<article class="sc-card${item.eligible===false?' is-blocked':''}" data-card="${e(item.key)}" data-kind="${e(item.kind)}">`
    +open+(chips?`<p class="sc-chips">${chips}</p>`:'')+via+reason
    +`<p class="sc-actions">${startButton(item,e)}${item.href?`<a class="btn outline small" href="${e(item.href)}" aria-label="${e(`اشرح لي أول: ${item.name}`)}">اشرح لي أول</a>`:''}</p></article>`;
}
const searchText=item=>normalizeArabic([item.name,item.description,item.key,...(item.options??[])].join(' '));

// بحثٌ في المرسوم نفسه: مطابقة «كل الكلمات» على الاسم والوصف والرمز وأسماء خيارات المجموعة، بالتطبيع
// القائم (normalizeArabic في request-picker.mjs) لا بتطبيعٍ ثانٍ. والبحث الكامل بمرادفاته يأتي في
// الدفعة الثالثة مع service_synonyms؛ وهذا ما تستطيعه الشاشة اليوم بصدق.
export function searchCards(tree,query){
  const terms=normalizeArabic(query).split(' ').filter(Boolean);
  if(!terms.length)return [];
  return tree.categories.flatMap(category=>category.cards.map(item=>({category,item})))
    .filter(({item})=>terms.every(term=>searchText(item).includes(term)));
}

/* ───── شاشة الدليل ─────────────────────────────────────────────────────────── */

// مادّة بطاقةٍ لم تُكتب بعد (gap.pending من الخادم، ت1): «لم يُكتب بعد. يكمله: <الإدارة المالكة>» مكان «غير متاح»، والسبب وما يلزم و«عند:» كما هي.
const gapRow=(gap,e)=>gap.pending
  ?`<div class="sc-gap"><strong>${e(gap.label)} — ${e(gap.pending)}</strong><small>${e(gap.why)}</small><small>${e(`ما يلزم: ${gap.needs}`)} · ${e(`عند: ${gap.owner}`)}</small></div>`
  :`<div class="sc-gap"><strong>${e(gap.label)} — غير متاح</strong><small>${e(gap.why)}</small><small>${e(`ما يلزم: ${gap.needs}`)} · ${e(`عند: ${gap.owner}`)}</small></div>`;
// ما لا تقوله الشاشة يُكتب ولا يُسكت عنه: عنوانٌ واحد يجمع الأرقام التي طلبها المالك ولم يُبنَ قياسها،
// ومعها ما يلزم بالضبط. وهذا بديلٌ عن رسم قسمٍ فارغ فوق فراغ (قاعدة ui.table نفسها).
export const gapsBlock=(gaps,{e},title='ما ليس في هذه الشاشة بعد، ولماذا')=>
  !gaps?.length?'':`<details class="vn-card"><summary><span class="vn-code" aria-hidden="true">؟</span><span class="vn-name"><strong>${e(title)}</strong><small>${e(countNoun(gaps.length,GAP_NOUN))}</small></span></summary><div class="panel-body">${gaps.map(gap=>gapRow(gap,e)).join('')}</div></details>`;

// العدسات الثلاث حيّة (الدفعة الرابعة: «حسب الرحلة» برحلة واحدة، وما بقي غائبًا مكتوبٌ في كتلة «ما ليس هنا بعد»).
// قائمة تبويبات كاملة (مراجعة 23 سبتمبر): المختارة وحدها في ترتيب Tab (tabindex=-1 على غيرها، والسهمان ينقلان بينها في
// app.mjs)، وكلٌّ يشير بـaria-controls إلى لوح النتائج الذي يحمل role="tabpanel" ويُسمّى بالتبويب المختار.
export const RESULTS_ID='catalog-results';
export const lensTabId=key=>`lens-tab-${key}`;
export function lensSwitch(tree,{e}){
  const draw=key=>{
    const current=tree.lens===key,name=LENS_NAMES[key];
    return `<button type="button" class="btn ${current?'dark':'outline'} small" role="tab" id="${e(lensTabId(key))}" aria-selected="${current}" aria-controls="${RESULTS_ID}" tabindex="${current?'0':'-1'}" data-action="catalog-lens" data-lens="${e(key)}">${e(name)}</button>`;
  };
  return `<div class="sc-lens" role="tablist" aria-label="عدسة التصفّح">${LENS_KEYS.map(draw).join('')}</div>`;
}

/* ───── «لك»: صفٌّ بأسبابه، وزرّ إخفاءٍ يُحفظ ────────────────────────────── */
// كل بطاقة تحمل سببها فوقها وفي aria-label، وزرّ «لا تقترح هذه عليّ» هدفٌ مستقل ≥44×44 (الأنماط) وبينه وبين الجسم
// فراغ. والصفّ كله يُخفى حين لا شيء يستحق ولا يُملأ ببطاقات مخترعة؛ ومن أخفاه بطلبه يقرأ سطرًا يعيده.
export function forYouRow(tree,{e,ui}){
  const row=tree.for_you;
  if(!row)return '';
  const toggle=(hidden,label)=>`<button type="button" class="btn outline small" data-action="suggestions-hidden" data-hidden="${hidden?'1':'0'}">${label}</button>`;
  if(row.hidden_by_me)return `<p class="subtle sc-foryou-off">المقترحات مخفية بطلبك. ${toggle(false,'أظهر المقترحات')}</p>`;
  const restore=row.dismissed.map(d=>ui.row({title:d.name,meta:d.in_tree?'':'لم يعد في دليلك',
    html:`<button type="button" class="btn outline small" data-action="hide-suggestion" data-kind="${e(d.kind)}" data-key="${e(d.key)}" data-hidden="0" aria-label="${e(`اقترح ${d.name} من جديد`)}">اقترحها من جديد</button>`})).join('');
  const hide=row.items.map(item=>ui.row({title:item.name,html:`<button type="button" class="btn outline small" data-action="hide-suggestion" data-kind="${e(item.kind)}" data-key="${e(item.key)}" data-hidden="1" aria-label="${e(`أخفِ ${item.name} من المقترحات`)}">إخفاء</button>`})).join('');
  const manage=(hide||restore)?`<details class="sc-dismissed"><summary>إدارة المقترحات</summary><div class="panel-body">${hide?`<h3>المقترحات الحالية</h3><ul class="vn-list">${hide}</ul>`:''}${restore?`<h3>مخفية</h3><ul class="vn-list">${restore}</ul>`:''}${toggle(true,'أخفِ قسم المقترحات')}</div></details>`:'';
  if(!row.items.length)return manage?`<section class="panel sc-foryou" aria-label="لك"><div class="panel-body">${manage}</div></section>`:'';
  const cards=row.items.map(item=>`<div class="sc-found sc-suggested" data-suggested="${e(item.key)}">`
    +`<p class="sc-why">${item.for_you.reasons.map(r=>r.link?`<a href="${e(r.link)}">${e(r.text)}</a>`:e(r.text)).join(' · ')}</p>`
    +serviceCard(item,{e})+`</div>`).join('');
  return `<section class="panel sc-foryou" aria-label="لك"><div class="panel-head"><h2>لك</h2><small>${e(countNoun(row.items.length,CARD_NOUN))}</small></div>`
    +`<div class="panel-body"><div class="sc-grid">${cards}</div>${manage}</div></section>`;
}

/* ───── عدسة «حسب الرحلة» وصفحة تتبع الرحلة ─────────────────────────────── */
// التعريف المبنيّ ببابه (الطلب الأب) وخطواته بشرطها، ثم «رحلاتي»، ثم السبع الباقيات مادّةً — لا تعريف مزيَّف.
export function journeyLensView(tree,{e,ui}){
  const j=tree.journeys;
  if(!j)return '';
  const drawDefinition=d=>{
    const start=d.parent.can_start
      ?`<a class="btn dark small" href="${e(d.parent.href)}" aria-label="${e(`ابدأ الرحلة: ${d.name} — بطلب «${d.parent.name}»`)}">ابدأ الرحلة</a>`
      :`<span class="btn outline small" aria-disabled="true">ابدأ الرحلة<small class="subtle"> — ${e(d.parent.why_not)}</small></span>`;
    const steps=[{name:d.parent.name,condition:'الطلب الأب — تبدأ الرحلة أول ما ينعتمد'},...d.steps];
    return `<article class="sc-journey" data-journey="${e(d.key)}"><div class="sc-open">`
      +`<span class="rq-row-text"><strong>${e(d.name)}</strong><span class="sc-desc">${e(d.description)}</span></span></div>`
      +`<ol class="rq-trail" aria-label="${e(`خطوات رحلة ${d.name}`)}">${steps.map(s=>`<li><strong>${e(s.name)}</strong><span>${e(s.condition)}</span></li>`).join('')}</ol>`
      +`<p class="sc-actions">${start}</p></article>`;
  };
  const mine=j.mine.length
    ?`<section class="panel"><div class="panel-head"><h2>رحلاتي</h2><small>${e(countNoun(j.mine.length,JOURNEY_NOUN))}</small></div><ul class="vn-list">${j.mine.map(run=>ui.row({title:run.name,
        meta:[run.parent.title,run.status_name,run.waiting_me?`${countNoun(run.waiting_me,STEP_NOUN)} تنتظر ردك`:'',run.blocked?`${countNoun(run.blocked,STEP_NOUN)} تعذّرت`:''].filter(Boolean).join(' · '),href:run.href})).join('')}</ul></section>`
    :'<p class="subtle">ما لك رحلة للحين — تبدأ الرحلة أول ما ينعتمد طلبها الأب.</p>';
  const later=`<details class="vn-card"><summary><span class="vn-code" aria-hidden="true">…</span><span class="vn-name"><strong>رحلات معرّفة لاحقًا</strong><small>${e(countNoun(j.later.length,JOURNEY_NOUN))}</small></span></summary>`
    +`<ul class="vn-list">${j.later.map(x=>ui.row({title:x.name_ar,meta:`المادّة القائمة: ${x.material} · ما ينقص: ${x.missing}`})).join('')}</ul></details>`;
  return `<p class="sc-counts" role="status">${e(j.note)}</p><div class="sc-grid">${j.definitions.map(drawDefinition).join('')}</div>${mine}${later}`;
}

// صفحة التتبع: الأب ثم الخطوات بترتيبها؛ الخطوة التي وُلد طلبها تحمل شارة حالته **من الطلب نفسه** (ui.statusBadge)، والتي
// لم تُنفَّذ تحمل نتيجتها وسببها. لا رقم يُخترع: العدّادات من الحمولة.
export function journeyRunView(data,{e,ui}){
  const crumbs=`<p class="rq-crumbs"><a href="#services">الخدمات</a> <span aria-hidden="true">›</span> <strong aria-current="page">${e(`رحلة «${data.journey.name}»`)}</strong></p>`;
  const counts=[`${countNoun(data.counts.created,'request')} وُلدت`,data.counts.skipped?`${countNoun(data.counts.skipped,STEP_NOUN)} ما انطلبت`:'',
    data.counts.blocked?`${countNoun(data.counts.blocked,STEP_NOUN)} تعذّرت`:'',data.counts.waiting_me?`${countNoun(data.counts.waiting_me,'request')} تنتظر ردك`:''].filter(Boolean).join(' · ');
  const parent=ui.row({title:data.parent.title,meta:`الطلب الأب · ${data.parent.service_name}`,href:data.parent.href,html:ui.statusBadge(data.parent.status)});
  const drawStep=s=>{
    const meta=[s.outcome_name,s.reason].filter(Boolean).join(' — ');
    if(s.child)return ui.row({title:`${s.position}. ${s.item.name}`,meta,href:s.child.href,html:ui.statusBadge(s.child.status)});
    return ui.row({title:`${s.position}. ${s.item.name}`,meta,tone:s.outcome==='blocked'?'is-late':'',html:`<span class="badge ${s.outcome==='blocked'?'rejected':''}">${e(s.outcome_name)}</span>`});
  };
  const status=`<span class="badge ${data.status==='completed'?'approved':'pending'}">${e(data.status_name)}</span>`;
  return crumbs+ui.pageHead(`رحلة «${data.journey.name}»`,data.journey.description,status)
    +`<p class="sc-counts" role="status">${e(counts)}</p>`
    +`<section class="panel"><div class="panel-head"><h2>الطلب الأب</h2></div><ul class="vn-list">${parent}</ul></section>`
    +`<section class="panel"><div class="panel-head"><h2>الخطوات بترتيبها</h2><small>${e(countNoun(data.steps.length,STEP_NOUN))}</small></div><ol class="vn-list sc-steps">${data.steps.map(drawStep).join('')}</ol></section>`
    +`<p class="notice">${e(data.note)}</p>`
    +`<p class="operation-actions"><a class="btn outline" href="#services"><span aria-hidden="true">→</span> العودة إلى الخدمات</a></p>`;
}

// الفئة التي فيها مجموعات تطبع رقمين (بطاقات وخدمات)، والتي بلا مجموعات تطبع رقمًا واحدًا. وكلا الرقمين
// من الحمولة نفسها التي بُنيت منها البطاقات، فمجموعهما على الشبكة هو ما تقوله الترويسة بالضبط.
const categoryCounts=category=>category.cards_count===category.items
  ?countNoun(category.items,'service'):`${cardCount(category.cards_count)} · ${countNoun(category.items,'service')}`;
// بطاقة الفئة: الصنف القائم rq-dept بشبكته (عمود واحد تحت 480)، ومعه sc-cat الذي يضمن ≥64 بكسل ارتفاعًا للمس.
const categoryCard=(category,e)=>`<a class="rq-dept sc-cat" href="#services/category/${e(category.key)}" aria-label="${e(`${category.name} — ${category.description} — ${categoryCounts(category)}`)}">`
  +`<span class="rq-dept-icon" aria-hidden="true">${glyphFor(category.key)}</span>`
  +`<strong>${e(category.name)}</strong><span class="rq-dept-tag">${e(category.description)}</span>`
  +`<span class="rq-dept-count">${e(categoryCounts(category))} <span aria-hidden="true">←</span></span></a>`;
// شبكة الفئات وحدها، فتُعاد كما هي حين يُفرَّغ صندوق البحث: لا تُبنى الشبكة في موضعين فيفترقا.
export const categoryGrid=(tree,{e})=>`<div class="rq-dept-grid">${tree.categories.map(category=>categoryCard(category,e)).join('')}</div>`;

// الهيكل العظمي: مستطيلات بارتفاع بطاقة الفئة، بلا دوّار وبلا نصّ متحرك، مع aria-busy وجملة واحدة
// لقارئ الشاشة. الصفحة لا تقفز حين تصل البيانات لأن للهيكل ارتفاع البطاقة نفسه.
export const catalogSkeleton=()=>`<div class="rq-dept-grid" aria-busy="true" role="status">`
  +`<span class="sr-only">جارٍ تحميل الخدمات…</span>`
  +Array.from({length:8},()=>`<div class="sc-skeleton" aria-hidden="true"><span></span><span></span></div>`).join('')+`</div>`;

// سطر العدّاد الذي يعلنه لوح الحالة الدائم (#catalog-counts): الترويسة عند الفتح، وعدد النتائج أثناء البحث (catalogResults).
// والرقم الرابع المستقل (ت1): ما نُقل موضع عرضه إلى صفحات الإدارات (د3/د4) يُقال بجوار الترويسة ولا يُطرح منها صامتًا.
export const countsLine=tree=>`${countNoun(tree.totals.categories,CATEGORY_NOUN)} · ${cardCount(tree.totals.cards)} · ${countNoun(tree.totals.items,'service')}`
  +(tree.department_only_items?` · و${countNoun(tree.department_only_items,'service')} في صفحات إداراتها`:'')
  +(tree.hidden_services?` · و${countNoun(tree.hidden_services,'service')} موقوفة من الإعدادات`:'');
export const visibleCountsLine=tree=>`${countNoun(Number(tree.totals.items??0)+Number(tree.department_only_items??0),'service')} متاحة لك`;
// «خدمات مختارة» (ت1): قائمة يدوية ثابتة من الباب الأمامي (FEATURED_SERVICES) محلولة على دليل هذا الحساب في الخادم (tree.featured).
// بلا عدّ ولا ترتيب محسوب ولا شارة «الأكثر طلبًا»: ذلك يعود حين يصير للطلبات الحقيقية عددٌ له معنى (م4). وكلٌّ رابطٌ إلى صفحته.
export function featuredBlock(tree,{e,ui}){
  const list=tree.featured??[];
  if(!list.length)return '';
  return `<section class="panel sc-featured" aria-label="خدمات مختارة"><div class="panel-head"><h2>خدمات مختارة</h2></div>`
    +`<ul class="vn-list">${list.map(item=>ui.row({title:item.name,meta:item.description??'',href:item.href})).join('')}</ul></section>`;
}
// counts: سطر الحالة لما يُرسم في extra حين لا يكون شبكة الفئات (عدسة الإدارة). بلا counts يبقى عدّ الشجرة كما كان.
export function catalogHome(tree,{e,ui,extra='',counts=''}){
  const search=`<label class="rq-search"><span class="rq-search-icon" aria-hidden="true">⌕</span>`
    +`<span class="sr-only">ابحث عن خدمة بحاجتك</span>`
    +`<input id="catalog-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="اكتب حاجتك بكلماتك: تعريف بنك، جهازي خربان، اجازه"><kbd aria-hidden="true">/</kbd></label>`;
  // «لم تجد خدمتك؟» باسم الخدمة من صفّها الحيّ في الحمولة (feedback_service)، لا باسمٍ مكتوب هنا يكذب بعد إعادة
  // تسمية ثانية. ومن لا يراها لا يُعطى رابطًا إلى باب مغلق.
  const feedback=tree.feedback_service
    ?`<p class="subtle sc-feedback">لم تجد خدمتك؟ اطلب «${e(tree.feedback_service.name)}». <a href="${e(tree.feedback_service.href)}">افتح الخدمة <span aria-hidden="true">←</span></a></p>`
    :`<p class="subtle sc-feedback">لم تجد خدمتك؟ جرّب كلمة ثانية في البحث، أو تصفّح الفئات.</p>`;
  const openRequests=tree.open_requests.length
    ?`<section class="panel"><div class="panel-head"><h2>طلباتك المفتوحة</h2><small>${e(countNoun(tree.open_requests.length,'request'))}</small></div>`
      +`<ul class="vn-list">${tree.open_requests.map(request=>ui.row({title:request.title,meta:request.service_name,href:`#request/${request.id}`,html:ui.statusBadge(request.status)})).join('')}</ul></section>`
    :'';
  const team=tree.my_team&&tree.my_team.items.length
    ?`<section class="panel"><div class="panel-head"><h2>فريقي</h2><small>${e(tree.my_team.note)}</small></div>`
      +`<ul class="vn-list">${tree.my_team.items.map(item=>ui.row({title:item.name,href:item.href})).join('')}</ul></section>`
    :'';
  // ترتيب القراءة وترتيب Tab معًا: البحث ← العدسات ← خدمات مختارة ← لك ← الطلبات المفتوحة ← الفئات ← فريقي ← المخرج ← الإعلان ← الغائب.
  // الباب واحد اسمه «الخدمات» (ت1): #catalog و#departments بلا إدارة يُحوَّلان إليه.
  return ui.pageHead('الخدمات','ما الذي تحتاجه اليوم؟ اكتب حاجتك بكلماتك، أو اختر إدارتك أو فئة حاجتك.')
    +`<section class="panel sc-search" aria-label="ابحث في الخدمات"><div class="panel-body">${search}`
    // لوح حالةٍ **دائم** يُغيَّر نصّه أثناء البحث (app.mjs يكتب فيه announce من catalogResults): لوحٌ يُنشأ مع نصّه في كل ضغطة
    // لا يُنطق، والدائم يُنطق حين يتغيّر نصّه (مراجعة 23 سبتمبر).
    +`<p class="sc-counts" role="status" aria-live="polite" id="catalog-counts">${e(counts||visibleCountsLine(tree))}</p></div></section>`
    +lensSwitch(tree,{e})
    +featuredBlock(tree,{e,ui})
    +forYouRow(tree,{e,ui})
    +openRequests
    +`<div id="${RESULTS_ID}" role="tabpanel" aria-labelledby="${e(lensTabId(LENS_KEYS.includes(tree.lens)?tree.lens:'department'))}">${extra||categoryGrid(tree,{e})}</div>`
    +team
    +feedback;
}

// نتيجة البحث داخل الشاشة نفسها (الدفعة الثالثة): الترتيب من rankCatalog على البطاقات وأعضاء المجموعات بمرادفاتها
// (tree.synonyms من الخادم)، والعدّ في `role="status"` كما هو في `rq-results-head`، والفارغة بنصّها القائم حرفًا بحرف
// عبر ui.empty. فوق النتائج **الجواب المباشر** حين تستطيعه المنصة بصدق: مسار النتيجة الأولى وزمنها بسنده — لا مادة سياسة
// ولا رصيد لم يصل في الحمولة. والنتائج مجمَّعة بالفئة، وفئةُ النتيجة الأولى أولًا؛ وكل بطاقة تحمل مرتبتها (data-position)
// ليسجّلها المتصفح حين تُفتح — بلا هوية (app/catalog-home.mjs logSearchEvent).
// نصّ العدّاد الذي يُنطق: يكتبه app.mjs في لوح الحالة الدائم (#catalog-counts)، ولا يُنشأ لوحٌ جديد مع كل ضغطة.
export const searchAnnouncement=hits=>hits.length?`${countNoun(hits.length,'service')} مطابقة`:'لا توجد خدمة مطابقة';
export function searchResults(tree,query,{e,ui}){
  const {hits,used,ignored,partial}=searchCatalog(tree,tree.synonyms??{},query);
  // رأس النتائج <h2> تحت <h1> الصفحة مباشرة (لا قفزة إلى h3)، والعدّاد نصٌّ مرئي لا لوح حالةٍ يُنشأ مع نصّه.
  if(!hits.length)return `<div class="rq-results-head"><h2>نتائج «${e(query.trim())}»</h2><p class="sc-counts">${e(searchAnnouncement(hits))}</p></div>`
    +ui.empty('لم نجد ما تبحث عنه','جرّب كلمة أقصر، أو تصفّح الفئات. وإن كانت الخدمة غير موجودة فعلًا فاقترحها.');
  const answer=directAnswer(hits);
  const answerBlock=answer?`<section class="sc-answer" role="note" aria-label="${e(`الجواب المباشر: ${answer.name}`)}"><strong>${answer.href?`<a href="${e(answer.href)}">${e(answer.name)}</a>`:e(answer.name)}</strong><small>${e(answer.text)}</small>${answer.via?`<small>${e(answer.via)}</small>`:''}</section>`:'';
  // حين لم تُصِب كل الكلمات: يُقال للطالب أيّ كلماته استُعملت وأيّها أُهملت، فلا يُوهَم أن «يبرد» وُجدت في الدليل.
  const usedLine=partial?`<p class="subtle sc-used">${e(`بحثنا بكلمات: ${used.join('، ')}`)}${ignored.length?` — ${e(`وتجاهلنا: ${ignored.join('، ')}`)}`:''}</p>`:'';
  const groups=[];
  for(const hit of hits){let group=groups.find(g=>g.category===hit.category);if(!group){group={category:hit.category,hits:[]};groups.push(group);}group.hits.push(hit);}
  return `<div class="rq-results-head"><h2>نتائج «${e(query.trim())}»</h2><p class="sc-counts">${e(searchAnnouncement(hits))}</p></div>`
    +usedLine+answerBlock
    // ما نُقل إلى صفحة إدارته (ت1) يُجمَّع تحت اسم إدارته رابطًا إلى صفحتها، لا تحت فئة حاجة.
    +groups.map(group=>`<p class="sc-group-head">${group.category.department_page?`<a href="${e(group.category.href)}">${e(group.category.name)}</a> · صفحة الإدارة`:e(group.category.name)} · ${e(countNoun(group.hits.length,'service'))}</p>`
      +`<div class="sc-grid">${group.hits.map(({item,position})=>`<div class="sc-found" data-position="${position}">${serviceCard(item,{e})}</div>`).join('')}</div>`).join('');
}
// ما يسكن لوح النتائج في لحظةٍ ما، **في موضعٍ واحد** يقرؤه الرسم الأول وإعادةُ الرسم عند كل ضغطة سواء (مراجعة 23 سبتمبر:
// كان تفريغ صندوق البحث في عدسة الإدارة يعيد شبكة الحاجة تحت تبويبٍ ما زال يقول «حسب الإدارة»، لأن إعادة الرسم لم تعرف
// extra). الاستعلام الفارغ يعيد ما رُسم أولًا (extra: مشغّل الإدارة أو عدسة الرحلة، وإلا شبكة الفئات)، ومعه ما يُنطق.
export function catalogResults(tree,query,{e,ui,extra='',counts=''}){
  const q=String(query??'').trim();
  if(!q)return {html:extra||categoryGrid(tree,{e}),announce:counts||visibleCountsLine(tree)};
  return {html:searchResults(tree,q,{e,ui}),announce:searchAnnouncement(searchCatalog(tree,tree.synonyms??{},q).hits)};
}

/* ───── صفحة الفئة ──────────────────────────────────────────────────────────── */

// الفرز يعيد ترتيب البطاقات نفسها ولا يغيّر عددها: العدّادان يبقيان كما جاءا من الجملة الواحدة.
export function sortCards(cards,sort){
  if(sort==='name')return [...cards].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  if(sort==='time')return [...cards].sort((a,b)=>weight(a)-weight(b));
  return [...cards];
}
const weight=item=>item.target&&item.target.kind!=='unset'?item.target.days*8+item.target.hours:1e6;

export function categoryView(tree,key,sort,{e,ui}){
  const category=tree.categories.find(c=>c.key===key)??null;
  if(!category)return ui.pageHead('الفئة غير متاحة','')
    +ui.empty('لا فئة بهذا المفتاح في دليل حسابك','ارجع إلى الخدمات واختر فئة من الشبكة.')
    +`<p class="operation-actions"><a class="btn outline" href="#services"><span aria-hidden="true">→</span> العودة إلى الخدمات</a></p>`;
  const chosen=SORT_KEYS.includes(sort)?sort:'tree';
  const counts=categoryCounts(category);
  const control=`<nav class="sc-sort" aria-label="ترتيب البطاقات"><span class="subtle">الترتيب:</span>`
    +SORT_KEYS.map(option=>option===chosen
      ?`<strong aria-current="true">${e(SORT_NAMES[option])}</strong>`
      :`<a href="#services/category/${e(category.key)}/${e(option)}">${e(SORT_NAMES[option])}</a>`).join('')+`</nav>`;
  return `<p class="rq-crumbs"><a href="#services">الخدمات</a> <span aria-hidden="true">›</span> ${e(category.name)}</p>`
    +ui.pageHead(category.name,category.description)
    +`<p class="sc-counts" role="status">${e(counts)}</p>`+control
    +`<div class="sc-grid">${sortCards(category.cards,chosen).map(item=>serviceCard(item,{e})).join('')}</div>`
    +gapsBlock(tree.gaps.category,{e})
    +`<p class="operation-actions"><a class="btn outline" href="#services"><span aria-hidden="true">→</span> العودة إلى الخدمات</a></p>`;
}

/* ───── ت1: عدسة «حسب الإدارة» وصفحة الإدارة ─────────────────────────────────── */
// العدسة الافتراضية في «الخدمات»: شريط الإدارات بقطاعاته وشبكة الإدارات، وكلٌّ رابطٌ إلى صفحة إدارته (#departments/<id>). هي
// launcherResults القائمة نفسها بوسيط linked — لا شاشة ثانية — فالطريق: «الخدمات» ← الإدارة ← صفحة الخدمة، ثلاث ضغطات.
// «خدمات مختارة» لا تُرسم هنا: كتلتها فوق العدسات (featuredBlock) من الحمولة نفسها.
// عدّ عدسة الإدارة من الرفوف نفسها التي يرسمها شريطها: «كل الخدمات» هو الرقم نفسه، والإدارات هي مداخل الشريط. كان سطر الحالة فوقها يقول عدّ شجرة الفئات
// (catalog_placement) وهي مصدرٌ آخر: فارغٌ لكيانٍ لم يُسقَط دليله بعد فيقول «0 خدمات» فوق خدماتٍ ظاهرة، ومختلفٌ عنها في غيره.
export function departmentLensCounts({departments,services,variants=null}){
  const {services:shown,groups}=launcherShelves({departments,services,variants});
  return `${countNoun(shown.length,'service')} من ${countNoun(groups.filter(g=>g.count).length,'department')}`;
}
export function departmentLens({departments,services,me,e,modules=null,variants=null}){
  return `<div class="rq" data-launcher data-mode="services"><div class="rq-body">${launcherResults({departments,services,me,selected:'',query:'',e,modules,variants,linked:true})}</div></div>`;
}

// أقسام صفحة الإدارة الخمسة بمفاتيحها في الرابط (#departments/<id>/<قسم>). القسم الذي لا محتوى له لا يُرسم عنوانًا فوق فراغ.
// ترتيب أقسام صفحة الإدارة. «الخدمات» أولًا بطلب المالك (30 سبتمبر): «وطلّع الخدمات الفرعية بعد
// النقر على كل إدارة». من ينقر إدارةً يسأل «وش أقدر أطلب منها»، لا «كم أداة عندها» — فيُفتح على جوابه،
// وتبقى النظرة العامة وطابورها وفريقها وتقاريرها أسفلها على الصفحة نفسها بتبويباتها.
export const DEPARTMENT_SECTIONS=Object.freeze([
  Object.freeze({key:'services',name:'الخدمات'}),Object.freeze({key:'overview',name:'نظرة عامة'}),
  Object.freeze({key:'incoming',name:'الطلبات الواردة'}),Object.freeze({key:'team',name:'الفريق'}),
  Object.freeze({key:'reports',name:'التقارير'})]);
// طابور التنفيذ: الطلبات المعتمدة أو قيد التنفيذ التي تعالجها هذه الإدارة، من /api/requests كما يراها الحساب — لا نداءٌ أوسع.
const EXECUTION_STATUSES=Object.freeze(['approved','in_progress']);
// شاشة تقرير: نوعها في خريطة التنقل «report»، أو بديلها لغير الأدمن تقرير (ADMIN_ALT/NO_PAGE_ALT).
const isReportScreen=key=>NAV_DEST[key]?.kind==='report'||ADMIN_ALT[key]?.[1]==='report'||NO_PAGE_ALT[key]?.[1]==='report';
// «أدوات الإدارة» (عقد nav-map.mjs): كل مدخل في navReach — الشاشات التي يبلغها الحساب اليوم — يضعه placeFor على هذه الإدارة، بتسمية
// placeFor نفسها ورابطه #<key>. لا يمنح وصولًا ولا يمنعه: ما ليس في navReach لا يُرسم، وغياب navReach كله = لا كتلة أدوات (null).
export function departmentTools(reach,me,id){
  if(!Array.isArray(reach))return null;
  const seen=new Set(),tools=[];
  for(const entry of reach){
    const [key,,label]=Array.isArray(entry)?entry:[];
    if(typeof key!=='string'||seen.has(key))continue;
    const place=placeFor(key,label,me);
    if(place.hub!=='dept'||place.dept!==id)continue;
    seen.add(key);tools.push({key,label:place.label,href:'#'+key,report:isReportScreen(key)});
  }
  return tools;
}
const findUnit=(org,id)=>[...(org?.sectors??[]).flatMap(s=>s.units??[]),...(org?.unplaced??[])].find(unit=>unit.id===id)??null;
const PEOPLE_NOUN=['موظف واحد','موظفان','موظفين','موظفًا'],REPORT_NOUN=['تقرير واحد','تقريران','تقارير','تقريرًا'];

// صفحة الإدارة. البيانات كلها مما يصل الحساب اليوم: /api/departments و/api/catalog والخيارات، وnavReach، و/api/requests و/api/org
// والإعلانات لمن هو من الإدارة أو يحمل أداةً فيها. **ومن ليس منها ولا أداة له فيها يرى «الخدمات» وحدها مع شريط الإدارات** —
// وهذا عرضٌ لا قرار وصول: الخادم يقرّر كل نداء كما كان.
// الأقسام مرسومة معًا في الصفحة، والتبويبات روابط إلى مواضعها (aria-current على المختار)، فخدمات الإدارة على بُعد ضغطة من شريطها.
// وخدمات ADM- في وحدة العرض «الشؤون الإدارية والمرافق» (بلا صفّ في departments): صفحة خدماتٍ وحدها بتسمية من ينفّذها مؤقتًا.
export function departmentPageView({id,section='',departments,services,variants=null,me,reach=null,requests=null,org=null,announcements=null,e,ui}){
  const shelves=launcherShelves({departments,services,variants});
  const unit=shelves.departments.find(d=>d.id===id)??null;
  const rail=departmentRail({shelves,me,selected:id,e,linked:true});
  const crumbs=`<p class="rq-crumbs"><a href="#services">الخدمات</a> <span aria-hidden="true">›</span> <strong aria-current="page">${e(unit?.name??'الإدارة')}</strong></p>`;
  const frame=inner=>`<div class="rq rq-page" data-launcher data-mode="department"><div class="rq-body">${rail}<div class="rq-results">${inner}</div></div></div>`;
  if(!unit)return crumbs+ui.pageHead('الإدارة غير متاحة','')
    +frame(ui.empty('ما فيه إدارة بهالمعرّف في دليل حسابك','اختر إدارة من الشريط، أو ارجع إلى «الخدمات».'));
  const meta=metaFor(id),tools=departmentTools(reach,me,id);
  const member=!!me?.department_id&&me.department_id===id&&!unit.display_only;
  const full=!unit.display_only&&(member||!!tools?.length);
  const general=(tools??[]).filter(t=>!t.report),reports=(tools??[]).filter(t=>t.report);
  const queue=full&&Array.isArray(requests)?requests.filter(r=>r.handling_department_id===id&&EXECUTION_STATUSES.includes(r.status)):null;
  const team=full?findUnit(org,id):null;
  const notices=full&&Array.isArray(announcements)?announcements.filter(a=>a.department_id===id&&a.status==='published'&&!a.expired):[];
  const owned=services.filter(s=>displayDepartment(s)===id).length,group=shelves.groups.find(g=>g.department.id===id);
  const at=key=>`#departments/${id}/${key}`,blocks=[];
  // الخدمات تُبنى أولًا فتصير blocks[0]، وهي القسم الافتراضي حين لا يسمّي الرابط قسمًا.
  {
    const interimFirst=unit.display_only?`<p class="notice">${e(`${unit.name}: ${INTERIM_EXECUTOR}.`)}</p>`:'';
    const listedFirst=departmentServices({shelves,departments:shelves.departments,id,me,e,linked:true,workspaces:false});
    blocks.push({key:'services',meta:countNoun(owned,'service'),body:`<div class="panel-body">${interimFirst}${listedFirst||ui.empty('ما فيه خدمات معروضة لهالإدارة في دليل حسابك','ارجع إلى «الخدمات» ودوّر بحاجتك، أو اختر إدارة ثانية من الشريط.')}</div>`});
  }
  if(full){
    const tiles=[ui.tile(countNoun(owned,'service'),'خدمات الإدارة','',at('services')),
      group?ui.tile(countNoun(group.sections.length,'section'),'أقسام الخدمات'):'',
      queue?ui.tile(String(queue.length),'طلبات واردة قيد التنفيذ','',at('incoming')):'',
      team?ui.tile(countNoun(team.people,PEOPLE_NOUN),'في الإدارة','',at('team')):''].join('');
    const toolsBlock=general.length?`<h3>أدوات الإدارة</h3><ul class="vn-list">${general.map(t=>ui.row({title:t.label,href:t.href})).join('')}</ul>`:'';
    // تاريخ نشر الإعلان <time> بقيمته الآلية.
    const noticeBlock=notices.length?`<h3>إعلانات الإدارة</h3><ul class="vn-list">${notices.map(a=>ui.row({title:a.title,html:/^\d{4}-\d{2}-\d{2}/.test(String(a.publish_on??''))?`<span><time datetime="${e(String(a.publish_on).slice(0,10))}">${e(a.publish_on)}</time></span>`:a.publish_on?`<span>${e(a.publish_on)}</span>`:''})).join('')}</ul>`:'';
    blocks.push({key:'overview',body:`<div class="panel-body"><div class="vn-tiles">${tiles}</div>${toolsBlock}${noticeBlock}</div>`});
    if(queue)blocks.push({key:'incoming',meta:countNoun(queue.length,'request'),body:queue.length
      ?`<ul class="vn-list">${queue.map(r=>ui.row({title:r.title,meta:r.service_name,href:`#request/${r.id}`,html:ui.statusBadge(r.status)})).join('')}</ul>`
      :ui.empty('لا طلبات واردة تراها لهذه الإدارة الآن','تظهر هنا الطلبات المعتمدة التي تنفّذها الإدارة مما تملك رؤيته.')});
  }
  if(team)blocks.push({key:'team',body:`<ul class="vn-list">${[ui.row({title:'عدد الموظفين',meta:countNoun(team.people,PEOPLE_NOUN)}),
    team.approver?ui.row({title:'معتمد الإدارة',meta:team.approver.name}):'',
    team.escalation?ui.row({title:'مرجع التصعيد',meta:team.escalation.name}):''].join('')}</ul>`});
  if(full&&reports.length)blocks.push({key:'reports',meta:countNoun(reports.length,REPORT_NOUN),
    body:`<ul class="vn-list">${reports.map(t=>ui.row({title:t.label,href:t.href})).join('')}</ul>`});
  const current=blocks.some(b=>b.key===section)?section:blocks[0].key;
  const nameOf=key=>DEPARTMENT_SECTIONS.find(s=>s.key===key).name;
  const tabs=blocks.length>1?`<nav class="sc-sort" aria-label="أقسام صفحة الإدارة">${blocks.map(b=>`<a href="${e(at(b.key))}"${b.key===current?' aria-current="true"':''}>${e(nameOf(b.key))}</a>`).join('')}</nav>`:'';
  const drawn=blocks.map(b=>`<section class="panel" id="dept-${b.key}" aria-labelledby="dept-${b.key}-head"><div class="panel-head"><h2 id="dept-${b.key}-head">${e(nameOf(b.key))}</h2>${b.meta?`<small>${e(b.meta)}</small>`:''}</div>${b.body}</section>`).join('');
  return crumbs+ui.pageHead(unit.name,meta.tagline)+frame(tabs+drawn);
}
