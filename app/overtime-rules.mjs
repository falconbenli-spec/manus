import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { AppError, fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds, capabilityGap } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { notifySubject, dateRange } from './notices.mjs';
import { overtimeAmountMinor, annualCapMinor, weekOf, REGULATION_WORKDAYS } from './attendance-policy.mjs';

// العمل الإضافي وفق م76–77 من النسخة الموقعة (P1 #3). المواد بترقيمها المطبوع (م76 ص 26–27، م77 ص 27):
// 1) مدير الإدارة (المدير المباشر للموظف) هو الذي يقر العمل الإضافي (م77(2)) بتكليف كتابي أو إلكتروني يبين الساعات والأيام (م76(1))،
// 2) يوافق عليه صاحب الصلاحية مسبقًا (م77(3)، البند الأول: «الحصول على موافقة مسبقة من صاحب الصلاحية وتكليف كتابي»؛ حامل hr.attendance.approve)،
// 3) تعتمد الموارد البشرية ميزانيته كتابة (م77(7): «وجود ميزانية معتمدة والحصول على موافقة مكتوبة من إدارة الموارد البشرية»؛ حامل hr.attendance.manage).
// ثم يسجل الموظف ساعاته الفعلية على التكليف. م77(2) يسمّي من يقر (مدير الإدارة) وم77(3) من يوافق (صاحب الصلاحية): معتمدان مختلفان لا يُخلط بينهما.
// السقوف والأجر من سياسة ساعات العمل المقبولة (معامل overtime)؛ دونها لا يُنشأ تكليف. الأجر المحسوب «مقترح» للمسير فقط.
export const ASSIGNMENT_STATUS={proposed:'مكتوب — بانتظار موافقة صاحب الصلاحية',authorised:'وافق صاحب الصلاحية — بانتظار اعتماد الميزانية من الموارد البشرية',budget_approved:'معتمد — يُسجَّل عليه العمل الفعلي',rejected:'مرفوض',cancelled:'ملغى'};
export const DAY_TYPES={working:'يوم عمل',rest:'يوم راحة',holiday:'عطلة رسمية'};
const RIYADH_OFFSET=3*3600000;
const riyadhDate=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
const hours=minutes=>`${Number((minutes/60).toFixed(2))} ساعة`;
export const sar=minor=>minor===null||minor===undefined?null:(minor/100).toFixed(2);

function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','تسجيل الحضور لحسابات الموظفين وبس');
  u.caps=['hr.attendance.manage','hr.attendance.approve','payroll.prepare'].filter(key=>holds(db,u,key));return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة الحضور تبي معاملة قاعدة بيانات');}
function refuse(status,code,message,details){const error=new AppError(status,code,message);if(details)error.details=details;throw error;}

// معاملات العمل الإضافي من سياسة ساعات العمل المقبولة في التاريخ، أو null إن لم تُقبل بعد.
export function overtimePolicy(db,tenantId,date){
  const policy=acceptedPolicy(db,tenantId,'working_time',date);if(!policy)return null;
  const p=JSON.parse(policy.parameters);
  return p.overtime?{policy_id:policy.id,workdays:p.workdays,...p.overtime,citation:p.citations?.overtime??''}:null;
}
// نوع اليوم: عطلة رسمية معتمدة، أو يوم راحة (خارج أيام الوردية أو السياسة)، أو يوم عمل. سقف العطلة يسري على الراحة والعطلة معًا (م77(8)).
export function dayType(db,user,date,workdays){
  if(db.prepare("SELECT 1 FROM public_holidays WHERE tenant_id=? AND holiday_date=? AND status='approved'").get(user.tenant_id,date))return 'holiday';
  const shift=db.prepare('SELECT workdays_json FROM shift_assignments WHERE user_id=? AND from_date<=? AND to_date>=? ORDER BY created_at DESC LIMIT 1').get(user.id,date,date);
  return (shift?JSON.parse(shift.workdays_json):workdays).includes(weekday(date))?'working':'rest';
}
export const capFor=(policy,type)=>type==='working'?policy.daily_cap_minutes:policy.holiday_cap_minutes;
// أيام العمل التي يُقرأ منها نوع اليوم: سياسة ساعات العمل المعتمدة في التاريخ، وبلا سياسة نص م73(1) (ص 25: الجمعة والسبت راحة).
export function workdaysFor(db,tenantId,date){const policy=acceptedPolicy(db,tenantId,'working_time',date);return policy?JSON.parse(policy.parameters).workdays:[...REGULATION_WORKDAYS];}
export const dayTypeFor=(db,user,date)=>dayType(db,user,date,workdaysFor(db,user.tenant_id,date));
// ── حدّ اللهجة هنا ──: ART77_9 أدناه **اقتباس من نظام العمل بحرفه** كما طُبع في النسخة الموقعة، فلا يُحوَّل إلى لهجة:
// إعادة صياغته تُخرجه من كونه اقتباسًا، وكونه اقتباسًا هو سبب حجّيته. الجملة التي تسبقه في رسالة الرفض («عندك عمل
// إضافي… داخل هذي المدة») كلام المنصة عن المادة، فهي لهجة. ورقم المادة يبقى كما هو في الحالتين.
// م77(9) كما طُبعت (ص 27 من النسخة الموقعة): «لا يجوز الجمع بين أجر العمل خارج أوقات الدوام الرسمي خلال أيام العمل المعتادة، والتكليف بمهمة رسمية».
// نطاقها أيام العمل المعتادة وحدها: عمل إضافي في يوم راحة أسبوعية أو عطلة رسمية أثناء مهمة لا تمنعه هذه الفقرة، والمنع كان يشمل كل يوم فيتجاوز النص.
export const ART77_9='م77(9) (ص 27 من النسخة الموقعة): لا يجوز الجمع بين أجر العمل خارج أوقات الدوام الرسمي خلال أيام العمل المعتادة والتكليف بمهمة رسمية — في أيام العمل المعتادة وحدها؛ يوم راحة أسبوعية أو عطلة رسمية أثناء المهمة خارج نطاق هذه الفقرة';
// أول يوم عمل معتاد من الأيام المعطاة تتقاطع معه مهمة قائمة أو معتمدة، أو null. days: [{date,type}].
export function missionClash(db,user,days){
  for(const d of days){if(d.type!=='working')continue;const mission=missionOverlap(db,user.id,d.date,d.date);if(mission)return {...mission,date:d.date};}
  return null;
}
// عكسه: أول يوم عمل معتاد في مدة مهمة يحمل عملًا إضافيًا (طلبًا أو تكليفًا)، أو null. نوع اليوم من الطلب إن سُجل معه، وإلا يُحسب.
export function overtimeOnWorkingDays(db,user,from,to){
  for(const r of db.prepare("SELECT work_date,day_type FROM overtime_requests WHERE user_id=? AND status IN ('pending','approved') AND work_date BETWEEN ? AND ? ORDER BY work_date").all(user.id,from,to))
    if((r.day_type??dayTypeFor(db,user,r.work_date))==='working')return {kind:'request',date:r.work_date};
  for(const a of db.prepare("SELECT days_json FROM overtime_assignments WHERE user_id=? AND status IN ('proposed','authorised','budget_approved') AND to_date>=? AND from_date<=? ORDER BY from_date").all(user.id,from,to)){
    const day=JSON.parse(a.days_json).find(d=>d.date>=from&&d.date<=to&&d.type==='working');
    if(day)return {kind:'assignment',date:day.date};
  }
  return null;
}

// أساس الأجر من العقد الساري في التاريخ: الأجر الفعلي (كل البنود) والأساسي، بالهللات.
export function wageBasis(db,userId,date){
  const c=db.prepare("SELECT pay_lines,monthly_total_minor FROM employment_contracts WHERE user_id=? AND status IN ('active','ended') AND start_date<=? AND COALESCE(ended_on,end_date,'9999-12-31')>=? ORDER BY start_date DESC LIMIT 1").get(userId,date,date);
  if(!c)return null;
  const basic=JSON.parse(c.pay_lines).find(l=>l.component==='basic')?.amount_minor??0;
  return {actual_minor:c.monthly_total_minor,basic_minor:basic};
}
export function suggestedMinor(db,userId,date,minutes,policy){const wage=policy&&wageBasis(db,userId,date);return wage?overtimeAmountMinor(minutes,wage,policy):null;}
// ما حُوِّل إلى المسير عن عمل إضافي في السنة الميلادية لتاريخ العمل (المقترح والمعتمد).
// يشمل ما أُحيل من رصيد إجازة تعويضية انقضت مهلته أو انتهت خدمة صاحبه (ترحيل 125): أجر عمل إضافي كغيره، فلا يُتجاوز به السقف السنوي (م77(5)).
export function annualPaidMinor(db,userId,year){
  const from=`${year}-01-01`,to=`${year}-12-31`;
  return db.prepare("SELECT COALESCE(SUM(a.amount_minor),0) AS n FROM overtime_requests o JOIN payroll_adjustments a ON a.id=o.adjustment_id WHERE o.user_id=? AND o.work_date BETWEEN ? AND ? AND a.status IN ('proposed','approved')").get(userId,from,to).n
    +db.prepare("SELECT COALESCE(SUM(a.amount_minor),0) AS n FROM compensatory_payouts p JOIN compensatory_credits c ON c.id=p.credit_id JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.user_id=? AND c.work_date BETWEEN ? AND ? AND a.status IN ('proposed','approved')").get(userId,from,to).n;
}
// مهمة قائمة أو معتمدة تتقاطع مع الأيام. قراءة صرفة؛ نطاق م77(9) (أيام العمل المعتادة) تطبقه missionClash وovertimeOnWorkingDays لا هذه.
export function missionOverlap(db,userId,from,to){
  return db.prepare("SELECT from_date,to_date,destination FROM work_missions WHERE user_id=? AND status IN ('pending','approved') AND to_date>=? AND from_date<=? LIMIT 1").get(userId,from,to)??null;
}
// حمل الأسبوع: لكل يوم أكبر الاثنين — المكلف به في تكليف قائم، أو المسجل فعليًا — ثم يُجمع.
export function weekLoad(db,userId,date,{skipAssignment=null,skipRequest=null}={}){
  const {from,to}=weekOf(date),load=new Map();
  for(const a of db.prepare("SELECT id,days_json,minutes_per_day FROM overtime_assignments WHERE user_id=? AND status IN ('proposed','authorised','budget_approved') AND to_date>=? AND from_date<=?").all(userId,from,to))
    if(a.id!==skipAssignment)for(const d of JSON.parse(a.days_json))if(d.date>=from&&d.date<=to)load.set(d.date,Math.max(load.get(d.date)??0,a.minutes_per_day));
  for(const r of db.prepare("SELECT id,work_date,minutes FROM overtime_requests WHERE user_id=? AND status IN ('pending','approved') AND work_date BETWEEN ? AND ?").all(userId,from,to))
    if(r.id!==skipRequest)load.set(r.work_date,Math.max(load.get(r.work_date)??0,r.minutes));
  return {from,to,load};
}
// يرفض ما يتجاوز سقف اليوم بحسب نوعه أو السقف الأسبوعي. days: [{date,minutes}] أيام الطلب الجديد.
export function enforceCaps(db,user,policy,days,skip={}){
  for(const d of days){
    const type=d.type??dayType(db,user,d.date,policy.workdays),cap=capFor(policy,type);
    if(d.minutes>cap)refuse(409,type==='working'?'daily_cap':'holiday_cap',`${d.date} ${DAY_TYPES[type]}: السقف ${hours(cap)} (م77(8))، وانت طالب ${hours(d.minutes)}`,{cap_minutes:cap,day_type:type});
  }
  const weeks=new Map();
  for(const d of days){const w=weekOf(d.date).from;if(!weeks.has(w))weeks.set(w,weekLoad(db,user.id,d.date,skip));weeks.get(w).load.set(d.date,Math.max(weeks.get(w).load.get(d.date)??0,d.minutes));}
  for(const [,w] of weeks){
    const total=[...w.load.values()].reduce((n,m)=>n+m,0);
    if(total>policy.weekly_cap_minutes)refuse(409,'weekly_cap',`أسبوع ${w.from}: مجموع العمل الإضافي ${hours(total)} يتعدّى السقف الأسبوعي ${hours(policy.weekly_cap_minutes)} (م77(8))`,{cap_minutes:policy.weekly_cap_minutes,total_minutes:total});
  }
}

// D-07: التكليف المسبق يحتاج أربعة أشخاص متمايزين وتصريحين، أحدهما بلا دور افتراضي. الخطوة الواقفة ومن يفتحها
// تُحسبان هنا مرة واحدة، فتقرأهما اللوحة كما يقرأهما الرفض، ولا يبقى التكليف واقفًا بلا بيان.
const ASSIGNMENT_ACTIONS={authorise_assignment:'موافقة صاحب الصلاحية',approve_assignment_budget:'اعتماد الميزانية',reject_assignment:'الرفض',cancel_assignment:'الإلغاء',record_overtime:'تسجيل الساعات الفعلية'};
export function assignmentGap(db,a){
  if(a.status==='proposed')return {step:'authorise_assignment',step_name:'موافقة صاحب الصلاحية المسبقة على التكليف (م77(3)، البند الأول)',
    ...capabilityGap(db,a.tenant_id,'hr.attendance.approve',{exclude:[a.assigned_by,a.user_id]}),
    separation:'لا يوافق عليه من كتب التكليف ولا الموظف المكلَّف'};
  if(a.status==='authorised')return {step:'approve_assignment_budget',step_name:'ميزانية معتمدة وموافقة مكتوبة من إدارة الموارد البشرية (م77(7))',
    ...capabilityGap(db,a.tenant_id,'hr.attendance.manage',{exclude:[a.assigned_by,a.authorised_by,a.user_id]}),
    separation:'لا يعتمد الميزانية من كتب التكليف ولا من وافق عليه ولا الموظف المكلَّف، فالمسار يحتاج أربعة أشخاص متمايزين'};
  return null;
}
function assignmentView(db,u,a){
  const days=JSON.parse(a.days_json),pending=a.status==='proposed',authorised=a.status==='authorised';
  const actions=[];
  if(pending&&a.assigned_by!==u.id&&a.user_id!==u.id&&u.caps.includes('hr.attendance.approve'))actions.push('authorise_assignment','reject_assignment');
  if(authorised&&![a.assigned_by,a.authorised_by,a.user_id].includes(u.id)&&u.caps.includes('hr.attendance.manage'))actions.push('approve_assignment_budget','reject_assignment');
  if((pending||authorised)&&a.assigned_by===u.id)actions.push('cancel_assignment');
  if(a.status==='budget_approved'&&a.user_id===u.id){
    const recorded=new Set(db.prepare("SELECT work_date FROM overtime_requests WHERE assignment_id=? AND status IN ('pending','approved')").all(a.id).map(r=>r.work_date));
    if(days.some(d=>d.date<=riyadhDate()&&!recorded.has(d.date)))actions.push('record_overtime');
  }
  const seesBudget=u.id===a.user_id||u.caps.includes('hr.attendance.manage')||u.caps.includes('payroll.prepare');
  const gap=assignmentGap(db,a);
  return {...a,days,status_name:ASSIGNMENT_STATUS[a.status],employee_name:name(db,a.user_id),assigned_by_name:name(db,a.assigned_by),authorised_by_name:name(db,a.authorised_by),budget_by_name:name(db,a.budget_by),closed_by_name:name(db,a.closed_by),
    budget:seesBudget?sar(a.budget_minor):null,
    // الخطوة الواقفة ومن يفتحها يراهما الموظف كما يراهما من يقرر، فلا يبقى «لا يبدأ قبل موافقة صاحب الصلاحية» ثم لا شيء.
    next_step:gap?{step:gap.step,step_name:gap.step_name,capability:gap.capability,capability_name:gap.capability_name,
      blocked:!gap.satisfied,holders:gap.holders,granted_by:gap.granted_by,text:gap.text,separation:gap.separation}:null,
    actions};
}
export function assignmentsFor(db,u){
  const hr=u.caps.includes('hr.attendance.manage')||u.caps.includes('hr.attendance.approve')||u.caps.includes('payroll.prepare');
  const rows=hr?db.prepare('SELECT * FROM overtime_assignments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').all(u.tenant_id)
    :db.prepare('SELECT * FROM overtime_assignments WHERE tenant_id=? AND (user_id=? OR assigned_by=? OR user_id IN (SELECT id FROM users WHERE manager_id=?)) ORDER BY created_at DESC LIMIT 100').all(u.tenant_id,u.id,u.id,u.id);
  return rows.map(a=>assignmentView(db,u,a));
}

// 1) التكليف المسبق: من المدير المباشر، لأيام تبدأ من اليوم، ولا يتجاوز 14 يومًا.
export function assignOvertime(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','from_date','to_date','minutes_per_day','reason']);
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id,tenant_id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا في نطاقك');
  if(person.id===u.id)fail(409,'separation_of_duties','ما ينفع الموظف يكلّف نفسه بعمل إضافي');
  if(!isManagerOf(db,u,person.id))fail(403,'not_permitted','التكليف بالعمل الإضافي لمدير الموظف المباشر: مدير الإدارة هو اللي يقرّ العمل الإضافي (م77(2))، ويكون بتكليف كتابي أو إلكتروني (م76(1))');
  const from=v.date(input.from_date),to=v.date(input.to_date),today=riyadhDate();
  if(to<from)fail(400,'date_order','خلّ تاريخ النهاية بعد تاريخ البداية');
  if(from<today)fail(400,'prior_assignment','التكليف مسبق: يبدأ من اليوم ولا بعده. واللي مضى يُطلب «بأثر رجعي» ومعه تبرير');
  if(to>addDays(from,13))fail(400,'range_too_long','التكليف الواحد 14 يوم على الأكثر');
  if(!Number.isInteger(input.minutes_per_day)||input.minutes_per_day<15||input.minutes_per_day>720||input.minutes_per_day%15)fail(400,'minutes','المدة اليومية بالدقايق من 15 لين 720، وبخطوات 15 دقيقة');
  const policy=overtimePolicy(db,u.tenant_id,from);
  if(!policy)fail(409,'policy_required','ما فيه سياسة ساعات عمل مقبولة من مدير الموارد البشرية فيها قواعد العمل الإضافي (م76–77)');
  if(db.prepare("SELECT 1 FROM overtime_assignments WHERE user_id=? AND status IN ('proposed','authorised','budget_approved') AND to_date>=? AND from_date<=?").get(person.id,from,to))fail(409,'overlapping_assignment','للموظف تكليف قائم يتقاطع مع هذي الأيام');
  const days=[];for(let d=from;d<=to;d=addDays(d,1))days.push({date:d,type:dayType(db,person,d,policy.workdays),minutes:input.minutes_per_day});
  // م77(9) على أيام العمل المعتادة من التكليف وحدها: يوم راحة أو عطلة داخل المهمة لا يمنعه النص.
  const clash=missionClash(db,person,days);
  if(clash)fail(409,'mission_overlap',`للموظف مهمة عمل (${clash.destination}) ${dateRange(clash.from_date,clash.to_date)} تتقاطع مع يوم العمل المعتاد ${clash.date} في التكليف. ${ART77_9}`);
  enforceCaps(db,person,policy,days);
  const assignmentId=id();
  db.prepare("INSERT INTO overtime_assignments(id,tenant_id,user_id,from_date,to_date,minutes_per_day,days_json,reason,policy_id,status,assigned_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'proposed',?,?)")
    .run(assignmentId,u.tenant_id,person.id,from,to,input.minutes_per_day,JSON.stringify(days.map(({date,type})=>({date,type}))),v.text(input.reason,'العمل المطلوب وسبب الحاجة',2000,10),policy.policy_id,u.id,now());
  audit(db,u,'overtime_assignment',assignmentId,'overtime_assignment.written',{}, {user_id:person.id,from_date:from,to_date:to,minutes_per_day:input.minutes_per_day});
  // D-07: الإشعار يقول بمن تقف الخطوة، وإن لم يحملها أحد قاله صراحة بدل أن ينتظر الموظف ما لا يأتي.
  const gap=assignmentGap(db,db.prepare('SELECT * FROM overtime_assignments WHERE id=?').get(assignmentId));
  notifySubject(db,{userId:person.id,kind:'overtime_assignment_written',subjectKind:'overtime_assignment',subjectId:assignmentId,title:`كتب مديرك تكليفًا بعمل إضافي ${dateRange(from,to)}`,
    body:gap&&!gap.satisfied
      ?`لا يبدأ قبل موافقة صاحب الصلاحية واعتماد الموارد البشرية لميزانيته، ولا حساب يحمل تصريح «${gap.capability_name}» الآن. راجع مديرك أو مسؤول الصلاحيات.`
      :'لا يبدأ قبل موافقة صاحب الصلاحية واعتماد الموارد البشرية لميزانيته. ستصلك رسالة عند كل قرار.'});
  return {id:assignmentId};
}

export function decideAssignment(db,supplied,assignmentId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note','version']);
  const a=typeof assignmentId==='string'&&db.prepare('SELECT * FROM overtime_assignments WHERE id=? AND tenant_id=?').get(assignmentId,u.tenant_id);
  if(!a)fail(404,'not_found','ما لقينا التكليف هذا');
  if(input.version!==undefined)v.version(input.version,a.version);
  const view=assignmentView(db,u,a),time=now();
  const step={authorise:'authorise_assignment',budget:'approve_assignment_budget',reject:'reject_assignment',cancel:'cancel_assignment'}[decision];
  if(!step)fail(404,'not_found','ما فيه خطوة تنتظرك في هذا التكليف');
  // D-07 وD-14: الرفض يسمّي الخطوة الواقفة والتصريح الناقص ومن يحمله ومن يمنحه، لا «الإجراء غير متاح» وحدها.
  if(!view.actions.includes(step)){
    const gap=assignmentGap(db,a);
    v.actionUnavailable(step,{subject:`تكليف ${view.employee_name} بعمل إضافي ${dateRange(a.from_date,a.to_date)}`,state_name:ASSIGNMENT_STATUS[a.status],
      names:ASSIGNMENT_ACTIONS,available:view.actions,
      reason:gap&&step===gap.step?`هذه الخطوة تحتاج تصريح «${gap.capability_name}» (${gap.capability})، و${gap.separation}`
        :gap?`الخطوة الواقفة الآن هي ${gap.step_name}`:'حالة التكليف لا تقبل هذا الإجراء',
      who:gap?gap.text:null});
  }
  let note,title,body;
  if(decision==='authorise'){
    note=v.text(input.note,'موافقة صاحب الصلاحية',1000,3);
    db.prepare("UPDATE overtime_assignments SET status='authorised',authorised_by=?,authorised_at=?,authorisation_note=?,version=version+1 WHERE id=?").run(u.id,time,note,a.id);
    title=`وافق صاحب الصلاحية على تكليفك بعمل إضافي ${dateRange(a.from_date,a.to_date)}`;body='بقي اعتماد الموارد البشرية لميزانيته قبل أن يبدأ.';
  }else if(decision==='budget'){
    note=v.text(input.note,'اعتماد الميزانية كتابة',1000,10);
    const policy=overtimePolicy(db,u.tenant_id,a.from_date),days=JSON.parse(a.days_json);
    if(!policy)fail(409,'policy_required','قواعد العمل الإضافي ما عادت سارية في تاريخ التكليف');
    const estimate=days.reduce((n,d)=>{const m=suggestedMinor(db,a.user_id,d.date,a.minutes_per_day,policy);return m===null||n===null?null:n+m;},0);
    if(estimate!==null){
      const wage=wageBasis(db,a.user_id,a.from_date),year=a.from_date.slice(0,4),used=annualPaidMinor(db,a.user_id,year),cap=annualCapMinor(wage.basic_minor,policy);
      if(used+estimate>cap)refuse(409,'annual_cap',`الميزانية تتعدّى السقف السنوي لأجر العمل الإضافي (${policy.annual_cap_basic_months} أشهر من الأساسي، م77(5)) — الباقي ${sar(Math.max(0,cap-used))} ريال`,{remaining_minor:Math.max(0,cap-used)});
    }
    db.prepare("UPDATE overtime_assignments SET status='budget_approved',budget_by=?,budget_at=?,budget_note=?,budget_minor=?,version=version+1 WHERE id=?").run(u.id,time,note,estimate,a.id);
    title=`اعتُمد تكليفك بعمل إضافي ${dateRange(a.from_date,a.to_date)}`;body=`سجّل ساعاتك الفعلية على التكليف في «حضوري» بعد إنجازها، بحد ${hours(a.minutes_per_day)} في اليوم.`;
  }else{
    note=v.text(input.note,decision==='cancel'?'سبب الإلغاء':'سبب الرفض',1000,10);
    db.prepare('UPDATE overtime_assignments SET status=?,closed_by=?,closed_at=?,close_note=?,version=version+1 WHERE id=?').run(decision==='cancel'?'cancelled':'rejected',u.id,time,note,a.id);
    title=decision==='cancel'?`أُلغي تكليفك بعمل إضافي ${dateRange(a.from_date,a.to_date)}`:`رُفض تكليفك بعمل إضافي ${dateRange(a.from_date,a.to_date)}`;body='السبب مكتوب في شاشة الحضور. لا يُسجَّل عمل إضافي على هذا التكليف.';
  }
  audit(db,u,'overtime_assignment',a.id,'overtime_assignment.'+decision,{status:a.status},{version:a.version+1});
  notifySubject(db,{userId:a.user_id,kind:'overtime_assignment_'+decision,subjectKind:'overtime_assignment',subjectId:a.id,title,body});
  return assignmentView(db,u,db.prepare('SELECT * FROM overtime_assignments WHERE id=?').get(a.id));
}
