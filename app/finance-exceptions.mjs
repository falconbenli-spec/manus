import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { can } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { pendingSources, controlReconciliation } from './ledger.mjs';
import { sourceKind } from './ledger-sources.mjs';
import { personName } from './people-read.mjs';
import { AUDIT_CAPABILITY } from './audit-export.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
import { invoiceState } from './procurement-guards.mjs';

// طابور الاستثناءات المالية (الحزمة 3). الاستثناء لا يُخزَّن: يُحسب من مصدره وقت القراءة، ويختفي حين يُحسم في مصدره — فلا يبقى
// في الطابور ما حُسم، ولا يغيب عنه ما لم يُحسم. سبعة أنواع:
//   فاتورة مورد موقوفة — مستحقٌ مطابق يرفض الدفتر بناء قيده (ضريبة ما سُجّلت أو ما تُحقق منها، مورد بلا ملف، مركز تكلفة مجهول)،
//     أو فاتورة مسجّلة ما تطابقت لأن فرقها ما انقرر؛ وسطر كشف بلا قرار؛ ومستند نهائي بلا قيد مرحّل؛ وفرق حساب رقابي لا يسوّيه مستند؛ وإعادة إقفال
//     فات موعدها؛ وعكسٌ ينتظر اعتماده؛ ووعد سداد فات موعده وما انوفى.
// لكل استثناء مالكٌ بتصريحه، وإقرارٌ منه سجلٌّ إلحاقي (finance_exception_acks، الترحيل 171): من رآه، ومتى، وبأي مبلغ، وما الذي
// سيفعله. الإقرار لا يحسم شيئًا؛ وتغيّر المبلغ بعده يجعله إقرارًا لرقم قديم.
//
// والصندوق («أقرّر»، app/inbox.mjs) يعدّ الاستثناء غير المُقرّ لمالكه — إلا ما قراره في الصندوق أصلًا بمصدرٍ آخر: عكسٌ ينتظر
// معتمده، وضريبةٌ تنتظر التحقق، وقيدٌ ينتظر الاعتماد أو الترحيل، وفاتورة موقوفة تنتظر قرار فرقها. تلك تُعرض هنا (inbox:false) ولا تُعدّ
// في الصندوق مرة ثانية، فلا يصير القرار الواحد بندين.
export const EXCEPTION_KINDS=Object.freeze({
  held_invoice:{name:'فاتورة مورد موقوفة',link:'#payables'},
  unmatched_bank_line:{name:'سطر كشف بلا قرار',link:'#bank-reconciliation'},
  unposted_source:{name:'مستند بلا قيد مرحّل',link:'#statements'},
  control_difference:{name:'فرق حساب رقابي',link:'#close-checklist'},
  overdue_reclose:{name:'إعادة إقفال فات موعدها',link:'#close-checklist'},
  reversal_awaiting_approval:{name:'عكس ينتظر اعتماده',link:'#receivables'},
  broken_promise:{name:'وعد سداد ما انوفى',link:'#receivables'}
});
// المالك بتصريحه: finance:<فعل> تفويض في الدفتر المالي (finance_grants)، وaccess:<تصريح> تصريح منصة (access_grants).
const OWNERS=Object.freeze({
  finance_prepare:{owner:'المالية — من يحمل تفويض إعداد القيود',owner_role:'finance',capability:{finance:'prepare'}},
  finance_approve:{owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance',capability:{finance:'approve'}},
  finance_post:{owner:'المالية — من يحمل تفويض الترحيل',owner_role:'finance',capability:{finance:'post'}},
  finance_configure:{owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance',capability:{finance:'configure'}},
  bank_reconcile:{owner:'المالية — من يحمل تصريح إعداد المطابقة البنكية',owner_role:'finance',capability:{access:'bank.reconcile'}},
  close_manage:{owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري',owner_role:'finance',capability:{access:'finance.close.manage'}},
  vendors_manage:{owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'procurement',capability:{access:'vendors.manage'}},
  procurement_match:{owner:'المشتريات — مراجع المطابقة',owner_role:'procurement',capability:{access:'procurement.use'}},
  collections:{owner:'المالية — متابعة التحصيل (من يحمل تفويض الإعداد)',owner_role:'finance',capability:{finance:'prepare'}},
  // الحزمة 4 (الترحيل 175): عكس مسير رواتب معتمد يقرره حامل اعتماد الرواتب غير طالبه.
  payroll_approve:{owner:'معتمد الرواتب — غير طالب العكس',owner_role:'payroll.approve',capability:{access:'payroll.approve'}}
});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const riyadhDate=iso=>riyadhDateOf(iso);
const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
const DENIED={document:'تفويض قراءة في الدفتر المالي',why:'الطابور يعرض مبالغ ومستندات وقيودًا من الدفتر',owner:'مسؤول التفويضات المالية',owner_role:'finance'};

function actor(db,supplied){
  const u=actorOrRefuse(db,supplied);
  u.finance=financeCapabilities(db,u);
  if(!u.finance.includes('read'))refuse(403,'finance_exceptions_denied',{what:'طابور الاستثناءات المالية لمن يقرأ الدفتر المالي',missing:[DENIED],
    next:'اطلب تفويض القراءة المالية من مسؤول التفويضات المالية'});
  return u;
}
const owns=(db,u,capability)=>capability.finance?u.finance.includes(capability.finance):can(db,u,capability.access);
const exception=(kind,key,fields,owner,inbox)=>({key,id:key,kind,kind_name:EXCEPTION_KINDS[kind].name,link:fields.link??EXCEPTION_KINDS[kind].link,
  title:fields.title,detail:fields.detail??'',amount_minor:fields.amount_minor??null,date:fields.date??null,reason:fields.reason??null,
  source_kind:fields.source_kind??null,source_id:fields.source_id??null,...OWNERS[owner],inbox});

/* ───── الحساب: كل استثناء من مصدره ───── */
// فاتورة المورد: المستحق المطابق بلا قيد يُسأل عنه قارئ الدفتر نفسه (sourceKind('supplier_invoice').build) — فما يمنع قيده هنا
// هو ما يمنعه في «القوائم المالية والترحيل» بالرفض نفسه، لا قاعدة ثانية تُكتب بجانبه.
const HELD={input_tax_pending:['finance_approve',false],input_tax_missing:['finance_prepare',true],supplier_unregistered:['vendors_manage',true],
  cost_centre_unresolved:['finance_configure',true],input_tax_exceeds_invoice:['finance_approve',true]};
const varianceText=x=>[x.price_variance_minor?`فرق سعر ${x.price_variance_minor>0?'+':''}${decimal(x.price_variance_minor)}`:'',
  x.quantity_variance?`فرق كمية ${x.quantity_variance}`:''].filter(Boolean).join(' · ');
function heldInvoices(db,u,unjournalled){
  const out=[],held=new Set(),def=sourceKind('supplier_invoice');
  for(const s of unjournalled.filter(x=>x.source_kind==='supplier_invoice'&&x.journal_status===null)){
    let refusal=null;
    try{def.build(db,u,s.source_id);}catch(error){if(!error.status||error.status>=500)throw error;refusal=error;}
    if(!refusal)continue;
    const [owner,inbox]=HELD[refusal.code]??['finance_prepare',true];
    held.add(s.source_id);
    out.push(exception('held_invoice',`held_invoice:${s.source_id}`,{title:`فاتورة المورد ${s.reference}`,detail:refusal.details?.refusal?.what??refusal.message,
      amount_minor:s.amount_minor,date:s.date,reason:refusal.code,source_kind:'supplier_invoice',source_id:s.source_id},owner,inbox));
  }
  // فاتورة ما تطابقت: الموقوفة وحدها استثناء — حالتها من invoiceState كما تقرؤها المشتريات نفسها (الترحيل 169)، وقرار فرقها في
  // صندوق المشتريات أصلًا، فتُعرض هنا ولا تُعدّ مرة ثانية. والمرفوضة والملغاة ما هي التزام، واللي تنتظر البضاعة أو جاهزة للمطابقة
  // في مجراها العادي، فلا شي منها موقوف.
  for(const i of db.prepare(`SELECT i.* FROM procurement_invoices i WHERE i.tenant_id=?
      AND NOT EXISTS(SELECT 1 FROM procurement_payables y WHERE y.invoice_id=i.id) ORDER BY i.created_at,i.id`).all(u.tenant_id)){
    const state=invoiceState(db,i);
    if(state.state!=='held')continue;
    out.push(exception('held_invoice',`held_invoice:unmatched:${i.id}`,{title:`فاتورة المورد ${i.supplier_reference}`,detail:`موقوفة بفرق ما انقرر: ${varianceText(state.variance)}`,
      amount_minor:i.amount_minor,date:riyadhDate(i.created_at),reason:'variance_undecided',source_kind:'procurement_invoice',source_id:i.id,link:'#procurement'},'procurement_match',false));
  }
  return {out,held};
}
function unmatchedLines(db,tenantId){
  return db.prepare(`SELECT t.id,t.txn_date,t.reference,t.description,t.debit_minor,t.credit_minor,a.label FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id
      JOIN bank_accounts a ON a.id=t.bank_account_id WHERE t.tenant_id=? AND i.status='active'
      AND NOT EXISTS(SELECT 1 FROM bank_match_items b WHERE b.transaction_id=t.id AND b.side='line' AND b.live=1) ORDER BY t.txn_date,t.line_no`).all(tenantId)
    .map(t=>exception('unmatched_bank_line',`unmatched_bank_line:${t.id}`,{title:`${t.description} — ${t.label}`,detail:`${t.credit_minor>0?'داخل':'خارج'}${t.reference?` · مرجع ${t.reference}`:''} · ما طابقه أحد بسجل ولا صنّفه`,
      amount_minor:t.debit_minor+t.credit_minor,date:t.txn_date,reason:t.credit_minor>0?'in':'out',source_kind:'bank_line',source_id:t.id},'bank_reconcile',true));
}
// حالة قيد المستند: بلا قيد ومسودة ومرفوض ومعكوس ما ينتظر قرار أحد في الصندوق، فهي لمعدّ القيود؛ والمعلّق والمعتمد قرارٌ في صندوق
// المعتمد والمرحّل أصلًا.
const UNPOSTED={null:['no_journal','finance_prepare',true,'ما له قيد'],draft:['journal_draft','finance_prepare',true,'قيده مسودة ما انقدمت'],
  rejected:['journal_rejected','finance_prepare',true,'قيده مرفوض'],reversed:['journal_reversed','finance_prepare',true,'قيده منعكس'],
  pending:['journal_pending','finance_approve',false,'قيده ينتظر الاعتماد'],approved:['journal_approved','finance_post',false,'قيده معتمد ينتظر الترحيل']};
function unpostedSources(unjournalled,held){
  return unjournalled.filter(s=>!(s.source_kind==='supplier_invoice'&&held.has(s.source_id))).map(s=>{
    const [reason,owner,inbox,phrase]=UNPOSTED[s.journal_status??'null']??UNPOSTED.null;
    return exception('unposted_source',`unposted_source:${s.source_kind}:${s.source_id}`,{title:`${s.source_name} ${s.reference}`,detail:phrase,amount_minor:s.amount_minor,date:s.date,
      reason,source_kind:s.source_kind,source_id:s.source_id},owner,inbox);
  });
}
// فروق الحساب الرقابي: ما يسبّبه مستند بلا قيد أو قيد ما ترحّل استثناءٌ واحد (مستند بلا قيد مرحّل)، فلا يُكرر هنا. الباقي فرقٌ
// لا يسوّيه مستند: قيد على الحساب بلا مستند، ومبلغ قيد غير مبلغ مستنده، وقيد منعكس بلا قيد بعده، وتواريخ تفترق.
function controlDifferences(db,tenantId,date){
  const out=[];
  for(const c of controlReconciliation(db,tenantId,date).controls){
    if(!c.mapped){
      if(c.documents)out.push(exception('control_difference',`control_difference:${c.key}:unmapped`,{title:`${c.name}: ما له حساب مربوط في الدفتر`,detail:`${c.documents} مستند على غرض بلا ربط معتمد`,
        amount_minor:c.subledger_minor,date,reason:'unmapped'},'finance_configure',true));
      continue;
    }
    for(const i of c.items){
      if(['no_journal','journal_not_posted'].includes(i.reason))continue;
      out.push(exception('control_difference',`control_difference:${c.key}:${i.reason}:${i.source_kind}:${i.source_id??i.journal_id}`,{title:`${c.name}: ${i.reason_name}`,
        detail:`${i.source_name} ${i.reference??''} · فرق ${decimal(i.difference_minor)}`.trim(),amount_minor:i.difference_minor,date:i.date,reason:i.reason,
        source_kind:i.source_kind,source_id:i.source_id??i.journal_id},'close_manage',true));
    }
  }
  return out;
}
function overdueRecloses(db,tenantId,date){
  return db.prepare(`SELECT r.id,r.reclose_due_on,p.name FROM finance_period_reopenings r JOIN finance_periods p ON p.id=r.period_id
      WHERE r.tenant_id=? AND r.status='approved' AND r.reclosed_at IS NULL AND r.reclose_due_on<? ORDER BY r.reclose_due_on`).all(tenantId,date)
    .map(r=>exception('overdue_reclose',`overdue_reclose:${r.id}`,{title:`إعادة إقفال «${r.name}»`,detail:`موعدها ${r.reclose_due_on} والدفتر منفتح للحين`,date:r.reclose_due_on,reason:'overdue',
      source_kind:'finance_period_reopening',source_id:r.id},'close_manage',true));
}
// العكس الذي ينتظر اعتماده: قراره في صندوق معتمده أصلًا (approve_reversal وapprove_account_reversal وapprove_adjustment واعتماد القيد
// وdecide_void). وطلب إلغاء فاتورة المورد أو مستحقها (الترحيل 169) عكسٌ: مستحقه يقرره معتمد مالي، والفاتورة بلا مستحق يقررها مراجع.
function pendingReversals(db,tenantId){
  const row=(key,title,detail,amount,date,kind,id,owner='finance_approve',link='#receivables')=>exception('reversal_awaiting_approval',key,{title,detail,amount_minor:amount,date,reason:kind,source_kind:kind,source_id:id,link},owner,false);
  return [
    ...db.prepare("SELECT a.id,a.kind,a.amount_minor,a.created_at,r.reference FROM ar_adjustments a JOIN ar_claims c ON c.id=a.claim_id LEFT JOIN ar_receipts r ON r.id=a.receipt_id WHERE c.tenant_id=? AND a.status='pending' ORDER BY a.created_at,a.rowid").all(tenantId)
      .map(a=>row(`reversal_awaiting_approval:ar_adjustment:${a.id}`,a.kind==='receipt_reversal'?`عكس القبض ${a.reference}`:'إلغاء استحقاق','ينتظر قرار شخص ثالث',Number(a.amount_minor)||null,riyadhDate(a.created_at),'ar_adjustment',a.id)),
    ...db.prepare("SELECT v.id,v.amount_minor,v.created_at,x.reference FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE v.tenant_id=? AND v.status='pending' ORDER BY v.created_at,v.rowid").all(tenantId)
      .map(v=>row(`reversal_awaiting_approval:ar_account_reversal:${v.id}`,`عكس القبض على الحساب ${v.reference}`,'ينتظر قرار شخص ثالث',Number(v.amount_minor),riyadhDate(v.created_at),'ar_account_reversal',v.id)),
    ...db.prepare("SELECT a.id,a.kind,a.amount_minor,a.reference,a.created_at FROM payable_adjustments a WHERE a.tenant_id=? AND a.status='pending' ORDER BY a.created_at,a.rowid").all(tenantId)
      .map(a=>row(`reversal_awaiting_approval:payable_adjustment:${a.id}`,`${a.kind==='credit'?'إشعار دائن':'إشعار مدين'} من مورد ${a.reference}`,'ينتظر قرار زميل ثانٍ',a.amount_minor,riyadhDate(a.created_at),'payable_adjustment',a.id,'finance_approve','#payables')),
    ...db.prepare("SELECT j.id,j.status,j.source_reference,j.entry_date FROM finance_reversals x JOIN finance_journals j ON j.id=x.reversal_journal_id WHERE j.tenant_id=? AND j.status IN ('draft','pending','approved') ORDER BY j.created_at,j.id").all(tenantId)
      .map(j=>row(`reversal_awaiting_approval:journal:${j.id}`,`قيد عكس ${j.source_reference}`,j.status==='approved'?'معتمد ينتظر الترحيل':j.status==='pending'?'ينتظر الاعتماد':'مسودة ما انقدمت',null,j.entry_date,'journal_reversal',j.id,
        j.status==='approved'?'finance_post':j.status==='draft'?'finance_prepare':'finance_approve','#finance')),
    // عكس مسير رواتب معتمد ينتظر معتمده (الترحيل 175): قراره في صندوق معتمد الرواتب أصلًا، ويُرى هنا لأنه سيعكس قيدًا في الدفتر.
    ...db.prepare("SELECT id,month,net_minor,requested_at FROM payroll_run_reversals WHERE tenant_id=? AND status='requested' ORDER BY requested_at,rowid").all(tenantId)
      .map(x=>row(`reversal_awaiting_approval:payroll_run_reversal:${x.id}`,`عكس مسير رواتب ${x.month}`,'ينتظر قرار معتمد رواتب غير طالبه',x.net_minor,riyadhDate(x.requested_at),'payroll_run_reversal',x.id,'payroll_approve','#payroll')),
    ...db.prepare(`SELECT v.id,v.payable_id,v.created_at,i.supplier_reference,COALESCE(b.adjusted_minor,i.amount_minor) AS amount_minor FROM procurement_voids v
        JOIN procurement_invoices i ON i.id=v.invoice_id LEFT JOIN payable_balances b ON b.payable_id=v.payable_id
        WHERE v.tenant_id=? AND NOT EXISTS(SELECT 1 FROM procurement_void_decisions d WHERE d.void_id=v.id) ORDER BY v.created_at,v.rowid`).all(tenantId)
      .map(v=>row(`reversal_awaiting_approval:procurement_void:${v.id}`,`طلب إلغاء ${v.payable_id?'مستحق':'فاتورة'} المورد ${v.supplier_reference}`,'ينتظر قرار معتمد مستقل',
        v.amount_minor,riyadhDate(v.created_at),'procurement_void',v.id,v.payable_id?'finance_approve':'procurement_match','#procurement'))
  ];
}
// الوعد يُقرأ من المال نفسه كما يقرؤه app/receivables.mjs: ما وصل بين يوم الوعد وموعده (قبض مؤكد غير مرتد بتاريخه في البنك، وتخصيص
// حي بيومه). والوعد على استحقاق ما عاد عليه شيء ليس استثناءً.
function brokenPromises(db,tenantId,date){
  const out=[];
  for(const p of db.prepare(`SELECT p.*,k.name AS case_name FROM ar_promises p JOIN ar_claims c ON c.id=p.claim_id JOIN commercial_cases k ON k.id=c.case_id
      JOIN ar_claim_collection s ON s.claim_id=c.id WHERE c.tenant_id=? AND c.status='approved' AND p.promised_on<? AND s.net_minor-s.received_minor-s.allocated_minor>0 ORDER BY p.promised_on,p.id`).all(tenantId,date)){
    const from=riyadhDate(p.created_at),to=p.promised_on;
    const received=db.prepare(`SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) AS n FROM ar_receipts r WHERE r.claim_id=? AND r.status='confirmed' AND r.received_on BETWEEN ? AND ?
      AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.receipt_id=r.id AND a.kind='receipt_reversal' AND a.status='approved')`).get(p.claim_id,from,to).n;
    const allocated=db.prepare("SELECT y.amount_minor,y.created_at FROM ar_allocations y WHERE y.claim_id=? AND y.kind='allocation' AND NOT EXISTS(SELECT 1 FROM ar_allocations z WHERE z.reverses_id=y.id)").all(p.claim_id)
      .filter(y=>{const day=riyadhDate(y.created_at);return day>=from&&day<=to;}).reduce((n,y)=>n+Number(y.amount_minor),0);
    const short=Number(p.amount_minor)-received-allocated;
    if(short<=0)continue;
    out.push(exception('broken_promise',`broken_promise:${p.id}`,{title:`وعد ${p.case_name} بتاريخ ${p.promised_on}`,detail:`وعد به ${p.contact}، ووصل منه ${decimal(received+allocated)} من ${decimal(Number(p.amount_minor))}`,
      amount_minor:short,date:p.promised_on,reason:'broken',source_kind:'ar_promise',source_id:p.id},'collections',true));
  }
  return out;
}
export function financeExceptions(db,u,date=today()){
  const unjournalled=pendingSources(db,u).filter(s=>s.journal_status!=='posted');
  const {out:held,held:heldIds}=heldInvoices(db,u,unjournalled);
  return [...held,...unmatchedLines(db,u.tenant_id),...unpostedSources(unjournalled,heldIds),...controlDifferences(db,u.tenant_id,date),
    ...overdueRecloses(db,u.tenant_id,date),...pendingReversals(db,u.tenant_id),...brokenPromises(db,u.tenant_id,date)];
}

/* ───── الإقرار ───── */
const latestAck=(db,tenantId,key)=>db.prepare('SELECT * FROM finance_exception_acks WHERE tenant_id=? AND exception_key=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(tenantId,key)??null;
const ackView=(db,a,current)=>a&&{id:a.id,exception_key:a.exception_key,kind:a.kind,amount_minor:a.amount_minor,note:a.note,acknowledged_by:a.acknowledged_by,
  acknowledged_by_name:personName(db,a.acknowledged_by),created_at:a.created_at,current};
function view(db,u,x){
  const ack=latestAck(db,u.tenant_id,x.key),current=!!ack&&ack.amount_minor===x.amount_minor,mine=owns(db,u,x.capability);
  return {...x,acknowledgement:ackView(db,ack,current),can_acknowledge:mine,actions:mine&&!current?['acknowledge_exception']:[]};
}
export function exceptionsBoard(db,supplied){
  const u=actor(db,supplied),date=today();
  const exceptions=financeExceptions(db,u,date).map(x=>view(db,u,x));
  const counts=Object.fromEntries(Object.keys(EXCEPTION_KINDS).map(kind=>[kind,exceptions.filter(x=>x.kind===kind).length]));
  // حزمة تدقيق الفترة تُنزَّل من هنا لمن يقرأ المالية ويحمل تصريحها معًا (الشرطان نفسهما في app/audit-export.mjs)؛ غيره ما يرى
  // الرابط، فلا يُعرض عليه ما يرفضه المسار. الفترات هي فترات الدفتر المحاسبية التي بدأت، الأحدث أولًا.
  const audit_export=can(db,u,AUDIT_CAPABILITY)?{allowed:true,periods:db.prepare('SELECT id,name,starts_on,ends_on,status FROM finance_periods WHERE tenant_id=? AND starts_on<=? ORDER BY starts_on DESC LIMIT 12').all(u.tenant_id,date)
    .map(p=>({...p,href:`/api/audit-export?from=${p.starts_on}&to=${p.ends_on}`}))}:{allowed:false};
  return {today:date,user_id:u.id,kinds:EXCEPTION_KINDS,exceptions,counts,audit_export,
    open_for_me:exceptions.filter(x=>x.actions.length).length,
    note:'كل استثناء محسوب من مصدره الآن، ويختفي حين يُحسم هناك. الإقرار يقول إن مالكه رآه وما الذي سيفعله، ولا يحسم شيئًا؛ وإذا تغيّر المبلغ بعده يعود ينتظر إقرارًا جديدًا. '+
      'ما قراره في «أقرّر» أصلًا (عكس ينتظر معتمده، ضريبة تنتظر التحقق، قيد ينتظر الاعتماد أو الترحيل، فاتورة تنتظر المطابقة) يُعرض هنا ولا يُعدّ في الصندوق مرة ثانية.'};
}
export function acknowledgeException(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','إقرار الاستثناء المالي يحتاج معاملة قاعدة بيانات');
  const u=actor(db,supplied);
  v.object(input,['key','note']);
  const note=v.text(input.note,'ما رأيته وما ستفعله ومتى',2000,10);
  const x=typeof input.key==='string'?financeExceptions(db,u).find(e=>e.key===input.key):null;
  if(!x)refuse(404,'exception_not_found',{what:'ما لقينا هالاستثناء في طابورك الآن: يمكن انحسم في مصدره أو المفتاح غير صحيح',next:'حدّث الطابور واختر الاستثناء من القائمة'});
  if(!owns(db,u,x.capability))refuse(403,'exception_not_owner',{what:`«${x.kind_name}: ${x.title}» ما هو عليك`,
    missing:[{document:`إقرار ${x.owner}`,why:'الإقرار يسجّل أن مالك الاستثناء رآه وعنده خطته، فيقرّ به من يملك حسمه',owner:x.owner,owner_role:x.owner_role}],
    next:'اتركه لمالكه؛ يظهر في صندوقه'});
  const last=latestAck(db,u.tenant_id,x.key);
  if(last&&last.amount_minor===x.amount_minor)refuse(409,'exception_acknowledged',{what:`الاستثناء مُقرٌّ به بمبلغه نفسه من ${personName(db,last.acknowledged_by)??'زميل'} في ${riyadhDate(last.created_at)}`,
    next:'يبقى الإقرار كما هو حتى يُحسم الاستثناء في مصدره؛ لو تغيّر مبلغه يُطلب إقرار جديد'});
  const id=randomUUID(),time=now();
  db.prepare('INSERT INTO finance_exception_acks(id,tenant_id,exception_key,kind,amount_minor,note,acknowledged_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,u.tenant_id,x.key,x.kind,x.amount_minor,note,u.id,time);
  audit(db,u,'finance_exception',id,'finance_exception.acknowledged',{},{exception_key:x.key,kind:x.kind,amount_minor:x.amount_minor,reason:x.reason},note);
  return ackView(db,db.prepare('SELECT * FROM finance_exception_acks WHERE id=?').get(id),true);
}
export function getAcknowledgement(db,supplied,id){
  const u=actor(db,supplied),a=typeof id==='string'?db.prepare('SELECT * FROM finance_exception_acks WHERE id=? AND tenant_id=?').get(id,u.tenant_id):null;
  if(!a)refuse(404,'acknowledgement_not_found',{what:'ما لقينا هالإقرار في كيانك',next:'افتح الطابور واختر الاستثناء'});
  return ackView(db,a,true);
}
