import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { validateForm } from './forms.mjs';
import { can, capabilityGap, capabilityName } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { looksLikeIdentifier, looksLikeNationalId, NO_NATIONAL_ID } from './pii.mjs';
import { workbook } from './xlsx.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
import { entityFor, liveDefinition, fieldAudience, fieldsFirstPublished, withheldFigures, entityLabel, labelOf, FIELD_TYPE_NAMES, TONES } from './definitions.mjs';

// قيم الحقول المخصّصة (ترحيل 123): تتحقق وتحفظ وتقرأ قيم سجلٍ مقابل التعريف **المنشور** وحده. لا تستورد وحدة عمل أبدًا
// (التعريفات والتصاريح فقط)، فلا دورة استيراد: وحدة العمل هي التي تسجّل واصفها وتستدعي من هنا ثلاث دوال.
//
//   القراءة   ...project(db,u,entity,row) تُنشر **بعد** {...row}: تكتب فوق العمود الخام custom_fields بالكائن المحجوب،
//             وتضيف custom — بنود مسمّاة بشكل بنود ملف الموظف (app/employee-profile.mjs): قيمة بمصدرها، أو «غير متاح» بسببه ومن يسدّه.
//   الكتابة   clean(db,u,entity,row,incoming) حيث تتحقق الوحدة من مدخلاتها أصلًا، وتعيد JSON تكتبه الوحدة في UPDATE نفسها.
//   البوابة   forTransition(db,u,entity,row,transition,incoming): الإلزام عند الانتقال حكم الخادم من النسخة المنشورة وحدها.
//
// محقّق واحد: التعريف المخزَّن هو شكل حقل الخدمة (app/workflow.mjs FIELD_KEYS) ومعه نوع checks من محرك النماذج، فيحكم
// validation.validatePayload وforms.validateForm قيم الخدمات والنماذج والحقول المخصّصة معًا عبر toCoreField().
//
// والحجب يطرح ولا يمنح، ويقع على الخادم عند كل مخرج: حمولة السجل، وأعمدة القائمة، والتصدير، وفهرس البحث، وسجل تغيّر
// القيمة. الحقل المحجوب **غائب** عن القارئ الذي لا يحق له — لا اسمه ولا قيمته — لا مخفيٌّ في الواجهة.
export { registerEntity, entityFor, entitiesForView } from './definitions.mjs';

export const VALUE_KINDS=Object.freeze({recorded:'مسجَّل',unavailable:'غير متاح'});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const blank=value=>value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length);
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function stored(row){
  if(!row?.custom_fields)return {};
  if(plain(row.custom_fields))return {...row.custom_fields};
  try{const value=JSON.parse(row.custom_fields);return plain(value)?value:{};}catch{return {};}
}
function descriptorOf(entityKey){
  const d=entityFor(entityKey);
  if(!d||!d.table)throw new TypeError(`custom-fields: الكيان ${entityKey} لم يسجّل واصفًا (registerEntity)`);
  return d;
}
const recordName=(d,row)=>row&&typeof d.code==='function'?d.code(row):'';
const recordLink=(d,row)=>row&&typeof d.link==='function'?d.link(row):'';

/* ───── المحوّل إلى شكل الحقل الذي يحكمه المحقّق القائم ───── */
// الخيار المسحوب لا يُعرض للاختيار، لكن سجلًا اختاره قبل سحبه يبقى صالحًا: keep تُبقي قيمته الحالية مقبولة.
export function toCoreField(def,{keep=[]}={}){
  const options=def.options?def.options.filter(o=>!o.retired||keep.includes(o.value)).map(o=>o.value):null,core={key:def.key,label:def.label.ar,type:def.type,required:!!def.required};
  if(options)core.options=options;
  for(const rule of ['min_length','max_length','pattern','pattern_message','min','max','show_when'])if(def[rule]!==undefined)core[rule]=def[rule];
  return core;
}
const optionLabel=(def,value)=>def.options?.find(o=>o.value===value)?.label.ar??String(value);
export function valueText(def,value){
  if(blank(value))return '';
  if(def.type==='checks')return (Array.isArray(value)?value:[value]).map(x=>optionLabel(def,x)).join('، ');
  if(def.type==='select')return optionLabel(def,value);
  return String(value);
}
const visibleByCondition=(def,values,defs)=>v.fieldVisible(def,values,defs);

/* ───── القراءة ───── */
// مُسقِط يُبنى مرة لكل قراءة: من يرى ماذا يُحسب مرة، ثم يُطبَّق على ثلاثمئة صف بلا استعلام تصاريح لكل صف.
export function projector(db,u,entityKey){
  const d=descriptorOf(entityKey),live=liveDefinition(db,u.tenant_id,entityKey),defs=live?.spec.fields??[];
  // بلا تعريف منشور يبقى المخرج كائنًا فارغًا لا العمود الخام: قيمٌ بقيت في السجل بعد استرجاعٍ أسقط حقلها لا تخرج بلا تعريف يحكمها.
  if(!defs.length)return ()=>({custom_fields:{},custom:[],definition_version:live?.version??0});
  const {visible,editable}=fieldAudience(db,u,live.spec),first=fieldsFirstPublished(db,u.tenant_id,entityKey);
  const slotOf=new Map(Object.entries(live.spec.layout?.slots??{}).flatMap(([slot,keys])=>keys.map((key,index)=>[key,{slot,order:index}])));
  const source=`تعريف الصفحة، النسخة ${live.version}`;
  return row=>{
    const values=stored(row),masked={},items=[],final=typeof d.is_final==='function'&&d.is_final(row),closedAt=final&&typeof d.finalised_at==='function'?d.finalised_at(row):null;
    for(const def of defs){
      if(!visible.has(def.key))continue;
      const value=values[def.key],has=!blank(value);
      // حقل مسحوب يُعرض ما دامت له قيمة في السجل (لا تُمحى بيانات أدخلها إنسان)، ولا يُعرض فارغًا ولا يُعدَّل.
      if(def.retired&&!has)continue;
      if(!def.retired&&!visibleByCondition(def,values,defs))continue;
      const place=slotOf.get(def.key)??{slot:null,order:null},base={key:def.key,label:def.label.ar,label_en:def.label.en??'',type:def.type,type_name:FIELD_TYPE_NAMES[def.type],
        slot:place.slot,order:place.order,editable:editable.has(def.key)&&!final,retired:!!def.retired,required:!!def.required};
      if(has){
        masked[def.key]=value;
        const tone=def.type==='select'?def.options.find(o=>o.value===value)?.tone:null;
        items.push({...base,kind:'recorded',kind_name:VALUE_KINDS.recorded,value,text:valueText(def,value),tone:tone?TONES[tone]:'',source,reason:'',needed:'',owner:'',
          note:def.retired?'حقل مسحوب من التعريف؛ قيمته باقية في السجل كما أُدخلت':''});
        continue;
      }
      // «غير متاح» بسببه، لا صفرًا ولا خانة فارغة. والسجل المقفل لا يُستكمل: الفراغ فيه ليس نقصًا عند أحد، فلا مالك له ولا خطوة.
      // تاريخ الإقفال يوم رياض، ولحظة نشر الحقل طابع UTC: يُقارَن يوم الرياض لتلك اللحظة، لا أول عشرة أحرف منها.
      const addedLater=final&&closedAt&&first.has(def.key)&&(String(closedAt).length===10?riyadhDateOf(first.get(def.key))>closedAt:first.get(def.key)>closedAt);
      items.push({...base,kind:'unavailable',kind_name:VALUE_KINDS.unavailable,value:null,text:VALUE_KINDS.unavailable,tone:'',source:'',
        reason:final?(addedLater?'أُضيف الحقل بعد إقفال السجل':'لم يُدخل قبل إقفال السجل'):'لم يُدخل بعد',
        needed:final?'':`يستكمله ${d.owner}`,owner:final?'':d.owner,
        note:final?'السجل المقفل لا يُعدَّل، فيبقى هذا الحقل فارغًا فيه':''});
    }
    items.sort((a,b)=>(a.slot===b.slot?0:a.slot===null?1:b.slot===null?-1:d.slots.indexOf(a.slot)-d.slots.indexOf(b.slot))||(a.order??99)-(b.order??99));
    return {custom_fields:masked,custom:items,definition_version:live.version};
  };
}
export const project=(db,u,entityKey,row)=>projector(db,u,entityKey)(row);

/* ───── الكتابة ───── */
function refuseIdentifier(def){
  refuse(400,'national_id_refused',{what:`رُفض ما كُتب في «${def.label.ar}»: يحتوي رقمًا كاملًا يشبه رقم هوية أو إقامة`,
    missing:[{document:'نص بلا أرقام متسلسلة طويلة',why:NO_NATIONAL_ID,owner:'من يُدخل القيمة',owner_role:null,doc_key:def.key}],
    next:'اكتب الوصف بلا رقم الوثيقة. الحقول المخصّصة النصية لا تقبل ستة أرقام متتالية فأكثر، بأي صورة كُتبت الأرقام وبأي فاصل بينها — ترقيمًا أو محرفًا لا يُرى'});
}
// الدمج والتحقق. تعيد {json, merged, changed, before, version}: ما يُكتب، وما تغيّر، وبأي نسخة تعريف حُكم.
function merge(db,u,entityKey,row,incoming,{creating=false}={}){
  const d=descriptorOf(entityKey),live=liveDefinition(db,u.tenant_id,entityKey),defs=live?.spec.fields??[],before=stored(row),version=live?.version??0;
  if(incoming===undefined||incoming===null){
    if(creating)requireFilled(db,u,d,defs,{},fieldAudience(db,u,live?.spec??{}).editable,row,version);
    return {json:JSON.stringify(before),merged:before,changed:[],before,version};
  }
  if(!plain(incoming))fail(400,'invalid_fields','custom_fields: كائن من مفتاح الحقل المخصّص إلى قيمته');
  const {visible,editable}=fieldAudience(db,u,live?.spec??{}),byKey=new Map(defs.map(f=>[f.key,f])),merged={...before},changed=[];
  for(const [key,raw] of Object.entries(incoming)){
    const def=byKey.get(key);
    // حقل غير منشور (مسودة أو مفتاح مخترَع) وحقل محجوب عن هذا الحساب يُرفضان بالنص نفسه: الرفض لا يكشف وجود حقل محجوب.
    if(!def||!visible.has(key))refuse(400,'unknown_custom_field',{what:`«${String(key).slice(0,40)}» ليس حقلًا في النسخة المنشورة من تعريف «${entityLabel(db,u.tenant_id,entityKey)}»`,
      next:'الخادم لا يقبل قيمة لحقل لم يُنشر. إن كان الحقل في مسودة فانشرها أولًا، ثم أعد الإدخال'});
    const value=typeof raw==='string'?raw.trim():raw;
    if(same(blank(value)?null:value,blank(before[key])?null:before[key]))continue;
    if(def.retired)refuse(409,'field_retired',{what:`«${def.label.ar}» حقل مسحوب من التعريف ولا يُكتب فيه`,next:'قيمته السابقة باقية في السجل كما هي. استعمل الحقل الذي حلّ محله'});
    // كتابة خارج editable_by تُرفض باسمها وبمن يحمل التصريح، ولا تُسقط صامتة.
    if(!editable.has(key)){
      const gap=capabilityGap(db,u.tenant_id,def.editable_by?.[0]??def.visible_to?.[0]);
      refuse(403,'field_not_editable',{what:`«${def.label.ar}» لا يُعدَّل بحسابك`,
        missing:[{document:`أحد تصاريح تعديل الحقل: ${(def.editable_by??def.visible_to??[]).map(capabilityName).join('، ')}`,why:gap.text,owner:gap.eligible.join('، ')||'الأدمن الأول في «الموظفون والصلاحيات»',owner_role:null,doc_key:key}],
        next:'اطلب ممن يحمل التصريح إدخال القيمة، أو اطلب التصريح من الأدمن الأول'});
    }
    changed.push(key);
    if(blank(value))delete merged[key];else merged[key]=value;
  }
  if(changed.length){
    // يُحكم ما تغيّر وحده، ومعه مصادر شروط الظهور سياقًا: قيمة قديمة لم يمسّها أحد لا تمنع تعديل جارتها لأن قاعدتها شُدّدت بعدها.
    const context=new Set(changed);
    for(const key of changed){const source=byKey.get(key).show_when?.field;if(source&&!blank(merged[source]))context.add(source);}
    const keys=[...context].filter(key=>!blank(merged[key])),core=keys.map(key=>toCoreField(byKey.get(key),{keep:[].concat(before[key]??[])}));
    const payload=Object.fromEntries(keys.map(key=>[key,merged[key]]));
    if(core.length){
      // (1) النوع والخيارات والاختيار المتعدد والمدى وشرط الظهور: محقّق النماذج. (2) حدّ الطول وصيغته برسالتها: محقّق الخدمات.
      const {clean}=validateForm({sections:[{key:'custom',title:'حقول مخصّصة',owner:d.owner,fields:core}]},payload,{full:false});
      const texts=core.filter(f=>f.type!=='checks'&&Object.hasOwn(clean,f.key));
      v.validatePayload(texts,Object.fromEntries(texts.map(f=>[f.key,clean[f.key]])),false);
      for(const key of changed)if(!blank(merged[key])){
        const def=byKey.get(key);
        // حقل أخفاه شرطه لا تدخل قيمته السجل ولو أرسلتها الواجهة (قاعدة validation.mjs نفسها).
        if(!Object.hasOwn(clean,key)){delete merged[key];continue;}
        merged[key]=clean[key];
        // لا رقم هوية ولا إقامة في أي قيمة نصية، بأي صورة كُتبت الأرقام وبأي فاصل بينها — والفاصل الذي لا يُرى أخطرها،
        // فالقيمة المخزَّنة تنطوي إليه في القراءة والفهرس والتصدير وسجل التدقيق. والحقل الرقمي لا يكون بابًا خلفيًا:
        // عشرة أرقام تبدأ بـ1 أو 2 صورةُ رقم هوية أو إقامة، وليست مبلغًا ولا كمية في حقل مخصّص.
        if(['text','textarea'].includes(def.type)&&looksLikeIdentifier(clean[key]))refuseIdentifier(def);
        if(def.type==='number'&&looksLikeNationalId(clean[key]))refuseIdentifier(def);
      }
    }
  }
  // قيمة معلّقة على شرط لم يعد متحققًا تخرج من السجل: تبدّل مصدر الشرط يُسقط تابعه.
  for(const def of defs)if(def.show_when&&!blank(merged[def.key])&&!def.retired&&!visibleByCondition(def,merged,defs)){if(!changed.includes(def.key))changed.push(def.key);delete merged[def.key];}
  requireFilled(db,u,d,defs,merged,editable,row,version);
  return {json:JSON.stringify(merged),merged,changed,before,version};
}
// الإلزام العام (required) يُحكم عند الإنشاء وعند أي إدخال لقيم مخصّصة، وعلى ما يستطيع هذا الحساب تعديله وحده:
// حقل لا يملك تعديله ليس نقصًا عنده. والإلزام عند انتقال بعينه حكمٌ آخر أشد، في forTransition.
function requireFilled(db,u,d,defs,merged,editable,row,version){
  const missing=defs.filter(def=>def.required&&!def.retired&&editable.has(def.key)&&visibleByCondition(def,merged,defs)&&blank(merged[def.key]));
  if(!missing.length)return;
  const name=recordName(d,row);
  refuse(400,'missing_field',{what:`حقول إلزامية لم تُستكمل في ${entityLabel(db,u.tenant_id,d.key)}${name?` ${name}`:''}`,
    missing:missing.map(def=>({document:def.label.ar,why:`إلزامي بحسب تعريف الصفحة، النسخة ${version}`,owner:d.owner,owner_role:d.owner_role,doc_key:def.key})),
    next:`أكمل ${missing.map(def=>`«${def.label.ar}»`).join(' و')} ثم أعد الحفظ`});
}
export function clean(db,u,entityKey,row,incoming,options={}){return merge(db,u,entityKey,row,incoming,options).json;}

// الإلزام عند الانتقال: يُقرأ من النسخة **المنشورة** وحدها، ويحترم شرط الظهور والسحب، ويُحكم بعد دمج ما أُرسل مع الطلب.
// واجهةٌ تُخفي الحقل لا تغيّر شيئًا، وطلب مباشر يتجاوز الواجهة يلقى الرفض نفسه. تعيد {json, version, changed, audit}: تكتب الوحدة
// json في UPDATE الانتقال نفسه (انتقال وقيمه معاملةٌ واحدة وجملة واحدة)، وتسجّل version في حدث التدقيق (أي نسخة تعريف حكمت)،
// وتستدعي audit() بعد الكتابة ليدخل ما تغيّر من القيم سجلَّ تغيّر القيمة.
export function forTransition(db,u,entityKey,row,transition,incoming){
  const d=descriptorOf(entityKey),t=d.transitions[transition];
  if(!t)throw new TypeError(`custom-fields: الانتقال ${transition} غير معلن في واصف ${entityKey}`);
  const result=merge(db,u,entityKey,row,incoming),live=liveDefinition(db,u.tenant_id,entityKey),defs=live?.spec.fields??[];
  const required=live?.spec.transitions?.[transition]?.require??[];
  if(required.length){
    const {visible}=fieldAudience(db,u,live.spec),byKey=new Map(defs.map(f=>[f.key,f]));
    const missing=required.map(key=>byKey.get(key)).filter(def=>def&&!def.retired&&visibleByCondition(def,result.merged,defs)&&blank(result.merged[def.key]));
    if(missing.length){
      const name=recordName(d,row),subject=`${entityLabel(db,u.tenant_id,entityKey)}${name?` ${name}`:''}`;
      // validateSpec يمنع إلزام حقل محجوب عمّن ينفّذ الانتقال، لكن منحًا محصورًا بإدارة قد يحجبه عن هذا الحساب بعينه:
      // حينها يُقال إن حقلًا محجوبًا ينقص، بلا اسمه، وعند من.
      refuse(409,'required_on_transition',{what:`لا يُنفَّذ «${t.label}» على ${subject} قبل استكمال حقوله الإلزامية عند هذا الانتقال`,
        missing:missing.map(def=>visible.has(def.key)
          ?{document:def.label.ar,why:`إلزامي عند «${t.label}» بحسب تعريف الصفحة، النسخة ${live.version}`,owner:d.owner,owner_role:d.owner_role,doc_key:def.key}
          :{document:'حقل إلزامي محجوب عن حسابك',why:`إلزامي عند «${t.label}» بحسب تعريف الصفحة، النسخة ${live.version}`,owner:capabilityGap(db,u.tenant_id,def.visible_to[0]).eligible.join('، ')||d.owner,owner_role:null}),
        next:`افتح ${subject} وأكمل ${missing.filter(def=>visible.has(def.key)).map(def=>`«${def.label.ar}»`).join(' و')||'الحقل الناقص عند من يراه'} ثم أعد «${t.label}»`,
        link:recordLink(d,row)});
    }
  }
  return {json:result.json,version:result.version,changed:result.changed,audit:recordId=>auditValues(db,u,entityKey,recordId??row.id,result)};
}

/* ───── أرقام النظام القابلة للحجب ───── */
// للأرقام التي تبنيها الوحدة باليد (التكلفة والاحتياطي والهامش والمعادلات داخل لقطة العرض): الواصف يعلن مساراتها، وتنتهي
// دالة اللوحة بـwithhold(). تجري **بعد** فحوص الوحدة نفسها، فلا يستطيع المحرّر إلا أن يُنزل عن أرضية الكود.
// المسار نقاط، و[] تعني «كل عنصر»: versions[].snapshot.total_cost_minor
function strip(target,parts){
  if(target===null||typeof target!=='object')return;
  const [head,...rest]=parts,list=head.endsWith('[]'),key=list?head.slice(0,-2):head;
  if(!Object.hasOwn(target,key))return;
  if(!rest.length&&!list){delete target[key];return;}
  const next=target[key];
  if(list){if(Array.isArray(next))for(const item of next)rest.length?strip(item,rest):null;}
  else strip(next,rest);
}
export function withholder(db,u,entityKey){
  const d=descriptorOf(entityKey),live=liveDefinition(db,u.tenant_id,entityKey);
  const hidden=live?withheldFigures(db,u,d,live.spec):[];
  if(!hidden.length)return payload=>payload;
  const paths=d.maskable.filter(m=>hidden.includes(m.key)).flatMap(m=>m.paths.map(path=>path.split('.')));
  return payload=>{
    // نسخة عميقة: الحمولة قد تشارك كائنات مع ما يُبنى لغير هذا القارئ.
    const copy=structuredClone(payload);
    for(const parts of paths)strip(copy,parts);
    // يُقال للشاشة ما حُجب باسمه، فتكتب «محجوب بتعريف الصفحة» بدل رقم ناقص أو NaN.
    copy.withheld=d.maskable.filter(m=>hidden.includes(m.key)).map(m=>({key:m.key,label:m.label}));
    return copy;
  };
}
export const withhold=(db,u,entityKey,payload)=>withholder(db,u,entityKey)(payload);

/* ───── أعمدة القائمة والتصدير ───── */
const columnOf=def=>({key:`cf:${def.key}`,field_key:def.key,label:def.label.ar,label_en:def.label.en??'',type:def.type,
  options:(def.options??[]).map(o=>({value:o.value,label:o.label.ar,label_en:o.label.en??'',tone:o.tone?TONES[o.tone]:'',retired:!!o.retired}))});
export function columnsFor(db,u,entityKey){
  const live=liveDefinition(db,u.tenant_id,entityKey);if(!live)return [];
  const {visible}=fieldAudience(db,u,live.spec),byKey=new Map((live.spec.fields??[]).map(f=>[f.key,f])),filters=live.spec.views?.list?.filters??[];
  return (live.spec.views?.list?.columns??[]).filter(key=>visible.has(key)&&byKey.has(key)).map(key=>({...columnOf(byKey.get(key)),filter:filters.includes(key)}));
}
// التصدير عام ولا يحتاج شيئًا من الشاشة: أعمدة الواصف النظامية ثم كل حقل مخصّص يراه هذا الحساب (أعمدة القائمة أولًا بترتيبها).
// الصفوف من descriptor.list، فيسري عزل الوحدة نفسه؛ والعمود المحجوب **ساقط** من الملف لا فارغ فيه. خانة بلا قيمة تقول «غير متاح».
export function exportRows(db,supplied,entityKey){
  const u=actorOrRefuse(db,supplied),d=descriptorOf(entityKey),rows=d.list(db,u),live=liveDefinition(db,u.tenant_id,entityKey);
  const {visible}=fieldAudience(db,u,live?.spec??{}),listed=live?.spec.views?.list?.columns??[];
  const defs=(live?.spec.fields??[]).filter(f=>visible.has(f.key)).sort((a,b)=>(listed.includes(a.key)?listed.indexOf(a.key):99)-(listed.includes(b.key)?listed.indexOf(b.key):99));
  const system=(d.columns??[]).map(c=>({...c,label:labelOf(db,u.tenant_id,entityKey,c.key,c.label)}));
  const head=[...system.map(c=>c.label),...defs.map(def=>def.label.ar)];
  const body=rows.map(row=>{const values=stored(row);return [...system.map(c=>c.value(row,db,u)??''),...defs.map(def=>blank(values[def.key])?VALUE_KINDS.unavailable:valueText(def,values[def.key]))];});
  const name=entityLabel(db,u.tenant_id,entityKey),date=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
  const legend=[['العمود','النوع','المصدر'],...system.map(c=>[c.label,'حقل نظامي','الشاشة']),
    ...defs.map(def=>[def.label.ar,FIELD_TYPE_NAMES[def.type]+(def.retired?' — مسحوب':''),`تعريف الصفحة، النسخة ${live.version}`]),
    ['—','—',`«${VALUE_KINDS.unavailable}» تعني أن القيمة لم تُدخل في السجل، لا أنها صفر. والأعمدة المحجوبة عن حسابك لا ترد في هذا الملف.`]];
  return {filename:`${entityKey}-${date}.xlsx`,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content:workbook([{name,rows:[head,...body]},{name:'تعريف الأعمدة',rows:legend}]),rows:body.length,columns:head,definition_version:live?.version??0};
}

/* ───── الحفظ العام لسجل نموذجُه غير مفتوح ───── */
// POST /api/records/:entity/:id/custom-fields. التفويض على مستوى السجل من الوحدة نفسها (descriptor.load)، والقفل المتفائل
// بنسخة السجل، والنسخة تتقدم واحدًا فيرث السجل زناد نسخته ونهائيته. حدث التدقيق يحمل المفاتيح التي تغيّرت، وقيم الحقول
// المتتبَّعة (tracked) قبل وبعد — وهذا هو سجل تغيّر القيمة.
export function saveValues(db,supplied,entityKey,recordId,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الحقول المخصّصة معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied),d=descriptorOf(entityKey);
  v.object(input,['version','values']);
  const row=d.load(db,u,recordId,{write:true});
  v.version(input.version,row.version);
  if(typeof d.is_final==='function'&&d.is_final(row))refuse(409,'record_final',{what:`${entityLabel(db,u.tenant_id,entityKey)} ${recordName(d,row)} مقفل ولا تُعدَّل حقوله`,
    next:'السجل المقفل يبقى كما أُقفل. حقل أُضيف بعد إقفاله يُعرض فيه «غير متاح» بسببه'});
  const result=merge(db,u,entityKey,row,input.values??{});
  if(!result.changed.length)return {id:row.id,version:row.version,changed:[]};
  const time=now();
  db.prepare(`UPDATE ${d.table} SET custom_fields=?,version=version+1,updated_at=? WHERE id=? AND version=?`).run(result.json,time,row.id,row.version);
  auditValues(db,u,entityKey,row.id,result,'custom_fields.saved');
  return {id:row.id,version:row.version+1,changed:result.changed,definition_version:result.version};
}
// تستدعيه وحدة العمل أيضًا حين تكتب القيم ضمن UPDATE خاص بها، فيبقى سجل تغيّر القيمة واحدًا أيًّا كان الطريق.
export function auditValues(db,u,entityKey,recordId,result,action='custom_fields.saved'){
  if(!result?.changed?.length)return;
  const live=liveDefinition(db,u.tenant_id,entityKey),tracked=new Set((live?.spec.fields??[]).filter(f=>f.tracked).map(f=>f.key));
  const pick=values=>Object.fromEntries(result.changed.filter(key=>tracked.has(key)).map(key=>[key,values[key]??null]));
  audit(db,u,entityKey,recordId,action,{tracked:pick(result.before)},{changed_keys:result.changed,tracked:pick(result.merged),definition_version:result.version});
}
// clean() لوحدة العمل مع ما يلزم لسجل التغيّر: {json, audit()} — تكتب الوحدة json ثم تستدعي audit(recordId) بعد كتابتها.
export function prepare(db,u,entityKey,row,incoming,options={}){
  const result=merge(db,u,entityKey,row,incoming,options);
  return {json:result.json,version:result.version,changed:result.changed,audit:recordId=>auditValues(db,u,entityKey,recordId,result)};
}
// سجل تغيّر قيم الحقول المتتبَّعة لسجل واحد، من سلسلة التدقيق، محجوبًا بالقاعدة نفسها: حقل لا يراه القارئ لا يرى تاريخه.
export function valueHistory(db,supplied,entityKey,recordId){
  const u=actorOrRefuse(db,supplied),d=descriptorOf(entityKey);d.load(db,u,recordId,{write:false});
  const live=liveDefinition(db,u.tenant_id,entityKey),{visible}=fieldAudience(db,u,live?.spec??{}),byKey=new Map((live?.spec.fields??[]).map(f=>[f.key,f]));
  return db.prepare("SELECT e.*,x.name AS actor_name FROM audit_events e LEFT JOIN users x ON x.id=e.actor_id WHERE e.tenant_id=? AND e.entity_type=? AND e.entity_id=? AND e.action LIKE 'custom_fields.%' ORDER BY e.seq DESC LIMIT 200")
    .all(u.tenant_id,entityKey,recordId).flatMap(e=>{
      const before=JSON.parse(e.before_json).tracked??{},after=JSON.parse(e.after_json).tracked??{};
      return Object.keys(after).filter(key=>visible.has(key)&&byKey.has(key)).map(key=>({at:e.created_at,by:e.actor_name,field_key:key,label:byKey.get(key).label.ar,
        before:blank(before[key])?VALUE_KINDS.unavailable:valueText(byKey.get(key),before[key]),after:blank(after[key])?VALUE_KINDS.unavailable:valueText(byKey.get(key),after[key])}));
    });
}

/* ───── البحث ───── */
// لا يدخل فهرس البحث إلا حقل searchable قائمةُ «من يرى» فيه **فارغة**: الفهرس مشترك بين كل من يرى السجل، فحقل محجوب
// عن بعضهم لا يدخله أصلًا — الغياب هنا امتناع لا ترشيح.
export function searchText(db,tenantId,entityKey,row){
  const live=liveDefinition(db,tenantId,entityKey);if(!live)return '';
  const values=stored(row);
  return (live.spec.fields??[]).filter(def=>def.searchable&&!def.retired&&!(def.visible_to??[]).length&&!blank(values[def.key])).map(def=>valueText(def,values[def.key])).join(' · ');
}
// كم سجلًا يحمل خيارًا بعينه: يُعرض قبل سحب الخيار، وفي فحص الاستيراد لحزمة تسحب خيارًا مستعملًا هنا.
export function optionUsage(db,tenantId,entityKey,fieldKey,value){
  const d=descriptorOf(entityKey);
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(fieldKey))return 0;
  const path=`$.${fieldKey}`;
  return db.prepare(`SELECT COUNT(*) AS n FROM ${d.table} WHERE tenant_id=? AND (json_extract(custom_fields,?)=? OR EXISTS(SELECT 1 FROM json_each(custom_fields,?) WHERE json_each.value=?))`).get(tenantId,path,value,path,value).n;
}
