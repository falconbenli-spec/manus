import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { buildEpmoBody } from '../app/epmo-report.mjs';

// بعد دمج «النطاق التنفيذي» مع تقرير E01 (22 سبتمبر 2026). ملف تسليم التقرير (§5) أوجب ثلاثة فحوص عند هذا الدمج:
// شكل المُرجَع، والتصريح، والاختبار الذي يجب أن ينقلب. هذا الملف هو الثلاثة معًا.
function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-epmo-entity-scope-tests-only'); t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('epmo-lead','36t','ops','epmo-lead','قائدة مكتب المشاريع المصطنعة','unused-test-hash','manager',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  const grant = capability => transaction(db, () => grantAccess(db, users.admin, { user_id: 'epmo-lead', capability, department_id: '', note: 'تصريح اختبار نطاق الكيان في تقرير EPMO' }));
  grant('epmo.review');
  return { db, users, grant };
}
const PERIOD = { from: '2026-08-01', to: '2026-08-31' };
const figuresOf = (body, key) => body.sections.find(s => s.key === key).groups.flatMap(g => g.figures);
const measured = figures => figures.filter(f => typeof f.value === 'number');

test('E01 entity scope: a preparer without the executive capability gets a declared gap that names the capability — the report does not fall', t => {
  const { db, users } = fixture(t);
  const body = buildEpmoBody(db, users['epmo-lead'], PERIOD);
  for (const key of ['portfolio', 'pipeline']) {
    const figures = figuresOf(body, key);
    assert.equal(measured(figures).length, 0, `${key}: no number without the entity scope`);
    const gap = figures.find(f => /اللوحة التنفيذية/.test(f.reason ?? ''));
    assert.ok(gap, `${key}: the gap names the missing capability`);
    assert.match(gap.needed, /الأدمن الأول/, 'and who grants it');
    assert.doesNotMatch(gap.reason, /لم يُدمج/, 'the branch is merged; the reason is the capability, not the merge');
  }
  assert.ok(body.sections.length > 2, 'every other section is still built');
});

test('E01 entity scope: with the capability both sections carry numbers, read from the merged functions by their real field names', t => {
  const { db, users, grant } = fixture(t);
  grant('executive.view');
  const body = buildEpmoBody(db, users['epmo-lead'], PERIOD);
  const portfolio = measured(figuresOf(body, 'portfolio')), pipeline = measured(figuresOf(body, 'pipeline'));
  assert.ok(portfolio.length >= 4, 'portfolio: projects, running, on hold and not started are measured');
  assert.equal(portfolio[0].value, db.prepare("SELECT COUNT(*) AS n FROM projects WHERE tenant_id='36t'").get().n, 'the entity portfolio, not the reader\'s memberships');
  assert.equal(pipeline.length, 2, 'pipeline: open value and weighted forecast — open_value_minor is the merged field name');
  const open = db.prepare("SELECT COALESCE(SUM(value_minor),0) AS n FROM opportunities WHERE tenant_id='36t' AND status='open'").get().n;
  assert.equal(pipeline[0].value, open);
});
