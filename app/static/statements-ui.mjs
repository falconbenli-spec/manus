// القوائم المالية وترحيل المستندات إلى الدفتر. الأرقام من القيود المرحّلة فقط.
import { MODULE_STATUS_MAP } from './vocabulary.mjs';
// الجدول والبلاطة والبطاقة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
// م0 «السور»: عبارات حالة القيد من القاموس الواحد (MODULE_STATUS_MAP.journal). «قيد» اسم السجل فلا تُكرَّر في شارته.
const journalStatus=Object.fromEntries(Object.entries(MODULE_STATUS_MAP.journal).map(([key,value])=>[key,value.phrase]));
const typeNames={asset:'أصل',liability:'التزام',equity:'حقوق ملكية',income:'إيراد',expense:'مصروف'};
// المبلغ في نافذة التتبّع بصيغة الشاشة نفسها (money في app/static/operations.mjs): النموذج لا يستلم سياق الرسم، فتُكتب هنا بالقاعدة ذاتها.
const sarText=value=>{if(value===null||value===undefined)return '—';const amount=BigInt(value),absolute=amount<0n?-amount:amount;return `${amount<0n?'-':''}${(absolute/100n).toLocaleString('en-US')}.${String(absolute%100n).padStart(2,'0')} SAR`;};
// الحزمة 3: مطابقة الحسابات الرقابية وتتبّع المبلغ. «موصولة» و«ما فيه» و«ما ينطبق» تقول حال كل حلقة في السلسلة بلا صمت.
const linkStates={linked:['موصولة','is-ok'],none:['ما فيه','is-late'],not_applicable:['ما ينطبق','']};
const matchStates={proposed:'مقترحة بانتظار قرار',approved:'معتمدة',rejected:'مرفوضة'};
const traceId=(kind,id)=>`${kind}:${id}`;
function traceItems(step,e){
  const who=(label,name)=>name?`${label} ${e(name)}`:'';
  if(step.step==='journal')return step.items.map(j=>`<li><strong>قيد <bdi dir="ltr">${e(j.source_reference)}</bdi> · ${e(journalStatus[j.status]??j.status)}</strong><span>${e(j.entry_date)} · ${[who('أعدّه',j.prepared_by_name),who('اعتمده',j.approved_by_name),who('رحّله',j.posted_by_name)].filter(Boolean).join(' · ')}</span>
    <small>${j.lines.map(l=>`<bdi dir="ltr">${e(l.account_code)}</bdi> ${e(l.account_name)} (<bdi dir="ltr">${e(l.cost_center_code)}</bdi>) ${l.debit_minor?`مدين ${e(sarText(l.debit_minor))}`:`دائن ${e(sarText(l.credit_minor))}`}`).join(' · ')}</small></li>`).join('');
  if(step.step==='approvals')return step.items.map(a=>`<li><strong>${e(a.role)}</strong><span>${e(a.actor_name??a.actor_id)}${a.at?` · ${e(String(a.at).slice(0,10))}`:''}</span>${a.note?`<small>${e(a.note)}</small>`:''}</li>`).join('');
  if(step.step==='bank_match')return step.items.map(m=>`<li><strong>سطر كشف <bdi dir="ltr">${e(m.reference)}</bdi> · ${e(m.txn_date)}</strong><span>${e(sarText(m.amount_minor))} · ${e(matchStates[m.status]??m.status)}${m.decided_by_name?` · قرّرها ${e(m.decided_by_name)}`:''}</span></li>`).join('');
  return step.items.map(i=>`<li><strong>${e(i.kind_name??i.kind)} · <bdi dir="ltr">${e(i.reference??i.journal_id??'')}</bdi></strong><span>${i.amount_minor!==undefined?`${e(sarText(i.amount_minor))} · `:''}${e(i.date??String(i.created_at??'').slice(0,10))}${i.journal?` · قيده ${e(journalStatus[i.journal.status]??i.journal.status)}`:step.step==='source'?'':i.status&&i.kind==='journal_reversal'?` · ${e(journalStatus[i.status]??i.status)}`:' · ما له قيد'}${i.requested_by_name?` · طلبه ${e(i.requested_by_name)}`:''}</span>${i.reason?`<small>${e(i.reason)}</small>`:''}</li>`).join('');
}
function traceHtml(t,e){
  const head=t.document?`<p><strong>${e(t.kind_name)}</strong> · <bdi dir="ltr">${e(t.document.reference)}</bdi> · ${e(sarText(t.document.amount_minor))} · ${e(t.document.date)}</p>`:`<p><strong>${e(t.kind_name)}</strong></p>`;
  const steps=t.chain.map(step=>{const [name,tone]=linkStates[step.state]??[step.state,''];
    return `<li class="${tone}"><strong>${e(step.name)}</strong> <span class="vn-flag ${tone}">${e(name)}</span>${step.why?`<p class="subtle">${e(step.why)}</p>`:''}${step.items.length?`<ul class="vn-list">${traceItems(step,e)}</ul>`:''}</li>`;}).join('');
  return `${head}${t.breaks.length?`<div class="vn-alert is-due"><strong>السلسلة تنقطع في ${e(t.breaks.length===1?'موضع واحد':t.breaks.length===2?'موضعين':`${t.breaks.length} مواضع`)}</strong><p>${e(t.breaks.map(b=>b.name).join('، '))}</p></div>`:'<p class="subtle">السلسلة موصولة من المستند لين آخر حلقة.</p>'}<ol class="vn-list">${steps}</ol>`;
}
function controlsHtml(report,{e,button,money,ui}){
  if(!report?.controls?.length)return '';
  // الفرق بإشارته داخل العزل، والعملة في رأس العمود. الحال كلمةٌ وشكل: المتطابق صامت، والفرق بشكل التوقف، والذي بلا حساب ينتظر.
  const fig=v=>v===null||v===undefined?'—':`<span class="ltr">${e(money(v,'').trim())}</span>`;
  const state=c=>!c.mapped?['ما له حساب مربوط','is-due']:c.balanced?['متطابق','is-ok']:['فيه فرق','is-late'];
  const summary=ui.table({head:['الحساب الرقابي','الأستاذ المساعد (ريال)','الدفتر (ريال)','الفرق (ريال)','الحال'],rows:report.controls.map(c=>{const [name,tone]=state(c);
    return `<tr class="${tone}"><td>${e(c.name)}${c.accounts.length?` <small>${c.accounts.map(a=>`<bdi dir="ltr">${e(a.code)}</bdi>`).join('، ')}</small>`:''}</td><td>${fig(c.subledger_minor)}</td><td>${c.ledger_minor===null?'—':fig(c.ledger_minor)}</td><td>${c.difference_minor===null?'—':fig(c.difference_minor)}</td><td>${e(name)}${c.why?` <small>${e(c.why)}</small>`:''}</td></tr>`;})});
  const traceButton=i=>i.source_kind!=='manual'&&i.source_id&&!String(i.source_id).startsWith('invoice:')?button('trace_amount',traceId(i.source_kind,i.source_id),'تتبّع المبلغ'):i.journal_id?button('trace_amount',traceId('journal',i.journal_id),'تتبّع القيد'):'';
  // بطاقة كل فرق تبدأ بمبلغه: هو ما يُقرَّر عليه، وبنوده تحته تفسّره كله.
  const details=report.controls.filter(c=>c.items.length).map(c=>`<details class="vn-card is-late"><summary><span class="vn-code"></span><span class="vn-name"><strong>${e(c.name)}</strong><small><span data-num>${e(c.items.length)}</span> بند يفسّر الفرق كله</small></span><span class="vn-flags"><strong>الفرق ${fig(c.difference_minor)} ريال</strong></span></summary>
    <div class="vn-body">${ui.table({head:['المستند أو القيد','السبب','المستند (ريال)','الدفتر (ريال)','الفرق (ريال)','الإجراء'],rows:c.items.map(i=>`<tr><td>${e(i.source_name)} · <bdi dir="ltr">${e(i.reference)}</bdi> <small><time datetime="${e(i.date)}">${e(i.date)}</time></small></td><td>${e(i.reason_name)}${i.note?` <small>${e(i.note)}</small>`:''}</td><td>${fig(i.subledger_minor)}</td><td>${fig(i.ledger_minor)}</td><td>${fig(i.difference_minor)}</td><td>${traceButton(i)}</td></tr>`)})}</div></details>`).join('');
  return `<section class="vn-block"><div class="panel-head"><h2>مطابقة الحسابات الرقابية لين <time datetime="${e(report.as_of)}">${e(report.as_of)}</time></h2><p>${e(report.basis)}</p></div>${summary}${details}</section>`;
}

export const statementsUI={
  title:'القوائم المالية والترحيل',description:'قائمة الدخل والمركز المالي وكشوف العملاء وملخص الضريبة، وترحيل المستندات للدفتر بقيد ينعتمد وينرحّل باستقلال، ومطابقة الحسابات الرقابية بمستنداتها وتتبّع كل مبلغ من مصدره لين البنك.',
  // القوائم ومطابقة الحسابات الرقابية معًا: النداءان للقراءة، ومن لا يحمل تفويض القراءة يُرفض في الأول كما كان.
  load:async api=>{const [statements,controls]=await Promise.all([api('/ledger/statements'),api('/ledger/reconciliation')]);return {...statements,controls};},
  render(data,{e,button,money,ui=kit(e)}){
    const prepare=data.permissions.includes('prepare'),approve=data.permissions.includes('approve');
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية، والسالب بإشارته داخل العزل ومعه كلمته؛ والعملة في رأس العمود وفي تسمية البلاطة.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const signed=(v,word='سالب')=>Number(v)<0?`${fig(v)} <small>${e(word)}</small>`:fig(v);
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    // جدول القائمة: الحساب ثم المبلغ، وصف الإجمالي رأس صف. الحساب بلا حركة لا يُكتب، ويُقال ذلك.
    const statement=(title,list,totalLabel,total)=>`<section class="vn-block"><div class="panel-head"><h3>${e(title)}</h3></div>${ui.table({head:['الحساب','المبلغ (ريال)'],
      rows:[...(list.length?list.map(r=>`<tr><td><bdi dir="ltr">${e(r.code)}</bdi> · ${e(r.name)}</td><td>${signed(r.amount_minor)}</td></tr>`):['<tr><td class="subtle">ما فيه حركة مرحّلة</td><td>—</td></tr>']),
        `<tr><th scope="row">${e(totalLabel)}</th><td><strong>${signed(total)}</strong></td></tr>`]})}</section>`;
    const is=data.income_statement,bs=data.balance_sheet,loss=is.net_minor<0;
    // المستند الذي ينتظر قيده هو الخطوة الجاية للمُعدّ: يصعد مع الربط الذي ينتظر اعتماد القارئ.
    const sourceRow=s=>{const next=!s.journal_status&&prepare;
      return `<li class="${next?'is-decision':!s.journal_status?'is-due':''}"><strong>${e(s.source_name)} · <bdi dir="ltr">${e(s.reference)}</bdi></strong>${next?'<span class="badge is-decision">ينتظر قيدك</span>':''}<span>${fig(s.amount_minor)} ريال · ${day(s.date)} · ${e(s.journal_status?journalStatus[s.journal_status]:'ما انعدّ قيده')}</span><div class="operation-actions">${next?button('journal_from_source',traceId(s.source_kind,s.source_id),'إعداد القيد'):''}${button('trace_amount',traceId(s.source_kind,s.source_id),'تتبّع المبلغ')}</div></li>`;};
    const waitingSources=data.sources.filter(s=>!s.journal_status&&prepare),otherSources=data.sources.filter(s=>!waitingSources.includes(s));
    // الغرض المعطَّل يبقى معروضًا موسومًا: ربطه المعتمد ما زال ساريًا وما زال الدفتر يبني القيود منه، فإخفاؤه
    // من الشاشة الوحيدة التي تعرضه يجعل قرار حسابٍ لكل فاتورة غير مرئي. والوسم يقول **لماذا** هو هنا رغم تعطيله.
    const purposeState=m=>m.state==='disabled'?' <span class="vn-flag is-late">معطَّل — ربطه ما زال ساريًا</span>':'';
    // مراكز تكلفة الإدارات (الحزمة 4، الترحيل 174): رواتب كل موظف على مركز إدارته في آخر الشهر. الإدارة بلا مركز معتمد توقف قيد المسير باسمها،
    // فتُقال هنا قبل أن يُضغط «إعداد القيد». والربط المنتظر يقرره زميل غير من سجّله؛ والأزرار من أفعال الخادم وحدها.
    const dc=data.department_centres;
    const centres=dc?`<section class="vn-block"><h3>مراكز تكلفة الإدارات</h3><p class="subtle measure">${e(dc.rule)}</p>
      ${ui.table({head:['الإدارة','المركز الساري اليوم','يسري من'],rows:dc.rows.map(r=>`<tr class="${r.active?'':'is-late'}"><td>${e(r.department_name)}</td><td>${r.active?`<bdi dir="ltr">${e(r.active.code)}</bdi> · ${e(r.active.centre_name)}`:'ما لها مركز معتمد — قيد مسيرها يوقف'}</td><td>${r.active?`<time datetime="${e(r.active.effective_from)}">${e(r.active.effective_from)}</time>`:'—'}</td></tr>`),
        empty:{title:'ما فيه إدارات نشطة',body:'الإدارات تنضاف من الهيكل التنظيمي.'}})}
      ${dc.pending.length?`<h3>ربط ينتظر قرار زميل</h3><ul class="vn-list">${dc.pending.map(p=>`<li><strong>${e(p.department_name)} ← <bdi dir="ltr">${e(p.code)}</bdi> ${e(p.centre_name)}</strong><span>سجّله ${e(p.recorded_by_name)} · يسري من <time datetime="${e(p.effective_from)}">${e(p.effective_from)}</time></span><small>${e(p.reason)}</small>${p.actions.length?`<div class="operation-actions">${p.actions.includes('approve_department_centre')?button('approve_department_centre',p.id,'اعتماد المركز'):''}${p.actions.includes('reject_department_centre')?button('reject_department_centre',p.id,'رفض المركز'):''}</div>`:''}</li>`).join('')}</ul>`:''}
      ${dc.can_record?`<div class="operation-actions">${button('record_department_centre','','ربط إدارة بمركز تكلفة')}</div>`:''}</section>`:'';
    const mappings=data.mappings.map(m=>`<li class="${m.active?(m.state==='disabled'?'is-due':''):'is-late'}"><strong>${e(m.name)}</strong>${purposeState(m)}<span>${m.active?`<bdi dir="ltr">${e(m.active.code)}</bdi> · ${e(m.active.account_name)} · من ${day(m.active.effective_from)}`:'ما له ربط معتمد'}</span><small>نوع الحساب المطلوب: ${e(typeNames[m.account_type]??'غير محدَّد')}</small></li>`).join('');
    const decideMapping=m=>approve&&m.recorded_by!==data.user_id;
    const pendingRow=m=>`<li class="${decideMapping(m)?'is-decision':'is-pending'}"><strong>${e(data.purposes.find(p=>p.key===m.purpose)?.name)} ← <bdi dir="ltr">${e(m.code)}</bdi> ${e(m.account_name)}</strong>${decideMapping(m)?'<span class="badge is-decision">ينتظر اعتمادك</span>':''}<span>يسري من ${day(m.effective_from)}${decideMapping(m)?'':' · ينتظر اعتماد زميل ثاني'}</span>${decideMapping(m)?`<div class="operation-actions">${button('approve_mapping',m.id,'اعتماد الربط')}</div>`:''}</li>`;
    const customers=data.customers.map(c=>{const owes=c.balance_minor>0,credit=c.balance_minor<0;
      return `<details class="vn-card"><summary><span class="vn-code">${c.movements.length?day(c.movements.at(-1).date):''}</span><span class="vn-name"><strong>${e(c.name)}</strong><small>مفوتر ${fig(c.invoiced_minor)} · إشعارات ${fig(c.credited_minor)} · مقبوض ${fig(c.received_minor)}</small></span><span class="vn-flags"><strong>الرصيد ${fig(c.balance_minor)} ريال</strong><span class="vn-flag ${owes?'pending':credit?'is-due':'paid'}">${owes?'رصيد مستحق على العميل':credit?'رصيد دائن للعميل':'مسدّد'}</span></span></summary><div class="vn-body">${ui.table({head:['التاريخ','المرجع','الحركة','الأثر على الرصيد (ريال)'],rows:c.movements.map(m=>`<tr><td>${day(m.date)}</td><td><bdi dir="ltr">${e(m.reference)}</bdi></td><td>${e(m.kind)}</td><td><span class="ltr">${m.amount_minor>0?'+':''}${e(num(m.amount_minor))}</span></td></tr>`)})}</div></details>`;}).join('');
    // ───── الخيارات المُدارة (الترحيل 134) ─────
    // قسم للقراءة: يرى المالك كل قائمة مهمة في المنصة وخياراتها وحالتها ومن يملكها، ومادتها أو قيدها حين تكون مقفلة،
    // ومن غيّر ماذا ولماذا ومتى. والتعديل من شاشة «الخيارات والقيم المعتمدة».
    const board=data.managed_options;
    const optionStateName=o=>o.awaiting_second_person?'ينتظر اعتماد شخص ثاني':o.state==='disabled'?(o.disabled_from?`معطَّل من ${day(o.disabled_from)}`:'معطَّل في الكود — لم يفعّله المالك بعد'):'نشط';
    const optionTone=o=>o.awaiting_second_person?'is-pending':o.state==='disabled'?'is-old':'';
    const optionsTable=list=>ui.table({head:['الخيار','القيمة المخزَّنة','الحالة','مصدره'],
      rows:list.options.map(o=>`<tr class="${optionTone(o)}"><td>${e(o.label)}</td><td><bdi dir="ltr">${e(o.value)}</bdi></td><td>${optionStateName(o)}</td><td><small>${e(o.source)}</small></td></tr>`),
      empty:{title:'ما فيه خيارات في هالقائمة للحين',body:'القائمة موجودة وما انضاف لها خيار للحين.'}});
    const changesTable=list=>list.changes.length?ui.table({head:['التغيير','الخيار','التصنيف','السبب','يسري من'],
      rows:list.changes.map(c=>`<tr><td>${e({added:'إضافة',disabled:'تعطيل',enabled:'إعادة تفعيل',reordered:'إعادة ترتيب',relabelled:'إعادة تسمية'}[c.change])}</td><td><bdi dir="ltr">${e(c.value)}</bdi></td><td>${e({additive:'إضافة',tightening:'تشديد',loosening:'تخفيف'}[c.class])}</td><td>${e(c.reason)}</td><td>${day(c.effective_on)}</td></tr>`)}):'';
    const lockNote=list=>list.governance==='legally_fixed'?`<p class="subtle">مثبّتة بـ${e(list.article.ref)}${list.article.source?` — ${e(list.article.source)}`:''}. تنقرا وما تتوسّع من المنصة.</p>`
      :list.governance==='db_locked'?`<p class="subtle">مقفلة بقيد في قاعدة البيانات منذ الترحيل ${e(list.db_locked.migration)}: <code dir="ltr">${e(list.db_locked.check)}</code>. فتحها يحتاج ترحيل يعيد بناء الجدول.</p>`
      :list.bound?`<p class="subtle">محدودة بحارس: ${e(list.bound.because)} (الحدّ الأدنى ${e(list.bound.floor)}).</p>`:'';
    const optionLists=(board?.lists??[]).map(list=>ui.card({code:String(list.active_count),
      title:list.label,meta:`${list.governance_name} · يملكها: ${list.owner}${list.second_person?' · الخيار الجديد ينتظر شخص ثاني':''}`,
      body:`<div class="vn-body">${lockNote(list)}${list.note?`<p class="subtle measure">${e(list.note)}</p>`:''}${optionsTable(list)}${changesTable(list)}</div>`})).join('');
    const adoptedRows=(board?.adopted??[]).map(a=>`<tr><td>${e(a.label)}</td><td><bdi dir="ltr">${e(JSON.stringify(a.value))}</bdi></td><td>${e({code_default:'قيمة المنصة الافتراضية — ما قرّرها أحد للحين',adopted:'قرار معتمد',legal_schedule:'جدول مثبّت نظامًا'}[a.source])}</td><td>${a.effective_from?day(a.effective_from):'—'}</td><td>${e(a.basis)}${a.article?` <small>(${e(a.article)})</small>`:''}</td></tr>`).join('');
    const managed=board?`<section class="vn-group"><h2>الخيارات المُدارة <span>${(board.lists??[]).length}</span></h2>
      <p class="subtle measure">تتعدّل هالقوائم وقيمها من شاشة <a href="#options">الخيارات والقيم المعتمدة</a> لمن يحمل تصريحها: كل تغيير بسبب وتاريخ، والقيمة ما تسري إلا إذا اعتمدها شخص ثاني.</p>
      ${optionLists}
      ${adoptedRows?`<section class="vn-block"><div class="panel-head"><h3>قيم باعتماد مؤرَّخ</h3></div>${ui.table({head:['القيمة','ما هي الحين','مصدرها','تسري من','أساسها'],rows:[adoptedRows]})}</section>`:''}</section>`:'';
    const waitingMappings=data.pending_mappings.filter(decideMapping).map(pendingRow).join('');
    const vatNet=data.vat.net_vat_minor;
    return `<section class="panel panel-body vn-head">${prepare?`<div class="operation-actions">${button('record_mapping','','ربط غرض بحساب')}</div>`:''}<p>${e(data.basis)} الفترة: من ${day(data.from)} لين ${day(data.to)}.</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(num(is.total_income_minor),'إيرادات الفترة بالريال')}${ui.tile(num(is.total_expenses_minor),'مصروفات الفترة بالريال')}${ui.tile((loss?'⁦':'')+num(is.net_minor)+(loss?'⁩':''),loss?'صافي الفترة بالريال — خسارة':'صافي الفترة بالريال',loss?'is-late':'')}${ui.tile(data.unposted,'مستند ما انرحّل قيده',data.unposted?'is-due':'')}</div></section>
      ${waitingSources.length?`<section class="vn-block"><div class="panel-head"><h2>مستندات بانتظار الترحيل <span data-num>(${waitingSources.length})</span></h2><p>قيدها ينعدّ من هنا مسودة بأرقام المستند، وبعدها يعتمده ويرحّله غيرك من «الدفتر المالي».</p></div><ul class="vn-list">${waitingSources.map(sourceRow).join('')}</ul></section>`:''}
      ${waitingMappings?`<section class="vn-block"><div class="panel-head"><h2>ربط ينتظر اعتمادك</h2></div><ul class="vn-list">${waitingMappings}</ul></section>`:''}
      <section class="vn-block"><div class="panel-head"><h2>قائمة الدخل</h2><p>من ${day(data.from)} لين ${day(data.to)}. الصافي ${fig(is.net_minor)} ريال${loss?' — خسارة':' — ربح'}.</p></div>
      <div class="vn-grid">${statement('الإيرادات',is.income,'إجمالي الإيرادات',is.total_income_minor)}${statement('المصروفات',is.expenses,'إجمالي المصروفات',is.total_expenses_minor)}</div></section>
      <section class="vn-block"><div class="panel-head"><h2>المركز المالي في ${day(bs.as_of)}</h2></div>
      ${bs.balanced?'':'<div class="vn-alert is-late"><strong>المركز المالي غير متوازن.</strong><p>راجع القيود المرحّلة؛ هذا ما يصير مع قيود متوازنة.</p></div>'}
      <div class="vn-grid">${statement('الأصول',bs.assets,'إجمالي الأصول',bs.total_assets_minor)}${statement('الالتزامات وحقوق الملكية',[...bs.liabilities,...bs.equity,{code:'—',name:'أرباح (خسائر) مرحّلة ومحققة لين التاريخ',amount_minor:bs.retained_earnings_minor}],'إجمالي الالتزامات وحقوق الملكية',bs.total_liabilities_equity_minor)}</div></section>
      <section class="vn-block"><div class="panel-head"><h2>ملخص ضريبة القيمة المضافة للفترة</h2></div><dl class="vn-facts"><div><dt>مبيعات خاضعة (صافي) بالريال</dt><dd>${fig(data.vat.taxable_sales_minor)}</dd></div><div><dt>ضريبة المخرجات</dt><dd>${fig(data.vat.output_vat_minor)}</dd></div><div><dt>ضريبة المدخلات المتحقق منها</dt><dd>${data.vat.input_vat_minor===null?'ما فيه فواتير موردين ضريبية متحقق منها':fig(data.vat.input_vat_minor)}</dd></div><div><dt>الصافي (مخرجات − مدخلات)</dt><dd>${vatNet===null||vatNet===undefined?'—':`${fig(vatNet)} <small>${vatNet<0?'لنا (مسترد)':'علينا (مستحق)'}</small>`}</dd></div></dl><p class="subtle measure">${e(data.vat.note)}</p></section>
      ${controlsHtml(data.controls,{e,button,money,ui})}
      ${centres}
      <div class="vn-grid"><section class="vn-block"><div class="panel-head"><h2>مستندات وترحيلها</h2></div>${otherSources.length?`<ul class="vn-list">${otherSources.map(sourceRow).join('')}</ul>`:'<p class="subtle">ما فيه مستندات نهائية غير اللي تنتظرك — تطلع هنا أول ما يصدر مستند.</p>'}</section><section class="vn-block"><div class="panel-head"><h2>الربط المحاسبي المعتمد</h2></div><ul class="vn-list">${mappings}</ul>${data.pending_mappings.filter(m=>!decideMapping(m)).length?`<div class="panel-head"><h3>ينتظر الاعتماد</h3></div><ul class="vn-list">${data.pending_mappings.filter(m=>!decideMapping(m)).map(pendingRow).join('')}</ul>`:''}</section></div>
      ${data.closable_years?.length&&prepare?`<section class="vn-block"><div class="panel-head"><h2>إقفال سنة مالية</h2><p>سنوات قبل فيها قيود مرحّلة وما انقفلت. قيد الإقفال ينقل أرصدة الإيرادات والمصروفات للأرباح المبقاة، ويمر بالاعتماد والترحيل زي أي قيد.</p></div><div class="operation-actions">${data.closable_years.map(y=>button('journal_from_source',`year_close:${y}`,`إعداد قيد إقفال ${y}`)).join('')}</div></section>`:''}
      ${data.suppliers?.length?`<section class="vn-block"><div class="panel-head"><h2>كشف الموردين</h2></div>${ui.table({head:['المورد','مطابَق (ريال)','انحوّل وتوثّق (ريال)','معتمد ما انحوّل (ريال)','الرصيد (ريال)'],rows:data.suppliers.map(x=>`<tr><td>${e(x.name)} <small><bdi dir="ltr">${e(x.supplier_key)}</bdi></small></td><td>${fig(x.matched_minor)}</td><td>${fig(x.paid_minor)}</td><td>${fig(x.approved_unpaid_minor)}</td><td><strong>${signed(x.balance_minor,'لنا')}</strong></td></tr>`)})}</section>`:''}
      ${customers?`<section class="vn-group"><h2>كشوف حسابات العملاء <span>${data.customers.length}</span></h2>${customers}</section>`:''}
      ${managed}`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='record_mapping'){guard(data.permissions.includes('prepare'));return {title:'ربط غرض محاسبي بحساب',endpoint:'/ledger/mappings',idempotent:true,fields:[field('purpose','الغرض','select',{options:data.purposes.map(p=>({value:p.key,label:`${p.name} (${typeNames[p.account_type]})`}))}),field('account_id','الحساب','select',{options:data.accounts.map(a=>({value:a.id,label:`${a.code} · ${a.name} · ${typeNames[a.account_type]}`}))}),field('cost_center_id','مركز التكلفة الافتراضي','select',{options:data.cost_centers.map(c=>({value:c.id,label:`${c.code} · ${c.name}`}))}),field('effective_from','يسري من','date',{value:data.to})],toPayload:v=>v};}
    // مركز تكلفة الإدارة: يسجّله حامل الإعداد المالي، ويقرره حامل الاعتماد غير من سجّله.
    if(action==='record_department_centre'){const dc=data.department_centres;guard(dc?.can_record);return {title:'ربط إدارة بمركز تكلفة',endpoint:'/ledger/department-centres',idempotent:true,
      fields:[field('department_id','الإدارة','select',{options:dc.rows.map(r=>({value:r.department_id,label:r.department_name}))}),field('cost_center_id','مركز التكلفة','select',{options:data.cost_centers.map(c=>({value:c.id,label:`${c.code} · ${c.name}`}))}),
        field('effective_from','يسري من','date',{value:data.to,hint:'رواتب الشهر تروح لمركز الإدارة الساري في آخر يوم منه'}),field('reason','سبب الربط وسنده','textarea')],toPayload:v=>v};}
    if(action==='approve_department_centre'||action==='reject_department_centre'){const p=data.department_centres?.pending.find(x=>x.id===id);guard(p&&p.actions.includes(action));const approve=action==='approve_department_centre';
      return {title:`${approve?'اعتماد':'رفض'} مركز إدارة «${p.department_name}»`,endpoint:`/ledger/department-centres/${id}/${approve?'approve':'reject'}`,fields:[field('note',approve?'أساس الاعتماد':'سبب الرفض','textarea')],toPayload:v=>v};}
    if(action==='approve_mapping'){const m=data.pending_mappings.find(x=>x.id===id);guard(m&&m.recorded_by!==data.user_id&&data.permissions.includes('approve'));return {title:'اعتماد الربط المحاسبي',endpoint:`/ledger/mappings/${id}/approve`,fields:[field('note','أساس الاعتماد','textarea')],toPayload:v=>v};}
    // المعرّف «النوع:المعرّف» يُقسم عند أول نقطتين فقط: معرّف السحب من الدفعة المقدمة يحمل نقطة، ونوع المستند لا يحمل نقطتين.
    const [source_kind,source_id]=[id.slice(0,id.indexOf(':')),id.slice(id.indexOf(':')+1)];
    if(action==='trace_amount'){guard(id.includes(':'));const s=data.sources?.find(x=>x.source_kind===source_kind&&x.source_id===source_id);
      return {title:`تتبّع المبلغ — ${s?`${s.source_name} ${s.reference}`:source_kind==='journal'?'قيد':'مستند'}`,submit:'اعرض السلسلة',endpoint:'/ledger/trace',method:'GET',fields:[],
        dynamicEndpoint:()=>`/ledger/trace?${new URLSearchParams({kind:source_kind,id:source_id})}`,toPayload:()=>undefined,
        after:(saved,e)=>({title:`من المصدر لين البنك — ${saved.kind_name}`,html:traceHtml(saved,e)})};}
    if(action==='journal_from_source'){const s=source_kind==='year_close'?(data.closable_years?.includes(source_id)?{source_name:'إقفال سنة مالية',reference:source_id}:null):data.sources.find(x=>x.source_kind===source_kind&&x.source_id===source_id);guard(s&&!s.journal_status&&data.permissions.includes('prepare'));return {title:`إعداد قيد — ${s.source_name} ${s.reference}`,endpoint:'/ledger/journals',idempotent:true,fields:[field('period_id','الفترة المحاسبية','select',{options:data.periods.map(p=>({value:p.id,label:`${p.name} (${p.starts_on} – ${p.ends_on})`})),hint:'القيد ينشأ مسودة بأرقام المستند، وبعدين يعتمده ويرحّله شخص ثاني من «الدفتر المالي».'})],toPayload:v=>({source_kind,source_id,period_id:v.period_id})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};
