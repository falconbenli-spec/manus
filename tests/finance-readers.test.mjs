// الحزمة 3 — القرّاء القدامى للرصيد: كل شاشة وتقرير يقرأ ما على المورد وما على العميل من المصدر الواحد نفسه.
// الرؤيتان payable_balances (الترحيل 166) وar_claim_collection (الترحيل 170) هما التعريف الذي تفرضه قيود القاعدة، وكان
// سبعة قرّاء يحسبون «المدفوع» و«المقبوض» بطريقتهم: أمر واحد = دفعة واحدة على payment_orders.payable_id (فالأمر المجمّع
// يُنسب كله لأول مستحق، والمرتجع يبقى «مدفوعًا»، والإشعار الدائن من المورد لا ينقص شيئًا)، والقبض المرتد «محصَّل»،
// والإشعار الدائن للعميل لا يخفض ذمته، والتخصيص من قبضه على الحساب لا يسوّيها.
//
// كل اختبار هنا يبني الحالة بالمسارات الحقيقية (tests/visibility-fixture.mjs) ثم يسأل القرّاء السبعة سؤالًا واحدًا، ويطابق
// الجواب بالرؤية نفسها. بيانات مصطنعة كلها في قاعدة بالذاكرة.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as billing from '../app/billing-recurring.mjs';
import * as ledger from '../app/ledger.mjs';
import { runReport } from '../app/reports.mjs';
import { cashForecastBoard } from '../app/cash-forecast.mjs';
import { supplierSettlementAxis, financialChecklist } from '../app/project-axes.mjs';
import { verifyAudit } from '../app/db.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';

const sar = minor => Math.round(minor) / 100;
const outstandingOf = (db, id) => db.prepare('SELECT outstanding_minor FROM payable_balances WHERE payable_id=?').get(id).outstanding_minor;
const streamTotal = (board, stream) => board.streams.find(s => s.stream === stream)?.amount_minor ?? 0;

// مستحقان لمورد واحد: A بـ1150 وB بـ2300. دفعة جزئية على A، وأمر مجمّع على A وB يرجع من البنك برسوم ريال، ودفعة على B،
// وإشعار دائن من المورد على B بـ100، وأمر معتمد لم يُنفّذ على A، وأمر معلّق على B.
function suppliers(t) {
  const w = visibilityWorld(t);
  const A = w.matchedPayable({ gross: '1150.00' }).payable.id, B = w.matchedPayable({ gross: '2300.00' }).payable.id;
  w.payOrder({ payable_id: A, amount: '500.00' });
  const batch = w.payOrder({ lines: [{ payable_id: A, amount: '650.00' }, { payable_id: B, amount: '1000.00' }] });
  w.returnOrder(batch, '1649.00');
  w.payOrder({ payable_id: B, amount: '700.00' });
  w.supplierCredit(B, '100.00');
  const approved = w.approve(w.prepare({ payable_id: A, amount: '200.00' }));
  const pending = w.prepare({ payable_id: B, amount: '300.00' });
  return { ...w, A, B, batch, approved, pending };
}

test('suppliers: the ledger statement, R32, the executive pulse, the cash forecast and the project settlement axis all read payable_balances — a batch, a partial payment, a return and a supplier credit note included', t => {
  const w = suppliers(t), { db, users, A, B } = w;
  // المصدر: A عليه 1150 − 500 = 650، وB عليه 2300 − 100 (إشعار) − 700 = 1500؛ والمرتجع لا يُحسب مدفوعًا.
  assert.deepEqual([outstandingOf(db, A), outstandingOf(db, B)], [65000, 150000], 'the view itself, the one definition every reader must agree with');

  const statement = ledger.statements(db, users.manager).suppliers.find(s => s.supplier_key === 'LOCAL-A');
  assert.deepEqual([statement.matched_minor, statement.paid_minor, statement.balance_minor], [345000, 120000, 215000],
    'the statement counts executed payments that did not come back, through their lines, and lowers the balance by the supplier credit note');
  assert.equal(statement.adjustments_minor, -10000, 'the approved supplier credit note is named on the statement');
  assert.equal(statement.approved_unpaid_minor, 20000, 'an approved order not yet executed is a commitment, not a payment');

  const r32 = runReport(db, users.manager, 'R32', { from: `${w.month}-01`, to: w.day });
  const row = key => r32.rows.find(r => r.reference === key);
  assert.deepEqual([row('INV-1').outstanding, row('INV-1').paid, row('INV-2').outstanding, row('INV-2').paid, row('INV-2').adjustments], [650, 500, 1500, 700, -100]);
  assert.equal(r32.totals.outstanding, 2150, 'what is still owed across both payables');

  const pulse = runReport(db, users.manager, 'R01', { from: `${w.month}-01`, to: w.day }).rows.find(r => r.metric.startsWith('مستحقات موردين'));
  assert.equal(pulse.value, 2150, 'the executive pulse names the same unpaid figure');

  const board = cashForecastBoard(db, users.manager);
  assert.equal(streamTotal(board, 'approved_payment_orders'), 20000, 'the approved order is a confirmed outflow');
  // ما لا أمر معتمد عليه: A بـ650 ناقص الأمر المعتمد 200 = 450، وB بـ1500 كاملًا (الأمر المعلّق لم يعتمده أحد).
  assert.equal(streamTotal(board, 'matched_payables_unordered'), 195000, 'the rest of each payable is an expected outflow, not zero because an order once touched it');

  const axis = supplierSettlementAxis(db, w.project);
  assert.deepEqual([axis.payable_minor, axis.executed_minor], [335000, 120000], 'adjusted liability and money that actually left and stayed out');
  assert.deepEqual(axis.outstanding.map(o => [o.payable_id, o.outstanding_minor]).sort((a, b) => a[1] - b[1]), [[A, 65000], [B, 150000]]);
  assert.equal(axis.state, 'payment_approved', 'an approved order is in flight on A');
  const liabilities = financialChecklist(db, w.project).find(l => l.key === 'supplier_liabilities');
  assert.ok(liabilities.outstanding.some(o => o.code === 'payable_not_settled' && o.item.includes('650.00')), 'the closure checklist names what is left, not the invoice total');
  assert.ok(verifyAudit(db));
});

// عميل ببندين: 115 و230. قبضٌ كامل على الأول يرتد بقرار ثالث؛ وإشعار دائن بـ23 على الثاني، وقبض على الحساب بـ100 يُخصَّص
// عليه، وقبض مباشر بـ50. الباقي على العميل: 115 + (230 − 23 − 100 − 50) = 172.
function customers(t) {
  const w = visibilityWorld(t);
  const k = w.customer();
  const [one, two] = k.claims;
  const r1 = w.receipt(one, '115.00', 'VIS-R1');
  w.reverseReceipt(one, r1);
  w.creditNote(k.invoices[1], '23.00');
  const cash = w.onAccount(k.case.id, '100.00', 'VIS-ACC-1');
  w.allocate(cash, [{ claim_id: two.id, amount: '100.00' }]);
  w.receipt(two, '50.00', 'VIS-R2');
  return { ...w, k, one, two };
}

test('customers: the ledger statement, R31 aging, the executive pulse and the cash forecast read ar_claim_collection — a reversed receipt is not collected, a credit note lowers the claim, an allocation settles it', t => {
  const w = customers(t), { db, users, k, one, two } = w;
  const view = w.collection(two.id);
  assert.deepEqual([w.collection(one.id).received_minor, view.net_minor, view.received_minor, view.allocated_minor], [0, 20700, 5000, 10000]);

  const statement = ledger.statements(db, users.manager).customers.find(c => c.id === k.case.id);
  assert.deepEqual([statement.invoiced_minor, statement.credited_minor, statement.received_minor, statement.allocated_minor, statement.balance_minor], [34500, 2300, 5000, 10000, 17200],
    'the reversed receipt is not money received, and the allocation from cash on account settles the claim');
  assert.ok(statement.movements.some(m => m.reference === 'REV-VIS-R1' && m.amount_minor === 11500), 'the reversal is a movement that reopens the balance');

  const aging = runReport(db, users.manager, 'R31', { from: `${w.month}-01`, to: w.day });
  const rows = aging.rows.filter(r => r.customer === k.case.name).sort((a, b) => a.balance - b.balance);
  assert.deepEqual(rows.map(r => [r.amount, r.received, r.balance]), [[207, 150, 57], [115, 0, 115]], 'net of the credit note, collected net of the reversal plus the allocation');
  assert.equal(aging.totals.balance, 172);

  const pulse = runReport(db, users.manager, 'R01', { from: `${w.month}-01`, to: w.day }).rows.find(r => r.metric.startsWith('رصيد ذمم العملاء'));
  assert.equal(pulse.value, 172);

  const board = cashForecastBoard(db, users.manager);
  assert.equal(streamTotal(board, 'invoiced_receivables'), 17200, 'what is still to be collected on issued invoices, not the gross claim minus confirmed receipts');
  assert.ok(verifyAudit(db));
});

// قائمة الإقفال المالي للمشروع تعدّ كل مستند مالي له قيد في الدفتر: الدفعة المقدمة وسحبها وارتدادها، والدفعة المجمّعة بسطورها،
// ومرتجع دفعة المورد — كانت كلها خارج بند «مستندات المشروع المالية مرحّلة في الدفتر».
test('project closure: the journals line counts the project\'s advance receipt, draw and reversal, a batch payment through its lines, and a returned supplier payment', t => {
  const w = suppliers(t), { db, users, tx } = w;
  const { id } = tx(() => billing.recordAdvance(db, users.manager, { client_id: w.client.id, schedule_id: '', project_id: w.project.id, description: 'دفعة مقدمة مصطنعة على المشروع', agreement_reference: 'بند 7-3 من الاتفاق المصطنع', amount: '500.00' }));
  tx(() => billing.confirmAdvance(db, users.outsider, id, { version: db.prepare('SELECT version FROM advance_invoices WHERE id=?').get(id).version, amount: '500.00', received_on: riyadhDay(), evidence: 'كشف حساب بنكي مصطنع يطابق الحوالة', reference: 'ADV-VIS-1' }));
  w.draw(id, 'INV-VIS-TARGET', '100.00');
  w.reverseAdvance(id, '50.00');
  const journals = financialChecklist(db, w.project).find(l => l.key === 'journals');
  const kinds = new Set(journals.outstanding.map(o => o.ref.split(':')[1]));
  for (const kind of ['advance_receipt', 'advance_draw', 'advance_reversal', 'supplier_payment', 'supplier_payment_return'])
    assert.ok(kinds.has(kind), `${kind}: a project document with no posted journal is named on the closure checklist`);
  // الدفعة المجمّعة سطرٌ واحد لأمرها، لا سطر لكل مستحق فيها.
  const batchRefs = journals.outstanding.filter(o => o.ref === `journal:supplier_payment:${w.batch.id}`);
  assert.equal(batchRefs.length, 1);
});

// التتبّع من فاتورة المورد إلى دفعاتها بسطور الأوامر: الأمر المجمّع تسويةٌ لكل مستحق فيه بالجزء الذي دفعه، والدفعة تسمّي كل
// مستحق سوّته. كان الرابط يقرأ payment_orders.payable_id، فالمستحق الثاني في أمر مجمّع «ما انصرف له أمر دفع للحين».
test('trace: a batch payment settles every invoice it pays, by the part it paid, and the payment names each invoice it settles', t => {
  const w = suppliers(t), { db, users, A, B, batch } = w;
  const settlementOf = id => ledger.traceAmount(db, users.manager, { kind: 'supplier_invoice', id }).chain.find(s => s.step === 'settlement');
  const onB = settlementOf(B);
  assert.equal(onB.state, 'linked');
  const batchOnB = onB.items.find(i => i.id === batch.id);
  assert.ok(batchOnB, 'the batch order is a settlement of the second payable in it, not only of the first');
  assert.deepEqual([batchOnB.applied_minor, batchOnB.amount_minor], [100000, 165000], 'the part of the transfer that went to this invoice, and the transfer itself');
  assert.equal(settlementOf(A).items.filter(i => i.kind === 'supplier_payment').length, 3, 'A: the partial payment, the batch and the approved order');
  const settles = ledger.traceAmount(db, users.manager, { kind: 'supplier_payment', id: batch.id }).chain.find(s => s.step === 'settles');
  assert.deepEqual(settles.items.map(i => [i.id, i.settled_minor]).sort((a, b) => a[1] - b[1]), [[A, 65000], [B, 100000]]);
});
