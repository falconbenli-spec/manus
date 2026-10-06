// الفواتير الضريبية والإشعارات الدائنة: تُبنى من استحقاق معتمد، ويصدرها شخص غير من أعدها.
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const addressFields=(p={})=>[field('building','رقم المبنى','text',{value:p.building}),field('street','الشارع','text',{value:p.street}),field('district','الحي','text',{value:p.district}),field('city','المدينة','text',{value:p.city}),field('postal_code','الرمز البريدي','text',{value:p.postal_code,maxLength:12}),field('country','رمز البلد (حرفان)','text',{value:p.country??'SA',maxLength:2})];
const address=v=>({building:v.building,street:v.street,district:v.district,city:v.city,postal_code:v.postal_code,country:v.country});
const actionLabels={submit:'تقديم للإصدار',issue:'إصدار برقم ضريبي',return:'إعادة للمُعد',reject:'رفض المستند',credit:'إشعار دائن على الفاتورة'};
const addressLine=a=>`${a.building} ${a.street}، ${a.district}، ${a.city} ${a.postal_code}، ${a.country}`;
// ما ينتظر القارئ في المستند: تقديمه أو قرار إصداره. الإشعار الدائن متاح على كل فاتورة صادرة، فليس انتظارًا.
const WAITS=new Set(['submit','issue','return','reject']);
// الحالة شكلٌ وكلمة: المسودة ساكنة، والمنتظر بشكل الانتظار، والصادرة صامتة، والمرفوضة بشكل الرفض.
const TONES={draft:'draft',pending:'pending',issued:'issued',rejected:'rejected'};
const riyadhDay=iso=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch{return String(iso??'').slice(0,10);}};

function documentCard(d,data,{e,button,money,ui}){
  const fig=v=>`<span class="ltr">${e(money(v,'').trim())}</span>`,day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
  const category=data.vat_categories.find(c=>c.key===d.vat_category)?.name??d.vat_category;
  const invoice=d.kind==='invoice',title=invoice?'فاتورة ضريبية':'إشعار دائن';
  const waits=d.actions.some(a=>WAITS.has(a));
  const party=(heading,p)=>`<section class="vn-block"><h3>${e(heading)}</h3><ul class="vn-list"><li><strong>${e(p.legal_name)}</strong><span>الرقم الضريبي: ${p.vat_number?`<bdi dir="ltr">${e(p.vat_number)}</bdi>`:'ما هو مسجّل ضريبيًا'}${p.cr_number?` · السجل: <bdi dir="ltr">${e(p.cr_number)}</bdi>`:''}</span><small>${e(addressLine(p.address))}</small></li></ul></section>`;
  // الجدول: الصافي ثم الضريبة ثم الإجمالي، والعملة في رأس العمود، وصف الإجمالي رأس صف يجمع المستند.
  const lines=ui.table({head:['البيان','الكمية','الصافي (ريال)',`الضريبة ${d.vat_basis_points/100}% (ريال)`,'الإجمالي (ريال)'],
    rows:[...d.lines.map(l=>`<tr><td>${e(l.description)}</td><td><span data-num>${e(l.quantity)}</span></td><td>${fig(l.net_minor)}</td><td>${fig(l.vat_minor)}</td><td>${fig(l.total_minor)}</td></tr>`),
      `<tr><th scope="row" colspan="2">الإجمالي</th><td><strong>${fig(d.net_minor)}</strong></td><td><strong>${fig(d.vat_minor)}</strong></td><td><strong>${fig(d.total_minor)}</strong></td></tr>`]});
  // الإشعار الدائن ينقص الفاتورة: يُقرأ بعلامة الناقص وبكلمته، لا بلون.
  const lead=invoice?`${fig(d.total_minor)} ريال`:`<span class="ltr">−${e(money(d.total_minor,'').trim())}</span> ريال`;
  return `<details class="vn-card ${waits?'is-decision':d.status==='pending'?'is-pending':d.status==='draft'?'is-old':''}"${waits?' open':''}><summary><span class="vn-code"><bdi>${e(d.number||'بدون رقم')}</bdi></span><span class="vn-name"><strong>${e(title)} · ${e(d.buyer.legal_name)}</strong><small>${e(d.lines[0].description)}</small></span><span class="vn-flags"><strong>${lead}</strong>${invoice&&d.credited_minor?`<span>بعد الإشعارات الدائنة ${fig(d.net_after_credits_minor)}</span>`:''}${waits?'<span class="badge is-decision">ينتظرك</span>':''}<span class="badge ${TONES[d.status]??''}">${e(d.status_name)}</span></span></summary>
    <div class="vn-body">
      <div class="operation-actions">${d.actions.map(a=>button(a,d.id,actionLabels[a])).join('')}<a class="btn outline small" href="/api/invoices/${e(d.id)}/print" target="_blank" rel="noopener">فتح ${invoice?'الفاتورة':'الإشعار'} كمستند${d.status==='issued'?' برمز QR':''}<span class="sr-only"> (ينفتح في تبويب جديد)</span></a></div>
      ${d.status==='issued'?`<div class="vn-alert"><strong>${e(d.reporting_note??'صادرة داخليًا وما انبلّغت لمنصة «فاتورة»؛ الربط غير متصل.')}</strong>${d.einvoice_queue?.simulated?'<p>حالة طابور الإرسال جاية من مزوّد محاكٍ للاختبار، وما هي إبلاغ.</p>':''}</div>`:`<div class="vn-alert ${d.status==='rejected'?'':'is-due'}"><strong>${e(d.status==='rejected'?'مرفوضة، وما استهلكت رقمًا.':'ما فيه رقم ضريبي قبل الإصدار، واللي أعدّ المستند ما يصدره.')}</strong>${d.decision_note?`<p class="measure">${e(d.decision_note)}</p>`:''}</div>`}
      <dl class="vn-facts"><div><dt>النوع</dt><dd>${e(title)}${d.original_number?` على <bdi dir="ltr">${e(d.original_number)}</bdi>`:''}</dd></div><div><dt>تاريخ الإصدار</dt><dd>${d.issued_at?`<time datetime="${e(d.issued_at)}">${e(riyadhDay(d.issued_at))}</time>`:'—'}</dd></div><div><dt>تاريخ التوريد</dt><dd>${day(d.supply_date)}</dd></div><div><dt>التصنيف الضريبي</dt><dd>${e(category)}</dd></div>${d.status==='issued'?'':`<div><dt>أعدّه</dt><dd>${e(d.prepared_by_name)}</dd></div>`}${d.issued_by_name?`<div><dt>أصدره</dt><dd>${e(d.issued_by_name)}</dd></div>`:''}${d.lines[0]?.client_po_number?`<div><dt>أمر شراء العميل</dt><dd><bdi dir="ltr">${e(d.lines[0].client_po_number)}</bdi></dd></div>`:''}</dl>
      ${d.vat_reason?`<p class="subtle measure">سبب عدم تطبيق النسبة الأساسية: ${e(d.vat_reason)}</p>`:''}${d.reason?`<p class="subtle measure">سبب الإشعار: ${e(d.reason)}</p>`:''}
      ${lines}
      <div class="vn-grid">${party('البائع',d.seller)}${party('المشتري',d.buyer)}</div>
      ${d.qr_tlv?`<p class="subtle">رمز المرحلة الأولى (TLV): <bdi dir="ltr">${e(d.qr_tlv.slice(0,48))}…</bdi> · بصمة السلسلة: <bdi dir="ltr">${e(d.hash.slice(0,16))}</bdi></p>`:''}
    </div></details>`;
}

export const invoicesUI={
  title:'الفواتير الضريبية',description:'فاتورة من استحقاق معتمد، بترقيم متسلسل بدون فجوات وضريبة قيمة مضافة، وتصحيح بإشعار دائن. الإصدار داخلي، والإبلاغ لمنصة «فاتورة» غير متصل.',
  load:api=>api('/invoices'),
  render(data,helpers){
    const {e,button,money,ui=kit(e)}=helpers,prepare=data.permissions.includes('prepare'),approve=data.permissions.includes('approve');
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const pendingProfile=data.profiles.find(p=>!p.approved_by&&p.recorded_by!==data.user_id);
    const decideProfile=approve&&pendingProfile;
    const seller=data.seller?`<li><strong>${e(data.seller.legal_name)}</strong><span>الرقم الضريبي <bdi dir="ltr">${e(data.seller.vat_number)}</bdi> · السجل <bdi dir="ltr">${e(data.seller.cr_number)}</bdi> · يسري من <time datetime="${e(data.seller.effective_from)}">${e(data.seller.effective_from)}</time></span><small>${e(addressLine(data.seller.address))}</small></li>`:'';
    // الاستحقاق الجاهز يُقرأ بمبلغه وعميله، والزر يُرسم حين يقبله النموذج: بائع معتمد، وبيانات العميل كاملة، والعملة ريال.
    const claims=data.claims.map(c=>{const ready=prepare&&data.seller&&c.buyer_ready&&c.currency==='SAR';
      return `<li class="${c.buyer_ready?'':'is-due'}"><strong>${e(c.customer_name)} · ${fig(c.amount_minor)} ${c.currency==='SAR'?'ريال':`<bdi>${e(c.currency)}</bdi>`} شامل الضريبة</strong><span>${e(c.line_description)} · يستحق <time datetime="${e(c.due_date)}">${e(c.due_date)}</time></span>${c.buyer_ready?'':'<small>بيانات العميل الضريبية ناقصة — تنضاف من «بيانات عميل ضريبية».</small>'}${ready?`<div class="operation-actions">${button('prepare_invoice',c.id,'إعداد فاتورة')}</div>`:''}</li>`;}).join('');
    const group=(title,rows)=>rows.length?`<section class="vn-group"><h2>${e(title)} <span>${rows.length}</span></h2>${rows.map(d=>documentCard(d,data,{...helpers,ui})).join('')}</section>`:'';
    const waiting=data.documents.filter(d=>d.actions.some(a=>WAITS.has(a))),rest=data.documents.filter(d=>!waiting.includes(d));
    const head=[prepare?button('company_profile','','بيانات المنشأة الضريبية'):'',prepare&&data.customers.length?button('customer_profile','','بيانات عميل ضريبية'):''].join('');
    return `<section class="panel panel-body vn-head">${head?`<div class="operation-actions">${head}</div>`:''}<p>${e(data.e_invoicing.note)}</p></section>
      ${decideProfile?`<section class="vn-block"><div class="panel-head"><h2>ينتظر اعتمادك</h2></div><ul class="vn-list"><li class="is-decision"><strong>بيانات المنشأة الضريبية — ${e(pendingProfile.legal_name)}</strong><span>الرقم الضريبي <bdi dir="ltr">${e(pendingProfile.vat_number)}</bdi> · السجل <bdi dir="ltr">${e(pendingProfile.cr_number)}</bdi> · يسري من <time datetime="${e(pendingProfile.effective_from)}">${e(pendingProfile.effective_from)}</time></span><small>أدخلها ${e(pendingProfile.recorded_by_name)}، ويعتمدها غيره قبل أول فاتورة.</small><div class="operation-actions">${button('approve_profile',pendingProfile.id,'اعتماد بيانات المنشأة')}</div></li></ul></section>`:''}
      <section class="vn-board"><div class="vn-tiles">${ui.tile(num(data.totals.invoiced_minor),'فواتير صادرة بالريال')}${ui.tile(num(data.totals.credited_minor),'إشعارات دائنة صادرة بالريال')}${ui.tile(num(data.totals.output_vat_minor),'ضريبة مخرجات صافية بالريال')}${ui.tile(data.claims.length,'استحقاق معتمد بدون فاتورة',data.claims.length?'is-due':'')}</div>
      <p class="subtle">${e(data.totals.basis)}.</p></section>
      ${group('تنتظرك',waiting)}
      <div class="vn-grid"><section class="vn-block"><div class="panel-head"><h2>استحقاقات جاهزة للفوترة</h2></div>${claims?`<ul class="vn-list">${claims}</ul>`:'<p class="subtle">ما فيه استحقاق معتمد ينتظر فاتورة — يطلع هنا أول ما ينعتمد استحقاق في «مستحقات العملاء».</p>'}</section>
      <section class="vn-block"><div class="panel-head"><h2>المنشأة (البائع)</h2></div>${seller?`<ul class="vn-list">${seller}</ul>`:'<p class="subtle">ما انعتمدت بيانات المنشأة الضريبية للحين، وما تنعدّ فاتورة قبل ما يعتمدها شخص ثاني.</p>'}</section></div>
      ${group('بانتظار الإصدار',rest.filter(d=>['draft','pending'].includes(d.status)))}${group('صادرة',rest.filter(d=>d.status==='issued'))}${group('مرفوضة',rest.filter(d=>d.status==='rejected'))}
      ${data.documents.length?'':ui.empty('ما فيه فواتير ولا إشعارات للحين','أول فاتورة تنعدّ من «استحقاقات جاهزة للفوترة»، ويصدرها غير اللي أعدّها.')}`;
  },
  form(action,id,data){
    const prepare=data.permissions.includes('prepare');
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='company_profile'){guard(prepare);const p=data.seller;return {title:'بيانات المنشأة الضريبية',endpoint:'/invoices/company-profiles',idempotent:true,fields:[field('legal_name','الاسم القانوني','text',{value:p?.legal_name}),field('vat_number','الرقم الضريبي (15 رقمًا)','text',{value:p?.vat_number,maxLength:15}),field('cr_number','السجل التجاري (10 أرقام)','text',{value:p?.cr_number,maxLength:10}),...addressFields(p?.address),field('effective_from','يسري من','date',{value:data.today})],toPayload:v=>({legal_name:v.legal_name,vat_number:v.vat_number,cr_number:v.cr_number,address:address(v),effective_from:v.effective_from})};}
    if(action==='approve_profile'){const p=data.profiles.find(x=>x.id===id);guard(p&&!p.approved_by&&p.recorded_by!==data.user_id&&data.permissions.includes('approve'));return {title:`اعتماد بيانات المنشأة — ${p.legal_name}`,endpoint:`/invoices/company-profiles/${id}/approve`,fields:[field('note','وش طابقت؟','textarea',{hint:`الرقم الضريبي ${p.vat_number} · السجل ${p.cr_number} · أدخلها ${p.recorded_by_name}`})],toPayload:v=>v};}
    if(action==='customer_profile'){guard(prepare);return {title:'بيانات عميل ضريبية',endpoint:'/invoices/customer-profiles',idempotent:true,fields:[field('case_id','العميل','select',{options:data.customers.map(c=>({value:c.id,label:c.name+(c.profile?' — محدّثة':'')}))}),field('legal_name','الاسم القانوني للعميل'),field('vat_number','الرقم الضريبي إذا كان مسجّل','text',{required:false,maxLength:15}),...addressFields(),field('source','مصدر البيانات','textarea',{hint:'مثال: شهادة التسجيل الضريبي اللي أرسلها العميل، ومكان حفظها.'})],toPayload:v=>({case_id:v.case_id,legal_name:v.legal_name,vat_number:v.vat_number,address:address(v),source:v.source})};}
    if(action==='prepare_invoice'){const c=data.claims.find(x=>x.id===id);guard(prepare&&c);return {title:`إعداد فاتورة — ${c.customer_name}`,endpoint:'/invoices',idempotent:true,fields:[field('supply_date','تاريخ التوريد','date',{value:data.today}),field('vat_category','التصنيف الضريبي','select',{options:data.vat_categories.map(k=>({value:k.key,label:k.name})),hint:'لازم يطابق نسبة الضريبة في بند العقد المعتمد.'}),field('vat_reason','سبب عدم تطبيق 15% (إذا انطبق)','textarea',{required:false})],toPayload:v=>({claim_id:id,supply_date:v.supply_date,vat_category:v.vat_category,...(v.vat_category==='standard'?{}:{vat_reason:v.vat_reason})})};}
    const d=data.documents.find(x=>x.id===id);guard(d&&d.actions.includes(action));
    if(action==='credit')return {title:`إشعار دائن على ${d.number}`,endpoint:`/invoices/${id}/credit`,idempotent:true,fields:[field('amount','المبلغ شامل الضريبة','text',{hint:`الباقي القابل للتصحيح ما يتجاوز قيمة الفاتورة.`}),field('reason','سبب الإشعار','textarea')],toPayload:v=>v};
    return {title:`${actionLabels[action]} — ${d.number||d.buyer.legal_name}`,endpoint:`/invoices/${id}/${action}`,fields:action==='submit'?[]:[field('note',action==='issue'?'ملاحظة الإصدار (اختيارية)':'سبب القرار','textarea',action==='issue'?{required:false}:{})],toPayload:v=>({...(v.note?{note:v.note}:{}),version:d.version})};
  }
};
