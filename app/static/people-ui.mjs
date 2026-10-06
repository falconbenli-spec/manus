// التوظيف والتهيئة: احتياج يعتمده غير طالبه، ومرشحون بتقييمين مستقلين، ومقترح داخلي باعتماد مستقل، ثم قائمة تهيئة لكل عنصر فيها مالك.
// الشاشة تقول المضمون والخطوة التالية بلهجة المنصة، بلا وصفٍ للبيانات ولا تبرّؤ. وقيد الخادم على بريد المرشح (.invalid) يُقال في تسمية حقله.
// الحالة الفارغة من العدّة (ui)، والاختبار الذي يرسم الشاشة بلا ui يأخذ العدّة نفسها افتراضًا (kit(e)).
import { kit } from './kit.mjs';
const statuses={pending_need:'بانتظار اعتماد الاحتياج',open:'احتياج معتمد',filled:'قبول مسجل للشاغر',cancelled:'ملغى',rejected:'مرفوض',applied:'مرشح مسجل',screened:'تم الفرز',interviewing:'مقابلة وتقييم مستقل',evaluated:'اكتمل التقييمان',offer_pending:'مقترح عرض بانتظار المدير',offer_approved:'مقترح داخلي معتمد',accepted:'قبول مسجل بدليل',onboarding:'قيد التهيئة',completed:'اكتملت قائمة التهيئة'};
const labels={approve_need:'اعتماد الاحتياج',reject_need:'رفض الاحتياج',cancel_need:'إلغاء الاحتياج',add_candidate:'إضافة مرشح',screen:'توثيق الفرز',schedule_interview:'تحديد موعد المقابلة',evaluate:'تسجيل تقييمي المستقل',propose_offer:'إعداد مقترح عرض أو تعديل نسخته',approve_offer:'اعتماد مقترح العرض',reject_offer:'رفض المقترح',reject_candidate:'إغلاق ترشيح مع السبب',accept_offer:'تسجيل قبول بدليل',start_onboarding:'بدء قائمة التهيئة',complete_onboarding:'إقفال التهيئة بعد مراجعة الأدلة',complete_task:'إكمال العنصر بدليل',link_hire:'ربط المرشح بحسابه وعقده'};
const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const blankOption={value:'',label:'اختر…'};
const decimal=minor=>{const value=BigInt(minor);return `${value/100n}.${String(value%100n).padStart(2,'0')}`;};
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// التاريخ بنصه كما يُخزَّن وقيمته الآلية في datetime؛ والعدد بأرقام مجدولة.
const when=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
// طابع الخادم (ISO بتوقيت UTC) يُقرأ بيوم الرياض: «انربط في …» بيوم من يقرؤه لا بيوم UTC.
const riyadhDay=iso=>iso?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)):'';
// السجل خطٌّ زمني بترتيب وقوعه: حدث، أو نسخة مقترح، أو قبول.
const timeline=items=>items.length?`<div class="timeline">${[...items].sort((a,b)=>String(a.at).localeCompare(String(b.at))).map(item=>`<div class="timeline-item">${item.html}</div>`).join('')}</div>`:'';
// اسم الحدث في السجل بصيغة محايدة («تسجيل تقييم مستقل» لا «تقييمي»)، وحدثا الإنشاء باسميهما لا برمزيهما.
const eventNames={requisition_submitted:'تقديم طلب الاحتياج',candidate_added:'إضافة المرشح',evaluate:'تسجيل تقييم مستقل'};
const eventItems=(e,events)=>events.map(event=>({at:event.created_at,html:`<strong>${e(eventNames[event.action]??labels[event.action]??event.action)}</strong><small>${[e(event.actor_name),when(e,event.created_at),e(event.evidence)].filter(Boolean).join(' · ')}</small>`}));
function taskHtml(task,{e,button},level=3) {
  return `<article class="panel"><div class="panel-body"><h${level}>${e(task.title)}</h${level}><p class="subtle">${e(task.owner_name)} · الموعد ${when(e,task.due_date)} · ${e(task.status==='completed'?'مكتمل بدليل':'بانتظار مالك العنصر')}</p><p class="subtle">معيار الإكمال: ${e(task.acceptance)}</p>${task.evidence?`<p>دليل التنفيذ: ${e(task.evidence)}</p>`:''}${task.can_complete?`<div class="operation-actions">${button('complete_task',task.id,'إكمال العنصر بدليل')}</div>`:''}</div></article>`;
}
function requestHtml(r,{e,button}) {
  return `<article class="panel"><div class="panel-body"><h3>${e(r.title)}</h3><p><span class="badge">${e(statuses[r.status]||r.status)}</span> · المدير ${e(r.manager_name)} · تاريخ الاحتياج ${when(e,r.target_date)}</p><p class="subtle measure">${e(r.need)}</p>${r.actions.length?`<div class="operation-actions">${r.actions.map(action=>button(action,r.id,labels[action])).join('')}</div>`:''}
    <details><summary>الخطة والمخصص ومعايير المقابلة (${num(e,r.criteria.length)})</summary><dl class="detail-data"><div><dt>مرجع الخطة</dt><dd>${e(r.plan_reference)}</dd></div><div><dt>دليل المخصص</dt><dd>${e(r.budget_evidence)}</dd></div><div><dt>المرجع</dt><dd><bdi>${e(r.id)}</bdi></dd></div></dl><div class="table-wrap"><table><caption class="sr-only">معايير المقابلة وأوزانها</caption><thead><tr><th>المعيار</th><th>الوزن</th><th>دليل القبول المطلوب</th></tr></thead><tbody>${r.criteria.map(item=>`<tr><td>${e(item.label)}</td><td>${e(item.weight)}%</td><td>${e(item.acceptance)}</td></tr>`).join('')}</tbody></table></div></details>
    ${r.events.length?`<details><summary>سجل الطلب (${num(e,r.events.length)})</summary>${timeline(eventItems(e,r.events))}</details>`:''}</div></article>`;
}
// رابط التوظيف (الترحيل 172) على بطاقة المرشح: الحساب الذي فُتح له ثم عقده، كلٌّ مرة واحدة. اسم الحساب يفتح ملف الموظف الموحّد.
const hireRows=(e,h)=>h?`<div><dt>الحساب المربوط</dt><dd><a href="#employee-profile/${e(encodeURIComponent(h.user_id))}">${e(h.user_name)}</a> · من ${when(e,riyadhDay(h.linked_at))}</dd></div><div><dt>العقد المربوط</dt><dd>${h.contract_id?`مربوط من ${when(e,riyadhDay(h.contract_linked_at))}`:'ينتظر الربط'}</dd></div>`:'';
// زر الربط يُرسم حين يجد نموذجه ما يُختار: حسابٌ يقبله الربط، أو عقدٌ قائم للحساب المربوط (hire_options من الخادم).
// وإلا يُقال ما الناقص ومن يسدّه، بدل زرٍّ يفتح قائمة فارغة.
const linkable=(c,options)=>c.hire?(options?.contracts??[]).some(k=>k.user_id===c.hire.user_id):(options?.accounts??[]).length>0;
function candidateHtml(c,helpers) {
  const {e,button,money,hireOptions}=helpers;
  const actions=c.actions.filter(action=>action!=='link_hire'||linkable(c,hireOptions));
  const linkWaits=c.actions.includes('link_hire')&&!linkable(c,hireOptions)?`<p class="subtle">${c.hire?'ربط العقد ينتظر عقد الموظف: يُعد ويُقدَّم من «العقود وبنود الراتب»، وبعدها يطلع زر الربط هنا.':'الربط ينتظر حساب الموظف: يفتحه مسؤول المنصة من «الحسابات»، وبعدها يطلع زر الربط هنا.'}</p>`:'';
  const offerVersions=c.versions.filter(version=>version.kind==='offer'),acceptances=c.versions.filter(version=>version.kind==='acceptance');
  const history=[...eventItems(e,c.events),
    ...offerVersions.map(version=>({at:version.created_at,html:`<strong>نسخة المقترح ${num(e,version.revision)}</strong><small><span class="ltr">${e(money(version.snapshot.monthly_base_minor,version.snapshot.currency))}</span> · ${when(e,version.created_at)}</small>`})),
    ...acceptances.map(version=>({at:version.created_at,html:`<strong>قبول النسخة ${num(e,version.snapshot.offer_revision)}</strong><small>${when(e,version.snapshot.accepted_on)} · ${e(version.snapshot.evidence)}</small>`}))];
  return `<article class="panel" data-id="${e(c.id)}"><div class="panel-body"><h3>${e(c.name)} · ${e(c.requisition_title)}</h3><span class="badge">${e(statuses[c.status]||c.status)}</span><dl class="detail-data"><div><dt>بريد المرشح</dt><dd><bdi>${e(c.contact)}</bdi></dd></div><div><dt>مصدر الترشيح</dt><dd>${e(c.source)}</dd></div><div><dt>تاريخ المقابلة</dt><dd>${c.interview_date?when(e,c.interview_date):'ما تحدد للحين'}</dd></div><div><dt>نهاية عرض بيانات المرشح</dt><dd>${when(e,c.retention_until)}</dd></div>${hireRows(e,c.hire)}</dl><p class="subtle">سجّل تقييمه ${num(e,c.evaluation_count)} من المقيّمَين الاثنين. توصية المقيّم الثاني تبقى مخفية لين تسجّل تقييمك أو يكتمل التقييمان.</p>
    ${actions.length?`<div class="operation-actions">${actions.map(action=>button(action,c.id,action==='link_hire'&&c.hire?'ربط عقد الموظف بملف توظيفه':labels[action])).join('')}</div>`:''}${linkWaits}
    ${c.offer?`<section class="panel panel-body"><h4>مقترح داخلي · النسخة ${num(e,c.offer_revision)}</h4><p><span class="ltr">${e(money(c.offer.monthly_base_minor,c.offer.currency))}</span> أجر أساسي شهري</p><p class="subtle">الالتحاق المقترح ${when(e,c.offer.start_date)} · صلاحية المقترح لين ${when(e,c.offer.valid_until)}</p><p class="subtle">${e(c.offer.benefits)} · ${e(c.offer.conditions)}</p></section>`:''}
    <details><summary>التقييمات (${num(e,c.evaluations.length)}) والسجل (${num(e,history.length)})</summary><p class="subtle">مرجع الخصوصية: <bdi>${e(c.privacy_reference)}</bdi> · ${e(c.consent_evidence)}</p>${c.evaluations.map(evaluation=>`<section class="panel panel-body"><h4>${e(evaluation.evaluator_name)}</h4><p class="subtle">${e(evaluation.recommendation==='proceed'?'توصية بالاستمرار':'توصية بعدم الاستمرار')} · ${e(evaluation.evidence)}</p><div class="table-wrap"><table><caption class="sr-only">درجات ${e(evaluation.evaluator_name)} لكل معيار</caption><thead><tr><th>المعيار</th><th>الدرجة من 5</th><th>الدليل</th></tr></thead><tbody>${evaluation.scores.map(score=>`<tr><td>${e(c.criteria.find(item=>item.key===score.key)?.label||score.key)}</td><td>${e(score.score)}</td><td>${e(score.evidence)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}
    ${timeline(history)}</details>
    ${c.tasks.length?`<details><summary>عناصر التهيئة وملاكها (${num(e,c.tasks.length)})</summary>${c.tasks.map(task=>taskHtml(task,helpers,4)).join('')}</details>`:''}</div></article>`;
}
export const peopleUI={
  title:'التوظيف والتهيئة المحلية',
  description:'من اعتماد الاحتياج للمرشحين والمقابلات بتقييم مستقل، لين المقترح الداخلي وقائمة التهيئة بأصحابها.',
  load:api=>api('/people'),
  render(data,{e,button,money,ui=kit(e)}) {
    const helpers={e,button,money,hireOptions:data.hire_options??null};
    const zone=data.timezone==='Asia/Riyadh'?'الرياض':`<bdi>${e(data.timezone)}</bdi>`;
    const create=data.user.role==='manager'?data.policies.filter(p=>p.department_id===data.user.department_id).map(p=>button('create',p.id,'طلب احتياج ضمن '+p.name)).join(''):'';
    // كل قسم يُسمّى بعنوانه الظاهر (aria-labelledby)، وزرّ فتح الاحتياج في رأس قسمه.
    const needs=`<section class="vn-block" aria-labelledby="people-needs"><div class="panel-head"><h2 id="people-needs">الاحتياج واعتماده</h2>${create?`<div class="operation-actions">${create}</div>`:''}</div>${data.requisitions.length?data.requisitions.map(r=>requestHtml(r,helpers)).join(''):ui.empty('ما فيه طلبات احتياج تخصّك','يفتحه مدير الإدارة من زر «طلب احتياج ضمن …» في رأس هالقسم، بمرجع خطة ومخصص ومعايير، والموارد البشرية تراجعه وتعتمده.')}</section>`;
    const candidates=`<section class="vn-block" aria-labelledby="people-candidates"><div class="panel-head"><h2 id="people-candidates">المرشحون والمقابلات</h2></div>${data.candidates.length?data.candidates.map(c=>candidateHtml(c,helpers)).join(''):'<p class="subtle">للحين ما فيه مرشحين لك — يطلعون هنا أول ما ينعتمد احتياج وينضاف له مرشح.</p>'}</section>`;
    const tasks=`<section class="vn-block" aria-labelledby="people-tasks"><div class="panel-head"><h2 id="people-tasks">عناصر التهيئة المسندة إليّ</h2></div>${data.tasks.length?data.tasks.map(task=>taskHtml(task,helpers)).join(''):'<p class="subtle">للحين ما عندك عناصر تهيئة — تطلع هنا إذا انسند لك عنصر في قائمة تهيئة.</p>'}</section>`;
    // ملفات حُجبت بانتهاء مدة الاحتفاظ قرارٌ ينتظر صاحبه، فيُقال أول الشاشة.
    const retention=data.retention_due.length?`<div class="vn-alert is-due"><strong>مراجعة مدة الاحتفاظ</strong><p>انحجب عرض ${num(e,data.retention_due.length)} من ملفات المرشحين لأن مدة الاحتفاظ المسجلة خلصت. الملفات باقية لين يصير قرار مخوّل: تنحفظ أو تنحذف.</p></div>`:'';
    // عناصر التهيئة المسندة إليك أول الشاشة حين توجد: هي شغلك أنت بمواعيدها.
    const sections=data.tasks.length?[tasks,needs,candidates]:[needs,candidates,tasks];
    return `<section class="panel panel-body vn-head"><p>كل طلب احتياج يمثّل شاغر واحد. التواريخ بتوقيت ${zone}، واليوم ${when(e,data.today)}.</p>${retention}</section>
      ${sections.join('')}`;
  },
  form(action,id,data) {
    if(action==='create') {
      const policy=data.policies.find(p=>p.id===id);
      guard(policy&&data.user.role==='manager'&&policy.department_id===data.user.department_id);
      return {title:'طلب احتياج توظيف (شاغر واحد)',endpoint:'/people/requisitions',idempotent:true,
        fields:[field('title','الوظيفة المطلوبة'),field('need','مبرر الاحتياج والمهارات','textarea'),field('plan_reference','مرجع خطة التوظيف المعتمدة'),field('budget_evidence','دليل المخصص','textarea'),field('target_date','تاريخ الاحتياج','date',{min:data.today,max:policy.effective_to}),
          field('first_label','المعيار الأول'),field('first_weight','وزن المعيار الأول (مجموع الوزنين 100)','number',{min:1,max:99,step:1}),field('first_acceptance','دليل القبول المتوقع للمعيار الأول','textarea'),
          field('second_label','المعيار الثاني'),field('second_weight','وزن المعيار الثاني','number',{min:1,max:99,step:1}),field('second_acceptance','دليل القبول المتوقع للمعيار الثاني','textarea')],
        toPayload:values=>({policy_id:policy.id,title:values.title,need:values.need,plan_reference:values.plan_reference,budget_evidence:values.budget_evidence,target_date:values.target_date,criteria:[{key:'first_criterion',label:values.first_label,weight:Number(values.first_weight),acceptance:values.first_acceptance},{key:'second_criterion',label:values.second_label,weight:Number(values.second_weight),acceptance:values.second_acceptance}]})};
    }
    if(action==='complete_task') {
      const task=data.tasks.find(task=>task.id===id);
      guard(task?.can_complete);
      const version=task.version;
      return {title:'توثيق إكمال عنصر التهيئة: '+task.title,endpoint:`/people/tasks/${task.id}/complete`,fields:[field('evidence','دليل إكمال العنصر','textarea')],toPayload:values=>({version,evidence:values.evidence})};
    }
    // رابط التوظيف (الترحيل 172): الحساب أولًا ثم العقد، كلٌّ مرة واحدة، بيد موظف خدمات الموظف في نطاق الاحتياج. القوائم من hire_options
    // (حسابات يقبلها الربط، وعقودها القائمة بلا مبالغ)، والخادم يعيد الفحص كله عند الحفظ (linkHire).
    if(action==='link_hire') {
      const c=data.candidates.find(x=>x.id===id),options=data.hire_options;
      guard(c?.actions.includes('link_hire')&&linkable(c,options));
      const version=c.version,endpoint=`/people/${c.id}/link_hire`,evidence=field('evidence','دليل الربط: مرجع فتح الحساب والعقد','textarea');
      const contractChoice=k=>({value:k.id,label:`${k.status_name} · من ${k.start_date}${k.end_date?` إلى ${k.end_date}`:''}`});
      // رُبط الحساب وبقي العقد: عقود ذلك الحساب وحده.
      if(c.hire)return {title:`ربط عقد ${c.hire.user_name} بملف توظيفه`,endpoint,
        fields:[field('contract_id','عقد الموظف','select',{options:[blankOption,...options.contracts.filter(k=>k.user_id===c.hire.user_id).map(contractChoice)]}),evidence],
        toPayload:values=>({version,contract_id:values.contract_id,evidence:values.evidence})};
      // العقد اختياري الحين (يُربط بعدين حين يُعتمد)، وكل عقد في القائمة باسم صاحبه. قائمة واحدة لا قائمة لكل حساب تظهر حين يُختار:
      // الحقل المشروط المخفي يبقى يحجز مكانه في شبكة النموذج (.form-grid label يغلب [hidden])، فتصير القوائم المخفية فراغًا. وعقدٌ لغير
      // الحساب المختار يُقال قبل الإرسال، والخادم يرفضه أيضًا (hire_contract).
      const owner=id=>options.accounts.find(account=>account.id===id)?.name??'';
      const choices=options.contracts.filter(k=>owner(k.user_id)).sort((a,b)=>owner(a.user_id).localeCompare(owner(b.user_id),'ar'));
      return {title:`ربط ${c.name} بحسابه في المنصة`,endpoint,
        fields:[field('user_id','حساب الموظف','select',{options:[blankOption,...options.accounts.map(account=>({value:account.id,label:account.name}))],hint:'الحساب يفتحه مسؤول المنصة من «الحسابات»، ولكل حساب مرشح واحد.'}),
          field('contract_id','عقد الحساب نفسه','select',{required:false,options:[{value:'',label:'بلا عقد الحين — يُربط بعد ما يُعتمد'},...choices.map(k=>({...contractChoice(k),label:`${owner(k.user_id)} — ${contractChoice(k).label}`}))],
            hint:'العقد يُربط هنا أو بعدين من نفس الزر حين يُعتمد من «العقود وبنود الراتب».'}),evidence],
        toPayload:values=>{
          if(values.contract_id&&options.contracts.find(k=>k.id===values.contract_id)?.user_id!==values.user_id)throw new Error('العقد المختار لحساب غير الحساب المختار: اختر عقد الحساب نفسه، أو اتركه للحين.');
          return {version,user_id:values.user_id,...(values.contract_id?{contract_id:values.contract_id}:{}),evidence:values.evidence};}};
    }
    const row=data.requisitions.find(r=>r.id===id)||data.candidates.find(c=>c.id===id);
    guard(row&&row.actions.includes(action));
    const version=row.version,endpoint=`/people/${row.id}/${action}`,spec={title:labels[action],endpoint};
    if(['approve_need','reject_need','cancel_need'].includes(action))return {...spec,fields:[field('note','سبب القرار ودليل مراجعة الخطة والمخصص','textarea')],toPayload:values=>({version,note:values.note})};
    if(action==='add_candidate')return {...spec,idempotent:true,fields:[field('name','اسم المرشح'),field('contact','بريد المرشح (لازم ينتهي بـ\u2066.invalid\u2069)','text',{placeholder:'candidate@example.invalid'}),field('source','مصدر الترشيح'),field('consent_evidence','دليل موافقة المرشح على الخصوصية','textarea'),field('retention_until','نهاية مدة عرض بيانات المرشح','date',{min:data.today})],toPayload:values=>({version,name:values.name,contact:values.contact,source:values.source,consent_evidence:values.consent_evidence,retention_until:values.retention_until})};
    if(action==='schedule_interview')return {...spec,fields:[field('interview_date','تاريخ المقابلة (بتوقيت الرياض)','date',{value:data.today}),field('evidence','دليل الموعد والفرز','textarea')],toPayload:values=>({version,interview_date:values.interview_date,evidence:values.evidence})};
    if(action==='evaluate')return {...spec,fields:[...row.criteria.flatMap(item=>[field(`score_${item.key}`,`${item.label} · ${item.weight}%`,'select',{options:[blankOption,...[0,1,2,3,4,5].map(value=>({value:String(value),label:String(value)}))]}),field(`evidence_${item.key}`,'دليل المعيار: '+item.acceptance,'textarea')]),field('recommendation','توصيتي المستقلة','select',{options:[blankOption,{value:'proceed',label:'الاستمرار'},{value:'do_not_proceed',label:'عدم الاستمرار'}]}),field('evidence','مبرر التوصية','textarea')],toPayload:values=>({version,scores:row.criteria.map(item=>({key:item.key,score:Number(values[`score_${item.key}`]),evidence:values[`evidence_${item.key}`]})),recommendation:values.recommendation,evidence:values.evidence})};
    if(action==='propose_offer')return {...spec,fields:[field('monthly_base','الأجر الأساسي الشهري','text',{value:row.offer?decimal(row.offer.monthly_base_minor):'',placeholder:'مبلغ بمنزلتين عشريتين، مثل 8000.00'}),field('currency','العملة','select',{value:row.offer?.currency,options:[blankOption,...['SAR','USD','EUR'].map(value=>({value,label:value}))]}),field('start_date','تاريخ الالتحاق المقترح','date',{value:row.offer?.start_date,min:data.today}),field('valid_until','صلاحية المقترح الداخلي','date',{value:row.offer?.valid_until,min:data.today}),field('benefits','المزايا','textarea',{value:row.offer?.benefits}),field('conditions','الشروط','textarea',{value:row.offer?.conditions}),field('evidence','مبرر المقترح أو تعديل نسخته','textarea')],toPayload:values=>({version,monthly_base:values.monthly_base,currency:values.currency,start_date:values.start_date,valid_until:values.valid_until,benefits:values.benefits,conditions:values.conditions,evidence:values.evidence})};
    if(action==='accept_offer')return {...spec,fields:[field('accepted_on','تاريخ القبول المثبت','date',{value:data.today,max:data.today}),field('evidence','دليل قبول النسخة المعتمدة','textarea')],toPayload:values=>({version,accepted_on:values.accepted_on,evidence:values.evidence})};
    if(action==='start_onboarding')return {...spec,fields:[...[1,2].flatMap(index=>[field(`title_${index}`,`عنصر التهيئة ${index}`),field(`owner_${index}`,`مالك العنصر ${index}`,'select',{options:[blankOption,...data.assignees.map(person=>({value:person.id,label:person.name}))]}),field(`due_${index}`,`موعد العنصر ${index}`,'date',{min:data.today}),field(`acceptance_${index}`,`معيار إكمال العنصر ${index}`,'textarea')]),field('evidence','دليل خطة التهيئة','textarea')],toPayload:values=>({version,items:[1,2].map(index=>({title:values[`title_${index}`],owner_id:values[`owner_${index}`],due_date:values[`due_${index}`],acceptance:values[`acceptance_${index}`]})),evidence:values.evidence})};
    return {...spec,fields:[field('evidence','السبب ودليل الإجراء','textarea')],toPayload:values=>({version,evidence:values.evidence})};
  }
};
