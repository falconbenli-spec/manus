import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { attendanceBoard, punch, requestCorrection, decideCorrection, proposeAbsence, stateAbsence, decideAbsence, dayStates, confirmedUnpaidDays } from '../app/attendance.mjs';
import { onEveryClock } from './riyadh-clock.mjs';

const code=value=>error=>error.code===value;
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
// آخر أيام عمل (الأحد–الخميس) قبل اليوم، الأحدث أولًا.
function pastWorkdays(count){const out=[];for(let d=addDays(riyadhToday(),-1);out.length<count;d=addDays(d,-1))if(weekday(d)<=4)out.push(d);return out;}

function fixture(t,{policy=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-attendance');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const capability of ['hr.policy.accept','hr.attendance.approve'])transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية (DEC16)'}));
  if(policy){
    const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل المصطنعة',body:'أيام العمل من الأحد إلى الخميس من التاسعة إلى الخامسة مع مهلة ثلاثين دقيقة.',basis:'قرار إدارة مصطنع رقم 2 لسنة 2026',effective_from:'2026-01-01',parameters:{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30}}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتمدت ساعات العمل المصطنعة'}));
  }
  const record=(who,date,inClock,outClock)=>db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,?,'self',?,?)").run(`${who}-${date}`,'36t',who,date,inClock?new Date(`${date}T${inClock}:00+03:00`).toISOString():null,outClock?new Date(`${date}T${outClock}:00+03:00`).toISOString():null,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  return {db,users,record};
}

test('HR-03: check-in uses server time once per day, and a missing or incomplete day only asks for clarification',t=>{
  const {db,users,record}=fixture(t);
  let board=transaction(db,()=>punch(db,users.employee,{kind:'in'}));
  assert.ok(board.me.today.check_in);assert.equal(board.me.can_check_in,false);assert.equal(board.me.can_check_out,true);
  assert.throws(()=>transaction(db,()=>punch(db,users.employee,{kind:'in'})),code('already_checked_in'));
  assert.throws(()=>transaction(db,()=>punch(db,users.employee,{kind:'in',at:'08:00'})),code('invalid_fields'),'the browser cannot supply a time');
  assert.throws(()=>transaction(db,()=>punch(db,users.outsider,{kind:'out'})),code('check_in_required'));
  db.prepare("UPDATE attendance_records SET check_in_at=? WHERE user_id='employee'").run(new Date(Date.now()-3600000).toISOString());
  board=transaction(db,()=>punch(db,users.employee,{kind:'out'}));
  assert.ok(board.me.today.check_out);
  assert.throws(()=>transaction(db,()=>punch(db,users.admin,{kind:'in'})),code('forbidden'));
  const [d1,d2,d3,d4]=pastWorkdays(4);
  record('employee',d1,'08:55','17:05');record('employee',d2,'09:45','17:00');record('employee',d3,'09:00',null);
  const states=Object.fromEntries(dayStates(db,users.employee,d4,d1).map(d=>[d.date,d.state]));
  assert.equal(states[d1],'present');assert.equal(states[d2],'late');assert.equal(states[d3],'incomplete');assert.equal(states[d4],'unexplained');
  assert.deepEqual(confirmedUnpaidDays(db,'employee',d4,d1),[],'nothing becomes a deduction by itself');
  assert.throws(()=>db.prepare("DELETE FROM attendance_records WHERE user_id='employee'").run(),/corrected, not deleted/);
});

test('a correction is decided by the line manager or HR, never by the employee, and keeps the previous times',t=>{
  const {db,users,record}=fixture(t);
  const [day]=pastWorkdays(1);record('employee',day,'09:00',null);
  const ask=(who,input={})=>transaction(db,()=>requestCorrection(db,users[who],{work_date:day,proposed_in:'09:00',proposed_out:'17:10',reason:'نسيت تسجيل الانصراف بعد اجتماع خارجي',...input})).id;
  assert.throws(()=>ask('employee',{proposed_out:'08:00'}),code('time_order'));
  assert.throws(()=>ask('employee',{work_date:'2020-01-01'}),code('work_date'));
  const id=ask('employee');
  assert.throws(()=>ask('employee'),code('pending_correction'));
  assert.throws(()=>transaction(db,()=>decideCorrection(db,users.employee,id,'approve',{note:'اعتماد ذاتي'})),code('not_found'));
  assert.throws(()=>transaction(db,()=>decideCorrection(db,users.outsider,id,'approve',{note:'زميل لا يعتمد'})),code('not_found'));
  assert.deepEqual(attendanceBoard(db,users.manager).corrections[0].actions,['approve_correction','reject_correction']);
  assert.deepEqual(attendanceBoard(db,users.employee).corrections[0].actions,[]);
  transaction(db,()=>decideCorrection(db,users.manager,id,'approve',{note:'كان معي في الاجتماع'}));
  const fixed=dayStates(db,users.employee,day,day)[0];
  assert.equal(fixed.state,'present');assert.equal(fixed.check_out,'17:10');assert.equal(fixed.source,'correction');
  const kept=db.prepare('SELECT previous_in,previous_out,status FROM attendance_corrections WHERE id=?').get(id);
  assert.ok(kept.previous_in);assert.equal(kept.previous_out,null);
  assert.throws(()=>db.prepare("UPDATE attendance_corrections SET status='rejected' WHERE id=?").run(id),/final/);
  assert.ok(verifyAudit(db));
});

// سقط الساعة 02:05 بتوقيت الرياض من 1 أكتوبر، وكان سيسقط طوال أول يوم في كل شهر: ملخص الشركة في لوحة الحضور لشهر الرياض الجاري،
// ويوم الغياب d2 في الشهر السابق حين يكون اليوم أول الشهر. فالملخص يُقرأ بشهر d2 نفسه.
const unpaidAbsence=t=>{
  const {db,users,record}=fixture(t);
  const [d1,d2]=pastWorkdays(2);record('employee',d1,'09:00','17:00');
  const propose=(date,who='hr',user='employee')=>transaction(db,()=>proposeAbsence(db,users[who],{user_id:user,work_date:date,reason:'لا سجل حضور ولا إجازة ولا توضيح من المدير'})).id;
  assert.throws(()=>propose(d1),code('not_absent'));
  assert.throws(()=>propose(d2,'manager'),code('not_permitted'));
  assert.throws(()=>propose(d2,'hr','hr'),code('separation_of_duties'));
  let weekend=addDays(riyadhToday(),-1);while(weekday(weekend)<=4)weekend=addDays(weekend,-1);
  assert.throws(()=>propose(weekend),code('not_absent'));
  const id=propose(d2);
  assert.throws(()=>propose(d2),/UNIQUE|not_absent/);
  assert.deepEqual(confirmedUnpaidDays(db,'employee',d2,d1),[],'a proposal deducts nothing');
  assert.throws(()=>transaction(db,()=>decideAbsence(db,users.hr,id,'confirm',{note:'المقترح لا يعتمد اقتراحه'})),code('not_permitted'));
  assert.throws(()=>transaction(db,()=>decideAbsence(db,users['hr-manager'],id,'confirm',{note:'اعتماد قبل سماع الموظف'})),code('statement_pending'));
  assert.deepEqual(attendanceBoard(db,users.employee).absences[0].actions,['state_absence']);
  transaction(db,()=>stateAbsence(db,users.employee,id,{statement:'كنت مريضًا ولم أتمكن من إبلاغ مديري في حينه'}));
  assert.throws(()=>transaction(db,()=>stateAbsence(db,users.employee,id,{statement:'إفادة ثانية غير مسموحة بعد الأولى'})),code('not_found'));
  transaction(db,()=>decideAbsence(db,users['hr-manager'],id,'confirm',{note:'لا مستند طبي ولا إجازة مسجلة لهذا اليوم'}));
  assert.deepEqual(confirmedUnpaidDays(db,'employee',d2,d1),[d2]);
  assert.equal(dayStates(db,users.employee,d2,d2)[0].state,'unpaid_absence');
  assert.equal(attendanceBoard(db,users.outsider).absences.length,0,'a colleague sees no one else\'s absence');
  assert.equal(attendanceBoard(db,users.manager).company,null);
  assert.ok(attendanceBoard(db,users.hr,d2.slice(0,7)).company.find(r=>r.id==='employee').summary.unpaid_absence===1);
};
test('unpaid absence needs a working-time policy, a real empty workday, the employee statement window, and two different people',unpaidAbsence);
onEveryClock(test,'unpaid absence needs a working-time policy, a real empty workday, the employee statement window, and two different people',unpaidAbsence);

test('without an accepted working-time policy no day is judged late or absent',t=>{
  const {db,users,record}=fixture(t,{policy:false});
  const [d1,d2]=pastWorkdays(2);record('employee',d1,'11:30','17:00');
  const states=dayStates(db,users.employee,d2,d1);
  assert.equal(states.find(d=>d.date===d1).state,'present');assert.equal(states.find(d=>d.date===d2).state,'off');
  assert.throws(()=>transaction(db,()=>proposeAbsence(db,users.hr,{user_id:'employee',work_date:d2,reason:'لا توجد سياسة معتمدة لهذا التاريخ'})),code('policy_required'));
  assert.equal(attendanceBoard(db,users.employee).policy,null);
});
