// الترحيل 183 (P4-CRM-4): بوابات الاستحقاق. عمودان يُضافان إلى جدول الدفعات وجدول ربط جديد ومُطلِقات، فلا إعادة بناء:
// يُطبَّق على قاعدة فارغة، وعلى قاعدة تجريبية عند 170 فيها صفقة بجدول دفعات قديم واستحقاق ودفعة مقدمة وقبض على الحساب
// (tests/crm-rebuild-fixture.mjs). لا يتغيّر صفٌّ قائم، ولا يُنسب لبند قديم شرطٌ لم يكتبه أحد، ولا يُربط استحقاق قديم ببند بأثر رجعي.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit, now } from '../app/db.mjs';
import * as receivables from '../app/receivables.mjs';
import { buildPre180 } from './crm-rebuild-fixture.mjs';

const TABLES = ['case_payment_terms', 'ar_claims', 'client_purchase_orders', 'advance_invoices', 'ar_account_receipts', 'tax_invoices'];
const fingerprint = (db, table) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(group_concat(id, ','), '') AS ids FROM (SELECT id FROM "${table}" ORDER BY rowid)`).get();

test('migration 183: applies on an empty database — typed condition columns, the claim-term link and the gates exist', () => {
  const db = openDb(':memory:');
  try {
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=183').get());
    for (const column of ['condition_kind', 'condition_lines'])
      assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('case_payment_terms') WHERE name=?").get(column), column);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ar_claim_terms'").get());
    for (const trigger of ['case_payment_terms_typed', 'ar_claim_terms_source', 'ar_claim_terms_no_update', 'ar_claim_terms_no_delete', 'ar_claims_term_gate', 'ar_claims_client_po_gate', 'ar_claims_gated_amount_fixed'])
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger), trigger);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { db.close(); }
});

test('migration 183: over a database with a legacy schedule, its claim, its advance and on-account money, every row stays as it was, nothing is typed or linked retroactively, and the legacy deal still reads', t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-migration-183-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre180.sqlite');
  buildPre180(path);
  const raw = new DatabaseSync(path, { readOnly: true });
  const before = Object.fromEntries(TABLES.map(table => [table, fingerprint(raw, table)]));
  raw.close();
  const db = openDb(path);
  t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=183').get());
  for (const table of TABLES) assert.deepEqual(fingerprint(db, table), before[table], `${table}: the same rows in the same order`);
  // البند القديم يبقى بلا نوع شرط: لا يُخترع له شرط لم يكتبه أحد.
  assert.deepEqual({ ...db.prepare("SELECT condition_kind,condition_lines FROM case_payment_terms WHERE id='syn-term-a1'").get() }, { condition_kind: null, condition_lines: '[]' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ar_claim_terms').get().n, 0, 'no claim is linked to a term retroactively');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(verifyAudit(db), true);
  // والصفقة القديمة تُقرأ في كشف عميلها: استحقاقها المسودة ينتظر ولا يُحسب مستحقًا، والقبض على الحساب المعلّق لا يُحسب مالًا.
  db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', 'employee', 'employee', 'read', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض قراءة تجريبي للترحيل 183', null, now());
  const statement = receivables.customerStatement(db, { id: 'employee', tenant_id: '36t' }, 'syn-client-1');
  const deal = statement.deals.find(x => x.case_id === 'syn-case-a');
  assert.deepEqual([deal.entitled_minor, deal.awaiting_minor, deal.on_account_minor], [0, 115000, 0]);
  // والجديد وحده يُحرس: بند بلا نوع شرط على الصفقة القديمة يُرفض في القاعدة.
  assert.throws(() => db.prepare("INSERT INTO case_payment_terms(id,tenant_id,case_id,position,label,amount_minor,currency,due_on,condition,is_advance,recorded_by,recorded_at) VALUES('syn-term-new','36t','syn-case-b',0,'بند تجريبي بلا شرط',115000,'SAR','2099-12-01','',0,'employee',?)").run(now()), /condition kind/);
});
