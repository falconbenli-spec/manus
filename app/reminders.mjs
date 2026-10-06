import { audit, now, transaction } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, isSuperAdmin } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { registerHandler, hasHandler, enqueue } from './jobs.mjs';
import { WATCHED_KINDS, watchSettings, kindName } from './expiry.mjs';
import { allDueAccrualPeriods } from './leave-accrual.mjs';
import { compensatorySweep } from './leave-compensatory.mjs';
import { obligations } from './obligations.mjs';
import { deliverSubject } from './notice-recipients.mjs';

// التذكيرات اليومية: مهمة reminders.daily مرة واحدة لكل كيان في اليوم، تُنشأ عند 08:00 بتوقيت الرياض أو بعدها.
// مفتاح المهمة `reminders.daily:<التاريخ>` فريد في جدول المهام: إعادة تشغيل الخادم أو تكرار المؤقّت لا ينشئ ثانية،
// وكل تذكير يُسجَّل بمفتاحه في reminder_log فلا يتكرر ولو أُعيدت المهمة. التذكير إشعار داخل المنصة، والبريد يتبع تفضيل صاحبه.
export const DAILY_JOB='reminders.daily';
const DAILY_MINUTE=8*60,RIYADH_OFFSET=3*3600000,DAY=86400000;
// م25 من لائحة تنظيم العمل: يُرفع تقرير المدير عن فترة التجربة قبل نهايتها بأسبوعين.
export const PROBATION_LEAD_DAYS=14;
const DEFAULT_PENDING_DAYS=3;
const iso=time=>new Date(time).toISOString();
export const riyadhParts=at=>{const d=new Date(at+RIYADH_OFFSET);return {date:d.toISOString().slice(0,10),minutes:d.getUTCHours()*60+d.getUTCMinutes()};};
const plusDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const daysUntil=(date,from)=>Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY);
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}

/* ───── الإعداد ───── */
export function reminderSettings(db,tenantId){
  const row=db.prepare('SELECT * FROM reminder_settings WHERE tenant_id=?').get(tenantId);
  return row?{pending_approval_days:row.pending_approval_days,manager_digest:!!row.manager_digest,status:row.status,basis:row.basis,updated_at:row.updated_at,version:row.version}
    :{pending_approval_days:DEFAULT_PENDING_DAYS,manager_digest:true,status:'draft',basis:'',updated_at:null,version:null};
}
export function reminderSettingsView(db,u){
  return {...reminderSettings(db,u.tenant_id),daily_at:'08:00 بتوقيت الرياض',probation_lead_days:PROBATION_LEAD_DAYS,probation_basis:'المادة 25 من لائحة تنظيم العمل: تقرير المدير قبل نهاية التجربة بأسبوعين',
    status_name:reminderSettings(db,u.tenant_id).status==='approved'?'معتمد':'مسودة — يحتاج قرار المالك',can_set:isSuperAdmin(u)};
}
export function setReminderSettings(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=actor(db,supplied);if(!isSuperAdmin(u))fail(403,'forbidden','إعداد التذكيرات للأدمن الأول بقرار المالك');
  v.object(input,['pending_approval_days','manager_digest','basis','version']);
  const days=input.pending_approval_days===null?null:input.pending_approval_days;
  if(days!==null&&(!Number.isInteger(days)||days<1||days>60))fail(400,'pending_approval_days','الأيام من 1 إلى 60، أو فارغ لإيقاف التذكير');
  if(typeof input.manager_digest!=='boolean')fail(400,'manager_digest','حدد تشغيل ملخص المديرين أو إيقافه');
  const basis=v.text(input.basis,'مصدر القرار ومن اتخذه',1000,10),current=db.prepare('SELECT * FROM reminder_settings WHERE tenant_id=?').get(u.tenant_id),time=now();
  if(current){
    v.version(input.version,current.version);
    db.prepare("UPDATE reminder_settings SET pending_approval_days=?,manager_digest=?,status='approved',basis=?,updated_by=?,updated_at=?,version=version+1 WHERE tenant_id=?").run(days,input.manager_digest?1:0,basis,u.id,time,u.tenant_id);
  }else db.prepare("INSERT INTO reminder_settings(tenant_id,pending_approval_days,manager_digest,status,basis,updated_by,updated_at) VALUES(?,?,?,'approved',?,?,?)").run(u.tenant_id,days,input.manager_digest?1:0,basis,u.id,time);
  audit(db,u,'reminder_settings',u.tenant_id,'reminders.settings',current?{pending_approval_days:current.pending_approval_days,manager_digest:!!current.manager_digest}:{},{pending_approval_days:days,manager_digest:input.manager_digest},basis);
  return reminderSettings(db,u.tenant_id);
}
export function lastDailyRun(db,tenantId){
  const row=db.prepare('SELECT payload,status,result,last_error,finished_at,created_at FROM jobs WHERE tenant_id=? AND type=? ORDER BY created_at DESC LIMIT 1').get(tenantId,DAILY_JOB);
  return row?{date:JSON.parse(row.payload).date,status:row.status,result:row.result?JSON.parse(row.result):null,last_error:row.last_error,finished_at:row.finished_at}:null;
}

/* ───── أدوات ───── */
function once(db,tenantId,key,time){return db.prepare('INSERT INTO reminder_log(tenant_id,reminder_key,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(tenantId,key,time).changes===1;}
// حاملو تصريح من غير حسابات إدارة المنصة (التذكير عمل لصاحب الإجراء لا لمسؤول المنصة).
function holders(db,tenantId,capability,cache){
  if(!cache.has(capability))cache.set(capability,db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY id").all(tenantId).filter(x=>can(db,x,capability)).map(x=>x.id));
  return cache.get(capability);
}
const activeUser=(db,tenantId,userId)=>userId?db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(userId,tenantId)??null:null;

/* ───── 1) انتهاء الوثائق والعقود ───── */
// المدة من expiry_watch_settings وحدها. بلا إعداد لا يُرسل شيء، وتُسرد الأنواع التي تحتاج قرار مالك الإجراء.
const RECIPIENT_CAPABILITY=kind=>kind.startsWith('employee.')?'employees.view':kind==='employment_contract'?'hr.contracts.manage':'vendors.manage';
function expiryItems(db,tenantId){
  const items=[];
  for(const r of db.prepare("SELECT d.id,d.user_id,d.doc_type,d.expires_on,x.name FROM employee_documents d JOIN users x ON x.id=d.user_id AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.replaced_by IS NULL AND x.active=1").all(tenantId))
    items.push({id:r.id,kind:`employee.${r.doc_type}`,owner:r.user_id,name:r.name,expires_on:r.expires_on,own_notice:true});
  for(const r of db.prepare("SELECT c.id,c.user_id,c.end_date,x.name FROM employment_contracts c JOIN users x ON x.id=c.user_id AND x.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.status='active' AND c.end_date IS NOT NULL").all(tenantId))
    items.push({id:r.id,kind:'employment_contract',owner:r.user_id,name:r.name,expires_on:r.end_date,own_notice:false});
  for(const r of db.prepare("SELECT d.id,d.kind,d.expires_on,x.code,x.legal_name FROM vendor_documents d JOIN vendors x ON x.id=d.vendor_id WHERE x.tenant_id=? AND d.superseded_by IS NULL AND d.expires_on IS NOT NULL AND x.status IN ('approved','conditional','suspended','requalification')").all(tenantId))
    items.push({id:r.id,kind:`vendor.${r.kind}`,owner:null,name:`${r.code} · ${r.legal_name}`,expires_on:r.expires_on});
  for(const r of db.prepare("SELECT id,code,legal_name,valid_until FROM vendors WHERE tenant_id=? AND valid_until IS NOT NULL AND status IN ('approved','conditional')").all(tenantId))
    items.push({id:r.id,kind:'vendor.qualification',owner:null,name:`${r.code} · ${r.legal_name}`,expires_on:r.valid_until});
  return items.filter(i=>/^\d{4}-\d{2}-\d{2}$/.test(String(i.expires_on)));
}
function expiryReminders(db,tenantId,date,time,cache){
  const settings=watchSettings(db,tenantId),items=expiryItems(db,tenantId),unconfigured=new Set();let sent=0;
  for(const item of items){
    const setting=settings.get(item.kind);
    if(!setting){unconfigured.add(item.kind);continue;}
    const left=daysUntil(item.expires_on,date);
    // المنتهي يُذكَّر به مرة خلال ثلاثين يومًا من انتهائه؛ ما انتهى قبل ذلك ظاهر في لوحة الانتهاء ولا يُعاد التذكير به.
    const stage=left<-30?null:left<0?'expired':left<=setting.second_reminder_days?'second':left<=setting.first_reminder_days?'first':null;
    if(!stage||!once(db,tenantId,`expiry:${item.kind}:${item.id}:${item.expires_on}:${stage}`,time))continue;
    const when=stage==='expired'?`انتهت في ${dayName(item.expires_on,date)}`:`تنتهي في ${dayName(item.expires_on,date)} (بعد ${left} يومًا)`;
    const docName=kindName(item.kind);
    if(item.owner&&item.own_notice&&activeUser(db,tenantId,item.owner)){
      notifySubject(db,{userId:item.owner,kind:'expiry_'+stage,subjectKind:'expiry',subjectId:item.id,title:`${stage==='expired'?'انتهت':'تقترب نهاية'} وثيقتك: ${docName.replace('وثيقة موظف — ','')}`,body:`${when}. جدّدها وأبلغ الموارد البشرية.`});sent++;
    }
    for(const userId of holders(db,tenantId,RECIPIENT_CAPABILITY(item.kind),cache)){
      if(userId===item.owner)continue;
      notifySubject(db,{userId,kind:'expiry_'+stage,subjectKind:'expiry',subjectId:item.id,title:`${stage==='expired'?'انتهت':'تقترب نهاية'} ${docName} — ${item.name}`,body:`${when}. افتح «انتهاء الوثائق».`});sent++;
    }
  }
  const needs=[...unconfigured].map(key=>({key,name:kindName(key),owner_capability:WATCHED_KINDS.find(k=>k.key===key)?.capability??null}));
  return {sent,configured_kinds:settings.size,needs_owner_decision:needs,
    ...(settings.size?{}:{note:'لا مدة تذكير مدخلة لأي نوع وثيقة؛ لم يُرسل شيء. يدخلها مالك كل إجراء من «انتهاء الوثائق».'})};
}

/* ───── 2) نهاية فترة التجربة ───── */
function probationReminders(db,tenantId,date,time,cache){
  let sent=0;
  for(const c of db.prepare("SELECT c.id,c.user_id,c.start_date,c.probation_days,x.name,x.manager_id FROM employment_contracts c JOIN users x ON x.id=c.user_id AND x.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.status='active' AND c.probation_days>0 AND x.active=1").all(tenantId)){
    const end=plusDays(c.start_date,c.probation_days-1),due=plusDays(end,-PROBATION_LEAD_DAYS);
    if(date<due||date>end||!once(db,tenantId,`probation:${c.id}`,time))continue;
    const manager=activeUser(db,tenantId,c.manager_id);
    const to=manager?[manager.id]:holders(db,tenantId,'employees.view',cache);
    // الموجة 2، العطب 10: بلا مدير نشط ولا حامل تصريح لم يكن التذكير يصل أحدًا. يمر بسُلَّم المستلمين (مدير الإدارة فمرجع تصعيدها) أو يُسجَّل «بلا مستلم».
    if(!to.filter(userId=>userId!==c.user_id).length){
      if(deliverSubject(db,{tenantId,userId:c.manager_id??null,aboutUserId:c.user_id,kind:'probation_report_due',subjectKind:'probation',subjectId:c.id,title:`تقرير فترة التجربة مستحق: ${c.name}`,body:`تنتهي فترة التجربة في ${dayName(end,date)}. يُرفع تقرير المدير قبل نهايتها بأسبوعين (المادة 25 من اللائحة).`}).delivered)sent++;
      continue;
    }
    for(const userId of to){if(userId===c.user_id)continue;
      notifySubject(db,{userId,kind:'probation_report_due',subjectKind:'probation',subjectId:c.id,title:`تقرير فترة التجربة مستحق: ${c.name}`,body:`تنتهي فترة التجربة في ${dayName(end,date)}. يُرفع تقرير المدير قبل نهايتها بأسبوعين (المادة 25 من اللائحة).`});sent++;}
  }
  return {sent};
}

/* ───── 3) تشغيل الاستحقاق المستحق (D-05) ───── */
// الشهر المنسي في محرك الاستحقاق يترك الموظف أمام «المتاح 0 يوم» كأنه استنفد رصيده، ولا شيء يذكّر أحدًا.
// التذكير يمر بالطابور القائم كبقية التذكيرات، ويصل حامل تصريح اعتماد سياسات الموارد البشرية — صاحب قرار التشغيل.
// التشغيل نفسه يبقى فعلًا بشريًا: المهمة لا تُقيّد استحقاقًا ولا تنشئ تشغيلًا، تذكّر فقط. تذكير واحد لكل فترة.
function accrualReminders(db,tenantId,date,time,cache){
  let sent=0;const periods=allDueAccrualPeriods(db,tenantId,date);
  for(const [type,rows] of Object.entries(Object.groupBy(periods,p=>p.leave_type))){
    // المفتاح بآخر فترة مستحقة: كل فترة جديدة تكتمل تُنتج تذكيرًا واحدًا، ولا يتكرر التذكير كل يوم عن الفترة نفسها.
    if(!once(db,tenantId,`accrual-due:${type}:${rows.at(-1).period_key}`,time))continue;
    for(const userId of holders(db,tenantId,'hr.policy.accept',cache)){
      notifySubject(db,{userId,kind:'accrual_run_due',subjectKind:'accrual_run',subjectId:`${type}:${rows.at(-1).period_key}`,
        title:`تشغيل استحقاق مستحق: ${type} — ${rows.length} فترة`,
        body:`اكتملت ${rows.length} فترة (${rows[0].period_key}${rows.length>1?` — ${rows.at(-1).period_key}`:''}) ولم تُقيَّد. رصيد الإجازات لا يرتفع قبل تشغيلها. افتح «استحقاق الإجازات» لتشغيلها بقرارك؛ المنصة لا تُشغّلها آليًا.`});sent++;
    }
  }
  return {sent,due_periods:periods.length};
}

/* ───── 4) القرارات المتأخرة، و5) ملخص المدير ───── */
// «ما عليّ» (obligations.mjs) مصدر الاثنين، وهو نفسه مصدر الرئيسية والصندوق وشارة القائمة: الرقم في التذكير هو الرقم على الشاشة.
// التأخر يُقاس بوقت المهمة (at): ما له زمن خدمة أو موعد بموعده، وما عداه بأيام العمل منذ وصل إلى الشخص مقابل pending_approval_days.
// العمر من لحظة الوصول لا من updated_at، فالضغط على «متابعة» لا يصفّره ولا يلغي هذا التذكير. الاختياري لا يدخل العدّ أصلًا.
function decisionReminders(db,tenantId,date,time,settings){
  const days=settings.pending_approval_days;let approvals=0,digests=0;
  const candidates=db.prepare(`SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND (role<>'employee' OR id IN (SELECT approver_id FROM approval_steps WHERE status='pending') OR id IN (SELECT to_user_id FROM approval_step_escalations)) ORDER BY id`).all(tenantId);
  for(const person of candidates){
    let mine;try{mine=obligations(db,person,{at:Date.parse(time),watching:false});}catch{continue;}
    const items=mine.items.filter(i=>i.bucket==='decide'),late=items.filter(i=>i.overdue).length;
    // ما تأخر من القرارات ومما طُلب فيه ردّه (إقرار، إفادة، طلب معاد): كان الصندوق القديم يعدّها معًا، فلا يسقط تذكير أحدها بانتقاله إلى «أجيب».
    const old=days?mine.items.filter(i=>i.bucket!=='do'&&!i.optional&&i.overdue).length:0;
    if(old&&once(db,tenantId,`approvals:${person.id}:${date}`,time)){
      notifySubject(db,{userId:person.id,kind:'approvals_overdue',subjectKind:'approvals_digest',subjectId:date,title:`قرارات وردود تأخرت عندك: ${old}`,
        body:`فات زمن خدمتها أو موعدها، أو مضى على وصولها إليك ${days} أيام عمل أو أكثر. افتح «بانتظار قراري» لاتخاذها أو تفويضها.`});approvals++;
    }
    if(!settings.manager_digest||person.role!=='manager')continue;
    const onLeave=db.prepare("SELECT COUNT(*) AS n FROM leave_requests l JOIN users x ON x.id=l.employee_id WHERE x.manager_id=? AND x.active=1 AND l.status='approved' AND ? BETWEEN l.start_date AND l.end_date").get(person.id,date).n;
    if((!items.length&&!onLeave)||!once(db,tenantId,`digest:${person.id}:${date}`,time))continue;
    notifySubject(db,{userId:person.id,kind:'manager_digest',subjectKind:'manager_digest',subjectId:date,title:`ملخصك اليوم: ${items.length} بانتظار قرارك${late?`، منها ${late} متأخر`:''}`,body:`${onLeave?`في إجازة اليوم من فريقك: ${onLeave}. `:''}افتح «بانتظار قراري».`});digests++;
  }
  return {approvals:days?{sent:approvals,days}:{sent:0,note:'لم يُحدد عدد الأيام؛ التذكير موقوف'},digests:{sent:digests,enabled:settings.manager_digest}};
}

/* ───── 3ب) أرصدة الإجازة التعويضية: مهلة تقترب، ومهلة انقضت أو خدمة انتهت ───── */
// المسح يذكّر ولا يكتب مالًا (قاعدتا jobs.mjs 1 و2): ينبّه صاحب الرصيد قبل انقضاء مهلته بالمدة التي في السياسة، ويرفع ما انقضت مهلته
// أو انتهت خدمة صاحبه إلى حاملي تصريح إعداد الرواتب ليحيلوه حركةً مقترحة. لا شيء يُحذف ولا يُصفَّر: المستحق يُشتق من الدفتر والتواريخ.
function compensatoryReminders(db,tenantId,date,time,cache){
  return compensatorySweep(db,tenantId,date,{once:key=>once(db,tenantId,key,time),holders:capability=>holders(db,tenantId,capability,cache)});
}

export function runDailyReminders(db,tenantId,date,at=Date.now()){
  const time=iso(at),cache=new Map(),settings=reminderSettings(db,tenantId);
  return {date,expiry:expiryReminders(db,tenantId,date,time,cache),probation:probationReminders(db,tenantId,date,time,cache),
    accrual:accrualReminders(db,tenantId,date,time,cache),compensatory:compensatoryReminders(db,tenantId,date,time,cache),...decisionReminders(db,tenantId,date,time,settings),settings_status:settings.status};
}
export function registerReminderHandlers(){
  if(!hasHandler(DAILY_JOB))registerHandler(DAILY_JOB,(db,job,context)=>runDailyReminders(db,job.tenant_id,job.payload.date,context.now));
}
// يُستدعى من مؤقّت الخادم كل دقيقة. قبل 08:00 بالرياض لا شيء؛ بعدها مهمة واحدة لليوم لكل كيان.
// المهمة مسجلة باسم أول أدمن أول نشط في الكيان: هو صاحب الجدولة، ولا مهمة بلا صاحب.
export function scheduleDaily(db,{now:at=Date.now()}={}){
  const {date,minutes}=riyadhParts(at),out=[];
  if(minutes<DAILY_MINUTE||!hasHandler(DAILY_JOB))return out;
  for(const {id:tenantId} of db.prepare('SELECT id FROM tenants ORDER BY id').all()){
    const owner=db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role='admin' AND admin_level='super' ORDER BY id LIMIT 1").get(tenantId);
    if(!owner)continue;
    out.push({tenant_id:tenantId,...transaction(db,()=>enqueue(db,owner,{type:DAILY_JOB,payload:{date},idempotency_key:`${DAILY_JOB}:${date}`,source:{entity:'schedule',id:`daily-0800:${date}`},due_at:iso(at),max_attempts:3}))});
  }
  return out;
}
