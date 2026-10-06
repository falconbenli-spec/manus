import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { AppError, fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { acceptedPolicy, preparePolicy } from './hr-contracts.mjs';
import { refuse } from './refusal.mjs';
import { notifySubject, dayName, dateRange } from './notices.mjs';
import { deliverSubject } from './notice-recipients.mjs';
import { workbook } from './xlsx.mjs';
import { dayStates, DAY_STATES } from './attendance.mjs';
import { locationBoard } from './attendance-location.mjs';
import { assignmentsFor, overtimePolicy } from './overtime-rules.mjs';
import { RULE_ARTICLES, RULE_DRAFT, RAMADAN_1448, minutesOf, weekOf } from './attendance-policy.mjs';

// الاستئذان والانصراف المبكر وإشعار التأخر في يومه (م74(8)، م75)، وإعفاءات الحضور، وتقارير النقص والتأخر، ولوحة القواعد.
// الاستئذان سجل حضور: يطلبه الموظف، ويعتمده مديره المباشر أو المعتمد، ولا يعتمده صاحبه. المعتمد يرفع علامة التأخر أو الانصراف المبكر
// في فترته فقط. السقف الشهري معامل في السياسة لا تحدده اللائحة، ويبقى فارغًا حتى يحدده مدير الموارد البشرية.
export const PERMISSION_KINDS={late_arrival:'تأخر في أول الدوام',during_day:'خروج أثناء الدوام',early_leave:'انصراف مبكر'};
const STATUS={pending:'بانتظار القرار',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى',open:'بانتظار المدير',accepted:'قُبل عذرًا',proposed:'مقترح — لا يسري'};
const NOTICE_KINDS={late:'سأتأخر اليوم',absent:'سأغيب اليوم'};
const RIYADH_OFFSET=3*3600000;
const riyadhDate=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(0,10);
const riyadhClock=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(11,16);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
const CLOCK=/^([01]\d|2[0-3]):[0-5]\d$/;

function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','تسجيل الحضور لحسابات الموظفين وبس');
  u.caps=['hr.attendance.manage','hr.attendance.approve','payroll.prepare','hr.policy.prepare'].filter(key=>holds(db,u,key));return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة الحضور تبي معاملة قاعدة بيانات');}
const need=(u,cap,message)=>{if(!u.caps.includes(cap))fail(403,'not_permitted',message);};
function clock(value,label){if(typeof value!=='string'||!CLOCK.test(value))fail(400,'invalid_time',`${label}: اكتب الوقت بصيغة 09:00`);return value;}
// صاحب القرار على سجلات الموظف: مديره المباشر أو حامل تصريح الاعتماد، ولا يكون صاحب السجل.
const decides=(db,u,row)=>row.user_id!==u.id&&(isManagerOf(db,u,row.user_id)||u.caps.includes('hr.attendance.approve'));
function permissionCap(db,tenantId,date){const policy=acceptedPolicy(db,tenantId,'working_time',date);return policy?JSON.parse(policy.parameters).permission_monthly_cap_minutes??null:null;}
const usedPermissionMinutes=(db,userId,month,skip=null)=>db.prepare("SELECT COALESCE(SUM(minutes),0) AS n FROM attendance_permissions WHERE user_id=? AND status IN ('pending','approved') AND work_date LIKE ? AND id IS NOT ?").get(userId,month+'%',skip).n;

// ── الاستئذان ──
export function requestPermission(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['work_date','kind','from_time','to_time','reason']);
  const date=v.date(input.work_date),today=riyadhDate();
  if(date<addDays(today,-7)||date>addDays(today,30))fail(400,'work_date','الاستئذان من سبعة أيام فاتت لين ثلاثين يوم جايّة');
  if(!PERMISSION_KINDS[input.kind])fail(400,'kind','اختر نوع الاستئذان من القائمة');
  const from=clock(input.from_time,'من الساعة'),to=clock(input.to_time,'إلى الساعة'),minutes=minutesOf(to)-minutesOf(from);
  if(minutes<=0)fail(400,'time_order','خلّ نهاية الاستئذان بعد بدايته');
  if(db.prepare("SELECT 1 FROM attendance_permissions WHERE user_id=? AND work_date=? AND status IN ('pending','approved') AND to_time>? AND from_time<?").get(u.id,date,from,to))fail(409,'overlapping_permission','عندك استئذان قائم يتقاطع مع هذي الفترة');
  const cap=permissionCap(db,u.tenant_id,date);
  if(cap!==null){
    const used=usedPermissionMinutes(db,u.id,date.slice(0,7)),remaining=Math.max(0,cap-used);
    if(minutes>remaining){const error=new AppError(409,'permission_cap',`يتجاوز السقف الشهري للاستئذان (${cap} دقيقة). المتبقي لك في ${date.slice(0,7)}: ${remaining} دقيقة`);error.details={cap_minutes:cap,remaining_minutes:remaining};throw error;}
  }
  const permissionId=id();
  db.prepare("INSERT INTO attendance_permissions(id,tenant_id,user_id,work_date,kind,from_time,to_time,minutes,reason,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)").run(permissionId,u.tenant_id,u.id,date,input.kind,from,to,minutes,v.text(input.reason,'السبب',1000,5),now());
  audit(db,u,'attendance_permission',permissionId,'attendance.permission_requested',{}, {work_date:date,kind:input.kind,minutes});
  // الموجة 2، العطب 10: بلا مدير مباشر كان هذا الإشعار لا يصل أحدًا ولا يعلم أحد. يمر بسُلَّم المستلمين أو يُسجَّل «بلا مستلم».
  const manager=db.prepare('SELECT manager_id FROM users WHERE id=?').get(u.id)?.manager_id;
  deliverSubject(db,{tenantId:u.tenant_id,userId:manager??null,aboutUserId:u.id,actorId:u.id,kind:'attendance_permission_requested',subjectKind:'attendance_permission',subjectId:permissionId,title:`طلب استئذان ينتظر قرارك: ${u.name} يوم ${dayName(date)}`,body:`${PERMISSION_KINDS[input.kind]} من ${from} إلى ${to}. افتح شاشة الحضور لاعتماده أو رفضه.`});
  return {id:permissionId};
}
export function decidePermission(db,supplied,permissionId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  if(!['approve','reject','cancel'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض ولا إلغاء');
  const p=typeof permissionId==='string'&&db.prepare("SELECT * FROM attendance_permissions WHERE id=? AND tenant_id=? AND status='pending'").get(permissionId,u.tenant_id);
  if(!p)fail(404,'not_found','ما لقينا استئذان ينتظر قرار');
  if(decision==='cancel'?p.user_id!==u.id:!decides(db,u,p))fail(404,'not_found','القرار في هذا الاستئذان مو من صلاحيتك');
  const status={approve:'approved',reject:'rejected',cancel:'cancelled'}[decision];
  db.prepare('UPDATE attendance_permissions SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),input.note===undefined&&decision!=='reject'?'':v.text(input.note,'أساس القرار',1000,decision==='reject'?10:1),p.id);
  audit(db,u,'attendance_permission',p.id,'attendance.permission_'+status,{status:'pending'},{status});
  if(decision!=='cancel')notifySubject(db,{userId:p.user_id,kind:'attendance_permission_'+status,subjectKind:'attendance_permission',subjectId:p.id,
    title:decision==='approve'?`اعتُمد استئذانك يوم ${dayName(p.work_date)} من ${p.from_time} إلى ${p.to_time}`:`رُفض استئذانك يوم ${dayName(p.work_date)}`,
    body:decision==='approve'?'لا يُحتسب تأخرًا أو انصرافًا مبكرًا ما وقع داخل هذه الفترة.':'سبب الرفض مكتوب في «حضوري».'});
  return {id:p.id,status};
}

// ── إشعار التأخر أو الغياب في يومه (م75) ──
export function giveNotice(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['kind','expected_time','reason']);
  if(!NOTICE_KINDS[input.kind])fail(400,'kind','اختر: تأخر ولا غياب');
  const date=riyadhDate(),expected=input.kind==='late'?clock(input.expected_time,'الوقت المتوقع للوصول'):null;
  if(input.kind==='absent'&&input.expected_time!==undefined&&input.expected_time!=='')fail(400,'invalid_fields','إشعار الغياب بلا وقت وصول');
  if(expected&&expected<=riyadhClock())fail(400,'expected_time','خلّ الوقت المتوقع للوصول بعد الحين');
  if(db.prepare('SELECT 1 FROM attendance_notices WHERE user_id=? AND work_date=? AND kind=?').get(u.id,date,input.kind))fail(409,'duplicate_notice','أرسلت الإشعار هذا اليوم أصلًا');
  if(input.kind==='absent'&&db.prepare('SELECT 1 FROM attendance_records WHERE user_id=? AND work_date=? AND check_in_at IS NOT NULL').get(u.id,date))fail(409,'already_checked_in','حضورك اليوم مسجّل — إذا تبي تطلع اطلب استئذان');
  const noticeId=id();
  db.prepare("INSERT INTO attendance_notices(id,tenant_id,user_id,work_date,kind,expected_time,reason,status,created_at) VALUES(?,?,?,?,?,?,?,'open',?)").run(noticeId,u.tenant_id,u.id,date,input.kind,expected,v.text(input.reason,'السبب',1000,5),now());
  audit(db,u,'attendance_notice',noticeId,'attendance.notice_'+input.kind,{}, {work_date:date});
  const manager=db.prepare('SELECT manager_id FROM users WHERE id=?').get(u.id)?.manager_id;
  deliverSubject(db,{tenantId:u.tenant_id,userId:manager??null,aboutUserId:u.id,actorId:u.id,kind:'attendance_notice_given',subjectKind:'attendance_notice',subjectId:noticeId,title:input.kind==='late'?`${u.name}: سأتأخر اليوم حتى ${expected}`:`${u.name}: سأغيب اليوم`,body:'إشعار في اليوم نفسه (م75). اقبله عذرًا أو لا تقبله من شاشة الحضور.'});
  return {id:noticeId};
}
export function decideNotice(db,supplied,noticeId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  if(!['accept','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون قبول ولا رفض');
  const n=typeof noticeId==='string'&&db.prepare("SELECT * FROM attendance_notices WHERE id=? AND tenant_id=? AND status='open'").get(noticeId,u.tenant_id);
  if(!n||!decides(db,u,n))fail(404,'not_found','ما لقينا إشعار ينتظر قرار');
  const status=decision==='accept'?'accepted':'rejected';
  db.prepare('UPDATE attendance_notices SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',1000,decision==='accept'?3:10),n.id);
  audit(db,u,'attendance_notice',n.id,'attendance.notice_'+status,{status:'open'},{status});
  notifySubject(db,{userId:n.user_id,kind:'attendance_notice_'+status,subjectKind:'attendance_notice',subjectId:n.id,
    title:decision==='accept'?`قُبل إشعار ${n.kind==='late'?'تأخرك':'غيابك'} يوم ${dayName(n.work_date)} عذرًا`:`لم يُقبل إشعار ${n.kind==='late'?'تأخرك':'غيابك'} يوم ${dayName(n.work_date)} عذرًا`,
    body:decision==='accept'?(n.kind==='late'?`لا يُحتسب وصولك حتى ${n.expected_time} تأخرًا.`:'يظهر اليوم «غيابًا بإشعار قبله المدير» لا «بلا سجل». الأجر يتبع سياسة الشركة.'):'السبب مكتوب في «حضوري». اليوم يبقى يحتاج توضيحًا.'});
  return {id:n.id,status};
}

// ── إعفاءات الحضور بفترات معتمدة ──
export function proposeExemption(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.manage','اقتراح الإعفاء من الحضور لموظفي الموارد البشرية المخولين');
  v.object(input,['user_id','from_date','to_date','reason']);
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا');
  if(person.id===u.id)fail(409,'separation_of_duties','ما ينفع الموظف يقترح إعفاء لنفسه');
  const from=v.date(input.from_date),to=v.date(input.to_date);
  if(to<from)fail(400,'date_order','خلّ تاريخ النهاية بعد تاريخ البداية');
  if(to>addDays(from,365))fail(400,'range_too_long','الإعفاء الواحد سنة على الأكثر');
  if(db.prepare("SELECT 1 FROM attendance_exemptions WHERE user_id=? AND status IN ('proposed','approved') AND to_date>=? AND from_date<=?").get(person.id,from,to))fail(409,'overlapping_exemption','للموظف إعفاء قائم يتقاطع مع هذي الفترة');
  const exemptionId=id();
  db.prepare("INSERT INTO attendance_exemptions(id,tenant_id,user_id,from_date,to_date,reason,status,proposed_by,created_at) VALUES(?,?,?,?,?,?,'proposed',?,?)").run(exemptionId,u.tenant_id,person.id,from,to,v.text(input.reason,'سبب الإعفاء',1000,10),u.id,now());
  audit(db,u,'attendance_exemption',exemptionId,'attendance.exemption_proposed',{}, {user_id:person.id,from_date:from,to_date:to});
  return {id:exemptionId};
}
export function decideExemption(db,supplied,exemptionId,decision,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.approve','اعتماد الإعفاء من الحضور خارج صلاحيتك');
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض');
  const x=typeof exemptionId==='string'&&db.prepare("SELECT * FROM attendance_exemptions WHERE id=? AND tenant_id=? AND status='proposed'").get(exemptionId,u.tenant_id);
  if(!x)fail(404,'not_found','ما لقينا إعفاء ينتظر قرار');
  if(x.proposed_by===u.id||x.user_id===u.id)fail(409,'separation_of_duties','اللي اقترح الإعفاء ولا صاحبه ما يعتمده');
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE attendance_exemptions SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',1000,decision==='approve'?3:10),x.id);
  audit(db,u,'attendance_exemption',x.id,'attendance.exemption_'+status,{status:'proposed'},{status});
  notifySubject(db,{userId:x.user_id,kind:'attendance_exemption_'+status,subjectKind:'attendance_exemption',subjectId:x.id,
    title:decision==='approve'?`اعتُمد إعفاؤك من الحضور ${dateRange(x.from_date,x.to_date)}`:`لم يُعتمد الإعفاء المقترح لك من الحضور`,
    body:decision==='approve'?'لا يُحكم في هذه الأيام بتأخر ولا غياب، ولا يُطلب فيها موقع.':'يسري عليك الدوام المعتمد كالمعتاد.'});
  return {id:x.id,status};
}

// ── التقارير: النقص الأسبوعي، ودفتر الشهر لكل موظف ──
// من يُقرأ حضوره: الموظف نفسه، وفريق المدير المباشر، والجميع لحامل تصاريح الحضور.
function people(db,u,{all=false}={}){
  if(u.caps.includes('hr.attendance.manage')||u.caps.includes('hr.attendance.approve'))return db.prepare("SELECT id,name,tenant_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id);
  const team=db.prepare('SELECT id,name,tenant_id FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id);
  return all?[{id:u.id,name:u.name,tenant_id:u.tenant_id},...team]:team;
}
// النقص = المتوقع من ساعات الدوام − المعمول − دقائق الاستئذان المعتمد. قياس للمتابعة وليس خصمًا ولا مخالفة.
export function shortfallRows(db,u,weekStart){
  const {from,to}=weekOf(weekStart),today=riyadhDate();
  return people(db,u,{all:true}).map(p=>{
    const days=dayStates(db,p,from,to,today<to?today:to);
    const sum=key=>days.reduce((n,d)=>n+d[key],0),expected=sum('expected_minutes'),worked=sum('worked_minutes'),permitted=sum('permission_minutes');
    return {user_id:p.id,name:p.name,expected_minutes:expected,worked_minutes:worked,permission_minutes:permitted,shortfall_minutes:Math.max(0,expected-worked-permitted),
      late_days:days.filter(d=>d.state==='late').length,early_leave_days:days.filter(d=>d.state==='early_leave').length,unexplained_days:days.filter(d=>['unexplained','incomplete'].includes(d.state)).length};
  });
}
export function shortfallReport(db,supplied,week){
  const u=actor(db,supplied),start=week===undefined?riyadhDate():v.date(week),{from,to}=weekOf(start);
  return {week_from:from,week_to:to,rows:shortfallRows(db,u,from),note:'النقص = الساعات المتوقعة بحسب الدوام المعتمد (ورمضان والورديات) − المعمول فعلًا − الاستئذان المعتمد. للمتابعة فقط: لا يتحول إلى خصم ولا مخالفة تلقائيًا.'};
}
const hm=minutes=>`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
// دفتر Excel للشهر: ورقة ملخص، وورقة لكل موظف يراه صاحب الطلب (نفسه، أو فريقه، أو الجميع لموارد البشرية).
export function monthlyWorkbook(db,supplied,month){
  const u=actor(db,supplied);
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'invalid_month','اكتب الشهر بصيغة 2026-09 (سنة-شهر)');
  const [y,m]=month.split('-').map(Number),from=`${month}-01`,to=`${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;
  const list=people(db,u,{all:true}),summary=[['الموظف','أيام حضور','أيام تأخر','انصراف مبكر بلا إذن','بإذن أو عذر','يحتاج توضيحًا','إجازة','غياب غير مدفوع','ساعات متوقعة','ساعات معمولة','نقص (ساعة:دقيقة)']],sheets=[];
  for(const p of list){
    const days=dayStates(db,p,from,to),count=(...states)=>days.filter(d=>states.includes(d.state)).length,expected=days.reduce((n,d)=>n+d.expected_minutes,0),worked=days.reduce((n,d)=>n+d.worked_minutes,0),permitted=days.reduce((n,d)=>n+d.permission_minutes,0);
    summary.push([p.name,count('present','late','early_leave','present_permission'),count('late'),count('early_leave'),count('present_permission'),count('incomplete','unexplained'),count('leave'),count('unpaid_absence'),Math.round(expected/6)/10,Math.round(worked/6)/10,hm(Math.max(0,expected-worked-permitted))]);
    sheets.push({name:p.name,rows:[['التاريخ','الحالة','الدوام','الحضور','الانصراف','دقائق التأخر','دقائق الانصراف المبكر','دقائق الاستئذان','المعمول (دقيقة)','المتوقع (دقيقة)','موقع الحضور','موقع الانصراف','رمضان'],
      ...days.map(d=>[d.date,d.state_name,d.hours??'',d.check_in??'',d.check_out??'',d.late_minutes,d.early_minutes,d.permission_minutes,d.worked_minutes,d.expected_minutes,d.zones.in?.zone_name??'',d.zones.out?.zone_name??'',d.ramadan?'نعم':''])]});
  }
  audit(db,u,'report','attendance-workbook','report.exported',{}, {month,employees:list.length,format:'xlsx'});
  const content=workbook([{name:'الملخص',rows:summary},...sheets,{name:'تعريفات',rows:[['البند','التعريف'],['التأخر','الحضور بعد بداية الدوام ومهلة التأخير في السياسة المقبولة. الاستئذان المعتمد أو إشعار التأخر المقبول يرفعه.'],['الانصراف المبكر','الانصراف قبل نهاية الدوام بلا استئذان معتمد (م74(8)).'],['النقص','المتوقع − المعمول − الاستئذان المعتمد. للمتابعة وليس خصمًا.'],['رمضان','ساعات رمضان من السياسة المقبولة (م73(2)، م74(2)).'],['تنبيه','لا يُستخدم هذا الدفتر لترتيب الموظفين، ولا يتحول شيء فيه إلى خصم تلقائيًا.']]}]);
  return {filename:`attendance-${month}.xlsx`,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',content};
}

// ── مسودة ساعات رمضان 1448هـ (م73(2) وم74(2)، ص 25) ──
// نسخة جديدة من سياسة ساعات العمل المعتمدة تحمل كتلة رمضان بالنافذة المبدئية، يعدّها حامل hr.policy.prepare بهويته ويبقى قبولها لمدير الموارد
// البشرية (decidePolicy يرفض أن يقبل المُعد ما أعدّه). لا تُقبل هنا ولا تُكتب بلا هوية إنسان: من يشغّل الدالة هو المُعد المسجل باسمه.
export function ramadanPolicyDraft(db,tenantId,date=riyadhDate(),overrides={}){
  const base=acceptedPolicy(db,tenantId,'working_time',date);
  if(!base)return null;
  const p=JSON.parse(base.parameters),ramadan={...RULE_DRAFT.ramadan,...overrides};
  const daily=minutesOf(ramadan.end)-minutesOf(ramadan.start);
  return {base_policy_id:base.id,base_title:base.title,
    parameters:{workdays:p.workdays,start:p.start,end:p.end,grace_minutes:p.grace_minutes,ramadan,
      ...(p.overtime?{overtime:p.overtime}:{}),...(p.permission_monthly_cap_minutes!==undefined&&p.permission_monthly_cap_minutes!==null?{permission_monthly_cap_minutes:p.permission_monthly_cap_minutes}:{}),...(p.location?{location:p.location}:{})},
    daily_minutes:daily,weekly_minutes:daily*p.workdays.length,workdays:p.workdays,
    title:`ساعات العمل والحضور — ساعات رمضان ${RAMADAN_1448.hijri} (نسخة من «${base.title}»)`,
    body:`نسخة من سياسة ساعات العمل المعتمدة «${base.title}» تُضاف إليها ساعات رمضان ${RAMADAN_1448.hijri}: من ${ramadan.from} إلى ${ramadan.to}، الدوام من ${ramadan.start} إلى ${ramadan.end} (${daily/60} ساعات يوميًا، ${daily*p.workdays.length/60} ساعة أسبوعيًا على ${p.workdays.length} أيام عمل). بقية المعاملات (أيام العمل والدوام العام ومهلة التأخير وقواعد العمل الإضافي وسقف الاستئذان والموقع) منقولة من النسخة المعتمدة بلا تغيير. النافذة مبدئية: ${RAMADAN_1448.note} قيد «العمال المسلمين» في م73(2) لا تستطيع المنصة تطبيقه لأنها لا تحمل حقل ديانة، فتسري الكتلة على كل من تحكمه السياسة ما لم يقرر مدير الموارد البشرية غير ذلك. ساعتا البداية والنهاية قرار الشركة داخل حد الست ساعات لا رقم من اللائحة.`,
    basis:`لائحة تنظيم العمل المعتمدة (شهادة 351743): م73(2) ص 25 «تكون ساعات العمل (ثماني) ساعات عمل يوميًا تخفض إلى (ست) ساعات يوميا في شهر رمضان للعمال المسلمين»، وم74(2) ص 25 «تخفض ساعات العمل خلال شهر رمضان المبارك بحيث لا تزيد على (36) ست وثلاثين ساعة عمل فعلية في الأسبوع»؛ الحدان يُفرضان معًا (5 × 6 = 30 لا 36، ولم يتصالحا في النص). النافذة: تقويم أم القرى لسنة 1448هـ عبر ${RAMADAN_1448.sources.join('؛ ')}. التعميم السنوي: م84(4) ص 29.`,
    effective_from:ramadan.from};
}
export function prepareRamadanDraft(db,supplied,input={}){
  const u=currentUser(db,supplied);
  if(!u||u.role==='admin')refuse(403,'forbidden',{what:'إعداد مسودة ساعات رمضان لحساب موظف يحمل تصريح إعداد السياسات لا لحساب إدارة المنصة',next:'سجّل الدخول بحساب موظف الموارد البشرية المخول'});
  if(!holds(db,u,'hr.policy.prepare'))refuse(403,'not_permitted',{what:'إعداد مسودة ساعات رمضان لحامل تصريح إعداد سياسات الموارد البشرية',
    missing:[{document:'تصريح hr.policy.prepare',why:'المسودة تُكتب بهوية مُعدّها ويقبلها شخص آخر',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب التصريح أو اطلب من موظف الموارد البشرية المخول إعداد المسودة'});
  v.object(input,['effective_from','ramadan']);
  const draft=ramadanPolicyDraft(db,u.tenant_id,riyadhDate(),input.ramadan??{});
  if(!draft)refuse(409,'working_time_policy_required',{what:'لا تُعد مسودة ساعات رمضان بلا سياسة ساعات عمل معتمدة تُنسخ منها',
    missing:[{doc_key:'working_time',document:'سياسة «ساعات العمل والحضور» معتمدة',why:'كتلة رمضان تُضاف إلى نسخة من السياسة المعتمدة فلا تُخترع أيام عمل ولا دوام',owner:'مدير الموارد البشرية (يعتمد) وموظف الموارد البشرية المخول (يُعد)',owner_role:'hr.policy.accept'}],
    next:'أعدّ سياسة ساعات العمل الأساسية من شاشة الحضور واعتمدها أولًا',link:'#attendance'});
  if(db.prepare("SELECT 1 FROM hr_policies WHERE tenant_id=? AND kind='working_time' AND status='draft' AND json_extract(parameters,'$.ramadan.from')=?").get(u.tenant_id,draft.parameters.ramadan.from))
    refuse(409,'draft_exists',{what:`توجد مسودة ساعات عمل تحمل رمضان من ${draft.parameters.ramadan.from} لم يُبت فيها`,next:'يقبلها مدير الموارد البشرية أو يرفضها من «العقود والسياسات» قبل إعداد مسودة أخرى'});
  const {id}=preparePolicy(db,u,{kind:'working_time',title:draft.title,body:draft.body,basis:draft.basis,effective_from:input.effective_from??draft.effective_from,parameters:draft.parameters});
  return {id,base_policy_id:draft.base_policy_id,ramadan:draft.parameters.ramadan,status:'draft',acceptance_owner:'مدير الموارد البشرية (hr.policy.accept)، غير المُعد'};
}

// ── لوحة القواعد في شاشة الحضور ──
export function rulesBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhDate(),month=today.slice(0,7);
  const policy=acceptedPolicy(db,u.tenant_id,'working_time',today),params=policy?JSON.parse(policy.parameters):null;
  const draft=u.caps.includes('hr.policy.prepare')?db.prepare("SELECT id,title,created_at FROM hr_policies WHERE tenant_id=? AND kind='working_time' AND status='draft' ORDER BY created_at DESC LIMIT 5").all(u.tenant_id):[];
  const permissionView=p=>({...p,kind_name:PERMISSION_KINDS[p.kind],status_name:STATUS[p.status],employee_name:name(db,p.user_id),decided_by_name:name(db,p.decided_by),
    actions:p.status!=='pending'?[]:p.user_id===u.id?['cancel_permission']:decides(db,u,p)?['approve_permission','reject_permission']:[]});
  const noticeView=n=>({...n,kind_name:NOTICE_KINDS[n.kind],status_name:STATUS[n.status],employee_name:name(db,n.user_id),decided_by_name:name(db,n.decided_by),actions:n.status==='open'&&decides(db,u,n)?['accept_notice','reject_notice']:[]});
  const hr=u.caps.includes('hr.attendance.manage')||u.caps.includes('hr.attendance.approve');
  const scope=hr?'tenant_id=?':'tenant_id=? AND (user_id=? OR user_id IN (SELECT id FROM users WHERE manager_id=?))',args=hr?[u.tenant_id]:[u.tenant_id,u.id,u.id];
  const permissions=db.prepare(`SELECT * FROM attendance_permissions WHERE ${scope} ORDER BY created_at DESC LIMIT 100`).all(...args).map(permissionView);
  const notices=db.prepare(`SELECT * FROM attendance_notices WHERE ${scope} ORDER BY created_at DESC LIMIT 60`).all(...args).map(noticeView);
  const exemptions=db.prepare(`SELECT * FROM attendance_exemptions WHERE ${scope} ORDER BY created_at DESC LIMIT 60`).all(...args).map(x=>({...x,status_name:STATUS[x.status],employee_name:name(db,x.user_id),proposed_by_name:name(db,x.proposed_by),decided_by_name:name(db,x.decided_by),
    actions:x.status==='proposed'&&x.proposed_by!==u.id&&x.user_id!==u.id&&u.caps.includes('hr.attendance.approve')?['approve_exemption','reject_exemption']:[]}));
  const cap=params?.permission_monthly_cap_minutes??null,used=usedPermissionMinutes(db,u.id,month);
  const team=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id);
  const week=weekOf(today);
  const locations=locationBoard(db,u,today);
  const otPolicy=overtimePolicy(db,u.tenant_id,today);
  const assignable=team.map(t=>({id:t.id,name:t.name}));
  const draftParameters=params?{workdays:params.workdays,start:params.start,end:params.end,grace_minutes:params.grace_minutes,ramadan:params.ramadan??RULE_DRAFT.ramadan,overtime:params.overtime??RULE_DRAFT.overtime,permission_monthly_cap_minutes:params.permission_monthly_cap_minutes??null,location:params.location??RULE_DRAFT.location}:null;
  return {today,month,week_from:week.from,week_to:week.to,articles:RULE_ARTICLES,permission_kinds:PERMISSION_KINDS,notice_kinds:NOTICE_KINDS,day_states:DAY_STATES,
    policy:policy?{id:policy.id,title:policy.title,ramadan:params.ramadan??null,overtime:params.overtime??null,permission_monthly_cap_minutes:cap,location:params.location?{retention_days:params.location.retention_days,max_accuracy_m:params.location.max_accuracy_m}:null,citations:params.citations??{}}:null,
    draft_parameters:draftParameters,draft_policies:draft,can_prepare_policy:u.caps.includes('hr.policy.prepare'),
    // نافذة رمضان 1448هـ المبدئية ومسودتها الجاهزة (نسخة من المعتمدة + كتلة رمضان): يراها المُعد فيعدّها بهويته، ويقبلها مدير الموارد البشرية.
    ramadan_1448:{...RAMADAN_1448,in_accepted_policy:!!params?.ramadan&&params.ramadan.from===RAMADAN_1448.from,draft_ready:!!params&&!params.ramadan&&u.caps.includes('hr.policy.prepare')},
    unset:[!params?.overtime&&'قواعد العمل الإضافي (م76–77)',!params?.ramadan&&'ساعات رمضان (م73(2))',cap===null&&'سقف الاستئذان الشهري (لم تحدده اللائحة)',!params?.location&&'مدة حفظ الإحداثيات ونص إشعار الخصوصية'].filter(Boolean),
    me:{permission_minutes_this_month:used,permission_cap_minutes:cap,permission_remaining_minutes:cap===null?null:Math.max(0,cap-used),
      notice_today:db.prepare('SELECT kind FROM attendance_notices WHERE user_id=? AND work_date=?').all(u.id,today).map(r=>r.kind)},
    permissions,notices,exemptions,overtime_assignments:assignmentsFor(db,u),overtime_policy:otPolicy?{daily_cap_minutes:otPolicy.daily_cap_minutes,holiday_cap_minutes:otPolicy.holiday_cap_minutes,weekly_cap_minutes:otPolicy.weekly_cap_minutes,annual_cap_basic_months:otPolicy.annual_cap_basic_months,basic_share_bp:otPolicy.basic_share_bp}:null,
    can_assign_overtime:assignable.length>0&&!!otPolicy,assignable,
    employees:u.caps.includes('hr.attendance.manage')?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[],
    shortfall:hr||team.length?shortfallRows(db,u,week.from).filter(r=>r.user_id!==u.id||hr):[],
    location:locations,permissions_held:u.caps,
    rule:'الاستئذان المعتمد يرفع علامة التأخر أو الانصراف المبكر في فترته فقط. الانصراف المبكر بلا إذن يُعلَّم ويحتاج توضيحًا. الإعفاء المعتمد لا يُحكم فيه بتأخر ولا غياب. لا شيء هنا يتحول إلى خصم تلقائيًا.'};
}
