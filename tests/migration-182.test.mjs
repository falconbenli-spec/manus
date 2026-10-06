// الترحيل 182 (P4-CRM-3، القرار D2): عرض الصفقة المعتمد وسلطة الهامش. جداول ربط جديدة وأعمدة تُضاف، فلا إعادة بناء:
// يُطبَّق على قاعدة فارغة، وعلى قاعدة تجريبية عند 170 فيها صفقة متعاقد عليها بمشروعها واستحقاقها (tests/crm-rebuild-fixture.mjs)،
// فلا يتغيّر صفٌّ قائم ولا يُنسب لاتفاق قديم عرض سعر لم يربطه أحد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit } from '../app/db.mjs';
import { buildPre180 } from './crm-rebuild-fixture.mjs';

const TABLES = ['commercial_cases', 'commercial_quotes', 'commercial_contracts', 'commercial_reviews', 'contract_records', 'ar_claims', 'billing_schedules'];
const fingerprint = (db, table) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(group_concat(id, ','), '') AS ids FROM (SELECT id FROM "${table}" ORDER BY rowid)`).get();

test('migration 182: applies on an empty database — the two binding tables, the register link and the guards exist', () => {
  const db = openDb(':memory:');
  try {
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=182').get());
    for (const table of ['commercial_quote_proposals', 'commercial_contract_proposals'])
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('contract_records') WHERE name='commercial_contract_id'").get());
    for (const trigger of ['commercial_quote_proposals_bound', 'commercial_contract_proposals_bound', 'commercial_cases_contract_bound', 'contract_records_commercial_link',
      'ar_claims_contract_terminated', 'commercial_deliveries_contract_terminated', 'commercial_changes_contract_terminated', 'billing_schedules_contract_terminated', 'commercial_reviews_delivery_approver'])
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger), trigger);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('migration 182: over a database with a contracted deal, its project and its claim, every row stays as it was, nothing is bound retroactively, foreign keys and the audit chain hold', t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-migration-182-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre180.sqlite');
  buildPre180(path);
  const raw = new DatabaseSync(path, { readOnly: true });
  const before = Object.fromEntries(TABLES.map(table => [table, fingerprint(raw, table)]));
  raw.close();
  const db = openDb(path);
  t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=182').get());
  for (const table of TABLES) assert.deepEqual(fingerprint(db, table), before[table], `${table}: the same rows in the same order`);
  // لا ربط بأثر رجعي: الاتفاق القائم يبقى بلا عرض سعر، ويُقرأ كذلك.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_quote_proposals').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_contract_proposals').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM commercial_cases WHERE id='syn-case-a'").get().status, 'project_active', 'an existing contracted deal keeps its status');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contract_records WHERE commercial_contract_id IS NOT NULL').get().n, 0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(verifyAudit(db), true);
  // والحارس يحكم الجديد وحده: صفقة قائمة بلا ربط لا تصير «متعاقدًا عليها» من جديد بكتابة مباشرة.
  assert.throws(() => db.prepare("UPDATE commercial_cases SET status='contracted',version=version+1 WHERE id='syn-case-b'").run(), /accepted FRM-024/);
});
