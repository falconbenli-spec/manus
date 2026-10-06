// الحزمة 3 — مرة واحدة فقط تحت سباق عمليتين على ملف قاعدة واحد: قيد سطر الكشف المصنّف لا يُعدّ مرتين، وفتح الإقفال لا يقع مرتين.
// كل عامل عملية مستقلة باتصالها (tests/bank-close-worker.mjs)، تبدأ في اللحظة نفسها، فيتنافسان على قفل الكاتب فعلًا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, verifyAudit } from '../app/db.mjs';
import { getClosePeriod } from '../app/close-checklist.mjs';
import { bankLedger } from './bank-close-fixture.mjs';
import { reopenFixture } from './close-reopen-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/bank-close-worker.mjs');
function race(path, jobs) {
  const startAt = Date.now() + 2500;
  return Promise.all(jobs.map((args, index) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, ...args, String(startAt)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output' }); } });
  })));
}
// القاعدة تُبنى بالذاكرة ثم تُنسخ ملفًا، وتُفتح مرة قبل السباق فتتحول إلى WAL كما تفتح المنصة ملفها.
function toFile(t, db) {
  const dir = mkdtempSync(join(tmpdir(), '36t-bank-close-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  openDb(path).close();
  return path;
}

test('two processes preparing the journal of one classified bank line at the same instant leave one journal and one named refusal', { timeout: 60000 }, async t => {
  const b = bankLedger(t);
  b.load(['2026-08-05,رسوم خدمات بنكية,FEE-08,25.00,'], { opening: '10000.00', closing: '9975.00' });
  const fee = b.classify('رسوم', 'bank_fee');
  const path = toFile(t, b.db);
  const results = await race(path, [0, 1].map(() => ['journal', 'bank_line', fee.id, b.period.id, 'employee']));
  assert.equal(results.filter(r => r.ok).length, 1, 'exactly one process prepared the journal: ' + JSON.stringify(results));
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.error), ['duplicate_source'], 'the other was refused by name, not by a raw database error: ' + JSON.stringify(results));
  const file = openDb(path); t.after(() => file.close());
  assert.equal(file.prepare("SELECT COUNT(*) n FROM finance_source_links WHERE source_kind='bank_line' AND source_id=?").get(fee.id).n, 1);
  assert.equal(file.prepare("SELECT COUNT(*) n FROM finance_journals WHERE source_id=?").get(`bank_line:${fee.id}`).n, 1);
  assert.ok(verifyAudit(file));
});

test('two third persons approving one reopening at the same instant open the ledger once: one decision, one refusal, one version step', { timeout: 60000 }, async t => {
  const x = reopenFixture(t);
  x.approveClose(); x.requestReopen(); x.adopt(5);
  const closedVersion = x.fp().version, version = x.view('third').version;
  const path = toFile(t, x.db);
  const results = await race(path, [['approve_reopen', x.period.id, String(version), '-', 'third'], ['approve_reopen', x.period.id, String(version), '-', 'fourth']]);
  assert.equal(results.filter(r => r.ok).length, 1, 'exactly one decision landed: ' + JSON.stringify(results));
  const [loser] = results.filter(r => !r.ok);
  assert.ok(['stale_version', 'invalid_state'].includes(loser.error), 'the other was refused by name: ' + JSON.stringify(results));
  const file = openDb(path); t.after(() => file.close());
  const period = file.prepare('SELECT * FROM finance_periods WHERE id=?').get(x.financePeriod.id);
  assert.deepEqual([period.status, period.version], ['open', closedVersion + 1], 'the period opened once');
  assert.deepEqual(file.prepare('SELECT status FROM finance_period_reopenings WHERE period_id=?').all(x.financePeriod.id).map(r => r.status), ['approved']);
  assert.equal(file.prepare("SELECT COUNT(*) n FROM close_reopenings WHERE status='approved'").get().n, 1);
  assert.equal(getClosePeriod(file, file.prepare("SELECT * FROM users WHERE id='reviewer'").get(), x.period.id).reopen_count, 1);
  assert.ok(verifyAudit(file));
});
