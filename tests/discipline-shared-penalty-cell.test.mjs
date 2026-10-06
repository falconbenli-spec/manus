import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { BASE_SCHEDULE_ID, EXTRA_DEDUCTIONS, prepareSchedule, decideSchedule, disciplineBoard } from '../app/discipline.mjs';

// خانة «العقوبة المشتركة» في جدول «مخالفات تتعلق بمواعيد العمل» (الصفحات الموقعة p043–p045):
// الصفحة تطبعها تحت البند 6 («بالإضافة إلى حسم أجر دقائق التأخر») والبند 7 («ساعات التأخر») والبندين 8 و9
// («مدة ترك العمل») والبنود 12 و13 و14 («مدة الغياب»)، ولا تطبع شيئًا تحت البنود 1–5 ولا تحت البند 11.
// مستخرج المنصة (ترحيل 097) وسم A01–A05 بـ«late_time» وA11 بـ«absence_time» وعلّق ذلك سؤالين مفتوحين U1 وU2،
// والصفحات الموقعة تجيب عنهما بـ«لا». قبل هذا الإصلاح لم يكن لمعد النسخة طريق لتصحيح الخانة إطلاقًا:
// التعديلات المسموحة كانت خانات التكرار وإعدادين فقط، فكان تصحيح خطأ الاستخراج يتطلب تعديل ترحيل مطبَّق.
const code = value => error => error.code === value;
const TITLE = 'جدول المخالفات والجزاءات — نسخة الكيان بعد مطابقة الصفحات الموقعة (تجريبي)';
const BASIS = 'لائحة تنظيم العمل المعتمدة رقم 351743 بتاريخ 25-10-1446هـ: الجداول الملحقة، الصفحات p043–p046.';
const NOTE = 'قبول تجريبي لنسخة الكيان بعد مطابقة خانات العقوبة المشتركة مع الصفحات الموقعة';
const U1 = 'الصفحات p043 وp044: لا تطبع خانة مشتركة تحت البنود 1 إلى 5؛ أول خانة مطبوعة تحت البند 6 وحده.';
const U2 = 'الصفحة p045: لا تطبع خانة مشتركة تحت البند 11، وتطبع «حسم أجر مدة الغياب» تحت البندين 12 و13.';
const CLEARED = ['A01', 'A02', 'A03', 'A04', 'A05', 'A11'];

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-shared-penalty-cell'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f);
  tx(() => grantAccess(db, users.admin, { user_id: 'it', capability: 'hr.policy.accept', note: 'تصريح تجريبي لقبول جدول الجزاءات' }));
  return { db, users, tx };
}
const rowsOf = (db, u) => {
  const accepted = disciplineBoard(db, u).schedules.find(s => s.status === 'accepted');
  return Object.fromEntries(accepted.rows.map(r => [r.code, r]));
};
const prepare = (tx, db, users, changes) => tx(() => prepareSchedule(db, users.hr, {
  source_id: BASE_SCHEDULE_ID, title: TITLE, basis: BASIS, effective_from: '2026-09-22', changes,
  settings: { defence_wait_days: 3 }, confirmations: { U1, U2 }
}));

test('the shared-penalty cell follows the signed pages: a preparer clears items 1–5 and 11, and removing a cell is as available as adding one', t => {
  const { db, users, tx } = fixture(t);
  const before = disciplineBoard(db, users.hr).schedules.find(s => s.id === BASE_SCHEDULE_ID).rows;
  const beforeRows = Object.fromEntries(before.map(r => [r.code, r]));
  // ما كان عليه المستخرج: الخانة موسومة على بنود لا تطبعها الصفحة تحتها، ومعلَّقة بسؤالين مفتوحين.
  for (const item of CLEARED) assert.ok(beforeRows[item].extra_deduction, `${item} كان يحمل خانة حسم إضافي في المستخرج`);

  const { id } = prepare(tx, db, users, CLEARED.map(item => ({ code: item, extra_deduction: null })));
  const draftVersion = disciplineBoard(db, users.it).schedules.find(s => s.id === id).version;
  tx(() => decideSchedule(db, users.it, id, 'accept', { effective_from: '2026-09-22', note: NOTE, version: draftVersion }));
  const rows = rowsOf(db, users.hr);
  for (const item of CLEARED) assert.equal(rows[item].extra_deduction, null, `${item}: الصفحة الموقعة لا تطبع تحته خانة مشتركة`);
  // وما تطبعه الصفحة يبقى كما هو: البندان 6 و7 دقائق وساعات التأخر، و8 و9 مدة ترك العمل، و12 و13 و14 مدة الغياب.
  assert.equal(rows.A06.extra_deduction, 'late_time');
  assert.equal(rows.A07.extra_deduction, 'late_time');
  assert.equal(rows.A08.extra_deduction, 'left_time');
  assert.equal(rows.A09.extra_deduction, 'left_time');
  for (const item of ['A12', 'A13', 'A14']) assert.equal(rows[item].extra_deduction, 'absence_time', `${item}: «بالإضافة إلى حسم أجر مدة الغياب» مطبوعة تحته`);
  assert.equal(rows.A06.extra_deduction_ar, EXTRA_DEDUCTIONS.late_time[0]);
  assert.equal(rows.A01.extra_deduction_ar, '');

  // الإضافة متاحة كالإزالة: نسخة تالية تعيد الخانة إلى بند، فالمسار ليس طريقًا في اتجاه واحد.
  const restored = prepare(tx, db, users, [{ code: 'A01', extra_deduction: 'late_time' }]);
  const draft = disciplineBoard(db, users.hr).schedules.find(s => s.id === restored.id);
  assert.equal(draft.rows.find(r => r.code === 'A01').extra_deduction, 'late_time');

  // التدقيق يحمل البند وما كان وما صار، لا عدد التعديلات وحده.
  const event = db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='discipline_schedule.prepared'").get(id);
  const after = JSON.parse(event.after_json);
  assert.equal(after.extra_deduction_changes.length, CLEARED.length);
  assert.deepEqual(after.extra_deduction_changes.find(x => x.code === 'A11'), { code: 'A11', from: 'absence_time', to: null });
  assert.ok(verifyAudit(db));
});

test('a shared-penalty correction is validated: only the values the signed tables print, and never mixed with an occurrence cell', t => {
  const { db, users, tx } = fixture(t);
  assert.throws(() => prepare(tx, db, users, [{ code: 'A01', extra_deduction: 'fuel_time' }]), code('changes'));
  assert.throws(() => prepare(tx, db, users, [{ code: 'A01', extra_deduction: null, occurrence: 1 }]), code('changes'));
  assert.throws(() => prepare(tx, db, users, [{ code: 'Z99', extra_deduction: null }]), code('changes'));
  // وخانات التكرار تبقى كما كانت تعمل، في البند نفسه من القائمة.
  const { id } = prepare(tx, db, users, [{ code: 'A01', occurrence: 2, penalty: 'fine:1000' }, { code: 'A01', extra_deduction: null }]);
  const draft = disciplineBoard(db, users.hr).schedules.find(s => s.id === id).rows.find(r => r.code === 'A01');
  assert.equal(draft.penalties[1].token, 'fine:1000');
  assert.equal(draft.extra_deduction, null);
});
