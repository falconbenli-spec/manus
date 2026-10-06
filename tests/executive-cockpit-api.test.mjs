import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { login } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';

const password = 'synthetic-executive-cockpit-api';

function callFactory(db) {
  const handler = createApp(db).listeners('request')[0];
  return async function call(path, token) {
    const req = {
      url: path,
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3600', ...(token ? { cookie: `session=${token}` } : {}) },
      async *[Symbol.asyncIterator]() {}
    };
    const res = {
      writeHead(status) { this.status = status; },
      end(value) { this.body = value ? JSON.parse(value) : null; }
    };
    await handler(req, res);
    return res;
  };
}

test('executive routes parse their range and keep named details behind source access', async t => {
  const db = openDb(':memory:');
  seed(db, password);
  t.after(() => db.close());
  const admin = db.prepare("SELECT * FROM users WHERE id='admin'").get();
  db.prepare(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,admin_level)
    SELECT 'limited-admin','36t','ops','limited-admin','أدمن محدود',password_hash,'admin',NULL,'scoped'
    FROM users WHERE id='admin'`).run();
  transaction(db, () => grantAccess(db, admin, {
    user_id: 'employee',
    capability: 'executive.view',
    note: 'منح مصطنع لاختبار مسار المقصورة التنفيذي'
  }));
  const executive = login(db, 'employee', password, 'executive-api');
  const outsider = login(db, 'outsider', password, 'executive-api-denied');
  const limitedAdmin = login(db, 'limited-admin', password, 'executive-api-limited-admin');
  const call = callFactory(db);

  assert.equal((await call('/api/executive', outsider.token)).status, 403);
  assert.equal((await call('/api/executive', limitedAdmin.token)).status, 403);
  const board = await call('/api/executive?from=2026-10-01&to=2026-10-31', executive.token);
  assert.equal(board.status, 200);
  assert.deepEqual(board.body.period, { from: '2026-10-01', to: '2026-10-31' });

  const detail = await call('/api/executive/drilldown/people.headcount?from=2026-10-01&to=2026-10-31', executive.token);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.details_withheld, true);
  assert.deepEqual(detail.body.rows, []);
  assert.equal((await call('/api/executive/drilldown/not.real', executive.token)).status, 404);
  assert.equal((await call('/api/executive?from=bad&to=2026-10-31', executive.token)).status, 400);
  assert.equal((await call('/api/executive?from=2025-01-01&to=2026-10-31', executive.token)).status, 400);
});
