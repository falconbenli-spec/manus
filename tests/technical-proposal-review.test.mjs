import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createLead, commercialAction, listCommercial, submitTechnicalProposalChecklist } from '../app/commercial.mjs';
import { listProposalReviewQueue, proposalDefinitions, proposalReviewBoard, reviewProposalChecklist } from '../app/technical-proposal-review.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { createApp } from '../app/server.mjs';
import { inbox } from '../app/inbox.mjs';

const code = expected => error => error.code === expected;
const lead = { name: 'عميل مقترح مصطنع', registration_number: 'PROPOSAL-001', contact: 'جهة اتصال مصطنعة', source: 'اختبار محلي', sector: 'خدمات مهنية' };
const qualification = { need: 'عرض فني لمشروع مصطنع', budget: '250000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'حل متوافق مع نطاق الاختبار' };
const quote = { scope: 'عرض فني مصطنع بمخرج واحد قابل للقبول', currency: 'SAR', valid_until: '2099-12-01', lines: [
  { description: 'المخرج المصطنع', quantity: '1', unit_price: '1000.00', unit_cost: '400.00', discount: '0.00', tax_rate: '15.00', acceptance: 'محضر قبول مصطنع', revisions: 2 }
] };

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-technical-proposal-only');
  db.exec("INSERT INTO departments(id,tenant_id,name) VALUES('epmo','36t','مكتب إدارة المشاريع المصطنع'); INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'epmo-reviewer','36t','epmo','epmo-reviewer','مراجع EPMO مصطنع',password_hash,'employee',NULL FROM users WHERE id='employee'; INSERT INTO technical_proposal_policies VALUES('36t',1,'قائمة تحقق لمراجعة العروض الفنية.xlsx','2026-10-03T00:00:00.000Z')");
  t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id FROM users').all().map(user => [user.id, user]));
  const tx = fn => transaction(db, fn);
  const act = (who, record, action, input = {}) => tx(() => commercialAction(db, users[who], record.id, action, { version: record.version, ...input }));
  let record = tx(() => createLead(db, users.employee, lead));
  record = act('employee', record, 'qualify', qualification);
  record = act('manager', record, 'approve_qualification', { note: 'تأهيل مصطنع معتمد للاختبار' });
  record = act('employee', record, 'save_quote', quote);
  const submitChecklist = (type, source = record) => tx(() => submitTechnicalProposalChecklist(db, users.employee, source.id, {
    case_version: source.version, proposal_type: type, items: proposalDefinitions(type).map(item => ({ item_no: item.item_no, evidence: `دليل مصطنع للبند ${item.item_no}`, author_note: '' }))
  }));
  const review = (checklist, decision = 'approved', mutate = value => value) => tx(() => reviewProposalChecklist(db, users['epmo-reviewer'], checklist.id, {
    decision, note: decision === 'approved' ? 'اكتملت مراجعة جميع البنود بصورة مستقلة' : 'تحتاج النسخة معالجة الفجوة قبل الإرسال',
    items: checklist.items.map((item, index) => mutate({ item_id: item.id, result: 'passed', epmo_note: '', responsible_user_id: null, due_on: null }, index))
  }));
  return { db, users, tx, act, record, submitChecklist, review };
}

test('technical proposal gate requires an immutable approved checklist before quote review', t => {
  const { db, users, tx, act, record, submitChecklist, review } = fixture(t);
  assert.equal(record.allowed_actions.includes('submit_quote'), false);
  assert.deepEqual(record.proposal_actions, ['submit_private_proposal_checklist', 'submit_government_proposal_checklist']);
  const other = tx(() => createLead(db, users.employee, { ...lead, name: 'عميل آخر مصطنع', registration_number: 'PROPOSAL-OTHER-001' }));
  assert.throws(() => db.prepare(`INSERT INTO technical_proposal_checklists(id,tenant_id,case_id,quote_id,revision,proposal_type,status,source_reference,submitted_by,submitted_at)
    VALUES(?,'36t',?,?,99,'private','pending_epmo','قائمة تحقق لمراجعة العروض الفنية.xlsx','employee','2026-10-03T00:00:00.000Z')`)
    .run(randomUUID(), other.id, record.current_quote_id), /match the current quote and its active owner/);
  assert.throws(() => db.prepare("INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES('forced-review',?,'quote',?,'employee','manager','2026-10-03T00:00:00.000Z')").run(record.id, record.current_quote_id), /approved technical proposal checklist/);
  const checklist = submitChecklist('private');
  assert.equal(checklist.items.length, 30);
  assert.equal(checklist.status, 'pending_epmo');
  assert.throws(() => tx(() => reviewProposalChecklist(db, users.employee, checklist.id, { decision: 'approved', note: 'اعتماد ذاتي', items: [] })), code('epmo_review_denied'));
  const approved = review(checklist);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.review.items.length, 30);
  const current = listCommercial(db, users.employee).find(item => item.id === record.id);
  assert.equal(current.allowed_actions.includes('submit_quote'), true);
  const pending = act('employee', current, 'submit_quote');
  assert.equal(pending.status, 'quote_pending');
  assert.throws(() => db.prepare("UPDATE technical_proposal_items SET evidence='تغيير' WHERE checklist_id=?").run(checklist.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM technical_proposal_checklists WHERE id=?').run(checklist.id), /immutable/);
  assert.equal(verifyAudit(db), true);
});

test('EPMO reviews every item, records owned gaps, and permits a corrected revision', t => {
  const { db, users, record, submitChecklist, review } = fixture(t);
  const first = submitChecklist('government');
  assert.equal(first.items.length, 38);
  assert.equal(listProposalReviewQueue(db, users['epmo-reviewer'])[0].actions[0], 'review_proposal_checklist');
  const decision = inbox(db, users['epmo-reviewer']).groups.find(group => group.key === 'commercial')?.items.find(item => item.id === first.id);
  assert.equal(decision?.actions[0], 'مراجعة عرض فني');
  assert.equal(decision?.link, `#commercial?focus=${first.id}`);
  assert.throws(() => db.prepare('INSERT INTO technical_proposal_reviews(id,tenant_id,checklist_id,quote_id,decision,note,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', first.id, first.quote_id, 'approved', 'محاولة اعتماد بلا مراجعة البنود', 'epmo-reviewer', '2026-10-03T00:00:00.000Z'), /every source checklist item/);
  const foreign = db.prepare("SELECT id FROM users WHERE tenant_id<>'36t' LIMIT 1").get();
  assert.ok(foreign);
  assert.throws(() => db.prepare('INSERT INTO technical_proposal_review_items(id,review_id,checklist_id,item_id,result,epmo_note,responsible_user_id,due_on,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), randomUUID(), first.id, first.items[0].id, 'gap', 'مسؤول من كيان آخر', foreign.id, '2099-11-01', '2026-10-03T00:00:00.000Z'), /checklist tenant/);
  assert.throws(() => review(first, 'approved', (item, index) => index ? item : { ...item, result: 'gap', epmo_note: 'دليل الحوكمة ناقص', responsible_user_id: 'employee', due_on: '2099-11-01' }), code('proposal_gaps_open'));
  const returned = review(first, 'changes_required', (item, index) => index ? item : { ...item, result: 'gap', epmo_note: 'دليل الحوكمة ناقص', responsible_user_id: 'employee', due_on: '2099-11-01' });
  assert.equal(returned.status, 'changes_required');
  assert.equal(returned.review.items.filter(item => item.result === 'gap').length, 1);
  const current = listCommercial(db, users.employee)[0];
  assert.equal(current.proposal_actions.includes('submit_government_proposal_checklist'), true);
  const corrected = submitChecklist('government', current);
  assert.equal(corrected.revision, 2);
  assert.equal(review(corrected).status, 'approved');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM technical_proposal_checklists WHERE quote_id=?').get(record.current_quote_id).n, 2);
});

test('commercial screen exposes the source checklist and the independent EPMO review form', t => {
  const { db, users, record, submitChecklist } = fixture(t);
  const checklist = submitChecklist('private');
  const board = proposalReviewBoard(db, users['epmo-reviewer']);
  assert.equal(board.definitions.private.length, 30);
  assert.equal(board.definitions.government.length, 38);
  const data = { rows: [record], team: [], user: users.employee, certificates: { cases: {}, signature_statement: '' }, closures: { projects: [] }, proposalReview: board };
  const html = commercialUI.render(data, { e: String, button: (action, id, label) => `<button data-action="${action}" data-id="${id}">${label}</button>` });
  assert.match(html, /مراجعات العروض الفنية لدى EPMO/);
  const spec = commercialUI.form('review_proposal_checklist', checklist.id, data);
  assert.equal(spec.endpoint, `/technical-proposal-reviews/${checklist.id}/review`);
  assert.equal(spec.fields.at(-1).value.length, 30);
});

test('technical proposal HTTP routes submit, list and review the same quote checklist', async t => {
  const { db, record } = fixture(t), server = createApp(db);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, sessions = {};
  for (const username of ['employee', 'epmo-reviewer']) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'synthetic-technical-proposal-only' }) });
    assert.equal(response.status, 200); const body = await response.json(); sessions[username] = { cookie: response.headers.get('set-cookie').split(';')[0], csrf: body.csrf };
  }
  const call = async (who, path, input, expected = 200) => {
    const auth = sessions[who], response = await fetch(base + '/api' + path, { method: input === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'Idempotency-Key': randomUUID() }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
  };
  const items = proposalDefinitions('private').map(item => ({ item_no: item.item_no, evidence: `دليل HTTP مصطنع للبند ${item.item_no}`, author_note: '' }));
  const checklist = await call('employee', `/technical-proposal-reviews/${record.id}/submit`, { case_version: record.version, proposal_type: 'private', items }, 201);
  const board = await call('epmo-reviewer', '/technical-proposal-reviews');
  assert.equal(board.queue[0].id, checklist.id);
  const approved = await call('epmo-reviewer', `/technical-proposal-reviews/${checklist.id}/review`, { decision: 'approved', note: 'مراجعة HTTP مستقلة ومكتملة', items: checklist.items.map(item => ({ item_id: item.id, result: 'passed', epmo_note: '', responsible_user_id: null, due_on: null })) }, 201);
  assert.equal(approved.status, 'approved');
  const cases = await call('employee', '/commercial');
  assert.equal(cases[0].allowed_actions.includes('submit_quote'), true);
});
