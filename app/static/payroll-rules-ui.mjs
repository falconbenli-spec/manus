// شاشات قواعد اللائحة: الاستقالة بساعاتها (م34، م37)، والانتداب وبدله (م63–65)، وسياسات اللائحة التي يقبلها مدير الموارد البشرية.
// كل مبلغ هنا محسوب أو مقترح؛ المنصة لا تصرف ولا تحجز.
import { dual } from './dates.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const tile=(e,value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
// المبلغ في جملة: الرقم وحده معزول بأرقام جدولية (.ltr)، و«ريال» عربية خارجه فلا يقع عليها ما يقع على الأرقام. يُرجع ترميزًا جاهزًا.
const sar=minor=>minor===null||minor===undefined?'—':`<span class="ltr">${(Number(minor)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span> ريال`;
// المبلغ في البلاطة: ريالات كاملة بلا هللات حين لا هللات فيه، والعملة في تسمية البلاطة. رقم قصير يتسع لنصف عرض الجوال ولا ينكسر وسطه.
const riyals=minor=>{const n=Number(minor)/100;return n.toLocaleString('en-US',Number.isInteger(n)?{maximumFractionDigits:0}:{minimumFractionDigits:2,maximumFractionDigits:2});};
// التاريخ بصورتيه (ميلادي · هجري) كما يرسمه dual، داخل time بقيمته الآلية. والعدد في جملة بـdata-num.
const dualTime=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`:'';
const count=(e,n)=>`<span data-num>${e(n)}</span>`;
const yesNo=[{value:'no',label:'لا'},{value:'yes',label:'نعم'}];

const resignationLabels={withdraw_resignation:'سحب الاستقالة',accept_resignation:'قبول الاستقالة وتحديد آخر يوم',defer_resignation:'تأجيل القبول لمصلحة العمل',set_last_day:'تحديد آخر يوم عمل',open_offboarding:'فتح حزمة المغادرة'};
export const resignationsUI={
  title:'الاستقالة',
  description:'خطاب الاستقالة يروح مؤرخ لمدير الإدارة ونسخة للموارد البشرية، وإذا مرّت ثلاثين يوم بلا رد تُعد مقبولة (م34/1)، ويجوز تأجيلها لين ستين يوم لمصلحة العمل بسبب مكتوب (م34/2). ما تنقبل أثناء تحقيق أو إيقاف مفتوح (م37/5)، والقبول يفتح حزمة المغادرة.',
  load:api=>api('/resignations'),
  render(data,{e,button,ui}){
    // صف الاستقالة: الحالة بكلمتها في العنوان، ثم الخطاب بتواريخه، ثم الساعة والتأجيل والقبول والإيقاف كلٌّ في سطره.
    const resignationItem=r=>{
      const actions=r.actions.filter(a=>resignationLabels[a]);
      return `<li class="${r.status==='withdrawn'?'is-old':['accepted','deemed_accepted'].includes(r.status)?'is-ok':r.clock?.days_left<=5?'is-late':'is-due'}">
      <strong>${e(r.employee_name)} — ${e(r.status_name)}</strong>
      <span>خطاب مؤرخ ${dualTime(e,r.letter_date)} · انقدّم ${dualTime(e,r.submitted_on)} · إلى ${e(r.addressed_to_name??'مدير الإدارة')} ونسخة للموارد البشرية · آخر يوم مقترح ${dualTime(e,r.proposed_last_day)}</span>
      ${r.clock?`<small${r.clock.active?'':' class="subtle"'}>${e(r.clock.label)}${r.clock.active?` · حد التأجيل ${dualTime(e,r.clock.deferral_limit)}`:''}</small>`:''}
      ${r.deferred_until?`<small>مؤجلة لين ${dualTime(e,r.deferred_until)}${r.deferral_reason?`: ${e(r.deferral_reason)}`:''}</small>`:''}
      ${r.accepted_on?`<small>انقبلت ${dualTime(e,r.accepted_on)}${r.accepted_by_name?` بقرار ${e(r.accepted_by_name)}`:' حكمًا بمضي المدة (م34/1)'}${r.last_working_day?` · آخر يوم عمل ${dualTime(e,r.last_working_day)}${r.notice_waived?' مع الإعفاء من الإشعار':''}`:' · آخر يوم عمل ينتظر صاحب الصلاحية'}</small>`:''}
      ${r.hold?`<span class="vn-flag is-block">${e(r.hold_label||'موقوف قبولها حتى يُبتَّ في التحقيق (م37/5)')} — ${r.hold.items.length?e(r.hold.items.join('، ')):'إجراء نظامي مفتوح'}</span>${r.hold_owner?`<small class="subtle">${e(r.hold_owner)}</small>`:''}`:''}${r.hold_note?`<small class="subtle">${e(r.hold_note)}</small>`:''}
      ${r.offboarding_bundle_id?'<small class="subtle">انفتحت حزمة المغادرة.</small>':r.offboarding_note?`<small class="subtle">${e(r.offboarding_note)}</small>`:''}
      ${actions.length?`<div class="operation-actions">${actions.map(a=>button(a,r.id,resignationLabels[a])).join('')}</div>`:''}</li>`;};
    const open=data.resignations.filter(r=>['submitted','deferred'].includes(r.status));
    const accepted=data.resignations.filter(r=>['accepted','deemed_accepted'].includes(r.status)).length;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p class="subtle">${data.rule.active?`القاعدة سارية (${e(data.rule.articles.join('، '))}).`:'قاعدة الاستقالة مسودة ما قبلها مدير الموارد البشرية للحين، وساعة القبول الحكمي واقفة لين يقبلها.'}</p>
      <div class="operation-actions">${data.can_submit?button('submit_resignation','','تقديم استقالة'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,open.length,'مفتوحة',open.length?'is-due':'')}${tile(e,data.resignations.filter(r=>r.acceptance_held).length,'مسجَّلة وقبولها موقوف (م37/5)')}${tile(e,accepted,'مقبولة',accepted?'is-ok':'')}</div></section>
      ${data.resignations.length?`<section class="vn-group"><h2>الاستقالات ${count(e,data.resignations.length)}</h2><ul class="vn-list">${data.resignations.map(resignationItem).join('')}</ul></section>`
        :ui.empty('ما فيه استقالات مسجّلة',data.can_submit?'الخطاب يتقدّم من زر «تقديم استقالة»، ويوصل لمدير إدارتك ونسخة للموارد البشرية.':'الاستقالات تطلع هنا أول ما يقدّمها أصحابها.')}`;
  },
  form(action,id,data){
    if(action==='submit_resignation'){guard(data.can_submit);
      return {title:'خطاب استقالة',endpoint:'/resignations',idempotent:true,submit:'تقديم الاستقالة',
        fields:[field('letter_date','تاريخ الخطاب','date',{value:data.today}),field('proposed_last_day','آخر يوم عمل مقترح','date',{hint:'صاحب الصلاحية يحدد آخر يوم شاملًا فترة الإشعار، وله الإعفاء منها.'}),
          field('reason','السبب (اختياري)','textarea',{required:false,maxLength:1500})],
        toPayload:v=>({letter_date:v.letter_date,proposed_last_day:v.proposed_last_day,reason:v.reason||''})};}
    const r=data.resignations.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='defer_resignation')return {title:`تأجيل قبول استقالة ${r.employee_name}`,endpoint:`/resignations/${id}/defer_resignation`,
      fields:[field('deferred_until','التأجيل لين','date',{hint:`ما يتجاوز ${r.clock?.deferral_limit??''} (م34/2).`}),field('reason','سبب التأجيل المتعلق بمصلحة العمل','textarea')],toPayload:v=>({version:r.version,deferred_until:v.deferred_until,reason:v.reason})};
    if(action==='accept_resignation'||action==='set_last_day')return {title:`${resignationLabels[action]} — ${r.employee_name}`,endpoint:`/resignations/${id}/${action}`,
      fields:[field('last_working_day','آخر يوم عمل','date',{value:r.proposed_last_day}),field('notice_waived','الإعفاء من فترة الإشعار','select',{options:yesNo,value:'no'}),field('note','ملاحظة','textarea',{required:false})],
      toPayload:v=>({version:r.version,last_working_day:v.last_working_day,notice_waived:v.notice_waived==='yes',note:v.note||''})};
    if(action==='open_offboarding')return {title:`فتح حزمة المغادرة — ${r.employee_name}`,endpoint:`/resignations/${id}/open_offboarding`,fields:[],toPayload:()=>({version:r.version})};
    return {title:`سحب الاستقالة`,endpoint:`/resignations/${id}/withdraw_resignation`,fields:[field('note','ملاحظة','textarea',{required:false})],toPayload:v=>({version:r.version,note:v.note||''})};
  }
};

// record_attestation: إقرار المدير المباشر أو صاحب الصلاحية بأنه لا بديل في منطقة المهمة، يعرضه الخادم على القرار المقترح ويلزم قبل
// اعتماده حين تشترطه نسخة جدول البدل (secondment-benefits.mjs recordAttestation، POST /api/travel/:id/attestation). كان يُرسم زرًّا بلا اسم.
const travelLabels={approve_travel:'اعتماد القرار وحساب البدل',reject_travel:'رفض',cancel_travel:'سحب',request_extension:'طلب تمديد بعد بحث ما أنجز',submit_receipt:'إيصال تأشيرة أو رسوم',approve_extension:'اعتماد التمديد',reject_extension:'رفض التمديد',
  record_attestation:'إقرار عدم وجود بديل في منطقة المهمة'};
// أسماء ما ينقص القرار، والحالات القصيرة للتمديد ولحركة الراتب، بدل مفاتيحها الإنجليزية الخام.
const travelDetailNames={distance_km:'المسافة',road_type:'نوع الطريق',grade:'الدرجة',housing:'السكن',transport:'التنقل'};
const extensionStates={proposed:'ينتظر القرار',approved:'معتمد',rejected:'مرفوض'};
const adjustmentStates={proposed:'مقترحة',approved:'معتمدة',rejected:'مرفوضة'};
export const travelUI={
  title:'الانتداب',
  description:'قرار الانتداب فيه المهمة والمدة والتاريخين، والبدل اليومي حسب الدرجة داخل المملكة وبرّاها بعد عتبات المسافة — ينزل للربع مع السكن والنقل وللنص مع السكن بس. البدل يدخل حركة راتب، والتأشيرات والرسوم مطالبات مصروفات.',
  load:api=>api('/travel'),
  render(data,{e,button,ui}){
    // صف القرار. أفعال القرار وأفعال تمديده في منطقة أفعال واحدة، ولا يُرسم زر لا تعرف الشاشة اسمه ونموذجه.
    const travelItem=t=>{
      const actions=[...t.actions.filter(a=>travelLabels[a]).map(a=>button(a,t.id,travelLabels[a])),...t.extensions.flatMap(x=>x.actions.filter(a=>travelLabels[a]).map(a=>button(a,x.id,travelLabels[a])))];
      return `<li class="${t.status==='approved'?'is-ok':['rejected','cancelled'].includes(t.status)?'is-old':'is-due'}">
      <strong>${e(t.employee_name)} — ${e(t.destination)} (${t.scope==='abroad'?'خارج المملكة':'داخل المملكة'})</strong>
      <span>${e(t.status_name)} · ${dualTime(e,t.start_date)} <span aria-hidden="true">←</span><span class="sr-only">إلى</span> ${dualTime(e,t.end_date)} · ${count(e,t.days_total)} يوم${t.distance_km!==null?` · ${count(e,t.distance_km)} كم`:''}</span>
      <small>${e(t.task)}</small>
      ${t.basis?`<small>${t.basis.eligible?`البدل ${sar(t.allowance_minor)} = ${sar(t.daily_rate_minor)} × ${count(e,t.days)} يوم × <span class="ltr">${e(t.factor_bp/100)}%</span> — ${e(t.basis.reason)}`:`ما فيه بدل: ${e(t.basis.reason)}`}</small>`:''}
      ${t.missing_details.length&&t.status==='proposed'?`<small class="subtle">يكمّله صاحب الصلاحية عند القرار: ${e(t.missing_details.map(k=>travelDetailNames[k]??k).join('، '))}</small>`:''}
      ${t.adjustment?`<small class="subtle">حركة راتب ${e(adjustmentStates[t.adjustment.status]??t.adjustment.status)} لشهر <time datetime="${e(t.adjustment.month)}">${e(t.adjustment.month)}</time></small>`:''}
      ${t.extensions.length?`<ul class="vn-list">${t.extensions.map(x=>`<li><strong>تمديد ${count(e,x.days)} يوم</strong><span>${e(extensionStates[x.status]??x.status)}${x.allowance_minor?` · ${sar(x.allowance_minor)}`:''}</span></li>`).join('')}</ul>`:''}
      ${t.receipts.length?`<small>${count(e,t.receipts.length)} إيصال بمطالبات مصروفات</small>`:''}
      ${actions.length?`<div class="operation-actions">${actions.join('')}</div>`:''}</li>`;};
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.rule.active?'':'<div class="vn-alert is-due"><strong>جدول البدل مسودة ما قبلها مدير الموارد البشرية للحين</strong><p>ما يُعتمد قرار انتداب ولا ينحسب بدل قبل قبوله.</p></div>'}
      <div class="operation-actions">${button('propose_travel','','قرار انتداب جديد')}</div></section>
      ${data.decisions.length?`<section class="vn-group"><h2>قرارات الانتداب ${count(e,data.decisions.length)}</h2><ul class="vn-list">${data.decisions.map(travelItem).join('')}</ul></section>`
        :ui.empty('ما فيه قرارات انتداب للحين','القرار يقترحه الموظف لنفسه أو مديره المباشر من زر «قرار انتداب جديد».')}
      <section class="vn-block"><h2>البدل اليومي حسب الدرجة</h2>${ui.table({head:['الدرجة','داخل المملكة','خارج المملكة'],rows:data.grades.map(g=>`<tr><td>${e(g.name)}</td><td>${sar(g.domestic_minor)}</td><td>${sar(g.abroad_minor)}</td></tr>`)})}
      <p class="subtle">عتبات المسافة: ${count(e,data.rule.distance_km.paved)} كم مسفلت، ${count(e,data.rule.distance_km.unpaved)} غير مسفلت، ${count(e,data.rule.distance_km.rough)} وعر.</p></section>`;
  },
  form(action,id,data){
    const details=(t={})=>[field('grade','الدرجة في جدول البدل','select',{options:data.grades.map(x=>({value:x.key,label:x.name})),value:t.grade??'employee'}),
      field('distance_km','المسافة بالكيلومتر (داخل المملكة)','number',{required:false,min:0,value:t.distance_km??''}),
      field('road_type','نوع الطريق','select',{required:false,options:data.roads.map(x=>({value:x.key,label:x.name})),value:t.road_type??'paved'}),
      field('housing','السكن','select',{options:data.housing.map(x=>({value:x.key,label:x.name})),value:t.housing??'none'}),
      field('transport','التنقل','select',{options:data.transport.map(x=>({value:x.key,label:x.name})),value:t.transport??'none'})];
    const detailPayload=v=>({grade:v.grade,housing:v.housing,transport:v.transport,distance_km:v.distance_km===''?null:Number(v.distance_km),road_type:v.road_type||null});
    if(action==='propose_travel')return {title:'قرار انتداب',endpoint:'/travel',idempotent:true,
      fields:[field('user_id','الموظف المنتدب','select',{options:data.team.map(x=>({value:x.id,label:x.name})),value:data.user_id}),field('task','المهمة المطلوبة','textarea'),field('destination','مكان الانتداب'),
        field('scope','النطاق','select',{options:[{value:'domestic',label:'داخل المملكة'},{value:'abroad',label:'خارج المملكة'}]}),field('start_date','تاريخ البداية','date'),field('end_date','تاريخ النهاية','date'),...details()],
      toPayload:v=>({user_id:v.user_id,task:v.task,destination:v.destination,scope:v.scope,start_date:v.start_date,end_date:v.end_date,...detailPayload(v)})};
    const x=data.decisions.flatMap(t=>t.extensions).find(x=>x.id===id);
    if(['approve_extension','reject_extension'].includes(action)){guard(x&&x.actions.includes(action));
      return {title:travelLabels[action],endpoint:`/travel/extensions/${id}/${action}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>({note:v.note})};}
    const t=data.decisions.find(d=>d.id===id);guard(t&&t.actions.includes(action));
    if(action==='record_attestation')return {title:`${travelLabels[action]} — ${t.employee_name}`,endpoint:`/travel/${id}/attestation`,
      fields:[field('statement','إقرارك بأنه ما فيه في منطقة المهمة موظف يقدر يأدي المهمة','textarea',{hint:'الإقرار ينكتب مرة وحدة وما يتعدّل.'})],toPayload:v=>({statement:v.statement})};
    if(action==='approve_travel')return {title:`اعتماد انتداب ${t.employee_name}`,endpoint:`/travel/${id}/approve_travel`,fields:[...details(t),field('note','ملاحظة','textarea',{required:false})],toPayload:v=>({version:t.version,...detailPayload(v),note:v.note||''})};
    if(action==='request_extension')return {title:'طلب تمديد الانتداب',endpoint:`/travel/${id}/request_extension`,
      fields:[field('days','أيام التمديد','number',{min:1,max:t.extension_days_left,hint:`الباقي من حد التمديد: ${t.extension_days_left} يوم (م64/1).`}),field('progress_review','وش انجز ووش باقي، والتثبت من بذل الجهد','textarea')],
      toPayload:v=>({version:t.version,days:Number(v.days),progress_review:v.progress_review})};
    if(action==='submit_receipt')return {title:'إيصال تكلفة الانتداب',endpoint:`/travel/${id}/submit_receipt`,
      fields:[field('cost_kind','نوع التكلفة','select',{options:data.cost_kinds.map(k=>({value:k.key,label:k.name}))}),field('expense_date','تاريخ الإيصال','date'),field('amount','المبلغ'),field('receipt_reference','مرجع الإيصال الأصلي'),field('description','البيان','textarea')],
      toPayload:v=>({version:t.version,cost_kind:v.cost_kind,expense_date:v.expense_date,amount:v.amount,receipt_reference:v.receipt_reference,description:v.description})};
    return {title:travelLabels[action],endpoint:`/travel/${id}/${action}`,fields:[field('note','السبب','textarea',{required:action==='reject_travel'})],toPayload:v=>({version:t.version,note:v.note||''})};
  }
};

// ما يحسمه القابل بنفسه عند القبول، باسمه ومادته. يُقرأ في سطر القاعدة وفي نموذج القبول، فلا يظهر مفتاح إنجليزي ولا تسمية خاطئة.
const choiceNames={art36_reading:'قراءة م36/2',rounding:'قاعدة التقريب (م50/5)',unpaid_leave_mode:'حسم الإجازة بلا أجر (م91/3)',deferral_anchor:'موعد حد التأجيل (م34/2)',partial_month_basis:'مقسوم شهر الالتحاق والترك'};
export const payrollRulesUI={
  title:'قواعد اللائحة في الرواتب',
  description:'قيم اللائحة في الاستقالة والمخالصة وسقوف الاستقطاع والصرف والانتداب والتأمينات، وكل قيمة برقم مادتها. ما تسري إلا إذا قبلها مدير الموارد البشرية واختار اللي يلزم اختياره.',
  load:api=>api('/payroll-rules'),
  render(data,{e,button,ui}){
    const x=data.art36_example;
    // القاعدة: عنوانها، ثم مرجعها وحالتها (تُقرأ قبل النص الطويل)، ثم نصها، ثم ما يلزم اختياره، والقيم التقنية خلف تفصيل مسمّى فتبقى متاحة ولا تُقرأ نصًّا.
    const policyItem=p=>{
      const title=p.title.startsWith(p.kind_name)?p.title:`${p.kind_name}: ${p.title}`,keys=Object.keys(p.parameters??{}),actions=p.actions.filter(a=>a!=='prepare_rule');
      return `<li class="${p.status==='accepted'?'is-ok':p.status==='rejected'?'is-old':'is-due'}"><strong>${e(title)}${p.seeded?' — مسودة من نص اللائحة':''}</strong>
      <small>${e(p.articles.join('، '))} · ${p.status==='accepted'?`مقبولة وسارية من ${dualTime(e,p.effective_from)}`:p.status==='draft'?'مسودة ما سرت للحين':'مرفوضة'}</small>
      <span>${e(p.body)}</span>
      <small class="subtle">المصدر: ${e(p.source)}</small>
      ${p.pending_choices.length?`<span class="vn-flag is-due">يلزمك تختار عند القبول: ${e(p.pending_choices.map(k=>choiceNames[k]??k).join('، '))}</span>`:''}
      ${keys.length?`<details><summary>القيم التقنية (${count(e,keys.length)})</summary><code class="ltr" dir="ltr">${e(JSON.stringify(p.parameters,null,1))}</code></details>`:''}
      ${actions.length?`<div class="operation-actions">${actions.map(a=>button(a,p.id,a==='accept_rule'?'قبول واختيار':'رفض')).join('')}</div>`:''}</li>`;};
    // ما ينتظر قرار مدير الموارد البشرية أولًا، ثم السارية، ثم المرفوضة.
    const groups=[['مسودات تنتظر القبول',p=>p.status==='draft'],['القواعد السارية',p=>p.status==='accepted'],['مرفوضة',p=>!['draft','accepted'].includes(p.status)]]
      .map(([name,pick])=>[name,data.policies.filter(pick)]).filter(([,list])=>list.length)
      .map(([name,list])=>`<section class="vn-group"><h2>${name} ${count(e,list.length)}</h2><ul class="vn-list">${list.map(policyItem).join('')}</ul></section>`).join('');
    // تنبيه م36/2 يطلب انتباهًا ما دامت القراءة لم تُختر في قاعدة مخالصة سارية.
    const chosen=data.active?.settlement?.parameters?.art36_reading;
    const example=`${x.service_years} سنوات على أجر ${riyals(x.wage_minor)}`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="vn-alert${chosen?'':' is-due'}"><strong>تنبيه م36/2</strong><p>${e(x.note)}</p></div>
      <div class="vn-tiles">${tile(e,riyals(x.literal_minor),`بالريال: القراءة الحرفية — ${example}`)}${tile(e,riyals(x.labor_law_minor),`بالريال: قراءة نظام العمل — ${example}`)}</div></section>
      ${groups||ui.empty('ما فيه قواعد للحين','قواعد اللائحة تطلع هنا أول ما تنزرع مسوداتها.')}`;
  },
  form(action,id,data){
    const p=data.policies.find(x=>x.id===id);guard(p&&p.actions.includes(action));
    if(action==='reject_rule')return {title:`رفض — ${p.title}`,endpoint:`/payroll-rules/${id}/reject`,fields:[field('note','سبب الرفض','textarea')],toPayload:v=>({note:v.note})};
    const choices=Object.entries(p.choices);
    return {title:`قبول — ${p.title}`,endpoint:`/payroll-rules/${id}/accept`,
      fields:[...choices.map(([key,list])=>field('choice_'+key,choiceNames[key]??key,'select',{options:list,value:p.parameters[key]??list[0].value})),
        field('effective_from','تاريخ السريان','date',{value:data.today}),field('note','إقرارك بمطابقة القيم مع اللائحة الموقعة','textarea')],
      toPayload:v=>({effective_from:v.effective_from,note:v.note,choices:Object.fromEntries(choices.map(([key])=>[key,v['choice_'+key]]))})};
  }
};
