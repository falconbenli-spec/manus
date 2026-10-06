// P4-CRM-5 — الدعم بعد البيع (الترحيل 184): بلاغ العميل وتصعيده سجلٌّ مربوط بالعميل والصفقة وبمهلته، لا طلبًا نصيًا في الدليل.
// المهلة لا تُخترع (القرار D4 «كلاهما»): بند العقد المسجّل على الصفقة يتجاوز، وإلا القيمة المعتمدة crm.support_response_hours،
// وإلا «ما تحددت» وتقولها الشاشة. ومن يقرّ الحل ليس من سجّله، في الشيفرة وفي القاعدة.
// بيانات تجريبية مصطنعة بالكامل (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { adoptionAction } from '../app/options.mjs';
import * as support from '../app/client-support.mjs';
import * as register from '../app/contracts-register.mjs';
import { annotateCatalog } from '../app/module-routes.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { inbox } from '../app/inbox.mjs';
import { createApp } from '../app/server.mjs';
import { sessionsFor } from './definitions-fixture.mjs';
import { crmWorld, code, caught, riyadh } from './crm-fixture.mjs';

const hoursAgo = n => new Date(Date.now() - n * 3600000).toISOString();
const COMPLAINT = (w, deal, extra = {}) => ({ client_id: w.client, case_id: deal, kind: 'complaint', severity: 'high', channel: 'email', received_at: hoursAgo(2),
  statement: 'العميل التجريبي يقول إن هوية الحملة وصلت بألوان غير المعتمدة في الدليل', ...extra });
function contracted(w) {
  const opp = w.opportunity();
  const deal = w.openCase(opp).id;
  w.contract(deal);
  return deal;
}
// سجل عقد للصفقة: يسجّله حامل إدارة السجل (hr هنا) ويقرّ سريانه مالكه (مسؤول الحساب)، كما في app/contracts-register.mjs.
function registerContract(w, deal, terms = {}) {
  const { db, users, tx } = w;
  tx(() => grantAccess(db, users.admin, { user_id: 'hr', capability: 'contracts.register.manage', note: 'منح تجريبي لسجل العقود' }));
  const id = tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'أمر عمل تجريبي لحملة الإطلاق',
    start_date: riyadh(-30), end_date: riyadh(60), value: '80000.00', auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف العقود التجريبي — ملف 7001',
    signed_on: riyadh(-31), case_id: deal, ...terms })).id;
  const version = () => db.prepare('SELECT version FROM contract_records WHERE id=?').get(id).version;
  tx(() => register.contractAction(db, users.outsider, id, 'activate_contract', { version: version(), note: 'أقرّ بملكية العقد التجريبي ومطابقته للأصل' }));
  return id;
}
const adopt = (w, key, value) => {
  w.tx(() => adoptionAction(w.db, w.users.outsider, key, 'record', { value, basis: 'قرار تجريبي من مسؤول ملفات العملاء', effective_from: riyadh(-5) }));
  const pending = w.db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(key).id;
  w.tx(() => adoptionAction(w.db, w.users.manager, key, 'approve', { adoption_id: pending, note: 'اعتماد تجريبي من شخص ثانٍ' }));
};

test('P4-CRM-5: a complaint is a record on the client and the deal, owned by the account owner — and until a response time is adopted the case says plainly that none is set', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const deal = contracted(w);
  const opened = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal)));
  assert.match(opened.number, /^SC-0001$/);
  const row = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(opened.id);
  assert.deepEqual([row.client_id, row.case_id, row.kind, row.status, row.handler_id, row.opened_by], [w.client, deal, 'complaint', 'open', 'outsider', 'employee']);
  assert.deepEqual([row.response_source, row.response_hours, row.response_due_at, row.warranty_source], ['unset', null, null, 'unset'], 'no invented clock');
  const view = support.supportBoard(db, users.employee).cases.find(c => c.id === opened.id);
  assert.equal(view.clock.state, 'unset');
  assert.match(view.clock.text, /ما تحددت مهلة رد/);
  assert.equal(view.deal.id, deal);
  assert.equal(view.client.id, w.client);
  // الإشعار يصل مسؤول الحساب برقم البلاغ، ولا يحمل نص العميل (PLT-10).
  const note = db.prepare("SELECT * FROM notifications WHERE user_id='outsider' AND kind='support_case_assigned'").get();
  assert.equal(note.subject_kind, 'client_support_case');
  assert.match(note.title, /SC-0001/);
  assert.ok(!note.title.includes('ألوان') && !note.body.includes('ألوان'), 'the complaint text is not in the notice');
  assert.equal(note.category, 'approvals');
  // مسجّلة بلا اعتماد شخص ثانٍ: ما زالت «ما تحددت».
  tx(() => adoptionAction(db, users.outsider, support.SUPPORT_RESPONSE_HOURS, 'record', { value: { hours: 24 }, basis: 'قرار تجريبي: يوم عمل للرد الأول', effective_from: riyadh(-5) }));
  const second = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal)));
  assert.equal(db.prepare('SELECT response_source FROM client_support_cases WHERE id=?').get(second.id).response_source, 'unset', 'recorded is not adopted');
  const pending = db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(support.SUPPORT_RESPONSE_HOURS).id;
  tx(() => adoptionAction(db, users.manager, support.SUPPORT_RESPONSE_HOURS, 'approve', { adoption_id: pending, note: 'اعتماد تجريبي من شخص ثانٍ' }));
  const received = hoursAgo(30);
  const third = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal, { received_at: received })));
  const adopted = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(third.id);
  assert.deepEqual([adopted.response_source, adopted.response_hours], ['adopted', 24]);
  assert.equal(adopted.response_due_at, new Date(Date.parse(received) + 24 * 3600000).toISOString(), 'the clock starts when the client raised it, not when it was typed');
  assert.equal(support.supportBoard(db, users.employee).cases.find(c => c.id === third.id).clock.state, 'late', 'thirty hours against a twenty-four-hour clock');
  assert.ok(verifyAudit(db));
});

test('D4: the contract registered on the deal overrides the adopted response time and warranty, and is fixed once in force', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const deal = contracted(w);
  adopt(w, support.SUPPORT_RESPONSE_HOURS, { hours: 24 });
  adopt(w, support.WARRANTY_DAYS, { days: 30 });
  const contractId = registerContract(w, deal, { support_response_hours: 4, warranty_days: 90 });
  const received = hoursAgo(1);
  const opened = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal, { received_at: received })));
  const row = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(opened.id);
  assert.deepEqual([row.response_source, row.response_hours, row.contract_id, row.warranty_source, row.warranty_days], ['contract', 4, contractId, 'contract', 90]);
  assert.equal(row.response_due_at, new Date(Date.parse(received) + 4 * 3600000).toISOString());
  assert.equal(row.warranty_until, null, 'no accepted deliverable yet: the warranty has not started');
  assert.equal(support.supportBoard(db, users.employee).cases.find(c => c.id === opened.id).warranty.state, 'not_started');
  // العقد الساري لا تتغير بنود دعمه ولا صفقته.
  assert.throws(() => db.prepare('UPDATE contract_records SET support_response_hours=8,version=version+1 WHERE id=?').run(contractId), /support terms/);
  // صفقة واحدة بسجل عقد قائم واحد.
  assert.equal(caught(() => tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'سجل ثانٍ تجريبي للصفقة نفسها',
    start_date: riyadh(-30), end_date: riyadh(60), auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف العقود التجريبي — ملف 7002', case_id: deal }))).code, 'deal_has_contract');
  // وبالقاعدة: صفقة عميل آخر لا تُربط بعقد هذا العميل.
  assert.throws(() => db.prepare("INSERT INTO contract_records(id,tenant_id,number,party_kind,client_id,contract_type,subject,start_date,end_date,auto_renew,owner_id,original_location,status,created_by,created_at,updated_at,case_id) VALUES('syn-bad','36t','CT-0999','vendor',NULL,'other','عقد تجريبي خاطئ','2026-01-01','2026-12-31',0,'outsider','أرشيف تجريبي','draft','hr','2026-01-01','2026-01-01',?)").run(deal), /CHECK constraint|own client/);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-5: after-sales needs a contracted deal of the same client; an escalation may stand on the account alone, with its risk', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const early = w.openCase(w.opportunity()).id;
  assert.equal(caught(() => tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, early)))).code, 'after_sale_deal_required');
  assert.equal(caught(() => tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, null)))).code, 'after_sale_deal_required');
  const deal = contracted(w);
  assert.equal(caught(() => tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal, { risk: 'churn' })))).code, 'risk');
  assert.equal(caught(() => tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal, { received_at: new Date(Date.now() + 3600000).toISOString() })))).code, 'received_at');
  const escalation = tx(() => support.openSupportCase(db, users.manager, { client_id: w.client, kind: 'escalation', severity: 'medium', risk: 'churn', channel: 'meeting',
    received_at: hoursAgo(5), statement: 'العميل التجريبي ألمح في الاجتماع إلى مراجعة الوكالة كلها' }));
  assert.equal(db.prepare('SELECT case_id,risk FROM client_support_cases WHERE id=?').get(escalation.id).risk, 'churn');
  assert.throws(() => tx(() => support.openSupportCase(db, users.employee, { client_id: w.client, kind: 'escalation', severity: 'medium', channel: 'meeting', received_at: hoursAgo(5), statement: 'تصعيد تجريبي بلا نوع خطر' })), code('risk'));
  // القاعدة نفسها: شكوى بلا صفقة، وصفقة عميل آخر، مرفوضتان مهما كان الكاتب.
  const base = "INSERT INTO client_support_cases(id,tenant_id,number,client_id,case_id,kind,severity,risk,channel,received_at,statement,response_source,warranty_source,handler_id,status,opened_by,created_at,updated_at) VALUES(?,'36t',?,?,?,?,'low',?,'email','2026-10-01T06:00:00.000Z','نص بلاغ تجريبي مباشر','unset','unset','outsider','open','outsider','2026-10-01','2026-10-01')";
  assert.throws(() => db.prepare(base).run('syn-direct-1', 'SC-0901', w.client, null, 'complaint', null), /CHECK constraint/);
  const other = tx(() => db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('syn-other','36t','C-0901','عميل تجريبي آخر','','تجريبي','active','outsider','','2026-10-01','2026-10-01') RETURNING id").get().id);
  assert.throws(() => db.prepare(base).run('syn-direct-2', 'SC-0902', other, deal, 'complaint', null), /customer of its deal/);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-5: the handler answers and resolves; someone else on the account team confirms — the resolver is refused in the code and in the database', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const deal = contracted(w);
  const { id } = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal)));
  const version = () => db.prepare('SELECT version FROM client_support_cases WHERE id=?').get(id).version;
  const act = (who, action, input = {}) => tx(() => support.supportAction(db, users[who], id, action, { version: version(), ...input }));
  // البلاغ عند مسؤول الحساب: غيره ما يرد بدلًا منه.
  assert.equal(caught(() => act('employee', 'respond_case', { note: 'رد تجريبي من غير المسؤول' })).code, 'support_transition');
  act('outsider', 'reassign_case', { handler_id: 'employee', note: 'الموظفة تتابع الحملة يوميًا' });
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='employee' AND kind='support_case_assigned'").get(), 'the new handler is told');
  act('employee', 'respond_case', { note: 'اتصلنا بالعميل التجريبي ووعدناه بالتصحيح خلال يومين' });
  // «ضمن الضمان» بلا ضمان معروف: مرفوض باسمه.
  const outside = caught(() => act('employee', 'resolve_case', { resolution_kind: 'warranty_fix', resolution: 'صححنا الألوان حسب الدليل', evidence: 'نسخة مصححة تجريبية محفوظة' }));
  assert.equal(outside.code, 'outside_warranty');
  assert.match(outside.details.refusal.missing[0].document, /crm\.warranty_days/);
  act('employee', 'resolve_case', { resolution_kind: 'fixed', resolution: 'صححنا الألوان حسب دليل الهوية', evidence: 'نسخة مصححة تجريبية في أرشيف المشروع' });
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='outsider' AND kind='support_resolution_awaiting'").get(), 'the account owner is asked to confirm');
  assert.equal(caught(() => act('employee', 'confirm_resolution', { note: 'إقرار ذاتي' })).code, 'support_transition', 'the resolver does not confirm');
  // القاعدة: من سجّل الحل لا يقفله، حتى بكتابة مباشرة.
  assert.throws(() => db.prepare("UPDATE client_support_cases SET status='closed',closed_at='2026-10-01T09:00:00.000Z',closed_by='employee',version=version+1 WHERE id=?").run(id), /CHECK constraint/);
  // إرجاع الحل يعيده للمعالجة، ونص الحل الأول باقٍ في السجل.
  act('outsider', 'return_resolution', { note: 'العميل التجريبي ما وصله الملف المصحح بعد' });
  assert.equal(db.prepare('SELECT status,resolution FROM client_support_cases WHERE id=?').get(id).status, 'responded');
  assert.ok(db.prepare("SELECT 1 FROM client_support_events WHERE support_case_id=? AND action='resolved' AND note LIKE '%الألوان%'").get(id));
  act('employee', 'resolve_case', { resolution_kind: 'fixed', resolution: 'أرسلنا الملف المصحح بالبريد وتأكدنا من وصوله', evidence: 'رسالة تسليم تجريبية محفوظة في أرشيف المشروع' });
  const closed = act('manager', 'confirm_resolution', { note: 'اطلعت على رسالة التسليم' });
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.actions, [], 'a closed case is final');
  assert.throws(() => db.prepare("UPDATE client_support_cases SET status='responded',version=version+1 WHERE id=?").run(id), /closed case is final/);
  assert.throws(() => db.prepare('DELETE FROM client_support_events WHERE support_case_id=?').run(id), /append-only/);
  assert.deepEqual(db.prepare('SELECT action FROM client_support_events WHERE support_case_id=? ORDER BY created_at,rowid').all(id).map(r => r.action),
    ['opened', 'reassigned', 'responded', 'resolved', 'returned', 'resolved', 'closed']);
  assert.ok(verifyAudit(db));
});

test('isolation: outside the account team, and in another tenant, the case does not exist', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const deal = contracted(w);
  const { id } = tx(() => support.openSupportCase(db, users.employee, COMPLAINT(w, deal)));
  assert.equal(support.supportBoard(db, users.external).cases.length, 0);
  assert.equal(caught(() => tx(() => support.supportAction(db, users.external, id, 'respond_case', { version: 1, note: 'محاولة من كيان آخر' }))).code, 'not_found');
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('syn-stranger','36t','creative','syn-stranger','موظف تجريبي خارج الفريق','unused','employee','manager')").run();
  const stranger = db.prepare("SELECT * FROM users WHERE id='syn-stranger'").get();
  assert.equal(support.supportBoard(db, stranger).cases.length, 0);
  assert.equal(caught(() => tx(() => support.openSupportCase(db, stranger, COMPLAINT(w, deal)))).code, 'not_found');
});

test('front door: the catalog complaint and escalation cards open the support form for an account-team member, and stay requests for everyone else', t => {
  const w = crmWorld(t), { db, users } = w;
  installServiceCatalog(db);
  const cards = who => new Map(annotateCatalog(db, users[who], wf.catalog(db, users[who])).map(s => [s.code, s]));
  const member = cards('employee');
  assert.equal(member.get('ACC-CLIENT-COMPLAINT')?.module_link, '#client-support/new?kind=complaint');
  assert.equal(member.get('ACC-ESCALATION')?.module_link, '#client-support/new?kind=escalation');
  assert.equal(cards('hr').get('ACC-CLIENT-COMPLAINT')?.module_link, undefined, 'no client team: the catalog request stays the path');
});

test('inbox and routes: the handler finds the case in «بانتظار إجرائي», and the screen answers its own tenant only', async t => {
  const w = crmWorld(t), { db, users } = w;
  const deal = contracted(w);
  const app = createApp(db);
  const { call, sessions } = await sessionsFor(app, ['employee', 'outsider', 'external']);
  const body = COMPLAINT(w, deal);
  const { dispatch } = await import('./definitions-fixture.mjs');
  const post = (who, path, input, key) => dispatch(app, { method: 'POST', path: '/api' + path, body: input, headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) } });
  assert.equal((await post('employee', '/client-support', body)).status, 400, 'opening is a creation: no key, no case');
  const first = await post('employee', '/client-support', body, 'support_open_key_0001');
  assert.equal(first.status, 201, first.text);
  const again = await post('employee', '/client-support', body, 'support_open_key_0001');
  assert.equal(again.json().id, first.json().id, 'a retried request returns the same case');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_support_cases').get().n, 1);
  const board = await call('outsider', '/client-support');
  assert.equal(board.status, 200, board.text);
  assert.deepEqual(board.json().cases[0].actions, ['respond_case', 'reassign_case']);
  const mine = inbox(db, users.outsider).groups.find(g => g.key === 'client-support');
  assert.equal(mine?.total, 1, 'the account owner finds the new case waiting for a first response');
  assert.ok(!JSON.stringify(mine).includes('ألوان'), 'the inbox row carries the number, not the complaint');
  const answered = await call('outsider', `/client-support/${first.json().id}/respond_case`, { version: 1, note: 'اتصلنا بالعميل التجريبي ووعدناه بالتصحيح' });
  assert.equal(answered.status, 201, answered.text);
  assert.equal((await call('external', '/client-support')).json().cases.length, 0);
  assert.equal((await call('external', `/client-support/${first.json().id}/resolve_case`, { version: 2, resolution_kind: 'fixed', resolution: 'محاولة من كيان آخر', evidence: 'محاولة من كيان آخر' })).status, 404);
  await call('outsider', `/client-support/${first.json().id}/resolve_case`, { version: 2, resolution_kind: 'explained', resolution: 'وضّحنا للعميل أن الألوان مطابقة للدليل المعتمد', evidence: 'محضر اتصال تجريبي محفوظ' }, 201);
  assert.equal(inbox(db, users.outsider).groups.find(g => g.key === 'client-support'), undefined, 'resolved: nothing waits on the resolver');
  const waiting = inbox(db, users.manager).groups.find(g => g.key === 'client-support');
  assert.equal(waiting?.total, 1, 'the second person on the team is asked to confirm');
});
