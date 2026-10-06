// تاريخ القيد يوم الحدث بتوقيت الرياض (app/riyadh-time.mjs). قبل هذا كان مصدر الدفتر يأخذ أول عشرة أحرف من طابع UTC:
// مصروفٌ تعتمده المالية الساعة 00:30 بتوقيت الرياض من 1 أكتوبر يُقيَّد بتاريخ 30 سبتمبر — في الشهر السابق وفترته — وكذلك
// إقفال العهدة ورصيده. الساعة مثبتة داخل الفجوة (21:30 UTC = 00:30 الرياض). بيانات مصطنعة كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as expenses from '../app/expenses.mjs';
import { sourceKind } from '../app/ledger-sources.mjs';
import { pinClock } from './riyadh-clock.mjs';
import { visibilityWorld } from './visibility-fixture.mjs';

test('ledger dates: an expense approved by finance at 00:30 Riyadh on 1 October is dated 1 October in the journal and in the pending list, not 30 September', t => {
  const w = visibilityWorld(t), { db, users, tx } = w;
  pinClock(t, '2026-09-30T21:30:00.000Z');
  const claim = tx(() => expenses.submitClaim(db, users.it, { expense_date: '2026-09-30', category: 'supplies', description: 'مستلزمات تصوير مصطنعة', amount: '120.00', receipt_reference: 'RCPT-GAP-1' }));
  const act = (who, action, values) => tx(() => expenses.claimAction(db, users[who], claim.id, action, { version: db.prepare('SELECT version FROM expense_claims WHERE id=?').get(claim.id).version, ...values }));
  act('manager', 'manager_approve', { note: 'المصروف ضمن عمل الحملة المصطنعة' });
  act('outsider', 'finance_approve', { note: 'طابقت الإيصال المصطنع مع المبلغ' });
  assert.equal(db.prepare('SELECT finance_decided_at FROM expense_claims WHERE id=?').get(claim.id).finance_decided_at.slice(0, 10), '2026-09-30', 'stored in UTC, the day before');
  const kind = sourceKind('expense_claim');
  assert.equal(kind.build(db, users.manager, claim.id).date, '2026-10-01');
  assert.equal(kind.pending(db, '36t').find(p => p.source_id === claim.id).date, '2026-10-01');
});

test('migration 178: a promise to pay made at 01:00 Riyadh on 1 October cannot be dated 30 September, even written past the code', t => {
  const w = visibilityWorld(t), { db, users } = w;
  const [claim] = w.customer({ lines: [['حملة مصطنعة', '100.00']] }).claims;
  const insert = (id, promisedOn) => db.prepare('INSERT INTO ar_promises(id,claim_id,amount_minor,promised_on,contact,evidence,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, claim.id, '5000', promisedOn, 'ممثل العميل المصطنع', 'رسالة بريد مصطنعة من العميل بالموعد', users.employee.id, '2026-09-30T22:00:00.000Z');
  assert.throws(() => insert('promise-yesterday', '2026-09-30'), /on or after the day it was made/, 'yesterday in Riyadh, though the UTC stamp still says 30 September');
  insert('promise-today', '2026-10-01');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ar_promises WHERE id='promise-today'").get().n, 1);
});
