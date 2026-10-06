// خطابات الموظفين: معالج طلب الخطاب (النوع، الجهة، اللغة، تفصيل الراتب، الغرض، التسليم، ثم المعاينة)، والإصدار، وشاشة القوالب.
// القالب يعتمده صاحب الإجراء، والمنصة تملأ عناصره من سجلاتها. الراتب يُحسب يوم الإصدار ولا يُحفظ في الطلب.
// رابط المعالج: #letters/new?type=salary — يفتح الطلب بالنوع مختارًا (lettersUI.route).
import { dual } from './dates.mjs';
import { countNoun } from './arabic-count.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const labels={prepare_letter:'إعداد الخطاب',reject_letter:'رفض الطلب',cancel_request:'سحب طلبي',issue_letter:'إصدار واعتماد',cancel_letter:'إلغاء الخطاب الصادر',record_handover:'تسجيل تسليم النسخ المطبوعة',request_again:'إعادة الطلب'};
const templateLabels={draft_template:'كتابة القالب',edit_template:'تعديل المسودة',adopt_starter:'تبني النص المبدئي',approve_template:'اعتماد القالب',retire_letter_type:'إيقاف النوع',activate_letter_type:'تفعيل النوع'};
const state=r=>r.status==='issued'?(r.letter?.cancelled?'is-old':'is-ok'):['rejected','cancelled'].includes(r.status)?'is-old':r.sla?.late?'is-late':r.status==='prepared'?'is-due':'';
const LANG_NAMES={ar:'العربية',en:'الإنجليزية',both:'العربية والإنجليزية'};
const COPIES=['نسخة واحدة','نسختان','نسخ','نسخة'];
// الطلب المعاين ينتظر التأكيد هنا حتى يضغط الموظف «تقديم الطلب»، فلا يُرسل ما لم يره.
let pending=null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// التاريخ بنصه كما كان يُعرض (dual، أو اليوم وحده حيث كان اليوم وحده) وقيمته الآلية في datetime؛ والعدد بأرقام مجدولة.
const when=(e,iso,show=dual)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(show(iso))}</time>`:'';
const isoDay=value=>String(value).slice(0,10);
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const counted=(e,n,forms)=>e(countNoun(n,forms)).replace(/^-?\d[\d,.]*/,m=>num(e,m));

// نص الخطاب بلغته. القالب يفصل جزأيه بسطر الفاصل (LANGUAGE_BREAK في app/letters.mjs) فيُقسم عنده بالضبط. والخطاب الصادر
// بالعربية والإنجليزية يصل جزأين بينهما سطر فارغ بلا فاصل، فتُعرف لغة كل فقرة من أول حرف قوي فيها (قاعدة dir="auto" نفسها).
// الجزء الإنجليزي يحمل lang="en" dir="ltr"، والعنصر النائب {{…}} معزول الاتجاه في الجزأين.
const LANGUAGE_BREAK='---- English ----';
const latinFirst=text=>/^[^A-Za-z\u0600-\u06FF]*[A-Za-z]/.test(text);
function letterParts(body,language){
  const text=String(body??''),lines=text.split('\n'),at=lines.findIndex(l=>l.trim()===LANGUAGE_BREAK);
  if(at>=0)return [{lang:'ar',text:lines.slice(0,at).join('\n').trim()},{lang:'en',text:lines.slice(at+1).join('\n').trim()}].filter(p=>p.text);
  if(language==='en')return [{lang:'en',text}];
  if(language!=='both')return [{lang:language==='ar'||!latinFirst(text)?'ar':'en',text}];
  const parts=[];
  for(const paragraph of text.split(/\n{2,}/)){
    const lang=latinFirst(paragraph)?'en':'ar',last=parts[parts.length-1];
    if(last?.lang===lang)last.text+=`\n\n${paragraph}`;else parts.push({lang,text:paragraph});
  }
  return parts;
}
const letterText=(e,body,language,tag='small',cls='')=>letterParts(body,language).map(part=>
  `<${tag}${cls?` class="${cls}"`:''}${part.lang==='en'?' lang="en" dir="ltr"':''}>${e(part.text).replace(/\{\{\s*[a-z_]{2,40}\s*\}\}/g,m=>`<bdi dir="ltr">${m}</bdi>`).replace(/\n/g,'<br>')}</${tag}>`).join('');

// حقول المعالج بحسب قاعدة النوع؛ values تملأ الحقول عند «إعادة الطلب».
function wizardFields(data,type,values={}){
  const rule=type.rule,a=data.addressees,fields=[];
  const options=[];
  if(rule.addressees.includes('to_whom'))options.push({value:'to_whom',label:'لمن يهمه الأمر'});
  for(const kind of ['bank','embassy','government'])if(rule.addressees.includes(kind))for(const x of a[kind])options.push({value:`${kind}:${x.code}`,label:`${kind==='bank'?'بنك':kind==='embassy'?'سفارة':'جهة حكومية'}: ${x.name_ar}`});
  if(rule.addressees.includes('other'))options.push({value:'other',label:'جهة أخرى — اكتب اسمها تحت'});
  const chosen=values.addressee_kind&&values.addressee_kind!=='other'&&values.addressee_kind!=='to_whom'?`${values.addressee_kind}:${values.addressee_code}`:values.addressee_kind??options[0]?.value;
  if(options.length>1||options[0]?.value!=='to_whom')fields.push(field('addressee_choice','الجهة الموجه إليها','select',{options,value:chosen,hint:a.note}));
  if(rule.addressees.includes('other'))fields.push(field('addressee','اسم الجهة (إن اخترت «جهة أخرى»)','text',{required:false,value:values.addressee_kind==='other'?values.addressee??'':'',maxLength:200}));
  fields.push(field('language','لغة الخطاب','select',{options:data.languages.map(l=>({value:l.key,label:l.name})),value:values.language??'ar',hint:type.bilingual?'القالب المعتمد بالعربي والإنجليزي.':'القالب المعتمد بلغة وحدة، ويصدر بلغته.'}));
  if(type.shows_salary){
    fields.push(field('salary_detail','تفصيل الراتب','select',{options:[{value:'total',label:'الإجمالي فقط'},{value:'breakdown',label:'الإجمالي مع التفصيل (الأساسي، السكن، النقل، أخرى)'}],value:values.salary_detail??'total',hint:'اختر أقل تفصيل تقبله الجهة. المبلغ ينحسب من عقدك الساري يوم الإصدار، وما ينحفظ في الطلب.'}));
    fields.push(field('salary_period','الفترة','select',{options:[{value:'monthly',label:'شهري'},{value:'annual',label:'سنوي'}],value:values.salary_period??'monthly'}));
  }
  if(rule.travel){
    fields.push(field('travel_from','بداية السفر','date',{value:values.travel_from??''}),field('travel_to','نهاية السفر','date',{value:values.travel_to??''}));
    fields.push(field('destination','بلد الوجهة','text',{required:false,value:values.destination??'',hint:'إذا خليته فاضي ينعبّى من السفارة اللي اخترتها.'}));
  }
  fields.push(field('purpose',rule.purpose==='required'?'الغرض':'الغرض (اختياري)','textarea',{required:rule.purpose==='required',value:values.purpose??'',hint:rule.travel?'مثل: زيارة سياحية، اجتماع عمل.':type.code==='bank'?'مثل: فتح حساب، تمويل شخصي.':'ينحفظ للسجل، وما يطلع في نص الخطاب.'}));
  fields.push(field('delivery','التسليم','select',{options:data.delivery.map(d=>({value:d.key,label:d.name})),value:values.delivery??'digital'}));
  fields.push(field('copies','عدد النسخ المطبوعة','number',{required:false,min:1,max:5,value:values.copies??1,hint:'للنسخة المطبوعة بس. الرقمية نسخة وحدة تحفظها PDF من المتصفح.'}));
  fields.push(field('urgent','مستعجل','checkbox',{required:false,value:!!values.urgent,hint:`المستهدف: ${countNoun(data.sla_days.urgent,'working_day')} للمستعجل، و${countNoun(data.sla_days.normal,'working_day')} للعادي.`}));
  fields.push(field('urgent_reason','سبب الاستعجال','text',{required:false,value:values.urgent_reason??'',maxLength:500}));
  return fields;
}
function wizardPayload(type,v,reusedFrom){
  const [kind,code]=String(v.addressee_choice??'to_whom').split(':');
  return {type_code:type.code,addressee_kind:kind,addressee_code:code??null,addressee:kind==='other'?String(v.addressee??''):'',language:v.language,
    ...(type.shows_salary?{salary_detail:v.salary_detail,salary_period:v.salary_period}:{}),
    ...(type.rule.travel?{travel_from:v.travel_from,travel_to:v.travel_to,destination:v.destination||null}:{}),
    purpose:v.purpose||'',delivery:v.delivery,copies:v.delivery==='printed'?Number(v.copies||1):1,urgent:v.urgent==='on',urgent_reason:v.urgent==='on'?String(v.urgent_reason??''):'',
    ...(reusedFrom?{reused_from:reusedFrom}:{})};
}
// تحذيرات المعاينة تنبيه يحتاج انتباهًا لا خطأ: «بيانات ناقصة» و«قالب بلغة واحدة» لا يوقفان التقديم.
function previewHtml(p,e){
  return `<div class="letter-preview"><p class="subtle">${e(p.note)}</p>
    <dl class="vn-list"><div><dt>النوع</dt><dd>${e(p.type_name)}</dd></div><div><dt>الجهة</dt><dd>${e(p.addressee||'—')}</dd></div><div><dt>اللغة</dt><dd>${e(LANG_NAMES[p.language])}</dd></div>
    <div><dt>التسليم</dt><dd>${p.delivery==='printed'?`مطبوع مختوم — ${counted(e,p.copies,COPIES)}`:'رقمي برمز تحقق <bdi>QR</bdi>'}</dd></div><div><dt>المستهدف</dt><dd>${p.urgent?'مستعجل — ':''}قبل ${when(e,p.due_on)}</dd></div></dl>
    ${p.warnings.map(w=>`<p class="vn-alert is-due">${e(w)}</p>`).join('')}
    <blockquote class="letter-body">${letterText(e,p.body,p.language,'p')}</blockquote>
    <div class="operation-actions"><button type="button" class="btn dark" data-action="operation" data-module="letters" data-operation="confirm_letter" data-id="pending">تأكيد وتقديم الطلب</button></div></div>`;
}

export const lettersUI={
  title:'خطابات الموظفين',
  description:'اطلب خطاب تعريف بالراتب أو بدونه، أو شهادة خبرة، أو خطاب لسفارة أو بنك، وشوف المعاينة قبل ما تقدّم. تعدّه الموارد البشرية ويصدره مالك الإجراء برمز تحقق.',
  load:api=>api('/letters'),
  // عقد الرابط العميق لمن يبني التوجيه: #letters/new?type=<code> ← form('request_letter','type:<code>').
  route(params){const type=params?.get?.('type')??params?.type;return type?{action:'request_letter',id:`type:${type}`}:null;},
  render(data,{e,button,ui}){
    // م0 «السور»: tile وempty من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية.
    const {tile,empty}=ui;
    const count=status=>data.requests.filter(r=>r.status===status).length;
    const ready=data.types.filter(t=>t.template_ready),blocked=data.types.filter(t=>!t.template_ready);
    const late=data.requests.filter(r=>r.sla?.late).length;
    // خيارات الطلب سطرٌ واحد: التواريخ في <time>، والسهم بين تاريخي السفر يُقرأ «إلى».
    const options=r=>{
      const o=r.options;if(!o)return '';
      return [e(LANG_NAMES[o.language]??''),o.delivery==='printed'?`مطبوع: ${counted(e,o.copies,COPIES)}`:'رقمي',o.urgent?'مستعجل':'',o.salary_detail==='breakdown'?'بتفصيل الراتب':'',o.salary_period==='annual'?'سنوي':'',
        o.travel_from?`سفر ${when(e,o.travel_from,isoDay)} <span aria-hidden="true">←</span><span class="sr-only">إلى</span> ${when(e,o.travel_to,isoDay)}`:'',
        o.handed_over_at?`انسلّم ${when(e,o.handed_over_at,isoDay)}`:''].filter(Boolean).join(' · ');
    };
    // صف الطلب. «أعدّه» و«أصدره» فصلُ مهام (من يعدّ لا يصدر) فيبقيان؛ والتأخر كلمة ولون معًا.
    const requestItem=r=>{
      const opts=options(r),open=['requested','prepared'].includes(r.status);
      return `<li class="${state(r)}"><strong>${e(r.type_name)}${r.own?'':` — ${e(r.employee_name)}`}</strong>
      <span>${e(r.status_name)}${r.addressee?` · الجهة: ${e(r.addressee)}`:''}${r.letter?` · المرجع <bdi dir="ltr">${e(r.letter.reference)}</bdi> · صدر ${when(e,r.letter.issued_on)}`:''}${r.prepared_by_name?` · أعدّه ${e(r.prepared_by_name)}`:''}${r.issued_by_name?` · أصدره ${e(r.issued_by_name)}`:''}</span>
      ${opts?`<small class="subtle">${opts}</small>`:''}
      ${r.sla&&open?`<small class="${r.sla.late?'is-late-text':'subtle'}">${r.sla.late?'متأخر — كان المستهدف':'المستهدف'} ${when(e,r.sla.due_on)}</small>`:''}
      ${r.purpose?`<small>${e(r.purpose)}${r.decision_note?` — ${e(r.decision_note)}`:''}</small>`:r.decision_note?`<small>${e(r.decision_note)}</small>`:''}
      ${r.letter?.cancelled?`<small>ألغاه ${e(r.letter.cancelled.cancelled_by_name)}: ${e(r.letter.cancelled.reason)}</small>`:''}
      ${r.shows_salary?'<small class="subtle">فيه الراتب: نصّه يشوفه صاحبه ومن يملك الإصدار بس.</small>':''}
      ${r.missing_values.length&&open?`<small class="is-warn-text">بيانات ناقصة توقف الإصدار: ${r.missing_values.map(e).join('، ')} — تنكمل في السجل الوظيفي أو العقد.</small>`:''}
      ${r.letter?.body?letterText(e,r.letter.body,r.options?.language??'ar'):r.letter?.body_hidden?'<small class="subtle">نص الخطاب ما يطلع لك — يشوفه صاحبه ومن يملك الإصدار.</small>':''}
      <div class="operation-actions">${r.actions.map(a=>button(a,r.id,labels[a])).join('')}${r.letter&&!r.letter.body_hidden?`<a class="btn outline small" href="/api/letters/${e(r.letter.id)}/print" target="_blank" rel="noopener">عرض الخطاب برمز التحقق<span class="sr-only"> (تنفتح في تبويب جديد)</span></a>`:''}</div></li>`;
    };
    const none=empty('ما فيه طلبات خطابات للحين',ready.length?'اختر نوع الخطاب من الأزرار فوق، وشوف المعاينة قبل ما تقدّم.':'الطلب ينفتح أول ما يعتمد مالك الإجراء قالب لنوع من الأنواع.');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${ready.length?`<div class="operation-actions">${ready.map(t=>button('request_letter',`type:${t.code}`,t.name)).join('')}</div>`:''}
      ${blocked.length?`<p class="subtle">هذي الأنواع ما لها قالب معتمد للحين، فما تنطلب: ${blocked.map(t=>e(t.name)).join('، ')}.</p>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(count('requested'),'مطلوب',count('requested')?'is-due':'')}${tile(count('prepared'),'مُعدّ بانتظار الإصدار',count('prepared')?'is-due':'')}${tile(count('issued'),'صادر',count('issued')?'is-ok':'')}${tile(late,'متجاوز للمستهدف',late?'is-late':'')}</div>
      <section class="vn-block"><div class="panel-head"><h2>طلبات الخطابات</h2></div>${data.requests.length?`<ul class="vn-list">${data.requests.map(requestItem).join('')}</ul>`:none}</section></section>`;
  },
  form(action,id,data){
    if(action==='request_letter'||action==='request_again'){
      const previous=action==='request_again'?data.requests.find(x=>x.id===id&&x.actions.includes('request_again')):null;
      if(action==='request_again')guard(previous);
      const code=previous?previous.type_code:String(id||'').startsWith('type:')?String(id).slice(5):null;
      const ready=data.types.filter(t=>t.template_ready),type=code?ready.find(t=>t.code===code):null;
      guard(type);
      const values=previous?{...previous.options,addressee:previous.addressee,purpose:previous.purpose}:{};
      return {title:`${previous?'طلب مجدد':'طلب'} — ${type.name}`,submit:'معاينة الخطاب',endpoint:'/letters/preview',fields:wizardFields(data,type,values),
        toPayload:v=>{const payload=wizardPayload(type,v,previous?.id);pending={payload};return payload;},
        after:(saved,e)=>{pending={...pending,preview:saved};return {title:`معاينة — ${saved.type_name}`,html:previewHtml(saved,e)};}};
    }
    if(action==='confirm_letter'){
      guard(pending?.payload&&pending.preview);
      const payload=pending.payload;
      return {title:`تقديم طلب — ${pending.preview.type_name}`,submit:'تقديم الطلب',endpoint:'/letters',idempotent:true,
        fields:[field('confirm','راجعت المعاينة وأطلب إصدار الخطاب بهذي الخيارات','checkbox')],toPayload:()=>{pending=null;return payload;}};
    }
    const r=data.requests.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='prepare_letter')return {title:`إعداد خطاب — ${r.type_name}`,endpoint:`/letters/${id}/prepare_letter`,
      fields:[field('note','ملاحظة الإعداد','textarea',{required:false,hint:'تنحفظ للسجل. الإعداد ما يصدر الخطاب — يصدره شخص ثاني عنده تصريح الإصدار.'})],toPayload:v=>({version:r.version,note:v.note||''})};
    if(action==='issue_letter')return {title:`إصدار — ${r.type_name} · ${r.employee_name}`,endpoint:`/letters/${id}/issue_letter`,
      fields:[field('note','ملاحظة الإصدار','textarea',{required:false,hint:'بالإصدار ياخذ الخطاب رقم مرجعي ورمز تحقق، وتتعبّى بياناته من العقد الساري وقت الإصدار وتثبت. الخطاب الصادر ما يتعدّل؛ تصحيحه إلغاء وطلب جديد.'})],
      toPayload:v=>({version:r.version,note:v.note||''})};
    if(action==='cancel_letter')return {title:`إلغاء خطاب صادر — ${r.letter?.reference??''}`,endpoint:`/letters/${id}/cancel_letter`,
      fields:[field('reason','سبب الإلغاء','textarea',{hint:'الإلغاء سجل جديد يبطّل رمز التحقق، ونسخة الخطاب تبقى محفوظة مثل ما صدرت.'})],toPayload:v=>({version:r.version,reason:v.reason})};
    if(action==='record_handover')return {title:`تسليم النسخ المطبوعة — ${r.letter?.reference??''}`,endpoint:`/letters/${id}/record_handover`,
      fields:[field('note','من استلم النسخ ومتى','text')],toPayload:v=>({version:r.version,note:v.note})};
    return {title:`${labels[action]} — ${r.type_name}`,endpoint:`/letters/${id}/${action}`,fields:[field('note','السبب','textarea')],toPayload:v=>({version:r.version,note:v.note})};
  }
};
export const previewLetterHtml=(preview,e=escape)=>previewHtml(preview,e);

export const letterTemplatesUI={
  title:'قوالب الخطابات',
  description:'لكل نوع خطاب قالب بنسخ مؤرخة يعتمدها مالك الإجراء. النص يكتبه صاحب الإجراء، والعناصر النائبة تتعبّى من سجلات المنصة.',
  load:api=>api('/letters/templates'),
  render(data,{e,button,ui}){
    // م0 «السور»: tile وempty من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية.
    const {tile,empty}=ui;
    const published=data.types.filter(t=>t.published).length,unpublished=data.types.length-published;
    // نص الخطاب الطويل خلف عنوان يسمّيه: الصف يُقرأ بنوعه وحالته وأفعاله، والنص بنقرة.
    const text=(summary,body)=>`<details><summary>${summary}</summary>${letterText(e,body,undefined,'p','measure')}</details>`;
    // «اعتمده …» على قالب معتمد سلسلة حيازة مكانها سجل التدقيق؛ ومُعدّ المسودة يبقى لأنه من تُراجَع معه.
    const templateItem=t=>`<li class="${t.published?'is-ok':t.draft?'is-due':''}${t.active?'':' is-old'}"><strong>${e(t.name)} · <bdi dir="ltr">${e(t.code)}</bdi>${t.own?'':' — نوع أساسي'}</strong>
      <span>${t.published?`قالب معتمد (نسخة ${num(e,t.published.revision)}) ساري من ${when(e,t.published.effective_from)}`:'ما له قالب معتمد، فما ينطلب'}${t.active?'':' · النوع موقوف'}</span>
      ${t.published?`${t.published.shows_salary?'<small class="subtle">القالب فيه الراتب: الخطاب اللي يصدر منه يشوفه صاحبه ومن يملك الإصدار بس.</small>':''}${text('نص القالب المعتمد',t.published.body)}`:''}
      ${t.starter&&t.actions.includes('adopt_starter')?`<small class="subtle">فيه نص مبدئي بالعربي والإنجليزي جاهز تتبناه، ويصير مسودة تنتظر اعتماد الموارد البشرية.</small>${text('النص المبدئي',t.starter.body)}`:''}
      ${t.draft?`<small class="subtle">مسودة (نسخة ${num(e,t.draft.revision)}) كتبها ${e(t.draft.prepared_by_name)}${t.draft.body.trim()?'':' — فاضية للحين'}، وتنتظر اعتماد مالك الإجراء.</small>${t.draft.body.trim()?text('نص المسودة',t.draft.body):''}`:''}
      ${t.actions.length?`<div class="operation-actions">${t.actions.map(a=>button(a,t.code,templateLabels[a])).join('')}</div>`:''}</li>`;
    // الأنواع وحال قوالبها أولًا لأنها الشغل؛ وقائمة العناصر النائبة مرجعٌ تحتها.
    const types=data.types.length?`<ul class="vn-list">${data.types.map(templateItem).join('')}</ul>`:empty('ما فيه أنواع خطابات','يضيف مالك الإجراء النوع من «نوع خطاب جديد».');
    const keys=`<ul class="vn-list">${data.placeholders.map(p=>`<li><strong><bdi dir="ltr">{{${e(p.key)}}}</bdi> — ${e(p.name)}</strong><span>المصدر: ${e(p.source)}</span></li>`).join('')}</ul>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_approve?`<div class="operation-actions">${button('add_letter_type','','نوع خطاب جديد')}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.types.length,'نوع خطاب')}${tile(published,'بقالب معتمد',published?'is-ok':'')}${tile(unpublished,'بلا قالب معتمد',unpublished?'is-due':'')}</div>
      <section class="vn-block"><div class="panel-head"><h2>أنواع الخطابات وقوالبها</h2></div>${types}</section>
      <section class="vn-block"><div class="panel-head"><h2>العناصر النائبة المسموحة</h2></div>${keys}<p class="subtle">نص القالب ما يقبل عنصر برّا هالقائمة.</p></section></section>`;
  },
  form(action,id,data){
    if(action==='add_letter_type'){guard(data.can_approve);
      return {title:'نوع خطاب جديد',endpoint:'/letters/types',idempotent:true,
        fields:[field('code','رمز النوع','text',{hint:'حروف إنجليزية صغيرة وأرقام وشرطات، مثل clearance.'}),field('name','اسم النوع بالعربي')],
        toPayload:v=>({code:v.code,name:v.name})};}
    const t=data.types.find(x=>x.code===id);guard(t&&t.actions.includes(action));
    if(action==='adopt_starter')return {title:`تبني النص المبدئي — ${t.name}`,submit:'تبني النص مسودةً باسمي',endpoint:`/letters/templates/${id}/adopt_starter`,
      fields:[field('confirm',`قريت النص المبدئي وأتبناه مسودة، ويعتمدها شخص ثاني عنده تصريح الإصدار. ${t.starter?.status_note??''}`,'checkbox')],toPayload:()=>({...(t.draft?{version:t.draft.version}:{})})};
    if(action==='approve_template')return {title:`اعتماد قالب — ${t.name}`,endpoint:`/letters/templates/${id}/approve`,
      fields:[field('effective_from','تاريخ السريان','date'),field('note','إقرارك باعتماد نص القالب','textarea',{hint:'باعتمادك تصير صيغة الخطاب على مسؤوليتك. النسخة المعتمدة ما تتعدّل؛ أي تعديل نسخة جديدة تحل محلها إذا انعتمدت.'})],
      toPayload:v=>({effective_from:v.effective_from,note:v.note,version:t.draft.version})};
    if(['retire_letter_type','activate_letter_type'].includes(action))return {title:`${templateLabels[action]} — ${t.name}`,endpoint:`/letters/types/${id}/${action}`,
      fields:[field('note','السبب','textarea')],toPayload:v=>({version:t.version,note:v.note})};
    return {title:`${t.draft?'تعديل مسودة قالب':'كتابة قالب'} — ${t.name}`,endpoint:`/letters/templates/${id}`,
      fields:[field('body','نص القالب','textarea',{required:false,maxLength:8000,value:t.draft?.body??'',
        hint:`اكتب نص الخطاب مثل ما تبيه يطلع، وحط مكان البيانات عنصر نائب: ${data.placeholders.map(p=>`{{${p.key}}}`).join(' · ')}. وللخطاب بلغتين: العربي، ثم سطر «\u2066${LANGUAGE_BREAK}\u2069» لحاله، ثم الإنجليزي.`})],
      toPayload:v=>({body:v.body||'',version:t.draft?.version})};
  }
};
