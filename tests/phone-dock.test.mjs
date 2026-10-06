import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { navSections } from '../app/static/nav-map.mjs';
import { groupedNavigation } from '../app/static/hr-design.mjs';

/* شريط الجوال (signature.mjs → mountTabs) — العيب الذي أوجب هذا الملف:
 *
 * الشريط وعدٌ ثابت: أربع وجهات يومية بترتيب واحد — الرئيسية، عملي (بشارته)، الخدمات، طلباتي — ثم «الفهرس».
 * وكان يأخذ وجهاته من روابط القائمة «الظاهرة» وحدها ويتجاهل كتلة «كل شاشاتك» المخفية ([data-nav-reach]).
 * ثم صارت القائمة أقسامًا ثمانية تسمّي مواضع (#section/work، #section/services…)، فانتقلت #work و#services
 * و#my-requests إلى تلك الكتلة وحدها لكل حساب غير «موظف». النتيجة المقيسة في المتصفح (30 سبتمبر، حساب المدير،
 * عرض 390): الشريط «الرئيسية» و«الفهرس» فقط — والمدير الذي يقرر من جواله يحتاج ثلاث نقرات ليبلغ صندوقه.
 *
 * يُبنى هنا ما يبنيه المتصفح فعلًا، من المصادر نفسها وبلا منفذ: حمولة /api/me لكل شخصية عبر dispatch، ثم بلوك
 * القائمة من app.mjs (بمرساتي tests/nav-integrity.test.mjs)، ثم أقسام navSections، ثم ترميز groupedNavigation — ومنه
 * تُقرأ الروابط وموضع كل رابط من الكتلة المخفية. ثم تُشغَّل mountTabs نفسها مقتطعةً من signature.mjs في صندوق.
 */

const PASSWORD = 'synthetic-phone-dock';
const APP = readFileSync(new URL('../app/static/app.mjs', import.meta.url), 'utf8');
const SIGNATURE = readFileSync(new URL('../app/static/signature.mjs', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function navBuilder() {
  const START = 'const allowed=new Set(me.can||[]);', END = '  navItems=nav;';
  const from = APP.indexOf(START), to = APP.indexOf(END);
  assert.ok(from > 0 && to > from, `تغيّرت مرساتا بلوك القائمة في app.mjs («${START}» … «${END}»)`);
  // eslint-disable-next-line no-new-func
  return new Function('document', `return (function(me){${APP.slice(from, to)}\nreturn nav;});`)({ documentElement: { dataset: {} } });
}

// mountTabs كما هي في signature.mjs، مع ثابتَيها، في صندوق يعطيها ما تمده بها الوحدة: الجذر والمنشئ والمترجم.
function dockFor(anchors, audience) {
  const start = SIGNATURE.indexOf('const tabOrders='), end = SIGNATURE.indexOf('// ===== العنوان الكبير', start);
  assert.ok(start > 0 && end > start, 'تغيّرت مرساتا mountTabs في signature.mjs');
  const appended = [];
  const sandbox = {
    root: { dataset: { audience } },
    make: (tag, className) => ({ tag, className, attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; } }),
    t: ar => ar, esc: escape, routeKey: () => 'home', icon: () => '<svg></svg>', icons: { index: '' },
    navLabel: a => a.label,
  };
  runInNewContext(`${SIGNATURE.slice(start, end)};globalThis.mountTabs=mountTabs;`, sandbox);
  const shell = { querySelector: () => null, append: el => appended.push(el) };
  const nav = { querySelectorAll: selector => { assert.equal(selector, 'a[href^="#"]'); return anchors; } };
  sandbox.mountTabs(shell, nav);
  assert.equal(appended.length, 1, 'الشريط يُركَّب مرة واحدة');
  const html = appended[0].innerHTML;
  return { html, hrefs: [...html.matchAll(/<a href="#([^"]+)"/g)].map(m => m[1]) };
}

// روابط الترميز كما يقرؤها querySelectorAll، وكل رابط يعرف هل يقع داخل الكتلة المخفية.
function anchorsOf(html) {
  const reachAt = html.indexOf('data-nav-reach');
  return [...html.matchAll(/<a href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => {
    const inReach = reachAt >= 0 && m.index > reachAt, icon = /<svg[\s\S]*?<\/svg>/.exec(m[2])?.[0] ?? null;
    return {
      key: m[1], inReach, label: m[2].replace(/<[^>]+>/g, ''),
      getAttribute: name => (name === 'href' ? '#' + m[1] : null),
      closest: selector => (selector === '[data-nav-reach]' && inReach ? {} : null),
      querySelector: selector => (selector === '.nav-icon svg' && icon ? { outerHTML: icon } : null),
    };
  });
}

async function personas(t) {
  const db = openDb(':memory:'); seed(db, PASSWORD); t.after(() => db.close());
  const app = createApp(db), build = navBuilder(), out = {};
  for (const persona of ['employee', 'manager', 'hr']) {
    const login = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: persona, password: PASSWORD } });
    assert.equal(login.status, 200, persona);
    const me = (await dispatch(app, { path: '/api/me', headers: { cookie: login.headers['Set-Cookie'].split(';')[0] } })).json().user;
    const nav = build(me);
    const side = navSections(nav, me, { departments: [] }).map(row => [row.route, row.glyph, row.label, '']);
    const html = groupedNavigation(side, 'home', escape, { reach: nav.map(([key, icon, ar]) => [key, icon, ar]) });
    out[persona] = { me, nav, anchors: anchorsOf(html) };
  }
  return out;
}

test('شريط الجوال: الوجهات اليومية الأربع حاضرة لكل حساب يبلغها — ولو كانت روابطها في كتلة «كل شاشاتك» المخفية', async t => {
  const all = await personas(t);
  for (const [persona, { me, nav, anchors }] of Object.entries(all)) {
    const reachable = new Set(nav.map(entry => entry[0]).concat('home'));
    const expected = ['home', 'work', 'services', 'my-requests'].filter(key => reachable.has(key));
    const { hrefs } = dockFor(anchors, me.role === 'employee' ? 'employee' : 'staff');
    assert.deepEqual(hrefs, expected,
      `شريط «${persona}» يعرض ${hrefs.map(h => '#' + h).join('، ') || 'لا شيء'} والحساب يبلغ ${expected.map(h => '#' + h).join('، ')}. `
      + 'الشريط يأخذ وجهاته من القائمة كلها: الرابط الظاهر أولًا، ثم كتلة [data-nav-reach] لما لا رابط ظاهرًا له.');
  }
  // الحالة التي كسرتها القائمة الجديدة بعينها: للمدير رابط العمل اليومي داخل الكتلة المخفية وحدها.
  const work = all.manager.anchors.filter(a => a.key === 'work');
  assert.ok(work.length && work.every(a => a.inReach), 'مقدمة الاختبار: #work للمدير في الكتلة المخفية وحدها (وإلا تغيّرت القائمة فراجع الحارس)');
});

test('شريط الجوال: الرابط الظاهر يغلب نظيره في الكتلة المخفية، والكتلة لا تزيد الشريط على أربع', () => {
  const link = (key, inReach, icon) => ({
    key, inReach, label: key, getAttribute: () => '#' + key,
    closest: selector => (selector === '[data-nav-reach]' && inReach ? {} : null),
    querySelector: selector => (selector === '.nav-icon svg' ? { outerHTML: `<svg data-from="${icon}"></svg>` } : null),
  });
  const anchors = [link('reports', true, 'r'), link('work', true, 'reach'), link('home', false, 'v'), link('work', false, 'visible'),
    link('services', true, 'r'), link('my-requests', true, 'r'), link('projects', true, 'r')];
  const { html, hrefs } = dockFor(anchors, 'staff');
  assert.deepEqual(hrefs, ['home', 'work', 'services', 'my-requests']);
  assert.match(html, /<a href="#work"[^>]*><svg data-from="visible">/, 'رابط العمل الظاهر هو مصدر أيقونته لا نظيره المخفي');
  assert.match(html, /data-shell="drawer"/, 'وزر «الفهرس» باقٍ بعد الوجهات');
});
