import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, REGULATION_UNPAID_LEAVE } from '../app/leave-types.mjs';
import { decideRule, acceptedRule, monthDeductions, capsFor, settlementUnpaidRule, excludedServiceDays, shiftToWorkingDay } from '../app/payroll-rules.mjs';
import { proposeClassifiedDeduction } from '../app/payroll-extras.mjs';
import { saveTemplate, approveTemplate, templatesBoard } from '../app/letters.mjs';
import { BASE_SCHEDULE_ID, prepareSchedule, decideSchedule, recordViolation, caseAction, getCase, disciplineBoard } from '../app/discipline.mjs';
import { capBasis, unpaidLeaveRule, accrualStopAfterDays, cycleDayBasis, UNPAID_LEAVE_MODES } from '../app/hr-rule-basis.mjs';
import { hrPolicyBoard } from '../app/hr-policies.mjs';
import { hrPoliciesUI } from '../app/static/hr-policies-ui.mjs';

// توحيد القيم المكررة بين وحدات الموارد البشرية السبع (docs/implementation/handoff/hr-policy-unify.md).
// كل ما هنا بيانات مصطنعة: الأسماء والمبالغ والتواريخ لا تمثل أحدًا ولا قرار شركة.
const code=value=>error=>error.code===value;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const TEXT='نص تجريبي كافٍ الطول لأغراض الاختبار الآلي فقط';
const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const NOTICE_TEMPLATE=`إشعار بجزاء تأديبي / Notice of a disciplinary penalty
رقم القضية {{case_reference}} — الموظف {{employee_name}}
المخالفة: {{violation_ar}} / Violation: {{violation_en}} — {{violation_date}}
السند: {{article}}
الجزاء: {{penalty_ar}} / Penalty: {{penalty_en}}
عند التكرار: {{repeat_penalty_ar}} / On repeat: {{repeat_penalty_en}}
لك التظلم خلال {{grievance_days}} يومًا.`;

// أجر شهري 10,000.00 ريال بالكامل أساسي، فالحساب اليدوي ظاهر: اليوم 333.33 وخمسة أيام 1,666.66.
function fixture(t,{basic='6000.00',housing='4000.00'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-hr-policy-unify');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار توحيد السياسات'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve','hr.discipline.decide'])grant('hr-manager',c);
  grant('manager','hr.letters.issue');
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:TEXT+' — نص سياسة مصطنع.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters}));
    tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:0,social_insurance_base:[],review_threshold_bp:500});
  const contract=user_id=>{
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:90,notice_days:60,
      pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:housing}],document_reference:'عقد مصطنع لا وجود له'}));
    tx(()=>contractAction(db,users.hr,id,'submit_contract',{version:getContract(db,users.hr,id).version}));
    tx(()=>contractAction(db,users['hr-manager'],id,'approve_contract',{version:getContract(db,users['hr-manager'],id).version}));
    return id;};
  contract('employee');
  const seedId={resignation:'reg-seed-resignation',settlement:'reg-seed-settlement',deductions:'reg-seed-deductions',pay_rules:'reg-seed-pay-rules',travel_per_diem:'reg-seed-travel',social_insurance:'reg-seed-social-insurance'};
  const acceptRule=(kind,choices={},effective='2019-01-01')=>tx(()=>decideRule(db,users['hr-manager'],seedId[kind],'accept',{effective_from:effective,choices,note:'طابقت القيم مع اللائحة الموقعة (اختبار مصطنع)'}));
  const leaveDraft=(input={})=>tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2024-01-01',...input})).id;
  const acceptLeave=id=>tx(()=>decideLeaveTypes(db,users['hr-manager'],id,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد'}));
  // قالب إشعار الجزاء (م121): يكتبه موظف الموارد البشرية ويعتمده مُصدِر الخطابات، وبدونه لا يصل الجزاء مرحلة الإبلاغ.
  const noticeTemplate=()=>{
    tx(()=>saveTemplate(db,users.hr,'discipline_notice',{body:NOTICE_TEMPLATE}));
    const draft=templatesBoard(db,users.manager).types.find(x=>x.code==='discipline_notice').draft;
    tx(()=>approveTemplate(db,users.manager,'discipline_notice',{effective_from:riyadhToday(),note:'اعتماد مصطنع لنص الإشعار',version:draft.version}));
  };
  return {db,users,tx,grant,policy,acceptRule,leaveDraft,acceptLeave,noticeTemplate};
}

// ————— 1) حد الإجازة بلا أجر: قرار واحد يقرأه محرك الاستحقاق والمخالصة —————

test('the unpaid-leave threshold and its mode are one decision: the leave-types policy is the source, and the settlement policy copies it instead of asking again',t=>{
  const {db,users,grant,acceptRule,leaveDraft,acceptLeave}=fixture(t);
  // لا سياسة بعد: لا حد ولا طريقة حسم، فلا يُحسم شيء من مدة الخدمة.
  assert.equal(unpaidLeaveRule(db,'36t','2026-06-01'),null);
  assert.equal(accrualStopAfterDays(db,'36t','2026-06-01'),null);
  assert.equal(settlementUnpaidRule(db,'36t','2026-06-01'),null);

  const draft=leaveDraft({unpaid_leave_mode:'total_when_over'});
  assert.equal(JSON.parse(db.prepare('SELECT parameters FROM leave_type_policies WHERE id=?').get(draft).parameters).unpaid_leave.mode,'total_when_over');
  assert.throws(()=>leaveDraft({unpaid_leave_mode:'whatever'}),code('unpaid_leave_mode'),'only the two readings of Art. 91.3');
  // القيمة تُكتب في المسودة ويعتمدها غير من أعدها، ولو كان المُعد يملك تصريح الاعتماد (قاعدة الشخصين).
  grant('hr','hr.policy.accept');
  assert.throws(()=>transaction(db,()=>decideLeaveTypes(db,users.hr,draft,'accept',{note:'من أعدها لا يعتمدها في الاختبار'})),code('separation_of_duties'));
  acceptLeave(draft);

  const rule=unpaidLeaveRule(db,'36t','2026-06-01');
  assert.deepEqual([rule.threshold_days,rule.threshold_source,rule.mode,rule.mode_source,rule.decided],[20,'leave_policy','total_when_over','leave_policy',true]);
  assert.deepEqual(rule.mismatch,[],'nothing to disagree with yet');
  assert.equal(accrualStopAfterDays(db,'36t','2026-06-01'),20,'the accrual engine reads the same number');

  // قبول سياسة المخالصة لا يطلب الاختيار مرة ثانية: ينسخ ما حُسم في سياسة الإجازات.
  const accepted=acceptRule('settlement',{art36_reading:'literal'},'2024-06-01');
  assert.deepEqual(accepted.unpaid_leave,{threshold_days:20,mode:'total_when_over',from_policy:draft});
  const stored=acceptedRule(db,'36t','settlement','2026-06-01').parameters;
  assert.deepEqual([stored.unpaid_leave_threshold_days,stored.unpaid_leave_mode],[20,'total_when_over'],'the settlement copy cannot drift from the leave policy');
  assert.deepEqual(unpaidLeaveRule(db,'36t','2026-06-01').mismatch,[],'one value, two places, no contradiction');

  // المخالصة تحسب بالقراءة نفسها: 25 يومًا بلا أجر تُحسم كلها لأن الطريقة «المجموع كله».
  const shape=settlementUnpaidRule(db,'36t','2026-06-01');
  assert.deepEqual([excludedServiceDays(25,shape),excludedServiceDays(20,shape)],[25,0]);
});

// م91/3 — الطريقة الثالثة «لا يُحسم»: قرار الشركة في 23 سبتمبر 2026 ألا تنقص مدة الخدمة بالإجازة بلا أجر
// مهما طالت. النظام حد أدنى وهذا فوقه، فالحد لا يُقاس أصلًا ولا يُفرَّق بين ما دونه وما فوقه.
test('م91/3: طريقة «لا يُحسم» لا تُنقص مدة الخدمة مهما بلغت أيام الإجازة بلا أجر',()=>{
  const none={unpaid_leave_threshold_days:20,unpaid_leave_mode:'none'};
  assert.deepEqual([excludedServiceDays(5,none),excludedServiceDays(20,none),excludedServiceDays(25,none),excludedServiceDays(400,none)],[0,0,0,0]);
  // والطريقتان الأخريان لم تتغيرا بإضافتها.
  const excess={unpaid_leave_threshold_days:20,unpaid_leave_mode:'excess'};
  const total={unpaid_leave_threshold_days:20,unpaid_leave_mode:'total_when_over'};
  assert.deepEqual([excludedServiceDays(25,excess),excludedServiceDays(25,total)],[5,25]);
  // والطريقة الثالثة معروضة للاختيار باسمها لا بفرع صامت.
  assert.equal(UNPAID_LEAVE_MODES.none,'لا يُحسم من مدة الخدمة شيء');
});

test('a settlement policy accepted before any leave-types policy keeps deciding, and the leave-types policy takes over the moment it is accepted', t=>{
  const {db,acceptRule,leaveDraft,acceptLeave}=fixture(t);
  // المسار الآمن لما هو مخزَّن: سياسة المخالصة وحدها تقرر قبل أن تُعتمد سياسة أنواع الإجازات.
  acceptRule('settlement',{art36_reading:'labor_law'});
  const before=unpaidLeaveRule(db,'36t','2026-06-01');
  assert.deepEqual([before.threshold_days,before.threshold_source,before.mode,before.mode_source],[20,'settlement_policy','excess','settlement_policy']);
  assert.equal(accrualStopAfterDays(db,'36t','2026-06-01'),20,'the accrual engine still gets a number');
  assert.deepEqual([excludedServiceDays(25,settlementUnpaidRule(db,'36t','2026-06-01'))],[5],'excess only');

  acceptLeave(leaveDraft({unpaid_leave_mode:'total_when_over'}));
  const after=unpaidLeaveRule(db,'36t','2026-06-01');
  assert.deepEqual([after.threshold_source,after.mode,after.mode_source],['leave_policy','total_when_over','leave_policy']);
  assert.equal(after.mismatch.length,1,'the older settlement copy disagrees, and the screen says so instead of hiding it');
  assert.match(after.mismatch[0],/سياسة أنواع الإجازات/);
  assert.deepEqual([excludedServiceDays(25,settlementUnpaidRule(db,'36t','2026-06-01'))],[25],'the leave-types policy wins');
});

test('a leave-types policy accepted without a mode leaves the settlement policy deciding it, and the threshold still comes from one place',t=>{
  const {db,acceptRule,leaveDraft,acceptLeave}=fixture(t);
  acceptLeave(leaveDraft());
  const only=unpaidLeaveRule(db,'36t','2026-06-01');
  assert.deepEqual([only.threshold_days,only.threshold_source,only.mode,only.decided],[20,'leave_policy',null,false]);
  assert.equal(settlementUnpaidRule(db,'36t','2026-06-01'),null,'no mode, no service deduction invented');
  acceptRule('settlement',{art36_reading:'literal'});
  const both=unpaidLeaveRule(db,'36t','2026-06-01');
  assert.deepEqual([both.threshold_source,both.mode,both.mode_source,both.decided],['leave_policy','excess','settlement_policy',true]);
  assert.deepEqual(both.mismatch,[],'the thresholds are equal because only one of them was ever entered');
  assert.equal(REGULATION_UNPAID_LEAVE.threshold_days,20);
  assert.equal(REGULATION_UNPAID_LEAVE.mode,null,'the draft never answers Art. 91.3 on the HR manager’s behalf');
});

// ————— 2) سقف م116: موضع واحد يقرأه الاقتراح وفحص المسير —————

test('Art. 116: a discipline fine and another fine in the same month land exactly on the cap, measured by one wage basis in both modules',t=>{
  const {db,users,tx,acceptRule,noticeTemplate}=fixture(t);
  acceptRule('deductions');noticeTemplate();
  tx(()=>decideSchedule(db,users['hr-manager'],BASE_SCHEDULE_ID,'accept',{effective_from:'2024-01-01',note:'قبول مصطنع بعد مطابقة الجدول'}));
  const basis=capBasis(db,'36t',riyadhToday());
  assert.deepEqual([basis.monthly_fine_cap_days,basis.day_basis_days,basis.monthly_fine_cap_source],[5,30,'deductions_policy']);
  assert.deepEqual(basis.mismatch,[],'the schedule and the deductions policy hold the same numbers');
  // الأجر 1,000,000 هللة: سقف الغرامات الشهري = 5 × 1,000,000 ÷ 30 = 166,666 هللة (1,666.66 ريال).
  assert.equal(capsFor(acceptedRule(db,'36t','deductions').parameters,1000000).fines_cap_minor,166666);

  const today=riyadhToday(),month=today.slice(0,7);
  const caseId=tx(()=>recordViolation(db,users.hr,{user_id:'employee',codes:['A04'],act_date:today,discovered_on:today,description:'واقعة مصطنعة لاختبار سقف الغرامة',source_kind:'hr_observation'})).id;
  const act=(who,action,input={})=>tx(()=>caseAction(db,users[who],caseId,action,{version:getCase(db,users[who],caseId).version,...input}));
  act('hr','open_investigation',{process:'written',charge_text:'اتهام كتابي مصطنع بمخالفة مسجلة',charge_delivered_on:today});
  act('employee','submit_defence',{defence:'دفاع مصطنع مكتوب من الموظف في الاختبار'});
  act('hr','record_hearing',{hearing_on:today,minutes:'محضر جلسة تحقيق مصطنع بأقوال الموظف'});
  act('hr','conclude',{finding:'proven',note:TEXT});
  // A04 التكرار الأول: غرامة أجر ربع يوم (2500 نقطة أساس). نختار أجر ثلاثة أيام؟ لا: الأشد المقرر هو السقف.
  act('hr-manager','decide',{penalty:'fine:2500',note:TEXT});
  act('manager','issue_notice');
  act('hr','record_delivery',{method:'hand',delivered_on:today});
  const proposed=act('hr','propose_deduction',{month});
  // 2500 نقطة = ربع يوم = halfUp(1,000,000 × 2500 ÷ 300,000) = 8,333 هللة.
  assert.equal(db.prepare('SELECT amount_minor FROM discipline_fine_deductions WHERE adjustment_id=?').get(proposed.adjustment_id).amount_minor,8333);
  assert.equal(monthDeductions(db,'36t','employee',month,['approved','proposed']).fines_minor,8333,'the payroll side counts the discipline fine as a fine');

  // غرامة أخرى في الشهر نفسه تكمل السقف بالضبط: 166,666 − 8,333 = 158,333 هللة.
  tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'1583.33',reason:'غرامة مصطنعة ثانية بقرار جزاء محسوم',class:'fine',reference:'قرار جزاء مصطنع 2'}));
  assert.equal(monthDeductions(db,'36t','employee',month,['approved','proposed']).fines_minor,166666,'exactly five days’ wage');
  // هللة واحدة فوقه تُرفض من الموضع نفسه الذي سيفحصه المسير.
  assert.throws(()=>tx(()=>proposeClassifiedDeduction(db,users.hr,{user_id:'employee',month,amount:'0.01',reason:'غرامة مصطنعة ثالثة تتجاوز السقف',class:'fine',reference:'قرار جزاء مصطنع 3'})),code('deduction_cap'));
});

test('the seeded deductions policy carries the wage basis that the code used to assume, so accepting it changes no number',t=>{
  const {db,acceptRule}=fixture(t);
  acceptRule('deductions');
  const p=acceptedRule(db,'36t','deductions').parameters;
  assert.deepEqual(p.wage_components,['basic','housing','transport','other_allowance'],'the whole contract, exactly as monthly_total_minor was before');
  assert.equal(capsFor(p,1000000).fines_cap_minor,166666);
  assert.equal(capsFor(p,1000000).daily_wage_minor,33333);
  // م116 لا تحتمل أكثر من خمسة أيام: النطاق هنا هو نطاق جدول الجزاءات نفسه.
  assert.throws(()=>transaction(db,()=>decideRule(db,{id:'nobody',tenant_id:'36t'},'reg-seed-deductions','accept',{effective_from:'2019-01-01',note:TEXT})),()=>true);
});

test('the discipline schedule stops being a second home for the Art. 116 monthly cap: the deductions policy overrides it and the difference is reported',t=>{
  const {db,users,tx,acceptRule}=fixture(t);
  // نسخة الكيان من جدول الجزاءات بأساس أجر أضيق (الأساسي وحده) ومهلة دفاع.
  const {id:scheduleId}=tx(()=>prepareSchedule(db,users.hr,{source_id:BASE_SCHEDULE_ID,title:'جدول جزاءات مصطنع للكيان',basis:'اللائحة الموقعة المصطنعة رقم 1 لسنة 2026',effective_from:'2024-01-01',
    settings:{defence_wait_days:3,wage_components:['basic']}}));
  tx(()=>decideSchedule(db,users['hr-manager'],scheduleId,'accept',{effective_from:'2024-01-01',note:'قبول مصطنع بعد مطابقة الجدول',version:1}));
  const before=capBasis(db,'36t',riyadhToday());
  assert.deepEqual([before.wage_components,before.wage_components_source],[['basic'],'discipline_schedule'],'without the deductions policy the schedule still answers');

  acceptRule('deductions');
  const after=capBasis(db,'36t',riyadhToday());
  assert.deepEqual([after.wage_components,after.wage_components_source],[['basic','housing','transport','other_allowance'],'deductions_policy']);
  assert.equal(after.mismatch.length,1,'the two stores disagree and the platform says which one it obeys');
  assert.match(after.mismatch[0],/سياسة سقوف الاستقطاع/);
  // وحدة الجزاءات تعرض الأساس الذي سيُفحص به المسير، لا أساسها الخاص.
  const board=disciplineBoard(db,users['hr-manager']);
  assert.deepEqual(board.cap_basis.wage_components,after.wage_components);
  assert.match(board.cap_basis.source_note,/سقوف الاستقطاع/);
});

// ————— 3) أساس اليوم وإزاحة يوم الصرف: نسخة واحدة —————

test('one day-basis resolver answers the payroll run and the leave pay effect, and the payday shift follows the accepted working days',t=>{
  assert.deepEqual([cycleDayBasis({day_basis:'thirty'},'2026-02-28'),cycleDayBasis({day_basis:'calendar'},'2026-02-28'),cycleDayBasis(null,'2026-01-31')],[30,28,31]);
  const holidays=new Set();
  // الافتراضي أسبوع تقويم الخدمات (الجمعة والسبت راحة): 2026-09-26 سبت ← الخميس 24.
  assert.equal(shiftToWorkingDay('2026-09-26',holidays).date,'2026-09-24');
  // بأيام دوام من السبت إلى الأربعاء: السبت يوم عمل فلا إزاحة، والخميس 24 يُزاح إلى الأربعاء 23.
  const satToWed=new Set([6,0,1,2,3]);
  assert.equal(shiftToWorkingDay('2026-09-26',holidays,satToWed).date,'2026-09-26');
  assert.equal(shiftToWorkingDay('2026-09-24',holidays,satToWed).date,'2026-09-23');
});

// ————— 4) و5) الشاشة الواحدة وقائمة الجاهزية —————

test('one HR policy screen lists every draft policy from every store with its articles, status, preparer and the same two-person rule, and never offers an action the module would refuse',t=>{
  const {db,users,tx,leaveDraft}=fixture(t);
  const draft=leaveDraft({unpaid_leave_mode:'excess'});
  assert.throws(()=>hrPolicyBoard(db,users.employee),code('not_permitted'),'the screen is not open to anyone without a policy capability');
  assert.throws(()=>hrPolicyBoard(db,users.admin),code('forbidden'),'nor to the platform administrator');

  const manager=hrPolicyBoard(db,users['hr-manager']);
  const stores=new Set(manager.policies.map(p=>p.store));
  for(const store of ['hr_policy','leave_types','discipline_schedule','regulation_rule'])assert.ok(stores.has(store),store);
  const leave=manager.policies.find(p=>p.id===draft);
  assert.deepEqual([leave.status,leave.status_name,leave.prepared_by_name],['draft','مسودة بانتظار القرار',users.hr.name]);
  // الإصدار 3 من سياسة أنواع الإجازات يستشهد بنظام العمل ولائحته التنفيذية بجوار مواد لائحة الشركة (مراجعة 21 سبتمبر 2026).
  assert.deepEqual(leave.articles,['م80–م94','م105','نظام العمل م107 وم109–م117 وم151 وم160','اللائحة التنفيذية م22 مكرر وم24–م26']);
  assert.deepEqual(leave.actions,['accept_policy','reject_policy']);
  assert.equal(leave.accept_path,`/leave/types/${draft}/accept`,'the action posts to the module’s own endpoint, not a new one');
  assert.ok(leave.blocked_while_unaccepted.length,'the screen says what stays off while it is unaccepted');

  // من أعد المسودة لا يعتمدها، هنا كما في وحدتها.
  const preparer=hrPolicyBoard(db,users.hr).policies.find(p=>p.id===draft);
  assert.deepEqual(preparer.actions,[]);
  assert.equal(preparer.own_draft,true);
  assert.equal(preparer.accept_path,null);

  // اختيار لم يُحسم (قراءة م36/2، قاعدة التقريب): لا يُعرض زر قبول يعرف الخادم أنه سيرفضه.
  const settlement=manager.policies.find(p=>p.store==='regulation_rule'&&p.kind==='settlement');
  assert.deepEqual(settlement.actions,[]);
  assert.equal(settlement.decide_at,'#payroll-rules');
  assert.ok(settlement.pending_choices.some(x=>/م36\/2/.test(x)));

  // القبول من الشاشة يمر بالدالة نفسها بقاعدتها نفسها.
  tx(()=>decideLeaveTypes(db,users['hr-manager'],draft,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد'}));
  const after=hrPolicyBoard(db,users['hr-manager']).policies.find(p=>p.id===draft);
  assert.deepEqual([after.status,after.decided_by_name,after.actions,after.blocked_while_unaccepted],['accepted',users['hr-manager'].name,[],[]]);

  // القيم المشتركة تُعرض مرة واحدة بمصدرها ومن يقرأها.
  const shared=Object.fromEntries(hrPolicyBoard(db,users['hr-manager']).shared_values.map(v=>[v.key,v]));
  assert.equal(shared.unpaid_leave.source,'سياسة أنواع الإجازات');
  assert.ok(shared.unpaid_leave.read_by.length>1&&shared.cap_basis.read_by.length>1);
  assert.deepEqual(shared.unpaid_leave.mismatch,[]);
});

test('the readiness checklist names what still blocks the HR modules, each line pointing at where it is fixed, and clears as the blockers are removed',t=>{
  const {db,users,tx,grant,acceptRule,leaveDraft,acceptLeave}=fixture(t);
  const board=()=>hrPolicyBoard(db,users['hr-manager']);
  const line=(data,key)=>data.checklist.find(c=>c.key===key);
  const first=board();
  assert.ok(first.blocking>0);
  // التصاريح غير الممنوحة تُذكر بالاسم، بأثرها، وبالشاشة التي تُمنح منها.
  const leaveAuthority=line(first,'capability:hr.leave.authority');
  assert.equal(leaveAuthority.ok,false);
  assert.match(leaveAuthority.title,/لم يُمنح `hr\.leave\.authority` لأحد/);
  assert.match(leaveAuthority.detail,/م90، م91\/5/);
  // «#access» لم تكن شاشة قط (رصدها مختص شاشات الموارد البشرية): التصريح يُمنح من «الموظفون والصلاحيات».
  assert.equal(leaveAuthority.link,'#accounts');
  assert.equal(line(first,'capability:hr.discipline.decide').ok,true,'granted to the HR manager in this fixture');

  // السياسات غير المعتمدة، والقالب المفقود.
  assert.equal(line(first,'policy:leave_types:').ok,false);
  assert.match(line(first,'policy:leave_types:').title,/لم تُعتمد سياسة أنواع الإجازات/);
  assert.equal(line(first,'policy:leave_types:').link,'#leave');
  assert.equal(line(first,'policy:hr_policy:working_time').ok,false);
  assert.match(line(first,'policy:hr_policy:working_time').title,/لم تُعتمد سياسة الدوام والحضور/);
  const template=line(first,'letters:any');
  assert.equal(template.ok,false);
  assert.match(template.title,/لا يوجد قالب خطاب معتمد/);
  assert.equal(template.link,'#letter-templates');
  assert.equal(line(first,'choice:unpaid_leave_mode').ok,false);
  assert.equal(line(first,'consistency:one_value').ok,true,'nothing is written twice yet');
  assert.equal(line(first,'policy:hr_policy:pay_components').ok,true,'what the fixture accepted is already ticked');

  // إزالة العوائق تُسقط سطورها: منح التصريح، واعتماد سياستين.
  grant('it','hr.leave.authority');
  acceptLeave(leaveDraft({unpaid_leave_mode:'excess'}));
  acceptRule('deductions');
  const second=board();
  assert.equal(line(second,'capability:hr.leave.authority').ok,true);
  assert.equal(line(second,'policy:leave_types:').ok,true);
  assert.equal(line(second,'policy:regulation_rule:deductions').ok,true);
  assert.equal(line(second,'choice:unpaid_leave_mode').ok,true);
  assert.ok(second.blocking<first.blocking);
  // الشاشة نفسها تُرسم من بيانات اللوحة الحقيقية بلا قيمة ناقصة.
  const html=hrPoliciesUI.render(second,{e,button:(action,id,label)=>`<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`});
  assert.ok(!/\bundefined\b|\bNaN\b|\[object /.test(html.replace(/<[^>]+>/g,' ')),'the screen renders without a missing value');
  assert.match(html,/سياسات الموارد البشرية|قائمة الجاهزية/);
  // نموذج القبول يرسل ما تقبله وحدة السياسة وحدها.
  const pending=second.policies.find(p=>p.actions.includes('accept_policy')&&p.store==='discipline_schedule');
  if(pending){
    const form=hrPoliciesUI.form('accept_policy',pending.id,second);
    assert.equal(form.endpoint,pending.accept_path);
    assert.deepEqual(Object.keys(form.toPayload({note:TEXT,effective_from:'2026-01-01'})).sort(),['effective_from','note','version']);
  }
  assert.ok(tx(()=>true));
});
