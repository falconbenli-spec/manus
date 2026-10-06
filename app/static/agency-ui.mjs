// تشغيل الوكالة: ملفات العملاء، الباقات التجارية، قوالب المشاريع، وساعات العمل.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
// إنهاء العلاقة وإعادة الفتح (الحزمة 4، P4-CRM-7): لوحة في بطاقة العميل، و«بانتظار قراري»، ونماذجها — في ملفها.
import { offboardingSection, offboardingAwaitingSection, offboardingForm, OFFBOARDING_ACTIONS } from './client-offboarding-ui.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const optional={required:false};
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const hours=minutes=>`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;

/* ───── هوية العميل قبل الحفظ (P4-CRM-1، CRM-01) ───── */
// رقم السجل منسوخ على كل صفقة تنفتح للعميل، فبعد أول صفقة يثبت (الخادم يرفض تغييره: registration_fixed).
const registrationFixed=c=>!!c.registration_number&&c.cases.length>0;
// «إنشاء جهة برقم سجل مكرر يعرض تعارضًا قبل الحفظ»: النموذج يسأل قارئ الخادم (/clients/conflicts) وهو يُكتب، والحفظ يسأله مرة ثانية.
const CONFLICT_WORDS={registration_number:'رقم السجل نفسه',legal_name:'نفس الاسم القانوني ولو اختلفت كتابته',trade_name:'نفس الاسم التجاري ولو اختلفت كتابته'};
export const CONFLICT_DELAY=350;
export const conflictQuery=values=>{
  const query=new URLSearchParams();
  for(const key of ['legal_name','trade_name','registration_number']){const value=String(values?.[key]??'').trim();if([...value].length>=3)query.set(key,value);}
  return query.toString();
};
// جواب القارئ بكلام واضح: الملف القائم برمزه، واسمه إن كان السائل في فريقه، وسبب التعارض، ومسؤوله الذي يُسأل. except: الملف نفسه حين يُصحَّح رقمه.
export function clientConflictNotice(answer,{except=''}={}){
  const found=(answer?.conflicts??[]).filter(c=>!except||c.client_id!==except);
  if(!found.length)return {blocking:false,head:'ما لقينا ملف عميل ثاني بهالاسم ولا بهالرقم.',items:[],next:''};
  return {blocking:true,head:found.length===1?'فيه ملف عميل لنفس الجهة، فما ينفتح ملف ثاني:':`فيه ${found.length} ملفات عملاء لنفس الجهة، فما ينفتح ملف ثاني:`,
    items:found.map(c=>({code:c.code,text:`${c.name?` «${c.name}»`:''} — ${c.reasons.map(r=>CONFLICT_WORDS[r]??r).join('، ')} · مسؤوله: ${c.owner_name||'مسؤول ملفات العملاء'}`})),
    next:'افتح الملف القائم، وإذا ما كنت في فريق حسابه اطلب من مسؤوله يضيفك. وإذا كانت جهة ثانية فعلًا، اكتب رقم سجلها التجاري.'};
}
// يربط الفحص بنموذج مفتوح: صندوق حالة بعد الحقول (role=status)، وسؤال الخادم عند التغيير، والحفظ موقوف ما دام فيه تعارض.
// النص يُكتب بـtextContent لا بترميز، والرمز معزول بـ<bdi>. رفض مكتوب من القارئ (رقم بشكل غلط) يُقال بكلامه ولا يوقف الحفظ.
export function watchConflicts(form,ask,{names,except=''}={}){
  const doc=form?.ownerDocument;
  if(typeof ask!=='function'||!doc||!names?.length)return null;
  const box=doc.createElement('div'),submit=form.querySelector('button[type="submit"]');
  box.className='notice';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  form.querySelector('.form-grid')?.after(box);
  const line=(tag,text)=>{const node=doc.createElement(tag);node.textContent=text;return node;};
  const paint=notice=>{
    const parts=[line('p',notice.head)];
    if(notice.items.length){
      const list=doc.createElement('ul');list.className='vn-list';
      for(const item of notice.items){const row=doc.createElement('li');row.append(line('bdi',item.code),item.text);list.append(row);}
      parts.push(list);
    }
    if(notice.next)parts.push(line('p',notice.next));
    box.replaceChildren(...parts);
    if(submit)submit.disabled=notice.blocking;
  };
  let timer=null,turn=0;
  const check=async()=>{
    clearTimeout(timer);
    const mine=++turn,query=conflictQuery(Object.fromEntries(names.map(name=>[name,form.elements[name]?.value])));
    if(!query){box.replaceChildren();if(submit)submit.disabled=false;return;}
    let notice;
    try{notice=clientConflictNotice(await ask(`/clients/conflicts?${query}`),{except});}
    catch(error){const r=error?.details?.refusal;notice={blocking:false,head:r?.what??String(error?.message??''),items:[],next:r?.next??''};}
    if(mine===turn)paint(notice);
  };
  for(const name of names){
    const control=form.elements[name];if(!control)continue;
    control.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(check,CONFLICT_DELAY);});
    control.addEventListener('change',check);
  }
  return check;
}

export const clientsUI={
  title:'عملائي',description:'ملف واحد لكل عميل: علاماته وجهات اتصاله وفريق حسابه وسجلاته التجارية ورصيد اشتراكه. ما يشوفه إلا فريق الحساب.',
  // ask: قارئ الخادم نفسه (api)، يحتاجه فحص التكرار في النموذج المفتوح. غير معدود، فلا يدخل ما يُرسم ولا ما يُقارن.
  load:async api=>Object.defineProperty(await api('/clients'),'ask',{value:api}),
  // سجل التعريفات (ترحيل 123): الحقول المخصّصة في موضعيها، والقائمة بأعمدتها ومرشحاتها. بسجل فارغ لا يتغير في البطاقة بايت.
  render(data,{e,button,money,ui=kit(e)}){
    const ENTITY='client';
    const card=c=>`<details class="vn-card"><summary><span class="vn-code"><bdi>${e(c.code)}</bdi></span><span class="vn-name"><strong>${e(c.legal_name)}</strong><small>${e(c.sector)} · مسؤول الحساب ${e(c.owner_name)} · ${e(c.members.length)} عضو</small></span><span class="vn-flags">${c.invoiced_minor!==null?`<span class="vn-flag">مفوتر ${e(money(c.invoiced_minor))}</span>`:''}<span class="badge ${e(c.status==='active'?'approved':'pending')}">${e(c.status_name)}</span></span></summary><div class="vn-body">
      ${ui.fields(ENTITY,c,'header')}<p class="subtle">رقم السجل: ${c.registration_number?`<bdi>${e(c.registration_number)}</bdi>${registrationFixed(c)?' · ثابت: عليه صفقات انفتحت به':''}`:`ما انسجل للحين${c.is_owner?'':` — يسجّله ${e(c.owner_name)}`}`}</p>${c.finance_hidden?'<p class="subtle">الأرقام المالية لأصحاب الصلاحية المالية بس.</p>':''}
      <div class="vn-grid"><section class="vn-block"><h3>العلامات</h3>${c.brands.length?`<ul class="vn-list">${c.brands.map(b=>`<li><strong>${e(b.name)}</strong><small>${e(b.guideline_reference||'بدون مرجع لدليل الهوية')}</small></li>`).join('')}</ul>`:'<p class="subtle">ما فيه علامات.</p>'}</section>
      <section class="vn-block"><h3>جهات الاتصال</h3>${c.contacts.length?`<ul class="vn-list">${c.contacts.map(x=>`<li><strong>${e(x.name)} · ${e(x.title)}</strong><small dir="ltr">${e([x.email,x.phone].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`:'<p class="subtle">ما فيه جهات اتصال.</p>'}</section>
      <section class="vn-block"><h3>فريق الحساب</h3><ul class="vn-list"><li><strong>${e(c.owner_name)}</strong><span>مسؤول الحساب</span></li>${c.members.map(m=>`<li><strong>${e(m.name)}</strong><span>${e(m.role)}</span>${c.is_owner?`<div class="operation-actions">${button('remove_member',`${c.id}:${m.user_id}`,'إخراج من الفريق')}</div>`:''}</li>`).join('')}</ul></section>
      <section class="vn-block"><h3>السجلات التجارية والمشاريع</h3>${c.cases.length?`<ul class="vn-list">${c.cases.map(k=>`<li><strong>${e(k.name)}</strong><span>${e(k.status)}${k.project_id?' · له مشروع':''}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه سجل تجاري مرتبط.</p>'}</section></div>
      ${c.retainers.map(r=>`<section class="vn-block"><h3>${e(r.name)} · ${e(r.period_month)}</h3><div class="table-wrap"><table><thead><tr><th>المخرج</th><th>المتعاقد عليه</th><th>المستهلك</th><th>المتبقي</th></tr></thead><tbody>${r.allowances.map(a=>`<tr><td>${e(a.type)}</td><td>${e(a.quantity)}</td><td>${e(a.used)}</td><td>${a.over?`<span class="vn-flag is-block">تجاوز ${e(-a.remaining)}</span>`:e(a.remaining)}</td></tr>`).join('')}</tbody></table></div><p class="subtle">${e(r.contract_reference)} — ${e(r.carry_over_rule)}</p>${c.offboarding?.closed?'':`<div class="operation-actions">${button('record_usage',r.id,'تسجيل استهلاك')}</div>`}</section>`).join('')}
      ${ui.fields(ENTITY,c,'body')}
      ${offboardingSection(c,{e,button,ui})}
      ${c.offboarding?.closed?'':`<div class="operation-actions">${button('add_brand',c.id,'إضافة علامة')}${button('add_contact',c.id,'إضافة جهة اتصال')}${c.is_owner&&!registrationFixed(c)?button('set_registration',c.id,c.registration_number?'تصحيح رقم السجل':'تسجيل رقم السجل'):''}${c.is_owner?button('add_member',c.id,'إضافة عضو للفريق')+button('link_case',c.id,'ربط سجل تجاري')+button('create_retainer',c.id,'اشتراك شهري')+button('set_status',c.id,'تغيير الحالة'):''}</div>`}</div></details>`;
    return `<section class="panel panel-body vn-head"><p>العميل ما يدخل المنصة؛ هذا ملف داخلي يديره فريق حسابه.</p><div class="operation-actions">${data.can_manage?button('create_client','','ملف عميل جديد'):''}</div></section>${offboardingAwaitingSection(data,{e,button,ui})}${data.clients.length?`<section class="panel panel-body"><h2>قائمة الملفات</h2>${ui.records(ENTITY,data.clients,{id:'client-list',custom:data.custom_columns,columns:[
      {key:'code',label:ui.label(ENTITY,'code','رمز العميل'),value:c=>c.code,html:c=>`<a href="#clients?focus=${e(c.id)}"><bdi>${e(c.code)}</bdi></a>`},
      {key:'legal_name',label:ui.label(ENTITY,'legal_name','الاسم القانوني'),value:c=>c.legal_name},{key:'sector',label:ui.label(ENTITY,'sector','القطاع'),value:c=>c.sector},
      {key:'status',label:ui.label(ENTITY,'status','الحالة'),value:c=>c.status_name},{key:'owner_id',label:ui.label(ENTITY,'owner_id','مسؤول الحساب'),value:c=>c.owner_name}]})}</section>`:''}${data.clients.length?`<section class="vn-group"><h2>ملفات العملاء <span>${data.clients.length}</span></h2>${data.clients.map(card).join('')}</section>`:ui.empty('ما أنت في فريق أي حساب للحين','ملف العميل يطلع لفريق حسابه بس، ومسؤول الحساب يضيفك للفريق.')}`;
  },
  form(action,id,data){
    if(OFFBOARDING_ACTIONS.includes(action))return offboardingForm(action,id,data);
    if(action==='create_client'){guard(data.can_manage);return {title:'ملف عميل جديد',endpoint:'/clients',idempotent:true,fields:[field('legal_name','الاسم القانوني'),field('trade_name','الاسم التجاري','text',optional),
      field('registration_number','رقم السجل التجاري','text',{required:false,hint:'كما في شهادة السجل: أرقام وأحرف لاتينية وشرطة، مثل 1010123456. بالرقم نعرف إنها جهة وحدة ولو اختلفت كتابة الاسم.'}),
      field('sector','القطاع'),field('status','الحالة','select',{options:Object.entries(data.status_names).map(([value,label])=>({value,label}))}),field('notes','ملاحظات','textarea',optional)],toPayload:v=>v,entity:'client',
      opened(form){watchConflicts(form,data.ask,{names:['legal_name','trade_name','registration_number']});}};}
    if(action==='remove_member'){const [clientId,userId]=id.split(':');return {title:'إخراج عضو من فريق الحساب',endpoint:`/clients/${clientId}/remove_member`,fields:[],toPayload:()=>({user_id:userId})};}
    if(action==='record_usage'){const r=data.clients.flatMap(c=>c.retainers).find(x=>x.id===id);guard(r);return {title:`استهلاك — ${r.name} ${r.period_month}`,endpoint:`/clients/retainers/${id}/usage`,fields:[field('deliverable_type','المخرج','select',{options:r.allowances.map(a=>({value:a.type,label:`${a.type} · المتبقي ${a.remaining}`}))}),field('quantity','الكمية','number',{min:1,max:1000,value:1}),field('reference','مرجع المخرج'),field('overage_note','سند التجاوز إذا تعدّى الرصيد','textarea',optional)],toPayload:v=>({deliverable_type:v.deliverable_type,quantity:Number(v.quantity),reference:v.reference,...(v.overage_note?{overage_note:v.overage_note}:{})})};}
    const c=data.clients.find(x=>x.id===id);guard(c);
    // رقم السجل يسجّله مسؤول الحساب على ملف العميل (مساره /registration)، ويثبت بعد أول صفقة.
    if(action==='set_registration'){guard(c.is_owner&&!registrationFixed(c));return {title:`${c.registration_number?'تصحيح':'تسجيل'} رقم السجل — ${c.code}`,endpoint:`/clients/${id}/registration`,
      fields:[field('registration_number','رقم السجل التجاري','text',{value:c.registration_number??'',hint:'كما في شهادة السجل التجاري. بعد أول صفقة تنفتح للعميل يثبت الرقم، لأنه ينسخ عليها.'})],
      toPayload:v=>({registration_number:v.registration_number}),opened(form){watchConflicts(form,data.ask,{names:['registration_number'],except:c.id});}};}
    // تغيير الحالة هو الانتقال المعلن لملف العميل: نموذجه يحمل الحقول المخصّصة الملزَمة عنده. بقية قيم الملف تُعدَّل من «تعديل الحقول المخصّصة» في بطاقته.
    const spec=(title,fields,toPayload=v=>v)=>({title:`${title} — ${c.code}`,endpoint:`/clients/${id}/${action}`,fields,toPayload,...(action==='set_status'?{entity:'client',record:c,transition:'set_status'}:{})});
    if(action==='add_brand')return spec('إضافة علامة',[field('name','اسم العلامة'),field('guideline_reference','مرجع دليل الهوية ومكان حفظه','text',optional)]);
    if(action==='add_contact')return spec('إضافة جهة اتصال',[field('name','الاسم'),field('title','الصفة'),field('email','البريد','email',optional),field('phone','الهاتف','text',optional)]);
    if(action==='add_member')return spec('إضافة عضو لفريق الحساب',[field('user_id','الموظف','select',{options:data.team.map(u=>({value:u.id,label:u.name}))}),field('role','دوره في الحساب')]);
    if(action==='link_case')return spec('ربط سجل تجاري',[field('case_id','السجل','select',{options:data.unlinked_cases.map(k=>({value:k.id,label:k.name}))})]);
    // الإقفال سجلٌّ يعتمده شخص ثانٍ لا حالة تُختار (P4-CRM-7)، فخيار «مقفل» ما يظهر هنا.
    if(action==='set_status')return spec('تغيير حالة العميل',[field('status','الحالة','select',{options:Object.entries(data.status_names).filter(([value])=>value!=='closed').map(([value,label])=>({value,label}))}),field('note','السبب','textarea')]);
    if(action==='create_retainer')return {title:`اشتراك شهري — ${c.code}`,endpoint:'/clients/retainers',idempotent:true,fields:[field('name','اسم الاشتراك'),field('period_month','الشهر','month',{value:data.today.slice(0,7)}),field('allowances','بنود الاشتراك','rows',{columns:[{name:'type',label:'نوع المخرج'},{name:'quantity',label:'الكمية الشهرية',type:'number',min:1,max:1000}],maxRows:20}),field('contract_reference','مرجع بند العقد'),field('carry_over_rule','قاعدة الترحيل والتجاوز زي ما هي في العقد','textarea')],toPayload:v=>({client_id:id,name:v.name,period_month:v.period_month,allowances:v.allowances,contract_reference:v.contract_reference,carry_over_rule:v.carry_over_rule})};
    guard(false);
  }
};

export const offeringsUI={
  title:'الباقات التجارية',description:'اللي تبيعه الوكالة: ست عشرة عائلة خدمات، وكل باقة بمخرجات تنعدّ ومدخلات واستثناءات وحقوق وتعريف قبول، وبدون أسعار مفترضة.',
  load:api=>api('/offerings'),
  render(data,{e,button,money,ui=kit(e)}){
    const byFamily=data.families.map(f=>({...f,rows:data.offerings.filter(o=>o.family===f.key)})).filter(f=>f.rows.length);
    const card=o=>`<details class="vn-card"><summary><span class="vn-code"><bdi>${e(o.code)}</bdi> r${e(o.revision)}</span><span class="vn-name"><strong>${e(o.name)}</strong><small>${e(o.pricing_name)} · ${e(o.content.deliverables.length)} مخرج</small></span><span class="vn-flags">${o.price_minor?`<span class="vn-flag">${e(money(o.price_minor))}</span>`:o.price_hidden?'':'<span class="vn-flag">ينسعّر عند العرض</span>'}<span class="badge ${e(o.status==='approved'?'approved':o.status==='draft'?'pending':o.status==='rejected'?'rejected':'suspended')}">${e({draft:'مسودة',approved:'معتمدة',rejected:'مرفوضة',retired:'مسحوبة'}[o.status])}</span></span></summary><div class="vn-body"><dl class="vn-facts"><div><dt>الجمهور المناسب</dt><dd>${e(o.content.audience)}</dd></div><div><dt>المشكلة</dt><dd>${e(o.content.problem)}</dd></div><div><dt>النطاق</dt><dd>${e(o.content.scope)}</dd></div><div><dt>مدخلات العميل</dt><dd>${e(o.content.inputs)}</dd></div><div><dt>المستثنى</dt><dd>${e(o.content.exclusions)}</dd></div><div><dt>حقوق الاستخدام</dt><dd>${e(o.content.rights)}</dd></div><div><dt>تعريف القبول</dt><dd>${e(o.content.acceptance)}</dd></div><div><dt>المؤشرات</dt><dd>${e(o.content.kpis)}</dd></div></dl>
      <div class="table-wrap"><table><thead><tr><th>المخرج</th><th>الكمية</th><th>الوحدة</th><th>تعديلات</th></tr></thead><tbody>${o.content.deliverables.map(d=>`<tr><td>${e(d.name)}</td><td>${e(d.quantity)}</td><td>${e(d.unit)}</td><td>${e(d.revisions)}</td></tr>`).join('')}</tbody></table></div><div class="operation-actions">${o.actions.map(a=>button(a,o.id,{approve_offering:'اعتماد الباقة',reject_offering:'رفض',revise_offering:'تنقيح بإصدار جديد',retire_offering:'سحب الباقة'}[a])).join('')}</div></div></details>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${data.can_manage?button('prepare_offering','','باقة جديدة'):''}</div></section>${byFamily.map(f=>`<section class="vn-group"><h2>${e(f.name)} <span>${f.rows.length}</span></h2>${f.rows.map(card).join('')}</section>`).join('')||ui.empty('ما فيه باقات للحين','العائلات الست عشرة جاهزة تتعبّى من إدارة الأعمال.')}`;
  },
  form(action,id,data){
    guard(data.can_manage);
    const o=id?data.offerings.find(x=>x.id===id):null;
    if(action==='prepare_offering'||action==='revise_offering'){
      if(action==='revise_offering')guard(o&&o.actions.includes(action));
      const c=o?.content,area=(name,label,value)=>field(name,label,'textarea',{value});
      return {title:o?`تنقيح ${o.code}`:'باقة جديدة',endpoint:o?`/offerings/${id}/revise`:'/offerings',idempotent:true,fields:[field('family','عائلة الخدمة','select',{options:data.families.map(f=>({value:f.key,label:f.name})),value:o?.family}),field('name','اسم الباقة','text',{value:o?.name}),field('pricing_model','نموذج التسعير','select',{options:data.pricing_models.map(m=>({value:m.key,label:m.name})),value:o?.pricing_model}),field('price','السعر (اختياري)','text',{...optional,value:o?.price_minor?(o.price_minor/100).toFixed(2):'',hint:'اتركه فاضي إذا تنسعّر عند العرض.'}),area('audience','الجمهور المناسب',c?.audience),area('problem','المشكلة اللي تحلها',c?.problem),area('scope','النطاق',c?.scope),field('deliverables','المخرجات','rows',{value:c?.deliverables,columns:[{name:'name',label:'المخرج'},{name:'unit',label:'الوحدة'},{name:'quantity',label:'الكمية',type:'number',min:1},{name:'revisions',label:'جولات التعديل',type:'number',min:0,max:20}],maxRows:30}),area('inputs','المدخلات المطلوبة من العميل',c?.inputs),area('exclusions','المستثنى',c?.exclusions),area('rights','حقوق الاستخدام',c?.rights),area('acceptance','تعريف القبول',c?.acceptance),area('kpis','المؤشرات',c?.kpis)],
        toPayload:v=>({family:v.family,name:v.name,pricing_model:v.pricing_model,...(v.price?{price:v.price}:{}),content:{audience:v.audience,problem:v.problem,scope:v.scope,deliverables:v.deliverables,inputs:v.inputs,exclusions:v.exclusions,rights:v.rights,acceptance:v.acceptance,kpis:v.kpis}})};
    }
    guard(o&&o.actions.includes(action));
    return {title:`${o.code} — ${o.name}`,endpoint:`/offerings/${id}/${action}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};
  }
};

export const templatesUI={
  title:'قوالب المشاريع',description:'قالب لكل نوع خدمة بمراحله ومهامه ومعايير قبولها؛ تطبيقه ينشئ مهام المشروع بمواعيدها مرة واحدة.',
  load:api=>api('/project-templates'),
  render(data,{e,button,ui=kit(e)}){
    const card=t=>`<details class="vn-card"><summary><span class="vn-code">${e(t.phases.reduce((n,p)=>n+p.tasks.length,0))} مهمة</span><span class="vn-name"><strong>${e(t.name)}</strong><small>${e(t.service_kind)} · ${e(t.phases.length)} مراحل</small></span><span class="vn-flags"></span></summary><div class="vn-body">${t.phases.map(p=>`<section class="vn-block"><h3>${e(p.name)}</h3><ul class="vn-list">${p.tasks.map(k=>`<li><strong>${e(k.title)}</strong><span>اليوم ${e(k.offset_days)} من البداية</span><small>${e(k.acceptance)}</small></li>`).join('')}</ul></section>`).join('')}<div class="operation-actions">${data.projects.length?button('apply_template',t.id,'تطبيق على مشروع'):''}</div></div></details>`;
    return `<section class="panel panel-body vn-head"><p>المهام تنشأ بقواعد المشاريع نفسها: مالك المشروع بس، والمكلّف عضو فيه.</p><div class="operation-actions">${data.can_create?button('create_template','','قالب جديد'):''}</div></section>${data.templates.length?`<section class="vn-group"><h2>القوالب <span>${data.templates.length}</span></h2>${data.templates.map(card).join('')}</section>`:ui.empty('ما فيه قوالب للحين','القالب يجمع مراحل نوع خدمة ومهامها، وتطبيقه ينشئ مهام المشروع بمواعيدها.')}`;
  },
  form(action,id,data){
    if(action==='create_template'){guard(data.can_create);return {title:'قالب مشروع',endpoint:'/project-templates',idempotent:true,fields:[field('name','اسم القالب'),field('service_kind','نوع الخدمة'),field('phases','المراحل والمهام','rows',{columns:[{name:'phase',label:'المرحلة'},{name:'title',label:'المهمة'},{name:'offset_days',label:'اليوم من البداية',type:'number',min:0,max:730,value:0},{name:'acceptance',label:'معيار القبول'}],maxRows:60,hint:'المهام اللي لها نفس اسم المرحلة تنجمع تحتها بترتيب ظهورها.'})],toPayload:v=>{const phases=[];for(const row of v.phases){let phase=phases.find(x=>x.name===row.phase);if(!phase){phase={name:row.phase,tasks:[]};phases.push(phase);}phase.tasks.push({title:row.title,offset_days:row.offset_days,acceptance:row.acceptance});}return {name:v.name,service_kind:v.service_kind,phases};}};}
    const t=data.templates.find(x=>x.id===id);guard(t&&data.projects.length);
    return {title:`تطبيق «${t.name}»`,endpoint:`/project-templates/${id}/apply`,fields:[field('project_id','المشروع (مشاريع تملكها)','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),field('start_date','تاريخ بداية المشروع','date',{value:data.today}),field('assignee_id','المكلف مبدئيًا بالمهام','select',{options:[...new Map(data.projects.flatMap(p=>p.members).map(m=>[m.id,m])).values()].map(m=>({value:m.id,label:m.name})),hint:'لازم يكون عضو في المشروع المختار.'})],toPayload:v=>v};
  }
};

export const timeUI={
  title:'ساعاتي وسعة الفريق',description:'سجّل اللي أنجزته على مشاريعك بمضاعفات ربع ساعة. المدير يعتمد ساعات فريقه ويشوف السعة للتخطيط مو للتقييم.',
  load:api=>api('/time'),
  render(data,{e,button,ui=kit(e)}){
    const cap=m=>`<tr><td>${e(m.name)}</td><td>${e(hours(m.available_minutes))}${m.assumed_hours?' <small>(افتراض 40 ساعة)</small>':''}</td><td>${e(hours(m.logged_minutes))}</td><td>${e(hours(m.billable_minutes))}</td><td>${e(m.leave_days)}</td><td>${m.utilization_bp===null?'—':e((m.utilization_bp/100).toFixed(0))+'%'}</td></tr>`;
    const entries=data.entries.map(t=>`<li><strong>${e(t.work_date)} · ${e(t.project_name)} · ${e(hours(t.minutes))}</strong><span>${t.billable?'قابل للفوترة':'غير قابل للفوترة'} · ${e({logged:'ينتظر المدير',approved:'معتمد',rejected:'مرفوض'}[t.status])}</span><small>${e(t.note)}${t.decision_note?` — ${e(t.decision_note)}`:''}</small>${t.status==='logged'?`<div class="operation-actions">${button('remove_time',t.id,'حذف')}</div>`:''}</li>`).join('');
    const pending=data.pending.map(t=>`<li class="is-decision"><strong>${e(t.employee_name)} · ${e(t.work_date)} · ${e(hours(t.minutes))}</strong><span>${e(t.project_name)}</span><small>${e(t.note)}</small><div class="operation-actions">${button('approve_time',t.id,'اعتماد')}${button('reject_time',t.id,'رفض')}</div></li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)} الأسبوع: ${e(data.week.from)} – ${e(data.week.to)}.</p><div class="operation-actions">${data.projects.length?button('log_time','','تسجيل ساعات'):''}</div></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(hours(data.me.logged_minutes),'ساعاتي هالأسبوع')}${ui.tile(hours(data.me.billable_minutes),'منها قابلة للفوترة')}${ui.tile(hours(data.me.available_minutes),'سعتي الأسبوعية')}${ui.tile(data.pending.length,'سجل ينتظر اعتمادي',data.pending.length?'is-due':'')}</div>
      <div class="vn-grid">${data.team.length?`<section class="vn-block"><h3>بانتظار اعتمادي</h3>${pending?`<ul class="vn-list">${pending}</ul>`:'<p class="subtle">ولا شي ينتظرك.</p>'}</section>`:''}<section class="vn-block"><h3>سجلاتي</h3>${entries?`<ul class="vn-list">${entries}</ul>`:'<p class="subtle">ما فيه ساعات مسجلة هالأسبوع.</p>'}</section></div>
      ${data.team.length?`<section class="vn-block"><h3>سعة الفريق هالأسبوع</h3><div class="table-wrap"><table><thead><tr><th>الموظف</th><th>المتاح</th><th>المسجل</th><th>قابل للفوترة</th><th>أيام إجازة</th><th>الاستغلال</th></tr></thead><tbody>${data.team.map(cap).join('')}</tbody></table></div></section>`:''}</section>`;
  },
  form(action,id,data){
    if(action==='log_time')return {title:'تسجيل ساعات',endpoint:'/time',idempotent:true,fields:[field('project_id','المشروع','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),field('work_date','اليوم','date',{value:data.today}),field('minutes','المدة بالدقائق (مضاعفات 15)','number',{min:15,max:960,step:15,value:60}),field('billable','قابل للفوترة؟','select',{options:[{value:'yes',label:'نعم'},{value:'no',label:'لا'}]}),field('note','وش انجز','textarea')],toPayload:v=>({project_id:v.project_id,work_date:v.work_date,minutes:Number(v.minutes),billable:v.billable==='yes',note:v.note})};
    if(action==='remove_time')return {title:'حذف سجل غير معتمد',endpoint:`/time/${id}/remove`,fields:[],toPayload:()=>({})};
    const t=data.pending.find(x=>x.id===id);guard(t);
    return {title:`${action==='approve_time'?'اعتماد':'رفض'} — ${t.employee_name}`,endpoint:`/time/${id}/${action==='approve_time'?'approve':'reject'}`,fields:[field('note',action==='approve_time'?'ملاحظة (اختيارية)':'سبب الرفض','textarea',action==='approve_time'?optional:{})],toPayload:v=>(v.note?{note:v.note}:{})};
  }
};
