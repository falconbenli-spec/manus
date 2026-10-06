// الحزمة 3 — مسارات المطابقة المجمّعة وتفسير فرق الإقفال عبر الموجّه الحقيقي (app/server.mjs)، بلا منفذ: الطلب يُرسل إلى معالج
// الخادم داخل العملية (dispatch في tests/definitions-fixture.mjs)، لأن الصندوق يرفض الاستماع على منفذ محلي (listen EPERM).
// الجلسة والرمز المضاد للتزوير والصلاحية والرفض المسمّى كلها من الخادم نفسه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grantAccess } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { bankLedger } from './bank-close-fixture.mjs';

const PASSWORD = 'synthetic-bank-close-http';
async function sessions(app, names) {
  const out = {};
  for (const username of names) {
    const response = await dispatch(app, { method: 'POST', path: '/api/login', body: { username, password: PASSWORD } });
    assert.equal(response.status, 200, `login ${username}: ${response.text.slice(0, 200)}`);
    out[username] = { cookie: response.headers['Set-Cookie'].split(';')[0], csrf: response.json().csrf };
  }
  return (who, path, input) => dispatch(app, { method: input === undefined ? 'GET' : 'POST', path: '/api' + path, headers: { cookie: out[who].cookie, 'x-csrf-token': out[who].csrf, 'idempotency-key': randomUUID() }, body: input });
}

test('HTTP: a grouped match is proposed by one account and approved by another through the router, and an unbalanced one comes back as a named refusal', async t => {
  const b = bankLedger(t, { seedName: PASSWORD });
  const a = b.custody('CUST-A', 100000, '2026-08-10'), c = b.custody('CUST-B', 50000, '2026-08-10');
  b.load(['2026-08-10,صرف عهدتين مجمعتين,CUST-AB,1500.00,'], { opening: '10000.00', closing: '8500.00' });
  const call = await sessions(createApp(b.db), ['employee', 'manager']);
  const board = await call('employee', '/bank-reconciliation');
  assert.equal(board.status, 200);
  const line = board.json().transactions[0];
  assert.ok(line.actions.includes('group_match'));
  const unbalanced = await call('employee', '/bank-reconciliation/matches', { transaction_id: line.id, kind: 'record', members: [{ source_kind: 'custody_issue', source_id: a }], unmatched_reason: null, rationale: 'محاولة مطابقة جزء من سطر مجمّع' });
  assert.equal(unbalanced.status, 409);
  assert.equal(unbalanced.json().error.code, 'amount_mismatch');
  assert.ok(unbalanced.json().error.details.refusal.missing[0].owner, 'the refusal travels with its owner');
  const proposed = await call('employee', '/bank-reconciliation/matches', { transaction_id: line.id, kind: 'record', members: [{ source_kind: 'custody_issue', source_id: a }, { source_kind: 'custody_issue', source_id: c }], unmatched_reason: null, rationale: 'تحويل واحد صرف عهدتين معًا' });
  assert.equal(proposed.status, 201, proposed.text.slice(0, 300));
  const id = proposed.json().id;
  const self = await call('employee', `/bank-reconciliation/matches/${id}/approve`, { version: 1, note: 'أعتمد ما أعددته' });
  assert.equal(self.status, 403);
  const approved = await call('manager', `/bank-reconciliation/matches/${id}/approve`, { version: 1, note: 'راجعت سندي العهدتين' });
  assert.equal(approved.status, 201, approved.text.slice(0, 300));
  assert.equal((await call('manager', '/bank-reconciliation')).json().transactions[0].match.shape, 'group');
});

test('HTTP: a control difference is explained on the close through its route, and the route refuses an unknown item by name', async t => {
  const b = bankLedger(t, { seedName: PASSWORD, map: ['receivable'] });
  for (const who of ['employee', 'manager', 'outsider']) b.tx(() => grantAccess(b.db, b.users.admin, { user_id: who, capability: 'finance.close.manage', note: 'تصريح إقفال مصطنع' }));
  b.journal('2026-08-15', [[b.accounts.receivable, '40.00'], [b.accounts.equity, 0, '40.00']], 'AR-OPENING');
  const call = await sessions(createApp(b.db), ['employee', 'manager']);
  const opened = await call('employee', '/close-checklist/periods', { period_key: '2026-08', finance_period_id: null });
  assert.equal(opened.status, 201, opened.text.slice(0, 300));
  const period = (await call('manager', `/close-checklist/periods/${opened.json().id}`)).json();
  const controls = period.checks.checks.find(x => x.key === 'controls');
  assert.equal(controls.passed, false);
  const unknown = await call('manager', `/close-checklist/periods/${period.id}/explain_exception`, { version: period.version, item_key: 'controls:receivable:none', note: 'تفسير لبند غير موجود في هذا الإقفال' });
  assert.deepEqual([unknown.status, unknown.json().error.code], [404, 'exception_not_found']);
  const explained = await call('manager', `/close-checklist/periods/${period.id}/explain_exception`, { version: period.version, item_key: controls.items[0].key, note: 'قيد رصيد افتتاحي لذمم العملاء نُقل من الدفاتر السابقة' });
  assert.equal(explained.status, 201, explained.text.slice(0, 300));
  assert.equal(explained.json().checks.checks.find(x => x.key === 'controls').passed, true);
  assert.ok(b.db.prepare("SELECT 1 FROM audit_events WHERE action='close.explain_exception' AND entity_id=?").get(period.id), 'the explanation is on the audit chain');
});
