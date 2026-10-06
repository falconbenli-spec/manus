// الحزمة 3 — المطابقة البنكية المجمّعة والمجزّأة (الترحيل 168). المسبار على 3d1d84c (docs/testing/p3-bank-close-probe-20260930.txt)
// أثبت أن المطابقة سطرٌ بسجل بالمبلغ نفسه لا غير: تحويلٌ واحد صرف عهدتين لا يُطابَق، وقبضٌ وصل على دفعتين لا يُطابَق، وقيدٌ
// يدوي على حساب البنك في الدفتر لا يُطابَق، وقبض الدفعة المقدمة وارتدادها ومرتجع دفعة المورد خارج الجدول. كل اختبار هنا يقيس واحدة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { now, verifyAudit } from '../app/db.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import * as ledger from '../app/ledger.mjs';
import { paymentAction } from '../app/payables.mjs';
import { grantAccess } from '../app/access.mjs';
import { bankLedger, code } from './bank-close-fixture.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';
import { bankReconciliationUI } from '../app/static/bank-reconciliation-ui.mjs';

const items = (db, matchId) => db.prepare('SELECT side,amount_minor,live FROM bank_match_items WHERE match_id=? ORDER BY position').all(matchId).map(i => [i.side, i.amount_minor, i.live]);

test('grouped match: one bank line settles two platform records only when the sums agree to the halala, and whoever prepares it never approves it', t => {
  const b = bankLedger(t);
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 50000, '2026-08-10'), d = b.custody('CUST-D', 50000, '2026-08-11');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,', '2026-08-11,صرف عهدة منفردة,CUST-D,500.00,'], { opening: '10000.00', closing: '8000.00' });
  const bulk = b.line('مجمعتين');
  const group = members => b.propose({ transaction_id: bulk.id, members });
  const record = id => ({ source_kind: 'custody_issue', source_id: id });
  assert.throws(() => group([record(a)]), code('amount_mismatch'), 'a part of a bulk line is not a match');
  assert.throws(() => group([record(a), record(a)]), code('duplicate_member'), 'one record counted twice is not a sum');
  const m = group([record(a), record(c)]);
  const row = b.db.prepare('SELECT * FROM bank_matches WHERE id=?').get(m.id);
  assert.deepEqual([row.shape, row.kind, row.source_kind, row.amount_minor, row.transaction_id], ['group', 'record', null, 150000, bulk.id]);
  assert.deepEqual(items(b.db, m.id), [['line', 150000, 1], ['record', 100000, 1], ['record', 50000, 1]]);
  assert.ok(items(b.db, m.id).every(([, minor]) => Number.isSafeInteger(minor)), 'every member carries integer halalas');
  // الفصل: المُعدّ لا يحمل تصريح الاعتماد، والمعتمد غيره.
  assert.throws(() => b.decide(m.id, 'approve', 'employee'), code('not_permitted'));
  b.decide(m.id);
  const txn = bank.bankBoard(b.db, b.users.employee).transactions.find(x => x.id === bulk.id);
  assert.equal(txn.state, 'matched');
  assert.equal(txn.match.shape, 'group');
  assert.deepEqual(txn.match.members.map(x => [x.source_kind, x.amount_minor]).sort((a, b) => a[1] - b[1]), [['custody_issue', 50000], ['custody_issue', 100000]]);
  // عضو مطابقة قائمة لا يدخل مطابقة ثانية.
  assert.throws(() => b.propose({ transaction_id: b.line('منفردة').id, members: [record(c)] }), code('source_taken'));
  b.decide(b.propose({ transaction_id: b.line('منفردة').id, source_kind: 'custody_issue', source_id: d }).id);
  // القاعدة: لا بند يُضاف بعد القرار، ولا يُعدَّل، ولا يُحذف.
  assert.throws(() => b.db.prepare('INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(m.id, '36t', b.account.id, 9, 'record', 'custody_issue', randomUUID(), 100, now()), /under a proposed match/);
  assert.throws(() => b.db.prepare('UPDATE bank_match_items SET amount_minor=1 WHERE match_id=?').run(m.id), /is fixed/);
  assert.throws(() => b.db.prepare('DELETE FROM bank_match_items WHERE match_id=?').run(m.id), /retained/);
  const s = b.statement();
  assert.equal(s.undecided_count, 0);
  assert.ok(verifyAudit(b.db));
});

test('split match: two bank lines settle one record exactly, the header keeps the record, and a many-to-many match is refused', t => {
  const b = bankLedger(t);
  const ret = b.custody('CUST-R', 100000, '2026-08-01', { returned: { minor: 50000, reference: 'CUST-RET-R', date: '2026-08-12' } });
  const x1 = b.custody('CUST-X1', 10000, '2026-08-20'), x2 = b.custody('CUST-X2', 10000, '2026-08-20');
  b.load(['2026-08-12,إعادة عهدة دفعة أولى,CUST-RET-R,,300.00', '2026-08-13,إعادة عهدة دفعة ثانية,CUST-RET-R,,200.00',
    '2026-08-20,صرف أول,CUST-X1,100.00,', '2026-08-20,صرف ثان,CUST-X2,100.00,'], { opening: '10000.00', closing: '10300.00' });
  const [l1, l2] = [b.line('دفعة أولى'), b.line('دفعة ثانية')];
  assert.throws(() => b.propose({ transaction_ids: [l1.id], source_kind: 'custody_return', source_id: ret }), code('amount_mismatch'));
  const m = b.propose({ transaction_ids: [l1.id, l2.id], source_kind: 'custody_return', source_id: ret });
  const row = b.db.prepare('SELECT * FROM bank_matches WHERE id=?').get(m.id);
  assert.deepEqual([row.shape, row.source_kind, row.source_id, row.amount_minor, row.transaction_id], ['split', 'custody_return', ret, 50000, l1.id],
    'a split keeps its one record on the header, so a reader of the header (the ledger trace) still finds it');
  assert.deepEqual(items(b.db, m.id), [['line', 30000, 1], ['line', 20000, 1], ['record', 50000, 1]]);
  b.decide(m.id);
  const board = bank.bankBoard(b.db, b.users.employee);
  assert.deepEqual([l1.id, l2.id].map(id => board.transactions.find(x => x.id === id).state), ['matched', 'matched']);
  // كثيرٌ بكثير ليس مطابقة: السطران بالعهدتين يُطابَقان كلٌّ بسجله.
  const [s1, s2] = [b.line('صرف أول'), b.line('صرف ثان')];
  assert.throws(() => b.propose({ transaction_ids: [s1.id, s2.id], members: [{ source_kind: 'custody_issue', source_id: x1 }, { source_kind: 'custody_issue', source_id: x2 }] }), code('match_shape'));
  assert.throws(() => b.propose({ transaction_ids: [s1.id, s1.id], source_kind: 'custody_issue', source_id: x1 }), code('duplicate_member'));
  assert.ok(verifyAudit(b.db));
});

test('a posted manual journal on the bank account is matchable; a draft or another account’s journal is not; an unmatched one is outstanding in the reconciliation', t => {
  const b = bankLedger(t);
  b.journal('2026-07-31', [[b.accounts.bank, '10000.00'], [b.accounts.equity, 0, '10000.00']], 'OPEN-2026');
  const deposit = b.journal('2026-08-12', [[b.accounts.bank, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-300');
  b.journal('2026-08-20', [[b.accounts.bank, '40.00'], [b.accounts.equity, 0, '40.00']], 'DEP-40');
  const draft = b.journal('2026-08-12', [[b.accounts.bank, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-DRAFT', { draft: true });
  const foreign = b.journal('2026-08-12', [[b.accounts.second, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-OTHER');
  b.load(['2026-08-12,إيداع يدوي في الحساب,DEP-300,,300.00'], { opening: '10000.00', closing: '10300.00' });
  const line = b.line('إيداع');
  assert.ok(bank.bankBoard(b.db, b.users.employee).transactions.find(x => x.id === line.id).suggestions.some(s => s.source_kind === 'journal' && s.source_id === deposit.id),
    'the suggestion list offers the posted journal with its reason, like any record');
  assert.throws(() => b.propose({ transaction_id: line.id, journal_id: draft.id }), code('journal_not_matchable'), 'a draft is not in the book yet');
  assert.throws(() => b.propose({ transaction_id: line.id, journal_id: foreign.id }), code('journal_not_matchable'), 'a journal that never touches this bank account is not its movement');
  const m = b.propose({ transaction_id: line.id, journal_id: deposit.id });
  assert.deepEqual(items(b.db, m.id), [['line', 30000, 1], ['journal', 30000, 1]]);
  b.decide(m.id);
  const s = b.statement();
  assert.deepEqual(s.outstanding.map(o => [o.source_kind, o.reference, o.amount_minor]), [['journal', 'DEP-40', 4000]], 'the unmatched manual deposit is a book item not yet in the bank; the matched one is reconciled');
  assert.deepEqual([s.statement_closing_minor, s.unmatched_bank_minor, s.unmatched_book_minor, s.book_balance_minor, s.difference_minor], [1030000, 0, 4000, 1034000, 0]);
  assert.ok(verifyAudit(b.db));
});

test('a transfer between two company bank accounts is one manual journal matched once in each account’s statement', t => {
  const b = bankLedger(t);
  b.journal('2026-07-31', [[b.accounts.bank, '10000.00'], [b.accounts.equity, 0, '10000.00']], 'OPEN-2026');
  const transfer = b.journal('2026-08-15', [[b.accounts.second, '1000.00'], [b.accounts.bank, 0, '1000.00']], 'TRF-A-B');
  const other = b.tx(() => bank.createBankAccount(b.db, b.users.employee, { label: 'حساب الادخار المصطنع', bank_name: 'بنك مصطنع', account_tail: '8765', gl_account_id: b.accounts.second.id }));
  const profile = b.tx(() => bank.saveImportProfile(b.db, b.users.employee, { bank_account_id: other.id, name: 'كشف الادخار المصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  b.load(['2026-08-15,تحويل إلى حساب الادخار,TRF-A-B,1000.00,'], { opening: '10000.00', closing: '9000.00' });
  b.tx(() => bank.importStatement(b.db, b.users.employee, { profile_id: profile.id, file_name: 'savings-08.csv', period_start: '2026-08-01', period_end: '2026-08-31', opening_balance: '0.00', closing_balance: '1000.00',
    content: ['date,description,reference,debit,credit', '2026-08-15,تحويل من الحساب التشغيلي,TRF-A-B,,1000.00'].join('\n') }));
  const out = b.propose({ transaction_id: b.line('إلى حساب الادخار').id, journal_id: transfer.id });
  const into = b.propose({ transaction_id: b.line('من الحساب التشغيلي').id, journal_id: transfer.id });
  b.decide(out.id); b.decide(into.id);
  assert.deepEqual([items(b.db, out.id), items(b.db, into.id)], [[['line', 100000, 1], ['journal', 100000, 1]], [['line', 100000, 1], ['journal', 100000, 1]]],
    'the same journal is the outgoing movement of one account and the incoming movement of the other');
  assert.throws(() => b.propose({ transaction_id: b.line('إلى حساب الادخار').id, journal_id: transfer.id }), code('match_exists'));
  assert.equal(b.statement().difference_minor, 0);
  assert.equal(bank.reconciliationStatement(b.db, b.users.employee, { bank_account_id: other.id, period_start: '2026-08-01', period_end: '2026-08-31' }).difference_minor, 0);
  assert.ok(verifyAudit(b.db));
});

test('widened kinds: an advance receipt, its reversal and a returned supplier payment are cash records with their direction, matchable, and traced from the ledger', t => {
  const m = ledgerMonth(t);
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']]) m.tx(() => grantAccess(m.db, m.users.admin, { user_id: who, capability, note: 'تصريح مطابقة مصطنع' }));
  const advance = m.paidAdvance({ amount: '500.00', reference: 'TRF-ADV-1' });
  m.reverseAdvance(advance.id, '100.00');
  const reversal = m.db.prepare('SELECT * FROM advance_reversals WHERE advance_id=?').get(advance.id);
  const { payable, invoice } = m.matchedPayable({ gross: '1150.00' }); m.inputTax(invoice.id, '150.00');
  const order = m.pay(payable.id);
  const returned = m.tx(() => paymentAction(m.db, m.users.outsider, order.id, 'record_return', { version: order.version, returned_on: m.day, bank_reference: 'RET-M-1', credited: '1140.00',
    reason: 'رجع التحويل لأن حساب المورد مقفل عند بنكه', evidence: 'إشعار مرتجع بنكي مصطنع محفوظ' })).return;
  const records = bank.cashRecords(m.db, '36t', '0000-01-01', '9999-12-31');
  const find = (kind, id) => records.find(r => r.source_kind === kind && r.source_id === id);
  assert.deepEqual([find('advance_receipt', advance.id).direction, find('advance_receipt', advance.id).amount_minor], ['in', 50000]);
  assert.deepEqual([find('advance_reversal', reversal.id).direction, find('advance_reversal', reversal.id).amount_minor], ['out', 10000]);
  assert.deepEqual([find('supplier_payment_return', returned.id).direction, find('supplier_payment_return', returned.id).amount_minor, find('supplier_payment_return', returned.id).reference],
    ['in', 114000, 'RET-M-1'], 'a returned transfer is money coming back, at the amount the bank credited');
  assert.equal(bank.cashRecords(m.db, 'isolated', '0000-01-01', '9999-12-31').length, 0, 'another tenant sees none of them');
  const account = m.tx(() => bank.createBankAccount(m.db, m.users.employee, { label: 'حساب الشهر المصطنع', bank_name: 'بنك مصطنع', account_tail: '7777', gl_account_id: m.accounts.bank.id }));
  const profile = m.tx(() => bank.saveImportProfile(m.db, m.users.employee, { bank_account_id: account.id, name: 'كشف الشهر المصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  m.tx(() => bank.importStatement(m.db, m.users.employee, { profile_id: profile.id, file_name: 'kinds.csv', period_start: `${m.month}-01`, period_end: m.day, opening_balance: '10000.00', closing_balance: '10390.00',
    content: ['date,description,reference,debit,credit', `${m.day},قبض دفعة مقدمة,TRF-ADV-1,,500.00`, `${m.day},ارتداد دفعة مقدمة,ADV-REV,100.00,`,
      `${m.day},تحويل لمورد,${order.bank_reference},1150.00,`, `${m.day},مرتجع تحويل المورد,RET-M-1,,1140.00`].join('\n') }));
  const txn = text => m.db.prepare('SELECT * FROM bank_transactions WHERE description=?').get(text);
  const match = (text, kind, id) => { const p = m.tx(() => bank.proposeMatch(m.db, m.users.employee, { transaction_id: txn(text).id, kind: 'record', source_kind: kind, source_id: id, unmatched_reason: null, rationale: 'المبلغ والمرجع يطابقان السجل المصطنع' }));
    m.tx(() => bank.decideMatch(m.db, m.users.manager, p.id, 'approve', { version: 1, note: 'راجعت إشعار البنك المصطنع' })); return p; };
  match('قبض دفعة مقدمة', 'advance_receipt', advance.id);
  match('ارتداد دفعة مقدمة', 'advance_reversal', reversal.id);
  match('تحويل لمورد', 'supplier_payment', order.id);
  match('مرتجع تحويل المورد', 'supplier_payment_return', returned.id);
  assert.equal(m.db.prepare("SELECT COUNT(*) n FROM bank_matches WHERE status='approved'").get().n, 4);
  // الدفتر يقرأ مطابقة النوع من رأسها بقائمة وحدة البنك نفسها: قبض الدفعة المقدمة صار نقدًا ينربط بسطر كشف.
  const trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'advance_receipt', id: advance.id });
  const step = trace.chain.find(s => s.step === 'bank_match');
  assert.equal(step.state, 'linked');
  assert.equal(step.items[0].transaction_id, txn('قبض دفعة مقدمة').id);
  assert.ok(verifyAudit(m.db));
});

test('rejecting a grouped match releases its line and records for a new match, and the rejected members stay as history', t => {
  const b = bankLedger(t);
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 50000, '2026-08-10');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,'], { opening: '10000.00', closing: '8500.00' });
  const bulk = b.line('مجمعتين');
  const members = [{ source_kind: 'custody_issue', source_id: a }, { source_kind: 'custody_issue', source_id: c }];
  const first = b.propose({ transaction_id: bulk.id, members });
  assert.throws(() => b.propose({ transaction_id: bulk.id, members }), code('match_exists'), 'a line under a live proposal is not proposed twice');
  b.decide(first.id, 'reject');
  assert.deepEqual(items(b.db, first.id).map(([, , live]) => live), [0, 0, 0], 'the rejected match no longer holds its members');
  const second = b.propose({ transaction_id: bulk.id, members });
  b.decide(second.id);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM bank_match_items WHERE match_id=?').get(first.id).n, 3, 'the rejected members are kept');
  assert.throws(() => b.db.prepare('UPDATE bank_match_items SET live=1 WHERE match_id=?').run(first.id), /is fixed/);
  assert.ok(verifyAudit(b.db));
});

test('the database balances every approved match to the halala, whoever writes it', t => {
  const b = bankLedger(t);
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 40000, '2026-08-10');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,'], { opening: '10000.00', closing: '8500.00' });
  const bulk = b.line('مجمعتين'), id = randomUUID(), at = now();
  // مطابقة تُكتب صفوفًا مباشرة بلا الكود، وسجلّاها ينقصان عشرة ريالات عن السطر: الاعتماد يُرفض في القاعدة.
  b.db.prepare("INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,amount_minor,rationale,prepared_by,prepared_at) VALUES(?,?,?,'record','group',150000,'مطابقة مكتوبة مباشرة للاختبار','employee',?)").run(id, '36t', bulk.id, at);
  const item = b.db.prepare('INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,source_kind,source_id,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  item.run(id, '36t', b.account.id, 1, 'line', bulk.id, null, null, 150000, at);
  item.run(id, '36t', b.account.id, 2, 'record', null, 'custody_issue', a, 100000, at);
  item.run(id, '36t', b.account.id, 3, 'record', null, 'custody_issue', c, 40000, at);
  assert.throws(() => item.run(id, '36t', b.account.id, 4, 'line', bulk.id, null, null, 1000, at), /full amount/, 'a bank line is a member at its whole amount only');
  assert.throws(() => b.db.prepare("UPDATE bank_matches SET status='approved',decided_by='manager',decided_at=?,decision_note='اعتماد مباشر',version=version+1 WHERE id=?").run(at, id), /balances to the halala/);
  assert.throws(() => b.db.prepare('INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, 'isolated', b.account.id, 5, 'line', bulk.id, 150000, at), /FOREIGN KEY|under a proposed match/,
    'a member of another tenant cannot hang under this match');
});

test('bank screen: grouped and split matches, a journal match and a classified fee render from real board data, and the group and split forms send exact members', t => {
  const b = bankLedger(t);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = { e, button: (action, id, label) => `<button data-operation="${action}" data-id="${id}">${label}</button>`, money: m => m === null || m === undefined ? '—' : `${m / 100} SAR` };
  b.journal('2026-07-31', [[b.accounts.bank, '10000.00'], [b.accounts.equity, 0, '10000.00']], 'OPEN-2026');
  const deposit = b.journal('2026-08-12', [[b.accounts.bank, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-300');
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 50000, '2026-08-10');
  const ret = b.custody('CUST-R', 100000, '2026-08-01', { returned: { minor: 50000, reference: 'CUST-RET-R', date: '2026-08-12' } });
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,', '2026-08-12,إعادة عهدة دفعة أولى,CUST-RET-R,,300.00', '2026-08-13,إعادة عهدة دفعة ثانية,CUST-RET-R,,200.00',
    '2026-08-12,إيداع يدوي,DEP-300,,300.00', '2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], { opening: '10000.00', closing: '9275.00' });
  let board = bank.bankBoard(b.db, b.users.employee);
  const bulk = board.transactions.find(x => x.description.includes('مجمعتين'));
  assert.ok(bulk.actions.includes('group_match') && bulk.actions.includes('split_match'));
  const group = bankReconciliationUI.form('group_match', bulk.id, board);
  const payload = group.toPayload({ members: [`custody_issue|${a}`, `custody_issue|${c}`], rationale: 'تحويل واحد صرف عهدتين معًا' });
  assert.deepEqual(payload.members, [{ source_kind: 'custody_issue', source_id: a }, { source_kind: 'custody_issue', source_id: c }]);
  b.decide(b.tx(() => bank.proposeMatch(b.db, b.users.employee, payload)).id);
  const first = board.transactions.find(x => x.description.includes('دفعة أولى')), second = board.transactions.find(x => x.description.includes('دفعة ثانية'));
  const split = bankReconciliationUI.form('split_match', first.id, board);
  const splitPayload = split.toPayload({ lines: [second.id], member: `custody_return|${ret}`, rationale: 'إعادة العهدة وصلت على دفعتين' });
  assert.deepEqual(splitPayload.transaction_ids, [first.id, second.id]);
  b.decide(b.tx(() => bank.proposeMatch(b.db, b.users.employee, splitPayload)).id);
  const depositLine = board.transactions.find(x => x.description.includes('إيداع'));
  assert.ok(board.open_members.some(m => m.source_kind === 'journal' && m.source_id === deposit.id));
  b.decide(b.propose({ transaction_id: depositLine.id, journal_id: deposit.id }).id);
  b.classify('رسوم', 'bank_fee');
  board = bank.bankBoard(b.db, b.users.manager);
  const html = bankReconciliationUI.render(board, ctx);
  assert.ok(!/undefined|NaN|\[object/.test(html), 'no hole in the screen');
  assert.ok(html.includes('سطر واحد بعدة سجلات') && html.includes('عدة سطور بسجل واحد'), 'the screen names the shape of each match');
  assert.ok(html.includes('ما له قيد للحين'), 'a classified fee says it waits for its journal');
  assert.ok(!/style=|<script/.test(html));
  assert.throws(() => bankReconciliationUI.form('group_match', bulk.id, board), /غير متاح/, 'a matched line offers no new match');
});

