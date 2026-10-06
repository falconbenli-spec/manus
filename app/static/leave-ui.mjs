import { icon, LEAVE_ICONS } from './icons.mjs';
import { countLeaveDays, daysText } from './leave-count.mjs';
import { kit } from './kit.mjs';

const statusNames={pending_manager:'بانتظار المدير',pending_authority:'بانتظار صاحب الصلاحية',pending_hr:'بانتظار خدمات الموظف',returned:'معاد للتعديل',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى'};
const actionNames={approve:'اعتماد',return:'إعادة للتعديل',reject:'رفض',cancel:'إلغاء الطلب',resubmit:'تعديل وإعادة تقديم'};
const movementNames={opening:'رصيد افتتاحي',reserve:'حجز للطلب',release:'تحرير الحجز',debit:'خصم بعد الاعتماد',refund:'رد بعد الإلغاء'};
const weekdayNames=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const choose=(rows,id)=>rows.find(row=>row.id===id);
const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const pct=bp=>`${bp/100}%`;
const tiersText=tiers=>tiers.map(t=>`${t.days??'كل الأيام'}${t.days?' يومًا':''} بأجر ${pct(t.rate_bp)}`).join('، ثم ');
// مواد النوع: الخادم يرسلها سطرًا واحدًا (مواد اللائحة ثم مواد النظام). مسودة الشيفرة قبل أي سياسة تُبنى هنا بالقاعدة نفسها.
const articlesOf=t=>t.articles_text??([...(t.articles??[]).map(a=>`م${a}`),...(t.law_articles??[])].join('، ')||'بلا مادة مسجلة');
// القيم التي تتغير تُرسم مجدولة الأرقام: التاريخ في <time> بنصه كما هو، والعدد الخالص بـdata-num، والقيمة الموقّعة في ltr
// فتبقى إشارتها قبل الرقم في السطر العربي. والمرجع أو المعرّف اللاتيني معزول بـ<bdi> فلا تنقلب حوافه.
const when=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const signed=(e,n)=>`<span class="ltr">${e(Number(n)>0?`+${n}`:n)}</span>`;
// المنطقة الزمنية بالعربي حيث نعرف اسمها، وإلا فمعرّفها معزولًا.
const zone=(e,tz)=>tz==='Asia/Riyadh'?'بتوقيت الرياض':`<bdi>${e(tz)}</bdi>`;
// إجازة صُرف خصمها في مسير معتمد (pay_effect_paid من الخادم): صاحبها لا يلغيها بنفسه — الخادم يرفض بـpaid_leave_effect — بل تلغيها خدمات
// الموظف فيُقترح ردّ الخصم. فلا يُرسم له زرّ إلغاء يُرفض، ويُقال له من يلغيها وما يترتب.
const ownPaidCancel=(r,data)=>!!r.pay_effect_paid&&r.employee_id===data.user?.id&&r.actions.includes('cancel');
const PAID_CANCEL='خصم هالإجازة انصرف في مسير معتمد، فإلغاؤها يمر بخدمات الموظف: اطلب منهم يلغونها، ويُقترح ردّ الخصم في أول مسير مفتوح.';
// ما آلت إليه حركة خصم الأثر في الرواتب: حال الأثر في سجله يبقى «مقترحًا» بعد اعتماد خصمه وصرفه، فيُقال هنا بجواره بما حصل فعلًا.
const effectWord=(e,x)=>x.paid_month?`انخصم من مسير ${when(e,x.paid_month)}`:x.deduction_status==='approved'?`خصم معتمد، وينخصم مع مسير ${when(e,x.month)}`
  :x.deduction_status==='rejected'?'انرفض خصمه في الرواتب، فما ينخصم':e(x.status_name);
// السهم في المسار يحمل معنى: يُرى السهم ويُقال بكلمته. والمدى داخل خلية جدول يُكتب «إلى» ظاهرة: نصٌّ مخفي بموضع مطلق يفلت من
// تمرير الجدول الأفقي فيمدّ الصفحة.
const then='<span aria-hidden="true">←</span><span class="sr-only">ثم</span>';
// رمز لاتيني داخل جملة عربية من الخادم (مرجع مصدر، رمز نوع، معرّف سياسة) يُعزل وحده؛ النص نفسه لا يتغير حرفًا.
const latin=(e,text)=>e(text).replace(/(?<![&#\w])(?=[\w.\-\/]*[A-Za-z])[A-Za-z0-9][\w.\-\/]*[A-Za-z0-9](?![\w;])/g,m=>`<bdi>${m}</bdi>`);
const leaveIcon=LEAVE_ICONS;
const orderedTypes=rows=>[...rows].sort((a,b)=>(a.experience?.order??999)-(b.experience?.order??999)||String(a.code).localeCompare(String(b.code)));
const leaveClass=code=>/^[a-z_]+$/.test(code??'')?` lv-type-${code}`:'';

// ── أنواعي وأرصدتي ─────────────────────────────────────────────────────────────
// ما يقال حين لا سياسة أنواع معتمدة بعد: جملة واحدة تقرؤها الشاشة ويقولها الموجّه (whyUnavailable)، فلا يختلف التنبيه عن الصفحة.
const NO_POLICY='أنواع الإجازات وأحكامها من لائحة تنظيم العمل للحين مسودة تنتظر اعتماد مدير الموارد البشرية. لين تنعتمد، تطلب إجازتك من رصيد افتتاحي تضيفه لك خدمات الموظف، وتنحسب بأيام العمل.';
function statutoryHtml(data,{e,button,ui}) {
  const s=data.statutory,head='<h2 id="lv-request">طلب إجازة</h2>';
  if(!s) return `<section class="panel" aria-labelledby="lv-request"><div class="panel-body">${head}<p class="notice">${NO_POLICY}</p></div></section>`;
  const balances=orderedTypes(s.balances),rows=balances.map(b=>{
    // الإجازة التعويضية بالساعات والأيام معًا؛ بلا سياسة ساعات عمل معتمدة تبقى الساعات وتُقال الأيام «ما تنقاس» لا صفرًا.
    const amount=b.compensatory?`${e(b.compensatory.available_hours)} ساعة · ${b.compensatory.available_days===null?'الأيام ما تنقاس للحين':`${e(b.compensatory.available_days)} يوم`}`
      :b.available_days!==null?`${e(b.available_days)} من ${e(b.entitled_days??'—')}`:b.per_event_days?`${e(b.per_event_days)} لكل واقعة`:b.window?`${e(b.window.days_used)} يوم مستخدم في نافذة تبدأ ${when(e,b.window.start)}`:'حسب الحالة';
    return `<tr><td><strong>${e(b.name_ar)}</strong><small>${e(articlesOf(b))}</small></td><td>${e(b.unit_name)}</td><td>${amount}${b.note?`<small>${e(b.note)}</small>`:''}</td><td>${e(b.compensatory?`${b.compensatory.used_hours} ساعة`:b.used_days??'0')}</td><td>${e(b.compensatory?`${b.compensatory.reserved_hours} ساعة`:b.reserved_days??'0')}</td><td>${e(b.source_name)}</td></tr>`;
  }).join('');
  const cards=balances.map(b=>{
    const available=b.compensatory?`${e(b.compensatory.available_hours)} ساعة${b.compensatory.available_days===null?'':` · ${e(b.compensatory.available_days)} يوم`}`
      :b.available_days!==null?`${e(b.available_days)} ${e(b.unit_name)}`:b.per_event_days?`${e(b.per_event_days)} ${e(b.unit_name)} للواقعة`:'حسب الحالة';
    const glyph=leaveIcon[b.experience?.icon]??'calendar';
    return `<article class="leave-type-card${leaveClass(b.code)}"><span class="leave-type-icon" aria-hidden="true">${icon(glyph)}</span><div><strong>${e(b.name_ar)}</strong><small>${e(b.experience?.group==='additional'?'نوع إضافي في سياسة الشركة':b.compensatory?'رصيد مكتسب من ساعات العمل الإضافي المعتمدة':e(b.source_name))}</small></div><b>${available}</b>${s.ready?`<a class="btn outline small" href="#leave/new?kind=${encodeURIComponent(b.code)}">طلب</a>`:''}</article>`;
  }).join('');
  const sick=s.balances.find(b=>b.window),comp=s.balances.find(b=>b.compensatory)?.compensatory;
  // كل قيد تعويضي بمهلته، والتنبيه من 14 يومًا قبلها كما في السياسة. ما انقضت مهلته يبقى ظاهرًا بحالته: يُحال أجرًا ولا يسقط.
  const compHtml=comp?`<h3>رصيدي من الإجازة التعويضية</h3><p class="subtle">المتاح ${num(e,comp.available_hours)} ساعة${comp.available_days===null?'':` (${num(e,comp.available_days)} يوم)`} · المحجوز ${num(e,comp.reserved_hours)} · المستعمل ${num(e,comp.used_hours)} · اللي تحوّل لأجر ${num(e,comp.paid_hours)} ساعة. ${e(comp.days_note)}</p>
    ${comp.lots.length?`<ul class="vn-list">${comp.lots.map(l=>ui.row({title:`عمل ${l.work_date}: ${l.remaining_hours} من ${l.leave_hours} ساعة`,tone:['expiring','due','service_ended'].includes(l.state)?'is-due':l.state==='spent'?'is-old':'',
      meta:`${l.state_name} · المهلة حتى ${l.expires_on} · ${l.overtime_hours} ساعة عمل × ${l.ratio}${l.warning?` · ${l.warning}`:''}`})).join('')}</ul>`:'<p class="subtle">الرصيد ينكسب من ساعات عمل إضافي معتمدة تختار لها الإجازة بدل الأجر في شاشة «الحضور والانصراف»، وللحين ما فيه قيود.</p>'}`:'';
  return `<section class="panel" aria-labelledby="lv-request"><div class="panel-body">${head}
    <p class="subtle">${e(s.title)} · معتمدة وسارية من ${when(e,s.effective_from)}. كل نوع ينحسب بوحدته، وتشوف العدد والرصيد قبل ما ترسل.</p>
    ${s.ready?`<div class="operation-actions">${button('request','new','طلب إجازة جديد')}</div>`:`<p class="notice">${e(s.missing)}</p>`}
    <h3>أرصدتي حسب النوع (${num(e,data.operational_date.slice(0,4))})</h3>
    <div class="leave-type-grid">${cards}</div>
    <details class="leave-balance-details"><summary>تفاصيل الأرصدة والأحكام</summary><div class="table-wrap"><table><thead><tr><th>النوع</th><th>الوحدة</th><th>المتاح</th><th>المستخدم</th><th>المحجوز</th><th>المصدر</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    ${sick?.window?`<p class="subtle">الإجازة المرضية: ${sick.window.tiers.map(t=>`${num(e,t.used)} من ${num(e,t.days)} يوم بأجر ${e(pct(t.rate_bp))}`).join(' · ')} — النافذة حتى ${when(e,sick.window.end)} (م88).</p>`:''}
    ${compHtml}
  </div></section>`;
}

// ── إعداد خدمات الموظف ─────────────────────────────────────────────────────────
function setupHtml(data,{e,button,ui}) {
  const s=data.setup;if(!s) return '';
  const current=s.policies.find(p=>p.status==='accepted'),draft=s.policies.find(p=>p.status==='draft'),shown=draft??current;
  const types=shown?shown.types:s.draft_source.types.map(t=>({...t,unit_name:t.unit==='calendar'?'أيام تقويمية':'أيام عمل',source_name:'',open:t.open??[]}));
  const route=t=>t.routing?.authority==='always'?`المدير ${then} صاحب الصلاحية ${then} خدمات الموظف`
    :t.routing?.authority==='above'?`المدير ${then} خدمات الموظف، وفوق ${num(e,t.routing.threshold_working_days)} أيام عمل يدخل بينهم صاحب الصلاحية`:`المدير ${then} خدمات الموظف`;
  const typeRows=types.map(t=>`<tr><td><strong>${e(t.name_ar)}</strong><small><bdi>${e(t.code)}</bdi> · ${e(articlesOf(t))}</small></td><td>${e(t.unit_name)}</td><td>${e(t.entitlement?.days?`${t.entitlement.days} يومًا ${t.entitlement.period==='year'?'في السنة':t.entitlement.period==='event'?'للواقعة':'في النافذة'}`:t.variants?t.variants.map(x=>x.name_ar).join(' / '):'حسب الحالة')}</td><td>${e(tiersText(t.pay_tiers))}</td><td>${e((t.documents||[]).map(d=>`${d.name_ar}${d.required?' (إلزامي)':''}`).join('، ')||'—')}</td><td>${route(t)}</td></tr>
    <tr><td colspan="6"><small>${latin(e,(t.rules_ar||[]).join(' '))}</small>${t.law_note_ar?`<small><strong>نظام العمل:</strong> ${latin(e,t.law_note_ar)}</small>`:''}${(t.open||[]).length?`<small><strong>سؤال مفتوح:</strong> ${latin(e,t.open.join(' '))}</small>`:''}</td></tr>`).join('');
  // الإصدار 3: كتلة الإجازة التعويضية، وما رُوجع وعلى أي مصدر ومتى، وما لم يُبنَ من حقوق النظام. سياسة أقدم لا تحملها فلا يُرسم منها شيء.
  const source=shown??s.draft_source,c=source.compensatory,basis=source.legal_basis,gaps=source.law_gaps??[];
  const compensatory=c?`<h4>${e(c.label_ar)}</h4><p>كل ساعة عمل إضافية = <strong data-num>${e(c.ratio)}</strong> ساعة إجازة (الحد الأدنى النظامي ${num(e,c.floor_ratio)}) · مهلتها <strong data-num>${e(c.use_within_days)}</strong> يوم من يوم العمل (السقف ${num(e,c.max_use_within_days)}) · سقفها <strong data-num>${e(c.annual_cap_days)}</strong> يوم في السنة · التنبيه قبل نهاية المهلة بـ${num(e,c.warn_days)} يوم.</p><p class="subtle measure">${e(c.articles.join('، '))}. ${latin(e,c.rules_ar.join(' '))}</p>`:'';
  const unpaid=source.unpaid_leave,unpaidHtml=unpaid?`<h4>${e(unpaid.label_ar)}</h4><p>الحد <strong data-num>${e(unpaid.threshold_days)}</strong> يوم · طريقة الحسم من مدة الخدمة: <strong>${e(unpaid.mode_name??'ما انحسمت للحين')}</strong>.</p><p class="subtle measure">${e([...(unpaid.articles??[]),...(unpaid.law_articles??[])].join('، '))}. ${latin(e,(unpaid.rules_ar??[]).join(' '))}</p>${(unpaid.open??[]).length?`<p class="subtle measure"><strong>سؤال مفتوح:</strong> ${latin(e,unpaid.open.join(' '))}</p>`:''}`:'';
  const legal=basis?`<h4>ما رُوجع وعلى أي مصدر</h4><p class="subtle">تاريخ المراجعة ${when(e,basis.checked_on)}.</p><ul>${basis.sources.map(x=>`<li><a href="${e(x.url)}" rel="noopener noreferrer" target="_blank">${e(x.name_ar)}<span class="sr-only"> (تنفتح في تبويب جديد)</span></a></li>`).join('')}</ul>${basis.not_verified.length?`<p class="subtle measure"><strong>يحتاج تأكيد من مصدر رسمي:</strong> ${latin(e,basis.not_verified.join(' '))}</p>`:''}`:'';
  const gapsHtml=gaps.length?`<h4>حقوق نظامية ملاصقة ما انبنت في المنصة للحين</h4><ul class="vn-list">${gaps.map(g=>ui.row({title:`${g.name_ar} — ${g.state_ar}`,meta:`${g.law_articles.join('، ')}: ${g.rule_ar}`})).join('')}</ul>`:'';
  const policyState=current?`<p>السياسة المعتمدة: <strong>${e(current.title)}</strong> · سارية من ${when(e,current.effective_from)}.</p>`:'<p class="subtle">سياسة أنواع الإجازات ما انعتمدت للحين، فالطلب يمشي بالرصيد الافتتاحي وأيام العمل.</p>';
  // مُعدّ المسودة اسمٌ تشغيلي: منه يُعرف من يراجع ومن يعتمد. السياسة المعتمدة تُعرض بنصها وتاريخها وحدهما.
  const draftState=draft?`<p><span class="badge pending">${e(draft.status_name)}</span> أعدّها ${e(draft.prepared_by_name)}، وتسري من ${when(e,draft.effective_from)} إذا انعتمدت.</p>${draft.actions.length?`<div class="form-actions">${draft.actions.map(a=>button(a,draft.id,a==='accept_leave_types'?'اعتماد السياسة (مدير الموارد البشرية)':'رفض المسودة')).join('')}</div>`:''}`
    :s.can_prepare?`<div class="operation-actions">${button('prepare_types','new','إعداد مسودة من نص اللائحة ونظام العمل')}</div>`:'';
  const calendars=s.departments.map(d=>`<tr><td>${e(d.name)}</td><td>${d.calendars.length?d.calendars.map(c=>`${e(c.name)} (${when(e,c.effective_from)} إلى ${when(e,c.effective_to)})`).join('<br>'):'<span class="badge rejected">ما فيه تقويم: موظفين الإدارة ما يقدرون يطلبون إجازة</span>'}</td></tr>`).join('');
  // بيان «لا يُعوَّض» (يوم وطني أو تأسيس داخل عيد، م81) يُعرض بعد الخطة بلا حالة تسجيل: ليس عطلة تُقترح.
  const plan=s.holiday_plan.map(h=>{const known=s.public_holidays.find(x=>x.holiday_date===h.date);return `<li><strong>${e(h.name)}</strong><span>${when(e,h.date)} · ${known?e(known.status==='approved'?'معتمدة':known.status==='proposed'?'مقترحة':'مرفوضة'):'ما انسجّلت'}</span></li>`;}).join('')+(s.holiday_notes??[]).map(n=>`<li><strong>${e(n.name)}</strong><span>${when(e,n.date)}</span></li>`).join('');
  const effects=s.pay_effects.length?`<div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الشهر</th><th>الأيام المتأثرة</th><th>المبلغ المقترح</th><th>الحالة</th></tr></thead><tbody>${s.pay_effects.map(x=>`<tr><td>${e(x.employee_name)}</td><td>${when(e,x.month)}</td><td>${e(x.dates.length)} يوم (${e(x.lost_days)} يوم أجر)</td><td>${x.amount_minor===null?'—':`<span class="ltr">${e((x.amount_minor/100).toFixed(2)+' SAR')}</span>`}</td><td>${e({proposed:'مقترح في المسير — يعتمده حامل تصريح اعتماد الرواتب',unpriced:'بانتظار التسعير — ما دخل المسير للحين',withdrawn:'انسحب بعد إلغاء الإجازة'}[x.status])}${x.adjustment_status?` · الحركة: ${e({proposed:'مقترحة',approved:'معتمدة',rejected:'مرفوضة'}[x.adjustment_status])}`:''}<small>${e(x.note)}</small></td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">إذا انعتمدت أيام مرضية بنسبة 75% أو بلا أجر، أو إجازة بلا أجر، يطلع خصمها هنا مقترح في المسير وما ينعتمد من نفسه. وللحين ما فيه أثر على الأجر.</p>';
  return `<section class="panel" aria-labelledby="lv-setup"><div class="panel-body"><h2 id="lv-setup">إعداد الإجازات</h2>
    <h3>سياسة أنواع الإجازات</h3>${policyState}${draftState}
    <details${draft?' open':''}><summary>الأنواع وأحكامها (${e(types.length)})</summary><div class="table-wrap"><table><thead><tr><th>النوع</th><th>الوحدة</th><th>الاستحقاق</th><th>الأجر</th><th>المستندات</th><th>المسار</th></tr></thead><tbody>${typeRows}</tbody></table></div>${unpaidHtml}${compensatory}${legal}${gapsHtml}<p class="subtle measure">${latin(e,s.draft_source.note)}</p></details>
    <h3>تقويم الإجازات لكل إدارة</h3><p class="subtle">يحدد أيام العمل لكل إدارة وسنة، والموظف ما يقدر يطلب إجازة قبل ما يتجهّز تقويم إدارته.</p>
    ${s.departments.length?`<div class="table-wrap"><table><thead><tr><th>الإدارة</th><th>التقويمات</th></tr></thead><tbody>${calendars}</tbody></table></div>`:''}${s.can_create_calendar?`<div class="operation-actions">${button('calendar','new','إنشاء تقويم إجازات')}</div>`:''}
    <h3>العطل الرسمية</h3><p class="subtle measure">${e(s.holiday_note)}</p>${plan?`<ul class="vn-list">${plan}</ul>`:''}${s.can_propose_holidays?`<div class="operation-actions">${button('holidays','new',`اقتراح عطل ${s.year} الثابتة والعيدين`)}</div>`:''}
    <h3>أثر الإجازات على الأجر</h3>${effects}
  </div></section>`;
}

function legacyBalancesHtml(data,{e,button}) {
  if(!data.balances.length) return '<p class="subtle">الرصيد الافتتاحي تضيفه خدمات الموظف، وللحين ما فيه رصيد افتتاحي في نطاقك. الأنواع النظامية ما تحتاجه، إلا السنوية إذا ما فيه قاعدة استحقاق معتمدة.</p>';
  // صاحب الحركة باسمه حين يكون في نطاق القارئ، وإلا فمعرّفه معزولًا: الدفتر سجل تدقيق، والاسم أقرأ من المعرّف.
  const nameOf=id=>data.employees?.find(p=>p.id===id)?.name;
  return data.balances.map(b=>`<article class="panel"><div class="panel-body"><h3>${e(b.employee_name)} · ${e(b.leave_type_name??b.leave_type)} · ${num(e,b.balance_year)}</h3>
    <dl class="detail-data"><div><dt>الرصيد المقيد</dt><dd>${num(e,b.posted_days)} يوم</dd></div><div><dt>المحجوز للطلبات</dt><dd>${num(e,b.reserved_days)} يوم</dd></div><div><dt>المتاح للطلب</dt><dd>${num(e,b.available_days)} يوم</dd></div><div><dt>سريان الرصيد</dt><dd>${when(e,b.effective_date)}</dd></div></dl>
    <p class="subtle">${e(b.calendar.name)}. الرصيد الافتتاحي من دفتر الحركات، وأرصدة الأنواع النظامية في جدول «أرصدتي حسب النوع».</p>
    ${b.employee_id===data.user.id&&b.available_days>0&&!data.statutory?`<div class="operation-actions">${button('create',b.id,'طلب إجازة من هذا الرصيد')}</div>`:''}
    ${b.ledger.length?`<details><summary>دفتر الحركات (${num(e,b.ledger.length)})</summary><div class="table-wrap"><table><thead><tr><th>الحركة</th><th>الرصيد</th><th>الحجز</th><th>التاريخ الفعلي</th><th>السبب والدليل</th></tr></thead><tbody>
    ${b.ledger.map(l=>`<tr><td>${e(movementNames[l.kind]||l.kind)}${l.request_id?`<small>طلب <bdi>${e(l.request_id.slice(0,8))}</bdi> · نسخة ${num(e,l.revision)}</small>`:''}</td><td>${signed(e,l.posted_delta)}</td><td>${signed(e,l.reserved_delta)}</td><td>${when(e,l.effective_date)}</td><td>${e(l.reason)}${l.evidence?`<small>${e(l.evidence)}</small>`:''}<small>بواسطة: ${nameOf(l.actor_id)?e(nameOf(l.actor_id)):`<bdi>${e(l.actor_id)}</bdi>`} · التسجيل: ${when(e,l.created_at)}</small></td></tr>`).join('')}
    </tbody></table></div></details>`:''}</div></article>`).join('');
}
function requestsHtml(data,{e,button,ui}) {
  if(!data.requests.length) return ui.empty('ما فيه طلبات إجازة','أول ما ترسل طلب، أو يوصلك طلب تعتمده، يظهر هنا بمساره.');
  // ما ينتظر قرار القارئ أو تعديله يتقدّم، والباقي بترتيب الخادم (الأحدث تحديثًا أولًا). الفرز مستقر فلا يتبدّل ترتيب المتساويين.
  const waiting=r=>r.actions.some(a=>a!=='cancel')?1:0;
  return [...data.requests].sort((a,b)=>waiting(b)-waiting(a)).map(r=>{
    const t=r.terms,pay=t?.pay?.length?Object.entries(t.pay.reduce((m,p)=>{m[p.rate_bp]=(m[p.rate_bp]??0)+p.milli/1000;return m;},{})).sort((a,b)=>b[0]-a[0]).map(([bp,d])=>`${num(e,d)} يوم بأجر ${e(pct(Number(bp)))}`).join('، '):'';
    const missing=t?.document_required&&!r.documents.length;
    const actions=r.actions.filter(action=>!(action==='cancel'&&ownPaidCancel(r,data))).map(action=>button(action,r.id,action==='approve'?({pending_manager:'اعتماد المدير',pending_authority:'اعتماد صاحب الصلاحية',pending_hr:'اعتماد خدمات الموظف'}[r.stage]??'اعتماد'):actionNames[action]||action)).join('')+(r.can_attach?button('attach',r.id,'إرفاق مستند'):'');
    const effects=(r.pay_effects||[]).filter(x=>x.status!=='withdrawn');
    const decisions=[...r.decisions.map(d=>({...d,stage_label:d.stage==='manager'?'المدير':'خدمات الموظف'})),...(r.authority_decisions??[]).map(d=>({...d,stage_label:'صاحب الصلاحية'}))];
    return `<article class="panel"><div class="panel-body"><h3>${e(r.employee_name)} · ${e(r.leave_type_name??r.leave_type)} · ${when(e,r.start_date)} إلى ${when(e,r.end_date)}</h3>
    <p><span class="badge ${e(['pending_manager','pending_hr','pending_authority'].includes(r.stage)?'pending':r.status)}">${e(statusNames[r.stage]||r.stage_name||r.status)}</span> · ${num(e,r.days)} ${e(r.unit_name)}${t?.half_day?' (نصف يوم)':''} · رصيد ${num(e,r.balance_year)}</p>
    <p class="subtle">${e(r.reason)}</p>
    ${t?`<p class="subtle">المسار: ${e(t.route_name)} · ${e(t.source_name)}${pay?` · ${pay}`:''}${t.variant_name?` · ${e(t.variant_name)}`:''}${t.event_date?` · تاريخ الواقعة ${when(e,t.event_date)}`:''}</p>`:'<p class="subtle">المسار: المدير ثم خدمات الموظف. التقديم يحجز الأيام، والاعتماد الأخير يخصمها، والإلغاء يفك الحجز أو يرجّع الخصم مرة وحدة.</p>'}
    ${missing?`<p><span class="badge rejected">المستند المطلوب ما انرفق</span> ${e(t.documents_needed.filter(d=>d.required).map(d=>d.name_ar).join('، '))} — المدير ما يعتمده قبل ما ينرفق.</p>`:''}
    ${t?.warnings?.length?`<div class="vn-alert is-due"><strong>تنبيه للمعتمدين</strong><ul>${t.warnings.map(w=>`<li>${latin(e,w)}</li>`).join('')}</ul></div>`:''}
    ${effects.length?`<ul class="vn-list">${effects.map(x=>`<li${x.pending_pricing?' class="is-due"':''}><strong>أثر الأجر — ${when(e,x.month)}</strong>${x.pending_pricing?'<span class="badge pending">بانتظار التسعير</span>':''}<span>${num(e,x.lost_days)} يوم أجر${x.amount_minor===null?'':` · <span class="ltr">${e((x.amount_minor/100).toFixed(2))} SAR</span>`}: ${effectWord(e,x)}</span></li>`).join('')}</ul>`:''}
    ${ownPaidCancel(r,data)?`<p class="subtle">${e(PAID_CANCEL)}</p>`:''}
    ${r.documents.length?`<p class="subtle">المستندات: ${r.documents.map(d=>`${e(d.label)} (<bdi>${e(d.filename)}</bdi>)`).join('، ')}</p>`:''}
    ${actions?`<div class="form-actions">${actions}</div>`:''}
    <details><summary>تفاصيل الطلب وقراراته (${num(e,decisions.length)})</summary><dl class="detail-data"><div><dt>المرجع</dt><dd><bdi>${e(r.id)}</bdi></dd></div><div><dt>النسخة المقدمة / إصدار الحالة</dt><dd>${num(e,r.revision)} / ${num(e,r.version)}</dd></div><div><dt>الأيام المحتسبة</dt><dd>${(t?.counted_dates??r.work_dates).map(d=>when(e,d)).join('، ')}</dd></div></dl>
    ${decisions.length?`<div class="table-wrap"><table><caption class="sr-only">القرارات على الطلب</caption><thead><tr><th>المرحلة والنسخة</th><th>صاحب القرار</th><th>القرار</th><th>السبب</th></tr></thead><tbody>${decisions.map(d=>`<tr><td>${e(d.stage_label)} · ${num(e,d.revision)}</td><td>${e(d.actor_name)}<small>${when(e,d.created_at)}</small></td><td>${e(actionNames[d.decision]||d.decision)}</td><td>${e(d.note||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">للحين ما انسجّل عليه قرار.</p>'}
    ${r.versions.map(version=>`<details><summary>النسخة المقدمة ${num(e,version.revision)}</summary><p class="subtle">${when(e,version.snapshot.start_date)} إلى ${when(e,version.snapshot.end_date)} · ${num(e,version.snapshot.days)} يوم · ${e(version.snapshot.reason)}</p></details>`).join('')}</details></div></article>`;
  }).join('');
}
function calendarsHtml(data,{e,button}) {
  const own=data.calendars.length?data.calendars.map(c=>`<article class="panel"><div class="panel-body"><h3>${e(c.name)}</h3><p class="subtle">من ${when(e,c.effective_from)} إلى ${when(e,c.effective_to)} ${zone(e,c.timezone)}</p><p class="subtle">أيام العمل: ${e(c.weekdays.map(day=>weekdayNames[day]).join('، '))}. العطل المستثناة: ${c.holidays.length?c.holidays.map(h=>when(e,h)).join('، '):'ما فيه عطل معتمدة في هالفترة'}.</p>${data.user.role==='hr'&&c.hr_department_id===data.user.department_id?`<div class="operation-actions">${button('opening',c.id,'إضافة رصيد افتتاحي')}</div>`:''}</div></article>`).join(''):'<p class="subtle">تقويم إجازات نطاقك تجهّزه خدمات الموظف، وللحين ما تجهّز.</p>';
  const entries=data.calendar_entries.length?`<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>النوع / السنة</th><th>الطلب</th></tr></thead><tbody>${data.calendar_entries.map(item=>`<tr><td>${when(e,item.date)}</td><td>${e(item.employee_name)}</td><td>${e(item.leave_type_name??item.leave_type)} / ${e(item.balance_year)}</td><td><bdi>${e(item.request_id.slice(0,8))}</bdi></td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">الإجازة تظهر هنا بأيامها بعد اعتمادها الأخير، وتنشال إذا انلغت. وللحين ما فيه أيام معتمدة في نطاقك.</p>';
  return `${own}
    <h3>الأيام المعتمدة في التقويم</h3>${entries}`;
}

// العدّ الحي في نموذج الطلب: الحساب نفسه الذي يجريه الخادم (leave-count.mjs)، والخادم يعيد التحقق عند الحفظ.
// يُرسم داخل منطقة role=status التي تبنيها app.mjs، فيُعلن عند كل تغيير. التنبيهات (ما سيُرفض) ثم الملاحظات في قائمة واحدة.
export function leavePreview(values,data,e) {
  const s=data.statutory,t=s?.types.find(x=>x.code===values.leave_type);
  if(!t) return '';
  const b=s.balances.find(x=>x.code===t.code),notes=[],warns=[];
  const list=()=>{const items=[...warns.map(w=>`<li><span class="badge rejected">${e(w)}</span></li>`),...notes.map(n=>`<li>${e(n)}</li>`)];return items.length?`<ul>${items.join('')}</ul>`:'';};
  if(t.documents.some(d=>d.required)) notes.push(`لازم ترفق: ${t.documents.filter(d=>d.required).map(d=>d.name_ar).join('، ')} قبل اعتماد المدير.`);
  if(t.min_notice_days) notes.push(`قدّمه قبل ${t.min_notice_days} يوم على الأقل من البداية.`);
  if(t.variants) notes.push(t.variant_optional?`الحالة اختيارية لهذا النوع: اخترها بس إذا تنطبق عليك (${t.variants.map(x=>x.name_ar).join('، ')}).`:'اختر الحالة اللي تناسب هذا النوع.');
  if(t.event_date?.required) notes.push(`${t.event_date.label_ar} مطلوب.`);
  if(t.declaration_ar) notes.push(`يلزم تأكيد الإقرار في النموذج: «${t.declaration_ar}»`);
  if(b?.compensatory) notes.push(`الرصيد بالساعات: المتاح ${b.compensatory.available_hours} ساعة${b.compensatory.daily_hours?`، واليوم ${b.compensatory.daily_hours} ساعات`:''}. ينحسب منه اللي ما انتهت مهلته عند بداية الإجازة، الأقرب أجل أول.`);
  if(!values.start_date||!values.end_date) return `<p>${e(t.name_ar)} تنحسب ${e(t.unit_name)}. اختر التاريخين عشان تشوف العدد والرصيد.</p>${list()}`;
  const half=values.half_day==='on'||values.half_day===true;
  if(half&&!t.half_day) warns.push('نصف اليوم مو متاح لهذا النوع — بس للطارئة والتعويضية.');
  if(b?.compensatory&&b.compensatory.available_days===null) warns.push('ما فيه سياسة «ساعات العمل والحضور» معتمدة تحدد ساعات اليوم، فالطلب بينرفض لين تنعتمد.');
  if(half&&values.start_date!==values.end_date) warns.push('نصف اليوم يكون يوم واحد: خلّ البداية والنهاية نفس اليوم.');
  const cal=s.own_calendars.find(c=>c.effective_from<=values.start_date&&c.effective_to>=values.end_date);
  if(!cal) return `<p><span class="badge rejected">ما فيه تقويم إجازات لإدارتك يغطي هالفترة</span></p>`;
  const count=countLeaveDays({start:values.start_date,end:values.end_date,unit:t.unit,weekdays:cal.weekdays,holidays:cal.holidays,excludeHolidays:t.exclude_public_holidays,halfDay:half&&!!t.half_day});
  const skipped=count.calendar_days-count.counted.length;
  const lines=[`<strong>${e(daysText(count.days_milli))} ${e(t.unit_name)}</strong>${skipped>0?` <small>(${e(skipped)} يوم ${t.unit==='working'?'راحة أو عطلة رسمية':'عطلة رسمية'} ما ينحسب)</small>`:''}`];
  if(b?.available_days!==null&&b?.available_days!==undefined){
    const left=Number(b.available_days)*1000-count.days_milli;
    lines.push(`المتاح ${e(b.available_days)} ${e(t.unit_name)}`);
    if(left<0) warns.push(`يتجاوز المتاح بـ${daysText(-left)} يوم، فالطلب بينرفض.`);
    else lines.push(`يبقى لك بعده ${e(daysText(left))}`);
  }
  if(b?.per_event_days&&count.days_milli>Number(b.per_event_days)*1000) warns.push(`${t.name_ar} ${b.per_event_days} أيام للواقعة الوحدة، فالطلب بينرفض.`);
  if(b?.window) lines.push(`المستخدم في نافذة المرضية ${e(b.window.days_used)} يوم، وشريحة الأجر لكل يوم تنحسب عند الحفظ (م88)`);
  return `<p>${lines.join(' · ')}</p>${list()}`;
}

export const leaveUI={
  title:'الإجازات والأرصدة',
  description:'اطلب إجازتك بنوعها، وشوف رصيدك وطلباتك ووين وصلت.',
  load:async api=>{
    const [data,me]=await Promise.all([api('/leave'),api('/me')]);
    return {...data,user:me.user};
  },
  // «طلب إجازة» في دليل الخدمات يفتح هذه الشاشة على #leave/request فيُفتح النموذج مباشرة.
  autoOpen(segment,data) {
    return segment==='request'&&data.statutory?.ready?{action:'request',id:'new'}:null;
  },
  // م0 «السور»: حين لا يجد الرابط العميق (#leave/request أو #leave/new) زرًّا يضغطه، يقول الموجّه هذا السبب بدل نص عام.
  // السبب يحسبه الخادم (statutory.missing في app/leave.mjs) وتعرضه الشاشة نفسها مكان الزر، فما يُقال في التنبيه هو ما يُقرأ في الشاشة.
  // بلا سياسة أنواع معتمدة أصلًا (statutory غائبة) يقال ما تقوله الشاشة في موضع الطلب. null يترك للموجّه نصه العام.
  whyUnavailable(intent,data) {
    if(!data?.statutory) return NO_POLICY;
    return data.statutory.ready?null:data.statutory.missing??null;
  },
  render(data,context) {
    // العدّة تأتي من app.mjs (ctx.ui). من يرسم الشاشة بلا عدّة (اختبار قديم يمرر e وbutton وحدهما) تُبنى له العدّة نفسها من e، لا نسخة محلية.
    const helpers={...context,ui:context.ui??kit(context.e)},{e}=helpers;
    // الترتيب بأهمية ما تُفتح الشاشة له: الطلب ورصيدي أولًا، ثم الطلبات وما ينتظر قراري، ثم الأرصدة الافتتاحية والتقويم،
    // وإعداد الموارد البشرية (السياسة وتقاويم الإدارات والعطل) آخرها. كل قسم معلَم مسمّى بعنوانه نفسه.
    return `${statutoryHtml(data,helpers)}
      <section aria-labelledby="lv-requests"><div class="panel"><div class="panel-body"><h2 id="lv-requests">الطلبات والموافقات</h2><p class="subtle">اليوم التشغيلي ${when(e,data.operational_date)} ${zone(e,data.timezone)}</p></div></div>${requestsHtml(data,helpers)}</section>
      <section aria-labelledby="lv-openings"><div class="panel"><div class="panel-body"><h2 id="lv-openings">الأرصدة الافتتاحية ودفتر الحركات</h2></div></div>${legacyBalancesHtml(data,helpers)}</section>
      <section class="panel" aria-labelledby="lv-calendar"><div class="panel-body"><h2 id="lv-calendar">التقويم</h2>${calendarsHtml(data,helpers)}</div></section>
      ${setupHtml(data,helpers)}`;
  },
  form(action,id,data) {
    if(action==='request') {
      const s=data.statutory;
      if(!s?.ready) throw new Error('طلب الإجازة يفتح بعد ما تنعتمد أنواع الإجازات ويتجهّز تقويم إدارتك');
      const requestTypes=orderedTypes(s.types),variants=requestTypes.flatMap(t=>(t.variants??[]).map(v=>({value:`${t.code}:${v.key}`,label:`${t.name_ar} — ${v.name_ar}`})));
      return {title:'طلب إجازة',endpoint:'/leave/requests',idempotent:true,submit:'إرسال الطلب',
        fields:[field('leave_type','نوع الإجازة','select',{hint:'اختر النوع أولًا؛ تظهر المدة والرصيد والأحكام قبل الإرسال.',options:requestTypes.map(t=>({value:t.code,label:`${t.name_ar} (${t.unit_name})`}))}),
          field('start_date','بداية الإجازة','date',{min:`${data.operational_date.slice(0,4)}-01-01`}),field('end_date','نهاية الإجازة','date'),
          field('half_day','نصف يوم (للطارئة والتعويضية)','checkbox',{required:false}),
          ...(s.types.some(t=>t.declaration_ar)?[field('declaration',`إقرار (${s.types.filter(t=>t.declaration_ar).map(t=>t.name_ar).join('، ')}): ${s.types.find(t=>t.declaration_ar).declaration_ar}`,'checkbox',{required:false})]:[]),
          ...(variants.length?[field('variant','الحالة (للعدة والامتحان، وأيام الامتحان من السنوية)','select',{required:false,options:[{value:'',label:'— ما ينطبق —'},...variants]})]:[]),
          field('event_date','تاريخ الواقعة (الوضع المرجح أو الوفاة)','date',{required:false}),
          field('document','المستند المطلوب (PDF أو صورة، 2 ميغابايت)','file',{required:false}),
          field('reason','سبب الطلب أو ملاحظة','textarea',{hint:'اكتب ما يساعد المعتمد على اتخاذ القرار من أول مرة، من دون بيانات حساسة غير لازمة.'})],
        live:(values,e)=>leavePreview(values,data,e),
        toPayload:values=>{
          const [code,key]=String(values.variant||'').split(':');
          return {leave_type:values.leave_type,balance_year:Number(String(values.start_date).slice(0,4)),start_date:values.start_date,end_date:values.end_date,reason:values.reason,
            ...(values.half_day==='on'?{half_day:true}:{}),...(values.declaration==='on'&&s.types.find(t=>t.code===values.leave_type)?.declaration_ar?{declaration:true}:{}),...(key&&code===values.leave_type?{variant:key}:{}),...(values.event_date?{event_date:values.event_date}:{}),
            ...(values.document&&typeof values.document==='object'?{document:values.document}:{})};
        }};
    }
    if(action==='attach') {
      const request=choose(data.requests,id);
      if(!request?.can_attach) throw new Error('إرفاق المستند لصاحب الطلب بس، وما دام الطلب قائم');
      const needed=request.terms?.documents_needed?.find(d=>d.required)??request.terms?.documents_needed?.[0];
      return {title:`إرفاق مستند · ${request.leave_type_name}`,endpoint:'/files',
        fields:[field('document',needed?.name_ar??'المستند الداعم','file')],
        toPayload:values=>({entity_type:'leave_request',entity_id:request.id,label:needed?.name_ar??'مستند داعم لطلب الإجازة',filename:values.document?.filename,content:values.document?.content})};
    }
    if(action==='prepare_types') {
      if(!data.setup?.can_prepare) throw new Error('إعداد السياسة لموظفي الموارد البشرية المخوّلين بس');
      const c=data.setup.draft_source.compensatory;
      return {title:'مسودة أنواع الإجازات من نص اللائحة ونظام العمل',endpoint:'/leave/types/draft',idempotent:true,submit:'إعداد المسودة',
        fields:[field('effective_from','تسري من','date',{value:`${data.operational_date.slice(0,4)}-01-01`,hint:'المسودة تروح لمدير الموارد البشرية، وما تسري قبل ما يعتمدها.'}),
          field('compensatory_ratio','ساعات الإجازة التعويضية عن كل ساعة عمل إضافية','number',{value:c.ratio,min:c.floor_ratio,max:4,step:0.25,hint:`ما تقل عن ${c.floor_ratio} (اللائحة التنفيذية م22 مكرر/1)، ويجوز أكثر.`}),
          field('compensatory_use_within_days','مهلة أخذ الإجازة التعويضية بالأيام من يوم العمل','number',{value:c.use_within_days,min:1,max:c.max_use_within_days,step:1,hint:`ما تزيد على ${c.max_use_within_days} يوم (اللائحة التنفيذية م22 مكرر/2). اللي ما ينستعمل لين تنتهي المهلة يرجع أجر وما يسقط.`})],
        toPayload:values=>({effective_from:values.effective_from,compensatory_ratio_bp:Math.round(Number(values.compensatory_ratio)*10000),compensatory_use_within_days:Number(values.compensatory_use_within_days)})};
    }
    if(action==='accept_leave_types'||action==='reject_leave_types') {
      const policy=data.setup?.policies.find(p=>p.id===id);
      if(!policy?.actions.includes(action)) throw new Error('القرار لمدير الموارد البشرية على مسودة ما أعدّها هو');
      return {title:action==='accept_leave_types'?'اعتماد سياسة أنواع الإجازات':'رفض مسودة أنواع الإجازات',endpoint:`/leave/types/${policy.id}/${action==='accept_leave_types'?'accept':'reject'}`,
        fields:[field('note','وش راجعت، وعلى أي أساس قررت','textarea')],toPayload:values=>({note:values.note})};
    }
    if(action==='calendar') {
      if(!data.setup?.can_create_calendar) throw new Error('إنشاء التقويم لموظفي خدمات الموظف المخوّلين بس');
      const year=data.operational_date.slice(0,4);
      return {title:'تقويم إجازات لإدارة',endpoint:'/leave/calendars',idempotent:true,
        fields:[field('employee_department_id','الإدارة','select',{options:data.setup.departments.map(d=>({value:d.id,label:d.name}))}),
          field('name','اسم التقويم','text',{value:`تقويم الإجازات ${year}`}),field('effective_from','يسري من','date',{value:`${year}-01-01`}),field('effective_to','حتى','date',{value:`${year}-12-31`}),
          field('weekdays','أيام العمل','checks',{value:['0','1','2','3','4'],options:weekdayNames.map((name,i)=>({value:String(i),label:name}))})],
        toPayload:values=>({employee_department_id:values.employee_department_id,name:values.name,effective_from:values.effective_from,effective_to:values.effective_to,weekdays:(values.weekdays||[]).map(Number)})};
    }
    if(action==='holidays') {
      if(!data.setup?.can_propose_holidays) throw new Error('اقتراح العطل لموظفي الموارد البشرية المخوّلين بس');
      return {title:'اقتراح العطل الرسمية للسنة',endpoint:'/leave/holidays/statutory',
        fields:[field('year','السنة','number',{value:data.setup.year,min:2000,max:2200,step:1}),
          field('eid_al_fitr_start','أول أيام عيد الفطر (أم القرى)','date',{required:false}),field('eid_al_adha_start','يوم عرفة (أول أيام عطلة الأضحى)','date',{required:false})],
        toPayload:values=>({year:Number(values.year),...(values.eid_al_fitr_start?{eid_al_fitr_start:values.eid_al_fitr_start}:{}),...(values.eid_al_adha_start?{eid_al_adha_start:values.eid_al_adha_start}:{})})};
    }
    if(action==='opening') {
      const calendar=choose(data.calendars,id);
      if(!calendar||data.user.role!=='hr'||calendar.hr_department_id!==data.user.department_id) throw new Error('هذا التقويم خارج نطاق إضافة الرصيد عندك');
      const employees=data.employees.filter(person=>person.department_id===calendar.employee_department_id&&person.id!==data.user.id);
      if(!employees.length) throw new Error('ما فيه موظف مخوّل في نطاق هذا التقويم');
      return {title:`رصيد افتتاحي · ${calendar.name}`,endpoint:'/leave/openings',idempotent:true,
        fields:[field('employee_id','الموظف','select',{options:employees.map(person=>({value:person.id,label:person.name}))}),
          field('leave_type','نوع الإجازة','select',{value:'annual',options:(data.leave_types??[{code:'annual',name:'الإجازة السنوية'}]).map(t=>({value:t.code,label:t.name}))}),
          field('balance_year','سنة الرصيد','number',{value:Number(calendar.effective_from.slice(0,4)),min:2000,max:2200,step:1}),
          field('days','عدد الأيام الافتتاحية (بدون استحقاق افتراضي)','number',{min:1,max:366,step:1}),
          field('effective_date','تاريخ سريان الرصيد','date',{value:calendar.effective_from,min:calendar.effective_from,max:calendar.effective_to}),
          field('reason','سبب إضافة الرصيد','textarea'),field('evidence','سند الرصيد','textarea')],
        toPayload:values=>({employee_id:values.employee_id,leave_type:values.leave_type,balance_year:Number(values.balance_year),days:Number(values.days),effective_date:values.effective_date,reason:values.reason,evidence:values.evidence,calendar_id:calendar.id})};
    }
    if(action==='create') {
      const balance=choose(data.balances,id);
      if(!balance||balance.employee_id!==data.user.id||balance.available_days<=0) throw new Error('ما فيه رصيد متاح لك لهذا الطلب');
      const startMin=balance.effective_date>balance.calendar.effective_from?balance.effective_date:balance.calendar.effective_from;
      return {title:`طلب إجازة · ${balance.leave_type_name??balance.leave_type} · ${balance.balance_year}`,endpoint:'/leave/requests',idempotent:true,
        fields:[field('start_date','بداية الإجازة','date',{min:startMin,max:balance.calendar.effective_to}),field('end_date','نهاية الإجازة','date',{min:startMin,max:balance.calendar.effective_to}),field('reason','سبب الطلب','textarea')],
        toPayload:values=>({leave_type:balance.leave_type,balance_year:balance.balance_year,start_date:values.start_date,end_date:values.end_date,reason:values.reason})};
    }
    const request=choose(data.requests,id);
    if(!request||!request.actions.includes(action)) throw new Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');
    if(action==='cancel'&&ownPaidCancel(request,data)) throw new Error(PAID_CANCEL);
    const version=request.version,endpoint=`/leave/requests/${request.id}/${action}`;
    const declarationOf=r=>data.statutory?.types.find(t=>t.code===r.leave_type)?.declaration_ar??null;
    if(action==='resubmit') return {title:'تعديل نسخة الإجازة وإعادة تقديمها للمدير',endpoint,
      fields:[field('start_date','بداية الإجازة','date',{value:request.start_date}),field('end_date','نهاية الإجازة','date',{value:request.end_date}),
        ...(request.terms?.half_day!==undefined&&request.terms?[field('half_day','نصف يوم (للطارئة والتعويضية)','checkbox',{required:false,value:request.terms.half_day})]:[]),
        ...(declarationOf(request)?[field('declaration',`إقرار: ${declarationOf(request)}`,'checkbox',{required:false})]:[]),
        field('reason','سبب الطلب المعدل','textarea',{value:request.reason})],
      live:request.terms&&data.statutory?(values,e)=>leavePreview({...values,leave_type:request.leave_type},data,e):undefined,
      toPayload:values=>({version,start_date:values.start_date,end_date:values.end_date,reason:values.reason,
        ...(request.terms&&values.half_day==='on'?{half_day:true}:{}),...(declarationOf(request)&&values.declaration==='on'?{declaration:true}:{}),
        ...(request.terms?.variant?{variant:request.terms.variant}:{}),...(request.terms?.event_date?{event_date:request.terms.event_date}:{})})};
    return {title:`${actionNames[action]} · ${request.employee_name}`,endpoint,
      fields:[field('note',action==='approve'?'ملاحظة القرار (اختيارية)':'سبب الإجراء','textarea',{required:action!=='approve'})],
      toPayload:values=>({version,note:values.note||''})};
  }
};
