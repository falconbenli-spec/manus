import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { listMetricDefinitions, metricDefinition, metricValue } from '../app/executive-metrics.mjs';

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-executive-metrics-only');
  t.after(() => db.close());
  return db;
}

test('metric definitions are versioned and cannot be rewritten after use', t => {
  const db = fixture(t);
  const definitions = db.prepare("SELECT * FROM executive_metric_definitions WHERE tenant_id='36t' ORDER BY key").all();
  assert.equal(definitions.length, 6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM executive_metric_definitions WHERE tenant_id='isolated'").get().n, 6);

  const row = definitions.find(definition => definition.key === 'cash.overdue');
  assert.equal(row.source_module, 'receivables');
  db.prepare(`INSERT INTO executive_metric_observations
    (id,tenant_id,metric_key,definition_version,status,observed_at,payload)
    VALUES('o1','36t',?,?,'actual',?,'{}')`).run(row.key, row.version, new Date().toISOString());

  assert.throws(() => db.prepare(`UPDATE executive_metric_definitions
    SET formula=? WHERE tenant_id=? AND key=? AND version=?`).run('changed', '36t', row.key, row.version), /definition.*used|metric definition/i);
  assert.throws(() => db.prepare("UPDATE executive_metric_observations SET payload='{}' WHERE id='o1'").run(), /append.only|observation/i);
  assert.throws(() => db.prepare("DELETE FROM executive_metric_observations WHERE id='o1'").run(), /append.only|observation/i);
});

test('the metric contract carries its source and refuses incomplete or invented values', t => {
  const db = fixture(t);
  const definition = metricDefinition(db, '36t', 'cash.overdue');
  assert.equal(definition.version, 1);
  assert.deepEqual(listMetricDefinitions(db, '36t').map(row => row.key), [
    'cash.overdue',
    'delivery.blocked',
    'growth.weighted_pipeline',
    'people.headcount',
    'quality.unavailable',
    'risk.red'
  ]);

  const unavailable = metricValue(definition, {
    value: 999,
    period: { from: '2026-10-01', to: '2026-10-31' },
    scope: 'tenant',
    status: 'unavailable',
    as_of: '2026-10-02T08:00:00.000Z',
    note: 'لا توجد عينة قابلة للقياس'
  });
  assert.deepEqual(unavailable, {
    key: 'cash.overdue',
    label: 'المبالغ المتأخرة',
    value: null,
    unit: 'minor_currency',
    period: { from: '2026-10-01', to: '2026-10-31' },
    scope: 'tenant',
    status: 'unavailable',
    source_module: 'receivables',
    source_link: '#receivables',
    definition_version: 1,
    as_of: '2026-10-02T08:00:00.000Z',
    sample_size: 0,
    quality_state: 'unavailable',
    owner: 'المدير المالي',
    note: 'لا توجد عينة قابلة للقياس'
  });

  assert.throws(() => metricValue(definition, {
    value: 1,
    scope: 'tenant',
    status: 'actual',
    as_of: '2026-10-02T08:00:00.000Z'
  }), error => error.status === 500 && error.code === 'metric_metadata');
  assert.throws(() => metricValue(definition, {
    value: 1,
    period: { from: '2026-10-01', to: '2026-10-31' },
    scope: 'tenant',
    status: 'estimated',
    as_of: '2026-10-02T08:00:00.000Z'
  }), error => error.status === 500 && error.code === 'metric_status');
});
