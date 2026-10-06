import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { financeReferenceAction, financeCapabilities } from './finance.mjs';
import { controlReconciliation } from './ledger.mjs';
import { sourceKinds } from './ledger-sources.mjs';
import { registerAdoption, adopted } from './options.mjs';
import { personName } from './people-read.mjs';
// قسط الإطفاء المعتمد نوعٌ يسجّل نفسه من وحدته (amortization_entry)؛ فحص «مستندات الشهر» يقرأ كل نوع مسجَّل، فتُحمَّل هنا.
import './accruals.mjs';

// قائمة الإقفال الشهري. قفل القيود نفسه موجود أصلًا في app/finance.mjs (finance_periods.status و openPeriod)،
// فهذه الوحدة لا تبني قفلًا ثانيًا: تربط فترة الإقفال بفترة محاسبية، وعند اعتماد الإقفال تقفلها هناك.
// قوالب المهام يضعها مالك الإجراء. المنصة لا تعرف قائمة مهام محاسبية لهذه الشركة ولا تخترع واحدة.
//
// الحزمة 3: المهام نصٌّ حر، فاعتمادها وحده كان يقفل شهرًا فيه قيدٌ غير مرحّل وحسابٌ بنكي بلا تسوية (المسبار على 3d1d84c).
// اعتماد الإقفال يشغّل الآن أربعة فحوص تُحسب من الدفتر نفسه (closeChecks)، ويرفض مسمّيًا كل بند ومالكه. وفتح الإقفال المعتمد
// يفتح الفترة المحاسبية معه بسجل فتح مستقل (finance_period_reopenings، الترحيل 168): طالبٌ غير من أقفل، ومقرِّرٌ ثالث يحمل
// سلطة إقفال الدفتر، وموعدٌ لإعادة الإقفال يقرّره المالك. وإعادة الإقفال هي اعتماد الإقفال نفسه بفحوصه نفسها.
export const PERIOD_STATUS={open:'مفتوح',approved:'معتمد ومقفل'};
// شهر اعتُمد بلا فترة محاسبية مربوطة: قفل القيود لم يحدث، والدفتر ما زال يقبل قيدًا بتاريخه. تسميته «معتمد ومقفل»
// كانت تقول للقارئ عكس ما في الدفتر — وapp/accruals.mjs يعامله مقفلًا فيردّ القسط، فيخرج النظامان بجوابين متناقضين.
export const APPROVED_UNLOCKED='معتمد — القيود غير مقفلة';
export const TASK_STATUS={open:'مفتوحة',done:'منفذة بدليل'};
const id=()=>randomUUID();
const pad=n=>String(n).padStart(2,'0');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plusDays=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const decimal=minor=>`${minor<0?'-':''}${Math.floor(Math.abs(minor)/100)}.${String(Math.abs(minor)%100).padStart(2,'0')}`;
const name=personName;
const monthKey=value=>{
  if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))fail(400,'invalid_month','الشهر بصيغة 2026-09');
  return value;
};
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${pad(new Date(Date.UTC(y,m,0)).getUTCDate())}`;};

/* ───── موعد إعادة إقفال الشهر بعد فتحه: قرار المالك ───── */
// كم يومًا يبقى دفتر شهرٍ مقفل منفتحًا بعد اعتماد فتحه؟ ليس للمنصة أن تخترع رقمًا: القيمة مسجّلة بلا رقم ({days:null})،
// وما دامت كذلك يُرفض اعتماد أي فتحٍ يفتح الدفتر برفضٍ يسمّي القرار ومالكه. والشكل كائنٌ لأن واصف القيمة لا يقبل null رقمًا.
export const RECLOSE_DAYS='finance.reopen_reclose_days';
registerAdoption({key:RECLOSE_DAYS,label:'مهلة إعادة إقفال الشهر بعد فتحه',module:'close',
  owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري',owner_role:'finance',manage_capability:'finance.close.manage',
  governance:'managed',shape:'object',default:{days:null},
  basis:'ما قرّرها أحد بعد، والمنصة ما تخترع رقمًا: حتى يقرّرها المالك ويعتمدها شخص ثانٍ ما ينفتح دفتر شهر مقفل. القيمة {"days": عدد صحيح من 0 إلى 365} تُحسب من يوم اعتماد الفتح'});
export function recloseDays(db,tenantId,date=today()){
  const decision=adopted(db,tenantId,RECLOSE_DAYS,date),days=decision.value?.days;
  return {days:Number.isInteger(days)&&days>=0&&days<=365?days:null,decision};
}

/* ───── فحوص الإقفال المحسوبة ───── */
// أربعة فحوص لكل إقفال، تُحسب من الدفتر وقت القراءة ووقت الاعتماد، وتُعرض كلها على الشاشة نجحت أو لم تنجح.
export const CHECKS=Object.freeze({journals:'قيود الشهر كلها مرحّلة',sources:'مستندات الشهر كلها مقيّدة ومرحّلة',
  bank:'كل حساب بنكي نشط مطابق لين آخر الشهر',controls:'الحسابات الرقابية مطابقة لأستاذها المساعد في آخر الشهر'});
const CHECK_RULES={
  journals:{owner:'المالية — من يحمل تفويض اعتماد القيود وترحيلها',why:'قيدٌ بتاريخ داخل الشهر ما انرحّل: ينقفل الدفتر عليه وهو ما دخل القوائم',
    next:'اعتمد القيد ورحّله من «الدفتر المالي»، أو ارفضه بسببه'},
  sources:{owner:'المالية — من يحمل تفويض إعداد القيود',why:'مستندٌ نهائي بتاريخ داخل الشهر ما له قيد مرحّل: أثره ما وصل الدفتر',
    next:'جهّز قيده من «القوائم المالية والترحيل»، ويعتمده ويرحّله غيرك'},
  bank:{owner:'المالية — من يحمل تصريح المطابقة البنكية وتسويتها',why:'حسابٌ بنكي تحرّك لين آخر الشهر وما له تسوية معتمدة تغطي آخر يوم فيه',
    next:'استورد كشف الشهر وطابقه وأعدّ تسويته لين آخر الشهر، ويعتمدها غيرك في «المطابقة البنكية»'},
  controls:{owner:'المالية — من يحمل تصريح إدارة الإقفال الشهري',why:'فرقٌ بين الحساب الرقابي وأستاذه المساعد في آخر الشهر ما له تفسير مكتوب على هذا الإقفال',
    next:'عالج البند بمستنده وقيده، أو اكتب تفسيره على هذا الإقفال فيقرؤه المعتمد'}};
const JOURNAL_STATES={draft:'مسودة',pending:'ينتظر الاعتماد',approved:'معتمد وما انرحّل'};
const check=(key,items,extra={})=>({key,name:CHECKS[key],passed:items.every(i=>i.passed),owner:CHECK_RULES[key].owner,owner_role:'finance',
  why:CHECK_RULES[key].why,next:CHECK_RULES[key].next,items,...extra});
// قيد كل مستند من رابطه كما يقرؤه الدفتر: finance_source_links، ورابط المستحق القديم لفاتورة المورد.
function linkedStatus(db,tenantId){
  const linked=new Map(db.prepare("SELECT l.source_kind||':'||l.source_id AS key,j.status FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.tenant_id=?").all(tenantId).map(r=>[r.key,r.status]));
  for(const r of db.prepare("SELECT 'supplier_invoice:'||l.payable_id AS key,j.status FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=?").all(tenantId))if(!linked.has(r.key))linked.set(r.key,r.status);
  return linked;
}
function journalsCheck(db,tenantId,{from,to,finance_period_id}){
  const rows=db.prepare(`SELECT id,source_reference,entry_date,status,description FROM finance_journals WHERE tenant_id=? AND status IN ('draft','pending','approved')
    AND (period_id=? OR entry_date BETWEEN ? AND ?) ORDER BY entry_date,id`).all(tenantId,finance_period_id??'',from,to);
  return check('journals',rows.map(j=>({key:`journal:${j.id}`,journal_id:j.id,reference:j.source_reference,date:j.entry_date,status:j.status,status_name:JOURNAL_STATES[j.status],
    label:j.source_reference,text:`قيد ${j.source_reference} بتاريخ ${j.entry_date} — ${JOURNAL_STATES[j.status]}`,passed:false})));
}
function sourcesCheck(db,tenantId,{from,to}){
  const linked=linkedStatus(db,tenantId);
  const rows=sourceKinds().flatMap(def=>def.pending?def.pending(db,tenantId).map(r=>({...r,source_kind:def.key,source_name:def.name})):[])
    .filter(r=>r.date>=from&&r.date<=to&&linked.get(`${r.source_kind}:${r.source_id}`)!=='posted')
    .sort((a,b)=>a.date.localeCompare(b.date)||a.source_kind.localeCompare(b.source_kind));
  return check('sources',rows.map(r=>{const status=linked.get(`${r.source_kind}:${r.source_id}`)??null;
    return {key:`source:${r.source_kind}:${r.source_id}`,source_kind:r.source_kind,source_name:r.source_name,source_id:r.source_id,reference:r.reference,date:r.date,amount_minor:r.amount_minor,journal_status:status,
      label:r.reference,text:`${r.source_name} ${r.reference} بتاريخ ${r.date} (${decimal(r.amount_minor)} ريال) — ${status?`قيده ${JOURNAL_STATES[status]??status}`:'ما له قيد'}`,passed:false};}));
}
function bankCheck(db,tenantId,{to}){
  const accounts=db.prepare('SELECT b.id,b.label,b.gl_account_id,a.code AS gl_code FROM bank_accounts b JOIN finance_accounts a ON a.id=b.gl_account_id WHERE b.tenant_id=? AND b.active=1 ORDER BY b.label').all(tenantId).map(b=>{
    // الحساب الذي ما تحرّك في الدفتر ولا له كشف لين آخر الشهر ما له شهرٌ يُسوّى؛ يُذكر ولا يمنع.
    const active=!!db.prepare("SELECT 1 FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=? AND j.status='posted' AND l.account_id=? AND j.entry_date<=? LIMIT 1").get(tenantId,b.gl_account_id,to)
      ||!!db.prepare("SELECT 1 FROM bank_statement_imports WHERE tenant_id=? AND bank_account_id=? AND status='active' AND period_start<=? LIMIT 1").get(tenantId,b.id,to);
    const covering=db.prepare("SELECT id,period_start,period_end FROM bank_reconciliations WHERE tenant_id=? AND bank_account_id=? AND status='approved' AND period_start<=? AND period_end>=? ORDER BY period_end LIMIT 1").get(tenantId,b.id,to,to);
    const last=db.prepare("SELECT MAX(period_end) AS d FROM bank_reconciliations WHERE tenant_id=? AND bank_account_id=? AND status='approved'").get(tenantId,b.id).d??null;
    return {bank_account_id:b.id,label:b.label,gl_code:b.gl_code,state:!active?'no_activity':covering?'reconciled':'missing',reconciliation_id:covering?.id??null,last_reconciled_to:last};
  });
  return check('bank',accounts.filter(a=>a.state==='missing').map(a=>({key:`bank:${a.bank_account_id}`,bank_account_id:a.bank_account_id,label:a.label,gl_code:a.gl_code,last_reconciled_to:a.last_reconciled_to,
    text:`الحساب ${a.label} (${a.gl_code}) — ${a.last_reconciled_to?`آخر تسوية معتمدة لين ${a.last_reconciled_to}`:'ما له تسوية معتمدة'}، والمطلوب تسوية تغطي ${to}`,passed:false})),{accounts});
}
const explanationsOf=(db,periodId)=>periodId?db.prepare("SELECT * FROM close_explanations WHERE period_id=? AND check_key='controls' ORDER BY created_at,rowid").all(periodId):[];
function controlsCheck(db,tenantId,{to,period_id}){
  const report=controlReconciliation(db,tenantId,to),explanations=explanationsOf(db,period_id),items=[];
  for(const c of report.controls){
    if(!c.mapped){
      // غرضٌ بلا حساب مربوط ومستنداته داخل التاريخ: ما في الدفتر حسابٌ يُطابَق أصلًا، وهذا لا يُفسَّر بل يُربط.
      if(c.documents)items.push({key:`controls:${c.key}:unmapped`,purpose:c.key,purpose_name:c.name,reason:'unmapped',reason_name:'ما له حساب مربوط في الدفتر',amount_minor:c.subledger_minor,
        label:c.name,text:`${c.name}: ${c.documents} مستند وما له حساب مربوط في الدفتر`,explainable:false,explained:false,explanation:null,passed:false});
      continue;
    }
    for(const i of c.items){
      const key=`controls:${c.key}:${i.reason}:${i.source_kind}:${i.source_id??i.journal_id}`;
      const found=explanations.find(e=>e.item_key===key&&e.amount_minor===i.difference_minor)??null;
      items.push({key,purpose:c.key,purpose_name:c.name,reason:i.reason,reason_name:i.reason_name,source_kind:i.source_kind,source_name:i.source_name,source_id:i.source_id,journal_id:i.journal_id,
        reference:i.reference,date:i.date,amount_minor:i.difference_minor,label:i.reference,
        text:`${c.name}: ${i.source_name} ${i.reference} بتاريخ ${i.date} — ${i.reason_name} (فرق ${decimal(i.difference_minor)} ريال)`,
        explainable:true,explained:!!found,explanation:found&&{id:found.id,text:found.explanation,recorded_by:found.recorded_by,recorded_by_name:name(db,found.recorded_by),created_at:found.created_at},passed:!!found});
    }
  }
  return check('controls',items);
}
// الفحوص الأربعة لمدى تاريخين (الشهر) وفترته المحاسبية وإقفاله إن وُجدا. قراءة فقط: لا تكتب شيئًا.
export function closeChecks(db,tenantId,{from,to,finance_period_id=null,period_id=null}){
  const scope={from,to,finance_period_id,period_id};
  const checks=[journalsCheck(db,tenantId,scope),sourcesCheck(db,tenantId,scope),bankCheck(db,tenantId,scope),controlsCheck(db,tenantId,scope)];
  return {from,to,as_of:to,passed:checks.every(c=>c.passed),checks};
}
const scopeOf=period=>({from:`${period.period_key}-01`,to:monthEnd(period.period_key),finance_period_id:period.finance_period_id,period_id:period.id});

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.manage=can(db,u,'finance.close.manage');return u;}
function manager(db,supplied){const u=actor(db,supplied);if(!u.manage)fail(403,'not_permitted','إدارة الإقفال لحامل تصريح finance.close.manage');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الإقفال معاملة قاعدة بيانات');}
function periodRow(db,u,periodId){
  const row=typeof periodId==='string'&&db.prepare('SELECT * FROM close_periods WHERE id=? AND tenant_id=?').get(periodId,u.tenant_id);
  if(!row)fail(404,'not_found','فترة الإقفال غير متاحة');
  return row;
}

function taskView(db,u,task,period){
  const actions=[];
  if(period.status==='open'&&task.status==='open'&&(task.owner_id===u.id||u.manage))actions.push('complete_task');
  if(period.status==='open'&&task.status==='open'&&u.manage)actions.push('reassign_task');
  return {...task,status_name:TASK_STATUS[task.status],owner_name:name(db,task.owner_id),completed_by_name:name(db,task.completed_by),
    overdue:task.status==='open'&&task.due_date<today(),actions};
}
// فتح الدفتر المرتبط بطلب فتح الإقفال، والفتح المعتمد الذي ينتظر إعادة الإقفال.
const ledgerRequest=(db,requestId)=>requestId?db.prepare("SELECT * FROM finance_period_reopenings WHERE close_reopening_id=? AND status='pending'").get(requestId)??null:null;
const openReopening=(db,financePeriodId)=>financePeriodId?db.prepare("SELECT * FROM finance_period_reopenings WHERE period_id=? AND status='approved' AND reclosed_at IS NULL").get(financePeriodId)??null:null;
const reopeningView=(db,r)=>r&&{...r,requested_by_name:name(db,r.requested_by),decided_by_name:name(db,r.decided_by),previous_closed_by_name:name(db,r.previous_closed_by),reclosed_by_name:name(db,r.reclosed_by),
  overdue:r.status==='approved'&&!r.reclosed_at&&r.reclose_due_on<today()};
const ledgerAuthority=(db,u)=>financeCapabilities(db,u).includes('configure');
function periodView(db,u,period){
  const tasks=db.prepare('SELECT * FROM close_tasks WHERE period_id=? ORDER BY due_date,title').all(period.id).map(t=>taskView(db,u,t,period));
  const financePeriod=period.finance_period_id?db.prepare('SELECT id,name,starts_on,ends_on,status,closed_by FROM finance_periods WHERE id=?').get(period.finance_period_id):null;
  const open=tasks.filter(t=>t.status==='open').length;
  const checks=closeChecks(db,u.tenant_id,scopeOf(period));
  const explanations=explanationsOf(db,period.id).map(e=>({...e,recorded_by_name:name(db,e.recorded_by)}));
  // من نفّذ مهمة أو فسّر فرقًا في الفترة ينفّذ فيها، فلا يعتمد إقفالها.
  const executors=new Set([...tasks.filter(t=>t.completed_by).map(t=>t.completed_by),...explanations.map(e=>e.recorded_by)]);
  const reopenings=db.prepare('SELECT * FROM close_reopenings WHERE period_id=? ORDER BY created_at').all(period.id)
    .map(r=>({...r,requested_by_name:name(db,r.requested_by),approved_by_name:name(db,r.approved_by),previous_approved_by_name:name(db,r.previous_approved_by)}));
  const pendingReopen=reopenings.find(r=>r.status==='pending')??null;
  const pendingLedger=pendingReopen?ledgerRequest(db,pendingReopen.id):null,waiting=openReopening(db,period.finance_period_id);
  const ledgerReopenings=period.finance_period_id?db.prepare('SELECT * FROM finance_period_reopenings WHERE period_id=? ORDER BY created_at,rowid').all(period.finance_period_id).map(r=>reopeningView(db,r)):[];
  const ledgerCloser=financePeriod?.status==='closed'?financePeriod.closed_by:null;
  const actions=[];let reopenBlocked=null;
  if(period.status==='open'&&u.manage)actions.push('add_task');
  // من فتح الفترة أو نفّذ فيها مهمة أو فسّر فيها فرقًا لا يعتمد إقفالها. الفحوص تُحسب وقت الاعتماد، ورفضها يسمّي كل بند.
  if(period.status==='open'&&u.manage&&!open&&tasks.length&&period.opened_by!==u.id&&!executors.has(u.id))actions.push('approve_close');
  if(period.status==='open'&&u.manage&&checks.checks.find(c=>c.key==='controls').items.some(i=>i.explainable&&!i.explained))actions.push('explain_exception');
  // من اعتمد الإقفال أو أقفل الدفتر لا يطلب فتحه.
  if(period.status==='approved'&&u.manage&&!pendingReopen&&period.approved_by!==u.id&&ledgerCloser!==u.id)actions.push('request_reopen');
  if(pendingReopen&&u.manage&&pendingReopen.requested_by!==u.id&&pendingReopen.previous_approved_by!==u.id&&(!ledgerCloser||ledgerCloser!==u.id)){
    // فتح الدفتر يحتاج سلطة إقفاله نفسها (تفويض configure في الدفتر المالي): من لا يحملها يرفض الطلب ولا يعتمده.
    if(!ledgerCloser||ledgerAuthority(db,u))actions.push('approve_reopen');else reopenBlocked='ledger_authority';
    actions.push('reject_reopen');
  }
  const failing=checks.checks.filter(c=>!c.passed);
  const deadline=recloseDays(db,u.tenant_id);
  // صاحب مهمة بلا تصريح الإقفال يرى الفحوص ونتيجتها ولا يرى بنودها: البنود قيودٌ ومستندات ومبالغ من الدفتر، وقراءتها لمن يديره.
  const shown=u.manage?checks:{...checks,checks:checks.checks.map(({items,accounts,...c})=>({...c,items:[],hidden_items:items.filter(i=>!i.passed).length}))};
  return {...period,status_name:period.status==='approved'&&!period.ledger_locked?APPROVED_UNLOCKED:PERIOD_STATUS[period.status],ledger_locked:!!period.ledger_locked,opened_by_name:name(db,period.opened_by),approved_by_name:name(db,period.approved_by),
    finance_period:financePeriod&&{id:financePeriod.id,name:financePeriod.name,starts_on:financePeriod.starts_on,ends_on:financePeriod.ends_on,status:financePeriod.status},
    tasks,open_tasks:open,done_tasks:tasks.length-open,overdue_tasks:tasks.filter(t=>t.overdue).length,
    checks:shown,explanations:u.manage?explanations:[],reopenings,pending_reopen:pendingReopen,
    ledger_reopenings:ledgerReopenings,ledger_reopening:reopeningView(db,pendingLedger??waiting),
    reclose_deadline:{key:RECLOSE_DAYS,label:deadline.decision.label,days:deadline.days,owner:deadline.decision.owner,source:deadline.decision.source},
    reopen_blocked:reopenBlocked,actions,
    blocked_reason:period.status==='open'&&!tasks.length?'لا مهام في هذه الفترة. الإقفال لا يُعتمد بقائمة فارغة.':
      period.status==='open'&&open?`${open} مهمة لم تُنفذ بعد.`:
      period.status==='open'&&(period.opened_by===u.id||executors.has(u.id))?'من فتح الفترة أو نفّذ فيها مهمة أو فسّر فيها فرقًا لا يعتمد إقفالها؛ يعتمده شخص آخر.':
      period.status==='open'&&failing.length?`فحوص الإقفال ما عدّت: ${failing.map(c=>c.name).join('، ')}. الاعتماد يُرفض ويسمّي كل بند ومالكه.`:''};
}

export function closeBoard(db,supplied){
  const u=actor(db,supplied);
  const rows=db.prepare(`SELECT DISTINCT p.* FROM close_periods p ${u.manage?'':'JOIN close_tasks t ON t.period_id=p.id AND t.owner_id=?'}
    WHERE p.tenant_id=? ORDER BY p.period_key DESC`).all(...(u.manage?[u.tenant_id]:[u.id,u.tenant_id])).map(p=>periodView(db,u,p));
  const templates=u.manage?db.prepare('SELECT * FROM close_task_templates WHERE tenant_id=? ORDER BY active DESC,due_day,title').all(u.tenant_id)
    .map(t=>({...t,active:!!t.active,owner_name:name(db,t.owner_id),actions:[t.active?'deactivate_template':'activate_template']})):[];
  const inbox=rows.flatMap(p=>[
    ...p.tasks.filter(t=>t.owner_id===u.id&&t.status==='open').map(t=>({id:t.id,title:`${t.title} — إقفال ${p.period_key}`,due_date:t.due_date,created_at:t.created_at,actions:['complete_task']})),
    // الشهر المفتوح بفتحٍ معتمد يُعاد إقفاله بموعده: الموعد هو موعد البند، فيُقرأ متأخرًا إن فات.
    ...(p.actions.includes('approve_close')?[{id:p.id,title:p.ledger_reopening?.status==='approved'?`إعادة إقفال ${p.period_key} بعد فتحه`:`اعتماد إقفال ${p.period_key}`,
      due_date:p.ledger_reopening?.status==='approved'?p.ledger_reopening.reclose_due_on:monthEnd(p.period_key),created_at:p.created_at,actions:['approve_close']}]:[]),
    ...(p.actions.includes('approve_reopen')?[{id:p.id,title:`طلب فتح إقفال ${p.period_key}`,due_date:null,created_at:p.pending_reopen.created_at,actions:['approve_reopen']}]:[])]);
  return {today:today(),user_id:u.id,can_manage:u.manage,period_status:PERIOD_STATUS,task_status:TASK_STATUS,
    periods:rows,templates,inbox,
    people:u.manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[],
    finance_periods:u.manage?db.prepare("SELECT id,name,starts_on,ends_on,status FROM finance_periods WHERE tenant_id=? AND status='open' ORDER BY starts_on DESC").all(u.tenant_id):[],
    note:'قائمة الإقفال تبدأ فارغة: مالك الإجراء هو من يضع مهامها؛ المنصة لا تقترح مهام محاسبية جاهزة. '+
      'قفل القيود ليس جديدًا هنا — هو قفل الفترة المحاسبية القائم في الدفتر المالي، وهذه الشاشة تشغّله عند اعتماد الإقفال إن رُبطت فترة محاسبية. '+
      'من ينفّذ مهمة لا يعتمد الإقفال، والمعتمد لا يُفتح إلا بطلب مسبب يعتمده شخص ثالث ويبقى أثره في السجل.'};
}
// القراءة بالمعرّف تتبع قاعدة اللوحة نفسها: حامل تصريح الإقفال، أو من له مهمة في الفترة. غيرهما لا يعرف أنها موجودة.
export function getClosePeriod(db,supplied,periodId){
  const u=actor(db,supplied),row=periodRow(db,u,periodId);
  if(!u.manage&&!db.prepare('SELECT 1 FROM close_tasks WHERE period_id=? AND owner_id=?').get(row.id,u.id))fail(404,'not_found','فترة الإقفال غير متاحة');
  return periodView(db,u,row);
}

export function createTemplate(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['title','owner_id','due_day','basis']);
  if(!Number.isInteger(input.due_day)||input.due_day<1||input.due_day>28)fail(400,'due_day','يوم الاستحقاق من 1 إلى 28 من الشهر التالي للفترة');
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك المهمة غير متاح');
  const title=v.text(input.title,'المهمة',200,5);
  if(db.prepare('SELECT 1 FROM close_task_templates WHERE tenant_id=? AND title=?').get(u.tenant_id,title))fail(409,'duplicate_template','القالب مسجل');
  const templateId=id(),time=now();
  db.prepare('INSERT INTO close_task_templates(id,tenant_id,title,owner_id,due_day,basis,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(templateId,u.tenant_id,title,owner.id,input.due_day,v.text(input.basis,'لماذا هذه المهمة ومن قررها',1500,10),u.id,time,time);
  audit(db,u,'close_template',templateId,'close.template.created',{}, {title,owner_id:owner.id,due_day:input.due_day});
  return {id:templateId};
}
export function templateAction(db,supplied,templateId,action,input){
  writing(db);const u=manager(db,supplied);
  if(!['activate_template','deactivate_template'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const row=typeof templateId==='string'&&db.prepare('SELECT * FROM close_task_templates WHERE id=? AND tenant_id=?').get(templateId,u.tenant_id);
  if(!row)fail(404,'not_found','القالب غير متاح');
  v.version(input.version,row.version);
  const active=action==='activate_template'?1:0;
  if(active===row.active)fail(409,'invalid_state','القالب في هذه الحالة أصلًا');
  db.prepare('UPDATE close_task_templates SET active=?,version=version+1,updated_at=? WHERE id=?').run(active,now(),row.id);
  audit(db,u,'close_template',row.id,'close.template.'+action,{active:row.active},{active},v.text(input.note,'السبب',1000,3));
  return {id:row.id};
}

export function openClosePeriod(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['period_key','finance_period_id']);
  const month=monthKey(input.period_key);
  if(month>today().slice(0,7))fail(400,'future_period','لا يُفتح إقفال لشهر لم يبدأ');
  if(db.prepare('SELECT 1 FROM close_periods WHERE tenant_id=? AND period_key=?').get(u.tenant_id,month))fail(409,'period_exists','للشهر فترة إقفال قائمة');
  let financePeriodId=null;
  if(input.finance_period_id){
    const period=db.prepare("SELECT * FROM finance_periods WHERE id=? AND tenant_id=? AND status='open'").get(input.finance_period_id,u.tenant_id);
    if(!period)fail(404,'finance_period','الفترة المحاسبية غير متاحة أو مقفلة أصلًا');
    // «تساوي» لا «تغطي»: اعتماد الإقفال يقفل الفترة المحاسبية المربوطة كلها، وقفلها لا رجعة فيه — finance_period_identity
    // لا يسمح إلا بانتقال open→closed، وfinance_periods_no_delete يمنع الحذف، ولا مسار إعادة فتح في المنصة ولا في القاعدة.
    // فربط شهر بفترة أوسع منه (فترة سنة مثلًا) كان يقفل بقية أشهرها معه إلى الأبد. الحارس مكرر في الترحيل 150.
    if(period.starts_on!==`${month}-01`||period.ends_on!==monthEnd(month))
      fail(409,'finance_period_scope',`الفترة المحاسبية «${period.name}» تمتد من ${period.starts_on} إلى ${period.ends_on}، واعتماد إقفال ${month} يقفلها كلها بلا رجعة. أنشئ فترة محاسبية شهرية من ${month}-01 إلى ${monthEnd(month)} واربط الشهر بها، أو اتركه بلا فترة محاسبية فلا تُقفل قيوده`);
    financePeriodId=period.id;
  }
  const periodId=id(),time=now();
  db.prepare('INSERT INTO close_periods(id,tenant_id,period_key,finance_period_id,opened_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(periodId,u.tenant_id,month,financePeriodId,u.id,time,time);
  // المهام تُنسخ من القوالب السارية لحظة الفتح، فتبقى الفترة شاهدة على قائمة يومها ولو تغيّر القالب بعدها.
  let created=0;
  for(const t of db.prepare('SELECT * FROM close_task_templates WHERE tenant_id=? AND active=1 ORDER BY due_day,title').all(u.tenant_id)){
    const [year,m]=month.split('-').map(Number),due=m===12?`${year+1}-01-${pad(t.due_day)}`:`${year}-${pad(m+1)}-${pad(t.due_day)}`;
    db.prepare('INSERT INTO close_tasks(id,tenant_id,period_id,template_id,title,owner_id,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,periodId,t.id,t.title,t.owner_id,due,u.id,time,time);
    created++;
  }
  audit(db,u,'close_period',periodId,'close.period.opened',{}, {period_key:month,tasks:created,finance_period_id:financePeriodId});
  return {id:periodId,tasks:created};
}

export function taskAction(db,supplied,taskId,action,input){
  writing(db);const u=actor(db,supplied);
  if(!['complete_task','reassign_task'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  const task=typeof taskId==='string'&&db.prepare('SELECT * FROM close_tasks WHERE id=? AND tenant_id=?').get(taskId,u.tenant_id);
  if(!task)fail(404,'not_found','المهمة غير متاحة');
  const period=periodRow(db,u,task.period_id),current=taskView(db,u,task,period);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة المهمة أو لحسابك');
  const time=now();
  if(action==='complete_task'){
    v.object(input,['version','evidence']);v.version(input.version,task.version);
    db.prepare("UPDATE close_tasks SET status='done',evidence=?,completed_by=?,completed_at=?,version=version+1,updated_at=? WHERE id=?")
      .run(v.text(input.evidence,'دليل التنفيذ: ماذا فعلت وأين حُفظ الدليل',2000,5),u.id,time,time,task.id);
  }else{
    v.object(input,['version','owner_id','note']);v.version(input.version,task.version);
    const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
    if(!owner)fail(400,'owner_id','المالك غير متاح');
    v.text(input.note,'سبب النقل',1000,3);
    db.prepare('UPDATE close_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=?').run(owner.id,time,task.id);
  }
  audit(db,u,'close_task',task.id,'close.task.'+action,{status:task.status,owner_id:task.owner_id},{period_key:period.period_key},input.note??'');
  return getClosePeriod(db,u,period.id);
}

// فتح الإقفال يفتح الدفتر معه: الطلب يحمل سجل فتح للفترة المحاسبية المقفلة بنسختها ومن أقفلها، والقرار يقع عليهما معًا.
// طلبٌ سبق الترحيل 168 بلا سجل فتح للدفتر يُكتب له سجله عند القرار بطالبه وسببه نفسيهما، فلا يبقى شهرٌ مفتوح ودفتره مقفل.
function ledgerFor(db,u,period,request,{create=true}={}){
  const pending=ledgerRequest(db,request.id);
  if(pending||!create)return pending;
  const fp=period.finance_period_id?db.prepare('SELECT * FROM finance_periods WHERE id=?').get(period.finance_period_id):null;
  if(!fp||fp.status!=='closed')return null;
  if(fp.closed_by===request.requested_by)refuse(409,'ledger_reopen_requester',{what:'طالب الفتح هو اللي أقفل الفترة المحاسبية، فما ينفتح دفترها بطلبه',
    missing:[{document:'طلب فتح من غير اللي أقفل الدفتر',why:'فتح الدفتر ثلاثة أشخاص: من أقفل، ومن يطلب، ومن يقرر',owner:CHECK_RULES.controls.owner,owner_role:'finance'}],
    next:'ارفض هذا الطلب بسببه، ويطلب الفتح زميل ما أقفل الدفتر'});
  const rowId=id();
  db.prepare('INSERT INTO finance_period_reopenings(id,tenant_id,period_id,period_version,close_reopening_id,previous_closed_by,previous_closed_at,previous_close_evidence,requested_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(rowId,u.tenant_id,fp.id,fp.version,request.id,fp.closed_by,fp.closed_at,fp.close_evidence,request.requested_by,request.reason,now());
  return db.prepare('SELECT * FROM finance_period_reopenings WHERE id=?').get(rowId);
}
export function periodAction(db,supplied,periodId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={add_task:['title','owner_id','due_date'],approve_close:['note'],request_reopen:['reason'],approve_reopen:['note'],reject_reopen:['note'],explain_exception:['item_key','note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const period=periodRow(db,u,periodId),current=periodView(db,u,period);
  v.version(input.version,period.version);
  // الرفض المسمّى قبل العام: فتح الدفتر بلا سلطته، وتفسير بندٍ غير موجود أو مفسَّر.
  if(action==='approve_reopen'&&current.reopen_blocked==='ledger_authority')refuse(403,'ledger_reopen_authority',{what:`فتح إقفال ${period.period_key} يفتح الفترة المحاسبية المقفلة، وحسابك ما يحمل سلطة إقفالها`,
    missing:[{document:'تفويض «configure» في الدفتر المالي',why:'من يفتح الدفتر يحمل السلطة نفسها التي تقفله',owner:'مسؤول التفويضات المالية',owner_role:'finance'}],
    next:'ارفض الطلب بسببه، أو اطلب القرار من زميل ثالث يحمل تفويض إقفال الدفتر'});
  if(action==='explain_exception'&&period.status==='open'&&u.manage){
    const item=current.checks.checks.find(c=>c.key==='controls').items.find(i=>i.key===input.item_key);
    if(!item)refuse(404,'exception_not_found',{what:'البند المطلوب تفسيره ما هو من فروق الحسابات الرقابية في هذا الإقفال',next:'افتح فحص الحسابات الرقابية واختر البند من قائمته'});
    if(item.explained)refuse(409,'exception_explained',{what:`البند «${item.label}» مفسَّر بمبلغه نفسه في هذا الإقفال`,next:'التفسير المسجّل يبقى كما هو؛ لو تغيّر المبلغ يصير بندًا جديدًا يُفسَّر'});
    if(!item.explainable)refuse(409,'exception_not_explainable',{what:`«${item.purpose_name}» ما له حساب مربوط في الدفتر، والفرق هنا ما يُفسَّر بل يُربط`,
      missing:[{document:`ربط غرض «${item.purpose_name}» بحساب في الدفتر يعتمده شخص ثانٍ`,why:'بلا حساب ما في رصيد دفتري يُقارن بالأستاذ المساعد',owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'}],
      next:'سجّل الربط من «القوائم المالية والترحيل» ويعتمده زميل'});
  }
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الفترة أو لحسابك. من ينفّذ لا يعتمد، ومن اعتمد لا يفتح');
  const time=now();
  let extra={period_key:period.period_key};
  if(action==='add_task'){
    const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
    if(!owner)fail(400,'owner_id','مالك المهمة غير متاح');
    const title=v.text(input.title,'المهمة',200,5);
    if(db.prepare('SELECT 1 FROM close_tasks WHERE period_id=? AND title=?').get(period.id,title))fail(409,'duplicate_task','المهمة مسجلة في هذه الفترة');
    db.prepare('INSERT INTO close_tasks(id,tenant_id,period_id,title,owner_id,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,period.id,title,owner.id,v.date(input.due_date),u.id,time,time);
    // إضافة مهمة لا تغيّر الفترة نفسها، لكن رقم نسختها يتقدم حتى لا يعتمد أحد قائمة قرأها قبل الإضافة.
    db.prepare('UPDATE close_periods SET version=version+1,updated_at=? WHERE id=?').run(time,period.id);
  }
  if(action==='explain_exception'){
    const item=current.checks.checks.find(c=>c.key==='controls').items.find(i=>i.key===input.item_key);
    const note=v.text(input.note,'تفسير الفرق كما يقرؤه المعتمد',2000,20),rowId=id();
    db.prepare("INSERT INTO close_explanations(id,tenant_id,period_id,check_key,item_key,amount_minor,explanation,recorded_by,created_at) VALUES(?,?,?,'controls',?,?,?,?,?)")
      .run(rowId,u.tenant_id,period.id,item.key,item.amount_minor,note,u.id,time);
    db.prepare('UPDATE close_periods SET version=version+1,updated_at=? WHERE id=?').run(time,period.id);
    extra={...extra,explanation_id:rowId,item_key:item.key,amount_minor:item.amount_minor};
  }
  if(action==='approve_close'){
    // الفحوص تُحسب لحظة الاعتماد لا لحظة فتح الشاشة: ما تغيّر بينهما يُقرأ هنا.
    const checks=closeChecks(db,u.tenant_id,scopeOf(period)),failing=checks.checks.filter(c=>!c.passed);
    if(failing.length)refuse(409,'close_checks_failed',{what:`إقفال ${period.period_key} ما يُعتمد: ${failing.map(c=>c.name).join('، ')} — ما عدّت`,
      missing:failing.flatMap(c=>c.items.filter(i=>!i.passed).map(i=>({document:`${c.name} — ${i.text}`,why:c.why,owner:c.owner,owner_role:c.owner_role}))),
      next:'عالج كل بند عند مالكه، ثم اعتمد الإقفال من جديد؛ الفحوص تنحسب وقت الاعتماد'});
    const note=v.text(input.note,'ما الذي اعتمدته ولماذا',2000,10);
    let locked=0,reclosed=null;
    if(period.finance_period_id){
      const financePeriod=db.prepare('SELECT * FROM finance_periods WHERE id=?').get(period.finance_period_id);
      // لا قفل ثانٍ: القفل هو إقفال الفترة المحاسبية القائم في الدفتر المالي، ويحتاج تفويض configure فيه.
      if(financePeriod.status==='open'){
        // إعادة الإقفال بعد فتحٍ معتمد: يُسجَّل على الفتح من أعاد الإقفال ومتى، ثم يُقفل الدفتر — والقاعدة ترفض إقفال فترةٍ
        // لها فتحٌ معتمد لم يُسجَّل عليه ذلك (الترحيل 168)، فلا تُعاد من باب آخر بلا هذه الفحوص.
        reclosed=openReopening(db,financePeriod.id);
        if(reclosed)db.prepare('UPDATE finance_period_reopenings SET reclosed_by=?,reclosed_at=?,version=version+1 WHERE id=?').run(u.id,time,reclosed.id);
        financeReferenceAction(db,u,'periods',financePeriod.id,'close',{version:financePeriod.version,note:`إقفال شهر ${period.period_key}: ${note}`.slice(0,3000)});
        if(reclosed)audit(db,u,'finance_period_reopening',reclosed.id,'finance_period.reclosed',{status:'open'},{period_id:financePeriod.id,period_key:period.period_key,reclose_due_on:reclosed.reclose_due_on});
      }
      locked=1;
    }
    db.prepare("UPDATE close_periods SET status='approved',approved_by=?,approved_at=?,approval_note=?,ledger_locked=?,version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,note,locked,time,period.id);
    extra={...extra,checks:checks.checks.map(c=>({key:c.key,passed:c.passed,items:c.items.length})),reclosed:!!reclosed};
  }
  if(action==='request_reopen'){
    const reason=v.text(input.reason,'سبب طلب الفتح',2000,10),requestId=id();
    db.prepare('INSERT INTO close_reopenings(id,tenant_id,period_id,previous_approved_by,previous_approved_at,requested_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(requestId,u.tenant_id,period.id,period.approved_by,period.approved_at,u.id,reason,time);
    // الدفتر المقفل ينفتح بطلبه هو: سجل فتح للفترة المحاسبية بنسخة إقفالها ومن أقفلها، بالطالب والسبب نفسيهما.
    const ledger=ledgerFor(db,u,period,{id:requestId,requested_by:u.id,reason});
    if(ledger)audit(db,u,'finance_period_reopening',ledger.id,'finance_period.reopen_requested',{}, {period_id:ledger.period_id,period_version:ledger.period_version,close_reopening_id:requestId},reason);
    db.prepare('UPDATE close_periods SET version=version+1,updated_at=? WHERE id=?').run(time,period.id);
  }
  if(action==='approve_reopen'||action==='reject_reopen'){
    const request=current.pending_reopen,note=v.text(input.note,'أساس القرار',2000,10);
    // الرفض لا يكتب سجل فتحٍ لدفترٍ لم يُطلب فتحه بعد؛ القبول يكتبه لطلبٍ سبق الترحيل 168 بلا سجل.
    const ledger=ledgerFor(db,u,period,request,{create:action==='approve_reopen'});
    let days=null,due=null;
    if(action==='approve_reopen'&&ledger){
      const deadline=recloseDays(db,u.tenant_id);
      if(deadline.days===null)refuse(409,'reclose_deadline_unadopted',{what:`فتح إقفال ${period.period_key} يفتح دفتر شهر مقفل، وموعد إعادة إقفاله ما تقرر للحين`,
        missing:[{document:`قرار «${deadline.decision.label}» (${RECLOSE_DAYS})`,why:'الشهر المفتوح بعد إقفاله يُعاد إقفاله بموعد معروف، والمنصة ما تخترع رقمًا',owner:deadline.decision.owner,owner_role:deadline.decision.owner_role}],
        next:'يسجّل صاحب القرار عدد الأيام بأساسه وتاريخ سريانه ويعتمده زميل ثانٍ، وبعدها يُعتمد الفتح'});
      days=deadline.days;due=plusDays(today(),days);
    }
    db.prepare('UPDATE close_reopenings SET status=?,approved_by=?,approved_at=?,note=?,version=version+1 WHERE id=?')
      .run(action==='approve_reopen'?'approved':'rejected',u.id,time,note,request.id);
    if(ledger)db.prepare('UPDATE finance_period_reopenings SET status=?,decided_by=?,decided_at=?,decision_note=?,reclose_days=?,reclose_due_on=?,version=version+1 WHERE id=?')
      .run(action==='approve_reopen'?'approved':'rejected',u.id,time,note,days,due,ledger.id);
    if(action==='approve_reopen'){
      if(ledger){
        // الدفتر أولًا: علم القفل في الإقفال لا ينزل إلا والفترة المحاسبية منفتحة فعلًا بفتح معتمد (الترحيل 168).
        const fp=db.prepare('SELECT * FROM finance_periods WHERE id=?').get(ledger.period_id);
        db.prepare("UPDATE finance_periods SET status='open',closed_by=NULL,closed_at=NULL,close_evidence=NULL,version=version+1 WHERE id=?").run(fp.id);
        audit(db,u,'finance_periods',fp.id,'reopened',{status:'closed',version:fp.version,closed_by:fp.closed_by,closed_at:fp.closed_at},{status:'open',version:fp.version+1,reopening_id:ledger.id,reclose_due_on:due},note);
      }
      // الفترة تعود مفتوحة للمهام، ويبقى الاعتماد السابق وأثره في السجل.
      db.prepare("UPDATE close_periods SET status='open',approved_by=NULL,approved_at=NULL,approval_note='',ledger_locked=?,reopen_count=reopen_count+1,version=version+1,updated_at=? WHERE id=?")
        .run(ledger?0:period.ledger_locked,time,period.id);
    }else db.prepare('UPDATE close_periods SET version=version+1,updated_at=? WHERE id=?').run(time,period.id);
    extra={...extra,ledger_reopening_id:ledger?.id??null,reclose_due_on:due};
  }
  audit(db,u,'close_period',period.id,'close.'+action,{status:period.status,version:period.version},extra,input.note??input.reason??'');
  return getClosePeriod(db,u,period.id);
}
