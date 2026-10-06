import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { financeCapabilities } from './finance.mjs';
import { vendorGate, vatNumberRule, currentBankAccount, openBankChange, bankChangeState } from './vendors.mjs';
import { registerAdoption, registerOptionList, adopted, listsBoard } from './options.mjs';
import { statusOptions } from './procurement.mjs';
import { MODULE_STATUS_MAP } from './static/vocabulary.mjs';
import { registerSourceKind, registerSourceLink } from './ledger-sources.mjs';
import { paymentHold } from './procurement-guards.mjs';
import { riyadhToday as riyadhDay, riyadhDateOf } from './riyadh-time.mjs';

// مدفوعات الموردين وضريبة المدخلات. المنصة تُعد أمر الدفع وتعتمده وتسجّل تنفيذه ومرتجعه؛ التحويل نفسه يتم في البنك.
// عبارات الحالة من القاموس الواحد (app/static/vocabulary.mjs) لا نسخة محلية: الشاشة وقائمة الحالات المُدارة تقولان الكلمة نفسها.
export const ORDER_STATUS=Object.freeze(Object.fromEntries(Object.entries(MODULE_STATUS_MAP.payment_order).map(([key,entry])=>[key,entry.phrase])));
// المرتجع ليس حالة في payment_orders (القيد مقفل منذ 030، والأمر المنفّذ لا يُعدَّل): هو سجل مستقل، وهذه عبارته على الأمر.
const RETURNED_NAME='رجع التحويل من البنك — ما وصل المورد، والمستحق انفتح من جديد';
// التنفيذ محلي ومحاكى (البند 6 في العقد): لا اتصال ببنك، فكل «تنفيذ» شهادةُ موظف بمرجع ودليل، ويقال ذلك في كل حمولة.
export const EXECUTION=Object.freeze({mode:'recorded_manually',simulated:true,
  note:'المنصة ما تحوّل فلوس ولا تتصل ببنك: التحويل يصير في البنك برّا المنصة، وتنفيذه ومرتجعه يسجّلهما موظف يدويًا بمرجعهما ودليلهما.'});
// حالة الرصيد بمفردات «حالة السداد» في المشتريات (PAYMENT_STATUS_NAMES في app/procurement.mjs) لتستبدلها بلا ترجمة، و«settled» زائدة:
// مستحق سوّته الإشعارات الدائنة كله فلا شيء عليه ولا شيء دُفع.
export const BALANCE_STATUS=Object.freeze({not_paid:'ما انحوّل منه شيء',payment_pending:'عليه أمر دفع ينتظر الاعتماد',payment_approved:'عليه أمر دفع معتمد ما انحوّل للحين',
  partially_paid:'انحوّل جزء منه',paid:'انحوّل كامل',settled:'ما عليه شيء بعد الإشعارات'});
const ACTION_NAMES={approve_order:'اعتماد أمر الدفع',reject_order:'رفض الأمر',cancel_order:'إلغاء الأمر',release_first_payment:'إطلاق أول دفعة',record_execution:'تسجيل التنفيذ',record_return:'تسجيل المرتجع'};

/* ───── الخيارات المُدارة (الترحيل 134): نسبة الضريبة، وحالات أمر الدفع ───── */
// النسبة **ليست تفضيلًا**: تتبدّل بأداة تنظيمية لا بقرار داخلي، فهي جدول مؤرَّخ يُقرأ ومعه أداته — ويُقرأ
// **بتاريخ الفاتورة** لا بتاريخ اليوم. الكود كان يثبّت 15/115 في السطر نفسه، فأي فاتورة قديمة بنسبة 5%
// كانت تُقاس بنسبة اليوم.
registerAdoption({key:'finance.vat_rate',label:'نسبة ضريبة القيمة المضافة',module:'payables',
  owner:'المختص الضريبي — المالية',owner_role:'finance',governance:'legally_fixed',
  // الاستشهاد: الأداة مسمّاة، والمادة **ليست** في المستودع. اللائحة الموقّعة التي يحمل المستودع نصّها لائحةُ
  // عمل لا نظام ضريبة، فلا مادة تُنقل من صفحة محفوظة. ولا يُخترع رقمٌ من الذاكرة: الفراغ يُقرّ به ويُسمّى مالكه،
  // فيراه المالك بندًا مفتوحًا بدل أن يقرأ دعوى «مثبّتة نظامًا» لا سند لها في المستودع.
  article:{ref:'نظام ضريبة القيمة المضافة ولائحته التنفيذية',source:'أداة تنظيمية، لا قرار داخلي للشركة',
    pending:{why:'نصّ النظام ولائحته غير محفوظ في المستودع، فلا مادة تُنقل منه',owner:'المختص الضريبي — المالية',
      next:'احفظ نصّ المادة التي تقرّر النسبة وتاريخ كل مرحلة، ثم اكتب رقمها في article.ref'}},
  default:15,basis:'النسبة السارية اليوم بحسب الجدول المؤرَّخ أدناه',
  schedule:[{from:'2018-01-01',value:5,instrument:'بدء تطبيق ضريبة القيمة المضافة بنسبة 5% في 1 يناير 2018'},
    {from:'2020-07-01',value:15,instrument:'رفع النسبة الأساسية إلى 15% اعتبارًا من 1 يوليو 2020'}]});
// حالات أمر الدفع مقفلة بقيد CHECK في الترحيل 030: تُعرض للمالك بقيدها لا لتُحرَّر بل ليرى لماذا لا تُحرَّر.
registerOptionList({key:'payables.order_status',label:'حالة أمر الدفع',label_en:'Payment order status',module:'payables',
  owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance',governance:'db_locked',columns:['payment_orders.status'],
  db_locked:{check:"status IN ('pending','approved','executed','rejected','cancelled')",migration:'030'},
  defaults:statusOptions('payment_order'),extra_shape:{canonical:'الحالة المقابلة من الحالات الثماني في القاموس الواحد'},
  note:'دورة الدفع محروسة بفصل مهام مكتوب (من أعدّ لا يعتمد، ومن اعتمد لا يوثّق التنفيذ)، فالحالات ليست تفضيلًا.'});
// سقف أول دفعة لحساب متغيّر (الترحيل 166): قرار المالك لا قرار المنصة. مسجّل بلا مبلغ ({amount:null})، وما دام كذلك
// تبقى أول دفعة لأي حساب متغيّر موقوفة برفض يسمّي القرار ومالكه. والشكل كائنٌ لأن واصف القيمة لا يقبل null رقمًا.
export const FIRST_PAYMENT_CAP='payables.bank_change_first_payment_cap';
registerAdoption({key:FIRST_PAYMENT_CAP,label:'سقف أول دفعة لحساب مورد متغيّر',module:'payables',
  owner:'المالية — من يحمل تصريح التحقق المالي من بيانات دفع الموردين',owner_role:'finance',manage_capability:'vendors.bank',
  governance:'managed',shape:'object',default:{amount:null},
  basis:'ما قرّره أحد بعد، والمنصة ما تخترع مبلغًا: حتى يقرّره المالك ويعتمده شخص ثانٍ تبقى أول دفعة لأي حساب متغيّر موقوفة. القيمة {"amount": "مبلغ بالريال مثل 1000.00"}، وأول دفعة ما تتجاوزه ويطلقها شخص ثالث'});
const riyadhToday=()=>riyadhDay();
const riyadhDate=iso=>riyadhDateOf(iso);
const id=()=>randomUUID();
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
// اسم الشخص للعرض في بطاقة الأمر: القراءة المباشرة الوحيدة لجدول الأشخاص في هذه الوحدة غير هوية الفاعل.
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied,action='read'){
  const u=supplied&&db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u)fail(403,'payables_access_denied','الحساب غير متاح أو موقوف في هذا الكيان');
  u.permissions=financeCapabilities(db,u);
  if(!u.permissions.includes(action))fail(403,'payables_access_denied','لا يوجد تفويض مالي صالح لهذا الإجراء');
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة المدفوعات معاملة قاعدة بيانات');}
const MONEY=/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const minorOf=value=>{const [whole,fraction='']=value.split('.');return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));};
function money(value,label){
  if(typeof value!=='string'||!MONEY.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  return minorOf(value);
}
const payableRow=(db,u,payableId)=>typeof payableId==='string'&&db.prepare('SELECT p.*,i.supplier_key,i.supplier_reference,i.tenant_id,o.supplier_name FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id JOIN procurement_orders o ON o.purchase_id=p.purchase_id WHERE p.id=? AND i.tenant_id=?').get(payableId,u.tenant_id);

/* ───── الرصيد: مصدر واحد لكل وحدة ───── */
// الرصيد من الرؤية payable_balances (الترحيل 166) التي يقرؤها قادح الرصيد نفسه، فلا تختلف الشاشة والقاعدة على «المتاح».
// يُستدعى بمعرّف مستحق قرأه المستدعي في نطاق كيانه؛ والصفّ يحمل tenant_id لمن يريد التحقق مرة ثانية.
//   adjusted = المبلغ + المدين − الدائن (المعتمد) · paid = المنفّذ غير الراجع · in_flight = المعلّق والمعتمد
//   outstanding = adjusted − paid (ما زال علينا) · available = outstanding − in_flight (ما يُعدّ له أمر جديد)
export function payableBalance(db,payableId){
  const row=typeof payableId==='string'?db.prepare('SELECT * FROM payable_balances WHERE payable_id=?').get(payableId):null;
  if(!row)return null;
  const status=row.outstanding_minor<=0?(row.paid_minor>0?'paid':'settled')
    :row.paid_minor>0?'partially_paid':row.approved_minor>0?'payment_approved':row.pending_minor>0?'payment_pending':'not_paid';
  return {...row,status,status_name:BALANCE_STATUS[status]};
}

/* ───── الحساب المتغيّر: المهلة والسقف ───── */
function firstPaymentCap(db,tenantId,date=riyadhToday()){
  const decision=adopted(db,tenantId,FIRST_PAYMENT_CAP,date),raw=decision.value?.amount;
  const minor=typeof raw==='string'&&MONEY.test(raw)?minorOf(raw):null;
  return {minor:minor>0?minor:null,decision};
}
const decisionMissing=(d,why)=>({document:`قرار «${d.label}» (${d.key})`,why,owner:d.owner,owner_role:d.owner_role});
// لماذا لا يُدفع اليوم لحساب متغيّر في نافذته: قرار ناقص (المهلة أو السقف أو كلاهما)، أو مهلة لم تنقض. null = يُدفع
// بشرط أول دفعة (السقف والإطلاق) الذي يفرضه الإعداد والإطلاق.
function changeHold(db,tenantId,vendorCode,change,date=riyadhToday()){
  if(!change?.open)return null;
  const cap=firstPaymentCap(db,tenantId,date),missing=[];
  if(change.days===null)missing.push(decisionMissing(change.decision,'كم يوم يبقى الحساب الجديد موقوفًا بعد التحقق منه، عشان تلحق جهة الاتصال الموثقة تعترض لو التغيير مو منهم'));
  if(cap.minor===null)missing.push(decisionMissing(cap.decision,'أعلى مبلغ لأول دفعة للحساب الجديد، فلو كان التغيير احتيالًا ما يروح أكثر منه'));
  if(missing.length)return {code:'bank_change_unadopted',
    what:`ما ينصرف للمورد ${vendorCode} على حسابه الجديد — ${missing.length===2?'مهلة التهدئة وسقف أول دفعة ما تقررا':change.days===null?'مهلة التهدئة ما تقررت':'سقف أول دفعة ما تقرر'} للحين`,
    missing,next:'يسجّل صاحب القرار القيمة بأساسها وتاريخ سريانها ويعتمدها زميل ثاني، وبعدها تنحسب المهلة من يوم التحقق من الحساب'};
  if(date<change.payable_from)return {code:'bank_change_cooling_off',
    what:`حساب المورد ${vendorCode} الجديد في مهلة التهدئة، والدفع له يبدأ ${change.payable_from}`,
    next:`انتظر لين ${change.payable_from}؛ المهلة تعطي جهة الاتصال الموثقة وقت تعترض على تغيير ما طلبوه`};
  return null;
}
const separation=(vendorCode,who)=>({what:who==='preparer'
    ?`هالأمر أعدّه اللي جمع أو تحقق من حساب المورد ${vendorCode} الجديد، فما يُعتمد أثناء نافذة التغيير`
    :`أنت جمعت أو تحققت من حساب المورد ${vendorCode} الجديد، فما تعدّ ولا تعتمد ولا تطلق دفعًا له لين تنحوّل أول دفعة`,
  missing:[{document:'زميل مالي ما شارك في تغيير الحساب',why:'اللي أدخل الحساب الجديد أو تحقق منه ما يوجّه الفلوس له بنفسه',owner:'المالية — من يحمل تفويض الإعداد أو الاعتماد',owner_role:'finance'}],
  next:who==='preparer'?'ألغِ الأمر ويعدّه زميل ما شارك في التغيير':'اطلب الخطوة من زميل ما جمع بيانات الحساب ولا تحقق منها'});

// المورد القابل للدفع اليوم: مسجل، مؤهل، له حساب بنكي متحقق منه وساري، وإن كان الحساب تغييرًا فمهلته انقضت بقرار معتمد.
function payee(db,u,payable,date=riyadhToday()){
  const gate=vendorGate(db,u.tenant_id,payable.supplier_key,payable.purchase_id);
  if(gate.state==='unregistered')return {ok:false,code:'vendor_not_payable',reason:'المورد غير مسجل في دليل الموردين؛ لا يدخل دورة الدفع قبل تسجيله وتأهيله'};
  if(gate.state==='blocked')return {ok:false,code:'vendor_not_payable',vendor_id:gate.vendor_id,vendor_code:gate.code,reason:`المورد ${gate.code} غير مؤهل: ${gate.blockers.map(b=>b.message).join('؛ ')}`};
  const account=currentBankAccount(db,u.tenant_id,gate.vendor_id,date);
  if(!account.bank)return {ok:false,code:'vendor_not_payable',vendor_id:gate.vendor_id,vendor_code:gate.code,
    reason:account.upcoming?`المورد ${gate.code} بلا حساب بنكي ساري اليوم؛ حسابه المتحقق منه يسري من ${account.upcoming}`:`المورد ${gate.code} بلا حساب بنكي متحقق منه وساري`};
  const hold=changeHold(db,u.tenant_id,gate.code,account.change,date);
  if(hold)return {ok:false,code:hold.code,vendor_id:gate.vendor_id,vendor_code:gate.code,bank:account.bank,change:account.change,reason:hold.what,refusal:hold};
  return {ok:true,vendor_id:gate.vendor_id,vendor_code:gate.code,bank:account.bank,change:account.change};
}
function refuseTarget(target){
  if(target.refusal)refuse(409,target.refusal.code,target.refusal);
  fail(409,'vendor_not_payable',target.reason);
}
// تحذير حي قبل التعامل مع أمر معتمد؛ لا يمحو واقعة تحويل تمت خارج المنصة.
function executionWarning(db,u,o){
  if(o.status!=='approved')return null;
  const bank=db.prepare('SELECT status FROM vendor_bank_accounts WHERE id=?').get(o.bank_account_id);
  const target=payee(db,u,payableRow(db,u,o.payable_id));
  if(bank?.status!=='verified'||(target.bank&&target.bank.id!==o.bank_account_id))return {code:'bank_changed',message:'تغير حساب المورد بعد اعتماد الأمر. لا تستخدم الأمر لتحويل جديد؛ راجع المالية وأعد إعداده عند الحاجة.'};
  if(!target.ok&&target.code==='vendor_not_payable')return {code:'vendor_not_payable',message:target.reason};
  return null;
}
function orderView(db,u,o){
  const bank=db.prepare('SELECT bank_name,collected_by,status FROM vendor_bank_accounts WHERE id=?').get(o.bank_account_id),vendor=db.prepare('SELECT code,legal_name FROM vendors WHERE id=?').get(o.vendor_id);
  const lines=db.prepare('SELECT l.payable_id,l.line_no,l.amount_minor,i.supplier_reference FROM payment_order_lines l JOIN procurement_payables p ON p.id=l.payable_id JOIN procurement_invoices i ON i.id=p.invoice_id WHERE l.order_id=? ORDER BY l.line_no').all(o.id);
  const release=db.prepare('SELECT released_by,note,created_at FROM payment_order_releases WHERE order_id=?').get(o.id)??null;
  const returned=db.prepare('SELECT id,returned_on,bank_reference,credited_minor,reason,evidence,recorded_by,created_at FROM payment_returns WHERE order_id=?').get(o.id)??null;
  // نافذتان: نافذة حساب الأمر (أول دفعة: السقف والإطلاق)، ونافذة المورد (من يعدّ ويعتمد). تقولان الشيء نفسه ما دام
  // الأمر على الحساب الساري، وتفترقان حين يكون الأمر على حساب حلّ محله غيره.
  const change=bankChangeState(db,u.tenant_id,o.bank_account_id),window=change?.open?change:null;
  const vendorWindow=openBankChange(db,u.tenant_id,o.vendor_id),barred=vendorWindow?[vendorWindow.collected_by,vendorWindow.verified_by]:[];
  const accountBarred=window?[window.collected_by,window.verified_by]:[];
  const may=action=>u.permissions.includes(action),actions=[];
  if(o.status==='pending'&&o.prepared_by!==u.id&&may('approve')){
    if(!barred.includes(u.id)&&!barred.includes(o.prepared_by))actions.push('approve_order');
    actions.push('reject_order');
  }
  if(o.status==='pending'&&o.prepared_by===u.id)actions.push('cancel_order');
  if(o.status==='approved'&&may('approve'))actions.push('cancel_order');
  // أول دفعة لحساب متغيّر: يطلقها من يحمل الاعتماد وليس جامع البيانات ولا متحققها ولا المعدّ ولا المعتمد.
  if(o.status==='approved'&&window&&!release&&may('approve')&&![...accountBarred,o.prepared_by,o.approved_by].includes(u.id))actions.push('release_first_payment');
  // من جمع بيانات حساب المورد لا يوثق تنفيذ الدفع إليه، ولا من أعدّ الأمر ولا من اعتمده: التوثيق لشخص ثالث. وأول دفعة
  // لحساب متغيّر لا تُوثَّق قبل إطلاقها، ولا يوثّقها من تحقق من الحساب.
  if(o.status==='approved'&&may('post')&&bank.collected_by!==u.id&&o.prepared_by!==u.id&&o.approved_by!==u.id&&(!window||(release&&!accountBarred.includes(u.id))))actions.push('record_execution');
  // المرتجع يسجّله من يحمل التوثيق ولم يعدّ الأمر ولم يعتمده: مرتجعٌ مزيّف يعيد فتح الرصيد لدفعة ثانية.
  if(o.status==='executed'&&!returned&&may('post')&&o.prepared_by!==u.id&&o.approved_by!==u.id)actions.push('record_return');
  return {...o,lines,execution_mode:EXECUTION.mode,simulated:EXECUTION.simulated,
    execution_warning:executionWarning(db,u,o),status_name:returned?RETURNED_NAME:ORDER_STATUS[o.status],
    vendor_code:vendor.code,vendor_name:vendor.legal_name,bank_name:bank.bank_name,bank_current:bank.status==='verified',
    prepared_by_name:nameOf(db,o.prepared_by),approved_by_name:nameOf(db,o.approved_by),execution_recorded_by_name:nameOf(db,o.execution_recorded_by),
    first_payment:{required:!!release||(!!window&&['pending','approved'].includes(o.status)),released:!!release,state:window?.state??null,payable_from:window?.payable_from??null,
      you_are_barred:barred.includes(u.id)||accountBarred.includes(u.id)},
    release:release&&{note:release.note,created_at:release.created_at,released_by_name:nameOf(db,release.released_by)},
    returned:!!returned,return:returned&&{id:returned.id,returned_on:returned.returned_on,bank_reference:returned.bank_reference,credited_minor:returned.credited_minor,
      reason:returned.reason,evidence:returned.evidence,created_at:returned.created_at,recorded_by_name:nameOf(db,returned.recorded_by)},
    actions:[...new Set(actions)]};
}
const ADJUSTMENT_KIND={credit:'إشعار دائن — ينقص اللي علينا',debit:'إشعار مدين — يزيد اللي علينا'};
const ADJUSTMENT_STATE={pending:'ينتظر قرار زميل ثاني',approved:'معتمد ويحرّك الرصيد',rejected:'مرفوض'};
function adjustmentView(db,u,a){
  const may=action=>u.permissions.includes(action);
  return {...a,kind_name:ADJUSTMENT_KIND[a.kind],status_name:ADJUSTMENT_STATE[a.status],recorded_by_name:nameOf(db,a.recorded_by),decided_by_name:nameOf(db,a.decided_by),
    actions:a.status==='pending'&&a.recorded_by!==u.id&&may('approve')?['approve_adjustment','reject_adjustment']:[]};
}
const adjustmentRows=(db,tenantId,adjustmentId=null)=>db.prepare(`SELECT a.*,i.supplier_reference,i.supplier_key FROM payable_adjustments a JOIN procurement_payables p ON p.id=a.payable_id JOIN procurement_invoices i ON i.id=p.invoice_id
  WHERE a.tenant_id=? ${adjustmentId?'AND a.id=?':''} ORDER BY a.created_at DESC,a.rowid DESC`).all(...[tenantId,...(adjustmentId?[adjustmentId]:[])]);

export function listPayables(db,supplied){
  const u=actor(db,supplied);
  const orders=db.prepare('SELECT * FROM payment_orders WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC').all(u.tenant_id).map(o=>orderView(db,u,o));
  const rows=db.prepare('SELECT p.*,i.supplier_key,i.supplier_reference,o.supplier_name FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id JOIN procurement_orders o ON o.purchase_id=p.purchase_id WHERE i.tenant_id=? ORDER BY p.created_at DESC,p.rowid DESC').all(u.tenant_id);
  const payables=rows.map(p=>{
    const balance=payableBalance(db,p.id);
    const live=orders.filter(o=>o.lines.some(l=>l.payable_id===p.id)&&(['pending','approved'].includes(o.status)||(o.status==='executed'&&!o.returned)));
    const latest=live.find(o=>['pending','approved'].includes(o.status))??live[0]??null;
    const target=balance.available_minor>0?payee(db,u,p):null;
    let block=target&&!target.ok?target.reason:null;
    if(!block&&target?.change?.open&&[target.change.collected_by,target.change.verified_by].includes(u.id))
      block=`أنت جمعت أو تحققت من حساب المورد ${target.vendor_code} الجديد، فما تعدّ له دفعًا لين تنحوّل أول دفعة`;
    return {id:p.id,invoice_id:p.invoice_id,supplier_key:p.supplier_key,supplier_name:p.supplier_name,supplier_reference:p.supplier_reference,amount_minor:p.amount_minor,currency:p.currency,
      balance:{adjusted_minor:balance.adjusted_minor,paid_minor:balance.paid_minor,returned_minor:balance.returned_minor,in_flight_minor:balance.in_flight_minor,
        outstanding_minor:balance.outstanding_minor,available_minor:balance.available_minor,status:balance.status,status_name:balance.status_name},
      order_status:latest?.status??null,payable:target?target.ok&&!block:null,block_reason:block,vendor_id:target?.vendor_id??null,
      first_payment:!!(target?.ok&&target.change?.open)};
  });
  const taxes=db.prepare('SELECT t.*,i.supplier_key,i.supplier_reference,i.amount_minor AS invoice_amount_minor FROM procurement_invoice_tax t JOIN procurement_invoices i ON i.id=t.invoice_id WHERE t.tenant_id=? ORDER BY t.created_at DESC').all(u.tenant_id).map(t=>({...t,actions:t.status==='pending'&&t.recorded_by!==u.id&&u.permissions.includes('approve')?['verify_tax','reject_tax']:[]}));
  const untaxed=db.prepare("SELECT i.id,i.supplier_key,i.supplier_reference,i.amount_minor FROM procurement_invoices i WHERE i.tenant_id=? AND NOT EXISTS(SELECT 1 FROM procurement_invoice_tax t WHERE t.invoice_id=i.id AND t.status<>'rejected') ORDER BY i.created_at DESC").all(u.tenant_id);
  const sum=(list,amount)=>list.reduce((n,r)=>n+amount(r),0);
  return {today:riyadhToday(),user_id:u.id,permissions:u.permissions,order_status:ORDER_STATUS,balance_status:BALANCE_STATUS,execution:EXECUTION,payables,orders,
    // المفتاح خاص لا عام: صندوق «أقرّر» يمشي الحمولة ويسمّي البنود بمفتاحها (KINDS في app/inbox.mjs)، و«adjustments» هناك حركة راتب.
    payable_adjustments:adjustmentRows(db,u.tenant_id).map(a=>adjustmentView(db,u,a)),taxes,untaxed_invoices:untaxed,
    // القوائم والقيم المُدارة التي تخصّ المدفوعات: نسبة الضريبة بجدولها المؤرَّخ، وحالات أمر الدفع بقيدها، وسقف أول دفعة.
    managed_options:listsBoard(db,u.tenant_id,'payables'),
    totals:{unpaid_minor:sum(payables,p=>p.balance.outstanding_minor),approved_not_executed_minor:sum(orders.filter(o=>o.status==='approved'),o=>o.amount_minor),
      executed_minor:sum(orders.filter(o=>o.status==='executed'&&!o.returned),o=>o.amount_minor),returned_minor:sum(orders.filter(o=>o.returned),o=>o.amount_minor),
      verified_input_vat_minor:sum(taxes.filter(t=>t.status==='verified'),t=>t.vat_minor)},
    note:'اعتماد أمر الدفع ما يعني إن البنك حوّل. المستحق ما ينحسب مدفوع إلا بعد ما يسجّل موظف ثالث تنفيذ التحويل بمرجعه البنكي ودليله، والتحويل الراجع يرجّع الرصيد مفتوح.'};
}
export function getOrder(db,supplied,orderId){
  const u=actor(db,supplied),o=typeof orderId==='string'&&db.prepare('SELECT * FROM payment_orders WHERE id=? AND tenant_id=?').get(orderId,u.tenant_id);
  if(!o)fail(404,'not_found','أمر الدفع غير متاح أو ليس من كيانك');
  return orderView(db,u,o);
}

// أمر الدفع: مستحق واحد بكامل المتاح أو بجزء منه ({payable_id, amount?})، أو عدة مستحقات لمورد واحد بتحويل واحد
// ({lines:[{payable_id, amount?}]}). كل سطر لا يتجاوز المتاح على مستحقه — في الكود هنا وفي SQL (الترحيل 166).
export function preparePayment(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['payable_id','amount','lines']);
  const batch=input.lines!==undefined;
  if(batch&&(input.payable_id!==undefined||input.amount!==undefined))fail(400,'invalid_fields','أرسل مستحقًا واحدًا بمبلغه أو سطور الدفعة، مو الاثنين مع بعض');
  if(batch&&(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>50))
    refuse(400,'invalid_lines',{what:'سطور الدفعة لازم تكون من سطر واحد إلى خمسين',next:'أضف كل مستحق بمبلغه في سطر'});
  const seen=new Set();
  const lines=(batch?input.lines:[{payable_id:input.payable_id,...(input.amount!==undefined?{amount:input.amount}:{})}]).map((line,index)=>{
    v.object(line,['payable_id','amount']);
    const payable=payableRow(db,u,line.payable_id);
    if(!payable)fail(404,'not_found','المستحق غير متاح أو ليس من كيانك');
    if(seen.has(payable.id))refuse(400,'batch_duplicate_payable',{what:'المستحق نفسه مكرر في سطور الدفعة',next:'اجمع مبلغ المستحق في سطر واحد'});
    seen.add(payable.id);
    const amount=line.amount===undefined||line.amount===null||line.amount===''?null:money(line.amount,'مبلغ الدفعة');
    if(amount===0)refuse(400,'invalid_money',{what:'مبلغ الدفعة صفر',next:'اكتب مبلغًا أكبر من صفر أو احذف السطر'});
    return {payable,amount,line_no:index+1,balance:payableBalance(db,payable.id)};
  });
  // الرصيد أولًا: ما لا شيء عليه لا يُسأل عن مورده ولا حسابه.
  for(const l of lines){
    const available=l.balance.available_minor;
    if(available<=0){
      if(l.balance.outstanding_minor<=0)refuse(409,'payable_settled',{what:`المستحق ${l.payable.supplier_reference} ما عليه شيء: انحوّل كامل أو سوّته الإشعارات`,next:'راجع رصيده في شاشة المدفوعات'});
      fail(409,'order_exists','للمستحق أمر دفع قائم يغطي كل رصيده؛ ألغه أو انتظر تنفيذه قبل أمر جديد');
    }
    if(l.amount===null)l.amount=available;
    // ما تحجزه المشتريات لا يُدفع (الترحيل 169): طلب إلغاء ينتظر قراره، أو إشعار دائن مطلوب من المورد. القادح في القاعدة
    // يرفضه على كل حال؛ وهنا يُرفض باسمه ومقداره قبل أن يصل إليه، بدل خطأ خادم لا يقول شيئًا.
    const hold=paymentHold(db,l.payable.id);
    if(hold.void_pending)refuse(409,'void_pending',{what:`على المستحق ${l.payable.supplier_reference} طلب إلغاء ينتظر قراره، فما يُدفع للحين`,
      missing:[{document:'قرار طلب الإلغاء',owner:'المعتمد المستقل في المشتريات',why:'ما يُدفع مستحقٌ ممكن ينلغى'}],next:'انتظر قرار الإلغاء، ثم جهّز الدفعة من جديد'});
    if(l.amount<=available&&l.amount>hold.payable_now_minor)refuse(409,'payment_withheld',{
      what:`مبلغ ${decimal(l.amount)} أكبر مما يُدفع الآن من المستحق ${l.payable.supplier_reference} (${decimal(hold.payable_now_minor)}): ${decimal(hold.withheld_minor)} محجوز لإشعار دائن مطلوب من المورد`,
      missing:[{document:'إشعار المورد الدائن، أو تنازل مالي مكتوب عن الفرق',owner:'المشتريات والمالية',why:'الجزء المتنازع عليه ما يُدفع حتى يُحسم'}],
      next:hold.payable_now_minor>0?`ادفع ${decimal(hold.payable_now_minor)} الآن، والباقي بعد الإشعار أو التنازل`:'انتظر الإشعار الدائن أو التنازل المكتوب'});
    if(l.amount>available)refuse(409,'exceeds_balance',{what:`مبلغ ${decimal(l.amount)} أكبر من المتاح على المستحق ${l.payable.supplier_reference} (${decimal(available)})`,
      next:'اكتب مبلغًا لا يتجاوز المتاح، أو ألغِ أمرًا معلّقًا عليه'});
  }
  const targets=lines.map(l=>payee(db,u,l.payable)),blocked=targets.find(t=>!t.ok);
  if(blocked)refuseTarget(blocked);
  if(new Set(targets.map(t=>t.vendor_id)).size>1)
    refuse(409,'batch_mixed_vendors',{what:'سطور الدفعة لموردين مختلفين، والتحويل الواحد يروح لحساب مورد واحد',next:'افصل كل مورد في أمر دفع'});
  const target=targets[0],change=target.change;
  // نافذة التغيير: جامع البيانات ومن تحقق منها لا يعدّان دفعًا لهذا المورد (والقادح payment_orders_window_preparer يقولها في SQL).
  const window=openBankChange(db,u.tenant_id,target.vendor_id);
  if(window&&[window.collected_by,window.verified_by].includes(u.id))refuse(409,'bank_change_separation',separation(target.vendor_code,'self'));
  const total=lines.reduce((n,l)=>n+l.amount,0),first=!!change?.open;
  // أول دفعة لحساب متغيّر: ما تتجاوز سقف المالك، وواحدة في الطريق حتى تُنفَّذ.
  if(first){
    const cap=firstPaymentCap(db,u.tenant_id);
    if(total>cap.minor)refuse(409,'first_payment_cap',{what:`أول دفعة لحساب المورد ${target.vendor_code} الجديد ما تتجاوز ${decimal(cap.minor)} ريال، والمطلوب ${decimal(total)}`,
      next:'اعمل أول دفعة بمبلغ لا يتجاوز السقف، والباقي بعد ما تنحوّل'});
    if(db.prepare("SELECT 1 FROM payment_orders WHERE bank_account_id=? AND status IN ('pending','approved')").get(target.bank.id))
      refuse(409,'first_payment_in_flight',{what:`لحساب المورد ${target.vendor_code} الجديد دفعة أولى في الطريق`,next:'انتظر لين تنحوّل الدفعة الأولى أو تنلغى، وبعدها أعدّ غيرها'});
  }
  const orderId=id(),time=now();
  db.prepare("INSERT INTO payment_orders(id,tenant_id,payable_id,vendor_id,bank_account_id,amount_minor,currency,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'SAR','pending',?,?,?)")
    .run(orderId,u.tenant_id,lines[0].payable.id,target.vendor_id,target.bank.id,total,u.id,time,time);
  const line=db.prepare('INSERT INTO payment_order_lines(id,tenant_id,order_id,payable_id,line_no,amount_minor,created_at) VALUES(?,?,?,?,?,?,?)');
  for(const l of lines)line.run(id(),u.tenant_id,orderId,l.payable.id,l.line_no,l.amount,time);
  audit(db,u,'payment_order',orderId,'payment.prepared',{}, {payable_id:lines[0].payable.id,amount_minor:total,vendor:target.vendor_code,
    lines:lines.map(l=>({payable_id:l.payable.id,amount_minor:l.amount})),partial:lines.some(l=>l.amount<l.balance.available_minor),batch:lines.length>1,first_payment:first});
  return {id:orderId};
}
export function paymentAction(db,supplied,orderId,action,input){
  writing(db);
  const u=actor(db,supplied);
  const fields={approve_order:['note'],reject_order:['note'],cancel_order:['note'],release_first_payment:['note'],
    record_execution:['executed_on','bank_reference','evidence'],record_return:['returned_on','bank_reference','credited','reason','evidence']}[action];
  if(!fields)refuse(404,'not_found',{what:'الإجراء غير معروف على أمر الدفع',next:`الإجراءات: ${Object.values(ACTION_NAMES).join('، ')}`});
  v.object(input,['version',...fields]);
  const o=getOrder(db,u,orderId);
  v.version(input.version,o.version);
  if(!o.actions.includes(action)){
    // الرفض المسمّى قبل العام: الحساب الذي أُعدّ عليه الأمر حلّ محله غيره (يسبق كل شيء: الأمر لا يُعتمد أيًّا كان من أعدّه)،
    // ثم فصل المهام في نافذة التغيير، ثم إطلاق أول دفعة قبل تسجيلها.
    if(action==='approve_order'&&o.status==='pending'&&!o.bank_current&&o.prepared_by!==u.id&&u.permissions.includes('approve'))fail(409,'bank_changed','تغير حساب المورد الساري بعد إعداد الأمر. ألغِ الأمر وأعد إعداده على الحساب الجديد');
    const window=openBankChange(db,u.tenant_id,o.vendor_id),barred=window?[window.collected_by,window.verified_by]:[];
    if(action==='approve_order'&&o.status==='pending'&&o.prepared_by!==u.id&&u.permissions.includes('approve')&&(barred.includes(u.id)||barred.includes(o.prepared_by)))
      refuse(409,'bank_change_separation',separation(o.vendor_code,barred.includes(u.id)?'self':'preparer'));
    if(action==='release_first_payment'&&o.status==='approved'&&o.first_payment.required&&!o.first_payment.released){
      if(o.first_payment.you_are_barred)refuse(409,'bank_change_separation',separation(o.vendor_code,'self'));
      if([o.prepared_by,o.approved_by].includes(u.id))refuse(409,'separation_of_duties',{what:'اللي أعدّ أمر الدفع أو اعتمده ما يطلق أول دفعة له',
        missing:[{document:'إطلاق من شخص ثالث',why:'الإطلاق عين ثالثة على أول تحويل لحساب تغيّر',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],
        next:'اطلب الإطلاق من زميل يحمل تفويض الاعتماد وما شارك في الأمر ولا في تغيير الحساب'});
    }
    if(action==='record_execution'&&o.status==='approved'&&o.first_payment.required&&!o.first_payment.released)
      refuse(409,'first_payment_release_required',{what:'هذي أول دفعة لحساب مورد تغيّر، وما تنسجل منفّذة قبل ما يطلقها شخص ثالث',
        missing:[{document:'إطلاق أول دفعة',why:'التحويل الأول لحساب جديد هو اللي يضيع لو كان التغيير احتيالًا، فيمرّ على عين ثالثة قبل البنك',
          owner:'المالية — من يحمل تفويض الاعتماد غير المعدّ والمعتمد وجامع بيانات الحساب ومتحققها',owner_role:'finance'}],
        next:'اطلب الإطلاق أول، وبعدها سجّل التنفيذ'});
    v.actionUnavailable(action,{subject:'أمر الدفع',state_name:o.status_name,available:o.actions,names:ACTION_NAMES});
  }
  const time=now(),set=(sql,...args)=>db.prepare(`UPDATE payment_orders SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,o.id);
  let extra={},bumped=true;
  if(action==='approve_order'){
    // الحساب الذي سيُدفع إليه يجب أن يبقى هو الساري عند الاعتماد؛ تغيير الحساب بعد الإعداد يلغي الأمر ولا يحوله بصمت.
    const bank=db.prepare('SELECT status FROM vendor_bank_accounts WHERE id=?').get(o.bank_account_id);
    const targets=o.lines.map(l=>payee(db,u,payableRow(db,u,l.payable_id))),current=targets.find(t=>t.bank)?.bank;
    if(bank.status!=='verified'||(current&&current.id!==o.bank_account_id))fail(409,'bank_changed','تغير حساب المورد الساري بعد إعداد الأمر. ألغِ الأمر وأعد إعداده على الحساب الجديد');
    const blocked=targets.find(t=>!t.ok);
    if(blocked)refuseTarget(blocked);
    if(o.first_payment.required){
      const cap=firstPaymentCap(db,u.tenant_id);
      if(o.amount_minor>cap.minor)refuse(409,'first_payment_cap',{what:`أول دفعة لحساب المورد ${o.vendor_code} الجديد صارت أكبر من السقف المعتمد (${decimal(cap.minor)} ريال)`,next:'ألغِ الأمر وأعدّه بمبلغ لا يتجاوز السقف'});
    }
    set("status='approved',approved_by=?,approved_at=?,decision_note=?",u.id,time,v.text(input.note,'أساس الاعتماد',2000,3));
  }
  if(action==='reject_order')set("status='rejected',decision_note=?",v.text(input.note,'سبب الرفض',2000,10));
  if(action==='cancel_order')set("status='cancelled',decision_note=?",v.text(input.note,'سبب الإلغاء',2000,10));
  if(action==='release_first_payment'){
    // الإطلاق يعيد فحص ما يمنع الدفع اليوم: المهلة والقرار والحساب الساري والسقف — فقد يتغيّر أيٌّ منها بعد الاعتماد.
    const target=payee(db,u,payableRow(db,u,o.payable_id));
    if(!target.ok)refuseTarget(target);
    if(target.bank.id!==o.bank_account_id)fail(409,'bank_changed','تغير حساب المورد الساري بعد اعتماد الأمر. ألغِ الأمر وأعد إعداده على الحساب الجديد');
    const cap=firstPaymentCap(db,u.tenant_id);
    if(o.amount_minor>cap.minor)refuse(409,'first_payment_cap',{what:`أول دفعة لحساب المورد ${o.vendor_code} الجديد أكبر من السقف المعتمد (${decimal(cap.minor)} ريال)`,next:'ألغِ الأمر وأعدّه بمبلغ لا يتجاوز السقف'});
    db.prepare('INSERT INTO payment_order_releases(order_id,tenant_id,change_id,released_by,note,created_at) VALUES(?,?,?,?,?,?)')
      .run(o.id,u.tenant_id,target.change.id,u.id,v.text(input.note,'أساس الإطلاق: مع من تأكدتوا من الحساب الجديد وكيف',2000,10),time);
    extra={released:true,change_id:target.change.id};bumped=false;
  }
  if(action==='record_execution'){
    const executed=v.date(input.executed_on);
    // يوم اعتماد الأمر بتوقيت الرياض لا أول عشرة أحرف من طابعه (UTC)، وإلا قُبل بين 00:00 و03:00 تاريخُ تنفيذٍ يسبق الاعتماد بيوم.
    if(executed>riyadhToday()||executed<riyadhDate(o.approved_at))fail(400,'executed_on','تاريخ التنفيذ بين اعتماد الأمر واليوم');
    const reference=v.text(input.bank_reference,'المرجع البنكي',120,4).normalize('NFKC').toUpperCase();
    if(db.prepare('SELECT 1 FROM payment_orders WHERE tenant_id=? AND bank_reference=?').get(u.tenant_id,reference))fail(409,'duplicate_reference','المرجع البنكي مسجل على أمر آخر');
    set("status='executed',executed_on=?,bank_reference=?,execution_evidence=?,execution_recorded_by=?",executed,reference,v.text(input.evidence,'دليل التنفيذ',3000,10),u.id);
    extra={execution_mode:EXECUTION.mode,simulated:EXECUTION.simulated,first_payment:o.first_payment.required,...(o.execution_warning?{execution_warning:o.execution_warning}:{})};
  }
  if(action==='record_return'){
    // المرتجع سجل مستقل: الأمر المنفّذ يبقى منفّذًا بمرجعه، وسطوره تخرج من «المدفوع» فيُفتح الرصيد (payable_balances).
    const returned=v.date(input.returned_on);
    if(returned>riyadhToday()||returned<o.executed_on)refuse(400,'returned_on',{what:`تاريخ المرتجع لازم يكون بين تنفيذ الأمر (${o.executed_on}) واليوم`,next:'اكتب اليوم اللي رجع فيه المبلغ لحساب الشركة كما في كشف البنك'});
    const credited=money(input.credited,'المبلغ الراجع لحساب الشركة');
    if(credited<=0||credited>o.amount_minor)refuse(400,'return_exceeds_order',{what:`المبلغ الراجع (${decimal(credited)}) لازم يكون أكبر من صفر وما يتجاوز مبلغ التحويل (${decimal(o.amount_minor)})`,
      next:'اكتب المبلغ اللي دخل حساب الشركة فعلًا كما في كشف البنك؛ الفرق رسوم بنك'});
    const reference=v.text(input.bank_reference,'مرجع المرتجع في البنك',120,4).normalize('NFKC').toUpperCase();
    if(db.prepare('SELECT 1 FROM payment_returns WHERE tenant_id=? AND bank_reference=?').get(u.tenant_id,reference))
      refuse(409,'duplicate_return_reference',{what:'مرجع المرتجع مسجّل على مرتجع ثاني',next:'راجع كشف البنك واكتب مرجع هالمرتجع بالذات'});
    const returnId=id();
    db.prepare('INSERT INTO payment_returns(id,tenant_id,order_id,returned_on,bank_reference,credited_minor,reason,evidence,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(returnId,u.tenant_id,o.id,returned,reference,credited,v.text(input.reason,'سبب رجوع التحويل',2000,10),v.text(input.evidence,'دليل المرتجع ومكان حفظه',3000,10),u.id,time);
    extra={return_id:returnId,credited_minor:credited,reopened:o.lines.map(l=>({payable_id:l.payable_id,amount_minor:l.amount_minor})),first_payment:o.first_payment.required};bumped=false;
  }
  audit(db,u,'payment_order',o.id,'payment.'+action,{status:o.status},{version:bumped?o.version+1:o.version,...extra});
  return getOrder(db,u,o.id);
}

/* ───── التسويات: إشعار دائن أو مدين من المورد على مستحق ───── */
// جدول عام (الترحيل 166) تستعمله حزم المشتريات والذمم اللاحقة: source_kind/source_id يربطان التسوية بمستندها (مرتجع
// مشتريات، مطالبة، …) و'manual' لما يُسجَّل من هنا. تُسجَّل بسببها ودليلها، ويعتمدها أو يرفضها زميل ثانٍ، ولا تُعدَّل بعد القرار.
export function recordAdjustment(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['payable_id','kind','amount','vat','reference','reason','evidence','source_kind','source_id']);
  const payable=payableRow(db,u,input.payable_id);
  if(!payable)refuse(404,'not_found',{what:'المستحق غير متاح أو ما هو من كيانك',next:'اختر مستحقًا من قائمة المدفوعات'});
  if(!Object.hasOwn(ADJUSTMENT_KIND,input.kind))refuse(400,'adjustment_kind',{what:'نوع التسوية لازم يكون إشعار دائن (credit) أو مدين (debit)',next:'اختر النوع كما هو مكتوب في إشعار المورد'});
  const amount=money(input.amount,'مبلغ الإشعار'),vat=input.vat===undefined||input.vat===null||input.vat===''?0:money(input.vat,'ضريبة الإشعار');
  if(amount<=0)refuse(400,'invalid_money',{what:'مبلغ الإشعار صفر',next:'اكتب مبلغ الإشعار كما هو مكتوب فيه'});
  if(vat>amount)refuse(400,'invalid_vat',{what:'ضريبة الإشعار أكبر من مبلغه',next:'اكتب الضريبة المذكورة في الإشعار، وهي جزء من مبلغه'});
  const reference=v.text(input.reference,'رقم الإشعار عند المورد',120,1).normalize('NFKC').trim().toUpperCase();
  const reason=v.text(input.reason,'سبب التسوية',2000,10),evidence=v.text(input.evidence,'مرجع الإشعار ومكان حفظه',3000,10);
  const sourceKind=input.source_kind===undefined?'manual':v.text(input.source_kind,'نوع المستند المصدر',40,3);
  if(!/^[a-z_]{3,40}$/.test(sourceKind))refuse(400,'source_kind',{what:'نوع المستند المصدر حروف لاتينية صغيرة وشرطة سفلية فقط',next:'مثل manual أو procurement_return'});
  const sourceId=input.source_id===undefined||input.source_id===null||input.source_id===''?null:v.text(input.source_id,'معرّف المستند المصدر',120,1);
  const balance=payableBalance(db,payable.id);
  if(input.kind==='credit'&&amount>balance.available_minor)refuse(409,'adjustment_exceeds_balance',{what:`الإشعار الدائن (${decimal(amount)}) أكبر من المتاح على المستحق (${decimal(balance.available_minor)})`,
    next:'الدائن ما ينزل بالمستحق تحت المدفوع وما في الطريق. ألغِ أمر الدفع المعلّق أو سجّل الإشعار بعد تنفيذه على المستحق التالي'});
  if(db.prepare("SELECT 1 FROM payable_adjustments WHERE tenant_id=? AND payable_id=? AND kind=? AND reference=? AND status<>'rejected'").get(u.tenant_id,payable.id,input.kind,reference))
    refuse(409,'duplicate_adjustment',{what:`الإشعار ${reference} مسجّل على هالمستحق من قبل`,next:'راجع التسويات المسجّلة قبل ما تضيف الإشعار مرة ثانية'});
  const adjustmentId=id(),vendorId=vendorGate(db,u.tenant_id,payable.supplier_key,payable.purchase_id).vendor_id??null;
  db.prepare("INSERT INTO payable_adjustments(id,tenant_id,payable_id,vendor_id,kind,amount_minor,vat_minor,reference,reason,evidence,source_kind,source_id,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)")
    .run(adjustmentId,u.tenant_id,payable.id,vendorId,input.kind,amount,vat,reference,reason,evidence,sourceKind,sourceId,u.id,now());
  audit(db,u,'payable_adjustment',adjustmentId,'payable_adjustment.recorded',{}, {payable_id:payable.id,kind:input.kind,amount_minor:amount,vat_minor:vat,reference,source_kind:sourceKind});
  return {id:adjustmentId};
}
export function getAdjustment(db,supplied,adjustmentId){
  const u=actor(db,supplied),row=typeof adjustmentId==='string'?adjustmentRows(db,u.tenant_id,adjustmentId)[0]:null;
  if(!row)refuse(404,'not_found',{what:'التسوية غير متاحة أو ما هي من كيانك',next:'افتح قائمة التسويات في شاشة المدفوعات'});
  return adjustmentView(db,u,row);
}
export function decideAdjustment(db,supplied,adjustmentId,decision,input){
  writing(db);
  const u=actor(db,supplied,'approve');
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))refuse(404,'not_found',{what:'القرار على التسوية إمّا اعتماد أو رفض',next:'اختر approve أو reject'});
  const a=typeof adjustmentId==='string'&&db.prepare("SELECT * FROM payable_adjustments WHERE id=? AND tenant_id=? AND status='pending'").get(adjustmentId,u.tenant_id);
  if(!a)refuse(404,'not_found',{what:'التسوية غير متاحة للقرار — ما هي معلّقة أو ما هي من كيانك',next:'افتح قائمة التسويات واختر تسوية تنتظر القرار'});
  if(a.recorded_by===u.id)refuse(403,'self_approval',{what:'اللي سجّل التسوية ما يعتمدها ولا يرفضها بنفسه',
    missing:[{document:'قرار زميل ثاني',why:'التسوية تغيّر اللي علينا للمورد، فتمرّ على عينين',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],
    next:'اطلب القرار من زميل يحمل تفويض الاعتماد'});
  const note=v.text(input.note,'أساس القرار',2000,decision==='approve'?3:10);
  if(decision==='approve'&&a.kind==='credit'){
    const balance=payableBalance(db,a.payable_id);
    if(a.amount_minor>balance.available_minor)refuse(409,'adjustment_exceeds_balance',{what:`الإشعار الدائن (${decimal(a.amount_minor)}) صار أكبر من المتاح على المستحق (${decimal(balance.available_minor)})`,
      next:'ارفض الإشعار الآن بسببه، أو انتظر إلغاء أمر الدفع المعلّق على المستحق'});
  }
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE payable_adjustments SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),note,a.id);
  audit(db,u,'payable_adjustment',a.id,'payable_adjustment.'+status,{status:'pending'},{status,payable_id:a.payable_id,kind:a.kind,amount_minor:a.amount_minor});
  return getAdjustment(db,u,a.id);
}

/* ───── خطّاف الدفتر: ما يُقيَّد من جهة الدفع، بلا كتابة قيد ───── */
// الدفتر يُعاد بناؤه (سجل أنواع المستندات المصدر في app/ledger.mjs وapp/finance.mjs)، فهذه الوحدة لا تكتب قيدًا: تعرض
// لكل مستند وقائعه وسطوره المقترحة بالشكل نفسه الذي يعيده sourceDocument في ledger.mjs — [الغرض، مدين، دائن، بيان]
// بمبالغ صحيحة بالهللة — ليسجّلها الدفتر أنواعًا في سجلّه. غرضان لا يعرفهما الدفتر اليوم: bank_charges (فرق المرتجع)
// وpurchase_adjustment (الطرف المقابل لإشعار المورد)؛ يربطهما صاحب الدفتر بحسابيهما أو يبدّلهما.
export const LEDGER_SOURCE_KINDS=Object.freeze({supplier_payment:'دفعة مورد انحوّلت (تنفيذها مسجّل يدويًا)',
  supplier_payment_return:'مرتجع دفعة مورد',supplier_adjustment:'إشعار دائن أو مدين من مورد (معتمد)'});
export function paymentLedgerSources(db,tenantId){
  return [
    ...db.prepare("SELECT id,bank_reference,amount_minor,executed_on FROM payment_orders WHERE tenant_id=? AND status='executed'").all(tenantId)
      .map(r=>({source_kind:'supplier_payment',source_id:r.id,reference:r.bank_reference,amount_minor:r.amount_minor,date:r.executed_on})),
    ...db.prepare('SELECT r.id,r.bank_reference,r.credited_minor,r.returned_on,o.amount_minor FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id WHERE r.tenant_id=?').all(tenantId)
      .map(r=>({source_kind:'supplier_payment_return',source_id:r.id,reference:r.bank_reference,amount_minor:r.amount_minor,credited_minor:r.credited_minor,date:r.returned_on})),
    ...db.prepare("SELECT id,kind,reference,amount_minor,decided_at FROM payable_adjustments WHERE tenant_id=? AND status='approved'").all(tenantId)
      .map(r=>({source_kind:'supplier_adjustment',source_id:r.id,reference:r.reference,amount_minor:r.amount_minor,kind:r.kind,date:riyadhDate(r.decided_at)}))
  ].map(s=>({...s,source_name:LEDGER_SOURCE_KINDS[s.source_kind]})).sort((a,b)=>b.date.localeCompare(a.date));
}
export function paymentLedgerDocument(db,tenantId,kind,sourceId){
  if(typeof sourceId!=='string')return null;
  if(kind==='supplier_payment'){
    const o=db.prepare("SELECT o.*,x.legal_name FROM payment_orders o JOIN vendors x ON x.id=o.vendor_id WHERE o.id=? AND o.tenant_id=? AND o.status='executed'").get(sourceId,tenantId);
    if(!o)return null;
    return {date:o.executed_on,reference:o.bank_reference,description:`دفعة مورد ${o.bank_reference} — ${o.legal_name}`,execution_mode:EXECUTION.mode,
      lines:[['payable',o.amount_minor,0,'تخفيض ذمة المورد'],['bank',0,o.amount_minor,'المبلغ المحوّل من البنك']]};
  }
  if(kind==='supplier_payment_return'){
    const r=db.prepare('SELECT r.*,o.amount_minor,o.bank_reference AS order_reference,x.legal_name FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id JOIN vendors x ON x.id=o.vendor_id WHERE r.id=? AND r.tenant_id=?').get(sourceId,tenantId);
    if(!r)return null;
    const fee=r.amount_minor-r.credited_minor;
    return {date:r.returned_on,reference:r.bank_reference,description:`مرتجع دفعة المورد ${r.order_reference} — ${r.legal_name}`,
      lines:[['bank',r.credited_minor,0,'المبلغ الراجع لحساب الشركة'],...(fee>0?[['bank_charges',fee,0,'رسوم البنك على التحويل الراجع']]:[]),['payable',0,r.amount_minor,'إعادة ذمة المورد بمبلغ التحويل']]};
  }
  if(kind==='supplier_adjustment'){
    const a=db.prepare("SELECT a.*,i.supplier_reference FROM payable_adjustments a JOIN procurement_payables p ON p.id=a.payable_id JOIN procurement_invoices i ON i.id=p.invoice_id WHERE a.id=? AND a.tenant_id=? AND a.status='approved'").get(sourceId,tenantId);
    if(!a)return null;
    const net=a.amount_minor-a.vat_minor,vatLine=a.vat_minor>0;
    const lines=a.kind==='credit'
      ?[['payable',a.amount_minor,0,'إشعار دائن ينقص ذمة المورد'],...(vatLine?[['input_vat',0,a.vat_minor,'عكس ضريبة المدخلات في الإشعار']]:[]),['purchase_adjustment',0,net,'تخفيض تكلفة المشتريات']]
      :[['purchase_adjustment',net,0,'زيادة تكلفة المشتريات'],...(vatLine?[['input_vat',a.vat_minor,0,'ضريبة المدخلات في الإشعار']]:[]),['payable',0,a.amount_minor,'إشعار مدين يزيد ذمة المورد']];
    return {date:riyadhDate(a.decided_at),reference:a.reference,description:`${ADJUSTMENT_KIND[a.kind]} ${a.reference} على فاتورة ${a.supplier_reference}`,source_kind:a.source_kind,source_id:a.source_id,lines};
  }
  return null;
}

// الحزمة 3 (المطابقة البنكية والإقفال): مرتجع دفعة المورد نوعٌ في سجل الدفتر يُبنى من paymentLedgerDocument أعلاه بسطوره نفسها —
// مدين البنك بما دخل فعلًا، ومدين رسوم البنك بالفرق، ودائن ذمة المورد بمبلغ الأمر — فيعود المستحق في الأستاذ المساعد وفي الدفتر معًا.
// والسجل لا يستورد الدفتر (app/ledger-sources.mjs)، فلا دورة: الدفتر يستورد هذا الملف.
const returnRows=(db,tenantId)=>db.prepare('SELECT r.id,r.bank_reference,r.returned_on,o.amount_minor FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id WHERE r.tenant_id=?').all(tenantId);
const returnRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT r.*,o.amount_minor,o.bank_reference AS order_reference,x.legal_name FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id JOIN vendors x ON x.id=o.vendor_id WHERE r.id=? AND r.tenant_id=?').get(id,tenantId)??null:null;
registerSourceKind({key:'supplier_payment_return',name:LEDGER_SOURCE_KINDS.supplier_payment_return,module:'payables',bank:'cash',
  build:(db,u,id)=>paymentLedgerDocument(db,u.tenant_id,'supplier_payment_return',id),
  pending:(db,tenantId)=>returnRows(db,tenantId).map(r=>({source_id:r.id,reference:r.bank_reference,amount_minor:r.amount_minor,date:r.returned_on})),
  // المرتجع يعيد فتح ذمة المورد بمبلغ الأمر: أثره على الحساب الرقابي موجب بإشارة الالتزام الطبيعية، مقابل سالب الدفعة.
  controls:{payable:(db,tenantId)=>returnRows(db,tenantId).map(r=>({source_id:r.id,reference:r.bank_reference,date:r.returned_on,amount_minor:r.amount_minor}))},
  document:(db,tenantId,id)=>{const r=returnRow(db,tenantId,id);return r&&{reference:r.bank_reference,date:r.returned_on,amount_minor:r.amount_minor,status:'recorded',description:`مرتجع دفعة ${r.order_reference} — ${r.legal_name}`};},
  approvals:(db,tenantId,id)=>{const r=returnRow(db,tenantId,id);return r?[{role:'سجّل المرتجع',actor_id:r.recorded_by,at:r.created_at,note:r.reason}]:[];}});
registerSourceLink({from:'supplier_payment',role:'reversal',module:'payables',list:(db,tenantId,id)=>db.prepare('SELECT r.id,r.bank_reference,r.returned_on,o.amount_minor FROM payment_returns r JOIN payment_orders o ON o.id=r.order_id WHERE r.order_id=? AND r.tenant_id=?').all(id,tenantId)
  .map(r=>({kind:'supplier_payment_return',id:r.id,reference:r.bank_reference,date:r.returned_on,amount_minor:r.amount_minor,status:'recorded'}))});

// هوية الفاتورة الضريبية مستقلة عن مرجع الشراء الداخلي؛ لا تُحذف العلامات أو الأصفار.
const taxReference=value=>value.normalize('NFKC').trim().toUpperCase();
function uniqueTaxInvoice(db,tenantId,vatNumber,reference,excludeId=null){
  const rows=db.prepare("SELECT id,supplier_invoice_number FROM procurement_invoice_tax WHERE tenant_id=? AND supplier_vat_number=? AND status<>'rejected'").all(tenantId,vatNumber);
  if(rows.some(row=>row.id!==excludeId&&taxReference(row.supplier_invoice_number)===taxReference(reference)))fail(409,'duplicate_tax_invoice','رقم الفاتورة الضريبية مسجل لهذا المورد على سجل آخر. راجع السجل السابق قبل إضافة الضريبة.');
}
export function recordInputTax(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['invoice_id','supplier_vat_number','supplier_invoice_number','invoice_date','vat','evidence']);
  const invoice=typeof input.invoice_id==='string'&&db.prepare('SELECT * FROM procurement_invoices WHERE id=? AND tenant_id=?').get(input.invoice_id,u.tenant_id);
  if(!invoice)fail(404,'not_found','فاتورة المورد غير متاحة');
  if(db.prepare("SELECT 1 FROM procurement_invoice_tax WHERE invoice_id=? AND status<>'rejected'").get(invoice.id))fail(409,'tax_exists','سُجلت ضريبة هذه الفاتورة');
  const vatNumber=v.text(input.supplier_vat_number,'الرقم الضريبي للمورد',15,15);
  // الصيغة نفسها التي يفرضها تسجيل المورد: قيمة واحدة يقرؤها الطرفان (app/vendors.mjs).
  const rule=vatNumberRule(db,u.tenant_id);
  if(!new RegExp(rule.pattern).test(vatNumber))fail(400,'vat_number',rule.message);
  const vat=money(input.vat,'مبلغ الضريبة'),date=v.date(input.invoice_date);
  if(date>riyadhToday())fail(400,'invoice_date','تاريخ الفاتورة لا يكون مستقبليًا');
  // الضريبة جزء من إجمالي الفاتورة: لا تتجاوز النسبة/(100+النسبة) منه بعد التقريب. والنسبة **بتاريخ الفاتورة**
  // لا بتاريخ اليوم، فالفاتورة الصادرة قبل يوليو 2020 تُقاس بنسبتها هي.
  const rate=adopted(db,u.tenant_id,'finance.vat_rate',date);
  if(vat*(100+rate.value)>invoice.amount_minor*rate.value+(100+rate.value))
    fail(409,'vat_exceeds_invoice',`مبلغ الضريبة يتجاوز ${rate.value}% من صافي الفاتورة المسجلة (${rate.basis})`);
  const invoiceNumber=v.text(input.supplier_invoice_number,'رقم فاتورة المورد الضريبية',120,1);
  uniqueTaxInvoice(db,u.tenant_id,vatNumber,invoiceNumber);
  const taxId=id();
  db.prepare("INSERT INTO procurement_invoice_tax(id,tenant_id,invoice_id,supplier_vat_number,supplier_invoice_number,invoice_date,vat_minor,evidence,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)").run(taxId,u.tenant_id,invoice.id,vatNumber,invoiceNumber,date,vat,v.text(input.evidence,'مرجع الفاتورة الضريبية ومكان حفظها',3000,10),u.id,now());
  audit(db,u,'input_tax',taxId,'input_tax.recorded',{}, {invoice_id:invoice.id,vat_minor:vat});
  return {id:taxId};
}
export function decideInputTax(db,supplied,taxId,decision,input){
  writing(db);
  const u=actor(db,supplied,'approve');
  v.object(input,['note']);
  if(!['verify','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const t=typeof taxId==='string'&&db.prepare("SELECT * FROM procurement_invoice_tax WHERE id=? AND tenant_id=? AND status='pending'").get(taxId,u.tenant_id);
  if(!t)fail(404,'not_found','السجل الضريبي غير متاح للقرار');
  if(t.recorded_by===u.id)fail(403,'self_approval','من سجل الضريبة لا يتحقق منها');
  if(decision==='verify')uniqueTaxInvoice(db,u.tenant_id,t.supplier_vat_number,t.supplier_invoice_number,t.id);
  const status=decision==='verify'?'verified':'rejected';
  db.prepare('UPDATE procurement_invoice_tax SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,decision==='verify'?3:10),t.id);
  audit(db,u,'input_tax',t.id,'input_tax.'+status,{status:'pending'},{status});
  return {id:t.id,status};
}
// ضريبة المدخلات المتحقق منها بحسب تاريخ فاتورة المورد؛ يستخدمها ملخص الضريبة في القوائم.
// يعيد null ما لم يُتحقق من أي فاتورة مورد ضريبية بعد: «غير متاحة» أصدق من صفر.
export function verifiedInputVat(db,tenantId,from,to){
  if(!db.prepare("SELECT 1 FROM procurement_invoice_tax WHERE tenant_id=? AND status='verified'").get(tenantId))return null;
  return db.prepare("SELECT COALESCE(SUM(vat_minor),0) AS n FROM procurement_invoice_tax WHERE tenant_id=? AND status='verified' AND invoice_date BETWEEN ? AND ?").get(tenantId,from,to).n;
}
