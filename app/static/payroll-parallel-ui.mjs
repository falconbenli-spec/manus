// المسير الموازي والانتقال إلى المنصة (app/payroll-parallel.mjs، الترحيل 176).
// الترتيب مقصود: ما ينتظر قرارك أولًا، ثم وين وصلنا للانتقال وما الناقص وعند من، ثم الشهور الموازية شهرًا شهرًا بدفعتها ومقارنتها
// وفروقها، ثم قرارات الانتقال السابقة. الأزرار ما تظهر إلا إذا عرضها الخادم، وكل زر يعرضه الخادم له اسم هنا.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const ACTIONS=Object.freeze({declare_parallel_month:'إعلان شهر موازٍ',withdraw_parallel_month:'سحب إعلان الشهر',import_legacy_batch:'استيراد دفعة النظام السابق',
  confirm_legacy_batch:'تأكيد الدفعة',reject_legacy_batch:'رفض الدفعة',withdraw_legacy_batch:'سحب الدفعة',run_parallel_comparison:'مقارنة الشهر',
  explain_parallel_difference:'تفسير الفروق',record_parallel_value:'تسجيل القيمة',approve_parallel_value:'اعتماد القيمة',
  propose_cutover:'اقتراح الانتقال',confirm_cutover:'تأكيد الانتقال',reject_cutover:'رفض الانتقال'});
const COMPARISON_STATES=Object.freeze({current:'قائمة على مدخلات الشهر ودفعته الحالية',stale:'قديمة: تغيّر مدخل بعدها — تنعاد',
  superseded:'على دفعة ما عادت مؤكدة — تنعاد على الحالية',uncomputable:'ما ينحسب الشهر في المنصة الحين'});
const VALUE_FIELD={'payroll.parallel.tolerance':['unexplained_max','أقصى عدد فروق ما تتفسّر في الشهر',0,10000,'الموصى به 0: كل فرق يتفسّر'],
  'payroll.parallel.required_months':['months','عدد الشهور الموازية المتتالية قبل الانتقال',1,12,'الموصى به 3']};
const MONTH_TONE={clean:'is-ok',no_batch:'is-due',batch_unconfirmed:'is-due',no_comparison:'is-due',stale:'is-due',tolerance_unset:'is-due',unexplained:'is-late',uncomputable:'is-late'};

export const payrollParallelUI={
  title:'المسير الموازي والانتقال',
  description:'في الشهر الموازي النظام السابق يدفع، والمنصة تحسب الشهر نفسه وتقارنه بندًا بندًا وموظفًا موظفًا. كل فرق يفسّره شخص ثاني، والدفع من المنصة يبدأ بقرار شخصين.',
  load:api=>api('/payroll-parallel'),
  render(data,{e,button,money,ui,date}){
    const amount=minor=>minor===null||minor===undefined?'—':`<span class="ltr">${e(money(minor))}</span>`;
    const delta=minor=>`<span class="ltr">${minor>0?'+':''}${e(money(minor))}</span>`;
    const monthTag=m=>m?`<time datetime="${e(m)}">${e(m)}</time>`:'—';
    const when=iso=>iso?`<time datetime="${e(iso)}">${e(date(iso))}</time>`:'—';
    const num=n=>`<span data-num>${e(n)}</span>`;
    const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
    // أفعال السجل في منطقة أفعال واحدة. الزر المكرر في كل شهر يحمل شهره في اسمه المسموع.
    const acts=(actions,id,context='')=>{const html=actions.filter(a=>ACTIONS[a]).map(a=>context?named(button(a,id,ACTIONS[a]),`${ACTIONS[a]} — ${context}`):button(a,id,ACTIONS[a])).join('');return html?`<div class="operation-actions">${html}</div>`:'';};
    const scoped=html=>html.replace(/<th>/g,'<th scope="col">');
    const r=data.readiness,values=data.values,months=data.months;

    // ── ما ينتظر قرارك ──
    const mine=[
      ...months.filter(m=>m.batch?.actions.some(a=>a!=='withdraw_legacy_batch')).map(m=>`<li class="is-due" data-id="${e(m.batch.id)}"><strong>دفعة النظام السابق لشهر ${monthTag(m.month)} تنتظر تأكيدك</strong>
        <span>${num(m.batch.headcount)} موظف · المدفوع ${amount(m.batch.paid_minor)} · استوردها ${e(m.batch.imported_by_name)}، ويؤكدها غيره</span>${acts(m.batch.actions.filter(a=>a!=='withdraw_legacy_batch'),m.batch.id,`شهر ${m.month}`)}</li>`),
      ...months.filter(m=>m.comparison?.actions.length).map(m=>`<li class="is-due" data-id="${e(m.comparison.id)}"><strong>فروق شهر ${monthTag(m.month)} تنتظر تفسيرك: ${num(m.comparison.differences.filter(d=>d.actions.length).length)}</strong>
        <span>الفرق اللي سببه المنصة ما يتفسّر: يصحّح مُعد الرواتب مدخله وتنعاد المقارنة.</span>${acts(m.comparison.actions,m.comparison.id,`شهر ${m.month}`)}</li>`),
      ...data.cutovers.filter(c=>c.actions.length).map(c=>`<li class="is-due" data-id="${e(c.id)}"><strong>اقتراح الانتقال إلى المنصة من ${monthTag(c.first_platform_month)}</strong>
        <span>اقترحه ${e(c.proposed_by_name)}، ويؤكده معتمد غيره بعد مراجعة الشهور وفروقها.</span><small class="measure">${e(c.note)}</small>${acts(c.actions,c.id)}</li>`),
      ...[values.tolerance,values.required_months].flatMap(v=>v.pending.filter(p=>p.actions.length).map(p=>`<li class="is-due" data-id="${e(p.id)}"><strong>«${e(v.label)}»: ${e(valueText(v.key,p.value))}</strong>
        <span>سجّلها ${e(p.recorded_by_name)}، وتسري من <time datetime="${e(p.effective_from)}">${e(p.effective_from)}</time> لما تعتمدها.</span>${acts(p.actions,p.id,v.label)}</li>`))];

    // ── وين وصلنا للانتقال ──
    const cleanCount=r.months.filter(m=>m.clean).length;
    const verdict=data.cutover
      ?`<div class="vn-alert is-ok"><strong>المنصة تدفع من ${monthTag(data.cutover.first_platform_month)}</strong><p>آخر شهر دفعه النظام السابق ${monthTag(data.cutover.last_parallel_month)}. الشهور الموازية تبقى سجلّ ما دفعه النظام السابق.</p></div>`
      :r.ready?`<div class="vn-alert is-ok"><strong>جاهز للانتقال: المنصة تبدأ تدفع من ${monthTag(r.first_platform_month)}</strong><p>${num(r.streak.length)} شهور موازية متتالية نظيفة آخرها ${monthTag(r.last_parallel_month)}. الانتقال يقترحه معتمد ويؤكده معتمد ثاني.</p>${acts(data.actions.filter(a=>a==='propose_cutover'),'')}</div>`
      :`<div class="vn-alert is-due"><strong>الانتقال ما جهز: ${num(r.blockers.length)} ناقص</strong><ul class="vn-list">${r.blockers.map(b=>`<li><strong>${e(b.document)}</strong><span>${e(b.why??'')} · عند: ${e(b.owner)}</span></li>`).join('')}</ul></div>`;
    // القيمة وسريانها وحدهما؛ أساس القرار ومن سجّله واعتمده في سجل التدقيق وفي «الخيارات والقيم المعتمدة».
    const valueLine=v=>`<li class="${v.set?'is-ok':'is-due'}"><strong>${e(v.label)}: ${v.set?e(valueText(v.key,v.value)):'ما تحدد'}</strong>
      <span>${v.set?`يسري من <time datetime="${e(v.effective_from)}">${e(v.effective_from)}</time>`:v.source==='adopted'?'القيمة المعتمدة ما تنقرى عددًا في حدّه — تنسجّل من جديد ويعتمدها معتمد ثاني':`ما تقرّر بعد — ${e(VALUE_FIELD[v.key][4])}. يسجّله معتمد المسير ويعتمده معتمد ثاني`}</span>${acts(v.actions,v.key,v.label)}</li>`;
    const readiness=`<section class="vn-block" aria-labelledby="pp-ready"><h2 id="pp-ready">وين وصلنا للانتقال</h2>
      <div class="vn-tiles">${ui.tile(cleanCount,`شهر موازٍ نظيف من ${r.months.length}`,cleanCount&&cleanCount===r.months.length?'is-ok':'')}${ui.tile(values.required_months.set?values.required_months.months:'—','شهور متتالية مطلوبة قبل الانتقال')}${ui.tile(values.tolerance.set?values.tolerance.unexplained_max:'—','حد الفروق اللي ما تتفسّر')}</div>
      ${verdict}<h3>قيمتان يقررهما المالك</h3><ul class="vn-list">${valueLine(values.tolerance)}${valueLine(values.required_months)}</ul></section>`;

    // ── الشهور الموازية ──
    const batchBlock=(m,b)=>{
      const lines=b.lines.length?`<details><summary>سطور الدفعة كما في الكشف (${num(b.lines.length)})</summary>${scoped(ui.table({head:['الموظف','الأساسي','السكن','النقل','بدل آخر','الإضافي','مكافآت','خصم الغياب','التأمينات','السلف','خصومات أخرى','الصافي المدفوع'],
        rows:b.lines.map(l=>`<tr><td>${e(l.employee_name)}</td>${['basic','housing','transport','other_allowance','overtime','other_additions','absence_deduction','gosi_employee','advance','other_deductions','net'].map(k=>`<td>${amount(l[k])}</td>`).join('')}</tr>`)}))}</details>`:'';
      return `<div class="pp-batch"><p>${ui.statusBadge(b.status,{module:'legacy_batch'})} · ${num(b.headcount)} موظف · الإجمالي ${amount(b.gross_minor)} · الخصوم ${amount(b.deductions_minor)} · المدفوع في ملف البنك ${amount(b.paid_minor)}${b.employer_share_included?' · ومعه حصة المنشأة في التأمينات':''}</p>
        <p class="subtle measure">${e(b.source_note)}</p>
        <p class="subtle">بصمة الكشف <bdi>${e(String(b.breakdown_digest).slice(0,12))}</bdi> · بصمة ملف البنك <bdi>${e(String(b.bank_digest).slice(0,12))}</bdi></p>
        <p class="subtle">${b.status==='imported'?`استوردها ${e(b.imported_by_name)} ${when(b.imported_at)}، وتنتظر تأكيد شخص ثاني`:`أكّدها ${e(b.decided_by_name)} ${when(b.decided_at)}`}</p>
        ${lines}${acts(b.actions.filter(a=>a==='withdraw_legacy_batch'),b.id,`شهر ${m.month}`)}</div>`;
    };
    const differencesTable=c=>scoped(ui.table({head:['الموظف','البند','النظام السابق','المنصة','الفرق: المنصة ناقص النظام السابق','التفسير'],
      rows:c.differences.map(d=>`<tr data-id="${e(d.id)}"><td>${e(d.employee_name)}</td><td>${e(d.component_name)}</td><td>${amount(d.legacy_minor)}</td><td>${amount(d.platform_minor)}</td><td>${delta(d.delta_minor)}</td>
        <td>${d.explanation?`<span class="badge approved">مفسّر</span> ${e(d.explanation.cause_name)}<small class="subtle measure">${e(d.explanation.note)}</small>`:'<span class="badge pending">ما تفسّر</span>'}</td></tr>`),
      empty:{title:'ما فيه فرق: المنصة والنظام السابق متطابقين بندًا بندًا',body:'كل موظف في الجهتين، وكل بند بنفس المبلغ.'}}));
    const comparisonBlock=(m,c)=>`<div class="pp-comparison"><h4>المقارنة ${when(c.compared_at)}</h4>
      <p>${e(COMPARISON_STATES[c.state]??c.state)}${c.changed.length?`: ${e(c.changed.map(x=>x.name).join('، '))}`:''}${c.problem?` — ${e(c.problem)}`:''}</p>
      <p class="subtle">النظام السابق دفع ${amount(c.legacy_net_minor)} لـ${num(c.legacy_headcount)} موظف · المنصة تحسب ${amount(c.platform_net_minor)} لـ${num(c.platform_headcount)} · ${num(c.difference_count)} فرق، ${num(c.unexplained)} منها ما تفسّر</p>
      ${differencesTable(c)}${acts(c.actions,c.id,`شهر ${m.month}`)}</div>`;
    const monthBlock=m=>`<article class="vn-block ${MONTH_TONE[m.state]??''}" data-id="${e(m.id)}"><h3>شهر ${monthTag(m.month)}</h3>
      <p><strong>${e(m.state_name)}</strong></p><p class="subtle measure">${e(m.basis)}</p>
      ${m.batch?batchBlock(m,m.batch):'<p class="subtle">ما انستوردت دفعة النظام السابق لهالشهر للحين: الكشف التفصيلي وملف البنك المدفوع.</p>'}
      ${m.comparison?comparisonBlock(m,m.comparison):m.batch?.status==='confirmed'?'<p class="subtle">الدفعة مؤكدة وما انقارن الشهر للحين.</p>':''}
      ${m.batch_history.length?`<details><summary>دفعات سابقة ما عادت تُقاس عليها (${num(m.batch_history.length)})</summary><ul class="vn-list">${m.batch_history.map(b=>`<li><strong>${ui.statusBadge(b.status,{module:'legacy_batch'})} ${num(b.headcount)} موظف · ${amount(b.paid_minor)}</strong><small class="measure">${e(b.withdrawal_note??b.decision_note??'')}</small></li>`).join('')}</ul></details>`:''}
      ${acts(m.actions,m.id,`شهر ${m.month}`)}</article>`;
    const history=data.cutovers.filter(c=>!c.actions.length);
    return `<section class="panel panel-body vn-head"><p class="measure">${e(data.note)}</p>${acts(data.actions.filter(a=>a==='declare_parallel_month'),'')}</section>
      ${mine.length?`<section class="vn-block" aria-labelledby="pp-mine"><h2 id="pp-mine">ينتظر قرارك</h2><ul class="vn-list">${mine.join('')}</ul></section>`:''}
      ${readiness}
      <section class="vn-block" aria-labelledby="pp-months"><h2 id="pp-months">الشهور الموازية</h2>${months.length?months.map(monthBlock).join('')
        :ui.empty('ما فيه شهر موازٍ للحين','يعلنه معتمد المسير: الشهر اللي يدفعه النظام السابق، والمنصة تحسبه وتقارنه بدفعته.')}</section>
      ${history.length||data.withdrawn.length?`<section class="vn-block" aria-labelledby="pp-history"><h2 id="pp-history">قرارات سابقة</h2><ul class="vn-list">
        ${history.map(c=>`<li><strong>الانتقال من ${monthTag(c.first_platform_month)} ${ui.statusBadge(c.status,{module:'cutover'})}</strong><span>${c.decided_by_name?`${c.status==='confirmed'?'أكّده':'رفضه'} ${e(c.decided_by_name)} ${when(c.decided_at)}`:''}</span><small class="measure">${e(c.decision_note??c.note)}</small></li>`).join('')}
        ${data.withdrawn.map(m=>`<li><strong>شهر ${monthTag(m.month)} ${ui.statusBadge(m.status,{module:'parallel_month'})}</strong><small class="measure">${e(m.withdrawal_note??'')}</small></li>`).join('')}</ul></section>`:''}`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    const month=data.months.find(m=>m.id===id),batch=data.months.map(m=>m.batch).find(b=>b?.id===id),comparison=data.months.map(m=>m.comparison).find(c=>c?.id===id);
    const cutover=data.cutovers.find(c=>c.id===id),note=label=>[field('note',label,'textarea')];
    if(action==='declare_parallel_month'){guard(data.actions.includes(action));
      return {title:'إعلان شهر موازٍ',endpoint:'/payroll-parallel/months',idempotent:true,fields:[field('month','الشهر','month',{value:data.today.slice(0,7)}),
        field('basis','سند الإعلان','textarea',{hint:'في الشهر الموازي النظام السابق يدفع، والمنصة ما تدفع ولا تصدّر ملف حماية الأجور ولا تقيّد مسيره ولا تعرض قسيمته.'})],toPayload:v=>v};}
    if(action==='withdraw_parallel_month'){guard(month?.actions.includes(action));
      return {title:`سحب إعلان شهر ${month.month}`,endpoint:`/payroll-parallel/months/${id}/withdraw`,fields:note('سبب السحب'),toPayload:v=>({...v,version:month.version})};}
    if(action==='import_legacy_batch'){guard(month?.actions.includes(action));
      return {title:`دفعة النظام السابق لشهر ${month.month}`,endpoint:'/payroll-parallel/batches',idempotent:true,fields:[
        field('breakdown_csv','الكشف التفصيلي (CSV أو ملصوق من الجدول)','textarea',{maxLength:1500000,hint:`سطر العناوين: ${data.csv.breakdown} — و${data.csv.optional} اختياري. employee اسم دخول الموظف في المنصة، والخصم يُكتب موجبًا في عموده.`}),
        field('bank_csv','ملف البنك المدفوع (CSV أو ملصوق من الجدول)','textarea',{maxLength:1500000,hint:`فيه ${data.csv.bank} على الأقل. باقي أعمدة البنك (الآيبان وغيره) تُترك ولا تنحفظ؛ الملف نفسه ما ينحفظ، بصمته بس.`}),
        field('source_note','وش الملفان ومن وين انأخذا','textarea')],toPayload:v=>({...v,month:month.month})};}
    if(['confirm_legacy_batch','reject_legacy_batch','withdraw_legacy_batch'].includes(action)){guard(batch?.actions.includes(action));
      const step=action.split('_')[0],labels={confirm:'وش اللي طابقته (مجموع ملف البنك مع كشف الحساب)',reject:'سبب الرفض',withdraw:'سبب سحب الدفعة المؤكدة'};
      return {title:`${ACTIONS[action]} — شهر ${batch.month}`,endpoint:`/payroll-parallel/batches/${id}/${step}`,fields:note(labels[step]),toPayload:v=>({...v,version:batch.version})};}
    if(action==='run_parallel_comparison'){guard(month?.actions.includes(action));
      return {title:`مقارنة شهر ${month.month}`,endpoint:'/payroll-parallel/comparisons',idempotent:true,fields:[],toPayload:()=>({month:month.month})};}
    if(action==='explain_parallel_difference'){guard(comparison?.actions.includes(action));
      const open=comparison.differences.filter(d=>d.actions.includes(action));
      return {title:'تفسير فروق المسير الموازي',endpoint:`/payroll-parallel/comparisons/${id}/explain`,fields:[
        field('difference_ids','الفروق اللي تفسّرها بنفس السبب','checks',{options:open.map(d=>({value:d.id,label:`${d.employee_name} — ${d.component_name}: النظام السابق ${(d.legacy_minor??0)/100} والمنصة ${(d.platform_minor??0)/100}`}))}),
        field('cause','السبب','select',{options:data.causes}),
        field('note','التفسير وما يترتب عليه','textarea',{hint:'الفرق اللي سببه المنصة ما يتفسّر هنا: يصحّح مُعد الرواتب مدخله أو قاعدته وتنعاد المقارنة.'})],toPayload:v=>v};}
    if(action==='record_parallel_value'){const v=data.values.tolerance.key===id?data.values.tolerance:data.values.required_months.key===id?data.values.required_months:null;guard(v?.actions.includes(action));
      const [key,label,min,max,hint]=VALUE_FIELD[id];
      return {title:`قرار: ${v.label}`,endpoint:`/options/adoptions/${id}/record`,fields:[field('value',label,'number',{min,max,step:1,hint}),
        field('basis','أساس القرار ومصدره','textarea',{hint:'ينحفظ مع القرار ويشوفه اللي يعتمده.'}),field('effective_from','يسري من','date',{value:data.today})],
        toPayload:x=>({value:{[key]:Number(x.value)},basis:x.basis,effective_from:x.effective_from})};}
    if(action==='approve_parallel_value'){const v=[data.values.tolerance,data.values.required_months].find(x=>x.pending.some(p=>p.id===id)),p=v?.pending.find(x=>x.id===id);guard(p?.actions.includes(action));
      return {title:`اعتماد: ${v.label}`,endpoint:`/options/adoptions/${v.key}/approve`,fields:[field('note','أساس الاعتماد','textarea',{hint:`القيمة المسجّلة: ${valueText(v.key,p.value)}. اعتمادك يخليها تسري.`})],toPayload:x=>({adoption_id:id,note:x.note})};}
    if(action==='propose_cutover'){guard(data.actions.includes(action));
      return {title:`الانتقال إلى المنصة من ${data.readiness.first_platform_month}`,endpoint:'/payroll-parallel/cutovers',idempotent:true,fields:note('سند الانتقال'),toPayload:v=>v};}
    if(['confirm_cutover','reject_cutover'].includes(action)){guard(cutover?.actions.includes(action));
      return {title:`${ACTIONS[action]} — من ${cutover.first_platform_month}`,endpoint:`/payroll-parallel/cutovers/${id}/${action.split('_')[0]}`,
        fields:note(action==='confirm_cutover'?'وش اللي راجعته قبل التأكيد':'سبب الرفض'),toPayload:v=>({...v,version:cutover.version})};}
    throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};
// القيمة كما تُقرأ: «0 فرق» و«3 شهور»، أو «ما تحدد».
function valueText(key,value){
  const [prop]=VALUE_FIELD[key]??[];const n=value&&typeof value==='object'?value[prop]:null;
  if(n===null||n===undefined||n==='')return 'ما تحدد';
  return key==='payroll.parallel.tolerance'?`${n} فرق`:`${n} شهور`;
}
