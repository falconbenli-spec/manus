// الحزمة 3 — خطوة البنك في تتبّع المبلغ. التتبّع (app/ledger.mjs traceAmount) كان يقرأ رأس المطابقة وحده (bank_matches.source_kind)،
// والترحيل 168 جعل المطابقة بنودًا: السجل داخل مطابقة مجمّعة (سطر واحد بعدة سجلات) لا يُكتب في الرأس أصلًا، والسجل المجزّأ على
// سطرين يحمل الرأسُ سطره الأول وحده، والقيد اليدوي على حساب البنك يُطابَق بسطره ولا مستند له. فكان التتبّع يقول «ما طابق أحد
// سطر كشف» عن مالٍ مطابق ومعتمد، ويقول عن سطر الكشف المصنّف رسومًا — وهو المستند نفسه — إن الجدول لا يقبل نوعه.
// بيانات مصطنعة كلها (tests/bank-close-fixture.mjs): عهد مصطنعة، وكشف ملف، وقيود يدوية.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { now, verifyAudit } from '../app/db.mjs';
import * as ledger from '../app/ledger.mjs';
import { bankLedger } from './bank-close-fixture.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import { grantAccess } from '../app/access.mjs';
import { visibilityWorld } from './visibility-fixture.mjs';

const bankStep = trace => trace.chain.find(s => s.step === 'bank_match');

function world(t) {
  const b = bankLedger(t);
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 50000, '2026-08-10');
  const r = b.custody('CUST-R', 100000, '2026-08-01', { returned: { minor: 50000, reference: 'CUST-RET-R', date: '2026-08-12' } });
  const lonely = b.custody('CUST-L', 7000, '2026-08-25');
  const deposit = b.journal('2026-08-15', [[b.accounts.bank, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-300');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,', '2026-08-12,إعادة عهدة دفعة أولى,CUST-RET-R,,300.00', '2026-08-13,إعادة عهدة دفعة ثانية,CUST-RET-R,,200.00',
    '2026-08-15,إيداع رأس مال,DEP-300,,300.00', '2026-08-20,رسوم إدارة الحساب,FEE-1,15.00,'], { opening: '10000.00', closing: '9285.00' });
  const bulk = b.line('مجمعتين'), l1 = b.line('دفعة أولى'), l2 = b.line('دفعة ثانية'), dep = b.line('إيداع رأس مال');
  b.decide(b.propose({ transaction_id: bulk.id, members: [{ source_kind: 'custody_issue', source_id: a }, { source_kind: 'custody_issue', source_id: c }] }).id);
  b.decide(b.propose({ transaction_ids: [l1.id, l2.id], source_kind: 'custody_return', source_id: r }).id);
  b.decide(b.propose({ transaction_id: dep.id, members: [{ journal_id: deposit.id }] }).id);
  const fee = b.classify('رسوم إدارة الحساب', 'bank_fee');
  return { ...b, a, c, r, lonely, deposit, bulk, l1, l2, dep, fee };
}

test('trace: a record inside a grouped match shows the bank line that carried it, and a record settled by two lines shows both', t => {
  const w = world(t), { db, users } = w;
  const grouped = bankStep(ledger.traceAmount(db, users.manager, { kind: 'custody_issue', id: w.c }));
  assert.equal(grouped.state, 'linked', 'the second record of a grouped transfer is matched, and the trace says so');
  assert.deepEqual(grouped.items.map(i => [i.transaction_id, i.shape, i.status]), [[w.bulk.id, 'group', 'approved']]);
  const split = bankStep(ledger.traceAmount(db, users.manager, { kind: 'custody_return', id: w.r }));
  assert.equal(split.state, 'linked');
  assert.deepEqual(split.items.map(i => i.transaction_id).sort(), [w.l1.id, w.l2.id].sort(), 'both lines that carried the returned cash, not the header line alone');
  const unmatched = bankStep(ledger.traceAmount(db, users.manager, { kind: 'custody_issue', id: w.lonely }));
  assert.equal(unmatched.state, 'none', 'a record no line carries is a named break, not silence');
  assert.ok(verifyAudit(db));
});

test('trace: a classified bank line is its own bank step, and a manual journal on the bank account shows the line it was matched to', t => {
  const w = world(t), { db, users } = w;
  const line = bankStep(ledger.traceAmount(db, users.manager, { kind: 'bank_line', id: w.fee.id }));
  assert.equal(line.state, 'linked', 'the source document of a bank_line is the statement line itself');
  assert.deepEqual(line.items.map(i => [i.transaction_id, i.amount_minor, i.reason]), [[w.fee.id, 1500, 'bank_fee']]);
  const journal = bankStep(ledger.traceAmount(db, users.manager, { kind: 'journal', id: w.deposit.id }));
  assert.equal(journal.state, 'linked', 'a manual journal on the bank account is matched by its line since migration 168');
  assert.deepEqual(journal.items.map(i => i.transaction_id), [w.dep.id]);
  // قيد يدوي لا يمسّ حساب البنك: خطوة البنك لا تنطبق عليه، ويُقال لماذا.
  const accrual = w.journal('2026-08-16', [[w.accounts.expense, '40.00'], [w.accounts.liability, 0, '40.00']], 'ACC-40');
  const offBank = bankStep(ledger.traceAmount(db, users.manager, { kind: 'journal', id: accrual.id }));
  assert.equal(offBank.state, 'not_applicable');
  // قيد يدوي على البنك لم يُطابَق: انقطاع مسمّى.
  const loose = w.journal('2026-08-18', [[w.accounts.bank, '25.00'], [w.accounts.equity, 0, '25.00']], 'DEP-25');
  assert.equal(bankStep(ledger.traceAmount(db, users.manager, { kind: 'journal', id: loose.id })).state, 'none');
});

test('trace: another tenant traces nothing — neither the grouped record nor the classified line', t => {
  const w = world(t), { db } = w;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'iso-admin','isolated','other','iso-admin','مسؤول كيان معزول مصطنع',password_hash,'admin',NULL FROM users WHERE id='external'").run();
  db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'isolated', 'external', 'employee', 'read', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'iso-admin', 'تفويض قراءة مصطنع لكيان معزول', null, now());
  const outsider = db.prepare("SELECT * FROM users WHERE id='external'").get();
  for (const [kind, id] of [['custody_issue', w.c], ['bank_line', w.fee.id], ['journal', w.deposit.id]])
    assert.throws(() => ledger.traceAmount(db, outsider, { kind, id }), { code: 'trace_source_not_found' }, `${kind}: invisible across tenants`);
});

// الفاتورة ليست نقدًا، فخطوة البنك فيها سطورُ كشف تسوياتها النقدية — كلها: القبض المجزّأ على سطرين يظهر بسطريه، والتخصيص من قبض
// على الحساب يظهر بسطر ذلك القبض (via يسمّيه). كانت الخطوة تأخذ أول مطابقة لكل تسوية، فيظهر من القبض المجزّأ سطره الأول وحده.
test('trace: an invoice shows every statement line that carried its cash — both lines of a split receipt, and the line of the on-account receipt its allocation drew on', t => {
  const w = visibilityWorld(t), { db, users, tx } = w;
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']])
    tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مصطنع لاختبار التتبع' }));
  const k = w.customer({ lines: [['بند أول مصطنع', '100.00'], ['بند ثانٍ مصطنع', '200.00']] });
  const [c1, c2] = k.claims, [i1, i2] = k.invoices;
  const r1 = w.receipt(c1, '115.00', 'TR-SPLIT');
  const x = w.onAccount(k.case.id, '230.00', 'TR-ACC');
  w.allocate(x, [{ claim_id: c2.id, amount: '230.00' }]);
  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'حساب تتبع مصطنع', bank_name: 'بنك مصطنع', account_tail: '7070', gl_account_id: w.accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف تتبع مصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  const day = w.day, from = `${w.month}-01`;
  tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: 'trace-statement.csv', period_start: from, period_end: day, opening_balance: '0.00', closing_balance: '345.00',
    content: ['date,description,reference,debit,credit', `${day},حوالة أولى,TR-SPLIT-A,,60.00`, `${day},حوالة ثانية,TR-SPLIT-B,,55.00`, `${day},حوالة على الحساب,TR-ACC,,230.00`].join('\n') }));
  const line = reference => db.prepare('SELECT * FROM bank_transactions WHERE reference=?').get(reference);
  const propose = input => tx(() => bank.proposeMatch(db, users.employee, { kind: 'record', unmatched_reason: null, rationale: 'المبلغ والمرجع يطابقان السجل المصطنع', ...input }));
  const approve = m => tx(() => bank.decideMatch(db, users.manager, m.id, 'approve', { version: 1, note: 'راجعت السطر والسجل المصطنعين' }));
  approve(propose({ transaction_ids: [line('TR-SPLIT-A').id, line('TR-SPLIT-B').id], source_kind: 'ar_receipt', source_id: r1.id }));
  approve(propose({ transaction_id: line('TR-ACC').id, source_kind: 'ar_account_receipt', source_id: x.id }));
  const first = bankStep(ledger.traceAmount(db, users.manager, { kind: 'tax_invoice', id: i1.id }));
  assert.equal(first.state, 'linked');
  assert.deepEqual(first.items.map(i => i.reference).sort(), ['TR-SPLIT-A', 'TR-SPLIT-B'], 'both lines of the split receipt, not its first line alone');
  const second = bankStep(ledger.traceAmount(db, users.manager, { kind: 'tax_invoice', id: i2.id }));
  assert.equal(second.state, 'linked');
  assert.deepEqual(second.items.map(i => [i.reference, i.via?.kind, i.via?.reference]), [['TR-ACC', 'ar_account_receipt', 'TR-ACC']], 'the allocation reads the line of the cash it drew on, and says through which receipt');
});
