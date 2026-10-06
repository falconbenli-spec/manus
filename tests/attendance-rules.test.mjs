import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { dayStates, punch, proposeAbsence, attendanceBoard } from '../app/attendance.mjs';
import { requestMission, decideMission, requestOvertime, decideOvertime, overtimeToPayroll, attendanceExtras } from '../app/attendance-extras.mjs';
import { assignOvertime, decideAssignment } from '../app/overtime-rules.mjs';
import { requestPermission, decidePermission, giveNotice, decideNotice, proposeExemption, decideExemption, rulesBoard, shortfallReport, monthlyWorkbook } from '../app/attendance-rules.mjs';
import { proposeSite, decideSite, explainLocation, reviewLocation, purgeExpiredCoordinates } from '../app/attendance-location.mjs';
import { haversine, classifyLocation, overtimeAmountMinor, RULE_DRAFT, effectiveHours, catalogAttendanceRoute } from '../app/attendance-policy.mjs';
import { runDue } from '../app/jobs.mjs';
import { runReport } from '../app/reports.mjs';
import * as wf from '../app/workflow.mjs';
import { sampleLocation, describeFix } from '../app/static/attendance-ui.mjs';
import { createApp } from '../app/server.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { onEveryClock } from './riyadh-clock.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
function pastWorkdays(count){const out=[];for(let d=addDays(today(),-1);out.length<count;d=addDays(d,-1))if(weekday(d)<=4)out.push(d);return out;}
function nextDate(check,from=addDays(today(),1)){let d=from;while(!check(d))d=addDays(d,1);return d;}
const BASE={workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30};
const SITE={lat:24.7136,lng:46.6753};
const NOTICE='نستخدم موقعك عند تسجيل الحضور والانصراف فقط قرينةً على مكان العمل، ولا نمنع التسجيل بسببه، وتُمسح الإحداثيات الخام بعد المدة المعلنة.';

function fixture(t,parameters={}){
  const db=openDb(':memory:');seed(db,'synthetic-attendance-rules');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  for(const capability of ['hr.policy.accept','hr.attendance.approve','hr.contracts.approve','payroll.approve'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية (DEC16)'}));
  const policy=(kind,params,effective='2020-01-01')=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'لائحة مصطنعة للاختبار',effective_from:effective,parameters:params}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة المصطنعة'}));return id;};
  policy('working_time',{...BASE,...parameters});
  const record=(who,date,inClock,outClock)=>db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,?,'self',?,?)").run(`${who}-${date}`,'36t',who,date,inClock?new Date(`${date}T${inClock}:00+03:00`).toISOString():null,outClock?new Date(`${date}T${outClock}:00+03:00`).toISOString():null,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  const contract=()=>{
    policy('pay_components',{components:['basic','housing','transport']});
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2026-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد مصطنع'}));
    const step=(who,action)=>tx(()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));step('hr','submit_contract');step('hr-manager','approve_contract');
  };
  return {db,users,tx,policy,record,contract};
}
const state=(db,u,date)=>dayStates(db,u,date,date)[0];

test('formula, haversine and zone classification are pure and match the regulation example',()=>{
  // م76(2): 2 × (8,000/240 + 0.5 × 6,000/240) = 91.67 ريال.
  assert.equal(overtimeAmountMinor(120,{actual_minor:800000,basic_minor:600000},RULE_DRAFT.overtime),9167);
  assert.equal(Math.round(haversine(24.7136,46.6753,24.7146,46.6753)),111,'0.001° of latitude ≈ 111 m');
  assert.ok(Math.abs(haversine(24.7136,46.6753,21.4858,39.1925)-848000)<5000,'Riyadh to Jeddah ≈ 848 km');
  const sites=[{id:'s1',lat:SITE.lat,lng:SITE.lng,radius_m:150}];
  assert.deepEqual(classifyLocation(sites,{lat:24.7140,lng:46.6753,accuracy:12},100),{zone:'in_zone',site_id:'s1',distance_m:40,accuracy_m:12});
  assert.equal(classifyLocation(sites,{lat:24.7186,lng:46.6753,accuracy:12},100).zone,'out_of_zone');
  assert.equal(classifyLocation(sites,{lat:24.7140,lng:46.6753,accuracy:300},100).zone_note,'low_accuracy','poor accuracy is unverified, not out of zone');
  assert.equal(classifyLocation(sites,null,100).zone,'no_location');
  const ramadan={...BASE,ramadan:{from:'2027-02-08',to:'2027-03-09',start:'10:00',end:'16:00'}};
  assert.equal(effectiveHours(ramadan,null,'2027-02-10').start,'10:00');assert.equal(effectiveHours(ramadan,null,'2027-03-10').start,'09:00');
  assert.equal(effectiveHours(ramadan,{start:'14:00',end:'22:00',workdays:[5]},'2027-02-10').start,'14:00','an assigned shift wins over Ramadan hours');
  assert.equal(describeFix([{name:'المقر',...SITE,radius_m:150}],{lat:24.7140,lng:46.6753,accuracy:12}).includes('داخل النطاق'),true);
});

test('GPS sampling takes the first fix within 20 m, else the best after the settle time, and reports denial',async()=>{
  const fake=(fixes,error)=>({watchPosition(ok,bad){fixes.forEach((f,i)=>setTimeout(()=>ok({coords:{latitude:f[0],longitude:f[1],accuracy:f[2]}}),i*5));if(error)setTimeout(()=>bad({code:error}),1);return 7;},clearWatch(){}});
  assert.deepEqual(await sampleLocation(fake([[1,1,80],[2,2,15],[3,3,5]]),{settleMs:200,giveUpMs:300}),{lat:2,lng:2,accuracy:15});
  assert.deepEqual(await sampleLocation(fake([[1,1,80],[2,2,40]]),{settleMs:40,giveUpMs:80}),{lat:2,lng:2,accuracy:40});
  assert.deepEqual(await sampleLocation(fake([],1),{settleMs:40,giveUpMs:80}),{error:'denied'});
  assert.deepEqual(await sampleLocation(undefined),{error:'unsupported'});
});

test('regulation values are a draft policy: nothing applies before the HR manager accepts it, and every value cites its article',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:today(),to_date:today(),minutes_per_day:60,reason:'تسليم حملة مصطنعة قبل الموعد'})),code('policy_required'));
  assert.throws(()=>tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'رمضان',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'لائحة مصطنعة للاختبار',effective_from:'2020-01-01',parameters:{...BASE,ramadan:{from:'2027-02-08',to:'2027-03-09',start:'09:00',end:'16:00'}}})),code('ramadan'),'more than six Ramadan hours a day is refused');
  const {id}=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'قواعد اللائحة',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'لائحة مصطنعة للاختبار',effective_from:'2020-01-01',parameters:{...BASE,overtime:RULE_DRAFT.overtime,permission_monthly_cap_minutes:120}}));
  assert.equal(rulesBoard(db,users.hr).policy.overtime,null,'a draft does not apply');
  assert.ok(rulesBoard(db,users.hr).unset.some(u=>u.includes('م76')));
  tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت قواعد اللائحة المصطنعة'}));
  const board=rulesBoard(db,users.hr);
  assert.equal(board.policy.overtime.daily_cap_minutes,180);assert.match(board.policy.citations.overtime,/م77/);assert.match(board.policy.citations.permission,/م74/);
  assert.equal(board.me.permission_cap_minutes,120);
});

test('overtime: prior assignment by the manager, pre-approval by the authority holder, written HR budget, caps, suggested pay and time off in lieu',t=>{
  const {db,users,tx,contract}=fixture(t,{overtime:RULE_DRAFT.overtime});contract();
  const assign=(who,input)=>tx(()=>assignOvertime(db,users[who],{user_id:'employee',from_date:today(),to_date:today(),minutes_per_day:120,reason:'تسليم حملة مصطنعة قبل الموعد',...input})).id;
  assert.throws(()=>assign('hr'),code('not_permitted'),'only the direct manager writes the assignment');
  assert.throws(()=>assign('manager',{from_date:addDays(today(),-1),to_date:addDays(today(),-1)}),code('prior_assignment'));
  const workday=nextDate(d=>weekday(d)<=4),friday=nextDate(d=>weekday(d)===5);
  assert.throws(()=>assign('manager',{from_date:workday,to_date:workday,minutes_per_day:240}),code('daily_cap'),'a 4th hour on a working day');
  assert.throws(()=>assign('manager',{from_date:friday,to_date:friday,minutes_per_day:540}),code('holiday_cap'),'more than 8 hours on a rest day');
  const sunday=nextDate(d=>weekday(d)===0);
  assert.throws(()=>assign('manager',{from_date:sunday,to_date:addDays(sunday,6),minutes_per_day:180}),code('weekly_cap'),'7 × 3 h = 21 h in a week');
  const id=assign('manager');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND subject_kind=?').get('employee','overtime_assignment').n,1);
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{assignment_id:id,work_date:today(),minutes:120,reason:'العمل المنجز في الحملة'})),code('not_found'),'no hours before the budget is approved');
  assert.throws(()=>tx(()=>decideAssignment(db,users.manager,id,'authorise',{note:'موافق'})),code('action_unavailable'),'the author does not pre-approve');
  tx(()=>decideAssignment(db,users['hr-manager'],id,'authorise',{note:'موافقة صاحب الصلاحية'}));
  assert.throws(()=>tx(()=>decideAssignment(db,users['hr-manager'],id,'budget',{note:'اعتماد الميزانية كتابةً'})),code('action_unavailable'),'the budget needs a fourth person');
  const approved=tx(()=>decideAssignment(db,users.hr,id,'budget',{note:'اعتمدت ميزانية العمل الإضافي كتابةً'}));
  assert.equal(approved.status,'budget_approved');assert.equal(approved.budget,'91.67');
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{assignment_id:id,work_date:today(),minutes:135,reason:'العمل المنجز في الحملة'})),code('over_assignment'));
  const ot=tx(()=>requestOvertime(db,users.employee,{assignment_id:id,work_date:today(),minutes:120,reason:'العمل المنجز في الحملة'}));
  assert.equal(ot.retroactive,false);
  tx(()=>decideOvertime(db,users.manager,ot.id,'approve',{note:'أُنجز العمل'}));
  const row=attendanceExtras(db,users.hr).overtime.find(o=>o.id===ot.id);
  assert.equal(row.suggested,'91.67');assert.deepEqual(row.actions,['overtime_to_payroll']);
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,ot.id,{month:today().slice(0,7),amount:'120.00'})),code('basis_required'),'an override needs a written basis');
  const linked=tx(()=>overtimeToPayroll(db,users.hr,ot.id,{month:today().slice(0,7)}));
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(linked.adjustment_id);
  assert.equal(adjustment.amount_minor,9167);assert.equal(adjustment.status,'proposed','only a proposal to payroll');assert.doesNotMatch(adjustment.reason,/بأثر رجعي/);
  // الطريق اللاحق يبقى «بأثر رجعي» بتبرير، وتسري عليه السقوف والسقف السنوي.
  const [d1,d2]=pastWorkdays(2);
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:240,reason:'تبرير كافٍ للعمل دون تكليف مسبق'})),code('daily_cap'));
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:60,reason:'قصير'})),code('invalid_text'),'retroactive needs a justification');
  const retro=tx(()=>requestOvertime(db,users.employee,{work_date:d1,minutes:60,reason:'طلب العميل تعديلًا عاجلًا بعد نهاية الدوام'}));
  assert.equal(retro.retroactive,true);
  tx(()=>decideOvertime(db,users.manager,retro.id,'approve',{note:'أكدت الحاجة'}));
  assert.equal(attendanceExtras(db,users.manager).overtime.find(o=>o.id===retro.id).retroactive_name.includes('بأثر رجعي'),true);
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,retro.id,{month:today().slice(0,7),amount:'40000.00',basis:'مبلغ يتجاوز السقف السنوي عمدًا'})),code('annual_cap'),'6 × basic 6,000 = 36,000 a year');
  const paid=tx(()=>overtimeToPayroll(db,users.hr,retro.id,{month:today().slice(0,7)}));
  assert.match(db.prepare('SELECT reason FROM payroll_adjustments WHERE id=?').get(paid.adjustment_id).reason,/بأثر رجعي دون تكليف مسبق/);
  // الإجازة بدل الأجر باختيار الموظف (نظام العمل م107/1): لا تُقبل قبل أن تُعتمد سياسة أنواع إجازات فيها الإجازة التعويضية ونسبتها ومهلتها
  // (ترحيل 125). المسار الكامل — الموافقة والقيد والاستهلاك والباب المغلق إلى المسير — في tests/leave-compensatory.test.mjs.
  assert.throws(()=>tx(()=>requestOvertime(db,users.employee,{work_date:d2,minutes:60,compensation:'time_off',consent:true,reason:'طلب العميل تعديلًا عاجلًا بعد نهاية الدوام'})),code('compensatory_policy_required'));
  assert.equal(attendanceExtras(db,users.employee).compensation_offer.available,false);
  assert.equal(attendanceExtras(db,users.employee).time_off_minutes,0);
  assert.ok(wf.notifications(db,users.employee).some(n=>n.subject_kind==='overtime_request'&&n.link==='#attendance'));
  assert.ok(verifyAudit(db));
});

test('no overtime on a work-mission day, and no mission over overtime (Art. 77(9))',t=>{
  const {db,users,tx}=fixture(t,{overtime:RULE_DRAFT.overtime});
  // عُدِّلت أيام هذا الاختبار مرة واحدة في 22 سبتمبر 2026 (fix/signed-regulation-2): كانت تُختار بلا نظر إلى نوع اليوم فيقع «to» أو «other» في الجمعة أو السبت،
  // والنسخة الموقعة (م77(9)، ص 27) تحصر المنع في «أيام العمل المعتادة»، فصار المنع لا يسري على يوم راحة. الأيام هنا أيام عمل (الأحد–الخميس) فيبقى ما سُجل كما هو.
  const from=nextDate(d=>weekday(d)<=3,addDays(today(),2)),to=addDays(from,1);
  const mission=tx(()=>requestMission(db,users.employee,{from_date:from,to_date:to,destination:'جدة',purpose:'اجتماع مصطنع مع عميل خارج المدينة'})).id;
  assert.throws(()=>tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:to,to_date:to,minutes_per_day:60,reason:'تسليم حملة مصطنعة قبل الموعد'})),code('mission_overlap'),'a pending mission already blocks');
  tx(()=>decideMission(db,users.manager,mission,'approve',{note:'مهمة لازمة'}));
  assert.ok(wf.notifications(db,users.employee).some(n=>n.subject_kind==='work_mission'));
  const [d1]=pastWorkdays(1);
  const past=tx(()=>requestMission(db,users.outsider,{from_date:d1,to_date:d1,destination:'الدمام',purpose:'زيارة مصطنعة لموقع تصوير'})).id;
  tx(()=>decideMission(db,users.manager,past,'approve',{note:'مهمة لازمة'}));
  assert.throws(()=>tx(()=>requestOvertime(db,users.outsider,{work_date:d1,minutes:60,reason:'تبرير كافٍ للعمل دون تكليف مسبق'})),code('mission_overlap'));
  const other=nextDate(d=>d>addDays(today(),5)&&weekday(d)<=4);
  tx(()=>assignOvertime(db,users.manager,{user_id:'outsider',from_date:other,to_date:other,minutes_per_day:60,reason:'تسليم حملة مصطنعة قبل الموعد'}));
  assert.throws(()=>tx(()=>requestMission(db,users.outsider,{from_date:other,to_date:other,destination:'جدة',purpose:'اجتماع مصطنع مع عميل خارج المدينة'})),code('overtime_overlap'));
});

test('an approved permission removes the late or early flag for its period only; early leave without one is flagged; the monthly cap is enforced',t=>{
  const {db,users,tx,record,policy}=fixture(t);
  const [d1,d2,d3]=pastWorkdays(3);
  record('employee',d1,'10:20','17:00');record('employee',d2,'09:00','15:00');record('employee',d3,'09:10','16:50');
  assert.equal(state(db,users.employee,d1).state,'late');assert.equal(state(db,users.employee,d1).late_minutes,80);
  assert.equal(state(db,users.employee,d2).state,'early_leave','leaving two hours early without approval is flagged');
  assert.equal(state(db,users.employee,d3).state,'early_leave');
  const late=tx(()=>requestPermission(db,users.employee,{work_date:d1,kind:'late_arrival',from_time:'09:00',to_time:'10:30',reason:'موعد طبي مصطنع'})).id;
  assert.equal(state(db,users.employee,d1).state,'late','a pending permission changes nothing');
  assert.throws(()=>tx(()=>decidePermission(db,users.employee,late,'approve',{})),code('not_found'),'no self-approval');
  assert.throws(()=>tx(()=>decidePermission(db,users.outsider,late,'approve',{})),code('not_found'),'a colleague cannot decide');
  assert.ok(rulesBoard(db,users.manager).permissions.find(p=>p.id===late).actions.includes('approve_permission'));
  tx(()=>decidePermission(db,users.manager,late,'approve',{}));
  const excused=state(db,users.employee,d1);
  assert.equal(excused.state,'present_permission');assert.equal(excused.excused_by,late,'the day shows the permission id');
  const early=tx(()=>requestPermission(db,users.employee,{work_date:d2,kind:'early_leave',from_time:'15:00',to_time:'17:00',reason:'ظرف عائلي مصطنع'})).id;
  tx(()=>decidePermission(db,users['hr-manager'],early,'approve',{note:'موافق'}));
  assert.equal(state(db,users.employee,d2).state,'present_permission');
  const n=wf.notifications(db,users.employee).find(x=>x.subject_kind==='attendance_permission');
  assert.equal(n.link,'#attendance');assert.match(n.title,/اعتُمد استئذانك/);
  // سقف شهري يحدده مدير الموارد البشرية؛ غير محدد لا يُفرض.
  assert.equal(rulesBoard(db,users.employee).me.permission_cap_minutes,null);
  policy('working_time',{...BASE,permission_monthly_cap_minutes:120});
  tx(()=>requestPermission(db,users.outsider,{work_date:today(),kind:'during_day',from_time:'09:00',to_time:'10:30',reason:'مراجعة جهة حكومية'}));
  let error;try{tx(()=>requestPermission(db,users.outsider,{work_date:today(),kind:'during_day',from_time:'11:00',to_time:'12:00',reason:'مراجعة جهة حكومية'}));}catch(e){error=e;}
  assert.equal(error?.code,'permission_cap');assert.equal(error.details.remaining_minutes,30);assert.match(error.message,/المتبقي لك .*: 30 دقيقة/);
  assert.equal(rulesBoard(db,users.outsider).me.permission_remaining_minutes,30);
  assert.ok(verifyAudit(db));
});

test('same-day late or absence notice (Art. 75): the manager may accept it as the excuse',t=>{
  const {db,users,tx,record}=fixture(t);
  const id=tx(()=>giveNotice(db,users.employee,{kind:'absent',reason:'عارض صحي مفاجئ'})).id;
  assert.throws(()=>tx(()=>giveNotice(db,users.employee,{kind:'absent',reason:'عارض صحي مفاجئ'})),code('duplicate_notice'));
  assert.ok(wf.notifications(db,users.manager).some(n=>n.subject_kind==='attendance_notice'),'the manager hears it the same day');
  assert.throws(()=>tx(()=>decideNotice(db,users.outsider,id,'accept',{note:'مقبول'})),code('not_found'));
  tx(()=>decideNotice(db,users.manager,id,'accept',{note:'أبلغني صباحًا'}));
  assert.ok(wf.notifications(db,users.employee).some(n=>n.subject_kind==='attendance_notice'&&/قُبل/.test(n.title)));
  // يوم ماضٍ بإشعار مقبول: التأخر حتى الوقت المذكور لا يُعلَّم، والغياب يصبح «بإشعار» لا «بلا سجل».
  const [d1,d2]=pastWorkdays(2);record('employee',d1,'10:40','17:00');
  db.prepare("INSERT INTO attendance_notices(id,tenant_id,user_id,work_date,kind,expected_time,reason,status,decided_by,decided_at,created_at) VALUES('n1','36t','employee',?,'late','11:00','زحام مصطنع','accepted','manager','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),('n2','36t','employee',?,'absent',NULL,'عارض مصطنع','accepted','manager','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run(d1,d2);
  assert.equal(state(db,users.employee,d1).state,'present_permission');
  assert.equal(state(db,users.employee,d2).state,'excused');
  assert.throws(()=>tx(()=>proposeAbsence(db,users.hr,{user_id:'employee',work_date:d2,reason:'لا سجل حضور ولا إجازة مسجلة'})),code('not_absent'));
});

test('Ramadan hours from the accepted policy: lateness and early leave are measured against 6 hours inside the dated range only',t=>{
  const [d1,d2,d3]=pastWorkdays(3);
  const {db,users,record}=fixture(t,{ramadan:{from:d2,to:d1,start:'10:00',end:'16:00'}});
  record('employee',d1,'10:20','16:00');record('employee',d2,'10:05','15:00');record('employee',d3,'10:20','17:00');
  const inside=state(db,users.employee,d1);
  assert.equal(inside.state,'present','10:20 is within the grace of a 10:00 Ramadan start');assert.equal(inside.ramadan,true);assert.equal(inside.expected_minutes,360);assert.equal(inside.hours,'10:00–16:00');
  assert.equal(state(db,users.employee,d2).state,'early_leave','leaving at 15:00 in Ramadan is an hour early');
  const outside=state(db,users.employee,d3);
  assert.equal(outside.state,'late','the same arrival outside Ramadan is late');assert.equal(outside.expected_minutes,480);
});

test('location is evidence, never a gate: server-side haversine, zone flags, privacy notice first, explanation and review',t=>{
  const {db,users,tx,record}=fixture(t,{location:{retention_days:30,privacy_notice:NOTICE,max_accuracy_m:100}});
  // دون موقع معتمد: السلوك كما كان ولا تُحفظ إحداثيات.
  let board=tx(()=>punch(db,users.outsider,{kind:'in',location:{lat:SITE.lat,lng:SITE.lng,accuracy:10},location_notice_ack:true}));
  assert.equal(board.punch_location,null);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_punch_locations').get().n,0);
  const site=tx(()=>proposeSite(db,users.hr,{name:'المقر المصطنع',lat:SITE.lat,lng:SITE.lng,radius_m:150})).id;
  assert.throws(()=>tx(()=>proposeSite(db,users.employee,{name:'موقعي',lat:1,lng:1,radius_m:150})),code('not_permitted'));
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.attendance.approve',note:'اختبار فصل المهام'}));
  assert.throws(()=>tx(()=>decideSite(db,users.hr,site,'approve',{note:'اعتماد ذاتي'})),code('separation_of_duties'),'one proposes, another approves');
  tx(()=>decideSite(db,users['hr-manager'],site,'approve',{note:'مطابق لعنوان المقر'}));
  assert.ok(wf.notifications(db,users.hr).some(n=>n.subject_kind==='attendance_site'));
  // الموظفة: قبل الإقرار بالإشعار لا تُحفظ إحداثيات، والبصمة تُسجَّل.
  const b1=rulesBoard(db,users.employee).location;assert.equal(b1.active,true);assert.equal(b1.notice_acknowledged,false);assert.equal(b1.policy.privacy_notice,NOTICE);
  board=tx(()=>punch(db,users.employee,{kind:'in',location:{lat:24.7140,lng:46.6753,accuracy:12}}));
  assert.ok(board.me.today.check_in,'recorded, never refused');
  assert.equal(board.punch_location.zone,'no_location');assert.equal(board.punch_location.zone_note,'notice_not_acknowledged');
  assert.equal(db.prepare("SELECT lat FROM attendance_punch_locations WHERE user_id='employee'").get().lat,null);
  db.prepare("UPDATE attendance_records SET check_in_at=? WHERE user_id='employee'").run(new Date(Date.now()-3600000).toISOString());
  // بعد الإقرار: الخادم يحسب المسافة ويعلّم خارج النطاق ولا يمنع.
  board=tx(()=>punch(db,users.employee,{kind:'out',location:{lat:24.7186,lng:46.6753,accuracy:15},location_notice_ack:true}));
  assert.ok(board.me.today.check_out);
  assert.equal(board.punch_location.zone,'out_of_zone');assert.equal(board.punch_location.needs_explanation,true);assert.ok(board.punch_location.distance_m>=500);
  assert.equal(rulesBoard(db,users.employee).location.notice_acknowledged,true);
  assert.throws(()=>tx(()=>punch(db,users.hr,{kind:'in',within:true})),code('invalid_fields'),'a client verdict is not accepted');
  const hrPunch=tx(()=>punch(db,users.hr,{kind:'in',location:{lat:24.7140,lng:46.6753,accuracy:8},location_notice_ack:true}));
  assert.equal(hrPunch.punch_location.zone,'in_zone');assert.equal(hrPunch.punch_location.needs_explanation,false);
  const denied=tx(()=>punch(db,users['hr-manager'],{kind:'in',location_error:'denied'}));
  assert.equal(denied.punch_location.zone,'no_location');assert.equal(denied.punch_location.zone_note,'denied');
  // التوضيح والمراجعة.
  const flagged=rulesBoard(db,users.employee).location.mine;
  assert.equal(flagged.length,2);
  const out=flagged.find(l=>l.kind==='out');
  assert.deepEqual(out.actions,['explain_location']);
  tx(()=>explainLocation(db,users.employee,out.id,{explanation:'كنت عند عميل قريب من المقر'}));
  assert.ok(rulesBoard(db,users.manager).location.review.some(l=>l.id===out.id));
  assert.throws(()=>tx(()=>reviewLocation(db,users.outsider,out.id,{note:'مقبول'})),code('not_found'));
  tx(()=>reviewLocation(db,users.manager,out.id,{note:'مقبول، الاجتماع مسجل'}));
  assert.ok(wf.notifications(db,users.employee).some(n=>n.subject_kind==='attendance_location'));
  assert.equal(state(db,users.employee,today()).zones.out.zone,'out_of_zone');
  assert.ok(verifyAudit(db));
});

test('raw coordinates are purged by a queued job after the retention period and only the zone result stays',t=>{
  const {db,users,tx}=fixture(t,{location:{retention_days:14,privacy_notice:NOTICE,max_accuracy_m:100}});
  const site=tx(()=>proposeSite(db,users.hr,{name:'المقر المصطنع',lat:SITE.lat,lng:SITE.lng,radius_m:150})).id;
  tx(()=>decideSite(db,users['hr-manager'],site,'approve',{note:'مطابق لعنوان المقر'}));
  tx(()=>punch(db,users.employee,{kind:'in',location:{lat:24.7140,lng:46.6753,accuracy:12},location_notice_ack:true}));
  const row=()=>db.prepare("SELECT * FROM attendance_punch_locations WHERE user_id='employee'").get();
  assert.ok(row().lat);assert.ok(row().purge_after);
  const job=db.prepare("SELECT * FROM jobs WHERE type='attendance.location_purge'").get();
  assert.equal(job.source_entity,'attendance_location');assert.equal(job.due_at,row().purge_after);
  assert.deepEqual(runDue(db,{now:Date.now()+13*86400000}),[],'nothing is due before the retention period');
  assert.ok(row().lat);
  const done=runDue(db,{now:Date.now()+15*86400000});
  assert.equal(done[0].outcome,'done');
  const kept=row();
  assert.equal(kept.lat,null);assert.equal(kept.lng,null);assert.ok(kept.purged_at);assert.equal(kept.zone,'in_zone');assert.equal(kept.distance_m,40);
  assert.throws(()=>db.prepare("UPDATE attendance_punch_locations SET lat=1,lng=1 WHERE user_id='employee'").run(),/purged/,'coordinates cannot come back');
  assert.throws(()=>db.prepare("UPDATE attendance_punch_locations SET zone='out_of_zone'").run(),/final/);
  assert.throws(()=>db.prepare('DELETE FROM attendance_punch_locations').run(),/retained/);
  assert.equal(purgeExpiredCoordinates(db,'36t',Date.now()+99*86400000),0,'idempotent');
});

// سقط الساعة 02:05 بتوقيت الرياض من 1 أكتوبر، وكان سيسقط طوال أول يوم في كل شهر: لوحة الحضور تعرض شهر الرياض الجاري افتراضًا،
// وأيام العمل الماضية في هذا الاختبار (d1 وd2) في الشهر السابق حين يكون اليوم أول الشهر. فالملخص يُقرأ بشهر d1 نفسه لا بشهر اليوم.
const exemptions=t=>{
  const {db,users,tx,record}=fixture(t);
  const [d1,d2,d3]=pastWorkdays(3);record('employee',d1,'11:30','17:00');
  assert.equal(state(db,users.employee,d1).state,'late');assert.equal(state(db,users.employee,d2).state,'unexplained');
  assert.throws(()=>tx(()=>proposeExemption(db,users.manager,{user_id:'employee',from_date:d2,to_date:d1,reason:'مرافقة مريض بقرار الإدارة'})),code('not_permitted'));
  const id=tx(()=>proposeExemption(db,users.hr,{user_id:'employee',from_date:d2,to_date:d1,reason:'مرافقة مريض بقرار الإدارة'})).id;
  assert.equal(state(db,users.employee,d1).state,'late','a proposal changes nothing');
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.attendance.approve',note:'اختبار فصل المهام'}));
  assert.throws(()=>tx(()=>decideExemption(db,users.hr,id,'approve',{note:'اعتماد ذاتي'})),code('separation_of_duties'));
  tx(()=>decideExemption(db,users['hr-manager'],id,'approve',{note:'قرار الإدارة المصطنع'}));
  assert.equal(state(db,users.employee,d1).state,'exempt');assert.equal(state(db,users.employee,d2).state,'exempt');assert.equal(state(db,users.employee,d3).state,'unexplained','outside the range nothing changes');
  assert.throws(()=>tx(()=>proposeAbsence(db,users.hr,{user_id:'employee',work_date:d2,reason:'لا سجل حضور ولا إجازة مسجلة'})),code('not_absent'));
  assert.ok(wf.notifications(db,users.employee).some(n=>n.subject_kind==='attendance_exemption'&&n.link==='#attendance'));
  assert.equal(attendanceBoard(db,users.hr,d1.slice(0,7)).company.find(c=>c.id==='employee').summary.exempt>=1,true);
};
test('attendance exemptions: approved dated records, two people, and exempt days are judged neither late nor absent',exemptions);
onEveryClock(test,'attendance exemptions: approved dated records, two people, and exempt days are judged neither late nor absent',exemptions);

test('reports: R37 counts late days, the weekly shortfall subtracts approved permission, and the monthly workbook is a real xlsx',t=>{
  const {db,users,tx,record}=fixture(t);
  const [d1,d2]=pastWorkdays(2);record('employee',d1,'10:20','17:00');record('employee',d2,'09:00','15:00');
  const permit=tx(()=>requestPermission(db,users.employee,{work_date:d2,kind:'early_leave',from_time:'15:00',to_time:'16:00',reason:'ظرف عائلي مصطنع'})).id;
  tx(()=>decidePermission(db,users.manager,permit,'approve',{}));
  assert.equal(state(db,users.employee,d2).state,'early_leave','a permission to 16:00 does not cover leaving at 15:00 until 17:00');
  const r37=runReport(db,users.hr,'R37',{from:d2<d1?d2:d1,to:today()});
  assert.ok(r37.columns.some(c=>c.key==='late'));
  const row=r37.rows.find(x=>x.name===users.employee.name);assert.equal(row.late,1);assert.equal(row.early_leave,1);
  const week=shortfallReport(db,users.hr,d2).rows.find(x=>x.user_id==='employee');
  const mine=shortfallReport(db,users.manager,d2).rows.find(x=>x.user_id==='employee');
  assert.ok(mine,'the manager sees the team');
  assert.equal(shortfallReport(db,users.employee,d2).rows.every(x=>x.user_id==='employee'),true,'an employee sees only themself');
  const sameWeek=shortfallReport(db,users.hr,d2).week_from<=d1&&d1<=shortfallReport(db,users.hr,d2).week_to;
  const expectedShort=sameWeek?80+120-60:120-60;
  assert.ok(week.shortfall_minutes>=expectedShort,'late minutes plus early minutes minus the approved permission');
  assert.equal(week.permission_minutes,60);
  const file=tx(()=>monthlyWorkbook(db,users.hr,d2.slice(0,7)));
  assert.equal(file.content.subarray(0,2).toString(),'PK');assert.match(file.filename,/attendance-\d{4}-\d{2}\.xlsx/);
  const own=tx(()=>monthlyWorkbook(db,users.employee,d2.slice(0,7)));assert.ok(own.content.length<file.content.length,'an employee gets only their own sheet');
});

test('the generic catalog service routes a permission request to the attendance screen',t=>{
  const {db,users,tx}=fixture(t);installServiceCatalog(db);
  assert.throws(()=>catalogAttendanceRoute('HR-ATTENDANCE-FIX',{kind:'استئذان'}),code('use_attendance_screen'));
  assert.equal(catalogAttendanceRoute('HR-ATTENDANCE-FIX',{kind:'عمل عن بعد'}),undefined);
  assert.equal(catalogAttendanceRoute('HR-LETTER',{kind:'استئذان'}),undefined);
  const service=wf.catalog(db,users.employee).find(s=>s.code==='HR-ATTENDANCE-FIX');
  assert.ok(service);
  let error;try{tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'استئذان',payload:{kind:'استئذان'}}));}catch(e){error=e;}
  assert.equal(error?.code,'use_attendance_screen');assert.equal(error.details.action,'request_permission');
});

test('the server allows geolocation for its own origin only',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-attendance-rules');
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=(self)');
});
