// دورة الموارد البشرية والرواتب من التوظيف إلى المسير الموازي (الحزمة 4، P4-HR-0): اختبار لكل خطوة على عالم تجريبي واحد
// (tests/hr-cycle-fixture.mjs): كيان مصطنع، ويونيو ويوليو وأغسطس 2026. ما يعمل اليوم يمرّ؛ وكل فجوة اختبارٌ متخطًّى يسمّي
// الحزمة الفرعية التي تملكها، فيُرفع التخطّي حين تُبنى ويُرى أحمر قبل الإصلاح وأخضر بعده.
//   1 التوظيف · 2 التغيير التنظيمي · 3 شهر الحضور · 4 الإجازة · 5 المزايا · 6 المدخلات · 7 الاحتساب · 8 المراجعة والاعتماد
//   9 القيد المحاسبي · 10 العكس · 11 التصدير · 12 المسير الموازي
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as people from '../app/people.mjs';
import * as employees from '../app/employees.mjs';
import * as payroll from '../app/payroll.mjs';
import * as leaveTypes from '../app/leave-types.mjs';
import { personDepartment } from '../app/people-read.mjs';
import { controlReconciliation } from '../app/ledger.mjs';
import { sourceKind } from '../app/ledger-sources.mjs';
import { recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, payrollPaymentAction, payrollPaymentFile, extrasBoard } from '../app/payroll-extras.mjs';
import { recordFileFormat, decideFileFormat, preExportChecks, prepareWageFile, wageFileContent, recordManualUpload } from '../app/wage-protection.mjs';
import { riyadhToday } from '../app/riyadh-time.mjs';
import { hrCycle, code, caught } from './hr-cycle-fixture.mjs';
import { payrollBooks, linesOf } from './payroll-books.mjs';
import { iban } from './wage-fixture.mjs';

const HEX=/^[0-9a-f]{64}$/;

test('1 hire — the accepted candidate becomes one account and one contract, linked candidate → user → contract exactly once',t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  assert.equal(h.candidate.status,'completed');
  assert.ok(h.candidate.actions.includes('link_hire'),'HR is offered the link once onboarding is done');
  const linked=w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:h.candidate.version,user_id:h.userId,contract_id:h.contractId,evidence:'ربط تجريبي بعد فتح الحساب واعتماد العقد'}));
  assert.equal(linked.hire.user_id,h.userId);assert.equal(linked.hire.contract_id,h.contractId);
  assert.equal(linked.actions.includes('link_hire'),false,'a complete link offers nothing more');
  assert.throws(()=>w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:linked.version,user_id:h.userId,evidence:'محاولة ربط ثانية للمرشح نفسه'})),code('hire_linked'));
  const other=w.hire({username:'second.hire'});
  assert.throws(()=>w.tx(()=>people.linkHire(db,w.U.hr,other.candidate.id,{version:other.candidate.version,user_id:h.userId,evidence:'ربط حساب مربوط من قبل بمرشح آخر'})),code('user_hired'));
  assert.throws(()=>db.prepare('UPDATE employee_hires SET user_id=? WHERE candidate_id=?').run(other.userId,h.candidate.id),/hire link/);
  assert.throws(()=>db.prepare('DELETE FROM employee_hires').run(),/hire link/);
  assert.ok(verifyAudit(db));
});

test('2 org change — a dated transfer waits for a second HR holder, applies on its date, and the department at any date is readable',t=>{
  const w=hrCycle(t),{db}=w;
  const before=employees.employeeRecord(db,w.U.hr,'employee');
  assert.throws(()=>w.tx(()=>employees.saveProfile(db,w.U.hr,'employee',{job_title:'مسمى جديد من الملف مباشرة',employment_type:'full_time',join_date:'2025-01-01',status:'active',version:before.profile.version})),code('dated_field'));
  const recorded=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'department',to_value:'production',effective_from:'2026-07-01',reason:'نقل تجريبي إلى الإنتاج بقرار تجريبي'}));
  const change=recorded.changes.find(c=>c.id===recorded.change_id);
  assert.equal(change.approved_at,null);assert.equal(change.applied_at,null);
  assert.equal(personDepartment(db,'employee'),'creative','nothing moves before a second person approves, even when the date has come');
  assert.throws(()=>w.tx(()=>employees.approveChange(db,w.U.hr,change.id,{})),code('self_approval'));
  const approved=w.tx(()=>employees.approveChange(db,w.U['hr-manager'],change.id,{note:'اعتماد تجريبي للنقل'}));
  assert.equal(approved.applied,true,'a due change applies at its approval');
  assert.equal(personDepartment(db,'employee'),'production');
  assert.equal(employees.orgOn(db,'employee','2026-06-15',{tenantId:'36t'}).department_id,'creative');
  assert.equal(employees.orgOn(db,'employee','2026-07-15',{tenantId:'36t'}).department_id,'production');
  assert.equal(employees.orgOn(db,'employee','2026-07-15',{tenantId:'isolated'}),null,'another tenant reads nothing');
  assert.ok(verifyAudit(db));
});

test('3 attendance month — a confirmed unpaid day deducts in its own month at the contract total ÷ 30, and only for its owner',t=>{
  const w=hrCycle(t);
  w.absence('employee','2026-06-10');
  const june=w.approveMonth('2026-06'),line=w.lineOf(june,'employee');
  assert.equal(june.status,'approved');
  assert.equal(line.unpaid_absence_minor,33333,'1,000,000 × 1 ÷ 30');
  assert.deepEqual(line.basis.parts[0].unpaid_dates,['2026-06-10']);
  assert.equal(line.net_minor,1000000-33333);
  assert.equal(w.lineOf(june,'outsider').unpaid_absence_minor,0);
  assert.ok(verifyAudit(w.db));
});

test('4 leave — approved unpaid leave proposes its wage effect for its month, and the run deducts it once a payroll approver approves it',t=>{
  const w=hrCycle(t);
  const leave=w.unpaidLeave('2026-07-05','2026-07-09');
  assert.equal(leave.status,'approved');
  const [effect]=w.effectsOf(leave.id);
  assert.deepEqual([effect.status,effect.month,effect.amount_minor],['proposed','2026-07',166667],'1,000,000 × 5 ÷ 30');
  w.decide(effect.adjustment_id);
  const july=w.approveMonth('2026-07'),line=w.lineOf(july,'employee');
  assert.equal(line.other_deductions_minor,166667);
  assert.ok(line.adjustments.some(a=>a.id===effect.adjustment_id));
  assert.equal(line.net_minor,1000000-166667);
  assert.ok(verifyAudit(w.db));
});

test('5 benefit — a confirmed benefit reaches payroll only as a proposed movement, and enters the run once approved',t=>{
  const w=hrCycle(t);
  const id=w.benefit('employee',150000,'2026-07');
  const row=w.db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(id);
  assert.deepEqual([row.status,row.kind,row.month,row.amount_minor],['proposed','allowance','2026-07',150000]);
  let july=w.prepare('2026-07');
  assert.equal(w.lineOf(july,'employee').additions_minor,0,'a proposed benefit is not paid');
  w.decide(id);
  july=w.run('hr',w.view('hr',july),'recalculate');
  assert.equal(w.lineOf(july,'employee').additions_minor,150000);
  july=w.approve(w.review(w.run('hr',july,'submit_run')));
  assert.equal(july.status,'approved');
  assert.ok(verifyAudit(w.db));
});

test('6 inputs — consent is given over HTTP by the wage owner, a locked month and a withdrawn leave effect are not approvable, and a paid effect withdrawn is refunded once',async t=>{
  const w=hrCycle(t),{db}=w;
  // (أ) الموافقة الخطية (م51) بهوية صاحب الأجر عبر الخادم الحقيقي.
  const consentful=w.propose({user_id:'employee',kind:'deduction',month:'2026-08',amount:'200.00',deduction_basis:'consent',deduction_reference:'إقرار تجريبي'});
  const call=await w.http(['employee','outsider']);
  assert.equal((await call('outsider','POST',`/payroll/adjustments/${consentful}/consent`,{consent:true})).status,404,'nobody consents for the worker');
  const given=await call('employee','POST',`/payroll/adjustments/${consentful}/consent`,{consent:true});
  assert.equal(given.status,201,given.text);assert.ok(given.json().consent_at);
  w.decide(consentful);
  // (ب) شهر تجاوز مسيره المسودة لا تُعتمد له حركة: كانت تُعتمد ولا تُدفع أبدًا.
  const late=w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'300.00'});
  w.run('hr',w.prepare('2026-07'),'submit_run');
  assert.equal(caught(()=>w.decide(late)).code,'month_locked');
  assert.equal(db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(late).status,'proposed');
  // (ج) أثر إجازة سُحب لا يُعتمد خصمه.
  const withdrawnLeave=w.unpaidLeave('2026-08-02','2026-08-03');
  w.leaveAct('hr',w.leave('hr',withdrawnLeave.id),'cancel',{note:'إلغاء تجريبي قبل اعتماد الخصم'});
  const [withdrawn]=w.effectsOf(withdrawnLeave.id);
  assert.equal(withdrawn.status,'withdrawn');
  assert.equal(caught(()=>w.decide(withdrawn.adjustment_id)).code,'leave_effect_withdrawn');
  w.decide(withdrawn.adjustment_id,'reject');
  // (د) أثر دُفع في مسير معتمد ثم سُحب: حركة ردّ واحدة مقترحة، ولا ثانية مهما تكرر السحب.
  const paidLeave=w.unpaidLeave('2026-06-07','2026-06-08');
  const [paidEffect]=w.effectsOf(paidLeave.id);
  w.decide(paidEffect.adjustment_id);
  assert.equal(w.approveMonth('2026-06').status,'approved');
  w.leaveAct('hr',w.leave('hr',paidLeave.id),'cancel',{note:'إلغاء تجريبي بعد دفع الخصم'});
  const refunds=db.prepare('SELECT * FROM leave_pay_effect_refunds WHERE effect_id=?').all(paidEffect.id);
  assert.equal(refunds.length,1);
  const refund=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(refunds[0].refund_id);
  assert.deepEqual([refund.kind,refund.status,refund.amount_minor,refund.user_id],['allowance','proposed',paidEffect.amount_minor,'employee']);
  w.tx(()=>leaveTypes.withdrawPayEffects(db,w.U.hr,w.leave('hr',paidLeave.id)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_pay_effect_refunds WHERE effect_id=?').get(paidEffect.id).n,1,'withdrawing again proposes nothing more');
  assert.ok(verifyAudit(db));
});

test('7 calculation — computing a month writes nothing, and the run keeps the digest of exactly the inputs it used',t=>{
  const w=hrCycle(t),{db}=w;
  w.absence('employee','2026-07-14');
  w.decide(w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'400.00'}));
  const count=()=>db.prepare("SELECT (SELECT COUNT(*) FROM payroll_lines)||':'||(SELECT COUNT(*) FROM payroll_adjustments WHERE run_id IS NOT NULL)||':'||(SELECT COUNT(*) FROM audit_events)||':'||(SELECT COUNT(*) FROM payroll_runs) AS n").get().n;
  const before=count(),computed=payroll.computeRunLines(db,'36t','2026-07');
  assert.equal(count(),before,'a pure computation leaves no row behind');
  assert.match(computed.digest,HEX);
  const july=w.prepare('2026-07');
  assert.equal(july.inputs_digest,computed.digest,'the run stores the digest of the inputs it was calculated from');
  assert.deepEqual(Object.fromEntries(july.lines.map(l=>[l.user_id,l.net_minor])),Object.fromEntries(computed.lines.map(l=>[l.user_id,l.net_minor])));
  assert.equal(w.lineOf(july,'employee').unpaid_absence_minor,33333);
  assert.equal(w.lineOf(july,'outsider').additions_minor,40000);
  assert.equal(caught(()=>payroll.computeRunLines(db,'isolated','2026-07')).code,'policy_required','another tenant has none of this tenant’s rules to compute with');
});

test('8 review and approval — an input that changes after calculation blocks submission, review and approval by name until the run is recalculated',t=>{
  const w=hrCycle(t),{db}=w;
  let june=w.review(w.run('hr',w.prepare('2026-06'),'submit_run'));
  w.absence('employee','2026-06-17');
  const blocked=caught(()=>w.approve(june));
  assert.equal(blocked.code,'inputs_changed');
  assert.deepEqual(blocked.details.refusal.missing.map(m=>m.doc_key),['absences']);
  assert.equal(w.view('hr',june).status,'reviewed','nothing moved');
  const stale=june;
  june=w.run('hr-manager',w.view('hr-manager',june),'return_run',{note:'غياب اعتُمد بعد الاحتساب'});
  assert.equal(caught(()=>w.approve(stale)).code,'action_unavailable');
  june=w.run('hr',w.view('hr',june),'recalculate');
  assert.equal(w.lineOf(june,'employee').unpaid_absence_minor,33333);
  june=w.approve(w.review(w.run('hr',june,'submit_run')));
  assert.equal(june.status,'approved');
  assert.equal(caught(()=>w.run('hr-manager',stale,'approve_run')).code,'stale_version');
  assert.ok(verifyAudit(db));
});

// P4-HR-3 (الترحيل 174): القيد بتاريخ آخر الشهر، ومصروف كل موظف على مركز إدارته في ذلك اليوم (orgOn)، وكل حسم إلى التزامه،
// ومرة واحدة؛ والمسير في الأستاذ المساعد لـ«رواتب مستحقة الدفع» فتطابقه المطابقة بالحساب الرقابي.
test('9 accounting — an approved run posts once, with cost by the department each person belonged to in that month',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db,{departments:{creative:'CC-CRE',production:'CC-PRD'}});
  const june=w.approveMonth('2026-06');
  // إجازة بلا أجر في أول يوليو وهي في الإبداعي، ثم تنتقل إلى الإنتاج من 15 يوليو: إدارتها في آخر يوليو الإنتاج، فتكلفة يوليو كلها
  // على مركزه (D3) — ومنها نقص الإجازة.
  w.decide(w.effectsOf(w.unpaidLeave('2026-07-05','2026-07-09').id)[0].adjustment_id);
  const moved=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'department',to_value:'production',effective_from:'2026-07-15',reason:'نقل تجريبي منتصف يوليو إلى الإنتاج'}));
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],moved.change_id,{note:'اعتماد تجريبي للنقل'}));
  w.decide(w.propose({user_id:'outsider',kind:'bonus',month:'2026-07',amount:'400.00'}));
  w.decide(w.propose({user_id:'outsider',kind:'deduction',month:'2026-07',amount:'500.00',deduction_basis:'court_order',deduction_reference:'حكم تجريبي رقم 1'}));
  const july=w.approveMonth('2026-07');
  const juneJournal=books.postRun(june.id),julyJournal=books.postRun(july.id);
  assert.deepEqual([juneJournal.entry_date,julyJournal.entry_date],['2026-06-30','2026-07-31'],'each run is dated on its last day');
  assert.deepEqual(linesOf(db,juneJournal.id),[['5000','CC-CRE',1800000,0],['2100','GEN',0,1800000]],'June: both on the creative centre');
  assert.deepEqual(linesOf(db,julyJournal.id),[['5000','CC-CRE',840000,0],['5000','CC-PRD',833333,0],['2130','GEN',0,50000],['2100','GEN',0,833333+790000]],
    'July: the colleague on creative with his bonus; the employee on production, less her unpaid leave; the court order owed onwards, not netted');
  assert.equal(caught(()=>books.journal('payroll_run',july.id,'2026-07')).code,'duplicate_source','a run posts once');
  assert.equal(sourceKind('payroll_run').pending(db,'36t').find(p=>p.source_id===july.id).date,'2026-07-31');
  const payable=controlReconciliation(db,'36t','2026-07-31').controls.find(c=>c.key==='salaries_payable');
  assert.deepEqual([payable.subledger_minor,payable.ledger_minor,payable.balanced,payable.items.length],[1800000+833333+790000,1800000+833333+790000,true,0]);
  assert.ok(verifyAudit(db));
});
// حساب الراتب بيدين (hr يسجّل وhr-manager يتحقق)، والتحويل يُعدّه hr ويعتمده hr-manager بعد ترحيل قيد المسير (D5).
const verifiedBank=(w,userId,bban)=>{const {id}=w.tx(()=>recordEmployeeBank(w.db,w.U.hr,{user_id:userId,bank_name:'بنك تجريبي',iban:iban(bban),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم صاحب الحساب'}));
  w.tx(()=>decideEmployeeBank(w.db,w.U['hr-manager'],id,'verify',{note:'طابقت الخطاب البنكي التجريبي مع الاسم'}));};
const payment=(w,paymentId,who='hr-manager')=>extrasBoard(w.db,w.U[who]).payments.find(p=>p.id===paymentId);
const approveTransfer=(w,paymentId)=>w.tx(()=>payrollPaymentAction(w.db,w.U['hr-manager'],paymentId,'approve_payment',{version:payment(w,paymentId).version,note:'طابقت الإجمالي مع المسير المعتمد'}));

// P4-HR-4 (الترحيل 175): المسير المعتمد لا يُعدَّل؛ يُعكس بمستند مستقل قبل صرفه، يطلبه واحد ويعتمده غيره (D6). اعتماد العكس يلغي التحويل
// الحي، ويحرر حركات المسير لمسيره المصحَّح، ويبلّغ أصحاب القسائم؛ وقيد العكس يعكس قيد المسير المرحّل بحرفه في تاريخه.
test('10 reversal — an approved run is corrected by a dated reversal, never by editing it',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  verifiedBank(w,'employee','80000000000000000021');verifiedBank(w,'outsider','80000000000000000039');
  const bonus=w.propose({user_id:'outsider',kind:'bonus',month:'2026-06',amount:'300.00'});w.decide(bonus);
  let june=w.approveMonth('2026-06');
  const runJournal=books.postRun(june.id);
  const paymentId=w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id})).id;
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='reversed',version=version+1 WHERE id=?").run(june.id),/locked/,'an approved run does not move without an approved reversal');
  june=w.run('hr-manager',w.view('hr-manager',june),'request_run_reversal',{reason:'سطر الموظفة احتُسب على عقد قبل اعتماد تعديله التجريبي'});
  assert.equal(june.reversal.status,'requested');
  assert.equal(caught(()=>w.run('hr-manager',june,'approve_run_reversal',{note:'اعتماد ذاتي للعكس التجريبي'})).code,'self_approval');
  june=w.run('approver-2',w.view('approver-2',june),'approve_run_reversal',{note:'تأكدت أن ملف التحويل ما انصرف في البنك التجريبي'});
  assert.deepEqual([june.status,june.reversal.status,june.reversal.reversed_on],['reversed','approved',riyadhToday()]);
  assert.equal(db.prepare('SELECT status FROM payroll_payments WHERE id=?').get(paymentId).status,'cancelled','the live transfer is cancelled with the reversal');
  assert.equal(db.prepare('SELECT run_id FROM payroll_adjustments WHERE id=?').get(bonus).run_id,null,'the bonus is free for the corrected run');
  assert.equal(payroll.listPayroll(db,w.U.employee).payslips.some(s=>s.month==='2026-06'),false,'the withdrawn payslip is no longer shown');
  assert.deepEqual(db.prepare("SELECT user_id FROM notifications WHERE subject_kind='payroll_run' AND kind='payroll_run_reversed' ORDER BY user_id").all().map(n=>n.user_id),['employee','outsider'],'every payslip owner is told');
  const corrected=w.approveMonth('2026-06');
  assert.notEqual(corrected.id,june.id);assert.equal(w.lineOf(corrected,'outsider').additions_minor,30000);
  const reversalId=june.reversal.id,mirror=books.post(books.journal('payroll_run_reversal',reversalId,'2026-06'));
  assert.equal(mirror.entry_date,'2026-06-30');
  assert.deepEqual(linesOf(db,mirror.id),linesOf(db,runJournal.id).map(([account,centre,debit,credit])=>[account,centre,credit,debit]),'the reversal mirrors the posted run journal line by line');
  const correctedJournal=books.postRun(corrected.id);
  assert.deepEqual([runJournal,mirror,correctedJournal].map(j=>j.source_reference),['PAY-2026-06','REV-PAY-2026-06','PAY-2026-06-2'],'three documents, three references');
  const payable=controlReconciliation(db,'36t','2026-06-30').controls.find(c=>c.key==='salaries_payable');
  assert.deepEqual([payable.subledger_minor,payable.ledger_minor,payable.balanced],[corrected.net_minor,corrected.net_minor,true],'June carries the corrected cost, not the original and the correction together');
  assert.ok(verifyAudit(db));
});
// P4-HR-4 (D7، الترحيل 175): البنك يأخذ ملف التحويل والجهة تأخذ نسخة الامتثال، من السطور نفسها؛ والنسخة تُصدَّر من التحويل المعتمد بمجموعه
// وتُرفع مرة واحدة للمسير.
test('11 export — the approved run leaves as the bank and wage-protection files from the same lines',t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  verifiedBank(w,'employee','80000000000000000021');verifiedBank(w,'outsider','80000000000000000039');
  for(const who of ['employee','outsider'])w.tx(()=>employees.addDocument(db,w.U.hr,who,{doc_type:'national_id',reference:'آخر 4 أرقام 1234',issued_on:'2020-01-01',expires_on:'2030-12-31',note:'وثيقة تجريبية'}));
  const column=(position,name,source,type,extra={})=>({position,name,source,type,length:null,required:true,value:'',pad:'right',pad_char:'space',...extra});
  const formatId=w.tx(()=>recordFileFormat(db,w.U.hr,{bank_name:'بنك تجريبي',format_label:'صيغة تجريبية v1',layout:'delimited',delimiter:',',encoding:'utf-8',line_ending:'crlf',include_header:true,
    columns:[column(1,'EMP_ID','employee_id','text'),column(2,'IBAN','iban','text',{length:24}),column(3,'NET','net_amount','amount'),column(4,'MONTH','month','month')],
    spec_source:'قرأتها من شاشة مواصفة الملف في حساب المنشأة التجريبي',spec_confirmed_on:'2026-06-01'})).id;
  w.tx(()=>decideFileFormat(db,w.U['hr-manager'],formatId,'confirm',{version:1,note:'طابقت المواصفة مع حساب المنشأة التجريبي'}));
  const june=w.approveMonth('2026-06');
  assert.deepEqual(preExportChecks(db,w.U.hr,june.id).blocking.map(c=>c.key),['transfer_not_approved'],'no compliance copy before the approved transfer');
  assert.equal(caught(()=>w.tx(()=>prepareWageFile(db,w.U.hr,{run_id:june.id}))).code,'export_blocked');
  const paymentId=w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id})).id;
  books.postRun(june.id);approveTransfer(w,paymentId);
  const rows=content=>content.replace(/^\ufeff/,'').split('\r\n').filter(Boolean).slice(2).map(r=>r.split(','));
  const bankRows=rows(payrollPaymentFile(db,w.U.reviewer,paymentId).content).map(r=>[r[0],r[4]]).sort();
  const exportId=w.tx(()=>prepareWageFile(db,w.U.hr,{run_id:june.id})).id;
  const wpsRows=rows(wageFileContent(db,w.U.hr,exportId).content).map(r=>[r[0],r[2]]).sort();
  assert.deepEqual(wpsRows,bankRows,'each employee leaves with the same net in both files');
  assert.equal(bankRows.reduce((n,[,net])=>n+Math.round(Number(net)*100),0),june.net_minor);
  assert.equal(db.prepare('SELECT payment_id FROM wps_exports WHERE id=?').get(exportId).payment_id,paymentId,'the compliance copy names the transfer it came from');
  // نسخة ثانية قبل الرفع تُصدَّر، لكن الرفع للمسير مرة واحدة.
  const second=w.tx(()=>prepareWageFile(db,w.U.hr,{run_id:june.id})).id;
  const upload={version:1,uploaded_on:riyadhToday(),reference:'REF-SYN-1',note:'رفعته يدويًا في بوابة المنشأة التجريبية واستلمت إشعارًا'};
  w.tx(()=>recordManualUpload(db,w.U.reviewer,exportId,upload));
  assert.equal(caught(()=>w.tx(()=>recordManualUpload(db,w.U.reviewer,second,{...upload,reference:'REF-SYN-2'}))).code,'run_already_uploaded');
  assert.throws(()=>db.prepare("UPDATE wps_exports SET uploaded_on=?,upload_reference='REF-SYN-3',upload_note='رفع ثانٍ مكتوب بالقاعدة مباشرة',upload_recorded_by='reviewer',upload_recorded_at=?,version=version+1 WHERE id=?").run(riyadhToday(),'2026-10-01T00:00:00.000Z',second),/UNIQUE/,'the database keeps one upload per run');
  assert.ok(preExportChecks(db,w.U.hr,june.id).blocking.some(c=>c.key==='already_uploaded'));
  assert.ok(verifyAudit(db));
});
// المسير الموازي (P4-HR-5، الترحيل 176): يونيو إلى أغسطس شهور موازية — النظام السابق يدفعها والمنصة تحسبها وتقارنها بند ببند
// وموظفًا موظفًا مع دفعة سابقة مصطنعة (كشف تفصيلي وملف بنك) يؤكدها شخص ثانٍ. كل فرق يفسّره شخص ثانٍ، والانتقال يقرره شخصان
// بعد قيمتين يعتمدهما المالك. الوحدات تُستورد داخل الخطوة فلا تمسّ استيرادات الخطوات الأخرى.
test('12 parallel payroll — the platform run is compared line by line with the outside payroll for the same months',async t=>{
  const parallel=await import('../app/payroll-parallel.mjs');
  const [{preparePayrollPayment},{prepareWageFile},{journalFromSource},{adoptionAction}]=await Promise.all(['payroll-extras','wage-protection','ledger','options'].map(m=>import(`../app/${m}.mjs`)));
  const w=hrCycle(t),{db}=w,act=(who,fn,...args)=>w.tx(()=>fn(db,w.U[who],...args));
  const HEAD='employee,basic,housing,transport,other_allowance,overtime,other_additions,absence_deduction,gosi_employee,advance,other_deductions,net';
  const legacy=(rows,paid)=>({breakdown_csv:[HEAD,...rows].join('\r\n'),bank_csv:['employee,amount',...paid].join('\r\n'),source_note:'كشف رواتب تجريبي وملف بنك تجريبي — بيانات مصطنعة'});
  const standard=legacy(['employee,8000.00,2000.00,0,0,0,0,0,0,0,0,10000.00','outsider,6000.00,1500.00,500.00,0,0,0,0,0,0,0,8000.00'],['employee,10000.00','outsider,8000.00']);
  const confirm=(batch,who='hr-manager')=>act(who,parallel.decideLegacyBatch,batch.id,'confirm',{version:1,note:'طابقت مجموع ملف البنك التجريبي مع الكشف'});
  const monthOf=(month,who='reviewer')=>parallel.parallelBoard(db,w.U[who]).months.find(m=>m.month===month);
  const unexplained=month=>monthOf(month).comparison.differences.filter(d=>!d.explanation);
  const explain=(month,cause,note)=>{const m=monthOf(month);return act('reviewer',parallel.explainDifferences,m.comparison.id,{difference_ids:unexplained(month).map(d=>d.id),cause,note});};

  // (أ) قبل أن يعتمد المالك الحد وعدد الشهور: الانتقال مرفوض برفض يسمّي القيمتين.
  let ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.equal(ready.ready,false);
  assert.deepEqual(ready.blockers.map(b=>b.doc_key),['value:payroll.parallel.tolerance','value:payroll.parallel.required_months','months:none']);
  assert.equal(caught(()=>act('hr-manager',parallel.recordCutover,{note:'محاولة انتقال قبل أي شهر موازٍ'})).code,'parallel_values_unadopted');

  // (ب) الشهور الثلاثة موازية: المنصة تحسب وتعتمد يونيو، والدفع وملف حماية الأجور والقيد والقسيمة كلها للنظام السابق.
  for(const month of ['2026-06','2026-07','2026-08'])act('hr-manager',parallel.declareParallelMonth,{month,basis:'قرار تجريبي: النظام السابق يدفع والمنصة تحسب وتقارن'});
  w.absence('employee','2026-06-10');
  const june=w.approveMonth('2026-06');
  assert.equal(june.status,'approved','the platform rehearses its own cycle in a parallel month');
  assert.equal(caught(()=>w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id}))).code,'parallel_month');
  assert.equal(caught(()=>w.tx(()=>prepareWageFile(db,w.U.hr,{run_id:june.id}))).code,'parallel_month');
  for(const action of ['read','prepare'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'36t','manager','manager',action,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض دفتر مصطنع لاختبار الموازي',null,new Date().toISOString());
  const journal=caught(()=>w.tx(()=>journalFromSource(db,w.U.manager,{source_kind:'payroll_run',source_id:june.id,period_id:'synthetic'})));
  assert.equal(journal.code,'parallel_month');assert.match(journal.details.refusal.what,/2026-06/);
  assert.throws(()=>db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES('syn-pay','36t',?,1,1,'x','pending','hr','t','t')").run(june.id),/parallel month/,'the database refuses a platform payment too');
  assert.equal(payroll.listPayroll(db,w.U.employee).payslips.some(p=>p.month==='2026-06'),false,'the payslip of record for a parallel month is the legacy one');
  assert.equal(caught(()=>w.tx(()=>payroll.viewPayslip(db,w.U.employee,w.lineOf(june,'employee').id))).code,'parallel_month');

  // (ج) دفعة النظام السابق ليونيو: الكشف التفصيلي وملف البنك، ويؤكدها شخص غير من استوردها.
  const juneBatch=act('hr',parallel.importLegacyBatch,{month:'2026-06',...standard});
  assert.equal(caught(()=>confirm(juneBatch,'hr')).code,'separation_of_duties');
  assert.throws(()=>db.prepare("UPDATE payroll_legacy_batches SET status='confirmed',decided_by=imported_by,decided_at='t',decision_note='تأكيد ذاتي مباشر',version=version+1 WHERE id=?").run(juneBatch.id),/CHECK constraint/);
  confirm(juneBatch);

  // (د) المقارنة بندًا بندًا وموظفًا موظفًا: الغياب المعتمد في المنصة ما خصمه النظام السابق — فرق واحد يُسمّى ويُبلَّغ عنه.
  const juneCmp=act('hr',parallel.compareParallelMonth,{month:'2026-06'});
  assert.match(juneCmp.inputs_digest,HEX,'the comparison keeps the digest of the inputs it compared');
  const diffs=monthOf('2026-06').comparison.differences;
  assert.deepEqual(diffs.map(d=>[d.user_id,d.component,d.legacy_minor,d.platform_minor,d.delta_minor]),[['employee','absence_deduction',0,33333,33333]]);
  const notices=db.prepare("SELECT user_id,title,body FROM notifications WHERE subject_kind='payroll_parallel' AND kind='parallel_explanation_needed' ORDER BY user_id").all();
  assert.deepEqual(notices.map(n=>n.user_id),['approver-2','hr-manager','reviewer'],'whoever can explain is told; the comparer is not');
  assert.ok(notices.every(n=>!/333/.test(n.title+n.body)),'no pay figure travels in a notification');
  assert.equal(caught(()=>act('hr',parallel.explainDifferences,juneCmp.id,{difference_ids:[diffs[0].id],cause:'legacy_error',note:'محاولة تفسير من المقارن نفسه'})).code,'separation_of_duties');
  assert.throws(()=>db.prepare("INSERT INTO payroll_parallel_explanations(id,tenant_id,difference_id,batch_id,user_id,component,legacy_minor,platform_minor,cause,note,explained_by,explained_at) VALUES('syn-x','36t',?,?,'employee','absence_deduction',0,33333,'legacy_error','تفسير مباشر من المقارن','hr','t')").run(diffs[0].id,juneBatch.id),/second person/);
  explain('2026-06','legacy_error','النظام السابق ما خصم غياب 10 يونيو المعتمد؛ يُسوّى عنده لأنه دافع الشهر');
  assert.equal(monthOf('2026-06').clean,false,'clean is measured against the owner’s tolerance, which is not adopted yet');

  // (هـ) المالك يعتمد الحد (صفر فرق غير مفسّر) وعدد الشهور (ثلاثة) بيدين.
  for(const [key,value] of [[parallel.TOLERANCE,{unexplained_max:0}],[parallel.REQUIRED_MONTHS,{months:3}]]){
    w.tx(()=>adoptionAction(db,w.U['hr-manager'],key,'record',{value,basis:'قرار تجريبي للمسير الموازي في بيئة الاختبار',effective_from:'2026-09-01'}));
    const pending=db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(key).id;
    w.tx(()=>adoptionAction(db,w.U['approver-2'],key,'approve',{adoption_id:pending,note:'اعتماد تجريبي من شخص ثانٍ'}));
  }
  ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.deepEqual(ready.months.map(m=>[m.month,m.state]),[['2026-06','clean'],['2026-07','no_batch'],['2026-08','no_batch']]);
  assert.deepEqual(ready.blockers.map(b=>b.doc_key),['month:2026-07','month:2026-08']);
  assert.equal(caught(()=>act('hr-manager',parallel.recordCutover,{note:'محاولة انتقال قبل اكتمال الشهور'})).code,'cutover_not_ready');

  // (و) يوليو يتطابق كاملًا، وأغسطس فيه عمل إضافي صرفه النظام السابق بلا قرار في المنصة حتى يُفسَّر.
  confirm(act('hr',parallel.importLegacyBatch,{month:'2026-07',...standard}));
  act('hr',parallel.compareParallelMonth,{month:'2026-07'});
  assert.deepEqual(monthOf('2026-07').comparison.differences,[]);
  confirm(act('hr',parallel.importLegacyBatch,{month:'2026-08',...legacy(['employee,8000.00,2000.00,0,0,0,0,0,0,0,0,10000.00','outsider,6000.00,1500.00,500.00,0,300.00,0,0,0,0,0,8300.00'],['employee,10000.00','outsider,8300.00'])}));
  act('hr',parallel.compareParallelMonth,{month:'2026-08'});
  assert.deepEqual(unexplained('2026-08').map(d=>[d.user_id,d.component,d.delta_minor]),[['outsider','overtime',-30000]]);
  explain('2026-08','legacy_error','النظام السابق صرف عملًا إضافيًا بلا قرار معتمد؛ يُسترد بقرار مستقل');
  // مدخل تغيّر بعد المقارنة: المقارنة ما عادت تصف الشهر، فتُسمّى قديمة حتى تُعاد — والتفسير السابق يبقى لأرقامه نفسها.
  w.absence('employee','2026-08-12');
  ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.deepEqual(ready.months.map(m=>[m.month,m.state]),[['2026-06','clean'],['2026-07','clean'],['2026-08','stale']]);
  assert.deepEqual(monthOf('2026-08').comparison.changed.map(c=>c.key),['absences']);
  act('hr',parallel.compareParallelMonth,{month:'2026-08'});
  assert.deepEqual(unexplained('2026-08').map(d=>[d.user_id,d.component]),[['employee','absence_deduction']]);
  explain('2026-08','legacy_error','غياب 12 أغسطس اعتُمد بعد إقفال كشف النظام السابق؛ يُخصم عنده في الشهر اللاحق');

  // (ز) الانتقال بشخصين: أول شهر تدفعه المنصة سبتمبر، وبعده لا شهر موازٍ ولا سحب لشهر دفعه النظام السابق.
  ready=parallel.cutoverReadiness(db,w.U['hr-manager']);
  assert.equal(ready.ready,true,JSON.stringify(ready.blockers));
  assert.equal(ready.first_platform_month,'2026-09');
  const cut=act('hr-manager',parallel.recordCutover,{note:'ثلاثة شهور موازية نظيفة بكل فرق مفسّر'});
  assert.equal(cut.first_platform_month,'2026-09');
  assert.equal(caught(()=>act('hr-manager',parallel.decideCutover,cut.id,'confirm',{version:1,note:'تأكيد ذاتي مرفوض'})).code,'separation_of_duties');
  act('approver-2',parallel.decideCutover,cut.id,'confirm',{version:1,note:'راجعت الشهور الثلاثة وتفسير كل فرق'});
  assert.equal(caught(()=>act('hr-manager',parallel.declareParallelMonth,{month:'2026-09',basis:'محاولة شهر موازٍ بعد الانتقال'})).code,'after_cutover');
  const juneMonth=monthOf('2026-06','approver-2');
  assert.equal(caught(()=>act('approver-2',parallel.withdrawParallelMonth,juneMonth.id,{version:juneMonth.version,note:'محاولة سحب شهر دفعه النظام السابق'})).code,'parallel_month_paid');
  assert.ok(verifyAudit(db));
});
