// شفافية الطلب: شاشتان. «أين طلباتي» لصاحب الطلب، و«قياس الخدمات» لمن يملك تصريح القياس.
// لا اتصال خارجي في أي منهما: كل رقم هنا مشتق من سجل التدقيق ونسخ الطلبات داخل المنصة.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
// م0 «السور»: عبارات الحالات من القاموس الواحد. ما ينتظره الطلب بعد اعتماده، وأنه عاد إلى صاحبه، يقوله سطر «المنتظر» و«عند» تحته لا شارة الحالة.
import { REQUEST_STATUS_AR as STATUS } from './vocabulary.mjs';
// م0 «السور»: tile من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية؛ HTML الناتجة مطابقة بالحرف (tests/ui-golden.test.mjs).
const days=n=>`${n} يوم عمل`;

// خطّ المحطّات الخمس («أين طلبي»، الدفعة الثالثة من مركز الخدمات): الشكل قبل اللون — المحطّة المبلوغة ● والحالية ◍
// والقادمة ○ والتي توقّف عندها الطلب ✕، حروفٌ لا ألوان، فتُقرأ في كل تصميم وفي وضع التباين العالي. كل محطّة تنطق
// «3 من 5 — بانتظار الاعتماد — الآن» لقارئ الشاشة، والتاريخ تحت كلِّ محطّة مرّت. الأسماء كلها من الحمولة (القاموس).
// الصنف rq-trail القائم يرسمه أفقيًا فوق 760 ورأسيًا دونها؛ ولا هدف لمس على النقطة وحدها: الصفّ كلّه هو الهدف.
function stationsTrail(list,e){
  if(!Array.isArray(list)||!list.length)return '';
  const glyph=s=>s.ended?'✕':s.current?'◍':s.reached_at?'●':'○';
  const state=s=>s.ended?'is-ended':s.current?'is-now':s.reached_at?'is-passed':s.skipped?'is-skipped':'is-ahead';
  const when=s=>s.ended&&s.stage?s.stage:s.current?(s.stage??'الآن'):s.reached_at?s.reached_at:s.skipped?'بلا انتظار: مسار مباشر':'—';
  const spoken=s=>`${s.position} من ${s.of} — ${s.name} — ${when(s)}`;
  return `<section class="vn-block rq-stations-block"><h3>خط سير الطلب</h3><ol class="rq-trail rq-stations" aria-label="خط سير الطلب">${list.map(s=>
    `<li class="${state(s)}"${s.current?' aria-current="step"':''} aria-label="${e(spoken(s))}"><span class="rq-station-mark" aria-hidden="true">${glyph(s)}</span><strong>${e(s.name)}</strong><span><bdi dir="ltr">${e(when(s))}</bdi></span></li>`).join('')}</ol></section>`;
}

function timelineView(data,e){
  const n=data.next_step;
  const events=data.events.map(x=>`<li><strong>${e(x.on)} · ${e(x.actor_name)} ${e(x.text)}</strong><span>${e(x.detail)}${x.reason?`${x.detail?' · ':''}السبب: ${e(x.reason)}`:''}${x.reason_withheld?`${x.detail?' · ':''}<span class="muted">ملاحظة داخلية بين المنفذين ما تظهر لك</span>`:''}</span></li>`).join('');
  const stages=data.stages.map(s=>`<li><strong>${e(s.party)}</strong><span>${e(days(s.working_days))} · ${e(s.hours)} ساعة${s.paused?' · <span class="badge">الساعة متوقفة</span>':''}${s.open?' · <span class="badge is-due">جارية الآن</span>':''}</span></li>`).join('');
  const rounds=data.rounds.closures.map(c=>`<li><strong>الجولة ${e(c.round)} · أُغلقت ${e(c.closed_at.slice(0,10))}</strong><span>ما سُلِّم: ${e(c.delivered)}</span></li>`).join('')
    +data.rounds.reopenings.map(o=>`<li><strong>إعادة فتح — الجولة ${e(o.round)} · ${e(o.created_at.slice(0,10))}</strong><span>السبب: ${e(o.reason)}</span></li>`).join('');
  // المرحلة بكلمتها من الحمولة (القاموس) بجوار «الآن عند»، وعبارة الانقضاء بجوار «ملغى» حين تحملها الحمولة.
  const stage=data.stage?` <span class="badge ${e(data.request?.status??'')}">${e(data.stage.name)}</span>${data.stage.module_phrase?` <small class="subtle">${e(data.stage.module_phrase)}</small>`:''}`:'';
  return `<div class="vn-alert ${n.paused?'is-block':''}" role="status"><strong>الآن عند: ${e(n.with||'—')}</strong>${stage}<p>المنتظر: ${e(n.awaiting)}</p>
      <p>${n.expected_on?`التاريخ المتوقع: <bdi dir="ltr">${e(n.expected_on)}</bdi>`:'ما فيه تاريخ متوقع'}${n.expectation_note?` — ${e(n.expectation_note)}`:''}</p>${n.lapse_note?`<p class="subtle">${n.waiting_days!==null&&n.waiting_days!==undefined?`ينتظر ردّك من ${e(n.waiting_days)} يوم عمل. `:''}${e(n.lapse_note)}</p>`:''}
      ${n.you_can.length?`<ul class="vn-list">${n.you_can.map(x=>`<li><span>${e(x)}</span></li>`).join('')}</ul>`:''}</div>
    ${stationsTrail(data.stations,e)}
    <section class="vn-block"><h3>ما جرى بالترتيب</h3><ul class="vn-list">${events}</ul></section>
    <section class="vn-block"><h3>كم مكث الطلب عند كل طرف</h3>${stages?`<ul class="vn-list">${stages}</ul>`:'<p class="subtle">الطلب ما تقدّم للحين، فما فيه مكوث ينحسب.</p>'}</section>
    ${rounds?`<section class="vn-block"><h3>جولات الإغلاق</h3><ul class="vn-list">${rounds}</ul>${data.rounds.reopenings.length?'<p class="subtle">انفتح هذا الطلب من جديد، وإغلاقه الأول باقي في السجل مثل ما هو.</p>':''}</section>`:''}
    <p class="subtle">${e(data.note)}</p><div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`;
}

export const myRequestTimelineUI={
  title:'أين طلباتي',description:'لكل طلب: عند مين الحين، ووش القرار المنتظر، ومتى يُتوقع، ووش تسوي لو تأخر. التاريخ المتوقع محسوب من زمن الخدمة بأيام العمل، مو وعد من أحد؛ وما يظهر تاريخ لما تكون الساعة واقفة عندك.',
  load:api=>api('/my-request-timeline'),
  render(data,{e,button,ui}){
    const {tile}=ui;
    const labels={view_timeline:'الخط الزمني',reopen:'لم تُنجز حاجتي — إعادة فتح',answer:'هل أنجز الطلب حاجتك؟',close_with_evidence:'إغلاق بوصف ما سُلِّم'};
    // أزرار الصف تتكرر في كل طلب، فاسم كل زرّ المسموع يحمل عنوان طلبه ويبدأ بنصّه الظاهر (WCAG 2.5.3).
    const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
    const act=(a,r)=>named(button(a,r.id,labels[a]),`${labels[a]}: ${r.title}`);
    // مرحلة الطالب (stage_name من الحمولة) تُقال بجوار شارة الحالة حين تخالف كلمتها: «معاد للتعديل · ينتظر ردك».
    const stageWord=r=>{
      const differs=r.stage_name&&r.stage_name!==(STATUS[r.status]??r.status);
      if(!differs&&!r.stage_phrase)return '';
      return ` <small class="subtle">${[differs?e(r.stage_name):'',r.stage_phrase?e(r.stage_phrase):''].filter(Boolean).join(' · ')}</small>`;};
    const row=r=>`<li><strong>${e(r.title)} <span class="badge ${r.overdue?'is-late':r.paused?'is-due':''}">${e(STATUS[r.status]??r.status)}</span>${stageWord(r)}</strong>
      <span>${e(r.service)} · عند: ${e(r.with||'—')} · المنتظر: ${e(r.awaiting)}</span>
      <span>${r.expected_on?`المتوقع: <bdi dir="ltr">${e(r.expected_on)}</bdi>`:'ما فيه تاريخ متوقع'}${r.expectation_note?` — ${e(r.expectation_note)}`:''}</span>
      ${r.reopened_rounds?`<span class="muted">أُعيد فتحه ${e(r.reopened_rounds)} مرة</span>`:''}${r.reopen_deadline?`<span class="muted">إعادة الفتح متاحة حتى <bdi dir="ltr">${e(r.reopen_deadline)}</bdi></span>`:r.reopen_why&&r.status==='completed'?`<span class="muted">إعادة الفتح: ${e(r.reopen_why)}</span>`:''}
      <div class="operation-actions">${r.actions.map(a=>act(a,r)).join('')}</div></li>`;
    const open=data.rows.filter(r=>!['completed','rejected','cancelled'].includes(r.status)),done=data.rows.filter(r=>!open.includes(r));
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.open,'طلب مفتوح')}${tile(data.waiting_on_me,'ينتظر ردك أنت',data.waiting_on_me?'is-due':'')}${tile(data.rows.filter(r=>r.overdue).length,'تجاوز زمنه المستهدف',data.rows.some(r=>r.overdue)?'is-late':'')}</div></section>
      <section class="panel"><div class="panel-head"><h2>طلباتي المفتوحة</h2></div><div class="panel-body">${open.length?`<ul class="vn-list">${open.map(row).join('')}</ul>`:'<p class="subtle">ما فيه طلبات مفتوحة.</p>'}</div></section>
      ${data.closable.length?`<section class="panel"><div class="panel-head"><h2>طلبات أباشرها وجاهزة للإغلاق</h2></div><div class="panel-body"><p class="subtle">الطلب ما يتقفّل بكلمة «تم»: صِف اللي تسلّم فعلًا، هذا اللي يقراه صاحب الطلب ويرجع له بعدين.</p><ul class="vn-list">${data.closable.map(r=>`<li><strong>${e(r.title)}</strong><span>${e(r.service)}${r.round>1?` · الجولة ${e(r.round)} بعد إعادة فتح`:''}</span><div class="operation-actions">${r.actions.map(a=>act(a,r)).join('')}</div></li>`).join('')}</ul></div></section>`:''}
      <section class="panel"><div class="panel-head"><h2>طلبات منتهية</h2></div><div class="panel-body">${done.length?`<ul class="vn-list">${done.map(row).join('')}</ul>`:'<p class="subtle">ما فيه طلبات منتهية.</p>'}</div></section>`;
  },
  form(action,id,data){
    const r=data.rows.find(x=>x.id===id)??data.closable.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='view_timeline')return {title:`الخط الزمني — ${r.title}`,endpoint:`/request-timeline/${id}/view`,fields:[],toPayload:()=>({}),after:(saved,e)=>({title:saved.request.title,html:timelineView(saved,e)})};
    if(action==='reopen')return {title:`إعادة فتح — ${r.title}`,endpoint:`/request-closure/${id}/reopen`,idempotent:true,
      fields:[field('reason','ما الذي لم يُنجز؟','textarea',{hint:`إعادة الفتح لا تمحو الإغلاق السابق: تُنشئ جولة جديدة مرتبطة به ويعود الطلب للإدارة المنفذة. متاحة حتى ${r.reopen_deadline}.`})],
      toPayload:v=>({version:r.version,reason:v.reason})};
    if(action==='answer')return {title:'هل أنجز هذا الطلب حاجتك؟',endpoint:`/service-experience/${id}/answer`,idempotent:true,
      fields:[field('answer','إجابتك','select',{options:[{value:'met',label:'نعم، أنجز حاجتي'},{value:'partly',label:'جزئيًا؛ بقي شيء'},{value:'not_met',label:'لا، لم يُنجز حاجتي'}]}),
        field('comment','تعليق (اختياري، ويلزم سطر واحد إن كانت الإجابة «لا»)','textarea',{required:false,hint:'سؤال واحد لا استبيان. الإجابة تُحفظ مرة واحدة ولا تُستبدل، ولا تُنسب إليك في أي نتيجة مجمّعة، ولا يُحسب بها رضًا لموظف باسمه.'})],
      toPayload:v=>({version:r.version,answer:v.answer,comment:v.comment||''})};
    return {title:`إغلاق بدليل — ${r.title}`,endpoint:`/request-closure/${id}/close`,idempotent:true,
      fields:[field('delivered','ما الذي سُلِّم فعلًا؟','textarea',{hint:'عشرون حرفًا على الأقل. يصل صاحبَ الطلب إشعارٌ بالإغلاق، ويبقى هذا الوصف في سجل الطلب ولا يُعدَّل؛ وإن أُعيد فتح الطلب فالإغلاق التالي جولة جديدة.'})],
      toPayload:v=>({version:r.version,delivered:v.delivered})};
  }
};

function experienceBlock(x,title,e){
  if(!x.available)return `<section class="vn-block"><h3>${e(title)}</h3><div class="vn-alert is-block"><strong>ما تظهر نتيجة</strong><p>${e(x.reason)}</p></div></section>`;
  return `<section class="vn-block"><h3>${e(title)}</h3>${x.groups.length?`<ul class="vn-list">${x.groups.map(g=>`<li><strong>${e(g.label)}</strong><span>${e(g.answers)} إجابة · نعم ${e(g.met)} (${e(g.met_percent)}%) · جزئيًا ${e(g.partly)} · لا ${e(g.not_met)} (${e(g.not_met_percent)}%)</span>${g.comments.length?`<span class="muted">تعليقات بلا أصحابها: ${g.comments.map(e).join(' — ')}</span>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه مجموعة وصلت الحد الأدنى للحين.</p>'}
    <p class="subtle">${x.suppressed?`${e(x.suppressed)} مجموعة مطوية لأنها دون ${e(x.min_responses)} إجابات. `:''}الحد الأدنى ${e(x.min_responses)} · تأكّد في ${e(x.confirmed_on)} · السند: ${e(x.basis)}</p></section>`;
}

export const serviceInsightUI={
  title:'قياس الخدمات',description:'المسار الفعلي مقابل المرسوم، وأين يمكث الطلب، وكم يرتد ولماذا، والالتزام بالمدة بأيام العمل، وإجابة سؤال التجربة. المصدر سجل التدقيق داخل المنصة؛ لا إدخال يدوي ولا اتصال خارجي. تقيس الخطوات والإدارات لا الأشخاص.',
  load:api=>api('/service-insight'),
  render(data,{e,button,ui}){
    const {tile}=ui;
    const i=data.insight,c=data.closure;
    const settings=`<section class="panel"><div class="panel-head"><h2>إعدادات يضعها مالك الإجراء</h2></div><div class="panel-body">
        <p class="subtle">ما فيه قيمة افتراضية لأي واحد منهم: ما دامت المهلة ما انحطّت فإعادة الفتح مو متاحة، وما دام الحد ما انحط فما تظهر نتيجة مجمّعة.</p>
        <ul class="vn-list">${c.settings.map(s=>`<li><strong>مهلة إعادة الفتح — ${s.scope_code==='*'?'كل الخدمات':`<bdi dir="ltr">${e(s.scope_code)}</bdi>`}: ${e(days(s.window_days))}</strong><span>تأكّدت في ${e(s.confirmed_on)} · السند: ${e(s.basis)}</span></li>`).join('')||'<li><span>ما تحدّدت مهلة إعادة فتح للحين.</span></li>'}
          <li><strong>الحد الأدنى قبل عرض نتيجة مجمّعة: ${data.threshold.min_responses?`${e(data.threshold.min_responses)} إجابات`:'غير محدد'}</strong>${data.threshold.min_responses?`<span>تأكّد في ${e(data.threshold.confirmed_on)} · السند: ${e(data.threshold.basis)}</span>`:''}</li></ul>
        <div class="operation-actions">${c.can_manage_general||c.services.length?button('set_window','','تحديد مهلة إعادة الفتح'):''}${data.threshold.can_set?button('set_threshold','','تحديد الحد الأدنى للنتائج'):''}</div></div></section>`;
    const gaps=`<section class="panel"><div class="panel-head"><h2>سلامة الإغلاق</h2></div><div class="panel-body"><div class="vn-tiles">${tile(c.totals.completed,'طلب مكتمل أراه')}${tile(c.totals.closed_with_evidence,'أُغلق بدليل تسليم',c.totals.closed_with_evidence?'is-ok':'')}${tile(c.gaps.without_evidence.length,'أُغلق بلا دليل مسجل',c.gaps.without_evidence.length?'is-due':'')}${tile(c.gaps.silent.length,'إغلاق صامت بلا إشعار',c.gaps.silent.length?'is-late':'')}${tile(c.totals.reopened,'إعادة فتح',c.totals.reopened?'is-due':'')}</div><p class="subtle">${e(c.note)}</p></div></section>`;
    if(!i)return `<section class="panel panel-body vn-head"><div class="vn-alert is-block"><strong>لوحات القياس محجوبة عن حسابك</strong><p>${e(data.denied)}</p></div></section>${settings}${gaps}`;
    const services=i.services.map(s=>`<details class="vn-card"><summary><span class="vn-code"><bdi dir="ltr">${e(s.code)}</bdi></span><span class="vn-name"><strong>${e(s.name)}</strong><small>${e(s.department)} · ${e(s.requests)} طلب · انحرف ${e(s.deviated)} (${e(s.deviated_percent)}%)</small></span><span class="vn-flags">${s.slowest?`<span class="badge">أطول مكوث: ${e(s.slowest)}</span>`:''}</span></summary><div class="vn-body">
        <section class="vn-block"><h3>المسار المرسوم</h3><p>${e(s.designed)}</p><h3>المسارات الفعلية</h3><ul class="vn-list">${s.variants.map(v=>`<li><strong>${e(v.path)}</strong><span>${e(v.count)} طلب${v.designed?' · على المسار المرسوم':' · منحرف'}</span></li>`).join('')}</ul>
          <p class="subtle">أسباب الانحراف: إرجاع ${e(s.deviation_causes.returned)} · رفض ${e(s.deviation_causes.rejected)} · تحويل ${e(s.deviation_causes.transferred)} · إعادة فتح ${e(s.deviation_causes.reopened)} · إلغاء ${e(s.deviation_causes.cancelled)} · غير ذلك ${e(s.deviation_causes.other)}</p></section>
        <section class="vn-block"><h3>إعادة العمل</h3><p>${s.rework.average_returns===null?'ما وصل طلب للاعتماد للحين.':`متوسط الارتداد قبل الاعتماد: ${e(s.rework.average_returns)} مرة على ${e(s.rework.reached_approval)} طلب معتمد.`}</p>${s.rework.fields.length?`<ul class="vn-list">${s.rework.fields.map(f=>`<li><strong>${e(f.field)}</strong><span>عُدّل بعد الإرجاع ${e(f.count)} مرة</span></li>`).join('')}</ul><p class="subtle">الحقل الذي يُعدَّل بعد الإرجاع هو ما سبّبه؛ حقل يتكرر هنا يحتاج توضيحًا في نموذج الخدمة لا تنبيهًا للموظفين.</p>`:''}</section>
        <section class="vn-block"><h3>الالتزام بالمدة</h3><p>${s.timing.target_days?`الزمن المستهدف ${e(days(s.timing.target_days))} · ضمن المدة ${e(s.timing.on_time)} · متأخر ${e(s.timing.late)}${s.timing.late_open?` (منها ${e(s.timing.late_open)} ما زال مفتوحًا)`:''}${s.timing.on_time_percent===null?'':` · نسبة الالتزام للمكتمل ${e(s.timing.on_time_percent)}%`}`:e(s.timing.note)}</p>
          <p>أُنجز من أول مرة: ${e(s.first_time_right.without_reopening)} من ${e(s.first_time_right.completed)} مكتمل.</p></section></div></details>`).join('');
    return `<section class="panel panel-body vn-head"><div class="vn-alert"><strong>${e(i.blame_notice)}</strong></div><p>${e(i.note)}</p>${i.scope?`<p class="subtle">نطاق تصريحك: ${i.scope.map(e).join('، ')}</p>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(i.totals.requests,'طلب مقدَّم')}${tile(i.totals.services,'خدمة لها طلبات')}${tile(i.totals.deviated,'طلب انحرف عن مساره',i.totals.deviated?'is-due':'')}${tile(days(i.requester_wait.working_days),'انتظار أصحاب الطلبات (لا يُحتسب على إدارة)')}</div></section>
      <section class="panel"><div class="panel-head"><h2>الاختناقات: أين يمكث الطلب</h2></div><div class="panel-body">${i.bottlenecks.length?`<ul class="vn-list">${i.bottlenecks.map(b=>`<li><strong><bdi dir="ltr">${e(b.service_code)}</bdi> · ${e(b.where)}</strong><span>متوسط ${e(days(b.average_working_days))} (${e(b.average_hours)} ساعة) · وسيط ${e(b.median_working_days)} · أطول ${e(b.longest_working_days)} · ${e(b.passes)} مرورًا${b.open_now?` · ${e(b.open_now)} عندها الآن`:''}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه طلبات مقدّمة للحين.</p>'}<p class="subtle">الاختناق خطوة أو إدارة. لا يظهر هنا اسم موظف، ولن يظهر.</p></div></section>
      ${services}
      <section class="panel"><div class="panel-head"><h2>${e(data.experience.by_service.question??'هل أنجز هذا الطلب حاجتك؟')}</h2></div><div class="panel-body">${experienceBlock(data.experience.by_service,'بحسب الخدمة',e)}${experienceBlock(data.experience.by_department,'بحسب الإدارة',e)}<p class="subtle">ما ينحسب رضا لأي منفّذ باسمه: هذا يحوّل المقياس لأداة ضغط ويخرّب صدق الإجابات.</p></div></section>
      ${settings}${gaps}`;
  },
  form(action,id,data){
    const basis=field('basis','السند ومن أقرّه','textarea',{hint:'مثال: قرار مالك الإجراء في اجتماع مؤرخ. يُحفظ مع الإعداد ويُعرض بجانبه.'}),confirmed=field('confirmed_on','تاريخ تأكيده','date');
    if(action==='set_threshold'){guard(data.threshold.can_set);return {title:'الحد الأدنى قبل عرض نتيجة مجمّعة',endpoint:'/service-experience/threshold',idempotent:true,
      fields:[field('min_responses','أقل عدد إجابات تُعرض به نتيجة','number',{min:3,max:50,value:data.threshold.min_responses??'',hint:'لا يقل عن 3: في إدارة من ثلاثة أشخاص، نتيجةٌ على إجابتين تكشف صاحب الرأي. الحد السابق يبقى في السجل.'}),basis,confirmed],
      toPayload:v=>({min_responses:Number(v.min_responses),basis:v.basis,confirmed_on:v.confirmed_on})};}
    guard(action==='set_window'&&(data.closure.can_manage_general||data.closure.services.length));
    return {title:'مهلة إعادة الفتح',endpoint:'/request-closure/window',idempotent:true,
      fields:[field('scope_code','تسري على','select',{options:[...(data.closure.can_manage_general?[{value:'*',label:'كل الخدمات التي لم تُفرد بمهلة'}]:[]),...data.closure.services.map(s=>({value:s.code,label:`${s.code} · ${s.name}`}))]}),
        field('window_days','المهلة بأيام العمل بعد الإغلاق','number',{min:1,max:120,hint:'أيام عمل (الأحد–الخميس دون العطل المعتمدة). المهلة السابقة تبقى في السجل، وما أُعيد فتحه قبل التغيير لا يتأثر.'}),basis,confirmed],
      toPayload:v=>({scope_code:v.scope_code,window_days:Number(v.window_days),basis:v.basis,confirmed_on:v.confirmed_on})};
  }
};
