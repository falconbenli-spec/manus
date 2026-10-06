import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { listCommercial, createLead, commercialAction } from '../app/commercial.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor } from './proposal-fixture.mjs';

const errorCode = code => error => error.code === code;
const leadInput = (registration = 'SYNTH-100') => ({ name: 'عميل مصطنع', registration_number: registration, contact: 'جهة اتصال مصطنعة', source: 'اختبار محلي', sector: 'قطاع مصطنع' });
const qualificationInput = () => ({ need: 'إنتاج محتوى لاختبار الرحلة', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'خدمات محتوى ضمن التجربة' });
const quoteInput = () => ({ scope: 'إنتاج مخرجين مصطنعين بمعايير قبول محددة', currency: 'SAR', valid_until: '2099-12-01', lines: [
  { description: 'مخرج أول', quantity: '3', unit_price: '0.10', unit_cost: '0.03', discount: '0.05', tax_rate: '15', acceptance: 'مراجعة ثلاثة عناصر بالنص المعتمد', revisions: 2 },
  { description: 'مخرج ثان', quantity: '1', unit_price: '0.10', unit_cost: '0.01', discount: '0', tax_rate: '15', acceptance: 'مراجعة العنصر الثاني', revisions: 1 }
] });
const changeInput = () => ({ scope: 'مخرج إضافي خارج النطاق الأصلي', additional_price: '10.25', additional_cost: '3.50', extra_days: 2, due_date: '2099-12-02', acceptance: 'قبول النسخة الإضافية بدليل مستقل' });

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-commercial-tests-only');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('pm-test','36t','creative','pm-test','مدير مشروع مصطنع','unused-test-hash','pm','manager'),('manager-other','36t','creative','manager-other','مدير آخر مصطنع','unused-test-hash','manager',NULL),('employee-other','36t','creative','employee-other','موظف فريق آخر','unused-test-hash','employee','manager-other')");
  t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id FROM users').all().map(u => [u.id, u]));
  // الصفقة من ملف عميل (dealFor) ليُحفظ عرضها على عرض سعر العميل (الترحيل 182)؛ legacy تبقي المسار القديم بالاسم ورقم السجل لاختبار ذلك المسار.
  const make = (registration, user = 'employee', { legacy = false } = {}) => transaction(db, () => (legacy ? createLead : dealFor)(db, users[user], leadInput(registration)));
  const act = (who, c, action, input = {}) => transaction(db, () => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  const qualify = c => act('manager', act('employee', c, 'qualify', qualificationInput()), 'approve_qualification', { note: 'تأهيل مصطنع معتمد' });
  const approveQuote = c => act('manager', act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, quoteInput())), 'submit_quote'), 'approve_quote', { note: 'راجعت المبالغ والنطاق' });
  const contract = c => act('employee', c, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع للاختبار المحلي فقط', customer_representative: 'ممثل عميل مصطنع' });
  const project = () => act('manager', contract(approveQuote(qualify(make()))), 'create_project', { member_ids: ['pm-test'] });
  return { db, users, make, act, qualify, approveQuote, contract, project };
}

test('CRM-01/02/06/09: qualified lead becomes an approved quote, internal agreement and scoped project', t => {
  const { db, users, make, act, qualify, approveQuote, contract } = fixture(t);
  let c = make();
  assert.equal(c.status, 'lead');
  assert.throws(() => act('employee', c, 'save_quote', quoteInput()), errorCode('commercial_transition'));
  c = qualify(c); assert.equal(c.status, 'qualified');
  c = approveQuote(c); assert.equal(c.status, 'quote_approved');
  const amount = c.current_quote.snapshot;
  assert.equal(amount.net_minor, '35'); assert.equal(amount.tax_minor, '6'); assert.equal(amount.total_minor, '41');
  assert.equal(amount.cost_minor, '10'); assert.equal(amount.margin_minor, '25');
  assert.equal(amount.lines[1].tax_minor, '2');
  c = contract(c); assert.equal(c.contract.snapshot.quote_digest, c.current_quote.digest);
  const approved = c;
  c = act('manager', c, 'create_project', { member_ids: ['pm-test'] });
  assert.equal(c.status, 'project_active');
  assert.equal(db.prepare('SELECT brief FROM projects WHERE id=?').get(c.project_id).brief, amount.scope);
  assert.deepEqual(db.prepare('SELECT user_id FROM project_members WHERE project_id=? ORDER BY user_id').all(c.project_id).map(r => r.user_id), ['employee', 'manager', 'pm-test']);
  assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM commercial_project_baselines').get().snapshot).total_minor, '41');
  assert.throws(() => act('manager', approved, 'create_project', { member_ids: [] }), errorCode('stale_version'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1);
  assert.equal(listCommercial(db, users.manager).length, 1);
  assert.equal(verifyAudit(db), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 0);
});

test('CRM-01: normalized registration conflicts before saving and network retries use current access', t => {
  const { db, users, make } = fixture(t);
  const c = make(' synth-100 ', 'employee', { legacy: true });
  assert.equal(c.registration_number, 'SYNTH-100');
  assert.throws(() => make('SYNTH-100', 'outsider', { legacy: true }), errorCode('duplicate_registration'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_cases').get().n, 1);
  const input = leadInput('SYNTH-200'), key = 'commercial_test_0001';
  const create = () => createLead(db, users.employee, input);
  const read = id => {
    const result = listCommercial(db, users.employee).find(x => x.id === id);
    if (!result) throw new Error('current scope denied');
    return result;
  };
  const first = transaction(db, () => createOnce(db, users.employee, 'commercial.lead', key, input, create, read));
  const second = transaction(db, () => createOnce(db, users.employee, 'commercial.lead', key, input, create, read));
  assert.equal(first.id, second.id);
  db.prepare("UPDATE users SET department_id='hr' WHERE id='employee'").run();
  assert.throws(() => transaction(db, () => createOnce(db, users.employee, 'commercial.lead', key, input, create, read)), /current scope denied/);
});

test('CRM-02/07: qualification and quote decisions require an independent current direct manager', t => {
  const { db, make, act, users } = fixture(t);
  let c = act('employee', make(), 'qualify', qualificationInput());
  assert.throws(() => act('employee', c, 'approve_qualification', { note: 'اعتماد ذاتي' }), errorCode('commercial_transition'));
  assert.throws(() => act('manager-other', c, 'approve_qualification', { note: 'خارج النطاق' }), errorCode('not_found'));
  assert.throws(() => act('manager', c, 'approve_qualification', { note: '' }), errorCode('invalid_text'));
  db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  assert.equal(listCommercial(db, { ...users.manager, role: 'manager' }).length, 0);
  assert.throws(() => act('manager', c, 'approve_qualification', { note: 'دور مسحوب' }), errorCode('not_found'));
  db.prepare("UPDATE users SET role='manager' WHERE id='manager'").run();
  c = act('manager', c, 'approve_qualification', { note: 'تأهيل معتمد' });
  c = act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, quoteInput())), 'submit_quote');
  assert.throws(() => act('employee', c, 'approve_quote', { note: 'معد العرض' }), errorCode('commercial_transition'));
  db.prepare("UPDATE users SET manager_id='manager-other' WHERE id='employee'").run();
  assert.throws(() => act('manager', c, 'approve_quote', { note: 'مدير سابق' }), errorCode('not_found'));
  assert.throws(() => act('manager-other', c, 'approve_quote', { note: 'غير معين لهذه النسخة' }), errorCode('commercial_transition'));
});

test('CRM-06: quote rejection preserves the old version and requires approval of the replacement', t => {
  const { db, make, act, qualify } = fixture(t);
  const qualified = qualify(make());
  let c = act('employee', qualified, 'save_quote', boundQuote(db, qualified.id, quoteInput()));
  c = act('employee', c, 'submit_quote');
  const original = c.current_quote;
  assert.throws(() => act('employee', c, 'save_quote', quoteInput()), errorCode('commercial_transition'));
  c = act('manager', c, 'reject_quote', { note: 'نحتاج تعديل وصف النطاق' });
  const replacement = quoteInput(); replacement.scope = 'نطاق معدل قبل الاعتماد النهائي';
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, replacement));
  assert.equal(c.quotes.length, 2); assert.equal(c.quotes[0].snapshot.scope, original.snapshot.scope);
  assert.equal(c.current_quote.revision, 2);
  assert.throws(() => act('employee', c, 'register_contract', { agreement_evidence: 'دليل بدون اعتماد النسخة الثانية', customer_representative: 'عميل مصطنع' }), errorCode('commercial_transition'));
  c = act('manager', act('employee', c, 'submit_quote'), 'approve_quote', { note: 'اعتماد النسخة الثانية' });
  assert.throws(() => act('employee', c, 'save_quote', replacement), errorCode('commercial_transition'));
  assert.throws(() => db.prepare("UPDATE commercial_quotes SET snapshot='{}' WHERE id=?").run(c.current_quote.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM commercial_quotes WHERE id=?').run(original.id), /immutable/);
  const review = c.reviews.find(r => r.kind === 'quote' && r.subject_id === c.current_quote.id);
  assert.throws(() => db.prepare("UPDATE commercial_reviews SET status='rejected',note='تغيير سابق' WHERE id=?").run(review.id), /final/);
  assert.throws(() => db.prepare('DELETE FROM commercial_reviews WHERE id=?').run(review.id), /immutable/);
  assert.equal(verifyAudit(db), true);
});

test('CRM-06: decimal text, currency, dates, bounds and discounts are validated without floating arithmetic', t => {
  const { db, make, act, qualify } = fixture(t);
  const c = qualify(make());
  const invalid = [
    q => { q.lines[0].unit_price = 0.1; }, q => { q.lines[0].unit_price = '1e3'; },
    q => { q.lines[0].unit_price = '-1'; }, q => { q.lines[0].unit_price = '1.001'; },
    q => { q.lines[0].unit_price = '1,000'; }, q => { q.lines[0].discount = '1'; },
    q => { q.lines[0].tax_rate = '100.01'; }, q => { q.lines[0].quantity = '0'; },
    q => { q.lines[0].unit_price = '9999999999.99'; q.lines[0].quantity = '2'; },
    q => { q.currency = 'USD'; }, q => { q.currency = 'ZZZ'; },
    q => { q.valid_until = '2000-01-01'; }, q => { q.valid_until = '2099-02-30'; },
    q => { q.total_minor = '1'; }, q => { q.lines[0].revisions = -1; }, q => { q.lines = []; }
  ];
  for (const mutate of invalid) {
    const q = quoteInput(); mutate(q);
    assert.throws(() => act('employee', c, 'save_quote', q), error => error.status === 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_quotes').get().n, 0);
  assert.equal(db.prepare('SELECT version FROM commercial_cases').get().version, c.version);
});

test('ACC-01: admin, unrelated employees, other managers and tenant IDs cannot read or mutate client files', t => {
  const { users, db, make, act } = fixture(t);
  const c = make();
  for (const user of ['admin', 'outsider', 'manager-other', 'employee-other', 'external', 'pm-test', 'hr', 'it']) {
    assert.equal(listCommercial(db, users[user]).length, 0, user);
    assert.throws(() => act(user, c, 'qualify', qualificationInput()), errorCode('not_found'));
  }
  assert.throws(() => transaction(db, () => createLead(db, users.employee, { ...leadInput('SYNTH-400'), owner_id: 'outsider' })), errorCode('invalid_fields'));
  assert.throws(() => transaction(db, () => createLead(db, users.admin, leadInput('SYNTH-400'))), errorCode('commercial_role'));
  db.prepare("UPDATE users SET department_id='hr' WHERE id='employee'").run();
  assert.equal(listCommercial(db, users.employee).length, 0);
  assert.equal(listCommercial(db, users.manager).length, 0);
});

test('CRM-09/PMO-01: project creation rejects members outside the direct team and cannot precede agreement evidence', t => {
  const { db, make, act, qualify, approveQuote, contract } = fixture(t);
  const approved = approveQuote(qualify(make()));
  assert.throws(() => act('manager', approved, 'create_project', { member_ids: [] }), errorCode('commercial_transition'));
  assert.throws(() => act('employee', approved, 'register_contract', { agreement_evidence: '', customer_representative: 'عميل مصطنع' }), errorCode('invalid_text'));
  const c = contract(approved);
  for (const member of ['external', 'admin', 'manager-other', 'employee-other', 'hr']) {
    assert.throws(() => act('manager', c, 'create_project', { member_ids: [member] }), errorCode('member_scope'));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
  assert.throws(() => db.prepare("UPDATE commercial_contracts SET agreement_evidence='تعديل' WHERE id=?").run(c.contract.id), /immutable/);
});

test('ACC-01/08: member PM sees delivery scope without financial fields, and membership removal revokes access', t => {
  const { db, users, act, project } = fixture(t);
  let c = project();
  const view = listCommercial(db, users['pm-test'])[0];
  assert.equal(view.access, 'delivery'); assert.equal(view.current_quote.snapshot.lines.length, 2);
  const serialized = JSON.stringify(view);
  for (const field of ['total_minor', 'cost_minor', 'margin_minor', 'unit_price_minor', 'budget_minor', 'agreement_evidence', 'registration_number']) assert.equal(serialized.includes(field), false, field);
  db.prepare("UPDATE users SET department_id='hr' WHERE id='pm-test'").run();
  assert.equal(listCommercial(db, users['pm-test']).length, 0);
  db.prepare("UPDATE users SET department_id='creative' WHERE id='pm-test'").run();
  assert.throws(() => act('pm-test', c, 'create_change', changeInput()), errorCode('commercial_transition'));
  c = act('pm-test', c, 'submit_delivery', { line_index: 0, evidence: 'ملف مخرج مصطنع بإصدار أول للقبول' });
  assert.equal(c.deliveries.length, 1);
  assert.throws(() => act('pm-test', c, 'accept_delivery', { delivery_id: c.deliveries[0].id, note: 'قبول ذاتي', acceptance_evidence: 'دليل قبول ذاتي مصطنع', approver_id: approverFor(db, c.project_id) }), errorCode('commercial_transition'));
  db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id='pm-test'").run(c.project_id);
  assert.equal(listCommercial(db, users['pm-test']).length, 0);
  assert.throws(() => act('pm-test', c, 'submit_delivery', { line_index: 1, evidence: 'محاولة بعد سحب العضوية' }), errorCode('not_found'));
});

test('ACC-03/08: delivery acceptance uses the original contract line and independent evidence once', t => {
  const { db, act, project } = fixture(t);
  let c = project();
  assert.throws(() => act('employee', c, 'submit_delivery', { line_index: 20, evidence: 'مخرج خارج حدود نطاق العقد' }), errorCode('contract_line'));
  assert.throws(() => act('employee', c, 'submit_delivery', { line_index: 0, evidence: '' }), errorCode('invalid_text'));
  c = act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'نسخة المخرج الأصلية للاختبار' });
  const pending = c, deliveryId = c.deliveries[0].id;
  assert.throws(() => act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'تكرار النسخة ذاتها للاختبار' }), errorCode('delivery_exists'));
  assert.throws(() => act('manager', c, 'accept_delivery', { delivery_id: deliveryId, note: 'قبول مخرج', acceptance_evidence: '', approver_id: approverFor(db, c.project_id) }), errorCode('invalid_text'));
  c = act('manager', c, 'accept_delivery', { delivery_id: deliveryId, note: 'راجعنا معيار قبول البند', acceptance_evidence: 'محضر قبول محلي مصطنع للنسخة الأولى', approver_id: approverFor(db, c.project_id) });
  assert.equal(c.deliveries[0].review.status, 'approved');
  assert.equal(c.deliveries[0].review.evidence.internal_only, true);
  assert.throws(() => act('manager', pending, 'accept_delivery', { delivery_id: deliveryId, note: 'قبول مكرر', acceptance_evidence: 'محضر مكرر للقبول المحلي', approver_id: approverFor(db, c.project_id) }), errorCode('stale_version'));
  assert.throws(() => db.prepare("UPDATE commercial_deliveries SET evidence='تغيير' WHERE id=?").run(deliveryId), /immutable/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0);
  assert.equal(verifyAudit(db), true);
});

test('ACC-06/PMO-02: additional work becomes one task only after approval and leaves the baseline fixed', t => {
  const { db, act, project } = fixture(t);
  let c = project();
  const baseline = db.prepare('SELECT snapshot FROM commercial_project_baselines').get().snapshot;
  c = act('employee', c, 'create_change', changeInput());
  const changeId = c.changes[0].id;
  assert.equal(c.changes[0].snapshot.margin_delta_minor, '675');
  assert.throws(() => act('employee', c, 'start_change', { change_id: changeId }), errorCode('commercial_transition'));
  assert.throws(() => act('employee', c, 'approve_change', { change_id: changeId, note: 'اعتماد ذاتي' }), errorCode('commercial_transition'));
  c = act('manager', c, 'approve_change', { change_id: changeId, note: 'اعتماد أثر الوقت والتكلفة' });
  const approved = c;
  c = act('employee', c, 'start_change', { change_id: changeId });
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(c.changes[0].task_id);
  assert.equal(task.assignee_id, 'employee'); assert.equal(task.due_date, '2099-12-02');
  assert.equal(task.acceptance, changeInput().acceptance);
  assert.throws(() => act('employee', approved, 'start_change', { change_id: changeId }), errorCode('stale_version'));
  assert.throws(() => act('employee', c, 'start_change', { change_id: changeId }), errorCode('commercial_transition'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
  assert.equal(db.prepare('SELECT snapshot FROM commercial_project_baselines').get().snapshot, baseline);
  assert.throws(() => db.prepare("UPDATE commercial_changes SET snapshot='{}' WHERE id=?").run(changeId), /immutable/);
  assert.equal(verifyAudit(db), true);
});

test('ACC-06: rejected changes cannot start and a supplied decision cannot target another file', t => {
  const { db, make, act, qualify, approveQuote, contract } = fixture(t);
  const build = registration => act('manager', contract(approveQuote(qualify(make(registration)))), 'create_project', { member_ids: [] });
  let first = act('employee', build('SYNTH-A'), 'create_change', changeInput());
  let second = act('employee', build('SYNTH-B'), 'create_change', changeInput());
  const firstId = first.changes[0].id, secondId = second.changes[0].id;
  assert.throws(() => act('manager', first, 'approve_change', { change_id: secondId, note: 'معرف ملف آخر' }), errorCode('not_found'));
  first = act('manager', first, 'reject_change', { change_id: firstId, note: 'لا موافقة على العمل الإضافي' });
  assert.throws(() => act('employee', first, 'start_change', { change_id: firstId }), errorCode('commercial_transition'));
  second = act('manager', second, 'approve_change', { change_id: secondId, note: 'اعتماد نطاق الملف الثاني' });
  assert.equal(second.changes[0].review.status, 'approved');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0);
});

test('CRM-02: rejected qualification creates a new immutable submission before quoting', t => {
  const { db, make, act } = fixture(t);
  let c = act('employee', make(), 'qualify', qualificationInput());
  c = act('manager', c, 'reject_qualification', { note: 'الاحتياج يحتاج توضيحًا' });
  assert.throws(() => act('employee', c, 'save_quote', quoteInput()), errorCode('commercial_transition'));
  c = act('employee', c, 'qualify', { ...qualificationInput(), need: 'احتياج موضح في نسخة تأهيل ثانية' });
  assert.equal(c.qualifications.length, 2); assert.equal(c.qualifications[1].revision, 2);
  assert.notEqual(c.qualifications[0].snapshot.need, c.qualifications[1].snapshot.need);
  assert.throws(() => db.prepare("UPDATE commercial_qualifications SET snapshot='{}' WHERE id=?").run(c.current_qualification_id), /immutable/);
});

test('CRM-01/06: a failed audit rolls back business records and public mutations require a caller transaction', t => {
  const { db, users, make, act, qualify } = fixture(t);
  assert.throws(() => createLead(db, users.employee, leadInput()), errorCode('transaction_required'));
  const c = qualify(make());
  const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  db.exec("CREATE TEMP TRIGGER commercial_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='save_quote' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  assert.throws(() => act('employee', c, 'save_quote', boundQuote(db, c.id, quoteInput())), /synthetic audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_quotes').get().n, 0);
  assert.equal(db.prepare('SELECT version FROM commercial_cases').get().version, c.version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, auditCount);
  assert.equal(verifyAudit(db), true);
});

test('ACC-01: deactivated users and removed project owners cannot retain commercial mutation rights', t => {
  const { db, users, project, act } = fixture(t);
  const c = project();
  db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id='employee'").run(c.project_id);
  assert.throws(() => act('employee', c, 'create_change', changeInput()), errorCode('commercial_transition'));
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
  assert.throws(() => listCommercial(db, users.employee), errorCode('session_expired'));
  assert.equal(listCommercial(db, users.manager).length, 0);
});

test('CRM-06 UI: the quote form captures the target version and preserves decimal text and all existing lines', t => {
  const { users, db, make, qualify, act } = fixture(t);
  let c = qualify(make());
  const payload = quoteInput(); payload.lines.push(...structuredClone(payload.lines));
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, payload));
  const version = c.version, data = { rows: [c], user: users.employee, team: [] };
  const form = commercialUI.form('save_quote', c.id, data);
  assert.equal(form.fields.some(field => field.name === 'version'), false);
  assert.equal(form.fields.filter(field => /_description$/.test(field.name)).length, 4);
  const values = Object.fromEntries(form.fields.map(field => [field.name, String(field.value ?? '')]));
  c.version += 1;
  const submitted = form.toPayload(values);
  assert.equal(submitted.version, version);
  assert.equal(submitted.lines.length, 4);
  assert.equal(submitted.lines[0].unit_price, '0.10');
  assert.equal(submitted.lines[0].tax_rate, '15.00');
  assert.equal(submitted.lines[0].quantity, '3');
  assert.equal(submitted.lines[0].revisions, 2);
  assert.ok(form.endpoint.endsWith('/save_quote'));
  assert.equal(verifyAudit(db), true);
});

test('ACC-01 UI: PM rendering and submission use redacted data and escaped user content', t => {
  const { db, users, project } = fixture(t);
  project();
  const row = listCommercial(db, users['pm-test'])[0];
  row.name = '<script>unsafe</script>';
  const data = { rows: [row], user: users['pm-test'], team: [] };
  const e = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const html = commercialUI.render(data, { e, button: (action, id, label) => `<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>` });
  assert.equal(html.includes('<script>'), false); assert.ok(html.includes('&lt;script&gt;'));
  for (const text of ['التكلفة المقدرة', 'الإجمالي مع الضريبة', 'هامش', 'إضافة عميل محتمل']) assert.equal(html.includes(text), false, text);
  const form = commercialUI.form('submit_delivery', row.id, data);
  const payload = form.toPayload({ line_index: '1', evidence: 'دليل مصطنع من مدير المشروع' });
  assert.equal(payload.line_index, 1); assert.equal(payload.version, row.version);
  assert.throws(() => commercialUI.form('save_quote', row.id, data), /الإجراء غير متاح/);
});
