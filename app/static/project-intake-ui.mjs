// سلسلة استلام المشروع: محضر التسليم BD-04، وقائمة الاستلام PM-01 بحالة بوابتها، ومحضر الانطلاق PM-02، وطلب التغيير PM-03.
// أربع شاشات على لوحة واحدة. لا طباعة ولا صور تواقيع ولا سطر توقيع فاضي: الاعتماد إلكتروني باسم صاحبه ودوره ووقته.
// الشاشة تعرض المضمون وسنده: من اعتمد ومتى هو سطر الاعتماد نفسه (بديل التوقيع)، أما الصلاحية ونسخة السجل فمكانها سجل التدقيق.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const load=api=>api('/project-intake');
const SIDES={handing_over:'المسلِّم (تطوير الأعمال)',receiving:'المستلِم (مدير المشروع)'};
// الحالة شكل وكلمة: المسودة والمنتظر بشكل الانتظار، والمنجز بالفاصلة الممتلئة — لا شكل «تم» على شي ما تم.
const HANDOVER_STATUS={draft:['pending','مسودة بانتظار الاعتماد'],handed_over:['pending','اعتمده الطرفان وينتظر الاستلام'],received:['approved','مستلَم']};
const CHANGE_STATUS={raised:['pending','مرفوع'],priced:['pending','مسعّر ومعتمد ماليًا'],approved:['scheduled','موافَق عليه وينتظر التطبيق'],declined:['declined','معتذَر عنه'],applied:['approved','مطبَّق']};
const at=stamp=>`${String(stamp??'').slice(0,10)} ${String(stamp??'').slice(11,16)}`.trim();
// علامة الوجود والحضور: الرمز للعين وحدها، والكلمة للقارئ الآلي، فما تُقرأ «علامة صح» ولا «دائرة بيضاء».
const mark=(on,yes,no)=>`<span aria-hidden="true">${on?'✓':'○'}</span><span class="sr-only">${on?yes:no}: </span>`;

// سطر الاعتماد الإلكتروني: هو اللي حلّ محل التوقيع، فيُعرض بصيغة واحدة في كل الشاشات.
const approvals=(e,rows,expected=Object.keys(SIDES))=>`<ul class="vn-list">${expected.map(side=>{
  const row=rows.find(a=>a.side===side);
  return `<li><strong>${e(SIDES[side])}</strong>${row?`<span>${e(row.label)}</span><small>${e(row.statement)}</small>`:'<span class="vn-flag is-pending">ما انعتمد للحين</span>'}</li>`;
}).join('')}</ul>`;
const history=(e,rows)=>rows?.length?`<details class="vn-block"><summary>سجل النسخ (${e(rows.length)})</summary><ul class="vn-list">${rows.map(h=>`<li><strong>${e(h.action)}</strong><span>${e(h.by_name)} · <time datetime="${e(h.at)}">${e(at(h.at))}</time></span>${h.note?`<small>${e(h.note)}</small>`:''}</li>`).join('')}</ul></details>`:'';
// قراءة البوابة قرار ما يملكه غير صاحبه: يُعرض سؤالًا ينتظر جوابه، بقراءتيه وسند كل وحدة، وما يقرره الحساب اللي ما يملكه.
const conflictPanel=(e,data)=>`<details class="vn-block"><summary>${data.gate_reading_set?'قراءة البوابة مقرّة':'قرار ينتظر'}: ${e(data.conflict.question)}</summary>
  <ul class="vn-list">${data.gate_readings.map(r=>`<li class="${data.gate_reading===r.key?'is-active':''}"><strong>${e(r.name)}${data.gate_reading===r.key?' — السارية':''}</strong><span>${e(r.source)}</span><small>${e(r.effect)}</small></li>`).join('')}</ul>
  <p class="subtle measure">${e(data.conflict.source_proposal)}</p><p class="subtle measure">${e(data.conflict.unresolved)}</p>
  ${data.gate_reading_set?`<p class="subtle measure">سند القراءة السارية: ${e(data.gate_reading_basis)}</p>`:'<p class="subtle">ما انحسم للحين، فالسارية القراءة المانعة.</p>'}</details>`;

/* ───── BD-04 — محضر تسليم المشروع ───── */
// المشروع المفتوح من صفقة رابحة (P4-CRM-2، CRM-09): نموذجه يُشتق من الصفقة واتفاقها وعرضها المقبول. لكل مشروع بلا محضر يُقرأ مصدره
// قبل الكتابة (/project-intake/handover-source)، فيُعرض ما جاء من الصفقة قراءةً، وما يمنع الحفظ يُقال برفضه المكتوب قبل الضغط.
async function handoverLoad(api){
  const board=await api('/project-intake');
  if(!board.can_hand_over)return board;
  const waiting=board.projects.filter(p=>!board.handovers.some(h=>h.project_id===p.id));
  const sources=await Promise.all(waiting.map(p=>api(`/project-intake/handover-source/${encodeURIComponent(p.id)}`).catch(()=>null)));
  return {...board,sources:Object.fromEntries(waiting.map((p,i)=>[p.id,sources[i]]).filter(([,source])=>source))};
}
// مشاريع النموذج المكتوب: ما له مصدر غير مشتق. ولبيانات بلا مصادر (شكل اللوحة القديم) تبقى المشاريع كلها كما كانت.
const typedProjects=data=>data.sources?data.projects.filter(p=>data.sources[p.id]?.derived===false):data.projects;
const derivedProjects=data=>data.sources?data.projects.filter(p=>data.sources[p.id]?.derived):[];
const riyal=minor=>`${(Number(minor)/100).toFixed(2)} ريال`;
// ما يجي من الصفقة سطرُ قراءة في النموذج: حقل مخفي بلا تحكم ولا علامة إلزام، تسميته ما هو ونصه قيمته (مهرَّبة عند الرسم).
const shown=(name,label,hint)=>field(name,label,'hidden',{required:false,value:'',hint});
// مدير المشروع المسند: عضو في المشروع بدور مدير أو مدير مشروع، غير المسلِّم. بلا أحد منهم يرفض الخادم الحفظ، فلا يُرسم الزر.
const assignable=(data,p)=>p.members.filter(m=>['manager','pm'].includes(m.role)&&m.id!==data.user_id).map(m=>({value:m.id,label:m.name}));
function derivedForm(data,p,s){
  const money=minor=>data.finance_hidden?'— (المبالغ لصاحب الصلاحية المالية)':riyal(minor);
  const dates=s.milestones.map(m=>m.due_on).filter(Boolean).sort();
  const managers=assignable(data,p);
  return {title:`محضر تسليم المشروع (BD-04) — ${p.name}`,endpoint:'/project-intake/handovers',idempotent:true,fields:[
    shown('from_client','العميل',`${s.client.code} — ${s.client.name}`),
    shown('from_contract','مرجع العقد',s.contract_reference),
    shown('from_value','قيمة العقد شاملة الضريبة',money(s.contract_value_minor)),
    shown('from_advance','الدفعة المقدمة',s.advance_minor?money(s.advance_minor):'ما في جدول الدفعات دفعة مقدمة'),
    shown('from_services','الخدمات المتفق عليها',s.services.join('، ')),
    shown('from_deliverables','المخرجات وجولات المراجعة',s.deliverables.map(d=>`${d.name} × ${d.quantity} · ${d.revision_rounds} جولة مراجعة من البند ${d.position}`).join('؛ ')),
    shown('from_milestones','المحطات',s.milestones.map(m=>`${m.name} ${m.due_on}`).join('؛ ')),
    shown('from_terms','جدول الدفعات',s.payment_terms.map(t=>`${t.label} ${money(t.amount_minor)}${t.due_on?` تستحق ${t.due_on}`:''}${t.is_advance?' (مقدمة)':''}`).join('؛ ')),
    shown('from_contacts','جهات التواصل عند العميل',s.client_contacts.map(c=>`${c.name} — ${c.title}`).join('، ')),
    field('project_manager_id','مدير المشروع المسند','select',{options:managers,hint:'شخص غيرك: اللي يسلّم ما يستلم. من أعضاء المشروع بدور مدير أو مدير مشروع.'}),
    field('contract_signed_on','تاريخ توقيع العقد','date',{hint:'اليوم اللي انوقّع فيه العقد فعلًا.'}),
    field('kickoff_planned_on','تاريخ اجتماع الانطلاق المخطط','date',{required:false,hint:'اتركه فاضي إذا ما تحدد للحين.'}),
    ...(s.advance_minor?[field('advance_claimed_on','تاريخ تأكيد الدفعة المقدمة عند تطوير الأعمال','date')]:[]),
    ...(s.client_contacts.length>1?[field('primary_contact_id','جهة التواصل الرئيسية','select',{options:s.client_contacts.map(c=>({value:c.id,label:`${c.name} — ${c.title}`})),hint:'وحدة بس؛ ثنتين يعني ولا أحد عند أول خلاف.'})]:[]),
    field('channels','قنوات التواصل المتفق عليها','textarea'),
    field('timeline_start','بداية الجدول الزمني','date',{hint:dates.length?`لازم يشمل مواعيد الاتفاق: من ${dates[0]} لين ${dates.at(-1)}.`:undefined}),field('timeline_end','نهايته','date'),
    field('risks','نقاط المخاطرة المحتملة','textarea',{required:false}),
    field('special_requirements','متطلبات خاصة من العميل','textarea',{required:false})
  ],toPayload:v=>({project_id:p.id,project_manager_id:v.project_manager_id,contract_signed_on:v.contract_signed_on,kickoff_planned_on:v.kickoff_planned_on||undefined,
    ...(s.advance_minor?{advance_claimed_on:v.advance_claimed_on}:{}),...(s.client_contacts.length>1?{primary_contact_id:v.primary_contact_id}:{}),
    channels:v.channels,timeline_start:v.timeline_start,timeline_end:v.timeline_end,risks:v.risks||'',special_requirements:v.special_requirements||''})};
}
export const handoverUI={
  title:'محضر تسليم المشروع (BD-04)',
  description:'تسليم داخلي من تطوير الأعمال للتنفيذ: قيمة العقد والدفعة المقدمة وتاريخ تأكيدها، ومدير المشروع المسند، والخدمات والمخرجات والجدول وجهات التواصل والمخاطر والمتطلبات الخاصة وجدول الدفعات بشروطه. يعتمده الطرفان إلكترونيًا، كل طرف باسمه.',
  load:handoverLoad,
  render(data,{e,button,money,ui=kit(e)}){
    const card=h=>{
      const [tone,word]=HANDOVER_STATUS[h.status]??['',h.status];
      return `<details class="vn-card"${h.status==='draft'?' open':''}><summary><span class="vn-code"><bdi>${e(h.contract_reference)}</bdi></span><span class="vn-name"><strong>${e(h.project_name)}</strong><small>${e(h.client_name)} · وقّع العقد ${e(h.contract_signed_on)}</small></span><span class="vn-flags"><span class="badge ${tone}">${e(word)}</span></span></summary>
      <div class="vn-body">
        <div class="vn-tiles">${ui.tile(h.finance_hidden?'—':money(h.contract_value_minor),'قيمة العقد')}${ui.tile(h.finance_hidden?'—':money(h.advance_minor),`الدفعة المقدمة${h.advance_claimed_on?` · أكدتها الأعمال ${h.advance_claimed_on}`:''}`)}</div>
        ${h.finance_hidden?'<p class="subtle">المبالغ تطلع لصاحب الصلاحية المالية بس؛ هنا تشوف النطاق بدون أرقام.</p>':''}
        <dl class="detail-data"><div><dt>مدير المشروع المسند</dt><dd>${e(h.project_manager_name)}</dd></div><div><dt>الجدول الزمني</dt><dd>${e(h.timeline_start)} لين ${e(h.effective_timeline_end)}${h.schedule_shift_days?` · انزاح ${e(h.schedule_shift_days)} يوم بطلبات تغيير`:''}</dd></div></dl>
        ${h.actions.length?`<div class="operation-actions">${h.actions.map(a=>button(a,h.id,{approve_handover:'اعتماد المحضر',receive_handover:'استلام المشروع (PM-01)'}[a])).join('')}</div>`:''}
        <section class="vn-block"><h3>اعتماد الطرفين</h3>${approvals(e,h.approvals)}</section>
        <section class="vn-block"><h3>الخدمات المتفق عليها</h3><ul class="vn-list">${h.services.map(s=>`<li><strong>${e(s)}</strong></li>`).join('')}</ul></section>
        <section class="vn-block"><h3>المخرجات وجولات المراجعة</h3><ul class="vn-list">${h.deliverables.map(d=>`<li class="${d.exhausted?'is-due':''}"><strong>${e(d.name)} · ${e(d.quantity)} ${e(d.unit)}</strong><span>${e(d.used_rounds)} من ${e(d.revision_rounds)} جولة${d.exhausted?' — خلصت':''}</span><small>${e(d.rounds_note)}</small><small>القبول: ${e(d.acceptance)}</small>${!d.rounds_confirmed&&h.actions.length?`<div class="operation-actions">${button('confirm_rounds',d.id,'تأكيد الجولات من العقد')}</div>`:''}</li>`).join('')}</ul></section>
        <section class="vn-block"><h3>المحطات</h3><ul class="vn-list">${h.milestones.map(m=>`<li><strong>${e(m.name)}</strong><span><time datetime="${e(m.due_on)}">${e(m.due_on)}</time></span></li>`).join('')}</ul></section>
        <section class="vn-block"><h3>جدول الدفعات وشروط استحقاقها</h3>${ui.table({head:['المرحلة','القيمة','الاستحقاق','شرط الاستحقاق','الحالة'],rows:h.payment_terms.map(t=>`<tr><td>${e(t.label)}${t.is_advance?' · مقدمة':''}</td><td>${h.finance_hidden?'—':money(t.amount_minor)}</td><td>${e(t.due_on??'—')}</td><td>${e(t.condition)}</td><td>${e({planned:'مخططة',due:'مستحقة',received:'مستلمة'}[t.term_status])}</td></tr>`),empty:'ما فيه دفعات مسجلة'})}</section>
        <section class="vn-block"><h3>جهات التواصل</h3><ul class="vn-list">${h.client_contacts.map(c=>`<li><strong>${e(c.name)}${c.is_primary?' — الرئيسية':''}</strong><span>${e(c.title)}</span>${c.email||c.phone?`<small>${[c.email?`<bdi>${e(c.email)}</bdi>`:'',c.phone?`<bdi>${e(c.phone)}</bdi>`:''].filter(Boolean).join(' · ')}</small>`:''}</li>`).join('')}</ul><p class="subtle">القنوات: ${e(h.channels)}</p></section>
        ${h.risks?`<section class="vn-block"><h3>نقاط المخاطرة</h3><p class="measure">${e(h.risks)}</p></section>`:''}
        ${h.special_requirements?`<section class="vn-block"><h3>متطلبات خاصة من العميل</h3><p class="measure">${e(h.special_requirements)}</p></section>`:''}
        ${history(e,h.history)}
      </div></details>`;
    };
    // ما ينتظر القارئ أولًا: المشاريع المفتوحة من صفقات رابحة وما لها محضر. الجاهز زرٌّ، والممنوع رفضه المكتوب (ما الناقص وعند من والخطوة).
    const derived=data.can_hand_over?derivedProjects(data):[];
    const awaiting=derived.length?`<section class="panel panel-body"><h2>مشاريع من صفقات تنتظر محضر التسليم</h2><ul class="vn-list">${derived.map(p=>{const s=data.sources[p.id];
      return `<li class="${s.blockers.length?'is-late':'is-due'}"><strong>${e(p.name)}</strong><span>${e(s.contract_reference)}${s.client?` · العميل <bdi>${e(s.client.code)}</bdi> ${e(s.client.name)}`:''}</span>`
        +(s.blockers.length?s.blockers.map(b=>ui.refusal(b)).join(''):assignable(data,p).length?`<div class="operation-actions">${button('create_handover',p.id,'إعداد محضر التسليم')}</div>`
          :'<p class="subtle">ما فيه مدير مشروع يستلم: أضف لأعضاء المشروع مدير أو مدير مشروع غيرك، وبعدها جهّز المحضر.</p>')+'</li>';}).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.can_hand_over&&typedProjects(data).length&&data.clients.length?`<div class="operation-actions">${button('create_handover','','محضر تسليم جديد')}</div>`:awaiting?'':'<p class="subtle">محضر التسليم يعدّه صاحب صلاحية تسليم الأعمال في مشروع وعميل هو عضو فيهم.</p>'}</section>
      ${awaiting}${data.handovers.length?data.handovers.map(card).join(''):ui.empty('ما فيه محاضر تسليم في مشاريعك للحين','أول ما ينعدّ محضر تسليم لمشروع أنت عضو فيه يطلع هنا.')}`;
  },
  form(action,id,data){
    if(action==='create_handover'&&id){
      const p=data.projects.find(x=>x.id===id),s=data.sources?.[id];
      guard(data.can_hand_over&&p&&s?.derived&&!s.blockers.length&&assignable(data,p).length);
      return derivedForm(data,p,s);
    }
    if(action==='create_handover'){
      const projects=typedProjects(data);
      guard(data.can_hand_over&&projects.length&&data.clients.length);
      return {title:'محضر تسليم المشروع (BD-04)',endpoint:'/project-intake/handovers',idempotent:true,fields:[
        field('project_id','المشروع','select',{options:projects.map(p=>({value:p.id,label:p.name}))}),
        field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:c.name}))}),
        field('contract_reference','مرجع العقد أو العرض المعتمد'),
        field('contract_signed_on','تاريخ توقيع العقد','date'),
        field('kickoff_planned_on','تاريخ اجتماع الانطلاق المخطط','date',{required:false,hint:'اتركه فاضي إذا ما تحدد للحين.'}),
        field('channels','قنوات التواصل المتفق عليها','textarea'),
        field('contract_value','قيمة العقد بالريال','text',{inputmode:'decimal'}),
        field('advance','الدفعة المقدمة المستلمة','text',{inputmode:'decimal',hint:'اكتب 0 إذا العقد ما فيه دفعة مقدمة. تأكيد المالية وثيقة لحالها في قائمة PM-01.'}),
        field('advance_claimed_on','تاريخ استلامها حسب تطوير الأعمال','date',{required:false}),
        // القائمة من أعضاء مشاريعك بدور مدير أو مدير مشروع؛ والخادم يرفض من ليس عضوًا في المشروع المختار بعينه.
        field('project_manager_id','مدير المشروع المسند','select',{hint:'شخص غيرك: اللي يسلّم ما يستلم. ولازم يكون عضو في المشروع المختار بدور مدير أو مدير مشروع.',
          options:[...new Map(projects.flatMap(p=>p.members.filter(m=>['manager','pm'].includes(m.role)&&m.id!==data.user_id).map(m=>[m.id,{value:m.id,label:`${m.name} — ${p.name}`}])).map(([k,x])=>[k,x])).values()]}),
        field('services','الخدمات المتفق عليها','rows',{maxRows:30,columns:[{name:'service',label:'الخدمة'}]}),
        field('deliverables','المخرجات الرئيسية','rows',{maxRows:60,hint:'جولات المراجعة تنعدّ لكل مخرج لحاله. «من العقد» تحتاج بند العقد، و«افتراضي قالب» يبقى ينتظر التأكيد وما تنحسب عليه جولة زيادة.',
          columns:[{name:'name',label:'المخرج'},{name:'unit',label:'الوحدة',required:false},{name:'quantity',label:'الكمية',type:'number',min:1,value:1},
            {name:'acceptance',label:'معيار القبول'},{name:'revision_rounds',label:'جولات المراجعة',type:'number',min:0,max:20,value:2},
            {name:'rounds_source',label:'مصدر العدد',type:'select',options:[{value:'contract',label:'من العقد'},{value:'template_default',label:'افتراضي قالب'}]},
            {name:'rounds_basis',label:'بند العقد',required:false}]}),
        field('timeline_start','بداية الجدول الزمني','date'),field('timeline_end','نهايته','date'),
        field('milestones','المحطات','rows',{maxRows:40,columns:[{name:'name',label:'المحطة'},{name:'due_on',label:'تاريخها',type:'date'}]}),
        field('client_contacts','جهات التواصل عند العميل','rows',{maxRows:20,hint:'حدد جهة تواصل رئيسية وحدة؛ ثنتين يعني ولا أحد عند أول خلاف.',
          columns:[{name:'name',label:'الاسم'},{name:'title',label:'الصفة'},{name:'email',label:'البريد',required:false},{name:'phone',label:'الهاتف',required:false},
            {name:'is_primary',label:'رئيسية',type:'select',options:[{value:'no',label:'لا'},{value:'yes',label:'نعم'}]}]}),
        field('risks','نقاط المخاطرة المحتملة','textarea',{required:false}),
        field('special_requirements','متطلبات خاصة من العميل','textarea',{required:false}),
        field('payment_terms','جدول الدفعات','rows',{maxRows:40,hint:'المجموع لازم يساوي قيمة العقد. الدفعة اللي بلا شرط استحقاق تصير خلاف وقت التحصيل.',
          columns:[{name:'label',label:'المرحلة'},{name:'amount',label:'القيمة'},{name:'due_on',label:'الاستحقاق',type:'date',required:false},
            {name:'condition',label:'شرط الاستحقاق'},
            {name:'term_status',label:'الحالة',type:'select',options:[{value:'planned',label:'مخططة'},{value:'due',label:'مستحقة'},{value:'received',label:'مستلمة'}]},
            {name:'notes',label:'ملاحظات',required:false},
            {name:'is_advance',label:'مقدمة',type:'select',options:[{value:'no',label:'لا'},{value:'yes',label:'نعم'}]}]})
      ],toPayload:v=>({project_id:v.project_id,client_id:v.client_id,contract_reference:v.contract_reference,
        contract_signed_on:v.contract_signed_on,kickoff_planned_on:v.kickoff_planned_on||undefined,channels:v.channels,
        contract_value:String(v.contract_value).trim(),advance:String(v.advance).trim(),
        advance_claimed_on:v.advance_claimed_on||undefined,project_manager_id:v.project_manager_id,
        services:v.services.map(s=>s.service),
        deliverables:v.deliverables.map(d=>({...d,quantity:Number(d.quantity),revision_rounds:Number(d.revision_rounds)})),
        timeline_start:v.timeline_start,timeline_end:v.timeline_end,milestones:v.milestones,
        client_contacts:v.client_contacts.map(c=>({...c,is_primary:c.is_primary==='yes'})),
        risks:v.risks||'',special_requirements:v.special_requirements||'',
        payment_terms:v.payment_terms.map(t=>({...t,amount:String(t.amount).trim(),due_on:t.due_on||undefined,is_advance:t.is_advance==='yes'}))})};
    }
    if(action==='confirm_rounds'){
      const deliverable=data.handovers.flatMap(h=>h.deliverables).find(d=>d.id===id);guard(deliverable);
      return {title:`تأكيد جولات — ${deliverable.name}`,endpoint:`/project-intake/deliverables/${id}/confirm_rounds`,fields:[
        field('revision_rounds','جولات المراجعة حسب العقد','number',{min:0,max:20,value:deliverable.revision_rounds}),
        field('basis','بند العقد اللي يحدد جولات هالمخرج','textarea',{hint:'الرقم الافتراضي من DS-03 (سجل تعديلات التصميم). أكّده من العقد.'})
      ],toPayload:v=>({version:deliverable.version,revision_rounds:Number(v.revision_rounds),basis:v.basis})};
    }
    const h=data.handovers.find(x=>x.id===id);guard(h&&h.actions.includes(action));
    if(action==='approve_handover')return {title:`اعتماد المحضر — ${h.project_name}`,endpoint:`/project-intake/handovers/${id}/approve_handover`,
      fields:[field('statement','وش تقرّ فيه باعتمادك','textarea',{hint:'ينحفظ باسمك ودورك ووقته. ما فيه توقيع ورقي ولا صورة توقيع.'})],
      toPayload:v=>({version:h.version,statement:v.statement})};
    return {title:`استلام المشروع (PM-01) — ${h.project_name}`,endpoint:`/project-intake/handovers/${id}/receive_handover`,
      fields:[field('note','وش استلمت، ووش الناقص في نظرك','textarea')],toPayload:v=>({version:h.version,note:v.note})};
  }
};

/* ───── PM-01 — محضر استلام المشروع وبوابته ───── */
export const projectReceiptUI={
  title:'استلام المشروع وبوابته (PM-01)',
  description:'قائمة الوثائق الثماني بحالة كل وثيقة ومين يقدّمها، واعتماد المحضر من طرفيه، وحالة البوابة. التنفيذ المدفوع ما يبدأ قبل اكتمال الوثائق الإلزامية وتأكيد المالية للدفعة المقدمة واعتماد المحضر؛ والتحديد والدراسة مسموحة.',
  load,
  render(data,{e,button,money,ui=kit(e)}){
    // البوابة أول البطاقة: الناقص وعند مين، لأنه الخطوة الجاية.
    const gateBox=r=>{
      const g=r.gate,rows=g.blocked?g.refusals:g.advisory;
      return `<div class="${g.blocked?'vn-alert is-block':'vn-block'}"><strong>${g.blocked?'التنفيذ المدفوع واقف لين يكتمل الناقص':'التنفيذ المدفوع مسموح'} · القراءة السارية: ${e(g.reading_name)}</strong>
        ${rows.length?`<ul class="vn-list">${rows.map(x=>`<li><strong>${e(x.document)}</strong><span>يقدّمها: ${e(x.owner)}</span><small>${e(x.why)}</small></li>`).join('')}</ul>`:'<p>ما فيه ناقص في قائمة الاستلام.</p>'}
        <p class="subtle">${e(g.scoping_note)}</p>
        <p class="subtle">الدفعة المقدمة: ${r.gate.advance?`المتفق عليه ${money(g.advance.agreed_minor)} · ${g.advance.confirmed_minor===null?'ما أكدتها المالية للحين':`أكدت المالية ${money(g.advance.confirmed_minor)} في ${e(g.advance.confirmed_on)}`}`:'—'}</p></div>`;
    };
    const card=r=>`<details class="vn-card" open><summary><span class="vn-code">محضر ${e(r.number)}</span><span class="vn-name"><strong>${e(r.gate.project_name)}</strong><small>استلمه ${e(r.received_by_name)} في ${e(r.received_on)}</small></span><span class="vn-flags"><span class="badge ${r.status==='executing'?'in_progress':'pending'}">${e(r.status==='executing'?'التنفيذ جارٍ':'ينتظر البوابة')}</span></span></summary>
      <div class="vn-body">
        ${gateBox(r)}
        ${r.actions.some(a=>['approve_receipt','start_execution'].includes(a))?`<div class="operation-actions">${r.actions.filter(a=>['approve_receipt','start_execution'].includes(a)).map(a=>button(a,r.id,{approve_receipt:'اعتماد المحضر',start_execution:'تسجيل بدء التنفيذ'}[a])).join('')}</div>`:''}
        <section class="vn-block"><h3>قائمة الوثائق الثماني</h3><ul class="vn-list">${r.documents.map(d=>`<li class="${d.status==='present'?'':'is-missing'}"><strong>${mark(d.status==='present','موجودة','ناقصة')}${e(d.name)}${d.required?'':' — مشروطة'}</strong><span>${d.status==='present'?e(d.reference):`يقدّمها: ${e(d.owner_name)} (${e(d.owner_role_name)})`}</span>${d.status==='present'&&d.confirmed_on?`<small>تأكيد ${e(d.confirmed_on)}${d.amount_minor===null?'':` بمبلغ ${money(d.amount_minor)}`}</small>`:''}${d.reopened_reason?`<small>انفتحت من جديد: ${e(d.reopened_reason)}</small>`:''}${d.actions.includes('provide_document')?`<div class="operation-actions">${button('provide_document',`${r.id}:${d.doc_key}`,'تسجيل الوثيقة')}</div>`:''}</li>`).join('')}</ul>
        ${r.form?`<p class="subtle">النموذج في دليل الخدمات: <a href="${e(r.form.catalogue_link)}">${e(r.form.title||r.form.form_key)}</a> (<bdi>${e(r.form.aliases.join(' · '))}</bdi>)</p>`:''}</section>
        <section class="vn-block"><h3>اعتماد المحضر</h3>${approvals(e,r.approvals)}</section>
        ${r.execution_started_at?`<section class="vn-block"><h3>بدء التنفيذ</h3><p><time datetime="${e(r.execution_started_at)}">${e(at(r.execution_started_at))}</time></p><p class="subtle measure">${e(r.execution_basis)}</p></section>`:''}
        ${history(e,r.history)}
      </div></details>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${conflictPanel(e,data)}
      ${data.can_set_reading?`<div class="operation-actions">${button('set_reading','','تحديد قراءة البوابة')}</div>`:''}</section>
      ${data.receipts.length?data.receipts.map(card).join(''):ui.empty('ما فيه مشاريع مستلمة عندك للحين','المشروع يطلع هنا بعد ما يستلمه مدير المشروع من محضر التسليم.')}`;
  },
  form(action,id,data){
    if(action==='set_reading'){
      guard(data.can_set_reading);
      return {title:'قراءة بوابة الاستلام',endpoint:'/project-intake/settings',fields:[
        field('gate_reading','القراءة السارية','select',{value:data.gate_reading,options:data.gate_readings.map(r=>({value:r.key,label:r.name}))}),
        field('basis','سند القرار: مين أقرّه ومتى وأي المصدرين رجّح','textarea',{hint:'المصدرين من الشركة ويتعارضون. القرار قرارك، والتعارض يبقى ظاهر في الشاشة.'}),
        field('confirmed_on','تاريخ الإقرار','date',{value:data.today})
      ],toPayload:v=>v};
    }
    if(action==='provide_document'){
      const [receiptId,docKey]=String(id).split(':'),r=data.receipts.find(x=>x.id===receiptId);guard(r);
      const doc=r.documents.find(d=>d.doc_key===docKey);guard(doc&&doc.actions.includes('provide_document'));
      // «ملف التسعير المعتمد ماليًا» يُختار من أوراق التسعير المعتمدة لهذا العميل، ولا يُكتب مرجعه نصًا:
      // الاعتماد يُقرأ من الورقة ومقاعدها (ترحيل 113). بلا ورقة معتمدة لا خانة تُملأ، وتُقال العلة.
      if(docKey==='approved_pricing'){
        const options=(r.pricing_options||[]).map(o=>({value:o.id,label:`${o.code} — ${o.name} · انعتمدت ${String(o.decided_at||'').slice(0,10)}`}));
        return {title:`تسجيل — ${doc.name}`,endpoint:`/project-intake/receipts/${receiptId}/provide_document`,
          fields:[field('pricing_sheet_id','ورقة التسعير المعتمدة','select',{options,
            hint:options.length?'المرجع ينأخذ من الورقة نفسها: رقمها واسمها وتاريخ اعتمادها. ما ينكتب هنا نص.'
              :'ما فيه ورقة تسعير معتمدة لهالعميل للحين. تنعتمد الورقة من شاشة «تسعير المشاريع»، وبعدين تنسجل هنا.'})],
          toPayload:v=>({doc_key:docKey,version:doc.version,pricing_sheet_id:v.pricing_sheet_id})};
      }
      const fields=[field('reference','مرجع الوثيقة ومكان حفظ أصلها','textarea',{hint:'وين انحفظ الأصل وبأي رقم.'})];
      if(docKey==='advance_confirmation')fields.push(
        field('amount','المبلغ اللي أكدته المالية','text',{inputmode:'decimal',hint:'اكتب 0 إذا أكدت المالية إن العقد بلا دفعة مقدمة. المبلغ الأقل من المتفق عليه يخلي البوابة مقفلة.'}),
        field('confirmed_on','تاريخ التأكيد','date',{value:data.today}));
      return {title:`تسجيل — ${doc.name}`,endpoint:`/project-intake/receipts/${receiptId}/provide_document`,fields,
        toPayload:v=>({doc_key:docKey,version:doc.version,reference:v.reference,
          ...(docKey==='advance_confirmation'?{amount:String(v.amount).trim(),confirmed_on:v.confirmed_on}:{})})};
    }
    const r=data.receipts.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='approve_receipt')return {title:`اعتماد محضر الاستلام — محضر ${r.number}`,endpoint:`/project-intake/receipts/${id}/approve_receipt`,
      fields:[field('statement','وش تقرّ فيه باعتمادك','textarea',{hint:'لازم تأكيد الدفعة واعتماد المحضر مع بعض، مو واحد منهم بس.'})],
      toPayload:v=>({version:r.version,statement:v.statement})};
    return {title:`تسجيل بدء التنفيذ — محضر ${r.number}`,endpoint:`/project-intake/receipts/${id}/start_execution`,
      fields:[field('basis','سند بدء التنفيذ: على أي أساس بدأ ومتى','textarea')],toPayload:v=>({version:r.version,basis:v.basis})};
  }
};

/* ───── PM-02 — محضر اجتماع الانطلاق ───── */
export const kickoffUI={
  title:'محضر اجتماع الانطلاق (PM-02)',
  description:'الحضور من دليل المنصة لجهة الشركة وبأسماء وجهات لحضور العميل، والنطاق النهائي والمخرجات والمحطات وجولات التعديل والاجتماعات الدورية ومدة رد العميل والقناة الرسمية، والنقاط اللي توضَّح للعميل: التعديلات والتأخير والنشر والإلغاء.',
  load,
  render(data,{e,button,ui=kit(e)}){
    const card=r=>{
      const k=r.kickoff;
      if(!k)return `<section class="panel panel-body"><h2>${e(r.gate.project_name)}</h2><p class="subtle">ما انسجل محضر انطلاق لهالمشروع للحين. المحضر هو البند الثالث في قائمة PM-01.</p>${r.actions.includes('record_kickoff')?`<div class="operation-actions">${button('record_kickoff',r.id,'تسجيل محضر الانطلاق')}</div>`:''}</section>`;
      const side=name=>k.attendees.filter(a=>a.side===name);
      return `<details class="vn-card" open><summary><span class="vn-code">${e(k.held_on)}</span><span class="vn-name"><strong>${e(r.gate.project_name)}</strong><small>${e(k.mode_name)} · القناة الرسمية ${e(k.official_channel)}</small></span><span class="vn-flags"><span class="badge approved">مسجَّل</span></span></summary>
        <div class="vn-body">
          <section class="vn-block"><h3>الحضور</h3>
            <h4>من الشركة</h4><ul class="vn-list">${side('company').map(a=>`<li><strong>${mark(a.attended,'حضر','ما حضر')}${e(a.name)}</strong><span>${e(a.role_name)}${a.title?` · ${e(a.title)}`:''}</span><small>${e(a.organisation)}</small></li>`).join('')}</ul>
            <h4>من العميل</h4><ul class="vn-list">${side('client').map(a=>`<li><strong>${mark(a.attended,'حضر','ما حضر')}${e(a.name)}</strong><span>${e(a.title)}</span><small>${e(a.organisation)}</small></li>`).join('')}</ul>
            <p class="subtle">جهة التواصل عند العميل: ${e(k.client_contact_name)}.</p></section>
          <section class="vn-block"><h3>الاتفاقيات</h3><ul class="vn-list">
            <li><strong>نطاق العمل النهائي</strong><span>${e(k.agreed_scope)}</span></li>
            <li><strong>المخرجات</strong><span>${e(k.deliverables_note)}</span></li>
            <li><strong>المحطات</strong><span>${k.milestones.map(m=>`${e(m.name)} — <time datetime="${e(m.due_on)}">${e(m.due_on)}</time>`).join(' · ')}</span></li>
            <li><strong>جولات التعديل</strong><span>${e(k.revision_rounds_note)}</span></li>
            <li><strong>الاجتماعات الدورية</strong><span>${e(k.recurring_meetings)}</span></li>
            <li><strong>سياسة الموافقة ومدة الرد</strong><span>${e(k.approval_policy)} · مدة رد العميل ${e(k.client_response_days)} أيام</span></li>
            ${k.special_constraints?`<li><strong>متطلبات أو قيود خاصة</strong><span>${e(k.special_constraints)}</span></li>`:''}
          </ul></section>
          <section class="vn-block"><h3>وش انوضح للعميل</h3><ul class="vn-list">
            <li><strong>سياسة التعديلات داخل النطاق وبرّاه</strong><span>${e(k.revision_policy)}</span></li>
            <li class="${k.written_changes_only?'':'is-due'}"><strong>طلب التعديلات كتابي بس</strong><span>${k.written_changes_only?'انوضح وأقرّ فيه العميل':'ما انقرّ في هالمحضر'}</span></li>
            <li><strong>الموافقة قبل النشر</strong><span>${e(k.publication_policy)}</span></li>
            <li><strong>تأخر التسليم من جهة العميل</strong><span>${e(k.delay_policy)}</span></li>
            <li><strong>سياسة الإلغاء والغرامات</strong><span>${e(k.cancellation_policy)}</span></li>
          </ul></section>
          <section class="vn-block"><h3>الإثبات</h3><p>${e(k.recorded_label)}</p>${k.client_acknowledgement?`<p class="subtle">تأكيد العميل: ${e(k.client_acknowledgement)}</p>`:'<p class="subtle">ما انسجل مرجع لتأكيد العميل على المحضر.</p>'}</section>
          ${history(e,k.history)}
        </div></details>`;
    };
    return `<section class="panel panel-body vn-head"><p>المحضر سجل لاللي انقال: ما يتعدل بعد ما ينحفظ، وتصحيحه يكون بطلب تغيير.</p></section>
      ${data.receipts.length?data.receipts.map(card).join(''):ui.empty('ما فيه مشاريع مستلمة عندك للحين','محضر الانطلاق ينسجل للمشروع بعد استلامه في قائمة PM-01.')}`;
  },
  form(action,id,data){
    const r=data.receipts.find(x=>x.id===id);guard(r&&r.actions.includes('record_kickoff'));
    const project=data.projects.find(p=>p.id===r.gate.project_id);
    return {title:`محضر اجتماع الانطلاق — ${r.gate.project_name}`,endpoint:`/project-intake/receipts/${id}/record_kickoff`,idempotent:true,fields:[
      field('held_on','تاريخ الاجتماع','date',{value:data.today}),
      field('mode','طريقة الاجتماع','select',{options:Object.entries(data.meeting_modes).map(([value,label])=>({value,label}))}),
      field('client_contact_name','جهة التواصل عند العميل'),
      field('company_attendees','الحاضرين من الشركة','checks',{options:(project?.members??[]).map(m=>({value:m.id,label:m.name})),hint:'تختارهم من دليل المنصة، فيجي اسم كل واحد ودوره من سجله.'}),
      field('client_attendees','الحاضرين من العميل','rows',{maxRows:20,columns:[{name:'name',label:'الاسم'},{name:'title',label:'الصفة',required:false},{name:'organisation',label:'الجهة'}],hint:'العميل ما يدخل المنصة؛ اكتب اسمه وصفته وجهته.'}),
      field('agreed_scope','نطاق العمل النهائي','textarea'),
      field('deliverables_note','المخرجات زي ما انقرّت','textarea'),
      field('milestones','الجدول والمعالم','rows',{maxRows:40,columns:[{name:'name',label:'المحطة'},{name:'due_on',label:'تاريخها',type:'date'}]}),
      field('revision_rounds_note','عدد جولات التعديل زي ما انقرّت','textarea'),
      field('recurring_meetings','موعد اجتماعات المتابعة وطريقتها','textarea'),
      field('approval_policy','سياسة الموافقة على المخرجات','textarea'),
      field('client_response_days','مدة رد العميل بالأيام','number',{min:1,max:30,value:3}),
      field('official_channel','قناة التواصل الرسمية'),
      field('special_constraints','متطلبات أو قيود خاصة','textarea',{required:false}),
      field('revision_policy','سياسة التعديلات داخل النطاق وبرّاه','textarea'),
      field('written_changes_only','انوضح للعميل إن طلب التعديلات كتابي بس','checkbox',{required:false,hint:'إقرار صريح إن النقطة انوضحت للعميل.'}),
      field('delay_policy','سياسة تأخر التسليم من جهة العميل','textarea'),
      field('publication_policy','سياسة الموافقة قبل النشر','textarea'),
      field('cancellation_policy','سياسة الإلغاء والغرامات حسب العقد','textarea'),
      field('client_acknowledgement','كيف أكد العميل المحضر ووين انحفظ دليله','textarea',{required:false})
    ],toPayload:v=>({held_on:v.held_on,mode:v.mode,client_contact_name:v.client_contact_name,
      attendees:[...v.company_attendees.map(uid=>({side:'company',user_id:uid,name:'',title:'',organisation:'',attended:true})),
        ...v.client_attendees.map(a=>({side:'client',user_id:'',name:a.name,title:a.title||'',organisation:a.organisation,attended:true}))],
      agreed_scope:v.agreed_scope,deliverables_note:v.deliverables_note,milestones:v.milestones,
      revision_rounds_note:v.revision_rounds_note,recurring_meetings:v.recurring_meetings,approval_policy:v.approval_policy,
      client_response_days:Number(v.client_response_days),official_channel:v.official_channel,
      special_constraints:v.special_constraints||'',revision_policy:v.revision_policy,
      written_changes_only:v.written_changes_only==='on',
      delay_policy:v.delay_policy,publication_policy:v.publication_policy,cancellation_policy:v.cancellation_policy,
      client_acknowledgement:v.client_acknowledgement||''})};
  }
};

/* ───── PM-03 — طلب التغيير ───── */
const CHANGE_LABELS={decide_finance:'القرار المالي',record_client_approval:'توثيق موافقة العميل',apply_change:'تطبيق التغيير',decline_change:'اعتذار عن التغيير'};
export const changeRequestUI={
  title:'طلبات التغيير (PM-03)',
  description:'وصف التغيير وسببه والمخرج المتأثر ورقم الجولة وتصنيفه، وهل خلصت الجولات المجانية حسب سجل المنصة مو حسب الرأي، والأثر على الجدول والميزانية والتكلفة الزيادة وقرار المالية وموافقة العميل وتاريخ البدء.',
  load,
  render(data,{e,button,money,ui=kit(e)}){
    const card=(r,c)=>{
      const [tone,word]=CHANGE_STATUS[c.status]??['',c.status];
      const reopen=c.status==='applied'?c.reopened:c.will_reopen.map(k=>({doc_key:k,reason:'بينفتح وقت التطبيق'}));
      return `<details class="vn-card"${['raised','priced','approved'].includes(c.status)?' open':''}><summary><span class="vn-code">طلب ${e(c.number)}</span><span class="vn-name"><strong>${e(c.classification_name)}</strong><small>${e(r.gate.project_name)}${c.deliverable_name?` · ${e(c.deliverable_name)}`:''}${c.round_number?` · الجولة ${e(c.round_number)}`:''}</small></span><span class="vn-flags">${c.free_rounds_exhausted?'<span class="vn-flag is-block">خلصت الجولات المجانية</span>':''}<span class="badge ${tone}">${e(word)}</span></span></summary>
      <div class="vn-body">
        <p class="measure">${e(c.description)}</p><p class="subtle measure">السبب: ${e(c.reason)}</p>
        <p class="subtle measure">${e(c.classification_meaning)}</p>
        ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,`${r.id}:${c.id}`,CHANGE_LABELS[a])).join('')}</div>`:''}
        <div class="vn-tiles">${ui.tile(c.schedule_impact_days?`${c.schedule_impact_days} يوم`:'بلا أثر','الأثر على الجدول')}${ui.tile(c.budget_impact?(c.extra_cost_minor===null?'—':money(c.extra_cost_minor)):'بلا أثر','التكلفة الزيادة')}${ui.tile(`${c.added_rounds||0} / ${c.added_quantity||0}`,'جولات وكمية مضافة للمخرج')}</div>
        ${c.quotation_reference?`<p class="subtle">العرض المسعّر: <bdi>${e(c.quotation_reference)}</bdi></p>`:''}
        <section class="vn-block"><h3>الاعتمادات</h3><ul class="vn-list">
          <li class="${c.needs.finance&&!c.finance_decision?'is-pending':''}"><strong>القرار المالي</strong><span>${c.needs.finance?(c.finance_decision?(c.finance_decision==='approved'?'انعتمد':'انرفض'):'مطلوب وما صدر للحين'):'مو مطلوب: ما له أثر مالي'}</span>${c.finance_note?`<small>${e(c.finance_note)}</small>`:''}</li>
          <li class="${c.needs.client&&!c.client_approved_on?'is-pending':''}"><strong>موافقة العميل</strong><span>${c.needs.client?(c.client_approved_on?`وافق العميل <time datetime="${e(c.client_approved_on)}">${e(c.client_approved_on)}</time>`:'مطلوبة وما انوثقت للحين'):'مو مطلوبة: لا تكلفة ولا تغيير نطاق'}</span>${c.client_approval_reference?`<small>${e(c.client_approval_reference)}</small>`:''}</li>
          <li><strong>تطبيق التغيير</strong><span>${e(c.applied_label||'ما انطبق للحين')}</span>${c.start_date?`<small>بدأ التنفيذ ${e(c.start_date)}</small>`:''}</li>
        </ul></section>
        <section class="vn-block"><h3>وش ينفتح من جديد من اعتمادات الاستلام</h3>${reopen.length?`<ul class="vn-list">${reopen.map(x=>`<li><strong>${e(data.documents.find(d=>d.key===x.doc_key)?.name??x.doc_key)}</strong><span>${e(x.reason)}</span></li>`).join('')}</ul>`:'<p>هالتغيير ما يمس أي اعتماد.</p>'}</section>
        ${history(e,c.history)}
      </div></details>`;
    };
    const blocks=data.receipts.map(r=>`<section class="vn-group"><h2>${e(r.gate.project_name)} <span>${r.changes.length}</span></h2>
      <div class="operation-actions">${button('raise_change',r.id,'طلب تغيير جديد')}</div>
      ${r.changes.map(c=>card(r,c)).join('')||'<p class="subtle">ما فيه طلبات تغيير على هالمشروع.</p>'}</section>`).join('');
    const policy=data.classification_policy
      ?`<p>سياسة التصنيف معتمدة وسارية.</p><ul class="vn-list">${data.classification_policy.rules.map(r=>`<li><strong>${e(data.classifications.find(c=>c.key===r.classification)?.name??r.classification)}</strong><span>${e(r.test)}</span><small>${e(r.examples)}</small></li>`).join('')}</ul>`
      :`<div class="vn-alert"><strong>${data.classification_policy_draft?'سياسة التصنيف للحين مسودة تنتظر الاعتماد':'سياسة التصنيف ما انعدّت للحين'}</strong><p>لين تنعتمد، التصنيف على التعريفات الأربعة زي ما هي في نموذج الشركة.</p>${data.classification_policy_draft?.actions?.length?`<div class="operation-actions">${data.classification_policy_draft.actions.map(a=>button(a,data.classification_policy_draft.id,a==='approve_policy'?'اعتماد السياسة':'رفض المسودة')).join('')}</div>`:''}</div>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.classifications.map(c=>c.name).join(' · '))}. غلطتنا ما تنحسب على العميل، والجولة اللي تتعدى العقد يطلع لها عرض مسعّر مو شغل بالسكوت.</p>
      <details class="vn-block"><summary>سياسة تصنيف التغيير</summary>${policy}
      ${data.can_hand_over||data.can_set_reading?`<div class="operation-actions">${button('prepare_policy','','إعداد مسودة سياسة')}</div>`:''}</details></section>
      ${blocks||ui.empty('ما فيه مشاريع مستلمة عندك للحين','طلب التغيير ينرفع على مشروع استلمه مدير المشروع في قائمة PM-01.')}`;
  },
  form(action,id,data){
    if(action==='prepare_policy'){
      guard(data.can_hand_over||data.can_set_reading);
      return {title:'مسودة سياسة تصنيف التغيير',endpoint:'/project-intake/policy',idempotent:true,fields:[
        field('rules','التصنيفات الأربعة','rows',{minRows:4,maxRows:4,hint:'تبقى مسودة لين يعتمدها شخص غير اللي أعدّها.',
          value:data.classifications.map(c=>({classification:c.key,test:'',examples:''})),
          columns:[{name:'classification',label:'التصنيف',type:'select',options:data.classifications.map(c=>({value:c.key,label:c.name}))},
            {name:'test',label:'الاختبار اللي يميّزه'},{name:'examples',label:'مثالين من شغل الشركة'}]}),
        field('basis','مين أعدّ السياسة وعلى أي أساس','textarea')
      ],toPayload:v=>v};
    }
    if(action==='approve_policy'||action==='reject_policy'){
      guard(data.classification_policy_draft?.actions?.includes(action));
      return {title:action==='approve_policy'?'اعتماد سياسة التصنيف':'رفض المسودة',endpoint:`/project-intake/policy/${id}/${action}`,
        fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};
    }
    if(action==='raise_change'){
      const r=data.receipts.find(x=>x.id===id);guard(r);
      const deliverables=data.handovers.find(h=>h.id===r.handover_id)?.deliverables??[];
      return {title:`طلب تغيير — ${r.gate.project_name}`,endpoint:`/project-intake/receipts/${id}/raise_change`,idempotent:true,fields:[
        field('description','وصف التعديل المطلوب','textarea'),
        field('reason','سبب الطلب من العميل','textarea'),
        field('deliverable_id','المخرج أو المرحلة المتأثرة','select',{required:false,options:[{value:'',label:'بدون مخرج محدد'},
          ...deliverables.map(d=>({value:d.id,label:`${d.name} (${d.used_rounds} من ${d.revision_rounds} جولة)`}))]}),
        field('classification','تصنيف التعديل','select',{options:data.classifications.map(c=>({value:c.key,label:`${c.name} — ${c.meaning}`}))}),
        field('free_rounds_exhausted','خلصت الجولات المجانية؟','checkbox',{required:false,hint:'هذا إقرارك باللي تشوفه، والسجل يرد أي إقرار يخالفه.'}),
        field('schedule_impact_days','الأثر على الجدول بالأيام','number',{required:false,min:-365,max:365,value:0}),
        field('extra_cost','التكلفة الزيادة المقترحة','text',{required:false,inputmode:'decimal',hint:'اتركها فاضية إذا ما فيه تكلفة. تصحيح غلطة من عندنا ما ينحسب على العميل.'}),
        field('quotation_reference','مرجع العرض المسعّر','text',{required:false,hint:'لازم مع أي تكلفة زيادة.'}),
        field('added_rounds','جولات تنضاف لرصيد المخرج','number',{required:false,min:0,max:20,value:0}),
        field('added_quantity','كمية تنضاف للمخرج','number',{required:false,min:0,max:1000,value:0})
      ],toPayload:v=>({description:v.description,reason:v.reason,deliverable_id:v.deliverable_id||undefined,
        classification:v.classification,free_rounds_exhausted:v.free_rounds_exhausted==='on',
        schedule_impact_days:Number(v.schedule_impact_days||0),extra_cost:String(v.extra_cost??'').trim(),
        quotation_reference:v.quotation_reference||'',added_rounds:Number(v.added_rounds||0),added_quantity:Number(v.added_quantity||0)})};
    }
    const [receiptId,changeId]=String(id).split(':'),r=data.receipts.find(x=>x.id===receiptId);guard(r);
    const c=r.changes.find(x=>x.id===changeId);guard(c&&c.actions.includes(action));
    const spec=fields=>({title:`${CHANGE_LABELS[action]} — طلب ${c.number}`,endpoint:`/project-intake/changes/${changeId}/${action}`,fields,
      toPayload:v=>({version:c.version,...v})});
    if(action==='decide_finance')return spec([
      field('decision','القرار','select',{options:[{value:'approved',label:'اعتماد'},{value:'rejected',label:'رفض'}]}),
      field('note','أساس القرار','textarea')]);
    if(action==='record_client_approval')return spec([
      field('reference','مين وافق من جهة العميل ووين انحفظ دليل موافقته','textarea',{hint:'الموافقة يوثقها موظف بمرجع دليلها.'}),
      field('approved_on','تاريخ الموافقة','date',{value:data.today})]);
    if(action==='apply_change')return spec([
      field('start_date','تاريخ بدء التنفيذ','date',{value:data.today}),
      field('note','وش بدأ فعلًا بهالتغيير','textarea',{hint:'التطبيق يفتح من جديد الاعتمادات المتأثرة بس.'})]);
    return spec([field('note','سبب الاعتذار عن التغيير وكيف انبلغ العميل','textarea')]);
  }
};
