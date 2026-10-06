// مهامي (#work): لوح واحد لكل ما عليك — ما ينتظر قرارك، وما ينتظر ردّك، وما عليك تنفيذه، وطلباتك المفتوحة — ثم مهامك الخاصة.
// السلال من «ما عليّ» (app/obligations.mjs) نفسها التي تقرؤها الرئيسية و«بانتظار إجرائي» وشارة القائمة: العدد هنا هو العدد هناك،
// ورقم كل لوح طولُ القائمة التي تحته. والأسماء الأربعة هي أسماء بلاطات الرئيسية نفسها، فالقائمة الواحدة تُسمّى باسم واحد.
// يرسمه app.mjs خارج operationModules بسياق {e,date}، فالعدّة تُبنى هنا من kit نفسها لا من نسخة محلية.
import { kit } from './kit.mjs';
import { REQUESTER_STAGES } from './vocabulary.mjs';

const NEEDS_YOU=REQUESTER_STAGES.needs_you[0];
const lists=[['today','اليوم'],['week','هالأسبوع'],['later','بعدين']];
const ISO_DAY=/^\d{4}-\d{2}-\d{2}/;
const workDays=n=>n===1?'يوم عمل':n===2?'يومين عمل':`${n} ${n>=3&&n<=10?'أيام':'يوم'} عمل`;
export function workBoard(data,{e,date}){
  const targetName={department:'إدارة',project:'مشروع',initiative:'مبادرة'};
  const collaboration=()=>{
    const spaces=data.spaces??[],suggestions=data.space_suggestions??[];
    if(!spaces.length&&!suggestions.length)return '';
    const live=spaces.map(space=>`<a class="wp-space-card" href="#workspace/${e(space.id)}/tasks"><span class="wp-space-kind">${e(targetName[space.target_kind]??'مساحة')}</span><h3>${e(space.name)}</h3><p>${space.open_tasks} مهمة مفتوحة · ${space.files} ملف · ${space.topics} تحديث</p><strong>فتح مساحة الفريق ←</strong></a>`).join('');
    const ready=suggestions.map(item=>`<form class="wp-space-card is-suggestion" data-workspace-form="space-ensure"><input type="hidden" name="kind" value="${e(item.kind)}"><input type="hidden" name="id" value="${e(item.id)}"><span class="wp-space-kind">${e(targetName[item.kind]??'مساحة')}</span><h3>${e(item.name)}</h3><p>أنشئ مساحة مشتركة تضم المهام والملفات والرسائل والجدول.</p><button class="btn outline small" type="submit">تهيئة المساحة</button></form>`).join('');
    return `<section class="wp-launch"><div class="wp-launch-head"><div><p>عمل الفريق</p><h2>مساحات العمل</h2></div><span>${spaces.length} نشطة</span></div><div class="wp-space-grid">${live}${ready}</div></section>`;
  };
  const ui=kit(e);
  // بطاقة البند: رابط واحد إلى سجله (لا إلى شاشته)، وعنوانه، وسياقه، وسطر حاله. ليست vn-card العدّة: هي كتلة اللوح (wk-card) بأنماطها.
  // السياق وسطر الحال ترميزٌ جاهز من صاحبه (مهرَّب، والتاريخ فيه <time>).
  const card=(title,context,meta,href,tone='')=>`${href?`<a class="wk-card ${tone}" href="${e(href)}">`:`<div class="wk-card ${tone}">`}<strong>${e(title)}</strong>${context?`<small>${context}</small>`:''}${meta?`<span class="wk-meta">${meta}</span>`:''}${href?'</a>':'</div>'}`;
  const stamp=(iso,text)=>ISO_DAY.test(String(iso??''))?`<time datetime="${e(String(iso).slice(0,10))}">${e(text)}</time>`:e(text);
  // جزء السياق تاريخًا (يوم العطلة، يوم المهمة) يُكتب <time>، وغيره نصٌّ مهرَّب.
  const contextOf=parts=>parts.filter(Boolean).map(part=>/^\d{4}-\d{2}-\d{2}$/.test(part)?stamp(part,part):e(part)).join(' · ');
  // موعد البند من مصدره: زمن خدمته أو موعد سجله أو مهمته؛ وما لا موعد له يُقال عمره بأيام العمل منذ وصلك.
  const age=i=>i.age_days===null||i.age_days===undefined?'':stamp(i.since,i.age_days===0?'وصلك اليوم':`وصلك من ${workDays(i.age_days)}`);
  const when=i=>i.optional?'اختياري':[i.due_on&&i.due_basis!=='working_days_waiting'?`موعده ${stamp(i.due_on,date(i.due_on))}`:age(i),i.overdue?'متأخر':''].filter(Boolean).join(' · ');
  // العلامة شكلٌ وكلمة: ما ينتظر قرارك أو ردّك «دورك» (is-decision، وكلمته عنوان اللوح)، والمتأخر «متأخر»، والاختياري خامل.
  const entry=i=>card(i.title,contextOf([i.kind,i.context]),
    [e((i.actions??[]).join('، ')),when(i),i.shared?'أول من يباشره ياخذه':''].filter(Boolean).join(' · '),i.link,
    i.overdue?'is-late':i.optional?'is-old':['decide','respond'].includes(i.bucket)?'is-decision':'');
  const panel=(title,items,none,extra='')=>`<section class="panel"><div class="panel-head"><h2>${e(title)}</h2><span class="badge">${items.length}</span></div><div class="panel-body wk-stack">${items.map(entry).join('')||`<p class="wk-empty">${e(none)}</p>`}${extra}</div></section>`;
  const column=(key,label)=>{
    const items=data.personal.filter(t=>t.list===key&&t.status==='open');
    return `<section class="wk-column" data-list="${e(key)}">
      <header><h3>${e(label)}</h3><span>${items.length}</span></header>
      <div class="wk-stack">${items.map(t=>`<article class="wk-card is-personal ${t.overdue?'is-late':''}">
        <label class="wk-check"><input type="checkbox" data-action="finish-task" data-id="${e(t.id)}"><span>${e(t.title)}</span></label>
        ${t.notes?`<small>${e(t.notes)}</small>`:''}
        <span class="wk-meta">${t.due_date?`موعدها ${stamp(t.due_date,date(t.due_date))}`:'بلا موعد'}${t.overdue?' · متأخرة':''}<button class="wk-x" type="button" data-action="drop-task" data-id="${e(t.id)}" aria-label="${e(`حذف المهمة: ${t.title}`)}">✕</button></span>
      </article>`).join('')||'<p class="wk-empty">ما فيه شي هنا — أضف مهمة من تحت.</p>'}</div>
      <form id="work-task-form" class="wk-add" data-list="${e(key)}"><input name="title" placeholder="مهمة جديدة…" maxlength="180" required aria-label="${e(`مهمة جديدة في «${label}»`)}"><button class="btn outline small" type="submit">إضافة</button></form>
    </section>`;
  };
  const done=data.personal.filter(t=>t.status==='done');
  // «عليك تنفيذه» بلا المهام الخاصة في اللوح العلوي: الخاصة لها أعمدتها أدناه بأزرارها، والعدد على رأس اللوح يشملها ليطابق بلاطة الرئيسية.
  const assigned=data.doing.filter(i=>i.source!=='work'),personalOpen=data.doing.length-assigned.length;
  const optional=data.optional?.length?`<details class="wk-done"><summary>اختياري — ما يتأخر ولا ينعدّ عليك (${data.optional.length})</summary>${data.optional.map(entry).join('')}</details>`:'';
  // طلباتك المفتوحة: الشارة حالته من القاموس الواحد، و«ينتظر ردك» حين يكون عندك (مسودة أو معاد) — وهو دورك عليه.
  const mine=data.mine.map(r=>card(r.title,contextOf([r.kind,r.module_status]),
    [ui.statusBadge(r.status),r.needs_you?e(NEEDS_YOU):'',r.due_on?`موعده ${stamp(r.due_on,date(r.due_on))}`:'',r.overdue?'متأخر':''].filter(Boolean).join(' · '),
    r.link,r.overdue?'is-late':r.needs_you?'is-decision':'')).join('');
  // ما أعدتُه وينتظر صاحبه (الموجة 2): متابعة لا التزام — لا يدخل عدّ «ينتظر قرارك» ولا «ينتظر ردك». يظهر حين يوجد فقط.
  const back=r=>r.age_days===null||r.age_days===undefined?'':stamp(r.returned_at,r.age_days===0?'رجّعته اليوم':`رجّعته من ${workDays(r.age_days)}`);
  const returned=data.returned_by_me?.length?`<section class="panel wk-wide"><div class="panel-head"><h2>أعدتُها وتنتظر صاحبها</h2><span class="badge">${data.returned_by_me.length}</span></div><div class="panel-body wk-stack">${data.returned_by_me.map(r=>card(r.title,contextOf([r.service_name,r.requester_name]),[back(r),e(r.lapse_note)].filter(Boolean).join(' · '),r.link)).join('')}<p class="subtle">للمتابعة بس: الرد عند صاحب الطلب، وما تنحسب عليك.</p></div></section>`:'';
  // «طلب جديد» بقاعدة app.mjs نفسها (newButton): حساب إدارة المنصة ما يقدّم طلبات، فلا يُرسم له زرٌّ تنتهي نقرته برفض.
  const newRequest=globalThis.navMe?.role==='admin'?'':'<button class="btn primary" data-action="new-request"><span aria-hidden="true">＋</span>طلب جديد</button>';
  return ui.pageHead('مهامي','اللي ينتظر قرارك وردّك، واللي عليك تنفيذه، وطلباتك المفتوحة، ومهامك الخاصة — في لوح واحد، وكل بند يفتح سجله.',newRequest)+`
    <div class="wk-top">
      ${panel('ينتظر قرارك',data.decisions,'ما ينتظرك قرار الحين — أول ما يوصلك شي يطلع هنا.')}
      ${panel(NEEDS_YOU,data.respond,'ما رجع لك شي، ولا أحد ينتظر ردّك.',optional)}
      <section class="panel"><div class="panel-head"><h2>عليك تنفيذه</h2><span class="badge">${data.doing.length}</span></div><div class="panel-body wk-stack">${assigned.map(entry).join('')||(personalOpen?'':'<p class="wk-empty">ما عليك مهمة مسندة ولا طلب تباشره.</p>')}${personalOpen?`<p class="subtle">${assigned.length?`ومعها ${personalOpen} من مهامك الخاصة`:`كلها من مهامك الخاصة (${personalOpen})`} في الأعمدة تحت.</p>`:''}</div></section>
      <section class="panel wk-wide"><div class="panel-head"><h2>طلباتك المفتوحة</h2><span class="badge">${data.mine.length}</span></div><div class="panel-body wk-stack">${mine||'<p class="wk-empty">ما عندك طلب مفتوح — تبدأ واحد من «طلب جديد».</p>'}</div></section>${returned}
    </div>
    ${data.unavailable?.length?'<p class="notice" role="status">بعض البيانات غير متاحة الآن. حدّث الصفحة أو جرّب لاحقًا.</p>':''}
    <h2 class="wk-title">مهامي الخاصة</h2>
    <div class="wk-board">${lists.map(([key,label])=>column(key,label)).join('')}</div>
    ${done.length?`<details class="wk-done"><summary>خلّصتها هالأسبوع (${done.length})</summary>${done.map(t=>`<p>${e(t.title)}</p>`).join('')}</details>`:''}`;
}
