// الحزمة 3 — طابور الاستثناءات المالية (app/finance-exceptions.mjs، الترحيل 171). الاستثناء يُحسب من مصدره ولا يُخزَّن: فاتورة مورد
// موقوفة، وسطر كشف بلا قرار، ومستند نهائي بلا قيد مرحّل، وفرق حساب رقابي، وإعادة إقفال فات موعدها، وعكسٌ ينتظر اعتماده، ووعد سداد
// ما انوفى. لكلٍّ مالكٌ بتصريحه، وإقرارٌ إلحاقي يسجّل من رآه وماذا سيفعل. وما قراره في «أقرّر» أصلًا (عكس ينتظر معتمده، ضريبة تنتظر
// التحقق) يُعرض هنا ولا يُعدّ في الصندوق مرة ثانية. الساعة مضبوطة في الاختبار (t.mock.timers) ليصير الوعد متأخرًا والموعد فائتًا
// بلا انتظار. بيانات مصطنعة كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyAudit, now } from '../app/db.mjs';
import * as f from '../app/finance.mjs';
import * as ar from '../app/receivables.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import { grantAccess } from '../app/access.mjs';
import { exceptionsBoard, acknowledgeException, EXCEPTION_KINDS } from '../app/finance-exceptions.mjs';
import { inbox, clearInboxCache } from '../app/inbox.mjs';
import { createApp } from '../app/server.mjs';
import { financeExceptionsUI } from '../app/static/finance-exceptions-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';
import { reopenFixture } from './close-reopen-fixture.mjs';
import { dispatch } from './definitions-fixture.mjs';

const code = value => error => error.code === value;
const at = iso => Date.parse(iso);
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = { e, money: minor => minor === null || minor === undefined ? '—' : String(minor / 100), tr: ar => ar, lang: 'ar', ui: kit(e, ar => ar), date: String,
  button: (action, id, label) => `<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>` };

// شهر مصطنع في سبتمبر 2026: كل نوع من الاستثناءات مرة، ثم يُقدَّم الساعة يومين فيفوت موعد الوعد.
function world(t) {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-09-10T07:00:00.000Z') });
  const w = visibilityWorld(t), { db, users, tx } = w;
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve'], ['manager', 'finance.close.manage']])
    tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مالي مصطنع لطابور الاستثناءات' }));
  const held = w.matchedPayable({ gross: '1150.00' });
  const waiting = w.matchedPayable({ gross: '2300.00' });
  w.inputTax(waiting.invoice.id, '300.00', { verify: false });
  const k = w.customer();
  const [one, two] = k.claims;
  const r1 = w.receipt(one, '115.00', 'EXC-R1');
  const reversal = tx(() => ar.requestReceiptReversal(db, users.employee, one.id, r1.id, { reason: 'الشيك رجع من بنك العميل لعدم كفاية الرصيد', evidence: 'إشعار ارتداد مصطنع من البنك محفوظ', effective_on: riyadhDay() }));
  const promise = tx(() => ar.recordPromise(db, users.employee, two.id, { amount: '100.00', promised_on: '2026-09-10', contact: 'مدير مالية العميل المصطنع', evidence: 'رسالة بريد مصطنعة من العميل بموعد السداد' }));
  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'حساب الاستثناءات المصطنع', bank_name: 'بنك مصطنع', account_tail: '6060', gl_account_id: w.accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف الاستثناءات', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: 'exceptions.csv', period_start: '2026-09-01', period_end: '2026-09-10', opening_balance: '0.00', closing_balance: '42.00',
    content: ['date,description,reference,debit,credit', '2026-09-09,حوالة واردة مجهولة,UNK-1,,42.00'].join('\n') }));
  const line = db.prepare("SELECT * FROM bank_transactions WHERE reference='UNK-1'").get();
  // قيد يدوي على حساب ذمم العملاء بلا مستند: فرق في الحساب الرقابي لا يسوّيه مستند.
  const stray = w.post(tx(() => f.createJournal(db, users.employee, { period_id: w.period.id, entry_date: riyadhDay(), description: 'قيد يدوي مصطنع على الذمم بلا مستند', evidence: 'دليل مصطنع', currency: 'SAR', source_reference: 'MAN-AR-1',
    lines: [{ account_id: w.accounts.receivable.id, cost_center_id: w.centres.GEN.id, debit: '10.00', credit: '0', memo: 'مدين' }, { account_id: w.accounts.revenue.id, cost_center_id: w.centres.GEN.id, debit: '0', credit: '10.00', memo: 'دائن' }] })));
  t.mock.timers.setTime(at('2026-09-12T07:00:00.000Z'));
  clearInboxCache();
  const board = (who = 'manager') => exceptionsBoard(db, users[who]);
  const find = (who, kind, pred = () => true) => board(who).exceptions.find(x => x.kind === kind && pred(x));
  return { ...w, held, waiting, k, one, two, r1, reversal, promise, account, line, stray, board, find };
}

test('exceptions: each kind is computed from its source with its owner, and what already waits as a decision elsewhere is listed but not counted in the inbox twice', t => {
  const w = world(t), { db, users } = w;
  const list = w.board('manager').exceptions;
  assert.equal(new Set(list.map(x => x.key)).size, list.length, 'one exception per key');
  assert.ok(list.every(x => x.owner && x.owner_role && EXCEPTION_KINDS[x.kind] && x.title && x.link), 'every exception names its owner, its kind, what it is and where it is resolved');
  const missingTax = w.find('manager', 'held_invoice', x => x.source_id === w.held.payable.id);
  assert.deepEqual([missingTax.reason, missingTax.inbox, missingTax.amount_minor], ['input_tax_missing', true, 115000], 'a VAT-registered supplier with no tax record holds its invoice out of the ledger');
  const pendingTax = w.find('manager', 'held_invoice', x => x.source_id === w.waiting.payable.id);
  assert.deepEqual([pendingTax.reason, pendingTax.inbox], ['input_tax_pending', false], 'its verification is already a decision in the inbox');
  assert.equal(list.some(x => x.kind === 'unposted_source' && [w.held.payable.id, w.waiting.payable.id].includes(x.source_id)), false, 'a held invoice is one exception, not also an unposted document');
  const unposted = w.find('manager', 'unposted_source', x => x.source_kind === 'ar_receipt' && x.source_id === w.r1.id);
  assert.deepEqual([unposted.inbox, unposted.amount_minor], [true, 11500]);
  assert.deepEqual([w.find('manager', 'reversal_awaiting_approval', x => x.source_id === w.reversal.id).inbox], [false], 'the reversal waits in the approver\'s inbox already');
  const promise = w.find('manager', 'broken_promise');
  assert.deepEqual([promise.amount_minor, promise.inbox, promise.date], [10000, true, '2026-09-10']);
  const lineException = w.find('employee', 'unmatched_bank_line');
  assert.deepEqual([lineException.source_id, lineException.amount_minor, lineException.inbox], [w.line.id, 4200, true]);
  const control = w.find('manager', 'control_difference', x => x.source_id === w.stray.id);
  assert.ok(control && control.inbox, 'a journal on the receivables control account with no document is a named difference');
  assert.equal(list.some(x => x.kind === 'control_difference' && x.source_kind === 'ar_receipt'), false, 'a document without its journal is one exception (unposted), not also a control difference');
  // من يملك الاستثناء يقرّ به؛ غيره يراه بلا زر.
  assert.deepEqual(lineException.actions, ['acknowledge_exception'], 'the bank reconciler owns an undecided line');
  assert.deepEqual(w.find('manager', 'unmatched_bank_line').actions, [], 'the approver of matches does not own an undecided line');
  assert.ok(verifyAudit(db));
});

test('acknowledgement: an append-only record by the owner, at the amount of the moment; it leaves the inbox, comes back when the amount changes, and is refused to anyone else', t => {
  const w = world(t), { db, users, tx } = w;
  const ack = (who, key, note = 'رأيت السطر وأبحث عن مصدره مع البنك هذا الأسبوع') => tx(() => acknowledgeException(db, users[who], { key, note }));
  const lineKey = w.find('employee', 'unmatched_bank_line').key;
  const inboxKeys = who => { clearInboxCache(); return inbox(db, users[who]).groups.flatMap(g => g.items).filter(i => i.source === 'finance-exceptions').map(i => i.id); };
  assert.ok(inboxKeys('employee').includes(lineKey), 'the owner is told in the inbox');
  assert.throws(() => ack('manager', lineKey), code('exception_not_owner'));
  assert.throws(() => ack('employee', lineKey, 'قصير'), code('invalid_text'));
  assert.throws(() => ack('employee', 'unmatched_bank_line:not-a-line'), code('exception_not_found'));
  const recorded = ack('employee', lineKey);
  assert.deepEqual([recorded.exception_key, recorded.amount_minor, recorded.acknowledged_by], [lineKey, 4200, 'employee']);
  const after = w.find('employee', 'unmatched_bank_line');
  assert.deepEqual([after.acknowledgement.current, after.acknowledgement.acknowledged_by_name !== null, after.actions], [true, true, []], 'still an exception until resolved at its source, now acknowledged');
  assert.equal(inboxKeys('employee').includes(lineKey), false, 'an acknowledged exception leaves the inbox');
  assert.throws(() => ack('employee', lineKey), code('exception_acknowledged'), 'one acknowledgement per amount');
  // الإقرار سجلٌّ لا يُعدَّل ولا يُحذف، وفي سلسلة التدقيق.
  assert.throws(() => db.prepare('UPDATE finance_exception_acks SET note=? WHERE id=?').run('ملاحظة معدلة بعد الإقرار', recorded.id), /a record, not an edit/);
  assert.throws(() => db.prepare('DELETE FROM finance_exception_acks WHERE id=?').run(recorded.id), /a record, not an edit/);
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_type='finance_exception' AND entity_id=? AND action='finance_exception.acknowledged'").get(recorded.id));
  // الوعد: إقرارٌ بالنقص كما هو، ثم يصل جزء داخل مدة الوعد فيتغيّر النقص، فيعود الاستثناء ينتظر إقرارًا جديدًا.
  const promiseKey = w.find('employee', 'broken_promise').key;
  ack('employee', promiseKey, 'اتصلت بالعميل ووعد بتحويل الباقي هذا الأسبوع');
  assert.equal(inboxKeys('employee').includes(promiseKey), false);
  // جزءٌ وصل في يوم الموعد نفسه (تاريخ البنك داخل مدة الوعد)، وتأكّد اليوم.
  const late = tx(() => ar.recordReceipt(db, users.employee, w.two.id, { reference: 'EXC-R2', amount: '30.00', received_on: '2026-09-10', payer: 'شركة العميل المصطنعة', evidence: 'إشعار بنكي مصطنع محفوظ في ملف الاختبار' }));
  tx(() => ar.receiptAction(db, users.manager, w.two.id, late.id, 'confirm', { note: 'طابقت كشف الحساب', matching_evidence: 'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ' }));
  const moved = w.find('employee', 'broken_promise');
  assert.deepEqual([moved.amount_minor, moved.acknowledgement.current], [7000, false], 'an acknowledgement of an older amount is not an acknowledgement of this one');
  assert.ok(inboxKeys('employee').includes(promiseKey), 'so it is back in the owner\'s inbox');
  // كيانٌ آخر لا يرى الطابور ولا يقرّ فيه.
  const external = db.prepare("SELECT * FROM users WHERE id='external'").get();
  assert.throws(() => exceptionsBoard(db, external), code('finance_exceptions_denied'));
  assert.throws(() => tx(() => acknowledgeException(db, external, { key: lineKey, note: 'محاولة إقرار من كيان آخر مرفوضة' })), code('finance_exceptions_denied'));
  assert.ok(verifyAudit(db));
});

test('overdue re-close: a reopened month past its re-close date is an exception for whoever manages the close', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-10-05T07:00:00.000Z') });
  const r = reopenFixture(t), { db, users } = r;
  r.approveClose();
  r.adopt(2);
  r.requestReopen();
  r.approveReopen();
  assert.equal(exceptionsBoard(db, users.closer).exceptions.some(x => x.kind === 'overdue_reclose'), false, 'not overdue on its day');
  t.mock.timers.setTime(at('2026-10-10T07:00:00.000Z'));
  const overdue = exceptionsBoard(db, users.closer).exceptions.find(x => x.kind === 'overdue_reclose');
  assert.ok(overdue, 'the re-close date passed with the ledger still open');
  assert.deepEqual([overdue.date, overdue.inbox, overdue.actions], ['2026-10-07', true, ['acknowledge_exception']]);
  assert.match(overdue.owner, /الإقفال الشهري/);
});

test('screen and routes: the queue renders each exception with its owner and an acknowledge form, and the route acknowledges once per idempotency key through the real handler', async t => {
  const w = world(t), { db, users } = w;
  const data = w.board('employee');
  const html = financeExceptionsUI.render(data, ctx);
  assert.match(html, /data-operation="acknowledge_exception"/);
  assert.match(html, /سطر كشف بلا قرار/);
  assert.doesNotMatch(html, /<script|style=/);
  const form = financeExceptionsUI.form('acknowledge_exception', data.exceptions.find(x => x.kind === 'unmatched_bank_line').key, data);
  assert.equal(form.endpoint, '/finance-exceptions/acknowledge');
  assert.deepEqual(Object.keys(form.toPayload({ note: 'ملاحظة مصطنعة كافية الطول' })).sort(), ['key', 'note']);
  const app = createApp(db);
  const login = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: 'employee', password: 'synthetic-ledger-completeness' } });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': login.json().csrf };
  const got = await dispatch(app, { path: '/api/finance-exceptions', headers });
  assert.equal(got.status, 200);
  const key = got.json().exceptions.find(x => x.kind === 'unmatched_bank_line').key, idem = randomUUID().replaceAll('-', '');
  const body = { key, note: 'رأيت السطر وأطابقه بعد رد البنك على الاستفسار' };
  const first = await dispatch(app, { method: 'POST', path: '/api/finance-exceptions/acknowledge', headers: { ...headers, 'idempotency-key': idem }, body });
  const again = await dispatch(app, { method: 'POST', path: '/api/finance-exceptions/acknowledge', headers: { ...headers, 'idempotency-key': idem }, body });
  assert.deepEqual([first.status, again.status], [201, 201]);
  assert.equal(first.json().id, again.json().id, 'a replay returns the same acknowledgement');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_exception_acks WHERE exception_key=?').get(key).n, 1);
  const hr = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: 'hr', password: 'synthetic-ledger-completeness' } });
  const denied = await dispatch(app, { path: '/api/finance-exceptions', headers: { cookie: hr.headers['Set-Cookie'].split(';')[0] } });
  assert.equal(denied.status, 403, 'no finance reading, no queue');
  assert.ok(denied.json().error.details?.refusal, 'a written refusal, not a bare code');
});

test('audit package: the queue offers the period package as a download to whoever also holds the audit capability, and to no one else', t => {
  const w = world(t), { db, users, tx } = w;
  const without = w.board('employee');
  assert.deepEqual(without.audit_export, { allowed: false }, 'finance reading alone does not export');
  assert.doesNotMatch(financeExceptionsUI.render(without, ctx), /audit-export/, 'no link that the route would refuse');
  tx(() => grantAccess(db, users.admin, { user_id: 'employee', capability: 'finance.audit.export', note: 'تصريح تدقيق مصطنع للاختبار' }));
  const withIt = w.board('employee');
  const period = db.prepare('SELECT * FROM finance_periods WHERE id=?').get(w.period.id);
  const september = withIt.audit_export.periods.find(p => p.id === period.id);
  assert.equal(withIt.audit_export.allowed, true);
  assert.equal(september.href, `/api/audit-export?from=${period.starts_on}&to=${period.ends_on}`, 'the ledger month, from its first day to its last');
  const html = financeExceptionsUI.render(withIt, ctx);
  assert.match(html, new RegExp(`<a class="btn outline small" href="/api/audit-export\\?from=${period.starts_on}&amp;to=${period.ends_on}" download>`), 'a plain download link, as the other exports');
  assert.match(html, /verify-audit-package/, 'and how to check the file without the platform');
});
