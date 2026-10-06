import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { registerSourceKind } from './ledger-sources.mjs';
import { personName } from './people-read.mjs';

// إطفاء المدفوعات المقدمة والاستحقاقات. المحاسب يحدد الفترة، والنظام يولّد جدولًا بقيود **مقترحة** شهرية.
// لا ترحيل آلي: القسط المعتمد هنا مستندٌ في سجل الدفتر (amortization_entry، الحزمة 3) يجهّز قيده المحاسب من «القوائم المالية
// والترحيل»، ويعتمده ويرحّله غيره بتفويضه المستقل. حالة ترحيل القسط تُقرأ من الدفتر نفسه لا من نص ثابت.
// الحسابات يختارها المحاسب من دليل الحسابات؛ الوحدة لا تفترض حسابًا ولا تربطه بغرض محاسبي من عندها.
export const KINDS={
  prepaid:{name:'مدفوع مقدمًا',credit_type:'asset',credit_label:'حساب المصروف المدفوع مقدمًا (أصل)',
    rule:'فاتورة مورد تغطي فترة ممتدة: القيمة أصل عند التسجيل، ويُطفأ منها قسط شهري مصروفًا.'},
  accrual:{name:'استحقاق',credit_type:'liability',credit_label:'حساب المصروف المستحق (التزام)',
    rule:'مصروف تحقق ولم تصل فاتورته: يُعترف به قسطًا شهريًا مصروفًا مقابل التزام مستحق، ويُعكس عند وصول الفاتورة.'}
};
export const ENTRY_STATUS={proposed:'مقترح — بانتظار الاعتماد',approved:'معتمد — قيده يتجهز من الدفتر',cancelled:'ملغى'};
// حالة ترحيل القسط كما هي في الدفتر: ما له قيد، أو قيده في الدفتر ولم يُرحَّل، أو مرحّل، أو رُحّل ثم انعكس.
export const POSTING_STATUS=Object.freeze({not_posted:'ما انرحّل',in_ledger:'قيده في الدفتر وما انرحّل للحين',posted:'مرحّل في الدفتر',reversed:'انرحّل ثم انعكس قيده'});
const id=()=>randomUUID();
const pad=n=>String(n).padStart(2,'0');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const name=personName;
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${pad(new Date(Date.UTC(y,m,0)).getUTCDate())}`;};
const addMonth=month=>{const [y,m]=month.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${pad(m+1)}`;};
const monthsBetween=(from,to)=>{
  const [fy,fm]=from.slice(0,7).split('-').map(Number),[ty,tm]=to.slice(0,7).split('-').map(Number);
  return (ty-fy)*12+(tm-fm)+1;
};

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.manage=can(db,u,'finance.close.manage');return u;}
function manager(db,supplied){const u=actor(db,supplied);if(!u.manage)fail(403,'not_permitted','جداول الإطفاء لحامل تصريح finance.close.manage');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة جدول الإطفاء معاملة قاعدة بيانات');}
function money(value,label){
  if(typeof value!=='string'||!/^(?:[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ موجب بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.');
  return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
// القسط الشهري المتساوي بالهللات، والباقي يُحمَّل على الشهر الأخير حتى يساوي مجموع الأقساط قيمة المستند بالضبط.
export function scheduleAmounts(totalMinor,months){
  const base=Math.floor(totalMinor/months),amounts=Array.from({length:months},()=>base);
  amounts[months-1]+=totalMinor-base*months;
  return amounts;
}

// قيد القسط من الدفتر: رابط المصدر، وحالة القيد، وعكسٌ مرحّل إن وُجد. القراءة لا تكتب شيئًا.
function postingOf(db,entryId){
  const j=db.prepare("SELECT j.id,j.status FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.source_kind='amortization_entry' AND l.source_id=?").get(entryId);
  if(!j)return {posting_status:'not_posted',journal_id:null,journal_status:null};
  const reversed=j.status==='posted'&&!!db.prepare("SELECT 1 FROM finance_reversals x JOIN finance_journals r ON r.id=x.reversal_journal_id WHERE x.original_journal_id=? AND r.status='posted'").get(j.id);
  return {posting_status:reversed?'reversed':j.status==='posted'?'posted':'in_ledger',journal_id:j.id,journal_status:j.status};
}
const POSTING_NOTES={not_posted:'ما له قيد في الدفتر للحين. قيده يتجهز من «القوائم المالية والترحيل» ويعتمده ويرحّله غير اللي جهّزه؛ لا ترحيل آلي من هنا.',
  in_ledger:'قيده في الدفتر ينتظر اعتماده وترحيله من يملك تفويضهما.',posted:'مرحّل في الدفتر بتاريخ آخر الشهر.',reversed:'انرحّل قيده ثم انعكس، فأثره في الدفتر صفر؛ يُعالج بقيد جديد إن لزم.'};
function entryView(db,u,entry,schedule){
  const actions=[];
  // من أعدّ الجدول لا يعتمد قسطه. القسط لا يُعتمد قبل انتهاء شهره.
  if(entry.status==='proposed'&&u.manage&&schedule.prepared_by!==u.id&&schedule.status==='active'&&entry.entry_date<=today())actions.push('approve_entry');
  if(entry.status==='proposed'&&u.manage&&schedule.prepared_by===u.id)actions.push('cancel_entry');
  const posting=postingOf(db,entry.id);
  return {...entry,status_name:ENTRY_STATUS[entry.status],approved_by_name:name(db,entry.approved_by),
    due:entry.status==='proposed'&&entry.entry_date<=today(),actions,
    ...posting,posting_status_name:POSTING_STATUS[posting.posting_status],
    posting_note:entry.status==='approved'?POSTING_NOTES[posting.posting_status]:'قسط مقترح أو ملغى: ما يصير مستندًا للدفتر إلا بعد اعتماده؛ لا ترحيل آلي من هنا.'};
}
function scheduleView(db,u,schedule){
  const entries=db.prepare('SELECT * FROM amortization_entries WHERE schedule_id=? ORDER BY position').all(schedule.id).map(e=>entryView(db,u,e,schedule));
  const approved=entries.filter(e=>e.status==='approved').reduce((n,e)=>n+e.amount_minor,0);
  const accounts=db.prepare('SELECT id,code,name,account_type FROM finance_accounts WHERE id IN (?,?)').all(schedule.debit_account_id,schedule.credit_account_id);
  const actions=[];
  if(schedule.status==='active'&&u.manage&&schedule.prepared_by===u.id)actions.push('cancel_schedule');
  return {...schedule,kind_name:KINDS[schedule.kind].name,kind_rule:KINDS[schedule.kind].rule,status_name:schedule.status==='active'?'ساري':'ملغى',
    prepared_by_name:name(db,schedule.prepared_by),
    debit_account:accounts.find(a=>a.id===schedule.debit_account_id)??null,credit_account:accounts.find(a=>a.id===schedule.credit_account_id)??null,
    entries,approved_minor:approved,remaining_minor:schedule.total_minor-approved,
    due_entries:entries.filter(e=>e.due).length,actions};
}

export function accrualsBoard(db,supplied){
  const u=actor(db,supplied);
  if(!u.manage)fail(403,'not_permitted','جداول الإطفاء لحامل تصريح finance.close.manage');
  const schedules=db.prepare('SELECT * FROM amortization_schedules WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).map(s=>scheduleView(db,u,s));
  return {currency:'SAR',today:today(),user_id:u.id,kinds:KINDS,entry_status:ENTRY_STATUS,schedules,
    totals:{schedules:schedules.length,due_entries:schedules.reduce((n,s)=>n+s.due_entries,0),
      unamortized_minor:schedules.filter(s=>s.status==='active').reduce((n,s)=>n+s.remaining_minor,0)},
    inbox:schedules.flatMap(s=>s.entries.filter(e=>e.actions.includes('approve_entry')).map(e=>({id:e.id,title:`قسط ${e.period_key} — ${s.description}`,due_date:e.entry_date,created_at:e.created_at,actions:['approve_entry']}))),
    invoices:db.prepare(`SELECT i.id,i.supplier_key,i.supplier_reference,i.amount_minor FROM procurement_invoices i WHERE i.tenant_id=?
      AND NOT EXISTS(SELECT 1 FROM amortization_schedules s WHERE s.invoice_id=i.id AND s.status='active') ORDER BY i.created_at DESC`).all(u.tenant_id),
    accounts:db.prepare('SELECT id,code,name,account_type FROM finance_accounts WHERE tenant_id=? AND active=1 ORDER BY code').all(u.tenant_id),
    cost_centers:db.prepare('SELECT id,code,name FROM finance_cost_centers WHERE tenant_id=? AND active=1 ORDER BY code').all(u.tenant_id),
    note:'الأقساط قيود **مقترحة** تُعتمد شهرًا شهرًا ولا تُرحَّل آليًا. الاعتماد هنا يعني «صحيح ومستحق هذا الشهر»، والترحيل يبقى قرارًا مستقلًا في الدفتر المالي. '+
      'من أعدّ الجدول لا يعتمد أقساطه. الحسابان يختارهما المحاسب؛ الوحدة لا تفترض حسابًا ولا نسبة.'};
}
export function getSchedule(db,supplied,scheduleId){
  const u=manager(db,supplied),row=typeof scheduleId==='string'&&db.prepare('SELECT * FROM amortization_schedules WHERE id=? AND tenant_id=?').get(scheduleId,u.tenant_id);
  if(!row)fail(404,'not_found','جدول الإطفاء غير متاح');
  return scheduleView(db,u,row);
}

export function createSchedule(db,supplied,input){
  writing(db);const u=manager(db,supplied);
  v.object(input,['kind','invoice_id','source_reference','description','amount','starts_on','ends_on','debit_account_id','credit_account_id','cost_center_id','basis']);
  const kind=KINDS[input.kind];
  if(!kind)fail(400,'kind','اختر نوع الجدول: مدفوع مقدمًا أو استحقاق');
  const starts=v.date(input.starts_on),ends=v.date(input.ends_on);
  if(ends<starts)fail(400,'date_order','نهاية فترة الإطفاء تسبق بدايتها');
  const months=monthsBetween(starts,ends);
  if(months<1||months>120)fail(400,'months','فترة الإطفاء من شهر إلى 120 شهرًا');
  const total=money(input.amount,'قيمة المستند');
  let invoiceId=null;
  if(input.invoice_id){
    const invoice=db.prepare('SELECT * FROM procurement_invoices WHERE id=? AND tenant_id=?').get(input.invoice_id,u.tenant_id);
    if(!invoice)fail(404,'not_found','فاتورة المورد غير متاحة');
    if(total>invoice.amount_minor)fail(409,'amount_exceeds_invoice','قيمة الإطفاء تتجاوز قيمة فاتورة المورد المسجلة');
    if(db.prepare("SELECT 1 FROM amortization_schedules WHERE invoice_id=? AND status='active'").get(invoice.id))fail(409,'schedule_exists','للفاتورة جدول إطفاء ساري');
    invoiceId=invoice.id;
  }
  const account=accountId=>{
    const row=db.prepare('SELECT * FROM finance_accounts WHERE id=? AND tenant_id=? AND active=1').get(accountId,u.tenant_id);
    if(!row)fail(404,'not_found','الحساب غير متاح أو غير نشط');
    return row;
  };
  const debit=account(input.debit_account_id),credit=account(input.credit_account_id);
  if(debit.account_type!=='expense')fail(409,'account_type','الجانب المدين في القسط الشهري مصروف');
  if(credit.account_type!==kind.credit_type)fail(409,'account_type',`${kind.name}: ${kind.credit_label}`);
  if(debit.id===credit.id)fail(409,'account_type','الحسابان متطابقان');
  if(!db.prepare('SELECT 1 FROM finance_cost_centers WHERE id=? AND tenant_id=? AND active=1').get(input.cost_center_id,u.tenant_id))fail(404,'not_found','مركز التكلفة غير متاح');
  const reference=v.text(input.source_reference,'مرجع المستند',180,3).normalize('NFKC').toUpperCase();
  if(db.prepare('SELECT 1 FROM amortization_schedules WHERE tenant_id=? AND kind=? AND source_reference=?').get(u.tenant_id,input.kind,reference))fail(409,'duplicate_schedule','للمرجع جدول من هذا النوع');
  const scheduleId=id(),time=now();
  db.prepare(`INSERT INTO amortization_schedules(id,tenant_id,kind,invoice_id,source_reference,description,total_minor,currency,starts_on,ends_on,months,
      debit_account_id,credit_account_id,cost_center_id,basis,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SAR',?,?,?,?,?,?,?,?,?,?)`)
    .run(scheduleId,u.tenant_id,input.kind,invoiceId,reference,v.text(input.description,'وصف ما يغطيه المستند',1000,10),total,starts,ends,months,
      debit.id,credit.id,input.cost_center_id,v.text(input.basis,'سند فترة الإطفاء ومن حددها',1500,10),u.id,time,time);
  const amounts=scheduleAmounts(total,months);
  let month=starts.slice(0,7);
  for(let position=1;position<=months;position++){
    db.prepare('INSERT INTO amortization_entries(id,tenant_id,schedule_id,period_key,entry_date,position,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,scheduleId,month,monthEnd(month),position,amounts[position-1],time);
    month=addMonth(month);
  }
  audit(db,u,'amortization',scheduleId,'amortization.schedule.created',{}, {kind:input.kind,total_minor:total,months,source_reference:reference});
  return {id:scheduleId,months};
}

export function scheduleAction(db,supplied,scheduleId,action,input){
  writing(db);const u=manager(db,supplied);
  if(action!=='cancel_schedule')fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','reason']);
  const schedule=db.prepare('SELECT * FROM amortization_schedules WHERE id=? AND tenant_id=?').get(scheduleId,u.tenant_id);
  if(!schedule)fail(404,'not_found','جدول الإطفاء غير متاح');
  v.version(input.version,schedule.version);
  if(!scheduleView(db,u,schedule).actions.includes(action))fail(409,'invalid_state','الإلغاء لمن أعدّ الجدول وهو ساري');
  const reason=v.text(input.reason,'سبب الإلغاء',2000,10),time=now();
  db.prepare("UPDATE amortization_schedules SET status='cancelled',cancel_reason=?,version=version+1,updated_at=? WHERE id=?").run(reason,time,schedule.id);
  // الأقساط المعتمدة تبقى كما هي؛ يُلغى المقترح منها فقط.
  for(const e of db.prepare("SELECT * FROM amortization_entries WHERE schedule_id=? AND status='proposed'").all(schedule.id))
    db.prepare("UPDATE amortization_entries SET status='cancelled',version=version+1 WHERE id=?").run(e.id);
  audit(db,u,'amortization',schedule.id,'amortization.schedule.cancelled',{status:'active'},{status:'cancelled'},reason);
  return getSchedule(db,u,schedule.id);
}

export function entryAction(db,supplied,entryId,action,input){
  writing(db);const u=manager(db,supplied);
  if(!['approve_entry','cancel_entry'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  const entry=typeof entryId==='string'&&db.prepare('SELECT * FROM amortization_entries WHERE id=? AND tenant_id=?').get(entryId,u.tenant_id);
  if(!entry)fail(404,'not_found','القسط غير متاح');
  const schedule=db.prepare('SELECT * FROM amortization_schedules WHERE id=?').get(entry.schedule_id);
  if(!entryView(db,u,entry,schedule).actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح: من أعدّ الجدول لا يعتمد قسطه، والقسط لا يُعتمد قبل انتهاء شهره');
  v.object(input,['version','note']);v.version(input.version,entry.version);
  const time=now();
  if(action==='approve_entry'){
    // لا يُعتمد قسط داخل فترة إقفال معتمدة: القيد لن يجد فترة تقبله.
    const closed=db.prepare("SELECT period_key FROM close_periods WHERE tenant_id=? AND period_key=? AND status='approved'").get(u.tenant_id,entry.period_key);
    if(closed)fail(409,'period_closed',`إقفال ${entry.period_key} معتمد؛ لا يُعتمد قسط بتاريخ داخله. عالجه في شهر لاحق أو افتح الإقفال بطلب مسبب`);
    db.prepare("UPDATE amortization_entries SET status='approved',approved_by=?,approved_at=?,approval_note=?,version=version+1 WHERE id=?")
      .run(u.id,time,v.text(input.note,'أساس الاعتماد',2000,5),entry.id);
  }else db.prepare("UPDATE amortization_entries SET status='cancelled',version=version+1 WHERE id=?").run(entry.id);
  audit(db,u,'amortization_entry',entry.id,'amortization.entry.'+action,{status:'proposed'},{period_key:entry.period_key,amount_minor:entry.amount_minor},input.note??'');
  return getSchedule(db,u,schedule.id);
}

/* ───── القسط المعتمد مصدرٌ للدفتر (الحزمة 3) ───── */
// سطران من الجدول نفسه: مدين حساب المصروف ودائن الحساب المقابل (أصل مدفوع مقدمًا أو التزام مستحق) بمركز تكلفة الجدول،
// بتاريخ آخر الشهر. الحسابان اختيار المحاسب عند إعداد الجدول، فلا غرض محاسبي بينهما ولا ربط يُطلب.
const approvedEntry=(db,tenantId,id)=>typeof id==='string'?db.prepare(`SELECT e.*,s.kind,s.source_reference,s.description,s.debit_account_id,s.credit_account_id,s.cost_center_id,s.prepared_by AS schedule_prepared_by,s.created_at AS schedule_created_at
  FROM amortization_entries e JOIN amortization_schedules s ON s.id=e.schedule_id WHERE e.id=? AND e.tenant_id=?`).get(id,tenantId)??null:null;
const entryReference=e=>`${e.source_reference}/${e.period_key}`.slice(0,170);
registerSourceKind({key:'amortization_entry',name:'قسط إطفاء أو استحقاق معتمد',module:'accruals',
  build(db,u,id){
    const e=approvedEntry(db,u.tenant_id,id);
    if(!e||e.status!=='approved')return null;
    return {date:e.entry_date,reference:entryReference(e),description:`قسط ${e.period_key} — ${KINDS[e.kind].name}: ${e.description}`.slice(0,900),
      lines:[{account_id:e.debit_account_id,cost_center_id:e.cost_center_id,debit_minor:e.amount_minor,credit_minor:0,memo:`مصروف شهر ${e.period_key}`},
        {account_id:e.credit_account_id,cost_center_id:e.cost_center_id,debit_minor:0,credit_minor:e.amount_minor,memo:e.kind==='prepaid'?'إطفاء من المدفوع مقدمًا':'مصروف مستحق لم تصل فاتورته'}]};
  },
  pending:(db,tenantId)=>db.prepare(`SELECT e.id,e.period_key,e.entry_date,e.amount_minor,s.source_reference FROM amortization_entries e JOIN amortization_schedules s ON s.id=e.schedule_id WHERE e.tenant_id=? AND e.status='approved'`).all(tenantId)
    .map(e=>({source_id:e.id,reference:entryReference(e),amount_minor:e.amount_minor,date:e.entry_date})),
  document:(db,tenantId,id)=>{const e=approvedEntry(db,tenantId,id);return e&&{reference:entryReference(e),date:e.entry_date,amount_minor:e.amount_minor,status:e.status,description:e.description};},
  approvals:(db,tenantId,id)=>{const e=approvedEntry(db,tenantId,id);if(!e)return [];
    return [{role:'أعدّ جدول الإطفاء',actor_id:e.schedule_prepared_by,at:e.schedule_created_at},...(e.approved_by?[{role:'اعتمد قسط الشهر',actor_id:e.approved_by,at:e.approved_at,note:e.approval_note}]:[])];}});
