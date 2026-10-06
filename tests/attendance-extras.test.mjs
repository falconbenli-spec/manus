import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { dayStates, proposeAbsence } from '../app/attendance.mjs';
import { attendanceExtras, proposeHoliday, decideHoliday, requestMission, decideMission, assignShift, endShift, requestOvertime, decideOvertime, overtimeToPayroll } from '../app/attendance-extras.mjs';
import { decideAdjustment } from '../app/payroll-extras.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
function pastWorkdays(count){const out=[];for(let d=addDays(today(),-1);out.length<count;d=addDays(d,-1))if(weekday(d)<=4)out.push(d);return out;}
function nextDate(test,from=addDays(today(),1)){let d=from;while(!test(d))d=addDays(d,1);return d;}

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-attendance-extras');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const capability of ['hr.policy.accept','hr.attendance.approve','hr.contracts.approve','payroll.approve'])transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية (DEC16)'}));
  const policy=(kind,parameters)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتمدت السياسة المصطنعة'}));};
  policy('working_time',{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30});
  const tx=f=>transaction(db,f);
  return {db,users,tx,policy};
}

test('holidays: proposed by HR, approved by someone else, and an approved holiday explains the day so no absence can be proposed on it',t=>{
  const {db,users,tx}=fixture(t),[d1,d2]=pastWorkdays(2);
  assert.equal(dayStates(db,users.employee,d1,d1)[0].state,'unexplained');
  assert.throws(()=>tx(()=>proposeHoliday(db,users.employee,{holiday_date:d1,name:'عطلة مصطنعة',basis:'إعلان رسمي مصطنع للاختبار'})),code('not_permitted'));
  const id=tx(()=>proposeHoliday(db,users.hr,{holiday_date:d1,name:'عطلة مصطنعة',basis:'إعلان رسمي مصطنع للاختبار'})).id;
  assert.throws(()=>tx(()=>proposeHoliday(db,users.hr,{holiday_date:d1,name:'عطلة مكررة',basis:'إعلان رسمي مصطنع للاختبار'})),code('duplicate_holiday'));
  assert.equal(dayStates(db,users.employee,d1,d1)[0].state,'unexplained','a proposal changes nothing');
  assert.throws(()=>tx(()=>decideHoliday(db,users.hr,id,'approve',{note:'اعتماد ذاتي'})),code('not_permitted'));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.attendance.approve',note:'اختبار فصل المهام'}));
  assert.throws(()=>tx(()=>decideHoliday(db,users.hr,id,'approve',{note:'اعتماد ذاتي'})),code('separation_of_duties'));
  assert.deepEqual(attendanceExtras(db,users['hr-manager']).holidays[0].actions,['approve_holiday','reject_holiday']);
  tx(()=>decideHoliday(db,users['hr-manager'],id,'approve',{note:'مطابقة للإعلان'}));
  const day=dayStates(db,users.employee,d1,d1)[0];assert.equal(day.state,'holiday');assert.equal(day.note,'عطلة مصطنعة');
  assert.throws(()=>tx(()=>proposeAbsence(db,users.hr,{user_id:'employee',work_date:d1,reason:'محاولة اقتراح غياب في عطلة رسمية'})),code('not_absent'));
  assert.equal(dayStates(db,users.employee,d2,d2)[0].state,'unexplained');
  assert.throws(()=>db.prepare("UPDATE public_holidays SET name='تعديل صامت'").run(),/final/);
  assert.throws(()=>db.prepare('DELETE FROM public_holidays').run(),/retained/);
});

test('missions: the line manager decides, the employee cannot, and approved mission days need no punch',t=>{
  const {db,users,tx}=fixture(t),[d1]=pastWorkdays(1);
  const id=tx(()=>requestMission(db,users.employee,{from_date:d1,to_date:d1,destination:'موقع تصوير مصطنع',purpose:'تغطية فعالية العميل المصطنع خارج المكتب'})).id;
  assert.throws(()=>tx(()=>requestMission(db,users.employee,{from_date:d1,to_date:d1,destination:'وجهة أخرى',purpose:'مهمة متقاطعة مع السابقة نفسها'})),code('overlapping_mission'));
  assert.throws(()=>tx(()=>decideMission(db,users.employee,id,'approve',{note:'اعتماد ذاتي'})),code('not_found'));
  assert.throws(()=>tx(()=>decideMission(db,users.outsider,id,'approve',{note:'ليس مديره'})),code('not_found'));
  assert.equal(attendanceExtras(db,users.outsider).missions.length,0,'a colleague does not see the request');
  assert.deepEqual(attendanceExtras(db,users.manager).missions[0].actions,['approve_mission','reject_mission']);
  assert.equal(dayStates(db,users.employee,d1,d1)[0].state,'unexplained');
  tx(()=>decideMission(db,users.manager,id,'approve',{note:'ضمن خطة المشروع'}));
  assert.equal(dayStates(db,users.employee,d1,d1)[0].state,'mission');
  assert.throws(()=>tx(()=>decideMission(db,users.manager,id,'reject',{note:'تراجع بعد الاعتماد غير مسموح'})),code('not_found'));
  const second=tx(()=>requestMission(db,users.employee,{from_date:addDays(today(),3),to_date:addDays(today(),4),destination:'جدة',purpose:'اجتماع مصطنع مع عميل خارج المدينة'})).id;
  tx(()=>decideMission(db,users.employee,second,'cancel',{note:'أُلغي الاجتماع من العميل'}));
  assert.equal(db.prepare('SELECT status FROM work_missions WHERE id=?').get(second).status,'cancelled');
});

test('shifts: a dated shift replaces the standard hours and workdays for one employee only, and is ended early rather than rewritten',t=>{
  const {db,users,tx}=fixture(t),friday=nextDate(d=>weekday(d)===5),sunday=nextDate(d=>weekday(d)===0,friday);
  const input={user_id:'employee',from_date:today(),to_date:addDays(sunday,14),start_time:'14:00',end_time:'22:00',workdays:[5,6,0],reason:'تغطية فعالية نهاية الأسبوع المصطنعة'};
  assert.throws(()=>tx(()=>assignShift(db,users.manager,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>assignShift(db,users.hr,{...input,user_id:'hr'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>assignShift(db,users.hr,{...input,workdays:[7]})),code('workdays'));
  const id=tx(()=>assignShift(db,users.hr,input)).id;
  assert.throws(()=>tx(()=>assignShift(db,users.hr,input)),code('overlapping_shift'));
  // الجمعة يوم عمل لهذا الموظف وحده، وحضور 13:50 ليس تأخرًا رغم أن الدوام العام 09:00.
  const record=(who,date,inClock,outClock)=>db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,?,'self',?,?)").run(`${who}-${date}`,'36t',who,date,new Date(`${date}T${inClock}:00+03:00`).toISOString(),new Date(`${date}T${outClock}:00+03:00`).toISOString(),'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  record('employee',friday,'13:50','22:05');
  const asOf=addDays(sunday,1);
  assert.equal(dayStates(db,users.employee,friday,friday,asOf)[0].state,'present');assert.equal(dayStates(db,users.employee,friday,friday,asOf)[0].shift,'14:00–22:00');
  assert.equal(dayStates(db,users.employee,sunday,sunday,asOf)[0].state,'unexplained','Sunday is a working day of the shift');
  assert.equal(dayStates(db,users.outsider,friday,friday,asOf)[0].state,'off','others keep the standard week');
  const monday=addDays(sunday,1);assert.equal(dayStates(db,users.employee,monday,monday,addDays(monday,1))[0].state,'off');
  tx(()=>endShift(db,users.hr,id,{end_date:friday,reason:'انتهت الفعالية مبكرًا بقرار العميل'}));
  assert.equal(dayStates(db,users.employee,sunday,sunday,asOf)[0].shift,null);
  assert.throws(()=>db.prepare("UPDATE shift_assignments SET start_time='08:00'").run(),/not rewritten/);
});

test('overtime: hours are approved by the manager; their value enters payroll only as a proposed adjustment that someone else approves',t=>{
  const {db,users,tx,policy}=fixture(t),[d1]=pastWorkdays(1);
  policy('pay_components',{components:['basic','housing','transport']});
  const {id:contractId}=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2026-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'8000.00'}],document_reference:'عقد مصطنع'}));
  const step=(who,action)=>tx(()=>contractAction(db,users[who],contractId,action,{version:getContract(db,users[who],contractId).version}));step('hr','submit_contract');step('hr-manager','approve_contract');
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:50,reason:'إنهاء تسليمات الحملة المصطنعة'})),code('minutes'));
  const id=tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:120,reason:'إنهاء تسليمات الحملة المصطنعة قبل الإطلاق'})).id;
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:60,reason:'طلب ثانٍ لليوم نفسه'})),code('duplicate_overtime'));
  assert.throws(()=>tx(()=>decideOvertime(db,users.employee,id,'approve',{note:'اعتماد ذاتي'})),code('not_found'));
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,id,{month:today().slice(0,7),amount:'150.00',basis:'ساعتان بمعدل السياسة المصطنعة'})),code('not_found'),'pending hours carry no value');
  tx(()=>decideOvertime(db,users.manager,id,'approve',{note:'طلبتُ منه البقاء'}));
  assert.equal(attendanceExtras(db,users.employee).overtime_minutes_approved_this_month>=0,true);
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.manager,id,{month:today().slice(0,7),amount:'150.00',basis:'ساعتان بمعدل السياسة المصطنعة'})),code('not_permitted'));
  const month=today().slice(0,7),linked=tx(()=>overtimeToPayroll(db,users.hr,id,{month,amount:'150.00',basis:'ساعتان بمعدل السياسة المصطنعة'}));
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,id,{month,amount:'150.00',basis:'ساعتان بمعدل السياسة المصطنعة'})),code('already_linked'));
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(linked.adjustment_id);
  assert.equal(adjustment.kind,'overtime');assert.equal(adjustment.status,'proposed');assert.equal(adjustment.amount_minor,15000);assert.match(adjustment.reason,/120 دقيقة/);
  tx(()=>decideAdjustment(db,users['hr-manager'],adjustment.id,'reject',{note:'المعدل لا يطابق السياسة المصطنعة'}));
  assert.deepEqual(attendanceExtras(db,users.hr).overtime[0].actions,['overtime_to_payroll'],'a rejected value can be proposed again');
  tx(()=>overtimeToPayroll(db,users.hr,id,{month,amount:'120.00',basis:'ساعتان بالمعدل المصحح من السياسة المصطنعة'}));
  assert.ok(verifyAudit(db));
});
