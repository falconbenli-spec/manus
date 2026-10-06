// الهيكل التنظيمي كما هو مطبق في المنصة: من يعتمد، ومن يصعد إليه، وكم خدمة يملك.
export function orgPage(data,{e}){
  const titles={ceo:'الرئيس التنفيذي','vp-growth':'نائب الرئيس للنمو والقنوات','vp-corporate':'نائب الرئيس للخدمات المؤسسية'};
  // «حساب تجريبي» يُقال حين يكون الحساب تجريبيًا فعلًا (وسم الاسم نفسه)، لا تحت كل اسم مهما كان.
  const synthetic=name=>/\(تجريبي\)/.test(name);
  const executive=data.executives.map(person=>`<article class="org-exec"><span class="org-exec-role">${e(titles[person.id]||person.name)}</span><strong>${e(person.user.name.replace(' (تجريبي)',''))}</strong>${synthetic(person.user.name)?'<small>حساب تجريبي</small>':''}</article>`).join('');
  const unit=u=>`<article class="org-unit${u.is_mine?' is-mine':''}">
      <header><h3>${e(u.name)}</h3>${u.is_mine?'<span class="badge">إدارتي</span>':''}</header>
      <dl>
        <div><dt>المعتمد</dt><dd>${u.approver?e(u.approver.name):'<span class="is-late-text">ما تعيّن</span>'}</dd></div>
        <div><dt>يصعد إلى</dt><dd>${u.escalation?e(u.escalation.name):'—'}</dd></div>
      </dl>
      <footer><span>${u.people} موظفًا</span><span>${u.services} خدمة</span>${u.managers>1?`<span class="is-warn-text">${u.managers} مديرين</span>`:''}</footer>
    </article>`;
  return `<div class="page-head"><div><h1>الهيكل التنظيمي</h1><p>مثل ما هو مطبّق في المنصة الحين: المعتمد لكل إدارة، ومرجع تصعيدها، وحجم خدماتها.</p></div><a class="btn outline" href="#departments">الإدارات وخدماتها ←</a></div>
    <section class="org-top">${executive}</section>
    ${data.sectors.map(sector=>`<section class="org-sector"><h2>${e(sector.name)}<small>${sector.units.length} إدارات</small></h2><div class="org-grid">${sector.units.map(unit).join('')}</div></section>`).join('')}
    ${data.unplaced.length?`<section class="org-sector"><h2>بلا قطاع محدد</h2><div class="org-grid">${data.unplaced.map(unit).join('')}</div></section>`:''}
    <p class="subtle mt">${e(data.source)}</p>`;
}
