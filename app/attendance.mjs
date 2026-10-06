import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { absenceNotice } from './module-notices.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { effectiveHours, expectedMinutes, covers, minutesOf } from './attendance-policy.mjs';
import { recordPunchLocation, ZONE_NAMES } from './attendance-location.mjs';

// الحضور: بصمة بوقت الخادم، تصحيح يعتمده شخص آخر، وغياب غير مدفوع بقرار شخصين.
// اليوم بلا سجل «يحتاج توضيحًا» فقط؛ لا يتحول إلى خصم أو مخالفة تلقائيًا (HR-03).
export const DAY_STATES={present:'حاضر',late:'حاضر متأخر',incomplete:'سجل ناقص — يحتاج توضيحًا',unexplained:'بلا سجل — يحتاج توضيحًا',leave:'إجازة معتمدة',unpaid_absence:'غياب غير مدفوع معتمد',today_open:'اليوم — لم يكتمل',off:'يوم راحة',holiday:'عطلة رسمية معتمدة',mission:'مهمة عمل معتمدة',
  // قواعد الحضور (099): الاستئذان المعتمد يرفع التأخر أو الانصراف المبكر، والانصراف المبكر بلا إذن يُعلَّم، والإعفاء المعتمد لا يُحكم فيه بتأخر ولا غياب.
  present_permission:'حاضر — باستئذان أو عذر مقبول',early_leave:'انصراف مبكر بلا إذن — يحتاج توضيحًا',excused:'غياب بإشعار في يومه قبله المدير',exempt:'معفى من الحضور بقرار معتمد'};
const RIYADH_OFFSET=3*3600000;
const riyadhDate=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(0,10);
const riyadhClock=iso=>iso?new Date(Date.parse(iso)+RIYADH_OFFSET).toISOString().slice(11,16):null;
const toIso=(date,clock)=>new Date(`${date}T${clock}:00+03:00`).toISOString();
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const id=()=>randomUUID();

function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','تسجيل الحضور لحسابات الموظفين وبس');
  u.caps=['hr.attendance.manage','hr.attendance.approve'].filter(key=>holds(db,u,key));return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة الحضور تبي معاملة قاعدة بيانات');}
function clock(value,label){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail(400,'invalid_time',`${label}: اكتب الوقت بصيغة 09:00`);return value;}
function monthRange(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'invalid_month','اكتب الشهر بصيغة 2026-09 (سنة-شهر)');
  const [year,m]=month.split('-').map(Number),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`};
}
function leaveDates(db,userId,from,to){
  const dates=new Set();
  for(const r of db.prepare("SELECT work_dates_json FROM leave_requests WHERE employee_id=? AND status='approved' AND end_date>=? AND start_date<=?").all(userId,from,to))for(const d of JSON.parse(r.work_dates_json))dates.add(d);
  return dates;
}

// ما يقرؤه احتساب حالة اليوم: العطل المعتمدة، المهمات المعتمدة، والوردية السارية في كل تاريخ.
export function dayOverrides(db,user,from,to){
  const holidays=new Map(db.prepare("SELECT holiday_date,name FROM public_holidays WHERE tenant_id=? AND status='approved' AND holiday_date BETWEEN ? AND ?").all(user.tenant_id,from,to).map(h=>[h.holiday_date,h.name]));
  const missions=db.prepare("SELECT from_date,to_date,destination FROM work_missions WHERE user_id=? AND status='approved' AND to_date>=? AND from_date<=?").all(user.id,from,to);
  const shifts=db.prepare('SELECT * FROM shift_assignments WHERE user_id=? AND to_date>=? AND from_date<=? ORDER BY created_at DESC').all(user.id,from,to);
  const exemptions=db.prepare("SELECT id,from_date,to_date FROM attendance_exemptions WHERE user_id=? AND status='approved' AND to_date>=? AND from_date<=?").all(user.id,from,to);
  const permissions=db.prepare("SELECT id,work_date,kind,from_time,to_time,minutes FROM attendance_permissions WHERE user_id=? AND status='approved' AND work_date BETWEEN ? AND ?").all(user.id,from,to);
  const notices=db.prepare("SELECT id,work_date,kind,expected_time,status FROM attendance_notices WHERE user_id=? AND work_date BETWEEN ? AND ?").all(user.id,from,to);
  const locations=db.prepare('SELECT work_date,kind,zone,needs_explanation,reviewed_by FROM attendance_punch_locations WHERE user_id=? AND work_date BETWEEN ? AND ?').all(user.id,from,to);
  return {
    exemption:date=>exemptions.find(x=>x.from_date<=date&&date<=x.to_date)?.id??null,
    permissions:date=>permissions.filter(x=>x.work_date===date),
    notices:date=>notices.filter(x=>x.work_date===date),
    locations:date=>locations.filter(x=>x.work_date===date),
    holiday:date=>holidays.get(date)??null,
    mission:date=>missions.find(m=>m.from_date<=date&&date<=m.to_date)?.destination??null,
    shift:date=>{const s=shifts.find(x=>x.from_date<=date&&date<=x.to_date);return s?{start:s.start_time,end:s.end_time,workdays:JSON.parse(s.workdays_json),shift_id:s.id}:null;}
  };
}

// حالة كل يوم عمل في المدى. السياسة تحدد أيام العمل ومهلة التأخير؛ دونها لا يُحكم على يوم بتأخر أو غياب.
export function dayStates(db,user,from,to,today=riyadhDate()){
  const records=new Map(db.prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date BETWEEN ? AND ?').all(user.id,from,to).map(r=>[r.work_date,r]));
  const absences=new Map(db.prepare("SELECT * FROM attendance_absences WHERE user_id=? AND work_date BETWEEN ? AND ? AND status IN ('proposed','confirmed')").all(user.id,from,to).map(a=>[a.work_date,a]));
  const leave=leaveDates(db,user.id,from,to),overrides=dayOverrides(db,user,from,to),days=[];
  for(let date=from;date<=to&&date<=today;date=addDays(date,1)){
    const policy=acceptedPolicy(db,user.tenant_id,'working_time',date),shift=overrides.shift(date),base=policy?JSON.parse(policy.parameters):null,params=effectiveHours(base,shift,date),holiday=overrides.holiday(date),mission=overrides.mission(date),record=records.get(date)??null,absence=absences.get(date)??null;
    const exemption=overrides.exemption(date),permits=overrides.permissions(date),notices=overrides.notices(date),acceptedLate=notices.find(n=>n.kind==='late'&&n.status==='accepted'),acceptedAbsent=notices.find(n=>n.kind==='absent'&&n.status==='accepted');
    let state,late=0,early=0,excusedBy=null;
    if(params&&!params.workdays.includes(weekday(date))&&!record)state='off';
    else if(holiday&&!record)state='holiday';
    else if(leave.has(date))state='leave';
    else if(exemption)state='exempt';
    else if(mission&&!(record?.check_in_at&&record?.check_out_at))state='mission';
    else if(absence?.status==='confirmed')state='unpaid_absence';
    else if(!record)state=date===today?'today_open':!params?'off':acceptedAbsent?'excused':'unexplained';
    else if(!record.check_in_at||!record.check_out_at)state=date===today?'today_open':'incomplete';
    else if(!params)state='present';
    else{
      // التأخر من بداية الدوام بعد المهلة، والانصراف المبكر قبل نهايته. الإذن المعتمد أو إشعار التأخر المقبول يرفعان العلامة.
      const start=minutesOf(params.start),limit=start+(params.grace_minutes??0),checkIn=minutesOf(riyadhClock(record.check_in_at)),overnight=minutesOf(params.end)<=start;
      let lateExcuse=null,earlyExcuse=null;
      if(checkIn>limit){
        late=checkIn-start;
        lateExcuse=covers(permits,limit,checkIn)?.id??(acceptedLate&&minutesOf(acceptedLate.expected_time)>=checkIn?acceptedLate.id:null);
      }
      if(!overnight&&record.check_out_at<toIso(date,params.end)){
        const checkOut=minutesOf(riyadhClock(record.check_out_at));
        early=minutesOf(params.end)-checkOut;earlyExcuse=covers(permits,checkOut,minutesOf(params.end))?.id??null;
      }
      excusedBy=lateExcuse??earlyExcuse;
      state=late&&!lateExcuse?'late':early&&!earlyExcuse?'early_leave':excusedBy?'present_permission':'present';
    }
    const worked=record?.check_in_at&&record?.check_out_at?Math.round((Date.parse(record.check_out_at)-Date.parse(record.check_in_at))/60000):0;
    const expected=['present','late','early_leave','present_permission','incomplete','unexplained','unpaid_absence','today_open'].includes(state)&&params?expectedMinutes(params):0;
    const zones=Object.fromEntries(overrides.locations(date).map(l=>[l.kind,{zone:l.zone,zone_name:ZONE_NAMES[l.zone],needs_explanation:!!l.needs_explanation&&!l.reviewed_by}]));
    days.push({date,state,state_name:DAY_STATES[state],check_in:riyadhClock(record?.check_in_at),check_out:riyadhClock(record?.check_out_at),source:record?.source??null,absence_status:absence?.status??null,policy_id:policy?.id??null,note:holiday??mission??null,shift:shift?`${shift.start}–${shift.end}`:null,
      ramadan:!!params?.ramadan_day,hours:params?`${params.start}–${params.end}`:null,late_minutes:late,early_minutes:early,worked_minutes:worked,expected_minutes:expected,permission_minutes:permits.reduce((n,p)=>n+p.minutes,0),excused_by:excusedBy,exemption_id:exemption,zones});
  }
  return days;
}
export function confirmedUnpaidDays(db,userId,from,to){
  return db.prepare("SELECT work_date FROM attendance_absences WHERE user_id=? AND status='confirmed' AND work_date BETWEEN ? AND ? ORDER BY work_date").all(userId,from,to).map(r=>r.work_date);
}
const summarize=days=>Object.fromEntries(Object.keys(DAY_STATES).map(key=>[key,days.filter(d=>d.state===key).length]));
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);

export function attendanceBoard(db,supplied,month){
  const u=actor(db,supplied),today=riyadhDate(),{from,to}=monthRange(month??today.slice(0,7));
  const mine=dayStates(db,u,from,to,today),record=db.prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').get(u.id,today)??null;
  const name=userId=>db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null;
  const correctionView=c=>({...c,employee_name:name(c.user_id),decided_by_name:c.decided_by?name(c.decided_by):null,actions:c.status==='pending'&&c.user_id!==u.id&&(isManagerOf(db,u,c.user_id)||u.caps.includes('hr.attendance.manage'))?['approve_correction','reject_correction']:[]});
  const absenceView=a=>({...a,employee_name:name(a.user_id),proposed_by_name:name(a.proposed_by),decided_by_name:a.decided_by?name(a.decided_by):null,
    actions:a.status!=='proposed'?[]:a.user_id===u.id?(a.employee_statement?[]:['state_absence']):(a.proposed_by!==u.id&&u.caps.includes('hr.attendance.approve')?['confirm_absence','dismiss_absence']:[])});
  const team=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id).map(member=>{const day=dayStates(db,{...member,tenant_id:u.tenant_id},today,today,today)[0];return {...member,today:day??null};});
  const hr=u.caps.length>0;
  const visibleTo=hr?'1=1':'(c.user_id=? OR c.user_id IN (SELECT id FROM users WHERE manager_id=?))';
  const args=hr?[u.tenant_id]:[u.tenant_id,u.id,u.id];
  const corrections=db.prepare(`SELECT c.* FROM attendance_corrections c WHERE c.tenant_id=? AND ${visibleTo} ORDER BY c.created_at DESC LIMIT 100`).all(...args).map(correctionView);
  const absences=db.prepare(`SELECT c.* FROM attendance_absences c WHERE c.tenant_id=? AND ${hr?'1=1':'c.user_id=?'} ORDER BY c.created_at DESC LIMIT 100`).all(...(hr?[u.tenant_id]:[u.tenant_id,u.id])).map(absenceView);
  const company=hr?db.prepare("SELECT id,name,tenant_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id).map(member=>({id:member.id,name:member.name,summary:summarize(dayStates(db,member,from,to,today))})):null;
  const policy=acceptedPolicy(db,u.tenant_id,'working_time',today);
  return {today,month:from.slice(0,7),user_id:u.id,permissions:u.caps,day_states:DAY_STATES,
    policy:policy?{id:policy.id,title:policy.title,...JSON.parse(policy.parameters)}:null,
    me:{today:{check_in:riyadhClock(record?.check_in_at),check_out:riyadhClock(record?.check_out_at),zones:mine.find(d=>d.date===today)?.zones??{}},can_check_in:!record?.check_in_at,can_check_out:!!record?.check_in_at&&!record?.check_out_at,days:mine,summary:summarize(mine)},
    team,corrections,absences,company,
    rule:'اليوم بلا سجل أو بسجل ناقص يحتاج توضيحًا فقط. لا خصم إلا بغياب غير مدفوع يقترحه موظف الموارد البشرية ويعتمده شخص آخر بعد سماع الموظف.'};
}

export function punch(db,supplied,input){
  writing(db);
  const u=actor(db,supplied);
  v.object(input,['kind','location','location_error','location_notice_ack']);
  if(!['in','out'].includes(input.kind))fail(400,'kind','اختر: حضور ولا انصراف');
  // الوقت من الخادم دائمًا؛ لا يُقبل وقت من المتصفح.
  const time=now(),date=riyadhDate(Date.parse(time)),record=db.prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').get(u.id,date);
  if(input.kind==='in'){
    if(record?.check_in_at)fail(409,'already_checked_in','حضورك اليوم مسجّل — إذا تبي تعدّله اطلب تصحيح');
    if(record)db.prepare('UPDATE attendance_records SET check_in_at=?,updated_at=? WHERE id=?').run(time,time,record.id);
    else db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,NULL,'self',?,?)").run(id(),u.tenant_id,u.id,date,time,time,time);
  }else{
    if(!record?.check_in_at)fail(409,'check_in_required','ما فيه حضور مسجّل اليوم — إذا نسيت تسجّله اطلب تصحيح');
    if(record.check_out_at)fail(409,'already_checked_out','انصرافك اليوم مسجّل — إذا تبي تعدّله اطلب تصحيح');
    if(time<=record.check_in_at)fail(409,'too_soon','وقت الانصراف لازم يكون بعد وقت الحضور');
    db.prepare('UPDATE attendance_records SET check_out_at=?,updated_at=? WHERE id=?').run(time,time,record.id);
  }
  audit(db,u,'attendance',u.id,'attendance.'+input.kind,{}, {work_date:date});
  // الموقع قرينة تُعلَّم ولا تمنع: البصمة سُجلت أعلاه قبل أي حكم على الموقع.
  const location=recordPunchLocation(db,u,{date,kind:input.kind,location:input.location,locationError:input.location_error,noticeAck:input.location_notice_ack});
  return {...attendanceBoard(db,u),punch_location:location};
}

export function requestCorrection(db,supplied,input){
  writing(db);
  const u=actor(db,supplied);
  v.object(input,['work_date','proposed_in','proposed_out','reason']);
  const date=v.date(input.work_date),today=riyadhDate();
  if(date>today||date<addDays(today,-45))fail(400,'work_date','التصحيح ليوم فات، وداخل 45 يوم من تاريخه');
  // جانبٌ واحد يكفي (طلب المالك، 30 سبتمبر): من نسي الانصراف وحده لا يُطالَب بكتابة حضورٍ مسجَّلٍ أصلًا.
  // والفارغ يعني «لا تمسّه»، لا «امحه»: عند الاعتماد يُكتب المقترَح ويبقى الآخر كما هو.
  const wants=key=>input[key]!==undefined&&input[key]!==null&&String(input[key]).trim()!=='';
  const proposedIn=wants('proposed_in')?clock(input.proposed_in,'وقت الحضور'):null;
  const proposedOut=wants('proposed_out')?clock(input.proposed_out,'وقت الانصراف'):null;
  if(!proposedIn&&!proposedOut)fail(400,'nothing_proposed','اختر وش تبي تصحّح: الحضور، ولا الانصراف، ولا الاثنين');
  if(db.prepare("SELECT 1 FROM attendance_corrections WHERE user_id=? AND work_date=? AND status='pending'").get(u.id,date))fail(409,'pending_correction','عندك طلب تصحيح معلّق على نفس اليوم');
  const record=db.prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').get(u.id,date),correctionId=id();
  // الترتيب يُفحص على الزوج الذي سيصير عليه اليوم بعد الاعتماد — لا على المقترَح وحده.
  // فلو صحّح الانصراف فقط، يُقارن بحضوره المسجَّل؛ وإلا لأمكن انصرافٌ قبل حضورٍ قائم.
  // والمقارنة على **اللحظة** لا على نصّ الساعة: المقترَح ساعةُ الرياض والمسجَّل لحظةٌ بتوقيت UTC،
  // فاقتطاع الساعة من المسجَّل يقارن 07:00 رياض بـ06:00 UTC ويمرّ ما يجب أن يُرفض.
  const instant=(proposed,recorded)=>proposed?toIso(date,proposed):(recorded??null);
  const pairIn=instant(proposedIn,record?.check_in_at),pairOut=instant(proposedOut,record?.check_out_at);
  if(pairIn&&pairOut&&pairOut<=pairIn)fail(400,'time_order','وقت الانصراف لازم يكون بعد وقت الحضور');
  for(const [value,label] of [[proposedIn,'وقت الحضور'],[proposedOut,'وقت الانصراف']])
    if(value&&date===today&&toIso(date,value)>now())fail(400,'future_time','ما ينفع تصحّح وقت ما جا بعد');
  db.prepare("INSERT INTO attendance_corrections(id,tenant_id,user_id,work_date,proposed_in,proposed_out,reason,previous_in,previous_out,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)")
    .run(correctionId,u.tenant_id,u.id,date,proposedIn,proposedOut,v.text(input.reason,'سبب التصحيح',2000,10),record?.check_in_at??null,record?.check_out_at??null,now());
  audit(db,u,'attendance',u.id,'attendance.correction_requested',{}, {work_date:date});
  return {id:correctionId};
}
export function decideCorrection(db,supplied,correctionId,decision,input){
  writing(db);
  const u=actor(db,supplied);
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض');
  const c=typeof correctionId==='string'&&db.prepare("SELECT * FROM attendance_corrections WHERE id=? AND tenant_id=? AND status='pending'").get(correctionId,u.tenant_id);
  if(!c||c.user_id===u.id||!(isManagerOf(db,u,c.user_id)||u.caps.includes('hr.attendance.manage')))fail(404,'not_found','طلب التصحيح هذا مو من صلاحيتك');
  const time=now(),note=v.text(input.note,'أساس القرار',2000,decision==='approve'?3:10);
  if(decision==='approve'){
    const record=db.prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').get(c.user_id,c.work_date);
    // الجانب غير المقترَح يبقى كما هو في السجل: تصحيحُ الانصراف لا يمحو حضورًا مسجَّلًا.
    const inAt=c.proposed_in?toIso(c.work_date,c.proposed_in):(record?.check_in_at??null);
    const outAt=c.proposed_out?toIso(c.work_date,c.proposed_out):(record?.check_out_at??null);
    // والسجل قد يكون تغيّر بين الطلب والقرار، فيُفحص الترتيب على ما سيُكتب فعلًا لا على ما طُلب.
    if(inAt&&outAt&&outAt<=inAt)fail(409,'time_order','سجل اليوم تغيّر بعد الطلب، فالوقتان صارا غير مرتّبين. اطلب تصحيحًا جديدًا.');
    if(record)db.prepare("UPDATE attendance_records SET check_in_at=?,check_out_at=?,source='correction',updated_at=? WHERE id=?").run(inAt,outAt,time,record.id);
    else db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,?,'correction',?,?)").run(id(),c.tenant_id,c.user_id,c.work_date,inAt,outAt,time,time);
  }
  db.prepare('UPDATE attendance_corrections SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(decision==='approve'?'approved':'rejected',u.id,time,note,c.id);
  audit(db,u,'attendance',c.user_id,'attendance.correction_'+decision,{}, {work_date:c.work_date});
  // إشعار صاحب التصحيح بالقرار (B6).
  notifySubject(db,{userId:c.user_id,kind:'attendance_correction_'+decision,subjectKind:'attendance_correction',subjectId:c.id,
    title:decision==='approve'?`اعتُمد تصحيح حضورك ليوم ${dayName(c.work_date)}`:`رُفض طلب تصحيح حضورك ليوم ${dayName(c.work_date)}`,
    body:decision==='approve'?'عُدِّل سجل حضور ذلك اليوم بالوقتين اللذين طلبتهما.':'سبب الرفض مكتوب في «حضوري»؛ سجل اليوم لم يتغير.'});
  return {id:c.id,status:decision==='approve'?'approved':'rejected'};
}

export function proposeAbsence(db,supplied,input){
  writing(db);
  const u=actor(db,supplied);
  if(!u.caps.includes('hr.attendance.manage'))fail(403,'not_permitted','اقتراح الغياب بدون أجر لموظفي الموارد البشرية المخوَّلين وبس');
  v.object(input,['user_id','work_date','reason']);
  const employee=db.prepare("SELECT id,tenant_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!employee)fail(404,'not_found','ما لقينا الموظف هذا في نطاقك');
  if(employee.id===u.id)fail(409,'separation_of_duties','ما ينفع الموظف يقترح غياب على نفسه');
  const date=v.date(input.work_date),today=riyadhDate();
  if(date>=today)fail(400,'work_date','الغياب يتسجّل على يوم فات وبس');
  const day=dayStates(db,employee,date,date,today)[0];
  if(!day?.policy_id)fail(409,'policy_required','ما فيه سياسة ساعات عمل معتمدة من مدير الموارد البشرية لهذا التاريخ');
  if(day.state!=='unexplained')fail(409,'not_absent',`حالة اليوم «${day.state_name}» — الغياب ما يُقترح إلا على يوم عمل بلا سجل ولا إجازة`);
  const absenceId=id();
  db.prepare("INSERT INTO attendance_absences(id,tenant_id,user_id,work_date,reason,status,proposed_by,created_at) VALUES(?,?,?,?,?,'proposed',?,?)").run(absenceId,u.tenant_id,employee.id,date,v.text(input.reason,'سبب الاقتراح',2000,10),u.id,now());
  audit(db,u,'attendance',employee.id,'attendance.absence_proposed',{}, {work_date:date});
  absenceNotice(db,u,'proposed',{id:absenceId,user_id:employee.id,work_date:date});
  return {id:absenceId};
}
export function stateAbsence(db,supplied,absenceId,input){
  writing(db);
  const u=actor(db,supplied);
  v.object(input,['statement']);
  const a=typeof absenceId==='string'&&db.prepare("SELECT * FROM attendance_absences WHERE id=? AND tenant_id=? AND user_id=? AND status='proposed' AND employee_statement=''").get(absenceId,u.tenant_id,u.id);
  if(!a)fail(404,'not_found','ما فيه اقتراح غياب مفتوح ينتظر إفادتك');
  db.prepare('UPDATE attendance_absences SET employee_statement=? WHERE id=?').run(v.text(input.statement,'إفادتك',2000,10),a.id);
  audit(db,u,'attendance',u.id,'attendance.absence_statement',{}, {work_date:a.work_date});
  return {id:a.id};
}
export function decideAbsence(db,supplied,absenceId,decision,input){
  writing(db);
  const u=actor(db,supplied);
  if(!u.caps.includes('hr.attendance.approve'))fail(403,'not_permitted','اعتماد الغياب بدون أجر مو من صلاحيتك');
  v.object(input,['note']);
  if(!['confirm','dismiss'].includes(decision))fail(404,'not_found','القرار لازم يكون تأكيد ولا استبعاد');
  const a=typeof absenceId==='string'&&db.prepare("SELECT * FROM attendance_absences WHERE id=? AND tenant_id=? AND status='proposed'").get(absenceId,u.tenant_id);
  if(!a)fail(404,'not_found','ما لقينا اقتراح الغياب هذا');
  if(a.proposed_by===u.id||a.user_id===u.id)fail(409,'separation_of_duties','اللي اقترح الغياب ولا صاحبه ما يعتمده');
  // لا يُعتمد قبل إفادة الموظف إلا بعد ثلاثة أيام من الاقتراح.
  if(decision==='confirm'&&!a.employee_statement&&a.created_at>new Date(Date.now()-3*86400000).toISOString())fail(409,'statement_pending','الموظف ما قدّم إفادته لين الحين — يُعتمد بدونها بعد ثلاثة أيام من الاقتراح');
  const status=decision==='confirm'?'confirmed':'dismissed';
  db.prepare('UPDATE attendance_absences SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,10),a.id);
  audit(db,u,'attendance',a.user_id,'attendance.absence_'+status,{}, {work_date:a.work_date});
  absenceNotice(db,u,status,a);
  return {id:a.id,status};
}
