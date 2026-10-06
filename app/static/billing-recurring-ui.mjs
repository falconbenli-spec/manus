// الفوترة الدورية والدفعات المقدمة والإيراد المؤجل.
// صدق الشاشة: الجدولة تجهّز مسودة ولا تصدر، والدفعة المقدمة التزام لا إيراد، والإيراد المؤجل ورقة عمل لا قيود.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const optional={required:false};
const yesNo=[{value:'yes',label:'نعم'},{value:'no',label:'لا'}];
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
const percent=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(0)}%`;
const advanceActionNames={confirm_advance:'تأكيد القبض',plan_draw:'تخطيط سحب',reverse_advance:'تسجيل ارتداد'};

export const billingSchedulesUI={
  title:'الفوترة الدورية والدفعات المقدمة',
  description:'جداول الفوترة الشهرية والربعية تجهّز مسودة فاتورة لكل فترة مستحقة، ولا تصدر أي فاتورة: المراجعة والإصدار بيد شخص في شاشة الفواتير الضريبية. وفيها سجل الدفعات المقدمة بوصفها التزامًا على الوكالة (إيراد مؤجل) والسحب منها، وورقة عمل الإيراد المؤجل.',
  load:api=>api('/billing-schedules'),
  render(data,{e,button,money,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في التسمية ورأس العمود، وبعد أول مبلغ في السطر.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
    const pending=data.drafts.filter(d=>d.status==='pending_review');
    const active=data.schedules.filter(s=>s.status==='active');
    const liability=data.advances.reduce((sum,a)=>sum+a.balance_minor,0);
    // الزرّ يُرسم حين يقبله النموذج: لمن يدير الفوترة، وفي الكيان عميل يُفوتر.
    const start=data.can_manage&&data.clients.length?`<div class="operation-actions">${button('create_schedule','','جدولة فوترة جديدة')}${button('record_advance','','تسجيل دفعة مقدمة')}</div>`:'';
    const head=`<section class="panel panel-body vn-head">${start}<p>${e(data.note)}</p>
      <div class="vn-alert is-due"><strong>تنبيه ضريبي</strong><p class="measure">${e(data.zatca_advance_warning)}</p></div></section>`;
    const tiles=`<section class="vn-board"><div class="vn-tiles">
      ${ui.tile(pending.length,'مسودة تنتظر المراجعة والإصدار',pending.length?'is-decision':'')}
      ${ui.tile(active.length,'جدولة نشطة')}
      ${ui.tile(num(liability),'رصيد الدفعات المقدمة ما انسحب بالريال')}
      ${ui.tile(num(data.deferred.total_minor),'الإيراد المؤجل اليوم بالريال')}
    </div></section>`;
    // المسودة: عنوانها ومبلغها، ثم فترتها وحالها، ثم بنودها. التي تنتظر الإصدار هي الخطوة الجاية لمن يدير الفوترة.
    const draftRow=d=>{const waits=d.actions.length>0;
      return `<li class="${waits?'is-decision':d.status==='dismissed'?'is-old':''}"><strong>${e(d.title)} · ${e(d.client_name)} — ${fig(d.total_minor)} ريال</strong><span class="badge ${waits?'is-decision':d.status==='issued'?'issued':'cancelled'}">${e(waits?'تنتظر إصدار فاتورتها':d.status_name)}</span>
      <span>الفترة من ${day(d.period_start)} لين ${day(d.period_end)}</span>
      <small>${d.lines.map(line=>`${e(line.description)}: ${fig(line.amount_minor)}`).join(' · ')}</small>
      ${waits?`<div class="operation-actions">${d.actions.map(action=>button(action,d.id,action==='mark_issued'?'ربطها بفاتورة صادرة':'إلغاء المسودة')).join('')}</div>`:''}</li>`;};
    const scheduleRow=s=>`<li class="${s.status==='paused'?'is-pending':s.status==='ended'?'is-old':''}"><strong>${e(s.title)} · ${e(s.client_name)} — ${fig(s.total_minor)} ريال</strong><span class="badge ${s.status==='active'?'active':s.status==='paused'?'pending':'ended'}">${e(s.status_name)}</span>
      <span>${e(s.cadence_name)} · يوم الإصدار <span data-num>${e(s.issue_day)}</span> · من ${day(s.start_date)}${s.end_date?` لين ${day(s.end_date)}`:' بدون نهاية محددة'}</span>
      ${s.contract_number?`<small>على العقد <bdi>${e(s.contract_number)}</bdi> — تنتهي الجدولة عند نهايته أو قبلها</small>`:''}
      <small>المالك ${e(s.owner_name||'—')} · ولّدت <span data-num>${e(s.generated)}</span> فترة${s.next_issue?` · الفترة الجاية ${day(s.next_issue)}`:''}</small>
      ${s.stopped_reason?`<small class="measure">${e(s.stopped_reason)}</small>`:''}
      ${s.actions.length?`<div class="operation-actions">${s.actions.map(action=>button(action,s.id,{pause_schedule:'إيقاف مؤقت',resume_schedule:'استئناف',end_schedule:'إنهاء'}[action])).join('')}</div>`:''}</li>`;
    const drawRow=(a,d)=>`<li class="${d.actions.length?'is-decision':''}"><strong>سحب على <bdi>${e(d.target_reference)}</bdi> — ${fig(d.amount_minor)} ريال</strong><span class="badge ${d.status==='drawn'?'completed':d.status==='awaiting_payment'?'pending':'in_progress'}">${e(d.status_name)}</span>
      <span>المسحوب منه ${fig(d.applied_minor)}</span>
      <small class="measure">${d.claim_id?`يسدّد الاستحقاق «${e(d.claim_label??'')}»، وينحسب تحصيلًا عليه`:'ما ارتبط باستحقاق: يسدّد الذمة في الدفتر وما ينحسب تحصيلًا على أي استحقاق، فيظهر فرقه في المطابقة الرقابية'}</small>
      ${d.actions.length?`<div class="operation-actions">${d.actions.map(action=>button(action,d.id,'تسجيل سحب')).join('')}</div>`:''}</li>`;
    // الدفعة المقدمة تُقرأ برصيدها الباقي، ثم كيف بقي: المقبوض ناقص المرتد والمسحوب، والرصيد رأس صف.
    const advanceCard=a=>{const waits=a.actions.includes('confirm_advance');
      return `<details class="vn-card ${waits?'is-decision':a.status==='recorded'?'is-pending':''}"${waits?' open':''}><summary><span class="vn-code">${a.received_on?day(a.received_on):''}</span><span class="vn-name"><strong>${e(a.description)}</strong><small>${e(a.client_name)} · مرجع الاتفاق: ${e(a.agreement_reference)}</small></span><span class="vn-flags"><strong>الرصيد ${fig(a.balance_minor)} ريال</strong>${waits?'<span class="badge is-decision">ينتظر تأكيد قبضها</span>':a.status==='recorded'?'<span class="badge pending">ما تأكد قبضها</span>':''}</span></summary><div class="vn-body">
        ${a.actions.length?`<div class="operation-actions">${a.actions.map(action=>button(action,a.id,advanceActionNames[action])).join('')}</div>`:''}
        ${ui.table({head:['البند','المبلغ (ريال)'],rows:[`<tr><td>قيمة الدفعة</td><td>${fig(a.amount_minor)}</td></tr>`,`<tr><td>المقبوض</td><td>${fig(a.paid_minor)}</td></tr>`,...(a.reversed_minor?[`<tr><td>ناقص المرتد</td><td>${fig(a.reversed_minor)}</td></tr>`]:[]),`<tr><td>ناقص المسحوب</td><td>${fig(a.drawn_minor)}</td></tr>`,`<tr><th scope="row">الرصيد</th><td><strong>${fig(a.balance_minor)}</strong></td></tr>`]})}
        <p class="subtle">${a.confirmed_by_name?`أكد قبضها ${e(a.confirmed_by_name)} في ${day(a.received_on)}${a.receipt_reference?` بالحوالة <bdi>${e(a.receipt_reference)}</bdi>`:''}`:'ما تأكد قبضها للحين، واللي سجّلها ما يأكده.'}</p>
        ${a.reversals.map(r=>`<p class="subtle measure">ارتد ${fig(r.amount_minor)} — ${e(r.reason)}</p>`).join('')}
        ${a.draws.length?`<ul class="vn-list">${a.draws.map(d=>drawRow(a,d)).join('')}</ul>`:''}</div></details>`;};
    const block=(title,hint,body)=>`<section class="vn-block"><div class="panel-head"><h2>${title}</h2>${hint?`<p>${e(hint)}</p>`:''}</div>${body}</section>`;
    const waiting=pending.map(draftRow).join(''),rest=data.drafts.filter(d=>d.status!=='pending_review');
    const drafts=waiting?`<section class="vn-block"><div class="panel-head"><h2>مسودات تنتظر الإصدار <span data-num>(${pending.length})</span></h2><p>المسودة مو فاتورة: بدون رقم ولا تسلسل ولا أثر ضريبي. الفاتورة تصدر في شاشة الفواتير الضريبية، وبعدها تنربط هنا.</p></div><ul class="vn-list">${waiting}</ul></section>`:'';
    const schedules=block('جداول الفوترة','',data.schedules.length?`<ul class="vn-list">${data.schedules.map(scheduleRow).join('')}</ul>`:'<p class="subtle">ما فيه جداول فوترة دورية للحين — ابدأ من «جدولة فوترة جديدة» ببنود العقد ويوم إصداره.</p>');
    const done=rest.length?`<details class="vn-block"><summary>مسودات انحسمت (<span data-num>${rest.length}</span>)</summary><ul class="vn-list">${rest.map(draftRow).join('')}</ul></details>`:'';
    const advances=data.advances.length?`<section class="vn-group"><h2>الدفعات المقدمة والسحب منها <span>${data.advances.length}</span></h2><p class="measure">الدفعة المقدمة التزام على الوكالة لين ينقدّم العمل: ما تنحسب إيراد، ومجموع السحب ما يتجاوز المدفوع. اللي سجّل الدفعة ما يأكد قبضها.</p>${data.advances.map(advanceCard).join('')}</section>`
      :block('الدفعات المقدمة والسحب منها','','<p class="subtle">ما فيه دفعات مقدمة مسجلة — تنسجل من «تسجيل دفعة مقدمة» بمرجع بند الاتفاق.</p>');
    const deferredRows=data.deferred.rows.map(r=>`<tr><td>${e(r.legal_name)}</td><td>${fig(r.received_minor)}</td><td>${fig(r.drawn_minor)}</td><td>${fig(r.balance_minor)}</td></tr>`);
    const deferred=block(`ورقة عمل الإيراد المؤجل لين ${day(data.deferred.as_of)}`,data.deferred.note,deferredRows.length
      ?ui.table({head:['العميل','المقبوض مقدمًا (ريال)','المسحوب (ريال)','الرصيد المؤجل (ريال)'],rows:[...deferredRows,`<tr><th scope="row" colspan="3">الإجمالي</th><td><strong>${fig(data.deferred.total_minor)}</strong></td></tr>`]})+'<p class="subtle">الاعتراف بالإيراد قرار محاسبي يدوي.</p>'
      :'<p class="subtle">ما فيه أرصدة مؤجلة لين هالتاريخ.</p>');
    return head+tiles+drafts+schedules+advances+deferred+done;
  },
  form(action,id,data){
    guard(data.can_manage);
    const clients=data.clients.map(c=>({value:c.id,label:`${c.code} · ${c.legal_name}`}));
    if(action==='create_schedule'){
      guard(clients.length);
      return {title:'جدولة فوترة دورية',endpoint:'/billing-schedules',idempotent:true,fields:[
        field('client_id','العميل','select',{options:clients}),
        field('title','اسم الجدولة'),
        field('cadence','الدورية','select',{options:Object.entries(data.cadences).map(([value,label])=>({value,label}))}),
        field('issue_day','يوم إصدار المسودة في الشهر','number',{min:1,max:28,value:1,hint:'لين 28، عشان يكون اليوم موجود في كل شهر.'}),
        field('start_date','تاريخ البداية','date',{value:data.today}),
        field('end_date','تاريخ النهاية','date',optional),
        // الجدولة على عقد مسجّل تنتهي عند نهاية مدته أو قبلها (الحزمة 4، الترحيل 185).
        field('contract_id','العقد في سجل العقود','select',{required:false,options:[{value:'',label:'بدون عقد مسجّل'},...(data.contracts??[]).map(c=>({value:c.id,label:`${c.number} · لين ${c.end_date}`}))],hint:'إذا اخترت عقدًا: تاريخ النهاية مطلوب، ولا يتجاوز نهاية العقد.'}),
        field('contract_reference','مرجع بند العقد'),
        field('owner_id','مالك الجدولة','select',{options:data.people.map(p=>({value:p.id,label:p.name})),value:data.user_id,hint:'الجدولة تشتغل بصلاحية مالكها وقت التشغيل، وإذا راحت صلاحيته توقف وينسجل السبب.'}),
        field('lines','بنود الفاتورة','rows',{columns:[{name:'description',label:'وصف البند'},{name:'amount',label:'المبلغ شامل الضريبة'}],maxRows:20,hint:'المبالغ بالريال وشاملة الضريبة زي الاستحقاقات، والتصنيف الضريبي يتحدد وقت إعداد الفاتورة.'})],
        toPayload:v=>({client_id:v.client_id,case_id:'',title:v.title,cadence:v.cadence,issue_day:Number(v.issue_day),start_date:v.start_date,end_date:v.end_date||'',contract_reference:v.contract_reference,owner_id:v.owner_id,lines:v.lines,...(v.contract_id?{contract_id:v.contract_id}:{})})};
    }
    if(action==='record_advance'){
      guard(clients.length);
      return {title:'تسجيل دفعة مقدمة (التزام)',endpoint:'/advances',idempotent:true,fields:[
        field('client_id','العميل','select',{options:clients}),
        field('description','وصف الدفعة المقدمة'),
        field('agreement_reference','مرجع بند الاتفاق'),
        field('amount','قيمة الدفعة شاملة الضريبة'),
        // الربط بالمشروع هو ما تقرؤه بوابة البدء: دفعةٌ بلا مشروع لا تفتح تنفيذ أي مشروع.
        field('project_id','المشروع اللي تخصه الدفعة','select',{...optional,options:[{value:'',label:'بلا مشروع'},...data.projects.map(p=>({value:p.id,label:p.name}))],hint:'اختر مشروع العميل نفسه؛ ما تنقبل دفعة عميل على مشروع عميل ثاني.'}),
        field('schedule_id','جدولة مرتبطة','select',{...optional,options:[{value:'',label:'بلا ارتباط'},...data.schedules.map(s=>({value:s.id,label:s.title}))],hint:data.zatca_advance_warning})],
        toPayload:v=>({client_id:v.client_id,schedule_id:v.schedule_id||'',project_id:v.project_id||'',description:v.description,agreement_reference:v.agreement_reference,amount:v.amount})};
    }
    if(['pause_schedule','resume_schedule','end_schedule'].includes(action)){
      const schedule=data.schedules.find(s=>s.id===id);guard(schedule&&schedule.actions.includes(action));
      const titles={pause_schedule:'إيقاف الجدولة مؤقتًا',resume_schedule:'استئناف الجدولة',end_schedule:'إنهاء الجدولة'};
      return {title:`${titles[action]} — ${schedule.title}`,endpoint:`/billing-schedules/${id}/${action}`,fields:action==='resume_schedule'?[]:[field('reason','السبب','textarea')],
        toPayload:v=>({version:schedule.version,reason:v.reason||''})};
    }
    if(['mark_issued','dismiss_draft'].includes(action)){
      const draft=data.drafts.find(d=>d.id===id);guard(draft&&draft.actions.includes(action));
      if(action==='dismiss_draft')return {title:`إلغاء مسودة ${draft.period_start}`,endpoint:`/billing-drafts/${id}/dismiss_draft`,fields:[field('note','سبب الإلغاء','textarea',{hint:'المسودة الملغاة تبقى محفوظة مع سببها.'})],
        toPayload:v=>({version:draft.version,invoice_id:'',note:v.note})};
      return {title:`ربط المسودة بفاتورة صادرة — ${draft.period_start}`,endpoint:`/billing-drafts/${id}/mark_issued`,fields:[
        field('invoice_id','معرف الفاتورة الصادرة',
          'text',{hint:'أصدر الفاتورة أول من شاشة الفواتير الضريبية بيد شخص غير اللي أعدها، وبعدين الصق معرفها هنا. المنصة ما تصدر فاتورة من الجدولة.'}),
        field('note','ملاحظة الربط','textarea',optional)],
        toPayload:v=>({version:draft.version,invoice_id:v.invoice_id,note:v.note||''})};
    }
    if(action==='confirm_advance'){
      const advance=data.advances.find(a=>a.id===id);guard(advance&&advance.actions.includes('confirm_advance'));
      return {title:`تأكيد قبض الدفعة المقدمة — ${advance.description}`,endpoint:`/advances/${id}/confirm`,fields:[
        field('amount','المبلغ المقبوض',
          'text',{value:(advance.amount_minor/100).toFixed(2)}),
        field('received_on','تاريخ القبض','date',{value:data.today}),
        field('reference','مرجع الحوالة أو إشعار القبض','text',{hint:'زي ما هو في كشف الحساب. الحوالة الوحدة تتأكد مرة وحدة.'}),
        field('evidence','دليل القبض','textarea',{hint:'مطابقة الحساب أو مستند القبض. اللي سجّل الدفعة ما يأكد قبضها.'})],
        toPayload:v=>({version:advance.version,amount:v.amount,received_on:v.received_on,evidence:v.evidence,reference:v.reference})};
    }
    if(action==='reverse_advance'){
      const advance=data.advances.find(a=>a.id===id);guard(advance&&advance.actions.includes('reverse_advance'));
      return {title:`تسجيل ارتداد من قبض ${advance.description}`,endpoint:`/advances/${id}/reverse`,idempotent:true,fields:[
        field('amount','المبلغ المرتد','text',{value:(advance.balance_minor/100).toFixed(2),hint:'من الرصيد اللي ما انسحب ولا ارتد. الارتداد يوقف التنفيذ المدفوع على المشروع لين يكتمل القبض.'}),
        field('reason','سبب الارتداد','textarea'),
        field('evidence','دليله: إشعار الارتداد أو كشف الحساب','textarea')],
        toPayload:v=>({amount:v.amount,reason:v.reason,evidence:v.evidence})};
    }
    if(action==='plan_draw'){
      const advance=data.advances.find(a=>a.id===id);guard(advance&&advance.actions.includes('plan_draw'));
      return {title:`تخطيط سحب من ${advance.description}`,endpoint:`/advances/${id}/draws`,idempotent:true,fields:[
        ...(advance.claims?.length?[{name:'claim_id',label:'الاستحقاق اللي يسدّده السحب',type:'select',options:advance.claims.map(c=>({value:c.id,label:`${c.label} · الباقي ${(c.room_minor/100).toFixed(2)}`})),
          hint:'السحب ينحسب تحصيل على هالاستحقاق بالذات، فما ينطالب العميل بمبلغ غطّته دفعته المقدمة'}]
          :[field('target_reference','الفاتورة الجاية اللي ينسحب عليها','text',{hint:'ما فيه استحقاق معتمد باقي لهالعميل الحين. السحب يتسجّل بلا ربط، وما ينحسب تحصيل لين يصير له استحقاق'})]),
        field('amount','قيمة السحب',
          'text',{hint:'مجموع السحب ما يتجاوز الرصيد المدفوع، وأي زيادة تنرفض.'})],
        toPayload:v=>advance.claims?.length?({claim_id:v.claim_id,amount:v.amount}):({target_reference:v.target_reference,amount:v.amount})};
    }
    if(action==='apply_draw'){
      const advance=data.advances.find(a=>a.draws.some(d=>d.id===id)),draw=advance?.draws.find(d=>d.id===id);
      guard(draw&&draw.actions.includes('apply_draw'));
      return {title:`تسجيل سحب على ${draw.target_reference}`,endpoint:`/advance-draws/${id}/apply`,fields:[
        field('amount','المبلغ المسحوب الحين','text',{value:((draw.amount_minor-draw.applied_minor)/100).toFixed(2)}),
        field('note','ملاحظة','textarea',optional)],
        toPayload:v=>({version:draw.version,amount:v.amount,note:v.note||''})};
    }
    guard(false);
  }
};

export const retainersUI={
  title:'فترات الاشتراك الدوري والترحيل',
  description:'لكل اشتراك فترات بميزانية بالساعات أو بالمال، ومستهلك، ومرحَّل داخل وطالع. خياري الترحيل مستقلين ويضبطهم صاحب العقد، والترحيل ما يغيّر مبلغ الفاتورة أبد. عتبات التنبيه إعداد بمستلميها، والتنبيه داخل المنصة بس.',
  load:api=>api('/retainers'),
  render(data,{e,button,ui=kit(e)}){
    const periods=data.agreements.flatMap(a=>a.periods);
    const open=periods.filter(p=>p.status==='open');
    const over=periods.filter(p=>p.over);
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    const head=`<section class="panel panel-body vn-head">${data.can_manage&&data.clients.length?`<div class="operation-actions">${button('create_agreement','','اتفاق اشتراك جديد')}</div>`:''}<p>${e(data.note)}</p></section>`;
    const tiles=`<section class="vn-board"><div class="vn-tiles">
      ${ui.tile(over.length,'فترة تجاوزت ميزانيتها',over.length?'is-late':'')}
      ${ui.tile(periods.filter(p=>p.alerts.length).length,'فترة بلغت عتبة تنبيه',periods.some(p=>p.alerts.length)?'is-due':'')}
      ${ui.tile(open.length,'فترة مفتوحة')}
      ${ui.tile(data.agreements.length,'اتفاق اشتراك')}
    </div></section>`;
    // الفترة تُقرأ بما بقي من ميزانيتها، والتجاوز يُقال بكلمته وشكله لا بلونه.
    const periodRow=(a,p)=>`<li class="${p.over?'is-late':p.status==='open'?'':'is-old'}"><strong><time datetime="${e(p.period_month)}">${e(p.period_month)}</time> — المتبقي <span class="ltr">${e(p.remaining_text)}</span>${p.over?' (تجاوز)':''}</strong><span class="badge ${p.over?'overdue':p.status==='open'?'open':'closed'}">${e(p.over?'تجاوز الميزانية':p.status==='open'?'مفتوحة':'مقفلة')}</span>
      <span>الميزانية <span class="ltr">${e(p.available_text)}</span> (منها مرحَّل داخلًا <span class="ltr">${e(p.carried_in_text)}</span>) · المستهلك <span class="ltr">${e(p.consumed_text)}</span>${p.usage_bp===null?'':` · <span class="ltr">${e(percent(p.usage_bp))}</span>`}</span>
      ${p.status==='closed'?`<small class="measure">المرحَّل خارجًا <span class="ltr">${e(p.carried_out_text)}</span> · ${e(p.closing_note)}</small>`:''}
      ${p.alerts.length?`<small>عتبات بلغتها: ${p.alerts.map(x=>`<span class="ltr">${e(percent(x.threshold_bp))}</span>`).join('، ')}</small>`:''}
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(action=>button(action,p.id,action==='record_consumption'?'تسجيل استهلاك':'إقفال الفترة وحساب الترحيل')).join('')}</div>`:''}</li>`;
    const agreementCard=a=>{const current=a.periods.find(p=>p.status==='open');
      return `<details class="vn-card ${a.periods.some(p=>p.over)?'is-late':''}"${current?' open':''}><summary><span class="vn-code">${current?`<time datetime="${e(current.period_month)}">${e(current.period_month)}</time>`:''}</span><span class="vn-name"><strong>${e(a.name)} · ${e(a.client_name)}</strong><small>${e(a.basis_name)} · صاحب العقد ${e(a.owner_name||'—')} · مرجع العقد: ${e(a.contract_reference)}</small></span><span class="vn-flags">${current?`<strong>المتبقي <span class="ltr">${e(current.remaining_text)}</span>${current.over?' (تجاوز)':''}</strong>`:''}</span></summary><div class="vn-body">
      ${a.actions.length?`<div class="operation-actions">${a.actions.map(action=>button(action,a.id,{open_period:'فتح فترة',set_carry_rules:'ضبط خياري الترحيل',set_threshold:'ضبط عتبة تنبيه'}[action])).join('')}</div>`:''}
      <dl class="vn-facts"><div><dt>ترحيل غير المستهلك</dt><dd>${a.carry_unused?'مفعّل':'غير مفعّل'}</dd></div><div><dt>خصم الزائد من الفترة الجاية</dt><dd>${a.deduct_overage?'مفعّل':'غير مفعّل'}</dd></div><div><dt>عتبات التنبيه</dt><dd>${a.rules.length?a.rules.map(r=>`<span class="ltr">${e(percent(r.threshold_bp))}</span> لـ${r.recipient_names.map(e).join('، ')}`).join(' · '):'ما فيه عتبات مضبوطة'}</dd></div></dl>
      <p class="subtle">الخيارين مستقلين، وما لأي واحد منهم أثر على مبلغ الفاتورة الدورية.</p>
      ${a.periods.length?`<ul class="vn-list">${a.periods.map(p=>periodRow(a,p)).join('')}</ul>`:'<p class="subtle">ما فيه فترات للحين — تنفتح من «فتح فترة» بميزانيتها.</p>'}</div></details>`;};
    return head+tiles+(data.agreements.length?`<section class="vn-group"><h2>اتفاقات الاشتراك <span>${data.agreements.length}</span></h2>${data.agreements.map(agreementCard).join('')}</section>`
      :ui.empty('ما فيه اتفاقات اشتراك دوري للحين','ابدأ من «اتفاق اشتراك جديد» بعميله ومرجع عقده وصاحبه؛ وبعدها تنفتح فتراته بميزانياتها.'));
  },
  form(action,id,data){
    guard(data.can_manage);
    const findAgreement=agreementId=>data.agreements.find(a=>a.id===agreementId);
    const findPeriod=periodId=>{for(const a of data.agreements){const p=a.periods.find(x=>x.id===periodId);if(p)return {agreement:a,period:p};}return null;};
    if(action==='create_agreement'){
      guard(data.clients.length);
      return {title:'اتفاق اشتراك دوري',endpoint:'/retainer-agreements',idempotent:true,fields:[
        field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:`${c.code} · ${c.legal_name}`}))}),
        field('name','اسم الاشتراك'),
        field('basis','أساس الميزانية','select',{options:Object.entries(data.basis).map(([value,label])=>({value,label}))}),
        field('contract_reference','مرجع بند العقد'),
        field('owner_id','صاحب العقد','select',{options:data.people.filter(p=>p.id!==data.user_id).map(p=>({value:p.id,label:p.name})),hint:'صاحب العقد بس هو اللي يضبط خياري الترحيل ويقفل الفترات، واللي يسجّل الاتفاق ما يكون صاحبه.'})],
        toPayload:v=>({client_id:v.client_id,name:v.name,basis:v.basis,contract_reference:v.contract_reference,owner_id:v.owner_id})};
    }
    if(action==='set_carry_rules'){
      const agreement=findAgreement(id);guard(agreement&&agreement.actions.includes('set_carry_rules'));
      return {title:`خياري الترحيل — ${agreement.name}`,endpoint:`/retainer-agreements/${id}/carry-rules`,fields:[
        field('carry_unused','ترحيل غير المستهلك للفترة اللي بعدها','select',{options:yesNo,value:agreement.carry_unused?'yes':'no'}),
        field('deduct_overage','خصم الزايد من الفترة اللي بعدها','select',{options:yesNo,value:agreement.deduct_overage?'yes':'no'}),
        field('note','أساس الخيارين في العقد','textarea',{hint:'الخيارين مستقلين عن بعض، وأيًّا كان ضبطهم ما يتغير مبلغ الفاتورة.'})],
        toPayload:v=>({version:agreement.version,carry_unused:v.carry_unused==='yes',deduct_overage:v.deduct_overage==='yes',note:v.note})};
    }
    if(action==='set_threshold'){
      const agreement=findAgreement(id);guard(agreement&&agreement.actions.includes('set_threshold'));
      return {title:`عتبة تنبيه — ${agreement.name}`,endpoint:`/retainer-agreements/${id}/threshold`,fields:[
        field('threshold_percent','النسبة من الميزانية المتاحة','text',{hint:'مثلًا 50 أو 75 أو 90. ما فيه عتبة جاهزة؛ كل عتبة تدخلها أنت.'}),
        field('recipients','مستلمو التنبيه','checks',{...optional,options:data.people.map(p=>({value:p.id,label:p.name})),hint:'إذا تركت القائمة فاضية تنلغي العتبة بهالنسبة.'})],
        toPayload:v=>({threshold_percent:v.threshold_percent,recipients:v.recipients||[]})};
    }
    if(action==='open_period'){
      const agreement=findAgreement(id);guard(agreement&&agreement.actions.includes('open_period'));
      return {title:`فتح فترة — ${agreement.name}`,endpoint:'/retainer-periods',idempotent:true,fields:[
        field('period_month','الشهر','month',{value:data.today.slice(0,7)}),
        field('budget','ميزانية الفترة','text',{hint:agreement.basis==='hours'?'بالساعات وبأرباع الساعة (مثلًا 50 أو 12.5).':'بالريال بخانتين عشريتين.'})],
        toPayload:v=>({agreement_id:id,period_month:v.period_month,budget:v.budget})};
    }
    if(action==='record_consumption'){
      const found=findPeriod(id);guard(found&&found.period.actions.includes('record_consumption'));
      return {title:`تسجيل استهلاك — ${found.period.period_month}`,endpoint:`/retainer-periods/${id}/consumption`,idempotent:true,fields:[
        field('amount','المستهلك','text',{hint:found.agreement.basis==='hours'?'بالساعات وبأرباع الساعة.':'بالريال بخانتين عشريتين.'}),
        field('reference','مرجع الاستهلاك')],
        toPayload:v=>({amount:v.amount,reference:v.reference})};
    }
    if(action==='close_period'){
      const found=findPeriod(id);guard(found&&found.period.actions.includes('close_period'));
      return {title:`إقفال الفترة وحساب الترحيل — ${found.period.period_month}`,endpoint:`/retainer-periods/${id}/close`,fields:[
        field('note','ملخص الفترة وأساس الترحيل','textarea',{hint:'الإقفال يحسب المرحَّل للفترة اللي بعدها بخياري العقد، وما يمس مبلغ الفاتورة. الفترة المقفلة ما تتعدل؛ التصحيح بفترة جديدة.'})],
        toPayload:v=>({version:found.period.version,note:v.note})};
    }
    guard(false);
  }
};
