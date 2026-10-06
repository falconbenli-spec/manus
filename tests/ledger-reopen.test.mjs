// الحزمة 3 — فتح الفترة المحاسبية المضبوط (الترحيل 168). المسبار على 3d1d84c أثبت أن الفترة المقفلة لا تنفتح بأي مسار:
// financeReferenceAction يرفض «reopen»، ومُطلِق finance_period_identity يرفض التحديث المباشر، وفتح قائمة الإقفال يعيد الشهر
// مفتوحًا والدفتر مقفلًا (ledger_locked=true)، فقيد تسوية بتاريخ داخل الشهر يُرفض بـperiod_closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { now, verifyAudit } from '../app/db.mjs';
import * as f from '../app/finance.mjs';
import { adopted } from '../app/options.mjs';
import { closeBoard, getClosePeriod, periodAction, RECLOSE_DAYS } from '../app/close-checklist.mjs';
import { reopenFixture, riyadhToday, plusDays } from './close-reopen-fixture.mjs';
import { closeChecklistUI } from '../app/static/cash-close-ui.mjs';

const code = value => error => error.code === value;
const thrown = run => { try { run(); } catch (error) { return error; } assert.fail('expected a refusal'); };
const helpers = { e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  button: (action, id, label) => `<button data-operation="${action}" data-id="${id}">${label}</button>`, money: m => m === null || m === undefined ? '—' : `${m / 100} SAR` };

test('the ledger does not reopen from the ledger screen or by a direct update: finance names the controlled path, and the database refuses the rest', t => {
  const x = reopenFixture(t);
  x.approveClose();
  assert.equal(x.fp().status, 'closed');
  const refusal = thrown(() => x.tx(() => f.financeReferenceAction(x.db, x.users.reviewer, 'periods', x.financePeriod.id, 'reopen', { version: x.fp().version, note: 'فتح مباشر من الدفتر' })));
  assert.equal(refusal.code, 'period_reopen_controlled');
  assert.match(refusal.details.refusal.next, /الإقفال الشهري/);
  assert.ok(refusal.details.refusal.missing[0].owner);
  assert.throws(() => x.db.prepare("UPDATE finance_periods SET status='open',closed_by=NULL,closed_at=NULL,close_evidence=NULL,version=version+1 WHERE id=?").run(x.financePeriod.id), /reopened through an approved reopening/);
  assert.throws(() => x.tx(() => f.financeReferenceAction(x.db, x.users.reviewer, 'periods', x.financePeriod.id, 'close', { version: x.fp().version, note: 'إقفال مكرر' })), code('transition_denied'));
  assert.ok(verifyAudit(x.db));
});

test('a checklist reopen request carries a ledger reopening; a third person with ledger authority approves it once the owner has set the re-close deadline, and the month takes a dated adjustment', t => {
  const x = reopenFixture(t);
  x.approveClose();
  const closedVersion = x.fp().version;
  assert.ok(!x.view('reviewer').actions.includes('request_reopen'), 'whoever closed does not ask to reopen');
  let state = x.requestReopen();
  assert.equal(state.status, 'approved', 'the close stays approved until a third person decides');
  const [pending] = x.reopenings();
  assert.deepEqual([pending.status, pending.period_version, pending.previous_closed_by, pending.requested_by, pending.close_reopening_id], ['pending', closedVersion, 'reviewer', 'closer', state.pending_reopen.id]);
  assert.equal(state.ledger_reopening.status, 'pending');
  // الطالب لا يقرر، ومن أقفل لا يقرر، ومن لا يحمل سلطة إقفال الدفتر لا يفتحه.
  assert.ok(!x.view('closer').actions.includes('approve_reopen'));
  assert.ok(!x.view('reviewer').actions.includes('approve_reopen'));
  assert.throws(() => x.approveReopen('closer'), code('invalid_state'));
  assert.throws(() => x.approveReopen('reviewer'), code('invalid_state'));
  const authority = thrown(() => x.approveReopen('nolock'));
  assert.equal(authority.code, 'ledger_reopen_authority');
  // الموعد قرار المالك: قبل اعتماده يُرفض الفتح ويُسمّى القرار ومالكه.
  assert.equal(adopted(x.db, '36t', RECLOSE_DAYS).value.days, null);
  const deadline = thrown(() => x.approveReopen('third'));
  assert.equal(deadline.code, 'reclose_deadline_unadopted');
  assert.ok(deadline.details.refusal.missing.some(item => item.document.includes(RECLOSE_DAYS)));
  assert.equal(x.fp().status, 'closed', 'nothing opened on a refusal');
  x.adopt(5);
  state = x.approveReopen('third');
  assert.deepEqual([state.status, state.ledger_locked, state.reopen_count], ['open', false, 1]);
  assert.deepEqual([x.fp().status, x.fp().version, x.fp().closed_by], ['open', closedVersion + 1, null]);
  const [approved] = x.reopenings();
  assert.deepEqual([approved.status, approved.decided_by, approved.reclose_days, approved.reclose_due_on], ['approved', 'third', 5, plusDays(riyadhToday(), 5)]);
  assert.equal(state.ledger_reopening.reclose_due_on, approved.reclose_due_on);
  const adjusted = x.adjustment('ADJ-AFTER-REOPEN');
  assert.equal(adjusted.status, 'posted', 'an adjustment dated inside the reopened month posts');
  const html = closeChecklistUI.render(closeBoard(x.db, x.users.reviewer), helpers);
  assert.ok(html.includes(approved.reclose_due_on), 'the screen shows the re-close deadline');
  assert.ok(!/undefined|NaN|\[object/.test(html));
  assert.ok(verifyAudit(x.db));
});

test('re-close relocks the ledger through the same checks and records who re-closed; the reopening is used once and its history never changes', t => {
  const x = reopenFixture(t);
  x.approveClose(); x.requestReopen(); x.adopt(5); x.approveReopen('third');
  // الإقفال المفتوح يُعاد عبر قائمته: الدفتر يرفض إقفاله المباشر ما دام الفتح ينتظر إعادة الإقفال.
  const direct = thrown(() => x.tx(() => f.financeReferenceAction(x.db, x.users.reviewer, 'periods', x.financePeriod.id, 'close', { version: x.fp().version, note: 'إقفال مباشر من الدفتر' })));
  assert.equal(direct.code, 'period_reclose_controlled');
  assert.throws(() => x.db.prepare("UPDATE finance_periods SET status='closed',closed_by='reviewer',closed_at=?,close_evidence='إقفال مباشر',version=version+1 WHERE id=?").run(now(), x.financePeriod.id), /closed with evidence/);
  // الفحوص نفسها: قيد غير مرحّل داخل الشهر يمنع إعادة الإقفال.
  const draft = x.adjustment('ADJ-DRAFT', { post: false });
  assert.equal(thrown(() => x.approveClose()).code, 'close_checks_failed');
  assert.equal(x.fp().status, 'open');
  let j = x.tx(() => f.journalAction(x.db, x.users.employee, draft.id, 'submit', { version: draft.version, note: 'تقديم مصطنع' }));
  j = x.tx(() => f.journalAction(x.db, x.users.reviewer, j.id, 'approve', { version: j.version, note: 'اعتماد مصطنع' }));
  x.tx(() => f.journalAction(x.db, x.users.reviewer, j.id, 'post', { version: j.version, note: 'ترحيل مصطنع' }));
  const reclosed = x.approveClose();
  assert.deepEqual([reclosed.status, reclosed.ledger_locked], ['approved', true]);
  assert.equal(x.fp().status, 'closed');
  const [row] = x.reopenings();
  assert.deepEqual([row.status, row.reclosed_by !== null, row.reclosed_by], ['approved', true, 'reviewer']);
  assert.throws(() => x.adjustment('ADJ-AFTER-RECLOSE'), code('period_closed'), 'the month is locked again');
  // الفتح المعتمد لا يُستعمل مرتين، والتاريخ لا يُعاد كتابته.
  assert.throws(() => x.db.prepare("UPDATE finance_periods SET status='open',closed_by=NULL,closed_at=NULL,close_evidence=NULL,version=version+1 WHERE id=?").run(x.financePeriod.id), /approved reopening/);
  assert.throws(() => x.db.prepare("UPDATE finance_period_reopenings SET reason='سبب مبدّل بصمت بعد القرار',version=version+1 WHERE id=?").run(row.id), /never rewritten/);
  assert.throws(() => x.db.prepare('DELETE FROM finance_period_reopenings WHERE id=?').run(row.id), /immutable/);
  // دورة ثانية: طلب جديد لنسخة الإقفال الجديدة.
  x.requestReopen('fourth');
  const second = x.reopenings().at(-1);
  assert.deepEqual([second.status, second.period_version], ['pending', x.fp().version]);
  assert.ok(verifyAudit(x.db));
});

test('a rejected reopening leaves the ledger locked and the close approved; another tenant never sees the request', t => {
  const x = reopenFixture(t);
  x.approveClose(); x.requestReopen();
  const state = x.act('third', 'reject_reopen', { note: 'الفاتورة تخص الشهر التالي ولا تستوجب فتح هذا الإقفال' });
  assert.deepEqual([state.status, state.ledger_locked], ['approved', true]);
  assert.equal(x.fp().status, 'closed');
  assert.deepEqual(x.reopenings().map(r => [r.status, r.decided_by]), [['rejected', 'third']]);
  assert.throws(() => getClosePeriod(x.db, x.users.external, x.period.id), code('not_found'));
  assert.throws(() => x.tx(() => periodAction(x.db, x.users.external, x.period.id, 'approve_reopen', { version: 1, note: 'محاولة من كيان آخر لفتح الإقفال' })), code('not_found'));
  assert.ok(verifyAudit(x.db));
});
