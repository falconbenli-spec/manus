// استثناءات المشتريات (الحزمة 3، الترحيل 169): المرتجع، وقرار الفاتورة الموقوفة، وإلغاء الفاتورة أو المستحق، والتنازل عن إشعار
// منتظر، وإشعارات المورد الدائنة والمدينة عبر واجهة المدفوعات — ونوع الدفتر payable_adjustment الذي يقيّد كل تسوية على مستحق.
//
// لماذا وحدة مستقلة: الإشعار يمرّ بواجهة المدفوعات (recordAdjustment في app/payables.mjs)، والمدفوعات تستورد app/procurement.mjs.
// فلو عاش هذا في المشتريات لدارت الاستيرادات. المشتريات تصدّر ما يلزم هنا (purchaseActor وadvancePurchase…) ولا تستورد هذه الوحدة،
// والقراءات المشتركة (الحي، والصافي، والفرق، والحجز) في app/procurement-guards.mjs بلا استيراد، يقرؤها الطرفان والقاعدة بالتعريف نفسه.
//
// الوصول: من في نطاق الطلب (app/procurement.mjs) أو حامل تفويض مالي في الكيان — المعتمد المالي يقرر الفروق والإلغاءات ولو لم يكن
// عضوًا في المشروع، كما يعتمد أوامر الدفع. وكل قاعدة هنا لها قادحها في الترحيل 169، فالإدخال المباشر لا يتخطاها.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { financeCapabilities } from './finance.mjs';
import { vendorGate } from './vendors.mjs';
import { purchaseActor, canSee, normalizeReference, wholeQuantity, orderLinesOf, advancePurchase, purchaseView, varianceTolerance, withinTolerance, riyals, VARIANCE_TOLERANCE } from './procurement.mjs';
import { lineFacts, invoiceLife, invoiceState, payableOfInvoice, payableVoided, creditRequests, balanceOf } from './procurement-guards.mjs';
import { commitmentOf, recordCommitmentMovement } from './budgets.mjs';
import { recordAdjustment } from './payables.mjs';
import { spreadMinor } from './ledger.mjs';
import { registerSourceKind, registerSourceLink } from './ledger-sources.mjs';
import { centerKey } from './cost-centres.mjs';

const OWNERS={
  reviewer:{owner:'مراجع مستقل في المشروع — مدير الفريق أو مدير المشروع',owner_role:'manager'},
  finance_approver:{owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'},
  finance_preparer:{owner:'المالية — من يحمل تفويض الإعداد',owner_role:'finance'},
  tax:{owner:'المختص الضريبي — المالية',owner_role:'finance'}
};
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة استثناءات المشتريات تبي معاملة قاعدة بيانات');}
const blank=value=>value===undefined||value===null||value==='';
const notFound=()=>fail(404,'not_found','ما لقينا طلب الشراء هذا في نطاقك');

/* ───── الإجراءات: مدخل واحد، ونسخة الطلب تتقدم مع كل واحد ───── */
const FIELDS={record_return:['reference','reason','evidence','lines','quantity'],decide_invoice:['invoice_id','decision','note','override_reason'],
  propose_void:['invoice_id','reason','evidence'],decide_void:['void_id','decision','note'],waive_credit:['request_id','reason']};
export function exceptionAction(db,supplied,purchaseId,action,input){
  writing(db);
  const u=purchaseActor(db,supplied);
  const p=typeof purchaseId==='string'?db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(purchaseId,u.tenant_id):null;
  if(!p)notFound();
  const scoped=canSee(db,u,p),perms=financeCapabilities(db,u);
  if(!scoped&&!perms.length)notFound();
  if(!Object.hasOwn(FIELDS,action))refuse(400,'invalid_action',{what:`«${action}» ليس من إجراءات استثناءات المشتريات`,next:`الإجراءات: ${Object.keys(FIELDS).join('، ')}`});
  v.object(input,['version',...FIELDS[action]]);
  v.version(input.version,p.version);
  const context={scoped,perms,reviewer:scoped&&p.requester_id!==u.id&&['manager','pm'].includes(u.role),nextVersion:p.version+1};
  const note=({record_return:recordReturn,decide_invoice:decideInvoice,propose_void:proposeVoid,decide_void:decideVoid,waive_credit:waiveCredit})[action](db,u,p,input,context);
  advancePurchase(db,u,p,action,note);
  return purchaseView(db,u,p.id);
}

/* ───── المرتجع ───── */
// على بنود الاستلام، بسببه ودليله، يسجّله من في النطاق غير صاحب الطلب. المرتجع نهائي: ينقص المستلم الصافي، فينقص ما يُطابَق،
// ويوقف فاتورة غير مطابقة فوترت البضاعة الراجعة (فرق كمية يُقرَّر)، ويطلب إشعارًا دائنًا على مستحق قائم صار أكبر من المستلم الصافي.
function returnRows(input,order){
  if(input.lines===undefined&&order.length===1)return [{line:order[0],quantity:wholeQuantity(input.quantity)}];
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>order.length)
    refuse(400,'invalid_return_lines',{what:'بنود المرتجع لازم تكون من بند واحد إلى عدد بنود الأمر',next:'اختر كل بند راجع مرة واحدة بكميته'});
  const byId=new Map(order.map(line=>[line.id,line])),seen=new Set();
  return input.lines.map(row=>{
    v.object(row,['order_line_id','quantity']);
    const line=typeof row.order_line_id==='string'&&byId.get(row.order_line_id);
    if(!line||seen.has(line.id))refuse(400,'invalid_return_lines',{what:'في بنود المرتجع بند مكرر أو مو من بنود هذا الأمر',next:'اختر بنود الأمر نفسه، كل بند مرة'});
    seen.add(line.id);
    return {line,quantity:wholeQuantity(row.quantity)};
  });
}
function recordReturn(db,u,p,input,{scoped,nextVersion}){
  if(!scoped)notFound();
  if(p.requester_id===u.id)refuse(403,'separation_of_duties',{what:'صاحب الطلب ما يسجّل مرتجعًا على طلبه',
    missing:[{document:'تسجيل المرتجع من غير صاحب الطلب',why:'المرتجع ينقص ما يُطابَق ويطلب إشعارًا من المورد، فيثبته غير اللي طلب الشراء',...OWNERS.reviewer}],
    next:'اطلب من مراجع الطلب أو من استلم البضاعة يسجّل المرتجع بمحضره'});
  if(!['part_received','received'].includes(p.status))refuse(409,'nothing_received',{what:'ما وصل من هذا الأمر شيء يرجع',next:'سجّل الاستلام أولًا، والمرتجع يكون على ما استُلم'});
  const reference=normalizeReference(input.reference,'رقم إشعار الإرجاع أو محضره');
  if(db.prepare('SELECT 1 FROM procurement_returns WHERE purchase_id=? AND reference=?').get(p.id,reference))
    refuse(409,'duplicate_return',{what:`المرتجع ${reference} مسجّل على هذا الطلب من قبل`,next:'راجع المرتجعات المسجّلة قبل ما تضيف غيرها'});
  const reason=v.text(input.reason,'سبب الإرجاع',3000,10),evidence=v.text(input.evidence,'دليل الإرجاع ومحضره',3000,10);
  const rows=returnRows(input,orderLinesOf(db,p.id)),facts=new Map();
  for(const row of rows){
    const f=lineFacts(db,row.line);facts.set(row.line.id,f);
    if(row.quantity>f.net_received)refuse(409,'return_exceeds_received',{what:`ما يرجع من «${row.line.description}» ${row.quantity} والباقي من المستلم ${f.net_received}`,
      next:'سجّل المرتجع بكمية لا تتجاوز ما استُلم ولم يرجع'});
  }
  const before=commitmentOf(db,p.id),returnId=randomUUID(),time=now(),total=rows.reduce((n,row)=>n+row.quantity,0);
  db.prepare('INSERT INTO procurement_returns(id,tenant_id,purchase_id,reference,quantity,reason,evidence,recorded_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(returnId,p.tenant_id,p.id,reference,total,reason,evidence,u.id,nextVersion,time);
  const insert=db.prepare('INSERT INTO procurement_return_lines(id,return_id,purchase_id,order_line_id,quantity,created_at) VALUES(?,?,?,?,?,?)');
  for(const row of rows)insert.run(randomUUID(),returnId,p.id,row.line.id,row.quantity,time);
  // الإشعار الدائن على المستحقات القائمة: ما زاد بهذا المرتجع من «المطابَق الصافي فوق المستلم الصافي» — الأحدث أولًا.
  const requests=new Map();
  for(const row of rows){
    const f=facts.get(row.line.id),delta=Math.max(0,f.matched_net-(f.net_received-row.quantity))-Math.max(0,f.matched_net-f.net_received);
    let left=delta;
    for(const pl of left>0?db.prepare(`SELECT pl.*,x.created_at AS payable_created_at FROM procurement_payable_lines pl JOIN procurement_payables x ON x.id=pl.payable_id
        WHERE pl.order_line_id=? AND NOT EXISTS(SELECT 1 FROM procurement_voids v JOIN procurement_void_decisions d ON d.void_id=v.id WHERE v.payable_id=x.id AND d.decision='approved')
        ORDER BY x.created_at DESC,x.rowid DESC`).all(row.line.id):[]){
      if(left<=0)break;
      const asked=db.prepare('SELECT COALESCE(SUM(l.quantity),0) AS n FROM procurement_credit_request_lines l JOIN procurement_credit_requests r ON r.id=l.request_id WHERE r.payable_id=? AND l.order_line_id=?').get(pl.payable_id,row.line.id).n;
      const take=Math.min(left,pl.quantity-asked);
      if(take<=0)continue;
      const amount=Number((BigInt(pl.amount_minor)*BigInt(take)*2n+BigInt(pl.quantity))/(2n*BigInt(pl.quantity)));
      const entry=requests.get(pl.payable_id)??{amount:0,lines:[]};entry.amount+=amount;entry.lines.push({order_line_id:row.line.id,quantity:take,amount});requests.set(pl.payable_id,entry);
      left-=take;
    }
  }
  for(const [payableId,entry] of requests){
    const requestId=randomUUID();
    db.prepare("INSERT INTO procurement_credit_requests(id,tenant_id,purchase_id,payable_id,source,source_id,amount_minor,created_by,created_at) VALUES(?,?,?,?,'return',?,?,?,?)")
      .run(requestId,p.tenant_id,p.id,payableId,returnId,entry.amount,u.id,time);
    for(const line of entry.lines)db.prepare('INSERT INTO procurement_credit_request_lines(request_id,order_line_id,quantity,amount_minor) VALUES(?,?,?,?)').run(requestId,line.order_line_id,line.quantity,line.amount);
  }
  recordCommitmentMovement(db,u,p,'return_purchase',before);
  const asked=[...requests.values()].reduce((n,entry)=>n+entry.amount,0);
  return `مرتجع ${reference}: ${total} وحدة${asked?` — يُنتظر إشعار دائن من المورد بـ${riyals(asked)} ريال على المستحق القائم`:''}`;
}

/* ───── قرار الفاتورة الموقوفة ───── */
// معتمد مستقل: لا مسجّل الفاتورة ولا صاحب الطلب ولا من سجّل استلامًا عليه، ومراجعٌ في النطاق أو معتمدٌ مالي. ثلاثة قرارات:
//   accept      — ضمن حد معتمد (بلا فرق كمية)، أو بمبرر مكتوب من معتمد مالي. المستحق بمبلغ الفاتورة، والفرق يُصرف من المخصص.
//   credit_note — الفرق فوق سعر الأمر يرجع بإشعار دائن: المستحق بمبلغ الفاتورة، والفرق طلبٌ محجوز عن الدفع حتى يصل الإشعار.
//   reject      — الفاتورة تموت وتتحرر كمياتها لفاتورة بديلة.
// لا قبول آلي أبدًا، ولو اعتُمد حد: الحد يسمح لمعتمد مستقل أن يقبل بلا مبرر مالي، ولا يقبل عنه.
const DECISIONS=['accept','credit_note','reject'];
const toleranceMissing=tolerance=>({document:`قرار «${tolerance.decision.label}» (${VARIANCE_TOLERANCE})`,
  why:'ما فيه حد معتمد للفرق، فالمنصة ما تقبل فرقًا إلا بمبرر مكتوب من معتمد مالي',owner:tolerance.decision.owner,owner_role:tolerance.decision.owner_role});
function taxGuard(db,invoice,verb){
  const tax=db.prepare("SELECT * FROM procurement_invoice_tax WHERE invoice_id=? AND status<>'rejected'").get(invoice.id);
  if(!tax)return;
  refuse(409,'input_tax_live',{what:`${verb} الفاتورة ${invoice.supplier_reference} ما يمشي وسجلها الضريبي ${tax.status==='pending'?'معلّق':'متحقَّق منه'}`,
    missing:[tax.status==='pending'
      ?{document:'رفض السجل الضريبي المعلّق من معتمد مالي',why:'السجل الضريبي لفاتورة ما تصير مستحقًا يبقى معلّقًا بلا فاتورة حية',...OWNERS.finance_approver}
      :{document:'عكس السجل الضريبي المتحقَّق منه — ما له مسار في المنصة للحين',why:'ضريبة المدخلات المتحقَّق منها دخلت الملخص الضريبي، وموت الفاتورة بدونها يترك ضريبة على فاتورة ميتة',...OWNERS.tax}],
    next:tax.status==='pending'?'يرفض المعتمد المالي السجل الضريبي في «مدفوعات الموردين»، ثم أعد الطلب':'ارفع الحالة للمختص الضريبي: قراره في عكس الضريبة يسبق موت الفاتورة'});
}
function decideInvoice(db,u,p,input,{reviewer,perms,nextVersion}){
  const invoice=typeof input.invoice_id==='string'?db.prepare('SELECT * FROM procurement_invoices WHERE id=? AND purchase_id=?').get(input.invoice_id,p.id):null;
  if(!invoice)fail(400,'invalid_invoice','مرجع الفاتورة مو تابع لطلب الشراء هذا');
  if(!DECISIONS.includes(input.decision))refuse(400,'decision_kind',{what:'القرار على الفاتورة الموقوفة واحد من ثلاثة',next:'اختر accept أو credit_note أو reject'});
  const note=v.text(input.note,'أساس القرار',2000,10),approver=perms.includes('approve');
  if(u.id===invoice.recorded_by||u.id===p.requester_id||db.prepare('SELECT 1 FROM procurement_receipts WHERE purchase_id=? AND received_by=?').get(p.id,u.id))
    refuse(403,'separation_of_duties',{what:'اللي سجّل الفاتورة أو طلب الشراء أو سجّل استلامًا عليه ما يقرر فرقها',
      missing:[{document:'قرار من معتمد مستقل',why:'الفرق فلوس فوق الأمر أو بضاعة ما وصلت، فيقرره غير اللي بنى الفاتورة أو الاستلام',...OWNERS.reviewer}],
      next:'اطلب القرار من مراجع مستقل في المشروع أو من معتمد مالي'});
  if(!reviewer&&!approver)refuse(403,'not_permitted',{what:'قرار الفاتورة الموقوفة لمراجع في المشروع أو لمعتمد مالي',
    missing:[{document:'مراجع في نطاق الطلب أو تفويض اعتماد مالي',why:'القرار يحوّل فرقًا إلى التزام أو يرفض فاتورة مورد',...OWNERS.reviewer}],next:'اطلب القرار ممن يحمل أحدهما'});
  const st=invoiceState(db,invoice);
  if(st.state==='matched')fail(409,'already_matched','الفاتورة مطابقة وصارت مستحقًا؛ فرقها يُعالج بإشعار أو إلغاء المستحق');
  if(!st.live)refuse(409,'invoice_not_live',{what:`الفاتورة ${invoice.supplier_reference} ${st.state==='rejected'?'مرفوضة بقرار':'ملغاة بقرار معتمد'}`,next:'سجّل فاتورة المورد البديلة'});
  if(!st.variance.has_variance)refuse(409,'nothing_to_decide',{what:'الفاتورة ما فيها فرق عن الأمر والمستلم ينتظر قرارًا',next:'طابقها مباشرة متى وصلت بضاعتها'});
  if(st.covered)refuse(409,'already_decided',{what:`فرق الفاتورة ${invoice.supplier_reference} مقرَّر (${st.decision.decision}) ولا جدّ عليه فرق بعد القرار`,
    next:'طابقها، أو انتظر فرقًا جديدًا (مرتجع أو إقفال) يعيد إيقافها'});
  let basis=input.decision,override=null;
  const tolerance=varianceTolerance(db,p.tenant_id);
  if(input.decision==='accept'){
    if(withinTolerance(tolerance,st.variance))basis='within_tolerance';
    else{
      if(!approver||blank(input.override_reason))refuse(409,'variance_override_required',{
        what:`فرق الفاتورة ${invoice.supplier_reference} (${riyals(st.variance.deviation_minor)} ريال${st.variance.quantity_variance?`، وكمية ${st.variance.quantity_variance} ما تنتظر وصولًا`:''}) ${tolerance.set?'خارج الحد المعتمد':'ما له حد معتمد'}، فقبوله يحتاج مبررًا مكتوبًا من معتمد مالي`,
        missing:[...(tolerance.set?[]:[toleranceMissing(tolerance)]),{document:'مبرر تجاوز مكتوب من معتمد مالي',why:'قبول فرق فوق سعر الأمر أو دفع عن بضاعة ما وصلت قرار مالي',...OWNERS.finance_approver}],
        next:'اطلب من معتمد مالي يقبل بمبرر مكتوب، أو اطلب إشعارًا دائنًا بالفرق، أو ارفض الفاتورة'});
      basis='finance_override';override=v.text(input.override_reason,'مبرر تجاوز الحد',2000,20);
    }
  }
  if(input.decision==='credit_note'&&st.variance.expected_credit_minor<=0)refuse(409,'nothing_to_credit',{what:'الفرق لصالحنا أو صفر: ما فيه ما يرجعه المورد بإشعار دائن',
    next:'اقبل الفرق (ضمن الحد أو بمبرر مالي)، أو ارفض الفاتورة'});
  if(input.decision==='reject')taxGuard(db,invoice,'رفض');
  const decisionId=randomUUID(),sequence=1+(st.decisions.at(-1)?.sequence??0);
  db.prepare('INSERT INTO procurement_invoice_decisions(id,tenant_id,purchase_id,invoice_id,sequence,decision,basis,price_variance_minor,quantity_variance,expected_credit_minor,tolerance_json,note,override_reason,decided_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(decisionId,p.tenant_id,p.id,invoice.id,sequence,input.decision,basis,st.variance.price_variance_minor,st.variance.quantity_variance,st.variance.expected_credit_minor,
      JSON.stringify({value:tolerance.decision.value,source:tolerance.decision.source,effective_from:tolerance.decision.effective_from}),note,override,u.id,nextVersion,now());
  const line=db.prepare('INSERT INTO procurement_invoice_decision_lines(decision_id,invoice_line_id,order_line_id,price_variance_minor,quantity_variance,expected_credit_minor) VALUES(?,?,?,?,?,?)');
  for(const row of st.variance.lines)line.run(decisionId,row.invoice_line_id,row.order_line_id,row.price_variance_minor,row.quantity_variance,row.expected_credit_minor);
  return `قرار على الفاتورة ${invoice.supplier_reference}: ${input.decision} (${basis}) — فرق السعر ${riyals(st.variance.price_variance_minor)} وفرق الكمية ${st.variance.quantity_variance}`;
}

/* ───── الإلغاء ───── */
// طلب بسببه ودليله، وقرار مستقل مرة واحدة: لا طالبه ولا مسجّل الفاتورة ولا من طابقها. الفاتورة غير المطابقة يطلب إلغاءها من في النطاق
// أو معدٌّ مالي ويقرره مراجع أو معتمد مالي. والمستحق — التزامٌ في الدفتر — يطلبه معدٌّ مالي ويقرره معتمد مالي، ويُرفض متى صار عليه
// دفعٌ في الطريق أو منفّذ أو إشعار معلّق. إلغاء المستحق تسويةٌ دائنة بكامل رصيده في payable_adjustments (الجدول العام من الترحيل 166)
// باسم طالبه ويعتمدها معتمد القرار في المعاملة نفسها — فلا تظهر معلّقة في شاشة المدفوعات لتُعتمد من خلف قرار الإلغاء، ويقيّدها
// نوع الدفتر payable_adjustment عكسًا لقيد الفاتورة لكل مركز تكلفة.
function payableVoidable(db,payable){
  const b=balanceOf(db,payable.id);
  if(b.paid_minor>0)refuse(409,'payment_executed',{what:`على المستحق دفعٌ منفّذ (${riyals(b.paid_minor)} ريال)، فما يُلغى`,
    missing:[{document:'إشعار دائن من المورد بما يُسترد، أو مرتجع الدفعة من البنك',why:'الإلغاء لا يسترد فلوسًا خرجت؛ يعكس التزامًا لم يُدفع منه شيء',...OWNERS.finance_preparer}],
    next:'سجّل إشعار المورد الدائن بما بقي، أو سجّل مرتجع الدفعة في «مدفوعات الموردين» إن رجعت'});
  if(b.in_flight_minor>0)refuse(409,'payment_in_flight',{what:`على المستحق أمر دفع في الطريق (${riyals(b.in_flight_minor)} ريال)`,next:'ألغِ أمر الدفع المعلّق أو المعتمد أولًا، ثم اطلب الإلغاء'});
  if(db.prepare("SELECT 1 FROM payable_adjustments WHERE payable_id=? AND status='pending'").get(payable.id))
    refuse(409,'adjustment_pending',{what:'على المستحق إشعار معلّق لم يُقرَّر',next:'يُقرَّر الإشعار المعلّق أولًا، فالإلغاء يأخذ الرصيد بعده'});
  if(db.prepare("SELECT 1 FROM procurement_invoice_tax WHERE invoice_id=? AND status='pending'").get(payable.invoice_id))
    refuse(409,'input_tax_pending',{what:'السجل الضريبي لفاتورة المستحق معلّق لم يُتحقق منه',
      missing:[{document:'قرار التحقق من السجل الضريبي أو رفضه',why:'الإلغاء يعكس ضريبة المدخلات بمبلغ السجل المتحقَّق منه، فيُعرف قبله',...OWNERS.finance_approver}],
      next:'يقرر المعتمد المالي السجل الضريبي في «مدفوعات الموردين»، ثم أعد الطلب'});
  if(b.adjusted_minor<=0)refuse(409,'payable_settled',{what:'المستحق ما عليه شيء: سوّته الإشعارات كله',next:'ما يحتاج إلغاء'});
  return b;
}
function proposeVoid(db,u,p,input,{scoped,perms,nextVersion}){
  const invoice=typeof input.invoice_id==='string'?db.prepare('SELECT * FROM procurement_invoices WHERE id=? AND purchase_id=?').get(input.invoice_id,p.id):null;
  if(!invoice)fail(400,'invalid_invoice','مرجع الفاتورة مو تابع لطلب الشراء هذا');
  const reason=v.text(input.reason,'سبب الإلغاء',2000,20),evidence=v.text(input.evidence,'دليل الإلغاء ومرجعه',3000,10);
  if(invoiceLife(db,invoice.id)!=='live')refuse(409,'invoice_not_live',{what:`الفاتورة ${invoice.supplier_reference} ميتة من قبل (مرفوضة أو ملغاة)`,next:'ما يحتاج إلغاء'});
  if(db.prepare('SELECT 1 FROM procurement_voids v WHERE v.invoice_id=? AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id)').get(invoice.id))
    refuse(409,'void_pending',{what:`على الفاتورة ${invoice.supplier_reference} طلب إلغاء ينتظر قراره`,next:'انتظر قرار الطلب القائم، أو اطلبه من معتمد مستقل'});
  const payable=payableOfInvoice(db,invoice.id);
  if(payable){
    if(!perms.includes('prepare'))refuse(403,'void_requires_finance',{what:'إلغاء مستحق مطابق يطلبه معدٌّ مالي',
      missing:[{document:'تفويض إعداد مالي',why:'الإلغاء تسويةٌ دائنة تعكس التزامًا في الدفتر، وتُسجَّل باسم طالبها',...OWNERS.finance_preparer}],next:'اطلب من معدّ مالي يسجّل طلب الإلغاء بسببه ودليله'});
    payableVoidable(db,payable);
  }else{
    if(!scoped&&!perms.includes('prepare'))notFound();
    taxGuard(db,invoice,'إلغاء');
  }
  db.prepare('INSERT INTO procurement_voids(id,tenant_id,purchase_id,invoice_id,payable_id,reason,evidence,requested_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),p.tenant_id,p.id,invoice.id,payable?.id??null,reason,evidence,u.id,nextVersion,now());
  return `طلب إلغاء ${payable?'المستحق':'الفاتورة'} ${invoice.supplier_reference}: ${reason}`;
}
function decideVoid(db,u,p,input,{reviewer,perms,nextVersion}){
  const request=typeof input.void_id==='string'?db.prepare('SELECT * FROM procurement_voids WHERE id=? AND purchase_id=?').get(input.void_id,p.id):null;
  if(!request)fail(404,'not_found','طلب الإلغاء هذا مو تابع لطلب الشراء');
  if(db.prepare('SELECT 1 FROM procurement_void_decisions WHERE void_id=?').get(request.id))refuse(409,'void_decided',{what:'طلب الإلغاء مقرَّر من قبل',next:'افتح الطلب واقرأ القرار المسجّل'});
  if(!['approve','reject'].includes(input.decision))refuse(400,'decision_kind',{what:'القرار على طلب الإلغاء اعتماد أو رفض',next:'اختر approve أو reject'});
  const note=v.text(input.note,'أساس القرار',2000,10);
  const invoice=db.prepare('SELECT * FROM procurement_invoices WHERE id=?').get(request.invoice_id),payable=request.payable_id?db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(request.payable_id):null;
  if([request.requested_by,invoice.recorded_by,payable?.matched_by].includes(u.id))refuse(403,'separation_of_duties',{what:'اللي طلب الإلغاء أو سجّل الفاتورة أو طابقها ما يقرر إلغاءها',
    missing:[{document:'قرار من معتمد مستقل',why:'الإلغاء يمحو التزامًا أو فاتورة من دورة الدفع، فيقرره غير من بناهما ومن طلبه',...(payable?OWNERS.finance_approver:OWNERS.reviewer)}],
    next:'اطلب القرار من معتمد مستقل'});
  if(payable&&!perms.includes('approve'))refuse(403,'void_requires_finance_approver',{what:'إلغاء مستحق مطابق يقرره معتمد مالي',
    missing:[{document:'تفويض اعتماد مالي',why:'إلغاء المستحق يعكس التزامًا وضريبة مدخلات في الدفتر',...OWNERS.finance_approver}],next:'اطلب القرار من معتمد مالي مستقل'});
  if(!payable&&!reviewer&&!perms.includes('approve'))refuse(403,'not_permitted',{what:'قرار إلغاء الفاتورة لمراجع في المشروع أو لمعتمد مالي',
    missing:[{document:'مراجع في نطاق الطلب أو تفويض اعتماد مالي',why:'الإلغاء يمحو فاتورة مورد من المطابقة',...OWNERS.reviewer}],next:'اطلب القرار ممن يحمل أحدهما'});
  const decide=(decision,adjustmentId=null)=>db.prepare('INSERT INTO procurement_void_decisions(void_id,tenant_id,decision,note,adjustment_id,decided_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(request.id,p.tenant_id,decision,note,adjustmentId,u.id,nextVersion,now());
  if(input.decision==='reject'){decide('rejected');return `رُفض طلب إلغاء الفاتورة ${invoice.supplier_reference}: ${note}`;}
  if(!payable){taxGuard(db,invoice,'إلغاء');decide('approved');return `انلغت الفاتورة ${invoice.supplier_reference}: ${request.reason}`;}
  const balance=payableVoidable(db,payable),before=commitmentOf(db,p.id);
  const tax=db.prepare("SELECT vat_minor FROM procurement_invoice_tax WHERE invoice_id=? AND status='verified'").get(payable.invoice_id)?.vat_minor??0;
  const vatOf=kind=>db.prepare("SELECT COALESCE(SUM(vat_minor),0) AS n FROM payable_adjustments WHERE payable_id=? AND status='approved' AND kind=?").get(payable.id,kind).n;
  const amount=balance.adjusted_minor,vat=Math.min(amount,Math.max(0,tax+vatOf('debit')-vatOf('credit')));
  const adjustmentId=randomUUID(),reference=`VOID-${request.id.slice(0,8).toUpperCase()}`,time=now();
  db.prepare("INSERT INTO payable_adjustments(id,tenant_id,payable_id,vendor_id,kind,amount_minor,vat_minor,reference,reason,evidence,source_kind,source_id,status,recorded_by,created_at) VALUES(?,?,?,?,'credit',?,?,?,?,?,'procurement_void',?,'pending',?,?)")
    .run(adjustmentId,p.tenant_id,payable.id,vendorGate(db,p.tenant_id,invoice.supplier_key,p.id).vendor_id??null,amount,vat,reference,request.reason,request.evidence,request.id,request.requested_by,time);
  db.prepare("UPDATE payable_adjustments SET status='approved',decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(u.id,time,note,adjustmentId);
  audit(db,u,'payable_adjustment',adjustmentId,'payable_adjustment.recorded',{}, {payable_id:payable.id,kind:'credit',amount_minor:amount,vat_minor:vat,reference,source_kind:'procurement_void',void_id:request.id,requested_by:request.requested_by});
  audit(db,u,'payable_adjustment',adjustmentId,'payable_adjustment.approved',{status:'pending'},{status:'approved',payable_id:payable.id,kind:'credit',amount_minor:amount});
  decide('approved',adjustmentId);
  recordCommitmentMovement(db,u,p,'unconsume_purchase',before);
  return `انلغى المستحق ${invoice.supplier_reference} بتسوية دائنة ${reference} بـ${riyals(amount)} ريال: ${request.reason}`;
}

/* ───── التنازل عن إشعار منتظر ───── */
// المورد رفض الإشعار والفرق صار مقبولًا بعد تفاوض: معتمد مالي غير منشئ الطلب يتنازل بمبرر مكتوب، فيُفك المحجوز عن الدفع.
function waiveCredit(db,u,p,input,{perms}){
  const request=typeof input.request_id==='string'?db.prepare('SELECT * FROM procurement_credit_requests WHERE id=? AND purchase_id=?').get(input.request_id,p.id):null;
  if(!request)fail(404,'not_found','طلب الإشعار هذا مو تابع لطلب الشراء');
  if(request.created_by===u.id)refuse(403,'separation_of_duties',{what:'اللي أنشأ طلب الإشعار ما يتنازل عنه',
    missing:[{document:'تنازل من معتمد مالي آخر',why:'التنازل يفك فلوسًا محجوزة عن الدفع للمورد',...OWNERS.finance_approver}],next:'اطلب التنازل من معتمد مالي آخر'});
  if(!perms.includes('approve'))refuse(403,'not_permitted',{what:'التنازل عن إشعار منتظر لمعتمد مالي',
    missing:[{document:'تفويض اعتماد مالي',why:'التنازل قبولٌ لدفع فرق كان محجوزًا',...OWNERS.finance_approver}],next:'اطلب التنازل من معتمد مالي'});
  const current=creditRequests(db,request.payable_id).find(r=>r.id===request.id);
  if(current.waived)refuse(409,'already_waived',{what:'طلب الإشعار متنازَل عنه من قبل',next:'ما يحتاج تنازلًا ثانيًا'});
  if(current.outstanding_minor<=0)refuse(409,'nothing_withheld',{what:'طلب الإشعار مجاب كله بإشعارات معتمدة، فما فيه محجوز يُفك',next:'ما يحتاج تنازلًا'});
  const reason=v.text(input.reason,'مبرر التنازل عن الإشعار',2000,20);
  db.prepare('INSERT INTO procurement_credit_waivers(request_id,tenant_id,reason,waived_by,created_at) VALUES(?,?,?,?,?)').run(request.id,p.tenant_id,reason,u.id,now());
  return `تنازل عن إشعار منتظر بـ${riyals(current.outstanding_minor)} ريال: ${reason}`;
}

/* ───── إشعار المورد (دائن أو مدين) عبر واجهة المدفوعات ───── */
// الإشعار سجلٌّ في payable_adjustments تسجّله واجهة المدفوعات نفسها (تفويض الإعداد المالي، والتحقق، والتدقيق)، ويعتمده زميل ثانٍ
// هناك. وهنا يُربط بطلبه: الإشعار الذي يجيب طلب إشعار دائن مصدره «procurement_credit» ومعرّف الطلب، ومجموع ما يجيبه (معلّقًا ومعتمدًا)
// لا يتجاوز الطلب — فلا إشعاران لطلب واحد ولو سُجّلا في اللحظة نفسها. وغير ذلك (إشعار مدين، أو دائن بلا طلب) مصدره «procurement_note».
const MONEY=/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
export function recordSupplierNote(db,supplied,purchaseId,input){
  writing(db);
  const u=purchaseActor(db,supplied);
  v.object(input,['payable_id','request_id','kind','amount','vat','reference','reason','evidence']);
  const p=typeof purchaseId==='string'?db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(purchaseId,u.tenant_id):null;
  if(!p)notFound();
  const payable=typeof input.payable_id==='string'?db.prepare('SELECT * FROM procurement_payables WHERE id=? AND purchase_id=?').get(input.payable_id,p.id):null;
  if(!payable)fail(404,'not_found','المستحق هذا مو تابع لطلب الشراء');
  if(payableVoided(db,payable.id))refuse(409,'payable_voided',{what:'المستحق ملغى بقرار معتمد',next:'سجّل الإشعار على المستحق البديل'});
  const {request_id:requestId,...note}=input;
  let source={source_kind:'procurement_note',source_id:p.id};
  if(!blank(requestId)){
    const request=creditRequests(db,payable.id).find(r=>r.id===requestId);
    if(!request)fail(404,'not_found','طلب الإشعار هذا مو على هالمستحق');
    if(input.kind!=='credit')refuse(400,'note_kind',{what:'طلب الإشعار الدائن يجيبه إشعار دائن',next:'سجّل الإشعار بنوع credit، أو سجّل الإشعار المدين بلا طلب'});
    if(request.waived)refuse(409,'request_waived',{what:'طلب الإشعار متنازَل عنه',next:'سجّل الإشعار بلا ربط بالطلب إن وصل بعد التنازل'});
    const amount=typeof input.amount==='string'&&MONEY.test(input.amount)?Number(BigInt(input.amount.split('.')[0])*100n+BigInt((input.amount.split('.')[1]??'').padEnd(2,'0'))):null;
    if(amount!==null&&amount>request.open_minor)refuse(409,'credit_exceeds_request',{
      what:`الإشعار (${riyals(amount)} ريال) أكبر من الباقي على طلبه (${riyals(request.open_minor)} ريال) بعد الإشعارات المسجّلة عليه`,
      next:'راجع الإشعارات المسجّلة على الطلب؛ ما زاد عنه يُسجَّل إشعارًا بلا طلب'});
    source={source_kind:'procurement_credit',source_id:request.id};
  }
  return recordAdjustment(db,u,{...note,...source});
}

/* ───── نوع الدفتر: payable_adjustment ───── */
// كل تسوية معتمدة على مستحق — إشعار دائن أو مدين من المورد (من المشتريات أو من شاشة المدفوعات)، وتسوية الإلغاء — قيدٌ من أرقامها:
//   دائن (credit): مدين ذمم الموردين بالإجمالي / دائن تكلفة الموردين بالصافي لكل مركز تكلفة / دائن ضريبة المدخلات بضريبته.
//   مدين (debit): العكس.
// ومراكز التكلفة من توزيع المستحق نفسه (بنود المستحق ← بنود الأمر ← مخصصات بنود الطلب) كما يوزعه نوع «فاتورة مورد مطابقة» في
// app/ledger.mjs، والإجمالي والضريبة يتوزعان بالأوزان نفسها وبالقاعدة نفسها (spreadMinor): فإلغاءٌ بكامل المستحق يعكس قيد فاتورته
// حرفًا بحرف لكل مركز. ويدخل الأستاذ المساعد للحسابين الرقابيين (الموردين وضريبة المدخلات) بإشارته، فتبقى المطابقة صفرًا.
const M='procurement',riyadhDate=iso=>new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10);
const adjustmentRow=(db,tenantId,id)=>typeof id==='string'?db.prepare(`SELECT a.*,i.supplier_reference,x.invoice_id,x.purchase_id,x.created_at AS payable_created_at,x.amount_minor AS payable_amount_minor,o.supplier_name
  FROM payable_adjustments a JOIN procurement_payables x ON x.id=a.payable_id JOIN procurement_invoices i ON i.id=x.invoice_id JOIN procurement_orders o ON o.purchase_id=x.purchase_id
  WHERE a.id=? AND a.tenant_id=?`).get(id,tenantId)??null:null;
const approvedAdjustments=(db,tenantId)=>db.prepare("SELECT id,kind,amount_minor,vat_minor,reference,decided_at FROM payable_adjustments WHERE tenant_id=? AND status='approved'").all(tenantId);
const KIND_NAMES={credit:'إشعار دائن',debit:'إشعار مدين'};
function centreOf(db,tenantId,id,text){
  if(id){const row=db.prepare('SELECT id,code FROM finance_cost_centers WHERE id=? AND tenant_id=?').get(id,tenantId);if(row)return row;}
  const key=centerKey(text);
  return db.prepare('SELECT id,code FROM finance_cost_centers WHERE tenant_id=? AND active=1').all(tenantId).find(c=>centerKey(c.code)===key)??null;
}
export function payableCentres(db,tenantId,payableId){
  const payable=db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(payableId);
  const lines=db.prepare('SELECT pl.amount_minor,ol.purchase_line_id,ol.cost_center_id,ol.cost_center FROM procurement_payable_lines pl JOIN procurement_order_lines ol ON ol.id=pl.order_line_id WHERE pl.payable_id=? ORDER BY ol.line_no,pl.id').all(payableId);
  const parts=[];
  if(!lines.length){const p=db.prepare('SELECT cost_center_id,cost_center FROM procurement_purchases WHERE id=?').get(payable.purchase_id);parts.push({id:p.cost_center_id,text:p.cost_center,amount:payable.amount_minor});}
  for(const line of lines){
    const allocations=db.prepare('SELECT cost_center_id,cost_center,amount_minor FROM procurement_line_allocations WHERE purchase_line_id=? ORDER BY position,id').all(line.purchase_line_id);
    if(allocations.length<2){parts.push({id:allocations[0]?.cost_center_id??line.cost_center_id,text:allocations[0]?.cost_center??line.cost_center,amount:line.amount_minor});continue;}
    spreadMinor(line.amount_minor,allocations.map(a=>a.amount_minor)).forEach((amount,i)=>parts.push({id:allocations[i].cost_center_id,text:allocations[i].cost_center,amount}));
  }
  const groups=new Map(),unresolved=[];
  for(const part of parts){
    if(!part.amount)continue;
    const centre=centreOf(db,tenantId,part.id,part.text);
    if(!centre){unresolved.push(part.text);continue;}
    const g=groups.get(centre.id)??{id:centre.id,code:centre.code,gross:0};g.gross+=part.amount;groups.set(centre.id,g);
  }
  return {groups:[...groups.values()],unresolved:[...new Set(unresolved)]};
}
function adjustmentBuild(db,u,id){
  const a=adjustmentRow(db,u.tenant_id,id);
  if(!a||a.status!=='approved')return null;
  const label=`${KIND_NAMES[a.kind]} ${a.reference} على فاتورة المورد ${a.supplier_reference}`;
  if(a.vat_minor>0&&!db.prepare("SELECT 1 FROM procurement_invoice_tax WHERE invoice_id=? AND status='verified'").get(a.invoice_id))
    refuse(409,'input_tax_unverified',{what:`${label} ما يتجهز قيده: فيه ضريبة (${riyals(a.vat_minor)}) وفاتورته ما لها سجل ضريبي متحقَّق منه`,
      missing:[{document:'السجل الضريبي لفاتورة المورد متحقَّقًا منه',why:'الإشعار يعكس ضريبة مدخلات أو يزيدها على فاتورة، فتُعرف ضريبة الفاتورة قبله',...OWNERS.finance_approver}],
      next:'سجّل ضريبة الفاتورة في «مدفوعات الموردين» ويتحقق منها شخص ثانٍ، وبعدها جهّز القيد'});
  const {groups,unresolved}=payableCentres(db,u.tenant_id,a.payable_id);
  if(unresolved.length||!groups.length)refuse(409,'cost_centre_unresolved',{what:`${label} ما يتجهز قيده: مركز التكلفة «${unresolved.join('، ')||'—'}» في بنود الشراء ما يطابق مركزًا في دليل المالية`,
    missing:[{document:`مركز تكلفة في الدفتر برمز «${unresolved[0]??'—'}»`,why:'الإشعار ينقيد على المركز اللي انقيدت عليه فاتورته',...OWNERS.finance_preparer}],
    next:'أنشئ المركز برمزه نفسه في «الدفتر المالي» ← مراكز التكلفة، وبعدها جهّز القيد'});
  const weights=groups.map(g=>g.gross),gross=spreadMinor(a.amount_minor,weights),vat=spreadMinor(a.vat_minor,weights);
  let net=gross.map((g,i)=>g-vat[i]);
  if(net.some(n=>n<0))net=spreadMinor(a.amount_minor-a.vat_minor,weights);
  const credit=a.kind==='credit',side=minor=>credit?{debit_minor:0,credit_minor:minor}:{debit_minor:minor,credit_minor:0};
  return {date:riyadhDate(a.decided_at),reference:a.reference.slice(0,170),description:`${label} — ${a.supplier_name}`.slice(0,900),
    lines:[{purpose:'payable',...(credit?{debit_minor:a.amount_minor,credit_minor:0}:{debit_minor:0,credit_minor:a.amount_minor}),memo:credit?'الإشعار ينقص ذمة المورد':'الإشعار يزيد ذمة المورد'},
      ...groups.map((g,i)=>({purpose:'supplier_cost',cost_center_id:g.id,...side(net[i]),memo:`صافي الإشعار لمركز ${g.code}`})).filter(l=>l.debit_minor+l.credit_minor>0),
      ...(a.vat_minor?[{purpose:'input_vat',...side(a.vat_minor),memo:credit?'عكس ضريبة المدخلات في الإشعار':'ضريبة المدخلات في الإشعار'}]:[])]};
}
const at=(role,actor_id,time,note)=>actor_id?{role,actor_id,at:time??null,...(note?{note}:{})}:null;
registerSourceKind({key:'payable_adjustment',name:'إشعار مورد معتمد على مستحق (دائن أو مدين أو إلغاء)',module:M,
  build:adjustmentBuild,
  pending:(db,tenantId)=>approvedAdjustments(db,tenantId).map(a=>({source_id:a.id,reference:a.reference,amount_minor:a.amount_minor,date:riyadhDate(a.decided_at)})),
  controls:{
    payable:(db,tenantId)=>approvedAdjustments(db,tenantId).map(a=>({source_id:a.id,reference:a.reference,date:riyadhDate(a.decided_at),amount_minor:a.kind==='credit'?-a.amount_minor:a.amount_minor})),
    input_vat:(db,tenantId)=>approvedAdjustments(db,tenantId).filter(a=>a.vat_minor>0).map(a=>({source_id:a.id,reference:a.reference,date:riyadhDate(a.decided_at),amount_minor:a.kind==='credit'?-a.vat_minor:a.vat_minor}))},
  document:(db,tenantId,id)=>{const a=adjustmentRow(db,tenantId,id);return a&&{reference:a.reference,date:riyadhDate(a.decided_at??a.created_at),amount_minor:a.amount_minor,status:a.status,
    description:`${KIND_NAMES[a.kind]} على فاتورة ${a.supplier_reference} — ${a.supplier_name}`};},
  approvals(db,tenantId,id){
    const a=adjustmentRow(db,tenantId,id);if(!a)return [];
    const request=a.source_kind==='procurement_void'?db.prepare('SELECT * FROM procurement_voids WHERE id=?').get(a.source_id):null;
    return [request?at('طلب إلغاء المستحق',request.requested_by,request.created_at,request.reason):at('سجّل الإشعار',a.recorded_by,a.created_at),
      at(request?'اعتمد الإلغاء':'اعتمد الإشعار',a.decided_by,a.decided_at,a.decision_note||null)].filter(Boolean);
  }});
const adjustmentItem=a=>({kind:'payable_adjustment',id:a.id,reference:a.reference,date:riyadhDate(a.decided_at??a.created_at),amount_minor:a.amount_minor,status:a.status});
// عكس فاتورة المورد: كل تسوية دائنة على مستحقها (إشعار دائن أو إلغاء)، معتمدة أو معلّقة، بترتيبها.
registerSourceLink({from:'supplier_invoice',role:'reversal',module:M,list:(db,tenantId,payableId)=>db.prepare("SELECT * FROM payable_adjustments WHERE payable_id=? AND tenant_id=? AND kind='credit' AND status<>'rejected' ORDER BY created_at,rowid").all(payableId,tenantId).map(adjustmentItem)});
// والتسوية تسمّي الفاتورة التي تسوّيها.
registerSourceLink({from:'payable_adjustment',role:'settles',module:M,list:(db,tenantId,id)=>{const a=adjustmentRow(db,tenantId,id);
  return a?[{kind:'supplier_invoice',id:a.payable_id,reference:a.supplier_reference,date:riyadhDate(a.payable_created_at),amount_minor:a.payable_amount_minor,status:'matched'}]:[];}});
