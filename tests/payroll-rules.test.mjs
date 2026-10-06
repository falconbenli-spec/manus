import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { runDue } from '../app/jobs.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareRun, runAction, getRun } from '../app/payroll.mjs';
import { preRunChecks } from '../app/payroll-checks.mjs';
import { extrasBoard, proposeAdvance, proposeAdjustment, decideAdjustment, proposeClassifiedDeduction, prepareSettlement, decideSettlement, recordSettlementDues, settlementReadings } from '../app/payroll-extras.mjs';
import { decideRule, rulesBoard, acceptedRule, excludedServiceDays, duesDueOn, duesCountdown, paydayFor, shiftToWorkingDay, roundMoney, art36Example, addDays, registerFineSource } from '../app/payroll-rules.mjs';
import { submitResignation, resignationAction, resignationsBoard, registerInvestigationSource, openInvestigationsFor, JOB_TYPE } from '../app/resignations.mjs';
import { computePerDiem, proposeTravel, travelAction, travelBoard, extensionAction } from '../app/travel.mjs';
import { saveStepTemplate, openBundle } from '../app/lifecycle.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import { lettersBoard, templatesBoard, adoptStarter, approveTemplate, previewLetter, requestLetter, letterAction, letterDocument, letterPrintable, splitLanguages } from '../app/letters.mjs';
import { addWorkingDays, holidaySet } from '../app/work-calendar.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const thisMonth=()=>today().slice(0,7);
// منتصف نهار يوم بتوقيت الرياض بالمللي ثانية، لحقن ساعة الطابور.
const at=date=>Date.parse(`${date}T12:00:00+03:00`);
const eos={wage_base:['basic','housing'],first_years:5,first_rate_bp:5000,later_rate_bp:10000,reason_factors_bp:{employer_termination:10000,contract_expiry:10000,other:10000},resignation_tiers:[{min_years:0,factor_bp:0},{min_years:2,factor_bp:3333},{min_years:5,factor_bp:6667},{min_years:10,factor_bp:10000}]};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-payroll-rules');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار قواعد اللائحة'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);grant('reviewer','payroll.review');
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const contract=(user_id,{start='2026-01-01',basic='8000.00',housing='2000.00',notice=60}={})=>{
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:notice,pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:housing}],document_reference:'عقد مصطنع'}));
    const step=(who,action,values={})=>tx(()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version,...values}));
    step('hr','submit_contract');step('hr-manager','approve_contract');return {id,step};
  };
  const seedId={resignation:'reg-seed-resignation',settlement:'reg-seed-settlement',deductions:'reg-seed-deductions',pay_rules:'reg-seed-pay-rules',travel_per_diem:'reg-seed-travel',social_insurance:'reg-seed-social-insurance'};
  const accept=(kind,choices={},effective='2019-01-01')=>tx(()=>decideRule(db,users['hr-manager'],seedId[kind],'accept',{effective_from:effective,choices,note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
  const resignation=(who,id)=>resignationsBoard(db,users[who]).resignations.find(r=>r.id===id);
  // D-01b: التسوية النهائية لا تُعتمد قبل إخلاء طرف تحققت منه المنصة، وأوله حزمة مغادرة مفتوحة.
  const offboarding=(user_id,effective,department='creative')=>{
    tx(()=>saveStepTemplate(db,users.hr,{kind:'offboarding',code:'OFF-'+user_id,title:'خطوة مغادرة مصطنعة',department_id:department,owner_role:'manager',target_days:2,
      acceptance:'دليل مصطنع موثق يطابق معيار الخطوة',basis:'قرار مصطنع من مالك إجراء الإدارة بتاريخ مصطنع'}));
    return tx(()=>openBundle(db,users.hr,{kind:'offboarding',employee_id:user_id,owner_id:'manager',effective_date:effective,date_basis:'خطاب إنهاء مصطنع مؤرخ ومؤكد'})).id;
  };
  return {db,users,tx,grant,contract,accept,resignation,offboarding};
}

test('regulation policies: seeded drafts cite their articles, stay inactive until the HR manager accepts them, and choices are made by the acceptor',t=>{
  const {db,users,tx,accept}=fixture(t);
  const board=rulesBoard(db,users['hr-manager']);
  assert.equal(board.policies.filter(p=>p.seeded).length,6,'خمس قواعد من الترحيل 102 والتأمينات الاجتماعية من الترحيل 127');
  assert.ok(board.policies.every(p=>p.articles.length&&p.source.includes('لائحة')),'every seeded value cites its article and source');
  assert.ok(Object.values(board.active).every(x=>x===null),'nothing is active before acceptance');
  assert.deepEqual([board.art36_example.literal_minor,board.art36_example.labor_law_minor],[7000000,4500000]);
  assert.throws(()=>rulesBoard(db,users.employee),code('not_permitted'));
  assert.throws(()=>tx(()=>decideRule(db,users.hr,'reg-seed-settlement','accept',{effective_from:'2020-01-01',note:'قبول من غير المدير'})),code('not_permitted'));
  assert.throws(()=>accept('settlement'),code('choice_required'),'Art. 36(2) must be chosen by the HR manager');
  assert.throws(()=>accept('pay_rules'),code('choice_required'),'the rounding rule is an HR decision');
  accept('settlement',{art36_reading:'literal'});
  assert.equal(acceptedRule(db,'36t','settlement').parameters.art36_reading,'literal');
  assert.equal(acceptedRule(db,'isolated','settlement'),null,'acceptance is per tenant');
  assert.throws(()=>db.prepare("UPDATE regulation_policies SET parameters='{}' WHERE id='reg-seed-settlement'").run(),/never rewritten/);
  assert.ok(verifyAudit(db));
});

test('resignation: deemed accepted by the daily job after 30 days with no reply, the clock waits for the accepted rule, and deferral is limited to 60 days with a reason',t=>{
  const {db,users,tx,contract,accept,resignation}=fixture(t);
  contract('employee');contract('outsider');
  const d0=today(),id=tx(()=>submitResignation(db,users.employee,{letter_date:d0,reason:'انتقال إلى مدينة أخرى',proposed_last_day:addDays(d0,40)})).id;
  let r=resignation('employee',id);
  assert.equal(r.addressed_to_name,users.manager.name,'addressed to the department manager, HR copied');assert.equal(r.hr_copied,true);
  assert.equal(r.clock.active,false,'the clock is inactive before the HR manager accepts the rule');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type=?').get(JOB_TYPE).n,1);
  assert.throws(()=>tx(()=>submitResignation(db,users.employee,{letter_date:d0,proposed_last_day:addDays(d0,40)})),code('resignation_open'));
  // اليوم 31 بلا قاعدة مقبولة: تُعلَّق وتعيد جدولة نفسها لليوم التالي.
  assert.deepEqual(runDue(db,{now:at(addDays(d0,31))}).map(x=>x.outcome),['done']);
  assert.match(db.prepare('SELECT hold_note FROM resignations WHERE id=?').get(id).hold_note,/لم يقبلها/);
  assert.equal(resignation('employee',id).status,'submitted');
  accept('resignation');
  assert.equal(resignation('employee',id).clock.deemed_on,addDays(d0,31));
  runDue(db,{now:at(addDays(d0,32))});
  r=resignation('employee',id);
  assert.equal(r.status,'deemed_accepted');assert.equal(r.accepted_on,addDays(d0,31),'more than thirty days without a reply');
  assert.equal(r.offboarding_note,'','the employee does not see internal notes');
  assert.match(resignation('hr-manager',id).offboarding_note,/لا خطوات مسجلة/,'no offboarding template: the reason is recorded, the acceptance stands');
  // التأجيل: من صاحب الصلاحية، بسبب مكتوب، وفي حد الستين يومًا من التقديم.
  const second=tx(()=>submitResignation(db,users.outsider,{letter_date:d0,reason:'فرصة أخرى',proposed_last_day:addDays(d0,30)})).id;
  let s=resignation('hr-manager',second);
  assert.ok(s.actions.includes('defer_resignation')&&s.actions.includes('accept_resignation'));
  assert.equal(resignation('manager',second).actions.length,0,'the department manager receives the letter but is not the authority holder');
  assert.throws(()=>tx(()=>resignationAction(db,users['hr-manager'],second,'defer_resignation',{version:s.version,deferred_until:addDays(d0,61),reason:'تسليم مشروع العميل المصطنع قبل المغادرة'})),code('deferral_limit'));
  assert.throws(()=>tx(()=>resignationAction(db,users['hr-manager'],second,'defer_resignation',{version:s.version,deferred_until:addDays(d0,45),reason:'قصير'})),code('invalid_text'));
  assert.throws(()=>tx(()=>resignationAction(db,users.outsider,second,'defer_resignation',{version:s.version,deferred_until:addDays(d0,45),reason:'أؤجل استقالتي بنفسي لسبب ما'})),code('action_unavailable'));
  tx(()=>resignationAction(db,users['hr-manager'],second,'defer_resignation',{version:s.version,deferred_until:addDays(d0,45),reason:'تسليم مشروع العميل المصطنع قبل المغادرة'}));
  s=resignation('hr-manager',second);
  assert.equal(s.status,'deferred');assert.equal(s.clock.deemed_on,addDays(d0,45));
  runDue(db,{now:at(addDays(d0,33))});
  assert.equal(resignation('hr-manager',second).status,'deferred','deferred acceptance is not deemed at day 31');
  runDue(db,{now:at(addDays(d0,45))});
  s=resignation('hr-manager',second);
  assert.equal(s.status,'deemed_accepted');assert.equal(s.accepted_on,addDays(d0,45));
  assert.ok(s.actions.includes('set_last_day'),'the authority holder still sets the last working day');
  assert.throws(()=>tx(()=>resignationAction(db,users['hr-manager'],second,'set_last_day',{version:s.version,last_working_day:addDays(d0,50),notice_waived:false})),code('notice_period'));
  tx(()=>resignationAction(db,users['hr-manager'],second,'set_last_day',{version:s.version,last_working_day:addDays(d0,50),notice_waived:true,note:'إعفاء من بقية الإشعار'}));
  assert.equal(resignation('hr-manager',second).last_working_day,addDays(d0,50));
  assert.throws(()=>db.prepare("UPDATE resignations SET status='submitted',version=version+1 WHERE id=?").run(second),/final/);
  assert.ok(verifyAudit(db));
});

test('resignation: an open investigation or suspension holds acceptance until it is decided, and never blocks the letter itself (Art. 37/5)',t=>{
  const {db,users,tx,accept,resignation}=fixture(t);
  accept('resignation');
  const d0=today(),openCase=(respondent)=>{const id=`case-${respondent}`;db.prepare("INSERT INTO hr_cases(id,tenant_id,reporter_id,category,subject,description,respondent_id,status,created_at,updated_at) VALUES(?,'36t','manager','violation_report','مخالفة مصطنعة','وصف مصطنع لبلاغ مخالفة يكفي للاختبار الآلي',?,'open',?,?)").run(id,respondent,d0,d0);return id;};
  const caseId=openCase('employee');
  assert.equal(openInvestigationsFor(db,'36t','employee').length,1);
  // صُحِّح في 22 سبتمبر 2026 على اللائحة الموقّعة (م37/5، ص p016): «لا يجوز قبول استقالة العامل المُحال إلى التحقيق،
  // أو الموقوف عن العمل؛ حتى يُبتَّ في أمره» — المنع على القبول لا على التقديم. كان هذا السطر يطالب برفض التقديم،
  // فيضيع على الموظف تاريخ خطابه ومدة إشعاره. صار يطالب بتسجيل الخطاب مع وقف قبوله. بقية الاختبار كما سُجِّلت.
  const id=tx(()=>submitResignation(db,users.employee,{letter_date:d0,proposed_last_day:addDays(d0,30)})).id;
  assert.equal(resignation('hr-manager',id).actions.includes('accept_resignation'),false,'يُسجَّل الخطاب ولا يُقبل ما دام التحقيق مفتوحًا');
  db.prepare("UPDATE hr_cases SET status='closed',outcome='unfounded',closing_reason='لم تثبت المخالفة بعد التحقيق',closed_by='hr',closed_at=?,version=version+1 WHERE id=?").run(d0,caseId);
  // خطاف وحدة الجزاءات: مصدر مسجل يُعد تحقيقًا مفتوحًا.
  let suspended=true;registerInvestigationSource('discipline-test',(db,tenant,user)=>suspended&&user==='employee'?[{source:'discipline',id:'D-1',title:'إيقاف عن العمل حتى البت'}]:[]);
  let r=resignation('hr-manager',id);
  assert.equal(r.actions.includes('accept_resignation'),false);assert.equal(r.hold.count,1);assert.deepEqual(r.hold.items,['إيقاف عن العمل حتى البت']);
  assert.deepEqual(resignation('employee',id).hold.items,[],'the employee is not shown the confidential details');
  assert.throws(()=>tx(()=>resignationAction(db,users['hr-manager'],id,'accept_resignation',{version:r.version,last_working_day:addDays(d0,30),notice_waived:true})),code('investigation_open'));
  runDue(db,{now:at(addDays(d0,31))});
  r=resignation('hr-manager',id);
  assert.equal(r.status,'submitted','not deemed accepted while the matter is open');assert.match(r.hold_note,/م37\/5/);
  suspended=false;
  runDue(db,{now:at(addDays(d0,32))});
  assert.equal(resignation('hr-manager',id).status,'deemed_accepted','accepted once the matter is decided');
});

test('resignation: acceptance by the authority holder opens the offboarding bundle from lifecycle, with its clearance items',t=>{
  const {db,users,tx,contract,resignation}=fixture(t);
  contract('employee');
  tx(()=>saveStepTemplate(db,users.hr,{kind:'offboarding',code:'OFF-HANDOVER',title:'تسليم العهد والمهام',department_id:'hr',owner_role:'hr',target_days:2,acceptance:'محضر تسليم موقع من المدير المباشر',depends_on:null,basis:'قالب مغادرة مصطنع للاختبار الآلي'}));
  const d0=today(),id=tx(()=>submitResignation(db,users.employee,{letter_date:d0,proposed_last_day:addDays(d0,10)})).id;
  let r=resignation('hr-manager',id);
  assert.throws(()=>tx(()=>resignationAction(db,users['hr-manager'],id,'accept_resignation',{version:r.version,last_working_day:addDays(d0,10),notice_waived:false})),code('notice_period'),'the 60-day notice applies unless waived');
  tx(()=>resignationAction(db,users['hr-manager'],id,'accept_resignation',{version:r.version,last_working_day:addDays(d0,10),notice_waived:true,note:'قبول مع الإعفاء من الإشعار'}));
  r=resignation('hr-manager',id);
  assert.equal(r.status,'accepted');assert.ok(r.offboarding_bundle_id);
  const bundle=db.prepare('SELECT * FROM lifecycle_bundles WHERE id=?').get(r.offboarding_bundle_id);
  assert.deepEqual([bundle.kind,bundle.employee_id,bundle.owner_id,bundle.effective_date],['offboarding','employee','hr',addDays(d0,10)]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_steps WHERE bundle_id=?').get(bundle.id).n,1);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM lifecycle_clearance_items WHERE bundle_id=?').get(bundle.id).n>=1,'clearance derived from what the platform knows');
  assert.ok(verifyAudit(db));
});

test('settlement: both Art. 36(2) readings side by side, no approval before the HR manager chooses, unpaid leave over 20 days excluded, dues deadline and death',t=>{
  const {db,users,tx,contract,accept,offboarding}=fixture(t);
  const input={wageBase:1000000,serviceDays:365*7,reason:'employer_termination',leaveDays:0,dailyWage:0,advances:0};
  const both=settlementReadings(eos,input);
  assert.deepEqual([both.literal.award_minor,both.labor_law.award_minor],[7000000,4500000],'7 years at 10,000: 70,000 literal vs 45,000 labor law');
  assert.equal(settlementReadings(eos,{...input,serviceDays:365*4}).literal.award_minor,settlementReadings(eos,{...input,serviceDays:365*4}).labor_law.award_minor,'below five years the readings agree');
  assert.deepEqual([excludedServiceDays(22,{unpaid_leave_threshold_days:20,unpaid_leave_mode:'excess'}),excludedServiceDays(22,{unpaid_leave_threshold_days:20,unpaid_leave_mode:'total_when_over'}),excludedServiceDays(20,{unpaid_leave_threshold_days:20,unpaid_leave_mode:'total_when_over'})],[2,22,0]);
  // عقد من 2019-01-01 إلى 2025-12-31 = 2557 يومًا، وإجازة بلا أجر 22 يومًا ← يُحسم يومان ← 2555 = 7 سنوات تمامًا.
  const c=contract('employee',{start:'2019-01-01'});
  db.prepare("INSERT INTO leave_calendars VALUES('cal-2024','36t','creative','hr','تقويم مصطنع','2024-01-01','2024-12-31','[0,1,2,3,4]','[]','Asia/Riyadh',1,'2024-01-01')").run();
  db.prepare("INSERT INTO leave_balances VALUES('bal-unpaid','36t','employee','unpaid',2024,'cal-2024','2024-01-01','2024-01-01')").run();
  db.prepare("INSERT INTO leave_requests(id,tenant_id,employee_id,balance_id,start_date,end_date,days,work_dates_json,reason,status,created_at,updated_at) VALUES('lv-1','36t','employee','bal-unpaid','2024-03-01','2024-03-22',16,'[]','إجازة استثنائية مصطنعة','approved','2024-02-01','2024-02-01')").run();
  c.step('hr-manager','end_contract',{ended_on:'2025-12-31',reason:'إنهاء من صاحب العمل بحسب قرار مصطنع'});
  const tidy={contract_id:c.id,end_reason:'employer_termination',leave_days:0,evidence:'قرار الإنهاء المصطنع ورصيد الإجازة من سجل الإجازات'};
  tx(()=>preparePolicy(db,users.hr,{kind:'end_of_service',title:'نهاية الخدمة',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters:eos}));
  tx(()=>decidePolicy(db,users['hr-manager'],db.prepare("SELECT id FROM hr_policies WHERE kind='end_of_service'").get().id,'accept',{note:'اعتماد مصطنع للاختبار'}));
  const first=tx(()=>prepareSettlement(db,users.hr,tidy)).id;
  let s=extrasBoard(db,users['hr-manager']).settlements.find(x=>x.id===first);
  assert.equal(s.rule.art36_reading,null);assert.match(s.rule.note,/لم تُختر/);assert.equal(s.rule.excluded_days,0,'no exclusion before the rule is accepted');
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],first,'approve',{note:'اعتماد قبل اختيار القراءة'})),code('art36_reading_required'));
  accept('settlement',{art36_reading:'literal'});
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],first,'approve',{note:'اعتماد مخالصة أعدت قبل القبول'})),code('art36_reading_mismatch'));
  tx(()=>decideSettlement(db,users['hr-manager'],first,'reject',{note:'أُعدت قبل قبول سياسة المخالصة'}));
  const second=tx(()=>prepareSettlement(db,users.hr,tidy)).id;
  s=extrasBoard(db,users['hr-manager']).settlements.find(x=>x.id===second);
  assert.deepEqual([s.service_days,s.rule.unpaid_leave_days,s.rule.excluded_days],[2555,22,2]);
  assert.deepEqual([s.rule.literal_award_minor,s.rule.labor_law_award_minor,s.award_minor],[7000000,4500000,7000000],'both readings shown; the chosen literal reading is applied');
  assert.equal(s.rule.dues_due_on,'2026-01-07','7 days when the company ends the contract (Art. 50/2)');
  assert.equal(s.rule.countdown.state,'overdue');
  // D-01b: قبل فتح حزمة المغادرة لا إخلاء طرف تحققت منه المنصة، فلا اعتماد.
  assert.throws(()=>tx(()=>decideSettlement(db,users['hr-manager'],second,'approve',{note:'اعتماد قبل فتح حزمة المغادرة'})),code('clearance_open'));
  offboarding('employee','2025-12-31');
  tx(()=>decideSettlement(db,users['hr-manager'],second,'approve',{note:'راجعت القراءة المختارة ومدة الخدمة بعد الحسم'}));
  s=extrasBoard(db,users.reviewer).settlements.find(x=>x.id===second);
  assert.ok(s.actions.includes('record_dues_payment'));
  const paid=tx(()=>recordSettlementDues(db,users.reviewer,second,{paid_on:today(),reference:'trx-eos-1'}));
  assert.equal(paid.within_deadline,false,'late payment is recorded as late');
  assert.equal(extrasBoard(db,users.reviewer).settlements.find(x=>x.id===second).rule.countdown.state,'paid');
  assert.throws(()=>db.prepare("UPDATE settlement_rule_basis SET dues_paid_on=NULL,dues_recorded_by=NULL WHERE settlement_id=?").run(second),/fixed/);
  // الاستقالة: 14 يومًا.
  assert.equal(duesDueOn('2026-03-01','worker',null),'2026-03-15');assert.equal(duesDueOn('2026-03-01','company',null),'2026-03-08');
  assert.deepEqual(duesCountdown('2026-03-15',null,'2026-03-10'),{state:'open',days_left:5,label:'باقٍ 5 يوم على مهلة صرف المستحقات'});
  // الوفاة (م38/3): أجر الشهر كاملًا ورصيد الإجازة للورثة.
  const d=contract('outsider',{start:'2024-01-01',basic:'6000.00',housing:'1500.00'});
  d.step('hr-manager','end_contract',{ended_on:'2026-01-10',reason:'وفاة العامل رحمه الله (حالة مصطنعة)'});
  const death=tx(()=>prepareSettlement(db,users.hr,{contract_id:d.id,end_reason:'other',death:true,leave_days:12,evidence:'شهادة وفاة مصطنعة ورصيد الإجازة من السجل'})).id;
  s=extrasBoard(db,users['hr-manager']).settlements.find(x=>x.id===death);
  assert.equal(s.rule.death,true);assert.equal(s.rule.heirs_month_wage_minor,750000,'the full month wage, not pro rata');
  assert.equal(s.leave_payout_minor,12*25000,'leave balance at the daily wage');
  assert.equal(s.rule.heirs_total_minor,s.net_minor+750000);
  assert.throws(()=>tx(()=>prepareSettlement(db,users.hr,{contract_id:d.id,end_reason:'resignation',death:true,leave_days:0,evidence:'تصنيف خاطئ للوفاة كاستقالة'})),code('death'));
  assert.ok(verifyAudit(db));
});

test('deduction caps: advance instalment ≤10%, court order ≤25%, fines ≤5 days a month — refused up front, and a run carrying a breach cannot move to review',t=>{
  const {db,users,tx,contract,accept}=fixture(t);
  contract('employee');const month=thisMonth();
  // قبل القبول لا سقف: يُقترح ويُعتمد غرامة كبيرة، ثم يقبل المدير السقوف فيمنع المسير.
  const fine=tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'2000.00',reason:'غرامة مصطنعة بقرار جزاء محسوم',class:'fine',reference:'قرار جزاء مصطنع 7'})).id;
  tx(()=>decideAdjustment(db,users['hr-manager'],fine,'approve',{note:'غرامة معتمدة'}));
  accept('deductions');
  assert.throws(()=>tx(()=>proposeAdvance(db,users.hr,{user_id:'employee',amount:'5000.00',installments:3,first_month:month,reason:'سلفة مصطنعة بقسط كبير'})),code('advance_cap'),'1,666.67 > 10% of 10,000');
  tx(()=>proposeAdvance(db,users.hr,{user_id:'employee',amount:'5000.00',installments:5,first_month:month,reason:'سلفة مصطنعة بقسط 1,000'}));
  assert.throws(()=>tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'2600.00',reason:'تنفيذ حكم قضائي مصطنع',class:'court_order',reference:'حكم مصطنع 12/1447'})),code('deduction_cap'),'more than a quarter of the wage');
  tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'2500.00',reason:'تنفيذ حكم قضائي مصطنع',class:'court_order',reference:'حكم مصطنع 12/1447'}));
  assert.throws(()=>tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'10.00',reason:'غرامة مصطنعة إضافية',class:'fine',reference:'قرار جزاء مصطنع 8'})),code('deduction_cap'),'the approved 2,000 fine already exceeds 5 days (1,666.66)');
  registerFineSource('discipline-register',()=>0);
  const run=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month})).id);
  const checks=preRunChecks(db,users.hr,run);
  assert.ok(checks.some(c=>c.level==='block'&&c.article==='م116'));
  assert.throws(()=>tx(()=>runAction(db,users.hr,run.id,'submit_run',{version:run.version})),code('deduction_cap'));
  assert.ok(verifyAudit(db));
});

test('pay rules: a payday on a rest day or holiday moves to the previous working day, housing is checked at 25% of basic, and rounding up to the riyal applies only once accepted',t=>{
  const {db,users,tx,contract,accept}=fixture(t);
  assert.deepEqual(shiftToWorkingDay('2026-11-27',new Set()),{date:'2026-11-26',shifted:true,reason:'يوم راحة أسبوعية'},'Friday → Thursday');
  let p=paydayFor(db,'36t','2026-11');
  assert.deepEqual([p.nominal,p.actual,p.active],['2026-11-27','2026-11-26',false],'shown as proposed while the rule is a draft');
  for(const date of ['2026-12-27','2026-12-24'])db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,'عطلة مصطنعة','تعميم عطلة مصطنع للاختبار','approved','hr','hr-manager',?,?)").run('h-'+date,date,date,date);
  assert.equal(paydayFor(db,'36t','2026-12').actual,'2026-12-23','Sunday holiday, weekend, Thursday holiday → Wednesday');
  assert.equal(roundMoney(1234501,'riyal_up'),1234600);assert.equal(roundMoney(1234501,'halala'),1234501);
  contract('employee',{basic:'8000.40',housing:'1000.00'});
  const month=thisMonth();
  let run=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month})).id);
  const halala=run.lines[0].earnings.find(x=>x.component==='basic').amount_minor;
  assert.equal(halala%100===0,false,'halala until the rounding rule is accepted');
  accept('pay_rules',{rounding:'riyal_up'});
  p=paydayFor(db,'36t','2026-11');assert.equal(p.active,true);
  run=tx(()=>runAction(db,users.hr,run.id,'recalculate',{version:run.version}));
  assert.ok(run.lines[0].earnings.every(x=>x.amount_minor%100===0),'Art. 50/5: every item rounded up to the riyal');
  assert.equal(run.lines[0].net_minor,run.lines[0].gross_minor-run.lines[0].unpaid_absence_minor-run.lines[0].social_insurance_minor);
  const checks=preRunChecks(db,users.hr,run);
  assert.ok(checks.some(c=>c.article==='م67/2'&&c.level==='warn'),'housing 1,000 ≠ 25% of basic');
  assert.ok(checks.some(c=>c.article==='م48'));
});

test('business travel: per-diem by grade with distance eligibility and the quarter/half reductions, extensions capped at two weeks by the authority holder, a proposed payroll adjustment and receipts through expenses',t=>{
  const {db,users,tx,contract,accept}=fixture(t);
  const params={grades:{ceo:{name:'ر',abroad_minor:250000,domestic_minor:210000},deputy:{name:'ن',abroad_minor:150000,domestic_minor:100000},gm:{name:'م',abroad_minor:90000,domestic_minor:60000},employee:{name:'ع',abroad_minor:50000,domestic_minor:40000}},
    distance_km:{paved:75,unpaved:40,rough:15},housing_and_transport_bp:2500,housing_only_bp:5000,extension_max_days:14,authority_capability:'hr.contracts.approve'};
  const per=x=>computePerDiem(params,{scope:'domestic',distance_km:900,road_type:'paved',grade:'employee',housing:'none',transport:'none',days:3,...x});
  assert.equal(per({housing:'company'}).allowance_minor,60000,'3 × 400 × ½ = 600');
  assert.equal(per({housing:'company',transport:'company'}).allowance_minor,30000,'¼ with housing and transport');
  assert.equal(per({}).allowance_minor,120000);
  assert.equal(per({housing:'company_temporary',transport:'company'}).allowance_minor,120000,'temporary housing does not reduce');
  assert.equal(per({housing:'third_party',transport:'third_party'}).allowance_minor,120000,'housing from another party does not reduce');
  assert.equal(per({housing:'third_party_charged',transport:'third_party_charged'}).allowance_minor,30000,'unless the cost is charged to the company');
  assert.equal(per({distance_km:60}).eligible,false,'60 km on a paved road: no per-diem');
  assert.equal(per({distance_km:45,road_type:'unpaved'}).eligible,true);assert.equal(per({distance_km:14,road_type:'rough'}).eligible,false);
  assert.equal(computePerDiem(params,{scope:'abroad',grade:'ceo',housing:'none',transport:'none',days:2}).allowance_minor,500000);
  contract('employee');
  const d0=addDays(today(),5),propose=extra=>tx(()=>proposeTravel(db,users.employee,{task:'اجتماع عميل مصطنع في جدة',destination:'جدة',scope:'domestic',start_date:d0,end_date:addDays(d0,2),...extra})).id;
  const trip=propose({distance_km:950,road_type:'paved'});
  const view=id=>travelBoard(db,users['hr-manager']).decisions.find(x=>x.id===id);
  assert.throws(()=>tx(()=>travelAction(db,users['hr-manager'],trip,'approve_travel',{version:view(trip).version,grade:'employee',housing:'company',transport:'none'})),code('policy_required'),'no allowance before the table is accepted');
  accept('travel_per_diem');
  assert.throws(()=>tx(()=>travelAction(db,users.employee,trip,'approve_travel',{version:view(trip).version,grade:'employee',housing:'company',transport:'none'})),code('action_unavailable'),'the traveller never decides');
  const approved=tx(()=>travelAction(db,users['hr-manager'],trip,'approve_travel',{version:view(trip).version,grade:'employee',housing:'company',transport:'none'}));
  assert.equal(approved.allowance_minor,60000);
  const adj=db.prepare('SELECT a.*,c.class FROM payroll_adjustments a JOIN payroll_adjustment_classes c ON c.adjustment_id=a.id WHERE a.id=?').get(approved.adjustment_id);
  assert.deepEqual([adj.kind,adj.status,adj.amount_minor,adj.class,adj.user_id],['allowance','proposed',60000,'travel_per_diem','employee'],'a PROPOSED adjustment, never a payment');
  const near=propose({distance_km:60,road_type:'paved',start_date:addDays(d0,20),end_date:addDays(d0,21)});
  const none=tx(()=>travelAction(db,users['hr-manager'],near,'approve_travel',{version:view(near).version,grade:'employee',housing:'none',transport:'none'}));
  assert.deepEqual([none.eligible,none.adjustment_id],[false,null]);
  // التمديد: بعد بحث ما أنجز، بقرار صاحب الصلاحية، ولا يتجاوز مجموعه أسبوعين.
  const ext=tx(()=>travelAction(db,users.employee,trip,'request_extension',{version:view(trip).version,days:10,progress_review:'أُنجز نصف ورش العمل وبقي التدريب الميداني مع فريق العميل'})).id;
  assert.throws(()=>tx(()=>extensionAction(db,users.employee,ext,'approve_extension',{note:'أعتمد تمديدي'})),code('not_permitted'));
  const decided=tx(()=>extensionAction(db,users['hr-manager'],ext,'approve_extension',{note:'راجعت ما أنجز والمتبقي'}));
  assert.equal(decided.allowance_minor,200000,'10 × 400 × ½');
  assert.equal(view(trip).end_date,addDays(d0,12));
  assert.throws(()=>tx(()=>travelAction(db,users.employee,trip,'request_extension',{version:view(trip).version,days:5,progress_review:'بقي تسليم التقرير النهائي للعميل بعد المراجعة'})),code('extension_limit'));
  // التأشيرة والرسوم: مطالبة مصروفات عادية مربوطة بالانتداب.
  const receipt=tx(()=>travelAction(db,users.employee,trip,'submit_receipt',{version:view(trip).version,cost_kind:'fees',expense_date:today(),amount:'150.00',receipt_reference:'RCPT-AIR-9',description:'رسوم مطار مصطنعة'}));
  assert.equal(db.prepare('SELECT category FROM expense_claims WHERE id=?').get(receipt.claim_id).category,'travel');
  assert.equal(view(trip).receipts.length,1);
  assert.ok(verifyAudit(db));
});

// ————— خطاب التعريف: معالج الطلب من البداية إلى الإصدار —————

function letterFixture(t,{catalog=false}={}){
  const db=openDb(':memory:');seed(db,'synthetic-letter-wizard');if(catalog)installServiceCatalog(db);seedHrDemo(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const issuer=catalog?users['head-hr']:users.manager;
  tx(()=>grantAccess(db,users.admin,{user_id:issuer.id,capability:'hr.letters.issue',note:'مالك إجراء الخطابات المصطنع'}));
  // النص المبدئي: يتبناه معد القالب مسودةً باسمه، ويعتمده شخص آخر يملك الإصدار.
  const publish=code=>{
    tx(()=>adoptStarter(db,users.hr,code,{}));
    const draft=templatesBoard(db,issuer).types.find(x=>x.code===code).draft;
    tx(()=>approveTemplate(db,issuer,code,{effective_from:today(),note:'راجعت النص المبدئي ثنائي اللغة وأعتمده',version:draft.version}));
  };
  const view=(who,id)=>lettersBoard(db,who).requests.find(r=>r.id===id);
  const issue=id=>{tx(()=>letterAction(db,users.hr,id,'prepare_letter',{version:view(users.hr,id).version,note:'طوبق على العقد'}));tx(()=>letterAction(db,issuer,id,'issue_letter',{version:view(issuer,id).version,note:'صدر'}));return view(users.employee,id);};
  return {db,users,tx,issuer,publish,view,issue};
}

test('letter templates: bilingual starter drafts are offered, marked as needing HR approval, adopted by the preparer and approved by someone else',t=>{
  const {db,users,tx,issuer,publish}=letterFixture(t);
  const board=templatesBoard(db,users.hr);
  for(const code of ['salary','employment','experience','embassy','bank','to_whom']){
    const type=board.types.find(x=>x.code===code);
    assert.ok(type.actions.includes('adopt_starter'),code);assert.match(type.starter.status_note,/تحتاج اعتماد الموارد البشرية/);
    assert.ok(splitLanguages(type.starter.body).en,`${code} starter is bilingual`);
  }
  assert.ok(!board.types.some(x=>x.published),'nothing is published out of the box');
  tx(()=>adoptStarter(db,users.hr,'salary',{}));
  assert.throws(()=>tx(()=>approveTemplate(db,users.hr,'salary',{effective_from:today(),note:'أعتمد ما تبنيته بنفسي',version:1})),code('not_permitted'));
  publish('employment');
  assert.ok(templatesBoard(db,issuer).types.find(x=>x.code==='employment').published.bilingual);
});

test('letter wizard: each option path — type, addressee from the lists or validated free text, language, salary detail and period, purpose, delivery, copies, urgency — with a masked preview before submitting',t=>{
  const {db,users,tx,publish,view}=letterFixture(t);
  for(const code of ['salary','employment','embassy','bank','to_whom','experience'])publish(code);
  const e=users.employee,board=lettersBoard(db,e);
  assert.ok(board.addressees.bank.some(b=>b.code==='rajhi')&&board.addressees.embassy.some(b=>b.code==='fr'&&b.country_ar==='فرنسا')&&board.addressees.government.length);
  assert.equal(board.new_request_route,'#letters/new?type=');
  // المعاينة: النص كما سيصدر بلغتيه، والراتب محجوب، ولا كتابة.
  const before=db.prepare('SELECT COUNT(*) AS n FROM letter_requests').get().n;
  const p=previewLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'both',salary_detail:'breakdown',salary_period:'annual',delivery:'digital'});
  assert.match(p.body,/مصرف الراجحي/);assert.match(p.body,/To: Al Rajhi Bank/);assert.match(p.body,/Subject: Salary certificate/);
  assert.match(p.body,/•••••• ريال سنويًا \(الراتب الأساسي ••••••، بدل السكن ••••••، بدل النقل ••••••\)/);
  assert.match(p.body,/SAR •••••• per year \(basic salary ••••••/);
  assert.equal(/\d{1,3},\d{3}\.\d{2}/.test(p.body),false,'no salary figure in the preview');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM letter_requests').get().n,before,'the preview writes nothing');
  // اللغة: العربية وحدها، والإنجليزية وحدها.
  assert.equal(/Subject/.test(previewLetter(db,e,{type_code:'employment',addressee_kind:'government',addressee_code:'jawazat',language:'ar'}).body),false);
  const en=previewLetter(db,e,{type_code:'employment',addressee_kind:'government',addressee_code:'jawazat',language:'en'}).body;
  assert.match(en,/General Directorate of Passports/);assert.equal(/تشهد/.test(en),false);
  // «لمن يهمه الأمر» والنص الحر المتحقق منه.
  assert.match(previewLetter(db,e,{type_code:'to_whom',language:'both'}).body,/To whom it may concern/);
  assert.match(previewLetter(db,e,{type_code:'employment',addressee_kind:'other',addressee:'شركة تأجير مصطنعة'}).body,/شركة تأجير مصطنعة/);
  for(const bad of ['<script>x</script>','12345','www.example.com','{{salary_total}}'])assert.throws(()=>previewLetter(db,e,{type_code:'employment',addressee_kind:'other',addressee:bad}),code('addressee'),bad);
  assert.throws(()=>previewLetter(db,e,{type_code:'bank',addressee_kind:'embassy',addressee_code:'fr',purpose:'فتح حساب جاري'}),code('addressee_kind'),'a bank letter goes to a bank');
  assert.throws(()=>previewLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'no-such-bank'}),code('addressee_code'));
  // الغرض: مطلوب للسفارة (مع تاريخي السفر والوجهة) وللبنك.
  assert.throws(()=>previewLetter(db,e,{type_code:'bank',addressee_kind:'bank',addressee_code:'snb'}),code('purpose'));
  assert.throws(()=>previewLetter(db,e,{type_code:'embassy',addressee_kind:'embassy',addressee_code:'fr',purpose:'زيارة سياحية'}),code('invalid_date'));
  const from=addDays(today(),20),to=addDays(today(),34);
  const emb=previewLetter(db,e,{type_code:'embassy',addressee_kind:'embassy',addressee_code:'fr',purpose:'زيارة سياحية',travel_from:from,travel_to:to,language:'both'});
  assert.match(emb.body,/سفارة فرنسا/);assert.match(emb.body,new RegExp(`إلى فرنسا في الفترة من ${from} إلى ${to}`));assert.match(emb.body,/to France from/);
  // التسليم والنسخ والاستعجال.
  assert.throws(()=>previewLetter(db,e,{type_code:'employment',addressee_kind:'to_whom',delivery:'digital',copies:3}),code('copies'));
  assert.throws(()=>previewLetter(db,e,{type_code:'employment',addressee_kind:'to_whom',delivery:'printed',copies:6}),code('copies'));
  assert.throws(()=>previewLetter(db,e,{type_code:'employment',addressee_kind:'to_whom',urgent:true}),code('invalid_text'),'urgent needs a reason');
  const urgent=tx(()=>requestLetter(db,e,{type_code:'employment',addressee_kind:'to_whom',delivery:'printed',copies:3,urgent:true,urgent_reason:'موعد مراجعة الجوازات غدًا'})).id;
  const u=view(e,urgent);
  assert.deepEqual([u.options.delivery,u.options.copies,u.options.urgent,u.sla.due_on],['printed',3,true,addWorkingDays(today(),1,holidaySet(db,'36t'))]);
  const normal=tx(()=>requestLetter(db,e,{type_code:'bank',addressee_kind:'bank',addressee_code:'snb',purpose:'فتح حساب جاري',salary_detail:'total',salary_period:'monthly'})).id;
  assert.equal(view(e,normal).sla.due_on,addWorkingDays(today(),3,holidaySet(db,'36t')));
  assert.ok(verifyAudit(db));
});

test('letter wizard end to end: HR prepares, another person issues, the employee is notified and downloads it with a QR code; printed copies are handed over; "request again" prefills the options',t=>{
  const {db,users,tx,publish,view,issue}=letterFixture(t);
  publish('salary');publish('employment');
  const e=users.employee;
  const id=tx(()=>requestLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'both',salary_detail:'breakdown',salary_period:'annual',purpose:'تمويل شخصي',delivery:'printed',copies:2})).id;
  assert.equal(view(e,id).actions.includes('request_again'),false);
  const done=issue(id);
  assert.match(done.letter.body,/126,000\.00 ريال سنويًا \(الراتب الأساسي 96,000\.00، بدل السكن 24,000\.00، بدل النقل 6,000\.00\)/,'computed from the live contract at issue time');
  assert.match(done.letter.body,/SAR 126,000\.00 per year \(basic salary 96,000\.00, housing allowance 24,000\.00, transport allowance 6,000\.00\)/);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='employee' AND kind='letter_issued' AND subject_id=?").get(id),'the employee is notified');
  const printable=letterPrintable(letterDocument(db,e,done.letter.id));
  assert.match(printable,/<svg/);assert.match(printable,/نسخة مطبوعة مختومة \(2 نسخ\)/);
  assert.ok(view(users.hr,id).actions.includes('record_handover'));
  tx(()=>letterAction(db,users.hr,id,'record_handover',{version:view(users.hr,id).version,note:'استلمتها الموظفة من مكتب الموارد البشرية'}));
  assert.ok(view(e,id).options.handed_over_at);
  assert.throws(()=>db.prepare("UPDATE letter_request_options SET copies=5 WHERE request_id=?").run(id),/fixed/);
  // اطلبه مرة أخرى: الخيارات نفسها، ومرجع الطلب السابق.
  const again=view(e,id);assert.ok(again.actions.includes('request_again'));
  const second=tx(()=>requestLetter(db,e,{type_code:again.type_code,addressee_kind:again.options.addressee_kind,addressee_code:again.options.addressee_code,language:again.options.language,
    salary_detail:again.options.salary_detail,salary_period:again.options.salary_period,purpose:again.purpose,delivery:'digital',reused_from:id})).id;
  assert.equal(view(e,second).options.reused_from,id);
  assert.throws(()=>tx(()=>requestLetter(db,users.outsider,{type_code:'employment',addressee_kind:'to_whom',reused_from:id})),code('not_found'),'only your own letter can be reused');
  // الراتب لا يُحفظ: لا في الطلب ولا في خياراته ولا في السجل ولا في الإشعار — في نص الخطاب الصادر وحده.
  const figures=['126,000','96,000','24,000','6,000.00','10,500','1050000','12600000','9600000'];
  const leaks=[];
  for(const table of ['letter_requests','letter_request_options','audit_events','notifications','jobs','service_request_links']){
    const cols=db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(c=>c.name);
    for(const row of db.prepare(`SELECT * FROM ${table}`).all())for(const c of cols)for(const f of figures)if(String(row[c]??'').includes(f))leaks.push(`${table}.${c}:${f}`);
  }
  assert.deepEqual(leaks,[],'salary never persists outside the issued letter body');
  assert.equal(db.prepare("SELECT name FROM pragma_table_info('letter_request_options')").all().some(c=>/amount|minor|salary_total|pay/.test(c.name)),false,'no amount column on the options');
  assert.ok(verifyAudit(db));
});

test('catalog HR-SALARY-CERT routes to the letters module: the request cannot complete without an issued letter, and its options carry over',t=>{
  const {db,users,tx,issuer,publish,view}=letterFixture(t,{catalog:true});
  const e=users.employee,service=wf.catalog(db,e).find(s=>s.code==='HR-SALARY-CERT');
  const run=(who,r,action,note)=>tx(()=>wf.transition(db,who,r.id,action,{version:r.version,...(note?{note}:{})}));
  let r=tx(()=>wf.createRequest(db,e,{service_id:service.id,title:'تعريف بالراتب للبنك',payload:{recipient_kind:'بنك',recipient_bank:'مصرف الراجحي',language:'الإنجليزية',show_salary:'نعم'},project_id:null}));
  r=run(e,r,'submit');
  const approver=db.prepare("SELECT approver_id FROM approval_steps WHERE request_id=? AND status='pending'").get(r.id).approver_id;
  r=run(users[approver],r,'approve','معتمد');
  assert.equal(r.status,'approved');
  const handler=users.hr;
  r=run(handler,r,'claim');
  assert.throws(()=>run(handler,r,'complete','أُنجز بملاحظة نصية'),code('letter_template_required'),'no approved template: no closure with a text note');
  publish('salary');
  assert.throws(()=>run(handler,wf.detail(db,handler,r.id),'complete','أُنجز قبل الإصدار'),code('letter_not_issued'));
  const link=db.prepare('SELECT * FROM service_request_links WHERE request_id=?').get(r.id);
  assert.equal(link.module,'letters');
  const letter=view(e,link.record_id);
  assert.deepEqual([letter.type_code,letter.addressee,letter.options.addressee_kind,letter.options.addressee_code,letter.options.language,letter.options.salary_detail],['salary','مصرف الراجحي','bank','rajhi','en','breakdown'],'the structured catalog options become structured wizard options');
  tx(()=>letterAction(db,users.hr,letter.id,'prepare_letter',{version:view(users.hr,letter.id).version,note:'طوبق'}));
  tx(()=>letterAction(db,issuer,letter.id,'issue_letter',{version:view(issuer,letter.id).version,note:'صدر'}));
  r=run(handler,wf.detail(db,handler,r.id),'complete','صدر الخطاب برقمه المرجعي من خطابات الموظفين');
  assert.equal(r.status,'completed');
  assert.match(view(e,link.record_id).letter.body,/SAR 10,500\.00 per month \(basic salary 8,000\.00/);
});
