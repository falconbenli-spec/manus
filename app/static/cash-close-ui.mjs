// ثلاث شاشات: التنبؤ النقدي المتجدد، قائمة الإقفال الشهري، وإطفاء المدفوعات المقدمة والاستحقاقات.
// الصدق في الواجهة: كل شاشة تقول ما ليست عليه — لا اتصال بنكي، ولا ترحيل آلي، ولا نسبة مفترضة، ولا قائمة مهام جاهزة.
import { dual } from './dates.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const list=(rows,empty)=>rows.length?`<ul class="vn-list">${rows.join('')}</ul>`:`<p class="subtle">${empty}</p>`;

export const cashForecastUI={
  title:'التنبؤ النقدي — 13 أسبوعًا',
  description:'ثلاثة عشر أسبوع قدّام تتجدد من مستندات المنصة نفسها: المؤكد والمتوقع منفصلين وما ينجمعون. ما فيه اتصال بأي بنك، وما ينخزن منه أي رقم، وما فيه نسبة تحصيل مفترضة. الرصيد الافتتاحي من رصيد الدفتر على الحسابات البنكية اللي لها تسوية معتمدة، وإذا ما فيه تسوية يبقى إدخال يدوي بمصدره. والسيناريوهات تنحسب على طول وما تنحفظ.',
  load:api=>api('/cash-forecast'),
  render(data,{e,button,money,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية، والسالب بإشارته داخل العزل ومعه كلمته؛ والعملة في رأس العمود وتسمية البلاطة.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const signed=v=>Number(v)<0?`${fig(v)} <small>سالب</small>`:fig(v);
    const tileMoney=v=>Number(v)<0?`⁦${num(v)}⁩`:num(v);
    const day=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
    // الأسابيع جدولٌ واحد كما يقرأ المحاسب التدفق: الداخل ثم الخارج ثم الرصيد، والمؤكد منفصل عن المتوقع ولا يُجمعان.
    const weeks=ui.table({head:['الأسبوع','داخل مؤكد (ريال)','داخل متوقع (ريال)','خارج مؤكد (ريال)','خارج متوقع (ريال)','الرصيد على المؤكد (ريال)','الرصيد مع المتوقع (ريال)'],
      rows:data.weeks.map(w=>`<tr class="${w.negative_on_confirmed?'is-late':w.negative_with_expected?'is-due':''}"><td>الأسبوع <span data-num>${e(w.index)}</span> <small>من ${day(w.from)} لين ${day(w.to)}${w.overdue_items?` · فيه <span data-num>${e(w.overdue_items)}</span> بند مستحق قبل اليوم`:''}</small></td><td>${fig(w.confirmed_in_minor)}</td><td>${fig(w.expected_in_minor)}</td><td>${fig(w.confirmed_out_minor)}</td><td>${fig(w.expected_out_minor)}</td><td>${signed(w.closing_confirmed_minor)}</td><td>${signed(w.closing_with_expected_minor)}</td></tr>`),
      empty:{title:'ما فيه أسابيع',body:'الأفق ثلاث عشرة أسبوع من بداية الأسبوع الحالي.'}});
    const streams=ui.table({head:['المصدر','الاتجاه','اليقين','البنود','المبلغ (ريال)'],rows:data.streams.map(s=>`<tr><td>${e(s.stream)}</td><td>${e(s.direction==='in'?'داخل':'خارج')}</td><td>${e(data.certainty_names[s.certainty])}</td><td><span data-num>${e(s.count)}</span></td><td>${fig(s.amount_minor)}</td></tr>`),
      empty:{title:'ما فيه مستندات داخل الأفق',body:'تطلع هنا الفواتير والأوامر والرواتب اللي تستحق خلال الثلاث عشرة أسبوع.'}});
    // الرواتب: المغطى بالمؤكد صامت، والمغطى لو تحقق المتوقع ينتظر، وغير المغطى بشكل التوقف وكلمته.
    const salary=p=>`<li class="${p.covered_by_confirmed?'':p.covered_with_expected?'is-due':'is-late'}"><strong>${e(p.label)} — ${fig(p.amount_minor)} ريال</strong><span>الأسبوع <span data-num>${e(p.week)}</span> · <time datetime="${e(p.date)}">${e(dual(p.date))}</time></span><small>${e(p.covered_by_confirmed?'يغطيه الرصيد على المؤكد وحده':p.covered_with_expected?'ما يغطيه المؤكد وحده؛ يحتاج يتحقق المتوقع':'ما يغطيه المؤكد ولا المتوقع')}</small></li>`;
    const scenario=s=>`<li><strong>${e(s.label)} · ${e(s.name)}</strong><span>أدنى رصيد على المؤكد ${signed(s.min_confirmed_minor)} ريال (الفرق ${signed(s.delta_min_confirmed_minor)}) · أول أسبوع سالب ${e(s.first_negative_week_confirmed??'ما فيه')}</span><small>إدخال يدوي محسوب الحين، غير محفوظ وما يغيّر أي مستند.</small></li>`;
    const history=data.collection_history,fromBank=data.opening?.source==='bank_reconciliation',minNeg=data.min_confirmed_minor<0;
    const block=(title,body)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${body}</section>`;
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${fromBank?'':button('set_opening','','الرصيد الافتتاحي')}${button('run_scenario','','سيناريو (ما ينحفظ)')}</div><p>${e(data.note)}</p>
      <p>الأفق من ${day(data.week_starts_on)} لين ${day(data.horizon_ends_on)} · محسوب في <time datetime="${e(String(data.as_of).slice(0,10))}">${e(dual(data.as_of))}</time></p></section>
      ${data.opening_required?`<div class="vn-alert is-due"><strong>الرصيد الافتتاحي ما انكتب</strong><p class="measure">الأرصدة تحت محسوبة من صفر وتقيس الحركة مو الرصيد. اكتبه، أو خذه من آخر تسوية بنكية معتمدة.</p></div>`:''}
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(tileMoney(data.min_confirmed_minor),minNeg?'أدنى رصيد على المؤكد وحده بالريال — عجز':'أدنى رصيد على المؤكد وحده بالريال',minNeg?'is-late':'')}
        ${ui.tile(data.first_negative_week_confirmed??'ما فيه','أول أسبوع سالب على المؤكد',data.first_negative_week_confirmed?'is-late':'')}
        ${ui.tile(tileMoney(data.min_with_expected_minor),data.min_with_expected_minor<0?'أدنى رصيد لو تحقق المتوقع بالريال — عجز':'أدنى رصيد لو تحقق المتوقع بالريال',data.min_with_expected_minor<0?'is-due':'')}
        ${ui.tile(tileMoney(data.opening_balance_minor),'الرصيد الافتتاحي بالريال'+(fromBank?' (تسوية بنكية معتمدة)':data.opening?.source==='manual'?' (إدخال يدوي)':''))}</div></section>
      ${fromBank?block('الرصيد الافتتاحي',`<p class="subtle measure">${e(data.opening.label)}</p><ul class="vn-list">${data.opening.accounts.map(a=>`<li><strong>${e(a.label)} — ${fig(a.ledger_balance_minor)} ريال</strong><span>مطابق لين <time datetime="${e(a.reconciled_to)}">${e(dual(a.reconciled_to))}</time> · رصيد الدفتر</span></li>`).join('')}${data.opening.unposted_count?`<li class="is-due"><strong>مستندات نقد نهائية ما ترحّل قيدها — ${fig(data.opening.unposted_cash_minor)} ريال</strong><span><span data-num>${e(data.opening.unposted_count)}</span> مستند</span></li>`:''}</ul>`):''}
      ${block('الأسابيع',weeks)}
      ${block('تغطية الرواتب',list(data.payroll_coverage.map(salary),'ما فيه حدث رواتب داخل الأفق.'))}
      ${block('مصادر الأرقام',streams+`<p class="subtle">برّا الأفق: داخل ${fig(data.beyond_horizon.in_minor)} ريال · خارج ${fig(data.beyond_horizon.out_minor)} (<span data-num>${e(data.beyond_horizon.items)}</span> بند).</p>`)}
      ${data.scenarios.length?block('السيناريوهات',list(data.scenarios.map(scenario),'')):''}
      ${block('سلوك التحصيل التاريخي',`<p class="${history.available&&!history.reliable?'':'subtle'} measure">${e(history.note)}${history.available?` متوسط الفرق بين تاريخ الاستحقاق وتاريخ القبض <span data-num>${e(history.median_lag_days)}</span> يوم (من <span data-num>${e(history.min_lag_days)}</span> لين <span data-num>${e(history.max_lag_days)}</span>) على عينة <span data-num>${e(history.sample_size)}</span>.`:''}</p>`)}
      ${block('اللي ما يشمله هالتنبؤ',`<ul class="vn-list">${data.gaps.map(g=>`<li><span>${e(g)}</span></li>`).join('')}</ul>`)}
      ${data.assumptions.length?block('الافتراضات المعلنة',`<ul class="vn-list">${data.assumptions.map(a=>`<li><span>${e(a)}</span></li>`).join('')}</ul>`):''}`;
  },
  form(action,id,data){
    if(action==='set_opening')return {title:'الرصيد الافتتاحي',endpoint:'/cash-forecast/project',fields:[
      field('opening_balance','الرصيد النقدي اليوم','number',{hint:'بالريال. ما ينحفظ؛ تنحسب فيه هالقراءة بس.'}),
      field('opening_source','مصدر الرقم','select',{options:[{value:'accountant',label:'إدخال المحاسب'}],hint:'إذا انعتمدت تسوية بنكية، المنصة تقرأ رصيدها بنفسها.'}),
      field('opening_note','سند الرقم','textarea',{hint:'كشف أي حساب وبأي تاريخ، ومين أكده. المنصة ما تتصل بأي بنك.'})],
      toPayload:v=>({opening_balance:v.opening_balance,opening_source:v.opening_source,opening_note:v.opening_note})};
    guard(action==='run_scenario');
    return {title:'سيناريو — ينحسب على طول وما ينحفظ',endpoint:'/cash-forecast/project',fields:[
      ...(data.opening?.source==='bank_reconciliation'?[]:[field('opening_balance','الرصيد الافتتاحي','number',{required:false})]),
      field('kind','السيناريو','select',{options:[{value:'client_delay',label:'تأخر عميل كبير'},{value:'client_lost',label:'خسارة عميل'},{value:'new_hire',label:'تعيين جديد'},{value:'collection_delay',label:'تأجيل تحصيل'}]}),
      field('case_id','العميل (لتأخر أو خسارة عميل)','select',{required:false,options:[{value:'',label:'— ما ينطبق —'},...data.clients.map(c=>({value:c.id,label:c.name}))]}),
      field('delay_days','التأخير بالأيام (1–180)','number',{required:false}),
      field('monthly_amount','التكلفة الشهرية للتعيين','number',{required:false}),
      field('starts_on','تاريخ المباشرة','date',{required:false}),
      field('label','اسم السيناريو','text',{required:false})],
      toPayload:v=>({opening_balance:v.opening_balance||'',scenarios:[{kind:v.kind,case_id:v.case_id||undefined,delay_days:v.delay_days?Number(v.delay_days):undefined,monthly_amount:v.monthly_amount||undefined,starts_on:v.starts_on||undefined,label:v.label||undefined}]})};
  }
};

const closeLabels={add_task:'مهمة جديدة',approve_close:'اعتماد الإقفال',request_reopen:'طلب فتح الإقفال',approve_reopen:'اعتماد الفتح',reject_reopen:'رفض الفتح',explain_exception:'تفسير فرق',complete_task:'توثيق التنفيذ',reassign_task:'نقل المهمة',activate_template:'تفعيل',deactivate_template:'إيقاف'};
const ledgerStates={pending:'ينتظر قرار شخص ثالث',approved:'الدفتر منفتح لين ينقفل من جديد',rejected:'رُفض والدفتر باقٍ مقفل'};
export const closeChecklistUI={
  title:'الإقفال الشهري',
  description:'لكل شهر قائمة مهام بمالك وموعد ودليل تنفيذ. تبدأ فارغة: مالك الإجراء يحط القوالب، والمنصة ما تقترح مهام محاسبية جاهزة. اللي ينفّذ مهمة ما يعتمد الإقفال، واعتماد الإقفال يقفل الفترة المحاسبية في الدفتر المالي (نفس القفل اللي هناك، مو قفل جديد).',
  load:api=>api('/close-checklist'),
  render(data,{e,button,money,ui=kit(e)}){
    const day=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(String(iso).slice(0,10)))}</time>`:'—';
    // المهمة: عنوانها ومالكها وموعدها. المنفذة صامتة، والمتأخرة بشكل التوقف وكلمته، والتي تنتظر صاحبها بعلامة «دورك».
    const task=(t,p)=>`<li class="${t.status==='done'?'':t.overdue?'is-late':t.actions.includes('complete_task')?'is-decision':'is-pending'}"><strong>${e(t.title)}</strong><span class="badge ${t.status==='done'?'done':t.overdue?'overdue':'open'}">${e(t.overdue&&t.status!=='done'?`${t.status_name} — متأخرة`:t.status_name)}</span>
      <span>المالك ${e(t.owner_name)} · الموعد ${day(t.due_date)}${t.completed_by_name?` · نفّذها ${e(t.completed_by_name)}`:''}</span>
      ${t.evidence?`<small class="measure">الدليل: ${e(t.evidence)}</small>`:''}
      ${t.actions.length?`<div class="operation-actions">${t.actions.map(a=>button(a,t.id,closeLabels[a])).join('')}</div>`:''}</li>`;
    const reopen=r=>`<li class="${r.status==='pending'?'is-pending':'is-old'}"><strong>طلب فتح — ${e({pending:'ينتظر شخص ثالث',approved:'انفتح',rejected:'انرفض'}[r.status])}</strong>
      <span>طلبه ${e(r.requested_by_name)}${r.approved_by_name?` · قرّره ${e(r.approved_by_name)}`:''}</span><small class="measure">${e(r.reason)}${r.note?` — ${e(r.note)}`:''}</small></li>`;
    // فحوص الإقفال الأربعة تُعرض كلها، عدّت أو ما عدّت، ومع ما لم يعدّ بنوده ومالكها.
    const failingItems=c=>c.items.filter(i=>!i.passed);
    const checkLine=c=>`<li class="${c.passed?'':'is-late'}"><strong>${e(c.name)}</strong><span class="badge ${c.passed?'passed':'failed'}">${c.passed?'عدّى':`ما عدّى — ${e(failingItems(c).length||c.hidden_items||0)} بند`}</span>
      <span>المالك ${e(c.owner)}</span>
      ${failingItems(c).length?`<small class="measure">${failingItems(c).map(i=>e(i.text)).join(' · ')}</small><small class="subtle measure">${e(c.next)}</small>`:''}
      ${c.items.filter(i=>i.explained).map(i=>`<small class="subtle measure">مفسَّر: ${e(i.text)} — ${e(i.explanation.text)} (كتبه ${e(i.explanation.recorded_by_name)})</small>`).join('')}</li>`;
    const ledger=p=>{const r=p.ledger_reopening;if(!r)return '';
      return `<div class="vn-alert ${r.overdue?'is-late':''}"><strong>فتح الدفتر: ${e(ledgerStates[r.status])}</strong><p>طلبه ${e(r.requested_by_name)}${r.decided_by_name?` · قرّره ${e(r.decided_by_name)}`:''}${r.reclose_due_on?` · ينعاد إقفاله قبل ${day(r.reclose_due_on)}${r.overdue?' — فات الموعد':''}`:''}</p></div>`;};
    const deadline=p=>p.pending_reopen&&p.finance_period&&p.reclose_deadline.days===null?`<div class="vn-alert is-due"><p>«${e(p.reclose_deadline.label)}» ما تقررت للحين، فاعتماد الفتح ينرفض لين يقررها ${e(p.reclose_deadline.owner)} ويعتمدها زميل ثاني.</p></div>`:'';
    // الفترة: ما ينتظر قرار القارئ (اعتماد الإقفال أو الفتح) أولها، ثم قفل الدفتر، ثم الفحوص، ثم المهام.
    const decides=p=>p.actions.some(a=>['approve_close','approve_reopen','reject_reopen'].includes(a));
    const period=p=>`<details class="vn-card ${decides(p)?'is-decision':p.status==='open'?(p.overdue_tasks?'is-late':'is-pending'):''}"${decides(p)||p.status==='open'?' open':''}><summary><span class="vn-code"><time datetime="${e(p.period_key)}">${e(p.period_key)}</time></span><span class="vn-name"><strong>إقفال ${e(p.period_key)}</strong><small><span data-num>${e(p.done_tasks)}</span> من <span data-num>${e(p.done_tasks+p.open_tasks)}</span> مهمة منفّذة${p.reopen_count?` · انفتح <span data-num>${e(p.reopen_count)}</span> مرة`:''}</small></span><span class="vn-flags">${decides(p)?'<span class="badge is-decision">ينتظر قرارك</span>':''}<span class="badge ${p.status==='approved'?'approved':'open'}">${e(p.status_name)}</span></span></summary><div class="vn-body">
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(a=>button(a,p.id,closeLabels[a])).join('')}</div>`:''}
      ${p.approved_by_name?`<p class="subtle">اعتمد الإقفال ${e(p.approved_by_name)} في ${day(p.approved_at)}</p>`:''}
      <p class="${p.ledger_locked?'subtle':''} measure">${p.finance_period?`الفترة المحاسبية «${e(p.finance_period.name)}» (من ${day(p.finance_period.starts_on)} لين ${day(p.finance_period.ends_on)}) · ${e(p.ledger_locked?'مقفلة: ما ينقبل قيد بتاريخ داخلها':p.finance_period.status==='open'&&p.reopen_count?'منفتحة بفتح معتمد: تنقفل من جديد عند اعتماد الإقفال':'تنقفل عند اعتماد الإقفال')}`:'ما انربطت فترة محاسبية بهالشهر، فاعتماد الإقفال ما يمنع قيد بتاريخ داخله.'}</p>
      ${ledger(p)}${deadline(p)}
      ${p.blocked_reason?`<div class="vn-alert is-due"><p>${e(p.blocked_reason)}</p></div>`:''}
      <section class="vn-block"><h3>فحوص الإقفال</h3><p class="subtle measure">تنحسب من الدفتر وقت القراءة ووقت الاعتماد: القيود، والمستندات، والتسوية البنكية لين آخر الشهر، والحسابات الرقابية في آخر الشهر.</p>${list(p.checks.checks.map(checkLine),'')}</section>
      <section class="vn-block"><h3>المهام</h3>${list(p.tasks.map(t=>task(t,p)),'ما فيه مهام في هالفترة للحين — تنضاف من «مهمة جديدة» أو من قوالب المهام عند فتح الشهر.')}</section>
      ${p.reopenings.length?`<section class="vn-block"><h3>طلبات الفتح</h3>${list(p.reopenings.map(reopen),'')}</section>`:''}</div></details>`;
    const template=t=>`<li class="${t.active?'':'is-old'}"><strong>${e(t.title)}</strong><span>المالك ${e(t.owner_name)} · الموعد يوم <span data-num>${e(t.due_day)}</span> من الشهر اللي بعده${t.active?'':' · موقوف'}</span><small class="measure">${e(t.basis)}</small>
      <div class="operation-actions">${t.actions.map(a=>button(a,t.id,closeLabels[a])).join('')}</div></li>`;
    const waiting=data.periods.filter(decides),rest=data.periods.filter(p=>!waiting.includes(p));
    return `<section class="panel panel-body vn-head">${data.can_manage?`<div class="operation-actions">${button('open_period','','فتح إقفال شهر')}${button('create_template','','قالب مهمة')}</div>`:''}<p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(data.periods.reduce((n,p)=>n+p.open_tasks,0),'مهمة مفتوحة',data.periods.some(p=>p.overdue_tasks)?'is-late':'')}
        ${ui.tile(waiting.length,'إقفال ينتظر قرارك',waiting.length?'is-decision':'')}
        ${ui.tile(data.periods.filter(p=>p.status==='approved').length,'إقفال معتمد ومقفل')}
        ${ui.tile(data.templates.filter(t=>t.active).length,'قالب ساري',data.can_manage&&!data.templates.length?'is-due':'')}</div></section>
      ${data.can_manage&&!data.templates.length?`<div class="vn-alert is-due"><p class="measure">ما فيه قوالب مهام للحين. القائمة تبدأ فاضية عمدًا: مالك إجراء الإقفال هو اللي يقرر وش ينجز كل شهر ومين يملكه، والمنصة ما تفترض قائمة محاسبية عنه.</p></div>`:''}
      ${waiting.length?`<section class="vn-group"><h2>ينتظر قرارك <span>${waiting.length}</span></h2>${waiting.map(period).join('')}</section>`:''}
      ${rest.length?`<section class="vn-group"><h2>فترات الإقفال <span>${rest.length}</span></h2>${rest.map(period).join('')}</section>`:data.periods.length?'':ui.empty('ما فيه فترات إقفال للحين',data.can_manage?'ابدأ من «فتح إقفال شهر»، وتنضاف مهامه من قوالبك.':'تطلع هنا فترة الإقفال اللي عليك فيها مهمة.')}
      ${data.templates.length?`<section class="vn-block"><div class="panel-head"><h2>قوالب المهام</h2></div>${list(data.templates.map(template),'')}</section>`:''}`;
  },
  form(action,id,data){
    const people=data.people.map(p=>({value:p.id,label:p.name}));
    if(action==='create_template'){guard(data.can_manage);return {title:'قالب مهمة إقفال',endpoint:'/close-checklist/templates',idempotent:true,fields:[
      field('title','المهمة'),field('owner_id','المالك','select',{options:people}),
      field('due_day','يوم الاستحقاق من الشهر اللي بعده (1–28)','number',{min:1,max:28}),
      field('basis','ليش هالمهمة ومين قررها','textarea',{hint:'مهام الإقفال تكتبونها أنتم؛ اكتب سند المهمة ومين اعتمدها.'})],
      toPayload:v=>({title:v.title,owner_id:v.owner_id,due_day:Number(v.due_day),basis:v.basis})};}
    if(action==='open_period'){guard(data.can_manage);return {title:'فتح إقفال شهر',endpoint:'/close-checklist/periods',idempotent:true,fields:[
      field('period_key','الشهر (2026-09)'),
      field('finance_period_id','الفترة المحاسبية اللي بتنقفل','select',{required:false,options:[{value:'',label:'— بلا قفل قيود —'},...data.finance_periods.map(p=>({value:p.id,label:`${p.name} (${p.starts_on} — ${p.ends_on})`}))],
        hint:'قفل القيود يعني إقفال الفترة المحاسبية في الدفتر المالي. انتبه لمدى الفترة: القفل يشملها كلها، مو شهر الإقفال بس.'})],
      toPayload:v=>({period_key:v.period_key,finance_period_id:v.finance_period_id||null})};}
    if(['activate_template','deactivate_template'].includes(action)){
      const t=data.templates.find(x=>x.id===id);guard(t&&t.actions.includes(action));
      return {title:`${closeLabels[action]} — ${t.title}`,endpoint:`/close-checklist/templates/${id}/${action}`,fields:[field('note','السبب','textarea')],toPayload:v=>({version:t.version,note:v.note})};
    }
    const task=data.periods.flatMap(p=>p.tasks).find(t=>t.id===id);
    if(task&&['complete_task','reassign_task'].includes(action)){
      guard(task.actions.includes(action));
      if(action==='complete_task')return {title:`توثيق التنفيذ — ${task.title}`,endpoint:`/close-checklist/tasks/${id}/complete_task`,fields:[
        field('evidence','وش سويت ووين انحفظ الدليل','textarea',{hint:'مرجع الكشف أو التقرير ومكانه. لا تكتب بيانات دخول.'})],toPayload:v=>({version:task.version,evidence:v.evidence})};
      return {title:`نقل المهمة — ${task.title}`,endpoint:`/close-checklist/tasks/${id}/reassign_task`,fields:[
        field('owner_id','المالك الجديد','select',{options:people}),field('note','سبب النقل','textarea')],toPayload:v=>({version:task.version,owner_id:v.owner_id,note:v.note})};
    }
    const p=data.periods.find(x=>x.id===id);guard(p&&p.actions.includes(action));
    if(action==='add_task')return {title:`مهمة في إقفال ${p.period_key}`,endpoint:`/close-checklist/periods/${id}/add_task`,fields:[
      field('title','المهمة'),field('owner_id','المالك','select',{options:people}),field('due_date','الموعد','date')],
      toPayload:v=>({version:p.version,title:v.title,owner_id:v.owner_id,due_date:v.due_date})};
    if(action==='approve_close')return {title:`اعتماد إقفال ${p.period_key}`,endpoint:`/close-checklist/periods/${id}/approve_close`,fields:[
      field('note','وش اعتمدت وليش','textarea',{hint:`${p.checks.passed?'فحوص الإقفال الأربعة عدّت الحين.':`فحوص ما عدّت: ${p.checks.checks.filter(c=>!c.passed).map(c=>c.name).join('، ')} — الاعتماد بينرفض ويطلع لك كل بند.`} ${p.finance_period?`بينقفل الدفتر للفترة «${p.finance_period.name}» (${p.finance_period.starts_on} — ${p.finance_period.ends_on}) فما ينقبل قيد بتاريخ داخلها، وما تنفتح بعدها إلا بطلب فتح يعتمده شخص ثالث.`:'ما انربطت فترة محاسبية، فما راح ينمنع قيد بتاريخ داخل الشهر.'}`})],
      toPayload:v=>({version:p.version,note:v.note})};
    if(action==='request_reopen')return {title:`طلب فتح إقفال ${p.period_key}`,endpoint:`/close-checklist/periods/${id}/request_reopen`,fields:[
      field('reason','سبب الفتح','textarea',{hint:`يعتمده شخص ثالث مو طالب الفتح ولا معتمد الإقفال، ويبقى الطلب وقراره في السجل.${p.finance_period?' إذا انعتمد تنفتح الفترة المحاسبية معه لين تنقفل من جديد بموعدها.':''}`})],
      toPayload:v=>({version:p.version,reason:v.reason})};
    if(action==='explain_exception'){
      const open=p.checks.checks.find(c=>c.key==='controls').items.filter(i=>i.explainable&&!i.explained);guard(open.length);
      return {title:`تفسير فرق في إقفال ${p.period_key}`,endpoint:`/close-checklist/periods/${id}/explain_exception`,fields:[
        field('item_key','الفرق','select',{options:open.map(i=>({value:i.key,label:i.text}))}),
        field('note','تفسير الفرق زي ما بيقرأه المعتمد','textarea',{hint:'التفسير ينكتب على هالإقفال بمبلغ الفرق نفسه؛ لو تغيّر المبلغ صار بند جديد. واللي يفسّر ما يعتمد الإقفال.'})],
        toPayload:v=>({version:p.version,item_key:v.item_key,note:v.note})};
    }
    return {title:`${closeLabels[action]} — ${p.period_key}`,endpoint:`/close-checklist/periods/${id}/${action}`,fields:[
      field('note','أساس القرار','textarea')],toPayload:v=>({version:p.version,note:v.note})};
  }
};

const accrualLabels={approve_entry:'اعتماد القسط',cancel_entry:'إلغاء القسط',cancel_schedule:'إلغاء الجدول'};
export const accrualsUI={
  title:'الإطفاء والاستحقاقات',
  description:'فاتورة تغطي فترة طويلة يحدد المحاسب فترة إطفائها، وتطلع منها أقساط شهرية قيودها مقترحة تنعتمد شهر بشهر. لا ترحيل آلي: الترحيل يبقى قرار مستقل في الدفتر المالي، واللي أعدّ الجدول ما يعتمد أقساطه.',
  load:api=>api('/accruals'),
  render(data,{e,button,money,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في التسمية، وبعد أول مبلغ في البطاقة.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(String(iso).slice(0,10)))}</time>`:'—';
    // القسط: شهره ومبلغه، ثم تاريخ قيده وحاله، ثم أين وصل قيده. المستحق اعتماده هذا الشهر بعلامة «دورك» لمن يقرّره.
    const entry=s=>en=>`<li class="${en.actions.includes('approve_entry')?'is-decision':en.due?'is-due':en.status==='cancelled'?'is-old':''}">
      <strong><time datetime="${e(en.period_key)}">${e(en.period_key)}</time> — ${fig(en.amount_minor)} ريال</strong>${en.actions.includes('approve_entry')?'<span class="badge is-decision">ينتظر اعتمادك</span>':''}
      <span>تاريخ القيد ${day(en.entry_date)} · ${e(en.status_name)}${en.approved_by_name?` · اعتمده ${e(en.approved_by_name)}`:''}</span>
      <small class="measure">${e(en.posting_note)}</small>
      ${en.actions.length?`<div class="operation-actions">${en.actions.map(a=>button(a,en.id,accrualLabels[a])).join('')}</div>`:''}</li>`;
    // الجدول يُقرأ بما بقي منه، ثم الحسابان مدينًا قبل دائن، ثم أقساطه.
    const schedule=s=>`<details class="vn-card ${s.entries.some(en=>en.actions.includes('approve_entry'))?'is-decision':s.status==='cancelled'?'is-old':''}"${s.entries.some(en=>en.actions.includes('approve_entry'))?' open':''}><summary><span class="vn-code"><bdi dir="ltr">${e(s.source_reference)}</bdi></span><span class="vn-name"><strong>${e(s.description)}</strong><small>${e(s.kind_name)} · ${e(s.status_name)}</small></span><span class="vn-flags"><strong>المتبقي ${fig(s.remaining_minor)} ريال</strong></span></summary><div class="vn-body">
      ${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,accrualLabels[a])).join('')}</div>`:''}
      <dl class="vn-facts"><div><dt>القيمة الكاملة</dt><dd>${fig(s.total_minor)}</dd></div><div><dt>المدة</dt><dd><span data-num>${e(s.months)}</span> شهر، من ${day(s.starts_on)} لين ${day(s.ends_on)}</dd></div><div><dt>مدين</dt><dd>${s.debit_account?`<bdi>${e(s.debit_account.code)}</bdi> ${e(s.debit_account.name)}`:'—'}</dd></div><div><dt>دائن</dt><dd>${s.credit_account?`<bdi>${e(s.credit_account.code)}</bdi> ${e(s.credit_account.name)}`:'—'}</dd></div><div><dt>معتمد لين الحين</dt><dd>${fig(s.approved_minor)}</dd></div><div><dt>المتبقي</dt><dd>${fig(s.remaining_minor)}</dd></div></dl>
      <p class="subtle measure">${e(s.kind_rule)}</p>
      <p class="subtle measure">${e(s.basis)}${s.cancel_reason?` — سبب الإلغاء: ${e(s.cancel_reason)}`:''}</p>
      ${list(s.entries.map(entry(s)),'ما فيه أقساط.')}</div></details>`;
    const due=data.totals.due_entries;
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${button('create_schedule','','جدول إطفاء جديد')}</div><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(num(data.totals.unamortized_minor),'قيمة ما انطفت بالريال')}
        ${ui.tile(due,'قسط مستحق اعتماده',due?'is-due':'')}
        ${ui.tile(data.totals.schedules,'جدول إطفاء')}</div></section>
      ${data.schedules.length?`<section class="vn-group"><h2>جداول الإطفاء <span>${data.schedules.length}</span></h2>${data.schedules.map(schedule).join('')}</section>`
        :ui.empty('ما فيه جداول إطفاء للحين','ابدأ من فاتورة مورد تغطي فترة ممتدة: اشتراك برمجي، إيجار، تأمين.')}`;
  },
  form(action,id,data){
    if(action==='create_schedule')return {title:'جدول إطفاء',endpoint:'/accruals',idempotent:true,fields:[
      field('kind','النوع','select',{options:Object.entries(data.kinds).map(([value,k])=>({value,label:k.name}))}),
      field('invoice_id','فاتورة المورد (اختياري)','select',{required:false,options:[{value:'',label:'— بلا فاتورة مسجلة —'},...data.invoices.map(i=>({value:i.id,label:`${i.supplier_key} / ${i.supplier_reference}`}))]}),
      field('source_reference','مرجع المستند'),
      field('description','وش يغطي المستند','textarea'),
      field('amount','القيمة الكاملة','number'),
      field('starts_on','بداية الفترة','date'),field('ends_on','نهاية الفترة','date'),
      field('debit_account_id','الحساب المدين شهريًا (مصروف)','select',{options:data.accounts.filter(a=>a.account_type==='expense').map(a=>({value:a.id,label:`${a.code} ${a.name}`}))}),
      field('credit_account_id','الحساب الدائن (أصل مدفوع مقدمًا أو التزام مستحق)','select',{options:data.accounts.filter(a=>['asset','liability'].includes(a.account_type)).map(a=>({value:a.id,label:`${a.code} ${a.name} (${a.account_type==='asset'?'أصل':'التزام'})`}))}),
      field('cost_center_id','مركز التكلفة','select',{options:data.cost_centers.map(c=>({value:c.id,label:`${c.code} ${c.name}`}))}),
      field('basis','سند فترة الإطفاء ومين حددها','textarea',{hint:'المنصة ما تستنتج الفترة من الفاتورة؛ اكتب وش يثبتها ومين قررها.'})],
      toPayload:v=>({kind:v.kind,invoice_id:v.invoice_id||null,source_reference:v.source_reference,description:v.description,amount:v.amount,starts_on:v.starts_on,ends_on:v.ends_on,debit_account_id:v.debit_account_id,credit_account_id:v.credit_account_id,cost_center_id:v.cost_center_id,basis:v.basis})};
    const s=data.schedules.find(x=>x.id===id);
    if(s){guard(s.actions.includes(action));
      return {title:`إلغاء الجدول — ${s.description}`,endpoint:`/accruals/${id}/cancel_schedule`,fields:[field('reason','سبب الإلغاء','textarea')],toPayload:v=>({version:s.version,reason:v.reason})};}
    const found=data.schedules.flatMap(x=>x.entries.map(en=>({en,schedule:x}))).find(x=>x.en.id===id);
    guard(found&&found.en.actions.includes(action));
    return {title:`${accrualLabels[action]} — ${found.schedule.description} · ${found.en.period_key}`,endpoint:`/accruals/entries/${id}/${action}`,
      fields:[field('note',action==='approve_entry'?'أساس الاعتماد لهالشهر':'سبب الإلغاء','textarea',{hint:action==='approve_entry'?'الاعتماد معناه «صحيح ومستحق هالشهر»، والترحيل يبقى قيد يدوي في الدفتر المالي.':''})],
      toPayload:v=>({version:found.en.version,note:v.note})};
  }
};
