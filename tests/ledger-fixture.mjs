// شهر مصطنع كامل للدفتر (الحزمة 3 — اكتمال الأستاذ العام): فاتورة مورد مطابقة بضريبتها ودفعتها، وفاتورة عميل وقبضها،
// ودفعة مقدمة وسحبها وارتدادها — كلها بالمسارات الحقيقية لا بصفوف مكتوبة باليد، حتى يقيس الاختبار ما يجري في المنصة.
// الاستثناء الوحيد مسمّى في موضعه: مخصص ثانٍ لبند الشراء نفسه، لأن المشتريات اليوم ترفض مركزين في طلب واحد
// والجدول (الترحيل 140) يقبلهما، والدفتر يجب أن يحترم ما يقبله الجدول.
//
// كل البيانات مصطنعة: لا اسم مورد أو عميل حقيقي، ولا رقم ضريبي أو حساب بنكي لمنشأة قائمة. قاعدة بالذاكرة وبس.
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { preparePayment, paymentAction, getOrder, recordInputTax, decideInputTax } from '../app/payables.mjs';
import { vendorAction, getVendor } from '../app/vendors.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
import { createClaim, claimAction, recordReceipt, receiptAction } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { recordCompanyProfile, approveCompanyProfile, recordCustomerProfile, prepareInvoice, prepareCreditNote, invoiceAction, getInvoice } from '../app/invoices.mjs';
import { createClient } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approveVendors } from './vendor-fixture.mjs';

export const code = value => error => error.code === value;
export const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const monthEnd = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const iban = bban => { const numeric = (bban + 'SA00').replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55)); let r = 0; for (const d of numeric) r = (r * 10 + Number(d)) % 97; return 'SA' + String(98 - r).padStart(2, '0') + bban; };
const address = { building: '1234', street: 'طريق مصطنع', district: 'حي الاختبار', city: 'الرياض', postal_code: '12345', country: 'SA' };

// دليل الحسابات المصطنع بأغراضه: الرموز نفسها في scripts/seed-finance-demo.mjs.
export const CHART = {
  bank: ['1000', 'البنك المصطنع', 'asset'], receivable: ['1100', 'ذمم العملاء المصطنعة', 'asset'], input_vat: ['1150', 'ضريبة مدخلات مصطنعة', 'asset'],
  payable: ['2000', 'ذمم الموردين المصطنعة', 'liability'], output_vat: ['2200', 'ضريبة مخرجات مصطنعة', 'liability'],
  withholding_payable: ['2300', 'استقطاع مستحق مصطنع', 'liability'], customer_advances: ['2400', 'دفعات مقدمة من العملاء مصطنعة', 'liability'],
  retained_earnings: ['3900', 'أرباح مبقاة مصطنعة', 'equity'], revenue: ['4000', 'إيراد خدمات مصطنع', 'income'], supplier_cost: ['5200', 'تكلفة موردين مصطنعة', 'expense']
};
export const OLD_PURPOSES = ['bank', 'receivable', 'input_vat', 'payable', 'output_vat', 'withholding_payable', 'retained_earnings', 'revenue'];

export function ledgerMonth(t, { seedName = 'synthetic-ledger-completeness', purposes = Object.keys(CHART), map = true } = {}) {
  const db = openDb(':memory:'); seed(db, seedName); t.after(() => db.close());
  const tx = run => transaction(db, run);
  // أمين الخزينة: يوثّق تنفيذ الدفع وحده — لا يعدّ الأمر ولا يعتمده ولا جمع بيانات الحساب.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'treasurer','36t','ops','treasurer','أمين خزينة مصطنع',password_hash,'employee','manager' FROM users WHERE id='manager'");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  // فصل المهام كما تفرضه المنصة: المُعدّ غير المعتمد وغير المرحّل؛ والعكس يعدّه غير من أعدّ الأصل.
  const grants = { employee: ['read', 'configure', 'prepare', 'source_procurement'], manager: ['read', 'configure', 'prepare', 'approve', 'post', 'reverse'],
    outsider: ['read', 'approve', 'post'], treasurer: ['read', 'post'] };
  for (const [who, actions] of Object.entries(grants)) for (const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض دفتر مصطنع', null, now());
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.manager, kind, input));
  const accounts = Object.fromEntries(Object.entries(CHART).map(([purpose, [c, name, type]]) => [purpose, ref('accounts', { code: c, name, account_type: type, currency: 'SAR' })]));
  const centres = { GEN: ref('cost_centers', { code: 'GEN', name: 'عام مصطنع' }), 'CC-A': ref('cost_centers', { code: 'CC-A', name: 'مركز أ مصطنع' }), 'CC-B': ref('cost_centers', { code: 'CC-B', name: 'مركز ب مصطنع' }) };
  const day = today(), month = day.slice(0, 7);
  const period = ref('periods', { name: `شهر ${month} المصطنع`, starts_on: `${month}-01`, ends_on: monthEnd(month) });
  const mapPurpose = purpose => { const { id } = tx(() => recordMapping(db, users.employee, { purpose, account_id: accounts[purpose].id, cost_center_id: centres.GEN.id, effective_from: '2026-01-01' }));
    tx(() => approveMapping(db, users.manager, id, { note: 'طابقت الحساب مع دليل الحسابات المصطنع' })); return id; };
  if (map) for (const purpose of purposes) mapPurpose(purpose);

  const journal = (kind, id, who = 'employee') => tx(() => journalFromSource(db, users[who], { source_kind: kind, source_id: id, period_id: period.id }));
  const jAct = (who, j, action, values = {}) => tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, ...(action === 'reverse' ? {} : { note: 'دليل قرار مالي مصطنع' }), ...values }));
  const post = j => jAct('outsider', jAct('manager', jAct('employee', j, 'submit'), 'approve'), 'post');
  // العكس يعدّه غير من أعدّ الأصل (manager)، ويعتمده ويرحّله ثالث (outsider).
  const reverse = (j, reason = 'عكس قيد مصطنع لخطأ في الفترة') => {
    let r = jAct('manager', j, 'reverse', { period_id: period.id, entry_date: day, reason, evidence: 'مذكرة تصحيح مصطنعة محفوظة' });
    r = jAct('manager', r, 'submit'); r = jAct('outsider', r, 'approve'); return jAct('outsider', r, 'post');
  };

  // ───── الموردون والمشتريات ─────
  const vendors = approveVendors(db, ['LOCAL-A', 'LOCAL-B', 'LOCAL-C']);
  for (const [user_id, capability] of [['outsider', 'vendors.manage'], ['hr', 'vendors.bank'], ['manager', 'billing.recurring.manage'], ['outsider', 'billing.recurring.manage']])
    tx(() => grantAccess(db, users.admin, { user_id, capability, note: 'تصريح اختبار مصطنع للدفتر' }));
  const winner = db.prepare("SELECT * FROM vendors WHERE supplier_key='LOCAL-A'").get();
  const vAct = (who, action, values = {}) => tx(() => vendorAction(db, users[who], winner.id, action, { version: getVendor(db, users[who], winner.id).version, ...values }));
  vAct('outsider', 'propose_bank', { bank_name: 'بنك مصطنع', account_holder: winner.legal_name, iban: iban('80000000000000000011'), reason: 'تسجيل حساب الدفع الأول للمورد المصطنع' });
  vAct('hr', 'verify_bank', { bank_id: getVendor(db, users.hr, winner.id).bank[0].id, decision: 'verified', verification_method: 'bank_letter', verification_evidence: 'خطاب بنكي مصطنع مطابق لاسم المورد', effective_from: day });
  const project = tx(() => createProject(db, users.manager, { name: 'مشروع دفتر مصطنع', brief: 'اختبار اكتمال الأستاذ العام', member_ids: ['employee'] }));
  fundProject(db, project.id, 'CC-A', '100000.00');

  let seq = 0;
  // مستحق مطابق مطابقة ثلاثية. split: [[رمز المركز، هللات]…] مجموعها إجمالي الفاتورة — مخصصان للبند الواحد.
  function matchedPayable({ gross = '1150.00', split = null } = {}) {
    seq++;
    const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
    let p = tx(() => createPurchase(db, users.employee, { project_id: project.id, title: `خدمة مصطنعة ${seq}`, specification: 'خدمة واحدة بمواصفات مصطنعة للاختبار', cost_center: 'CC-A', due_date: '2099-10-20', quantity: 1, unit: 'خدمة', budget_amount: gross, budget_evidence: 'مخصص اختبار داخلي', currency: 'SAR' }));
    if (split) {
      // مخصصان للبند الواحد في المسودة، بالأعمدة التي يحرسها الترحيل 140 (نسخة الطلب تتقدم، والمجموع يساوي المخصص).
      const line = db.prepare('SELECT * FROM procurement_purchase_lines WHERE purchase_id=?').get(p.id);
      const first = db.prepare('SELECT * FROM procurement_line_allocations WHERE purchase_line_id=? AND position=1').get(line.id);
      tx(() => {
        db.prepare('UPDATE procurement_line_allocations SET cost_center_id=?,cost_center=?,amount_minor=?,purchase_version=purchase_version+1 WHERE id=?').run(centres[split[0][0]].id, split[0][0], split[0][1], first.id);
        split.slice(1).forEach(([c, minor], i) => db.prepare('INSERT INTO procurement_line_allocations(id,purchase_id,purchase_line_id,position,cost_center_id,cost_center,amount_minor,currency,basis,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), p.id, line.id, i + 2, centres[c].id, c, minor, 'SAR', 'purchase_budget', first.purchase_version + 1, now()));
      });
    }
    p = pAct('employee', p, 'submit');
    for (const [key, price] of [['LOCAL-A', gross], ['LOCAL-B', '99999.00'], ['LOCAL-C', '99998.00']])
      p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد مصطنع ' + key, unit_price: price, technical_assessment: 'العرض يطابق المواصفات المسجلة', financial_terms: 'استحقاق بعد الاستلام والمطابقة', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ برقم ' + key });
    p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'LOCAL-A').id, note: 'ترسية على الأقل سعرًا بعد تأكيد المخصص' });
    p = pAct('manager', p, 'approve_order', { terms: 'تسليم دفعة واحدة بعد فحص الجودة', delivery_date: '2099-10-20', note: 'اعتماد أمر داخلي مصطنع' });
    p = pAct('manager', p, 'commence', { start_on: day, valid_until: '2099-12-31', site_or_channel: 'موقع المورد المصطنع', scope_confirmation: 'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام' });
    p = pAct('employee', p, 'receive', { quantity: 1, reference: `REC-${seq}`, evidence: 'استلام الخدمة وفحصها محليًا' });
    p = pAct('employee', p, 'record_invoice', { supplier_reference: `INV-${seq}`, quantity: 1, amount: gross, evidence: 'فاتورة مورد مصطنعة محفوظة' });
    p = pAct('manager', p, 'match', { invoice_id: p.invoices[0].id, note: 'طابقنا الأمر والاستلام والفاتورة' });
    return { purchase: p, payable: p.payables[0], invoice: p.invoices[0] };
  }
  const inputTax = (invoiceId, vat, { verify = true, number = `TAX-${++seq}` } = {}) => {
    const { id } = tx(() => recordInputTax(db, users.employee, { invoice_id: invoiceId, supplier_vat_number: winner.vat_number, supplier_invoice_number: number, invoice_date: day, vat, evidence: 'فاتورة ضريبية مصطنعة محفوظة في ملف المورد' }));
    if (verify) tx(() => decideInputTax(db, users.manager, id, 'verify', { note: 'طابقنا الفاتورة الضريبية المصطنعة' }));
    return id;
  };
  const pay = payableId => {
    const order = getOrder(db, users.employee, tx(() => preparePayment(db, users.employee, { payable_id: payableId })).id);
    tx(() => paymentAction(db, users.manager, order.id, 'approve_order', { version: order.version, note: 'اعتماد أمر دفع مصطنع بعد المطابقة' }));
    tx(() => paymentAction(db, users.treasurer, order.id, 'record_execution', { version: order.version + 1, executed_on: day, bank_reference: `BNK-${order.id.slice(0, 8)}`, evidence: 'إشعار تحويل بنكي مصطنع محفوظ' }));
    return db.prepare('SELECT * FROM payment_orders WHERE id=?').get(order.id);
  };

  // ───── العميل: فاتورة ضريبية وقبضها ─────
  function issuedInvoice({ amount = '115.00' } = {}) {
    const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
    let c = tx(() => dealFor(db, users.employee, { name: `عميل دفتر مصطنع ${++seq}`, registration_number: `LED-${100 + seq}`, contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
    c = act('employee', c, 'qualify', { need: 'مخرج مصطنع', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل عميل', service_fit: 'مناسب للاختبار' }); c = act('manager', c, 'approve_qualification', { note: 'تأهيل معتمد' });
    c = act('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرج مصطنع', currency: 'SAR', valid_until: '2099-12-01', lines: [{ description: 'حملة مصطنعة', quantity: '1', unit_price: '100.00', unit_cost: '20.00', discount: '0', tax_rate: '15', acceptance: 'قبول بدليل', revisions: 1 }] }));
    c = act('employee', c, 'submit_quote'); c = act('manager', c, 'approve_quote', { note: 'عرض معتمد' }); c = act('employee', c, 'register_contract', { agreement_evidence: 'اتفاق داخلي مصطنع موثق', customer_representative: 'ممثل مصطنع' }); scheduleFor(db, c.id); c = act('manager', c, 'create_project', { member_ids: [] });
    c = act('employee', c, 'submit_delivery', { line_index: 0, evidence: 'مرجع تسليم مصطنع' }); c = act('manager', c, 'accept_delivery', { delivery_id: c.deliveries[0].id, note: 'مطابق للمعيار', acceptance_evidence: 'مرجع قبول مصطنع', approver_id: approverFor(db, c.project_id) });
    let claim = tx(() => createClaim(db, users.employee, { delivery_id: c.deliveries[0].id, amount, due_date: '2099-12-15', entitlement_evidence: 'العقد والقبول يدعمان الاستحقاق المصطنع' }));
    claim = tx(() => claimAction(db, users.employee, claim.id, 'submit', { version: claim.version })); claim = tx(() => claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'استحقاق معتمد' }));
    if (!db.prepare("SELECT 1 FROM company_tax_profiles WHERE tenant_id='36t' AND approved_by IS NOT NULL").get()) {
      const sellerId = tx(() => recordCompanyProfile(db, users.employee, { legal_name: 'شركة 3,6T المصطنعة', vat_number: '300000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' })).id;
      tx(() => approveCompanyProfile(db, users.manager, sellerId, { note: 'طابقنا الشهادة المصطنعة' }));
    }
    tx(() => recordCustomerProfile(db, users.employee, { case_id: c.id, legal_name: `شركة العميل المصطنعة ${seq}`, vat_number: '310000000000003', address, source: 'شهادة مصطنعة من العميل' }));
    const step = (who, doc, action, input = {}) => tx(() => invoiceAction(db, users[who], doc.id, action, { version: doc.version, ...input }));
    const issue = doc => step('manager', step('employee', doc, 'submit'), 'issue');
    const invoice = issue(getInvoice(db, users.employee, tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: day, vat_category: 'standard' })).id));
    const creditNote = (amountText, reason = 'خصم متفق عليه بعد مراجعة نطاق التسليم المصطنع') => issue(getInvoice(db, users.employee, tx(() => prepareCreditNote(db, users.employee, invoice.id, { amount: amountText, reason })).id));
    const receipt = (amountText, reference = `RCPT-${++seq}`) => {
      const r = tx(() => recordReceipt(db, users.employee, claim.id, { reference, amount: amountText, received_on: day, payer: 'شركة العميل المصطنعة', evidence: 'إشعار تحويل بنكي مصطنع محفوظ' }));
      tx(() => receiptAction(db, users.manager, claim.id, r.id, 'confirm', { note: 'طابقت كشف الحساب', matching_evidence: 'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ' }));
      return db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(r.id);
    };
    return { case: c, claim, invoice, creditNote, receipt };
  }

  // ───── الدفعة المقدمة: مسجّلها غير مؤكّد قبضها ─────
  const client = tx(() => createClient(db, users.manager, { legal_name: 'عميل دفعات مقدمة مصطنع', trade_name: 'مصطنع', sector: 'تجريبي', status: 'active', notes: '' }));
  function paidAdvance({ amount = '5000.00', paid = amount, reference = `TRF-${++seq}` } = {}) {
    const { id } = tx(() => billing.recordAdvance(db, users.manager, { client_id: client.id, schedule_id: '', description: 'دفعة مقدمة مصطنعة على اتفاق تجريبي', agreement_reference: 'بند 7-3 من الاتفاق المصطنع', amount }));
    const row = db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(id);
    tx(() => billing.confirmAdvance(db, users.outsider, id, { version: row.version, amount: paid, received_on: day, evidence: 'كشف حساب بنكي مصطنع يطابق الحوالة', reference }));
    return db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(id);
  }
  const draw = (advanceId, target, amountText, applied = amountText) => {
    const planned = tx(() => billing.planDraw(db, users.manager, advanceId, { target_reference: target, amount: amountText }));
    const row = db.prepare('SELECT * FROM advance_draws WHERE id=?').get(planned.id);
    tx(() => billing.applyDraw(db, users.manager, planned.id, { version: row.version, amount: applied, note: '' }));
    return db.prepare('SELECT * FROM advance_draws WHERE id=?').get(planned.id);
  };
  const reverseAdvance = (advanceId, amountText) => tx(() => billing.reverseAdvance(db, users.manager, advanceId, { amount: amountText, reason: 'ارتدت الحوالة من بنك العميل المصطنع', evidence: 'إشعار ارتداد بنكي مصطنع محفوظ' }));

  return { db, users, tx, accounts, centres, period, day, month, project, vendors, winner, client, mapPurpose, journal, jAct, post, reverse,
    matchedPayable, inputTax, pay, issuedInvoice, paidAdvance, draw, reverseAdvance };
}
