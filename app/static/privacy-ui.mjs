// سجلات حماية البيانات الشخصية وطلبات أصحابها. الشاشة تصرّح بحدودها: تسجّل وتذكّر ولا تفتي،
// ولا تتلف ولا تحذف، وكل مدة وأساس نظامي فيها إدخال بشري بمصدره يبقى بحاجة إلى مراجعة قانونية.
import { dual } from './dates.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const optional=extra=>({required:false,...extra});
const YES_NO=[{value:'no',label:'لا'},{value:'yes',label:'نعم'}];
const labels={approve_activity:'اعتمد النشاط',edit_activity:'تعديل المسودة',supersede_activity:'استبدال بسجل جديد',
  assess_transfer:'تقييم المخاطر',approve_transfer:'اعتماد النقل',stop_transfer:'إيقاف النقل',
  record_check:'توثيق المراجعة',edit_rule:'تعديل القاعدة',deactivate_rule:'إيقاف',activate_rule:'تفعيل',
  update_incident:'تحديث الحادثة',close_incident:'إقفال الحادثة',
  verify_identity:'تحققت من الهوية',set_due_date:'تسجيل المهلة',answer_request:'تسجيل الرد',refuse_request:'رفض الطلب',close_request:'إقفال الطلب'};
const SOURCE_HINT='المنصة لا تعرف أي مدة ولا أي أساس نظامي. اكتب المصدر (نص نظامي، خطاب، مستشار) ومن أكده، ثم تاريخ التأكيد. يبقى الحقل بحاجة إلى مراجعة قانونية.';
const peopleOptions=data=>data.people.map(p=>({value:p.id,label:p.name}));
const gapLine=(e,gaps)=>gaps.length?`<small class="muted">ينقصه: ${e(gaps.join('، '))}</small>`:'';

function activityFields(data,a){
  return [field('name','اسم النشاط','text',{value:a?.name}),field('purpose','الغرض','textarea',{value:a?.purpose}),
    field('subject_categories','فئات أصحاب البيانات','checks',{value:a?.subject_categories??['employees'],options:Object.entries(data.subject_categories).map(([value,label])=>({value,label}))}),
    field('data_categories','فئات البيانات','textarea',{value:a?.data_categories}),
    field('sensitive','فيها بيانات حساسة','select',{value:a?.sensitive?'yes':'no',options:YES_NO,hint:'تصنيف البيانات حساسةً قرار المختص؛ المنصة تقترح ولا تصنّف.'}),
    field('sensitive_note','ما الحساس فيها ومن قرر ذلك','textarea',optional({value:a?.sensitive_note})),
    field('legal_basis','الأساس النظامي','textarea',optional({value:a?.legal_basis,hint:SOURCE_HINT})),
    field('legal_basis_source','مصدر الأساس النظامي ومن أكده','textarea',optional({value:a?.legal_basis_source})),
    field('legal_basis_confirmed_on','تاريخ تأكيد الأساس','date',optional({value:a?.legal_basis_confirmed_on??''})),
    field('internal_access','من يطلع عليها داخليًا','textarea',optional({value:a?.internal_access})),
    field('retention_period','مدة الاحتفاظ','textarea',optional({value:a?.retention_period,hint:SOURCE_HINT})),
    field('retention_source','مصدر المدة ومن أكدها','textarea',optional({value:a?.retention_source})),
    field('retention_confirmed_on','تاريخ تأكيد المدة','date',optional({value:a?.retention_confirmed_on??''})),
    field('disposal_action','إجراء الإتلاف','textarea',optional({value:a?.disposal_action,hint:'وصف ما يفعله إنسان عند بلوغ المدة. المنصة تنبّه ولا تتلف.'})),
    field('owner_id','مالك النشاط الذي يعتمده','select',{value:a?.owner_id,options:peopleOptions(data)}),
    field('next_review_date','تاريخ المراجعة التالية','date',optional({value:a?.next_review_date??''}))];
}
const activityPayload=v=>({name:v.name,purpose:v.purpose,subject_categories:v.subject_categories,data_categories:v.data_categories,
  sensitive:v.sensitive==='yes',sensitive_note:v.sensitive_note??'',legal_basis:v.legal_basis??'',legal_basis_source:v.legal_basis_source??'',
  legal_basis_confirmed_on:v.legal_basis_confirmed_on??'',internal_access:v.internal_access??'',retention_period:v.retention_period??'',
  retention_source:v.retention_source??'',retention_confirmed_on:v.retention_confirmed_on??'',disposal_action:v.disposal_action??'',
  owner_id:v.owner_id,next_review_date:v.next_review_date??''});

export const privacyUI={
  title:'حماية البيانات الشخصية',
  description:'سجل أنشطة المعالجة، ونقل البيانات خارج المملكة، وجدول الاحتفاظ، وحوادث الخصوصية. المنصة تسجّل وتذكّر ولا تفتي: كل مدة وكل أساس نظامي يدخله مختص بمصدره وتاريخ تأكيده ويبقى بحاجة إلى مراجعة قانونية، والتنبيه تنبيه لا إتلاف.',
  load:api=>api('/privacy'),
  render(data,{e,button}){
    const tile=(value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
    const p=data.posture;
    const activity=a=>`<li class="${a.status==='superseded'?'is-old':a.review_overdue?'is-late':a.gaps.length?'is-due':'is-ok'}">
      <strong>${e(a.name)}</strong><span>${e(a.state_name)} · ${e(a.subject_names.join('، '))}${a.sensitive?' · بيانات موسومة حساسة':''} · المالك ${e(a.owner_name??'—')}${a.next_review_date?` · المراجعة التالية ${e(dual(a.next_review_date))}`:''}</span>
      <small>${e(a.purpose)}</small>
      <small class="subtle">الأساس النظامي: ${a.legal_basis?`${e(a.legal_basis)} — المصدر: ${e(a.legal_basis_source)} (تأكيد ${e(a.legal_basis_confirmed_on)}) · ${e(a.legal_review)}`:'ما انكتب للحين'}</small>
      <small class="subtle">مدة الاحتفاظ: ${a.retention_period?`${e(a.retention_period)} — المصدر: ${e(a.retention_source)} (تأكيد ${e(a.retention_confirmed_on)}) · ${e(a.legal_review)}`:'ما انكتبت للحين'}</small>
      ${a.source_tables?`<small class="muted">مكانها في المنصة: <bdi translate="no">${e(a.source_tables)}</bdi></small>`:''}${gapLine(e,a.gaps)}
      ${a.actions.length?`<div class="operation-actions">${a.actions.map(x=>button(x,a.id,labels[x])).join('')}</div>`:''}</li>`;
    const platform=t=>`<li class="${t.recorded?'':'is-due'}"><strong>${e(t.title)}</strong><span>${e(t.state)}</span><small>${e(t.module)} — ${e(t.detail)}</small><small class="subtle">حالة المزوّد: ${e(t.evidence)}</small>
      ${t.recorded?'':`<div class="operation-actions">${button('record_transfer',t.slug,'تسجيل هذا النقل')}</div>`}</li>`;
    const transfer=t=>`<li class="${t.status==='approved'?(t.review_overdue?'is-late':'is-ok'):t.status==='stopped'?'is-old':'is-due'}">
      <strong>${e(t.recipient)} · ${e(t.country)}</strong><span>${e(t.state_name)}${t.next_review_date?` · المراجعة ${e(dual(t.next_review_date))}`:''}</span>
      <small>${e(t.purpose)} — الفئات: ${e(t.data_categories)}</small>
      <small class="subtle">الضمانة: ${t.safeguard?`${e(t.safeguard)} (${e(t.safeguard_source)}) · ${e(t.legal_review)}`:'ما انسجلت'}</small>
      <small class="subtle">تقييم المخاطر: ${t.risk_assessment?(t.status==='approved'?'مُقيَّم ومعتمد':`قيّمه ${e(t.assessed_by_name)}، ويعتمده غيره`):'ما تقيّم للحين'}</small>
      ${t.actions.length?`<div class="operation-actions">${t.actions.map(x=>button(x,t.id,labels[x])).join('')}</div>`:''}</li>`;
    const rule=r=>`<li class="${!r.active?'is-old':r.state==='overdue'?'is-late':r.state==='due_soon'?'is-due':'is-ok'}">
      <strong>${e(r.data_category)}</strong><span>${e(r.state_name)} · التنبيه ${e(dual(r.next_check_date))} · المالك ${e(r.owner_name??'—')}</span>
      <small class="subtle">${r.retention_period?`${e(r.retention_period)} — المصدر: ${e(r.retention_source)} (تأكيد ${e(r.confirmed_on)}) · ${e(r.legal_review)}`:'ما فيه مدة مسجّلة للحين؛ الفئة مسجّلة فجوةً معروفة'}</small>${r.disposal_action?`<small class="subtle">الإتلاف: ${e(r.disposal_action)}</small>`:''}
      ${r.last_checked_on?`<small class="muted">آخر مراجعة ${e(dual(r.last_checked_on))}: ${e(r.last_check_note)}</small>`:''}
      <div class="operation-actions">${r.actions.map(x=>button(x,r.id,labels[x])).join('')}</div></li>`;
    const incident=i=>`<li class="${i.status==='closed'?'is-old':i.status==='open'?'is-late':'is-due'}">
      <strong>${e(i.title)}</strong><span>${e(i.state_name)} · اكتُشفت ${e(dual(i.discovered_on))}${i.affected_count===null?' · عدد المتأثرين غير معروف':` · متأثرون ${e(i.affected_count)}`} · المالك ${e(i.owner_name??'—')}</span>
      <small>${e(i.description)}</small><small class="subtle">الأثر: ${e(i.impact)}</small>
      <small class="subtle">مهلة الإبلاغ: ${i.notification_deadline?`${e(dual(i.notification_deadline))} — المصدر: ${e(i.notification_deadline_source)} · ${e(i.legal_review)}`:'ما انكتبت للحين'}${i.notified_on?` · أُبلغ في ${e(dual(i.notified_on))}`:''}</small>
      ${gapLine(e,i.gaps)}${i.actions.length?`<div class="operation-actions">${i.actions.map(x=>button(x,i.id,labels[x])).join('')}</div>`:''}</li>`;
    const block=(title,body,empty)=>`<section class="vn-block"><h2>${e(title)}</h2>${body||`<p class="subtle">${e(empty)}</p>`}</section>`;
    const suggestions=data.suggestions.length?`<p class="subtle">اقتراحات من وحدات المنصة ما انسجلت للحين: ${e(data.suggestions.map(s=>s.name).join('، '))}. الاقتراح يعتمده إنسان، وما ينشأ سجل تلقائيًا.</p><div class="operation-actions">${button('suggest_activities','','توليد مسودات من الوحدات القائمة')}</div>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
        <div class="operation-actions">${button('draft_activity','','نشاط معالجة جديد')}${button('record_transfer','','تسجيل نقل خارج المملكة')}${button('create_rule','','قاعدة احتفاظ')}${button('record_incident','','تسجيل حادثة')}</div></section>
      <section class="vn-board">
        <div class="vn-tiles">${tile(p.activities.total,'أنشطة معالجة')}${tile(p.activities.without_legal_basis,'بلا أساس نظامي',p.activities.without_legal_basis?'is-late':'')}${tile(p.activities.without_retention,'بلا مدة احتفاظ',p.activities.without_retention?'is-late':'')}${tile(p.activities.review_overdue,'مراجعة متأخرة',p.activities.review_overdue?'is-due':'')}${tile(p.transfers.unassessed+p.transfers.platform_unrecorded,'نقل غير مُقيَّم',p.transfers.unassessed+p.transfers.platform_unrecorded?'is-due':'')}${tile(p.requests.open,'طلبات مفتوحة')}${tile(p.incidents.open,'حوادث مفتوحة',p.incidents.open?'is-late':'')}</div>
        <p class="subtle">${e(p.score_note)}</p>
        ${block('نقل البيانات خارج المملكة — نقل تفعله المنصة نفسها',`<ul class="vn-list">${data.platform_transfers.map(platform).join('')}</ul>`,'')}
        ${block('سجل نقل البيانات',`${data.transfers.length?`<ul class="vn-list">${data.transfers.map(transfer).join('')}</ul>`:''}`,'ما فيه نقل مسجّل للحين.')}
        ${block('سجل أنشطة المعالجة',`${suggestions}${data.activities.length?`<ul class="vn-list">${data.activities.map(activity).join('')}</ul>`:''}`,'ما فيه أنشطة مسجّلة للحين.')}
        ${block('جدول الاحتفاظ',`${data.retention_rules.length?`<ul class="vn-list">${data.retention_rules.map(rule).join('')}</ul>`:''}`,'ما فيه قواعد احتفاظ مسجّلة. التنبيه هنا لمالكها، والمنصة ما تتلف شي.')}
        ${block('حوادث حماية البيانات',`${data.incidents.length?`<ul class="vn-list">${data.incidents.map(incident).join('')}</ul>`:''}`,'ما فيه حوادث مسجّلة.')}
      </section>`;
  },
  form(action,id,data){
    if(action==='draft_activity')return {title:'نشاط معالجة جديد',endpoint:'/privacy/activities',idempotent:true,fields:activityFields(data,null),toPayload:v=>activityPayload(v)};
    if(action==='suggest_activities')return {title:'توليد مسودات من الوحدات القائمة',endpoint:'/privacy/activities/suggest',idempotent:true,
      fields:[field('owner_id','مالك الأنشطة المقترحة الذي يراجعها ويعتمدها','select',{options:peopleOptions(data),hint:'المسودات تُنشأ بلا أساس نظامي وبلا مدة احتفاظ عمدًا؛ يكملها المالك ثم يعتمدها.'})],toPayload:v=>({owner_id:v.owner_id})};
    if(action==='record_transfer'){
      const platform=data.platform_transfers.find(x=>x.slug===id&&!x.recorded);
      return {title:platform?`تسجيل نقل — ${platform.title}`:'تسجيل نقل بيانات خارج المملكة',endpoint:'/privacy/transfers',idempotent:true,
        fields:[field('recipient','الجهة المستقبِلة','text',{value:platform?'':''}),field('country','البلد','text',{hint:'المنصة لا تعرف بلد المزود؛ اكتبه كما تحققت منه.'}),
          field('purpose','الغرض من النقل','textarea',{value:platform?platform.detail:''}),field('data_categories','فئات البيانات المنقولة','textarea'),
          field('safeguard','الضمانة التعاقدية','textarea',optional({hint:'اتركها فارغة إن لم توجد ضمانة بعد؛ الفراغ يظهر في الفحص الذاتي.'})),
          field('safeguard_source','مرجع الضمانة ومن أكدها','textarea',optional({})),field('next_review_date','تاريخ المراجعة التالية','date',optional({}))],
        toPayload:v=>({slug:platform?platform.slug:'',recipient:v.recipient,country:v.country,purpose:v.purpose,data_categories:v.data_categories,safeguard:v.safeguard??'',safeguard_source:v.safeguard_source??'',next_review_date:v.next_review_date??''})};
    }
    if(action==='create_rule')return {title:'قاعدة احتفاظ',endpoint:'/privacy/retention',idempotent:true,
      fields:[field('data_category','فئة البيانات'),field('retention_period','مدة الاحتفاظ','textarea',optional({hint:SOURCE_HINT})),
        field('retention_source','مصدر المدة ومن أكدها','textarea',optional({})),field('confirmed_on','تاريخ تأكيد المدة','date',optional({})),
        field('disposal_action','إجراء الإتلاف','textarea',optional({hint:'ما يفعله إنسان عند بلوغ المدة. المنصة تنبّه ولا تنفذ.'})),
        field('owner_id','مالك القاعدة','select',{options:peopleOptions(data)}),field('next_check_date','موعد التنبيه القادم','date')],
      toPayload:v=>({id:'',version:0,data_category:v.data_category,retention_period:v.retention_period??'',retention_source:v.retention_source??'',confirmed_on:v.confirmed_on??'',disposal_action:v.disposal_action??'',owner_id:v.owner_id,next_check_date:v.next_check_date})};
    if(action==='record_incident')return {title:'تسجيل حادثة حماية بيانات',endpoint:'/privacy/incidents',idempotent:true,
      fields:[field('title','عنوان الحادثة'),field('description','ماذا حدث','textarea'),field('impact','الأثر ومن تأثر','textarea'),
        field('affected_count','عدد المتأثرين','number',optional({min:0,hint:'اتركه فارغًا ما دام غير معروف؛ لا تقدّر رقمًا.'})),
        field('discovered_on','تاريخ الاكتشاف','date',{value:data.today}),field('occurred_on','تاريخ الوقوع','date',optional({})),
        field('owner_id','مالك الحادثة','select',{options:peopleOptions(data)})],
      toPayload:v=>({title:v.title,description:v.description,impact:v.impact,affected_count:v.affected_count===''?null:Number(v.affected_count),discovered_on:v.discovered_on,occurred_on:v.occurred_on??'',owner_id:v.owner_id})};

    const activity=data.activities.find(x=>x.id===id),transfer=data.transfers.find(x=>x.id===id),rule=data.retention_rules.find(x=>x.id===id),incident=data.incidents.find(x=>x.id===id);
    if(action==='edit_activity'){guard(activity&&activity.actions.includes(action));
      return {title:`تعديل مسودة — ${activity.name}`,endpoint:'/privacy/activities',fields:activityFields(data,activity),toPayload:v=>({...activityPayload(v),id:activity.id,version:activity.version})};}
    if(action==='approve_activity'){guard(activity&&activity.actions.includes(action));
      return {title:`اعتماد نشاط — ${activity.name}`,endpoint:`/privacy/activities/${id}/approve_activity`,
        fields:[field('note','إقرارك بملكية هذا النشاط','textarea',{hint:'الاعتماد لا يجعل المدة ولا الأساس النظامي رأيًا للمنصة؛ كلاهما يبقى بحاجة إلى مراجعة قانونية.'})],toPayload:v=>({version:activity.version,note:v.note})};}
    if(action==='supersede_activity'){guard(activity&&activity.actions.includes(action));
      return {title:`استبدال نشاط — ${activity.name}`,endpoint:`/privacy/activities/${id}/supersede_activity`,
        fields:[field('note','سبب الاستبدال','textarea',{hint:'المعتمد لا يُعدَّل: يبقى كما هو وتُفتح مسودة جديدة منه.'})],toPayload:v=>({version:activity.version,note:v.note})};}
    if(action==='assess_transfer'){guard(transfer&&transfer.actions.includes(action));
      return {title:`تقييم مخاطر — ${transfer.recipient}`,endpoint:`/privacy/transfers/${id}/assess_transfer`,
        fields:[field('risk_assessment','تقييم المخاطر','textarea',{hint:'ما الذي يُرسل فعلًا، ومن يطلع عليه لدى الجهة، وماذا يحدث إن تسرب.'}),
          field('safeguard','الضمانة التعاقدية','textarea',optional({value:transfer.safeguard})),field('safeguard_source','مرجع الضمانة ومن أكدها','textarea',optional({value:transfer.safeguard_source})),
          field('next_review_date','تاريخ المراجعة التالية','date',optional({value:transfer.next_review_date??''}))],
        toPayload:v=>({version:transfer.version,risk_assessment:v.risk_assessment,safeguard:v.safeguard??'',safeguard_source:v.safeguard_source??'',next_review_date:v.next_review_date??''})};}
    if(action==='approve_transfer'||action==='stop_transfer'){guard(transfer&&transfer.actions.includes(action));
      return {title:`${labels[action]} — ${transfer.recipient}`,endpoint:`/privacy/transfers/${id}/${action}`,
        fields:[field('note',action==='approve_transfer'?'قرارك وما استندت إليه':'سبب الإيقاف','textarea')],toPayload:v=>({version:transfer.version,note:v.note})};}
    if(action==='edit_rule'){guard(rule&&rule.actions.includes(action));
      return {title:`تعديل قاعدة — ${rule.data_category}`,endpoint:'/privacy/retention',
        fields:[field('data_category','فئة البيانات','text',{value:rule.data_category}),field('retention_period','مدة الاحتفاظ','textarea',optional({value:rule.retention_period,hint:SOURCE_HINT})),
          field('retention_source','مصدر المدة ومن أكدها','textarea',optional({value:rule.retention_source})),field('confirmed_on','تاريخ تأكيد المدة','date',optional({value:rule.confirmed_on??''})),
          field('disposal_action','إجراء الإتلاف','textarea',optional({value:rule.disposal_action})),field('owner_id','مالك القاعدة','select',{value:rule.owner_id,options:peopleOptions(data)}),
          field('next_check_date','موعد التنبيه القادم','date',{value:rule.next_check_date})],
        toPayload:v=>({id:rule.id,version:rule.version,data_category:v.data_category,retention_period:v.retention_period??'',retention_source:v.retention_source??'',confirmed_on:v.confirmed_on??'',disposal_action:v.disposal_action??'',owner_id:v.owner_id,next_check_date:v.next_check_date})};}
    if(action==='record_check'){guard(rule&&rule.actions.includes(action));
      return {title:`توثيق مراجعة — ${rule.data_category}`,endpoint:`/privacy/retention/${id}/record_check`,
        fields:[field('note','ما الذي روجع وما الذي تقرر','textarea',{hint:'المنصة لم تتلف شيئًا ولن تفعل. وثّق ما فعله إنسان.'}),field('next_check_date','موعد التنبيه القادم','date')],
        toPayload:v=>({version:rule.version,note:v.note,next_check_date:v.next_check_date})};}
    if(action==='deactivate_rule'||action==='activate_rule'){guard(rule&&rule.actions.includes(action));
      return {title:`${labels[action]} — ${rule.data_category}`,endpoint:`/privacy/retention/${id}/${action}`,fields:[field('note','السبب','textarea')],toPayload:v=>({version:rule.version,note:v.note})};}
    if(action==='update_incident'){guard(incident&&incident.actions.includes(action));
      return {title:`تحديث حادثة — ${incident.title}`,endpoint:`/privacy/incidents/${id}/update_incident`,
        fields:[field('status','الحالة','select',{value:incident.status,options:[{value:'open',label:'مفتوحة'},{value:'contained',label:'محتواة'}]}),
          field('notification_deadline','مهلة الإبلاغ','date',optional({value:incident.notification_deadline??'',hint:'المنصة لا تعرف أي مهلة إبلاغ. أدخلها بمصدرها إن كانت معروفة لك.'})),
          field('notification_deadline_source','مصدر المهلة ومن أكدها','textarea',optional({value:incident.notification_deadline_source})),
          field('notified_on','تاريخ الإبلاغ الفعلي','date',optional({value:incident.notified_on??''})),field('notification_note','ملاحظة الإبلاغ','textarea',optional({value:incident.notification_note})),
          field('remediation','خطوات المعالجة','textarea',optional({value:incident.remediation})),field('lessons','الدروس المستفادة','textarea',optional({value:incident.lessons}))],
        toPayload:v=>({version:incident.version,status:v.status,notification_deadline:v.notification_deadline??'',notification_deadline_source:v.notification_deadline_source??'',notified_on:v.notified_on??'',notification_note:v.notification_note??'',remediation:v.remediation??'',lessons:v.lessons??''})};}
    guard(incident&&incident.actions.includes(action));
    return {title:`إقفال حادثة — ${incident.title}`,endpoint:`/privacy/incidents/${id}/close_incident`,
      fields:[field('note','ما الذي تحققت منه قبل الإقفال','textarea')],toPayload:v=>({version:incident.version,note:v.note})};
  }
};

export const subjectRequestsUI={
  title:'طلبات أصحاب البيانات',
  description:'استقبال طلبات الاطلاع والتصحيح والحذف والنقل والاعتراض. التحقق من الهوية خطوة إلزامية، ومن يتحقق ليس من يرد. خريطة بيانات الشخص تعطي أسماء الجداول وأعدادها دون أي محتوى، ولا حذف آليًا.',
  load:api=>api('/subject-requests'),
  render(data,{e,button}){
    const tile=(value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
    const count=state=>data.requests.filter(r=>r.status===state).length;
    const mapRow=x=>`<li><strong><bdi translate="no">${e(x.table)}</bdi></strong><span>${e(x.role==='subject'?'بيانات عن الشخص':'أثر فعل نفّذه')} · ${e(x.rows)} سجلًا · العمود <bdi translate="no">${e(x.column)}</bdi></span>${x.reasons?`<small class="subtle">${e(x.reasons.join(' '))}</small>`:''}</li>`;
    const map=r=>{
      if(!r.data_map)return '';
      const m=r.data_map,rows=m.entries??m.tables;
      return `<div class="detail-data"><strong>${e(m.entries?'ما يمكن حذفه وما لا يمكن':'أين تقع بياناته')}</strong>
        <small class="subtle">${e(m.note)}</small>
        <small>${e(m.totals.tables)} جدولًا · ${e(m.totals.records)} سجلًا${m.entries?` · غير قابل للحذف: ${e(m.blocked)}`:''}</small>
        <ul class="vn-list">${rows.map(mapRow).join('')}</ul></div>`;
    };
    const row=r=>`<li class="${r.late?'is-late':['answered','refused','closed'].includes(r.status)?'is-old':r.status==='received'?'is-due':'is-ok'}">
      <strong><bdi>${e(r.reference)}</bdi> · ${e(r.type_name)} — ${e(r.requester_name)} (${e(r.kind_name)})</strong>
      <span>${e(r.state_name)} · استُلم ${e(dual(r.received_on))}${r.due_date?` · المهلة ${e(dual(r.due_date))}${r.late?' — تأخر':''}`:' · لا مهلة مسجلة'}${r.subject_name?` · صاحب البيانات ${e(r.subject_name)}`:''}</span>
      <small>${e(r.request_detail)}</small>
      <small class="subtle">${r.identity_verified_by_name?`تحقق من الهوية: ${e(r.identity_verified_by_name)} — ${e(r.identity_evidence)}`:'ما تحقّق أحد من الهوية للحين؛ ما فيه رد قبل التحقق'}${r.due_source?` | مصدر المهلة: ${e(r.due_source)} · ${e(r.legal_review)}`:''}</small>
      ${r.response?`<small class="muted">الرد (${e(r.answered_by_name)}): ${e(r.response)} — الدليل: ${e(r.response_evidence)}</small>`:''}
      ${r.refusal_reason?`<small class="muted">الرفض (${e(r.refused_by_name)}): ${e(r.refusal_reason)}</small>`:''}
      ${map(r)}
      ${r.actions.length?`<div class="operation-actions">${r.actions.map(x=>button(x,r.id,labels[x])).join('')}</div>`:''}</li>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
        <div class="operation-actions">${button('create_request','','تسجيل طلب جديد')}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(count('received'),'ينتظر تحقق الهوية',count('received')?'is-due':'')}${tile(count('verified'),'قيد العمل')}${tile(data.requests.filter(r=>r.late).length,'تأخر عن مهلته',data.requests.some(r=>r.late)?'is-late':'')}${tile(count('answered')+count('closed'),'أُجيب أو أُقفل','is-ok')}</div>
      <section class="vn-block">${data.requests.length?`<ul class="vn-list">${data.requests.map(row).join('')}</ul>`:'<p class="subtle">ما فيه طلبات مسجّلة.</p>'}</section></section>`;
  },
  form(action,id,data){
    if(action==='create_request')return {title:'تسجيل طلب صاحب بيانات',endpoint:'/subject-requests',idempotent:true,
      fields:[field('request_type','نوع الطلب','select',{options:Object.entries(data.types).map(([value,label])=>({value,label}))}),
        field('requester_name','اسم مقدم الطلب'),field('requester_kind','صفته','select',{options:Object.entries(data.kinds).map(([value,label])=>({value,label}))}),
        field('subject_user_id','حسابه في المنصة','select',optional({options:[{value:'',label:'— ليس له حساب —'},...peopleOptions(data)],hint:'ربط الطلب بحساب يتيح خريطة بيانات بعد التحقق من الهوية: أسماء جداول وأعداد فقط.'})),
        field('request_detail','نص الطلب كما ورد','textarea'),field('received_on','تاريخ الاستلام','date',{value:data.today}),
        field('due_date','المهلة','date',optional({hint:'المنصة لا تعرف أي مهلة نظامية. أدخلها بمصدرها إن كانت معروفة لك، أو اتركها حتى تتأكد.'})),
        field('due_source','مصدر المهلة ومن أكدها','textarea',optional({}))],
      toPayload:v=>({request_type:v.request_type,requester_name:v.requester_name,requester_kind:v.requester_kind,subject_user_id:v.subject_user_id??'',request_detail:v.request_detail,received_on:v.received_on,due_date:v.due_date??'',due_source:v.due_source??''})};
    const r=data.requests.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='verify_identity')return {title:`تحقق من الهوية — ${r.reference}`,endpoint:`/subject-requests/${id}/verify_identity`,
      fields:[field('identity_evidence','كيف تحققت من هويته وما الدليل','textarea',{hint:'خطوة إلزامية لا تُتجاوز. لا تحفظ صور هوية هنا؛ اكتب ما يثبت التحقق ومكان حفظه. ومن يتحقق ليس من يرد.'})],
      toPayload:v=>({version:r.version,identity_evidence:v.identity_evidence})};
    if(action==='set_due_date')return {title:`تسجيل مهلة — ${r.reference}`,endpoint:`/subject-requests/${id}/set_due_date`,
      fields:[field('due_date','المهلة','date'),field('due_source','مصدر المهلة ومن أكدها','textarea',{hint:SOURCE_HINT})],
      toPayload:v=>({version:r.version,due_date:v.due_date,due_source:v.due_source})};
    if(action==='answer_request')return {title:`تسجيل الرد — ${r.reference}`,endpoint:`/subject-requests/${id}/answer_request`,
      fields:[field('response','ملخص الرد','textarea',{hint:'طلب الحذف قرار بشري: ما يمنعه قيد محاسبي أو تدقيقي يُذكر لصاحبه صراحة. المنصة لا تحذف شيئًا من هذه الشاشة.'}),
        field('response_evidence','دليل الرد: ما أُرسل ومتى وأين حُفظ','textarea')],
      toPayload:v=>({version:r.version,response:v.response,response_evidence:v.response_evidence})};
    if(action==='refuse_request')return {title:`رفض الطلب — ${r.reference}`,endpoint:`/subject-requests/${id}/refuse_request`,
      fields:[field('reason','سبب الرفض وسنده','textarea')],toPayload:v=>({version:r.version,reason:v.reason})};
    return {title:`إقفال الطلب — ${r.reference}`,endpoint:`/subject-requests/${id}/close_request`,
      fields:[field('note','ما الذي أُقفل عليه الطلب','textarea')],toPayload:v=>({version:r.version,note:v.note})};
  }
};
