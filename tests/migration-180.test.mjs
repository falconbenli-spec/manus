// الترحيل 180 (P4-CRM-1، القرار D1): العميل غير الصفقة، وإعادة بناء commercial_cases دون أن يسقط صفّ أو يتغيّر.
// القاعدة تجريبية عند 170 فيها صفوف في الجداول التسعة عشر التي تحيل إلى commercial_cases (tests/crm-rebuild-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit } from '../app/db.mjs';
import { buildPre180 } from './crm-rebuild-fixture.mjs';
import { runParity, chainOf } from '../scripts/crm-rebuild-parity.mjs';

function built(t) {
  const dir = mkdtempSync(join(tmpdir(), '36t-migration-180-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre180.sqlite');
  buildPre180(path);
  return path;
}

test('migration 180: every one of the nineteen tables that reference commercial_cases keeps every row and every value — counts and content hashes by rowid identical, integrity ok, no foreign-key violation, audit chain intact', t => {
  const path = built(t);
  const raw = new DatabaseSync(path, { readOnly: true });
  const chain = chainOf(raw);
  const direct = [...new Set(chain.direct.map(e => e.child))];
  assert.equal(direct.length, 19, 'nineteen child tables (nineteen foreign keys, one of them composite) reference commercial_cases at 170');
  for (const table of direct) assert.ok(raw.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n > 0, `${table}: the synthetic database has a row in every child table`);
  assert.deepEqual(chain.unsafe, [], 'no child in the chain cascades or nulls on delete');
  raw.close();
  const result = runParity({ source: path, label: 'synthetic' });
  assert.deepEqual(result.changed, [], JSON.stringify(result.changed));
  assert.equal(result.integrity, 'ok');
  assert.equal(result.foreign_key_violations, 0);
  assert.equal(result.audit_chain, true);
  assert.equal(result.originals_recreated_exactly, true, JSON.stringify(result.originals_differing));
  assert.deepEqual(result.view_errors, []);
  assert.ok(result.version_after >= 180);
  assert.equal(result.ok, true);
});

test('migration 180: client_id comes from the explicit client link only, the registration number moves to the client when its linked deals agree on one, and unresolvable deals stay NULL', t => {
  const path = built(t);
  const before = new DatabaseSync(path, { readOnly: true });
  const rowids = Object.fromEntries(before.prepare('SELECT id,rowid FROM commercial_cases').all().map(r => [r.id, r.rowid]));
  before.close();
  const db = openDb(path); t.after(() => db.close());
  const cases = Object.fromEntries(db.prepare('SELECT id,rowid,client_id FROM commercial_cases').all().map(r => [r.id, r]));
  assert.deepEqual(Object.fromEntries(Object.entries(cases).map(([id, r]) => [id, r.client_id])),
    { 'syn-case-a': 'syn-client-1', 'syn-case-b': 'syn-client-2', 'syn-case-c': 'syn-client-2', 'syn-case-d': null, 'syn-case-e': null });
  for (const [id, rowid] of Object.entries(rowids)) assert.equal(cases[id].rowid, rowid, `${id}: rowid preserved`);
  const numbers = Object.fromEntries(db.prepare('SELECT id,registration_number FROM clients').all().map(r => [r.id, r.registration_number]));
  assert.equal(numbers['syn-client-1'], 'SYN-7180-A', 'one linked deal → its number moves to the client');
  assert.equal(numbers['syn-client-2'], null, 'two linked deals with two numbers → the client stays without one');
  assert.deepEqual(db.prepare('SELECT id FROM commercial_cases WHERE client_id IS NULL ORDER BY id').all().map(r => r.id), ['syn-case-d', 'syn-case-e']);
  assert.equal(verifyAudit(db), true);
});

test('migration 180: the registration number is no longer unique per deal, every other constraint stands, and the new links are guarded in the database', t => {
  const path = built(t);
  const db = openDb(path); t.after(() => db.close());
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='commercial_cases'").get().sql;
  assert.doesNotMatch(sql, /UNIQUE\s*\(\s*tenant_id\s*,\s*registration_number\s*\)/);
  assert.match(sql, /UNIQUE\(id,tenant_id\)/);
  const insert = (id, extra = {}) => {
    const row = { id, tenant_id: '36t', department_id: 'creative', owner_id: 'employee', name: 'صفقة تجريبية ثانية', registration_number: 'SYN-7180-A', contact: 'جهة تجريبية', source: 'اختبار', sector: 'تجريبي', status: 'lead', created_at: '2026-09-21T00:00:00.000Z', updated_at: '2026-09-21T00:00:00.000Z', client_id: 'syn-client-1', ...extra };
    const keys = Object.keys(row);
    return db.prepare(`INSERT INTO commercial_cases(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
  };
  // صفقة ثانية لنفس العميل برقم سجله نفسه: كانت مستحيلة.
  insert('syn-second-deal', { predecessor_case_id: 'syn-case-a' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commercial_cases WHERE registration_number='SYN-7180-A' AND tenant_id='36t'").get().n, 2);
  assert.throws(() => insert('syn-bad-status', { status: 'won' }), /CHECK constraint/);
  assert.throws(() => insert('syn-lost-no-reason', { status: 'lost' }), /CHECK constraint/, 'lost needs its reason, closer and comment');
  assert.throws(() => insert('syn-cross-tenant', { client_id: 'syn-client-1', tenant_id: 'isolated', department_id: 'other', owner_id: 'external' }), /FOREIGN KEY|customer/, 'a deal cannot point at a client of another tenant');
  assert.throws(() => insert('syn-cross-predecessor', { client_id: 'syn-client-2', predecessor_case_id: 'syn-case-a' }), /customer/, 'the predecessor belongs to the same customer');
  assert.throws(() => insert('syn-self-predecessor', { predecessor_case_id: 'syn-self-predecessor' }), /CHECK constraint|customer/);
  // الهوية كما كانت، والعميل يُكتب مرة.
  assert.throws(() => db.prepare("UPDATE commercial_cases SET name='اسم آخر',version=version+1 WHERE id='syn-case-a'").run(), /commercial identity is fixed/);
  assert.throws(() => db.prepare("UPDATE commercial_cases SET client_id='syn-client-2',version=version+1 WHERE id='syn-case-a'").run(), /keeps its customer/);
  db.prepare("UPDATE commercial_cases SET client_id='syn-client-1',version=version+1 WHERE id='syn-case-d'").run();
  assert.throws(() => db.prepare("INSERT INTO client_links VALUES('syn-client-2','syn-second-deal','employee','2026-09-21T00:00:00.000Z')").run(), /its own customer/);
  // الخسارة نهائية، والمتعاقد عليها لا تُخسر.
  const reason = 'syn-reason';
  db.prepare("INSERT INTO pipeline_loss_reasons(id,tenant_id,code,name,created_by,created_at,updated_at) VALUES(?, '36t','PRICE','سبب تجريبي','manager','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z')").run(reason);
  const lose = id => db.prepare("UPDATE commercial_cases SET status='lost',closed_reason_id=?,closed_comment='خسارة تجريبية بسبب السعر',closed_at='2026-09-21T00:00:00.000Z',closed_by='employee',version=version+1 WHERE id=?").run(reason, id);
  assert.throws(() => lose('syn-case-a'), /contracted deal is not lost/);
  lose('syn-case-c');
  assert.throws(() => db.prepare("UPDATE commercial_cases SET status='lead',version=version+1 WHERE id='syn-case-c'").run(), /final/);
  assert.throws(() => db.prepare("DELETE FROM commercial_cases WHERE id='syn-case-c'").run(), /immutable/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration 180: the proof is not blind — a child that cascades on delete is flagged before the rebuild and its lost row is counted after it', t => {
  const path = built(t);
  // جدول مختلَق لهذا الاختبار وحده: يحيل إلى commercial_cases بـ ON DELETE CASCADE. لا جدول في المخطط الحقيقي يفعل ذلك.
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys=ON; CREATE TABLE syn_cascade_child(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES commercial_cases(id) ON DELETE CASCADE) STRICT; INSERT INTO syn_cascade_child VALUES('syn-child','syn-case-a');");
  assert.equal(chainOf(raw).unsafe.length, 1, 'the inventory names the cascading child before anything is dropped');
  raw.close();
  const result = runParity({ source: path, label: 'synthetic with a cascading child' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.chain.unsafe_edges.map(e => `${e.child}.${e.from}:${e.on_delete}`), ['syn_cascade_child.case_id:CASCADE']);
  assert.deepEqual(result.changed.map(r => [r.table, r.before, r.after]), [['syn_cascade_child', 1, 0]], 'DROP TABLE fires the cascade even with defer_foreign_keys, and the parity counts it');
});
