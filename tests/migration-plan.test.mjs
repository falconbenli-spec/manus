import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { openDb, migrationPlan } from '../app/db.mjs';

/* البوابة 6 (الترحيلات والمخطط) — العيب الذي أوجب هذا الملف:
 *
 * كان `openDb` يختار ملفات الترحيل بمرشّح داخل حلقته: `/^\d{3}-.+\.sql$/` ثم `.sort()`. فترتّب على ذلك
 * صمتان، قِيسا تجريبيًا لا استُنتجا (الدليل: docs/testing/migration-plan-20260929.json):
 *
 *   ١) **ملفٌ لا يقرؤه المرشّح لا يُطبَّق أبدًا، ولا يقول أحد ذلك.** ملف اسمه `003b-hotfix.sql` جلس في
 *      المجلد ولم يُطبَّق ولم يُذكر: لا خطأ ولا سطر سجل. وكاتبه يظن أنه طُبِّق. والاسم ليس افتراضًا
 *      بعيدًا: إصلاحٌ عاجل باسم فيه حرف، أو رقمٌ رابع بعد 999، كلاهما يسقط في هذا الصمت.
 *
 *   ٢) **رقمٌ مكرَّر يترك القاعدة مُرحَّلة نصفَ ترحيل ولا تقلع.** ملفان بالرقم 002: طُبِّق أوّلهما
 *      وسُجِّل، ثم رُمي `Applied migration changed: 002-timers.sql`. فالقاعدة فيها جدولا الأول
 *      والنسخة 2 مسجَّلة، والخدمة لا تفتح — **والرسالة تسمّي السبب الخطأ**: لم يتغيّر ترحيلٌ مطبَّق،
 *      بل تقاسم ملفان رقمًا. وهذه الحالة قائمة فعلًا على فرعين غير مدمجين يحملان رقم 120.
 *
 * فصارت الخطة تُبنى كاملةً وتُرفض كاملةً **قبل** أن يُطبَّق ترحيل واحد: لا حالة نصفية، والرسالة تسمّي
 * الملفين معًا والخطوة التالية.
 */

test('رقمٌ مكرَّر يُرفض قبل أن يُطبَّق شيء، والرسالة تسمّي الملفين معًا',()=>{
  assert.throws(()=>migrationPlan(['001-base.sql','002-appearance.sql','002-timers.sql']),
    error=>/002-appearance\.sql/.test(error.message)&&/002-timers\.sql/.test(error.message)&&/002/.test(error.message),
    'الرفض يسمّي الملفين المتقاسمين للرقم: من يقرأ «Applied migration changed» وحدها يبحث عن تغييرٍ لم يقع.');
});

test('ملف ترحيل لا يُقرأ اسمه يُرفض ولا يُتخطّى بصمت',()=>{
  assert.throws(()=>migrationPlan(['001-base.sql','003b-hotfix.sql']),/003b-hotfix\.sql/,
    'الملف الذي لا يطابق NNN-name.sql لا يُطبَّق أبدًا. تخطّيه بصمت يجعل كاتبه يظن أنه طُبِّق.');
  assert.throws(()=>migrationPlan(['1000-too-far.sql']),/1000-too-far\.sql/,
    'وأربعة أرقام تسقط من المرشّح نفسه، فيمرّ الترحيل دون أن يُطبَّق.');
});

test('وما ليس ترحيلًا أصلًا لا يُعدّ خطأ: المجلد قد يحمل ملفًا لا يخصّ الترحيل',()=>{
  const plan=migrationPlan(['001-base.sql','README.md','.DS_Store']);
  assert.deepEqual(plan.map(p=>p.file),['001-base.sql'],
    'الحدّ: ملفُ .sql في مجلد الترحيلات يُقصد به أن يُطبَّق، فتعذّره خطأ؛ وغيره ليس ترحيلًا فلا يُسأل عنه.');
});

test('الخطة مرتَّبة بالرقم لا بالنص، وتحمل لكل ترحيل رقمه وملفه',()=>{
  const plan=migrationPlan(['010-ten.sql','002-two.sql','100-hundred.sql']);
  assert.deepEqual(plan,[{version:2,file:'002-two.sql'},{version:10,file:'010-ten.sql'},{version:100,file:'100-hundred.sql'}]);
});

test('ومجلد الترحيلات في هذه الشجرة خطته سليمة، وتغطّي كل ملف .sql فيه',()=>{
  const names=readdirSync(new URL('../app/migrations/',import.meta.url));
  const sql=names.filter(f=>f.endsWith('.sql'));
  const plan=migrationPlan(names);
  assert.equal(plan.length,sql.length,'كل ملف .sql في المجلد له موضع في الخطة: لا ملف يجلس خارجها.');
  assert.deepEqual([...plan].sort((a,b)=>a.version-b.version),plan,'والخطة مرتَّبة كما ستُطبَّق.');
});

test('والحارس موصول فعلًا: ما تسجّله قاعدة جديدة هو الخطة نفسها',t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  const names=readdirSync(new URL('../app/migrations/',import.meta.url));
  const planned=migrationPlan(names).map(p=>p.version);
  const applied=db.prepare('SELECT version FROM schema_migrations WHERE version>1 ORDER BY version').all().map(r=>r.version);
  assert.deepEqual(applied,planned,
    'لو بقي openDb يختار ملفاته بمرشّحه القديم لمرّ هذا الاختبار وهو لا يحرس شيئًا. المقارنة تثبت أن المطبَّق هو المخطَّط.');
});
