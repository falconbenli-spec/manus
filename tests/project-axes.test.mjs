import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, can } from '../app/access.mjs';
import { projectMarginFigures } from '../app/profitability.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor } from './proposal-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createTask } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as axes from '../app/project-axes.mjs';
import { registerApprover } from '../app/client-approvals.mjs';
import { fundProject } from './budget-fixture.mjs';

const code = value => error => error.code === value;
// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const COMMENCE = () => ({ start_on: today(), valid_until: '2099-12-31', site_or_channel: 'موقع التصوير المصطنع', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام' });
const leadInput = () => ({ name: 'عميل محاور مصطنع', registration_number: 'AXES-100', contact: 'جهة اتصال مصطنعة', source: 'اختبار محلي', sector: 'قطاع مصطنع' });
const qualificationInput = () => ({ need: 'حملة متعددة الإدارات لاختبار المحاور', budget: '100000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'خدمات إنتاج ومحتوى ضمن التجربة' });
const quoteInput = () => ({ scope: 'مخرجان مصطنعان بمعايير قبول محددة', currency: 'SAR', valid_until: '2099-12-01', lines: [
  { description: 'هوية بصرية', quantity: '1', unit_price: '60000.00', unit_cost: '20000.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد الهوية بثلاثة عناصر', revisions: 2 },
  { description: 'فيلم قصير', quantity: '1', unit_price: '40000.00', unit_cost: '15000.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد النسخة النهائية من الفيلم', revisions: 1 }
] });

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-project-axes-tests-only');
  t.after(() => db.close());
  // مدير مشروع في الإدارة المالكة، وإدارة ثانية بمديرها وموظفها: مشروع متعدد الإدارات.
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('pm-axes','36t','creative','pm-axes','مدير مشروع مصطنع','unused-test-hash','pm','manager'),
    ('ops-manager','36t','ops','ops-manager','مدير الإنتاج المصطنع','unused-test-hash','manager',NULL),
    ('producer','36t','ops','producer','منتج مصطنع','unused-test-hash','employee','ops-manager'),
    ('finance-closer','36t','ops','finance-closer','معتمدة الإقفال المالي','unused-test-hash','employee','ops-manager'),
    ('billing-a','36t','ops','billing-a','مسجّلة الدفعة المقدمة','unused-test-hash','employee','ops-manager'),
    ('billing-b','36t','ops','billing-b','مؤكدة قبض الدفعة','unused-test-hash','employee','ops-manager')`);
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار المحاور' }));
  for (const who of ['manager', 'billing-a', 'billing-b']) grant(who, 'billing.recurring.manage');
  grant('employee', 'clients.manage');
  // تفويض الاعتماد المالي للإقفال المالي وحده: شخص غير من يقفل فنيًا.
  for (const action of ['read', 'approve']) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', 'finance-closer', 'employee', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض إقفال مالي مصطنع', null, now());

  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, leadInput()));
  c = act('manager', act('employee', c, 'qualify', qualificationInput()), 'approve_qualification', { note: 'تأهيل مصطنع معتمد' });
  c = act('manager', act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, quoteInput())), 'submit_quote'), 'approve_quote', { note: 'راجعت المبالغ والنطاق' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع للاختبار المحلي فقط', customer_representative: 'ممثل عميل مصطنع' });
  c = act('manager', c, 'create_project', { member_ids: ['pm-axes'] });
  const projectId = c.project_id;
  // ملف العميل يفتحه مسؤول الحساب نفسه فيربطه بملفه التجاري: الربط لصاحب الملفين.
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(c.client_id);
  // الربط صار يكتب عميل الصفقة عليها (الحزمة 4، القرار D1، الترحيل 180)، وكل تغيير على الصفقة بنسختها التالية.
  c = { ...c, version: db.prepare('SELECT version FROM commercial_cases WHERE id=?').get(c.id).version };

  const read = (who = 'manager') => axes.axesFor(db, users[who], projectId);
  const terms = () => tx(() => axes.recordPaymentTerms(db, users.employee, c.id, { terms: [
    { label: 'دفعة مقدمة 30٪ عند التوقيع', amount: '34500.00', due_on: '2099-01-01', condition: 'عند توقيع الاتفاق', condition_kind: 'advance' },
    { label: 'الدفعة الثانية عند التسليم', amount: '80500.00', due_on: '2099-06-01', condition: 'عند قبول المخرجات', condition_kind: 'acceptance', condition_lines: [0] } ] }));
  const purchaseOrder = () => {
    // أمر الشراء يحمل روابطه وصلاحيته ونطاقه منذ الترحيل 160: الاتفاق والمشروع والعميل تُطابَق مع الملف نفسه.
    const po = tx(() => axes.recordClientPurchaseOrder(db, users.employee, c.id, { po_number: 'PO-CLIENT-1', issued_on: '2026-09-01', amount: '115000.00',
      customer_representative: 'مدير المشتريات لدى العميل', evidence: 'نسخة أمر شراء العميل المصطنع محفوظة في ملف الاتفاق',
      valid_until: '2099-12-31', scope: 'الهوية البصرية والفيلم القصير كما في الاتفاق', contract_id: c.contract.id, project_id: projectId, client_id: client.id }));
    return tx(() => axes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قابلنا الرقم والقيمة بأصل أمر الشراء' }));
  };
  const advance = (amount = '34500.00') => {
    const row = tx(() => billing.recordAdvance(db, users['billing-a'], { client_id: client.id, schedule_id: '', project_id: projectId,
      description: 'الدفعة المقدمة على اتفاق المحاور', agreement_reference: 'بند 3-1 من الاتفاق المصطنع', amount }));
    // مرجع الحوالة شرط التأكيد منذ الترحيل 160، ويتفرد داخل الكيان: لكل مبلغ حوالته.
    return tx(() => billing.confirmAdvance(db, users['billing-b'], row.id, { version: 1, amount, received_on: '2026-09-10', evidence: 'إشعار تحويل بنكي مصطنع رقم 9001 مطابق للمبلغ', reference: `TRF-AXES-${amount}` }));
  };
  const ready = () => { terms(); purchaseOrder(); advance(); };
  // شهادة الإنجاز (الترحيل 164): ممثل العميل من سجل مفوّضي المشروع بسند تفويضه، وقبوله دليل خارجي بقناته يسجّله
  // غير من أصدرها وغير من قبل مخرجاتها — فالمدير يصدر (وهو من قبل المخرجات) ومدير المشروع يسجّل القبول.
  const riyadhToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const representative = () => tx(() => registerApprover(db, users['pm-axes'], { project_id: projectId, name: 'ممثل العميل المصطنع', title: 'مدير المشاريع لدى العميل',
    authority_basis: 'خطاب تفويض مصطنع محفوظ في ملف الاتفاق', authority_scope: 'قبول المخرجات وشهادة الإنجاز', valid_from: '2026-01-01' })).id;
  const issueCertificate = approverId => tx(() => axes.issueCompletionCertificate(db, users.manager, projectId, { scope_summary: 'أُنجزت الهوية البصرية والفيلم القصير كما في بنود الاتفاق المصطنع',
    approver_id: approverId, evidence: 'تقرير إنجاز مصطنع محفوظ في ملف المشروع' }));
  const acceptCertificate = (who, certificate) => tx(() => axes.acknowledgeCompletionCertificate(db, users[who], certificate.id, { version: certificate.version,
    channel: 'email', received_on: riyadhToday(), evidence: 'بريد العميل المصطنع بقبول شهادة الإنجاز' }));
  // بوابة المورد (app/vendors.mjs): الكيان الذي بلا ملف ما عاد يُقبل عرضه ولا تُرسى عليه ترسية،
  // فكل مفتاح يمرّ في add_quote يحتاج ملفًا مؤهلًا فعلًا يبنيه المساعد بالمسار الحقيقي.
  // وموضعه آخر التجهيز عمدًا: المساعد يمنح vendors.manage بنفسه، فلو سبق منح الاختبار لاصطدما.
  approveVendors(db,['supplier-a', 'supplier-b', 'supplier-c']);
  return { db, users, tx, c, projectId, client, act, read, terms, purchaseOrder, advance, ready, representative, issueCertificate, acceptCertificate };
}

// شراء مورد كامل حتى الاستلام، على المشروع نفسه.
function supplierChain(db, users, tx, projectId) {
  fundProject(db, projectId, 'AXES-CC-1', '60000.00');
  const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  let p = tx(() => createPurchase(db, users.employee, { project_id: projectId, title: 'تصوير مصطنع', specification: 'يوم تصوير واحد بالمواصفات المسجلة',
    cost_center: 'AXES-CC-1', due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '30000.00', budget_evidence: 'مخصص اختبار داخلي', currency: 'SAR' }));
  p = pAct('employee', p, 'submit');
  for (const [key, price] of [['supplier-a', '25000.00'], ['supplier-b', '26000.00'], ['supplier-c', '27000.00']])
    p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد اختبار ' + key, unit_price: price,
      technical_assessment: 'العرض يطابق المواصفات المسجلة', financial_terms: 'استحقاق بعد الاستلام والمطابقة', delivery_date: '2099-10-20', evidence: 'عرض مصطنع برقم ' + key });
  return { p, pAct };
}

// ترحيل 163 (نص العقد): الإقفال المالي يلي الفني، ويشترط نتيجة هامش يقبلها حامل تصريح الربحية غير من يقفل ماليًا،
// ويسمّي كل بند مالي باقٍ من مصدره. في مشاريع هذه الاختبارات بندان لم يكونا يُفحصان قبله: مخرجات مقبولة لم يُطالَب
// بها، ودفعة مقدمة مقبوضة لم تُسحب على فاتورة. يُحسمان هنا بقرار مكتوب — «القرار ليس صمتًا» — لا بتجاهلهما.
function acceptMargin(f, who = 'ops-manager') {
  const { db, users, tx, projectId } = f;
  if (!can(db, users[who], 'profitability.view')) tx(() => grantAccess(db, users.admin, { user_id: who, capability: 'profitability.view', department_id: '', note: 'قارئ ربحية لقبول الهامش في الاختبار' }));
  return tx(() => axes.acceptMargin(db, users[who], projectId, { figures_digest: projectMarginFigures(db, '36t', projectId).digest, note: 'الهامش الفعلي مقابل المخطط مراجع وسبب الفرق مكتوب' }));
}
const decisionsFor = f => axes.financialOutstanding(f.db, f.db.prepare('SELECT * FROM projects WHERE id=?').get(f.projectId))
  .map(item => ({ ref: item.ref, resolution: 'حُسم البند بقرار مكتوب في محضر الإقفال المالي المصطنع' }));

test('AXIS-01: the eight axes are independent — moving one leaves the other seven where they were', t => {
  const { db, users, tx, projectId, read, ready } = fixture(t);
  const before = read().axes;
  assert.equal(before.commercial.state, 'project_active');
  assert.equal(before.readiness.state, 'not_required', 'مشروع بلا جدول دفعات مسجل حرّ تمامًا: هذا ما قبل البيع');
  assert.equal(before.execution.state, 'not_started');
  assert.equal(before.acceptance.state, 'not_started');
  assert.equal(before.invoicing.state, 'not_invoiced');
  assert.equal(before.collection.state, 'nothing_due');
  assert.equal(before.supplier_settlement.state, 'none');
  assert.equal(before.closure.state, 'open');
  // تحريك محور الجاهزية وحده.
  ready();
  const afterReady = read().axes;
  assert.equal(afterReady.readiness.state, 'ready');
  assert.equal(afterReady.readiness.advance.confirmed_minor, 3450000);
  for (const axis of ['commercial', 'execution', 'acceptance', 'invoicing', 'collection', 'supplier_settlement', 'closure'])
    assert.equal(afterReady[axis].state, before[axis].state, `محور ${axis} لم يتحرك بحركة الجاهزية`);
  // تحريك محور التنفيذ وحده.
  tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 0, state: 'mobilising', note: 'تعبئة الفريق وحجز المواعيد' }));
  const mobilising = read().axes;
  assert.equal(mobilising.execution.state, 'mobilising');
  assert.equal(mobilising.readiness.state, 'ready');
  assert.equal(mobilising.closure.state, 'open');
  assert.equal(mobilising.commercial.state, 'project_active', 'الحالة التجارية لا تتغير بحركة التنفيذ');
  tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 1, state: 'in_progress', note: 'بدأ التنفيذ بعد اكتمال شروط البدء' }));
  assert.equal(read().axes.execution.state, 'in_progress');
  // انتقال غير معلن لا يقع: لكل محور انتقالاته لا أي قفزة.
  assert.throws(() => tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 2, state: 'not_started', note: 'محاولة رجوع غير معلنة' })), code('transition_denied'));
  assert.equal(verifyAudit(db), true);
  // كل انتقال مقيَّد باسم صاحبه.
  const history = read().history;
  assert.deepEqual(history.filter(h => h.axis === 'execution').map(h => h.to_state), ['mobilising', 'in_progress']);
  assert.equal(history.find(h => h.axis === 'execution').actor_name, 'مدير الفريق التجريبي');
});

test('AXIS-02: the advance gate blocks paid execution and never touches pre-sale scoping', t => {
  const { db, users, tx, projectId, read, terms, purchaseOrder, advance } = fixture(t);
  const { p: sourced, pAct } = supplierChain(db, users, tx, projectId);
  // قبل أي جدول دفعات: البوابة لا تمسّ شيئًا. التحديد والدراسة وما قبل البيع حرّة.
  assert.equal(read().axes.readiness.state, 'not_required');
  const free = pAct('manager', sourced, 'award', { quote_id: sourced.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id, note: 'ترسية قبل إعلان أي جدول دفعات' });
  assert.equal(free.status, 'awarded', 'مشروع بلا دفعة معلنة لا تحرسه البوابة');

  // مشروع ثان بجدول دفعات معلن: هنا تعمل البوابة.
  const second = fixture(t);
  second.terms();
  assert.equal(second.read().axes.readiness.state, 'awaiting_client_po');
  const chain = supplierChain(second.db, second.users, second.tx, second.projectId);
  const quoteId = chain.p.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id;
  assert.throws(() => chain.pAct('manager', chain.p, 'award', { quote_id: quoteId, note: 'ترسية قبل أمر شراء العميل' }), code('advance_required'));
  second.purchaseOrder();
  assert.equal(second.read().axes.readiness.state, 'awaiting_advance');
  // الدفعة المعلنة 34500 ولا يكفيها مقبوض أقل: «أكدنا جزءًا» ليست «أكدنا».
  second.advance('10000.00');
  assert.equal(second.read().axes.readiness.state, 'awaiting_advance');
  assert.equal(second.read().axes.readiness.advance.shortfall_minor, 2450000);
  let error;
  try { chain.pAct('manager', chain.p, 'award', { quote_id: quoteId, note: 'ترسية بدفعة ناقصة' }); } catch (thrown) { error = thrown; }
  assert.equal(error.code, 'advance_required');
  assert.match(error.message, /الدفعة المقدمة المؤكدة/, 'الرفض يسمي البند الناقص لا «الطلب غير مكتمل»');
  second.advance('24500.00');
  assert.equal(second.read().axes.readiness.state, 'ready');
  const awarded = chain.pAct('manager', chain.p, 'award', { quote_id: quoteId, note: 'ترسية بعد تأكيد الدفعة المقدمة كاملة' });
  assert.equal(awarded.status, 'awarded');
  // تأكيد الدفعة مقروء من مصدره الصادق وحده.
  assert.match(second.read().axes.readiness.advance.source, /advance_invoices/);
  assert.equal(typeof terms === 'function' && typeof purchaseOrder === 'function' && typeof advance === 'function', true);
});

test('AXIS-03: the advance is expected from the payment schedule, and confirmed only against a real receipt by a second person', t => {
  const { db, users, tx, projectId, client, read, terms, purchaseOrder } = fixture(t);
  terms(); purchaseOrder();
  const gate = axes.advanceGate(db, '36t', projectId);
  assert.equal(gate.declared, true);
  assert.equal(gate.expected_minor, 3450000, 'المتوقَّع من جدول الدفعات لا من إدخال حر');
  assert.equal(gate.confirmed_minor, 0);
  assert.equal(gate.satisfied, false);
  const row = tx(() => billing.recordAdvance(db, users['billing-a'], { client_id: client.id, schedule_id: '', project_id: projectId,
    description: 'الدفعة المقدمة على اتفاق المحاور', agreement_reference: 'بند 3-1 من الاتفاق المصطنع', amount: '34500.00' }));
  assert.equal(axes.advanceGate(db, '36t', projectId).confirmed_minor, 0, 'التسجيل ليس تأكيدًا: المال لم يصل بعد');
  // فصل التفويضات القائم في confirm_advance هو المستعمل، بلا نسخة ثانية منه.
  assert.throws(() => tx(() => billing.confirmAdvance(db, users['billing-a'], row.id, { version: 1, amount: '34500.00', received_on: '2026-09-10', evidence: 'إشعار مصطنع' })), code('self_approval'));
  tx(() => billing.confirmAdvance(db, users['billing-b'], row.id, { version: 1, amount: '34500.00', received_on: '2026-09-10', evidence: 'إشعار تحويل بنكي مصطنع رقم 9001', reference: 'TRF-AXES-9001' }));
  const confirmed = axes.advanceGate(db, '36t', projectId);
  assert.equal(confirmed.confirmed_minor, 3450000);
  assert.equal(confirmed.satisfied, true);
  assert.equal(read().axes.readiness.state, 'ready');
  // الإعفاء ليس صمتًا: تصريح حساس، وسبب، ويظهر في المحور نفسه.
  const third = fixture(t);
  third.terms();
  assert.throws(() => third.tx(() => axes.waiveReadiness(third.db, third.users.manager, third.projectId, { item: 'client_po', reason: 'إعفاء بلا تصريح لا يقع أبدًا مهما كان سببه' })), code('not_permitted'));
  third.tx(() => grantAccess(third.db, third.users.admin, { user_id: 'manager', capability: 'projects.readiness.waive', department_id: '', note: 'اختبار الإعفاء' }));
  // الإعفاء بيدين منذ الترحيل 160: يطلبه عضو في المشروع بسببه، ويعتمده حامل التصريح غيرُ الطالب.
  third.tx(() => axes.requestReadinessWaiver(third.db, third.users['pm-axes'], third.projectId, { item: 'client_po', reason: 'العميل جهة حكومية تصدر أمر الشراء بعد المباشرة بقرار مكتوب' }));
  third.tx(() => axes.waiveReadiness(third.db, third.users.manager, third.projectId, { item: 'client_po', reason: 'العميل جهة حكومية تصدر أمر الشراء بعد المباشرة بقرار مسجل من الرئيس التنفيذي' }));
  const waived = third.read().axes.readiness;
  assert.equal(waived.client_purchase_order.waiver.waived_by_name, 'مدير الفريق التجريبي');
  assert.equal(waived.state, 'awaiting_advance', 'إعفاء شرط لا يعفي الآخر');
});

test('AXIS-04: supplier start refuses without a purchase order and without a commencement authorisation', t => {
  const { db, users, tx, projectId, ready } = fixture(t);
  ready();
  const { p: sourced, pAct } = supplierChain(db, users, tx, projectId);
  let p = pAct('manager', sourced, 'award', { quote_id: sourced.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id, note: 'ترسية بعد المقارنة وتأكيد المخصص' });
  // النصف الأول من البوابة: لا استلام قبل أمر الشراء. قائم قبل هذا العمل.
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'r-early', evidence: 'محاولة استلام قبل أمر الشراء' }), code('transition_denied'));
  assert.throws(() => pAct('manager', p, 'commence', { start_on: '2026-10-01', site_or_channel: 'موقع التصوير', scope_confirmation: 'إذن بدء قبل أمر الشراء' }), code('transition_denied'));
  p = pAct('manager', p, 'approve_order', { terms: 'يوم تصوير واحد', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء الداخلي' });
  assert.equal(p.status, 'ordered');
  assert.equal(p.commencement, null);
  // النصف الثاني، وهو ما كان غائبًا تمامًا: أمر الشراء ليس إذن البدء.
  assert.ok(!p.allowed_actions.includes('receive'), 'الاستلام لا يظهر أصلًا قبل أمر المباشرة');
  assert.ok(p.allowed_actions.includes('commence'));
  // الرفض يسمّي الناقص بعينه (الترحيل 162)، لا «الإجراء غير متاح».
  assert.throws(() => pAct('employee', p, 'receive', { quantity: 1, reference: 'r-1', evidence: 'استلام قبل أمر المباشرة' }), code('commencement_required'));
  assert.throws(() => tx(() => axes.authoriseCommencement(db, users.employee, p.id, { ...COMMENCE(), scope_confirmation: 'طالب الشراء يأذن لنفسه' })), code('self_approval'));
  p = pAct('manager', p, 'commence', { ...COMMENCE(), scope_confirmation: 'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر' });
  assert.equal(p.commencement.start_on, today());
  assert.equal(p.commencement.issued_by, 'manager');
  assert.ok(p.allowed_actions.includes('receive'));
  assert.ok(!p.allowed_actions.includes('commence'), 'لا يقوم أمرا مباشرة معًا: القائم يُستبدل أو يُسحب');
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'r-1', evidence: 'استلمنا يوم التصوير كاملًا وفحصنا المواد' });
  assert.equal(p.status, 'received');
  // سداد المورد يُقرأ من أوامر الدفع وحدها.
  const settlement = axes.axesFor(db, users.manager, projectId).axes.supplier_settlement;
  assert.equal(settlement.state, 'committed');
  assert.match(settlement.source, /payment_orders/);
  assert.equal(verifyAudit(db), true);
});

test('AXIS-05: a multi-department project can be planned — work packages carry a department, a phase and an owner', t => {
  const { db, users, tx, projectId, ready } = fixture(t);
  ready();
  // الحال قبل هذا العمل: موظف إدارة أخرى يُرد بـ400 assignee ولا سبيل إلى مشروع متعدد الإدارات.
  assert.throws(() => tx(() => createTask(db, users.manager, projectId, { title: 'تصوير', assignee_id: 'producer', due_date: '2099-05-01', acceptance: 'مواد التصوير الخام' })), code('assignee'));
  assert.throws(() => tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'producer', basis: 'منتج الفيلم القصير' })), code('department_not_linked'));
  // القيد الصريح المسجل: الطالب لا يختار المعتمد؛ رئيس الإدارة الأخرى يقرر بحسابه.
  assert.throws(() => tx(() => axes.requestDepartmentParticipation(db, users.manager, projectId, { department_id: 'ops', basis: 'الفيلم القصير من إنتاج إدارة التشغيل', approver_id: 'manager' })), code('invalid_fields'));
  const participation = tx(() => axes.requestDepartmentParticipation(db, users.manager, projectId, { department_id: 'ops', basis: 'بند الفيلم القصير في الاتفاق من إنتاج إدارة التشغيل' }));
  tx(() => axes.decideDepartmentParticipation(db, users['ops-manager'], participation.id, 'accept_participation', { version: 1, note: 'راجعت إدارة التشغيل النطاق وقبلت المشاركة' }));
  tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'producer', basis: 'منتج الفيلم القصير' }));
  tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'ops-manager', basis: 'مسؤول حزمة الإنتاج' }));
  const creative = tx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'WP-1', title: 'حزمة الهوية البصرية', department_id: 'creative', phase: 'production',
    objective: 'إنتاج الهوية البصرية كاملة حتى اعتمادها', lead_id: 'manager', planned_start: '2026-10-01', planned_end: '2026-11-01' }));
  const production = tx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'WP-2', title: 'حزمة الفيلم القصير', department_id: 'ops', phase: 'production',
    objective: 'تصوير الفيلم القصير ومونتاجه حتى النسخة النهائية', lead_id: 'ops-manager', planned_start: '2026-10-15', planned_end: '2026-12-01' }));
  // مسؤول الحزمة من إدارتها: لا تُسند حزمة الإنتاج إلى مدير الإبداع.
  assert.throws(() => tx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'WP-3', title: 'حزمة ثالثة', department_id: 'ops', phase: 'delivery',
    objective: 'حزمة باطلة لمسؤول من إدارة أخرى', lead_id: 'manager', planned_start: '2026-10-15', planned_end: '2026-12-01' })), code('lead_id'));
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'يوم التصوير الأول', assignee_id: 'producer', due_date: '2099-05-01', acceptance: 'مواد التصوير الخام مسلَّمة ومفحوصة' }));
  tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version, work_package_id: production.id }));
  assert.throws(() => tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version + 1, work_package_id: creative.id })), code('assignee'));
  tx(() => axes.workPackageAction(db, users.manager, creative.id, 'activate', { version: 1, note: 'انطلقت الهوية بعد اكتمال شروط البدء' }));
  const board = axes.axesFor(db, users.manager, projectId);
  assert.deepEqual(board.departments.map(d => d.id), ['ops']);
  assert.deepEqual(board.work_packages.map(p => [p.code, p.department_id, p.phase, p.status]),
    [['WP-1', 'creative', 'production', 'active'], ['WP-2', 'ops', 'production', 'planned']]);
  assert.equal(board.work_packages.find(p => p.code === 'WP-2').tasks.length, 1);
  assert.equal(board.work_packages.find(p => p.code === 'WP-2').lead_name, 'مدير الإنتاج المصطنع');
  // تفعيل حزمة عمل إنفاق وقت مدفوع: يمر بالبوابة نفسها.
  const blocked = fixture(t);
  blocked.terms();
  const blockedParticipation = blocked.tx(() => axes.requestDepartmentParticipation(blocked.db, blocked.users.manager, blocked.projectId, { department_id: 'ops', basis: 'بند الفيلم القصير في الاتفاق من إنتاج إدارة التشغيل' }));
  blocked.tx(() => axes.decideDepartmentParticipation(blocked.db, blocked.users['ops-manager'], blockedParticipation.id, 'accept_participation', { version: 1, note: 'راجعت إدارة التشغيل النطاق وقبلت المشاركة' }));
  blocked.tx(() => axes.addProjectMember(blocked.db, blocked.users.manager, blocked.projectId, { user_id: 'ops-manager', basis: 'مسؤول حزمة الإنتاج' }));
  const pending = blocked.tx(() => axes.createWorkPackage(blocked.db, blocked.users.manager, blocked.projectId, { code: 'WP-9', title: 'حزمة قبل الدفعة', department_id: 'ops', phase: 'production',
    objective: 'حزمة تُفعَّل قبل تأكيد الدفعة المقدمة', lead_id: 'ops-manager', planned_start: '2026-10-15', planned_end: '2026-12-01' }));
  assert.throws(() => blocked.tx(() => axes.workPackageAction(blocked.db, blocked.users.manager, pending.id, 'activate', { version: 1, note: 'تفعيل قبل الدفعة' })), code('advance_required'));
});

test('AXIS-06: closure refuses by naming the exact outstanding item, and needs technical then financial', t => {
  const f = fixture(t), { db, users, tx, c, projectId, act, read, ready, representative, issueCertificate, acceptCertificate } = f;
  ready();
  const closeTechnically = (who, input) => tx(() => axes.closeTechnically(db, users[who], projectId, { decisions: [], ...input }));
  // قبل أي تسليم: الرفض يسمي بند العقد بالاسم.
  let error;
  try { closeTechnically('manager', { note: 'محاولة إقفال فني قبل أي قبول للمخرجات' }); } catch (thrown) { error = thrown; }
  assert.equal(error.code, 'deliverable_not_accepted');
  assert.match(error.message, /«هوية بصرية»/);
  assert.match(error.message, /«فيلم قصير»/);
  // قبول المخرجين: محور القبول وحده يتحرك.
  let live = c;
  for (const lineIndex of [0, 1]) {
    live = act('employee', live, 'submit_delivery', { line_index: lineIndex, evidence: 'دليل تسليم مصطنع للبند رقم ' + lineIndex });
    const delivery = live.deliveries.find(d => d.line_index === lineIndex && d.review.status === 'pending');
    live = act('manager', live, 'accept_delivery', { delivery_id: delivery.id, note: 'قبلنا المخرج بعد المراجعة',
      acceptance_evidence: 'محضر قبول مصطنع موقّع من ممثل العميل', approver_id: approverFor(db, live.project_id) });
  }
  assert.equal(read().axes.acceptance.state, 'accepted');
  assert.equal(read().axes.closure.state, 'open', 'القبول لا يقفل شيئًا بنفسه');
  // المهمة المفتوحة تُسمّى هي أيضًا.
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'تسليم الملفات المصدرية', assignee_id: 'pm-axes', due_date: '2099-05-01', acceptance: 'الملفات المصدرية مسلَّمة' }));
  try { closeTechnically('manager', { note: 'محاولة إقفال فني ومهمة مفتوحة' }); } catch (thrown) { error = thrown; }
  assert.equal(error.code, 'task_open');
  assert.match(error.message, /تسليم الملفات المصدرية/);
  // «أو تُعفى باعتماد»: البند الباقي يُسمّى ويُعطى قراره، ولا يُطوى صمتًا.
  try { closeTechnically('manager', { note: 'إقفال فني بقرار على المهمة', decisions: [{ ref: `task:${task.id}`, resolution: 'أُلغيت بقرار مالك المشروع لأن العميل استلم الملفات مباشرة' }] }); } catch (thrown) { error = thrown; }
  assert.equal(error.code, 'certificate_missing', 'شهادة الإنجاز لا تُطوى بقرار');
  const certificate = issueCertificate(representative());
  assert.equal(certificate.number, 'CERT-00001');
  assert.throws(() => acceptCertificate('manager', certificate), code('self_approval'));
  acceptCertificate('pm-axes', certificate);
  const decisions = [{ ref: `task:${task.id}`, resolution: 'أُلغيت بقرار مالك المشروع لأن العميل استلم الملفات مباشرة' }];
  const afterTechnical = closeTechnically('manager', { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions });
  assert.equal(afterTechnical.state, 'closed_technically');
  assert.equal(afterTechnical.technical_state, 'closed');
  assert.equal(afterTechnical.financial_state, 'open');
  // الإقفال النهائي لا يقفز فوق المالي.
  assert.throws(() => tx(() => axes.closeFinally(db, users.manager, projectId, { version: afterTechnical.version, profitability_note: 'هامش أعلى من المخطط بسبب انخفاض تكلفة الإنتاج', lessons: 'ثبّتنا يوم التصوير مبكرًا فخفّت التكلفة' })), code('financial_open'));
  // الإقفال المالي لحامل تفويض الاعتماد المالي، ولغير من أقفل فنيًا.
  assert.throws(() => tx(() => axes.closeFinancially(db, users.manager, projectId, { note: 'إقفال مالي بلا تفويض مالي', decisions: [] })), code('financial_action_denied'));
  let financialError;
  try { tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'محاولة إقفال مالي ورصيد قائم', decisions: [] })); } catch (thrown) { financialError = thrown; }
  // ترحيل 163: «لا فواتير» ليست «لا بند باقٍ» — المخرجان مقبولان بلا مطالبة، والدفعة المقدمة مقبوضة بلا سحب، والهامش لم يُقبل.
  // والحزمة 3: قبض الدفعة المقدمة مستندٌ بلا قيد في الدفتر، فبند «مستندات المشروع المالية مرحّلة» يسمّيه أيضًا.
  assert.deepEqual(financialError.details.refusal.missing.map(m => m.doc_key.split(':')[0]).sort(), ['advance', 'delivery', 'delivery', 'journal', 'margin']);
  acceptMargin(f);
  tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'قُرّر في المخرجين والدفعة المقدمة بسبب مكتوب وقُبل الهامش', decisions: decisionsFor(f) }));
  const closure = read().axes.closure;
  assert.equal(closure.state, 'awaiting_final');
  const closed = tx(() => axes.closeFinally(db, users.manager, projectId, { version: closure.version,
    profitability_note: 'الهامش الفعلي 47٪ مقابل 45٪ مخططة، والفرق من انخفاض تكلفة يوم التصوير',
    lessons: 'حجز الموردين قبل شهر خفّض التكلفة، ونكرره في المشاريع المشابهة' }));
  assert.equal(closed.state, 'closed');
  assert.equal(closed.final_state, 'closed');
  assert.equal(read().axes.commercial.state, 'project_active', 'الإقفال محوره، ولا يُعاد كتابته في الحالة التجارية');
  assert.equal(verifyAudit(db), true);
});

test('AXIS-07: financial closure names every outstanding balance, and a decision is written not silent', t => {
  const f = fixture(t), { db, users, tx, projectId, ready } = f;
  ready();
  // ترحيل 163 (نص العقد: لا إقفال مالي قبل الفني): المشروع يُقفل فنيًا أولًا، ثم تُسمّى أرصدته المالية.
  certified(f);
  tx(() => axes.closeTechnically(db, users.manager, projectId, { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions: [] }));
  const { p: sourced, pAct } = supplierChain(db, users, tx, projectId);
  let p = pAct('manager', sourced, 'award', { quote_id: sourced.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id, note: 'ترسية بعد المقارنة وتأكيد المخصص' });
  p = pAct('manager', p, 'approve_order', { terms: 'يوم تصوير واحد', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء الداخلي' });
  p = pAct('manager', p, 'commence', { ...COMMENCE(), scope_confirmation: 'أذنّا للمورد بالبدء على النطاق المعتمد' });
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'r-1', evidence: 'استلمنا يوم التصوير كاملًا وفحصنا المواد' });
  p = pAct('employee', p, 'record_invoice', { supplier_reference: 'inv-700', quantity: 1, amount: '25000.00', evidence: 'فاتورة المورد المصطنعة' });
  p = pAct('manager', p, 'match', { invoice_id: p.invoices[0].id, note: 'طابقنا الأمر والاستلام والفاتورة' });
  const outstanding = axes.financialOutstanding(db, db.prepare('SELECT * FROM projects WHERE id=?').get(projectId));
  assert.ok(outstanding.some(item => item.code === 'payable_not_settled'), 'مستحق المورد غير المدفوع بند باق');
  assert.ok(outstanding.some(item => item.code === 'supplier_invoice_untaxed'));
  let error;
  try { tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'محاولة إقفال مالي ومستحق مورد قائم', decisions: [] })); } catch (thrown) { error = thrown; }
  // الرفض يسمّي المستحق بين البنود الباقية (رمزه رمز أول باقٍ بترتيب القائمة، والذمم المدينة تسبق الموردين فيها).
  assert.ok(error.details.refusal.missing.some(m => m.doc_key.startsWith('payable:')));
  assert.match(error.message, /مورد اختبار supplier-a|25,000/, 'الرفض يسمي المستحق لا «هناك التزامات»');
  // البند الباقي يُقرَّر فيه باسمه وبسبب مكتوب، فيُقفل الملف ويبقى القرار في سجله. الهامش لا يُطوى بقرار: يُقبل.
  acceptMargin(f);
  const decisions = axes.financialOutstanding(db, db.prepare('SELECT * FROM projects WHERE id=?').get(projectId)).map(item => ({ ref: item.ref, resolution: 'حُوِّل إلى الفترة التالية بقرار المدير المالي المسجل في محضر الإقفال المصطنع' }));
  const after = tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'أُقفل ماليًا بقرارات مسجلة على البنود الباقية', decisions }));
  assert.equal(after.financial_state, 'closed');
  // محوران لا محور: المالي سجل ثانٍ مستقل عن الفني، والفني سبقه بنص العقد (كان هنا «المالي قبل الفني» مسموحًا قبل 163).
  assert.equal(after.state, 'awaiting_final');
  assert.deepEqual(after.records.map(r => r.lock), ['technical', 'financial']);
  const decided = db.prepare("SELECT after_json FROM audit_events WHERE action='axes.closed_financially'").get();
  assert.equal(JSON.parse(decided.after_json).decided.length, decisions.length);
  assert.equal(verifyAudit(db), true);
});

test('AXIS-08: reopening a closure needs a capability and a reason, and leaves an audited record', t => {
  const { db, users, tx, c, projectId, act, read, ready, representative, issueCertificate, acceptCertificate } = fixture(t);
  ready();
  let live = c;
  for (const lineIndex of [0, 1]) {
    live = act('employee', live, 'submit_delivery', { line_index: lineIndex, evidence: 'دليل تسليم مصطنع للبند رقم ' + lineIndex });
    const delivery = live.deliveries.find(d => d.line_index === lineIndex && d.review.status === 'pending');
    live = act('manager', live, 'accept_delivery', { delivery_id: delivery.id, note: 'قبلنا المخرج بعد المراجعة',
      acceptance_evidence: 'محضر قبول مصطنع موقّع من ممثل العميل', approver_id: approverFor(db, live.project_id) });
  }
  acceptCertificate('pm-axes', issueCertificate(representative()));
  tx(() => axes.closeTechnically(db, users.manager, projectId, { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions: [] }));
  const f = { db, users, tx, projectId };
  acceptMargin(f);
  tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'لا فواتير ولا مستحقات باقية على هذا المشروع', decisions: decisionsFor(f) }));
  const awaiting = read().axes.closure;
  const closed = tx(() => axes.closeFinally(db, users.manager, projectId, { version: awaiting.version,
    profitability_note: 'الهامش الفعلي 47٪ مقابل 45٪ مخططة، والفرق من انخفاض تكلفة يوم التصوير',
    lessons: 'حجز الموردين قبل شهر خفّض التكلفة، ونكرره في المشاريع المشابهة' }));
  assert.equal(closed.state, 'closed');
  // بلا تصريح لا إعادة فتح، مهما كان الدور.
  assert.throws(() => tx(() => axes.reopenClosure(db, users.manager, projectId, { version: closed.version, scope: 'technical', reason: 'عاد العميل بملاحظة جوهرية على الفيلم' })), code('not_permitted'));
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.reopen', department_id: '', note: 'اختبار إعادة الفتح' }));
  // ولا إعادة فتح بلا سبب مكتوب.
  assert.throws(() => tx(() => axes.reopenClosure(db, users.manager, projectId, { version: closed.version, scope: 'technical', reason: 'خطأ' })), code('invalid_text'));
  const reopened = tx(() => axes.reopenClosure(db, users.manager, projectId, { version: closed.version, scope: 'technical',
    reason: 'عاد العميل بملاحظة جوهرية على الفيلم القصير بعد الإقفال، وقرر مالك المشروع إعادة فتح الإقفال الفني' }));
  assert.equal(reopened.state, 'reopened');
  assert.equal(reopened.technical_state, 'open');
  assert.equal(reopened.final_state, 'open', 'فتح ما قبل النهائي يفتح النهائي معه');
  assert.equal(reopened.reopenings.length, 1);
  assert.equal(reopened.reopenings[0].reopened_by_name, 'مدير الفريق التجريبي');
  assert.equal(reopened.reopenings[0].capability, 'projects.closure.reopen');
  assert.equal(reopened.reopenings[0].from_state, 'closed');
  // القيد لا يُمحى ولا يُعدَّل.
  assert.throws(() => db.prepare("UPDATE project_closure_reopenings SET reason='سبب آخر' WHERE closure_id IS NOT NULL").run(), /recorded once/);
  assert.throws(() => db.prepare('DELETE FROM project_closure_reopenings').run(), /append only/);
  const event = db.prepare("SELECT * FROM audit_events WHERE action='axes.closure_reopened'").get();
  assert.equal(JSON.parse(event.before_json).closure, 'closed');
  assert.match(event.reason, /ملاحظة جوهرية/);
  assert.equal(verifyAudit(db), true);
});

test('AXIS-09: invoicing, collection and supplier settlement each read their own source and no other', t => {
  const { db, users, projectId, read } = fixture(t);
  const board = read();
  // الحقل الواحد لم يعد يُسأل عمّا لا يعرفه: القراءة نفسها تقول ذلك.
  assert.equal(board.legacy_status.value, 'project_active');
  assert.deepEqual(board.legacy_status.no_longer_answers.map(q => q.axis), ['readiness', 'execution', 'closure']);
  assert.equal(board.definitions.length, 8);
  assert.deepEqual(board.definitions.map(a => a.key), ['commercial', 'readiness', 'execution', 'acceptance', 'invoicing', 'collection', 'supplier_settlement', 'closure']);
  for (const axis of board.definitions) {
    assert.ok(axis.states.length >= 2, `${axis.key}: محور بلا حالات معلنة`);
    assert.ok(axis.owner_role.length > 0, `${axis.key}: محور بلا صاحب`);
    assert.ok(axis.source.length > 0, `${axis.key}: محور بلا مصدر مسمى`);
  }
  assert.match(board.axes.supplier_settlement.source, /لا يُقرأ procurement_purchases\.payment_status/);
  // لوحة المحافظ: أي المشاريع جارية وأيها مقفلة، من محاورها لا من حقل واحد.
  const portfolio = axes.axesBoard(db, users.manager);
  assert.equal(portfolio.projects.length, 1);
  assert.deepEqual(Object.keys(portfolio.projects[0].axes), ['commercial', 'readiness', 'execution', 'acceptance', 'invoicing', 'collection', 'supplier_settlement', 'closure']);
  assert.equal(portfolio.projects.find(p => p.id === projectId).axes.closure, 'open');
});

// قرار المالك (21 سبتمبر 2026، الخيار «ب»): قفلان بيد واحدة ممنوعان قاعدةً، ويُتجاوزان بتصريح حساس وسبب مكتوب يُسجَّل.
function closable(t) {
  const f = fixture(t), { db, users } = f;
  f.ready();
  certified(f);
  // المدير يحمل هنا التفويض المالي أيضًا: الشركة الصغيرة التي يجمع فيها شخص واحد الدورين.
  for (const action of ['read', 'approve']) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', 'manager', 'manager', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض إقفال مالي مصطنع للمدير', null, now());
  return f;
}
// المخرجان مقبولان وشهادة الإنجاز موثقة: ما يشترطه الإقفال الفني.
function certified(f) {
  const { db, users, tx, projectId, act } = f;
  let live = f.c;
  for (const lineIndex of [0, 1]) {
    live = act('employee', live, 'submit_delivery', { line_index: lineIndex, evidence: 'دليل تسليم مصطنع للبند رقم ' + lineIndex });
    const delivery = live.deliveries.find(d => d.line_index === lineIndex && d.review.status === 'pending');
    live = act('manager', live, 'accept_delivery', { delivery_id: delivery.id, note: 'قبلنا المخرج بعد المراجعة',
      acceptance_evidence: 'محضر قبول مصطنع موقّع من ممثل العميل', approver_id: approverFor(db, live.project_id) });
  }
  // الشهادة بمسارها بعد الترحيل 164: ممثل العميل من سجل المفوّضين، ويسجّل قبوله عضو غير من أصدرها وغير من قبل المخرجات.
  f.acceptCertificate('pm-axes', f.issueCertificate(f.representative()));
  return f;
}
const REASON = 'مدير المشروع هو معتمد المالية الوحيد هذا الشهر، وقرر المالك إقفال المشروع بيده';

test('AXIS-08: both locks in one hand are refused with a way out, and the way out is a capability plus a written reason', t => {
  const f = closable(t), { db, users, tx, projectId, read } = f;
  tx(() => axes.closeTechnically(db, users.manager, projectId, { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions: [] }));
  acceptMargin(f);
  const financially = input => tx(() => axes.closeFinancially(db, users.manager, projectId, { note: 'لا فواتير ولا مستحقات باقية على هذا المشروع', decisions: decisionsFor(f), ...input }));
  // الرفض يسمّي المخرجين: شخص آخر، أو تجاوز بسبب.
  let error; try { financially({}); } catch (thrown) { error = thrown; }
  assert.equal(error.code, 'self_approval');
  assert.match(error.message, /شخص آخر/);
  assert.match(error.message, /سبب التجاوز/);
  // والسبب وحده لا يكفي بلا التصريح الحساس، حتى لمدير.
  assert.throws(() => financially({ same_person_reason: REASON }), code('same_person_not_permitted'));
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.same_person', department_id: '', note: 'اختبار تجاوز القفلين' }));
  // والتصريح وحده لا يكفي بلا سبب يُقرأ.
  assert.throws(() => financially({ same_person_reason: 'مستعجل' }), code('invalid_text'));
  const after = financially({ same_person_reason: REASON });
  assert.equal(after.financial_state, 'closed');
  assert.equal(after.same_person_override.reason, REASON);
  assert.equal(after.same_person_override.by_name, 'مدير الفريق التجريبي');
  assert.ok(after.same_person_override.at);
  const event = db.prepare("SELECT * FROM audit_events WHERE action='axes.same_person_override'").get();
  assert.equal(event.actor_id, 'manager');
  assert.equal(event.reason, REASON);
  assert.equal(JSON.parse(event.after_json).lock, 'financial');
  assert.equal(verifyAudit(db), true);
  // إعادة فتح أحد القفلين تُسقط السبب عن الصف، ويبقى في سجل التدقيق.
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.reopen', department_id: '', note: 'اختبار إعادة الفتح' }));
  const reopened = tx(() => axes.reopenClosure(db, users.manager, projectId, { version: read().axes.closure.version, scope: 'financial',
    reason: 'ظهرت فاتورة مورد متأخرة بعد الإقفال المالي فأُعيد فتحه لتسويتها' }));
  assert.equal(reopened.same_person_override, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='axes.same_person_override'").get().n, 1);
});

test('AXIS-08: the same-person rule holds in both directions, and a reason is refused when the locks are in two hands', t => {
  const { db, users, tx, projectId } = closable(t);
  // ترحيل 163 (نص العقد: لا إقفال مالي قبل الفني): «المالي أولًا» يُرد الآن قبل أن تُسأل قاعدة الشخصين.
  assert.throws(() => tx(() => axes.closeFinancially(db, users.manager, projectId, { note: 'لا فواتير ولا مستحقات باقية على هذا المشروع', decisions: [] })), code('technical_closure_required'));
  // والاتجاه الذي أضافه هذا القرار باقٍ على إقفال مالي سبق الترحيل 163 (منقول بقواعد يومه): الفني بعده بالشخص نفسه.
  const stamp = now();
  db.prepare("INSERT INTO project_closures(id,tenant_id,project_id,financial_state,financial_closed_by,financial_closed_at,financial_note,created_at,updated_at) VALUES('legacy-financial','36t',?,'closed','manager',?,'إقفال مالي سابق للترحيل 163 في التجربة',?,?)").run(projectId, stamp, stamp, stamp);
  db.prepare("INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,closed_by,closed_at,origin) VALUES('carried-financial-legacy-financial','36t',?,'legacy-financial','financial','{}','','إقفال مالي سابق للترحيل 163 في التجربة','manager',?,'carried')").run(projectId, stamp);
  const technically = input => tx(() => axes.closeTechnically(db, users.manager, projectId, { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions: [], ...input }));
  assert.throws(() => technically({}), code('self_approval'));
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.same_person', department_id: '', note: 'اختبار تجاوز القفلين' }));
  const after = technically({ same_person_reason: REASON });
  assert.equal(after.technical_state, 'closed');
  assert.equal(JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE action='axes.same_person_override'").get().after_json).lock, 'technical');
});

test('AXIS-08: a reason on locks held by two people is refused, and the database refuses a silent same-person row from outside the code', t => {
  const { db, users, tx, projectId } = closable(t);
  tx(() => axes.closeTechnically(db, users.manager, projectId, { note: 'أُنجزت المخرجات وقُبلت وسُجلت شهادة الإنجاز', decisions: [] }));
  assert.throws(() => tx(() => axes.closeFinancially(db, users['finance-closer'], projectId, { note: 'لا فواتير ولا مستحقات باقية على هذا المشروع', decisions: [], same_person_reason: REASON })), code('same_person_reason'));
  const row = db.prepare('SELECT * FROM project_closures WHERE project_id=?').get(projectId);
  // كتابة مباشرة تجمع القفلين بلا سبب: يرفضها القيد نفسه.
  assert.throws(() => db.prepare("UPDATE project_closures SET financial_state='closed',financial_closed_by='manager',financial_closed_at=?,version=version+1 WHERE id=?").run(now(), row.id), /CHECK constraint failed/);
  // وسبب على قفلين بيدين مختلفتين يرفضه القيد أيضًا: تجاوز بلا حاجة تضليل في السجل.
  assert.throws(() => db.prepare("UPDATE project_closures SET financial_state='closed',financial_closed_by='finance-closer',financial_closed_at=?,same_person_reason=?,same_person_at=?,version=version+1 WHERE id=?").run(now(), REASON, now(), row.id), /CHECK constraint failed/);
});
