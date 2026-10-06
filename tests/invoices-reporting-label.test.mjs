// الحزمة 3 — الفاتورة تقول عن نفسها في واجهة البرمجة ما تقوله نسختها المطبوعة: صادرة داخليًا، وما انبلّغت.
// لماذا هذا الملف: المسبار (docs/testing/p3-receivables-settlement-probe-20260930.txt) وجد عمود reporting_status ثابتًا
// 'not_reported' على كل مستند — المسودة والصادر بالعبارة نفسها — بلا وسمٍ يقول «داخلي»، ولا صلةٍ بطابور الفوترة الإلكترونية،
// فطابورٌ حرّكه مزوّد محاكٍ إلى «قُبل» لا يقابله في الفاتورة ما يمنع قراءتها «مُبلَّغة». الفوترة الإلكترونية غير مربوطة، فلا
// مستند صادر يُقرأ مُرسلًا أبدًا. كل البيانات مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as invoices from '../app/invoices.mjs';
import { setGateway } from '../app/einvoice-gateway.mjs';
import { fixture, ScriptedGateway } from './einvoice-fixture.mjs';

test('invoices API: every issued document says it is internal and not reported while no e-invoicing gateway is connected; a draft says it is not issued', t => {
  const { db, users, claimFor, pending, issue } = fixture(t);
  const issued = issue(claimFor(0, '115.00'));
  const doc = invoices.getInvoice(db, users.manager, issued.id);
  assert.deepEqual([doc.issuance, doc.reporting, doc.einvoice_queue.status, doc.einvoice_queue.simulated], ['internal', 'not_reported', 'queued', false]);
  assert.match(doc.reporting_note, /«فاتورة»/, 'the API says in words what the printable says');
  assert.equal(doc.reporting_status, 'not_reported', 'the stored column is unchanged');
  assert.equal(doc.simulated, true, 'the tenant still declares its data synthetic (migration 137), so its documents are marked simulated');
  const draft = pending(claimFor(1, '230.00'));
  const listed = invoices.listInvoices(db, users.manager);
  const waiting = listed.documents.find(d => d.id === draft.id);
  assert.deepEqual([waiting.issuance, waiting.reporting, waiting.einvoice_queue], ['internal', 'not_issued', null], 'a document that was never issued is not «not reported» — it is not issued');
  assert.ok(listed.documents.filter(d => d.status === 'issued').every(d => d.issuance === 'internal' && d.reporting === 'not_reported'));
  assert.deepEqual([listed.e_invoicing.reporting, listed.e_invoicing.reported], ['not_connected', 0]);
  db.prepare("UPDATE tenants SET demo_data=0 WHERE id='36t'").run();
  const real = invoices.getInvoice(db, users.manager, issued.id);
  assert.deepEqual([real.simulated, real.reporting], [false, 'not_reported'], 'real data is not a simulation — and it is still not reported');
});

test('invoices API: a queue status written by a simulated provider never reads as reported on the invoice', async t => {
  const { db, users, claimFor, issue, channel, attempt } = fixture(t);
  db.prepare("UPDATE tenants SET demo_data=0 WHERE id='36t'").run();
  setGateway(new ScriptedGateway([{ outcome: 'accepted', reference: 'REF-SIM-1', message: 'قبول من مزوّد اختبار لا يتصل بشيء' }]));
  const doc = issue(claimFor(0, '115.00'));
  const submission = await attempt(channel(doc, 'employee', 'reporting'), 'manager');
  assert.equal(submission.status, 'accepted');
  const view = invoices.getInvoice(db, users.manager, doc.id);
  assert.deepEqual([view.reporting, view.einvoice_queue.status, view.einvoice_queue.simulated, view.simulated], ['not_reported', 'accepted', true, true],
    'no gateway is connected, so an «accepted» in the queue can only come from a simulator');
  const printable = (await import('../app/print-documents.mjs')).invoicePrintable(view, false);
  assert.match(printable, /لم تُبلَّغ/, 'the printable and the API agree');
});
