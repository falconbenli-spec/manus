import test from 'node:test';
import assert from 'node:assert/strict';
import { executiveCockpitUI } from '../app/static/executive-cockpit-ui.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const metric = (key, label, value, status = 'actual') => ({
  key, label, value, unit: 'count', status, source_module: 'test', source_link: `#${key}`,
  definition_version: 1, as_of: '2026-10-02T08:00:00.000Z', sample_size: value ?? 0,
  quality_state: status === 'unavailable' ? 'unavailable' : 'measured', owner: 'مالك المؤشر',
  period: { from: '2026-10-01', to: '2026-10-31' }, scope: 'tenant', note: status === 'unavailable' ? 'لا توجد عينة قابلة للقياس' : 'قياس مصطنع'
});
const dimensions = [
  ['cash', 'السيولة والتحصيل', metric('cash.overdue', 'المبالغ المتأخرة', null, 'unavailable')],
  ['growth', 'النمو والعملاء', metric('growth.weighted_pipeline', 'القمع الموزون', 14, 'forecast')],
  ['delivery', 'التسليم والمشاريع', metric('delivery.blocked', 'المشاريع المتوقفة', 2, 'derived')],
  ['people', 'الأفراد والسعة', metric('people.headcount', 'عدد الموظفين النشطين', 26)],
  ['risk', 'المخاطر والالتزام', metric('risk.red', 'المخاطر الحمراء المفتوحة', 1, 'derived')],
  ['quality', 'العملاء وجودة البيانات', metric('quality.unavailable', 'المؤشرات غير المقاسة', 1, 'derived')]
].map(([key, label, item]) => ({ key, label, state: item.status === 'unavailable' ? 'unknown' : item.value ? 'attention' : 'good', metrics: [item], attention: [] }));
const fixture = {
  today: '2026-10-02', generated_at: '2026-10-02T08:00:00.000Z', period: { from: '2026-10-01', to: '2026-10-31' },
  summary: 'السيولة تحتاج استكمال القياس؛ والتسليم يحتاج متابعة.', dimensions,
  attention: [{ key: 'delivery.blocked', severity: 'attention', text: 'مشروعان يحتاجان تدخلًا.', source_link: '#projects' }]
};
fixture.actionable = fixture.dimensions.flatMap(dimension => dimension.metrics).filter(item => item.source_link);

test('cockpit renders truth state and accessible drilldown controls', () => {
  const html = executiveCockpitUI.render(fixture, { e });
  assert.match(html, /نبض الشركة/);
  assert.match(html, /غير مقاس/);
  assert.match(html, /متوقع/);
  assert.match(html, /aria-label="فتح تفاصيل/);
  assert.doesNotMatch(html, /undefined|NaN| style=|<script/);
  assert.equal((html.match(/data-action="open-metric"/g) || []).length, fixture.actionable.length);
  assert.equal((html.match(/class="cockpit-signal is-/g) || []).length, 1);
});

test('cockpit limits the first view and escapes source text', () => {
  const crowded = {
    ...fixture,
    summary: '<img src=x onerror=alert(1)>',
    dimensions: [{ key: 'many', label: 'بعد مزدحم', state: 'attention', metrics: Array.from({ length: 10 }, (_, index) => metric(`m.${index}`, `مؤشر ${index}`, index)), attention: [] }],
    attention: Array.from({ length: 8 }, (_, index) => ({ key: `a.${index}`, severity: 'attention', text: `إشارة ${index}`, source_link: '#work' }))
  };
  const html = executiveCockpitUI.render(crowded, { e });
  assert.equal((html.match(/class="cockpit-metric is-/g) || []).length, 7);
  assert.equal((html.match(/class="cockpit-signal is-/g) || []).length, 5);
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /&lt;img/);
});

test('metric form explains withheld details without inventing rows', () => {
  const html = executiveCockpitUI.form('open-metric', 'people.headcount', {
    metric: metric('people.headcount', 'عدد الموظفين النشطين', 26),
    details_withheld: true,
    rows: [],
    note: 'التفاصيل تحتاج تصريح السجل الوظيفي.'
  });
  assert.match(html, /عدد الموظفين النشطين/);
  assert.match(html, /التفاصيل تحتاج تصريح السجل الوظيفي/);
  assert.doesNotMatch(html, /undefined|NaN|<script/i);
});
