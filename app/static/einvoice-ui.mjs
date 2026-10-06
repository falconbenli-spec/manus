// الفوترة الإلكترونية: طبقة قابلة للتوصيل، غير مربوطة. كل شاشة تقول ذلك أولًا، ولا تدّعي امتثالًا ولا اتصالًا.
import { dual } from './dates.mjs';
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const LABELS={assign_channel:'تحديد القناة',attempt_submission:'محاولة إرسال',refresh_status:'استعلام الحالة'};
const TONE={queued:'is-due',sent:'is-due',accepted:'is-ok',accepted_with_warnings:'is-due',rejected:'is-late',failed:'is-late'};
const day=value=>value?dual(String(value).slice(0,10)):'—';
// الحالة شكلٌ وكلمة على الشارة: المنتظر بشكل الانتظار، والمقبول صامت، والمقبول بتحذير ينتبه له، والمرفوض والمتعذر بشكل التوقف.
const BADGE={queued:'pending',sent:'pending',accepted:'accepted',accepted_with_warnings:'is-due',rejected:'rejected',failed:'failed'};
// الوقت بتوقيت الرياض، لا بطابع غرينتش.
const riyadhTime=iso=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(',','');}catch{return String(iso??'').slice(0,16).replace('T',' ');}};

export const einvoiceUI={
  title:'الفوترة الإلكترونية — الطابور والأرشيف',
  description:'غير مربوط. المرحلة الأولى بس. هالشاشة تعرض عدّادًا ما ينعاد ضبطه وأرشيفًا ما يتعدّل وطابورًا جاهزًا ما يرسل شي اليوم. الربط يحتاج قرار المالك واعتماد المختص الضريبي.',
  load:api=>api('/einvoice'),
  render(data,{e,button,money,ui=kit(e)}){
    const when=value=>value?`<time datetime="${e(String(value).slice(0,10))}">${e(day(value))}</time>`:'—';
    // المستند في الطابور: رقمه ونوعه ومبلغه، ثم حاله وقناته ومحاولاته، ثم السبب. ما عليه خطوة للقارئ بعلامة «دورك».
    const submission=s=>`<li class="${s.actions.length?'is-decision':TONE[s.status]??''}">
      <strong><bdi dir="ltr">${e(s.number)}</bdi> · ${e(s.kind==='invoice'?'فاتورة':'إشعار دائن')} — <span class="ltr">${e(money(s.total_minor,'').trim())}</span> ريال</strong><span class="badge ${s.actions.length?'is-decision':BADGE[s.status]??''}">${e(s.actions.length?'ينتظرك':s.status_name)}</span>
      <span>${s.actions.length?`${e(s.status_name)} · `:''}القناة: ${e(s.channel_name)}${s.channel_by_name?` (حددها ${e(s.channel_by_name)})`:''} · المحاولات: <span data-num>${e(s.attempts)}</span>${s.next_attempt_at?` · التالية ما تسبق <time datetime="${e(s.next_attempt_at)}">${e(riyadhTime(s.next_attempt_at))}</time> بتوقيت الرياض`:''}</span>
      <small class="measure">السبب: ${e(s.reason)}</small>
      ${s.buyer_gaps.length?`<small class="measure">بيانات المشتري ناقصة: ${e(s.buyer_gaps.join('، '))} — ${s.override_reason?`مغطاة بتجاوز موثّق: ${e(s.override_reason)}`:'ما فيه محاولة قبل ما تكتمل أو ينسجّل تجاوز موثّق'}</small>`:''}
      ${s.attempts_log.length?`<small>آخر محاولة: ${e(s.attempts_log[0].outcome_name)} عبر <bdi dir="ltr">${e(s.attempts_log[0].provider)}</bdi> — ${e(s.attempts_log[0].actor_name)}</small>`:''}
      ${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,LABELS[a])).join('')}</div>`:''}</li>`;
    const counters=data.counters.map(c=>`<li><strong>${e(c.kind_name)}: آخر رقم <span data-num>${e(c.last_sequence)}</span></strong><span>آخر مستند <bdi dir="ltr">${e(c.number??'—')}</bdi> · ${when(c.updated_at)}</span></li>`).join('');
    const archive=data.archive.map(a=>`<li><strong><bdi dir="ltr">${e(a.number)}</bdi> · حلقة <span data-num>${e(a.chain_index)}</span></strong><span>${when(a.issued_at)} · الصيغة <bdi dir="ltr">${e(a.format)}</bdi>${a.original_document_id?' · يحمل مرجع فاتورته الأصلية':''}</span><small class="subtle">البصمة <bdi dir="ltr">${e(a.document_hash.slice(0,16))}…</bdi> ← السابقة <bdi dir="ltr">${e(a.previous_hash?a.previous_hash.slice(0,16)+'…':'بداية السلسلة')}</bdi></small></li>`).join('');
    // المشتري: الجاهز صامت، والمغطى بتجاوز ينتبه له، والناقص بلا تجاوز بشكل التوقف وزر تجاوزه.
    const customers=data.customers.map(c=>`<li class="${c.ready?'':c.override?'is-due':'is-late'}"><strong>${e(c.name)}</strong><span class="measure">${e(c.note)}${c.gap_names.length?` الناقص: ${e(c.gap_names.join('، '))}.`:''}</span>
      ${c.override?`<small class="measure">التجاوز: ${e(c.override.reason)} — سجّله ${e(c.override.recorded_by_name)} في ${when(c.override.created_at)}</small>`:''}
      ${!c.ready&&!c.override?`<div class="operation-actions">${button('record_override',c.id,'تجاوز موثّق بسببه')}</div>`:''}</li>`).join('');
    const p=data.rejection_policy,failed=data.counts.rejected+data.counts.failed;
    const waiting=data.submissions.filter(s=>s.actions.length),others=data.submissions.filter(s=>!s.actions.length);
    const block=(title,hint,body)=>`<section class="vn-block"><div class="panel-head"><h2>${title}</h2>${hint?`<p>${e(hint)}</p>`:''}</div>${body}</section>`;
    return `<section class="panel panel-body vn-head"><div class="vn-alert is-late"><strong>${e(data.disclaimer)}</strong><p class="measure">${e(data.note)}</p><p>حالة الربط: ${e(data.integration?.status_name??'غير مربوط')} · المزوّد الفعّال: <bdi dir="ltr">${e(data.provider)}</bdi></p></div>
        <p>${e(data.secrets_note)}</p><p>${e(data.format_note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.counts.queued,'بانتظار الإرسال',data.counts.queued?'is-due':'')}${ui.tile(failed,'انرفض أو تعذّر',failed?'is-late':'')}${ui.tile(data.archive_count,'مستند مؤرشف')}${ui.tile(data.chain_valid?'متصلة':'مكسورة','سلسلة البصمات',data.chain_valid?'':'is-late')}</div></section>
      ${waiting.length?block(`ينتظرك <span data-num>(${waiting.length})</span>`,'',`<ul class="vn-list">${waiting.map(submission).join('')}</ul>`):''}
      ${block('طابور الإرسال','ما يطلع شي اليوم: المزوّد الافتراضي يرفض كل استدعاء ويسجّله. القناة يحددها إنسان بسببه، واللي حددها ما يجري المحاولة.',others.length?`<ul class="vn-list">${others.map(submission).join('')}</ul>`:`<p class="subtle">${data.submissions.length?'ما فيه مستندات غير اللي تنتظرك.':'ما صدر مستند للحين. كل مستند يصدر يدخل الطابور والأرشيف تلقائيًا.'}</p>`)}
      ${block('العدّاد اللي ما ينعاد ضبطه','',counters?`<ul class="vn-list">${counters}</ul>`:'<p class="subtle">ما صدر أي مستند للحين.</p>')}
      ${block('اكتمال بيانات المشتري','هالمتطلبات تخص نوع من الفواتير بس، والمنصة ما تعرف حدودها بالضبط؛ فالنقص يمنع المحاولة إلا إذا انسجّل تجاوز موثّق بسببه وصاحبه.',customers?`<ul class="vn-list">${customers}</ul>`:'<p class="subtle">ما فيه عملاء ببيانات ضريبية مسجّلة — تنضاف من «الفواتير الضريبية».</p>')}
      ${block(`سلوك الرفض — ${e(p.needs)}`,'',`<div class="vn-alert is-due"><strong>مقترح ما انحسم.</strong><p class="measure">${e(p.proposal)}</p><p class="measure">${e(p.open_question)}</p></div>
          <ul class="vn-list">${p.enforced_today.map(line=>`<li><span>${e(line)}</span></li>`).join('')}</ul>`)}
      ${block(`الأرشيف اللي ما يتعدّل (آخر <span data-num>${e(data.archive.length)}</span>)`,'',archive?`<ul class="vn-list">${archive}</ul>`:'<p class="subtle">الأرشيف فاضي.</p>')}
      ${block('حدود هالطبقة','',`<ul class="vn-list">${data.limits.map(line=>`<li><span>${e(line)}</span></li>`).join('')}</ul>`)}`;
  },
  form(action,id,data){
    const s=data.submissions.find(x=>x.id===id),c=data.customers.find(x=>x.id===id);
    if(action==='assign_channel'){guard(s&&s.actions.includes('assign_channel'));return {title:`قناة المستند ${s.number}`,endpoint:`/einvoice/submissions/${id}/channel`,
      fields:[field('channel','القناة زي ما حددها المختص','select',{options:data.channels.map(k=>({value:k.key,label:k.name})),hint:'المنصة ما تستنتج نوع الفاتورة. القناة ما تتغير بعد ما تتحدد، واللي يحددها ما يسوي المحاولة.'}),
        field('reason','أساس التصنيف ومين أفتى فيه','textarea')],
      toPayload:v=>({version:s.version,channel:v.channel,reason:v.reason})};}
    if(action==='attempt_submission'){guard(s&&s.actions.includes('attempt_submission'));return {title:`محاولة إرسال ${s.number}`,endpoint:`/einvoice/submissions/${id}/attempt`,
      fields:[field('note','وش تحاول وليش الحين','textarea',{hint:'الربط ما تم: المزوّد الافتراضي بيرفض، وتنسجل المحاولة وسببها وينحسب موعد اللي بعدها. ما يوصل شي لأي جهة.'})],
      toPayload:v=>({version:s.version,note:v.note})};}
    if(action==='refresh_status'){guard(s&&s.actions.includes('refresh_status'));return {title:`استعلام حالة ${s.number}`,endpoint:`/einvoice/submissions/${id}/status`,
      fields:[field('note','سبب الاستعلام','textarea')],toPayload:v=>({version:s.version,note:v.note})};}
    if(action==='record_override'){guard(c&&!c.ready&&!c.override);return {title:`تجاوز نقص بيانات — ${c.name}`,endpoint:'/einvoice/buyer-overrides',idempotent:true,
      fields:[field('reason','سبب التجاوز ومين قرره','textarea',{hint:`الناقص: ${c.gap_names.join('، ')}. التجاوز ينحفظ باسمك وما يتعدل ولا ينحذف. عشرين حرف على الأقل.`})],
      toPayload:v=>({case_id:id,reason:v.reason})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};

export const einvoiceSelfcheckUI={
  title:'مراجعة ضوابط سلامة حل الفوترة',
  description:'فحص ذاتي تسويه المنصة على نفسها: لكل ضابط حكم ودليله. مو شهادة توافق ولا مراجعة جهة، واللي ما انفحص ينقال صراحة. الربط ما تم؛ المرحلة الأولى بس.',
  load:api=>api('/einvoice/selfcheck'),
  render(data,{e,ui=kit(e)}){
    // البند: سؤاله ثم حكمه شكلًا وكلمة (المستوفى صامت، وغير المستوفى بشكل التوقف، وغير المتحقق منه ينتظر)، ثم ملاحظته وأدلته.
    const tone={met:'',not_met:'is-late',not_applicable:'is-old',not_verified:'is-due'},badge={met:'met',not_met:'failed',not_applicable:'none',not_verified:'is-due'};
    // الحكم الذي يحتاج نظرًا أولًا: غير المستوفى، ثم غير المتحقق منه، ثم المستوفى، ثم ما لا ينطبق.
    const order={not_met:0,not_verified:1,met:2,not_applicable:3};
    const item=i=>`<li class="${tone[i.status]??''}"><strong>${e(i.question)}</strong><span class="badge ${badge[i.status]??''}">${e(i.status_name)}</span>
      <span class="measure">${e(i.note)}</span>${i.evidence.map(line=>`<small><bdi>${e(line)}</bdi></small>`).join('')}</li>`;
    const items=[...data.items].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)).map(item).join('');
    return `<section class="panel panel-body vn-head"><div class="vn-alert is-late"><strong>${e(data.connection_state)}</strong><p class="measure">${e(data.disclaimer)}</p></div>
        <p>${e(data.note)} انعمل الفحص في <time datetime="${e(data.checked_at)}">${e(riyadhTime(data.checked_at))}</time> بتوقيت الرياض على المنصة وهي شغالة.</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.summary.not_met,data.status_names.not_met,data.summary.not_met?'is-late':'')}${ui.tile(data.summary.not_verified,data.status_names.not_verified,data.summary.not_verified?'is-due':'')}${ui.tile(data.summary.met,data.status_names.met)}${ui.tile(data.summary.not_applicable,data.status_names.not_applicable)}</div></section>
      <section class="vn-block"><div class="panel-head"><h2>البنود وأدلتها</h2></div>${items?`<ul class="vn-list">${items}</ul>`:'<p class="subtle">ما فيه بنود.</p>'}</section>`;
  },
  form(){throw Error('هالشاشة للقراءة بس.');}
};
