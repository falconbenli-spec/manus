import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment, isLivePath, EnvironmentError, ENVIRONMENTS } from '../app/environment.mjs';

/* عزل جذر البيئة في الاختبارات — العيب الذي أوجب هذا الملف:
 *
 * `tests/screen-truthfulness.test.mjs` كان يسأل «هل شارة البيئة صادقة؟» ثم يربط جوابه بمكان تشغيله:
 * `resolveEnvironment({ ENV: 'staging' }, { root: process.cwd() })`. وقياس 30 سبتمبر 2026: من شجرة
 * التطوير يمرّ ثلاثًا من ثلاث، ومن داخل `/Users/abdulaziz/Documents/Codex/2026-09-09/3-6t-live` يسقط
 * ثلاثًا من ثلاث عند السطر 34 — لأن التجهيز يشتقّ قاعدته من الجذر (environment.mjs:38) فتصير
 * `<cwd>/work/staging/staging.sqlite`، ويرى `isLivePath` فيها مقطع `3-6t-live` فيرفضها
 * (environment.mjs:54). والرفض حسابُ مسارٍ محض، فيقع ولو لم يوجد المجلد — وهو ما وقع فعلًا.
 *
 * والرفض صحيح: فتحُ قاعدة يطبّق عليها الترحيلات، فهو كتابة، فلا تُفتح قاعدةٌ في موضع حيّ. الكاذب هو
 * الاختبار: نتيجته تصف مكان المشغّل لا سلامة الكود، فهي تمرّ في موضع وتسقط في آخر على كود واحد.
 *
 * ولماذا هذا الحارس بهذه الصورة — ثلاثة اختبارات لا واحد؟ لأن للعيب بابين، وإغلاق أحدهما وحده يترك
 * الآخر مفتوحًا:
 *
 *  ١. أن يعود اختبارٌ فيشتقّ جذر التجهيز من `process.cwd()`. يحرسه المسح الثابت (الأول).
 *  ٢. أن «يُصلَح» السقوط بإضعاف `app/environment.mjs` — توسيع المواضع المسموحة، أو استثناء
 *     للاختبارات، أو متغيّر بيئة يعطّل الحارس. وهذا أخطر من الهشاشة نفسها: يعيد العطب الذي أُغلق في
 *     TP2.4 (تجهيزٌ يفتح قاعدة التشغيل فيطبّق عليها ترحيلاته)، ويجعل الاختبارات كلها تمرّ وهي تكذب.
 *     يحرسه الاختبار السلوكي (الثاني): الرفض ما زال قائمًا، ولا باب خلفي فيه.
 *
 * فالاختبار الأول يمنع رجوع الشكل الهشّ، والثاني يثبت أن الإصلاح وقع في الاختبار لا في الحارس،
 * والثالث يقيس التقنية البديلة نفسها — مجلدًا مؤقتًا — فيثبت أن جذر التجهيز الذي تستعمله الاختبارات
 * لا يقع تحت شجرة مصدر ولا تحت شجرة تشغيل، فيعطي الجواب نفسه من أي موضع.
 *
 * الثابت المحروس: جواب الاختبار عن البيئة يتبع الكود، لا المجلد الذي انطلق منه المشغّل.
 */

const TESTS = new URL('./', import.meta.url);
const SOURCE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));

test('لا اختبارٌ يشتقّ جذر التجهيز من مكان تشغيله', () => {
  // التجهيز وحده يشتقّ قاعدةً من الجذر، فهو وحده الذي يمرّ على قاعدة الموضع الآمن (isLivePath
  // و«داخل مجلده»). فربطُ جذره بـcwd هو الشكل الذي كذب بعينه، وهو ما يُمسح هنا.
  //
  // وفي tests/ نداءان آخران بجذر cwd — server-truthfulness.test.mjs وconcurrency-server.mjs — وكلاهما
  // للتشغيل لا للتجهيز، والتشغيل لا يشتقّ قاعدة فلا يبلغ قاعدة الموضع أصلًا. فهما خارج هذا الثابت
  // بهذا السبب، لا سهوًا؛ ومبرّرهما مقيسٌ في السطر التالي لا مكتوبٌ في تعليق: إن صارت للتشغيل قاعدة
  // افتراضية بطل الاستثناء، فيسقط هذا الاختبار ويُعاد النظر في حدّ المسح.
  assert.equal(ENVIRONMENTS.local.db, null,
    'مبرّر إخراج التشغيل من هذا المسح أنه لا يشتقّ قاعدة من الجذر. صارت له قاعدة، فالمسح يجب أن يشمله.');

  const files = readdirSync(TESTS, { recursive: true })
    .map(String).filter(f => f.endsWith('.mjs') && !f.endsWith('environment-root-isolation.test.mjs'));
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(new URL(file, TESTS), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/resolveEnvironment\s*\(/.test(line)) return;
      const call = line + '\n' + (lines[i + 1] ?? '');   // النداء قد يلتفّ على سطرين
      if (/process\.cwd\s*\(\s*\)/.test(call) && /['"]staging['"]/.test(call)) offenders.push(file + ':' + (i + 1));
    });
  }
  assert.deepEqual(offenders, [],
    'جذر تجهيزٍ من process.cwd() يجعل نتيجة الاختبار تصف مكان تشغيله: يمرّ من شجرة التطوير ويسقط من\n'
    + 'شجرة التشغيل على كود واحد، لأن القاعدة المشتقّة تصير تحت `3-6t-live` فيرفضها الحارس محقًّا.\n'
    + 'استعمل موضعًا معزولًا — mkdtempSync(join(tmpdir(), ...)) — كما في screen-truthfulness.test.mjs.\n'
    + 'المواضع: ' + offenders.join('، '));
});

test('و`environment.mjs` ما زال يرفض موضعًا غير آمن — ولا باب خلفي فيه', () => {
  const refusedDb = error => error instanceof EnvironmentError && /لا يفتح قاعدة خارج/.test(error.message);

  // القاعدة العامة: مقطع `3-6t-live` في المسار يجعله موضع تشغيل، أيًّا كان ما حوله.
  assert.throws(() => resolveEnvironment({ ENV: 'staging' }, { root: '/any/where/3-6t-live' }), refusedDb);
  // والحالة المقيسة بعينها: شجرة التشغيل على جهاز المالك، وهي التي كان الاختبار يسقط منها.
  assert.throws(() => resolveEnvironment({ ENV: 'staging' },
    { root: '/Users/abdulaziz/Documents/Codex/2026-09-09/3-6t-live' }), refusedDb);
  // وموضعٌ خارج مجلد التجهيز يُرفض كذلك ولو لم يكن حيًّا.
  assert.throws(() => resolveEnvironment({ ENV: 'staging', LOCAL_DB_PATH: 'work/local.sqlite' },
    { root: '/srv/36t' }), refusedDb);

  // ولا استثناء للاختبارات: المتغيّرات التي تُغري بتعطيل الحارس لا تغيّر جوابه.
  for (const escape of [{ CI: '1' }, { NODE_ENV: 'test' }, { TEST: '1' }, { ALLOW_LIVE: '1' },
    { NODE_TEST_CONTEXT: 'child-v8' }, { SKIP_ENV_GUARD: '1' }]) {
    assert.throws(() => resolveEnvironment({ ENV: 'staging', ...escape }, { root: '/x/3-6t-live' }), refusedDb,
      'متغيّرُ بيئةٍ يفتح للتجهيز قاعدةً في موضع حيّ هو إضعافٌ للحارس، لا إصلاحٌ للاختبار: ' + JSON.stringify(escape));
  }

  // ولا هو مفرطٌ في المنع — وهذا شرط أن يبقى الرفض معنًى لا سدًّا: موضعٌ معزول يمرّ ويشتقّ داخل مجلده.
  const ok = resolveEnvironment({ ENV: 'staging' }, { root: '/srv/36t' });
  assert.equal(ok.key, 'staging');
  assert.equal(ok.dbPath, '/srv/36t/work/staging/staging.sqlite');
  assert.equal(ok.keyPath, '/srv/36t/work/staging/keys/field.key');
});

test('والتقنية البديلة مقيسة: جذرٌ مؤقت لا يقع تحت شجرة مصدر ولا شجرة تشغيل', () => {
  const root = mkdtempSync(join(tmpdir(), '36t-staging-root-'));
  try {
    const staging = resolveEnvironment({ ENV: 'staging' }, { root });
    assert.equal(staging.key, 'staging');
    assert.equal(staging.dbPath, join(root, 'work/staging/staging.sqlite'));
    assert.equal(isLivePath(staging.dbPath), false, 'مجلدٌ مؤقت ليس موضع تشغيل.');
    // وهذا هو الثابت الذي يُبطل الهشاشة: المسار لا يتبع شجرة المصدر، فلا يتغير بتغير مكان التشغيل.
    assert.ok(!resolve(staging.dbPath).startsWith(SOURCE_ROOT + '/'),
      'جذر التجهيز في الاختبارات يقع تحت شجرة المصدر، فجوابه يتبع مكان المشغّل: ' + staging.dbPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
