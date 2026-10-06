// P4-CRM-6 — سلسلة التجديد (الترحيل 185): فرصة التجديد تُفتح من العقد السابق قبل نهايته وتحمل نطاقه وبنوده وأسعاره، وصفقتها
// تسمّي الصفقة السابقة، وعقد التجديد يسمّي العقد السابق مرة واحدة، وقرار «التجديد» تتابعه فرصة، وتاريخ النهاية يفتح تذكيرًا يصل
// من عليه الفعل مرة لكل دورة، والفوترة الدورية على عقد لا تتجاوز مدته. بيانات تجريبية مصطنعة بالكامل (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import * as register from '../app/contracts-register.mjs';
import * as renewals from '../app/client-renewals.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import * as commercial from '../app/commercial.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { annotateCatalog } from '../app/module-routes.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import { createApp } from '../app/server.mjs';
import { sessionsFor, dispatch } from './definitions-fixture.mjs';
import { crmWorld, code, caught, riyadh, QUOTE } from './crm-fixture.mjs';

// صفقة متعاقد عليها من فرصة، وسجل عقد لها في سجل العقود بنهايته. hr يسجّل، ومسؤول الحساب يملك العقد ويقرّ سريانه.
function world(t, { endIn = 40, autoRenew = false } = {}) {
  const w = crmWorld(t), { db, users, tx } = w;
  const opp = w.opportunity();
  const deal = w.openCase(opp).id;
  w.contract(deal);
  tx(() => grantAccess(db, users.admin, { user_id: 'hr', capability: 'contracts.register.manage', note: 'منح تجريبي لسجل العقود' }));
  const contract = registerContract(w, { case_id: deal, end_date: riyadh(endIn), ...(autoRenew ? { auto_renew: true, notice_days: 30 } : {}) });
  return { ...w, opp, deal, contractId: contract };
}
function registerContract(w, extra = {}) {
  const { db, users, tx } = w;
  const id = tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'أمر عمل حملة إطلاق تجريبية',
    start_date: riyadh(-200), end_date: riyadh(40), value: '80000.00', auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف العقود التجريبي — ملف التجديد', signed_on: riyadh(-201), ...extra })).id;
  tx(() => register.contractAction(db, users.outsider, id, 'activate_contract', { version: db.prepare('SELECT version FROM contract_records WHERE id=?').get(id).version, note: 'أقرّ بملكية العقد التجريبي ومطابقته للأصل' }));
  return id;
}
const settings = (w, days = 60) => w.tx(() => register.setAlertSettings(w.db, w.users.hr, { expiry_lead_days: days, notice_lead_days: 15, obligation_lead_days: 7, basis: 'مهل تجريبية أقرّها مالك سجل العقود للاختبار' }));

test('P4-CRM-6: the renewal opportunity opens from the contract before it ends, carries its scope and prices, and its deal names the predecessor', t => {
  const w = world(t), { db, users, tx, deal, contractId: contract } = w;
  const listed = renewals.renewalsFor(db, users.employee).contracts.find(c => c.id === contract);
  assert.deepEqual(listed.actions, ['open_renewal']);
  assert.deepEqual(listed.basis.lines.map(l => [l.description, l.quantity, l.unit_price_minor]), QUOTE().lines.map(l => [l.description, l.quantity, String(Math.round(Number(l.unit_price) * 100))]));
  const { id } = tx(() => renewals.openRenewal(db, users.employee, contract, { stage_code: 'LEAD' }));
  const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
  assert.deepEqual([o.kind, o.renews_contract_id, o.client_id, o.owner_id, o.status], ['renewal', contract, w.client, 'employee', 'open']);
  assert.equal(o.value_minor, 8000000, 'the value is the predecessor’s net before tax, not typed');
  assert.equal(o.service_family, 'campaigns', 'the service family comes from the predecessor’s opportunity');
  assert.equal(o.expected_close_on, riyadh(40), 'expected to close by the end of the contract it renews');
  assert.equal(o.decision_maker, 'مدير تسويق تجريبي');
  const basis = JSON.parse(o.renewal_basis);
  assert.equal(basis.source, 'agreement');
  assert.equal(basis.contract.number, 'CT-0001');
  assert.match(basis.scope, /حملة إطلاق تجريبية/);
  assert.deepEqual(basis.lines.map(l => [l.unit_price_minor, l.net_minor]), [['4000000', '4000000'], ['400000', '4000000']]);
  // في «خط الفرص» تُقرأ الفرصة تجديدًا بما نُسخ.
  assert.equal(pipeline.pipelineBoard(db, users.employee).opportunities.find(x => x.id === id).renewal.contract.number, 'CT-0001');
  // مرة واحدة لكل عقد.
  assert.equal(caught(() => tx(() => renewals.openRenewal(db, users.employee, contract, { stage_code: 'LEAD' }))).code, 'renewal_exists');
  assert.deepEqual(renewals.renewalsFor(db, users.employee).contracts.find(c => c.id === contract).actions, []);
  // صفقة فرصة التجديد تسمّي الصفقة السابقة.
  const renewalDeal = w.openCase(id).id;
  assert.equal(w.kase(renewalDeal).predecessor_case_id, deal);
  // القاعدة: ما نُسخ ثابت، وفرصة تجديد بلا ما تجدّده مرفوضة.
  assert.throws(() => db.prepare("UPDATE opportunities SET renewal_basis='{\"x\":1}',version=version+1 WHERE id=?").run(id), /keeps the contract it renews/);
  assert.throws(() => db.prepare("INSERT INTO opportunities(id,tenant_id,client_id,name,service_family,value_minor,stage_code,owner_id,status,last_activity_on,created_at,updated_at,kind) VALUES('syn-bare-renewal','36t',?,'تجديد تجريبي بلا عقد','campaigns',0,'LEAD','employee','open','2026-10-01','2026-10-01','2026-10-01','renewal')").run(w.client), /renews a contract in force/);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-6: an ended contract does not renew, and a renewal contract names its predecessor once — from the renewal deal only', t => {
  const w = world(t), { db, users, tx, contractId: contract } = w;
  // عقد انتهى أمس: ما يظهر ولا يتجدد.
  const ended = registerContract(w, { end_date: riyadh(-1), start_date: riyadh(-100), signed_on: riyadh(-101), subject: 'عقد تجريبي منتهٍ' });
  assert.equal(renewals.renewalsFor(db, users.employee).contracts.some(c => c.id === ended), false);
  assert.equal(caught(() => tx(() => renewals.openRenewal(db, users.employee, ended, { stage_code: 'LEAD' }))).code, 'contract_ended');
  // عقد تجديد من صفقة ليست صفقة التجديد: مرفوض باسمه.
  const otherDeal = w.openCase(w.opportunity({ name: 'فرصة تجريبية أخرى' })).id;
  w.contract(otherDeal);
  const mismatch = caught(() => tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'عقد تجديد تجريبي خاطئ الصفقة',
    start_date: riyadh(41), end_date: riyadh(400), auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف تجريبي — تجديد', renews_id: contract, case_id: otherDeal })));
  assert.equal(mismatch.code, 'renewal_deal_mismatch');
  // من صفقة فرصة التجديد: يمر، والسابق يقول إنه تجدد ولا ينبّه بعده.
  settings(w);
  const renewalOpp = tx(() => renewals.openRenewal(db, users.employee, contract, { stage_code: 'LEAD' })).id;
  const renewalDeal = w.openCase(renewalOpp).id;
  w.contract(renewalDeal);
  const successor = tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'عقد تجديد حملة الإطلاق التجريبية',
    start_date: riyadh(41), end_date: riyadh(400), auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف تجريبي — تجديد', renews_id: contract, case_id: renewalDeal })).id;
  assert.equal(caught(() => tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'عقد تجديد ثانٍ تجريبي',
    start_date: riyadh(41), end_date: riyadh(400), auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف تجريبي — تجديد ثانٍ', renews_id: contract }))).code, 'already_renewed');
  const board = register.contractsRegisterBoard(db, users.hr).contracts;
  const before = board.find(c => c.id === contract), after = board.find(c => c.id === successor);
  assert.deepEqual([before.renewed_by?.id, before.alert, after.renews?.id], [successor, null, contract]);
  // القاعدة: عقد تجديد ثانٍ قائم لنفس السابق، أو لعقد عميل آخر، مرفوض مهما كان الكاتب.
  assert.throws(() => db.prepare("INSERT INTO contract_records(id,tenant_id,number,party_kind,client_id,contract_type,subject,start_date,end_date,auto_renew,owner_id,original_location,status,created_by,created_at,updated_at,renews_id) VALUES('syn-second-renewal','36t','CT-0901','client',?,'other','عقد تجديد ثانٍ مباشر','2027-01-01','2027-12-31',0,'outsider','أرشيف تجريبي','draft','hr','2026-10-01','2026-10-01',?)").run(w.client, contract), /UNIQUE/);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-6: «renew» on a client contract needs a renewal opportunity following it; «do not renew» needs only its notice', t => {
  const w = world(t, { endIn: 30 }), { db, users, tx, contractId: contract } = w;
  settings(w);
  assert.ok(register.contractsRegisterBoard(db, users.outsider).contracts.find(c => c.id === contract).actions.includes('decide_renewal'), 'inside the alert window');
  const refused = caught(() => tx(() => register.contractAction(db, users.outsider, contract, 'decide_renewal', { decision: 'renew', notice_reference: '', note: 'قرار تجريبي بالتجديد للدورة القادمة' })));
  assert.equal(refused.code, 'renewal_opportunity_required');
  assert.equal(refused.details.refusal.missing[0].owner, users.outsider.name, 'the account owner is named');
  tx(() => renewals.openRenewal(db, users.employee, contract, { stage_code: 'LEAD' }));
  tx(() => register.contractAction(db, users.outsider, contract, 'decide_renewal', { decision: 'renew', notice_reference: '', note: 'قرار تجريبي بالتجديد تتابعه فرصة التجديد' }));
  assert.equal(db.prepare('SELECT decision FROM contract_renewal_decisions WHERE contract_id=?').get(contract).decision, 'renew');
  // عدم التجديد بلا فرصة: يكفيه مرجع الإشعار.
  const other = registerContract(w, { subject: 'عقد تجريبي لا يتجدد', end_date: riyadh(20) });
  tx(() => register.contractAction(db, users.outsider, other, 'decide_renewal', { decision: 'do_not_renew', notice_reference: 'خطاب تجريبي رقم 77 بتاريخه', note: 'قرار تجريبي بعدم التجديد' }));
  assert.equal(caught(() => tx(() => renewals.openRenewal(db, users.employee, other, { stage_code: 'LEAD' }))).code, 'decided_not_to_renew');
  assert.ok(verifyAudit(db));
});

test('P4-CRM-6: the end date opens the reminder window; the account owner and the deal owner are told once per term, and nobody for a contract already renewing', t => {
  const w = world(t, { endIn: 45 }), { db, users, tx, contractId: contract } = w;
  assert.deepEqual(renewals.runRenewalReminders(db), [], 'no alert settings: no reminder, as the register says');
  settings(w, 60);
  assert.deepEqual(renewals.runRenewalReminders(db, riyadh(-20)), [], 'before the window opens (45 − 60 = 15 days ago): nothing yet');
  const sent = renewals.runRenewalReminders(db);
  assert.deepEqual(sent.map(s => [s.contract_id, s.recipients.sort()]), [[contract, ['employee', 'outsider']]]);
  for (const who of ['outsider', 'employee']) {
    const note = db.prepare("SELECT * FROM notifications WHERE user_id=? AND kind='renewal_due'").get(who);
    assert.equal(note.subject_kind, 'contract_renewal', who);
    assert.match(note.title, /CT-0001/);
    assert.equal(note.category, 'approvals');
  }
  assert.deepEqual(renewals.runRenewalReminders(db), [], 'once per term');
  assert.throws(() => db.prepare('DELETE FROM contract_renewal_reminders').run(), /record of what was sent/);
  // عقد ثانٍ في نافذته وله فرصة تجديد: لا تذكير.
  const second = registerContract(w, { subject: 'عقد تجريبي ثانٍ قرب نهايته', end_date: riyadh(30) });
  tx(() => renewals.openRenewal(db, users.employee, second, { stage_code: 'LEAD', service_family: 'branding' }));
  assert.deepEqual(renewals.runRenewalReminders(db), []);
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='contract.renewal_reminded'").get(contract));
  assert.ok(verifyAudit(db));
});

test('P4-CRM-6: a billing schedule on a contract ends no later than its term, and stops when the contract is terminated', t => {
  const w = world(t, { endIn: 90 }), { db, users, tx, contractId: contract } = w;
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'billing.recurring.manage', note: 'منح تجريبي للفوترة الدورية' }));
  const schedule = extra => tx(() => billing.createSchedule(db, users.manager, { client_id: w.client, case_id: '', title: 'اشتراك تجريبي على العقد', cadence: 'monthly', issue_day: 1,
    start_date: riyadh(-60), end_date: riyadh(90), contract_reference: 'بند تجريبي 4-1 من العقد', owner_id: 'manager', lines: [{ description: 'إدارة قنوات تجريبية', amount: '1000.00' }], contract_id: contract, ...extra }));
  assert.equal(caught(() => schedule({ end_date: riyadh(91) })).code, 'schedule_beyond_contract');
  assert.equal(caught(() => schedule({ end_date: '' })).code, 'schedule_beyond_contract', 'a schedule on a contract has an end');
  const s = schedule();
  assert.equal(db.prepare('SELECT contract_id FROM billing_schedules WHERE id=?').get(s.id).contract_id, contract);
  // القاعدة: نهاية أبعد أو عقد آخر بكتابة مباشرة مرفوضان.
  assert.throws(() => db.prepare("UPDATE billing_schedules SET end_date='2099-12-31',version=version+1 WHERE id=?").run(s.id), /end only moves earlier/);
  assert.throws(() => db.prepare("INSERT INTO billing_schedules(id,tenant_id,client_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,end_date,status,owner_id,created_by,created_at,updated_at,contract_id) VALUES('syn-beyond','36t',?,'جدولة تجريبية مباشرة','monthly',1,'[{\"description\":\"x\",\"amount_minor\":100}]','SAR',100,'مرجع تجريبي مباشر',?,'2099-12-31','active','manager','manager','2026-10-01','2026-10-01',?)").run(w.client, riyadh(-60), contract), /no later than its term/);
  // إنهاء العقد يوقف الجدولة بسببها في التشغيل التالي.
  tx(() => register.contractAction(db, users.outsider, contract, 'terminate_contract', { version: db.prepare('SELECT version FROM contract_records WHERE id=?').get(contract).version, note: 'إنهاء تجريبي بإشعار مكتوب رقم 12' }));
  const run = billing.runDueSchedules(db, riyadh(0));
  assert.ok(run.some(r => r.outcome === 'stopped' && /CT-0001/.test(r.detail)), JSON.stringify(run));
  assert.equal(db.prepare('SELECT status FROM billing_schedules WHERE id=?').get(s.id).status, 'paused');
  assert.ok(verifyAudit(db));
});

test('front door and routes: the renewal card opens the renewal form for a seller on the account; the screen reads its own tenant', async t => {
  const w = world(t), { db, users, contractId: contract } = w;
  installServiceCatalog(db);
  const card = who => annotateCatalog(db, users[who], wf.catalog(db, users[who])).find(s => s.code === 'ACC-RENEWAL');
  assert.equal(card('employee').module_link, '#pipeline/renewal');
  assert.equal(card('hr').module_link, undefined, 'no client team: the catalog request stays the path');
  const app = createApp(db);
  const { sessions, call } = await sessionsFor(app, ['employee', 'external']);
  const board = await call('employee', '/pipeline');
  assert.equal(board.status, 200, board.text);
  assert.equal(board.json().renewals.contracts[0].id, contract);
  const post = key => dispatch(app, { method: 'POST', path: `/api/pipeline/contracts/${contract}/open_renewal`, body: { stage_code: 'LEAD' },
    headers: { cookie: sessions.employee.cookie, 'x-csrf-token': sessions.employee.csrf, ...(key ? { 'idempotency-key': key } : {}) } });
  assert.equal((await post()).status, 400, 'opening is a creation: no key, no opportunity');
  const first = await post('renewal_open_key_0001');
  assert.equal(first.status, 201, first.text);
  assert.equal((await post('renewal_open_key_0001')).json().id, first.json().id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE renews_contract_id=?').get(contract).n, 1);
  const foreign = await dispatch(app, { method: 'POST', path: `/api/pipeline/contracts/${contract}/open_renewal`, body: { stage_code: 'LEAD' },
    headers: { cookie: sessions.external.cookie, 'x-csrf-token': sessions.external.csrf, 'idempotency-key': 'renewal_open_key_0002' } });
  assert.ok([403, 404].includes(foreign.status), foreign.text);
});
