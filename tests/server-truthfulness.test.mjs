import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ENVIRONMENTS, environmentBadge, resolveEnvironment } from '../app/environment.mjs';

/* صدق الخادم — العيب الذي أوجب هذا الملف:
 *
 * كان الحقل `environment:'synthetic'` مكتوبًا نصًّا ثابتًا في **129 موضعًا عبر 90 وحدة خادم** في app/،
 * في رأس كل حمولة تقريبًا: الإجازات، والرواتب، والتقييم، والسياسات، وجرد حوكمة الذكاء الاصطناعي.
 * وقياس 29 سبتمبر 2026: القاعدة الحيّة تحمل الهيكل التنظيمي الحقيقي والسياسات المعتمدة — فالحقل يقول
 * عن بيانات الشركة إنها مصطنعة، وهو غير مشتقٍّ من شيء، فلا ينطفئ أبدًا مهما صارت البيانات حقيقية.
 *
 * وقد قِيس أن **لا وحدة واجهة تقرؤه**: لا قارئ لـ`data.environment` في app/static/*.mjs بحال. الحقل
 * الوحيد المقروء هو `auth.environment` العائد من ‎/api/me‎ و‎/api/login‎، وهو الشارة الحقيقية من
 * `environmentBadge` — تُحذّر للتجهيز وتصمت للتشغيل، ويرسمها `paintEnvironment`. فحقلٌ لا يقرؤه أحد
 * ويقول شيئًا غير صحيح أسوأ من لا حقل: حُذف ولم يُستبدل باشتقاق، لأن المصدر الصحيح قائمٌ ومقروءٌ فعلًا
 * في المكان الصحيح، وتكراره في كل حمولة يعيد العطب بشكل آخر.
 *
 * وكان تأكيدٌ واحد في tests/leave.test.mjs يثبّت الكذبة، فتحرسها مجموعة الاختبارات بدل أن تكشفها.
 *
 * الثابت المحروس: حال البيئة لا تُكتب بيد في أي حمولة خادم — تُسمّى مرة في app/environment.mjs،
 * وتخرج للقارئ من `environmentBadge` وحده.
 *
 * (هذا الحارس على الحقل `environment` باسمه. حقلٌ باسم آخر يحمل المعنى نفسه لا يلتقطه — والصواب حذفه
 * لا توسيع الحارس ليقبله.)
 */

const APP = new URL('../app/', import.meta.url);
const MODULES = readdirSync(APP).filter(f => f.endsWith('.mjs'));
const read = file => readFileSync(new URL(file, APP), 'utf8');

// حقل `environment` تُسنَد إليه سلسلة نصية ثابتة.
const FIELD = /\benvironment[ \t]*:[ \t]*'([^']*)'/g;
// مفردات «حال البيئة»: أسماء البيئات كما يعرّفها environment.mjs، ثم كلمات حقيقة البيانات.
// قيمةٌ خارج هذه المفردات ليست بيانًا عن البيئة (مثل وصف سجلٍّ بأنه مقترح داخلي)، فلا يعنيها هذا الحارس.
const STATE_WORDS = [...Object.keys(ENVIRONMENTS),
  'synthetic', 'real', 'production', 'prod', 'staging', 'demo', 'sandbox', 'live', 'fake', 'dummy', 'mock', 'dev', 'test'];
const namesEnvironmentState = value =>
  value.split(/[^a-z]+/i).some(word => STATE_WORDS.includes(word.toLowerCase()));

test('لا وحدة خادم تكتب حال البيئة نصًّا ثابتًا: المصدر environment.mjs وحده', () => {
  const offenders = [];
  for (const file of MODULES)
    for (const match of read(file).matchAll(FIELD))
      if (namesEnvironmentState(match[1])) offenders.push(`${file} → environment:'${match[1]}'`);

  assert.deepEqual(offenders, [],
    'حمولةٌ تكتب حال البيئة بنفسها تقول عن بيانات الشركة ما لا يملك الكود إثباته، ولا تنطفئ حين تتغير البيئة.\n'
    + 'البيئة تُسمّى مرة في app/environment.mjs، وبيانها يخرج من environmentBadge عبر ‎/api/me‎ و‎/api/login‎،\n'
    + 'ويرسمه paintEnvironment للتجهيز وحده. لا تُعِد الحقل إلى الحمولة ولو مشتقًّا: المصدر قائم ومقروء.\n'
    + 'المواضع: ' + offenders.join('، '));
});

test('والمصدر الصحيح ما زال يصل القارئ: الشارة على ‎/api/me‎ و‎/api/login‎', () => {
  const server = read('server.mjs');
  const routes = [...server.matchAll(/'\/api\/(me|login)'/g)].map(m => m[1]);
  assert.ok(routes.includes('me') && routes.includes('login'), 'المساران قائمان');
  assert.equal([...server.matchAll(/environment:environmentBadge\(environment\)/g)].length, 2,
    'الشارة الحقيقية تُرسَل على المسارين معًا. حذفُها يترك الشاشة بلا بيان بيئة أصلًا،\n'
    + 'وهو ما يجعل حذف الحقل الثابت من الحمولات آمنًا: البديل ليس الصمت، بل المصدر المشتقّ.');
});

test('وبيان البيئة نفسه صادق: صمتٌ للتشغيل وتحذيرٌ للتجهيز', () => {
  const live = environmentBadge(resolveEnvironment({ ENV: 'local' }, { root: process.cwd() }));
  assert.equal(live.warn, null, 'التشغيل لا يدّعي أن بيانات الشركة مصطنعة.');
  assert.equal(live.name, ENVIRONMENTS.local.name);
});
