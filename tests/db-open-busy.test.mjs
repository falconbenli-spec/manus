import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../app/db.mjs';

// فتح القاعدة ينتظر القفل ولا يسقط فورًا: app/db.mjs كان يضبط journal_mode=WAL قبل busy_timeout، فعمليةٌ تفتح القاعدة
// وأخرى تمسك قفلها (أو تستعيد فهرس سجلها بعد إغلاق آخر اتصال) تسقط بـ«database is locked» (SQLITE_BUSY_RECOVERY 261)
// بلا انتظار. التقطه سباق أمر المباشرة مرتين تحت الحمل (docs/testing/p2-delivery-cycle-20260930/suite.tap). هنا يُعاد
// إنتاجه بلا حظ: عملية ثانية تمسك قفلًا حصريًا 600 مللي، والفتح في أثنائها يجب أن ينتظر ثم ينجح.
test('opening the database waits for a lock held by another process instead of failing at once', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-open-busy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'busy.sqlite');
  openDb(path).close(); // قاعدة مرحَّلة بسجل WAL، كما يفتحها الخادم
  const holder = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path)});
    db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS busy_probe(x INTEGER); INSERT INTO busy_probe VALUES(1);');
    process.stdout.write('locked\\n');
    setTimeout(() => { db.exec('COMMIT'); db.close(); process.stdout.write('released\\n'); }, 600);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const released = new Promise(resolve => holder.on('close', resolve));
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', chunk => { if (String(chunk).includes('locked')) resolve(); });
    holder.on('error', reject);
  });
  const started = Date.now();
  let db;
  assert.doesNotThrow(() => { db = openDb(path); }, 'the open waits for the lock rather than failing with database is locked');
  const waited = Date.now() - started;
  db.close();
  await released;
  assert.ok(waited >= 200, `the open waited for the lock to clear (${waited} ms)`);
  assert.equal(openDb(path).prepare('SELECT COUNT(*) AS n FROM busy_probe').get().n, 1, 'the other process committed its write');
});
