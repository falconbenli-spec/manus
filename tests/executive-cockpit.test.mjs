import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { executiveCockpit, executiveDrilldown } from '../app/executive-cockpit.mjs';
import { executiveOverview } from '../app/workspace.mjs';

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-executive-cockpit-only');
  t.after(() => db.close());
  return { db, chief: db.prepare("SELECT * FROM users WHERE id='admin'").get() };
}

const range = { from: '2026-10-01', to: '2026-10-31' };

test('a missing cash source is unavailable, never zero', t => {
  const { db, chief } = fixture(t);
  db.prepare("DELETE FROM ar_claims WHERE tenant_id='36t'").run();
  const board = executiveCockpit(db, chief, range);
  const cash = board.dimensions.find(dimension => dimension.key === 'cash')
    .metrics.find(metric => metric.key === 'cash.overdue');
  assert.equal(cash.status, 'unavailable');
  assert.equal(cash.value, null);
  assert.match(cash.note, /لا توجد عينة|غير مهيأ/);
});

test('the cockpit has six aggregate dimensions and keeps the legacy board contract', t => {
  const { db, chief } = fixture(t);
  const board = executiveCockpit(db, chief, range);
  assert.deepEqual(board.dimensions.map(dimension => dimension.key), [
    'cash', 'growth', 'delivery', 'people', 'risk', 'quality'
  ]);
  assert.equal(board.dimensions.find(dimension => dimension.key === 'people').metrics[0].value, 5);
  assert.ok(board.dimensions.every(dimension => ['good', 'attention', 'critical', 'unknown'].includes(dimension.state)));
  assert.equal(board.attention.length <= 5, true);
  assert.doesNotMatch(JSON.stringify(board), /الموظفة التجريبية|مدير الفريق التجريبي/);

  const compatible = executiveOverview(db, chief);
  for (const key of ['totals', 'by_status', 'departments', 'portfolio', 'dimensions', 'summary']) {
    assert.ok(key in compatible, `${key} remains available during migration`);
  }
});

test('named drilldown stays behind the source capability while the aggregate remains visible', t => {
  const { db, chief: admin } = fixture(t);
  db.prepare(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id)
    VALUES('chief-metrics','36t','ops','chief-metrics','قائد تجريبي','unused-test-hash','manager',NULL)`).run();
  const chief = db.prepare("SELECT * FROM users WHERE id='chief-metrics'").get();
  transaction(db, () => grantAccess(db, admin, {
    user_id: chief.id,
    capability: 'executive.view',
    note: 'منح مصطنع لاختبار فصل التجميع عن التفاصيل'
  }));
  const peopleOfficer = db.prepare("SELECT * FROM users WHERE id='hr'").get();
  transaction(db, () => grantAccess(db, admin, {
    user_id: peopleOfficer.id,
    capability: 'executive.view',
    note: 'منح مصطنع لاختبار تفصيل يمر بتصريح المصدر'
  }));

  const withheld = executiveDrilldown(db, chief, 'people.headcount', range);
  assert.equal(withheld.metric.value, 6);
  assert.equal(withheld.details_withheld, true);
  assert.deepEqual(withheld.rows, []);
  assert.doesNotMatch(JSON.stringify(withheld), /الموظفة التجريبية|مدير الفريق التجريبي/);

  const permitted = executiveDrilldown(db, peopleOfficer, 'people.headcount', range);
  assert.equal(permitted.details_withheld, false);
  assert.equal(permitted.rows.length, 6);
  assert.ok(permitted.rows.every(row => typeof row.name === 'string'));
  assert.throws(() => executiveDrilldown(db, chief, 'made.up', range), error => error.status === 404 && error.code === 'metric_not_found');
});
