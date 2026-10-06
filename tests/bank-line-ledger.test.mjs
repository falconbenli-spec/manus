// الحزمة 3 — سطر الكشف المصنّف ومرتجع دفعة المورد مصدرين للدفتر. المسبار على 3d1d84c أثبت أن رسوم البنك المصنّفة بلا قيد،
// وأن ترحيل الرسوم في الدفتر يترك فرقًا دائمًا في التسوية بمبلغها (2500 هللة)، وأن المرتجع ليس نوعًا في سجل الدفتر.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { now, transaction, verifyAudit } from '../app/db.mjs';
import * as ledger from '../app/ledger.mjs';
import { sourceKind, sourceKinds, sourceLinks } from '../app/ledger-sources.mjs';
import { recordMapping, approveMapping } from '../app/ledger.mjs';
import * as f from '../app/finance.mjs';
import { paymentAction } from '../app/payables.mjs';
import { bankLedger, code } from './bank-close-fixture.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';

const balanced = (b, journalId) => { const rows = b.lines(journalId); return rows.reduce((n, [, d]) => n + d, 0) === rows.reduce((n, [, , c]) => n + c, 0) && rows.every(([, d, c]) => Number.isSafeInteger(d) && Number.isSafeInteger(c)); };

test('the ledger knows two new purposes, and a classified bank line posts nothing until they are mapped by two people', t => {
  const b = bankLedger(t, { map: [] });
  const purposes = Object.fromEntries(ledger.PURPOSES.map(p => [p.key, p.account_type]));
  assert.deepEqual([purposes.bank_charges, purposes.interest_income], ['expense', 'income']);
  assert.equal(sourceKind('bank_line')?.bank, 'cash', 'a classified bank line is a cash source kind registered from the bank module');
  assert.equal(sourceKind('bank_line').module, 'bank-reconciliation');
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], { opening: '10000.00', closing: '9975.00' });
  const fee = b.classify('رسوم', 'bank_fee');
  assert.throws(() => b.sourced('bank_line', fee.id), code('mapping_required'), 'an unmapped purpose refuses like every other purpose');
  // الربط بشخصين كبقية الأغراض: من سجّله لا يعتمده، والربط غير المعتمد لا يُقرأ.
  const { id } = b.tx(() => recordMapping(b.db, b.users.employee, { purpose: 'bank_charges', account_id: b.accounts.charges.id, cost_center_id: b.centre.id, effective_from: '2026-01-01' }));
  assert.throws(() => b.sourced('bank_line', fee.id), code('mapping_required'), 'a recorded mapping waits for its second person');
  assert.throws(() => b.tx(() => approveMapping(b.db, b.users.employee, id, { note: 'أعتمد ما سجّلته بنفسي' })), error => ['self_approval', 'ledger_access_denied'].includes(error.code));
  b.tx(() => approveMapping(b.db, b.users.manager, id, { note: 'طابقت حساب الرسوم المصطنع' }));
  assert.deepEqual(b.lines(b.sourced('bank_line', fee.id).id), [['5300', 2500, 0], ['1000', 0, 2500]]);
});

test('a classified bank fee is one balanced journal on the bank account’s own ledger account; interest runs the other way; a transfer or an unknown line is not a source', t => {
  const b = bankLedger(t, { map: [] });
  assert.throws(() => b.tx(() => recordMapping(b.db, b.users.employee, { purpose: 'bank_charges', account_id: b.accounts.interest.id, cost_center_id: b.centre.id, effective_from: '2026-01-01' })), code('account_type'),
    'bank charges take an expense account, not an income one');
  b.mapPurpose('bank_charges'); b.mapPurpose('interest_income');
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,', '2026-08-28,عائد حساب مصطنع,INT-08,,12.34', '2026-08-29,تحويل بين حسابات الشركة,TRF-1,100.00,', '2026-08-30,حركة مجهولة,UNK-1,,1.00'],
    { opening: '10000.00', closing: '9888.34' });
  const fee = b.classify('رسوم', 'bank_fee'), interest = b.classify('عائد', 'interest'), transfer = b.classify('تحويل', 'account_transfer'), unknown = b.classify('مجهولة', 'unknown');
  const pending = ledger.statements(b.db, b.users.manager).sources.filter(s => s.source_kind === 'bank_line');
  assert.deepEqual(pending.map(s => [s.source_id, s.amount_minor, s.date]).sort(), [[fee.id, 2500, '2026-08-05'], [interest.id, 1234, '2026-08-28']].sort(),
    'fees and interest wait for a journal; a transfer and an unknown line do not');
  const j = b.sourced('bank_line', fee.id);
  assert.deepEqual(b.lines(j.id), [['5300', 2500, 0], ['1000', 0, 2500]], 'Dr bank charges / Cr the ledger account of this bank account');
  assert.equal(j.entry_date, '2026-08-05');
  const k = b.sourced('bank_line', interest.id);
  assert.deepEqual(b.lines(k.id), [['1000', 1234, 0], ['4100', 0, 1234]], 'Dr bank / Cr interest income');
  assert.ok(balanced(b, j.id) && balanced(b, k.id));
  assert.throws(() => b.sourced('bank_line', transfer.id), code('source_not_ready'));
  assert.throws(() => b.sourced('bank_line', unknown.id), code('source_not_ready'));
  assert.throws(() => b.sourced('bank_line', fee.id), code('duplicate_source'), 'one classified line, one journal');
  // فصل المهام في الدفتر كما هو: المُعدّ لا يعتمد، والمعتمد غيره، والمرحّل غير المُعدّ.
  // المُعدّ يحمل هنا تفويضي الاعتماد والترحيل أيضًا: الفصل بالهوية لا بالتفويض.
  for (const action of ['approve', 'post']) b.db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', 'employee', 'employee', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مصطنع لاختبار الفصل', null, now());
  const submitted = b.act('employee', j, 'submit');
  assert.throws(() => b.act('employee', submitted, 'approve'), code('transition_denied'), 'the preparer does not approve');
  const approved = b.act('manager', submitted, 'approve');
  assert.throws(() => b.act('employee', approved, 'post'), code('transition_denied'), 'the preparer does not post');
  const posted = b.act('outsider', approved, 'post');
  assert.equal(posted.status, 'posted');
  const trace = ledger.traceAmount(b.db, b.users.manager, { kind: 'bank_line', id: fee.id });
  assert.deepEqual([trace.document.amount_minor, trace.chain.find(s => s.step === 'journal').items[0].status], [2500, 'posted']);
  assert.ok(trace.chain.find(s => s.step === 'approvals').items.some(a => a.actor_id === 'manager'), 'the approver of the classification is on the trace');
  assert.ok(verifyAudit(b.db));
});

test('a posted classified line counts as reconciled: posting the charge leaves no difference, and reversing its journal brings the bank-side item back', t => {
  const b = bankLedger(t);
  b.journal('2026-07-31', [[b.accounts.bank, '10000.00'], [b.accounts.equity, 0, '10000.00']], 'OPEN-2026');
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], { opening: '10000.00', closing: '9975.00' });
  const fee = b.classify('رسوم', 'bank_fee');
  const figures = s => [s.unmatched_bank_minor, s.book_balance_minor, s.difference_minor];
  assert.deepEqual(figures(b.statement()), [-2500, 1000000, 0], 'before the journal the fee is a bank item not in the book');
  const j = b.post(b.sourced('bank_line', fee.id));
  const after = b.statement();
  assert.deepEqual(figures(after), [0, 997500, 0], 'the probe measured 2500 here: a posted charge was still subtracted as unmatched bank');
  assert.deepEqual([after.classified[0].journal_status, after.classified[0].reconciled], ['posted', true]);
  b.reverse(j);
  assert.deepEqual(figures(b.statement()), [-2500, 1000000, 0], 'a reversed charge is out of the book again, so the line is a bank item again');
  assert.ok(verifyAudit(b.db));
});

test('a returned supplier payment: Dr bank for what came back, Dr bank charges for the shortfall, Cr payable for the order — the payable ties out and the payment’s trace shows the return', t => {
  const m = ledgerMonth(t);
  const charges = m.tx(() => f.createFinanceReference(m.db, m.users.manager, 'accounts', { code: '5300', name: 'رسوم بنكية مصطنعة', account_type: 'expense', currency: 'SAR' }));
  const { id: mapping } = m.tx(() => recordMapping(m.db, m.users.employee, { purpose: 'bank_charges', account_id: charges.id, cost_center_id: m.centres.GEN.id, effective_from: '2026-01-01' }));
  m.tx(() => approveMapping(m.db, m.users.manager, mapping, { note: 'طابقت حساب الرسوم المصطنع' }));
  const { payable, invoice } = m.matchedPayable({ gross: '1150.00' }); m.inputTax(invoice.id, '150.00');
  m.post(m.journal('supplier_invoice', payable.id));
  const order = m.pay(payable.id);
  m.post(m.journal('supplier_payment', order.id));
  const kind = sourceKind('supplier_payment_return');
  assert.deepEqual([kind?.module, kind?.bank, Object.keys(kind?.controls ?? {})], ['payables', 'cash', ['payable']]);
  assert.ok(sourceLinks('supplier_payment', 'reversal').some(l => l.module === 'payables'), 'the payment links to its return as a reversal');
  const returned = m.tx(() => paymentAction(m.db, m.users.outsider, order.id, 'record_return', { version: order.version, returned_on: m.day, bank_reference: 'RET-001', credited: '1140.00',
    reason: 'رجع التحويل لأن حساب المورد مقفل عند بنكه', evidence: 'إشعار مرتجع بنكي مصطنع محفوظ' })).return;
  const j = m.journal('supplier_payment_return', returned.id);
  const lines = m.db.prepare('SELECT a.code,l.debit_minor,l.credit_minor FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id WHERE l.journal_id=? ORDER BY l.position').all(j.id).map(l => [l.code, l.debit_minor, l.credit_minor]);
  assert.deepEqual(lines, [['1000', 114000, 0], ['5300', 1000, 0], ['2000', 0, 115000]]);
  assert.equal(lines.reduce((n, [, d]) => n + d, 0), lines.reduce((n, [, , c]) => n + c, 0));
  assert.throws(() => m.journal('supplier_payment_return', returned.id), code('duplicate_source'));
  m.post(j);
  const payableControl = ledger.controlReconciliation(m.db, '36t', m.day).controls.find(c => c.key === 'payable');
  assert.deepEqual([payableControl.subledger_minor, payableControl.ledger_minor, payableControl.balanced], [115000, 115000, true], 'the return re-opens the payable in the subledger and in the ledger alike');
  const trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_payment', id: order.id });
  const reversal = trace.chain.find(s => s.step === 'reversal');
  assert.equal(reversal.state, 'linked');
  assert.ok(reversal.items.some(i => i.kind === 'supplier_payment_return' && i.id === returned.id && i.journal?.status === 'posted'));
  const own = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_payment_return', id: returned.id });
  assert.deepEqual([own.document.amount_minor, own.document.reference], [115000, 'RET-001']);
  assert.ok(verifyAudit(m.db));
});

test('source kinds read their own tenant only: another entity cannot build a journal from this bank line', t => {
  const b = bankLedger(t);
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], { opening: '10000.00', closing: '9975.00' });
  const fee = b.classify('رسوم', 'bank_fee');
  b.db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-admin','isolated','other','iso-admin','مسؤول الكيان المعزول','unused','manager',NULL)");
  for (const action of ['read', 'configure', 'prepare']) b.db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'isolated', 'external', 'employee', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'iso-admin', 'تفويض مصطنع لكيان معزول', null, now());
  const external = b.db.prepare("SELECT * FROM users WHERE id='external'").get();
  const isoPeriod = transaction(b.db, () => f.createFinanceReference(b.db, external, 'periods', { name: 'فترة الكيان المعزول', starts_on: '2026-01-01', ends_on: '2026-12-31' }));
  assert.throws(() => transaction(b.db, () => ledger.journalFromSource(b.db, external, { source_kind: 'bank_line', source_id: fee.id, period_id: isoPeriod.id })), code('source_not_ready'));
  assert.equal(sourceKinds().find(k => k.key === 'bank_line').pending(b.db, 'isolated').length, 0);
});
