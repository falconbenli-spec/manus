// محاسبة الرواتب (الحزمة 4، P4-HR-3، الترحيل 174): كل ريال من المسير يصل الدفتر في تاريخه، وعلى مركز تكلفة إدارته، وعلى التزامه.
// العالم التجريبي نفسه (tests/hr-cycle-fixture.mjs) ودفاتر تجريبية فوقه (tests/payroll-books.mjs). كل اسم ومبلغ هنا مصطنع.
//   (1) مركز تكلفة الإدارة: يسجّله واحد ويقرره ثانٍ، مؤرخ، والمقرَّر ثابت؛ والإدارة بلا مركز توقف قيد المسير باسمها.
//   (2) الحسومات كلٌّ إلى غرضه (D4): الحكم والغرامة والقرض والموافقة، والأثر الرجعي يُنقص المصروف.
//   (3) D5: لا يُعتمد تحويل قبل ترحيل قيد مسيره؛ والدفع يسدّد «رواتب مستحقة الدفع» في الأستاذ المساعد.
//   (4) صرف السلفة: يُسجَّل مرة بيد رابعة، فيصير مستندًا في الدفتر، والأقساط تسترده.
//   (5) الحسابات الرقابية للرواتب في المطابقة: ما لا مستند له ولا ربط لا يُعرض فرقًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as employees from '../app/employees.mjs';
import { controlReconciliation, statements, traceAmount } from '../app/ledger.mjs';
import { sourceKind } from '../app/ledger-sources.mjs';
import { recordDepartmentCentre, decideDepartmentCentre, departmentCentreOn, recordAdvanceDisbursement } from '../app/payroll-ledger.mjs';
import { extrasBoard, recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, payrollPaymentAction, consentToDeduction, proposeAdvance, decideAdvance } from '../app/payroll-extras.mjs';
import { retroCandidates, proposeRetro } from '../app/payroll-retro.mjs';
import { preRunChecks } from '../app/payroll-checks.mjs';
import { riyadhToday } from '../app/riyadh-time.mjs';
import { hrCycle, caught } from './hr-cycle-fixture.mjs';
import { iban } from './wage-fixture.mjs';
import { payrollBooks, linesOf } from './payroll-books.mjs';

const control=(db,key,date=riyadhToday())=>controlReconciliation(db,'36t',date).controls.find(c=>c.key===key);
const bank=(w,userId,bban)=>{const {id}=w.tx(()=>recordEmployeeBank(w.db,w.U.hr,{user_id:userId,bank_name:'بنك تجريبي',iban:iban(bban),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم صاحب الحساب'}));
  w.tx(()=>decideEmployeeBank(w.db,w.U['hr-manager'],id,'verify',{note:'طابقت الخطاب البنكي التجريبي مع الاسم'}));};

test('department cost centre: one finance holder records it, a second decides it, one waits per department, a decided row never changes, and a later row governs only later months',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db,{mapDepartments:false});
  const [cre,other,prd,fresh]=['CC-CRE','CC-OTHER','CC-PRD','CC-NEW'].map(code=>books.centre(code).id);
  const record=(who,input={})=>w.tx(()=>recordDepartmentCentre(db,who,{department_id:'creative',cost_center_id:cre,effective_from:'2026-01-01',reason:'ربط تجريبي للفريق الإبداعي بمركزه',...input}));
  assert.equal(caught(()=>record(w.U.hr)).code,'ledger_access_denied','someone without a finance grant does not set where salaries are charged');
  const first=record(books.preparer);
  assert.equal(caught(()=>record(books.preparer,{cost_center_id:other})).code,'department_centre_pending','one row waits per department');
  assert.equal(caught(()=>w.tx(()=>decideDepartmentCentre(db,books.preparer,first.id,'approve',{note:'اعتماد من غير صاحب التفويض'}))).code,'ledger_access_denied');
  const own=w.tx(()=>recordDepartmentCentre(db,books.approver,{department_id:'production',cost_center_id:prd,effective_from:'2026-01-01',reason:'ربط تجريبي لإدارة الإنتاج بمركزها'}));
  assert.equal(caught(()=>w.tx(()=>decideDepartmentCentre(db,books.approver,own.id,'approve',{note:'اعتماد ذاتي'}))).code,'self_approval');
  assert.throws(()=>db.prepare("UPDATE department_cost_centres SET status='approved',decided_by=recorded_by,decided_at='2026-01-02T00:00:00.000Z',decision_note='ذاتي' WHERE id=?").run(own.id),/CHECK constraint/,'the database refuses a self-decision too');
  w.tx(()=>decideDepartmentCentre(db,books.approver,first.id,'approve',{note:'طابقت المركز مع هيكل الإدارات'}));
  assert.equal(departmentCentreOn(db,'36t','creative','2026-06-30').code,'CC-CRE');
  assert.throws(()=>db.prepare('UPDATE department_cost_centres SET cost_center_id=? WHERE id=?').run(other,first.id),/decided once/);
  assert.throws(()=>db.prepare('DELETE FROM department_cost_centres WHERE id=?').run(first.id),/retained/);
  // ربط جديد من يوليو: يونيو يبقى على مركزه، ويوليو وما بعده على الجديد.
  const later=w.tx(()=>recordDepartmentCentre(db,books.preparer,{department_id:'creative',cost_center_id:fresh,effective_from:'2026-07-01',reason:'الإبداعي ينتقل إلى مركز جديد من يوليو'}));
  w.tx(()=>decideDepartmentCentre(db,books.approver,later.id,'approve',{note:'قرار تجريبي بنقل المركز'}));
  assert.deepEqual(['2026-06-30','2026-07-31'].map(d=>departmentCentreOn(db,'36t','creative',d).code),['CC-CRE','CC-NEW']);
  const view=statements(db,books.approver).department_centres;
  assert.equal(view.rows.find(r=>r.department_id==='creative').active.code,'CC-NEW');
  assert.deepEqual(view.pending.map(p=>[p.department_id,p.actions]),[['production',[]]],'the recorder sees its own row waiting, with nothing to press');
  assert.deepEqual(statements(db,books.preparer).department_centres.pending[0].actions,[],'without the approval grant nothing is offered');
  // الإدارة بلا مركز معتمد سارٍ توقف قيد المسير باسمها، ولا يُخمَّن لها مركز.
  const june=w.approveMonth('2026-06');
  const moved=w.tx(()=>employees.recordChange(db,w.U.hr,'outsider',{change_type:'department',to_value:'production',effective_from:'2026-06-10',reason:'نقل تجريبي إلى الإنتاج في يونيو'}));
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],moved.change_id,{note:'اعتماد تجريبي'}));
  const missing=caught(()=>books.journal('payroll_run',june.id,'2026-06'));
  assert.equal(missing.code,'department_cost_centre_missing');
  assert.match(missing.details.refusal.what,/الإنتاج التجريبي/);
  assert.equal(missing.details.refusal.missing[0].owner_role,'finance');
  // الربط المنتظر لإدارة الإنتاج سجّله المعتمد، فيقرره زميل ثالث يحمل الاعتماد — لا من سجّله.
  db.prepare("INSERT INTO finance_grants VALUES('syn-grant-third','36t','books-preparer','employee','approve','2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض اعتماد تجريبي ثالث',NULL,'2026-01-01T00:00:00.000Z')").run();
  w.tx(()=>decideDepartmentCentre(db,books.preparer,own.id,'approve',{note:'طابقت مركز الإنتاج مع الهيكل'}));
  assert.deepEqual(linesOf(db,books.journal('payroll_run',june.id,'2026-06').id),[['5000','CC-CRE',1000000,0],['5000','CC-PRD',800000,0],['2100','GEN',0,1800000]],
    'June: the employee on the creative centre, the colleague moved on 10 June on production — the department on the last day of the month');
  assert.ok(verifyAudit(db));
});

test('deductions: a court order, a fine, an employer loan and a consented deduction each reach their own account; unpaid leave and a retro correction reduce the expense',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db,{departments:{creative:'CC-CRE'}});
  const june=w.approveMonth('2026-06');
  // غياب يونيو اعتُمد بعد اعتماد مسيره: فرقه أثر رجعي في يوليو، خصمٌ بموافقة الموظفة لأنه استرداد ما صُرف بالزيادة.
  w.absence('employee','2026-06-17');
  const candidate=retroCandidates(db,w.U.hr).candidates.find(c=>c.user_id==='employee'&&c.source_month==='2026-06');
  assert.equal(candidate.difference_minor,-33333);
  const retro=w.tx(()=>proposeRetro(db,w.U.hr,{user_id:'employee',source_month:'2026-06',target_month:'2026-07',expected_difference:-33333,note:'غياب يونيو اعتُمد بعد المسير'}));
  w.tx(()=>consentToDeduction(db,w.U.employee,retro.adjustment_id,{consent:true}));w.decide(retro.adjustment_id);
  const deduct=(basis,amount)=>{const id=w.propose({user_id:'outsider',kind:'deduction',month:'2026-07',amount,deduction_basis:basis,deduction_reference:`سند تجريبي ${basis}`});
    if(basis==='consent')w.tx(()=>consentToDeduction(db,w.U.outsider,id,{consent:true}));w.decide(id);return id;};
  deduct('court_order','500.00');deduct('fine','100.00');deduct('employer_loan','200.00');deduct('consent','50.00');
  w.decide(w.effectsOf(w.unpaidLeave('2026-07-05','2026-07-09').id)[0].adjustment_id);
  const july=w.approveMonth('2026-07');
  assert.deepEqual([w.lineOf(july,'employee').other_deductions_minor,w.lineOf(july,'outsider').other_deductions_minor],[166667+33333,85000]);
  const j=books.journal('payroll_run',july.id,'2026-07');
  assert.equal(j.entry_date,'2026-07-31');
  assert.deepEqual(linesOf(db,j.id),[
    ['5000','CC-CRE',1000000-166667-33333+800000,0],
    ['1200','GEN',0,20000],['2130','GEN',0,50000],['2140','GEN',0,10000],['2150','GEN',0,5000],
    ['2100','GEN',0,1000000-200000+800000-85000]],
    'the expense loses only what was never earned (unpaid leave) and what was overpaid (retro); the court order, the fine, the loan and the consented deduction are owed onwards');
  assert.ok(j.lines.every(l=>!/الموظفة|موظف اختبار|employee|outsider/.test(l.memo)),'no person is named in the ledger');
  assert.ok(verifyAudit(db));
});

test('D5: a payroll transfer is not approved before the run journal is posted, and the executed payment clears salaries payable in its sub-ledger',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  bank(w,'employee','80000000000000000021');bank(w,'outsider','80000000000000000039');
  const june=w.approveMonth('2026-06');
  const paymentId=w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id})).id;
  const payment=who=>extrasBoard(db,w.U[who]).payments.find(p=>p.id===paymentId);
  const approve=()=>w.tx(()=>payrollPaymentAction(db,w.U['hr-manager'],paymentId,'approve_payment',{version:payment('hr-manager').version,note:'طابقت الإجمالي مع المسير المعتمد'}));
  assert.deepEqual(payment('hr-manager').actions,['cancel_payment'],'approval is not offered before the journal is posted');
  assert.equal(payment('hr-manager').journal_gate.missing[0].owner_role,'finance');
  assert.equal(caught(approve).code,'payroll_journal_unposted');
  const draft=books.journal('payroll_run',june.id,'2026-06');
  assert.match(caught(approve).details.refusal.what,/مسودة/,'a draft journal is not a recorded liability');
  books.post(draft);
  approve();
  assert.equal(payment('reviewer').status,'approved');
  const done=w.tx(()=>payrollPaymentAction(db,w.U.reviewer,paymentId,'record_payment_execution',{version:payment('reviewer').version,executed_on:riyadhToday(),bank_reference:'syn-pay-1',evidence:'إشعار تحويل تجريبي من بنك الشركة'}));
  assert.equal(done.status,'executed');
  let payable=control(db,'salaries_payable');
  assert.deepEqual([payable.subledger_minor,payable.ledger_minor,payable.items.map(i=>i.reason)],[0,1800000,['no_journal']],'the executed payment is in the sub-ledger and waits for its journal');
  books.post(books.journal('payroll_payment',paymentId,riyadhToday()));
  payable=control(db,'salaries_payable');
  assert.deepEqual([payable.subledger_minor,payable.ledger_minor,payable.balanced],[0,0,true]);
  const trace=traceAmount(db,books.approver,{kind:'payroll_run',id:june.id});
  assert.equal(trace.chain.find(s=>s.step==='settlement').items[0].journal.status,'posted');
  assert.ok(verifyAudit(db));
});

test('salary advance: its payout is recorded once by a fourth person, becomes a ledger document, and the instalments recovered in a run bring employee advances back down',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  const month=riyadhToday().slice(0,7);
  const advanceId=w.tx(()=>proposeAdvance(db,w.U.hr,{user_id:'outsider',amount:'1200.00',installments:2,first_month:month,reason:'سلفة تجريبية موثقة بطلب تجريبي'})).id;
  const disburse=(who,input={})=>w.tx(()=>recordAdvanceDisbursement(db,w.U[who],advanceId,{disbursed_on:riyadhToday(),reference:'syn-adv-1',evidence:'إشعار تحويل السلفة التجريبي',...input}));
  assert.equal(caught(()=>disburse('reviewer')).code,'advance_not_approved');
  assert.throws(()=>db.prepare("UPDATE salary_advances SET disbursed_on=?,disbursement_reference='X-1',disbursement_evidence='دليل تجريبي كافٍ',disbursed_by='reviewer',disbursement_recorded_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(riyadhToday(),advanceId),/final|paid out/,'a proposed advance is not paid out, even by SQL');
  w.tx(()=>decideAdvance(db,w.U['hr-manager'],advanceId,'approve',{note:'اعتماد تجريبي للسلفة'}));
  // قبل الصرف: المسير المفتوح ينبّه أن أقساطها تُسترد وصرفها ما انسجّل.
  const draft=w.prepare(month);
  assert.ok(preRunChecks(db,w.U.hr,draft).some(c=>/سلفة/.test(c.title)&&c.level==='warn'));
  assert.ok(extrasBoard(db,w.U.reviewer).advances.find(a=>a.id===advanceId).actions.includes('record_disbursement'));
  assert.deepEqual(extrasBoard(db,w.U['hr-manager']).advances.find(a=>a.id===advanceId).actions,[],'its approver is not offered the payout');
  assert.equal(caught(()=>disburse('hr-manager')).code,'separation_of_duties');
  assert.equal(caught(()=>disburse('hr')).code,'not_permitted','the proposer holds preparation only');
  assert.equal(caught(()=>disburse('outsider')).code,'advance_not_found','the employee does not see it');
  assert.equal(caught(()=>disburse('reviewer',{disbursed_on:'2026-01-01'})).code,'disbursed_on');
  const paid=disburse('reviewer');
  assert.deepEqual([paid.disbursed_on,paid.disbursement_reference],[riyadhToday(),'SYN-ADV-1']);
  assert.equal(caught(()=>disburse('approver-2')).code,'advance_disbursed');
  assert.throws(()=>db.prepare('UPDATE salary_advances SET disbursed_on=NULL WHERE id=?').run(advanceId),/final/);
  assert.equal(preRunChecks(db,w.U.hr,w.view('hr',draft)).some(c=>/سلفة/.test(c.title)),false,'the warning goes once the payout is recorded');
  assert.deepEqual(linesOf(db,books.post(books.journal('salary_advance',advanceId,riyadhToday())).id),[['1200','GEN',120000,0],['1000','GEN',0,120000]]);
  const run=w.approve(w.review(w.run('hr',w.view('hr',draft),'submit_run')));
  assert.equal(w.lineOf(run,'outsider').advance_minor,60000);
  books.postRun(run.id);
  assert.deepEqual([control(db,'employee_advances').subledger_minor,control(db,'employee_advances').ledger_minor],[120000,120000],'today: paid out, nothing recovered yet');
  const advances=control(db,'employee_advances',sourceKind('payroll_run').document(db,'36t',run.id).date);
  assert.deepEqual([advances.subledger_minor,advances.ledger_minor,advances.balanced],[60000,60000,true],'at the month end: paid out 1,200.00, recovered 600.00 in the first instalment');
  const trace=traceAmount(db,books.approver,{kind:'salary_advance',id:advanceId});
  assert.deepEqual(trace.chain.find(s=>s.step==='approvals').items.map(a=>a.actor_id),['hr','hr-manager','reviewer']);
  assert.deepEqual(trace.chain.find(s=>s.step==='settlement').items.map(i=>i.reference),[`PAY-${month}`]);
  assert.ok(verifyAudit(db));
});

test('payroll control accounts: absent while a tenant has neither a payroll document nor a mapped account, and shown unmapped once a run is approved without one',t=>{
  const w=hrCycle(t),{db}=w;
  assert.equal(control(w.db,'salaries_payable'),undefined,'no document and no account: nothing to reconcile, and the report stays balanced');
  assert.equal(controlReconciliation(db,'36t',riyadhToday()).controls.some(c=>['salaries_payable','employee_advances'].includes(c.key)),false);
  const june=w.approveMonth('2026-06');
  const payable=control(db,'salaries_payable');
  assert.deepEqual([payable.mapped,payable.documents,payable.subledger_minor],[false,1,1800000]);
  assert.equal(sourceKind('payroll_run').pending(db,'36t').find(p=>p.source_id===june.id).date,'2026-06-30','the run waits for its journal at its month end, the date the journal carries');
});
