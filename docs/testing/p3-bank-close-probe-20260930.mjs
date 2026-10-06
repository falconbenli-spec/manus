// Package 3 — bank reconciliation and month-end close: gap probe on the unchanged integration head 3d1d84c.
// Synthetic in-memory databases only. Run from the repository root with the pinned engine:
//   work/node24/bin/node docs/testing/p3-bank-close-probe-20260930.mjs
// Every line printed is a measurement, not a claim; the reading at the bottom of the output file says what each shows.
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../../app/db.mjs';
import { seed } from '../../scripts/seed.mjs';
import { grantAccess } from '../../app/access.mjs';
import * as f from '../../app/finance.mjs';
import * as bank from '../../app/bank-reconciliation.mjs';
import * as ledger from '../../app/ledger.mjs';
import { sourceKinds } from '../../app/ledger-sources.mjs';
import * as close from '../../app/close-checklist.mjs';
import * as accruals from '../../app/accruals.mjs';
import { paymentAction } from '../../app/payables.mjs';
import { ledgerMonth } from '../../tests/ledger-fixture.mjs';

const say = (label, value) => console.log(label, typeof value === 'string' ? value : JSON.stringify(value));
const outcome = run => { try { const v = run(); return v?.id ? 'ok' : v; } catch (error) { return `refused:${error.code ?? ''}${error.code === 'ERR_SQLITE_ERROR' ? ` (${error.message})` : ''}`; } };
const fakeT = { after() {} };

function bankBase(tag) {
  const db = openDb(':memory:'); seed(db, `synthetic-probe-${tag}`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = run => transaction(db, run);
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']]) tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مطابقة مصطنع للمسبار' }));
  for (const [who, actions] of [['employee', ['read', 'configure', 'prepare']], ['manager', ['read', 'approve', 'post', 'configure']]]) for (const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مصطنع للمسبار', null, now());
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.employee, kind, input));
  const gl = ref('accounts', { code: '1000', name: 'بنك مصطنع', account_type: 'asset', currency: 'SAR' });
  const equity = ref('accounts', { code: '3000', name: 'رأس مال مصطنع', account_type: 'equity', currency: 'SAR' });
  const expense = ref('accounts', { code: '5100', name: 'رسوم بنكية مصطنعة', account_type: 'expense', currency: 'SAR' });
  const centre = ref('cost_centers', { code: 'GEN', name: 'عام' });
  const period = ref('periods', { name: 'سنة المسبار', starts_on: '2026-01-01', ends_on: '2026-12-31' });
  const journal = (date, debit, credit, amount, reference) => {
    let j = tx(() => f.createJournal(db, users.employee, { period_id: period.id, entry_date: date, description: `قيد مصطنع ${reference}`, evidence: 'دليل مصطنع للمسبار', currency: 'SAR', source_reference: reference,
      lines: [{ account_id: debit.id, cost_center_id: centre.id, debit: amount, credit: '0', memo: 'مدين' }, { account_id: credit.id, cost_center_id: centre.id, debit: '0', credit: amount, memo: 'دائن' }] }));
    for (const [who, action] of [['employee', 'submit'], ['manager', 'approve'], ['manager', 'post']]) j = tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, note: 'قرار مصطنع للمسبار' }));
    return j;
  };
  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'حساب المسبار', bank_name: 'بنك مصطنع', account_tail: '4321', gl_account_id: gl.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف المسبار', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  const load = (rows, opening, closing) => tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: `probe-${tag}.csv`, period_start: '2026-08-01', period_end: '2026-08-31',
    opening_balance: opening, closing_balance: closing, content: ['date,description,reference,debit,credit', ...rows].join('\n') }));
  const line = text => db.prepare('SELECT * FROM bank_transactions WHERE description LIKE ?').get(`%${text}%`);
  return { db, users, tx, gl, equity, expense, centre, period, account, journal, load, line };
}

/* G1 — a classified bank fee has no journal, and posting the charge leaves a difference equal to it */
{
  const b = bankBase('fee');
  b.journal('2026-07-31', b.gl, b.equity, '10000.00', 'OPEN-PROBE');
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], '10000.00', '9975.00');
  const fee = b.line('رسوم');
  const m = b.tx(() => bank.proposeMatch(b.db, b.users.employee, { transaction_id: fee.id, kind: 'unmatched', source_kind: null, source_id: null, unmatched_reason: 'bank_fee', rationale: 'رسوم شهرية بلا سجل مقابل في المنصة' }));
  b.tx(() => bank.decideMatch(b.db, b.users.manager, m.id, 'approve', { version: 1, note: 'راجعت الرسوم' }));
  const ask = { bank_account_id: b.account.id, period_start: '2026-08-01', period_end: '2026-08-31' };
  say('G1 ledger kinds for a classified bank line:', sourceKinds().map(k => k.key).filter(k => /bank|fee|interest/.test(k)));
  say('G1 PURPOSES has bank_charges / interest_income:', ['bank_charges', 'interest_income'].map(k => ledger.PURPOSES.some(p => p.key === k)));
  const before = bank.reconciliationStatement(b.db, b.users.employee, ask);
  say('G1 before posting the charge [unmatched_bank, book, difference]:', [before.unmatched_bank_minor, before.book_balance_minor, before.difference_minor]);
  b.journal('2026-08-05', b.expense, b.gl, '25.00', 'FEE-08-GL');
  const after = bank.reconciliationStatement(b.db, b.users.employee, ask);
  say('G1 after posting the charge in the GL [unmatched_bank, book, difference]:', [after.unmatched_bank_minor, after.book_balance_minor, after.difference_minor]);
}

/* G2 — matching is exact 1:1; a manual bank journal cannot be matched; six kinds only */
{
  const b = bankBase('match');
  const custody = (reference, minor) => { const id = randomUUID();
    b.db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,'issued',?,?,?,?,?,'',?,?)")
      .run(id, '36t', 'outsider', minor, 'عهدة مصطنعة للمسبار', 'manager', '2026-08-01T00:00:00.000Z', '2026-08-10', reference, 'manager', now(), now()); return id; };
  const a = custody('CUST-A', 100000); custody('CUST-B', 50000);
  const opening = b.journal('2026-08-12', b.gl, b.equity, '300.00', 'DEP-MANUAL');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,', '2026-08-12,إيداع يدوي,DEP-MANUAL,,300.00'], '10000.00', '8800.00');
  const bulk = b.line('مجمعتين'), deposit = b.line('إيداع');
  say('G2 1500 line against a 1000 record:', outcome(() => b.tx(() => bank.proposeMatch(b.db, b.users.employee, { transaction_id: bulk.id, kind: 'record', source_kind: 'custody_issue', source_id: a, unmatched_reason: null, rationale: 'محاولة مطابقة جزء من سطر مجمّع' }))));
  say('G2 suggestions for the 1500 line:', bank.suggestMatches(b.db, b.users.employee, bulk.id, {}).candidates.length);
  say('G2 manual bank journal as a match:', outcome(() => b.tx(() => bank.proposeMatch(b.db, b.users.employee, { transaction_id: deposit.id, kind: 'journal', source_kind: null, source_id: opening.id, unmatched_reason: null, rationale: 'قيد يدوي على حساب البنك' }))));
  say('G2 advance_receipt as a match kind:', outcome(() => b.tx(() => bank.proposeMatch(b.db, b.users.employee, { transaction_id: deposit.id, kind: 'record', source_kind: 'advance_receipt', source_id: randomUUID(), unmatched_reason: null, rationale: 'قبض دفعة مقدمة مصطنع' }))));
  say('G2 SOURCE_KINDS:', Object.keys(bank.SOURCE_KINDS));
  say('G2 bank_matches CHECK:', /source_kind IN \([^)]*\)/.exec(b.db.prepare("SELECT sql FROM sqlite_master WHERE name='bank_matches'").get().sql)[0]);
}

/* G3 — cashRecords does not list a returned supplier payment (nor an advance receipt) */
{
  const m = ledgerMonth(fakeT);
  const { payable, invoice } = m.matchedPayable({ gross: '1150.00' }); m.inputTax(invoice.id, '150.00');
  const order = m.pay(payable.id);
  m.tx(() => paymentAction(m.db, m.users.outsider, order.id, 'record_return', { version: order.version, returned_on: m.day, bank_reference: 'RET-PROBE-1', credited: '1140.00', reason: 'رجع التحويل لأن حساب المورد مقفل', evidence: 'إشعار مرتجع بنكي مصطنع' }));
  m.paidAdvance({ amount: '500.00' });
  const kinds = bank.cashRecords(m.db, '36t', '0000-01-01', '9999-12-31').map(r => r.source_kind);
  say('G3 payment_returns rows:', m.db.prepare('SELECT COUNT(*) n FROM payment_returns').get().n);
  say('G3 cashRecords kinds:', [...new Set(kinds)]);
  say('G3 supplier_payment_return registered as a ledger kind:', sourceKinds().some(k => k.key === 'supplier_payment_return'));
}

/* G4 — the ledger period never reopens */
function closeBase(tag) {
  const db = openDb(':memory:'); seed(db, `synthetic-probe-${tag}`);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('closer','36t','ops','closer','محاسب مصطنع','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع مصطنع','unused','manager',NULL),('third','36t','ops','third','ثالث مصطنع','unused','manager',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = run => transaction(db, run);
  for (const who of ['closer', 'reviewer', 'third']) db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)').run(randomUUID(), '36t', who, 'finance.close.manage', 'تصريح مصطنع', 'admin', now());
  for (const [who, actions] of [['closer', ['read', 'configure', 'prepare']], ['reviewer', ['read', 'configure', 'approve', 'post']], ['third', ['read', 'configure']], ['employee', ['read', 'prepare']]]) for (const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مصطنع', null, now());
  const fp = tx(() => f.createFinanceReference(db, users.closer, 'periods', { name: 'أغسطس المسبار', starts_on: '2026-08-01', ends_on: '2026-08-31' }));
  tx(() => close.createTemplate(db, users.closer, { title: 'مطابقة كشف البنك المصطنع', owner_id: 'closer', due_day: 5, basis: 'قرار مالك الإجراء المصطنع' }));
  const opened = tx(() => close.openClosePeriod(db, users.closer, { period_key: '2026-08', finance_period_id: fp.id }));
  const p = close.getClosePeriod(db, users.closer, opened.id);
  tx(() => close.taskAction(db, users.closer, p.tasks[0].id, 'complete_task', { version: p.tasks[0].version, evidence: 'طابقت الكشف المصطنع' }));
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.reviewer, kind, input));
  const expense = ref('accounts', { code: 'EXP', name: 'مصروف مصطنع', account_type: 'expense', currency: 'SAR' }), liability = ref('accounts', { code: 'LIA', name: 'التزام مصطنع', account_type: 'liability', currency: 'SAR' });
  const bankGl = ref('accounts', { code: 'BNK', name: 'بنك مصطنع', account_type: 'asset', currency: 'SAR' }), centre = ref('cost_centers', { code: 'CC', name: 'مركز مصطنع' });
  const draft = () => tx(() => f.createJournal(db, users.employee, { period_id: fp.id, entry_date: '2026-08-20', description: 'قيد مصطنع داخل الشهر', evidence: 'دليل مصطنع', currency: 'SAR', source_reference: randomUUID(),
    lines: [{ account_id: expense.id, cost_center_id: centre.id, debit: '10.00', credit: '0', memo: 'م' }, { account_id: liability.id, cost_center_id: centre.id, debit: '0', credit: '10.00', memo: 'د' }] }));
  return { db, users, tx, fp, period: opened, draft, bankGl };
}
{
  const c = closeBase('reopen');
  const approve = () => c.tx(() => close.periodAction(c.db, c.users.reviewer, c.period.id, 'approve_close', { version: close.getClosePeriod(c.db, c.users.reviewer, c.period.id).version, note: 'راجعت كل مهمة ودليلها' }));
  approve();
  say('G4 finance period after approve_close:', c.db.prepare('SELECT status,version FROM finance_periods WHERE id=?').get(c.fp.id));
  say('G4 financeReferenceAction reopen:', outcome(() => c.tx(() => f.financeReferenceAction(c.db, c.users.reviewer, 'periods', c.fp.id, 'reopen', { version: 2, note: 'فتح مباشر' }))));
  say('G4 direct UPDATE closed→open:', outcome(() => c.db.prepare("UPDATE finance_periods SET status='open',version=version+1 WHERE id=?").run(c.fp.id)));
  let s = c.tx(() => close.periodAction(c.db, c.users.closer, c.period.id, 'request_reopen', { version: close.getClosePeriod(c.db, c.users.closer, c.period.id).version, reason: 'وصلت فاتورة تخص الشهر' }));
  s = c.tx(() => close.periodAction(c.db, c.users.third, c.period.id, 'approve_reopen', { version: s.version, note: 'أقر بالفتح لأن الفاتورة تخص الشهر' }));
  say('G4 checklist after approve_reopen [status, ledger_locked]:', [s.status, s.ledger_locked]);
  say('G4 finance period after the checklist reopen:', c.db.prepare('SELECT status FROM finance_periods WHERE id=?').get(c.fp.id).status);
  say('G4 adjustment dated inside the reopened month:', outcome(() => c.draft()));
}

/* G5 — approve_close checks tasks only */
{
  const c = closeBase('checks');
  c.draft();
  c.db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)').run(randomUUID(), '36t', 'closer', 'bank.reconcile', 'تصريح مصطنع', 'admin', now());
  c.tx(() => bank.createBankAccount(c.db, c.users.closer, { label: 'حساب بلا تسوية', bank_name: 'بنك مصطنع', account_tail: '1111', gl_account_id: c.bankGl.id }));
  say('G5 unposted journals dated in the month:', c.db.prepare("SELECT COUNT(*) n FROM finance_journals WHERE entry_date BETWEEN '2026-08-01' AND '2026-08-31' AND status<>'posted'").get().n);
  say('G5 active bank accounts with an approved reconciliation:', c.db.prepare("SELECT COUNT(*) n FROM bank_reconciliations WHERE status='approved'").get().n);
  const approved = outcome(() => c.tx(() => close.periodAction(c.db, c.users.reviewer, c.period.id, 'approve_close', { version: close.getClosePeriod(c.db, c.users.reviewer, c.period.id).version, note: 'راجعت كل مهمة ودليلها' })));
  say('G5 approve_close with an unposted journal and an unreconciled bank account:', approved?.status ?? approved);
  say('G5 close period carries system checks:', Object.keys(close.getClosePeriod(c.db, c.users.reviewer, c.period.id)).filter(k => /check/.test(k)));
}

/* G6 — accruals: posting status is a constant, and approved entries have no ledger kind */
{
  const db = openDb(':memory:'); seed(db, 'synthetic-probe-accruals');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('accountant','36t','ops','accountant','محاسبة مصطنعة','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع مصطنع','unused','manager',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = run => transaction(db, run);
  for (const who of ['accountant', 'reviewer']) db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)').run(randomUUID(), '36t', who, 'finance.close.manage', 'تصريح مصطنع', 'admin', now());
  for (const action of ['read', 'configure']) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', 'accountant', 'employee', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مصطنع', null, now());
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.accountant, kind, input));
  const expense = ref('accounts', { code: 'E', name: 'مصروف مصطنع', account_type: 'expense', currency: 'SAR' }), asset = ref('accounts', { code: 'P', name: 'مدفوع مقدمًا مصطنع', account_type: 'asset', currency: 'SAR' }), centre = ref('cost_centers', { code: 'C', name: 'مركز' });
  const s = tx(() => accruals.createSchedule(db, users.accountant, { kind: 'prepaid', invoice_id: null, source_reference: 'SUB-PROBE', description: 'اشتراك مصطنع للمسبار', amount: '1200.00', starts_on: '2026-01-01', ends_on: '2026-12-31',
    debit_account_id: expense.id, credit_account_id: asset.id, cost_center_id: centre.id, basis: 'عقد مصطنع يغطي سنة' }));
  const first = accruals.getSchedule(db, users.reviewer, s.id).entries[0];
  const after = tx(() => accruals.entryAction(db, users.reviewer, first.id, 'approve_entry', { version: first.version, note: 'راجعت العقد' }));
  say('G6 approved entry [status, posting_status]:', [after.entries[0].status, after.entries[0].posting_status]);
  say('G6 the code path for posting_status:', /posting_status:'not_posted'/.test((await import('node:fs')).readFileSync(new URL('../../app/accruals.mjs', import.meta.url), 'utf8')) ? "constant 'not_posted' in entryView" : 'computed');
  say('G6 amortization entry registered as a ledger kind:', sourceKinds().some(k => /amort/.test(k.key)));
}
