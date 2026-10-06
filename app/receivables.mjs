import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { financeCapabilities } from './finance.mjs';
import * as v from './validation.mjs';
import { refuse } from './refusal.mjs';
import { assertFinanciallyOpen } from './project-closure-guard.mjs';
import { personName } from './people-read.mjs';
import { registerSourceKind, registerSourceLink } from './ledger-sources.mjs';
import { REQUEST_STATUS_AR } from './static/vocabulary.mjs';
// الحزمة 4 (P4-CRM-7، الترحيل 186): لا استحقاق جديد على صفقة عميل مقفل — نداء واحد مسمّى في createClaim.
import { assertDealClientOpen } from './client-offboarding.mjs';
import { refuseTerminated } from './proposal-of-record.mjs';
import { entitlementGate, gateSnapshot, writeTermLink, termLabelForLine, advanceSources } from './entitlement-gates.mjs';

// مستحقات العملاء: الاستحقاق من مخرج مقبول، والقبض عليه بمطابقة مستقلة، ثم التسوية (الحزمة 3، الترحيل 170):
// ارتداد القبض بسجل جديد يعتمده ثالث، وإلغاء الاستحقاق باعتماد مستقل، والنزاع والوعد بالسداد، والقبض على حساب العميل
// وتخصيصه على استحقاقاته بشخص غير مسجّله. لا شيء يُعدَّل بعد وقوعه: كل تصحيح سجلٌ جديد يشير إلى ما يصححه.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const riyadhDate=iso=>new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10);
const FINANCE={owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'};
const APPROVER={owner:'المالية — حامل تفويض الاعتماد المالي غير اللي سجّل وطابق',owner_role:'finance'};
function actor(db,supplied,action='read'){
  const u=supplied&&db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u||!financeCapabilities(db,u).includes(action))fail(403,'receivable_access_denied','لا يوجد تفويض مالي صالح لهذا الإجراء');
  return u;
}
function writing(db,what){if(!db.isTransaction)fail(500,'transaction_required',`${what} يحتاج معاملة قاعدة بيانات`);}
function money(value){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money','أدخل مبلغًا موجبًا بخانتين عشريتين كحد أقصى');
  const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(minor<=0n||minor>999999999999n)refuse(400,'invalid_money',{what:`المبلغ ${value} برا الحد`,next:'اكتب مبلغًا أكبر من صفر وأقل من عشرة مليارات، بخانتين عشريتين على الأكثر'});
  return String(minor);
}
function claim(db,u,id){
  const row=typeof id==='string'&&db.prepare('SELECT * FROM ar_claims WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!row)refuse(404,'not_found',{what:'ما لقينا هالاستحقاق في كيانك',next:'حدّث الصفحة وافتح الاستحقاق من قائمة المستحقات'});
  return row;
}
// الإشعار الدائن الصادر يخفض ما على العميل ولا يمس ar_claims (app/invoices.mjs لا يكتب في هذا الجدول أصلًا).
// فسقف القبض كان قيمة الاستحقاق وحدها: استحقاق 1000 صدر عليه إشعار دائن بـ400 كان يقبل قبضًا بـ1000 كاملة،
// فتصير ذمة العميل سالبة 400 بلا تنبيه ويقول عمر الذمة «مسدد داخليًا». الصافي هو السقف والرصيد والعمر.
// و«الصادرة» وحدها تخفض: مسودة الإشعار أو المعلق منه قد يُرفض، والعميل لم يُبلَّغ به بعد.
function credited(db,claimId){
  return BigInt(db.prepare("SELECT COALESCE(SUM(total_minor),0) AS n FROM tax_invoices WHERE claim_id=? AND kind='credit_note' AND status='issued'").get(claimId).n);
}
const decimal=minor=>`${minor/100n}.${String(minor%100n).padStart(2,'0')}`;
const show=minor=>decimal(BigInt(minor));
// أرقام الاستحقاق من منظور واحد (ar_claim_collection، الترحيل 170) تقرؤه قيود القاعدة وقائمة إقفال المشروع بالتعريف نفسه:
// الصافي بعد الإشعارات الدائنة الصادرة، والمقبوض المؤكد غير المرتد، والمعلق، والمخصص من القبض على الحساب ناقص ما عُكس منه.
function figures(db,c){
  const s=db.prepare('SELECT net_minor,received_minor,pending_minor,allocated_minor FROM ar_claim_collection WHERE claim_id=?').get(c.id);
  const collected=s.received_minor+s.allocated_minor;
  return {net:s.net_minor,received:s.received_minor,pending:s.pending_minor,allocated:s.allocated_minor,collected,committed:collected+s.pending_minor,balance:Math.max(0,s.net_minor-collected)};
}
function history(db,u,c,action){
  const snapshot=JSON.stringify({status:c.status,amount_minor:c.amount_minor,due_date:c.due_date,revision:c.revision});
  db.prepare('INSERT INTO ar_history VALUES(?,?,?,?,?,?)').run(c.id,c.version,action,u.id,snapshot,now());
  audit(db,u,'receivable',c.id,action,{},JSON.parse(snapshot));
}
// مرجع التحويل الواحد لا يُسجَّل مرتين في الكيان: لا على استحقاقين، ولا على استحقاق وعلى الحساب معًا (ar_receipt_reference_once).
const referenceUsed=(db,tenantId,reference)=>!!db.prepare('SELECT 1 FROM ar_receipts WHERE tenant_id=? AND reference=? UNION ALL SELECT 1 FROM ar_account_receipts WHERE tenant_id=? AND reference=?').get(tenantId,reference,tenantId,reference);
const duplicateReference=reference=>refuse(409,'duplicate_receipt_reference',{what:`المرجع ${reference} مسجّل من قبل في كيانك`,
  next:'التحويل الواحد يُسجَّل مرة: إذا غطّى أكثر من استحقاق فسجّله «قبض على الحساب» وخصّصه عليها'});

/* ───── العرض ───── */
const RECEIPT_STATE={pending:'بانتظار المطابقة',confirmed:'مؤكد',rejected:'مرفوض',reversed:'مرتد'};
const KIND_NAMES={receipt_reversal:'عكس قبض',claim_cancel:'إلغاء استحقاق'};
const PROMISE_STATE={open:'بانتظار موعده',kept:'انوفى',broken:'ما انوفى'};
const DISPUTE_STATE={open:'مفتوح',resolved:'انحسم'};
const adjustmentView=(db,a)=>({id:a.id,claim_id:a.claim_id,kind:a.kind,kind_name:KIND_NAMES[a.kind],receipt_id:a.receipt_id,amount_minor:a.amount_minor,reason:a.reason,evidence:a.evidence,
  effective_on:a.effective_on,status:a.status,status_name:REQUEST_STATUS_AR[a.status]??a.status,requested_by:a.requested_by,requested_by_name:personName(db,a.requested_by),created_at:a.created_at,
  decided_by:a.decided_by,decided_by_name:personName(db,a.decided_by),decision_note:a.decision_note,decided_at:a.decided_at});
const disputeView=(db,d)=>{const state=d.resolved_at?'resolved':'open';
  return {...d,state,state_name:DISPUTE_STATE[state],opened_by_name:personName(db,d.opened_by),resolved_by_name:personName(db,d.resolved_by)};};
// الوعد يُقرأ من المال نفسه: ما وصل بين يوم الوعد وموعده (قبض مؤكد غير مرتد بتاريخه في البنك، وتخصيص حي بيومه) يوفيه.
// فالقبض المرتد يُسقط الوفاء، والقبض الذي يتأكد متأخرًا بتاريخ داخل المدة يوفيه — تاريخ البنك لا تاريخ المطابقة.
function promiseView(db,p,todayDate){
  const from=riyadhDate(p.created_at),to=p.promised_on;
  const received=db.prepare(`SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) AS n FROM ar_receipts r WHERE r.claim_id=? AND r.status='confirmed' AND r.received_on BETWEEN ? AND ?
    AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.receipt_id=r.id AND a.kind='receipt_reversal' AND a.status='approved')`).get(p.claim_id,from,to).n;
  const allocated=db.prepare("SELECT y.amount_minor,y.created_at FROM ar_allocations y WHERE y.claim_id=? AND y.kind='allocation' AND NOT EXISTS(SELECT 1 FROM ar_allocations z WHERE z.reverses_id=y.id)").all(p.claim_id)
    .filter(y=>{const day=riyadhDate(y.created_at);return day>=from&&day<=to;}).reduce((n,y)=>n+Number(y.amount_minor),0);
  const collected=received+allocated,state=collected>=Number(p.amount_minor)?'kept':todayDate>p.promised_on?'broken':'open';
  return {...p,state,state_name:PROMISE_STATE[state],collected_minor:String(collected),recorded_by_name:personName(db,p.recorded_by)};
}
function receiptsOf(db,claimId){
  return db.prepare('SELECT * FROM ar_receipts WHERE claim_id=? ORDER BY created_at,id').all(claimId).map(r=>{
    const latest=db.prepare("SELECT * FROM ar_adjustments WHERE receipt_id=? AND kind='receipt_reversal' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(r.id)??null;
    const reversed=!!db.prepare("SELECT 1 FROM ar_adjustments WHERE receipt_id=? AND kind='receipt_reversal' AND status='approved'").get(r.id);
    const effective=reversed?'reversed':r.status;
    return {...r,effective_status:effective,status_name:RECEIPT_STATE[effective],confirmed_by:db.prepare('SELECT actor_id FROM ar_receipt_decisions WHERE receipt_id=?').get(r.id)?.actor_id??null,
      recorded_by_name:personName(db,r.recorded_by),reversal:latest&&adjustmentView(db,latest)};
  });
}
const allocationRows=(db,column,id)=>db.prepare(`SELECT y.*,x.reference AS account_reference,c.source_snapshot FROM ar_allocations y JOIN ar_account_receipts x ON x.id=y.account_receipt_id JOIN ar_claims c ON c.id=y.claim_id WHERE y.${column}=? ORDER BY y.created_at,y.rowid`).all(id);
function allocationView(db,y){
  const undone=y.kind==='allocation'?db.prepare('SELECT id FROM ar_allocations WHERE reverses_id=?').get(y.id)??null:null;
  return {id:y.id,account_receipt_id:y.account_receipt_id,account_reference:y.account_reference,claim_id:y.claim_id,line_description:JSON.parse(y.source_snapshot).line_description,
    kind:y.kind,kind_name:y.kind==='allocation'?'تخصيص':'عكس تخصيص',reverses_id:y.reverses_id,amount_minor:y.amount_minor,note:y.note,
    allocated_by:y.allocated_by,allocated_by_name:personName(db,y.allocated_by),created_at:y.created_at,reversed:!!undone,reversal_id:undone?.id??null};
}
// المتابعة: النزاع المفتوح يوقفها، والوعد القائم يمسكها لين موعده، والمتأخر بلا هذا وذاك يُتابَع الحين.
// المنصة ما ترسل للعميل شيئًا: «المتابعة» حالةٌ تقرؤها الشاشة والرئيسية («مستحقات متأخرة» تقرأ عمر الذمة، والمتنازع عليه خارجه).
function followUp(c,{balance,disputed,promises,todayDate}){
  if(c.status!=='approved'||balance<=0)return {state:'none',name:'ما فيه متابعة'};
  if(disputed)return {state:'paused',name:'المتابعة موقوفة: فيه نزاع مفتوح'};
  const waiting=promises.find(p=>p.state==='open');
  if(waiting)return {state:'awaiting_promise',name:`بانتظار وعد السداد بتاريخ ${waiting.promised_on}`};
  return c.due_date<todayDate?{state:'due',name:'متأخر: تابع العميل'}:{state:'not_due',name:'ما حلّ موعده'};
}
// من يقرر في عكس القبض: غير طالبه، وغير من سجّل القبض، وغير من طابقه.
const reversalDecider=(u,r)=>r.reversal.requested_by!==u.id&&r.recorded_by!==u.id&&r.confirmed_by!==u.id;
function actions(db,u,c,{fig,receipts,adjustments,disputes}){
  const caps=financeCapabilities(db,u),out=[];
  if(caps.includes('prepare')&&c.prepared_by===u.id&&c.status==='draft')out.push('submit');
  if(caps.includes('approve')&&c.prepared_by!==u.id&&c.status==='pending')out.push('approve','return','reject');
  if(caps.includes('prepare')&&c.status==='approved'&&fig.committed<fig.net&&c.basis!=='advance')out.push('record_receipt');
  if(caps.includes('approve')&&receipts.some(r=>r.status==='pending'&&r.recorded_by!==u.id))out.push('confirm_receipt','reject_receipt');
  const cancel=adjustments.find(a=>a.kind==='claim_cancel'&&a.status==='pending');
  if(caps.includes('prepare')&&['draft','approved'].includes(c.status)&&!cancel)out.push('request_cancel');
  if(caps.includes('approve')&&cancel&&cancel.requested_by!==u.id)out.push('approve_cancel','reject_cancel');
  if(caps.includes('prepare')&&c.status==='approved'&&receipts.some(r=>r.effective_status==='confirmed'&&r.reversal?.status!=='pending'))out.push('request_reversal');
  if(caps.includes('approve')&&receipts.some(r=>r.reversal?.status==='pending'&&reversalDecider(u,r)))out.push('approve_reversal','reject_reversal');
  const open=disputes.find(d=>d.state==='open');
  if(caps.includes('prepare')&&c.status==='approved'&&fig.balance>0&&!open)out.push('open_dispute');
  if(caps.includes('approve')&&open&&open.opened_by!==u.id)out.push('resolve_dispute');
  if(caps.includes('prepare')&&c.status==='approved'&&fig.balance>0)out.push('record_promise');
  return out;
}
function view(db,u,c){
  const todayDate=today(),receipts=receiptsOf(db,c.id),fig=figures(db,c),reduced=credited(db,c.id);
  const adjustments=db.prepare('SELECT * FROM ar_adjustments WHERE claim_id=? ORDER BY created_at,rowid').all(c.id).map(a=>adjustmentView(db,a));
  const disputes=db.prepare('SELECT * FROM ar_disputes WHERE claim_id=? ORDER BY resolved_at IS NOT NULL,opened_at DESC,rowid DESC').all(c.id).map(d=>disputeView(db,d));
  const promises=db.prepare('SELECT * FROM ar_promises WHERE claim_id=? ORDER BY promised_on,created_at').all(c.id).map(p=>promiseView(db,p,todayDate));
  const disputed=disputes.some(d=>d.state==='open'),collectable=fig.net,confirmed=fig.collected;
  return {...c,source_snapshot:JSON.parse(c.source_snapshot),receipts,adjustments,disputes,promises,allocations:allocationRows(db,'claim_id',c.id).map(y=>allocationView(db,y)),
    actions:actions(db,u,c,{fig,receipts,adjustments,disputes}),
    // confirmed_minor: المحصَّل فعلًا — المؤكد غير المرتد من القبض المباشر مع المخصص الحي من القبض على الحساب.
    confirmed_minor:String(confirmed),received_minor:String(fig.received),allocated_minor:String(fig.allocated),pending_minor:String(fig.pending),
    credited_minor:String(reduced),net_amount_minor:String(collectable),balance_minor:String(fig.balance),credit_balance_minor:String(Math.max(0,confirmed-collectable)),disputed,
    follow_up:followUp(c,{balance:fig.balance,disputed,promises,todayDate}),
    aging_bucket:c.status!=='approved'?({draft:'غير مقدم',pending:'قيد الاعتماد',rejected:'مرفوض',cancelled:'ملغى'}[c.status]??'غير محدد')
      :reduced>0n&&collectable===0?'ملغى بإشعار دائن'
      :collectable>confirmed?(disputed?'متنازع عليه':c.due_date<todayDate?'متأخر':'غير مستحق'):'مسدد داخليًا'};
}

/* ───── القبض على الحساب: العرض ───── */
function accountRow(db,u,id){
  const row=typeof id==='string'&&db.prepare('SELECT x.*,k.name AS case_name FROM ar_account_receipts x JOIN commercial_cases k ON k.id=x.case_id WHERE x.id=? AND x.tenant_id=?').get(id,u.tenant_id);
  if(!row)refuse(404,'account_receipt_not_found',{what:'ما لقينا هالقبض على الحساب في كيانك',next:'حدّث الصفحة وافتحه من «قبض على حساب العملاء»'});
  return row;
}
function accountState(db,x){
  const rows=db.prepare('SELECT id,kind,reverses_id,amount_minor FROM ar_allocations WHERE account_receipt_id=?').all(x.id);
  const live=rows.filter(y=>y.kind==='allocation'&&!rows.some(z=>z.reverses_id===y.id));
  const reversals=db.prepare('SELECT * FROM ar_account_reversals WHERE account_receipt_id=? ORDER BY created_at,rowid').all(x.id);
  return {live,allocated:live.reduce((n,y)=>n+Number(y.amount_minor),0),reversals,reversed:reversals.some(r=>r.status==='approved'),pendingReversal:reversals.find(r=>r.status==='pending')??null};
}
// الاستحقاقات التي يُخصَّص عليها: للعميل نفسه، معتمدة، بعملة القبض، ولها باقٍ بعد المقبوض والمعلق والمخصص.
function eligibleClaims(db,x){
  return db.prepare(`SELECT c.id,c.due_date,c.source_snapshot,s.net_minor-s.received_minor-s.pending_minor-s.allocated_minor AS room FROM ar_claims c JOIN ar_claim_collection s ON s.claim_id=c.id
    WHERE c.tenant_id=? AND c.case_id=? AND c.status='approved' AND c.basis<>'advance' AND c.currency=? ORDER BY c.due_date,c.created_at,c.id`).all(x.tenant_id,x.case_id,x.currency)
    .filter(c=>c.room>0).map(c=>({id:c.id,due_date:c.due_date,line_description:JSON.parse(c.source_snapshot).line_description,room_minor:String(c.room)}));
}
const accountReversalView=(db,r)=>({id:r.id,account_receipt_id:r.account_receipt_id,amount_minor:r.amount_minor,effective_on:r.effective_on,reason:r.reason,evidence:r.evidence,
  status:r.status,status_name:REQUEST_STATUS_AR[r.status]??r.status,requested_by:r.requested_by,requested_by_name:personName(db,r.requested_by),created_at:r.created_at,
  decided_by:r.decided_by,decided_by_name:personName(db,r.decided_by),decision_note:r.decision_note,decided_at:r.decided_at});
function accountView(db,u,x,caps=financeCapabilities(db,u)){
  const state=accountState(db,x),effective=state.reversed?'reversed':x.status,usable=effective==='confirmed'&&!state.pendingReversal;
  const independent=x.recorded_by!==u.id,eligible=usable?eligibleClaims(db,x):[],unallocated=effective==='confirmed'?Number(x.amount_minor)-state.allocated:0;
  const out=[];
  if(caps.includes('approve')&&x.status==='pending'&&independent)out.push('confirm_account','reject_account');
  if(caps.includes('approve')&&usable&&independent&&unallocated>0&&eligible.length)out.push('allocate');
  if(caps.includes('prepare')&&effective==='confirmed'&&!state.pendingReversal)out.push('request_account_reversal');
  const pending=state.pendingReversal;
  if(caps.includes('approve')&&pending&&![pending.requested_by,x.recorded_by,x.decided_by].includes(u.id))out.push('approve_account_reversal','reject_account_reversal');
  const liveIds=new Set(state.live.map(y=>y.id));
  return {id:x.id,case_id:x.case_id,case_name:x.case_name,reference:x.reference,currency:x.currency,amount_minor:x.amount_minor,received_on:x.received_on,payer:x.payer,evidence:x.evidence,
    recorded_by:x.recorded_by,recorded_by_name:personName(db,x.recorded_by),status:x.status,effective_status:effective,status_name:RECEIPT_STATE[effective],
    decided_by:x.decided_by,decided_by_name:personName(db,x.decided_by),decision_note:x.decision_note,matching_evidence:x.matching_evidence,decided_at:x.decided_at,created_at:x.created_at,
    allocated_minor:String(state.allocated),unallocated_minor:String(unallocated),
    allocations:allocationRows(db,'account_receipt_id',x.id).map(y=>({...allocationView(db,y),
      actions:caps.includes('approve')&&independent&&liveIds.has(y.id)?['reverse_allocation']:[]})),
    reversals:state.reversals.map(r=>accountReversalView(db,r)),eligible_claims:eligible,actions:out};
}

export function listReceivables(db,supplied){
  const u=actor(db,supplied),caps=financeCapabilities(db,u),claims=db.prepare('SELECT * FROM ar_claims WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).map(c=>view(db,u,c));
  const sources=db.prepare("SELECT c.id AS case_id,c.name,c.project_id,k.id AS contract_id,k.snapshot,d.id AS delivery_id,d.line_index,d.revision,d.evidence FROM commercial_cases c JOIN commercial_contracts k ON k.case_id=c.id JOIN commercial_deliveries d ON d.case_id=c.id JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE c.tenant_id=? AND c.project_id IS NOT NULL ORDER BY c.name,d.line_index").all(u.tenant_id)
    .map(row=>({...row,snapshot:JSON.parse(row.snapshot),term_label:termLabelForLine(db,row.case_id,row.line_index)}));
  const account_receipts=db.prepare('SELECT x.*,k.name AS case_name FROM ar_account_receipts x JOIN commercial_cases k ON k.id=x.case_id WHERE x.tenant_id=? ORDER BY x.created_at DESC,x.rowid DESC').all(u.tenant_id).map(x=>accountView(db,u,x,caps));
  // من يسجّل قبضًا على الحساب يختار العميل من هنا: من له اتفاق مسجّل وحده.
  const customers=caps.includes('prepare')?db.prepare('SELECT c.id,c.name FROM commercial_cases c JOIN commercial_contracts k ON k.case_id=c.id WHERE c.tenant_id=? ORDER BY c.name').all(u.tenant_id).map(r=>({id:r.id,name:r.name})):[];
  // استحقاقات المقدمة الممكنة الآن (الترحيل 183)، وكشف كل عميل له نشاط مالي على صفقاته.
  const advance_sources=caps.includes('prepare')?advanceSources(db,u.tenant_id):[];
  const statements=db.prepare(`SELECT DISTINCT cl.id,cl.code,cl.legal_name,cl.trade_name FROM clients cl JOIN commercial_cases k ON k.tenant_id=cl.tenant_id
      AND (k.client_id=cl.id OR EXISTS(SELECT 1 FROM client_links l WHERE l.case_id=k.id AND l.client_id=cl.id))
    WHERE cl.tenant_id=? AND (EXISTS(SELECT 1 FROM ar_claims c WHERE c.case_id=k.id) OR EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.case_id=k.id) OR EXISTS(SELECT 1 FROM advance_invoices a WHERE a.case_id=k.id))
    ORDER BY cl.legal_name,cl.id`).all(u.tenant_id).map(cl=>statementOf(db,u.tenant_id,cl));
  return {claims,sources,advance_sources,account_receipts,customers,statements,user_id:u.id,permissions:caps,generated_at:now(),external_invoicing:'not_connected',payment_execution:'not_connected'};
}

/* ───── كشف العميل عبر صفقاته (P4-CRM-4) ───── */
// ملف العميل الواحد وكل صفقة له فيها اتفاق أو مال: استحقاقاتها المعتمدة (صافية بعد الإشعارات الدائنة) وما ينتظر الاعتماد، والمقبوض،
// والمطبَّق من مال سابق (تخصيص من قبض على الحساب أو سحب من دفعة مقدمة)، والمعلق، والباقي على العميل، وما على حسابها ما تخصّص،
// وما بقي من دفعتها المقدمة بلا سحب. الأرقام من منظور التحصيل الواحد (ar_claim_collection) الذي يقرؤه كل قارئ في الحزمة 3.
// والمال على الحساب يبقى لصفقته (هـ24 #9): يُعرض بجانب باقيها ولا يُخصم من باقي صفقة أخرى، والمجموع لكل عملة على حدة.
function dealsOfClient(db,tenantId,clientId){
  return db.prepare('SELECT k.id,k.name,k.status FROM commercial_cases k WHERE k.tenant_id=? AND (k.client_id=? OR EXISTS(SELECT 1 FROM client_links l WHERE l.case_id=k.id AND l.client_id=?)) ORDER BY k.created_at,k.id').all(tenantId,clientId,clientId);
}
function dealStatement(db,k){
  const contract=db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(k.id),agreement=contract?JSON.parse(contract.snapshot):null;
  const claims=db.prepare(`SELECT c.*,s.net_minor,s.received_minor,s.pending_minor,s.allocated_minor,
      (SELECT t.number FROM tax_invoices t WHERE t.claim_id=c.id AND t.kind='invoice' AND t.status='issued' ORDER BY t.issued_at DESC LIMIT 1) AS invoice_number
    FROM ar_claims c JOIN ar_claim_collection s ON s.claim_id=c.id WHERE c.case_id=? AND c.status IN ('draft','pending','approved') ORDER BY c.due_date,c.created_at,c.id`).all(k.id);
  const receipts=db.prepare(`SELECT r.reference,CAST(r.amount_minor AS INTEGER) AS amount_minor,r.received_on FROM ar_receipts r JOIN ar_claims c ON c.id=r.claim_id WHERE c.case_id=? AND r.status='confirmed'
      AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.receipt_id=r.id AND a.kind='receipt_reversal' AND a.status='approved') ORDER BY r.received_on,r.id`).all(k.id);
  const accounts=db.prepare("SELECT * FROM ar_account_receipts WHERE case_id=? AND status='confirmed' ORDER BY received_on,id").all(k.id).map(x=>{const state=accountState(db,x);
    return {reference:x.reference,received_on:x.received_on,amount_minor:Number(x.amount_minor),unallocated_minor:state.reversed?0:Math.max(0,Number(x.amount_minor)-state.allocated),reversed:state.reversed};});
  const advances=db.prepare(`SELECT a.paid_minor-(SELECT COALESCE(SUM(amount_minor),0) FROM advance_reversals WHERE advance_id=a.id)-(SELECT COALESCE(SUM(applied_minor),0) FROM advance_draws WHERE advance_id=a.id) AS held
    FROM advance_invoices a WHERE a.case_id=? AND a.status='paid'`).all(k.id);
  const approved=claims.filter(c=>c.status==='approved'),sum=(list,f)=>list.reduce((n,x)=>n+f(x),0),open=c=>Math.max(0,c.net_minor-c.received_minor-c.allocated_minor);
  return {case_id:k.id,name:k.name,status:k.status,currency:agreement?.currency??claims[0]?.currency??'SAR',contract_total_minor:agreement?Number(agreement.total_minor):null,
    entitled_minor:sum(approved,c=>c.net_minor),awaiting_minor:sum(claims.filter(c=>c.status!=='approved'),c=>Number(c.amount_minor)),
    received_minor:sum(approved,c=>c.received_minor),applied_minor:sum(approved,c=>c.allocated_minor),pending_minor:sum(approved,c=>c.pending_minor),open_minor:sum(approved,open),
    on_account_minor:sum(accounts,x=>x.unallocated_minor),advance_held_minor:sum(advances,a=>Math.max(0,a.held)),
    claims:claims.map(c=>{const source=JSON.parse(c.source_snapshot);return {id:c.id,basis:c.basis,status:c.status,status_name:REQUEST_STATUS_AR[c.status]??c.status,
      label:source.line_description??c.advance_clause,term_label:source.term?.label??null,amount_minor:Number(c.amount_minor),net_minor:c.net_minor,
      collected_minor:c.received_minor+c.allocated_minor,balance_minor:c.status==='approved'?open(c):null,due_date:c.due_date,invoice_number:c.invoice_number,client_po_number:source.client_po?.number??null};}),
    receipts,account_receipts:accounts};
}
const STATEMENT_FIGURES=['entitled_minor','awaiting_minor','received_minor','applied_minor','pending_minor','open_minor','on_account_minor','advance_held_minor'];
function statementOf(db,tenantId,client){
  const deals=dealsOfClient(db,tenantId,client.id).map(k=>dealStatement(db,k)).filter(d=>d.contract_total_minor!==null||d.claims.length||d.account_receipts.length||d.advance_held_minor);
  const totals=[...new Set(deals.map(d=>d.currency))].map(currency=>({currency,...Object.fromEntries(STATEMENT_FIGURES.map(key=>[key,deals.filter(d=>d.currency===currency).reduce((n,d)=>n+d[key],0)]))}));
  return {client:{id:client.id,code:client.code,name:client.trade_name||client.legal_name},deals,totals};
}
export function customerStatement(db,supplied,clientId){
  const u=actor(db,supplied);
  const client=typeof clientId==='string'&&db.prepare('SELECT id,code,legal_name,trade_name FROM clients WHERE id=? AND tenant_id=?').get(clientId,u.tenant_id);
  if(!client)refuse(404,'client_not_found',{what:'ما لقينا ملف هالعميل في كيانك',next:'افتح كشف العميل من «مستحقات العملاء»'});
  return statementOf(db,u.tenant_id,client);
}
// الاستحقاق يُنشأ على بند من جدول دفعات الصفقة بشرطه، وتحت أمر شراء العميل المؤكد (الترحيل 183، app/entitlement-gates.mjs):
// من مخرج مقبول (basis 'delivery'، الافتراض) على الدفعة التي يشترط قبول بنده، أو من بند المقدمة (basis 'advance' بالصفقة case_id).
// الربط بالبند يُكتب قبل الاستحقاق في المعاملة نفسها، فيقرؤه حارس الكتابة في القاعدة.
function insertClaim(db,u,{contractId,projectId,caseId,basis,deliveryId,clause,snapshot,currency,amount,input,gate}){
  const id=randomUUID(),timestamp=now();
  writeTermLink(db,{claimId:id,tenantId:u.tenant_id,caseId,gate,time:timestamp});
  db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,delivery_id,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',1,0,?,?)")
    .run(id,u.tenant_id,contractId,projectId,caseId,u.id,basis,deliveryId,clause,JSON.stringify(snapshot),currency,amount,input.due_date,v.text(input.entitlement_evidence,'دليل الاستحقاق',5000,10),timestamp,timestamp);
  const c=claim(db,u,id);history(db,u,c,'created');return view(db,u,c);
}
function createAdvanceClaim(db,u,input){
  if(input.delivery_id!==undefined&&input.delivery_id!=='')refuse(400,'invalid_fields',{what:'استحقاق الدفعة المقدمة ما له مخرج',next:'احذف المخرج من الطلب واختر الصفقة'});
  const c=typeof input.case_id==='string'&&db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id);
  if(!c)refuse(404,'deal_not_found',{what:'ما لقينا هالصفقة في كيانك',next:'اختر الصفقة من قائمة استحقاقات الدفعات المقدمة'});
  const contract=db.prepare('SELECT id,snapshot FROM commercial_contracts WHERE case_id=?').get(c.id),owner=personName(db,c.owner_id)??'صاحب الصفقة';
  if(!contract)refuse(409,'agreement_required',{what:`صفقة «${c.name}» ما توثّق اتفاقها، والمقدمة تحل بتوثيقه`,
    missing:[{document:'الاتفاق الموثّق على عرض السعر المقبول',why:'بند المقدمة في الجدول شرطه توثيق الاتفاق',owner,owner_role:'account_manager',doc_key:'contract'}],next:'وثّق الاتفاق من «العملاء والعروض»، ثم أنشئ استحقاق المقدمة'});
  if(!c.project_id)refuse(409,'project_required',{what:`صفقة «${c.name}» ما انفتح مشروعها، والاستحقاق يُسجَّل على مشروع`,
    missing:[{document:'المشروع المفتوح من اتفاق الصفقة',why:'الاستحقاق وذمته وقيده على المشروع',owner:`المدير المباشر لـ${owner}`,owner_role:'manager',doc_key:'project'}],next:'افتح المشروع من الصفقة في «العملاء والعروض»، ثم أنشئ استحقاق المقدمة'});
  refuseTerminated(db,c.id,'ما ينسجّل استحقاق جديد');
  assertFinanciallyOpen(db,c.project_id,'ما ينسجّل استحقاق جديد على مشروع مقفل ماليًا');
  const amount=money(input.amount),gate=entitlementGate(db,c,{basis:'advance',amount:Number(amount)});
  if(gate.legacy)refuse(409,'payment_terms_untyped',{what:`جدول دفعات «${c.name}» انسجّل قبل ما تنكتب الشروط بأنواعها، فما يُعرف فيه بند المقدمة`,
    missing:[{document:'جدول دفعات بشروطه',why:'استحقاق المقدمة ينكتب على بند «دفعة مقدمة عند توقيع الاتفاق»',owner,owner_role:'account_manager',doc_key:'payment_schedule'}],
    next:'المقدمة على هذا الجدول تُسجَّل دفعة مقدمة في «الفوترة الدورية والدفعات المقدمة» كما كانت'});
  const agreement=JSON.parse(contract.snapshot);
  const snapshot={contract_id:contract.id,quote_id:agreement.quote_id,quote_revision:agreement.quote_revision,quote_digest:agreement.quote_digest,line_index:null,
    line_description:`الدفعة المقدمة: ${gate.term.label}`,...gateSnapshot(gate),internal_only:true};
  return insertClaim(db,u,{contractId:contract.id,projectId:c.project_id,caseId:c.id,basis:'advance',deliveryId:null,clause:gate.term.label,snapshot,currency:agreement.currency,amount,input,gate});
}
export function createClaim(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الاستحقاق معاملة');const u=actor(db,supplied,'prepare');
  v.object(input,['delivery_id','amount','due_date','entitlement_evidence','basis','case_id']);v.date(input.due_date);
  const basis=input.basis===undefined||input.basis===''?'delivery':input.basis;
  if(basis==='advance')return createAdvanceClaim(db,u,input);
  if(basis!=='delivery')refuse(400,'invalid_basis',{what:`«${basis}» ما هو أساس استحقاق`,next:'أساس الاستحقاق: مخرج مقبول، أو الدفعة المقدمة في جدول الاتفاق'});
  if(input.case_id!==undefined&&input.case_id!=='')refuse(400,'invalid_fields',{what:'استحقاق المخرج يُقرأ من مخرجه، فما تُرسل معه صفقة',next:'احذف الصفقة من الطلب واختر المخرج المقبول'});
  const source=typeof input.delivery_id==='string'&&db.prepare("SELECT c.id AS case_id,c.tenant_id,c.project_id,k.id AS contract_id,k.snapshot,d.id AS delivery_id,d.line_index,d.revision,d.evidence FROM commercial_cases c JOIN commercial_contracts k ON k.case_id=c.id JOIN commercial_deliveries d ON d.case_id=c.id JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE d.id=? AND c.tenant_id=? AND c.project_id IS NOT NULL").get(input.delivery_id,u.tenant_id);
  if(!source)fail(404,'delivery_not_billable','يلزم مخرج مقبول مرتبط باتفاق ومشروع');
  assertDealClientOpen(db,u.tenant_id,source.case_id,'ما ينسجّل استحقاق');
  // العقد المنهى في سجل العقود لا يُستحق عليه جديد (الترحيل 182)؛ ما استُحق قبله يبقى ويُحصَّل.
  refuseTerminated(db,source.case_id,'ما ينسجّل استحقاق جديد');
  if(db.prepare("SELECT 1 FROM ar_claims WHERE delivery_id=? AND status<>'cancelled'").get(source.delivery_id))fail(409,'duplicate_entitlement','يوجد استحقاق قائم لهذا المخرج');
  // استحقاق جديد بعد الإقفال المالي يترك المشروع «مقفلًا» وعليه ذمة لم يرها الإقفال. الحسم بإعادة فتح الإقفال بسجل وسبب (ترحيل 163).
  assertFinanciallyOpen(db,source.project_id,'ما ينسجّل استحقاق جديد على مشروع مقفل ماليًا');
  const contract=JSON.parse(source.snapshot),line=contract.lines[source.line_index],amount=money(input.amount);
  // الجدول بشروط يقيس الاستحقاق على دفعته (قد تجمع بنودًا)، والجدول القديم على قيمة بند المخرج كما كان.
  const gate=entitlementGate(db,db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(source.case_id),{basis:'delivery',line:source.line_index,amount:Number(amount)});
  if(gate.legacy&&(!line||BigInt(amount)>BigInt(line.total_minor)))fail(409,'amount_exceeds_entitlement','المبلغ يتجاوز قيمة بند المخرج المقبول');
  const snapshot={contract_id:source.contract_id,quote_id:contract.quote_id,quote_revision:contract.quote_revision,quote_digest:contract.quote_digest,line_index:source.line_index,line_description:line.description,line_total_minor:line.total_minor,delivery_id:source.delivery_id,delivery_revision:source.revision,delivery_evidence:source.evidence,...gateSnapshot(gate),internal_only:true};
  return insertClaim(db,u,{contractId:source.contract_id,projectId:source.project_id,caseId:source.case_id,basis:'delivery',deliveryId:source.delivery_id,clause:'',snapshot,currency:contract.currency,amount,input,gate});
}
export function claimAction(db,supplied,id,action,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الاستحقاق معاملة');const u=actor(db,supplied),c=claim(db,u,id);
  if(!['submit','approve','return','reject'].includes(action))refuse(400,'invalid_action',{what:`«${action}» ما هو من قرارات الاستحقاق`,next:'قرارات الاستحقاق: تقديم، اعتماد، إعادة، رفض'});
  v.object(input,['version','note']);v.version(input.version,c.version);if(!view(db,u,c).actions.includes(action))fail(403,'transition_denied','لا تسمح الحالة أو الصلاحية بهذا الإجراء');
  let state;
  if(action==='submit'){
    state='pending';db.prepare('INSERT INTO ar_claim_versions VALUES(?,?,?,?,?)').run(c.id,c.revision+1,c.source_snapshot,u.id,now());
  }else{
    const note=v.text(input.note,'سبب القرار',3000,3);state={approve:'approved',return:'draft',reject:'rejected'}[action];
    db.prepare('INSERT INTO ar_claim_decisions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),c.id,c.revision,{approve:'approved',return:'returned',reject:'rejected'}[action],u.id,note,now());
  }
  db.prepare('UPDATE ar_claims SET status=?,version=version+1,revision=revision+?,updated_at=? WHERE id=?').run(state,action==='submit'?1:0,now(),c.id);
  const updated=claim(db,u,c.id);history(db,u,updated,action);return view(db,u,updated);
}
export function recordReceipt(db,supplied,id,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة القبض معاملة');const u=actor(db,supplied,'prepare'),c=claim(db,u,id);
  v.object(input,['reference','amount','received_on','payer','evidence']);
  if(c.status!=='approved')refuse(409,'claim_not_approved',{what:'القبض يُسجَّل على استحقاق معتمد',next:'اعتمد الاستحقاق أولًا، أو إذا وصل المبلغ قبل استحقاقه فسجّله «قبض على الحساب»'});
  // مال المقدمة له طريق واحد (الترحيل 183): دفعة مقدمة يؤكد قبضها غير مسجّلها فتفتح بوابة البدء، ثم سحبٌ منها على هذا الاستحقاق.
  // قبضٌ ثانٍ عليه هنا كان يسجّل الحوالة نفسها مرتين: مرة تفتح البوابة ومرة تسدّد الاستحقاق.
  if(c.basis==='advance')refuse(409,'advance_cash_path',{what:'استحقاق الدفعة المقدمة ما ينقبض عليه مباشرة',
    missing:[{document:'الدفعة المقدمة المؤكدة في «الفوترة الدورية والدفعات المقدمة»',why:'مال المقدمة ينسجّل دفعة مقدمة يؤكد قبضها غير اللي سجّلها، ثم ينسحب منها على هذا الاستحقاق',...FINANCE,doc_key:'advance_confirmation'}],
    next:'سجّل الدفعة المقدمة وأكّد قبضها، ثم اسحب منها على هذا الاستحقاق'});
  v.date(input.received_on);if(input.received_on>today())fail(400,'future_receipt','تاريخ القبض لا يكون في المستقبل');
  // السقف: المعلق والمؤكد غير المرتد والمخصص من القبض على الحساب لا تتجاوز الصافي (والمحفّز ar_receipt_ceiling يحرسه في القاعدة).
  const amount=money(input.amount),fig=figures(db,c),reduced=credited(db,c.id);
  if(fig.committed+Number(amount)>fig.net)fail(409,'over_allocation',reduced>0n
    ?`إجمالي المقبوضات يتجاوز صافي الاستحقاق: ${decimal(BigInt(c.amount_minor))} ناقص إشعارات دائنة صادرة بـ${decimal(reduced)} يساوي ${show(fig.net)}`
    :fig.allocated>0?`إجمالي المقبوضات يتجاوز الاستحقاق: خُصّص عليه ${show(fig.allocated)} من قبض على الحساب، والباقي ${show(Math.max(0,fig.net-fig.committed))}`:'إجمالي المقبوضات يتجاوز الاستحقاق');
  const receipt={id:randomUUID(),reference:v.text(input.reference,'مرجع القبض',180,3).normalize('NFKC').toUpperCase(),payer:v.text(input.payer,'الدافع',300,3),evidence:v.text(input.evidence,'دليل القبض',5000,10)};
  if(referenceUsed(db,u.tenant_id,receipt.reference))duplicateReference(receipt.reference);
  db.prepare("INSERT INTO ar_receipts VALUES(?,?,?,?,?,?,?,?,?,'pending',?)").run(receipt.id,c.id,u.tenant_id,receipt.reference,amount,input.received_on,receipt.payer,receipt.evidence,u.id,now());
  audit(db,u,'receipt',receipt.id,'recorded',{}, {claim_id:c.id,amount_minor:amount,status:'pending'});return db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(receipt.id);
}
export function getReceipt(db,supplied,id){
  const u=actor(db,supplied),r=typeof id==='string'&&db.prepare('SELECT * FROM ar_receipts WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!r)refuse(404,'not_found',{what:'ما لقينا هالقبض في كيانك',next:'حدّث الصفحة وافتح القبض من استحقاقه'});return r;
}
export function receiptAction(db,supplied,id,receiptId,action,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب مطابقة القبض معاملة');const u=actor(db,supplied,'approve'),c=claim(db,u,id);
  v.object(input,['note','matching_evidence']);if(!['confirm','reject'].includes(action))refuse(400,'invalid_action',{what:`«${action}» ما هو من قرارات المطابقة`,next:'قرار المطابقة: تأكيد أو رفض'});
  const r=db.prepare("SELECT * FROM ar_receipts WHERE id=? AND claim_id=? AND status='pending'").get(receiptId,c.id);
  if(!r)refuse(404,'receipt_not_found',{what:'ما لقينا قبضًا معلقًا بهالمعرّف على هالاستحقاق',next:'حدّث الصفحة: يمكن انحسم القبض من قبل'});
  if(r.recorded_by===u.id)fail(403,'self_approval','لا يطابق مسجل القبض سجله بنفسه');
  const note=v.text(input.note,'سبب القرار',3000,3),matching=v.text(input.matching_evidence,'دليل المطابقة',5000,10),decision=action==='confirm'?'confirmed':'rejected';
  db.prepare('INSERT INTO ar_receipt_decisions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),r.id,decision,u.id,note,matching,now());db.prepare('UPDATE ar_receipts SET status=? WHERE id=?').run(decision,r.id);
  audit(db,u,'receipt',r.id,decision,{status:'pending'},{status:decision,claim_id:c.id},note);return view(db,u,c);
}

/* ───── (1) ارتداد القبض ───── */
function adjustmentRow(db,u,id){
  const row=typeof id==='string'&&db.prepare('SELECT a.* FROM ar_adjustments a JOIN ar_claims c ON c.id=a.claim_id WHERE a.id=? AND c.tenant_id=?').get(id,u.tenant_id);
  if(!row)refuse(404,'adjustment_not_found',{what:'ما لقينا طلب التسوية هذا في كيانك',next:'حدّث الصفحة وافتح الطلب من استحقاقه'});
  return row;
}
const reversalDate=(effective,from)=>{const todayDate=today();
  if(effective<from||effective>todayDate)refuse(400,'reversal_date',{what:`تاريخ الارتداد ${effective} لازم يكون من تاريخ القبض ${from} لين اليوم ${todayDate}`,next:'اكتب اليوم اللي رجع فيه المبلغ في كشف البنك'});};
// الشيك الراجع والحوالة المنعكسة والقبض المسجَّل خطأ: طلبٌ بسببه ودليله وتاريخ رجوعه في البنك. صف القبض لا يُمس؛
// العكس صفٌّ مستقل يعتمده ثالث، فيبقى للقبض قيده وللعكس قيده، وتعود الذمة على العميل بالقيد الثاني لا بمحو الأول.
export function requestReceiptReversal(db,supplied,claimId,receiptId,input){
  writing(db,'طلب عكس القبض');
  const u=actor(db,supplied,'prepare'),c=claim(db,u,claimId);
  v.object(input,['reason','evidence','effective_on']);
  const r=typeof receiptId==='string'&&db.prepare('SELECT * FROM ar_receipts WHERE id=? AND claim_id=? AND tenant_id=?').get(receiptId,c.id,u.tenant_id);
  if(!r)refuse(404,'receipt_not_found',{what:'ما لقينا هالقبض على هالاستحقاق',next:'افتح الاستحقاق نفسه واختر القبض من قائمة مقبوضاته'});
  if(r.status!=='confirmed')refuse(409,'receipt_not_confirmed',{what:`القبض ${r.reference} ${r.status==='pending'?'للحين ما تطابق':'مرفوض'}، وما ينعكس إلا قبض مؤكد`,
    next:r.status==='pending'?'إذا المبلغ ما وصل فعلًا، يرفضه المطابق من «مطابقة القبض» بدل عكسه':'القبض المرفوض ما انحسب على العميل أصلًا، فما فيه شي ينعكس'});
  const standing=db.prepare("SELECT status FROM ar_adjustments WHERE receipt_id=? AND kind='receipt_reversal' AND status IN ('pending','approved') ORDER BY status='approved' DESC LIMIT 1").get(r.id);
  if(standing?.status==='approved')refuse(409,'receipt_already_reversed',{what:`القبض ${r.reference} منعكس من قبل`,next:'إذا وصل المبلغ مرة ثانية، سجّله قبضًا جديدًا بمرجعه الجديد'});
  if(standing)refuse(409,'reversal_already_requested',{what:`على القبض ${r.reference} طلب عكس ينتظر قراره`,
    missing:[{document:'قرار على طلب العكس القائم',why:'طلبٌ واحد معلق لكل قبض، فما يتكرر العكس',...APPROVER}],next:'انتظر قرار الطلب القائم، أو اطلب من المعتمد رفضه إذا كان خطأ'});
  const effective=v.date(input.effective_on);reversalDate(effective,r.received_on);
  const reason=v.text(input.reason,'سبب العكس',2000,10),evidence=v.text(input.evidence,'دليل الارتداد',5000,10);
  assertFinanciallyOpen(db,c.project_id,'ما ينعكس قبض على مشروع مقفل ماليًا');
  const id=randomUUID();
  db.prepare("INSERT INTO ar_adjustments(id,claim_id,kind,receipt_id,amount_minor,requested_by,reason,evidence,status,created_at,effective_on) VALUES(?,?,'receipt_reversal',?,?,?,?,?,'pending',?,?)")
    .run(id,c.id,r.id,r.amount_minor,u.id,reason,evidence,now(),effective);
  audit(db,u,'receipt',r.id,'receipt.reversal_requested',{status:'confirmed'},{adjustment_id:id,claim_id:c.id,amount_minor:r.amount_minor,effective_on:effective},reason);
  return adjustmentView(db,adjustmentRow(db,u,id));
}

/* ───── (2) إلغاء الاستحقاق ───── */
// ما يقوم على الاستحقاق فيمنع إلغاءه، بندًا بندًا بمساره: القبض (يُعكس أو يُرفض)، والتخصيص (يُعكس)، والمستند الضريبي المعلق
// (يُحسم)، والفاتورة الصادرة (ما تنلغى؛ تتصحح بإشعار دائن بباقيها)، والنزاع المفتوح (يُحسم بسببه — قد يكون الإلغاء نفسه).
function standingOn(db,c){
  const f=figures(db,c),missing=[];
  if(f.received+f.pending>0)missing.push({doc_key:'receipts',document:`مقبوضات قائمة على الاستحقاق بـ${show(f.received+f.pending)}`,
    why:'القبض المؤكد انحسب على العميل، والمعلق ينتظر مطابقته: المؤكد ينعكس بطلب عكس، والمعلق يُرفض إن ما وصل',...FINANCE});
  if(f.allocated>0)missing.push({doc_key:'allocations',document:`تخصيص من قبض على الحساب بـ${show(f.allocated)}`,why:'ينعكس التخصيص فيرجع المبلغ على حساب العميل',...APPROVER});
  const open=db.prepare("SELECT COUNT(*) AS n FROM tax_invoices WHERE claim_id=? AND status IN ('draft','pending')").get(c.id).n;
  if(open)missing.push({doc_key:'tax_documents',document:`${open} مستند ضريبي ما انحسم (مسودة أو بانتظار الإصدار)`,why:'يُرفض أو يصدر قبل الإلغاء، فما يصدر مستند على استحقاق ملغى',
    owner:'المالية: معد المستند الضريبي ومصدره',owner_role:'finance'});
  const invoiced=db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'invoice' THEN total_minor ELSE -total_minor END),0) AS n FROM tax_invoices WHERE claim_id=? AND status='issued'").get(c.id).n;
  if(invoiced>0)missing.push({doc_key:'invoice',document:`فاتورة صادرة باقي منها ${show(invoiced)} بعد الإشعارات الدائنة`,why:'الفاتورة الصادرة ما تنلغى ولا تتعدل؛ تتصحح بإشعار دائن بباقيها',
    owner:'المالية: معد الإشعار الدائن ومصدره',owner_role:'finance'});
  if(db.prepare('SELECT 1 FROM ar_disputes WHERE claim_id=? AND resolved_at IS NULL').get(c.id))missing.push({doc_key:'dispute',document:'حسم النزاع المفتوح على الاستحقاق',
    why:'النزاع يُحسم بسبب مكتوب ودليل (قد يكون خطاب الإلغاء نفسه) فما يبقى معلقًا على استحقاق ملغى',...APPROVER});
  return missing;
}
const notCancellable=missing=>refuse(409,'claim_not_cancellable',{what:'ما ينلغى الاستحقاق وفيه ما يقوم عليه',missing,next:'احسم كل بند تحت من مساره، وبعدها اطلب الإلغاء'});
export function requestClaimCancel(db,supplied,claimId,input){
  writing(db,'طلب إلغاء الاستحقاق');
  const u=actor(db,supplied,'prepare'),c=claim(db,u,claimId);
  v.object(input,['reason','evidence']);
  if(!['draft','approved'].includes(c.status))refuse(409,'claim_state',{what:`الاستحقاق ${REQUEST_STATUS_AR[c.status]??c.status}، وما ينطلب إلغاؤه`,
    next:c.status==='pending'?'المعتمد يعيده للمعد أو يرفضه من قرار الاستحقاق نفسه':'الاستحقاق المرفوض أو الملغى ما عليه شي ينلغى'});
  if(db.prepare("SELECT 1 FROM ar_adjustments WHERE claim_id=? AND kind='claim_cancel' AND status='pending'").get(c.id))refuse(409,'cancel_already_requested',{what:'على الاستحقاق طلب إلغاء ينتظر قراره',
    missing:[{document:'قرار على طلب الإلغاء القائم',why:'طلبٌ واحد معلق لكل استحقاق',...APPROVER}],next:'انتظر القرار، أو اطلب من المعتمد رفضه إذا كان خطأ'});
  const standing=standingOn(db,c);if(standing.length)notCancellable(standing);
  const reason=v.text(input.reason,'سبب الإلغاء',2000,10),evidence=v.text(input.evidence,'دليل الإلغاء',5000,10);
  assertFinanciallyOpen(db,c.project_id,'ما ينلغى استحقاق على مشروع مقفل ماليًا');
  const id=randomUUID();
  db.prepare("INSERT INTO ar_adjustments(id,claim_id,kind,receipt_id,amount_minor,requested_by,reason,evidence,status,created_at) VALUES(?,?,'claim_cancel',NULL,?,?,?,?,'pending',?)")
    .run(id,c.id,String(figures(db,c).net),u.id,reason,evidence,now());
  audit(db,u,'receivable',c.id,'claim_cancel.requested',{status:c.status},{adjustment_id:id},reason);
  return adjustmentView(db,adjustmentRow(db,u,id));
}
// القرار على طلب التسوية (عكس القبض أو إلغاء الاستحقاق): غير طالبه دائمًا، وللعكس غير مسجّل القبض ومطابقه أيضًا — والرفض مثل
// الاعتماد: من سجّل القبض أو طابقه له مصلحة في بقائه. والإلغاء يعيد فحص ما يقوم على الاستحقاق ساعة القرار لا ساعة الطلب.
export function decideAdjustment(db,supplied,claimId,adjustmentId,action,input){
  writing(db,'قرار التسوية');
  const u=actor(db,supplied,'approve'),c=claim(db,u,claimId);
  if(!['approve','reject'].includes(action))refuse(400,'invalid_action',{what:'القرار إما اعتماد أو رفض',next:'اختر «اعتماد» أو «رفض» من الطلب نفسه'});
  v.object(input,['note']);
  const a=adjustmentRow(db,u,adjustmentId);
  if(a.claim_id!==c.id)refuse(404,'adjustment_not_found',{what:'طلب التسوية هذا ما هو على هالاستحقاق',next:'افتح الطلب من استحقاقه'});
  if(a.status!=='pending')refuse(409,'adjustment_decided',{what:`الطلب انحسم من قبل: ${REQUEST_STATUS_AR[a.status]??a.status}`,next:'القرار نهائي؛ إذا تغيّر شي يُفتح طلب جديد بسببه'});
  if(a.requested_by===u.id)refuse(403,'self_approval',{what:'ما تقرر في طلب أنت طلبته',missing:[{document:'قرار من شخص غير طالب الطلب',...APPROVER}],next:'يقرر فيه زميل يحمل تفويض الاعتماد المالي'});
  if(a.kind==='receipt_reversal'){
    const r=db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(a.receipt_id),matcher=db.prepare('SELECT actor_id FROM ar_receipt_decisions WHERE receipt_id=?').get(r.id)?.actor_id;
    if(r.recorded_by===u.id||matcher===u.id)refuse(403,'reversal_not_independent',{what:`ما تقرر في عكس القبض ${r.reference}: ${r.recorded_by===u.id?'أنت سجّلته':'أنت طابقته'}`,
      missing:[{document:'قرار من شخص ثالث',why:'عكس القبض يعيد الذمة على العميل، فيقرره غير اللي سجّل القبض وغير اللي طابقه وغير اللي طلب العكس',...APPROVER}],
      next:'يقرر فيه زميل ثالث يحمل تفويض الاعتماد المالي'});
    if(action==='approve')assertFinanciallyOpen(db,c.project_id,'ما ينعكس قبض على مشروع مقفل ماليًا');
  }else if(action==='approve'){
    if(!['draft','approved'].includes(c.status))refuse(409,'claim_state',{what:`الاستحقاق صار ${REQUEST_STATUS_AR[c.status]??c.status} بعد طلب الإلغاء`,next:'ارفض طلب الإلغاء؛ الاستحقاق يمشي في مساره الحالي'});
    const standing=standingOn(db,c);if(standing.length)notCancellable(standing);
    assertFinanciallyOpen(db,c.project_id,'ما ينلغى استحقاق على مشروع مقفل ماليًا');
  }
  const note=v.text(input.note,'سبب القرار',3000,3),decision=action==='approve'?'approved':'rejected',time=now();
  db.prepare('UPDATE ar_adjustments SET status=?,decided_by=?,decision_note=?,decided_at=? WHERE id=?').run(decision,u.id,note,time,a.id);
  if(a.kind==='claim_cancel'&&decision==='approved'){
    db.prepare("UPDATE ar_claims SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(time,c.id);
    history(db,u,claim(db,u,c.id),'cancelled');
  }
  audit(db,u,a.kind==='receipt_reversal'?'receipt':'receivable',a.kind==='receipt_reversal'?a.receipt_id:c.id,`${a.kind}.${decision}`,{status:'pending'},{adjustment_id:a.id,status:decision},note);
  return view(db,u,claim(db,u,c.id));
}

/* ───── (3) النزاع والوعد بالسداد ───── */
const outstandingOf=(c,f,what,next)=>{
  if(c.status!=='approved')refuse(409,'claim_not_approved',{what:`${what} على استحقاق معتمد`,next:'اعتمد الاستحقاق أولًا'});
  if(f.balance<=0)refuse(409,'nothing_outstanding',{what:'ما على العميل شي في هالاستحقاق: صافيه محصَّل',next});
};
export function openDispute(db,supplied,claimId,input){
  writing(db,'فتح النزاع');
  const u=actor(db,supplied,'prepare'),c=claim(db,u,claimId);
  v.object(input,['amount','reason','evidence']);
  if(db.prepare('SELECT 1 FROM ar_disputes WHERE claim_id=? AND resolved_at IS NULL').get(c.id))refuse(409,'dispute_already_open',{what:'على الاستحقاق نزاع مفتوح',
    missing:[{document:'حسم النزاع القائم',why:'نزاعٌ واحد مفتوح لكل استحقاق',...APPROVER}],next:'أضف ما استجد إلى النزاع القائم عند حسمه'});
  const f=figures(db,c);outstandingOf(c,f,'النزاع ينفتح','إذا كان الاعتراض على مبلغ مدفوع، فهو رد مبلغ يُحسم بإشعار دائن لا بنزاع');
  const amount=Number(money(input.amount));
  if(amount>f.balance)refuse(409,'dispute_exceeds_balance',{what:`مبلغ النزاع ${show(amount)} أكبر من الباقي على العميل ${show(f.balance)}`,next:'اكتب المبلغ اللي يعترض عليه العميل من الباقي'});
  const id=randomUUID(),reason=v.text(input.reason,'سبب النزاع',3000,10),evidence=v.text(input.evidence,'دليل النزاع',5000,10);
  db.prepare('INSERT INTO ar_disputes(id,claim_id,amount_minor,reason,evidence,opened_by,opened_at) VALUES(?,?,?,?,?,?,?)').run(id,c.id,String(amount),reason,evidence,u.id,now());
  audit(db,u,'receivable',c.id,'dispute.opened',{}, {dispute_id:id,amount_minor:String(amount)},reason);
  return disputeView(db,db.prepare('SELECT * FROM ar_disputes WHERE id=?').get(id));
}
export function resolveDispute(db,supplied,claimId,disputeId,input){
  writing(db,'حسم النزاع');
  const u=actor(db,supplied,'approve'),c=claim(db,u,claimId);
  v.object(input,['resolution_note','resolution_evidence']);
  const d=typeof disputeId==='string'&&db.prepare('SELECT * FROM ar_disputes WHERE id=? AND claim_id=?').get(disputeId,c.id);
  if(!d)refuse(404,'dispute_not_found',{what:'ما لقينا هالنزاع على هالاستحقاق',next:'حدّث الصفحة وافتحه من استحقاقه'});
  if(d.resolved_at)refuse(409,'dispute_resolved',{what:`النزاع انحسم في ${d.resolved_at.slice(0,10)}`,next:'إذا رجع العميل يعترض، يُفتح نزاع جديد بسببه'});
  if(d.opened_by===u.id)refuse(403,'dispute_not_independent',{what:'ما تحسم نزاعًا أنت فتحته',missing:[{document:'حسم من شخص غير فاتح النزاع',...APPROVER}],next:'يحسمه زميل يحمل تفويض الاعتماد المالي'});
  const note=v.text(input.resolution_note,'كيف انحسم النزاع',3000,10),evidence=v.text(input.resolution_evidence,'دليل الحسم',5000,10);
  db.prepare('UPDATE ar_disputes SET resolved_by=?,resolution_note=?,resolution_evidence=?,resolved_at=? WHERE id=?').run(u.id,note,evidence,now(),d.id);
  audit(db,u,'receivable',c.id,'dispute.resolved',{dispute_id:d.id},{dispute_id:d.id,resolved:true},note);
  return view(db,u,claim(db,u,c.id));
}
export function recordPromise(db,supplied,claimId,input){
  writing(db,'تسجيل وعد السداد');
  const u=actor(db,supplied,'prepare'),c=claim(db,u,claimId);
  v.object(input,['amount','promised_on','contact','evidence']);
  const promised=v.date(input.promised_on),todayDate=today();
  if(promised<todayDate)refuse(400,'promise_date',{what:`تاريخ الوعد ${promised} فات`,next:'الوعد يُسجَّل بتاريخ اليوم أو بعده؛ والوعد اللي فات موعده يبان في المتابعة «ما انوفى»'});
  const f=figures(db,c);outstandingOf(c,f,'الوعد بالسداد يُسجَّل','ما فيه شي يُوعد به؛ إذا ارتد قبضٌ عليه، يرجع الباقي بعد اعتماد عكسه');
  const amount=Number(money(input.amount));
  if(amount>f.balance)refuse(409,'promise_exceeds_balance',{what:`الوعد بـ${show(amount)} أكبر من الباقي على العميل ${show(f.balance)}`,next:'اكتب المبلغ اللي وعد به العميل من الباقي'});
  const id=randomUUID();
  db.prepare('INSERT INTO ar_promises(id,claim_id,amount_minor,promised_on,contact,evidence,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,c.id,String(amount),promised,v.text(input.contact,'مين وعد',300,3),v.text(input.evidence,'دليل الوعد',5000,10),u.id,now());
  audit(db,u,'receivable',c.id,'promise.recorded',{}, {promise_id:id,amount_minor:String(amount),promised_on:promised});
  return promiseView(db,db.prepare('SELECT * FROM ar_promises WHERE id=?').get(id),todayDate);
}

/* ───── (4) القبض على الحساب وتخصيصه ───── */
// مالٌ وصل من العميل ولم يُخصَّص على استحقاق: حوالة تغطي أكثر من استحقاق، أو دفعة تصل قبل استحقاقها. يُسجَّل مرة بمرجعه،
// ويطابقه غير مسجّله، ثم يخصّصه غير مسجّله على استحقاقات العميل نفسه. قيده في الدفتر على «دفعات مقدمة من العملاء» (انظر أسفل).
export function recordAccountReceipt(db,supplied,input){
  writing(db,'تسجيل القبض على الحساب');
  const u=actor(db,supplied,'prepare');
  v.object(input,['case_id','reference','amount','received_on','payer','evidence']);
  const customer=typeof input.case_id==='string'&&db.prepare('SELECT id,name FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id);
  if(!customer)refuse(404,'customer_not_found',{what:'ما لقينا هالعميل في كيانك',next:'اختر العميل من قائمة العملاء اللي لهم اتفاق مسجّل'});
  if(!db.prepare('SELECT 1 FROM commercial_contracts WHERE case_id=?').get(customer.id))refuse(409,'customer_not_contracted',{what:`«${customer.name}» ما له اتفاق مسجّل، فما يُمسك له مال على الحساب`,
    missing:[{document:'اتفاق مسجّل مع العميل',why:'المال على الحساب يتخصّص على استحقاقات اتفاقه؛ بلا اتفاق ما فيه استحقاق يتخصّص عليه',owner:'مسؤول الحساب في المبيعات',owner_role:'sales'}],
    next:'سجّل الاتفاق أولًا، وإذا كانت دفعة مقدمة على اتفاق اشتراك فمكانها «الفوترة الدورية»'});
  const received=v.date(input.received_on);
  if(received>today())refuse(400,'future_receipt',{what:`تاريخ القبض ${received} في المستقبل`,next:'اكتب اليوم اللي وصل فيه المبلغ فعلًا في كشف البنك'});
  const amount=money(input.amount),reference=v.text(input.reference,'مرجع القبض',180,3).normalize('NFKC').toUpperCase();
  if(referenceUsed(db,u.tenant_id,reference))duplicateReference(reference);
  const id=randomUUID();
  db.prepare("INSERT INTO ar_account_receipts(id,tenant_id,case_id,reference,currency,amount_minor,received_on,payer,evidence,recorded_by,status,created_at) VALUES(?,?,?,?,'SAR',?,?,?,?,?,'pending',?)")
    .run(id,u.tenant_id,customer.id,reference,amount,received,v.text(input.payer,'الدافع',300,3),v.text(input.evidence,'دليل القبض',5000,10),u.id,now());
  audit(db,u,'account_receipt',id,'account_receipt.recorded',{}, {case_id:customer.id,amount_minor:amount,status:'pending'});
  return accountView(db,u,accountRow(db,u,id));
}
export function accountReceiptAction(db,supplied,accountId,action,input){
  writing(db,'مطابقة القبض على الحساب');
  const u=actor(db,supplied,'approve'),x=accountRow(db,u,accountId);
  if(!['confirm','reject'].includes(action))refuse(400,'invalid_action',{what:`«${action}» ما هو من قرارات المطابقة`,next:'قرار المطابقة: تأكيد أو رفض'});
  v.object(input,['note','matching_evidence']);
  if(x.status!=='pending')refuse(409,'account_receipt_not_pending',{what:`القبض ${x.reference} انحسم من قبل`,next:'القرار نهائي؛ القبض المرفوض يُسجَّل من جديد بمرجع صحيح إن لزم'});
  if(x.recorded_by===u.id)refuse(403,'self_approval',{what:'ما تطابق قبضًا أنت سجّلته',missing:[{document:'مطابقة من شخص غير مسجّل القبض',...APPROVER}],next:'يطابقه زميل يحمل تفويض الاعتماد المالي'});
  const note=v.text(input.note,'سبب القرار',3000,3),matching=v.text(input.matching_evidence,'دليل المطابقة',5000,10),decision=action==='confirm'?'confirmed':'rejected';
  db.prepare('UPDATE ar_account_receipts SET status=?,decided_by=?,decision_note=?,matching_evidence=?,decided_at=? WHERE id=?').run(decision,u.id,note,matching,now(),x.id);
  audit(db,u,'account_receipt',x.id,'account_receipt.'+decision,{status:'pending'},{status:decision},note);
  return accountView(db,u,accountRow(db,u,x.id));
}
const notIndependent=x=>refuse(403,'allocation_not_independent',{what:`ما تخصّص القبض ${x.reference} ولا تعكس تخصيصه: أنت سجّلته`,
  missing:[{document:'تخصيص من شخص غير مسجّل القبض',why:'اللي يسجّل المال ما يقرر وحده أي ذمة يسوّيها',...APPROVER}],next:'يخصّصه زميل يحمل تفويض الاعتماد المالي'});
function usableCash(x,state){
  if(x.status!=='confirmed')refuse(409,'account_receipt_not_confirmed',{what:`القبض ${x.reference} ${x.status==='pending'?'للحين ما تطابق':'مرفوض'}`,next:'يُخصَّص المال بعد ما يتطابق مع كشف البنك'});
  if(state.reversed)refuse(409,'account_receipt_reversed',{what:`القبض ${x.reference} منعكس: المبلغ رجع من البنك`,next:'إذا وصل المبلغ مرة ثانية، سجّله قبضًا جديدًا بمرجعه الجديد'});
  if(state.pendingReversal)refuse(409,'account_reversal_pending',{what:`على القبض ${x.reference} طلب عكس ينتظر قراره`,
    missing:[{document:'قرار على طلب العكس',why:'المال اللي يمكن ارتد ما يتخصّص على ذمة',...APPROVER}],next:'انتظر قرار العكس؛ إذا انرفض يرجع المال قابلًا للتخصيص'});
}
// التخصيص سجلٌ إلحاقي: صفٌّ لكل استحقاق، ولا يُعدَّل ولا يُحذف. سطور الطلب الواحد تُكتب معًا أو لا يُكتب منها شيء (المعاملة نفسها).
export function allocateReceipt(db,supplied,accountId,input){
  writing(db,'تخصيص القبض');
  const u=actor(db,supplied,'approve'),x=accountRow(db,u,accountId);
  v.object(input,['lines','note']);
  if(x.recorded_by===u.id)notIndependent(x);
  const state=accountState(db,x);usableCash(x,state);
  const badLines=what=>refuse(400,'allocation_lines',{what,next:'اكتب لكل استحقاق مبلغًا واحدًا، واترك الباقي فاضي'});
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>50)badLines('ما فيه سطور تخصيص (من سطر إلى خمسين)');
  const seen=new Set(),lines=input.lines.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line)||Object.keys(line).some(k=>!['claim_id','amount'].includes(k))||typeof line.claim_id!=='string')badLines('سطر التخصيص يحمل الاستحقاق ومبلغه فقط');
    if(seen.has(line.claim_id))badLines('الاستحقاق الواحد مكرر في سطور التخصيص');
    seen.add(line.claim_id);
    const c=db.prepare('SELECT * FROM ar_claims WHERE id=? AND tenant_id=?').get(line.claim_id,u.tenant_id);
    if(!c)refuse(404,'not_found',{what:'ما لقينا أحد الاستحقاقات في كيانك',next:'اختر من الاستحقاقات المعروضة للتخصيص'});
    if(c.case_id!==x.case_id)refuse(409,'allocation_other_customer',{what:'الاستحقاق لعميل ثاني غير صاحب المبلغ',next:'المال على الحساب يتخصّص على استحقاقات العميل نفسه فقط'});
    if(c.basis==='advance')refuse(409,'allocation_advance_claim',{what:'استحقاق الدفعة المقدمة ما يتخصّص عليه قبض على الحساب',
      next:'مال المقدمة ينسجّل دفعة مقدمة مؤكدة وينسحب منها على استحقاقها؛ خصّص هذا القبض على استحقاقات المخرجات'});
    if(c.status!=='approved')refuse(409,'allocation_claim_not_open',{what:`الاستحقاق ${REQUEST_STATUS_AR[c.status]??c.status}، وما يُخصَّص إلا على معتمد`,next:'اعتمد الاستحقاق أولًا'});
    if(c.currency!==x.currency)refuse(409,'allocation_currency',{what:`الاستحقاق بعملة ${c.currency} والمبلغ بالريال`,next:'سياسة سعر الصرف ما اتحددت؛ ما يُخصَّص مبلغ على استحقاق بعملة ثانية'});
    return {claim:c,amount:Number(money(line.amount))};
  });
  const total=lines.reduce((n,l)=>n+l.amount,0),remaining=Number(x.amount_minor)-state.allocated;
  if(total>remaining)refuse(409,'allocation_exceeds_receipt',{what:`التخصيص ${show(total)} أكبر من الباقي من القبض ${show(remaining)}`,next:'خصّص الباقي فقط، أو اعكس تخصيصًا قائمًا أولًا'});
  for(const line of lines){const f=figures(db,line.claim),room=f.net-f.committed;
    if(line.amount>room)refuse(409,'allocation_exceeds_claim',{what:`التخصيص ${show(line.amount)} أكبر من الباقي على الاستحقاق ${show(Math.max(0,room))}`,next:'الباقي = الصافي بعد الإشعارات الدائنة ناقص المقبوض والمعلق والمخصص'});}
  const note=v.text(input.note,'سبب التخصيص',2000,3),time=now();
  for(const line of lines){
    const id=randomUUID();
    db.prepare("INSERT INTO ar_allocations(id,tenant_id,account_receipt_id,claim_id,kind,reverses_id,amount_minor,note,allocated_by,created_at) VALUES(?,?,?,?,'allocation',NULL,?,?,?,?)")
      .run(id,u.tenant_id,x.id,line.claim.id,String(line.amount),note,u.id,time);
    audit(db,u,'receivable',line.claim.id,'allocation.recorded',{}, {allocation_id:id,account_receipt_id:x.id,amount_minor:String(line.amount)},note);
  }
  return accountView(db,u,accountRow(db,u,x.id));
}
export function reverseAllocation(db,supplied,accountId,allocationId,input){
  writing(db,'عكس التخصيص');
  const u=actor(db,supplied,'approve'),x=accountRow(db,u,accountId);
  v.object(input,['reason']);
  const y=typeof allocationId==='string'&&db.prepare("SELECT * FROM ar_allocations WHERE id=? AND account_receipt_id=? AND kind='allocation'").get(allocationId,x.id);
  if(!y)refuse(404,'allocation_not_found',{what:'ما لقينا هالتخصيص على هالقبض',next:'حدّث الصفحة وافتح التخصيص من قائمة تخصيصات القبض'});
  if(x.recorded_by===u.id)notIndependent(x);
  if(db.prepare('SELECT 1 FROM ar_allocations WHERE reverses_id=?').get(y.id))refuse(409,'allocation_already_reversed',{what:'التخصيص منعكس من قبل',next:'إذا لزم تخصيص جديد، خصّص من الباقي'});
  // عكس التخصيص يعيد الذمة على الاستحقاق: تغييرٌ لما انقفل عليه المشروع إن كان مقفلًا ماليًا.
  assertFinanciallyOpen(db,db.prepare('SELECT project_id FROM ar_claims WHERE id=?').get(y.claim_id).project_id,'ما ينعكس تخصيص على مشروع مقفل ماليًا');
  const reason=v.text(input.reason,'سبب عكس التخصيص',2000,10),id=randomUUID();
  db.prepare("INSERT INTO ar_allocations(id,tenant_id,account_receipt_id,claim_id,kind,reverses_id,amount_minor,note,allocated_by,created_at) VALUES(?,?,?,?,'reversal',?,?,?,?,?)")
    .run(id,u.tenant_id,x.id,y.claim_id,y.id,y.amount_minor,reason,u.id,now());
  audit(db,u,'receivable',y.claim_id,'allocation.reversed',{allocation_id:y.id},{reversal_id:id,amount_minor:y.amount_minor},reason);
  return accountView(db,u,accountRow(db,u,x.id));
}
export function requestAccountReversal(db,supplied,accountId,input){
  writing(db,'طلب عكس القبض على الحساب');
  const u=actor(db,supplied,'prepare'),x=accountRow(db,u,accountId);
  v.object(input,['reason','evidence','effective_on']);
  const state=accountState(db,x);
  if(x.status!=='confirmed')refuse(409,'account_receipt_not_confirmed',{what:`القبض ${x.reference} ${x.status==='pending'?'للحين ما تطابق':'مرفوض'}، وما ينعكس إلا قبض مؤكد`,
    next:x.status==='pending'?'إذا المبلغ ما وصل فعلًا، يرفضه المطابق بدل عكسه':'القبض المرفوض ما انحسب أصلًا'});
  if(state.reversed)refuse(409,'account_receipt_reversed',{what:`القبض ${x.reference} منعكس من قبل`,next:'إذا وصل المبلغ مرة ثانية، سجّله قبضًا جديدًا بمرجعه الجديد'});
  if(state.pendingReversal)refuse(409,'reversal_already_requested',{what:`على القبض ${x.reference} طلب عكس ينتظر قراره`,
    missing:[{document:'قرار على طلب العكس القائم',why:'طلبٌ واحد معلق لكل قبض',...APPROVER}],next:'انتظر قرار الطلب القائم'});
  if(state.live.length)refuse(409,'account_allocations_live',{what:`القبض ${x.reference} مخصّص منه ${show(state.allocated)} على استحقاقات، فما ينعكس وهو قائم عليها`,
    missing:[{doc_key:'allocations',document:`${state.live.length} تخصيص قائم من هالقبض`,why:'التخصيص يسوّي ذمة العميل من هالمبلغ؛ ينعكس أولًا فترجع الذمة، وبعدها ينعكس القبض',...APPROVER}],
    next:'اعكس كل تخصيص من قائمة تخصيصات القبض، وبعدها اطلب العكس'});
  const effective=v.date(input.effective_on);reversalDate(effective,x.received_on);
  const reason=v.text(input.reason,'سبب العكس',2000,10),evidence=v.text(input.evidence,'دليل الارتداد',5000,10),id=randomUUID();
  db.prepare("INSERT INTO ar_account_reversals(id,tenant_id,account_receipt_id,amount_minor,effective_on,reason,evidence,requested_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?)")
    .run(id,u.tenant_id,x.id,x.amount_minor,effective,reason,evidence,u.id,now());
  audit(db,u,'account_receipt',x.id,'account_receipt.reversal_requested',{status:'confirmed'},{reversal_id:id,effective_on:effective},reason);
  return accountReversalView(db,db.prepare('SELECT * FROM ar_account_reversals WHERE id=?').get(id));
}
export function decideAccountReversal(db,supplied,accountId,reversalId,action,input){
  writing(db,'قرار عكس القبض على الحساب');
  const u=actor(db,supplied,'approve'),x=accountRow(db,u,accountId);
  if(!['approve','reject'].includes(action))refuse(400,'invalid_action',{what:'القرار إما اعتماد أو رفض',next:'اختر «اعتماد» أو «رفض» من الطلب نفسه'});
  v.object(input,['note']);
  const r=typeof reversalId==='string'&&db.prepare('SELECT * FROM ar_account_reversals WHERE id=? AND account_receipt_id=?').get(reversalId,x.id);
  if(!r)refuse(404,'adjustment_not_found',{what:'ما لقينا طلب العكس هذا على هالقبض',next:'حدّث الصفحة وافتح الطلب من القبض'});
  if(r.status!=='pending')refuse(409,'adjustment_decided',{what:`الطلب انحسم من قبل: ${REQUEST_STATUS_AR[r.status]??r.status}`,next:'القرار نهائي؛ إذا تغيّر شي يُفتح طلب جديد بسببه'});
  if(r.requested_by===u.id)refuse(403,'self_approval',{what:'ما تقرر في طلب أنت طلبته',missing:[{document:'قرار من شخص غير طالب الطلب',...APPROVER}],next:'يقرر فيه زميل يحمل تفويض الاعتماد المالي'});
  if(x.recorded_by===u.id||x.decided_by===u.id)refuse(403,'account_reversal_not_independent',{what:`ما تقرر في عكس القبض ${x.reference}: ${x.recorded_by===u.id?'أنت سجّلته':'أنت طابقته'}`,
    missing:[{document:'قرار من شخص ثالث',why:'عكس القبض يخرج المال من حساب العميل، فيقرره غير اللي سجّله وطابقه',...APPROVER}],next:'يقرر فيه زميل ثالث يحمل تفويض الاعتماد المالي'});
  const note=v.text(input.note,'سبب القرار',3000,3),decision=action==='approve'?'approved':'rejected';
  if(decision==='approved'&&accountState(db,x).live.length)refuse(409,'account_allocations_live',{what:'انخصّص من القبض بعد طلب العكس، فما ينعكس وهو قائم على استحقاقات',
    missing:[{doc_key:'allocations',document:'التخصيصات القائمة من هالقبض',why:'تنعكس أولًا فترجع الذمة',...APPROVER}],next:'اعكس التخصيصات ثم قرر في الطلب'});
  db.prepare('UPDATE ar_account_reversals SET status=?,decided_by=?,decision_note=?,decided_at=? WHERE id=?').run(decision,u.id,note,now(),r.id);
  audit(db,u,'account_receipt',x.id,'account_receipt.reversal_'+decision,{status:'pending'},{reversal_id:r.id,status:decision},note);
  return accountView(db,u,accountRow(db,u,x.id));
}
// قارئ واحد لسجلات التسوية بنوعها، لإعادة الطلب نفسه بمفتاح التكرار (app/server.mjs once) ولمن يفتح السجل بمعرّفه.
export function getReceivableRecord(db,supplied,kind,id){
  const u=actor(db,supplied);
  if(kind==='account_receipt')return accountView(db,u,accountRow(db,u,id));
  if(kind==='adjustment')return adjustmentView(db,adjustmentRow(db,u,id));
  const scoped=(table,label)=>{const row=typeof id==='string'&&db.prepare(`SELECT t.* FROM ${table} t JOIN ar_claims c ON c.id=t.claim_id WHERE t.id=? AND c.tenant_id=?`).get(id,u.tenant_id);
    if(!row)refuse(404,'not_found',{what:`ما لقينا ${label} بهالمعرّف في كيانك`,next:'حدّث الصفحة وافتحه من استحقاقه'});return row;};
  if(kind==='dispute')return disputeView(db,scoped('ar_disputes','النزاع'));
  if(kind==='promise')return promiseView(db,scoped('ar_promises','الوعد'),today());
  if(kind==='account_reversal'){const row=typeof id==='string'&&db.prepare('SELECT * FROM ar_account_reversals WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
    if(!row)refuse(404,'adjustment_not_found',{what:'ما لقينا طلب العكس هذا في كيانك',next:'حدّث الصفحة وافتحه من القبض'});return accountReversalView(db,row);}
  refuse(404,'not_found',{what:`«${kind}» ما هو من سجلات التحصيل`,next:'السجلات: account_receipt، adjustment، dispute، promise، account_reversal'});
}

/* ───── الدفتر: أنواع المستندات المصدر (app/ledger-sources.mjs) ───── */
// خمسة أنواع جديدة، كلٌّ بقيده من أرقامه وبأثره على الحساب الرقابي بإشارته الطبيعية، فتبقى مطابقة الأستاذ المساعد صفرًا
// بعد أي سلسلة: قبض ← ارتداد ← قبض ثانٍ، وقبض على الحساب ← تخصيص ← عكس التخصيص ← تخصيص ثانٍ، وقبض على الحساب ← ارتداد.
//
// لماذا «دفعات مقدمة من العملاء» (customer_advances) لا غرض جديد: المال على الحساب مالٌ للعميل عند المنشأة لم يُسوِّ ذمة بعد —
// التزامٌ للعميل حتى يُخصَّص على استحقاق أو يرتد، وهو بالحرف معنى الغرض كما عرّفه الدفتر («التزام على المنشأة حتى يُسحب على
// فاتورة لاحقة أو يرتد»). وقيوده بالشكل نفسه تمامًا: القبض (مدين البنك، دائن الدفعات المقدمة)، والتخصيص (مدين الدفعات المقدمة،
// دائن ذمم العملاء) كالسحب على فاتورة، والارتداد (مدين الدفعات المقدمة، دائن البنك). وضريبة المبلغ المقبوض قبل فاتورته قرارٌ
// واحد لمختص ضريبي لم يُتخذ بعد للدفعات المقدمة كلها؛ غرضٌ ثانٍ كان سيفرّق المعالجة الضريبية نفسها على حسابين.
const M='receivables';
const at=(role,actor_id,time,note)=>actor_id?{role,actor_id,at:time??null,...(note?{note}:{})}:null;
const approvalsOf=(...list)=>list.filter(Boolean);
const reversalReference=reference=>`REV-${reference}`.slice(0,170);
const reversalRow=(db,tenantId,id)=>typeof id==='string'?db.prepare("SELECT a.*,r.reference,r.payer FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id JOIN ar_claims c ON c.id=a.claim_id WHERE a.id=? AND a.kind='receipt_reversal' AND c.tenant_id=?").get(id,tenantId)??null:null;
const approvedReversals=(db,tenantId)=>db.prepare("SELECT a.id,a.amount_minor,a.effective_on,r.reference FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id WHERE r.tenant_id=? AND a.kind='receipt_reversal' AND a.status='approved'").all(tenantId);
registerSourceKind({key:'ar_receipt_reversal',name:'ارتداد قبض',module:M,bank:'cash',
  build(db,u,id){
    const a=reversalRow(db,u.tenant_id,id);if(!a||a.status!=='approved')return null;const amount=Number(a.amount_minor);
    return {date:a.effective_on,reference:reversalReference(a.reference),description:`ارتداد القبض ${a.reference} — ${a.payer}`.slice(0,900),
      lines:[['receivable',amount,0,'رجوع ذمة العميل بعد ارتداد القبض'],['bank',0,amount,'المبلغ اللي رجع من البنك']]};
  },
  pending:(db,tenantId)=>approvedReversals(db,tenantId).map(a=>({source_id:a.id,reference:reversalReference(a.reference),amount_minor:Number(a.amount_minor),date:a.effective_on})),
  controls:{receivable:(db,tenantId)=>approvedReversals(db,tenantId).map(a=>({source_id:a.id,reference:reversalReference(a.reference),date:a.effective_on,amount_minor:Number(a.amount_minor)}))},
  document:(db,tenantId,id)=>{const a=reversalRow(db,tenantId,id);return a&&{reference:reversalReference(a.reference),date:a.effective_on,amount_minor:Number(a.amount_minor),status:a.status,description:a.reason};},
  approvals:(db,tenantId,id)=>{const a=reversalRow(db,tenantId,id);return a?approvalsOf(at('طلب العكس',a.requested_by,a.created_at,a.reason),at(a.status==='rejected'?'رفض العكس':'اعتمد العكس',a.decided_by,a.decided_at,a.decision_note)):[];}});

const accountLedgerRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT x.*,k.name AS case_name FROM ar_account_receipts x JOIN commercial_cases k ON k.id=x.case_id WHERE x.id=? AND x.tenant_id=?').get(id,tenantId)??null:null;
const confirmedAccounts=(db,tenantId)=>db.prepare("SELECT id,reference,amount_minor,received_on FROM ar_account_receipts WHERE tenant_id=? AND status='confirmed'").all(tenantId);
registerSourceKind({key:'ar_account_receipt',name:'قبض على حساب العميل',module:M,bank:'cash',
  build(db,u,id){
    const x=accountLedgerRow(db,u.tenant_id,id);if(!x||x.status!=='confirmed')return null;const amount=Number(x.amount_minor);
    return {date:x.received_on,reference:x.reference,description:`قبض على حساب ${x.case_name} ${x.reference} — ${x.payer}`.slice(0,900),
      lines:[['bank',amount,0,'المبلغ المقبوض'],['customer_advances',0,amount,'مال للعميل ما تخصّص على استحقاق للحين']]};
  },
  pending:(db,tenantId)=>confirmedAccounts(db,tenantId).map(x=>({source_id:x.id,reference:x.reference,amount_minor:Number(x.amount_minor),date:x.received_on})),
  controls:{customer_advances:(db,tenantId)=>confirmedAccounts(db,tenantId).map(x=>({source_id:x.id,reference:x.reference,date:x.received_on,amount_minor:Number(x.amount_minor)}))},
  document:(db,tenantId,id)=>{const x=accountLedgerRow(db,tenantId,id);return x&&{reference:x.reference,date:x.received_on,amount_minor:Number(x.amount_minor),status:x.status,description:x.case_name};},
  approvals:(db,tenantId,id)=>{const x=accountLedgerRow(db,tenantId,id);return x?approvalsOf(at('سجّل القبض على الحساب',x.recorded_by,x.created_at),at(x.status==='rejected'?'رفضه':'طابقه وأكّده',x.decided_by,x.decided_at,x.decision_note)):[];}});

const allocationLedgerRow=(db,tenantId,id,kind)=>typeof id==='string'?db.prepare('SELECT y.*,x.reference AS account_reference,x.recorded_by AS account_recorded_by,x.created_at AS account_created_at,x.decided_by AS account_decided_by,x.decided_at AS account_decided_at,k.name AS case_name FROM ar_allocations y JOIN ar_account_receipts x ON x.id=y.account_receipt_id JOIN commercial_cases k ON k.id=x.case_id WHERE y.id=? AND y.tenant_id=? AND y.kind=?').get(id,tenantId,kind)??null:null;
const allocationsOfKind=(db,tenantId,kind)=>db.prepare('SELECT id,amount_minor,created_at FROM ar_allocations WHERE tenant_id=? AND kind=?').all(tenantId,kind);
const allocationReference=(kind,id)=>`${kind==='allocation'?'ALLOC':'ALLOC-REV'}-${id.slice(0,8)}`;
// التخصيص يسوّي ذمة العميل من ماله على الحساب؛ وعكسه يعيدها. الإشارة على الحسابين: التخصيص يخفض الاثنين، والعكس يرفعهما.
for(const [key,kind,name,sign] of [['ar_allocation','allocation','تخصيص قبض على الحساب',-1],['ar_allocation_reversal','reversal','عكس تخصيص قبض على الحساب',1]]){
  const effect=(db,tenantId)=>allocationsOfKind(db,tenantId,kind).map(y=>({source_id:y.id,reference:allocationReference(kind,y.id),date:riyadhDate(y.created_at),amount_minor:sign*Number(y.amount_minor)}));
  registerSourceKind({key,name,module:M,
    build(db,u,id){
      const y=allocationLedgerRow(db,u.tenant_id,id,kind);if(!y)return null;const amount=Number(y.amount_minor);
      return {date:riyadhDate(y.created_at),reference:allocationReference(kind,y.id),description:`${name} ${y.account_reference} — ${y.case_name}`.slice(0,900),
        lines:kind==='allocation'?[['customer_advances',amount,0,'من مال العميل على الحساب'],['receivable',0,amount,'تسوية ذمة العميل على الاستحقاق']]
          :[['receivable',amount,0,'رجوع ذمة العميل بعد عكس التخصيص'],['customer_advances',0,amount,'رجوع المبلغ على حساب العميل']]};
    },
    pending:(db,tenantId)=>allocationsOfKind(db,tenantId,kind).map(y=>({source_id:y.id,reference:allocationReference(kind,y.id),amount_minor:Number(y.amount_minor),date:riyadhDate(y.created_at)})),
    controls:{customer_advances:effect,receivable:effect},
    document:(db,tenantId,id)=>{const y=allocationLedgerRow(db,tenantId,id,kind);return y&&{reference:allocationReference(kind,y.id),date:riyadhDate(y.created_at),amount_minor:Number(y.amount_minor),
      status:kind==='allocation'?(db.prepare('SELECT 1 FROM ar_allocations WHERE reverses_id=?').get(y.id)?'reversed':'allocated'):'recorded',description:y.note};},
    approvals:(db,tenantId,id)=>{const y=allocationLedgerRow(db,tenantId,id,kind);return y?approvalsOf(at('سجّل القبض على الحساب',y.account_recorded_by,y.account_created_at),
      at('طابقه وأكّده',y.account_decided_by,y.account_decided_at),at(kind==='allocation'?'خصّصه على الاستحقاق':'عكس التخصيص',y.allocated_by,y.created_at,y.note)):[];}});
}

const accountReversalLedgerRow=(db,tenantId,id)=>typeof id==='string'?db.prepare('SELECT v.*,x.reference,x.payer,k.name AS case_name FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id JOIN commercial_cases k ON k.id=x.case_id WHERE v.id=? AND v.tenant_id=?').get(id,tenantId)??null:null;
const approvedAccountReversals=(db,tenantId)=>db.prepare("SELECT v.id,v.amount_minor,v.effective_on,x.reference FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE v.tenant_id=? AND v.status='approved'").all(tenantId);
registerSourceKind({key:'ar_account_reversal',name:'ارتداد قبض على الحساب',module:M,bank:'cash',
  build(db,u,id){
    const r=accountReversalLedgerRow(db,u.tenant_id,id);if(!r||r.status!=='approved')return null;const amount=Number(r.amount_minor);
    return {date:r.effective_on,reference:reversalReference(r.reference),description:`ارتداد القبض على حساب ${r.case_name} ${r.reference} — ${r.payer}`.slice(0,900),
      lines:[['customer_advances',amount,0,'خروج المبلغ من حساب العميل'],['bank',0,amount,'المبلغ اللي رجع من البنك']]};
  },
  pending:(db,tenantId)=>approvedAccountReversals(db,tenantId).map(r=>({source_id:r.id,reference:reversalReference(r.reference),amount_minor:Number(r.amount_minor),date:r.effective_on})),
  controls:{customer_advances:(db,tenantId)=>approvedAccountReversals(db,tenantId).map(r=>({source_id:r.id,reference:reversalReference(r.reference),date:r.effective_on,amount_minor:-Number(r.amount_minor)}))},
  document:(db,tenantId,id)=>{const r=accountReversalLedgerRow(db,tenantId,id);return r&&{reference:reversalReference(r.reference),date:r.effective_on,amount_minor:Number(r.amount_minor),status:r.status,description:r.reason};},
  approvals:(db,tenantId,id)=>{const r=accountReversalLedgerRow(db,tenantId,id);return r?approvalsOf(at('طلب العكس',r.requested_by,r.created_at,r.reason),at(r.status==='rejected'?'رفض العكس':'اعتمد العكس',r.decided_by,r.decided_at,r.decision_note)):[];}});

/* ───── الروابط: من المستند إلى ما سوّاه وما عكسه ───── */
const link=(from,role,list)=>registerSourceLink({from,role,module:M,list});
const receiptItem=r=>({kind:'ar_receipt',id:r.id,reference:r.reference,date:r.received_on,amount_minor:Number(r.amount_minor),status:r.status});
const reversalItem=a=>({kind:'ar_receipt_reversal',id:a.id,reference:reversalReference(a.reference),date:a.effective_on??riyadhDate(a.created_at),amount_minor:Number(a.amount_minor),status:a.status});
const allocationItem=(db,y)=>({kind:y.kind==='allocation'?'ar_allocation':'ar_allocation_reversal',id:y.id,reference:allocationReference(y.kind,y.id),date:riyadhDate(y.created_at),amount_minor:Number(y.amount_minor),
  status:y.kind==='allocation'?(db.prepare('SELECT 1 FROM ar_allocations WHERE reverses_id=?').get(y.id)?'reversed':'allocated'):'recorded'});
const accountItem=x=>({kind:'ar_account_receipt',id:x.id,reference:x.reference,date:x.received_on,amount_minor:Number(x.amount_minor),status:x.status});
const invoiceItem=d=>({kind:'tax_invoice',id:d.id,reference:d.number,date:riyadhDate(d.issued_at),amount_minor:d.total_minor,status:d.status});
// الفاتورة: ما سوّاها أو فكّ تسويتها على استحقاقها — ارتداد القبض، والتخصيص وعكسه (القبض المباشر يربطه app/ledger.mjs).
link('tax_invoice','settlement',(db,tenantId,id)=>{
  const d=db.prepare("SELECT claim_id FROM tax_invoices WHERE id=? AND tenant_id=? AND kind='invoice'").get(id,tenantId);if(!d)return [];
  return [...db.prepare("SELECT a.*,r.reference FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id WHERE a.claim_id=? AND r.tenant_id=? AND a.kind='receipt_reversal' AND a.status<>'rejected' ORDER BY a.created_at,a.rowid").all(d.claim_id,tenantId).map(reversalItem),
    ...db.prepare('SELECT * FROM ar_allocations WHERE claim_id=? AND tenant_id=? ORDER BY created_at,rowid').all(d.claim_id,tenantId).map(y=>allocationItem(db,y))];
});
link('ar_receipt','reversal',(db,tenantId,id)=>db.prepare("SELECT a.*,r.reference FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id WHERE a.receipt_id=? AND r.tenant_id=? AND a.kind='receipt_reversal' AND a.status<>'rejected' ORDER BY a.created_at,a.rowid").all(id,tenantId).map(reversalItem));
link('ar_receipt_reversal','settles',(db,tenantId,id)=>{const a=reversalRow(db,tenantId,id);return a?db.prepare('SELECT * FROM ar_receipts WHERE id=? AND tenant_id=?').all(a.receipt_id,tenantId).map(receiptItem):[];});
link('ar_account_receipt','settlement',(db,tenantId,id)=>db.prepare('SELECT * FROM ar_allocations WHERE account_receipt_id=? AND tenant_id=? ORDER BY created_at,rowid').all(id,tenantId).map(y=>allocationItem(db,y)));
link('ar_account_receipt','reversal',(db,tenantId,id)=>db.prepare("SELECT v.*,x.reference FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE v.account_receipt_id=? AND v.tenant_id=? AND v.status<>'rejected' ORDER BY v.created_at,v.rowid").all(id,tenantId)
  .map(v=>({kind:'ar_account_reversal',id:v.id,reference:reversalReference(v.reference),date:v.effective_on,amount_minor:Number(v.amount_minor),status:v.status})));
const allocationSettles=(db,tenantId,y)=>y?[...db.prepare("SELECT * FROM tax_invoices WHERE claim_id=? AND tenant_id=? AND kind='invoice' AND status='issued' ORDER BY chain_index").all(y.claim_id,tenantId).map(invoiceItem),
  ...db.prepare('SELECT * FROM ar_account_receipts WHERE id=? AND tenant_id=?').all(y.account_receipt_id,tenantId).map(accountItem)]:[];
link('ar_allocation','settles',(db,tenantId,id)=>allocationSettles(db,tenantId,db.prepare("SELECT * FROM ar_allocations WHERE id=? AND tenant_id=? AND kind='allocation'").get(id,tenantId)));
link('ar_allocation','reversal',(db,tenantId,id)=>db.prepare("SELECT * FROM ar_allocations WHERE reverses_id=? AND tenant_id=?").all(id,tenantId).map(y=>allocationItem(db,y)));
link('ar_allocation_reversal','settles',(db,tenantId,id)=>db.prepare("SELECT o.* FROM ar_allocations y JOIN ar_allocations o ON o.id=y.reverses_id WHERE y.id=? AND y.tenant_id=?").all(id,tenantId).map(o=>allocationItem(db,o)));
link('ar_account_reversal','settles',(db,tenantId,id)=>db.prepare('SELECT x.* FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE v.id=? AND v.tenant_id=?').all(id,tenantId).map(accountItem));
