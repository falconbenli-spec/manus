// حالات الموارد البشرية السرية والبلاغ المجهول، ومراجعة التعويضات، وتركيبة القوى العاملة.
// أهدأ طبقة للحساس: لا لون إنذار إلا لما تأخر فعلًا أو تجاوز حدّه، والمنتهي صامت. المبالغ مجدولة ومعزولة الاتجاه، والتواريخ في <time>.
// اسم المقترِح والمُعد والمقرر يبقى حيث تشترط القاعدة أن يعتمد غير من أعد: هو من يُراجَع، لا سند على الشاشة.
import { kit } from './kit.mjs';
import { canonicalStatus } from './vocabulary.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const pct=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(2)}%`;
const tile=(e,value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const acts=(button,row,labels)=>row.actions?.length?`<div class="operation-actions">${row.actions.map(a=>button(a,row.id,labels[a])).join('')}</div>`:'';
const opt=list=>list.map(x=>({value:x.key??x.id,label:x.name}));
const dateTag=(e,iso)=>`<time datetime="${e(String(iso).slice(0,10))}">${e(iso)}</time>`;
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const workDays=(e,n)=>n===1?'يوم عمل':n===2?'يومين عمل':`${num(e,n)} ${n<=10?'أيام عمل':'يوم عمل'}`;
// السهم بين قيمتين يعني «إلى»: يُرى ولا يُقرأ رمزًا، ويُقرأ كلمته.
const toArrow='<span aria-hidden="true">←</span><span class="sr-only">إلى</span>';

// ---------- حالات الموارد البشرية ----------
const caseLabels={take_case:'تولي الحالة',add_info:'إضافة معلومة',withdraw_case:'سحب الحالة',note_case:'ملاحظة داخلية',reply_case:'رد على صاحب الحالة',decide_case:'تسجيل قرار',reassign_case:'نقل لمسؤول آخر',close_case:'إغلاق الحالة'};
const reportLabels={take_report:'تولي البلاغ',reply_report:'رد على المُبلِّغ',handover_report:'نقل لمعالج آخر',close_report:'إغلاق البلاغ'};
// شكل الشارة من حالات القاموس (hr_case ← الثماني) والكلمة كلمة الخادم؛ والمتأخرة عن موعدها المستهدف بشكل التأخر وكلمته.
const caseTone=c=>c.overdue?'overdue':canonicalStatus('hr_case',c.status).status;
const REPORT_TONE={received:'pending',under_review:'in_progress',closed:'completed'};
const followHtml=(r,e)=>`<p><strong>${e(r.status_name)}</strong> · انستلم ${dateTag(e,r.received_on)}${r.outcome_name?` · النتيجة: ${e(r.outcome_name)} — ${e(r.closing_reason)}`:''}</p>
  ${r.messages.length?`<ul class="vn-list">${r.messages.map(m=>`<li><strong>${m.side==='reporter'?'انت':'جهة المعالجة'} · ${dateTag(e,m.posted_on)}</strong><span>${e(m.body)}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه ردود للحين.</p>'}
  <p class="subtle">${r.can_reply?'إذا تبي تضيف شي، استخدم «إضافة إلى بلاغي» بنفس الرمز.':'البلاغ مقفل وما يقبل إضافة.'}</p>`;
export const hrCasesUI={
  title:'حالات الموارد البشرية',description:'استفسار أو شكوى أو تظلم أو إبلاغ عن مخالفة أو مسألة شخصية — بسرية: يشوفها صاحبها والمسؤول المسند إليه بس، ومديرك المباشر ما يشوفها. وفيه بلاغ مجهول ما ينربط بحسابك.',
  load:api=>api('/hr-cases'),
  render(data,{e,button,ui=kit(e)}){
    const caseCard=c=>`<details class="vn-card"${c.own&&c.status!=='closed'?' open':''}><summary><span class="vn-code">${e(c.category_name)}</span><span class="vn-name"><strong>${e(c.triage?'حالة تنتظر مسؤول':c.subject)}</strong><small>انرفعت ${dateTag(e,c.filed_on)}${c.target_due_on?` · الموعد المستهدف ${dateTag(e,c.target_due_on)}`:' · ما لها موعد مستهدف'}</small></span><span class="vn-flags"><span class="badge ${caseTone(c)}">${e(c.status_name)}${c.overdue?' · متأخرة':''}</span></span></summary>
      <div class="vn-body">${c.triage?'<p class="subtle">الوصف والأطراف تظهر بعد ما تتولى الحالة. والحالة اللي انت طرف فيها ما تظهر لك أصلًا.</p>':`<p class="measure">${e(c.description)}</p>
      <dl class="detail-data">${c.reporter_name?`<div><dt>صاحب الحالة</dt><dd>${e(c.reporter_name)}</dd></div>`:''}${c.respondent_name?`<div><dt>المذكور فيها</dt><dd>${e(c.respondent_name)}</dd></div>`:''}<div><dt>المسؤول</dt><dd>${e(c.assignee_name||'ما انسندت للحين')}</dd></div>${c.outcome_name?`<div><dt>النتيجة</dt><dd>${e(c.outcome_name)} — ${e(c.closing_reason)}</dd></div>`:''}</dl>
      ${c.events.length?`<ul class="vn-list">${c.events.map(ev=>`<li class="${ev.internal?'is-old':''}"><strong>${e(ev.by_name)} · ${dateTag(e,ev.on)}${ev.internal?' · ملاحظة داخلية':''}</strong><span>${e(ev.body)}</span></li>`).join('')}</ul>`:''}`}
      ${acts(button,c,caseLabels)}</div></details>`;
    const reportCard=r=>`<details class="vn-card"><summary><span class="vn-code">مجهول</span><span class="vn-name"><strong>بلاغ ${dateTag(e,r.received_on)}</strong><small>${r.handler_name?`المعالج: ${e(r.handler_name)}`:'ما انسند لأحد'}</small></span><span class="vn-flags"><span class="badge ${REPORT_TONE[r.status]??''}">${e(r.status_name)}</span></span></summary>
      <div class="vn-body"><p class="measure">${e(r.body)}</p>${r.respondent_name?`<p class="subtle">المذكور: ${e(r.respondent_name)}</p>`:''}${r.messages.length?`<ul class="vn-list">${r.messages.map(m=>`<li><strong>${m.side==='reporter'?'المُبلِّغ':'المعالجة'} · ${dateTag(e,m.posted_on)}</strong><span>${e(m.body)}</span></li>`).join('')}</ul>`:''}${r.outcome_name?`<p><strong>${e(r.outcome_name)}</strong> — ${e(r.closing_reason)}</p>`:''}${acts(button,r,reportLabels)}</div></details>`;
    const group=(title,list,draw,none)=>`<section class="vn-group"><h2>${e(title)} <span data-num>${e(list.length)}</span></h2>${list.length?list.map(draw).join(''):none}</section>`;
    const quiet=text=>`<p class="subtle">${e(text)}</p>`;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${button('file_case','','رفع حالة')}${button('submit_anonymous','','بلاغ مجهول')}${button('follow_anonymous','','متابعة بلاغي المجهول')}${button('reply_anonymous','','إضافة إلى بلاغي')}${data.handler?button('set_case_target','','مدة مستهدفة'):''}</div><div class="vn-alert"><strong>البلاغ المجهول</strong><p>${e(data.anonymous_note)}</p></div></section>`;
    const mine=group('حالاتي',data.my_cases,caseCard,data.handler?quiet('ما رفعت أي حالة — اللي ترفعها من «رفع حالة» تظهر هنا.')
      :ui.empty('ما رفعت أي حالة','إذا عندك استفسار أو شكوى أو تظلم ارفعه من «رفع حالة» — يشوفه المسؤول المسند إليه بس.'));
    if(!data.handler)return head+mine;
    // للمعالج: ما أُسند إليه أولًا، ثم ما ينتظر من يتولاه، ثم البلاغات؛ وحالاته هو بعدها، والمدد المستهدفة مرجعًا في الآخر.
    return `${head}
      ${group('حالات أعالجها',data.handling,caseCard,quiet('ما فيه حالات مسندة لك — تتولاها من «بانتظار مسؤول».'))}${group('بانتظار مسؤول',data.intake,caseCard,quiet('ما فيه حالات تنتظر أحد يتولاها.'))}
      ${group('البلاغات المجهولة',data.anonymous_reports,reportCard,quiet('ما فيه بلاغات مجهولة للحين.'))}
      ${mine}
      <section class="vn-block"><div class="panel-head"><h2>المدد المستهدفة</h2></div><ul class="vn-list">${data.targets.map(x=>`<li><strong>${e(x.category_name)}</strong><span>${x.target_working_days?`${workDays(e,x.target_working_days)} من ${dateTag(e,x.effective_from)}`:'ما تحددت — الحالات الجديدة ما لها موعد مستهدف'}</span>${x.basis?`<small>${e(x.basis)}</small>`:''}</li>`).join('')}</ul></section>`;
  },
  form(action,id,data){
    const people=[{value:'',label:'محد بعينه'},...data.people.map(p=>({value:p.id,label:p.name}))];
    if(action==='file_case')return {title:'رفع حالة',endpoint:'/hr-cases',idempotent:true,fields:[field('category','الفئة','select',{options:opt(data.categories)}),field('subject','العنوان'),field('description','الوصف','textarea',{maxLength:8000,hint:'يشوفه المسؤول المسند إليه بس، ومديرك المباشر ما يشوفه.'}),field('respondent_id','هل تتعلق بشخص؟','select',{options:people,required:false,hint:'اللي تذكره هنا ما تنسند له الحالة ولا تظهر له.'})],toPayload:v=>({category:v.category,subject:v.subject,description:v.description,respondent_id:v.respondent_id||''})};
    // بلا Idempotency-Key عمدًا: جدول المفاتيح يربط الحساب بمعرّف السجل.
    if(action==='submit_anonymous')return {title:'بلاغ مجهول',endpoint:'/hr-cases/anonymous',idempotent:false,fields:[field('body','نص البلاغ','textarea',{maxLength:8000,hint:'إذا تبي تبقى مجهول لا تكتب شي يدل عليك.'}),field('respondent_id','هل يتعلق بشخص؟','select',{options:people,required:false})],toPayload:v=>({body:v.body,respondent_id:v.respondent_id||''}),
      after:(saved,e)=>({title:'رمز المتابعة — احتفظ فيه الحين',html:`<p>${e(saved.notice)}</p><p><code dir="ltr">${e(saved.token)}</code></p>`})};
    if(action==='follow_anonymous')return {title:'متابعة بلاغي المجهول',endpoint:'/hr-cases/anonymous/follow',fields:[field('token','رمز المتابعة','text',{maxLength:32})],toPayload:v=>({token:String(v.token).trim()}),after:(saved,e)=>({title:'حالة بلاغك',html:followHtml(saved,e)})};
    if(action==='reply_anonymous')return {title:'إضافة إلى بلاغي',endpoint:'/hr-cases/anonymous/reply',fields:[field('token','رمز المتابعة','text',{maxLength:32}),field('body','الإضافة','textarea',{maxLength:4000})],toPayload:v=>({token:String(v.token).trim(),body:v.body}),after:(saved,e)=>({title:'حالة بلاغك',html:followHtml(saved,e)})};
    if(action==='set_case_target'){guard(data.handler);return {title:'مدة مستهدفة لفئة',endpoint:'/hr-cases/targets',idempotent:true,fields:[field('category','الفئة','select',{options:opt(data.categories)}),field('target_working_days','المدة بأيام العمل','number',{min:1,max:365}),field('effective_from','تسري من','date'),field('basis','أساسها ومن أقرّها','textarea')],toPayload:v=>({category:v.category,target_working_days:Number(v.target_working_days),effective_from:v.effective_from,basis:v.basis})};}
    if(reportLabels[action]){
      const r=data.anonymous_reports.find(x=>x.id===id);guard(r&&r.actions.includes(action));
      const spec=(fields,toPayload)=>({title:reportLabels[action],endpoint:`/hr-cases/anonymous/${id}/${action}`,fields,toPayload:v=>({version:r.version,...toPayload(v)})});
      if(action==='take_report')return spec([],()=>({}));
      if(action==='reply_report')return spec([field('body','الرد','textarea',{hint:'يقراه حامل الرمز، واسمك ما يظهر له.'})],v=>({body:v.body}));
      if(action==='handover_report')return spec([field('handler_id','المعالج الجديد','select',{options:r.handover_candidates.map(p=>({value:p.id,label:p.name}))}),field('reason','سبب النقل','textarea')],v=>({handler_id:v.handler_id,reason:v.reason}));
      return spec([field('outcome','النتيجة','select',{options:opt(data.report_outcomes)}),field('reason','سبب الإغلاق','textarea')],v=>({outcome:v.outcome,reason:v.reason}));
    }
    const c=[...data.my_cases,...data.handling,...data.intake].find(x=>x.id===id);guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload)=>({title:caseLabels[action],endpoint:`/hr-cases/${id}/${action}`,fields,toPayload:v=>({version:c.version,...toPayload(v)})});
    if(action==='take_case')return spec([],()=>({}));
    if(['add_info','note_case','reply_case'].includes(action))return spec([field('body',caseLabels[action],'textarea',{hint:action==='note_case'?'ما يشوفها صاحب الحالة.':'يشوفها صاحب الحالة والمسؤول.'})],v=>({body:v.body}));
    if(action==='withdraw_case')return spec([field('reason','سبب السحب','textarea')],v=>({reason:v.reason}));
    if(action==='decide_case')return spec([field('decision','القرار'),field('reason','سببه','textarea')],v=>({decision:v.decision,reason:v.reason}));
    if(action==='reassign_case')return spec([field('assignee_id','المسؤول الجديد','select',{options:c.reassign_candidates.map(p=>({value:p.id,label:p.name}))}),field('reason','سبب النقل','textarea')],v=>({assignee_id:v.assignee_id,reason:v.reason}));
    return spec([field('outcome','النتيجة','select',{options:opt(data.outcomes)}),field('reason','سبب الإغلاق','textarea',{hint:'الحالة المقفلة ما تنعدّل ولا ينضاف لها شي.'})],v=>({outcome:v.outcome,reason:v.reason}));
  }
};

// ---------- مراجعة التعويضات ----------
const proposalLabels={assess_proposal:'تقييم موقعه من النطاق',approve_proposal:'اعتماد',reject_proposal:'رفض',withdraw_proposal:'سحب مقترحي'};
const proposalRoutes={assess_proposal:'assess',approve_proposal:'approve',reject_proposal:'reject',withdraw_proposal:'withdraw'};
const recLabels={link_contract:'ربط نسخة العقد الجديدة',drop_recommendation:'إسقاط التوصية'};
// حالة نسخة العقد بعبارة وحدة العقود في القاموس («ساري»، «مسودة»…)، لا بمفتاحها الخام.
const contractPhrase=status=>{const c=canonicalStatus('contract',status);return c.module_phrase??c.name;};
export const compensationUI={
  title:'مراجعة التعويضات',description:'نطاقات الرواتب بمصدرها المكتوب، ودورة سنوية بميزانية، ومقترحات زيادة يعتمدها غير اللي اقترحها. والزيادة المعتمدة توصية — العقد يتغيّر بنسخة عقد جديدة.',
  load:api=>api('/compensation'),
  render(data,{e,button,money,ui=kit(e)}){
    const sar=minor=>`<span class="ltr">${e(money(minor))}</span>`;
    const bands=data.bands.map(b=>`<li class="${b.status==='rejected'?'is-old':''}"><strong>${e(b.category_name)} · مستوى <bdi>${e(b.level)}</bdi> · ${e(b.status==='draft'?'مسودة':b.status==='approved'?'معتمد':'مرفوض')}</strong><span>الأدنى ${sar(b.min_minor)} · الأوسط ${sar(b.mid_minor)} · الأعلى ${sar(b.max_minor)} · يسري من ${dateTag(e,b.effective_from)}</span><small>المصدر: ${e(b.source)} · جهّزه ${e(b.prepared_by_name)}${b.decided_by_name?` · قرّره ${e(b.decided_by_name)}: ${e(b.decision_note)}`:''}</small>${acts(button,b,{approve_band:'اعتماد',reject_band:'رفض'})}</li>`).join('');
    const proposal=p=>`<li class="${['rejected','withdrawn'].includes(p.status)?'is-old':''}"><strong>${e(p.employee_name)} · زيادة ${sar(p.increase_minor)} بالشهر · ${e(p.status_name)}</strong>
      <span>اقترحها ${e(p.proposed_by_name)}${p.salary_hidden?'':` · الحالي ${sar(p.current_monthly_minor)} ${toArrow} ${sar(p.proposed_monthly_minor)}${p.category_name?` · ${e(p.category_name)}`:' · بلا فئة وظيفية'}${p.band_position_name?` · ${e(p.band_position_name)}`:''}${p.band?` (${sar(p.band.min_minor)} – ${sar(p.band.max_minor)})`:''}`}</span>
      <small>المبرر: ${e(p.rationale)}${p.exception_note?` — مبرر الاستثناء: ${e(p.exception_note)}`:''}${p.decision_note?` — القرار: ${e(p.decision_note)}`:''}</small>
      <small class="subtle">${p.calibration?`آخر نتيجة معايرة (للاطلاع بس، والزيادة ما تنحسب منها): ${num(e,p.calibration.final_score)} من ${num(e,p.calibration.scale_max)} — ${e(p.calibration.cycle_name)}${p.calibration.appeal_pending?' · فيه تظلم قيد النظر':''}`:'ما فيه نتيجة معايرة صادرة'}${p.needs_higher_approval?' · يحتاج اعتماد أعلى من غير اللي قيّمه':''}</small>${acts(button,p,proposalLabels)}</li>`;
    const cycles=data.cycles.map(c=>`<section class="vn-group"><h2>${e(c.name)} <span>${e(c.status_name)}</span></h2><p class="subtle">الزيادات تسري من ${dateTag(e,c.increases_effective_from)}${c.budget_source?` · مصدر الميزانية: ${e(c.budget_source)}`:''}</p>
      ${data.reviewer?`<div class="vn-tiles">${tile(e,money(c.budget_minor),'الميزانية الشهرية للزيادات')}${tile(e,money(c.used_minor),'المقترح والمعتمد')}${tile(e,money(c.remaining_minor),c.remaining_minor<0?'المتبقي (فوق الميزانية)':'المتبقي',c.remaining_minor<0?'is-late':'')}</div>`:''}
      ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,{open_cycle:'فتح الدورة',close_cycle:'إغلاق الدورة',propose_increase:'اقتراح زيادة'}[a])).join('')}</div>`:''}
      ${c.proposals.length?`<ul class="vn-list">${c.proposals.map(proposal).join('')}</ul>`:'<p class="subtle">ما فيه مقترحات تخصك في هذي الدورة.</p>'}</section>`).join('');
    const recs=data.recommendations.map(r=>`<li class="${r.status==='open'?'is-due':'is-old'}"><strong>${e(r.employee_name)} · ${sar(r.recommended_monthly_minor)} بالشهر من ${dateTag(e,r.effective_from)}</strong><span>${e(r.status_name)}${r.new_contract?` · العقد الجديد ${e(contractPhrase(r.new_contract.status))} من ${dateTag(e,r.new_contract.start_date)}${r.new_contract.matches_recommendation?'':' · <span class="is-warn-text">ما يطابق المبلغ الموصى به</span>'}`:''}</span>${r.closing_note?`<small>${e(r.closing_note)}</small>`:''}${acts(button,r,recLabels)}</li>`).join('');
    const gap=data.pay_gap;
    const gapHtml=gap?(!gap.available?`<p class="subtle">${e(gap.reason)}</p>`:`<p class="subtle measure">الحد الأدنى للمجموعة ${num(e,gap.min_group_size)} — ${e(gap.basis)}. ${e(gap.note)}</p><ul class="vn-list">${gap.groups.map(g=>g.suppressed?`<li class="is-old"><strong>${e(g.label)}</strong><span>محجوبة: وحدة من المجموعتين أصغر من الحد الأدنى</span></li>`:`<li><strong>${e(g.label)} · فجوة <span class="ltr">${e(pct(g.gap_bp))}</span></strong><span>وسيط النساء ${sar(g.female_median_minor)} (${num(e,g.female_count)}) · وسيط الرجال ${sar(g.male_median_minor)} (${num(e,g.male_count)})</span></li>`).join('')}</ul>`):'';
    // الترتيب: زيادات القارئ نفسه، ثم الدورات وما فيها من عمل، ثم ما ينتظر نسخة عقد، ثم النطاقات والفجوة مرجعًا.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><p class="subtle">${e(data.privacy_note)}</p>${data.actions.length?`<div class="operation-actions">${button('prepare_band','','نطاق راتب')}${button('create_cycle','','دورة مراجعة')}${button('set_gap_privacy','','حد مجموعة فجوة الأجر')}</div>`:''}</section>
      ${data.my_increases.length?`<section class="vn-block"><div class="panel-head"><h2>زياداتي المعتمدة</h2></div><ul class="vn-list">${data.my_increases.map(r=>`<li><strong>${sar(r.recommended_monthly_minor)} بالشهر من ${dateTag(e,r.effective_from)}</strong><span>${e(r.status_name)} — تسري بعد ما تنعتمد نسخة العقد الجديدة</span></li>`).join('')}</ul></section>`:''}
      ${cycles||ui.empty('ما فيه دورة مراجعة تخصك','لما تنفتح دورة مراجعة الرواتب وفيها شي يخصك، يظهر هنا.')}
      ${recs?`<section class="vn-block"><div class="panel-head"><h2>توصيات تنتظر نسخة عقد</h2><p>جهّز النسخة من شاشة العقود («تعديل العقد»)، وبعدها اربطها هنا. التوصية بروحها ما تغيّر العقد.</p></div><ul class="vn-list">${recs}</ul></section>`:''}
      ${data.reviewer?`<section class="vn-block"><div class="panel-head"><h2>نطاقات الرواتب</h2></div>${bands?`<ul class="vn-list">${bands}</ul>`:'<p class="subtle">ما فيه نطاقات للحين — تنضاف من «نطاق راتب» بمصدرها المكتوب.</p>'}</section><section class="vn-block"><div class="panel-head"><h2>فجوة الأجر — أرقام مجمّعة بس</h2></div>${gapHtml}</section>`:''}`;
  },
  form(action,id,data){
    const amount=(name,label,hint)=>field(name,label,'text',{hint:hint??'بالريال، مثل 12500.00',pattern:'^\\d{1,10}(\\.\\d{1,2})?$'});
    if(action==='prepare_band'){guard(data.reviewer);return {title:'نطاق راتب',endpoint:'/compensation/bands',idempotent:true,fields:[field('category_id','الفئة الوظيفية','select',{options:data.categories.map(c=>({value:c.id,label:c.name}))}),field('level','المستوى'),amount('min','الأدنى الشهري'),amount('mid','الأوسط الشهري'),amount('max','الأعلى الشهري'),field('effective_from','يسري من','date'),field('source','المصدر المكتوب','textarea',{hint:'الوثيقة أو القرار ومرجعه. ما ينعتمد نطاق بدون مصدر، واللي يعتمده غير اللي جهّزه.'})],toPayload:v=>({category_id:v.category_id,level:v.level,min:v.min,mid:v.mid,max:v.max,effective_from:v.effective_from,source:v.source})};}
    if(action==='create_cycle'){guard(data.reviewer);return {title:'دورة مراجعة',endpoint:'/compensation/cycles',idempotent:true,fields:[field('name','الاسم'),field('year','السنة','number',{min:2020,max:2100}),amount('budget','الميزانية الشهرية الإجمالية للزيادات','مجموع الزيادات الشهرية المسموح اعتمادها في الدورة كلها'),field('budget_source','مصدر الميزانية وقرار إقرارها','textarea'),field('increases_effective_from','تسري الزيادات من','date')],toPayload:v=>({name:v.name,year:Number(v.year),budget:v.budget,budget_source:v.budget_source,increases_effective_from:v.increases_effective_from})};}
    if(action==='set_gap_privacy'){guard(data.reviewer);return {title:'الحد الأدنى لحجم المجموعة',endpoint:'/compensation/privacy',idempotent:true,fields:[field('min_group_size','الحد الأدنى','number',{min:3,max:500,hint:'أي مجموعة أصغر منه تنحجب كاملة، وما فيه قيمة افتراضية.'}),field('effective_from','يسري من','date'),field('basis','أساسه ومن أقرّه','textarea')],toPayload:v=>({min_group_size:Number(v.min_group_size),effective_from:v.effective_from,basis:v.basis})};}
    if(action==='approve_band'||action==='reject_band'){const b=data.bands.find(x=>x.id===id);guard(b&&b.actions.includes(action));return {title:`${action==='approve_band'?'اعتماد':'رفض'} نطاق — ${b.category_name} ${b.level}`,endpoint:`/compensation/bands/${id}/${action==='approve_band'?'approve':'reject'}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>({version:b.version,note:v.note})};}
    const cycle=data.cycles.find(c=>c.id===id);
    if(cycle&&['open_cycle','close_cycle'].includes(action)){guard(cycle.actions.includes(action));return {title:`${action==='open_cycle'?'فتح':'إغلاق'} — ${cycle.name}`,endpoint:`/compensation/cycles/${id}/${action==='open_cycle'?'open':'close'}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>({version:cycle.version,note:v.note})};}
    if(cycle&&action==='propose_increase'){guard(cycle.actions.includes(action));return {title:`اقتراح زيادة — ${cycle.name}`,endpoint:'/compensation/proposals',idempotent:true,fields:[field('user_id','الموظف','select',{options:cycle.proposable.map(p=>({value:p.id,label:p.name}))}),amount('increase','الزيادة الشهرية','مبلغ مو نسبة. ما تقترح لنفسك، واللي يعتمدها غيرك.'),field('rationale','المبرر','textarea',{hint:'نتيجة التقييم تظهر للمعتمد للاطلاع بس، والزيادة ما تنحسب منها.'})],toPayload:v=>({cycle_id:id,user_id:v.user_id,increase:v.increase,rationale:v.rationale})};}
    if(proposalRoutes[action]){
      const p=data.cycles.flatMap(c=>c.proposals).find(x=>x.id===id);guard(p&&p.actions.includes(action));
      const spec=(fields,toPayload)=>({title:`${proposalLabels[action]} — ${p.employee_name}`,endpoint:`/compensation/proposals/${id}/${proposalRoutes[action]}`,fields,toPayload:v=>({version:p.version,...toPayload(v)})});
      if(action==='assess_proposal')return spec([field('band_id','النطاق المنطبق','select',{required:false,options:[{value:'',label:'ما فيه نطاق معتمد ينطبق'},...p.candidate_bands.map(b=>({value:b.id,label:`مستوى ${b.level}`}))]}),field('exception_note','مبرر الاستثناء (لازم إذا كانت برّا النطاق أو بدون نطاق)','textarea',{required:false})],v=>({band_id:v.band_id||'',exception_note:v.exception_note||''}));
      return spec([field('note',action==='withdraw_proposal'?'سبب السحب':'أساس القرار','textarea')],v=>({note:v.note}));
    }
    const r=data.recommendations.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='link_contract')return {title:`ربط نسخة العقد — ${r.employee_name}`,endpoint:`/compensation/recommendations/${id}/link`,fields:[field('contract_id','نسخة العقد الجديدة','select',{options:r.candidate_contracts.map(c=>({value:c.id,label:`${c.start_date} · ${contractPhrase(c.status)}`})),hint:'تظهر هنا نسخ العقد اللي انسوّت بعد التوصية من «تعديل العقد».'})],toPayload:v=>({version:r.version,contract_id:v.contract_id})};
    return {title:`إسقاط التوصية — ${r.employee_name}`,endpoint:`/compensation/recommendations/${id}/drop`,fields:[field('note','سبب الإسقاط','textarea')],toPayload:v=>({version:r.version,note:v.note})};
  }
};

// ---------- تركيبة القوى العاملة ----------
export const workforceUI={
  title:'تركيبة القوى العاملة',description:'عدد الموظفين وتوزيعهم، واللي دخلوا واللي طلعوا، ومعدل الدوران ونسبة التوطين — من سجلات المنصة.',
  load:api=>api('/workforce'),
  render(data,{e,button}){
    const m=data.movement,s=data.saudization;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${button('simulate','','محاكاة أثر تعيين أو مغادرة')}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,data.headcount,'على رأس العمل')}${tile(e,m.joiners,'دخلوا في الفترة')}${tile(e,m.leavers,'طلعوا في الفترة')}${tile(e,pct(m.turnover_bp),'معدل الدوران')}${tile(e,pct(s.ratio_bp),'نسبة التوطين')}</div>
      <p class="subtle">الفترة من ${dateTag(e,data.period.from)} إلى ${dateTag(e,data.period.to)}</p>
      <div class="vn-alert${s.complete?'':' is-due'}"><strong>${e(s.text)}</strong>${s.complete?'':`<p>الجنسية مو مسجّلة لـ${num(e,s.unrecorded)} من ${num(e,s.active)}، والنسبة محسوبة على ${num(e,s.recorded)} مسجّلين بس.</p>`}</div>
      ${m.without_profile?`<p class="subtle">${num(e,m.without_profile)} على رأس العمل بدون ملف وظيفي، فتاريخ التحاقهم مو معروف وما يدخلون في حساب الفترة.</p>`:''}</section>
      <div class="vn-grid"><section class="vn-block"><div class="panel-head"><h2>التوزيع على الإدارات</h2></div><ul class="vn-list">${data.departments.map(d=>`<li><strong>${e(d.department)}</strong><span>${num(e,d.count)}</span></li>`).join('')}</ul></section>
      <section class="vn-block"><div class="panel-head"><h2>الجنسية المسجّلة</h2></div><ul class="vn-list">${data.people.map(p=>`<li class="${p.nationality_group?'':'is-due'}"><strong>${e(p.name)}</strong><span>${e(p.department)} · ${p.nationality_group?(p.nationality_group==='saudi'?'سعودي':'غير سعودي'):'مو مسجّلة'}${p.source?` · ${e(p.source)}`:''}</span>${data.can_record?`<div class="operation-actions">${button('record_demographics',p.id,p.nationality_group?'تصحيح':'تسجيل')}</div>`:''}</li>`).join('')}</ul></section></div>`;
  },
  form(action,id,data){
    if(action==='simulate')return {title:'محاكاة أثر على نسبة التوطين',endpoint:'/workforce/simulate',fields:[field('hire_saudi','تعيين سعوديين','number',{min:0,max:500,value:0}),field('hire_non_saudi','تعيين غير سعوديين','number',{min:0,max:500,value:0}),field('leave_saudi','مغادرة سعوديين','number',{min:0,max:500,value:0}),field('leave_non_saudi','مغادرة غير سعوديين','number',{min:0,max:500,value:0})],
      toPayload:v=>({hire_saudi:Number(v.hire_saudi||0),hire_non_saudi:Number(v.hire_non_saudi||0),leave_saudi:Number(v.leave_saudi||0),leave_non_saudi:Number(v.leave_non_saudi||0)}),
      after:(r,e)=>({title:'نتيجة المحاكاة',html:`<p>قبل: <span class="ltr">${e(pct(r.before.ratio_bp))}</span> (${num(e,r.before.saudi)} من ${num(e,r.before.recorded)}) <span aria-hidden="true">←</span> بعد: <strong class="ltr">${e(pct(r.after.ratio_bp))}</strong> (${num(e,r.after.saudi)} من ${num(e,r.after.recorded)})</p><p class="subtle">${e(r.note)}</p><p class="subtle">${e(r.text)}</p>`})};
    const p=data.people.find(x=>x.id===id);guard(data.can_record&&p);
    return {title:`بيانات ${p.name}`,endpoint:`/workforce/demographics/${id}`,fields:[field('nationality_group','الجنسية','select',{options:[{value:'saudi',label:'سعودي'},{value:'non_saudi',label:'غير سعودي'}],value:p.nationality_group??''}),field('gender','الجنس (اختياري — بس لتحليل فجوة الأجر المجمّع)','select',{required:false,options:[{value:'',label:'غير مسجّل'},{value:'female',label:'أنثى'},{value:'male',label:'ذكر'}],value:p.gender??''}),field('source','الوثيقة اللي اطّلعت عليها','text',{hint:'نوع الوثيقة بس، بدون رقم هوية أو إقامة.'}),
      // حقل الجنسية قيمتان لا غير، والخليجي خارج جدول خصم التأمينات بقرار المالك: يُسأل هنا حيث تُسجَّل الجنسية،
      // ولا يُعتمد مسير غير سعودي بلا جواب. «نعم» يوقف مسيره حتى يُقرَّر أمره، و«لا» يُسجَّل جوابًا بسنده.
      field('gcc_national','هل هو مواطن خليجي؟ (لغير السعودي بس)','select',{required:false,options:[{value:'',label:'ما انسأل للحين — ما ينعتمد مسيره قبل الجواب'},{value:'no',label:'لا'},{value:'yes',label:'نعم — مواطن خليجي'}],value:''})],
      toPayload:v=>({version:p.version,nationality_group:v.nationality_group,gender:v.gender||'',source:v.source,...(v.gcc_national?{gcc_national:v.gcc_national}:{})})};
  }
};

export const hrCasesCompModules={'hr-cases':hrCasesUI,compensation:compensationUI,workforce:workforceUI};
