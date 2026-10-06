// الحزمة 3 — شهر مصطنع كامل من المستند إلى الإقفال وإعادة الإقفال، بالمسارات الحقيقية لا بصفوف مكتوبة باليد:
// مستندات تُقيَّد وتُرحَّل، وكشف CSV يُستورد، ومطابقات (منها مجمّعة ومجزّأة وقيد يدوي) تتسوّى بفرق صفر مع رسوم بنك مرحّلة،
// والشهر يُقفل وكل فحوص الإقفال خضراء، ثم يُفتح بالمسار المعتمد، ويأخذ قيد تسوية بتاريخه، ويُعاد إقفاله.
//
// الساعة مجمَّدة على آخر يوم في أغسطس 2026 (t.mock.timers): التسوية البنكية «حتى آخر الشهر» لا تُعدّ قبل أن ينتهي الشهر،
// لأن الكشف لا يُستورد لتاريخ لم يأتِ. بتجميد الساعة على آخر يوم يصير الشهر كله ماضيًا، والاختبار لا يتوقف على يوم تشغيله.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import * as ledger from '../app/ledger.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import { adoptionAction } from '../app/options.mjs';
import { getClosePeriod, createTemplate, openClosePeriod, taskAction, periodAction, RECLOSE_DAYS } from '../app/close-checklist.mjs';
import { ledgerMonth, code } from './ledger-fixture.mjs';

const FROZEN = Date.parse('2026-08-31T09:00:00.000Z');

test('a synthetic month: documents post, a CSV statement imports, grouped and split matches reconcile to zero with a posted bank fee, the month closes green, reopens through the approved path, takes a dated adjustment, and re-closes', { timeout: 120000 }, t => {
  t.mock.timers.enable({ apis: ['Date'], now: FROZEN });
  const m = ledgerMonth(t);
  assert.equal(m.day, '2026-08-31');
  const tx = m.tx, db = m.db, u = m.users;
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve'], ['employee', 'finance.close.manage'], ['manager', 'finance.close.manage'], ['outsider', 'finance.close.manage'], ['hr', 'finance.close.manage']])
    tx(() => grantAccess(db, u.admin, { user_id: who, capability, note: 'تصريح مصطنع لشهر الاختبار الكامل' }));
  const account = (c, name, type) => tx(() => f.createFinanceReference(db, u.manager, 'accounts', { code: c, name, account_type: type, currency: 'SAR' }));
  const charges = account('5300', 'رسوم بنكية مصطنعة', 'expense'), accrued = account('2500', 'مصروفات مستحقة مصطنعة', 'liability');
  const { id: mapping } = tx(() => ledger.recordMapping(db, u.employee, { purpose: 'bank_charges', account_id: charges.id, cost_center_id: m.centres.GEN.id, effective_from: '2026-01-01' }));
  tx(() => ledger.approveMapping(db, u.manager, mapping, { note: 'طابقت حساب الرسوم المصطنع' }));

  // ── المستندات وقيودها ──
  const capital = m.post(tx(() => f.createJournal(db, u.employee, { period_id: m.period.id, entry_date: '2026-08-01', description: 'إيداع رأس مال مصطنع', evidence: 'محضر إيداع مصطنع', currency: 'SAR', source_reference: 'CAP-OPEN',
    lines: [{ account_id: m.accounts.bank.id, cost_center_id: m.centres.GEN.id, debit: '10000.00', credit: '0', memo: 'إيداع' }, { account_id: m.accounts.retained_earnings.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '10000.00', memo: 'رأس المال' }] })));
  const p1 = m.matchedPayable({ gross: '1150.00' }); m.inputTax(p1.invoice.id, '150.00');
  const p2 = m.matchedPayable({ gross: '1150.00' }); m.inputTax(p2.invoice.id, '150.00');
  for (const p of [p1, p2]) m.post(m.journal('supplier_invoice', p.payable.id));
  const [o1, o2] = [m.pay(p1.payable.id), m.pay(p2.payable.id)];
  for (const o of [o1, o2]) m.post(m.journal('supplier_payment', o.id));
  const ar = m.issuedInvoice({ amount: '115.00' });
  m.post(m.journal('tax_invoice', ar.invoice.id));
  const receipt = ar.receipt('115.00');
  m.post(m.journal('ar_receipt', receipt.id));
  const advance = m.paidAdvance({ amount: '500.00', reference: 'TRF-ADV-M' });
  m.post(m.journal('advance_receipt', advance.id));

  // ── الكشف والمطابقة ──
  const bankAccount = tx(() => bank.createBankAccount(db, u.employee, { label: 'الحساب التشغيلي للشهر المصطنع', bank_name: 'بنك مصطنع', account_tail: '2468', gl_account_id: m.accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, u.employee, { bank_account_id: bankAccount.id, name: 'كشف الشهر المصطنع', delimiter: 'comma', date_format: 'DD/MM/YYYY', header_rows: 1,
    columns: { date: 'التاريخ', description: 'البيان', reference: 'المرجع', debit: 'مدين', credit: 'دائن' } }));
  const csv = ['التاريخ,البيان,المرجع,مدين,دائن',
    '01/08/2026,إيداع رأس مال,CAP-OPEN,,"10,000.00"',
    `31/08/2026,تحويل مجمع لموردين,BULK-0831,"2,300.00",`,
    `31/08/2026,حوالة عميل دفعة أولى,${receipt.reference},,60.00`,
    `31/08/2026,حوالة عميل دفعة ثانية,${receipt.reference},,55.00`,
    '31/08/2026,قبض دفعة مقدمة,TRF-ADV-M,,500.00',
    '31/08/2026,رسوم خدمات بنكية,FEE-0831,25.00,'].join('\n');
  const statement = tx(() => bank.importStatement(db, u.employee, { profile_id: profile.id, file_name: 'statement-2026-08.csv', content: csv, period_start: '2026-08-01', period_end: '2026-08-31', opening_balance: '0.00', closing_balance: '8,290.00' }));
  assert.equal(statement.row_count, 6);
  const line = text => db.prepare('SELECT * FROM bank_transactions WHERE description=?').get(text);
  const matched = input => { const p = tx(() => bank.proposeMatch(db, u.employee, { kind: 'record', unmatched_reason: null, rationale: 'المبلغ والمرجع يطابقان السجل المصطنع', ...input }));
    tx(() => bank.decideMatch(db, u.manager, p.id, 'approve', { version: 1, note: 'راجعت إشعار البنك المصطنع' })); return p; };
  matched({ transaction_id: line('إيداع رأس مال').id, journal_id: capital.id });
  const grouped = matched({ transaction_id: line('تحويل مجمع لموردين').id, members: [{ source_kind: 'supplier_payment', source_id: o1.id }, { source_kind: 'supplier_payment', source_id: o2.id }] });
  const split = matched({ transaction_ids: [line('حوالة عميل دفعة أولى').id, line('حوالة عميل دفعة ثانية').id], source_kind: 'ar_receipt', source_id: receipt.id });
  matched({ transaction_id: line('قبض دفعة مقدمة').id, source_kind: 'advance_receipt', source_id: advance.id });
  assert.deepEqual(db.prepare('SELECT shape FROM bank_matches WHERE id IN (?,?) ORDER BY shape').all(grouped.id, split.id).map(r => r.shape), ['group', 'split']);
  const fee = tx(() => bank.proposeMatch(db, u.employee, { transaction_id: line('رسوم خدمات بنكية').id, kind: 'unmatched', source_kind: null, source_id: null, unmatched_reason: 'bank_fee', rationale: 'رسوم شهرية بلا سجل مقابل في المنصة' }));
  tx(() => bank.decideMatch(db, u.manager, fee.id, 'approve', { version: 1, note: 'راجعت إشعار الرسوم المصطنع' }));
  const feeJournal = m.post(m.journal('bank_line', line('رسوم خدمات بنكية').id));
  assert.equal(feeJournal.status, 'posted');
  const ask = { bank_account_id: bankAccount.id, period_start: '2026-08-01', period_end: '2026-08-31' };
  const s = bank.reconciliationStatement(db, u.employee, ask);
  assert.deepEqual([s.undecided_count, s.statement_closing_minor, s.unmatched_bank_minor, s.unmatched_book_minor, s.book_balance_minor, s.difference_minor], [0, 829000, 0, 0, 829000, 0]);
  const rec = tx(() => bank.prepareReconciliation(db, u.employee, { ...ask, explanation: '' }));
  tx(() => bank.approveReconciliation(db, u.manager, rec.id, { version: 1, note: 'طابقت الكشف والدفتر بفرق صفر' }));

  // ── الإقفال: كل الفحوص خضراء ──
  tx(() => createTemplate(db, u.employee, { title: 'مطابقة كشف البنك للشهر', owner_id: 'hr', due_day: 5, basis: 'قرار مالك إجراء الإقفال المصطنع لهذه المهمة' }));
  const opened = tx(() => openClosePeriod(db, u.employee, { period_key: '2026-08', finance_period_id: m.period.id }));
  const task = getClosePeriod(db, u.hr, opened.id).tasks[0];
  tx(() => taskAction(db, u.hr, task.id, 'complete_task', { version: task.version, evidence: 'طابقت الكشف وحفظت التسوية المعتمدة' }));
  const view = who => getClosePeriod(db, u[who], opened.id);
  const act = (who, action, input) => tx(() => periodAction(db, u[who], opened.id, action, { version: view(who).version, ...input }));
  const checks = view('manager').checks;
  assert.deepEqual(checks.checks.map(c => [c.key, c.passed]), [['journals', true], ['sources', true], ['bank', true], ['controls', true]], JSON.stringify(checks.checks.filter(c => !c.passed)));
  let state = act('manager', 'approve_close', { note: 'راجعت المهام وفحوص الإقفال الأربعة وكلها خضراء' });
  assert.deepEqual([state.status, state.ledger_locked], ['approved', true]);
  assert.equal(db.prepare('SELECT status FROM finance_periods WHERE id=?').get(m.period.id).status, 'closed');

  // ── الفتح بالمسار المعتمد ──
  state = act('outsider', 'request_reopen', { reason: 'وصلت فاتورة مصروف تخص أغسطس بعد اعتماد الإقفال' });
  const recorded = tx(() => adoptionAction(db, u.hr, RECLOSE_DAYS, 'record', { value: { days: 3 }, basis: 'قرار مالك إجراء الإقفال المصطنع: ثلاثة أيام لإعادة الإقفال', effective_from: '2026-01-01' }));
  tx(() => adoptionAction(db, u.outsider, RECLOSE_DAYS, 'approve', { adoption_id: db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(RECLOSE_DAYS).id, note: 'اعتمدت المدة بعد مراجعة أساسها' }));
  assert.ok(recorded);
  state = act('employee', 'approve_reopen', { note: 'أقر بأن فاتورة المصروف تخص أغسطس وتستوجب الفتح' });
  assert.deepEqual([state.status, state.ledger_locked, state.ledger_reopening.reclose_due_on], ['open', false, '2026-09-03']);

  // ── قيد تسوية بتاريخ داخل الشهر ──
  const adjustment = m.post(tx(() => f.createJournal(db, u.employee, { period_id: m.period.id, entry_date: '2026-08-20', description: 'مصروف أغسطس وصلت فاتورته بعد الإقفال', evidence: 'فاتورة مصطنعة', currency: 'SAR', source_reference: 'ADJ-2026-08',
    lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres.GEN.id, debit: '100.00', credit: '0', memo: 'المصروف' }, { account_id: accrued.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '100.00', memo: 'مستحق' }] })));
  assert.deepEqual([adjustment.status, adjustment.entry_date], ['posted', '2026-08-20']);

  // ── إعادة الإقفال بالفحوص نفسها ──
  assert.ok(view('manager').checks.passed);
  state = act('manager', 'approve_close', { note: 'أعدت الإقفال بعد قيد التسوية والفحوص خضراء' });
  assert.deepEqual([state.status, state.ledger_locked, state.reopen_count], ['approved', true, 1]);
  const period = db.prepare('SELECT * FROM finance_periods WHERE id=?').get(m.period.id);
  assert.deepEqual([period.status, period.version], ['closed', 4], 'closed, reopened and closed again: three recorded steps');
  const reopening = db.prepare('SELECT * FROM finance_period_reopenings WHERE period_id=?').get(m.period.id);
  assert.deepEqual([reopening.requested_by, reopening.decided_by, reopening.previous_closed_by, reopening.reclosed_by], ['outsider', 'employee', 'manager', 'manager']);
  assert.throws(() => tx(() => f.createJournal(db, u.employee, { period_id: m.period.id, entry_date: '2026-08-25', description: 'قيد بعد إعادة الإقفال', evidence: 'دليل مصطنع', currency: 'SAR', source_reference: 'LATE-2026-08',
    lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres.GEN.id, debit: '1.00', credit: '0', memo: 'م' }, { account_id: accrued.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '1.00', memo: 'د' }] })), code('period_closed'));

  // ── الأرقام بالهللة ──
  const trial = f.listFinance(db, u.manager).trial_balance;
  assert.ok(trial.is_balanced && trial.total_debit_minor === trial.total_credit_minor);
  assert.ok(ledger.controlReconciliation(db, '36t', '2026-08-31').balanced, 'every control account ties out at month end');
  const audits = db.prepare("SELECT action FROM audit_events WHERE entity_type='close_period' AND entity_id=? ORDER BY seq").all(opened.id).map(r => r.action);
  assert.deepEqual(audits.filter(a => /approve_close|approve_reopen|request_reopen/.test(a)), ['close.approve_close', 'close.request_reopen', 'close.approve_reopen', 'close.approve_close']);
  assert.ok(verifyAudit(db));
});
