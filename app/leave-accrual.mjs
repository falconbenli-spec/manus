import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { accrualStopAfterDays } from './hr-rule-basis.mjs';

// محرك استحقاق الإجازات: يبني فوق وحدة الإجازات (app/leave.mjs) ولا يغيّر فيها شيئًا.
// لا مدة استحقاق ولا نسبة ولا سقف ترحيل مكتوب هنا: كلها سياسة مؤرخة بمصدرها يعتمدها مدير الموارد البشرية.
// الرصيد مشتق من الحركات: استحقاق · ترحيل · انتهاء صلاحية · تسوية يدوية من هذا الدفتر،
// والاستخدام من دفتر وحدة الإجازات نفسه، والصرف النقدي من تسوية نهاية الخدمة في مسير الرواتب.
export const ACCRUAL_UNITS=[['month','عن كل شهر'],['year','عن كل سنة']].map(([key,name])=>({key,name}));
export const ACCRUAL_STARTS=[['hire','من تاريخ التعيين'],['after_period','بعد فترة من التعيين']].map(([key,name])=>({key,name}));
export const RUN_KINDS=[['accrual','تقييد استحقاق فترة'],['carryover','ترحيل رصيد سنة'],['expiry','إنهاء صلاحية رصيد سنة']].map(([key,name])=>({key,name}));
export const MOVEMENT_NAMES={accrual:'استحقاق',carryover_in:'ترحيل وارد',carryover_out:'ترحيل صادر',expiry:'انتهاء صلاحية',adjustment:'تسوية يدوية',usage:'استخدام (من وحدة الإجازات)',payout:'صرف نقدي (تسوية نهاية الخدمة)'};
export const LEGAL_REVIEW='هذه القواعد كما أدخلها مدير الموارد البشرية بمصدرها وتاريخ تأكيدها. يحتاج مراجعة نظام العمل ولائحته.';
const CAPS=['hr.policy.prepare','hr.policy.accept'];
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة سجل الاستحقاق تبي معاملة قاعدة بيانات');}
function need(u,key,message){if(!u.caps.includes(key))fail(403,'not_permitted',message);}
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

// الأيام بالألف من اليوم: نصف يوم يُدخَل 0.5 ويُخزَّن 500، فلا يدخل الكسر العشري في أي جمع.
function days(value,label,{signed=false,zero=false}={}){
  const pattern=signed?/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/:/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/;
  if(typeof value!=='string'||!pattern.test(value))fail(400,'invalid_days',`${label}: عدد أيام بثلاث خانات عشرية على الأكثر`);
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');
  const milli=Number(BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')))*(negative?-1:1);
  if(!zero&&milli===0)fail(400,'invalid_days',`${label}: ما يقبل صفر`);
  return milli;
}
export const daysText=milli=>String(Math.round(milli)/1000);
function leaveType(value){
  const type=v.text(value,'نوع الإجازة',60);
  if(!/^[a-z][a-z0-9_-]{1,59}$/.test(type))fail(400,'leave_type','رمز نوع الإجازة مو صحيح — اختر النوع من القائمة');
  return type;
}
function monthRange(key){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))fail(400,'period_key','اكتب الفترة الشهرية بصيغة 2026-03');
  const [y,m]=key.split('-').map(Number);
  return {from:`${key}-01`,to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),year:y};
}
function yearRange(key){
  if(!/^\d{4}$/.test(key)||Number(key)<2000||Number(key)>2200)fail(400,'period_key','اكتب السنة بصيغة 2026');
  return {from:`${key}-01-01`,to:`${key}-12-31`,year:Number(key)};
}
export function acceptedAccrualPolicy(db,tenantId,type,date){
  return db.prepare("SELECT * FROM leave_accrual_policies WHERE tenant_id=? AND leave_type=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,type,date)??null;
}
function policyView(db,u,p){
  return {...p,carryover_allowed:!!p.carryover_allowed,cash_on_end_of_service:!!p.cash_on_end_of_service,
    accrual_days:daysText(p.accrual_milli),carryover_cap_days:p.carryover_cap_milli===null?null:daysText(p.carryover_cap_milli),
    unit_name:ACCRUAL_UNITS.find(x=>x.key===p.accrual_unit).name,start_name:ACCRUAL_STARTS.find(x=>x.key===p.accrual_start).name,
    prepared_by_name:personName(db,p.prepared_by),decided_by_name:personName(db,p.decided_by),
    actions:p.status==='draft'
      ?[...(p.prepared_by===u.id&&u.caps.includes('hr.policy.prepare')?['edit_accrual_policy']:[]),
        ...(p.prepared_by!==u.id&&u.caps.includes('hr.policy.accept')?['accept_accrual_policy','reject_accrual_policy']:[])]
      :[]};
}
const employmentStart=(db,tenantId,userId)=>db.prepare("SELECT MIN(start_date) AS d FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status IN ('active','ended')").get(tenantId,userId).d??null;

// الاستخدام يُقرأ من دفتر وحدة الإجازات كما هو: الخصم بعد الاعتماد والرد بعد الإلغاء. لا نسخة ثانية منه هنا.
function usageLines(db,tenantId,employeeId,type,year){
  const opening=db.prepare("SELECT l.id,l.kind,l.posted_delta,l.effective_date,l.reason,l.actor_id,l.created_at FROM leave_ledger l JOIN leave_balances b ON b.id=l.balance_id WHERE b.tenant_id=? AND b.employee_id=? AND b.leave_type=? AND b.balance_year=? AND l.kind IN ('debit','refund') ORDER BY l.seq").all(tenantId,employeeId,type,year)
    .map(l=>({origin:'leave',kind:'usage',days_milli:l.posted_delta*1000,effective_date:l.effective_date,source:l.reason,approved_by:l.actor_id,created_at:l.created_at}));
  // الطلب المصروف من هذا المحرك (ترحيل 098، WIRING-SPEC §7 #26) يُخصم في دفتر الأيام بالألف: يُقرأ كما هو، ولا يُنسخ.
  const engine=db.prepare("SELECT kind,used_milli,effective_date,reason,actor_id,created_at FROM leave_day_ledger WHERE tenant_id=? AND employee_id=? AND leave_type=? AND balance_year=? AND source='accrual' AND kind IN ('debit','refund') ORDER BY seq").all(tenantId,employeeId,type,year)
    .map(l=>({origin:'leave',kind:'usage',days_milli:-l.used_milli,effective_date:l.effective_date,source:l.reason,approved_by:l.actor_id,created_at:l.created_at}));
  return [...opening,...engine];
}
// الأيام بلا أجر المعتمدة التي تتجاوز الحد في سياسة أنواع الإجازات المعتمدة (م86/2ب، م91/6): الاستحقاق يتوقف عنها.
function suspendedDates(db,tenantId,employeeId,year,asOf){
  // الحد واحد: من كتلة unpaid_leave في سياسة أنواع الإجازات، أو من سياسة المخالصة لما هو مخزَّن قبل التوحيد.
  const limit=accrualStopAfterDays(db,tenantId,asOf);
  if(!Number.isInteger(limit))return [];
  const dates=db.prepare("SELECT t.counted_dates_json FROM leave_requests r JOIN leave_request_terms t ON t.request_id=r.id AND t.revision=r.revision WHERE r.tenant_id=? AND r.employee_id=? AND r.status='approved' AND t.leave_type='unpaid' AND substr(r.start_date,1,4)=?").all(tenantId,employeeId,String(year))
    .flatMap(r=>JSON.parse(r.counted_dates_json)).sort();
  return dates.slice(limit);
}
// الأنواع التي تقول سياستها المعتمدة إنها تُصرف نقدًا عند نهاية الخدمة في هذا التاريخ.
function cashTypes(db,tenantId,date){
  return db.prepare("SELECT DISTINCT leave_type FROM leave_accrual_policies WHERE tenant_id=? AND status='accepted' AND effective_from<=?").all(tenantId,date)
    .map(r=>r.leave_type).filter(type=>acceptedAccrualPolicy(db,tenantId,type,date)?.cash_on_end_of_service===1);
}
// الصرف النقدي حركة في مسير الرواتب (service_settlements) لا في هذه الوحدة؛ تُقرأ هنا لتفسير الرصيد فقط.
function payoutLines(db,tenantId,employeeId,type,year){
  const rows=db.prepare("SELECT id,service_end,leave_days,decided_at FROM service_settlements WHERE tenant_id=? AND user_id=? AND status='approved' AND leave_days>0").all(tenantId,employeeId);
  return rows.filter(s=>Number(s.service_end.slice(0,4))===year).flatMap(s=>{
    const types=cashTypes(db,tenantId,s.service_end);
    if(types.length!==1||types[0]!==type)return [];
    return [{origin:'payroll',kind:'payout',days_milli:-s.leave_days*1000,effective_date:s.service_end,source:`تسوية نهاية خدمة معتمدة ${s.id.slice(0,8)} في مسير الرواتب`,approved_by:null,created_at:s.decided_at,settlement_id:s.id}];
  });
}
function entryLines(db,tenantId,employeeId,type,year){
  return db.prepare('SELECT * FROM leave_accrual_entries WHERE tenant_id=? AND employee_id=? AND leave_type=? AND balance_year=? ORDER BY seq').all(tenantId,employeeId,type,year)
    .map(e=>({origin:'accrual',kind:e.kind,days_milli:e.days_milli,effective_date:e.effective_date,source:e.source,approved_by:e.approved_by,period_key:e.period_key,run_id:e.run_id,policy_id:e.policy_id,created_at:e.created_at}));
}
// كل رصيد قابل للتفسير سطرًا سطرًا: لا رقم يُكتب فوقه، بل مجموع حركات كل منها بمصدره.
export function accrualBalance(db,tenantId,employeeId,type,year){
  const movements=[...entryLines(db,tenantId,employeeId,type,year),...usageLines(db,tenantId,employeeId,type,year),...payoutLines(db,tenantId,employeeId,type,year)]
    .sort((a,b)=>a.effective_date.localeCompare(b.effective_date)||String(a.created_at).localeCompare(String(b.created_at)));
  const sum=kinds=>movements.filter(m=>kinds.includes(m.kind)).reduce((n,m)=>n+m.days_milli,0);
  const entitled=sum(['accrual','carryover_in','carryover_out','expiry','adjustment']),used=-sum(['usage']),paid=-sum(['payout']);
  return {employee_id:employeeId,leave_type:type,balance_year:year,entitled_milli:entitled,used_milli:used,payout_milli:paid,
    balance_milli:entitled-used-paid,entitled_days:daysText(entitled),used_days:daysText(used),payout_days:daysText(paid),balance_days:daysText(entitled-used-paid),
    movements:movements.map(m=>({...m,days:daysText(m.days_milli),kind_name:MOVEMENT_NAMES[m.kind]??m.kind,approved_by_name:personName(db,m.approved_by)}))};
}
// الأيام المتبقية المؤهلة للصرف النقدي، لتُدخل في شاشة تسوية نهاية الخدمة القائمة. هذه الوحدة لا تصرف شيئًا.
export function payoutEligibleDays(db,tenantId,employeeId,asOf){
  const types=cashTypes(db,tenantId,asOf);
  const rows=types.map(type=>{
    const years=db.prepare('SELECT DISTINCT balance_year FROM leave_accrual_entries WHERE tenant_id=? AND employee_id=? AND leave_type=? ORDER BY balance_year').all(tenantId,employeeId,type).map(r=>r.balance_year);
    const milli=years.reduce((n,year)=>n+accrualBalance(db,tenantId,employeeId,type,year).balance_milli,0);
    return {leave_type:type,days:daysText(milli),milli};
  });
  return {as_of:asOf,types:rows,
    single_type:rows.length===1?rows[0]:null,
    note:rows.length===1
      ?'أدخل هذا العدد في حقل أيام الإجازة المستحقة بشاشة تسوية نهاية الخدمة (مسير الرواتب). الصرف يتم هناك عبر الآلية القائمة، ولا تصرف هذه الشاشة أي مبلغ.'
      :'لأكثر من نوع إجازة قابل للصرف النقدي (أو لا نوع): وزّع الأيام بقرار مكتوب وسجّل ما يقابلها بتسوية يدوية في دفتر الاستحقاق.'};
}
// ── الفترات المستحقة التي لم تُشغَّل (D-05) ────────────────────────────────────
// لا جدولة آلية للاستحقاق: التشغيل قرار مدير الموارد البشرية ويبقى كذلك. ما كان ناقصًا هو أن أحدًا لا يُذكَّر به،
// فالشهر المنسي يترك الموظف أمام «المتاح 0 يوم» وكأنه استنفد رصيده. هذه الدالة تقول ما استحق ولم يُشغَّل، وتُقرأ
// في ثلاثة مواضع: تذكير يومي لحامل hr.policy.accept، ولوحة الاستحقاق، ورفض الطلب في وحدة الإجازات.
// القاعدة: فترة اكتملت بعد سريان سياسة معتمدة ولا تشغيل لها. بحد أقصى 24 فترة للخلف حتى لا يُسرد تاريخ لا ينتهي.
export function dueAccrualPeriods(db,tenantId,leaveType,asOf=today()){
  const policy=acceptedAccrualPolicy(db,tenantId,leaveType,asOf);
  if(!policy)return [];
  const out=[];
  if(policy.accrual_unit==='month'){
    const [y,m]=asOf.slice(0,7).split('-').map(Number);
    for(let back=1;back<=24;back++){
      const d=new Date(Date.UTC(y,m-1-back,1)),key=d.toISOString().slice(0,7),range=monthRange(key);
      if(range.to<policy.effective_from)break;
      if(range.to>=asOf)continue;
      if(db.prepare('SELECT 1 FROM accrual_runs WHERE tenant_id=? AND kind=? AND leave_type=? AND period_key=?').get(tenantId,'accrual',leaveType,key))continue;
      out.push({leave_type:leaveType,period_key:key,period_from:range.from,period_to:range.to,unit:'month'});
    }
  }else{
    for(let year=Number(asOf.slice(0,4))-1;year>=Number(asOf.slice(0,4))-24;year--){
      const range=yearRange(String(year));
      if(range.to<policy.effective_from)break;
      if(db.prepare('SELECT 1 FROM accrual_runs WHERE tenant_id=? AND kind=? AND leave_type=? AND period_key=?').get(tenantId,'accrual',leaveType,String(year)))continue;
      out.push({leave_type:leaveType,period_key:String(year),period_from:range.from,period_to:range.to,unit:'year'});
    }
  }
  return out.sort((a,b)=>a.period_key.localeCompare(b.period_key));
}
// كل الأنواع التي لها سياسة معتمدة سارية، وما استحق منها ولم يُشغَّل.
export function allDueAccrualPeriods(db,tenantId,asOf=today()){
  const types=[...new Set(db.prepare("SELECT DISTINCT leave_type FROM leave_accrual_policies WHERE tenant_id=? AND status='accepted' AND effective_from<=?").all(tenantId,asOf).map(r=>r.leave_type))];
  return types.flatMap(type=>dueAccrualPeriods(db,tenantId,type,asOf));
}
function runView(db,run){
  return {...run,skipped:JSON.parse(run.skipped),days:daysText(run.days_milli),
    kind_name:RUN_KINDS.find(k=>k.key===run.kind).name,accepted_by_name:personName(db,run.accepted_by)};
}

export function accrualBoard(db,supplied){
  const u=actor(db,supplied),date=today(),hr=u.caps.length>0;
  const policies=hr?db.prepare('SELECT * FROM leave_accrual_policies WHERE tenant_id=? ORDER BY effective_from DESC,created_at DESC').all(u.tenant_id).map(p=>policyView(db,u,p)):[];
  const runs=hr?db.prepare('SELECT * FROM accrual_runs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id).map(r=>runView(db,r)):[];
  const scope=hr?db.prepare('SELECT DISTINCT employee_id,leave_type,balance_year FROM leave_accrual_entries WHERE tenant_id=? ORDER BY balance_year DESC,employee_id,leave_type').all(u.tenant_id)
    :db.prepare('SELECT DISTINCT employee_id,leave_type,balance_year FROM leave_accrual_entries WHERE tenant_id=? AND employee_id=? ORDER BY balance_year DESC,leave_type').all(u.tenant_id,u.id);
  const balances=scope.map(s=>({...accrualBalance(db,u.tenant_id,s.employee_id,s.leave_type,s.balance_year),employee_name:personName(db,s.employee_id)}));
  const types=[...new Set(policies.filter(p=>p.status==='accepted').map(p=>p.leave_type))];
  const employees=hr?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[];
  const due=hr?allDueAccrualPeriods(db,u.tenant_id,date):[];
  const alerts=[];
  if(hr){
    if(!policies.some(p=>p.status==='accepted'))alerts.push({kind:'no_policy',message:'لا توجد قاعدة استحقاق معتمدة بعد. الاستحقاق لا يبدأ قبل أن يعتمد مدير الموارد البشرية سياسة مؤرخة بمصدرها.'});
    // D-05: الفترة المكتملة بلا تشغيل تُعرض هنا باسمها. التشغيل يبقى قرارًا يدويًا؛ المعروض تذكير لا تنفيذ.
    for(const [type,rows] of Object.entries(Object.groupBy(due,d=>d.leave_type)))
      alerts.push({kind:'accrual_due',leave_type:type,periods:rows.map(r=>r.period_key),
        message:`${rows.length} فترة استحقاق اكتملت ولم تُقيَّد لـ«${type}» (${rows[0].period_key}${rows.length>1?` — ${rows.at(-1).period_key}`:''}). رصيد الموظفين لا يرتفع قبل تشغيلها، والتشغيل قرارك ولا يجري آليًا.`});
    for(const p of policies.filter(x=>x.status==='draft'))alerts.push({kind:'policy_draft',policy_id:p.id,message:`سياسة «${p.title}» مسودة لم يعتمدها مدير الموارد البشرية؛ لا تُقيَّد بها أي حركة.`});
    // أيام استُخدمت في وحدة الإجازات بلا استحقاق مقيد يفسرها.
    for(const b of balances)if(b.balance_milli<0)alerts.push({kind:'negative_balance',employee_id:b.employee_id,message:`رصيد ${b.employee_name} في ${b.leave_type} لسنة ${b.balance_year} سالب (${b.balance_days} يوم). يلزم تقييد استحقاق الفترة أو تسوية يدوية بسبب مكتوب.`});
  }
  return {today:date,user_id:u.id,permissions:u.caps,can_prepare:u.caps.includes('hr.policy.prepare'),can_accept:u.caps.includes('hr.policy.accept'),
    units:ACCRUAL_UNITS,starts:ACCRUAL_STARTS,run_kinds:RUN_KINDS,movement_names:MOVEMENT_NAMES,legal_review:LEGAL_REVIEW,
    policies,runs,balances,leave_types:types,employees,alerts,due_periods:due,
    acceptance_owner:'مدير الموارد البشرية (تصريح hr.policy.accept)',
    note:'أرصدة هذه الشاشة مشتقة من حركات مقيدة بمصدرها. متى اعتمد مدير الموارد البشرية سياسة أنواع الإجازات، يحجز طلب النوع نفسه من هذا الرصيد ويُخصم منه عند اعتماده النهائي (يظهر «استخدام» هنا)؛ وقبلها يبقى الطلب على الرصيد الافتتاحي في شاشة الإجازات. الترحيل وانتهاء الصلاحية لا يجريان آليًا: لكل منهما تشغيل مؤرخ يعتمده مدير الموارد البشرية. والصرف النقدي حركة في مسير الرواتب عبر تسوية نهاية الخدمة القائمة.'};
}

function policyInput(input){
  const unit=ACCRUAL_UNITS.some(x=>x.key===input.accrual_unit)?input.accrual_unit:fail(400,'accrual_unit','اختر وحدة الاستحقاق من القائمة');
  const start=ACCRUAL_STARTS.some(x=>x.key===input.accrual_start)?input.accrual_start:fail(400,'accrual_start','اختر متى يبدأ الاستحقاق');
  const waiting=start==='after_period'?input.waiting_days:0;
  if(!Number.isInteger(waiting)||waiting<0||waiting>3650)fail(400,'waiting_days','فترة ما قبل بدء الاستحقاق بالأيام رقم صحيح');
  if(start==='after_period'&&waiting<1)fail(400,'waiting_days','حدد كم يوم الفترة اللي يبدأ الاستحقاق بعدها');
  if(typeof input.carryover_allowed!=='boolean'||typeof input.cash_on_end_of_service!=='boolean')fail(400,'invalid_flag','حدد الترحيل والصرف النقدي: نعم ولا لا');
  const cap=input.carryover_allowed?days(input.carryover_cap_days,'سقف الترحيل',{zero:true}):null;
  return {leave_type:leaveType(input.leave_type),title:v.text(input.title,'عنوان السياسة',180,3),body:v.text(input.body,'نص السياسة',8000,20),
    accrual_unit:unit,accrual_milli:days(input.accrual_days,'مقدار الاستحقاق'),accrual_start:start,waiting_days:waiting,
    carryover_allowed:input.carryover_allowed?1:0,carryover_cap_milli:cap,cash_on_end_of_service:input.cash_on_end_of_service?1:0,
    basis:v.text(input.basis,'مصدر القاعدة',2000,10),basis_confirmed_on:v.date(input.basis_confirmed_on),effective_from:v.date(input.effective_from)};
}
const POLICY_FIELDS=['leave_type','title','body','accrual_unit','accrual_days','accrual_start','waiting_days','carryover_allowed','carryover_cap_days','cash_on_end_of_service','basis','basis_confirmed_on','effective_from'];

export function prepareAccrualPolicy(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  need(u,'hr.policy.prepare','إعداد قواعد الاستحقاق لموظفي الموارد البشرية المخولين');
  v.object(input,POLICY_FIELDS);
  const c=policyInput(input),policyId=id();
  if(db.prepare('SELECT 1 FROM leave_accrual_policies WHERE tenant_id=? AND leave_type=? AND effective_from=?').get(u.tenant_id,c.leave_type,c.effective_from))fail(409,'policy_exists','فيه سياسة لهذا النوع بنفس تاريخ السريان');
  db.prepare("INSERT INTO leave_accrual_policies(id,tenant_id,leave_type,title,body,accrual_unit,accrual_milli,accrual_start,waiting_days,carryover_allowed,carryover_cap_milli,cash_on_end_of_service,basis,basis_confirmed_on,effective_from,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)")
    .run(policyId,u.tenant_id,c.leave_type,c.title,c.body,c.accrual_unit,c.accrual_milli,c.accrual_start,c.waiting_days,c.carryover_allowed,c.carryover_cap_milli,c.cash_on_end_of_service,c.basis,c.basis_confirmed_on,c.effective_from,u.id,now());
  audit(db,u,'leave_accrual_policy',policyId,'accrual_policy.prepared',{}, {leave_type:c.leave_type,effective_from:c.effective_from},c.basis);
  return {id:policyId};
}
export function updateAccrualPolicyDraft(db,supplied,policyId,input){
  writing(db);const u=actor(db,supplied);
  need(u,'hr.policy.prepare','تعديل المسودة لمن أعدّها وبس');
  v.object(input,['version',...POLICY_FIELDS]);
  const p=typeof policyId==='string'&&db.prepare('SELECT * FROM leave_accrual_policies WHERE id=? AND tenant_id=?').get(policyId,u.tenant_id);
  if(!p)fail(404,'not_found','ما لقينا السياسة هذي');
  v.version(input.version,p.version);
  if(p.status!=='draft')fail(409,'decided_policy','السياسة المعتمدة ما تتعدّل — أعدّ سياسة جديدة بتاريخ سريان جديد');
  if(p.prepared_by!==u.id)fail(403,'forbidden','تعديل المسودة لمن أعدّها وبس');
  const c=policyInput(input);
  db.prepare('UPDATE leave_accrual_policies SET leave_type=?,title=?,body=?,accrual_unit=?,accrual_milli=?,accrual_start=?,waiting_days=?,carryover_allowed=?,carryover_cap_milli=?,cash_on_end_of_service=?,basis=?,basis_confirmed_on=?,effective_from=?,version=version+1 WHERE id=?')
    .run(c.leave_type,c.title,c.body,c.accrual_unit,c.accrual_milli,c.accrual_start,c.waiting_days,c.carryover_allowed,c.carryover_cap_milli,c.cash_on_end_of_service,c.basis,c.basis_confirmed_on,c.effective_from,p.id);
  audit(db,u,'leave_accrual_policy',p.id,'accrual_policy.updated',{version:p.version},{version:p.version+1},c.basis);
  return {id:p.id,version:p.version+1};
}
export function decideAccrualPolicy(db,supplied,policyId,decision,input){
  writing(db);const u=actor(db,supplied);
  need(u,'hr.policy.accept','اعتماد قواعد الاستحقاق لمدير الموارد البشرية');
  v.object(input,['note']);
  if(!['accept','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون قبول ولا رفض');
  const p=typeof policyId==='string'&&db.prepare("SELECT * FROM leave_accrual_policies WHERE id=? AND tenant_id=? AND status='draft'").get(policyId,u.tenant_id);
  if(!p)fail(404,'not_found','ما لقينا سياسة تنتظر قرار');
  if(p.prepared_by===u.id)fail(409,'separation_of_duties','اللي أعدّ السياسة ما يعتمدها');
  const status=decision==='accept'?'accepted':'rejected';
  db.prepare('UPDATE leave_accrual_policies SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?')
    .run(status,u.id,now(),v.text(input.note,'أساس القرار ومراجعته',2000,10),p.id);
  audit(db,u,'leave_accrual_policy',p.id,'accrual_policy.'+status,{status:'draft'},{status});
  return {id:p.id,status};
}

function periodFor(kind,key){
  if(kind==='accrual')return /^\d{4}$/.test(String(key))?{unit:'year',...yearRange(key)}:{unit:'month',...monthRange(key)};
  return {unit:'year',...yearRange(key)};
}
function insertEntry(db,u,row){
  db.prepare('INSERT INTO leave_accrual_entries(id,tenant_id,employee_id,leave_type,balance_year,kind,days_milli,period_key,effective_date,run_id,policy_id,source,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,row.employee_id,row.leave_type,row.balance_year,row.kind,row.days_milli,row.period_key,row.effective_date,row.run_id??null,row.policy_id??null,row.source,u.id,now());
}
// يحاكي نمط runDueSchedules: الفترة الواحدة لا تُقيَّد مرتين، وإعادة التشغيل تعيد التشغيل الأول كما هو.
export function runAccrualCycle(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  need(u,'hr.policy.accept','تشغيل الاستحقاق والترحيل وانتهاء الصلاحية لمدير الموارد البشرية');
  v.object(input,['kind','leave_type','period_key','note']);
  if(!RUN_KINDS.some(k=>k.key===input.kind))fail(400,'run_kind','اختر نوع التشغيل من القائمة');
  const kind=input.kind,type=leaveType(input.leave_type),note=v.text(input.note,'سبب التشغيل وسنده',2000,10),runDate=today();
  const key=v.text(input.period_key,'الفترة',10,4);
  const existing=db.prepare('SELECT * FROM accrual_runs WHERE tenant_id=? AND kind=? AND leave_type=? AND period_key=?').get(u.tenant_id,kind,type,key);
  if(existing)return {...runView(db,existing),repeated:true};
  const period=periodFor(kind,key);
  // الفترة تُقيَّد بعد اكتمالها فقط؛ لا استحقاق عن يوم لم يمضِ.
  const closing=kind==='carryover'?yearRange(String(period.year-1)):period;
  if(closing.to>=runDate)fail(409,'period_open','الفترة ما خلصت لين الحين — تتقيّد بعد ما تنتهي');
  const policy=acceptedAccrualPolicy(db,u.tenant_id,type,closing.to);
  if(!policy)fail(409,'policy_required','ما فيه قاعدة استحقاق اعتمدها مدير الموارد البشرية وسارية في هذي الفترة');
  if(kind==='accrual'&&policy.accrual_unit!==period.unit)fail(400,'period_key',`وحدة الاستحقاق في السياسة المعتمدة ${policy.accrual_unit==='month'?'شهرية (2026-03)':'سنوية (2026)'}`);
  if(kind==='carryover'&&!policy.carryover_allowed)fail(409,'carryover_not_allowed','السياسة المعتمدة ما تسمح بترحيل الرصيد');
  if(kind==='expiry'&&policy.carryover_allowed&&!db.prepare('SELECT 1 FROM accrual_runs WHERE tenant_id=? AND kind=? AND leave_type=? AND period_key=?').get(u.tenant_id,'carryover',type,String(period.year+1)))
    fail(409,'carryover_first','السياسة تسمح بالترحيل — شغّل ترحيل السنة الجايّة قبل ما تنهي صلاحية رصيد هذي السنة');
  const runId=id(),skipped=[],planned=[];let employees=0,total=0;
  const rows=kind==='accrual'
    ?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name,id").all(u.tenant_id)
    :db.prepare('SELECT DISTINCT e.employee_id AS id,x.name FROM leave_accrual_entries e JOIN users x ON x.id=e.employee_id WHERE e.tenant_id=? AND e.leave_type=? AND e.balance_year=? ORDER BY x.name,e.employee_id').all(u.tenant_id,type,closing.year);
  const source=`${policy.title} · سياسة معتمدة ${policy.id.slice(0,8)} سارية من ${policy.effective_from} · ${policy.basis}`;
  // يُحسب التشغيل كاملًا قبل أن يُكتب منه شيء: سجل التشغيل نفسه غير قابل للتعديل بعد كتابته.
  for(const person of rows){
    if(kind==='accrual'){
      const start=employmentStart(db,u.tenant_id,person.id);
      if(!start){skipped.push({employee_id:person.id,reason:'لا يوجد عقد عمل مسجل يحدد تاريخ التعيين'});continue;}
      const eligible=policy.accrual_start==='hire'?start:addDays(start,policy.waiting_days);
      // الفترة الجزئية لا تُحسب بنسبة مخترعة: تُقيَّد بتسوية يدوية بسبب مكتوب إن قررها مدير الموارد البشرية.
      if(eligible>period.from){skipped.push({employee_id:person.id,reason:`بدء الاستحقاق ${eligible} بعد بداية الفترة؛ الفترة الجزئية تحتاج تسوية يدوية`});continue;}
      const suspended=suspendedDates(db,u.tenant_id,person.id,period.year,period.to).filter(d=>d>=period.from&&d<=period.to);
      // الرقم في النص من الحد المقرر نفسه، فلا يقول النص «العشرين» بعد تغييره في السياسة.
      if(suspended.length){skipped.push({employee_id:person.id,reason:`${suspended.length} يومًا بلا أجر في الفترة بعد تجاوز ${accrualStopAfterDays(db,u.tenant_id,period.to)} يومًا (م86/2ب، م91/6): الاستحقاق موقوف عنها؛ الفترة الجزئية تحتاج تسوية يدوية`});continue;}
      planned.push({employee_id:person.id,leave_type:type,balance_year:period.year,kind:'accrual',days_milli:policy.accrual_milli,period_key:key,effective_date:period.to,run_id:runId,policy_id:policy.id,source});
      employees++;total+=policy.accrual_milli;
      continue;
    }
    const remaining=accrualBalance(db,u.tenant_id,person.id,type,closing.year).balance_milli;
    if(remaining<=0){skipped.push({employee_id:person.id,reason:`لا رصيد متبقٍ في ${closing.year}`});continue;}
    if(kind==='carryover'){
      const moved=Math.min(remaining,policy.carryover_cap_milli);
      if(moved<=0){skipped.push({employee_id:person.id,reason:'سقف الترحيل في السياسة المعتمدة صفر'});continue;}
      planned.push({employee_id:person.id,leave_type:type,balance_year:closing.year,kind:'carryover_out',days_milli:-moved,period_key:key,effective_date:closing.to,run_id:runId,policy_id:policy.id,source});
      planned.push({employee_id:person.id,leave_type:type,balance_year:period.year,kind:'carryover_in',days_milli:moved,period_key:key,effective_date:`${period.year}-01-01`,run_id:runId,policy_id:policy.id,source});
      employees++;total+=moved;
      continue;
    }
    planned.push({employee_id:person.id,leave_type:type,balance_year:closing.year,kind:'expiry',days_milli:-remaining,period_key:key,effective_date:closing.to,run_id:runId,policy_id:policy.id,source});
    employees++;total-=remaining;
  }
  db.prepare('INSERT INTO accrual_runs(id,tenant_id,kind,leave_type,policy_id,period_key,period_from,period_to,run_date,note,employees,days_milli,skipped,accepted_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(runId,u.tenant_id,kind,type,policy.id,key,closing.from,closing.to,runDate,note,employees,total,JSON.stringify(skipped),u.id,now());
  for(const row of planned)insertEntry(db,u,row);
  audit(db,u,'accrual_run',runId,'accrual.'+kind,{}, {leave_type:type,period_key:key,employees,days:daysText(total)},note);
  return runView(db,db.prepare('SELECT * FROM accrual_runs WHERE id=?').get(runId));
}

export function recordAccrualAdjustment(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  need(u,'hr.policy.accept','التسوية اليدوية لمدير الموارد البشرية بسبب مكتوب');
  v.object(input,['employee_id','leave_type','effective_date','days','reason']);
  const type=leaveType(input.leave_type),date=v.date(input.effective_date),amount=days(input.days,'أيام التسوية',{signed:true});
  const person=db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(input.employee_id,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا');
  if(person.id===u.id)fail(409,'separation_of_duties','ما أحد يسوّي رصيده بنفسه');
  if(!acceptedAccrualPolicy(db,u.tenant_id,type,date))fail(409,'policy_required','ما فيه قاعدة استحقاق معتمدة لهذا النوع سارية في تاريخ التسوية');
  const reason=v.text(input.reason,'سبب التسوية وسندها',2000,10),year=Number(date.slice(0,4));
  insertEntry(db,u,{employee_id:person.id,leave_type:type,balance_year:year,kind:'adjustment',days_milli:amount,period_key:date,effective_date:date,source:reason});
  audit(db,u,'leave_accrual_entry',person.id,'accrual.adjustment',{}, {leave_type:type,balance_year:year,days:daysText(amount)},reason);
  return accrualBalance(db,u.tenant_id,person.id,type,year);
}

export function accrualSettlementView(db,supplied,employeeId){
  const u=actor(db,supplied);
  if(!u.caps.length)fail(403,'not_permitted','القراءة هذي لحاملي تصاريح سياسات الموارد البشرية وبس');
  const person=db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(employeeId,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا');
  return {employee_id:person.id,employee_name:person.name,...payoutEligibleDays(db,u.tenant_id,person.id,today())};
}
