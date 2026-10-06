// شاشتا استحقاق الإجازات والمزايا. الصدق أولًا: لا قاعدة استحقاق هنا إلا ما أدخله مدير الموارد البشرية
// بمصدره وتاريخ تأكيده، ولا اتصال بشركة تأمين، ولا بيان طبي واحد في أي حقل.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const yesNo=[{value:'yes',label:'نعم'},{value:'no',label:'لا'}];
const flag=value=>value?'yes':'no';
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
// القيم التي تتغير تُرسم مجدولة الأرقام: التاريخ في <time> بنصه كما هو، والعدد الخالص بـdata-num، والأيام التي قد تكون
// سالبة (تسوية، رصيد) في ltr فتبقى الإشارة قبل الرقم في السطر العربي. والرمز اللاتيني (رمز نوع، رقم وثيقة) معزول بـ<bdi>.
const when=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const days=(e,n)=>`<span class="ltr">${e(n)}</span>`;
// رمز لاتيني داخل جملة عربية من الخادم (رقم وثيقة، رمز نوع، معرّف سياسة) يُعزل وحده؛ النص نفسه لا يتغير حرفًا.
const latin=(e,text)=>e(text).replace(/(?<![&#\w])(?=[\w.\-\/]*[A-Za-z])[A-Za-z0-9][\w.\-\/]*[A-Za-z0-9](?![\w;])/g,m=>`<bdi>${m}</bdi>`);
// ما ينتظر من صاحب التصريح، بعنوان يقول نوعه: قرار في الاستحقاق، وإجراء لدى شركة التأمين في المزايا.
const alerts=(e,list,title)=>list.length?`<section class="panel panel-body"><h2>${title}</h2><ul class="vn-list">${list.map(a=>`<li><strong>${latin(e,a.message)}</strong></li>`).join('')}</ul></section>`:'';

function policyBlock(data,{e,button,ui}){
  const add=data.can_prepare?`<div class="operation-actions">${button('prepare_accrual_policy','','إدخال قاعدة استحقاق ومصدرها')}</div>`:'';
  if(!data.policies.length)return `<section class="panel panel-body"><h2>قواعد الاستحقاق</h2>${ui.empty('ما فيه قاعدة استحقاق للحين','موظف الموارد البشرية المخوّل يدخل القاعدة بمصدرها، ومدير الموارد البشرية يعتمدها. وقبلها ما ينحسب استحقاق.')}${add}</section>`;
  // حالة القاعدة بعبارة القاموس الواحد عبر ui.statusBadge: القاعدة المعتمدة هي «approved» فيه. مُعدّ المسودة ظاهر ما دامت مسودة،
  // فمنه يُعرف من يراجعها؛ والقاعدة المقررة تُعرض بنصها ومصدرها وحدهما.
  return `<section class="panel panel-body"><h2>قواعد الاستحقاق (${num(e,data.policies.length)})</h2>
    <p class="subtle measure">${latin(e,data.legal_review)} مالك الاعتماد: ${latin(e,data.acceptance_owner)}.</p>
    <ul class="vn-list">${data.policies.map(p=>`<li><strong>${e(p.title)} · <bdi>${e(p.leave_type)}</bdi></strong>
      ${ui.statusBadge(p.status==='accepted'?'approved':p.status)}
      <span>${num(e,p.accrual_days)} يوم ${e(p.unit_name)} · ${e(p.start_name)}${p.accrual_start==='after_period'?` (${num(e,p.waiting_days)} يوم)`:''}</span>
      <span>الترحيل: ${p.carryover_allowed?`مسموح بسقف ${num(e,p.carryover_cap_days)} يوم`:'مو مسموح'} · الصرف النقدي عند نهاية الخدمة: ${p.cash_on_end_of_service?'نعم':'لا'}</span>
      <span class="subtle">سارية من ${when(e,p.effective_from)} · المصدر: ${e(p.basis)} · تاريخ تأكيد المصدر: ${when(e,p.basis_confirmed_on)}</span>
      ${p.decided_by_name?'':`<span class="subtle">أعدّها ${e(p.prepared_by_name??'—')}</span>`}
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(action=>button(action,p.id,{edit_accrual_policy:'تعديل المسودة',accept_accrual_policy:'اعتماد القاعدة',reject_accrual_policy:'رفض القاعدة'}[action])).join('')}</div>`:''}</li>`).join('')}</ul>
    ${add}</section>`;
}
function runsBlock(data,{e,button}){
  // المستثنى من تشغيلٍ باسمه حين يكون في القائمة، وإلا فمعرّفه معزولًا. والمستثنون مطويّون بعددهم: قد يكونون عشرات.
  const nameOf=id=>data.employees.find(x=>x.id===id)?.name,who=id=>nameOf(id)?e(nameOf(id)):`<bdi>${e(id)}</bdi>`;
  return `<section class="panel panel-body"><h2>التشغيلات المؤرخة (${num(e,data.runs.length)})</h2>
    <p class="subtle measure">الاستحقاق والترحيل وانتهاء الصلاحية ما تجري من نفسها: كل فترة لها تشغيل مؤرخ يعتمده مدير الموارد البشرية، وإعادة تشغيل نفس الفترة ما تكرر الحركة.</p>
    ${data.runs.length?`<ul class="vn-list">${data.runs.map(r=>`<li><strong>${e(r.kind_name)} · <bdi>${e(r.leave_type)}</bdi> · ${when(e,r.period_key)}</strong>
      <span>الموظفين ${num(e,r.employees)} · الأيام ${days(e,r.days)} · يوم التشغيل ${when(e,r.run_date)} · شغّله ${e(r.accepted_by_name??'—')}</span>
      <span class="subtle">${e(r.note)}</span>
      ${r.skipped.length?`<details><summary>المستثنون من التشغيل (${num(e,r.skipped.length)})</summary><ul>${r.skipped.map(s=>`<li>${who(s.employee_id)} — ${e(s.reason)}</li>`).join('')}</ul></details>`:''}</li>`).join('')}</ul>`:'<p class="subtle">مدير الموارد البشرية يشغّل كل فترة إذا اكتملت، وللحين ما انشغّل شي.</p>'}
    ${data.can_accept&&data.leave_types.length?`<div class="operation-actions">${button('run_accrual_cycle','','تشغيل استحقاق أو ترحيل أو انتهاء صلاحية')}${button('record_adjustment','','تسوية يدوية بسبب مكتوب')}</div>`:''}</section>`;
}
function balancesBlock(data,{e,ui},hr){
  // لمن لا يرى إلا رصيده، الرصيد هو جواب الشاشة: فراغه حالة فارغة بخطوتها التالية. ولصاحب التصريح سطر قصير بين أقسامه.
  if(!data.balances.length)return `<section class="panel panel-body"><h2>الأرصدة</h2>${hr?'<p class="subtle">الرصيد هنا مجموع حركات مقيدة، مو رقم ينكتب فوقه، وللحين ما فيه حركات.</p>'
    :ui.empty('ما فيه رصيد مستحق لك للحين','رصيدك يتجمع من حركات الاستحقاق اللي يشغّلها مدير الموارد البشرية لكل فترة.')}</section>`;
  // من اعتمد حركة الاستحقاق محفوظ في سجل التدقيق وفي قائمة التشغيلات؛ هنا الحركة وأساسها. التسوية اليدوية وحدها تسمّي من سوّاها،
  // فهو من يُسأل عنها.
  return `<section class="panel panel-body"><h2>الأرصدة المشتقة من الحركات (${num(e,data.balances.length)})</h2>
    ${data.balances.map(b=>`<article class="vn-block"><h3>${b.employee_name?e(b.employee_name):`<bdi>${e(b.employee_id)}</bdi>`} · <bdi>${e(b.leave_type)}</bdi> · ${num(e,b.balance_year)}</h3>
      <dl class="detail-data"><div><dt>المستحق</dt><dd>${days(e,b.entitled_days)} يوم</dd></div><div><dt>المستخدم</dt><dd>${days(e,b.used_days)} يوم</dd></div><div><dt>المصروف نقدًا</dt><dd>${days(e,b.payout_days)} يوم</dd></div><div><dt>الرصيد</dt><dd>${days(e,b.balance_days)} يوم</dd></div></dl>
      <ul class="vn-list">${b.movements.map(m=>`<li><strong>${e(m.kind_name)} ${days(e,m.days)} يوم</strong><span>${when(e,m.effective_date)}${m.kind==='adjustment'&&m.approved_by_name?` · سوّاها ${e(m.approved_by_name)}`:''}</span><span class="subtle">${latin(e,m.source)}</span></li>`).join('')}</ul></article>`).join('')}</section>`;
}

export const leaveAccrualUI={
  title:'استحقاق الإجازات',
  description:'استحقاق أرصدة الإجازات وترحيلها وانتهاؤها، بقواعد مؤرخة يعتمدها مدير الموارد البشرية بمصدرها. طلب الإجازة نفسه في شاشة «الإجازات»، والصرف النقدي في مسير الرواتب.',
  load:api=>api('/leave-accrual'),
  render(data,context){
    const {e,button}=context,ui=context.ui??kit(e),hr=(data.permissions??[]).length>0;
    const total=data.balances.reduce((n,b)=>n+Number(b.balance_days),0);
    const accepted=data.policies.filter(p=>p.status==='accepted').length,drafts=data.policies.filter(p=>p.status==='draft').length;
    // القواعد والتشغيلات لا تصل إلا لحامل تصريح سياسات الموارد البشرية؛ عند غيره لا تُرسم أصفارها ولا «ما فيه قاعدة» لا تصدق عليه،
    // ويبقى له رصيده. والبلاطة لا تتلوّن إلا بحال قائم: المسودة المنتظرة انتباه وعبارتها تقول حالها، والصفر والمعتمد بلا لون.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${hr?`${tile(e,accepted,'قاعدة معتمدة')}
        ${tile(e,drafts,'مسودة بانتظار مدير الموارد البشرية',drafts?'is-due':'')}
        ${tile(e,data.runs.length,'تشغيل مؤرخ')}`:''}
        ${tile(e,data.balances.length,'رصيد مشتق من حركاته')}
        ${tile(e,Math.round(total*1000)/1000,'مجموع أيام الرصيد')}
      </div></section>
      ${hr?`${alerts(e,data.alerts,'اللي ينتظر قرار')}
      ${policyBlock(data,{e,button,ui})}
      ${runsBlock(data,{e,button})}`:''}
      ${balancesBlock(data,{e,ui},hr)}`;
  },
  form(action,id,data){
    const policyFields=values=>[
      field('leave_type','رمز نوع الإجازة',"text",{value:values.leave_type??'',hint:'رمز بحروف إنجليزية صغيرة مثل ما هو في وحدة الإجازات، مثل synthetic_annual.'}),
      field('title','عنوان القاعدة','text',{value:values.title??''}),
      field('body','نص القاعدة كما اعتمدتها الشركة','textarea',{value:values.body??''}),
      field('accrual_unit','وحدة الاستحقاق','select',{value:values.accrual_unit??'',options:data.units.map(x=>({value:x.key,label:x.name}))}),
      field('accrual_days','مقدار الاستحقاق بالأيام','text',{value:values.accrual_days??'',hint:'رقم بثلاث خانات عشرية بالكثير، مثل 2.5. ما فيه قيمة افتراضية.'}),
      field('accrual_start','متى يبدأ الاستحقاق','select',{value:values.accrual_start??'',options:data.starts.map(x=>({value:x.key,label:x.name}))}),
      field('waiting_days','عدد أيام الفترة قبل بدء الاستحقاق','number',{required:false,value:values.waiting_days??'',hint:'خلّه فاضي إذا الاستحقاق من تاريخ التعيين.'}),
      field('carryover_allowed','يترحّل الرصيد؟','select',{value:values.carryover_allowed??'',options:yesNo}),
      field('carryover_cap_days','سقف الترحيل بالأيام','text',{required:false,value:values.carryover_cap_days??'',hint:'مطلوب إذا الترحيل مسموح.'}),
      field('cash_on_end_of_service','ينصرف نقد عند نهاية الخدمة؟','select',{value:values.cash_on_end_of_service??'',options:yesNo}),
      field('basis','مصدر القاعدة','textarea',{value:values.basis??'',hint:'المرجع اللي أخذت منه القاعدة: قرار الشركة أو المادة النظامية. راجعه على نظام العمل ولائحته.'}),
      field('basis_confirmed_on','تاريخ تأكيدك للمصدر','date',{value:values.basis_confirmed_on??''}),
      field('effective_from','تاريخ سريان القاعدة','date',{value:values.effective_from??''})
    ];
    const toPolicyPayload=v=>({leave_type:v.leave_type,title:v.title,body:v.body,accrual_unit:v.accrual_unit,accrual_days:String(v.accrual_days??''),
      accrual_start:v.accrual_start,waiting_days:Number(v.waiting_days||0),carryover_allowed:v.carryover_allowed==='yes',
      carryover_cap_days:String(v.carryover_cap_days??''),cash_on_end_of_service:v.cash_on_end_of_service==='yes',
      basis:v.basis,basis_confirmed_on:v.basis_confirmed_on,effective_from:v.effective_from});
    if(action==='prepare_accrual_policy'){
      guard(data.can_prepare);
      return {title:'قاعدة استحقاق جديدة',endpoint:'/leave-accrual/policies',idempotent:true,fields:policyFields({}),toPayload:toPolicyPayload};
    }
    if(action==='edit_accrual_policy'){
      const p=data.policies.find(x=>x.id===id);guard(p&&p.actions.includes('edit_accrual_policy'));
      return {title:`تعديل مسودة — ${p.title}`,endpoint:`/leave-accrual/policies/${id}`,
        fields:policyFields({...p,carryover_allowed:flag(p.carryover_allowed),cash_on_end_of_service:flag(p.cash_on_end_of_service),waiting_days:p.waiting_days||'',carryover_cap_days:p.carryover_cap_days??''}),
        toPayload:v=>({version:p.version,...toPolicyPayload(v)})};
    }
    if(action==='accept_accrual_policy'||action==='reject_accrual_policy'){
      const p=data.policies.find(x=>x.id===id);guard(p&&p.actions.includes(action));
      const accept=action==='accept_accrual_policy';
      return {title:`${accept?'اعتماد':'رفض'} قاعدة — ${p.title}`,endpoint:`/leave-accrual/policies/${id}/${accept?'accept':'reject'}`,
        fields:[field('note',accept?'أساس اعتمادك ومراجعتك':'سبب الرفض','textarea',{hint:accept?'إذا اعتمدتها، تصير هذي القاعدة أساس كل حركة استحقاق بعدها. راجعها على نظام العمل ولائحته.':''})],
        toPayload:v=>({note:v.note})};
    }
    if(action==='run_accrual_cycle'){
      guard(data.can_accept&&data.leave_types.length);
      return {title:'تشغيل مؤرخ',endpoint:'/leave-accrual/runs',idempotent:true,
        fields:[field('kind','نوع التشغيل','select',{options:data.run_kinds.map(k=>({value:k.key,label:k.name}))}),
          field('leave_type','نوع الإجازة','select',{options:data.leave_types.map(t=>({value:t,label:t}))}),
          field('period_key','الفترة','text',{hint:'شهر مثل 2026-03 أو سنة مثل 2026، حسب وحدة القاعدة المعتمدة. الترحيل وانتهاء الصلاحية بالسنة.'}),
          field('note','سبب التشغيل وسنده','textarea')],
        toPayload:v=>({kind:v.kind,leave_type:v.leave_type,period_key:v.period_key,note:v.note})};
    }
    if(action==='record_adjustment'){
      guard(data.can_accept&&data.leave_types.length);
      return {title:'تسوية يدوية على الرصيد',endpoint:'/leave-accrual/adjustments',idempotent:true,
        fields:[field('employee_id','الموظف','select',{options:data.employees.map(x=>({value:x.id,label:x.name}))}),
          field('leave_type','نوع الإجازة','select',{options:data.leave_types.map(t=>({value:t,label:t}))}),
          field('effective_date','تاريخ سريان التسوية','date'),
          field('days','أيام التسوية','text',{hint:'موجبة للإضافة وسالبة للخصم، مثل 1.5 أو ‎-2.'}),
          field('reason','سبب التسوية وسندها','textarea',{hint:'السبب ينحفظ مع الحركة ومع اللي سوّاها، ويظهر مع الرصيد.'})],
        toPayload:v=>({employee_id:v.employee_id,leave_type:v.leave_type,effective_date:v.effective_date,days:String(v.days??''),reason:v.reason})};
    }
    guard(false);
  }
};

export const benefitsUI={
  title:'التأمين الطبي والمزايا',
  description:'وثيقة التأمين الطبي الجماعي، ومين مسجّل فيها من الموظفين وتابعيهم، وتنبيهات الانتهاء والإضافة والحذف.',
  load:api=>api('/benefits'),
  render(data,context){
    const {e,button}=context,ui=context.ui??kit(e),manage=!!data.can_manage;
    const open=data.enrolments.filter(x=>x.status!=='removed'),active=data.policies.filter(p=>!p.expired).length,requested=data.enrolments.filter(x=>x.status==='requested').length;
    // الوثيقة السارية بلا لون (الحال الطبيعي صامت)؛ المنتهية توقّف والقريبة من الانتهاء انتباه، وعبارتهما في الشارة.
    const policies=data.policies.length?`<ul class="vn-list">${data.policies.map(p=>`<li><strong>${e(p.insurer_name)} · وثيقة <bdi>${e(p.policy_number)}</bdi></strong>
      <span class="badge${p.expired?' is-late':p.expiring?' is-due':''}">${e(p.expired?'منتهية':p.expiring?'قرّبت تنتهي':'سارية')}</span>
      <span>من ${when(e,p.effective_from)} إلى ${when(e,p.effective_to)} · التنبيه قبل ${num(e,p.renewal_notice_days)} يوم</span>
      <span>الفئات: ${latin(e,p.tiers.join('، '))}</span>${p.note?`<span class="subtle">${e(p.note)}</span>`:''}
      ${p.actions.length?`<div class="operation-actions">${p.actions.map(action=>button(action,p.id,action==='update_medical_policy'?'تحديث بيانات الوثيقة':'تسجيل موظف في الوثيقة')).join('')}</div>`:''}</li>`).join('')}</ul>`
      :'<p class="subtle">وثيقة التأمين يسجّلها مسؤول المزايا مثل ما هي عند شركة التأمين، وللحين ما انسجّلت.</p>';
    // التابعون بيانات أطراف ثالثة: تصل لحامل التصريح وحده، وتُطوى تحت عددها فلا تنكشف في كل صف.
    const tierOf=t=>/^فئة/.test(t)?latin(e,t):`فئة ${latin(e,t)}`;
    const list=data.enrolments.length?`<ul class="vn-list">${data.enrolments.map(x=>{
      const acts=(x.actions??[]).map(action=>button(action,x.id,{confirm_enrolment:'تسجيل تأكيد الشركة',remove_enrolment:'تسجيل الحذف من الوثيقة',add_dependant:'إضافة تابع'}[action])).join('')+(x.dependants??[]).filter(d=>!d.removed_on).map(d=>button('remove_dependant',d.id,`حذف تابع (${d.relation_name})`)).join('');
      return `<li><strong>${x.employee_name?e(x.employee_name):`<bdi>${e(x.employee_id)}</bdi>`} · ${tierOf(x.tier)}</strong>
      <span class="badge">${e(x.status_name)}</span>
      <span>انرسلت الإضافة ${when(e,x.requested_on)}${x.confirmed_on?` · أكّدتها الشركة ${when(e,x.confirmed_on)}`:''}${x.member_reference?` · العضوية <bdi>${e(x.member_reference)}</bdi>`:''}${x.removed_on?` · انحذف ${when(e,x.removed_on)}`:''}</span>
      ${x.removal_reason?`<span class="subtle">${e(x.removal_reason)}</span>`:''}
      ${x.dependants?(x.dependants.length?`<details><summary>التابعون (${num(e,x.dependants.length)})</summary><ul class="vn-list">${x.dependants.map(d=>`<li><strong>${e(d.relation_name)}</strong><span>مواليد ${when(e,d.birth_date)}${d.removed_on?` · انحذف ${when(e,d.removed_on)}`:''}</span></li>`).join('')}</ul></details>`:'<span>ما فيه تابعين مسجّلين</span>'):''}
      ${acts?`<div class="operation-actions">${acts}</div>`:''}</li>`;}).join('')}</ul>`
      :ui.empty(manage?'ما فيه تسجيلات للحين':'ما أنت مسجّل في التأمين للحين',manage?'سجّل الموظفين من زر «تسجيل موظف في الوثيقة» بعد ما تضيفهم عند شركة التأمين.':'مسؤول المزايا يضيفك عند شركة التأمين ويسجّل الإضافة هنا.');
    const policiesSection=`<section class="panel panel-body"><h2>وثائق التأمين</h2>${policies}${manage?`<div class="operation-actions">${button('record_medical_policy','','تسجيل وثيقة تأمين')}</div>`:''}</section>`;
    const enrolSection=`<section class="panel panel-body"><h2>${manage?'التسجيلات':'تسجيلي'}</h2>${list}
        <p class="subtle">${manage?'بيانات التابعين: صلة القرابة وتاريخ الميلاد بس، وما تظهر إلا لحامل تصريح المزايا، ولا تطلع في أي تقرير أو تصدير.':'بيانات التابعين ما تظهر هنا إلا لحامل تصريح التأمين الطبي والمزايا.'}</p></section>`;
    // لصاحب التصريح: ما ينتظره ثم الوثائق ثم التسجيلات. ولمن يرى تسجيله وحده: تسجيله أولًا، فهو ما فتح الشاشة له. وبلاطة
    // التنبيهات لا تُرسم لمن لا تصله التنبيهات أصلًا، فلا يقرأ صفرًا لا يصدق عليه.
    return `<section class="panel panel-body vn-head"><p>${e(data.connection_note)}</p><p>${e(data.privacy_note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">
        ${tile(e,active,'وثيقة سارية')}
        ${tile(e,open.length,'تسجيل قائم')}
        ${tile(e,requested,'بانتظار تأكيد الشركة',requested?'is-due':'')}
        ${manage?tile(e,data.alerts.length,'تنبيه يحتاج إجراء برّا المنصة',data.alerts.length?'is-due':''):''}
      </div></section>
      ${manage?`${alerts(e,data.alerts,'اللي ينتظر إجراء')}
      ${policiesSection}
      ${enrolSection}`:`${enrolSection}
      ${policiesSection}`}`;
  },
  form(action,id,data){
    const policyFields=values=>[
      field('insurer_name','شركة التأمين','text',{value:values.insurer_name??''}),
      field('policy_number','رقم الوثيقة','text',{value:values.policy_number??''}),
      field('effective_from','تاريخ السريان','date',{value:values.effective_from??''}),
      field('effective_to','تاريخ الانتهاء','date',{value:values.effective_to??''}),
      {name:'tiers',label:'الفئات المتاحة في الوثيقة',type:'rows',minRows:1,maxRows:20,value:(values.tiers??[]).map(t=>({tier:t})),columns:[{name:'tier',label:'اسم الفئة كما في الوثيقة'}]},
      field('renewal_notice_days','التنبيه قبل الانتهاء بكم يوم','number',{value:values.renewal_notice_days??'',hint:'مهلة تشغيلية تحددها أنت، وما لها قيمة افتراضية.'}),
      field('note','ملاحظة على الوثيقة','textarea',{required:false,value:values.note??'',hint:'لا تكتب هنا أي معلومة طبية أو مطالبة علاج.'})
    ];
    const toPolicyPayload=v=>({insurer_name:v.insurer_name,policy_number:v.policy_number,effective_from:v.effective_from,effective_to:v.effective_to,
      tiers:(v.tiers??[]).map(r=>r.tier).filter(Boolean),renewal_notice_days:Number(v.renewal_notice_days||0),note:v.note??''});
    if(action==='record_medical_policy'){
      guard(data.can_manage);
      return {title:'تسجيل وثيقة تأمين جماعي',endpoint:'/benefits/policies',idempotent:true,fields:policyFields({}),toPayload:toPolicyPayload};
    }
    if(action==='update_medical_policy'){
      const p=data.policies.find(x=>x.id===id);guard(p&&data.can_manage);
      return {title:`تحديث وثيقة — ${p.policy_number}`,endpoint:`/benefits/policies/${id}`,fields:policyFields(p),toPayload:v=>({version:p.version,...toPolicyPayload(v)})};
    }
    if(action==='record_enrolment'){
      const p=data.policies.find(x=>x.id===id);guard(p&&data.can_manage);
      return {title:`تسجيل موظف — وثيقة ${p.policy_number}`,endpoint:'/benefits/enrolments',idempotent:true,
        fields:[field('employee_id','الموظف','select',{options:data.employees.map(x=>({value:x.id,label:x.name}))}),
          field('tier','فئة التغطية','select',{options:p.tiers.map(t=>({value:t,label:t}))}),
          field('requested_on','تاريخ إرسال الإضافة إلى الشركة','date',{hint:'الإضافة تصير عند شركة التأمين برّا المنصة، وهنا تسجّلها.'})],
        toPayload:v=>({policy_id:p.id,employee_id:v.employee_id,tier:v.tier,requested_on:v.requested_on})};
    }
    if(action==='confirm_enrolment'){
      const x=data.enrolments.find(r=>r.id===id);guard(x&&(x.actions??[]).includes(action));
      return {title:`تأكيد الشركة — ${x.employee_name??x.employee_id}`,endpoint:`/benefits/enrolments/${id}/confirm`,
        fields:[field('confirmed_on','تاريخ تأكيد الشركة','date'),field('member_reference','رقم العضوية لدى الشركة','text')],
        toPayload:v=>({version:x.version,confirmed_on:v.confirmed_on,member_reference:v.member_reference})};
    }
    if(action==='remove_enrolment'){
      const x=data.enrolments.find(r=>r.id===id);guard(x&&(x.actions??[]).includes(action));
      return {title:`تسجيل الحذف من الوثيقة — ${x.employee_name??x.employee_id}`,endpoint:`/benefits/enrolments/${id}/remove`,
        fields:[field('removed_on','تاريخ الحذف لدى الشركة','date'),field('reason','سبب الحذف','textarea',{hint:'سبب إداري بس: نهاية خدمة أو نقل. لا تكتب أي معلومة طبية.'})],
        toPayload:v=>({version:x.version,removed_on:v.removed_on,reason:v.reason})};
    }
    if(action==='add_dependant'){
      const x=data.enrolments.find(r=>r.id===id);guard(x&&(x.actions??[]).includes(action));
      return {title:`إضافة تابع — ${x.employee_name??x.employee_id}`,endpoint:`/benefits/enrolments/${id}/dependants`,idempotent:true,
        fields:[field('relation','صلة القرابة','select',{options:data.relations.map(r=>({value:r.key,label:r.name}))}),
          field('birth_date','تاريخ الميلاد','date',{hint:'صلة القرابة وتاريخ الميلاد بس — بدون اسم ولا هوية ولا أي بيان صحي.'}),
          field('added_on','تاريخ الإضافة لدى الشركة','date')],
        toPayload:v=>({enrolment_id:x.id,relation:v.relation,birth_date:v.birth_date,added_on:v.added_on})};
    }
    if(action==='remove_dependant'){
      const x=data.enrolments.find(r=>(r.dependants??[]).some(d=>d.id===id));guard(x&&data.can_manage);
      const d=x.dependants.find(y=>y.id===id);
      return {title:'حذف تابع من الوثيقة',endpoint:`/benefits/dependants/${id}/remove`,
        fields:[field('removed_on','تاريخ الحذف لدى الشركة','date')],
        toPayload:v=>({version:d.version,removed_on:v.removed_on})};
    }
    guard(false);
  }
};
