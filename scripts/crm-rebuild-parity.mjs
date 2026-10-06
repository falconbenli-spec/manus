// دليل سلامة إعادة بناء commercial_cases (الترحيل 180): لكل جدول في سلسلة الإحالة إليه — هو وكل جدول يحيل إليه بالتعدّي —
// عدد الصفوف وبصمة محتواها بترتيب rowid، قبل 180 وبعد 181، على **نسخة**. الأعمدة الجديدة لا تدخل البصمة (البصمة على
// أعمدة ما قبل الترحيل وحدها)، فأي فرق في عدد أو بصمة يعني أن صفًّا قائمًا تغيّر أو سقط.
//
// المصدر لا يُكتب أبدًا: يُفتح للقراءة وحدها ويُنسخ بـ VACUUM INTO إلى مجلد مؤقت، ثم يُرقّى المنسوخ إلى 170 بالمشغّل نفسه،
// فتُؤخذ اللقطة الأولى، ثم يُفتح بـ openDb من هذه الشجرة فيطبّق 180 و181، فتُؤخذ الثانية.
//
// الاستعمال:
//   node scripts/crm-rebuild-parity.mjs              آخر نسخة احتياطية للتشغيل (scripts/gate.mjs newestBackup)
//   node scripts/crm-rebuild-parity.mjs <مسار>       نسخة بعينها
//   node scripts/crm-rebuild-parity.mjs --synthetic  قاعدة تجريبية فيها صفوف في الجداول العشرين كلها (tests/crm-rebuild-fixture.mjs)
// يطبع JSON ويخرج بصفر حين ok.
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit } from '../app/db.mjs';
import { migrateTo, buildPre180, PRE_REBUILD_VERSION } from '../tests/crm-rebuild-fixture.mjs';

const q = name => '"' + name.replaceAll('"', '""') + '"';
export const ROOT_TABLE = 'commercial_cases';
// الفهرس والمُطلِقان اللذان يعيد 180 إنشاءهما بحرفهما.
export const ORIGINAL_OBJECTS = ['commercial_owner', 'commercial_case_identity', 'commercial_case_no_delete'];

// كل إحالة في المخطط، ثم السلسلة من الجذر بالتعدّي. on_delete لكل إحالة: هو ما يقرر أمان الإسقاط.
export function chainOf(db, root = ROOT_TABLE) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const edges = [];
  for (const child of tables) for (const fk of db.prepare(`PRAGMA foreign_key_list(${q(child)})`).all())
    edges.push({ child, parent: fk.table, from: fk.from, to: fk.to, on_delete: fk.on_delete, on_update: fk.on_update });
  const seen = new Set([root]), queue = [root], chainEdges = [];
  while (queue.length) {
    const parent = queue.shift();
    for (const e of edges.filter(x => x.parent === parent)) { chainEdges.push(e); if (!seen.has(e.child)) { seen.add(e.child); queue.push(e.child); } }
  }
  return { tables: [...seen].sort(), direct: edges.filter(e => e.parent === root), edges: chainEdges,
    unsafe: chainEdges.filter(e => !['NO ACTION', 'RESTRICT'].includes(e.on_delete)),
    schema_actions: edges.filter(e => e.on_delete !== 'NO ACTION' || e.on_update !== 'NO ACTION') };
}

const cell = value => value === null ? null : typeof value === 'bigint' ? String(value) : value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value;
// shape: الأعمدة التي تُبصم لكل جدول (أعمدة ما قبل الترحيل). بلاه تُبصم الأعمدة كلها.
export function snapshot(db, tables, shape = null) {
  const out = {};
  for (const table of tables) {
    const present = db.prepare(`PRAGMA table_info(${q(table)})`).all().map(c => c.name);
    if (!present.length) { out[table] = { missing_table: true }; continue; }
    const columns = shape?.[table] ?? present, use = columns.filter(c => present.includes(c));
    const rows = db.prepare(`SELECT ${use.map(q).join(',')} FROM ${q(table)} ORDER BY rowid`).all();
    const h = createHash('sha256');
    for (const row of rows) h.update(JSON.stringify(use.map(c => cell(row[c]))) + '\n');
    out[table] = { count: rows.length, hash: h.digest('hex').slice(0, 16), columns, missing_columns: columns.filter(c => !present.includes(c)) };
  }
  return out;
}
const objectSql = (db, names) => Object.fromEntries(names.map(name => [name, db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name)?.sql ?? null]));

// المصدر يُفتح للقراءة وحدها ويُنسخ؛ لا يُكتب فيه شيء أيًّا كان.
export function runParity({ source, label = source }) {
  const dir = mkdtempSync(join(tmpdir(), '36t-crm-rebuild-parity-'));
  try {
    const copy = join(dir, 'copy.sqlite');
    const src = new DatabaseSync(source, { readOnly: true });
    const sourceVersion = src.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    src.prepare('VACUUM INTO ?').run(copy); src.close();
    // (1) إلى 170 بالمشغّل نفسه، ثم اللقطة الأولى.
    const raw = new DatabaseSync(copy);
    migrateTo(raw, PRE_REBUILD_VERSION);
    const chain = chainOf(raw), before = snapshot(raw, chain.tables);
    const originals = objectSql(raw, ORIGINAL_OBJECTS);
    const views = raw.prepare("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").all().map(r => r.name);
    raw.close();
    // (2) openDb من هذه الشجرة: يطبّق 180 و181 وما بعدهما إن وُجد.
    const db = openDb(copy);
    const after = snapshot(db, chain.tables, Object.fromEntries(Object.entries(before).map(([t, s]) => [t, s.columns])));
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    const audit = verifyAudit(db);
    const viewErrors = views.flatMap(name => { try { db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get(); return []; } catch (error) { return [{ view: name, error: error.message }]; } });
    const recreated = objectSql(db, ORIGINAL_OBJECTS);
    const resolved = db.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE client_id IS NOT NULL').get().n;
    // الصفقات التي بقيت بلا عميل: معرّفها وكيانها وحالتها وتاريخها فقط، بلا اسم.
    const unresolved = db.prepare('SELECT id,tenant_id,status,created_at FROM commercial_cases WHERE client_id IS NULL ORDER BY tenant_id,created_at').all();
    const clientsWithNumber = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE registration_number IS NOT NULL').get().n;
    const versionAfter = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='commercial_cases'").get().sql;
    db.close();
    const rows = chain.tables.map(table => ({ table, before: before[table].count, after: after[table].count, hash_before: before[table].hash, hash_after: after[table].hash,
      same: before[table].count === after[table].count && before[table].hash === after[table].hash && !after[table].missing_columns?.length }));
    const changed = rows.filter(r => !r.same);
    const objectsSame = ORIGINAL_OBJECTS.filter(name => originals[name] !== recreated[name]);
    const result = {
      ok: !changed.length && integrity === 'ok' && fkViolations === 0 && audit && !viewErrors.length && !objectsSame.length && !chain.unsafe.length
        && !/UNIQUE\s*\(\s*tenant_id\s*,\s*registration_number\s*\)/.test(tableSql) && /UNIQUE\(id,tenant_id\)/.test(tableSql),
      source: label, source_version: sourceVersion, version_before: PRE_REBUILD_VERSION, version_after: versionAfter,
      chain: { tables: chain.tables.length, direct_children: [...new Set(chain.direct.map(e => e.child))].length, direct_edges: chain.direct.length,
        on_delete: Object.fromEntries([...new Set(chain.edges.map(e => e.on_delete))].map(a => [a, chain.edges.filter(e => e.on_delete === a).length])),
        unsafe_edges: chain.unsafe, schema_wide_actions: chain.schema_actions.map(e => `${e.child}.${e.from} -> ${e.parent} on_delete=${e.on_delete}`) },
      rows_in_chain: rows.reduce((n, r) => n + r.before, 0), tables_with_rows: rows.filter(r => r.before > 0).length, changed, table_rows: rows,
      integrity, foreign_key_violations: fkViolations, audit_chain: audit, views: views.length, view_errors: viewErrors,
      originals_recreated_exactly: !objectsSame.length, originals_differing: objectsSame,
      client_id: { resolved, unresolved: unresolved.length, unresolved_rows: unresolved, query: 'SELECT id,tenant_id,status,created_at FROM commercial_cases WHERE client_id IS NULL' },
      clients_with_registration_number: clientsWithNumber };
    return result;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  let result;
  if (arg === '--synthetic') {
    const dir = mkdtempSync(join(tmpdir(), '36t-crm-rebuild-synthetic-'));
    try { const path = join(dir, 'pre180.sqlite'); buildPre180(path); result = runParity({ source: path, label: 'synthetic pre-180 (tests/crm-rebuild-fixture.mjs)' }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  } else {
    let path = arg;
    if (!path) {
      const gate = await import(join(dirname(fileURLToPath(import.meta.url)), 'gate.mjs'));
      const backup = gate.newestBackup();
      if (!backup) { console.log(JSON.stringify({ ok: false, reason: 'no backup found' })); process.exit(1); }
      path = backup.path;
    }
    result = runParity({ source: path, label: path.replace(/^.*\/work\//, 'work/') });
  }
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
