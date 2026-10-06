// عكس المسير المعتمد وتحويله وملف أجوره (الحزمة 4، P4-HR-4، الترحيل 175). العالم التجريبي نفسه (tests/hr-cycle-fixture.mjs)
// ودفاتر تجريبية فوقه (tests/payroll-books.mjs). كل اسم ومبلغ ومرجع هنا مصطنع.
//   (1) D6: العكس قبل التحويل المنفذ وقبل الرفع الموثّق — رفضٌ باسمه في الكود، وفي القاعدة نفسها عند الطلب وعند الاعتماد.
//   (2) يطلبه واحد ويقرره غيره، مرة؛ والمرفوض يُبقي المسير معتمدًا ويُبلَّغ طالبه، ويُطلب من جديد.
//   (3) ما بُني على صرف المسير (أثر رجعي، ردّ خصم إجازة) يمنع عكسه حتى يُرفض.
//   (4) القاعدة تُبقي المنعكس نهائيًا وتحويله بعيدًا، ومن اعتمد التحويل لا يسجّل تنفيذه ولو بكتابة مباشرة.
//   (5) قيد العكس ينتظر ترحيل قيد المسير ثم يعكسه بحرفه، والتتبّع يصل منه إلى العكس، وطابور الاستثناءات يرى العكس المنتظر.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyAudit, now } from '../app/db.mjs';
import { getRun } from '../app/payroll.mjs';
import { traceAmount } from '../app/ledger.mjs';
import { financeExceptions } from '../app/finance-exceptions.mjs';
import { recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, payrollPaymentAction, extrasBoard } from '../app/payroll-extras.mjs';
import { recordFileFormat, decideFileFormat, prepareWageFile, recordManualUpload } from '../app/wage-protection.mjs';
import { retroCandidates, proposeRetro } from '../app/payroll-retro.mjs';
import { addDocument } from '../app/employees.mjs';
import { riyadhToday } from '../app/riyadh-time.mjs';
import { hrCycle, caught } from './hr-cycle-fixture.mjs';
import { iban } from './wage-fixture.mjs';
import { payrollBooks, linesOf } from './payroll-books.mjs';

function world(t){
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  for(const [who,bban] of [['employee','80000000000000000021'],['outsider','80000000000000000039']]){
    const {id}=w.tx(()=>recordEmployeeBank(db,w.U.hr,{user_id:who,bank_name:'بنك تجريبي',iban:iban(bban),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم صاحب الحساب'}));
    w.tx(()=>decideEmployeeBank(db,w.U['hr-manager'],id,'verify',{note:'طابقت الخطاب البنكي التجريبي مع الاسم'}));
  }
  const payment=(id,who='hr-manager')=>extrasBoard(db,w.U[who]).payments.find(p=>p.id===id);
  const transfer=run=>w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:run.id})).id;
  const approveTransfer=id=>w.tx(()=>payrollPaymentAction(db,w.U['hr-manager'],id,'approve_payment',{version:payment(id).version,note:'طابقت الإجمالي مع المسير المعتمد'}));
  const execute=id=>w.tx(()=>payrollPaymentAction(db,w.U.reviewer,id,'record_payment_execution',{version:payment(id,'reviewer').version,executed_on:riyadhToday(),bank_reference:`syn-${id.slice(0,6)}`,evidence:'إشعار تحويل تجريبي من بنك الشركة'}));
  const request=(run,who='hr',reason='خطأ تجريبي في احتساب سطر قبل صرف المسير')=>w.run(who,w.view(who,run),'request_run_reversal',{reason});
  const ruling=(run,who,action,note='قرار تجريبي مكتوب على العكس')=>w.run(who,w.view(who,run),action,{note});
  return Object.assign(w,{books,payment,transfer,approveTransfer,execute,request,ruling});
}

test('D6: a run is reversed only before its transfer is executed and before its wage file is recorded as uploaded — refused by name, and by the database at request and at approval',t=>{
  const w=world(t),{db}=w;
  // (أ) تحويل منفّذ.
  const june=w.approveMonth('2026-06'),paid=w.transfer(june);
  w.books.postRun(june.id);w.approveTransfer(paid);w.execute(paid);
  assert.equal(w.view('hr',june).actions.includes('request_run_reversal'),false,'the request is not offered');
  assert.deepEqual(w.view('hr',june).reversal_blockers.map(b=>b.code),['run_paid']);
  const refused=caught(()=>w.request(june));
  assert.equal(refused.code,'run_paid');
  assert.match(refused.details.refusal.what,/منفّذ في البنك/);
  assert.throws(()=>db.prepare("INSERT INTO payroll_run_reversals(id,tenant_id,run_id,month,net_minor,reason,status,requested_by,requested_at) VALUES(?,'36t',?,?,?,'عكس مكتوب في القاعدة مباشرة','requested','hr',?)").run(randomUUID(),june.id,june.month,june.net_minor,now()),/before any transfer/);
  // (ب) رفعٌ موثّق بلا تنفيذ.
  const column=(position,name,source,type,extra={})=>({position,name,source,type,length:null,required:true,value:'',pad:'right',pad_char:'space',...extra});
  const formatId=w.tx(()=>recordFileFormat(db,w.U.hr,{bank_name:'بنك تجريبي',format_label:'صيغة تجريبية v1',layout:'delimited',delimiter:',',encoding:'utf-8',line_ending:'crlf',include_header:true,
    columns:[column(1,'EMP_ID','employee_id','text'),column(2,'NET','net_amount','amount')],spec_source:'قرأتها من شاشة مواصفة الملف في حساب المنشأة التجريبي',spec_confirmed_on:'2026-06-01'})).id;
  w.tx(()=>decideFileFormat(db,w.U['hr-manager'],formatId,'confirm',{version:1,note:'طابقت المواصفة مع حساب المنشأة التجريبي'}));
  for(const who of ['employee','outsider'])w.tx(()=>addDocument(db,w.U.hr,who,{doc_type:'national_id',reference:'آخر 4 أرقام 1234',issued_on:'2020-01-01',expires_on:'2030-12-31',note:'وثيقة تجريبية'}));
  const july=w.approveMonth('2026-07'),pending=w.transfer(july);
  w.books.postRun(july.id);w.approveTransfer(pending);
  const exportId=w.tx(()=>prepareWageFile(db,w.U.hr,{run_id:july.id})).id;
  w.tx(()=>recordManualUpload(db,w.U.reviewer,exportId,{version:1,uploaded_on:riyadhToday(),reference:'REF-SYN-UP',note:'رفعته يدويًا في بوابة المنشأة التجريبية'}));
  assert.equal(caught(()=>w.request(july)).code,'run_uploaded');
  // (ج) ما يقع بين الطلب والاعتماد: تحويلٌ نُفّذ بعد الطلب يمنع الاعتماد، والرفض يبقى متاحًا.
  const august=w.approveMonth('2026-08'),late=w.transfer(august);
  w.books.postRun(august.id);w.approveTransfer(late);
  let run=w.request(august);
  assert.ok(w.view('approver-2',run).actions.includes('approve_run_reversal'));
  w.execute(late);
  assert.deepEqual(w.view('approver-2',run).actions.filter(a=>a.endsWith('run_reversal')),['reject_run_reversal'],'only the rejection is offered once the money left');
  assert.equal(caught(()=>w.ruling(run,'approver-2','approve_run_reversal')).code,'run_paid');
  const x=db.prepare("SELECT * FROM payroll_run_reversals WHERE run_id=? AND status='requested'").get(august.id);
  assert.throws(()=>db.prepare("UPDATE payroll_run_reversals SET status='approved',decided_by='approver-2',decided_at=?,decision_note='اعتماد مكتوب في القاعدة مباشرة',reversed_on=?,version=version+1 WHERE id=?").run(now(),riyadhToday(),x.id),/before any transfer/);
  run=w.ruling(run,'approver-2','reject_run_reversal','نُفّذ التحويل فيتعالج الفرق بأثر رجعي');
  assert.deepEqual([run.status,run.reversal.status],['approved','rejected']);
  assert.ok(verifyAudit(db));
});

test('a reversal is requested with a reason, decided once by a payroll approver other than its requester, and a rejection leaves the run approved and tells the requester',t=>{
  const w=world(t),{db}=w;
  let june=w.approveMonth('2026-06');
  assert.equal(caught(()=>w.run('hr',w.view('hr',june),'request_run_reversal',{reason:'قصير'})).code,'invalid_text');
  june=w.request(june,'hr');
  assert.deepEqual(w.view('hr',june).actions.filter(a=>a.endsWith('run_reversal')),[],'the requester holds preparation only and decides nothing');
  assert.equal(caught(()=>w.request(june,'hr-manager')).code,'action_unavailable','one live reversal per run');
  assert.throws(()=>db.prepare("INSERT INTO payroll_run_reversals(id,tenant_id,run_id,month,net_minor,reason,status,requested_by,requested_at) VALUES(?,'36t',?,?,?,'طلب ثانٍ مكتوب في القاعدة','requested','hr-manager',?)").run(randomUUID(),june.id,june.month,june.net_minor,now()),/UNIQUE/);
  june=w.ruling(june,'hr-manager','reject_run_reversal','المسير صحيح بعد المراجعة الثانية التجريبية');
  assert.deepEqual([june.status,june.reversal.status,june.reversal.decided_by_name],['approved','rejected',w.U['hr-manager'].name]);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='hr' AND kind='payroll_reversal_rejected' AND subject_kind='payroll_run' AND subject_id=?").get(june.id),'the requester is told');
  const rejected=db.prepare("SELECT * FROM payroll_run_reversals WHERE run_id=? AND status='rejected'").get(june.id);
  assert.throws(()=>db.prepare("UPDATE payroll_run_reversals SET status='approved',reversed_on=?,version=version+1 WHERE id=?").run(riyadhToday(),rejected.id),/decided once/);
  assert.throws(()=>db.prepare('DELETE FROM payroll_run_reversals WHERE id=?').run(rejected.id),/retained/);
  assert.throws(()=>db.prepare("UPDATE payroll_run_reversals SET reason='سبب آخر مكتوب بعد القرار' ,version=version+1 WHERE id=?").run(rejected.id),/decided once/);
  // يُطلب من جديد بعد الرفض، ويعتمده معتمد غير طالبه.
  june=w.request(june,'hr-manager','تبيّن خطأ ثانٍ في سطر الموظفة بعد الرفض الأول');
  assert.equal(caught(()=>w.ruling(june,'hr-manager','approve_run_reversal')).code,'self_approval');
  assert.throws(()=>db.prepare("UPDATE payroll_run_reversals SET status='approved',decided_by=requested_by,decided_at=?,decision_note='اعتماد ذاتي مكتوب في القاعدة',reversed_on=?,version=version+1 WHERE run_id=? AND status='requested'").run(now(),riyadhToday(),june.id),/CHECK/);
  june=w.ruling(june,'approver-2','approve_run_reversal','راجعت السطر وتأكدت أن التحويل ما انعدّ');
  assert.equal(june.status,'reversed');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='hr-manager' AND kind='payroll_reversal_approved'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='payroll_run_reversed' AND body LIKE '%ريال%'").get().n,0,'no amount travels in a notice');
  assert.ok(verifyAudit(db));
});

test('what was built on a run is decided before the run is reversed: a retro movement from its lines blocks the request until it is rejected',t=>{
  const w=world(t),{db}=w;
  const june=w.approveMonth('2026-06');
  w.absence('employee','2026-06-17');
  const candidate=retroCandidates(db,w.U.hr).candidates.find(c=>c.user_id==='employee'&&c.source_month==='2026-06');
  const retro=w.tx(()=>proposeRetro(db,w.U.hr,{user_id:'employee',source_month:'2026-06',target_month:'2026-07',expected_difference:candidate.difference_minor,note:'غياب يونيو اعتُمد بعد المسير'}));
  assert.deepEqual(w.view('hr',june).reversal_blockers.map(b=>b.code),['retro_from_run']);
  assert.equal(caught(()=>w.request(june)).code,'retro_from_run');
  w.decide(retro.adjustment_id,'reject');
  assert.equal(w.request(june).reversal.status,'requested','the request opens once the movement built on the run is rejected');
});

test('the database keeps a reversed run final and its transfers out of reach, and whoever approved a transfer never records its execution',t=>{
  const w=world(t),{db}=w;
  const june=w.approveMonth('2026-06'),pending=w.transfer(june);
  w.books.postRun(june.id);w.approveTransfer(pending);
  // من اعتمد التحويل لا يسجّل تنفيذه — كان في الكود وحده.
  assert.throws(()=>db.prepare("UPDATE payroll_payments SET status='executed',executed_on=?,bank_reference='SYN-SELF',execution_evidence='تنفيذ مكتوب في القاعدة مباشرة',execution_recorded_by=approved_by,version=version+1 WHERE id=?").run(riyadhToday(),pending),/does not record its execution/);
  let run=w.ruling(w.request(june),'approver-2','approve_run_reversal','تأكدت أن ملف التحويل ما انصرف في البنك');
  assert.equal(db.prepare('SELECT status FROM payroll_payments WHERE id=?').get(pending).status,'cancelled');
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='payroll_payment.cancelled_by_reversal'").get(pending));
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET status='approved',version=version+1 WHERE id=?").run(june.id),/locked/,'a reversed run is final');
  assert.throws(()=>db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES(?,'36t',?,?,2,'x','pending','hr',?,?)").run(randomUUID(),june.id,june.net_minor,now(),now()),/not reversed/);
  assert.equal(caught(()=>w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id}))).code,'not_found');
  assert.deepEqual(run.actions.filter(a=>a.includes('reversal')),[]);
  assert.ok(verifyAudit(db));
});

test('the reversal journal waits for the run journal to be posted, then reverses it line by line on its date; the trace and the finance exceptions see it',t=>{
  const w=world(t),{db}=w;
  w.decide(w.propose({user_id:'outsider',kind:'deduction',month:'2026-06',amount:'250.00',deduction_basis:'court_order',deduction_reference:'حكم تجريبي رقم 7'}));
  let june=w.approveMonth('2026-06');
  june=w.request(june,'hr-manager');
  assert.deepEqual(financeExceptions(db,w.books.approver).filter(x=>x.source_kind==='payroll_run_reversal').map(x=>[x.kind,x.owner_role,x.inbox]),[['reversal_awaiting_approval','payroll.approve',false]],
    'finance sees a payroll month about to be reversed; the decision stays in the payroll approver inbox');
  june=w.ruling(june,'approver-2','approve_run_reversal','تأكدت أن ملف التحويل ما انعدّ');
  const reversalId=june.reversal.id;
  const unposted=caught(()=>w.books.journal('payroll_run_reversal',reversalId,'2026-06'));
  assert.equal(unposted.code,'run_journal_unposted');
  assert.equal(unposted.details.refusal.missing[0].owner_role,'finance');
  const original=w.books.postRun(june.id);
  const mirror=w.books.post(w.books.journal('payroll_run_reversal',reversalId,'2026-06'));
  assert.deepEqual(linesOf(db,mirror.id),linesOf(db,original.id).map(([a,c,d,cr])=>[a,c,cr,d]));
  assert.ok(linesOf(db,original.id).some(([code])=>code==='2130'),'the court order line is reversed with the rest');
  const trace=traceAmount(db,w.books.approver,{kind:'payroll_run',id:june.id});
  const step=trace.chain.find(s=>s.step==='reversal');
  assert.equal(step.state,'linked');
  assert.deepEqual(step.items.map(i=>[i.kind,i.journal?.status]),[['payroll_run_reversal','posted']]);
  const back=traceAmount(db,w.books.approver,{kind:'payroll_run_reversal',id:reversalId});
  assert.deepEqual(back.chain.find(s=>s.step==='approvals').items.map(a=>a.actor_id),['hr-manager','approver-2']);
  assert.ok(verifyAudit(db));
});
