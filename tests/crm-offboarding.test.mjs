// P4-CRM-7 — إنهاء العلاقة مع العميل (الترحيل 186): الإقفال سجلٌّ يفحص ما بقي مفتوحًا ويقرّه حامل clients.manage غير طالبه
// (في الشيفرة وفي القاعدة)، ويُخرج الفريق ويوقف الجهات والعلامات ويسحب تفويض المعتمدين، ويحفظ أساس الاحتفاظ من سجل حماية
// البيانات؛ والمال الذي لم يُخصَّص للعميل يقف عليه الإقفال بسبب مسمّى بلا مسار ردّ مخترع؛ وكل مسار ينشئ عملًا جديدًا لعميل
// مقفل يرفض برفض واحد مسمّى. بيانات تجريبية مصطنعة بالكامل (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as agency from '../app/agency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import * as receivables from '../app/receivables.mjs';
import * as support from '../app/client-support.mjs';
import * as offboarding from '../app/client-offboarding.mjs';
import { inbox } from '../app/inbox.mjs';
import { createApp } from '../app/server.mjs';
import { sessionsFor, dispatch } from './definitions-fixture.mjs';
import { crmWorld, code, caught, riyadh, OPPORTUNITY } from './crm-fixture.mjs';

const version = (db, id) => db.prepare('SELECT version FROM client_offboardings WHERE id=?').get(id).version;
const REASON = 'انتهت حملات العميل التجريبي ولا عمل قائم معه';

test('P4-CRM-7: closing is a record, not a status — the status change is refused with its path, and the database refuses a client closed without an approved record', t => {
  const { db, users, tx, client } = crmWorld(t);
  const refused = caught(() => tx(() => agency.clientAction(db, users.outsider, client, 'set_status', { status: 'closed', note: 'محاولة إقفال تجريبية' })));
  assert.equal(refused.code, 'offboarding_required');
  assert.match(refused.details.refusal.next, /طلب إقفال الملف/);
  // التنقل بين الحالات المفتوحة باقٍ كما كان.
  tx(() => agency.clientAction(db, users.outsider, client, 'set_status', { status: 'paused', note: 'توقف تجريبي مؤقت' }));
  assert.equal(caught(() => tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي يولد مقفلًا', sector: 'تجريبي', status: 'closed' }))).code, 'status');
  assert.throws(() => db.prepare("UPDATE clients SET status='closed',version=version+1 WHERE id=?").run(client), /closed only through an approved offboarding record/);
  assert.throws(() => db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('syn-born-closed','36t','C-0902','عميل تجريبي مباشر','','تجريبي','closed','outsider','','2026-10-01','2026-10-01')").run(), /closed only through/);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-7: the checklist names what is still open and who owns it, and the request is refused until nothing blocks', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const opp = w.opportunity();
  const early = tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'زيارة تجريبية' })).id;
  const signedOpp = w.opportunity({ name: 'فرصة تجريبية متعاقد عليها' });
  const contracted = w.openCase(signedOpp).id;
  w.contract(contracted);
  const supportCase = tx(() => support.openSupportCase(db, users.employee, { client_id: client, case_id: contracted, kind: 'complaint', severity: 'low', channel: 'email',
    received_at: new Date(Date.now() - 3600000).toISOString(), statement: 'ملاحظة تجريبية من العميل على موعد التسليم' })).number;
  const list = offboarding.offboardingChecklist(db, '36t', client);
  const open = Object.fromEntries(list.filter(i => i.blocking).map(i => [i.key, i]));
  assert.deepEqual(Object.keys(open).sort(), ['open_deals', 'open_opportunities', 'support_cases', 'undelivered_lines'].sort());
  assert.equal(open.open_opportunities.owner, users.employee.name, 'the owner of what is open is named');
  assert.equal(open.undelivered_lines.why.startsWith('2 بند'), true, open.undelivered_lines.why);
  assert.deepEqual(open.support_cases.refs, [supportCase]);
  const panel = agency.clientsBoard(db, users.outsider).clients.find(c => c.id === client).offboarding;
  assert.deepEqual(panel.actions, [], 'no «request» button while something blocks');
  const refused = caught(() => tx(() => offboarding.requestOffboarding(db, users.outsider, client, { kind: 'close', reason: REASON, approver_id: 'manager' })));
  assert.equal(refused.code, 'offboarding_open_items');
  assert.deepEqual(refused.details.refusal.missing.map(m => m.doc_key).sort(), Object.keys(open).sort());
  // تُحسم: الفرصة الخاسرة والصفقة المبكرة تُغلقان، وفرصة الاتفاق رابحة — وتبقى بنود الاتفاق حتى تُسلَّم.
  w.oppAct('employee', opp, 'lose', { loss_reason_id: w.reasons.price, comment: 'خسرنا الفرصة التجريبية قبل الإقفال' });
  w.oppAct('employee', signedOpp, 'win', {});
  w.act('employee', early, 'close_lost', { reason_id: w.reasons.capacity, comment: 'ما عاد عندنا طاقة تجريبية للعميل' });
  assert.deepEqual(offboarding.offboardingChecklist(db, '36t', client).filter(i => i.blocking).map(i => i.key).sort(), ['support_cases', 'undelivered_lines']);
  assert.ok(verifyAudit(db));
});

test('P4-CRM-7: client money not allocated blocks closure with a named finance gap — the platform invents no refund path', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const deal = w.openCase(w.opportunity()).id;
  w.contract(deal);
  const receipt = tx(() => receivables.recordAccountReceipt(db, users.employee, { case_id: deal, reference: 'ACC-SYN-7701', amount: '5000.00', received_on: riyadh(), payer: 'دافع تجريبي', evidence: 'إشعار تحويل تجريبي محفوظ' }));
  tx(() => receivables.accountReceiptAction(db, users.manager, receipt.id, 'confirm', { note: 'طوبق التحويل التجريبي', matching_evidence: 'كشف بنكي تجريبي يظهر الحركة' }));
  const refused = caught(() => tx(() => offboarding.requestOffboarding(db, users.outsider, client, { kind: 'close', reason: REASON, approver_id: 'manager' })));
  const money = refused.details.refusal.missing.find(m => m.doc_key === 'unrefunded_money');
  assert.ok(money, JSON.stringify(refused.details.refusal.missing.map(m => m.doc_key)));
  assert.match(money.owner, /المالية/);
  assert.match(money.why, /ما فيها مسار ردّ/);
  assert.match(refused.details.refusal.next, /ز16/, 'the refund path is named as the owner’s open decision');
});

test('P4-CRM-7: a clean client closes through a record decided by a second clients.manage holder — the team leaves, contacts and brands stop, and the requester never decides', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  tx(() => agency.clientAction(db, users.outsider, client, 'add_brand', { name: 'علامة تجريبية', guideline_reference: 'دليل هوية تجريبي — نسخة 2' }));
  const request = input => tx(() => offboarding.requestOffboarding(db, users.outsider, client, { kind: 'close', reason: REASON, ...input }));
  assert.equal(caught(() => request({ approver_id: 'manager' })).code, 'assets_note', 'a client with brands needs a word on their files');
  assert.equal(caught(() => request({ approver_id: 'employee', assets_note: 'سُلّمت الملفات للعميل التجريبي بخطاب' })).code, 'approver_id', 'the employee holds no clients.manage');
  assert.equal(caught(() => request({ approver_id: 'outsider', assets_note: 'سُلّمت الملفات للعميل التجريبي بخطاب' })).code, 'approver_id', 'nobody approves their own request');
  assert.equal(caught(() => tx(() => offboarding.requestOffboarding(db, users.employee, client, { kind: 'close', reason: REASON, approver_id: 'manager' }))).code, 'not_permitted', 'the account owner requests');
  const { id, number } = request({ approver_id: 'manager', assets_note: 'سُلّمت ملفات العلامة للعميل التجريبي بخطاب تسليم مؤرخ' });
  assert.equal(number, 'OFB-0001');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='manager' AND kind='client_offboarding_needed'").get(), 'the named approver is told');
  assert.equal(caught(() => tx(() => offboarding.offboardingAction(db, users.outsider, id, 'approve_offboarding', { version: version(db, id), note: 'اعتماد ذاتي' }))).code, 'offboarding_transition');
  // القاعدة: الطالب لا يقرّ، ولا يُقفل الملف بسجل ما انعتمد.
  assert.throws(() => db.prepare("UPDATE client_offboardings SET status='approved',decided_by='outsider',decided_at='2026-10-01T09:00:00.000Z',decision_note='اعتماد ذاتي مباشر',version=version+1 WHERE id=?").run(id), /CHECK constraint/);
  assert.throws(() => db.prepare("UPDATE clients SET status='closed',offboarding_id=?,version=version+1 WHERE id=?").run(id, client), /approved offboarding record|approved record/);
  const decided = tx(() => offboarding.offboardingAction(db, users.manager, id, 'approve_offboarding', { version: version(db, id), note: 'اطلعت على قائمة الفحص وخطاب تسليم الملفات' }));
  assert.equal(decided.status, 'approved');
  const row = db.prepare('SELECT * FROM clients WHERE id=?').get(client);
  assert.deepEqual([row.status, row.offboarding_id], ['closed', id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_members WHERE client_id=? AND removed_at IS NULL').get(client).n, 0, 'the team left');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_contacts WHERE client_id=? AND active=1').get(client).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_contacts WHERE client_id=?').get(client).n, 1, 'contacts are kept, not deleted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_brands WHERE client_id=? AND active=1').get(client).n, 0);
  const record = db.prepare('SELECT * FROM client_offboardings WHERE id=?').get(id);
  assert.deepEqual(JSON.parse(record.effects).members_removed.sort(), ['employee', 'manager']);
  assert.equal(JSON.parse(record.retention).source, 'unset', 'no retention period in the privacy register: none invented');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='employee' AND kind='client_access_ended'").get());
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='outsider' AND kind='client_offboarding_decided'").get());
  // الوصول: العضو السابق ما يرى الملف، والمسؤول يراه مقفلًا بلا أزرار عمل.
  assert.equal(agency.clientsBoard(db, users.employee).clients.some(c => c.id === client), false);
  const owner = agency.clientsBoard(db, users.outsider).clients.find(c => c.id === client);
  assert.deepEqual([owner.offboarding.closed, owner.offboarding.actions], [true, ['request_reopening']]);
  // كل عمل جديد يُرفض برفض واحد مسمّى.
  for (const attempt of [
    () => agency.clientAction(db, users.outsider, client, 'add_contact', { name: 'جهة تجريبية جديدة', title: 'مدير', email: '', phone: '' }),
    () => commercial.createLead(db, users.outsider, { client_id: client, source: 'محاولة تجريبية بعد الإقفال', contact: 'جهة' }),
    () => pipeline.createOpportunity(db, users.outsider, { client_id: client, stage_code: 'LEAD', ...OPPORTUNITY })]) {
    const refusedAfter = caught(() => tx(attempt));
    assert.ok(['client_closed', 'commercial_role', 'not_permitted'].includes(refusedAfter.code), refusedAfter.code);
  }
  assert.equal(caught(() => tx(() => agency.clientAction(db, users.outsider, client, 'add_contact', { name: 'جهة تجريبية جديدة', title: 'مدير', email: '', phone: '' }))).code, 'client_closed');
  assert.ok(verifyAudit(db));
});

test('P4-CRM-7: reopening is a record too — decided by a named holder outside the old team, it restores contacts and brands and leaves the team to the owner', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const close = tx(() => offboarding.requestOffboarding(db, users.outsider, client, { kind: 'close', reason: REASON, approver_id: 'manager' })).id;
  tx(() => offboarding.offboardingAction(db, users.manager, close, 'approve_offboarding', { version: version(db, close), note: 'اطلعت على قائمة الفحص كاملة' }));
  assert.throws(() => db.prepare("UPDATE clients SET status='active',version=version+1 WHERE id=?").run(client), /reopened only through an approved reopening record/);
  const reopen = tx(() => offboarding.requestOffboarding(db, users.outsider, client, { kind: 'reopen', reason: 'رجع العميل التجريبي بطلب حملة جديدة', approver_id: 'manager' })).id;
  // المعتمد خارج الفريق الآن: يرى السجل في «بانتظار قراري» وفي صندوقه، لا ملف العميل كله.
  assert.equal(agency.clientsBoard(db, users.manager).clients.some(c => c.id === client), false);
  assert.deepEqual(agency.clientsBoard(db, users.manager).offboarding_awaiting.map(r => [r.id, r.kind]), [[reopen, 'reopen']]);
  assert.equal(inbox(db, users.manager).groups.find(g => g.key === 'clients')?.total, 1);
  tx(() => offboarding.offboardingAction(db, users.manager, reopen, 'approve_offboarding', { version: version(db, reopen), note: 'رجوع العميل موثّق بطلبه المكتوب' }));
  const row = db.prepare('SELECT status,offboarding_id FROM clients WHERE id=?').get(client);
  assert.deepEqual([row.status, row.offboarding_id], ['active', reopen]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_contacts WHERE client_id=? AND active=1').get(client).n, 1, 'contacts come back');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_members WHERE client_id=? AND removed_at IS NULL').get(client).n, 0, 'the team is added back by decision, not automatically');
  tx(() => agency.clientAction(db, users.outsider, client, 'add_member', { user_id: 'employee', role: 'عضو فريق الحساب التجريبي' }));
  assert.equal(offboarding.offboardingChecklist(db, '36t', client).find(i => i.key === 'account_team').count, 1);
  assert.ok(verifyAudit(db));
});

test('routes and inbox: the request is a creation under an idempotency key, the decision a version-checked step, and another tenant reaches neither', async t => {
  const w = crmWorld(t), { db, users, client } = w;
  const app = createApp(db);
  const { sessions, call } = await sessionsFor(app, ['outsider', 'manager', 'external']);
  const post = (who, path, body, key) => dispatch(app, { method: 'POST', path: '/api' + path, body, headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) } });
  const body = { kind: 'close', reason: REASON, approver_id: 'manager' };
  assert.equal((await post('outsider', `/clients/${client}/offboarding`, body)).status, 400, 'no key, no record');
  const first = await post('outsider', `/clients/${client}/offboarding`, body, 'offboarding_key_0001');
  assert.equal(first.status, 201, first.text);
  assert.equal((await post('outsider', `/clients/${client}/offboarding`, body, 'offboarding_key_0001')).json().id, first.json().id);
  assert.equal(inbox(db, users.manager).groups.find(g => g.key === 'clients')?.total, 1, 'the approver finds it waiting');
  assert.equal(inbox(db, users.outsider).groups.find(g => g.key === 'clients'), undefined, 'the requester is not asked to decide');
  const board = await call('manager', '/clients');
  assert.equal(board.json().offboarding_awaiting[0].id, first.json().id);
  const foreign = await post('external', `/client-offboardings/${first.json().id}/approve_offboarding`, { version: 1, note: 'محاولة من كيان آخر' });
  assert.ok([403, 404].includes(foreign.status), foreign.text);
  const decided = await call('manager', `/client-offboardings/${first.json().id}/approve_offboarding`, { version: 1, note: 'اطلعت على قائمة الفحص' });
  assert.equal(decided.status, 201, decided.text);
  assert.equal(db.prepare('SELECT status FROM clients WHERE id=?').get(client).status, 'closed');
});
