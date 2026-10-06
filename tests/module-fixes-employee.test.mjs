import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, capabilityGap } from '../app/access.mjs';
import * as v from '../app/validation.mjs';
import { parsePenalty, penaltyLabel, BASE_SCHEDULE_ID, prepareSchedule, decideSchedule, recordViolation, caseAction, getCase } from '../app/discipline.mjs';
import { adoptStarter, approveTemplate, templatesBoard, letterDocument } from '../app/letters.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { recordMedicalPolicy, recordEnrolment, enrolmentAction, addDependant, removeDependant } from '../app/benefits.mjs';
import { submitBenefitRequest, hrDecision, financeDecision, handToPayroll, recordTicketBooking, benefitsAdmin, myBenefits,
  decideBenefit, addMonths } from '../app/benefits-portal.mjs';
import { submitClaim, claimAction, requestCustody, custodyAction, expensesBoard } from '../app/expenses.mjs';
import { assignOvertime, decideAssignment, assignmentsFor } from '../app/overtime-rules.mjs';
import { createLeaveRequest, leaveAction, paySummary } from '../app/leave.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar } from '../app/leave-types.mjs';
import { scheduleOneToOne, meetingAction, writeFeedback, requestFeedback, requestAction } from '../app/feedback.mjs';
import { openRound, roundAction } from '../app/policy-acknowledgements.mjs';
import { defineValue, sendRecognition } from '../app/engagement.mjs';
import { notifications } from '../app/workflow.mjs';

// اختبارات انحدار لإصلاحات تدقيق مسارات الوحدات (MODULE-FLOWS-SWEEP-20260920): D-03، D-04، D-06، D-07، D-08، D-09،
// D-10، D-11، D-14، D-20، D-21، D-24. كل اختبار هنا يسقط على الشيفرة قبل إصلاحه.
// كل الأسماء والمبالغ والتواريخ مصطنعة ولا تمثل بيانات أحد.

const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const TEXT='نص تجريبي كافٍ الطول لأغراض الاختبار الآلي';
const inbox=(db,users,who)=>notifications(db,users[who]);
const titles=(db,users,who)=>inbox(db,users,who).map(n=>`${n.title} ${n.body??''}`);

/* ───────────── D-10: نسبة الغرامة التأديبية ───────────── */

test('D-10: a fine renders its true percentage of the daily wage, so a 50% fine no longer reads like a 5% one',()=>{
  const label=token=>penaltyLabel(parsePenalty(token),'ar');
  assert.equal(label('fine:500'),'غرامة 5% من الأجر اليومي');
  assert.equal(label('fine:1000'),'غرامة 10% من الأجر اليومي');
  assert.equal(label('fine:1500'),'غرامة 15% من الأجر اليومي');
  assert.equal(label('fine:2000'),'غرامة 20% من الأجر اليومي');
  assert.equal(label('fine:5000'),'غرامة 50% من الأجر اليومي');
  assert.equal(label('fine:7500'),'غرامة 75% من الأجر اليومي');
  // الكسور تبقى كما هي، ولا يُبتر منها إلا الصفر الأخير.
  assert.equal(label('fine:250'),'غرامة 2.5% من الأجر اليومي');
  assert.equal(label('fine:205'),'غرامة 2.05% من الأجر اليومي');
  assert.equal(label('fine:1'),'غرامة 0.01% من الأجر اليومي');
  assert.equal(label('fine:100'),'غرامة 1% من الأجر اليومي');
  // جزاء اليوم الكامل ومضاعفاته يبقى بصيغة الأيام لا بالنسبة.
  assert.equal(label('fine:10000'),'غرامة أجر يوم واحد');
  assert.equal(label('fine:20000'),'غرامة أجر يومين');
  assert.equal(label('fine:50000'),'غرامة أجر 5 أيام');
  assert.equal(penaltyLabel(parsePenalty('fine:5000'),'en'),'Fine of 50% of the daily wage');
  assert.equal(penaltyLabel(parsePenalty('fine:20000'),'en'),'Fine of 2 days’ wage');
  // الفارق بين غرامتين مختلفتين عشرة أضعاف يجب أن يظهر في النص.
  assert.notEqual(label('fine:5000'),label('fine:500'));
  assert.notEqual(label('fine:2000'),label('fine:200'));
});

/* ───────────── قضية انضباط كاملة: D-10 على المستند، وD-11 ───────────── */

function disciplineFixture(t,{adopt=true,approve=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-module-fixes');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح تجريبي'}));
  for(const c of ['hr.discipline.decide','hr.policy.accept','payroll.approve','hr.contracts.approve','hr.letters.issue'])grant('it',c);
  grant('manager','hr.letters.issue');
  const date=today();
  tx(()=>decideSchedule(db,users.it,BASE_SCHEDULE_ID,'accept',{effective_from:'2024-01-01',note:'قبول تجريبي بعد مطابقة الجدول'}));
  // نسخة معدلة يكون فيها جزاء A02 الأول غرامة 50% من الأجر اليومي: الرقم الذي كان يُطبع «5%».
  const draft=tx(()=>prepareSchedule(db,users.hr,{source_id:BASE_SCHEDULE_ID,title:'جدول جزاءات تجريبي',basis:'لائحة تجريبية معتمدة لسنة 2026 للاختبار',
    effective_from:'2024-01-02',changes:[{code:'A02',occurrence:1,penalty:'fine:5000'}]}));
  tx(()=>decideSchedule(db,users.it,draft.id,'accept',{effective_from:'2024-01-02',note:'قبول تجريبي للنسخة المعدلة',version:1}));
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users.it,id,'accept',{note:'اعتماد تجريبي للسياسة'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  const {id:contractId}=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'6000.00'},{component:'housing',amount:'1500.00'},{component:'transport',amount:'1500.00'}],document_reference:'عقد مصطنع'}));
  tx(()=>contractAction(db,users.hr,contractId,'submit_contract',{version:getContract(db,users.hr,contractId).version}));
  tx(()=>contractAction(db,users.it,contractId,'approve_contract',{version:getContract(db,users.it,contractId).version}));
  if(adopt){
    tx(()=>adoptStarter(db,users.hr,'discipline_notice',{}));
    if(approve){
      const t2=templatesBoard(db,users.manager).types.find(x=>x.code==='discipline_notice');
      tx(()=>approveTemplate(db,users.manager,'discipline_notice',{effective_from:date,note:'اعتماد تجريبي لنص إشعار الجزاء',version:t2.draft.version}));
    }
  }
  const act=(who,id,action,input={})=>tx(()=>caseAction(db,users[who],id,action,{version:getCase(db,users[who],id).version,...input}));
  const caseTo=finding=>{
    const {id}=tx(()=>recordViolation(db,users.hr,{user_id:'employee',codes:['A02'],act_date:date,discovered_on:date,description:'انصراف تجريبي قبل نهاية الدوام',source_kind:'hr_observation'}));
    act('hr',id,'open_investigation',{process:'written',charge_text:'اتهام كتابي تجريبي بالانصراف قبل الوقت',charge_delivered_on:date});
    act('employee',id,'submit_defence',{defence:'دفاع تجريبي مكتوب من الموظف'});
    act('hr',id,'record_hearing',{hearing_on:date,minutes:'محضر جلسة تحقيق تجريبي بأقوال الموظف'});
    act('hr',id,'conclude',{finding:finding??'proven',note:TEXT});
    return id;
  };
  return {db,users,tx,act,caseTo,date};
}

test('D-11: the article-121 notice starter is adoptable out of the box, and HR approval is still required before issue',t=>{
  const {db,users,tx,act,caseTo,date}=disciplineFixture(t,{adopt:false});
  // قبل التبني: النوع ظاهر في شاشة القوالب ومعه إجراء تبني النص المبدئي (كان الترحيل 097 يشحن النوع بلا نص).
  const before=templatesBoard(db,users.hr).types.find(x=>x.code==='discipline_notice');
  assert.ok(before.starter,'a starter text ships for the discipline notice');
  assert.ok(before.actions.includes('adopt_starter'));
  assert.equal(before.published,null);
  // التبني ينجح ولا يعتمد: المسودة باسم من تبناها، وهو نفسه لا يعتمدها، ومن لا يملك الإصدار لا يعتمدها (البوابة باقية).
  tx(()=>adoptStarter(db,users.manager,'discipline_notice',{}));
  const adopted=templatesBoard(db,users.manager).types.find(x=>x.code==='discipline_notice');
  assert.ok(adopted.draft.body.includes('{{case_reference}}')&&adopted.draft.body.includes('{{penalty_ar}}')&&adopted.draft.body.includes('{{grievance_days}}'));
  assert.equal(adopted.published,null,'adopting does not publish');
  assert.throws(()=>tx(()=>approveTemplate(db,users.manager,'discipline_notice',{effective_from:date,note:'اعتماد ذاتي ممنوع',version:adopted.draft.version})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>approveTemplate(db,users.employee,'discipline_notice',{effective_from:date,note:'اعتماد بلا تصريح',version:adopted.draft.version})),code('not_permitted'));
  // ما دام القالب غير معتمد، القضية تقول ما ينقص ومن يوفّره، ولا تكتفي بحالة «صدر القرار».
  const id=caseTo('proven');
  act('it',id,'decide',{penalty:'fine:5000',note:TEXT});
  const gate=getCase(db,users.employee,id).notice_gate;
  assert.equal(gate.blocked,true);
  assert.equal(gate.step,'approve_template');
  assert.equal(gate.capability,'hr.letters.issue');
  assert.ok(gate.who.includes(users.it.name),'the refusal names who can approve the template');
  assert.ok(gate.text.includes('إشعار بجزاء تأديبي'));
  assert.ok(gate.consequence.includes('مهلة التظلم'));
  assert.throws(()=>act('manager',id,'issue_notice'),error=>error.code==='template_required'&&error.details.step==='approve_template'&&error.details.placeholders.some(p=>p.key==='penalty_ar'));
  // بعد اعتماد شخص آخر يملك الإصدار يصدر الإشعار وتبدأ مهلة التظلم.
  const draft=templatesBoard(db,users.it).types.find(x=>x.code==='discipline_notice').draft;
  tx(()=>approveTemplate(db,users.it,'discipline_notice',{effective_from:date,note:'اعتماد تجريبي لنص إشعار الجزاء',version:draft.version}));
  assert.equal(getCase(db,users.employee,id).notice_gate.blocked,false);
  const issued=act('manager',id,'issue_notice');
  assert.ok(issued.reference);
  act('hr',id,'record_delivery',{method:'hand',delivered_on:date});
  const notified=getCase(db,users.employee,id);
  assert.equal(notified.status,'notified');
  assert.equal(notified.notice_gate,null);
  assert.ok(notified.deadlines.some(d=>d.key==='grievance_filing'),'the grievance clock starts once the notice is delivered');
  assert.ok(notified.actions.includes('file_grievance'));
  assert.ok(verifyAudit(db));
});

test('D-10: the article-121 notice handed to the employee prints the real fine percentage',t=>{
  const {db,users,act,caseTo}=disciplineFixture(t);
  const id=caseTo('proven');
  act('it',id,'decide',{penalty:'fine:5000',note:TEXT});
  const view=getCase(db,users.employee,id);
  assert.equal(view.decided.ar,'غرامة 50% من الأجر اليومي');
  assert.equal(view.effective.ar,'غرامة 50% من الأجر اليومي');
  const issued=act('manager',id,'issue_notice');
  const body=letterDocument(db,users.employee,issued.letter_id).body;
  assert.ok(body.includes('50%'),'the notice states 50%');
  assert.ok(!/(?:^|[^0-9.])5%/.test(body),'and never the old ten-times-too-low 5%');
  assert.ok(body.includes('Fine of 50% of the daily wage'));
  // صحيفة الجزاءات (م122) تقرأ الرقم نفسه.
  assert.equal(getCase(db,users.employee,id).effective.ar,'غرامة 50% من الأجر اليومي');
});

/* ───────────── D-03 وD-04 وD-08: المزايا ───────────── */

function benefitsFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-module-benefits');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(who,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:who,capability,note:'منح اختبار'}));
  grant('manager','hr.policy.accept');grant('it','benefits.finance.confirm');
  const time=now(),join=addMonths(today(),-24);
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pol-1','36t','pay_components','بنود الراتب','سياسة بنود راتب تجريبية للاختبار فقط','{\"components\":[\"basic\",\"housing\",\"transport\"]}','مصدر تجريبي للاختبار','2020-01-01','accepted','hr','manager',?,?)").run(time,time);
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('c-employee','36t','employee','pol-1','indefinite','وظيفة تجريبية','الرياض',?,40,90,30,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مرجع عقد تجريبي','active','hr','manager',?,?,?)").run(join,time,time,time);
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,updated_by,updated_at) VALUES('employee','36t','وظيفة تجريبية','full_time',?,'hr',?)").run(join,time);
  db.prepare("INSERT INTO employee_demographics(user_id,tenant_id,nationality_group,gender,source,recorded_by,updated_at) VALUES('employee','36t','non_saudi','male','سجل اختبار','hr',?)").run(time);
  const policyId=tx(()=>recordMedicalPolicy(db,users.hr,{insurer_name:'شركة تأمين مصطنعة',policy_number:'SYN-900001',effective_from:day(-200),effective_to:day(200),tiers:['فئة ب','فئة أ'],renewal_notice_days:30,note:''})).id;
  const accept=key=>{const row=db.prepare("SELECT id,version FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key=? AND status='draft'").get(key);
    return tx(()=>decideBenefit(db,users.manager,row.id,'accept',{version:row.version,effective_from:day(-1),note:'قرار مالك مصطنع بتاريخ 2026-01-01 للاختبار'}));};
  const decide=(who,id,decision,input={})=>tx(()=>{const r=db.prepare('SELECT version FROM benefit_requests WHERE id=?').get(id);
    return who==='it'?financeDecision(db,users[who],id,decision,{version:r.version,...input}):hrDecision(db,users[who],id,decision,{version:r.version,...input});});
  return {db,users,tx,policyId,accept,decide};
}

test('D-03: the employee is told about medical cover on enrolment, on confirmation and — above all — on removal',t=>{
  const {db,users,tx,policyId}=benefitsFixture(t);
  assert.deepEqual(inbox(db,users,'employee'),[]);
  const enrolmentId=tx(()=>recordEnrolment(db,users.hr,{policy_id:policyId,employee_id:'employee',tier:'فئة ب',requested_on:day(-30)})).id;
  let seen=titles(db,users,'employee');
  assert.equal(seen.length,1);
  assert.ok(seen[0].includes('أُرسل تسجيلك في التأمين الطبي'));
  tx(()=>enrolmentAction(db,users.hr,enrolmentId,'confirm_enrolment',{version:1,confirmed_on:day(-20),member_reference:'MEM-88'}));
  assert.ok(titles(db,users,'employee').some(x=>x.includes('أكدت شركة التأمين تسجيلك')));
  // تابع يُضاف ثم يُحذف: الموظف يعلم بالاثنين، وبلا صلة قرابة ولا تاريخ ميلاد في الإشعار.
  const dependantId=tx(()=>addDependant(db,users.hr,{relation:'child',birth_date:'2019-06-17',added_on:day(-10)},enrolmentId)).id;
  tx(()=>removeDependant(db,users.hr,dependantId,{version:1,removed_on:day(-2)}));
  const all=titles(db,users,'employee');
  assert.ok(all.some(x=>x.includes('أُضيف تابع إلى تأمينك الطبي')));
  assert.ok(all.some(x=>x.includes('حُذف تابع من تأمينك الطبي')));
  assert.ok(all.every(x=>!x.includes('2019')&&!x.includes('ابن')&&!x.includes('MEM-88')&&!x.includes('SYN-900001')),'no dependant detail, member number or policy number leaks into a notice');
  // الحذف من الوثيقة نفسه: فقدان التغطية يصل صاحبه بتاريخه.
  const version=db.prepare('SELECT version FROM medical_enrolments WHERE id=?').get(enrolmentId).version;
  tx(()=>enrolmentAction(db,users.hr,enrolmentId,'remove_enrolment',{version,removed_on:day(-1),reason:'انتهاء التغطية لأسباب تجريبية'}));
  const final=inbox(db,users,'employee');
  const removal=final.find(n=>n.title.includes('حُذف تسجيلك من وثيقة التأمين'));
  assert.ok(removal,'removal from the policy is notified');
  assert.ok(removal.body.includes('انتهت تغطيتك'));
  assert.ok(!removal.body.includes('انتهاء التغطية لأسباب تجريبية'),'the free-text removal reason is not carried into the notice');
  assert.equal(myBenefits(db,users.employee).insurance,null,'cover is gone from the screen — and now the employee was told');
  assert.ok(verifyAudit(db));
});

test('D-04: the benefits letter never tells the employee a document exists when none was created',t=>{
  const {db,users,tx,accept,decide}=benefitsFixture(t);
  // نوع «خطاب بالمزايا» بلا قالب معتمد: الخيار يقول ذلك قبل التقديم.
  const option=myBenefits(db,users.employee).options.find(o=>o.key==='benefit_letter');
  assert.equal(option.letter_ready,false);
  assert.ok(option.note.includes('لن يصدر من المنصة مستند'));
  const {id}=tx(()=>submitBenefitRequest(db,users.employee,{option:'benefit_letter',details:{purpose:'bank',addressee:'بنك مصطنع',language:'ar'}}));
  decide('hr',id,'approve',{letter_reference:'HR-LTR-2026-0009'});
  const view=myBenefits(db,users.employee).requests.find(r=>r.id===id);
  assert.equal(view.status,'completed');
  assert.deepEqual(view.documents,[]);
  assert.equal(view.letter,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM letters').get().n,0);
  const notice=inbox(db,users,'employee').find(n=>n.title.includes('اكتمل طلبك'));
  assert.ok(!notice.body.includes('الخطاب مرفق'),'no claim that a document is attached');
  assert.ok(notice.body.includes('لم يصدر من المنصة مستند'));
  assert.ok(notice.body.includes('HR-LTR-2026-0009'),'the reference HR actually recorded is named instead');
  assert.ok(verifyAudit(db));
});

test('D-08: a booking-type ticket claim has a next step and a named owner instead of a dead end',t=>{
  const {db,users,tx,accept,decide}=benefitsFixture(t);
  accept('air_ticket');
  const claim=myBenefits(db,users.employee).options.find(o=>o.key==='ticket_claim');
  assert.ok(claim.mode_notes.ticket.includes('فريق المزايا'),'the owner of the booking is named before submission');
  const {id}=tx(()=>submitBenefitRequest(db,users.employee,{option:'ticket_claim',details:{mode:'ticket',destination:'وجهة مصطنعة',travel_from:day(20),travel_to:day(30)}}));
  decide('hr',id,'approve',{travel_class:'staff',amount:'3000.00'});
  decide('it',id,'approve');
  // مالك الخطوة أُبلغ بها، والموظف عرف من يتولاها.
  assert.ok(titles(db,users,'hr').some(x=>x.includes('تذكرة بانتظار الحجز')));
  assert.ok(titles(db,users,'employee').some(x=>x.includes('بقي حجز التذكرة')&&x.includes('فريق المزايا')));
  const admin=benefitsAdmin(db,users.hr),proposal=admin.proposals.find(p=>p.reference);
  assert.equal(proposal.target,'company_expense');
  assert.deepEqual(proposal.actions,['record_booking'],'the benefits owner now has an action');
  assert.ok(proposal.state_text.includes('بانتظار حجز التذكرة'));
  assert.equal(proposal.next_step_owner&&proposal.next_step,'record_booking');
  // تسليمه إلى حركات الرواتب يبقى مرفوضًا، لكن الرفض صار يسمّي الخطوة الصحيحة ومالكها.
  assert.throws(()=>tx(()=>handToPayroll(db,users.hr,proposal.id,{version:proposal.version,month:today().slice(0,7)})),
    error=>error.code==='not_payroll'&&error.details.available.includes('record_booking')&&String(error.message).includes('وكيل السفر'));
  // صاحب الطلب لا يسجل حجز نفسه.
  assert.throws(()=>tx(()=>recordTicketBooking(db,users.employee,proposal.id,{version:proposal.version,reference:'TKT-1',booked_on:today()})),code('not_permitted'));
  const booked=tx(()=>recordTicketBooking(db,users.hr,proposal.id,{version:proposal.version,reference:'TKT-556677',booked_on:today(),note:'حجز مصطنع لدى وكيل سفر'}));
  assert.equal(booked.reference,'TKT-556677');
  assert.ok(titles(db,users,'employee').some(x=>x.includes('حُجزت تذكرتك')&&x.includes('TKT-556677')));
  const after=benefitsAdmin(db,users.hr).proposals.find(p=>p.id===proposal.id);
  assert.deepEqual(after.actions,[],'the flow is closed, not frozen');
  assert.equal(after.booking.reference,'TKT-556677');
  assert.ok(after.state_text.includes('حُجزت التذكرة'));
  assert.throws(()=>tx(()=>recordTicketBooking(db,users.hr,proposal.id,{version:proposal.version,reference:'TKT-9',booked_on:today()})),code('already_booked'));
  assert.ok(verifyAudit(db));
});

/* ───────────── D-06: شريحة أجر الإجازة ───────────── */

function leaveFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-module-leave');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير موارد بشرية تجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'مالك اعتماد السياسات في الاختبار'}));
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pay-policy','36t','pay_components','بنود راتب مصطنعة','نص سياسة مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{\"components\":[\"basic\"]}','سند مصطنع للاختبار المحلي','2024-01-01','accepted','hr','hr-manager',?,?)").run(time,time);
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES('contract-employee','36t','employee','pay-policy','indefinite','وظيفة تجريبية','الرياض','2025-01-01',40,90,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي لا وجود له','active','hr','hr-manager',?,?,?)").run(time,time,time);
  const policyId=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})).id;
  tx(()=>decideLeaveTypes(db,users['hr-manager'],policyId,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد في الاختبار'}));
  tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:'creative',name:'تقويم إجازات 2026',effective_from:'2026-01-01',effective_to:'2026-12-31',weekdays:[0,1,2,3,4]}));
  const ask=input=>tx(()=>createLeaveRequest(db,users.employee,{balance_year:2026,reason:'طلب اختبار لشريحة الأجر',...input}));
  const act=(who,r,action,input={})=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع',...input}));
  return {db,users,tx,ask,act};
}

test('D-06: the leave approval notice and the leave record both state the pay tier and the unpaid portion',t=>{
  const {db,users,ask,act}=leaveFixture(t);
  const report=()=>({filename:'report.pdf',content:Buffer.from('%PDF-1.4 synthetic medical report '+Math.random()).toString('base64')});
  // كما في التدقيق: 40 يومًا مرضية أولًا تستهلك شريحة الأجر الكامل، ثم 60 يومًا تقع على شريحتي 75% و0% (م88).
  const first=ask({leave_type:'sick',start_date:'2026-01-05',end_date:'2026-02-13',document:report()});
  act('hr',act('manager',first,'approve'),'approve');
  const r=ask({leave_type:'sick',start_date:'2026-02-16',end_date:'2026-04-16',document:report()});
  const approved=act('hr',act('manager',r,'approve'),'approve');
  assert.equal(approved.status,'approved');
  const summary=approved.terms.pay_summary;
  assert.ok(summary,'the leave record carries a pay summary');
  assert.equal(summary.fully_paid,false);
  assert.ok(summary.unpaid_days>0,'the unpaid portion is stated as a number of days');
  assert.ok(summary.reduced_days>0);
  assert.ok(summary.text.includes('بنسبة 75% من الأجر')&&summary.text.includes('بلا أجر'));
  assert.deepEqual(summary.tiers.map(x=>x.rate_bp),[7500,0]);
  const notice=inbox(db,users,'employee').find(n=>n.title.includes('اعتُمدت إجازتك'));
  assert.ok(notice,'the employee is notified');
  assert.ok(notice.body.includes('75%'),'the notice states the tier');
  assert.ok(notice.body.includes('بلا أجر'),'and the unpaid portion');
  assert.ok(notice.body.includes('خصم'),'and that a deduction will be proposed');
  assert.ok(!/سُجلت 60 يوم تقويمي\.$/.test(notice.body),'no longer the bare day count of the sweep');
});

test('D-06: a fully paid leave says so rather than staying silent about pay',t=>{
  const {db,users,ask,act}=leaveFixture(t);
  const r=ask({leave_type:'marriage',start_date:'2026-03-02',end_date:'2026-03-06'});
  const approved=act('hr',act('manager',r,'approve'),'approve');
  assert.equal(approved.terms.pay_summary.fully_paid,true);
  assert.equal(approved.terms.pay_summary.unpaid_days,0);
  const notice=inbox(db,users,'employee').find(n=>n.title.includes('اعتُمدت إجازتك'));
  assert.ok(notice.body.includes('الأجر: كامل'));
  // الدالة نفسها تُقرأ خارج الطلب: وحدة حساب الشرائح لا تحتاج قاعدة بيانات.
  assert.equal(paySummary(null),null);
  assert.equal(paySummary({unit:'calendar',pay:[{date:'2026-01-01',rate_bp:0,milli:1000},{date:'2026-01-02',rate_bp:0,milli:1000}]}).text,'2 يوم تقويمي بلا أجر');
});

/* ───────────── D-09: سحب المطالبة والعهدة ───────────── */

function expensesFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-module-expenses');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const action of ['read','configure','approve','post'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),'36t','treasurer',users.treasurer.role,action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const claim=(input={})=>transaction(db,()=>submitClaim(db,users.employee,{expense_date:today(),category:'transport',description:'أجرة نقل معدات إلى موقع تصوير مصطنع',amount:'230.00',receipt_reference:'rcpt-501',...input})).id;
  const act=(who,id,action,values={})=>transaction(db,()=>claimAction(db,users[who],id,action,{version:db.prepare('SELECT version FROM expense_claims WHERE id=?').get(id).version,...values}));
  const cAct=(who,id,action,values={})=>transaction(db,()=>custodyAction(db,users[who],id,action,{version:db.prepare('SELECT version FROM custodies WHERE id=?').get(id).version,...values}));
  return {db,users,claim,act,cAct};
}

test('D-09: the person who filed an expense claim can withdraw it before the first approval, and it is audited',t=>{
  const {db,users,claim,act}=expensesFixture(t);
  const id=claim();
  const own=expensesBoard(db,users.employee).claims.find(c=>c.id===id);
  assert.ok(own.actions.includes('withdraw_claim'),'the claimant now has an exit that is not a rejection');
  // زميل أو مدير لا يسحب مطالبة غيره.
  assert.throws(()=>act('manager',id,'withdraw_claim',{note:'سحب نيابة عن غيره'}),code('action_unavailable'));
  const after=act('employee',id,'withdraw_claim',{note:'كتبت المبلغ خطأ'});
  assert.equal(after.withdrawn,true);
  assert.equal(after.status_name,'مسحوبة بطلب مقدّمها');
  assert.deepEqual(after.actions,[]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='expense.withdrawn'").get().n,1);
  assert.equal(db.prepare("SELECT status FROM expense_claims WHERE id=?").get(id).status,'submitted','the record keeps its trace; the withdrawal mark ends it');
  // لا مدير يقرر في مطالبة مسحوبة، ولا يُعاد فتحها.
  assert.throws(()=>act('manager',id,'manager_approve',{note:'قرار بعد السحب'}),error=>error.code==='action_unavailable'&&String(error.message).includes('سحب مقدّمها'));
  assert.throws(()=>db.prepare('UPDATE expense_claims SET status=? ,version=version+1 WHERE id=?').run('rejected',id),/withdrawn claim is final/);
  // إعادة التقديم بالمبلغ الصحيح مسموحة: الإيصال المسحوب لا يحجز نفسه.
  const again=claim({amount:'320.00'});
  assert.ok(again);
  assert.equal(act('manager',again,'manager_approve',{note:'المصروف لمشروع الفريق'}).status,'manager_approved');
  assert.ok(verifyAudit(db));
});

test('D-09: withdrawal closes once the first decision is taken, and a withdrawn custody request frees the employee to ask again',t=>{
  const {db,users,claim,act,cAct}=expensesFixture(t);
  const id=claim();
  act('manager',id,'manager_approve',{note:'المصروف لمشروع الفريق'});
  assert.throws(()=>act('employee',id,'withdraw_claim',{note:'بعد قرار المدير'}),
    error=>error.code==='action_unavailable'&&String(error.message).includes('السحب قبل أول قرار'));
  const custody=transaction(db,()=>requestCustody(db,users.employee,{amount:'1000.00',purpose:'مصروفات تصوير ميداني مصطنع لثلاثة أيام'})).id;
  assert.ok(expensesBoard(db,users.employee).custodies.find(c=>c.id===custody).actions.includes('withdraw_custody'));
  // عهدة مفتوحة تمنع طلب أخرى؛ الرفض يقول إن السحب مخرج.
  assert.throws(()=>transaction(db,()=>requestCustody(db,users.employee,{amount:'500.00',purpose:'عهدة ثانية مصطنعة لغرض الاختبار'})),
    error=>error.code==='open_custody'&&String(error.message).includes('اسحب طلبها'));
  const withdrawn=cAct('employee',custody,'withdraw_custody',{note:'لم تعد العهدة لازمة'});
  assert.equal(withdrawn.withdrawn,true);
  assert.equal(withdrawn.status_name,'مسحوب بطلب صاحبه');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='custody.withdrawn'").get().n,1);
  const second=transaction(db,()=>requestCustody(db,users.employee,{amount:'500.00',purpose:'عهدة بديلة مصطنعة لغرض الاختبار'})).id;
  assert.ok(second,'a withdrawn request no longer blocks a new one');
  assert.throws(()=>cAct('treasurer',custody,'approve_custody',{note:'اعتماد بعد السحب'}),error=>error.code==='action_unavailable'&&String(error.message).includes('سحب صاحبها'));
  assert.ok(verifyAudit(db));
});

/* ───────────── D-07: رفض العمل الإضافي يسمّي التصريح الناقص ───────────── */

function overtimeFixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-module-overtime');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('wt','36t','working_time','ساعات عمل مصطنعة','نص سياسة ساعات عمل مصطنع للاختبار المحلي فقط.',?,'سند مصطنع للاختبار','2020-01-01','accepted','hr','manager',?,?)")
    .run(JSON.stringify({workdays:[0,1,2,3,4],daily_minutes:480,overtime:{daily_cap_minutes:240,holiday_cap_minutes:480,weekly_cap_minutes:720,rate_bp:15000,basis:'actual',annual_cap_basic_months:2}}),time,time);
  return {db,users,tx};
}

test('D-07: the prior-assignment refusal names the missing capability, who holds it and who grants it',t=>{
  const {db,users,tx}=overtimeFixture(t);
  const {id}=tx(()=>assignOvertime(db,users.manager,{user_id:'employee',from_date:day(1),to_date:day(2),minutes_per_day:60,reason:'تغطية تصوير مصطنع بعد الدوام'}));
  // لا حساب يحمل hr.attendance.approve افتراضيًا: الرفض يقول ذلك بالاسم بدل «الإجراء غير متاح».
  const gap=capabilityGap(db,'36t','hr.attendance.approve');
  assert.equal(gap.satisfied,false);
  assert.deepEqual(gap.default_roles,[],'the capability has no default role — the sweep’s finding, stated');
  assert.ok(gap.text.includes('لا دور يحمله افتراضيًا'));
  assert.ok(gap.granted_by.includes('access.manage'));
  assert.throws(()=>tx(()=>decideAssignment(db,users.hr,id,'authorise',{note:'موافقة بلا تصريح'})),
    error=>error.code==='action_unavailable'
      &&String(error.message).includes('hr.attendance.approve')
      &&String(error.message).includes('اعتماد الغياب غير المدفوع')
      &&String(error.message).includes('الأدمن الأول'));
  // واللوحة تقول الشيء نفسه لمن ينتظر.
  const view=assignmentsFor(db,{...users.employee,caps:[]}).find(a=>a.id===id);
  assert.equal(view.next_step.step,'authorise_assignment');
  assert.equal(view.next_step.capability,'hr.attendance.approve');
  assert.equal(view.next_step.blocked,true);
  assert.ok(view.next_step.separation.includes('لا يوافق عليه من كتب التكليف'));
  // والإشعار الذي يصل الموظف لا يعده بقرار لا يستطيع أحد اتخاذه.
  assert.ok(titles(db,users,'employee').some(x=>x.includes('ولا حساب يحمل تصريح')));
  // بعد المنح: الخطوة تُفتح، وتظهر الخطوة الثانية بتصريحها ومن يحمله.
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'hr.attendance.approve',note:'منح اختبار'}));
  assert.equal(capabilityGap(db,'36t','hr.attendance.approve').satisfied,true);
  tx(()=>decideAssignment(db,users.it,id,'authorise',{note:'موافقة صاحب الصلاحية في الاختبار'}));
  const next=assignmentsFor(db,{...users.employee,caps:[]}).find(a=>a.id===id);
  assert.equal(next.next_step.step,'approve_assignment_budget');
  assert.equal(next.next_step.capability,'hr.attendance.manage');
  assert.ok(next.next_step.separation.includes('أربعة أشخاص'));
  assert.ok(verifyAudit(db));
});

/* ───────────── D-24: الرفض يسمّي القيد والإصلاح ───────────── */

test('D-24: a length failure names the constraint, what was entered and what to do — and a missing amount is not reported as a malformed one',()=>{
  // قصير جدًا
  assert.throws(()=>v.text('اب','سبب الرفض',2000,10),
    error=>error.code==='invalid_text'&&String(error.message).includes('10 أحرف على الأقل')&&String(error.message).includes('أدخلت')&&error.details.reason==='too_short'&&error.details.min_length===10);
  // طويل جدًا: يقول كم يُختصر
  assert.throws(()=>v.text('ا'.repeat(60),'الملاحظة',50),
    error=>error.code==='invalid_text'&&String(error.message).includes('50 حرفًا كحد أقصى')&&String(error.message).includes('اختصر')&&error.details.reason==='too_long'&&error.details.length===60);
  // ناقص تمامًا: «مطلوب» لا «قيمة غير صالحة»
  assert.throws(()=>v.text(undefined,'نص التظلم',6000,10),
    error=>error.code==='invalid_text'&&String(error.message).includes('مطلوب')&&error.details.reason==='missing');
  assert.throws(()=>v.text(5,'الغرض'),error=>error.details.reason==='type');
  // نصان مختلفان اختلافًا كبيرًا لا يعطيان الرسالة نفسها (عيب التدقيق: 5 أحرف و5000 حرف رسالة واحدة).
  const short=(()=>{try{v.text('ابج','تقييمك الذاتي',6000,30);}catch(e){return e.message;}})();
  const long=(()=>{try{v.text('ا'.repeat(7000),'تقييمك الذاتي',6000,30);}catch(e){return e.message;}})();
  assert.notEqual(short,long);
  assert.ok(short.includes('30 حرفًا على الأقل')&&long.includes('اختصر'));
  // الحقل الاختياري (min=0) يقبل الفراغ كما كان.
  assert.equal(v.text('','ملاحظة اختيارية',1000,0),'');
  // المبالغ: الغائب يُعلن ناقصًا بمثاله، والمكتوب خطأ يُعلن بصيغته وما أُدخل.
  assert.throws(()=>v.moneyMinor(undefined,'مبلغ الفاتورة'),error=>error.code==='missing_field'&&String(error.message).includes('1250.00'));
  assert.throws(()=>v.moneyMinor('','فرق القسط'),error=>error.code==='missing_field');
  assert.throws(()=>v.moneyMinor('abc','فرق القسط'),error=>error.code==='invalid_money'&&String(error.message).includes('أدخلت «abc»'));
  assert.throws(()=>v.moneyMinor('0','فرق القسط'),error=>error.code==='invalid_money'&&String(error.message).includes('أكبر من صفر'));
  assert.equal(v.moneyMinor('1250.5','مبلغ'),125050);
});

test('D-24: the same specific refusal reaches several modules through the shared validator',t=>{
  const {db,users,claim}=expensesFixture(t);
  // المصروفات: مبلغ غائب ≠ مبلغ مكتوب خطأ.
  assert.throws(()=>claim({amount:undefined}),error=>error.code==='missing_field'&&String(error.message).includes('المبلغ: مطلوب'));
  assert.throws(()=>claim({amount:'1.234'}),error=>error.code==='invalid_money'&&String(error.message).includes('أدخلت «1.234»'));
  // ووصف قصير يقول كم يلزم.
  assert.throws(()=>claim({description:'قصير'}),error=>error.code==='invalid_text'&&String(error.message).includes('10 أحرف على الأقل'));
  const {db:db2,users:u2,tx,accept}=benefitsFixture(t);
  accept('children_education');
  assert.throws(()=>tx(()=>submitBenefitRequest(db2,u2.employee,{option:'education_claim',details:{stage:'ابتدائي',school:'مدرسة مصطنعة',academic_year:'2026-2027',invoice_amount:undefined},document:{filename:'inv.pdf',content:Buffer.from('%PDF-1.4 invoice').toString('base64'),label:'فاتورة'}})),
    error=>error.code==='missing_field'&&String(error.message).includes('مبلغ الفاتورة: مطلوب'));
});

/* ───────────── D-14: «الإجراء غير متاح» يقول السبب والمتاح ───────────── */

test('D-14: action_unavailable now states the record’s state, why the action is refused and what is available — in expenses, benefits and discipline',t=>{
  // 1) المصروفات
  const {db,users,claim,act}=expensesFixture(t);
  const id=claim();
  assert.throws(()=>act('employee',id,'manager_approve',{note:'إقرار ذاتي'}),
    error=>error.code==='action_unavailable'
      &&String(error.message).includes('بانتظار المدير المباشر')
      &&String(error.message).includes('لا يقرر صاحب المطالبة')
      &&String(error.message).includes('المتاح لك الآن')
      &&error.details.available.includes('withdraw_claim'));
  assert.throws(()=>act('treasurer',id,'finance_approve',{note:'تجاوز المدير'}),
    error=>error.code==='action_unavailable'&&String(error.message).includes('الخطوة التالية عند المدير المباشر')&&error.details.state_name==='بانتظار المدير المباشر');
  // 2) المزايا
  const {db:db2,users:u2,tx,decide}=benefitsFixture(t);
  const letter=tx(()=>submitBenefitRequest(db2,u2.employee,{option:'benefit_letter',details:{purpose:'bank',addressee:'بنك مصطنع',language:'ar'}})).id;
  decide('hr',letter,'approve',{letter_reference:'HR-LTR-1'});
  assert.throws(()=>tx(()=>{const r=db2.prepare('SELECT version FROM benefit_requests WHERE id=?').get(letter);return hrDecision(db2,u2.hr,letter,'approve',{version:r.version,letter_reference:'HR-LTR-2'});}),
    error=>error.code==='action_unavailable'&&String(error.message).includes('مكتمل')&&String(error.message).includes('ولا إجراء متاح'));
  // 3) الانضباط
  const {db:db3,users:u3,act:act3,caseTo}=disciplineFixture(t);
  const caseId=caseTo('proven');
  assert.throws(()=>act3('hr',caseId,'decide',{penalty:'fine:500',note:TEXT}),
    error=>error.code==='action_unavailable'
      &&String(error.message).includes('من سجّل المخالفة لا يوقّع جزاءها')
      &&String(error.message).includes('بانتظار قرار صاحب الصلاحية')
      &&error.details.available.includes('withdraw'));
});

/* ───────────── D-20 وD-21: ثلاث وحدات كانت لا تصل أحدًا ───────────── */

test('D-21: one-to-ones and colleague feedback now reach the person they are about',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-module-feedback');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const employeeManager=db.prepare('SELECT manager_id FROM users WHERE id=?').get('employee').manager_id;
  assert.ok(employeeManager,'the seed gives the employee a manager');
  const meeting=tx(()=>scheduleOneToOne(db,users[employeeManager],{counterpart_id:'employee',scheduled_on:day(3)})).id;
  assert.ok(titles(db,users,'employee').some(x=>x.includes('لقاء فردي مجدول')),'the counterpart is told a meeting exists');
  const version=()=>db.prepare('SELECT version FROM one_to_ones WHERE id=?').get(meeting).version;
  tx(()=>meetingAction(db,users[employeeManager],meeting,'add_agenda',{version:version(),topic:'بند أجندة تجريبي'}));
  tx(()=>meetingAction(db,users[employeeManager],meeting,'add_follow_up',{version:version(),item:'بند متابعة تجريبي',due_date:day(10),owner_id:'employee'}));
  const seen=titles(db,users,'employee');
  assert.ok(seen.some(x=>x.includes('أُضيف بند إلى أجندة')));
  assert.ok(seen.some(x=>x.includes('أُسند إليك بند متابعة')));
  tx(()=>meetingAction(db,users[employeeManager],meeting,'record_held',{version:version(),shared_notes:'محضر لقاء مشترك تجريبي كافٍ الطول للاختبار'}));
  assert.ok(titles(db,users,'employee').some(x=>x.includes('سُجل محضر لقائكما')));
  // الملاحظات: تصل صاحبها ونصّها لا يدخل الإشعار.
  tx(()=>writeFeedback(db,users[employeeManager],{subject_id:'employee',kind:'appreciation',visibility:'recipient',body:'نص ملاحظة تجريبي سري لا يجوز أن يظهر في إشعار',occurred_on:today()}));
  const noteNotice=inbox(db,users,'employee').find(n=>n.title.includes('كتب')&&n.title.includes('ملاحظة عنك'));
  assert.ok(noteNotice);
  assert.ok(!`${noteNotice.title}${noteNotice.body}`.includes('سري'),'the note body never travels in the notice');
  // طلب الرأي وإجابته يصلان الطرفين.
  const request=tx(()=>requestFeedback(db,users.employee,{respondent_id:'outsider',question:'ما الذي تقترح تطويره في تعاوننا؟'})).id;
  assert.ok(titles(db,users,'outsider').some(x=>x.includes('طلب')&&x.includes('رأيك')));
  tx(()=>requestAction(db,users.outsider,request,'answer_request',{version:db.prepare('SELECT version FROM feedback_requests WHERE id=?').get(request).version,
    kind:'improvement',visibility:'recipient',body:'إجابة تجريبية كافية الطول عن سؤال التغذية الراجعة'}));
  assert.ok(titles(db,users,'employee').some(x=>x.includes('أجاب')));
  assert.ok(verifyAudit(db));
});

test('D-21: a recognition card reaches the colleague it is about',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-module-recognition');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.survey.manage',note:'منح اختبار'}));
  const value=tx(()=>defineValue(db,users.manager,{name:'الإتقان',description:'ما تعنيه القيمة عمليًا في العمل اليومي',basis:'قرار إدارة مصطنع',effective_from:today()})).id;
  tx(()=>sendRecognition(db,users.manager,{to_user_id:'employee',value_id:value,message:'شكرًا على إنجاز مصطنع في وقته',visibility:'public'}));
  const notice=inbox(db,users,'employee').find(n=>n.title.includes('قدّرك'));
  assert.ok(notice,'the recipient is told — the card is no longer a wall nobody reads');
  assert.ok(notice.title.includes('الإتقان'));
  assert.ok(!notice.body.includes('إنجاز مصطنع'),'the card text stays on its screen');
});

test('D-20: opening and chasing a policy acknowledgement round actually notifies people',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-module-ack');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'hr.policy.accept',note:'منح اختبار'}));
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('p-wt','36t','working_time','سياسة ساعات العمل المصطنعة','نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.','{}','سند مصطنع للاختبار المحلي فقط','2024-01-01','accepted','manager','hr',?,?)").run(time,time);
  const round=tx(()=>openRound(db,users.hr,{policy_id:'p-wt',audience:'all',due_on:day(7)}));
  assert.ok(round.requested>0);
  assert.equal(round.notified,round.requested-1,'everyone but the opener is told');
  const asked=inbox(db,users,'employee').find(n=>n.title.includes('مطلوب إقرارك'));
  assert.ok(asked,'the employee is told a policy awaits their acknowledgement');
  assert.ok(asked.body.includes('السياسات المطلوب إقرارها'));
  const before=inbox(db,users,'employee').length;
  const version=db.prepare('SELECT version FROM policy_ack_rounds WHERE id=?').get(round.id).version;
  const reminded=tx(()=>roundAction(db,users.hr,round.id,'remind_round',{version,note:'تذكير تجريبي'}));
  assert.ok(reminded.reminded>0,'remind_round reports what it actually sent');
  // من يذكّر لا يذكّر نفسه؛ ما عداه ممن لم يقر يصله التذكير فعلًا، لا عدادًا يرتفع.
  assert.ok(reminded.reminded>=reminded.pending-1,'everyone still pending — bar the chaser — is actually sent a reminder');
  assert.equal(inbox(db,users,'employee').length,before+1,'the recipient’s inbox is no longer byte-identical before and after');
  assert.ok(inbox(db,users,'employee').some(n=>n.title.includes('تذكير')));
  assert.ok(verifyAudit(db));
});
