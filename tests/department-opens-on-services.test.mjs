import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, variantCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';
import { kit } from '../app/static/kit.mjs';
import { DEPARTMENT_SECTIONS, departmentPageView } from '../app/static/catalog-home-ui.mjs';

// طلب المالك — 30 سبتمبر 2026: «وطلّع الخدمات الفرعية بعد النقر على كل إدارة».
//
// ما كان يحدث: صفحة الإدارة تُبنى أقسامًا مرتّبة (نظرة عامة، الطلبات الواردة، الخدمات، الفريق،
// التقارير)، والقسم المعروض حين لا يسمّي الرابط قسمًا هو **أولها**. فمن ينقر إدارةً من شريط
// «الخدمات» يقع على «نظرة عامة»: بلاطات عدد وأدوات الإدارة — ولا يرى خدمةً واحدة حتى ينقر تبويبًا ثانيًا.
// وهو جاء يسأل «وش أقدر أطلب من هذي الإدارة».
//
// الثابت المحروس: **الخدمات أول ما يُقرأ في صفحة الإدارة**، في ترتيب التبويبات وفي ترتيب الأقسام
// المرسومة معًا. وبقية الأقسام تبقى على الصفحة نفسها تحتها، فلا يُفقد شيء بتقديم الخدمات.

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = kit(e, ar => ar);

function arena() {
  const db = openDb(':memory:');
  seed(db, 'synthetic-department-order');
  installServiceCatalog(db);
  const member = db.prepare("SELECT * FROM users WHERE role='employee' AND department_id IS NOT NULL AND active=1 LIMIT 1").get();
  const departments = db.prepare('SELECT * FROM departments').all();
  const services = catalog(db, member);
  const variants = variantCatalog(db, member);
  db.close();
  return { member, departments, services, variants };
}

/** ترتيب التبويبات كما تُرسم في الصفحة، لا كما يُفترض. */
const tabsIn = html => [...html.matchAll(/href="#departments\/[^/]+\/([a-z]+)"[^>]*>([^<]+)</g)].map(m => m[1]);
/** ترتيب الأقسام المرسومة نفسها. */
const sectionsIn = html => [...html.matchAll(/id="dept-([a-z]+)"/g)].map(m => m[1]);

test('ترتيب الأقسام المعلن يبدأ بالخدمات', () => {
  assert.equal(DEPARTMENT_SECTIONS[0].key, 'services',
    'أول قسم في DEPARTMENT_SECTIONS ليس «الخدمات»، فصفحة الإدارة تُفتح على غير ما جاء له الزائر.');
});

test('من ينقر إدارته يقع على خدماتها، لا على أدواتها', () => {
  const { member, departments, services, variants } = arena();
  const html = departmentPageView({ id: member.department_id, departments, services, variants, me: member, e, ui });
  const tabs = tabsIn(html), sections = sectionsIn(html);
  assert.ok(tabs.length > 1, 'الصفحة بلا تبويبات، فتغيّر شكلها ويلزم مراجعة هذا الحارس');
  assert.equal(tabs[0], 'services',
    `أول تبويب «${tabs[0]}» لا «services». الترتيب المرسوم: ${tabs.join(' ← ')}`);
  assert.equal(sections[0], 'services',
    `أول قسم مرسوم «${sections[0]}» لا «services». الترتيب المرسوم: ${sections.join(' ← ')}`);
});

test('وتقديم الخدمات لا يُسقط قسمًا: النظرة العامة وما بعدها باقية تحتها', () => {
  const { member, departments, services, variants } = arena();
  const sections = sectionsIn(departmentPageView({ id: member.department_id, departments, services, variants, me: member, e, ui }));
  assert.ok(sections.includes('overview'),
    'قسم «نظرة عامة» اختفى مع إعادة الترتيب — المطلوب تقديم الخدمات لا حذف غيرها.');
  assert.ok(sections.indexOf('services') < sections.indexOf('overview'),
    'الخدمات ليست قبل النظرة العامة في الصفحة المرسومة.');
  assert.equal(new Set(sections).size, sections.length,
    `قسمٌ مرسوم مرتين: ${sections.join(' ← ')}. إعادة الترتيب أضافت نسخةً ولم تنقل.`);
});
