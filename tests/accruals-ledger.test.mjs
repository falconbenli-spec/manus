// الحزمة 3 — قسط الإطفاء المعتمد مصدرٌ للدفتر، وحالة ترحيله تُقرأ من الدفتر لا من نص ثابت. المسبار على 3d1d84c أثبت أن
// entryView يكتب «not_posted» ثابتًا لكل قسط، وأن القسط المعتمد لا نوع له في سجل الدفتر فلا قيد له إلا بإعادة كتابته يدويًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as f from '../app/finance.mjs';
import { journalFromSource, statements } from '../app/ledger.mjs';
import { sourceKind } from '../app/ledger-sources.mjs';
import { getSchedule, createSchedule, entryAction, accrualsBoard } from '../app/accruals.mjs';
import { accrualsUI } from '../app/static/cash-close-ui.mjs';

const code = value => error => error.code === value;
const helpers = { e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  button: (action, id, label) => `<button data-operation="${action}" data-id="${id}">${label}</button>`, money: m => m === null || m === undefined ? '—' : `${m / 100} SAR` };

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-accruals-ledger'); t.after(() => db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('accountant','36t','ops','accountant','محاسبة الإطفاء المصطنعة','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإطفاء المصطنع','unused','manager',NULL),('poster','36t','ops','poster','مرحّل مصطنع','unused','employee',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  for (const who of ['accountant', 'reviewer']) db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(), '36t', who, 'finance.close.manage', 'تصريح مصطنع للاختبار', 'admin', now());
  // من يعدّ القيد غير من يعتمده، والمرحّل غيرهما. والعكس يعدّه غير معدّ الأصل.
  for (const [who, actions] of [['accountant', ['read', 'configure', 'prepare']], ['reviewer', ['read', 'configure', 'approve', 'prepare', 'reverse']], ['poster', ['read', 'approve', 'post']]])
    for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مالي مصطنع', null, now());
  const tx = run => transaction(db, run);
  const reference = (kind, input) => tx(() => f.createFinanceReference(db, users.accountant, kind, input));
  const expense = reference('accounts', { code: 'ACC-EXP', name: 'اشتراكات برمجية مصطنعة', account_type: 'expense', currency: 'SAR' });
  const asset = reference('accounts', { code: 'ACC-PRE', name: 'مصروف مدفوع مقدمًا مصطنع', account_type: 'asset', currency: 'SAR' });
  const liability = reference('accounts', { code: 'ACC-ACR', name: 'مصروف مستحق مصطنع', account_type: 'liability', currency: 'SAR' });
  const centre = reference('cost_centers', { code: 'ACC-CC', name: 'مركز إطفاء مصطنع' });
  const period = reference('periods', { name: 'سنة الإطفاء المصطنعة', starts_on: '2026-01-01', ends_on: '2026-12-31' });
  const make = input => tx(() => createSchedule(db, users.accountant, { kind: 'prepaid', invoice_id: null, source_reference: 'SUB-2026-001', description: 'اشتراك برمجي سنوي مصطنع لفريق التصميم', amount: '1200.00',
    starts_on: '2026-01-01', ends_on: '2026-12-31', debit_account_id: expense.id, credit_account_id: asset.id, cost_center_id: centre.id, basis: 'عقد الاشتراك المصطنع يغطي اثني عشر شهرًا', ...input }));
  const approve = (entry, who = 'reviewer') => tx(() => entryAction(db, users[who], entry.id, 'approve_entry', { version: entry.version, note: 'راجعت العقد والفترة والمبلغ' }));
  const act = (who, j, action, values = {}) => tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, ...(action === 'reverse' ? {} : { note: 'قرار مالي مصطنع' }), ...values }));
  const journal = id => tx(() => journalFromSource(db, users.accountant, { source_kind: 'amortization_entry', source_id: id, period_id: period.id }));
  const lines = id => db.prepare('SELECT a.code,c.code AS centre,l.debit_minor,l.credit_minor FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY l.position').all(id).map(l => [l.code, l.centre, l.debit_minor, l.credit_minor]);
  return { db, users, tx, expense, asset, liability, centre, period, make, approve, act, journal, lines };
}
const entryOf = (x, schedule, key) => getSchedule(x.db, x.users.accountant, schedule.id).entries.find(e => e.period_key === key);

test('an approved monthly entry is a ledger source: the schedule’s own accounts and centre, at its month end, in halalas that add up', t => {
  const x = fixture(t);
  assert.equal(sourceKind('amortization_entry')?.module, 'accruals', 'the kind is registered from the accruals module');
  const s = x.make();
  const january = entryOf(x, s, '2026-01');
  assert.throws(() => x.journal(january.id), code('source_not_ready'), 'a proposed entry is not a source');
  x.approve(january);
  assert.ok(statements(x.db, x.users.reviewer).sources.some(p => p.source_kind === 'amortization_entry' && p.source_id === january.id && p.amount_minor === 10000 && p.date === '2026-01-31'));
  const j = x.journal(january.id);
  assert.deepEqual(x.lines(j.id), [['ACC-EXP', 'ACC-CC', 10000, 0], ['ACC-PRE', 'ACC-CC', 0, 10000]]);
  assert.equal(j.entry_date, '2026-01-31');
  assert.throws(() => x.journal(january.id), code('duplicate_source'));
  // الاستحقاق: مصروف مقابل التزام، بالحسابين اللذين اختارهما المحاسب.
  const accrual = x.make({ kind: 'accrual', credit_account_id: x.liability.id, source_reference: 'ACR-2026-001', description: 'كهرباء تحققت ولم تصل فاتورتها بعد', amount: '300.00', starts_on: '2026-02-01', ends_on: '2026-04-30' });
  const february = entryOf(x, accrual, '2026-02');
  x.approve(february);
  assert.deepEqual(x.lines(x.journal(february.id).id), [['ACC-EXP', 'ACC-CC', 10000, 0], ['ACC-ACR', 'ACC-CC', 0, 10000]]);
  assert.ok(verifyAudit(x.db));
});

test('the entry reports its real posting state from the ledger: waiting, in the ledger, posted, reversed', t => {
  const x = fixture(t);
  const s = x.make();
  const state = key => { const e = entryOf(x, s, key); return [e.posting_status, e.journal_status ?? null]; };
  x.approve(entryOf(x, s, '2026-01'));
  assert.deepEqual(state('2026-01'), ['not_posted', null]);
  assert.match(entryOf(x, s, '2026-01').posting_note, /لا ترحيل آلي/);
  let j = x.journal(entryOf(x, s, '2026-01').id);
  assert.deepEqual(state('2026-01'), ['in_ledger', 'draft']);
  j = x.act('accountant', j, 'submit'); j = x.act('reviewer', j, 'approve');
  assert.deepEqual(state('2026-01'), ['in_ledger', 'approved']);
  j = x.act('poster', j, 'post');
  assert.deepEqual(state('2026-01'), ['posted', 'posted']);
  assert.equal(entryOf(x, s, '2026-01').journal_id, j.id);
  let r = x.act('reviewer', j, 'reverse', { period_id: x.period.id, entry_date: '2026-01-31', reason: 'عكس قسط مصطنع لخطأ في الحساب', evidence: 'مذكرة تصحيح مصطنعة' });
  r = x.act('reviewer', r, 'submit'); r = x.act('poster', r, 'approve'); x.act('poster', r, 'post');
  assert.deepEqual(state('2026-01'), ['reversed', 'posted']);
  // القسط المقترح والملغى لا حالة ترحيل لهما غير «ما انرحّل»، ولا قيد.
  assert.deepEqual(state('2026-02'), ['not_posted', null]);
  const html = accrualsUI.render(accrualsBoard(x.db, x.users.accountant), helpers);
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(html.includes('انعكس'), 'the screen says the reversed month is reversed, not «not posted»');
  assert.ok(verifyAudit(x.db));
});
