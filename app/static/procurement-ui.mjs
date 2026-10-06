// الجدول والحالة الفارغة والشارة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
import { riyadhDay } from './dates.mjs';
const statuses = {draft:'مسودة',sourcing:'جمع العروض',awarded:'تمت الترسية',ordered:'أمر داخلي معتمد',part_received:'استلام جزئي',received:'اكتمل الاستلام',rejected:'مرفوض',cancelled:'ملغى'};
const labels = {create:'احتياج شراء جديد',edit:'تعديل المسودة',submit:'تقديم لجمع العروض',add_quote:'إضافة عرض مورد',award:'توثيق الترسية',approve_order:'اعتماد الأمر الداخلي',commence:'إصدار أمر المباشرة',replace_commencement:'استبدال أمر المباشرة',withdraw_commencement:'سحب أمر المباشرة',receive:'تسجيل استلام',record_invoice:'تسجيل مرجع فاتورة المورد',match:'اعتماد المطابقة',reject:'رفض الاحتياج',cancel:'إلغاء الاحتياج',
  submit_rfq:'رفع طلب عرض السعر للمالية',finance_review_rfq:'قرار التحقق المالي',
  record_return:'تسجيل مرتجع للمورد',decide_invoice:'قرار فرق الفاتورة',propose_void:'طلب إلغاء',decide_void:'قرار الإلغاء',waive_credit:'التنازل عن الإشعار',record_credit_note:'تسجيل إشعار المورد الدائن'};
// اليوم بتوقيت الرياض: الخادم يحسب سريان أمر المباشرة على يوم الرياض، فالقيمة المقترحة في النموذج على اليوم نفسه.
const riyadhToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// أمر المباشرة وتاريخه (الترحيلان 116 و162): الإذن القائم وحكم سريانه اليوم، ثم كل إذن سبقه بحاله — مستبدَل أو مسحوب —
// كما صدر. الحالات وعباراتها من الخادم (state_name وvalidity.name)، فلا قاموس محلي يفترق عن المحرك.
function commencementPanel(row,e) {
  if (!row.order) return '';
  const live=row.commencement,past=(row.commencement_history??[]).filter(item=>item.state!=='live');
  const inFlight=['ordered','part_received'].includes(row.status);
  const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'';
  const facts=item=>`<dl class="vn-facts"><div><dt>أصدره</dt><dd>${e(item.issued_by_name)}</dd></div><div><dt>يسري</dt><dd>من ${day(item.start_on)} لين ${item.valid_until?day(item.valid_until):'بدون تاريخ نهاية'}</dd></div><div><dt>موقع التنفيذ أو قناته</dt><dd>${e(item.site_or_channel)}</dd></div><div><dt>النطاق</dt><dd>${e(item.scope_confirmation)}</dd></div><div><dt>دليل إبلاغ المورد</dt><dd>${e(item.evidence??'—')}</dd></div>${item.replacement_reason?`<div><dt>سبب الاستبدال</dt><dd>${e(item.replacement_reason)}</dd></div>`:''}</dl>`;
  const head=live?`<p><strong>أمر المباشرة رقم ${e(live.sequence)}</strong> <span class="badge ${live.validity.satisfies_receipt?'active':'is-due'}">${e(live.validity.name)}</span></p>${live.validity.satisfies_receipt?'':'<p class="subtle">الاستلام مقفل لين يسري إذن على آخر نسخة من أمر الشراء اليوم.</p>'}${facts(live)}`
    :inFlight?'<p class="subtle">ما فيه أمر مباشرة قائم، فالاستلام من المورد مقفل لين يصدر.</p>':'';
  const history=past.length?`<details><summary>أوامر المباشرة السابقة (${e(past.length)})</summary>${past.map(item=>`<p><strong>رقم ${e(item.sequence)}</strong> · ${e(item.state_name)}${item.withdrawal?` · سحبه ${e(item.withdrawal.withdrawn_by_name)}: ${e(item.withdrawal.reason)}<br><span class="subtle">${e(item.withdrawal.evidence)}</span>`:''}</p>${facts(item)}`).join('')}</details>`:'';
  return head||history?`<details open><summary>أمر المباشرة</summary>${head}${history}</details>`:'';
}
const decimal = minor => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2,'0')}`;
const field = (name,label,type='text',extra={}) => ({name,label,type,required:true,...extra});
const note = label => field('note',label,'textarea');
const invoiceOptions = (row,user) => row.invoices.filter(i=>i.recorded_by!==user.id && !row.payables.some(p=>p.invoice_id===i.id) && i.matchable!==false);
// الترسية على عتبة الخادم نفسها: ثلاثة عروض، أو عرض واحد مع شراء طارئ معتمد (procurementAction، الترسية). كان الزر يظهر بعرضين
// فيرفضه الخادم، ويختفي بعرض طارئ معتمد فلا يُبلغ مسار الطارئ من الشاشة أبدًا.
const awardReady = row => row.quotes.length>=3 || (row.emergency?.status==='approved' && row.quotes.length>=1);
const signed = minor => minor<0 ? `-${decimal(-minor)}` : decimal(minor);
const rfqStatuses={pending_finance:'بانتظار التحقق المالي',approved:'تحقق مالي معتمد',changes_required:'يحتاج تعديلًا',rejected:'مرفوض ماليًا'};
function rfqPanel(row,{e,amount}){
  const versions=row.rfqs??[],current=row.rfq;
  if(!versions.length)return row.status==='awarded'?'<div class="notice warning"><strong>بوابة F-03/F-04:</strong> لم يُرفع طلب عرض السعر للمالية بعد، لذلك قد يكون إصدار أمر الشراء مقفلًا.</div>':'';
  const review=current?.finance_review;
  const lines=current?.lines??[];
  return `<details open><summary>طلب عرض السعر والتحقق المالي (${e(versions.length)} إصدار)</summary>
    <p><strong>${e(current.rfq_number)}</strong> · <span class="badge">${e(rfqStatuses[current.status]??current.status)}</span>${current.overdue?' <span class="badge rejected">تجاوز مهلة يوم العمل</span>':''}</p>
    <dl class="detail-data"><dt>المورد</dt><dd>${e(row.quotes.find(q=>q.id===current.quote_id)?.supplier_name??current.quote_id)}</dd><dt>مرجع عرض المورد</dt><dd>${e(current.vendor_quote_reference)}</dd><dt>تاريخ العرض / الصلاحية</dt><dd>${e(current.quotation_on)} / ${e(current.valid_until)}</dd><dt>مرجع RFP</dt><dd>${e(current.rfp_reference??'لا يوجد')}</dd><dt>الإجمالي قبل الضريبة</dt><dd>${amount(current.subtotal_minor)}</dd><dt>الضريبة المسجلة في العرض</dt><dd>${amount(current.vat_minor)}</dd><dt>الإجمالي</dt><dd>${amount(current.total_minor)}</dd><dt>المسار</dt><dd>${e(current.po_required?'يتطلب أمر شراء':'إجراء مالي مباشر بلا أمر شراء')}</dd><dt>موعد المالية</dt><dd>${e(current.finance_due_on)}</dd></dl>
    <div class="table-wrap"><table class="operations-table"><thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>سعر العرض</th><th>سعر البطاقة</th><th>الفرق</th><th>النتيجة</th></tr></thead><tbody>${lines.map(line=>{const compared=review?.lines?.find(x=>x.rfq_line_id===line.id);return `<tr><td>${e(line.line_no)}</td><td>${e(line.description)}</td><td>${e(line.quantity)} ${e(line.unit)}</td><td>${amount(line.quote_unit_price_minor)}</td><td>${compared?.rate_card_unit_price_minor?amount(compared.rate_card_unit_price_minor):'—'}</td><td>${compared?.difference_minor!==null&&compared?.difference_minor!==undefined?e(signed(compared.difference_minor)):'—'}</td><td>${e(compared?.result??'بانتظار المالية')}${compared?.note?`<br><span class="subtle">${e(compared.note)}</span>`:''}</td></tr>`;}).join('')}</tbody></table></div>
    ${review?`<p><strong>تقرير التحقق:</strong> ${e(review.report_number)} في ${e(review.report_date)} · ${e(review.reviewed_by_name??review.reviewed_by)}<br>${e(review.finance_notes)}</p>`:'<p class="subtle">ينتظر تقرير التحقق المالي F-04. لا يُعد عدم وجود سعر مرجعي نجاحًا؛ يجب تسجيله مع مبرره.</p>'}
  </details>`;
}
// استثناءات الطلب (الترحيل 169): المرتجعات، والفاتورة الموقوفة بفرقها لكل بند وقرارها، وطلبات الإلغاء، وطلبات الإشعار الدائن على
// المستحقات. الأزرار من actions التي يحسبها الخادم لكل سجل بحسب من يراه، فلا يُعرض فعلٌ يرفضه.
function exceptionPanels(row,{e,button,amount}) {
  const orderById=new Map((row.order?.lines??[]).map(line=>[line.id,line]));
  const lineName=id=>e(orderById.get(id)?.description??id);
  const acts=(list,id)=>(list??[]).length?`<div class="operation-actions">${list.map(action=>button(action,id,labels[action]??action)).join('')}</div>`:'';
  // الفرق بإشارته داخل العزل وبكلمته: الموجب أعلى من الأمر، والسالب أقل منه.
  const gap=minor=>`<span class="ltr">${e(signed(minor))}</span>${minor?` <small>${minor>0?'أعلى من الأمر':'أقل من الأمر'}</small>`:''}`;
  const returns=(row.returns??[]).length?`<details open><summary>المرتجع للمورد (${e(row.returns.length)})</summary><ul class="vn-list">${row.returns.map(r=>`<li><strong><bdi>${e(r.reference)}</bdi></strong><span>${r.lines.map(line=>`${lineName(line.order_line_id)}: <span data-num>${e(line.quantity)}</span>`).join(' · ')}</span><small class="measure">${e(r.reason)} — ${e(r.evidence)}</small></li>`).join('')}</ul><p class="subtle">المرتجع نهائي: ما ينستلم بدله على هالأمر، وينقص اللي يتطابق.</p></details>`:'';
  const variance=v=>v?.has_variance?`<div class="table-wrap"><table><thead><tr><th>البند</th><th>فرق السعر (ريال)</th><th>فرق الكمية</th><th>ينتظر إشعار دائن (ريال)</th></tr></thead><tbody>${v.lines.map(line=>`<tr><td>${e(line.description)}</td><td>${gap(line.price_variance_minor)}</td><td><span class="ltr">${e(line.quantity_variance)}</span></td><td>${amount(line.expected_credit_minor)}</td></tr>`).join('')}</tbody></table></div>`:'';
  const decisionText=d=>d?`<small class="measure">${e(d.decision_name??d.decision)} · ${e(d.basis_name??d.basis)} · ${e(d.decided_by_name??d.decided_by)}: ${e(d.note)}${d.override_reason?` — ${e(d.override_reason)}`:''}</small>`:'';
  const tone={held:'is-due',awaiting_receipt:'pending',ready:'pending',decided:'pending',matched:'matched',rejected:'rejected',voided:'cancelled'};
  const exceptional=(row.invoices??[]).filter(i=>(i.state&&!['ready','matched'].includes(i.state))||(i.actions??[]).length);
  const invoices=exceptional.length?`<details open><summary>فواتير تنتظر قرار أو وصول (${e(exceptional.length)})</summary><ul class="vn-list">${exceptional.map(i=>`<li data-id="${e(i.id)}" class="${(i.actions??[]).length?'is-decision':i.state==='held'?'is-due':''}"><strong><bdi>${e(i.supplier_reference)}</bdi> — ${amount(i.amount_minor)} ريال</strong><span class="badge ${tone[i.state]??''}">${e(i.state_name??i.state)}</span>${decisionText(i.decision)}${variance(i.variance)}${acts(i.actions,i.id)}</li>`).join('')}</ul></details>`:'';
  const voids=(row.voids??[]).length?`<details open><summary>طلبات الإلغاء (${e(row.voids.length)})</summary><ul class="vn-list">${row.voids.map(x=>`<li data-id="${e(x.id)}" class="${(x.actions??[]).length?'is-decision':x.state==='pending'?'is-pending':''}"><strong>${e(x.state_name??x.state)}</strong><span>طلبه ${e(x.requested_by_name??x.requested_by)}</span><small class="measure">${e(x.reason)} — ${e(x.evidence)}${x.decision?` — ${e(x.decided_by_name??x.decision.decided_by)}: ${e(x.decision.note)}`:''}</small>${acts(x.actions,x.id)}</li>`).join('')}</ul></details>`:'';
  const requests=(row.payables??[]).flatMap(pay=>(pay.credit_requests??[]).map(r=>({pay,r})));
  const credits=requests.length?`<details open><summary>إشعارات دائنة ننتظرها من المورد (${e(requests.length)})</summary><ul class="vn-list">${requests.map(({pay,r})=>`<li data-id="${e(r.id)}" class="${(r.actions??[]).length?'is-decision':r.waived?'is-old':'is-pending'}"><strong>${e(r.source==='return'?'عن مرتجع':'عن فرق فاتورة')} — ${amount(r.amount_minor)} ريال</strong>${r.waived?'<span class="badge withdrawn">متنازَل عنه</span>':''}<span>وصل منه ${amount(r.credited_minor)} · محجوز عن الدفع ${amount(r.outstanding_minor)}</span>${r.outstanding_minor>pay.available_minor?'<small class="is-late-text">الباقي أكبر من اللي ما انحوّل من المستحق: ينسترد من المورد بقرار المالية.</small>':''}${acts(r.actions,r.id)}</li>`).join('')}</ul></details>`:'';
  return returns+invoices+voids+credits;
}

function fieldsForPurchase(row) {
  const lines=row?.lines?.map(line=>({description:line.description,quantity:line.quantity,unit:line.unit,
    cost_center:line.allocations?.[0]?.cost_center??row.cost_center,budget_amount:decimal(line.allocations?.[0]?.amount_minor??0)}))??[];
  return [
    field('title','عنوان الاحتياج','text',{value:row?.title ?? ''}),
    field('specification','الغرض العام ومعيار قبول الطلب','textarea',{value:row?.specification ?? ''}),
    field('due_date','موعد الحاجة','date',{value:row?.due_date ?? ''}),
    field('lines','بنود الاحتياج','rows',{value:lines,minRows:row?.lines?.length??1,maxRows:row?.lines?.length??100,
      hint:row?'تقدر تعدّل تفاصيل البنود في المسودة، وعددها يبقى زي ما هو.':'أضف كل بند بكميته ووحدته ومخصصه. الطلب كله على مركز تكلفة واحد.',
      columns:[
        {name:'description',label:'وصف البند',type:'text',maxLength:500},
        {name:'quantity',label:'الكمية',type:'number',min:1,max:1000000},
        {name:'unit',label:'الوحدة',type:'text',maxLength:60},
        {name:'cost_center',label:'مركز التكلفة',type:'text',maxLength:120},
        {name:'budget_amount',label:'المخصص بالريال',type:'text',maxLength:14}
      ]}),
    field('budget_evidence','دليل المخصص المحلي لهذا الاحتياج','textarea',{value:row?.budget_evidence ?? ''}),
    field('currency','العملة','select',{value:'SAR',options:[{value:'SAR',label:'ريال سعودي SAR'}]})
  ];
}

export const procurementUI = {
  title:'المشتريات والموردون',
  description:'احتياج المشروع، مقارنة العروض، الأمر الداخلي، الاستلام ومطابقة مرجع المورد. المستحقات محلية، ما انصرفت ولا ترحّلت ماليًا.',
  async load(api) {
    const [purchases,projects,me,rfqQueue] = await Promise.all([api('/procurement'),api('/projects'),api('/me'),api('/procurement-rfqs')]);
    return {purchases,projects,user:me.user,rfq_queue:rfqQueue};
  },
  render(data,{e,button,money,ui=kit(e)}) {
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في رأس العمود، وبعد أول مبلغ في السطر.
    const amount = minor => `<span class="ltr">${e(money(minor,'').trim())}</span>`;
    const day = iso => iso ? `<time datetime="${e(riyadhDay(iso))}">${e(riyadhDay(iso))}</time>` : '—';
    const canCreate = ['employee','manager','pm'].includes(data.user.role) && data.projects.length > 0;
    const queue=(data.rfq_queue??[]).filter(x=>x.status==='pending_finance');
    const financeQueue=queue.length?`<div class="panel"><div class="panel-body"><h2>طلبات عرض السعر عند المالية</h2><p class="subtle">المهلة من المصدر يوم عمل واحد. القرار يحفظ تقرير F-04 ومقارنة كل بند بسعره المرجعي.</p>${queue.map(x=>`<div class="file"><div><strong>${e(x.rfq_number)} · ${e(x.purchase_title)}</strong><br>${e(x.supplier_name)} · ${amount(x.total_minor)} · يستحق ${e(x.finance_due_on)}${x.overdue?' <span class="badge rejected">متأخر</span>':''}</div><div>${(x.actions??[]).map(a=>button(a,x.id,labels[a])).join(' ')}</div></div>`).join('')}</div></div>`:'';
    const header = financeQueue+`<section class="panel panel-body vn-head">${canCreate ? `<div class="operation-actions">${button('create','','احتياج شراء جديد')}</div>` : ''}<p>الأمر المعتمد ينحفظ داخل المنصة. كل طلب يقبل عدة بنود بأسعار واستلامات ومراجع فواتير مستقلة، وما ينرسل أمر خارجي ولا تنصرف دفعة من هالشاشة.</p><p>المخصص المحلي وحجز المشروع على مركز تكلفة واحد للطلب، ويأكدهما معتمد الترسية.${canCreate ? '' : ' إنشاء الاحتياج لأعضاء المشاريع بالأدوار المهيأة.'}</p></section>`;
    if (!data.purchases.length) return header + ui.empty('ما فيه احتياجات شراء في نطاقك الحين', canCreate ? 'ابدأ من «احتياج شراء جديد» ببنوده ومخصصه، وبعدها تنجمع العروض.' : 'تطلع هنا احتياجات المشاريع اللي أنت عضو فيها.');
    // الأزرار على عتبة الخادم نفسها: الترسية بثلاثة عروض أو طارئ معتمد، والفاتورة ما دام في الأمر ما لم يُفوتر، والمطابقة ما دام لها فاتورة.
    const invoicedOf=(row,id)=>row.invoices.flatMap(invoice=>invoice.lines??[]).filter(line=>line.order_line_id===id).reduce((sum,line)=>sum+line.quantity,0);
    const offeredOf=row=>[...(row.rfq_actions??[]),...row.allowed_actions].filter(action=>{
      if (action==='award') return awardReady(row);
      if (action==='record_invoice') return (row.order?.lines??[]).some(line=>(line.invoiced_quantity??invoicedOf(row,line.id))<line.quantity);
      if (action==='match') return invoiceOptions(row,data.user).length>0;
      return true;
    });
    const purchaseCard = row=>{
      const project = data.projects.find(p=>p.id===row.project_id);
      const orderById=new Map((row.order?.lines??[]).map(line=>[line.id,line]));
      const receivedBy=id=>row.receipts.flatMap(receipt=>receipt.lines??[]).filter(line=>line.order_line_id===id).reduce((sum,line)=>sum+line.quantity,0);
      const invoicedBy=id=>invoicedOf(row,id);
      const offered = offeredOf(row);
      const buttons = offered.map(action=>button(action,row.id,labels[action])).join('');
      const purchaseLines=ui.table({head:['#','البند','الكمية','مركز التكلفة','المخصص (ريال)'],rows:row.lines.map(line=>`<tr><td><span data-num>${e(line.line_no)}</span></td><td>${e(line.description)}</td><td><span data-num>${e(line.quantity)}</span> ${e(line.unit)}</td><td><bdi>${e(line.allocations?.[0]?.cost_center??'—')}</bdi></td><td>${amount(line.allocations?.[0]?.amount_minor)}</td></tr>`)});
      const quotes = row.quotes.length ? ui.table({head:['المورد','تسعير البنود (ريال)','الإجمالي (ريال)','التقييم الفني','الشروط والتسليم','الدليل'],rows:row.quotes.map(q=>`<tr><td>${e(q.supplier_name)} <small><bdi>${e(q.supplier_key)}</bdi></small>${row.award?.quote_id===q.id?' <span class="badge approved">العرض المختار</span>':''}</td><td>${q.lines.map(line=>`${e(line.line_no)}. ${e(line.description)}: ${amount(line.unit_price_minor)}`).join('<br>')}</td><td>${amount(q.total_minor)}</td><td>${e(q.technical_assessment)}</td><td>${e(q.financial_terms)}<br>${day(q.delivery_date)}</td><td>${e(q.evidence)}</td></tr>`)}) : '<p class="subtle">ما انسجلت عروض للحين. الترسية تحتاج ثلاث عروض من موردين مختلفين.</p>';
      const budget = row.budget_reservation?`<p><strong>حجز مخصص المشروع:</strong> ${amount(row.budget_reservation.amount_minor)} ريال · ${e(({reserved:'محجوز',committed:'ملتزم بأمر شراء',released:'محرر'})[row.budget_reservation.status])}</p>${row.commitment?`<p class="subtle">ملتزم به ينتظر فاتورة ${amount(row.commitment.committed_minor)} · مستهلك ${amount(row.commitment.consumed_minor)} · متحرر ${amount(row.commitment.released_minor)}</p>`:''}`:'<p class="subtle">يلزم مخصص مشروع معتمد قبل الترسية، ويندار من «مخصصات المشاريع».</p>';
      const award = row.award ? `<p class="measure"><strong>مبرر الترسية:</strong> ${e(row.award.note)}</p>` : '';
      const order = row.order ? `<details open><summary>الأمر الداخلي المعتمد</summary><dl class="vn-facts"><div><dt>المورد</dt><dd>${e(row.order.supplier_name)}</dd></div><div><dt>قيمة الأمر</dt><dd>${amount(row.order.total_minor)} ريال</dd></div><div><dt>موعد التسليم</dt><dd>${day(row.order.delivery_date)}</dd></div><div><dt>الشروط</dt><dd>${e(row.order.terms)}</dd></div><div><dt>دليل الاعتماد</dt><dd>${e(row.order.note)}</dd></div></dl>${ui.table({head:['البند','الكمية','سعر الوحدة (ريال)','الإجمالي (ريال)','المستلم','المفوتر'],rows:[...row.order.lines.map(line=>`<tr><td>${e(line.description)}</td><td><span data-num>${e(line.quantity)}</span> ${e(line.unit)}</td><td>${amount(line.unit_price_minor)}</td><td>${amount(line.total_minor)}</td><td><span data-num>${e(receivedBy(line.id))}</span></td><td><span data-num>${e(invoicedBy(line.id))}</span></td></tr>`),`<tr><th scope="row" colspan="3">قيمة الأمر</th><td><strong>${amount(row.order.total_minor)}</strong></td><td></td><td></td></tr>`]})}<p class="subtle">محفوظ داخليًا؛ ما ينرسل خارجيًا.</p></details>` : '';
      const receipts = row.receipts.length ? `<details><summary>محاضر الاستلام (${e(row.receipts.length)})</summary><ul class="vn-list">${row.receipts.map(r=>`<li><strong><bdi>${e(r.reference)}</bdi></strong><span>${r.lines.map(line=>`${e(orderById.get(line.order_line_id)?.description??line.order_line_id)}: <span data-num>${e(line.quantity)}</span> ${e(orderById.get(line.order_line_id)?.unit??'')}`).join(' · ')}</span><small class="measure">${e(r.evidence)}</small></li>`).join('')}</ul></details>` : '';
      const invoiceTone={ready:'pending',awaiting_receipt:'pending',held:'is-due',decided:'pending',matched:'matched',rejected:'rejected',voided:'cancelled'};
      const invoices = row.invoices.length ? `<details open><summary>مراجع فواتير المورد (${e(row.invoices.length)})</summary><ul class="vn-list">${row.invoices.map(i=>{
        const matched = row.payables.find(p=>p.invoice_id===i.id);
        const similar = (i.similar||[]).length ? `<small class="is-warn-text">تنبيه: مبلغ مطابق لفاتورة ثانية من المورد نفسه (${i.similar.map(x=>`<bdi>${e(x.supplier_reference)}</bdi> في ${day(x.recorded_on)}`).join('، ')}). تحقق قبل المطابقة.</small>` : '';
        return `<li><strong><bdi>${e(i.supplier_reference)}</bdi> — ${amount(i.amount_minor)} ريال</strong><span class="badge ${i.state?invoiceTone[i.state]??'':matched?'matched':'pending'}">${e(i.state_name ?? (matched?'مطابقة وصارت مستحقًا':'تنتظر المطابقة'))}</span><span>${i.lines.map(line=>`${e(orderById.get(line.order_line_id)?.description??line.order_line_id)}: <span data-num>${e(line.quantity)}</span> ${e(orderById.get(line.order_line_id)?.unit??'')} · ${amount(line.amount_minor)}`).join(' · ')}${matched?` · ${e(matched.payment_status_name ?? '')}`:''}</span><small class="measure">${e(i.evidence)}</small>${similar}</li>`;
      }).join('')}</ul></details>` : '';
      // سجل الطلب أحداثٌ بأفعالها ووقتها وحاله بعدها؛ معرّفات الحسابات ونسخ السجل الداخلية ما تظهر.
      const history = `<details><summary>سجل الطلب (${e(row.history.length)})</summary><ul class="vn-list">${row.history.map(h=>`<li><strong>${e(labels[h.action] ?? (h.action==='created'?'إنشاء الاحتياج':h.action))}</strong><span><time datetime="${e(h.created_at)}">${e(riyadhDay(h.created_at))}</time> · ${e(statuses[h.snapshot.status] ?? h.snapshot.status)}</span></li>`).join('')}</ul></details>`;
      const guidance = row.status==='sourcing' && !awardReady(row) ? '<p class="subtle">الترسية تحتاج ثلاث عروض من موردين مختلفين، أو شراء طارئ معتمد يكفيه عرض واحد.</p>' : '';
      const commencement = commencementPanel(row,e);
      const waits = offered.length>0;
      const lead = row.order ? ['قيمة الأمر',row.order.total_minor] : ['المخصص',row.budget_minor];
      return `<details class="vn-card ${waits?'is-decision':['draft'].includes(row.status)?'is-old':['rejected','cancelled'].includes(row.status)?'is-old':''}"${waits?' open':''} data-id="${e(row.id)}"><summary><span class="vn-code">${day(row.due_date)}</span><span class="vn-name"><strong>${e(row.title)}</strong><small>${e(project?.name ?? 'مشروع')} · مركز التكلفة <bdi>${e(row.cost_center)}</bdi></small></span><span class="vn-flags"><strong>${e(lead[0])} ${amount(lead[1])} ريال</strong>${waits?'<span class="badge is-decision">ينتظرك</span>':''}${ui.statusBadge(row.status,{module:'purchase'})}</span></summary><div class="vn-body">
        ${buttons?`<div class="operation-actions">${buttons}</div>`:''}${guidance}
        <p class="measure">${e(row.specification)}</p>
        <dl class="vn-facts"><div><dt>عدد البنود</dt><dd><span data-num>${e(row.lines.length)}</span></dd></div><div><dt>موعد الحاجة</dt><dd>${day(row.due_date)}</dd></div><div><dt>المخصص المحلي</dt><dd>${amount(row.budget_minor)}</dd></div><div><dt>المراجع المسجلة</dt><dd>${amount(row.invoiced_minor)}</dd></div><div><dt>المستحق المطابق</dt><dd>${amount(row.payable_minor)} · ${e(row.payment_status_name ?? 'غير مدفوع')} · ${e(row.posting_status_name ?? 'غير مرحّل')}</dd></div><div><dt>دليل المخصص</dt><dd>${e(row.budget_evidence)}</dd></div></dl>
        ${purchaseLines}${quotes}${budget}${award}${order}${commencement}${receipts}${invoices}${exceptionPanels(row,{e,button,amount})}${history}</div></details>`;
    };
    const waiting = data.purchases.filter(row=>offeredOf(row).length>0);
    const rest = data.purchases.filter(row=>!waiting.includes(row));
    const group = (title,rows)=>rows.length?`<section class="vn-group"><h2>${e(title)} <span>${rows.length}</span></h2>${rows.map(purchaseCard).join('')}</section>`:'';
    return header + group('ينتظرك',waiting) + group('في المسودة وجمع العروض',rest.filter(r=>['draft','sourcing'].includes(r.status))) + group('أوامر قائمة',rest.filter(r=>['awarded','ordered','part_received'].includes(r.status))) + group('وصل كله',rest.filter(r=>r.status==='received')) + group('مرفوضة وملغاة',rest.filter(r=>['rejected','cancelled'].includes(r.status)));
  },
  form(action,id,data) {
    if (action==='create') return {
      title:labels.create,endpoint:'/procurement',idempotent:true,
      fields:[field('project_id','المشروع','select',{options:data.projects.map(p=>({value:p.id,label:p.name}))}),...fieldsForPurchase()],
      toPayload:values=>values
    };
    if(action==='finance_review_rfq'){
      const rfq=(data.rfq_queue??[]).find(x=>x.id===id&&x.actions?.includes(action));
      if(!rfq)throw new Error('طلب عرض السعر غير متاح للمراجعة. أعد تحميل القائمة.');
      return {title:`قرار التحقق المالي — ${rfq.rfq_number}`,endpoint:`/procurement-rfqs/${rfq.id}/review`,fields:[
        field('decision','قرار المالية','select',{options:[{value:'approved',label:'معتمد ماليًا'},{value:'changes_required',label:'يحتاج تعديلًا وإعادة رفع'},{value:'rejected',label:'مرفوض ماليًا'}]}),
        field('report_number','رقم تقرير التحقق المالي'),field('report_date','تاريخ التقرير','date',{value:riyadhToday()}),
        field('lines','مقارنة أسعار البنود','rows',{value:rfq.lines.map(line=>({rfq_line_id:line.id,rate_card_unit_price:'',result:'no_reference',note:''})),minRows:rfq.lines.length,maxRows:rfq.lines.length,columns:[
          {name:'rfq_line_id',label:'البند',type:'select',options:rfq.lines.map(line=>({value:line.id,label:`${line.line_no}. ${line.description} · عرض ${decimal(line.quote_unit_price_minor)} SAR`}))},
          {name:'rate_card_unit_price',label:'سعر البطاقة SAR',type:'text',maxLength:14},{name:'result',label:'النتيجة',type:'select',options:[{value:'within_rate',label:'ضمن السعر المرجعي'},{value:'exception',label:'استثناء يحتاج مبررًا'},{value:'no_reference',label:'لا يوجد سعر مرجعي'}]},{name:'note',label:'المبرر أو الملاحظة',type:'text',maxLength:1000}
        ]}),field('finance_notes','ملاحظات المالية وأساس القرار','textarea')],toPayload:values=>values};
    }
    // أفعال الاستثناءات على سجل داخل الطلب (فاتورة، طلب إلغاء، طلب إشعار): المعرّف معرّف السجل، والطلب يُعرف منه.
    const item=ITEM_ACTIONS.has(action)?locate(data.purchases,action,id):null;
    if (item) return itemForm(action,item);
    const row = data.purchases.find(p=>p.id===id);
    if (!row || ![...(row.allowed_actions??[]),...(row.rfq_actions??[])].includes(action)) throw new Error('الإجراء غير متاح لهذا الاحتياج. أعد تحميل القائمة.');
    const version = row.version;
    let fields;
    if (action==='edit') fields = fieldsForPurchase(row);
    if (action==='submit') fields = [];
    if (action==='add_quote') fields = [
      field('supplier_key','معرف المورد المحلي الثابت'),
      field('supplier_name','اسم المورد'),
      field('line_prices','سعر كل بند','rows',{value:row.lines.map(line=>({purchase_line_id:line.id,unit_price:''})),minRows:row.lines.length,maxRows:row.lines.length,
        columns:[{name:'purchase_line_id',label:'البند',type:'select',options:row.lines.map(line=>({value:line.id,label:`${line.line_no}. ${line.description} · ${line.quantity} ${line.unit}`}))},{name:'unit_price',label:'سعر الوحدة بالريال',type:'text',maxLength:14}]}),
      field('technical_assessment','التقييم الفني مقارنة بالمواصفات','textarea'),
      field('financial_terms','الشروط المالية للعرض','textarea'),
      field('delivery_date','موعد تسليم العرض','date',{value:row.due_date}),
      field('evidence','مرجع العرض ودليل محتواه','textarea')
    ];
    if (action==='award') fields = [
      field('quote_id','العرض المختار','select',{options:row.quotes.map(q=>({value:q.id,label:`${q.supplier_name} · ${decimal(q.total_minor)} SAR`}))}),
      note('مبرر المقارنة والاختيار وتأكيد كفاية المخصص')
    ];
    if(action==='submit_rfq')return {title:labels[action],endpoint:`/procurement-rfqs/${row.id}/submit`,fields:[
      field('quotation_on','تاريخ عرض المورد','date',{value:riyadhToday()}),field('vendor_quote_reference','رقم أو مرجع عرض المورد'),
      field('rfp_reference','مرجع RFP إن وجد','text',{required:false}),field('proposed_payment_terms','شروط الدفع المقترحة','textarea',{value:row.quotes.find(q=>q.id===row.award?.quote_id)?.financial_terms??''}),
      field('valid_until','صلاحية العرض حتى','date',{value:row.quotes.find(q=>q.id===row.award?.quote_id)?.delivery_date??row.due_date}),
      field('vat_amount','ضريبة العرض SAR','text',{value:'0.00',hint:'سجل مبلغ الضريبة كما ورد في عرض المورد. لا تحتسب الشاشة فاتورة أو ضريبة رسمية.'}),
      field('po_required','هل يحتاج أمر شراء؟','select',{options:[{value:'yes',label:'نعم، بعد التحقق المالي'},{value:'no',label:'لا، إجراء مالي مباشر'}]})],
      toPayload:values=>({...values,po_required:values.po_required==='yes',purchase_version:row.version})};
    if (action==='approve_order') fields = [field('terms','شروط الأمر الداخلي','textarea'),field('delivery_date','موعد التسليم','date',{value:row.quotes.find(q=>q.id===row.award?.quote_id)?.delivery_date ?? row.due_date}),note('دليل اعتماد نسخة الأمر الداخلي')];
    // أمر المباشرة: الاستبدال يقترح قيم الإذن القائم ليغيّر المراجع ما تغيّر، والدليل يُكتب من جديد لأن إبلاغ المورد
    // بالإذن الجديد غير إبلاغه بالقديم. آخر يوم للسريان يُقترح موعد تسليم الأمر النافذ.
    if (action==='commence'||action==='replace_commencement') {
      const live=action==='replace_commencement'?row.commencement:null;
      fields = [
        field('start_on','تاريخ بدء المورد','date',{value:live?.start_on??riyadhToday(),hint:'أي استلام من المورد قبل هالتاريخ ينرفض، والتاريخ ما يسبق يوم اعتماد أمر الشراء.'}),
        field('valid_until','آخر يوم يسري فيه الإذن','date',{value:live?.valid_until??row.order?.effective_delivery_date??row.order?.delivery_date??'',hint:'بعده ينرفض الاستلام لين ينستبدل الإذن بمدة جديدة.'}),
        field('site_or_channel','موقع التنفيذ أو قناته','text',{value:live?.site_or_channel??''}),
        field('scope_confirmation','النطاق اللي يبدأ عليه المورد','textarea',{value:live?.scope_confirmation??''}),
        field('evidence','دليل إبلاغ المورد بالإذن','textarea',{hint:'الخطاب أو البريد أو المحضر اللي انبلغ فيه المورد، ومكان حفظه.'}),
        ...(live?[field('reason','سبب الاستبدال','textarea',{hint:`يحل محل أمر المباشرة رقم ${live.sequence}، والقديم يبقى في السجل زي ما صدر.`})]:[])
      ];
    }
    if (action==='withdraw_commencement') fields = [
      field('reason','سبب سحب الإذن','textarea',{hint:'بعد السحب ينرفض أي استلام من المورد لين يصدر أمر مباشرة جديد.'}),
      field('evidence','دليل إبلاغ المورد بالتوقف','textarea')
    ];
    if (action==='receive') {
      const used=id=>row.receipts.flatMap(receipt=>receipt.lines??[]).filter(line=>line.order_line_id===id).reduce((sum,line)=>sum+line.quantity,0),available=row.order.lines.filter(line=>used(line.id)<line.quantity);
      fields = [field('lines','كميات البنود المستلمة','rows',{value:available.map(line=>({order_line_id:line.id,quantity:line.quantity-used(line.id)})),minRows:1,maxRows:available.length,
        columns:[{name:'order_line_id',label:'البند',type:'select',options:available.map(line=>({value:line.id,label:`${line.description} · ${line.unit}`}))},{name:'quantity',label:'الكمية المستلمة',type:'number',min:1,max:1000000}]}),field('reference','مرجع محضر الاستلام'),field('evidence','دليل فحص واستلام البنود','textarea')];
    }
    if (action==='record_invoice') {
      const used=id=>row.invoices.flatMap(invoice=>invoice.lines??[]).filter(line=>line.order_line_id===id).reduce((sum,line)=>sum+line.quantity,0),available=row.order.lines.filter(line=>used(line.id)<line.quantity);
      fields = [field('supplier_reference','رقم فاتورة المورد زي ما جا منه'),field('lines','بنود مرجع الفاتورة','rows',{value:available.map(line=>{const remaining=line.quantity-used(line.id);return {order_line_id:line.id,quantity:remaining,amount:decimal(remaining*line.unit_price_minor)};}),minRows:1,maxRows:available.length,
        columns:[{name:'order_line_id',label:'البند',type:'select',options:available.map(line=>({value:line.id,label:`${line.description} · ${line.unit}`}))},{name:'quantity',label:'الكمية',type:'number',min:1,max:1000000},{name:'amount',label:'القيمة بالريال',type:'text',maxLength:14}]}),field('evidence','دليل مرجع الفاتورة الصادر عن المورد','textarea')];
    }
    if (action==='match') fields = [field('invoice_id','مرجع الفاتورة للمطابقة','select',{options:invoiceOptions(row,data.user).map(i=>({value:i.id,label:`${i.supplier_reference} · ${i.quantity} ${row.unit} · ${decimal(i.amount_minor)} SAR`}))}),note('دليل مراجعة الأمر والاستلام ومرجع الفاتورة')];
    if (action==='record_return') {
      const open=row.order.lines.filter(line=>(line.net_received_quantity??0)>0);
      fields = [field('lines','البنود الراجعة للمورد','rows',{value:open.map(line=>({order_line_id:line.id,quantity:1})),minRows:1,maxRows:open.length,
        columns:[{name:'order_line_id',label:'البند',type:'select',options:open.map(line=>({value:line.id,label:`${line.description} · باقي ${line.net_received_quantity} ${line.unit}`}))},{name:'quantity',label:'الكمية الراجعة',type:'number',min:1,max:1000000}]}),
        field('reference','رقم إشعار الإرجاع أو محضره'),field('reason','سبب الإرجاع','textarea'),field('evidence','دليل الإرجاع ومحضره الموقّع','textarea',{hint:'المرتجع نهائي: ما ينستلم بدله على هالأمر، وإذا البضاعة مفوترة ينتظر إشعار المورد الدائن.'})];
      return {title:labels[action],endpoint:`/procurement/${row.id}/record_return`,fields,
        toPayload:values=>({reference:values.reference,reason:values.reason,evidence:values.evidence,lines:(values.lines??[]).map(line=>({order_line_id:line.order_line_id,quantity:Number(line.quantity)})),version})};
    }
    if (action==='reject') fields = [note('سبب رفض الاحتياج')];
    if (action==='cancel') fields = [note('سبب إلغاء الاحتياج')];
    if (!fields) throw new Error('الإجراء غير معرف');
    return {
      title:labels[action],endpoint:`/procurement/${row.id}/${action}`,fields,
      toPayload:values=>({...values,...(values.quantity!==undefined?{quantity:Number(values.quantity)}:{}),version})
    };
  }
};

// أفعال السجلات داخل الطلب: الزر يحمل معرّف السجل، والنموذج يرسل إلى مسار الطلب بنسخته المفتوحة.
const ITEM_ACTIONS=new Set(['decide_invoice','propose_void','decide_void','waive_credit','record_credit_note']);
function locate(purchases,action,id){
  for(const row of purchases??[]){
    const invoice=row.invoices?.find(i=>i.id===id);
    if(invoice&&(invoice.actions??[]).includes(action))return {row,invoice};
    const request=row.voids?.find(x=>x.id===id);
    if(request&&(request.actions??[]).includes(action))return {row,void:request};
    for(const payable of row.payables??[]){const credit=payable.credit_requests?.find(r=>r.id===id);if(credit&&(credit.actions??[]).includes(action))return {row,payable,credit};}
  }
  throw new Error('الإجراء غير متاح لك على هالسجل الحين. حدّث القائمة.');
}
export function itemForm(action,{row,invoice,void:request,payable,credit}){
  const version=row.version,endpoint=`/procurement/${row.id}/${action}`;
  if(action==='decide_invoice'){
    const v=invoice.variance;
    return {title:`${labels[action]} — ${invoice.supplier_reference}`,endpoint,fields:[
      field('decision','القرار','select',{options:[{value:'credit_note',label:'نطلب من المورد إشعار دائن بالفرق'},{value:'accept',label:'نقبل الفرق'},{value:'reject',label:'نرفض الفاتورة ويصدر المورد بديلة'}],
        hint:`فرق السعر ${signed(v?.price_variance_minor??0)} ريال، وفرق الكمية ${v?.quantity_variance??0}. القبول داخل الحد المعتمد لأي مراجع مستقل، وبرّاه يحتاج مبرر من معتمد مالي.`}),
      note('أساس القرار وما راجعته مع المورد'),
      field('override_reason','مبرر تجاوز الحد (للمعتمد المالي عند القبول خارج الحد)','textarea',{required:false})],
      toPayload:values=>({invoice_id:invoice.id,decision:values.decision,note:values.note,...(values.override_reason?{override_reason:values.override_reason}:{}),version})};
  }
  if(action==='propose_void')return {title:`${labels[action]} — ${invoice.supplier_reference}`,endpoint,fields:[
    field('reason','سبب الإلغاء','textarea',{hint:'الإلغاء يقرّه معتمد مستقل، وينرفض إذا كان على المستحق دفع في الطريق أو دفع منفّذ.'}),field('evidence','دليل الإلغاء ومرجعه (خطاب المورد أو محضر)','textarea')],
    toPayload:values=>({invoice_id:invoice.id,reason:values.reason,evidence:values.evidence,version})};
  if(action==='decide_void')return {title:labels[action],endpoint,fields:[
    field('decision','القرار','select',{options:[{value:'approve',label:'نعتمد الإلغاء'},{value:'reject',label:'نرفض طلب الإلغاء'}]}),note('أساس القرار')],
    toPayload:values=>({void_id:request.id,decision:values.decision,note:values.note,version})};
  if(action==='waive_credit')return {title:labels[action],endpoint,fields:[field('reason','مبرر التنازل (المورد رفض الإشعار والفرق مقبول بعد التفاوض)','textarea')],
    toPayload:values=>({request_id:credit.id,reason:values.reason,version})};
  if(action==='record_credit_note')return {title:labels[action],endpoint:`/procurement/${row.id}/supplier-notes`,idempotent:true,fields:[
    field('amount','مبلغ الإشعار بالريال','text',{value:decimal(credit.open_minor),inputmode:'decimal'}),field('vat','منها ضريبة القيمة المضافة','text',{required:false,inputmode:'decimal'}),
    field('reference','رقم الإشعار عند المورد'),field('reason','سبب الإشعار','textarea'),field('evidence','مرجع الإشعار ومكان حفظه','textarea',{hint:'يعتمده زميل مالي ثاني في «مدفوعات الموردين»، وبعد اعتماده ينفك الحجز عن الدفع.'})],
    toPayload:values=>({payable_id:payable.id,request_id:credit.id,kind:'credit',amount:values.amount,...(values.vat?{vat:values.vat}:{}),reference:values.reference,reason:values.reason,evidence:values.evidence})};
  throw new Error('الإجراء غير معرف');
}
