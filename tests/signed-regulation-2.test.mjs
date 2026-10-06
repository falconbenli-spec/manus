import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { statutoryHolidayPlan, statutoryHolidayPlanWithNotes, proposeStatutoryHolidays, holidayWorkdays, REGULATION_PUBLIC_HOLIDAYS, REGULATION_WORKDAYS } from '../app/leave-types.mjs';
import { RULE_ARTICLES, RULE_DRAFT, RAMADAN_1448, effectiveHours, expectedMinutes } from '../app/attendance-policy.mjs';
import { prepareRamadanDraft, ramadanPolicyDraft, rulesBoard } from '../app/attendance-rules.mjs';
import { prepareOnDatabase } from '../scripts/prepare-ramadan-1448-draft.mjs';
import { assignOvertime, assignmentGap, dayTypeFor, ART77_9 } from '../app/overtime-rules.mjs';
import { requestMission, decideMission, requestOvertime, overtimeToPayroll, attendanceExtras } from '../app/attendance-extras.mjs';
import { prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideAdjustment, proposeAdjustment, proposeClassifiedDeduction, consentToDeduction, myDeductionConsents, extrasBoard, deductionBasisOf, DEDUCTION_CASES, DEDUCTION_CONSENT_TEXT } from '../app/payroll-extras.mjs';
import { listPayroll } from '../app/payroll.mjs';
import { payrollUI } from '../app/static/payroll-ui.mjs';
import { payrollExtrasUI } from '../app/static/payroll-extras-ui.mjs';
import { uncreditedOvertime, unsettledTimeOff, creditOvertime, ART77_6, LOT_STATES } from '../app/leave-compensatory.mjs';

// الموجة الثانية من تصحيح المنصة على النسخة الموقعة من لائحة تنظيم العمل (شهادة 351743، 25-10-1446هـ).
// كل رقم هنا مقروء من صورة صفحته: م81 ص 28، م84 ص 29، م73 وم74 ص 25، م51 ص 19، م76 ص 26–27، م77 ص 27. كل ما في الاختبار مصطنع.
const code=expected=>error=>error.code===expected;
const weekday=date=>new Date(`${date}T00:00:00Z`).getUTCDay();

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-signed-regulation-2');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=fn=>transaction(db,fn);
  for(const capability of ['hr.policy.accept','hr.attendance.approve','hr.contracts.approve','payroll.approve'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية التجريبي (DEC16)'}));
  // سياسة ساعات عمل معتمدة بأيام عمل غير الجمعة والسبت: الأحد راحة مع السبت — م73(1) تجيز استبدال يوم آخر بعد إبلاغ مكتب العمل.
  const workingTime=(parameters,effective='2020-01-01')=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات عمل تجريبية',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from:effective,parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة المصطنعة'}));return id;};
  return {db,users,tx,workingTime};
}

test('م81 (ص 28): every one of the four holidays falling on the weekly rest is compensated from the ACCEPTED workdays, the only exception is an Eid day that is National or Founding Day, and the basis names the page',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  // (أ) بلا سياسة معتمدة: أيام العمل من نص م73(1) نفسه، ويُقال ذلك في السند.
  const bare=holidayWorkdays(db,'36t',2027);
  assert.deepEqual(bare.workdays,[...REGULATION_WORKDAYS]);assert.equal(bare.policy_id,null);assert.match(bare.source_ar,/م73\(1\)/);
  // (ب) العيدان: 4 أيام من البداية؛ ما وقع منها في الراحة يُعوَّض بعد آخر أيام العيد — الأربع كلها compensate:true (كانت العيدان قبل ذلك بلا تعويض).
  assert.ok(REGULATION_PUBLIC_HOLIDAYS.items.every(i=>i.compensate===true));
  const fitr=statutoryHolidayPlan(2027,{eid_al_fitr_start:'2027-03-10'});
  assert.deepEqual(fitr.filter(h=>h.key==='eid_al_fitr'&&h.kind==='holiday').map(h=>h.date),['2027-03-10','2027-03-11','2027-03-12','2027-03-13']);
  assert.deepEqual(fitr.filter(h=>h.key==='eid_al_fitr'&&h.kind==='compensation').map(h=>h.date),['2027-03-14','2027-03-15'],'Friday 12 and Saturday 13 March are compensated on Sunday and Monday');
  assert.ok(fitr.filter(h=>h.kind==='compensation').every(h=>h.basis.includes('م81')&&h.basis.includes('ص 28')&&h.basis.includes('قبل أيام تلك الإجازات أو بعدها')),'the basis quotes the closing paragraph and its signed page');
  // (ج) أيام العمل من السياسة المعتمدة: راحة السبت والأحد بدل الجمعة والسبت. 12 مارس 2027 (جمعة) صار يوم عمل، و14 مارس (أحد) صار راحة.
  workingTime({workdays:[1,2,3,4,5],start:'09:00',end:'17:00',grace_minutes:30});
  const accepted=holidayWorkdays(db,'36t',2027);
  assert.deepEqual(accepted.workdays,[1,2,3,4,5]);assert.ok(accepted.policy_id);
  const shifted=statutoryHolidayPlan(2027,{eid_al_fitr_start:'2027-03-10',...accepted});
  assert.deepEqual(shifted.filter(h=>h.key==='eid_al_fitr'&&h.kind==='compensation').map(h=>h.date),['2027-03-15'],'only Saturday 13 March is rest now, compensated on Monday 15 (Sunday 14 is rest)');
  assert.ok(shifted.filter(h=>h.kind==='compensation').every(h=>h.basis.includes('ساعات عمل تجريبية')),'the basis names the accepted policy the rest days came from');
  // (د) اليوم الوطني ويوم التأسيس على القاعدة العامة نفسها: 23 سبتمبر 2028 يقع في السبت (راحة في السياستين). اليوم التالي إن كان يوم عمل، وإلا
  // آخر يوم عمل قبله — فالسبت أول يومي راحة السبت والأحد يُعوَّض بالجمعة قبله، كما تُعوَّض الجمعة بالخميس حين الراحة الجمعة والسبت. «قبل أو بعد» كلاهما في م81.
  assert.equal(weekday('2028-09-23'),6);
  const nd=statutoryHolidayPlan(2028,accepted).filter(h=>h.key==='national_day');
  assert.deepEqual(nd.map(h=>[h.kind,h.date]),[['compensation','2028-09-22'],['holiday','2028-09-23']],'Sunday 24 is rest in this policy, so Friday 22 before it');
  assert.deepEqual(statutoryHolidayPlan(2028).filter(h=>h.key==='national_day').map(h=>[h.kind,h.date]),[['holiday','2028-09-23'],['compensation','2028-09-24']],'with Friday–Saturday rest it is Sunday 24');
  // (هـ) الاستثناء الوحيد المكتوب: يوم وطني داخل أيام عيد لا يُعوَّض، ويُقال ذلك بيانًا لا عطلةً. عيد أضحى مصطنع يبدأ 21 سبتمبر 2028 يغطي 23 سبتمبر.
  const overlap=statutoryHolidayPlanWithNotes(2028,{eid_al_adha_start:'2028-09-21',...accepted});
  const notice=overlap.notes.find(h=>h.key==='national_day');
  assert.equal(notice.kind,'not_compensated');assert.match(notice.basis,/فلا يعوض العامل عنه/);
  assert.equal(overlap.items.filter(h=>h.key==='national_day').length,0,'no holiday row and no compensation row for it: the notice is beside the plan, not in it');
  // ويوم التعويض عن العيد لا يقع على يوم وطني أو تأسيس: عيد فطر مصطنع ينتهي قبل 22 فبراير مباشرة.
  const feb=statutoryHolidayPlan(2028,{eid_al_fitr_start:'2028-02-17',...accepted});
  assert.ok(!feb.some(h=>h.kind==='compensation'&&h.date==='2028-02-22'),'22 February is Founding Day, never a compensation day');
  // (و) الاقتراح الفعلي يقرأ السياسة المعتمدة، ولا يقترح بيان «لا يُعوَّض» عطلةً، ويسجل السند بالصفحة.
  const year=new Date().getUTCFullYear()+1;
  const proposed=tx(()=>proposeStatutoryHolidays(db,users.hr,{year}));
  assert.ok(proposed.proposed>=2);
  const rows=db.prepare("SELECT holiday_date,name,basis FROM public_holidays WHERE tenant_id='36t' AND holiday_date LIKE ? AND status='proposed'").all(`${year}-%`);
  assert.ok(rows.every(r=>r.basis.includes('م81')&&r.basis.includes('ص 28')));
  assert.ok(!rows.some(r=>r.name.includes('لا يُعوَّض')));
  const inside=tx(()=>proposeStatutoryHolidays(db,users.hr,{year:year+1,eid_al_adha_start:`${year+1}-09-21`}));
  assert.ok(inside.skipped.some(x=>x.date===`${year+1}-09-23`&&/لا يُعوَّض/.test(x.reason)),'the proposer is told why National Day is not in the plan');
  assert.equal(REGULATION_PUBLIC_HOLIDAYS.circular_ar.includes('م84(4)'),true,'the annual circular is م84(4), not م81');
  assert.ok(verifyAudit(db));
});

test('م84(1)–(2) (ص 29): an Eid starting on the second working day is brought forward to the end of the previous week, one ending the day before the last working day is pushed to the next week — both from the accepted workdays, and proposed as named holidays',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  const shifts=plan=>plan.filter(h=>h.kind==='shift').map(h=>[h.rule,h.date]);
  // أيام العمل من نص م73(1) (الأحد–الخميس): 2028-05-22 اثنين (ثاني أيام العمل) → يتقدم العيد فيدخل الأحد 21؛ نهايته الخميس 25 فلا تأخير.
  assert.equal(weekday('2028-05-22'),1);
  const monday=statutoryHolidayPlan(2028,{eid_al_adha_start:'2028-05-22'});
  assert.deepEqual(shifts(monday),[['start','2028-05-21']]);
  assert.match(monday.find(h=>h.kind==='shift').basis,/م84 الفقرة الأولى/);assert.match(monday.find(h=>h.kind==='shift').basis,/ص 29/);
  // 2028-06-04 أحد (أول أيام العمل، لا تقديم)؛ نهايته الأربعاء 7 وهو اليوم الذي يسبق آخر أيام العمل → يتأخر فيدخل الخميس 8، والتعويض يبدأ بعده.
  assert.equal(weekday('2028-06-04'),0);
  const sunday=statutoryHolidayPlan(2028,{eid_al_fitr_start:'2028-06-04'});
  assert.deepEqual(shifts(sunday),[['end','2028-06-08']]);
  assert.match(sunday.find(h=>h.kind==='shift').basis,/م84\(2\)/);
  assert.equal(sunday.filter(h=>h.key==='eid_al_fitr'&&h.kind==='compensation').length,0,'no Eid day fell on the rest, so nothing to compensate');
  // عيد يبدأ الأربعاء وينتهي السبت (كما في الاختبار المسجل): لا تقديم ولا تأخير، والتعويض كما كان.
  assert.deepEqual(shifts(statutoryHolidayPlan(2027,{eid_al_fitr_start:'2027-03-10'})),[]);
  // أيام عمل معتمدة الاثنين–الجمعة: ثاني أيام العمل الثلاثاء، واليوم الذي يسبق آخرها الخميس.
  workingTime({workdays:[1,2,3,4,5],start:'09:00',end:'17:00',grace_minutes:30});
  const accepted=holidayWorkdays(db,'36t',2028);
  assert.equal(weekday('2028-05-23'),2);
  const tuesday=statutoryHolidayPlan(2028,{eid_al_adha_start:'2028-05-23',...accepted});
  assert.deepEqual(shifts(tuesday),[['start','2028-05-22']],'Monday enters the Eid');
  assert.equal(weekday('2028-06-05'),1);
  const monEnd=statutoryHolidayPlan(2028,{eid_al_fitr_start:'2028-06-05',...accepted});
  assert.deepEqual(shifts(monEnd),[['end','2028-06-09']],'ends Thursday 8, so Friday 9 enters the Eid');
  // يوم التعويض عن يوم عيد وقع في الراحة يُقترح بعد الامتداد لا قبله: عيد يبدأ الاثنين 2028-06-05 لا يقع منه يوم في السبت أو الأحد، فلا تعويض.
  assert.equal(monEnd.filter(h=>h.key==='eid_al_fitr'&&h.kind==='compensation').length,0);
  // الاقتراح الفعلي: أيام التقديم والتأخير تُقترح عطلًا باسمها ومادتها ويعتمدها شخص آخر.
  const year=new Date().getUTCFullYear()+1;
  const day=(from,wd)=>{let d=from;while(weekday(d)!==wd)d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);return d;};
  const start=day(`${year}-06-01`,2);
  const proposed=tx(()=>proposeStatutoryHolidays(db,users.hr,{year,eid_al_adha_start:start}));
  assert.ok(proposed.proposed>=5);
  const before=new Date(Date.parse(start+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const row=db.prepare("SELECT name,basis,status FROM public_holidays WHERE tenant_id='36t' AND holiday_date=?").get(before);
  assert.ok(row&&row.status==='proposed');assert.match(row.name,/تقديم بداية إجازة عيد الأضحى \(م84\(1\)\)/);assert.match(row.basis,/ص 29/);
  assert.match(REGULATION_PUBLIC_HOLIDAYS.shift_ar,/مبنيان في خطة العطل/);
  assert.ok(verifyAudit(db));
});

test('م76/م77 citations (ص 26–27): the authority holder is م77(3), the budget is م77(7), the manager writing the assignment is م77(2) with م76(1), and the hourly divisor comes from م50(1) and م73(2), not from م76/م77',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  assert.match(RULE_ARTICLES.overtime,/م77\(3\) موافقة مسبقة من صاحب الصلاحية/);assert.match(RULE_ARTICLES.overtime,/م77\(7\) ميزانية معتمدة/);
  assert.match(RULE_ARTICLES.overtime,/الشهر 30 يومًا من م50\(1\) واليوم 8 ساعات من م73\(2\)، لا من م76 ولا م77/);
  assert.doesNotMatch(RULE_ARTICLES.overtime,/م76\(3\)/,'م76 has two paragraphs only');
  // خطوتا التكليف باسم مادتيهما الصحيحتين.
  workingTime({workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30,overtime:RULE_DRAFT.overtime});
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
  const a=tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:today,to_date:today,minutes_per_day:60,reason:'تسليم حملة مصطنعة قبل الموعد'}));
  const row=db.prepare('SELECT * FROM overtime_assignments WHERE id=?').get(a.id);
  assert.match(assignmentGap(db,row).step_name,/م77\(3\)، البند الأول/);assert.doesNotMatch(assignmentGap(db,row).step_name,/م76\(2\)/);
  assert.match(assignmentGap(db,{...row,status:'authorised'}).step_name,/م77\(7\)/);assert.doesNotMatch(assignmentGap(db,{...row,status:'authorised'}).step_name,/م76\(3\)/);
  // من ليس المدير المباشر يُرفض بالمادتين الصحيحتين: م77(2) من يقر، وم76(1) شكل التكليف.
  assert.throws(()=>tx(()=>assignOvertime(db,users.hr,{user_id:'employee',from_date:today,to_date:today,minutes_per_day:60,reason:'تكليف من غير المدير المباشر'})),error=>error.code==='not_permitted'&&/م77\(2\)/.test(error.message)&&/م76\(1\)/.test(error.message));
});

test('م77(9) (ص 27): overtime and an official mission may not combine on ORDINARY WORKING DAYS only — a rest day or a public holiday inside the mission is outside the paragraph, and the refusal quotes its scope',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  workingTime({workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30,overtime:RULE_DRAFT.overtime});
  const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
  const next=(w,from=addDays(today,1))=>{let d=from;while(weekday(d)!==w)d=addDays(d,1);return d;};
  // مهمة تمتد من الخميس إلى الأحد: فيها يوما راحة (الجمعة والسبت) ويوما عمل معتادان.
  const thu=next(4),fri=addDays(thu,1),sat=addDays(thu,2),sun=addDays(thu,3);
  const mission=tx(()=>requestMission(db,users.employee,{from_date:thu,to_date:sun,destination:'جدة',purpose:'اجتماع مصطنع مع عميل خارج المدينة'})).id;
  tx(()=>decideMission(db,users.manager,mission,'approve',{note:'مهمة لازمة'}));
  assert.equal(dayTypeFor(db,users.employee,fri),'rest');assert.equal(dayTypeFor(db,users.employee,sun),'working');
  // تكليف على يوم الراحة داخل المهمة: يمر (خارج نطاق م77(9))؛ على يوم العمل المعتاد: يُرفض ويُسمّى اليوم والنطاق.
  tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:fri,to_date:sat,minutes_per_day:60,reason:'تسليم حملة مصطنعة في يومي الراحة أثناء المهمة'}));
  assert.throws(()=>tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:sun,to_date:sun,minutes_per_day:60,reason:'تسليم حملة مصطنعة في يوم عمل داخل المهمة'})),
    error=>error.code==='mission_overlap'&&error.message.includes(sun)&&error.message.includes('أيام العمل المعتادة وحدها'));
  // وعطلة رسمية معتمدة داخل مهمة: خارج النطاق أيضًا. الخميس التالي بعد أسبوعين عطلة معتمدة.
  const holiday=next(4,addDays(sun,8));
  db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES('h-1','36t',?,'عطلة رسمية مصطنعة','تعميم مصطنع لبيئة الاختبار','approved','hr','hr-manager',?,?)").run(holiday,now(),now());
  const second=tx(()=>requestMission(db,users.outsider,{from_date:holiday,to_date:holiday,destination:'الدمام',purpose:'زيارة مصطنعة لموقع تصوير في عطلة'})).id;
  tx(()=>decideMission(db,users.manager,second,'approve',{note:'مهمة لازمة'}));
  assert.equal(dayTypeFor(db,users.outsider,holiday),'holiday');
  tx(()=>assignOvertime(db,users.manager,{user_id:'outsider',from_date:holiday,to_date:holiday,minutes_per_day:60,reason:'عمل مصطنع في عطلة رسمية أثناء مهمة'}));
  // والعكس: مهمة تُطلب فوق عمل إضافي مسجل في يوم راحة تمر، وفوق عمل إضافي في يوم عمل تُرفض.
  const past=(w)=>{let d=addDays(today,-1);while(weekday(d)!==w)d=addDays(d,-1);return d;};
  const pastFri=past(5),pastMon=past(1);
  tx(()=>requestOvertime(db,users.outsider,{work_date:pastFri,minutes:60,reason:'تبرير كافٍ للعمل دون تكليف مسبق في يوم راحة'}));
  tx(()=>requestOvertime(db,users.outsider,{work_date:pastMon,minutes:60,reason:'تبرير كافٍ للعمل دون تكليف مسبق في يوم عمل'}));
  assert.equal(db.prepare('SELECT day_type FROM overtime_requests WHERE user_id=? AND work_date=?').get('outsider',pastFri).day_type,'rest');
  tx(()=>requestMission(db,users.outsider,{from_date:pastFri,to_date:pastFri,destination:'الخبر',purpose:'مهمة مصطنعة في يوم راحة فيه عمل إضافي'}));
  assert.throws(()=>tx(()=>requestMission(db,users.outsider,{from_date:pastMon,to_date:pastMon,destination:'الخبر',purpose:'مهمة مصطنعة في يوم عمل فيه عمل إضافي'})),
    error=>error.code==='overtime_overlap'&&error.message.includes(pastMon)&&error.message.includes(ART77_9));
  assert.ok(verifyAudit(db));
});

test('م77(6) (ص 27): overtime chosen as leave, never credited, is paid in cash when service ends for any reason — through the same proposal path, approved by the payroll approver, citing the article — and is never credited afterwards',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  workingTime({workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30,overtime:RULE_DRAFT.overtime});
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة تجريبية '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة التجريبية'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']});
  const contractId=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد تجريبي لا وجود له'})).id;
  const step=(by,action,extra={})=>tx(()=>contractAction(db,users[by],contractId,action,{version:getContract(db,users[by],contractId).version,...extra}));
  step('hr','submit_contract');step('hr-manager','approve_contract');
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10),addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  let d1=addDays(today,-1);while(weekday(d1)>4)d1=addDays(d1,-1);
  // صف بشكل ما قبل الترحيل 125: «وقت راحة» معتمد بلا قيد رصيد (لا سياسة أنواع إجازات معتمدة أصلًا). كان يُرفض إلى المسير بلا شرط.
  const stamp=now();
  db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,decided_by,decided_at,decision_note,created_at,retroactive,compensation,consent_at,day_type) VALUES('ot-uncredited','36t','employee',?,120,'ساعات مصطنعة اعتُمدت قبل دفتر الأرصدة','approved','manager',?,'اعتماد سابق',?,1,'time_off',?,'working')").run(d1,stamp,stamp,stamp);
  const month=today.slice(0,7);
  // والخدمة قائمة: الباب مغلق، والرفض يسمّي القيد الناقص ويقول إن الدفع نقدًا عند انتهاء الخدمة وحده (م77(6)).
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,'ot-uncredited',{month})),error=>error.code==='time_off_chosen'&&/خدمته قائمة/.test(error.message)&&error.details.refusal.missing.some(m=>/م77\(6\)/.test(m.why)));
  assert.equal(attendanceExtras(db,users.hr).overtime.find(o=>o.id==='ot-uncredited').actions.includes('overtime_to_payroll'),false);
  // انتهت الخدمة: يُدفع الأجر الإضافي نقدًا من الباب نفسه، بالمقترح من معادلة السياسة، ويعتمده معتمد الرواتب كأي حركة.
  step('hr-manager','end_contract',{ended_on:today,reason:'انتهاء خدمة تجريبي لاختبار م77(6)'});
  const row=attendanceExtras(db,users.hr).overtime.find(o=>o.id==='ot-uncredited');
  assert.deepEqual(row.actions,['overtime_to_payroll']);assert.match(row.end_of_service_cash_out,/م77\(6\)/);assert.ok(row.suggested,'the overtime formula prices it');
  const paid=tx(()=>overtimeToPayroll(db,users.hr,'ot-uncredited',{month}));
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(paid.adjustment_id);
  assert.equal(adjustment.status,'proposed');assert.equal(adjustment.kind,'overtime');assert.match(adjustment.reason,/يُدفع الأجر الإضافي نقدًا/);assert.ok(adjustment.reason.includes(ART77_6));
  assert.equal(JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE action='overtime.to_payroll' ORDER BY seq DESC LIMIT 1").get().after_json).article,'م77(6)');
  assert.throws(()=>tx(()=>decideAdjustment(db,users.hr,paid.adjustment_id,'approve',{note:'اعتماد من المقترح'})),code('not_permitted'));
  tx(()=>decideAdjustment(db,users['hr-manager'],paid.adjustment_id,'approve',{note:'اعتماد أجر إضافي نقدًا عند انتهاء الخدمة (م77(6))'}));
  // الساعة لا تُعوَّض مرتين: لا تُقيَّد رصيدًا بعد الدفع، ولا تبقى في طابور القيد ولا في «لم يُسوَّ».
  const o=db.prepare('SELECT * FROM overtime_requests WHERE id=?').get('ot-uncredited');
  assert.equal(tx(()=>creditOvertime(db,users['hr-manager'],o,{legacy:true,reason:'محاولة قيد بعد الدفع'})),null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compensatory_credits').get().n,0);
  assert.equal(uncreditedOvertime(db,users['hr-manager']).some(q=>q.id==='ot-uncredited'),false);
  assert.deepEqual(unsettledTimeOff(db,'36t','employee'),[]);
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,'ot-uncredited',{month})),code('already_linked'));
  assert.match(LOT_STATES.service_ended,/م77\(6\)/);
  assert.ok(verifyAudit(db));
});

test('م73(2) وم74(2) (ص 25): the Ramadan 1448 window is prepared as a DRAFT copy of the accepted working-time policy by the HR preparer — six hours a day and at most thirty-six a week, provisional until the sighting — and only the HR manager can accept it',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  // الرقمان من الصفحة الموقعة: ست ساعات يوميًا، ست وثلاثون أسبوعيًا؛ والنافذة الجدولية 8 فبراير → 8 مارس 2027 مبدئية.
  assert.deepEqual([RAMADAN_1448.from,RAMADAN_1448.to,RAMADAN_1448.provisional],['2027-02-08','2027-03-08',true]);assert.match(RAMADAN_1448.note,/9 مارس 2027/);
  assert.match(RULE_ARTICLES.ramadan,/ص 25/);assert.match(RULE_ARTICLES.ramadan,/للعمال المسلمين/);assert.match(RULE_ARTICLES.ramadan,/يُفرض الحدان معًا/);
  assert.deepEqual([RULE_DRAFT.ramadan.from,RULE_DRAFT.ramadan.to],[RAMADAN_1448.from,RAMADAN_1448.to],'the preparer’s form is prefilled with the window');
  // بلا سياسة معتمدة لا مسودة: لا تُخترع أيام عمل ولا دوام.
  assert.equal(ramadanPolicyDraft(db,'36t'),null);
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.hr,{})),error=>error.code==='working_time_policy_required'&&error.details.refusal.missing[0].owner_role==='hr.policy.accept');
  // المدقق يحمي الحدين: ست ساعات على سبعة أيام (42 ساعة) تُرفض بم74(2)، وسبع ساعات يومًا تُرفض بم73(2). السياسة المعتمدة لا تُعدَّل (قادح)، فتُقبل نسخة ثم أخرى.
  workingTime({workdays:[0,1,2,3,4,5,6],start:'08:00',end:'16:00',grace_minutes:15});
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.hr,{})),error=>error.code==='ramadan'&&/م74\(2\)/.test(error.message));
  const seven=workingTime({workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15,overtime:RULE_DRAFT.overtime,permission_monthly_cap_minutes:240});
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.hr,{ramadan:{start:'09:00',end:'16:00'}})),error=>error.code==='ramadan'&&/م73\(2\)/.test(error.message));
  // الأدمن لا يعدّ، والموظف بلا تصريح لا يعدّ، ومن يحمل التصريح يعدّ بهويته.
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.admin,{})),code('forbidden'));
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.employee,{})),code('not_permitted'));
  assert.equal(rulesBoard(db,users.hr).ramadan_1448.draft_ready,true);
  const draft=tx(()=>prepareRamadanDraft(db,users.hr,{}));
  const row=db.prepare('SELECT * FROM hr_policies WHERE id=?').get(draft.id),p=JSON.parse(row.parameters);
  assert.equal(row.status,'draft');assert.equal(row.prepared_by,'hr');assert.equal(row.effective_from,'2027-02-08');
  assert.deepEqual(p.ramadan,{from:'2027-02-08',to:'2027-03-08',start:'09:00',end:'15:00',daily_minutes:360,weekly_minutes:1800,hijri:RAMADAN_1448.hijri,provisional:true,provisional_note:RAMADAN_1448.note});
  assert.deepEqual([p.workdays,p.start,p.end,p.grace_minutes,p.permission_monthly_cap_minutes,p.overtime],[[0,1,2,3,4],'08:00','16:00',15,240,RULE_DRAFT.overtime],'everything else is copied from the accepted version');
  assert.match(row.basis,/م73\(2\) ص 25/);assert.match(row.basis,/م74\(2\) ص 25/);assert.match(row.basis,/5 × 6 = 30 لا 36/);assert.match(row.body,/لا تحمل حقل ديانة/);assert.match(row.body,/مبدئية/);
  assert.match(p.citations.ramadan,/ص 25/);
  assert.throws(()=>tx(()=>prepareRamadanDraft(db,users.hr,{})),code('draft_exists'));
  // لا أثر قبل القبول: الدوام ما زال ثماني ساعات في رمضان. والمُعد لا يقبل ما أعدّه؛ مدير الموارد البشرية يقبل.
  const before=JSON.parse(db.prepare("SELECT parameters FROM hr_policies WHERE id=?").get(seven).parameters);
  assert.equal(expectedMinutes(effectiveHours(before,null,'2027-02-15')),480);
  assert.throws(()=>tx(()=>decidePolicy(db,users.hr,draft.id,'accept',{note:'محاولة قبول من المُعد'})),error=>['separation_of_duties','not_permitted'].includes(error.code));
  assert.equal(row.status,'draft');
  tx(()=>decidePolicy(db,users['hr-manager'],draft.id,'accept',{note:'قبلت ساعات رمضان 1448 المبدئية وسأعدّلها بنسخة جديدة عند إعلان الرؤية'}));
  const after=JSON.parse(db.prepare("SELECT parameters FROM hr_policies WHERE id=?").get(draft.id).parameters);
  assert.equal(expectedMinutes(effectiveHours(after,null,'2027-02-15')),360,'inside the window the day is six hours');
  assert.equal(effectiveHours(after,null,'2027-02-15').ramadan_day,true);assert.equal(effectiveHours(after,null,'2027-03-09').ramadan_day,false,'9 March is outside the tabulated window until HR issues a new version');
  assert.equal(expectedMinutes(effectiveHours(after,null,'2027-03-09')),480);
  // الأمر التشغيلي يكتب المسودة بهوية مُعد مسمّى ولا يقبلها؛ والاسم المجهول يُرفض.
  const other=openDb(':memory:');seed(other,'synthetic-ramadan-script');t.after(()=>other.close());
  other.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const ou=Object.fromEntries(other.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  transaction(other,()=>grantAccess(other,ou.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'مدير الموارد البشرية التجريبي'}));
  assert.throws(()=>prepareOnDatabase(other,{username:'nobody'}),/No active account/);
  const base=transaction(other,()=>preparePolicy(other,ou.hr,{kind:'working_time',title:'ساعات عمل تجريبية',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from:'2020-01-01',parameters:{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30}})).id;
  assert.throws(()=>prepareOnDatabase(other,{username:'hr'}),/No accepted working-time policy/);
  transaction(other,()=>decidePolicy(other,ou['hr-manager'],base,'accept',{note:'قبلت السياسة المصطنعة'}));
  const scripted=prepareOnDatabase(other,{username:'hr'});
  assert.equal(other.prepare('SELECT status,prepared_by FROM hr_policies WHERE id=?').get(scripted.id).status,'draft');assert.equal(scripted.prepared_by,'hr');assert.equal(scripted.weekly_minutes,1800);
  assert.equal(other.prepare("SELECT COUNT(*) AS n FROM hr_policies WHERE status='accepted' AND kind='working_time'").get().n,1,'the script never accepts');
  assert.ok(verifyAudit(db)&&verifyAudit(other));
});

test('م51 (ص 19): a deduction from wage needs the worker’s written consent — recorded by his own identity — or one of the six printed cases; the approver is stopped until then, and deductions from before the rule keep working',t=>{
  const {db,users,tx,workingTime}=fixture(t);
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة تجريبية '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة التجريبية'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']});
  const contractId=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد تجريبي لا وجود له'})).id;
  const step=(by,action)=>tx(()=>contractAction(db,users[by],contractId,action,{version:getContract(db,users[by],contractId).version}));step('hr','submit_contract');step('hr-manager','approve_contract');
  const month='2026-12',base={user_id:'employee',kind:'deduction',month,amount:'100.00',reason:'خصم مصطنع بسبب حر لاختبار م51'};
  // الحالات الست بترقيمها المطبوع؛ الغرامة وما أُتلف كلتاهما البند 5.
  assert.deepEqual(DEDUCTION_CASES.map(c=>[c.key,c.item]),[['employer_loan',1],['social_insurance',2],['savings_fund',3],['housing_instalment',4],['fine',5],['damage',5],['court_order',6]]);
  assert.match(DEDUCTION_CASES[0].name,/10%/);assert.match(DEDUCTION_CASES[6].name,/ربع الأجر المستحق/);
  // (أ) من النموذج: بلا سند يُرفض ويسمّي الخيارين؛ وحالة بلا سندها تُرفض.
  assert.throws(()=>tx(()=>proposeAdjustment(db,users.hr,{...base,deduction_basis:''})),error=>error.code==='deduction_basis_required'&&error.details.refusal.missing[0].owner_role==='payroll.prepare'&&/الحالات/.test(error.message));
  assert.throws(()=>tx(()=>proposeAdjustment(db,users.hr,{...base,deduction_basis:'damage'})),code('invalid_text'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payroll_adjustments WHERE kind='deduction'").get().n,0,'a refused proposal writes nothing');
  // (ب) حالة من الحالات الست: تمر وتُعتمد، وسندها مكتوب بجوارها ومقروء للمعتمد.
  const damage=tx(()=>proposeAdjustment(db,users.hr,{...base,deduction_basis:'damage',deduction_reference:'محضر إتلاف مصطنع رقم 7'}));
  assert.deepEqual([damage.deduction_basis,damage.consent_pending],['exception',false]);
  const b1=deductionBasisOf(db,damage.id);assert.deepEqual([b1.basis,b1.exception_case,b1.item,b1.reference,b1.recorded_by],['exception','damage',5,'محضر إتلاف مصطنع رقم 7','hr']);
  const board=extrasBoard(db,users['hr-manager']).adjustments.find(a=>a.id===damage.id);
  assert.equal(board.deduction_basis.case_name,DEDUCTION_CASES.find(c=>c.key==='damage').name);assert.match(payrollExtrasUI.render({...extrasBoard(db,users['hr-manager']),retro:{candidates:[],history:[],rule:''}},{e:x=>String(x),button:()=>'',money:x=>String(x)}),/سند الخصم: .*محضر إتلاف مصطنع رقم 7/);
  tx(()=>decideAdjustment(db,users['hr-manager'],damage.id,'approve',{note:'اعتماد خصم ما أُتلف (م51/5)'}));
  // حالة ذات سقف (قرض 10%) تُصنَّف في جدول التصنيف فتدخل سقوف المسير، ولا تُكرر إن جاءت من باب الخصم المصنف.
  const loan=tx(()=>proposeAdjustment(db,users.hr,{...base,amount:'50.00',deduction_basis:'employer_loan',deduction_reference:'قرض مصطنع رقم 3'}));
  assert.equal(db.prepare('SELECT class FROM payroll_adjustment_classes WHERE adjustment_id=?').get(loan.id).class,'employer_loan');
  const court=tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'20.00',reason:'تنفيذ حكم مصطنع',class:'court_order',reference:'حكم مصطنع 12/1447'}));
  assert.deepEqual([deductionBasisOf(db,court.id).exception_case,db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustment_classes WHERE adjustment_id=?').get(court.id).n],['court_order',1]);
  // (ج) موافقة العامل: تُقترح معلقة، لا تُعتمد قبلها، ولا يقرّها غيره، ويقرّها هو بهويته بنص يذكر المبلغ والشهر؛ ثم تُعتمد.
  const consentful=tx(()=>proposeAdjustment(db,users.hr,{...base,amount:'80.00',deduction_basis:'consent'}));
  assert.equal(consentful.consent_pending,true);
  assert.throws(()=>tx(()=>decideAdjustment(db,users['hr-manager'],consentful.id,'approve',{note:'محاولة اعتماد قبل الموافقة'})),error=>error.code==='consent_required'&&error.details.refusal.missing[0].owner_role==='employee'&&/م51/.test(error.message));
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(consentful.id).status,'proposed');
  assert.throws(()=>tx(()=>consentToDeduction(db,users.outsider,consentful.id,{consent:true})),code('not_found'),'nobody consents for the worker');
  assert.throws(()=>tx(()=>consentToDeduction(db,users.employee,consentful.id,{consent:false})),code('consent_required'));
  assert.throws(()=>tx(()=>consentToDeduction(db,users.employee,damage.id,{consent:true})),code('consent_not_needed'),'an excepted case asks nothing of him');
  const mine=myDeductionConsents(db,users.employee);
  assert.deepEqual(mine.map(d=>[d.id,d.amount_minor,d.consent_text]),[[consentful.id,8000,DEDUCTION_CONSENT_TEXT]]);
  assert.deepEqual(myDeductionConsents(db,users.outsider),[]);
  const own=listPayroll(db,users.employee);assert.equal(own.deduction_consents.length,1);
  assert.match(payrollUI.render(own,{e:x=>String(x),button:(a,id,l)=>`[${a}:${id}:${l}]`,money:x=>String(x),ui:{}}),/خصومات تنتظر موافقتي/);
  assert.match(payrollUI.form('consent_deduction',consentful.id,own).endpoint,/\/payroll\/adjustments\/.+\/consent$/);
  const consented=tx(()=>consentToDeduction(db,users.employee,consentful.id,{consent:true}));
  assert.match(consented.consent_text,/المبلغ: 80\.00 ريال\. شهر المسير: 2026-12/);
  const b2=deductionBasisOf(db,consentful.id);assert.deepEqual([b2.consent_by,b2.consent_pending,!!b2.consent_at],['employee',false,true]);
  assert.throws(()=>tx(()=>consentToDeduction(db,users.employee,consentful.id,{consent:true})),code('already_consented'));
  assert.throws(()=>db.prepare("UPDATE payroll_deduction_basis SET consent_text='تعديل' WHERE adjustment_id=?").run(consentful.id),/recorded once/);
  assert.deepEqual(myDeductionConsents(db,users.employee),[]);
  tx(()=>decideAdjustment(db,users['hr-manager'],consentful.id,'approve',{note:'اعتماد بعد موافقة العامل المسجلة'}));
  // (د) وحدة لم تسمِّ سندها (باب داخلي): تمر معلقةً على موافقة العامل، لا مرفوضة ولا بلا سند.
  const anonymous=tx(()=>proposeAdjustment(db,users.hr,{...base,amount:'10.00',reason:'خصم من وحدة داخلية لم تمرر سندًا (تجريبي)'}));
  assert.deepEqual([anonymous.deduction_basis,anonymous.consent_pending],['consent',true]);
  // (هـ) ما سبق الترحيل 133 يبقى يعمل: حركة قديمة بلا سند تُقرأ «legacy» وتُعتمد كما كانت. تُحاكى بحذف صف سندها عبر إسقاط قادحي الحفظ ثم إعادتهما.
  const legacy=tx(()=>proposeAdjustment(db,users.hr,{...base,amount:'5.00',deduction_basis:'social_insurance',deduction_reference:'اشتراك تجريبي'}));
  db.exec('DROP TRIGGER payroll_deduction_basis_no_delete');db.prepare('DELETE FROM payroll_deduction_basis WHERE adjustment_id=?').run(legacy.id);
  db.exec("CREATE TRIGGER payroll_deduction_basis_no_delete BEFORE DELETE ON payroll_deduction_basis BEGIN SELECT RAISE(ABORT,'deduction bases are retained'); END;");
  assert.throws(()=>tx(()=>decideAdjustment(db,users['hr-manager'],legacy.id,'approve',{note:'اعتماد بلا سند'})),code('deduction_basis_missing'),'an unknown path with no basis row is stopped and told what to record');
  db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,recorded_by,created_at) VALUES(?,'36t','legacy','اقتُرحت قبل اشتراط سند م51 (الترحيل 133)؛ تبقى كما كانت','hr',?)").run(legacy.id,now());
  tx(()=>decideAdjustment(db,users['hr-manager'],legacy.id,'approve',{note:'اعتماد حركة سبقت اشتراط السند'}));
  assert.ok(verifyAudit(db));
});
