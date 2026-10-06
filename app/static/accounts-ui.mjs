const roleNames={employee:'موظف',manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشروع',admin:'مسؤول المنصة'};
const stepNames={department_manager:'مدير الإدارة',hr:'معتمد الموارد البشرية',it:'معتمد تقنية المعلومات',pm:'مدير المشروع'};
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const csvHint='الأعمدة: username,name,department_id,role,manager_username — سطر لكل موظف. الأدوار: employee, manager, hr, it, pm. المدير يجب أن يكون من الإدارة نفسها ويمكن أن يرد في أي سطر من الملف.';

export const accountsUI={
 title:'الموظفون والصلاحيات',
 description:'إضافة الموظفين أو استيرادهم دفعة وحدة، وتحديد إداراتهم ومديريهم ومعتمدي كل إدارة. هذي الشاشة ما تفتح لك معاملات الموظفين.',
 async load(api){return api('/admin/accounts');},
 render(data,{e,button}){
  const deptName=id=>data.departments.find(d=>d.id===id)?.name||id;
  // زرّ يتكرر في كل صف («تعديل»، «سحب»): اسمه المسموع يحمل صفّه ويبدأ بنصّه الظاهر (WCAG 2.5.3)، ونصّه الظاهر يبقى فعلَ زرّ الحوار.
  const named=(html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
  // رأس كل عمود مقرون بعموده، وعمود الأفعال بلا عنوان مرئي يُسمّى للقارئ الآلي وحده (محسّن الجوال لا يكتب له تسمية).
  const th=label=>label?`<th scope="col">${e(label)}</th>`:'<th scope="col" aria-label="الإجراء"></th>';
  const userName=id=>data.users.find(u=>u.id===id)?.name||'—';
  const active=data.users.filter(u=>u.active);
  const pending=active.filter(u=>u.must_change_password).length;
  const stats=`<div class="acc-stats"><article><strong>${active.length}</strong><span>حساب نشط</span></article><article><strong>${data.departments.length}</strong><span>إدارة</span></article><article><strong>${pending}</strong><span>بانتظار تغيير كلمة المرور المؤقتة</span></article><article class="${data.gaps.length?'warn':''}"><strong>${data.gaps.length}</strong><span>مسار اعتماد يحتاج تعيين</span></article></div>`;
  const gaps=data.gaps.length?`<section class="panel acc-gaps"><div class="panel-head"><div><h2>مسارات اعتماد تحتاج قرارك</h2><p>هذي الخطوات لها أكثر من مرشّح أو ما لها مرشّح، فطلباتها واقفة. عيّن معتمدًا واحدًا لكل خطوة.</p></div></div><div class="panel-body acc-gap-list">${data.gaps.map(g=>`<div class="acc-gap"><span><strong>${e(deptName(g.department_id))}</strong> · ${e(stepNames[g.step_role])} · ${g.candidates?`${g.candidates} مرشحين`:'ما فيه حساب بهذا الدور'}</span>${named(button('routing',g.department_id,'تعيين'),`تعيين: ${stepNames[g.step_role]} في ${deptName(g.department_id)}`)}</div>`).join('')}</div></section>`:'';
  const departments=`<section class="panel"><div class="panel-head"><div><h2>الإدارات ومعتمدوها</h2><p>المعتمد المعيّن ينستخدم بدل البحث عن حساب وحيد بالدور.</p></div><div class="operation-actions">${button('department','','إدارة جديدة')}</div></div><div class="table-wrap"><table><thead><tr>${['الإدارة','الموظفون','المديرون','المعتمدون المعيّنون',''].map(th).join('')}</tr></thead><tbody>${data.departments.map(d=>`<tr><td><strong>${e(d.name)}</strong><br><code translate="no">${e(d.id)}</code></td><td>${d.members}</td><td>${d.managers}</td><td>${data.routing.filter(r=>r.department_id===d.id).map(r=>`<span class="badge">${e(stepNames[r.step_role])}: ${e(userName(r.user_id))}</span>`).join(' ')||'<span class="subtle">ما فيه</span>'}</td><td class="acc-actions">${named(button('routing',d.id,'المعتمدون'),`المعتمدون: ${d.name}`)}${named(button('rename',d.id,'تسمية'),`تسمية: ${d.name}`)}</td></tr>`).join('')}</tbody></table></div></section>`;
  const people=`<section class="panel"><div class="panel-head"><div><h2>الحسابات</h2><p>${data.users.length} حساب. الحساب الجديد يغيّر كلمة المرور المؤقتة أول ما يدخل.</p></div><div class="acc-actions">${button('create','','إضافة موظف')}${button('import','','استيراد CSV')}</div></div><div class="panel-body"><label class="acc-filter"><span class="sr-only">دوّر في الحسابات</span><input type="search" data-filter="#accounts-table" placeholder="بالاسم أو اسم المستخدم أو الإدارة" autocomplete="off" spellcheck="false"></label></div><div class="table-wrap"><table id="accounts-table"><thead><tr>${['الاسم','الإدارة','الدور','المدير المباشر','الحالة',''].map(th).join('')}</tr></thead><tbody>${data.users.map(u=>`<tr data-filter-text="${e([u.name,u.username,deptName(u.department_id),roleNames[u.role]].join(' '))}" class="${u.active?'':'is-inactive'}"><td><strong>${e(u.name)}</strong><br><code>${e(u.username)}</code></td><td>${e(deptName(u.department_id))}</td><td>${e(roleNames[u.role]||u.role)}</td><td>${e(u.manager_id?userName(u.manager_id):'—')}</td><td>${u.active?(u.must_change_password?'<span class="badge pending">كلمة مؤقتة</span>':'<span class="badge approved">نشط</span>'):'<span class="badge inactive">موقوف</span>'}</td><td class="acc-actions">${u.role==='admin'?'':named(button('edit',u.id,'تعديل'),`تعديل: ${u.name}`)+named(button('reset',u.id,'كلمة مؤقتة'),`كلمة مؤقتة: ${u.name}`)}</td></tr>`).join('')}</tbody></table></div></section>`;
  const accessPanel=(()=>{
   const access=data.access;if(!access)return '';
   const levels={super:'أدمن أول',scoped:'أدمن محدد'};
   const rows=access.users.filter(x=>x.active).map(x=>`<tr><td><strong>${e(x.name)}</strong><br><code>${e(x.username)}</code></td><td>${e(roleNames[x.role]||x.role)}${x.admin_level?` · <span class="badge approved">${e(levels[x.admin_level])}</span>`:''}</td><td>${x.grants.map(g=>`<span class="badge">${e(g.name)}${g.department_id?` · ${e(deptName(g.department_id))}`:''}</span>`).join(' ')||'<span class="subtle">بلا تصاريح إضافية</span>'}</td><td class="acc-actions">${access.can_manage_access&&x.id!==access.actor_id?`${named(button('matrix',x.id,'مصفوفة الصلاحيات'),`مصفوفة الصلاحيات: ${x.name}`)}${named(button('grant',x.id,'منح منفرد'),`منح تصريح منفرد: ${x.name}`)}${x.grants.length?named(button('revoke',x.id,'سحب'),`سحب تصريح: ${x.name}`):''}${x.role==='admin'?named(button('level',x.id,'مستوى الإدارة'),`مستوى الإدارة: ${x.name}`):''}`:''}</td></tr>`).join('');
   return `<section class="panel"><div class="panel-head"><div><h2>مصفوفة الصلاحيات</h2><p>امنح حزمة شاملة آمنة، أو اختر صلاحيات مخصصة. الصلاحيات الحساسة والمحصورة ما تدخل في الشامل، وفصل المهام يُفحص على الخادم.</p></div></div><div class="table-wrap"><table><thead><tr>${['الحساب','الدور','التصاريح الممنوحة',''].map(th).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${access.can_manage_access?'':'<div class="panel-body"><p class="subtle">منح التصاريح وسحبها للأدمن الأول بس.</p></div>'}</section>`;
 })();
 return stats+gaps+people+accessPanel+departments;
 },
 form(action,id,data){
  const access=data.access;
  if(['grant','revoke','level','matrix'].includes(action)){
   if(!access?.can_manage_access)throw Error('منح التصاريح متاح للأدمن الأول');
   const person=access.users.find(x=>x.id===id);
   if(!person)throw Error('الحساب غير متاح');
   if(action==='matrix'){
    const choices=access.capabilities.filter(c=>(person.role==='admin'?c.admin:!c.admin)&&!person.defaults.includes(c.key)).map(c=>({
      value:c.key,label:`${c.group} · ${c.name}${c.sensitive?' · حساس':''}${c.scoped?' · يحتاج نطاق إدارة':''}${c.controlled?' · قرار مستقل':''}`
    }));
    return {title:'مصفوفة صلاحيات '+person.name,endpoint:'/access/matrix',fields:[
      field('mode','طريقة منح الصلاحيات','select',{options:[
        {value:'comprehensive',label:'شامل — الحزمة العامة الآمنة'},
        {value:'custom',label:'مخصص — أحدد الصلاحيات بنفسي'}
      ],hint:'الشامل يستبعد الصلاحيات الحساسة والمحصورة وقرارات الاعتماد. اختر مخصص إذا احتجت صلاحية بعينها.'}),
      field('capability_keys','الصلاحيات المخصصة','checks',{required:false,showWhen:{name:'mode',equals:['custom']},options:choices,hint:'تُقرأ هذه الاختيارات في الوضع المخصص. الخادم يرفض الجمع بين الإعداد والاعتماد للشخص نفسه.'}),
      field('department_id','نطاق الإدارة للصلاحيات المحصورة','select',{required:false,showWhen:{name:'mode',equals:['custom']},value:person.department_id||'',options:[{value:'',label:'اختر عند الحاجة'},...data.departments.filter(d=>d.active!==false).map(d=>({value:d.id,label:d.name}))]}),
      field('note','سبب المنح','textarea',{hint:'يُحفظ السبب في سجل التدقيق.',minLength:3})],
      toPayload:v=>({user_id:id,mode:v.mode,capability_keys:Array.isArray(v.capability_keys)?v.capability_keys:[],department_id:v.department_id||null,note:v.note||''}),
      live:v=>v.mode==='comprehensive'?'<strong>الشامل:</strong> يمنح الحزمة العامة الآمنة فقط، ويترك الحساس والمحصور والاعتمادات للاختيار المخصص.':'<strong>المخصص:</strong> يمنح اختياراتك بعد فحص فصل المهام والنطاق على الخادم.'};
   }
   if(action==='grant')return {title:'منح تصريح لـ'+person.name,endpoint:'/access/grants',fields:[
     field('capability','التصريح','select',{options:access.capabilities.filter(c=>!person.defaults.includes(c.key)&&!person.grants.some(g=>g.capability===c.key)).map(c=>({value:c.key,label:`${c.group} · ${c.name}${c.scoped?' — يقبل نطاق إدارة':' — عام'}`}))}),
     field('department_id','حصر التصريح بإدارة (اختياري)','select',{required:false,hint:'اختر إدارة فقط للتصريح الموصوف بأنه يقبل نطاق إدارة؛ التصريح العام لا يدعم هذا القيد.',options:[{value:'',label:'كل الإدارات'},...data.departments.filter(d=>d.active!==false).map(d=>({value:d.id,label:d.name}))]}),
     field('note','سبب المنح','textarea',{required:false})],
     toPayload:v=>({user_id:id,capability:v.capability,department_id:v.department_id||null,note:v.note||''})};
   if(action==='revoke')return {title:'سحب تصريح من '+person.name,endpoint:'/access/grants/'+(person.grants[0]?.id||'')+'/revoke',fields:[
     field('grant_id','التصريح','select',{options:person.grants.map(g=>({value:g.id,label:g.name+(g.department_id?' · '+g.department_id:'')}))}),
     field('reason','سبب السحب','textarea')],
     dynamicEndpoint:v=>'/access/grants/'+v.grant_id+'/revoke',toPayload:v=>({reason:v.reason})};
   return {title:'مستوى الإدارة لـ'+person.name,endpoint:'/access/admins/'+id,method:'PATCH',fields:[
     field('admin_level','المستوى','select',{options:[{value:'',label:'ليس مسؤول منصة'},...access.admin_levels.map(l=>({value:l.key,label:l.name}))],value:person.admin_level||''}),
     field('reason','السبب','textarea',{required:false})],
     toPayload:v=>({admin_level:v.admin_level,reason:v.reason||''})};
  }
  const departments=data.departments.map(d=>({value:d.id,label:d.name}));
  const managers=[{value:'',label:'بدون مدير مباشر'},...data.users.filter(u=>u.active&&u.role==='manager').map(u=>({value:u.id,label:`${u.name} — ${data.departments.find(d=>d.id===u.department_id)?.name||u.department_id}`}))];
  const roles=data.roles.map(r=>({value:r,label:roleNames[r]}));
  const password=field('temporary_password','كلمة مرور مؤقتة (8 أحرف على الأقل، ليست أرقامًا فقط)','text',{hint:'سلّمها للموظف بقناة آمنة. سيُطلب منه تغييرها عند أول دخول.'});
  if(action==='create')return {title:'إضافة موظف',endpoint:'/admin/accounts',idempotent:true,fields:[field('name','الاسم الكامل'),field('username','اسم المستخدم (إنجليزي صغير)','text',{placeholder:'s.alharbi'}),field('department_id','الإدارة','select',{options:departments}),field('role','الدور','select',{options:roles}),field('manager_id','المدير المباشر','select',{options:managers,required:false}),password],toPayload:v=>({...v,username:v.username.trim().toLowerCase(),manager_id:v.manager_id||null})};
  if(action==='import')return {title:'استيراد موظفين من CSV',endpoint:'/admin/accounts/import',fields:[field('csv','الصق محتوى ملف CSV','textarea',{maxLength:200000,hint:csvHint,placeholder:'username,name,department_id,role,manager_username\nhead-marketing2,مدير التسويق,marketing,manager,\nr.alqahtani,ريم القحطاني,marketing,employee,head-marketing'}),],
    toPayload:v=>({...v,temporary_password:''}),
    // لكل حساب كلمته المؤقتة، تُولَّد عند الاستيراد وتُعرض هنا **مرة واحدة**. لا تُخزَّن بنصّها ولا
    // تُكتب في سجل التدقيق، فلا سبيل إلى استرجاعها بعد إغلاق هذه النافذة — تُسلَّم لأصحابها أو
    // تُعاد للحساب من «إعادة تعيين كلمة المرور».
    after:(r,e)=>({title:`تم إنشاء ${e(r.created)} حساب`,html:`<p>سلّم كل موظف كلمته المؤقتة بقناة يثق بها. `
      +`<strong>تُعرض مرة واحدة</strong> ولا تُحفظ بنصّها؛ ومن فاتته تُعاد له من «إعادة تعيين كلمة المرور».</p>`
      +`<p class="subtle">لكل حساب كلمة تخصّه: كلمة واحدة مشتركة تعني أن كل مستورَد يملك مفتاح حساب زميله.</p>`
      +`<table class="table"><thead><tr><th scope="col">اسم المستخدم</th><th scope="col">كلمة المرور المؤقتة</th></tr></thead><tbody>`
      +(r.credentials||[]).map(c=>`<tr><td><bdi dir="ltr">${e(c.username)}</bdi></td><td><bdi dir="ltr"><code>${e(c.temporary_password)}</code></bdi></td></tr>`).join('')
      +`</tbody></table><div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`})};
  if(action==='department')return {title:'إدارة جديدة',endpoint:'/admin/departments',fields:[field('id','المعرف (إنجليزي صغير وشرطة)','text',{placeholder:'customer-care'}),field('name','اسم الإدارة')],toPayload:v=>({id:v.id.trim().toLowerCase(),name:v.name})};
  const department=data.departments.find(d=>d.id===id);
  if(action==='rename'){if(!department)throw Error('الإدارة غير متاحة');return {title:'تسمية الإدارة',endpoint:'/admin/departments/'+id,method:'PATCH',fields:[field('name','اسم الإدارة','text',{value:department.name})],toPayload:v=>v};}
  if(action==='routing'){
   if(!department)throw Error('الإدارة غير متاحة');
   const candidates=data.users.filter(u=>u.active&&u.department_id===id&&['manager','hr','it','pm'].includes(u.role));
   return {title:'معتمدو '+department.name,endpoint:'/admin/routing',fields:[field('step_role','خطوة الاعتماد','select',{options:data.routing_roles.map(r=>({value:r,label:stepNames[r]}))}),field('user_id','المعتمد','select',{options:[{value:'',label:'إلغاء التعيين'},...candidates.map(u=>({value:u.id,label:`${u.name} (${roleNames[u.role]})`}))],required:false,hint:'مدير الإدارة يجب أن يكون بدور مدير، ومعتمد الموارد البشرية بدور موارد بشرية، وهكذا.'})],toPayload:v=>({department_id:id,step_role:v.step_role,user_id:v.user_id||null})};
  }
  const user=data.users.find(u=>u.id===id);
  if(!user||user.role==='admin')throw Error('الحساب غير متاح');
  if(action==='edit')return {title:'تعديل '+user.name,endpoint:'/admin/accounts/'+id,method:'PATCH',fields:[field('name','الاسم','text',{value:user.name}),field('department_id','الإدارة','select',{options:departments,value:user.department_id}),field('role','الدور','select',{options:roles,value:user.role}),field('manager_id','المدير المباشر','select',{options:managers.filter(m=>m.value!==id),value:user.manager_id||'',required:false}),field('active','الحالة','select',{options:[{value:'true',label:'نشط'},{value:'false',label:'موقوف'}],value:String(user.active)})],toPayload:v=>({name:v.name,department_id:v.department_id,role:v.role,manager_id:v.manager_id||null,active:v.active==='true'})};
  if(action==='reset')return {title:'كلمة مرور مؤقتة لـ '+user.name,endpoint:'/admin/accounts/'+id+'/password',fields:[password],toPayload:v=>v};
  throw Error('الإجراء غير متاح');
 }
};
