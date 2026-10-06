// الحزمة 3 — استثناءات المشتريات (الترحيل 169): «استلام جزئي، مرتجع، فاتورة جزئية، مطابقة ثلاثية، قرار الفرق، الالتزام، والعكس».
// ما يثبته هذا الملف، بالمسارات الحقيقية لا بصفوف مكتوبة باليد (إلا حيث يُقاس حارس القاعدة نفسه):
//   • المرتجع على بنود الاستلام بسببه ودليله، يسجّله غير صاحب الطلب، ولا يتجاوز المستلم؛ ينقص ما يُطابَق، ويوقف فاتورة فوترت
//     البضاعة المرتجعة، ويطلب إشعارًا دائنًا على التزام قائم.
//   • فاتورة بفرق سعر أو كمية تُسجَّل موقوفة لا مرفوضة، والفرق محسوب لكل بند؛ لا قبول آلي أبدًا، ويقرر معتمد مستقل: قبول ضمن حد
//     معتمد أو بمبرر مكتوب من معتمد مالي، أو طلب إشعار دائن، أو رفض. والحد قيمة للمالك مسجّلة مسودة بلا قيمة.
//   • إشعارات المورد الدائنة والمدينة تمرّ بواجهة المدفوعات (payable_adjustments)، ونوع الدفتر payable_adjustment يقيّدها لكل
//     مركز تكلفة ويدخل الحسابين الرقابيين (الموردين وضريبة المدخلات)، ويرتبط بفاتورة المورد رابطَ عكس.
//   • إلغاء فاتورة أو مستحق غير مدفوع سجلٌّ مستقل لا يُعدَّل، بسببه ومعتمد مستقل، ويُرفض متى صار دفعٌ في الطريق أو منفّذ.
//   • الالتزام يُستهلك بالمطابقة، ويتحرر بالإقفال على المستلم، ويرجع أو يتحرر بالإلغاء — وأرقام المخصص صادقة في كل خطوة.
//   • زر الترسية على عتبة الخادم نفسها، وحالة السداد في المشتريات من payable_balances.
// كل البيانات مصطنعة: لا مورد حقيقي ولا آيبان ولا موظف حقيقي. قواعد بالذاكرة، وملف مؤقت واحد لسباق العمليات.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';
import { dispatch, PASSWORD, caught } from './definitions-fixture.mjs';
import { grantAccess } from '../app/access.mjs';
import { createPurchase, procurementAction, listProcurement, payableState, PAYMENT_STATUS_NAMES } from '../app/procurement.mjs';
import * as exceptions from '../app/procurement-exceptions.mjs';
import * as payables from '../app/payables.mjs';
import * as budgets from '../app/budgets.mjs';
import { requestOrderChange, decideOrderChange, procurementExtras, declareEmergency, decideEmergency } from '../app/procurement-extras.mjs';
import { controlReconciliation, traceAmount } from '../app/ledger.mjs';
import { sourceKind, sourceLinks } from '../app/ledger-sources.mjs';
import { adoptionAction, adopted } from '../app/options.mjs';
import { procurementUI } from '../app/static/procurement-ui.mjs';
import { procurementExtrasUI } from '../app/static/procurement-extras-ui.mjs';
import { createApp } from '../app/server.mjs';
import { financialChecklist } from '../app/project-axes.mjs';
import { runReport } from '../app/reports.mjs';
import { exceptionsBoard } from '../app/finance-exceptions.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WORKER=join(ROOT,'tests/procurement-exceptions-worker.mjs');
const TOLERANCE='procurement.invoice_variance_tolerance';
const money=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
const REASON='وحدات تالفة عند الفحص أُعيدت للمورد بمحضر',EVIDENCE='محضر إرجاع مصطنع موقّع من المستودع ومحفوظ';

// عالم الاختبار: شهر الدفتر المصطنع (tests/ledger-fixture.mjs) ومعه مراجع مشتريات بلا تفويض مالي (pm-rev).
// الأدوار: employee يطلب ويستلم ويسجّل الفواتير (وله إعداد مالي)، manager يرسّي ويعتمد ويطابق (وله اعتماد مالي)،
// pm-rev مراجع مشتريات في نطاق المشروع بلا أي تفويض مالي، outsider معتمد مالي خارج نطاق المشروع، treasurer يوثّق التنفيذ.
function world(t){
  const L=ledgerMonth(t,{seedName:PASSWORD});
  const {db,tx,day,project}=L;
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'pm-rev','36t','creative','pm-rev','مراجع مشتريات مصطنع بلا تفويض مالي',password_hash,'pm' FROM users WHERE id='manager'");
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id,'pm-rev');
  db.prepare('INSERT INTO procurement_project_grants VALUES(?,?,?,?,?)').run(project.id,'pm-rev','manager','تصريح تكلفة مصطنع لمراجع المشتريات',now());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const act=(who,p,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const ex=(who,p,action,values={})=>tx(()=>exceptions.exceptionAction(db,users[who],p.id,action,{version:p.version,...values}));
  const read=(p,who='manager')=>listProcurement(db,users[who]).find(x=>x.id===p.id);
  let n=0;
  // أمر معتمد وإذن مباشرة يسري اليوم. lines: [وصف، كمية، سعر الوحدة بالهللة]، ومركز التكلفة CC-A للكل.
  function ordered(lines=[['وحدات طباعة مصطنعة',10,10000]]){
    n++;
    let p=tx(()=>createPurchase(db,users.employee,{project_id:project.id,title:`شراء استثناءات مصطنع ${n}`,specification:'بنود مصطنعة لاختبار استثناءات المشتريات',due_date:'2099-10-20',
      budget_evidence:'مخصص اختبار داخلي',currency:'SAR',lines:lines.map(([description,quantity,price])=>({description,quantity,unit:'وحدة',cost_center:'CC-A',budget_amount:money(quantity*price)}))}));
    p=act('employee',p,'submit');
    for(const [key,bump] of [['LOCAL-A',0],['LOCAL-B',500],['LOCAL-C',900]])
      p=act('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد مصطنع '+key,line_prices:p.lines.map((line,i)=>({purchase_line_id:line.id,unit_price:money(lines[i][2]+bump)})),
        technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
    p=act('manager',p,'award',{quote_id:p.quotes.find(q=>q.supplier_key==='LOCAL-A').id,note:'ترسية على الأقل سعرًا بعد تأكيد المخصص'});
    p=act('manager',p,'approve_order',{terms:'تسليم على دفعات بعد فحص الجودة',delivery_date:'2099-10-20',note:'اعتماد أمر داخلي مصطنع'});
    return act('manager',p,'commence',{start_on:day,valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'});
  }
  const lineOf=(p,i=0)=>p.order.lines[i];
  const receive=(p,rows,reference)=>act('employee',p,'receive',{reference,evidence:'استلام مصطنع وفحص الجودة محليًا',lines:rows.map(([i,quantity])=>({order_line_id:lineOf(p,i).id,quantity}))});
  const invoice=(p,rows,reference,who='employee')=>act(who,p,'record_invoice',{supplier_reference:reference,evidence:'فاتورة مورد مصطنعة محفوظة '+reference,lines:rows.map(([i,quantity,amount])=>({order_line_id:lineOf(p,i).id,quantity,amount}))});
  const invoiceOf=(p,reference)=>p.invoices.find(i=>i.supplier_reference===reference.toUpperCase());
  const payableOf=(p,reference)=>p.payables.find(x=>x.invoice_id===invoiceOf(p,reference).id);
  const giveBack=(p,rows,reference,who='manager')=>ex(who,p,'record_return',{reference,reason:REASON,evidence:EVIDENCE,lines:rows.map(([i,quantity])=>({order_line_id:lineOf(p,i).id,quantity}))});
  const match=(p,reference,who='manager')=>act(who,p,'match',{invoice_id:invoiceOf(p,reference).id,note:'طابقنا الأمر والاستلام والفاتورة'});
  const decide=(who,p,reference,decision,extra={})=>ex(who,p,'decide_invoice',{invoice_id:invoiceOf(p,reference).id,decision,note:'راجعت الفرق مع المورد وقررت على أساسه',...extra});
  const proposeVoid=(who,p,reference)=>ex(who,p,'propose_void',{invoice_id:invoiceOf(p,reference).id,reason:'الفاتورة صدرت بالخطأ وسحبها المورد بخطاب مكتوب',evidence:'خطاب سحب الفاتورة من المورد المصطنع'});
  const decideVoid=(who,p,voidId,decision='approve')=>ex(who,p,'decide_void',{void_id:voidId,decision,note:'راجعت خطاب المورد والرصيد قبل القرار'});
  const budgetState=()=>budgets.getBudget(db,users['budget-reviewer'],db.prepare('SELECT id FROM project_budgets WHERE project_id=?').get(project.id).id);
  const note=(who,p,input)=>tx(()=>exceptions.recordSupplierNote(db,users[who],p.id,{reason:'إشعار المورد عن الفرق المتفق عليه',evidence:'إشعار مصطنع محفوظ في ملف المورد',...input}));
  const decideNote=(who,id,decision='approve')=>tx(()=>payables.decideAdjustment(db,users[who],id,decision,{note:'طابقت الإشعار مع الفرق المطلوب'}));
  const pay=(payableId,amount)=>{
    const id=tx(()=>payables.preparePayment(db,users.employee,amount?{payable_id:payableId,amount}:{payable_id:payableId})).id;
    tx(()=>payables.paymentAction(db,users.manager,id,'approve_order',{version:payables.getOrder(db,users.manager,id).version,note:'اعتماد دفعة مصطنعة بعد المطابقة'}));
    tx(()=>payables.paymentAction(db,users.treasurer,id,'record_execution',{version:payables.getOrder(db,users.treasurer,id).version,executed_on:day,bank_reference:`BNK-${id.slice(0,8)}`,evidence:'إشعار تحويل بنكي مصطنع محفوظ'}));
    return db.prepare('SELECT * FROM payment_orders WHERE id=?').get(id);
  };
  const adopt=value=>{
    for(const who of ['manager','employee'])if(!db.prepare("SELECT 1 FROM access_grants WHERE user_id=? AND capability='finance.use' AND revoked_at IS NULL").get(who))
      tx(()=>grantAccess(db,users.admin,{user_id:who,capability:'finance.use',note:'تصريح مصطنع لتقرير حد فرق الفاتورة'}));
    tx(()=>adoptionAction(db,users.employee,TOLERANCE,'record',{value,basis:'قرار مصطنع للاختبار بعد مراجعة المالية والمشتريات',effective_from:day}));
    const row=db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL ORDER BY created_at DESC,rowid DESC').get(TOLERANCE);
    tx(()=>adoptionAction(db,users.manager,TOLERANCE,'approve',{adoption_id:row.id,note:'اعتمدت الحد المصطنع بعد مراجعته'}));
  };
  return {...L,users,act,ex,read,ordered,lineOf,receive,invoice,invoiceOf,payableOf,giveBack,match,decide,proposeVoid,decideVoid,budgetState,note,decideNote,pay,adopt};
}
const controlOf=(db,day,key)=>controlReconciliation(db,'36t',day).controls.find(c=>c.key===key);
const trialBalance=db=>db.prepare("SELECT COALESCE(SUM(l.debit_minor),0) AS d,COALESCE(SUM(l.credit_minor),0) AS c FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id WHERE j.status='posted'").get();

/* ───── 1) السلسلة كاملة ───── */
test('E2E P3 procurement: request → sourcing → award → order → commencement → partial receipt → return → partial invoice with a price variance → held → decided → match → liability → credit note → partial payment → reversal path',t=>{
  const w=world(t),{db,users,tx,day}=w;
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000],['حوامل عرض مصطنعة',4,5000]]);
  assert.equal(p.status,'ordered');
  let b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.available_minor],[120000,0,10000000-120000],'the order commits its whole value');
  // استلام جزئي
  p=w.receive(p,[[0,6],[1,4]],'REC-1');
  assert.equal(p.status,'part_received');
  // مرتجع: غير صاحب الطلب، ولا يتجاوز المستلم
  assert.equal(caught(()=>w.giveBack(p,[[0,1]],'RMA-1','employee')).code,'separation_of_duties');
  assert.equal(caught(()=>w.giveBack(p,[[0,7]],'RMA-1')).code,'return_exceeds_received');
  p=w.giveBack(p,[[0,1]],'RMA-1');
  assert.equal(p.returns.length,1);
  assert.deepEqual(p.order.lines.map(l=>[l.received_quantity,l.returned_quantity,l.net_received_quantity]),[[6,1,5],[4,0,4]]);
  // فاتورة جزئية بفرق سعر: تُسجَّل موقوفة لا مرفوضة، والفرق لكل بند
  p=w.invoice(p,[[0,5,'525.00'],[1,4,'200.00']],'INV-1');
  let inv=w.invoiceOf(p,'INV-1');
  assert.equal(inv.state,'held');
  assert.deepEqual(inv.variance.lines.map(l=>[l.price_variance_minor,l.quantity_variance,l.expected_credit_minor]),[[2500,0,2500],[0,0,0]]);
  const held=caught(()=>w.match(p,'INV-1'));
  assert.equal(held.code,'invoice_held');assert.ok(held.details.refusal.missing.length&&held.details.refusal.next);
  // قرار معتمد مستقل
  assert.equal(caught(()=>w.decide('employee',p,'INV-1','credit_note')).code,'separation_of_duties');
  assert.equal(caught(()=>w.decide('pm-rev',p,'INV-1','accept')).code,'variance_override_required');
  p=w.decide('manager',p,'INV-1','credit_note');
  inv=w.invoiceOf(p,'INV-1');
  assert.deepEqual([inv.state,inv.decision.decision,inv.decision.expected_credit_minor],['decided','credit_note',2500]);
  // المطابقة: الالتزام بمبلغ الفاتورة كما فوترت، والجزء المتنازع عليه محجوز عن الدفع حتى يصل الإشعار
  p=w.match(p,'INV-1');
  let payable=w.payableOf(p,'INV-1');
  assert.equal(payable.amount_minor,72500);
  assert.deepEqual(payable.credit_requests.map(r=>[r.source,r.amount_minor,r.outstanding_minor]),[['variance',2500,2500]]);
  assert.deepEqual([payable.withheld_minor,payable.payable_now_minor],[2500,70000]);
  b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor],[40000,72500,10000],'match consumes; the returned unit is released; the four units still expected stay committed');
  assert.throws(()=>tx(()=>payables.preparePayment(db,users.employee,{payable_id:payable.id})),e=>e.code==='payment_withheld'&&/700\.00/.test(e.details.refusal.next),'الرفض يسمّي المحجوز وما يُدفع الآن');
  // الإشعار الدائن من المورد عبر واجهة المدفوعات، مربوطًا بطلبه، ولا يتجاوزه
  const request=payable.credit_requests[0].id;
  const cn=w.note('employee',p,{payable_id:payable.id,request_id:request,kind:'credit',amount:'25.00',vat:'3.26',reference:'CN-1'});
  assert.equal(caught(()=>w.note('employee',p,{payable_id:payable.id,request_id:request,kind:'credit',amount:'25.00',vat:'3.26',reference:'CN-2'})).code,'credit_exceeds_request');
  assert.equal(payables.getAdjustment(db,users.manager,cn.id).source_kind,'procurement_credit');
  w.decideNote('outsider',cn.id);
  p=w.read(p);payable=w.payableOf(p,'INV-1');
  assert.deepEqual([payable.adjusted_minor,payable.withheld_minor,payable.payable_now_minor],[70000,0,70000]);
  assert.equal(w.budgetState().consumed_minor,70000,'the approved credit note brings consumption back to the order price');
  // ضريبة الفاتورة ثم دفعة جزئية
  w.inputTax(w.invoiceOf(p,'INV-1').id,'94.57');
  const order=w.pay(payable.id,'300.00');
  p=w.read(p);payable=w.payableOf(p,'INV-1');
  assert.deepEqual([payable.payment_status,payable.paid_minor,payable.outstanding_minor],['partially_paid',30000,40000]);
  assert.equal(p.payment_status,'partially_paid');
  // مسار العكس: القيود، والحسابان الرقابيان بلا فرق، والتتبّع من الفاتورة إلى إشعارها الدائن وبالعكس
  for(const [kind,id] of [['supplier_invoice',payable.id],['payable_adjustment',cn.id],['supplier_payment',order.id]])w.post(w.journal(kind,id));
  for(const key of ['payable','input_vat']){const c=controlOf(db,day,key);assert.equal(c.difference_minor,0,key);assert.equal(c.balanced,true,key);}
  assert.equal(controlOf(db,day,'payable').ledger_minor,40000);
  assert.equal(controlOf(db,day,'input_vat').ledger_minor,9457-326);
  const tb=trialBalance(db);assert.equal(tb.d,tb.c,'the ledger stays balanced');
  const reversal=traceAmount(db,users.manager,{kind:'supplier_invoice',id:payable.id}).chain.find(s=>s.step==='reversal');
  assert.equal(reversal.state,'linked');
  assert.deepEqual(reversal.items.map(i=>[i.kind,i.id,i.journal?.status]),[['payable_adjustment',cn.id,'posted']]);
  const settles=traceAmount(db,users.manager,{kind:'payable_adjustment',id:cn.id}).chain.find(s=>s.step==='settles');
  assert.deepEqual(settles.items.map(i=>[i.kind,i.id]),[['supplier_invoice',payable.id]]);
  // لا إلغاء بعد أن خرج دفع
  assert.equal(caught(()=>w.proposeVoid('employee',p,'INV-1')).code,'payment_executed');
  assert.ok(verifyAudit(db));
});

/* ───── 2) المرتجعات ───── */
test('returns: against receipt lines, by someone other than the requester, never more than was received; they shrink what can be matched, hold an invoice that billed the returned goods, and ask for a credit note on a matched liability',t=>{
  const w=world(t),{db,users}=w;
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  assert.equal(caught(()=>w.giveBack(p,[[0,1]],'RMA-0')).code,'nothing_received');
  p=w.receive(p,[[0,10]],'REC-1');
  assert.equal(p.status,'received');
  assert.ok(w.read(p,'manager').allowed_actions.includes('record_return'),'a reviewer sees the return action');
  assert.equal(w.read(p,'employee').allowed_actions.includes('record_return'),false,'the requester does not');
  p=w.invoice(p,[[0,6,'600.00']],'INV-A');
  p=w.match(p,'INV-A');
  p=w.invoice(p,[[0,4,'400.00']],'INV-B');
  assert.equal(w.invoiceOf(p,'INV-B').state,'ready');
  // ثلاث وحدات ترجع: المطابَق (6) ما زال مغطى بالمتبقي (7)، والفاتورة الثانية صارت تفوتر ثلاث وحدات راجعة
  p=w.giveBack(p,[[0,3]],'RMA-1');
  assert.deepEqual(w.invoiceOf(p,'INV-B').variance.lines.map(l=>[l.quantity_variance,l.expected_credit_minor]),[[3,30000]]);
  assert.equal(w.invoiceOf(p,'INV-B').state,'held');
  assert.equal(w.payableOf(p,'INV-A').credit_requests.length,0);
  assert.equal(caught(()=>w.giveBack(p,[[0,1]],'rma-1')).code,'duplicate_return');
  // أربع أخرى: المطابَق صار أكثر من المتبقي بثلاث — يُطلب إشعار دائن بها على المستحق القائم
  p=w.giveBack(p,[[0,4]],'RMA-2');
  assert.deepEqual(w.payableOf(p,'INV-A').credit_requests.map(r=>[r.source,r.amount_minor,r.lines.map(l=>l.quantity)]),[['return',30000,[3]]]);
  assert.deepEqual(w.invoiceOf(p,'INV-B').variance.lines.map(l=>l.quantity_variance),[4],'the unmatched invoice now bills four goods that are gone');
  assert.equal(caught(()=>w.giveBack(p,[[0,4]],'RMA-3')).code,'return_exceeds_received');
  // في القاعدة: صاحب الطلب لا يسجّل مرتجعًا، ولا يتجاوز مجموع المرتجع المستلم
  const ret=db.prepare('SELECT * FROM procurement_returns WHERE purchase_id=? LIMIT 1').get(p.id);
  assert.throws(()=>db.prepare('INSERT INTO procurement_returns(id,tenant_id,purchase_id,reference,quantity,reason,evidence,recorded_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t',p.id,'RAW-1',1,REASON,EVIDENCE,'employee',p.version,now()),/return is recorded/);
  // سطر مرتجع يتجاوز الباقي من المستلم (3 من 10) على رأس مرتجع جديد: القادح يرفضه ولو تخطى الكود.
  const raw=randomUUID();
  db.prepare('INSERT INTO procurement_returns(id,tenant_id,purchase_id,reference,quantity,reason,evidence,recorded_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(raw,'36t',p.id,'RAW-2',4,REASON,EVIDENCE,'manager',p.version,now());
  assert.throws(()=>db.prepare('INSERT INTO procurement_return_lines(id,return_id,purchase_id,order_line_id,quantity,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),raw,p.id,w.lineOf(p).id,4,now()),/more than was received/);
  assert.throws(()=>db.exec("UPDATE procurement_returns SET reason='سبب معدل بصمت بعد التسجيل'"),/kept as recorded/);
  assert.throws(()=>db.exec('DELETE FROM procurement_return_lines'),/kept as recorded/);
  assert.equal(p.history.at(-1).action,'record_return');
  assert.ok(verifyAudit(db));
});

/* ───── 3) الفاتورة الموقوفة والقرار ───── */
test('held invoices: a variance is never auto-accepted; an independent approver accepts only within an adopted tolerance or with a finance override, asks for a credit note, or rejects',t=>{
  const w=world(t),{db,users,day}=w;
  const draft=adopted(db,'36t',TOLERANCE);
  assert.deepEqual([draft.source,draft.value],['code_default',{percent:null,amount:null}],'the tolerance is an owner value registered without a number');
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  p=w.receive(p,[[0,10]],'REC-1');
  p=w.invoice(p,[[0,5,'502.00']],'INV-1');
  assert.equal(w.invoiceOf(p,'INV-1').state,'held');
  let refused=caught(()=>w.decide('pm-rev',p,'INV-1','accept'));
  assert.equal(refused.code,'variance_override_required');
  assert.ok(refused.details.refusal.missing.some(m=>m.document.includes(TOLERANCE)),'the refusal names the owner decision that is missing');
  assert.equal(caught(()=>w.decide('manager',p,'INV-1','accept')).code,'variance_override_required','a finance approver writes the reason');
  assert.equal(caught(()=>w.decide('outsider',p,'INV-1','accept',{override_reason:'قصير'})).code,'invalid_text');
  p=w.decide('manager',p,'INV-1','accept',{override_reason:'السعر الجديد معتمد في ملحق العقد المصطنع رقم 7 بتاريخ اليوم'});
  assert.deepEqual([w.invoiceOf(p,'INV-1').decision.basis,w.invoiceOf(p,'INV-1').state],['finance_override','decided']);
  assert.equal(caught(()=>w.decide('outsider',p,'INV-1','reject')).code,'already_decided');
  // حد معتمد بشخصين: الفاتورة تبقى موقوفة، ويقبلها معتمد مستقل ضمن الحد بلا مبرر مالي
  w.adopt({percent:'5.00',amount:'50.00'});
  p=w.invoice(w.read(p),[[0,5,'503.00']],'INV-2');
  assert.equal(w.invoiceOf(p,'INV-2').state,'held','an adopted tolerance still holds the invoice for an explicit decision');
  p=w.decide('pm-rev',p,'INV-2','accept');
  assert.equal(w.invoiceOf(p,'INV-2').decision.basis,'within_tolerance');
  p=w.match(w.match(p,'INV-1'),'INV-2');
  assert.deepEqual(p.payables.map(x=>x.amount_minor).sort(),[50200,50300]);
  const b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor],[0,100500],'an accepted variance consumes the budget above the order price');
  // خارج الحد، أو فرق كمية: بمبرر مالي فقط. والرفض يُميت الفاتورة ويحرر كمياتها لبديل صحيح
  let q=w.ordered([['وحدات طباعة مصطنعة',4,10000]]);
  q=w.receive(q,[[0,4]],'REC-Q');
  q=w.invoice(q,[[0,4,'360.00']],'INV-Q1');
  assert.equal(caught(()=>w.decide('pm-rev',q,'INV-Q1','accept')).code,'variance_override_required','a 10% gap is beyond the adopted 5%, even in our favour');
  assert.equal(caught(()=>w.decide('pm-rev',q,'INV-Q1','credit_note',{})).code,'nothing_to_credit');
  q=w.decide('pm-rev',q,'INV-Q1','reject');
  assert.equal(w.invoiceOf(q,'INV-Q1').state,'rejected');
  assert.equal(caught(()=>w.match(q,'INV-Q1')).code,'invoice_not_live');
  q=w.invoice(q,[[0,4,'400.00']],'INV-Q2');
  assert.equal(w.invoiceOf(q,'INV-Q2').state,'ready','the rejected invoice freed its quantities');
  // القرار يغطي ما رآه فقط: فرق كمية جديد يعيد الإيقاف
  let r=w.ordered([['وحدات طباعة مصطنعة',6,10000]]);
  r=w.receive(r,[[0,6]],'REC-R');
  r=w.invoice(r,[[0,6,'606.00']],'INV-R');
  r=w.decide('pm-rev',r,'INV-R','accept');
  assert.equal(w.invoiceOf(r,'INV-R').state,'decided');
  r=w.giveBack(r,[[0,2]],'RMA-R');
  assert.equal(w.invoiceOf(r,'INV-R').state,'held','a return after the decision is a new variance');
  assert.equal(caught(()=>w.decide('pm-rev',r,'INV-R','accept')).code,'variance_override_required','a quantity variance is never inside a price tolerance');
  // في القاعدة: مستحق على فاتورة موقوفة بلا قرار يُرفض
  let s=w.ordered([['وحدات طباعة مصطنعة',2,10000]]);
  s=w.invoice(w.receive(s,[[0,2]],'REC-S'),[[0,2,'250.00']],'INV-S');
  assert.throws(()=>db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),s.id,w.invoiceOf(s,'INV-S').id,25000,'SAR','manager','إدراج مباشر لفاتورة موقوفة',s.version,now()),/three way match/);
  assert.throws(()=>db.prepare('INSERT INTO procurement_invoice_decisions(id,tenant_id,purchase_id,invoice_id,sequence,decision,basis,price_variance_minor,quantity_variance,expected_credit_minor,tolerance_json,note,override_reason,decided_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t',s.id,w.invoiceOf(s,'INV-S').id,1,'reject','reject',5000,0,5000,'{}','قرار مباشر من مسجّل الفاتورة',null,'employee',s.version,now()),/independent/);
  assert.ok(verifyAudit(db));
});

/* ───── 4) إشعارات المورد والحجز ───── */
test('supplier notes: credit and debit notes go through the payments API, a credit note answers its request and never exceeds it, and the disputed amount is held back from payment until the note is approved or the request is waived',t=>{
  const w=world(t),{db,users,tx}=w;
  let p=w.ordered([['وحدات طباعة مصطنعة',5,10000]]);
  p=w.receive(p,[[0,5]],'REC-1');
  p=w.invoice(p,[[0,5,'520.00']],'INV-1');
  p=w.match(w.decide('manager',p,'INV-1','credit_note'),'INV-1');
  let payable=w.payableOf(p,'INV-1');
  const request=payable.credit_requests[0];
  assert.deepEqual([request.amount_minor,payable.withheld_minor],[2000,2000]);
  // الحجز في القاعدة: ما يُدفع إلا غير المتنازع عليه
  assert.throws(()=>tx(()=>payables.preparePayment(db,users.employee,{payable_id:payable.id,amount:'500.01'})),e=>e.code==='payment_withheld');
  w.pay(payable.id,'500.00');
  // الإشعار: إعداد مالي مطلوب (واجهة المدفوعات نفسها تفرضه)
  assert.equal(caught(()=>w.note('pm-rev',p,{payable_id:payable.id,request_id:request.id,kind:'credit',amount:'20.00',reference:'CN-X'})).code,'payables_access_denied');
  assert.equal(caught(()=>w.note('employee',p,{payable_id:payable.id,request_id:request.id,kind:'debit',amount:'20.00',reference:'CN-X'})).code,'note_kind');
  const cn=w.note('manager',p,{payable_id:payable.id,request_id:request.id,kind:'credit',amount:'20.00',vat:'2.61',reference:'CN-1'});
  assert.equal(caught(()=>w.note('employee',p,{payable_id:payable.id,request_id:request.id,kind:'credit',amount:'0.01',reference:'CN-9'})).code,'credit_exceeds_request','a pending note already answers the whole request');
  assert.equal(caught(()=>w.decideNote('manager',cn.id)).code,'self_approval','who recorded the note does not approve it');
  w.decideNote('outsider',cn.id);
  payable=w.payableOf(w.read(p),'INV-1');
  assert.deepEqual([payable.adjusted_minor,payable.paid_minor,payable.withheld_minor,payable.payable_now_minor],[50000,50000,0,0]);
  // إشعار مدين من المورد: يزيد الالتزام والاستهلاك، ويعتمده زميل ثانٍ
  const dn=w.note('employee',p,{payable_id:payable.id,kind:'debit',amount:'11.50',vat:'1.50',reference:'DN-1'});
  assert.equal(payables.getAdjustment(db,users.manager,dn.id).source_kind,'procurement_note');
  w.decideNote('manager',dn.id);
  assert.equal(w.budgetState().consumed_minor,50000+1150);
  // التنازل عن الإشعار: معتمد مالي غير من أنشأ الطلب، بمبرر مكتوب
  let q=w.ordered([['وحدات طباعة مصطنعة',2,10000]]);
  q=w.match(w.decide('manager',w.invoice(w.receive(q,[[0,2]],'REC-Q'),[[0,2,'230.00']],'INV-Q'),'INV-Q','credit_note'),'INV-Q');
  const qreq=w.payableOf(q,'INV-Q').credit_requests[0];
  assert.equal(caught(()=>w.ex('manager',q,'waive_credit',{request_id:qreq.id,reason:'المورد رفض الإشعار والفرق مقبول بعد التفاوض'})).code,'separation_of_duties');
  assert.equal(caught(()=>w.ex('pm-rev',q,'waive_credit',{request_id:qreq.id,reason:'المورد رفض الإشعار والفرق مقبول بعد التفاوض'})).code,'not_permitted');
  q=w.read(w.ex('outsider',q,'waive_credit',{request_id:qreq.id,reason:'المورد رفض الإشعار والفرق مقبول بعد التفاوض'}));
  assert.deepEqual([w.payableOf(q,'INV-Q').withheld_minor,w.payableOf(q,'INV-Q').credit_requests[0].waived],[0,true]);
  w.pay(w.payableOf(q,'INV-Q').id);
  // في القاعدة: إشعار بمصدر «procurement_credit» لا يُربط إلا بطلب على المستحق نفسه
  assert.throws(()=>db.prepare("INSERT INTO payable_adjustments(id,tenant_id,payable_id,kind,amount_minor,vat_minor,reference,reason,evidence,source_kind,source_id,status,recorded_by,created_at) VALUES(?,?,?,'credit',100,0,'RAW-CN','إدراج مباشر لإشعار مصطنع','مرجع مصطنع للاختبار','procurement_credit','no-such-request','pending','employee',?)")
    .run(randomUUID(),'36t',payable.id,now()),/credit request/);
  assert.ok(verifyAudit(db));
});

/* ───── 5) الإلغاء ───── */
test('void: an unpaid invoice or payable is voided by a separate append-only record with its reason and an independent approver, refused once a payment is in flight or executed, and releases its consumption',t=>{
  const w=world(t),{db,users,tx}=w;
  let p=w.ordered([['وحدات طباعة مصطنعة',6,10000]]);
  p=w.receive(p,[[0,6]],'REC-1');
  // فاتورة غير مطابقة: يطلب إلغاءها من في النطاق، ويعتمده مراجع مستقل
  p=w.invoice(p,[[0,2,'200.00']],'INV-DUP');
  p=w.proposeVoid('employee',p,'INV-DUP');
  const pending=p.voids.find(v=>v.state==='pending');
  assert.ok(pending);
  assert.equal(caught(()=>w.proposeVoid('manager',p,'INV-DUP')).code,'void_pending');
  // طلب الإلغاء المعلّق يوقف المطابقة — في الكود وفي القاعدة — فلا يُعتمد إلغاءٌ بعد مطابقةٍ لم يرها.
  assert.equal(caught(()=>w.match(p,'INV-DUP')).code,'void_pending');
  assert.throws(()=>db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),p.id,w.invoiceOf(p,'INV-DUP').id,20000,'SAR','manager','إدراج مباشر وطلب الإلغاء معلّق',p.version,now()),/three way match/);
  assert.equal(caught(()=>w.decideVoid('employee',p,pending.id)).code,'separation_of_duties');
  assert.throws(()=>db.prepare("INSERT INTO procurement_void_decisions(void_id,tenant_id,decision,note,adjustment_id,decided_by,purchase_version,created_at) VALUES(?,?,'rejected','قرار من طالب الإلغاء نفسه',NULL,'employee',1,?)").run(pending.id,'36t',now()),/independent/);
  p=w.decideVoid('pm-rev',p,pending.id);
  assert.equal(w.invoiceOf(p,'INV-DUP').state,'voided');
  assert.equal(caught(()=>w.match(p,'INV-DUP')).code,'invoice_not_live');
  // مستحق مطابق غير مدفوع: الطلب والقرار ماليان
  p=w.match(w.invoice(p,[[0,6,'600.00']],'INV-1'),'INV-1');
  let payable=w.payableOf(p,'INV-1');
  assert.equal(w.budgetState().consumed_minor,60000);
  assert.equal(caught(()=>w.proposeVoid('pm-rev',p,'INV-1')).code,'void_requires_finance');
  // دفع في الطريق يمنع الطلب، ويُفتح بإلغاء الأمر
  const inFlight=tx(()=>payables.preparePayment(db,users.employee,{payable_id:payable.id,amount:'10.00'})).id;
  assert.equal(caught(()=>w.proposeVoid('employee',p,'INV-1')).code,'payment_in_flight');
  tx(()=>payables.paymentAction(db,users.employee,inFlight,'cancel_order',{version:payables.getOrder(db,users.employee,inFlight).version,note:'إلغاء أمر مصطنع قبل طلب الإلغاء'}));
  p=w.proposeVoid('employee',w.read(p),'INV-1');
  const request=p.voids.find(v=>v.state==='pending');
  // طلب الإلغاء المعلّق يوقف الدفع في القاعدة
  assert.throws(()=>tx(()=>payables.preparePayment(db,users.employee,{payable_id:payable.id,amount:'10.00'})),e=>e.code==='void_pending');
  assert.equal(caught(()=>w.decideVoid('pm-rev',p,request.id)).code,'void_requires_finance_approver');
  assert.equal(caught(()=>w.decideVoid('manager',p,request.id)).code,'separation_of_duties','the matcher does not void what he matched');
  p=w.decideVoid('outsider',p,request.id);
  payable=w.payableOf(w.read(p),'INV-1');
  assert.deepEqual([payable.voided,payable.payment_status,payable.outstanding_minor],[true,'settled',0]);
  const adjustment=db.prepare("SELECT * FROM payable_adjustments WHERE source_kind='procurement_void' AND source_id=?").get(request.id);
  assert.deepEqual([adjustment.kind,adjustment.amount_minor,adjustment.status,adjustment.recorded_by,adjustment.decided_by],['credit',60000,'approved','employee','outsider']);
  assert.equal(caught(()=>w.decideVoid('outsider',w.read(p),request.id)).code,'void_decided');
  assert.equal(caught(()=>w.proposeVoid('employee',w.read(p),'INV-1')).code,'invoice_not_live');
  assert.throws(()=>tx(()=>payables.preparePayment(db,users.employee,{payable_id:payable.id})),e=>e.code==='payable_settled');
  // الاستهلاك رجع، والالتزام رجع للبضاعة التي ما زالت تنتظر فاتورة صحيحة
  let b=w.budgetState();
  assert.deepEqual([b.consumed_minor,b.committed_minor],[0,60000]);
  p=w.match(w.invoice(w.read(p),[[0,6,'600.00']],'INV-2'),'INV-2');
  b=w.budgetState();
  assert.deepEqual([b.consumed_minor,b.committed_minor],[60000,0]);
  // بعد دفع منفّذ: لا إلغاء
  w.pay(w.payableOf(p,'INV-2').id,'1.00');
  assert.equal(caught(()=>w.proposeVoid('employee',w.read(p),'INV-2')).code,'payment_executed');
  // في القاعدة: القرار لا يأخذه طالب الإلغاء، والسجلان لا يُعدَّلان ولا يُحذفان
  // إلغاء مستحق ينتظر إشعارًا دائنًا: الإلغاء سوّاه كله، فطلبه مقفل بلا محجوز، والاستهلاك صفر.
  let r=w.ordered([['وحدات طباعة مصطنعة',2,10000]]);
  r=w.match(w.decide('manager',w.invoice(w.receive(r,[[0,2]],'REC-R'),[[0,2,'230.00']],'INV-R'),'INV-R','credit_note'),'INV-R');
  assert.equal(w.payableOf(r,'INV-R').credit_requests[0].outstanding_minor,3000);
  r=w.proposeVoid('employee',r,'INV-R');
  r=w.read(w.decideVoid('outsider',r,r.voids.find(v=>v.state==='pending').id));
  assert.deepEqual(w.payableOf(r,'INV-R').credit_requests.map(x=>[x.outstanding_minor,x.open_minor,x.payable_voided,x.actions]),[[0,0,true,[]]]);
  assert.deepEqual([w.payableOf(r,'INV-R').withheld_minor,r.commitment.consumed_minor],[0,0]);
  assert.throws(()=>db.exec("UPDATE procurement_voids SET reason='سبب معدل بعد الطلب بصمت'"),/kept as recorded/);
  assert.throws(()=>db.exec('DELETE FROM procurement_void_decisions'),/kept as recorded/);
  assert.ok(verifyAudit(db));
});

/* ───── 6) الالتزام ───── */
test('commitments: consumed at match, released on close_short, and the budget figures stay true (committed + consumed + released = the order, available = cap − used)',t=>{
  const w=world(t),{db,users,tx}=w;
  const before=w.budgetState();
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  let b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor,b.available_minor],[100000,0,0,before.available_minor-100000]);
  p=w.receive(p,[[0,6]],'REC-1');
  p=w.invoice(p,[[0,8,'800.00']],'INV-8');
  assert.equal(w.invoiceOf(p,'INV-8').state,'awaiting_receipt','two billed units are still expected, so the invoice waits — it is not a variance');
  assert.equal(caught(()=>w.match(p,'INV-8')).code,'three_way_mismatch');
  // الإقفال على المستلم: ما لن يصل يتحرر، والفاتورة التي فوترته صارت فرق كمية
  const close=tx(()=>requestOrderChange(db,users.employee,p.id,{kind:'close_short',new_delivery_date:'',new_terms:'',reason:'توقف المورد عن التوريد ولن يصل الباقي',supplier_confirmation:'خطاب المورد المصطنع رقم 9'})).id;
  tx(()=>decideOrderChange(db,users.manager,close,'approve',{note:'نقفل على المستلم ونطلب إشعارًا بالفرق'}));
  p=w.read(p);
  b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor],[60000,0,40000],'close_short releases what will never arrive');
  assert.equal(b.available_minor,before.available_minor-60000);
  const released=db.prepare("SELECT after_json FROM audit_events WHERE entity_type='project_budget' AND action='release_purchase_commitment' ORDER BY seq DESC LIMIT 1").get();
  assert.equal(JSON.parse(released.after_json).released_minor,40000);
  assert.equal(w.invoiceOf(p,'INV-8').state,'held');
  assert.deepEqual(w.invoiceOf(p,'INV-8').variance.lines.map(l=>[l.quantity_variance,l.expected_credit_minor]),[[2,20000]]);
  p=w.match(w.decide('manager',p,'INV-8','credit_note'),'INV-8');
  b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor],[0,80000,40000],'consumed at the billed amount until the credit note arrives');
  const request=w.payableOf(p,'INV-8').credit_requests[0];
  assert.deepEqual([request.amount_minor,request.lines[0].quantity],[20000,2]);
  w.decideNote('outsider',w.note('employee',p,{payable_id:w.payableOf(p,'INV-8').id,request_id:request.id,kind:'credit',amount:'200.00',reference:'CN-8'}).id);
  b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor,b.used_minor],[0,60000,40000,60000]);
  assert.equal(b.committed_minor+b.consumed_minor+b.released_minor,100000);
  assert.ok(verifyAudit(db));
});

/* ───── 7) الدفتر ───── */
test('ledger: payable_adjustment builds per cost centre from the payable split, controls payable and input VAT, and a return + credit note + void sequence keeps both control accounts at zero difference',t=>{
  const w=world(t),{db,users,tx,day}=w;
  const kind=sourceKind('payable_adjustment');
  assert.ok(kind&&kind.module==='procurement'&&kind.controls.payable&&kind.controls.input_vat,'the kind is registered from the procurement module');
  assert.ok(sourceLinks('supplier_invoice','reversal').some(l=>l.module==='procurement'));
  // مستحق على مركزين (مخصصان للبند نفسه)، وضريبته متحقَّق منها، وإلغاؤه يعكس قيده حرفًا بحرف لكل مركز
  const split=w.matchedPayable({gross:'1150.00',split:[['CC-A',69000],['CC-B',46000]]});
  w.inputTax(split.invoice.id,'150.00');
  const invoiceJournal=w.post(w.journal('supplier_invoice',split.payable.id));
  let sp=w.read(split.purchase);
  sp=w.proposeVoid('employee',sp,split.invoice.supplier_reference);
  sp=w.decideVoid('outsider',sp,sp.voids.find(v=>v.state==='pending').id);
  const voidAdjustment=db.prepare("SELECT * FROM payable_adjustments WHERE source_kind='procurement_void' AND payable_id=?").get(split.payable.id);
  assert.deepEqual([voidAdjustment.amount_minor,voidAdjustment.vat_minor],[115000,15000]);
  const voidJournal=w.post(w.journal('payable_adjustment',voidAdjustment.id));
  const lines=j=>db.prepare('SELECT a.code,c.code AS centre,l.debit_minor,l.credit_minor FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY a.code,c.code').all(j.id);
  assert.deepEqual(lines(voidJournal).map(l=>[l.code,l.centre,l.credit_minor,l.debit_minor]),lines(invoiceJournal).map(l=>[l.code,l.centre,l.debit_minor,l.credit_minor]),'a full void mirrors the invoice journal per account and cost centre');
  // مرتجع بعد المطابقة ← إشعار دائن ← إلغاء الباقي، والقيود مرحّلة
  let p=w.ordered([['وحدات طباعة مصطنعة',5,10000]]);
  p=w.match(w.invoice(w.receive(p,[[0,5]],'REC-L1'),[[0,5,'500.00']],'INV-L1'),'INV-L1');
  const payable=w.payableOf(p,'INV-L1');
  w.inputTax(w.invoiceOf(p,'INV-L1').id,'65.22');
  w.post(w.journal('supplier_invoice',payable.id));
  p=w.giveBack(p,[[0,2]],'RMA-L1');
  const request=w.payableOf(p,'INV-L1').credit_requests[0];
  assert.deepEqual([request.source,request.amount_minor],['return',20000]);
  const cn=w.note('employee',p,{payable_id:payable.id,request_id:request.id,kind:'credit',amount:'200.00',vat:'26.09',reference:'CN-L1'});
  w.decideNote('outsider',cn.id);
  w.post(w.journal('payable_adjustment',cn.id));
  p=w.proposeVoid('employee',w.read(p),'INV-L1');
  p=w.decideVoid('outsider',p,p.voids.find(v=>v.state==='pending').id);
  const rest=db.prepare("SELECT * FROM payable_adjustments WHERE source_kind='procurement_void' AND payable_id=?").get(payable.id);
  assert.deepEqual([rest.amount_minor,rest.vat_minor],[30000,6522-2609],'the void takes what is left, VAT included');
  w.post(w.journal('payable_adjustment',rest.id));
  for(const key of ['payable','input_vat']){const c=controlOf(db,day,key);assert.equal(c.difference_minor,0,key);assert.equal(c.balanced,true,key);}
  assert.equal(controlOf(db,day,'payable').ledger_minor,0);
  assert.equal(controlOf(db,day,'input_vat').ledger_minor,0);
  const tb=trialBalance(db);assert.equal(tb.d,tb.c);
  // المستند قبل اعتماده لا يُقيَّد، ومعرّف غريب لا يُبنى
  let q=w.ordered([['وحدات طباعة مصطنعة',1,10000]]);
  q=w.match(w.invoice(w.receive(q,[[0,1]],'REC-LQ'),[[0,1,'100.00']],'INV-LQ'),'INV-LQ');
  const pendingNote=w.note('employee',q,{payable_id:w.payableOf(q,'INV-LQ').id,kind:'debit',amount:'1.00',reference:'DN-LP'});
  assert.equal(kind.build(db,users.employee,pendingNote.id),null);
  assert.equal(kind.build(db,users.employee,'no-such-adjustment'),null);
  assert.ok(verifyAudit(db));
});

/* ───── 8) عزل الكيانات ───── */
test('tenant isolation: another tenant sees no exception, cannot act on one, and the ledger kind lists nothing for it',t=>{
  const w=world(t),{db,users}=w;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES('iso-admin','isolated','other','iso-admin','مسؤول الكيان المعزول','unused','manager')").run();
  for(const action of ['read','prepare','approve'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'isolated','external','employee',action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','iso-admin','تفويض الكيان المعزول',null,now());
  const external=db.prepare("SELECT * FROM users WHERE id='external'").get();
  let p=w.ordered([['وحدات طباعة مصطنعة',3,10000]]);
  p=w.match(w.decide('manager',w.invoice(w.receive(p,[[0,3]],'REC-1'),[[0,3,'330.00']],'INV-1'),'INV-1','credit_note'),'INV-1');
  const payable=w.payableOf(p,'INV-1');
  for(const [action,input] of [['record_return',{reference:'X',reason:REASON,evidence:EVIDENCE,lines:[]}],['propose_void',{invoice_id:w.invoiceOf(p,'INV-1').id,reason:'محاولة من كيان آخر للاختبار فقط',evidence:'مرجع مصطنع'}],['waive_credit',{request_id:payable.credit_requests[0].id,reason:'محاولة من كيان آخر للاختبار فقط'}]])
    assert.equal(caught(()=>transaction(db,()=>exceptions.exceptionAction(db,external,p.id,action,{version:p.version,...input}))).code,'not_found',action);
  assert.equal(caught(()=>transaction(db,()=>exceptions.recordSupplierNote(db,external,p.id,{payable_id:payable.id,kind:'credit',amount:'1.00',reference:'CN-X',reason:'محاولة من كيان آخر للاختبار',evidence:'مرجع مصطنع من كيان آخر'}))).code,'not_found');
  assert.deepEqual(procurementExtras(db,external).exceptions,[]);
  assert.deepEqual(sourceKind('payable_adjustment').pending(db,'isolated'),[]);
  assert.ok(procurementExtras(db,users.outsider).exceptions.length>0,'a finance approver outside the project sees the credit request of his own tenant');
  assert.ok(verifyAudit(db));
});

/* ───── 9) الواجهة ───── */
test('UI: the award button follows the server — three quotes or an approved emergency — and the exception panels escape supplier text and post to the exception routes',t=>{
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ctx={e,button:(a,id,l)=>`<button data-op="${e(a)}" data-id="${e(id)}">${e(l)}</button>`,money:m=>String(m)};
  const base={id:'p1',version:3,status:'sourcing',title:'t',specification:'s',cost_center:'C',due_date:'2099-01-01',budget_minor:1,budget_evidence:'e',lines:[],receipts:[],returns:[],invoices:[],payables:[],voids:[],history:[],allowed_actions:['award','reject'],project_id:'x'};
  const html=purchase=>procurementUI.render({purchases:[purchase],projects:[],user:{id:'m',role:'manager'}},ctx);
  const quotes=n=>Array.from({length:n},(_,i)=>({id:'q'+i,supplier_name:'مورد',supplier_key:'K'+i,total_minor:1,lines:[],technical_assessment:'a',financial_terms:'f',delivery_date:'2099-01-01',evidence:'e'}));
  assert.equal(html({...base,quotes:quotes(2)}).includes('data-op="award"'),false,'two quotes: the server refuses, so the screen does not offer it');
  assert.equal(html({...base,quotes:quotes(3)}).includes('data-op="award"'),true);
  assert.equal(html({...base,quotes:quotes(1),emergency:{status:'approved'}}).includes('data-op="award"'),true,'an approved emergency award on one quote is reachable');
  assert.equal(html({...base,quotes:quotes(1),emergency:{status:'pending'}}).includes('data-op="award"'),false);
  // لوحة الاستثناءات: فاتورة موقوفة بنص مورد عدائي
  const w=world(t);
  let p=w.ordered([['<img src=x onerror=alert(1)>',3,10000]]);
  p=w.invoice(w.receive(p,[[0,3]],'REC-1'),[[0,3,'330.00']],'<svg onload=alert(1)>');
  const data={purchases:[w.read(p)],projects:[],user:w.users.manager};
  const out=procurementUI.render(data,ctx);
  assert.ok(!/<img src=x/i.test(out)&&!/<svg onload/i.test(out)&&/&lt;svg/i.test(out));
  assert.ok(out.includes('data-op="decide_invoice"'),'the independent reviewer sees the decision on the held invoice');
  const invoiceId=data.purchases[0].invoices[0].id;
  const form=procurementUI.form('decide_invoice',invoiceId,data);
  assert.equal(form.endpoint,`/procurement/${p.id}/decide_invoice`);
  assert.equal(form.toPayload({decision:'credit_note',note:'x'}).invoice_id,invoiceId);
  assert.equal(form.toPayload({decision:'credit_note',note:'x'}).version,data.purchases[0].version);
  const back=procurementUI.form('record_return',p.id,data);
  assert.equal(back.endpoint,`/procurement/${p.id}/record_return`);
  assert.equal(back.fields.find(f=>f.name==='lines').type,'rows');
  const extras=procurementExtrasUI.render({...procurementExtras(w.db,w.users.outsider),purchases:[]},ctx);
  assert.ok(/&lt;svg/i.test(extras)&&!/<svg onload/i.test(extras),'the finance board renders the held invoice, escaped');
});

/* ───── 10) حالة السداد من payable_balances ───── */
test('payableState reads payable_balances: two partial orders, a batch, an executed part, a bank return and a credit-settled payable report their true state, and «settled» has its name',t=>{
  const w=world(t),{db,users,tx,day}=w;
  assert.equal(PAYMENT_STATUS_NAMES.settled.length>0,true);
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  p=w.receive(p,[[0,10]],'REC-1');
  p=w.match(w.invoice(p,[[0,6,'600.00']],'INV-1'),'INV-1');
  p=w.match(w.invoice(p,[[0,4,'400.00']],'INV-2'),'INV-2');
  const one=w.payableOf(p,'INV-1'),two=w.payableOf(p,'INV-2');
  const first=tx(()=>payables.preparePayment(db,users.employee,{payable_id:one.id,amount:'100.00'})).id;
  tx(()=>payables.preparePayment(db,users.employee,{payable_id:one.id,amount:'200.00'}));
  let state=payableState(db,db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(one.id));
  assert.deepEqual([state.payment_status,state.in_flight_minor,state.paid_minor],['payment_pending',30000,0]);
  assert.equal(state.payment_orders.length,2);
  tx(()=>payables.paymentAction(db,users.manager,first,'approve_order',{version:payables.getOrder(db,users.manager,first).version,note:'اعتماد مصطنع لجزء أول'}));
  tx(()=>payables.paymentAction(db,users.treasurer,first,'record_execution',{version:payables.getOrder(db,users.treasurer,first).version,executed_on:day,bank_reference:'BNK-PART-1',evidence:'إشعار تحويل مصطنع محفوظ'}));
  state=payableState(db,db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(one.id));
  assert.deepEqual([state.payment_status,state.paid_minor],['partially_paid',10000],'an executed part is not «paid»');
  assert.equal(state.payment_status,payables.payableBalance(db,one.id).status);
  // دفعة واحدة لمستحقين: كل مستحق يرى سطره هو
  const batch=tx(()=>payables.preparePayment(db,users.employee,{lines:[{payable_id:one.id,amount:'50.00'},{payable_id:two.id,amount:'40.00'}]})).id;
  const second=payableState(db,db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(two.id));
  assert.deepEqual([second.payment_status,second.in_flight_minor,second.payment_order?.id],['payment_pending',4000,batch]);
  // مرتجع البنك يرجّع الرصيد
  tx(()=>payables.paymentAction(db,users.treasurer,first,'record_return',{version:payables.getOrder(db,users.treasurer,first).version,returned_on:day,bank_reference:'BNK-RET-1',credited:'100.00',reason:'رجع التحويل لخطأ في اسم المستفيد المصطنع',evidence:'إشعار إرجاع بنكي مصطنع محفوظ'}));
  state=payableState(db,db.prepare('SELECT * FROM procurement_payables WHERE id=?').get(one.id));
  assert.equal(state.paid_minor,0);assert.equal(state.returned_minor,10000);
  // مستحق سوّته الإشعارات كله: «settled» باسمها
  let q=w.ordered([['وحدات طباعة مصطنعة',1,10000]]);
  q=w.match(w.invoice(w.receive(q,[[0,1]],'REC-Q'),[[0,1,'100.00']],'INV-Q'),'INV-Q');
  const cn=tx(()=>payables.recordAdjustment(db,users.employee,{payable_id:w.payableOf(q,'INV-Q').id,kind:'credit',amount:'100.00',reference:'CN-ALL',reason:'المورد ألغى الخدمة بإشعار دائن كامل',evidence:'إشعار دائن مصطنع محفوظ'})).id;
  w.decideNote('outsider',cn);
  const settled=w.payableOf(w.read(q),'INV-Q');
  assert.deepEqual([settled.payment_status,settled.payment_status_name],['settled',PAYMENT_STATUS_NAMES.settled]);
  assert.equal(w.read(q).payment_status,'settled');
});

/* ───── 11) المسارات بلا منفذ ───── */
test('HTTP without a port: returns, decisions, voids and supplier notes go through the real handler; a replayed step is refused and a replayed create returns the same note',async t=>{
  const w=world(t),{db}=w;
  const app=createApp(db),sessions={};
  for(const username of ['employee','manager','outsider','pm-rev']){
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    assert.equal(r.status,200,r.text);
    sessions[username]={cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.json().csrf};
  }
  const call=async(who,path,body,key)=>{const s=sessions[who];
    const r=await dispatch(app,{method:body===undefined?'GET':'POST',path:'/api'+path,headers:{cookie:s.cookie,'x-csrf-token':s.csrf,...(key?{'idempotency-key':key}:{})},body});
    return {status:r.status,body:r.text?JSON.parse(r.text):null};};
  let p=w.receive(w.ordered([['وحدات طباعة مصطنعة',5,10000]]),[[0,5]],'REC-1');
  const line=w.lineOf(p).id;
  let r=await call('manager',`/procurement/${p.id}/record_return`,{version:p.version,reference:'RMA-H',reason:REASON,evidence:EVIDENCE,lines:[{order_line_id:line,quantity:1}]});
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal((await call('manager',`/procurement/${p.id}/record_return`,{version:p.version,reference:'RMA-H2',reason:REASON,evidence:EVIDENCE,lines:[{order_line_id:line,quantity:1}]})).status,409,'a replayed step is refused');
  p=w.read(p);
  r=await call('employee',`/procurement/${p.id}/record_invoice`,{version:p.version,supplier_reference:'INV-H',evidence:'فاتورة مورد مصطنعة',lines:[{order_line_id:line,quantity:4,amount:'420.00'}]});
  assert.equal(r.status,201,JSON.stringify(r.body));
  p=w.read(p);
  r=await call('pm-rev',`/procurement/${p.id}/decide_invoice`,{version:p.version,invoice_id:w.invoiceOf(p,'INV-H').id,decision:'accept',note:'فرق مقبول بعد التفاوض مع المورد'});
  assert.deepEqual([r.status,r.body.error.code],[409,'variance_override_required']);
  assert.ok(r.body.error.details.refusal,'the refusal travels in its structured form');
  r=await call('manager',`/procurement/${p.id}/decide_invoice`,{version:p.version,invoice_id:w.invoiceOf(p,'INV-H').id,decision:'credit_note',note:'نطلب إشعارًا دائنًا بفرق السعر'});
  assert.equal(r.status,201,JSON.stringify(r.body));
  p=w.read(p);
  r=await call('manager',`/procurement/${p.id}/match`,{version:p.version,invoice_id:w.invoiceOf(p,'INV-H').id,note:'طابقنا بعد قرار الفرق'});
  assert.equal(r.status,201,JSON.stringify(r.body));
  p=w.read(p);
  const payable=w.payableOf(p,'INV-H'),request=payable.credit_requests[0];
  const key=randomUUID(),input={payable_id:payable.id,request_id:request.id,kind:'credit',amount:'20.00',vat:'2.61',reference:'CN-H',reason:'إشعار المورد عن فرق السعر',evidence:'إشعار مصطنع محفوظ'};
  r=await call('employee',`/procurement/${p.id}/supplier-notes`,input,key);
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.source_kind,'procurement_credit');
  assert.equal((await call('employee',`/procurement/${p.id}/supplier-notes`,input,key)).body.id,r.body.id,'the same key returns the same note');
  assert.equal((await call('employee',`/procurement/${p.id}/supplier-notes`,{...input,amount:'19.00'},key)).status,409);
  assert.equal((await call('employee',`/procurement/${p.id}/supplier-notes`,input)).status,400,'a create without a key is refused');
  r=await call('outsider',`/payables/adjustments/${r.body.id}/approve`,{note:'طابقت الإشعار مع طلبه'});
  assert.equal(r.status,201,JSON.stringify(r.body));
  const board=await call('outsider','/procurement-extras');
  assert.equal(board.status,200);
  assert.ok(Array.isArray(board.body.exceptions));
  p=w.read(p);
  r=await call('employee',`/procurement/${p.id}/propose_void`,{version:p.version,invoice_id:w.invoiceOf(p,'INV-H').id,reason:'الفاتورة صدرت بالخطأ وسحبها المورد بخطاب',evidence:'خطاب سحب مصطنع'});
  assert.equal(r.status,201,JSON.stringify(r.body));
  p=w.read(p);
  r=await call('outsider',`/procurement/${p.id}/decide_void`,{version:p.version,void_id:p.voids[0].id,decision:'approve',note:'راجعت الخطاب والرصيد'});
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.ok(verifyAudit(db));
});

/* ───── 12) سباق عمليات على ملف واحد ───── */
function race(path,jobs){
  const startAt=Date.now()+2500;
  return Promise.all(jobs.map((job,index)=>new Promise(done=>{
    const child=spawn(process.execPath,[WORKER,path,String(startAt),JSON.stringify({...job,index})],{cwd:ROOT});
    let out='',err='';child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{err+=c;});
    child.on('close',()=>{try{done(JSON.parse(out.trim().split('\n').pop()));}catch{done({index,ok:false,error:'no output: '+err.slice(0,300)});}});
  })));
}
test('race: processes writing one database file at the same instant never over-return, never record two credit notes for one request, and never void twice',{timeout:240000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-procurement-race-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'race.sqlite');
  let ids;
  {
    const hold=[];const w=world({after:fn=>hold.push(fn)});
    let a=w.receive(w.ordered([['وحدات طباعة مصطنعة',5,10000]]),[[0,5]],'REC-A');
    let b=w.match(w.decide('manager',w.invoice(w.receive(w.ordered([['وحدات طباعة مصطنعة',5,10000]]),[[0,5]],'REC-B'),[[0,5,'550.00']],'INV-B'),'INV-B','credit_note'),'INV-B');
    let c=w.match(w.invoice(w.receive(w.ordered([['وحدات طباعة مصطنعة',2,10000]]),[[0,2]],'REC-C'),[[0,2,'200.00']],'INV-C'),'INV-C');
    c=w.proposeVoid('employee',c,'INV-C');
    let d=w.invoice(w.receive(w.ordered([['وحدات طباعة مصطنعة',2,10000]]),[[0,2]],'REC-D'),[[0,2,'200.00']],'INV-D');
    ids={a:a.id,line:w.lineOf(a).id,b:b.id,payable:w.payableOf(b,'INV-B').id,request:w.payableOf(b,'INV-B').credit_requests[0].id,c:c.id,void:c.voids[0].id,d:d.id,invoice:w.invoiceOf(d,'INV-D').id};
    w.db.exec(`VACUUM INTO '${path.replaceAll("'","''")}'`);
    for(const fn of hold)fn();
  }
  const keeper=openDb(path);t.after(()=>keeper.close());
  // (1) أربع عمليات ترجع وحدتين لكل واحدة من خمس مستلمة، وكل واحدة تقرأ النسخة داخل معاملتها: اثنتان فقط تتسعان
  const returned=await race(path,[1,2,3,4].map(i=>({action:'record_return',user:'manager',purchase_id:ids.a,version:'latest',input:{reference:`RMA-R${i}`,reason:REASON,evidence:EVIDENCE,lines:[{order_line_id:ids.line,quantity:2}]}})));
  assert.equal(returned.filter(r=>r.ok).length,2,JSON.stringify(returned));
  assert.deepEqual([...new Set(returned.filter(r=>!r.ok).map(r=>r.error))],['return_exceeds_received']);
  assert.equal(keeper.prepare('SELECT SUM(quantity) AS n FROM procurement_return_lines WHERE order_line_id=?').get(ids.line).n,4);
  // (2) ثلاث عمليات تسجّل إشعارًا دائنًا كاملًا للطلب نفسه بمراجع مختلفة: إشعار واحد
  const notes=await race(path,[1,2,3].map(i=>({action:'note',user:'employee',purchase_id:ids.b,input:{payable_id:ids.payable,request_id:ids.request,kind:'credit',amount:'50.00',reference:`CN-R${i}`,reason:'إشعار المورد عن فرق السعر',evidence:'إشعار مصطنع محفوظ'}})));
  assert.equal(notes.filter(r=>r.ok).length,1,JSON.stringify(notes));
  assert.deepEqual([...new Set(notes.filter(r=>!r.ok).map(r=>r.error))],['credit_exceeds_request']);
  // (3) ثلاث عمليات تعتمد الإلغاء نفسه: إلغاء واحد وتسوية واحدة
  const voids=await race(path,[1,2,3].map(()=>({action:'decide_void',user:'outsider',purchase_id:ids.c,version:'latest',input:{void_id:ids.void,decision:'approve',note:'راجعت خطاب المورد والرصيد'}})));
  assert.equal(voids.filter(r=>r.ok).length,1,JSON.stringify(voids));
  assert.deepEqual([...new Set(voids.filter(r=>!r.ok).map(r=>r.error))],['void_decided']);
  assert.equal(keeper.prepare("SELECT COUNT(*) AS n FROM payable_adjustments WHERE source_kind='procurement_void' AND source_id=?").get(ids.void).n,1);
  // (4) ثلاث عمليات تطلب إلغاء الفاتورة نفسها: طلب واحد
  const proposals=await race(path,[1,2,3].map(()=>({action:'propose_void',user:'employee',purchase_id:ids.d,version:'latest',input:{invoice_id:ids.invoice,reason:'الفاتورة صدرت بالخطأ وسحبها المورد بخطاب',evidence:'خطاب سحب مصطنع'}})));
  assert.equal(proposals.filter(r=>r.ok).length,1,JSON.stringify(proposals));
  assert.deepEqual([...new Set(proposals.filter(r=>!r.ok).map(r=>r.error))],['void_pending']);
  assert.equal(verifyAudit(keeper),true,'the audit chain did not fork under concurrent writers');
});

/* ───── 13) الترحيل 169 ───── */
test('migration 169: applies cleanly; the match guard keeps its independent-approval clauses; the new records keep their history',t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  assert.equal(db.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version=169').get()?.applied,1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  for(const table of ['procurement_returns','procurement_return_lines','procurement_invoice_decisions','procurement_invoice_decision_lines','procurement_credit_requests','procurement_credit_request_lines','procurement_credit_waivers','procurement_voids','procurement_void_decisions'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),table);
  const guard=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='procurement_match_guard'").all();
  assert.equal(guard.length,1);
  assert.match(guard[0].sql,/procurement_receipts r WHERE r\.purchase_id=p\.id AND r\.received_by=NEW\.matched_by/);
  assert.match(guard[0].sql,/NEW\.matched_by<>p\.requester_id AND NEW\.matched_by<>i\.recorded_by/);
  assert.match(guard[0].sql,/procurement_return_lines/,'net of returns');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='payment_order_lines_procurement_hold'").get());
});

/* ───── قائمة إقفال المشروع تقرأ حالات الترحيل 169 ───── */
// التزامات المورد في الإقفال المالي من وقائع الفاتورة لا من «هل لها مستحق»: المرفوضة والملغاة ليستا التزامًا، والموقوفة بندٌ عند معتمد
// قرارها، والإشعار الدائن المنتظر بندٌ حتى يصل أو يُتنازل عنه، والمتوقع فوترته ما استُلم ناقص ما رجع، وإشعار المورد المعتمد مستندٌ بقيده.
test('closure checklist: supplier liabilities read the invoice state, returns and awaited credit notes, and an approved supplier note is a document with its journal',t=>{
  const w=world(t),{db}=w;
  const list=()=>financialChecklist(db,db.prepare('SELECT * FROM projects WHERE id=?').get(w.project.id));
  const supplierItems=()=>list().find(l=>l.key==='supplier_liabilities').outstanding;
  const codes=()=>supplierItems().map(i=>i.code).sort();
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  p=w.receive(p,[[0,6]],'REC-1');
  p=w.giveBack(p,[[0,1]],'RMA-1');
  // فاتورة بفرق سعر: موقوفة — بندها عند معتمد القرار، لا «ما تطابقت»
  p=w.invoice(p,[[0,5,'525.00']],'INV-1');
  assert.equal(w.invoiceOf(p,'INV-1').state,'held');
  assert.deepEqual(codes(),['purchase_open','supplier_invoice_held']);
  // فاتورة مكررة تُلغى بقرار مستقل: تختفي من الالتزامات
  p=w.invoice(p,[[0,1,'100.00']],'INV-DUP');
  assert.ok(codes().includes('supplier_invoice_unmatched'),'a live unmatched invoice is a liability until voided');
  p=w.proposeVoid('employee',p,'INV-DUP');
  p=w.decideVoid('pm-rev',p,p.voids.find(v=>v.state==='pending').id);
  assert.equal(w.invoiceOf(p,'INV-DUP').state,'voided');
  assert.ok(!supplierItems().some(i=>i.ref===`supplier_invoice:${w.invoiceOf(p,'INV-DUP').id}`),'a voided invoice is not a liability');
  // القرار ثم المطابقة: الإشعار الدائن المنتظر بندٌ حتى يصل
  p=w.decide('manager',p,'INV-1','credit_note');
  p=w.match(p,'INV-1');
  const payable=w.payableOf(p,'INV-1');
  const awaited=supplierItems().find(i=>i.code==='credit_note_awaited');
  assert.ok(awaited&&/25\.00/.test(awaited.item),'the awaited credit note is named with its amount');
  const cn=w.note('employee',p,{payable_id:payable.id,request_id:payable.credit_requests[0].id,kind:'credit',amount:'25.00',vat:'3.26',reference:'CN-1'});
  w.decideNote('outsider',cn.id);
  assert.ok(!codes().includes('credit_note_awaited'),'answered by an approved credit note');
  // المعتمد إشعارٌ بقيد: بلا قيد مرحّل يبقى بندًا في سطر القيود
  const journals=list().find(l=>l.key==='journals').outstanding;
  assert.ok(journals.some(i=>i.ref===`journal:payable_adjustment:${cn.id}`&&/إشعار مورد معتمد/.test(i.item)),'the approved supplier note waits for its journal like any document');
  // المتوقع فوترته بعد المرتجع: استُلم 6 ورجع 1، فالخمسة المفوترة تكفي ولا «استلام بلا فاتورة»
  assert.ok(!codes().includes('receipt_not_invoiced'));
});

/* ───── تقريرا المخصصات من منظور المخصص الواحد ───── */
// R12 وR33 كانا يجمعان الحجوزات بحالتها: الأمر الملتزم يُعدّ كاملًا بعد أن استُهلك جزؤه بالمطابقة وتحرّر باقيه بالإقفال القصير
// (الترحيل 169)، وR33 يقرأ حالة 'approved' التي لا وجود لها فيرجع فارغًا. صارا يقرآن budgetUsage التي تقرؤها شاشة المخصصات.
test('budget reports: R12 and R33 show what the budget screen shows — committed shrinks with consumption at match and release at close_short',t=>{
  const w=world(t),{db,users}=w,range={from:'2026-01-01',to:'2026-12-31'};
  let p=w.ordered([['وحدات طباعة مصطنعة',10,10000]]);
  p=w.receive(p,[[0,6]],'REC-1');
  p=w.match(w.invoice(p,[[0,6,'600.00']],'INV-1'),'INV-1');
  const close=w.tx(()=>requestOrderChange(db,users.employee,p.id,{kind:'close_short',new_delivery_date:'',new_terms:'',reason:'توقف المورد عن التوريد ولن يصل الباقي',supplier_confirmation:'خطاب المورد المصطنع رقم 9'})).id;
  w.tx(()=>decideOrderChange(db,users.manager,close,'approve',{note:'نقفل على المستلم ونطلب إشعارًا بالفرق'}));
  const b=w.budgetState();
  assert.deepEqual([b.committed_minor,b.consumed_minor,b.released_minor],[0,60000,40000],'consumed at match, released at close_short');
  const r12=runReport(db,users.manager,'R12',range).rows.find(r=>r.cost_center===b.cost_center);
  assert.deepEqual([r12.committed,r12.consumed,r12.released,r12.remaining].map(Number),[0,600,400,(b.cap_minor-b.used_minor)/100]);
  const r33=runReport(db,users.manager,'R33',range).rows.find(r=>r.cost_center===b.cost_center);
  assert.ok(r33,'R33 lists the active budget (it read a status that does not exist)');
  assert.deepEqual([r33.used,r33.remaining].map(Number),[b.used_minor/100,(b.cap_minor-b.used_minor)/100]);
});

/* ───── طابور الاستثناءات المالية يقرأ حالة الفاتورة ───── */
// فرع «ما تطابقت» كان يعرض كل فاتورة بلا مستحق «فاتورة مورد موقوفة»: المرفوضة والملغاة واللي تنتظر البضاعة والجاهزة للمطابقة معها،
// وطلب الإلغاء المعلّق ما له مكان. صار يقرأ invoiceState كما تقرؤها المشتريات، وطلب الإلغاء «عكس ينتظر اعتماده» عند معتمده.
test('finance exceptions: only an undecided variance is a held invoice, and a pending void waits as a reversal with the person who decides it',t=>{
  const w=world(t),{db}=w;
  const board=()=>exceptionsBoard(db,w.users.manager).exceptions;
  const heldOf=(p,reference)=>board().find(x=>x.kind==='held_invoice'&&x.source_kind==='procurement_invoice'&&x.source_id===w.invoiceOf(p,reference).id);
  const voidRow=id=>board().find(x=>x.key===`reversal_awaiting_approval:procurement_void:${id}`);
  let p=w.ordered([['وحدات طباعة مصطنعة',20,10000]]);
  p=w.receive(p,[[0,10]],'REC-1');
  // فرق سعر ما انقرر: موقوفة، وتفاصيلها الفرق نفسه، وقرارها عند مراجع المطابقة في صندوق المشتريات فما تُعدّ مرة ثانية
  p=w.invoice(p,[[0,2,'210.00']],'INV-HELD');
  assert.equal(w.invoiceOf(p,'INV-HELD').state,'held');
  const held=heldOf(p,'INV-HELD');
  assert.ok(held,'the held invoice is listed');
  assert.match(held.detail,/فرق سعر \+10\.00/);
  assert.equal(held.owner_role,'procurement');
  assert.equal(held.inbox,false);
  // تنتظر البضاعة: 11 مفوترة بسعر الأمر و10 مستلمة — مجراها العادي، ما هي موقوفة
  p=w.invoice(p,[[0,11,'1100.00']],'INV-WAIT');
  assert.equal(w.invoiceOf(p,'INV-WAIT').state,'awaiting_receipt');
  assert.equal(heldOf(p,'INV-WAIT'),undefined,'an invoice awaiting its goods is not held');
  // مرفوضة بقرار: ما هي التزام، فتختفي
  p=w.invoice(p,[[0,1,'150.00']],'INV-REJ');
  assert.ok(heldOf(p,'INV-REJ'),'held before its decision');
  p=w.decide('manager',p,'INV-REJ','reject');
  assert.equal(w.invoiceOf(p,'INV-REJ').state,'rejected');
  assert.equal(heldOf(p,'INV-REJ'),undefined,'a rejected invoice is not held');
  // جاهزة للمطابقة: ما هي موقوفة. وطلب إلغائها عكسٌ ينتظر مراجعًا مستقلًا، ثم يختفي بالقرار
  p=w.invoice(p,[[0,1,'100.00']],'INV-READY');
  assert.equal(w.invoiceOf(p,'INV-READY').state,'ready');
  assert.equal(heldOf(p,'INV-READY'),undefined,'an invoice ready for matching is not held');
  p=w.proposeVoid('employee',p,'INV-READY');
  const invoiceVoid=p.voids.find(v=>v.state==='pending');
  const pending=voidRow(invoiceVoid.id);
  assert.ok(pending,'a pending invoice void is a reversal awaiting its decision');
  assert.equal(pending.kind,'reversal_awaiting_approval');
  assert.equal(pending.amount_minor,10000);
  assert.match(pending.title,/طلب إلغاء فاتورة المورد INV-READY/);
  assert.equal(pending.owner_role,'procurement');
  assert.equal(pending.inbox,false,'decide_void is already a decision in the procurement inbox');
  assert.equal(pending.link,'#procurement');
  p=w.decideVoid('pm-rev',p,invoiceVoid.id);
  assert.equal(w.invoiceOf(p,'INV-READY').state,'voided');
  assert.equal(voidRow(invoiceVoid.id),undefined,'decided, so no longer awaiting');
  assert.equal(heldOf(p,'INV-READY'),undefined,'a voided invoice is not held');
  // مستحق مطابق يُطلب إلغاؤه: يقرره معتمد مالي، ومبلغه رصيد المستحق
  p=w.invoice(p,[[0,2,'200.00']],'INV-M');
  p=w.match(p,'INV-M');
  p=w.proposeVoid('employee',p,'INV-M');
  const payableVoid=p.voids.find(v=>v.state==='pending');
  const onPayable=voidRow(payableVoid.id);
  assert.ok(onPayable,'a pending payable void is a reversal awaiting its decision');
  assert.match(onPayable.title,/طلب إلغاء مستحق المورد INV-M/);
  assert.equal(onPayable.amount_minor,20000);
  assert.equal(onPayable.owner_role,'finance');
  assert.deepEqual(onPayable.capability,{finance:'approve'});
  // والعدّ نفسه: الموقوفة من هذا الطلب واحدة فقط
  assert.deepEqual(board().filter(x=>x.kind==='held_invoice'&&x.source_kind==='procurement_invoice'&&p.invoices.some(i=>i.id===x.source_id)).map(x=>x.title),['فاتورة المورد INV-HELD']);
});
