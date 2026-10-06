import { kit } from './kit.mjs';
// تقرير الإدارة التنفيذية للمشاريع: التقرير المركّب نفسه بأقسامه وتغطيتها، ثم الأسئلة المفتوحة،
// وسجل الفجوات المعلنة بخططها، وقراءة الإدارة لكل قسم.
//
// قاعدة العرض التي لا تُخرَق: **البند غير المقيس لا يأخذ شريطًا أبدًا.** الشريط قياس، وشريط بطول صفر
// يُقرأ «صفر»، وهو أسوأ من لا شريط. البند غير المقيس يخرج بعبارته العربية وسببه وما يلزم لقياسه.
// والبند المقيس دون مستهدفه المعلن يأخذ شريطًا كاملًا بنبرة التأخر: فهو مقيس تمامًا وضعيف تمامًا.
// الصورتان لا تتشابهان في أي حال، لأن الفراغ ليس ضعف أداء والضعف ليس غيابًا.
//
// المفردات البصرية: بطاقات وشارات نبرة وجداول وأشرطة data-width. لا مكتبة رسم في المنصة ولا تُضاف،
// ولا نص برمجي داخل السمة ولا سمة style (سياسة المحتوى صارمة: script-src 'self').
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
// شريط النسبة بمفردات المنصة القائمة (vn-bars/vn-bar): العرض سمة data-width يرسمها paintBars في
// app.mjs، لا سمة style داخل الترميز. الشريط يحمل رقميه نصًّا أيضًا، فالطول وحده لا يُقرأ عددًا.
const bars=(e,rows)=>`<ul class="vn-list vn-bars">${rows.map(([label,part,whole])=>`<li><strong>${e(label)}</strong><span>${e(part)} من ${e(whole)}</span><div class="vn-bar" data-width="${e(whole?Math.max(2,Math.round(part*100/whole)):2)}"></div></li>`).join('')}</ul>`;
// نبرة الفجوة: «أُغلقت» ليست نجاحًا يُحتفى به وإنما عودة البند إلى القياس، و«معلنة» ليست خطأً وإنما
// اعتراف لم يتسلّمه أحد بعد. الشارة تصف الحالة ولا تحكم على من يملكها.
const gapTone={declared:'is-due',owned:'is-warn',closed:'is-ok',refused:'is-old'};
// قيمة البند على الشاشة: المبالغ بالهللات تُحوَّل إلى ريال عند العرض وحده، والبند غير المقيس يخرج بعبارته.
const sar=minor=>(Math.round(Number(minor))/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function figureValue(f){
  if(f.kind!=='measured')return f.kind_name;
  if(f.type==='text')return String(f.value||'—');
  if(f.type==='money')return `${sar(f.value)} ريال`;
  const n=Number(f.value).toLocaleString('en-US');
  return f.type==='percent'?`${n}%`:f.unit?`${n} ${f.unit}`:n;
}
const figureWhy=(e,f)=>f.kind==='measured'
  ? `المصدر: ${e(f.source)} · بتاريخ ${e(f.as_of)}${Number.isFinite(f.target)?` · المستهدف المعلن ${e(f.target)}`:''}${f.note?` · ${e(f.note)}`:''}`
  : `${e(f.reason)} — يلزم لقياسه: ${e(f.needed)}${f.gap_key?` · فجوة معلنة: <bdi>${e(f.gap_key)}</bdi>`:''}${f.owner?` · تسلّمها ${e(f.owner)}${f.target_on?` لين ${e(f.target_on)}`:''}`:''}`;
// البند المقيس وحده يحمل شريطًا، وهو كامل دائمًا لأنه مقيس كاملًا؛ نبرته تقول أبلغ المستهدف أم لا.
// البند غير المقيس لا يحمل شريطًا البتة — لا بطول صفر ولا بطول أدنى: غياب القياس ليس قياسًا منخفضًا.
const figureRow=(e,f)=>`<li class="figure-${e(f.kind)} ${f.kind!=='measured'?'is-old':f.tone==='weak'?'is-late':'is-ok'}"><strong>${e(f.label)}</strong><span>${e(figureValue(f))} · ${e(f.kind_name)}${f.kind==='measured'&&f.tone==='weak'?' — دون المستهدف المعلن':''}</span><small>${figureWhy(e,f)}</small>${f.kind==='measured'?`<div class="vn-bar ${f.tone==='weak'?'is-late':'is-ok'}" data-width="100"></div>`:''}</li>`;
const coverageLine=c=>c.declared?`التغطية المعلنة: انقاس ${c.measured} من ${c.declared} (${c.bp} نقطة أساس) · غير متاح ${c.unavailable} · غير قابل للقياس ${c.unmeasurable}`:'ما فيه بند معلن في هالقسم، فما تنحسب له تغطية.';
const gapLabels={own_gap:'إسناد بمالك وتاريخ',close_gap:'إغلاق بدليل',refuse_gap:'رفض القياس بسبب',reopen_gap:'إعادة فتح'};
const requestLabels={link_decision:'ربط القرار الصادر',withdraw_request:'سحب الطلب'};

export const epmoUI={
  title:'تقرير الإدارة التنفيذية للمشاريع',
  description:'اللي تحطه الإدارة التنفيذية للمشاريع قدام القيادة: الأسئلة اللي تنتظر قرار، والفجوات المعلنة ومين تسلّم إغلاق كل وحدة، وقراءة الإدارة المكتوبة لكل قسم. الفجوة تنقفل بدليل أو ينرفض قياسها بسبب، وما تختفي بالسكوت.',
  load:api=>api('/epmo'),
  render(data,{e,button,ui=kit(e)}){
    // البلاطة والجدول من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
    const tile=ui.tile;
    const g=data.gap_summary,open=data.decision_requests,write=data.can_prepare;

    /* ── الأسئلة المفتوحة أمام التنفيذيين ── */
    const requestCard=r=>`<details class="vn-card" open><summary><span class="vn-code">${e(r.section_name)}</span><span class="vn-name"><strong>${e(r.title)}</strong><small>${e(r.period_from)} لين ${e(r.period_to)} · رفعه ${e(r.raised_by_name)}</small></span><span class="vn-flags"><span class="badge">${e(r.status_name)}</span></span></summary>
      <div class="vn-body"><p class="measure">${e(r.asked)}</p>
      <section class="vn-block"><h3>الخيارات المعروضة</h3><ul class="vn-list">${r.options.map(o=>`<li><span>${e(o)}</span></li>`).join('')}</ul></section>
      <p class="vn-alert">أثر التأجيل: ${e(r.consequence_of_delay)}</p>
      ${r.decision_id?`<p class="subtle">القرار المرتبط: ${e(r.decision_title)} — ${e(r.decided_on)} (نصه وبدائله في سجل القرارات).</p>`:''}
      ${r.withdrawn_reason?`<p class="subtle">سبب السحب: ${e(r.withdrawn_reason)}</p>`:''}
      ${write&&r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,requestLabels[a])).join('')}</div>`:''}</div></details>`;

    /* ── سجل الفجوات المعلنة ── */
    const gapRow=x=>`<tr class="${gapTone[x.status]}"><td><strong>${e(x.statement)}</strong><br><small><bdi>${e(x.key)}</bdi></small></td><td>${e(x.department)}</td><td>${e(x.status_name)}</td><td>${e(x.owner_name||'—')}</td><td>${e(x.target_on||'—')}</td><td>${e(x.status==='closed'?x.closed_evidence:x.decision_note||'—')}</td>${write?`<td>${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.key,gapLabels[a])).join('')}</div>`:''}</td>`:''}</tr>`;
    const gapDetail=x=>`<details class="vn-card"><summary><span class="vn-code">${e(x.key)}</span><span class="vn-name"><strong>${e(x.statement)}</strong><small>${e(x.department)}</small></span><span class="vn-flags"><span class="vn-flag ${gapTone[x.status]}">${e(x.status_name)}</span></span></summary>
      <div class="vn-body"><dl class="detail-data"><dt>ليش ما ينقاس</dt><dd>${e(x.why)}</dd><dt>وش يلزم لقياسه</dt><dd>${e(x.needed)}</dd><dt>على مين يقع</dt><dd>${e(x.department)}</dd>
      ${x.owner_name?`<dt>تسلّمها</dt><dd>${e(x.owner_name)} · المستهدف ${e(x.target_on||'—')}</dd>`:''}
      ${x.closed_evidence?`<dt>دليل الإغلاق</dt><dd>${e(x.closed_evidence)}</dd>`:''}
      ${x.decision_note?`<dt>الملاحظة أو سبب القرار</dt><dd>${e(x.decision_note)}</dd>`:''}
      ${x.updated_at?`<dt>آخر تحديث</dt><dd>${e(x.updated_at)}</dd>`:''}</dl>
      ${write&&x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.key,gapLabels[a])).join('')}</div>`:''}</div></details>`;

    /* ── قراءة الإدارة لكل قسم ── */
    const sectionRow=s=>`<li class="${s.note?'is-ok':'is-due'}"><strong>${e(s.name)}${s.human?' — قسم بشري':''}</strong><span>${e(s.note||'ما انكتبت قراءة لهالقسم في هالفترة.')}</span><small>${e(s.note?`${s.note_written_by} · ${s.note_updated_at}`:`المصدر: ${s.source}`)}</small>${write?`<div class="operation-actions">${button('write_note',s.key,s.note?'تصحيح القراءة':'كتابة القراءة')}</div>`:''}</li>`;

    /* ── التقرير المركّب نفسه ── */
    const report=data.report,cover=report.coverage,perSection=report.section_coverage??{};
    const sectionCard=s=>{
      const c=perSection[s.key]??{declared:0,measured:0,unavailable:0,unmeasurable:0,bp:null};
      const groups=(s.groups??[]).map(gr=>`<section class="vn-block"><h3>${e(gr.title)}</h3>${gr.note?`<p class="subtle">${e(gr.note)}</p>`:''}<ul class="vn-list vn-bars">${(gr.figures??[]).map(f=>figureRow(e,f)).join('')}</ul></section>`).join('')
        ||'<p class="subtle">ما فيه مجموعات في هالقسم.</p>';
      return `<details class="vn-card" open><summary><span class="vn-code">${e(s.key)}</span><span class="vn-name"><strong>${e(s.name)}${s.human?' — قسم بشري':''}</strong><small>${e(coverageLine(c))}</small></span><span class="vn-flags"><span class="vn-flag ${c.declared&&c.measured===c.declared?'is-ok':c.measured?'is-warn':'is-due'}">${e(c.measured)} / ${e(c.declared)}</span></span></summary>
        <div class="vn-body">${s.note?`<p class="vn-alert">قراءة الإدارة: ${e(s.note)}</p>`:''}${groups}</div></details>`;
    };
    const snapshotRow=s=>`<li class="${s.status==='approved'?'is-ok':'is-due'}"><strong>${e(s.params.from)} لين ${e(s.params.to)}</strong><span>${e(s.status==='approved'?'معتمدة':'مسودة تنتظر الاعتماد')}</span><small>${e(s.created_at)} · بصمة <bdi dir="ltr">${e(String(s.digest).slice(0,12))}</bdi></small></li>`;
    const doc=(kind,label)=>`<a class="btn outline small" href="/api/reports/${e(report.key)}/${kind}?from=${e(report.params.from)}&amp;to=${e(report.params.to)}">${label}</a>`;

    const periodChoice=data.available_periods.map(p=>`<li class="${p.key===data.period.key?'is-active':''}"><strong>${e(p.from)} لين ${e(p.to)}</strong><span>${e(p.cadence_name)}${p.key===data.period.key?' · المعروضة':''}</span></li>`).join('');
    // الترتيب بالأهمية: ما ينتظر قرار القيادة أول الشاشة، ثم التقرير وأقسامه، ثم الفجوات وقراءات الإدارة، ثم اللقطات والفترات.
    return `<section class="panel panel-body vn-head"><p>${e(data.not_built)}</p><p class="vn-alert">${e(data.gap_rule)}</p>
      <div class="vn-tiles">${tile(`${data.period.from} → ${data.period.to}`,'الفترة المعروضة')}${tile(open.length,'سؤال ينتظر قرار',open.length?'is-late':'')}${tile(g.declared_in_catalogue,'فجوة معلنة في الكتالوج')}${tile(g.closed,'انقفلت بدليل','is-ok')}</div>
      <p class="subtle">${e(data.can_approve_hint)}</p>
      ${write?`<div class="operation-actions">${button('request_decision','','سؤال جديد للقيادة')}${data.report_actions.includes('save_snapshot')?button('save_snapshot','','حفظ لقطة مسودة لهالفترة'):''}</div>`:'<p class="subtle">حسابك يقرأ هالشاشة بس؛ الكتابة لصاحب صلاحية اعتماد مكتب إدارة المشاريع المؤسسي.</p>'}</section>

      <section class="vn-group"><h2>أسئلة تنتظر قرار <span>${e(open.length)}</span></h2>
      ${open.map(requestCard).join('')||'<p class="subtle">ما فيه سؤال مفتوح قدام القيادة الحين.</p>'}</section>

      <section class="panel panel-body"><h2>${e(report.title)} — <bdi>${e(report.key)}</bdi></h2>
      <p class="measure">${e(report.definition)}</p>
      <div class="vn-tiles">${tile(cover.declared,'بند معلن في التقرير')}${tile(cover.measured,'بند مقيس بمصدره','is-ok')}${tile(cover.unavailable,'غير متاح في هالفترة')}${tile(cover.unmeasurable,'غير قابل للقياس — فجوة معلنة','is-due')}</div>
      ${bars(e,[['التغطية المعلنة للتقرير',cover.measured,cover.declared||1]])}
      <p class="subtle">${e(coverageLine(cover))}</p>
      <ul class="vn-list">${report.notes.map(n=>`<li><span>${e(n)}</span></li>`).join('')}</ul>
      <div class="operation-actions"><a class="btn outline small" href="#reports">مركز التقارير — للاعتماد</a>${doc('print','التقرير كمستند')}${doc('export.xlsx','تصدير XLSX')}${doc('export.csv','تصدير CSV')}</div>
      <p class="subtle">الاعتماد من مركز التقارير: اللي أعدّ اللقطة ما يعتمدها.</p></section>

      <section class="vn-group"><h2>أقسام التقرير <span>${e(report.sections.length)}</span></h2>${report.sections.map(sectionCard).join('')}</section>

      <section class="panel panel-body"><h2>الفجوات المعلنة</h2>
      <div class="vn-tiles">${tile(g.declared,'معلنة بدون مالك',g.declared?'is-due':'')}${tile(g.owned,'مسندة بمالك وتاريخ')}${tile(g.closed,'انقفلت بدليل','is-ok')}${tile(g.refused,'انرفض قياسها بسبب')}</div>
      ${bars(e,[['انقفلت بدليل',g.closed,g.declared_in_catalogue],['مسندة بمالك وتاريخ',g.owned,g.declared_in_catalogue],['انرفض قياسها بسبب معلن',g.refused,g.declared_in_catalogue],['معلنة بدون مالك',g.declared,g.declared_in_catalogue]])}
      ${ui.table({head:['الفجوة','الإدارة','الحالة','المالك','المستهدف','الدليل أو السبب',...(write?['الإجراء']:[])],rows:data.gaps.map(gapRow),empty:'ما فيه فجوات معلنة في السجل للحين'})}
      ${data.gaps.length?`<h3>تفصيل كل فجوة</h3>${data.gaps.map(gapDetail).join('')}`:''}</section>

      <section class="panel panel-body"><h2>قراءة الإدارة لأقسام التقرير</h2>
      <ul class="vn-list">${data.sections.map(sectionRow).join('')}</ul></section>

      <section class="panel panel-body"><h2>لقطات هالتقرير</h2>
      ${data.snapshots.length?`<ul class="vn-list">${data.snapshots.map(snapshotRow).join('')}</ul>`:'<p class="subtle">ما فيه لقطة محفوظة لهالتقرير للحين.</p>'}</section>

      <section class="panel panel-body"><h2>الفترات المتاحة</h2><ul class="vn-list">${periodChoice}</ul></section>

      ${data.decided_requests.length?`<section class="panel panel-body"><h2>أسئلة انقفلت</h2>${data.decided_requests.map(requestCard).join('')}</section>`:''}`;
  },
  form(action,id,data){
    guard(data.can_prepare);
    const periodFields=[field('period_from','بداية الفترة','date',{value:data.period.from}),field('period_to','نهاية الفترة','date',{value:data.period.to})];
    const sectionOptions=data.sections.map(s=>({value:s.key,label:s.name}));

    // اللقطة تُحفظ مسودةً من مركز التقارير نفسه (E01)، فلا مسار حفظ ثانٍ ولا قاعدة ختم ثانية.
    // والاعتماد ليس هنا: يفتحه مركز التقارير لمن تغطيه صلاحيته وليس هو من أعدّها.
    if(action==='save_snapshot')return {title:'حفظ لقطة مسودة للتقرير',endpoint:'/reports/E01/snapshots',idempotent:true,
      fields:[field('from','بداية الفترة','date',{value:data.period.from}),field('to','نهاية الفترة','date',{value:data.period.to})],
      toPayload:v=>({from:v.from,to:v.to})};

    if(action==='request_decision')return {title:'سؤال أمام القيادة',endpoint:'/epmo/decision-requests',idempotent:true,
      fields:[...periodFields,field('section_key','القسم','select',{options:sectionOptions}),field('title','عنوان الطلب'),
        field('asked','وش المطلوب حسمه بالضبط','textarea',{hint:'20 حرف على الأقل. سؤال محدد جوابه نعم أو اختيار، مو عرض للوضع.'}),
        field('options','الخيارات المعروضة','rows',{minRows:2,maxRows:8,columns:[{name:'option',label:'الخيار وأثره'}],hint:'خيارين على الأقل؛ السؤال بخيار واحد مو سؤال، هذا إبلاغ.'}),
        field('consequence_of_delay','أثر تأجيل القرار','textarea',{hint:'وش يصير إذا ما انحسم هالفترة.'})],
      toPayload:v=>({period_from:v.period_from,period_to:v.period_to,section_key:v.section_key,title:v.title,asked:v.asked,
        options:(v.options??[]).map(r=>r.option).filter(Boolean),consequence_of_delay:v.consequence_of_delay})};

    if(action==='write_note'){
      const s=data.sections.find(x=>x.key===id);guard(s);
      return {title:`قراءة الإدارة — ${s.name}`,endpoint:'/epmo/notes',
        fields:[...periodFields,field('body','وش تقول أرقام هالقسم','textarea',{value:s.note,
          hint:'20 حرف على الأقل. «ما فيه جديد» مو قراءة؛ اكتب وش تغيّر وليش ووش يترتب عليه.'})],
        toPayload:v=>({period_from:v.period_from,period_to:v.period_to,section_key:s.key,body:v.body,version:s.note_version})};
    }

    const r=data.decision_requests.find(x=>x.id===id);
    if(r){guard(r.actions.includes(action));
      if(action==='link_decision')return {title:`ربط القرار — ${r.title}`,endpoint:`/epmo/decision-requests/${id}/link_decision`,
        fields:[field('decision_id','معرّف القرار في سجل القرارات',
          'text',{hint:'القرار ينسجل أول في «القرارات والمحاضر» بنصه وبدائله وأثره، وبعدين ينربط هنا.'})],
        toPayload:v=>({version:r.version,decision_id:v.decision_id.trim()})};
      return {title:`سحب الطلب — ${r.title}`,endpoint:`/epmo/decision-requests/${id}/withdraw_request`,
        fields:[field('reason','سبب السحب','textarea',{hint:'10 أحرف على الأقل. السؤال المسحوب يبقى ظاهر بسببه.'})],
        toPayload:v=>({version:r.version,reason:v.reason})};}

    const gap=data.gaps.find(x=>x.key===id);guard(gap&&gap.actions.includes(action));
    const endpoint=`/epmo/gaps/${encodeURIComponent(id)}/${action}`;
    // عنوان النافذة مختصر لأن الطويل يُقصّ في الواجهة فيضيع معناه؛ ونصّ الفجوة كاملًا في تلميح أول حقل،
    // فلا يقرر أحد إسنادها أو إغلاقها أو رفضها وهو لا يرى ما الذي لا يُقاس ولا على من يقع.
    const head=`${gapLabels[action]} — ${gap.statement.slice(0,48)}${gap.statement.length>48?'…':''}`;
    const context=`الفجوة: ${gap.statement} على ${gap.department}. ليش ما تنقاس اليوم: ${gap.why}`;
    if(action==='own_gap')return {title:head,endpoint,
      fields:[field('owner_id','مين يتسلّمها','text',{hint:`${context} — اكتب معرّف حساب نشط يتسلّم إغلاقها.`}),
        field('target_on','التاريخ المستهدف','date',{hint:'متى يصير البند قابل للقياس. مالك بدون تاريخ مو إسناد.'}),
        field('note','ملاحظة','textarea',{required:false})],
      toPayload:v=>({version:gap.version,owner_id:v.owner_id.trim(),target_on:v.target_on,note:v.note||''})};
    if(action==='close_gap')return {title:head,endpoint,
      fields:[field('evidence','وش خلّى البند قابل للقياس','textarea',{hint:`${context} — واللي كان يلزم: ${gap.needed}. اكتب 10 أحرف على الأقل تسمّي السجل اللي صار يحمل الرقم؛ «تم» مو دليل.`})],
      toPayload:v=>({version:gap.version,evidence:v.evidence})};
    if(action==='refuse_gap')return {title:head,endpoint,
      fields:[field('reason','سبب القرار إنه ما ينقاس','textarea',{hint:`${context} — 10 أحرف على الأقل.`})],
      toPayload:v=>({version:gap.version,reason:v.reason})};
    return {title:head,endpoint,
      fields:[field('reason','سبب إعادة الفتح','textarea',{hint:`${context} — وش خلّى البند ما ينقاس مرة ثانية. الفجوة ترجع «معلنة» بدون مالك.`})],
      toPayload:v=>({version:gap.version,reason:v.reason})};
  }
};
