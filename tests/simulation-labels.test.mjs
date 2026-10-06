// الحزمة 3 — عبارات المحاكاة بمفردات العقد (simulated / sandbox-ready / blocked / active)، ولا شيء «active». العقد (البند 6 من
// الحزمة 3، والبند 4 من الحزمة 7): تنفيذ الدفع والفوترة الرسمية محليان ومحاكيان صراحةً حتى يوجد وصول خارجي معتمد، ولا تُصنع
// استجابة نجاح. ما يُقاس هنا: خريطة التكاملات تقول لكل جهة حالتها بالمفردات الأربع وأساسها ولا تقول «متصل»؛ ولوحة الفوترة
// الإلكترونية تقول «محاكاة» لا «مربوط»؛ والفاتورة المطبوعة تحمل علامة ظاهرة «داخلية — ما تبلّغت». (وعلامة SIMULATED في ملف
// تحويل الرواتب وملف حماية الأجور تُقاس في اختباريهما: tests/payroll-extras.test.mjs وtests/wage-protection.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { integrationReadiness, INTEGRATION_STATUS, integrationStatus } from '../app/integration-readiness.mjs';
import { einvoiceBoard, setGateway } from '../app/einvoice-gateway.mjs';
import { invoicePrintable } from '../app/print-documents.mjs';
import { integrationCards } from '../app/static/integrations-ui.mjs';
import { fixture } from './einvoice-fixture.mjs';

const VOCABULARY = ['simulated', 'sandbox-ready', 'blocked', 'active'];

test('integrations: every connection carries a status from the contract vocabulary with its basis, none is active, and the local simulations are named', t => {
  const db = openDb(':memory:'); t.after(() => db.close()); seed(db, 'synthetic-simulation-labels');
  assert.deepEqual(Object.keys(INTEGRATION_STATUS), VOCABULARY, 'the four words of the contract, in its order');
  const map = integrationReadiness(db, db.prepare("SELECT * FROM users WHERE id='manager'").get());
  const status = id => map.connections.find(c => c.id === id);
  assert.ok(map.connections.every(c => VOCABULARY.includes(c.status) && c.status_name === INTEGRATION_STATUS[c.status] && c.status_basis?.length >= 20), 'a status, its name and why');
  assert.equal(map.connections.filter(c => c.status === 'active').length, 0, 'nothing is active: no connection has independent evidence of a live link');
  assert.equal(map.active_count, 0);
  assert.deepEqual(['zatca', 'mudad', 'bank'].map(id => status(id).status), ['simulated', 'simulated', 'simulated'], 'official invoicing, the wage file and payment execution are local simulations');
  assert.equal(status('bank').name, 'البنك', 'payment execution and statements are a connection the map names');
  assert.ok(['qiwa', 'gosi', 'muqeem', 'identity', 'storage'].every(id => status(id).status === 'blocked'));
  assert.ok(map.connections.every(c => c.last_success === null && c.adapter_implemented === false), 'no success was ever recorded, and no adapter talks to anyone');
  assert.equal(integrationStatus('zatca'), 'simulated', 'other modules read the status from the one map');
  const html = integrationCards(map, { e: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  assert.match(html, /محاكاة محلية/);
  assert.doesNotMatch(html, /متصل ويعمل/, 'the screen never shows the active label');
});

test('e-invoicing: the board says the official channel is a local simulation, not connected, and a scripted success from a test gateway is still labelled as coming from that gateway', t => {
  const { db, users, claimFor, issue } = fixture(t);
  issue(claimFor(0, '115.00'));
  const board = einvoiceBoard(db, users.manager);
  assert.deepEqual([board.integration.status, board.integration.status_name, board.connected], ['simulated', INTEGRATION_STATUS.simulated, false]);
  assert.match(board.integration.basis, /لا يُرسل/);
  setGateway(null);
});

test('the printable tax invoice carries a visible internal / not-reported watermark, issued or draft', () => {
  const doc = { kind: 'invoice', number: 'INV-2026-000009', status: 'issued', status_name: 'صادرة', issued_at: '2026-09-17T10:00:00.000Z', supply_date: '2026-09-15',
    seller: { legal_name: 'شركة مصطنعة', vat_number: '300000000000003', address: 'الرياض' }, buyer: { legal_name: 'عميل مصطنع', vat_number: '', address: 'الرياض' },
    lines: [{ description: 'بند مصطنع', quantity: '1', net_minor: 100000, vat_minor: 15000, total_minor: 115000 }], vat_basis_points: 1500, currency: 'SAR', net_minor: 100000, vat_minor: 15000, total_minor: 115000,
    qr_tlv: 'AQ1TeW50aGV0aWM=', hash: 'b'.repeat(64), prepared_by_name: 'محاسب مصطنع', issued_by_name: 'معتمد مصطنع', original_number: null, vat_reason: '', reason: '' };
  for (const html of [invoicePrintable(doc), invoicePrintable({ ...doc, status: 'draft', status_name: 'مسودة', number: null, issued_at: null, qr_tlv: null })]) {
    assert.match(html, /<svg[^>]*class="watermark"[^>]*role="img"[^>]*aria-label="داخلية — ما تبلّغت لمنصة «فاتورة»"/, 'a watermark a reader sees and a screen reader names');
    assert.match(html, /<text[^>]*>داخلية — ما تبلّغت<\/text>/);
    assert.doesNotMatch(html, /style=|<script/, 'no inline style: the watermark is drawn with SVG attributes');
  }
});
