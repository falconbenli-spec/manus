// مسير الرواتب وقسائمها. المسير لحاملي تصريحه الصريح؛ القسيمة لصاحبها بعد الاعتماد فقط.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const labels={recalculate:'إعادة الاحتساب',submit_run:'تقديم للمراجعة',cancel_run:'إلغاء المسودة',justify:'تبرير فرق',pass_review:'اجتياز المراجعة',return_run:'إعادة للمُعد',approve_run:'اعتماد المسير وقفله',price_leave_effect:'تسعير خصم إجازة',
  propose_early_pay:'اقتراح صرف مبكر',confirm_early_pay:'تأكيد الصرف المبكر',reject_early_pay:'رفض الصرف المبكر',withdraw_early_pay:'سحب الصرف المبكر المؤكد',
  // عكس المسير المعتمد قبل صرفه (الحزمة 4، الترحيل 175).
  request_run_reversal:'طلب عكس المسير',approve_run_reversal:'اعتماد العكس',reject_run_reversal:'رفض العكس'};
// أجزاء مدخلات المسير بأسمائها القصيرة (P4-HR-2، الترحيل 173). ما تغيّر منها بعد الاحتساب يُسمّى بالاسم، وما لا تعرفه الشاشة يُقرأ باسم الخادم.
const inputParts={absences:'الغياب',adjustments:'حركات الراتب',leave_effects:'أثر الإجازات',benefits:'المزايا',contracts:'العقود',rules:'قواعد التأمينات'};
// ما يمتنع والمدخلات تغيّرت بعد الاحتساب (inputs_changed): التقديم والمراجعة والاعتماد. لا يُرسم زرٌّ يُرفض حتمًا؛ الشريط يقول لماذا وما التالي.
const NEEDS_CURRENT_INPUTS=['submit_run','pass_review','approve_run'];

export const payrollUI={
  title:'الرواتب والقسائم',description:'قسيمتك تطلع هنا أول ما يُعتمد مسير الشهر، وما يشوفها غيرك. والمسير ينحسب من العقود السارية والحضور المعتمد ويمر على مُعد ومراجع ومعتمد، والتحويل من بنك الشركة.',
  load:api=>api('/payroll'),
  render(data,{e,button,money,ui}){
    const component=key=>data.pay_components.find(c=>c.key===key)?.name??key,staff=data.permissions.length>0;
    // م0 «السور»: tile وempty من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية.
    const {tile,empty}=ui;
    // المبلغ معزول الاتجاه بأرقام جدولية (.ltr)، والإشارة داخله فلا تنفصل عن رقمها. يُعزل في الخلية أيضًا: عمود فيه مبلغ بإشارة
    // ومبلغ بلا إشارة يبقى ترتيبه «المبلغ SAR» واحدًا لا ينقلب بينهما.
    const amount=(minor,sign='')=>`<span class="ltr">${sign}${e(money(minor))}</span>`;
    // التاريخ والشهر بوسم time (أرقام جدولية، والقيمة الآلية في datetime)، والعدد في جملة بـdata-num.
    const dateTag=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
    const monthTag=m=>`<time datetime="${e(m)}">${e(m)}</time>`;
    const count=n=>`<span data-num>${e(n)}</span>`;
    // سند خصم التأمينات في سطر القسيمة: النسبة من الأجر الخاضع، وسبب الفرق إن حُصر الخصم أو قُرّب.
    const insuranceBasis=i=>i?.method==='per_case'?`<span class="ltr">${e((i.employee_bp/100).toFixed(2))}%</span> من أجر خاضع ${amount(i.contributory_wage_minor)}${i.capped_by_net?`، والمستحق ${amount(i.employee_uncapped_minor)} حُصر بما تبقى من أجرك بعد الغياب غير المدفوع`:i.employee_minor!==i.employee_uncapped_minor?'، مقرَّبًا إلى الريال الأعلى (م50/5)':''}`:'';
    const slip=(s,open)=>`<details class="vn-card" data-payslip="${e(s.id)}"${open?' open':''}><summary><span class="vn-code">${e(s.month)}</span><span class="vn-name"><strong>قسيمة راتب ${monthTag(s.month)}</strong><small>انعتمد المسير في ${dateTag(s.approved_at)}</small></span><span class="vn-flags"><span class="vn-flag is-ok">الصافي ${amount(s.net_minor)}</span></span></summary><div class="vn-body">
      <div class="table-wrap"><table><thead><tr><th>البند</th><th>الشهري في العقد</th><th>مستحق هذا الشهر</th></tr></thead><tbody>${s.earnings.map(l=>`<tr><td>${e(component(l.component))}</td><td>${amount(l.monthly_minor)}</td><td>${amount(l.amount_minor)}</td></tr>`).join('')}<tr><td><strong>إجمالي الاستحقاق</strong></td><td></td><td><strong>${amount(s.gross_minor)}</strong></td></tr>${(s.adjustments||[]).map(a=>`<tr><td>${e(a.kind_name)} — ${e(a.reason)}</td><td></td><td>${amount(a.amount_minor,['deduction','advance_installment'].includes(a.kind)?'− ':'+ ')}</td></tr>`).join('')}<tr><td>غياب غير مدفوع معتمد</td><td></td><td>${amount(s.unpaid_absence_minor,'− ')}</td></tr><tr><td>استقطاع التأمينات (حصة الموظف)${s.basis.insurance?.case_name?` — ${e(s.basis.insurance.case_name)}`:''}</td><td>${insuranceBasis(s.basis.insurance)}</td><td>${amount(s.social_insurance_minor,'− ')}</td></tr><tr><td><strong>الصافي</strong></td><td></td><td><strong>${amount(s.net_minor)}</strong></td></tr></tbody></table></div>
      <p class="subtle measure">${e(s.basis.parts[0].rule)}${s.basis.parts.some(p=>p.unpaid_dates.length)?` أيام الغياب المعتمدة: ${s.basis.parts.flatMap(p=>p.unpaid_dates).map(dateTag).join('، ')}.`:''}</p><p class="subtle">عندك استفسار أو اعتراض؟ ارفعه من خدمة «استفسار أو تصحيح في الراتب».</p><div class="operation-actions"><a class="btn outline small" href="/api/payroll/payslips/${e(s.id)}/print" target="_blank" rel="noopener">فتح القسيمة كمستند<span class="sr-only"> (تنفتح في تبويب جديد)</span></a></div></div></details>`;
    const slips=data.payslips.length?`<section class="vn-group"><h2>قسائمي ${count(data.payslips.length)}</h2>${data.payslips.map((s,i)=>slip(s,i===0&&!staff)).join('')}</section>`:'';
    // D-15: تسوية نهاية الخدمة لصاحبها: المكافأة، وقراءة م36/2 المطبقة، وبدل الإجازة، والمحسوم، والصافي، والمهلة وعدّادها.
    const st=data.settlement;
    const settlement=st?`<section class="vn-group"><h2>تسوية نهاية خدمتي</h2><details class="vn-card" open><summary><span class="vn-code">${e(st.service_end)}</span><span class="vn-name"><strong>تسوية نهاية الخدمة — ${e(st.end_reason_name)}</strong><small>مدة الخدمة ${count(st.service_days)} يوم (${count(st.completed_years)} سنة كاملة) · انعتمدت في ${dateTag(st.decided_at)}</small></span><span class="vn-flags"><span class="vn-flag is-ok">الصافي ${amount(st.net_minor)}</span>${st.countdown?`<span class="vn-flag ${st.countdown.state==='overdue'?'is-block':st.countdown.state==='paid'?'is-ok':'is-due'}">${e(st.countdown.label)}</span>`:''}</span></summary><div class="vn-body">
      <div class="table-wrap"><table><thead><tr><th>البند</th><th>الأساس</th><th>المبلغ</th></tr></thead><tbody>
      <tr><td>مكافأة نهاية الخدمة</td><td>${e(st.art36_reading_name??'قراءة م36/2 ما انختارت للحين')}</td><td>${amount(st.award_minor)}</td></tr>
      <tr><td>بدل رصيد الإجازة</td><td>${e(st.leave_days)} يوم مستحق</td><td>${amount(st.leave_payout_minor)}</td></tr>
      ${st.deductions.map(d=>`<tr><td>${e(d.name)}</td><td>محسوم من المستحق</td><td>${amount(d.amount_minor,'− ')}</td></tr>`).join('')}
      <tr><td><strong>الصافي المستحق</strong></td><td></td><td><strong>${amount(st.net_minor)}</strong></td></tr></tbody></table></div>
      ${st.art36_readings?.readings_differ?`<p class="subtle measure">للمادة 36/2 قراءتان: القراءة الحرفية ${amount(st.art36_readings.literal_award_minor)} وقراءة نظام العمل ${amount(st.art36_readings.labor_law_award_minor)}. والمطبّقة عليك ${e(st.art36_reading_name??'—')} بحسب سياسة المخالصة.</p>`:''}
      ${st.art36_note?`<div class="vn-alert"><p>${e(st.art36_note)}</p></div>`:''}
      <dl class="vn-facts"><div><dt>المهلة النظامية للصرف (م50/2)</dt><dd>${dateTag(st.dues_due_on)}</dd></div><div><dt>حالة الصرف</dt><dd>${st.dues_paid_on?`انصرفت في ${dateTag(st.dues_paid_on)}`:'ما انسجّل الصرف للحين'}</dd></div></dl>
      <p class="subtle">${e(st.note)}</p><p class="subtle">${e(st.legal_note)}</p></div></details></section>`:'';
    // م51: خصومات مقترحة من أجري تنتظر موافقتي الخطية. الموافقة بهويتي من هنا (consent_deduction)، ولا تُعتمد الحركة قبلها.
    const consents=(data.deduction_consents??[]).length?`<section class="vn-group"><h2>خصومات تنتظر موافقتي ${count(data.deduction_consents.length)}</h2>${data.deduction_consents.map(d=>`<details class="vn-card" open><summary><span class="vn-code">${e(d.month)}</span><span class="vn-name"><strong>خصم مقترح ${amount(d.amount_minor)}</strong><small>اقترحه ${e(d.proposed_by_name)} · ${e(d.reason)}</small></span></summary><div class="vn-body"><p class="measure">${e(d.consent_text)}</p><p class="subtle">${e(d.note)}</p><div class="operation-actions">${button('consent_deduction',d.id,'أقرّ الموافقة بهويتي')}</div></div></details>`).join('')}</section>`:'';
    if(!staff){
      // الموظف يفتح الشاشة لنفسه: ما ينتظر موافقته أولًا، ثم تسويته إن وُجدت، ثم قسائمه. وشاشة بلا شيء تقول متى تطلع القسيمة.
      if(!consents&&!settlement&&!slips)return empty('ما فيه قسيمة معتمدة لك للحين','قسيمتك تطلع هنا أول ما يُعتمد مسير الشهر، وما يشوفها غيرك.');
      return `${consents}${settlement}${slips||'<section class="vn-group"><h2>قسائمي</h2><p class="subtle">ما فيه قسيمة معتمدة لك للحين — تطلع هنا أول ما يُعتمد مسير الشهر.</p></section>'}`;
    }
    // التأمينات في المسير: على أي أساس حُسبت، ومن بقي بلا حالة. صفر في عمود التأمينات لا يُقرأ «لا يُخصم منه»
    // ما لم يكن كذلك فعلًا، ولذلك يظهر «غير متاح» لمن لا حالة له، ويظهر هذا البند فوق الجدول.
    const caseOf=l=>{const i=l.basis.insurance;return i?.case_name?`<small>${e(i.case_name)}${i.employee_bp!==undefined&&i.method==='per_case'?` · ${e((i.employee_bp/100).toFixed(2))}%`:''}</small>`:'';};
    const gapList=(rows,title,hint)=>`<div class="vn-alert is-block"><strong>${count(rows.length)} ${e(title)}</strong>
        <ul>${rows.map(m=>`<li>${e(m.name)} — ${e(m.missing.map(x=>`${x.document} (${x.owner})`).join('؛ '))}</li>`).join('')}</ul>
        <p class="subtle">${e(hint)}</p></div>`;
    const ins=r=>{const i=r.insurance;if(!i)return '';
      if(!i.rule_accepted)return `<div class="vn-alert"><strong>خصم التأمينات بحسب الحالة ما سرى على هالشهر</strong><p>${e(i.note)}</p></div>`;
      // ما حُصر خصمه بما تبقى من الأجر: المنشأة تبقى مدينة للمؤسسة بالفرق، فيُقال قبل الاعتماد لا بعده.
      const capped=(i.capped||[]).length?`<div class="vn-alert"><strong>${count(i.capped.length)} موظف انحصرت حصته بما تبقى من أجره بعد الغياب غير المدفوع</strong>
        <ul>${i.capped.map(c=>`<li>${e(c.name)} — المستحق ${amount(c.due_minor)} والمخصوم ${amount(c.deducted_minor)}، والفرق ${amount(c.shortfall_minor)}</li>`).join('')}</ul>
        <p class="subtle">ما يُحسم من أجر ما انصرف (م19/4)، والاشتراك يستمر على الأجر المسجَّل: الفرق ${amount(i.capped_shortfall_minor)} يبقى على المنشأة للمؤسسة، واسترداده من الموظف قرار مستقل.</p></div>`:'';
      if(i.missing.length)return gapList(i.missing,'موظف ما له حالة تأمينات — ما يتقدّم المسير ولا ينعتمد قبل ما تنحسم','تنحسم من شاشة «حالات التأمينات» أو بإكمال ملف الموظف، وبعدها أعد احتساب المسودة.')+capped;
      if((i.unanswered||[]).length)return gapList(i.unanswered,'موظف غير سعودي ما له جواب عن سؤال مواطني دول مجلس التعاون','سجّل الجواب مع الجنسية في ملف الموظف أو من شاشة «حالات التأمينات»، وبعدها أعد احتساب المسودة.')+capped;
      // سطر حُسب بقاعدة غير التي تحكم الشهر الآن: الشاشة لا تقول «الخصم بالحالة» وأرقامه من نسبة أخرى.
      if((i.stale||[]).length)return `<div class="vn-alert is-block"><strong>${count(i.stale.length)} سطر انحسب على غير القاعدة اللي تحكم هالشهر الحين — أعد الاحتساب قبل التقديم</strong>
        <ul>${i.stale.map(s=>`<li>${e(s.name)} — محسوب على «${e(s.recorded)}» والقاعدة السارية تحطه في «${e(s.now)}»</li>`).join('')}</ul></div>${capped}`;
      return `<p class="subtle">${e(i.note)} حصة المنشأة هالشهر ${amount(i.employer_total_minor)}.</p>${capped}`;};
    // يوم الصرف: الاسمي، والمعدل بم48، والمقرر إن قُرر صرف مبكر. المقرر لا يتجاوز تاريخ اللائحة أبدًا.
    const payDate=r=>{const d=r.pay_date;if(!d)return '';
      const dec=d.decision;
      return `<dl class="vn-facts"><div><dt>يوم الصرف الاسمي</dt><dd>${dateTag(d.nominal)}</dd></div><div><dt>بعد إزاحة م48</dt><dd>${dateTag(d.regulation)}${d.shifted?` — ${e(d.shift_reason)}`:''}</dd></div><div><dt>تاريخ الصرف النافذ</dt><dd>${dateTag(d.effective)}</dd></div></dl>
        ${dec?`<p class="subtle">صرف مبكر ${dec.status==='confirmed'?'مؤكد':'مقترح ينتظر التأكيد'}: ${dateTag(dec.pay_on)} — ${e(dec.reason)} · اقترحه ${e(dec.decided_by_name)}${dec.confirmed_by_name?` وأكده ${e(dec.confirmed_by_name)}`:''}. ${e(d.note)}</p>`:''}`;};
    // سلامة المدخلات (run.inputs، للمسير المفتوح وحده): هل ما احتُسب منه المسير هو ما بين أيدينا الحين؟ ما تغيّر يمنع التقديم والمراجعة
    // والاعتماد برفض inputs_changed، فيُقال بشكل الرفض المكتوب نفسه (ui.refusal) قبل أن يُضغط زرٌّ يُرفض: ما تغيّر باسمه، وعند من، والخطوة التالية.
    // والرفض الذي يصل عند الحفظ (inputs_changed أو stale_version حين يكتب غيرك على المسير بين قراءتك وكتابتك) يأتي في error.details.refusal
    // ويرسمه الغلاف بـui.refusal في نافذة الإجراء نفسها (app.mjs)، فلا تُرسم له نسخة هنا.
    const inputsChanged=r=>['changed','unverified'].includes(r.inputs?.state);
    const inputsNote=r=>{const i=r.inputs;if(!i)return '';
      if(i.state==='current')return '<p class="subtle">مدخلات المسير ما تغيّرت بعد احتسابه.</p>';
      const draft=r.status==='draft',owner=draft?'مُعد الرواتب':'المراجع أو المعتمد يرجّعه للمسودة، ومُعد الرواتب يعيد احتسابه';
      const next=draft?'أعد احتساب المسير، وبعدها قدّمه':'يرجّعه المراجع أو المعتمد للمسودة بسبب مكتوب، ويعيد مُعد الرواتب احتسابه، ثم يمر بالمراجعة والاعتماد من جديد';
      if(i.state==='unverified')return ui.refusal?.({what:`مسير ${r.month} انحسب قبل ما تنحفظ بصمة مدخلاته، فما يُعرف على أي مدخلات قام`,missing:[{document:'احتساب يحفظ بصمة مدخلاته',owner}],next})??'';
      return ui.refusal?.({what:`مدخلات مسير ${r.month} تغيّرت بعد احتسابه، فسطوره ما عادت تطابق مصادرها`,
        missing:i.changed.map(x=>({document:inputParts[x.key]??x.name,why:'تغيّر بعد الاحتساب',owner})),next})??'';};
    // عكس المسير المعتمد: الطلب وقراره بمن وسببه، أو لماذا لا ينعكس الآن (D6) — بشكل الرفض المكتوب نفسه، فلا يُضغط زرٌّ يُرفض.
    const reversalNote=r=>{const x=r.reversal,lines=[];
      if(x)lines.push(`<div class="vn-alert${x.status==='requested'?' is-due':''}"><strong>${e(x.status_name)}</strong><p class="measure">${e(x.reason)}</p><p class="subtle">طلبه ${e(x.requested_by_name)} في ${dateTag(x.requested_at)}${x.decided_by_name?` · ${x.status==='rejected'?'رفضه':'اعتمده'} ${e(x.decided_by_name)} في ${dateTag(x.decided_at)}${x.decision_note?` — ${e(x.decision_note)}`:''}`:''}</p>${x.status==='approved'?'<p class="subtle">الشهر مفتوح لمسير مصحَّح، وقيد العكس ينتظر في «القوائم المالية والترحيل».</p>':''}</div>`);
      if(r.status==='approved'&&(r.reversal_blockers||[]).length&&data.permissions.some(p=>['payroll.prepare','payroll.approve'].includes(p)))
        lines.push(ui.refusal?.({what:`مسير ${r.month} ما ينعكس الحين`,missing:r.reversal_blockers.map(b=>({document:b.document,why:b.why,owner:b.owner})),next:'الفرق يتعالج بأثر رجعي في شهر لاحق يعتمده زميل'})??'');
      return lines.join('');};
    // بطاقة المسير: ما يمنع التقديم أو الاعتماد أولًا، ثم المجاميع ويوم الصرف، ثم سطور الموظفين، ثم الأفعال.
    const run=r=>`<details class="vn-card"${['draft','in_review','reviewed'].includes(r.status)?' open':''}><summary><span class="vn-code">${e(r.month)}</span><span class="vn-name"><strong>مسير ${monthTag(r.month)} · ${count(r.headcount)} موظف</strong><small>أعده ${e(r.prepared_by_name)}${r.reviewed_by_name?` · راجعه ${e(r.reviewed_by_name)}`:''}${r.approved_by_name?` · اعتمده ${e(r.approved_by_name)}`:''}</small></span><span class="vn-flags"><span class="vn-flag">الصافي ${amount(r.net_minor)}</span>${r.unexplained_variances?`<span class="vn-flag is-block">${count(r.unexplained_variances)} فرق بلا تبرير</span>`:''}<span class="badge ${e(r.status==='approved'?'approved':['cancelled','reversed'].includes(r.status)?'suspended':'pending')}">${e(r.status_name)}</span></span></summary><div class="vn-body">
      ${inputsNote(r)}${reversalNote(r)}${(r.checks||[]).length?`<div class="vn-alert${r.checks.some(c=>c.level==='warn')?' is-due':''}"><strong>فحص ما قبل المسير: ${count(r.checks.length)} ملاحظة</strong><ul>${r.checks.map(c=>`<li>${c.level==='warn'?'<span aria-hidden="true">⚠ </span><span class="sr-only">تنبيه: </span>':''}${e(c.title)}${c.detail?` — ${e(c.detail)}`:''}</li>`).join('')}</ul></div>`:''}
      ${r.missing_contracts.length?`<div class="vn-alert"><strong>${count(r.missing_contracts.length)} موظف نشط ما عنده عقد ساري هالشهر وما دخل المسير</strong><p>${r.missing_contracts.map(m=>e(m.name)).join('، ')}</p></div>`:''}
      ${(r.pending_pricing||[]).length?`<div class="vn-alert is-block"><strong>${count(r.pending_pricing.length)} خصم إجازة معتمدة بانتظار التسعير — لا يُقدَّم المسير قبل حسمها</strong><div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الشهر</th><th>أيام الأجر المفقودة</th><th>الحالة</th></tr></thead><tbody>${r.pending_pricing.map(x=>`<tr><td>${e(x.employee_name)}</td><td>${monthTag(x.month)}</td><td>${e(x.lost_days)} يوم</td><td>${x.priceable?`جاهز للتسعير — المبلغ المحسوب ${amount(x.proposed_amount_minor)}`:e(x.blocked_note)}</td></tr>`).join('')}</tbody></table></div><p class="subtle">التسعير ينحسب من العقد الساري وأساس اليوم في سياسة دورة الرواتب المعتمدة، والحركة اللي تطلع «مقترحة» يعتمدها حامل تصريح اعتماد الرواتب.</p></div>`:''}${r.decision_note?`<p class="subtle">ملاحظة القرار: ${e(r.decision_note)}</p>`:''}${r.review_note?`<p class="subtle">ملاحظة المراجعة: ${e(r.review_note)}</p>`:''}
      ${ins(r)}
      <dl class="vn-facts"><div><dt>إجمالي الاستحقاق</dt><dd>${amount(r.gross_minor)}</dd></div><div><dt>إجمالي الاستقطاعات</dt><dd>${amount(r.deductions_minor)}</dd></div><div><dt>الصافي</dt><dd>${amount(r.net_minor)}</dd></div><div><dt>حصة المنشأة في التأمينات (تكلفة لا خصم)</dt><dd>${r.insurance?.employer_total_minor===null||r.insurance?.employer_total_minor===undefined?'<span class="vn-flag is-block">غير متاح</span>':amount(r.insurance.employer_total_minor)}</dd></div></dl>
      ${payDate(r)}
      <div class="table-wrap"><table><caption class="sr-only">سطور مسير ${e(r.month)}</caption><thead><tr><th>الموظف</th><th>نسبة الشهر</th><th>الاستحقاق</th><th>إضافات</th><th>غياب</th><th>تأمينات الموظف</th><th>حصة المنشأة</th><th>سلف وخصومات</th><th>الصافي</th><th>الشهر السابق</th><th>الفرق</th></tr></thead><tbody>${r.lines.map(l=>`<tr><td><strong>${e(l.employee_name)}</strong>${caseOf(l)}${l.variance_note?`<small>${e(l.variance_note)}</small>`:''}</td><td>${e((l.paid_fraction_bp/100).toFixed(2))}%</td><td>${amount(l.gross_minor)}</td><td>${amount(l.additions_minor)}</td><td>${amount(l.unpaid_absence_minor)}</td><td>${l.basis.insurance?.method==='unavailable'?'<span class="vn-flag is-block">غير متاح</span>':amount(l.social_insurance_minor)}</td><td>${l.basis.insurance?.method==='per_case'?amount(l.employer_insurance_minor??0):'—'}</td><td>${amount(l.advance_minor+l.other_deductions_minor)}</td><td><strong>${amount(l.net_minor)}</strong></td><td>${l.previous_net_minor===null?'—':amount(l.previous_net_minor)}</td><td>${l.variance_flag?`<span class="vn-flag ${l.variance_note?'is-ok':'is-block'}">${l.variance_note?'مبرر':'يحتاج تبريرًا'}</span>`:'—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="operation-actions">${r.actions.filter(a=>labels[a]&&!(inputsChanged(r)&&NEEDS_CURRENT_INPUTS.includes(a))).map(a=>button(a,r.id,labels[a])).join('')}</div></div></details>`;
    const p=data.cycle_policy;
    // «قيد المراجعة أو الاعتماد» تُلوَّن بالانتباه حين يوجد ما ينتظر فعلًا؛ الصفر لا لون له.
    const reviewing=data.runs.filter(r=>['in_review','reviewed'].includes(r.status)).length;
    return `<section class="panel panel-body vn-head"><p>${e(data.outside_platform)}</p><div class="operation-actions">${data.permissions.includes('payroll.prepare')&&p?button('prepare_run','','إعداد مسير شهر'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.runs.filter(r=>r.status==='approved').length,'مسير معتمد')}${tile(reviewing,'مسير قيد المراجعة أو الاعتماد',reviewing?'is-due':'')}${tile(p?`يوم ${p.pay_day}`:'—','يوم الصرف المعتمد')}${tile(data.insurance_rule.accepted?`${data.insurance_rule.case_count} حالات`:p&&p.social_insurance_employee_bp!==undefined?`${(p.social_insurance_employee_bp/100).toFixed(2)}%`:'—',data.insurance_rule.accepted?'خصم التأمينات بحسب الحالة':'نسبة تأمينات واحدة في سياسة الدورة',data.insurance_rule.accepted?'is-ok':'is-due')}</div>
      ${p?`<p class="subtle">السياسة السارية: ${e(p.title)} · أساس اليوم: ${e(p.day_basis==='thirty'?'شهر من ثلاثين يوم':'أيام الشهر الفعلية')} · حد الفرق اللي يحتاج تبرير: <span class="ltr">${e((p.review_threshold_bp/100).toFixed(2))}%</span>.</p>`:'<div class="vn-alert is-block"><strong>ما فيه سياسة دورة رواتب معتمدة من مدير الموارد البشرية.</strong><p>ما ينعدّ أي مسير قبل اعتمادها، وتنعدّ من شاشة «العقود وبنود الراتب».</p></div>'}</section>
      ${data.runs.length?`<section class="vn-group"><h2>المسيرات ${count(data.runs.length)}</h2>${data.runs.map(run).join('')}</section>`:p?empty('ما فيه مسيرات للحين','المُعد يبدأ مسير الشهر من زر «إعداد مسير شهر».'):''}${slips}`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='prepare_run'){guard(data.permissions.includes('payroll.prepare')&&data.cycle_policy);return {title:'إعداد مسير شهر',endpoint:'/payroll/runs',idempotent:true,fields:[field('month','الشهر','month',{value:data.today.slice(0,7)})],toPayload:v=>v};}
    // موافقة العامل الخطية على خصم من أجره (م51): POST /api/payroll/adjustments/:id/consent، موصول في app/server.mjs (P4-HR-2) إلى consentToDeduction
    // بحراسة الجلسة وCSRF والمصدر؛ يقرّها صاحب الأجر وحده، ولغيره «غير متاح».
    if(action==='consent_deduction'){const d=(data.deduction_consents??[]).find(x=>x.id===id);guard(d);return {title:`موافقة على خصم ${(d.amount_minor/100).toFixed(2)} ريال لشهر ${d.month}`,endpoint:`/payroll/adjustments/${id}/consent`,fields:[field('consent','قرأت الإقرار وأوافق على الخصم بهويتي','checkbox',{hint:d.consent_text})],toPayload:v=>({consent:v.consent==='on'||v.consent===true})};}
    const r=data.runs.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    const note=(label,required=true)=>field('note',label,'textarea',required?{}:{required:false});
    const fields={recalculate:[],submit_run:[],cancel_run:[note('سبب الإلغاء')],pass_review:[note('وش اللي راجعته؟')],return_run:[note('سبب الإعادة')],approve_run:[note('ملاحظة الاعتماد (اختيارية)',false)],
      // الصرف المبكر: تاريخ يسبق تاريخ اللائحة وسبب مكتوب، ثم يؤكده شخص آخر يحمل اعتماد الرواتب.
      propose_early_pay:[field('pay_on',`تاريخ الصرف المبكر (يسبق ${r.pay_date?.regulation??'تاريخ اللائحة'})`,'date'),note('سبب التعجيل، مثل الصرف قبل إجازة العيد')],
      confirm_early_pay:[note('إقرارك بسبب التعجيل وأثره على السيولة')],reject_early_pay:[note('سبب رفض التعجيل')],
      withdraw_early_pay:[note('سبب سحب تاريخ الصرف المبكر المؤكد ووش اللي تبيّن')],
      // العكس: سببه مكتوب عند الطلب، وقراره بسبب عند الاعتماد أو الرفض. المعتمد يتأكد أن ملف التحويل ما انصرف في البنك قبل ما يعتمد.
      request_run_reversal:[field('reason','سبب العكس: وش الخطأ في المسير المعتمد','textarea',{hint:'العكس قبل الصرف وبس. التحويل المعدّ أو المعتمد ينلغي باعتماده، والشهر ينفتح لمسير مصحَّح.'})],
      approve_run_reversal:[note('أساس اعتماد العكس: وش تأكدت منه، ومنه إن ملف التحويل ما انصرف في البنك')],reject_run_reversal:[note('سبب رفض العكس')],justify:[field('line_id','السطر','select',{options:r.lines.filter(l=>l.variance_flag).map(l=>({value:l.id,label:`${l.employee_name}${l.variance_note?' — مبرر':''}`}))}),note('تبرير الفرق')],
      price_leave_effect:[field('effect_id','البند','select',{options:(r.pending_pricing||[]).filter(x=>x.priceable).map(x=>({value:x.id,label:`${x.employee_name} — ${x.month} — ${x.lost_days} يوم`}))}),note('سند التسعير: قرار السياسة اللي أتاحه')]}[action];
    // اقتراح الصرف المبكر يحمل التاريخ والسبب وحدهما؛ باقي الإجراءات تحمل ملاحظتها كما كانت.
    const toPayload=action==='propose_early_pay'?v=>({pay_on:v.pay_on,reason:v.note,version:r.version})
      :action==='request_run_reversal'?v=>({reason:v.reason,version:r.version})
      :v=>({...(v.note?{note:v.note}:{}),...(v.line_id?{line_id:v.line_id}:{}),...(v.effect_id?{effect_id:v.effect_id}:{}),version:r.version});
    return {title:`${labels[action]} — مسير ${r.month}`,endpoint:`/payroll/runs/${id}/${action}`,fields,toPayload};
  }
};
