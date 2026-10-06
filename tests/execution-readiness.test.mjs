// جاهزية التنفيذ المدفوع: البوابة الواحدة في عمود المشروع الفقري (app/project-axes.mjs) وما أغلقه الترحيل 160 من ثغراتها.
// تُختبر هنا المعايير التعاقدية بنصها: دفعة مقدمة مؤكدة حين تشترطها الشروط المقبولة، وإعفاء باسم من اعتمده غيرُ من طلبه،
// وإعادة الفحص لحظة التنفيذ، والقبض الجزئي والمكرر والمعكوس، والاعتماد الذي فقد سنده، والتزامن، وعزل الكيان، وأمر شراء العميل
// بنسخه وروابطه ورفض ما لا يخصه. بيانات مصطنعة بالكامل.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, revokeAccess } from '../app/access.mjs';
import { createLead, commercialAction, listCommercial } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor } from './proposal-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as axes from '../app/project-axes.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { billingSchedulesUI } from '../app/static/billing-recurring-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const PASSWORD = 'synthetic-execution-readiness';
const code = value => error => error.code === value;
const riyadh = (days = 0) => new Date(Date.now() + 3 * 3600000 + days * 86400000).toISOString().slice(0, 10);
const refused = run => { try { run(); } catch (error) { return error; } assert.fail('نُفِّذ ما كان يجب أن يُرفض'); };
const quote = () => ({ scope: 'مخرجان مصطنعان بمعايير قبول محددة', currency: 'SAR', valid_until: '2099-12-01', lines: [
  { description: 'هوية بصرية', quantity: '1', unit_price: '400.00', unit_cost: '100.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد الهوية بثلاثة عناصر', revisions: 1 },
  { description: 'فيلم قصير', quantity: '1', unit_price: '600.00', unit_cost: '150.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد النسخة النهائية من الفيلم', revisions: 1 }] });

// ملف تجاري حتى مشروع قائم، بعميل مربوط. «manager» هو المدير المباشر وحامل تصريح الإعفاء، و«lead» مدير مشروع
// يحمل التصريح نفسه ليكون للمدير نفسه طرف ثانٍ حين يكون هو الطالب. «billing-a» يسجّل الدفعة و«billing-b» يؤكد قبضها.
function fixture(t, { registration = 'ER-100', name = 'عميل الجاهزية المصطنع' } = {}) {
  const db = openDb(':memory:');
  seed(db, PASSWORD);
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('lead','36t','creative','lead','مديرة مشروع مصطنعة','unused-test-hash','pm','manager'),
    ('billing-a','36t','ops','billing-a','مسجّلة الدفعات المصطنعة','unused-test-hash','employee',NULL),
    ('billing-b','36t','ops','billing-b','مؤكدة القبض المصطنعة','unused-test-hash','employee',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار الجاهزية' }));
  grant('employee', 'clients.manage');
  for (const who of ['billing-a', 'billing-b']) grant(who, 'billing.recurring.manage');
  for (const who of ['manager', 'lead']) grant(who, 'projects.readiness.waive');
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, { name, registration_number: registration, contact: 'جهة اتصال مصطنعة', source: 'اختبار محلي', sector: 'قطاع مصطنع' }));
  c = act('manager', act('employee', c, 'qualify', { need: 'مخرجان لاختبار الجاهزية', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'ضمن خدمات التجربة' }), 'approve_qualification', { note: 'تأهيل مصطنع معتمد' });
  c = act('manager', act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, quote())), 'submit_quote'), 'approve_quote', { note: 'راجعت المبالغ والنطاق' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع للاختبار المحلي فقط', customer_representative: 'ممثل عميل مصطنع' });
  c = act('manager', c, 'create_project', { member_ids: ['lead'] });
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(c.client_id);
  const caseId = c.id, projectId = c.project_id, contractId = c.contract.id;
  const read = (who = 'employee') => listCommercial(db, users[who]).find(x => x.id === caseId);
  // الجدول بشروطه (الترحيل 183): المقدمة عند الاتفاق، والباقي من قيمة الاتفاق (1150.00) عند قبول المخرجين.
  const terms = ({ advance = '345.00', requires_client_po } = {}) => tx(() => axes.recordPaymentTerms(db, users.employee, caseId, { terms: [
    ...(advance ? [{ label: 'الدفعة المقدمة عند التوقيع', amount: advance, due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' }] : []),
    { label: 'الباقي عند القبول', amount: (1150 - Number(advance ?? 0)).toFixed(2), due_on: '2099-06-01', condition: 'عند قبول المخرجين', condition_kind: 'acceptance', condition_lines: [0, 1] }],
    ...(requires_client_po === undefined ? {} : { requires_client_po }) }));
  const order = (overrides = {}) => ({ po_number: 'ER-PO-1', issued_on: riyadh(), valid_until: '2099-12-31', amount: '1150.00', scope: 'المخرجان المتفق عليهما في الاتفاق المسجل',
    customer_representative: 'مدير المشتريات لدى العميل', evidence: 'نسخة أمر الشراء المصطنع محفوظة في ملف الاتفاق', contract_id: contractId, project_id: projectId, client_id: client.id, ...overrides });
  const recordPo = (overrides = {}, who = 'employee') => tx(() => axes.recordClientPurchaseOrder(db, users[who], caseId, order(overrides)));
  const confirmPo = (po, who = 'manager', version = 1) => tx(() => axes.confirmClientPurchaseOrder(db, users[who], po.id, { version, note: 'قابلنا الرقم والقيمة والصلاحية بأصل أمر الشراء' }));
  let transfer = 0;
  const recordAdvance = amount => tx(() => billing.recordAdvance(db, users['billing-a'], { client_id: client.id, schedule_id: '', project_id: projectId,
    description: 'الدفعة المقدمة على اتفاق الجاهزية', agreement_reference: 'بند الدفعات في الاتفاق المصطنع', amount }));
  const confirmAdvance = (row, amount, reference = `ER-TRF-${++transfer}`) => tx(() => billing.confirmAdvance(db, users['billing-b'], row.id, { version: 1, amount, received_on: riyadh(), evidence: 'إشعار تحويل بنكي مصطنع مطابق للمبلغ', reference }));
  const advance = (amount = '345.00', reference) => { const row = recordAdvance(amount); confirmAdvance(row, amount, reference); return row; };
  const deliver = (line, who = 'employee') => act(who, read(), 'submit_delivery', { line_index: line, evidence: `تقرير إنجاز المخرج رقم ${line + 1} بمراجعه المسجلة` });
  const request = (item, who = 'employee') => tx(() => axes.requestReadinessWaiver(db, users[who], projectId, { item, reason: 'العميل جهة حكومية تصرف الدفعة بعد المباشرة بقرار مكتوب محفوظ' }));
  const authorise = (item, who = 'manager') => tx(() => axes.waiveReadiness(db, users[who], projectId, { item, reason: 'اطلعت على قرار العميل المكتوب وأعفيت الشرط لهذا المشروع وحده' }));
  const blockers = () => read().readiness.blockers.map(b => b.document);
  return { db, users, tx, grant, act, read, caseId, projectId, contractId, client, terms, order, recordPo, confirmPo, recordAdvance, confirmAdvance, advance, deliver, request, authorise, blockers };
}

test('ER-01: a case whose accepted terms require neither condition behaves exactly as before, and the terms say whether a customer PO is required', t => {
  const f = fixture(t);
  // بلا جدول دفعات: لا شرط، والتسليم يمضي كما كان.
  assert.equal(f.read().readiness.state, 'not_required');
  assert.equal(f.deliver(0).deliveries.length, 1);
  // جدول بلا دفعة مقدمة يقول صراحة إنه لا يشترط أمر شراء: لا يُخمَّن الشرط بعده.
  assert.throws(() => f.terms({ advance: null, requires_client_po: 'no' }), code('requires_client_po'));
  f.terms({ advance: null, requires_client_po: false });
  const readiness = f.read().readiness;
  assert.equal(readiness.state, 'not_required');
  assert.equal(readiness.client_purchase_order.required, false);
  assert.equal(f.deliver(1).deliveries.length, 2);
  // والشرط مكتوب في الجدول نفسه، لا في الذاكرة.
  assert.deepEqual([...new Set(f.db.prepare('SELECT requires_client_po FROM case_payment_terms WHERE case_id=?').all(f.caseId).map(r => r.requires_client_po))], [0]);
  assert.ok(verifyAudit(f.db));
});

test('ER-02: every paid-execution entry point is checked on the server at the moment of action', t => {
  const f = fixture(t), { db, users, tx, act, read, projectId } = f;
  f.terms();
  // طلب تغيير معتمد: بدء مهمته عمل مدفوع إضافي، فيمر بالبوابة نفسها.
  let c = act('employee', read(), 'create_change', { scope: 'نسخة إضافية من الفيلم للمنصات', additional_price: '200.00', additional_cost: '50.00', extra_days: 3, due_date: '2099-05-01', acceptance: 'اعتماد النسخة الإضافية' });
  c = act('manager', c, 'approve_change', { change_id: c.changes[0].id, note: 'التغيير مسعّر ومقبول' });
  // حالة التنفيذ لمدير المشروع المسجَّل (app/project-authority.mjs): منشئ المشروع ما دام لم يُسلَّم بمحضر.
  const entries = {
    submit_delivery: () => f.deliver(0),
    start_change: () => act('employee', read(), 'start_change', { change_id: c.changes[0].id }),
    execution_in_progress: () => { tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 0, state: 'mobilising', note: 'تعبئة الفريق' })); return tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 1, state: 'in_progress', note: 'بدء التنفيذ' })); }
  };
  for (const [entry, run] of Object.entries(entries)) {
    const error = refused(run);
    assert.equal(error.code, 'advance_required', entry);
    assert.ok(error.details.refusal.what.length > 25, `${entry}: الرفض يقول ما الذي رُفض`);
    assert.ok(error.details.refusal.next, `${entry}: الرفض يقول الخطوة التالية`);
  }
  // بعد اكتمال الشرطين تمضي الثلاثة.
  f.confirmPo(f.recordPo());
  f.advance();
  assert.equal(f.deliver(0).deliveries.length, 1);
  assert.ok(act('employee', read(), 'start_change', { change_id: c.changes[0].id }).changes[0].task_id);
  assert.equal(tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 1, state: 'in_progress', note: 'بدء التنفيذ بعد اكتمال الشروط' })).state, 'in_progress');
  assert.ok(verifyAudit(db));
});

test('ER-03: an exemption is requested by one person and authorised by another, with written reasons, and both sides are auditable', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.terms();
  // الطلب لعضو المشروع وبسبب مكتوب.
  assert.throws(() => tx(() => axes.requestReadinessWaiver(db, users.employee, projectId, { item: 'client_po', reason: 'قصير' })), code('invalid_text'));
  assert.throws(() => tx(() => axes.requestReadinessWaiver(db, users.outsider, projectId, { item: 'client_po', reason: 'طلب من خارج المشروع لا يُقبل أبدًا مهما كان سببه' })), code('project_not_found'));
  assert.throws(() => tx(() => axes.requestReadinessWaiver(db, users.employee, projectId, { item: 'budget', reason: 'بند غير موجود في شروط البدء إطلاقًا' })), code('item'));
  // الاعتماد بلا طلب قائم مرفوض: لا إعفاء يولد من يد واحدة.
  assert.equal(refused(() => f.authorise('client_po')).code, 'exemption_request_required');
  f.request('client_po');
  assert.equal(refused(() => f.request('client_po')).code, 'already_requested', 'طلب واحد معلق للشرط الواحد');
  // بلا تصريح الإعفاء لا اعتماد، ولو كان عضوًا في المشروع وصاحب الملف.
  assert.throws(() => f.authorise('client_po', 'employee'), code('not_permitted'));
  // المدير يطلب إعفاء الدفعة ثم يحاول اعتماد طلبه: فصل المهام يرفضه في الكود وفي القاعدة معًا.
  const own = f.request('advance', 'manager');
  const selfError = refused(() => f.authorise('advance', 'manager'));
  assert.equal(selfError.code, 'separation_of_duties');
  assert.ok(selfError.details.refusal.missing[0].owner.length > 0, 'الرفض يسمّي من يعتمد بدلًا منه');
  assert.throws(() => db.prepare('INSERT INTO readiness_waivers(id,tenant_id,project_id,item,reason,waived_by,waived_at,request_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', projectId, 'advance', 'إدراج مباشر يعتمد فيه الطالب طلبه بنفسه', 'manager', now(), own.id), /someone other than its requester/);
  // الاعتماد السليم: طلبته الموظفة واعتمده المدير، فيُرفع شرط أمر الشراء وحده ويبقى الآخر.
  const after = f.authorise('client_po');
  assert.equal(after.client_purchase_order.waiver.waived_by_name, 'مدير الفريق التجريبي');
  assert.equal(after.client_purchase_order.waiver.requested_by_name, 'الموظفة التجريبية');
  assert.equal(after.state, 'awaiting_advance', 'إعفاء شرط لا يعفي الآخر');
  assert.equal(refused(() => f.request('client_po')).code, 'already_waived');
  // الرفض بسبب مكتوب يغلق الطلب ولا يرفع الشرط.
  assert.throws(() => tx(() => axes.declineReadinessWaiver(db, users.manager, own.id, { note: 'اعتماد ذاتي مرفوض' })), code('separation_of_duties'));
  tx(() => axes.declineReadinessWaiver(db, users.lead, own.id, { note: 'لا قرار مكتوب من العميل يبرر البدء قبل الدفعة' }));
  assert.equal(f.read().readiness.state, 'awaiting_advance');
  assert.equal(refused(() => f.authorise('advance', 'lead')).code, 'exemption_request_required', 'الطلب المرفوض لا يُعتمد بعده');
  // الأثر: الطلب والاعتماد والرفض في سجل التدقيق، والإعفاء لا يُعدَّل ولا يُحذف.
  const actions = db.prepare("SELECT action FROM audit_events WHERE action LIKE 'axes.readiness%' ORDER BY seq").all().map(r => r.action);
  assert.deepEqual(actions, ['axes.readiness_waiver_requested', 'axes.readiness_waiver_requested', 'axes.readiness_waived', 'axes.readiness_waiver_declined']);
  const waiver = db.prepare('SELECT * FROM readiness_waivers WHERE project_id=?').get(projectId);
  assert.throws(() => db.prepare("UPDATE readiness_waivers SET reason='سبب بديل يُكتب بعد الاعتماد' WHERE id=?").run(waiver.id), /never edited/);
  assert.throws(() => db.prepare('DELETE FROM readiness_waivers WHERE id=?').run(waiver.id), /retained/);
  assert.ok(verifyAudit(db));
});

test('ER-04: the exemption is rechecked at the moment of action — withdrawn, or held by someone who lost the authority, it no longer opens the gate', t => {
  const f = fixture(t), { db, users, tx } = f;
  f.terms();
  f.request('client_po'); f.authorise('client_po');
  f.request('advance'); f.authorise('advance');
  assert.equal(f.read().readiness.state, 'ready_by_waiver');
  assert.equal(f.deliver(0).deliveries.length, 1);
  // الاعتماد الذي فقد سنده: سُحب تصريح الإعفاء ممن اعتمد. الفعل التالي يُفحص من جديد فيقف ويقول لماذا.
  const grantRow = db.prepare("SELECT id FROM access_grants WHERE user_id='manager' AND capability='projects.readiness.waive' AND revoked_at IS NULL").get();
  tx(() => revokeAccess(db, users.admin, grantRow.id, { reason: 'انتهت مهمة الإعفاء في التجربة المصطنعة' }));
  const stale = refused(() => f.deliver(1));
  assert.equal(stale.code, 'advance_required');
  assert.deepEqual(stale.details.refusal.missing.map(item => item.document), ['أمر شراء العميل', 'الدفعة المقدمة المؤكدة']);
  assert.match(stale.details.refusal.missing[0].why, /ما عاد يحمل تصريح الإعفاء/);
  assert.equal(f.read().readiness.client_purchase_order.stale_waiver.waived_by_name, 'مدير الفريق التجريبي');
  // الإعفاء الساري يُسحب بسبب مكتوب ممن يحمل التصريح، فيقف الفعل التالي كذلك.
  const second = fixture(t, { registration: 'ER-200' });
  second.terms();
  second.request('client_po'); second.authorise('client_po');
  second.request('advance'); second.authorise('advance');
  const live = second.read().readiness.waivers.find(w => w.item === 'advance');
  assert.throws(() => second.tx(() => axes.withdrawReadinessWaiver(second.db, second.users.employee, live.id, { reason: 'سحب بلا تصريح لا يقع' })), code('not_permitted'));
  second.tx(() => axes.withdrawReadinessWaiver(second.db, second.users.lead, live.id, { reason: 'وصل قرار العميل بصرف الدفعة قبل المباشرة، فلا حاجة للإعفاء' }));
  assert.equal(refused(() => second.tx(() => axes.withdrawReadinessWaiver(second.db, second.users.lead, live.id, { reason: 'سحب مكرر للإعفاء نفسه' }))).code, 'not_waived');
  assert.deepEqual(refused(() => second.deliver(0)).details.refusal.missing.map(item => item.document), ['الدفعة المقدمة المؤكدة']);
  assert.ok(verifyAudit(db) && verifyAudit(second.db));
});

test('ER-05: partial, duplicate and reversed receipts — only money that arrived once and stayed opens the gate', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.terms();
  f.confirmPo(f.recordPo());
  // جزئي: المسجَّل 345 والمقبوض 300؛ الناقص يُسمّى برقمه.
  const first = f.recordAdvance('345.00');
  f.confirmAdvance(first, '300.00', 'ER-BANK-001');
  assert.match(f.read().readiness.blockers[0].why, /300\.00.*345\.00/);
  // مكرر: الحوالة نفسها بحروف أو مسافات مختلفة، وتكرار التأكيد نفسه.
  const second = f.recordAdvance('45.00');
  assert.equal(refused(() => f.confirmAdvance(second, '45.00', ' er-bank-001 ')).code, 'duplicate_receipt_reference');
  assert.equal(refused(() => f.confirmAdvance(first, '300.00', 'ER-BANK-009')).code, 'not_found', 'تأكيد مكرر للسجل نفسه لا يقع');
  assert.throws(() => db.prepare("UPDATE advance_invoices SET status='paid',paid_minor=4500,received_on=?,confirmed_by='billing-b',confirmed_at=?,receipt_reference='ER-BANK-001',version=version+1 WHERE id=?").run(riyadh(), now(), second.id), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare("UPDATE advance_invoices SET status='paid',paid_minor=4500,received_on=?,confirmed_by='billing-b',confirmed_at=?,version=version+1 WHERE id=?").run(riyadh(), now(), second.id), /names its bank reference/);
  f.confirmAdvance(second, '45.00', 'ER-BANK-002');
  assert.equal(f.read().readiness.state, 'ready');
  // الترسية على مورد تمضي والشروط مكتملة.
  fundProject(db, projectId, 'ER-CC-1', '1000.00');
  approveVendors(db, ['er-vendor-a', 'er-vendor-b', 'er-vendor-c']);
  const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  let p = pAct('employee', tx(() => createPurchase(db, users.employee, { project_id: projectId, title: 'تصوير مصطنع', specification: 'يوم تصوير واحد بالمواصفات المسجلة', cost_center: 'ER-CC-1',
    due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '600.00', budget_evidence: 'مخصص اختبار داخلي', currency: 'SAR' })), 'submit');
  for (const [key, price] of [['er-vendor-a', '500.00'], ['er-vendor-b', '520.00'], ['er-vendor-c', '540.00']])
    p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد اختبار ' + key, unit_price: price, technical_assessment: 'العرض يطابق المواصفات', financial_terms: 'بعد الاستلام', delivery_date: '2099-10-20', evidence: 'عرض مصطنع ' + key });
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'ER-VENDOR-A').id, note: 'أقل سعر مطابق بعد اكتمال شروط البدء' });
  // معكوس: ارتدت حوالة الـ45 بعد الترسية. الانعكاس لا يتجاوز الرصيد المؤكد، ولا يقع على ما لم يُؤكد.
  const pending = f.recordAdvance('10.00');
  assert.equal(refused(() => tx(() => billing.reverseAdvance(db, users['billing-a'], pending.id, { amount: '10.00', reason: 'انعكاس دفعة لم تُقبض', evidence: 'لا إشعار ارتداد لما لم يصل' }))).code, 'advance_not_confirmed');
  assert.equal(refused(() => tx(() => billing.reverseAdvance(db, users['billing-a'], second.id, { amount: '46.00', reason: 'ارتدت الحوالة من بنك العميل', evidence: 'إشعار ارتداد مصطنع من البنك' }))).code, 'reversal_exceeds_balance');
  assert.throws(() => tx(() => billing.reverseAdvance(db, users.employee, second.id, { amount: '45.00', reason: 'انعكاس بلا تصريح الفوترة', evidence: 'إشعار ارتداد مصطنع من البنك' })), code('not_permitted'));
  tx(() => billing.reverseAdvance(db, users['billing-a'], second.id, { amount: '45.00', reason: 'ارتدت الحوالة من بنك العميل', evidence: 'إشعار ارتداد مصطنع من البنك' }));
  const gate = axes.advanceGate(db, '36t', projectId);
  assert.equal(gate.confirmed_minor, 30000);
  assert.equal(gate.reversed_minor, 4500);
  // الفعل التالي بعد الانعكاس يُفحص من جديد: أمر الشراء للمورد لا يمضي.
  assert.equal(refused(() => pAct('manager', p, 'approve_order', { terms: 'يوم تصوير واحد', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء بعد ارتداد الحوالة' })).code, 'advance_required');
  // المعكوس لا يُسحب منه ولا يُعكس مرة ثانية، والقاعدة تفرض ذلك لا الشاشة وحدها.
  assert.equal(refused(() => tx(() => billing.reverseAdvance(db, users['billing-a'], second.id, { amount: '1.00', reason: 'انعكاس ثانٍ لما انعكس كله', evidence: 'إشعار ارتداد مكرر مصطنع' }))).code, 'reversal_exceeds_balance');
  const draw = tx(() => billing.planDraw(db, users['billing-a'], second.id, { target_reference: 'فاتورة لاحقة مصطنعة', amount: '10.00' }));
  assert.equal(refused(() => tx(() => billing.applyDraw(db, users['billing-a'], draw.id, { version: 1, amount: '10.00', note: '' }))).code, 'draw_exceeds_paid');
  const reversal = db.prepare('SELECT * FROM advance_reversals WHERE advance_id=?').get(second.id);
  assert.throws(() => db.prepare('UPDATE advance_reversals SET amount_minor=1 WHERE id=?').run(reversal.id), /not an edit/);
  assert.throws(() => db.prepare('DELETE FROM advance_reversals WHERE id=?').run(reversal.id), /not an edit/);
  // الإيراد المؤجل يقرأ الانعكاس أيضًا: لا تقول ورقة العمل إن مالًا مقبوضًا بقي وقد ارتد.
  assert.equal(billing.deferredRevenue(db, users['billing-a']).total_minor, 30000);
  assert.ok(verifyAudit(db));
});

test('ER-06: the customer PO is versioned and append-only — superseded, expired or unconfirmed versions never satisfy the gate', t => {
  const f = fixture(t), { db, users, tx } = f;
  f.terms({ advance: null });
  // قبل توثيق الاتفاق لا أمر شراء: الربط بالاتفاق شرط. ملف ثانٍ يقف عند العرض المعتمد.
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let early = tx(() => dealFor(db, users.employee, { name: 'فرصة قبل الاتفاق', registration_number: 'ER-EARLY', contact: 'جهة اتصال', source: 'اختبار', sector: 'قطاع' }));
  early = act('manager', act('employee', early, 'qualify', { need: 'احتياج مصطنع مبكر', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل', service_fit: 'ضمن الخدمات' }), 'approve_qualification', { note: 'تأهيل مصطنع' });
  early = act('manager', act('employee', act('employee', early, 'save_quote', boundQuote(db, early.id, quote())), 'submit_quote'), 'approve_quote', { note: 'مراجعة مصطنعة' });
  assert.equal(early.status, 'quote_approved');
  assert.equal(refused(() => tx(() => axes.recordClientPurchaseOrder(db, users.employee, early.id, f.order({ po_number: 'ER-PO-EARLY' })))).code, 'agreement_required');
  // التسجيل والتأكيد بيدين، ولا يؤكد إلا من له ذلك.
  assert.throws(() => f.recordPo({}, 'outsider'), code('not_permitted'));
  const first = f.recordPo();
  assert.throws(() => f.confirmPo(first, 'outsider'), code('not_permitted'));
  // تكرار الإنشاء نفسه لا يصنع أمرًا ثانيًا، ورقم أمر الشراء لا يُعلَّق على ملف آخر.
  assert.equal(refused(() => f.recordPo()).code, 'purchase_order_exists');
  // النسخة الثانية تحل محل الأولى قبل تأكيدها؛ الأولى لا تُؤكَّد بعدها (اعتماد على نسخة فات أوانها).
  const second = f.recordPo({ supersedes_id: first.id, amount: '1100.00', evidence: 'تصحيح قيمة أمر الشراء محفوظ في ملف الاتفاق' });
  assert.equal(refused(() => f.confirmPo(first)).code, 'superseded');
  // تزامن: قارئان رأيا النسخة الأولى، والثاني يحاول البناء عليها بعد أن حل محلها غيرها.
  assert.equal(refused(() => f.recordPo({ supersedes_id: first.id, evidence: 'نسخة مبنية على قراءة قديمة لأمر الشراء' })).code, 'stale_version');
  assert.equal(refused(() => f.confirmPo(second, 'manager', 7)).code, 'stale_version');
  f.confirmPo(second);
  assert.equal(f.read().readiness.state, 'ready');
  // منتهية الصلاحية لا تغطي، والشاشة تقول ذلك باسمه.
  const expired = f.recordPo({ supersedes_id: second.id, issued_on: riyadh(-30), valid_until: riyadh(-1), evidence: 'نسخة بصلاحية منتهية محفوظة في ملف الاتفاق' });
  f.confirmPo(expired);
  const readiness = f.read().readiness;
  assert.equal(readiness.state, 'awaiting_client_po');
  assert.equal(readiness.client_purchase_order.current.expired, true);
  assert.match(readiness.blockers[0].why, /انتهت صلاحيتها/);
  assert.equal(refused(() => f.deliver(0)).code, 'advance_required');
  assert.throws(() => f.recordPo({ supersedes_id: expired.id, issued_on: riyadh(1), evidence: 'إصدار في المستقبل لا يُقبل' }), code('issued_on'));
  assert.throws(() => f.recordPo({ supersedes_id: expired.id, issued_on: riyadh(-2), valid_until: riyadh(-3), evidence: 'صلاحية قبل الإصدار لا تُقبل' }), code('valid_until'));
  // النسخ باقية بترتيبها، ولا تُعدَّل ولا تُحذف ولا تُضاف خارج سلسلتها.
  assert.deepEqual(readiness.client_purchase_order.history.map(v => [v.revision, v.status, v.superseded]), [[1, 'recorded', true], [2, 'confirmed', true], [3, 'confirmed', false]]);
  const row = db.prepare('SELECT * FROM client_purchase_orders WHERE id=?').get(second.id);
  assert.throws(() => db.prepare('UPDATE client_purchase_orders SET amount_minor=1 WHERE id=?').run(row.id), /version is final/);
  assert.throws(() => db.prepare('DELETE FROM client_purchase_orders WHERE id=?').run(row.id), /retained/);
  assert.throws(() => db.prepare(`INSERT INTO client_purchase_orders(id,tenant_id,case_id,contract_id,project_id,client_id,revision,supersedes_id,po_number,issued_on,valid_until,scope,currency,amount_minor,customer_representative,evidence,status,recorded_by,recorded_at)
    VALUES(?,?,?,?,?,?,2,?,?,?,?,?,?,?,?,?,'recorded','employee',?)`).run(randomUUID(), '36t', row.case_id, row.contract_id, row.project_id, row.client_id, first.id, 'ER-PO-X', riyadh(), '2099-12-31', 'نسخة تتفرع من وسط السلسلة', 'SAR', 1, 'ممثل مصطنع', 'إدراج مباشر يتفرع من نسخة قديمة', now()), /extend its own case chain/);
  // تمديد بنسخة رابعة يعيد الجاهزية.
  f.confirmPo(f.recordPo({ supersedes_id: expired.id, evidence: 'تمديد صلاحية أمر الشراء محفوظ في ملف الاتفاق' }));
  assert.equal(f.deliver(0).deliveries.length, 1);
  assert.ok(verifyAudit(db));
});

test('ER-07: the order is checked against its own case — wrong client, opportunity, agreement, project or tenant is refused', t => {
  const f = fixture(t), { db, users, tx } = f;
  f.terms({ advance: null });
  // عميل وملف ثانٍ في الكيان نفسه: «الفرصة الخطأ» تُختبر داخل الكيان، لا بين قاعدتين.
  const stranger = tx(() => createClient(db, users.employee, { legal_name: 'جهة لا تخص الملف', trade_name: '', sector: 'تجريبي', status: 'active', notes: '' }));
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  // الملف الثاني يُفتح من ملف «الجهة الثانية» نفسه، فعميله غير عميل الملف الأول.
  tx(() => clientAction(db, users.employee, stranger.id, 'set_registration', { registration_number: 'ER-TWIN' }));
  let twin = tx(() => createLead(db, users.employee, { client_id: stranger.id, contact: 'جهة اتصال', source: 'اختبار' }));
  twin = act('manager', act('employee', twin, 'qualify', { need: 'احتياج مصطنع ثانٍ', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل', service_fit: 'ضمن الخدمات' }), 'approve_qualification', { note: 'تأهيل مصطنع' });
  twin = act('manager', act('employee', act('employee', twin, 'save_quote', boundQuote(db, twin.id, quote())), 'submit_quote'), 'approve_quote', { note: 'مراجعة مصطنعة' });
  twin = act('employee', twin, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع ثانٍ للاختبار', customer_representative: 'ممثل مصطنع' });
  twin = act('manager', twin, 'create_project', { member_ids: [] });
  // الربط يُطابَق مع الملف: عميل غيره، واتفاق غيره، ومشروع غيره — كلها من ملفٍ حقيقي في الكيان نفسه.
  assert.equal(refused(() => f.recordPo({ client_id: stranger.id })).code, 'wrong_client');
  assert.equal(refused(() => f.recordPo({ contract_id: twin.contract.id })).code, 'wrong_agreement');
  assert.equal(refused(() => f.recordPo({ project_id: twin.project_id })).code, 'wrong_project');
  const mine = f.recordPo();
  // الفرصة الخطأ: نسخة تبني على أمرٍ يخص ملفًا آخر، أو رقم أمرٍ معلّق على ملف آخر.
  const twinOrder = overrides => tx(() => axes.recordClientPurchaseOrder(db, users.employee, twin.id, f.order({ contract_id: twin.contract.id, project_id: twin.project_id, client_id: stranger.id, po_number: 'ER-PO-TWIN', ...overrides })));
  assert.equal(refused(() => twinOrder({ supersedes_id: mine.id })).code, 'wrong_opportunity');
  assert.equal(refused(() => twinOrder({ po_number: 'er-po-1' })).code, 'duplicate_purchase_order', 'الرقم يُطبَّع قبل المقارنة');
  assert.equal(twinOrder({}).revision, 1, 'رقم آخر على ملفه الصحيح يُقبل');
  // كيان آخر: الملف والأمر والمشروع غير موجودة له أصلًا.
  assert.throws(() => tx(() => axes.recordClientPurchaseOrder(db, users.external, f.caseId, f.order({ po_number: 'ER-PO-EXT' }))), code('not_found'));
  assert.throws(() => tx(() => axes.confirmClientPurchaseOrder(db, users.external, mine.id, { version: 1, note: 'تأكيد من كيان آخر' })), code('not_found'));
  assert.throws(() => tx(() => axes.requestReadinessWaiver(db, users.external, f.projectId, { item: 'client_po', reason: 'طلب إعفاء من كيان آخر لا يصل أبدًا' })), code('project_not_found'));
  // والقاعدة ترفض الربط المختلط من خارج الكود: أمر شراء أو طلب إعفاء أو دفعة بكيانٍ غير كيان ملفها أو مشروعها.
  assert.throws(() => db.prepare(`INSERT INTO client_purchase_orders(id,tenant_id,case_id,contract_id,project_id,client_id,revision,supersedes_id,po_number,issued_on,valid_until,scope,currency,amount_minor,customer_representative,evidence,status,recorded_by,recorded_at)
    VALUES(?,'isolated',?,?,?,?,2,?,'ER-PO-ISO',?,'2099-12-31','نطاق مصطنع لاختبار العزل','SAR',100,'ممثل مصطنع','إدراج مباشر بكيان مختلف عن الملف','recorded','external',?)`)
    .run(randomUUID(), twin.id, twin.contract.id, twin.project_id, stranger.id, db.prepare('SELECT id FROM client_purchase_orders WHERE case_id=?').get(twin.id).id, riyadh(), now()), /match its agreement, project, client and tenant/);
  assert.throws(() => db.prepare("INSERT INTO readiness_waiver_requests(id,tenant_id,project_id,item,reason,requested_by,requested_at,status) VALUES(?,'isolated',?,'advance','طلب مصطنع بكيان مختلف عن المشروع','external',?,'pending')").run(randomUUID(), f.projectId, now()), /FOREIGN KEY constraint failed/);
  assert.throws(() => db.prepare("INSERT INTO advance_invoices(id,tenant_id,client_id,project_id,description,agreement_reference,currency,amount_minor,status,recorded_by,created_at,updated_at) VALUES(?,'isolated',?,?,'دفعة مصطنعة','مرجع مصطنع للعزل','SAR',100,'recorded','external',?,?)").run(randomUUID(), f.client.id, f.projectId, now(), now()), /project of its own tenant/);
  assert.ok(verifyAudit(db));
});

test('ER-08: another tenant\'s receipt never satisfies the gate, and a bank reference is unique within a tenant only', t => {
  const f = fixture(t), { db } = f;
  f.terms();
  f.confirmPo(f.recordPo());
  // الكيان المعزول: عميل ومشروع وقبض مؤكد بالمرجع نفسه، مُدخلة كما هي في قاعدتها.
  db.exec(`INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at,custom_fields) VALUES('iso-client','isolated','C-0001','عميل الكيان المعزول','','تجريبي','active','external','','${now()}','${now()}','{}');
    INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('iso-project','isolated','مشروع الكيان المعزول','موجز مصطنع','external','${now()}');`);
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-confirmer','isolated','other','iso-confirmer','مؤكد الكيان المعزول','unused-test-hash','employee',NULL);`);
  db.prepare(`INSERT INTO advance_invoices(id,tenant_id,client_id,project_id,description,agreement_reference,currency,amount_minor,paid_minor,received_on,status,recorded_by,confirmed_by,confirmed_at,receipt_reference,created_at,updated_at)
    VALUES('iso-advance','isolated','iso-client','iso-project','دفعة الكيان المعزول','مرجع اتفاق الكيان المعزول','SAR',34500,34500,?,'paid','external','iso-confirmer',?,'ER-SHARED-1',?,?)`).run(riyadh(), now(), now(), now());
  assert.equal(axes.advanceGate(db, '36t', f.projectId).confirmed_minor, 0, 'قبض كيان آخر لا يُحسب هنا');
  // المرجع نفسه في كياننا يُقبل: التفرد داخل الكيان، ولا يكشف وجودَ مرجع عند غيره.
  f.advance('345.00', 'ER-SHARED-1');
  assert.equal(f.read().readiness.state, 'ready');
  assert.ok(verifyAudit(db));
});

test('ER-09: concurrency — the gate and the action share one write lock, so a reversal racing a delivery submission lands before it or after it, never between', t => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-readiness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.db');
  const first = openDb(path);
  seed(first, PASSWORD);
  first.close();
  // المُثبِّت نفسه على ملف: اتصالان مستقلان بالقاعدة نفسها، كما يعمل خادمان على ملف واحد.
  const f = fixtureOn(t, openDb(path));
  f.terms();
  f.confirmPo(f.recordPo());
  const second = f.recordAdvance('345.00');
  f.confirmAdvance(second, '345.00', 'ER-RACE-1');
  const other = openDb(path);
  t.after(() => other.close());
  other.exec('PRAGMA busy_timeout=0');
  // الاتصال الأول بدأ عكس الحوالة ولم يُنهِ معاملته بعد.
  f.db.exec('BEGIN IMMEDIATE');
  billing.reverseAdvance(f.db, f.users['billing-a'], second.id, { amount: '345.00', reason: 'ارتدت الحوالة من بنك العميل', evidence: 'إشعار ارتداد مصطنع من البنك' });
  // الثاني لا يقرأ نصف حالة ولا يفعل على فحص قديم: لا يبدأ معاملته أصلًا حتى يُنهي الأول.
  const users = Object.fromEntries(other.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const view = listCommercial(other, users.employee).find(x => x.id === f.caseId);
  assert.throws(() => transaction(other, () => commercialAction(other, users.employee, f.caseId, 'submit_delivery', { version: view.version, line_index: 0, evidence: 'تقديم متزامن مع ارتداد الحوالة' })), /database is locked/);
  f.db.exec('COMMIT');
  // بعد الانعكاس المُلتزم يُرفض الفعل بسببه المسمّى.
  assert.equal(refused(() => transaction(other, () => commercialAction(other, users.employee, f.caseId, 'submit_delivery', { version: view.version, line_index: 0, evidence: 'تقديم بعد ارتداد الحوالة' }))).code, 'advance_required');
  assert.ok(verifyAudit(other));
});

// المُثبِّت نفسه على قاعدة جاهزة (للتزامن): بلا بذر ثانٍ.
function fixtureOn(t, db) {
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('lead','36t','creative','lead','مديرة مشروع مصطنعة','unused-test-hash','pm','manager'),
    ('billing-a','36t','ops','billing-a','مسجّلة الدفعات المصطنعة','unused-test-hash','employee',NULL),
    ('billing-b','36t','ops','billing-b','مؤكدة القبض المصطنعة','unused-test-hash','employee',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار التزامن' }));
  grant('employee', 'clients.manage');
  for (const who of ['billing-a', 'billing-b']) grant(who, 'billing.recurring.manage');
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, { name: 'عميل التزامن المصطنع', registration_number: 'ER-RACE', contact: 'جهة اتصال', source: 'اختبار', sector: 'قطاع' }));
  c = act('manager', act('employee', c, 'qualify', { need: 'احتياج مصطنع للتزامن', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل', service_fit: 'ضمن الخدمات' }), 'approve_qualification', { note: 'تأهيل مصطنع' });
  c = act('manager', act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, quote())), 'submit_quote'), 'approve_quote', { note: 'مراجعة مصطنعة' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع للتزامن', customer_representative: 'ممثل مصطنع' });
  c = act('manager', c, 'create_project', { member_ids: ['lead'] });
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(c.client_id);
  const terms = () => tx(() => axes.recordPaymentTerms(db, users.employee, c.id, { terms: [
    { label: 'الدفعة المقدمة عند التوقيع', amount: '345.00', due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' },
    { label: 'الباقي عند القبول', amount: '805.00', due_on: '2099-06-01', condition: 'عند القبول', condition_kind: 'acceptance', condition_lines: [0, 1] }] }));
  const recordPo = () => tx(() => axes.recordClientPurchaseOrder(db, users.employee, c.id, { po_number: 'ER-PO-RACE', issued_on: riyadh(), valid_until: '2099-12-31', amount: '1150.00',
    scope: 'المخرجان المتفق عليهما في الاتفاق المسجل', customer_representative: 'ممثل مصطنع', evidence: 'نسخة أمر الشراء المصطنع محفوظة', contract_id: c.contract.id, project_id: c.project_id, client_id: client.id }));
  const confirmPo = po => tx(() => axes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قابلنا الرقم والقيمة بالأصل' }));
  const recordAdvance = amount => tx(() => billing.recordAdvance(db, users['billing-a'], { client_id: client.id, schedule_id: '', project_id: c.project_id, description: 'دفعة التزامن', agreement_reference: 'بند الدفعات المصطنع', amount }));
  const confirmAdvance = (row, amount, reference) => tx(() => billing.confirmAdvance(db, users['billing-b'], row.id, { version: 1, amount, received_on: riyadh(), evidence: 'إشعار تحويل مصطنع', reference }));
  return { db, users, caseId: c.id, terms, recordPo, confirmPo, recordAdvance, confirmAdvance };
}

test('ER-10: the actions are reachable over HTTP with the platform session, CSRF and idempotency, and the commercial screen names the blockers', async t => {
  const f = fixture(t, { registration: 'ER-HTTP' }), { db } = f;
  const app = createApp(db), sessions = {};
  for (const username of ['employee', 'manager', 'lead', 'billing-a', 'billing-b']) {
    db.prepare('UPDATE users SET password_hash=(SELECT password_hash FROM users WHERE id=?) WHERE id=?').run('admin', username);
    const response = await dispatch(app, { method: 'POST', path: '/api/login', body: { username, password: PASSWORD } });
    assert.equal(response.status, 200, response.text);
    sessions[username] = { cookie: response.headers['Set-Cookie'].split(';')[0], csrf: response.json().csrf };
  }
  const call = async (who, path, body, key) => {
    const headers = { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) };
    return dispatch(app, { method: body === undefined ? 'GET' : 'POST', path: '/api' + path, headers, body });
  };
  let response = await call('employee', `/commercial/${f.caseId}/payment-terms`, { terms: [
    { label: 'الدفعة المقدمة عند التوقيع', amount: '345.00', due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' },
    { label: 'الباقي عند القبول', amount: '805.00', due_on: '2099-06-01', condition: 'عند القبول', condition_kind: 'acceptance', condition_lines: [0, 1] }], requires_client_po: true });
  assert.equal(response.status, 201, response.text);
  // الإنشاء بمفتاح تكرار: الإعادة بالمفتاح نفسه تعيد السجل نفسه، ولا نسخة ثانية.
  const key = 'er-http-po-key-000001';
  response = await call('employee', `/commercial/${f.caseId}/purchase-order`, f.order(), key);
  assert.equal(response.status, 201, response.text);
  const po = response.json();
  assert.equal((await call('employee', `/commercial/${f.caseId}/purchase-order`, f.order(), key)).json().id, po.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_purchase_orders WHERE case_id=?').get(f.caseId).n, 1);
  assert.equal((await call('employee', `/commercial/${f.caseId}/purchase-order`, f.order())).status, 400, 'بلا مفتاح تكرار لا إنشاء');
  // الرفض المكتوب يصل الواجهة مهيكلًا.
  response = await call('employee', `/client-purchase-orders/${po.id}/confirm`, { version: 1, note: 'تأكيد ذاتي' });
  assert.equal(response.status, 403);
  assert.equal((await call('manager', `/client-purchase-orders/${po.id}/confirm`, { version: 1, note: 'قابلنا الرقم بالأصل' })).status, 201);
  response = await call('employee', `/commercial/${f.caseId}/submit_delivery`, { version: f.read().version, line_index: 0, evidence: 'تقديم عبر المسار قبل الدفعة' });
  assert.equal(response.status, 409);
  assert.deepEqual(response.json().error.details.refusal.missing.map(m => m.document), ['الدفعة المقدمة المؤكدة']);
  // طلب الإعفاء واعتماده من شخصين، ثم سحبه.
  response = await call('employee', `/projects/${f.projectId}/readiness-waiver-requests`, { item: 'advance', reason: 'العميل جهة حكومية تصرف الدفعة بعد المباشرة بقرار مكتوب' }, 'er-http-request-0001');
  assert.equal(response.status, 201, response.text);
  assert.equal((await call('manager', `/projects/${f.projectId}/readiness-waivers`, { item: 'advance', reason: 'اطلعت على قرار العميل المكتوب وأعفيت الشرط لهذا المشروع' })).status, 201);
  const waiver = f.read().readiness.waivers.find(w => w.item === 'advance');
  assert.equal((await call('lead', `/readiness-waivers/${waiver.id}/withdraw`, { reason: 'وصل قرار العميل بصرف الدفعة قبل المباشرة' })).status, 201);
  // عكس القبض بمفتاح تكرار: الإعادة لا تعكس مرتين.
  const row = f.recordAdvance('345.00');
  f.confirmAdvance(row, '345.00', 'ER-HTTP-TRF');
  const reverse = { amount: '100.00', reason: 'ارتد جزء من الحوالة', evidence: 'إشعار ارتداد مصطنع من البنك' };
  assert.equal((await call('billing-a', `/advances/${row.id}/reverse`, reverse, 'er-http-reverse-001')).status, 201);
  assert.equal((await call('billing-a', `/advances/${row.id}/reverse`, reverse, 'er-http-reverse-001')).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advance_reversals WHERE advance_id=?').get(row.id).n, 1);
  // الشاشة التجارية: القائمة تحمل الجاهزية، والرسم يسمّي الناقص ومالكه، ونماذج الأفعال تصل مساراتها.
  const list = (await call('employee', '/commercial')).json(), record = list.find(r => r.id === f.caseId);
  assert.equal(record.readiness.state, 'awaiting_advance');
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const html = commercialUI.render({ rows: list, team: [], user: f.users.employee }, { e, ui: kit(e, x => x), button: (action, id, label) => `<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>` });
  assert.match(html, /جاهزية البدء/);
  assert.match(html, /الدفعة المقدمة المؤكدة/);
  assert.match(html, /data-operation="request_readiness_waiver"/);
  const managerRecord = (await call('manager', '/commercial')).json().find(r => r.id === f.caseId);
  assert.ok(managerRecord.readiness.actions.includes('record_client_po'), 'مديره المباشر يرى تسجيل نسخة جديدة');
  const spec = commercialUI.form('record_client_po', f.caseId, { rows: [managerRecord], team: [], user: f.users.manager });
  assert.equal(spec.endpoint, `/commercial/${f.caseId}/purchase-order`);
  assert.equal(spec.idempotent, true);
  const payload = spec.toPayload({ po_number: 'ER-PO-2', issued_on: riyadh(), valid_until: '2099-12-31', amount: '1150.00', scope: 'تصحيح نطاق أمر الشراء', customer_representative: 'ممثل', evidence: 'تصحيح مصطنع محفوظ' });
  assert.deepEqual([payload.contract_id, payload.project_id, payload.client_id, payload.supersedes_id], [f.contractId, f.projectId, f.client.id, po.id]);
  assert.ok(verifyAudit(db));
});

test('ER-11: the billing screen asks for the bank reference, offers the reversal once, and links an advance to its project', t => {
  const f = fixture(t, { registration: 'ER-UI' }), { db, users } = f;
  f.terms();
  const row = f.recordAdvance('345.00');
  let board = billing.schedulesBoard(db, users['billing-b']);
  assert.deepEqual(board.projects.map(p => [p.id, p.client_id]), [[f.projectId, f.client.id]], 'المشروع المربوط بعميله يظهر للربط');
  const record = billingSchedulesUI.form('record_advance', '', board);
  assert.equal(record.toPayload({ client_id: f.client.id, schedule_id: '', project_id: f.projectId, description: 'وصف', agreement_reference: 'مرجع', amount: '1.00' }).project_id, f.projectId);
  const confirm = billingSchedulesUI.form('confirm_advance', row.id, board);
  assert.ok(confirm.fields.some(field => field.name === 'reference'));
  assert.equal(confirm.toPayload({ amount: '345.00', received_on: riyadh(), evidence: 'إشعار', reference: 'ER-UI-1' }).reference, 'ER-UI-1');
  f.confirmAdvance(row, '345.00', 'ER-UI-1');
  board = billing.schedulesBoard(db, users['billing-a']);
  const advance = board.advances.find(a => a.id === row.id);
  assert.deepEqual(advance.actions, ['plan_draw', 'reverse_advance']);
  const reverse = billingSchedulesUI.form('reverse_advance', row.id, board);
  assert.equal(reverse.endpoint, `/advances/${row.id}/reverse`);
  assert.equal(reverse.idempotent, true, 'إعادة الإرسال لا تعكس الحوالة مرتين');
  f.tx(() => billing.reverseAdvance(db, users['billing-a'], row.id, { amount: '345.00', reason: 'ارتدت الحوالة كاملة', evidence: 'إشعار ارتداد مصطنع من البنك' }));
  const after = billing.schedulesBoard(db, users['billing-a']).advances.find(a => a.id === row.id);
  assert.equal(after.balance_minor, 0);
  assert.deepEqual(after.actions, [], 'ما بقي رصيد يُسحب أو يُعكس');
  assert.ok(verifyAudit(db));
});
