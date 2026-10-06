// قراءات صغيرة تحتاجها المشتريات من سجلات الاستكمال، بلا استيراد متبادل بين الوحدتين.
export const approvedEmergency=(db,purchaseId)=>db.prepare("SELECT * FROM procurement_emergencies WHERE purchase_id=? AND status='approved'").get(purchaseId)??null;
export const closedShort=(db,purchaseId)=>!!db.prepare("SELECT 1 FROM procurement_order_changes WHERE purchase_id=? AND kind='close_short' AND status='approved'").get(purchaseId);
// إفصاح قائم أو قرار تنحٍّ يمنع صاحبه من القرار على هذا المورد. «مُدار بشروط» لا يمنع لكنه يظهر للمراجع.
export function conflictBlock(db,tenantId,userId,supplierKey){
  return db.prepare("SELECT d.status FROM vendor_conflict_disclosures d JOIN vendors x ON x.id=d.vendor_id WHERE d.tenant_id=? AND d.user_id=? AND x.supplier_key=? AND d.status IN ('disclosed','recused')").get(tenantId,userId,supplierKey)?.status??null;
}
// نسخة أمر الشراء: الأمر نفسه لا يُعدَّل (الترحيل 005)، وكل تعديل معتمد عليه (الترحيل 039) نسخةٌ جديدة منه.
// أمر المباشرة يُربط بهذا الرقم (الترحيل 162)، فإن تعدّل الأمر بعده لم يعد الإذن القديم يكفي للاستلام.
// العدّ نفسه في مُطلِقات الترحيل 162، فلا يختلف الكود والقاعدة على رقم النسخة.
export const orderVersion=(db,orderId)=>1+db.prepare("SELECT COUNT(*) AS n FROM procurement_order_changes WHERE order_id=? AND status='approved'").get(orderId).n;
export function effectiveOrder(db,order){
  if(!order)return null;
  const changes=db.prepare("SELECT * FROM procurement_order_changes WHERE order_id=? AND status='approved' ORDER BY decided_at").all(order.id);
  const last=kind=>changes.filter(c=>c.kind===kind).at(-1);
  return {...order,effective_delivery_date:last('delivery_date')?.new_delivery_date??order.delivery_date,effective_terms:last('terms')?.new_terms??order.terms,closed_short:changes.some(c=>c.kind==='close_short'),approved_changes:changes.length,order_version:changes.length+1};
}

/* ───── الترحيل 169: الحي والصافي والفرق والحجز والالتزام — قراءات بلا كتابة ───── */
// التعاريف نفسها في قوادح app/migrations/169-procurement-exceptions.sql، فلا تفترق الشاشة والقاعدة على «حي» أو «صافٍ»:
//   الفاتورة الحية: ما رُفضت بقرار وما أُلغيت بقرار معتمد. المستلم الصافي: الاستلام − المرتجع (والمرتجع نهائي لا يُعاد استلامه).
//   المطابَق الصافي: كميات المستحقات غير الملغاة − كميات طلبات الإشعار الدائن عليها.
//   الممكن تسليمه: الكمية المأمورة − المرتجع، أو المستلم الصافي متى أُقفل الأمر على المستلم.
// والملف بلا استيراد عمدًا: تقرؤه المشتريات والمخصصات والاستثناءات كلها بلا دورة استيراد.
const count=(db,sql,...args)=>db.prepare(sql).get(...args).n;
// الترقية: اختبارات الترحيلات (162 و166) تمشي كود المشتريات على قاعدة أُوقفت عمدًا قبل ترحيل لاحق. فالقراءات هنا تسأل القاعدة عما
// فيها — مرة لكل نسخة مخطط (PRAGMA schema_version) — وتعدّ الغائب فارغًا: لا مرتجع ولا قرار ولا إلغاء قبل 169، والرصيد قبل 166 من أوامر
// الدفع كما كان. في التشغيل تُطبَّق الترحيلات كلها قبل أول طلب (openDb في app/db.mjs)، فلا يُسلك هذا الفرع إلا على قاعدة موقوفة.
const SCHEMA=new WeakMap();
export function schemaOf(db){
  const version=db.prepare('PRAGMA schema_version').get().schema_version,cached=SCHEMA.get(db);
  if(cached?.version===version)return cached;
  const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(r=>r.name));
  const found={version,exceptions:names.has('procurement_voids'),balances:names.has('payable_balances'),lines:names.has('payment_order_lines'),adjustments:names.has('payable_adjustments')};
  SCHEMA.set(db,found);
  return found;
}
const REJECTED=a=>`EXISTS(SELECT 1 FROM procurement_invoice_decisions dx WHERE dx.invoice_id=${a}.id AND dx.decision='reject')`;
const VOIDED_INVOICE=a=>`EXISTS(SELECT 1 FROM procurement_voids vx JOIN procurement_void_decisions vdx ON vdx.void_id=vx.id WHERE vx.invoice_id=${a}.id AND vdx.decision='approved')`;
export const voidedPayableSql=(db,a)=>schemaOf(db).exceptions?`EXISTS(SELECT 1 FROM procurement_voids vy JOIN procurement_void_decisions vdy ON vdy.void_id=vy.id WHERE vy.payable_id=${a}.id AND vdy.decision='approved')`:'0';
export const liveInvoiceSql=(db,a)=>schemaOf(db).exceptions?`NOT ${REJECTED(a)} AND NOT ${VOIDED_INVOICE(a)}`:'1';
export function invoiceLife(db,invoiceId){
  if(!schemaOf(db).exceptions)return 'live';
  if(db.prepare(`SELECT 1 FROM procurement_invoices i WHERE i.id=? AND ${REJECTED('i')}`).get(invoiceId))return 'rejected';
  if(db.prepare(`SELECT 1 FROM procurement_invoices i WHERE i.id=? AND ${VOIDED_INVOICE('i')}`).get(invoiceId))return 'voided';
  return 'live';
}
export const payableVoided=(db,payableId)=>!!db.prepare(`SELECT 1 FROM procurement_payables x WHERE x.id=? AND ${voidedPayableSql(db,'x')}`).get(payableId);
export const payableOfInvoice=(db,invoiceId)=>db.prepare('SELECT * FROM procurement_payables WHERE invoice_id=?').get(invoiceId)??null;

export function lineFacts(db,orderLine,closed=null){
  const id=orderLine.id,exceptions=schemaOf(db).exceptions;
  const received=count(db,'SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_receipt_lines WHERE order_line_id=?',id);
  const returned=exceptions?count(db,'SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_return_lines WHERE order_line_id=?',id):0;
  const matched=count(db,`SELECT COALESCE(SUM(pl.quantity),0) AS n FROM procurement_payable_lines pl JOIN procurement_payables x ON x.id=pl.payable_id WHERE pl.order_line_id=? AND NOT ${voidedPayableSql(db,'x')}`,id);
  const credited=exceptions?count(db,`SELECT COALESCE(SUM(cl.quantity),0) AS n FROM procurement_credit_request_lines cl JOIN procurement_credit_requests cr ON cr.id=cl.request_id JOIN procurement_payables x ON x.id=cr.payable_id WHERE cl.order_line_id=? AND NOT ${voidedPayableSql(db,'x')}`,id):0;
  const invoiced=count(db,`SELECT COALESCE(SUM(il.quantity),0) AS n FROM procurement_invoice_lines il JOIN procurement_invoices i ON i.id=il.invoice_id WHERE il.order_line_id=? AND ${liveInvoiceSql(db,'i')}`,id);
  const isClosed=closed??closedShort(db,orderLine.purchase_id),net=received-returned;
  return {ordered:orderLine.quantity,received,returned,net_received:net,matched,credited,matched_net:matched-credited,invoiced,
    deliverable:isClosed?net:orderLine.quantity-returned,closed:isClosed};
}

// فرق الفاتورة لكل بند، محسوبًا الآن من الوقائع لا مخزّنًا: فرق السعر ثابت (الفاتورة والأمر لا يُعدَّلان)، وفرق الكمية
// يتحرك مع المرتجع والإقفال والإلغاء. فرق الكمية = ما تفوتره الفاتورة فوق ما يبقى ممكن التسليم بعد المطابَق وبعد الفواتير
// الحية غير المطابقة التي سبقتها (الأسبق يأخذ أولًا). والفاتورة التي تسبق البضاعة ليست فرقًا: هي «تنتظر الاستلام».
export function invoiceVariance(db,invoice){
  const closed=closedShort(db,invoice.purchase_id);
  const rows=db.prepare('SELECT il.*,ol.unit_price_minor,ol.line_no,ol.description,ol.quantity AS ordered_quantity,ol.purchase_id AS order_purchase_id FROM procurement_invoice_lines il JOIN procurement_order_lines ol ON ol.id=il.order_line_id WHERE il.invoice_id=? ORDER BY ol.line_no,il.id').all(invoice.id);
  const earlier=db.prepare(`SELECT COALESCE(SUM(il.quantity),0) AS n FROM procurement_invoice_lines il JOIN procurement_invoices i ON i.id=il.invoice_id
    WHERE il.order_line_id=? AND i.id<>? AND ${liveInvoiceSql(db,'i')} AND NOT EXISTS(SELECT 1 FROM procurement_payables x WHERE x.invoice_id=i.id)
      AND i.rowid<(SELECT rowid FROM procurement_invoices WHERE id=?)`);
  const lines=rows.map(il=>{
    const facts=lineFacts(db,{id:il.order_line_id,quantity:il.ordered_quantity,purchase_id:il.order_purchase_id},closed);
    const room=facts.deliverable-facts.matched_net-earlier.get(il.order_line_id,invoice.id,invoice.id).n;
    const quantityVariance=il.quantity-Math.min(il.quantity,Math.max(0,room)),accepted=il.quantity-quantityVariance,price=il.unit_price_minor;
    return {invoice_line_id:il.id,order_line_id:il.order_line_id,line_no:il.line_no,description:il.description,quantity:il.quantity,amount_minor:il.amount_minor,
      unit_price_minor:price,order_value_minor:il.quantity*price,price_variance_minor:il.amount_minor-il.quantity*price,quantity_variance:quantityVariance,accepted_quantity:accepted,
      expected_credit_minor:Math.max(0,il.amount_minor-accepted*price),favorable_minor:Math.max(0,accepted*price-il.amount_minor),
      awaiting_quantity:Math.max(0,accepted-Math.max(0,facts.net_received-facts.matched_net))};
  });
  const sum=key=>lines.reduce((total,line)=>total+line[key],0);
  return {lines,price_variance_minor:sum('price_variance_minor'),quantity_variance:sum('quantity_variance'),expected_credit_minor:sum('expected_credit_minor'),
    favorable_minor:sum('favorable_minor'),deviation_minor:sum('expected_credit_minor')+sum('favorable_minor'),order_value_minor:sum('order_value_minor'),
    has_variance:lines.some(line=>line.price_variance_minor!==0||line.quantity_variance>0)};
}
export function invoiceDecisions(db,invoiceId){
  if(!schemaOf(db).exceptions)return [];
  const lines=db.prepare('SELECT * FROM procurement_invoice_decision_lines WHERE decision_id=?');
  return db.prepare('SELECT * FROM procurement_invoice_decisions WHERE invoice_id=? ORDER BY sequence').all(invoiceId)
    .map(d=>({...d,tolerance:JSON.parse(d.tolerance_json),lines:lines.all(d.id)}));
}
// القرار يغطي الفرق الذي رآه وحده: فرق السعر نفسه لكل بند، وفرق كمية لا يزيد على ما رآه. فرقٌ أكبر بعده (مرتجع، إقفال) يعيد الإيقاف.
export function decisionCovers(variance,decision){
  if(!decision||!['accept','credit_note'].includes(decision.decision))return false;
  return variance.lines.every(line=>{const seen=decision.lines.find(d=>d.invoice_line_id===line.invoice_line_id);
    return !!seen&&seen.price_variance_minor===line.price_variance_minor&&line.quantity_variance<=seen.quantity_variance;});
}
// حالة الفاتورة: rejected · voided · matched · held (فرق بلا قرار يغطيه) · awaiting_receipt (ما قُبل منها لم يصل) · decided · ready.
export function invoiceState(db,invoice){
  const decisions=invoiceDecisions(db,invoice.id),decision=decisions.at(-1)??null,life=invoiceLife(db,invoice.id);
  if(life!=='live')return {state:life,live:false,matchable:false,variance:null,decision,decisions,covered:false};
  const payable=payableOfInvoice(db,invoice.id);
  if(payable)return {state:'matched',live:true,matchable:false,variance:null,decision,decisions,covered:false,payable_id:payable.id};
  const variance=invoiceVariance(db,invoice),covered=variance.has_variance&&decisionCovers(variance,decision);
  const held=variance.has_variance&&!covered,awaiting=variance.lines.some(line=>line.awaiting_quantity>0);
  return {state:held?'held':awaiting?'awaiting_receipt':covered?'decided':'ready',live:true,matchable:!held&&!awaiting,variance,decision,decisions,covered};
}

// طلبات الإشعار الدائن على مستحق: ما أجابه إشعار معتمد، وما ينتظر قراره، والمتبقي المحجوز عن الدفع ما لم يُتنازل عنه.
export function creditRequests(db,payableId){
  if(!schemaOf(db).exceptions)return [];
  // المستحق الملغى لا يُنتظر عليه إشعار: الإلغاء سوّاه كله، فطلباته مقفلة بلا محجوز.
  const voided=payableVoided(db,payableId);
  const linked=status=>db.prepare(`SELECT COALESCE(SUM(amount_minor),0) AS n FROM payable_adjustments WHERE source_kind='procurement_credit' AND source_id=? AND status='${status}'`);
  const approved=linked('approved'),pending=linked('pending');
  const lines=db.prepare('SELECT order_line_id,quantity,amount_minor FROM procurement_credit_request_lines WHERE request_id=? ORDER BY order_line_id');
  return db.prepare('SELECT r.*,w.reason AS waiver_reason,w.waived_by,w.created_at AS waived_at FROM procurement_credit_requests r LEFT JOIN procurement_credit_waivers w ON w.request_id=r.id WHERE r.payable_id=? ORDER BY r.created_at,r.rowid').all(payableId)
    .map(r=>{const credited=approved.get(r.id).n,awaiting=pending.get(r.id).n,waived=!!r.waived_by;
      return {...r,lines:lines.all(r.id),credited_minor:credited,pending_minor:awaiting,waived,payable_voided:voided,
        outstanding_minor:waived||voided?0:Math.max(0,r.amount_minor-credited),open_minor:voided?0:Math.max(0,r.amount_minor-credited-awaiting)};});
}
// الرصيد من payable_balances (الترحيل 166)؛ وقبله من أوامر الدفع بمستحقها كما كان — أمر واحد بكامل المستحق.
export function balanceOf(db,payableId){
  if(schemaOf(db).balances)return db.prepare('SELECT * FROM payable_balances WHERE payable_id=?').get(payableId)??null;
  const payable=db.prepare('SELECT amount_minor FROM procurement_payables WHERE id=?').get(payableId);
  if(!payable)return null;
  const sum=status=>count(db,'SELECT COALESCE(SUM(amount_minor),0) AS n FROM payment_orders WHERE payable_id=? AND status=?',payableId,status);
  const paid=sum('executed'),pending=sum('pending'),approved=sum('approved');
  return {payable_id:payableId,amount_minor:payable.amount_minor,debit_minor:0,credit_minor:0,adjusted_minor:payable.amount_minor,paid_minor:paid,returned_minor:0,pending_minor:pending,approved_minor:approved,
    in_flight_minor:pending+approved,outstanding_minor:payable.amount_minor-paid,available_minor:payable.amount_minor-paid-pending-approved};
}
export const voidPending=(db,payableId)=>schemaOf(db).exceptions&&!!db.prepare('SELECT 1 FROM procurement_voids v WHERE v.payable_id=? AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id)').get(payableId);
// المحجوز عن الدفع: ما لم يُجِبه إشعار معتمد من طلبات لم يُتنازل عنها. وما يُدفع الآن: المتاح ناقص المحجوز، وصفر ما دام طلب إلغاء معلّقًا.
// الحساب نفسه في القادح payment_order_lines_procurement_hold.
export function paymentHold(db,payableId){
  const withheld=creditRequests(db,payableId).reduce((total,r)=>total+r.outstanding_minor,0),balance=balanceOf(db,payableId);
  const pendingVoid=voidPending(db,payableId);
  return {withheld_minor:withheld,void_pending:pendingVoid,payable_now_minor:pendingVoid||!balance?0:Math.max(0,balance.available_minor-withheld)};
}

// الالتزام لطلب أمره معتمد: الملتزم به = ما يُنتظر أن يصير التزامًا بسعر الأمر (الممكن تسليمه − المطابَق الصافي)، والمستهلك =
// المستحقات بعد إشعاراتها وإلغاءاتها (payable_balances.adjusted_minor)، والمتحرر = ما لن يصل ولن يُفوتر (المأمور − الملتزم به −
// المطابَق الصافي بسعر الأمر). الإقفال على المستلم يحرر، والمرتجع النهائي يحرر، والإلغاء يعيد المستهلك إلى الملتزم به ما دام الأمر
// ينتظر فاتورة ذلك، ويحرره حين لا ينتظرها.
export function purchaseCommitment(db,purchaseId){
  const closed=closedShort(db,purchaseId);
  let ordered=0,committed=0,matchedValue=0;
  for(const line of db.prepare('SELECT * FROM procurement_order_lines WHERE purchase_id=? ORDER BY line_no').all(purchaseId)){
    const facts=lineFacts(db,line,closed);
    ordered+=line.total_minor;
    committed+=Math.max(0,facts.deliverable-facts.matched_net)*line.unit_price_minor;
    matchedValue+=Math.min(line.quantity,Math.max(0,facts.matched_net))*line.unit_price_minor;
  }
  const consumed=schemaOf(db).balances?count(db,'SELECT COALESCE(SUM(b.adjusted_minor),0) AS n FROM payable_balances b JOIN procurement_payables x ON x.id=b.payable_id WHERE x.purchase_id=?',purchaseId)
    :db.prepare('SELECT id FROM procurement_payables WHERE purchase_id=?').all(purchaseId).reduce((total,x)=>total+balanceOf(db,x.id).adjusted_minor,0);
  return {ordered_minor:ordered,committed_minor:committed,consumed_minor:consumed,matched_value_minor:matchedValue,released_minor:Math.max(0,ordered-committed-matchedValue)};
}

// أفعال الاستثناءات على كل سجل بحسب من يراه، تُكتب في حالة الطلب نفسها (actions) فتقرؤها الشاشة وصندوق «أقرّر». القواعد نفسها
// يعيد app/procurement-exceptions.mjs فحصها لحظة التنفيذ برفضٍ مسمّى — هنا لتُعرض الأزرار الصحيحة وحدها.
//   قرار الفاتورة الموقوفة: مستقل (لا مسجّلها ولا صاحب الطلب ولا مسجّل استلام)، مراجعًا في النطاق أو معتمدًا ماليًا.
//   طلب الإلغاء: لفاتورة غير مطابقة من في النطاق أو معدّ مالي؛ ولمستحق معدٌّ مالي وبلا دفع ولا إشعار معلّق.
//   قرار الإلغاء: لا طالبه ولا مسجّل الفاتورة ولا من طابقها؛ ولمستحق معتمدٌ مالي.
//   الإشعار الدائن يسجّله معدٌّ مالي، والتنازل معتمدٌ مالي غير منشئ الطلب.
export function itemActions(u,perms,state,{scoped}){
  const approve=perms.includes('approve'),prepare=perms.includes('prepare');
  const reviewer=scoped&&state.requester_id!==u.id&&['manager','pm'].includes(u.role);
  const receivers=new Set(state.receipts.map(r=>r.received_by)),payableOf=invoiceId=>state.payables.find(x=>x.invoice_id===invoiceId);
  for(const invoice of state.invoices){
    const actions=[],independent=u.id!==invoice.recorded_by&&u.id!==state.requester_id&&!receivers.has(u.id);
    if(invoice.state==='held'&&independent&&(reviewer||approve))actions.push('decide_invoice');
    if(invoice.live&&!state.voids.some(v=>v.invoice_id===invoice.id&&v.state!=='rejected')){
      const payable=payableOf(invoice.id);
      if(!payable){if(scoped||prepare)actions.push('propose_void');}
      else if(prepare&&payable.paid_minor===0&&payable.in_flight_minor===0&&!payable.pending_adjustments)actions.push('propose_void');
    }
    invoice.actions=actions;
  }
  for(const request of state.voids){
    const invoice=state.invoices.find(i=>i.id===request.invoice_id),payable=request.payable_id?state.payables.find(x=>x.id===request.payable_id):null;
    const independent=![request.requested_by,invoice?.recorded_by,payable?.matched_by].includes(u.id);
    request.actions=request.state==='pending'&&independent&&(request.payable_id?approve:(reviewer||approve))?['decide_void']:[];
  }
  for(const payable of state.payables)for(const request of payable.credit_requests){
    const actions=[];
    if(request.open_minor>0&&!request.waived&&prepare&&!payable.voided&&payable.available_minor>0)actions.push('record_credit_note');
    if(request.outstanding_minor>0&&approve&&u.id!==request.created_by)actions.push('waive_credit');
    request.actions=actions;
  }
  return state;
}
