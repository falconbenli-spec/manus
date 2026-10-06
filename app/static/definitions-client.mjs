// وصلة المتصفح بسجل التعريفات (ترحيل 123). تحمل اللقطة المحجوبة لهذا المستخدم (GET /api/definitions/snapshot) وتجيب منها أربعة
// أسئلة، فتصل الحقول المخصّصة والتسميات المتجاوَزة الشاشاتِ المكتوبة باليد من أربع نقاط مركزية بلا إعادة كتابة شاشة:
//   النماذج      extendForm(spec)      تضيف الحقول المخصّصة إلى أي نموذج عملية يعلن entity، وتلفّ toPayload لتحمل custom_fields
//   الرسم        defsFor(...)          ما تمرّره app.mjs إلى العدّة (kit(e,tr,defs)): التسمية، وعبارة الحالة، وتعريف الكيان، ووضع المعاينة
//   التسميات     text() وrelabel()     معجم مطابقة بالنص الكامل، يُطبَّق على عناصر التسمية وحدها — لا على بيانات المستخدم ولا على الجمل
//   القاموس      term()                تجاوز مفتاح من مفاتيح القاموس (status.request.pending، role.pm)؛ القاموس نفسه يبقى منزل الافتراض الوحيد
//
// اللقطة محجوبة على الخادم: حقل لا يحق لهذا الحساب أن يراه لا يصل تعريفه ولا اسمه ولا خياراته. والخادم هو الحكم: ما يُرسل
// من هنا يُعاد التحقق منه هناك (الإلزام عند الانتقال، ومن يعدّل، ورقم الهوية)، وإخفاء حقل في الواجهة لا يغيّر شيئًا.
let snap=null,previewing=false;
const remembered=new Map();
const blank=value=>value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length);
const pick=(pair,lang)=>pair?(lang==='ar'?pair.ar:pair.en||pair.ar):'';

// فشل اللقطة لا يُسقط الصفحة: تبقى اللقطة السابقة، أو لا طبقة (افتراضات الكود). have يجعل الرد «لم تتغير» حين لا جديد.
export async function loadSnapshot(api){
  try{
    const query=[previewing?'preview=1':'',snap?.digest?`have=${encodeURIComponent(snap.digest)}`:''].filter(Boolean).join('&');
    const next=await api('/definitions/snapshot'+(query?`?${query}`:''));
    if(next&&!next.unchanged)snap=next;
  }catch{/* الصفحة تُرسم بافتراضات الكود */}
  return snap;
}
export const snapshot=()=>snap;
export function setSnapshot(value){snap=value??null;remembered.clear();}
// المعاينة تطلب من الخادم مسودة معدّها بدل المنشور. الخادم لا يجيب بها إلا لمعدّها، ولا يفرضها على أحد.
export function usePreview(on){previewing=!!on;}
export const isPreviewing=()=>!!snap?.preview;
export const entitiesForView=view=>Object.values(snap?.entities??{}).filter(entity=>entity.views.includes(view));
// زر «تعديل هذه الصفحة»: كيان مربوط بهذه الشاشة، ويحمل هذا الحساب تصريح تعديل التعريفات وتصريح العمل عليه (يحسبهما الخادم).
export const editableEntities=view=>entitiesForView(view).filter(entity=>entity.configurable);

/* ───── التسميات ───── */
// مطابقة بالنص الكامل: «العميل» وحدها تصير «الجهة»، و«سبب الفوز كما ذكره العميل» تبقى كما كُتبت. تجاوز حقل نظامي محصور في
// شاشات كيانه، واسم الكيان عام في كل الشاشات.
export function text(value,view,lang='ar'){
  const glossary=snap?.glossary?.[lang];
  if(!glossary||typeof value!=='string')return value;
  const key=value.trim();
  const to=glossary.views?.[view]?.[key]??glossary.global?.[key];
  return to===undefined?value:value.replace(key,to);
}
export function term(key,lang='ar'){
  const pair=snap?.terms?.[key];
  return pair?(lang==='ar'?pair.ar:pair.en)||null:null;
}
export function statusLabel(entityKey,status,lang='ar'){
  const entry=snap?.entities?.[entityKey]?.statuses?.[status];
  return entry?.label?{label:pick(entry.label,lang),tone:entry.tone_class??''}:entry?.tone_class?{label:null,tone:entry.tone_class}:null;
}
const hasGlossary=lang=>{const g=snap?.glossary?.[lang];return !!g&&(Object.keys(g.global??{}).length>0||Object.keys(g.views??{}).length>0);};
// المطابقة الثانية: اسم الكيان **داخل** تسمية مركّبة. «رمز العميل» و«صاحب القرار لدى العميل» و«سند ميزانية العميل» تسميات
// لا جمل، وكانت تبقى على الاسم القديم بينما يتبدّل العمود المجاور لها في الشاشة نفسها — فيبدو تبديل الاسم نصف تبديل.
// أسماء الكيانات وحدها (المدخل العام) تُطابَق هكذا؛ تجاوز حقل نظامي يبقى مطابقة بالنص الكامل في شاشات كيانه، فلا يتسرب.
// الحدّ الذي يمنع الأذى: (1) لا يقع الاستبدال إلا في عنصر تسمية (relabel)، فالجمل وبيانات المستخدم خارجه أصلًا؛
// (2) لا يُستبدل الاسم إن تبعه حرفٌ، فلا تصير «العميلة» «الجهةة»؛ (3) الاسم الأطول أولًا حين يكون أحدهما داخل الآخر.
// وما يبقى خارج المتناول يُقال ولا يُدَّعى: صيغة الجمع («العملاء»، «عملائي») والنكرة («عميل») لا تُشتقّان من الاسم المفرد
// المعرَّف في العربية، فتبقيان على ما كُتب في الشاشة حتى يُعاد صوغه أو يُسمّى كلٌّ منهما تسميةً في السجل.
const WORD=/[\p{Script=Arabic}\p{Script=Latin}]/u;
const escapeRe=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function compoundPairs(lang){
  const global=snap?.glossary?.[lang]?.global??{};
  return Object.entries(global).filter(([from,to])=>[...from].length>=3&&from!==to)
    .sort((a,b)=>b[0].length-a[0].length)
    .map(([from,to])=>[new RegExp(`${escapeRe(from)}(?!${WORD.source})`,'gu'),to]);
}
const compound=(value,pairs)=>pairs.reduce((out,[pattern,to])=>out.replace(pattern,to),value);
// مرور واحد على DOM بعد الرسم: يبدّل النص في عناصر التسمية وحدها — th وdt وlegend وأول span في label وتسمية البلاطة وoption —
// وبمطابقة النص كله. لا يمس td ولا dd ولا strong، فبيانات مستخدم صادف أن نصها «العميل» تبقى سليمة. هذا ما يجعل الشاشات التي لم
// تنتقل إلى العدّة تتبع التبديل في الثانية التي يُنشر فيها.
const LABEL_ELEMENTS='th,dt,legend,label>span:first-child,.vn-tile>span,option';
export function relabel(root,view,lang='ar'){
  if(!root?.querySelectorAll||!hasGlossary(lang))return 0;
  const pairs=compoundPairs(lang);
  let changed=0;
  for(const element of root.querySelectorAll(LABEL_ELEMENTS)){
    const node=[...(element.childNodes??[])].find(child=>child.nodeType===3&&child.textContent.trim());
    if(!node)continue;
    // النص كله أولًا (وهو ما يحمل تجاوزات الحقول النظامية المحصورة بشاشات كيانها)، ثم اسم الكيان داخل التسمية المركّبة.
    const before=node.textContent,exact=text(before,view,lang),after=exact!==before?exact:compound(before,pairs);
    if(after!==before){node.textContent=after;changed++;}
  }
  return changed;
}

/* ───── النماذج ───── */
const optionList=(field,lang,keep)=>(field.options??[]).filter(option=>!option.retired||keep.includes(option.value)).map(option=>({value:option.value,label:pick(option.label,lang)}));
function formField(field,value,lang,{required,creating}){
  const keep=[].concat(value??[]),name=`cf:${field.key}`,base={name,label:pick(field.label,lang),required,hint:field.help||undefined,cf:field.key};
  // القيمة المقترحة عرضٌ لا حكم: تُقترح في نموذج إنشاء سجل جديد وحده، ولا تُكتب في سجل قائم ولا تُقرأ قيمةً حين يغيب الإدخال.
  const shown=blank(value)&&creating&&!blank(field.default)?field.default:value;
  if(field.show_when)base.showWhen={name:`cf:${field.show_when.field}`,equals:field.show_when.equals};
  if(field.type==='checks')return {...base,type:'checks',options:optionList(field,lang,keep),value:Array.isArray(shown)?shown:[]};
  if(field.type==='select')return {...base,type:'select',value:shown??'',options:[{value:'',label:lang==='ar'?'اختر…':'Choose…'},...optionList(field,lang,keep)]};
  if(field.type==='number')return {...base,type:'text',inputmode:'decimal',value:shown??'',maxLength:15};
  return {...base,type:field.type,value:shown??'',maxLength:field.max_length??(field.type==='textarea'?3000:300)};
}
// نموذج عملية يعلن entity (ومعه record، وعلى نموذج انتقال transition) تُضاف إليه الحقول المخصّصة المنشورة التي يعدّلها هذا
// الحساب. على نموذج الانتقال تُضاف الحقول الملزَمة عند ذلك الانتقال التي ما زالت فارغة، إلزاميةً — فيملؤها صاحب الإجراء داخل
// حوار الإجراء نفسه. toPayload الأصلية لا ترى مفاتيح cf: (بعضها ينشر v كله)، والناتج يحمل custom_fields.
export function extendForm(spec,lang='ar'){
  const entity=spec?.entity?snap?.entities?.[spec.entity]:null;
  if(!entity?.readable||typeof spec.toPayload!=='function')return spec;
  const record=spec.record??null,values=record?.custom_fields??{},gate=spec.transition?new Set(entity.transitions?.[spec.transition]?.require??[]):null;
  const locked=key=>(record?.custom??[]).some(item=>item.key===key&&item.editable===false);
  const conditionMet=field=>{
    if(!field.show_when)return true;
    // مصدر الشرط خارج هذا النموذج: يُحكم بقيمته المحفوظة في السجل. داخله: يُحكم حيًّا عند كل تغيير (applyConditions).
    return included.has(field.show_when.field)||field.show_when.equals.includes(values[field.show_when.field]);
  };
  const candidates=entity.fields.filter(field=>field.editable&&!field.retired&&!locked(field.key)&&(!gate||(gate.has(field.key)&&blank(values[field.key]))));
  const included=new Set(candidates.map(field=>field.key)),chosen=candidates.filter(conditionMet);
  if(!chosen.length)return spec;
  const extra=chosen.map(field=>formField(field,values[field.key],lang,{required:gate?true:!!field.required,creating:!record}));
  return {...spec,fields:[...spec.fields,...extra],toPayload(formValues){
    const own=Object.fromEntries(Object.entries(formValues).filter(([name])=>!name.startsWith('cf:')));
    const custom=Object.fromEntries(chosen.map(field=>{const raw=formValues[`cf:${field.key}`];return [field.key,field.type==='checks'?(Array.isArray(raw)?raw:[]):String(raw??'').trim()];}));
    return {...spec.toPayload(own),custom_fields:custom};
  }};
}
// شرط الظهور في نموذج العملية: الحقل المشروط يختفي حتى يتحقق شرطه، وعناصره تُعطَّل فلا تدخل FormData. عرضٌ فقط؛ الفرض في الخادم.
export function applyConditions(form){
  if(!form?.querySelectorAll)return;
  for(const label of form.querySelectorAll('[data-cf-when]')){
    let equals=[];try{equals=JSON.parse(label.dataset.cfEquals);}catch{equals=[];}
    const source=form.elements?.[label.dataset.cfWhen],shown=!source||equals.includes(source.value);
    label.hidden=!shown;
    for(const control of label.querySelectorAll('input,select,textarea'))control.disabled=!shown;
  }
}
// الحفظ العام لقيم سجلٍ نموذجُه غير مفتوح (POST /api/records/:entity/:id/custom-fields): النموذج نفسه، والجسم {version, values}.
export function valuesForm(entityKey,recordId,lang='ar'){
  const entity=snap?.entities?.[entityKey],record=remembered.get(`${entityKey}:${recordId}`);
  if(!entity||!record)return null;
  const name=pick(entity.label,lang);
  const base={title:lang==='ar'?`الحقول المخصّصة — ${name}`:`Custom fields — ${name}`,submit:lang==='ar'?'حفظ الحقول':'Save fields',
    endpoint:`/records/${entityKey}/${recordId}/custom-fields`,fields:[],entity:entityKey,record,toPayload:()=>({version:record.version})};
  const extended=extendForm(base,lang);
  if(extended===base)return null;
  return {...extended,toPayload(formValues){const body=extended.toPayload(formValues);return {version:body.version,values:body.custom_fields};}};
}

/* ───── ما تمرّره app.mjs إلى العدّة ───── */
// view وlang دالتان تُقرآن عند الرسم، فالعدّة الواحدة تعيش عبر تبديل الشاشة واللغة والمعاينة.
export function defsFor(currentView,currentLang){
  return Object.freeze({
    text:value=>text(value,currentView(),currentLang()),
    label(entityKey,fieldKey,fallback){const pair=snap?.entities?.[entityKey]?.labels?.[fieldKey];return pick(pair,currentLang())||fallback;},
    status:(entityKey,status)=>statusLabel(entityKey,status,currentLang()),
    term:key=>term(key,currentLang()),
    entity:key=>snap?.entities?.[key]??null,
    preview:()=>isPreviewing(),
    remember(entityKey,record){if(record?.id)remembered.set(`${entityKey}:${record.id}`,record);}
  });
}
