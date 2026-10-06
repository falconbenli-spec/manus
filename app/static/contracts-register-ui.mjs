// سجل العقود التجارية: شروط العقد كما وُقّع، وبنود التزام أدخلها إنسان، وتنبيه قبل موعد الإشعار بعدم التجديد وقبل الانتهاء.
// لا توقيع إلكتروني ولا حجية: التوقيع خارج المنصة، وما هنا مكان حفظ الأصل ومن وقّعه ومتى.
import { dual } from './dates.mjs';
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const labels={edit_contract:'تصحيح المسودة',cancel_contract:'إلغاء المسودة',activate_contract:'إقرار السريان',terminate_contract:'إنهاء العقد',
  decide_renewal:'قرار التجديد',record_amendment:'تسجيل ملحق',add_obligation:'إضافة بند التزام',confirm_amendment:'تأكيد الملحق',
  complete_obligation:'توثيق التنفيذ',verify_obligation:'تحققت من الدليل',deactivate_obligation:'إيقاف البند',activate_obligation:'تفعيل البند'};
const yesNo=[{value:'0',label:'ما يتجدد تلقائيًا'},{value:'1',label:'يتجدد تلقائيًا إذا ما انرسل إشعار'}];
// تنبيه الإشعار بعدم التجديد يُعرض بالأحمر: تفويته يجدّد العقد، بخلاف الانتهاء الذي يمكن تداركه.
const blocking=kind=>kind!=='expiry';
const find=(data,id)=>data.contracts.find(c=>c.id===id);
const findAmendment=(data,id)=>{for(const c of data.contracts){const a=c.amendments.find(x=>x.id===id);if(a)return {c,a};}return null;};
const findObligation=(data,id)=>{for(const c of data.contracts){const o=c.obligations.find(x=>x.id===id);if(o)return {c,o};}return null;};

function partyFields(data,value={}){
  return [field('party_kind','صفة الطرف الآخر','select',{value:value.party_kind??'client',options:Object.entries(data.party_kinds).map(([v,label])=>({value:v,label}))}),
    field('client_id','ملف العميل (إذا الطرف عميل)','select',{required:false,value:value.client_id??'',options:[{value:'',label:'ما ينطبق'},...data.clients.map(c=>({value:c.id,label:`${c.code} · ${c.legal_name}`}))]}),
    field('vendor_id','ملف المورد (إذا الطرف مورد)','select',{required:false,value:value.vendor_id??'',options:[{value:'',label:'ما ينطبق'},...data.vendors.map(v=>({value:v.id,label:`${v.code} · ${v.legal_name}`}))]}),
    field('party_name','اسم الطرف الآخر (للمستقل أو جهة أخرى)','text',{required:false,value:value.party_name??'',hint:'اتركه فاضي إذا الطرف عميل أو مورد مسجل.'})];
}
function contractFields(data,value={}){
  return [...partyFields(data,value),
    field('contract_type','نوع العقد','select',{value:value.contract_type??'master_services',options:Object.entries(data.contract_types).map(([v,label])=>({value:v,label}))}),
    field('subject','موضوع العقد','textarea',{value:value.subject??''}),
    field('start_date','تاريخ السريان','date',{value:value.start_date??''}),
    field('end_date','تاريخ الانتهاء','date',{value:value.end_date??''}),
    field('value','قيمة العقد بالريال','text',{required:false,value:value.value_minor!==null&&value.value_minor!==undefined?(value.value_minor/100).toFixed(2):'',hint:'بالريال السعودي بس. العقد بعملة ثانية: اترك الحقل فاضي واكتب عملته ومبلغه في الموضوع.'}),
    field('auto_renew','شرط التجديد','select',{value:value.auto_renew?'1':'0',options:yesNo}),
    field('notice_days','مهلة الإشعار بعدم التجديد بالأيام','number',{required:false,min:1,max:365,value:value.notice_days??'',hint:'زي ما هي في بند العقد بالحرف. مطلوبة إذا التجديد تلقائي؛ وتفويتها يجدد العقد غصب عن الشركة.'}),
    field('renewal_note','نص شرط التجديد زي ما هو في العقد','textarea',{required:false,value:value.renewal_note??''}),
    field('scope_baseline_id','خط أساس النطاق المرتبط','select',{required:false,value:value.scope_baseline_id??'',options:[{value:'',label:'بدون ربط'},...data.baselines.map(b=>({value:b.id,label:b.name}))]}),
    // صفقة العقد وبندا الدعم (الحزمة 4، الترحيل 184): البندان من نص العقد، وفارغان إذا العقد ما يذكرهما.
    field('case_id','صفقة العقد (إذا الطرف عميل)','select',{required:false,value:value.case_id??'',options:[{value:'',label:'بدون صفقة'},...(data.deals??[]).map(d=>({value:d.id,label:`${d.ref} · ${d.name}`}))],hint:'الصفقة المتعاقد عليها اللي يحفظ هالسجل اتفاقها. لكل صفقة سجل واحد.'}),
    field('support_response_hours','مهلة الرد الأول على بلاغ العميل بالساعات (من بند العقد)','number',{required:false,min:1,max:2160,value:value.support_response_hours??'',hint:'إذا العقد ما يذكرها اتركها فاضية، وتسري القيمة المعتمدة.'}),
    field('warranty_days','أيام الضمان بعد قبول المخرج (من بند العقد)','number',{required:false,min:0,max:3650,value:value.warranty_days??'',hint:'إذا العقد ما يذكرها اتركها فاضية، وتسري القيمة المعتمدة.'}),
    // سلسلة التجديد (الترحيل 185): العقد السابق الذي يجدّده هذا العقد، من عقود العميل السارية.
    field('renews_id','يجدّد العقد','select',{required:false,value:value.renews_id??'',options:[{value:'',label:'عقد جديد مو تجديد'},...(data.contracts??[]).filter(c=>c.party_kind==='client'&&c.status==='active'&&c.id!==value.id).map(c=>({value:c.id,label:`${c.number} · ${c.party_display} · لين ${c.effective_end_date}`}))],hint:'إذا هذا العقد يجدّد عقدًا ساريًا لنفس العميل. لكل عقد عقد تجديد واحد.'}),
    // اتفاق الصفقة الذي يوثّقه العقد (الترحيل 182): لعميل العقد نفسه، ومرة واحدة في السجل؛ وبه يوقف الإنهاءُ ما بعده على الصفقة.
    field('commercial_contract_id','اتفاق الصفقة اللي يوثّقه العقد (إذا الطرف عميل)','select',{required:false,value:value.commercial_agreement?.id??'',
      options:[{value:'',label:'ما يوثّق صفقة في المنصة'},...(value.commercial_agreement?[{value:value.commercial_agreement.id,label:`${value.commercial_agreement.deal_name} — اتفاق الصفقة ${value.commercial_agreement.deal_ref}`}]:[]),...(data.agreements??[]).map(k=>({value:k.id,label:k.label}))],
      hint:'لنفس عميل العقد. إنهاء العقد بعدها يوقف على الصفقة تقديم المخرجات وطلبات التغيير والاستحقاقات الجديدة وجدولات الفوترة الدورية.'}),
    field('owner_id','مالك العقد','select',{value:value.owner_id??'',options:[{value:'',label:'اختيار المالك'},...data.people.filter(p=>p.id!==data.user_id).map(p=>({value:p.id,label:p.name}))],hint:'المالك هو اللي يقر سريان السجل؛ واللي يسجّله ما يكون مالكه.'}),
    field('original_location','مكان حفظ الأصل الموقّع','textarea',{value:value.original_location??'',hint:'وين الأصل الورقي أو الملف الموقّع ومين يحفظه.'}),
    field('signed_for_company','من وقّع عن الشركة','text',{required:false,value:value.signed_for_company??''}),
    field('signed_for_party','من وقّع عن الطرف الآخر','text',{required:false,value:value.signed_for_party??''}),
    field('signed_on','تاريخ التوقيع','date',{required:false,value:value.signed_on??''})];
}
const contractPayload=v=>({party_kind:v.party_kind,client_id:v.party_kind==='client'?v.client_id:null,vendor_id:v.party_kind==='vendor'?v.vendor_id:null,
  party_name:['client','vendor'].includes(v.party_kind)?'':v.party_name,contract_type:v.contract_type,subject:v.subject,start_date:v.start_date,end_date:v.end_date,
  value:v.value||'',auto_renew:v.auto_renew==='1',notice_days:v.auto_renew==='1'&&v.notice_days?Number(v.notice_days):null,renewal_note:v.renewal_note||'',
  scope_baseline_id:v.scope_baseline_id||null,owner_id:v.owner_id,original_location:v.original_location,
  case_id:v.party_kind==='client'&&v.case_id?v.case_id:null,support_response_hours:v.support_response_hours?Number(v.support_response_hours):null,warranty_days:v.warranty_days!==''&&v.warranty_days!==undefined?Number(v.warranty_days):null,
  renews_id:v.party_kind==='client'&&v.renews_id?v.renews_id:null,
  commercial_contract_id:v.party_kind==='client'&&v.commercial_contract_id?v.commercial_contract_id:null,
  signed_for_company:v.signed_for_company||'',signed_for_party:v.signed_for_party||'',signed_on:v.signed_on||''});

export const contractsRegisterUI={
  title:'سجل العقود والالتزامات',
  description:'عقود العملاء والموردين والمستقلين وتراخيص البرمجيات: شروطها ومواعيدها وشروط تجديدها، وبنود الالتزام اللي يكتبها إنسان بمالك وموعد ودليل يتحقق منه غيره. مو عقود الموظفين، والتوقيع برّا المنصة.',
  load:api=>api('/contracts-register'),
  render(data,{e,button,money,ui=kit(e)}){
    const actionsOf=(list,id)=>list.length?`<div class="operation-actions">${list.map(a=>button(a,id,labels[a])).join('')}</div>`:'';
    const obligation=o=>`<li class="${o.state==='overdue'?'is-late':!o.active||o.state==='fulfilled'?'is-old':o.actions.length?'is-decision':''}">
      <strong>${e(o.title)} · ${e(o.category_name)}</strong>
      <span>البند ${e(o.clause_reference)} · ${e(o.cadence_name)} · المالك ${e(o.owner_name)} · ${e(o.state_name)}${o.current_due_date?` · الاستحقاق ${e(dual(o.current_due_date))}`:''}${o.active?'':' · موقوف'}</span>
      <small>الدليل المتوقع: ${e(o.evidence_expected)}.${o.fulfilments.length?` آخر توثيق: ${e(o.fulfilments.at(-1).evidence_reference)} (${o.fulfilments.at(-1).verified_by_name?'تحقق منه شخص ثاني':'ينتظر تحقق شخص ثاني'})`:''}</small>
      ${actionsOf(o.actions,o.id)}</li>`;
    const amendment=(c,a)=>`<li class="${a.confirmed_at?'is-old':''}"><strong>ملحق ${e(a.number)} · ${e(dual(a.signed_on))}</strong>
      <span>${e(a.subject)}</span>
      <small>أثره على القيمة ${e(money(a.value_delta_minor))}${a.new_end_date?` · المدة لين ${e(dual(a.new_end_date))}`:' · بدون أثر على المدة'}${a.confirmed_at?' · مؤكد':` · ينتظر تأكيد ${e(a.approved_by_name)}، وما له أثر قبله`} · الأصل: ${e(a.original_location)}</small>
      ${actionsOf(a.actions,a.id)}</li>`;
    const card=c=>`<details class="vn-card"><summary><span class="vn-code"><bdi dir="ltr">${e(c.number)}</bdi></span><span class="vn-name"><strong>${e(c.party_display)} — ${e(c.contract_type_name)}</strong><small>${e(c.status_name)} · لين ${e(c.effective_end_date)}${c.auto_renew?` · تجديد تلقائي بإشعار ${e(c.notice_days)} يوم`:''}</small></span><span class="vn-flags">${c.alert?`<span class="vn-flag ${blocking(c.alert.kind)?'is-block':''}">${e(c.alert.title)}</span>`:''}</span></summary>
      <div class="vn-body">
        ${c.alert?`<div class="vn-alert ${blocking(c.alert.kind)?'is-block':''}"><strong>${e(c.alert.title)}</strong><p>${e(c.alert.detail)}</p></div>`:''}
        ${c.state==='terminated'&&c.commercial_agreement?`<p class="subtle">انتهى العقد، فوقف على صفقته تقديم المخرجات وطلبات التغيير والاستحقاقات الجديدة، وانتهت جدولات فوترتها الدورية. وما استُحق قبل الإنهاء يُحصَّل في مساره.</p>`:''}
        ${actionsOf(c.actions,c.id)}
        <dl class="detail-data">
          <div><dt>الطرف</dt><dd>${e(c.party_kind_name)}: ${e(c.party_display)}</dd></div>
          <div><dt>الموضوع</dt><dd>${e(c.subject)}</dd></div>
          <div><dt>السريان</dt><dd>${e(dual(c.start_date))} — ${e(dual(c.effective_end_date))}${c.effective_end_date!==c.end_date?` (تمدد بملحق من ${e(c.end_date)})`:''}</dd></div>
          <div><dt>القيمة السارية</dt><dd>${c.effective_value_minor===null?'ما انسجلت':e(money(c.effective_value_minor,c.currency))}</dd></div>
          <div><dt>شرط التجديد</dt><dd>${c.auto_renew?`تلقائي · آخر موعد للإشعار بعدم التجديد ${e(dual(c.notice_deadline))}`:'ما يتجدد تلقائيًا'}</dd></div>
          <div><dt>المالك</dt><dd>${e(c.owner_name)}</dd></div>
          ${c.deal?`<div><dt>صفقة العقد</dt><dd><bdi>${e(c.deal.ref)}</bdi> · ${e(c.deal.name)}</dd></div>`:''}
          ${c.renews||c.renewed_by||c.renewal_opportunity?`<div><dt>التجديد</dt><dd>${[c.renews?`يجدّد <bdi>${e(c.renews.number)}</bdi>`:'',c.renewed_by?`تجدد بـ <bdi>${e(c.renewed_by.number)}</bdi>`:'',c.renewal_opportunity?`فرصة التجديد «${e(c.renewal_opportunity.name)}» عند ${e(c.renewal_opportunity.owner_name)}`:''].filter(Boolean).join(' · ')}</dd></div>`:''}
          ${c.support_response_hours||c.warranty_days!==null&&c.warranty_days!==undefined?`<div><dt>بنود الدعم</dt><dd>${c.support_response_hours?`أول رد خلال ${e(c.support_response_hours)} ساعة`:'مهلة الرد ما يذكرها العقد'} · ${c.warranty_days!==null&&c.warranty_days!==undefined?`ضمان ${e(c.warranty_days)} يوم بعد قبول المخرج`:'الضمان ما يذكره العقد'}</dd></div>`:''}
          ${c.commercial_agreement?`<div><dt>اتفاق الصفقة</dt><dd>${e(c.commercial_agreement.deal_name)} · <bdi>${e(c.commercial_agreement.deal_ref)}</bdi> <a class="btn outline small" href="#commercial">افتح الصفقة</a></dd></div>`:''}
          <div><dt>الأصل الموقّع</dt><dd>${e(c.original_location)}${c.signed_on?` · انوقّع ${e(dual(c.signed_on))}`:' · بدون تاريخ توقيع'}${c.signed_for_company?` · عن الشركة ${e(c.signed_for_company)}`:''}${c.signed_for_party?` · عن الطرف الآخر ${e(c.signed_for_party)}`:''}</dd></div>
        </dl>
        ${c.renewal_note?`<p class="subtle measure">شرط التجديد زي ما هو في العقد: ${e(c.renewal_note)}</p>`:''}
        ${c.renewal_decisions.length?`<section class="vn-block"><h3>قرارات التجديد</h3><ul class="vn-list">${c.renewal_decisions.map(d=>`<li><strong>${e(d.decision_name)} — دورة تنتهي ${e(d.term_end_date)}</strong>${d.notice_reference?`<span>مرجع الإشعار: ${e(d.notice_reference)}</span>`:''}<small>${e(d.note)}</small></li>`).join('')}</ul></section>`:''}
        <section class="vn-block"><h3>الملاحق</h3>${c.amendments.length?`<ul class="vn-list">${c.amendments.map(a=>amendment(c,a)).join('')}</ul>`:'<p class="subtle">ما فيه ملاحق. العقد الساري ما يتعدل؛ أي تغيير عليه ملحق مرقّم يعتمده شخص غير اللي سجّله.</p>'}</section>
        <section class="vn-block"><h3>بنود الالتزام</h3>${c.obligations.length?`<ul class="vn-list">${c.obligations.map(obligation).join('')}</ul>`:'<p class="subtle">ما فيه بنود مدخلة. كل بند ينكتب من نص العقد بمالكه وموعده ودليله.</p>'}</section>
      </div></details>`;
    const settings=data.alert_settings;
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${settings?`<p class="subtle">مهل التنبيه الحالية: قبل الانتهاء ${e(settings.expiry_lead_days)} يوم · قبل آخر موعد للإشعار ${e(settings.notice_lead_days)} يوم · قبل استحقاق البند ${e(settings.obligation_lead_days)} يوم — السند: ${e(settings.basis)}</p>`
        :`<div class="vn-alert is-block"><strong>مهل التنبيه ما انضبطت.</strong><p>ما يصدر أي تنبيه انتهاء أو تجديد قبل ما يدخل المالك مهله بسندها.</p></div>`}
      ${data.contracts[0]?.signature_note?`<p class="subtle">${e(data.contracts[0].signature_note)}</p>`:''}
      <div class="operation-actions">${data.can_manage?button('set_alerts','','ضبط مهل التنبيه'):''}${data.can_manage?button('create_contract','','تسجيل عقد'):''}</div></section>`;
    const list=data.contracts.slice().sort((a,b)=>(a.alert?a.alert.priority:9)-(b.alert?b.alert.priority:9)||a.effective_end_date.localeCompare(b.effective_end_date)).map(card).join('');
    return `${head}
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.totals.all,'عقد في السجل')}${ui.tile(data.totals.in_force,'ساري','is-ok')}${ui.tile(data.totals.notice,'تنبيه إشعار بعدم التجديد',data.totals.notice?'is-late':'')}${ui.tile(data.totals.alerts,'تنبيه مفتوح',data.totals.alerts?'is-due':'')}${ui.tile(data.totals.obligations,'بند التزام فعّال')}${ui.tile(data.totals.obligations_late,'بند متأخر',data.totals.obligations_late?'is-late':'')}</div></section>
      ${list||ui.empty('ما فيه عقود في السجل للحين','العقد ينسجل بشروطه ومواعيده ومكان أصله الموقّع، ومالكه يقر سريانه.')}`;
  },
  form(action,id,data){
    if(action==='set_alerts'){guard(data.can_manage);const s=data.alert_settings;
      return {title:'مهل التنبيه',endpoint:'/contracts-register/settings',fields:[
        field('notice_lead_days','تنبيه قبل آخر موعد للإشعار بعدم التجديد (يوم)','number',{min:1,max:365,value:s?.notice_lead_days??'',hint:'هذي أهم مهلة: بعد ما يفوت موعد الإشعار يتجدد العقد غصب عن الشركة.'}),
        field('expiry_lead_days','تنبيه قبل انتهاء العقد (يوم)','number',{min:1,max:365,value:s?.expiry_lead_days??''}),
        field('obligation_lead_days','تنبيه قبل استحقاق بند الالتزام (يوم)','number',{min:1,max:365,value:s?.obligation_lead_days??''}),
        field('basis','سند هالمهل ومين أقرّها','textarea',{value:s?.basis??'',hint:'اكتب مين قرر هالأرقام ومتى وعلى أي أساس.'})],
        toPayload:v=>({expiry_lead_days:Number(v.expiry_lead_days),notice_lead_days:Number(v.notice_lead_days),obligation_lead_days:Number(v.obligation_lead_days),basis:v.basis,version:s?.version??null})};}
    if(action==='create_contract'){guard(data.can_manage);
      return {title:'تسجيل عقد',endpoint:'/contracts-register',idempotent:true,fields:contractFields(data),toPayload:contractPayload};}
    if(action==='confirm_amendment'){const hit=findAmendment(data,id);guard(hit&&hit.a.actions.includes('confirm_amendment'));
      return {title:`تأكيد ملحق ${hit.a.number} — ${hit.c.number}`,endpoint:`/contracts-register/amendments/${id}/confirm_amendment`,
        fields:[field('note','إقرارك باعتماد الملحق ووش اطلعت عليه','textarea',{hint:'بتأكيدك يسري أثر الملحق على قيمة العقد ومدته.'})],toPayload:v=>v};}
    if(['complete_obligation','verify_obligation','deactivate_obligation','activate_obligation'].includes(action)){
      const hit=findObligation(data,id);guard(hit&&hit.o.actions.includes(action));
      if(action==='complete_obligation')return {title:`توثيق تنفيذ — ${hit.o.title}`,endpoint:`/contracts-register/obligations/${id}/complete_obligation`,
        fields:[field('evidence_reference','دليل التنفيذ ومكان حفظه','textarea',{hint:`المتوقع: ${hit.o.evidence_expected}. لا تكتب كلمات مرور ولا بيانات دخول.`})],toPayload:v=>v};
      if(action==='verify_obligation')return {title:`تحقق — ${hit.o.title}`,endpoint:`/contracts-register/obligations/${id}/verify_obligation`,
        fields:[field('note','وش اطلعت عليه','textarea')],toPayload:v=>v};
      return {title:`${labels[action]} — ${hit.o.title}`,endpoint:`/contracts-register/obligations/${id}/${action}`,
        fields:[field('note','السبب','textarea')],toPayload:v=>({version:hit.o.version,note:v.note})};
    }
    const c=find(data,id);guard(c&&c.actions.includes(action));
    if(action==='edit_contract')return {title:`تصحيح مسودة — ${c.number}`,endpoint:`/contracts-register/${id}/edit_contract`,fields:contractFields(data,c),
      toPayload:v=>({...contractPayload(v),version:c.version})};
    if(action==='activate_contract')return {title:`إقرار سريان — ${c.number}`,endpoint:`/contracts-register/${id}/activate_contract`,
      fields:[field('note','إقرارك بملكية العقد ومطابقته للأصل الموقّع','textarea',{hint:'بإقرارك تصير مالك هالعقد ومواعيده، وبعدها السجل ما يتعدل؛ أي تغيير يكون ملحق مرقّم.'})],toPayload:v=>({version:c.version,note:v.note})};
    if(action==='cancel_contract')return {title:`إلغاء مسودة — ${c.number}`,endpoint:`/contracts-register/${id}/cancel_contract`,
      fields:[field('note','سبب الإلغاء','textarea')],toPayload:v=>({version:c.version,note:v.note})};
    if(action==='terminate_contract')return {title:`إنهاء — ${c.number}`,endpoint:`/contracts-register/${id}/terminate_contract`,
      fields:[field('note','سند الإنهاء ومرجع الإشعار','textarea',c.commercial_agreement?{hint:c.commercial_agreement.stops_on_termination}:{})],toPayload:v=>({version:c.version,note:v.note})};
    if(action==='decide_renewal')return {title:`قرار تجديد — ${c.number}`,endpoint:`/contracts-register/${id}/decide_renewal`,
      fields:[field('decision','القرار','select',{options:Object.entries(data.renewal_decisions).map(([v,label])=>({value:v,label}))}),
        field('notice_reference','مرجع الإشعار المرسل','text',{required:false,hint:'مطلوب مع «عدم التجديد»: رقم الخطاب أو البريد وتاريخه.'}),
        field('note','أساس القرار','textarea')],toPayload:v=>({decision:v.decision,notice_reference:v.notice_reference||'',note:v.note})};
    if(action==='record_amendment')return {title:`ملحق على — ${c.number}`,endpoint:`/contracts-register/${id}/record_amendment`,idempotent:true,
      fields:[field('signed_on','تاريخ الملحق','date'),field('subject','موضوع الملحق وأثره','textarea'),
        field('value_delta','أثره على القيمة بالريال','text',{required:false,hint:'الزيادة موجبة والنقص بسالب، أو اتركه فاضي إذا ما يمس القيمة.'}),
        field('new_end_date','المدة الجديدة (إذا مدّها)','date',{required:false}),
        field('original_location','مكان حفظ أصل الملحق الموقّع','textarea'),
        field('approved_by','مين اعتمد الملحق','select',{options:[{value:'',label:'اختيار المعتمد'},...data.people.filter(p=>p.id!==data.user_id).map(p=>({value:p.id,label:p.name}))],hint:'هو يأكده في المنصة، وأثره ما يسري قبل تأكيده.'})],
      toPayload:v=>({signed_on:v.signed_on,subject:v.subject,value_delta:v.value_delta||'',new_end_date:v.new_end_date||'',original_location:v.original_location,approved_by:v.approved_by})};
    return {title:`بند التزام على — ${c.number}`,endpoint:`/contracts-register/${id}/add_obligation`,idempotent:true,
      fields:[field('category','نوع البند','select',{options:Object.entries(data.obligation_categories).map(([v,label])=>({value:v,label}))}),
        field('title','البند','text'),field('clause_reference','رقم البند في العقد','text'),
        field('detail','نص البند زي ما قريته','textarea',{required:false}),
        field('owner_id','مالك البند','select',{options:[{value:'',label:'اختيار المالك'},...data.people.map(p=>({value:p.id,label:p.name}))]}),
        field('cadence','التكرار','select',{options:Object.entries(data.cadences).map(([v,label])=>({value:v,label}))}),
        field('first_due_date','أول استحقاق','date'),
        field('evidence_expected','دليل التنفيذ المتوقع','textarea',{hint:'وش يثبت التنفيذ ومين يتحقق منه.'})],
      toPayload:v=>v};
  }
};
