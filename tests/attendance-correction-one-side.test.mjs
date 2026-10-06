import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { requestCorrection, decideCorrection } from '../app/attendance.mjs';

// طلب المالك — 30 سبتمبر 2026: «خلّ الموظف يقدر يختار إذا يبي يعدّل دخول أو خروج، كل واحد لحال أو كلهم».
//
// ما كان: proposed_in وproposed_out كلاهما NOT NULL مع CHECK(proposed_out>proposed_in)، فمن نسي
// بصمة الانصراف وحدها يُطالَب بكتابة وقت حضورٍ مسجَّلٍ أصلًا وصحيح ليمرّ الشرط؛ ومن لم يبصم ذلك
// اليوم إطلاقًا يخترع وقتًا. النموذج يفرض جانبين على من يملك جانبًا واحدًا.
//
// والثوابت المحروسة هنا ثلاثة، وأخطرها الثالث:
//   1. جانبٌ واحد يُقبل، والطلب الفارغ يُرفض.
//   2. الجانب غير المقترَح **لا يُمسّ** عند الاعتماد — تصحيح الانصراف لا يمحو حضورًا مسجَّلًا.
//      وهذا هو الخطر: كتابة NULL فوق بصمةٍ صحيحة تفقد سجلًا لا يُسترجع.
//   3. الترتيب يُفحص على الزوج الذي سيصير عليه اليوم، لا على المقترَح وحده — وإلا مرّ انصرافٌ
//      قبل حضورٍ قائم لأن الطلب لم يذكر الحضور أصلًا.

// نفس تحويل app/attendance.mjs: التوقيت المكتوب توقيت الرياض (+03:00)، ويُخزَّن UTC.
const at = (date, time) => new Date(`${date}T${time}:00+03:00`).toISOString();

function arena() {
  const db = openDb(':memory:');
  seed(db, 'synthetic-correction-sides');
  const employee = db.prepare("SELECT * FROM users WHERE role='employee' AND active=1 LIMIT 1").get();
  const manager = db.prepare('SELECT * FROM users WHERE id=?').get(employee.manager_id)
    ?? db.prepare("SELECT * FROM users WHERE role='manager' AND active=1 LIMIT 1").get();
  return { db, employee, manager };
}

/** يوم فات داخل نافذة الـ45 يومًا، بسجل حضور مكتوب مباشرة. */
function dayWith(db, userId, tenantId, { checkIn = null, checkOut = null } = {}) {
  const date = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO attendance_records VALUES(?,?,?,?,?,?,'self',?,?)")
    .run(crypto.randomUUID(), tenantId, userId, date, checkIn && at(date, checkIn), checkOut && at(date, checkOut),
      new Date().toISOString(), new Date().toISOString());
  return date;
}

const recordOf = (db, userId, date) =>
  db.prepare('SELECT check_in_at,check_out_at FROM attendance_records WHERE user_id=? AND work_date=?').get(userId, date);

test('الانصراف وحده يُقبل، ولا يُطلب حضورٌ مسجَّل أصلًا', () => {
  const { db, employee } = arena();
  const date = dayWith(db, employee.id, employee.tenant_id, { checkIn: '08:00' });
  const out = transaction(db, () => requestCorrection(db, employee,
    { work_date: date, proposed_out: '17:00', reason: 'نسيت بصمة الانصراف والدوام انتهى الخامسة' }));
  assert.ok(out.id, 'طلب بجانب واحد رُفض، والمالك طلب أن يُقبل');
  const row = db.prepare('SELECT proposed_in,proposed_out FROM attendance_corrections WHERE id=?').get(out.id);
  assert.equal(row.proposed_in, null, 'الجانب غير المقترَح يُخزَّن فارغًا، لا منسوخًا من السجل');
  assert.equal(row.proposed_out, '17:00');
  db.close();
});

test('والحضور وحده كذلك، ولو لم يكن لليوم سجلٌّ إطلاقًا', () => {
  const { db, employee } = arena();
  const date = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  const out = transaction(db, () => requestCorrection(db, employee,
    { work_date: date, proposed_in: '09:00', reason: 'ما بصمت ذاك اليوم أبد ودخلت الساعة تسعة' }));
  assert.ok(out.id, 'يومٌ بلا سجل مع جانب واحد رُفض — وهو الحالة التي كانت تُجبر على اختراع وقت');
  db.close();
});

test('وطلبٌ لا يقترح شيئًا يُرفض برسالة تقول ماذا يختار', () => {
  const { db, employee } = arena();
  const date = dayWith(db, employee.id, employee.tenant_id, { checkIn: '08:00' });
  assert.throws(() => transaction(db, () => requestCorrection(db, employee,
    { work_date: date, reason: 'ما حددت شيئًا وأريد أن أرى الرفض' })),
    error => {
      assert.equal(error.code ?? error.key, 'nothing_proposed');
      assert.match(String(error.message), /الحضور|الانصراف/);
      return true;
    });
  db.close();
});

test('الخطر: اعتماد تصحيح الانصراف لا يمحو الحضور المسجَّل', () => {
  const { db, employee, manager } = arena();
  const date = dayWith(db, employee.id, employee.tenant_id, { checkIn: '08:00' });
  const out = transaction(db, () => requestCorrection(db, employee,
    { work_date: date, proposed_out: '17:30', reason: 'نسيت بصمة الانصراف والدوام انتهى الخامسة والنصف' }));
  transaction(db, () => decideCorrection(db, manager, out.id, 'approve', { note: 'مطابق للدوام' }));
  const row = recordOf(db, employee.id, date);
  assert.equal(row.check_in_at, at(date, '08:00'),
    'بصمة الحضور مُحيت عند اعتماد تصحيحٍ لم يذكرها — وهذا فقدُ سجلٍّ لا يُسترجع، وهو ما يحرسه هذا الاختبار.');
  assert.equal(row.check_out_at, at(date, '17:30'), 'الجانب المقترَح لم يُكتب');
  db.close();
});

test('والترتيب يُفحص على الزوج الناتج: انصرافٌ قبل حضورٍ قائم يُرفض ولو لم يذكره الطلب', () => {
  const { db, employee } = arena();
  const date = dayWith(db, employee.id, employee.tenant_id, { checkIn: '09:00' });
  assert.throws(() => transaction(db, () => requestCorrection(db, employee,
    { work_date: date, proposed_out: '07:00', reason: 'انصراف قبل الحضور المسجل ويجب أن يُرفض' })),
    error => {
      assert.equal(error.code ?? error.key, 'time_order');
      return true;
    },
    'قُبل انصرافٌ قبل الحضور المسجَّل لأن الطلب لم يذكر الحضور — الفحص يجب أن يكون على الزوج الناتج.');
  db.close();
});

test('والجانبان معًا يبقيان مقبولين كما كانا', () => {
  const { db, employee, manager } = arena();
  const date = dayWith(db, employee.id, employee.tenant_id, { checkIn: '10:00', checkOut: '12:00' });
  const out = transaction(db, () => requestCorrection(db, employee,
    { work_date: date, proposed_in: '08:00', proposed_out: '17:00', reason: 'البصمتان غلط والدوام من ثمانية لخمسة' }));
  transaction(db, () => decideCorrection(db, manager, out.id, 'approve', { note: 'مطابق للدوام' }));
  const row = recordOf(db, employee.id, date);
  assert.equal(row.check_in_at, at(date, '08:00'));
  assert.equal(row.check_out_at, at(date, '17:00'));
  db.close();
});
