// المراكز التخصصية: تجميع تنظيمي لخدمات قائمة. تظهر للموظفين بعد التفعيل فقط.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const labels={edit_centre:'تعديل وتسمية المالك',link_services:'ربط الخدمات',activate_centre:'تفعيل المركز',retire_centre:'تقاعد المركز'};
export const centresUI={
  title:'المراكز التخصصية',description:'مراكز تجمع خدمات قائمة تحت مالك مسمّى وإدارة أم. المقترح منها ما يظهر للموظفين لين يتفعّل.',
  load:api=>api('/centres'),
  render(data,{e,button}){
    const card=c=>`<details class="vn-card"${c.status==='active'?' open':''}><summary><span class="vn-code">${e(c.services.length)} خدمة</span><span class="vn-name"><strong>${e(c.name)}</strong><small>${c.owner_name?`المالك: ${e(c.owner_name)}`:'بلا مالك مسمّى'}${c.department_name?` · ${e(c.department_name)}`:''}</small></span><span class="vn-flags"><span class="badge">${e(c.status_name)}</span></span></summary>
      <div class="vn-body"><p>${e(c.scope_note)}</p>${data.can_manage&&c.missing.length&&c.status==='proposed'?`<div class="vn-alert"><strong>ينقص قبل التفعيل:</strong> ${c.missing.map(e).join('، ')}</div>`:''}
      ${c.services.length?`<ul class="vn-list">${c.services.map(s=>`<li><strong><bdi dir="ltr">${e(s.code)}</bdi> · ${e(s.name_ar)}</strong><span>${e(s.department)}${s.hidden?' · <span class="badge is-late">موقوفة من الإعدادات: لا تُطلب الآن</span>':''}</span>${s.hidden&&s.hidden_reason?`<small>${e(s.hidden_reason)}</small>`:''}</li>`).join('')}</ul><p class="subtle">تنطلب هذي الخدمات من «الخدمات» مثل العادة${c.services.some(s=>s.hidden)?'، إلا اللي مكتوب عليها «موقوفة من الإعدادات»':''}.</p>`:'<p class="subtle">ما فيه خدمات مربوطة.</p>'}
      ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,labels[a])).join('')}</div>`:''}</div></details>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.proposable.length?`<div class="operation-actions">${data.proposable.map(p=>button('propose_centre',p.key,`تسجيل مقترح: ${p.name}`)).join('')}</div>`:''}</section>${data.centres.map(card).join('')||`<section class="panel panel-body"><p class="subtle">${data.can_manage?'ما فيه مراكز مسجّلة. سجّل المقترحات الأربعة وبعدها سمِّ مالكيها.':'ما فيه مراكز تخصصية مفعّلة للحين.'}</p></section>`}`;
  },
  form(action,id,data){
    guard(data.can_manage);
    if(action==='propose_centre'){const p=data.proposable.find(x=>x.key===id);guard(p);return {title:p.name,endpoint:'/centres',idempotent:true,fields:[],toPayload:()=>({key:id})};}
    const c=data.centres.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload)=>({title:`${labels[action]} — ${c.name}`,endpoint:`/centres/${id}/${action}`,fields,toPayload:v=>({version:c.version,...toPayload(v)})});
    if(action==='edit_centre')return spec([field('name','اسم المركز','text',{value:c.name}),field('scope_note','النطاق','textarea',{value:c.scope_note}),field('department_id','الإدارة الأم','select',{required:false,value:c.department_id??'',options:[{value:'',label:'لم تُحدد'},...data.departments.map(d=>({value:d.id,label:d.name}))]}),field('owner_id','المالك','select',{required:false,value:c.owner_id??'',options:[{value:'',label:'لم يُسمَّ'},...data.people.map(u=>({value:u.id,label:u.name}))]})],v=>({name:v.name,scope_note:v.scope_note,department_id:v.department_id||'',owner_id:v.owner_id||''}));
    if(action==='link_services')return spec([field('service_codes','رموز الخدمات','textarea',{required:false,value:c.services.map(s=>s.code).join('\n'),maxLength:4000,hint:`رمز في كل سطر. غير المربوط بمركز: ${data.unlinked_services.slice(0,40).map(s=>s.code).join('، ')}${data.unlinked_services.length>40?'…':''}`})],v=>({service_codes:String(v.service_codes||'').split(/[\n,،\s]+/).filter(Boolean)}));
    return spec([field('note',action==='activate_centre'?'قرار التفعيل وسنده':'سبب التقاعد','textarea')],v=>({note:v.note}));
  }
};
