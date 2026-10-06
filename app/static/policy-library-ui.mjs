// «مكتبة السياسات»: شاشة البيت، وصفحة المادة، ولوحة الأدمن.
//
// العنوان هو الحالة: #policy-library بيت المكتبة، و#policy-library/article/65 مادة، و#policy-library/search/كلمة نتيجة،
// و#policy-library/admin لوحة الموارد البشرية. هكذا يُنسخ رابط المادة ويُشارك — وهو بديل الطباعة التي منعها المالك.
//
// البحث أثناء الكتابة مستمع واحد مفوَّض على المستند، مكتوب في هذا الملف لا في app.mjs: إطار العمليات يبني الصفحة
// من نص ولا يعطي خطّافًا بعد الرسم، وسياسة المحتوى تمنع أي نص مضمَّن. كل ما يُحقن يُهرَّب هنا حرفًا حرفًا.
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const TONE={old:'is-old',new:'is-ok',due:'is-due'};

const path=()=>{try{return decodeURIComponent(location.hash.slice(1)).split('/');}catch{return ['policy-library'];}};
const mode=()=>{const parts=path();return parts[1]??'home';};
const queryFromHash=()=>path().slice(2).join('/');

// ── قطع مشتركة ─────────────────────────────────────────────────────────────────
const badgeChip=b=>`<span class="badge ${TONE[b.tone]??''}">${esc(b.name)}</span>`;
// شاشة القراءة تعرض نص المادة ومرجعها وحدهما (معيار المالك، 23 سبتمبر): وسم «مستخرج — يحتاج مطابقة» وآثار الاستخراج
// وعنوانٌ ينتظر اعتمادًا مادةُ عملٍ لمن يملك تصحيحها، فتظهر لحامل أفعال التحرير وحده وتبقى في لوحة المكتبة وسجل التدقيق.
const forReaders=badges=>(badges??[]).filter(b=>b.key!=='unverified');
const excerptHtml=piece=>(piece?.parts??[]).map(p=>p.hit?`<mark>${esc(p.text)}</mark>`:esc(p.text)).join(' ');
const resultRow=r=>`<li class="${r.status==='in_force'?'':'is-old'}">
  <strong><a href="#policy-library/article/${esc(r.number)}">المادة ${esc(r.number)} — ${esc(r.title)}</a></strong>
  <span>${esc(r.chapter)} · ${esc(r.status_name)}</span>
  ${r.in_force_instead?`<small class="is-warn-text">هذا النص استُبدل، والمعمول به <a href="#policy-library/article/${esc(r.in_force_instead)}">المادة ${esc(r.in_force_instead)}</a></small>`:''}
  <span class="policy-excerpt">${excerptHtml(r.excerpt)}</span>
  ${forReaders(r.badges).length?`<small>${forReaders(r.badges).map(badgeChip).join(' ')}</small>`:''}
  ${r.scroll_to?`<small class="subtle">الفقرة المطابقة: ${esc(r.scroll_to)}</small>`:''}</li>`;

const resultsHtml=data=>{
  if(!data.query)return '<p class="subtle">اكتب رقم مادة أو كلمة أو سؤال عادي. التشكيل وصورة الهمزة ونوع الأرقام ما تفرق.</p>';
  const head=`<p class="subtle">${esc(data.total)} نتيجة في ${esc(data.took_ms)} مللي ثانية${data.explain.fuzzy.length?` · صُحِّح إملائيًا: ${data.explain.fuzzy.map(f=>`«${esc(f.from)}» ← «${esc(f.to)}»`).join('، ')}`:''}${data.explain.synonyms.length?` · مرادفات: ${data.explain.synonyms.map(esc).join('، ')}`:''}</p>`;
  const direct=data.direct_article?`<div class="panel panel-body is-ok"><strong>رقم مباشر:</strong> <a href="#policy-library/article/${esc(data.direct_article.number)}">المادة ${esc(data.direct_article.number)} — ${esc(data.direct_article.title)}</a> <span class="subtle">${esc(data.direct_article.chapter)}</span></div>`:'';
  if(!data.results.length&&!data.direct_article)
    return `${head}<div class="panel panel-body"><strong>ما فيه نص يجيب</strong><p>ما لقت المكتبة مادة تجيب «${esc(data.query)}». ${data.explain.unmatched.length?`كلمات ما عرفها الفهرس: ${data.explain.unmatched.map(esc).join('، ')}. `:''}سؤالك انسجل في «أسئلة بلا نتيجة» عشان تشوفه الموارد البشرية وتضيف المرادف أو تراجع النص.</p></div>`;
  return `${head}${direct}<ul class="vn-list">${data.results.map(resultRow).join('')}</ul>`;
};

// ── البحث أثناء الكتابة ────────────────────────────────────────────────────────
// تأخير صغير: الكتابة أسرع من الشبكة، وبلا تأخير يرسل كل حرف طلبًا ويصل الأقدم بعد الأحدث. الرقم التسلسلي
// يضمن أن آخر ما كتبه المستخدم هو ما يظهر، مهما اختلف ترتيب الردود.
if(typeof document!=='undefined'&&typeof fetch==='function'){
  let timer=null,turn=0;
  const run=async()=>{
    const field=document.querySelector('[data-policy-search]'),box=document.querySelector('[data-policy-results]');
    if(!field||!box)return;
    // منطقة الإعلان ثابتة في الصفحة من أول رسم (role=status)، ويتغيّر نصّها وحده: «12 نتيجة» تُقال بعد توقّف الكتابة.
    const say=text=>{const status=document.querySelector('[data-policy-status]');if(status)status.textContent=text;};
    const mine=++turn,value=field.value.trim();
    const filters=[...document.querySelectorAll('[data-policy-filter]')]
      .filter(select=>select.value).map(select=>`${encodeURIComponent(select.dataset.policyFilter)}=${encodeURIComponent(select.value)}`);
    const url=`/api/policy-library/search?q=${encodeURIComponent(value)}${filters.length?'&'+filters.join('&'):''}`;
    try{
      const response=await fetch(url,{credentials:'same-origin',headers:{accept:'application/json'}});
      if(mine!==turn)return;
      if(!response.ok){box.innerHTML='<p class="error">ما قدرنا نبحث الحين — جرّب مرة ثانية.</p>';say('ما قدرنا نبحث الحين');return;}
      const data=await response.json();
      if(mine!==turn)return;
      box.innerHTML=resultsHtml(data);
      say(data.query?`${data.total} نتيجة`:'');
      // العنوان يحمل ما بُحث عنه فيبقى الرابط قابلًا للمشاركة، دون إعادة رسم الصفحة.
      const target=`#policy-library/search/${encodeURIComponent(value)}`;
      if(value&&location.hash!==target)history.replaceState(null,'',target);
    }catch{if(mine===turn){box.innerHTML='<p class="error">انقطع الاتصال بالخادم — تأكد من الشبكة وجرّب مرة ثانية.</p>';say('انقطع الاتصال بالخادم');}}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(run,180);};
  document.addEventListener('input',event=>{if(event.target?.matches?.('[data-policy-search]'))schedule();});
  document.addEventListener('change',event=>{if(event.target?.matches?.('[data-policy-filter]'))schedule();});
  // رابط مشارَك يفتح على نتيجة بحث: الصفحة تُرسم من نص ولا خطّاف بعد الرسم، فيُرصد ظهور صندوق النتائج مرة واحدة
  // ويُشغَّل البحث. العلامة على العنصر تمنع تكرار الطلب مع كل تغيّر لاحق في الصفحة.
  const openPending=()=>{
    const box=document.querySelector('[data-policy-results]:not([data-policy-ran])');
    if(!box)return;
    box.setAttribute('data-policy-ran','');
    if(document.querySelector('[data-policy-search]')?.value.trim())run();
  };
  try{new MutationObserver(openPending).observe(document.documentElement,{childList:true,subtree:true});}catch{/* متصفح بلا MutationObserver: البحث يعمل بالكتابة */}
  document.addEventListener('DOMContentLoaded',openPending);
}

// ── شاشة البيت ─────────────────────────────────────────────────────────────────
const searchBox=(e,data,value='')=>`<section class="panel panel-body vn-head policy-search">
  <label class="full"><span>ابحث في مكتبة السياسات</span>
    <input type="search" data-policy-search value="${e(value)}" maxlength="200" autocomplete="off"
      placeholder="«٦٥» أو «م/65» أو «إجازة زواج» أو «كم يوم سكليف براتب كامل»"></label>
  <div class="policy-filters">
    <label><span>الوثيقة</span><select data-policy-filter="document"><option value="">الكل</option>${data.filter_options?.documents?.map(d=>`<option value="${e(d.id)}">${e(d.title)}</option>`).join('')??''}</select></label>
    <label><span>الباب</span><select data-policy-filter="chapter"><option value="">الكل</option>${(data.chapters??data.filter_options?.chapters??[]).map(c=>{const name=c.name??c;return `<option value="${e(name)}">${e(name)}</option>`;}).join('')}</select></label>
    <label><span>الحالة</span><select data-policy-filter="status"><option value="">الكل</option><option value="in_force">سارية</option><option value="amended">معدّلة</option><option value="replaced">استُبدلت</option><option value="repealed">ملغاة</option></select></label>
    <label><span>المحتوى</span><select data-policy-filter="content"><option value="">الكل</option><option value="penalties">لها صفوف في جداول الجزاءات</option><option value="amended">معدّلة أو مستبدلة</option>${data.can_edit?'<option value="unverified">ما طوبقت مع الأصل</option>':''}</select></label>
  </div>
  <p class="sr-only" role="status" data-policy-status></p>
  <div data-policy-results>${value?'<p class="subtle">جارٍ البحث…</p>':'<p class="subtle">النتائج تطلع هنا وأنت تكتب.</p>'}</div>
</section>`;

const chapterCard=(e,c)=>`<a class="policy-chapter" href="#policy-library/search/${encodeURIComponent(c.name)}">
  <strong>${e(c.name)}</strong><span>${e(c.count)} مادة · م${e(c.first)}–م${e(c.last)}</span>
  ${c.in_force<c.count?`<small class="subtle">${e(c.count-c.in_force)} منها معدّلة أو مستبدلة</small>`:''}</a>`;

// فحص الاكتمال: مادة عمل لمن يحرّر المكتبة (لوحة المكتبة وكتلة «للموارد البشرية»)، لا لشاشة القراءة.
const completenessBlock=(e,c)=>`<section class="vn-block"><h3>فحص الاكتمال</h3>
    <p class="${c.complete?'':'error'}">${c.complete?`كل مواد الفهرس المعتمد موجودة: ${e(c.found_articles)} من ${e(c.expected_articles)} مادة في ${e(c.found_chapters)} بابًا، و${e(c.found_penalty_rows)} من ${e(c.expected_penalty_rows)} صفًّا في الجداول الثلاثة.`:`ناقص: ${e(c.missing.join('، '))}`}</p>
    <p class="subtle">${e(c.note)} — ${e(c.clean_articles)} مادة خرجت من الاستخراج بلا أثر تلف، و${e(c.with_artifacts)} مادة فيها أثر مكتوب على صفحتها، و${e(c.proposed_titles)} عنوانًا اقترحه النظام وينتظر اعتماد الأدمن.</p></section>`;

function homeView(data,{e,button}){
  const c=data.completeness,regulation=data.documents.find(d=>d.code==='work_regulation');
  // رأس المكتبة: الوثيقة وسندها (رقمها وتاريخ اعتمادها) وحجمها — لا قصة استخراجها.
  const basis=regulation?`<p class="measure"><strong>${e(regulation.title)}</strong>${regulation.reference_no&&regulation.reference_no!=='—'?` — رقم <bdi>${e(regulation.reference_no)}</bdi>`:''}${regulation.approved_on?`، اعتُمدت <time datetime="${e(regulation.approved_on)}">${e(regulation.approved_on)}</time>`:''}. ${e(data.total_articles)} مادة في ${e(data.chapters.length)} بابًا.</p>`:'';
  return `${searchBox(e,data,queryFromHash())}
  <section class="panel panel-body">${basis}<p class="subtle">${e(data.no_print)}</p></section>
  <section class="vn-board"><div class="vn-tiles">
    ${tile(e,data.total_articles,'مادة في المكتبة')}
    ${tile(e,data.chapters.length,'بابًا')}
    ${tile(e,c.found_penalty_rows,'صفًّا في جداول الجزاءات')}
    ${data.can_edit?tile(e,c.needs_verification,'مادة تنتظر المطابقة مع الأصل الموقّع',c.needs_verification?'is-due':'is-ok'):''}
  </div>
  ${data.acknowledgement?`<section class="vn-block"><h3>قرأت واطلعت</h3>
    <p>${e(data.acknowledgement.title)} — ${data.acknowledgement.acknowledged_at?`أقريت بقراءتها في <time datetime="${e(data.acknowledgement.acknowledged_at)}">${e(String(data.acknowledgement.acknowledged_at).slice(0,10))}</time>`:'ما أقريت بقراءتها للحين'}</p>
    <p class="subtle">${e(data.acknowledgement.note)}</p>
    <div class="operation-actions">${data.acknowledgement.actions.map(a=>button(a,data.acknowledgement.document_id,'أقر بأني قرأت واطلعت')).join('')}</div></section>`:''}
  ${data.pending_acknowledgement_rounds.length?`<section class="vn-block"><h3>جولات إقرار تنتظرك</h3><ul class="vn-list">${data.pending_acknowledgement_rounds.map(r=>`<li class="is-due"><strong>${e(r.title)}</strong><span>قبل ${e(r.due_on)}</span><small><a href="${e(r.link)}">افتح «إقرار الاطلاع على السياسات»</a></small></li>`).join('')}</ul></section>`:''}
  <section class="vn-block"><h3>الأبواب</h3><div class="policy-chapters">${data.chapters.map(x=>chapterCard(e,x)).join('')}</div></section>
  <section class="vn-block"><h3>آخر التحديثات</h3>
    ${data.latest_updates.length?`<ul class="vn-list">${data.latest_updates.map(u=>`<li><strong><a href="#policy-library/article/${e(u.number)}">المادة ${e(u.number)} — ${e(u.title)}</a></strong><span>${e(u.chapter)} · النسخة ${e(u.revision)} · ${e(u.status_name)}${u.effective_from?` · تسري من ${e(u.effective_from)}`:''}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه تحديثات للحين.</p>'}</section>
  <section class="vn-block"><h3>الأكثر بحثًا</h3>
    ${data.popular_terms.length?`<ul class="vn-list">${data.popular_terms.map(t=>`<li><strong><a href="#policy-library/search/${encodeURIComponent(t.term)}">${e(t.term)}</a></strong><span>${e(t.count)} مرة</span></li>`).join('')}</ul>`:'<p class="subtle">ما انسجل بحث للحين.</p>'}</section>
  ${data.favourites.length?`<section class="vn-block"><h3>موادي المفضلة</h3><ul class="vn-list">${data.favourites.map(f=>`<li><strong><a href="#policy-library/article/${e(f.number)}">المادة ${e(f.number)} — ${e(f.title)}</a></strong><span>${e(f.chapter)} · ${e(f.status_name)}</span></li>`).join('')}</ul></section>`:''}
  <section class="vn-block"><h3>الوثائق</h3><ul class="vn-list">${data.documents.map(d=>`<li class="${d.status==='published'?'is-ok':'is-due'}"><strong>${e(d.title)}</strong><span>${e(d.status_name)}${d.reference_no&&d.reference_no!=='—'?` · رقم <bdi>${e(d.reference_no)}</bdi>`:''}${d.approved_on?` · اعتُمدت ${e(d.approved_on)}`:''} · ${e(d.articles)} مادة</span>${data.can_edit&&d.source_note?`<small class="subtle">${e(d.source_note)}</small>`:''}</li>`).join('')}</ul></section>
  ${data.can_edit?`<section class="vn-block"><h3>للموارد البشرية</h3><p class="subtle measure">${e(data.note)}</p><p class="subtle">التحرير والتحليلات وقاموس المرادفات في <a href="#policy-library/admin">لوحة المكتبة</a>.</p></section>${completenessBlock(e,c)}`:''}
  </section>`;
}

// ── صفحة المادة ────────────────────────────────────────────────────────────────
const paragraph=(e,p,highlight)=>`<li id="p-${e(p.index)}" class="${highlight===p.index?'is-match':''}">${p.marker?`<strong>${e(p.marker)}.</strong> `:''}${e(p.text)}</li>`;

function articleViewHtml(data,{e,button}){
  const a=data.article,editor=data.actions.some(x=>['edit_article','verify_article','approve_title'].includes(x));
  const badges=editor?a.badges:forReaders(a.badges);
  return `<section class="panel panel-body vn-head">
    <p><a href="#policy-library"><span aria-hidden="true">→ </span>مكتبة السياسات</a> · ${e(a.chapter)}</p>
    <h2>المادة ${e(a.number)} — ${e(a.title)}</h2>
    ${badges.length?`<p>${badges.map(badgeChip).join(' ')}</p>`:''}
    <p class="subtle">${a.effective_from?`تسري من <time datetime="${e(a.effective_from)}">${e(a.effective_from)}</time> · `:''}النسخة ${e(a.revision)}</p>
    ${editor&&a.title_source!=='approved'?`<p class="subtle">العنوان ${a.title_source==='extracted'?'من عنوان فرعي في الأصل':'اقتراح من النظام ينتظر اعتماد الموارد البشرية'}.</p>`:''}
    ${editor?`<p class="subtle">${e(a.source_note)}</p>`:''}
    ${editor&&a.artifacts.length?`<ul class="vn-list">${a.artifacts.map(x=>`<li class="is-due"><small>${e(x.name)}</small></li>`).join('')}</ul>`:''}
  </section>
  <section class="vn-board">
  <section class="vn-block"><h3>النص</h3>
    <ol class="policy-text measure">${a.paragraphs.map(p=>paragraph(e,p,a.scroll_to)).join('')}</ol></section>
  ${data.original_text.length?`<section class="vn-block"><h3>عرض النص الأصلي</h3>
    ${data.original_text.map(o=>`<details><summary>المادة ${e(o.number)} — ${e(o.title)} (${e(o.status_name)})</summary><p>${e(o.body)}</p><p class="subtle"><a href="#policy-library/compare/${e(a.number)}">قارن النسختين</a></p></details>`).join('')}</section>`:''}
  ${a.penalties.tables.length?`<section class="vn-block"><h3>جداول المخالفات والجزاءات المرتبطة</h3>
    <p class="subtle">${editor?`${e(a.penalties.note)} `:''}المصدر: <a href="${e(a.penalties.source?.link??'#discipline')}">${e(a.penalties.source?.schedule_title??'وحدة الجزاءات')}</a>${a.penalties.source&&!a.penalties.source.accepted?' — ما اعتُمد للكيان للحين':''}.</p>
    ${a.penalties.tables.map(t=>`<details><summary>${e(t.name)} (${e(t.rows.length)} صفًا)</summary><ul class="vn-list">${t.rows.map(r=>`<li><strong><bdi>${e(r.code)}</bdi> · البند ${e(r.item)}</strong><span>${e(r.text)}</span><small>${e((r.penalties??[]).filter(Boolean).join(' · '))}${r.extra_deduction?` · بالإضافة إلى حسم ${e(r.extra_deduction)}`:''}</small>${r.note?`<small class="subtle">${e(r.note)}</small>`:''}${editor&&r.uncertain?`<small class="error">خانة غير مؤكدة (${e(r.uncertain)})</small>`:''}</li>`).join('')}</ul></details>`).join('')}</section>`:''}
  ${a.actions.length?`<section class="vn-block"><h3>إجراءات ذات صلة</h3><div class="operation-actions">${a.actions.map(x=>`<a class="btn outline small" href="${e(x.link)}">${e(x.name)}</a>`).join('')}</div></section>`:''}
  ${a.references.length||a.external_references.length?`<section class="vn-block"><h3>الإحالات</h3><ul class="vn-list">
    ${a.references.map(r=>`<li><strong><a href="#policy-library/article/${e(r.number)}">المادة ${e(r.number)} — ${e(r.title)}</a></strong>${r.phrase?`<small class="subtle">«${e(r.phrase)}»</small>`:''}</li>`).join('')}
    ${a.external_references.map(r=>`<li class="is-old"><strong>${e(r.label)}</strong><small>${e(r.note)}</small></li>`).join('')}</ul></section>`:''}
  ${a.related.length?`<section class="vn-block"><h3>مواد ذات صلة</h3><ul class="vn-list">${a.related.map(r=>`<li><strong><a href="#policy-library/article/${e(r.number)}">المادة ${e(r.number)} — ${e(r.title)}</a></strong><span>${e(r.chapter)} · ${e(r.status_name)}</span></li>`).join('')}</ul></section>`:''}
  <section class="vn-block"><h3>فهرس الباب</h3>
    <details open><summary>${e(a.chapter)} (${e(data.chapter_index.length)} مادة)</summary>
      <ul class="policy-index-list">${data.chapter_index.map(x=>`<li class="${x.number===a.number?'is-current':''}"><a href="#policy-library/article/${e(x.number)}">م${e(x.number)} — ${e(x.title)}</a>${x.status!=='in_force'?` <span class="badge is-old">${e(x.status_name)}</span>`:''}</li>`).join('')}</ul>
    </details></section>
  <section class="vn-block"><h3>النسخ</h3><ul class="vn-list">${data.versions.map(v=>`<li><strong>النسخة ${e(v.revision)}</strong><span>${e(v.status_name)}${v.effective_from?` · تسري من ${e(v.effective_from)}`:''}</span></li>`).join('')}</ul>
    ${data.versions.length>1?`<p class="subtle"><a href="#policy-library/compare/${e(a.number)}">قارن أحدث نسختين</a></p>`:''}</section>
  <section class="vn-block"><h3>تصفح</h3><div class="operation-actions">
    ${data.previous?`<a class="btn outline small" href="#policy-library/article/${e(data.previous.number)}"><span aria-hidden="true">→ </span>المادة ${e(data.previous.number)}<span class="sr-only"> (السابقة)</span></a>`:''}
    ${data.next?`<a class="btn outline small" href="#policy-library/article/${e(data.next.number)}">المادة ${e(data.next.number)}<span class="sr-only"> (التالية)</span><span aria-hidden="true"> ←</span></a>`:''}
  </div></section>
  <section class="vn-block"><h3>هذي المادة</h3>
    <p class="subtle">${a.acknowledged_at?`أقريت بقراءة هذي النسخة في <time datetime="${e(a.acknowledged_at)}">${e(String(a.acknowledged_at).slice(0,10))}</time>.`:'ما أقريت بقراءة هذي النسخة للحين.'}</p>
    <div class="operation-actions">${data.actions.map(x=>button(x,String(a.number),ACTION_LABELS[x]??x)).join('')}</div>
    <p class="subtle">رابطها: <bdi class="ltr" translate="no">${e(a.permalink)}</bdi></p>
    <p class="subtle">${e(data.no_print)}</p></section>
  </section>`;
}
const ACTION_LABELS={favourite_article:'أضف إلى المفضلة',unfavourite_article:'أزل من المفضلة',acknowledge_article:'قرأت واطلعت',
  edit_article:'تعديل المادة (نسخة جديدة)',verify_article:'تأكيد المطابقة مع الأصل الموقّع',approve_title:'اعتماد العنوان',
  acknowledge_reading:'أقر بأني قرأت واطلعت',copy_text:'نسخ النص',add_synonym:'إضافة مرادف',
  activate_synonym:'تفعيل',deactivate_synonym:'تعطيل',new_document:'رفع تعميم أو سياسة',publish_document:'نشر الوثيقة'};

function compareHtml(data,{e}){
  const line=l=>`<li class="${l.side==='added'?'is-ok':l.side==='removed'?'is-old':''}"><small>${e(l.side==='added'?'+ أُضيف':l.side==='removed'?'− حُذف':'  كما هو')}</small><span>${e(l.text)}</span></li>`;
  return `<section class="panel panel-body vn-head"><p><a href="#policy-library/article/${e(data.number)}"><span aria-hidden="true">→ </span>المادة ${e(data.number)}</a></p>
    <h2>مقارنة نسختي المادة ${e(data.number)} — ${e(data.title)}</h2>
    <p class="subtle">من النسخة ${e(data.from.revision)}${data.from.effective_from?` (تسري من ${e(data.from.effective_from)})`:''} إلى النسخة ${e(data.to.revision)}${data.to.effective_from?` (تسري من ${e(data.to.effective_from)})`:''}. ${e(data.note)}</p>
    ${data.to.note?`<p>${e(data.to.note)}</p>`:''}</section>
    <section class="vn-board"><ul class="vn-list policy-diff">${data.lines.map(line).join('')}</ul></section>`;
}

function adminHtml(data,{e,button}){
  const c=data.analytics.completeness;
  return `<section class="panel panel-body vn-head"><p><a href="#policy-library"><span aria-hidden="true">→ </span>مكتبة السياسات</a></p>
    <h2>لوحة مكتبة السياسات</h2><p class="subtle">${e(data.analytics.note)}</p></section>
  <section class="vn-board"><div class="vn-tiles">
    ${tile(e,data.analytics.searches,'عملية بحث')}
    ${tile(e,data.analytics.no_results.length,'سؤال بلا نتيجة',data.analytics.no_results.length?'is-due':'is-ok')}
    ${tile(e,c.needs_verification,'مادة تنتظر المطابقة',c.needs_verification?'is-due':'is-ok')}
    ${tile(e,c.proposed_titles,'عنوانًا مقترحًا ينتظر الاعتماد')}
  </div>
  <section class="vn-block"><h3>رفع تعميم أو سياسة جديدة</h3>
    <p class="subtle">يُلصق النص أو يُرفع، فيُصلَح بمستخرج المنصة نفسه (ترتيب الكلمات المعكوس والحروف المفصولة والأرقام)، ثم يُربط بالمواد التي يعدّلها، ثم يُنشر فيظهر «قرأت واطلعت» لكل موظف. لا طباعة ولا تصدير.</p>
    <div class="operation-actions">${button('new_document','',ACTION_LABELS.new_document)}</div>
    <ul class="vn-list">${data.documents.map(d=>`<li class="${d.status==='published'?'is-ok':'is-due'}"><strong>${e(d.title)}</strong><span>${e(d.status_name)} · ${e(d.articles)} مادة</span><small class="subtle">${e(d.source_note)}</small><div class="operation-actions">${d.status==='draft'?button('publish_document',d.id,ACTION_LABELS.publish_document):''}</div></li>`).join('')}</ul></section>
  <section class="vn-block"><h3>الأكثر بحثًا</h3>
    ${data.analytics.most_searched.length?`<ul class="vn-list">${data.analytics.most_searched.map(t=>`<li><strong><a href="#policy-library/search/${encodeURIComponent(t.term)}">${e(t.term)}</a></strong><span>${e(t.count)} مرة · آخرها ${e(String(t.last_at).slice(0,10))}</span></li>`).join('')}</ul>`:'<p class="subtle">لا بحث مسجل.</p>'}</section>
  <section class="vn-block"><h3>أسئلة بلا نتيجة</h3>
    ${data.analytics.no_results.length?`<ul class="vn-list">${data.analytics.no_results.map(t=>`<li class="is-due"><strong>${e(t.query)}</strong><span>${e(t.count)} مرة</span><small class="subtle">أضف مرادفًا أو راجع نص المادة.</small></li>`).join('')}</ul>`:'<p class="subtle">كل سؤال وجد نصًا.</p>'}</section>
  <section class="vn-block"><h3>الأكثر زيارة</h3>
    ${data.analytics.most_visited.length?`<ul class="vn-list">${data.analytics.most_visited.map(t=>`<li><strong><a href="#policy-library/article/${e(t.number)}">المادة ${e(t.number)} — ${e(t.title)}</a></strong><span>${e(t.chapter)} · ${e(t.n)} زيارة</span></li>`).join('')}</ul>`:'<p class="subtle">لا زيارات مسجلة.</p>'}</section>
  <section class="vn-block"><h3>قاموس المرادفات</h3>
    <p class="subtle">${e(data.synonyms.note)}</p>
    <div class="operation-actions">${data.synonyms.actions.map(a=>button(a,'',ACTION_LABELS[a]??a)).join('')}</div>
    <ul class="vn-list">${data.synonyms.groups.map(g=>`<li><strong>${e(g.head)}</strong><span>${g.terms.map(t=>`${e(t.term)}${t.active?'':' (معطّل)'}`).join(' · ')}</span><div class="operation-actions">${g.terms.map(t=>button(t.active?'deactivate_synonym':'activate_synonym',t.id,`${t.active?'تعطيل':'تفعيل'} «${t.term}»`)).join('')}</div></li>`).join('')}</ul></section>
  <section class="vn-block"><h3>الأساس النظامي في النماذج والرفض الآلي</h3>
    <p class="subtle">${e(data.basis.note)}</p>
    <ul class="vn-list">${[...data.basis.forms,...data.basis.refusals].map(b=>`<li><strong>${e(b.label)}</strong><span>${b.kind==='form'?'نموذج':'رفض آلي'} · <a href="${e(b.link)}">المادة ${e(b.article_number)} — ${e(b.article_title)}</a>${b.superseded_number?` (بدل المادة ${e(b.superseded_number)} المستبدلة)`:''}</span><small class="subtle">المفتاح: <span class="ltr">${e(b.key)}</span> · ${e(b.source_note)}</small></li>`).join('')}</ul></section>
  </section>`;
}

// ── الوحدة ─────────────────────────────────────────────────────────────────────
export const policyLibraryUI={
  title:'مكتبة السياسات',
  description:'نص لائحة تنظيم العمل المعتمدة كاملًا، وكل مادة توصلها بثواني: برقمها أو بكلمة منها أو بسؤال عادي. المواد المعدّلة والمستبدلة عليها شاراتها. كل شي إلكتروني: لا طباعة ولا PDF.',
  load(api){
    const [,view,ref]=path();
    if(view==='article'&&ref)return api(`/policy-library/articles/${encodeURIComponent(ref)}`);
    if(view==='compare'&&ref)return api(`/policy-library/articles/${encodeURIComponent(ref)}/compare`);
    if(view==='admin')return api('/policy-library/admin');
    if(view==='search')return api('/policy-library').then(home=>({...home,_search:queryFromHash()}));
    return api('/policy-library');
  },
  render(data,context){
    const view=mode();
    if(view==='article')return articleViewHtml(data,context);
    if(view==='compare')return compareHtml(data,context);
    if(view==='admin')return adminHtml(data,context);
    return homeView(data,context);
  },
  form(action,id,data){
    if(action==='acknowledge_reading'){
      guard(!!data.acknowledgement&&data.acknowledgement.actions.includes(action));
      return {title:'قرأت واطلعت على اللائحة',endpoint:`/policy-library/documents/${data.acknowledgement.document_id}/acknowledge`,submit:'أقر',
        hint:data.acknowledgement.note,
        fields:[{name:'confirm',label:'أقر بأني قرأت نص اللائحة واطلعت عليه',type:'checkbox'}],
        toPayload:v=>({confirm:v.confirm===true||v.confirm==='on'})};
    }
    if(action==='acknowledge_article'){
      const a=data.article;guard(!!a&&data.actions.includes(action));
      return {title:`قرأت واطلعت — المادة ${a.number}`,endpoint:`/policy-library/articles/${a.number}/acknowledge_article`,submit:'أقر',
        hint:`النسخة ${a.revision}. الإقرار مرتبط بهذه النسخة بالذات؛ نسخة جديدة تحتاج إقرارًا جديدًا.`,
        fields:[{name:'confirm',label:'أقر بأني قرأت نص هذه المادة',type:'checkbox'}],
        toPayload:v=>({confirm:v.confirm===true||v.confirm==='on',revision:a.revision})};
    }
    if(action==='favourite_article'||action==='unfavourite_article'){
      const a=data.article;guard(!!a&&data.actions.includes(action));
      return {title:ACTION_LABELS[action],endpoint:`/policy-library/articles/${a.number}/${action}`,submit:'تنفيذ',
        hint:'المفضلة لك وحدك ولا يراها غيرك.',fields:[],toPayload:()=>({})};
    }
    if(action==='edit_article'){
      const a=data.article;guard(!!a&&data.actions.includes(action));
      return {title:`تعديل المادة ${a.number}`,endpoint:`/policy-library/articles/${a.number}/edit_article`,submit:'حفظ نسخة جديدة',
        hint:'كل تعديل نسخة جديدة لها تاريخ سريان. النسخة السابقة تبقى كما هي وتُقارَن بها.',
        fields:[{name:'title',label:'عنوان المادة',type:'text',value:a.title,maxLength:300},
          {name:'body',label:'نص المادة (كل فقرة في سطر، والبند يبدأ برقمه)',type:'textarea',value:a.body,maxLength:20000,minLength:2},
          {name:'status',label:'الحالة',type:'select',value:a.status,options:[{value:'in_force',label:'سارية'},{value:'amended',label:'معدّلة'},{value:'replaced',label:'استُبدلت'},{value:'repealed',label:'ملغاة'}]},
          {name:'effective_from',label:'تاريخ سريان هذه النسخة',type:'date',value:a.effective_from??data.today},
          {name:'note',label:'سبب التعديل وسنده',type:'textarea',minLength:10,maxLength:2000}],
        toPayload:v=>({version:a.version,title:v.title,body:v.body,status:v.status,effective_from:v.effective_from,note:v.note})};
    }
    if(action==='verify_article'){
      const a=data.article;guard(!!a&&data.actions.includes(action));
      return {title:`تأكيد مطابقة المادة ${a.number}`,endpoint:`/policy-library/articles/${a.number}/verify_article`,submit:'أؤكد المطابقة',
        hint:'بعد التأكيد تختفي شارة «مستخرج — يحتاج مطابقة مع الأصل الموقّع» عن هذه المادة وحدها.',
        fields:[{name:'note',label:'إقرارك بمطابقة النص مع الأصل الموقّع وما راجعته',type:'textarea',minLength:10,maxLength:2000}],
        toPayload:v=>({version:a.version,note:v.note})};
    }
    if(action==='approve_title'){
      const a=data.article;guard(!!a&&data.actions.includes(action));
      return {title:`اعتماد عنوان المادة ${a.number}`,endpoint:`/policy-library/articles/${a.number}/approve_title`,submit:'اعتماد',
        hint:'العنوان الحالي اقتراح من النظام مشتق من أول النص. اكتب العنوان الذي يدل على موضوع المادة.',
        fields:[{name:'title',label:'عنوان المادة',type:'text',value:a.title,maxLength:300}],
        toPayload:v=>({version:a.version,title:v.title})};
    }
    if(action==='add_synonym'){
      guard(data.synonyms?.actions?.includes(action));
      return {title:'إضافة مرادف',endpoint:'/policy-library/synonyms',submit:'إضافة',
        hint:'المرادف يوسّع البحث ولا يغيّر نص أي مادة.',
        fields:[{name:'head',label:'الكلمة كما في اللائحة',type:'text',maxLength:80},
          {name:'term',label:'الكلمة كما يكتبها الموظف',type:'text',maxLength:80}],
        toPayload:v=>({head:v.head,term:v.term})};
    }
    if(action==='activate_synonym'||action==='deactivate_synonym'){
      guard(!!data.synonyms);
      return {title:ACTION_LABELS[action],endpoint:`/policy-library/synonyms/${id}/${action}`,submit:'تنفيذ',
        fields:[{name:'note',label:'السبب',type:'text',required:false,maxLength:600}],
        toPayload:v=>(v.note?{note:v.note}:{})};
    }
    if(action==='new_document'){
      guard(!!data.analytics);
      return {title:'رفع تعميم أو سياسة',endpoint:'/policy-library/documents',submit:'حفظ مسودة',
        hint:'الصق النص كما خرج من الملف؛ يصلحه مستخرج المنصة ويعرض لك ما تعذّر إصلاحه.',
        fields:[{name:'code',label:'رمز الوثيقة (لاتيني صغير)',type:'text',maxLength:60},
          {name:'title',label:'عنوان الوثيقة',type:'text',maxLength:300},
          {name:'reference_no',label:'الرقم المرجعي',type:'text',required:false,maxLength:60},
          {name:'approved_on',label:'تاريخ الاعتماد',type:'date',required:false},
          {name:'effective_from',label:'تاريخ السريان',type:'date',required:false},
          {name:'amends',label:'أرقام المواد التي تعدّلها (مفصولة بفاصلة)',type:'text',required:false,maxLength:200},
          {name:'text',label:'نص الوثيقة',type:'textarea',minLength:20,maxLength:400000},
          {name:'note',label:'مصدر النص وكيف وصل',type:'textarea',minLength:10,maxLength:2000}],
        toPayload:v=>({code:v.code,title:v.title,reference_no:v.reference_no||undefined,approved_on:v.approved_on||undefined,
          effective_from:v.effective_from||undefined,text:v.text,note:v.note,
          amends:String(v.amends??'').split(/[^\d]+/).filter(Boolean).map(Number)})};
    }
    if(action==='publish_document'){
      const d=data.documents?.find(x=>x.id===id);guard(!!d);
      return {title:`نشر ${d.title}`,endpoint:`/policy-library/documents/${id}/publish`,submit:'نشر',
        hint:'بعد النشر يظهر «قرأت واطلعت» على هذه النسخة لكل موظف داخل المنصة. لا بريد ولا رسائل تُرسل.',
        fields:[{name:'effective_from',label:'تاريخ السريان',type:'date',value:data.today},
          {name:'note',label:'ما الذي يتغير بنشر هذه الوثيقة',type:'textarea',minLength:10,maxLength:2000}],
        toPayload:v=>({version:d.version??1,effective_from:v.effective_from,note:v.note})};
    }
    guard(false);
  }
};
