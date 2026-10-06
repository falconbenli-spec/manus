// P4-CRM-3 في الشاشات: ما وصّله الخادم يُرسم ويعمل — عرض سعر العميل المُلزِم وقراءة هامشه على الصفقة، واختياره في نموذج النسخة،
// وممثل العميل من سجله في قبول المخرج، والعقد المنهى، وإشارة سجل العقود إلى اتفاق الصفقة، والصفقة على عرض السعر.
// تُرسم الشاشات تحت Node ببيانات الخادم الحقيقي (tests/crm-fixture.mjs)، والعدّة نفسها التي تمررها app.mjs. بيانات تجريبية.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grantAccess } from '../app/access.mjs';
import { listCommercial } from '../app/commercial.mjs';
import * as contracts from '../app/contracts-register.mjs';
import { pricingBoard } from '../app/pricing.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { contractsRegisterUI } from '../app/static/contracts-register-ui.mjs';
import { quotationsUI } from '../app/static/pricing-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { crmWorld, riyadh, QUOTE, CONTRACT } from './crm-fixture.mjs';
import { proposalFor, approverFor } from './proposal-fixture.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (action, id, label) => `<button class="btn outline small" data-action="operation" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const context = { e, button, money, ui: kit(e) };
const data = (w, who) => ({ rows: listCommercial(w.db, w.users[who]), team: [], user: w.users[who] });

test('commercial screen: the quote form picks the client quotation it equals, the deal shows the bound quotation and its margin reading, and the payload carries the binding', t => {
  const w = crmWorld(t), { db } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.act('manager', deal, 'approve_qualification', { note: 'تأهيل تجريبي معتمد' });
  const quotationId = proposalFor(db, deal, QUOTE(), { state: 'draft' });
  // النموذج: اختيار عرض السعر من عروض عميل الصفقة، والحمولة تحمله.
  const form = commercialUI.form('save_quote', deal, data(w, 'employee'));
  const field = form.fields.find(f => f.name === 'quotation_id');
  assert.deepEqual(field.options.map(o => o.value), [quotationId]);
  assert.match(field.options[0].label, /QT-FX-\d+ · النسخة 1 · 92000\.00 SAR/);
  assert.equal(field.value, quotationId);
  const values = { quotation_id: quotationId, scope: 'نطاق تجريبي', currency: 'SAR', valid_until: '2099-12-01' };
  QUOTE().lines.forEach((line, index) => { for (const [key, value] of Object.entries(line)) values[`line_${index}_${key}`] = String(value); });
  assert.equal(form.toPayload(values).quotation_id, quotationId);
  // بعد الحفظ والاعتماد: الصفقة ترسم العرض المُلزِم وقراءة الهامش من ورقته.
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  const html = commercialUI.render(data(w, 'employee'), context);
  assert.match(html, /عرض سعر العميل المُلزِم: <bdi>QT-FX-\d+<\/bdi> · النسخة 1/);
  assert.match(html, /يبلغ المستهدف/);
  assert.match(html, /<time datetime="2099-12-01">/);
  // مدير المشروع بعضويته لا يرى أرقام العرض ولا قراءة الهامش.
  w.act('employee', deal, 'submit_quote');
  w.act('manager', deal, 'approve_quote', { note: 'اعتماد تجريبي' });
  db.prepare("UPDATE client_quotations SET status='issued',issuer_role='procurement',issued_by='employee',issued_at=?,version=version+1 WHERE id=?").run(new Date().toISOString(), quotationId);
  db.prepare("UPDATE client_quotations SET status='accepted',outcome='won',outcome_reason='قبول تجريبي للعرض في الاختبار',outcome_recorded_by='employee',outcome_recorded_at=?,version=version+1 WHERE id=?").run(new Date().toISOString(), quotationId);
  w.act('employee', deal, 'register_contract', CONTRACT);
  assert.match(commercialUI.render(data(w, 'employee'), context), /الاتفاق موثّق على هذا العرض بعد قبول العميل/);
  // الصفقة على عرض السعر في شاشة العروض.
  const quotations = quotationsUI.render(pricingBoardFor(w), context);
  assert.match(quotations, /مربوط بالصفقة <bdi>[0-9A-F]{8}<\/bdi>/);
  assert.match(quotations, /اتفاقها موثّق على هالعرض/);
});
function pricingBoardFor(w) {
  w.tx(() => grantAccess(w.db, w.users.admin, { user_id: 'employee', capability: 'pricing.sheets.use', department_id: 'creative', note: 'منح تجريبي لقراءة العروض' }));
  return pricingBoard(w.db, w.users.employee);
}

test('commercial screen: a below-target quote without a covering exception is drawn as the written refusal, naming its owner', t => {
  const w = crmWorld(t);
  const row = { id: 'syn', name: 'صفقة تجريبية', status: 'quote_pending', version: 3, access: 'financial', registration_number: 'SYN-1', owner_name: 'صاحب تجريبي', contact: 'جهة', source: 'تجريبي', sector: 'تجريبي',
    allowed_actions: [], deliveries: [], changes: [], reviews: [], quotes: [], qualifications: [], current_quote: null, readiness: null,
    proposal: { quote: { quotation_code: 'QT-0007', revision: 2, quotation_status_name: 'مسودة لم تُصدر', grand_total_minor: 9200000, sheet_code: 'PS-0007', valid_until: '2099-12-01', current: true,
      margin: { below_target: true, satisfied: false, target_margin_bp: 2000, net_margin_bp: 1500, owner: 'رئيس تنفيذي تجريبي', exception: { code: 'MX-0003', status_name: 'بانتظار قرار الرئيس التنفيذي', expired: false } } }, contract: null, candidates: [] },
    termination: { number: 'CT-0009', terminated_on: '2026-10-01' } };
  const html = commercialUI.render({ rows: [row], team: [], user: w.users.employee }, context);
  assert.match(html, /role="alert"/);
  assert.match(html, /15\.00% دون المستهدف 20\.00%/);
  assert.match(html, /رئيس تنفيذي تجريبي/);
  assert.match(html, /MX-0003: بانتظار قرار الرئيس التنفيذي/);
  assert.match(html, /العقد <bdi>CT-0009<\/bdi> انتهى بإنهاء مسجّل في <time datetime="2026-10-01">/);
});

test('commercial screen: accepting a deliverable picks the client’s registered approver — no typed name field — and says where to register one when none exists', t => {
  const w = crmWorld(t), { db } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.contract(deal);
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', deal, 'create_project', { member_ids: ['pm1'] });
  w.act('employee', deal, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز هوية الحملة التجريبية' });
  let form = commercialUI.form('accept_delivery', deal, data(w, 'manager'));
  assert.equal(form.fields.some(f => f.name === 'customer_representative'), false);
  let approver = form.fields.find(f => f.name === 'approver_id');
  assert.deepEqual(approver.options, []);
  assert.match(approver.hint, /موافقات العملاء/);
  const id = approverFor(db, w.kase(deal).project_id, 'pm1');
  form = commercialUI.form('accept_delivery', deal, data(w, 'manager'));
  approver = form.fields.find(f => f.name === 'approver_id');
  assert.deepEqual(approver.options.map(o => [o.value, o.label]), [[id, 'ممثل عميل تجريبي — مدير التسويق']]);
  assert.equal(approver.value, id);
  const delivery = data(w, 'manager').rows[0].deliveries[0].id;
  w.act('manager', deal, 'accept_delivery', form.toPayload({ delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', approver_id: id }));
  assert.match(commercialUI.render(data(w, 'employee'), context), /ممثل العميل: ممثل عميل تجريبي — مدير التسويق/);
});

test('contracts register screen: a client contract names the deal agreement it records, the card links to the deal, and terminating says what it stops', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.contract(deal);
  const agreement = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(deal).id;
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'contracts.register.manage', department_id: '', note: 'منح تجريبي لسجل العقود' }));
  let board = contracts.contractsRegisterBoard(db, users.manager);
  const form = contractsRegisterUI.form('create_contract', '', board);
  const field = form.fields.find(f => f.name === 'commercial_contract_id');
  assert.ok(field.options.some(o => o.value === agreement && /اتفاق الصفقة/.test(o.label)));
  const payload = form.toPayload({ party_kind: 'client', client_id: w.client, contract_type: 'statement_of_work', subject: 'أمر عمل تجريبي', start_date: riyadh(-1), end_date: '2099-12-31',
    value: '92000.00', auto_renew: '0', owner_id: 'employee', original_location: 'أرشيف العقود التجريبي', signed_on: riyadh(-1), commercial_contract_id: agreement });
  assert.equal(payload.commercial_contract_id, agreement);
  assert.equal(form.toPayload({ ...payload, party_kind: 'vendor', auto_renew: '0', commercial_contract_id: agreement }).commercial_contract_id, null, 'only a client contract records a deal agreement');
  const id = tx(() => contracts.createContract(db, users.manager, payload)).id;
  tx(() => contracts.contractAction(db, users.employee, id, 'activate_contract', { version: db.prepare('SELECT version FROM contract_records WHERE id=?').get(id).version, note: 'أقر بملكية العقد ومطابقته للأصل' }));
  board = contracts.contractsRegisterBoard(db, users.employee);
  const html = contractsRegisterUI.render(board, context);
  assert.match(html, /<dt>اتفاق الصفقة<\/dt>/);
  assert.match(html, /href="#commercial"/);
  assert.match(contractsRegisterUI.form('terminate_contract', id, board).fields[0].hint, /تقديم المخرجات، وطلبات التغيير، والاستحقاقات الجديدة/);
});
