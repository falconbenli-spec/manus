import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-billing-recurring');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // تصريح الفوترة الدورية ليس افتراضيًا لأي دور: يُمنح صراحة، والأدمن الأول يحمله بحكم امتيازه.
  for(const target of ['manager','hr'])tx(()=>grantAccess(db,users.admin,{user_id:target,capability:'billing.recurring.manage',department_id:'',note:'اختبار الفوترة الدورية'}));
  const client=tx(()=>createClient(db,users.manager,{legal_name:'عميل تجريبي للفوترة الدورية',trade_name:'تجريبي',sector:'تجريبي',status:'active',notes:''}));
  const schedule=input=>tx(()=>billing.createSchedule(db,users.admin,{client_id:client.id,case_id:'',title:'اشتراك إدارة قنوات — تجريبي',cadence:'monthly',issue_day:1,start_date:'2026-01-01',end_date:'',contract_reference:'بند 4-2 من العقد التجريبي',owner_id:'admin',lines:[{description:'إدارة قنوات شهرية',amount:'10000.00'}],...input}));
  const agreement=()=>tx(()=>billing.createAgreement(db,users.admin,{client_id:client.id,name:'اشتراك ساعات تجريبي',basis:'hours',contract_reference:'بند 6-1 من العقد التجريبي',owner_id:'manager'}));
  return {db,users,tx,client,schedule,agreement};
}

test('a recurring schedule prepares a draft for the period and never an issued invoice, and rerunning it changes nothing',t=>{
  const {db,users,tx,schedule}=fixture(t);
  const s=schedule();
  const first=billing.runDueSchedules(db,'2026-03-05');
  assert.equal(first.length,3,'january, february and march are due');
  assert.deepEqual([...new Set(first.map(r=>r.outcome))],['draft']);
  assert.equal(billing.runDueSchedules(db,'2026-03-05').length,0,'the same period is never generated twice');
  assert.equal(billing.runDueSchedules(db,'2026-03-05').length,0,'repeatable without any extra effect');
  const drafts=db.prepare('SELECT * FROM billing_drafts WHERE schedule_id=? ORDER BY period_start').all(s.id);
  assert.equal(drafts.length,3);
  assert.deepEqual([...new Set(drafts.map(d=>d.status))],['pending_review'],'automation prepares; a person issues');
  assert.deepEqual(drafts.map(d=>d.period_start),['2026-01-01','2026-02-01','2026-03-01']);
  assert.deepEqual(drafts.map(d=>d.period_end),['2026-01-31','2026-02-28','2026-03-31']);
  assert.equal(drafts[0].total_minor,1000000);
  // مسودة لا يمكن أن تدّعي إصدارًا: لا حالة صادرة بلا فاتورة حقيقية أصدرها شخص.
  assert.throws(()=>db.prepare("UPDATE billing_drafts SET status='issued',version=version+1 WHERE id=?").run(drafts[0].id));
  assert.throws(()=>db.prepare("UPDATE billing_drafts SET status='issued',issued_invoice_id='no-such-invoice',decided_by='admin',decided_at='x',version=version+1 WHERE id=?").run(drafts[0].id));
  assert.throws(()=>tx(()=>billing.draftAction(db,users.admin,drafts[0].id,'mark_issued',{version:drafts[0].version,invoice_id:'no-such-invoice',note:''})),code('invoice_not_issued'));
  tx(()=>billing.draftAction(db,users.admin,drafts[0].id,'dismiss_draft',{version:drafts[0].version,invoice_id:'',note:'تُفوتر يدويًا هذه الفترة بعد تعديل النطاق'}));
  assert.equal(db.prepare('SELECT status FROM billing_drafts WHERE id=?').get(drafts[0].id).status,'dismissed');
  assert.throws(()=>tx(()=>billing.draftAction(db,users.admin,drafts[0].id,'dismiss_draft',{version:drafts[0].version+1,invoice_id:'',note:'محاولة ثانية على مسودة محسومة'})),code('not_found'));
  // الجدولة الموقوفة لا تولّد شيئًا، والاستئناف لا يفقد الفترات الفائتة.
  const row=db.prepare('SELECT * FROM billing_schedules WHERE id=?').get(s.id);
  tx(()=>billing.scheduleAction(db,users.admin,s.id,'pause_schedule',{version:row.version,reason:'بانتظار تأكيد العميل'}));
  assert.equal(billing.runDueSchedules(db,'2026-05-05').length,0);
  tx(()=>billing.scheduleAction(db,users.admin,s.id,'resume_schedule',{version:row.version+1,reason:''}));
  assert.equal(billing.runDueSchedules(db,'2026-05-05').length,2,'april and may catch up once the schedule is active again');
  assert.ok(verifyAudit(db));
});

test('an advance is a liability whose receipt a second person confirms, and drawn amounts never exceed the paid balance',t=>{
  const {db,users,tx,client}=fixture(t);
  const advance=tx(()=>billing.recordAdvance(db,users.admin,{client_id:client.id,schedule_id:'',description:'دفعة مقدمة على اشتراك تجريبي',agreement_reference:'بند 7-3 من العقد التجريبي',amount:'10000.00'}));
  const recorded=db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(advance.id);
  assert.equal(recorded.status,'recorded');assert.equal(recorded.paid_minor,0,'nothing is treated as received before someone confirms it');
  assert.throws(()=>tx(()=>billing.confirmAdvance(db,users.admin,advance.id,{version:recorded.version,amount:'10000.00',received_on:'2026-02-01',evidence:'مطابقة الحساب التجريبي'})),code('self_approval'));
  assert.throws(()=>db.prepare("UPDATE advance_invoices SET status='paid',paid_minor=1000000,received_on='2026-02-01',confirmed_by=recorded_by,confirmed_at='x',version=version+1 WHERE id=?").run(advance.id),'the database refuses self-confirmation too');
  // مرجع الحوالة شرط التأكيد منذ الترحيل 160: الحوالة الواحدة لا تُؤكَّد مرتين.
  tx(()=>billing.confirmAdvance(db,users.manager,advance.id,{version:recorded.version,amount:'6000.00',received_on:'2026-02-01',evidence:'مطابقة الحساب التجريبي رقم 9',reference:'TRF-BILLING-9'}));
  const paid=db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(advance.id);
  assert.equal(paid.status,'paid');assert.equal(paid.paid_minor,600000);
  const first=tx(()=>billing.planDraw(db,users.admin,advance.id,{target_reference:'فاتورة مارس التجريبية',amount:'4000.00'}));
  assert.equal(first.status,'ready','a paid advance is drawable at once');
  const firstRow=db.prepare('SELECT * FROM advance_draws WHERE id=?').get(first.id);
  tx(()=>billing.applyDraw(db,users.admin,first.id,{version:firstRow.version,amount:'4000.00',note:''}));
  assert.equal(db.prepare('SELECT status FROM advance_draws WHERE id=?').get(first.id).status,'drawn');
  const second=tx(()=>billing.planDraw(db,users.admin,advance.id,{target_reference:'فاتورة أبريل التجريبية',amount:'3000.00'}));
  const secondRow=db.prepare('SELECT * FROM advance_draws WHERE id=?').get(second.id);
  assert.throws(()=>tx(()=>billing.applyDraw(db,users.admin,second.id,{version:secondRow.version,amount:'3000.00',note:''})),code('draw_exceeds_paid'));
  // القاعدة نفسها مفروضة في SQL لا في الكود وحده.
  assert.throws(()=>db.prepare("UPDATE advance_draws SET applied_minor=300000,status='drawn',version=version+1 WHERE id=?").run(second.id),/exceeds the paid advance balance/);
  tx(()=>billing.applyDraw(db,users.admin,second.id,{version:secondRow.version,amount:'2000.00',note:'ما تبقى من الرصيد'}));
  assert.equal(db.prepare('SELECT status FROM advance_draws WHERE id=?').get(second.id).status,'partial');
  assert.throws(()=>tx(()=>billing.planDraw(db,users.admin,advance.id,{target_reference:'فاتورة مايو التجريبية',amount:'4000.00'})),code('draw_exceeds_advance'));
  const asOfMarch=billing.deferredRevenue(db,users.admin,'2026-03-01');
  assert.equal(asOfMarch.total_minor,600000,'as of a date before any draw was recorded, the whole receipt is still a liability');
  const sheet=billing.deferredRevenue(db,users.admin);
  assert.equal(sheet.total_minor,0,'six thousand received minus six thousand drawn leaves nothing deferred');
  assert.equal(sheet.rows[0].received_minor,600000);assert.equal(sheet.rows[0].drawn_minor,600000);
  assert.equal(sheet.recognition,'manual');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE 'ledger%'").get().n,0,'no automatic recognition entry is ever written');
  assert.ok(verifyAudit(db));
});

test('carry-forward and overage deduction are independent contract options that move entitlement only, never the invoice amount',t=>{
  const {db,users,tx,schedule,agreement}=fixture(t);
  const s=schedule();
  billing.runDueSchedules(db,'2026-03-05');
  const billedBefore=db.prepare('SELECT total_minor FROM billing_drafts WHERE schedule_id=? ORDER BY period_start').all(s.id).map(d=>d.total_minor);
  const a=agreement();
  const row=()=>db.prepare('SELECT * FROM retainer_agreements WHERE id=?').get(a.id);
  assert.throws(()=>tx(()=>billing.setCarryRules(db,users.admin,a.id,{version:row().version,carry_unused:true,deduct_overage:true,note:'لست صاحب العقد'})),code('not_owner'));
  tx(()=>billing.setCarryRules(db,users.manager,a.id,{version:row().version,carry_unused:false,deduct_overage:true,note:'العقد يخصم الزائد ولا يرحّل غير المستهلك'}));
  // خمسون ساعة ميزانية واستهلاك ستون: يُخصم عشر ساعات من الفترة التالية لأن خيار الخصم مفعّل.
  const january=tx(()=>billing.openPeriod(db,users.admin,{agreement_id:a.id,period_month:'2026-01',budget:'50'}));
  tx(()=>billing.recordConsumption(db,users.admin,january.id,{amount:'60',reference:'ساعات يناير التجريبية'}));
  const open=()=>db.prepare('SELECT * FROM retainer_periods WHERE id=?').get(january.id);
  assert.throws(()=>tx(()=>billing.closePeriod(db,users.admin,january.id,{version:open().version,note:'لست صاحب العقد'})),code('not_owner'));
  assert.throws(()=>tx(()=>billing.closePeriod(db,users.manager,january.id,{version:open().version+5,note:'نسخة قديمة من الفترة'})),code('stale_version'));
  const closed=tx(()=>billing.closePeriod(db,users.manager,january.id,{version:open().version,note:'تجاوز عشر ساعات يُخصم من فبراير'}));
  assert.equal(closed.carried_out_units,-600,'ten hours are carried out as a deduction');
  const february=tx(()=>billing.openPeriod(db,users.admin,{agreement_id:a.id,period_month:'2026-02',budget:'50'}));
  assert.equal(february.carried_in_units,-600,'february starts ten hours short');
  assert.equal(db.prepare('SELECT budget_units+carried_in_units AS n FROM retainer_periods WHERE id=?').get(february.id).n,2400);
  // الفترة المقفلة لا تُعدل، والاستهلاك لا يُسجل فيها.
  assert.throws(()=>db.prepare('UPDATE retainer_periods SET consumed_units=0,version=version+1 WHERE id=?').run(january.id),/closed period/);
  assert.throws(()=>db.prepare("INSERT INTO retainer_consumption VALUES('x',?,60,'محاولة متأخرة','admin','2026-02-10')").run(january.id),/open period/);
  // الخيار الآخر مستقل: بلا ترحيل، غير المستهلك يسقط ولا يُضاف للفترة التالية.
  tx(()=>billing.recordConsumption(db,users.admin,february.id,{amount:'10',reference:'ساعات فبراير التجريبية'}));
  const februaryRow=db.prepare('SELECT * FROM retainer_periods WHERE id=?').get(february.id);
  assert.equal(tx(()=>billing.closePeriod(db,users.manager,february.id,{version:februaryRow.version,note:'لا ترحيل لغير المستهلك بحسب العقد'})).carried_out_units,0);
  tx(()=>billing.setCarryRules(db,users.manager,a.id,{version:row().version,carry_unused:true,deduct_overage:true,note:'ملحق العقد فعّل ترحيل غير المستهلك'}));
  const march=tx(()=>billing.openPeriod(db,users.admin,{agreement_id:a.id,period_month:'2026-03',budget:'50'}));
  assert.equal(march.carried_in_units,0);
  tx(()=>billing.recordConsumption(db,users.admin,march.id,{amount:'10',reference:'ساعات مارس التجريبية'}));
  const marchRow=db.prepare('SELECT * FROM retainer_periods WHERE id=?').get(march.id);
  assert.equal(tx(()=>billing.closePeriod(db,users.manager,march.id,{version:marchRow.version,note:'يُرحَّل غير المستهلك'})).carried_out_units,2400);
  // ولا شيء من هذا يمس الفوترة: مبلغ الجدولة ومسوداتها كما كان.
  assert.equal(db.prepare('SELECT total_minor FROM billing_schedules WHERE id=?').get(s.id).total_minor,1000000);
  assert.deepEqual(db.prepare('SELECT total_minor FROM billing_drafts WHERE schedule_id=? ORDER BY period_start').all(s.id).map(d=>d.total_minor),billedBefore);
  assert.ok(verifyAudit(db));
});

test('usage thresholds are configuration set by the contract owner, and each threshold alerts once per period',t=>{
  const {db,users,tx,agreement}=fixture(t);
  const a=agreement();
  const period=tx(()=>billing.openPeriod(db,users.admin,{agreement_id:a.id,period_month:'2026-04',budget:'100'}));
  tx(()=>billing.recordConsumption(db,users.admin,period.id,{amount:'60',reference:'قبل ضبط أي عتبة'}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM retainer_alerts WHERE period_id=?').get(period.id).n,0,'no threshold is hardcoded, so nothing fires');
  assert.throws(()=>tx(()=>billing.setThreshold(db,users.admin,a.id,{threshold_percent:'50',recipients:['admin']})),code('not_owner'));
  for(const threshold of ['50','75','90'])tx(()=>billing.setThreshold(db,users.manager,a.id,{threshold_percent:threshold,recipients:['admin','hr']}));
  assert.deepEqual(db.prepare('SELECT threshold_bp FROM retainer_alert_rules WHERE agreement_id=? ORDER BY threshold_bp').all(a.id).map(r=>r.threshold_bp),[5000,7500,9000]);
  const next=tx(()=>billing.openPeriod(db,users.admin,{agreement_id:a.id,period_month:'2026-05',budget:'100'}));
  assert.deepEqual(tx(()=>billing.recordConsumption(db,users.admin,next.id,{amount:'60',reference:'ستون ساعة'})).alerts,[5000]);
  assert.deepEqual(tx(()=>billing.recordConsumption(db,users.admin,next.id,{amount:'5',reference:'خمس ساعات إضافية'})).alerts,[],'the same threshold never alerts twice');
  assert.deepEqual(tx(()=>billing.recordConsumption(db,users.admin,next.id,{amount:'15',reference:'خمس عشرة ساعة'})).alerts,[7500]);
  assert.deepEqual(db.prepare('SELECT threshold_bp FROM retainer_alerts WHERE period_id=? ORDER BY threshold_bp').all(next.id).map(r=>r.threshold_bp),[5000,7500]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT recipients FROM retainer_alerts WHERE period_id=? AND threshold_bp=5000').get(next.id).recipients),['admin','hr']);
  tx(()=>billing.setThreshold(db,users.manager,a.id,{threshold_percent:'90',recipients:[]}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM retainer_alert_rules WHERE agreement_id=?').get(a.id).n,2,'an empty recipient list removes the threshold');
  assert.ok(verifyAudit(db));
});

test('recurring billing is closed to accounts without the capability and never reaches another tenant',t=>{
  const {db,users,tx,client,schedule}=fixture(t);
  schedule();
  for(const call of [()=>billing.schedulesBoard(db,users.employee),()=>billing.retainersBoard(db,users.employee),()=>billing.deferredRevenue(db,users.employee,'2026-03-01')])assert.throws(call,code('not_permitted'));
  assert.throws(()=>tx(()=>billing.recordAdvance(db,users.employee,{client_id:client.id,schedule_id:'',description:'محاولة بلا تصريح',agreement_reference:'بند تجريبي 1',amount:'100.00'})),code('not_permitted'));
  assert.throws(()=>tx(()=>billing.createSchedule(db,users.admin,{client_id:client.id,case_id:'',title:'جدولة بمالك بلا تصريح',cadence:'monthly',issue_day:1,start_date:'2026-01-01',end_date:'',contract_reference:'بند تجريبي 2',owner_id:'employee',lines:[{description:'بند',amount:'10.00'}]})),code('owner_not_permitted'));
  // كيان آخر: بياناته موجودة في الجدول نفسه ولا تظهر في لوحة هذا الكيان.
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('other-client','isolated','C-9001','عميل الكيان المعزول','','تجريبي','active','external','','2026-01-01','2026-01-01')").run();
  db.prepare("INSERT INTO billing_schedules(id,tenant_id,client_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('other-schedule','isolated','other-client','جدولة الكيان المعزول','monthly',1,'[{\"description\":\"بند\",\"amount_minor\":100}]','SAR',100,'بند تجريبي معزول','2026-01-01','active','external','external','2026-01-01','2026-01-01')").run();
  const board=billing.schedulesBoard(db,users.admin);
  assert.equal(board.schedules.filter(s=>s.tenant_id!=='36t').length,0);
  assert.equal(board.clients.filter(c=>c.id==='other-client').length,0);
  assert.throws(()=>tx(()=>billing.scheduleAction(db,users.admin,'other-schedule','pause_schedule',{version:1,reason:'محاولة عبر الكيانات'})),code('not_found'));
  assert.equal(billing.retainersBoard(db,users.admin).agreements.length,0);
  // تشغيل المؤقّت يمس كل كيان بصلاحية مالكه هو: مالك جدولة الكيان المعزول لا يحمل التصريح فتتوقف بسبب مسجل.
  billing.runDueSchedules(db,'2026-03-05');
  assert.equal(db.prepare("SELECT status FROM billing_schedules WHERE id='other-schedule'").get().status,'paused');
  assert.match(db.prepare("SELECT detail FROM billing_schedule_runs WHERE schedule_id='other-schedule'").get().detail,/تصريح/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM billing_drafts WHERE tenant_id='isolated'").get().n,0);
  assert.ok(verifyAudit(db));
});
