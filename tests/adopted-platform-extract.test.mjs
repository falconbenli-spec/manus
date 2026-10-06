import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import '../app/leave.mjs';
import { hrPolicyBoard } from '../app/hr-policies.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { decideSchedule } from '../app/discipline.mjs';
import { obligations } from '../app/obligations.mjs';

// مستخرج المنصة (tenant_id فارغ) يبقى مسودة بعد قبوله لأن القبول يكتب نسخة للكيان. قبل هذا الإصلاح بقي المستخرج
// في «بانتظار قراري» بعد اعتماد نسخة الكيان، وكان قبوله مرة ثانية يكتب نسخة نافذة ثانية. كُشف على القاعدة الحية في 21 سبتمبر 2026.
const code = value => error => error.code === value;
const NOTE = 'اعتماد مصطنع لاختبار المستخرج المعتمد، بلا مطابقة على نسخة موقعة';

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-adopted-extract-tests-only'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  transaction(db, () => grantAccess(db, users.admin, { user_id: 'manager', capability: 'hr.policy.accept', department_id: '', note: 'اختبار اعتماد السياسات' }));
  return { db, users, tx: f => transaction(db, f) };
}
const waiting = (db, u) => hrPolicyBoard(db, u).awaiting_me.map(r => r.id);

test('an adopted platform extract stops waiting for a decision, says who adopted it, and refuses a second acceptance', t => {
  const { db, users, tx } = fixture(t), u = users.manager;
  assert.ok(waiting(db, u).includes('reg-seed-travel'));
  assert.ok(waiting(db, u).includes('discipline-regulation-v1'));
  const inboxBefore = obligations(db, u).items.filter(i => i.source === 'hr-policies').map(i => i.id);
  assert.ok(inboxBefore.includes('reg-seed-travel'));
  tx(() => decideRule(db, u, 'reg-seed-travel', 'accept', { effective_from: '2026-09-21', choices: {}, note: NOTE }));
  tx(() => decideSchedule(db, u, 'discipline-regulation-v1', 'accept', { effective_from: '2026-09-21', note: NOTE }));
  assert.ok(!waiting(db, u).includes('reg-seed-travel'));
  assert.ok(!waiting(db, u).includes('discipline-regulation-v1'));
  const inboxAfter = obligations(db, u).items.filter(i => i.source === 'hr-policies').map(i => i.id);
  assert.ok(!inboxAfter.includes('reg-seed-travel'), 'the inbox reads the same board, so the item leaves it too');
  assert.ok(!inboxAfter.includes('discipline-regulation-v1'));
  const row = hrPolicyBoard(db, u).policies?.find?.(r => r.id === 'reg-seed-travel') ?? Object.values(hrPolicyBoard(db, u)).flat().find(r => r?.id === 'reg-seed-travel');
  assert.equal(row.adopted_copy.effective_from, '2026-09-21');
  assert.equal(row.adopted_copy.decided_by_name, u.name);
  assert.deepEqual(row.blocked_while_unaccepted, [], 'nothing is blocked once the tenant copy is in force');
  // والباب نفسه مغلق: لا نسخة نافذة ثانية من المستخرج نفسه.
  assert.throws(() => tx(() => decideRule(db, u, 'reg-seed-travel', 'accept', { effective_from: '2026-10-01', choices: {}, note: NOTE })), code('already_adopted'));
  assert.throws(() => tx(() => decideSchedule(db, u, 'discipline-regulation-v1', 'accept', { effective_from: '2026-10-01', note: NOTE })), code('already_adopted'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM regulation_policies WHERE based_on='reg-seed-travel' AND status='accepted'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM discipline_schedules WHERE source_id='discipline-regulation-v1' AND status='accepted'").get().n, 1);
  // مستخرج لم يعتمده الكيان يبقى منتظرًا كما كان.
  assert.ok(waiting(db, u).includes('reg-seed-deductions'));
});
