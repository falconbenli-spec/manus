import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { kit } from '../app/static/kit.mjs';
import { catalogHome, catalogResults, countsLine, visibleCountsLine, departmentLens, departmentLensCounts } from '../app/static/catalog-home-ui.mjs';

/* سطر الحالة فوق «الخدمات» — العيب الذي أوجب هذا الملف:
 *
 * الشاشة تُفتح على عدسة «حسب الإدارة» (ت1): شريط الإدارات و«كل الخدمات N» مبنيّان من /api/catalog. وكان السطر فوقها
 * يقول دائمًا عدّ شجرة «حسب الحاجة» (countsLine على /api/catalog/tree، إسقاط catalog_placement) — مصدرٌ آخر لعدسةٍ
 * غير ظاهرة. قيس في المعاينة (30 سبتمبر، قاعدة بذرت خدماتها ولم يُسقَط دليلها): «0 فئات · 0 بطاقات · 0 خدمات» فوق
 * خدماتٍ ظاهرة. وحيث الإسقاط قائم يقول السطر أرقام الشجرة لا أرقام ما تحته. الإصلاح: سطر الحالة يصف العدسة المرسومة.
 */

const PASSWORD = 'synthetic-services-counts';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = kit(e, ar => ar);

async function screen(t, { install }) {
  const db = openDb(':memory:'); seed(db, PASSWORD); if (install) installServiceCatalog(db); t.after(() => db.close());
  const app = createApp(db);
  const login = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: 'employee', password: PASSWORD } });
  assert.equal(login.status, 200);
  const cookie = login.headers['Set-Cookie'].split(';')[0], get = async path => (await dispatch(app, { path, headers: { cookie } })).json();
  const me = (await get('/api/me')).user, services = await get('/api/catalog'), departments = await get('/api/departments');
  const variants = await get('/api/catalog/variants'), tree = await get('/api/catalog/tree');
  return { me, services, departments, variants: Array.isArray(variants) ? variants : [], tree };
}

// ما يرسمه app.mjs في فرع عدسة الإدارة، من الدوال نفسها.
function departmentView({ me, services, departments, variants, tree }) {
  const lens = departmentLens({ departments, services, me, e, variants });
  const counts = departmentLensCounts({ departments, services, variants });
  const html = catalogHome({ ...tree, lens: 'department' }, { e, ui, extra: lens, counts });
  const status = /<p class="sc-counts"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? '';
  const all = Number(/<span>كل الخدمات<\/span><small>(\d+)<\/small>/.exec(lens)?.[1]);
  const railDepartments = (lens.match(/class="rq-rail-item tone-/g) ?? []).length;
  return { html, lens, counts, status, all, railDepartments };
}

for (const install of [false, true]) {
  test(`«الخدمات» بعدسة الإدارة: سطر الحالة يعدّ ما تحته — ${install ? 'بعد إسقاط الدليل' : 'قاعدة بذرت خدماتها ولم يُسقَط دليلها (حال المعاينة)'}`, async t => {
    const data = await screen(t, { install });
    const view = departmentView(data);
    assert.ok(view.all > 0, 'مقدمة: خدماتٌ ظاهرة في شريط الإدارات');
    if (!install) assert.equal(countsLine(data.tree), '0 فئات · 0 بطاقات · 0 خدمات', 'مقدمة: هذا ما كان السطر يقوله فوقها');
    assert.match(view.status, new RegExp(`^${view.all} `), `السطر «${view.status}» والشريط يقول «كل الخدمات ${view.all}»`);
    assert.match(view.status, new RegExp(` ${view.railDepartments} `), `والإدارات عدد مداخل الشريط (${view.railDepartments})`);
    assert.doesNotMatch(view.status, /^0 /);
    // تفريغ صندوق البحث يعيد اللوح نفسه والإعلان نفسه، لا أرقام الشجرة.
    const empty = catalogResults(data.tree, '  ', { e, ui, extra: view.lens, counts: view.counts });
    assert.equal(empty.html, view.lens); assert.equal(empty.announce, view.status);
  });
}

test('«الخدمات»: بلا counts يعرض سطرًا عامًا بسيطًا عن الخدمات المتاحة', async t => {
  const data = await screen(t, { install: true });
  const html = catalogHome(data.tree, { e, ui });
  assert.ok(html.includes(`>${visibleCountsLine(data.tree)}</p>`));
});

test('app.mjs يمرّر عدّ العدسة إلى الرسم الأول وإلى إعادة الرسم بعد البحث، ويصفّره مع اللوح', () => {
  const app = readFileSync(new URL('../app/static/app.mjs', import.meta.url), 'utf8');
  assert.ok(app.includes('catalogCounts=departmentLensCounts({departments:list,services,variants:variantGroups});'));
  assert.ok(app.includes('html=catalogHome(catalogTree,{e,ui:uiKit,extra:catalogExtra,counts:catalogCounts});'));
  assert.ok(app.includes('catalogResults(catalogTree,catalogQuery,{e,ui:uiKit,extra:catalogExtra,counts:catalogCounts})'));
  assert.ok(app.includes("catalogQuery='';catalogExtra='';catalogCounts='';"), 'العدّ يُصفَّر مع ما رُسم أولًا');
});
