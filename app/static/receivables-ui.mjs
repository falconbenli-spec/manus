// مستحقات العملاء والتحصيل: الاستحقاق من مخرج مقبول، والقبض بمطابقة مستقلة، والتسوية (الحزمة 3، الترحيل 170): عكس القبض
// الراجع، وإلغاء الاستحقاق، والنزاع والوعد بالسداد، والقبض على حساب العميل وتخصيصه. كل زر يظهر لمن يحق له من حمولة الخادم
// (actions)، والخادم يعيد الفحص ويرفض بمكتوب. المكوّنات من العدّة (ui) لا من نسخ محلية.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const unavailable=()=>{throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const decimal=minor=>(Number(minor)/100).toFixed(2);
const CLAIM_ACTIONS={submit:'تقديم للمراجعة',approve:'اعتماد الاستحقاق',return:'إعادة للمعد',reject:'رفض الاستحقاق',record_receipt:'تسجيل قبض للمطابقة',
  request_cancel:'طلب إلغاء الاستحقاق',open_dispute:'تسجيل نزاع العميل',record_promise:'تسجيل وعد بالسداد'};
// قرارات تُرسم عند سجلها (القبض، الطلب، النزاع) لا في أزرار الاستحقاق العامة.
const PLACED=new Set(['confirm_receipt','reject_receipt','request_reversal','approve_reversal','reject_reversal','approve_cancel','reject_cancel','resolve_dispute']);
const ACCOUNT_ACTIONS={confirm_account:'مطابقة القبض',reject_account:'رفض القبض',allocate:'تخصيص على الاستحقاقات',request_account_reversal:'طلب عكس (المبلغ رجع)'};
export const receivablesUI={
 title:'مستحقات العملاء والتحصيل',
 description:'استحقاق من مخرج مقبول، وقبض يطابقه غير اللي سجّله، وأي تصحيح يصير بسجل جديد ما يمسح اللي قبله. الفوترة الإلكترونية والبنك مو مربوطين.',
 load:api=>api('/receivables'),
 render(data,{e,button,money,ui=kit(e)}){
  const can=a=>(data.permissions??[]).includes(a),me=data.user_id,claims=data.claims??[],accounts=data.account_receipts??[];
  const amount=(v,c='SAR')=>e(money(v,c));
  // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في التسمية، وبعد أول مبلغ في البطاقة بعملتها.
  const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
  const cur=c=>!c||c==='SAR'?'ريال':`<bdi>${e(c)}</bdi>`;
  const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
  // الحالة شكلٌ وكلمة: المنتظر بشكل الانتظار، والمؤكد صامت، والمرفوض والمرتد بشكل الرفض.
  const tone={pending:'pending',confirmed:'confirmed',rejected:'rejected',reversed:'rejected',open:'pending',kept:'done',broken:'overdue'};
  const head=`<section class="panel panel-body vn-head"><div class="operation-actions">${
    can('prepare')&&(data.sources??[]).length?button('create_claim','','إنشاء استحقاق من مخرج مقبول'):''}${can('prepare')&&(data.advance_sources??[]).length?button('create_advance_claim','','استحقاق دفعة مقدمة'):''}${can('prepare')&&(data.customers??[]).length?button('record_account_receipt','','تسجيل قبض على حساب عميل'):''}</div><p>المعروض سجل داخلي. المنصة ما ترسل للعميل شي وما تتصل ببنك: المطابقة من كشف الحساب يدويًا.</p></section>`;
  const unapplied=accounts.filter(x=>x.effective_status==='confirmed').reduce((n,x)=>n+Number(x.unallocated_minor??0),0);
  const owed=claims.filter(c=>c.status==='approved').reduce((n,c)=>n+Math.max(0,Number(c.balance_minor??0)),0);
  const overdue=claims.filter(c=>c.follow_up?.state==='due').length,disputed=claims.filter(c=>c.disputed).length;
  const tiles=`<section class="vn-board"><div class="vn-tiles">${ui.tile(num(owed),'الباقي على العملاء بالريال')}${ui.tile(overdue,'استحقاق متأخر يبي متابعة',overdue?'is-late':'')}${ui.tile(disputed,'نزاع مفتوح',disputed?'is-due':'')}${ui.tile(num(unapplied),'مال على حساب العملاء ما تخصّص بالريال',unapplied?'is-due':'')}</div></section>`;
  // قرارات تنتظر القارئ على الاستحقاق: اعتماده، أو مطابقة قبضه، أو عكس قبضه، أو إلغاؤه، أو حسم نزاعه — بالشروط نفسها التي ترسم أزرارها.
  const decisionsOf=c=>{const acts=c.actions??[],dispute=(c.disputes??[]).find(d=>d.state==='open');
    return acts.some(a=>['approve','return','reject','approve_cancel'].includes(a))
      ||(c.receipts??[]).some(r=>r.status==='pending'&&can('approve')&&r.recorded_by!==me)
      ||(c.receipts??[]).some(r=>{const w=r.reversal?.status==='pending'?r.reversal:null;return w&&acts.includes('approve_reversal')&&![w.requested_by,r.recorded_by,r.confirmed_by].includes(me);})
      ||(!!dispute&&acts.includes('resolve_dispute')&&dispute.opened_by!==me);};
  const receiptLine=(c,r)=>{
   const waiting=r.reversal?.status==='pending'?r.reversal:null,acts=c.actions??[];
   const decides=waiting&&acts.includes('approve_reversal')&&![waiting.requested_by,r.recorded_by,r.confirmed_by].includes(me);
   const confirm=r.status==='pending'&&can('approve')&&r.recorded_by!==me;
   const buttons=[confirm?button('confirm_receipt',`${c.id}:${r.id}`,'مطابقة القبض')+button('reject_receipt',`${c.id}:${r.id}`,'رفض القبض'):'',
    r.effective_status==='confirmed'&&!waiting&&acts.includes('request_reversal')?button('request_reversal',`${c.id}:${r.id}`,'طلب عكس (المبلغ رجع)'):'',
    decides?button('approve_adjustment',`${c.id}:${waiting.id}`,'اعتماد العكس')+button('reject_adjustment',`${c.id}:${waiting.id}`,'رفض العكس'):''].join('');
   return `<li class="${confirm||decides?'is-decision':r.effective_status==='pending'?'is-pending':''}"><strong>قبض <bdi>${e(r.reference)}</bdi> · ${fig(r.amount_minor)}</strong><span class="badge ${tone[r.effective_status]??''}">${e(r.status_name??r.status)}</span><span>وصل ${day(r.received_on)}${
    waiting?` · طلب عكس ${e(waiting.status_name)} بتاريخ ${day(waiting.effective_on)}: ${e(waiting.reason)}`:''}</span>${buttons?`<div class="operation-actions">${buttons}</div>`:''}</li>`;
  };
  const claimCard=c=>{
   const acts=c.actions??[],cancel=(c.adjustments??[]).find(a=>a.kind==='claim_cancel'&&a.status==='pending'),dispute=(c.disputes??[]).find(d=>d.state==='open');
   // شرط الدفعة في الجدول ونسخة أمر شراء العميل اللي نشأ تحتها (الترحيل 183).
   const term=c.source_snapshot?.term,po=c.source_snapshot?.client_po;
   const basis=[term?`شرط الدفعة: ${e(term.label)}${term.condition?` (${e(term.condition)})`:''}`:'',po?`أمر شراء العميل <bdi>${e(po.number)}</bdi> · النسخة ${e(po.revision)}`:''].filter(Boolean).join(' · ');
   const general=acts.filter(a=>!PLACED.has(a)).map(a=>button(a,c.id,CLAIM_ACTIONS[a]??a)).join(''),waits=decisionsOf(c);
   const cancelBlock=cancel?`<div class="vn-alert is-due"><strong>طلب إلغاء ${e(cancel.status_name)}</strong><p class="measure">طلبه ${e(cancel.requested_by_name??'')}: ${e(cancel.reason)}</p>${
    acts.includes('approve_cancel')?`<div class="operation-actions">${button('approve_adjustment',`${c.id}:${cancel.id}`,'اعتماد الإلغاء')+button('reject_adjustment',`${c.id}:${cancel.id}`,'رفض الإلغاء')}</div>`:''}</div>`:'';
   const disputeBlock=dispute?`<div class="vn-alert is-due"><strong>نزاع مفتوح على ${fig(dispute.amount_minor)} ${cur(c.currency)}</strong><p class="measure">${e(dispute.reason)}</p>${
    acts.includes('resolve_dispute')&&dispute.opened_by!==me?`<div class="operation-actions">${button('resolve_dispute',`${c.id}:${dispute.id}`,'حسم النزاع')}</div>`:''}</div>`:'';
   const promises=(c.promises??[]).map(p=>`<li class="${p.state==='broken'?'is-late':p.state==='open'?'is-pending':''}"><strong>وعد بسداد ${fig(p.amount_minor)} بتاريخ ${day(p.promised_on)}</strong><span class="badge ${tone[p.state]??''}">${e(p.state_name)}</span><span>وعد به ${e(p.contact)}</span></li>`).join('');
   const allocations=(c.allocations??[]).filter(y=>y.kind==='allocation').map(y=>`<li class="${y.reversed?'is-old':''}"><strong>${e(y.kind_name)} ${fig(y.amount_minor)}</strong><span>من قبض <bdi>${e(y.account_reference)}</bdi>${y.reversed?' · منعكس':''}</span></li>`).join('');
   const credit=Number(c.credit_balance_minor??0);
   return `<details class="vn-card ${waits?'is-decision':c.status==='pending'?'is-pending':c.follow_up?.state==='due'?'is-late':''}"${waits?' open':''} data-id="${e(c.id)}"><summary><span class="vn-code">${day(c.due_date)}</span><span class="vn-name"><strong>${e(c.source_snapshot?.line_description??'')}</strong><small>${e(c.aging_bucket)}${c.follow_up?` · ${e(c.follow_up.name)}`:''}</small></span><span class="vn-flags"><strong>الباقي ${fig(c.balance_minor)} ${cur(c.currency)}</strong>${waits?'<span class="badge is-decision">ينتظر قرارك</span>':''}${ui.statusBadge(c.status)}</span></summary><div class="vn-body">
    ${general?`<div class="operation-actions">${general}</div>`:''}
    <dl class="vn-facts"><div><dt>المبلغ</dt><dd>${fig(c.amount_minor)}</dd></div>${Number(c.credited_minor??0)?`<div><dt>ناقص الإشعارات الدائنة</dt><dd>${fig(c.credited_minor)}</dd></div>`:''}<div><dt>ناقص المحصّل</dt><dd>${fig(c.confirmed_minor??0)}${Number(c.allocated_minor??0)?` <small>منه من قبض على الحساب ${fig(c.allocated_minor)}</small>`:''}</dd></div><div><dt>الباقي على العميل</dt><dd><strong>${fig(c.balance_minor)}</strong></dd></div>${credit?`<div><dt>للعميل رصيد دائن (زيادة)</dt><dd>${fig(credit)}</dd></div>`:''}</dl>
    <p class="subtle measure">${e(c.entitlement_evidence)}</p>${basis?`<p class="subtle">${basis}</p>`:''}${c.basis==='advance'?'<p class="subtle">يتحصّل بالسحب من الدفعة المقدمة المؤكدة، وما تصدر عليه فاتورة للحين.</p>':''}
    ${cancelBlock}${disputeBlock}
    ${(c.receipts??[]).length?`<ul class="vn-list">${c.receipts.map(r=>receiptLine(c,r)).join('')}</ul>`:''}
    ${allocations?`<ul class="vn-list">${allocations}</ul>`:''}${promises?`<ul class="vn-list">${promises}</ul>`:''}</div></details>`;
  };
  const accountCard=x=>{
   const reversal=(x.reversals??[]).at(-1),acts=x.actions??[];
   const allocations=(x.allocations??[]).map(y=>`<li class="${y.reversed?'is-old':''}"><strong>${e(y.kind_name)} ${fig(y.amount_minor)}</strong><span>${e(y.line_description)}${y.reversed?' · منعكس':''}</span>${
    (y.actions??[]).includes('reverse_allocation')?`<div class="operation-actions">${button('reverse_allocation',`${x.id}:${y.id}`,'عكس التخصيص')}</div>`:''}</li>`).join('');
   const buttons=acts.map(a=>['approve_account_reversal','reject_account_reversal'].includes(a)
    ?(reversal?.status==='pending'?button(a,`${x.id}:${reversal.id}`,a==='approve_account_reversal'?'اعتماد العكس':'رفض العكس'):'')
    :button(a,x.id,ACCOUNT_ACTIONS[a]??a)).join('');
   const waits=acts.some(a=>['confirm_account','reject_account','approve_account_reversal','reject_account_reversal','allocate'].includes(a));
   return `<details class="vn-card ${waits?'is-decision':x.effective_status==='pending'?'is-pending':x.effective_status==='reversed'?'is-late':''}"${waits?' open':''} data-id="${e(x.id)}"><summary><span class="vn-code"><bdi>${e(x.reference)}</bdi></span><span class="vn-name"><strong>${e(x.case_name)}</strong><small>من ${e(x.payer)} · وصل ${day(x.received_on)}</small></span><span class="vn-flags"><strong>ما تخصّص ${fig(x.unallocated_minor)} ${cur(x.currency)}</strong>${waits?'<span class="badge is-decision">ينتظر قرارك</span>':''}<span class="badge ${tone[x.effective_status]??''}">${e(x.status_name)}</span></span></summary><div class="vn-body">
    ${buttons?`<div class="operation-actions">${buttons}</div>`:''}
    <dl class="vn-facts"><div><dt>المبلغ</dt><dd>${fig(x.amount_minor)}</dd></div><div><dt>المخصّص على استحقاقات</dt><dd>${fig(x.allocated_minor)}</dd></div><div><dt>ما تخصّص منه</dt><dd>${fig(x.unallocated_minor)}</dd></div></dl>
    ${reversal?`<div class="vn-alert ${reversal.status==='pending'?'is-due':''}"><strong>طلب عكس ${e(reversal.status_name)} بتاريخ ${day(reversal.effective_on)}</strong><p class="measure">${e(reversal.reason)}</p></div>`:''}
    ${allocations?`<ul class="vn-list">${allocations}</ul>`:''}</div></details>`;
  };
  // كشف العميل عبر صفقاته (P4-CRM-4): كل صفقة بسطرها، والمال على الحساب بجانب باقي صفقته لا مخصوم من غيرها.
  const figures=(row,currency)=>['entitled_minor','received_minor','applied_minor','open_minor','on_account_minor','advance_held_minor'].map(key=>`<td>${amount(row[key],currency)}</td>`).join('');
  const statementCard=st=>ui.card({codeHtml:`<bdi>${e(st.client.code)}</bdi>`,title:st.client.name,
    meta:st.totals.map(t=>`المستحق ${money(t.entitled_minor,t.currency)} · الباقي ${money(t.open_minor,t.currency)}${t.on_account_minor?` · على الحساب ${money(t.on_account_minor,t.currency)}`:''}`).join(' · '),
    body:`<div class="vn-body">${ui.table({head:['الصفقة','المستحق','المقبوض','المطبَّق من مال سابق','الباقي على العميل','على الحساب ما تخصّص','دفعة مقدمة ما انسحبت'],
      rows:st.deals.map(k=>`<tr><td>${e(k.name)}${k.awaiting_minor?`<small class="subtle"> · ينتظر الاعتماد ${amount(k.awaiting_minor,k.currency)}</small>`:''}</td>${figures(k,k.currency)}</tr>`),empty:'ما فيه صفقات لها مال'})}
      <p class="subtle">المال على الحساب يبقى لصفقته، وما ينخصم من باقي صفقة ثانية.</p></div>`});
  const statements=(data.statements??[]).length?`<section class="vn-group"><h2>كشف العملاء عبر صفقاتهم <span>${e(data.statements.length)}</span></h2>${data.statements.map(statementCard).join('')}</section>`:'';
  const waitingClaims=claims.filter(decisionsOf),otherClaims=claims.filter(c=>!waitingClaims.includes(c));
  const group=(title,rows,draw)=>rows.length?`<section class="vn-group"><h2>${e(title)} <span>${e(rows.length)}</span></h2>${rows.map(draw).join('')}</section>`:'';
  return `${head}${tiles}${group('ينتظر قرارك',waitingClaims,claimCard)}${group('قبض على حساب العملاء',accounts,accountCard)}${group('المستحقات',otherClaims,claimCard)}${claims.length?'':ui.empty('ما فيه مستحقات في الكيان','الاستحقاق ينبني من مخرج انقبل وله اتفاق ومشروع.')}${statements}`;
 },
 form(action,id,data){
  const can=a=>(data.permissions??[]).includes(a),me=data.user_id,claims=data.claims??[],accounts=data.account_receipts??[];
  const claimOf=cid=>claims.find(c=>c.id===cid),accountOf=xid=>accounts.find(x=>x.id===xid);
  const pair=()=>String(id??'').split(':');
  if(action==='create_claim')return {title:'استحقاق من مخرج مقبول',endpoint:'/receivables',idempotent:true,fields:[field('delivery_id','المخرج المقبول','select',{options:(data.sources??[]).map(s=>({value:s.delivery_id,label:`${s.name} · ${s.snapshot.lines[s.line_index]?.description}${s.term_label?` · ${s.term_label}`:''}`}))}),field('amount','المبلغ قبل الفاتورة الرسمية'),field('due_date','تاريخ الاستحقاق','date'),field('entitlement_evidence','دليل الاستحقاق الداخلي','textarea')],toPayload:v=>v};
  // استحقاق المقدمة على بندها في جدول الصفقة (الترحيل 183): الصفقة وحدها، والمبلغ حتى الباقي على البند.
  if(action==='create_advance_claim'){
   if(!can('prepare')||!(data.advance_sources??[]).length)unavailable();
   return {title:'استحقاق دفعة مقدمة',endpoint:'/receivables',idempotent:true,fields:[field('case_id','الصفقة ودفعتها المقدمة','select',{options:data.advance_sources.map(a=>({value:a.case_id,label:`${a.name} · ${a.term_label} · الباقي ${decimal(a.room_minor)}`}))}),
    field('amount','المبلغ','text',{inputmode:'decimal'}),field('due_date','تاريخ الاستحقاق','date'),field('entitlement_evidence','دليل الاستحقاق (بند المقدمة وتوثيق الاتفاق)','textarea')],toPayload:v=>({...v,basis:'advance'})};
  }
  if(action==='record_account_receipt'){
   if(!can('prepare')||!(data.customers??[]).length)unavailable();
   return {title:'قبض على حساب عميل',endpoint:'/receivables/on-account',idempotent:true,fields:[field('case_id','العميل','select',{options:data.customers.map(k=>({value:k.id,label:k.name}))}),
    field('reference','مرجع التحويل في البنك','text',{hint:'التحويل الواحد ينسجل مرة، حتى لو غطّى أكثر من استحقاق'}),field('amount','المبلغ','text',{inputmode:'decimal'}),field('received_on','تاريخ وصوله في الكشف','date'),
    field('payer','اسم الدافع'),field('evidence','الدليل (إشعار التحويل أو سطر الكشف)','textarea')],toPayload:v=>v};
  }
  if(['confirm_receipt','reject_receipt'].includes(action)){
   const [claimId,receiptId]=pair(),claim=claimOf(claimId),receipt=claim?.receipts.find(r=>r.id===receiptId);if(!receipt||receipt.status!=='pending'||receipt.recorded_by===me||!can('approve'))unavailable();
   return {title:action==='confirm_receipt'?'مطابقة قبض مستقلة':'رفض قبض ما يطابق',endpoint:`/receivables/${claimId}/receipts/${receiptId}/${action==='confirm_receipt'?'confirm':'reject'}`,fields:[field('note','سبب القرار','textarea'),field('matching_evidence','دليل المطابقة من كشف الحساب','textarea')],toPayload:v=>v};
  }
  if(action==='request_reversal'){
   const [claimId,receiptId]=pair(),claim=claimOf(claimId),receipt=claim?.receipts.find(r=>r.id===receiptId);
   if(!claim||!receipt||!(claim.actions??[]).includes('request_reversal')||receipt.effective_status!=='confirmed'||receipt.reversal?.status==='pending')unavailable();
   return {title:`طلب عكس القبض ${receipt.reference}`,endpoint:`/receivables/${claimId}/receipts/${receiptId}/reverse`,idempotent:true,
    fields:[field('effective_on','متى رجع المبلغ في كشف البنك؟','date'),field('reason','وش صار؟ (شيك راجع، حوالة منعكسة، قبض مسجّل غلط)','textarea'),field('evidence','الدليل (إشعار البنك أو سطر الكشف)','textarea')],toPayload:v=>v};
  }
  if(['approve_adjustment','reject_adjustment'].includes(action)){
   const [claimId,adjustmentId]=pair(),claim=claimOf(claimId),adjustment=claim?.adjustments?.find(a=>a.id===adjustmentId);
   if(!claim||!adjustment||adjustment.status!=='pending'||adjustment.requested_by===me)unavailable();
   if(adjustment.kind==='claim_cancel'&&!(claim.actions??[]).includes('approve_cancel'))unavailable();
   if(adjustment.kind==='receipt_reversal'){const receipt=claim.receipts.find(r=>r.id===adjustment.receipt_id);if(!(claim.actions??[]).includes('approve_reversal')||!receipt||[receipt.recorded_by,receipt.confirmed_by].includes(me))unavailable();}
   const approve=action==='approve_adjustment';
   return {title:`${approve?'اعتماد':'رفض'} ${adjustment.kind_name}`,endpoint:`/receivables/${claimId}/adjustments/${adjustmentId}/${approve?'approve':'reject'}`,
    fields:[field('note',approve?'وش طابقت قبل ما تعتمد؟':'ليش ترفض الطلب؟','textarea',{hint:`طلبه ${adjustment.requested_by_name??''}: ${adjustment.reason}`})],toPayload:v=>v};
  }
  if(action==='resolve_dispute'){
   const [claimId,disputeId]=pair(),claim=claimOf(claimId),dispute=claim?.disputes?.find(d=>d.id===disputeId);
   if(!dispute||dispute.state!=='open'||dispute.opened_by===me||!(claim.actions??[]).includes('resolve_dispute'))unavailable();
   return {title:'حسم نزاع العميل',endpoint:`/receivables/${claimId}/disputes/${disputeId}/resolve`,fields:[field('resolution_note','كيف انحسم؟','textarea',{hint:dispute.reason}),field('resolution_evidence','الدليل (محضر، بريد العميل، إشعار دائن)','textarea')],toPayload:v=>v};
  }
  if(action==='reverse_allocation'){
   const [accountId,allocationId]=pair(),allocation=accountOf(accountId)?.allocations?.find(y=>y.id===allocationId);
   if(!allocation||!(allocation.actions??[]).includes('reverse_allocation'))unavailable();
   return {title:'عكس التخصيص',endpoint:`/receivables/on-account/${accountId}/allocations/${allocationId}/reverse`,fields:[field('reason','ليش ينعكس التخصيص؟','textarea',{hint:'العكس سجل جديد يرجع المبلغ على حساب العميل، والتخصيص الأول يبقى مسجّل'})],toPayload:v=>v};
  }
  if(['approve_account_reversal','reject_account_reversal'].includes(action)){
   const [accountId,reversalId]=pair(),account=accountOf(accountId),reversal=account?.reversals?.find(r=>r.id===reversalId);
   if(!reversal||reversal.status!=='pending'||!(account.actions??[]).includes(action))unavailable();
   const approve=action==='approve_account_reversal';
   return {title:`${approve?'اعتماد':'رفض'} عكس القبض ${account.reference}`,endpoint:`/receivables/on-account/${accountId}/reversals/${reversalId}/${approve?'approve':'reject'}`,
    fields:[field('note',approve?'وش طابقت قبل ما تعتمد؟':'ليش ترفض الطلب؟','textarea',{hint:reversal.reason})],toPayload:v=>v};
  }
  if(Object.hasOwn(ACCOUNT_ACTIONS,action)){
   const account=accountOf(id);if(!account||!(account.actions??[]).includes(action))unavailable();
   if(action==='allocate')return {title:`تخصيص القبض ${account.reference}`,endpoint:`/receivables/on-account/${id}/allocations`,idempotent:true,
    fields:[...account.eligible_claims.map(c=>field(`amount_${c.id}`,`${c.line_description} (يستحق ${c.due_date})`,'text',{required:false,inputmode:'decimal',hint:`الباقي عليه ${decimal(c.room_minor)} — اتركه فاضي إذا ما يخصّه`})),
     field('note','سبب التخصيص (كتاب العميل أو بيان الحوالة)','textarea',{hint:`الباقي من القبض ${decimal(account.unallocated_minor)}`})],
    toPayload:v=>({lines:account.eligible_claims.filter(c=>String(v[`amount_${c.id}`]??'').trim()).map(c=>({claim_id:c.id,amount:String(v[`amount_${c.id}`]).trim()})),note:v.note})};
   if(action==='request_account_reversal')return {title:`طلب عكس القبض ${account.reference}`,endpoint:`/receivables/on-account/${id}/reversals`,idempotent:true,
    fields:[field('effective_on','متى رجع المبلغ في كشف البنك؟','date'),field('reason','وش صار؟','textarea'),field('evidence','الدليل (إشعار البنك أو سطر الكشف)','textarea')],toPayload:v=>v};
   return {title:action==='confirm_account'?'مطابقة قبض على الحساب':'رفض قبض ما يطابق',endpoint:`/receivables/on-account/${id}/${action==='confirm_account'?'confirm':'reject'}`,
    fields:[field('note','سبب القرار','textarea'),field('matching_evidence','دليل المطابقة من كشف الحساب','textarea')],toPayload:v=>v};
  }
  const c=claimOf(id);if(!c||!(c.actions??[]).includes(action))unavailable();
  if(action==='record_receipt')return {title:'تسجيل قبض للمطابقة',endpoint:`/receivables/${id}/receipts`,idempotent:true,fields:[field('reference','مرجع القبض'),field('amount','المبلغ'),field('received_on','تاريخ الاستلام','date'),field('payer','اسم الدافع'),field('evidence','دليل الاستلام الداخلي','textarea')],toPayload:v=>v};
  if(action==='request_cancel')return {title:'طلب إلغاء الاستحقاق',endpoint:`/receivables/${id}/cancel`,idempotent:true,
   fields:[field('reason','ليش ينلغى؟','textarea',{hint:'ما ينلغى وعليه قبض قائم أو فاتورة صادرة ما تصححت بإشعار دائن'}),field('evidence','الدليل (خطاب العميل أو مذكرة داخلية)','textarea')],toPayload:v=>v};
  if(action==='open_dispute')return {title:'تسجيل نزاع العميل',endpoint:`/receivables/${id}/disputes`,idempotent:true,
   fields:[field('amount','المبلغ اللي يعترض عليه','text',{inputmode:'decimal',hint:`الباقي عليه ${decimal(c.balance_minor)}`}),field('reason','على وش يعترض؟','textarea'),field('evidence','الدليل (بريد العميل أو محضر)','textarea')],toPayload:v=>v};
  if(action==='record_promise')return {title:'تسجيل وعد بالسداد',endpoint:`/receivables/${id}/promises`,idempotent:true,
   fields:[field('amount','كم وعد يدفع؟','text',{inputmode:'decimal',hint:`الباقي عليه ${decimal(c.balance_minor)}`}),field('promised_on','متى؟','date'),field('contact','مين وعد؟'),field('evidence','الدليل (مكالمة موثقة أو بريد)','textarea')],toPayload:v=>v};
  return {title:{submit:'تقديم الاستحقاق',approve:'اعتماد الاستحقاق',return:'إعادة الاستحقاق',reject:'رفض الاستحقاق'}[action],endpoint:`/receivables/${id}/${action}`,fields:action==='submit'?[]:[field('note','سبب القرار','textarea')],toPayload:v=>({...v,version:c.version})};
 }
};
