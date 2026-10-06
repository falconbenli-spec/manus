// الحزمة 3 — فحوص الإقفال المحسوبة. المسبار على 3d1d84c أثبت أن approve_close يعتمد إقفال شهر فيه قيد غير مرحّل وحساب بنكي
// بلا تسوية معتمدة، لأنه لا يسأل إلا «هل نُفّذت المهام؟» والمهام نصّ حر. هنا أربعة فحوص تُحسب من الدفتر نفسه لكل إقفال:
// القيود، والمستندات بانتظار القيد، والتسوية البنكية لكل حساب نشط حتى آخر الشهر، والحسابات الرقابية في آخر الشهر.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping, approveMapping } from '../app/ledger.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import { closeBoard, getClosePeriod, createTemplate, openClosePeriod, taskAction, periodAction, closeChecks, CHECKS } from '../app/close-checklist.mjs';
import { closeChecklistUI } from '../app/static/cash-close-ui.mjs';

const code = value => error => error.code === value;
const helpers = { e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  button: (action, id, label) => `<button data-operation="${action}" data-id="${id}">${label}</button>`, money: m => m === null || m === undefined ? '—' : `${m / 100} SAR` };
const lastMonth = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const thrown = run => { try { run(); } catch (error) { return error; } assert.fail('expected a refusal'); };

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-close-checks'); t.after(() => db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('closer','36t','ops','closer','محاسب الإقفال المصطنع','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإقفال المصطنع','unused','manager',NULL),('explainer','36t','ops','explainer','مفسّر الفروق المصطنع','unused','manager',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const capability = (who, key) => db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)').run(randomUUID(), '36t', who, key, 'تصريح مصطنع للاختبار', 'admin', now());
  for (const who of ['closer', 'reviewer', 'explainer']) capability(who, 'finance.close.manage');
  capability('closer', 'bank.reconcile');
  for (const [who, actions] of [['closer', ['read', 'configure', 'prepare']], ['reviewer', ['read', 'configure', 'approve', 'post']], ['explainer', ['read', 'configure', 'approve', 'post']], ['employee', ['read', 'prepare']]])
    for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مالي مصطنع', null, now());
  const tx = run => transaction(db, run);
  const month = lastMonth(), [year, m] = month.split('-').map(Number), monthEnd = `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const financePeriod = tx(() => f.createFinanceReference(db, users.closer, 'periods', { name: `فترة ${month} المصطنعة`, starts_on: `${month}-01`, ends_on: monthEnd }));
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.reviewer, kind, input));
  const accounts = { expense: ref('accounts', { code: 'CK-EXP', name: 'مصروف مصطنع', account_type: 'expense', currency: 'SAR' }), liability: ref('accounts', { code: 'CK-LIA', name: 'التزام مصطنع', account_type: 'liability', currency: 'SAR' }),
    bank: ref('accounts', { code: 'CK-BNK', name: 'بنك مصطنع', account_type: 'asset', currency: 'SAR' }), receivable: ref('accounts', { code: 'CK-AR', name: 'ذمم عملاء مصطنعة', account_type: 'asset', currency: 'SAR' }) };
  const centre = ref('cost_centers', { code: 'CK-CC', name: 'مركز مصطنع' });
  const journal = (date, debit, credit, amount, reference, { post = true } = {}) => {
    let j = tx(() => f.createJournal(db, users.employee, { period_id: financePeriod.id, entry_date: date, description: `قيد مصطنع ${reference}`, evidence: 'دليل مصطنع', currency: 'SAR', source_reference: reference,
      lines: [{ account_id: debit.id, cost_center_id: centre.id, debit: amount, credit: '0', memo: 'مدين' }, { account_id: credit.id, cost_center_id: centre.id, debit: '0', credit: amount, memo: 'دائن' }] }));
    if (post) for (const [who, action] of [['employee', 'submit'], ['reviewer', 'approve'], ['reviewer', 'post']]) j = tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, note: 'قرار مالي مصطنع' }));
    return j;
  };
  tx(() => createTemplate(db, users.closer, { title: 'مطابقة كشف البنك المصطنع', owner_id: 'closer', due_day: 5, basis: 'قرار مالك إجراء الإقفال المصطنع لهذه المهمة' }));
  const opened = tx(() => openClosePeriod(db, users.closer, { period_key: month, finance_period_id: financePeriod.id }));
  const task = getClosePeriod(db, users.closer, opened.id).tasks[0];
  tx(() => taskAction(db, users.closer, task.id, 'complete_task', { version: task.version, evidence: 'طابقت الكشف المصطنع وحفظت الدليل' }));
  const view = (who = 'reviewer') => getClosePeriod(db, users[who], opened.id);
  const approve = (who = 'reviewer') => tx(() => periodAction(db, users[who], opened.id, 'approve_close', { version: view(who).version, note: 'راجعت كل مهمة ودليلها وفحوص الإقفال' }));
  const custody = (reference, minor, date) => db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,'issued',?,?,?,?,?,'',?,?)")
    .run(randomUUID(), '36t', 'outsider', minor, 'عهدة مصطنعة للاختبار', 'reviewer', `${date}T00:00:00.000Z`, date, reference, 'reviewer', now(), now());
  const mapPurpose = (purpose, account) => { const { id } = tx(() => recordMapping(db, users.closer, { purpose, account_id: account.id, cost_center_id: centre.id, effective_from: '2026-01-01' }));
    tx(() => approveMapping(db, users.reviewer, id, { note: 'طابقت الحساب المصطنع' })); };
  return { db, users, tx, month, monthEnd, financePeriod, accounts, centre, journal, period: opened, view, approve, custody, mapPurpose };
}
const check = (period, key) => period.checks.checks.find(c => c.key === key);

test('an empty month passes all four system checks, each named on the close screen, and the close is approved as before', t => {
  const x = fixture(t);
  const p = x.view();
  assert.deepEqual(p.checks.checks.map(c => c.key), ['journals', 'sources', 'bank', 'controls']);
  assert.deepEqual(p.checks.checks.map(c => c.name), Object.values(CHECKS));
  assert.ok(p.checks.passed && p.checks.checks.every(c => c.passed && c.items.length === 0));
  const html = closeChecklistUI.render(closeBoard(x.db, x.users.reviewer), helpers);
  for (const name of Object.values(CHECKS)) assert.ok(html.includes(name), `the screen shows «${name}» even when it passes`);
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.equal(x.approve().status, 'approved');
});

test('approve_close refuses, naming each item and its owner: an unposted journal, a document waiting for its journal, an unreconciled bank account, an unexplained control difference', t => {
  const x = fixture(t);
  x.journal(`${x.month}-20`, x.accounts.expense, x.accounts.liability, '10.00', 'DRAFT-IN-MONTH', { post: false });
  x.custody('CUST-IN-MONTH', 25000, `${x.month}-12`);
  x.mapPurpose('receivable', x.accounts.receivable);
  x.journal(`${x.month}-15`, x.accounts.receivable, x.accounts.liability, '40.00', 'AR-MANUAL');
  x.tx(() => bank.createBankAccount(x.db, x.users.closer, { label: 'حساب بلا تسوية', bank_name: 'بنك مصطنع', account_tail: '1111', gl_account_id: x.accounts.bank.id }));
  x.journal(`${x.month}-03`, x.accounts.bank, x.accounts.liability, '100.00', 'BANK-ACTIVITY');
  const p = x.view();
  assert.deepEqual(p.checks.checks.map(c => [c.key, c.passed]), [['journals', false], ['sources', false], ['bank', false], ['controls', false]], 'every check is on the screen with its result');
  assert.deepEqual(check(p, 'journals').items.map(i => [i.reference, i.status]), [['DRAFT-IN-MONTH', 'draft']]);
  assert.deepEqual(check(p, 'sources').items.map(i => [i.source_kind, i.reference, i.amount_minor]), [['custody_issue', 'CUST-IN-MONTH', 25000]]);
  assert.deepEqual(check(p, 'bank').items.map(i => [i.label, i.last_reconciled_to]), [['حساب بلا تسوية', null]]);
  assert.deepEqual(check(p, 'controls').items.map(i => [i.purpose, i.reason, i.amount_minor, i.explained]), [['receivable', 'no_document', -4000, false]]);
  assert.ok(p.actions.includes('approve_close'), 'the approver is offered the decision and told why it will be refused, not a silent missing button');
  assert.match(p.blocked_reason, /فحوص/);
  const refusal = thrown(() => x.approve());
  assert.equal(refusal.code, 'close_checks_failed');
  const missing = refusal.details.refusal.missing;
  assert.equal(missing.length, 4);
  for (const text of ['DRAFT-IN-MONTH', 'CUST-IN-MONTH', 'حساب بلا تسوية', 'AR-MANUAL']) assert.ok(missing.some(item => item.document.includes(text)), `the refusal names ${text}`);
  assert.ok(missing.every(item => item.owner && item.owner_role === 'finance'), 'every item names who owns it');
  assert.equal(x.db.prepare('SELECT status FROM finance_periods WHERE id=?').get(x.financePeriod.id).status, 'open', 'nothing was locked');
  assert.equal(x.view().status, 'open');
  assert.ok(verifyAudit(x.db));
});

test('a control difference is explained in writing on the close; whoever explains it does not approve it; a changed amount needs a new explanation', t => {
  const x = fixture(t);
  x.mapPurpose('receivable', x.accounts.receivable);
  x.journal(`${x.month}-15`, x.accounts.receivable, x.accounts.liability, '40.00', 'AR-OPENING');
  let p = x.view('explainer');
  const item = check(p, 'controls').items[0];
  assert.equal(item.explainable, true);
  assert.ok(p.actions.includes('explain_exception'));
  const explain = (who, input) => x.tx(() => periodAction(x.db, x.users[who], x.period.id, 'explain_exception', { version: x.view(who).version, ...input }));
  assert.throws(() => explain('explainer', { item_key: 'controls:receivable:nothing', note: 'تفسير لبند غير موجود في الفحص' }), code('exception_not_found'));
  assert.throws(() => explain('explainer', { item_key: item.key, note: 'قصير' }), code('invalid_text'));
  explain('explainer', { item_key: item.key, note: 'قيد رصيد افتتاحي لذمم العملاء نُقل من الدفاتر السابقة ويُسوّى بمستنداته لاحقًا' });
  assert.throws(() => explain('explainer', { item_key: item.key, note: 'تفسير مكرر لنفس البند بنفس المبلغ في هذا الإقفال' }), code('exception_explained'));
  p = x.view();
  assert.equal(check(p, 'controls').passed, true, 'an explained difference passes the check');
  assert.equal(check(p, 'controls').items[0].explanation.recorded_by, 'explainer');
  // من فسّر لا يعتمد: التفسير تنفيذٌ في الإقفال كالمهمة.
  assert.ok(!x.view('explainer').actions.includes('approve_close'));
  assert.throws(() => x.approve('explainer'), code('invalid_state'));
  assert.throws(() => x.db.prepare("UPDATE close_periods SET status='approved',approved_by='explainer',approved_at=?,approval_note='التفاف على الفصل المكتوب',version=version+1 WHERE id=?").run(now(), x.period.id), /does not approve/);
  // الرقم يتغيّر فيسقط التفسير: فرقٌ جديد بمبلغ جديد يحتاج تفسيره.
  x.journal(`${x.month}-16`, x.accounts.receivable, x.accounts.liability, '5.00', 'AR-SECOND');
  assert.equal(check(x.view(), 'controls').passed, false);
  assert.throws(() => x.db.prepare("UPDATE close_explanations SET explanation='تفسير مبدّل بصمت بعد التسجيل' WHERE period_id=?").run(x.period.id), /not an edit/);
  assert.throws(() => x.db.prepare('DELETE FROM close_explanations WHERE period_id=?').run(x.period.id), /not an edit/);
  assert.ok(verifyAudit(x.db));
});

test('the checks read their own month and tenant only: what belongs to another month or entity does not block, and the pure function agrees with the screen', t => {
  const x = fixture(t);
  const [year, m] = x.month.split('-').map(Number), next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
  x.custody('CUST-NEXT-MONTH', 25000, `${next}-02`);
  const direct = closeChecks(x.db, '36t', { from: `${x.month}-01`, to: x.monthEnd, finance_period_id: x.financePeriod.id });
  assert.equal(direct.passed, true, 'a document dated next month does not block this month');
  assert.deepEqual(direct.checks.map(c => c.passed), x.view().checks.checks.map(c => c.passed));
  const other = closeChecks(x.db, 'isolated', { from: `${x.month}-01`, to: x.monthEnd });
  assert.ok(other.passed && other.checks.every(c => c.items.length === 0));
  assert.throws(() => getClosePeriod(x.db, x.users.external, x.period.id), code('not_found'));
  assert.equal(x.approve().status, 'approved');
});
