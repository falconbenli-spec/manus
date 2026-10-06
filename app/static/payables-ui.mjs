// مدفوعات الموردين وضريبة المدخلات. اعتماد الأمر لا يعني أن البنك نفّذ؛ التنفيذ والمرتجع يسجّلهما موظف يدويًا بمرجع بنكي.
// الأمر تحويلٌ واحد: لجزء من مستحق أو لعدة مستحقات لمورد واحد (الترحيل 166). والحساب المتغيّر لا يُدفع له قبل مهلته،
// وأول دفعة له بسقف ويطلقها شخص ثالث.
// البلاطة والجدول والحالة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const labels={approve_order:'اعتماد أمر الدفع',reject_order:'رفض الأمر',cancel_order:'إلغاء الأمر',release_first_payment:'إطلاق أول دفعة للحساب الجديد',
  record_execution:'تسجيل التنفيذ يدويًا',record_return:'تسجيل مرتجع من البنك',verify_tax:'التحقق من الضريبة',reject_tax:'رفض السجل الضريبي',
  approve_adjustment:'اعتماد الإشعار',reject_adjustment:'رفض الإشعار'};
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
// ما ينتظر القارئ في أمر الدفع: قرار اعتماده أو رفضه، أو إطلاق أول دفعة، أو توثيق تحويل حصل في البنك.
// الإلغاء والمرتجع متاحان ولا ينتظران أحدًا.
const ORDER_WAITS=new Set(['approve_order','reject_order','release_first_payment','record_execution']);
// حال رصيد المستحق شكلًا: ما انحوّل شيء ينتظر، والجزئي جارٍ، والكامل صامت، والمسوّى بالإشعارات ساكن.
const BALANCE_TONE={not_paid:'pending',payment_pending:'pending',payment_approved:'pending',partially_paid:'in_progress',paid:'paid',settled:'closed'};
const riyadhDay=iso=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch{return String(iso??'').slice(0,10);}};
const TAX_STATES={pending:['بانتظار التحقق — ما يدخل الملخص','pending'],verified:['متحقق منها','verified'],rejected:['مرفوضة','rejected']};
export const payablesUI={
  title:'مدفوعات الموردين وضريبة المدخلات',description:'أمر الدفع تحويل واحد: لجزء من مستحق أو لعدة مستحقات لمورد واحد. ينعدّ وينعتمد، وبعدها يسجّل تنفيذه ومرتجعه شخص ثالث يدويًا. المنصة ما تحوّل فلوس.',
  load:api=>api('/payables'),
  render(data,{e,button,money,ui=kit(e)}){
    const prepare=data.permissions.includes('prepare');
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في التسمية ورأس العمود، وبعد أول مبلغ في السطر.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(String(iso).slice(0,10))}</time>`:'—';
    const acts=(list,id)=>list.length?`<div class="operation-actions">${list.map(a=>button(a,id,labels[a])).join('')}</div>`:'';
    // المستحق: عنوانه المورد وما بقي له، ثم كيف بقي: المستحق بعد الإشعارات، وما انحوّل، وما في الطريق.
    const payables=data.payables.map(p=>{
      const b=p.balance,open=prepare&&p.payable&&b.available_minor>0;
      return `<li class="${p.block_reason?'is-late':''}"><strong>${e(p.supplier_name)} — يتبقى ${fig(b.outstanding_minor)} ريال</strong><span class="badge ${BALANCE_TONE[b.status]??''}">${e(b.status_name)}</span><span>فاتورة <bdi dir="ltr">${e(p.supplier_reference)}</bdi> · المستحق ${fig(b.adjusted_minor)} · انحوّل ${fig(b.paid_minor)} · في الطريق ${fig(b.in_flight_minor)}${b.available_minor!==b.outstanding_minor&&b.available_minor>0?` · المتاح للدفع الحين ${fig(b.available_minor)}`:''}</span>${p.first_payment?'<small>حساب المورد تغيّر: أول دفعة له بسقف معتمد، ويطلقها شخص ثالث قبل تسجيلها.</small>':''}${p.block_reason?`<small>ما ينعدّ له دفع: ${e(p.block_reason)}</small>`:''}${open?`<div class="operation-actions">${button('prepare_payment',p.id,'إعداد أمر دفع')}</div>`:''}</li>`;
    }).join('');
    const orderCard=o=>{
      const waits=o.actions.some(a=>ORDER_WAITS.has(a)),tone=waits?'is-decision':o.returned?'is-late':o.status==='pending'?'is-pending':['rejected','cancelled'].includes(o.status)?'is-old':'';
      const badge=o.returned?`<span class="badge rejected">${e(o.status_name)}</span>`:ui.statusBadge(o.status,{module:'payment_order'});
      const lines=o.lines.length>1?ui.table({head:['فاتورة المورد','المبلغ (ريال)'],rows:[...o.lines.map(l=>`<tr><td><bdi dir="ltr">${e(l.supplier_reference)}</bdi></td><td>${fig(l.amount_minor)}</td></tr>`),`<tr><th scope="row">التحويل</th><td><strong>${fig(o.amount_minor)}</strong></td></tr>`]}):'';
      // سطر الاعتماد بديل التوقيع: الاسم ودوره في الأمر ووقته.
      const signatures=[['أعدّه',o.prepared_by_name,o.created_at],['اعتمده',o.approved_by_name,o.approved_at],...(o.status==='executed'?[['سجّل التنفيذ يدويًا',o.execution_recorded_by_name,null]]:[])].filter(([,name])=>name);
      return `<details class="vn-card ${tone}"${waits||['pending','approved'].includes(o.status)?' open':''}><summary><span class="vn-code"><bdi>${e(o.vendor_code)}</bdi></span><span class="vn-name"><strong>${e(o.vendor_name)}</strong><small>${e(o.bank_name)}${o.lines.length>1?` · <span data-num>${o.lines.length}</span> فواتير`:''}</small></span><span class="vn-flags"><strong>${fig(o.amount_minor)} ريال</strong>${waits?'<span class="badge is-decision">ينتظرك</span>':''}${badge}</span></summary><div class="vn-body">
        ${acts(o.actions,o.id)}
        ${o.execution_warning?`<div class="vn-alert is-late"><strong>تغيّر وضع المستفيد — يحتاج مراجعة</strong><p class="measure">${e(o.execution_warning.message)}</p><p class="measure">إذا التحويل صار فعلًا، وثّق مرجعه ودليله ووقت الواقعة. التحذير ينحفظ في سجل التدقيق، والتوثيق لا يجيز تحويلًا جديدًا.</p></div>`:''}
        ${o.first_payment.required?`<div class="vn-alert ${o.first_payment.released?'':'is-due'}"><strong>أول دفعة لحساب مورد تغيّر</strong><p class="measure">${o.release?`انطلقت في ${day(o.release.created_at)}: ${e(o.release.note)}`:'ما تنسجل منفّذة قبل ما يطلقها شخص ثالث: غير اللي أعدّها واللي اعتمدها واللي جمع بيانات الحساب واللي تحقق منها.'}</p>${o.first_payment.you_are_barred?'<p>أنت جمعت أو تحققت من حساب هالمورد الجديد، فما تعتمد ولا تطلق ولا تسجّل أول دفعة له.</p>':''}</div>`:''}
        ${o.status==='approved'?'<div class="vn-alert is-due"><strong>معتمد وما انحوّل للحين.</strong><p class="measure">التحويل يصير من بنك الشركة برّا المنصة، وبعدها يسجّل شخص غير المعدّ وغير جامع بيانات الحساب مرجعه البنكي ودليله يدويًا.</p></div>':''}
        ${lines}
        ${o.status==='executed'?`<dl class="vn-facts"><div><dt>تاريخ التنفيذ</dt><dd>${day(o.executed_on)}</dd></div><div><dt>المرجع البنكي</dt><dd><bdi dir="ltr">${e(o.bank_reference)}</bdi></dd></div></dl><p class="subtle measure">${e(o.execution_evidence)}</p>`:''}
        ${o.returned?`<div class="vn-alert is-late"><strong>${e(o.status_name)}</strong><p>رجع ${fig(o.return.credited_minor)} ريال لحساب الشركة في ${day(o.return.returned_on)}: ${e(o.return.reason)}</p><p class="subtle">مرجع المرتجع <bdi dir="ltr">${e(o.return.bank_reference)}</bdi></p></div>`:''}${o.decision_note?`<p class="subtle measure">ملاحظة القرار: ${e(o.decision_note)}</p>`:''}
        ${signatures.length?`<dl class="vn-facts">${signatures.map(([role,name,at])=>`<div><dt>${e(role)}</dt><dd>${e(name)}${at?` · <time datetime="${e(at)}">${e(riyadhDay(at))}</time>`:''}</dd></div>`).join('')}</dl>`:''}</div></details>`;
    };
    // الإشعار الدائن ينقص ما علينا والمدين يزيده: بعلامته وكلمته، لا بلون.
    const adjustment=a=>`<li class="${a.actions.length?'is-decision':a.status==='pending'?'is-pending':''}"><strong>${e(a.kind_name)} · <bdi dir="ltr">${e(a.reference)}</bdi></strong>${a.actions.length?'<span class="badge is-decision">ينتظر قرارك</span>':''}<span><span class="ltr">${a.kind==='credit'?'−':'+'}${e(num(a.amount_minor))}</span> ريال${a.vat_minor?` · منها ضريبة ${fig(a.vat_minor)}`:''} · ${e(a.status_name)} · فاتورة <bdi dir="ltr">${e(a.supplier_reference)}</bdi></span><small class="measure">${e(a.reason)}</small>${acts(a.actions,a.id)}</li>`;
    const tax=t=>{const [word,tone]=TAX_STATES[t.status]??[t.status,''];
      return `<li class="${t.actions.length?'is-decision':t.status==='pending'?'is-pending':''}"><strong><bdi dir="ltr">${e(t.supplier_key)} / ${e(t.supplier_invoice_number)}</bdi> · ضريبة ${fig(t.vat_minor)} ريال</strong><span class="badge ${t.actions.length?'is-decision':tone}">${t.actions.length?'ينتظر تحققك':e(word)}</span><span>تاريخ الفاتورة ${day(t.invoice_date)} · الرقم الضريبي للمورد <bdi dir="ltr">${e(t.supplier_vat_number)}</bdi></span><small class="measure">${e(t.evidence)}</small>${acts(t.actions,t.id)}</li>`;};
    const waitingOrders=data.orders.filter(o=>o.actions.some(a=>ORDER_WAITS.has(a))),otherOrders=data.orders.filter(o=>!waitingOrders.includes(o));
    const waitingRows=[...data.payable_adjustments.filter(a=>a.actions.length).map(adjustment),...data.taxes.filter(t=>t.actions.length).map(tax)].join('');
    const openCount=data.payables.filter(p=>p.payable&&p.balance.available_minor>0).length;
    const head=[prepare&&openCount>1?button('prepare_batch','','دفعة واحدة لعدة مستحقات'):'',prepare&&data.payables.length?button('record_adjustment','','تسجيل إشعار دائن أو مدين'):'',prepare&&data.untaxed_invoices.length?button('record_tax','','تسجيل ضريبة فاتورة مورد'):''].join('');
    const block=(title,items,none)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${items?`<ul class="vn-list">${items}</ul>`:`<p class="subtle">${e(none)}</p>`}</section>`;
    return `<section class="panel panel-body vn-head">${head?`<div class="operation-actions">${head}</div>`:''}<p>${e(data.note)}</p><p>${e(data.execution.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(num(data.totals.unpaid_minor),'متبقي للموردين بالريال')}${ui.tile(num(data.totals.approved_not_executed_minor),'معتمد وما انحوّل بالريال',data.totals.approved_not_executed_minor?'is-due':'')}${ui.tile(num(data.totals.executed_minor),'انحوّل وسجّله موظف يدويًا بالريال')}${data.totals.returned_minor?ui.tile(num(data.totals.returned_minor),'رجع من البنك بالريال','is-late'):''}${ui.tile(num(data.totals.verified_input_vat_minor),'ضريبة مدخلات متحقق منها بالريال')}</div></section>
      ${waitingOrders.length||waitingRows?`<section class="vn-group"><h2>ينتظرك <span>${waitingOrders.length+data.payable_adjustments.filter(a=>a.actions.length).length+data.taxes.filter(t=>t.actions.length).length}</span></h2>${waitingOrders.map(orderCard).join('')}${waitingRows?`<ul class="vn-list">${waitingRows}</ul>`:''}</section>`:''}
      ${block('المستحقات المطابَقة',payables,'ما فيه مستحقات مطابَقة للحين — تطلع هنا أول ما تتطابق فاتورة مورد مع أمرها واستلامها في «المشتريات».')}
      ${otherOrders.length?`<section class="vn-group"><h2>أوامر الدفع <span>${otherOrders.length}</span></h2>${otherOrders.map(orderCard).join('')}</section>`:''}
      <div class="vn-grid">${block('إشعارات الموردين',data.payable_adjustments.filter(a=>!a.actions.length).map(adjustment).join(''),'ما فيه إشعار دائن ولا مدين مسجّل غير اللي ينتظرك.')}${block('ضريبة المدخلات',data.taxes.filter(t=>!t.actions.length).map(tax).join(''),'ما انسجّلت ضريبة فاتورة مورد غير اللي تنتظرك.')}</div>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    const openPayables=data.payables.filter(p=>p.payable&&p.balance.available_minor>0);
    if(action==='prepare_payment'){const p=openPayables.find(x=>x.id===id);guard(p&&data.permissions.includes('prepare'));
      return {title:`أمر دفع — ${p.supplier_name}`,endpoint:'/payables/orders',idempotent:true,
        fields:[field('amount','المبلغ بالريال','text',{value:decimal(p.balance.available_minor),inputmode:'decimal',hint:`المتاح ${decimal(p.balance.available_minor)}. تقدر تدفع جزء منه${p.first_payment?'، وأول دفعة لحساب تغيّر ما تتجاوز السقف المعتمد':''}.`})],
        toPayload:v=>({payable_id:id,amount:v.amount})};}
    if(action==='prepare_batch'){guard(data.permissions.includes('prepare')&&openPayables.length>1);
      return {title:'دفعة واحدة لعدة مستحقات لمورد واحد',endpoint:'/payables/orders',idempotent:true,
        fields:[field('lines','المستحقات ومبالغها','rows',{minRows:1,maxRows:50,hint:'كل السطور لمورد واحد، والتحويل واحد لحسابه الساري. كل مبلغ ما يتجاوز المتاح على مستحقه.',
          columns:[{name:'payable_id',label:'المستحق',type:'select',options:openPayables.map(p=>({value:p.id,label:`${p.supplier_name} · ${p.supplier_reference} · المتاح ${decimal(p.balance.available_minor)}`}))},{name:'amount',label:'المبلغ بالريال',type:'text'}]})],
        toPayload:v=>({lines:v.lines.map(l=>({payable_id:l.payable_id,...(l.amount?{amount:l.amount}:{})}))})};}
    if(action==='record_adjustment'){guard(data.permissions.includes('prepare')&&data.payables.length);
      return {title:'إشعار دائن أو مدين من مورد',endpoint:'/payables/adjustments',idempotent:true,fields:[
        field('payable_id','المستحق','select',{options:data.payables.map(p=>({value:p.id,label:`${p.supplier_name} · ${p.supplier_reference}`}))}),
        field('kind','نوع الإشعار','select',{options:[{value:'credit',label:'إشعار دائن — ينقص اللي علينا'},{value:'debit',label:'إشعار مدين — يزيد اللي علينا'}]}),
        field('amount','مبلغ الإشعار بالريال','text',{inputmode:'decimal'}),field('vat','منها ضريبة القيمة المضافة','text',{required:false,inputmode:'decimal'}),
        field('reference','رقم الإشعار عند المورد'),field('reason','سبب الإشعار','textarea'),field('evidence','مرجع الإشعار ومكان حفظه','textarea')],
        toPayload:v=>({payable_id:v.payable_id,kind:v.kind,amount:v.amount,...(v.vat?{vat:v.vat}:{}),reference:v.reference,reason:v.reason,evidence:v.evidence})};}
    if(action==='record_tax'){guard(data.permissions.includes('prepare'));return {title:'ضريبة فاتورة مورد',endpoint:'/payables/input-tax',idempotent:true,fields:[field('invoice_id','فاتورة المورد','select',{options:data.untaxed_invoices.map(i=>({value:i.id,label:`${i.supplier_key} / ${i.supplier_reference}`}))}),field('supplier_vat_number','الرقم الضريبي للمورد','text',{maxLength:15}),field('supplier_invoice_number','رقم الفاتورة الضريبية'),field('invoice_date','تاريخ الفاتورة','date',{value:data.today}),field('vat','مبلغ الضريبة','text'),field('evidence','مرجع الفاتورة الضريبية ومكان حفظها','textarea')],toPayload:v=>v};}
    if(action==='verify_tax'||action==='reject_tax'){const t=data.taxes.find(x=>x.id===id);guard(t&&t.actions.includes(action));return {title:labels[action],endpoint:`/payables/input-tax/${id}/${action==='verify_tax'?'verify':'reject'}`,fields:[field('note','أساس القرار','textarea')],toPayload:v=>v};}
    if(action==='approve_adjustment'||action==='reject_adjustment'){const a=data.payable_adjustments.find(x=>x.id===id);guard(a&&a.actions.includes(action));
      return {title:`${labels[action]} — ${a.reference}`,endpoint:`/payables/adjustments/${id}/${action==='approve_adjustment'?'approve':'reject'}`,fields:[field('note',action==='approve_adjustment'?'وش طابقت؟':'السبب','textarea')],toPayload:v=>v};}
    const o=data.orders.find(x=>x.id===id);guard(o&&o.actions.includes(action));
    if(action==='record_execution')return {title:`تسجيل التنفيذ يدويًا — ${o.vendor_name}`,endpoint:`/payables/orders/${id}/record_execution`,fields:[field('executed_on','تاريخ التنفيذ في البنك','date',{value:data.today}),field('bank_reference','المرجع البنكي للعملية'),field('evidence','دليل التنفيذ ومكان حفظه','textarea')],toPayload:v=>({...v,version:o.version})};
    if(action==='record_return')return {title:`مرتجع من البنك — ${o.vendor_name}`,endpoint:`/payables/orders/${id}/record_return`,fields:[field('returned_on','يوم رجوع المبلغ لحساب الشركة','date',{value:data.today}),field('bank_reference','مرجع المرتجع في كشف البنك'),field('credited','المبلغ اللي رجع بالريال','text',{value:decimal(o.amount_minor),inputmode:'decimal',hint:'اكتب اللي دخل الحساب فعلًا؛ الفرق عن مبلغ التحويل رسوم بنك. المستحق يرجع مفتوح بمبلغ التحويل كامل.'}),field('reason','سبب الرجوع زي ما ذكره البنك','textarea'),field('evidence','دليل المرتجع ومكان حفظه','textarea')],toPayload:v=>({...v,version:o.version})};
    if(action==='release_first_payment')return {title:`إطلاق أول دفعة — ${o.vendor_name}`,endpoint:`/payables/orders/${id}/release_first_payment`,fields:[field('note','مع مين تأكدتوا من الحساب الجديد وكيف','textarea',{hint:'مثال: اتصلنا بجهة الاتصال الموثقة قبل التغيير على رقمها المعروف وأكدت الحساب.'})],toPayload:v=>({...v,version:o.version})};
    return {title:`${labels[action]} — ${o.vendor_name}`,endpoint:`/payables/orders/${id}/${action}`,fields:[field('note',action==='approve_order'?'وش طابقت؟':'السبب','textarea')],toPayload:v=>({...v,version:o.version})};
  }
};
