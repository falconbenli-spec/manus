import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { proposeTimer, adoptTimer, retireTimer, timersBoard, adoptedTimerRows, clockStart, CLOCK_RULE } from '../app/workflow-timers.mjs';
import { sweepReturned, returnedByMe } from '../app/returned-requests.mjs';
import { sweepApprovals, stuckApprovals } from '../app/step-escalation.mjs';
import { backdate } from './escalation-equivalence.scenario.mjs';
import { workingDaysBetween, riyadhDate, holidaySet } from '../app/work-calendar.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract, acceptedPolicy } from '../app/hr-contracts.mjs';
import { RULE_DRAFT, RAMADAN_1448 } from '../app/attendance-policy.mjs';
import { ramadanPolicyDraft } from '../app/attendance-rules.mjs';
import { overtimeToPayroll } from '../app/attendance-extras.mjs';
import { decideAdjustment, proposeAdjustment, myDeductionConsents, CONSENT_ROUTE } from '../app/payroll-extras.mjs';
import { payrollUI } from '../app/static/payroll-ui.mjs';
import { creditLegacy, unsettledTimeOff } from '../app/leave-compensatory.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes } from '../app/leave-types.mjs';
import { weekOrder, eidShift, statutoryHolidayPlan, statutoryHolidayPlanWithNotes, proposeStatutoryHolidays, holidayWorkdays, holidayWorkdaysAt, holidayPlanOptions } from '../app/leave-types.mjs';

// الجولة الثانية من مراجعة الموجة الثانية على النسخة الموقعة (22 سبتمبر 2026): كل اختبار هنا يعيد إنتاج ملاحظة مراجع كما كانت تفشل على
// f46d093 ثم يثبّت التصحيح عند سببه. كل ما هنا مصطنع.
const DAY=86400000,BASIS='قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار بداية الساعة';
function timerFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-round-2-timers');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id),row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const act=(who,rid,action,note='')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const raise=(c,who='employee')=>{const d=wf.catalog(db,user('admin')).find(s=>s.code===c);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));act(who,r.id,'submit');return r.id;};
  const adopt=(key,value)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    return tx(()=>adoptTimer(db,user('vp-growth'),board.timers.find(x=>x.key===key).proposed.id,{note:''}));};
  const retire=key=>tx(()=>retireTimer(db,user('vp-growth'),adoptedTimerRows(db,'36t')[key].id,{reason:'إيقاف تجريبي للمهلة في الاختبار'}));
  const returnedAgo=(days,who='outsider')=>{const rid=raise('HR-LETTER',who);act('manager',rid,'return','ينقصه اسم الجهة كاملًا');
    const at=new Date(Date.now()-days*DAY).toISOString();backdate(db,rid,at);
    const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='decision_immutable'").get().sql;
    db.exec('DROP TRIGGER decision_immutable');db.prepare("UPDATE approval_steps SET decided_at=? WHERE request_id=? AND status='returned'").run(at,rid);db.exec(trigger);return rid;};
  // تبنٍّ مؤرَّخ: القادح يمنع تحريك adopted_at في الإنتاج؛ يُرفع للتأريخ ثم يُعاد كما هو (كما يُفعل مع decision_immutable أعلاه).
  const adoptedAgo=(key,days)=>{const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='workflow_timer_lifecycle_only'").get().sql;
    db.exec('DROP TRIGGER workflow_timer_lifecycle_only');db.prepare("UPDATE workflow_timer_settings SET adopted_at=? WHERE timer_key=? AND status='adopted'").run(new Date(Date.now()-days*DAY).toISOString(),key);db.exec(trigger);};
  const sweep=at=>tx(()=>sweepReturned(db,'36t',user('admin'),undefined,at));
  const after=(from,n)=>{const holidays=holidaySet(db,'36t');let at=from;while(workingDaysBetween(riyadhDate(from),riyadhDate(at),holidays)<n)at+=DAY;return at;};
  return {db,tx,user,row,raise,adopt,retire,returnedAgo,adoptedAgo,sweep,after};
}

test('timers: replacing an adopted number with a new one does not restart the clock — the counted days stay anchored to the first unbroken adoption, the stuck board keeps the late step, and a retired-then-readopted timer starts afresh',t=>{
  const {db,tx,user,row,raise,adopt,retire,returnedAgo,adoptedAgo,sweep,after}=timerFixture(t);
  // (أ) خطوة وصلت قبل عشرة أيام ومهلة تصعيد تُبنيت قبل عشرين: متأخرة. استبدال الرقم اليوم كان يخفيها من اللوحة ويؤجل نقلها ثلاثة أيام عمل.
  adopt('approval_escalation',2);adoptedAgo('approval_escalation',20);
  const first=adoptedTimerRows(db,'36t').approval_escalation;
  const late=raise('HR-LETTER');backdate(db,late,new Date(Date.now()-10*DAY).toISOString());
  assert.equal(stuckApprovals(db,user('admin')).rows.length,1);
  adopt('approval_escalation',3);
  const second=adoptedTimerRows(db,'36t').approval_escalation;
  assert.notEqual(second.id,first.id);assert.equal(second.value,3);
  assert.equal(second.clock_from,first.adopted_at,'the clock is anchored to the first adoption of the unbroken chain');
  assert.equal(clockStart(row(late).created_at,second),row(late).created_at,'an event after the first adoption is counted from the event');
  assert.equal(stuckApprovals(db,user('admin')).rows.length,1,'still late on the board');
  assert.deepEqual(tx(()=>sweepApprovals(db,'36t',user('admin'))).timeout,{escalated:1,blocked:0});
  const moved=db.prepare('SELECT reason FROM approval_step_escalations WHERE request_id=?').get(late);
  assert.doesNotMatch(moved.reason,/المعدود من تبني المهلة/,'counted equals waited: nothing was re-anchored');
  // الشاشة تقول من أين تُعدّ، وأنها لم تتحرك مع استبدال الرقم.
  const board=timersBoard(db,user('admin')),line=board.timers.find(x=>x.key==='approval_escalation');
  assert.equal(line.adopted.clock_from,first.adopted_at);assert.match(line.effect,/استبدال الرقم لا يعيد العدّ/);assert.match(CLOCK_RULE,/استبدال الرقم برقم لا يعيد العدّ/);
  // (ب) طلب أُعيد بعد التبني الأول وذُكِّر صاحبه؛ استبدال مهلة الانقضاء لا يؤجل انقضاءه.
  adopt('returned_reminder_first',2);adopt('returned_expiry',6);adoptedAgo('returned_reminder_first',20);adoptedAgo('returned_expiry',20);
  const returnedAt=Date.now()-10*DAY,rid=returnedAgo(10);
  // المهلة تُعدّ بأيام العمل، وكان التشغيل هنا مؤرَّخًا بفارق تقويمي ثابت (قبل سبعة أيام). فإن صادف «اليوم»
  // أحدًا أو سبتًا وقع الفارق كلّه على عطلة الجمعة والسبت، فلم يمرّ إلا يوم عمل واحد ولم يقع التذكير:
  // اختبارٌ يسقط يومين من كل سبعة بلا أن يتغيّر سطر واحد من الكود. after() تتقدّم بأيام العمل نفسها.
  assert.equal(sweep(after(returnedAt,2)).reminded_first,1);
  adopt('returned_expiry',5);
  const lapse=sweep(Date.now());
  assert.equal(lapse.lapsed,1);assert.equal(row(rid).status,'cancelled');
  const lapsed=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.lapsed'").get(rid).after_json);
  assert.equal(lapsed.counted_days,lapsed.waited_days);assert.equal(lapsed.clock_started_at,undefined,'no re-anchoring recorded');
  // (ج) إيقاف المهلة بلا بديل يقطع السلسلة: ما يُتبنى بعده يبدأ من تبنيه، فخطوة قديمة لا تُنقل يوم التبني الجديد.
  retire('approval_escalation');
  const older=raise('HR-LETTER');backdate(db,older,new Date(Date.now()-10*DAY).toISOString());
  adopt('approval_escalation',2);
  const fresh=adoptedTimerRows(db,'36t').approval_escalation;
  assert.equal(fresh.clock_from,fresh.adopted_at,'the chain was broken by the retirement');
  assert.equal(stuckApprovals(db,user('admin')).rows.length,0);
  assert.deepEqual(tx(()=>sweepApprovals(db,'36t',user('admin'))).timeout,{escalated:0,blocked:0});
  const then=after(Date.now(),2);t.mock.method(Date,'now',()=>then);
  // بعد يومي عمل من التبني الجديد تُنقل (والطلب الأول قد يصعد درجة ثانية في التشغيل نفسه، فلا يُعدّ عليه).
  assert.ok(tx(()=>sweepApprovals(db,'36t',user('admin'))).timeout.escalated>=1);
  t.mock.restoreAll();
  assert.ok(db.prepare('SELECT 1 FROM approval_step_escalations WHERE request_id=?').get(older),'moved two working days after the fresh adoption, not on its day');
  // و«أعدتُها وتنتظر» تقرأ العدّ نفسه.
  const back=returnedAgo(3);
  assert.match(returnedByMe(db,user('manager')).find(x=>x.id===back).lapse_note,/ينقضي عند 5 يوم عمل/);
  assert.ok(verifyAudit(db));
});

// ── الموارد البشرية: سياسات ساعات عمل معتمدة بأيام مختلفة، وعقد، ورواتب (كما في tests/signed-regulation-2.test.mjs) ──
function hrFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-round-2-hr');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=fn=>transaction(db,fn);
  for(const capability of ['hr.policy.accept','hr.attendance.approve','hr.contracts.approve','payroll.approve'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية التجريبي (DEC16)'}));
  const policy=(kind,parameters,{effective='2020-01-01',title=`سياسة تجريبية ${kind}`}={})=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from:effective,parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة المصطنعة'}));return id;};
  const workingTime=(parameters,options)=>policy('working_time',parameters,{title:'ساعات عمل تجريبية',...options});
  return {db,users,tx,policy,workingTime};
}
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(`${date}T00:00:00Z`).getUTCDay();
const nextWeekday=(from,wd)=>{let d=from;while(weekday(d)!==wd)d=addDays(d,1);return d;};

test('م84(1)–(2) (ص 29): the working week is read in calendar order from the working days themselves — a Saturday–Wednesday week starts on Saturday — and a split week gets a note beside the plan instead of a wrong row',t=>{
  // (أ) السبت–الأربعاء (الراحة الخميس والجمعة، م73(1) تجيزه): كان الترتيب الرقمي يجعل «ثاني أيام العمل» الاثنين.
  const satWed=[6,0,1,2,3];
  assert.deepEqual([weekOrder(satWed).first,weekOrder(satWed).second,weekOrder(satWed).last,weekOrder(satWed).before_last],[6,0,3,2]);
  assert.deepEqual([weekday('2026-03-21'),weekday('2026-03-22')],[6,0]);
  assert.deepEqual(eidShift({start:'2026-03-22',end:'2026-03-25',workdays:satWed}),[{date:'2026-03-21',rule:'start'}],'Eid starting Sunday, the true second working day, brings Saturday in');
  assert.deepEqual(eidShift({start:'2026-03-23',end:'2026-03-26',workdays:satWed}),[],'Monday is the third working day: no shift, no invented paid day');
  assert.deepEqual(eidShift({start:'2026-03-21',end:'2026-03-24',workdays:satWed}),[{date:'2026-03-25',rule:'end'}],'ending Tuesday, the day before the last working day, brings Wednesday in');
  // الأسبوعان المألوفان كما كانا.
  assert.deepEqual([weekOrder([0,1,2,3,4]).second,weekOrder([0,1,2,3,4]).before_last],[1,3]);
  assert.deepEqual([weekOrder([1,2,3,4,5]).first,weekOrder([1,2,3,4,5]).second,weekOrder([1,2,3,4,5]).last,weekOrder([1,2,3,4,5]).before_last],[1,2,5,4]);
  assert.deepEqual([weekOrder([0,1,2,3,4,5]).first,weekOrder([0,1,2,3,4,5]).before_last],[0,4],'a six-day week');
  // (ب) أيام مقطّعة أو سبعة أيام أو يوم واحد: لا ترتيب، لا صف، وبيان بجوار الخطة يسمّي من يقرر.
  assert.equal(weekOrder([0,1,3,4]),null);assert.equal(weekOrder([0,1,2,3,4,5,6]),null);assert.equal(weekOrder([2]),null);
  assert.deepEqual(eidShift({start:'2026-03-23',end:'2026-03-26',workdays:[0,1,3,4]}),[]);
  const split=statutoryHolidayPlanWithNotes(2026,{eid_al_fitr_start:'2026-03-23',workdays:[0,1,3,4],source_ar:'أيام عمل مقطّعة للاختبار'});
  assert.equal(split.items.filter(h=>h.kind==='shift').length,0);
  const note=split.notes.find(n=>n.kind==='shift_undetermined');
  assert.ok(note&&note.key==='eid_al_fitr');assert.match(note.name,/ليست كتلة متصلة واحدة/);assert.match(note.basis,/م84\(4\)/);assert.match(note.basis,/مدير الموارد البشرية/);
  assert.equal(statutoryHolidayPlanWithNotes(2026,{eid_al_fitr_start:'2026-03-23'}).notes.some(n=>n.kind==='shift_undetermined'),false,'a contiguous week has no such note');
  // (ج) من السياسة المعتمدة إلى الاقتراح: أسبوع السبت–الأربعاء، عيد يبدأ الأحد → يُقترح السبت قبله «تقديم بداية»؛ وأسبوع مقطّع → البيان في skipped.
  const {db,users,tx,workingTime}=hrFixture(t);
  workingTime({workdays:satWed,start:'09:00',end:'17:00',grace_minutes:30});
  const year=new Date().getUTCFullYear()+1,sunday=nextWeekday(`${year}-06-01`,0);
  const proposed=tx(()=>proposeStatutoryHolidays(db,users.hr,{year,eid_al_adha_start:sunday}));
  assert.ok(proposed.proposed>=5);
  const row=db.prepare("SELECT name,basis FROM public_holidays WHERE tenant_id='36t' AND holiday_date=? AND status='proposed'").get(addDays(sunday,-1));
  assert.ok(row,'Saturday before the Eid is proposed');assert.match(row.name,/تقديم بداية إجازة عيد الأضحى \(م84\(1\)\)/);assert.match(row.basis,/ساعات عمل تجريبية/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_holidays WHERE tenant_id='36t' AND holiday_date=? AND status='proposed'").get(addDays(sunday,-2)).n,0,'Friday is rest in this week, never a shift day');
  workingTime({workdays:[0,1,3,4],start:'09:00',end:'17:00',grace_minutes:30},{effective:`${year+1}-01-01`,title:'أيام عمل مقطّعة تجريبية'});
  const later=tx(()=>proposeStatutoryHolidays(db,users.hr,{year:year+1,eid_al_adha_start:nextWeekday(`${year+1}-06-01`,1)}));
  assert.ok(later.skipped.some(x=>/لم يُحسبا/.test(x.reason)),'the proposer is told the shift could not be computed and who decides it');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_holidays WHERE tenant_id='36t' AND holiday_date LIKE ? AND name LIKE '%م84%'").get(`${year+1}-%`).n,0);
  assert.ok(verifyAudit(db));
});

test('م81 with م73(1): the rest days of each holiday come from the working-time policy in force on ITS date — a rest-day change accepted mid-year does not add an Eid compensation day, and the basis names the policy that applied',t=>{
  const {db,users,tx,workingTime}=hrFixture(t);
  workingTime({workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30},{title:'ساعات عمل من 2020 راحة الجمعة والسبت'});
  workingTime({workdays:[1,2,3,4,5],start:'09:00',end:'17:00',grace_minutes:30},{effective:'2028-07-01',title:'ساعات عمل من يوليو 2028 راحة السبت والأحد'});
  assert.deepEqual([weekday('2028-09-27'),weekday('2028-09-30'),weekday('2028-09-23')],[3,6,6]);
  assert.deepEqual(holidayWorkdays(db,'36t',2028).workdays,[0,1,2,3,4],'the year-level reading is still January’s policy');
  assert.deepEqual(holidayWorkdaysAt(db,'36t','2028-09-27').workdays,[1,2,3,4,5]);assert.equal(holidayWorkdaysAt(db,'36t','2019-01-01'),null);
  // عيد أضحى مصطنع 27–30 سبتمبر 2028: بسياسة يناير يومان في الراحة (الجمعة والسبت) فيومان تعويض؛ بالسياسة السارية في تاريخه يوم واحد (السبت).
  const january=statutoryHolidayPlan(2028,{eid_al_adha_start:'2028-09-27',...holidayWorkdays(db,'36t',2028)});
  assert.deepEqual(january.filter(h=>h.key==='eid_al_adha'&&h.kind==='compensation').map(h=>h.date),['2028-10-01','2028-10-02']);
  const plan=statutoryHolidayPlanWithNotes(2028,{eid_al_adha_start:'2028-09-27',...holidayPlanOptions(db,'36t',2028)});
  const comp=plan.items.filter(h=>h.key==='eid_al_adha'&&h.kind==='compensation');
  assert.deepEqual(comp.map(h=>h.date),['2028-10-02'],'only Saturday 30 September is rest under the policy in force');
  assert.ok(comp.every(h=>h.basis.includes('راحة السبت والأحد')&&h.basis.includes('السارية في 2028-09-27')),'the basis names the policy that applied on the Eid date');
  // اليوم الوطني (السبت 23 سبتمبر 2028): راحة في السياستين؛ بالسياسة السارية يومها الأحد راحة أيضًا فيُعوَّض بالجمعة قبله، لا بالأحد.
  assert.deepEqual(plan.items.filter(h=>h.key==='national_day').map(h=>[h.kind,h.date]),[['compensation','2028-09-22'],['holiday','2028-09-23']]);
  // يوم التأسيس (الثلاثاء 22 فبراير 2028) قبل السياسة الثانية: يوم عمل في سياسة يناير، لا تعويض.
  assert.deepEqual(plan.items.filter(h=>h.key==='founding_day').map(h=>h.kind),['holiday']);
  assert.equal(plan.notes.length,0);
  // الاقتراح والشاشة يقرآن الطريق نفسه، والمعتمد لا يجد يوم 1 أكتوبر مقترحًا.
  const proposed=tx(()=>proposeStatutoryHolidays(db,users.hr,{year:2028,eid_al_adha_start:'2028-09-27'}));
  assert.ok(proposed.proposed>=6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_holidays WHERE tenant_id='36t' AND holiday_date='2028-10-01'").get().n,0);
  assert.ok(db.prepare("SELECT basis FROM public_holidays WHERE tenant_id='36t' AND holiday_date='2028-10-02'").get().basis.includes('راحة السبت والأحد'));
  assert.ok(verifyAudit(db));
});

// ── م77(6): باب الدفع نقدًا عند انتهاء الخدمة — حالاته الحدّية التي وجدها المراجع ──
function cashOutFixture(t,basic='6000.00'){
  const f=hrFixture(t),{db,users,tx,policy}=f;
  policy('working_time',{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30,overtime:RULE_DRAFT.overtime});
  policy('pay_components',{components:['basic','housing','transport']});
  const contractId=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد تجريبي لا وجود له'})).id;
  const step=(by,action,extra={})=>tx(()=>contractAction(db,users[by],contractId,action,{version:getContract(db,users[by],contractId).version,...extra}));
  step('hr','submit_contract');step('hr-manager','approve_contract');
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
  // صف بشكل ما قبل الترحيل 125: «وقت راحة» معتمد بلا قيد رصيد.
  const uncredited=(id,daysAgo,minutes,user='employee',compensation='time_off')=>{let d=addDays(today,-daysAgo);while(weekday(d)>4)d=addDays(d,-1);const stamp=now();
    db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,decided_by,decided_at,decision_note,created_at,retroactive,compensation,consent_at,day_type) VALUES(?,'36t',?,?,?,'ساعات مصطنعة اعتُمدت قبل دفتر الأرصدة','approved','manager',?,'اعتماد سابق',?,1,?,?,'working')").run(id,user,d,minutes,stamp,stamp,compensation,compensation==='time_off'?stamp:null);return d;};
  return {...f,step,today,uncredited,month:today.slice(0,7)};
}

test('م77(6) (ص 27): hours already cashed out at end of service are refused a ledger credit with a written reason, never a crash; the annual cap of م77(5) warns the payroll approver on the cash-out door as it does on the ledger door; and an employee with no contract is told the contract is what is missing',t=>{
  const {db,users,tx,policy,step,uncredited,month}=cashOutFixture(t,'10.00');
  const lt=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2020-01-01'})).id;tx(()=>decideLeaveTypes(db,users['hr-manager'],lt,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد في الاختبار'}));
  uncredited('ot-7',10,60);uncredited('ot-3',7,60);uncredited('ot-4',14,480);
  step('hr-manager','end_contract',{ended_on:addDays(new Date(Date.now()+3*3600000).toISOString().slice(0,10),0),reason:'انتهاء خدمة تجريبي لاختبار م77(6)'});
  // (أ) دُفعت نقدًا ثم طُلب قيدها رصيدًا من الواجهة: رفض مكتوب يسمّي الحركة، لا TypeError.
  const paid=tx(()=>overtimeToPayroll(db,users.hr,'ot-7',{month}));
  assert.throws(()=>tx(()=>creditLegacy(db,users['hr-manager'],'ot-7',{note:'محاولة قيد بعد الدفع من الواجهة'})),error=>error.code==='already_paid'&&/م77\(6\)/.test(error.message)&&/مقترحة لشهر/.test(error.message));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compensatory_credits').get().n,0);
  tx(()=>decideAdjustment(db,users['hr-manager'],paid.adjustment_id,'reject',{note:'رفض تجريبي لإعادة فتح الباب'}));
  assert.ok(tx(()=>creditLegacy(db,users['hr-manager'],'ot-7',{note:'قيد بعد رفض حركة الدفع في المسير'})).id,'a rejected cash-out reopens the credit door');
  // (ب) الأساسي 10 ريالات فالسقف السنوي 60: ساعة واحدة (8.40 ريال) داخله، وثماني ساعات (67.17) تتجاوزه. الباب العادي يرفض بم77(5)، وباب انتهاء الخدمة يمرّر بتنبيه في سبب الحركة كما يفعل طريق الدفتر.
  const first=tx(()=>overtimeToPayroll(db,users.hr,'ot-3',{month}));
  const second=tx(()=>overtimeToPayroll(db,users.hr,'ot-4',{month}));
  const reason=db.prepare('SELECT reason FROM payroll_adjustments WHERE id=?').get(second.adjustment_id).reason;
  assert.match(reason,/تنبيه لمعتمد الرواتب/);assert.match(reason,/م77\(5\)/);assert.match(reason,/م77\(6\)/);
  assert.doesNotMatch(db.prepare('SELECT reason FROM payroll_adjustments WHERE id=?').get(first.adjustment_id).reason,/تنبيه لمعتمد الرواتب/,'the first one is within the cap');
  const event=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE action='overtime.to_payroll' AND entity_id='employee' ORDER BY seq DESC LIMIT 1").get().after_json);
  assert.deepEqual([event.article,event.over_company_cap],['م77(6)',true]);
  assert.deepEqual(unsettledTimeOff(db,'36t','employee').filter(x=>x.state==='uncredited').map(x=>x.id),[],'no uncredited hours of the leaver are left without a door (ot-7 was credited after its cash-out was rejected, and waits in the payout queue)');
  // الباب العادي لمن خدمته قائمة يبقى على سقفه: عقد جديد لموظف آخر بأساسي 10 وساعات اختير لها الأجر.
  const otherContract=tx(()=>prepareContract(db,users.hr,{user_id:'outsider',contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'10.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد تجريبي ثانٍ لا وجود له'})).id;
  const other=(by,action)=>tx(()=>contractAction(db,users[by],otherContract,action,{version:getContract(db,users[by],otherContract).version}));other('hr','submit_contract');other('hr-manager','approve_contract');
  uncredited('ot-8',7,60,'outsider','pay');uncredited('ot-9',14,480,'outsider','pay');
  tx(()=>overtimeToPayroll(db,users.hr,'ot-8',{month}));
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,'ot-9',{month})),error=>error.code==='annual_cap');
  // (ج) موظف بلا عقد مسجل أصلًا: لا يُقال «خدمته قائمة»؛ يُسمّى العقد الناقص ومالكه.
  uncredited('ot-6',3,120,'it');
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,'ot-6',{month})),error=>error.code==='time_off_chosen'&&!/خدمته قائمة/.test(error.message)&&/لا عقد له مسجل/.test(error.message)
    &&error.details.refusal.missing.some(m=>m.owner_role==='hr.contracts.manage'&&/عقد عمل/.test(m.document))&&/العقود والسياسات/.test(error.details.refusal.next));
  uncredited('ot-10',3,60,'outsider');
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,'ot-10',{month})),error=>error.code==='time_off_chosen'&&/خدمته قائمة/.test(error.message));
  assert.ok(verifyAudit(db));
});

test('م51 (ص 19): a consent carried in by another module is accepted only under the wage owner’s own identity — refused before writing and blocked by the schema on INSERT (migration 135) as it already was on UPDATE — and the consent-pending refusal says what a 404 on the worker’s button means',t=>{
  const {db,users,tx,policy}=hrFixture(t);
  policy('pay_components',{components:['basic','housing','transport']});
  const contractId=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'6000.00'}],document_reference:'عقد تجريبي لا وجود له'})).id;
  const step=(by,action)=>tx(()=>contractAction(db,users[by],contractId,action,{version:getContract(db,users[by],contractId).version}));step('hr','submit_contract');step('hr-manager','approve_contract');
  const base={user_id:'employee',kind:'deduction',month:'2026-12',amount:'80.00',reason:'خصم مصطنع بموافقة منقولة من وحدة داخلية لاختبار م51'};
  const carried=by=>({basis:{kind:'consent',reference:'طلب مزايا مصطنع رقم 9',consent_text:'أقر بموافقتي (نص مصطنع)',consent_by:by,consent_at:now()}});
  // (أ) موافقة منقولة باسم غير صاحب الأجر: رفض يسمّي من وُقّعت باسمه ومن يملكها، ولا صف يُكتب.
  assert.throws(()=>tx(()=>proposeAdjustment(db,users.hr,base,carried('outsider'))),error=>error.code==='consent_owner'&&error.details.refusal.missing[0].owner_role==='employee'&&/لا يوافق أحد عن العامل/.test(error.message));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payroll_adjustments WHERE kind='deduction'").get().n,0,'a refused proposal writes nothing');
  // (ب) بهوية صاحب الأجر نفسه (كما يمرر باب المزايا): تمر بلا تعليق وتُعتمد.
  const own=tx(()=>proposeAdjustment(db,users.hr,base,carried('employee')));
  assert.deepEqual([own.deduction_basis,own.consent_pending],['consent',false]);
  tx(()=>decideAdjustment(db,users['hr-manager'],own.id,'approve',{note:'اعتماد بموافقة العامل المنقولة بهويته'}));
  // (ج) القاعدة نفسها تحرس الإدخال المباشر كما تحرس التعديل: الترحيل 135 مطبَّق وقادحه قائم.
  // رُقّم 135 لا 134 لأن فرع الخيارات المُدارة أخذ 134 قبل دمج هذا الفرع، ورقمان متساويان لا يجتمعان في schema_migrations.
  // ويُسأل عن وجوده لا عن كونه الأحدث: شرط «الأحدث» يكسر الاختبار مع أول ترحيل بعده بلا أن يكون شيء قد انكسر.
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=135').get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='payroll_deduction_basis_consent_owner_insert'").get());
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,status,proposed_by,created_at) VALUES('adj-raw','36t','employee','deduction','2026-12',1000,'حركة مصطنعة بلا سند لاختبار القادح','proposed','hr',?)").run(now());
  assert.throws(()=>db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,consent_text,consent_by,consent_at,recorded_by,created_at) VALUES('adj-raw','36t','consent','','نص','outsider',?,'hr',?)").run(now(),now()),/nobody consents for him/);
  db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,consent_text,consent_by,consent_at,recorded_by,created_at) VALUES('adj-raw','36t','consent','','نص','employee',?,'hr',?)").run(now(),now());
  // (د) الملصق الصادق: الرفض للمعتمد والملاحظة للعامل يسمّيان مسار زر الموافقة نفسه. كان المسار غير موصول فقالا ماذا يعني 404؛
  // الحزمة 4 (P4-HR-2، 1 أكتوبر 2026) وصلته في app/server.mjs، فصار الملصق الصادق ألّا يذكر 404 ولا «فريق الخادم» بعد الآن.
  const pending=tx(()=>proposeAdjustment(db,users.hr,{...base,amount:'10.00',deduction_basis:'consent'}));
  assert.throws(()=>tx(()=>decideAdjustment(db,users['hr-manager'],pending.id,'approve',{note:'محاولة اعتماد قبل الموافقة'})),error=>error.code==='consent_required'&&error.details.refusal.next.includes(CONSENT_ROUTE)&&!/404/.test(error.details.refusal.next)&&!/فريق الخادم/.test(error.details.refusal.next));
  assert.ok(myDeductionConsents(db,users.employee).find(d=>d.id===pending.id).note.includes(CONSENT_ROUTE));
  assert.match(payrollUI.form('consent_deduction',pending.id,{deduction_consents:myDeductionConsents(db,users.employee)}).endpoint,/\/payroll\/adjustments\/.+\/consent$/,'the button posts to the very route the note names');
  assert.ok(verifyAudit(db));
});

// ── م73(2) وم74(2): أساس مسودة رمضان ونافذتها — ملاحظتا المراجع: اختبار متقلقل بتعادل في acceptedPolicy، ونافذة مكتوبة قيمةً وموصوفة «لم يُتحقق منها» ──
test('acceptedPolicy: two versions with the same effective date accepted in the same millisecond resolve to the later-prepared one, then to the later row — never to whichever row the scan met first (the tie that made the Ramadan draft test flaky)',t=>{
  const {db}=hrFixture(t);
  // صفان مقبولان بتاريخ سريان واحد ولحظة قرار واحدة (كما يحدث حين يُقبلان في الملّي ثانية نفسها): كان ORDER BY بلا فاصل تعادل فيعود أيهما التقاه المسح — الأول المُدخَل.
  const ins=db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES(?,'36t','working_time',?,'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',?,'سند مصطنع للاختبار','2020-01-01','accepted','hr','hr-manager',?,?)");
  const decided='2026-09-22T20:00:00.000Z',params=workdays=>JSON.stringify({workdays,start:'08:00',end:'16:00',grace_minutes:15});
  ins.run('seven-days','سبعة أيام تجريبية',params([0,1,2,3,4,5,6]),decided,'2026-09-22T19:00:00.000Z');
  ins.run('five-days','خمسة أيام تجريبية',params([0,1,2,3,4]),decided,'2026-09-22T19:05:00.000Z');
  assert.equal(acceptedPolicy(db,'36t','working_time','2026-09-23').id,'five-days','the later-prepared version wins the tie');
  assert.deepEqual(ramadanPolicyDraft(db,'36t','2026-09-23').workdays,[0,1,2,3,4],'and the Ramadan draft copies that base, so 5 × 6 = 30 hours passes م74(2) every run');
  // تعادل كامل حتى في created_at: الصف الأحدث، وهو ثابت لا يتبدل بين قراءتين.
  ins.run('five-days-later-row','خمسة أيام تجريبية — صف لاحق',params([1,2,3,4,5]),decided,'2026-09-22T19:05:00.000Z');
  for(let i=0;i<20;i++)assert.equal(acceptedPolicy(db,'36t','working_time','2026-09-23').id,'five-days-later-row','deterministic across reads');
  // والفاصل لا يقلب الترتيب الأصلي: صف أحدث إعدادًا وقرارًا بتاريخ سريان أقدم لا يغلب — تاريخ السريان أولًا ثم لحظة القرار كما كانا.
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('older-effective','36t','working_time','تاريخ سريان أقدم تجريبي','نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',?,'سند مصطنع للاختبار','2019-01-01','accepted','hr','hr-manager','2026-09-23T08:00:00.000Z','2026-09-23T07:00:00.000Z')").run(params([0,1,2,3]));
  assert.equal(acceptedPolicy(db,'36t','working_time','2026-09-23').id,'five-days-later-row');
});

test('م73(2) وم74(2): the Ramadan 1448 window is verified against the Umm al-Qura table embedded in ICU (islamic-umalqura, generated from the KACST tables) and the constant names that table among its sources — the window stays provisional until the sighting',t=>{
  // تقويم أم القرى جدولي: جدول ICU/CLDR له هو ما تعرض به الأجهزة التاريخ الهجري في السعودية، ومنه يُقرأ 1 رمضان و29 رمضان و1 شوال 1448هـ.
  const hijri=date=>{const parts=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura',{timeZone:'UTC',day:'numeric',month:'numeric',year:'numeric'}).formatToParts(new Date(`${date}T00:00:00Z`));
    return ['year','month','day'].map(k=>Number(parts.find(p=>p.type===k).value));};
  assert.deepEqual(hijri(RAMADAN_1448.from),[1448,9,1],'1 Ramadan 1448');
  assert.deepEqual(hijri(RAMADAN_1448.to),[1448,9,29],'29 Ramadan 1448');
  assert.deepEqual(hijri(addDays(RAMADAN_1448.to,1)),[1448,10,1],'the table gives Ramadan 1448 twenty-nine days; a thirtieth is for the sighting to add, as the note says');
  assert.deepEqual([weekday(RAMADAN_1448.from),weekday(RAMADAN_1448.to)],[1,1],'Monday to Monday');
  assert.ok(RAMADAN_1448.sources.some(s=>/islamic-umalqura/.test(s)),'the sources name the table the window was checked against, so the draft’s basis carries it to the HR manager');
  assert.equal(RAMADAN_1448.provisional,true);assert.match(RAMADAN_1448.note,/الرؤية/);assert.match(RAMADAN_1448.note,/9 مارس 2027/);
});
