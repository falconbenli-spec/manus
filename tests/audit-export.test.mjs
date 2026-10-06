// الحزمة 3 — حزمة تدقيق الفترة (app/audit-export.mjs): قيود الفترة بسطورها وقراراتها وترحيلها، ومستنداتها المصدر ومن أعدّها واعتمدها،
// وتسوياتها وعكوسها، ومطابقاتها البنكية، وقطعة سلسلة التدقيق التي تغطيها — ملفٌ يُنزَّل ويُعاد استيراده فتُفحص سلسلته وبصمته بلا
// المنصة. ما لا يخص سجلات الحزمة من أحداث الكيان أو غيره يبقى في السلسلة بصمةً بلا محتوى، فلا تتسرب بيانات موارد بشرية
// أو كيانٍ آخر في حزمة مالية، وتبقى السلسلة متصلة. التصدير لحامل القراءة المالية وتصريح التدقيق معًا، ومسجَّل في السجل نفسه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyAudit, audit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { exportAuditPackage, verifyAuditPackage, AUDIT_FORMAT } from '../app/audit-export.mjs';
import { createApp } from '../app/server.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';
import { dispatch } from './definitions-fixture.mjs';

const code = value => error => error.code === value;
const roundTrip = pkg => JSON.parse(JSON.stringify(pkg));

function world(t) {
  const w = visibilityWorld(t), { db, users, tx } = w;
  tx(() => grantAccess(db, users.admin, { user_id: 'outsider', capability: 'finance.audit.export', note: 'تصريح تدقيق مصطنع للاختبار' }));
  const a = w.matchedPayable({ gross: '1150.00' });
  w.inputTax(a.invoice.id, '150.00');
  w.post(w.journal('supplier_invoice', a.payable.id));
  const order = w.pay(a.payable.id);
  // حدثٌ في كيانٍ آخر وحدثُ موارد بشرية في الكيان نفسه، وسط أحداث الفترة: يبقيان في السلسلة ولا يظهر محتواهما في الحزمة.
  tx(() => audit(db, db.prepare("SELECT * FROM users WHERE id='external'").get(), 'isolated_probe', 'probe-1', 'probe.written', {}, { secret: 'محتوى كيان آخر لا يخرج' }));
  tx(() => audit(db, users.hr, 'leave_request', 'leave-1', 'leave.requested', {}, { days: 3, note: 'إجازة موظف مصطنعة' }));
  const paid = w.post(w.journal('supplier_payment', order.id));
  const k = w.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const receipt = w.receipt(k.claims[0], '115.00', 'AUD-R1');
  w.post(w.journal('tax_invoice', k.invoices[0].id));
  w.post(w.journal('ar_receipt', receipt.id));
  const reversed = w.reverse(paid);
  return { ...w, a, order, paid, k, receipt, reversed };
}

test('audit export: a period package carries its journals, documents, approvals, settlements, reversals and the audit chain segment, and verifies after a round trip through a file', t => {
  const w = world(t), { db, users, tx } = w;
  const range = { from: `${w.month}-01`, to: w.day };
  const pkg = roundTrip(tx(() => exportAuditPackage(db, users.outsider, range)));
  assert.equal(pkg.format, AUDIT_FORMAT);
  assert.deepEqual([pkg.scope.tenant_id, pkg.scope.from, pkg.scope.to], ['36t', range.from, range.to]);
  // القيود: الأربعة المرحّلة وقيد العكس، كلٌّ بسطوره المتوازنة وقراره وترحيله.
  const journal = id => pkg.journals.find(j => j.id === id);
  assert.ok(journal(w.paid.id) && journal(w.reversed.id), 'the payment journal and its reversal are both in the package');
  assert.ok(pkg.journals.every(j => j.lines.reduce((n, l) => n + l.debit_minor - l.credit_minor, 0) === 0), 'every journal balances to the halala');
  assert.ok(journal(w.paid.id).decisions.some(d => d.decision === 'approved') && journal(w.paid.id).posting, 'who approved it and who posted it');
  assert.equal(journal(w.reversed.id).reverses, w.paid.id, 'the reversal names the journal it reverses');
  // المستندات: كلٌّ باعتماداته وقيده وتسوياته.
  const doc = (kind, id) => pkg.documents.find(d => d.kind === kind && d.id === id);
  assert.ok(doc('supplier_invoice', w.a.payable.id).approvals.length >= 3, 'order approval, invoice record, three-way match and tax verification');
  assert.ok(doc('supplier_invoice', w.a.payable.id).settlements.some(s => s.kind === 'supplier_payment' && s.id === w.order.id), 'the invoice names the payment that settled it');
  assert.ok(doc('supplier_payment', w.order.id).journal_ids.includes(w.paid.id));
  assert.ok(doc('ar_receipt', w.receipt.id), 'the receipt is a source document of the period');
  assert.ok(pkg.reversals.some(r => r.original_journal_id === w.paid.id && r.reversal_journal_id === w.reversed.id));
  // السلسلة: القطعة التي تغطي الفترة، وأحداث السجلات المصدّرة بمحتواها.
  assert.ok(pkg.chain.events.some(e => e.full && e.entity_id === w.paid.id), 'the audit events of an exported journal are carried in full');
  const result = verifyAuditPackage(pkg);
  assert.deepEqual([result.ok, result.problems], [true, []], 'the chain and the digest verify with nothing but the file');
  assert.ok(result.checked.events > 0 && result.checked.journals === pkg.journals.length);
});

test('audit export: a changed amount, an edited event or a removed event is caught on re-import', t => {
  const w = world(t), { db, users, tx } = w;
  const pkg = roundTrip(tx(() => exportAuditPackage(db, users.outsider, { from: `${w.month}-01`, to: w.day })));
  const amount = roundTrip(pkg);
  amount.journals[0].lines[0].debit_minor += 100;
  assert.ok(verifyAuditPackage(amount).problems.some(p => p.includes('digest')), 'any edit to the body breaks the package digest');
  const edited = roundTrip(pkg), target = edited.chain.events.find(e => e.full);
  target.after_json = JSON.stringify({ tampered: true });
  const resealed = verifyAuditPackage(edited, { reseal: true });
  assert.equal(resealed.ok, false);
  assert.ok(resealed.problems.some(p => p.includes(`seq ${target.seq}`)), 'an edited event no longer hashes to itself, even when the digest is resealed');
  const removed = roundTrip(pkg), gap = removed.chain.events.findIndex((e, i) => i > 0 && i < removed.chain.events.length - 1);
  removed.chain.events.splice(gap, 1);
  assert.equal(verifyAuditPackage(removed, { reseal: true }).ok, false, 'a missing link breaks the chain');
});

test('audit export: only a finance reader who also holds the audit capability exports; another tenant\'s events appear as hashes only; the export itself is audited', t => {
  const w = world(t), { db, users, tx } = w;
  const range = { from: `${w.month}-01`, to: w.day };
  assert.throws(() => tx(() => exportAuditPackage(db, users.manager, range)), code('audit_export_denied'), 'finance approval is not audit export');
  assert.throws(() => tx(() => exportAuditPackage(db, users.hr, range)), code('audit_export_denied'));
  const before = db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
  const pkg = tx(() => exportAuditPackage(db, users.outsider, range));
  const event = db.prepare("SELECT * FROM audit_events WHERE entity_type='audit_export' ORDER BY seq DESC LIMIT 1").get();
  assert.ok(event, 'the export is itself an audit event');
  assert.equal(JSON.parse(event.after_json).digest, pkg.digest, 'naming the digest of what left the platform');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n, before + 1);
  // أحداث الكيان الآخر وأحداث غير المالية في الكيان: بصمة ورقم تسلسل فقط.
  const foreign = db.prepare("SELECT seq FROM audit_events WHERE tenant_id<>'36t' AND seq BETWEEN ? AND ?").all(pkg.chain.events[0].seq, pkg.chain.events.at(-1).seq).map(r => r.seq);
  for (const seq of foreign) {
    const stub = pkg.chain.events.find(e => e.seq === seq);
    assert.ok(stub && !stub.full && stub.after_json === undefined && stub.tenant_id === undefined, `seq ${seq}: another tenant's event is a hash, not content`);
  }
  assert.ok(pkg.chain.events.filter(e => e.full).every(e => e.tenant_id === '36t'));
  assert.ok(foreign.length >= 1, 'the fixture wrote an event of another tenant inside the period');
  const hrEvents = pkg.chain.events.filter(e => e.full && /^(leave|payroll|employee|discipline|session)/.test(e.entity_type));
  assert.deepEqual(hrEvents, [], 'no people data rides in a finance package');
  assert.ok(pkg.chain.events.some(e => !e.full), 'the leave event stays in the chain as a hash');
  assert.throws(() => tx(() => exportAuditPackage(db, users.outsider, { from: w.day, to: '2026-01-01' })), error => ['date_order', 'invalid_period'].includes(error.code));
  assert.ok(verifyAudit(db));
});

test('audit export: the route answers a download with the package as an attachment, through the real handler', async t => {
  const w = world(t), { db } = w;
  const app = createApp(db);
  const login = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: 'outsider', password: 'synthetic-ledger-completeness' } });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers['Set-Cookie'].split(';')[0] };
  const res = await dispatch(app, { path: `/api/audit-export?from=${w.month}-01&to=${riyadhDay()}`, headers });
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Disposition'], /attachment; filename="audit-36t-/);
  const pkg = JSON.parse(res.text);
  assert.equal(verifyAuditPackage(pkg).ok, true);
  const manager = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: 'manager', password: 'synthetic-ledger-completeness' } });
  const denied = await dispatch(app, { path: `/api/audit-export?from=${w.month}-01&to=${riyadhDay()}`, headers: { cookie: manager.headers['Set-Cookie'].split(';')[0] } });
  assert.equal(denied.status, 403);
});

test('audit export: a package saved to disk verifies with the command-line checker alone, and a changed file fails it with the reason', t => {
  const w = world(t), { db, users, tx } = w;
  const dir = mkdtempSync(join(tmpdir(), 'audit-export-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = tx(() => exportAuditPackage(db, users.outsider, { from: `${w.month}-01`, to: w.day }));
  const good = join(dir, 'audit.json'), changed = join(dir, 'audit-changed.json');
  writeFileSync(good, JSON.stringify(pkg, null, 2));
  const edited = roundTrip(pkg);
  edited.journals[0].lines[0].debit_minor += 100;
  writeFileSync(changed, JSON.stringify(edited));
  const checker = fileURLToPath(new URL('../scripts/verify-audit-package.mjs', import.meta.url));
  const run = file => spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
  const ok = run(good);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /الحزمة سليمة/);
  assert.match(ok.stdout, new RegExp(`${pkg.journals.length} قيد`), 'it says how much it checked');
  const failed = run(changed);
  assert.equal(failed.status, 1, 'a changed file is a failure, not a warning');
  assert.match(failed.stdout, /ما سلمت/);
  assert.match(failed.stdout, /digest/, 'naming what broke');
  assert.equal(run(join(dir, 'missing.json')).status, 2, 'a file that is not there is a usage error, not a verdict');
});
