import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
import { notifySubject, dateRange, dayName } from './notices.mjs';
import { overtimePolicy, dayTypeFor, enforceCaps, missionOverlap, overtimeOnWorkingDays, ART77_9, suggestedMinor, wageBasis, annualPaidMinor, sar, DAY_TYPES } from './overtime-rules.mjs';
import { annualCapMinor } from './attendance-policy.mjs';
import { missionNotice, overtimeNotice } from './module-notices.mjs';
import { refuse } from './refusal.mjs';
import { compensationOffer, compensatoryAvailability, compensatoryBalanceView, consentTerms, recordConsent, creditOvertime, payoutQueue, uncreditedOvertime, manualOvertimeNear, serviceEndedOn, ART77_6 } from './leave-compensatory.mjs';
import { hoursText } from './static/leave-count.mjs';

// استكمال الحضور: عطل رسمية، مهمات عمل، ورديات، وعمل إضافي.
// العمل الإضافي (م76–77): الأصل تكليف مسبق في overtime-rules.mjs، والطلب اللاحق بلا تكليف «بأثر رجعي» يلزمه تبرير ويُعلَّم.
// الأجر يُقترح من السياسة المقبولة والعقد الساري؛ يدخل المسير حركةً مقترحة يعتمدها شخص آخر، ولا يُصرف تلقائيًا.
const RIYADH_OFFSET=3*3600000;
const riyadhDate=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const id=()=>randomUUID();
const CAPS=['hr.attendance.manage','hr.attendance.approve','payroll.prepare'];
const STATUS={proposed:'مقترحة',approved:'معتمدة',rejected:'مرفوضة',pending:'بانتظار القرار',cancelled:'ملغاة'};
const WEEKDAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','تسجيل الحضور لحسابات الموظفين وبس');
  u.caps=CAPS.filter(key=>holds(db,u,key));return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة الحضور تبي معاملة قاعدة بيانات');}
const need=(u,cap,message)=>{if(!u.caps.includes(cap))fail(403,'not_permitted',message);};
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
function employee(db,u,userId){
  const person=typeof userId==='string'&&db.prepare("SELECT id,name,tenant_id,manager_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا في نطاقك');return person;
}
function clock(value,label){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail(400,'invalid_time',`${label}: اكتب الوقت بصيغة 09:00`);return value;}
function range(input,maxDays){
  const from=v.date(input.from_date),to=v.date(input.to_date);
  if(to<from)fail(400,'date_order','خلّ تاريخ النهاية بعد تاريخ البداية');
  if(to>addDays(from,maxDays-1))fail(400,'range_too_long',`المدة ما تزيد عن ${maxDays} يوم`);
  return {from,to};
}

export function attendanceExtras(db,supplied){
  const u=actor(db,supplied),today=riyadhDate(),hr=u.caps.includes('hr.attendance.manage')||u.caps.includes('hr.attendance.approve');
  const team=db.prepare('SELECT id FROM users WHERE tenant_id=? AND manager_id=? AND active=1').all(u.tenant_id,u.id).map(r=>r.id);
  const scope=hr?'1=1':`(x.user_id=? OR x.user_id IN (${team.map(()=>'?').join(',')||"''"}))`,args=hr?[u.tenant_id]:[u.tenant_id,u.id,...team];
  const holidays=db.prepare("SELECT * FROM public_holidays WHERE tenant_id=? AND (status<>'rejected' OR proposed_by=?) AND holiday_date>=? ORDER BY holiday_date LIMIT 60").all(u.tenant_id,u.id,addDays(today,-60))
    .map(h=>({...h,status_name:STATUS[h.status],proposed_by_name:name(db,h.proposed_by),decided_by_name:name(db,h.decided_by),actions:h.status==='proposed'&&h.proposed_by!==u.id&&u.caps.includes('hr.attendance.approve')?['approve_holiday','reject_holiday']:[]}));
  const decider=row=>row.status==='pending'&&row.user_id!==u.id&&(isManagerOf(db,u,row.user_id)||u.caps.includes('hr.attendance.approve')||(!!row.assignment_id&&db.prepare('SELECT assigned_by FROM overtime_assignments WHERE id=?').get(row.assignment_id)?.assigned_by===u.id));
  const missions=db.prepare(`SELECT x.* FROM work_missions x WHERE x.tenant_id=? AND ${scope} ORDER BY x.created_at DESC LIMIT 100`).all(...args)
    .map(m=>({...m,status_name:STATUS[m.status],employee_name:name(db,m.user_id),decided_by_name:name(db,m.decided_by),actions:decider(m)?['approve_mission','reject_mission']:m.status==='pending'&&m.user_id===u.id?['cancel_mission']:[]}));
  const overtime=db.prepare(`SELECT x.* FROM overtime_requests x WHERE x.tenant_id=? AND ${u.caps.includes('payroll.prepare')?'1=1':scope} ORDER BY x.created_at DESC LIMIT 100`).all(...(u.caps.includes('payroll.prepare')?[u.tenant_id]:args))
    .map(o=>{const adjustment=o.adjustment_id?db.prepare('SELECT status,month,amount_minor FROM payroll_adjustments WHERE id=?').get(o.adjustment_id):null,linkable=o.status==='approved'&&o.user_id!==u.id&&u.caps.includes('payroll.prepare')&&(!adjustment||adjustment.status==='rejected');
      // م77(6) (ص 27): ساعات اختير لها الإجازة ولم تُقيَّد رصيدًا وانتهت خدمة صاحبها تُدفع نقدًا من الباب نفسه (ما قُيِّد له طابور «أرصدة تعويضية مستحقة الصرف»).
      const cashOut=linkable&&o.compensation==='time_off'&&!db.prepare('SELECT 1 FROM compensatory_credits WHERE overtime_request_id=?').get(o.id)&&!!serviceEndedOn(db,u.tenant_id,o.user_id);
      const payable=linkable&&(o.compensation==='pay'||cashOut),suggested=payable?suggestedMinor(db,o.user_id,o.work_date,o.minutes,overtimePolicy(db,u.tenant_id,o.work_date)):null;
      // قبل اعتماد ساعات اختير لها الإجازة: حركة «عمل إضافي» يدوية قائمة لصاحبها حول يوم العمل قد تكون دفعت الساعات نفسها. تُعرض على المعتمد ولا تُخفى.
      const manual=o.compensation==='time_off'&&decider(o)?manualOvertimeNear(db,u.tenant_id,o.user_id,o.work_date):[];
      return {...o,double_pay_warning:manual.length?`لصاحب الطلب ${manual.length} حركة «عمل إضافي» يدوية غير مرتبطة بطلب (${manual.map(a=>`${a.month}: ${a.amount} ريال`).join('، ')}). تحقق مع مُعد الرواتب أنها ليست عن هذه الساعات قبل اعتمادها إجازةً: الساعة لا تُعوَّض مرتين (نظام العمل م107/1).`:null,status_name:STATUS[o.status],employee_name:name(db,o.user_id),decided_by_name:name(db,o.decided_by),adjustment:adjustment?{status:adjustment.status,month:adjustment.month}:null,
        retroactive:!!o.retroactive,retroactive_name:o.retroactive?'بأثر رجعي بلا تكليف مسبق — بتبرير':'',compensation_name:o.compensation==='time_off'?'إجازة تعويضية بدل الأجر بموافقة الموظف':'أجر',day_type_name:o.day_type?DAY_TYPES[o.day_type]:null,suggested:sar(suggested),
        end_of_service_cash_out:cashOut?`انتهت خدمة صاحبها قبل استعمال الإجازة ولم تُقيَّد رصيدًا: يُدفع الأجر الإضافي نقدًا (${ART77_6})`:null,
        actions:decider(o)?['approve_overtime','reject_overtime']:payable?['overtime_to_payroll']:[]};});
  const shifts=db.prepare(`SELECT x.* FROM shift_assignments x WHERE x.tenant_id=? AND ${scope} AND x.to_date>=? ORDER BY x.from_date DESC LIMIT 100`).all(...args,addDays(today,-30))
    .map(s=>({...s,workdays:JSON.parse(s.workdays_json),employee_name:name(db,s.user_id),assigned_by_name:name(db,s.assigned_by),actions:!s.ended_at&&s.to_date>=today&&s.user_id!==u.id&&u.caps.includes('hr.attendance.manage')?['end_shift']:[]}));
  const employees=u.caps.includes('hr.attendance.manage')?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[];
  return {weekdays:WEEKDAYS,holidays,missions,overtime,shifts,employees,
    overtime_minutes_approved_this_month:db.prepare("SELECT COALESCE(SUM(minutes),0) AS n FROM overtime_requests WHERE user_id=? AND status='approved' AND work_date LIKE ?").get(u.id,today.slice(0,7)+'%').n,
    // رصيد الإجازة التعويضية الحي من دفترها (ترحيل 125): ما قُيِّد ناقص ما استُعمل وحُجز وأُحيل أجرًا، ودون ما انقضت مهلته. كان مجموع دقائق لا ينقص أبدًا.
    time_off_minutes:compensatoryAvailability(db,u,today).available_minutes,
    // ساعاتي المعتمدة التي اخترت لها وقت الراحة ولم تُقيَّد رصيدًا بعد (اعتُمدت قبل الدفتر أو قبل اعتماد السياسة): تُعرض لصاحبها، فلا يرى صفرًا مكان ساعاته.
    // ما دُفع نقدًا عند انتهاء الخدمة (م77(6)) خرج منها: له حركة مسير قائمة.
    time_off_uncredited_minutes:db.prepare("SELECT COALESCE(SUM(o.minutes),0) AS n FROM overtime_requests o WHERE o.tenant_id=? AND o.user_id=? AND o.status='approved' AND o.compensation='time_off' AND NOT EXISTS(SELECT 1 FROM compensatory_credits c WHERE c.overtime_request_id=o.id) AND NOT EXISTS(SELECT 1 FROM payroll_adjustments a WHERE a.id=o.adjustment_id AND a.status<>'rejected')").get(u.tenant_id,u.id).n,
    compensatory:compensatoryBalanceView(db,u,today),compensation_offer:compensationOffer(db,u,today),
    // طابوران باسمين خاصين (يقرؤهما صندوق «بانتظار قراري» من مصدر الحضور): ما يحيله مُعد الرواتب أجرًا، وما يقيّده معتمد الحضور من ساعات اعتُمدت قبل الدفتر.
    compensatory_payouts:payoutQueue(db,u,today),compensatory_uncredited:uncreditedOvertime(db,u),
    overtime_rule:'الأصل تكليف كتابي مسبق من مديرك (م76(1)، م77(2)) يوافق عليه صاحب الصلاحية (م77(3)) وتعتمد الموارد البشرية ميزانيته (م77(7)). الطلب اللاحق بلا تكليف يُعلَّم «بأثر رجعي» ويلزمه تبرير. الأجر المحسوب مقترح فقط: يدخل المسير بحركة يعتمدها شخص آخر.'};
}

export function proposeHoliday(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.manage','اقتراح العطل لموظفي الموارد البشرية المخولين');
  v.object(input,['holiday_date','name','basis']);
  const date=v.date(input.holiday_date);
  if(date<addDays(riyadhDate(),-45))fail(400,'holiday_date','ما تنسجّل عطلة مضى عليها أكثر من 45 يوم');
  if(db.prepare("SELECT 1 FROM public_holidays WHERE tenant_id=? AND holiday_date=? AND status IN ('proposed','approved')").get(u.tenant_id,date))fail(409,'duplicate_holiday','هذا التاريخ عليه عطلة مسجّلة ولا مقترحة');
  const holidayId=id();
  db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,created_at) VALUES(?,?,?,?,?,'proposed',?,?)").run(holidayId,u.tenant_id,date,v.text(input.name,'اسم العطلة',120,3),v.text(input.basis,'السند (إعلان رسمي أو قرار الشركة)',1000,10),u.id,now());
  audit(db,u,'attendance',holidayId,'holiday.proposed',{}, {holiday_date:date});
  return {id:holidayId};
}
export function decideHoliday(db,supplied,holidayId,decision,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.approve','اعتماد العطل خارج صلاحيتك');
  v.object(input,['note']);if(!['approve','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض');
  const h=typeof holidayId==='string'&&db.prepare("SELECT * FROM public_holidays WHERE id=? AND tenant_id=? AND status='proposed'").get(holidayId,u.tenant_id);
  if(!h)fail(404,'not_found','ما لقينا عطلة مقترحة بهذا المعرّف');
  if(h.proposed_by===u.id)fail(409,'separation_of_duties','اللي اقترح العطلة ما يعتمدها');
  // عطلة تُعتمد بأثر رجعي لا تمحو غيابًا معتمدًا؛ يظهر التعارض للمراجعة بدل إخفائه.
  const conflicts=decision==='approve'?db.prepare("SELECT COUNT(*) AS n FROM attendance_absences WHERE tenant_id=? AND work_date=? AND status='confirmed'").get(u.tenant_id,h.holiday_date).n:0;
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE public_holidays SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',1000,decision==='approve'?3:10),h.id);
  audit(db,u,'attendance',h.id,'holiday.'+status,{}, {holiday_date:h.holiday_date,confirmed_absences_on_date:conflicts});
  return {id:h.id,status,confirmed_absences_on_date:conflicts};
}

export function requestMission(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['from_date','to_date','destination','purpose']);
  const {from,to}=range(input,60),today=riyadhDate();
  if(from<addDays(today,-14))fail(400,'from_date','اطلب المهمة قبلها، ولا خلال 14 يوم من بدايتها');
  if(db.prepare("SELECT 1 FROM work_missions WHERE user_id=? AND status IN ('pending','approved') AND to_date>=? AND from_date<=?").get(u.id,from,to))fail(409,'overlapping_mission','عندك مهمة ثانية تتقاطع مع هذي المدة');
  // م77(9): لا يُجمع أجر العمل الإضافي والتكليف بمهمة رسمية خلال أيام العمل المعتادة وحدها؛ عمل إضافي في يوم راحة أو عطلة داخل المدة لا يمنع المهمة.
  const overtime=overtimeOnWorkingDays(db,u,from,to);
  if(overtime)fail(409,'overtime_overlap',`عندك عمل إضافي ${overtime.kind==='assignment'?'مكلّف فيه':'مسجّل'} في يوم العمل المعتاد ${overtime.date} داخل هذي المدة. ${ART77_9}`);
  const missionId=id();
  db.prepare("INSERT INTO work_missions(id,tenant_id,user_id,from_date,to_date,destination,purpose,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)").run(missionId,u.tenant_id,u.id,from,to,v.text(input.destination,'الوجهة',200,2),v.text(input.purpose,'الغرض',2000,10),now());
  audit(db,u,'attendance',u.id,'mission.requested',{}, {from_date:from,to_date:to});
  missionNotice(db,u,'requested',{id:missionId,user_id:u.id,from_date:from,to_date:to});
  return {id:missionId};
}
export function decideMission(db,supplied,missionId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);if(!['approve','reject','cancel'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض ولا إلغاء');
  const m=typeof missionId==='string'&&db.prepare("SELECT * FROM work_missions WHERE id=? AND tenant_id=? AND status='pending'").get(missionId,u.tenant_id);
  if(!m)fail(404,'not_found','ما لقينا مهمة معلّقة بهذا المعرّف');
  if(decision==='cancel'){if(m.user_id!==u.id)fail(404,'not_found','الإلغاء لصاحب المهمة وبس');}
  else if(m.user_id===u.id||!(isManagerOf(db,u,m.user_id)||u.caps.includes('hr.attendance.approve')))fail(404,'not_found','القرار في هذي المهمة مو من صلاحيتك');
  const status={approve:'approved',reject:'rejected',cancel:'cancelled'}[decision];
  db.prepare('UPDATE work_missions SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',1000,decision==='approve'?3:10),m.id);
  audit(db,u,'attendance',m.user_id,'mission.'+status,{}, {from_date:m.from_date,to_date:m.to_date});
  if(decision!=='cancel')notifySubject(db,{userId:m.user_id,kind:'mission_'+status,subjectKind:'work_mission',subjectId:m.id,title:decision==='approve'?`اعتُمدت مهمتك إلى ${m.destination} ${dateRange(m.from_date,m.to_date)}`:`رُفض طلب مهمتك إلى ${m.destination}`,body:decision==='approve'?'أيام المهمة المعتمدة لا تحتاج بصمة.':'سبب الرفض مكتوب في «حضوري».'});
  return {id:m.id,status};
}

export function assignShift(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.manage','إسناد الورديات لموظفي الموارد البشرية المخولين');
  v.object(input,['user_id','from_date','to_date','start_time','end_time','workdays','reason']);
  const person=employee(db,u,input.user_id);
  if(person.id===u.id)fail(409,'separation_of_duties','ما ينفع الموظف يسند وردية لنفسه');
  const {from,to}=range(input,366),start=clock(input.start_time,'بداية الوردية'),end=clock(input.end_time,'نهاية الوردية');
  if(start===end)fail(400,'time_order','بداية الوردية لازم تختلف عن نهايتها');
  if(from<riyadhDate())fail(400,'from_date','الوردية تبدأ من اليوم ولا بعده؛ والأيام اللي فاتت لها طلب تصحيح');
  if(!Array.isArray(input.workdays)||!input.workdays.length||input.workdays.length>7||new Set(input.workdays).size!==input.workdays.length||input.workdays.some(d=>!Number.isInteger(d)||d<0||d>6))fail(400,'workdays','اختر أيام العمل من 0 (الأحد) لين 6 (السبت)');
  if(db.prepare('SELECT 1 FROM shift_assignments WHERE user_id=? AND to_date>=? AND from_date<=?').get(person.id,from,to))fail(409,'overlapping_shift','للموظف وردية تتقاطع مع هذي المدة — أنهِ السابقة أول');
  const shiftId=id();
  db.prepare('INSERT INTO shift_assignments(id,tenant_id,user_id,from_date,to_date,start_time,end_time,workdays_json,reason,assigned_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(shiftId,u.tenant_id,person.id,from,to,start,end,JSON.stringify([...input.workdays].sort()),v.text(input.reason,'سبب الوردية',1000,10),u.id,now());
  audit(db,u,'attendance',person.id,'shift.assigned',{}, {from_date:from,to_date:to,start,end});
  notifySubject(db,{userId:person.id,kind:'shift_assigned',subjectKind:'shift_assignment',subjectId:shiftId,title:`أُسندت إليك وردية ${start}–${end} ${dateRange(from,to)}`,body:'أيامها وسببها في «حضوري». يُقاس حضورك عليها بدل الدوام العام.'});
  return {id:shiftId};
}
export function endShift(db,supplied,shiftId,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.manage','إنهاء الورديات لموظفي الموارد البشرية المخولين');
  v.object(input,['end_date','reason']);
  const s=typeof shiftId==='string'&&db.prepare('SELECT * FROM shift_assignments WHERE id=? AND tenant_id=? AND ended_at IS NULL').get(shiftId,u.tenant_id);
  if(!s||s.user_id===u.id)fail(404,'not_found','ما لقينا الوردية هذي');
  const end=v.date(input.end_date),today=riyadhDate();
  if(end<today||end<s.from_date||end>=s.to_date)fail(400,'end_date','خلّ تاريخ الإنهاء من اليوم وقبل نهاية الوردية الأصلية');
  db.prepare('UPDATE shift_assignments SET to_date=?,ended_by=?,ended_at=? WHERE id=?').run(end,u.id,now(),s.id);
  audit(db,u,'attendance',s.user_id,'shift.ended',{to_date:s.to_date},{to_date:end},v.text(input.reason,'سبب الإنهاء',1000,10));
  notifySubject(db,{userId:s.user_id,kind:'shift_ended',subjectKind:'shift_assignment',subjectId:s.id,title:`تنتهي ورديتك ${s.start_time}–${s.end_time} في ${dayName(end)}`,body:'بعدها يعود الدوام العام المعتمد.'});
  return {id:s.id,to_date:end};
}

// تسجيل الساعات الفعلية: على تكليف معتمد (الأصل)، أو «بأثر رجعي» بلا تكليف وبتبرير لا يقل عن 20 حرفًا (يُعلَّم).
// التعويض أجر افتراضًا؛ وقت الراحة بدل الأجر اختيار الموظف نفسه، فهو موافقته المسجلة (م77(6)).
export function requestOvertime(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['work_date','minutes','reason','assignment_id','compensation','consent']);
  const date=v.date(input.work_date),today=riyadhDate();
  if(date>today||date<addDays(today,-30))fail(400,'work_date','العمل الإضافي لليوم، ولا ليوم فات داخل 30 يوم');
  if(!Number.isInteger(input.minutes)||input.minutes<15||input.minutes>720||input.minutes%15)fail(400,'minutes','المدة بالدقايق من 15 لين 720، وبخطوات 15 دقيقة');
  if(db.prepare("SELECT 1 FROM overtime_requests WHERE user_id=? AND work_date=? AND status IN ('pending','approved')").get(u.id,date))fail(409,'duplicate_overtime','هذا اليوم عليه طلب عمل إضافي قائم');
  const compensation=input.compensation??'pay';
  if(!['pay','time_off'].includes(compensation))fail(400,'compensation','اختر: أجر ولا وقت راحة بدله');
  let assignment=null;
  if(input.assignment_id!==undefined&&input.assignment_id!==''){
    assignment=typeof input.assignment_id==='string'&&db.prepare("SELECT * FROM overtime_assignments WHERE id=? AND tenant_id=? AND user_id=? AND status='budget_approved'").get(input.assignment_id,u.tenant_id,u.id);
    if(!assignment)fail(404,'not_found','ما فيه تكليف معتمد لك بهذا المعرّف');
    if(!JSON.parse(assignment.days_json).some(d=>d.date===date))fail(409,'outside_assignment','اليوم هذا خارج أيام التكليف');
    if(input.minutes>assignment.minutes_per_day)fail(409,'over_assignment',`المكلّف فيه ${assignment.minutes_per_day} دقيقة في اليوم — والزيادة تبي تكليف جديد`);
  }
  // نوع اليوم يُحسب دائمًا (السياسة المعتمدة، وإلا أيام م73(1)) لأن م77(9) تقرؤه؛ السقوف (م77(8)) لا تُفرض بلا سياسة كما كان.
  const policy=overtimePolicy(db,u.tenant_id,date),type=dayTypeFor(db,u,date);
  const mission=type==='working'?missionOverlap(db,u.id,date,date):null;
  if(mission)fail(409,'mission_overlap',`عندك مهمة عمل (${mission.destination}) في هذا اليوم وهو يوم عمل معتاد. ${ART77_9}`);
  if(policy)enforceCaps(db,u,policy,[{date,minutes:input.minutes,type}]);
  const reason=assignment?v.text(input.reason,'العمل المنجز',2000,10):v.text(input.reason,'تبرير العمل الإضافي بأثر رجعي دون تكليف مسبق',2000,20);
  // الإجازة التعويضية بدل الأجر (نظام العمل م107/1، اللائحة التنفيذية م22 مكرر): اختيار الموظف نفسه وموافقته الصريحة على جملة تذكر المقدار والمهلة.
  // لا تُقبل بلا سياسة معتمدة تحدد النسبة والمهلة، ولا فوق السقف السنوي. الأجر يبقى الافتراض ولا يتغير فيه شيء.
  if(input.consent!==undefined&&typeof input.consent!=='boolean')fail(400,'consent','الموافقة على الإجازة التعويضية: نعم ولا لا');
  const terms=compensation==='time_off'?consentTerms(db,u,{work_date:date,minutes:input.minutes,consent:input.consent}):null;
  const overtimeId=id(),time=now();
  db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,created_at,assignment_id,retroactive,compensation,consent_at,day_type) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,?)")
    .run(overtimeId,u.tenant_id,u.id,date,input.minutes,reason,time,assignment?.id??null,assignment?0:1,compensation,compensation==='time_off'?time:null,type);
  audit(db,u,'attendance',u.id,assignment?'overtime.recorded':'overtime.requested_retroactive',{}, {work_date:date,minutes:input.minutes,compensation,assignment_id:assignment?.id??null});
  if(terms)recordConsent(db,u,overtimeId,terms,{work_date:date,minutes:input.minutes,consent_at:time});
  overtimeNotice(db,u,'requested',{id:overtimeId,user_id:u.id,work_date:date}); /* notifications (100): the manager hears of the request */
  return {id:overtimeId,retroactive:!assignment};
}
export function decideOvertime(db,supplied,overtimeId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);if(!['approve','reject'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد ولا رفض');
  const o=typeof overtimeId==='string'&&db.prepare("SELECT * FROM overtime_requests WHERE id=? AND tenant_id=? AND status='pending'").get(overtimeId,u.tenant_id);
  if(!o||o.user_id===u.id||!(isManagerOf(db,u,o.user_id)||u.caps.includes('hr.attendance.approve')))fail(404,'not_found','طلب العمل الإضافي هذا مو من صلاحيتك');
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE overtime_requests SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',1000,decision==='approve'?3:10),o.id);
  const manual=decision==='approve'&&o.compensation==='time_off'?manualOvertimeNear(db,u.tenant_id,o.user_id,o.work_date):[];
  audit(db,u,'attendance',o.user_id,'overtime.'+status,{}, {work_date:o.work_date,minutes:o.minutes,...(manual.length?{manual_overtime_adjustments:manual.map(a=>a.id)}:{})});
  // الاعتماد يقيّد الرصيد التعويضي في المعاملة نفسها، بالنسبة والمهلة اللتين وافق عليهما الموظف. طلب قديم بلا سياسة معتمدة يبقى ظاهرًا «لم يُقيَّد».
  const credit=decision==='approve'?creditOvertime(db,u,{...o,status}):null;
  const timeOff=credit?`اخترت الإجازة التعويضية بدل الأجر: قُيِّد لك ${hoursText(credit.leave_minutes)} ساعة إجازة، مهلتها حتى ${credit.expires_on}. اطلبها من «الإجازات»؛ ما لا تستعمله يُرد إلى ساعات عمل إضافي ويُقترح صرف أجره، ولا يدخل المسير الآن.`
    :'اخترت وقت راحة بدل الأجر. لم يُقيَّد الرصيد بعد: لا سياسة أنواع إجازات معتمدة فيها الإجازة التعويضية؛ تقيّده الموارد البشرية بعد اعتمادها، ولا يدخل المسير.';
  notifySubject(db,{userId:o.user_id,kind:'overtime_'+status,subjectKind:'overtime_request',subjectId:o.id,title:decision==='approve'?`اعتُمدت ساعات عملك الإضافي ليوم ${dayName(o.work_date)}`:`رُفض طلب عملك الإضافي ليوم ${dayName(o.work_date)}`,
    body:decision==='approve'?(o.compensation==='time_off'?timeOff:'يقترح مُعد الرواتب قيمتها للمسير ويعتمدها شخص آخر.'):'سبب الرفض مكتوب في «حضوري».'});
  return {id:o.id,status,...(manual.length?{warnings:[`لصاحب الطلب ${manual.length} حركة «عمل إضافي» يدوية غير مرتبطة بطلب في ${[...new Set(manual.map(a=>a.month))].join(' و')}؛ راجعها مع مُعد الرواتب: الساعة لا تُعوَّض مرتين.`]}:{})};
}
// الساعات المعتمدة تدخل المسير بحركة «عمل إضافي» مقترحة؛ اعتمادها يبقى لحامل تصريح اعتماد الرواتب.
// مع سياسة مقبولة وعقد ساري: المبلغ المقترح = الساعات × (أجر الساعة الفعلي + نسبة من أجر الساعة الأساسي). المبلغ المختلف عنه يلزمه أساس مكتوب.
const toMinor=amount=>{const m=/^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(amount));return m?Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')):null;};
export function overtimeToPayroll(db,supplied,overtimeId,input){
  writing(db);const u=actor(db,supplied);need(u,'payroll.prepare','تحويل العمل الإضافي إلى المسير لمُعد الرواتب');
  v.object(input,['month','amount','basis']);
  const o=typeof overtimeId==='string'&&db.prepare("SELECT * FROM overtime_requests WHERE id=? AND tenant_id=? AND status='approved'").get(overtimeId,u.tenant_id);
  if(!o||o.user_id===u.id)fail(404,'not_found','ما لقينا طلب العمل الإضافي هذا');
  // الباب المغلق: ساعة عُوِّضت بإجازة لا تُدفع أجرًا أيضًا (نظام العمل م107/1: الإجازة «بدلًا عن الأجر»). ما يبقى منها بلا استعمال له طريقه وحده.
  // والباب الذي فتحته م77(6) (ص 27): «على أن يدفع الأجر الإضافي نقدًا إذا انتهت خدمة العامل لأي سبب قبل استعماله للإجازة التعويضية». ساعات لم تُقيَّد
  // رصيدًا بعد (اعتُمدت قبل الدفتر أو قبل اعتماد السياسة) وانتهت خدمة صاحبها كانت تُرفض هنا بلا شرط فتضيع؛ صارت تُحال نقدًا من هذا الباب نفسه،
  // بالمقترح من معادلة العمل الإضافي، ويعتمدها معتمد الرواتب كأي حركة. ما قُيِّد رصيدًا يمشي في طابور «أرصدة تعويضية مستحقة الصرف» بسببه service_ended.
  let endOfService=null;
  if(o.compensation==='time_off'){
    if(db.prepare('SELECT 1 FROM compensatory_credits WHERE overtime_request_id=?').get(o.id))refuse(409,'time_off_chosen',{what:`لا تُحوَّل ساعات ${o.work_date} إلى المسير أجرًا إضافيًا: اختار صاحبها الإجازة التعويضية بدل الأجر ووافق عليها بهويته، وقُيِّدت له رصيدًا`,
      next:'الساعة لا تُعوَّض مرتين. إن انقضت مهلة الرصيد أو انتهت خدمة صاحبه قبل استعماله (م77(6)) ظهر الباقي في «أرصدة تعويضية مستحقة الصرف» ويُحال من هناك'});
    endOfService=serviceEndedOn(db,u.tenant_id,o.user_id);
    if(!endOfService){
      // طلب اعتُمد اختياره قبل دفتر الأرصدة أو قبل اعتماد السياسة: لا قيد له بعد، فلا يُقال «قُيِّد». يُسمّى ما ينقص ومن يملكه.
      // وبلا عقد مسجل أصلًا لا يُقال «خدمته قائمة» (مراجعة 22 سبتمبر): انتهاء الخدمة يُقرأ من سجل العقود، فيُسمّى العقد الناقص ومالكه.
      const ready=!!compensationOffer(db,u,riyadhDate()).available,contracted=!!db.prepare('SELECT 1 FROM employment_contracts WHERE tenant_id=? AND user_id=?').get(u.tenant_id,o.user_id);
      refuse(409,'time_off_chosen',{what:`لا تُحوَّل ساعات ${o.work_date} إلى المسير أجرًا إضافيًا: اختار صاحبها وقت الراحة بدل الأجر، ولم تُقيَّد له رصيدًا بعد، ${contracted?'وخدمته قائمة':'ولا عقد له مسجل في المنصة فلا يُعرف أانتهت خدمته (م77(6)) أم قائمة'}`,
        missing:[...(contracted?[]:[{document:'عقد عمل للموظف في سجل العقود (ساري، أو منتهٍ بتاريخ انتهائه)',why:'الدفع نقدًا لا يكون إلا عند انتهاء الخدمة (م77(6))، وانتهاؤها يُقرأ من سجل العقود لا يُفترض',owner:'موظف الموارد البشرية المخول (يُعد) ومدير الموارد البشرية (يعتمد)',owner_role:'hr.contracts.manage'}]),
          ...(ready?[]:[{doc_key:'leave_types',document:'سياسة أنواع إجازات معتمدة فيها الإجازة التعويضية ونسبتها ومهلتها، وسياسة ساعات عمل معتمدة',why:'الرصيد يُقيَّد بالنسبة والمهلة المعتمدتين لا بما في الشيفرة',owner:'مدير الموارد البشرية (يعتمد) وموظف الموارد البشرية المخول (يُعد)',owner_role:'hr.policy.accept'}]),
          {document:'قيد الرصيد التعويضي عن هذا الطلب',why:'ساعات معتمدة اختير لها وقت الراحة لا تبقى بلا أثر: تُقيَّد رصيدًا، ثم تؤخذ إجازةً أو يُحال باقيها أجرًا؛ ولا تُدفع نقدًا إلا إذا انتهت الخدمة قبل استعمالها (م77(6))',owner:'حامل تصريح اعتماد الحضور، غير صاحب الساعات',owner_role:'hr.attendance.approve'}],
        next:`${contracted?'':'يُسجَّل عقد الموظف في «العقود والسياسات» أولًا (وإن كانت خدمته منتهية سُجِّل منتهيًا بتاريخه فتُدفع الساعات نقدًا من هذا الباب)، ثم '}${ready?'':'يعتمد مدير الموارد البشرية السياسة أولًا، ثم '}يقيّدها حامل hr.attendance.approve من «الحضور والانصراف» ← «ساعات اختير لها وقت راحة ولم تُقيَّد رصيدًا». الساعة لا تُعوَّض مرتين`,link:'#attendance'});
    }
  }
  if(o.adjustment_id&&db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(o.adjustment_id).status!=='rejected')fail(409,'already_linked','هذا الطلب عليه حركة مسير قائمة');
  const policy=overtimePolicy(db,u.tenant_id,o.work_date),suggested=suggestedMinor(db,o.user_id,o.work_date,o.minutes,policy);
  const amount=input.amount===undefined||input.amount===''?sar(suggested):input.amount;
  if(amount===null)fail(400,'amount_required','ما فيه مبلغ مقترح: لا سياسة عمل إضافي مقبولة ولا عقد ساري — أدخل المبلغ وأساسه');
  const override=suggested!==null&&toMinor(amount)!==suggested;
  let basis;
  if(input.basis!==undefined&&input.basis!=='')basis=v.text(input.basis,'أساس الاحتساب',600,10);
  else if(suggested!==null&&!override)basis=`المقترح من السياسة: الساعات × (أجر الساعة الفعلي + ${policy.basic_share_bp/100}% من أجر الساعة الأساسي) (م76(2)، م77(4))، الشهر ${policy.hour_divisor_days} يومًا (م50(1)) واليوم ${policy.hour_divisor_hours} ساعات (م73(2))`;
  else fail(400,'basis_required','المبلغ يخالف مقترح السياسة، ولا له مقترح أصلًا — اكتب أساس الاحتساب');
  // سقف م77(5) السنوي (ستة أشهر من الأساسي) يوقف الباب العادي للأجر. وعند انتهاء الخدمة (م77(6)) لا يوقفه: الساعات عُملت واعتُمدت واختير لها
  // الإجازة، ولم يبقَ لصاحبها باب آخر (لا رصيد يُقيَّد ولا حركة يدوية)، فالتجاوز يُكتب في سبب الحركة ليقرر معتمد الرواتب وهو يراه — كما يفعل
  // طريق الدفتر (compensatoryToPayroll) بالضبط. مراجعة 22 سبتمبر: كان الباب يرفض فتبقى ساعات المغادر «لم يُسوَّ» بلا طريق.
  const wage=policy?wageBasis(db,o.user_id,o.work_date):null,minor=toMinor(amount);
  let overCap='';
  if(wage&&minor!==null){
    const used=annualPaidMinor(db,o.user_id,o.work_date.slice(0,4)),cap=annualCapMinor(wage.basic_minor,policy);
    if(used+minor>cap){
      if(!endOfService)fail(409,'annual_cap',`يتجاوز السقف السنوي لأجر العمل الإضافي (${policy.annual_cap_basic_months} أشهر من الأساسي، م77(5)). المتبقي ${sar(Math.max(0,cap-used))} ريال`);
      overCap=` — تنبيه لمعتمد الرواتب: بهذه الحركة يتجاوز أجر العمل الإضافي المحوَّل في ${o.work_date.slice(0,4)} سقف لائحة الشركة (${policy.annual_cap_basic_months} أشهر من الأساسي، م77(5)) بمقدار ${sar(used+minor-cap)} ريال؛ السقف قرار لائحة لا يسقط أجر ساعات عُملت واعتُمدت، والدفع نقدًا عند انتهاء الخدمة نص م77(6).`;
    }
  }
  const flag=o.retroactive?'بأثر رجعي دون تكليف مسبق — ':'';
  const cash=endOfService?` اختار صاحبها الإجازة التعويضية بدل الأجر ولم تُقيَّد رصيدًا، وانتهت خدمته في ${endOfService} قبل استعمالها: يُدفع الأجر الإضافي نقدًا (${ART77_6}).`:'';
  const adjustment=proposeAdjustment(db,u,{user_id:o.user_id,kind:'overtime',month:input.month??o.work_date.slice(0,7),amount,reason:`${flag}عمل إضافي معتمد ${o.minutes} دقيقة يوم ${o.work_date}.${cash} أساس الاحتساب: ${basis}${override?` (المقترح من السياسة ${sar(suggested)})`:''}${overCap}`},{linked:true});
  db.prepare('UPDATE overtime_requests SET adjustment_id=?,suggested_minor=? WHERE id=?').run(adjustment.id,suggested,o.id);
  audit(db,u,'attendance',o.user_id,'overtime.to_payroll',{}, {overtime_id:o.id,adjustment_id:adjustment.id,suggested_minor:suggested,override,retroactive:!!o.retroactive,...(endOfService?{end_of_service:endOfService,article:'م77(6)',over_company_cap:!!overCap}:{})});
  return {id:o.id,adjustment_id:adjustment.id,suggested:sar(suggested)};
}
