// P4-CRM-4 في الشاشات: ما وصّله الخادم يُرسم ويعمل — جدول الدفعات بشروطه في نموذج الصفقة وقراءتها، وشرط الدفعة ورقم أمر الشراء على
// بطاقة الاستحقاق، واستحقاق الدفعة المقدمة بزرّه ونموذجه وطريق نقده، وكشف العميل عبر صفقاته، ورقم أمر الشراء على الفاتورة ونسختها
// المطبوعة. تُرسم الشاشات تحت Node ببيانات الخادم الحقيقي (tests/crm-fixture.mjs)، والعدّة نفسها التي تمررها app.mjs. بيانات تجريبية.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grantAccess } from '../app/access.mjs';
import { listCommercial } from '../app/commercial.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as axes from '../app/project-axes.mjs';
import * as receivables from '../app/receivables.mjs';
import * as invoices from '../app/invoices.mjs';
import { invoicePrintable } from '../app/print-documents.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { receivablesUI } from '../app/static/receivables-ui.mjs';
import { invoicesUI } from '../app/static/invoices-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { crmWorld, riyadh } from './crm-fixture.mjs';
import { term, deal, schedule, project, accept, claim, approve, purchaseOrder, confirmPurchaseOrder } from './entitlement-fixture.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (action, id, label) => `<button class="btn outline small" data-action="operation" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const context = { e, button, money, ui: kit(e) };
const commercialData = (w, who) => ({ rows: listCommercial(w.db, w.users[who]), team: [], user: w.users[who] });

test('commercial screen: the payment-schedule form asks each term for its condition kind and the agreement lines it waits for, and the deal reads the conditions back', t => {
  const w = crmWorld(t), d = deal(w);
  const form = commercialUI.form('record_payment_terms', d.id, commercialData(w, 'employee'));
  assert.equal(form.fields.some(f => f.name === 'term_0_is_advance'), false, 'the advance is a kind of condition, not a separate yes/no');
  const kind = form.fields.find(f => f.name === 'term_0_kind'), lines = form.fields.find(f => f.name === 'term_0_lines');
  assert.deepEqual(kind.options.map(o => o.value), ['acceptance', 'advance']);
  assert.equal(lines.type, 'checks');
  assert.deepEqual(lines.options.map(o => [o.value, o.label]), [['0', 'البند 1: هوية الحملة التجريبية'], ['1', 'البند 2: منشور تجريبي مصمم']]);
  const payload = form.toPayload({ requires_client_po: 'no',
    term_0_label: 'مقدمة تجريبية عند توقيع الاتفاق', term_0_amount: '27600.00', term_0_due_on: '2099-10-15', term_0_condition: '', term_0_kind: 'advance', term_0_lines: ['0'],
    term_1_label: 'الباقي التجريبي عند قبول البندين', term_1_amount: '64400.00', term_1_due_on: '2099-11-15', term_1_condition: 'بعد اعتماد العميل', term_1_kind: 'acceptance', term_1_lines: ['0', '1'] });
  assert.deepEqual(payload.terms.map(x => [x.condition_kind, x.condition_lines, x.is_advance]), [['advance', [], true], ['acceptance', [0, 1], false]]);
  assert.equal(payload.requires_client_po, false);
  w.tx(() => axes.recordPaymentTerms(w.db, w.users.employee, d.id, payload));
  const html = commercialUI.render(commercialData(w, 'employee'), context);
  assert.match(html, /مقدمة تجريبية عند توقيع الاتفاق 27600\.00 SAR \(مقدمة عند الاتفاق\)/);
  assert.match(html, /الباقي التجريبي عند قبول البندين 64400\.00 SAR \(عند قبول البند 1 والبند 2\)/);
});

test('receivables screen: the claim card names its payment condition and client PO, the advance claim has its own button and form and no receipt button, and the customer statement lists each deal', t => {
  const w = crmWorld(t), { db, users } = w;
  // صفقة بمقدمة وباقٍ عند قبول البندين، وأمر شراء مؤكد.
  const d = deal(w);
  schedule(w, d, [term('مقدمة تجريبية عند توقيع الاتفاق', '27600.00', 'advance'), term('الباقي التجريبي عند قبول البندين', '64400.00', 'acceptance', [0, 1])], true);
  confirmPurchaseOrder(w, purchaseOrder(w, d, '92000.00', { number: 'PO-UI-7001' }).id);
  project(w, d);
  let data = receivables.listReceivables(db, users.employee);
  assert.match(receivablesUI.render(data, context), /data-operation="create_advance_claim"/);
  const form = receivablesUI.form('create_advance_claim', '', data);
  const source = form.fields.find(f => f.name === 'case_id');
  assert.deepEqual(source.options.map(o => o.value), [d.id]);
  assert.match(source.options[0].label, /مقدمة تجريبية عند توقيع الاتفاق · الباقي 27600\.00/);
  const payload = form.toPayload({ case_id: d.id, amount: '27600.00', due_date: '2099-12-15', entitlement_evidence: 'جدول الدفعات التجريبي وتوقيع الاتفاق' });
  assert.equal(payload.basis, 'advance');
  const advance = approve(w, w.tx(() => receivables.createClaim(db, users.employee, payload)));
  // مال المقدمة يصل دفعةً مقدمة يؤكدها غير مسجّلها، فتنفتح بوابة البدء ويُسلَّم العمل.
  for (const who of ['employee', 'manager']) w.tx(() => grantAccess(db, users.admin, { user_id: who, capability: 'billing.recurring.manage', department_id: '', note: 'منح تجريبي للدفعات المقدمة' }));
  const paid = w.tx(() => billing.recordAdvance(db, users.employee, { client_id: w.client, schedule_id: '', project_id: w.kase(d.id).project_id, description: 'دفعة مقدمة تجريبية على الاتفاق',
    agreement_reference: 'بند الدفعة المقدمة في جدول الاتفاق التجريبي', amount: '27600.00' })).id;
  w.tx(() => billing.confirmAdvance(db, users.manager, paid, { version: 1, amount: '27600.00', received_on: riyadh(), evidence: 'كشف حساب بنكي تجريبي يطابق الحوالة', reference: 'TRF-UI-ADV-1' }));
  // الاستحقاق على قبول البندين: شرطه ورقم أمر الشراء على بطاقته.
  accept(w, d, 0);
  const delivery = accept(w, d, 1);
  data = receivables.listReceivables(db, users.employee);
  assert.match(receivablesUI.form('create_claim', '', data).fields[0].options.find(o => o.value === delivery).label, /الباقي التجريبي عند قبول البندين/);
  approve(w, claim(w, { delivery_id: delivery, amount: '64400.00' }));
  data = receivables.listReceivables(db, users.employee);
  const html = receivablesUI.render(data, context);
  assert.match(html, /شرط الدفعة: الباقي التجريبي عند قبول البندين/);
  assert.match(html, /أمر شراء العميل <bdi>PO-UI-7001<\/bdi> · النسخة 1/);
  const advanceCard = html.slice(html.indexOf(`data-id="${advance.id}"`), html.indexOf('</article>', html.indexOf(`data-id="${advance.id}"`)));
  assert.match(advanceCard, /يتحصّل بالسحب من الدفعة المقدمة المؤكدة/);
  assert.doesNotMatch(advanceCard, /data-operation="record_receipt"/);
  // كشف العميل عبر صفقاته: جدول برؤوس مسمّاة، وما على حساب صفقة لا يُخصم من باقي أخرى.
  assert.match(html, /<h2>كشف العملاء عبر صفقاتهم/);
  assert.match(html, /<th>على الحساب ما تخصّص<\/th>/);
  assert.match(html, /المال على الحساب يبقى لصفقته/);
  assert.equal(data.statements.find(s => s.client.id === w.client).deals[0].open_minor, 9200000);
});

test('invoice screen and its printable copy carry the client PO number the claim was raised under', t => {
  const w = crmWorld(t), { db, users } = w, d = deal(w);
  schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0]), term('دفعة تجريبية عند قبول المنشورات', '46000.00', 'acceptance', [1])], true);
  confirmPurchaseOrder(w, purchaseOrder(w, d, '92000.00', { number: 'PO-INV-7001' }).id);
  project(w, d);
  const a = approve(w, claim(w, { delivery_id: accept(w, d, 0) }));
  const address = { building: '1234', street: 'طريق تجريبي', district: 'حي الاختبار', city: 'الرياض', postal_code: '12345', country: 'SA' };
  const seller = w.tx(() => invoices.recordCompanyProfile(db, users.employee, { legal_name: 'شركة 3,6T التجريبية', vat_number: '300000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' })).id;
  w.tx(() => invoices.approveCompanyProfile(db, users.manager, seller, { note: 'طابقنا الشهادة الضريبية التجريبية' }));
  w.tx(() => invoices.recordCustomerProfile(db, users.employee, { case_id: d.id, legal_name: 'شركة الأفق التجريبية للتجزئة', vat_number: '310000000000003', address, source: 'شهادة ضريبية تجريبية أرسلها العميل' }));
  const prepared = w.tx(() => invoices.prepareInvoice(db, users.employee, { claim_id: a.id, supply_date: riyadh(), vat_category: 'standard' }));
  const html = invoicesUI.render(invoices.listInvoices(db, users.employee), context);
  assert.match(html, /<dt>أمر شراء العميل<\/dt><dd><bdi dir="ltr">PO-INV-7001<\/bdi><\/dd>/);
  assert.match(invoicePrintable(invoices.getInvoice(db, users.employee, prepared.id)), /أمر شراء العميل <bdi dir="ltr">PO-INV-7001<\/bdi>/);
});
