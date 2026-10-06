// حدّ اليوم بين الرياض وUTC (app/riyadh-time.mjs): المساعد نفسه عند الحواف، ثم سيناريو لكل وحدة صُحِّحت والساعة مثبتة
// 23:05 UTC من آخر يوم في شهر — أي 02:05 بتوقيت الرياض من أول الشهر التالي، وهي اللحظة التي قيس فيها العطب في 1 أكتوبر 2026.
// كل سيناريو هنا كان يسقط على الكود قبل التصحيح (الأرقام في docs/testing/p3-riyadh-time-20261001.txt)، ويمرّ بعده.
// وفي آخر الملف الحارس: عدّ الأنماط الخطرة في كل ملف مقابل scripts/riyadh-time-baseline.json، والعدّ ينزل فقط.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { RIYADH_OFFSET_MS, riyadhToday, riyadhMonth, riyadhDateOf, riyadhDayRange, riyadhMonthRange, riyadhYearRange } from '../app/riyadh-time.mjs';
import { pinClock } from './riyadh-clock.mjs';
import { aiBoard, setAiSettings } from '../app/ai.mjs';
import { financeCapabilities } from '../app/finance.mjs';
import { financeGrantsBoard, grantFinanceAction } from '../app/finance-grants.mjs';
import { addQualification } from '../app/career-profile.mjs';
import { catalogAdmin } from '../app/catalog-admin.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { fixture as einvoiceFixture } from './einvoice-fixture.mjs';
import { fixture as wageFixture } from './wage-fixture.mjs';
import { payrollBooks } from './payroll-books.mjs';
import { extrasBoard, preparePayrollPayment, payrollPaymentAction } from '../app/payroll-extras.mjs';
import { recordFileFormat, decideFileFormat, prepareWageFile, recordManualUpload } from '../app/wage-protection.mjs';
import { submitClaim, claimAction } from '../app/expenses.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';
import { preparePayment, paymentAction, getOrder } from '../app/payables.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { prepareStage, stageAction, createOpportunity, opportunityAction, pipelineBoard, addLossReason } from '../app/pipeline-estimates.mjs';
import { createCycle, cycleAction, performanceBoard, reviewAction } from '../app/talent.mjs';
import * as wf from '../app/workflow.mjs';
import { duplicateCandidates } from '../app/request-intake.mjs';
import { oneToOnesBoard, scheduleOneToOne, meetingAction } from '../app/feedback.mjs';
import { buildEpmoBody } from '../app/epmo-report.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { fixture as definitionsFixture, LEAD_SOURCE } from './definitions-fixture.mjs';
import { PATTERNS, measureSource, measure, compare, loadBaseline, describe as describeRise } from '../scripts/riyadh-time-guard.mjs';

const code=value=>error=>error.code===value;
// آخر يوم في سبتمبر 2026، 23:05 UTC = 02:05 بتوقيت الرياض من 1 أكتوبر.
const GAP='2026-09-30T23:05:00.000Z';
// 00:30 بتوقيت الرياض من 1 أكتوبر = 21:30 UTC من 30 سبتمبر: أول نصف ساعة من يوم الرياض، وما زال UTC في اليوم السابق.
const HALF_PAST_MIDNIGHT='2026-09-30T21:30:00.000Z';
function base(t,label){
  const db=openDb(':memory:');seed(db,label);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  return {db,users,tx};
}

/* ───── المساعد عند الحواف ───── */

test('riyadhToday and riyadhMonth read the Riyadh calendar at the edges: 20:59Z, 21:00Z, 23:59Z, 00:00Z, month end and year end',()=>{
  assert.equal(RIYADH_OFFSET_MS,3*3600000);
  const cases=[
    ['2026-09-30T20:59:59.999Z','2026-09-30'],// 23:59:59.999 الرياض — آخر لحظة في اليوم
    ['2026-09-30T21:00:00.000Z','2026-10-01'],// 00:00 الرياض — أول لحظة في أكتوبر، وUTC ما زال في سبتمبر
    ['2026-09-30T23:05:00.000Z','2026-10-01'],// اللحظة التي قيس فيها العطب
    ['2026-09-30T23:59:59.999Z','2026-10-01'],
    ['2026-10-01T00:00:00.000Z','2026-10-01'],// 03:00 الرياض — التقويمان اتفقا من جديد
    ['2026-02-28T21:00:00.000Z','2026-03-01'],// نهاية فبراير في سنة بسيطة
    ['2028-02-28T21:00:00.000Z','2028-02-29'],// وفي سنة كبيسة
    ['2026-12-31T20:59:59.999Z','2026-12-31'],
    ['2026-12-31T21:00:00.000Z','2027-01-01'],// نهاية السنة
  ];
  for(const [at,day] of cases){
    assert.equal(riyadhToday(at),day,at);assert.equal(riyadhToday(Date.parse(at)),day,at);assert.equal(riyadhToday(new Date(at)),day,at);
    assert.equal(riyadhMonth(at),day.slice(0,7),at);assert.equal(riyadhDateOf(at),day,at);
  }
  assert.throws(()=>riyadhToday('ليس تاريخًا'),TypeError);
});

test('the default clock is Date: riyadhToday() and riyadhMonth() follow a pinned clock on both sides of midnight UTC',t=>{
  pinClock(t,'2026-09-30T20:59:59.999Z');assert.equal(riyadhToday(),'2026-09-30');assert.equal(riyadhMonth(),'2026-09');
  t.mock.timers.setTime(Date.parse('2026-09-30T21:00:00.000Z'));assert.equal(riyadhToday(),'2026-10-01');assert.equal(riyadhMonth(),'2026-10');
  t.mock.timers.setTime(Date.parse(GAP));assert.equal(riyadhToday(),'2026-10-01');
  t.mock.timers.setTime(Date.parse('2026-12-31T21:30:00.000Z'));assert.equal(riyadhToday(),'2027-01-01');assert.equal(riyadhMonth(),'2027-01');
});

test('riyadhDateOf passes a bare date through, and returns null for nothing or an unreadable value',()=>{
  assert.equal(riyadhDateOf('2026-10-01'),'2026-10-01');
  assert.equal(riyadhDateOf(null),null);assert.equal(riyadhDateOf(undefined),null);assert.equal(riyadhDateOf(''),null);assert.equal(riyadhDateOf('غير مقروء'),null);
});

test('the ranges are half-open UTC instants: a Riyadh day, month and year start at 21:00Z of the day before',()=>{
  assert.deepEqual(riyadhDayRange('2026-10-01'),['2026-09-30T21:00:00.000Z','2026-10-01T21:00:00.000Z']);
  assert.deepEqual(riyadhDayRange('2027-01-01'),['2026-12-31T21:00:00.000Z','2027-01-01T21:00:00.000Z']);
  assert.deepEqual(riyadhMonthRange('2026-10'),['2026-09-30T21:00:00.000Z','2026-10-31T21:00:00.000Z']);
  assert.deepEqual(riyadhMonthRange('2026-02'),['2026-01-31T21:00:00.000Z','2026-02-28T21:00:00.000Z']);
  assert.deepEqual(riyadhMonthRange('2026-12'),['2026-11-30T21:00:00.000Z','2026-12-31T21:00:00.000Z']);
  assert.deepEqual(riyadhYearRange('2027'),['2026-12-31T21:00:00.000Z','2027-12-31T21:00:00.000Z']);
  assert.deepEqual(riyadhYearRange(2027),riyadhYearRange('2027'));
  // الطابع يقع في يوم الرياض الذي يقع مداه عليه، والنهاية خارج المدى.
  const [from,to]=riyadhDayRange('2026-10-01'),inside=at=>at>=from&&at<to;
  assert.equal(inside('2026-09-30T20:59:59.999Z'),false);assert.equal(inside('2026-09-30T21:00:00.000Z'),true);
  assert.equal(inside(GAP),true);assert.equal(inside('2026-10-01T20:59:59.999Z'),true);assert.equal(inside('2026-10-01T21:00:00.000Z'),false);
  for(const bad of ['2026-02-30','2026-13-01','2026/10/01','',null])assert.throws(()=>riyadhDayRange(bad),TypeError,String(bad));
  for(const bad of ['2026-13','2026-1','2026-10-01',null])assert.throws(()=>riyadhMonthRange(bad),TypeError,String(bad));
  assert.throws(()=>riyadhYearRange('26'),TypeError);
});

/* ───── سيناريو لكل وحدة صُحِّحت، والساعة 23:05 UTC من آخر يوم في الشهر ───── */

// app/ai.mjs: تكلفة الشهر وعدد تشغيلات اليوم تُقرأ بلحظتَي بداية شهر الرياض ويومه. كانت التكلفة صفرًا في الفجوة.
test('ai: at 02:05 Riyadh on the 1st the month cost and the runs of the day count what happened since Riyadh midnight, not since UTC midnight',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-ai');
  tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'1',input_price_per_mtok:'100000',output_price_per_mtok:'200000',disabled_assistants:[],reason:'تسعير مصطنع لاختبار حدّ الشهر'}));
  const run=(at,cost)=>db.prepare("INSERT INTO ai_runs(id,tenant_id,assistant_key,instructions_version,provider,model,user_id,sources,input_digest,input_chars,output,cost_minor,status,created_at) VALUES(?,'36t','brief_gaps',1,'synthetic','synthetic','employee','[]','digest',10,'مسودة',?,'completed',?)").run(randomUUID(),cost,at);
  run('2026-09-30T20:59:59.999Z',100);// 23:59 الرياض من 30 سبتمبر — شهر سبتمبر
  run('2026-09-30T21:00:00.000Z',200);// 00:00 الرياض من 1 أكتوبر — شهر أكتوبر ويومه
  run('2026-09-30T23:00:00.000Z',50);// 02:00 الرياض من 1 أكتوبر
  assert.equal(aiBoard(db,users.admin).admin.month_cost_minor,250,'أكتوبر بتوقيت الرياض بدأ الساعة 21:00 UTC');
  assert.equal(aiBoard(db,users.employee).runs_today,2,'يوم الرياض بدأ الساعة 21:00 UTC');
  t.mock.timers.setTime(Date.parse('2026-09-30T20:30:00.000Z'));
  assert.equal(aiBoard(db,users.admin).admin.month_cost_minor,350,'ما زال سبتمبر في الرياض، والتشغيلات كلها بعد بداية سبتمبر');
});

// app/finance-grants.mjs: يوما التفويض يوما رياض. كان يبدأ الساعة 03:00 بتوقيت الرياض ويبقى ساريًا ثلاث ساعات بعد يومه الأخير.
test('finance grants: a grant from the 1st to the 31st is live from Riyadh midnight of the 1st and ends at Riyadh midnight after the 31st',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-grants');
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'finance.grants.manage',department_id:null,note:'تصريح مصطنع لاختبار حدّ اليوم'}));
  const {id}=tx(()=>grantFinanceAction(db,users.manager,{user_id:'employee',action:'read',valid_from:'2026-10-01',valid_until:'2026-10-31',evidence:'قرار تفويض مصطنع لاختبار حدّ اليوم'}));
  const row={...db.prepare('SELECT valid_from,valid_until FROM finance_grants WHERE id=?').get(id)};
  assert.deepEqual(row,{valid_from:'2026-09-30T21:00:00.000Z',valid_until:'2026-10-31T20:59:59.999Z'});
  assert.deepEqual(financeCapabilities(db,users.employee),['read'],'02:05 الرياض من 1 أكتوبر داخل التفويض');
  const view=financeGrantsBoard(db,users.manager).grants.find(g=>g.id===id);
  assert.equal(view.state,'live');assert.equal(view.valid_from,'2026-10-01');assert.equal(view.valid_until,'2026-10-31');
  t.mock.timers.setTime(Date.parse('2026-10-31T20:59:00.000Z'));
  assert.deepEqual(financeCapabilities(db,users.employee),['read'],'23:59 الرياض من 31 أكتوبر ما زال داخل التفويض');
  t.mock.timers.setTime(Date.parse('2026-10-31T21:30:00.000Z'));
  assert.deepEqual(financeCapabilities(db,users.employee),[],'00:30 الرياض من 1 نوفمبر خارج التفويض');
  assert.equal(financeGrantsBoard(db,users.manager).grants.find(g=>g.id===id).state,'expired');
});

// app/invoices.mjs: سنة رقم الفاتورة سنة الرياض يوم إصدارها.
test('invoices: a tax invoice issued at 02:05 Riyadh on 1 January carries the new year in its number',t=>{
  pinClock(t,'2026-12-31T23:05:00.000Z');
  const f=einvoiceFixture(t);
  const doc=f.issue(f.claimFor(0,'100.00'));
  assert.equal(doc.status,'issued');
  assert.match(doc.number,/^INV-2027-\d{6}$/,'الإصدار الساعة 02:05 من 1 يناير 2027 بتوقيت الرياض');
});

// app/career-profile.mjs: سنة المؤهل لا تتجاوز سنة الرياض الجارية.
test('career profile: at 02:05 Riyadh on 1 January a qualification obtained this year is accepted',t=>{
  pinClock(t,'2026-12-31T23:05:00.000Z');
  const {db,users,tx}=base(t,'synthetic-riyadh-career');
  const add=year=>tx(()=>addQualification(db,users.employee,{kind:'degree',title:`مؤهل مصطنع ${year}`,field:'تصميم',institution:'جامعة مصطنعة',year,evidence_reference:'ملف الموظف'}));
  assert.ok(add(2027).id,'سنة الرياض 2027');
  assert.throws(()=>add(2028),code('year'));
});

// app/catalog-admin.mjs: يوم لوح الدليل (ومواسمه) يوم الرياض لا يوم UTC.
test('catalog admin: the board day that seasons are read on is the Riyadh day',t=>{
  pinClock(t,GAP);
  const {db,users}=base(t,'synthetic-riyadh-catalog');installServiceCatalog(db);
  assert.equal(catalogAdmin(db,users.admin).seasons.today,'2026-10-01');
});

// app/payroll-extras.mjs: تاريخ تنفيذ صرف الرواتب لا يسبق يوم الرياض الذي اعتُمد فيه الصرف.
test('payroll payment: approved at 00:30 Riyadh on the 1st, it cannot be recorded as executed on the last day of the previous month',t=>{
  pinClock(t,HALF_PAST_MIDNIGHT);
  const {db,users,tx,contract,bank,approveRun}=wageFixture(t,'synthetic-riyadh-payroll-payment');
  contract('employee');bank('employee','80000000000000000021');
  const run=approveRun('2026-09');
  const paymentId=tx(()=>preparePayrollPayment(db,users.hr,{run_id:run.id})).id;
  const act=(who,action,values={})=>tx(()=>payrollPaymentAction(db,users[who],paymentId,action,{version:extrasBoard(db,users[who]).payments.find(p=>p.id===paymentId).version,...values}));
  // الحزمة 4 (P4-HR-3، D5): التحويل لا يُعتمد قبل ترحيل قيد مسيره.
  payrollBooks(db).postRun(run.id);
  act('hr-manager','approve_payment',{note:'طابقت الإجمالي مع المسير المعتمد'});
  assert.equal(db.prepare('SELECT approved_at FROM payroll_payments WHERE id=?').get(paymentId).approved_at,HALF_PAST_MIDNIGHT);
  const execution=executed_on=>({executed_on,bank_reference:'PAY-RIYADH-1',evidence:'إشعار تنفيذ تجريبي من بنك الشركة'});
  assert.throws(()=>act('reviewer','record_payment_execution',execution('2026-09-30')),code('executed_on'),'الاعتماد يوم 1 أكتوبر بتوقيت الرياض');
  assert.equal(act('reviewer','record_payment_execution',execution('2026-10-01')).status,'executed');
});

// app/wage-protection.mjs: تاريخ رفع ملف حماية الأجور لا يسبق يوم الرياض الذي صُدِّر فيه الملف.
test('wage protection: a file exported at 00:30 Riyadh on the 1st cannot be recorded as uploaded on the last day of the previous month',t=>{
  pinClock(t,HALF_PAST_MIDNIGHT);
  const {db,users,tx,contract,bank,document,approveRun,approvedTransfer}=wageFixture(t,'synthetic-riyadh-wps');
  contract('employee');bank('employee','80000000000000000021');document('employee');
  const run=approveRun('2026-09');
  const column=(position,name,source,type,extra={})=>({position,name,source,type,length:null,required:true,value:'',pad:'right',pad_char:'space',...extra});
  const formatId=tx(()=>recordFileFormat(db,users.hr,{bank_name:'بنك تجريبي',format_label:'صيغة تجريبية v1',layout:'delimited',delimiter:',',encoding:'utf-8',line_ending:'crlf',include_header:true,
    columns:[column(1,'EST_NO','constant','text',{value:'EST-TEST-1'}),column(2,'IBAN','iban','text',{length:24}),column(3,'EMP_NAME','employee_name','text'),column(4,'NET','net_amount','amount'),column(5,'MONTH','month','month')],
    spec_source:'قرأتها من شاشة مواصفة الملف في حساب المنشأة التجريبي',spec_confirmed_on:'2026-09-01'})).id;
  tx(()=>decideFileFormat(db,users['hr-manager'],formatId,'confirm',{version:1,note:'طابقت المواصفة مع حساب المنشأة التجريبي'}));
  // الحزمة 4 (D7، الترحيل 175): النسخة تُصدَّر من التحويل المعتمد بمجموعه.
  approvedTransfer(run);
  const exportId=tx(()=>prepareWageFile(db,users.hr,{run_id:run.id})).id;
  const upload=uploaded_on=>({version:1,uploaded_on,reference:'REF-RIYADH-1',note:'رفعته يدويًا في بوابة المنشأة التجريبية واستلمت إشعارًا'});
  assert.throws(()=>tx(()=>recordManualUpload(db,users.reviewer,exportId,upload('2026-09-30'))),code('uploaded_on'),'التصدير يوم 1 أكتوبر بتوقيت الرياض');
  assert.equal(tx(()=>recordManualUpload(db,users.reviewer,exportId,upload('2026-10-01'))).uploaded_on,'2026-10-01');
});

// app/expenses.mjs: تاريخ تعويض المطالبة لا يسبق يوم الرياض الذي اعتمدتها فيه المالية.
test('expenses: a claim approved by finance at 02:05 Riyadh on the 1st cannot be reimbursed on the last day of the previous month',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-expenses');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee',NULL)");
  const treasurer=db.prepare("SELECT * FROM users WHERE id='treasurer'").get();
  for(const action of ['read','configure','approve','post'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','treasurer','employee',action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,GAP);
  const id=tx(()=>submitClaim(db,users.employee,{expense_date:'2026-09-30',category:'transport',description:'أجرة نقل معدات إلى موقع التصوير المصطنع',amount:'230.00',receipt_reference:'rcpt-riyadh'})).id;
  const act=(who,action,values={})=>tx(()=>claimAction(db,who,id,action,{version:db.prepare('SELECT version FROM expense_claims WHERE id=?').get(id).version,...values}));
  act(users.manager,'manager_approve',{note:'مصروف ميداني فعلي'});
  act(treasurer,'finance_approve',{note:'طابقت الإيصال والمبلغ'});
  assert.throws(()=>act(treasurer,'record_reimbursement',{reimbursed_on:'2026-09-30',reference:'TRX-RIYADH'}),code('reimbursed_on'),'الاعتماد المالي يوم 1 أكتوبر بتوقيت الرياض');
  assert.equal(act(treasurer,'record_reimbursement',{reimbursed_on:'2026-10-01',reference:'TRX-RIYADH'}).status,'reimbursed');
});

// app/payables.mjs: تاريخ تنفيذ أمر الدفع لا يسبق يوم الرياض الذي اعتُمد فيه الأمر.
test('payables: a payment order approved at 02:05 Riyadh on the 1st cannot be recorded as executed on the last day of the previous month',t=>{
  pinClock(t,GAP);
  const m=ledgerMonth(t,{seedName:'synthetic-riyadh-payables'});
  const {payable}=m.matchedPayable();
  const order=getOrder(m.db,m.users.employee,m.tx(()=>preparePayment(m.db,m.users.employee,{payable_id:payable.id})).id);
  m.tx(()=>paymentAction(m.db,m.users.manager,order.id,'approve_order',{version:order.version,note:'اعتماد أمر دفع مصطنع بعد المطابقة'}));
  const execute=executed_on=>m.tx(()=>paymentAction(m.db,m.users.treasurer,order.id,'record_execution',{version:order.version+1,executed_on,bank_reference:'BNK-RIYADH-1',evidence:'إشعار تحويل بنكي مصطنع محفوظ'}));
  assert.throws(()=>execute('2026-09-30'),code('executed_on'),'اعتماد الأمر يوم 1 أكتوبر بتوقيت الرياض');
  execute('2026-10-01');
  assert.equal(m.db.prepare('SELECT executed_on FROM payment_orders WHERE id=?').get(order.id).executed_on,'2026-10-01');
});

// app/pipeline-estimates.mjs: تاريخ نشاط الفرصة لا يسبق يوم الرياض الذي أُنشئت فيه.
test('pipeline: an opportunity created at 02:05 Riyadh on the 1st takes no activity dated the last day of the previous month',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-pipeline');
  tx(()=>{for(const [user,capability] of [['employee','commercial.use'],['employee','clients.manage'],['manager','commercial.use']])grantAccess(db,users.admin,{user_id:user,capability,department_id:capability==='commercial.use'?'creative':'',note:'منح تجريبي'});});
  const client=tx(()=>createClient(db,users.employee,{legal_name:'شركة تجريبية للتجزئة',sector:'التجزئة',status:'prospect'})).id;
  tx(()=>clientAction(db,users.employee,client,'add_member',{user_id:'manager',role:'مدير الفريق التجريبي'}));
  const stageId=tx(()=>prepareStage(db,users.employee,{code:'LEAD',name:'فرصة أولية',sort_order:1,win_probability:'10',probability_basis:'متوسط تجربة الشركة التجريبية في آخر سنة',confirmed_on:'2026-10-01',required_fields:[],idle_days:7})).id;
  tx(()=>stageAction(db,users.manager,stageId,'approve_stage',{version:db.prepare('SELECT version FROM pipeline_stages WHERE id=?').get(stageId).version,note:'اعتماد تجريبي'}));
  const id=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',name:'فرصة تجريبية لحملة إطلاق',service_family:'campaigns',value:'100000.00',expected_close_on:'',decision_maker:'',budget_note:'',next_step:'',next_step_on:''})).id;
  const activity=activity_date=>tx(()=>opportunityAction(db,users.employee,id,'activity',{version:db.prepare('SELECT version FROM opportunities WHERE id=?').get(id).version,activity_date,kind:'call',note:'اتصال تجريبي مع العميل'}));
  assert.throws(()=>activity('2026-09-30'),code('activity_date'),'الفرصة أُنشئت يوم 1 أكتوبر بتوقيت الرياض');
  activity('2026-10-01');
  assert.equal(db.prepare('SELECT last_activity_on FROM opportunities WHERE id=?').get(id).last_activity_on,'2026-10-01');
});

// app/talent.mjs: مهلة التظلم أربعة عشر يومًا من يوم الرياض الذي صدرت فيه النتائج.
test('talent: results released at 02:05 Riyadh on the 1st can be appealed through the 15th, Riyadh time',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-talent');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const hrManager=db.prepare("SELECT * FROM users WHERE id='hr-manager'").get();
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.performance.calibrate',note:'تصريح معايرة مصطنع'}));
  const cycle=()=>performanceBoard(db,users.hr).cycles[0];
  const review=(viewer,userId)=>performanceBoard(db,viewer).cycles[0].reviews.find(r=>r.user_id===userId);
  const act=(who,userId,action,values={})=>tx(()=>reviewAction(db,who,review(who,userId).id,action,{version:review(who,userId).version,...values}));
  tx(()=>createCycle(db,users.hr,{name:'تقييم 2026 المصطنع',period_from:'2026-01-01',period_to:'2026-12-31',scale_max:5,criteria:[{name:'جودة التسليم',weight:50},{name:'التعاون',weight:30},{name:'التطور المهني',weight:20}]}));
  tx(()=>cycleAction(db,users.hr,cycle().id,'open',{version:cycle().version}));
  act(users.employee,'employee','submit_self',{self_text:'أنجزت ثلاث حملات رئيسية وطورت مهاراتي في التحليل خلال السنة المصطنعة.'});
  act(users.manager,'employee','submit_manager',{scores:[{key:'c1',score:4,evidence:'سلّم ثلاث حملات في موعدها بلا إعادة عمل'},{key:'c2',score:3,evidence:'تعاون جيد مع فريق الحسابات في مشروعين'},{key:'c3',score:5,evidence:'أكمل شهادة مهنية وطبقها في العمل'}],summary:'أداء قوي في التسليم مع حاجة لتوسيع التعاون بين الفرق'});
  for(const other of cycle().reviews.filter(r=>r.user_id!=='employee'&&['self','manager'].includes(r.status)))act(users.hr,other.user_id,'exclude_review',{note:'خارج نطاق هذا الاختبار المصطنع طوال الفترة'});
  tx(()=>cycleAction(db,users.hr,cycle().id,'to_calibration',{version:cycle().version}));
  act(hrManager,'employee','calibrate',{final_score:'3.90',note:'تأكيد درجة المدير بعد مراجعة الأدلة'});
  tx(()=>cycleAction(db,hrManager,cycle().id,'release',{version:cycle().version}));
  assert.equal(db.prepare('SELECT released_at FROM review_cycles WHERE id=?').get(cycle().id).released_at,GAP);
  t.mock.timers.setTime(Date.parse('2026-10-15T20:30:00.000Z'));// 23:30 الرياض من 15 أكتوبر: اليوم الرابع عشر بعد 1 أكتوبر
  assert.ok(review(users.employee,'employee').actions.includes('appeal'),'التظلم متاح إلى آخر 15 أكتوبر بتوقيت الرياض');
  t.mock.timers.setTime(Date.parse('2026-10-15T21:30:00.000Z'));// 00:30 الرياض من 16 أكتوبر
  assert.equal(review(users.employee,'employee').actions.includes('appeal'),false,'وانتهت المهلة بعد منتصف ليل الرياض');
});

// app/request-intake.mjs: نافذة الطلب المكرر تبدأ منتصف ليل الرياض قبل أربعة عشر يومًا، لا الساعة 03:00 بتوقيت الرياض.
test('request intake: a request made at 00:30 Riyadh fourteen days before today is still inside the duplicate window at 02:05 Riyadh',t=>{
  pinClock(t,'2026-09-16T21:30:00.000Z');// 00:30 الرياض من 17 سبتمبر
  const {db,users,tx}=base(t,'synthetic-riyadh-intake');installServiceCatalog(db);
  const draft=()=>{const service=wf.catalog(db,users.employee).find(s=>s.code==='ADM-MAINTENANCE');
    return tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'طلب تجريبي',payload:{category:'تكييف',location:'الدور الثاني',description:'تسريب تجريبي',urgency:'عادي'},project_id:null}));};
  const first=draft();tx(()=>wf.transition(db,users.employee,first.id,'submit',{version:first.version}));
  t.mock.timers.setTime(Date.parse(GAP));// 02:05 الرياض من 1 أكتوبر: 17 سبتمبر أول يوم في النافذة
  const second=draft();
  assert.deepEqual(duplicateCandidates(db,users.employee,second.id).map(r=>r.id),[first.id]);
});

// app/feedback.mjs: آخر لقاء فردي ويوم انعقاده بتوقيت الرياض.
test('feedback: a one-to-one held at 02:05 Riyadh on the 1st is dated the 1st and held zero days ago',t=>{
  pinClock(t,GAP);
  const {db,users,tx}=base(t,'synthetic-riyadh-feedback');
  const meetingId=tx(()=>scheduleOneToOne(db,users.manager,{counterpart_id:'employee',scheduled_on:'2026-10-01'})).id;
  const version=db.prepare('SELECT version FROM one_to_ones WHERE id=?').get(meetingId).version;
  tx(()=>meetingAction(db,users.manager,meetingId,'record_held',{version,shared_notes:'اتفقنا على مراجعة خطة التعلم بعد شهر وتوزيع مهام الحملة'}));
  const row=oneToOnesBoard(db,users.hr).cadence.rows.find(r=>r.employee_name===users.employee.name);
  assert.equal(row.last_held_on,'2026-10-01');assert.equal(row.days_since_last,0);
});

// app/epmo-report.mjs: «طلبات مفتوحة حتى نهاية الفترة» تنتهي بنهاية يوم الرياض الأخير في الفترة.
test('epmo report: a request opened at 00:30 Riyadh on the 1st is not open at the end of the previous month',t=>{
  pinClock(t,'2026-09-30T20:30:00.000Z');// 23:30 الرياض من 30 سبتمبر
  const {db,users,tx}=base(t,'synthetic-riyadh-epmo');installServiceCatalog(db);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'epmo.review',department_id:'',note:'تصريح اختبار تقرير EPMO'}));
  const open=()=>{const service=wf.catalog(db,users.employee).find(s=>s.code==='ADM-MAINTENANCE');
    const r=tx(()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'طلب تجريبي',payload:{category:'تكييف',location:'الدور الثاني',description:'تسريب تجريبي',urgency:'عادي'},project_id:null}));
    tx(()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version}));};
  open();
  t.mock.timers.setTime(Date.parse(HALF_PAST_MIDNIGHT));// 21:30 UTC = 00:30 الرياض من 1 أكتوبر
  open();
  const figure=period=>buildEpmoBody(db,users.manager,period).sections.flatMap(s=>(s.groups??[]).flatMap(g=>g.figures??[])).find(f=>f.label==='طلبات خدمة مفتوحة حتى نهاية الفترة');
  assert.equal(figure({from:'2026-09-01',to:'2026-09-30'}).value,1,'الطلب الثاني فُتح في أكتوبر بتوقيت الرياض');
  assert.equal(figure({from:'2026-10-01',to:'2026-10-31'}).value,2);
});

// app/billing-recurring.mjs: ورقة الإيراد المؤجل «حتى تاريخ» يوم رياض كامل.
test('deferred revenue: a reversal and a draw recorded at 00:30 Riyadh on the 1st are not in the sheet as of the last day of the previous month',t=>{
  pinClock(t,'2026-09-30T20:00:00.000Z');// 23:00 الرياض من 30 سبتمبر
  const {db,users,tx}=base(t,'synthetic-riyadh-billing');
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'billing.recurring.manage',department_id:'',note:'اختبار الفوترة الدورية'}));
  const client=tx(()=>createClient(db,users.manager,{legal_name:'عميل تجريبي للفوترة الدورية',trade_name:'تجريبي',sector:'تجريبي',status:'active',notes:''}));
  const advance=tx(()=>billing.recordAdvance(db,users.admin,{client_id:client.id,schedule_id:'',description:'دفعة مقدمة على اشتراك تجريبي',agreement_reference:'بند 7-3 من العقد التجريبي',amount:'6000.00'}));
  const version=()=>db.prepare('SELECT version FROM advance_invoices WHERE id=?').get(advance.id).version;
  tx(()=>billing.confirmAdvance(db,users.manager,advance.id,{version:version(),amount:'6000.00',received_on:'2026-09-30',evidence:'مطابقة الحساب التجريبي رقم 9',reference:'TRF-RIYADH-9'}));
  t.mock.timers.setTime(Date.parse(HALF_PAST_MIDNIGHT));// 00:30 الرياض من 1 أكتوبر
  const planned=tx(()=>billing.planDraw(db,users.admin,advance.id,{target_reference:'فاتورة أكتوبر التجريبية',amount:'1000.00'}));
  tx(()=>billing.applyDraw(db,users.admin,planned.id,{version:db.prepare('SELECT version FROM advance_draws WHERE id=?').get(planned.id).version,amount:'1000.00',note:''}));
  tx(()=>billing.reverseAdvance(db,users.manager,advance.id,{amount:'500.00',reason:'ارتدت الحوالة من بنك العميل المصطنع',evidence:'إشعار ارتداد بنكي مصطنع محفوظ'}));
  const september=billing.deferredRevenue(db,users.admin,'2026-09-30'),october=billing.deferredRevenue(db,users.admin,'2026-10-01');
  assert.deepEqual([september.rows[0].received_minor,september.rows[0].drawn_minor,september.total_minor],[600000,0,600000],'آخر سبتمبر بتوقيت الرياض: قبل السحب والارتداد');
  assert.deepEqual([october.rows[0].received_minor,october.rows[0].drawn_minor,october.total_minor],[550000,100000,450000]);
});

// app/custom-fields.mjs: الحقل المنشور بعد يوم إقفال الفرصة بتوقيت الرياض «أُضيف بعد الإقفال».
test('custom fields: a field published at 02:05 Riyadh on the 1st is added after an opportunity closed on the last day of the previous month',t=>{
  pinClock(t,'2026-09-30T20:00:00.000Z');// 23:00 الرياض من 30 سبتمبر
  const {db,users,tx,opportunity,row,publish}=definitionsFixture(t,{quotation:false});
  publish('opportunity',{fields:[LEAD_SOURCE]});
  const act=(action,input)=>tx(()=>opportunityAction(db,users.employee,opportunity,action,{version:row('opportunities',opportunity).version,...input}));
  act('edit',{name:'فرصة تجريبية لحملة إطلاق',service_family:'campaigns',value:'100000.00',expected_close_on:'',decision_maker:'مدير تسويق تجريبي',budget_note:'',next_step:'',next_step_on:''});
  act('move',{stage_code:'PROPOSED',note:''});
  // منذ P4-CRM-2 (الترحيل 181) ما تنقفل الفرصة رابحة إلا باتفاقٍ موثّق على صفقتها؛ وموضوع هذا الاختبار يوم الإقفال لا نوعه،
  // فتُقفل خاسرةً بسببٍ من القائمة.
  const reason=tx(()=>addLossReason(db,users.employee,{code:'TIMING',name:'توقيت ما يناسب العميل التجريبي'})).id;
  act('lose',{loss_reason_id:reason,comment:'العميل التجريبي أجّل الحملة للربع الجاي'});
  assert.equal(row('opportunities',opportunity).closed_on,'2026-09-30');
  t.mock.timers.setTime(Date.parse(GAP));
  publish('opportunity',{fields:[LEAD_SOURCE,{key:'renewal_note',label:{ar:'ملاحظة التجديد'},type:'text',required:false}]});
  const item=pipelineBoard(db,users.employee).opportunities.find(o=>o.id===opportunity).custom.find(i=>i.key==='renewal_note');
  assert.equal(item.reason,'أُضيف الحقل بعد إقفال السجل');
});

/* ───── الحارس: لا سطر جديد يقرأ طابع UTC كأنه يوم رياض ───── */

// الأسطر الخطرة كما كانت في الكود قبل التصحيح تُعدّ، وبدائلها لا تُعدّ.
test('guard patterns count the lines that broke on 1 October and not their corrected forms',()=>{
  const counted=(key,source)=>measureSource(source)[key];
  // app/ai.mjs قبل التصحيح: بداية الشهر نصًّا مقابل طابع UTC.
  assert.equal(counted('riyadh_text_bound',"const monthCost=(db,tenantId)=>db.prepare('SELECT COALESCE(SUM(cost_minor),0) AS n FROM ai_runs WHERE tenant_id=? AND created_at>=?').get(tenantId,today().slice(0,7)+'-01').n;"),1);
  assert.equal(counted('riyadh_text_bound',"const monthCost=(db,tenantId)=>db.prepare('SELECT COALESCE(SUM(cost_minor),0) AS n FROM ai_runs WHERE tenant_id=? AND created_at>=?').get(tenantId,riyadhMonthRange(riyadhMonth())[0]).n;"),0);
  assert.equal(counted('riyadh_text_bound',"db.prepare('SELECT COUNT(*) AS n FROM ai_runs WHERE user_id=? AND created_at>=?').get(u.id,riyadhDayRange(today())[0]).n;"),0);
  assert.equal(counted('riyadh_text_bound',"db.prepare('SELECT 1 FROM x WHERE created_at>=?').get(new Date(Date.parse(since+'T00:00:00+03:00')).toISOString());"),0,'an explicit +03:00 conversion is an instant');
  assert.equal(counted('riyadh_text_bound',"db.prepare('SELECT 1 FROM x WHERE created_at>=?').get(previous.created_at);"),0,'a timestamp against a timestamp is fine');
  assert.equal(counted('utc_slice',"if(executed>riyadhToday()||executed<o.approved_at.slice(0,10))fail();"),1);
  assert.equal(counted('utc_slice',"`آخرها ${String(mine.last_at).slice(0,10)}`"),1);
  assert.equal(counted('utc_slice',"if(executed<riyadhDateOf(o.approved_at))fail();"),0);
  assert.equal(counted('utc_substr',"AND substr(created_at,1,10)<=?"),1);
  assert.equal(counted('utc_substr',"AND date(created_at,'+3 hours')<=?"),0);
  assert.equal(counted('utc_today',"const today=now().slice(0,10);"),1);
  assert.equal(counted('utc_today',"input.year>new Date().getUTCFullYear()"),1);
  assert.equal(counted('utc_today',"const today=riyadhToday();"),0);
  assert.equal(counted('utc_midnight',"const startOf=date=>`${date}T00:00:00.000Z`;"),1);
  assert.equal(counted('utc_midnight',"const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);"),0,'date arithmetic at UTC midnight is not an instant');
  for(const key of Object.keys(PATTERNS))assert.ok(PATTERNS[key].name&&PATTERNS[key].fix,key);
});

test('guard: no file reads a UTC timestamp as a Riyadh day more often than scripts/riyadh-time-baseline.json allows, and a new file starts at zero',()=>{
  const {regressions}=compare(loadBaseline(),measure());
  assert.deepEqual(regressions.map(describeRise),[]);
  // ومقارنةٌ نقية: ملف جديد بنمط واحد تراجعٌ، وملف نزل عدّه تحسّن لا يُفشل.
  const fresh=compare({utc_slice:{'app/a.mjs':2}},{utc_slice:{'app/a.mjs':1,'app/b.mjs':1}});
  assert.deepEqual(fresh.regressions.map(r=>[r.file,r.from,r.to,r.fresh]),[['app/b.mjs',0,1,true]]);
  assert.deepEqual(fresh.improvements.map(r=>[r.file,r.from,r.to]),[['app/a.mjs',2,1]]);
});
