// مشاركة الإدارات: الطلب يصف وش المطلوب من الإدارة الثانية، ورئيسها يقرر بحسابه. الشاشة تبدأ بما ينتظر قرارك،
// ثم مشاريعك بسجل مشاركتها. كل طلب صفّ من صفوف المنصة (vn-list) بشارته وأفعاله، فالأزرار ما تلتصق ببعض.
const statusName={pending:'بانتظار قرار الإدارة',accepted:'مقبول',returned:'معاد للتوضيح'};
const actionNames={accept_participation:'قبول المشاركة',return_participation:'إعادة للتوضيح'};
const day=value=>String(value??'').slice(0,10);

// الصف: العنوان ثم من طلب ومتى، والشارة كلمة وشكل، والنطاق نصًّا، وسبب القرار إن صدر. data-focus-id يبقى على الصف
// لأن الرابط ‎#project-participation?focus=‎ يقف عليه.
// في «بانتظار قراري» العنوان المشروع والإدارة في السطر؛ وفي سجل المشروع العنوان الإدارة نفسها، فما تتكرر.
const requestRow=(r,{e,button},{mine=false,inProject=false}={})=>`<li${mine?' class="is-decision"':''} data-focus-id="${e(r.id)}"><strong>${e(inProject?r.department_name:r.project_name??r.department_name)}</strong>`
  +`<span>${inProject?'':`${e(r.department_name)} · `}طلبها ${e(r.requested_by_name)} · <time datetime="${e(r.requested_at)}">${e(day(r.requested_at))}</time></span>`
  +`<span class="badge ${e(r.status)}">${e(r.status_name??statusName[r.status]??r.status)}</span>`
  +`<small>${e(r.basis)}</small>${r.decision_note?`<small>سبب القرار: ${e(r.decision_note)}</small>`:''}`
  +`${(r.actions||[]).length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,actionNames[a]??a)).join('')}</div>`:''}</li>`;

export const projectParticipationUI={
  title:'مشاركة الإدارات',
  description:'تطلب مشاركة إدارة ثانية في مشروعك، ورئيسها يقرر بحسابه، والسجل يحفظ الإعادة والرفض.',
  description_en:'Request another department, record its manager’s decision, and retain the full history.',
  load:api=>api('/project-participation'),
  render(data,helpers){
    const {e,button}=helpers,incoming=data.incoming||[],projects=data.projects||[];
    // ما ينتظر قرارك أول الشاشة؛ والفارغ جملة تقول متى يطلع هنا شي.
    const waiting=incoming.length?`<ul class="vn-list">${incoming.map(r=>requestRow(r,helpers,{mine:(r.actions||[]).length>0})).join('')}</ul>`
      :'<p class="subtle">ما فيه طلب مشاركة ينتظر قرارك الحين. أول ما يطلب مدير مشروع إدارتك يطلع هنا.</p>';
    const project=p=>`<section class="panel" data-focus-id="${e(p.id)}"><div class="panel-head"><div><h3>${e(p.name)}</h3><p>مدير المشروع: ${e(p.manager?.name||'ما تحدد')}</p></div>${(p.actions||[]).includes('request_participation')?button('request_participation',p.id,'طلب مشاركة إدارة'):''}</div>`
      +`<div class="panel-body">${(p.requests||[]).length?`<ul class="vn-list">${p.requests.map(r=>requestRow(r,helpers,{inProject:true})).join('')}</ul>`:'<p class="subtle">ما انطلبت مشاركة إدارة ثانية في هالمشروع للحين.</p>'}`
      +`${(p.links||[]).length?`<h4>الإدارات المشاركة</h4><ul class="vn-list">${p.links.map(l=>`<li><strong>${e(l.department_name)}</strong><span>${e(l.source_note||'مشاركة مسجلة')}${l.approved_at?` · <time datetime="${e(l.approved_at)}">${e(day(l.approved_at))}</time>`:''}</span></li>`).join('')}</ul>`:''}</div></section>`;
    return `${data.note?`<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>`:''}`
      +`<section class="vn-group"><h2>بانتظار قرار إدارتي <span>${e(incoming.length)}</span></h2>${waiting}</section>`
      +`<section class="vn-group"><h2>مشاريعي وسجل المشاركة <span>${e(projects.length)}</span></h2>${projects.map(project).join('')||'<p class="subtle">ما عندك مشاريع هنا للحين. المشاريع اللي تديرها أو أنت عضو فيها تطلع هنا بسجل مشاركتها.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='request_participation'){
      const project=(data.projects||[]).find(p=>p.id===id&&(p.actions||[]).includes(action));
      if(!project)throw new Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');
      return {title:'طلب مشاركة إدارة',endpoint:`/projects/${id}/departments`,method:'POST',idempotent:true,fields:[{name:'department_id',label:'الإدارة المطلوبة',type:'select',options:(project.available_departments||[]).map(d=>({value:d.id,label:d.name}))},{name:'basis',label:'وش المطلوب منها: النطاق والمخرج',type:'textarea',maxLength:2000}],toPayload:v=>({department_id:v.department_id,basis:v.basis})};
    }
    if(['accept_participation','return_participation'].includes(action)){
      const row=(data.incoming||[]).find(r=>r.id===id&&(r.actions||[]).includes(action));
      if(!row)throw new Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');
      return {title:actionNames[action],endpoint:`/project-department-requests/${id}/${action}`,method:'POST',fields:[{name:'note',label:'سبب القرار',type:'textarea',maxLength:2000}],toPayload:v=>({version:row.version,note:v.note})};
    }
    throw new Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');
  }
};
