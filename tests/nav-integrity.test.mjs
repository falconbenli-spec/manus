import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

/* سلامة القائمة — العيب الذي أوجب هذا الملف:
 *
 * تُبنى القائمة في app/static/app.mjs من 116 سطر `nav.push` مشروطة بتصاريح الحساب. ولا شيء كان يمنع
 * مدخلين من الوصول إلى **الوجهة نفسها**، ولا من أن يَعِد مدخلٌ بشاشة لا تعرض لصاحبها شيئًا.
 *
 * وقع الأول فعلًا: `ROUTE_ALIASES` يحوّل ‎#catalog‎ إلى ‎#services‎ لكل حساب غير الأدمن، وكان المدخلان
 * «مركز الخدمات» و«طلب خدمة» معًا في قائمة الموظف — بابان يفتحان الشاشة عينها. (قياس 29 سبتمبر 2026:
 * قائمة الموظف 32 مدخلًا.)
 *
 * ووقع الثاني: «زياداتي» — ونصّ الشاشة نفسه يقول «لا يرى أحد مقترحًا يخصه».
 *
 * الثابت المحروس هنا هو الأول لأنه بنيويّ وقابل للقياس: **لا مدخلان في قائمة حسابٍ واحد يحلّان إلى
 * المسار نفسه.** والثاني يحرسه وجود شرط التصريح على سطره.
 *
 * ولماذا يُقيَّم بلوك القائمة من المصدر: `app/static/app.mjs` وحدة متصفّح تحتاج DOM، وبناء القائمة
 * دالة خالصة من `me` — فيُستخرج البلوك بين مرساتين ثابتتين ويُشغَّل بـ`me` حقيقية من ‎/api/me‎.
 */

const PASSWORD = 'synthetic-nav-integrity';
const START = 'const allowed=new Set(me.can||[]);';
const END = '  navItems=nav;';

function navBuilder() {
  const source = readFileSync(new URL('../app/static/app.mjs', import.meta.url), 'utf8');
  const from = source.indexOf(START), to = source.indexOf(END);
  assert.ok(from > 0 && to > from,
    'تغيّرت مرساتا بلوك القائمة في app/static/app.mjs. راجع هذا الحارس بدل حذفه: '
    + `البداية «${START}» والنهاية «${END}».`);
  const block = source.slice(from, to);
  // eslint-disable-next-line no-new-func
  return new Function('document', `return (function(me){${block}\nreturn nav;});`)({ documentElement: { dataset: {} } });
}

// ROUTE_ALIASES في app.mjs: ما يُحوَّل إلى مسار آخر يُحسب بوجهته لا باسمه.
function resolvedRoute(key, role) {
  if (key === 'catalog') return role !== 'admin' ? 'services' : 'catalog';
  return key;
}

async function personas(t) {
  const db = openDb(':memory:'); seed(db, PASSWORD); t.after(() => db.close());
  const app = createApp(db);
  const out = {};
  for (const persona of ['employee', 'manager', 'hr', 'admin']) {
    const login = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: persona, password: PASSWORD } });
    assert.equal(login.status, 200, persona);
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    out[persona] = (await dispatch(app, { path: '/api/me', headers: { cookie } })).json().user;
  }
  return out;
}

test('لا مدخلان في قائمة حساب واحد يفتحان الوجهة نفسها', async t => {
  const build = navBuilder(), me = await personas(t);
  for (const [persona, user] of Object.entries(me)) {
    const routes = build(user).map(entry => resolvedRoute(entry[0], user.role));
    const duplicates = routes.filter((route, i) => routes.indexOf(route) !== i);
    assert.deepEqual([...new Set(duplicates)], [],
      `قائمة «${persona}» فيها مدخلان يصلان المسار نفسه: ${[...new Set(duplicates)].join('، ')}. `
      + 'بابان إلى وجهة واحدة يجعلان القارئ يظن أن أحدهما شيء آخر، ويطيلان القائمة بلا وظيفة.');
  }
});

test('ولا مدخل بلا وجهة: كل مفتاح في القائمة مسجَّل في سجل الوجهات', async t => {
  const build = navBuilder(), me = await personas(t);
  // سجل الوجهات في app/static/nav-map.mjs هو عقد القائمة في هذا المستودع، فيُقرأ منه لا من قائمة تُكتب
  // هنا باليد: قائمةٌ يدوية تتقادم بصمت، وقد تقادمت فعلًا أول مرة كُتب فيها هذا الاختبار (سقط على
  // service-benchmark وexecutive وهما مساران حقيقيان يرسمهما app.mjs).
  const { NAV_DEST } = await import('../app/static/nav-map.mjs');
  for (const [persona, user] of Object.entries(me)) {
    const unknown = build(user).map(entry => entry[0]).filter(key => !Object.hasOwn(NAV_DEST, key));
    assert.deepEqual(unknown, [],
      `قائمة «${persona}» تحمل مفاتيح ليست في NAV_DEST: ${unknown.join('، ')}. `
      + 'مدخلٌ بلا وجهة مسجَّلة لا يجد موضعه في الصفحات الجامعة ولا في البحث.');
  }
});

test('وقائمة الموظف العادي تبقى في حدود ما يستعمله', async t => {
  const build = navBuilder(), me = await personas(t);
  const size = build(me.employee).length;
  assert.ok(size <= 32,
    `قائمة الموظف صارت ${size} مدخلًا. كانت 32 يوم 29 سبتمبر 2026 وهو رقمٌ يُنزَّل لا يُرفع: `
    + 'المعيار في أنظمة الخدمة الذاتية 8–14 مدخلًا. أي مدخل جديد للموظف يزيح مدخلًا أو يندمج معه.');
});
