// صفحة الخدمة — «اشرح قبل أن تسأل»، بلغة الطالب لا بلغة معدّ الدليل.
//
// هذه الشاشة **عرضٌ لبطاقة التعريف القائمة** (`service_cards`، ترحيل 045) وما يشتقّه النظام من تعريف
// الخدمة، لا كيانٌ ثانٍ ولا محرّر ثانٍ. ولذلك مادّتها كلها من `app/catalog-home.mjs servicePage` الذي
// يستدعي `serviceCard` نفسها التي تقرؤها شاشة مالك الإجراء — فلا يفترق ما يقرؤه الطالب عمّا يعتمده المالك.
//
// أربع قواعد تحكم كل قسم فيها:
//   (1) **القسم الذي لا محتوى له لا يُرسم عنوانًا فوق فراغ** (قاعدة `ui.table` نفسها). وبدلًا من الصمت
//       يُجمع الغائب كلُّه في كتلة واحدة مسمّاة «ما ليس في هذه الصفحة بعد» بسببه وبما يلزمه وعند من.
//   (2) **الزمن لا يُنطق عاريًا**: الرقم في النص، والسند بجواره، و`aria-label` تحمل العبارة كاملة.
//   (3) **لا نسبة التزام**: مكانها نصٌّ يقول لماذا لا تُعرض وما يلزم قبل أول عرض — لا فراغ ولا صفر.
//   (4) **«هل يكون المعتمِد هو المنفّذ؟» تبقى بنصّها القائم**: شفافيةٌ اشتُريت بثمن (مسحٌ وجد 115 طلبًا
//       من 142 نفّذها الحسابُ نفسه الذي اعتمدها)، وحذفُها من الشاشة الجديدة تراجُع.
import { icon } from './icons.mjs';
import { countNoun } from './arabic-count.mjs';
import { gapsBlock } from './catalog-home-ui.mjs';

const FIELD_TYPES=Object.freeze({text:'نص',textarea:'نص طويل',date:'تاريخ',number:'رقم',select:'اختيار من قائمة',file:'ملف'});

// شرط الظهور كما يفرضه الخادم (app/validation.mjs fieldVisible)، مقروءًا لا مرمَّزًا: «يُطلب حين يكون
// النوع: نسيان بصمة، استئذان». لا لغة شرطٍ ثانية ولا صياغة ثانية لها.
function conditionText(field){
  const when=field.show_when;
  if(!when||!when.field)return '';
  const values=Array.isArray(when.in)?when.in:Array.isArray(when.not_in)?when.not_in:[];
  if(!values.length)return '';
  return `${when.in?'يُطلب حين يكون':'يُطلب إلا حين يكون'} «${when.field}»: ${values.join('، ')}`;
}

const inputRow=(field,e,ui)=>{
  const notes=[FIELD_TYPES[field.type]??field.type,field.required?'مطلوب':'اختياري',conditionText(field),
    field.why?`لماذا يُسأل: ${field.why}`:'',field.hint?`تلميح: ${field.hint}`:'',field.example?`مثال: ${field.example}`:'',
    Array.isArray(field.options)&&field.options.length?`الخيارات: ${field.options.join('، ')}`:''].filter(Boolean);
  return ui.row({title:field.label,meta:notes.join(' · ')});
};

// القسم القابل للطيّ: <details class="vn-card"> القائمة في أربع عشرة شاشة، ورأسها <h2> داخل <summary> فيبقى
// لقارئ الشاشة تنقّلٌ بالعناوين ويبقى للجوال طيٌّ حقيقي. يُرسم مفتوحًا، وعلى الشاشة الضيقة يطويه app.mjs بعد
// الرسم ما عدا «سياقك أنت» — «اشرح قبل أن تسأل» لا «اعرض كل شيء دفعة» (٣-٢). رأس القسم ≥48 بكسل (الأنماط).
// والرمز في خانة vn-code زخرفةٌ من عائلة رموز القائمة نفسها، عليها aria-hidden، والمعنى في العنوان لا فيها.
const fold=(title,body,{e,meta='',label=''})=>`<details class="vn-card sc-fold" open${label?` aria-label="${e(label)}"`:''}>`
  +`<summary><span class="vn-name"><h2>${e(title)}</h2>${meta?`<small>${meta}</small>`:''}</span></summary>${body}</details>`;

// كتلة الزمن. الرقم ثم سنده كاملًا في النص نفسه، لا في تلميحٍ يحمله رمزٌ صغير — ومن لا يرى الرمز يقرأ
// الجملة. و«الالتزام الفعلي» يُكتب غيابه ولا يُترك فراغًا.
function timeBlock(data,e){
  const target=data.target;
  const amount=target&&target.kind!=='unset'?target.amount:'لا زمن مستهدف مسجَّل';
  return fold('كم تستغرق؟',`<div class="panel-body">`
    +`<p><strong>${e(amount)}</strong></p><p class="subtle">${e(target?target.note:'لا زمن مستهدف مسجَّل لهذه الخدمة')}</p>`
    +(target?.adopted&&target.adopted_by_name?`<p class="subtle">${e(`تبنّاه: ${target.adopted_by_name}${target.adopted_on?` — ${target.adopted_on}`:''}`)}</p>`:'')
    +`<p class="subtle">${e(data.clock)}</p>`
    +`<hr aria-hidden="true"><p><strong>الالتزام الفعلي: لا يُعرض.</strong> ${e(data.compliance.why)}</p>`
    +`<p class="subtle">${e(`ما يلزم قبل أول عرض: ${data.compliance.needs} · عند: ${data.compliance.owner}`)}</p>`
    +`</div>`,{e,meta:e(amount),label:`الزمن المستهدف ${target?target.label:'غير متاح'}`});
}

// زر البدء: نموذج عام، أو شاشة التشغيل التي تنفّذ العمل فعلًا. الزرّان الملتصقان (أعلى الصفحة وأسفلها)
// هدفان حقيقيان لا تكرارٌ بصريّ: الأعلى يصل قبل الأقسام الطويلة في ترتيب Tab، والأسفل يصل بعد قراءتها.
function startAction(data,e){
  const label='ابدأ الطلب',link=data.start.module_link;
  if(link)return `<a class="btn dark" href="${e(link)}" aria-label="${e(`${label} — يُقدَّم من «${data.start.module_name??'شاشته المخصصة'}»`)}">${label} في «${e(data.start.module_name??'شاشته المخصصة')}»</a>`;
  return `<button type="button" class="btn dark" data-action="pick-service" data-id="${e(data.start.service_id)}" aria-label="${e(`${label}: ${data.name}`)}">${label}</button>`;
}

export const servicePageSkeleton=()=>`<div class="sc-sections" aria-busy="true" role="status">`
  +`<span class="sr-only">جارٍ تحميل صفحة الخدمة…</span>`
  +Array.from({length:4},()=>`<div class="sc-skeleton" aria-hidden="true"><span></span><span></span></div>`).join('')+`</div>`;

export function servicePageView(data,{e,ui}){
  const crumbs=data.breadcrumb.map((step,index)=>index===data.breadcrumb.length-1
    ?`<strong aria-current="page">${e(step.label)}</strong>`
    :`<a href="${e(step.href)}">${e(step.label)}</a> <span aria-hidden="true">›</span> `).join('');

  // (١) سياقك أنت — ثلاثة بنود مقروءة من جداول قائمة. البند الذي لا قيمة له لا يُرسم سطرًا فارغًا.
  const facts=[data.facts.manager_name?{title:'مديرك المباشر',meta:data.facts.manager_name}:null,
    data.facts.department_name?{title:'إدارتك',meta:data.facts.department_name}:null,
    data.facts.last_request?{title:'آخر طلب لك على هذه الخدمة',meta:data.facts.last_request.on,
      html:ui.statusBadge(data.facts.last_request.status),href:`#request/${data.facts.last_request.id}`}:null,
    data.facts.earlier_requests?{title:'عدد طلباتك السابقة عليها',meta:countNoun(data.facts.earlier_requests,'request')}:null].filter(Boolean);
  const context=facts.length?`<section class="panel"><div class="panel-head"><h2>سياقك أنت</h2></div>`
    +`<ul class="vn-list">${facts.map(fact=>ui.row(fact)).join('')}</ul></section>`:'';

  // (٢) ما الذي ستحتاجه — حقول التعريف بإلزامها وشرطها وإرشادها كما يفرضها الخادم.
  const inputs=data.inputs.length?fold('ما الذي ستحتاجه؟',`<ul class="vn-list">${data.inputs.map(field=>inputRow(field,e,ui)).join('')}</ul>`,
    {e,meta:e(countNoun(data.inputs.length,['حقل واحد','حقلان','حقول','حقلًا']))}):'';

  // (٣) المستندات المطلوبة — لا تُرسم عنوانًا فوق فراغ؛ غيابها مكتوب في كتلة «ما ليس هنا بعد».
  const documents=data.documents.length?fold('المستندات المطلوبة',`<ul class="vn-list">${data.documents.map(name=>ui.row({title:name})).join('')}</ul>`,
    {e,meta:e(countNoun(data.documents.length,['مستند واحد','مستندان','مستندات','مستندًا']))}):'';

  // (٤) كيف يتحرك طلبك — قائمة مرقّمة تُقرأ «١ من ٤»، ومعها سند التنفيذ ومرجع التصعيد.
  const steps=[...data.workflow.approves.map((who,index)=>[who,`الاعتماد ${index+1}`]),[data.workflow.executes,'التنفيذ والإغلاق بدليل']];
  const route=fold('كيف يتحرك طلبك؟',`<div class="panel-body">`
    +`<ol class="rq-trail">${steps.map(([who,what])=>`<li><strong>${e(who)}</strong><span>${e(what)}</span></li>`).join('')}</ol>`
    +`<p class="subtle">${e(`سند التنفيذ: ${data.workflow.execution_basis}`)}</p>`
    +(data.escalates_to?`<p class="subtle">${e(`مرجع تصعيد الإدارة: ${data.escalates_to}`)}</p>`:'')
    +`<p class="subtle">${e(data.lifecycle)}</p></div>`,{e,meta:e(countNoun(steps.length,['خطوة واحدة','خطوتان','خطوات','خطوة']))});

  // (٥) هل يكون المعتمِد هو المنفّذ؟ — بنصّها القائم حرفًا بحرف، ولا تُختصر.
  const separation=fold('هل يكون المعتمِد هو المنفّذ؟',`<div class="panel-body"><p>${e(data.workflow.same_person_note)}</p><p class="subtle">${e(data.audit_note)}</p></div>`,
    {e,meta:`<span class="badge ${data.workflow.separation_of_duties?'approved':'pending'}">${data.workflow.separation_of_duties?'فصل مهام مُشغَّل':'الجمع غير ممنوع'}</span>`});

  // (٦) السياسة المرجعية — تُرسم حين تكون مكتوبة في بطاقة تعريف منشورة، ولا تُرسم فارغة.
  const policy=data.policy_reference?fold('السياسة المرجعية',`<div class="panel-body"><p>${e(data.policy_reference)}</p></div>`,{e}):'';

  // (٧) خدمات قريبة — أخوة المجموعة أولًا ثم أخوة الفئة، اشتقاقًا لا بجدول علاقات مخترع. الخدمة رابطٌ إلى
  // صفحتها؛ والمجموعة بلا صفحة فبابها زرّ الخيارات نفسه (pick-variant) لا سطرٌ ميت.
  const fromGroup=data.nearby.some(item=>item.from==='group');
  // المجموعة القريبة بابها معها: نافذة الخيارات، أو شاشة وحدتها حين تكون أعضاؤها وحداتٍ وحدها (link من الخادم)، أو تعطيلٌ
  // بسببه المكتوب — لا زرّ خيارات لمجموعةٍ لا تعرفها نافذة الخيارات فيُردّ بخطأ عارٍ (مراجعة 23 سبتمبر).
  const nearbyRow=item=>item.kind==='group'
    ?ui.row({title:item.name,meta:`مجموعة خيارات — ${countNoun(item.items??0,'service')}`,href:item.link||'',
      html:item.link?'':item.eligible===false
        ?`<span class="btn outline small" aria-disabled="true">اختر النوع<small class="subtle"> — ${e(item.eligibility_reason)}</small></span>`
        :`<button type="button" class="btn outline small" data-action="pick-variant" data-group="${e(item.key)}" aria-label="${e(`ابدأ الطلب: ${item.name} — اختر النوع أولًا`)}">اختر النوع</button>`})
    :ui.row({title:item.name,meta:item.from==='group'?'خيار من المجموعة نفسها':'',href:item.href||''});
  const nearby=data.nearby.length?fold('خدمات قريبة',`<ul class="vn-list">${data.nearby.map(nearbyRow).join('')}</ul>`,
    {e,meta:fromGroup?'من مجموعتها أولًا، ثم من فئتها':'من الفئة نفسها'}):'';

  const stopped=data.stopped_note?`<p class="vn-alert is-block" role="alert"><strong>موقوفة من الإعدادات</strong> ${e(data.stopped_note)}</p>`:'';
  const group=data.group?`<p class="subtle">${e(`تُبلَغ هذه الخدمة أيضًا من بطاقة «${data.group.name}» في التصفّح.`)}</p>`:'';
  // ت1: موضع العرض وملكيته — تسميتان لا قرار. ما نُقل إلى صفحة إدارته يقول أين يُعرض ويقود إليها، وخدمات ADM- تقول من ينفّذها مؤقتًا.
  const placement=data.placement?.kind==='department'?`<p class="subtle">${e(data.placement.text)} <a href="${e(data.placement.href)}">صفحة الإدارة ←</a></p>`:'';
  const interim=data.owner?.interim?`<p class="subtle">${e(`${data.owner.name} — ${data.owner.interim}`)}</p>`:'';
  const back=data.back??(data.category?{label:'العودة إلى الفئة',href:`#services/category/${data.category.key}`}:{label:'العودة إلى الخدمات',href:'#services'});

  return `<p class="rq-crumbs">${crumbs}</p>`
    +ui.pageHead(data.name,data.description,startAction(data,e))
    +`<p class="notice" role="status">${e(data.documentation_note)} <span class="subtle">${e(data.readiness)}</span></p>`
    +stopped+placement+interim+group
    +`<div class="sc-sections">${context}${inputs}${documents}${route}${separation}${timeBlock(data,e)}${policy}${nearby}`
    +gapsBlock(data.gaps,{e},'ما ليس في هذه الصفحة بعد، ولماذا، وما يلزم')+`</div>`
    +`<div class="sc-sticky">${startAction(data,e)}`
    +`<a class="btn outline" href="${e(back.href)}">${e(back.label)} ←</a></div>`;
}
