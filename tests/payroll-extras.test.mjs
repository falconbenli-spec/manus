import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { getRun, prepareRun, runAction, listPayroll } from '../app/payroll.mjs';
import { extrasBoard, proposeAdjustment, decideAdjustment, proposeAdvance, decideAdvance, recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, payrollPaymentFile, payrollPaymentAction, prepareSettlement, decideSettlement, computeSettlement, outstandingAdvances } from '../app/payroll-extras.mjs';
import { saveStepTemplate, openBundle } from '../app/lifecycle.mjs';
import { payrollBooks } from './payroll-books.mjs';

const code=value=>error=>error.code===value;
function iban(bban){const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;}
const thisMonth=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,7);
const eos={wage_base:['basic','housing'],first_years:5,first_rate_bp:5000,later_rate_bp:10000,reason_factors_bp:{employer_termination:10000,contract_expiry:10000,other:10000},resignation_tiers:[{min_years:0,factor_bp:0},{min_years:2,factor_bp:3333},{min_years:5,factor_bp:6667},{min_years:10,factor_bp:10000}]};
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-payroll-extras');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح رواتب مصطنع'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);grant('reviewer','payroll.review');
  const policy=(kind,parameters)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const contract=(user_id,start='2026-01-01')=>{const {id}=transaction(db,()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],document_reference:'عقد مصطنع'}));
    const step=(who,action,values={})=>transaction(db,()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version,...values}));step('hr','submit_contract');step('hr-manager','approve_contract');return {id,step};};
  const run=(who,r,action,values={})=>transaction(db,()=>runAction(db,users[who],r.id,action,{version:r.version,...values}));
  // D-01b: التسوية النهائية لا تُعتمد قبل إخلاء طرف تحققت منه المنصة، وأوله حزمة مغادرة مفتوحة.
  const offboarding=(user_id,effective)=>{
    transaction(db,()=>saveStepTemplate(db,users.hr,{kind:'offboarding',code:'OFF-'+user_id,title:'خطوة مغادرة مصطنعة',department_id:'creative',owner_role:'manager',target_days:2,
      acceptance:'دليل مصطنع موثق يطابق معيار الخطوة',basis:'قرار مصطنع من مالك إجراء الإدارة بتاريخ مصطنع'}));
    return transaction(db,()=>openBundle(db,users.hr,{kind:'offboarding',employee_id:user_id,owner_id:'manager',effective_date:effective,date_basis:'خطاب إنهاء مصطنع مؤرخ ومؤكد'})).id;
  };
  const approveRun=m=>{let r=getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month:m})).id);r=run('hr',r,'submit_run');r=getRun(db,users.reviewer,r.id);for(const l of r.lines.filter(l=>l.variance_flag))r=run('reviewer',r,'justify',{line_id:l.id,note:'فرق مفسر بحركة معتمدة في هذا الشهر'});r=run('reviewer',r,'pass_review',{note:'طابقت الحركات المعتمدة مع السطور'});return run('hr-manager',getRun(db,users['hr-manager'],r.id),'approve_run');};
  return {db,users,policy,contract,approveRun,run,offboarding};
}

test('PAY-03: only approved adjustments enter the run, each exactly once, and a proposer or the employee cannot approve',t=>{
  const {db,users,contract,approveRun}=fixture(t);contract('employee');
  // عُدِّل هذا السطر مرة واحدة في 22 سبتمبر 2026 (fix/signed-regulation-2): كان يعتمد حركة خصم بسبب حر وحده، والنسخة الموقعة (م51، ص 19) لا تجيز الحسم من الأجر
  // بغير موافقة العامل الخطية إلا في حالاتها الست؛ فصار الخصم هنا بحالة «ما أتلفه العامل» (م51/5) بسندها، وبقي كل ما سُجل في الاختبار كما هو.
  const propose=(kind,amount,who='hr')=>transaction(db,()=>proposeAdjustment(db,users[who],{user_id:'employee',kind,month:'2026-02',amount,reason:'حركة مصطنعة موثقة بقرار المدير المباشر',...(kind==='deduction'?{deduction_basis:'damage',deduction_reference:'محضر إتلاف مصطنع رقم 1'}:{})})).id;
  const bonus=propose('bonus','500.00'),overtime=propose('overtime','250.00'),deduction=propose('deduction','100.00');
  assert.throws(()=>transaction(db,()=>decideAdjustment(db,users.hr,bonus,'approve',{note:'اعتماد من المقترح'})),code('not_permitted'));
  assert.throws(()=>transaction(db,()=>proposeAdjustment(db,users.hr,{user_id:'hr',kind:'bonus',month:'2026-02',amount:'1.00',reason:'مكافأة يقترحها الموظف لنفسه'})),code('separation_of_duties'));
  transaction(db,()=>decideAdjustment(db,users['hr-manager'],bonus,'approve',{note:'مكافأة معتمدة'}));
  transaction(db,()=>decideAdjustment(db,users['hr-manager'],deduction,'approve',{note:'خصم معتمد'}));
  const feb=approveRun('2026-02'),line=feb.lines[0];
  assert.deepEqual([line.additions_minor,line.other_deductions_minor,line.advance_minor],[50000,10000,0],'the unapproved overtime stayed out');
  assert.equal(line.net_minor,1000000+50000-100000-10000);
  assert.equal(feb.gross_minor,1050000);assert.equal(feb.net_minor,line.net_minor);
  // الحزمة 4 (P4-HR-2، 1 أكتوبر 2026): كانت حركة فبراير تُعتمد بعد قفل مسيره فتبقى «معتمدة» ولا تُدفع أبدًا؛ صار اعتمادها يُرفض
  // باسم الشهر المقفل ومن يملك الخطوة التالية، وتبقى مقترحة. وما يثبته السطر التالي باقٍ: لا تتسرب إلى مارس ولا تُدفع مرتين.
  assert.throws(()=>transaction(db,()=>decideAdjustment(db,users['hr-manager'],overtime,'approve',{note:'اعتُمد بعد قفل مسير الشهر'})),code('month_locked'));
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(overtime).status,'proposed');
  const mar=approveRun('2026-03');
  assert.equal(mar.lines[0].additions_minor,0,'a February adjustment approved late does not leak into March, and nothing is paid twice');
  assert.throws(()=>propose('bonus','10.00'),code('month_locked'));
  assert.throws(()=>db.prepare("UPDATE payroll_adjustments SET run_id=NULL WHERE id=?").run(bonus),/locked run/);
  assert.equal(listPayroll(db,users.employee).payslips.find(s=>s.month==='2026-02').adjustments.length,2);
  assert.ok(verifyAudit(db));
});

test('an approved advance is recovered in equal instalments through payroll and shows what is still outstanding',t=>{
  const {db,users,contract,approveRun}=fixture(t);contract('employee');
  const month=thisMonth();
  assert.throws(()=>transaction(db,()=>proposeAdvance(db,users.hr,{user_id:'outsider',amount:'3000.00',installments:3,first_month:month,reason:'سلفة لموظف بلا عقد مسجل في المنصة'})),code('contract_required'));
  const id=transaction(db,()=>proposeAdvance(db,users.hr,{user_id:'employee',amount:'1000.00',installments:3,first_month:month,reason:'سلفة مصطنعة معتمدة بطلب الموظف'})).id;
  assert.equal(outstandingAdvances(db,'employee'),0,'a proposed advance creates no deduction');
  transaction(db,()=>decideAdvance(db,users['hr-manager'],id,'approve',{note:'سلفة ضمن سياسة الشركة المصطنعة'}));
  assert.deepEqual(db.prepare('SELECT amount_minor FROM payroll_adjustments WHERE advance_id=? ORDER BY month').all(id).map(r=>r.amount_minor),[33333,33333,33334]);
  assert.equal(outstandingAdvances(db,'employee'),100000);
  const run=approveRun(month);
  assert.equal(run.lines[0].advance_minor,33333);
  assert.equal(outstandingAdvances(db,'employee'),66667);
  assert.equal(extrasBoard(db,users.hr).advances[0].outstanding_minor,66667);
});

test('PAY-07: the transfer file needs a verified salary account for everyone, is released only after approval, and its execution is recorded by someone else',t=>{
  const {db,users,contract,approveRun}=fixture(t);contract('employee');
  const run=approveRun('2026-02');
  assert.throws(()=>transaction(db,()=>preparePayrollPayment(db,users.hr,{run_id:run.id})),code('bank_accounts_missing'));
  const bankId=transaction(db,()=>recordEmployeeBank(db,users.hr,{user_id:'employee',bank_name:'بنك مصطنع',iban:iban('80000000000000000021'),effective_month:'2026-01',evidence:'خطاب بنكي مصطنع باسم الموظفة'})).id;
  assert.throws(()=>transaction(db,()=>decideEmployeeBank(db,users.hr,bankId,'verify',{note:'تحقق من مسجل الحساب نفسه'})),code('not_permitted'));
  transaction(db,()=>decideEmployeeBank(db,users['hr-manager'],bankId,'verify',{note:'طابقت الخطاب البنكي مع اسم الموظفة'}));
  assert.equal(JSON.stringify(extrasBoard(db,users.hr)).includes(iban('80000000000000000021')),false,'the board never carries a full IBAN');
  assert.equal(db.prepare('SELECT iban FROM employee_bank_accounts WHERE id=?').get(bankId).iban.startsWith('enc:v1:'),true);
  const paymentId=transaction(db,()=>preparePayrollPayment(db,users.hr,{run_id:run.id})).id;
  assert.throws(()=>payrollPaymentFile(db,users.hr,paymentId),code('not_found'),'no file before approval');
  const act=(who,action,values={})=>transaction(db,()=>payrollPaymentAction(db,users[who],paymentId,action,{version:extrasBoard(db,users[who]).payments[0].version,...values}));
  assert.throws(()=>act('hr','approve_payment',{note:'اعتماد من المُعد'}),code('action_unavailable'));
  // الحزمة 4 (P4-HR-3، D5): التحويل لا يُعتمد قبل ترحيل قيد مسيره؛ اختبار PAY-07 يقيس الملف وتنفيذه، فيُرحَّل القيد بدفاتر تجريبية أولًا.
  assert.throws(()=>act('hr-manager','approve_payment',{note:'طابقت الإجمالي مع المسير المعتمد'}),code('payroll_journal_unposted'));
  payrollBooks(db).postRun(run.id);
  act('hr-manager','approve_payment',{note:'طابقت الإجمالي مع المسير المعتمد'});
  const file=payrollPaymentFile(db,users.reviewer,paymentId);
  assert.match(file.content,/employee_id,employee_name,bank_name,iban,net_amount_sar,month/);
  // الحزمة 3: التحويل ينفّذه البنك لا المنصة، والملف محاكاة حتى يوجد وصول معتمد — تقوله أول سطر فيه والاستجابة واسمه.
  assert.match(file.content.replace(/^\ufeff/,'').split('\r\n')[0],/^SIMULATED,/,'the first line of the file says it is a simulation');
  assert.deepEqual([file.simulated,file.integration_status],[true,'simulated']);
  assert.match(file.filename,/-SIMULATED\.csv$/);
  assert.ok(file.content.includes(iban('80000000000000000021'))&&file.content.includes('9000.00'));
  assert.throws(()=>payrollPaymentFile(db,users.manager,paymentId),code('not_permitted'));
  assert.throws(()=>act('hr','record_payment_execution',{executed_on:new Date().toISOString().slice(0,10),bank_reference:'PAY-TRX-1',evidence:'إشعار تنفيذ مصطنع من بنك الشركة'}),code('action_unavailable'));
  const done=act('reviewer','record_payment_execution',{executed_on:new Date(Date.now()+3*3600000).toISOString().slice(0,10),bank_reference:'pay-trx-1',evidence:'إشعار تنفيذ مصطنع من بنك الشركة'});
  assert.equal(done.status,'executed');
  assert.throws(()=>db.prepare("UPDATE payroll_payments SET amount_minor=1,version=version+1 WHERE id=?").run(paymentId),/final/);
});

test('PAY-09: the settlement applies the accepted policy by termination class — resignation tiers differ from employer termination — and deducts outstanding advances',t=>{
  const {db,users,policy,contract,offboarding}=fixture(t);
  const c=contract('employee','2020-01-01');
  assert.deepEqual(computeSettlement(eos,{wageBase:1000000,serviceDays:365*6,reason:'employer_termination',leaveDays:10,dailyWage:33333,advances:0}),{award_minor:3500000,leave_payout_minor:333330,net_minor:3833330,detail:{service_years_bp:60000,completed_years:6,full_award_minor:3500000,reason_factor_bp:10000}});
  assert.equal(computeSettlement(eos,{wageBase:1000000,serviceDays:365*6,reason:'resignation',leaveDays:0,dailyWage:0,advances:0}).award_minor,Math.round(3500000*0.6667));
  assert.equal(computeSettlement(eos,{wageBase:1000000,serviceDays:400,reason:'resignation',leaveDays:0,dailyWage:0,advances:0}).award_minor,0);
  c.step('hr-manager','end_contract',{ended_on:'2026-01-31',reason:'استقالة مقبولة بحسب طلب مصطنع'});
  const input={contract_id:c.id,end_reason:'resignation',leave_days:5,evidence:'خطاب الاستقالة المصطنع ورصيد الإجازة من سجل الإجازات'};
  assert.throws(()=>transaction(db,()=>prepareSettlement(db,users.hr,input)),code('policy_required'));
  policy('end_of_service',eos);
  // م36/2 (الترحيل 102): لا تُعتمد مخالصة قبل أن يختار مدير الموارد البشرية القراءة في سياسة المخالصة.
  transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-settlement','accept',{effective_from:'2020-01-01',choices:{art36_reading:'labor_law'},note:'اخترت قراءة نظام العمل لمكافأة نهاية الخدمة'}));
  assert.throws(()=>transaction(db,()=>prepareSettlement(db,users.hr,{...input,end_reason:'unknown'})),code('end_reason'));
  const id=transaction(db,()=>prepareSettlement(db,users.hr,input)).id;
  const s=extrasBoard(db,users['hr-manager']).settlements[0];
  assert.equal(s.service_start,'2020-01-01');assert.equal(s.basis.completed_years,6);assert.equal(s.basis.reason_factor_bp,6667);
  assert.equal(s.net_minor,s.award_minor+s.leave_payout_minor);
  assert.throws(()=>transaction(db,()=>prepareSettlement(db,users.hr,input)),code('settlement_exists'));
  assert.throws(()=>transaction(db,()=>decideSettlement(db,users.hr,id,'approve',{note:'اعتماد من المُعد نفسه'})),code('not_permitted'));
  // D-01b: قبل فتح حزمة المغادرة لا إخلاء طرف تحققت منه المنصة، فلا اعتماد.
  assert.throws(()=>transaction(db,()=>decideSettlement(db,users['hr-manager'],id,'approve',{note:'اعتماد قبل فتح حزمة المغادرة'})),code('clearance_open'));
  offboarding('employee','2026-01-31');
  transaction(db,()=>decideSettlement(db,users['hr-manager'],id,'approve',{note:'راجعت التصنيف ومدة الخدمة مع المستشار المصطنع'}));
  assert.throws(()=>db.prepare("UPDATE service_settlements SET net_minor=1,award_minor=1 WHERE id=?").run(id),/final/);
  assert.throws(()=>extrasBoard(db,users.manager),code('not_permitted'));
});
