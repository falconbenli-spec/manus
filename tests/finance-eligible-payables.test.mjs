// الحزمة 3 — حالة دفع المستحق في شاشة الدفتر المالي (listFinance.eligible_payables) من رؤية payable_balances لا من
// payment_orders.payable_id. قبلها: المستحق المدفوع في أمر مجمّع يقول «غير مدفوع» (الأمر المجمّع يحمل مستحقاته في سطوره)،
// والتحويل الراجع يُعدّ دفعًا، والإشعار الدائن لا ينقص المطلوب — فتقول الشاشة شيئًا وشاشة المدفوعات شيئًا آخر. بيانات مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listFinance } from '../app/finance.mjs';
import { visibilityWorld } from './visibility-fixture.mjs';

test('ledger screen: a payable paid inside a grouped order reads paid, a returned transfer is not payment, and a supplier credit lowers what is owed', t => {
  const w = visibilityWorld(t);
  const A = w.matchedPayable({ gross: '1150.00' }).payable.id, B = w.matchedPayable({ gross: '2300.00' }).payable.id, C = w.matchedPayable({ gross: '575.00' }).payable.id;
  // A وB في أمر مجمّع واحد بكامل مبلغيهما؛ C يُدفع ثم يرجع تحويله؛ وB عليه إشعار دائن من المورد قبل الدفع.
  w.supplierCredit(B, '115.00');
  w.payOrder({ lines: [{ payable_id: A, amount: '1150.00' }, { payable_id: B, amount: '2185.00' }] });
  const returned = w.payOrder({ payable_id: C, amount: '575.00' });
  w.returnOrder(returned, '575.00');
  // من يحمل «مصدر المشتريات» في الدفتر (employee في شهر الدفتر المصطنع) هو من يرى هذه القائمة.
  const rows = Object.fromEntries(listFinance(w.db, w.users.employee).eligible_payables.map(p => [p.id, p]));
  const balance = id => w.db.prepare('SELECT * FROM payable_balances WHERE payable_id=?').get(id);
  assert.deepEqual([rows[A].payment_status, rows[A].paid_minor], ['paid', 115000], 'paid inside a grouped order');
  assert.deepEqual([rows[B].payment_status, rows[B].adjusted_minor, rows[B].paid_minor], ['paid', 218500, 218500], 'owed less after the supplier credit, and fully paid');
  assert.deepEqual([rows[C].payment_status, rows[C].paid_minor, rows[C].returned_minor], ['not_paid', 0, 57500], 'a returned transfer is not payment');
  for (const id of [A, B, C]) assert.equal(rows[id].paid_minor, balance(id).paid_minor, 'the ledger screen and the payments view say the same number');
});
