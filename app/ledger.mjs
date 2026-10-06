import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { financeCapabilities, createSourcedJournal } from './finance.mjs';
import { verifiedInputVat } from './payables.mjs';
import { registerOptionList, optionsFor, requireOption, optionLabel, listsBoard } from './options.mjs';
import { refuse } from './refusal.mjs';
import { registerSourceKind, registerSourceLink, sourceKind, sourceKinds, sourceLinks } from './ledger-sources.mjs';
import { personName } from './people-read.mjs';
import { centerKey } from './cost-centres.mjs';
import { SOURCE_KINDS as BANK_MATCHABLE, bankMatchesForSource, UNMATCHED_REASONS } from './bank-reconciliation.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
// P4-HR-5: الشهر الموازي يدفعه النظام السابق (الترحيل 176). سطر واحد في كل مسار مال: app/payroll-parallel-guard.mjs.
import { assertPlatformPays, dropParallelMonths } from './payroll-parallel-guard.mjs';
// محاسبة الرواتب (الحزمة 4، P4-HR-3): سطور قيد المسير بمراكز الإدارات وأغراض الحسومات، وما يسترده المسير من السلف، ومراكز تكلفة
// الإدارات في شاشة الربط. الوحدة لا تستورد الدفتر، فلا دورة استيراد (انظر رأسها).
import { payrollRunEntry, runAdvanceRecovery, departmentCentresView, runReference } from './payroll-ledger.mjs';
// السجل نفسه يُعاد تصديره: من لا يقع في دورة استيراد مع الدفتر يسجّل نوعه من هنا (انظر رأس app/ledger-sources.mjs).
export { registerSourceKind, registerSourceLink, sourceKinds } from './ledger-sources.mjs';

// ربط المستندات بالدفتر والقوائم المالية. لا قيد آلي صامت: المنصة تقترح قيدًا من المستند،
// ويمر بالاعتماد والترحيل المستقلين. القوائم تُحسب من القيود المرحّلة فقط.
export const PURPOSES=[
  ['receivable','ذمم العملاء','asset'],['revenue','إيراد الخدمات','income'],['output_vat','ضريبة المخرجات المستحقة','liability'],['bank','البنك','asset'],
  ['payable','ذمم الموردين','liability'],['input_vat','ضريبة المدخلات القابلة للخصم','asset'],
  ['salaries_expense','مصروف الرواتب','expense'],['employee_advances','سلف الموظفين','asset'],
  ['general_expense','مصروفات تشغيلية (مطالبات الموظفين)','expense'],['employee_payable','مستحقات للموظفين عن مصروفات','liability'],['employee_custody','عهد الموظفين','asset'],
  ['depreciation_expense','مصروف الإهلاك','expense'],['accumulated_depreciation','مجمع الإهلاك','asset'],['retained_earnings','أرباح مبقاة','equity'],['salaries_payable','رواتب مستحقة الدفع','liability'],['social_insurance_payable','تأمينات مستحقة عن الموظفين','liability'],
  // حصة المنشأة في التأمينات مصروف عليها لا خصم على الموظف: بلا هذا الغرض كانت التكلفة تُعاد كتابتها في المالية بيد إنسان.
  ['social_insurance_employer_expense','مصروف حصة المنشأة في التأمينات','expense'],
  // ما استُقطع من دفعة مستفيد صار دَينًا على المنشأة للهيئة حتى يُورَّد. بلا هذا الغرض كان سجل الاستقطاع
  // يحسب المبلغ ويحفظه ولا يصل الدفتر أبدًا، فلا التزام يظهر في أي قائمة مالية.
  ['withholding_payable','استقطاع مستحق للهيئة','liability'],
  // الحزمة 3: فاتورة المورد صارت مصدرًا للدفتر. صافيها (بعد ضريبة المدخلات) تكلفةٌ لكل مركز تكلفة كما خُصّص في بنود الشراء،
  // وكان المسار الوحيد يقيّد الإجمالي على حساب يختاره المُعدّ. أيّ حساب في الدليل يحمل هذا الغرض قرار المالية بربطٍ يعتمده ثانٍ.
  ['supplier_cost','تكلفة فواتير الموردين','expense'],
  // الدفعة المقدمة من العميل التزامٌ عليه حتى تُسحب على فاتورة لاحقة أو ترتد (app/billing-recurring.mjs)، وكانت بلا قيد إطلاقًا.
  ['customer_advances','دفعات مقدمة من العملاء','liability'],
  // الحزمة 3 (المطابقة البنكية والإقفال): سطر الكشف المصنّف رسومًا أو عائدًا صار مصدرًا للدفتر (app/bank-reconciliation.mjs)،
  // وفرق مرتجع دفعة المورد رسوم بنك (app/payables.mjs). كانت الرسوم تُرحَّل يدويًا فتبقى فرقًا دائمًا في التسوية بمبلغها.
  ['bank_charges','رسوم ومصاريف بنكية','expense'],['interest_income','عوائد وفوائد بنكية','income'],
  // الحزمة 4 (P4-HR-3، D4): الحسومات من الرواتب كانت تُطرح من مصروف الرواتب فتختفي فيه. صار لكلٍّ التزامه: دين الحكم القضائي لصاحبه
  // (م51/6)، والغرامة لسجلها الخاص فيما ينفع العمال (م123 من اللائحة)، وما لم يُعيَّن حسابه بعد معلّقٌ ظاهرٌ رصيدُه حتى توجّهه المالية.
  // وقرض صاحب العمل (م51/1) يسترد «سلف الموظفين» القائم. انظر app/payroll-ledger.mjs.
  ['garnishment_payable','محسوم من الرواتب بأحكام قضائية لأصحابها','liability'],['employee_fines_payable','غرامات العمال المحسومة (سجل خاص، م123)','liability'],
  ['payroll_deductions_clearing','حسومات رواتب تنتظر توجيهها','liability']
].map(([key,name,account_type])=>({key,name,account_type}));
// يوم الرياض لطابع UTC من المساعد المشترك (app/riyadh-time.mjs): تاريخ القيد يوم الحدث بتوقيت الرياض، لا أول عشرة أحرف من طابعه.
const riyadhDate=iso=>riyadhDateOf(iso);
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
const monthEnd=month=>{const [year,m]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(year,m,0)).getUTCDate()).padStart(2,'0')}`;};
const FINANCE_OWNER={owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'};

/* ───── سجل أنواع المستندات المصدر (app/ledger-sources.mjs) ───── */
// الأنواع الثلاثة عشر القائمة كما كانت في sourceDocument وpendingSources بالحرف: القارئ نفسه، والحالة النهائية نفسها،
// والسطور نفسها. ما أُضيف لكلٍّ منها قراءةٌ لا كتابة: أثره على الحساب الرقابي (controls)، ووصفه ومن أعدّه واعتمده (للتتبّع).
// ترتيب التسجيل هو ترتيب القائمة المُدارة «نوع المستند المصدر» كما كان، ثم الأنواع الجديدة بعدها.
const M='ledger';
const at=(role,actor_id,time,note)=>actor_id?{role,actor_id,at:time??null,...(note?{note}:{})}:null;
const approvalsOf=(...list)=>list.filter(Boolean);
const taxRow=(db,tenantId,id,kind)=>db.prepare('SELECT * FROM tax_invoices WHERE id=? AND tenant_id=? AND kind=?').get(id,tenantId,kind);
function taxBuild(db,u,kind,sourceId){
  const d=db.prepare("SELECT * FROM tax_invoices WHERE id=? AND tenant_id=? AND status='issued' AND kind=?").get(sourceId,u.tenant_id,kind==='tax_invoice'?'invoice':'credit_note');
  if(!d)return null;
  const sign=kind==='tax_invoice';
  return {date:riyadhDate(d.issued_at),reference:d.number,description:`${sourceKind(kind).name} ${d.number} — ${JSON.parse(d.buyer).legal_name}`,
    lines:[['receivable',sign?d.total_minor:0,sign?0:d.total_minor,'إجمالي المستند'],['revenue',sign?0:d.net_minor,sign?d.net_minor:0,'صافي قبل الضريبة'],...(d.vat_minor?[['output_vat',sign?0:d.vat_minor,sign?d.vat_minor:0,'ضريبة القيمة المضافة']]:[])]};
}
const issuedTax=(db,tenantId,kind)=>db.prepare("SELECT id,number,net_minor,vat_minor,total_minor,issued_at FROM tax_invoices WHERE tenant_id=? AND status='issued' AND kind=?").all(tenantId,kind);
const taxDocument=(db,tenantId,id,kind)=>{const d=taxRow(db,tenantId,id,kind);return d&&{reference:d.number??'مسودة بلا رقم',date:d.issued_at?riyadhDate(d.issued_at):riyadhDate(d.created_at),amount_minor:d.total_minor,status:d.status,description:JSON.parse(d.buyer).legal_name};};
const taxApprovals=(db,tenantId,id,kind)=>{
  const d=taxRow(db,tenantId,id,kind);if(!d)return [];
  const claim=db.prepare("SELECT actor_id,note,created_at FROM ar_claim_decisions WHERE claim_id=? AND decision='approved' ORDER BY revision DESC LIMIT 1").get(d.claim_id);
  return approvalsOf(claim&&at('اعتمد الاستحقاق',claim.actor_id,claim.created_at,claim.note),at('أعدّ المستند',d.prepared_by,d.created_at),at('أصدره',d.issued_by,d.issued_at));
};
registerSourceKind({key:'tax_invoice',name:'فاتورة ضريبية',module:M,
  build:(db,u,id)=>taxBuild(db,u,'tax_invoice',id),
  pending:(db,tenantId)=>issuedTax(db,tenantId,'invoice').map(d=>({source_id:d.id,reference:d.number,amount_minor:d.total_minor,date:riyadhDate(d.issued_at)})),
  controls:{receivable:(db,tenantId)=>issuedTax(db,tenantId,'invoice').map(d=>({source_id:d.id,reference:d.number,date:riyadhDate(d.issued_at),amount_minor:d.total_minor})),
    output_vat:(db,tenantId)=>issuedTax(db,tenantId,'invoice').filter(d=>d.vat_minor).map(d=>({source_id:d.id,reference:d.number,date:riyadhDate(d.issued_at),amount_minor:d.vat_minor}))},
  document:(db,tenantId,id)=>taxDocument(db,tenantId,id,'invoice'),approvals:(db,tenantId,id)=>taxApprovals(db,tenantId,id,'invoice')});
registerSourceKind({key:'credit_note',name:'إشعار دائن',module:M,
  build:(db,u,id)=>taxBuild(db,u,'credit_note',id),
  pending:(db,tenantId)=>issuedTax(db,tenantId,'credit_note').map(d=>({source_id:d.id,reference:d.number,amount_minor:d.total_minor,date:riyadhDate(d.issued_at)})),
  controls:{receivable:(db,tenantId)=>issuedTax(db,tenantId,'credit_note').map(d=>({source_id:d.id,reference:d.number,date:riyadhDate(d.issued_at),amount_minor:-d.total_minor})),
    output_vat:(db,tenantId)=>issuedTax(db,tenantId,'credit_note').filter(d=>d.vat_minor).map(d=>({source_id:d.id,reference:d.number,date:riyadhDate(d.issued_at),amount_minor:-d.vat_minor}))},
  document:(db,tenantId,id)=>taxDocument(db,tenantId,id,'credit_note'),approvals:(db,tenantId,id)=>taxApprovals(db,tenantId,id,'credit_note')});

const confirmedReceipts=(db,tenantId)=>db.prepare("SELECT id,reference,amount_minor,received_on FROM ar_receipts WHERE tenant_id=? AND status='confirmed'").all(tenantId);
registerSourceKind({key:'ar_receipt',name:'قبض مؤكد',module:M,bank:'cash',
  build(db,u,sourceId){
    const r=db.prepare("SELECT r.* FROM ar_receipts r WHERE r.id=? AND r.tenant_id=? AND r.status='confirmed'").get(sourceId,u.tenant_id);
    if(!r)return null;
    const amount=Number(r.amount_minor);
    return {date:r.received_on,reference:r.reference,description:`قبض مؤكد ${r.reference} — ${r.payer}`,lines:[['bank',amount,0,'المبلغ المقبوض'],['receivable',0,amount,'تخفيض ذمة العميل']]};
  },
  pending:(db,tenantId)=>confirmedReceipts(db,tenantId).map(r=>({source_id:r.id,reference:r.reference,amount_minor:Number(r.amount_minor),date:r.received_on})),
  controls:{receivable:(db,tenantId)=>confirmedReceipts(db,tenantId).map(r=>({source_id:r.id,reference:r.reference,date:r.received_on,amount_minor:-Number(r.amount_minor)}))},
  document:(db,tenantId,id)=>{const r=db.prepare('SELECT * FROM ar_receipts WHERE id=? AND tenant_id=?').get(id,tenantId);return r&&{reference:r.reference,date:r.received_on,amount_minor:Number(r.amount_minor),status:r.status,description:r.payer};},
  approvals:(db,tenantId,id)=>{
    const r=db.prepare('SELECT * FROM ar_receipts WHERE id=? AND tenant_id=?').get(id,tenantId);if(!r)return [];
    const d=db.prepare('SELECT * FROM ar_receipt_decisions WHERE receipt_id=?').get(r.id);
    return approvalsOf(at('سجّل القبض',r.recorded_by,r.created_at),d&&at(d.decision==='confirmed'?'طابقه وأكّده':'رفضه',d.actor_id,d.created_at,d.note));
  }});

const monthDay=month=>{const [year,m]=month.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();return `${month}-${String(last).padStart(2,'0')}`;};
// الحزمة 4 (P4-HR-3): القيد من app/payroll-ledger.mjs — مصروف الرواتب لكل مركز إدارة (إدارة الموظف في آخر الشهر)، وكل حسم إلى غرضه، بتاريخ
// آخر يوم من الشهر. وتاريخ «بانتظار الترحيل» صار آخر يوم من الشهر كتاريخ القيد نفسه: كان اليوم 28 فيُرى قيد 30 يونيو بعد تاريخ مستنده.
// وللمسير أثره على حسابين رقابيين: «رواتب مستحقة الدفع» بصافيه، و«سلف الموظفين» بما استرده (أقساط وقرض صاحب العمل) بإشارة سالبة.
// (P4-HR-4) والمسير المنعكس مستند نهائي كذلك: اعتُمد فكان التزامًا، وعكسُه مستندٌ ثانٍ مستقل (payroll_run_reversal) يقابله في الدفتر
// والأستاذ المساعد — لا يُمحى المسير من «بانتظار الترحيل» ولا من المطابقة.
// الشهر الموازي يدفعه النظام السابق (P4-HR-5): لا يظهر مسيره في «بانتظار الترحيل» ولا في الحسابين الرقابيين.
const approvedRuns=(db,tenantId)=>dropParallelMonths(db,tenantId,db.prepare("SELECT id,tenant_id,month,approved_at,net_minor,headcount FROM payroll_runs WHERE tenant_id=? AND status IN ('approved','reversed')").all(tenantId));
registerSourceKind({key:'payroll_run',name:'مسير رواتب معتمد',module:M,
  build(db,u,sourceId){
    const r=db.prepare("SELECT * FROM payroll_runs WHERE id=? AND tenant_id=? AND status IN ('approved','reversed')").get(sourceId,u.tenant_id);
    if(!r)return null;
    assertPlatformPays(db,u.tenant_id,r.month,'journal');
    // إجماليات بمراكز الإدارات؛ لا يدخل الدفتر راتب فرد بعينه ولا اسمه.
    return payrollRunEntry(db,u.tenant_id,r);
  },
  pending:(db,tenantId)=>approvedRuns(db,tenantId).map(r=>({source_id:r.id,reference:runReference(db,r),amount_minor:r.net_minor,date:monthDay(r.month)})),
  controls:{salaries_payable:(db,tenantId)=>approvedRuns(db,tenantId).map(r=>({source_id:r.id,reference:runReference(db,r),date:monthDay(r.month),amount_minor:r.net_minor})),
    employee_advances:(db,tenantId)=>approvedRuns(db,tenantId).map(r=>({source_id:r.id,reference:runReference(db,r),date:monthDay(r.month),amount_minor:-runAdvanceRecovery(db,tenantId,r.id)})).filter(d=>d.amount_minor)},
  document:(db,tenantId,id)=>{const r=db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(id,tenantId);return r&&{reference:r.approved_at?runReference(db,r):`PAY-${r.month}`,date:monthDay(r.month),amount_minor:r.net_minor,status:r.status,description:`مسير ${r.month} (${r.headcount} موظف)`};},
  approvals:(db,tenantId,id)=>{const r=db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(id,tenantId);return r?approvalsOf(at('أعدّ المسير',r.prepared_by,r.created_at),at('راجعه',r.reviewed_by,r.reviewed_at,r.review_note),at('اعتمده',r.approved_by,r.approved_at,r.decision_note)):[];}});

const executedOrders=(db,tenantId)=>db.prepare("SELECT id,bank_reference,amount_minor,executed_on FROM payment_orders WHERE tenant_id=? AND status='executed'").all(tenantId);
const orderApprovals=o=>approvalsOf(at('أعدّ أمر الدفع',o.prepared_by,o.created_at),at('اعتمده',o.approved_by,o.approved_at,o.decision_note),at('وثّق تنفيذه في البنك',o.execution_recorded_by,o.executed_on));
registerSourceKind({key:'supplier_payment',name:'دفعة مورد منفذة',module:M,bank:'cash',
  build(db,u,sourceId){
    const o=db.prepare("SELECT o.*,x.legal_name FROM payment_orders o JOIN vendors x ON x.id=o.vendor_id WHERE o.id=? AND o.tenant_id=? AND o.status='executed'").get(sourceId,u.tenant_id);
    if(!o)return null;
    return {date:o.executed_on,reference:o.bank_reference,description:`دفعة مورد ${o.bank_reference} — ${o.legal_name}`,lines:[['payable',o.amount_minor,0,'تخفيض ذمة المورد'],['bank',0,o.amount_minor,'المبلغ المحول من البنك']]};
  },
  pending:(db,tenantId)=>executedOrders(db,tenantId).map(o=>({source_id:o.id,reference:o.bank_reference,amount_minor:o.amount_minor,date:o.executed_on})),
  // المدفوع يخفض ذمة المورد: أثره على الحساب الرقابي سالب بإشارة الالتزام الطبيعية.
  controls:{payable:(db,tenantId)=>executedOrders(db,tenantId).map(o=>({source_id:o.id,reference:o.bank_reference,date:o.executed_on,amount_minor:-o.amount_minor}))},
  document:(db,tenantId,id)=>{const o=db.prepare('SELECT o.*,x.legal_name FROM payment_orders o JOIN vendors x ON x.id=o.vendor_id WHERE o.id=? AND o.tenant_id=?').get(id,tenantId);return o&&{reference:o.bank_reference??'أمر دفع بلا مرجع بنكي للحين',date:o.executed_on??riyadhDate(o.created_at),amount_minor:o.amount_minor,status:o.status,description:o.legal_name};},
  approvals:(db,tenantId,id)=>{const o=db.prepare('SELECT * FROM payment_orders WHERE id=? AND tenant_id=?').get(id,tenantId);return o?orderApprovals(o):[];}});

const executedPayroll=(db,tenantId)=>db.prepare("SELECT p.id,p.bank_reference,p.amount_minor,p.executed_on FROM payroll_payments p WHERE p.tenant_id=? AND p.status='executed'").all(tenantId);
registerSourceKind({key:'payroll_payment',name:'دفع مسير منفذ',module:M,bank:'cash',
  build(db,u,sourceId){
    const p=db.prepare("SELECT p.*,r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.id=? AND p.tenant_id=? AND p.status='executed'").get(sourceId,u.tenant_id);
    if(!p)return null;
    return {date:p.executed_on,reference:p.bank_reference,description:`دفع مسير ${p.month} (${p.headcount} موظف)`,lines:[['salaries_payable',p.amount_minor,0,'سداد صافي الرواتب'],['bank',0,p.amount_minor,'المبلغ المحول من البنك']]};
  },
  pending:(db,tenantId)=>executedPayroll(db,tenantId).map(o=>({source_id:o.id,reference:o.bank_reference,amount_minor:o.amount_minor,date:o.executed_on})),
  // الدفع المنفذ يسدّد «رواتب مستحقة الدفع»: أثره على الحساب الرقابي سالب بإشارة الالتزام الطبيعية.
  controls:{salaries_payable:(db,tenantId)=>executedPayroll(db,tenantId).map(o=>({source_id:o.id,reference:o.bank_reference,date:o.executed_on,amount_minor:-o.amount_minor}))},
  document:(db,tenantId,id)=>{const p=db.prepare('SELECT p.*,r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.id=? AND p.tenant_id=?').get(id,tenantId);return p&&{reference:p.bank_reference??`دفع مسير ${p.month}`,date:p.executed_on??riyadhDate(p.created_at),amount_minor:p.amount_minor,status:p.status,description:`دفع مسير ${p.month}`};},
  approvals:(db,tenantId,id)=>{const p=db.prepare('SELECT * FROM payroll_payments WHERE id=? AND tenant_id=?').get(id,tenantId);return p?orderApprovals(p):[];}});

const expenseRow=(db,tenantId,id)=>db.prepare('SELECT * FROM expense_claims WHERE id=? AND tenant_id=?').get(id,tenantId);
const expensePending=(db,tenantId)=>db.prepare("SELECT id,receipt_reference,amount_minor,finance_decided_at,status,reimbursed_on,reimbursement_reference FROM expense_claims WHERE tenant_id=? AND status IN ('finance_approved','reimbursed')").all(tenantId);
registerSourceKind({key:'expense_claim',name:'مطالبة مصروف معتمدة',module:M,
  build(db,u,sourceId){
    const c=db.prepare("SELECT * FROM expense_claims WHERE id=? AND tenant_id=?").get(sourceId,u.tenant_id);
    if(!c||!['finance_approved','reimbursed'].includes(c.status))return null;
    return {date:riyadhDate(c.finance_decided_at),reference:`EXP-${c.receipt_reference}`.slice(0,170),description:`مطالبة مصروف معتمدة — ${c.description}`.slice(0,900),lines:[['general_expense',c.amount_minor,0,'المصروف المعتمد'],[c.custody_id?'employee_custody':'employee_payable',0,c.amount_minor,c.custody_id?'تسوية من عهدة الموظف':'مستحق تعويضه للموظف']]};
  },
  pending:(db,tenantId)=>expensePending(db,tenantId).map(c=>({source_id:c.id,reference:`EXP-${c.receipt_reference}`,amount_minor:c.amount_minor,date:riyadhDate(c.finance_decided_at)})),
  // صاحب المطالبة لا يُسمّى في التتبّع: المبلغ ومعتمداه يكفيان لتتبّع المال، واسمه بيانات شخصية لا يحتاجها الدفتر.
  document:(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c&&{reference:`EXP-${c.receipt_reference}`,date:c.expense_date,amount_minor:c.amount_minor,status:c.status,description:c.category};},
  approvals:(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c?approvalsOf(at('اعتمد المدير المباشر',c.manager_id,c.manager_decided_at),at('اعتمدت المالية',c.finance_id,c.finance_decided_at,c.decision_note)):[];}});
registerSourceKind({key:'expense_reimbursement',name:'تعويض مصروف',module:M,bank:'cash',
  build(db,u,sourceId){
    const c=db.prepare("SELECT * FROM expense_claims WHERE id=? AND tenant_id=?").get(sourceId,u.tenant_id);
    if(!c||c.status!=='reimbursed')return null;
    return {date:c.reimbursed_on,reference:c.reimbursement_reference,description:`تعويض مصروف ${c.reimbursement_reference}`,lines:[['employee_payable',c.amount_minor,0,'سداد مستحق الموظف'],['bank',0,c.amount_minor,'المبلغ المحول']]};
  },
  pending:(db,tenantId)=>expensePending(db,tenantId).filter(c=>c.status==='reimbursed').map(c=>({source_id:c.id,reference:c.reimbursement_reference,amount_minor:c.amount_minor,date:c.reimbursed_on})),
  document:(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c&&{reference:c.reimbursement_reference??`EXP-${c.receipt_reference}`,date:c.reimbursed_on??c.expense_date,amount_minor:c.amount_minor,status:c.status,description:c.category};},
  approvals:(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c?approvalsOf(at('وثّق التعويض',c.reimbursed_by,c.reimbursed_on)):[];}});

const custodyRow=(db,tenantId,id)=>db.prepare('SELECT * FROM custodies WHERE id=? AND tenant_id=?').get(id,tenantId);
const custodyPending=(db,tenantId)=>db.prepare("SELECT id,amount_minor,issued_on,issue_reference,status,returned_minor,return_reference,closed_at FROM custodies WHERE tenant_id=? AND status IN ('issued','closed')").all(tenantId);
const custodyBuild=(db,u,kind,sourceId)=>{
  const c=db.prepare("SELECT * FROM custodies WHERE id=? AND tenant_id=? AND status IN ('issued','closed')").get(sourceId,u.tenant_id);
  if(!c)return null;
  if(kind==='custody_issue')return {date:c.issued_on,reference:c.issue_reference,description:`صرف عهدة ${c.issue_reference}`,lines:[['employee_custody',c.amount_minor,0,'عهدة في ذمة الموظف'],['bank',0,c.amount_minor,'المبلغ المصروف']]};
  if(c.status!=='closed'||!c.returned_minor)return null;
  return {date:riyadhDate(c.closed_at),reference:c.return_reference,description:`إعادة متبقي عهدة ${c.return_reference}`,lines:[['bank',c.returned_minor,0,'المبلغ المعاد'],['employee_custody',0,c.returned_minor,'إقفال المتبقي من العهدة']]};
};
registerSourceKind({key:'custody_issue',name:'صرف عهدة',module:M,bank:'cash',
  build:(db,u,id)=>custodyBuild(db,u,'custody_issue',id),
  pending:(db,tenantId)=>custodyPending(db,tenantId).map(c=>({source_id:c.id,reference:c.issue_reference,amount_minor:c.amount_minor,date:c.issued_on})),
  document:(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c&&{reference:c.issue_reference??'عهدة ما انصرفت للحين',date:c.issued_on??riyadhDate(c.created_at),amount_minor:c.amount_minor,status:c.status,description:c.purpose};},
  approvals:(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c?approvalsOf(at('اعتمد العهدة',c.approved_by,c.approved_at),at('صرفها',c.issued_by,c.issued_on)):[];}});
registerSourceKind({key:'custody_return',name:'إعادة متبقي عهدة',module:M,bank:'cash',
  build:(db,u,id)=>custodyBuild(db,u,'custody_return',id),
  pending:(db,tenantId)=>custodyPending(db,tenantId).filter(c=>c.status==='closed'&&c.returned_minor).map(c=>({source_id:c.id,reference:c.return_reference,amount_minor:c.returned_minor,date:riyadhDate(c.closed_at)})),
  document:(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c&&{reference:c.return_reference??'ما رجع من العهدة شي للحين',date:c.closed_at?riyadhDate(c.closed_at):riyadhDate(c.created_at),amount_minor:c.returned_minor??0,status:c.status,description:c.purpose};},
  approvals:(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c?approvalsOf(at('أقفل العهدة واستلم المتبقي',c.closed_by,c.closed_at)):[];}});

registerSourceKind({key:'depreciation_run',name:'إهلاك شهر',module:M,
  build(db,u,sourceId){
    const r=db.prepare('SELECT * FROM depreciation_runs WHERE id=? AND tenant_id=?').get(sourceId,u.tenant_id);
    if(!r)return null;
    return {date:monthDay(r.month),reference:`DEP-${r.month}`,description:`إهلاك الأصول الثابتة لشهر ${r.month}`,lines:[['depreciation_expense',r.total_minor,0,'قسط إهلاك الشهر'],['accumulated_depreciation',0,r.total_minor,'مجمع الإهلاك']]};
  },
  pending:(db,tenantId)=>db.prepare('SELECT id,month,total_minor FROM depreciation_runs WHERE tenant_id=?').all(tenantId).map(r=>({source_id:r.id,reference:`DEP-${r.month}`,amount_minor:r.total_minor,date:`${r.month}-28`})),
  document:(db,tenantId,id)=>{const r=db.prepare('SELECT * FROM depreciation_runs WHERE id=? AND tenant_id=?').get(id,tenantId);return r&&{reference:`DEP-${r.month}`,date:monthDay(r.month),amount_minor:r.total_minor,status:'recorded',description:`إهلاك ${r.month}`};},
  approvals:(db,tenantId,id)=>{const r=db.prepare('SELECT * FROM depreciation_runs WHERE id=? AND tenant_id=?').get(id,tenantId);return r?approvalsOf(at('أعدّ الإهلاك',r.prepared_by,r.created_at)):[];}});

registerSourceKind({key:'year_close',name:'إقفال سنة مالية',module:M,
  build(db,u,sourceId){
    if(!/^\d{4}$/.test(sourceId)||sourceId>=riyadhDate(now()).slice(0,4))return null;
    // قيد الإقفال يعكس رصيد كل حساب إيراد ومصروف مرحَّل في السنة إلى الأرباح المبقاة.
    const rows=db.prepare("SELECT a.id,a.code,a.account_type,SUM(l.debit_minor) AS debit,SUM(l.credit_minor) AS credit FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id JOIN finance_accounts a ON a.id=l.account_id WHERE j.tenant_id=? AND j.status='posted' AND j.entry_date BETWEEN ? AND ? AND a.account_type IN ('income','expense') GROUP BY a.id").all(u.tenant_id,`${sourceId}-01-01`,`${sourceId}-12-31`);
    const lines=[];let net=0;
    for(const r of rows){const balance=r.credit-r.debit;if(!balance)continue;net+=balance;lines.push([{account_id:r.id},balance>0?balance:0,balance<0?-balance:0,`إقفال ${r.code}`]);}
    if(!lines.length)return null;
    lines.push(['retained_earnings',net<0?-net:0,net>0?net:0,net>=0?'صافي ربح السنة':'صافي خسارة السنة']);
    return {date:`${sourceId}-12-31`,reference:`CLOSE-${sourceId}`,description:`إقفال حسابات الإيرادات والمصروفات لسنة ${sourceId}`,lines};
  },
  document:(db,tenantId,id)=>/^\d{4}$/.test(id??'')?{reference:`CLOSE-${id}`,date:`${id}-12-31`,amount_minor:0,status:'derived',description:`إقفال سنة ${id}`}:null});

const withholdingRows=(db,tenantId)=>db.prepare("SELECT id,payment_date,withheld_minor,payment_order_id FROM withholding_entries WHERE tenant_id=? AND status IN ('recorded','remitted') AND withheld_minor>0").all(tenantId);
registerSourceKind({key:'withholding',name:'ضريبة استقطاع مسجلة',module:M,
  build(db,u,sourceId){
    const e=db.prepare("SELECT * FROM withholding_entries WHERE id=? AND tenant_id=? AND status IN ('recorded','remitted')").get(sourceId,u.tenant_id);
    if(!e||!e.withheld_minor)return null;
    // المستقطع لم يخرج من البنك: هو جزء من مستحق المستفيد تحوّل إلى دَين للهيئة. فإن كان أمر الدفع المرتبط ما زال
    // بالمبلغ كاملًا فالمستفيد استلم 100%، وقيدُ «من ذمم الموردين إلى استقطاع مستحق» يخصم الذمة مرة ثانية بعد
    // قيد دفعة المورد. الرفض يقول التناقض بالأرقام بدل أن يضيف رقمًا خاطئًا إلى الدفتر.
    if(e.payment_order_id){
      const order=db.prepare('SELECT amount_minor FROM payment_orders WHERE id=? AND tenant_id=?').get(e.payment_order_id,u.tenant_id);
      if(!order)return null;
      const transferred=e.payment_amount_minor-e.withheld_minor;
      if(order.amount_minor!==transferred)fail(409,'withholding_not_deducted',
        `أمر الدفع المرتبط ما زال بـ${decimal(order.amount_minor)} ريالًا، واستقطاع ${(e.rate_basis_points/100).toFixed(2)}% يعني تحويل ${decimal(transferred)} فقط. المبلغ المحوَّل لم يُخفَّض بقيمة الاستقطاع، فلا يُبنى قيد يخصم ذمة المورد مرتين. صحّح أمر الدفع أولًا`);
    }
    return {date:e.payment_date,reference:`WHT-${e.id.slice(0,8)}`,
      description:`ضريبة استقطاع ${(e.rate_basis_points/100).toFixed(2)}% على دفعة ${e.beneficiary_name}`.slice(0,900),
      lines:[['payable',e.withheld_minor,0,'الجزء المستقطع من مستحق المستفيد'],['withholding_payable',0,e.withheld_minor,'استقطاع مستحق للهيئة لم يُورَّد بعد']]};
  },
  // الملغى لا يحمل التزامًا، وسجلٌ بمستقطَع صفر لا يبني قيدًا متوازنًا.
  pending:(db,tenantId)=>withholdingRows(db,tenantId).map(e=>({source_id:e.id,reference:`WHT-${e.id.slice(0,8)}`,amount_minor:e.withheld_minor,date:e.payment_date})),
  // قيده يخصم ذمة المورد بالجزء المستقطع، فهو في الأستاذ المساعد للموردين تسويةٌ كالدفعة.
  controls:{payable:(db,tenantId)=>withholdingRows(db,tenantId).map(e=>({source_id:e.id,reference:`WHT-${e.id.slice(0,8)}`,date:e.payment_date,amount_minor:-e.withheld_minor}))},
  document:(db,tenantId,id)=>{const e=db.prepare('SELECT * FROM withholding_entries WHERE id=? AND tenant_id=?').get(id,tenantId);return e&&{reference:`WHT-${e.id.slice(0,8)}`,date:e.payment_date,amount_minor:e.withheld_minor,status:e.status,description:e.beneficiary_name};},
  approvals:(db,tenantId,id)=>{const e=db.prepare('SELECT * FROM withholding_entries WHERE id=? AND tenant_id=?').get(id,tenantId);return e?approvalsOf(at('سجّل الاستقطاع',e.recorded_by,e.created_at),at('وثّق توريده للهيئة',e.remitted_by,e.remitted_on)):[];}});

/* ───── فاتورة المورد المطابقة: الالتزام نفسه، لا مسار ثانٍ بجانبه ───── */
// المصدر هو المستحق المطابق مطابقة ثلاثية (procurement_payables): لحظة المطابقة هي لحظة الاعتراف بالالتزام، والمعرّف
// نفسه الذي يقرؤه كل ما حوله (أوامر الدفع، وقائمة إقفال المشروع، ودفتر المالية). القيد:
//   مدين تكلفة الموردين بالصافي لكل مركز تكلفة — كما خُصّص في بنود الشراء (procurement_line_allocations، الترحيل 140)؛
//   مدين ضريبة المدخلات بمبلغ السجل الضريبي المتحقَّق منه (procurement_invoice_tax)؛ دائن ذمم الموردين بإجمالي الفاتورة.
// وهويته في الدفتر هوية قيد المستحق (finance_journals.source_kind='procurement_payable' ورابط finance_payable_links)، فيراه
// كل قارئ قديم بلا تعديل، ولا يُبنى للمستحق نفسه قيدٌ ثانٍ لا من هنا ولا من المسار اليدوي (القيد الفريد، والمحفّز 167).
const payableRow=(db,tenantId,id)=>typeof id==='string'?db.prepare(`SELECT y.id,y.amount_minor,y.currency,y.created_at,y.matched_by,y.note,y.purchase_id,y.invoice_id,
    i.supplier_key,i.supplier_reference,i.recorded_by AS invoice_recorded_by,i.created_at AS invoice_recorded_at,
    o.supplier_name,o.approved_by AS order_approved_by,o.created_at AS order_approved_at,o.note AS order_note
  FROM procurement_payables y JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_orders o ON o.purchase_id=y.purchase_id
  WHERE y.id=? AND i.tenant_id=?`).get(id,tenantId)??null:null;
const matchedPayables=(db,tenantId)=>db.prepare('SELECT y.id,y.amount_minor,y.created_at,i.supplier_reference FROM procurement_payables y JOIN procurement_invoices i ON i.id=y.invoice_id WHERE i.tenant_id=?').all(tenantId);
// سجل ضريبة الفاتورة الحي: الفهرس procurement_invoice_tax_live يضمن واحدًا غير مرفوض على الأكثر.
const liveInputTax=(db,tenantId,invoiceId)=>db.prepare("SELECT * FROM procurement_invoice_tax WHERE invoice_id=? AND tenant_id=? AND status<>'rejected'").get(invoiceId,tenantId)??null;
// المورد كما تقرؤه بوابة الدفع (app/vendors.mjs resolveVendor): بمفتاحه، ثم إلى الملف الذي دُمج فيه.
function vendorOf(db,tenantId,supplierKey){
  let vendor=db.prepare('SELECT id,code,vat_number,merged_into FROM vendors WHERE tenant_id=? AND supplier_key=?').get(tenantId,supplierKey);
  for(let hops=0;vendor?.merged_into&&hops<5;hops++)vendor=db.prepare('SELECT id,code,vat_number,merged_into FROM vendors WHERE id=? AND tenant_id=?').get(vendor.merged_into,tenantId);
  return vendor??null;
}
// توزيع مبلغ على أوزان بالهللات بلا كسور: القسمة الصحيحة ثم الباقي هللةً هللة لأكبر الكسور (والأسبق عند التساوي).
// المجموع يساوي المبلغ حرفيًا، والحساب BigInt لأن المبلغ في الوزن قد يتجاوز الأعداد الآمنة.
export function spreadMinor(total,weights){
  const sum=weights.reduce((n,w)=>n+BigInt(w),0n),T=BigInt(total);
  if(!weights.length)return [];
  if(sum===0n)return weights.map((w,i)=>i===0?Number(T):0);
  const parts=weights.map((w,i)=>({i,base:T*BigInt(w)/sum,rest:T*BigInt(w)%sum}));
  let left=T-parts.reduce((n,p)=>n+p.base,0n);
  for(const p of [...parts].sort((a,b)=>a.rest===b.rest?a.i-b.i:a.rest>b.rest?-1:1)){if(left<=0n)break;p.base+=1n;left-=1n;}
  return parts.map(p=>Number(p.base));
}
// مركز تكلفة التخصيص: معرّفه إن حُلّ عند الشراء، وإلا نصّه يُطابَق بقائمة المالية الآن (التطبيع نفسه في app/cost-centres.mjs).
function centreOf(db,tenantId,id,text){
  if(id){const row=db.prepare('SELECT id,code FROM finance_cost_centers WHERE id=? AND tenant_id=?').get(id,tenantId);if(row)return row;}
  const key=centerKey(text);
  return db.prepare('SELECT id,code FROM finance_cost_centers WHERE tenant_id=? AND active=1').all(tenantId).find(c=>centerKey(c.code)===key)??null;
}
// إجمالي المستحق على مراكز التكلفة: كل بند مستحق يتبع بند أمره، وبند الأمر يتبع بند الطلب ومخصصاته. بندٌ بمخصصَين يُقسم
// على مبلغيهما، وبندٌ بمخصص واحد (وهو ما تبنيه المشتريات اليوم) يذهب كله إلى مركزه.
function payableCentres(db,tenantId,payable){
  const lines=db.prepare('SELECT pl.amount_minor,ol.purchase_line_id,ol.cost_center_id,ol.cost_center FROM procurement_payable_lines pl JOIN procurement_order_lines ol ON ol.id=pl.order_line_id WHERE pl.payable_id=? ORDER BY ol.line_no,pl.id').all(payable.id);
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
function supplierInvoiceBuild(db,u,payableId){
  const p=payableRow(db,u.tenant_id,payableId);
  if(!p)return null;
  const label=`فاتورة المورد ${p.supplier_reference}`;
  // موقف الضريبة يُعرف قبل القيد: متحقَّق منها، أو مورد خارج سجل الضريبة. غير ذلك ما يتجهز القيد، والرفض يقول ليش ومن يسدّه.
  const tax=liveInputTax(db,u.tenant_id,p.invoice_id);
  let vat=0;
  if(tax?.status==='verified')vat=tax.vat_minor;
  else if(tax?.status==='pending')refuse(409,'input_tax_pending',{what:`${label} ما يتجهز قيدها: ضريبتها المسجّلة (${decimal(tax.vat_minor)}) ما تحقق منها أحد للحين`,
    missing:[{document:'تحقّق شخص ثانٍ من الفاتورة الضريبية للمورد',why:'ضريبة المدخلات ما تدخل الدفتر قبل ما يطابقها غير اللي سجّلها',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],
    next:'يتحقق منها المعتمد في «مدفوعات الموردين»، وبعدها جهّز القيد من هنا'});
  else{
    const vendor=vendorOf(db,u.tenant_id,p.supplier_key);
    if(!vendor)refuse(409,'supplier_unregistered',{what:`${label} ما يتجهز قيدها: المورد ${p.supplier_key} ما له ملف في دليل الموردين، فما نعرف هل هو مسجّل ضريبيًا`,
      missing:[{document:`ملف مورد بالمعرّف ${p.supplier_key}`,why:'بدون الرقم الضريبي أو غيابه ما ينفصل صافي التكلفة عن ضريبة المدخلات',owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'pm'}],
      next:'سجّل المورد في مركز الموردين، ثم سجّل ضريبة فاتورته إن كان مسجّلًا ضريبيًا'});
    if(vendor.vat_number)refuse(409,'input_tax_missing',{what:`${label} ما يتجهز قيدها: المورد ${vendor.code} مسجّل ضريبيًا وضريبة فاتورته ما انسجلت`,
      missing:[{document:'الفاتورة الضريبية للمورد: رقمها وتاريخها ومبلغ ضريبتها، ويتحقق منها شخص ثانٍ',why:'القيد يفصل صافي التكلفة عن ضريبة المدخلات بمبلغ السجل الضريبي نفسه، لا بتقدير',owner:'المالية — من يعدّ مدفوعات الموردين',owner_role:'finance'}],
      next:'سجّل ضريبة الفاتورة في «مدفوعات الموردين» ويتحقق منها شخص ثانٍ، وبعدها جهّز القيد'});
  }
  if(vat<0||vat>=p.amount_minor)refuse(409,'input_tax_exceeds_invoice',{what:`${label}: ضريبتها المتحقَّق منها (${decimal(vat)}) ما تصغر عن إجماليها (${decimal(p.amount_minor)})`,
    missing:[{document:'سجل ضريبي يطابق الفاتورة',why:'الضريبة جزء من إجمالي الفاتورة',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],next:'ارفض السجل الضريبي وسجّله من جديد بمبلغه الصحيح'});
  const {groups,unresolved}=payableCentres(db,u.tenant_id,p);
  if(unresolved.length||!groups.length)refuse(409,'cost_centre_unresolved',{what:`${label} ما يتجهز قيدها: مركز التكلفة «${unresolved.join('، ')||'—'}» في بنود الشراء ما يطابق مركزًا في دليل المالية`,
    missing:[{document:`مركز تكلفة في الدفتر برمز «${unresolved[0]??'—'}»`,why:'تكلفة الفاتورة تنقيد على المركز اللي خُصّص له الشراء، لا على مركز افتراضي',...FINANCE_OWNER}],
    next:'أنشئ المركز برمزه نفسه في «الدفتر المالي» ← مراكز التكلفة، وبعدها جهّز القيد'});
  const vatShares=spreadMinor(vat,groups.map(g=>g.gross));
  return {date:riyadhDate(p.created_at),reference:p.supplier_reference,description:`فاتورة مورد ${p.supplier_reference} — ${p.supplier_name}`.slice(0,900),
    payable:{id:p.id,amount_minor:p.amount_minor,currency:p.currency},
    lines:[...groups.map((g,i)=>({purpose:'supplier_cost',cost_center_id:g.id,debit_minor:g.gross-vatShares[i],credit_minor:0,memo:`صافي فاتورة المورد لمركز ${g.code}`})).filter(l=>l.debit_minor>0),
      ...(vat?[{purpose:'input_vat',debit_minor:vat,credit_minor:0,memo:`ضريبة المدخلات المتحقق منها — فاتورة ${tax.supplier_invoice_number}`}]:[]),
      {purpose:'payable',debit_minor:0,credit_minor:p.amount_minor,memo:'التزام المورد بإجمالي الفاتورة'}]};
}
registerSourceKind({key:'supplier_invoice',name:'فاتورة مورد مطابقة',module:M,
  build:supplierInvoiceBuild,
  pending:(db,tenantId)=>matchedPayables(db,tenantId).map(y=>({source_id:y.id,reference:y.supplier_reference,amount_minor:y.amount_minor,date:riyadhDate(y.created_at)})),
  controls:{
    payable:(db,tenantId)=>matchedPayables(db,tenantId).map(y=>({source_id:y.id,reference:y.supplier_reference,date:riyadhDate(y.created_at),amount_minor:y.amount_minor})),
    // ضريبة المدخلات بتاريخ الفاتورة الضريبية — أساس ملخص الضريبة في القوائم والإقرار (verifiedInputVat). فاتورةٌ تحقق من ضريبتها
    // ولم تُطابق بعد تظهر فرقًا مسمّى بلا قيد، لأن الدفتر لا يعترف بالتزام قبل المطابقة.
    input_vat:(db,tenantId)=>db.prepare("SELECT t.vat_minor,t.invoice_date,t.supplier_invoice_number,i.id AS invoice_id,y.id AS payable_id FROM procurement_invoice_tax t JOIN procurement_invoices i ON i.id=t.invoice_id LEFT JOIN procurement_payables y ON y.invoice_id=i.id WHERE t.tenant_id=? AND t.status='verified' AND t.vat_minor>0").all(tenantId)
      .map(t=>({source_id:t.payable_id??`invoice:${t.invoice_id}`,reference:t.supplier_invoice_number,date:t.invoice_date,amount_minor:t.vat_minor,...(t.payable_id?{}:{note:'الفاتورة ما تطابقت للحين، فما لها التزام ولا قيد'})}))},
  document:(db,tenantId,id)=>{const p=payableRow(db,tenantId,id);return p&&{reference:p.supplier_reference,date:riyadhDate(p.created_at),amount_minor:p.amount_minor,status:'matched',description:p.supplier_name};},
  approvals(db,tenantId,id){
    const p=payableRow(db,tenantId,id);if(!p)return [];
    const tax=liveInputTax(db,tenantId,p.invoice_id);
    return approvalsOf(at('اعتمد أمر الشراء الداخلي',p.order_approved_by,p.order_approved_at,p.order_note),at('سجّل فاتورة المورد',p.invoice_recorded_by,p.invoice_recorded_at),
      at('طابق المستحق مطابقة ثلاثية واعتمده',p.matched_by,p.created_at,p.note),tax&&at('سجّل ضريبة الفاتورة',tax.recorded_by,tax.created_at),tax&&at('تحقق من الضريبة',tax.decided_by,tax.decided_at,tax.decision_note));
  }});

/* ───── الدفعات المقدمة من العملاء ───── */
// القبض (مدين البنك، دائن الدفعات المقدمة)، والسحب على فاتورة لاحقة (مدين الدفعات المقدمة، دائن ذمة العميل التي أنشأتها تلك
// الفاتورة)، والارتداد (مدين الدفعات المقدمة، دائن البنك). المبالغ شاملة الضريبة كما تحفظها الفوترة الدورية؛ معالجة ضريبة الدفعة
// المقدمة عند قبضها قرار مختص ضريبي لم يُتخذ (ZATCA_ADVANCE_WARNING)، فلا يفصلها القيد تخمينًا.
const advanceRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT a.*,c.legal_name AS client_name FROM advance_invoices a JOIN clients c ON c.id=a.client_id WHERE a.id=? AND a.tenant_id=?').get(id,tenantId)??null:null;
const advanceReference=a=>a.receipt_reference??`ADV-${a.id.slice(0,8)}`;
const paidAdvances=(db,tenantId)=>db.prepare("SELECT id,paid_minor,received_on,receipt_reference FROM advance_invoices WHERE tenant_id=? AND status='paid'").all(tenantId);
registerSourceKind({key:'advance_receipt',name:'قبض دفعة مقدمة',module:M,bank:'cash',
  build(db,u,id){
    const a=advanceRow(db,u.tenant_id,id);
    if(!a||a.status!=='paid')return null;
    return {date:a.received_on,reference:advanceReference(a),description:`دفعة مقدمة مقبوضة ${advanceReference(a)} — ${a.client_name}`.slice(0,900),
      lines:[['bank',a.paid_minor,0,'المبلغ المقبوض مقدمًا'],['customer_advances',0,a.paid_minor,'التزام للعميل حتى يُسحب على فاتورة أو يرتد']]};
  },
  pending:(db,tenantId)=>paidAdvances(db,tenantId).map(a=>({source_id:a.id,reference:advanceReference(a),amount_minor:a.paid_minor,date:a.received_on})),
  controls:{customer_advances:(db,tenantId)=>paidAdvances(db,tenantId).map(a=>({source_id:a.id,reference:advanceReference(a),date:a.received_on,amount_minor:a.paid_minor}))},
  document:(db,tenantId,id)=>{const a=advanceRow(db,tenantId,id);return a&&{reference:advanceReference(a),date:a.received_on??riyadhDate(a.created_at),amount_minor:a.paid_minor||a.amount_minor,status:a.status,description:a.client_name};},
  approvals:(db,tenantId,id)=>{const a=advanceRow(db,tenantId,id);return a?approvalsOf(at('سجّل الدفعة المقدمة',a.recorded_by,a.created_at),at('أكّد قبضها',a.confirmed_by,a.confirmed_at)):[];}});

// كل سحب حدثٌ مستقل في advance_draw_applications (الترحيل 167): السحب الواحد قد يُسحب جزئيًا ثم كاملًا، فقيده بحدثه لا بمجموعه.
const applicationRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT x.*,d.target_reference,d.requested_by,d.created_at AS requested_at,a.client_id,c.legal_name AS client_name FROM advance_draw_applications x JOIN advance_draws d ON d.id=x.draw_id JOIN advance_invoices a ON a.id=x.advance_id JOIN clients c ON c.id=a.client_id WHERE x.id=? AND x.tenant_id=?').get(id,tenantId)??null:null;
const applications=(db,tenantId)=>db.prepare('SELECT x.id,x.amount_minor,x.applied_at,d.target_reference FROM advance_draw_applications x JOIN advance_draws d ON d.id=x.draw_id WHERE x.tenant_id=?').all(tenantId);
registerSourceKind({key:'advance_draw',name:'سحب من دفعة مقدمة على فاتورة',module:M,
  build(db,u,id){
    const x=applicationRow(db,u.tenant_id,id);
    if(!x)return null;
    return {date:riyadhDate(x.applied_at),reference:x.target_reference.slice(0,170),description:`سحب من دفعة مقدمة على ${x.target_reference} — ${x.client_name}`.slice(0,900),
      lines:[['customer_advances',x.amount_minor,0,'سحب من رصيد الدفعة المقدمة'],['receivable',0,x.amount_minor,'تسوية ذمة العميل على الفاتورة اللاحقة']]};
  },
  pending:(db,tenantId)=>applications(db,tenantId).map(x=>({source_id:x.id,reference:x.target_reference,amount_minor:x.amount_minor,date:riyadhDate(x.applied_at)})),
  controls:{customer_advances:(db,tenantId)=>applications(db,tenantId).map(x=>({source_id:x.id,reference:x.target_reference,date:riyadhDate(x.applied_at),amount_minor:-x.amount_minor})),
    receivable:(db,tenantId)=>applications(db,tenantId).map(x=>({source_id:x.id,reference:x.target_reference,date:riyadhDate(x.applied_at),amount_minor:-x.amount_minor}))},
  document:(db,tenantId,id)=>{const x=applicationRow(db,tenantId,id);return x&&{reference:x.target_reference,date:riyadhDate(x.applied_at),amount_minor:x.amount_minor,status:x.origin,description:x.client_name};},
  approvals(db,tenantId,id){
    const x=applicationRow(db,tenantId,id);if(!x)return [];
    // من سحب يُقرأ من سجل التدقيق: جدول السحب يحفظ من طلبه وحده، والتدقيق يحفظ كل تطبيق بمجموعه بعد التطبيق.
    const applied=db.prepare("SELECT actor_id,created_at FROM audit_events WHERE tenant_id=? AND entity_type='advance_draw' AND entity_id=? AND action='advance.draw_applied' AND json_extract(after_json,'$.applied_minor')=? ORDER BY seq DESC LIMIT 1").get(tenantId,x.draw_id,x.cumulative_minor);
    return approvalsOf(at('طلب السحب على الفاتورة',x.requested_by,x.requested_at),applied&&at('سحب المبلغ',applied.actor_id,applied.created_at));
  }});

const reversalRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT r.*,a.receipt_reference,a.client_id,c.legal_name AS client_name FROM advance_reversals r JOIN advance_invoices a ON a.id=r.advance_id JOIN clients c ON c.id=a.client_id WHERE r.id=? AND r.tenant_id=?').get(id,tenantId)??null:null;
const advanceReversals=(db,tenantId)=>db.prepare('SELECT id,amount_minor,reversed_at FROM advance_reversals WHERE tenant_id=?').all(tenantId);
registerSourceKind({key:'advance_reversal',name:'ارتداد دفعة مقدمة',module:M,bank:'cash',
  build(db,u,id){
    const r=reversalRow(db,u.tenant_id,id);
    if(!r)return null;
    return {date:riyadhDate(r.reversed_at),reference:`ADV-REV-${r.id.slice(0,8)}`,description:`ارتداد دفعة مقدمة ${r.receipt_reference??''} — ${r.client_name}`.replace(/\s+/gu,' ').slice(0,900),
      lines:[['customer_advances',r.amount_minor,0,'ما ارتد من رصيد الدفعة المقدمة'],['bank',0,r.amount_minor,'المبلغ المرتد من البنك']]};
  },
  pending:(db,tenantId)=>advanceReversals(db,tenantId).map(r=>({source_id:r.id,reference:`ADV-REV-${r.id.slice(0,8)}`,amount_minor:r.amount_minor,date:riyadhDate(r.reversed_at)})),
  controls:{customer_advances:(db,tenantId)=>advanceReversals(db,tenantId).map(r=>({source_id:r.id,reference:`ADV-REV-${r.id.slice(0,8)}`,date:riyadhDate(r.reversed_at),amount_minor:-r.amount_minor}))},
  document:(db,tenantId,id)=>{const r=reversalRow(db,tenantId,id);return r&&{reference:`ADV-REV-${r.id.slice(0,8)}`,date:riyadhDate(r.reversed_at),amount_minor:r.amount_minor,status:'recorded',description:r.reason};},
  approvals:(db,tenantId,id)=>{const r=reversalRow(db,tenantId,id);return r?approvalsOf(at('سجّل الارتداد',r.reversed_by,r.reversed_at,r.reason)):[];}});

/* ───── الروابط بين المستندات: التسوية، وما يسوّيه المستند، والعكس ───── */
// كل رابط يعيد مستندات بنوعها ومعرّفها، فيقرأ التتبّع قيد كلٍّ منها ومطابقته البنكية بالقاعدة نفسها.
const link=(from,role,list)=>registerSourceLink({from,role,module:M,list});
const orderItem=o=>({kind:'supplier_payment',id:o.id,reference:o.bank_reference??'أمر دفع بلا مرجع بنكي للحين',date:o.executed_on??riyadhDate(o.created_at),amount_minor:o.amount_minor,status:o.status});
// أمر الدفع يسوّي مستحقاته بسطوره (payment_order_lines، الترحيل 166): الأمر المجمّع تسويةٌ لكل مستحق فيه بالجزء الذي دفعه
// (applied_minor)، والجزئي بجزئه. كان الرابط يقرأ payment_orders.payable_id — أول مستحق في الأمر — فالثاني بلا تسوية في التتبّع.
link('supplier_invoice','settlement',(db,tenantId,id)=>[
  ...db.prepare('SELECT o.*,l.amount_minor AS applied_minor FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=? AND o.tenant_id=? ORDER BY o.created_at,o.id').all(id,tenantId)
    .map(o=>({...orderItem(o),applied_minor:o.applied_minor})),
  ...db.prepare("SELECT DISTINCT e.id,e.withheld_minor,e.payment_date,e.status FROM withholding_entries e JOIN payment_order_lines l ON l.order_id=e.payment_order_id WHERE l.payable_id=? AND e.tenant_id=? AND e.status<>'cancelled' AND e.withheld_minor>0").all(id,tenantId)
    .map(e=>({kind:'withholding',id:e.id,reference:`WHT-${e.id.slice(0,8)}`,date:e.payment_date,amount_minor:e.withheld_minor,status:e.status}))]);
const payableItem=(db,tenantId,payableId)=>{const p=payableId&&payableRow(db,tenantId,payableId);return p?[{kind:'supplier_invoice',id:p.id,reference:p.supplier_reference,date:riyadhDate(p.created_at),amount_minor:p.amount_minor,status:'matched'}]:[];};
// المستحقات التي يسوّيها الأمر بسطوره، وكلٌّ بما دُفع منه فيه (settled_minor).
const orderPayables=(db,tenantId,orderId)=>db.prepare('SELECT l.payable_id,l.amount_minor FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE o.id=? AND o.tenant_id=? ORDER BY l.line_no').all(orderId,tenantId)
  .flatMap(l=>payableItem(db,tenantId,l.payable_id).map(p=>({...p,settled_minor:l.amount_minor})));
link('supplier_payment','settles',(db,tenantId,id)=>orderPayables(db,tenantId,id));
link('withholding','settles',(db,tenantId,id)=>{const e=db.prepare('SELECT payment_order_id FROM withholding_entries WHERE id=? AND tenant_id=?').get(id,tenantId);return e?.payment_order_id?orderPayables(db,tenantId,e.payment_order_id):[];});
const invoiceItem=d=>({kind:d.kind==='invoice'?'tax_invoice':'credit_note',id:d.id,reference:d.number??'مسودة بلا رقم',date:d.issued_at?riyadhDate(d.issued_at):riyadhDate(d.created_at),amount_minor:d.total_minor,status:d.status});
link('tax_invoice','settlement',(db,tenantId,id)=>{
  const d=db.prepare('SELECT claim_id,number FROM tax_invoices WHERE id=? AND tenant_id=?').get(id,tenantId);if(!d)return [];
  return [...db.prepare("SELECT id,reference,amount_minor,received_on,status FROM ar_receipts WHERE claim_id=? AND tenant_id=? AND status<>'rejected' ORDER BY received_on,id").all(d.claim_id,tenantId)
      .map(r=>({kind:'ar_receipt',id:r.id,reference:r.reference,date:r.received_on,amount_minor:Number(r.amount_minor),status:r.status})),
    // السحب يسمّي فاتورته نصًّا (advance_draws.target_reference): يُربط حين يطابق رقمها حرفيًا، ولا يُخمَّن غير ذلك.
    ...(d.number?db.prepare('SELECT x.id,x.amount_minor,x.applied_at,x.origin FROM advance_draw_applications x JOIN advance_draws r ON r.id=x.draw_id WHERE x.tenant_id=? AND trim(r.target_reference)=? ORDER BY x.applied_at,x.id').all(tenantId,d.number)
      .map(x=>({kind:'advance_draw',id:x.id,reference:d.number,date:riyadhDate(x.applied_at),amount_minor:x.amount_minor,status:x.origin})):[])];
});
link('tax_invoice','reversal',(db,tenantId,id)=>db.prepare("SELECT * FROM tax_invoices WHERE original_invoice_id=? AND tenant_id=? AND kind='credit_note' AND status<>'rejected' ORDER BY created_at,id").all(id,tenantId).map(invoiceItem));
link('credit_note','settles',(db,tenantId,id)=>db.prepare("SELECT o.* FROM tax_invoices n JOIN tax_invoices o ON o.id=n.original_invoice_id WHERE n.id=? AND n.tenant_id=?").all(id,tenantId).map(invoiceItem));
link('ar_receipt','settles',(db,tenantId,id)=>db.prepare("SELECT t.* FROM ar_receipts r JOIN tax_invoices t ON t.claim_id=r.claim_id AND t.kind='invoice' AND t.status='issued' WHERE r.id=? AND r.tenant_id=? ORDER BY t.chain_index").all(id,tenantId).map(invoiceItem));
link('advance_receipt','settlement',(db,tenantId,id)=>db.prepare('SELECT x.id,x.amount_minor,x.applied_at,x.origin,d.target_reference FROM advance_draw_applications x JOIN advance_draws d ON d.id=x.draw_id WHERE x.advance_id=? AND x.tenant_id=? ORDER BY x.applied_at,x.id').all(id,tenantId)
  .map(x=>({kind:'advance_draw',id:x.id,reference:x.target_reference,date:riyadhDate(x.applied_at),amount_minor:x.amount_minor,status:x.origin})));
link('advance_receipt','reversal',(db,tenantId,id)=>db.prepare('SELECT id,amount_minor,reversed_at FROM advance_reversals WHERE advance_id=? AND tenant_id=? ORDER BY reversed_at,id').all(id,tenantId)
  .map(r=>({kind:'advance_reversal',id:r.id,reference:`ADV-REV-${r.id.slice(0,8)}`,date:riyadhDate(r.reversed_at),amount_minor:r.amount_minor,status:'recorded'})));
const advanceItem=(db,tenantId,advanceId)=>{const a=advanceId&&advanceRow(db,tenantId,advanceId);return a?[{kind:'advance_receipt',id:a.id,reference:advanceReference(a),date:a.received_on??riyadhDate(a.created_at),amount_minor:a.paid_minor,status:a.status}]:[];};
link('advance_draw','settles',(db,tenantId,id)=>{
  const x=applicationRow(db,tenantId,id);if(!x)return [];
  const invoice=db.prepare("SELECT * FROM tax_invoices WHERE tenant_id=? AND kind='invoice' AND status='issued' AND number=?").get(tenantId,x.target_reference.trim());
  return [...(invoice?[invoiceItem(invoice)]:[]),...advanceItem(db,tenantId,x.advance_id)];
});
link('advance_reversal','settles',(db,tenantId,id)=>advanceItem(db,tenantId,reversalRow(db,tenantId,id)?.advance_id));
link('payroll_run','settlement',(db,tenantId,id)=>db.prepare('SELECT p.*,r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.run_id=? AND p.tenant_id=? ORDER BY p.created_at').all(id,tenantId)
  .map(p=>({kind:'payroll_payment',id:p.id,reference:p.bank_reference??`دفع مسير ${p.month}`,date:p.executed_on??riyadhDate(p.created_at),amount_minor:p.amount_minor,status:p.status})));
link('payroll_payment','settles',(db,tenantId,id)=>db.prepare('SELECT r.* FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.id=? AND p.tenant_id=?').all(id,tenantId)
  .map(r=>({kind:'payroll_run',id:r.id,reference:runReference(db,r),date:monthDay(r.month),amount_minor:r.net_minor,status:r.status})));
link('expense_claim','settlement',(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c?.status==='reimbursed'?[{kind:'expense_reimbursement',id:c.id,reference:c.reimbursement_reference,date:c.reimbursed_on,amount_minor:c.amount_minor,status:c.status}]:[];});
link('expense_reimbursement','settles',(db,tenantId,id)=>{const c=expenseRow(db,tenantId,id);return c?[{kind:'expense_claim',id:c.id,reference:`EXP-${c.receipt_reference}`,date:c.expense_date,amount_minor:c.amount_minor,status:c.status}]:[];});
link('custody_issue','settlement',(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c?.status==='closed'&&c.returned_minor?[{kind:'custody_return',id:c.id,reference:c.return_reference,date:riyadhDate(c.closed_at),amount_minor:c.returned_minor,status:c.status}]:[];});
link('custody_return','settles',(db,tenantId,id)=>{const c=custodyRow(db,tenantId,id);return c?[{kind:'custody_issue',id:c.id,reference:c.issue_reference,date:c.issued_on,amount_minor:c.amount_minor,status:c.status}]:[];});

// القائمة المُدارة تسمّي أنواع هذا الملف بترتيبها: الثلاثة عشر القديمة كما كانت، ثم الأربعة الجديدة.
export const SOURCE_KINDS=sourceKinds().filter(k=>k.module===M).map(({key,name})=>({key,name}));

/* ───── الخيارات المُدارة (الترحيل 134): أغراض الربط المحاسبي وأنواع المستندات المصدر ───── */
// الترحيل 031 فتح العمودين صراحةً لهذا («فلا يُعاد بناء الجدول مع كل نوع جديد»)، ثم بقي الكود هو القفل الوحيد
// سنةً كاملة. هذه أرخص مناولة في الجرد: إشعار دائن جديد أو ضريبة استقطاع تحتاج غرضًا محاسبيًا، وكان ذلك يعني
// سطرًا يكتبه مبرمج. الآن يضيفه المالية من المنصة، ويبقى فحص نوع الحساب (ledger:47) قائمًا لأن نوع الحساب
// يسافر مع الخيار في extra لا في رأس مبرمج.
// وقيد العمود يسافر مع الواصف: العمودان محروسان بـCHECK منذ الترحيل 031 بحروف لاتينية صغيرة وشرطة سفلية من
// 3 إلى 40. بلا إعلانه كان غرضٌ عربي أو طويل يمرّ القائمة ثم يسقط عند recordMapping بخطأ SQLite خام — عطل
// خادم (500) لا رفضًا مكتوبًا. والقائمة تبقى managed: الترحيل 031 فتح العمود ليُوسَّع، والقيد يشكّل ولا يقفل.
const LEDGER_KEY={pattern:/^[a-z_]{3,40}$/,min:3,max:40,
  because:"length(...) BETWEEN 3 AND 40 AND ... NOT GLOB '*[^a-z_]*' — حروف لاتينية صغيرة وشرطة سفلية، من 3 إلى 40",migration:'031'};
registerOptionList({key:'ledger.purpose',label:'الغرض المحاسبي',label_en:'Ledger purpose',module:'finance',
  owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance',manage_capability:'finance.use',
  governance:'managed',columns:['finance_account_mappings.purpose'],value_shape:LEDGER_KEY,
  extra_shape:{account_type:'نوع الحساب الذي يقبله هذا الغرض'},
  extra_values:{account_type:['asset','liability','equity','income','expense']},
  defaults:PURPOSES.map(p=>({value:p.key,label:p.name,extra:{account_type:p.account_type}})),
  note:'كل غرض يقبل نوع حساب واحد. الغرض الذي رُبط بحساب لا يُحذف بل يُعطَّل، فتبقى القيود القديمة مقروءة.'});
registerOptionList({key:'ledger.source_kind',label:'نوع المستند المصدر',label_en:'Source document kind',module:'finance',
  owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance',manage_capability:'finance.use',
  governance:'managed',columns:['finance_source_links.source_kind'],value_shape:LEDGER_KEY,
  defaults:SOURCE_KINDS.map(s=>({value:s.key,label:s.name})),
  note:'القائمة تسمّي المستندات التي يقترح الدفتر قيدًا منها. النوع الجديد يحتاج قارئًا في الكود يبني سطوره، فالقائمة تفتح التسمية والتعطيل لا بناء المستند.'});
// الأغراض كما تراها هذه القاعدة الآن: افتراضات الكود تعلوها طبقة المالك. المعطَّل يبقى في القراءة لأن قيدًا
// قديمًا قد يكون مربوطًا به، وإسقاطه من activeMappings يجعل مستندًا قديمًا بلا ربط فجأة.
const purposesFor=(db,tenantId,{include_disabled=false}={})=>optionsFor(db,tenantId,'ledger.purpose',{include_disabled})
  .options.map(o=>({key:o.value,name:o.label,account_type:o.extra?.account_type??null,state:o.state}));

function actor(db,supplied,action='read'){
  const u=supplied&&db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u)fail(403,'ledger_access_denied','الحساب غير متاح');
  u.permissions=financeCapabilities(db,u);
  if(!u.permissions.includes(action))fail(403,'ledger_access_denied','لا يوجد تفويض مالي صالح لهذا الإجراء');
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة المالية معاملة قاعدة بيانات');}

export function activeMappings(db,tenantId,date){
  const out={};
  for(const p of purposesFor(db,tenantId,{include_disabled:true})){
    const row=db.prepare('SELECT m.*,a.code,a.name AS account_name FROM finance_account_mappings m JOIN finance_accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.purpose=? AND m.approved_by IS NOT NULL AND m.effective_from<=? ORDER BY m.effective_from DESC,m.approved_at DESC LIMIT 1').get(tenantId,p.key,date);
    if(row)out[p.key]=row;
  }
  return out;
}
export function recordMapping(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['purpose','account_id','cost_center_id','effective_from']);
  requireOption(db,u.tenant_id,'ledger.purpose',input.purpose,{field:'الغرض المحاسبي'});
  const purpose=purposesFor(db,u.tenant_id).find(p=>p.key===input.purpose);
  const account=db.prepare('SELECT * FROM finance_accounts WHERE id=? AND tenant_id=? AND active=1').get(input.account_id,u.tenant_id);
  if(!account)fail(404,'not_found','الحساب غير متاح أو غير نشط');
  // غرضٌ بلا نوع حساب لا يطابقه حساب من أي نوع. كان الرفض يقارن بـnull فيطبع «يحتاج حسابًا من نوع null»
  // في نصّ عربي يقرؤه إنسان — والغرض ميّت في القائمة بلا ما يقول ذلك. الإضافة صارت تفرض الحقل، وهذا يحرس القديم.
  if(!purpose.account_type)refuse(409,'purpose_incomplete',{what:`لم يُسجَّل الربط: «${purpose.name}» غرضٌ بلا نوع حساب، فلا يطابقه حساب من أي نوع`,
    missing:[{document:'نوع الحساب الذي يقبله هذا الغرض',why:'الغرض أُضيف قبل أن تفرض القائمة هذا الحقل، فبقي بلا نوع',
      owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'}],
    next:'عطّل الغرض وأضفه من جديد بنوع حسابه، في «الخيارات المُدارة»'});
  if(account.account_type!==purpose.account_type)fail(409,'account_type',`«${purpose.name}» يحتاج حسابًا من نوع ${purpose.account_type}`);
  if(!db.prepare('SELECT 1 FROM finance_cost_centers WHERE id=? AND tenant_id=? AND active=1').get(input.cost_center_id,u.tenant_id))fail(404,'not_found','مركز التكلفة غير متاح');
  const mappingId=randomUUID();
  db.prepare('INSERT INTO finance_account_mappings(id,tenant_id,purpose,account_id,cost_center_id,effective_from,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(mappingId,u.tenant_id,purpose.key,account.id,input.cost_center_id,v.date(input.effective_from),u.id,now());
  audit(db,u,'account_mapping',mappingId,'mapping.recorded',{}, {purpose:purpose.key,account:account.code});
  return {id:mappingId};
}
export function approveMapping(db,supplied,mappingId,input){
  writing(db);
  const u=actor(db,supplied,'approve');
  v.object(input,['note']);
  const m=typeof mappingId==='string'&&db.prepare('SELECT * FROM finance_account_mappings WHERE id=? AND tenant_id=? AND approved_by IS NULL').get(mappingId,u.tenant_id);
  if(!m)fail(404,'not_found','الربط غير متاح للاعتماد');
  if(m.recorded_by===u.id)fail(403,'self_approval','من سجل الربط المحاسبي لا يعتمده');
  db.prepare('UPDATE finance_account_mappings SET approved_by=?,approved_at=? WHERE id=?').run(u.id,now(),m.id);
  audit(db,u,'account_mapping',m.id,'mapping.approved',{}, {purpose:m.purpose},v.text(input.note,'أساس الاعتماد',2000,3));
  return {id:m.id,approved:true};
}


/* ───── من المستند إلى القيد ───── */
// القائمة المُدارة تقرّر في ما تسمّيه: خيارٌ معطَّل أو مجهول يُرفض كما كان (option_not_offered). ونوعٌ سجّلته وحدة أخرى بعد
// تحميل هذا الملف لا تعرفه القائمة بعد: يُقبل لأن قارئه في الكود، ويستطيع المالك إضافته إليها ثم تعطيله متى شاء.
function openKind(db,tenantId,kind){
  const def=typeof kind==='string'?sourceKind(kind):null;
  const listed=typeof kind==='string'&&optionsFor(db,tenantId,'ledger.source_kind',{include_disabled:true}).options.some(o=>o.value===kind);
  if(!def||listed)requireOption(db,tenantId,'ledger.source_kind',kind,{field:'نوع المستند المصدر'});
  if(!def)refuse(409,'source_kind_unbuilt',{what:`«${optionLabel(db,tenantId,'ledger.source_kind',kind)}» خيار في القائمة وما له قارئ في الكود يبني قيده`,
    missing:[{document:'قارئ للمستند يُسجَّل بـregisterSourceKind في وحدته',why:'القيد يُبنى من أرقام المستند نفسه، والقائمة تسمّي الأنواع ولا تبنيها',owner:'فريق تطوير المنصة',owner_role:'admin'}],
    next:'عطّل الخيار من «الخيارات المُدارة» حتى يُبنى قارئه'});
  return def;
}
const kindLabel=(db,tenantId,def)=>{const label=optionLabel(db,tenantId,'ledger.source_kind',def.key);return label===def.key?def.name:label;};
// سطر المستند بصيغتيه: الصف القديم [غرض|{account_id}، مدين، دائن، بيان] كما بقيت عليه الأنواع القائمة، والكائن
// {purpose|account_id, cost_center_id, debit_minor, credit_minor, memo} الذي يحمل مركز تكلفة من المستند نفسه.
function sourceLine(line){
  const l=Array.isArray(line)?{target:line[0],debit_minor:line[1],credit_minor:line[2],memo:line[3],cost_center_id:null}
    :{target:line?.purpose??{account_id:line?.account_id},debit_minor:line?.debit_minor,credit_minor:line?.credit_minor,memo:line?.memo,cost_center_id:line?.cost_center_id??null};
  if(![l.debit_minor,l.credit_minor].every(n=>Number.isSafeInteger(n)&&n>=0))throw new TypeError(`سطر المستند بالهللات أعدادًا صحيحة غير سالبة: ${JSON.stringify(line)}`);
  return {...l,purpose:typeof l.target==='string'?l.target:null,account_id:typeof l.target==='string'?null:l.target?.account_id??null};
}
export function journalFromSource(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['source_kind','source_id','period_id']);
  const def=openKind(db,u.tenant_id,input.source_kind);
  if(typeof input.source_id==='string'&&db.prepare('SELECT 1 FROM finance_source_links WHERE source_kind=? AND source_id=? AND tenant_id=?').get(input.source_kind,input.source_id,u.tenant_id))fail(409,'duplicate_source','للمستند قيد محفوظ بالفعل؛ لا يُرحَّل مرتين');
  // المستحق الذي قيّده المسار اليدوي القديم له قيده: لا يُبنى له قيد ثانٍ من فاتورته (والمحفّز 167 يمنعه في القاعدة كذلك).
  const legacy=def.key==='supplier_invoice'&&typeof input.source_id==='string'&&db.prepare('SELECT l.journal_id,j.status FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.payable_id=? AND j.tenant_id=?').get(input.source_id,u.tenant_id);
  if(legacy)refuse(409,'duplicate_source',{what:'للمستحق قيد من المسار اليدوي القديم، فما يتجهز له قيد ثانٍ من فاتورته',
    missing:[{document:'القيد القديم نفسه: يُعتمد ويُرحَّل كما هو، أو يُعكس ثم يُسوّى بقيد يدوي',why:'المستحق الواحد التزامٌ واحد في الدفتر',...FINANCE_OWNER}],
    next:`افتح القيد ${legacy.journal_id.slice(0,8)} في «الدفتر المالي»`});
  const source=typeof input.source_id==='string'?def.build(db,u,input.source_id):null;
  if(!source)fail(404,'source_not_ready','المستند غير متاح أو لم يبلغ حالته النهائية (صادر، مؤكد، معتمد)');
  // هوية قيد المستحق (procurement_payable) لفاتورة المورد وحدها: نوعٌ آخر يحملها يصنع قيدًا ثانيًا للمستحق نفسه.
  if(source.payable&&def.key!=='supplier_invoice')throw new TypeError(`${def.key}: هوية قيد المستحق لفاتورة المورد وحدها`);
  const lines=source.lines.map(sourceLine);
  const mappings=activeMappings(db,u.tenant_id,source.date),missing=[...new Set(lines.map(l=>l.purpose).filter(p=>p&&!mappings[p]))];
  // الأسماء من القائمة المُدارة لا من مصفوفة الكود: غرضٌ أضافه المالك يُقرأ باسمه في الرفض كما يُقرأ في الشاشة.
  if(missing.length)fail(409,'mapping_required',`لا يوجد ربط محاسبي معتمد لـ: ${missing.map(p=>optionLabel(db,u.tenant_id,'ledger.purpose',p)).join('، ')}`);
  // سطر الحساب المباشر بلا مركز: قيد إقفال السنة وحده يأخذ مركز ربط الأرباح المبقاة كما كان. غيره يحمل مركزه من مستنده.
  const centre=l=>l.cost_center_id??(l.purpose?mappings[l.purpose].cost_center_id:def.key==='year_close'?mappings.retained_earnings.cost_center_id:null);
  for(const l of lines)if(!centre(l))throw new TypeError(`${def.key}: سطر على حساب مباشر بلا مركز تكلفة`);
  return createSourcedJournal(db,u,{sourceKind:def.key,sourceId:input.source_id,period_id:input.period_id,entry_date:source.date,description:source.description,evidence:`مولَّد من ${kindLabel(db,u.tenant_id,def)} ${source.reference} بأرقامه المعتمدة`,source_reference:source.reference,payable:source.payable??null,
    lines:lines.map(l=>({account_id:l.purpose?mappings[l.purpose].account_id:l.account_id,cost_center_id:centre(l),debit:decimal(l.debit_minor),credit:decimal(l.credit_minor),memo:l.memo}))});
}

// قيد كل مستند من رابطه: finance_source_links، ومعها رابط المستحق القديم (finance_payable_links) لفاتورة المورد.
function linkedJournals(db,tenantId){
  const linked=new Map(db.prepare("SELECT l.source_kind||':'||l.source_id AS key,j.status FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.tenant_id=?").all(tenantId).map(r=>[r.key,r.status]));
  for(const r of db.prepare("SELECT 'supplier_invoice:'||l.payable_id AS key,j.status FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=?").all(tenantId))if(!linked.has(r.key))linked.set(r.key,r.status);
  return linked;
}
// كل مستند نهائي بحالة قيده (بلا قيد، مسودة، معلّق، معتمد، مرحّل). يقرؤه طابور الاستثناءات المالية (app/finance-exceptions.mjs) وحزمة الإقفال.
export function pendingSources(db,u){
  const linked=linkedJournals(db,u.tenant_id);
  const rows=sourceKinds().flatMap(def=>def.pending?def.pending(db,u.tenant_id).map(r=>({source_kind:def.key,...r})):[]);
  // kind وkind_name اسمان ثانيان للنوع: حزمة الإقفال (R35 في app/reports-more.mjs) تقرأ بهما، وكانت تطبع خانة فارغة.
  return rows.map(r=>{const name=sourceKind(r.source_kind).name;return {...r,source_name:name,kind:r.source_kind,kind_name:name,journal_status:linked.get(`${r.source_kind}:${r.source_id}`)??null};}).sort((a,b)=>b.date.localeCompare(a.date));
}

/* ───── مطابقة الأستاذ المساعد بالحساب الرقابي ───── */
// لكل حساب رقابي: مجموع المستندات (الأستاذ المساعد) حتى التاريخ، مقابل رصيد حسابه في الدفتر من القيود المرحّلة حتى التاريخ
// نفسه، وكل فرق مُفرَد إلى مستند أو قيد بسببه. المستندات من سجل الأنواع (controls)، فنوعٌ يسجّله فريق آخر — تسوية مستحق،
// دفعة مرتجعة — يدخل الأستاذ المساعد لحسابه بلا تعديل هنا. قراءة فقط: لا تكتب شيئًا ولا تقترح قيدًا.
const CONTROL_ORDER=['receivable','payable','input_vat','output_vat','customer_advances','salaries_payable','employee_advances'];
export const RECONCILIATION_REASONS=Object.freeze({no_journal:'مستند ما له قيد',journal_not_posted:'قيده ما ترحّل',posted_after_date:'قيده مرحّل بعد تاريخ المطابقة',
  reversed:'قيده منعكس ولا قيد بعده',amount_mismatch:'قيده بمبلغ غير مبلغ المستند على هذا الحساب',document_after_date:'المستند بعد تاريخ المطابقة وقيده قبله',
  no_document:'قيد على الحساب الرقابي بلا مستند في أستاذه المساعد'});
function asOfDate(db,tenantId,period){
  if(period===undefined||period===null||period==='')return riyadhDate(now());
  if(typeof period==='object')return period.period_id?asOfDate(db,tenantId,period.period_id):asOfDate(db,tenantId,period.to);
  if(typeof period==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(period))return v.date(period);
  if(typeof period==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return monthEnd(period);
  const row=typeof period==='string'&&db.prepare('SELECT ends_on FROM finance_periods WHERE id=? AND tenant_id=?').get(period,tenantId);
  if(!row)refuse(404,'reconciliation_period',{what:'تاريخ المطابقة ما ينفهم: لا تاريخ ولا شهر ولا فترة محاسبية في كيانك بهذا المعرّف',next:'أرسل التاريخ بصيغة 2026-09-30، أو الشهر بصيغة 2026-09، أو معرّف فترة محاسبية'});
  return row.ends_on;
}
// كل قيد إلى مستنده: رابط المصدر، أو رابط المستحق القديم، وقيد العكس إلى مستند أصله.
function journalOwners(db,tenantId){
  const owners=new Map();
  for(const r of db.prepare('SELECT source_kind,source_id,journal_id FROM finance_source_links WHERE tenant_id=?').all(tenantId))owners.set(r.journal_id,{kind:r.source_kind,id:r.source_id});
  for(const r of db.prepare('SELECT l.payable_id,l.journal_id FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=?').all(tenantId))if(!owners.has(r.journal_id))owners.set(r.journal_id,{kind:'supplier_invoice',id:r.payable_id});
  for(const r of db.prepare('SELECT r.original_journal_id,r.reversal_journal_id FROM finance_reversals r JOIN finance_journals j ON j.id=r.original_journal_id WHERE j.tenant_id=?').all(tenantId)){const o=owners.get(r.original_journal_id);if(o)owners.set(r.reversal_journal_id,o);}
  return owners;
}
function journalsOf(db,tenantId,kind,id){
  const ids=db.prepare('SELECT journal_id FROM finance_source_links WHERE source_kind=? AND source_id=? AND tenant_id=?').all(kind,id,tenantId).map(r=>r.journal_id);
  if(kind==='supplier_invoice')for(const r of db.prepare('SELECT l.journal_id FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.payable_id=? AND j.tenant_id=?').all(id,tenantId))if(!ids.includes(r.journal_id))ids.push(r.journal_id);
  return ids.map(jid=>db.prepare('SELECT * FROM finance_journals WHERE id=? AND tenant_id=?').get(jid,tenantId)).filter(Boolean);
}
function reasonFor(db,tenantId,doc,asOf){
  const journals=journalsOf(db,tenantId,doc.source_kind,doc.source_id);
  if(!journals.length)return {reason:'no_journal',journal:null};
  const posted=journals.find(j=>j.status==='posted');
  if(!posted)return {reason:'journal_not_posted',journal:journals[0]};
  if(posted.entry_date>asOf)return {reason:'posted_after_date',journal:posted};
  const reversal=db.prepare("SELECT r.id,r.entry_date FROM finance_reversals x JOIN finance_journals r ON r.id=x.reversal_journal_id WHERE x.original_journal_id=? AND r.status='posted'").get(posted.id);
  if(reversal&&reversal.entry_date<=asOf)return {reason:'reversed',journal:posted};
  return {reason:'amount_mismatch',journal:posted};
}
export function controlReconciliation(db,tenantId,period){
  const asOf=asOfDate(db,tenantId,period),purposes=purposesFor(db,tenantId,{include_disabled:true});
  const keys=[...new Set(sourceKinds().flatMap(k=>Object.keys(k.controls)))].sort((a,b)=>(CONTROL_ORDER.indexOf(a)+1||99)-(CONTROL_ORDER.indexOf(b)+1||99)||a.localeCompare(b));
  const owners=journalOwners(db,tenantId);
  const controls=keys.map(key=>{
    const purpose=purposes.find(p=>p.key===key)??{key,name:key,account_type:null};
    const docs=sourceKinds().flatMap(k=>k.controls[key]?k.controls[key](db,tenantId).map(d=>({...d,source_kind:k.key,source_name:k.name})):[]);
    const inScope=docs.filter(d=>d.date<=asOf),subledger=inScope.reduce((n,d)=>n+d.amount_minor,0);
    const accounts=db.prepare('SELECT DISTINCT a.id,a.code,a.name FROM finance_account_mappings m JOIN finance_accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.purpose=? AND m.approved_by IS NOT NULL AND m.effective_from<=? ORDER BY a.code').all(tenantId,key,asOf);
    // غرضٌ بلا حساب مربوط وبلا مستند واحد في الكيان ما فيه ما يُطابَق: لا يُعرض فرقًا ولا يُسقط «متوازن». (الحزمة 4: حسابا الرواتب
    // الرقابيان انضمّا إلى السجل، وكيانٌ لم يُعدّ مسيرًا ولم يربط حساباتها كان سيُقرأ «غير متوازن» بلا مستند واحد.)
    // ومتى وُجد مستند واحد بلا ربط يُعرض «ما له حساب مربوط» كما كان، وهو ما يقرؤه طابور الاستثناءات وقائمة الإقفال.
    if(!accounts.length&&!docs.length)return null;
    const base={key,name:purpose.name,account_type:purpose.account_type,accounts,subledger_minor:subledger,documents:inScope.length};
    if(!accounts.length)return {...base,mapped:false,ledger_minor:null,difference_minor:null,items:[],balanced:false,
      why:`ما فيه ربط معتمد لغرض «${purpose.name}» حتى ${asOf}، فما فيه حساب رقابي يُطابَق عليه`};
    // الإشارة الطبيعية للحساب: المدين موجب في الأصل والمصروف، والدائن موجب في غيرهما — الإشارة نفسها في مستندات الأستاذ المساعد.
    const debitNatural=['asset','expense'].includes(purpose.account_type);
    const rows=db.prepare(`SELECT j.id,j.entry_date,j.source_reference,SUM(l.debit_minor) AS debit,SUM(l.credit_minor) AS credit FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id
      WHERE j.tenant_id=? AND j.status='posted' AND j.entry_date<=? AND l.account_id IN (${accounts.map(()=>'?').join(',')}) GROUP BY j.id ORDER BY j.entry_date,j.id`).all(tenantId,asOf,...accounts.map(a=>a.id));
    const natural=r=>debitNatural?r.debit-r.credit:r.credit-r.debit;
    const ledger=rows.reduce((n,r)=>n+natural(r),0);
    const docKey=(kind,id)=>`${kind}:${id}`,known=new Map(docs.map(d=>[docKey(d.source_kind,d.source_id),d])),scoped=new Set(inScope.map(d=>docKey(d.source_kind,d.source_id)));
    const byDoc=new Map(),items=[];
    for(const r of rows){
      const owner=owners.get(r.id),k=owner&&docKey(owner.kind,owner.id);
      if(k&&known.has(k)){byDoc.set(k,[...(byDoc.get(k)??[]),r]);continue;}
      items.push({reason:'no_document',source_kind:owner?.kind??'manual',source_name:owner?sourceKind(owner.kind)?.name??owner.kind:'قيد يدوي',source_id:owner?.id??null,
        reference:r.source_reference,date:r.entry_date,subledger_minor:0,ledger_minor:natural(r),difference_minor:-natural(r),journal_id:r.id,journal_status:'posted'});
    }
    for(const d of inScope){
      const k=docKey(d.source_kind,d.source_id),posted=(byDoc.get(k)??[]).reduce((n,r)=>n+natural(r),0);
      byDoc.delete(k);
      if(posted===d.amount_minor)continue;
      const {reason,journal}=reasonFor(db,tenantId,d,asOf);
      items.push({reason,source_kind:d.source_kind,source_name:d.source_name,source_id:d.source_id,reference:d.reference,date:d.date,subledger_minor:d.amount_minor,ledger_minor:posted,
        difference_minor:d.amount_minor-posted,journal_id:journal?.id??null,journal_status:journal?.status??null,...(d.note?{note:d.note}:{})});
    }
    // مستند بعد التاريخ وقيده قبله: أثره في الدفتر ولا مكان له في الأستاذ المساعد حتى تاريخه.
    for(const [k,list] of byDoc){if(scoped.has(k))continue;const d=known.get(k),posted=list.reduce((n,r)=>n+natural(r),0);if(!posted)continue;
      items.push({reason:'document_after_date',source_kind:d.source_kind,source_name:d.source_name,source_id:d.source_id,reference:d.reference,date:d.date,subledger_minor:0,ledger_minor:posted,difference_minor:-posted,journal_id:list[0].id,journal_status:'posted'});}
    const explained=items.reduce((n,i)=>n+i.difference_minor,0);
    return {...base,mapped:true,ledger_minor:ledger,difference_minor:subledger-ledger,explained_minor:explained,balanced:subledger===ledger,
      items:items.map(i=>({...i,reason_name:RECONCILIATION_REASONS[i.reason]})).sort((a,b)=>a.date.localeCompare(b.date)||a.reason.localeCompare(b.reason))};
  }).filter(Boolean);
  return {as_of:asOf,currency:'SAR',generated_at:now(),controls,balanced:controls.every(c=>c.mapped&&c.balanced),
    basis:'الأستاذ المساعد من المستندات النهائية بتاريخها، والدفتر من القيود المرحّلة لين التاريخ نفسه على كل حساب مربوط بالغرض. كل فرق له سطر يسمّي مستنده أو قيده وسببه، ومجموع السطور يطلع الفرق نفسه.'};
}
// المسار المقروء: من يحمل تفويض القراءة المالية في كيانه، ولا يكتب شيئًا.
export function controlBoard(db,supplied,input={}){
  const u=actor(db,supplied);
  v.object(input,['to','period_id']);
  return {...controlReconciliation(db,u.tenant_id,input.period_id??input.to),user_id:u.id,permissions:u.permissions};
}

/* ───── تتبّع المبلغ: من المستند إلى معتمده وقيده وتسويته وسطر البنك وعكسه ───── */
// السلسلة كانت تنقطع في ثلاثة مواضع: المستحق يرتبط بقيده بجدول وحده (finance_payable_links)، والمطابقة البنكية تشير إلى
// المستند لا إلى القيد، والقيد اليدوي مرجعه نص حر. التتبّع يعبر الأولين بالنوع والمعرّف نفسيهما، ويقول الثالث صراحةً.
// كل حلقة تُعرض: موصولة، أو «ما فيه» بسببها، أو «ما ينطبق» بسببها — لا صمت في موضع الانقطاع.
export const TRACE_STEPS=Object.freeze({source:'المستند المصدر',approvals:'الإعداد والاعتماد',journal:'القيد وترحيله',settles:'اللي يسوّيه هذا المستند',
  settlement:'التسوية',bank_match:'سطر كشف البنك',reversal:'العكس والإشعار الدائن'});
const person=(db,userId)=>userId?personName(db,userId):null;
function journalView(db,tenantId,j){
  const decision=db.prepare("SELECT actor_id,note,created_at FROM finance_decisions WHERE journal_id=? AND decision='approved' ORDER BY revision DESC LIMIT 1").get(j.id);
  const posting=db.prepare('SELECT posted_by,posted_at,note FROM finance_postings WHERE journal_id=?').get(j.id);
  const reversal=db.prepare('SELECT x.reversal_journal_id,x.requested_by,x.reason,x.created_at,r.status FROM finance_reversals x JOIN finance_journals r ON r.id=x.reversal_journal_id WHERE x.original_journal_id=?').get(j.id);
  return {journal_id:j.id,status:j.status,entry_date:j.entry_date,source_reference:j.source_reference,description:j.description,
    prepared_by:j.prepared_by,prepared_by_name:person(db,j.prepared_by),approved_by:decision?.actor_id??null,approved_by_name:person(db,decision?.actor_id),approved_at:decision?.created_at??null,
    posted_by:posting?.posted_by??null,posted_by_name:person(db,posting?.posted_by),posted_at:posting?.posted_at??null,
    lines:db.prepare('SELECT a.code AS account_code,a.name AS account_name,c.code AS cost_center_code,l.debit_minor,l.credit_minor,l.memo FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY l.position').all(j.id),
    reversal:reversal?{journal_id:reversal.reversal_journal_id,status:reversal.status,requested_by:reversal.requested_by,requested_by_name:person(db,reversal.requested_by),reason:reversal.reason,created_at:reversal.created_at}:null};
}
// مطابقات المستند من بنودها لا من رأسها (app/bank-reconciliation.mjs bankMatchesForSource، الترحيل 168): السجل داخل مطابقة مجمّعة
// لا يُكتب في الرأس أصلًا، والمجزّأ على سطرين يحمل الرأسُ أولهما وحده، والقيد اليدوي على حساب البنك عضوٌ بلا مستند. كان التتبّع
// يقرأ الرأس وحده، فيقول «ما طابق أحد سطر كشف» عن مالٍ مطابق ومعتمد.
const SHAPE_NAMES=Object.freeze({single:'سطر بسجل',group:'سطر واحد بعدة سجلات',split:'عدة سطور بسجل واحد'});
const bankMatchesOf=(db,tenantId,kind,id)=>bankMatchesForSource(db,tenantId,kind,id).map(m=>({...m,shape_name:SHAPE_NAMES[m.shape]??m.shape}));
// سطر الكشف المصنّف (bank_line) هو المستند نفسه: خطوة البنك فيه السطر، بتصنيفه وقرار تصنيفه.
function bankLineStep(db,tenantId,transactionId){
  const t=db.prepare(`SELECT t.id,t.txn_date,t.reference,t.description,t.debit_minor,t.credit_minor,m.id AS match_id,m.status,m.unmatched_reason,m.prepared_by,m.decided_by,m.decided_at
    FROM bank_transactions t LEFT JOIN bank_matches m ON m.transaction_id=t.id AND m.kind='unmatched' AND m.status<>'rejected' WHERE t.id=? AND t.tenant_id=?`).get(transactionId,tenantId);
  if(!t)return null;
  return {match_id:t.match_id,transaction_id:t.id,status:t.status,shape:'single',shape_name:SHAPE_NAMES.single,amount_minor:t.debit_minor+t.credit_minor,direction:t.credit_minor>0?'in':'out',
    txn_date:t.txn_date,reference:t.reference,description:t.description,reason:t.unmatched_reason,reason_name:t.unmatched_reason?UNMATCHED_REASONS[t.unmatched_reason]:null,
    prepared_by:t.prepared_by,prepared_by_name:person(db,t.prepared_by),decided_by:t.decided_by,decided_by_name:person(db,t.decided_by),decided_at:t.decided_at,source_kind:'bank_line',source_id:t.id};
}
const liveMatches=list=>list.filter(m=>m.status!=='rejected');
// جدول المطابقة البنكية يقبل أنواعًا بعينها (bank_matches.source_kind، الترحيل 050)، وقائمتها في وحدة البنك نفسها: متى وسّعها
// فريق البنك (قبض الدفعة المقدمة وارتدادها مثلًا) صار التتبّع يقرأ مطابقتها بلا تعديل هنا.
const matchable=kind=>Object.hasOwn(BANK_MATCHABLE,kind);
const stepOf=(step,state,items=[],why=null)=>({step,name:TRACE_STEPS[step],state,items,...(why?{why}:{})});
// مستند مرتبط بالسلسلة: وصفه، وقيده، ومطابقته البنكية إن كان نقدًا يقبله جدول المطابقة.
// والتسوية غير النقدية التي تصرف نقد مستندٍ آخر (تخصيصٌ من قبضٍ على الحساب) تُقرأ مطابقتها من ذلك المستند النقدي بخطوة واحدة
// عبر رابط «ما يسوّيه» (via يسمّيه)، فتصل الفاتورة التي سوّاها التخصيص إلى سطر الكشف الذي حمل المال.
// bank_matches كل سطور الكشف الحية (القبض المجزّأ على سطرين بسطريه)، وbank_match أولها لمن يقرأ سطرًا واحدًا.
function relatedItem(db,tenantId,item,origin=null){
  const def=sourceKind(item.kind),journal=journalsOf(db,tenantId,item.kind,item.id)[0]??null;
  let bank_matches=[];
  if(matchable(item.kind))bank_matches=liveMatches(bankMatchesOf(db,tenantId,item.kind,item.id));
  else for(const l of sourceLinks(item.kind,'settles')){
    for(const s of l.list(db,tenantId,item.id)){
      if(!matchable(s.kind)||(origin&&s.kind===origin.kind&&s.id===origin.id))continue;
      const found=liveMatches(bankMatchesOf(db,tenantId,s.kind,s.id));
      if(found.length){bank_matches=found.map(m=>({...m,via:{kind:s.kind,id:s.id,reference:s.reference??null}}));break;}
    }
    if(bank_matches.length)break;
  }
  return {...item,kind_name:def?.name??item.kind,journal:journal?{id:journal.id,status:journal.status,entry_date:journal.entry_date}:null,bank_match:bank_matches[0]??null,bank_matches};
}
function traceSource(db,u,def,id,via=null){
  const tenantId=u.tenant_id;
  const doc=def.document?def.document(db,tenantId,id):def.pending?.(db,tenantId).find(r=>r.source_id===id)??null;
  if(!doc)refuse(404,'trace_source_not_found',{what:`ما لقينا «${def.name}» بهذا المعرّف في كيانك`,next:'تأكد من المعرّف، أو ابدأ التتبّع من القيد نفسه (journal)'});
  const approvals=(def.approvals?.(db,tenantId,id)??[]).map(a=>({...a,actor_name:person(db,a.actor_id)}));
  const journals=journalsOf(db,tenantId,def.key,id).map(j=>journalView(db,tenantId,j));
  const links=role=>sourceLinks(def.key,role).flatMap(l=>l.list(db,tenantId,id)).map(item=>relatedItem(db,tenantId,item,{kind:def.key,id}));
  const settles=links('settles'),settlement=links('settlement'),reversals=links('reversal');
  const chain=[stepOf('source','linked',[{kind:def.key,id,kind_name:def.name,...doc}])];
  chain.push(approvals.length?stepOf('approvals','linked',approvals):stepOf('approvals','none',[],'هذا النوع ما يسجّل خطوة اعتماد مستقلة على المستند؛ اعتماده هو اعتماد قيده تحت'));
  chain.push(journals.length?stepOf('journal','linked',journals):stepOf('journal','none',[],'ما له قيد في الدفتر للحين — يتجهز من «القوائم المالية والترحيل» ويعتمده ويرحّله غير اللي أعدّه'));
  chain.push(sourceLinks(def.key,'settles').length?(settles.length?stepOf('settles','linked',settles):stepOf('settles','none',[],'المستند ما يسمّي مستندًا يسوّيه، أو اللي يسمّيه ما هو في كيانك')):stepOf('settles','not_applicable',[],'هذا المستند أصلٌ لا تسوية لغيره'));
  chain.push(sourceLinks(def.key,'settlement').length?(settlement.length?stepOf('settlement','linked',settlement):stepOf('settlement','none',[],def.key==='supplier_invoice'?'ما انصرف له أمر دفع للحين':'ما فيه مستند سوّاه للحين')):stepOf('settlement','not_applicable',[],'هذا المستند ما ينتظر تسوية'));
  // سطر البنك: سطر الكشف المصنّف هو نفسه خطوة البنك؛ وللنقد الذي يقبله جدول المطابقة مطابقاتُه من بنودها؛ ولغير النقد مطابقاتُ
  // تسوياته؛ والنقد الذي لا يقبله الجدول يُقال.
  const own=matchable(def.key)?bankMatchesOf(db,tenantId,def.key,id):[];
  if(def.key==='bank_line'){const line=bankLineStep(db,tenantId,id);
    chain.push(line?.status==='approved'?stepOf('bank_match','linked',[line]):stepOf('bank_match','none',line?[line]:[],'سطر الكشف ما اعتُمد تصنيفه للحين'));}
  else if(matchable(def.key))chain.push(liveMatches(own).length?stepOf('bank_match','linked',liveMatches(own)):stepOf('bank_match','none',own,'ما طابق أحد سطر كشف بنكي على هذا المستند للحين'));
  else if(def.bank==='cash')chain.push(stepOf('bank_match','none',[],'جدول المطابقة البنكية (الترحيل 050) ما يقبل هذا النوع للحين، فما ينربط به سطر كشف — بند مفتوح لفريق البنك'));
  else{const matched=settlement.flatMap(s=>s.bank_matches);
    chain.push(matched.length?stepOf('bank_match','linked',matched):settlement.length?stepOf('bank_match','none',[],'التسوية ما طابقها سطر كشف بنكي للحين'):stepOf('bank_match','not_applicable',[],'مستند غير نقدي، وما له تسوية نقدية تنطابق'));}
  const journalReversals=journals.filter(j=>j.reversal).map(j=>({kind:'journal_reversal',kind_name:'قيد عكس',id:j.reversal.journal_id,journal_id:j.reversal.journal_id,status:j.reversal.status,
    requested_by:j.reversal.requested_by,requested_by_name:j.reversal.requested_by_name,reason:j.reversal.reason,created_at:j.reversal.created_at,of_journal:j.journal_id}));
  const reversed=[...journalReversals,...reversals];
  chain.push(reversed.length?stepOf('reversal','linked',reversed):stepOf('reversal','none',[],'ما انعكس قيده ولا صدر عليه مستند عكسي'));
  return {kind:def.key,id,kind_name:def.name,document:doc,...(via?{via}:{}),chain,breaks:chain.filter(s=>s.state==='none').map(s=>({step:s.step,name:s.name,why:s.why}))};
}
// القيد اليدوي على حساب بنك مسجّل يُطابَق بسطر كشفه منذ الترحيل 168 (عضو side='journal'): خطوته مطابقته أو انقطاعٌ مسمّى.
// والقيد الذي لا يمسّ حساب بنك ما له سطر كشف أصلًا.
function manualBankStep(db,tenantId,j){
  const onBank=db.prepare('SELECT 1 FROM finance_lines l JOIN bank_accounts b ON b.gl_account_id=l.account_id AND b.tenant_id=? WHERE l.journal_id=? LIMIT 1').get(tenantId,j.id);
  if(!onBank)return stepOf('bank_match','not_applicable',[],'القيد ما يمسّ حساب بنك مسجّل، فما له سطر كشف');
  const matches=bankMatchesOf(db,tenantId,'journal',j.id);
  if(liveMatches(matches).length)return stepOf('bank_match','linked',liveMatches(matches));
  return stepOf('bank_match','none',matches,j.status==='posted'?'قيد يدوي على حساب البنك ما طابقه أحد بسطر كشف للحين':'القيد ما ترحّل، فما يُطابَق بسطر كشف');
}
function traceJournal(db,u,journalId){
  const j=typeof journalId==='string'&&db.prepare('SELECT * FROM finance_journals WHERE id=? AND tenant_id=?').get(journalId,u.tenant_id);
  if(!j)refuse(404,'trace_source_not_found',{what:'ما لقينا قيدًا بهذا المعرّف في كيانك',next:'افتح القيد من «الدفتر المالي» وانسخ معرّفه'});
  const owner=journalOwners(db,u.tenant_id).get(j.id),def=owner&&sourceKind(owner.kind);
  if(def)return traceSource(db,u,def,owner.id,{journal_id:j.id,entry:j.source_kind==='reversal'?'reversal':'journal'});
  const view=journalView(db,u.tenant_id,j);
  const chain=[stepOf('source','none',[],`قيد يدوي: مرجعه نص حر («${j.source_reference}») وما يربطه شي بمستند في المنصة. مصدره ودليله في وصفه وحده`),
    stepOf('approvals','not_applicable',[],'القيد اليدوي اعتماده هو اعتماد القيد نفسه تحت'),stepOf('journal','linked',[view]),
    stepOf('settles','not_applicable',[],'ما له مستند يسوّيه'),stepOf('settlement','not_applicable',[],'ما له مستند يُسوّى'),manualBankStep(db,u.tenant_id,j),
    view.reversal?stepOf('reversal','linked',[{kind:'journal_reversal',kind_name:'قيد عكس',id:view.reversal.journal_id,journal_id:view.reversal.journal_id,status:view.reversal.status,requested_by:view.reversal.requested_by,requested_by_name:view.reversal.requested_by_name,reason:view.reversal.reason,created_at:view.reversal.created_at,of_journal:j.id}])
      :stepOf('reversal','none',[],'ما انعكس القيد')];
  return {kind:'journal',id:j.id,kind_name:'قيد يدوي',document:null,chain,breaks:chain.filter(s=>s.state==='none').map(s=>({step:s.step,name:s.name,why:s.why}))};
}
// التتبّع مقروء لمن يحمل تفويض القراءة المالية في كيانه — نطاق شاشتي الدفتر والقوائم نفسه — ولا يكتب شيئًا.
export function traceAmount(db,supplied,input={}){
  const u=actor(db,supplied);
  v.object(input,['kind','id']);
  if(input.kind==='journal')return traceJournal(db,u,input.id);
  const def=typeof input.kind==='string'?sourceKind(input.kind):null;
  if(!def)refuse(404,'trace_kind_unknown',{what:'نوع المستند المطلوب تتبّعه ما هو من أنواع الدفتر',
    next:`الأنواع اللي تنتتبّع: ${sourceKinds().map(k=>k.key).join('، ')}، أو journal لقيد بمعرّفه`});
  if(typeof input.id!=='string'||!input.id)refuse(404,'trace_source_not_found',{what:`ما وصل معرّف «${def.name}» المطلوب تتبّعه`,next:'أرسل المعرّف مع النوع'});
  return traceSource(db,u,def,input.id);
}

function closableYears(db,u){
  const thisYear=riyadhDate(now()).slice(0,4);
  return db.prepare("SELECT DISTINCT substr(j.entry_date,1,4) AS year FROM finance_journals j WHERE j.tenant_id=? AND j.status='posted' AND substr(j.entry_date,1,4)<? ORDER BY year").all(u.tenant_id,thisYear).map(r=>r.year).filter(year=>!db.prepare("SELECT 1 FROM finance_source_links WHERE source_kind='year_close' AND source_id=? AND tenant_id=?").get(year,u.tenant_id));
}
export function statements(db,supplied,input={}){
  const u=actor(db,supplied),todayDate=riyadhDate(now());
  const from=input.from?v.date(input.from):`${todayDate.slice(0,4)}-01-01`,to=input.to?v.date(input.to):todayDate;
  if(to<from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
  const accounts=db.prepare('SELECT id,code,name,account_type FROM finance_accounts WHERE tenant_id=? ORDER BY code').all(u.tenant_id);
  const sum=(where,...args)=>new Map(db.prepare(`SELECT l.account_id,SUM(l.debit_minor) AS debit,SUM(l.credit_minor) AS credit FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=? AND j.status='posted' AND ${where} GROUP BY l.account_id`).all(u.tenant_id,...args).map(r=>[r.account_id,r]));
  const period=sum('j.entry_date BETWEEN ? AND ?',from,to),cumulative=sum('j.entry_date<=?',to);
  const natural=(type,row)=>!row?0:['asset','expense'].includes(type)?row.debit-row.credit:row.credit-row.debit;
  const section=(types,map)=>accounts.filter(a=>types.includes(a.account_type)).map(a=>({account_id:a.id,code:a.code,name:a.name,account_type:a.account_type,amount_minor:natural(a.account_type,map.get(a.id))})).filter(r=>r.amount_minor!==0);
  const total=rows=>rows.reduce((n,r)=>n+r.amount_minor,0);
  const income=section(['income'],period),expenses=section(['expense'],period);
  const assets=section(['asset'],cumulative),liabilities=section(['liability'],cumulative),equity=section(['equity'],cumulative);
  const retained=total(section(['income'],cumulative))-total(section(['expense'],cumulative));
  // كشف العملاء من المستندات نفسها لا من الدفتر، ليظهر ما صدر ولم يُرحَّل بعد. المحصَّل بتعريف منظور التحصيل الواحد
  // (ar_claim_collection، الترحيل 170): القبض المؤكد غير المرتد، والمخصص الحي من القبض على الحساب. كان الكشف يعدّ القبض المرتد
  // مقبوضًا ويتجاهل التخصيص، فيقول عن عميل ارتدّ شيكه إنه سدّد. والمال على الحساب غير المخصص رصيدٌ للعميل يُسمّى لا يُخصم.
  const customerCases=db.prepare(`SELECT k.id,k.name FROM commercial_cases k WHERE k.tenant_id=? AND (EXISTS(SELECT 1 FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id WHERE c.case_id=k.id AND t.status='issued')
    OR EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.case_id=k.id AND x.status='confirmed')) ORDER BY k.name`).all(u.tenant_id);
  const customers=customerCases.map(k=>{
    const docs=db.prepare("SELECT t.kind,t.number,t.total_minor,t.issued_at FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id WHERE c.case_id=? AND t.status='issued' ORDER BY t.chain_index").all(k.id);
    const receipts=db.prepare("SELECT r.reference,CAST(r.amount_minor AS INTEGER) AS amount,r.received_on FROM ar_receipts r JOIN ar_claims c ON c.id=r.claim_id WHERE c.case_id=? AND r.status='confirmed' ORDER BY r.received_on,r.id").all(k.id);
    const reversals=db.prepare("SELECT r.reference,CAST(a.amount_minor AS INTEGER) AS amount,a.effective_on FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id JOIN ar_claims c ON c.id=a.claim_id WHERE c.case_id=? AND a.kind='receipt_reversal' AND a.status='approved' ORDER BY a.effective_on,a.id").all(k.id);
    const allocations=db.prepare("SELECT y.id,y.kind,CAST(y.amount_minor AS INTEGER) AS amount,y.created_at,x.reference FROM ar_allocations y JOIN ar_account_receipts x ON x.id=y.account_receipt_id WHERE x.case_id=? ORDER BY y.created_at,y.rowid").all(k.id);
    const cash=db.prepare(`SELECT CAST(x.amount_minor AS INTEGER) AS amount,
        (SELECT COALESCE(SUM(CASE y.kind WHEN 'allocation' THEN CAST(y.amount_minor AS INTEGER) ELSE -CAST(y.amount_minor AS INTEGER) END),0) FROM ar_allocations y WHERE y.account_receipt_id=x.id) AS allocated
      FROM ar_account_receipts x WHERE x.case_id=? AND x.status='confirmed' AND NOT EXISTS(SELECT 1 FROM ar_account_reversals v WHERE v.account_receipt_id=x.id AND v.status='approved')`).all(k.id);
    const sum=(list,amount)=>list.reduce((n,r)=>n+amount(r),0);
    const invoiced=sum(docs.filter(d=>d.kind==='invoice'),d=>d.total_minor),credited=sum(docs.filter(d=>d.kind==='credit_note'),d=>d.total_minor);
    const received=sum(receipts,r=>r.amount)-sum(reversals,r=>r.amount),allocated=sum(allocations,y=>y.kind==='allocation'?y.amount:-y.amount);
    const allocationRef=y=>`${y.kind==='allocation'?'ALLOC':'ALLOC-REV'}-${y.id.slice(0,8)}`;
    return {id:k.id,name:k.name,invoiced_minor:invoiced,credited_minor:credited,received_minor:received,allocated_minor:allocated,
      on_account_minor:sum(cash,x=>Math.max(0,x.amount-x.allocated)),balance_minor:invoiced-credited-received-allocated,
      movements:[...docs.map(d=>({date:riyadhDate(d.issued_at),reference:d.number,kind:d.kind==='invoice'?'فاتورة':'إشعار دائن',amount_minor:d.kind==='invoice'?d.total_minor:-d.total_minor})),
        ...receipts.map(r=>({date:r.received_on,reference:r.reference,kind:'قبض مؤكد',amount_minor:-r.amount})),
        ...reversals.map(r=>({date:r.effective_on,reference:`REV-${r.reference}`.slice(0,170),kind:'ارتداد قبض',amount_minor:r.amount})),
        ...allocations.map(y=>({date:riyadhDate(y.created_at),reference:allocationRef(y),kind:y.kind==='allocation'?`تخصيص من القبض ${y.reference}`:`عكس تخصيص من القبض ${y.reference}`,amount_minor:y.kind==='allocation'?-y.amount:y.amount}))]
        .sort((a,b)=>a.date.localeCompare(b.date))};
  });
  // كشف الموردين من الرؤية payable_balances (الترحيل 166) التي يفرضها قادح الرصيد: المدفوع بسطور الأوامر المنفّذة غير الراجعة،
  // والتسويات المعتمدة (إشعار دائن أو مدين من المورد)، وما في الطريق. كان يجمع «أمر = دفعة» على payment_orders.payable_id،
  // فيُنسب الأمر المجمّع كله لأول مستحق فيه، ويبقى المرتجع مدفوعًا، ولا ينقص الإشعار الدائن شيئًا.
  const suppliers=db.prepare(`SELECT i.supplier_key,MAX(o.supplier_name) AS name,SUM(b.amount_minor) AS matched,SUM(b.debit_minor-b.credit_minor) AS adjustments,SUM(b.paid_minor) AS paid,
      SUM(b.returned_minor) AS returned,SUM(b.approved_minor) AS approved,SUM(b.pending_minor) AS pending,SUM(b.outstanding_minor) AS outstanding
    FROM payable_balances b JOIN procurement_payables y ON y.id=b.payable_id JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_orders o ON o.purchase_id=y.purchase_id
    WHERE i.tenant_id=? GROUP BY i.supplier_key ORDER BY name`).all(u.tenant_id)
    .map(r=>({supplier_key:r.supplier_key,name:r.name,matched_minor:r.matched,adjustments_minor:r.adjustments,paid_minor:r.paid,returned_minor:r.returned,
      approved_unpaid_minor:r.approved,pending_minor:r.pending,balance_minor:r.outstanding}));
  const issued=db.prepare("SELECT kind,net_minor,vat_minor,issued_at FROM tax_invoices WHERE tenant_id=? AND status='issued'").all(u.tenant_id).filter(d=>{const date=riyadhDate(d.issued_at);return date>=from&&date<=to;});
  const vat=kind=>issued.filter(d=>d.kind===kind).reduce((n,d)=>n+d.vat_minor,0),net=kind=>issued.filter(d=>d.kind===kind).reduce((n,d)=>n+d.net_minor,0);
  // الأغراض بالمعطَّل: activeMappings تقرأ بـinclude_disabled عمدًا لأن ربطًا معتمدًا وساريًا قد يكون على غرض
  // عُطِّل، فكانت الشاشة تُسقطه وحدها — الربط الذي يقرّر حساب الإيراد لكل فاتورة يختفي من الشاشة الوحيدة التي
  // تعرضه، بلا سطر يقول إنه أُخفي، والدفتر ما زال يستعمله. الآن يُعرض موسومًا بحالته (state) وتَسِمه الشاشة.
  const sources=pendingSources(db,u),purposes=purposesFor(db,u.tenant_id,{include_disabled:true});
  const mapped=activeMappings(db,u.tenant_id,to);
  return {currency:'SAR',from,to,generated_at:now(),user_id:u.id,permissions:u.permissions,purposes,
    basis:'القوائم من القيود المرحّلة فقط. مستند صدر ولم يُرحَّل قيده لا يظهر فيها، ويظهر في «مستندات بانتظار الترحيل».',
    income_statement:{income,expenses,total_income_minor:total(income),total_expenses_minor:total(expenses),net_minor:total(income)-total(expenses)},
    balance_sheet:{as_of:to,assets,liabilities,equity,retained_earnings_minor:retained,total_assets_minor:total(assets),total_liabilities_equity_minor:total(liabilities)+total(equity)+retained,balanced:total(assets)===total(liabilities)+total(equity)+retained},
    customers,suppliers,closable_years:closableYears(db,u),
    vat:(()=>{const output=vat('invoice')-vat('credit_note'),inputVat=verifiedInputVat(db,u.tenant_id,from,to);return {output_vat_minor:output,taxable_sales_minor:net('invoice')-net('credit_note'),input_vat_minor:inputVat,net_vat_minor:inputVat===null?null:output-inputVat,note:'ضريبة المخرجات من المستندات الصادرة في الفترة، وضريبة المدخلات من فواتير الموردين الضريبية المتحقق منها بتاريخ الفاتورة. ملخص داخلي يراجعه مختص ضريبي؛ ليس إقرارًا مقدمًا للهيئة.'};})(),
    // نداء واحد لـactiveMappings يُعاد استعماله، لا نداءٌ لكل غرض: كان سبعة عشر نداءً في كل فتح للشاشة.
    mappings:purposes.map(p=>({...p,active:mapped[p.key]??null})),
    // لوحة الخيارات المُدارة كاملة، لا قوائم الدفتر وحدها. سببها صريح: مسار /api/options لم يُوصل بعد
    // (app/server.mjs عند فريق آخر)، وحمولة القوائم المالية هي الشاشة التي يفتحها من يحمل تفويض المالية.
    // فمن اليوم الأول يرى المالك **كل** قائمة مُدارة وخياراتها وحالتها ومادتها ومن غيّرها — ولا يغيّرها من
    // هنا. وحين تصل المسارات تنتقل اللوحة إلى شاشتها ويبقى هذا الحقل كما هو أو يُسحب بقرار مكتوب.
    managed_options:listsBoard(db,u.tenant_id,['finance','procurement','vendors','payables']),
    // مراكز تكلفة الإدارات (الحزمة 4، P4-HR-3): على أي مركز تنقيد رواتب كل إدارة، وما ينتظر قرار زميل.
    department_centres:departmentCentresView(db,u,{permissions:u.permissions}),
    pending_mappings:db.prepare('SELECT m.*,a.code,a.name AS account_name,x.name AS recorded_by_name FROM finance_account_mappings m JOIN finance_accounts a ON a.id=m.account_id JOIN users x ON x.id=m.recorded_by WHERE m.tenant_id=? AND m.approved_by IS NULL ORDER BY m.created_at DESC').all(u.tenant_id),
    accounts:db.prepare('SELECT id,code,name,account_type FROM finance_accounts WHERE tenant_id=? AND active=1 ORDER BY code').all(u.tenant_id),
    cost_centers:db.prepare('SELECT id,code,name FROM finance_cost_centers WHERE tenant_id=? AND active=1 ORDER BY code').all(u.tenant_id),
    periods:db.prepare("SELECT id,name,starts_on,ends_on FROM finance_periods WHERE tenant_id=? AND status='open' ORDER BY starts_on DESC").all(u.tenant_id),
    sources,unposted:sources.filter(s=>s.journal_status!=='posted').length};
}
