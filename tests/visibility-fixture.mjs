// الحزمة 3 — الرؤية وإثبات الشهر: شهر الدفتر المصطنع (tests/ledger-fixture.mjs) ومعه ما يحتاجه كل قارئ رصيد ليُختبر على
// ما يجري في المنصة اليوم لا على «أمر دفع واحد لمستحق واحد»: دفعة جزئية، وأمر مجمّع لمستحقين، وتحويل راجع، وإشعار دائن من
// المورد؛ وقبض مؤكد يرتد بقرار ثالث، وقبض على حساب العميل يُخصَّص، وإشعار دائن للعميل. كل خطوة بالمسار الحقيقي وأدواره.
//
// الأدوار كما في شهر الدفتر: employee يعدّ ويسجّل، manager يعتمد، outsider معتمد ثالث، treasurer يوثّق التنفيذ والمرتجع.
// كل البيانات مصطنعة: لا مورد ولا عميل ولا حساب بنكي حقيقي، في قاعدة بالذاكرة.
import { randomUUID } from 'node:crypto';
import { grantAccess } from '../app/access.mjs';
import * as payables from '../app/payables.mjs';
import * as ar from '../app/receivables.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { recordCustomerProfile, prepareInvoice, prepareCreditNote, invoiceAction, getInvoice, recordCompanyProfile, approveCompanyProfile } from '../app/invoices.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';

export const EVIDENCE = 'إشعار بنكي مصطنع محفوظ في ملف الاختبار';
const address = { building: '1234', street: 'طريق مصطنع', district: 'حي الاختبار', city: 'الرياض', postal_code: '12345', country: 'SA' };
export const riyadhDay = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

export function visibilityWorld(t, options = {}) {
  const m = ledgerMonth(t, options), { db, users, tx } = m;
  // التنبؤ النقدي والنبض التنفيذي بتصريحيهما، لمن يقرأ الأرقام في هذه الاختبارات.
  for (const capability of ['finance.forecast.view', 'executive.view', 'profitability.view'])
    tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability, note: 'تصريح قراءة مصطنع لاختبار القرّاء' }));

  /* ───── الموردون: جزئي، ومجمّع، وراجع، وتسوية ───── */
  const order = id => payables.getOrder(db, users.employee, id);
  const prepare = input => order(tx(() => payables.preparePayment(db, users.employee, input)).id);
  const act = (who, o, action, values = {}) => tx(() => payables.paymentAction(db, users[who], o.id, action, { version: order(o.id).version, ...values }));
  const approve = o => act('manager', o, 'approve_order', { note: 'طابقت المستحق والمورد والحساب' });
  let refs = 0;
  const execute = (o, reference = `BNK-${++refs}-${o.id.slice(0, 6)}`) => act('treasurer', o, 'record_execution', { executed_on: riyadhDay(), bank_reference: reference, evidence: 'إشعار تحويل بنكي مصطنع محفوظ في مجلد الخزينة' });
  const payOrder = input => execute(approve(prepare(input)));
  const returnOrder = (o, credited, reference = `RET-${++refs}`) => act('treasurer', o, 'record_return', { returned_on: riyadhDay(), bank_reference: reference, credited,
    reason: 'رجع التحويل لأن حساب المستفيد مغلق مؤقتًا', evidence: 'إشعار إرجاع مصطنع من البنك محفوظ في مجلد الخزينة' });
  const supplierCredit = (payableId, amount, vat = '0.00', reference = `CN-${++refs}`) => {
    const { id } = tx(() => payables.recordAdjustment(db, users.employee, { payable_id: payableId, kind: 'credit', amount, vat, reference, reason: 'خصم متفق عليه مع المورد على جودة التسليم', evidence: 'إشعار دائن مصطنع من المورد محفوظ' }));
    return tx(() => payables.decideAdjustment(db, users.manager, id, 'approve', { note: 'طابقت الإشعار مع الفاتورة' }));
  };

  /* ───── العملاء: عميل ببنود، وقبض يرتد، وقبض على الحساب يُخصَّص ───── */
  const step = (who, doc, action, input = {}) => tx(() => invoiceAction(db, users[who], doc.id, action, { version: doc.version, ...input }));
  const issue = id => step('manager', step('employee', getInvoice(db, users.employee, id), 'submit'), 'issue');
  const ensureSeller = () => {
    if (db.prepare("SELECT 1 FROM company_tax_profiles WHERE tenant_id='36t' AND approved_by IS NOT NULL").get()) return;
    const sellerId = tx(() => recordCompanyProfile(db, users.employee, { legal_name: 'شركة 3,6T المصطنعة', vat_number: '300000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' })).id;
    tx(() => approveCompanyProfile(db, users.manager, sellerId, { note: 'طابقنا الشهادة المصطنعة' }));
  };
  // عميل بعقد ومشروع وبنود بنسبة 15%: البند 100.00 صافيًا استحقاقه 115.00. كل بند استحقاق معتمد بفاتورة صادرة.
  function customer({ lines = [['حملة مصطنعة أولى', '100.00'], ['تقرير مصطنع ثانٍ', '200.00']], due = '2099-12-15' } = {}) {
    const tag = randomUUID().slice(0, 8);
    const cAct = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
    let c = tx(() => dealFor(db, users.employee, { name: `عميل رؤية مصطنع ${tag}`, registration_number: `VIS-${tag}`, contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
    c = cAct('employee', c, 'qualify', { need: 'مخرجات مصطنعة', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل عميل', service_fit: 'مناسب للاختبار' });
    c = cAct('manager', c, 'approve_qualification', { note: 'تأهيل معتمد' });
    c = cAct('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجات مصطنعة', currency: 'SAR', valid_until: '2099-12-01',
      lines: lines.map(([description, unit_price]) => ({ description, quantity: '1', unit_price, unit_cost: '20.00', discount: '0', tax_rate: '15', acceptance: 'قبول بدليل', revisions: 1 })) }));
    c = cAct('employee', c, 'submit_quote'); c = cAct('manager', c, 'approve_quote', { note: 'عرض معتمد' });
    c = cAct('employee', c, 'register_contract', { agreement_evidence: 'اتفاق داخلي مصطنع موثق', customer_representative: 'ممثل مصطنع' });
    // منذ الترحيل 183 لا استحقاق بلا جدول دفعات بشروطه: دفعة عند قبول كل بند بقيمته (tests/proposal-fixture.mjs scheduleFor).
    scheduleFor(db, c.id);
    c = cAct('manager', c, 'create_project', { member_ids: [] });
    ensureSeller();
    tx(() => recordCustomerProfile(db, users.employee, { case_id: c.id, legal_name: `شركة العميل المصطنعة ${tag}`, vat_number: '310000000000003', address, source: 'شهادة مصطنعة من العميل' }));
    const claims = [], invoices = [];
    lines.forEach(([, price], index) => {
      c = cAct('employee', c, 'submit_delivery', { line_index: index, evidence: `مرجع تسليم مصطنع للبند ${index + 1}` });
      const delivery = c.deliveries.filter(d => d.line_index === index).at(-1);
      c = cAct('manager', c, 'accept_delivery', { delivery_id: delivery.id, note: 'مطابق للمعيار', acceptance_evidence: 'مرجع قبول مصطنع', approver_id: approverFor(db, c.project_id) });
      let claim = tx(() => ar.createClaim(db, users.employee, { delivery_id: delivery.id, amount: (Number(price) * 1.15).toFixed(2), due_date: due, entitlement_evidence: 'العقد والقبول يدعمان الاستحقاق المصطنع' }));
      claim = tx(() => ar.claimAction(db, users.employee, claim.id, 'submit', { version: claim.version }));
      claim = tx(() => ar.claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'استحقاق معتمد' }));
      claims.push(claim);
      invoices.push(issue(tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: riyadhDay(), vat_category: 'standard' })).id));
    });
    return { case: c, project: db.prepare('SELECT * FROM projects WHERE id=?').get(c.project_id), claims, invoices };
  }
  const creditNote = (invoice, amount) => issue(tx(() => prepareCreditNote(db, users.employee, invoice.id, { amount, reason: 'تصحيح مصطنع متفق عليه مع العميل' })).id);
  const receipt = (claim, amount, reference) => {
    const r = tx(() => ar.recordReceipt(db, users.employee, claim.id, { reference, amount, received_on: riyadhDay(), payer: 'شركة العميل المصطنعة', evidence: EVIDENCE }));
    tx(() => ar.receiptAction(db, users.manager, claim.id, r.id, 'confirm', { note: 'طابقت كشف الحساب', matching_evidence: 'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ' }));
    return db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(r.id);
  };
  // العكس يطلبه employee ويعتمده outsider: لا مسجّل القبض ولا مطابقه.
  const reverseReceipt = (claim, r) => {
    const request = tx(() => ar.requestReceiptReversal(db, users.employee, claim.id, r.id, { reason: 'الشيك رجع من بنك العميل لعدم كفاية الرصيد', evidence: 'إشعار ارتداد مصطنع من البنك محفوظ', effective_on: riyadhDay() }));
    tx(() => ar.decideAdjustment(db, users.outsider, claim.id, request.id, 'approve', { note: 'طابقت إشعار الارتداد مع كشف البنك' }));
    return db.prepare('SELECT * FROM ar_adjustments WHERE id=?').get(request.id);
  };
  const onAccount = (caseId, amount, reference) => {
    const x = tx(() => ar.recordAccountReceipt(db, users.employee, { case_id: caseId, reference, amount, received_on: riyadhDay(), payer: 'شركة العميل المصطنعة', evidence: EVIDENCE }));
    tx(() => ar.accountReceiptAction(db, users.manager, x.id, 'confirm', { note: 'طابقت المبلغ مع الكشف', matching_evidence: 'سطر كشف حساب مصطنع بالمبلغ والتاريخ' }));
    return db.prepare('SELECT * FROM ar_account_receipts WHERE id=?').get(x.id);
  };
  const allocate = (x, lines) => tx(() => ar.allocateReceipt(db, users.outsider, x.id, { lines, note: 'تخصيص الحوالة على استحقاقات العميل حسب كتابه' }));
  const collection = claimId => db.prepare('SELECT * FROM ar_claim_collection WHERE claim_id=?').get(claimId);

  return { ...m, order, prepare, act, approve, execute, payOrder, returnOrder, supplierCredit, customer, creditNote, receipt, reverseReceipt, onAccount, allocate, collection, issue };
}
