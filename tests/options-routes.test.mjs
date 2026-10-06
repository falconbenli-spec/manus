// الخيارات والقيم المعتمدة عبر الموجّه الحقيقي (POST الناجح 201 كبقية المسارات) (app/server.mjs) بلا منفذ: القيمة التي تقف المنصة عندها تُسجَّل وتُعتمد
// بشخص ثانٍ يحمل تصريحها، والقرار المعلّق يصل صندوق من يعتمده لا صندوق من سجّله، والشاشة لمن يقرر قيمة أو يدير قائمة.
// قبل هذا الالتزام ما كان لهذه القرارات مسار ولا شاشة (STATUS.md «سُلّم إلى فريق آخر»)، فكانت مهلة إعادة الإقفال
// وأيام التهدئة وسقف أول دفعة مسودات لا يقررها أحد أبدًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import { inbox, clearInboxCache } from '../app/inbox.mjs';
import { dispatch } from './definitions-fixture.mjs';

const PASSWORD = 'synthetic-options-routes';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RECLOSE = 'finance.reopen_reclose_days';

async function setup(t, grants) {
  const db = openDb(':memory:'); seed(db, PASSWORD); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  for (const [who, capability] of grants) transaction(db, () => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مصطنع لاختبار الخيارات' }));
  const app = createApp(db), sessions = {};
  for (const username of ['employee', 'manager', 'outsider', 'admin']) {
    const r = await dispatch(app, { method: 'POST', path: '/api/login', body: { username, password: PASSWORD } });
    assert.equal(r.status, 200, `login ${username}: ${r.text.slice(0, 200)}`);
    sessions[username] = { cookie: r.headers['Set-Cookie'].split(';')[0], csrf: r.json().csrf };
  }
  const call = (who, path, input) => dispatch(app, { method: input === undefined ? 'GET' : 'POST', path: '/api' + path,
    headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, 'idempotency-key': randomUUID() }, body: input });
  const inboxOf = who => { clearInboxCache(); return inbox(db, users[who]).groups.find(g => g.key === 'options')?.items ?? []; };
  return { db, users, call, inboxOf };
}

test('options: the board is for whoever decides a value or manages a list — a plain employee is refused by name', async t => {
  const o = await setup(t, [['manager', 'finance.close.manage']]);
  const refused = await o.call('outsider', '/options');
  assert.equal(refused.status, 403);
  assert.equal(refused.json().error.code, 'not_permitted');
  assert.ok(refused.json().error.details.refusal.next, 'the refusal says what to do next');
  const board = await o.call('manager', '/options');
  assert.equal(board.status, 200, board.text.slice(0, 300));
  const reclose = board.json().adopted.find(a => a.key === RECLOSE);
  assert.equal(reclose.can_decide, true);
  assert.equal(reclose.source, 'code_default');
  assert.deepEqual(reclose.value, { days: null }, 'undecided until someone records it and a second person approves');
  assert.equal(board.json().adopted.find(a => a.key === 'finance.vat_rate').can_decide, false, 'a legally fixed value is read, not decided');
  assert.equal((await o.call('admin', '/options')).status, 200, 'the super administrator reads the board');
});

test('options: a value is recorded by one holder, reaches the other holder\'s inbox, and takes effect only on their approval', async t => {
  const o = await setup(t, [['employee', 'finance.close.manage'], ['manager', 'finance.close.manage']]);
  const recorded = await o.call('employee', `/options/adoptions/${RECLOSE}/record`, { value: { days: 5 }, basis: 'مهلة خمسة أيام عمل لإعادة إقفال الشهر بعد فتحه — قرار مصطنع للاختبار', effective_from: today() });
  assert.equal(recorded.status, 201, recorded.text.slice(0, 300));
  assert.equal(recorded.json().source, 'code_default', 'recorded is not adopted: nothing changes before the second person');
  const pending = (await o.call('employee', '/options')).json().adopted.find(a => a.key === RECLOSE).pending;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].mine, true);
  assert.equal(pending[0].value_text, 'عدد الأيام: 5', 'the value reads in Arabic, not as its JSON key');
  assert.deepEqual(o.inboxOf('employee'), [], 'the recorder does not see their own decision as waiting on them');
  const waiting = o.inboxOf('manager');
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, pending[0].id);
  assert.equal(waiting[0].link, `#options?focus=${encodeURIComponent(pending[0].id)}`, 'the item opens the decision itself');
  const self = await o.call('employee', `/options/adoptions/${RECLOSE}/approve`, { adoption_id: pending[0].id, note: 'أعتمد ما سجلته بنفسي' });
  assert.equal(self.status, 409);
  assert.equal(self.json().error.code, 'separation_of_duties');
  const approved = await o.call('manager', `/options/adoptions/${RECLOSE}/approve`, { adoption_id: pending[0].id, note: 'راجعت المهلة مع إجراء الإقفال المصطنع' });
  assert.equal(approved.status, 201, approved.text.slice(0, 300));
  assert.equal(approved.json().source, 'adopted');
  assert.deepEqual(approved.json().value, { days: 5 });
  assert.deepEqual(o.inboxOf('manager'), [], 'decided, so it leaves the inbox');
  const outsider = await o.call('outsider', `/options/adoptions/${RECLOSE}/record`, { value: { days: 9 }, basis: 'محاولة تسجيل بلا تصريح الإقفال الشهري', effective_from: today() });
  assert.equal(outsider.status, 403);
});

test('options: refusals are named — legally fixed, unknown key, wrong value shape, duplicate effective date', async t => {
  const o = await setup(t, [['employee', 'finance.close.manage']]);
  const fixed = await o.call('employee', '/options/adoptions/finance.vat_rate/record', { value: 0.1, basis: 'محاولة تغيير نسبة مثبتة نظامًا', effective_from: today() });
  assert.deepEqual([fixed.status, fixed.json().error.code], [409, 'legally_fixed'], 'a legally fixed value is read with its article, not decided');
  const unknown = await o.call('employee', '/options/adoptions/finance.not_a_value/record', { value: 1, basis: 'مفتاح غير مسجل للاختبار', effective_from: today() });
  assert.deepEqual([unknown.status, unknown.json().error.code], [404, 'adoption_unknown']);
  const shape = await o.call('employee', `/options/adoptions/${RECLOSE}/record`, { value: '5', basis: 'قيمة نصية بدل كائن الأيام', effective_from: today() });
  assert.deepEqual([shape.status, shape.json().error.code], [400, 'adoption_shape']);
  const first = await o.call('employee', `/options/adoptions/${RECLOSE}/record`, { value: { days: 3 }, basis: 'القرار الأول بتاريخ سريان اليوم', effective_from: today() });
  assert.equal(first.status, 201);
  const again = await o.call('employee', `/options/adoptions/${RECLOSE}/record`, { value: { days: 4 }, basis: 'قرار ثان بتاريخ السريان نفسه', effective_from: today() });
  assert.deepEqual([again.status, again.json().error.code], [409, 'duplicate_adoption'], 'a resent form does not write twice');
});

test('options: a list option with an Arabic value is added and stopped through its encoded path; a broken encoding is a refusal', async t => {
  const o = await setup(t, [['employee', 'procurement.use']]);
  const added = await o.call('employee', '/options/procurement.unit', { value: 'كرتونة', label: 'كرتونة', reason_code: 'new_activity', reason: 'وحدة قياس جديدة لمشتريات المطبوعات المصطنعة', effective_on: today() });
  assert.equal(added.status, 201, added.text.slice(0, 300));
  assert.ok(added.json().options.some(x => x.value === 'كرتونة' && x.state === 'active'));
  const stopped = await o.call('employee', `/options/procurement.unit/${encodeURIComponent('كرتونة')}/disable`, { reason_code: 'superseded', reason: 'حلت محلها وحدة أخرى في الاختبار المصطنع', effective_on: today() });
  assert.equal(stopped.status, 201, stopped.text.slice(0, 300));
  assert.equal(stopped.json().options.find(x => x.value === 'كرتونة').state, 'disabled');
  const broken = await o.call('employee', '/options/procurement.unit/%E0%A4%A/disable', { reason_code: 'error', reason: 'ترميز مكسور في الرابط للاختبار', effective_on: today() });
  assert.deepEqual([broken.status, broken.json().error.code], [400, 'bad_option_value']);
  const locked = await o.call('employee', '/options/procurement.purchase_status', { value: 'paused', label: 'موقوف', reason_code: 'other', reason: 'محاولة توسيع قائمة مقفلة بقيد', effective_on: today() });
  assert.equal(locked.status, 409, 'a database-locked list is read, not extended');
});

test('options: a list that opens a gate widens with two people — the second sees it in the inbox, the first cannot approve it', async t => {
  const o = await setup(t, [['employee', 'vendors.manage'], ['manager', 'vendors.manage']]);
  const added = await o.call('employee', '/options/vendors.document_kind', { value: 'iso_cert_test', label: 'شهادة جودة مصطنعة', reason_code: 'policy_change', reason: 'وثيقة تأهيل إضافية مصطنعة للاختبار', effective_on: today() });
  assert.equal(added.status, 201, added.text.slice(0, 300));
  const waiting = o.inboxOf('manager');
  assert.deepEqual(waiting.map(i => i.id), ['vendors.document_kind::iso_cert_test']);
  assert.deepEqual(o.inboxOf('employee'), []);
  const self = await o.call('employee', '/options/vendors.document_kind/iso_cert_test/approve', { reason: 'أعتمد ما أضفته بنفسي' });
  assert.deepEqual([self.status, self.json().error.code], [409, 'separation_of_duties']);
  const approved = await o.call('manager', '/options/vendors.document_kind/iso_cert_test/approve', { reason: 'راجعت الوثيقة مع سياسة التأهيل المصطنعة' });
  assert.equal(approved.status, 201, approved.text.slice(0, 300));
  assert.equal(approved.json().options.find(x => x.value === 'iso_cert_test').awaiting_second_person, false);
  assert.deepEqual(o.inboxOf('manager'), []);
});
