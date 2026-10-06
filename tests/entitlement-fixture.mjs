// أدوات اختبارات بوابات الاستحقاق (P4-CRM-4، الترحيل 183) فوق العالم التجريبي في tests/crm-fixture.mjs: صفقة متعاقد عليها من فرصة
// جديدة على عميل العالم، وجدول دفعاتها بشروطه، ومشروعها، وقبول بنودها، والاستحقاق واعتماده، وأمر شراء العميل وتأكيده.
// بندا QUOTE: هوية الحملة 46000 وعشرة منشورات 46000 (شاملة الضريبة 15%)، والاتفاق 92000. كل اسم ورقم مصطنع وموسوم «تجريبي».
import * as axes from '../app/project-axes.mjs';
import * as receivables from '../app/receivables.mjs';
import { riyadh } from './crm-fixture.mjs';
import { approverFor } from './proposal-fixture.mjs';

export const term = (label, amount, kind, lines = [], extra = {}) => ({ label, amount, due_on: '2099-10-15', condition: '', condition_kind: kind, condition_lines: lines, ...extra });
let serial = 0;
export function deal(w) {
  const oppId = w.opportunity({ name: `فرصة بوابات الاستحقاق التجريبية ${++serial}` });
  const id = w.openCase(oppId).id;
  w.contract(id);
  return { id, oppId };
}
export const schedule = (w, d, terms, requires_client_po = false) => w.tx(() => axes.recordPaymentTerms(w.db, w.users.employee, d.id, { requires_client_po, terms }));
export function project(w, d) {
  w.oppAct('employee', d.oppId, 'win', {});
  w.act('manager', d.id, 'create_project', { member_ids: ['pm1'] });
  return w.kase(d.id).project_id;
}
export function accept(w, d, line) {
  const c = w.act('employee', d.id, 'submit_delivery', { line_index: line, evidence: `تقرير إنجاز تجريبي للبند ${line + 1} بمراجعه المسجلة` });
  const delivery = c.deliveries.filter(x => x.line_index === line).at(-1).id;
  w.act('manager', d.id, 'accept_delivery', { delivery_id: delivery, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول تجريبي محفوظ في الأرشيف',
    approver_id: approverFor(w.db, w.kase(d.id).project_id, 'pm1') });
  return delivery;
}
export const claim = (w, input) => w.tx(() => receivables.createClaim(w.db, w.users.employee, { amount: '46000.00', due_date: '2099-12-15',
  entitlement_evidence: 'محضر القبول التجريبي وشرط الدفعة في جدول الاتفاق', ...input }));
export function approve(w, c) {
  const submitted = w.tx(() => receivables.claimAction(w.db, w.users.employee, c.id, 'submit', { version: c.version, note: '' }));
  return w.tx(() => receivables.claimAction(w.db, w.users.manager, c.id, 'approve', { version: submitted.version, note: 'طوبق القبول وشرط الدفعة' }));
}
// أمر شراء العميل على اتفاق الصفقة بمشروعها الحالي (إن فُتح)، وتأكيده من المدير المباشر غير مسجّله.
export function purchaseOrder(w, d, amount, { number = 'PO-GATE-7001', supersedes = '' } = {}) {
  const contractId = w.db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(d.id).id;
  return w.tx(() => axes.recordClientPurchaseOrder(w.db, w.users.employee, d.id, { po_number: number, issued_on: riyadh(), valid_until: '2099-12-31', amount,
    scope: 'أمر شراء تجريبي لحملة الإطلاق كاملة', customer_representative: 'ممثل عميل تجريبي', evidence: 'نسخة أمر شراء تجريبية محفوظة في الأرشيف', contract_id: contractId,
    project_id: w.kase(d.id).project_id ?? '', client_id: w.client, supersedes_id: supersedes }));
}
export const confirmPurchaseOrder = (w, id) => w.tx(() => axes.confirmClientPurchaseOrder(w.db, w.users.manager, id,
  { version: w.db.prepare('SELECT version FROM client_purchase_orders WHERE id=?').get(id).version, note: 'قوبل أمر الشراء التجريبي بالأصل' }));
