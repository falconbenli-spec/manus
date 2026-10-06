// جودة الكتالوج: أين ينقص إرشاد الخدمات، وأي الحقول تُرجع الطلبات فعلًا، مرتبة بالاستخدام.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
// ── صحة شجرة مركز الخدمات (الدفعة الرابعة) ───────────────────────────────────
// المقاييس المحسوبة وحدها بلاطاتٍ وجداول من العدّة، وما لا يُحسب جدولٌ «غير متاح» بسببه وما يلزمه. لا نسبة ولا زمن يُخترع،
// وقمع البحث يُقرأ بأسماء أعداده. القسم لحامل التصريح (يصل مع can_manage) ويُرسم بالعدّة وحدها، فسياقٌ بلا عدّة يتخطّاه.
function treeBlock(t,{e,ui}){
  if(!t||typeof ui?.tile!=='function'||typeof ui?.table!=='function')return '';
  const tiles=`<div class="vn-tiles">${[
    ui.tile(t.items_unplaced.value,'بند بلا فئة (الهدف صفر)',t.items_unplaced.value?'is-late':'is-ok'),
    ui.tile(t.out_of_range.length,'فئة خارج 3–12 بطاقة',t.out_of_range.length?'is-due':'is-ok'),
    ui.tile(t.hidden,'خدمة موقوفة من الإعدادات'),
    ui.tile(`${t.cards_published.value}/${t.cards_published.of}`,'بطاقة تعريف منشورة'),
    ui.tile(`${t.targets_adopted.value}/${t.targets_adopted.of}`,`زمن متبنًّى (${t.targets_adopted.derived} مشتق)`,t.targets_adopted.value?'':'is-due'),
    ui.tile(t.synonyms.thin_count,'بند بأقل من ثلاثة مرادفات',t.synonyms.thin_count?'is-due':'is-ok'),
    ui.tile(t.journeys.open,'رحلة مفتوحة'),ui.tile(t.journeys.blocked_steps,'خطوة رحلة تعذّرت',t.journeys.blocked_steps?'is-late':'')].join('')}</div>`;
  const audiences=t.audiences.map(a=>`<h3>${e(a.name)}</h3>${ui.table({head:['الفئة','بطاقات','بنود','ملاحظة'],rows:a.categories.map(c=>`<tr><td>${e(c.name)}</td><td>${e(c.cards)}</td><td>${e(c.items)}</td><td>${c.flag==='under_3'?'أقل من ثلاث بطاقات — تُدمج':c.flag==='over_12'?'أكثر من اثنتي عشرة — تُقسم':''}</td></tr>`)})}`
    +`<p class="subtle">${e(`${a.totals.categories} فئات · ${a.totals.cards} بطاقة · ${a.totals.items} بندًا · النسخة ${a.release_version}`)}</p>`).join('');
  const f=t.funnel;
  const funnel=`<p class="subtle">${e(f.note)}</p><dl class="detail-data"><div><dt>بحث</dt><dd>${e(f.searched)}</dd></div><div><dt>فتح</dt><dd>${e(f.opened)}</dd></div><div><dt>تقديم</dt><dd>${e(f.submitted)}</dd></div>`
    +`<div><dt>فُتح من المرتبة الأولى</dt><dd>${e(f.opened_first)} من ${e(f.opened)} فتحة</dd></div><div><dt>جلسات بحث</dt><dd>${e(f.sessions)}</dd></div><div><dt>بحوثٌ انتهت بلا تقديم</dt><dd>${e(f.sessions_without_submit)} من ${e(f.sessions)}</dd></div></dl>`;
  const thin=t.synonyms.thin.length?ui.table({head:['البند','الاسم','مرادفاته'],rows:t.synonyms.thin.map(x=>`<tr><td><bdi dir="ltr">${e(x.key)}</bdi></td><td>${e(x.name)}</td><td>${e(x.synonyms)}</td></tr>`)}):`<p class="subtle">${e(`كل بندٍ من ${t.synonyms.items} له ثلاثة مرادفات فأكثر.`)}</p>`;
  const misses=t.misses.length?ui.table({head:['السؤال (مطبَّعًا)','مرات','آخرها'],rows:t.misses.map(m=>`<tr><td>${e(m.query)}</td><td>${e(m.n)}</td><td>${e(String(m.last_at).slice(0,10))}</td></tr>`)}):`<p class="subtle">${e(`لا بحثٌ بلا نتيجة تكرر ${t.misses_min_count} مرات في ${t.misses_window_days} يومًا.`)}</p>`;
  const journeys=`<p class="subtle">${e(`${t.journeys.open} مفتوحة · ${t.journeys.completed} مكتملة · ${t.journeys.blocked_steps} خطوة تعذّرت · ${t.journeys.waiting_children} طلب ابن ينتظر صاحبه`)}</p>`;
  const unavailable=ui.table({head:['المقياس','لماذا لا يُعرض','ما يلزم','عند'],rows:t.unavailable.map(g=>`<tr><td>${e(g.label)} — غير متاح</td><td>${e(g.why)}</td><td>${e(g.needs)}</td><td>${e(g.owner)}</td></tr>`)});
  return `<section class="panel"><div class="panel-head"><h2>صحة شجرة مركز الخدمات</h2><small>${e(t.note)}</small></div><div class="panel-body">${tiles}${audiences}`
    +`<h3>قمع البحث في ${e(f.days)} يومًا</h3>${funnel}<h3>بنود بأقل من ثلاثة مرادفات</h3>${thin}<h3>بحثٌ بلا نتيجة تكرر ${e(t.misses_min_count)} مرات</h3>${misses}`
    +`<h3>الرحلات</h3>${journeys}<p class="subtle">${e(`سابقة الأهلية: ${t.benefits.sentence}؛ آلية المزايا ما اشتغلت ولا مرة على بيانات معتمدة.`)}</p>`
    +`<h3>اللي ما ينحسب بصدق</h3>${unavailable}</div></section>`;
}
export const catalogQualityUI={
  title:'جودة الكتالوج',
  description:'تقرير لمسؤول إعداد الخدمات: الخدمات اللي ينقصها إرشاد أو مثال أو زمن مستهدف أو بطاقة منشورة، مرتّبة بعدد الطلبات المقدّمة فعلًا، والحقول اللي انسجلت سببًا لإرجاع الطلبات. التقرير ما يعدّل الكتالوج بنفسه.',
  load:api=>api('/catalog-quality'),
  render(data,{e,button,ui}){
    // زرّ «تسجيل سبب الإعادة» يتكرر في كل صف، فاسمه المسموع يحمل طلبه ويبدأ بنصّه الظاهر (WCAG 2.5.3).
    const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
    const returns=data.my_returns.length?`<section class="panel"><div class="panel-head"><h2>طلبات أعدتها</h2><small>${e(data.my_returns.length)}</small></div><div class="panel-body"><p class="subtle">سجّل أي حقل كان سبب الإعادة؛ هذا اللي يحسّن الخدمة للي يطلبها بعدك.</p><ul class="vn-list">${data.my_returns.map(r=>`<li><strong>${e(r.title)}</strong><span><bdi dir="ltr">${e(r.service_code)}</bdi> · ${e(r.service_name)}${r.recorded.length?` · سُجل ${e(r.recorded.length)}`:''}</span>${r.actions.map(a=>named(button(a,r.id,'تسجيل سبب الإعادة'),`تسجيل سبب الإعادة: ${r.title}`)).join('')}</li>`).join('')}</ul></div></section>`:'';
    if(!data.can_manage)return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>${returns||'<section class="panel panel-body"><p class="muted">ما فيه طلبات أعدتها تنتظر تسجيل سببها. التقرير الكامل لمسؤول إعداد الخدمات.</p></section>'}`;
    const t=data.totals;
    // «الخدمات» يشمل الموقوفة بمفتاح الإعدادات، وعددها يُقال في البلاطة نفسها حين يكون فوق الصفر:
    // رقمٌ ينقص بلا سبب مكتوب يُقرأ كتالوجًا أصغر، لا خدمةً أوقفها المالك وطلباتها ما زالت تمشي.
    const tiles=`<div class="vn-tiles">${[[t.hidden?`الخدمات، منها ${t.hidden} موقوفة`:'الخدمات',t.services],['فيها نقص',t.with_gaps],['بلا بطاقة منشورة',t.without_card],['بلا زمن مستهدف',t.without_target],['طلبات مقدمة',t.requests],['طلبات أُعيدت',t.returned],['أسباب ارتداد مسجلة',t.field_feedback]].map(([label,n])=>`<div class="vn-tile"><strong>${e(n)}</strong><span>${e(label)}</span></div>`).join('')}</div>`;
    const hot=data.fields.length?`<section class="panel"><div class="panel-head"><h2>الحقول الأكثر إرجاعًا للطلبات</h2></div><div class="panel-body"><ul class="vn-list">${data.fields.map(f=>`<li><strong><bdi dir="ltr">${e(f.service_code)}</bdi> · ${e(f.label)}</strong><span>${e(f.total)} مرة — ${Object.entries(f.reasons).map(([k,n])=>`${e(data.reasons[k]??k)} (${e(n)})`).join('، ')}</span></li>`).join('')}</ul></div></section>`:'<section class="panel panel-body"><p class="muted">ما انسجل للحين أي سبب ارتداد مرتبط بحقل.</p></section>';
    const row=s=>`<details class="vn-card"><summary><span class="vn-code"><bdi dir="ltr">${e(s.code)}</bdi></span><span class="vn-name"><strong>${e(s.name)}</strong><small>${e(s.requests)} طلب · ${e(s.returned)} أُعيد · ${e(s.field_feedback)} سبب مسجل</small></span><span class="vn-flags">${s.hidden?'<span class="badge is-late">موقوفة من الإعدادات</span>':''}${s.gaps.length?`<span class="badge is-due">${e(s.gaps.length)} نقص</span>`:'<span class="badge is-ok">مكتملة</span>'}</span></summary>
      <div class="vn-body">${s.gaps.length?`<div class="vn-alert">${s.gaps.map(e).join(' · ')}</div>`:''}<dl class="detail-data">${s.fields.map(f=>`<div><dt>${e(f.label)}${f.conditional?' <span class="badge">مشروط</span>':''}</dt><dd>${f.why?'السبب ✓':'بلا سبب'} · ${f.hint?'إرشاد ✓':'بلا إرشاد'} · ${f.example?'مثال ✓':'بلا مثال'}</dd></div>`).join('')}</dl></div></details>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${tiles}</section>${treeBlock(data.tree,{e,ui})}${returns}${hot}<section class="panel panel-body"><p class="subtle">الترتيب: الأكثر طلبًا أول، وبعده الأكثر ارتدادًا، وبعده الأكثر نقصًا.</p></section>${data.services.map(row).join('')}`;
  },
  form(action,id,data){
    guard(action==='report_field_gap');
    const r=data.my_returns.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    return {title:`سبب إعادة: ${r.title}`,endpoint:`/catalog-quality/requests/${id}/field-gap`,idempotent:true,
      fields:[field('reason','السبب','select',{options:Object.entries(data.reasons).map(([value,label])=>({value,label}))}),
        field('field_key','الحقل','select',{required:false,value:'',options:[{value:'',label:'حقل غير موجود في النموذج'},...r.fields.map(f=>({value:f.key,label:f.label}))],hint:'اتركه «حقل غير موجود» فقط إن كان السبب «حقل لازم غير موجود في النموذج».'}),
        field('note','ما الذي كان ناقصًا أو غامضًا','textarea',{maxLength:1000})],
      toPayload:v=>({reason:v.reason,field_key:v.reason==='missing_field'?'':v.field_key||'',note:v.note})};
  }
};
