import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

// الترحيل 124 يعيد بناء project_closures ليرفع المنع الصلب لقفلين بيد واحدة (قرار المالك، الخيار «ب»).
// إعادة بناء جدول له أبناء هي أخطر ما في الترحيلات، فيُختبر على قاعدة من قبله فيها إقفال وقيد إعادة فتح.
const STAMP = '2026-09-20T09:00:00.000Z';

function pre124(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pre124-')), path = join(dir, 'pre124.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of readdirSync(new URL('../app/migrations/', import.meta.url)).filter(f => /^\d{3}-.+\.sql$/.test(f)).sort()) {
    const version = Number(file.slice(0, 3)); if (version >= 124) continue;
    const sql = readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
    raw.exec('BEGIN'); raw.exec(sql); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); raw.exec('COMMIT');
  }
  seed(raw, 'synthetic-pre-124');
  raw.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('project-pre124','36t','مشروع تجريبي قبل الترحيل','مشروع مصطنع لاختبار الترحيل 124','manager',?)").run(STAMP);
  raw.prepare("INSERT INTO project_closures(id,tenant_id,project_id,created_at,updated_at) VALUES('closure-pre124','36t','project-pre124',?,?)").run(STAMP, STAMP);
  raw.prepare("INSERT INTO project_closure_reopenings(id,tenant_id,closure_id,scope,from_state,reason,capability,reopened_by,reopened_at) VALUES('reopen-pre124','36t','closure-pre124','technical','technical_closed','قيد إعادة فتح مصطنع سابق للترحيل 124','projects.closure.reopen','manager',?)").run(STAMP);
  const before = { closures: raw.prepare('SELECT * FROM project_closures').all(), reopenings: JSON.stringify(raw.prepare('SELECT * FROM project_closure_reopenings').all()),
    audit: raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n };
  // القيد الصلب قائم قبل الترحيل: هذا ما يرفعه.
  assert.match(raw.prepare("SELECT sql FROM sqlite_master WHERE name='project_closures'").get().sql, /technical_closed_by<>financial_closed_by\)/);
  raw.close();
  return { path, before };
}

test('migration 124: a database with a closure and a reopening upgrades in place, keeps both, and the child still points at its parent', t => {
  const { path, before } = pre124(t), db = openDb(path); t.after(() => { try { db.close(); } catch {} });
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=124').get(), '124 is applied by openDb');
  const [closure] = db.prepare('SELECT * FROM project_closures').all();
  const { same_person_reason, same_person_at, ...carried } = closure;
  assert.deepEqual(carried, { ...before.closures[0] }, 'every carried column is unchanged');
  assert.equal(same_person_reason, ''); assert.equal(same_person_at, null);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM project_closure_reopenings').all()), before.reopenings, 'the append-only child is untouched');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, before.audit, 'the migration writes no audit event of its own');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='project_closures'").get().sql, /\)\s*STRICT\s*$/);
  // الابن ما زال يحيل إلى الأب باسمه، ويقبل قيدًا جديدًا ويرفض يتيمًا.
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='project_closure_reopenings'").get().sql, /REFERENCES project_closures\(id\)/);
  const reopen = 'INSERT INTO project_closure_reopenings(id,tenant_id,closure_id,scope,from_state,reason,capability,reopened_by,reopened_at) VALUES(?,?,?,?,?,?,?,?,?)';
  db.prepare(reopen).run('reopen-after', '36t', 'closure-pre124', 'final', 'closed', 'قيد إعادة فتح مصطنع بعد الترحيل 124', 'projects.closure.reopen', 'manager', STAMP);
  assert.throws(() => db.prepare(reopen).run('reopen-orphan', '36t', 'no-such-closure', 'final', 'closed', 'قيد إعادة فتح مصطنع بلا إقفال يحيل إليه', 'projects.closure.reopen', 'manager', STAMP), /FOREIGN KEY/);
  // والمشغّلان عادا على الجدول الجديد.
  assert.throws(() => db.prepare('DELETE FROM project_closures').run(), /closure history is retained/);
  assert.throws(() => db.prepare("UPDATE project_closures SET technical_note='x' WHERE id='closure-pre124'").run(), /next version/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE name='project_closures_carry'").get().n, 0, 'the carry table is gone');
  const checksums = JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()); db.close();
  const again = openDb(path); t.after(() => { try { again.close(); } catch {} });
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()), checksums, 'a second start applies nothing');
});
