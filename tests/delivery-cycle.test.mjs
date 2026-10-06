// دورة العميل والمشروع من طرف إلى طرف: البوابات التي تعبر الوحدات، لا البوابات داخل كل وحدة.
// ما تختبره الملفات الأخرى (commercial، receivables، invoices، procurement، payables) لا يُعاد هنا.
// ما يعنينا: ألا ينكسر الشرط حين يمتد عبر وحدتين — التنفيذ والقبول والاستحقاق والفاتورة والتحصيل وسداد المورد.
// البوابات الغائبة مُعلَّمة بـ{skip} مع سبب مكتوب، حتى لا يُقرأ غيابها نجاحًا.
// المرجع: docs/product/audits/DELIVERY-CYCLE-AUDIT-20260920.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { approveVendors, registerVendor } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, capabilitiesFor } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createLead, commercialAction, listCommercial } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { createClaim, claimAction, listReceivables, recordReceipt, receiptAction } from '../app/receivables.mjs';
import { prepareInvoice, invoiceAction, recordCompanyProfile, approveCompanyProfile, recordCustomerProfile, listInvoices } from '../app/invoices.mjs';
import { createPurchase, procurementAction, listProcurement } from '../app/procurement.mjs';
import { requestOrderChange, decideOrderChange } from '../app/procurement-extras.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
import { preparePayment, paymentAction, getOrder, listPayables } from '../app/payables.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { registerApprover, recordApproval, approvalAction, getApproval } from '../app/client-approvals.mjs';
import { createRoute, reviewAction, getRoute } from '../app/review-rounds.mjs';
import { financeGrantsBoard, grantFinanceAction, revokeFinanceGrant, MAX_FINANCE_AUTHORITY_DAYS } from '../app/finance-grants.mjs';
import { financeCapabilities, listFinance, createFinanceReference, journalAction } from '../app/finance.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import { submitClaim } from '../app/expenses.mjs';
import * as axes from '../app/project-axes.mjs';
import { fundProject } from './budget-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { riyadhToday } from '../app/riyadh-time.mjs';

const code = value => error => error.code === value;
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const ibanOf = bban => { const numeric = (bban + 'SA00').replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55)); let r = 0; for (const d of numeric) r = (r * 10 + Number(d)) % 97; return 'SA' + String(98 - r).padStart(2, '0') + bban; };

function base(t, password) {
  const db = openDb(':memory:');
  seed(db, password);
  t.after(() => db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES" +
    "('pm','36t','creative','pm','مدير مشروع مصطنع','unused','pm','manager')," +
    "('treasurer','36t','ops','treasurer','أمين خزينة مصطنع','unused','employee','manager')");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const finance = (who, actions) => { for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مصطنع لدورة التسليم', null, now()); };
  const grant = (user_id, capability) => transaction(db, () => grantAccess(db, users.admin, { user_id, capability, department_id: null, note: 'تصريح اختبار دورة التسليم' }));
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
    // «dc-vendor-a» يسجّله الاختبار نفسه أدناه بملف شركة إنتاج، فلا يُسجَّل هنا مرتين.
  approveVendors(db,['dc-vendor-b', 'dc-vendor-c']);
  // «dc-vendor-a» يُسجَّل **غير مؤهَّل**: العرض يحتاج وجود الملف، والترسية تحتاج تأهيله —
  // فيبقى ما يُثبته هذا الاختبار قائمًا: لا ترسية قبل أن يُؤهَّل المورد في qualifyVendor أدناه.
  registerVendor(db,'dc-vendor-a');
  return { db, users, finance, grant };
}

/* ───── دورة العميل: من العميل المحتمل إلى التحصيل الكامل ───── */
// schedule: جدول دفعات بشروطه عند قبول كل بند (الترحيل 183)؛ الاختباران اللذان يسجّلان جدولهما بأنفسهما يطلبانه بلا جدول.
function clientCycle(t, { schedule = true } = {}) {
  const f = base(t, 'synthetic-delivery-cycle-client');
  const { db, users } = f;
  f.finance('employee', ['read', 'prepare']);
  f.finance('manager', ['read', 'approve']);
  const act = (who, c, action, input = {}) => transaction(db, () => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = transaction(db, () => dealFor(db, users.employee, { name: 'عميل دورة التسليم المصطنع', registration_number: 'DC-100', contact: 'ممثل مصطنع', source: 'اختبار الدورة', sector: 'تجريبي' }));
  const lead = c;
  c = act('employee', c, 'qualify', { need: 'مخرجان لاختبار دورة التسليم', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل القرار', service_fit: 'ضمن خدمات التجربة' });
  const qualificationPending = c;
  c = act('manager', c, 'approve_qualification', { note: 'الاحتياج والميزانية مراجعان' });
  const qualified = c;
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, {
    scope: 'مخرجان مصطنعان بمعياري قبول', currency: 'SAR', valid_until: '2099-12-01', lines: [
      { description: 'المخرج الأول', quantity: '1', unit_price: '400.00', unit_cost: '100.00', discount: '0', tax_rate: '15', acceptance: 'قبول المخرج الأول بدليل', revisions: 1 },
      { description: 'المخرج الثاني', quantity: '1', unit_price: '600.00', unit_cost: '150.00', discount: '0', tax_rate: '15', acceptance: 'قبول المخرج الثاني بدليل', revisions: 1 }
    ]
  }));
  const quoteDraft = c;
  c = act('employee', c, 'submit_quote');
  c = act('manager', c, 'approve_quote', { note: 'العرض والنطاق والهامش' });
  const quoteApproved = c;
  c = act('employee', c, 'register_contract', { agreement_evidence: 'محضر اتفاق مصطنع محفوظ في أرشيف التجربة', customer_representative: 'ممثل العميل المصطنع' });
  const contracted = c;
  if (schedule) scheduleFor(db, c.id);
  c = act('manager', c, 'create_project', { member_ids: ['employee', 'pm'] });
  const read = () => listCommercial(db, users.employee).find(x => x.id === c.id);
  return { ...f, act, read, project_id: c.project_id, case: c, stages: { lead, qualificationPending, qualified, quoteDraft, quoteApproved, contracted } };
}

test('delivery cycle: no step of the client chain opens before the step before it was approved by someone else', t => {
  // الحالات السالبة تُجرَّب على النسخة الحية لكل مرحلة قبل تجاوزها: فحص النسخة يسبق فحص الإجراء.
  const f = base(t, 'synthetic-delivery-cycle-chain');
  const { db, users } = f;
  const act = (who, c, action, input = {}) => transaction(db, () => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  const quote = { scope: 'مخرج واحد مصطنع', currency: 'SAR', valid_until: '2099-12-01', lines: [{ description: 'مخرج', quantity: '1', unit_price: '100.00', unit_cost: '20.00', discount: '0', tax_rate: '15', acceptance: 'قبول المخرج بدليل', revisions: 1 }] };
  const contract = { agreement_evidence: 'محضر اتفاق مصطنع محفوظ في أرشيف التجربة', customer_representative: 'ممثل العميل المصطنع' };
  let c = transaction(db, () => dealFor(db, users.employee, { name: 'عميل سلسلة مصطنع', registration_number: 'DC-CHAIN', contact: 'ممثل', source: 'اختبار', sector: 'تجريبي' }));
  assert.throws(() => act('employee', c, 'save_quote', quote), code('commercial_transition'), 'عرض قبل التأهيل');
  assert.throws(() => act('employee', c, 'register_contract', contract), code('commercial_transition'), 'عقد قبل التأهيل');
  c = act('employee', c, 'qualify', { need: 'احتياج مصطنع', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل القرار', service_fit: 'ضمن الخدمات' });
  assert.throws(() => act('employee', c, 'approve_qualification', { note: 'اعتماد ذاتي' }), code('commercial_transition'), 'معد التأهيل لا يعتمده');
  assert.throws(() => act('employee', c, 'save_quote', quote), code('commercial_transition'), 'عرض قبل اعتماد التأهيل');
  c = act('manager', c, 'approve_qualification', { note: 'الاحتياج والميزانية مراجعان' });
  assert.throws(() => act('employee', c, 'register_contract', contract), code('commercial_transition'), 'عقد قبل وجود عرض');
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, quote));
  assert.throws(() => act('employee', c, 'register_contract', contract), code('commercial_transition'), 'عقد قبل اعتماد العرض');
  c = act('employee', c, 'submit_quote');
  assert.throws(() => act('employee', c, 'approve_quote', { note: 'اعتماد ذاتي' }), code('commercial_transition'), 'معد العرض لا يعتمده');
  c = act('manager', c, 'approve_quote', { note: 'العرض والنطاق والهامش' });
  assert.throws(() => act('manager', c, 'create_project', { member_ids: [] }), code('commercial_transition'), 'مشروع قبل تسجيل العقد');
  c = act('employee', c, 'register_contract', contract);
  assert.throws(() => act('employee', c, 'create_project', { member_ids: [] }), code('commercial_transition'), 'صاحب الملف لا يفتح المشروع بنفسه');
  c = act('manager', c, 'create_project', { member_ids: ['employee'] });
  assert.equal(c.status, 'project_active');
  assert.ok(verifyAudit(db));
});

test('delivery cycle: an entitlement is born from an accepted deliverable only — a submitted one is not enough', t => {
  const { db, users, act, read } = clientCycle(t);
  let c = read();
  c = act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز المخرج الأول بمراجعه المسجلة' });
  const pending = c.deliveries.find(d => d.line_index === 0);
  const claimOn = (deliveryId, amount = '400.00') => transaction(db, () => createClaim(db, users.employee, { delivery_id: deliveryId, amount, due_date: '2099-12-15', entitlement_evidence: 'محضر القبول وبند العقد المقابل للاستحقاق' }));
  // هذه هي بوابة «لا فاتورة بلا شهادة إنجاز» كما تنفذها المنصة: القبول المستقل شرط وجود الاستحقاق.
  assert.throws(() => claimOn(pending.id), code('delivery_not_billable'), 'استحقاق على مخرج سُلّم ولم يُقبل');
  assert.throws(() => act('employee', c, 'accept_delivery', { delivery_id: pending.id, note: 'قبول ذاتي', acceptance_evidence: 'محاولة قبول ذاتي مسجلة', approver_id: approverFor(db, c.project_id) }), code('commercial_transition'), 'من سلّم لا يقبل تسليمه');
  c = act('manager', c, 'accept_delivery', { delivery_id: pending.id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول مصطنع موقع ومحفوظ ورقيًا', approver_id: approverFor(db, c.project_id) });
  const claim = claimOn(pending.id);
  assert.equal(claim.status, 'draft');
  assert.equal(claim.source_snapshot.delivery_id, pending.id);
  assert.throws(() => claimOn(pending.id), code('duplicate_entitlement'), 'لا استحقاقان لمخرج واحد');
  assert.ok(verifyAudit(db));
});

test('delivery cycle: the customer invoice hangs on an approved entitlement, and the preparer never issues it', t => {
  const { db, users, act, read, finance } = clientCycle(t);
  let c = read();
  c = act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز المخرج الأول بمراجعه المسجلة' });
  const delivery = c.deliveries[0];
  c = act('manager', c, 'accept_delivery', { delivery_id: delivery.id, note: 'قبول', acceptance_evidence: 'محضر قبول مصطنع محفوظ في أرشيف التجربة', approver_id: approverFor(db, c.project_id) });
  let claim = transaction(db, () => createClaim(db, users.employee, { delivery_id: delivery.id, amount: '460.00', due_date: '2099-12-15', entitlement_evidence: 'محضر القبول وبند العقد المقابل للاستحقاق' }));
  // الفاتورة قبل اعتماد الاستحقاق: مرفوضة.
  const profile = transaction(db, () => recordCompanyProfile(db, users.employee, { legal_name: 'منشأة مصطنعة', vat_number: '310000000000003', cr_number: '1010000001', address: { building: '1234', street: 'شارع', district: 'حي', city: 'الرياض', postal_code: '12345', country: 'SA' }, effective_from: '2026-01-01' }));
  transaction(db, () => approveCompanyProfile(db, users.manager, profile.id, { note: 'طوبقت البيانات الضريبية للمنشأة' }));
  transaction(db, () => recordCustomerProfile(db, users.employee, { case_id: c.id, legal_name: 'عميل مصطنع', vat_number: '300000000000003', address: { building: '5678', street: 'شارع', district: 'حي', city: 'الرياض', postal_code: '54321', country: 'SA' }, source: 'عقد العميل المصطنع' }));
  assert.throws(() => transaction(db, () => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: today(), vat_category: 'standard', vat_reason: '' })), code('claim_not_billable'), 'فاتورة على استحقاق لم يُعتمد');
  claim = transaction(db, () => claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
  claim = transaction(db, () => claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'طوبق القبول وبند العقد' }));
  let invoice = transaction(db, () => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: today(), vat_category: 'standard', vat_reason: '' }));
  invoice = transaction(db, () => invoiceAction(db, users.employee, invoice.id, 'submit', { version: 1, note: '' }));
  assert.throws(() => transaction(db, () => invoiceAction(db, users.employee, invoice.id, 'issue', { version: invoice.version, note: 'إصدار ذاتي' })), code('transition_denied'), 'من أعدّ الفاتورة لا يصدرها');
  invoice = transaction(db, () => invoiceAction(db, users.manager, invoice.id, 'issue', { version: invoice.version, note: 'طوبقت الأرقام والبيانات' }));
  assert.equal(invoice.status, 'issued');
  assert.match(invoice.number, /^INV-\d{4}-\d{6}$/);
  assert.equal(listInvoices(db, users.manager).totals.invoiced_minor, 46000);
  assert.ok(verifyAudit(db));
});

test('delivery cycle: collection is recorded and matched by two people and never exceeds the entitlement', t => {
  const { db, users, act, read } = clientCycle(t);
  let c = read();
  c = act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز المخرج الأول بمراجعه المسجلة' });
  c = act('manager', c, 'accept_delivery', { delivery_id: c.deliveries[0].id, note: 'قبول', acceptance_evidence: 'محضر قبول مصطنع محفوظ في أرشيف التجربة', approver_id: approverFor(db, c.project_id) });
  let claim = transaction(db, () => createClaim(db, users.employee, { delivery_id: c.deliveries[0].id, amount: '460.00', due_date: '2099-12-15', entitlement_evidence: 'محضر القبول وبند العقد المقابل للاستحقاق' }));
  claim = transaction(db, () => claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
  claim = transaction(db, () => claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'استحقاق صحيح' }));
  const receipt = (reference, amount) => transaction(db, () => recordReceipt(db, users.employee, claim.id, { reference, amount, received_on: today(), payer: 'عميل مصطنع', evidence: 'إشعار تحويل مصطنع محفوظ للمراجعة' }));
  const part = receipt('DC-RCPT-1', '160.00');
  assert.throws(() => transaction(db, () => receiptAction(db, users.employee, claim.id, part.id, 'confirm', { note: 'مطابقة ذاتية', matching_evidence: 'كشف بنكي مصطنع للمطابقة' })), code('receivable_access_denied'));
  transaction(db, () => receiptAction(db, users.manager, claim.id, part.id, 'confirm', { note: 'طوبق الإشعار بكشف الحساب', matching_evidence: 'كشف بنكي مصطنع يظهر الحركة' }));
  let view = listReceivables(db, users.employee).claims.find(x => x.id === claim.id);
  assert.equal(view.confirmed_minor, '16000');
  assert.equal(view.balance_minor, '30000');
  assert.throws(() => receipt('DC-RCPT-X', '400.00'), code('over_allocation'), 'التحصيل لا يتجاوز الاستحقاق');
  const rest = receipt('DC-RCPT-2', '300.00');
  transaction(db, () => receiptAction(db, users.manager, claim.id, rest.id, 'confirm', { note: 'اكتمل التحصيل', matching_evidence: 'كشف بنكي مصطنع يظهر الحركة الثانية' }));
  view = listReceivables(db, users.employee).claims.find(x => x.id === claim.id);
  assert.equal(view.balance_minor, '0');
  assert.equal(view.aging_bucket, 'مسدد داخليًا');
  assert.ok(verifyAudit(db));
});

/* ───── مرحلة العميل في المراجعة الإبداعية ───── */
test('delivery cycle: a client review stage closes only on an external approval documented against that very version', t => {
  const { db, users, grant, project_id } = clientCycle(t);
  for (const who of ['employee', 'manager', 'pm']) grant(who, 'review.manage');
  grant('employee', 'approvals.record');
  const sAct = (who, s, action, input = {}) => transaction(db, () => studioAction(db, users[who], s.id, action, { version: s.version, ...input }));
  let s = transaction(db, () => createStudio(db, users.employee, {
    project_id, title: 'مساحة اختبار الدورة', reviewer_id: '', objective: 'هدف مصطنع', audience: 'جمهور مصطنع',
    audience_basis: 'سند جمهور مصطنع للاختبار', message: 'رسالة مصطنعة', prohibited_messages: 'لا ادعاءات', kpi: 'مؤشر مصطنع',
    measurement_source: 'مصدر قياس مصطنع', channels: ['instagram'], scope: 'نطاق مصطنع للاختبار'
  }));
  s = sAct('employee', s, 'submit_brief');
  s = sAct('manager', s, 'approve_brief', { note: 'الموجز واضح' });
  s = sAct('employee', s, 'add_asset', { name: 'أصل مصطنع', internal_reference: 'DC-ASSET-1', rights_holder: 'الشركة', rights_basis: 'owned', rights_evidence: 'ملكية داخلية مسجلة في أرشيف التجربة', valid_from: today(), valid_until: '2099-12-31', channels: ['instagram'] });
  s = sAct('manager', s, 'inspect_asset', { asset_id: s.assets[0].id, outcome: 'passed', evidence: 'فحص الحقوق والقناة والمدة مطابق' });
  s = sAct('employee', s, 'create_output', { title: 'مخرج مصطنع', channel: 'instagram', format: 'PNG', dimensions: '1080x1080', language: 'ar', brand_reference: 'دليل مصطنع', acceptance: 'مطابقة الدليل', content: 'وصف النسخة', asset_ids: [s.assets[0].id] });
  s = sAct('employee', s, 'submit_output', { output_id: s.outputs[0].id });
  s = sAct('manager', s, 'approve_output', { output_id: s.outputs[0].id, note: 'مطابق', quality_checks: { brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' } });
  const versionId = s.outputs[0].current_version_id;

  const route = transaction(db, () => createRoute(db, users.pm, {
    output_version_id: versionId, name: 'جولة اختبار الدورة', owner_id: 'manager', template_id: '',
    stages: [
      { position: 1, name: 'مراجعة داخلية', audience: 'internal', reviewer_ids: ['manager'], due_days: 3, reminder_days: 1, escalation_days: 5 },
      { position: 2, name: 'قرار العميل', audience: 'client', reviewer_ids: ['manager'], due_days: 5, reminder_days: 2, escalation_days: 7 }
    ]
  }));
  let r = getRoute(db, users.pm, route.id);
  r = transaction(db, () => reviewAction(db, users.manager, route.id, 'decide', { version: r.version, stage_id: r.stages[0].id, decision: 'approved', note: 'مطابق للموجز وجاهز للعميل', external_approval_id: '' }));
  const clientStage = r.stages[1].id;
  assert.throws(() => transaction(db, () => reviewAction(db, users.manager, route.id, 'decide', { version: r.version, stage_id: clientStage, decision: 'approved', note: 'إغلاق بلا دليل', external_approval_id: '' })), code('client_evidence_required'), 'مرحلة العميل لا تُغلق بلا موافقة موثقة');

  const approver = transaction(db, () => registerApprover(db, users.employee, { project_id, name: 'مفوض العميل المصطنع', title: 'مدير التسويق', authority_basis: 'خطاب تفويض مصطنع محفوظ في ملف التجربة', authority_scope: 'اعتماد المخرجات', valid_from: today() }));
  const approval = transaction(db, () => recordApproval(db, users.employee, { output_version_id: versionId, approver_id: approver.id, decision: 'changes_requested', scope_note: 'طلب تعديل موثق على هذه النسخة بالذات', channel: 'email', received_on: today(), evidence_reference: 'رسالة بريد مصطنعة محفوظة في الأرشيف' }));
  // القرار لا يُترجم باجتهاد: «طلب تعديل» لا يُغلق المرحلة موافقةً.
  assert.throws(() => transaction(db, () => reviewAction(db, users.manager, route.id, 'decide', { version: r.version, stage_id: clientStage, decision: 'approved', note: 'ترجمة مخالفة للسجل', external_approval_id: approval.id })), code('client_decision_mismatch'));
  r = transaction(db, () => reviewAction(db, users.manager, route.id, 'decide', { version: r.version, stage_id: clientStage, decision: 'changes_required', note: 'وفق ما وثّقه السجل', external_approval_id: approval.id }));
  assert.equal(r.status, 'changes_required');
  assert.ok(verifyAudit(db));
});

/* ───── دورة المورد: من الاحتياج إلى توثيق التحويل ───── */
function supplierCycle(t) {
  const f = base(t, 'synthetic-delivery-cycle-supplier');
  const { db, users, grant } = f;
  f.finance('employee', ['read', 'prepare']);
  f.finance('manager', ['read', 'approve']);
  f.finance('treasurer', ['read', 'post']);
  grant('employee', 'vendors.manage');
  grant('outsider', 'vendors.manage');
  grant('hr', 'vendors.bank');
  const project = transaction(db, () => createProject(db, users.manager, { name: 'مشروع دورة المورد المصطنع', brief: 'اختبار احتياج مورد ضمن دورة التسليم', member_ids: ['employee'] }));
  fundProject(db, project.id, 'DC-CC-1', '1000.00');
  const pAct = (who, p, action, values = {}) => transaction(db, () => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  const need = (overrides = {}) => transaction(db, () => createPurchase(db, users.employee, {
    project_id: project.id, title: 'احتياج تصوير مصطنع', specification: 'يوم تصوير بطاقم ومعدات', cost_center: 'DC-CC-1',
    due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '600.00', budget_evidence: 'مخصص المشروع المعتمد', currency: 'SAR', ...overrides
  }));
  const quotes = p => { let out = p; for (const [key, price] of [['dc-vendor-a', '500.00'], ['dc-vendor-b', '540.00'], ['dc-vendor-c', '560.00']]) out = pAct('employee', out, 'add_quote', { supplier_key: key, supplier_name: 'مورد ' + key, unit_price: price, technical_assessment: 'مطابق للمواصفات المسجلة', financial_terms: 'صافي 30 يومًا', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ' }); return out; };
  const vAct = (who, vendorId, action, values = {}) => transaction(db, () => vendorAction(db, users[who], vendorId, action, { version: getVendor(db, users[who], vendorId).version, ...values }));
  const qualifyVendor = () => {
    const vendorId = db.prepare("SELECT id FROM vendors WHERE upper(supplier_key)=upper('dc-vendor-a')").get().id;  // المفتاح يُرفع إلى أحرف كبيرة عند التسجيل
    vAct('employee', vendorId, 'add_contact', { name: 'ممثل المورد', role: 'مبيعات', email: 'v@vendor.invalid', phone: '' });
    vAct('employee', vendorId, 'add_document', { kind: 'commercial_registration', reference: 'سجل تجاري مصطنع محفوظ', issued_on: '2026-01-01', expires_on: '2099-01-01' });
    vAct('employee', vendorId, 'submit');
    vAct('outsider', vendorId, 'verify_document', { document_id: getVendor(db, users.outsider, vendorId).documents[0].id, verification: 'verified', note: 'طوبق السجل' });
    for (const [kind, who] of [['duplicate', 'outsider'], ['procurement', 'outsider'], ['technical', 'manager']]) vAct(who, vendorId, 'review_' + kind, { decision: 'passed', note: 'اجتاز المراجعة المصطنعة' });
    vAct('outsider', vendorId, 'approve', { outcome: 'approved', reason: 'اكتملت الوثائق والمراجعات في التجربة المصطنعة' });
    vAct('outsider', vendorId, 'propose_bank', { bank_name: 'بنك مصطنع', account_holder: 'شركة إنتاج مصطنعة', iban: ibanOf('80000000000000000012'), reason: 'تسجيل حساب الدفع الأول للمورد' });
    vAct('hr', vendorId, 'verify_bank', { bank_id: getVendor(db, users.hr, vendorId).bank[0].id, decision: 'verified', verification_method: 'bank_letter', verification_evidence: 'خطاب بنكي مصطنع مطابق لاسم المورد', effective_from: today() });
    return vendorId;
  };
  return { ...f, project, pAct, need, quotes, qualifyVendor, readPurchase: id => listProcurement(db, users.manager).find(x => x.id === id) };
}

test('delivery cycle: no supplier award without a comparison, a qualified vendor and an approved project budget', t => {
  const { db, users, pAct, need, quotes, qualifyVendor, project } = supplierCycle(t);
  let p = pAct('employee', need(), 'submit');
  assert.throws(() => pAct('manager', p, 'award', { quote_id: randomUUID(), note: 'ترسية بلا مقارنة' }), code('comparison_required'), 'ثلاثة عروض شرط الترسية');
  p = quotes(p);
  const winner = p.quotes.find(q => q.supplier_key === 'DC-VENDOR-A').id;
  assert.throws(() => pAct('employee', p, 'award', { quote_id: winner, note: 'ترسية ذاتية' }), code('transition_denied'), 'طالب الشراء لا يرسي طلبه');
  // احتياج بمركز تكلفة لا مخصص معتمدًا له: لا ترسية، وموردوه غير مسجلين فلا تحجبه بوابة التأهيل.
  const other = quotes(pAct('employee', need({ cost_center: 'DC-CC-NONE' }), 'submit'));
  assert.throws(() => pAct('manager', other, 'award', { quote_id: other.quotes.find(q => q.supplier_key === 'DC-VENDOR-B').id, note: 'ترسية بلا مخصص' }), code('project_budget_required'), 'لا ترسية بلا مخصص مشروع معتمد وساري');
  // مورد مسجل لم يُؤهَّل بعد: البوابة تمنع الترسية عليه حتى مع ثلاثة عروض ومخصص سليم.
  // «dc-vendor-a» مسجَّل غير مؤهَّل في التجهيز أصلًا (بعد بوابة المورد صار العرض نفسه يحتاج ملفًا)،
  // فيُقرأ هنا بدل إنشاء ملف ثانٍ بالمفتاح نفسه.
  const unqualified = db.prepare("SELECT id, status FROM vendors WHERE upper(supplier_key)=upper('dc-vendor-a')").get();
  assert.equal(unqualified.status, 'draft', 'الملف مسجَّل ولم يُؤهَّل بعد');
  assert.ok(unqualified.id);
  assert.throws(() => pAct('manager', p, 'award', { quote_id: winner, note: 'ترسية على مورد لم يُؤهَّل بعد' }), code('vendor_blocked'), 'مورد مسجل غير مؤهل لا يُرسى عليه');
  assert.ok(project.id);
  assert.ok(typeof qualifyVendor === 'function');
  assert.ok(verifyAudit(db));
});

test('delivery cycle: the supplier is not received, invoiced or paid before the purchase order, and the payment needs three separate people', t => {
  const { db, users, pAct, need, quotes, qualifyVendor, readPurchase } = supplierCycle(t);
  const vendorId = qualifyVendor();
  assert.ok(vendorId);
  let p = quotes(pAct('employee', need(), 'submit'));
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-EARLY', evidence: 'استلام قبل الترسية' }), code('transition_denied'), 'لا استلام قبل الترسية');
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'DC-VENDOR-A').id, note: 'أقل سعر مطابق فنيًا ومورد مؤهل' });
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-EARLY', evidence: 'استلام قبل أمر الشراء' }), code('transition_denied'), 'لا استلام قبل أمر الشراء');
  p = pAct('manager', p, 'approve_order', { terms: 'شروط التوريد وحقوق الاستخدام المصطنعة', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء' });
  // أمر الشراء ليس إذن البدء: الاستلام يشترط أمر مباشرة ساريًا على نسخة الأمر القائمة (الترحيلان 116 و162).
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-EARLY-2', evidence: 'استلام قبل أمر المباشرة' }), code('commencement_required'), 'لا استلام قبل أمر المباشرة');
  p = pAct('manager', p, 'commence', { start_on: today(), valid_until: '2099-10-20', site_or_channel: 'موقع التصوير المصطنع', scope_confirmation: 'أكدت للمورد نطاق العمل وتاريخ البدء قبل إذن المباشرة', evidence: 'بريد إذن المباشرة المرسل للمورد ورده بالاستلام' });
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-RECEIPT-1', evidence: 'محضر استلام يوم التصوير' });
  p = pAct('employee', p, 'record_invoice', { quantity: 1, amount: '500.00', supplier_reference: 'DC-SINV-1', evidence: 'فاتورة المورد المصطنعة' });
  assert.throws(() => pAct('employee', p, 'match', { invoice_id: p.invoices[0].id, note: 'مطابقة ذاتية' }), code('transition_denied'), 'مسجل الفاتورة لا يعتمد مطابقتها');
  p = pAct('manager', p, 'match', { invoice_id: p.invoices[0].id, note: 'طابقت الأمر والاستلام والفاتورة' });
  const payable = p.payables[0];
  assert.equal(payable.amount_minor, 50000);

  let order = getOrder(db, users.employee, transaction(db, () => preparePayment(db, users.employee, { payable_id: payable.id })).id);
  const oAct = (who, values, action = 'approve_order') => transaction(db, () => paymentAction(db, users[who], order.id, action, { version: order.version, ...values }));
  assert.throws(() => oAct('employee', { note: 'اعتماد ذاتي' }), code('action_unavailable'), 'معد أمر الدفع لا يعتمده');
  order = oAct('manager', { note: 'المورد مؤهل وحسابه متحقق منه' });
  assert.throws(() => oAct('manager', { executed_on: today(), bank_reference: 'DC-BANK-X', evidence: 'توثيق ذاتي للتنفيذ المصطنع' }, 'record_execution'), code('action_unavailable'), 'من اعتمد الأمر لا يوثق تنفيذه');
  order = transaction(db, () => paymentAction(db, users.treasurer, order.id, 'record_execution', { version: order.version, executed_on: today(), bank_reference: 'DC-BANK-1', evidence: 'إشعار تحويل بنكي مصطنع محفوظ في ملف التجربة' }));
  assert.equal(order.status, 'executed');
  assert.equal(listPayables(db, users.employee).totals.executed_minor, 50000);
  assert.ok(readPurchase(p.id));
  assert.ok(verifyAudit(db));
});

/* ───── البوابات والمحاور الغائبة: مُعلَّمة لئلا يُقرأ غيابها نجاحًا ───── */

// شرطا البدء المدفوع من شروط الاتفاق المقبولة، ويقرؤهما عمود المشروع الفقري (app/project-axes.mjs، ترحيلا 116 و160):
// جدول الدفعات يعلن الدفعة المقدمة ويقول هل يلزم أمر شراء من العميل. والتنفيذ هنا نداءات المسار الحقيقي نفسه —
// تقديم مخرج للقبول، وترسية المورد، واعتماد أمر شرائه — تُفحص كلها لحظة الفعل لا مرة واحدة عند أول فعل.
const refusedBy = run => { try { run(); } catch (error) { return error; } assert.fail('نُفِّذ ما كان يجب أن يُرفض قبل اكتمال شروط البدء'); };
const shiftDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
function linkedClient(f) {
  const { db, users, grant } = f;
  grant('employee', 'clients.manage');
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  return db.prepare('SELECT * FROM clients WHERE id=?').get(f.case.client_id);
}

test('delivery cycle: execution is blocked until the advance payment is confirmed', t => {
  const f = clientCycle(t, { schedule: false }), { db, users, act, read, grant, project_id } = f;
  const tx = run => transaction(db, run);
  const client = linkedClient(f);
  for (const who of ['treasurer', 'outsider']) grant(who, 'billing.recurring.manage');
  // الاتفاق: ثلاثون بالمئة مقدمًا (345.00 من 1150.00 شاملة الضريبة) والباقي عند القبول، وأمر الشراء شرط كما هو الافتراض القائم.
  tx(() => axes.recordPaymentTerms(db, users.employee, f.case.id, { terms: [
    { label: 'الدفعة المقدمة عند توقيع الاتفاق', amount: '345.00', due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' },
    { label: 'الباقي عند قبول المخرجين', amount: '805.00', due_on: '2099-06-01', condition: 'عند قبول المخرجين', condition_kind: 'acceptance', condition_lines: [0, 1] }] }));
  const deliver = line => act('employee', read(), 'submit_delivery', { line_index: line, evidence: `تقرير إنجاز المخرج رقم ${line + 1} بمراجعه المسجلة` });
  const documents = error => error.details.refusal.missing.map(item => item.document);

  // ١. لا تسليم قبل الشرطين، والرفض يسمّي الناقصَين ومالكَيهما لا «الإجراء غير متاح».
  let error = refusedBy(() => deliver(0));
  assert.equal(error.code, 'advance_required');
  assert.deepEqual(documents(error), ['أمر شراء العميل', 'الدفعة المقدمة المؤكدة']);
  assert.deepEqual(error.details.refusal.missing.map(item => item.owner), ['الموظفة التجريبية', 'الإدارة المالية']);

  // ٢. أمر شراء العميل مؤكد من غير من سجّله: يبقى الناقص الدفعة وحدها.
  const po = tx(() => axes.recordClientPurchaseOrder(db, users.employee, f.case.id, { po_number: 'DC-PO-100', issued_on: today(), valid_until: '2099-12-31', amount: '1150.00',
    scope: 'المخرجان المتفق عليهما في الاتفاق المسجل على الملف', customer_representative: 'مدير المشتريات لدى العميل', evidence: 'نسخة أمر الشراء المصطنع محفوظة في ملف الاتفاق',
    contract_id: read().contract.id, project_id, client_id: client.id }));
  tx(() => axes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قابلنا الرقم والقيمة والصلاحية بأصل أمر الشراء' }));
  assert.deepEqual(documents(refusedBy(() => deliver(0))), ['الدفعة المقدمة المؤكدة']);

  // ٣. الإنفاق على المورد ممنوع كذلك: الترسية تُرفض قبل أن يُحجز من مخصص المشروع شيء.
  fundProject(db, project_id, 'DC-CC-9', '1000.00');
  const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  let p = pAct('employee', tx(() => createPurchase(db, users.employee, { project_id, title: 'احتياج تصوير على مشروع العميل', specification: 'يوم تصوير بطاقم ومعدات',
    cost_center: 'DC-CC-9', due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '600.00', budget_evidence: 'مخصص المشروع المعتمد', currency: 'SAR' })), 'submit');
  for (const [key, price] of [['dc-vendor-a', '500.00'], ['dc-vendor-b', '540.00'], ['dc-vendor-c', '560.00']])
    p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد ' + key, unit_price: price, technical_assessment: 'مطابق للمواصفات المسجلة', financial_terms: 'صافي 30 يومًا', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ' });
  const winner = p.quotes.find(q => q.supplier_key === 'DC-VENDOR-B').id;
  assert.equal(refusedBy(() => pAct('manager', p, 'award', { quote_id: winner, note: 'ترسية قبل قبض الدفعة المقدمة' })).code, 'advance_required');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_budget_reservations WHERE purchase_id=?').get(p.id).n, 0, 'الرفض سبق حجز المخصص');

  // ٤. تسجيل الدفعة ليس قبضها، والقبض الجزئي لا يكفي والناقص يُسمّى برقمه.
  const record = amount => tx(() => billing.recordAdvance(db, users.treasurer, { client_id: client.id, schedule_id: '', project_id,
    description: 'الدفعة المقدمة على اتفاق دورة التسليم', agreement_reference: 'بند الدفعات في الاتفاق المصطنع', amount }));
  const confirm = (row, amount, reference) => tx(() => billing.confirmAdvance(db, users.outsider, row.id, { version: 1, amount, received_on: today(), evidence: 'إشعار تحويل بنكي مصطنع مطابق للمبلغ', reference }));
  const first = record('345.00');
  assert.deepEqual(documents(refusedBy(() => deliver(0))), ['الدفعة المقدمة المؤكدة'], 'المسجَّل غير المؤكد لا يُحسب');
  confirm(first, '200.00', 'DC-TRF-001');
  error = refusedBy(() => deliver(0));
  assert.match(error.details.refusal.missing[0].why, /200\.00/);
  assert.match(error.details.refusal.missing[0].why, /345\.00/);

  // ٥. الباقي بحوالة أخرى يكمل المبلغ؛ والحوالة نفسها لا تُقبض مرتين ولو اختلفت حروفها.
  const second = record('145.00');
  assert.equal(refusedBy(() => confirm(second, '145.00', 'dc-trf-001')).code, 'duplicate_receipt_reference');
  confirm(second, '145.00', 'DC-TRF-002');
  assert.equal(deliver(0).deliveries.length, 1);
  p = pAct('manager', p, 'award', { quote_id: winner, note: 'ترسية بعد قبض الدفعة المقدمة كاملة' });
  assert.equal(p.status, 'awarded');

  // ٦. ارتدّت حوالة الـ145 بعد الترسية. الفعل التالي يُفحص من جديد لحظة وقوعه، فلا يمضي على قبضٍ لم يعد قائمًا.
  tx(() => billing.reverseAdvance(db, users.treasurer, second.id, { amount: '145.00', reason: 'ارتدت الحوالة من بنك العميل', evidence: 'إشعار ارتداد مصطنع من البنك' }));
  assert.equal(refusedBy(() => pAct('manager', p, 'approve_order', { terms: 'يوم تصوير واحد', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء بعد ارتداد الحوالة' })).code, 'advance_required');
  assert.equal(refusedBy(() => deliver(1)).code, 'advance_required');

  // ٧. قبض بديل مؤكد يعيد الجاهزية، فيمضي أمر الشراء.
  confirm(record('145.00'), '145.00', 'DC-TRF-003');
  p = pAct('manager', p, 'approve_order', { terms: 'يوم تصوير واحد', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء بعد القبض البديل' });
  assert.equal(p.status, 'ordered');
  assert.ok(verifyAudit(db));
});

// كان هذا الاختبار مُعلَّمًا skip بسبب الكسر B2. نصفه أُغلق بالترحيل 116 (أمر مباشرة بتاريخه ومن أصدره، والاستلام
// يشترطه)، والنصف الباقي بالترحيل 162: الإذن مربوط بنسخة أمر الشراء، له مدة سريان ودليل، ويُسحب ويُستبدل ولا يُمحى،
// والاستلام يعيد فحصه لحظة التسجيل. الاختبار يمشي الدورة كلها بالمسار الحقيقي، والتفاصيل السالبة في
// tests/supplier-commencement.test.mjs.
test('delivery cycle: a supplier may not start before a purchase order AND a commencement authorisation', t => {
  const { db, users, pAct, need, quotes, qualifyVendor, readPurchase } = supplierCycle(t);
  qualifyVendor();
  const later = days => new Date(Date.now() + 3 * 3600000 + days * 86400000).toISOString().slice(0, 10);
  const authorise = (overrides = {}) => ({ start_on: today(), valid_until: later(30), site_or_channel: 'موقع التصوير المصطنع',
    scope_confirmation: 'يوما تصوير بالطاقم والمعدات كما في الأمر المعتمد', evidence: 'بريد إذن المباشرة المرسل للمورد ورده بالاستلام', ...overrides });
  const receive = (p, reference) => pAct('employee', p, 'receive', { quantity: 1, reference, evidence: 'محضر استلام يوم تصوير مصطنع' });
  let p = quotes(pAct('employee', need({ quantity: 2, budget_amount: '1000.00' }), 'submit'));
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'DC-VENDOR-A').id, note: 'أقل سعر مطابق فنيًا ومورد مؤهل' });
  // قبل أمر الشراء لا إذن بدء أصلًا: الإجراء لا يظهر ولا يُقبل.
  assert.ok(!p.allowed_actions.includes('commence'));
  assert.throws(() => pAct('manager', p, 'commence', authorise()), code('transition_denied'), 'لا أمر مباشرة قبل أمر الشراء');
  p = pAct('manager', p, 'approve_order', { terms: 'يوما تصوير بطاقم ومعدات', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء' });
  // أمر الشراء وحده ليس إذن البدء: الاستلام يُرفض ويقول ما الناقص ومن يملكه.
  assert.equal(p.commencement, null);
  assert.throws(() => receive(p, 'DC-START-0'), code('commencement_required'), 'لا استلام قبل أمر المباشرة');
  assert.throws(() => pAct('employee', p, 'commence', authorise()), code('transition_denied'), 'طالب الشراء لا يأذن للمورد بالبدء على طلبه');
  // إذن يبدأ بعد يومين: السريان لم يبدأ فلا استلام اليوم.
  p = pAct('manager', p, 'commence', authorise({ start_on: later(2) }));
  const first = p.commencement;
  assert.equal(first.issued_by, 'manager');
  assert.equal(first.order_version, 1, 'الإذن مربوط بنسخة الأمر التي صدر عليها');
  assert.equal(first.valid_until, later(30));
  assert.equal(first.evidence, 'بريد إذن المباشرة المرسل للمورد ورده بالاستلام');
  assert.equal(first.validity.state, 'not_started');
  assert.throws(() => receive(p, 'DC-START-1'), code('commencement_not_started'));
  // الاستبدال سجلٌّ جديد يحل محل القائم، والأول يبقى مقروءًا بحاله.
  p = pAct('manager', p, 'replace_commencement', { ...authorise(), reason: 'قدّم المورد موعد يوم التصوير الأول إلى اليوم بطلب مكتوب' });
  assert.equal(p.commencement.replaces_id, first.id);
  assert.equal(p.commencement.validity.state, 'active');
  p = receive(p, 'DC-START-1');
  assert.equal(p.status, 'part_received');
  // تعديل الأمر نسخةٌ جديدة منه: إذن النسخة الأولى لا يكفي لاستلام ما بعد التعديل.
  const change = transaction(db, () => requestOrderChange(db, users.employee, p.id, { kind: 'delivery_date', new_delivery_date: '2099-11-20', new_terms: '',
    reason: 'طلب المورد شهرًا إضافيًا لليوم الثاني بسبب تأخر تصريح الموقع', supplier_confirmation: 'بريد المورد المصطنع بطلب التمديد' }));
  transaction(db, () => decideOrderChange(db, users.manager, change.id, 'approve', { note: 'التمديد لا يمس موعد تسليم العميل' }));
  p = readPurchase(p.id);
  assert.equal(p.order.order_version, 2);
  assert.equal(p.commencement.validity.state, 'stale');
  assert.throws(() => receive(p, 'DC-START-2'), code('commencement_stale'));
  // السحب يوقف المورد ويبقى السجل: لا إذن قائم فلا استلام.
  p = pAct('manager', p, 'withdraw_commencement', { reason: 'أوقفنا المورد حتى يُعاد تأكيد النطاق على الأمر المعدَّل', evidence: 'خطاب إيقاف مصطنع مرسل للمورد ومحفوظ في ملف الطلب' });
  assert.equal(p.commencement, null);
  assert.throws(() => receive(p, 'DC-START-2'), code('commencement_withdrawn'));
  // إذن جديد على النسخة الثانية يفتح الاستلام من جديد.
  p = pAct('manager', p, 'commence', authorise());
  assert.equal(p.commencement.order_version, 2);
  p = receive(p, 'DC-START-2');
  assert.equal(p.status, 'received');
  // التاريخ كاملًا: الأول استُبدل، والثاني سُحب، والثالث قائم — لا شيء مُحي ولا شيء عُدّل.
  assert.deepEqual(p.commencement_history.map(a => [a.sequence, a.state]), [[1, 'replaced'], [2, 'withdrawn'], [3, 'live']]);
  assert.equal(p.commencement_history[1].withdrawal.withdrawn_by, 'manager');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commencement_authorisations WHERE purchase_id=?').get(p.id).n, 3);
  const actions = db.prepare("SELECT action FROM audit_events WHERE entity_id=? AND action LIKE 'axes.commencement%' ORDER BY seq").all(p.id).map(r => r.action);
  assert.deepEqual(actions, ['axes.commencement_authorised', 'axes.commencement_replaced', 'axes.commencement_withdrawn', 'axes.commencement_authorised']);
  assert.ok(verifyAudit(db));
});

test('delivery cycle: the customer purchase order is recorded against the commercial case before execution', t => {
  const f = clientCycle(t, { schedule: false }), { db, users, act, read, project_id } = f;
  const tx = run => transaction(db, run);
  const client = linkedClient(f);
  // اتفاق بلا دفعة مقدمة: شرط البدء الوحيد أمر شراء العميل.
  tx(() => axes.recordPaymentTerms(db, users.employee, f.case.id, { terms: [
    { label: 'الدفعة الأولى عند قبول المخرج الأول', amount: '460.00', due_on: '2099-03-01', condition: 'عند قبول المخرج الأول', condition_kind: 'acceptance', condition_lines: [0] },
    { label: 'الدفعة الثانية عند قبول المخرج الثاني', amount: '690.00', due_on: '2099-06-01', condition: 'عند قبول المخرج الثاني', condition_kind: 'acceptance', condition_lines: [1] }] }));
  const deliver = line => act('employee', read(), 'submit_delivery', { line_index: line, evidence: `تقرير إنجاز المخرج رقم ${line + 1} بمراجعه المسجلة` });
  let error = refusedBy(() => deliver(0));
  assert.equal(error.code, 'advance_required');
  assert.deepEqual(error.details.refusal.missing.map(item => [item.document, item.owner]), [['أمر شراء العميل', 'الموظفة التجريبية']]);

  const contractId = read().contract.id;
  const order = (overrides = {}) => ({ po_number: 'DC-PO-200', issued_on: today(), valid_until: '2099-12-31', amount: '1150.00',
    scope: 'المخرجان المتفق عليهما في الاتفاق المسجل على الملف', customer_representative: 'مدير المشتريات لدى العميل',
    evidence: 'نسخة أمر الشراء المصطنع محفوظة في ملف الاتفاق', contract_id: contractId, project_id, client_id: client.id, ...overrides });
  const record = input => tx(() => axes.recordClientPurchaseOrder(db, users.employee, f.case.id, input));
  const confirm = (po, who = 'manager') => tx(() => axes.confirmClientPurchaseOrder(db, users[who], po.id, { version: 1, note: 'قابلنا الرقم والقيمة والصلاحية بأصل أمر الشراء' }));

  // الربط يُتحقق منه بندًا بندًا: عميل الملف واتفاقه ومشروعه، لا ما يكتبه النموذج.
  const stranger = tx(() => createClient(db, users.employee, { legal_name: 'عميل آخر مصطنع', trade_name: '', sector: 'تجريبي', status: 'active', notes: '' }));
  assert.equal(refusedBy(() => record(order({ client_id: stranger.id }))).code, 'wrong_client');
  assert.equal(refusedBy(() => record(order({ contract_id: randomUUID() }))).code, 'wrong_agreement');
  assert.equal(refusedBy(() => record(order({ project_id: randomUUID() }))).code, 'wrong_project');

  // النسخة الأولى: التسجيل ليس تأكيدًا، ومن سجّلها لا يؤكدها.
  const first = record(order());
  assert.equal(first.revision, 1);
  assert.equal(refusedBy(() => deliver(0)).code, 'advance_required');
  assert.equal(refusedBy(() => confirm(first, 'employee')).code, 'self_approval');
  confirm(first);
  assert.equal(deliver(0).deliveries.length, 1);

  // تعديل العميل نسخة جديدة تحل محل المؤكدة، لا أمر ثانٍ بجانبها. والجديدة بصلاحية منتهية: لا تغطي ولو أُكّدت.
  assert.equal(refusedBy(() => record(order({ amount: '1265.00' }))).code, 'purchase_order_exists');
  const amended = record(order({ supersedes_id: first.id, amount: '1265.00', issued_on: shiftDays(today(), -40), valid_until: shiftDays(today(), -1),
    evidence: 'تعديل أمر الشراء بزيادة الكمية محفوظ في ملف الاتفاق' }));
  assert.equal(amended.revision, 2);
  assert.match(refusedBy(() => deliver(1)).details.refusal.missing[0].why, /النسخة 2/, 'المؤكدة القديمة لا تغطي بعد أن حُلّ محلها');
  confirm(amended);
  assert.match(refusedBy(() => deliver(1)).details.refusal.missing[0].why, /انتهت صلاحيتها/);

  // التمديد نسخة ثالثة، وبتأكيدها وحدها يمضي التنفيذ.
  const extended = record(order({ supersedes_id: amended.id, amount: '1265.00', evidence: 'تمديد صلاحية أمر الشراء محفوظ في ملف الاتفاق' }));
  confirm(extended);
  assert.equal(deliver(1).deliveries.length, 2);
  assert.deepEqual(read().readiness.client_purchase_order.history.map(version => [version.revision, version.status]), [[1, 'confirmed'], [2, 'confirmed'], [3, 'confirmed']]);
  assert.ok(verifyAudit(db));
});

// كان مُعلَّمًا skip (الكسر B2): «لا إجراء إقفال ولا حالة». بنى الترحيل 116 الإقفال صفًا متغيرًا يسمح بالمالي قبل الفني،
// وجعله الترحيل 163 سجلات ثابتة بقائمتي تحقق. هنا تمشي الدورة كلها من مساراتها الحقيقية: تسليم وقبول، واستحقاق وفاتورة
// وتحصيل، وشهادة إنجاز، وقيود مرحّلة، ثم الفني، ثم هامش يقبله غير من يقفل، ثم المالي، ثم النهائي — كل خطوة بيد صاحبها.
test('delivery cycle: a project can be closed technically and then financially', t => {
  const { db, users, act, read, finance, grant, project_id } = clientCycle(t);
  const tx = run => transaction(db, run);
  // ثلاث أيدٍ للإقفال: مدير الفريق (فتح المشروع) يقفل فنيًا، وموظفة الموارد بتصريح الربحية تقبل الهامش،
  // وأمين الخزينة بتفويض الاعتماد المالي يقفل ماليًا. لا يد تقبل ما تقفل عليه.
  finance('treasurer', ['read', 'approve', 'post']);
  finance('employee', ['configure']);
  grant('hr', 'profitability.view');
  let c = read();
  for (const index of [0, 1]) {
    c = act('employee', c, 'submit_delivery', { line_index: index, evidence: `تقرير إنجاز المخرج ${index + 1} بمراجعه المسجلة` });
    const pending = c.deliveries.find(d => d.line_index === index && d.review?.status === 'pending');
    c = act('manager', c, 'accept_delivery', { delivery_id: pending.id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول مصطنع محفوظ في أرشيف التجربة', approver_id: approverFor(db, c.project_id) });
  }
  // المالي قبل الفني مرفوض باسمه، ولا يُكتب شيء.
  assert.throws(() => tx(() => axes.closeFinancially(db, users.treasurer, project_id, { note: 'محاولة إقفال مالي قبل الإقفال الفني للمشروع', decisions: [] })), code('technical_closure_required'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_closure_records WHERE project_id=?').get(project_id).n, 0);

  // لكل مخرج: استحقاق معتمد، وفاتورة صادرة، وقبض مطابق بيد غير مسجّله.
  const profile = tx(() => recordCompanyProfile(db, users.employee, { legal_name: 'منشأة مصطنعة', vat_number: '310000000000003', cr_number: '1010000001', address: { building: '1234', street: 'شارع', district: 'حي', city: 'الرياض', postal_code: '12345', country: 'SA' }, effective_from: '2026-01-01' }));
  tx(() => approveCompanyProfile(db, users.manager, profile.id, { note: 'طوبقت البيانات الضريبية للمنشأة' }));
  tx(() => recordCustomerProfile(db, users.employee, { case_id: c.id, legal_name: 'عميل مصطنع', vat_number: '300000000000003', address: { building: '5678', street: 'شارع', district: 'حي', city: 'الرياض', postal_code: '54321', country: 'SA' }, source: 'عقد العميل المصطنع' }));
  const documents = [];
  for (const delivery of c.deliveries) {
    const amount = (Number(c.current_quote.snapshot.lines[delivery.line_index].total_minor) / 100).toFixed(2);
    let claim = tx(() => createClaim(db, users.employee, { delivery_id: delivery.id, amount, due_date: '2099-12-15', entitlement_evidence: 'محضر القبول وبند العقد المقابل للاستحقاق' }));
    claim = tx(() => claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
    claim = tx(() => claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'طوبق القبول وبند العقد' }));
    let invoice = tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: today(), vat_category: 'standard', vat_reason: '' }));
    invoice = tx(() => invoiceAction(db, users.employee, invoice.id, 'submit', { version: 1, note: '' }));
    invoice = tx(() => invoiceAction(db, users.manager, invoice.id, 'issue', { version: invoice.version, note: 'طوبقت الأرقام والبيانات' }));
    const receipt = tx(() => recordReceipt(db, users.employee, claim.id, { reference: `DC-CLOSE-${delivery.line_index}`, amount, received_on: today(), payer: 'عميل مصطنع', evidence: 'إشعار تحويل مصطنع محفوظ للمراجعة' }));
    tx(() => receiptAction(db, users.manager, claim.id, receipt.id, 'confirm', { note: 'طوبق الإشعار بكشف الحساب', matching_evidence: 'كشف بنكي مصطنع يظهر الحركة' }));
    documents.push(['tax_invoice', invoice.id], ['ar_receipt', receipt.id]);
  }

  // شهادة الإنجاز (الترحيل 164): يصدرها مدير المشروع باسم ممثل عميل مفوَّض من سجل المفوّضين، ويسجّل قبول العميل لها
  // بقناته عضوٌ غير من أصدرها وغير من قبل مخرجاتها.
  const approver = tx(() => registerApprover(db, users.pm, { project_id, name: 'مفوض استلام مصطنع', title: 'مدير المشاريع لدى العميل',
    authority_basis: 'البند 9 من العقد المصطنع يسميه مفوضًا بقبول الإنجاز', authority_scope: 'قبول المخرجات وشهادة الإنجاز', valid_from: '2026-01-01' }));
  const certificate = tx(() => axes.issueCompletionCertificate(db, users.manager, project_id, { scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق المصطنع', approver_id: approver.id, evidence: 'محضر إنجاز مصطنع محفوظ في ملف المشروع' }));
  tx(() => axes.acknowledgeCompletionCertificate(db, users.pm, certificate.id, { version: certificate.version, channel: 'email', received_on: today(), evidence: 'رسالة بريد مصطنعة من مفوض العميل تقبل الشهادة' }));

  // الإقفال الفني على القائمة كما راجعها مديره، وسجله يحفظها كما قُيِّمت.
  const reviewed = axes.axesFor(db, users.manager, project_id).axes.closure;
  assert.deepEqual(reviewed.technical_outstanding, []);
  const technical = tx(() => axes.closeTechnically(db, users.manager, project_id, { note: 'سُلّم المخرجان وقُبلا ووُثّقت شهادة الإنجاز', decisions: [], checklist_digest: reviewed.technical_digest }));
  assert.equal(technical.state, 'closed_technically');
  const [technicalRecord] = technical.records;
  assert.equal(technicalRecord.lock, 'technical');
  assert.deepEqual(technicalRecord.checklist.lines.map(l => [l.key, l.status]), [['deliverables', 'clear'], ['defects', 'clear'], ['work_packages', 'clear'], ['tasks', 'clear'], ['evidence', 'clear']]);
  const kept = technicalRecord.checklist.lines.find(l => l.key === 'evidence').evidence.certificate;
  assert.equal(kept.number, certificate.number);
  assert.equal(kept.acceptance.channel, 'email', 'قبول العميل بقناته محفوظ في سجل الإقفال نفسه');
  assert.equal(kept.approver.name, 'مفوض استلام مصطنع');

  // قبل الدفتر: كل فاتورة وقبض على المشروع بلا قيد مرحّل بندٌ باقٍ باسمه، والهامش لم يُقبل.
  let refusal;
  try { tx(() => axes.closeFinancially(db, users.treasurer, project_id, { note: 'محاولة إقفال مالي قبل ترحيل قيود المشروع', decisions: [] })); } catch (error) { refusal = error; }
  assert.equal(refusal.code, 'document_not_journalized');
  const missing = refusal.details.refusal.missing.map(m => m.doc_key);
  assert.deepEqual(missing.filter(ref => ref.startsWith('journal:')).sort(), documents.map(([kind, id]) => `journal:${kind}:${id}`).sort());
  assert.ok(missing.includes('margin'), 'نتيجة الهامش لم تُقبل بعد، ولا تُطوى بقرار');

  // الدفتر: قيد من كل مستند، يعدّه موظف ويعتمده مدير ويرحّله أمين الخزينة.
  const reference = (kind, input) => tx(() => createFinanceReference(db, users.employee, kind, input));
  const accounts = Object.fromEntries([['receivable', '1100', 'ذمم العملاء', 'asset'], ['revenue', '4000', 'إيراد الخدمات', 'income'], ['output_vat', '2200', 'ضريبة مخرجات', 'liability'], ['bank', '1000', 'البنك', 'asset']]
    .map(([purpose, number, name, type]) => [purpose, reference('accounts', { code: number, name, account_type: type, currency: 'SAR' })]));
  const center = reference('cost_centers', { code: 'DC-GEN', name: 'مركز دورة التسليم' });
  const period = reference('periods', { name: 'سنة دورة التسليم', starts_on: `${today().slice(0, 4)}-01-01`, ends_on: `${today().slice(0, 4)}-12-31` });
  for (const [purpose, account] of Object.entries(accounts)) {
    const mapping = tx(() => recordMapping(db, users.employee, { purpose, account_id: account.id, cost_center_id: center.id, effective_from: '2026-01-01' }));
    tx(() => approveMapping(db, users.manager, mapping.id, { note: 'طابقت الحساب مع دليل الحسابات' }));
  }
  for (const [kind, sourceId] of documents) {
    let journal = tx(() => journalFromSource(db, users.employee, { source_kind: kind, source_id: sourceId, period_id: period.id }));
    for (const [who, action] of [['employee', 'submit'], ['manager', 'approve'], ['treasurer', 'post']]) journal = tx(() => journalAction(db, users[who], journal.id, action, { version: journal.version, note: 'دليل قرار مالي مصطنع' }));
    assert.equal(journal.status, 'posted');
  }

  // الهامش: يراه ويقبله حامل تصريح الربحية وحده، على الرقم الذي رآه.
  const forHr = axes.closureBoard(db, users.hr).projects.find(p => p.id === project_id).closure.margin;
  assert.equal(forHr.visible, true);
  assert.equal(forHr.figures.revenue_net_minor, 100000, 'صافي الفاتورتين بلا ضريبة');
  assert.equal(forHr.figures.planned.margin_minor, 75000, 'الهامش المخطط من خط أساس العقد');
  assert.equal(axes.axesFor(db, users.pm, project_id).axes.closure.margin.figures, undefined, 'عضو المشروع لا يرى الرقم');
  tx(() => axes.acceptMargin(db, users.hr, project_id, { figures_digest: forHr.digest, note: 'الهامش الفعلي أعلى من المخطط لأن التجربة لم تسجل ساعات ولا مشتريات' }));

  // الإقفال المالي: لا باقٍ، وكل بند العقد مسجل من مصدره، وما لا مصدر له مسمّى بسببه.
  const ready = axes.closureBoard(db, users.treasurer).projects.find(p => p.id === project_id).closure;
  assert.deepEqual(ready.financial_outstanding, []);
  const financial = tx(() => axes.closeFinancially(db, users.treasurer, project_id, { note: 'حُصّل كل استحقاق ورُحّلت قيوده وقُبل الهامش', decisions: [], checklist_digest: ready.financial_digest }));
  assert.equal(financial.state, 'awaiting_final');
  const financialRecord = financial.records.find(r => r.lock === 'financial');
  assert.deepEqual(financialRecord.checklist.lines.map(l => l.key), ['technical', 'receivables', 'supplier_liabilities', 'expenses', 'advances', 'assets', 'journals', 'taxes', 'credits', 'refunds', 'margin']);
  assert.ok(financialRecord.checklist.lines.every(l => l.status === 'clear'));
  assert.equal(financialRecord.checklist.lines.find(l => l.key === 'journals').checked, documents.length);
  assert.ok(financialRecord.checklist.lines.filter(l => l.not_applicable.length).length >= 5, 'ما لا مصدر له في المنصة مسمّى بسببه لا مسكوت عنه');
  assert.equal(financialRecord.checklist.lines.find(l => l.key === 'margin').evidence.accepted_by_name, users.hr.name);

  // بعد الإقفال المالي لا مستند مالي جديد على المشروع إلا بإعادة فتحه.
  assert.throws(() => tx(() => submitClaim(db, users.employee, { expense_date: today(), category: 'transport', description: 'مواصلات مصطنعة بعد الإقفال المالي', amount: '50.00', receipt_reference: 'DC-LATE-1', custody_id: '', project_id })), code('project_financially_closed'));

  const closed = tx(() => axes.closeFinally(db, users.manager, project_id, { version: financial.version, profitability_note: 'الهامش الفعلي أعلى من المخطط لأن التكلفة لم تُحمَّل ساعات في التجربة', lessons: 'توثيق الشهادة قبل الفوترة سهّل الإقفالين الفني والمالي' }));
  assert.equal(closed.state, 'closed');
  assert.deepEqual(closed.records.map(r => [r.lock, r.in_force]), [['technical', true], ['financial', true], ['final', true]]);
  assert.equal(read().status, 'project_active', 'الإقفال محوره، والحالة التجارية لا تُعاد كتابتها');
  assert.ok(verifyAudit(db));
});

// كان هذا الاختبار مُعلَّمًا skip بسبب الكسر B6. أُصلح الكسر: stateData تقرأ الحالتين من مصدرهما،
// فصار الاختبار حيًا ويحرس ألا تعود شاشة المشتريات تقول «غير مدفوع» بعد تنفيذ التحويل.
test('delivery cycle: paying the supplier marks the purchase as paid, read from payment_orders not from a constant', t => {
  const { db, users, pAct, need, quotes, qualifyVendor, readPurchase } = supplierCycle(t);
  qualifyVendor();
  let p = quotes(pAct('employee', need(), 'submit'));
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'DC-VENDOR-A').id, note: 'أقل سعر مطابق فنيًا ومورد مؤهل' });
  p = pAct('manager', p, 'approve_order', { terms: 'شروط التوريد وحقوق الاستخدام المصطنعة', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء' });
  // أمر الشراء ليس إذن البدء: الاستلام يشترط أمر مباشرة ساريًا على نسخة الأمر القائمة (الترحيلان 116 و162).
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-EARLY-2', evidence: 'استلام قبل أمر المباشرة' }), code('commencement_required'), 'لا استلام قبل أمر المباشرة');
  p = pAct('manager', p, 'commence', { start_on: today(), valid_until: '2099-10-20', site_or_channel: 'موقع التصوير المصطنع', scope_confirmation: 'أكدت للمورد نطاق العمل وتاريخ البدء قبل إذن المباشرة', evidence: 'بريد إذن المباشرة المرسل للمورد ورده بالاستلام' });
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'DC-RECEIPT-1', evidence: 'محضر استلام يوم التصوير' });
  p = pAct('employee', p, 'record_invoice', { quantity: 1, amount: '500.00', supplier_reference: 'DC-SINV-1', evidence: 'فاتورة المورد المصطنعة' });
  p = pAct('manager', p, 'match', { invoice_id: p.invoices[0].id, note: 'طابقت الأمر والاستلام والفاتورة' });
  const payable = p.payables[0];

  // قبل أي أمر دفع: «غير مدفوع» — وهي هنا قراءة صادقة لا نص ثابت.
  assert.equal(readPurchase(p.id).payment_status, 'not_paid');
  assert.equal(readPurchase(p.id).payables[0].payment_status, 'not_paid');
  assert.equal(readPurchase(p.id).paid_minor, 0);

  let order = getOrder(db, users.employee, transaction(db, () => preparePayment(db, users.employee, { payable_id: payable.id })).id);
  assert.equal(readPurchase(p.id).payment_status, 'payment_pending', 'أمر دفع مُعد ولم يُعتمد: الشاشة تقولها ولا تدّعي السداد');
  order = transaction(db, () => paymentAction(db, users.manager, order.id, 'approve_order', { version: order.version, note: 'المورد مؤهل وحسابه متحقق منه' }));
  assert.equal(readPurchase(p.id).payment_status, 'payment_approved', 'معتمد ليس منفَّذًا: البنك لم يحوّل بعد');
  assert.equal(readPurchase(p.id).paid_minor, 0);

  order = transaction(db, () => paymentAction(db, users.treasurer, order.id, 'record_execution', { version: order.version, executed_on: today(), bank_reference: 'DC-BANK-PAID', evidence: 'إشعار تحويل بنكي مصطنع محفوظ في ملف التجربة' }));
  assert.equal(order.status, 'executed');
  const paid = readPurchase(p.id);
  // جوهر الكسر: بعد توثيق التحويل، الوحدتان تقولان الشيء نفسه عن الحدث نفسه.
  assert.equal(paid.payment_status, 'paid', 'بعد تنفيذ التحويل لا تقول شاشة المشتريات «غير مدفوع»');
  assert.equal(paid.payables[0].payment_status, 'paid');
  assert.equal(paid.paid_minor, 50000);
  assert.equal(paid.payables[0].payment_order.bank_reference, 'DC-BANK-PAID');
  assert.equal(listPayables(db, users.employee).totals.executed_minor, paid.paid_minor, 'المشتريات والمدفوعات على الرقم نفسه');
  // الترحيل محور مستقل عن السداد: دفعةٌ منفَّذة بلا قيد تبقى «غير مرحّلة»، ولا يُخلط المحوران.
  assert.equal(paid.posting_status, 'not_posted');
  assert.equal(paid.payables[0].journal_id, null);
  assert.ok(verifyAudit(db));
});

// كان هذا الاختبار مُعلَّمًا skip بسبب الكسر B7 («لا مفهوم حزمة عمل بإدارة مسؤولة»، 20 سبتمبر). السبب تقادم:
// حزم العمل بإدارتها ومرحلتها ومسؤولها في 116، والمشاركة بقرار رئيس الإدارة المستقبلة في 142، والعمق — المساهمون
// والتبعيات بلا حلقة والتسليم بدليل — في 165. والاختبار يمرّ الآن بالمسار التجاري الحقيقي نفسه (clientCycle).
test('delivery cycle: work packages can be planned for more than one department', t => {
  const { db, users, project_id: projectId } = clientCycle(t);
  const axesTx = f => transaction(db, f);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES" +
    "('dc-ops-head','36t','ops','dc-ops-head','رئيس تشغيل مصطنع','unused','manager',NULL)," +
    "('dc-ops-crew','36t','ops','dc-ops-crew','فنّي تشغيل مصطنع','unused','employee','dc-ops-head')");
  const who = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  // الإدارة الأخرى لا تُضاف بقرار الطالب: موظفها يُرد قبل أن يقرر رئيسها.
  assert.throws(() => axesTx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'dc-ops-crew', basis: 'فنّي التصوير' })), code('department_not_linked'));
  const request = axesTx(() => axes.requestDepartmentParticipation(db, users.manager, projectId, { department_id: 'ops', basis: 'بند التصوير في الاتفاق من تنفيذ إدارة التشغيل' }));
  axesTx(() => axes.decideDepartmentParticipation(db, who('dc-ops-head'), request.id, 'accept_participation', { version: 1, note: 'راجعت التشغيل النطاق وقبلت المشاركة' }));
  for (const id of ['dc-ops-head', 'dc-ops-crew']) axesTx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: id, basis: 'عضو حزمة التصوير' }));
  // حزمتان لإدارتين، كلٌّ بمسؤولٍ منها، وتبعيةٌ بينهما — والحلقة مرفوضة.
  const identity = axesTx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'DC-1', title: 'حزمة الهوية', department_id: 'creative', phase: 'production',
    objective: 'إنتاج الهوية حتى اعتمادها من العميل', lead_id: 'manager', planned_start: '2026-10-01', planned_end: '2026-11-01',
    acceptance_criteria: 'اعتماد العميل للهوية بمحضر مكتوب', deliverables: ['دليل الهوية'] }));
  const shoot = axesTx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'DC-2', title: 'حزمة التصوير', department_id: 'ops', phase: 'production',
    objective: 'تصوير المواد الحركية للهوية', lead_id: 'dc-ops-head', planned_start: '2026-10-15', planned_end: '2026-12-01' }));
  axesTx(() => axes.addWorkPackageDependency(db, users.manager, shoot.id, { depends_on_id: identity.id, basis: 'التصوير يبدأ بعد اعتماد الهوية' }));
  assert.throws(() => axesTx(() => axes.addWorkPackageDependency(db, users.manager, identity.id, { depends_on_id: shoot.id, basis: 'حلقة' })), code('dependency_cycle'));
  // التكليف عبر الإدارات لمساهمٍ مسجّل، وتصاريحه قبل المساهمة وبعدها واحدة.
  const before = [...capabilitiesFor(db, who('dc-ops-crew')).list].sort();
  axesTx(() => axes.addWorkPackageContributor(db, users.manager, identity.id, { user_id: 'dc-ops-crew', contribution: 'تصوير لقطات الهوية الحركية' }));
  assert.deepEqual([...capabilitiesFor(db, who('dc-ops-crew')).list].sort(), before, 'المساهمة لا تمنح تصريحًا');
  const board = axes.axesFor(db, users.manager, projectId);
  assert.deepEqual(board.work_packages.map(p => [p.code, p.department_id, p.lead_id]), [['DC-1', 'creative', 'manager'], ['DC-2', 'ops', 'dc-ops-head']]);
  assert.deepEqual(board.work_packages.find(p => p.code === 'DC-1').contributors.map(c => [c.user_id, c.department_id]), [['dc-ops-crew', 'ops']]);
  assert.deepEqual(board.work_packages.find(p => p.code === 'DC-2').depends_on.map(d => d.code), ['DC-1']);
  assert.ok(verifyAudit(db));
});

// كان هذا الاختبار مُعلَّمًا skip بسبب الكسر B8. أُصلح الكسر: app/finance-grants.mjs ومساراه
// /api/finance-grants. الاختبار يحرس المسار وقاعدة الشخصين والانتهاء والسحب وأن المالية تُفتح فعلًا.
test('delivery cycle: a finance delegation is granted, expires and is revoked through the platform, never by a direct insert', t => {
  const f = base(t, 'synthetic-delivery-cycle-grants');
  const { db, users, grant } = f;
  const act = (who, input) => transaction(db, () => grantFinanceAction(db, users[who], input));
  // 2099-01-01 كان راحةَ تهيئة لا تأكيدًا: ما يؤكده الاختبار هو قاعدة الشخصين وقيد الأدوار والسند والسحب،
  // ولا سطر فيه يقول إن تفويضًا لثلاثة وسبعين عامًا مقبول. ومع سقف الصلاحية المالية
  // (MAX_FINANCE_AUTHORITY_DAYS في app/finance-grants.mjs) صار مرفوضًا، فالمدة تُكتب داخل الأفق. التأكيدات كما هي.
  // والمدة نسبية لليوم لا تاريخًا مكتوبًا: «حتى 2026-12-01» كان يجعل الاختبار يسقط من نفسه في ديسمبر، والتفويض المنتهي ليس ما يُختبر هنا.
  const span = { valid_from: riyadhToday(Date.now() - 30 * 86400000), valid_until: riyadhToday(Date.now() + 300 * 86400000) };
  const why = 'قرار تفويض مالي مصطنع محفوظ في ملف التجربة';

  // قاعدة قبل كل شيء: بلا تفويض، المالية مقفلة — وهذا ما يجعل غياب المسار كسرًا لا نقصًا.
  assert.deepEqual(financeCapabilities(db, users.employee), []);
  assert.throws(() => listFinance(db, users.employee), code('financial_access_denied'));

  // التصريح حساس: لا يفتحه دور ولا امتياز، بل منح صريح.
  assert.throws(() => act('manager', { user_id: 'employee', action: 'read', ...span, evidence: why }), code('not_permitted'), 'المنح لحامل تصريح المنح وحده');
  grant('manager', 'finance.grants.manage');

  assert.throws(() => act('manager', { user_id: 'manager', action: 'read', ...span, evidence: why }), code('two_person'), 'لا أحد يفوّض نفسه');
  assert.throws(() => act('manager', { user_id: 'hr', action: 'read', ...span, evidence: why }), code('granted_role'), 'القيد يحصر التفويض في أدوار موظف ومدير ومدير مشروع');
  assert.throws(() => act('manager', { user_id: 'employee', action: 'read', valid_from: '2020-01-01', valid_until: '2020-06-01', evidence: why }), code('valid_until'), 'تفويض منتهٍ لا يُنشأ');
  assert.throws(() => act('manager', { user_id: 'employee', action: 'invent', ...span, evidence: why }), code('action'));
  assert.throws(() => act('manager', { user_id: 'employee', action: 'read', ...span, evidence: 'قصير' }), code('invalid_text'), 'لا تفويض بلا سند مكتوب');

  const granted = act('manager', { user_id: 'employee', action: 'read', ...span, evidence: why });
  assert.ok(granted.id);
  // الأثر الحقيقي: المالية فُتحت من المنصة، لا بإدراج SQL.
  assert.deepEqual(financeCapabilities(db, users.employee), ['read']);
  assert.ok(listFinance(db, users.employee).accounts);
  assert.throws(() => act('manager', { user_id: 'employee', action: 'read', ...span, evidence: why }), code('already_granted'), 'تفويض يغطي المدة نفسها لا يُكرر');

  const board = financeGrantsBoard(db, users.manager);
  const row = board.grants.find(g => g.id === granted.id);
  assert.equal(row.state, 'live');
  assert.equal(row.granted_by_name, users.manager.name);
  assert.equal(row.evidence, why);
  assert.equal(board.live_count, 1);
  assert.ok(board.role_constraint.detail.includes('ترحيل 007'), 'اللوحة تسمّي القيد الذي يمنع أدوارًا بدل أن تخفيه');
  assert.throws(() => financeGrantsBoard(db, users.employee), code('not_permitted'), 'اللوحة نفسها خلف التصريح');

  // السحب: يوقف الفعل من لحظته، ولا يمحو السجل (مُشغِّل ترحيل 007 يمنع الحذف).
  transaction(db, () => revokeFinanceGrant(db, users.manager, granted.id, { reason: 'انتهت مهمة التجربة المصطنعة' }));
  assert.deepEqual(financeCapabilities(db, users.employee), []);
  assert.throws(() => transaction(db, () => revokeFinanceGrant(db, users.manager, granted.id, { reason: 'سحب مكرر للتجربة' })), code('already_revoked'));
  const after = financeGrantsBoard(db, users.manager).grants.find(g => g.id === granted.id);
  assert.equal(after.state, 'revoked');
  assert.ok(after.revoked_at, 'السجل باقٍ بتاريخ سحبه');
  assert.throws(() => db.prepare('DELETE FROM finance_grants WHERE id=?').run(granted.id), /retain history/);
  assert.ok(verifyAudit(db));
});

// كان هذا الاختبار مُعلَّمًا skip بسبب الكسر B9، وسببه المكتوب («لا مستند مرقّم ولا حالة») سبق الترحيل 116 الذي بنى
// الشهادة مستندًا مرقّمًا بحالة. الفجوات الباقية فعلًا أغلقها الترحيل 164: ممثل العميل اسمٌ حرّ بلا سند تفويض، وقبول العميل
// نصٌّ بلا قناة ولا حدّ، والشهادة الصادرة تُعدَّل بـUPDATE. والعنوان القديم («يوقّعها العميل») ادّعاءٌ لا تملكه المنصة: لا آلية
// توقيع معتمدة فيها ولا دخول للعميل، فالاختبار يثبت العكس صراحةً — القبول دليلٌ خارجي أدخله موظف بحدّه المكتوب.
test('delivery cycle: the completion certificate is a numbered, versioned record, and the client acceptance is employee-entered evidence with its stated limit, never a signature', t => {
  const { db, users, act, read, project_id } = clientCycle(t);
  let c = read();
  for (const line_index of [0, 1]) {
    c = act('employee', c, 'submit_delivery', { line_index, evidence: `تقرير إنجاز المخرج ${line_index + 1} بمراجعه المسجلة` });
    const delivery = c.deliveries.find(d => d.line_index === line_index && d.review?.status === 'pending');
    c = act('manager', c, 'accept_delivery', { delivery_id: delivery.id, note: 'مطابق لمعيار القبول', acceptance_evidence: `محضر قبول المخرج ${line_index + 1} المصطنع`, approver_id: approverFor(db, c.project_id) });
  }
  // ممثل العميل من سجل المفوضين بسند تفويضه، لا اسمًا يُكتب في خانة حرة.
  const approver = transaction(db, () => registerApprover(db, users.pm, { project_id, name: 'مفوض استلام مصطنع', title: 'مدير المشاريع لدى العميل',
    authority_basis: 'البند 9 من العقد المصطنع يسميه مفوضًا بقبول الإنجاز', authority_scope: 'قبول المخرجات وشهادة الإنجاز', valid_from: '2026-01-01' }));
  let certificate = transaction(db, () => axes.issueCompletionCertificate(db, users.manager, project_id, {
    scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق', approver_id: approver.id, evidence: 'تقرير إنجاز المشروع المصطنع رقم DC-CR-1' }));
  assert.equal(certificate.number, 'CERT-00001');
  assert.equal(certificate.revision, 1);
  assert.equal(certificate.state, 'issued');
  assert.equal(certificate.project.id, project_id);
  assert.match(certificate.issued_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(certificate.issued_by_name, users.manager.name, 'المسجّل الداخلي باسمه');
  assert.equal(certificate.evidence, 'تقرير إنجاز المشروع المصطنع رقم DC-CR-1');
  // المخرجات مربوطة بتقرير إنجاز كل مخرج ومحضر قبوله، لا بعددها وحده.
  assert.deepEqual(certificate.deliverables.map(d => d.description), ['المخرج الأول', 'المخرج الثاني']);
  assert.match(certificate.deliverables[0].completion_report, /تقرير إنجاز المخرج 1/);
  assert.match(certificate.deliverables[1].acceptance_minutes, /محضر قبول المخرج 2/);
  assert.equal(certificate.client_representative.name, 'مفوض استلام مصطنع');
  assert.match(certificate.client_representative.authority_basis, /البند 9/);
  // لا توقيع: الحقل صريح والجملة مكتوبة على السجل نفسه.
  assert.equal(certificate.electronic_signature, false);
  assert.match(certificate.signature_statement, /ما فيه توقيع إلكتروني/);

  // قبول العميل بالبريد: دليل خارجي أدخله موظف غير من أصدر الشهادة، وحدّه مكتوب في السجل.
  certificate = transaction(db, () => axes.acknowledgeCompletionCertificate(db, users.pm, certificate.id, { version: certificate.version,
    channel: 'email', received_on: today(), evidence: 'رسالة بريد مصطنعة من مفوض العميل تقبل الشهادة CERT-00001' }));
  assert.equal(certificate.state, 'accepted');
  assert.equal(certificate.acceptance.channel, 'email');
  assert.equal(certificate.acceptance.source, 'employee_entered_external_evidence');
  assert.equal(certificate.acceptance.recorded_by_name, users.pm.name);
  assert.match(certificate.acceptance.limitation, /مو توقيع إلكتروني/);
  assert.equal(certificate.electronic_signature, false, 'القبول الموثّق لا يصير توقيعًا');

  // الصادر لا يُعدَّل ولا يُحذف في SQL، ولا قبوله.
  assert.throws(() => db.prepare('UPDATE completion_certificates SET scope_summary=? WHERE id=?').run('تعديل صامت على شهادة صادرة', certificate.id), /never edited/);
  assert.throws(() => db.prepare('DELETE FROM completion_certificates WHERE id=?').run(certificate.id), /retained/);
  assert.throws(() => db.prepare("UPDATE completion_certificate_acceptances SET channel='call' WHERE certificate_id=?").run(certificate.id), /never edited/);

  // التصحيح نسخة جديدة برقمها تشير إلى ما صحّحته، والسابقة تبقى كما صدرت.
  const corrected = transaction(db, () => axes.correctCompletionCertificate(db, users.manager, certificate.id, { version: certificate.version,
    reason: 'ملخص الإنجاز أغفل ذكر النسخة النهائية للمخرج الثاني', scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق، والثاني بنسخته النهائية',
    approver_id: approver.id, evidence: 'تقرير إنجاز المشروع المصطنع رقم DC-CR-1' }));
  assert.equal(corrected.number, 'CERT-00002');
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.supersedes.number, 'CERT-00001');
  assert.equal(corrected.state, 'issued', 'النسخة الجديدة تنتظر قبول العميل من جديد');
  const previous = axes.getCompletionCertificate(db, users.manager, certificate.id);
  assert.equal(previous.state, 'superseded');
  assert.equal(previous.superseded_by.number, 'CERT-00002');
  assert.equal(previous.scope_summary, 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق', 'الصادر يبقى كما صدر');
  assert.ok(verifyAudit(db));
});

// السقف الأعلى للصلاحية المالية: كان الباب يقبل أي نهاية في المستقبل، فيصير التفويض المالي دائمًا
// عبر بابٍ بُني للمؤقت («يُمنح بتاريخ انتهاء»)، يُنبَّه عنه مرة عند منحه ثم لا يراجعه أحد بعدها.
test('التفويض المالي له سقف مدة، ورقمه هو ما تستعمله المنصة فعلًا لا رقم مستعار', t => {
  const f = base(t, 'synthetic-finance-grant-cap');
  const { db, users, grant } = f;
  const act = (input) => transaction(db, () => grantFinanceAction(db, users.manager, input));
  const why = 'قرار تفويض مالي مصطنع محفوظ في ملف التجربة';
  grant('manager', 'finance.grants.manage');
  const plus = days => new Date(Date.parse('2026-01-01T00:00:00.000Z') + days * 86400000).toISOString().slice(0, 10);
  assert.throws(() => act({ user_id: 'employee', action: 'read', valid_from: '2026-01-01', valid_until: '2099-01-01', evidence: why }),
    e => e.code === 'valid_until' && /التفويض الدائم صلاحية لا تفويض/.test(e.message));
  assert.throws(() => act({ user_id: 'employee', action: 'read', valid_from: '2026-01-01', valid_until: plus(MAX_FINANCE_AUTHORITY_DAYS + 1), evidence: why }), code('valid_until'));
  // السنة الكاملة تمر: هي مدة كل تفويض مالي سارٍ على قاعدة التشغيل اليوم، فسقفٌ يرفضها تضييق لم يطلبه أحد.
  assert.equal(MAX_FINANCE_AUTHORITY_DAYS, 365);
  assert.ok(act({ user_id: 'employee', action: 'read', valid_from: '2026-01-01', valid_until: plus(MAX_FINANCE_AUTHORITY_DAYS), evidence: why }).id);
  assert.ok(verifyAudit(db));
});
