// حالات التأمينات الاجتماعية: ما تُخصمه المنصة من كل موظف ولماذا، ومن بقي بلا حالة.
// الحالة مشتقة من الجنسية وتاريخ المباشرة ولا تُكتب بيد أحد؛ ما يُسجَّل هنا استثناءان لا يعرفهما النظام من نفسه.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const labels={record_prior_contribution_period:'تسجيل: له مدة اشتراك سابقة',record_gcc_national:'تسجيل: مواطن خليجي',record_not_gcc_national:'تسجيل: ليس مواطنًا خليجيًا',withdraw_override:'سحب الاستثناء'};
const pct=bp=>`${(bp/100).toFixed(2)}%`;
// أسماء بنود الأجر الخاضع كما في قاموس بنود الراتب (app/hr-contracts.mjs PAY_COMPONENTS)، بدل مفاتيحها الإنجليزية.
const wageParts={basic:'الراتب الأساسي',housing:'بدل سكن',transport:'بدل نقل',other_allowance:'بدل آخر'};
// المبلغ في البلاطة: ريالات كاملة بلا هللات حين لا هللات فيه، والعملة في تسمية البلاطة؛ رقم قصير لا ينكسر وسطه على الجوال.
const riyals=minor=>{const n=Number(minor)/100;return n.toLocaleString('en-US',Number.isInteger(n)?{maximumFractionDigits:0}:{minimumFractionDigits:2,maximumFractionDigits:2});};

export const payrollInsuranceUI={
  title:'حالات التأمينات',
  description:'خصم التأمينات بحسب حالة كل موظف: سعودي على النظام السابق، أو سعودي مشترك جديد بنسبة تزيد كل سنة، أو غير سعودي ما ينخصم منه شي. الحالة تطلع من الجنسية وتاريخ المباشرة، واللي ناقص ما ينخمّن.',
  load:api=>api('/payroll-insurance'),
  render(data,{e,button,money,ui}){
    const {tile,table,empty}=ui;
    const r=data.rule;
    // المبلغ معزول الاتجاه بأرقام جدولية، والتاريخ بوسم time، والعدد في جملة بـdata-num.
    const amount=minor=>`<span class="ltr">${e(money(minor))}</span>`;
    const dateTag=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
    const count=n=>`<span data-num>${e(n)}</span>`;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="vn-tiles">${tile(data.rows.length,'موظف في الكيان')}${tile(data.unresolved,'بلا حالة محسومة',data.unresolved?'is-block':'is-ok')}${tile(r?r.effective_from:'—','القاعدة سارية من')}${tile(r?riyals(r.max_wage_minor):'—','الحد الأعلى للأجر الخاضع بالريال')}</div></section>`;
    const unresolved=data.unresolved?`<div class="vn-alert is-block"><strong>${count(data.unresolved)} موظف ما له حالة تأمينات محسومة</strong><p>سطورهم في المسير تطلع «غير متاح» مو صفر، وما ينعتمد مسير فيه أحدهم. كمّل الجنسية وتاريخ المباشرة في ملف الموظف، أو سجّل استثناءه هنا.</p></div>`:'';
    // غير سعودي لم يُسأل عنه سؤال الخليج: حالته تُشتق ويُحتسب سطره، ولا يُعتمد مسيره قبل الجواب.
    const unanswered=data.unanswered?`<div class="vn-alert is-block"><strong>${count(data.unanswered)} موظف غير سعودي ما له جواب عن «هل هو مواطن خليجي؟»</strong><p>ما ينعتمد مسير يضمّه قبل الجواب: «نعم» يوقف مسيره لين يتقرر أمره، و«لا» ينسجّل جواب بسنده. والجواب يتسجّل من هنا أو مع الجنسية في ملف الموظف.</p></div>`:'';
    // القاعدة غير المقبولة تنبيهٌ للشاشة كلها فتأتي مع التنبيهات فوق؛ والقاعدة المقبولة مرجعٌ يأتي بعد الموظفين.
    const ruleAlert=r?'':`<div class="vn-alert is-due"><strong>قاعدة التأمينات بالحالة ما انقبلت للحين.</strong><p>لين يقبلها مدير الموارد البشرية من شاشة «قواعد اللائحة في الرواتب» يبقى المطبَّق نسبة واحدة من سياسة دورة الرواتب على كل موظف، وحصة المنشأة ما تنحسب.</p></div>`;
    const ruleBlock=r?`<section class="vn-block"><h2>القاعدة المقبولة</h2>
      <dl class="vn-facts"><div><dt>العنوان</dt><dd>${e(r.title)}</dd></div><div><dt>المواد</dt><dd>${e(r.articles.join('، '))}</dd></div>
      <div><dt>الأجر الخاضع</dt><dd>${r.wage_components.map(k=>wageParts[k]?e(wageParts[k]):`<bdi>${e(k)}</bdi>`).join('، ')}</dd></div>
      <div><dt>الحد الأدنى (معاشات / أخطار مهنية)</dt><dd>${amount(r.floors_minor.annuities)} · ${amount(r.floors_minor.hazards_only)}</dd></div>
      <div><dt>مقسوم شهر الالتحاق والترك</dt><dd>${e(r.partial_month_basis==='thirty'?'أيام الخدمة ÷ 30':r.partial_month_basis==='calendar'?'أيام الخدمة ÷ أيام الشهر':'ما انحسم للحين')}</dd></div></dl>
      <h3>نسبة كل حالة من تاريخ سريانها</h3>
      ${table({head:['الحالة','سارية من','نسبة الموظف','نسبة المنشأة','السند'],rows:Object.entries(r.cases).flatMap(([key,c])=>c.schedule.map(s=>
        `<tr><td>${e(c.name)}</td><td>${dateTag(s.from)}</td><td>${e(pct(s.employee_bp))}</td><td>${e(pct(s.employer_bp))}</td><td><small>${e(s.note||c.article)}</small></td></tr>`)),empty:'ما فيه درجات في القاعدة'})}
      <p class="subtle">المصدر: ${e(r.source)}</p>
      ${r.open_questions.length?`<details><summary>أسئلة مفتوحة ما انحسمت ولا انطبّقت (${count(r.open_questions.length)})</summary><ul class="vn-list">${r.open_questions.map(q=>`<li><span>${e(q)}</span></li>`).join('')}</ul></details>`:''}</section>`:'';
    const personRow=p=>`<tr><td><strong>${e(p.name)}</strong>${p.note?`<small>${e(p.note)}</small>`:''}${p.derived_from?`<small>مباشرة ${dateTag(p.derived_from.start_date)}</small>`:''}</td>
      <td>${p.available?e(p.case_name):`<span class="vn-flag is-block">غير متاح</span>`}</td>
      <td>${p.employee_bp===null?'—':e(pct(p.employee_bp))}</td>
      <td>${p.employer_bp===null?'—':e(pct(p.employer_bp))}</td>
      <td>${p.available?'':`<small>${e(p.missing.length?p.missing.map(m=>`${m.document} — ${m.owner}`).join('؛ '):p.note||'ما فيه نسبة سارية لحالته')}</small>`}
        ${(p.needs||[]).map(m=>`<small class="vn-flag is-block">${e(m.document)}</small>`).join('')}
        ${p.overrides.filter(o=>!o.withdrawn).map(o=>`<small>${e(o.kind_name)} — ${dateTag(o.effective_from)} · ${e(o.recorded_by_name)}</small>`).join('')}</td>
      <td><div class="operation-actions">${[...p.actions.map(a=>button(a,p.user_id,labels[a])),
        ...p.overrides.filter(o=>o.actions.includes('withdraw_override')).map(o=>button('withdraw_override',o.id,labels.withdraw_override))].join('')}</div></td></tr>`;
    const people=data.rows.length?table({head:['الموظف','الحالة','نسبة الموظف','نسبة المنشأة','السند أو الناقص','إجراءات'],rows:data.rows.map(personRow)})
      :empty('ما فيه موظفين في هالكيان','حالة التأمينات تنحسب أول ما يكون فيه موظف بعقد معتمد.');
    // الموظفون أولًا: هم ما تُفتح الشاشة لأجله (من بلا حالة، وما يُسجَّل له)، والقاعدة المقبولة مرجعٌ بعدهم.
    return `${head}${unresolved}${unanswered}${ruleAlert}<section class="vn-board">
      <section class="vn-block"><h2>الموظفون ${count(data.rows.length)}</h2>${people}
      <p class="subtle">${e(data.gcc_note)}</p>
      <p class="subtle">الحالة تكشف جنسية الموظف، فما يشوفها إلا اللي يشوف بيانات القوى العاملة أو عنده تصريح رواتب. والمدير المباشر ما يشوفها.</p></section>
      ${ruleBlock}</section>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='withdraw_override'){
      const owner=data.rows.find(p=>p.overrides.some(o=>o.id===id&&o.actions.includes('withdraw_override')));guard(owner);
      const row=owner.overrides.find(o=>o.id===id);
      return {title:`سحب استثناء «${row.kind_name}» — ${owner.name}`,endpoint:`/payroll-insurance/overrides/${id}/withdraw_override`,
        fields:[field('reason','سبب السحب ووش اللي تبيّن','textarea')],toPayload:v=>({reason:v.reason})};
    }
    const person=data.rows.find(p=>p.user_id===id);guard(person&&person.actions.includes(action));
    const kind=action.replace('record_','');
    const basisLabel={prior_contribution_period:'الوثيقة اللي تثبت مدة الاشتراك السابقة (نوعها وتاريخها، بدون أي رقم)',
      gcc_national:'الوثيقة اللي تثبت جنسيته الخليجية (نوعها وتاريخها، بدون أي رقم)',
      not_gcc_national:'الوثيقة اللي اطلعت عليها وأثبتت إنه مو من مواطني دول مجلس التعاون (نوعها وتاريخها، بدون أي رقم)'}[kind];
    return {title:`${labels[action]} — ${person.name}`,endpoint:`/payroll-insurance/employees/${id}/${action}`,idempotent:true,
      fields:[field('effective_from','سريان الاستثناء من','date',{value:data.today}),field('basis',basisLabel,'textarea')],
      toPayload:v=>({effective_from:v.effective_from,basis:v.basis})};
  }
};
