// P4-CRM-4 (الترحيل 183): بوابات الاستحقاق. جدول دفعات الصفقة صار شروطًا مكتوبة بأنواعها (دفعة مقدمة عند الاتفاق، أو قبول بنود
// بعينها من الاتفاق) مجموعها قيمة الاتفاق؛ والاستحقاق يُنشأ على بند منها وحده، بعد تحقق شرطه، ولا يتجاوز باقيه، ولا يتجاوز أمر شراء
// العميل المؤكد، ورقم أمر الشراء يصل الاستحقاق والفاتورة. والدفعة المقدمة استحقاقٌ له طريق نقد واحد (دفعة مقدمة مؤكدة ثم سحب منها)
// ولا تصدر عليه فاتورة بعد (القرار D3: البوابة وحدها). وبوابة PM-01 تقرأ جدول الصفقة نفسه لا رقمًا ثانيًا في نموذج التسليم.
// كل اسم ورقم هنا مصطنع وموسوم «تجريبي».
import test from 'node:test';
import assert from 'node:assert/strict';
import { grantAccess } from '../app/access.mjs';
import * as axes from '../app/project-axes.mjs';
import * as receivables from '../app/receivables.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as invoices from '../app/invoices.mjs';
import * as projectIntake from '../app/project-intake.mjs';
import { crmWorld, caught, riyadh } from './crm-fixture.mjs';
import { term, deal, schedule, project, accept, claim, approve, purchaseOrder, confirmPurchaseOrder } from './entitlement-fixture.mjs';

const link = (w, claimId) => w.db.prepare('SELECT * FROM ar_claim_terms WHERE claim_id=?').get(claimId);
const termOf = (w, d, position) => w.db.prepare('SELECT * FROM case_payment_terms WHERE case_id=? AND position=?').get(d.id, position);

test('typed schedule: recordPaymentTerms refuses an untyped term, a total that is not the agreement, a line twice, a line the agreement does not have and an advance with lines; the database refuses an untyped row', t => {
  const w = crmWorld(t), d = deal(w);
  // الجدول القديم بلا نوع شرط: نص حر «عند قبول المخرجات» لا يعرف أي بند يفتح الدفعة.
  assert.equal(caught(() => schedule(w, d, [{ label: 'دفعة تجريبية كاملة', amount: '92000.00', due_on: '2099-10-15', condition: 'عند قبول المخرجات', is_advance: false }])).code, 'condition_kind_required');
  assert.equal(caught(() => schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0])])).code, 'terms_total_mismatch');
  assert.equal(caught(() => schedule(w, d, [term('دفعة تجريبية أولى', '46000.00', 'acceptance', [0]), term('دفعة تجريبية ثانية', '46000.00', 'acceptance', [0, 1])])).code, 'line_in_two_terms');
  assert.equal(caught(() => schedule(w, d, [term('دفعة تجريبية لبند غير موجود', '92000.00', 'acceptance', [2])])).code, 'unknown_line');
  assert.equal(caught(() => schedule(w, d, [term('مقدمة تجريبية', '27600.00', 'advance', [0]), term('الباقي التجريبي', '64400.00', 'acceptance', [0, 1])])).code, 'advance_lines');
  assert.equal(caught(() => schedule(w, d, [term('مقدمة تجريبية', '27600.00', 'acceptance', [0], { is_advance: true }), term('الباقي التجريبي', '64400.00', 'acceptance', [1])])).code, 'advance_mismatch');
  const refusal = caught(() => schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0])]));
  assert.match(refusal.details.refusal.what, /46000\.00/);
  assert.match(refusal.details.refusal.what, /92000\.00/);
  // جدول صحيح: مقدمة 30% عند الاتفاق، والباقي عند قبول البندين معًا.
  const saved = schedule(w, d, [term('مقدمة تجريبية عند توقيع الاتفاق', '27600.00', 'advance'), term('الباقي التجريبي عند قبول البندين', '64400.00', 'acceptance', [0, 1])]);
  assert.deepEqual([saved.terms, saved.advance_minor], [2, 2760000]);
  assert.deepEqual(w.db.prepare('SELECT condition_kind,condition_lines,is_advance FROM case_payment_terms WHERE case_id=? ORDER BY position').all(d.id).map(r => ({ ...r })),
    [{ condition_kind: 'advance', condition_lines: '[]', is_advance: 1 }, { condition_kind: 'acceptance', condition_lines: '[0,1]', is_advance: 0 }]);
  // تحت الكود: صف بلا نوع شرط يُرفض في القاعدة نفسها.
  const other = deal(w);
  assert.throws(() => w.db.prepare("INSERT INTO case_payment_terms(id,tenant_id,case_id,position,label,amount_minor,currency,due_on,condition,is_advance,recorded_by,recorded_at) VALUES('syn-untyped','36t',?,0,'دفعة تجريبية بلا شرط',9200000,'SAR','2099-10-15','',0,'employee',?)")
    .run(other.id, new Date().toISOString()), /condition kind/);
});

test('acceptance gate: a claim waits for every line of its term, takes its term from the delivered line, stays within the term — and a deal without a schedule claims nothing', t => {
  const w = crmWorld(t), d = deal(w);
  schedule(w, d, [term('دفعة تجريبية عند قبول البندين', '92000.00', 'acceptance', [0, 1])]);
  project(w, d);
  const first = accept(w, d, 0);
  const waiting = caught(() => claim(w, { delivery_id: first, amount: '50000.00' }));
  assert.equal(waiting.code, 'condition_not_met');
  assert.match(waiting.details.refusal.missing.map(m => m.document).join(' '), /البند 2/);
  const second = accept(w, d, 1);
  // بند الجدول يغطي البندين، فالاستحقاق يتجاوز قيمة البند الواحد ولا يتجاوز باقي بند الجدول.
  const a = claim(w, { delivery_id: first, amount: '50000.00' });
  assert.equal(link(w, a.id).term_id, termOf(w, d, 0).id);
  assert.equal(a.source_snapshot.term.label, 'دفعة تجريبية عند قبول البندين');
  const over = caught(() => claim(w, { delivery_id: second, amount: '50000.00' }));
  assert.equal(over.code, 'term_exceeded');
  assert.match(over.details.refusal.what, /42000\.00/);
  const b = claim(w, { delivery_id: second, amount: '42000.00' });
  assert.equal(link(w, b.id).term_id, termOf(w, d, 0).id);
  // صفقة بلا جدول دفعات: لا استحقاق عليها حتى يُسجَّل جدولها بشروطه.
  const bare = deal(w);
  project(w, bare);
  const delivery = accept(w, bare, 0);
  const none = caught(() => claim(w, { delivery_id: delivery }));
  assert.equal(none.code, 'payment_terms_required');
  assert.equal(none.details.refusal.missing[0].owner_role, 'account_manager');
});

test('acceptance gate in the database: a claim on a typed schedule without its term link, over its term, or a link written after its claim is refused underneath the code', t => {
  const w = crmWorld(t), d = deal(w), { db } = w;
  schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0]), term('دفعة تجريبية عند قبول المنشورات', '46000.00', 'acceptance', [1])]);
  const projectId = project(w, d);
  const delivery = accept(w, d, 0);
  const contract = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(d.id).id, time = new Date().toISOString();
  const insertClaim = (id, amount) => db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,delivery_id,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,revision,created_at,updated_at) VALUES(?,'36t',?,?,?,'employee','delivery',?,'','{}','SAR',?,'2099-12-15','دليل تجريبي مكتوب للاستحقاق','draft',1,0,?,?)")
    .run(id, contract, projectId, d.id, delivery, amount, time, time);
  const insertLink = (claimId, termId) => db.prepare("INSERT INTO ar_claim_terms(claim_id,tenant_id,case_id,term_id,created_at) VALUES(?,'36t',?,?,?)").run(claimId, d.id, termId, time);
  assert.throws(() => w.tx(() => insertClaim('syn-unlinked', '1000')), /names its term/);
  assert.throws(() => w.tx(() => { insertLink('syn-over', termOf(w, d, 0).id); insertClaim('syn-over', '4600001'); }), /names its term/);
  assert.throws(() => w.tx(() => { insertLink('syn-wrong-line', termOf(w, d, 1).id); insertClaim('syn-wrong-line', '1000'); }), /names its term/);
  const ok = claim(w, { delivery_id: delivery, amount: '1000.00' });
  assert.throws(() => db.prepare("INSERT INTO ar_claim_terms(claim_id,tenant_id,case_id,term_id,created_at) VALUES(?,'36t',?,?,?)").run(ok.id, d.id, termOf(w, d, 1).id, time), /PRIMARY KEY|UNIQUE|written with its claim/);
  assert.throws(() => db.prepare('DELETE FROM ar_claim_terms WHERE claim_id=?').run(ok.id), /retained/);
});

test('client PO cap: a schedule that requires a PO claims only on the latest confirmed one, never beyond its amount, and the PO number reaches the claim and the invoice', t => {
  const w = crmWorld(t), d = deal(w), { db, users } = w;
  schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0]), term('دفعة تجريبية عند قبول المنشورات', '46000.00', 'acceptance', [1])], true);
  const contractId = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(d.id).id;
  const po = (amount, supersedes = '') => purchaseOrder(w, d, amount, { supersedes }), confirm = id => confirmPurchaseOrder(w, id);
  const first = po('40000.00');
  confirm(first.id);
  project(w, d);
  const identity = accept(w, d, 0);
  const capped = caught(() => claim(w, { delivery_id: identity }));
  assert.equal(capped.code, 'client_po_exceeded');
  assert.match(capped.details.refusal.what, /40000\.00/);
  const a = claim(w, { delivery_id: identity, amount: '40000.00' });
  assert.deepEqual(a.source_snapshot.client_po, { number: 'PO-GATE-7001', revision: 1 });
  assert.deepEqual([link(w, a.id).client_po_number, link(w, a.id).client_po_revision], ['PO-GATE-7001', 1]);
  // نسخة ثانية من أمر الشراء لم تُؤكَّد بعد: النسخة الأخيرة وحدها تغطي، والمؤكدة قبلها حلّت محلها.
  const posts = accept(w, d, 1);
  const second = po('90000.00', first.id);
  const unconfirmed = caught(() => claim(w, { delivery_id: posts }));
  assert.equal(unconfirmed.code, 'client_po_required');
  assert.match(unconfirmed.details.refusal.missing[0].why, /النسخة 2/);
  confirm(second.id);
  const b = claim(w, { delivery_id: posts });
  assert.equal(b.source_snapshot.client_po.revision, 2);
  // تحت الكود: استحقاق يدخل بند جدوله لكنه يتجاوز أمر الشراء المؤكد (86000 + 5000 > 90000) يُرفض في القاعدة.
  const time = new Date().toISOString();
  assert.throws(() => w.tx(() => {
    db.prepare("INSERT INTO ar_claim_terms(claim_id,tenant_id,case_id,term_id,client_po_id,client_po_number,client_po_revision,created_at) VALUES('syn-po-over','36t',?,?,?,'PO-GATE-7001',2,?)").run(d.id, termOf(w, d, 0).id, second.id, time);
    db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,delivery_id,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,revision,created_at,updated_at) VALUES('syn-po-over','36t',?,?,?,'employee','delivery',?,'','{}','SAR','500000','2099-12-15','دليل تجريبي مكتوب للاستحقاق','draft',1,0,?,?)")
      .run(contractId, w.kase(d.id).project_id, d.id, identity, time, time);
  }), /purchase order/);
  // رقم أمر الشراء يصل الفاتورة: بنودها تحمله، فيدخل بصمة المستند عند إصداره.
  approve(w, a);
  const address = { building: '1234', street: 'طريق تجريبي', district: 'حي الاختبار', city: 'الرياض', postal_code: '12345', country: 'SA' };
  const seller = w.tx(() => invoices.recordCompanyProfile(db, users.employee, { legal_name: 'شركة 3,6T التجريبية', vat_number: '300000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' })).id;
  w.tx(() => invoices.approveCompanyProfile(db, users.manager, seller, { note: 'طابقنا الشهادة الضريبية التجريبية' }));
  w.tx(() => invoices.recordCustomerProfile(db, users.employee, { case_id: d.id, legal_name: 'شركة الأفق التجريبية للتجزئة', vat_number: '310000000000003', address, source: 'شهادة ضريبية تجريبية أرسلها العميل' }));
  const invoice = w.tx(() => invoices.prepareInvoice(db, users.employee, { claim_id: a.id, supply_date: riyadh(), vat_category: 'standard' }));
  assert.equal(invoices.getInvoice(db, users.employee, invoice.id).lines[0].client_po_number, 'PO-GATE-7001');
});

test('advance: the advance term is claimed once its agreement and project exist, collected only by a draw from the confirmed advance payment, and not invoiced (D3)', t => {
  const w = crmWorld(t), d = deal(w), { db, users } = w;
  schedule(w, d, [term('مقدمة تجريبية عند توقيع الاتفاق', '27600.00', 'advance'), term('الباقي التجريبي عند قبول البندين', '64400.00', 'acceptance', [0, 1])]);
  assert.equal(caught(() => claim(w, { basis: 'advance', case_id: d.id, amount: '27600.00' })).code, 'project_required');
  const projectId = project(w, d);
  assert.equal(caught(() => claim(w, { basis: 'advance', case_id: d.id, amount: '27600.01' })).code, 'term_exceeded');
  let advance = claim(w, { basis: 'advance', case_id: d.id, amount: '27600.00' });
  assert.deepEqual([advance.basis, advance.delivery_id, advance.advance_clause], ['advance', null, 'مقدمة تجريبية عند توقيع الاتفاق']);
  assert.equal(link(w, advance.id).term_id, termOf(w, d, 0).id);
  assert.equal(caught(() => claim(w, { basis: 'advance', case_id: d.id, amount: '1.00' })).code, 'term_exceeded');
  advance = approve(w, advance);
  // طريق نقد واحد: لا قبض مباشر على استحقاق المقدمة، ولا تخصيص من قبض على الحساب؛ يُسحب من دفعة مقدمة مؤكدة.
  assert.equal(receivables.listReceivables(db, users.employee).claims.find(c => c.id === advance.id).actions.includes('record_receipt'), false);
  const direct = caught(() => w.tx(() => receivables.recordReceipt(db, users.employee, advance.id, { reference: 'TRF-SYN-ADV', amount: '27600.00', received_on: riyadh(), payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي محفوظ' })));
  assert.equal(direct.code, 'advance_cash_path');
  for (const who of ['employee', 'manager']) w.tx(() => grantAccess(db, users.admin, { user_id: who, capability: 'billing.recurring.manage', department_id: '', note: 'منح تجريبي للدفعات المقدمة' }));
  const paid = w.tx(() => billing.recordAdvance(db, users.employee, { client_id: w.client, schedule_id: '', project_id: projectId, description: 'دفعة مقدمة تجريبية على الاتفاق', agreement_reference: 'بند الدفعة المقدمة في جدول الاتفاق التجريبي', amount: '27600.00' })).id;
  w.tx(() => billing.confirmAdvance(db, users.manager, paid, { version: 1, amount: '27600.00', received_on: riyadh(), evidence: 'كشف حساب بنكي تجريبي يطابق الحوالة', reference: 'TRF-SYN-ADV-1' }));
  assert.equal(axes.advanceGate(db, '36t', projectId).satisfied, true, 'the readiness gate reads the same confirmed advance');
  const draw = w.tx(() => billing.planDraw(db, users.employee, paid, { claim_id: advance.id, amount: '27600.00' }));
  w.tx(() => billing.applyDraw(db, users.manager, draw.id, { version: db.prepare('SELECT version FROM advance_draws WHERE id=?').get(draw.id).version, amount: '27600.00', note: '' }));
  assert.equal(receivables.listReceivables(db, users.employee).claims.find(c => c.id === advance.id).balance_minor, '0');
  const invoiced = caught(() => w.tx(() => invoices.prepareInvoice(db, users.employee, { claim_id: advance.id, supply_date: riyadh(), vat_category: 'standard' })));
  assert.equal(invoiced.code, 'advance_not_invoiced');
  assert.equal(invoices.listInvoices(db, users.employee).claims.some(c => c.id === advance.id), false, 'the advance entitlement is not offered for invoicing');
});

test('one schedule: the PM-01 gate reads the deal’s advance, not a second figure carried in the handover', t => {
  const w = crmWorld(t), d = deal(w), { db, users } = w;
  schedule(w, d, [term('مقدمة تجريبية عند توقيع الاتفاق', '27600.00', 'advance'), term('الباقي التجريبي عند قبول البندين', '64400.00', 'acceptance', [0, 1])]);
  const projectId = project(w, d);
  const handoverId = w.tx(() => projectIntake.createHandover(db, users.employee, { project_id: projectId, project_manager_id: 'pm1', contract_signed_on: riyadh(-1), kickoff_planned_on: riyadh(3),
    channels: 'البريد الرسمي وقناة المشروع التجريبية', timeline_start: riyadh(), timeline_end: '2099-12-31', risks: '', special_requirements: '', advance_claimed_on: riyadh(-1) })).id;
  const hv = () => db.prepare('SELECT version FROM project_handovers WHERE id=?').get(handoverId).version;
  w.tx(() => projectIntake.handoverAction(db, users.employee, handoverId, 'approve_handover', { version: hv(), statement: 'أقرّ أن المحضر التجريبي هو ما تعاقدنا عليه' }));
  w.tx(() => projectIntake.handoverAction(db, users.pm1, handoverId, 'approve_handover', { version: hv(), statement: 'أقرّ استلامي للمحضر التجريبي ومراجعتي لبنوده' }));
  w.tx(() => projectIntake.handoverAction(db, users.pm1, handoverId, 'receive_handover', { version: hv(), note: 'استلمت المحضر التجريبي وبقيت الوثائق المطلوبة' }));
  // نموذج تسليم كُتبت دفعته المقدمة بيد (كما في مشاريع الصفقات قبل P4-CRM-2): رقمٌ ثانٍ غير جدول الصفقة.
  db.prepare('UPDATE project_handovers SET advance_minor=3000000,version=version+1 WHERE id=?').run(handoverId);
  const gate = projectIntake.executionGate(db, users.pm1, projectId, 'paid_execution');
  assert.equal(gate.advance.agreed_minor, 2760000, 'the deal’s schedule is the schedule');
  assert.match(gate.advance.expected_source, /case_payment_terms/);
  assert.equal(gate.advance.agreed_minor, axes.advanceGate(db, '36t', projectId).expected_minor, 'both gates read one figure');
});

test('customer statement: a finance reader sees each deal of the customer; a reader without finance authority is refused by name', t => {
  const w = crmWorld(t), d = deal(w);
  schedule(w, d, [term('دفعة تجريبية عند قبول الهوية', '46000.00', 'acceptance', [0]), term('دفعة تجريبية عند قبول المنشورات', '46000.00', 'acceptance', [1])]);
  project(w, d);
  approve(w, claim(w, { delivery_id: accept(w, d, 0) }));
  const statement = receivables.customerStatement(w.db, w.users.employee, w.client);
  assert.equal(statement.client.id, w.client);
  const row = statement.deals.find(x => x.case_id === d.id);
  assert.deepEqual([row.entitled_minor, row.received_minor, row.open_minor, row.on_account_minor], [4600000, 0, 4600000, 0]);
  assert.equal(caught(() => receivables.customerStatement(w.db, w.users.pm1, w.client)).code, 'receivable_access_denied');
});
