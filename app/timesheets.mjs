import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, isSuperAdmin } from './access.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { logTime } from './agency.mjs';
import { addDays, weekStart, weekEnd } from './resource-weeks.mjs';
import { timesheetNotice } from './module-notices.mjs';
import { notifySubject } from './notices.mjs';

// اعتماد كشوف الوقت: الأسبوع وحدة القرار، لا الإدخال المفرد.
// الساعة المعتمدة يُبنى عليها حساب الربحية والاستغلال والفوترة، فهي لا تُعدَّل بعد الاعتماد إطلاقًا؛
// والتصحيح إدخال جديد في أسبوع لاحق يشير إلى الأصل. الفرض في SQL لا في هذا الملف وحده.
// «قابل للفوترة» قرار المعتمِد: يُختم على الإدخال ويُحفظ معه ما ادّعاه المُسجِّل قبل الختم.

const STATUS={open:'مفتوح',submitted:'مُرسَل',approved:'معتمد',returned:'مُعاد',locked:'مقفل'};
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());

function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة كشوف الوقت تبي معاملة قاعدة بيانات');}
function actor(db,supplied){
  const c=currentUser(db,supplied);
  if(!c||c.role==='admin')fail(403,'forbidden','كشوف الوقت لحسابات الموظفين وبس');
  return c;
}
const approver=(db,u)=>can(db,u,'timesheets.approve');
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function sunday(value,label='بداية الأسبوع'){
  const date=v.date(value);
  if(weekStart(date)!==date)fail(400,'week_start',`${label}: الأسبوع يبدأ يوم الأحد`);
  return date;
}
function lockWindow(db,tenantId){
  return db.prepare('SELECT * FROM timesheet_lock_settings WHERE tenant_id=?').get(tenantId)??null;
}
// يوم يُقفل قبله كل شيء. بلا إعداد المالك لا يوجد حد أصلًا، ولا يخترع الكود مدة.
function lockCutoff(db,tenantId,asOf=today()){
  const setting=lockWindow(db,tenantId);
  return setting?addDays(asOf,-setting.lock_after_days):null;
}

function entriesOf(db,tenantId,userId,from,to){
  return db.prepare(`SELECT t.id,t.work_date,t.minutes,t.billable,t.note,t.status,t.project_id,p.name AS project_name,
      d.billable AS approved_billable,d.claimed_billable,d.decided_at,d.decided_by,
      c.original_entry_id,c.reason AS correction_reason
    FROM time_entries t JOIN projects p ON p.id=t.project_id
    LEFT JOIN timesheet_entry_decisions d ON d.entry_id=t.id
    LEFT JOIN timesheet_corrections c ON c.correction_entry_id=t.id
    WHERE t.tenant_id=? AND t.user_id=? AND t.work_date BETWEEN ? AND ? AND t.status<>'rejected'
    ORDER BY t.work_date,t.created_at`).all(tenantId,userId,from,to)
    .map(t=>({...t,billable:!!t.billable,approved_billable:t.approved_billable===null?null:!!t.approved_billable,claimed_billable:t.claimed_billable===null?null:!!t.claimed_billable,is_correction:!!t.original_entry_id}));
}

function periodShell(db,tenantId,userId,week){
  const row=db.prepare('SELECT * FROM timesheet_periods WHERE tenant_id=? AND user_id=? AND week_start=?').get(tenantId,userId,week);
  return row??{id:null,tenant_id:tenantId,user_id:userId,week_start:week,week_end:weekEnd(week),status:'open',submitted_at:null,approved_by:null,approved_at:null,decision_note:'',locked_by:null,locked_at:null,version:0};
}
function periodActions(db,u,p,canApprove){
  const actions=[];
  if(p.user_id===u.id){
    if(['open','returned'].includes(p.status)&&p.week_start<=today())actions.push('submit_timesheet');
  } else if(canApprove&&p.status==='submitted'&&isManagerOf(db,u,p.user_id))actions.push('approve_timesheet','return_timesheet');
  return actions;
}
function decorate(db,u,p,canApprove){
  const entries=entriesOf(db,p.tenant_id,p.user_id,p.week_start,p.week_end);
  const minutes=entries.reduce((n,t)=>n+t.minutes,0);
  const decided=entries.filter(t=>t.approved_billable!==null);
  return {...p,status_name:STATUS[p.status],employee_name:personName(db,p.user_id),
    approved_by_name:personName(db,p.approved_by),locked_by_name:personName(db,p.locked_by),
    entries,entry_count:entries.length,minutes,
    billable_minutes:decided.filter(t=>t.approved_billable).reduce((n,t)=>n+t.minutes,0),
    decided_minutes:decided.reduce((n,t)=>n+t.minutes,0),
    // القفل بلا اعتماد حالة قائمة: أسبوع لم يرسله صاحبه ومضت مدة المالك. تُعلن ولا تُخفى.
    locked_without_approval:p.status==='locked'&&!p.approved_by,
    actions:periodActions(db,u,p,canApprove)};
}

export function timesheetsBoard(db,supplied,weekDate){
  const u=actor(db,supplied),day=today(),canApprove=approver(db,u);
  const week=weekStart(weekDate?v.date(weekDate):day),setting=lockWindow(db,u.tenant_id);
  const mine=decorate(db,u,periodShell(db,u.tenant_id,u.id,week),canApprove);
  const team=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 AND role<>'admin' ORDER BY name,id").all(u.tenant_id,u.id);
  const teamWeeks=canApprove?team.map(person=>decorate(db,u,periodShell(db,u.tenant_id,person.id,week),canApprove)):[];
  const pending=canApprove?db.prepare(`SELECT p.* FROM timesheet_periods p JOIN users x ON x.id=p.user_id
      WHERE p.tenant_id=? AND p.status='submitted' AND x.manager_id=? AND x.active=1 ORDER BY p.week_start,p.user_id`).all(u.tenant_id,u.id)
    .map(p=>decorate(db,u,p,canApprove)):[];
  // من لم يرسل أسبوعًا انتهى: قائمة صريحة، والتنبيه فعل يقرره المدير لا رسالة تنطلق وحدها.
  const missing=weekEnd(week)<day?teamWeeks.filter(p=>['open','returned'].includes(p.status)).map(p=>({user_id:p.user_id,name:p.employee_name,week_start:p.week_start,status:p.status,entry_count:p.entry_count,
    reminded_at:db.prepare('SELECT created_at FROM timesheet_reminders WHERE tenant_id=? AND user_id=? AND week_start=?').get(u.tenant_id,p.user_id,week)?.created_at??null})):[];
  const myReminders=db.prepare('SELECT * FROM timesheet_reminders WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20').all(u.tenant_id,u.id);
  const correctable=entriesOf(db,u.tenant_id,u.id,addDays(day,-120),day)
    .filter(t=>t.approved_billable!==null||t.status==='approved')
    .map(t=>({id:t.id,work_date:t.work_date,project_id:t.project_id,project_name:t.project_name,minutes:t.minutes,billable:t.approved_billable??t.billable}));
  const lockable=canApprove&&setting?db.prepare(`SELECT COUNT(*) AS n FROM timesheet_periods p JOIN users x ON x.id=p.user_id AND x.tenant_id=p.tenant_id
    WHERE p.tenant_id=? AND x.manager_id=? AND p.status NOT IN ('locked','submitted') AND p.week_end<?`).get(u.tenant_id,u.id,lockCutoff(db,u.tenant_id,day)).n:0;
  return {timezone:'Asia/Riyadh',today:day,user_id:u.id,
    week:{from:week,to:weekEnd(week),previous:addDays(week,-7),next:addDays(week,7),closed:weekEnd(week)<day},
    status_names:STATUS,can_approve:canApprove,
    lock:setting?{lock_after_days:setting.lock_after_days,basis:setting.basis,updated_at:setting.updated_at,updated_by_name:personName(db,setting.updated_by),version:setting.version,cutoff:lockCutoff(db,u.tenant_id,day)}:null,
    lockable_periods:lockable,my_period:mine,team_weeks:teamWeeks,pending,missing,reminders:myReminders,correctable,
    note:'الأسبوع المعتمد لا تُعدَّل إدخالاته: التصحيح إدخال في أسبوع لاحق يشير إلى الأصل. «قابل للفوترة» قرار المعتمِد لا المُسجِّل. '+
      (setting?`القفل المجدول مفعّل: كل ما قبل ${lockCutoff(db,u.tenant_id,day)} لا يقبل إدخالًا بأثر رجعي.`:'لم تُدخل مدة القفل المجدول بعد، فلا يقفل شيء آليًا ولا تفترض المنصة مدة.')+
      ' التذكير داخل المنصة فقط: لا مزوّد بريد مربوط.'};
}

/* ───── إرسال الأسبوع ───── */
export function submitTimesheet(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['week_start','note']);
  const week=sunday(input.week_start),day=today();
  if(week>day)fail(400,'week_start','ما ينرسل أسبوع ما بدأ');
  const cutoff=lockCutoff(db,u.tenant_id,day);
  if(cutoff&&weekEnd(week)<cutoff)fail(409,'window_closed','مدة القفل اللي حددها المالك على هذا الأسبوع خلصت');
  const entries=entriesOf(db,u.tenant_id,u.id,week,weekEnd(week));
  if(!entries.length)fail(409,'empty_week','ما فيه ساعات مسجّلة في هذا الأسبوع');
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة الإرسال',1000);
  const current=periodShell(db,u.tenant_id,u.id,week);
  if(!['open','returned'].includes(current.status))fail(409,'not_open',`الأسبوع ${STATUS[current.status]} — ما ينرسل مرة ثانية`);
  let pid=current.id;
  if(pid)db.prepare("UPDATE timesheet_periods SET status='submitted',submitted_at=?,submit_note=?,revision=revision+1,version=version+1,updated_at=? WHERE id=?").run(now(),note,now(),pid);
  else{
    pid=id();
    db.prepare("INSERT INTO timesheet_periods(id,tenant_id,user_id,week_start,week_end,status,submitted_at,submit_note,created_at,updated_at) VALUES(?,?,?,?,?,'submitted',?,?,?,?)")
      .run(pid,u.tenant_id,u.id,week,weekEnd(week),now(),note,now(),now());
  }
  audit(db,u,'timesheet_period',pid,'timesheet.submitted',{status:current.status},{status:'submitted',week_start:week,entries:entries.length,minutes:entries.reduce((n,t)=>n+t.minutes,0)},note);
  timesheetNotice(db,u,'submitted',{id:pid,user_id:u.id,week_start:week});
  return getPeriod(db,u,pid);
}

export function getPeriod(db,supplied,periodId){
  const u=actor(db,supplied);
  const p=typeof periodId==='string'&&db.prepare('SELECT * FROM timesheet_periods WHERE id=? AND tenant_id=?').get(periodId,u.tenant_id);
  if(!p||(p.user_id!==u.id&&!(approver(db,u)&&isManagerOf(db,u,p.user_id))))fail(404,'not_found','ما لقينا الأسبوع هذا');
  return decorate(db,u,p,approver(db,u));
}

/* ───── قرار المدير: اعتماد بختم «قابل للفوترة» لكل إدخال، أو إعادة بسبب مكتوب ───── */
export function decideTimesheet(db,supplied,periodId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!['approve','return'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا إرجاع');
  v.object(input,decision==='approve'?['version','note','entries']:['version','note']);
  if(!approver(db,u))fail(403,'not_permitted','اعتماد كشوف الوقت يبي تصريح timesheets.approve');
  const p=typeof periodId==='string'&&db.prepare("SELECT * FROM timesheet_periods WHERE id=? AND tenant_id=? AND status='submitted'").get(periodId,u.tenant_id);
  if(!p)fail(404,'not_found','ما لقينا أسبوع ينتظر قرار');
  v.version(input.version,p.version);
  // فصل المهام بالهوية، مكرَّرًا هنا وفي CHECK على الجدول: الموظف لا يعتمد أسبوعه.
  if(p.user_id===u.id)fail(403,'separation_of_duties','ما تعتمد أسبوعك بنفسك');
  if(!isManagerOf(db,u,p.user_id))fail(403,'forbidden','اللي يعتمد الأسبوع هو مدير صاحبه المباشر');
  if(decision==='return'){
    const note=v.text(input.note,'سبب الإعادة',2000,10);
    db.prepare("UPDATE timesheet_periods SET status='returned',decision_note=?,version=version+1,updated_at=? WHERE id=?").run(note,now(),p.id);
    audit(db,u,'timesheet_period',p.id,'timesheet.returned',{status:p.status,version:p.version},{status:'returned',version:p.version+1},note);
    timesheetNotice(db,u,'return',p);
    return getPeriod(db,u,p.id);
  }
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة الاعتماد',2000);
  const entries=entriesOf(db,p.tenant_id,p.user_id,p.week_start,p.week_end);
  if(!entries.length)fail(409,'empty_week','ما فيه ساعات في هذا الأسبوع');
  if(!Array.isArray(input.entries)||input.entries.length!==entries.length)fail(400,'entries','المعتمِد يحدد قابلية الفوترة لكل إدخال في الأسبوع');
  const decided=new Map();
  for(const row of input.entries){
    v.object(row,['entry_id','billable']);
    if(typeof row.entry_id!=='string'||typeof row.billable!=='boolean')fail(400,'entries','كل إدخال له معرّفه وقرار قابلية الفوترة');
    if(decided.has(row.entry_id))fail(400,'entries','فيه إدخال متكرر في قرار الاعتماد');
    decided.set(row.entry_id,row.billable);
  }
  const stamp=now();
  for(const entry of entries){
    if(!decided.has(entry.id))fail(400,'entries','إدخال بلا قرار قابلية فوترة: '+entry.work_date);
    const billable=decided.get(entry.id);
    // الإدخال الذي حسمه مسار الساعات المفرد سابقًا لا يُعاد فتحه: يوافق القرار أو يُصحَّح بإدخال لاحق.
    if(entry.status==='logged')db.prepare("UPDATE time_entries SET status='approved',billable=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(billable?1:0,u.id,stamp,note,entry.id);
    else if(entry.billable!==billable)fail(409,'entry_already_decided','إدخال محسوم من قبل بقرار فوترة ثاني — صحّحه بإدخال في أسبوع جاي');
    db.prepare('INSERT INTO timesheet_entry_decisions(id,tenant_id,period_id,entry_id,minutes,claimed_billable,billable,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id(),p.tenant_id,p.id,entry.id,entry.minutes,entry.billable?1:0,billable?1:0,u.id,stamp);
  }
  db.prepare("UPDATE timesheet_periods SET status='approved',approved_by=?,approved_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,stamp,note,stamp,p.id);
  const billableMinutes=entries.filter(t=>decided.get(t.id)).reduce((n,t)=>n+t.minutes,0);
  audit(db,u,'timesheet_period',p.id,'timesheet.approved',{status:p.status,version:p.version},{status:'approved',version:p.version+1,minutes:entries.reduce((n,t)=>n+t.minutes,0),billable_minutes:billableMinutes},note);
  timesheetNotice(db,u,'approve',p);
  return getPeriod(db,u,p.id);
}

/* ───── التصحيح: إدخال في أسبوع لاحق يشير إلى الأصل ───── */
export function logCorrection(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['original_entry_id','work_date','minutes','billable','note','reason']);
  const original=typeof input.original_entry_id==='string'&&db.prepare('SELECT * FROM time_entries WHERE id=? AND tenant_id=? AND user_id=?').get(input.original_entry_id,u.tenant_id,u.id);
  if(!original)fail(404,'not_found','الإدخال الأصلي مو من صلاحيتك');
  const originalWeek=weekStart(original.work_date),period=periodShell(db,u.tenant_id,u.id,originalWeek);
  if(!['approved','locked'].includes(period.status))fail(409,'not_closed','الأسبوع ما اعتُمد لين الحين — عدّل إدخاله على طول بدال التصحيح');
  const date=v.date(input.work_date);
  if(weekStart(date)<=originalWeek)fail(400,'work_date','التصحيح يكون في أسبوع بعد الأسبوع المعتمد');
  const reason=v.text(input.reason,'سبب التصحيح',2000,10);
  // الإدخال نفسه يمر بمسار تسجيل الساعات القائم فتسري عليه قيوده كاملة (العضوية، المدة، سقف اليوم).
  const created=logTime(db,u,{project_id:original.project_id,work_date:date,minutes:input.minutes,billable:input.billable,note:v.text(input.note,'ما الذي يُصحَّح',1000,3)});
  db.prepare('INSERT INTO timesheet_corrections(id,tenant_id,original_entry_id,correction_entry_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,original.id,created.id,reason,u.id,now());
  audit(db,u,'timesheet_period',period.id??original.id,'timesheet.correction',{original_entry_id:original.id},{correction_entry_id:created.id,work_date:date},reason);
  return {id:created.id,original_entry_id:original.id,work_date:date};
}

/* ───── مدة القفل المجدول: إعداد المالك، لا ثابت في الكود ───── */
// مدة القفل إعداد على الكيان كله، فيحددها أدمن المنصة لا مدير فريق واحد يقفل بها أسابيع فرق غيره.
export function setLockWindow(db,supplied,input){
  writing(db);const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');
  v.object(input,['lock_after_days','basis','version']);
  if(!isSuperAdmin(u)&&u.role!=='admin')fail(403,'not_permitted','مدة القفل إعداد على الكيان كله، يحدده أدمن المنصة بسند المالك');
  if(!Number.isInteger(input.lock_after_days)||input.lock_after_days<1||input.lock_after_days>365)fail(400,'lock_after_days','المدة أيام صحيحة من 1 لين 365');
  const basis=v.text(input.basis,'سند المدة ومن أقرّها ومتى',1000,10),current=lockWindow(db,u.tenant_id);
  if(current){
    v.version(input.version,current.version);
    db.prepare('UPDATE timesheet_lock_settings SET lock_after_days=?,basis=?,updated_by=?,updated_at=?,version=version+1 WHERE tenant_id=?').run(input.lock_after_days,basis,u.id,now(),u.tenant_id);
  } else {
    if(input.version!==undefined&&input.version!==0)fail(409,'stale_version','ما فيه مدة قفل محفوظة لين الحين');
    db.prepare('INSERT INTO timesheet_lock_settings(tenant_id,lock_after_days,basis,updated_by,updated_at) VALUES(?,?,?,?,?)').run(u.tenant_id,input.lock_after_days,basis,u.id,now());
  }
  audit(db,u,'timesheet_lock',u.tenant_id,'timesheet.lock_window',{lock_after_days:current?.lock_after_days??null},{lock_after_days:input.lock_after_days},basis);
  return {lock_after_days:input.lock_after_days,cutoff:lockCutoff(db,u.tenant_id)};
}

// القفل المجدول لا يعتمد شيئًا: يمنع الإدخال بأثر رجعي فقط، ويبقى الأسبوع غير المعتمد موسومًا بذلك.
export function lockDuePeriods(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['basis']);
  if(!approver(db,u))fail(403,'not_permitted','القفل يبي تصريح timesheets.approve');
  const cutoff=lockCutoff(db,u.tenant_id);
  if(!cutoff)fail(409,'lock_window_missing','مدة القفل ما انكتبت لين الحين — اكتبها بسندها الأول');
  const basis=v.text(input.basis,'سند تنفيذ القفل',1000,10),stamp=now();
  // القفل لفريق المنفِّذ المباشر وحده، ولا يمس أسبوعًا مرسَلًا ينتظر قرار مديره: القفل لا يسبق القرار.
  const due=db.prepare(`SELECT p.* FROM timesheet_periods p JOIN users x ON x.id=p.user_id AND x.tenant_id=p.tenant_id
    WHERE p.tenant_id=? AND x.manager_id=? AND p.status NOT IN ('locked','submitted') AND p.week_end<? ORDER BY p.week_start,p.user_id`).all(u.tenant_id,u.id,cutoff);
  for(const p of due){
    db.prepare("UPDATE timesheet_periods SET status='locked',locked_by=?,locked_at=?,lock_basis=?,version=version+1,updated_at=? WHERE id=?").run(u.id,stamp,basis,stamp,p.id);
    audit(db,u,'timesheet_period',p.id,'timesheet.locked',{status:p.status},{status:'locked',week_start:p.week_start,approved:p.status==='approved'},basis);
  }
  return {locked:due.length,cutoff,locked_without_approval:due.filter(p=>p.status!=='approved').length};
}

/* ───── التذكير: داخل المنصة فقط ───── */
export function remindMissing(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['week_start']);
  if(!approver(db,u))fail(403,'not_permitted','التذكير لمدير الفريق حامل تصريح timesheets.approve وبس');
  const week=sunday(input.week_start);
  if(weekEnd(week)>=today())fail(409,'week_open','ما نذكّر أحد بأسبوع ما انتهى');
  const team=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name,id").all(u.tenant_id,u.id,u.id);
  const created=[];
  for(const person of team){
    const p=periodShell(db,u.tenant_id,person.id,week);
    if(!['open','returned'].includes(p.status))continue;
    if(db.prepare('SELECT 1 FROM timesheet_reminders WHERE tenant_id=? AND user_id=? AND week_start=?').get(u.tenant_id,person.id,week))continue;
    db.prepare("INSERT INTO timesheet_reminders(id,tenant_id,user_id,week_start,channel,raised_by,created_at) VALUES(?,?,?,?,'in_platform',?,?)").run(id(),u.tenant_id,person.id,week,u.id,now());
    // D-20 (تدقيق مسارات الوحدات، 20 سبتمبر): كان الرد {"created":2} وصفر إشعارات — واجهة تدّعي تذكيرًا لم يقع.
    // الصف في timesheet_reminders أثر التذكير، والإشعار هو التذكير نفسه.
    notifySubject(db,{userId:person.id,kind:'timesheet_reminder',subjectKind:'timesheet',subjectId:p.id??`${person.id}:${week}`,
      title:`تذكير: كشف وقتك لأسبوع ${week} لم يُرسل بعد`,body:'افتح «كشوف الوقت» لتسجيل ساعاتك وإرسال الأسبوع إلى مديرك.'});
    created.push(person.id);
  }
  audit(db,u,'timesheet_period',week,'timesheet.reminded',{}, {week_start:week,people:created.length});
  return {created:created.length,notified:created.length,people:created,channel:'in_platform',note:'تنبيه وإشعار داخل المنصة. لا بريد: لا مزوّد بريد مربوط بعد.'};
}

export function markReminderRead(db,supplied,reminderId){
  writing(db);const u=actor(db,supplied);
  const r=typeof reminderId==='string'&&db.prepare('SELECT * FROM timesheet_reminders WHERE id=? AND tenant_id=? AND user_id=?').get(reminderId,u.tenant_id,u.id);
  if(!r)fail(404,'not_found','ما لقينا التنبيه هذا');
  db.prepare('UPDATE timesheet_reminders SET read_at=? WHERE id=?').run(now(),r.id);
  return {read:true};
}
