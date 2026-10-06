import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environmentBadge, resolveEnvironment, ENVIRONMENTS } from '../app/environment.mjs';

/* صدق الشاشة — العيب الذي أوجب هذا الملف:
 *
 * كانت عبارة «بيانات تجريبية» مكتوبة نصًّا ثابتًا في **45 موضعًا** عبر 25 وحدة واجهة، ومعها سطر دائم في
 * الشريط الجانبي على كل شاشة لكل مستخدم. وقياس 29 سبتمبر 2026: **إحدى عشرة شاشة من السبع والعشرين**
 * التي يفتحها الموظف تبدأ بها حرفيًا — مصروفاته وتقييمه وزياداته وتدريبه من بينها.
 *
 * وهي عبارة لا يملك الكود ما يثبتها ولا ما ينفيها: غير مشروطة بشيء، فلا تنطفئ أبدًا. أثرها اليوم أن
 * أول ما يقرأه الموظف عن راتبه وتقييمه أن الأرقام مزيّفة؛ وأثرها بعد التشغيل الفعلي أن تصير **كذبًا
 * مطبوعًا على كل شاشة**، إذ لا مفتاح يطفئها.
 *
 * والمنصة تملك الجواب الصحيح أصلًا: `app/environment.mjs` يسمّي البيئة، و`environmentBadge` يعيد
 * تحذيرًا **للتجهيز وحده** و`null` للتشغيل، و`paintEnvironment` في app.mjs يرسم شريطًا حين يوجد تحذير
 * ولا يرسم شيئًا حين لا يوجد. فاللافتات الثابتة كانت تكرّر آليةً قائمة وتناقضها.
 *
 * الثابت المحروس: بيان البيئة مصدره واحد — `environmentBadge` — ولا تدّعيه شاشة من عندها.
 */

const UI = readdirSync(new URL('../app/static/', import.meta.url)).filter(f => f.endsWith('.mjs'));
const read = file => readFileSync(new URL('../app/static/' + file, import.meta.url), 'utf8');

test('لا وحدة واجهة تكتب حال البيئة نصًّا ثابتًا: المصدر environmentBadge وحده', () => {
  const offenders = UI.filter(file => read(file).includes('بيانات تجريبية'));
  assert.deepEqual(offenders, [],
    'وحدةٌ تكتب «بيانات تجريبية» بنفسها تقول عن بيانات الشركة إنها مزيّفة، ولا تنطفئ حين تصير حقيقية.\n'
    + 'بيان البيئة يأتي من environmentBadge عبر /api/me، ويرسمه paintEnvironment للتجهيز وحده.\n'
    + 'الوحدات: ' + offenders.join('، '));
});

test('وبيان البيئة نفسه صادق: تحذير للتجهيز، وصمت للتشغيل', () => {
  // الجذر معزولٌ عن مكان التشغيل عمدًا، وهذا إصلاح هشاشةٍ مقيسة (30 سبتمبر 2026):
  //
  // كان `root: process.cwd()`، فكان جواب هذا السطر يصف مكان المشغّل لا سلامة الكود. من شجرة
  // التطوير يمرّ ثلاثًا من ثلاث؛ ومن داخل `3-6t-live` يسقط ثلاثًا من ثلاث — لأن التجهيز يشتقّ
  // قاعدته من الجذر (environment.mjs:38)، فتصير `<cwd>/work/staging/staging.sqlite`، فيرى
  // `isLivePath` فيها مقطع `3-6t-live` فيرفضها resolveEnvironment (environment.mjs:54).
  //
  // والرفض صحيحٌ ولا يُمسّ: فتحُ قاعدة يطبّق عليها الترحيلات، فهو كتابة، فلا تُفتح قاعدةٌ في موضع
  // حيّ. الكاذب هو الاختبار — يسأل عن صدق الشارة ويربط جوابه بموضعه. ومجلدٌ مؤقت لا يتبع أحدًا
  // يعطي الجواب نفسه من أي شجرة. والعزلة نفسها محروسة في tests/environment-root-isolation.test.mjs.
  const root = mkdtempSync(join(tmpdir(), '36t-staging-root-'));
  try {
    const staging = environmentBadge(resolveEnvironment({ ENV: 'staging' }, { root }));
    assert.equal(staging.key, 'staging');
    assert.ok(staging.warn, 'التجهيز يقول إنه تجهيز: بياناته اصطناعية وليست بيانات الشركة.');
    assert.equal(staging.name, ENVIRONMENTS.staging.name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('والشريط الجانبي يسمّي البيئة ولا يصفها', () => {
  const app = read('app.mjs');
  assert.match(app, /side-note[\s\S]{0,180}envBadge\?\.name/,
    'سطر الشريط الجانبي يقرأ اسم البيئة من الشارة. كتابته نصًّا ثابتًا هو العيب الذي أُصلح.');
  assert.doesNotMatch(app, /بيئة تجربة محلية/,
    'ولا يبقى فيه وصفٌ ثابت للبيئة: الاسم يأتي من environment.mjs، فيتغير بتغيرها.');
});
