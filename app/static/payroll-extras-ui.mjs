// حركات الرواتب: إضافات وخصومات، سلف، حسابات رواتب الموظفين، دفع المسير، وتسويات نهاية الخدمة.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const labels={approve_adjustment:'اعتماد',reject_adjustment:'رفض',approve_advance:'اعتماد السلفة',reject_advance:'رفض السلفة',verify_employee_bank:'تحقق من الحساب',reject_employee_bank:'رفض الحساب',approve_payment:'اعتماد الدفع',cancel_payment:'إلغاء الدفع',record_payment_execution:'توثيق التنفيذ البنكي',approve_settlement:'اعتماد التسوية',reject_settlement:'رفض التسوية',
  // الحزمة 4 (الترحيل 174): صرف السلفة المعتمدة يسجّله غير صاحبها ومقترحها ومعتمدها.
  record_disbursement:'تسجيل صرف السلفة'};
const states={proposed:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض',pending:'بانتظار الاعتماد',verified:'متحقق منه',executed:'نُفذ في البنك وموثق',cancelled:'ملغى',draft:'مسودة بانتظار الاعتماد'};
// الشهر بعد n شهر بصيغة YYYY-MM: أشهر أقساط السلفة، كما يعدّها الخادم (nextMonth في app/payroll-extras.mjs).
const shiftMonth=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
// ما يقوله المعتمد قبل قراره عن شهرٍ تجاوز مسيره المسودة (month_locked): الحركة أو القسط عليه ما ينعتمد، والرفض متاح دائمًا.
const lockedNext=run=>run.status==='approved'?'ارفضها بسبب مكتوب، ويقترحها مُعد الرواتب لشهر لاحق'
  :'يرجّع المراجع أو المعتمد المسير للمسودة وبعدها تنعتمد — أو ارفضها وتنقترح لشهر لاحق';
export const payrollExtrasUI={
  title:'حركات الرواتب والتسويات',description:'كل اللي يدخل المسير غير العقد والحضور: الحركات والسلف وحسابات رواتب الموظفين ودفع المسير وتسوية نهاية الخدمة. واللي يقترح ما يعتمد.',
  load:api=>api('/payroll/extras'),
  render(data,{e,button,money}){
    const prepare=data.permissions.includes('payroll.prepare');
    // المبلغ معزول الاتجاه بأرقام جدولية، والتاريخ والشهر بوسم time، والعدد في جملة بـdata-num.
    const amount=minor=>`<span class="ltr">${e(money(minor))}</span>`;
    const dateTag=iso=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
    const monthTag=m=>m?`<time datetime="${e(m)}">${e(m)}</time>`:'—';
    const count=n=>`<span data-num>${e(n)}</span>`;
    // أفعال الصف وما يرافقها من روابط في منطقة أفعال واحدة. ولا يُرسم زر لا تعرف الشاشة اسمه.
    // skip: أفعالٌ يرسلها الخادم ويرفضها حتمًا الآن (شهر مقفل، أو إجازة انلغت)؛ لا تُرسم، وسطر الصف يقول لماذا.
    const acts=(row,key,extra='',skip=[])=>{const buttons=row.actions.filter(a=>labels[a]&&!skip.includes(a)).map(a=>button(a,`${key}:${row.id}`,labels[a])).join('');return buttons||extra?`<div class="operation-actions">${extra}${buttons}</div>`:'';};
    // الأشهر التي تجاوز مسيرها المسودة (قيد المراجعة، أو روجِع، أو اعتُمد): لا تُعتمد عليها حركة ولا قسط سلفة.
    const locked=new Map((data.locked_months??[]).map(m=>[m.month,m]));
    const lockedLine=(run,lead='')=>`<small>${lead}مسير ${monthTag(run.month)} «${e(run.status_name)}»، وما يدخله شي جديد: ${e(lockedNext(run))}.</small>`;
    // مصدر الحركة ومآلها (الترحيل 173). ردُّ خصمِ إجازةٍ انلغت بعد صرفه يُسمّى ردًّا، وخصمُ أثرِ إجازةٍ يُسمّى بمصدره. وخصمُ إجازةٍ انلغت:
    // المقترح منه لا يُعتمد (leave_effect_withdrawn) فيبقى زرّ رفضه وحده، والمعتمد قبل صرفه «مستبعد من المسير» — يبقى معتمدًا ولا يُصرف أبدًا،
    // والمصروف قبل الإلغاء يُرد بحركة رد مستقلة.
    const adjustmentLine=a=>{
      const withdrawn=a.leave_effect?.status==='withdrawn',run=a.status==='proposed'?locked.get(a.month):null;
      const excluded=withdrawn&&a.status==='approved'&&!a.paid_run_month;
      const kind=a.leave_refund?'ردّ خصم إجازة انلغت':a.leave_effect?'خصم أثر إجازة':a.kind_name;
      const notes=[a.leave_refund?`<small>يرد خصم إجازة انلغت بعد ما انصرف في مسير ${monthTag(a.leave_refund.paid_run_month)}.</small>`:'',
        excluded?'<small>الإجازة انلغت قبل صرف المسير، فهالخصم يبقى معتمد وما يدخل أي مسير.</small>':'',
        withdrawn&&a.status==='proposed'?'<small>الإجازة اللي ولّدته انلغت، فما ينعتمد: ارفضه بسبب مكتوب — أجر تلك الأيام ما عاد مخصوم.</small>':'',
        withdrawn&&a.paid_run_month?`<small>انصرف في مسير ${monthTag(a.paid_run_month)} قبل ما تنلغي الإجازة، ${a.leave_effect.refunded?'وردّه حركة رد مستقلة':'وردّه ينتظر حركة رد'}.</small>`:'',
        run&&!withdrawn?lockedLine(run):''].join('');
      const skip=(withdrawn&&a.status==='proposed')||run?['approve_adjustment']:[];
      return `<li><strong>${e(a.employee_name)} · ${e(kind)} · ${amount(a.amount_minor)}</strong>${excluded?'<span class="vn-flag withdrawn">مستبعد من المسير</span>':''}<span>${monthTag(a.month)} · ${e(states[a.status])}${a.run_id&&!excluded?' · دخل مسير':''} · اقترحه ${e(a.proposed_by_name)}</span><small>${e(a.reason)}</small>${basisLine(a)}${notes}${acts(a,'adjustment','',skip)}</li>`;
    };
    // السلفة تُحرس بكل شهر من أشهر أقساطها: أول قسطٍ يقع على شهر مقفل يوقف اعتمادها.
    const advanceLock=a=>{if(a.status!=='proposed')return null;for(let i=0;i<a.installments;i++){const run=locked.get(shiftMonth(a.first_month,i));if(run)return run;}return null;};
    // كل قسم قسمٌ أعلى في الشاشة (h2 تحت عنوان الصفحة)، وحين يفرغ يقول سطرُه متى يمتلئ ومن يملؤه.
    const block=(title,items,none)=>`<section class="vn-block"><h2>${e(title)}</h2>${items?`<ul class="vn-list">${items}</ul>`:`<p class="subtle">${e(none)}</p>`}</section>`;
    // سند الخصم (م51) بجوار كل حركة خصم: الحالة بترقيمها، أو موافقة العامل ووقتها أو انتظارها، أو أنها سبقت اشتراط السند.
    const basisLine=a=>{const b=a.deduction_basis;if(!b)return '';const detail=b.basis==='exception'?`${e(b.case_name)} — <bdi>${e(b.reference)}</bdi>`:b.basis==='consent'?(b.consent_pending?'ينتظر موافقة العامل الخطية بهويته، وما يُعتمد قبلها':`وافق ${e(b.consent_by_name)} في ${dateTag(b.consent_at)}`):e(b.basis_name);return `<small>سند الخصم: ${detail}</small>`;};
    const adjustments=data.adjustments.map(adjustmentLine).join('');
    // الصرف (الترحيل 174): متى انصرفت وبأي مرجع ومن سجّله، أو أن صرفها ما انسجّل وأقساطها تُسترد.
    const payout=a=>a.disbursed_on?`<small>انصرفت <time datetime="${e(a.disbursed_on)}">${e(a.disbursed_on)}</time> بمرجع <bdi dir="ltr">${e(a.disbursement_reference)}</bdi> · سجّله ${e(a.disbursed_by_name)}</small>`
      :a.status==='approved'?'<small>صرفها ما انسجّل للحين — يسجّله مراجع الرواتب بتاريخه ومرجعه البنكي، وبعدها يقوم قيدها في الدفتر.</small>':'';
    const advances=data.advances.map(a=>{const run=advanceLock(a);return `<li><strong>${e(a.employee_name)} · ${amount(a.amount_minor)} على ${count(a.installments)} قسط</strong><span>من ${monthTag(a.first_month)} · ${e(states[a.status])}${a.outstanding_minor!==null?` · الباقي ${amount(a.outstanding_minor)}`:''}</span><small>${e(a.reason)}</small>${payout(a)}${run?lockedLine(run,'أحد أقساطها على '):''}${acts(a,'advance','',run?['approve_advance']:[])}</li>`;}).join('');
    const banks=data.banks.map(b=>`<li><strong>${e(b.employee_name)} · ${e(b.bank_name)} · <bdi dir="ltr">${e(b.iban_masked)}</bdi></strong><span>${e(states[b.status])} · يسري من ${monthTag(b.effective_month)} · سجّله ${e(b.recorded_by_name)}</span>${acts(b,'bank')}</li>`).join('');
    // D5 (الحزمة 4): التحويل ما ينعتمد قبل ما يترحّل قيد مسيره؛ السطر يقول ما الناقص وعند من بدل زرٍّ يُرفض.
    const journalGate=p=>p.journal_gate?`<small>${e(p.journal_gate.what)}. ${e(p.journal_gate.next)}.</small>`:'';
    const payments=data.payments.map(p=>`<li><strong>دفع مسير ${monthTag(p.month)} · ${amount(p.amount_minor)} · ${count(p.headcount)} موظف</strong><span>${e(states[p.status])}${p.bank_reference?` · مرجع <bdi dir="ltr">${e(p.bank_reference)}</bdi>`:''} · أعده ${e(p.prepared_by_name)}</span>${journalGate(p)}${acts(p,'payment',['approved','executed'].includes(p.status)?`<a class="btn outline small" href="/api/payroll/payments/${e(p.id)}/file" download>تنزيل ملف التحويل الداخلي (<span lang="en" dir="ltr">CSV</span>)</a>`:'')}</li>`).join('');
    const settlements=data.settlements.map(s=>`<li><strong>${e(s.employee_name)} · ${e(s.reason_name)} · الصافي ${amount(s.net_minor)}</strong><span>${e(states[s.status])} · خدمة ${dateTag(s.service_start)} – ${dateTag(s.service_end)} (${count((s.basis.service_years_bp/10000).toFixed(2))} سنة)</span><small>مكافأة ${amount(s.award_minor)} (معامل السبب <span class="ltr">${e((s.basis.reason_factor_bp/100).toFixed(2))}%</span>) + إجازة ${count(s.leave_days)} يوم ${amount(s.leave_payout_minor)} − سلف ${amount(s.advances_outstanding_minor)} · السياسة: ${e(s.basis.policy_title)}</small>${acts(s,'settlement')}</li>`).join('');
    const runs=data.payable_runs.map(r=>`<li><strong>مسير ${monthTag(r.month)} المعتمد · ${amount(r.net_minor)}</strong><span>${count(r.headcount)} موظف · ما انعدّ دفعه للحين</span>${prepare?`<div class="operation-actions">${button('prepare_payment',r.id,'إعداد الدفع وملف التحويل')}</div>`:''}</li>`).join('');
    // فرق الأثر الرجعي بانتظار اقتراح حركته: يستحق الانتباه في الاتجاهين، والاتجاه نفسه مكتوب بكلمته.
    const retro=data.retro.candidates.map(c=>`<li class="is-due"><strong>${e(c.employee_name)} · ${monthTag(c.source_month)} · ${c.difference_minor>0?'مستحق للموظف':'مصروف بالزيادة'} ${amount(Math.abs(c.difference_minor))}</strong><span>المصروف ${amount(c.paid_minor)} · المستحق الحين ${amount(c.due_minor)}${c.already_proposed_minor?` · سبق اقتراح ${amount(c.already_proposed_minor)}`:''}</span><small>${c.reasons.map(e).join('، ')||'تغيّر في بنود العقد أو مدته'}</small>${c.can_propose?`<div class="operation-actions">${button('propose_retro',c.key,'اقتراح حركة الأثر الرجعي')}</div>`:''}</li>`).join('');
    const retroHistory=data.retro.history.map(r=>`<li><strong>${e(r.employee_name)} · ${monthTag(r.source_month)} <span aria-hidden="true">←</span><span class="sr-only">إلى</span> ${monthTag(r.target_month)} · ${amount(r.difference_minor)}</strong><span>${e({proposed:'الحركة مقترحة',approved:'الحركة معتمدة',rejected:'الحركة مرفوضة'}[r.adjustment_status]??r.adjustment_status)}</span></li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${prepare?button('propose_adjustment','','حركة على راتب')+button('propose_advance','','سلفة')+button('record_bank','','حساب راتب موظف')+(data.ended_contracts.length&&data.eos_policy?button('prepare_settlement','','تسوية نهاية خدمة'):''):''}</div></section>
      ${data.eos_policy?'':'<div class="vn-alert is-due"><strong>ما فيه سياسة نهاية خدمة معتمدة.</strong><p>ما تنعدّ تسوية قبل ما يعتمد مدير الموارد البشرية معاملات المكافأة بسندها النظامي من شاشة «العقود وبنود الراتب».</p></div>'}
      <div class="vn-grid">${block('إضافات وخصومات',adjustments,'ما فيه حركات للحين — يقترحها مُعد الرواتب ويعتمدها شخص ثاني.')}${block('السلف',advances,'ما فيه سلف للحين — يقترحها مُعد الرواتب ويعتمدها شخص ثاني.')}${block('حسابات رواتب الموظفين',banks,'ما انسجّل حساب راتب لأحد للحين.')}${block('مسيرات معتمدة بانتظار الدفع',runs,'ما فيه مسير معتمد ينتظر الدفع.')}${block('دفعات المسير',payments,'ما فيه دفعات للحين — تنعدّ من مسير معتمد.')}${block('تسويات نهاية الخدمة',settlements,'ما فيه تسويات للحين.')}${block('فروق أثر رجعي قائمة',retro,'ما فيه فروق بين المسيرات المعتمدة والعقود والغياب الحالية.')}${block('سجل الأثر الرجعي',retroHistory,'ما فيه حركات أثر رجعي للحين.')}</div><p class="subtle">${e(data.retro.rule)}</p>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    const employees=data.employees.map(u=>({value:u.id,label:u.name})),prepare=data.permissions.includes('payroll.prepare');
    // الأشهر المقفلة تُقال قبل الحفظ: حركةٌ أو قسط على شهرٍ تجاوز مسيره المسودة ما ينقبل (month_locked). أحدث ثلاثة تكفي من يختار شهرًا.
    const lockedMonths=(data.locked_months??[]).slice(0,3).map(m=>`${m.month} (${m.status_name})`).join('، ');
    if(action==='propose_retro'){const c=data.retro.candidates.find(x=>x.key===id);guard(c&&c.can_propose);return {title:`أثر رجعي — ${c.employee_name} · ${c.source_month}`,endpoint:'/payroll/retro',idempotent:true,fields:[field('target_month','شهر الصرف أو الخصم','month',{value:data.today.slice(0,7),hint:`الفرق ${(c.difference_minor/100).toFixed(2)} ينحسب من العقود والغياب المعتمد، ويدخل المسير بعد ما يعتمده شخص ثاني.`}),field('note','سبب الفرق وسنده','textarea')],toPayload:v=>({user_id:c.user_id,source_month:c.source_month,target_month:v.target_month,expected_difference:c.difference_minor,note:v.note})};}
    if(action==='propose_adjustment'){guard(prepare);
      // م51 (ص 19): الخصم يحمل سنده من النموذج نفسه — موافقة العامل (يقرّها هو من شاشة الرواتب) أو حالة من الحالات الست بسندها. لغير الخصم يُهمل الحقلان.
      const bases=[{value:'consent',label:data.deduction_basis_names?.consent??'موافقة العامل الخطية'},...(data.deduction_cases??[]).map(c=>({value:c.key,label:c.name}))];
      return {title:'حركة على راتب',endpoint:'/payroll/adjustments',idempotent:true,fields:[field('user_id','الموظف','select',{options:employees}),field('kind','النوع','select',{options:data.adjustment_kinds.map(k=>({value:k.key,label:k.name}))}),field('month','شهر المسير','month',{value:data.today.slice(0,7),...(lockedMonths?{hint:`ما تنقبل حركة على شهر تجاوز مسيره المسودة: ${lockedMonths}.`}:{})}),field('amount','المبلغ'),field('reason','السبب والسند','textarea',{hint:'العمل الإضافي ينكتب مبلغه المعتمد كما هو، وما فيه معدل ساعة يُفترض.'}),
        field('deduction_basis','سند الخصم (للخصم فقط، م51)','select',{required:false,options:bases,hint:'لا يجوز الحسم من الأجر بغير موافقة العامل الخطية إلا في الحالات الست. الموافقة يقرّها العامل بهويته من شاشة «الرواتب» قبل الاعتماد.'}),field('deduction_reference','سند الحالة: رقم الحكم أو القضية أو القرار أو الاشتراك','text',{required:false})],
        toPayload:v=>{const out={user_id:v.user_id,kind:v.kind,month:v.month,amount:v.amount,reason:v.reason};if(v.kind==='deduction'){out.deduction_basis=v.deduction_basis??'';if(v.deduction_reference)out.deduction_reference=v.deduction_reference;}return out;}};}
    if(action==='propose_advance'){guard(prepare);return {title:'سلفة على الراتب',endpoint:'/payroll/advances',idempotent:true,fields:[field('user_id','الموظف','select',{options:employees}),field('amount','مبلغ السلفة'),field('installments','عدد الأقساط الشهرية','number',{min:1,max:24,value:3}),field('first_month','أول شهر استرداد','month',{value:data.today.slice(0,7),...(lockedMonths?{hint:`أي قسط على شهر تجاوز مسيره المسودة يوقف اعتمادها: ${lockedMonths}.`}:{})}),field('reason','السبب والسند','textarea',{hint:'بعد اعتمادها ينسجّل صرفها من هنا بتاريخه ومرجعه البنكي، وأقساطها تُسترد من المسير.'})],toPayload:v=>({...v,installments:Number(v.installments)})};}
    if(action==='record_bank'){guard(prepare);return {title:'حساب راتب موظف',endpoint:'/payroll/employee-banks',idempotent:true,fields:[field('user_id','الموظف','select',{options:employees}),field('bank_name','اسم البنك'),field('iban','رقم الآيبان','text',{hint:'ينحفظ مشفّر ويتحقق منه شخص ثاني. وصحة الصيغة ما تثبت إن الحساب حقّه.'}),field('effective_month','يسري من مسير شهر','month',{value:data.today.slice(0,7)}),field('evidence','دليل ملكية الحساب ومصدر الطلب','textarea')],toPayload:v=>v};}
    if(action==='prepare_payment'){guard(prepare&&data.payable_runs.some(r=>r.id===id));return {title:'إعداد دفع المسير',endpoint:'/payroll/payments',idempotent:true,fields:[],toPayload:()=>({run_id:id})};}
    if(action==='prepare_settlement'){guard(prepare&&data.eos_policy);return {title:'تسوية نهاية خدمة',endpoint:'/payroll/settlements',idempotent:true,fields:[field('contract_id','العقد المنتهي','select',{options:data.ended_contracts.map(c=>({value:c.id,label:`${c.name} · انتهى ${c.ended_on}`}))}),field('end_reason','تصنيف سبب الإنهاء','select',{options:data.end_reasons.map(r=>({value:r.key,label:r.name}))}),field('leave_days','أيام الإجازة المستحقة غير المستخدمة','number',{min:0,max:365,value:0}),field('evidence','مستند إنهاء الخدمة ومصدر رصيد الإجازة','textarea')],toPayload:v=>({...v,leave_days:Number(v.leave_days)})};}
    const [kind,rowId]=String(id).split(':'),list={adjustment:data.adjustments,advance:data.advances,bank:data.banks,payment:data.payments,settlement:data.settlements}[kind],row=list?.find(x=>x.id===rowId);
    guard(row&&row.actions.includes(action));
    if(kind==='payment'){
      if(action==='record_payment_execution')return {title:'توثيق تنفيذ دفع المسير',endpoint:`/payroll/payments/${rowId}/${action}`,fields:[field('executed_on','تاريخ التنفيذ في البنك','date',{value:data.today}),field('bank_reference','المرجع البنكي'),field('evidence','دليل التنفيذ ومكان حفظه','textarea')],toPayload:v=>({...v,version:row.version})};
      return {title:labels[action],endpoint:`/payroll/payments/${rowId}/${action}`,fields:[field('note','الأساس أو السبب','textarea')],toPayload:v=>({...v,version:row.version})};
    }
    if(kind==='advance'&&action==='record_disbursement')return {title:`${labels[action]} — ${row.employee_name}`,endpoint:`/payroll/advances/${rowId}/record_disbursement`,
      fields:[field('disbursed_on','تاريخ خروج المبلغ من البنك','date',{value:data.today}),field('reference','المرجع البنكي للصرف'),field('evidence','دليل الصرف: إشعار التحويل أو سطر الكشف','textarea')],toPayload:v=>v};
    const path={adjustment:'adjustments',advance:'advances',bank:'employee-banks',settlement:'settlements'}[kind],decision=action.startsWith('verify')?'verify':action.startsWith('approve')?'approve':'reject';
    return {title:`${labels[action]} — ${row.employee_name}`,endpoint:`/payroll/${path}/${rowId}/${decision}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};
  }
};
