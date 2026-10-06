// الحزمة 3 — سحب الدفعة المقدمة يُحتسب تحصيلًا على استحقاقه (الترحيل 177). قبله: السحب يسمّي فاتورته نصًّا، ويسدّد الذمة في
// الدفتر، ومنظور التحصيل الواحد (ar_claim_collection) لا يراه — فيبقى الاستحقاق «غير محصَّل» بمبلغ غطّته الدفعة المقدمة،
// ويقبل قادح القبض قبضًا ثانيًا عليه حتى صافيه: تحصيل مكرر. هنا: السحب المربوط يُرى في المنظور وفي كل قارئ يقرؤه، والقبض
// الثاني يُرفض، والسحب لا يتجاوز الباقي، والربط صحيح وثابت، والسحوبات القائمة تُربط حين يطابق نصّها رقم فاتورة حرفيًا.
// بيانات مصطنعة كلها، في قاعدة بالذاكرة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as billing from '../app/billing-recurring.mjs';
import * as ar from '../app/receivables.mjs';
import { visibilityWorld, riyadhDay, EVIDENCE } from './visibility-fixture.mjs';

const code = value => error => error.code === value || String(error.message).includes(value);

function world(t) {
  const m = visibilityWorld(t), { db, users, tx } = m;
  // دفعة مقدمة مدفوعة لمشروع العميل نفسه: الملف التجاري يُشتق من المشروع، فالاستحقاق والدفعة لعميل واحد.
  const advance = (k, amount) => {
    // عميل الدفعة عميل الصفقة نفسه: الصفقة تُفتح من ملف عميلها (الترحيل 182)، والدفعة لعميل مشروعها.
    const { id } = tx(() => billing.recordAdvance(db, users.manager, { client_id: k.case.client_id, schedule_id: '', project_id: k.project.id,
      description: 'دفعة مقدمة مصطنعة على اتفاق تجريبي', agreement_reference: 'بند 7-3 من الاتفاق المصطنع', amount }));
    const row = db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(id);
    tx(() => billing.confirmAdvance(db, users.outsider, id, { version: row.version, amount, received_on: riyadhDay(), evidence: 'كشف حساب بنكي مصطنع يطابق الحوالة', reference: `ADV-${id.slice(0, 6)}` }));
    return db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(id);
  };
  const plan = (a, input) => tx(() => billing.planDraw(db, users.manager, a.id, input));
  const apply = (drawId, amount) => { const row = db.prepare('SELECT * FROM advance_draws WHERE id=?').get(drawId);
    return tx(() => billing.applyDraw(db, users.manager, drawId, { version: row.version, amount, note: '' })); };
  const record = (claim, amount, reference) => tx(() => ar.recordReceipt(db, users.employee, claim.id, { reference, amount, received_on: riyadhDay(), payer: 'شركة العميل المصطنعة', evidence: EVIDENCE }));
  return { ...m, advance, plan, apply, record };
}

test('advance draws: a draw tied to its claim counts as collection there, so a second receipt for money the advance covered is refused', t => {
  const w = world(t), k = w.customer({ lines: [['حملة مصطنعة', '1000.00']] }), [claim] = k.claims;
  const a = w.advance(k, '500.00');
  const board = w.tx(() => billing.schedulesBoard(w.db, w.users.manager)).advances.find(x => x.id === a.id);
  assert.deepEqual(board.claims.map(c => [c.id, c.room_minor]), [[claim.id, 115000]], 'the eligible claim is offered with its room');
  const planned = w.plan(a, { claim_id: claim.id, amount: '500.00' });
  assert.equal(planned.claim_id, claim.id);
  w.apply(planned.id, '500.00');
  const s = w.collection(claim.id);
  assert.deepEqual([s.net_minor, s.drawn_minor, s.allocated_minor, s.received_minor], [115000, 50000, 50000, 0], 'the drawn money is applied to the claim');
  assert.throws(() => w.record(claim, '1150.00', 'SYN-DOUBLE'), /exceed|يتجاوز|net/i, 'a receipt for the full claim would collect the advance twice');
  const rest = w.record(claim, '650.00', 'SYN-REST');
  assert.ok(rest.id, 'the remainder after the draw is still collectable');
  const drawRow = w.tx(() => billing.schedulesBoard(w.db, w.users.manager)).advances.find(x => x.id === a.id).draws[0];
  assert.equal(drawRow.claim_label, k.invoices[0].number, 'the draw names the invoice it settles');
});

test('advance draws: a draw never takes a claim past its net — refused by name at planning and at application, and by the database underneath', t => {
  const w = world(t), k = w.customer({ lines: [['تقرير مصطنع', '100.00']] }), [claim] = k.claims;
  const r = w.record(claim, '100.00', 'SYN-PART');
  w.tx(() => ar.receiptAction(w.db, w.users.manager, claim.id, r.id, 'confirm', { note: 'طابقت كشف الحساب', matching_evidence: 'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ' }));
  const a = w.advance(k, '300.00');
  assert.throws(() => w.plan(a, { claim_id: claim.id, amount: '50.00' }), code('draw_exceeds_claim'), 'only 15.00 remains after the receipt');
  const planned = w.plan(a, { claim_id: claim.id, amount: '15.00' });
  w.apply(planned.id, '15.00');
  assert.equal(w.collection(claim.id).allocated_minor, 1500);
  // تخطيطٌ ثانٍ لا يجد باقيًا، والقادح تحت الشيفرة: تطبيقٌ يتجاوز الصافي يُرفض في القاعدة نفسها.
  assert.throws(() => w.plan(a, { claim_id: claim.id, amount: '1.00' }), code('draw_claim_ineligible'));
  const other = w.plan(a, { target_reference: 'فاتورة لاحقة مصطنعة', amount: '10.00' });
  assert.throws(() => w.db.exec(`UPDATE advance_draws SET claim_id='${claim.id}',version=version+1 WHERE id='${other.id}'`), /fixed when it is planned/);
});

test('advance draws: the claim is found from an exact invoice number, an unmatched reference stays unlinked, and another customer\'s claim is refused', t => {
  const w = world(t), k = w.customer({ lines: [['حملة مصطنعة', '200.00']] }), [claim] = k.claims;
  const stranger = w.customer({ lines: [['عميل آخر مصطنع', '200.00']] });
  const a = w.advance(k, '400.00');
  const byNumber = w.plan(a, { target_reference: ` ${k.invoices[0].number} `, amount: '100.00' });
  assert.equal(byNumber.claim_id, claim.id, 'an exact invoice number links the draw');
  const loose = w.plan(a, { target_reference: 'فاتورة الشهر القادم', amount: '50.00' });
  assert.equal(loose.claim_id, null, 'a reference that matches no issued invoice is not guessed');
  w.apply(loose.id, '50.00');
  assert.equal(w.collection(claim.id).drawn_minor, 0, 'an unlinked draw is not collection on any claim');
  assert.throws(() => w.plan(a, { claim_id: stranger.claims[0].id, amount: '10.00' }), code('draw_claim_ineligible'));
  assert.throws(() => w.db.prepare("INSERT INTO advance_draws(id,tenant_id,advance_id,target_reference,amount_minor,status,requested_by,created_at,updated_at,claim_id) VALUES('dx','36t',?,'مرجع مصطنع',100,'ready','manager',?,?,?)")
    .run(a.id, new Date().toISOString(), new Date().toISOString(), stranger.claims[0].id), /same customer/);
});

test('migration 177: an existing draw is linked by the migration\'s own statement only when its text equals one issued invoice number of the same customer', t => {
  const w = world(t), k = w.customer({ lines: [['حملة مصطنعة', '300.00']] }), [claim] = k.claims, a = w.advance(k, '300.00');
  const at = new Date().toISOString();
  // سحبان قائمان قبل 177: نصٌّ يطابق رقم الفاتورة، ونصٌّ لا يطابق.
  const insert = w.db.prepare("INSERT INTO advance_draws(id,tenant_id,advance_id,target_reference,amount_minor,status,requested_by,created_at,updated_at) VALUES(?,'36t',?,?,?,'ready','manager',?,?)");
  insert.run('legacy-match', a.id, k.invoices[0].number, 10000, at, at);
  insert.run('legacy-loose', a.id, 'دفعة على الحساب بلا فاتورة', 5000, at, at);
  const migration = readFileSync(new URL('../app/migrations/177-advance-draw-claims.sql', import.meta.url), 'utf8');
  const backfill = migration.match(/UPDATE advance_draws SET claim_id=\([\s\S]*?\)\)\)\)=1;/)[0];
  const fixed = w.db.prepare("SELECT sql FROM sqlite_master WHERE name='advance_draws_claim_fixed'").get().sql;
  w.db.exec('DROP TRIGGER advance_draws_claim_fixed'); w.db.exec(backfill); w.db.exec(fixed);
  const rows = Object.fromEntries(w.db.prepare("SELECT id,claim_id,version FROM advance_draws WHERE id LIKE 'legacy-%'").all().map(r => [r.id, r]));
  assert.equal(rows['legacy-match'].claim_id, claim.id);
  assert.equal(rows['legacy-match'].version, 2, 'the versioned trigger saw the link as a step');
  assert.equal(rows['legacy-loose'].claim_id, null);
});
