// محرّر الصفحة (ترحيل 123): درج جانبي فوق الصفحة نفسها، يفتحه زر «تعديل هذه الصفحة» لحامل تصريح تعديل التعريفات وحده.
// يُحمَّل كسولًا من app.mjs (await import)، فالموظف العادي لا ينزّله أصلًا. الدرج يُلحق بـ<body> لأن shell() تعيد كتابة #app عند كل رسم.
//
// الدورة: مسودة ← معاينة ← نشر ← تراجع بنقرة. كل تعديل يُحفظ في مسودة على الخادم (ورقة عمل واحدة لكل صفحة)، ثم تُعاد رسم الصفحة
// الحقيقية تحته بالمسودة — يراها معدّها وحده. النشر بسبب مكتوب، والخادم هو من يصنّف الفرق: الإضافة والتشديد ينشرهما حامل النشر،
// وتخفيف ضابط ينشره شخص غير من أعدّه. الاسترجاع نسخة جديدة وثيقتها وثيقة نسخة أقدم.
//
// ما لا يملكه المحرّر يقوله ولا يخفيه: الأجزاء المكتوبة في الشاشة لا تُحرَّك من هنا، والترجمة تصل التسميات لا الجمل.
// لا مكوّن محلي هنا: النماذج كلها operationFields، والجداول والرفض والحالة الفارغة من العدّة (ctx.ui)، والرفض يُرسم كما كتبه الخادم.
// مفتاح الحقل وقيمة الخيار يولّدهما المحرّر؛ المدير لا يكتب معرّفًا.
import { operationFields,collectStructured } from './operations.mjs';
import { usePreview } from './definitions-client.mjs';
import { KIND_NAMES } from './definitions-ui.mjs';

let host=null,ctx=null,state=null,opener=null;
const TABS=[['fields','الحقول','Fields'],['layout','التخطيط','Layout'],['views','العروض','Views'],['statuses','الحالات','Statuses'],['translation','الترجمة','Translation'],['access','الصلاحيات','Access'],['history','النسخ','Versions']];
const TYPE_HINTS={text:'سطر واحد',textarea:'فقرة',number:'رقم موجب',date:'تاريخ',select:'خيار واحد من قائمة',checks:'أكثر من خيار'};
const clone=value=>JSON.parse(JSON.stringify(value??{}));
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const optional={required:false};
const slug=value=>String(value??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,30);
// بصمة قصيرة ثابتة من نص (FNV-1a): الدالة نفسها في أي متصفح وأي بيئة، بلا تبعية ولا استدعاء غير متزامن.
const stamp=value=>{let h=0x811c9dc5;for(const ch of String(value??'').normalize('NFKC').trim().toLowerCase()){h^=ch.codePointAt(0);h=Math.imul(h,0x01000193)>>>0;}return h.toString(36);};
function freshKey(wanted,taken,fallback){
  const base=/^[a-z][a-z0-9_]{1,29}$/.test(wanted)?wanted:fallback;
  let key=base,n=2;while(taken.has(key))key=`${base}_${n++}`;
  return key;
}

/* ───── الفتح والإغلاق ───── */
export async function openPageEditor(options){
  ctx=options;
  // الزر الذي فتح الدرج يُحفظ ليعود إليه التركيز عند الإغلاق. من يتنقّل بلوحة المفاتيح وحدها كان يُلقى به إلى أول الصفحة
  // بعد كل إغلاق، فيعيد المسير إلى موضعه في كل مرة. ctx.opener يمرّره app.mjs من حدث النقرة؛ وإلا فالعنصر النشط لحظة الفتح.
  opener=options.opener??(typeof document!=='undefined'?document.activeElement:null);
  if(!host){
    host=document.createElement('aside');host.id='page-editor';host.className='pe-drawer';host.setAttribute('role','dialog');host.setAttribute('aria-modal','false');host.setAttribute('aria-labelledby','pe-title');
    host.addEventListener('click',onClick);host.addEventListener('submit',onSubmit);host.addEventListener('keydown',onKey);
    host.addEventListener('change',ev=>{if(state&&ev.target?.dataset?.peChange==='entity'){state.form=null;state.problem=null;load(ev.target.value).then(()=>paint('entity'),showProblem);}});
    document.body.append(host);
  }
  host.dir=document.documentElement.dir||'rtl';host.lang=ctx.lang;
  try{document.documentElement.dataset.pageEditor='open';}catch{}
  state={tab:options.entities[0]?.terms_only?'translation':'fields',form:null,problem:null,notice:'',entityKey:options.entities[0].key,payload:null,spec:{},previewing:false};
  await load(state.entityKey);
  paint('close');
}
export function isPageEditorOpen(){return !!host&&!!state;}
export async function closePageEditor({silent=false}={}){
  if(!host||!state)return;
  const wasPreviewing=state.previewing,trigger=opener;
  state=null;host.remove();host=null;opener=null;
  try{delete document.documentElement.dataset.pageEditor;}catch{}
  usePreview(false);
  if(wasPreviewing&&!silent)await ctx.rerender();
  // بعد إعادة الرسم لا قبله: الرسم يعيد كتابة #app فيسقط العنصر المحفوظ من الصفحة. حينها يُبحث عن الزر نفسه من جديد
  // بموضعه المعروف، ثم يُترك التركيز كما هو إن لم يعد الزر مرسومًا (حُجب التصريح مثلًا) بدل أن يُقفز به إلى مكان آخر.
  if(silent)return;
  const live=trigger?.isConnected?trigger:document.querySelector?.('[data-action="page-editor"]');
  live?.focus?.({preventScroll:true});
}
async function load(entityKey){
  state.payload=await ctx.api('/definitions/'+entityKey);state.entityKey=entityKey;
  state.spec=clone(state.payload.draft?.spec??state.payload.live.spec);
  if(state.payload.entity.terms_only&&!['translation','history'].includes(state.tab))state.tab='translation';
}
const mine=()=>!state.payload.draft||state.payload.draft.prepared_by===ctx.me.id;
const canEdit=()=>state.payload.can.configure&&mine();
// كل تعديل: نسخة من الوثيقة، فتعديلها، فحفظها مسودةً على الخادم (هو من يتحقق ويطبّع)، ثم إعادة رسم الصفحة الحقيقية بالمسودة.
// رفض الخادم يُرسم كما كتبه — ما الخطأ، وما الناقص، وما الخطوة التالية — وتبقى الوثيقة على آخر ما حُفظ.
// والرفض لا يعيد رسم الدرج: ما كتبه المعدّ في النموذج يبقى أمامه، ويظهر الرفض فوقه.
function showProblem(error){
  if(!host||!state)return;
  state.problem=error;state.notice='';
  const box=host.querySelector('.pe-message');
  if(box){box.innerHTML=ctx.ui.refusal(error);box.scrollIntoView?.({block:'nearest'});}
}
async function commit(mutate,focus){
  const next=clone(state.spec);
  try{
    mutate(next);
    const draft=await ctx.api(`/definitions/${state.entityKey}/draft`,'POST',{spec:next,...(state.payload.draft?{row_version:state.payload.draft.row_version}:{})});
    state.payload.draft=draft;state.spec=clone(draft.spec);state.problem=null;state.form=null;state.notice=ctx.tr('حُفظت المسودة. الصفحة تحت الدرج تعرضها لك وحدك.','Draft saved. The page under the drawer shows it to you only.');
    state.previewing=true;usePreview(true);await ctx.rerender();
  }catch(error){return showProblem(error);}
  paint(focus);
}
async function act(path,body,done){
  try{const result=await ctx.api(`/definitions/${state.entityKey}/${path}`,'POST',body);state.problem=null;state.form=null;await done(result);}
  catch(error){return showProblem(error);}
  paint();
}
async function settle(message){
  state.notice=message;state.previewing=false;usePreview(false);
  await load(state.entityKey);await ctx.rerender();
}

/* ───── أجزاء الوثيقة ───── */
const fieldsOf=()=>state.spec.fields??[];
const liveFields=()=>fieldsOf().filter(f=>!f.retired);
const nameOf=f=>ctx.lang==='ar'?f.label.ar:f.label.en||f.label.ar;
const typeName=key=>state.payload.field_types.find(t=>t.key===key)?.name??key;
const slotName=slot=>state.payload.entity.slot_names?.[slot]??slot;
const slotsOf=spec=>{spec.layout??={};spec.layout.slots??={};for(const slot of state.payload.entity.slots)spec.layout.slots[slot]??=[];return spec.layout.slots;};
const listOf=spec=>{spec.views??={};spec.views.list??={};spec.views.list.columns??=[];spec.views.list.filters??=[];return spec.views.list;};
const pair=(ar,en)=>{const a=String(ar??'').trim(),b=String(en??'').trim();return a?(b?{ar:a,en:b}:{ar:a}):null;};

/* ───── الرسم ───── */
function paint(focus){
  if(!host||!state)return;
  const {e,tr,ui}=ctx,p=state.payload,active=focus??document.activeElement?.dataset?.peId??null;
  const tabs=TABS.filter(([key])=>!p.entity.terms_only||['translation','history'].includes(key));
  const body={fields:fieldsTab,layout:layoutTab,views:viewsTab,statuses:statusesTab,translation:translationTab,access:accessTab,history:historyTab}[state.tab]();
  host.innerHTML=`<header class="pe-head"><div><p class="pe-eyebrow">${tr('تعديل هذه الصفحة','Edit this page')}</p><h2 id="pe-title">${e(ctx.lang==='ar'?p.entity.label.ar:p.entity.label.en||p.entity.label.ar)}</h2></div>
      <button type="button" class="sheet-close" data-pe="close" data-pe-id="close" aria-label="${tr('إغلاق المحرّر','Close the editor')}">✕</button></header>
    <div class="pe-state"><span class="badge ${p.draft?'pending':'approved'}">${e(p.draft?tr('مسودة لم تُنشر','Unpublished draft'):p.live.version?tr(`النسخة ${p.live.version} منشورة`,`Version ${p.live.version} published`):tr('افتراضات الكود — لا تعريف منشور بعد','Code defaults — nothing published yet'))}</span>
      ${state.previewing?`<span class="badge in_progress">${tr('معاينة — لا يراها غيرك','Preview — only you see it')}</span>`:''}</div>
    ${ctx.entities.length>1?`<div class="pe-entity"><label><span>${tr('الكيان','Entity')}</span><select data-pe-change="entity" data-pe-id="entity">${ctx.entities.map(x=>`<option value="${e(x.key)}" ${x.key===state.entityKey?'selected':''}>${e(x.label.ar)}</option>`).join('')}</select></label></div>`:''}
    <div class="pe-tabs" role="tablist" aria-label="${tr('أقسام المحرّر','Editor sections')}">${tabs.map(([key,ar,en])=>`<button type="button" role="tab" id="pe-tab-${key}" aria-selected="${state.tab===key}" aria-controls="pe-panel" tabindex="${state.tab===key?0:-1}" data-pe="tab" data-tab="${key}" data-pe-id="tab-${key}">${tr(ar,en)}</button>`).join('')}</div>
    <div class="pe-body" id="pe-panel" role="tabpanel" aria-labelledby="pe-tab-${e(state.tab)}" tabindex="-1">
      <div class="pe-message" role="status" aria-live="polite">${state.problem?ui.refusal(state.problem):state.notice?`<p class="notice">${e(state.notice)}</p>`:''}</div>
      ${!p.can.configure?`<p class="vn-alert is-warn">${tr('تقرأ التعريف ولا تعدّله: التعديل لحامل تصريح تعديل التعريفات مع تصريح العمل على هذه الصفحة.','Read-only: editing needs the configure capability and the working capability of this page.')}</p>`:''}
      ${p.draft&&!mine()?`<p class="vn-alert is-warn">${e(tr(`مسودة قائمة باسم ${p.draft.prepared_by_name}. مسودة واحدة لكل صفحة: تُنشر أو يُتخلى عنها قبل أن تبدأ مسودتك.`,`A draft by ${p.draft.prepared_by_name} is open. One draft per page.`))}</p>`:''}
      ${body}</div>
    ${footer()}`;
  const target=active&&host.querySelector(`[data-pe-id="${CSS.escape(active)}"]`);
  (target||host.querySelector('[data-pe-id="close"]'))?.focus?.({preventScroll:true});
}
const lockedAttr=()=>canEdit()?'':' disabled';
// free: فعل لا يلزمه حق التعديل (الاسترجاع للناشر، والمعاينة والتسليم لصاحب المسودة).
const tool=(action,label,data={},extra='',free=false)=>`<button type="button" class="btn outline small" data-pe="${action}" data-pe-id="${ctx.e([action,...Object.values(data)].join('-'))}"${Object.entries(data).map(([k,v])=>` data-${k}="${ctx.e(v)}"`).join('')}${free?'':lockedAttr()}${extra}>${ctx.e(label)}</button>`;
const formOf=(name,fields,submit,{wrap=''}={})=>`<form data-pe-form="${name}" class="${wrap}"><div class="form-grid">${operationFields(fields,ctx.e)}</div><div class="form-actions"><button type="button" class="btn outline" data-pe="cancel-form" data-pe-id="cancel-form">${ctx.tr('إلغاء','Cancel')}</button><button class="btn dark" type="submit"${lockedAttr()}>${ctx.e(submit)}</button></div></form>`;

/* ───── الحقول ───── */
function fieldsTab(){
  const {e,tr,ui}=ctx,p=state.payload;
  if(state.form?.kind==='field')return fieldForm();
  const rows=fieldsOf().map(f=>`<li class="pe-row${f.retired?' is-retired':''}"><div><strong>${e(nameOf(f))}</strong><small>${e(typeName(f.type))}${f.required?` · ${tr('إلزامي','Required')}`:''}${f.show_when?` · ${tr('مشروط','Conditional')}`:''}${(f.visible_to??[]).length?` · ${tr('محجوب','Masked')}`:''}${f.retired?` · ${tr('مسحوب — قيمه باقية في السجلات','Retired — values stay on records')}`:''}</small></div>
    <div class="pe-tools">${f.retired?'':tool('edit-field',tr('تعديل','Edit'),{key:f.key})}${tool('retire-field',f.retired?tr('إعادة','Restore'):tr('سحب','Retire'),{key:f.key})}</div></li>`).join('');
  const system=p.system_fields.filter(f=>!f.maskable).map(f=>`<li class="pe-row is-locked"><div><strong>${e(f.label)}</strong><small>${e(f.locked?f.locked_note:tr('حقل مكتوب في الشاشة — تُعدَّل تسميته من «الترجمة»','Written in the screen — rename it under Translation'))}${f.inherits_from?` · ${tr('يرث اسم كيانه','Inherits its entity name')}`:''}</small></div></li>`).join('');
  return `<h3>${tr('إضافة حقل','Add a field')}</h3><p>${tr('اختر نوع الحقل، ثم سمِّه. المعرّف يولّده المحرّر.','Choose a type, then name it. The key is generated.')}</p>
    <div class="pe-types">${p.field_types.map(t=>`<button type="button" data-pe="add-field" data-type="${e(t.key)}" data-pe-id="add-${e(t.key)}"${lockedAttr()}><strong>${e(t.name)}</strong><small>${e(TYPE_HINTS[t.key]??'')}</small></button>`).join('')}</div>
    <h3>${tr('الحقول المخصّصة','Custom fields')}</h3>${rows?`<ul class="pe-list">${rows}</ul>`:ui.empty(tr('لا حقول مخصّصة بعد','No custom fields yet'),tr('أضف أول حقل من الأنواع أعلاه.','Add the first one from the types above.'))}
    <h3>${tr('حقول الشاشة','Screen fields')}</h3><ul class="pe-list">${system}</ul><p>${e(p.limits.identity)}</p>`;
}
function fieldForm(){
  const {tr}=ctx,p=state.payload,editing=state.form.key?fieldsOf().find(f=>f.key===state.form.key):null,type=editing?.type??state.form.type,textual=['text','textarea'].includes(type),choice=['select','checks'].includes(type);
  const tones=[{value:'',label:tr('بلا لون','No colour')},...p.tones.map(t=>({value:t.key,label:t.name}))];
  // شرط الظهور يُقرأ من حقل اختيار سبق هذا الحقل ولا يكون هو نفسه مشروطًا (قاعدة الخادم). كل بند هنا «حقل = خيار»، وتُؤشَّر بنود حقل واحد.
  const before=editing?fieldsOf().slice(0,fieldsOf().indexOf(editing)):fieldsOf();
  const sources=before.filter(f=>f.type==='select'&&!f.retired&&!f.show_when).flatMap(f=>f.options.filter(o=>!o.retired).map(o=>({value:`${f.key}=${o.value}`,label:`${f.label.ar} = ${o.label.ar}`})));
  const fields=[field('label_ar',tr('اسم الحقل بالعربية','Arabic label'),'text',{value:editing?.label.ar??'',maxLength:100}),
    field('label_en',tr('اسم الحقل بالإنجليزية','English label'),'text',{...optional,value:editing?.label.en??'',maxLength:100,hint:tr('يظهر حين تكون الواجهة بالإنجليزية.','Shown when the interface is in English.')}),
    field('help',tr('نص مساعدة تحت الحقل','Help text under the field'),'textarea',{...optional,value:editing?.help??'',maxLength:500}),
    field('required',tr('إلزامي في كل حفظ','Required on every save'),'checkbox',{...optional,value:!!editing?.required,hint:tr('الإلزام عند انتقال بعينه («إصدار العرض») يُضبط من تبويب «الحالات».','Required on one transition is set under Statuses.')}),
    ...(choice?[field('options',tr('الخيارات','Options'),'rows',{minRows:1,maxRows:40,value:(editing?.options??[]).map(o=>({value:o.value,label_ar:o.label.ar,label_en:o.label.en??'',tone:o.tone??''})),
      columns:[{name:'value',label:'—',required:false},{name:'label_ar',label:tr('اسم الخيار','Option name'),maxLength:100},{name:'label_en',label:tr('بالإنجليزية','In English'),required:false,maxLength:100},
        {name:'tone',label:tr('اللون','Colour'),type:'select',required:false,options:tones}],
      hint:tr('الألوان من لوحة الهوية. الخيار المنشور لا يُحذف بل يُسحب من القائمة أسفل النموذج، فتبقى السجلات التي اختارته مقروءة.','Colours come from the brand palette. A published option is retired from the list under the form, never deleted.')})]:[]),
    ...(textual?[field('min_length',tr('أقل عدد أحرف','Minimum length'),'number',{...optional,min:1,max:3000,value:editing?.min_length??''}),field('max_length',tr('أكثر عدد أحرف','Maximum length'),'number',{...optional,min:1,max:3000,value:editing?.max_length??''}),
      field('pattern',tr('صيغة مقبولة (تعبير نمطي)','Accepted pattern (regular expression)'),'text',{...optional,value:editing?.pattern??'',maxLength:200}),field('pattern_message',tr('رسالة تقول ما المقبول','Message stating what is accepted'),'text',{...optional,value:editing?.pattern_message??'',maxLength:300})]:[]),
    ...(type==='number'?[field('min',tr('أقل قيمة','Minimum'),'number',{...optional,min:0,value:editing?.min??''}),field('max',tr('أعلى قيمة','Maximum'),'number',{...optional,min:0,value:editing?.max??''})]:[]),
    ...(type==='select'&&editing?[field('default',tr('القيمة المقترحة في نموذج جديد','Suggested value on a new form'),'select',{...optional,value:editing.default??'',options:[{value:'',label:tr('بلا اقتراح','None')},...editing.options.filter(o=>!o.retired).map(o=>({value:o.value,label:o.label.ar}))]})]
      :['text','number','date'].includes(type)?[field('default',tr('القيمة المقترحة في نموذج جديد','Suggested value on a new form'),type==='date'?'date':'text',{...optional,value:editing?.default??'',hint:tr('اقتراح يُعرض في النموذج ولا يُكتب في سجل.','A suggestion shown on the form; never written to a record.')})]:[]),
    ...(sources.length?[field('show_when',tr('يظهر هذا الحقل فقط حين…','Show this field only when…'),'checks',{...optional,options:sources,value:(editing?.show_when?.equals??[]).map(x=>`${editing.show_when.field}=${x}`),hint:tr('بلا تأشير: يظهر دائمًا. أشّر خيارات حقل واحد.','Nothing ticked: always shown. Tick options of one field.')})]:[]),
    field('searchable',tr('يدخل البحث الشامل','Include in global search'),'checkbox',{...optional,value:!!editing?.searchable,hint:tr('حقل محجوب عن بعض الحسابات لا يدخل فهرس البحث أصلًا.','A masked field never enters the search index.')}),
    field('tracked',tr('يُحفظ سجل تغيّر قيمته','Keep a history of its value'),'checkbox',{...optional,value:!!editing?.tracked})];
  state.form.fields=fields;
  // سحب خيار وإعادته زرّان لا عمود في الجدول: الخيار المسحوب لا يُعرض للاختيار، والسجلات التي اختارته تبقى مقروءة باسمه.
  const retiring=choice&&editing?`<h3>${tr('سحب خيار أو إعادته','Retire or restore an option')}</h3><ul class="pe-list">${editing.options.map(o=>`<li class="pe-row${o.retired?' is-retired':''}"><div><strong>${ctx.e(o.label.ar)}</strong><small>${o.retired?tr('مسحوب — لا يُعرض للاختيار','Retired — no longer offered'):tr('سارٍ','Active')}</small></div><div class="pe-tools">${tool('retire-option',o.retired?tr('إعادة','Restore'):tr('سحب','Retire'),{key:editing.key,value:o.value})}</div></li>`).join('')}</ul>`:'';
  return `<h3>${ctx.e(editing?tr(`تعديل «${editing.label.ar}»`,`Edit “${nameOf(editing)}”`):`${tr('حقل جديد','New field')}: ${typeName(type)}`)}</h3><p>${tr('من يرى الحقل ومن يعدّله: من تبويب «الصلاحيات» بعد حفظه.','Who sees and edits it: under Access after saving.')}</p>${formOf('field',fields,tr('حفظ في المسودة','Save to draft'),{wrap:'pe-options'})}${retiring}`;
}
function saveField(values){
  const editing=state.form.key??null,type=editing?fieldsOf().find(f=>f.key===editing).type:state.form.type,number=value=>value===''||value===undefined||value===null?undefined:Number(value);
  const label=pair(values.label_ar,values.label_en);
  if(!label)throw new Error(ctx.tr('اسم الحقل بالعربية مطلوب','The Arabic label is required'));
  const when=values.show_when??[],whenFields=[...new Set(when.map(x=>x.split('=')[0]))];
  if(whenFields.length>1)throw new Error(ctx.tr('شرط الظهور يُقرأ من حقل واحد: أشّر خيارات حقل واحد فقط','The condition reads one field: tick options of a single field'));
  return commit(spec=>{
    spec.fields??=[];
    const taken=new Set([...spec.fields.map(f=>f.key),...state.payload.system_fields.map(f=>f.key)]);
    const current=editing?spec.fields.find(f=>f.key===editing):null,next=current??{key:freshKey(slug(values.label_en),taken,'field'),type};
    Object.assign(next,{label,required:values.required==='on'});
    for(const flag of ['searchable','tracked'])if(values[flag]==='on')next[flag]=true;else delete next[flag];
    if(String(values.help??'').trim())next.help=String(values.help).trim();else delete next.help;
    for(const rule of ['min_length','max_length','min','max']){const n=number(values[rule]);if(n===undefined||Number.isNaN(n))delete next[rule];else next[rule]=n;}
    if(String(values.pattern??'').trim()){next.pattern=String(values.pattern).trim();next.pattern_message=String(values.pattern_message??'').trim();}else{delete next.pattern;delete next.pattern_message;}
    if(String(values.default??'').trim())next.default=String(values.default).trim();else delete next.default;
    if(when.length)next.show_when={field:whenFields[0],equals:when.map(x=>x.split('=')[1])};else delete next.show_when;
    if(['select','checks'].includes(type)){
      const used=new Set();
      // مفتاح الخيار يُشتق من اسمه لا من موضعه في الجدول. مفتاحٌ بالموضع («option_1») يجعل بيئتين ضبطهما إنسانان بالأسماء
      // نفسها لا تتفقان على مفتاح واحد أبدًا، فتقرأ حزمةُ النقل كل خيار «جديدًا» وتحسب كل خيار قديم «محذوفًا».
      // الاسم بالإنجليزية إن كُتب (مفتاح مقروء)، وإلا بصمةُ الاسم العربي: الاسم نفسه يعطي المفتاح نفسه في البيئتين.
      next.options=(values.options??[]).filter(o=>String(o.label_ar??'').trim()).map(o=>{
        const value=o.value&&!used.has(o.value)?o.value:freshKey(slug(o.label_en),used,`opt_${stamp(o.label_ar)}`);used.add(value);
        return {value,label:pair(o.label_ar,o.label_en),...(o.tone?{tone:o.tone}:{}),...(current?.options?.find(x=>x.value===value)?.retired?{retired:true}:{})};
      });
    }
    if(!current)spec.fields.push(next);
  },editing?`edit-field-${editing}`:`add-${type}`);
}

/* ───── التخطيط ───── */
function layoutTab(){
  const {e,tr}=ctx,p=state.payload,slots=slotsOf(clone(state.spec)),placed=new Set(Object.values(slots).flat()),byKey=new Map(liveFields().map(f=>[f.key,f]));
  const others=slot=>p.entity.slots.filter(s=>s!==slot);
  const block=slot=>`<h3>${e(slotName(slot))}</h3><ul class="pe-list"><li class="pe-row is-locked"><div><strong>${tr('جزء مكتوب في الشاشة','Written in the screen')}</strong><small>${tr('لا يُحرَّك من هنا بعد','Not movable from here yet')}</small></div></li>
    ${slots[slot].filter(key=>byKey.has(key)).map((key,index,list)=>`<li class="pe-row"><div><strong>${e(nameOf(byKey.get(key)))}</strong><small>${tr('الموضع','Position')} ${index+1}</small></div><div class="pe-tools">
      ${tool('move',tr('▲ أعلى','▲ Up'),{key,dir:'up'},index===0?' disabled':'')}${tool('move',tr('▼ أسفل','▼ Down'),{key,dir:'down'},index===list.length-1?' disabled':'')}
      ${others(slot).map(s=>tool('place',`${tr('انقل إلى','Move to')} ${slotName(s)}`,{key,slot:s})).join('')}${tool('place',tr('أزل من الموضع','Unplace'),{key,slot:'none'})}</div></li>`).join('')}</ul>`;
  const loose=liveFields().filter(f=>!placed.has(f.key));
  return `${p.entity.slots.map(block).join('')}
    <h3>${tr('حقول بلا موضع','Unplaced fields')}</h3>${loose.length?`<ul class="pe-list">${loose.map(f=>`<li class="pe-row"><div><strong>${e(nameOf(f))}</strong><small>${tr('تظهر آخر المتن حتى تُوضع','Shown at the end of the body until placed')}</small></div><div class="pe-tools">${p.entity.slots.map(s=>tool('place',`${tr('ضع في','Place in')} ${slotName(s)}`,{key:f.key,slot:s})).join('')}</div></li>`).join('')}</ul>`:`<p>${tr('كل الحقول موضوعة.','Every field is placed.')}</p>`}
    <p>${e(p.limits.layout)}</p>`;
}

/* ───── العروض ───── */
function viewsTab(){
  const {e,tr}=ctx,list=listOf(clone(state.spec)),fields=liveFields();
  const rows=fields.map(f=>{const column=list.columns.includes(f.key),at=list.columns.indexOf(f.key);
    return `<li class="pe-row"><div><strong>${e(nameOf(f))}</strong><small>${column?`${tr('عمود رقم','Column')} ${at+1}`:tr('ليس عمودًا','Not a column')}${list.filters.includes(f.key)?` · ${tr('مرشّح','Filter')}`:''}</small></div><div class="pe-tools">
      ${tool('toggle-column',column?tr('أزل العمود','Remove column'):tr('أضف عمودًا','Add as column'),{key:f.key},` aria-pressed="${column}"`)}
      ${f.type==='select'?tool('toggle-filter',list.filters.includes(f.key)?tr('أزل المرشّح','Remove filter'):tr('أضف مرشّحًا','Add as filter'),{key:f.key},` aria-pressed="${list.filters.includes(f.key)}"`):''}
      ${column?tool('move-column',tr('▲ قدّم','▲ Earlier'),{key:f.key,dir:'up'},at===0?' disabled':'')+tool('move-column',tr('▼ أخّر','▼ Later'),{key:f.key,dir:'down'},at===list.columns.length-1?' disabled':''):''}</div></li>`;}).join('');
  const sortValue=list.sort?`${list.sort.field}:${list.sort.direction}`:'';
  const sortFields=[field('sort',tr('الترتيب الافتراضي للقائمة','Default list order'),'select',{...optional,value:sortValue,options:[{value:'',label:tr('ترتيب الشاشة','Screen order')},
    ...fields.flatMap(f=>[{value:`${f.key}:asc`,label:`${nameOf(f)} — ${tr('تصاعدي','ascending')}`},{value:`${f.key}:desc`,label:`${nameOf(f)} — ${tr('تنازلي','descending')}`}])]})];
  return `<h3>${tr('أعمدة القائمة ومرشحاتها','List columns and filters')}</h3><p>${tr('أعمدة الشاشة الأساسية ثابتة؛ تُضاف بعدها الحقول المخصّصة بالترتيب الذي تختاره. المرشّح لحقل «قائمة اختيار».','The screen’s own columns are fixed; custom fields follow in your order. A filter needs a choice-list field.')}</p>
    ${rows?`<ul class="pe-list">${rows}</ul>`:ctx.ui.empty(tr('لا حقول مخصّصة بعد','No custom fields yet'),tr('أضف حقلًا من تبويب «الحقول» أولًا.','Add a field under Fields first.'))}${fields.length?formOf('sort',sortFields,tr('حفظ الترتيب','Save order')):''}`;
}

/* ───── الحالات والإلزام عند الانتقال ───── */
function statusesTab(){
  const {e,tr,ui}=ctx,p=state.payload,tones=[{value:'',label:tr('لون الشاشة','Screen colour')},...p.tones.map(t=>({value:t.key,label:t.name}))];
  const statusFields=p.entity.statuses.flatMap(s=>{const o=state.spec.statuses?.[s.key]??{};return [
    field(`st:${s.key}:ar`,`${s.default_label} — ${tr('العبارة بالعربية','Arabic phrase')}`,'text',{...optional,value:o.label?.ar??'',maxLength:60,placeholder:s.default_label}),
    field(`st:${s.key}:en`,`${s.default_label} — ${tr('بالإنجليزية','in English')}`,'text',{...optional,value:o.label?.en??'',maxLength:60}),
    field(`st:${s.key}:tone`,`${s.default_label} — ${tr('اللون','colour')}`,'select',{...optional,value:o.tone??'',options:tones})];});
  const fields=liveFields(),head=[tr('الحقل','Field'),...p.entity.transitions.map(t=>t.label)];
  const matrix=fields.map(f=>`<tr><td>${e(nameOf(f))}</td>${p.entity.transitions.map(t=>`<td><input type="checkbox" name="req:${e(t.key)}:${e(f.key)}" aria-label="${e(`${nameOf(f)} — ${t.label}`)}" ${(state.spec.transitions?.[t.key]?.require??[]).includes(f.key)?'checked':''}${lockedAttr()}></td>`).join('')}</tr>`);
  state.form={kind:'statuses',fields:statusFields};
  return `<h3>${tr('الإلزام عند الانتقال','Required on a transition')}</h3><p>${tr('الخادم هو من يحكم: انتقال يُلزم حقلًا لا يُنفَّذ قبل استكماله، ولو أخفته واجهة. إضافة إلزام تشديد ينشره شخص واحد؛ رفعه تخفيف ينشره غير من أعدّه.','The server is the judge: a transition is refused until the field is filled. Adding a rule is tightening; removing one is loosening and needs a second publisher.')}</p>
    ${p.entity.transitions.length&&fields.length?`<form data-pe-form="require" class="pe-matrix">${ui.table({head,rows:matrix})}<div class="form-actions"><button class="btn dark" type="submit"${lockedAttr()}>${tr('حفظ الإلزام','Save rules')}</button></div></form>`:`<p>${tr('يلزم حقل مخصّص واحد على الأقل وانتقال معلن في الصفحة.','Needs a custom field and a declared transition.')}</p>`}
    <h3>${tr('عبارات الحالات وألوانها','Status phrases and colours')}</h3><p>${tr('الحالات والانتقالات نفسها كود: وراء كل انتقال قرار وصلاحية وزناد نهائية، فلا تُضاف ولا تُحذف من هنا. العبارة الفارغة تعني عبارة الشاشة.','Statuses and transitions are code; only their phrases and colours are edited here. Empty means the screen’s phrase.')}</p>
    ${statusFields.length?formOf('statuses',statusFields,tr('حفظ العبارات','Save phrases')):''}`;
}

/* ───── الترجمة ───── */
function translationTab(){
  const {tr}=ctx,p=state.payload;
  if(p.entity.terms_only){
    const terms=Object.entries(p.term_defaults).flatMap(([key,d])=>{const o=state.spec.terms?.[key]??{};return [field(`term:${key}:ar`,`${d.ar}`,'text',{...optional,value:o.ar??'',maxLength:60,placeholder:d.ar}),field(`term:${key}:en`,`${d.ar} — ${tr('بالإنجليزية','in English')}`,'text',{...optional,value:o.en??'',maxLength:60,placeholder:d.en})];});
    state.form={kind:'terms',fields:terms};
    return `<h3>${tr('مصطلحات المنصة','Platform terms')}</h3><p>${tr('عبارات حالات الطلب وأسماء الأدوار وعبارات حالات الوحدات. العبارة الفارغة تعني عبارة القاموس. القاموس نفسه يبقى منزل العبارات الافتراضية الوحيد؛ هنا تُحفظ الفروق.','Request statuses, role names and module phrases. Empty means the vocabulary default; only differences are stored here.')}</p>${formOf('terms',terms,tr('حفظ المصطلحات','Save terms'))}<p>${ctx.e(p.limits.translation)}</p>`;
  }
  const entity=state.spec.entity?.label??{};
  const fields=[field('entity:ar',`${tr('اسم الكيان','Entity name')} — ${p.entity.default_label.ar}`,'text',{...optional,value:entity.ar??'',maxLength:100,placeholder:p.entity.default_label.ar,hint:tr('يتبعه كل حقل يشير إلى هذا الكيان في الشاشات الأخرى والحوارات ونماذج الطلبات.','Every field that refers to this entity follows it, on other screens, dialogs and request forms.')}),
    field('entity:en',`${tr('اسم الكيان بالإنجليزية','Entity name in English')}`,'text',{...optional,value:entity.en??'',maxLength:100,placeholder:p.entity.default_label.en??''}),
    ...p.system_fields.filter(f=>!f.maskable&&!f.locked).flatMap(f=>{const o=state.spec.system?.[f.key]?.label??{};return [field(`sys:${f.key}:ar`,f.default_label,'text',{...optional,value:o.ar??'',maxLength:100,placeholder:f.label}),field(`sys:${f.key}:en`,`${f.default_label} — ${tr('بالإنجليزية','in English')}`,'text',{...optional,value:o.en??'',maxLength:100})];}),
    ...liveFields().flatMap(f=>[field(`cf:${f.key}:ar`,`${f.label.ar} (${tr('حقل مخصّص','custom')})`,'text',{value:f.label.ar,maxLength:100}),field(`cf:${f.key}:en`,`${f.label.ar} — ${tr('بالإنجليزية','in English')}`,'text',{...optional,value:f.label.en??'',maxLength:100})])];
  state.form={kind:'translation',fields};
  return `<h3>${tr('تسميات هذه الصفحة باللغتين','Labels of this page in both languages')}</h3><p>${tr('الخانة الفارغة تعني تسمية الشاشة كما كُتبت.','Empty means the label as written in the screen.')}</p>${formOf('translation',fields,tr('حفظ التسميات','Save labels'))}<p>${ctx.e(p.limits.translation)}</p>`;
}

/* ───── الصلاحيات ───── */
function accessTab(){
  const {e,tr}=ctx,p=state.payload,figures=p.system_fields.filter(f=>f.maskable);
  if(state.form?.kind==='access'){
    const target=state.form.figure?{label:figures.find(f=>f.key===state.form.key).label,visible:state.spec.system?.[state.form.key]?.visible_to??[]}:(f=>({label:nameOf(f),visible:f.visible_to??[],editable:f.editable_by??[]}))(fieldsOf().find(f=>f.key===state.form.key));
    const options=p.capabilities.map(c=>({value:c.key,label:`${c.name}${c.sensitive?` — ${tr('حساس','sensitive')}`:''}`}));
    const fields=[field('visible_to',tr('من يرى — بلا تأشير: كل من يفتح الصفحة','Who sees it — nothing ticked: everyone who opens the page'),'checks',{...optional,options,value:target.visible}),
      ...(state.form.figure?[]:[field('editable_by',tr('من يعدّل — بلا تأشير: كل من يراه','Who edits it — nothing ticked: everyone who sees it'),'checks',{...optional,options,value:target.editable})])];
    state.form.fields=fields;
    return `<h3>${e(target.label)}</h3><p>${tr('السجل يطرح ولا يمنح: القائمة تصاريح يحكمها الخادم، فلا يفتح التعريف ما أغلقه الكود. الحقل المحجوب غائب عن غير أهله في الصفحة والقائمة والتصدير والبحث — لا مخفيٌّ في الواجهة.','The registry subtracts, never grants. A masked field is absent — not hidden — for everyone else: page, list, export and search.')}</p><div class="pe-caps">${formOf('access',fields,tr('حفظ في المسودة','Save to draft'))}</div>`;
  }
  const names=list=>list?.length?list.map(key=>p.capabilities.find(c=>c.key===key)?.name??key).join('، '):null;
  const rows=liveFields().map(f=>`<li class="pe-row"><div><strong>${e(nameOf(f))}</strong><small>${tr('يراه','Seen by')}: ${e(names(f.visible_to)??tr('كل من يفتح الصفحة','everyone who opens the page'))} · ${tr('يعدّله','Edited by')}: ${e(names(f.editable_by)??tr('كل من يراه','everyone who sees it'))}</small></div><div class="pe-tools">${tool('edit-access',tr('ضبط','Set'),{key:f.key})}</div></li>`).join('');
  const figureRows=figures.map(f=>`<li class="pe-row"><div><strong>${e(f.label)}</strong><small>${tr('يراه','Seen by')}: ${e(names(state.spec.system?.[f.key]?.visible_to)??tr('كل من تسمح له الشاشة','everyone the screen allows'))}</small></div><div class="pe-tools">${tool('edit-access',tr('ضبط','Set'),{key:f.key,figure:'1'})}</div></li>`).join('');
  return `<h3>${tr('من يرى كل حقل ومن يعدّله','Who sees and edits each field')}</h3><p>${e(p.limits.publish_rule)}</p>${rows?`<ul class="pe-list">${rows}</ul>`:`<p>${tr('لا حقول مخصّصة بعد.','No custom fields yet.')}</p>`}
    ${figureRows?`<h3>${tr('أرقام الشاشة القابلة للحجب','Maskable screen figures')}</h3><ul class="pe-list">${figureRows}</ul>`:''}
    ${(ctx.me.can??[]).includes('access.view_as')?`<h3>${tr('جرّب كمستخدم','Try as a user')}</h3><p>${tr('انشر ثم افتح المنصة بدور آخر لترى ما يراه: قراءة فقط، بهويتك أنت، وتُسجَّل التجربة.','Publish, then open the platform under another role: read-only, as yourself, and recorded.')}</p><button type="button" class="btn outline" data-action="view-as">${tr('جرّب كمستخدم…','Try as a user…')}</button>`:''}`;
}

/* ───── النسخ ───── */
const diffList=items=>`<ul class="pe-diff">${items.slice(0,12).map(i=>`<li class="is-${ctx.e(i.class)}">${ctx.e(KIND_NAMES[i.kind]??i.kind)}: ${ctx.e(i.label)}</li>`).join('')}${items.length>12?`<li>+${items.length-12}</li>`:''}</ul>`;
function historyTab(){
  const {e,tr,ui,date}=ctx,p=state.payload;
  const rows=p.history.map(h=>`<li class="pe-row"><div><strong>${tr('النسخة','Version')} ${e(h.version)} · ${e(h.state_name)}</strong><small>${e(h.change_class_name)} · ${e(h.origin_name)} · ${tr('أعدّها','prepared by')} ${e(h.prepared_by_name)}${h.two_person?` · ${tr('نشرها','published by')} ${e(h.published_by_name)}`:''} · ${e(date(h.created_at))}</small><small>${e(h.note)}</small>${diffList(h.change_summary.items)}</div>
    <div class="pe-tools">${h.can_roll_back&&p.can.publish?tool('rollback',tr('استرجاع هذه النسخة','Roll back to this'),{version:h.version},'',true):''}</div></li>`).join('');
  return `<h3>${tr('سجل النسخ','Version history')}</h3><p>${tr('النسخة المنشورة لا تُعدَّل: كل تغيير نسخة جديدة، والاسترجاع نسخة جديدة وثيقتها وثيقة نسخة أقدم. كل نشر حدث في سلسلة التدقيق.','A published version is never rewritten. A rollback is a new version that equals an older one. Every publish is an audit event.')}</p>
    ${rows?`<ul class="pe-list">${rows}${p.can.publish?`<li class="pe-row"><div><strong>${tr('افتراضات الكود','Code defaults')}</strong><small>${tr('الصفحة كما كتبها الكود، بلا أي طبقة','The page as written, with no overlay')}</small></div><div class="pe-tools">${tool('rollback',tr('استرجاع','Roll back'),{version:0},'',true)}</div></li>`:''}</ul>`:ui.empty(tr('لا نسخة منشورة بعد','Nothing published yet'),tr('الصفحة على افتراضات الكود.','The page runs on code defaults.'))}`;
}

/* ───── التذييل: مسودة ← معاينة ← نشر ← تراجع ───── */
function footer(){
  const {e,tr}=ctx,p=state.payload,d=p.draft;
  if(!d)return `<footer class="pe-foot"><small>${tr('لا تغييرات غير منشورة. أي تعديل يبدأ مسودة لا يراها غيرك.','No unpublished changes. Any edit starts a draft only you can see.')}</small>
    ${p.can.publish&&p.live.version>0?`<div class="pe-foot-row">${tool('rollback',tr('تراجع عن آخر نشر','Undo the last publish'),{version:p.live.version-1},'',true)}</div>`:''}</footer>`;
  // مسودة غيرك لم تُسلَّم: الخادم لا يرسل وثيقتها ولا فرقها. يُقال ذلك بصراحة بدل «صفر تغييرات» التي تقرأ كأن لا شيء فيها.
  if(d.withheld)return `<footer class="pe-foot"><small>${e(d.withheld_note)}</small>
    <div class="pe-foot-row">${p.can.discard?`<button type="button" class="btn outline danger" data-pe="discard" data-pe-id="discard">${tr('تخلَّ عن المسودة','Discard the draft')}</button>`:''}</div></footer>`;
  const second=d.needs_second_publisher&&d.prepared_by===ctx.me.id,publish=p.can.publish&&!second&&d.diff.length>0;
  // ما في المسودة مطويٌّ في سطر: عدده وصنفه كما صنّفه الخادم، ويُفتح لقراءة بنوده. الدرج على الجوال صفيحة، فلا يأكل التذييل نصفها.
  const summary=e(`${tr('عدد التغييرات في المسودة','Changes in the draft')}: ${d.diff.length} — ${d.change_class_name}${d.submitted_at?` · ${tr('سُلّمت للنشر','handed to a publisher')}`:''}${d.stale?` · ${tr('بُنيت على نسخة أقدم: أعد حفظها','built on an older version: save it again')}`:''}`);
  return `<footer class="pe-foot">${d.diff.length?`<details class="pe-changes"><summary>${summary}</summary>${diffList(d.diff)}</details>`:`<small>${summary}</small>`}
    ${second?`<small>${tr('هذا التغيير يخفّف ضابطًا، فلا ينشره من أعدّه: سلّمه لناشر آخر.','This loosens a control: hand it to another publisher.')}</small>`:''}
    ${publish?`<label><span>${tr('سبب النشر (يُحفظ في سجل النسخ)','Reason for publishing (kept in the history)')}</span><input data-pe-id="note" name="pe-note" maxlength="1000" value="${e(state.note??'')}"></label>`:''}
    <div class="pe-foot-row">${mine()?tool('preview',state.previewing?tr('أوقف المعاينة','Stop preview'):tr('معاينة على الصفحة','Preview on the page'),{},` aria-pressed="${state.previewing}"`,true):''}
      ${publish?`<button type="button" class="btn primary" data-pe="publish" data-pe-id="publish">${tr('نشر','Publish')}</button>`:''}
      ${mine()&&!d.submitted_at&&d.diff.length&&(!p.can.publish||second)?tool('submit',tr('تسليم للنشر','Hand to a publisher'),{},'',true):''}
      ${p.can.discard?`<button type="button" class="btn outline danger" data-pe="discard" data-pe-id="discard">${tr('تخلَّ عن المسودة','Discard the draft')}</button>`:''}</div></footer>`;
}

/* ───── الأحداث ───── */
async function onClick(ev){
  const button=ev.target.closest('[data-pe]');if(!button||!state)return;
  const action=button.dataset.pe,key=button.dataset.key,{tr}=ctx;
  const noteInput=host.querySelector('[name="pe-note"]');if(noteInput)state.note=noteInput.value;
  if(action==='close')return closePageEditor();
  if(action==='tab'){state.tab=button.dataset.tab;state.form=null;state.problem=null;state.notice='';return paint(`tab-${state.tab}`);}
  if(action==='cancel-form'){state.form=null;state.problem=null;return paint();}
  if(action==='add-field'){state.form={kind:'field',type:button.dataset.type};state.problem=null;return paint();}
  if(action==='edit-field'){state.form={kind:'field',key};state.problem=null;return paint();}
  if(action==='edit-access'){state.form={kind:'access',key,figure:button.dataset.figure==='1'};state.problem=null;return paint();}
  if(action==='retire-option')return commit(spec=>{const o=spec.fields.find(x=>x.key===key).options.find(x=>x.value===button.dataset.value);if(o.retired)delete o.retired;else o.retired=true;},`edit-field-${key}`);
  if(action==='retire-field')return commit(spec=>{const f=spec.fields.find(x=>x.key===key);if(f.retired)delete f.retired;else{f.retired=true;
    for(const list of Object.values(slotsOf(spec)))if(list.includes(key))list.splice(list.indexOf(key),1);const view=listOf(spec);view.columns=view.columns.filter(x=>x!==key);view.filters=view.filters.filter(x=>x!==key);if(view.sort?.field===key)delete view.sort;}});
  if(action==='move')return commit(spec=>{const list=Object.values(slotsOf(spec)).find(x=>x.includes(key)),at=list.indexOf(key),to=at+(button.dataset.dir==='up'?-1:1);if(to>=0&&to<list.length)[list[at],list[to]]=[list[to],list[at]];});
  if(action==='place')return commit(spec=>{const slots=slotsOf(spec);for(const list of Object.values(slots))if(list.includes(key))list.splice(list.indexOf(key),1);if(button.dataset.slot!=='none')slots[button.dataset.slot].push(key);});
  if(action==='toggle-column')return commit(spec=>{const list=listOf(spec);if(list.columns.includes(key)){list.columns=list.columns.filter(x=>x!==key);list.filters=list.filters.filter(x=>x!==key);}else list.columns.push(key);});
  if(action==='toggle-filter')return commit(spec=>{const list=listOf(spec);if(list.filters.includes(key))list.filters=list.filters.filter(x=>x!==key);else{list.filters.push(key);if(!list.columns.includes(key))list.columns.push(key);}});
  if(action==='move-column')return commit(spec=>{const list=listOf(spec).columns,at=list.indexOf(key),to=at+(button.dataset.dir==='up'?-1:1);if(to>=0&&to<list.length)[list[at],list[to]]=[list[to],list[at]];});
  if(action==='preview'){state.previewing=!state.previewing;usePreview(state.previewing);await ctx.rerender();return paint('preview');}
  if(action==='publish')return act('publish',{row_version:state.payload.draft.row_version,note:state.note??''},async result=>{state.note='';await settle(tr(`نُشرت النسخة ${result.version} (${result.change_class_name}). تسري على الجميع من الآن، بلا إعادة تشغيل.`,`Version ${result.version} is live for everyone now.`));});
  if(action==='submit')return act('draft/submit',{row_version:state.payload.draft.row_version},async result=>{await load(state.entityKey);state.notice=tr(`سُلّمت المسودة للنشر. ${result.publishers_note??''}`,'The draft was handed to a publisher.');});
  if(action==='discard')return act('draft/discard',{note:tr('تخلٍّ من محرّر الصفحة','Discarded from the page editor')},()=>settle(tr('تُخلّي عن المسودة. الصفحة على تعريفها المنشور.','Draft discarded.')));
  if(action==='rollback'){const to=Number(button.dataset.version);
    return act('rollback',{to_version:to,note:to?`استرجاع النسخة ${to} من محرّر الصفحة`:'استرجاع افتراضات الكود من محرّر الصفحة'},result=>settle(result.published?tr(`استُرجعت النسخة ${to}: صارت النسخة ${result.version} السارية.`,`Rolled back to ${to}: now live as version ${result.version}.`):tr(`هذا الاسترجاع يخفّف ضابطًا، فينتظر ناشرًا ثانيًا. ${result.publishers_note??''}`,'This rollback loosens a control and waits for a second publisher.')));}
}
async function onSubmit(ev){
  // النماذج هنا لا تصعد إلى مستمع app.mjs العام: هو يعالج نماذج الحوار، وهذه تُحفظ في مسودة التعريف.
  ev.preventDefault();ev.stopPropagation();
  const form=ev.target,name=form.dataset.peForm;if(!name||!state)return;
  const values=Object.fromEntries(new FormData(form)),text=key=>String(values[key]??'').trim();
  try{
    if(state.form?.fields)collectStructured(form,state.form.fields,values);
    if(name==='field')return await saveField(values);
    if(name==='sort')return await commit(spec=>{const list=listOf(spec),[sortField,direction]=text('sort').split(':');if(sortField)list.sort={field:sortField,direction};else delete list.sort;});
    if(name==='require')return await commit(spec=>{spec.transitions={};for(const t of state.payload.entity.transitions){const require=liveFields().map(f=>f.key).filter(k=>values[`req:${t.key}:${k}`]==='on');if(require.length)spec.transitions[t.key]={require};}});
    if(name==='statuses')return await commit(spec=>{spec.statuses={};for(const s of state.payload.entity.statuses){const label=pair(text(`st:${s.key}:ar`),text(`st:${s.key}:en`)),tone=text(`st:${s.key}:tone`);if(label||tone)spec.statuses[s.key]={...(label?{label}:{}),...(tone?{tone}:{})};}});
    if(name==='terms')return await commit(spec=>{spec.terms={};for(const key of Object.keys(state.payload.term_defaults)){const label=pair(text(`term:${key}:ar`),text(`term:${key}:en`));if(label)spec.terms[key]=label;}});
    if(name==='translation')return await commit(spec=>{
      const entity=pair(text('entity:ar'),text('entity:en'));if(entity)spec.entity={label:entity};else delete spec.entity;
      spec.system??={};
      for(const f of state.payload.system_fields.filter(x=>!x.maskable&&!x.locked)){const label=pair(text(`sys:${f.key}:ar`),text(`sys:${f.key}:en`));spec.system[f.key]??={};if(label)spec.system[f.key].label=label;else delete spec.system[f.key].label;if(!Object.keys(spec.system[f.key]).length)delete spec.system[f.key];}
      for(const f of spec.fields??[]){const label=pair(text(`cf:${f.key}:ar`),text(`cf:${f.key}:en`));if(label)f.label=label;}
    });
    if(name==='access'){const target=state.form;return await commit(spec=>{
      if(target.figure){spec.system??={};spec.system[target.key]??={};if(values.visible_to?.length)spec.system[target.key].visible_to=values.visible_to;else delete spec.system[target.key].visible_to;if(!Object.keys(spec.system[target.key]).length)delete spec.system[target.key];return;}
      const f=spec.fields.find(x=>x.key===target.key);
      for(const list of ['visible_to','editable_by'])if(values[list]?.length)f[list]=values[list];else delete f[list];
    },`edit-access-${target.key}`);}
  }catch(error){showProblem(error);}
}
// لوحة المفاتيح: Esc يغلق الدرج، والأسهم تنقل بين التبويبات (الأيسر «التالي» في العربية)، وكل ما عداها أزرار ونماذج تُبلغ بـTab.
function onKey(ev){
  if(ev.key==='Escape'){ev.stopPropagation();closePageEditor();return;}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)||ev.target?.getAttribute?.('role')!=='tab')return;
  const tabs=[...host.querySelectorAll('[role="tab"]')],at=tabs.indexOf(ev.target),forward=(ev.key==='ArrowLeft')===(host.dir==='rtl');
  const to=ev.key==='Home'?0:ev.key==='End'?tabs.length-1:(at+(forward?1:-1)+tabs.length)%tabs.length;
  ev.preventDefault();tabs[to].click();
}
