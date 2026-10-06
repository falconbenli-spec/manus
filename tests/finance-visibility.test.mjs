// الحزمة 3 — الرؤية: أعمار مستحقات الموردين بتاريخ الاستحقاق (R41)، وحزمة الإقفال (R35) على الفحوص المحسوبة نفسها التي تحرس
// اعتماد الإقفال، وهامش المشروع بتكلفة مشتريات صافية من ضريبة المدخلات المتحقَّق منها، والرصيد الافتتاحي للتنبؤ النقدي من آخر
// تسوية بنكية معتمدة. ما قيس قبل الإصلاح: لا أعمار للموردين أصلًا؛ وR35 يعدّ القيد المرفوض «غير مرحّل» للأبد، ولا يرى المستحقات
// ولا الحسابات البنكية ولا فروق الحسابات الرقابية، ويقول إن المنصة بلا مطابقة بنكية؛ والهامش يحسب المشتريات بإجماليها مع الضريبة
// مقابل إيراد صافٍ؛ والتنبؤ يطلب الرصيد الافتتاحي باليد ولو وُجدت تسوية معتمدة. بيانات مصطنعة كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../app/finance.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import { runReport } from '../app/reports.mjs';
import { adoptionAction } from '../app/options.mjs';
import { projectProfitability, projectMarginFigures } from '../app/profitability.mjs';
import { decideInputTax, recordInputTax } from '../app/payables.mjs';
import { cashForecastBoard } from '../app/cash-forecast.mjs';
import { grantAccess } from '../app/access.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';
import { bankLedger } from './bank-close-fixture.mjs';

const code = value => error => error.code === value;
const TERMS = 'payables.payment_terms_days';

/* ───── (1) أعمار مستحقات الموردين ───── */
test('AP aging: each open payable is aged from its due date — the verified tax invoice date plus the owner\'s payment term — at its outstanding balance, and without an adopted term it says so and ages from the invoice date', t => {
  const w = visibilityWorld(t), { db, users, tx } = w;
  const old = w.matchedPayable({ gross: '1150.00' }), fresh = w.matchedPayable({ gross: '2300.00' });
  // فاتورة ضريبية قديمة متحقَّق منها: تاريخها أساس الاستحقاق. والثانية بلا سجل ضريبي: أساسها تاريخ المطابقة.
  const taxId = tx(() => recordInputTax(db, users.employee, { invoice_id: old.invoice.id, supplier_vat_number: w.winner.vat_number, supplier_invoice_number: 'TAX-OLD-1', invoice_date: '2026-01-15', vat: '150.00', evidence: 'فاتورة ضريبية مصطنعة قديمة محفوظة في ملف المورد' })).id;
  tx(() => decideInputTax(db, users.manager, taxId, 'verify', { note: 'طابقنا الفاتورة الضريبية المصطنعة القديمة' }));
  w.payOrder({ payable_id: old.payable.id, amount: '150.00' });
  // المهلة قرار المالية: يسجّلها من يحمل تصريح «الدفتر المالي والمستحقات» ويعتمدها زميل ثانٍ يحمله.
  for (const who of ['employee', 'manager']) tx(() => grantAccess(db, users.admin, { user_id: who, capability: 'finance.use', note: 'تصريح مالية مصطنع لقرار المهلة' }));
  const range = { from: `${w.month}-01`, to: w.day };
  let aging = runReport(db, users.manager, 'R41', range);
  const row = reference => aging.rows.find(r => r.reference === reference);
  assert.deepEqual([row('INV-1').outstanding, row('INV-1').invoice_date, row('INV-1').due_date], [1000, '2026-01-15', ''], 'the outstanding balance after the partial payment, and no due date without a decided term');
  assert.match(row('INV-1').bucket, /منذ الفاتورة/, 'without a term the bucket says it counts from the invoice');
  assert.ok(aging.notes.some(n => n.includes(TERMS)), 'the missing owner decision is named with its key');
  assert.equal(aging.totals.outstanding, 3300);
  // المالك يقرّر المهلة (ثلاثون يومًا) ويعتمدها ثانٍ: يصير لكل مستحق تاريخ استحقاق وشريحة تأخر.
  tx(() => adoptionAction(db, users.employee, TERMS, 'record', { value: { days: 30 }, basis: 'مهلة سداد الموردين القياسية المصطنعة من تاريخ فاتورتهم الضريبية', effective_from: '2026-01-01' }));
  const draft = db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(TERMS);
  assert.throws(() => tx(() => adoptionAction(db, users.employee, TERMS, 'approve', { adoption_id: draft.id, note: 'اعتماد ذاتي مرفوض' })), error => ['self_approval', 'separation_of_duties'].includes(error.code));
  tx(() => adoptionAction(db, users.manager, TERMS, 'approve', { adoption_id: draft.id, note: 'راجعت المهلة مع شروط العقود المصطنعة' }));
  aging = runReport(db, users.manager, 'R41', range);
  assert.deepEqual([row('INV-1').due_date, row('INV-1').bucket], ['2026-02-14', 'أكثر من 90'], 'an invoice of mid-January due mid-February is more than ninety days late');
  assert.ok(row('INV-1').days_late > 90);
  assert.equal(row('INV-2').bucket, 'لم يحل', 'a payable matched this month is not due yet');
  // لا يظهر ما لا شيء عليه، ولا ما في كيان آخر.
  w.payOrder({ payable_id: fresh.payable.id });
  assert.equal(runReport(db, users.manager, 'R41', range).rows.some(r => r.reference === 'INV-2'), false);
  assert.throws(() => runReport(db, db.prepare("SELECT * FROM users WHERE id='external'").get(), 'R41', range), code('not_found'));
});

/* ───── (2) حزمة الإقفال على الفحوص المحسوبة ───── */
test('R35 is the close checks themselves: unposted journals (never a rejected one), documents without a posted journal, an active bank account without an approved reconciliation, and each control difference, every row with an owner and a named item', t => {
  const w = visibilityWorld(t), { db, users, tx } = w;
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']]) tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مطابقة مصطنع' }));
  tx(() => bank.createBankAccount(db, users.employee, { label: 'الحساب التشغيلي المصطنع', bank_name: 'بنك مصطنع', account_tail: '4545', gl_account_id: w.accounts.bank.id }));
  const a = w.matchedPayable({ gross: '1150.00' });
  w.inputTax(a.invoice.id, '150.00');
  const draft = w.journal('supplier_invoice', a.payable.id);
  // قيد يدوي مرفوض: قرارٌ انتهى، لا قيد ينتظر الترحيل.
  const rejected = tx(() => f.createJournal(db, users.employee, { period_id: w.period.id, entry_date: w.day, description: 'قيد يدوي مصطنع يُرفض', evidence: 'دليل مصطنع', currency: 'SAR', source_reference: 'MAN-REJ-1',
    lines: [{ account_id: w.accounts.supplier_cost.id, cost_center_id: w.centres.GEN.id, debit: '10.00', credit: '0', memo: 'مدين' }, { account_id: w.accounts.retained_earnings.id, cost_center_id: w.centres.GEN.id, debit: '0', credit: '10.00', memo: 'دائن' }] }));
  const submitted = w.jAct('employee', rejected, 'submit');
  w.jAct('manager', submitted, 'reject');
  // دفعة مورد مرحّلة: الحساب البنكي تحرّك في الدفتر، ولا تسوية معتمدة له.
  const second = w.matchedPayable({ gross: '230.00' });
  const order = w.pay(second.payable.id);
  w.post(w.journal('supplier_payment', order.id));
  const pack = runReport(db, users.manager, 'R35', { from: `${w.month}-01`, to: w.day });
  const rows = check => pack.rows.filter(r => r.check === check);
  assert.ok(rows('قيد ما ترحّل').some(r => r.detail.includes(draft.source_reference)), 'the draft journal of the supplier invoice is named');
  assert.equal(pack.rows.some(r => r.detail.includes('MAN-REJ-1')), false, 'a rejected journal is a decision, not a journal waiting to be posted');
  assert.ok(rows('مستند بلا قيد مرحّل').some(r => r.item === 'فاتورة مورد مطابقة' && r.detail === second.invoice.supplier_reference), 'the second payable has no journal at all');
  assert.ok(rows('حساب بنكي بلا تسوية معتمدة').some(r => r.item.includes('الحساب التشغيلي المصطنع')), 'the bank account that moved in the ledger has no approved reconciliation');
  assert.ok(rows('فرق حساب رقابي').some(r => r.item.includes('ذمم الموردين')), 'the payables control differs from its subledger by the unposted invoice');
  assert.ok(pack.rows.every(r => r.item && r.detail !== undefined && r.owner), 'no blank item, and every blocker names its owner');
  assert.ok(pack.rows.filter(r => r.blocking === 'نعم').length >= 4);
  assert.equal(pack.notes.some(n => /لا مطابقة بنكية/.test(n)), false, 'the pack no longer says the platform has no bank reconciliation');
  assert.ok(rows('توازن المركز المالي').length === 1);
});

/* ───── (3) الهامش بتكلفة صافية ───── */
test('margin: supplier cost enters the project margin net of verified input VAT and of approved supplier credit notes, against net revenue — and verifying the VAT later moves the figures an acceptance was taken on', t => {
  const w = visibilityWorld(t), { db, users } = w;
  const a = w.matchedPayable({ gross: '1150.00' }), b = w.matchedPayable({ gross: '2300.00' });
  w.inputTax(a.invoice.id, '150.00');
  const pendingTax = w.inputTax(b.invoice.id, '300.00', { verify: false });
  let r = projectProfitability(db, users.manager, { project_id: w.project.id });
  assert.equal(r.cost.purchases_minor, 100000 + 230000, 'A net of its verified VAT; B gross while its VAT is only recorded, not verified');
  assert.ok(r.caveats.some(c => c.includes('ضريبة') && c.includes('1')), 'the caveat says one supplier invoice is counted gross because its VAT is not verified');
  const before = projectMarginFigures(db, '36t', w.project.id).digest;
  w.tx(() => decideInputTax(db, users.manager, pendingTax, 'verify', { note: 'طابقنا الفاتورة الضريبية المصطنعة الثانية' }));
  r = projectProfitability(db, users.manager, { project_id: w.project.id });
  assert.equal(r.cost.purchases_minor, 100000 + 200000);
  assert.notEqual(projectMarginFigures(db, '36t', w.project.id).digest, before, 'an acceptance taken on the gross figure reads as stale once the VAT is verified');
  // إشعار دائن من المورد بـ115 منها 15 ضريبة: التكلفة تنزل بصافيه.
  w.supplierCredit(a.payable.id, '115.00', '15.00');
  assert.equal(projectProfitability(db, users.manager, { project_id: w.project.id }).cost.purchases_minor, 100000 - 10000 + 200000);
});

/* ───── (4) الرصيد الافتتاحي من التسوية المعتمدة ───── */
test('cash forecast: the opening balance comes from the ledger balance of reconciled bank accounts plus final cash documents not yet posted; a typed figure is refused while a reconciliation exists, and stays labelled manual when none does', t => {
  const b = bankLedger(t), { db, users, tx } = b;
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'finance.forecast.view', note: 'تصريح تنبؤ مصطنع' }));
  // قبل أي تسوية: الرقم اليدوي مقبول ومسمّى يدويًا، ولا يُقبل أن يُكتب مصدره «تسوية بنكية».
  const before = cashForecastBoard(db, users.manager);
  assert.deepEqual([before.opening_balance_minor, before.opening_required, before.opening.source], [null, true, null]);
  const manual = cashForecastBoard(db, users.manager, { opening_balance: '500.00', opening_source: 'accountant' });
  assert.deepEqual([manual.opening_balance_minor, manual.opening.source], [50000, 'manual']);
  assert.throws(() => cashForecastBoard(db, users.manager, { opening_balance: '500.00', opening_source: 'bank_reconciliation' }), code('opening_source'), 'a reconciliation source is read by the platform, not typed');
  // شهر مطابق: رصيد افتتاحي، وإيداع بقيده ومطابقته، وتسوية بفرق صفر يعتمدها غير مُعدّها.
  b.journal('2026-07-31', [[b.accounts.bank, '10000.00'], [b.accounts.equity, 0, '10000.00']], 'OPEN-2026');
  const deposit = b.journal('2026-08-12', [[b.accounts.bank, '300.00'], [b.accounts.equity, 0, '300.00']], 'DEP-300');
  b.load(['2026-08-12,إيداع رأس مال,DEP-300,,300.00'], { opening: '10000.00', closing: '10300.00' });
  b.decide(b.propose({ transaction_id: b.line('إيداع رأس مال').id, members: [{ journal_id: deposit.id }] }).id);
  const rec = tx(() => bank.prepareReconciliation(db, users.employee, { bank_account_id: b.account.id, period_start: '2026-08-01', period_end: '2026-08-31', explanation: '' }));
  tx(() => bank.approveReconciliation(db, users.manager, rec.id, { version: 1, note: 'طابقت الكشف والدفتر بفرق صفر' }));
  // مالٌ خرج بعد التسوية بمستند نهائي لم يُرحَّل قيده بعد: عهدة بخمسين.
  b.custody('CUST-AFTER', 5000, '2026-09-02');
  const board = cashForecastBoard(db, users.manager);
  assert.equal(board.opening.source, 'bank_reconciliation');
  assert.equal(board.opening_source, 'bank_reconciliation');
  assert.deepEqual(board.opening.accounts.map(a => [a.bank_account_id, a.reconciled_to, a.ledger_balance_minor]), [[b.account.id, '2026-08-31', 1030000]]);
  assert.equal(board.opening.unposted_cash_minor, -5000);
  assert.equal(board.opening_balance_minor, 1025000, 'the reconciled ledger balance plus the cash that left since and is not posted yet');
  assert.equal(board.opening_required, false);
  assert.throws(() => cashForecastBoard(db, users.manager, { opening_balance: '1.00' }), code('opening_from_reconciliation'), 'a typed figure would override a reconciled one');
});
