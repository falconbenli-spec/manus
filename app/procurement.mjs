import {reservePurchaseBudget,commitPurchaseBudget,releasePurchaseBudget,purchaseBudgetState,budgetGuard,recordCommitmentMovement,commitmentOf} from './budgets.mjs';
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { vendorGate,requireVendorGate,requireRegisteredVendor } from './vendors.mjs';
import { approvedEmergency,closedShort,conflictBlock,effectiveOrder,lineFacts,invoiceState,creditRequests,paymentHold,balanceOf,payableVoided,liveInvoiceSql,itemActions,schemaOf } from './procurement-guards.mjs';
import { financeCapabilities } from './finance.mjs';
import { personName } from './people-read.mjs';
import { assertReadyForPaidExecution,authoriseCommencement,replaceCommencement,withdrawCommencement,commencementOf,commencementHistory,requireSupplierStart,COMMENCEMENT_FIELDS } from './project-axes.mjs';
import { assertFinanciallyOpen } from './project-closure-guard.mjs';
import { registerOptionList,registerAdoption,optionsFor,requireOption,adopted,listsBoard } from './options.mjs';
// مركز التكلفة يعيش في وحدة محايدة تستوردها المخصصات أيضًا؛ يُعاد تصديره هنا لأن هذه هي واجهة المشتريات المعروفة.
import { resolveCostCenter } from './cost-centres.mjs';
export { resolveCostCenter } from './cost-centres.mjs';
import { MODULE_STATUS_MAP } from './static/vocabulary.mjs';
import { rfqsForPurchase, currentRfq, rfqActionsForPurchase, submitPurchaseRfq, assertApprovedRfqForOrder } from './procurement-rfq.mjs';

// عبارات الحالات من القاموس الواحد (app/static/vocabulary.mjs) لا من نصّ يُكتب هنا: مصدر واحد للعبارة،
// فلا تختلف شاشتان على كلمة ولا تُخترع عبارة محلية جديدة عند كل قائمة مقفلة.
export const statusOptions=module=>Object.entries(MODULE_STATUS_MAP[module]).map(([value,entry])=>({value,label:entry.phrase,extra:{canonical:entry.status}}));

const MAX_MINOR = 1_000_000_000_000;
const roles = ['employee', 'manager', 'pm'];
const purchaseFields = ['title','specification','cost_center','due_date','quantity','unit','budget_amount','budget_evidence','currency','lines'];
const actionFields = {
  edit: purchaseFields,
  submit: [],
  add_quote: ['supplier_key','supplier_name','unit_price','line_prices','technical_assessment','financial_terms','delivery_date','evidence'],
  award: ['quote_id','note'],
  approve_order: ['terms','delivery_date','note'],
  // أمر المباشرة: أمر الشراء ليس إذن البدء (تدقيق دورة العميل، B6). app/project-axes.mjs والترحيلان 116 و162:
  // الإذن يحمل مدة سريانه ودليل إبلاغ المورد، ويُستبدل بسبب مكتوب، ويُسحب بسبب ودليل — ولا يُعدَّل ولا يُمحى.
  commence: COMMENCEMENT_FIELDS,
  replace_commencement: [...COMMENCEMENT_FIELDS,'reason'],
  withdraw_commencement: ['reason','evidence'],
  receive: ['quantity','lines','reference','evidence'],
  record_invoice: ['supplier_reference','quantity','amount','lines','evidence'],
  match: ['invoice_id','note'],
  reject: ['note'],
  cancel: ['note']
};

// حالات طلب الشراء مقفلة مرتين: الكود **وقيد CHECK** في الترحيل 005. تُعرض للمالك بقيدها ورقم ترحيلها ليرى
// لماذا هي مقفلة، بدل أن تغيب عنه أو يظنها اختيارًا مدفونًا. وفتحها يحتاج ترحيلًا يعيد بناء الجدول وحده.
registerOptionList({key:'procurement.purchase_status',label:'حالة طلب الشراء',label_en:'Purchase status',module:'procurement',
  owner:'مسؤول المشتريات',owner_role:'pm',governance:'db_locked',columns:['procurement_purchases.status'],
  db_locked:{check:"status IN ('draft','sourcing','awarded','ordered','part_received','received','rejected','cancelled')",migration:'005'},
  defaults:statusOptions('purchase'),extra_shape:{canonical:'الحالة المقابلة من الحالات الثماني في القاموس الواحد'},
  note:'الحالات وانتقالاتها محروسة بقوادح في القاعدة (procurement_state)، فلا تُضاف حالة من الشاشة.'});

// حد فرق فاتورة المورد (الترحيل 169، ب9 في DECISIONS-NEEDED): قيمة للمالك مسجّلة بلا رقم. ما دامت كذلك لا حدّ: كل فرق يوقف
// الفاتورة، ولا يقبله إلا معتمد مالي بمبرر مكتوب. وحين يُعتمد رقم بشخصين يقبل معتمدٌ مستقل الفرقَ داخله بلا مبرر مالي —
// والفاتورة تبقى موقوفة حتى يقرر: لا قبول آلي أبدًا. وفرق الكمية لا يدخل حد السعر: دفعٌ عن بضاعة لن تصل ليس تقريبًا.
export const VARIANCE_TOLERANCE='procurement.invoice_variance_tolerance';
registerAdoption({key:VARIANCE_TOLERANCE,label:'حد فرق فاتورة المورد المقبول بلا مبرر مالي',module:'procurement',
  owner:'مالك المشتريات ومالك المالية معًا',owner_role:'finance',manage_capability:'finance.use',governance:'managed',shape:'object',
  default:{percent:null,amount:null},
  basis:'ما تقرر حد بعد (ب9): المنصة ما تخترع نسبة ولا مبلغ، فكل فرق يوقف الفاتورة ويقرره معتمد مستقل، وقبوله بلا حد معتمد يحتاج مبررًا مكتوبًا من معتمد مالي. القيمة {"percent":"2.00","amount":"500.00"}: الفرق لا يتعدى النسبة من قيمة الفاتورة بأسعار الأمر ولا المبلغ، وأيهما تُرك null لا يُقاس'});
const TOLERANCE_NUMBER=/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/;
const hundredths=value=>typeof value==='string'&&TOLERANCE_NUMBER.test(value)?Number(BigInt(value.split('.')[0])*100n+BigInt((value.split('.')[1]??'').padEnd(2,'0'))):null;
export function varianceTolerance(db,tenantId){
  const decision=adopted(db,tenantId,VARIANCE_TOLERANCE),percent=hundredths(decision.value?.percent),amount=hundredths(decision.value?.amount);
  return {decision,percent_hundredths:percent,amount_minor:amount,set:decision.source==='adopted'&&(percent!==null||amount!==null)};
}
// داخل الحد: حدٌّ معتمد، ولا فرق كمية، والانحراف (زيادةً أو نقصًا عن سعر الأمر) لا يتعدى المبلغ ولا النسبة من قيمة الفاتورة بأسعار الأمر.
export function withinTolerance(tolerance,variance){
  if(!tolerance.set||variance.quantity_variance>0)return false;
  if(tolerance.amount_minor!==null&&variance.deviation_minor>tolerance.amount_minor)return false;
  if(tolerance.percent_hundredths!==null&&BigInt(variance.deviation_minor)*10000n>BigInt(variance.order_value_minor)*BigInt(tolerance.percent_hundredths))return false;
  return true;
}

function actor(db, supplied) {
  const u = supplied && db.prepare('SELECT id,tenant_id,department_id,role,manager_id,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id, supplied.tenant_id);
  if (!u) fail(403, 'forbidden', 'ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');
  return u;
}

function requireTransaction(db) {
  if (!db.isTransaction) fail(500,'transaction_required','كتابة المشتريات تبي معاملة قاعدة بيانات');
}

function project(db, u, projectId) {
  if (typeof projectId !== 'string' || !roles.includes(u.role)) fail(404, 'project_not_found', 'ما لقينا المشروع هذا');
  const p = db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(projectId,u.tenant_id,u.id);
  if (!p) fail(404, 'project_not_found', 'ما لقينا المشروع هذا');
  return p;
}

function scope(db, u, p) {
  if (!roles.includes(u.role) || p.tenant_id !== u.tenant_id || !db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(p.project_id,u.id)) return false;
  if (p.requester_id === u.id) return true;
  if (u.role === 'manager') return !!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND department_id=? AND manager_id=? AND active=1').get(p.requester_id,u.tenant_id,u.department_id,u.id);
  if (u.role === 'pm') return !!db.prepare('SELECT 1 FROM procurement_project_grants WHERE project_id=? AND user_id=?').get(p.project_id,u.id);
  return false;
}

function access(db, u, id) {
  const p = typeof id === 'string' && db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if (!p || !scope(db,u,p)) fail(404,'not_found','ما لقينا طلب الشراء هذا');
  return p;
}

function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value)) fail(400,'invalid_money','اكتب المبلغ رقم عشري موجب، وبمنزلتين عشريتين على الأكثر');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2,'0'));
  if (minor < 1n || minor > BigInt(MAX_MINOR)) fail(400,'invalid_money','المبلغ خارج الحد العددي المحلي');
  return Number(minor);
}

// مبلغ بالهللة إلى نصّ بالريال، بإشارته: فرق السعر قد يكون لصالحنا (سالبًا).
const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;

function quantity(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail(400,'invalid_quantity','الكمية رقم صحيح بين 1 و1000000');
  return value;
}

function total(qty, unitPrice) {
  const result = BigInt(qty) * BigInt(unitPrice);
  if (result > BigInt(MAX_MINOR)) fail(400,'invalid_money','إجمالي القيمة يتعدّى الحد العددي المحلي');
  return Number(result);
}

function minorSum(values) {
  const result=values.reduce((sum,value)=>sum+BigInt(value),0n);
  if(result<1n||result>BigInt(MAX_MINOR))fail(400,'invalid_money','إجمالي القيمة يتعدّى الحد العددي المحلي');
  return Number(result);
}

function reference(value, label) {
  return v.text(value,label,120).normalize('NFKC').trim().replace(/\s+/gu,' ').toUpperCase();
}

/* ───── الخيارات المُدارة (الترحيل 134): وحدة القياس ───── */
// مركز التكلفة وقائمته وحلّه في app/cost-centres.mjs: تحتاجه المخصصات أيضًا، ووضعه هنا يصنع دورة استيراد
// بين الوحدتين. الاصطلاح نفسه الذي عليه app/procurement-guards.mjs.

// وحدة القياس: العمود unit نصّ بلا CHECK، فثلاثة عروض بثلاث كتابات للوحدة نفسها مقارنةُ أرقام لا مقارنةُ أسعار.
// القائمة تُشحن بالوحدات الجارية اليوم، ويبقى الحقل مفتوحًا للنصّ كما كان حتى يقرر المالك إغلاقه — لأن إغلاق
// قائمة لا يملك المالك بعدُ شاشةً يضيف إليها خيارًا فخٌّ لا حراسة. القيمة المخزَّنة هي الكلمة نفسها لا مفتاح
// لاتيني، فالسجل القديم يُقرأ كما كُتب ولا يتبدّل ما يخزّنه العمود.
registerOptionList({key:'procurement.unit',label:'وحدة القياس',label_en:'Unit of measure',module:'procurement',
  owner:'مسؤول المشتريات',owner_role:'pm',manage_capability:'procurement.use',governance:'managed',columns:['procurement_purchases.unit'],
  defaults:['وحدة','نسخة','قطعة','صندوق','كرتون','يوم','ساعة','شهر','سنة','متر','متر مربع','كيلوجرام','لتر','زيارة','جلسة','منشور','تصميم','مشاهدة','نقرة','حساب','رخصة','اشتراك','دفعة','خدمة']
    .map(name=>({value:name,label:name})),
  note:'الوحدة تُخزَّن بكلمتها كما كانت. إغلاق الحقل على القائمة قرارٌ منفصل (procurement.unit_closed).'});
registerAdoption({key:'procurement.unit_closed',label:'إغلاق وحدة القياس على القائمة',module:'procurement',
  owner:'مسؤول المشتريات',owner_role:'pm',manage_capability:'procurement.use',governance:'managed',default:false,
  basis:'سلوك اليوم: الوحدة نصّ حرّ. تُغلق حين تكتمل القائمة بوحدات العمل الجارية وتتوفر شاشة إدارتها'});

// الوحدة: تُقبل نصًّا كما كانت، وتُرفض خارج القائمة متى أُغلق الحقل بقرار معتمد — الرفض يسمّي «وحدة القياس» ومالكها.
function cleanUnit(db,tenantId,value) {
  const unit = v.text(value,'الوحدة',60);
  if (adopted(db,tenantId,'procurement.unit_closed').value===true) requireOption(db,tenantId,'procurement.unit',unit,{field:'وحدة القياس'});
  return unit;
}

function cleanPurchase(db,tenantId,input) {
  if (input.currency !== 'SAR') fail(400,'invalid_currency','العملة المتاحة محليًا هي SAR وبس');
  const common={
    title:v.text(input.title,'عنوان الاحتياج',180),
    specification:v.text(input.specification,'المواصفات',3000,3),
    due_date:v.date(input.due_date),
    currency:'SAR',
    budget_evidence:v.text(input.budget_evidence,'دليل المخصص المحلي',3000,3)
  };
  if(input.lines!==undefined){
    if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>100)fail(400,'invalid_purchase_lines','أضف من بند واحد إلى 100 بند للطلب');
    const lines=input.lines.map((row,index)=>{
      v.object(row,['description','quantity','unit','cost_center','budget_amount']);
      const center=resolveCostCenter(db,tenantId,row.cost_center);
      return {line_no:index+1,description:v.text(row.description,`وصف البند ${index+1}`,500,3),quantity:quantity(row.quantity),unit:cleanUnit(db,tenantId,row.unit),
        cost_center:center.text,cost_center_id:center.id,budget_minor:money(row.budget_amount)};
    });
    if(new Set(lines.map(line=>line.cost_center_id??line.cost_center)).size!==1)fail(409,'multiple_cost_centres_not_supported','الطلب متعدد البنود يحتاج مركز تكلفة واحدًا حاليًا لأن حجز مخصص المشروع موحد');
    const budget_minor=minorSum(lines.map(line=>line.budget_minor)),first=lines[0],multiple=lines.length>1;
    return {fields:{title:common.title,specification:common.specification,cost_center:first.cost_center,cost_center_id:first.cost_center_id,due_date:common.due_date,
      quantity:multiple?1:first.quantity,unit:multiple?'طلب متعدد البنود':first.unit,currency:common.currency,budget_minor,budget_evidence:common.budget_evidence},lines};
  }
  const center = resolveCostCenter(db,tenantId,input.cost_center);
  const fields={title:common.title,specification:common.specification,cost_center:center.text,cost_center_id:center.id,due_date:common.due_date,
    quantity:quantity(input.quantity),unit:cleanUnit(db,tenantId,input.unit),currency:common.currency,budget_minor:money(input.budget_amount),budget_evidence:common.budget_evidence};
  return {fields,lines:[{line_no:1,description:fields.specification,quantity:fields.quantity,unit:fields.unit,cost_center:fields.cost_center,cost_center_id:fields.cost_center_id,budget_minor:fields.budget_minor}]};
}

function purchaseLines(db,purchaseId) {
  const allocations=db.prepare('SELECT * FROM procurement_line_allocations WHERE purchase_line_id=? ORDER BY position,id');
  return db.prepare('SELECT * FROM procurement_purchase_lines WHERE purchase_id=? ORDER BY line_no,id').all(purchaseId)
    .map(line=>({...line,allocations:allocations.all(line.id)}));
}

function orderLines(db,purchaseId) {
  return db.prepare('SELECT * FROM procurement_order_lines WHERE purchase_id=? ORDER BY line_no,id').all(purchaseId);
}

function quotePrices(input,lines) {
  if(lines.length===1&&input.line_prices===undefined){
    return [{...lines[0],unit_price_minor:money(input.unit_price)}];
  }
  if(!Array.isArray(input.line_prices)||input.line_prices.length!==lines.length)fail(400,'invalid_quote_lines','سعّر كل بند في طلب الشراء مرة واحدة');
  const byId=new Map(lines.map(line=>[line.id,line])),seen=new Set();
  const priced=input.line_prices.map((row,index)=>{
    v.object(row,['purchase_line_id','unit_price']);
    const line=typeof row.purchase_line_id==='string'&&byId.get(row.purchase_line_id);
    if(!line||seen.has(line.id))fail(400,'invalid_quote_lines','أسعار العرض فيها بند ناقص أو مكرر أو مو تابع للطلب');
    seen.add(line.id);
    return {...line,unit_price_minor:money(row.unit_price),input_position:index};
  });
  return lines.map(line=>priced.find(row=>row.id===line.id));
}

function selectedDocumentLines(inputLines,order,kind) {
  if(!Array.isArray(inputLines)||inputLines.length<1||inputLines.length>order.length)fail(400,`invalid_${kind}_lines`,'أدخل بندًا واحدًا على الأقل من بنود الأمر');
  const byId=new Map(order.map(line=>[line.id,line])),seen=new Set();
  return inputLines.map(row=>{
    const allowed=kind==='invoice'?['order_line_id','quantity','amount']:['order_line_id','quantity'];
    v.object(row,allowed);
    const line=typeof row.order_line_id==='string'&&byId.get(row.order_line_id);
    if(!line||seen.has(line.id))fail(400,`invalid_${kind}_lines`,'البنود فيها بند مكرر أو مو تابع لأمر الشراء');
    seen.add(line.id);
    const cleaned={...line,quantity_input:quantity(row.quantity)};
    if(kind==='invoice')cleaned.amount_minor=money(row.amount);
    return cleaned;
  });
}

function noConflict(db,u,supplierKey) {
  const block = conflictBlock(db,u.tenant_id,u.id,supplierKey);
  if (block) fail(409,'conflict_of_interest',block==='recused'?'تنحّيت عن قرارات هذا المورد بقرار تعارض مصالح؛ يتخذ القرار شخص آخر':'لك إفصاح تعارض مصالح مع هذا المورد لم يُبت فيه بعد؛ يتخذ القرار شخص آخر');
}
// يستخدمها استكمال المشتريات (الطارئ وتعديل الأمر) لتطبيق نطاق الرؤية نفسه.
export function purchaseFor(db,supplied,id) {
  const u = actor(db,supplied),p = access(db,u,id);
  return {u,p,own:p.requester_id===u.id,reviewer:p.requester_id!==u.id&&['manager','pm'].includes(u.role)};
}
// حالة السداد والترحيل تُقرأ من مصدرها لا من نص ثابت (تدقيق دورة التسليم 20260920، B3).
// كانت stateData تعيد 'not_paid' و'not_posted' نصين ثابتين، فيبقى طلب الشراء «غير مدفوع» في شاشته
// بعد توثيق التحويل كاملًا في payables — وحدتان تقولان شيئين مختلفين عن الحدث نفسه، ومن يفتح المشتريات
// يدفع مرتين. المصدران الحقيقيان اليوم: payable_balances للرصيد (الترحيل 166)، وfinance_payable_links للقيد.
const PAYMENT_RANK={not_paid:0,payment_pending:1,payment_approved:2};
export const PAYMENT_STATUS_NAMES={not_paid:'غير مدفوع',payment_pending:'أمر دفع بانتظار الاعتماد',
  payment_approved:'أمر دفع معتمد لم يُنفَّذ بعد',partially_paid:'مدفوع جزئيًا',paid:'مدفوع',
  // مستحق سوّته الإشعارات الدائنة (أو إلغاؤه) كله: لا شيء عليه ولا شيء دُفع — عبارة المدفوعات نفسها (BALANCE_STATUS في app/payables.mjs).
  settled:'ما عليه شيء بعد الإشعارات'};
export const POSTING_STATUS_NAMES={not_posted:'غير مرحّل',partially_posted:'مرحّل جزئيًا',
  posted_locally:'مرحّل محليًا',reversed_locally:'عُكس محليًا'};
// أوامر الدفع التي تمسّ هذا المستحق من سطورها (الترحيل 166): الأمر الواحد قد يدفع جزءًا منه أو يدفعه مع مستحقات أخرى.
const paymentOrdersOf=(db,payableId)=>!schemaOf(db).lines?db.prepare('SELECT id,status,amount_minor AS order_amount_minor,amount_minor,approved_by,approved_at,executed_on,bank_reference,execution_recorded_by,0 AS returned FROM payment_orders WHERE payable_id=? ORDER BY created_at,rowid').all(payableId).map(o=>({...o,returned:false})):db.prepare(`SELECT o.id,o.status,o.amount_minor AS order_amount_minor,l.amount_minor,o.approved_by,o.approved_at,o.executed_on,o.bank_reference,o.execution_recorded_by,
    EXISTS(SELECT 1 FROM payment_returns r WHERE r.order_id=o.id) AS returned
  FROM payment_order_lines l JOIN payment_orders o ON o.id=l.order_id WHERE l.payable_id=? ORDER BY o.created_at,o.rowid`).all(payableId).map(o=>({...o,returned:!!o.returned}));
// الترحيل بمفردات الدفتر نفسها التي تستعملها finance.listFinance، حتى لا تختلف شاشتان على كلمة.
const postingOf=(db,payableId)=>db.prepare(`SELECT l.journal_id,
    CASE WHEN j.status='posted' AND rj.status='posted' THEN 'reversed_locally' WHEN j.status='posted' THEN 'posted_locally' ELSE 'not_posted' END AS posting_status
  FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id
  LEFT JOIN finance_reversals r ON r.original_journal_id=j.id LEFT JOIN finance_journals rj ON rj.id=r.reversal_journal_id
  WHERE l.payable_id=?`).get(payableId)??null;
// حالة السداد من payable_balances (الترحيل 166): الرؤية نفسها التي يقرؤها قادح الرصيد وشاشة المدفوعات، فلا تختلف المشتريات والمدفوعات
// على «مدفوع». كانت تقرأ أمر دفع واحدًا (payment_orders.payable_id) وتعدّ مبلغه مدفوعًا متى نُفّذ: تقول «مدفوع» بعد تنفيذ جزء، ولا ترى
// سطر المستحق في أمر دفعي، ولا المرتجع ولا الإشعارات. القاعدة نفسها في payableBalance (app/payables.mjs)، مكتوبة هنا لأن المدفوعات
// تستورد هذه الوحدة، واستيرادها من هنا دورة تُسقط التحميل.
export const balanceStatus=b=>b.outstanding_minor<=0?(b.paid_minor>0?'paid':'settled'):b.paid_minor>0?'partially_paid':b.approved_minor>0?'payment_approved':b.pending_minor>0?'payment_pending':'not_paid';
export function payableState(db,payable) {
  const balance=balanceOf(db,payable.id),posting=postingOf(db,payable.id),orders=paymentOrdersOf(db,payable.id);
  const status=balance?balanceStatus(balance):'not_paid',live=orders.filter(o=>['pending','approved'].includes(o.status)||(o.status==='executed'&&!o.returned));
  const figures=balance?{adjusted_minor:balance.adjusted_minor,debit_minor:balance.debit_minor,credit_minor:balance.credit_minor,paid_minor:balance.paid_minor,returned_minor:balance.returned_minor,
    in_flight_minor:balance.in_flight_minor,outstanding_minor:balance.outstanding_minor,available_minor:balance.available_minor}
    :{adjusted_minor:payable.amount_minor,debit_minor:0,credit_minor:0,paid_minor:0,returned_minor:0,in_flight_minor:0,outstanding_minor:payable.amount_minor,available_minor:payable.amount_minor};
  return {...payable,...figures,payment_status:status,payment_status_name:PAYMENT_STATUS_NAMES[status],
    posting_status:posting?.posting_status??'not_posted',
    posting_status_name:POSTING_STATUS_NAMES[posting?.posting_status??'not_posted'],
    journal_id:posting?.journal_id??null,payment_orders:orders,payment_order:live.find(o=>o.status!=='executed')??live.at(-1)??null};
}
function rollUpPayment(payables) {
  if(!payables.length)return 'not_paid';
  if(payables.every(x=>['paid','settled'].includes(x.payment_status)))return payables.some(x=>x.payment_status==='paid')?'paid':'settled';
  if(payables.some(x=>['paid','partially_paid'].includes(x.payment_status)))return 'partially_paid';
  const rank=payables.reduce((top,x)=>Math.max(top,PAYMENT_RANK[x.payment_status]??0),0);
  return rank===2?'payment_approved':rank===1?'payment_pending':'not_paid';
}
function rollUpPosting(payables) {
  if(!payables.length)return 'not_posted';
  if(payables.every(x=>x.posting_status==='posted_locally'))return 'posted_locally';
  if(payables.some(x=>x.posting_status==='posted_locally'))return 'partially_posted';
  if(payables.some(x=>x.posting_status==='reversed_locally'))return 'reversed_locally';
  return 'not_posted';
}
// عبارات حالات الاستثناءات (الترحيل 169). الفاتورة الموقوفة لا «مرفوضة»: سُجّلت كما وردت، وتنتظر قرار فرقها.
export const INVOICE_STATES={ready:'جاهزة للمطابقة',awaiting_receipt:'تنتظر وصول البضاعة',held:'موقوفة بفرق ينتظر قرارًا مستقلًا',
  decided:'انقرر فرقها وجاهزة للمطابقة',matched:'مطابقة وصارت مستحقًا',rejected:'مرفوضة بقرار',voided:'ملغاة بقرار معتمد'};
export const VOID_STATES={pending:'طلب إلغاء ينتظر قرار معتمد مستقل',approved:'انلغت',rejected:'رُفض طلب الإلغاء'};
export const DECISION_NAMES={accept:'قبول الفرق',credit_note:'طلب إشعار دائن من المورد',reject:'رفض الفاتورة'};
export const BASIS_NAMES={within_tolerance:'ضمن الحد المعتمد',finance_override:'تجاوز بمبرر معتمد مالي',credit_note:'الفرق يرجع بإشعار دائن',reject:'الفاتورة مرفوضة'};
function stateData(db,p) {
  const related = table => db.prepare(`SELECT * FROM ${table} WHERE purchase_id=? ORDER BY created_at,id`).all(p.id);
  const quoteLines=db.prepare('SELECT * FROM procurement_quote_lines WHERE quote_id=? ORDER BY line_no,id');
  const quotes = related('procurement_quotes').map(row=>({...row,lines:quoteLines.all(row.id)}));
  const lines=purchaseLines(db,p.id);
  const rawOrder=db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(p.id)??null;
  // كل بند أمر بوقائعه: المستلم والمرتجع والصافي، والمفوتر الحي، والمطابَق الصافي، والممكن تسليمه (app/procurement-guards.mjs).
  const closed=rawOrder?closedShort(db,p.id):false;
  const order=rawOrder?{...rawOrder,lines:orderLines(db,p.id).map(line=>{const f=lineFacts(db,line,closed);
    return {...line,received_quantity:f.received,returned_quantity:f.returned,net_received_quantity:f.net_received,invoiced_quantity:f.invoiced,matched_quantity:f.matched_net,deliverable_quantity:f.deliverable};})}:null;
  const receiptLines=db.prepare('SELECT l.* FROM procurement_receipt_lines l JOIN procurement_order_lines o ON o.id=l.order_line_id WHERE l.receipt_id=? ORDER BY o.line_no,l.id');
  const receipts = related('procurement_receipts').map(row=>({...row,lines:receiptLines.all(row.id)}));
  const schema=schemaOf(db);
  const returns=(schema.exceptions?related('procurement_returns'):[]).map(row=>({...row,recorded_by_name:personName(db,row.recorded_by),
    lines:db.prepare('SELECT l.* FROM procurement_return_lines l JOIN procurement_order_lines o ON o.id=l.order_line_id WHERE l.return_id=? ORDER BY o.line_no,l.id').all(row.id)}));
  const voids=(schema.exceptions?related('procurement_voids'):[]).map(row=>{const decision=db.prepare('SELECT * FROM procurement_void_decisions WHERE void_id=?').get(row.id)??null,state=decision?decision.decision:'pending';
    return {...row,decision,state,state_name:VOID_STATES[state],requested_by_name:personName(db,row.requested_by),decided_by_name:personName(db,decision?.decided_by)};});
  // شبه المكرر: المورد والمبلغ نفسهما بمرجع مختلف خلال 90 يومًا. تنبيه للمراجع لا منع، لأن دفعتين متساويتين قد تكونان صحيحتين.
  const similar = db.prepare("SELECT supplier_reference,substr(created_at,1,10) AS recorded_on FROM procurement_invoices WHERE tenant_id=? AND supplier_key=? AND amount_minor=? AND id<>? AND abs(julianday(created_at)-julianday(?))<=90 ORDER BY created_at");
  const invoiceLines=db.prepare('SELECT l.* FROM procurement_invoice_lines l JOIN procurement_order_lines o ON o.id=l.order_line_id WHERE l.invoice_id=? ORDER BY o.line_no,l.id');
  // الفاتورة بحالتها وفرقها لكل بند وقراراتها (app/procurement-guards.mjs): الحالة محسوبة من الوقائع الآن، لا عمود يُكتب ثم يتأخر.
  const invoices = related('procurement_invoices').map(x=>{const st=invoiceState(db,x);
    return {...x,lines:invoiceLines.all(x.id),similar:similar.all(x.tenant_id,x.supplier_key,x.amount_minor,x.id,x.created_at),
      state:st.state,state_name:INVOICE_STATES[st.state],live:st.live,matchable:st.matchable,covered:st.covered,variance:st.variance,
      decision:st.decision&&{...st.decision,decision_name:DECISION_NAMES[st.decision.decision],basis_name:BASIS_NAMES[st.decision.basis],decided_by_name:personName(db,st.decision.decided_by)},
      decisions:st.decisions.map(d=>({...d,decision_name:DECISION_NAMES[d.decision],basis_name:BASIS_NAMES[d.basis],decided_by_name:personName(db,d.decided_by)})),
      void:voids.filter(v=>v.invoice_id===x.id).at(-1)??null};});
  const payableLines=db.prepare('SELECT l.* FROM procurement_payable_lines l JOIN procurement_order_lines o ON o.id=l.order_line_id WHERE l.payable_id=? ORDER BY o.line_no,l.id');
  const pendingAdjustments=schema.adjustments?db.prepare("SELECT COUNT(*) AS n FROM payable_adjustments WHERE payable_id=? AND status='pending'"):{get:()=>({n:0})};
  // المستحق برصيده (payable_balances)، وطلبات الإشعار الدائن عليه، والمحجوز عن الدفع، وما يُدفع الآن، وإلغاؤه إن أُلغي.
  const payables = related('procurement_payables').map(x=>{const hold=paymentHold(db,x.id);
    return {...payableState(db,x),lines:payableLines.all(x.id),
      credit_requests:creditRequests(db,x.id).map(r=>({...r,created_by_name:personName(db,r.created_by),waived_by_name:personName(db,r.waived_by)})),
      withheld_minor:hold.withheld_minor,payable_now_minor:hold.payable_now_minor,void_pending:hold.void_pending,voided:payableVoided(db,x.id),
      pending_adjustments:pendingAdjustments.get(x.id).n,void:voids.filter(v=>v.payable_id===x.id).at(-1)??null};});
  const live=invoices.filter(x=>x.live),returned=returns.reduce((n,x)=>n+x.quantity,0),received=receipts.reduce((n,x)=>n+x.quantity,0);
  return {...p, lines,quotes, budget_reservation:purchaseBudgetState(db,p),commitment:commitmentOf(db,p.id),
    award:db.prepare('SELECT * FROM procurement_awards WHERE purchase_id=?').get(p.id) ?? null,
    order,
    receipts,returns,invoices,voids,payables,
    received_quantity:received,returned_quantity:returned,net_received_quantity:received-returned,
    invoiced_quantity:live.reduce((n,x)=>n+x.quantity,0),
    invoiced_minor:live.reduce((n,x)=>n+x.amount_minor,0),
    payable_minor:payables.reduce((n,x)=>n+x.amount_minor,0),
    adjusted_minor:payables.reduce((n,x)=>n+x.adjusted_minor,0),
    paid_minor:payables.reduce((n,x)=>n+x.paid_minor,0),
    tax_policy:'not_configured',
    payment_status:rollUpPayment(payables),
    payment_status_name:PAYMENT_STATUS_NAMES[rollUpPayment(payables)],
    posting_status:rollUpPosting(payables),
    posting_status_name:POSTING_STATUS_NAMES[rollUpPosting(payables)],
    payment_status_source:'payable_balances (payables) + finance_payable_links (الدفتر)'
  };
}
// الأعضاء في نطاق الطلب يرون الاستثناءات على بطاقته، ومن لا يراه من حملة التفويض المالي يراها في لوحة «الطارئ وتعديل الأوامر».
const financePerms=(db,u)=>u.finance_permissions??=financeCapabilities(db,u);

function allowedActions(db,u,p) {
  const own = p.requester_id === u.id;
  const reviewer = !own && ['manager','pm'].includes(u.role);
  const actions = [];
  if (p.status === 'draft' && own) actions.push('edit','submit','cancel');
  if (p.status === 'sourcing') {
    if (own) actions.push('add_quote','cancel');
    if (reviewer) actions.push('award','reject');
  }
  if (p.status === 'awarded' && reviewer) actions.push('approve_order','reject');
  // أمر المباشرة بين أمر الشراء والاستلام: يُصدر حين لا إذن قائم، ويُستبدل أو يُسحب حين يقوم. والاستلام لا يظهر
  // إلا والإذن القائم يسري اليوم على نسخة الأمر القائمة — والخادم يعيد الفحص نفسه لحظة التسجيل (procurementAction).
  const inFlight = ['ordered','part_received'].includes(p.status);
  const live = inFlight ? commencementOf(db,p.id) : null;
  if (inFlight && reviewer) actions.push(...(live ? ['replace_commencement','withdraw_commencement'] : ['commence']));
  if (inFlight && live?.validity.satisfies_receipt) actions.push('receive');
  if (['ordered','part_received','received'].includes(p.status)) actions.push('record_invoice');
  if (['part_received','received'].includes(p.status) && reviewer) actions.push('match');
  // المرتجع (الترحيل 169): يسجّله من في النطاق غير صاحب الطلب، متى بقي من المستلم شيء لم يرجع. التسجيل في app/procurement-exceptions.mjs.
  if (['part_received','received'].includes(p.status) && !own && schemaOf(db).exceptions && Number(db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_receipt_lines WHERE purchase_id=?').get(p.id).n)>Number(db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_return_lines WHERE purchase_id=?').get(p.id).n)) actions.push('record_return');
  return actions;
}

function detail(db,u,p) {
  // حالة تأهيل المورد تُقرأ من دليل الموردين عند العرض ولا تدخل لقطة النسخة.
  const state=stateData(db,p);
  itemActions(u,financePerms(db,u),state,{scoped:true});
  return {...state,rfqs:rfqsForPurchase(db,p.id),rfq:currentRfq(db,p.id),rfq_actions:rfqActionsForPurchase(db,u,p),order:effectiveOrder(db,state.order),commencement:commencementOf(db,p.id),commencement_history:commencementHistory(db,p.id),emergency:db.prepare('SELECT * FROM procurement_emergencies WHERE purchase_id=?').get(p.id)??null,order_changes:db.prepare('SELECT * FROM procurement_order_changes WHERE purchase_id=? ORDER BY created_at').all(p.id),vendor_gates:Object.fromEntries(state.quotes.map(q=>[q.id,vendorGate(db,p.tenant_id,q.supplier_key,p.id)])),allowed_actions:allowedActions(db,u,p),
    history:db.prepare('SELECT version,action,actor_id,snapshot,created_at FROM procurement_versions WHERE purchase_id=? ORDER BY version').all(p.id).map(x=>({...x,snapshot:JSON.parse(x.snapshot)}))};
}

function saveVersion(db,u,p,action,before = {},note = '') {
  const snapshot = stateData(db,p);
  db.prepare('INSERT INTO procurement_versions VALUES(?,?,?,?,?,?)').run(p.id,p.version,action,u.id,JSON.stringify(snapshot),now());
  audit(db,u,'procurement',p.id,action,before,{version:p.version,status:p.status},note);
}

export function listProcurement(db,supplied) {
  const u = actor(db,supplied);
  if (!roles.includes(u.role)) return [];
  return db.prepare('SELECT * FROM procurement_purchases WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).filter(p=>scope(db,u,p)).map(p=>detail(db,u,p));
}

// The caller commits the business records, versions, audit, and retry key together.
export function createPurchase(db,supplied,input) {
  requireTransaction(db);
  const u = actor(db,supplied);
  v.object(input,['project_id',...purchaseFields]);
  project(db,u,input.project_id);
  // مشروع مقفل ماليًا لا يُفتح عليه شراء جديد إلا بإعادة فتح إقفاله (ترحيل 163)، فلا يتغير ما أُقفل عليه بصمت.
  assertFinanciallyOpen(db,input.project_id,'ما ينفتح طلب شراء جديد على مشروع مقفل ماليًا');
  const cleaned = cleanPurchase(db,u.tenant_id,input),fields=cleaned.fields,id = randomUUID(),time = now();
  db.prepare('INSERT INTO procurement_purchases(id,tenant_id,project_id,requester_id,title,specification,cost_center,cost_center_id,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,u.tenant_id,input.project_id,u.id,...Object.values(fields),'draft',1,time,time);
  for(const row of cleaned.lines){
    const lineId=randomUUID();
    db.prepare('INSERT INTO procurement_purchase_lines(id,purchase_id,line_no,description,quantity,unit,currency,unit_price_minor,price_source,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,NULL,?,?,?)')
      .run(lineId,id,row.line_no,row.description,row.quantity,row.unit,fields.currency,'not_priced',1,time);
    db.prepare('INSERT INTO procurement_line_allocations(id,purchase_id,purchase_line_id,position,cost_center_id,cost_center,amount_minor,currency,basis,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),id,lineId,1,row.cost_center_id,row.cost_center,row.budget_minor,fields.currency,'purchase_budget',1,time);
  }
  const p = access(db,u,id);
  saveVersion(db,u,p,'created');
  return detail(db,u,p);
}

export function submitRfq(db,supplied,id,input) {
  const {u,p,reviewer}=purchaseFor(db,supplied,id);
  if(!reviewer)fail(403,'rfq_submit_denied','يرفعه مراجع المشتريات المستقل عن صاحب الاحتياج');
  return submitPurchaseRfq(db,u,p,input);
}

export function procurementAction(db,supplied,id,action,input) {
  requireTransaction(db);
  const u = actor(db,supplied),p = access(db,u,id);
  if (!Object.hasOwn(actionFields,action)) fail(400,'invalid_action','ما فيه إجراء بهذا الاسم على طلب الشراء');
  v.object(input,['version',...actionFields[action]]);
  v.version(input.version,p.version);
  // الاستلام يُسأل عن سببه بعينه قبل «لا يسمح»: الأمر المقفل على المستلم أولًا، ثم إذن المباشرة يُعاد فحصه لحظة
  // التسجيل — قائمٌ، على نسخة الأمر القائمة، ويسري اليوم. فمن فتح الشاشة والإذن سارٍ ثم انتهى أو سُحب يُقال له لماذا.
  let startedUnder = null;
  if (action==='receive' && ['ordered','part_received'].includes(p.status)) {
    if (closedShort(db,p.id)) fail(409,'closed_short','الأمر انقفل على اللي استُلم بقرار معتمد — ما فيه استلام جديد');
    startedUnder = requireSupplierStart(db,p);
  }
  if (!allowedActions(db,u,p).includes(action)) fail(403,'transition_denied','دورك ولا حالة الطلب ما تسمح بهذا الإجراء');
  let status = p.status;
  const time = now(),nextVersion = p.version + 1;
  let note = '';
  if (action === 'edit') {
    const cleaned = cleanPurchase(db,u.tenant_id,input),fields=cleaned.fields,stored=purchaseLines(db,p.id);
    if(stored.length!==cleaned.lines.length)fail(409,'line_count_locked','عدد البنود في المسودة محفوظ؛ أنشئ احتياجًا جديدًا إذا احتجت إضافة بند أو حذفه');
    for(let index=0;index<stored.length;index++){
      const line=stored[index],next=cleaned.lines[index];
      if(line.allocations.length!==1)fail(409,'allocation_model_required','تعديل المسودة يحتاج مخصصًا واحدًا لكل بند');
      const allocation=line.allocations[0];
      db.prepare('UPDATE procurement_purchase_lines SET description=?,quantity=?,unit=?,currency=?,purchase_version=purchase_version+1 WHERE id=? AND purchase_version=?')
        .run(next.description,next.quantity,next.unit,fields.currency,line.id,line.purchase_version);
      db.prepare('UPDATE procurement_line_allocations SET cost_center_id=?,cost_center=?,amount_minor=?,currency=?,purchase_version=purchase_version+1 WHERE id=? AND purchase_version=?')
        .run(next.cost_center_id,next.cost_center,next.budget_minor,fields.currency,allocation.id,allocation.purchase_version);
    }
    db.prepare('UPDATE procurement_purchases SET title=?,specification=?,cost_center=?,cost_center_id=?,due_date=?,quantity=?,unit=?,currency=?,budget_minor=?,budget_evidence=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(...Object.values(fields),time,p.id,p.version);
  } else {
    if (action === 'submit') status = 'sourcing';
    if (action === 'add_quote') {
      const supplierKey = reference(input.supplier_key,'معرف المورد المحلي');
      if (db.prepare('SELECT 1 FROM procurement_quotes WHERE purchase_id=? AND supplier_key=?').get(p.id,supplierKey)) fail(409,'duplicate_supplier','فيه عرض محفوظ لهذا المورد أصلًا');
      // العمود نصّ حرّ يُرفع إلى أحرف كبيرة، فبلا هذا السطر يصير «أي نصّ» موردًا. الوجود يُفحص هنا — عند
      // طلب العرض — لا عند الترسية وحدها: كيان ما له ملف ما ينطلب منه عرض أصلًا. والتأهيل يبقى على الترسية.
      requireRegisteredVendor(db,p.tenant_id,supplierKey);
      const prices=quotePrices(input,purchaseLines(db,p.id));
      const totals=prices.map(line=>total(line.quantity,line.unit_price_minor)),quoteTotal=minorSum(totals);
      const headerPrice=prices.length===1?prices[0].unit_price_minor:quoteTotal,quoteId=randomUUID();
      db.prepare('INSERT INTO procurement_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(quoteId,p.id,supplierKey,v.text(input.supplier_name,'اسم المورد',180),headerPrice,quoteTotal,v.text(input.technical_assessment,'التقييم الفني',3000,3),v.text(input.financial_terms,'الشروط المالية',3000,3),v.date(input.delivery_date),v.text(input.evidence,'دليل العرض',3000,3),u.id,time);
      const insert=db.prepare('INSERT INTO procurement_quote_lines(id,quote_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
      prices.forEach((line,index)=>insert.run(randomUUID(),quoteId,p.id,line.id,line.line_no,line.description,line.quantity,line.unit,line.unit_price_minor,totals[index],p.currency,time));
    }
    if (action === 'award') {
      note = v.text(input.note,'مبرر الترسية وتأكيد المخصص',3000,3);
      const quotes = db.prepare('SELECT * FROM procurement_quotes WHERE purchase_id=?').all(p.id);
      const emergency = approvedEmergency(db,p.id);
      if (quotes.length < (emergency ? 1 : 3)) fail(409,'comparison_required',emergency?'يلزم عرض واحد على الأقل حتى في الشراء الطارئ':'تحتاج الترسية ثلاثة عروض من موردين مختلفين، أو إعلان شراء طارئ معتمد');
      const quote = quotes.find(q=>q.id===input.quote_id);
      if (!quote) fail(400,'invalid_quote','العرض هذا مو تابع لطلب الشراء');
      noConflict(db,u,quote.supplier_key);
      requireVendorGate(db,p.tenant_id,quote.supplier_key,p.id);
      // بوابة PM-01: الترسية التزام بمال المشروع، فلا تسبق الدفعة المقدمة المؤكدة.
      // مشروع بلا جدول دفعات مسجل لا تمسّه البوابة إطلاقًا: هذا هو ما قبل البيع والتحديد.
      assertReadyForPaidExecution(db,p.tenant_id,p.project_id,'لا تُرسى على مورد');
      if (quote.total_minor > p.budget_minor) fail(409,'budget_exceeded','قيمة العرض تتعدّى المخصص المحلي — عدّل الاحتياج في طلب جديد');
      reservePurchaseBudget(db,u,p,quote.total_minor);
      db.prepare('INSERT INTO procurement_awards VALUES(?,?,?,?,?,?)').run(p.id,quote.id,u.id,note,nextVersion,time);
      status = 'awarded';
    }
    if (action === 'approve_order') {
      note = v.text(input.note,'دليل اعتماد الأمر الداخلي',3000,3);
      const q = db.prepare('SELECT q.* FROM procurement_quotes q JOIN procurement_awards a ON a.quote_id=q.id WHERE a.purchase_id=?').get(p.id);
      if (!q) fail(409,'award_required','لازم يكون فيه قرار ترسية محفوظ');
      noConflict(db,u,q.supplier_key);
      // F-03/F-04: للكيانات التي اعتمدت البوابة لا يصدر أمر الشراء قبل تقرير مالية مستقل.
      // الحارس نفسه موجود في قاعدة البيانات؛ هذا الفحص يعطي المستخدم سببًا قابلًا للتنفيذ قبل اصطدام الإدخال بالقيد.
      assertApprovedRfqForOrder(db,p,u.id);
      // أمر الشراء التزامٌ بمال المشروع أيضًا، والفحص عند الترسية لا يغني عنه: قبضٌ ارتدّ أو إعفاءٌ سُحب بينهما يوقفه هنا.
      assertReadyForPaidExecution(db,p.tenant_id,p.project_id,'ما ينعتمد أمر الشراء للمورد');
      commitPurchaseBudget(db,u,p,q.total_minor);
      const orderId=randomUUID(),lines=purchaseLines(db,p.id),quoteLineRows=db.prepare('SELECT * FROM procurement_quote_lines WHERE quote_id=? ORDER BY line_no,id').all(q.id);
      if(quoteLineRows.length!==lines.length)fail(409,'quote_lines_missing','العرض المختار ما يحتوي تسعيرًا كاملًا لكل البنود');
      db.prepare('INSERT INTO procurement_orders(id,purchase_id,supplier_key,supplier_name,quantity,unit_price_minor,total_minor,currency,terms,delivery_date,approved_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,p.id,q.supplier_key,q.supplier_name,p.quantity,q.unit_price_minor,q.total_minor,p.currency,v.text(input.terms,'شروط الأمر الداخلي',3000,3),v.date(input.delivery_date),u.id,note,nextVersion,time);
      const insert=db.prepare('INSERT INTO procurement_order_lines(id,order_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,allocated_minor,currency,cost_center_id,cost_center,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const line of lines){
        const quoteLine=quoteLineRows.find(row=>row.purchase_line_id===line.id),allocation=line.allocations[0];
        if(!quoteLine||!allocation)fail(409,'quote_lines_missing','العرض أو المخصص ما يغطي كل بند في الطلب');
        insert.run(randomUUID(),orderId,p.id,line.id,line.line_no,line.description,line.quantity,line.unit,quoteLine.unit_price_minor,quoteLine.total_minor,quoteLine.total_minor,p.currency,allocation.cost_center_id,allocation.cost_center,nextVersion,time);
      }
      status = 'ordered';
    }
    const commencementInput = fields => Object.fromEntries(fields.map(key=>[key,input[key]]));
    if (action === 'commence') {
      const authorisation = authoriseCommencement(db,u,p.id,commencementInput(COMMENCEMENT_FIELDS));
      note = `أمر مباشرة رقم ${authorisation.sequence} يسري من ${authorisation.start_on} إلى ${authorisation.valid_until} على النسخة ${authorisation.order_version} من أمر الشراء`;
    }
    if (action === 'replace_commencement') {
      const authorisation = replaceCommencement(db,u,p.id,commencementInput([...COMMENCEMENT_FIELDS,'reason']));
      note = `أمر مباشرة رقم ${authorisation.sequence} يحل محل السابق ويسري من ${authorisation.start_on} إلى ${authorisation.valid_until} على النسخة ${authorisation.order_version} من أمر الشراء`;
    }
    if (action === 'withdraw_commencement') {
      const withdrawn = withdrawCommencement(db,u,p.id,commencementInput(['reason','evidence']));
      note = `سُحب أمر المباشرة رقم ${withdrawn.sequence}`;
    }
    if (action === 'receive') {
      const ref = reference(input.reference,'مرجع الاستلام');
      // بوابة بدء المورد (أمر شراء **و** إذن مباشرة سارٍ) فُحصت قبل التحقق من الإجراء أعلاه، والإقفال على المستلم معها.
      // والاستلام يُقرن بالإذن الذي تم عليه في أثر التدقيق، فيُعرف تحت أي إذن استُلم كل محضر.
      note = `استلام على أمر المباشرة رقم ${startedUnder.sequence}`;
      if (db.prepare('SELECT 1 FROM procurement_receipts WHERE purchase_id=? AND reference=?').get(p.id,ref)) fail(409,'duplicate_receipt','مرجع الاستلام هذا مسجّل من قبل');
      const order=orderLines(db,p.id);
      const rows=input.lines===undefined&&order.length===1?[{...order[0],quantity_input:quantity(input.quantity)}]:selectedDocumentLines(input.lines,order,'receipt');
      for(const row of rows){
        const received=db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_receipt_lines WHERE order_line_id=?').get(row.id).n;
        if(received+row.quantity_input>row.quantity)fail(409,'quantity_exceeded',`كمية استلام البند «${row.description}» تتعدّى أمره المعتمد`);
      }
      const qty=quantity(rows.reduce((sum,row)=>sum+row.quantity_input,0)),receiptId=randomUUID();
      db.prepare('INSERT INTO procurement_receipts VALUES(?,?,?,?,?,?,?,?)').run(receiptId,p.id,qty,ref,v.text(input.evidence,'دليل الاستلام',3000,3),u.id,nextVersion,time);
      const insert=db.prepare('INSERT INTO procurement_receipt_lines(id,receipt_id,purchase_id,order_line_id,quantity,created_at) VALUES(?,?,?,?,?,?)');
      rows.forEach(row=>insert.run(randomUUID(),receiptId,p.id,row.id,row.quantity_input,time));
      const complete=order.every(row=>db.prepare('SELECT COALESCE(SUM(quantity),0) AS n FROM procurement_receipt_lines WHERE order_line_id=?').get(row.id).n===row.quantity);
      status = complete ? 'received' : 'part_received';
    }
    if (action === 'record_invoice') {
      const o = db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(p.id);
      const order=orderLines(db,p.id),ref = reference(input.supplier_reference,'مرجع فاتورة المورد');
      if (db.prepare('SELECT 1 FROM procurement_invoices WHERE tenant_id=? AND supplier_key=? AND supplier_reference=?').get(p.tenant_id,o.supplier_key,ref)) fail(409,'duplicate_invoice','فاتورة المورد بهذا المرجع مسجّلة وتبي مراجعة');
      const rows=input.lines===undefined&&order.length===1?[{...order[0],quantity_input:quantity(input.quantity),amount_minor:money(input.amount)}]:selectedDocumentLines(input.lines,order,'invoice');
      // فرق السعر لا يُرفض (الترحيل 169): فاتورة المورد تُسجَّل كما وردت، وتقف بفرقها لكل بند حتى يقرره معتمد مستقل. الحد الباقي
      // وحده: كمية الفواتير الحية على البند لا تتجاوز كميته في الأمر — فوترة ما لم يُطلب ليست فرقًا بل شراءٌ آخر.
      const liveOnLine=db.prepare(`SELECT COALESCE(SUM(il.quantity),0) AS n FROM procurement_invoice_lines il JOIN procurement_invoices i ON i.id=il.invoice_id WHERE il.order_line_id=? AND ${liveInvoiceSql(db,'i')}`);
      for(const row of rows){
        if(liveOnLine.get(row.id).n+row.quantity_input>row.quantity)fail(409,'invoice_exceeds_order',`إجمالي فواتير البند «${row.description}» يتعدّى أمره المعتمد`);
      }
      const qty=quantity(rows.reduce((sum,row)=>sum+row.quantity_input,0)),amount=minorSum(rows.map(row=>row.amount_minor));
      const invoiceId=randomUUID();
      db.prepare('INSERT INTO procurement_invoices(id,tenant_id,purchase_id,supplier_key,supplier_reference,quantity,amount_minor,currency,evidence,recorded_by,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(invoiceId,p.tenant_id,p.id,o.supplier_key,ref,qty,amount,p.currency,v.text(input.evidence,'دليل فاتورة المورد',3000,3),u.id,nextVersion,time);
      const insert=db.prepare('INSERT INTO procurement_invoice_lines(id,invoice_id,purchase_id,order_line_id,quantity,amount_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?)');
      rows.forEach(row=>insert.run(randomUUID(),invoiceId,p.id,row.id,row.quantity_input,row.amount_minor,p.currency,time));
      const recorded=invoiceState(db,{id:invoiceId,purchase_id:p.id});
      if(recorded.state==='held')note=`فاتورة موقوفة: فرق السعر ${decimal(recorded.variance.price_variance_minor)} وفرق الكمية ${recorded.variance.quantity_variance}، وتنتظر قرار معتمد مستقل`;
    }
    if (action === 'match') {
      note = v.text(input.note,'دليل مراجعة المطابقة',3000,3);
      const invoice = typeof input.invoice_id === 'string' && db.prepare('SELECT * FROM procurement_invoices WHERE id=? AND purchase_id=?').get(input.invoice_id,p.id);
      if (!invoice) fail(400,'invalid_invoice','مرجع الفاتورة مو تابع لطلب الشراء');
      if (invoice.recorded_by === u.id) fail(403,'self_approval','اللي سجّل الفاتورة ما يعتمد مطابقتها');
      // ولا اللي سجّل الاستلام: المطابقة الثلاثية تقارن الأمر بالاستلام بالفاتورة، فلو كان مثبت الاستلام هو
      // معتمد المطابقة صار شخص واحد يختلق الاستلام ويبني عليه المستحق. ما كان أحد يقرأ received_by قبل هذا.
      // والحارس في الطبقتين كما في الرواتب والمالية: هذا السطر، ومُطلِق procurement_match_guard (الترحيل 152).
      if (db.prepare('SELECT 1 FROM procurement_receipts WHERE purchase_id=? AND received_by=?').get(p.id,u.id)) refuse(409,'separation_of_duties',{
        what:'ما تعتمد مطابقة مبنية على استلام سجّلته أنت',
        missing:[{document:'اعتماد مطابقة من مراجع ما سجّل استلامًا على هذا الطلب',
          why:'أنت مسجّل استلامًا على هذا الطلب، ولو اعتمدت المطابقة صار شخص واحد هو اللي أثبت الاستلام واللي بنى عليه المستحق',
          owner:'مراجع ثاني في المشروع — مدير الفريق أو مدير المشروع',owner_role:'manager'}],
        next:'خلّ مراجعًا ثانيًا — ما سجّل استلامًا على الطلب ولا سجّل هذي الفاتورة — يفتح الطلب ويعتمد المطابقة'});
      noConflict(db,u,db.prepare('SELECT supplier_key FROM procurement_orders WHERE purchase_id=?').get(p.id).supplier_key);
      if (db.prepare('SELECT 1 FROM procurement_payables WHERE invoice_id=?').get(invoice.id)) fail(409,'already_matched','مطابقة الفاتورة محفوظة من قبل');
      const invoiceLines=db.prepare('SELECT * FROM procurement_invoice_lines WHERE invoice_id=? ORDER BY id').all(invoice.id);
      if(!invoiceLines.length)fail(409,'three_way_mismatch','مرجع الفاتورة بلا بنود مرتبطة — وما انشأ مستحق');
      // الفاتورة الميتة لا تُطابَق، والموقوفة لا تُطابَق حتى يغطي فرقَها قرارٌ مستقل (الترحيل 169، والحارس نفسه في القاعدة).
      const st=invoiceState(db,invoice);
      if(!st.live)refuse(409,'invoice_not_live',{what:`الفاتورة ${invoice.supplier_reference} ${st.state==='rejected'?'مرفوضة بقرار':'ملغاة بقرار معتمد'}، فما تصير مستحقًا`,
        next:'سجّل فاتورة المورد البديلة بمرجعها الجديد، ثم طابقها'});
      if(st.state==='held')refuse(409,'invoice_held',{what:`الفاتورة ${invoice.supplier_reference} موقوفة بفرق: سعر ${decimal(st.variance.price_variance_minor)} ريال وكمية ${st.variance.quantity_variance} عن الأمر والمستلم`,
        missing:[{document:'قرار مستقل على الفرق: قبول (ضمن حد معتمد أو بمبرر معتمد مالي)، أو طلب إشعار دائن، أو رفض',
          why:'الفرق فلوس فوق أمر الشراء أو بضاعة ما وصلت، وما يصير مستحقًا بلا قرار من غير مسجّل الفاتورة ومسجّلي الاستلام وصاحب الطلب',
          owner:'مراجع مستقل في المشروع أو معتمد مالي',owner_role:'manager'}],
        next:'افتح الفاتورة وقرّر فرقها، أو اطلبه من مراجع مستقل، ثم طابقها'});
      // وطلب إلغاء معلّق على الفاتورة يوقف مطابقتها حتى يُقرَّر: إلغاءٌ يُعتمد بعد مطابقةٍ لم يرها يترك مستحقًا على فاتورة ميتة.
      if(schemaOf(db).exceptions&&db.prepare('SELECT 1 FROM procurement_voids v WHERE v.invoice_id=? AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id)').get(invoice.id))
        refuse(409,'void_pending',{what:`على الفاتورة ${invoice.supplier_reference} طلب إلغاء ينتظر قراره، فما تُطابَق قبله`,
          next:'انتظر قرار طلب الإلغاء: إن رُفض فطابقها، وإن اعتُمد فسجّل فاتورة المورد البديلة'});
      // الكمية: ما يُقبل من كل بند (الفاتورة ناقص فرق الكمية الذي غطّاه القرار) لا يتجاوز المستلم الصافي من المرتجع ناقص المطابَق الصافي.
      for(const line of st.variance.lines){
        const facts=lineFacts(db,db.prepare('SELECT * FROM procurement_order_lines WHERE id=?').get(line.order_line_id));
        if(line.accepted_quantity>facts.net_received-facts.matched_net)
          fail(409,'three_way_mismatch',`الأمر والاستلام ومرجع فاتورة البند «${line.description}» ما تطابقوا: المستلم الصافي بعد المرتجع والمطابقات السابقة ${Math.max(0,facts.net_received-facts.matched_net)} والفاتورة تطلب ${line.accepted_quantity} — وما انشأ مستحق`);
      }
      const credit=st.covered&&st.decision.decision==='credit_note'?st.variance.expected_credit_minor:0;
      const guard=budgetGuard(db,p),before=commitmentOf(db,p.id);
      const payableId=randomUUID();
      db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(payableId,p.id,invoice.id,invoice.amount_minor,p.currency,u.id,note,nextVersion,time);
      const insert=db.prepare('INSERT INTO procurement_payable_lines(id,payable_id,purchase_id,invoice_line_id,order_line_id,quantity,amount_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      invoiceLines.forEach(invoiceLine=>insert.run(randomUUID(),payableId,p.id,invoiceLine.id,invoiceLine.order_line_id,invoiceLine.quantity,invoiceLine.amount_minor,p.currency,time));
      // قرار «طلب إشعار دائن»: المستحق بمبلغ الفاتورة كما فوترت (التزامٌ حتى يصل الإشعار)، والفرق طلبٌ ينتظر إشعار المورد، محجوزٌ عن الدفع.
      if(credit>0){
        const requestId=randomUUID();
        db.prepare("INSERT INTO procurement_credit_requests(id,tenant_id,purchase_id,payable_id,source,source_id,amount_minor,created_by,created_at) VALUES(?,?,?,?,'variance',?,?,?,?)")
          .run(requestId,p.tenant_id,p.id,payableId,st.decision.id,credit,u.id,time);
        const requestLine=db.prepare('INSERT INTO procurement_credit_request_lines(request_id,order_line_id,quantity,amount_minor) VALUES(?,?,?,?)');
        for(const line of st.variance.lines)if(line.quantity_variance>0||line.expected_credit_minor>0)requestLine.run(requestId,line.order_line_id,line.quantity_variance,line.expected_credit_minor);
        note=`${note} — ينتظر إشعارًا دائنًا من المورد بـ${decimal(credit)} ريال`;
      }
      guard(`مطابقة الفاتورة ${invoice.supplier_reference}`,credit);
      recordCommitmentMovement(db,u,p,'consume_purchase',before);
    }
    if (['reject','cancel'].includes(action)) {
      releasePurchaseBudget(db,u,p);
      note = v.text(input.note,'سبب الإجراء',3000,3);
      status = action === 'reject' ? 'rejected' : 'cancelled';
    }
    db.prepare('UPDATE procurement_purchases SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status,time,p.id,p.version);
  }
  const result = access(db,u,p.id);
  saveVersion(db,u,result,action,{version:p.version,status:p.status},note);
  return detail(db,u,result);
}

/* ───── ما تحتاجه وحدة الاستثناءات (app/procurement-exceptions.mjs) ───── */
// الاستثناءات في وحدتها لأنها تستورد المدفوعات (الإشعارات تمرّ بواجهتها)، والمدفوعات تستورد هذه الوحدة: لو استوردت هذه الوحدة
// الاستثناءات لدارت الاستيرادات وسقط التحميل (السبب نفسه في رأس app/ledger-sources.mjs). فهنا يُصدَّر ما يلزم ولا يُستورد شيء منها.
export const purchaseActor=(db,supplied)=>actor(db,supplied);
export const canSee=(db,u,p)=>scope(db,u,p);
export const normalizeReference=(value,label)=>reference(value,label);
export const wholeQuantity=value=>quantity(value);
export const orderLinesOf=(db,purchaseId)=>orderLines(db,purchaseId);
export const purchaseState=(db,p)=>stateData(db,p);
export const riyals=minor=>decimal(minor);
// يتقدم الطلب نسخةً بإجراء استثناء (مرتجع، قرار، إلغاء، تنازل): الحالة لا تتغير، والنسخة ولقطتها وحدث التدقيق كما في procurementAction،
// فسجل النسخ يروي المرتجع والقرار والإلغاء في مكانها من دورة الطلب.
export function advancePurchase(db,u,p,action,note=''){
  requireTransaction(db);
  db.prepare('UPDATE procurement_purchases SET version=version+1,updated_at=? WHERE id=? AND version=?').run(now(),p.id,p.version);
  const result=db.prepare('SELECT * FROM procurement_purchases WHERE id=?').get(p.id);
  saveVersion(db,u,result,action,{version:p.version,status:p.status},note);
  return result;
}
// ما يُعاد بعد إجراء استثناء: تفاصيل الطلب لمن في نطاقه، ولحامل التفويض المالي خارج النطاق هوية الطلب ونسخته واستثناءاته فقط.
export function purchaseView(db,u,purchaseId){
  const p=db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(purchaseId,u.tenant_id);
  if(!p)return null;
  if(scope(db,u,p))return detail(db,u,p);
  const state=itemActions(u,financePerms(db,u),stateData(db,p),{scoped:false});
  return {id:p.id,version:p.version,status:p.status,title:p.title,requester_id:p.requester_id,order:state.order,returns:state.returns,invoices:state.invoices,payables:state.payables,voids:state.voids};
}
