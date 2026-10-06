// مخصصات المشاريع: سقف لكل مشروع ومركز تكلفة، بمراجعة مستقلة، وحجز والتزام واستهلاك من المشتريات.
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const labels={create:'مخصص مشروع جديد',grant:'منح نطاق للمالية',revoke:'سحب النطاق',edit:'تعديل المسودة',revise:'مراجعة المخصص',submit:'تقديم للاعتماد',approve:'اعتماد المخصص',return:'إعادة للتعديل',reject:'رفض',close:'إقفال المخصص'};
const statuses={draft:'مسودة',pending:'بانتظار مراجعة مستقلة',active:'معتمد وساري في فترته',rejected:'مرفوض',closed:'مقفل'};
// الحالة شكلٌ وكلمة: المسودة ساكنة، والمنتظر بشكل الانتظار، والساري صامت، والمرفوض بشكل الرفض، والمقفل ساكن.
const tones={draft:'draft',pending:'pending',active:'approved',rejected:'rejected',closed:'closed'};
// سجل المخصص يُقرأ أحداثًا بأفعالها (انعدّ، انقدّم، انعتمد…)، لا بأسماء أزرارها.
const EVENTS={create:'انعدّ المخصص',edit:'انعدّلت المسودة',submit:'انقدّم للاعتماد',approve:'انعتمد',return:'رجع للتعديل',reject:'انرفض',revise:'انراجع',close:'انقفل'};
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const decimal=n=>`${Math.floor(n/100)}.${String(n%100).padStart(2,'0')}`;
const values=row=>[field('cap_amount','سقف المخصص بالريال','text',{value:row?decimal(row.cap_minor):''}),field('valid_from','بداية الفترة','date',{value:row?.valid_from||''}),field('valid_until','نهاية الفترة','date',{value:row?.valid_until||''}),field('evidence','دليل المخصص ومرجعه','textarea',{value:row?.evidence||''})];
// يوم الرياض لطابع زمني (نهاية النطاق تُخزَّن UTC): التاريخ الذي يقرؤه الناس لا تاريخ غرينتش.
const riyadhDay=iso=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch{return String(iso??'').slice(0,10);}};
export const budgetsUI={
 title:'مخصصات المشاريع',description:'مخصص مشترك لكل مشروع ومركز تكلفة، بمراجعة مستقلة وحجز مرتبط بالمشتريات.',
 async load(api){return api('/budgets');},
 render(data,{e,button,money,ui=kit(e)}){
  // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في رأس العمود وبعد أول مبلغ في البطاقة.
  const fig=v=>`<span class="ltr">${e(money(v,'').trim())}</span>`;
  const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
  const projectName=id=>data.projects.find(p=>p.id===id)?.name??data.owned_projects.find(p=>p.id===id)?.name??'مشروع';
  const personName=id=>id===data.user_id?'أنت':data.finance_users.find(u=>u.id===id)?.name??'حساب مالي';
  // زر النطاق يُرسم حين يقبله النموذج: مشروع تملكه، وحساب مالي يُمنح النطاق.
  const controls=(data.finance_users.length?data.owned_projects.map(p=>button('grant',p.id,`منح نطاق للمالية: ${p.name}`)).join(''):'')+(data.permissions.includes('prepare')&&data.projects.length?button('create','','مخصص جديد'):'');
  // البطاقة تبدأ بالمتاح، ثم كيف حُسب: السقف ناقص المحجوز والملتزم والمستهلك، والمتاح صف إجمالي.
  const budgetCard=b=>{
   const decide=b.allowed_actions.includes('approve'),tone=decide?'is-decision':b.status==='pending'?'is-pending':['draft','closed'].includes(b.status)?'is-old':'';
   const badge=decide?'<span class="badge is-decision">ينتظر اعتمادك</span>':`<span class="badge ${tones[b.status]??''}">${e(statuses[b.status]??b.status)}</span>`;
   const over=b.available_minor<0;
   const rows=[`<tr><td>سقف المخصص</td><td>${fig(b.cap_minor)}</td></tr>`,
    ...[['المحجوز بالترسية',b.reserved_minor],['الملتزم بأوامر تنتظر فواتيرها',b.committed_minor],['المستهلك بالمطابقة',b.consumed_minor??0]].map(([label,n])=>`<tr><td>ناقص ${label}</td><td>${fig(n)}</td></tr>`),
    `<tr><th scope="row">المتاح${over?' — تجاوز السقف':''}</th><td><strong>${fig(b.available_minor)}</strong></td></tr>`];
   const history=b.history.length?`<details><summary>سجل القرارات (${b.history.length})</summary><ol class="vn-list">${b.history.map(h=>`<li><strong>${e(EVENTS[h.action]??labels[h.action]??h.action)}</strong><span><time datetime="${e(h.created_at)}">${e(riyadhDay(h.created_at))}</time></span></li>`).join('')}</ol></details>`:'';
   return `<details class="vn-card ${tone}"${decide?' open':''} data-id="${e(b.id)}"><summary><span class="vn-code"><bdi>${e(b.cost_center)}</bdi></span><span class="vn-name"><strong>${e(projectName(b.project_id))}</strong><small>من ${day(b.valid_from)} لين ${day(b.valid_until)}</small></span><span class="vn-flags"><strong>المتاح ${fig(b.available_minor)} ريال${over?' — تجاوز السقف':''}</strong>${badge}</span></summary><div class="vn-body">
    ${b.allowed_actions.length?`<div class="operation-actions">${b.allowed_actions.map(a=>button(a,b.id,labels[a])).join('')}</div>`:''}
    ${ui.table({head:['البند','المبلغ (ريال)'],rows})}
    ${b.released_minor?`<p class="subtle">تحرّر بالإقفال على المستلم والمرتجع ${fig(b.released_minor)}، ورجع للمتاح.</p>`:''}
    <p class="subtle measure">${e(b.evidence)}</p>${history}</div></details>`;
  };
  const group=(title,rows)=>rows.length?`<section class="vn-group"><h2>${e(title)} <span>${rows.length}</span></h2>${rows.map(budgetCard).join('')}</section>`:'';
  const decide=data.budgets.filter(b=>b.allowed_actions.includes('approve')),rest=data.budgets.filter(b=>!decide.includes(b));
  const grants=data.grants.map(g=>`<li class="${g.revoked_at?'is-old':''}"><strong>${e(projectName(g.project_id))}</strong><span>${e(personName(g.user_id))} · ${g.revoked_at?'مسحوب':`لين <time datetime="${e(g.ends_at)}">${e(riyadhDay(g.ends_at))}</time>`}</span>${g.can_revoke?`<div class="operation-actions">${button('revoke',g.id,labels.revoke)}</div>`:''}</li>`).join('');
  return `<section class="panel panel-body vn-head">${controls?`<div class="operation-actions">${controls}</div>`:''}<p>المتاح = سقف المخصص − المحجوز بالترسية − الملتزم بأوامر تنتظر فواتيرها − المستهلك بالمطابقة بعد الإشعارات. الإقفال على المستلم والمرتجع يحرّر، والإلغاء يرجّع المستهلك. تسجيل الالتزام مو دفع من البنك.</p></section>
   ${group('ينتظر اعتمادك',decide)}${group('مسودات',rest.filter(b=>b.status==='draft'))}${group('بانتظار مراجعة مستقلة',rest.filter(b=>b.status==='pending'))}${group('سارية',rest.filter(b=>b.status==='active'))}${group('مرفوضة ومقفلة',rest.filter(b=>['rejected','closed'].includes(b.status)))}
   ${data.budgets.length?'':ui.empty('ما فيه مخصصات تقدر تشوفها','منشئ المشروع يمنح نطاقًا لمُعدّ ومراجع ماليين، وبعدها ينعدّ المخصص هنا وينعتمد.')}
   <section class="vn-block"><div class="panel-head"><h2>نطاقات المالية على المشاريع</h2></div>${grants?`<ul class="vn-list">${grants}</ul>`:'<p class="subtle">ما فيه نطاق مالي مسجّل لك — يمنحه منشئ المشروع من «منح نطاق للمالية».</p>'}</section>`;
 },
 form(action,id,data){
  if(action==='grant'){
   if(!data.owned_projects.some(p=>p.id===id)||!data.finance_users.length)throw Error('لازم مشروع تملكه وزميل مالي عنده الصلاحية.');
   return {title:labels.grant,idempotent:true,endpoint:'/projects/'+id+'/finance-scope',fields:[field('user_id','المستخدم المالي','select',{options:data.finance_users.map(u=>({value:u.id,label:u.name}))}),field('ends_at','نهاية التفويض بتوقيت UTC','text',{placeholder:'2026-12-31T23:59:59.000Z'}),field('reason','سبب منح النطاق','textarea')],toPayload:v=>v};
  }
  if(action==='revoke'){const g=data.grants.find(g=>g.id===id&&g.can_revoke);if(!g)throw Error('النطاق غير متاح لك الحين. حدّث الصفحة.');const version=g.version;return {title:labels.revoke,endpoint:'/budget-grants/'+id+'/revoke',fields:[field('reason','سبب السحب','textarea')],toPayload:v=>({...v,version})};}
  if(action==='create'){
   if(!data.permissions.includes('prepare')||!data.projects.length)throw Error('إنشاء المخصص غير متاح لك الحين. حدّث الصفحة.');
   return {title:labels.create,endpoint:'/budgets',idempotent:true,fields:[field('project_id','المشروع','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),field('cost_center','مرجع مركز التكلفة زي ما هو في طلب الشراء'),...values()],toPayload:v=>({...v,currency:'SAR'})};
  }
  const b=data.budgets.find(b=>b.id===id);if(!b?.allowed_actions.includes(action))throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');const version=b.version;
  return {title:labels[action],endpoint:'/budgets/'+id+'/'+action,fields:['edit','revise'].includes(action)?values(b):[field('note','سبب القرار أو دليله','textarea')],toPayload:v=>({...v,version})};
 }
};
