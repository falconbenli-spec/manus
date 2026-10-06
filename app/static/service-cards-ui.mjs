// بطاقات الخدمات: ما يعمل فعلًا مشتق من تعريف الخدمة، وما يكمله معدّ الدليل يعتمده مالك الإجراء المسمى.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const states={ready:'جاهزة',incomplete:'منشورة ناقصة',draft:'مسودة',none:'بلا بطاقة'};
const block=(title,body,e)=>body?`<section class="vn-block"><h3>${e(title)}</h3><p>${e(body).replace(/\n/g,'<br>')}</p></section>`:'';
// أعمدة صفحة الخدمة الأربعة (ترحيل 131): تُعرض بما كُتب فيها، وما لم يُكتب يُقال بسببه ومن يملك كتابته —
// لا «غير متاح» عارية. والسبب يأتي مبنيًّا من app/service-cards.mjs (content_gaps) فلا تكتبه الشاشة من عندها.
const listBlock=(title,items,e)=>items?.length?`<section class="vn-block"><h3>${e(title)}</h3><ul class="vn-list">${items.map(x=>`<li>${e(x)}</li>`).join('')}</ul></section>`:'';
// سند الشرط بكلام يقرؤه الموظف، لا باسم عمودٍ في القاعدة: من أين جاء الشرط، وهل كتبه إنسان أم اشتُقّ.
const RULE_SOURCE={capability:'مشتق من تصريح تشترطه الخدمة في الدليل',department:'مشتق من حصر الخدمة بإدارتها',
  audience:'مشتق من جمهور الخدمة في الدليل',approval_condition:'مشتق من شرط في مسار الاعتماد',written:'كتبه مالك الإجراء'};
const rulesBlock=(rules,e)=>rules?.length?`<section class="vn-block"><h3>هل تنطبق عليك</h3><ul class="vn-list">${rules.map(r=>`<li><strong>${e(r.text)}</strong><span>${e(RULE_SOURCE[r.kind]??RULE_SOURCE.written)}</span></li>`).join('')}</ul></section>`:'';
const faqBlock=(items,e)=>items?.length?`<section class="vn-block"><h3>الأسئلة الشائعة</h3><dl class="vn-facts">${items.map(x=>`<div><dt>${e(x.q)}</dt><dd>${e(x.a)}</dd></div>`).join('')}</dl></section>`:'';
const gapsBlock=(gaps,e)=>gaps?.length?`<section class="vn-block"><h3>ما بقي على هذي البطاقة</h3><dl class="vn-facts">${gaps.map(g=>`<div><dt>${e(g.label)}</dt><dd>${e(g.why)}. يكتبها: ${e(g.owner)}</dd></div>`).join('')}</dl></section>`:'';
// نصّ الشاشة من الصيغة المخزَّنة: سطر لكل بند، والسؤال وجوابه بينهما «|» — الصيغة نفسها التي يقرؤها الخادم.
const jsonText=(value,shape)=>{let parsed;try{parsed=JSON.parse(String(value||(shape==='object'?'{}':'[]')));}catch{return String(value??'');}
  const list=shape==='object'?(Array.isArray(parsed?.rules)?parsed.rules:[]):(Array.isArray(parsed)?parsed:[]);
  return list.map(x=>shape==='faq'?`${x?.q??''} | ${x?.a??''}`:shape==='object'?String(x?.text??''):String(x??'')).join('\n');};
// مسار الخدمة كما يعمل، لا كما يُفترض: من يعتمدها، ومن ينفّذها، وبأي سند وصل التنفيذ إلى من وصله،
// وهل يجوز أن يكون المعتمِد هو المنفّذ نفسه. السؤال الأخير ليس تفصيلًا تقنيًا: مسح 21 سبتمبر وجد 115 طلبًا
// من 142 نفّذه الحسابُ نفسه الذي اعتمده، فصار حقّ الموظف أن يقرأ الجواب على البطاقة بلا قراءة كود.
// النص كله مبني في app/service-cards.mjs (workflowStatement) من سياسة الخدمة نفسها؛ هنا عرضٌ لا اشتقاق.
const workflowFacts=(w,e)=>!w?'':`<section class="vn-block"><h3>من يعتمدها ومن ينفّذها</h3>
  <dl class="vn-facts"><div><dt>يعتمدها</dt><dd>${w.approves.length?w.approves.map(e).join(' ← '):'ما فيه خطوة اعتماد — مسار مباشر'}</dd></div>
  <div><dt>ينفّذها</dt><dd>${e(w.executes)}</dd></div>
  <div><dt>سند التنفيذ</dt><dd>${e(w.execution_basis)}</dd></div>
  <div><dt>هل يكون المعتمِد هو المنفّذ؟</dt><dd>${e(w.same_person_note)}</dd></div></dl></section>`;
function cardView(data,e){
  const s=data.service,c=data.published??data.draft,draftOnly=!data.published&&!!data.draft;
  return `<div class="vn-alert ${data.ready?'':'is-block'}"><strong>${e(data.readiness)}</strong>${draftOnly?'<p>اللي تحت مسودة ما اعتمدها مالك الإجراء للحين.</p>':''}</div>
    <p>${e(s.description)}</p>
    ${s.module?`<div class="vn-alert"><strong>تنفّذ هذي الخدمة في شاشة «${e(s.module.name)}».</strong> <a class="btn outline small" href="#${e(s.module.key)}">فتح الشاشة</a></div>`:''}
    <dl class="vn-facts"><div><dt>الرمز</dt><dd><bdi dir="ltr">${e(s.code)}</bdi> · إصدار ${e(s.service_version)}</dd></div><div><dt>الإدارة والقسم</dt><dd>${e(s.department)}${s.section?` · ${e(s.section)}`:''}</dd></div><div><dt>مالك الإجراء</dt><dd>${e(c?.owner_name||'لم يُسمَّ')}</dd></div><div><dt>النوع والسرية</dt><dd>${c?`${e(c.kind_name)} · ${e(c.confidentiality_name)}`:'—'}</dd></div>
    <div><dt>مسار الاعتماد</dt><dd>${s.steps.map(e).join(' ← ')}</dd></div><div><dt>ينفذها</dt><dd>${e(s.handler)}</dd></div><div><dt>الزمن المستهدف</dt><dd>${e(s.target?.label??'غير محدد')}</dd></div><div><dt>التصعيد</dt><dd>${e(s.escalates_to||'غير محدد')}</dd></div></dl>
    ${workflowFacts(s.workflow,e)}
    <section class="vn-block"><h3>المدخلات</h3><ul class="vn-list">${s.inputs.map(f=>`<li><strong>${e(f.label)}${f.required?' <small>(مطلوب)</small>':''}</strong>${f.options?`<span>${f.options.map(e).join('، ')}</span>`:''}</li>`).join('')}</ul></section>
    ${c?block('الوصف المختصر',c.short_description,e)+rulesBlock(c.eligibility,e)+listBlock('المستندات المطلوبة',c.documents,e)+faqBlock(c.faq_items,e):''}
    ${gapsBlock(data.content_gaps,e)}
    ${c?block('من يحق له الطلب',c.requesters,e)+block('محفز البدء',c.trigger_note,e)+block('المخرجات',c.outputs,e)+block('أدلة القبول',c.acceptance_evidence,e)+block('الحدود المالية والتفويض',c.financial_limit_note,e)+block('الاستثناءات وإيقاف الساعة',c.exceptions_note,e)+block('المؤشرات',c.kpis,e)+block('التكاملات',c.integrations,e)+block('السياسة المرجعية',c.policy_reference,e):''}
    <p class="subtle">${e(s.lifecycle)} ${e(s.clock)} ${e(s.audit)}</p>${c?.status==='published'?`<p class="subtle">النسخة ${e(c.revision)} · سارية من ${e(c.effective_from)}.</p>`:''}
    <div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`;
}
export const serviceCardsUI={
  title:'بطاقات الخدمات',description:'لكل خدمة بطاقة: وش تسوي، ومين يملكها، ومدخلاتها ومخرجاتها ومسار اعتمادها وزمنها ومؤشراتها. والخدمة تكون جاهزة لما يعتمد مالكها بطاقتها.',
  load:api=>api('/service-cards'),
  render(data,{e,button,ui}){
    // أزرار الصف تتكرر في 142 صفًّا، فاسم كل زرّ المسموع يحمل خدمته ويبدأ بنصّه الظاهر (WCAG 2.5.3).
    const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
    const serviceActions=s=>{const verb=s.state==='draft'?'تعديل المسودة':'مسودة جديدة',who=`${s.code} ${s.name}`;
      return named(button('view_card',s.code,'عرض البطاقة'),`عرض البطاقة: ${who}`)
        +(data.can_manage?named(button('edit_card',s.code,verb),`${verb}: ${who}`):'')
        +(s.draft_owner_id===data.user_id&&s.draft_prepared_by!==data.user_id&&!s.draft_missing.length?named(button('publish_card',s.code,'اعتماد البطاقة'),`اعتماد البطاقة: ${who}`):'');};
    const tile=(value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`,names=new Map(data.departments.map(d=>[d.id,d.name]));
    const byDepartment=new Map();for(const s of data.services)byDepartment.set(s.department_id,[...(byDepartment.get(s.department_id)??[]),s]);
    // بطاقة كل إدارة من العدّة (ui.card): رمزها «الجاهزة/الكل»، وسطرها ما ينقص.
    const groups=[...byDepartment].sort((a,b)=>(names.get(a[0])??'').localeCompare(names.get(b[0])??'','ar')).map(([id,list])=>ui.card({code:`${list.filter(s=>s.state==='ready').length}/${list.length}`,title:names.get(id)??id,
      meta:`${list.filter(s=>s.state==='draft').length} مسودة · ${list.filter(s=>s.state==='none').length} بلا بطاقة`,
      body:`<div class="vn-body"><ul class="vn-list">${list.map(s=>`<li><strong><bdi dir="ltr">${e(s.code)}</bdi> · ${e(s.name)}</strong><span>${e(states[s.state])}${s.hidden?' · <span class="badge is-late">موقوفة من الإعدادات: ما ينفتح منها طلب جديد، وبطاقتها تخدم طلباتها المفتوحة</span>':''}${s.owner_name?` · المالك: ${e(s.owner_name)}`:''}${s.module?' · لها شاشة تشغيل':''}${s.state==='draft'&&s.draft_missing.length?` · ينقصها: ${s.draft_missing.map(e).join('، ')}`:''}</span><div class="operation-actions">${serviceActions(s)}</div></li>`).join('')}</ul></div>`})).join('');
    // طابور كل مالك على حدة: المسودات على المالك لا على الإدارة، فيرى صاحبها ما ينتظره هو لا 142 صفًّا.
    // من يملك «إعداد الخدمات» يرى الطوابير كلها، وغيره يرى طابوره وحده (الخادم يرشّحه قبل الإرسال).
    const queues=(data.owners??[]).length?`<section class="panel panel-body"><h2>طابور كل مالك إجراء</h2><ul class="vn-list">${data.owners.map(o=>`<li><strong>${e(o.owner_name)}${o.owner_id===data.user_id?' — أنت':''}</strong><span>${e(o.drafts)} مسودة${o.ready_to_publish?` · ${e(o.ready_to_publish)} جاهزة للاعتماد بضغطة`:''}${o.missing_fields.length?` · ينقصها: ${o.missing_fields.map(e).join('، ')}`:''}</span></li>`).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.can_manage&&data.totals.none?`<div class="operation-actions">${button('draft_missing','',`توليد مسودات لـ ${data.totals.none} خدمة بلا بطاقة`)}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.totals.services,data.totals.hidden?`خدمة في الدليل، منها ${data.totals.hidden} موقوفة`:'خدمة في الدليل')}${tile(data.totals.ready,'جاهزة ببطاقة معتمدة',data.totals.ready?'is-ok':'')}${tile(data.totals.draft,'مسودة بانتظار مالكها',data.totals.draft?'is-due':'')}${tile(data.totals.none,'بلا بطاقة',data.totals.none?'is-late':'')}${tile(data.totals.with_module,'لها شاشة تشغيل كاملة')}${tile(data.totals.page_fields_missing,'ينقصها شيء من أعمدة صفحة الخدمة',data.totals.page_fields_missing?'is-due':'')}</div></section>${queues}${groups||'<section class="panel panel-body"><p class="subtle">ما فيه بطاقات منشورة للحين.</p></section>'}`;
  },
  form(action,id,data){
    if(action==='view_card')return {title:`بطاقة الخدمة — ${id}`,endpoint:`/service-cards/${id}/view`,fields:[],toPayload:()=>({}),after:(saved,e)=>({title:`${saved.service.code} · ${saved.service.name}`,html:cardView(saved,e)})};
    if(action==='draft_missing'){guard(data.can_manage);return {title:'توليد مسودات البطاقات الناقصة',endpoint:'/service-cards/draft-missing',fields:[],toPayload:()=>({})};}
    const s=data.services.find(x=>x.code===id);guard(s);
    if(action==='publish_card')return {title:`اعتماد بطاقة — ${s.code}`,endpoint:`/service-cards/${id}/publish`,fields:[field('effective_from','تاريخ السريان','date'),field('note','إقرارك بملكية الإجراء','textarea',{hint:'باعتمادك تصبح مالك هذه الخدمة: مخرجاتها وزمنها ومؤشراتها مسؤوليتك. النسخة المنشورة لا تُعدل؛ تعديلها نسخة جديدة.'})],toPayload:v=>v};
    guard(data.can_manage);
    return {title:`بطاقة — ${s.code} ${s.name}`,endpoint:`/service-cards/${id}`,fields:[field('owner_id','مالك الإجراء','select',{required:false,value:s.values.owner_id??'',options:[{value:'',label:'لم يُسمَّ'},...data.people.filter(p=>p.id!==data.user_id).map(p=>({value:p.id,label:p.name}))],hint:'يعتمد المالك البطاقة بنفسه؛ معدّها لا يكون مالكها.'}),field('service_kind','النوع','select',{value:s.values.service_kind,options:Object.entries(data.kinds).map(([value,label])=>({value,label}))}),field('confidentiality','السرية','select',{value:s.values.confidentiality,options:Object.entries(data.confidentiality).map(([value,label])=>({value,label}))}),
      // أعمدة صفحة الخدمة الأربعة: صندوقٌ يكتب فيه الإنسان، والمشتق من تعريف الخدمة يصل مقترحًا في
      // الصندوق الفارغ (suggested) فيراجعه ويعدّله، ولا شيء يُحفظ حتى يضغط حفظ.
      field('short_description','الوصف المختصر','textarea',{required:false,value:s.values.short_description||s.suggested?.short_description||'',hint:'سطر واحد يقرؤه الموظف قبل ما يطلب. المقترح أول جملة من وصف الخدمة — عدّله إن ما كفى.'}),
      field('eligibility_rules','هل تنطبق عليك (شرط في كل سطر)','textarea',{required:false,value:jsonText(s.values.eligibility_rules||s.suggested?.eligibility_rules,'object'),hint:'من ينطبق عليه طلب هذي الخدمة ومن لا. اتركه فاضي إذا ما فيه شرط — أفضل من شرط متخيَّل.'}),
      field('required_documents','المستندات المطلوبة (مستند في كل سطر)','textarea',{required:false,value:jsonText(s.values.required_documents||s.suggested?.required_documents,'array'),hint:'اسم المستند كما يعرفه الموظف. المقترح ممّا يسمّيه تعريف الخدمة نفسه.'}),
      field('faq','الأسئلة الشائعة (سطر لكل سؤال: السؤال | الجواب)','textarea',{required:false,value:jsonText(s.values.faq,'faq'),hint:'من الأسئلة اللي توصلك فعلًا. المنصة ما تولّدها: ما تعرف وش يسأل عنه الناس.'}),
      field('requesters','من يحق له الطلب','textarea',{required:false,value:s.values.requesters}),field('trigger_note','محفز البدء','textarea',{required:false,value:s.values.trigger_note}),field('outputs','المخرجات','textarea',{required:false,value:s.values.outputs}),field('acceptance_evidence','أدلة القبول','textarea',{required:false,value:s.values.acceptance_evidence}),field('kpis','المؤشرات','textarea',{required:false,value:s.values.kpis}),field('financial_limit_note','الحدود المالية والتفويض','textarea',{required:false,value:s.values.financial_limit_note}),field('exceptions_note','الاستثناءات وحالات إيقاف الساعة','textarea',{required:false,value:s.values.exceptions_note}),field('integrations','التكاملات','textarea',{required:false,value:s.values.integrations}),field('policy_reference','السياسة المرجعية ونسختها','textarea',{required:false,value:s.values.policy_reference})],
      toPayload:v=>Object.fromEntries(['owner_id','requesters','service_kind','confidentiality','trigger_note','outputs','acceptance_evidence','financial_limit_note','exceptions_note','kpis','integrations','policy_reference','short_description','eligibility_rules','required_documents','faq'].map(k=>[k,v[k]||'']))};
  }
};
