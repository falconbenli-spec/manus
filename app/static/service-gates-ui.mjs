// شروط أهلية الخدمات (ترحيل 138) — قسم داخل شاشة «إعداد الاعتماد»، بجوار لوح تفعيل الخدمات وإخفائها.
//
// لماذا هنا لا في صفحة جديدة: السؤالان بابٌ واحد على الموظف — «هل هذه الخدمة مفتوحة أصلًا» (129)
// و«ومن ينطبق عليه شرطها» (138) — ومالكهما واحد يقرؤهما في جلسة واحدة. صفحةٌ ثانية تعني لوحين
// يفترقان، وهو العطب نفسه الذي بُنيت عدّادات هذه الشاشة لمنعه.
//
// وأهم ما في هذا القسم ليس جدول المشروطات — هو عبارة «مفتوحة عن قصد». الخانة الفارغة تُقرأ سهوًا،
// والسبب المكتوب يُقرأ قرارًا. فالأسباب تُطبع بنصّها من الخادم (OPEN_REASONS)، ولا تُصاغ هنا ثانيةً.
// المكوّنات كلها من العدّة (ui.card وui.table): لا نسخة محلية منها هنا.

// التصريح والإدارة معًا في خانة واحدة تُقرأ سطرًا: «تصريح كذا · منسوبي كذا»، وما ينقص لا يُطبع فراغًا.
const gateText=g=>[g.capability_name?`تصريح «${g.capability_name}»`:'',g.department_name?`منسوبي ${g.department_name}`:''].filter(Boolean).join(' · ')||'بلا شرط';

export function serviceGatesSection(g,{e,button,ui}){
  // القسم لا يُرسم لغير الأدمن الأول: الخادم يردّ can_manage=false بقوائم فارغة، فبلا هذا الشرط يقرأ
  // مديرُ الإدارة — وهو يفتح هذه الشاشة لأزمنة خدماته — بابًا اسمه «شروط أهلية الخدمات» أصفارًا وجداول
  // فارغة، فيظنّ أن الشركة بلا شروط وهو لا يرى منها شيئًا. القاعدة نفسها في قسم المفاتيح فوقه.
  // وشرطُ ui صريح لا احتياطي: القسم يُبنى من العدّة وحدها، وسياقٌ بلا عدّة (اختبارات أقدم منها تبني
  // سياقها بيدها) يقرأ بقية الشاشة كما كان ولا ينكسر عند هذا القسم.
  if(!g?.can_manage||typeof ui?.card!=='function'||typeof ui?.table!=='function')return '';
  const t=g.totals,p=g.proposal;
  // الزرّ يتكرر في كل صف، فاسمه المسموع يحمل خدمته ويبدأ بنصّه الظاهر (WCAG 2.5.3).
  const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
  // الصفّ يقول الشرط وسنده ومنذ متى؛ من قرّره في «سجل قرارات الشرط» تحته وفي سجل التدقيق (معيار المالك: المادة وسندها).
  const gateRow=row=>`<tr data-filter-text="${e([row.service_code,row.service,row.capability_name,row.department_name,'مشروطة'].join(' '))}">`
    +`<td><strong><bdi>${e(row.service_code)}</bdi></strong> — ${e(row.service)}</td>`
    +`<td><span class="badge pending">${e(gateText(row))}</span></td>`
    +`<td>${e(row.basis)}</td>`
    +`<td><time datetime="${e(row.decided_at)}">${e(String(row.decided_at).slice(0,10))}</time></td>`
    +`<td>${row.actions.includes('set_service_gate')?named(button('set_service_gate',row.service_code,'تعديل الشرط أو رفعه'),`تعديل الشرط أو رفعه: ${row.service}`):''}</td></tr>`;
  const gated=g.gates.length
    ?ui.card({code:String(g.gates.length),title:'خدمات عليها شرط',meta:`${g.gates.length} خدمة من ${t.placements}`,open:true,
      body:ui.table({head:['الخدمة','الشرط','السند','منذ',''],rows:g.gates.map(gateRow)})})
    // العدد من الإسقاط لا من رقم مكتوب في الشاشة: رقمٌ محفور هنا يصير كذبةً أول ما تتغيّر الشجرة،
    // وهو العطب نفسه الذي بُنيت عدّادات هذه الشاشة من جملةٍ واحدة لتمنعه.
    :`<p class="subtle">ما فيه خدمة عليها شرط اليوم: ${e(t.placements)} بندًا كلها مفتوحة، وكل واحد منها مكتوب تحت ليش هو مفتوح.</p>`;

  // الاقتراح بعدده وبسبب كل صنف. صفرُ اقتراحاتٍ ليس شاشةً فارغة: هو الجواب، ومعه لماذا.
  const reasonRows=Object.entries(p.by_reason).filter(([,n])=>n>0)
    .map(([key,n])=>`<tr><td>${e(n)}</td><td>${e(p.reasons[key]??key)}</td></tr>`);
  const proposalBody=p.proposals.length
    ?ui.table({head:['الخدمة','الشرط المقترح','السند'],
      rows:p.proposals.map(x=>`<tr><td><strong><bdi>${e(x.code)}</bdi></strong> — ${e(x.name)}</td><td>${e(gateText({capability_name:x.capability_name,department_name:x.department_id}))}</td><td>${e(x.basis)}</td></tr>`)})
    :`<p class="subtle">ما فيه اقتراح: المنصة ما تعرف شرطًا تفرضه على أي بند من الـ${e(t.placements)}، وما تخترع لك واحدًا.</p>`;
  const proposal=ui.card({code:String(p.counts.with_capability+p.counts.with_department),title:'الاشتقاق: ما تعرفه المنصة أصلًا',
    meta:`${p.counts.with_capability} تصريحًا · ${p.counts.with_department} حصرًا بإدارة · ${p.counts.stays_open} بندًا يبقى مفتوحًا`,open:true,
    body:`<p class="subtle">${e(p.note)}</p>${proposalBody}
      <h3>ليش يبقى مفتوحًا</h3>${ui.table({head:['كم','السبب'],rows:reasonRows})}`});

  // القنوات التي لا تُشرَط أبدًا تُسمّى بأسمائها: الاشتقاق يرفض اقتراحها والباب يرفض وضعها باليد،
  // فيُقال ذلك قبل أن يبحث المالك عنها في القائمة ولا يجدها.
  const guarded=g.guarded.length
    ?`<p class="proposal-warning"><span class="badge pending">ما تنشرط أبدًا</span> ${g.guarded.map(x=>`<strong>${e(x.name)}</strong> (<bdi>${e(x.code)}</bdi>)`).join('، ')}. ${e(g.guarded[0].why)}.</p>`
    :'';
  const history=g.history.length
    ?`<details><summary>سجل قرارات الشرط (${e(g.history.length)})</summary>${ui.table({head:['متى','الخدمة','القرار','السند','من'],
      rows:g.history.map(h=>`<tr><td><time datetime="${e(h.decided_at)}">${e(String(h.decided_at).slice(0,16).replace('T',' '))}</time></td><td><bdi>${e(h.service_code)}</bdi></td><td>${e(h.lifted?'رُفع الشرط':gateText({capability_name:h.capability_name,department_name:h.department_id}))}</td><td>${e(h.basis)}</td><td>${e(h.decided_by_name)}</td></tr>`)})}</details>`
    :'<p class="subtle">ما فيه قرار شرط بعد: الجدول ما فيه صف واحد، وكل خدمة مفتوحة بالافتراض.</p>';
  const add=g.can_manage?`<div class="operation-actions">${button('set_service_gate','','شرط على خدمة')}</div>`:'';
  // قاعدةٌ لم يُبنَ إسقاط دليلها بعد (مثبّت الخدمات لم يُشغَّل عليها) تُقال كما هي: صفرٌ هنا لا يعني
  // «لا شروط» بل «لا شجرة أصلًا»، والفرق بينهما هو الفرق بين طمأنينةٍ صادقة وأخرى كاذبة.
  if(!t.placements)return `<section class="vn-block"><h2>شروط أهلية الخدمات</h2>
    <p class="subtle">ما فيه إسقاط لشجرة الدليل في هذي القاعدة بعد، فما فيه بند يُشرَط. شغّل مثبّت الخدمات أولًا، وبعدها يظهر هنا كل بند وحاله.</p>
    ${guarded}</section>`;
  return `<section class="vn-block"><h2>شروط أهلية الخدمات</h2>
    <p class="subtle">${e(g.note)}</p>
    <p><span class="badge ${t.gated?'pending':'approved'}">${e(t.gated)} خدمة مشروطة من ${e(t.placements)}</span> <span class="badge approved">${e(t.open)} مفتوحة عن قصد</span></p>
    ${guarded}
    ${add}
    <div id="service-gate-list">${gated}</div>
    ${proposal}
    ${history}</section>`;
}

// النموذج: خدمةٌ واحدة، وتصريحٌ من القائمة أو «بلا»، وإدارةٌ من القائمة أو «بلا»، وسندٌ مكتوب.
// لا حقل نصّ حرّ لمفتاح تصريح ولا لمعرّف إدارة: الباب يرفض المجهول بالاسم، والقائمة تمنع الوصول إليه أصلًا.
export function serviceGatesForm(action,id,data){
  if(action!=='set_service_gate')return null;
  const g=data?.service_gates;
  if(!g?.can_manage)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');
  const current=g.gates.find(x=>x.service_code===id)??null;
  const field=(name,label,type,extra={})=>({name,label,type,...extra});
  return {title:current?`شرط «${current.service}»`:'شرط على خدمة',endpoint:'/approval-settings/service-gates',fields:[
    field('service_code','الخدمة','select',{value:current?.service_code??'',
      options:g.services.map(s=>({value:s.code,label:`${s.code} — ${s.name}`})),
      hint:'الشرط يمشي على رمز الخدمة لا على نسختها، فيبقى بعد أي تعديل على تعريفها.'}),
    field('required_capability','التصريح اللازم','select',{required:false,value:current?.required_capability??'',
      options:[{value:'',label:'— بلا تصريح —'},...g.capabilities.map(c=>({value:c.key,label:`${c.name} (${c.group})`}))],
      hint:'اللي ما يحمله ما يشوف الخدمة في الدليل ولا في البحث ولا يقدر يفتح منها طلب. وتصريحٍ يحمله كل موظف مرفوض: ما يحصر أحد.'}),
    field('department_id','حصرها بإدارة','select',{required:false,value:current?.department_id??'',
      options:[{value:'',label:'— كل الإدارات —'},...g.departments.map(d=>({value:d.id,label:d.name}))],
      hint:'اختر إدارة لو كانت الخدمة إجراءً داخليًا لها. الإدارات الموقوفة مرفوضة: الحصر فيها إقفال لا تضييق.'}),
    field('basis','السند','textarea',{hint:'ليش هذي الخدمة بالذات، وعلى أي قرار. شرطٌ بلا سند يصير بعد شهر بابًا مغلقًا ما أحد يعرف مين أغلقه ولا يجرؤ يفتحه. عشرة أحرف على الأقل.'})
  ],toPayload:v=>({service_code:v.service_code,required_capability:v.required_capability||'',
    department_id:v.department_id||null,basis:v.basis})};
}
