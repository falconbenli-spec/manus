// بوابة الموظف: كل ما يخص الشخص في صفحة واحدة، ومعه كل خدمات الدليل التي يسمح بها الخادم لهذا الحساب.
// لا تمنح الواجهة وصولًا؛ الأزرار تأتي من catalog(db,user) وتفتح منشئ الطلب الموحد نفسه.
// م0 «السور»: عبارات الحالات من القاموس الواحد، لا من نسخة هنا.
import { icon, chevron, LEAVE_ICONS } from './icons.mjs';
import { REQUEST_STATUS_AR as statusNames } from './vocabulary.mjs';
import { ROLE_NAMES_AR as roleNames } from './vocabulary.mjs';

export function portalPage(data,{e,date}){
  const {me}=data;
  const portalGlyph={person:'person',clock:'clock',calendar:'calendar',document:'doc',heart:'heart',wallet:'banknote',shield:'shield',list:'checklist'};
  const leaveGlyph=LEAVE_ICONS;
  const requestGlyph={calendar:'calendar',clock:'clock',plus:'plus',plane:'plane',doc:'doc',banknote:'banknote',person:'person',book:'book',heart:'heart',message:'bubble',shield:'shield',star:'star'};
  const leaveClass=code=>/^[a-z_]+$/.test(code??'')?` lv-type-${code}`:'';
  const count=key=>data.counts[key]??0;
  const openCount=count('draft')+count('pending')+count('returned')+count('approved')+count('in_progress');
  const tile=(value,label,href,tone='')=>`<a class="pt-tile ${tone}" href="${e(href)}"><strong>${value}</strong><span>${e(label)}</span></a>`;
  const rows=(items,empty,render)=>items.length?items.map(render).join(''):`<p class="pt-empty">${e(empty)}</p>`;
  const requestRow=r=>`<a class="pt-row" href="#request/${e(r.id)}"><span class="pt-row-main"><strong>${e(r.title)}</strong><small>${e(r.service_name)}</small></span><span class="badge ${e(r.status)}">${e(statusNames[r.status]||r.status)}</span></a>`;
  const taskRow=t=>`<a class="pt-row ${t.overdue?'is-late':''}" href="#request/${e(t.request_id)}"><span class="pt-row-main"><strong>${e(t.title)}</strong><small>${e(t.request_title)}</small></span><span class="pt-due">${e(date(t.due_date))}${t.overdue?' · متأخرة':''}</span></a>`;
  const projectRow=t=>`<a class="pt-row" href="#projects"><span class="pt-row-main"><strong>${e(t.title)}</strong><small>${e(t.project_name)}</small></span><span class="pt-due">${e(date(t.due_date))}</span></a>`;
  const quick=data.quick_services.map(s=>`<button type="button" class="pt-quick" data-action="new-request" data-id="${e(s.id)}"><strong>${e(s.name)}</strong><small>${e(s.section)}</small></button>`).join('');
  const mine=data.department_services.slice(0,8).map(s=>`<button type="button" class="pt-chip" data-action="new-request" data-id="${e(s.id)}">${e(s.name)}</button>`).join('');
  const grouped=[...new Map((data.all_services??[]).map(service=>[service.department_id,{
    id:service.department_id,name:service.department_name,services:(data.all_services??[]).filter(item=>item.department_id===service.department_id)
  }])).values()].sort((a,b)=>a.id==='hr'?-1:b.id==='hr'?1:a.name.localeCompare(b.name,'ar'));
  const serviceGroups=grouped.map(group=>`<details class="panel portal-service-group" data-portal-group ${group.id==='hr'?'open':''}>
    <summary class="panel-head"><h3>${e(group.id==='hr'?'طلبات الموارد البشرية':group.name)}</h3><span class="badge">${e(group.services.length)} خدمة</span></summary>
    <div class="panel-body pt-quicks">${group.services.map(service=>`<button type="button" class="pt-quick" data-action="new-request" data-id="${e(service.id)}" data-portal-service="${e(`${service.name} ${service.code} ${service.section} ${group.name}`)}"><strong>${e(service.name)}</strong><small>${e(service.section)}</small></button>`).join('')}</div>
  </details>`).join('');
  const portalDock=(data.employee_portal??[]).map(item=>`<a class="employee-portal-item" href="${e(item.href)}"><span aria-hidden="true">${icon(portalGlyph[item.icon]??'grid')}</span><div><strong>${e(item.label)}</strong><small>${e(item.description)}</small></div></a>`).join('');
  const requestCards=(data.employee_requests??[]).map(request=>{
    const choices=(request.choices??[]).length?`<div class="employee-request-choices" aria-label="أمثلة الخيارات">${request.choices.map(choice=>`<span>${e(choice)}</span>`).join('')}</div>`:'';
    const content=`<span class="employee-request-icon" aria-hidden="true">${icon(requestGlyph[request.icon]??'grid')}</span><span class="employee-request-copy"><strong>${e(request.label)}</strong><small>${e(request.description)}</small>${choices}</span><b aria-hidden="true">${chevron}</b>`;
    return request.service_id
      ?`<button type="button" class="employee-request-card" data-action="new-request" data-id="${e(request.service_id)}" data-employee-request="${e(request.key)}">${content}</button>`
      :`<a class="employee-request-card" href="${e(request.href)}" data-employee-request="${e(request.key)}">${content}</a>`;
  }).join('');
  const leaveCards=(data.leave??[]).map(balance=>`<article class="leave-balance-card${leaveClass(balance.type_code)}"><span class="leave-type-icon" aria-hidden="true">${icon(leaveGlyph[balance.icon]??leaveGlyph.calendar)}</span><div><strong>${e(balance.type)}</strong><small>${balance.type_code==='compensatory'?`من ساعات إضافية معتمدة${balance.next_expiry?` · أقرب انتهاء ${e(balance.next_expiry)}`:''}`:`سنة ${e(balance.year??'—')}${balance.reserved?` · محجوز ${e(balance.reserved)}`:''}`}</small></div><b>${balance.available_hours?`${e(balance.available_hours)} ساعة`:balance.remaining===null||balance.remaining===undefined?'حسب الحالة':`${e(balance.remaining)} ${e(balance.unit_name??'يوم')}`}</b>${balance.source_link?`<a class="btn outline small" href="${e(balance.source_link)}">رفع ساعات إضافية</a>`:`<a class="btn outline small" href="#leave/new?kind=${encodeURIComponent(balance.type_code)}">طلب</a>`}</article>`).join('');
  return `<section class="journey-hero">
      <div class="journey-copy"><div class="journey-greeting">هلا ${e(me.name)} · ${e(me.department?.name||roleNames[me.role]||'مساحتك')}</div>
      <h1>وش ننجز اليوم؟</h1><p>طلباتك وحضورك وإجازاتك وخطاباتك في مكان واحد، ومن دون ما تدور بين أكثر من نظام.</p>
      <div class="journey-cta"><button class="btn primary" data-action="new-request">ارفع طلب <span aria-hidden="true">＋</span></button><button class="btn outline" data-journey-action="tour">عرّفني على البوابة</button></div></div>

    </section>
    <nav class="employee-portal-dock" aria-label="أقسام بوابة الموظف">${portalDock}</nav>
    <section class="portal-assistant" aria-labelledby="portal-turki-title">
      <div class="portal-assistant-mark" aria-hidden="true">${icon('sparkles')}</div>
      <div class="portal-assistant-copy"><p>مساعدك داخل المنصة</p><h2 id="portal-turki-title">اسأل تركي</h2><strong>راتبك ورصيد إجازاتك والسياسة أو الطلب المناسب—اسأله بطريقتك.</strong>
        <small>يستخدم نصوص المنصة وبياناتك أنت بس. ما يطلع على راتب أو رصيد أي موظف ثاني، وما يخمّن جوابًا من خارج المصادر المعتمدة.</small>
        <div class="portal-assistant-prompts" aria-label="أمثلة أسئلة"><span>كم رصيد إجازتي؟</span><span>كيف أطلع تعريف راتب؟</span><span>وش سياسة العمل الإضافي؟</span></div>
      </div>
      <a class="btn primary portal-assistant-action" href="#policy-assistant/ask">اسأل تركي <span aria-hidden="true">↖</span></a>
    </section>
    <section class="panel employee-requests" aria-labelledby="employee-requests-title">
      <div class="panel-head"><div><p class="eyebrow">خدمات الموظف</p><h2 id="employee-requests-title">طلباتك بدون لف ودوران</h2><p>اختر نوع الطلب، راجع خياراته، وارفعه من نفس المكان. الطلب باسمك ومساره واضح قبل الإرسال.</p></div><a class="btn outline small" href="#my-requests">تابع طلباتك</a></div>
      <div class="panel-body employee-request-grid">${requestCards||'<p class="pt-empty">ما فيه طلب متاح لحسابك الحين.</p>'}</div>
    </section>
    ${leaveCards?`<section class="panel employee-leave-summary" aria-labelledby="portal-leave-title"><div class="panel-head"><div><h2 id="portal-leave-title">إجازاتي وأرصدتي</h2><p>نفس الأنواع والترتيب المألوف في HCM، مع الأحكام ومسار الاعتماد من المنصة.</p></div><a class="btn outline small" href="#leave">كل تفاصيل الإجازات</a></div><div class="panel-body leave-balance-grid">${leaveCards}</div></section>`:''}
    <div class="journey-heading"><h2>اختر خطوتك الجاية</h2><p>شغلك، وخدماتك، ومتابعتك.</p></div>
    <nav class="journey-path" aria-label="رحلتك داخل المنصة"><a class="journey-stop" href="#work"><span>01</span><div><strong>العمل اليومي</strong><small>مهامك وما ينتظر قرارك</small></div><b aria-hidden="true">${chevron}</b></a><a class="journey-stop" href="#catalog"><span>02</span><div><strong>الإدارات والخدمات</strong><small>${e(data.catalog_size)} خدمة في مساحات الإدارات${data.catalog_hidden?`، و${e(data.catalog_hidden)} موقوفة من الإعدادات`:''}</small></div><b aria-hidden="true">${chevron}</b></a><a class="journey-stop" href="#requests"><span>03</span><div><strong>متابعة الطلبات</strong><small>من التقديم إلى الإنجاز</small></div><b aria-hidden="true">${chevron}</b></a></nav>
    <div class="journey-heading"><h2>ملخص اليوم</h2><p>من طلباتك ومهامك الحالية</p></div>
    <div class="pt-tiles">
      ${tile(openCount,'طلب مفتوح لك','#requests')}
      ${tile(data.decisions.length,'قرار ينتظرك','#requests',data.decisions.length?'is-due':'')}
      ${tile(data.tasks.length+data.project_tasks.length,'مهمة مسندة لك','#work',data.tasks.some(t=>t.overdue)?'is-late':'')}
      ${tile(data.unread,'إشعار غير مقروء','#notifications')}
    </div>
    <div class="pt-grid">
      <section class="panel">
        <div class="panel-head"><h2>خدماتي الأكثر استخدامًا</h2><a class="btn outline small" href="#departments">كل الخدمات (${data.catalog_size})</a></div>
        <div class="panel-body"><div class="pt-quicks">${quick||'<p class="pt-empty">ما فيه خدمة متاحة.</p>'}</div>
        ${mine?`<p class="pt-label">خدمات إدارتي</p><div class="pt-chips">${mine}</div>`:''}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>ينتظر قرارك</h2></div>
        <div class="panel-body pt-rows">${rows(data.decisions,'ما فيه طلب ينتظر قرارك الحين.',requestRow)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>طلباتي المفتوحة</h2><a class="btn outline small" href="#requests">كل طلباتي</a></div>
        <div class="panel-body pt-rows">${rows(data.open,'ما فيه طلبات مفتوحة. ابدأ من «طلب جديد».',requestRow)}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>مهامي</h2></div>
        <div class="panel-body pt-rows">${rows([...data.tasks.map(t=>({...t,kind:'request'})),...data.project_tasks.map(t=>({...t,kind:'project'}))],'ما فيه مهام مسندة لك.',t=>t.kind==='request'?taskRow(t):projectRow(t))}</div>
      </section>
      ${/* لوحة «مخالفاتي وجزاءاتي» (ترحيل 097) انتقلت إلى الرئيسية (home-ui.mjs) بعد دمج «ملخصي» فيها: هذه الصفحة لم تعد تُستورد،
           فكانت اللوحة هنا ميتة. تظهر الآن في الرئيسية لمن عليه قضية أو جزاء، ومدخل القائمة «مخالفاتي وجزاءاتي» كما هو. */''}
    </div>
    <section class="panel mt" aria-labelledby="portal-services-title">
      <div class="panel-head"><div><h2 id="portal-services-title">كل خدماتك المسموحة</h2><p>الخدمات من الدليل الفعلي حسب صلاحيات حسابك. اختر أي خدمة لفتح نموذج الطلب الموحد ومسار اعتمادها.</p></div><a class="btn outline small" href="#services">فتح مركز الخدمات</a></div>
      <div class="panel-body"><label><span>ابحث باسم الخدمة أو الإدارة</span><input id="portal-service-search" type="search" autocomplete="off" placeholder="مثال: إجازة، خطاب، جهاز، فاتورة"></label><p id="portal-service-search-status" class="subtle" role="status">${e(data.all_services?.length??0)} خدمة متاحة</p></div>
    </section>
    <div class="portal-service-groups">${serviceGroups||'<p class="pt-empty">ما فيه خدمة متاحة لحسابك.</p>'}</div>`;
}
