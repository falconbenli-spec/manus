import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { createLeaveRequest, leaveAction, listLeave } from '../app/leave.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar, leavePolicies } from '../app/leave-types.mjs';
import { requestOvertime, decideOvertime, overtimeToPayroll, attendanceExtras } from '../app/attendance-extras.mjs';
import { compensatoryToPayroll, creditLegacy, lotsOf, settlementCompensatoryGate, COMPENSATORY_LEGAL } from '../app/leave-compensatory.mjs';
import { prepareRun, runAction, getRun } from '../app/payroll.mjs';
import { preRunChecks } from '../app/payroll-checks.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { proposeAdjustment, decideAdjustment, prepareSettlement, decideSettlement } from '../app/payroll-extras.mjs';
import { runDailyReminders } from '../app/reminders.mjs';
import { inbox } from '../app/inbox.mjs';
import { compensatoryConsentSentence, compensatoryLeaveMinutes, overtimeMinutesBack } from '../app/static/leave-count.mjs';
import { RULE_DRAFT } from '../app/attendance-policy.mjs';
import { attendanceBoard } from '../app/attendance.mjs';
import { rulesBoard } from '../app/attendance-rules.mjs';
import { attendanceUI } from '../app/static/attendance-ui.mjs';
import { leaveUI, leavePreview } from '../app/static/leave-ui.mjs';
import { kit } from '../app/static/kit.mjs';

// الإجازة التعويضية عن العمل الإضافي (ترحيل 125): موافقة الموظف، القيد عند الاعتماد، الاستهلاك من الأقدم أجلًا، ولا شيء يسقط.
// كل البيانات مصطنعة «تجريبي». التواريخ نسبية إلى اليوم لأن طلب العمل الإضافي لا يُقبل إلا لليوم أو لثلاثين يومًا مضت.
const code=expected=>error=>error.code===expected;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
// أيام عمل ماضية (الأحد–الخميس) من الأقدم إلى الأحدث، كلها داخل نافذة الثلاثين يومًا.
function pastWorkdays(count,from=1){const out=[];for(let d=addDays(today(),-from);out.length<count;d=addDays(d,-1))if(weekday(d)<=4)out.push(d);return out.reverse();}
const nextWorkday=(from,skip=0)=>{let d=from,left=skip;for(;;d=addDays(d,1))if(weekday(d)<=4){if(!left--)return d;}};
const BASE={workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30};

function fixture(t,{workingTime=true,leavePolicy=true,draft={}}={}){
  const db=openDb(':memory:');seed(db,'synthetic-compensatory');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  for(const capability of ['hr.policy.accept','hr.attendance.approve','hr.contracts.approve','payroll.approve','people.manage'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مالك الاعتماد في الاختبار التجريبي'}));
  const policy=(kind,parameters,effective_from='2020-01-01')=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة تجريبية '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'سند مصطنع للاختبار',effective_from,parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'قبلت السياسة التجريبية'}));return id;};
  const workingTimeId=workingTime?policy('working_time',{...BASE,overtime:RULE_DRAFT.overtime}):null;
  policy('pay_components',{components:['basic','housing','transport']});
  const contract=(who='employee')=>{
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id:who,contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد تجريبي لا وجود له'}));
    const step=(by,action)=>tx(()=>contractAction(db,users[by],id,action,{version:getContract(db,users[by],id).version}));step('hr','submit_contract');step('hr-manager','approve_contract');return id;
  };
  const contractId=contract();
  let policyId=null;
  if(leavePolicy){
    policyId=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2020-01-01',...draft})).id;
    tx(()=>decideLeaveTypes(db,users['hr-manager'],policyId,'accept',{note:'راجعت الأنواع ومواد النظام واللائحة قبل الاعتماد'}));
  }
  for(const year of new Set([today().slice(0,4),addDays(today(),120).slice(0,4)]))tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:'creative',name:`تقويم إجازات تجريبي ${year}`,effective_from:`${year}-01-01`,effective_to:`${year}-12-31`,weekdays:[0,1,2,3,4]}));
  const overtime=(date,minutes,extra={})=>tx(()=>requestOvertime(db,users.employee,{work_date:date,minutes,reason:'طلب العميل تعديلًا عاجلًا بعد نهاية الدوام (تجريبي)',...extra}));
  const asLeave=(date,minutes)=>overtime(date,minutes,{compensation:'time_off',consent:true});
  const approve=id=>tx(()=>decideOvertime(db,users.manager,id,'approve',{note:'أكدت الحاجة'}));
  const ask=input=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'compensatory',balance_year:Number(input.start_date.slice(0,4)),reason:'إجازة تعويضية تجريبية',...input}));
  const act=(who,r,action,input={})=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع',...input}));
  const balance=()=>listLeave(db,users.employee).statutory.balances.find(b=>b.code==='compensatory');
  return {db,users,tx,policy,policyId,workingTimeId,contractId,overtime,asLeave,approve,ask,act,balance};
}

test('compensatory: the hour arithmetic never rounds against the worker and the consent sentence states amount and deadline',()=>{
  assert.equal(compensatoryLeaveMinutes(60,15000),90);assert.equal(compensatoryLeaveMinutes(15,15000),23,'22.5 minutes is rounded up: the text says «not less than»');
  assert.equal(compensatoryLeaveMinutes(60,20000),120);
  const credit={overtime_minutes:60,leave_minutes:90,ratio_bp:15000};
  assert.equal(overtimeMinutesBack(90,credit),60,'a whole credit goes back to exactly the overtime worked');
  assert.equal(overtimeMinutesBack(45,credit),30);assert.equal(overtimeMinutesBack(1,credit),1);
  assert.equal(overtimeMinutesBack(23,{overtime_minutes:15,leave_minutes:23,ratio_bp:15000}),15);
  const sentence=compensatoryConsentSentence({work_date:'2026-09-01',overtime_minutes:120,ratio_bp:15000,use_within_days:60});
  assert.match(sentence,/أوافق باختياري/);assert.match(sentence,/3 ساعة/);assert.match(sentence,/2026-10-31/);assert.match(sentence,/م107\/1/);assert.match(sentence,/م22 مكرر/);
});

test('compensatory: policy v3 carries the ratio, the deadline and the cap with their articles, and refuses a ratio below the legal floor',t=>{
  const {db,users,tx,policyId}=fixture(t);
  const view=leavePolicies(db,users.hr).find(p=>p.id===policyId);
  assert.equal(view.version,3);
  assert.deepEqual([view.compensatory.ratio_bp,view.compensatory.use_within_days,view.compensatory.annual_cap_days,view.compensatory.warn_days],[15000,60,30,14]);
  assert.ok(view.compensatory.articles.some(a=>a.includes('م22 مكرر')));
  const type=view.types.find(x=>x.code==='compensatory');
  assert.equal(type.half_day,true);assert.match(type.source_name,/عمل إضافي/);assert.ok(type.law_articles.includes('نظام العمل م107/1'));assert.ok(type.open.length>=4,'what the regulation leaves unsaid is a question, not a value');
  assert.equal(view.legal_basis.checked_on,'2026-09-21');assert.ok(view.legal_basis.sources.every(s=>s.url.startsWith('https://')));
  assert.ok(view.law_gaps.some(g=>g.key==='nursing_hour'&&/غير متاح/.test(g.state_ar)),'a statutory right the platform has not built is shown as not available, not hidden');
  // الحد الأدنى النظامي في التحقق: لا مسودة بنسبة دون ساعة ونصف ولا بمهلة فوق ستين يومًا.
  const generous=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2030-01-01',compensatory_ratio_bp:20000,compensatory_use_within_days:45})).id;
  assert.deepEqual([leavePolicies(db,users.hr).find(p=>p.id===generous).compensatory.ratio,leavePolicies(db,users.hr).find(p=>p.id===generous).compensatory.use_within_days],['2',45],'above the floor and inside the deadline is the company\'s choice');
  tx(()=>decideLeaveTypes(db,users['hr-manager'],generous,'reject',{note:'مسودة تجريبية تُرفض لإفساح المجال لغيرها'}));
  assert.throws(()=>tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2030-01-01',compensatory_ratio_bp:COMPENSATORY_LEGAL.min_ratio_bp-1})),error=>error.code==='compensatory_ratio'&&/م22 مكرر\/1/.test(error.message)&&!!error.details?.refusal);
  assert.throws(()=>tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2030-01-01',compensatory_ratio_bp:10000})),code('compensatory_ratio'));
  assert.throws(()=>tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2030-01-01',compensatory_use_within_days:61})),code('compensatory_use_within_days'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_type_policies WHERE status='draft'").get().n,0,'a refused draft writes nothing');
  assert.equal(verifyAudit(db),true);
});

test('compensatory: consent is the employee\'s alone, explicit, recorded with its sentence, and immutable',t=>{
  const {db,users,tx,overtime,asLeave,approve}=fixture(t),[d1,d2]=pastWorkdays(2);
  // الأجر هو الافتراض ولا يتغير فيه شيء.
  const paid=overtime(d1,60);
  assert.equal(db.prepare('SELECT compensation,consent_at FROM overtime_requests WHERE id=?').get(paid.id).compensation,'pay');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM overtime_compensation_consents').get().n,0);
  // اختيار الإجازة بلا موافقة صريحة مرفوض، والرفض يعرض الجملة التي يُطلب الموافقة عليها.
  assert.throws(()=>overtime(d2,120,{compensation:'time_off'}),error=>error.code==='consent_required'&&/أوافق باختياري/.test(error.message)&&/3 ساعة/.test(error.message));
  assert.throws(()=>overtime(d2,120,{compensation:'time_off',consent:false}),code('consent_required'));
  assert.throws(()=>overtime(d2,120,{compensation:'time_off',consent:'yes'}),code('consent'));
  const chosen=asLeave(d2,120),consent=db.prepare('SELECT * FROM overtime_compensation_consents WHERE overtime_request_id=?').get(chosen.id),row=db.prepare('SELECT * FROM overtime_requests WHERE id=?').get(chosen.id);
  assert.equal(consent.user_id,'employee');assert.equal(consent.consent_at,row.consent_at);assert.equal(consent.leave_minutes,180);assert.equal(consent.ratio_bp,15000);assert.equal(consent.use_within_days,60);
  assert.equal(consent.sentence,compensatoryConsentSentence({work_date:d2,overtime_minutes:120,ratio_bp:15000,use_within_days:60}),'what is stored is what was shown');
  // لا أحد يغيّر الاختيار بعد تسجيله، لا قبل القرار ولا بعده، ولا يكتب أحد موافقة عن غيره.
  assert.throws(()=>db.prepare("UPDATE overtime_requests SET compensation='pay',consent_at=NULL WHERE id=?").run(chosen.id),/never rewritten/);
  assert.throws(()=>db.prepare("UPDATE overtime_requests SET compensation='time_off',consent_at=? WHERE id=?").run(now(),paid.id),/never rewritten/);
  assert.throws(()=>db.prepare('UPDATE overtime_compensation_consents SET leave_minutes=1 WHERE overtime_request_id=?').run(chosen.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM overtime_compensation_consents').run(),/retained/);
  assert.throws(()=>db.prepare('INSERT INTO overtime_compensation_consents(overtime_request_id,tenant_id,user_id,consent_at,policy_id,ratio_bp,use_within_days,overtime_minutes,leave_minutes,sentence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(paid.id,'36t','manager',now(),consent.policy_id,15000,60,60,90,'موافقة يكتبها المدير عن الموظف، ولا يصح أن تُقبل في أي حال.',now()),/belongs to the employee/);
  approve(chosen.id);
  assert.throws(()=>db.prepare("UPDATE overtime_requests SET compensation='pay',consent_at=NULL WHERE id=?").run(chosen.id),/never rewritten|final/);
  const audit=db.prepare("SELECT actor_id,after_json FROM audit_events WHERE action='compensatory.consent_recorded'").get();
  assert.equal(audit.actor_id,'employee');assert.equal(JSON.parse(audit.after_json).leave_minutes,180);
  assert.equal(verifyAudit(db),true);
});

test('compensatory: approval credits hours × the accepted ratio with the deadline counted from the work date, once',t=>{
  const {db,users,asLeave,approve,balance}=fixture(t,{draft:{compensatory_ratio_bp:20000,compensatory_use_within_days:45}}),[d1]=pastWorkdays(1);
  const o=asLeave(d1,120);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compensatory_credits').get().n,0,'a pending request credits nothing');
  approve(o.id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();
  assert.deepEqual([credit.user_id,credit.work_date,credit.overtime_minutes,credit.ratio_bp,credit.leave_minutes,credit.expires_on,credit.credited_by,credit.legacy],['employee',d1,120,20000,240,addDays(d1,45),'manager',0]);
  assert.throws(()=>db.prepare('UPDATE compensatory_credits SET leave_minutes=1').run(),/append only/);assert.throws(()=>db.prepare('DELETE FROM compensatory_credits').run(),/append only/);
  assert.throws(()=>db.prepare('INSERT INTO compensatory_credits(id,tenant_id,user_id,overtime_request_id,work_date,overtime_minutes,ratio_bp,leave_minutes,expires_on,policy_id,credited_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    // مُشغِّل «مرة واحدة» (الترحيل 125) يسبق فهرس UNIQUE ويرفض بالاسم، ويرفض كذلك ما يتسلل بـINSERT OR REPLACE.
    .run('forged','36t','employee',o.id,d1,120,20000,240,addDays(d1,45),credit.policy_id,'manager','قيد ثانٍ للطلب نفسه',now()),/append only|UNIQUE/);
  assert.throws(()=>db.prepare('INSERT OR REPLACE INTO compensatory_credits(id,tenant_id,user_id,overtime_request_id,work_date,overtime_minutes,ratio_bp,leave_minutes,expires_on,policy_id,credited_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(credit.id,'36t','employee',o.id,d1,120,20000,999,addDays(d1,45),credit.policy_id,'manager','إعادة كتابة قيد مسجَّل',now()),/append only/,'REPLACE does not fire the delete trigger; the insert guard catches it');
  assert.equal(db.prepare('SELECT leave_minutes FROM compensatory_credits WHERE id=?').get(credit.id).leave_minutes,240);
  const b=balance();
  assert.equal(b.source,'overtime');assert.equal(b.compensatory.available_hours,'4');assert.equal(b.compensatory.available_days,'0.5');assert.equal(b.available_days,'0.5');
  assert.deepEqual(b.compensatory.lots.map(l=>[l.work_date,l.leave_hours,l.remaining_hours,l.expires_on,l.ratio]),[[d1,'4','4',addDays(d1,45),'2']]);
  assert.match(db.prepare("SELECT body FROM notifications WHERE user_id='employee' AND kind='overtime_approved'").get().body,/قُيِّد لك 4 ساعة إجازة/);
  assert.equal(attendanceExtras(db,users.employee).time_off_minutes,240,'the attendance tile reads the live ledger, not an all-time sum');
  assert.equal(verifyAudit(db),true);
});

test('compensatory: leave-compensated overtime never reaches payroll as overtime pay, by either door',t=>{
  const {db,users,tx,overtime,asLeave,approve}=fixture(t),[d1,d2]=pastWorkdays(2);
  const chosen=asLeave(d1,60);approve(chosen.id);
  // الباب المرتبط: رفض مكتوب يقول لماذا وما الطريق.
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,chosen.id,{month:d1.slice(0,7),amount:'10.00',basis:'محاولة دفع ساعات عُوِّضت بإجازة'})),
    error=>error.code==='time_off_chosen'&&error.status===409&&!!error.details?.refusal?.next&&/لا تُعوَّض مرتين/.test(error.message));
  assert.deepEqual(attendanceExtras(db,users.hr).overtime.find(o=>o.id===chosen.id).actions,[],'the action is not even offered');
  // الباب اليدوي: حركة «عمل إضافي» مكتوبة باليد للشهر نفسه.
  assert.throws(()=>tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'overtime',month:d1.slice(0,7),amount:'45.00',reason:'عمل إضافي يدوي عن الشهر نفسه (تجريبي)'})),
    error=>error.code==='compensated_by_leave'&&/أرصدة تعويضية مستحقة الصرف/.test(error.message));
  // وقاعدة البيانات نفسها: لا حركة مسير تُربط بطلب اختير له الإجازة.
  const bonus=tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'bonus',month:d1.slice(0,7),amount:'45.00',reason:'مكافأة تجريبية لا علاقة لها بالساعات'}));
  assert.throws(()=>db.prepare('UPDATE overtime_requests SET adjustment_id=? WHERE id=?').run(bonus.id,chosen.id),/not paid as well/);
  // ما اختير له الأجر يبقى طريقه المرتبط مفتوحًا في الشهر نفسه.
  const paid=overtime(d2,60);approve(paid.id);
  const linked=tx(()=>overtimeToPayroll(db,users.hr,paid.id,{month:d2.slice(0,7)}));
  assert.equal(db.prepare('SELECT status,kind FROM payroll_adjustments WHERE id=?').get(linked.adjustment_id).kind,'overtime');
  assert.equal(verifyAudit(db),true);
});

test('compensatory: leave is consumed from the oldest credit first, in half days too, and cancelling returns the hours to the same credits',t=>{
  const {db,asLeave,approve,ask,act,balance}=fixture(t),[d1,d2,d3]=pastWorkdays(3);
  // ثلاثة قيود: 4.5 و4.5 و3 ساعات = 12 ساعة = يوم ونصف.
  for(const [date,minutes] of [[d1,180],[d2,180],[d3,120]])approve(asLeave(date,minutes).id);
  const lots=()=>balance().compensatory.lots.map(l=>[l.work_date,l.remaining_hours,l.reserved_hours,l.used_hours]);
  assert.deepEqual(lots(),[[d1,'4.5','0','0'],[d2,'4.5','0','0'],[d3,'3','0','0']]);
  assert.equal(balance().compensatory.available_days,'1.5');
  const day=nextWorkday(addDays(today(),1)),half=nextWorkday(addDays(day,1));
  assert.throws(()=>ask({start_date:day,end_date:nextWorkday(addDays(day,1))}),error=>error.code==='insufficient_balance'&&/12 ساعة/.test(error.message)&&/16 ساعة/.test(error.message));
  const full=ask({start_date:day,end_date:day});
  assert.equal(full.terms.source,'overtime');assert.match(full.terms.source_name,/عمل إضافي/);assert.equal(full.days,1);
  assert.deepEqual(lots(),[[d1,'0','4.5','0'],[d2,'1','3.5','0'],[d3,'3','0','0']],'8 hours: the oldest credit whole, then 3.5 from the next');
  const halfDay=ask({start_date:half,end_date:half,half_day:true});
  assert.equal(halfDay.days,0.5);
  assert.deepEqual(lots(),[[d1,'0','4.5','0'],[d2,'0','4.5','0'],[d3,'0','3','0']]);
  assert.equal(balance().available_days,'0');
  // الاعتماد النهائي يحوّل الحجز خصمًا على القيود نفسها.
  const approved=act('hr',act('manager',full,'approve'),'approve');
  assert.equal(approved.status,'approved');
  assert.deepEqual(lots(),[[d1,'0','0','4.5'],[d2,'0','1','3.5'],[d3,'0','3','0']]);
  assert.match(db.prepare("SELECT body FROM notifications WHERE user_id='employee' AND kind='leave_approved' ORDER BY created_at DESC LIMIT 1").get().body,/خُصم 1 يوم عمل من رصيد الإجازة التعويضية/);
  assert.deepEqual(approved.pay_effects,[],'full pay: no deduction is proposed');
  // رفض نصف اليوم يحرر حجزه، وإلغاء المعتمد قبل بدايته يرد ساعاته، كلٌّ إلى قيده.
  act('manager',halfDay,'reject',{note:'رفض تجريبي لاختبار تحرير الحجز'});
  assert.deepEqual(lots(),[[d1,'0','0','4.5'],[d2,'1','0','3.5'],[d3,'3','0','0']]);
  act('employee',approved,'cancel',{note:'إلغاء تجريبي قبل بداية الإجازة'});
  assert.deepEqual(lots(),[[d1,'4.5','0','0'],[d2,'4.5','0','0'],[d3,'3','0','0']],'every hour is back where it came from');
  const kinds=db.prepare('SELECT kind,COUNT(*) AS n FROM compensatory_movements GROUP BY kind ORDER BY kind').all().map(r=>`${r.kind}:${r.n}`);
  assert.deepEqual(kinds,['debit:2','refund:2','release:2','reserve:4']);
  const move=db.prepare('SELECT daily_minutes,working_time_policy_id FROM compensatory_movements LIMIT 1').get();
  assert.equal(move.daily_minutes,480,'the conversion basis is recorded on the movement');assert.ok(move.working_time_policy_id);
  assert.throws(()=>db.prepare('UPDATE compensatory_movements SET reserved_minutes=0').run(),/append only/);assert.throws(()=>db.prepare('DELETE FROM compensatory_movements').run(),/append only/);
  assert.equal(verifyAudit(db),true);
});

test('compensatory: without an accepted working-time policy the type refuses and names that policy and its owner — no assumed eight hours',t=>{
  const {db,users,tx,policy,ask,balance,overtime}=fixture(t,{workingTime:false}),[d1]=pastWorkdays(1);
  // بلا ساعات يوم معتمدة لا يُقبل اختيار الإجازة أصلًا: لا يُقاس الرصيد بالأيام ولا سقفه السنوي.
  assert.throws(()=>overtime(d1,60,{compensation:'time_off',consent:true}),error=>error.code==='working_time_policy_required'&&error.details.refusal.missing[0].doc_key==='working_time'&&/مدير الموارد البشرية/.test(error.details.refusal.missing[0].owner));
  assert.equal(attendanceExtras(db,users.employee).compensation_offer.available,false);
  const b=balance();
  assert.equal(b.available_days,null,'not measurable, never a fake zero');assert.match(b.note,/غير قابلة للقياس/);assert.equal(b.compensatory.available_hours,'0');
  const day=nextWorkday(addDays(today(),1));
  assert.throws(()=>ask({start_date:day,end_date:day}),error=>error.code==='working_time_policy_required'&&error.status===409&&/ساعات العمل والحضور/.test(error.message)&&error.details.refusal.link==='#attendance');
  // تُعتمد السياسة فيُفتح الطريق، واليوم ما فيها (6 ساعات هنا) لا ثمانٍ مفترضة.
  policy('working_time',{...BASE,overtime:{...RULE_DRAFT.overtime,hour_divisor_hours:6}});
  const o=overtime(d1,120,{compensation:'time_off',consent:true});tx(()=>decideOvertime(db,users.manager,o.id,'approve',{note:'أكدت الحاجة'}));
  assert.equal(balance().compensatory.available_days,'0.5','3 leave hours are half of a six-hour day');assert.equal(balance().compensatory.daily_hours,'6');
  assert.equal(ask({start_date:day,end_date:day,half_day:true}).days,0.5);
  assert.equal(db.prepare('SELECT daily_minutes FROM compensatory_movements').get().daily_minutes,360);
});

test('compensatory: an accepted version-2 policy keeps reading exactly as before — no compensatory type, no choice, nothing invented',t=>{
  const {db,users,tx,overtime}=fixture(t,{leavePolicy:false}),[d1]=pastWorkdays(1);
  // سياسة بشكل الإصدار 2 كما كانت تُكتب قبل هذا العمل: بلا law_articles ولا كتلة compensatory ولا الأنواع الجديدة.
  const v3=JSON.parse(db.prepare("SELECT parameters FROM leave_type_policies WHERE id=?").get(tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2031-01-01'})).id).parameters);
  const legacyTypes=v3.types.filter(x=>!['hajj','iddah_ext_pregnant','compensatory'].includes(x.code)).map(({law_articles,law_note_ar,...rest})=>rest);
  db.prepare("INSERT INTO leave_type_policies(id,tenant_id,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,decision_note,created_at) VALUES('policy-v2','36t','أنواع الإجازات (إصدار 2 تجريبي)','سياسة مصطنعة بشكل الإصدار الثاني لاختبار القراءة القديمة.',?,'لائحة تنظيم العمل (تجريبي)','2020-01-01','accepted','hr','hr-manager',?,'اعتماد تجريبي سابق',?)")
    .run(JSON.stringify({version:2,types:legacyTypes,public_holidays:v3.public_holidays,unpaid_leave:v3.unpaid_leave}),now(),now());
  const view=leavePolicies(db,users.hr).find(p=>p.id==='policy-v2');
  assert.equal(view.version,2);assert.equal(view.compensatory,null);assert.equal(view.legal_basis,null);assert.deepEqual(view.law_gaps,[]);
  assert.equal(view.types.length,15);assert.ok(view.types.every(x=>Array.isArray(x.law_articles)&&!x.law_articles.length&&x.articles_text.startsWith('م')));
  assert.equal(view.unpaid_leave.threshold_days,20);
  const statutory=listLeave(db,users.employee).statutory;
  assert.equal(statutory.policy_id,'policy-v2');assert.equal(statutory.balances.some(b=>b.code==='compensatory'),false);assert.equal(statutory.balances.length,15);
  const day=nextWorkday(addDays(today(),1));
  assert.throws(()=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'compensatory',balance_year:Number(day.slice(0,4)),start_date:day,end_date:day,reason:'نوع ليس في السياسة القديمة'})),code('leave_type_unknown'));
  assert.throws(()=>tx(()=>createLeaveRequest(db,users.employee,{leave_type:'hajj',balance_year:Number(day.slice(0,4)),start_date:day,end_date:addDays(day,9),declaration:true,reason:'نوع ليس في السياسة القديمة'})),code('leave_type_unknown'));
  // نوع قديم يعمل كما كان.
  const emergency=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'emergency',balance_year:Number(day.slice(0,4)),start_date:day,end_date:day,half_day:true,reason:'طارئة تجريبية بسياسة الإصدار 2'}));
  assert.equal(emergency.days,0.5);assert.equal(emergency.terms.source,'entitlement');
  // واختيار الإجازة بدل الأجر غير متاح حتى تُعتمد سياسة فيها النوع: رفض يسمّي السياسة ومالكها، والأجر يعمل.
  assert.throws(()=>overtime(d1,60,{compensation:'time_off',consent:true}),error=>error.code==='compensatory_policy_required'&&error.details.refusal.missing[0].doc_key==='leave_types');
  assert.equal(attendanceExtras(db,users.employee).compensation_offer.available,false);
  assert.ok(overtime(d1,60).id);
});

test('compensatory: a credit past its deadline is raised by the daily sweep, proposed as overtime pay by a human, and nothing is ever deleted',t=>{
  const {db,users,tx,asLeave,approve,balance}=fixture(t),[d1]=pastWorkdays(1);
  approve(asLeave(d1,120).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get(),count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  // قبل المهلة بأربعة عشر يومًا: تنبيه لصاحب الرصيد، مرة واحدة.
  const warnDay=addDays(credit.expires_on,-14);
  assert.equal(runDailyReminders(db,'36t',addDays(warnDay,-1)).compensatory.warned,0);
  assert.deepEqual(runDailyReminders(db,'36t',warnDay).compensatory,{warned:1,raised:0,due:0,untaken:0});
  assert.equal(runDailyReminders(db,'36t',addDays(warnDay,1)).compensatory.warned,0,'one warning per credit');
  assert.match(db.prepare("SELECT title FROM notifications WHERE user_id='employee' AND kind='compensatory_expiring'").get().title,/3 ساعة/);
  // قبل انقضاء المهلة لا يُحال شيء: الرصيد ما زال إجازة ممكنة.
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{})),code('compensatory_not_due'));
  // بعد المهلة: المسح يرفعه إلى مُعد الرواتب ويخبر صاحبه، ولا يكتب حركة راتب ولا يحذف شيئًا.
  const after=addDays(credit.expires_on,1),before={credits:count('compensatory_credits'),adjustments:count('payroll_adjustments')};
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${after}T09:00:00+03:00`)});
  assert.deepEqual(runDailyReminders(db,'36t',after).compensatory,{warned:0,raised:1,due:1,untaken:0});
  assert.deepEqual({credits:count('compensatory_credits'),adjustments:count('payroll_adjustments')},before,'the queue never proposes money (jobs rules 1–2) and never deletes');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='hr' AND kind='compensatory_payout_needed'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employee' AND kind='compensatory_due'").get().n,1);
  assert.equal(runDailyReminders(db,'36t',addDays(after,1)).compensatory.raised,0,'raised once; it stays in the queue until a human acts');
  const lot=balance().compensatory.lots[0];
  assert.equal(lot.state,'due');assert.equal(lot.remaining_hours,'3');assert.equal(balance().compensatory.available_hours,'0','expired hours are no longer leave — and are still shown');
  // الطابور يظهر لمُعد الرواتب في الحضور وفي صندوق «بانتظار قراري»، ولا يظهر لصاحب الرصيد ولا لغير حامل التصريح.
  const queue=attendanceExtras(db,users.hr).compensatory_payouts;
  // القراءتان أمام مُعد الرواتب، والمقترح أكبرهما: أجر الإجازة المستحقة 3 × 8,000/240 = 100.00، وأجر الساعتين الأصليتين بمعادلة السياسة 91.67.
  assert.deepEqual(queue.map(q=>[q.id,q.cause,q.remaining_hours,q.overtime_hours,q.leave_wage,q.overtime_wage,q.suggested,q.reading,q.actions]),[[credit.id,'expired','3','2','100.00','91.67','100.00','leave_wage',['compensatory_to_payroll']]]);
  assert.deepEqual(attendanceExtras(db,users.employee).compensatory_payouts,[]);assert.deepEqual(attendanceExtras(db,users.manager).compensatory_payouts,[]);
  const item=inbox(db,users.hr).groups.find(g=>g.key==='attendance')?.items.find(i=>i.id===credit.id);
  assert.ok(item,'nothing new is invisible: the payout queue reaches the inbox');assert.deepEqual(item.actions,['إحالة رصيد تعويضي إلى المسير']);assert.equal(item.kind,'رصيد تعويضي مستحق الصرف');
  // الإحالة: فعل إنسان يحمل تصريح إعداد الرواتب، بالمعادلة المقبولة، وتبقى «مقترحة» حتى يعتمدها معتمد الرواتب.
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.manager,credit.id,{})),code('not_permitted'));
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{amount:'500.00'})),code('basis_required'));
  const out=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(out.adjustment_id);
  assert.deepEqual([adjustment.kind,adjustment.status,adjustment.amount_minor,adjustment.user_id,adjustment.proposed_by],['overtime','proposed',10000,'employee','hr'],'never below either reading: the leave wage (100.00) is the greater of the two');
  assert.match(adjustment.reason,/يقابل 2 ساعة عمل إضافي/);assert.match(adjustment.reason,/أجر الإجازة المستحقة 100\.00 ريال/);assert.match(adjustment.reason,/أجر الساعات الإضافية الأصلية 91\.67 ريال/);assert.match(adjustment.reason,/اللائحة التنفيذية ساكتة/);assert.equal(out.overtime_minutes,120);
  assert.equal(balance().compensatory.lots[0].state,'in_payroll');assert.deepEqual(attendanceExtras(db,users.hr).compensatory_payouts,[]);
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{})),code('compensatory_not_due'),'the same hours are not proposed twice');
  // معتمد الرواتب يرفض الحركة: الساعات تعود مستحقة ولا تضيع.
  tx(()=>decideAdjustment(db,users['hr-manager'],out.adjustment_id,'reject',{note:'رفض تجريبي لاختبار عودة الساعات مستحقة'}));
  assert.equal(attendanceExtras(db,users.hr).compensatory_payouts.length,1);
  const again=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.equal(tx(()=>decideAdjustment(db,users['hr-manager'],again.adjustment_id,'approve',{note:'اعتماد'})).status,'approved');
  assert.equal(count('compensatory_payouts'),2);assert.throws(()=>db.prepare('DELETE FROM compensatory_payouts').run(),/append only/);
  assert.equal(verifyAudit(db),true);
});

test('compensatory: when the employee leaves, the unused hours block the settlement until they are proposed as overtime pay',t=>{
  const {db,users,tx,contractId,asLeave,approve}=fixture(t),[d1]=pastWorkdays(1);
  approve(asLeave(d1,60).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();
  assert.equal(settlementCompensatoryGate(db,'36t','outsider'),null);
  assert.deepEqual(settlementCompensatoryGate(db,'36t','employee'),{minutes:90,hours:'1.5',lots:1,untaken:[],routable_minutes:90,routable_hours:'1.5',unroutable:[]});
  // سياسة نهاية خدمة وقاعدة مخالصة مقبولتان (بقراءة م36/2 صريحة): بدونهما يُرفض الاعتماد لسبب آخر ولا تُختبر البوابة.
  const eos={wage_base:['basic'],first_years:5,first_rate_bp:5000,later_rate_bp:10000,reason_factors_bp:{employer_termination:10000,contract_expiry:10000,other:10000,resignation:10000},
    resignation_tiers:[{min_years:0,factor_bp:0},{min_years:2,factor_bp:3333},{min_years:5,factor_bp:6667},{min_years:10,factor_bp:10000}]};
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('eos','36t','end_of_service','سياسة نهاية خدمة تجريبية','نص سياسة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.',?,'سند تجريبي','2019-01-01','accepted','hr','hr-manager',?,?)").run(JSON.stringify(eos),now(),now());
  tx(()=>decideRule(db,users['hr-manager'],'reg-seed-settlement','accept',{effective_from:'2019-01-01',choices:{art36_reading:'labor_law'},note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
  tx(()=>contractAction(db,users['hr-manager'],contractId,'end_contract',{version:getContract(db,users['hr-manager'],contractId).version,ended_on:today(),reason:'انتهاء خدمة تجريبي لاختبار صرف الرصيد التعويضي'}));
  // المهلة لم تنقض لكن الخدمة انتهت: الرصيد لم يعد إجازة ممكنة، فيصير مستحق الصرف ويُرفع إلى مُعد الرواتب.
  const lot=lotsOf(db,'36t','employee')[0];
  assert.equal(lot.state,'service_ended');assert.equal(lot.due,true);assert.ok(lot.expires_on>today());
  assert.equal(attendanceExtras(db,users.hr).compensatory_payouts[0].cause,'service_ended');
  assert.deepEqual(runDailyReminders(db,'36t',today()).compensatory,{warned:0,raised:1,due:1,untaken:0});
  const settlement=tx(()=>prepareSettlement(db,users.hr,{contract_id:contractId,end_reason:'employer_termination',leave_days:0,evidence:'مستند إنهاء خدمة تجريبي لا وجود له ورصيد إجازة صفر'}));
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'محاولة اعتماد قبل إحالة الرصيد التعويضي'})),
    error=>error.code==='compensatory_unpaid'&&/1\.5 ساعة/.test(error.message)&&error.details.refusal.missing[0].owner==='مُعد الرواتب'&&/م22 مكرر\/4/.test(error.details.refusal.missing[0].why));
  assert.equal(db.prepare('SELECT status FROM service_settlements WHERE id=?').get(settlement.id).status,'draft');
  const out=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.equal(db.prepare('SELECT cause FROM compensatory_payouts WHERE id=?').get(out.id).cause,'service_ended');
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(out.adjustment_id);
  assert.deepEqual([adjustment.kind,adjustment.status,adjustment.amount_minor],['overtime','proposed',5000],'the wage of the due leave (1.5 h × 8,000/240 = 50.00), not the lower overtime formula (45.83)');
  assert.match(adjustment.reason,/انتهت خدمة صاحبه/);assert.match(adjustment.reason,/م22 مكرر\/4/);
  assert.equal(settlementCompensatoryGate(db,'36t','employee'),null);
  // البوابة التعويضية انفتحت؛ ما بقي هو بوابة إخلاء الطرف القائمة (لا حزمة مغادرة في هذا الاختبار)، لا هذه.
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'اعتماد بعد إحالة الرصيد التعويضي'})),code('clearance_open'));
  assert.equal(verifyAudit(db),true);
});

test('compensatory: the yearly cap is measured when the choice is made, and what exceeds it stays payable as overtime',t=>{
  const {db,users,tx,overtime,policyId}=fixture(t),date=today(),earlier=pastWorkdays(1)[0];
  if(earlier.slice(0,4)!==date.slice(0,4))return t.skip('no earlier working day in the same calendar year');
  // 30 يومًا × 8 ساعات = 14400 دقيقة. طلب مصطنع سابق في السنة نفسها وافق صاحبه على 14350 دقيقة إجازة (لا يُبلغ ذلك بطلبات حقيقية في اختبار).
  const stamp=now();
  db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,created_at,retroactive,compensation,consent_at) VALUES('ot-near-cap','36t','employee',?,720,'ساعات مصطنعة لاختبار السقف السنوي','pending',?,1,'time_off',?)").run(earlier,stamp,stamp);
  db.prepare("INSERT INTO overtime_compensation_consents(overtime_request_id,tenant_id,user_id,consent_at,policy_id,ratio_bp,use_within_days,overtime_minutes,leave_minutes,sentence,created_at) VALUES('ot-near-cap','36t','employee',?,?,15000,60,720,14350,'موافقة مصطنعة لاختبار السقف السنوي للإجازة التعويضية فقط.',?)").run(stamp,policyId,stamp);
  assert.throws(()=>overtime(date,60,{compensation:'time_off',consent:true}),error=>error.code==='compensatory_annual_cap'&&/30 يومًا/.test(error.message)&&/م22 مكرر\/3/.test(error.message)&&/اختر «أجر»/.test(error.message));
  // ما دون السقف يُقبل، والأجر متاح دائمًا لما زاد.
  const small=overtime(date,15,{compensation:'time_off',consent:true});
  assert.equal(db.prepare('SELECT leave_minutes FROM overtime_compensation_consents WHERE overtime_request_id=?').get(small.id).leave_minutes,23);
  tx(()=>decideOvertime(db,users.manager,small.id,'reject',{note:'رفض تجريبي لإخلاء اليوم لطلب آخر'}));
  assert.ok(overtime(date,60).id,'pay is always available for what exceeds the cap');
});

test('compensatory: overtime approved as time off before the ledger existed is credited by a human, not lost',t=>{
  const {db,users,tx,balance}=fixture(t),[d1]=pastWorkdays(1),stamp=now();
  // صف بشكل ما قبل الترحيل 125: اختيار «وقت راحة» معتمد بلا موافقة مسجلة نصًا ولا قيد رصيد.
  db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,decided_by,decided_at,decision_note,created_at,retroactive,compensation,consent_at) VALUES('ot-legacy','36t','employee',?,60,'ساعات مصطنعة اعتُمدت قبل دفتر الأرصدة','approved','manager',?,'اعتماد سابق',?,1,'time_off',?)").run(d1,stamp,stamp,stamp);
  assert.equal(balance().compensatory.available_hours,'0');
  const queue=attendanceExtras(db,users['hr-manager']).compensatory_uncredited;
  assert.deepEqual(queue.map(q=>[q.id,q.hours,q.actions]),[['ot-legacy','1',['credit_compensatory']]]);
  assert.deepEqual(attendanceExtras(db,users.employee).compensatory_uncredited,[]);
  assert.ok(inbox(db,users['hr-manager']).groups.find(g=>g.key==='attendance')?.items.some(i=>i.id==='ot-legacy'&&i.actions.includes('قيد رصيد تعويضي')));
  assert.throws(()=>tx(()=>creditLegacy(db,users.manager,'ot-legacy',{note:'محاولة بلا تصريح اعتماد الحضور'})),code('not_permitted'));
  const credit=tx(()=>creditLegacy(db,users['hr-manager'],'ot-legacy',{note:'قُيِّد بالسياسة المعتمدة اليوم (اختبار تجريبي)'}));
  assert.equal(credit.leave_minutes,90);assert.equal(credit.expires_on,addDays(d1,60));
  assert.equal(db.prepare('SELECT legacy FROM compensatory_credits WHERE id=?').get(credit.id).legacy,1);
  assert.throws(()=>tx(()=>creditLegacy(db,users['hr-manager'],'ot-legacy',{note:'قيد ثانٍ للطلب نفسه لا يصح'})),code('already_credited'));
  assert.equal(balance().compensatory.available_hours,'1.5');assert.deepEqual(attendanceExtras(db,users['hr-manager']).compensatory_uncredited,[]);
  assert.equal(verifyAudit(db),true);
});

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const helpers={e:esc,ui:kit(esc),button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${esc(label)}</button>`};
const attendanceData=(db,u)=>({...attendanceBoard(db,u),extras:attendanceExtras(db,u),rules:rulesBoard(db,u)});

// ── ما أثبتته المراجعة المستقلة (22 سبتمبر 2026): كل اختبار هنا يفشل على الشيفرة قبل الإصلاح ──
const EOS={wage_base:['basic'],first_years:5,first_rate_bp:5000,later_rate_bp:10000,reason_factors_bp:{employer_termination:10000,contract_expiry:10000,other:10000,resignation:10000},
  resignation_tiers:[{min_years:0,factor_bp:0},{min_years:2,factor_bp:3333},{min_years:5,factor_bp:6667},{min_years:10,factor_bp:10000}]};
const CYCLE={pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500};
function settlementReady(f){
  f.db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('eos','36t','end_of_service','سياسة نهاية خدمة تجريبية','نص سياسة تجريبي مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.',?,'سند تجريبي','2019-01-01','accepted','hr','hr-manager',?,?)").run(JSON.stringify(EOS),now(),now());
  f.tx(()=>decideRule(f.db,f.users['hr-manager'],'reg-seed-settlement','accept',{effective_from:'2019-01-01',choices:{art36_reading:'labor_law'},note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
}
const endService=(f,reason='انتهاء خدمة تجريبي لاختبار الرصيد التعويضي')=>f.tx(()=>contractAction(f.db,f.users['hr-manager'],f.contractId,'end_contract',{version:getContract(f.db,f.users['hr-manager'],f.contractId).version,ended_on:today(),reason}));
const settle=f=>f.tx(()=>prepareSettlement(f.db,f.users.hr,{contract_id:f.contractId,end_reason:'employer_termination',leave_days:0,evidence:'مستند إنهاء خدمة تجريبي لا وجود له ورصيد إجازة صفر'}));
const runStep=(f,who,runId,action,input={})=>f.tx(()=>runAction(f.db,f.users[who],runId,action,{version:getRun(f.db,f.users[who],runId).version,...input}));

test('compensatory review: an exit payout never goes to a month with no payroll line — a locked exit month names who reopens it, and the hours stay due',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1]=pastWorkdays(1),month=today().slice(0,7);
  f.policy('payroll_cycle',CYCLE);settlementReady(f);
  f.approve(f.asLeave(d1,180).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get(),run=tx(()=>prepareRun(db,users.hr,{month}));
  runStep(f,'hr',run.id,'submit_run');
  endService(f);
  // مسير شهر ترك العمل قيد المراجعة: كانت الحركة تُنقل إلى الشهر التالي حيث لا سطر لصاحبها، فتُعتمد ولا يدفعها مسير، والدفتر يقول «أُحيلت».
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{})),error=>error.code==='exit_month_locked'&&error.details.refusal.missing[0].owner_role==='payroll.review'&&new RegExp(`مسير ${month}`).test(error.message)&&/إلى المسودة/.test(error.details.refusal.next));
  const [y,m]=month.split('-').map(Number),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{month:next})),code('exit_month_locked'),'naming the next month by hand is no way round');
  assert.equal(lotsOf(db,'36t','employee')[0].due,true,'nothing was written: the hours are still due');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compensatory_payouts').get().n,0);
  const settlement=settle(f);
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'محاولة اعتماد والرصيد لم يُحل'})),code('compensatory_unpaid'));
  // المراجع يعيد المسير إلى المسودة: الإحالة تدخل مسير شهر ترك العمل نفسه، وإعادة الحساب تحملها على سطر صاحبها.
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'payroll.review',note:'مراجع رواتب في الاختبار التجريبي'}));
  runStep(f,'manager',run.id,'return_run',{note:'إعادة تجريبية لإدخال أجر رصيد تعويضي لمن انتهت خدمته'});
  const out=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.equal(out.month,month);assert.equal(out.suggested,'150.00','the wage of 4.5 due leave hours, not the lower 137.50');
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{month:next})),code('compensatory_not_due'));
  tx(()=>decideAdjustment(db,users['hr-manager'],out.adjustment_id,'approve',{note:'اعتماد تجريبي'}));
  runStep(f,'hr',run.id,'recalculate');
  assert.equal(getRun(db,users.hr,run.id).lines.find(l=>l.user_id==='employee').additions_minor,15000,'the approved movement is carried by a real payroll line');
  assert.equal(settlementCompensatoryGate(db,'36t','employee'),null);
  assert.equal(verifyAudit(db),true);
});

test('compensatory review: when the exit month is already approved no run can carry the pay — it is an open item on the settlement, carried by a written decision and kept with it',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1]=pastWorkdays(1),month=today().slice(0,7);
  f.policy('payroll_cycle',CYCLE);settlementReady(f);
  f.approve(f.asLeave(d1,180).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get(),run=tx(()=>prepareRun(db,users.hr,{month}));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'payroll.review',note:'مراجع رواتب في الاختبار التجريبي'}));
  runStep(f,'hr',run.id,'submit_run');runStep(f,'manager',run.id,'pass_review',{note:'مراجعة تجريبية'});runStep(f,'hr-manager',run.id,'approve_run',{note:'اعتماد تجريبي'});
  endService(f);
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{})),error=>error.code==='exit_month_paid'&&/م22 مكرر\/4/.test(error.details.refusal.missing[0].why)&&/مستحقة الصرف/.test(error.details.refusal.next));
  const gate=settlementCompensatoryGate(db,'36t','employee');
  assert.equal(gate.routable_minutes,0);assert.deepEqual(gate.unroutable.map(x=>[x.credit_id,x.leave_minutes,x.overtime_minutes,x.suggested_minor]),[[credit.id,270,180,15000]]);
  const settlement=settle(f);
  // بلا قرار مكتوب: بند مفتوح يسمّي الساعات ومبلغها المقترح. وبه: تُعتمد المخالصة ويُحفظ البند معها، والقيد يقول الحقيقة.
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'محاولة اعتماد بلا قرار في الرصيد التعويضي'})),error=>error.code==='clearance_open'&&/رصيد إجازة تعويضية 4\.5 ساعة لا مسير يحمله/.test(error.message)&&/150\.00 SAR/.test(error.message));
  const done=tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'اعتماد تجريبي للمخالصة',clearance_override:'يُصرف أجر الرصيد التعويضي 150.00 ريال مع مستحقات نهاية الخدمة في تحويل واحد، ولا حزمة مغادرة في هذا الاختبار المصطنع'}));
  assert.equal(done.status,'approved');
  const kept=JSON.parse(db.prepare('SELECT clearance_blockers FROM service_settlements WHERE id=?').get(settlement.id).clearance_blockers).find(b=>b.source==='compensatory');
  assert.deepEqual([kept.amount_minor,kept.lots[0].credit_id,kept.lots[0].leave_minutes],[15000,credit.id,270]);
  const lot=lotsOf(db,'36t','employee')[0];
  assert.deepEqual([lot.state,lot.due,lot.remaining_minutes,lot.carried_minutes],['with_settlement',false,0,270]);assert.deepEqual(attendanceExtras(db,users.hr).compensatory_payouts,[]);
  assert.equal(verifyAudit(db),true);
});

test('compensatory review: leave approved for a date after the service ended is not «used» — it blocks the settlement until it is cancelled, then its hours are paid',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1,d2]=pastWorkdays(2);
  settlementReady(f);
  f.approve(f.asLeave(d1,180).id);f.approve(f.asLeave(d2,180).id);
  const start=nextWorkday(addDays(today(),10));
  let leave=f.ask({start_date:start,end_date:start});leave=f.act('manager',leave,'approve');leave=f.act('hr',leave,'approve');
  assert.equal(leave.status,'approved');
  endService(f);
  // 8 ساعات مخصومة لإجازة لن تؤخذ: كانت البوابة لا ترى إلا الساعة الباقية، فتنفتح بعد إحالتها وتسقط الثماني في صمت.
  const gate=settlementCompensatoryGate(db,'36t','employee');
  assert.deepEqual(gate.untaken.map(x=>[x.request_id,x.minutes,x.start_date]),[[leave.id,480,start]]);assert.equal(gate.routable_minutes,60);
  const queue=attendanceExtras(db,users.hr).compensatory_payouts;
  assert.deepEqual(queue.map(q=>[q.cause,q.remaining_hours,q.actions.length]),[['service_ended','1',1],['untaken_leave','8',0]]);
  assert.equal(runDailyReminders(db,'36t',today()).compensatory.untaken,1);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='hr' AND kind='compensatory_payout_needed' AND title LIKE '%بعد انتهاء الخدمة%'").get(),'the preparer is told, once');
  const due=queue[0];tx(()=>compensatoryToPayroll(db,users.hr,due.id,{}));
  const settlement=settle(f);
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],settlement.id,'approve',{note:'محاولة اعتماد وإجازة معتمدة بعد انتهاء الخدمة'})),
    error=>error.code==='compensatory_leave_untaken'&&/8 ساعة/.test(error.message)&&error.details.refusal.missing[0].owner_role==='hr'&&/تلغي خدمات الموظف الإجازة/.test(error.details.refusal.next));
  // خدمات الموظف تلغيها: الساعات تعود إلى قيودها نفسها وتظهر مستحقة الصرف، ثم تُحال، ثم تنفتح البوابة.
  f.act('hr',leave,'cancel',{note:'انتهت خدمة صاحبها قبل موعدها (تجريبي)'});
  const again=attendanceExtras(db,users.hr).compensatory_payouts;
  assert.deepEqual(again.map(q=>q.cause),['service_ended','service_ended']);assert.equal(again.reduce((n,q)=>n+Number(q.remaining_hours),0),8);
  for(const q of again)tx(()=>compensatoryToPayroll(db,users.hr,q.id,{}));
  assert.equal(settlementCompensatoryGate(db,'36t','employee'),null);
  const lots=lotsOf(db,'36t','employee');
  assert.equal(lots.reduce((n,l)=>n+l.paid_minutes,0),540,'every credited minute is either leave taken or pay proposed');assert.equal(lots.reduce((n,l)=>n+l.used_minutes,0),0);
  assert.equal(verifyAudit(db),true);
});

test('compensatory review: a hand-written overtime movement is refused while leave-compensated hours are unsettled — next month and before approval too — and the approver sees one that came first',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1,d2]=pastWorkdays(2),month=d2.slice(0,7),[y,m]=month.split('-').map(Number),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  const manual=(target,note)=>tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'overtime',month:target,amount:'91.67',reason:note}));
  // حركة يدوية سبقت اختيار الإجازة: تُقبل (لا ساعات معوَّضة بعد)، ثم تُعرض على معتمد الساعات قبل قراره.
  const early=manual(month,'عمل إضافي يدوي سابق لاختيار الإجازة (تجريبي)');
  const chosen=f.asLeave(d2,120);
  // الطلب ما زال قائمًا: كان الباب اليدوي لا يرفض إلا بعد الاعتماد وللشهر نفسه.
  assert.throws(()=>manual(month,'عمل إضافي يدوي والطلب ما زال بانتظار الاعتماد'),error=>error.code==='compensated_by_leave'&&/بانتظار الاعتماد/.test(error.message));
  const row=attendanceExtras(db,users.manager).overtime.find(o=>o.id===chosen.id);
  assert.match(row.double_pay_warning,/حركة «عمل إضافي» يدوية غير مرتبطة/);assert.match(attendanceUI.render(attendanceData(db,users.manager),helpers),/تنبيه قبل الاعتماد/);
  const decided=f.approve(chosen.id);
  assert.match(decided.warnings[0],/لا تُعوَّض مرتين/);void early;
  // بعد الاعتماد: الشهر التالي مرفوض أيضًا — وهو الطريق المعتاد لأجر آخر الشهر.
  assert.throws(()=>manual(next,`عمل إضافي يدوي عن ${d2} يُصرف في الشهر التالي`),error=>error.code==='compensated_by_leave'&&/لم يُستعمل كله ولم يُحل/.test(error.message)&&/أرصدة تعويضية مستحقة الصرف/.test(error.message));
  assert.throws(()=>manual(month,'عمل إضافي يدوي عن الشهر نفسه'),code('compensated_by_leave'));
  // الطريق المرتبط لما اختير له الأجر يبقى مفتوحًا، والحركات الأخرى لا يمسها الباب.
  const paid=f.overtime(d1,60);f.approve(paid.id);
  assert.ok(tx(()=>overtimeToPayroll(db,users.hr,paid.id,{month:d1.slice(0,7)})).adjustment_id);
  assert.ok(tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'bonus',month:next,amount:'45.00',reason:'مكافأة تجريبية لا علاقة لها بالساعات'})).id);
  // بعد أن يُحال الرصيد كله أجرًا (انقضت مهلته) لا يبقى ما يُعوَّض مرتين، فيعود الباب اليدوي.
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${addDays(credit.expires_on,1)}T09:00:00+03:00`)});
  tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.ok(manual(addDays(credit.expires_on,1).slice(0,7),'عمل إضافي يدوي بعد تسوية الرصيد كله').id);
  assert.equal(verifyAudit(db),true);
});

test('compensatory review: hours past their deadline are not leave any more, even for a back-dated request — the payout queue does not shrink under the preparer',t=>{
  const f=fixture(t),{db,users}=f,[d1]=pastWorkdays(1);
  f.approve(f.asLeave(d1,180).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();
  let inside=addDays(credit.expires_on,-3);while(weekday(inside)>4)inside=addDays(inside,-1);
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${addDays(credit.expires_on,10)}T09:00:00+03:00`)});
  const before=attendanceExtras(db,users.hr).compensatory_payouts.map(q=>[q.id,q.remaining_hours]);
  assert.deepEqual(before,[[credit.id,'4.5']]);assert.equal(f.balance().compensatory.available_hours,'0');
  // تاريخ الإجازة قبل انقضاء المهلة واليوم بعده: كان الخادم يقبلها فيحجز 4 ساعات من رصيد أُعلن لصاحبه أنه يُحال أجرًا.
  assert.throws(()=>f.ask({start_date:inside,end_date:inside,half_day:true}),error=>error.code==='insufficient_balance'&&/هو 0 ساعة/.test(error.message)&&/4\.5 ساعة انقضت مهلتها فلم تعد إجازة/.test(error.message));
  assert.deepEqual(attendanceExtras(db,users.hr).compensatory_payouts.map(q=>[q.id,q.remaining_hours]),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM compensatory_movements').get().n,0);
});

test('compensatory review: a working-time policy accepted between reservation and approval does not debit a day at the old length — the request goes back to be reserved again',t=>{
  const f=fixture(t),{db}=f,days=pastWorkdays(3);
  for(const d of days)f.approve(f.asLeave(d,180).id);
  const start=nextWorkday(addDays(today(),5));
  let leave=f.ask({start_date:start,end_date:start});
  assert.equal(db.prepare('SELECT SUM(reserved_minutes) AS n FROM compensatory_movements WHERE request_id=?').get(leave.id).n,480);
  leave=f.act('manager',leave,'approve');
  f.policy('working_time',{...BASE,overtime:{...RULE_DRAFT.overtime,hour_divisor_hours:6}},today());
  // اليوم صار ست ساعات في تاريخ الإجازة والمحجوز ثمانٍ: كان الاعتماد يخصم الثماني.
  assert.throws(()=>f.act('hr',leave,'approve'),error=>error.code==='working_time_changed'&&/8 ساعات/.test(error.message)&&/6 ساعات/.test(error.message)&&/إعادة/.test(error.details.refusal.next));
  assert.equal(db.prepare('SELECT status FROM leave_requests WHERE id=?').get(leave.id).status,'pending_hr','the refused approval wrote nothing');
  leave=f.act('hr',leave,'return',{note:'تغيّرت ساعات اليوم بعد الحجز (تجريبي)'});
  leave=tx2(f,leave,start);
  assert.equal(db.prepare('SELECT SUM(reserved_minutes) AS n FROM compensatory_movements WHERE request_id=? AND revision=?').get(leave.id,2).n,360,'reserved again at the day length in force');
  leave=f.act('manager',leave,'approve');leave=f.act('hr',leave,'approve');
  assert.equal(db.prepare('SELECT SUM(used_minutes) AS n FROM compensatory_movements WHERE request_id=?').get(leave.id).n,360);
  // الأساس المحفوظ على حركة الخصم هو أساس آخر حجز على القيد نفسه، لا صف عشوائي من المجموعة.
  assert.deepEqual(db.prepare("SELECT DISTINCT daily_minutes FROM compensatory_movements WHERE request_id=? AND kind='debit'").all(leave.id).map(r=>r.daily_minutes),[360]);
});
const tx2=(f,leave,start)=>f.tx(()=>leaveAction(f.db,f.users.employee,leave.id,'resubmit',{version:leave.version,start_date:start,end_date:start,reason:'إعادة تقديم بعد تغيّر ساعات اليوم (تجريبي)'}));

test('compensatory review: split payouts of one credit never return more overtime than was worked, at a ratio that does not divide evenly',t=>{
  const f=fixture(t,{draft:{compensatory_ratio_bp:17000}}),{db,users,tx}=f,[d1]=pastWorkdays(1);
  f.approve(f.asLeave(d1,180).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();assert.equal(credit.leave_minutes,306);
  const start=nextWorkday(addDays(today(),3)),leave=f.ask({start_date:start,end_date:start,half_day:true});
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${addDays(credit.expires_on,1)}T09:00:00+03:00`)});
  const first=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.equal(first.overtime_minutes,39,'66 leave minutes ÷ 1.7, rounded up');
  f.act('manager',leave,'reject',{note:'رفض تجريبي يحرر الساعات المحجوزة'});
  const second=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  // كان الجبر في كل إحالة: 39 + 142 = 181 دقيقة عن 180 عُملت. الإحالة الأخيرة تأخذ الباقي.
  assert.equal(second.overtime_minutes,141);assert.equal(db.prepare('SELECT SUM(overtime_minutes) AS n FROM compensatory_payouts').get().n,180);
  assert.equal(lotsOf(db,'36t','employee')[0].remaining_minutes,0);
  // والقاعدة نفسها في القاعدة: إحالة تزيد المردود على ما عُمل تُرفض حتى لو كُتبت باليد.
  // استُنفد القيد كله، فلا ساعات «لم تُسوَّ» تمنع الحركة اليدوية: تُقترح بالباب نفسه لا بتعديل صنفها بـSQL (حركة معتمدة أو مقترحة لا تُعدَّل).
  const bonus=tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'overtime',month:addDays(credit.expires_on,1).slice(0,7),amount:'1.00',reason:'حركة تجريبية لاختبار مُشغِّل السقف'}));
  assert.throws(()=>db.prepare("INSERT INTO compensatory_payouts(id,tenant_id,user_id,credit_id,cause,leave_minutes,overtime_minutes,adjustment_id,proposed_by,created_at) VALUES('forged','36t','employee',?,'expired',1,1,?,'hr',?)").run(credit.id,bonus.id,now()),/cannot exceed what is left|more overtime than was worked/);
});

test('compensatory review: the company cap on overtime pay (Art. 77(5)) never blocks the pay of unused compensatory hours — the approver is told, and decides',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1,d2]=pastWorkdays(2);
  // عمل إضافي مدفوع حُوِّل بمبلغ يقارب السقف السنوي (6 × 6,000 = 36,000): ما يُحال بعده كان يُرفض annual_cap بلا مخرج، فتُغلق المخالصة.
  const paid=f.overtime(d1,60);f.approve(paid.id);
  tx(()=>overtimeToPayroll(db,users.hr,paid.id,{month:d1.slice(0,7),amount:'35990.00',basis:'مبلغ مصطنع يقارب السقف السنوي لاختبار التجاوز فقط'}));
  f.approve(f.asLeave(d2,120).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get();
  endService(f);
  const out=tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{}));
  assert.equal(out.over_company_cap,true);assert.equal(out.suggested,'100.00');
  const reason=db.prepare('SELECT reason FROM payroll_adjustments WHERE id=?').get(out.adjustment_id).reason;
  assert.match(reason,/تنبيه لمعتمد الرواتب/);assert.match(reason,/م77\(5\)/);assert.match(reason,/90\.00 ريال/);assert.match(reason,/م22 مكرر\/4/);
  assert.equal(settlementCompensatoryGate(db,'36t','employee'),null,'the statutory payment is proposed; the settlement is not dead-ended by a company cap');
  // ما اختير له الأجر يبقى محكومًا بالسقف كما كان، وما أُحيل من الرصيد محسوب فيه.
  const more=f.overtime(pastWorkdays(3)[0],60);f.approve(more.id);
  assert.throws(()=>tx(()=>overtimeToPayroll(db,users.hr,more.id,{month:today().slice(0,7)})),code('annual_cap'));
});

test('compensatory review: the employee never sees a fake zero — «غير متاح» with its reason when no policy is accepted, and approved hours not yet credited are shown to their owner',t=>{
  const f=fixture(t,{leavePolicy:false}),{db,users}=f,[d1]=pastWorkdays(1),stamp=now();
  db.prepare("INSERT INTO overtime_requests(id,tenant_id,user_id,work_date,minutes,reason,status,decided_by,decided_at,decision_note,created_at,retroactive,compensation,consent_at) VALUES('ot-legacy','36t','employee',?,300,'ساعات مصطنعة اعتُمدت قبل دفتر الأرصدة','approved','manager',?,'اعتماد سابق',?,1,'time_off',?)").run(d1,stamp,stamp,stamp);
  const extras=attendanceExtras(db,users.employee);
  assert.equal(extras.time_off_uncredited_minutes,300);assert.equal(extras.compensation_offer.available,false);
  const html=attendanceUI.render(attendanceData(db,users.employee),helpers);
  assert.match(html,/<strong>غير متاح<\/strong><span>رصيد الإجازة التعويضية المتاح<\/span>/);assert.doesNotMatch(html,/<strong>0<\/strong><span>رصيد الإجازة التعويضية المتاح/);
  assert.match(html,/5 ساعة عمل إضافي معتمدة اخترت لها وقت الراحة ولم تُقيَّد رصيدًا بعد/);assert.match(html,/لم يعتمد مدير الموارد البشرية بعد سياسة أنواع إجازات/);
  assert.equal(attendanceExtras(db,users.manager).time_off_uncredited_minutes,0,'each viewer sees only his own hours');
  // ومُعد الرواتب الذي يحاول دفعها أجرًا يُقال له ما ينقص ومن يملكه، لا «قُيِّدت له رصيدًا» وهي لم تُقيَّد.
  assert.throws(()=>f.tx(()=>overtimeToPayroll(db,users.hr,'ot-legacy',{month:d1.slice(0,7),amount:'10.00',basis:'محاولة دفع ساعات اختير لها وقت الراحة'})),
    error=>error.code==='time_off_chosen'&&/لم تُقيَّد له رصيدًا بعد/.test(error.message)&&!/وقُيِّدت له رصيدًا/.test(error.message)&&error.details.refusal.missing.some(x=>x.owner_role==='hr.attendance.approve')&&error.details.refusal.missing.some(x=>x.owner_role==='hr.policy.accept'));
  // بسياسة معتمدة وقيد قائم تبقى الصياغة الأولى صحيحة، والبلاطة رقمًا.
  const ready=fixture(t),[r1]=pastWorkdays(1),chosen=ready.asLeave(r1,60);ready.approve(chosen.id);
  assert.throws(()=>ready.tx(()=>overtimeToPayroll(ready.db,ready.users.hr,chosen.id,{month:r1.slice(0,7),amount:'10.00',basis:'محاولة دفع ساعات عُوِّضت بإجازة'})),error=>error.code==='time_off_chosen'&&/وقُيِّدت له رصيدًا/.test(error.message));
  assert.match(attendanceUI.render(attendanceData(ready.db,ready.users.employee),helpers),/<strong>1\.5 ساعة<\/strong><span>رصيد الإجازة التعويضية المتاح<\/span>/);
});

test('compensatory review: the payroll pre-run check counts what is really due — a credit still inside its deadline is a notice, not «انقضت مهلته»',t=>{
  const f=fixture(t),{db,users,tx}=f,[d1]=pastWorkdays(1);
  f.policy('payroll_cycle',CYCLE);
  f.approve(f.asLeave(d1,120).id);
  const credit=db.prepare('SELECT * FROM compensatory_credits').get(),month=credit.expires_on.slice(0,7);
  // مسير شهر انقضاء المهلة يُعد قبل انقضائها: كان الفحص يقول «انقضت مهلته» ويوجّه إلى طابور لا يعرض القيد وإحالة تُرفض.
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${addDays(credit.expires_on,-1)}T09:00:00+03:00`)});
  const run=tx(()=>prepareRun(db,users.hr,{month:addDays(credit.expires_on,-1).slice(0,7)})),row=()=>db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run.id);
  const titles=()=>preRunChecks(db,users.hr,row()).map(c=>`${c.level}:${c.title}`);
  assert.equal(titles().some(x=>/مستحق الصرف|انقضت مهلته/.test(x)&&x.startsWith('warn')),false);
  if(addDays(credit.expires_on,-1).slice(0,7)===month)assert.ok(titles().includes('info:1 رصيد إجازة تعويضية تنقضي مهلته خلال هذا الشهر'));
  assert.throws(()=>tx(()=>compensatoryToPayroll(db,users.hr,credit.id,{})),code('compensatory_not_due'));
  t.mock.timers.setTime(Date.parse(`${addDays(credit.expires_on,1)}T09:00:00+03:00`));
  if(row().month===addDays(credit.expires_on,1).slice(0,7))assert.ok(titles().some(x=>x.startsWith('warn:1 رصيد إجازة تعويضية مستحق الصرف')));
  else assert.equal(attendanceExtras(db,users.hr).compensatory_payouts.length,1);
});

test('compensatory review: INSERT OR REPLACE cannot rewrite a recorded consent or a credit',t=>{
  const f=fixture(t),{db}=f,[d1]=pastWorkdays(1),chosen=f.asLeave(d1,60);
  f.approve(chosen.id);
  const consent=db.prepare('SELECT * FROM overtime_compensation_consents WHERE overtime_request_id=?').get(chosen.id),credit=db.prepare('SELECT * FROM compensatory_credits').get();
  assert.throws(()=>db.prepare('INSERT OR REPLACE INTO overtime_compensation_consents(overtime_request_id,tenant_id,user_id,consent_at,policy_id,ratio_bp,use_within_days,overtime_minutes,leave_minutes,sentence,created_at) VALUES(?,?,?,?,?,10000,5,?,?,?,?)')
    .run(consent.overtime_request_id,consent.tenant_id,consent.user_id,consent.consent_at,consent.policy_id,consent.overtime_minutes,consent.overtime_minutes,'جملة مزورة تستبدل ما وافق عليه الموظف فعلًا في سجل الموافقة',consent.created_at),/immutable/);
  assert.throws(()=>db.prepare('INSERT OR REPLACE INTO compensatory_credits(id,tenant_id,user_id,overtime_request_id,work_date,overtime_minutes,ratio_bp,leave_minutes,expires_on,policy_id,legacy,credited_by,reason,created_at) VALUES(?,?,?,?,?,?,?,240,?,?,0,?,?,?)')
    .run(credit.id,credit.tenant_id,credit.user_id,credit.overtime_request_id,credit.work_date,credit.overtime_minutes,credit.ratio_bp,addDays(credit.expires_on,300),credit.policy_id,credit.credited_by,'قيد مزور',credit.created_at),/append only/);
  const after=db.prepare('SELECT ratio_bp,use_within_days,sentence FROM overtime_compensation_consents WHERE overtime_request_id=?').get(chosen.id);
  assert.deepEqual([after.ratio_bp,after.use_within_days,after.sentence],[consent.ratio_bp,consent.use_within_days,consent.sentence]);
  assert.deepEqual([db.prepare('SELECT leave_minutes,expires_on FROM compensatory_credits WHERE id=?').get(credit.id)].map(c=>[c.leave_minutes,c.expires_on]),[[credit.leave_minutes,credit.expires_on]]);
});

// ── الواجهة: الاختيار وجملة الموافقة في نموذج العمل الإضافي، والرصيد بقيوده ومهلها في «الإجازات» و«الحضور» ──
test('compensatory UI: the overtime form offers the choice, shows the exact sentence the server stores, and sends consent only when ticked',t=>{
  const {db,users,tx}=fixture(t),[d1]=pastWorkdays(1);
  const data=attendanceData(db,users.employee),spec=attendanceUI.form('request_overtime','',data);
  const choice=spec.fields.find(f=>f.name==='compensation');
  assert.deepEqual(choice.options.map(o=>o.value),['pay','time_off']);assert.equal(choice.value,'pay','pay stays the default');assert.match(choice.hint,/م107\/1/);assert.match(choice.hint,/60 يومًا/);
  assert.ok(spec.fields.some(f=>f.name==='consent'&&f.type==='checkbox'&&f.required===false));
  const values={work_date:d1,minutes:'120',compensation:'time_off',reason:'طلب العميل تعديلًا عاجلًا بعد نهاية الدوام (تجريبي)'};
  const sentence=compensatoryConsentSentence({work_date:d1,overtime_minutes:120,ratio_bp:15000,use_within_days:60});
  assert.ok(spec.live(values,esc).includes(esc(sentence)),'the sentence is on screen before submitting');assert.match(spec.live(values,esc),/لم تؤكد موافقتك بعد/);
  assert.equal(spec.live({...values,compensation:'pay'},esc),'');assert.doesNotMatch(spec.live({...values,consent:'on'},esc),/لم تؤكد/);
  assert.deepEqual(spec.toPayload({...values,compensation:'pay',consent:'on'}),{work_date:d1,minutes:120,reason:values.reason,compensation:'pay'},'consent is never sent with pay');
  assert.equal(spec.toPayload(values).consent,false);
  const saved=tx(()=>requestOvertime(db,users.employee,spec.toPayload({...values,consent:'on'})));
  assert.equal(db.prepare('SELECT sentence FROM overtime_compensation_consents WHERE overtime_request_id=?').get(saved.id).sentence,sentence,'what was shown is what is stored');
  // بلا سياسة معتمدة: الخيار غير معروض أصلًا، والسبب مكتوب مكانه.
  const bare=fixture(t,{leavePolicy:false}),bareSpec=attendanceUI.form('request_overtime','',attendanceData(bare.db,bare.users.employee)),bareChoice=bareSpec.fields.find(f=>f.name==='compensation');
  assert.deepEqual(bareChoice.options.map(o=>o.value),['pay']);assert.match(bareChoice.hint,/لم يعتمد مدير الموارد البشرية/);assert.equal(bareSpec.fields.some(f=>f.name==='consent'),false);
});

test('compensatory UI: «الإجازات» shows the balance in hours and days with each credit\'s deadline and the 14-day warning; attendance shows the queues to their holders only',t=>{
  // قيدان بينهما أكثر من أسبوعين، فيدخل الأقدم نافذة التنبيه وحده.
  const {db,users,asLeave,approve}=fixture(t),days=pastWorkdays(12),d1=days[0],d2=days.at(-1);
  approve(asLeave(d1,120).id);approve(asLeave(d2,60).id);
  const credits=db.prepare('SELECT * FROM compensatory_credits ORDER BY work_date').all();
  const leaveHtml=()=>leaveUI.render({...listLeave(db,users.employee),user:users.employee},helpers);
  let html=leaveHtml();
  for(const phrase of ['رصيدي من الإجازة التعويضية','4.5 ساعة · 0.56 يوم',`المهلة حتى ${credits[0].expires_on}`,`المهلة حتى ${credits[1].expires_on}`,'2 ساعة عمل × 1.5','من ساعات عمل إضافي معتمدة'])assert.ok(html.includes(esc(phrase)),phrase);
  assert.doesNotMatch(html,/بقي \d+ يومًا على انقضاء/);
  const data={...listLeave(db,users.employee),user:users.employee};
  assert.match(leavePreview({leave_type:'compensatory'},data,esc),/المتاح 4\.5 ساعة، واليوم 8 ساعات/);
  assert.ok(leaveUI.form('request','new',data).fields.find(f=>f.name==='half_day').label.includes('التعويضية'));
  // قبل المهلة بعشرة أيام: التنبيه ظاهر على القيد الأقرب أجلًا وحده، في الشاشتين.
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${addDays(credits[0].expires_on,-10)}T09:00:00+03:00`)});
  html=leaveHtml();
  assert.match(html,/بقي 10 يومًا على انقضاء مهلة هذا الرصيد/);assert.equal(html.split('على انقضاء مهلة هذا الرصيد').length-1,1);
  const mine=attendanceUI.render(attendanceData(db,users.employee),helpers);
  assert.ok(mine.includes('رصيدي من الإجازة التعويضية'));assert.ok(mine.includes('رصيد الإجازة التعويضية المتاح'));assert.match(mine,/يقترب أجله/);assert.doesNotMatch(mine,/أرصدة تعويضية مستحقة الصرف/);
  // بعد المهلة: الطابور عند مُعد الرواتب بزره، لا عند صاحب الرصيد ولا عند مديره. وكل ما أُضيف قوائم لا جداول، فلا تمرير أفقي في عرض الهاتف.
  t.mock.timers.setTime(Date.parse(`${addDays(credits[1].expires_on,1)}T09:00:00+03:00`));
  const preparer=attendanceUI.render(attendanceData(db,users.hr),helpers);
  assert.ok(preparer.includes('أرصدة تعويضية مستحقة الصرف'));assert.match(preparer,/data-operation="compensatory_to_payroll"/);
  assert.doesNotMatch(attendanceUI.render(attendanceData(db,users.manager),helpers),/أرصدة تعويضية مستحقة الصرف/);
  const block=preparer.slice(preparer.indexOf('أرصدة تعويضية مستحقة الصرف'),preparer.indexOf('</section>',preparer.indexOf('أرصدة تعويضية مستحقة الصرف')));
  assert.doesNotMatch(block,/<table/);assert.match(block,/<ul class="vn-list">/);
  const form=attendanceUI.form('compensatory_to_payroll',credits[0].id,attendanceData(db,users.hr));
  assert.equal(form.endpoint,`/attendance/compensatory/${credits[0].id}/payroll`);assert.equal(form.fields.find(f=>f.name==='amount').value,'100.00');
  assert.match(form.fields.find(f=>f.name==='basis').hint,/أجر الإجازة المستحقة 100\.00 ريال/);assert.match(form.fields.find(f=>f.name==='basis').hint,/أجر الساعات الإضافية الأصلية 91\.67 ريال/);
  assert.deepEqual(form.toPayload({month:'',amount:'100.00',basis:''}),{amount:'100.00'});
  assert.throws(()=>attendanceUI.form('compensatory_to_payroll',credits[0].id,attendanceData(db,users.manager)),/غير متاح/);
});
