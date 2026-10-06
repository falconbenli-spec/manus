import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { articleView, compareVersions, SOURCE_NOTE } from '../app/policy-library.mjs';

// مادتان من الـ127 المستخرجة في الترحيل 110 يقرؤهما الموظف في مكتبة السياسات، وفيهما خطأ استخراج يغيّر المعنى:
//   م65 — الصفحة الموقعة p024: الجدول يطبع خارج المملكة 2500 و1500 و900 و500، وداخلها 2100 و1000 و600 و400،
//        وتحته «المبالغ المذكورة تصرف عن اليوم الواحد». والمخزون كان يحمل عناوين الأعمدة بلا أي من المبالغ الثمانية.
//   م76 — الصفحة الموقعة p028: «تدفع المنشأة للعامل عن ساعات العمل الإضافية أجرا إضافيا يوازي أجر الساعة
//        مضافًا إليه (50%) من أجره الأساسي». والمخزون كان يقطع النسبة بين فقرتين فتقرأ الجملة بلا معنى.
const OUTSIDE = ['2500', '1500', '900', '500'], INSIDE = ['2100', '1000', '600', '400'];
const OVERTIME_SENTENCE = 'تدفع المنشأة للعامل عن ساعات العمل الإضافية أجرا إضافيا يوازي أجر الساعة مضافًا إليه (50%) من أجره الأساسي.';

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-policy-articles'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  return { db, users };
}

test('Art. 65 in the library carries all eight per-diem amounts of the signed table, with the per-day note', t => {
  const { db, users } = fixture(t);
  const view = articleView(db, users.employee, 65).article;
  for (const amount of [...OUTSIDE, ...INSIDE]) assert.ok(view.body.includes(amount), `المبلغ ${amount} من جدول ص p024 مخزون في نص المادة`);
  assert.match(view.body, /بدل انتداب - لسفريات الاعمال - والتدريب - خارج المملكة \| 2500 \| 1500 \| 900 \| 500/);
  assert.match(view.body, /بدل انتداب - لسفريات الاعمال - والتدريب - داخل المملكة \| 2100 \| 1000 \| 600 \| 400/);
  assert.match(view.body, /المبالغ المذكورة تصرف عن اليوم الواحد/);
  // الفقرات الست بترقيمها المطبوع، بعد أن كانت جملة واحدة متصلة.
  assert.deepEqual(view.paragraphs.filter(p => p.marker).map(p => p.marker), ['1', '2', '3', '4', '5', '6']);
  assert.equal(view.revision, 2, 'نسخة ثانية، والأولى محفوظة');
  // القيد يبقى: النص لم يُطابقه إنسان باسمه، فالوسم «مستخرج — يحتاج مطابقة» باقٍ، ووسم إعادة الترتيب رُفع لأنه لم يعد يصف المخزون.
  assert.equal(view.verification, 'extracted');
  assert.equal(view.source_note, SOURCE_NOTE);
  assert.deepEqual(view.artifacts, []);
});

test('Art. 76 in the library reads as one sentence again, with the 50% where the signed page puts it', t => {
  const { db, users } = fixture(t);
  const view = articleView(db, users.employee, 76).article;
  assert.ok(view.body.includes(OVERTIME_SENTENCE), 'الجملة كاملة كما تطبعها ص p028');
  assert.doesNotMatch(view.body, /من% أجره الأساسي/, 'الشظية المقطوعة لم تعد في النص');
  assert.doesNotMatch(view.body, /مضافًا \(إليه 50/);
  assert.equal(view.paragraphs.length, 2);
  assert.equal(view.paragraphs[1].text, OVERTIME_SENTENCE.slice(0, -1) + '.');
  assert.equal(view.verification, 'extracted');
  assert.deepEqual(view.artifacts, []);
});

test('the correction is a new revision, not an overwrite: the extracted text stays comparable line by line', t => {
  const { db, users } = fixture(t);
  for (const number of [65, 76]) {
    const versions = articleView(db, users.employee, number).versions;
    assert.equal(versions.length, 2, `م${number}: نسختان — المستخرجة والمصححة`);
    assert.match(versions.find(v => v.revision === 1).note, /كما خرجت من المستخرج/);
    assert.match(versions.find(v => v.revision === 2).note, /الصفحة الموقعة/);
    assert.equal(versions.find(v => v.revision === 2).edited_by_name, null, 'الترحيل ليس شخصًا، فلا يُنسب التحرير إلى أحد');
    const diff = compareVersions(db, users.employee, number, { from: 1, to: 2 });
    assert.ok(diff.lines.some(l => l.side === 'added'), `م${number}: المقارنة تُظهر ما أُضيف`);
  }
  const diff65 = compareVersions(db, users.employee, 65, { from: 1, to: 2 });
  assert.ok(diff65.lines.some(l => l.side === 'added' && l.text.includes('2500') && l.text.includes('500')));
});
