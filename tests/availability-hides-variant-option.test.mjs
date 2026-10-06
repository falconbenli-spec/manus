import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { setAvailability } from '../app/service-availability.mjs';
import { SERVICE_VARIANTS, variantCatalog, installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';

// العيب الذي أوجب هذا الملف — 29 سبتمبر 2026، بلاغ المالك: «الخدمات والإدارة فيهم تكرار لنفس الخدمة».
//
// القياس: خدمةٌ مبذورة عامة (CREATIVE-BRIEF «تكليف إبداعي داخلي») تجلس في دليل إدارة الخدمات الإبداعية
// بجانب أربع خدمات محدَّدة تسأل ما تسأله وأدقّ منه (طلب تصميم، كتابة محتوى، تعديل مخرج، ترجمة)،
// وهي خامس خيار في بطاقة VAR-CREATIVE نفسها. فالطالب يرى بابين لطلب واحد.
//
// وعلاج ذلك ليس حذفًا من الكود: المنصة تملك المفتاح الذي طلبه المالك في 22 سبتمبر — service_availability —
// يُخفي أي خدمة برمزها بسبب مكتوب، ويُرجعها بصفٍّ ثانٍ، ولا يُمحى أيٌّ منهما (الترحيل 129).
//
// الثابت المحروس هنا: **المفتاح الواحد يمسك البابين معًا.** إخفاء خدمة يرفعها من الدليل ومن بطاقة
// خياراتها في اللحظة نفسها. ولو انفصل المساران يومًا — بأن تقرأ البطاقة الخدمات من استعلام ثانٍ لا يمرّ
// بـcatalog() — لبقي في البطاقة خيارٌ يفتح على رفض، وهو أسوأ من التكرار الذي أُخفيت الخدمة لأجله.

const GROUP = 'VAR-CREATIVE';
const HIDDEN = 'CREATIVE-BRIEF';

function arena() {
  // البذرة وحدها لا تكفي: خدمات CRT-* المحدَّدة تأتي من المثبّت لا من البذرة،
  // وقاعدة التشغيل مبذورة ومُثبَّتة معًا (scripts/init-pilot.mjs). فالقياس على البذرة وحدها
  // يقيس شكلًا لا يراه أحد: بطاقة بخيار واحد بدل خمسة.
  const db = openDb(':memory:');
  seed(db, 'synthetic-availability');
  installServiceCatalog(db);
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  const employee = db.prepare("SELECT * FROM users WHERE role='employee' AND department_id='creative' LIMIT 1").get()
    ?? db.prepare("SELECT * FROM users WHERE role='employee' LIMIT 1").get();
  return { db, admin, employee };
}

const optionsOf = (db, user) => variantCatalog(db, user).find(g => g.code === GROUP)?.options.map(o => o.code) ?? [];
const codesOf = (db, user) => catalog(db, user).map(s => s.code);

test('قبل الإخفاء: الخدمة في الدليل وخيارها في البطاقة', () => {
  const { db, employee } = arena();
  assert.ok(SERVICE_VARIANTS.find(g => g.code === GROUP)?.options.some(o => o.service === HIDDEN),
    `${HIDDEN} ليست خيارًا في ${GROUP}؛ تغيّر التعريف فيلزم مراجعة هذا الاختبار لا حذفه`);
  assert.ok(codesOf(db, employee).includes(HIDDEN), 'الخدمة في دليل الموظف قبل أي قرار');
  assert.ok(optionsOf(db, employee).includes('brief'), 'وخيارها معروض في البطاقة');
  db.close();
});

test('مفتاح واحد يمسك البابين: الإخفاء يرفع الخدمة من الدليل ومن بطاقتها معًا', () => {
  const { db, admin, employee } = arena();
  transaction(db, () => setAvailability(db, admin, {
    kind: 'service', target_key: HIDDEN, state: 'hidden',
    reason: 'تكرار: أربع خدمات محددة في الإدارة نفسها تغطيها',
  }));
  assert.equal(codesOf(db, employee).includes(HIDDEN), false, 'الخدمة اختفت من الدليل');
  assert.equal(optionsOf(db, employee).includes('brief'), false,
    'الخيار ما زال معروضًا في البطاقة بعد إخفاء خدمته — فيفتح على رفض. '
    + 'البطاقة تبني خياراتها من catalog() لهذا السبب بالذات (service-catalog.mjs variantCatalog)؛ '
    + 'من غيّر مصدرها إلى استعلام لا يمرّ بالدليل كسر هذا الثابت.');
  assert.ok(optionsOf(db, employee).length >= 1, 'وبقية خيارات البطاقة باقية، فلا تُخفى البطاقة كلها بخيار واحد');
  db.close();
});

test('والقرار يُرجَع بصفٍّ ثانٍ، فيعود البابان كما كانا', () => {
  const { db, admin, employee } = arena();
  transaction(db, () => setAvailability(db, admin, { kind: 'service', target_key: HIDDEN, state: 'hidden', reason: 'تكرار مقاس' }));
  transaction(db, () => setAvailability(db, admin, { kind: 'service', target_key: HIDDEN, state: 'available', reason: 'رجوع عن القرار' }));
  assert.ok(codesOf(db, employee).includes(HIDDEN), 'الخدمة رجعت للدليل');
  assert.ok(optionsOf(db, employee).includes('brief'), 'وخيارها رجع للبطاقة — فالإخفاء قرار يُرجع عنه، لا حذف');
  db.close();
});
