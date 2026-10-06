import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createService, createRequest, transition, catalog } from '../app/workflow.mjs';
import { recordServiceOutput, decideServiceOutput, serviceOutputView } from '../app/service-outputs.mjs';
import { closeWithEvidence } from '../app/request-closure.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign } from '../app/campaigns.mjs';

function fixture(t, serviceCode) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-output-integrity');
  t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = fn => transaction(db, fn);
  const version = id => db.prepare('SELECT version FROM requests WHERE id=?').get(id).version;
  tx(() => createService(db, users.admin, { code: serviceCode, name_ar: 'خدمة اختبار سلامة المخرج', name_en: serviceCode,
    department_id: 'hr', description: 'خدمة مصطنعة لفحص ارتباط التسليم بطلب الموظف وحالة السجل.',
    fields: [{ key: 'detail', label: 'التفصيل', type: 'textarea', required: true }],
    approval_policy: { steps: ['manager'], handler_role: 'hr' } }));
  const service = catalog(db, users.employee).find(s => s.code === serviceCode);
  const request = tx(() => createRequest(db, users.employee, { service_id: service.id, title: 'تجريبي: فحص تسليم الخدمة', payload: { detail: 'تفاصيل طلب مصطنع لفحص سلامة التسليم' } }));
  for (const [who, action] of [['employee','submit'], ['manager','approve'], ['hr','claim']])
    tx(() => transition(db, users[who], request.id, action, { version: version(request.id), note: 'ملاحظة اختبار مصطنعة' }));
  const record = recordId => tx(() => recordServiceOutput(db, users.hr, request.id, {
    version: version(request.id), record_id: recordId, title: 'مخرج مصطنع للتحقق', evidence: 'هذا دليل مصطنع لفحص وجود المخرج وارتباطه بالطلب وحالة اعتماده' }));
  return { db, users, tx, version, request, record };
}
const errorCode = wanted => e => e?.code === wanted;

test('لا يقرأ موظف آخر مخرجات طلب لا يملك حق الاطلاع عليه', t => {
  const f = fixture(t, 'HR-JOB-CHANGE');
  assert.throws(() => serviceOutputView(f.db, f.users.outsider, f.request.id), errorCode('not_found'));
  assert.equal(serviceOutputView(f.db, f.users.employee, f.request.id).required, true);
});

test('لا يقبل مخرج تغيير وظيفي يخص موظفًا آخر أو طلبًا آخر أو حركة ملغاة', t => {
  const f = fixture(t, 'HR-JOB-CHANGE');
  const insert = (id, user, requestId, cancelled) => f.db.prepare(`INSERT INTO employee_changes
    (id,tenant_id,user_id,change_type,from_value,to_value,effective_from,reason,request_id,created_by,created_at,cancelled_at)
    VALUES(?,'36t',?,'job_title','مصمم','مصمم أول','2026-11-01','سبب مصطنع',?,'hr','2026-10-05T06:00:00Z',?)`).run(id,user,requestId,cancelled);
  insert('other-employee', 'outsider', f.request.id, null);
  insert('no-link', 'employee', null, null);
  insert('cancelled', 'employee', f.request.id, '2026-10-05T07:00:00Z');
  for (const id of ['other-employee','no-link','cancelled']) assert.throws(() => f.record(id), errorCode('output_record_not_ready'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM service_outputs').get().n, 0);
  insert('correct-change', 'employee', f.request.id, null);
  assert.equal(f.record('correct-change').status, 'submitted');
});

test('تغيير الحساب البنكي يحتاج حساب صاحب الطلب متحققًا لا سجلًا معلقًا', t => {
  const f = fixture(t, 'HR-BANK-CHANGE');
  f.db.prepare(`INSERT INTO employee_bank_accounts(id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,effective_month,created_at)
    VALUES('pending-bank','36t','employee','بنك اختبار','SA0000000000000000000000','0000','دليل اختبار مصطنع','pending','hr','2026-10','2026-10-05T06:00:00Z')`).run();
  assert.throws(() => f.record('pending-bank'), errorCode('output_record_not_ready'));
  f.db.prepare("UPDATE employee_bank_accounts SET status='verified',decided_by='admin',decided_at='2026-10-05T07:00:00Z',decision_note='تحقق مستقل مصطنع' WHERE id='pending-bank'").run();
  assert.equal(f.record('pending-bank').status, 'submitted');
});

test('يعاد فحص مخرج السجل عند قبوله وعند الإغلاق ولا يكفي قبوله قبل إلغائه', t => {
  const f = fixture(t, 'HR-JOB-CHANGE');
  f.db.prepare(`INSERT INTO employee_changes(id,tenant_id,user_id,change_type,from_value,to_value,effective_from,reason,request_id,created_by,created_at)
    VALUES('changing-record','36t','employee','job_title','مصمم','مصمم أول','2026-11-01','سبب مصطنع',?,'hr','2026-10-05T06:00:00Z')`).run(f.request.id);
  const out = f.record('changing-record');
  f.tx(() => decideServiceOutput(f.db, f.users.employee, out.id, { version: out.version, decision: 'accept', note: 'راجعت المخرج ووافقت عليه في الاختبار' }));
  f.db.prepare("UPDATE employee_changes SET cancelled_at='2026-10-05T07:00:00Z' WHERE id='changing-record'").run();
  assert.equal(serviceOutputView(f.db, f.users.employee, f.request.id).closure_ready, false);
  assert.throws(() => f.tx(() => closeWithEvidence(f.db, f.users.hr, f.request.id, { version: f.version(f.request.id), delivered: 'وصف تسليم مصطنع لا يجوز إقفال حركة ملغاة به' })), errorCode('output_record_not_ready'));
  assert.equal(f.db.prepare('SELECT status FROM requests WHERE id=?').get(f.request.id).status, 'in_progress');
  assert.ok(verifyAudit(f.db));
});

test('طلب إقفال الحملة لا يسلم حملة ما زالت في التخطيط', t => {
  const f = fixture(t, 'DIG-CAMPAIGN-CLOSE');
  const client = f.tx(() => createClient(f.db, f.users.manager, { legal_name: 'عميل مصطنع لفحص الإقفال', trade_name: 'عميل الاختبار', sector: 'تجزئة', status: 'active' }));
  f.tx(() => clientAction(f.db, f.users.manager, client.id, 'add_member', { user_id: 'employee', role: 'مصمم' }));
  const campaign = f.tx(() => createCampaign(f.db, f.users.employee, { client_id: client.id, name: 'حملة اختبار الإقفال', objective: 'هدف مصطنع لاختبار منع تسليم حملة لم تقفل', channels: ['instagram'], targets: [{ metric: 'نقرات', target: 20, unit: 'نقرة' }], media_budget: '100.00', budget_reference: 'مرجع ميزانية مصطنع', start_date: '2026-10-01', end_date: '2026-11-01' }));
  assert.throws(() => f.record(campaign.id), errorCode('output_record_not_ready'));
});

test('مسار المغادرة لا يقبل حزمة انضمام ولا حزمة تخص موظفًا آخر', t => {
  const f = fixture(t, 'HR-EXIT-INTERVIEW');
  const insert = (id, employee, kind, status) => f.db.prepare(`INSERT INTO lifecycle_bundles
    (id,tenant_id,kind,employee_id,owner_id,effective_date,date_basis,status,opened_by,created_at,updated_at)
    VALUES(?,'36t',?,?,'hr','2026-11-01','تاريخ مصطنع مستند لطلب اختبار',?,'hr','2026-10-05T06:00:00Z','2026-10-05T06:00:00Z')`).run(id,kind,employee,status);
  insert('joining', 'employee', 'onboarding', 'open');
  insert('other-leaving', 'outsider', 'offboarding', 'open');
  for (const id of ['joining','other-leaving']) assert.throws(() => f.record(id), errorCode('output_record_not_ready'));
  insert('leaving', 'employee', 'offboarding', 'open');
  assert.equal(f.record('leaving').status, 'submitted');
});

test('تسعير الفرصة لا يقبل سجلًا أوليًا لا يحمل تسعيرًا معتمدًا', t => {
  const f = fixture(t, 'CRM-PRICING');
  f.db.prepare(`INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,created_at,updated_at)
    VALUES('unpriced','36t','creative','manager','فرصة اختبار','test-registration','تواصل مصطنع','اختبار','تجزئة','lead','2026-10-05T06:00:00Z','2026-10-05T06:00:00Z')`).run();
  assert.throws(() => f.record('unpriced'), errorCode('output_record_not_ready'));
});

test('طلب السلفة لا يغلق قبل سلفة معتمدة تخص صاحبه وتطابق المبلغ المطلوب', t => {
  const f = fixture(t, 'HR-SALARY-ADVANCE');
  f.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify({ detail: 'طلب مصطنع', amount: 1000 }), f.request.id);
  assert.equal(serviceOutputView(f.db, f.users.employee, f.request.id).required, true);
  assert.throws(() => f.tx(() => closeWithEvidence(f.db, f.users.hr, f.request.id, { version: f.version(f.request.id), delivered: 'لا تكفي الملاحظة النصية لتسجيل سلفة الموظف' })), errorCode('service_output_required'));
  f.db.prepare(`INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,created_at)
    VALUES('advance-output','36t','employee',100000,2,'2026-11','سبب مصطنع لطلب السلفة','proposed','hr','2026-10-05T06:00:00Z')`).run();
  assert.throws(() => f.record('advance-output'), errorCode('output_record_not_ready'));
  f.db.prepare("UPDATE salary_advances SET status='approved',decided_by='admin',decided_at='2026-10-05T07:00:00Z',decision_note='قرار مستقل مصطنع' WHERE id='advance-output'").run();
  f.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify({ amount: 2000 }), f.request.id);
  assert.throws(() => f.record('advance-output'), errorCode('output_record_not_ready'));
  f.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify({ amount: 1000 }), f.request.id);
  const out = f.record('advance-output');
  f.tx(() => decideServiceOutput(f.db, f.users.employee, out.id, { version: out.version, decision: 'accept', note: 'راجعت السلفة المعتمدة وخطة سدادها في الاختبار' }));
  const closed = f.tx(() => closeWithEvidence(f.db, f.users.hr, f.request.id, { version: f.version(f.request.id), delivered: 'سجلت السلفة المعتمدة وخطة سدادها دون ادعاء تحويل بنكي' }));
  assert.equal(closed.request.status, 'completed');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payroll_payments').get().n, 0);
});

test('طلب تجديد الوثيقة يحتاج وثيقة الموظف الجديدة والسارية دون ادعاء اتصال حكومي', t => {
  const f = fixture(t, 'HR-DOC-RENEWAL');
  assert.equal(serviceOutputView(f.db, f.users.employee, f.request.id).required, true);
  f.db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify({ document: 'الإقامة', expiry_date: '2029-01-01' }), f.request.id);
  const insert = (id,user,expiry,type='iqama') => f.db.prepare(`INSERT INTO employee_documents(id,tenant_id,user_id,doc_type,reference,expires_on,note,created_by,created_at)
    VALUES(?,'36t',?,?,?,?,'وثيقة مصطنعة لفحص التجديد','hr','2026-10-05T06:00:00Z')`).run(id,user,type,id,expiry);
  insert('old-doc','employee','2020-01-01');
  insert('other-doc','outsider','2030-01-01');
  assert.throws(() => f.record('old-doc'), errorCode('output_record_not_ready'));
  assert.throws(() => f.record('other-doc'), errorCode('output_record_not_ready'));
  insert('wrong-type','employee','2030-01-01','passport');
  insert('not-renewed','employee','2029-01-01');
  assert.throws(() => f.record('wrong-type'), errorCode('output_record_not_ready'));
  assert.throws(() => f.record('not-renewed'), errorCode('output_record_not_ready'));
  insert('renewed-doc','employee','2030-01-01');
  assert.equal(f.record('renewed-doc').status, 'submitted');
});
