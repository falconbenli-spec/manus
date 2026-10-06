// سجل المخالفات والجزاءات (ترحيل 097): شاشة الموارد البشرية وصاحب الصلاحية، وصفحة الموظف «مخالفاتي وجزاءاتي».
// المنصة تقترح الجزاء من الجدول المقبول ولا توقعه. الشاشة تعرض المهل النظامية بعد تنازلي، ولا تعرض المبالغ إلا لمن يملكها.
// أهدأ طبقة للحساس: لون التوقف للمهلة الفائتة وللتعارض الحقيقي وحدهما، والمنتهي صامت. نص اللائحة وأرقام موادها بحرفها،
// وجملة المنصة حولها بلهجة الكلام. اسم من سجّل ومن قرّر يبقى على القضية: النظام يشترط أن يقرر غير من سجّل.
import { attachFiles, filesBlock, fileForm } from './files-ui.mjs';
import { dual } from './dates.mjs';
import { kit } from './kit.mjs';

const tr=(ar,en)=>globalThis.document?.documentElement?.lang==='en'?en:ar;
const lang=()=>globalThis.document?.documentElement?.lang==='en'?'en':'ar';
const L=(o,base='')=>o?(lang()==='en'?o[base+'en']??o[base+'ar']:o[base+'ar'])??'':'';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error(tr('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.','This action is not available to you now. Reload the page and check its status.'));};
const tile=(e,value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const bp=n=>`${(n/100).toFixed(n%100?2:0)}%`;
// العدد بصيغة الكلام: يوم، يومين، 3 أيام، 15 يوم. الرقم وحده في عنصره فيُجدول (data-num).
const daysAr=(e,n)=>n===1?'يوم':n===2?'يومين':`<span data-num>${e(n)}</span> ${n<=10?'أيام':'يوم'}`;
const daysEn=(e,n)=>`<span data-num>${e(n)}</span> ${n===1?'day':'days'}`;
const days=(e,n)=>tr(daysAr(e,n),daysEn(e,n));
const wageDays=n=>n===1?'أجر يوم':n===2?'أجر يومين':`أجر ${n} ${n<=10?'أيام':'يوم'}`;
const dayShare=n=>n%10000===0?tr(wageDays(n/10000),`${n/10000} day(s)’ wage`):tr(`${bp(n)} من أجر يوم`,`${bp(n)} of a day’s wage`);
const penaltiesCount=n=>tr(n===1?'جزاء واحد':n===2?'جزاءين':`${n} ${n<=10?'جزاءات':'جزاء'}`,`${n} penalties`);
// التاريخ في <time> بقيمته الآلية، والنص المعروض كما كان (مزدوجًا حيث كان مزدوجًا).
const dateTag=(e,iso,text=dual(iso))=>`<time datetime="${e(String(iso).slice(0,10))}">${e(text)}</time>`;
// قيمة لاتينية داخل نص عربي من الخادم (رمز خانة، عنصر قالب {{…}}، اسم ملف) تُعزل باتجاهها، والنص نفسه لا يُمس.
const isolate=(e,text)=>String(text??'').split(/(\{\{\w+\}\}|[A-Za-z][\w.\-\/@]*\w)/).map((part,i)=>i%2?`<bdi>${e(part)}</bdi>`:e(part)).join('');
const LABELS={
  record_violation:['تسجيل مخالفة','Record a violation'],prepare_schedule:['إعداد نسخة للكيان','Prepare a company version'],accept_schedule:['قبول الجدول','Accept the schedule'],reject_schedule:['رفض النسخة','Reject this version'],
  open_investigation:['بدء التحقيق','Start the investigation'],record_hearing:['محضر جلسة التحقيق','Hearing minutes'],conclude:['نتيجة التحقيق','Investigation finding'],decide:['قرار الجزاء','Decide the penalty'],
  issue_notice:['إصدار إشعار الجزاء','Issue the penalty notice'],record_delivery:['تسجيل الإبلاغ','Record delivery'],answer_grievance:['الرد على التظلم','Answer the grievance'],propose_deduction:['اقتراح الخصم على المسير','Propose the payroll deduction'],
  withdraw:['سحب القضية','Withdraw the case'],close_lapsed:['إغلاق لمضي المدة','Close as time-barred'],upload_file:['رفع دليل','Upload evidence'],submit_defence:['تقديم دفاعي','Submit my defence'],file_grievance:['تقديم تظلم','File a grievance']};
const label=a=>tr(...(LABELS[a]||[a,a]));
const countdown=(e,d)=>d.days_left>1?tr(`باقي ${daysAr(e,d.days_left)}`,`${daysEn(e,d.days_left)} left`)
  :d.days_left===1?tr('باقي يوم','1 day left'):d.days_left===0?tr('اليوم آخر يوم','Today is the last day')
  :d.days_left===-1?tr('فاتت المهلة أمس','1 day past the limit'):tr(`فاتت المهلة من ${daysAr(e,-d.days_left)}`,`${daysEn(e,-d.days_left)} past the limit`);
// الفائتة توقف (أحمر)، والقريبة انتباه (أصفر)، وما عداها صامت: المهلة البعيدة حال عادية لا تُلوَّن.
const tone=d=>d.overdue?'is-late':d.days_left<=5?'is-due':'';
// السند مع كل مهلة كما يرسله الخادم: رقم المادة، أو «مهلة تحددها الشركة» حين لا تنص اللائحة على المدة.
const deadlineChips=(e,c)=>c.deadlines.map(d=>`<span class="vn-flag ${tone(d)}" title="${e(L(d))}">${e(L(d,'basis_'))} · ${countdown(e,d)}</span>`).join('');
const stateTone=s=>['not_proven','withdrawn','lapsed'].includes(s)?'is-old':s==='notified'?'is-ok':['proven','decided'].includes(s)?'is-due':'';
const violationsList=(e,c)=>`<ul class="vn-list">${c.violations.map(x=>`<li><strong><bdi dir="ltr">${e(x.code)}</bdi> — ${e(L(x))}</strong><span>${tr('التكرار رقم','Occurrence')} <span data-num>${e(x.occurrence)}</span> · ${e(tr('المقرر','Scheduled'))}: ${e(L(x,'penalty_'))}</span><small>${e(L(x,'article_'))}${x.uncertain?` · <span class="vn-flag is-warn">${e(tr('خانة ما تأكدت','Uncertain cell'))} <bdi>${e(x.uncertain)}</bdi></span>`:''}</small></li>`).join('')}</ul>`;
// الحقيقة نص يُهرَّب، أو {html} جاهز من صاحبه (تاريخ في <time>، عدد مجدول).
const facts=(e,rows)=>`<dl class="vn-facts">${rows.filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${typeof v==='object'?v.html:e(v)}</dd></div>`).join('')}</dl>`;
const dated=(e,iso)=>iso?{html:dateTag(e,iso)}:'';
// العنوان ترميز جاهز من صاحبه (مهرَّب، وقد يحمل <time>)، والمتن نص يُهرَّب ويُحدّ عرضه للقراءة.
const textBlock=(e,titleHtml,body)=>body?`<div class="vn-block"><h3>${titleHtml}</h3><p class="measure">${e(body).replace(/\n/g,'<br>')}</p></div>`:'';
// أسماء بنود الأجر من الأساس المشترك الذي يرسله الخادم مع اللوحة (cap_basis)، فلا يظهر مفتاح خام مثل housing.
const wageNames=basis=>Object.fromEntries((basis?.wage_components??[]).map((key,i)=>[key,basis.wage_component_names?.[i]??key]));

function caseBody(e,c,{button,data,mine=false}){
  const parts=[];
  parts.push(violationsList(e,c));
  parts.push(facts(e,[[tr('تاريخ المخالفة','Date of the act'),dated(e,c.act_date)],[tr('تاريخ العلم بها','Discovered on'),dated(e,c.discovered_on)],
    [tr('الجزاء المقترح (الأشد، م115)','Proposed penalty (harshest, Art. 115)'),L(c.proposed)],[tr('القرار','Decision'),c.decided?L(c.decided):''],
    [tr('الجزاء النافذ','Penalty in force'),c.decided?(c.effective?L(c.effective):tr('ما فيه جزاء — انلغى بالتظلم','None — cancelled on grievance')):''],
    [tr('المصدر','Source'),c.full?{html:`${e(L(c,'source_'))}${c.source_ref?` · <bdi>${e(c.source_ref)}</bdi>`:''}`}:''],[tr('سجّلها','Recorded by'),c.recorded_by_name??''],
    [tr('المسار','Process'),c.process==='written'?tr('اتهام كتابي وجلسة تحقيق (م117)','Written charge and hearing (Art. 117)'):c.process==='oral'?tr('استجواب شفهي مثبت في محضر (م126/1)','Oral questioning, minuted (Art. 126(1))'):''],
    [tr('قرّره','Decided by'),c.decided_by_name??''],[tr('انبلغ في','Notified on'),dated(e,c.notified_on)]]));
  if(c.full){
    parts.push(textBlock(e,e(tr('الواقعة','The facts')),c.description));
    if(c.source_snapshot?.state)parts.push(`<p class="subtle">${e(tr(`سجل الحضور ذاك اليوم: ${c.source_snapshot.state_name}`,`Attendance record for that day: ${c.source_snapshot.state}`))}${c.source_snapshot.check_in?` · <span class="ltr">${e(c.source_snapshot.check_in)}–${e(c.source_snapshot.check_out??'')}</span>`:''}</p>`);
    parts.push(textBlock(e,`${e(tr('الاتهام المكتوب','Written charge'))}${c.charge_delivered_on?` — ${e(tr('انسلّم','delivered'))} ${dateTag(e,c.charge_delivered_on,c.charge_delivered_on)}`:''}`,c.charge_text));
    parts.push(textBlock(e,`${e(tr(`محضر ${c.process==='oral'?'الاستجواب':'الجلسة'}`,'Minutes'))}${c.hearing_on?` — ${dateTag(e,c.hearing_on,c.hearing_on)}`:''}${c.hearing_by_name?tr(` · ${e(c.hearing_by_name)}`,''):''}`,c.hearing_minutes));
    parts.push(textBlock(e,e(tr('دفاع الموظف المكتوب','Employee’s written defence')),c.defence_text));
    parts.push(textBlock(e,`${e(tr('نتيجة التحقيق','Investigation finding'))}${c.found_by_name?tr(` — ${e(c.found_by_name)}`,''):''}`,c.finding_note));
    parts.push(textBlock(e,e(tr('أساس القرار','Basis of the decision')),c.decision_note));
    parts.push(textBlock(e,e(tr('سبب اختيار جزاء أخف (م113)','Why a lighter penalty (Art. 113)')),c.lighter_reason));
    if(c.notice)parts.push(`<div class="vn-block"><h3>${e(tr('إشعار الجزاء (م121)','Penalty notice (Art. 121)'))}</h3><p>${e(tr('الرقم المرجعي','Reference'))} <bdi dir="ltr">${e(c.notice.reference)}</bdi> · ${dateTag(e,c.notice.issued_on)}</p><div class="operation-actions"><a class="btn outline small" href="${e(c.notice.print_path)}" target="_blank" rel="noopener">${e(tr('فتح الإشعار','Open the notice'))}<span class="sr-only">${e(tr(' (تنفتح في تبويب جديد)',' (opens in a new tab)'))}</span></a></div></div>`);
    if(c.delivery)parts.push(`<p class="subtle">${e(tr('الإبلاغ','Delivery'))}: ${e(L(c.delivery,'method_')||tr('تسليم باليد','By hand'))}${c.delivery.delivered_on?` · ${dateTag(e,c.delivery.delivered_on,c.delivery.delivered_on)}`:''}${c.delivery.reference?` · <bdi>${e(c.delivery.reference)}</bdi>`:''}${c.delivery.refused_to_sign?` · <span class="vn-flag is-warn">${e(tr('رفض يستلم أو يوقّع — لازم يوصله بالبريد المسجل أو بالإيميل المثبت في العقد','Refused to receive or sign — send by registered mail or the contract email'))}</span>`:''}</p>`);
    if(c.grievance)parts.push(`<div class="vn-block"><h3>${e(tr('التظلم — انقدّم','Grievance — filed'))} ${dateTag(e,c.grievance.filed_on,c.grievance.filed_on)} · ${e(tr('آخر يوم للرد','answer due'))} ${dateTag(e,c.grievance.answer_due_on,c.grievance.answer_due_on)}</h3><p class="measure">${e(c.grievance.body).replace(/\n/g,'<br>')}</p>${c.grievance.answer?`<p class="measure"><strong>${e({upheld:tr('انقبل وانلغى الجزاء','Upheld — penalty cancelled'),reduced:tr('تخفّف الجزاء','Penalty reduced'),rejected:tr('انرفض','Rejected')}[c.grievance.outcome]??'')}${c.grievance.new_penalty?`: ${e(L(c.grievance.new_penalty))}`:''}</strong> — ${e(c.grievance.answer)}</p>`:''}${c.grievance.court_note?`<p class="subtle measure">${e(c.grievance.court_note)}</p>`:''}</div>`);
    else if(c.grievance_status&&!mine)parts.push(`<p class="subtle">${e(tr('الموظف رفع تظلم في هذي القضية، ونصه يشوفه صاحب الصلاحية بس.','The employee filed a grievance; its text is for the authority holder only.'))}</p>`);
    if(c.fine)parts.push(`<p class="subtle">${e(tr('الغرامة في السجل','Fine on the register'))}: ${e(dayShare(c.fine.day_bp))}${c.fine.status==='cancelled'?` · ${e(tr('ملغاة','cancelled'))}`:c.fine.outstanding_bp>0?` · ${e(tr('باقي ما انقترح خصمه','not yet proposed'))}: ${e(dayShare(c.fine.outstanding_bp))}`:''}</p>`);
    if(c.decided&&['deprivation','dismissal_award','dismissal_no_award'].includes(c.decided.kind))parts.push(`<p class="subtle">${e(tr('تنفيذ الحرمان من العلاوة أو إنهاء العقد يصير بإجراء مستقل في شاشته، بعد مراجعة نظامية.','Withholding an increment or ending the contract is carried out as a separate step on its own screen, after legal review.'))}</p>`);
    if(c.events?.length)parts.push(`<details><summary>${e(tr('سجل الخطوات','Case history'))} (<span data-num>${e(c.events.length)}</span>)</summary><ul class="vn-list">${c.events.map(ev=>`<li><strong>${e(ev.actor_name??'')} · ${dateTag(e,ev.created_at,ev.created_at.slice(0,10))}</strong><span>${e(ev.body)}</span></li>`).join('')}</ul></details>`);
    parts.push(filesBlock(data,c.id,{e,button}));
  }
  if(c.decision_options)parts.push(`<p class="subtle">${e(tr(`أشد جزاء ممكن الحين: ${L(c.decision_options.max)}. ويقدر صاحب الصلاحية يختار أخف منه بسبب مكتوب (م113).`,`Maximum penalty now: ${L(c.decision_options.max)}. A lighter one needs a written reason (Art. 113).`))}</p>`);
  // قرار بلا قالب إشعار معتمد يقف عند «صدر القرار»: الخادم يقول ما الناقص ومن يوفّره (notice_gate)، فيُقال هنا حيث تقف القضية.
  if(c.notice_gate?.blocked)parts.push(`<div class="vn-alert is-due"><strong>${e(c.notice_gate.consequence)}</strong><p>${isolate(e,c.notice_gate.text)}</p></div>`);
  parts.push(c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,label(a))).join('')}</div>`:'');
  return parts.join('');
}
const caseCard=(e,c,ctx)=>`<details class="vn-card ${stateTone(c.status)}"${c.actions.length?' open':''}><summary><span class="vn-code"><bdi dir="ltr">${e(c.reference)}</bdi></span><span class="vn-name"><strong>${e(c.own?tr('قضيتي','My case'):c.employee_name)} — ${c.violations.map(x=>`<bdi>${e(x.code)}</bdi>`).join('، ')}</strong><small>${e(L(c,'status_'))}</small></span><span class="vn-flags">${deadlineChips(e,c)}</span></summary><div class="vn-body">${caseBody(e,c,ctx)}</div></details>`;
// صحيفة الجزاءات (م122): نوع المخالفة وتاريخها والجزاء الموقع، والملغى بالتظلم يبقى ظاهرًا ملغًى.
const sheetList=(e,rows)=>`<ul class="vn-list">${rows.map(r=>`<li class="${r.cancelled?'is-old':''}"><strong><bdi dir="ltr">${e(r.reference)}</bdi> · ${dateTag(e,r.act_date)}</strong><span>${r.violations.map(x=>`<bdi>${e(x.code)}</bdi> — ${e(L(x))}`).join('؛ ')}</span><small>${e(r.penalty?L(r.penalty):tr('انلغى بالتظلم','Cancelled on grievance'))}</small></li>`).join('')}</ul>`;

function scheduleCard(e,s,button,names){
  // الخلية الفارغة: الشرطة للعين و«ما فيه» اسمًا للخلية — لا نص مخفي بموضع مطلق داخل جدول يمرّ أفقيًا (يفلت من التمرير ويمدّ الصفحة).
  const noneCell=`<td aria-label="${e(tr('ما فيه','None'))}">—</td>`;
  const rows=s.rows.map(r=>`<tr><td><bdi dir="ltr">${e(r.code)}</bdi></td><td>${e(L(r))}${L(r,'note_')?`<br><small class="subtle">${e(L(r,'note_'))}</small>`:''}</td>${[0,1,2,3].map(i=>r.penalties[i]?`<td>${e(L(r.penalties[i]))}</td>`:noneCell).join('')}<td><small>${e(tr(`ص ${r.page}`,`p. ${r.page}`))}${r.extra_deduction?` · ${e(L(r,'extra_deduction_'))}`:''}${r.uncertain?` <span class="vn-flag is-warn"><bdi>${e(r.uncertain)}</bdi></span>`:''}</small></td></tr>`).join('');
  const st=s.settings;
  const wage=tr(`(${st.wage_components.map(k=>names[k]&&names[k]!==k?e(names[k]):`<bdi>${e(k)}</bdi>`).join(' + ')}) ÷ <span data-num>${e(st.day_basis_days)}</span>`,`(${st.wage_components.map(k=>`<bdi>${e(k)}</bdi>`).join(' + ')}) ÷ <span data-num>${e(st.day_basis_days)}</span>`);
  return `<details class="vn-card ${s.status==='accepted'?'is-ok':s.status==='rejected'?'is-old':'is-due'}"><summary><span class="vn-code">${e(s.platform_extract?tr('مستخرج المنصة','Platform extract'):s.status==='accepted'?tr('مقبول','Accepted'):s.status==='rejected'?tr('مرفوض','Rejected'):tr('مسودة','Draft'))}</span><span class="vn-name"><strong>${e(s.title)}</strong><small>${s.effective_from?`${e(tr('يسري من','Effective'))} ${dateTag(e,s.effective_from,s.effective_from)}`:e(tr('ما يسري قبل ما ينقبل','Not in force until accepted'))}${s.decided_by_name?'':` · ${e(tr('جهّزه','Prepared by'))} ${e(s.prepared_by_name)}`}</small></span></summary>
    <div class="vn-body"><p class="subtle measure">${isolate(e,s.basis)}</p>
    ${facts(e,[[tr('نافذة التكرار (م114)','Repeat window (Art. 114)'),{html:days(e,st.repeat_window_days)}],
      [tr('سقف الغرامة للمخالفة وفي الشهر (م116)','Fine cap per violation and per month (Art. 116)'),{html:tr(`أجر ${daysAr(e,st.fine_cap_days_per_violation)} للمخالفة · أجر ${daysAr(e,st.monthly_fine_cap_days)} بالشهر`,`${daysEn(e,st.fine_cap_days_per_violation)}’ wage per violation · ${daysEn(e,st.monthly_fine_cap_days)}’ wage per month`)}],
      [tr('الاستجواب الشفهي حتى (م117، م126/1)','Oral questioning up to (Arts. 117, 126(1))'),dayShare(st.minor_max_day_bp)],
      [tr('مهلتا بدء التحقيق وتوقيع الجزاء (م119، م120)','Limits to investigate and to penalise (Arts. 119–120)'),{html:tr(`${daysAr(e,st.investigation_limit_days)} لبدء التحقيق · ${daysAr(e,st.decision_limit_days)} لتوقيع الجزاء`,`${daysEn(e,st.investigation_limit_days)} to investigate · ${daysEn(e,st.decision_limit_days)} to penalise`)}],
      [tr('التظلم والرد عليه (م126، عدا العطل الرسمية)','Grievance filing / answer (Art. 126, holidays excluded)'),{html:tr(`${daysAr(e,st.grievance_filing_days)} للتظلم · ${daysAr(e,st.grievance_answer_days)} للرد`,`${daysEn(e,st.grievance_filing_days)} to file · ${daysEn(e,st.grievance_answer_days)} to answer`)}],
      [tr('مهلة الدفاع المكتوب (تحددها الشركة)','Written-defence window (company value)'),{html:days(e,st.defence_wait_days)}],[tr('الأجر اليومي','Daily wage'),{html:wage}]])}
    ${s.uncertain.length?`<div class="vn-block"><h3>${e(tr('خانات تحتاج مطابقة مع النسخة الموقّعة','Cells to confirm against the signed copy'))}</h3><ul class="vn-list">${s.uncertain.map(u=>`<li class="${u.confirmation?'':'is-due'}"><strong><bdi>${e(u.id)}</bdi> · ${u.rows.map(x=>`<bdi>${e(x)}</bdi>`).join('، ')}</strong><span>${isolate(e,L(u))}</span>${u.confirmation?`<small>${e(tr('التأكيد','Confirmation'))}: ${isolate(e,u.confirmation)}</small>`:`<small>${e(tr('ما تأكدت للحين. «حسم أجر المدة» الإضافي ما يُطبَّق في أي بند، والغياب ينحسم من مسار الغياب غير المدفوع.','Not confirmed. The extra “deduct the time” column is never applied; absence pay is handled by the unpaid-absence process.'))}</small>`}</li>`).join('')}</ul></div>`:''}
    <details><summary>${e(tr('البنود','Items'))} (<span data-num>${e(s.rows.length)}</span>)</summary><div class="table-wrap"><table><caption class="sr-only">${e(tr('بنود الجدول وجزاء كل مرة تتكرر فيها المخالفة','Schedule items and the penalty for each occurrence'))}</caption><thead><tr><th>${e(tr('البند','Item'))}</th><th>${e(tr('المخالفة','Violation'))}</th><th>${e(tr('أول مرة','1st time'))}</th><th>${e(tr('ثاني مرة','2nd time'))}</th><th>${e(tr('ثالث مرة','3rd time'))}</th><th>${e(tr('رابع مرة','4th time'))}</th><th>${e(tr('السند','Source'))}</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    ${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,label(a))).join('')}</div>`:''}</div></details>`;
}

const fineRow=(e,f,money)=>`<li class="${f.status==='cancelled'?'is-old':f.outstanding_bp>0?'is-due':''}"><strong><bdi dir="ltr">${e(f.reference)}</bdi> — ${e(f.employee_name)}</strong><span>${e(dayShare(f.day_bp))}${f.day_bp!==f.original_day_bp?` (${e(tr('كانت','was'))} ${e(dayShare(f.original_day_bp))})`:''} · ${e(f.status==='cancelled'?tr('ملغاة','Cancelled'):f.outstanding_bp>0?tr(`باقي ما انقترح: ${dayShare(f.outstanding_bp)}`,`Not proposed: ${dayShare(f.outstanding_bp)}`):tr('انقترحت كاملة','Fully proposed'))}${f.collected_minor!==null?` · ${e(tr('المحصّل','Collected'))} <span class="ltr">${e(money(f.collected_minor))}</span>`:''}</span>
  ${f.over_proposed_bp>0?`<small class="vn-flag is-block">${e(tr('المقترح على المسير صار أكثر من الغرامة بعد التظلم: معتمد الرواتب لازم يرفض الحركة الزايدة أو يردّها.','Proposed deductions exceed the fine after the grievance: the payroll approver must reject or refund the excess.'))}</small>`:''}
  ${f.deductions.length?`<ul class="vn-list">${f.deductions.map(d=>`<li><strong><time datetime="${e(d.month)}">${e(d.month)}</time> · ${e(dayShare(d.day_bp))}</strong><span>${d.amount_minor!==null?`<span class="ltr">${e(money(d.amount_minor))}</span> · `:''}${e({proposed:tr('مقترحة تنتظر الاعتماد','Proposed, awaiting approval'),approved:tr('معتمدة','Approved'),rejected:tr('مرفوضة','Rejected')}[d.adjustment_status]??d.adjustment_status)}${d.collected?` · ${e(tr('انحصّلت في مسير معتمد','Collected in an approved run'))}`:''}</span></li>`).join('')}</ul>`:''}</li>`;

export const disciplineUI={
  get title(){return tr('المخالفات والجزاءات','Violations & penalties');},
  get description(){return tr('المخالفات والجزاءات حسب لائحة تنظيم العمل (م111–م126): ما فيه جزاء قبل اتهام وتحقيق ومحضر، واللي يقرر هو صاحب الصلاحية — مو اللي سجّل المخالفة.','Violations and penalties under the work regulations (Arts. 111–126): no penalty without a charge, an investigation and minutes, and the authority holder decides — never whoever recorded the violation.');},
  async load(api){const data=await api('/discipline');return attachFiles(api,data,'discipline_case',data.cases.filter(c=>c.full).map(c=>c.id));},
  render(data,{e,button,money,ui=kit(e)}){
    const open=data.cases.filter(c=>['recorded','investigating','proven','decided'].includes(c.status));
    const soon=data.deadlines.filter(d=>d.overdue||d.days_left<=5),late=data.deadlines.some(d=>d.overdue);
    const record=data.can_record?button('record_violation','',label('record_violation')):'';
    const head=`<section class="panel panel-body vn-head"><p>${e(data.rule)}</p>
      ${data.active_schedule?`<p class="subtle">${e(tr('الجدول الساري','Schedule in force'))}: ${e(data.active_schedule.title)} · ${e(tr('من','from'))} ${dateTag(e,data.active_schedule.effective_from,data.active_schedule.effective_from)}</p>`
        :`<div class="vn-alert is-block"><strong>${e(tr('ما فيه جدول جزاءات مقبول وساري','No accepted penalty schedule is in force'))}</strong><p>${e(tr('ما تتسجّل مخالفة ولا ينقترح جزاء لين يقبل مدير الموارد البشرية الجدول.','Nothing can be recorded or proposed until the HR manager accepts one.'))}</p></div>`}
      ${record?`<div class="operation-actions">${record}</div>`:''}</section>`;
    const tiles=`<div class="vn-tiles">${tile(e,open.length,tr('قضايا مفتوحة','Open cases'),open.length?'is-due':'')}${tile(e,soon.length,tr('مهل تخلص خلال 5 أيام أو فاتت','Limits within 5 days or past'),late?'is-late':soon.length?'is-due':'')}${tile(e,data.grievances.length,tr('تظلمات تنتظر الرد','Grievances awaiting an answer'),data.grievances.length?'is-due':'')}${tile(e,data.cases.filter(c=>c.status==='notified').length,tr('جزاءات انبلّغت','Penalties notified'))}</div>`;
    // المهل لا توجد بلا قضايا: القسم يظهر مع أول قضية، ويقول حين يفرغ إنه فارغ.
    const deadlines=data.cases.length||data.deadlines.length?`<section class="vn-group"><h2>${e(tr('المهل النظامية','Statutory limits'))} <span data-num>${e(data.deadlines.length)}</span></h2>${data.deadlines.length?`<ul class="vn-list">${data.deadlines.map(d=>`<li class="${tone(d)}"><strong><bdi dir="ltr">${e(d.reference)}</bdi> — ${e(d.employee_name)}</strong><span>${e(L(d))} · ${e(L(d,'basis_'))}</span><small>${dateTag(e,d.due_on)} · ${countdown(e,d)}</small></li>`).join('')}</ul>`:`<p class="subtle">${e(tr('ما فيه مهل مفتوحة — تظهر هنا أول ما تتسجّل مخالفة.','No open limits — they appear here once a violation is recorded.'))}</p>`}</section>`:'';
    const nothing=ui.empty(tr('ما فيه قضايا مسجّلة','No cases recorded'),!data.active_schedule?tr('ما تتسجّل مخالفة لين ينقبل جدول الجزاءات.','Nothing can be recorded until a penalty schedule is accepted.')
      :data.can_record?tr('تسجّل المخالفة من «تسجيل مخالفة» فوق، وتظهر هنا مع مهلها.','Record one from “Record a violation” above; it appears here with its limits.'):tr('المخالفات اللي تتسجّل تظهر هنا مع مهلها وخطواتها.','Recorded violations appear here with their limits and steps.'));
    const cases=`<section class="vn-group"><h2>${e(tr('سجل القضايا','Case register'))} <span data-num>${e(data.cases.length)}</span></h2>${data.cases.length?data.cases.map(c=>caseCard(e,c,{button,data})).join(''):nothing}</section>`;
    const names=wageNames(data.cap_basis);
    const schedules=data.schedules.length?`<section class="vn-group"><h2>${e(tr('جدول المخالفات والجزاءات','Penalty schedule'))} <span data-num>${e(data.schedules.length)}</span></h2><p class="subtle">${e(tr('المستخرج من اللائحة مسودة بأرقام البنود والصفحات. ما يسري إلا نسخة للشركة يقبلها مدير الموارد البشرية بتاريخ سريان، واللي يجهّز النسخة ما يقبلها.','The regulation extract is a draft citing items and pages. Only a company version accepted by the HR manager, with an effective date, is in force; whoever prepares a version cannot accept it.'))}</p>${data.schedules.map(s=>scheduleCard(e,s,button,names)).join('')}</section>`:'';
    const fines=data.fines?`<section class="vn-group"><h2>${e(tr('سجل الغرامات (م123)','Fines register (Art. 123)'))} <span data-num>${e(data.fines.rows.length)}</span></h2><p class="subtle measure">${e(L(data.fines,'fund_'))}. ${e(data.fines.note)}</p>
      ${data.fines.liability_minor!==null?`<div class="vn-tiles">${tile(e,money(data.fines.liability_minor),tr('المحصّل — التزام لصندوق منفعة العمال','Collected — owed to the workers’ benefit fund'))}</div>`:''}
      ${data.fines.rows.length?`<ul class="vn-list">${data.fines.rows.map(f=>fineRow(e,f,money)).join('')}</ul>`:`<p class="subtle">${e(tr('ما فيه غرامات مسجّلة — تنضاف هنا أول ما ينبلّغ جزاء غرامة.','No fines yet — a fine is added once its penalty is notified.'))}</p>`}</section>`:'';
    const sheets=data.sheets.length?`<section class="vn-group"><h2>${e(tr('صحائف الجزاءات (م122)','Penalty sheets (Art. 122)'))} <span data-num>${e(data.sheets.length)}</span></h2>${data.sheets.map(s=>ui.card({title:s.employee_name,meta:penaltiesCount(s.rows.length),body:`<div class="vn-body">${sheetList(e,s.rows)}</div>`})).join('')}</section>`:'';
    // بلا جدول ساري لا يتسجّل شيء: الجدول هو ما يفك الشاشة، فيصعد تحت الأرقام مباشرة. ومع جدول ساري يرجع مرجعًا في آخرها.
    return head+`<section class="vn-board">${tiles}${data.active_schedule?'':schedules}${deadlines}${cases}${fines}${sheets}${data.active_schedule?schedules:''}</section>`;
  },
  form(action,id,data){
    const c=data.cases.find(x=>x.id===id),s=data.schedules.find(x=>x.id===id);
    if(action==='record_violation'){
      guard(data.can_record&&data.active_schedule);
      const today=data.today;
      return {title:label(action),endpoint:'/discipline/cases',idempotent:true,fields:[
        field('user_id',tr('الموظف','Employee'),'select',{options:data.employees.map(p=>({value:p.id,label:p.name}))}),
        field('codes',tr('البند المخالف (إذا الفعل الواحد خالف أكثر من بند اختر كلها — يُقترح الأشد، م115)','Violated item(s) — for one act with several, the harshest applies (Art. 115)'),'checks',{options:data.active_schedule.codes.map(r=>({value:r.code,label:`${r.code} — ${lang()==='en'?r.en:r.ar}`}))}),
        field('act_date',tr('تاريخ المخالفة','Date of the act'),'date',{value:today,max:today}),
        field('discovered_on',tr('تاريخ علم الشركة بها (منه تبدأ مهلة الـ30 يوم لبدء التحقيق، م119)','Date the company learned of it (starts the 30-day limit, Art. 119)'),'date',{value:today,max:today}),
        field('source_kind',tr('مصدر الرصد','Source'),'select',{options:data.source_kinds.map(x=>({value:x.key,label:lang()==='en'?x.en:x.ar}))}),
        field('source_ref',tr('مرجع المصدر','Source reference'),'text',{required:false,hint:tr('ليوم الحضور اكتب تاريخ اليوم نفسه بصيغة 2026-09-15. بنود التأخر تبي يوم مسجّل «حاضر متأخر»، وبنود الغياب تبي غياب غير مدفوع معتمد.','For an attendance day: that date as 2026-09-15. Late items need a “late” day; absence items need a confirmed unpaid absence.')}),
        field('description',tr('وصف الواقعة','What happened'),'textarea',{hint:tr('يشوفه الموظف والموارد البشرية وصاحب الصلاحية. التسجيل مو جزاء: لازم بعده اتهام وتحقيق وقرار من شخص ثاني.','Seen by the employee, HR and the authority holder. Recording is not a penalty: a charge, an investigation and another person’s decision follow.')})],
        toPayload:v=>({user_id:v.user_id,codes:v.codes,act_date:v.act_date,discovered_on:v.discovered_on,source_kind:v.source_kind,source_ref:v.source_ref||'',description:v.description})};
    }
    if(action==='prepare_schedule'){guard(s&&s.actions.includes(action));
      return {title:label(action),endpoint:'/discipline/schedules',idempotent:true,fields:[
        field('title',tr('عنوان النسخة','Title'),'text',{value:s.platform_extract?tr('جدول المخالفات والجزاءات المعتمد','Approved penalty schedule'):s.title}),
        field('basis',tr('السند','Basis'),'textarea',{value:s.basis}),
        field('effective_from',tr('تاريخ السريان المقترح','Proposed effective date'),'date',{required:false}),
        field('defence_wait_days',tr('مهلة الدفاع المكتوب بالأيام (اللائحة ما حددتها)','Written-defence window in days (not set by the regulations)'),'number',{min:1,max:30,value:s.settings.defence_wait_days}),
        field('changes',tr('تصحيح خانات بعد المطابقة مع النسخة الموقّعة (اختياري)','Cell corrections after checking the signed copy (optional)'),'rows',{required:false,columns:[{name:'code',label:tr('البند','Item')},{name:'occurrence',label:tr('التكرار 1–4','Occurrence 1–4'),type:'number',min:1,max:4},{name:'penalty',label:'warning · fine:500 · fine:10000 · deprivation · dismissal_award · dismissal_no_award'}],maxRows:50}),
        // خانة «العقوبة المشتركة»: الإزالة خيار أول في القائمة كالإضافة، لأن خطأ الاستخراج الذي يمس الأجر هو خانة أُضيفت إلى بند لا تطبعها الصفحة تحته.
        field('extra_deductions',tr('تصحيح خانة «العقوبة المشتركة» بعد المطابقة مع النسخة الموقّعة (اختياري)','Correcting the “shared penalty” cell after checking the signed copy (optional)'),'rows',
          {required:false,maxRows:50,columns:[{name:'code',label:tr('البند','Item')},
            {name:'extra_deduction',label:tr('الخانة مثل ما هي في الصفحة الموقّعة','The cell as the signed page prints it'),type:'select',
              options:[{value:'none',label:tr('ما فيه خانة عقوبة مشتركة تحت هذا البند','No shared-penalty cell under this item')},...(data.extra_deductions??[]).map(x=>({value:x.key,label:lang()==='en'?x.en:x.ar}))]}],
          hint:tr('بس البنود اللي تحتها خانة مشتركة في الصفحة تشيلها؛ والباقي صحّحه إلى «ما فيه خانة».','Only items the page prints a shared cell under carry one; the rest are corrected to “no cell”.')}),
        ...s.uncertain.map(u=>field('confirm_'+u.id,tr(`تأكيد ${u.id} من النسخة الموقّعة (اختياري)`,`Confirm ${u.id} from the signed copy (optional)`),'textarea',{required:false,hint:L(u)}))],
        toPayload:v=>({source_id:s.id,title:v.title,basis:v.basis,...(v.effective_from?{effective_from:v.effective_from}:{}),settings:{defence_wait_days:Number(v.defence_wait_days)},
          changes:[...(v.changes||[]).map(r=>({code:r.code,occurrence:r.occurrence,penalty:r.penalty==='null'||r.penalty===''?null:r.penalty})),
            ...(v.extra_deductions||[]).map(r=>({code:r.code,extra_deduction:r.extra_deduction==='none'||r.extra_deduction===''?null:r.extra_deduction}))],
          confirmations:Object.fromEntries(s.uncertain.filter(u=>v['confirm_'+u.id]).map(u=>[u.id,v['confirm_'+u.id]]))})};}
    if(action==='accept_schedule'||action==='reject_schedule'){guard(s&&s.actions.includes(action));
      return {title:`${label(action)} — ${s.title}`,endpoint:`/discipline/schedules/${s.id}/${action==='accept_schedule'?'accept':'reject'}`,fields:[
        ...(action==='accept_schedule'?[field('effective_from',tr('تاريخ السريان','Effective date'),'date',{value:s.effective_from??data.today})]:[]),
        field('note',tr('أساس القرار','Basis of the decision'),'textarea',{hint:action==='accept_schedule'?tr('إذا قبلته يصير الجدول أساس اقتراح الجزاءات من تاريخ سريانه. الخانات اللي ما تأكدت تبقى معلّمة، و«حسم أجر المدة» الإضافي ما يُطبَّق.','On acceptance the schedule becomes the basis for proposals from its effective date. Uncertain cells stay flagged; the extra “deduct the time” column is never applied.'):''})],
        toPayload:v=>({...(v.effective_from?{effective_from:v.effective_from}:{}),note:v.note,...(s.platform_extract?{}:{version:s.version})})};}
    if(action==='upload_file'){guard(c);return fileForm('discipline_case',id,c.reference);}
    guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload,extra={})=>({title:`${label(action)} — ${c.reference}`,endpoint:`/discipline/cases/${id}/${action}`,fields,toPayload:v=>({version:c.version,...toPayload(v)}),...extra});
    if(action==='open_investigation'){
      const options=[{value:'written',label:tr('اتهام كتابي ثم جلسة تحقيق (م117)','Written charge, then a hearing (Art. 117)')},...(c.proposed.minor?[{value:'oral',label:tr('استجواب شفهي مثبت في محضر — للإنذار وغرامة حتى أجر يوم (م126/1)','Oral questioning, minuted — for a warning or a fine up to one day (Art. 126(1))')}]:[])];
      return spec([field('process',tr('المسار','Process'),'select',{options}),
        field('charge_text',tr('نص الاتهام المكتوب (للمسار الكتابي)','Written charge (written process)'),'textarea',{required:false}),
        field('charge_delivered_on',tr('تاريخ تسليم الاتهام','Charge delivered on'),'date',{required:false,value:data.today}),
        field('minutes',tr('محضر الاستجواب الشفهي وأقوال الموظف (للمسار الشفهي)','Minutes of the oral questioning and the employee’s answers (oral process)'),'textarea',{required:false}),
        field('questioned_on',tr('تاريخ الاستجواب','Questioned on'),'date',{required:false,value:data.today})],
        v=>v.process==='oral'?{process:'oral',minutes:v.minutes,questioned_on:v.questioned_on}:{process:'written',charge_text:v.charge_text,charge_delivered_on:v.charge_delivered_on});
    }
    if(action==='record_hearing')return spec([field('hearing_on',tr('تاريخ الجلسة','Hearing date'),'date',{value:data.today}),field('minutes',tr('المحضر: أقوال الموظف وتحقيق دفاعه','Minutes: the employee’s statements and the examination of the defence'),'textarea',{maxLength:6000})],v=>({hearing_on:v.hearing_on,minutes:v.minutes}));
    if(action==='conclude')return spec([field('finding',tr('النتيجة','Finding'),'select',{options:[{value:'proven',label:tr('ثبتت المخالفة','Proven')},{value:'not_proven',label:tr('ما ثبتت — تنقفل بدون جزاء','Not proven — closed with no penalty')}]}),field('note',tr('أساس النتيجة','Basis'),'textarea',{hint:tr('إذا ثبتت تبدأ مهلة الـ30 يوم لتوقيع الجزاء (م120).','Proof starts the 30-day limit to impose a penalty (Art. 120).')})],v=>({finding:v.finding,note:v.note}));
    if(action==='decide'){
      const choices=c.decision_options?.choices??[];guard(choices.length);
      return spec([field('penalty',tr('الجزاء','Penalty'),'select',{options:choices.map(x=>({value:x.token,label:`${lang()==='en'?x.en:x.ar}${x.lighter?tr(' — أخف من المقرر',' — lighter than scheduled'):''}`}))}),
        field('note',tr('أساس القرار','Basis of the decision'),'textarea'),
        field('lighter_reason',tr('سبب اختيار جزاء أخف (لازم إذا كان أخف، م113)','Reason for a lighter penalty (required if lighter, Art. 113)'),'textarea',{required:false})],
        v=>({penalty:v.penalty,note:v.note,...(v.lighter_reason?{lighter_reason:v.lighter_reason}:{})}));
    }
    if(action==='issue_notice')return spec([],()=>({}),{submit:label(action)});
    if(action==='record_delivery')return spec([field('method',tr('طريقة الإبلاغ (م121)','Delivery method (Art. 121)'),'select',{options:data.delivery_methods.map(x=>({value:x.key,label:lang()==='en'?x.en:x.ar}))}),
      field('delivered_on',tr('تاريخ الإبلاغ','Delivered on'),'date',{value:data.today}),
      field('reference',tr('المرجع (رقم البريد المسجل أو معرّف الرسالة)','Reference (registered-mail number or message ID)'),'text',{required:false}),
      field('refused_to_sign',tr('رفض يستلم أو يوقّع (في التسليم باليد)','Refused to receive or sign (hand delivery)'),'checkbox',{required:false,hint:tr('إذا رفض لازم يُرسل له بالبريد المسجل أو بالإيميل المثبت في العقد، ويترتب عليه أثره النظامي.','On refusal, send by registered mail or the contract email; that delivery has full legal effect.')})],
      v=>({method:v.method,delivered_on:v.delivered_on,...(v.reference?{reference:v.reference}:{}),refused_to_sign:v.refused_to_sign==='on'}));
    if(action==='answer_grievance'){
      const current=c.effective,order=['warning','fine','deprivation','dismissal_award','dismissal_no_award'],sev=p=>order.indexOf(p.kind)*100000+(p.kind==='fine'?p.day_bp:0);
      const lighter=[{kind:'warning',day_bp:0},...[500,1000,1500,2000,2500,3000,5000,7500,10000,20000,30000,40000].map(n=>({kind:'fine',day_bp:n})),{kind:'deprivation',day_bp:0},{kind:'dismissal_award',day_bp:0}].filter(p=>current&&sev(p)<sev(current));
      const name=p=>p.kind==='fine'?dayShare(p.day_bp):{warning:tr('إنذار كتابي','Written warning'),deprivation:tr('الحرمان من الترقية أو العلاوة لمرة','Loss of promotion or increment, once'),dismissal_award:tr('الفصل مع المكافأة','Dismissal with award')}[p.kind];
      return spec([field('outcome',tr('النتيجة (ما تكون أشد من القرار)','Outcome (never harsher than the decision)'),'select',{options:[{value:'rejected',label:tr('رفض التظلم','Reject')},{value:'reduced',label:tr('تخفيف الجزاء','Reduce the penalty')},{value:'upheld',label:tr('قبول التظلم وإلغاء الجزاء','Uphold and cancel the penalty')}]}),
        field('penalty',tr('الجزاء البديل (للتخفيف بس)','Replacement penalty (reduction only)'),'select',{required:false,options:[{value:'',label:'—'},...lighter.map(p=>({value:p.kind==='fine'?`fine:${p.day_bp}`:p.kind,label:name(p)}))]}),
        field('answer',tr('الرد وأسبابه','Answer and reasons'),'textarea',{hint:tr('يقراه الموظف. وإذا انرفض تظلّمه له يعترض عند المحكمة العمالية خلال 30 يوم.','The employee reads it. If rejected they may object before the labour court within 30 days.')})],
        v=>({outcome:v.outcome,answer:v.answer,...(v.outcome==='reduced'?{penalty:v.penalty}:{})}));
    }
    if(action==='propose_deduction')return spec([field('month',tr('شهر المسير','Payroll month'),'month',{value:data.today.slice(0,7),hint:tr('ينقترح من الغرامة اللي يتسع له سقف أجر خمسة أيام بالشهر (م116)، والباقي في شهر بعده. الحركة تبقى «مقترحة» لين يعتمدها معتمد الرواتب، وما تنقترح وفيه تظلم قائم.','Only what fits under the five-days’-wage monthly cap is proposed (Art. 116); the rest goes to a later month. The movement stays “proposed” until the payroll approver decides, and cannot be proposed during an open grievance.')})],v=>({month:v.month}));
    if(action==='withdraw'||action==='close_lapsed')return spec([field('reason',tr('السبب','Reason'),'textarea')],v=>({reason:v.reason}));
    guard(false);
  }
};

export const myDisciplineUI={
  get title(){return tr('مخالفاتي وجزاءاتي','My violations & penalties');},
  get description(){return tr('المخالفات المسجّلة عليك وكل خطوة فيها: الاتهام والمحضر ودفاعك، والقرار وإشعاره، وتظلّمك. ما يشوفها غيرك إلا الموارد البشرية وصاحب الصلاحية.','Violations recorded against you and every step in them: the charge, the minutes and your defence, the decision and its notice, and your grievance. Only HR and the authority holder see them besides you.');},
  async load(api){const data=await api('/discipline/mine');return attachFiles(api,data,'discipline_case',data.cases.map(c=>c.id));},
  render(data,{e,button,ui=kit(e)}){
    // ما فتح الموظف الصفحة لأجله أولًا: قضاياه وما ينتظره فيها، ثم صحيفته، ثم حقوقه مرجعًا.
    const cases=`<section class="vn-group"><h2>${e(tr('قضاياي','My cases'))} <span data-num>${e(data.cases.length)}</span></h2>${data.cases.length?data.cases.map(c=>caseCard(e,c,{button,data,mine:true})).join('')
      :ui.empty(tr('ما عليك أي مخالفة مسجّلة','No violations are recorded against you'),tr('إذا انسجلت عليك مخالفة تظهر هنا، وتقدر تقدّم دفاعك وتظلّمك من نفس المكان.','If one is ever recorded it appears here, and you can submit your defence and a grievance from here.'))}</section>`;
    const sheet=`<section class="vn-block"><div class="panel-head"><h2>${e(tr('صحيفة جزاءاتي (م122)','My penalty sheet (Art. 122)'))}</h2></div>${data.sheet.length?sheetList(e,data.sheet):`<p class="subtle">${e(tr('صحيفتك ما فيها أي جزاء.','Your sheet has no penalties.'))}</p>`}</section>`;
    const rights=`<section class="vn-block"><div class="panel-head"><h2>${e(tr('حقوقك في اللائحة','Your rights under the regulations'))}</h2></div><ul class="vn-list">${data.rights.map(r=>`<li><span>${e(r)}</span></li>`).join('')}</ul></section>`;
    return `<section class="vn-board">${cases}${sheet}</section>${rights}`;
  },
  form(action,id,data){
    const c=data.cases.find(x=>x.id===id);
    if(action==='upload_file'){guard(false);}
    guard(c&&c.actions.includes(action));
    if(action==='submit_defence')return {title:`${label(action)} — ${c.reference}`,endpoint:`/discipline/cases/${id}/submit_defence`,
      fields:[field('defence',tr('دفاعك المكتوب','Your written defence'),'textarea',{maxLength:6000,hint:tr('ينحفظ في ملفك مع محضر التحقيق، ويقراه صاحب الصلاحية قبل القرار. يتقدّم مرة وحدة.','Kept in your file with the minutes and read by the authority holder before deciding. Submitted once.')})],
      toPayload:v=>({version:c.version,defence:v.defence})};
    return {title:`${label(action)} — ${c.reference}`,endpoint:`/discipline/cases/${id}/file_grievance`,
      fields:[field('body',tr('نص التظلم','Your grievance'),'textarea',{maxLength:6000,hint:tr('يقراه صاحب الصلاحية بس، ويجيك الرد خلال 15 يوم ما عدا العطل الرسمية. تقديمه ما يضرك، وما ينخصم شي في هذي القضية لين يجي الرد (م126).','Only the authority holder reads it; you get an answer within 15 days (official holidays excluded). Filing never harms you, and nothing is deducted in this case until the answer (Art. 126).')})],
      toPayload:v=>({version:c.version,body:v.body})};
  }
};
