// الخيارات المُدارة (الترحيل 134): «لازم يكون فيه خيارات لكل معلومه مهمه بكل المنصه».
//
// كل معلومة مهمة تصير واحدة من اثنتين:
//   (أ) **قائمة خيارات** يديرها المالك: يضيف، يعطّل، يعيد الترتيب، يعيد التسمية — بسبب وتاريخ ومن غيّر.
//   (ب) **قيمة باعتماد مؤرَّخ**: قرّرها إنسان، ومعها أساسها ومصدرها وتاريخ سريانها، ويعتمدها غيره.
// ولا شيء مهم يبقى نصًّا حرًّا، ولا اختيارًا مدفونًا في الكود لا يبلغه المالك.
//
// والحدّ الذي يعلو القاعدة: ما تثبّته اللائحة الموقّعة أو النظام لا يصير تفضيلًا. ست ساعات في رمضان (م73/2) ليست
// رأيًا، وحدّ 10% لاسترداد قرض المنشأة وربع الأجر في دين المحكوم به (م51) ليسا رأيًا. تلك تبقى مربوطة بمادتها،
// وتُفتح **للقراءة فقط** ومعها المادة: يراها المالك ولا يوسّعها بصمت (governance='legally_fixed').
//
// المفردات منسوخة بالحرف من سجل التعريفات (الترحيل 123) ولا تُخترع من جديد: value/label/tone، و«معطَّل» مكان
// retired، والتصنيفات الثلاث additive/tightening/loosening، و«الخيار المنشور لا يُحذف بل يُعطَّل حتى تبقى السجلات
// القديمة مقروءة»، و«ما يخفّف ضابطًا يراه شخص ثانٍ». وما ليس منها: المخزن — صفوف لا وثيقة JSON، لأسباب مكتوبة
// في رأس app/migrations/134-managed-options.sql.
//
// النسخة 0 = افتراضات الكود. الجداول تبدأ فارغة، وصفٌّ يوجد حيث مسّ إنسانٌ شيئًا فقط، فاليوم الأول مطابق تمامًا.
// والواصف يسجّله صاحبه: كل وحدة تنادي registerOptionList عند تحميلها — الاصطلاح نفسه الذي يعمل به
// registerEntity في app/definitions.mjs، فلا قاموس ثانٍ ينحرف عن الكود.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { can, isSuperAdmin } from './access.mjs';
import * as v from './validation.mjs';

const LIST_KEY=/^[a-z][a-z._]{2,59}$/;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():'';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

/* ───── تصنيف التغيير: الخادم يضعه لا الفاعل ───── */
// الخريطة نفسها المكتوبة في الترحيل، فلا تُشتق مرتين بصيغتين. إضافة خيار تُوسّع المجموعة المقبولة فهي «تخفيف»،
// وتعطيله يُضيّقها فهو «تشديد»، والترتيب والتسمية «إضافة».
export const CHANGE_CLASS=Object.freeze({added:'loosening',enabled:'loosening',disabled:'tightening',reordered:'additive',relabelled:'additive'});
export const REASON_CODES=Object.freeze([
  ['new_activity','نشاط جديد للشركة'],['superseded','حلّ محلّه خيار آخر'],['error','خطأ في الإدخال يُصحَّح'],
  ['policy_change','تغيّر سياسة داخلية'],['regulator','متطلب جهة تنظيمية'],['merged','دُمج في خيار آخر'],['other','سبب آخر يُكتب كاملًا']
].map(([code,name])=>({code,name})));
export const GOVERNANCE_NAMES=Object.freeze({managed:'يديرها المالك',legally_fixed:'مثبّتة نظامًا — للقراءة فقط',
  bounded:'يديرها المالك داخل حدّ محروس',db_locked:'مقفلة بقيد في قاعدة البيانات — تُقرأ ولا تُحرَّر'});
// القائمة المقفلة بقيد CHECK ليست تفضيلًا مدفونًا في الكود: هي قفل مزدوج (كود **وقاعدة**)، وفتحها يعني إعادة
// بناء الجدول بنمط الترحيل 031. تُعرض للمالك بقيدها ورقم ترحيلها ليرى **لماذا** هي مقفلة، بدل أن تغيب عنه.
const READ_ONLY=new Set(['legally_fixed','db_locked']);

// شكل الاستشهاد: «مثبّتة نظامًا» أقوى تصنيف في هذه الآلة — تُقفل القائمة للقراءة إلى الأبد ويُقال للمستخدم
// «ليست تفضيلًا». فلا تُقبل بدعوى مجرّدة: إمّا مادة يجدها القارئ (م111، م73/2، المادة الثالثة عشرة…)، وإمّا
// إقرارٌ صريح بأن الاستشهاد **لم يُسجَّل بعد** ومن يملك تسجيله — فيصير الفراغ بندًا مفتوحًا يراه المالك، لا
// ادّعاءً صامتًا. والاختراع ممنوع: مرجعٌ لا يملكه المستودع لا يُكتب رقمًا من الذاكرة.
const CITATION=/(^|\s|—|-)(م\s*\(?\d|مادة\s*\(?\d|المادة\s|Art\.?\s*\d|Article\s*\d)/u;
const articleOrBad=(d,bad,what)=>{
  const ref=text(d.article?.ref);
  if(!ref)bad(`${what} تحمل مادتها (article.ref) وإلا صارت تفضيلًا`);
  if(CITATION.test(ref))return;
  const p=d.article?.pending;
  if(!plain(p)||!text(p.why)||!text(p.owner))
    bad(`${what}: «${ref}» يسمّي الأداة ولا يسمّي مادتها. اكتب المادة في article.ref، أو أقرّ صراحةً بـarticle.pending:{why,owner} حتى يُسجَّل الاستشهاد`);
};

/* ───── سجل الواصفات: الكود لا الصفوف ───── */
const LISTS=new Map(),ADOPTIONS=new Map();

// خطأ في الواصف خطأ مبرمج يُرفع TypeError عند أول تحميل، لا رفضًا يصل إلى مستخدم — قاعدة registerEntity نفسها.
export function registerOptionList(descriptor){
  const d=descriptor,bad=message=>{throw new TypeError(`registerOptionList(${d?.key??'?'}): ${message}`);};
  if(!plain(d)||!LIST_KEY.test(d.key??''))bad('مفتاح القائمة أحرف لاتينية صغيرة ونقطة وشرطة سفلية، من 3 إلى 60');
  if(LISTS.has(d.key))bad('القائمة مسجّلة مرتين؛ الواصف يعيش في وحدة واحدة');
  if(!text(d.label))bad('اسم القائمة العربي مطلوب — الرفض يسمّي الحقل به');
  if(!text(d.module))bad('اسم الوحدة المالكة مطلوب');
  if(!text(d.owner))bad('من يملك القائمة (owner) مطلوب: كل رفض يسمّيه');
  if(!Object.hasOwn(GOVERNANCE_NAMES,d.governance))bad(`الحوكمة إحدى: ${Object.keys(GOVERNANCE_NAMES).join('، ')}`);
  if(d.governance==='legally_fixed')articleOrBad(d,bad,'القائمة المثبّتة نظامًا');
  if(d.governance==='bounded'&&!text(d.bound?.because))bad('القائمة المحدودة تقول أي محرس يحدّها (bound.because)');
  if(d.governance==='db_locked'&&(!text(d.db_locked?.check)||!text(d.db_locked?.migration)))bad('القائمة المقفلة بالقاعدة تقول نصّ قيدها ورقم ترحيله');
  // شكل القيمة: العمود الذي تحكمه القائمة قد يحمل قيدًا لا تعرفه القائمة (finance_account_mappings.purpose
  // يقبل [a-z_] من 3 إلى 40 منذ الترحيل 031). بلا إعلانه هنا يمرّ الخيار ثم يسقط الكتابةُ بخطأ قاعدة خام —
  // عطل خادم لا رفض مكتوب. فمن يملك القائمة يعلن قيد عمودها، ونصّ القيد ورقم ترحيله يسافران في الرفض.
  if(d.value_shape!==undefined){
    const s=d.value_shape;
    if(!plain(s)||!text(s.because)||!text(s.migration))bad('value_shape يقول نصّ قيد العمود (because) ورقم ترحيله (migration)');
    if(s.pattern!==undefined&&!(s.pattern instanceof RegExp))bad('value_shape.pattern تعبير نمطي');
    if(s.max!==undefined&&!Number.isSafeInteger(s.max))bad('value_shape.max عدد صحيح');
    if(s.min!==undefined&&!Number.isSafeInteger(s.min))bad('value_shape.min عدد صحيح');
    for(const o of d.defaults)if(!valueShapeOk(s,o.value))bad(`الافتراض «${o.value}» لا يطابق قيد العمود المعلَن`);
  }
  if(!Array.isArray(d.defaults))bad('الافتراضات قائمة — وهي بذرة القائمة: ما هو سارٍ اليوم بالحرف');
  if(!d.defaults.length&&!text(d.mirror?.table))bad('قائمة بلا افتراضات ولا جدول مرآة لا تعرض شيئًا');
  const seen=new Set();
  for(const o of d.defaults){
    if(!text(o?.value)||text(o.value).length>60)bad('كل خيار قيمة نصية مشذَّبة لا تتجاوز 60 محرفًا');
    if(seen.has(o.value))bad(`القيمة «${o.value}» مكررة في الافتراضات`);
    seen.add(o.value);
    if(!text(o.label))bad(`الخيار «${o.value}» بلا اسم عربي`);
    if(o.state&&!['active','disabled'].includes(o.state))bad(`الخيار «${o.value}»: الحالة active أو disabled`);
  }
  if(!Array.isArray(d.columns)||!d.columns.every(c=>/^[a-z_]+\.[a-z_]+$/.test(c)))bad('columns: الأعمدة التي تحكمها هذه القائمة («الجدول.العمود»)، ولو واحدًا — بها يقيس المسح ما تحوَّل وما بقي');
  // extra_shape كان يُعلَن ولا يُفرَض، فغرضٌ يضيفه المالك بلا نوع حساب يصير ميّتًا في القائمة بلا ما يقول ذلك.
  // القيم المسموحة لكل حقل (extra_values) اختيارية: بها لا يصير الحقل نصًّا حرًّا داخل خيار مُدار.
  if(d.extra_shape!==undefined&&d.extra_shape!==null&&!plain(d.extra_shape))bad('extra_shape كائن {الحقل: وصفه العربي}');
  if(d.guard_disable!==undefined&&typeof d.guard_disable!=='function')bad('guard_disable دالّة (db,tenantId,value) تعيد null أو {what,document,why,next}');
  if(d.extra_values!==undefined){
    if(!plain(d.extra_values))bad('extra_values كائن {الحقل: [القيم المسموحة]}');
    for(const [field,values] of Object.entries(d.extra_values)){
      if(!Object.hasOwn(d.extra_shape??{},field))bad(`extra_values.${field} بلا وصف في extra_shape`);
      if(!Array.isArray(values)||!values.length)bad(`extra_values.${field} قائمة قيم غير فارغة`);
    }
  }
  const frozen=Object.freeze({label_en:'',owner_role:null,manage_capability:null,article:null,bound:null,second_person:false,
    db_locked:null,mirror:null,extra_shape:null,extra_values:null,value_shape:null,guard_disable:null,note:'',...d,columns:Object.freeze([...d.columns]),defaults:Object.freeze(d.defaults.map(o=>Object.freeze({...o})))});
  LISTS.set(frozen.key,frozen);
  return frozen;
}
// القيمة ذات الأساس المعتمد: واصفها يحمل قيمة الكود اليوم وأساسها، فغياب صفّ اعتماد ليس فراغًا بل «ما يقوله الكود».
export function registerAdoption(descriptor){
  const d=descriptor,bad=message=>{throw new TypeError(`registerAdoption(${d?.key??'?'}): ${message}`);};
  if(!plain(d)||!LIST_KEY.test(d.key??''))bad('مفتاح القيمة أحرف لاتينية صغيرة ونقطة وشرطة سفلية');
  if(ADOPTIONS.has(d.key))bad('القيمة مسجّلة مرتين');
  if(!text(d.label))bad('اسم القيمة العربي مطلوب');
  if(!text(d.module)||!text(d.owner))bad('الوحدة المالكة ومن يملك القرار مطلوبان');
  if(d.default===undefined)bad('قيمة الكود اليوم مطلوبة: هي الافتراضي حين لا اعتماد');
  if(!text(d.basis))bad('أساس قيمة الكود مطلوب: من أين جاءت');
  if(!Object.hasOwn(GOVERNANCE_NAMES,d.governance))bad(`الحوكمة إحدى: ${Object.keys(GOVERNANCE_NAMES).join('، ')}`);
  if(d.governance==='legally_fixed')articleOrBad(d,bad,'القيمة المثبّتة نظامًا');
  // نوع القيمة مطلوب: القرار المؤرَّخ يُقرأ بـ===true أو بحساب رقمي، فقيمة من نوع آخر تعني قرارًا موقَّعًا
  // بشخصين لا أثر له — ولا شيء في الشاشة ولا في السجل يقول إنه بلا أثر. النوع يُشتق من قيمة الكود حين لا يُعلَن.
  const shape=d.shape??shapeOf(d.default);
  if(!Object.hasOwn(SHAPE_NAMES,shape))bad(`shape إحدى: ${Object.keys(SHAPE_NAMES).join('، ')}`);
  if(shapeOf(d.default)!==shape)bad(`قيمة الكود من نوع ${SHAPE_NAMES[shapeOf(d.default)]??'غير معروف'} والمعلَن ${SHAPE_NAMES[shape]}`);
  const frozen=Object.freeze({owner_role:null,manage_capability:null,article:null,bound:null,schedule:null,...d,shape});
  ADOPTIONS.set(frozen.key,frozen);
  return frozen;
}
export const SHAPE_NAMES=Object.freeze({boolean:'صواب أو خطأ',number:'عدد',string:'نصّ',object:'كائن',list:'قائمة'});
const shapeOf=value=>Array.isArray(value)?'list':value===null?null:typeof value==='object'?'object'
  :['boolean','number','string'].includes(typeof value)?typeof value:null;
const valueShapeOk=(s,value)=>!s||((s.pattern?s.pattern.test(value):true)&&value.length>=(s.min??1)&&value.length<=(s.max??60));
export const optionListFor=key=>LISTS.get(key)??null;
export const adoptionFor=key=>ADOPTIONS.get(key)??null;
export const registeredLists=()=>[...LISTS.values()];
export const registeredAdoptions=()=>[...ADOPTIONS.values()];

function descriptorOrRefuse(listKey){
  const d=typeof listKey==='string'?LISTS.get(listKey):null;
  if(!d)refuse(404,'option_list_unknown',{what:'لا قائمة خيارات بهذا المفتاح',
    next:`القوائم المسجّلة الآن: ${[...LISTS.keys()].join('، ')}. قائمة جديدة يلزمها واصف في وحدتها، لا تُنشأ من الشاشة`});
  return d;
}

/* ───── القراءة: افتراضات الكود تعلوها طبقة المالك ───── */
// القائمة المرآة تقرأ صفوفها من جدولها (مركز التكلفة ← finance_cost_centers)، فالخيار **صفّ مُحال إليه** لا نصّ.
function baseOptions(db,tenantId,d){
  if(d.mirror){
    const rows=db.prepare(`SELECT id,${d.mirror.value} AS value,${d.mirror.label} AS label,active FROM ${d.mirror.table} WHERE tenant_id=? ORDER BY ${d.mirror.value}`).all(tenantId);
    return rows.map((r,index)=>({value:String(r.value),label:String(r.label),label_en:'',tone:'',extra:{},
      state:r.active?'active':'disabled',disabled_from:null,origin:'code',sort_order:index,ref_id:r.id,base_index:index,
      source:`${d.mirror.table} (${r.active?'نشط':'غير نشط'})`}));
  }
  return d.defaults.map((o,index)=>({value:o.value,label:o.label,label_en:o.label_en??'',tone:o.tone??'',extra:o.extra??{},
    state:o.state??'active',disabled_from:null,origin:'code',sort_order:index,ref_id:null,base_index:index,source:'افتراض الكود'}));
}
const ownerRows=(db,tenantId,listKey)=>db.prepare('SELECT * FROM option_values WHERE tenant_id=? AND list_key=?').all(tenantId,listKey);

// {key,label,governance,article,editable,owner,owner_role,bound,db_locked,options:[…]}
// الترتيب: sort_order ثم ترتيب الكود. والمعطَّل يسقط ما لم يُطلب صراحةً — فقراءة سجل قديم تراه، ونموذج جديد لا يراه.
export function optionsFor(db,tenantId,listKey,{date=null,include_disabled=false}={}){
  const d=descriptorOrRefuse(listKey),on=date??today();
  const overlay=new Map(ownerRows(db,tenantId,listKey).map(r=>[r.value,r]));
  const merged=baseOptions(db,tenantId,d).map(base=>{
    const row=overlay.get(base.value);
    overlay.delete(base.value);
    if(!row)return {...base,loosened:false};
    // state='base' يعني أن الصفّ وُجد بمسٍّ لا يقرّر التشغيل (ترتيب أو تسمية)، فالحالة تبقى حالةَ الكود.
    // وهذا هو السطر الذي كان يقلب خيارًا مشحونًا معطَّلًا إلى نشط لمجرد أن أحدًا أعاد ترتيبه.
    const state=row.state==='base'?base.state
      :row.state==='disabled'?(row.disabled_from<=on?'disabled':base.state)
      :'active';
    return {...base,label:row.label,label_en:row.label_en||base.label_en,tone:row.tone||base.tone,
      extra:row.extra?JSON.parse(row.extra):base.extra,sort_order:row.sort_order,ref_id:row.ref_id??base.ref_id,
      state,disabled_from:row.disabled_from??null,option_id:row.id,version:row.version,added_by:row.added_by,
      // «وسّعه إنسان»: خيارٌ شحنه الكود معطَّلًا وفعّله أحد. التعطيل تشديد لا يحتاج ثانيًا، والترتيب والتسمية إضافة.
      loosened:base.state==='disabled'&&row.state==='active',
      approved_by:row.approved_by,source:`${base.source} + طبقة المالك`};
  });
  // خيار أنشأه المالك من المنصة: لا أصل له في الكود، فيلحق بترتيبه المحفوظ — ووجوده نفسه توسيعٌ بيد إنسان.
  let extra=merged.length;
  for(const row of overlay.values())merged.push({value:row.value,label:row.label,label_en:row.label_en,tone:row.tone,
    extra:JSON.parse(row.extra),state:row.state==='disabled'&&row.disabled_from<=on?'disabled':row.state,
    origin:'owner',sort_order:row.sort_order,ref_id:row.ref_id,base_index:extra++,disabled_from:row.disabled_from??null,
    option_id:row.id,version:row.version,added_by:row.added_by,approved_by:row.approved_by,loosened:true,source:'أضافه المالك من المنصة'});
  merged.sort((a,b)=>a.sort_order-b.sort_order||a.base_index-b.base_index);
  // خيار ينتظر شخصًا ثانيًا لا يُعرض للاستعمال: القائمة التي تفتح بوابة (وثائق المورد) تتسع بيدين لا بيد.
  // والقاعدة على **كل** توسيع لا على الإضافة وحدها: الخادم يصنّف added وenabled كليهما loosening، فيطبّق عليهما
  // القاعدة نفسها. قبل هذا كان شخص واحد يفعّل شهادة الزكاة المشحونة معطَّلة، بينما يضيف نوعًا جديدًا فينتظر ثانيًا.
  const pending=o=>d.second_person&&o.loosened&&!o.approved_by;
  const options=merged.filter(o=>(include_disabled||o.state==='active')&&(include_disabled||!pending(o)))
    .map(({base_index,loosened,...o})=>({...o,awaiting_second_person:pending({...o,loosened})}));
  return {key:d.key,label:d.label,label_en:d.label_en,module:d.module,governance:d.governance,
    governance_name:GOVERNANCE_NAMES[d.governance],article:d.article,editable:!READ_ONLY.has(d.governance),
    owner:d.owner,owner_role:d.owner_role,manage_capability:d.manage_capability,bound:d.bound,db_locked:d.db_locked,
    second_person:d.second_person,extra_shape:d.extra_shape,extra_values:d.extra_values,value_hint:d.value_shape?.because??null,note:d.note,as_of:on,options};
}
// اسم الخيار كما يُقرأ. قيمة لم تعد في القائمة — أو سبقت القائمة أصلًا — تُعاد كما خُزّنت: مفتاح خام يُرى فيُصلح، لا فراغ.
export function optionLabel(db,tenantId,listKey,value){
  const found=optionsFor(db,tenantId,listKey,{include_disabled:true}).options.find(o=>o.value===value);
  return found?found.label:String(value??'');
}
// السطر الذي يجعل «التعطيل لا يعيد كتابة التاريخ» صحيحًا: on:'new' يرفض المعطَّل، وon:'read' يقبله.
export function validOption(db,tenantId,listKey,value,{on='new',date=null}={}){
  const list=optionsFor(db,tenantId,listKey,{date,include_disabled:on==='read'});
  return list.options.some(o=>o.value===value&&(on==='read'||!o.awaiting_second_person));
}
// الخطوة التالية على المثبّت نظامًا: أين يُقرأ النصّ. وحين لا يكون الاستشهاد مسجَّلًا بعد يُقال ذلك صراحةً
// ويُسمّى من يملك تسجيله — فالقارئ لا يُرسَل إلى إعادة صياغة للقاعدة يظنها مصدرها.
const citeNext=article=>article?.pending
  ?`المادة نفسها غير مسجّلة في المستودع بعد (${article.pending.why})؛ يملك تسجيلها ${article.pending.owner}`
  :`راجع ${article?.source||article?.ref}`;
// الرفض المكتوب: ما الذي رُفض، وما الناقص ومن يملكه، وما الخطوة التالية. المثبّتة نظامًا تقول مادتها.
export function requireOption(db,tenantId,listKey,value,{field=null,date=null}={}){
  if(validOption(db,tenantId,listKey,value,{on:'new',date}))return value;
  const d=descriptorOrRefuse(listKey),list=optionsFor(db,tenantId,listKey,{date});
  const name=field??d.label,offered=list.options.map(o=>o.label).join('، ');
  const disabled=optionsFor(db,tenantId,listKey,{date,include_disabled:true}).options.find(o=>o.value===value);
  // خيارٌ شُحن معطَّلًا في الكود لم يُعطَّل «منذ» تاريخ: لم يفعّله المالك بعدُ، وهذا ما يُقال له لا تاريخٌ لا وجود له.
  const why=disabled?.state==='disabled'?(disabled.disabled_from
      ?`«${disabled.label}» خيار معطَّل منذ ${disabled.disabled_from}؛ يبقى مقروءًا في السجلات القديمة ولا يُختار من جديد`
      :`«${disabled.label}» خيار موجود في القائمة ولم يفعّله ${d.owner} بعد`)
    :disabled?.awaiting_second_person?`«${disabled.label}» ${disabled.origin==='owner'?'أُضيف':'فُعِّل'} وينتظر اعتماد شخص ثانٍ قبل أن يُعرض`
    :`القيمة المرسلة ليست من خيارات «${d.label}»`;
  refuse(400,'option_not_offered',{what:`رُفضت قيمة «${name}»: ${why}`,
    missing:[{document:`خيار من قائمة «${d.label}»`,why:offered?`الخيارات المتاحة الآن: ${offered}`:'لا خيار متاح في القائمة بعد',
      owner:d.owner,owner_role:d.owner_role}],
    next:d.governance==='legally_fixed'
      ?`هذه القائمة مثبّتة بـ${d.article.ref} فلا تُوسَّع من المنصة. اختر من خياراتها، أو ${citeNext(d.article)}`
      :`اختر من الخيارات المعروضة، أو اطلب من ${d.owner} إضافة الخيار في «الخيارات المُدارة» بسبب وتاريخ`});
}

/* ───── القيمة ذات الأساس المعتمد ───── */
// أعلى صفّ معتمد سريانه قبل التاريخ أو عنده، وإلا افتراض الكود — ومعه مصدره دائمًا، فلا رقم بلا أصل.
export function adopted(db,tenantId,key,date=null){
  const d=ADOPTIONS.get(key);
  if(!d)refuse(404,'adoption_unknown',{what:'لا قيمة معتمدة بهذا المفتاح',
    next:`القيم المسجّلة الآن: ${[...ADOPTIONS.keys()].join('، ')}. قيمة جديدة يلزمها واصف في وحدتها`});
  const on=date??today();
  // المثبّتة نظامًا بجدول مؤرَّخ: النسبة تتبدّل بأداة تنظيمية لا بتفضيل، والأداة مذكورة بجوار كل مرحلة.
  if(d.schedule){
    const stage=[...d.schedule].filter(s=>s.from<=on).sort((a,b)=>b.from.localeCompare(a.from))[0]??d.schedule[0];
    return {key,value:stage.value,basis:stage.instrument,article:d.article?.ref??'',effective_from:stage.from,
      source:'legal_schedule',label:d.label,owner:d.owner,owner_role:d.owner_role,governance:d.governance,editable:false,approved_by:null};
  }
  const row=db.prepare('SELECT * FROM option_adoptions WHERE tenant_id=? AND key=? AND approved_by IS NOT NULL AND effective_from<=? ORDER BY effective_from DESC,approved_at DESC LIMIT 1').get(tenantId,key,on);
  if(!row)return {key,value:d.default,basis:d.basis,article:d.article?.ref??'',effective_from:null,source:'code_default',
    label:d.label,owner:d.owner,owner_role:d.owner_role,governance:d.governance,editable:!READ_ONLY.has(d.governance),approved_by:null};
  return {key,value:JSON.parse(row.value),basis:row.basis,article:row.article,effective_from:row.effective_from,source:'adopted',
    label:d.label,owner:d.owner,owner_role:d.owner_role,governance:d.governance,editable:!READ_ONLY.has(d.governance),
    approved_by:row.approved_by,recorded_by:row.recorded_by,adoption_id:row.id};
}

/* ───── الكتابة: كل تغيير بسبب وتاريخ وفاعل، وفي سلسلة التدقيق نفسها ───── */
function writing(db){
  if(!db.isTransaction)refuse(409,'transaction_required',{what:'لم تُكتب الخيارات: الكتابة خارج معاملة قاعدة بيانات',
    next:'نفّذ النداء داخل transaction(db,…) كما تفعل بقية وحدات المنصة'});
}
function manager(db,supplied,d){
  const u=actorOrRefuse(db,supplied);
  if(d.manage_capability&&!can(db,u,d.manage_capability))refuse(403,'not_permitted',{what:`إدارة قائمة «${d.label}» خارج تصاريح حسابك`,
    missing:[{document:`تصريح ${d.manage_capability}`,why:'هذه القائمة يملكها صاحب عمل الوحدة لا مسؤول المنصة',owner:d.owner,owner_role:d.owner_role}],
    next:'اطلب التصريح من مسؤول الصلاحيات، أو اطلب التغيير ممن يحمله'});
  return u;
}
function notFixed(db,d,what){
  if(!READ_ONLY.has(d.governance))return;
  if(d.governance==='db_locked')refuse(409,'db_locked',{what:`${what}: «${d.label}» قائمة مقفلة بقيد في قاعدة البيانات، فلا تُوسَّع من الشاشة`,
    missing:[{document:`ترحيل يعيد بناء الجدول (القيد ${d.db_locked.check})`,why:`القيد مطبَّق منذ الترحيل ${d.db_locked.migration}، والقيد المطبَّق لا يُعدَّل`,owner:d.owner,owner_role:d.owner_role}],
    next:'فتح هذه القائمة يحتاج ترحيلًا يعيد بناء الجدول بنمط الترحيل 031، يُراجَع وحده. وهي معروضة هنا لتُرى لا لتُحرَّر'});
  refuse(409,'legally_fixed',{what:`${what}: «${d.label}» قائمة مثبّتة بـ${d.article.ref} ولا تُوسَّع ولا تُضيَّق من المنصة`,
    missing:[{document:`تعديل ${d.article.ref}`,why:d.article.source??'نصّ مثبّت في اللائحة الموقّعة أو النظام',owner:d.owner,owner_role:d.owner_role}],
    next:'تُقرأ هذه القائمة ولا تُحرَّر. ما يتغيّر فيها يتغيّر بتعديل مادتها لا بقرار داخلي'});
}
// القائمة المرآة: خيارها صفٌّ حقيقي في جدول آخر. كل ما يغيّر **وجود** الخيار أو **اسمه** يقع هناك لا في الطبقة،
// وإلا تفرّق مصدرا الحقيقة: مركزٌ معطَّل في الطبقة ونشط في الدفتر، أو اسمان لصفٍّ واحد. الإضافة كانت محروسة
// وحدها، فكان التعطيل يجعل resolveCostCenter يعيد id:null بينما الدفتر ما زال يعرض المركز ويقبله.
function mirrored(d,what,verb){
  refuse(409,'mirrored_list',{what:`${what}: «${d.label}» قائمة مرآة لجدول ${d.mirror.table}، فلا يقع هذا التغيير في طبقة الخيارات`,
    missing:[{document:d.mirror.creates,why:'الخيار صفٌّ حقيقي تُحال إليه السجلات، لا نصّ في قائمة',owner:d.owner,owner_role:d.owner_role}],
    next:`${verb} في ${d.mirror.screen} فينعكس في هذه القائمة تلقائيًا`});
}
function logChange(db,u,d,value,change,input,reason){
  const effective=input.effective_on?v.date(input.effective_on):today();
  const code=text(input.reason_code);
  if(!REASON_CODES.some(r=>r.code===code))refuse(400,'reason_code',{what:'رُفض التغيير: سبب التغيير المصنَّف غير مختار',
    missing:[{document:'تصنيف السبب',why:`الأسباب المتاحة: ${REASON_CODES.map(r=>r.name).join('، ')}`,owner:d.owner,owner_role:d.owner_role}],
    next:'اختر تصنيف السبب ثم اكتب السبب كاملًا'});
  db.prepare('INSERT INTO option_changes(id,tenant_id,list_key,value,change,class,reason_code,reason,effective_on,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,d.key,value,change,CHANGE_CLASS[change],code,reason,effective,u.id,now());
  return effective;
}
const reasonText=(input,change)=>v.text(input.reason,`سبب ${({added:'إضافة الخيار',disabled:'تعطيل الخيار',enabled:'إعادة تفعيل الخيار',reordered:'إعادة الترتيب',relabelled:'إعادة التسمية'})[change]}`,2000,10);

export function addOption(db,supplied,listKey,input){
  writing(db);
  const d=descriptorOrRefuse(listKey),u=manager(db,supplied,d);
  notFixed(db,d,'لم يُضف الخيار');
  v.object(input,['value','label','label_en','tone','extra','reason','reason_code','effective_on']);
  const value=v.text(input.value,`قيمة الخيار في «${d.label}»`,60,1);
  const existing=optionsFor(db,u.tenant_id,listKey,{include_disabled:true});
  if(existing.options.some(o=>o.value===value))refuse(409,'option_exists',{what:`«${value}» خيار موجود في «${d.label}»`,
    missing:[{document:'قيمة غير مستعملة',why:'القيمة مفتاح السجلات التي اختارتها، فلا تتكرر',owner:d.owner,owner_role:d.owner_role}],
    next:'إن كان الخيار معطَّلًا فأعِد تفعيله بدل إضافته من جديد'});
  if(d.mirror)mirrored(d,'لم يُنشأ الخيار','أنشئ السجل');
  // قيد العمود يُفحص هنا لا في القاعدة: الرفض يسمّي الحقل ونصّ قيده ورقم ترحيله ومالكه، بدل ERR_SQLITE_ERROR.
  if(!valueShapeOk(d.value_shape,value))refuse(400,'option_value_shape',{what:`رُفضت قيمة الخيار «${value}» في «${d.label}»: لا تطابق قيد عمودها في قاعدة البيانات`,
    missing:[{document:`قيمة تطابق: ${d.value_shape.because}`,why:`القيد مطبَّق على العمود منذ الترحيل ${d.value_shape.migration}، فقيمةٌ خارجه تسقط عند أول كتابة لا عند الإضافة`,owner:d.owner,owner_role:d.owner_role}],
    next:'اكتب القيمة داخل القيد، واجعل الاسم العربي هو ما يقرؤه الناس'});
  // الحقول الإضافية المعلَنة في الواصف: المعلَن يُفرض، وإلا صار الخيار معروضًا وميّتًا بلا ما يقول ذلك.
  const extraInput=plain(input.extra)?input.extra:{};
  for(const [field,label] of Object.entries(d.extra_shape??{})){
    const given=text(extraInput[field]),allowed=d.extra_values?.[field]??null;
    if(!given)refuse(400,'option_extra_required',{what:`رُفضت إضافة «${value}» في «${d.label}»: حقل مطلوب ناقص`,
      missing:[{document:`${label} (${field})`,why:allowed?`القيم المتاحة: ${allowed.join('، ')}`:'الواصف يعلن هذا الحقل، والخيار بلا قيمته لا يُستعمل في أي مسار',owner:d.owner,owner_role:d.owner_role}],
      next:'أرسل الحقل مع الخيار، أو اطلب من مالك القائمة إسقاطه من الواصف'});
    if(allowed&&!allowed.includes(given))refuse(400,'option_extra_value',{what:`رُفضت إضافة «${value}» في «${d.label}»: «${given}» ليست من قيم «${label}»`,
      missing:[{document:`قيمة من: ${allowed.join('، ')}`,why:'قيمة خارج هذه المجموعة تجعل الخيار معروضًا ولا يطابقه شيء',owner:d.owner,owner_role:d.owner_role}],
      next:'اختر من القيم المعروضة'});
  }
  const reason=reasonText(input,'added'),id=randomUUID(),time=now();
  const order=existing.options.length?Math.max(...existing.options.map(o=>o.sort_order))+1:0;
  const extra=extraInput;
  db.prepare('INSERT INTO option_values(id,tenant_id,list_key,value,origin,label,label_en,tone,extra,sort_order,state,added_by,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,u.tenant_id,d.key,value,'owner',v.text(input.label,'اسم الخيار العربي',120,2),input.label_en?v.text(input.label_en,'اسم الخيار الإنجليزي',120):'',
      input.tone?v.text(input.tone,'لون الشارة',30):'',JSON.stringify(extra),order,'active',u.id,time);
  logChange(db,u,d,value,'added',input,reason);
  audit(db,u,'option_value',id,'option.added',{},{list_key:d.key,value,class:CHANGE_CLASS.added,second_person:d.second_person},reason);
  return optionsFor(db,u.tenant_id,listKey,{include_disabled:true});
}

const ACTIONS=['disable','enable','reorder','relabel','approve'];
export function optionAction(db,supplied,listKey,value,action,input){
  writing(db);
  const d=descriptorOrRefuse(listKey),u=manager(db,supplied,d);
  if(!ACTIONS.includes(action))refuse(404,'action_unknown',{what:'إجراء غير معروف على قائمة خيارات',
    next:`الإجراءات المتاحة: ${ACTIONS.join('، ')}`});
  notFixed(db,d,'لم يُنفَّذ الإجراء');
  const current=optionsFor(db,u.tenant_id,listKey,{include_disabled:true}).options.find(o=>o.value===value);
  if(!current)refuse(404,'option_unknown',{what:`لا خيار بالقيمة «${value}» في «${d.label}»`,
    next:'افتح القائمة واختر من خياراتها المعروضة'});
  const time=now();
  // صفّ الطبقة يُنشأ عند أول مسّ: خيار الكود الذي لم يمسّه أحد لا صف له. ويُكتب بحالة 'base' لا 'active':
  // إنشاء الصفّ واقعةُ مسٍّ، لا قرارَ تشغيل. القرار يكتبه disable أو enable وحدهما أدناه.
  const row=db.prepare('SELECT * FROM option_values WHERE tenant_id=? AND list_key=? AND value=?').get(u.tenant_id,d.key,value)??(()=>{
    const id=randomUUID();
    db.prepare('INSERT INTO option_values(id,tenant_id,list_key,value,origin,label,label_en,tone,extra,sort_order,state,ref_id,added_by,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,u.tenant_id,d.key,value,'code',current.label,current.label_en,current.tone,JSON.stringify(current.extra),current.sort_order,'base',current.ref_id,u.id,time);
    return db.prepare('SELECT * FROM option_values WHERE id=?').get(id);
  })();
  if(action==='approve'){
    if(!d.second_person)refuse(409,'no_second_person',{what:`«${d.label}» لا تشترط شخصًا ثانيًا، فلا اعتماد لخيارها`,
      next:'الخيار متاح للاستعمال بمجرد إضافته في هذه القائمة'});
    if(row.approved_by)refuse(409,'already_approved',{what:`«${current.label}» معتمد بالفعل`,next:'لا يلزم إجراء آخر'});
    // من وسّع لا يعتمد توسيعه. والموسِّع ليس دائمًا من أنشأ الصفّ: قد ينشئه من أعاد التسمية ثم يفعّله غيره،
    // فيُقرأ آخر فاعل «تفعيل» من السجل الإلحاقي نفسه الذي يحفظ من غيّر ولماذا، لا من عمود ثانٍ ينحرف عنه.
    const enabler=db.prepare("SELECT actor_id FROM option_changes WHERE tenant_id=? AND list_key=? AND value=? AND change='enabled' ORDER BY seq DESC LIMIT 1").get(u.tenant_id,d.key,value)?.actor_id;
    if((enabler??row.added_by)===u.id)refuse(409,'separation_of_duties',{what:`من ${enabler?'فعّل':'أضاف'} «${current.label}» لا يعتمده بنفسه`,
      missing:[{document:'اعتماد شخص ثانٍ',why:'هذه القائمة تفتح بوابة عمل، فاتساعها يراه شخصان',owner:d.owner,owner_role:d.owner_role}],
      next:`اطلب الاعتماد من زميل آخر يحمل ${d.manage_capability??'التصريح نفسه'}`});
    db.prepare('UPDATE option_values SET approved_by=?,approved_at=?,version=version+1 WHERE id=? AND version=?').run(u.id,time,row.id,row.version);
    audit(db,u,'option_value',row.id,'option.approved',{approved_by:null},{list_key:d.key,value,approved_by:u.id},v.text(input.reason,'أساس الاعتماد',2000,10));
    return optionsFor(db,u.tenant_id,listKey,{include_disabled:true});
  }
  const change={disable:'disabled',enable:'enabled',reorder:'reordered',relabel:'relabelled'}[action];
  // الترتيب وحده عرضٌ، فيبقى في الطبقة. التعطيل والتفعيل وإعادة التسمية تقع في جدول المرآة نفسه.
  if(d.mirror&&action!=='reorder')mirrored(d,`لم يُنفَّذ «${({disable:'التعطيل',enable:'إعادة التفعيل',relabel:'إعادة التسمية'})[action]}»`,
    action==='relabel'?'أعد تسمية الصفّ':action==='disable'?'أوقف الصفّ':'أعد تفعيل الصفّ');
  v.object(input,['reason','reason_code','effective_on',...(action==='reorder'?['sort_order']:[]),...(action==='relabel'?['label','label_en','tone']:[])]);
  const reason=reasonText(input,change);
  // التعطيل لا يعيد كتابة التاريخ: يمنع الاستعمال الجديد من تاريخه، ويبقى السجل القديم يقرأ اسم خياره.
  if(action==='disable'){
    if(current.state==='disabled')refuse(409,'already_disabled',{what:current.disabled_from?`«${current.label}» معطَّل منذ ${current.disabled_from}`:`«${current.label}» معطَّل في الكود ولم يفعّله أحد بعد`,
      next:'لا يلزم إجراء آخر؛ لتشغيله استعمل «إعادة التفعيل»'});
    if(d.bound&&optionsFor(db,u.tenant_id,listKey).options.length<=d.bound.floor)
      refuse(409,'bound_floor',{what:`لم يُعطَّل «${current.label}»: القائمة عند حدّها الأدنى (${d.bound.floor})`,
        missing:[{document:'خيار بديل نشط',why:d.bound.because,owner:d.owner,owner_role:d.owner_role}],
        next:'فعّل خيارًا بديلًا أولًا، ثم عطّل هذا'});
    // حارس تكتبه الوحدة المالكة: قاعدةٌ في الكود ما زالت تفرض هذا الخيار، فتعطيله من القائمة يحبس سجلًا جاريًا
    // بين رفضين — لا الاختيار يُقبل ولا التقديم يمرّ. الحارس يعيش حيث تعيش القاعدة، لا في آلة الخيارات.
    const guard=d.guard_disable?.(db,u.tenant_id,value)??null;
    if(guard)refuse(409,'option_in_use',{what:`لم يُعطَّل «${current.label}»: ${guard.what}`,
      missing:[{document:guard.document,why:guard.why,owner:d.owner,owner_role:d.owner_role}],next:guard.next});
    const effective=logChange(db,u,d,value,change,input,reason);
    db.prepare("UPDATE option_values SET state='disabled',disabled_from=?,version=version+1 WHERE id=? AND version=?").run(effective,row.id,row.version);
  }
  if(action==='enable'){
    if(current.state==='active')refuse(409,'already_active',{what:`«${current.label}» نشط بالفعل`,next:'لا يلزم إجراء آخر'});
    logChange(db,u,d,value,change,input,reason);
    // التفعيل توسيع (CHANGE_CLASS.enabled='loosening')، فعلى القائمة التي تفتح بوابة يُمحى الاعتماد السابق:
    // خيارٌ اعتُمد ثم عُطِّل ثم أُعيد تفعيله بيد واحدة ليس خيارًا رآه شخصان. يبقى محجوبًا حتى يعتمده غير من فعّله.
    if(d.second_person)db.prepare("UPDATE option_values SET state='active',disabled_from=NULL,approved_by=NULL,approved_at=NULL,version=version+1 WHERE id=? AND version=?").run(row.id,row.version);
    else db.prepare("UPDATE option_values SET state='active',disabled_from=NULL,version=version+1 WHERE id=? AND version=?").run(row.id,row.version);
  }
  if(action==='reorder'){
    if(!Number.isSafeInteger(input.sort_order)||input.sort_order<0||input.sort_order>999)
      refuse(400,'sort_order',{what:'رُفض الترتيب: موضع الخيار عدد صحيح بين 0 و999',next:'أرسل موضعًا صحيحًا داخل المدى'});
    logChange(db,u,d,value,change,input,reason);
    db.prepare('UPDATE option_values SET sort_order=?,version=version+1 WHERE id=? AND version=?').run(input.sort_order,row.id,row.version);
  }
  if(action==='relabel'){
    logChange(db,u,d,value,change,input,reason);
    db.prepare('UPDATE option_values SET label=?,label_en=?,tone=?,version=version+1 WHERE id=? AND version=?')
      .run(v.text(input.label,'اسم الخيار العربي',120,2),input.label_en?v.text(input.label_en,'اسم الخيار الإنجليزي',120):row.label_en,
        input.tone===undefined?row.tone:text(input.tone),row.id,row.version);
  }
  audit(db,u,'option_value',row.id,'option.'+change,{state:current.state,label:current.label,sort_order:current.sort_order},
    {list_key:d.key,value,class:CHANGE_CLASS[change]},reason);
  return optionsFor(db,u.tenant_id,listKey,{include_disabled:true});
}

export function adoptionAction(db,supplied,key,action,input){
  writing(db);
  const d=ADOPTIONS.get(key);
  if(!d)refuse(404,'adoption_unknown',{what:'لا قيمة معتمدة بهذا المفتاح',next:`القيم المسجّلة: ${[...ADOPTIONS.keys()].join('، ')}`});
  const u=actorOrRefuse(db,supplied);
  if(d.manage_capability&&!can(db,u,d.manage_capability))refuse(403,'not_permitted',{what:`تقرير «${d.label}» خارج تصاريح حسابك`,
    missing:[{document:`تصريح ${d.manage_capability}`,why:'هذه القيمة يقررها صاحب عملها',owner:d.owner,owner_role:d.owner_role}],
    next:'اطلب التصريح من مسؤول الصلاحيات، أو اطلب القرار ممن يحمله'});
  if(d.governance==='legally_fixed'||d.schedule)refuse(409,'legally_fixed',{what:`«${d.label}» قيمة مثبّتة بـ${d.article?.ref??'نصّ نظامي'} فلا تُقرَّر داخليًا`,
    missing:[{document:`تعديل ${d.article?.ref??'النصّ النظامي'}`,why:d.article?.source??'نصّ مثبّت خارج قرار الشركة',owner:d.owner,owner_role:d.owner_role}],
    next:'تُقرأ هذه القيمة ومعها مادتها، ولا تُحرَّر من المنصة'});
  const time=now();
  if(action==='record'){
    v.object(input,['value','basis','effective_from']);
    if(input.value===undefined)refuse(400,'adoption_value',{what:`رُفض تقرير «${d.label}»: لا قيمة مرسلة`,next:'أرسل القيمة مع أساسها وتاريخ سريانها'});
    // النوع يُفحص عند التسجيل: قرارٌ يُقرأ بـ===true وقيمته النصّ "true" قرارٌ مؤرَّخ يوقّعه شخصان ولا يفعل شيئًا،
    // ولا شيء في الشاشة ولا في السجل يقول إنه بلا أثر. الرفض يقول أي نوع تنتظره القيمة وأي نوع أُرسل.
    if(shapeOf(input.value)!==d.shape)refuse(400,'adoption_shape',{what:`رُفض تقرير «${d.label}»: القيمة من نوع ${SHAPE_NAMES[shapeOf(input.value)]??'غير معروف'} والقرار ينتظر ${SHAPE_NAMES[d.shape]}`,
      missing:[{document:`قيمة من نوع ${SHAPE_NAMES[d.shape]}`,why:`المنصة تقرأ هذه القيمة بنوعها؛ قيمة من نوع آخر تمرّ ولا يسري أثرها (قيمة الكود اليوم: ${JSON.stringify(d.default)})`,owner:d.owner,owner_role:d.owner_role}],
      next:`أرسل القيمة بنوعها (${SHAPE_NAMES[d.shape]}) لا نصًّا يشبهها`});
    const id=randomUUID(),effective=v.date(input.effective_from);
    if(db.prepare('SELECT 1 FROM option_adoptions WHERE tenant_id=? AND key=? AND effective_from=?').get(u.tenant_id,key,effective))
      refuse(409,'duplicate_adoption',{what:`لـ«${d.label}» قرار بتاريخ السريان نفسه`,
        missing:[{document:'تاريخ سريان آخر',why:'قراران يسريان في اليوم نفسه لا يقول أيهما الساري',owner:d.owner,owner_role:d.owner_role}],
        next:'اختر تاريخ سريان لاحقًا، أو راجع القرار المسجَّل'});
    db.prepare('INSERT INTO option_adoptions(id,tenant_id,key,value,basis,article,effective_from,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,u.tenant_id,key,JSON.stringify(input.value),v.text(input.basis,`أساس قرار «${d.label}» ومصدره`,3000,10),d.article?.ref??'',effective,u.id,time);
    audit(db,u,'option_adoption',id,'adoption.recorded',{},{key,effective_from:effective},v.text(input.basis,'الأساس',3000,10));
    return adopted(db,u.tenant_id,key);
  }
  if(action==='approve'){
    v.object(input,['adoption_id','note']);
    const row=typeof input.adoption_id==='string'&&db.prepare('SELECT * FROM option_adoptions WHERE id=? AND tenant_id=? AND key=? AND approved_by IS NULL').get(input.adoption_id,u.tenant_id,key);
    if(!row)refuse(404,'adoption_not_pending',{what:`لا قرار معلَّق لـ«${d.label}» بهذا المعرّف`,next:'افتح القائمة واختر قرارًا بانتظار الاعتماد'});
    if(row.recorded_by===u.id)refuse(409,'separation_of_duties',{what:`من سجّل قرار «${d.label}» لا يعتمده بنفسه`,
      missing:[{document:'اعتماد شخص ثانٍ',why:'القيمة تحكم سلوك المنصة، فقرارها يراه شخصان',owner:d.owner,owner_role:d.owner_role}],
      next:`اطلب الاعتماد من زميل آخر يحمل ${d.manage_capability??'التصريح نفسه'}`});
    db.prepare('UPDATE option_adoptions SET approved_by=?,approved_at=? WHERE id=?').run(u.id,time,row.id);
    audit(db,u,'option_adoption',row.id,'adoption.approved',{},{key,effective_from:row.effective_from},v.text(input.note,'أساس الاعتماد',2000,10));
    return adopted(db,u.tenant_id,key);
  }
  refuse(404,'action_unknown',{what:'إجراء غير معروف على قيمة معتمدة',next:'الإجراءان المتاحان: record وapprove'});
}

/* ───── العرض: ما يراه المالك عن قوائمه ───── */
// سجل التغيّر بأسماء فاعليه، فالسؤال «من غيّر ولماذا ومتى» يُجاب من الشاشة لا من قاعدة البيانات.
const changesFor=(db,tenantId,listKey)=>db.prepare('SELECT c.*,x.name AS actor_name FROM option_changes c JOIN users x ON x.id=c.actor_id WHERE c.tenant_id=? AND c.list_key=? ORDER BY c.seq DESC LIMIT 50').all(tenantId,listKey);

// حمولة قائمة واحدة كما تُعرض: خياراتها كلها (بالمعطَّل)، وحوكمتها ومادتها ومالكها، وآخر ما تغيّر فيها.
export function listView(db,tenantId,listKey,{date=null}={}){
  const view=optionsFor(db,tenantId,listKey,{date,include_disabled:true});
  return {...view,changes:changesFor(db,tenantId,listKey),
    active_count:view.options.filter(o=>o.state==='active'&&!o.awaiting_second_person).length,
    disabled_count:view.options.filter(o=>o.state==='disabled').length};
}
// كل قوائم وحدة بعينها: هذا ما تُسقطه listProcurement وlistVendors وlistFinance وlistPayables في حمولاتها،
// فيرى المالك من اليوم الأول ما هي القوائم، وما خياراتها وحالتها ومادتها ومن غيّرها آخر مرة.
export function listsBoard(db,tenantId,modules,{date=null}={}){
  const wanted=Array.isArray(modules)?modules:[modules];
  return {
    lists:registeredLists().filter(d=>wanted.includes(d.module)).map(d=>listView(db,tenantId,d.key,{date})),
    adopted:registeredAdoptions().filter(d=>wanted.includes(d.module)).map(d=>adopted(db,tenantId,d.key,date)),
    // التحرير من شاشة «الخيارات والقيم المعتمدة» (#options) عبر مسارات /api/options في app/server.mjs.
    manage_routes:'/api/options'
  };
}
// من يقرأ اللوحة: من يملك تقرير قيمة أو إدارة قائمة واحدة على الأقل، ومسؤول المنصة الأعلى (يرى ولا يقرر إلا بتصريحه).
// الموظف بلا هذا ما يحتاجها: الخيارات تصله في نماذجه، والقيمة تصله في الرفض الذي يسمّيها.
const decidable=d=>!READ_ONLY.has(d.governance)&&!d.schedule;
export function canSeeOptions(db,u){
  if(isSuperAdmin(u))return true;
  return [...registeredLists(),...registeredAdoptions()].some(d=>decidable(d)&&d.manage_capability&&can(db,u,d.manage_capability));
}
// ما ينتظر شخصًا ثانيًا: قرار قيمة سجّله غيري، وخيار وسّعه غيري في قائمة تشترط اثنين — لمن يحمل تصريحها وحده.
// العنوان وصفي (اسم القيمة وقيمتها المسجّلة، أو اسم القائمة والخيار)، لا اسم من سجّل.
export function awaitingSecondPerson(db,supplied){
  const u=actorOrRefuse(db,supplied),mine=d=>decidable(d)&&(!d.manage_capability||can(db,u,d.manage_capability));
  const adoption_rows=registeredAdoptions().filter(mine).flatMap(d=>db.prepare('SELECT id,value,effective_from,created_at FROM option_adoptions WHERE tenant_id=? AND key=? AND approved_by IS NULL AND recorded_by<>? ORDER BY created_at').all(u.tenant_id,d.key,u.id)
    .map(r=>({id:r.id,title:`«${d.label}»: ${valueText(JSON.parse(r.value))} — يسري من ${r.effective_from}`,created_at:r.created_at,actions:['approve_adoption']})));
  const option_rows=registeredLists().filter(d=>d.second_person&&mine(d)).flatMap(d=>optionsFor(db,u.tenant_id,d.key,{include_disabled:true}).options
    .filter(o=>o.awaiting_second_person&&o.option_id).filter(o=>{
      const enabler=db.prepare("SELECT actor_id FROM option_changes WHERE tenant_id=? AND list_key=? AND value=? AND change='enabled' ORDER BY seq DESC LIMIT 1").get(u.tenant_id,d.key,o.value)?.actor_id;
      return (enabler??o.added_by)!==u.id;
    }).map(o=>({id:`${d.key}::${o.value}`,title:`«${d.label}»: ${o.label}`,created_at:db.prepare('SELECT added_at FROM option_values WHERE id=?').get(o.option_id)?.added_at??null,actions:['approve_option']})));
  return {adoption_rows,option_rows};
}
// القيمة كما يقرؤها الإنسان: {"days":5} ← «عدد الأيام: 5»، والصح والخطأ بالعربي. المفتاح غير المعروف يبقى باسمه.
const VALUE_KEYS=Object.freeze({days:'عدد الأيام',hours:'عدد الساعات',amount:'المبلغ بالريال',percent:'النسبة المئوية',
  // المسير الموازي (app/payroll-parallel.mjs، الترحيل 176): قيمتا المالك قبل الانتقال.
  months:'عدد الشهور',unexplained_max:'أقصى فروق ما تتفسّر'});
export const valueText=value=>value===true?'نعم':value===false?'لا':value===null?'ما تحددت'
  :Array.isArray(value)?value.map(valueText).join('، '):typeof value==='object'?Object.entries(value).map(([k,x])=>`${VALUE_KEYS[k]??k}: ${valueText(x)}`).join(' · '):String(value);
// لوحة المالك كاملة: كل القوائم المسجّلة في هذا التحميل وكل القيم المعتمدة، ومعها ما يستطيع القارئ نفسه فعله.
export function optionsBoard(db,supplied,{date=null}={}){
  const u=actorOrRefuse(db,supplied);
  if(!canSeeOptions(db,u))refuse(403,'not_permitted',{what:'شاشة الخيارات والقيم المعتمدة لمن يقرر قيمة أو يدير قائمة',
    missing:[{document:'تصريح إدارة قائمة أو تقرير قيمة',why:'كل قائمة وقيمة يملكها صاحب عملها، والتصريح يحدده مسؤول الصلاحيات',owner:'مسؤول الصلاحيات',owner_role:'admin'}],
    next:'إذا عندك قرار في قيمة أو خيار، اطلبه من صاحب العمل اللي يملكه أو اطلب التصريح من مسؤول الصلاحيات'});
  return {as_of:date??today(),user_id:u.id,generated_at:now(),
    reason_codes:REASON_CODES,governance_names:GOVERNANCE_NAMES,change_class:CHANGE_CLASS,
    lists:registeredLists().map(d=>({...listView(db,u.tenant_id,d.key,{date}),
      can_manage:!READ_ONLY.has(d.governance)&&(!d.manage_capability||can(db,u,d.manage_capability))})),
    adopted:registeredAdoptions().map(d=>({...adopted(db,u.tenant_id,d.key,date),shape:d.shape,code_default:d.default,module:d.module,
      can_decide:decidable(d)&&(!d.manage_capability||can(db,u,d.manage_capability)),
      pending:db.prepare('SELECT a.*,x.name AS recorded_by_name FROM option_adoptions a JOIN users x ON x.id=a.recorded_by WHERE a.tenant_id=? AND a.key=? AND a.approved_by IS NULL ORDER BY a.created_at DESC').all(u.tenant_id,d.key)
        .map(r=>({...r,value:JSON.parse(r.value),value_text:valueText(JSON.parse(r.value)),mine:r.recorded_by===u.id}))}))};
}
