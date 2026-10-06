import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import { can, CAPABILITIES, capabilityGap, capabilityName } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { NO_NATIONAL_ID } from './pii.mjs';
import { BANNED_STATUS_PHRASES, REQUEST_STATUS, REQUEST_STATUSES, ROLE_NAMES, MODULE_STATUS_MAP } from './static/vocabulary.mjs';

// سجل التعريفات (ترحيل 123): «لا شيء مما يخص العمل مكتوب في الكود» على منصة شاشاتها مكتوبة باليد.
//
// طبقة فوق الكود لا مُصيِّر عام. الكود هو الافتراضي (النسخة 0 = لا طبقة)، والسجل يحفظ ما غيّره إنسان وحده: وثيقة JSON
// واحدة لا تُعدَّل لكل كيان ولكل نسخة، على نمط services (app/workflow.mjs createService) وform_definitions (app/forms.mjs).
// أقسام الوثيقة: entity (اسم الكيان) · fields (الحقول المخصّصة) · system (تجاوزات الحقول النظامية المعكوسة) · layout.slots ·
// views.list · statuses (عبارة ولون) · transitions.<اسم>.require · وللكيان المحجوز platform قسم terms (مفتاح قاموس ← {ar,en}).
//
// الحقول النظامية لا تُخزَّن: كل وحدة مشاركة تسجّل واصفًا (registerEntity) ويعكسه الخادم في المحرّر is_system:true،
// فسجل واحد للحقول النظامية والمخصّصة بلا قاموس ثانٍ ينحرف عن الكود.
//
// النسخ على جدول إلحاقي: الساري = MAX(version). لا عمود حالة يُقلب. المسودة ورقة عمل واحدة لكل كيان، لا يفرضها الخادم على
// أحد ولا يراها في المعاينة إلا معدّها. النشر معاملة واحدة: تحقق، فرق عن الساري، تصنيف، صف جديد، محو المسودة، وحدث في
// سلسلة التدقيق ببصمتي قبل وبعد. الاسترجاع نسخة جديدة تساوي وثيقتُها وثيقةَ نسخة أقدم.
//
// من ينشر: definitions.configure (مع تصريح عمل الكيان) يُعدّ ويعاين، وdefinitions.publish (حساس) ينشر. والخادم هو من
// يصنّف الفرق: الإضافة والتشديد ينشرهما حامل النشر وحده حدثَ هوية، والتخفيف (توسيع حجب أو رفع إلزام) يلزمه ناشر غير
// المُعدّ — قيد CHECK على الصف نفسه. ضابطٌ يُشدَّد بشخص ولا يُخفَّف بشخص.
//
// والسجل يطرح ولا يمنح: visible_to وeditable_by مفاتيح تصاريح تُحكم بـaccess.can، فلا يفتح التعريف ما أغلقه الكود.

export const SPEC_FORMAT=1;
export const PLATFORM='platform';
export const FIELD_TYPES=Object.freeze(['text','textarea','number','date','select','checks']);
export const FIELD_TYPE_NAMES=Object.freeze({text:'نص قصير',textarea:'نص طويل',number:'رقم',date:'تاريخ',select:'قائمة اختيار',checks:'اختيار متعدد'});
// ألوان الخيارات والحالات أصنافٌ من لوحة الهوية القائمة في style.css (أصناف الشارة نفسها)، لا منتقي ألوان ولا hex:
// سياسة المحتوى تمنع style=، وقاعدة المالك ألوان الدليل وحدها.
export const TONES=Object.freeze({neutral:'draft',waiting:'pending',attention:'returned',positive:'approved',active:'in_progress',done:'completed',negative:'rejected',muted:'cancelled'});
export const TONE_NAMES=Object.freeze({neutral:'محايد',waiting:'انتظار',attention:'تنبيه',positive:'إيجابي',active:'جارٍ',done:'مكتمل',negative:'سلبي',muted:'خافت'});
export const CHANGE_CLASSES=Object.freeze({additive:'إضافة',tightening:'تشديد ضابط',loosening:'تخفيف ضابط'});
export const ORIGINS=Object.freeze({editor:'محرّر الصفحة',rollback:'استرجاع نسخة',import:'استيراد من بيئة أخرى'});
const RANK={additive:0,tightening:1,loosening:2};
const CAP_KEYS=new Set(CAPABILITIES.map(c=>c.key));
const SAFE_KEY=/^[a-z][a-z0-9_]{1,39}$/,OPTION_VALUE=/^[a-z0-9][a-z0-9_-]{0,39}$/,FORBIDDEN=['__proto__','prototype','constructor'];
const text=value=>typeof value==='string'?value.trim():'';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=()=>randomUUID();
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل التعريفات معاملة قاعدة بيانات');}

// JSON قانوني: المفاتيح مرتبة، فالوثيقة نفسها تعطي البصمة نفسها في أي بيئة ومن أي ترتيب كتابة.
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`
  :plain(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value??null);
// بصمة الوثيقة وحدها (تُقارن بها بيئتان)، وبصمة الصف (الكيان والنسخة وسابقتها والوثيقة: حلقة في سلسلة الكيان).
export const specDigest=spec=>hash(canonical(spec));
export const rowDigest=(entityKey,version,previousDigest,spec)=>hash(`${entityKey}\n${version}\n${previousDigest}\n${canonical(spec)}`);

/* ───── واصفات الكيانات المشاركة ───── */
// الواصف نحو خمسة عشر سطرًا في وحدة العمل نفسها: الجدول، والشاشات، وتصريح العمل، والانتقالات ومن ينفّذ كلًّا منها، ومفاتيح
// الحالات وعباراتها الافتراضية، والحقول النظامية، ومسارات الأرقام القابلة للحجب، والمواضع. خطأ في الواصف خطأ مبرمج يُرفع
// TypeError عند أول تحميل، لا رفضًا يصل إلى مستخدم.
const ENTITIES=new Map();
const PLATFORM_DESCRIPTOR=Object.freeze({key:PLATFORM,table:null,label:Object.freeze({ar:'مصطلحات المنصة',en:'Platform terms'}),views:Object.freeze([]),
  working_capability:null,owner:'مسؤول المنصة',owner_role:'admin',statuses:Object.freeze({}),final_statuses:Object.freeze([]),transitions:Object.freeze({}),
  system_fields:Object.freeze([]),maskable:Object.freeze([]),slots:Object.freeze([]),terms:true,readable:()=>true});
export function registerEntity(descriptor){
  const d=descriptor,bad=message=>{throw new TypeError(`registerEntity(${d?.key??'?'}): ${message}`);};
  if(!plain(d)||typeof d.key!=='string'||!/^[a-z][a-z_]{2,39}$/.test(d.key)||d.key===PLATFORM)bad('مفتاح الكيان أحرف لاتينية صغيرة وشرطة سفلية، و«platform» محجوز');
  if(!/^[a-z][a-z_]{2,60}$/.test(d.table??''))bad('اسم الجدول مطلوب');
  if(!text(d.label?.ar))bad('اسم الكيان العربي مطلوب');
  if(!Array.isArray(d.views)||!d.views.length)bad('شاشة واحدة على الأقل');
  if(d.working_capability!==null&&!CAP_KEYS.has(d.working_capability))bad('تصريح العمل غير معروف في access.mjs');
  if(!text(d.owner))bad('من يستكمل القيم الناقصة (owner) مطلوب: الرفض يسمّيه');
  if(!plain(d.statuses))bad('حالات الكيان وعباراتها الافتراضية مطلوبة');
  for(const [name,t] of Object.entries(d.transitions??{})){
    if(!SAFE_KEY.test(name)||!text(t?.label))bad(`الانتقال ${name}: اسم مقروء مطلوب`);
    if(t.capability!==null&&!CAP_KEYS.has(t.capability))bad(`الانتقال ${name}: تصريح من ينفّذه غير معروف`);
  }
  for(const f of d.system_fields??[])if(!SAFE_KEY.test(f?.key??'')||!text(f?.label))bad('كل حقل نظامي مفتاح واسم');
  for(const m of d.maskable??[])if(!SAFE_KEY.test(m?.key??'')||!text(m?.label)||!Array.isArray(m.paths)||!m.paths.length)bad('كل رقم قابل للحجب مفتاح واسم ومسارات');
  for(const fn of ['load','list','readable'])if(typeof d[fn]!=='function')bad(`الدالة ${fn} مطلوبة`);
  const frozen=Object.freeze({final_statuses:[],transitions:{},system_fields:[],maskable:[],slots:[],columns:[],owner_role:null,...d});
  ENTITIES.set(frozen.key,frozen);
  return frozen;
}
export const entityFor=key=>key===PLATFORM?PLATFORM_DESCRIPTOR:ENTITIES.get(key)??null;
export const entitiesForView=view=>[...ENTITIES.values()].filter(d=>d.views.includes(view));
export const registeredEntities=()=>[...ENTITIES.values()];
function descriptorOrRefuse(entityKey){
  const d=typeof entityKey==='string'?entityFor(entityKey):null;
  if(!d)refuse(404,'not_found',{what:'لا كيان بهذا المفتاح في سجل التعريفات',
    next:`الكيانات المشاركة الآن: ${[PLATFORM,...ENTITIES.keys()].join('، ')}. كيان جديد يلزمه واصف في وحدته ورقم ترحيل، لا يُنشأ من المحرّر`});
  return d;
}

/* ───── الامتناع عن رقم الهوية عند التعريف ───── */
// «الهوية البصرية» و«إقامة الفعالية» كلام يومي في وكالة تسويق، فالحارس لا يرفض الكلمة مجردةً داخل عبارة، بل ما يسمّي الوثيقة:
// «رقم/بطاقة/صورة/نسخة الهوية أو الإقامة أو الجواز»، و«الهوية الوطنية»، و«جواز السفر»، والكلمة وحدها اسمًا للحقل، ونظائرها اللاتينية.
const ID_NAMES=[
  /(?:رقم|ارقام|أرقام|بطاق[ةه]|صور[ةه]|نسخ[ةه])\s+(?:ال)?(?:هوي[ةه]|[اإ]قام[ةه]|جواز)/u,
  /(?:ال)?هوي[ةه]\s+(?:ال)?(?:وطني[ةه]|شخصي[ةه]|مدني[ةه])/u,
  /^(?:رقم\s+)?(?:ال)?(?:هوي[ةه]|[اإ]قام[ةه]|جواز)$/u,
  /جواز\s+(?:ال)?سفر/u,
  /(?:^|[^a-z])(?:iqama|passport|national[\s_-]*id|id[\s_-]*(?:number|no)|civil[\s_-]*id|residen(?:ce|cy)[\s_-]*(?:id|number|permit))(?:$|[^a-z])/i
];
const ID_KEYS=/(?:^|_)(?:iqama|passport|national_id|nid|id_number|id_no|civil_id)(?:_|$)/;
const stripMarks=value=>String(value??'').normalize('NFKC').replace(/[ً-ْـ]/gu,'').replace(/\s+/gu,' ').trim();
export const namesIdentityDocument=value=>{const clean=stripMarks(value);return !!clean&&ID_NAMES.some(pattern=>pattern.test(clean));};
function refuseIdentity(what){
  refuse(400,'national_id_refused',{what:`رُفض ${what}: يسمّي رقم هوية أو إقامة أو جواز`,
    next:`${NO_NATIONAL_ID} احذف الحقل أو سمِّه بما لا يطلب رقم وثيقة شخصية`});
}

/* ───── التحقق من الوثيقة وتطبيعها ───── */
const specError=(what,next='صحّح التعريف في محرّر الصفحة ثم احفظ المسودة من جديد')=>refuse(400,'definition_spec',{what,next});
function keysOf(value,allowed,what){
  if(!plain(value))specError(`${what}: الشكل غير صالح`);
  const stray=Object.keys(value).filter(key=>!allowed.includes(key));
  if(stray.length)specError(`${what}: مفاتيح غير معروفة في صيغة التعريف ${SPEC_FORMAT} — ${stray.join('، ')}`);
  return value;
}
function labelPair(value,what,{max=100,min=2,guard=true}={}){
  const pair=typeof value==='string'?{ar:value}:keysOf(value,['ar','en'],what);
  const ar=text(pair.ar),en=text(pair.en);
  if([...ar].length<min||[...ar].length>max)specError(`${what}: الاسم العربي من ${min} إلى ${max} حرفًا`);
  if([...en].length>max)specError(`${what}: الاسم الإنجليزي ${max} حرفًا كحد أقصى`);
  if(ar.includes('\0')||en.includes('\0'))specError(`${what}: يحتوي محرفًا غير مسموح`);
  if(guard&&(namesIdentityDocument(ar)||namesIdentityDocument(en)))refuseIdentity(`«${ar}»`);
  return en?{ar,en}:{ar};
}
function capabilityList(value,what){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>12||value.some(key=>typeof key!=='string'))specError(`${what}: قائمة مفاتيح تصاريح (12 كحد أقصى)`);
  const unknown=value.filter(key=>!CAP_KEYS.has(key));
  if(unknown.length)specError(`${what}: تصريح غير معروف في هذه البيئة — ${unknown.join('، ')}`,'اختر التصريح من قائمة تصاريح المنصة؛ التصريح كود في app/access.mjs ولا يُنشأ من المحرّر');
  return [...new Set(value)].sort();
}
// كل مفاتيح التصاريح التي تذكرها وثيقة، معروفة أو لا: يعرضها فحص الاستيراد كلها دفعة واحدة بدل أول مجهول.
export function capabilitiesIn(spec){
  const found=new Set();
  for(const f of Array.isArray(spec?.fields)?spec.fields:[])for(const key of [...(f?.visible_to??[]),...(f?.editable_by??[])])if(typeof key==='string')found.add(key);
  for(const s of Object.values(plain(spec?.system)?spec.system:{}))for(const key of s?.visible_to??[])if(typeof key==='string')found.add(key);
  return [...found].sort();
}
const FIELD_ALLOWED=['key','label','type','required','options','help','default','min_length','max_length','pattern','pattern_message','min','max',
  'show_when','visible_to','editable_by','searchable','tracked','retired'];
function fieldSpec(input,earlier,systemKeys){
  const f=keysOf(input,FIELD_ALLOWED,'حقل مخصّص'),what=`الحقل ${typeof f.key==='string'?f.key:'؟'}`;
  if(typeof f.key!=='string'||!SAFE_KEY.test(f.key)||FORBIDDEN.includes(f.key))specError('معرّف حقل غير صالح: حرف لاتيني صغير ثم أحرف وأرقام وشرطة سفلية، من حرفين إلى أربعين','المحرّر يولّد المعرّف من تلقائه؛ لا يُكتب باليد');
  if(ID_KEYS.test(f.key))refuseIdentity(`معرّف الحقل ${f.key}`);
  if(earlier.some(x=>x.key===f.key))specError(`${what}: المعرّف مكرر`);
  if(systemKeys.has(f.key))specError(`${what}: المعرّف محجوز لحقل نظامي في الشاشة`);
  if(!FIELD_TYPES.includes(f.type))specError(`${what}: نوع غير مدعوم. الأنواع: ${FIELD_TYPES.join('، ')}`,'الأنواع المرجعية والملفات والصيغ والعملات بأسعار صرف ليست في هذه المرحلة؛ لكل منها محقّقه وقصة حجبه وتصديره');
  const label=labelPair(f.label,`اسم ${what}`),out={key:f.key,label,type:f.type,required:f.required===true};
  if(f.required!==undefined&&typeof f.required!=='boolean')specError(`${what}: الإلزام قيمة منطقية`);
  // نص المساعدة لا يُحرس باسم الوثيقة: «لا تكتب رقم الهوية هنا» إرشاد مشروع. الذي يُحرس اسم الحقل وخياراته، ثم القيمة عند إدخالها.
  if(f.help!==undefined&&f.help!==''){const help=text(f.help);if([...help].length>500)specError(`${what}: نص المساعدة 500 حرف كحد أقصى`);if(help)out.help=help;}
  if(['select','checks'].includes(f.type)){
    if(!Array.isArray(f.options)||!f.options.length||f.options.length>40)specError(`${what}: قائمة الخيارات من خيار إلى أربعين`);
    const seen=new Set();
    out.options=f.options.map(o=>{
      const option=keysOf(o,['value','label','tone','retired'],`خيار في ${what}`);
      if(typeof option.value!=='string'||!OPTION_VALUE.test(option.value)||seen.has(option.value))specError(`${what}: قيمة خيار مكررة أو غير صالحة`,'المحرّر يولّد قيمة الخيار من تلقائه؛ الذي يُكتب هو اسمه');
      seen.add(option.value);
      if(option.tone!==undefined&&option.tone!==''&&!Object.hasOwn(TONES,option.tone))specError(`${what}: لون الخيار من لوحة الهوية — ${Object.keys(TONES).join('، ')}`);
      return {value:option.value,label:labelPair(option.label,`اسم خيار في ${what}`,{min:1}),...(option.tone?{tone:option.tone}:{}),...(option.retired===true?{retired:true}:{})};
    });
    if(f.retired!==true&&out.options.every(o=>o.retired))specError(`${what}: كل خياراته مسحوبة. أبقِ خيارًا ساريًا أو اسحب الحقل نفسه`);
  }else if(f.options!==undefined)specError(`${what}: الخيارات لحقلَي الاختيار والاختيار المتعدد`);
  const textual=['text','textarea'].includes(f.type);
  for(const key of ['min_length','max_length']){
    if(f[key]===undefined||f[key]===null||f[key]==='')continue;
    if(!textual)specError(`${what}: حدّ الطول لحقل نصي`);
    if(!Number.isInteger(f[key])||f[key]<1||f[key]>3000)specError(`${what}: حدّ الطول عدد صحيح من 1 إلى 3000`);
    out[key]=f[key];
  }
  if(out.min_length>out.max_length)specError(`${what}: أقل طول مقبول أكبر من أكثره`);
  if(f.pattern!==undefined&&f.pattern!==''){
    if(!textual)specError(`${what}: الصيغة تُفرض على حقل نصي`);
    if(typeof f.pattern!=='string'||f.pattern.length>200)specError(`${what}: الصيغة نص من حرف إلى 200 حرف`);
    try{new RegExp(f.pattern);}catch{specError(`${what}: الصيغة غير صالحة`);}
    // الرفض يقول ما الصواب لا ما الخطأ، فلا تُقبل صيغة بلا رسالة عربية تصفها (قاعدة workflow.mjs fieldRules نفسها).
    const message=text(f.pattern_message);
    if([...message].length<5||[...message].length>300)specError(`${what}: الصيغة تلزمها رسالة تقول ما المقبول (5 إلى 300 حرف)`);
    out.pattern=f.pattern;out.pattern_message=message;
  }else if(text(f.pattern_message))specError(`${what}: رسالة صيغة بلا صيغة`);
  for(const key of ['min','max']){
    if(f[key]===undefined||f[key]===null||f[key]==='')continue;
    if(f.type!=='number'||typeof f[key]!=='number'||!Number.isFinite(f[key])||f[key]<0||f[key]>999999999999)specError(`${what}: الحد الأدنى والأعلى لحقل رقمي، عددًا موجبًا`);
    out[key]=f[key];
  }
  if(out.min>out.max)specError(`${what}: الحد الأدنى أكبر من الأعلى`);
  if(f.show_when!==undefined&&f.show_when!==null){
    const rule=keysOf(f.show_when,['field','equals'],`شرط ظهور ${what}`),source=earlier.find(x=>x.key===rule.field);
    // القاعدة نفسها في workflow.mjs fieldRules: الشرط يُقرأ من حقل اختيار سبقه، والحقل المشروط لا يَشرط غيره.
    if(!source)specError(`${what}: شرط الظهور يشير إلى حقل غير موجود قبله`);
    if(source.type!=='select')specError(`${what}: شرط الظهور يُقرأ من حقل اختيار`);
    if(source.show_when)specError(`${what}: الحقل المشروط لا يَشرط غيره`);
    if(source.retired)specError(`${what}: شرط الظهور يُقرأ من حقل مسحوب`);
    const values=source.options.map(o=>o.value);
    if(!Array.isArray(rule.equals)||!rule.equals.length||rule.equals.length>20||rule.equals.some(x=>!values.includes(x)))specError(`${what}: قيم الشرط من خيارات «${source.label.ar}»`);
    out.show_when={field:rule.field,equals:[...new Set(rule.equals)]};
  }
  const visible=capabilityList(f.visible_to,`من يرى ${what}`),editable=capabilityList(f.editable_by,`من يعدّل ${what}`);
  if(visible.length)out.visible_to=visible;
  if(editable.length)out.editable_by=editable;
  for(const flag of ['searchable','tracked','retired']){
    if(f[flag]!==undefined&&typeof f[flag]!=='boolean')specError(`${what}: ${flag} قيمة منطقية`);
    if(f[flag]===true)out[flag]=true;
  }
  // القيمة الافتراضية عرضٌ لا حكم: تُقترح في النموذج ولا تُكتب في سجل ولا تُقرأ قيمةً حين يغيب الإدخال.
  if(f.default!==undefined&&f.default!==null&&f.default!==''){
    const values=(out.options??[]).filter(o=>!o.retired).map(o=>o.value);
    const ok=f.type==='checks'?Array.isArray(f.default)&&f.default.every(x=>values.includes(x))
      :f.type==='select'?values.includes(f.default)
      :f.type==='number'?typeof f.default==='string'&&/^\d{1,12}(?:\.\d{1,2})?$/.test(f.default)
      :f.type==='date'?typeof f.default==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(f.default)
      :typeof f.default==='string'&&f.default.length<=300;
    if(!ok)specError(`${what}: القيمة المقترحة لا توافق نوع الحقل`);
    out.default=f.type==='checks'?[...f.default]:f.default;
  }
  return out;
}
// تحقق وتطبيع. تعيد وثيقة لا تحمل إلا ما تعرفه هذه الصيغة، بمفاتيح مرتبة، وتُسقط الأقسام الفارغة: وثيقتان متساويتان معنًى
// متساويتان بصمةً. كل رفض هنا يقول ما الخطأ وما يُفعل، ولا يمر حقل يسمّي رقم هوية ولا حقل إلزامي محجوب عمّن ينفّذ انتقاله.
export function validateSpec(input,descriptor){
  const d=descriptor??PLATFORM_DESCRIPTOR;
  const spec=keysOf(input??{},['entity','fields','system','layout','views','statuses','transitions','terms'],`تعريف ${d.label.ar}`),out={};
  const systemKeys=new Set(d.system_fields.map(f=>f.key)),maskableKeys=new Set(d.maskable.map(m=>m.key));
  const filled=value=>Array.isArray(value)?value.length>0:plain(value)?Object.keys(value).length>0:value!==undefined&&value!==null;
  if(d.terms){
    if(['entity','fields','system','layout','views','statuses','transitions'].some(section=>filled(spec[section])))
      specError('كيان «مصطلحات المنصة» يحمل المصطلحات وحدها','عدّل حقول كيانٍ من شاشته هو');
  }else if(filled(spec.terms))specError('المصطلحات العامة تُعدَّل في كيان «مصطلحات المنصة» وحده');

  if(spec.entity!==undefined){const entity=keysOf(spec.entity,['label'],'اسم الكيان');if(entity.label!==undefined)out.entity={label:labelPair(entity.label,'اسم الكيان')};}

  const fields=[];
  if(spec.fields!==undefined){
    if(!Array.isArray(spec.fields)||spec.fields.length>40)specError('الحقول المخصّصة قائمة من أربعين حقلًا كحد أقصى');
    for(const f of spec.fields)fields.push(fieldSpec(f,fields,systemKeys));
  }
  if(fields.length)out.fields=fields;
  const byKey=new Map(fields.map(f=>[f.key,f])),live=key=>byKey.has(key)&&!byKey.get(key).retired;
  // حقل مشروط بحقل محجوب: من لا يرى المصدر لا يُحسب له الشرط في المتصفح. الحقل المشروط يُحجب مثل مصدره أو أضيق.
  for(const f of fields)if(f.show_when){
    const source=byKey.get(f.show_when.field),wide=source.visible_to??[];
    if(wide.length&&(!(f.visible_to??[]).length||(f.visible_to??[]).some(key=>!wide.includes(key))))
      specError(`«${f.label.ar}»: شرط ظهوره يُقرأ من «${source.label.ar}» المحجوب، فيلزم أن يُحجب مثله أو أضيق`,'ضع في «من يرى» لهذا الحقل تصاريح من قائمة حقل الشرط نفسها');
  }

  if(spec.system!==undefined){
    const system={};
    for(const [key,value] of Object.entries(keysOf(spec.system,[...systemKeys,...maskableKeys],'تجاوزات الحقول النظامية'))){
      const o=keysOf(value,['label','visible_to'],`الحقل النظامي ${key}`),field=d.system_fields.find(f=>f.key===key),entry={};
      // قيمة تحكمها لائحة (مثل لائحة العمل 351743) لا تُعدَّل من هنا: طريقها سياسات الموارد البشرية باعتماد شخصين.
      if(field?.governed_by)specError(`«${field.label}» ${field.governed_note??'تحكمه سياسة معتمدة ولا يُعدَّل من محرّر الصفحة'}`,'عدّله من شاشة السياسة التي تحكمه، بإعداد شخص واعتماد آخر');
      if(o.label!==undefined){if(!field)specError(`${key}: رقم قابل للحجب لا اسم له يُعدَّل من هنا`);entry.label=labelPair(o.label,`اسم «${field.label}»`);}
      const visible=capabilityList(o.visible_to,`من يرى ${key}`);
      // السجل يطرح ولا يمنح، ولا يطرح إلا مما أعلنت وحدته أنه قابل للحجب: حجب حقل نظامي لم تعلنه وحدته لا أثر له في الشاشة،
      // فقبوله وعدٌ كاذب بالحجب.
      if(visible.length){if(!maskableKeys.has(key))specError(`${key}: ليس من الأرقام التي أعلنت وحدتها أنها قابلة للحجب`,`القابل للحجب هنا: ${d.maskable.map(m=>m.label).join('، ')||'لا شيء'}`);entry.visible_to=visible;}
      if(Object.keys(entry).length)system[key]=entry;
    }
    // رقم يُستنتج من غيره: حجبه وحده حجبٌ على الورق. يلزم أن يُحجب ما يكشفه مثله أو أضيق.
    for(const m of d.maskable)if(system[m.key]?.visible_to)for(const other of m.derivable_from??[]){
      const mine=system[m.key].visible_to,theirs=system[other]?.visible_to??[];
      if(!theirs.length||theirs.some(key=>!mine.includes(key)))
        specError(`حجب «${m.label}» وحده لا يكفي: يُستنتج من «${d.maskable.find(x=>x.key===other)?.label??other}»`,'احجب الرقمين معًا عن الجمهور نفسه');
    }
    if(Object.keys(system).length)out.system=system;
  }

  if(spec.layout!==undefined){
    const layout=keysOf(spec.layout,['slots'],'التخطيط'),slots={},placed=new Set();
    for(const [slot,keys] of Object.entries(keysOf(layout.slots??{},d.slots,'مواضع الحقول'))){
      if(!Array.isArray(keys)||keys.some(key=>!byKey.has(key)))specError(`الموضع ${slot}: يحمل حقولًا مخصّصة معرَّفة فقط`,'الأجزاء المكتوبة في الشاشة لا تُحرَّك من هنا بعد');
      for(const key of keys){if(placed.has(key))specError(`«${byKey.get(key).label.ar}» موضوع في موضعين`);placed.add(key);}
      if(keys.length)slots[slot]=[...keys];
    }
    if(Object.keys(slots).length)out.layout={slots};
  }

  if(spec.views!==undefined){
    const views=keysOf(spec.views,['list'],'العروض'),list=keysOf(views.list??{},['columns','filters','sort'],'عرض القائمة'),view={};
    for(const part of ['columns','filters']){
      if(list[part]===undefined)continue;
      if(!Array.isArray(list[part])||list[part].length>12||new Set(list[part]).size!==list[part].length||list[part].some(key=>!byKey.has(key)))specError(`${part==='columns'?'أعمدة':'مرشحات'} القائمة: حقول مخصّصة معرَّفة بلا تكرار (12 كحد أقصى)`);
      if(part==='filters'&&list.filters.some(key=>!['select','checks'].includes(byKey.get(key).type)))specError('المرشح يُبنى على حقل اختيار أو اختيار متعدد');
      if(list[part].length)view[part]=[...list[part]];
    }
    if(list.sort!==undefined&&list.sort!==null){
      const sort=keysOf(list.sort,['field','direction'],'ترتيب القائمة');
      if(!byKey.has(sort.field)&&!(d.columns??[]).some(c=>c.key===sort.field))specError('ترتيب القائمة على عمود معروف في القائمة');
      if(!['asc','desc'].includes(sort.direction))specError('اتجاه الترتيب asc أو desc');
      view.sort={field:sort.field,direction:sort.direction};
    }
    if(Object.keys(view).length)out.views={list:view};
  }

  if(spec.statuses!==undefined){
    const statuses={};
    for(const [key,value] of Object.entries(keysOf(spec.statuses,Object.keys(d.statuses),'عبارات الحالات'))){
      const o=keysOf(value,['label','tone'],`الحالة ${key}`),entry={};
      if(o.label!==undefined)entry.label=labelPair(o.label,`عبارة الحالة ${key}`,{max:60});
      if(o.tone!==undefined&&o.tone!==''){if(!Object.hasOwn(TONES,o.tone))specError(`لون الحالة ${key} من لوحة الهوية — ${Object.keys(TONES).join('، ')}`);entry.tone=o.tone;}
      if(Object.keys(entry).length)statuses[key]=entry;
    }
    distinctPhrases(Object.keys(d.statuses).map(key=>[key,statuses[key]?.label?.ar??d.statuses[key]]),`حالات ${d.label.ar}`);
    if(Object.keys(statuses).length)out.statuses=statuses;
  }

  if(spec.transitions!==undefined){
    const transitions={};
    for(const [name,value] of Object.entries(keysOf(spec.transitions,Object.keys(d.transitions),'الانتقالات'))){
      const o=keysOf(value,['require'],`الانتقال ${name}`),t=d.transitions[name];
      if(o.require===undefined)continue;
      if(!Array.isArray(o.require)||new Set(o.require).size!==o.require.length)specError(`الحقول الإلزامية عند «${t.label}» قائمة بلا تكرار`);
      for(const key of o.require){
        const f=byKey.get(key);
        if(!f)specError(`«${t.label}» يُلزم حقلًا غير معرَّف: ${key}`);
        if(f.retired)specError(`«${f.label.ar}» مسحوب وما زال إلزاميًا عند «${t.label}»`,'ارفع الإلزام عنه أولًا — وهو تخفيف ينشره شخص غير من أعدّه');
        // مفارقة الحجب: حقل إلزامي عند انتقال لا يراه أو لا يعدّله من ينفّذ الانتقال يوقف العمل بلا مخرج.
        for(const [list,verb] of [[f.visible_to??[],'يراه'],[f.editable_by??[],'يعدّله']])
          if(list.length&&(t.capability===null||!list.includes(t.capability)))
            specError(`«${f.label.ar}» إلزامي عند «${t.label}» ولا ${verb} من ينفّذه`,t.capability===null
              ?'هذا الانتقال ينفّذه صاحب السجل بلا تصريح بعينه، فالحقل الإلزامي عنده لا يُحجب ولا يُقيَّد تعديله'
              :`أضف تصريح «${capabilityName(t.capability)}» إلى قائمة الحقل، أو ارفع عنه الإلزام`);
      }
      if(o.require.length)transitions[name]={require:[...o.require]};
    }
    if(Object.keys(transitions).length)out.transitions=transitions;
  }

  if(spec.terms!==undefined){
    const terms={};
    for(const [key,value] of Object.entries(keysOf(spec.terms,Object.keys(TERM_DEFAULTS),'المصطلحات'))){
      const pair=labelPair(value,`المصطلح ${key}`,{max:60});
      if(key.startsWith('status.')&&[...BANNED_STATUS_PHRASES].includes(pair.ar))specError(`«${pair.ar}» عبارة حالة ممنوعة في القاموس`,'اختر عبارة محايدة تجاه القارئ؛ سبب المنع مكتوب في app/static/vocabulary.mjs');
      terms[key]=pair;
    }
    distinctPhrases(REQUEST_STATUSES.map(s=>[s,terms[`status.request.${s}`]?.ar??REQUEST_STATUS[s][0]]),'حالات الطلب الثماني');
    if(Object.keys(terms).length)out.terms=terms;
  }
  return out;
}
// حالتان لكيان واحد بالعبارة نفسها تجعل الشارة لا تقول شيئًا؛ وعبارة ممنوعة في القاموس ممنوعة هنا أيضًا.
function distinctPhrases(pairs,what){
  const seen=new Map();
  for(const [key,phrase] of pairs){
    if([...BANNED_STATUS_PHRASES].includes(phrase))specError(`«${phrase}» عبارة حالة ممنوعة في القاموس`,'اختر عبارة محايدة تجاه القارئ؛ سبب المنع مكتوب في app/static/vocabulary.mjs');
    if(seen.has(phrase))specError(`${what}: الحالتان ${seen.get(phrase)} و${key} بالعبارة نفسها «${phrase}»`,'لكل حالة عبارة تميّزها');
    seen.set(phrase,key);
  }
}
// مفاتيح القاموس التي يجوز تجاوزها: حالات الطلب الثماني، وعبارات حالات الوحدات، وأسماء الأدوار. القاموس نفسه
// (app/static/vocabulary.mjs) يبقى مجمَّدًا ونقيًّا والمنزل الوحيد للعبارات الافتراضية؛ السجل يحفظ الفروق ولا ينسخ افتراضًا.
export const TERM_DEFAULTS=Object.freeze({
  ...Object.fromEntries(REQUEST_STATUSES.map(s=>[`status.request.${s}`,{ar:REQUEST_STATUS[s][0],en:REQUEST_STATUS[s][1]}])),
  ...Object.fromEntries(Object.entries(MODULE_STATUS_MAP).flatMap(([module,map])=>Object.entries(map).map(([s,entry])=>[`status.${module}.${s}`,{ar:entry.phrase,en:''}]))),
  ...Object.fromEntries(Object.entries(ROLE_NAMES).map(([role,pair])=>[`role.${role}`,{ar:pair[0],en:pair[1]}]))
});

/* ───── الفرق وتصنيفه ───── */
const same=(a,b)=>canonical(a)===canonical(b);
const subset=(small,big)=>small.every(key=>big.includes(key));
// قائمة تصاريح فارغة = الجميع. تضييقها تشديد، وتوسيعها أو رفعها تخفيف، وتبديل لا يُقارن يُعدّ تخفيفًا احتياطًا.
function audienceChange(before=[],after=[]){
  if(same(before,after))return null;
  if(!before.length)return 'tightening';
  if(!after.length)return 'loosening';
  return subset(after,before)?'tightening':'loosening';
}
const ruleChange=(key,before,after)=>{
  if(before===after)return null;
  if(key==='pattern')return before===undefined?'tightening':'loosening';
  const stricter=key==='min_length'||key==='min'?(after??-Infinity)>(before??-Infinity):(after??Infinity)<(before??Infinity);
  return stricter?'tightening':'loosening';
};
// فرق وثيقتين مطبَّعتين: بنود مصنَّفة، كل بند يقول القسم والنوع والمفتاح والاسم وما قبل وما بعد. هو نفسه تقرير النشر
// وتقرير الاسترجاع وتقرير الاستيراد.
export function diffSpecs(before={},after={}){
  const items=[],add=(section,kind,key,label,was,is,change='additive')=>items.push({section,kind,key,label,before:was??null,after:is??null,class:change});
  const beforeRequired=new Set(Object.values(before.transitions??{}).flatMap(t=>t.require)),afterRequired=new Set(Object.values(after.transitions??{}).flatMap(t=>t.require));
  if(!same(before.entity?.label,after.entity?.label))add('entity','entity_label','entity',after.entity?.label?.ar??before.entity?.label?.ar??'',before.entity?.label,after.entity?.label);
  const was=new Map((before.fields??[]).map(f=>[f.key,f])),is=new Map((after.fields??[]).map(f=>[f.key,f]));
  for(const [key,f] of is){
    const old=was.get(key);
    if(!old){add('fields','field_added',key,f.label.ar,null,{type:f.type,required:f.required,visible_to:f.visible_to??[]},f.required||(f.visible_to??[]).length?'tightening':'additive');continue;}
    const name=f.label.ar,bound=f.required||afterRequired.has(key)||old.required||beforeRequired.has(key);
    if(old.type!==f.type)add('fields','field_type',key,name,old.type,f.type,'loosening');
    if(!same(old.label,f.label))add('fields','field_label',key,name,old.label,f.label);
    if((old.help??'')!==(f.help??''))add('fields','field_help',key,name,old.help,f.help);
    if(old.required!==f.required)add('fields',f.required?'field_required_on':'field_required_off',key,name,old.required,f.required,f.required?'tightening':'loosening');
    if(!!old.retired!==!!f.retired)add('fields',f.retired?'field_retired':'field_restored',key,name,!!old.retired,!!f.retired,f.retired&&old.required?'loosening':'additive');
    for(const rule of ['min_length','max_length','pattern','min','max']){
      const change=ruleChange(rule,old[rule],f[rule]);
      if(change)add('fields',change==='tightening'?'field_rule_tightened':'field_rule_loosened',`${key}.${rule}`,name,old[rule],f[rule],change);
    }
    if(old.pattern===f.pattern&&(old.pattern_message??'')!==(f.pattern_message??''))add('fields','field_help',`${key}.pattern_message`,name,old.pattern_message,f.pattern_message);
    // شرط الظهور يُسقط الإلزام حين يختفي الحقل: إضافته أو تبديله على حقل إلزامي تخفيف، ورفعه عنه تشديد.
    if(!same(old.show_when,f.show_when))add('fields','field_condition',key,name,old.show_when,f.show_when,bound?(f.show_when?'loosening':'tightening'):'additive');
    const seen=audienceChange(old.visible_to,f.visible_to),edited=audienceChange(old.editable_by,f.editable_by);
    if(seen)add('masks',seen==='tightening'?'field_mask_narrowed':'field_mask_widened',key,name,old.visible_to??[],f.visible_to??[],seen);
    if(edited)add('masks',edited==='tightening'?'field_edit_narrowed':'field_edit_widened',key,name,old.editable_by??[],f.editable_by??[],edited);
    if(!!old.searchable!==!!f.searchable)add('fields','field_searchable',key,name,!!old.searchable,!!f.searchable);
    // التتبّع ضابط: إيقافه يُسقط سجل تغيّر القيمة، فهو تخفيف.
    if(!!old.tracked!==!!f.tracked)add('fields',f.tracked?'field_tracked_on':'field_tracked_off',key,name,!!old.tracked,!!f.tracked,f.tracked?'tightening':'loosening');
    if(!same(old.default,f.default))add('fields','field_default',key,name,old.default,f.default);
    const oldOptions=new Map((old.options??[]).map(o=>[o.value,o])),newOptions=new Map((f.options??[]).map(o=>[o.value,o]));
    for(const [value,o] of newOptions){
      const prior=oldOptions.get(value);
      if(!prior)add('options','option_added',`${key}.${value}`,`${name}: ${o.label.ar}`,null,o.label);
      else{
        if(!!prior.retired!==!!o.retired)add('options',o.retired?'option_retired':'option_restored',`${key}.${value}`,`${name}: ${o.label.ar}`,!!prior.retired,!!o.retired);
        if(!same(prior.label,o.label)||(prior.tone??'')!==(o.tone??''))add('options','option_label',`${key}.${value}`,`${name}: ${o.label.ar}`,{label:prior.label,tone:prior.tone??''},{label:o.label,tone:o.tone??''});
      }
    }
    // حذف خيار ليس إضافة. السجل الذي اختاره يفقد اسمه فيُعرض بمفتاحه الخام في الشاشة والتصدير، فهو إتلافُ قراءةٍ قائمة:
    // يُصنَّف تخفيفًا، فينشره شخص غير من أعدّه ويُقرأ في التقرير بما هو.
    for(const [value,o] of oldOptions)if(!newOptions.has(value))add('options','option_removed',`${key}.${value}`,`${name}: ${o.label.ar}`,o.label,null,'loosening');
    // الترتيب معنًى لا زينة: ترتيب الخيارات هو ما يراه من يختار في القائمة. بيئتان تحملان الخيارات نفسها بترتيبين
    // وثيقتاهما مختلفتان وبصمتاهما مختلفتان، فتقريرٌ يقول «مطابق» عنهما يحبس إحداهما عن اللحاق بالأخرى.
    const keptOrder=list=>(list??[]).map(o=>o.value).filter(v=>oldOptions.has(v)&&newOptions.has(v));
    if(!same(keptOrder(old.options),keptOrder(f.options)))add('options','option_order',key,name,keptOrder(old.options),keptOrder(f.options));
  }
  // الحذف لا يقع من المحرّر (الحقل يُسحب ولا يُحذف)؛ يقع في الاسترجاع وحده. حذف حقل إلزامي أو مُلزَم عند انتقال تخفيف.
  for(const [key,f] of was)if(!is.has(key))add('fields','field_removed',key,f.label.ar,{type:f.type,required:f.required},null,f.required||beforeRequired.has(key)?'loosening':'additive');
  // ترتيب الحقول ترتيب النموذج والتصدير. يُقارن على الحقول الباقية وحدها، فإضافةُ حقل أو سحبه لا تُقرأ إعادةَ ترتيب.
  const keptFields=list=>(list??[]).map(f=>f.key).filter(key=>was.has(key)&&is.has(key));
  if(!same(keptFields(before.fields),keptFields(after.fields)))add('fields','field_order','fields','ترتيب الحقول',keptFields(before.fields),keptFields(after.fields));
  const systems=new Set([...Object.keys(before.system??{}),...Object.keys(after.system??{})]);
  for(const key of systems){
    const old=before.system?.[key]??{},next=after.system?.[key]??{};
    if(!same(old.label,next.label))add('system','system_label',key,next.label?.ar??old.label?.ar??key,old.label,next.label);
    const seen=audienceChange(old.visible_to,next.visible_to);
    if(seen)add('masks',seen==='tightening'?'system_mask_narrowed':'system_mask_widened',key,key,old.visible_to??[],next.visible_to??[],seen);
  }
  if(!same(before.layout,after.layout))add('layout','layout_changed','slots','مواضع الحقول',before.layout?.slots,after.layout?.slots);
  if(!same(before.views,after.views))add('views','list_changed','list','أعمدة القائمة ومرشحاتها وترتيبها',before.views?.list,after.views?.list);
  for(const key of new Set([...Object.keys(before.statuses??{}),...Object.keys(after.statuses??{})]))
    if(!same(before.statuses?.[key],after.statuses?.[key]))add('statuses','status_label',key,after.statuses?.[key]?.label?.ar??before.statuses?.[key]?.label?.ar??key,before.statuses?.[key],after.statuses?.[key]);
  for(const name of new Set([...Object.keys(before.transitions??{}),...Object.keys(after.transitions??{})])){
    const old=before.transitions?.[name]?.require??[],next=after.transitions?.[name]?.require??[];
    for(const key of next)if(!old.includes(key))add('transitions','require_added',`${name}.${key}`,is.get(key)?.label.ar??key,false,true,'tightening');
    for(const key of old)if(!next.includes(key))add('transitions','require_removed',`${name}.${key}`,(is.get(key)??was.get(key))?.label.ar??key,true,false,'loosening');
  }
  for(const key of new Set([...Object.keys(before.terms??{}),...Object.keys(after.terms??{})]))
    if(!same(before.terms?.[key],after.terms?.[key]))add('terms','term_changed',key,after.terms?.[key]?.ar??TERM_DEFAULTS[key]?.ar??key,before.terms?.[key]??null,after.terms?.[key]??null);
  return items;
}
// القاعدة كلها في ثابت واحد: إن أراد المالك شخصين على كل نشر، يكفي أن تعيد هذه الدالة 'loosening' دائمًا.
export function classifyChange(diff){
  return diff.reduce((worst,item)=>RANK[item.class]>RANK[worst]?item.class:worst,'additive');
}
const summaryOf=diff=>({counts:{additive:diff.filter(i=>i.class==='additive').length,tightening:diff.filter(i=>i.class==='tightening').length,loosening:diff.filter(i=>i.class==='loosening').length},
  items:diff.slice(0,200),truncated:Math.max(0,diff.length-200)});

/* ───── القراءة ───── */
// النسخة المنشورة لا تتغير، فتحليلها يُخزَّن. مدخلٌ واحد لكل (مستأجر، كيان) لا مدخل لكل نسخة: مفتاحٌ يحمل رقم النسخة كان
// يترك وراء كل نشرٍ مدخلًا مجمَّدًا لا يقرؤه أحد، فينمو الاستهلاك بعدد ما نُشر ما دامت العملية حية. المدخل الواحد يُعاد
// بناؤه حين تختلف بصمته عن بصمة رأس السلسلة، فالإبطال بنيويٌّ كما كان ولا يُنسى.
//
// ورأس السلسلة نفسه يُخزَّن بعدّاد نشر عام يرفعه كل صفٍّ يدخل definition_versions: رسمُ لوحةٍ واحدة كان يسأل «ما أعلى نسخة؟»
// مرة لكل تسمية وحالة يقرؤها (ثلاثة إلى أربعة استعلامات فوق استعلامات اللوحة)، وصار يسألها مرة واحدة بعد كل نشر.
// هذا يفترض كاتبًا واحدًا لهذه القاعدة — وهو ما تقوم عليه المنصة أصلًا: خادم واحد على جهاز واحد. عمليةٌ أخرى تكتب في الملف
// نفسه بالتوازي لن يراها هذا المخزن حتى تنشر هذه العملية؛ وليس في المنصة اليوم طريق ثانٍ للكتابة.
const CACHE=new WeakMap();
const cacheOf=db=>{let map=CACHE.get(db);if(!map){map={heads:new Map(),entries:new Map(),first:new Map(),generation:-1};CACHE.set(db,map);}return map;};
let generation=0;
const store=db=>{const cache=cacheOf(db);if(cache.generation!==generation){cache.heads.clear();cache.generation=generation;}return cache;};
function headOf(db,tenantId,entityKey){
  const cache=store(db),key=`${tenantId}|${entityKey}`;
  if(!cache.heads.has(key))cache.heads.set(key,db.prepare('SELECT id,version,digest FROM definition_versions WHERE tenant_id=? AND entity_key=? ORDER BY version DESC LIMIT 1').get(tenantId,entityKey)??null);
  return cache.heads.get(key);
}
export function liveDefinition(db,tenantId,entityKey){
  const head=headOf(db,tenantId,entityKey);
  if(!head)return null;
  const cache=store(db),key=`${tenantId}|${entityKey}`,held=cache.entries.get(key);
  if(held&&held.version===head.version&&held.digest===head.digest)return held;
  const row=db.prepare('SELECT * FROM definition_versions WHERE id=?').get(head.id);
  const entry=Object.freeze({id:row.id,entity_key:row.entity_key,version:row.version,digest:row.digest,spec_digest:specDigest(JSON.parse(row.spec)),
    spec:deepFreeze(JSON.parse(row.spec)),created_at:row.created_at,published_by:row.published_by,prepared_by:row.prepared_by});
  cache.entries.set(key,entry);
  return entry;
}
function deepFreeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
// مجسّ للاختبار وحده: كم وثيقة محفوظة لهذه القاعدة. الثابت الذي يقيسه أن العدد عدد الكيانات لا عدد ما نُشر.
export const cachedDefinitions=db=>cacheOf(db).entries.size;
export const liveSpec=(db,tenantId,entityKey)=>liveDefinition(db,tenantId,entityKey)?.spec??{};
export const liveVersion=(db,tenantId,entityKey)=>liveDefinition(db,tenantId,entityKey)?.version??0;
// متى ظهر كل حقل أول مرة في نسخة منشورة: به يُقال عن سجل مقفل «أُضيف الحقل بعد إقفال السجل».
export function fieldsFirstPublished(db,tenantId,entityKey){
  const live=liveDefinition(db,tenantId,entityKey);if(!live)return new Map();
  // مدخل واحد لكل (مستأجر، كيان) كذلك، يحمل النسخة التي بُني عليها ويُعاد بناؤه حين تتقدم.
  const cache=store(db),key=`${tenantId}|${entityKey}`,held=cache.first.get(key);
  if(held&&held.version===live.version)return held.map;
  const first=new Map();
  for(const row of db.prepare('SELECT spec,created_at FROM definition_versions WHERE tenant_id=? AND entity_key=? ORDER BY version').all(tenantId,entityKey))
    for(const f of JSON.parse(row.spec).fields??[])if(!first.has(f.key))first.set(f.key,row.created_at);
  cache.first.set(key,{version:live.version,map:first});
  return first;
}
// التسميات: تجاوز منشور ← افتراض الكود ← المفتاح الخام (عيب يُرى فيُصلح، كما يفعل القاموس).
export function entityLabel(db,tenantId,entityKey,lang='ar'){
  const d=entityFor(entityKey),override=liveSpec(db,tenantId,entityKey).entity?.label;
  return override?.[lang]||override?.ar||d?.label?.[lang]||d?.label?.ar||entityKey;
}
export function labelOf(db,tenantId,entityKey,fieldKey,fallback,lang='ar'){
  const spec=liveSpec(db,tenantId,entityKey),own=spec.system?.[fieldKey]?.label??(spec.fields??[]).find(f=>f.key===fieldKey)?.label;
  if(own)return own[lang]||own.ar;
  // حقل مرجعي بلا تجاوز خاص يرث اسم الكيان الذي يشير إليه: «العميل» ← «الجهة» يصل عمود العميل في العرض والفرصة معًا.
  const ref=entityFor(entityKey)?.system_fields.find(f=>f.key===fieldKey)?.ref;
  if(ref&&liveSpec(db,tenantId,ref).entity?.label)return entityLabel(db,tenantId,ref,lang);
  return fallback??fieldKey;
}
export function statusLabel(db,tenantId,entityKey,status,fallback,lang='ar'){
  const override=liveSpec(db,tenantId,entityKey).statuses?.[status]?.label;
  return override?.[lang]||override?.ar||fallback||String(status??'');
}
export const statusTone=(db,tenantId,entityKey,status)=>{const tone=liveSpec(db,tenantId,entityKey).statuses?.[status]?.tone;return tone?TONES[tone]:null;};
export function term(db,tenantId,key,lang='ar'){
  const override=liveSpec(db,tenantId,PLATFORM).terms?.[key];
  return override?.[lang]||override?.ar||TERM_DEFAULTS[key]?.[lang]||TERM_DEFAULTS[key]?.ar||key;
}
// معجم التسميات من التجاوزات وحدها: اسم كيان عامٌّ في كل الشاشات، واسم حقل نظامي محصور في شاشات كيانه (فتبديل «الحالة» في
// عرض السعر لا يتسرب إلى ثمانين شاشة أخرى). مطابقة بالنص الكامل، تطبّقها الواجهة على عناصر التسمية وحدها.
// specOf: من أين تُقرأ وثيقة كل كيان. الافتراضي النسخة المنشورة؛ واللقطة في وضع المعاينة تمرّر مسودة معدّها، فيرى التسمية
// الجديدة على صفحته قبل نشرها ولا يراها غيره.
export function glossary(db,tenantId,lang='ar',specOf=key=>liveSpec(db,tenantId,key)){
  const global={},views={};
  for(const d of ENTITIES.values()){
    const spec=specOf(d.key),name=spec.entity?.label;
    if(name&&(name[lang]||lang==='ar')&&d.label[lang]&&d.label[lang]!==(name[lang]||name.ar))global[d.label[lang]]=name[lang]||name.ar;
    // حقل مرجعي بلا تجاوز خاص يرث اسم كيانه، وهذا يغطيه المدخل العام أعلاه حين تتطابق التسميتان؛ هنا التجاوزات الخاصة وحدها.
    for(const f of d.system_fields){
      const own=spec.system?.[f.key]?.label,to=own?.[lang]||(lang==='ar'?own?.ar:''),from=lang==='ar'?f.label:f.label_en;
      if(!to||!from||to===from)continue;
      for(const view of d.views)(views[view]??={})[from]=to;
    }
  }
  return {global,views};
}
// النماذج المعرَّفة بيانات (حقول الخدمات والنماذج الإلكترونية) تتبع تبديل اسم الكيان عند القراءة: تسمية تطابق اسم كيان
// بنصها الكامل تأخذ اسمه المنشور. لا تُمسّ الجمل: «سبب الفوز كما ذكره العميل» تبقى كما كُتبت حتى يعيد أحد صياغتها.
// termApplier يحسب المعجم مرة ويعيد دالة تُطبَّق على قوائم حقول كثيرة (دليل الخدمات كله). بلا تجاوز منشور تعيد القائمة نفسها
// بلا نسخ، فلا يتغير حرف في أي مخرج قائم.
export function termApplier(db,tenantId){
  const {global}=glossary(db,tenantId,'ar');
  if(!Object.keys(global).length)return fields=>fields;
  return fields=>Array.isArray(fields)?fields.map(f=>typeof f?.label==='string'&&Object.hasOwn(global,f.label.trim())?{...f,label:global[f.label.trim()]}:f):fields;
}
export const applyTerms=(db,tenantId,fields)=>termApplier(db,tenantId)(fields);

/* ───── الصلاحية على السجل نفسه ───── */
function gapRefusal(db,u,capability,what,next){
  const gap=capabilityGap(db,u.tenant_id,capability);
  refuse(403,'not_permitted',{what,missing:[{document:`تصريح «${gap.capability_name}» (${capability})`,why:gap.text,owner:'الأدمن الأول في «الموظفون والصلاحيات»',owner_role:'admin'}],next});
}
function configurer(db,supplied,descriptor){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'definitions.configure'))gapRefusal(db,u,'definitions.configure',`لا يُعدَّل تعريف «${descriptor.label.ar}» بحسابك`,'اطلب التصريح من الأدمن الأول، ثم افتح «تعديل هذه الصفحة» من جديد');
  // الزر على شاشة يفتحها صاحبها أصلًا: من لا يعمل على الكيان لا يعدّل تعريفه.
  if(descriptor.working_capability&&!can(db,u,descriptor.working_capability,u.department_id))
    gapRefusal(db,u,descriptor.working_capability,`تعريف «${descriptor.label.ar}» يعدّله من يعمل عليه`,'تعريف الصفحة يعدّله حامل تصريح العمل عليها مع تصريح تعديل التعريفات');
  return u;
}
function publisher(db,supplied,descriptor){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'definitions.publish'))gapRefusal(db,u,'definitions.publish',`لا يُنشر تعريف «${descriptor.label.ar}» بحسابك`,
    'سلّم المسودة إلى ناشر («تسليم للنشر»)، أو اطلب التصريح الحساس بمنح صريح مسجَّل');
  return u;
}
const mayRead=(db,u)=>can(db,u,'definitions.configure')||can(db,u,'definitions.publish');

/* ───── المسودة ───── */
const draftRow=(db,tenantId,entityKey)=>db.prepare('SELECT * FROM definition_drafts WHERE tenant_id=? AND entity_key=?').get(tenantId,entityKey)??null;
// حقل لا يُحذف من المحرّر بل يُسحب، ونوعه لا يتبدل، وخياره لا يُحذف: القيم المحفوظة في السجلات تبقى مقروءة بتعريفها.
// ومعرّف استُعمل يومًا بنوع آخر لا يُعاد بنوع جديد: قيمه القديمة في السجلات كانت ستُقرأ بالنوع الخطأ.
export function assertEvolution(db,tenantId,entityKey,next,{exact=false}={}){
  const live=liveSpec(db,tenantId,entityKey),is=new Map((next.fields??[]).map(f=>[f.key,f]));
  const typed=new Map();
  for(const row of db.prepare('SELECT spec FROM definition_versions WHERE tenant_id=? AND entity_key=?').all(tenantId,entityKey))
    for(const f of JSON.parse(row.spec).fields??[])typed.set(f.key,f.type);
  for(const f of next.fields??[])if(typed.has(f.key)&&typed.get(f.key)!==f.type)
    specError(`«${f.label.ar}»: نوع الحقل لا يتبدل بعد نشره (${FIELD_TYPE_NAMES[typed.get(f.key)]} ← ${FIELD_TYPE_NAMES[f.type]})`,'اسحب الحقل وأضف حقلًا جديدًا بالنوع المطلوب');
  // الاسترجاع وثيقةُ نسخة أقدم بالحرف، فلا يُحكم عليه بقاعدة «لا حذف»: ما أسقطه تبقى قيمه في السجلات بلا تعريف يُخرجها.
  if(exact)return;
  for(const f of live.fields??[]){
    const kept=is.get(f.key);
    if(!kept)specError(`«${f.label.ar}» حقل منشور، والحقل المنشور لا يُحذف`,'اسحبه (retired) فتبقى قيمه في السجلات ولا يُعرض في النماذج');
    for(const o of f.options??[])if(!(kept.options??[]).some(x=>x.value===o.value))specError(`«${o.label.ar}» خيار منشور في «${f.label.ar}»، والخيار المنشور لا يُحذف`,'اسحب الخيار فتبقى السجلات التي اختارته مقروءة');
  }
}
// مسودة لم تُسلَّم بعدُ ورقةُ عمل معدّها وحده. الدرج يعد صاحبها «أي تعديل يبدأ مسودة لا يراها غيرك»، والشريط يعد «معاينة
// مسودة — لا يراها غيرك»؛ وعدٌ يحفظه الخادم لا الواجهة. اللقطة كانت تحفظه (snapshotFor لا تقرأ إلا مسودة معدّها)، وحمولة
// المحرّر لا: كل حامل تعديل أو نشر كان يقرأ الوثيقة والفرق كاملين. غيرُ معدّها يرى الآن أن ورقةً مفتوحة وباسم من — وهو ما
// يمنع مسودتين على صفحة ويجعل التخلي عنها ممكنًا — ولا يرى وثيقتها ولا فرقها.
// والمسلَّمة للنشر يراها الناشر كاملة: هو من يحكم عليها، فلا يُطلب منه أن ينشر ما لا يقرأ.
function draftView(db,row,live,{reader=null}={}){
  if(!row)return null;
  if(reader!==null&&row.prepared_by!==reader&&!row.submitted_at)
    return {entity_key:row.entity_key,spec:null,base_version:row.base_version,row_version:row.row_version,origin:row.origin,origin_ref:null,origin_name:ORIGINS[row.origin],
      prepared_by:row.prepared_by,prepared_by_name:nameOf(db,row.prepared_by),submitted_at:null,created_at:row.created_at,updated_at:row.updated_at,
      stale:row.base_version!==(live?.version??0),diff:[],change_class:null,change_class_name:'',needs_second_publisher:false,withheld:true,
      withheld_note:'مسودة لم تُسلَّم للنشر بعد. وثيقتها وفرقها لمعدّها وحده حتى يسلّمها؛ لك أن تطلب منه تسليمها أو أن تتخلى عنها'};
  const spec=JSON.parse(row.spec),diff=diffSpecs(live?.spec??{},spec),change=classifyChange(diff);
  return {entity_key:row.entity_key,spec,base_version:row.base_version,row_version:row.row_version,origin:row.origin,origin_ref:row.origin_ref,origin_name:ORIGINS[row.origin],
    prepared_by:row.prepared_by,prepared_by_name:nameOf(db,row.prepared_by),submitted_at:row.submitted_at,created_at:row.created_at,updated_at:row.updated_at,
    stale:row.base_version!==(live?.version??0),diff,change_class:change,change_class_name:CHANGE_CLASSES[change],
    needs_second_publisher:change==='loosening',withheld:false,withheld_note:''};
}
export function saveDraft(db,supplied,entityKey,input){
  writing(db);const d=descriptorOrRefuse(entityKey),u=configurer(db,supplied,d);
  if(!plain(input)||Object.keys(input).some(key=>!['spec','row_version'].includes(key)))fail(400,'invalid_fields','حقول الطلب غير صالحة: المسودة وثيقة التعريف ونسخة المسودة');
  const spec=validateSpec(input.spec,d),existing=draftRow(db,u.tenant_id,d.key),live=liveDefinition(db,u.tenant_id,d.key),time=now();
  assertEvolution(db,u.tenant_id,d.key,spec);
  if(existing&&existing.prepared_by!==u.id)refuse(409,'draft_owned',{what:`لتعريف «${d.label.ar}» مسودة قائمة باسم ${nameOf(db,existing.prepared_by)}`,
    next:'مسودة واحدة لكل صفحة. اطلب من معدّها نشرها أو التخلي عنها، ثم ابدأ مسودتك على النسخة المنشورة'});
  if(existing){
    if(!Number.isInteger(input.row_version)||input.row_version!==existing.row_version)refuse(409,'stale_version',{what:'تغيّرت المسودة منذ فتحتها',next:'أعد فتح المحرّر لتقرأ المسودة الحالية، ثم أعد تعديلك عليها'});
    // تعديل بعد التسليم يعيد المسودة إلى صاحبها: الناشر ينشر ما رآه لا ما تغيّر بعده. والبناء دائمًا على النسخة السارية الآن.
    db.prepare("UPDATE definition_drafts SET spec=?,base_version=?,origin='editor',origin_ref=NULL,submitted_at=NULL,row_version=row_version+1,updated_at=? WHERE tenant_id=? AND entity_key=?")
      .run(canonical(spec),live?.version??0,time,u.tenant_id,d.key);
  }else db.prepare('INSERT INTO definition_drafts(tenant_id,entity_key,base_version,spec,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(u.tenant_id,d.key,live?.version??0,canonical(spec),u.id,time,time);
  // المسودة ورقة عمل لا سجل، فحفظها لا يدخل سلسلة التدقيق؛ يدخلها النشر والتخلي والتسليم.
  return draftView(db,draftRow(db,u.tenant_id,d.key),live);
}
export function discardDraft(db,supplied,entityKey,input={}){
  writing(db);const d=descriptorOrRefuse(entityKey),u=actorOrRefuse(db,supplied),row=draftRow(db,u.tenant_id,d.key);
  if(!row)refuse(404,'not_found',{what:`لا مسودة لتعريف «${d.label.ar}»`,next:'التعريف المنشور هو الساري؛ لا شيء يُتخلى عنه'});
  // يتخلى عنها معدّها، أو حامل النشر (حتى لا تحبس مسودةُ غائبٍ الصفحةَ).
  if(row.prepared_by!==u.id&&!can(db,u,'definitions.publish'))refuse(403,'not_permitted',{what:`مسودة «${d.label.ar}» باسم ${nameOf(db,row.prepared_by)}`,
    missing:[{document:'معدّ المسودة، أو تصريح نشر التعريفات',why:'المسودة يتخلى عنها معدّها أو حامل النشر',owner:nameOf(db,row.prepared_by)??'معدّ المسودة'}],next:'اطلب من معدّها التخلي عنها'});
  if(row.prepared_by===u.id)configurer(db,u,d);
  db.prepare('DELETE FROM definition_drafts WHERE tenant_id=? AND entity_key=?').run(u.tenant_id,d.key);
  audit(db,u,'definition',d.key,'definition.draft_discarded',{base_version:row.base_version,prepared_by:row.prepared_by,spec_digest:specDigest(JSON.parse(row.spec))},{},text(input?.note).slice(0,500));
  return {entity_key:d.key,discarded:true};
}
// التسليم إلى ناشر: حين لا يحمل المُعدّ تصريح النشر، أو حين يخفّف الفرق ضابطًا فيلزمه ناشر غيره.
export function submitDraft(db,supplied,entityKey,input){
  writing(db);const d=descriptorOrRefuse(entityKey),u=configurer(db,supplied,d),row=draftRow(db,u.tenant_id,d.key);
  if(!row||row.prepared_by!==u.id)refuse(404,'not_found',{what:`لا مسودة باسمك لتعريف «${d.label.ar}»`,next:'احفظ مسودتك أولًا ثم سلّمها للنشر'});
  if(!Number.isInteger(input?.row_version)||input.row_version!==row.row_version)refuse(409,'stale_version',{what:'تغيّرت المسودة منذ فتحتها',next:'أعد فتح المحرّر ثم سلّمها'});
  const view=draftView(db,row,liveDefinition(db,u.tenant_id,d.key));
  if(!view.diff.length)refuse(409,'nothing_to_publish',{what:'المسودة تطابق التعريف المنشور',next:'عدّل شيئًا قبل التسليم، أو تخلَّ عن المسودة'});
  const gap=capabilityGap(db,u.tenant_id,'definitions.publish',{exclude:view.needs_second_publisher?[u.id]:[]});
  db.prepare('UPDATE definition_drafts SET submitted_at=?,row_version=row_version+1,updated_at=? WHERE tenant_id=? AND entity_key=?').run(now(),now(),u.tenant_id,d.key);
  audit(db,u,'definition',d.key,'definition.draft_submitted',{},{base_version:row.base_version,change_class:view.change_class,spec_digest:specDigest(view.spec)});
  return {...draftView(db,draftRow(db,u.tenant_id,d.key),liveDefinition(db,u.tenant_id,d.key)),publishers:gap.eligible,publishers_note:gap.text};
}

/* ───── النشر والاسترجاع ───── */
function noteOrRefuse(value){
  const note=text(value);
  if([...note].length<5||[...note].length>1000)refuse(400,'note_required',{what:'النشر يلزمه سببٌ مكتوب',next:'اكتب ما الذي تغيّر ولماذا، في خمسة أحرف إلى ألف'});
  return note;
}
// الكتابة الوحيدة في definition_versions. تُستدعى من النشر والاسترجاع والاستيراد، فالقاعدة واحدة والحدث في سلسلة التدقيق واحد.
export function publishVersion(db,u,descriptor,spec,{preparedBy,origin,originRef=null,note,diff}){
  const live=liveDefinition(db,u.tenant_id,descriptor.key),version=(live?.version??0)+1,previous=live?.digest??'',change=classifyChange(diff);
  if(change==='loosening'&&preparedBy===u.id){
    const gap=capabilityGap(db,u.tenant_id,'definitions.publish',{exclude:[u.id]});
    refuse(409,'second_publisher_required',{what:`هذا التغيير يخفّف ضابطًا في «${descriptor.label.ar}»، ولا ينشره من أعدّه`,
      missing:diff.filter(i=>i.class==='loosening').slice(0,8).map(i=>({document:`${LOOSENING_NAMES[i.kind]??'تخفيف'}: ${i.label}`,why:'ضابطٌ يُشدَّد بشخص واحد ولا يُخفَّف بشخص واحد',owner:gap.eligible.join('، ')||'حامل تصريح نشر التعريفات غيرك',owner_role:null,doc_key:i.key})),
      next:gap.satisfied?`سلّم المسودة للنشر («تسليم للنشر»)، فينشرها ${gap.eligible.join(' أو ')}`:gap.text});
  }
  const versionId=id(),digest=rowDigest(descriptor.key,version,previous,spec),time=now();
  db.prepare(`INSERT INTO definition_versions(id,tenant_id,entity_key,version,spec_format,spec,digest,previous_digest,change_class,change_summary,origin,origin_ref,prepared_by,published_by,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId,u.tenant_id,descriptor.key,version,SPEC_FORMAT,canonical(spec),digest,previous,change,JSON.stringify(summaryOf(diff)),origin,originRef,preparedBy,u.id,note,time);
  // الكتابة الوحيدة في الجدول ترفع العدّاد، فتسقط رؤوس السلاسل المحفوظة في كل قاعدة. معاملةٌ تُلغى بعد هذا السطر تترك
  // العدّاد مرتفعًا: إبطالٌ زائد يُعيد استعلامًا، لا قراءةٌ قديمة تبقى.
  generation++;
  // فهرس البحث مشتق ويحمل قيم الحقول القابلة للبحث: نشرٌ قد يحجب حقلًا كان مفهرسًا، فيُعلَّم الفهرس قديمًا ليُبنى من جديد
  // عند أول بحث بدل أن تبقى فيه قيمة حُجبت للتو.
  db.prepare('DELETE FROM search_index_state WHERE tenant_id=?').run(u.tenant_id);
  audit(db,u,'definition',descriptor.key,'definition.published',{version:live?.version??0,digest:previous,spec_digest:live?.spec_digest??''},
    {version,digest,spec_digest:specDigest(spec),change_class:change,origin,origin_ref:originRef,prepared_by:preparedBy,diff:summaryOf(diff)},note);
  return {id:versionId,entity_key:descriptor.key,version,digest,spec_digest:specDigest(spec),change_class:change,change_class_name:CHANGE_CLASSES[change],origin};
}
const LOOSENING_NAMES={field_required_off:'رفع الإلزام',require_removed:'رفع الإلزام عند انتقال',field_mask_widened:'توسيع من يرى',field_edit_widened:'توسيع من يعدّل',
  system_mask_widened:'توسيع من يرى رقمًا نظاميًا',field_rule_loosened:'تخفيف قاعدة تحقق',field_condition:'شرط ظهور على حقل إلزامي',field_tracked_off:'إيقاف تتبّع التغيّر',
  field_removed:'حذف حقل إلزامي',field_retired:'سحب حقل إلزامي',field_type:'تبديل نوع حقل',option_removed:'حذف خيار منشور'};
export function publishDraft(db,supplied,entityKey,input){
  writing(db);const d=descriptorOrRefuse(entityKey),u=publisher(db,supplied,d),row=draftRow(db,u.tenant_id,d.key);
  if(!plain(input)||Object.keys(input).some(key=>!['row_version','note'].includes(key)))fail(400,'invalid_fields','حقول الطلب غير صالحة: نسخة المسودة وسبب النشر');
  if(!row)refuse(404,'not_found',{what:`لا مسودة لتعريف «${d.label.ar}»`,next:'افتح «تعديل هذه الصفحة» واحفظ مسودة ثم انشرها'});
  if(!Number.isInteger(input.row_version)||input.row_version!==row.row_version)refuse(409,'stale_version',{what:'تغيّرت المسودة منذ عاينتها',next:'أعد فتحها لترى ما ستنشره بالضبط'});
  const live=liveDefinition(db,u.tenant_id,d.key),note=noteOrRefuse(input.note);
  if(row.base_version!==(live?.version??0))refuse(409,'stale_draft',{what:`بُنيت المسودة على النسخة ${row.base_version} والسارية الآن ${live?.version??0}`,
    next:'يعيد معدّها حفظها فتُبنى على النسخة السارية ويُعاد حساب الفرق، ثم تُنشر'});
  // النشر يعيد التحقق ولا يثق بالمسودة المخزَّنة: واصف الكيان وقائمة التصاريح قد تغيّرا منذ حُفظت.
  const spec=validateSpec(JSON.parse(row.spec),d),exact=row.origin==='rollback';
  assertEvolution(db,u.tenant_id,d.key,spec,{exact});
  const diff=diffSpecs(live?.spec??{},spec);
  if(!diff.length)refuse(409,'nothing_to_publish',{what:'المسودة تطابق التعريف المنشور',next:'لا شيء يُنشر. تخلَّ عن المسودة أو عدّلها'});
  const result=publishVersion(db,u,d,spec,{preparedBy:row.prepared_by,origin:row.origin,originRef:row.origin_ref,note,diff});
  db.prepare('DELETE FROM definition_drafts WHERE tenant_id=? AND entity_key=?').run(u.tenant_id,d.key);
  return result;
}
// استرجاع بضغطة: نسخة جديدة وثيقتها وثيقة نسخة أقدم بالحرف. الفرق نفسه والقاعدة نفسها: استرجاعٌ يخفّف ضابطًا
// (يعيد حجبًا أوسع أو يرفع إلزامًا) ينتظر ناشرًا ثانيًا في المسودة، ولا ينفّذه شخص واحد.
export function rollbackTo(db,supplied,entityKey,input){
  writing(db);const d=descriptorOrRefuse(entityKey),u=publisher(db,supplied,d);
  if(!plain(input)||Object.keys(input).some(key=>!['to_version','note'].includes(key)))fail(400,'invalid_fields','حقول الطلب غير صالحة: النسخة المسترجعة وسبب الاسترجاع');
  const live=liveDefinition(db,u.tenant_id,d.key),note=noteOrRefuse(input.note);
  // النسخة 0 هي افتراضات الكود: الاسترجاع إليها وثيقة فارغة، فتعود الصفحة كما كتبها الكود.
  const target=input.to_version===0?{version:0,spec:'{}'}:Number.isInteger(input.to_version)?db.prepare('SELECT version,spec FROM definition_versions WHERE tenant_id=? AND entity_key=? AND version=?').get(u.tenant_id,d.key,input.to_version):null;
  if(!live||!target||target.version>=live.version)refuse(404,'not_found',{what:`لا نسخة أقدم بهذا الرقم لتعريف «${d.label.ar}»`,next:'اختر نسخة من سجل النسخ أقدم من السارية'});
  const spec=JSON.parse(target.spec),diff=diffSpecs(live.spec,spec);
  if(!diff.length)refuse(409,'nothing_to_publish',{what:`النسخة ${target.version} تطابق السارية`,next:'لا شيء يُسترجع'});
  assertEvolution(db,u.tenant_id,d.key,spec,{exact:true});
  const originRef=`v${target.version}`;
  if(classifyChange(diff)==='loosening'){
    const existing=draftRow(db,u.tenant_id,d.key);
    if(existing)refuse(409,'draft_exists',{what:`لتعريف «${d.label.ar}» مسودة قائمة باسم ${nameOf(db,existing.prepared_by)}`,next:'هذا الاسترجاع يخفّف ضابطًا فينتظر ناشرًا ثانيًا في المسودة. انشر المسودة القائمة أو تخلَّ عنها أولًا'});
    const time=now(),gap=capabilityGap(db,u.tenant_id,'definitions.publish',{exclude:[u.id]});
    db.prepare("INSERT INTO definition_drafts(tenant_id,entity_key,base_version,spec,origin,origin_ref,prepared_by,submitted_at,created_at,updated_at) VALUES(?,?,?,?,'rollback',?,?,?,?,?)")
      .run(u.tenant_id,d.key,live.version,canonical(spec),originRef,u.id,time,time,time);
    audit(db,u,'definition',d.key,'definition.rollback_prepared',{version:live.version},{to_version:target.version,change_class:'loosening',spec_digest:specDigest(spec)},note);
    return {entity_key:d.key,published:false,awaiting_second_publisher:true,to_version:target.version,change_class:'loosening',change_class_name:CHANGE_CLASSES.loosening,
      diff,publishers:gap.eligible,publishers_note:gap.text};
  }
  return {...publishVersion(db,u,d,spec,{preparedBy:u.id,origin:'rollback',originRef,note,diff}),published:true,to_version:target.version,diff};
}

/* ───── سجل النسخ وما ينتظر ناشرًا ───── */
export function history(db,supplied,entityKey){
  const d=descriptorOrRefuse(entityKey),u=actorOrRefuse(db,supplied);
  if(!mayRead(db,u))gapRefusal(db,u,'definitions.configure',`سجل نسخ «${d.label.ar}» لا يُفتح بحسابك`,'يقرؤه حامل تصريح تعديل التعريفات أو نشرها');
  const rows=db.prepare('SELECT * FROM definition_versions WHERE tenant_id=? AND entity_key=? ORDER BY version DESC').all(u.tenant_id,d.key),top=rows[0]?.version??0;
  return rows.map(r=>({id:r.id,version:r.version,state:r.version===top?'published':'superseded',state_name:r.version===top?'منشور — الساري الآن':'حلّت محله نسخة أحدث',
    change_class:r.change_class,change_class_name:CHANGE_CLASSES[r.change_class],change_summary:JSON.parse(r.change_summary),origin:r.origin,origin_name:ORIGINS[r.origin],origin_ref:r.origin_ref,
    prepared_by:r.prepared_by,prepared_by_name:nameOf(db,r.prepared_by),published_by:r.published_by,published_by_name:nameOf(db,r.published_by),two_person:r.prepared_by!==r.published_by,
    note:r.note,created_at:r.created_at,digest:r.digest,spec_digest:specDigest(JSON.parse(r.spec)),can_roll_back:r.version!==top}));
}
// سلامة سلسلة الكيان: كل نسخة تحمل بصمة سابقتها، وبصمتها تُعاد حسابًا من وثيقتها. صف دُسّ أو بُدّل خارج المنصة يكسرها.
export function verifyChain(db,tenantId,entityKey){
  let previous='',expected=1;
  for(const r of db.prepare('SELECT * FROM definition_versions WHERE tenant_id=? AND entity_key=? ORDER BY version').all(tenantId,entityKey)){
    if(r.version!==expected||r.previous_digest!==previous||rowDigest(r.entity_key,r.version,r.previous_digest,JSON.parse(r.spec))!==r.digest)return false;
    previous=r.digest;expected++;
  }
  return true;
}
// مسودات تنتظر ناشرًا: ما سُلِّم، أعدّه غيري، وأحمل أنا تصريح نشره. مصدر «بانتظار قراري» (app/inbox.mjs).
export function awaitingPublisher(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'definitions.publish'))return [];
  return db.prepare('SELECT * FROM definition_drafts WHERE tenant_id=? AND submitted_at IS NOT NULL AND prepared_by<>? ORDER BY submitted_at').all(u.tenant_id,u.id)
    .filter(row=>entityFor(row.entity_key)).map(row=>{
      const view=draftView(db,row,liveDefinition(db,u.tenant_id,row.entity_key)),d=entityFor(row.entity_key);
      return {id:row.entity_key,entity_key:row.entity_key,title:`تعريف «${d.label.ar}» — ${view.change_class_name}، أعدّه ${view.prepared_by_name}`,created_at:row.submitted_at,
        change_class:view.change_class,diff_count:view.diff.length,row_version:row.row_version,actions:['publish_definition']};
    });
}

/* ───── حمولة المحرّر ───── */
// الحقول النظامية معكوسة من الواصف is_system:true، ومعها التجاوز المنشور إن وُجد. المحكوم بسياسة مقفل ويقول لماذا وأين يُعدَّل.
function reflectedFields(db,tenantId,d,spec){
  return [...d.system_fields.map(f=>({key:f.key,is_system:true,type:f.type??'text',default_label:f.label,label:labelOf(db,tenantId,d.key,f.key,f.label),
      label_override:spec.system?.[f.key]?.label??null,ref:f.ref??null,inherits_from:f.ref&&!spec.system?.[f.key]?.label?f.ref:null,
      locked:!!f.governed_by,locked_note:f.governed_by?(f.governed_note??'تحكمه سياسة معتمدة ولا يُعدَّل من محرّر الصفحة'):'',maskable:false})),
    ...d.maskable.map(m=>({key:m.key,is_system:true,type:'figure',default_label:m.label,label:m.label,label_override:null,ref:null,inherits_from:null,locked:false,locked_note:'',
      maskable:true,visible_to:spec.system?.[m.key]?.visible_to??[],derivable_from:m.derivable_from??[]}))];
}
export const LAYOUT_LIMIT='الأجزاء المكتوبة في الشاشة لا تُحرَّك ولا تُحذف ولا يُعاد تنسيقها من هنا بعد: المحرّر يملك الحقول المخصّصة وكل تسمية وعبارات الحالات والإلزام عند الانتقال وأعمدة القائمة ومرشحاتها والحجب والترتيب داخل الموضع. تحريك الكتل المكتوبة يعني إعادة كتابة الشاشة مُصيِّرًا عامًا، وهو خارج هذه المرحلة.';
export const TRANSLATION_LIMIT='الترجمة تغطي التسميات والخيارات وعبارات الحالات وحدها. الجمل المكتوبة في الشاشات ورسائل الرفض من الخادم تبقى كما كُتبت حتى يعيد أحد صياغتها.';
export function editorPayload(db,supplied,entityKey){
  const d=descriptorOrRefuse(entityKey),u=actorOrRefuse(db,supplied);
  if(!mayRead(db,u))gapRefusal(db,u,'definitions.configure',`تعريف «${d.label.ar}» لا يُفتح بحسابك`,'يفتحه حامل تصريح تعديل التعريفات أو نشرها');
  const live=liveDefinition(db,u.tenant_id,d.key),spec=live?.spec??{},draft=draftRow(db,u.tenant_id,d.key);
  const working=!d.working_capability||can(db,u,d.working_capability,u.department_id);
  return {entity:{key:d.key,label:{ar:entityLabel(db,u.tenant_id,d.key,'ar'),en:entityLabel(db,u.tenant_id,d.key,'en')},default_label:d.label,views:d.views,slots:d.slots,
      slot_names:d.slot_names??{},terms_only:!!d.terms,
      transitions:Object.entries(d.transitions).map(([key,t])=>({key,label:t.label,capability:t.capability,capability_name:t.capability?capabilityName(t.capability):'صاحب السجل',require:spec.transitions?.[key]?.require??[]})),
      statuses:Object.entries(d.statuses).map(([key,phrase])=>({key,default_label:phrase,label:statusLabel(db,u.tenant_id,d.key,key,phrase),tone:spec.statuses?.[key]?.tone??'',final:d.final_statuses.includes(key)}))},
    system_fields:reflectedFields(db,u.tenant_id,d,spec),
    live:live?{version:live.version,digest:live.digest,spec_digest:live.spec_digest,spec,created_at:live.created_at,published_by_name:nameOf(db,live.published_by)}:{version:0,digest:'',spec_digest:specDigest({}),spec:{},created_at:null,published_by_name:null},
    draft:draftView(db,draft,live,{reader:u.id}),history:history(db,u,d.key),
    can:{configure:can(db,u,'definitions.configure')&&working,publish:can(db,u,'definitions.publish'),discard:!!draft&&(draft.prepared_by===u.id||can(db,u,'definitions.publish'))},
    field_types:FIELD_TYPES.map(key=>({key,name:FIELD_TYPE_NAMES[key]})),tones:Object.keys(TONES).map(key=>({key,name:TONE_NAMES[key],class:TONES[key]})),
    capabilities:CAPABILITIES.filter(c=>!c.everyone&&!c.super).map(c=>({key:c.key,name:c.name,group:c.group,sensitive:!!c.sensitive})),
    term_defaults:d.terms?TERM_DEFAULTS:null,
    limits:{layout:LAYOUT_LIMIT,translation:TRANSLATION_LIMIT,identity:NO_NATIONAL_ID,
      publish_rule:'الإضافة والتشديد ينشرهما حامل تصريح النشر حدثَ هوية. تخفيف ضابط — توسيع حجب أو رفع إلزام أو تخفيف قاعدة — ينشره شخص غير من أعدّه.'}};
}
// فهرس شاشة «تعريفات الصفحات»: كل كيان بنسخته السارية ومسودته وما ينتظر ناشرًا.
export function definitionsIndex(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!mayRead(db,u))gapRefusal(db,u,'definitions.configure','شاشة تعريفات الصفحات لا تُفتح بحسابك','يفتحها حامل تصريح تعديل التعريفات أو نشرها');
  return {user_id:u.id,can:{configure:can(db,u,'definitions.configure'),publish:can(db,u,'definitions.publish')},
    // ترتيب ثابت بالمفتاح لا بترتيب تحميل الوحدات، و«مصطلحات المنصة» آخرًا.
    entities:[...[...ENTITIES.values()].sort((a,b)=>a.key.localeCompare(b.key)),PLATFORM_DESCRIPTOR].map(d=>{
      const live=liveDefinition(db,u.tenant_id,d.key),draft=draftRow(db,u.tenant_id,d.key);
      return {key:d.key,label:entityLabel(db,u.tenant_id,d.key),views:d.views,version:live?.version??0,
        state_name:live?`النسخة ${live.version} منشورة`:'افتراضات الكود — لا تعريف منشور بعد',published_at:live?.created_at??null,chain_intact:verifyChain(db,u.tenant_id,d.key),
        custom_fields:(live?.spec.fields??[]).filter(f=>!f.retired).length,draft:draft?{prepared_by_name:nameOf(db,draft.prepared_by),submitted_at:draft.submitted_at,row_version:draft.row_version,mine:draft.prepared_by===u.id}:null};
    }),
    awaiting_me:awaitingPublisher(db,u),limits:{layout:LAYOUT_LIMIT,translation:TRANSLATION_LIMIT}};
}

/* ───── اللقطة التي يقرؤها المتصفح ───── */
// محجوبة لكل مستخدم: المتصفح لا يصله حتى تعريف حقل لا يحق له أن يراه — لا اسمه ولا خياراته. والمعاينة تجيب بالمسودة
// لمعدّها وحده؛ الخادم لا يفرض مسودة على أحد ويرفض قيم حقول لم تُنشر.
const holdsAny=(db,u,list)=>!list?.length||list.some(key=>can(db,u,key,u.department_id));
export function fieldAudience(db,u,spec){
  const visible=new Set(),editable=new Set();
  for(const f of spec.fields??[]){
    if(!holdsAny(db,u,f.visible_to))continue;
    visible.add(f.key);
    if(!f.retired&&holdsAny(db,u,f.editable_by))editable.add(f.key);
  }
  return {visible,editable};
}
export const withheldFigures=(db,u,descriptor,spec)=>descriptor.maskable.filter(m=>!holdsAny(db,u,spec.system?.[m.key]?.visible_to)).map(m=>m.key);
export function snapshotFor(db,supplied,{preview=false,have=null}={}){
  const u=actorOrRefuse(db,supplied),entities={};let previewing=false;
  // وثيقة كل كيان كما يراها هذا القارئ: المنشورة، أو مسودته هو في وضع المعاينة. تُقرأ منها التسميات الموروثة والمعجم والمصطلحات أيضًا.
  const drafts=new Map();
  const specOf=key=>{
    if(!drafts.has(key)){const draft=preview?draftRow(db,u.tenant_id,key):null;drafts.set(key,draft&&draft.prepared_by===u.id?JSON.parse(draft.spec):null);}
    return drafts.get(key)??liveSpec(db,u.tenant_id,key);
  };
  const configure=can(db,u,'definitions.configure');
  for(const d of ENTITIES.values()){
    const live=liveDefinition(db,u.tenant_id,d.key),spec=specOf(d.key),mine=drafts.get(d.key)!==null;previewing||=mine;
    const readable=!!d.readable(db,u),{visible,editable}=readable?fieldAudience(db,u,spec):{visible:new Set(),editable:new Set()},shown=key=>visible.has(key);
    // تسميات الحقول النظامية المتجاوَزة وحدها (تجاوز خاص، أو اسم الكيان المرجعي الموروث): ui.label تقرؤها، والافتراض يبقى في الشاشة.
    const labels={};
    for(const f of d.system_fields){
      const own=spec.system?.[f.key]?.label,inherited=!own&&f.ref?specOf(f.ref).entity?.label:null;
      if(own||inherited)labels[f.key]={ar:(own??inherited).ar,en:(own??inherited).en??''};
    }
    // زر «تعديل هذه الصفحة» يُرسم لمن يحمل تصريح التعديل **و**تصريح العمل على الكيان؛ والخادم يعيد الفحص عند كل نداء.
    entities[d.key]={key:d.key,views:d.views,version:live?.version??0,preview:mine,readable,configurable:configure&&(!d.working_capability||can(db,u,d.working_capability,u.department_id)),
      slot_names:d.slot_names??{},labels,
      label:{ar:spec.entity?.label?.ar??d.label.ar,en:spec.entity?.label?.en??d.label.en??''},
      fields:(spec.fields??[]).filter(f=>shown(f.key)).map(({visible_to,editable_by,...f})=>({...f,editable:editable.has(f.key)})),
      slots:Object.fromEntries(Object.entries(spec.layout?.slots??{}).map(([slot,keys])=>[slot,keys.filter(shown)])),
      list:{columns:(spec.views?.list?.columns??[]).filter(shown),filters:(spec.views?.list?.filters??[]).filter(shown),
        // ترتيب على حقل محجوب لا يصل حتى مفتاحه.
        sort:(sort=>sort&&((spec.fields??[]).some(f=>f.key===sort.field)?shown(sort.field):true)?sort:null)(spec.views?.list?.sort??null)},
      statuses:Object.fromEntries(Object.entries(spec.statuses??{}).map(([key,s])=>[key,{...(s.label?{label:s.label}:{}),...(s.tone?{tone:s.tone,tone_class:TONES[s.tone]}:{})}])),
      transitions:Object.fromEntries(Object.entries(d.transitions).map(([name,t])=>[name,{label:t.label,require:(spec.transitions?.[name]?.require??[]).filter(shown)}])),
      withheld:readable?withheldFigures(db,u,d,spec):[]};
  }
  const terms=specOf(PLATFORM).terms??{};previewing||=drafts.get(PLATFORM)!==null;
  const body={format:SPEC_FORMAT,preview:previewing,preview_note:previewing?'معاينة مسودة — لا يراها غيرك':'',entities,terms,
    // مصطلحات المنصة تُعدَّل من شاشة «تعريفات الصفحات» لا من صفحة عمل، فلا تصريح عمل يلزمها.
    platform_configurable:configure,
    glossary:{ar:glossary(db,u.tenant_id,'ar',specOf),en:glossary(db,u.tenant_id,'en',specOf)}},digest=hash(canonical(body));
  return have&&have===digest?{unchanged:true,digest}:{...body,digest};
}
