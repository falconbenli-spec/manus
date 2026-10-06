// P4-CRM-0 — دورة العميل كاملة في سيناريو تجريبي واحد: SYN-7001.
// اثنتا عشرة خطوة بالترتيب الذي يعيشه العميل: عميل محتمل، فرصة، عرض، اتفاق، أمر شراء العميل، مشروع، تسليم، استحقاق فاتورة،
// تحصيل، دعم، تجديد، إنهاء العلاقة. كل خطوة تعمل اليوم تمرّ هنا على الحالة التي تركتها الخطوة قبلها؛ وكل فجوة اختبارٌ متخطّى
// بسبب مكتوب يسمّي الحزمة الفرعية التي تملكها، فلا يُقرأ غيابها نجاحًا (السنة نفسها في tests/delivery-cycle.test.mjs).
//
// الحزم الفرعية اللاحقة كما تُسمّى هنا (P4-CRM-3 إلى 7 عمل لاحق؛ الترقيم اقتراح يعيد القائد تسميته عند القياس إن شاء):
//   P4-CRM-3  باب أمامي واحد: طلبات الكتالوج النصية (CRM-OPPORTUNITY وCRM-LOSS وCRM-HANDOVER) تصير السجل المهيكل نفسه
//   P4-CRM-4  كشف العميل عبر صفقاته: العروض والعقود والمشاريع والفواتير والمقبوضات في قراءة واحدة للعميل (المال على الحساب يبقى لكل صفقة)
//   P4-CRM-5  الدعم بعد البيع: بلاغ العميل وتصعيده سجلٌ مربوط بالعميل والصفقة بمهلة، لا طلبًا نصيًا
//   P4-CRM-6  التجديد: فرصة تجديد تُفتح من الصفقة السابقة قبل نهايتها وتحمل نطاقها وأسعارها
//   P4-CRM-7  إنهاء العلاقة: فحص المفتوح (ذمم ومخرجات وأصول وصلاحيات) ثم إقفال ملف العميل وما يُحفظ منه
// البيانات كلها مصطنعة وموسومة «تجريبي».
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import * as agency from '../app/agency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import * as projectIntake from '../app/project-intake.mjs';
import * as projectAxes from '../app/project-axes.mjs';
import * as receivables from '../app/receivables.mjs';
import * as support from '../app/client-support.mjs';
import * as renewals from '../app/client-renewals.mjs';
import * as offboarding from '../app/client-offboarding.mjs';
import * as register from '../app/contracts-register.mjs';
import { grantAccess } from '../app/access.mjs';
import { adoptionAction } from '../app/options.mjs';
import * as workflow from '../app/workflow.mjs';
import * as clientApprovals from '../app/client-approvals.mjs';
import { installServiceCatalog, variantCatalog } from '../app/service-catalog.mjs';
import { annotateCatalog } from '../app/module-routes.mjs';
import { crmWorld, caught, riyadh, CLIENT, QUOTE } from './crm-fixture.mjs';
import { boundQuote, approverFor } from './proposal-fixture.mjs';

const cleanups = [];
let w, s = {};
before(() => { w = crmWorld({ after: fn => cleanups.push(fn) }); });
after(() => { for (const fn of cleanups) fn(); });
const tx = run => transaction(w.db, run);

test('SYN-7001 step 1 — lead: the customer is one client file with its registration number, and a spelling variant of it is refused before saving', () => {
  const { db, users, client } = w;
  s.client = client;
  assert.equal(db.prepare('SELECT registration_number FROM clients WHERE id=?').get(client).registration_number, CLIENT.registration_number);
  assert.equal(caught(() => tx(() => agency.createClient(db, users.outsider, { legal_name: 'شركه الافق التجريبيه للتجزئه', sector: 'التجزئة', status: 'prospect' }))).code, 'duplicate_client');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients WHERE tenant_id=?').get('36t').n, 1);
});
test('SYN-7001 step 1b — lead from the front door: a CRM-OPPORTUNITY catalog request becomes this client and opportunity', () => {
  const { db, users } = w;
  installServiceCatalog(db);
  const service = workflow.catalog(db, users.employee).find(x => x.code === 'CRM-OPPORTUNITY');
  // البطاقة في الدليل وخيار «إدارة فرصة بيع» يفتحان «خط الفرص» لمن يستقبل الفرصة هناك: في فريق الحساب ومراحل الفرص معتمدة.
  assert.equal(annotateCatalog(db, users.employee, workflow.catalog(db, users.employee)).find(x => x.code === 'CRM-OPPORTUNITY').module_link, '#pipeline');
  const option = variantCatalog(db, users.employee).find(g => g.code === 'VAR-OPPORTUNITY').options.find(o => o.code === 'opportunity');
  assert.deepEqual([option.mode, option.link], ['module', '#pipeline']);
  // والطلب النصي نفسه لا يُكتب: يُرفض بإشارة إلى ملف هذا العميل — الاسم المكتوب بإملاء آخر يطابقه بعد التطبيع.
  const requests = () => db.prepare('SELECT COUNT(*) AS n FROM requests').get().n, before = requests();
  const refused = caught(() => tx(() => workflow.createRequest(db, users.employee, { service_id: service.id, title: 'فرصة حملة الإطلاق التجريبية',
    payload: { client: 'شركه الافق التجريبيه للتجزئه', source: 'إحالة', value: '100000', deadline: '2099-11-30', scope: 'حملة إطلاق تجريبية بهوية وعشرة منشورات' } })));
  assert.equal(refused.code, 'use_structured_record');
  assert.equal(refused.details.refusal.link, '#pipeline');
  assert.match(refused.details.refusal.missing[0].document, /C-0001/);
  assert.equal(requests(), before, 'no free-text request was written');
  // وتُسجَّل الفرصة من حيث أشار الرفض: على ملف العميل نفسه. ومن يملك فرصة مفتوحة يجد «تسجيل خسارة فرصة» في الفرصة نفسها.
  s.opportunity = w.opportunity();
  assert.equal(w.opp(s.opportunity).client_id, s.client);
  const loss = workflow.catalog(db, users.employee).find(x => x.code === 'CRM-LOSS');
  assert.equal(annotateCatalog(db, users.employee, [loss])[0].module_link, '#pipeline');
  assert.match(caught(() => tx(() => workflow.createRequest(db, users.employee, { service_id: loss.id, title: 'خسارة تجريبية',
    payload: { opportunity: 'حملة إطلاق تجريبية SYN-7001', reason: 'السعر', lesson: 'درس تجريبي مكتوب' } }))).details.refusal.missing[0].document, /الفرصة المفتوحة/);
});

test('SYN-7001 step 2 — opportunity: the opportunity sits on the client in an approved stage, weighted as an estimate not revenue', () => {
  const { db, users } = w;
  s.opportunity ??= w.opportunity();
  const view = pipeline.pipelineBoard(db, users.employee).opportunities.find(o => o.id === s.opportunity);
  assert.equal(view.client_id, s.client);
  assert.equal(view.weighted_minor, 2000000);
});

test('SYN-7001 step 3 — proposal: the opportunity opens its deal (nothing retyped), the prefilled qualification and the quote are approved by the direct manager', () => {
  s.deal = w.openCase(s.opportunity).id;
  assert.equal(w.kase(s.deal).client_id, s.client);
  w.act('manager', s.deal, 'approve_qualification', { note: 'الاحتياج والميزانية من الفرصة مراجعان' });
  // نسخة العرض على عرض سعر العميل (FRM-024) الذي تساويه، والاعتماد يقرأ الهامش ويحفظ قراءته (الترحيل 182، القرار D2).
  w.act('employee', s.deal, 'save_quote', boundQuote(w.db, s.deal, QUOTE()));
  w.act('employee', s.deal, 'submit_quote');
  const approved = w.act('manager', s.deal, 'approve_quote', { note: 'العرض والنطاق والهامش مراجعة' });
  assert.equal(approved.status, 'quote_approved');
  assert.equal(approved.proposal.quote.grand_total_minor, 9200000);
  assert.equal(approved.reviews.find(r => r.kind === 'quote').evidence.margin_authority.below_target, false);
});

test('SYN-7001 step 4 — contract: the agreement is registered on the approved quote, and only now can the opportunity be won', () => {
  assert.equal(caught(() => w.oppAct('employee', s.opportunity, 'win', {})).code, 'contract_required');
  const contracted = w.act('employee', s.deal, 'register_contract', { agreement_evidence: 'محضر اتفاق تجريبي موقّع ومحفوظ في أرشيف التجربة', customer_representative: 'ممثل عميل تجريبي' });
  assert.equal(contracted.status, 'contracted');
  assert.equal(contracted.proposal.contract.quotation_status, 'accepted', 'the agreement binds the client quotation the customer accepted');
});

test('SYN-7001 step 5 — customer PO: the payment schedule asks for one, it is recorded against the agreement and confirmed by someone else', () => {
  const { db, users } = w;
  tx(() => projectAxes.recordPaymentTerms(db, users.employee, s.deal, { requires_client_po: true, terms: [
    // كل بند شرطه مكتوب بنوعه (الترحيل 183): قبول البند الأول من الاتفاق يفتح الأولى، وقبول الثاني يفتح الثانية.
    { label: 'دفعة تجريبية عند اعتماد الهوية', amount: '46000.00', due_on: '2099-10-15', condition: 'عند اعتماد العميل للهوية التجريبية', condition_kind: 'acceptance', condition_lines: [0] },
    { label: 'دفعة تجريبية عند إطلاق الحملة', amount: '46000.00', due_on: '2099-11-15', condition: 'عند إطلاق الحملة التجريبية', condition_kind: 'acceptance', condition_lines: [1] }] }));
  const contractId = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(s.deal).id;
  const po = tx(() => projectAxes.recordClientPurchaseOrder(db, users.employee, s.deal, { po_number: 'PO-SYN-7001', issued_on: riyadh(), valid_until: '2099-12-31', amount: '92000.00',
    scope: 'أمر شراء تجريبي لحملة الإطلاق كاملة', customer_representative: 'ممثل عميل تجريبي', evidence: 'نسخة أمر شراء تجريبية محفوظة في الأرشيف', contract_id: contractId, project_id: '', client_id: s.client }));
  assert.equal(caught(() => tx(() => projectAxes.confirmClientPurchaseOrder(db, users.employee, po.id, { version: 1, note: 'تأكيد ذاتي' }))).code, 'self_approval');
  tx(() => projectAxes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قوبل أمر الشراء التجريبي بالأصل' }));
});

test('SYN-7001 step 6 — project: the opportunity is won, the project opens from the agreement, and the BD-04 handover is derived — nothing about the client or the scope typed twice', () => {
  const { db, users } = w;
  w.oppAct('employee', s.opportunity, 'win', {});
  assert.equal(w.opp(s.opportunity).status, 'won');
  w.act('manager', s.deal, 'create_project', { member_ids: ['pm1'] });
  s.project = w.kase(s.deal).project_id;
  const handoverId = tx(() => projectIntake.createHandover(db, users.employee, { project_id: s.project, project_manager_id: 'pm1', contract_signed_on: riyadh(-1), kickoff_planned_on: riyadh(3),
    channels: 'البريد الرسمي وقناة المشروع التجريبية', timeline_start: riyadh(), timeline_end: '2099-12-31', risks: '', special_requirements: '' })).id;
  const hv = () => db.prepare('SELECT version FROM project_handovers WHERE id=?').get(handoverId).version;
  tx(() => projectIntake.handoverAction(db, users.employee, handoverId, 'approve_handover', { version: hv(), statement: 'أقرّ أن المحضر التجريبي هو ما تعاقدنا عليه' }));
  tx(() => projectIntake.handoverAction(db, users.pm1, handoverId, 'approve_handover', { version: hv(), statement: 'أقرّ استلامي للمحضر التجريبي ومراجعتي لبنوده' }));
  tx(() => projectIntake.handoverAction(db, users.pm1, handoverId, 'receive_handover', { version: hv(), note: 'استلمت المحضر التجريبي وبقيت الوثائق المطلوبة' }));
  assert.equal(db.prepare('SELECT client_id FROM project_handovers WHERE id=?').get(handoverId).client_id, s.client);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_deliverables WHERE handover_id=?').get(handoverId).n, 2);
});

test('SYN-7001 step 7 — delivery: a contract line is delivered and accepted by someone other than its deliverer, naming the client’s registered approver', () => {
  const { db, users } = w;
  const c = w.act('employee', s.deal, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز هوية الحملة التجريبية بمراجعه المسجلة' });
  s.delivery = c.deliveries.find(d => d.line_index === 0).id;
  // ممثل العميل من سجل مفوّضي المشروع — السجل نفسه الذي تسمّي منه شهادة الإنجاز ممثلها. يسجّله مدير المشروع بتصريح دوره.
  const approver = tx(() => clientApprovals.registerApprover(db, users.pm1, { project_id: s.project, name: 'ممثلة عميل تجريبية', title: 'مديرة التسويق',
    authority_basis: 'خطاب تفويض تجريبي محفوظ في أرشيف التجربة', authority_scope: 'قبول مخرجات حملة الإطلاق التجريبية', valid_from: riyadh(-1) })).id;
  const accepted = w.act('manager', s.deal, 'accept_delivery', { delivery_id: s.delivery, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول تجريبي محفوظ في الأرشيف', approver_id: approver });
  assert.equal(accepted.deliveries.find(d => d.id === s.delivery).review.evidence.customer_representative, 'ممثلة عميل تجريبية');
});

test('SYN-7001 step 8 — invoice entitlement: the entitlement is born from the accepted deliverable and approved by someone else', () => {
  const { db, users } = w;
  let claim = tx(() => receivables.createClaim(db, users.employee, { delivery_id: s.delivery, amount: '46000.00', due_date: '2099-12-15', entitlement_evidence: 'محضر القبول التجريبي وبند العقد المقابل للاستحقاق' }));
  claim = tx(() => receivables.claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
  claim = tx(() => receivables.claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'طوبق القبول وبند العقد' }));
  s.claim = claim.id;
  assert.equal(claim.status, 'approved');
  // الاستحقاق على شرط بنده في الجدول، ورقم أمر شراء العميل المؤكد يصله (الترحيل 183).
  assert.equal(claim.source_snapshot.term.label, 'دفعة تجريبية عند اعتماد الهوية');
  assert.deepEqual(claim.source_snapshot.client_po, { number: 'PO-SYN-7001', revision: 1 });
});

test('SYN-7001 step 9 — collection: the receipt is recorded and matched by two people, and the entitlement is settled', () => {
  const { db, users } = w;
  const receipt = tx(() => receivables.recordReceipt(db, users.employee, s.claim, { reference: 'RCPT-SYN-7001', amount: '46000.00', received_on: riyadh(), payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي محفوظ للمراجعة' }));
  tx(() => receivables.receiptAction(db, users.manager, s.claim, receipt.id, 'confirm', { note: 'طوبق الإشعار بكشف الحساب', matching_evidence: 'كشف بنكي تجريبي يظهر الحركة' }));
  assert.equal(receivables.listReceivables(db, users.employee).claims.find(c => c.id === s.claim).balance_minor, '0');
});
test('SYN-7001 step 9b — collection read per customer: one statement across every deal of the client', () => {
  const { db, users } = w;
  // مالٌ وصل على حساب الصفقة الأولى قبل أن يُطلب: يبقى لها وحدها (هـ24 #9).
  const onAccount = tx(() => receivables.recordAccountReceipt(db, users.employee, { case_id: s.deal, reference: 'ACC-SYN-7001', amount: '10000.00', received_on: riyadh(),
    payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي على حساب العميل' }));
  tx(() => receivables.accountReceiptAction(db, users.manager, onAccount.id, 'confirm', { note: 'طوبق الإشعار بكشف الحساب', matching_evidence: 'كشف بنكي تجريبي يظهر الحركة' }));
  // صفقة ثانية للعميل نفسه، من فرصتها حتى استحقاقها المعتمد.
  const opportunity = w.opportunity({ name: 'حملة صيف تجريبية SYN-7001-B' });
  s.second = w.openCase(opportunity).id;
  w.contract(s.second);
  tx(() => projectAxes.recordPaymentTerms(db, users.employee, s.second, { requires_client_po: false, terms: [
    { label: 'دفعة الصيف عند قبول الهوية', amount: '46000.00', due_on: '2099-10-15', condition: '', condition_kind: 'acceptance', condition_lines: [0] },
    { label: 'دفعة الصيف عند قبول المنشورات', amount: '46000.00', due_on: '2099-11-15', condition: '', condition_kind: 'acceptance', condition_lines: [1] }] }));
  w.oppAct('employee', opportunity, 'win', {});
  w.act('manager', s.second, 'create_project', { member_ids: ['pm1'] });
  const delivered = w.act('employee', s.second, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز هوية الصيف التجريبية بمراجعه المسجلة' });
  const delivery = delivered.deliveries.find(d => d.line_index === 0).id;
  w.act('manager', s.second, 'accept_delivery', { delivery_id: delivery, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول تجريبي ثانٍ محفوظ في الأرشيف',
    approver_id: approverFor(db, w.kase(s.second).project_id, 'pm1') });
  let second = tx(() => receivables.createClaim(db, users.employee, { delivery_id: delivery, amount: '46000.00', due_date: '2099-12-20', entitlement_evidence: 'محضر القبول الثاني وشرط دفعته في الجدول' }));
  second = tx(() => receivables.claimAction(db, users.employee, second.id, 'submit', { version: second.version, note: '' }));
  second = tx(() => receivables.claimAction(db, users.manager, second.id, 'approve', { version: second.version, note: 'طوبق القبول وشرط الدفعة' }));
  // مال الصفقة الأولى على الحساب لا يُعرض للتخصيص على استحقاق الثانية.
  const account = receivables.listReceivables(db, users.manager).account_receipts.find(x => x.id === onAccount.id);
  assert.equal(account.eligible_claims.some(c => c.id === second.id), false);
  // الكشف الواحد: كل صفقة باستحقاقاتها ومقبوضها وباقيها وما على حسابها، والمجموع لا يخصم مال صفقة من باقي أخرى.
  const statement = receivables.customerStatement(db, users.employee, s.client);
  assert.deepEqual(statement.deals.map(x => x.case_id), [s.deal, s.second]);
  const [first, other] = statement.deals;
  assert.deepEqual([first.entitled_minor, first.received_minor, first.open_minor, first.on_account_minor], [4600000, 4600000, 0, 1000000]);
  assert.deepEqual([other.entitled_minor, other.received_minor, other.open_minor, other.on_account_minor], [4600000, 0, 4600000, 0]);
  assert.equal(first.receipts.map(r => r.reference).join(), 'RCPT-SYN-7001');
  assert.equal(first.claims[0].client_po_number, 'PO-SYN-7001');
  assert.deepEqual(statement.totals.map(x => [x.currency, x.entitled_minor, x.received_minor, x.open_minor, x.on_account_minor]), [['SAR', 9200000, 4600000, 4600000, 1000000]]);
});

test('SYN-7001 step 10 — support: an after-sales request is a record tied to the client and the deal, with its clock', () => {
  const { db, users } = w;
  // الساعة: مهلة الرد من القيمة المعتمدة (شخصان)، والضمان من بند العقد المسجّل على الصفقة — القرار D4 «كلاهما».
  tx(() => adoptionAction(db, users.outsider, support.SUPPORT_RESPONSE_HOURS, 'record', { value: { hours: 24 }, basis: 'قرار تجريبي: يوم للرد الأول على بلاغ العميل', effective_from: riyadh(-5) }));
  const pending = db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(support.SUPPORT_RESPONSE_HOURS).id;
  tx(() => adoptionAction(db, users.manager, support.SUPPORT_RESPONSE_HOURS, 'approve', { adoption_id: pending, note: 'اعتماد تجريبي من شخص ثانٍ' }));
  tx(() => grantAccess(db, users.admin, { user_id: 'hr', capability: 'contracts.register.manage', note: 'منح تجريبي لسجل العقود' }));
  s.contract = tx(() => register.createContract(db, users.hr, { party_kind: 'client', client_id: s.client, contract_type: 'statement_of_work', subject: 'أمر عمل حملة الإطلاق التجريبية SYN-7001',
    start_date: riyadh(-30), end_date: riyadh(45), value: '80000.00', auto_renew: false, owner_id: 'outsider', original_location: 'أرشيف العقود التجريبي — ملف SYN-7001',
    signed_on: riyadh(-31), case_id: s.deal, warranty_days: 60 })).id;
  tx(() => register.contractAction(db, users.outsider, s.contract, 'activate_contract', { version: 1, note: 'أقرّ بملكية عقد SYN-7001 ومطابقته للأصل' }));
  const received = new Date(Date.now() - 3600000).toISOString();
  const opened = tx(() => support.openSupportCase(db, users.employee, { client_id: s.client, case_id: s.deal, kind: 'complaint', severity: 'medium', channel: 'phone', received_at: received,
    statement: 'العميل التجريبي يقول إن هوية الحملة المقبولة تحتاج تعديل خط الشعار في المقاس الصغير' }));
  s.support = opened.id;
  const row = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(s.support);
  assert.deepEqual([row.client_id, row.case_id, row.handler_id], [s.client, s.deal, 'outsider'], 'on the customer and the deal, with the account owner');
  assert.deepEqual([row.response_source, row.response_due_at], ['adopted', new Date(Date.parse(received) + 24 * 3600000).toISOString()]);
  assert.deepEqual([row.warranty_source, row.warranty_days, row.contract_id], ['contract', 60, s.contract]);
  assert.ok(row.warranty_until >= riyadh(59), 'sixty days from the accepted deliverable of step 7');
  const act = (who, action, input) => tx(() => support.supportAction(db, users[who], s.support, action, { version: db.prepare('SELECT version FROM client_support_cases WHERE id=?').get(s.support).version, ...input }));
  act('outsider', 'respond_case', { note: 'اتصلنا بممثل العميل التجريبي وأكدنا التعديل ضمن الضمان' });
  act('outsider', 'resolve_case', { resolution_kind: 'warranty_fix', resolution: 'عدّلنا خط الشعار في المقاس الصغير بلا مقابل', evidence: 'نسخة الهوية المعدلة التجريبية في أرشيف المشروع' });
  assert.equal(caught(() => act('outsider', 'confirm_resolution', { note: 'إقرار ذاتي مرفوض' })).code, 'support_transition');
  act('manager', 'confirm_resolution', { note: 'اطلعت على النسخة المعدلة ورسالة التسليم' });
  // تاريخ ما بعد البيع يُقرأ على العميل وعلى الصفقة.
  const onClient = agency.clientsBoard(db, users.employee).clients.find(c => c.id === s.client).support_cases;
  assert.deepEqual(onClient.map(c => [c.id, c.status]), [[s.support, 'closed']]);
  assert.deepEqual(support.supportBoard(db, users.employee).cases.filter(c => c.deal?.id === s.deal).map(c => c.warranty.state), ['inside']);
});

test('SYN-7001 step 11 — renewal: a second deal for the same customer opens from the client file and names its predecessor', () => {
  const { db, users } = w;
  const renewal = tx(() => commercial.createLead(db, users.employee, { client_id: s.client, source: 'تجديد تجريبي للحملة', predecessor_case_id: s.deal }));
  assert.deepEqual([renewal.client_id, renewal.predecessor_case_id, renewal.registration_number], [s.client, s.deal, CLIENT.registration_number]);
  // الصفقة الأولى، والثانية من الخطوة 9b، والتجديد.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE client_id=?').get(s.client).n, 3);
});
test('SYN-7001 step 11b — renewal on time: the renewal opportunity opens before the predecessor ends and carries its scope and prices', () => {
  const { db, users } = w;
  // نهاية العقد (بعد 45 يومًا) تفتح نافذة التذكير بمهلة يضبطها مالك سجل العقود (60 يومًا هنا)، فيصل من عليه الفعل مرة.
  tx(() => register.setAlertSettings(db, users.hr, { expiry_lead_days: 60, notice_lead_days: 15, obligation_lead_days: 7, basis: 'مهل تجريبية أقرّها مالك سجل العقود لدورة SYN-7001' }));
  const sent = renewals.runRenewalReminders(db);
  assert.deepEqual(sent.map(r => [r.contract_id, r.recipients.sort()]), [[s.contract, ['employee', 'outsider']]], 'the account owner and the deal owner');
  assert.deepEqual(renewals.runRenewalReminders(db), [], 'once per term');
  // «التجديد» قرارٌ تتابعه فرصة: قبلها مرفوض باسمه.
  assert.equal(caught(() => tx(() => register.contractAction(db, users.outsider, s.contract, 'decide_renewal', { decision: 'renew', notice_reference: '', note: 'قرار تجريبي بتجديد حملة SYN-7001' }))).code, 'renewal_opportunity_required');
  const { id } = tx(() => renewals.openRenewal(db, users.employee, s.contract, { stage_code: 'LEAD' }));
  s.renewal = id;
  const o = db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
  const end = register.contractsRegisterBoard(db, users.hr).contracts.find(c => c.id === s.contract).effective_end_date;
  assert.ok(riyadh() < end && o.expected_close_on <= end, 'opened before the predecessor ends, to close by its end');
  const basis = JSON.parse(o.renewal_basis);
  assert.deepEqual([o.kind, o.renews_contract_id, o.client_id, basis.deal.id], ['renewal', s.contract, s.client, s.deal]);
  assert.match(basis.scope, /هوية الحملة وعشرة منشورات/, 'the predecessor scope');
  assert.deepEqual(basis.lines.map(l => [l.description, l.quantity, l.unit_price_minor]), [['هوية الحملة التجريبية', '1', '4000000'], ['منشور تجريبي مصمم', '10', '400000']], 'and its prices');
  assert.equal(o.value_minor, 8000000);
  tx(() => register.contractAction(db, users.outsider, s.contract, 'decide_renewal', { decision: 'renew', notice_reference: '', note: 'قرار تجريبي بالتجديد تتابعه فرصته' }));
});

test('SYN-7001 step 12 — offboarding: closing the customer checks what is still open, removes access and keeps what must be kept', () => {
  const { db, users } = w;
  const request = () => tx(() => offboarding.requestOffboarding(db, users.outsider, s.client, { kind: 'close', reason: 'انتهت حملة الإطلاق التجريبية ولا تجديد هذي الدورة', approver_id: 'manager' }));
  // ما بقي مفتوحًا من الدورة كلها، كلٌّ باسمه ومالكه: فرصة التجديد، والصفقة الثانية، والبند الثاني ما انسلّم، والعقد ساري.
  const refused = caught(request);
  assert.equal(refused.code, 'offboarding_open_items');
  assert.deepEqual(refused.details.refusal.missing.map(m => m.doc_key).sort(), ['contracts_in_force', 'open_deals', 'open_opportunities', 'open_receivables', 'undelivered_lines', 'unrefunded_money']);
  // تُحسم بمساراتها: التجديد يُخسر بسببه، والصفقة الثانية تُغلق، والبند الثاني يُسلَّم ويُقبل ويُطالب به ويُحصَّل، والعقد يُنهى بإشعاره.
  w.oppAct('employee', s.renewal, 'lose', { loss_reason_id: w.reasons.capacity, comment: 'العميل التجريبي أوقف الحملات هذي السنة' });
  const second = db.prepare("SELECT id FROM commercial_cases WHERE client_id=? AND status='lead'").get(s.client).id;
  w.act('employee', second, 'close_lost', { reason_id: w.reasons.capacity, comment: 'العميل التجريبي أوقف الحملات هذي السنة' });
  const c = w.act('employee', s.deal, 'submit_delivery', { line_index: 1, evidence: 'تقرير إنجاز المنشورات التجريبية العشرة بمراجعها' });
  w.act('manager', s.deal, 'accept_delivery', { delivery_id: c.deliveries.find(d => d.line_index === 1).id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول تجريبي ثانٍ محفوظ' , approver_id: approverFor(db, w.kase(s.deal).project_id, 'pm1') });
  // استحقاق الصفقة الثانية المفتوح من الخطوة 9b يُحصَّل بمساره.
  const secondClaim = receivables.listReceivables(db, users.manager).claims.find(x => x.case_id === s.second && x.status === 'approved');
  const secondReceipt = tx(() => receivables.recordReceipt(db, users.employee, secondClaim.id, { reference: 'RCPT-SYN-7001-3', amount: '46000.00', received_on: riyadh(), payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي لدفعة الصيف' }));
  tx(() => receivables.receiptAction(db, users.manager, secondClaim.id, secondReceipt.id, 'confirm', { note: 'طوبق إشعار الصيف بكشف الحساب', matching_evidence: 'كشف بنكي تجريبي يظهر دفعة الصيف' }));
  // وبند الصفقة الثانية الثاني (منشورات الصيف) يُسلَّم ويُقبل ويُطالب به ويُحصَّل بمساره.
  const summer = w.act('employee', s.second, 'submit_delivery', { line_index: 1, evidence: 'تقرير إنجاز منشورات الصيف التجريبية بمراجعها' });
  w.act('manager', s.second, 'accept_delivery', { delivery_id: summer.deliveries.find(d => d.line_index === 1).id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول منشورات الصيف التجريبي', approver_id: approverFor(db, w.kase(s.second).project_id, 'pm1') });
  let summerClaim = tx(() => receivables.createClaim(db, users.employee, { delivery_id: summer.deliveries.find(d => d.line_index === 1).id, amount: '46000.00', due_date: '2099-12-20', entitlement_evidence: 'محضر قبول منشورات الصيف وشرط دفعته' }));
  summerClaim = tx(() => receivables.claimAction(db, users.employee, summerClaim.id, 'submit', { version: summerClaim.version, note: '' }));
  summerClaim = tx(() => receivables.claimAction(db, users.manager, summerClaim.id, 'approve', { version: summerClaim.version, note: 'طوبق قبول منشورات الصيف وبند جدوله' }));
  const summerReceipt = tx(() => receivables.recordReceipt(db, users.employee, summerClaim.id, { reference: 'RCPT-SYN-7001-4', amount: '46000.00', received_on: riyadh(), payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي لمنشورات الصيف' }));
  tx(() => receivables.receiptAction(db, users.manager, summerClaim.id, summerReceipt.id, 'confirm', { note: 'طوبق إشعار منشورات الصيف بكشف الحساب', matching_evidence: 'كشف بنكي تجريبي يظهر الدفعة الأخيرة' }));
  assert.deepEqual(offboarding.offboardingChecklist(db, '36t', s.client).filter(i => i.blocking).map(i => i.key).sort(), ['contracts_in_force', 'unbilled_deliveries', 'unrefunded_money'], 'delivered and accepted, but not yet claimed — and the on-account money still waits for a claim to take it');
  let claim = tx(() => receivables.createClaim(db, users.employee, { delivery_id: c.deliveries.find(d => d.line_index === 1).id, amount: '46000.00', due_date: '2099-12-20', entitlement_evidence: 'محضر القبول التجريبي الثاني وبند العقد' }));
  claim = tx(() => receivables.claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
  claim = tx(() => receivables.claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'طوبق القبول الثاني وبند العقد' }));
  // مال الصفقة الأولى الواصل على الحساب (الخطوة 9b) يُخصَّص على استحقاقها هذا — هذا مساره الوحيد (هـ24 #9) — والباقي قبض.
  const account = receivables.listReceivables(db, users.manager).account_receipts.find(x => x.case_id === s.deal);
  tx(() => receivables.allocateReceipt(db, users.manager, account.id, { lines: [{ claim_id: claim.id, amount: '10000.00' }], note: 'تخصيص مال الحساب على استحقاق المنشورات حسب كتاب العميل' }));
  const receipt = tx(() => receivables.recordReceipt(db, users.employee, claim.id, { reference: 'RCPT-SYN-7001-2', amount: '36000.00', received_on: riyadh(), payer: 'شركة الأفق التجريبية', evidence: 'إشعار تحويل تجريبي ثانٍ محفوظ' }));
  tx(() => receivables.receiptAction(db, users.manager, claim.id, receipt.id, 'confirm', { note: 'طوبق الإشعار الثاني بكشف الحساب', matching_evidence: 'كشف بنكي تجريبي يظهر الحركة الثانية' }));
  tx(() => register.contractAction(db, users.outsider, s.contract, 'terminate_contract', { version: db.prepare('SELECT version FROM contract_records WHERE id=?').get(s.contract).version, note: 'إنهاء تجريبي باكتمال النطاق، خطاب رقم SYN-7001-T' }));
  assert.deepEqual(offboarding.offboardingChecklist(db, '36t', s.client).filter(i => i.blocking), [], 'nothing open');
  // السجل يقرّه حامل clients.manage غير طالبه؛ وبقراره يخرج الفريق ويبقى الملف محفوظًا.
  const { id } = request();
  assert.equal(caught(() => tx(() => offboarding.offboardingAction(db, users.outsider, id, 'approve_offboarding', { version: 1, note: 'اعتماد ذاتي' }))).code, 'offboarding_transition');
  tx(() => offboarding.offboardingAction(db, users.manager, id, 'approve_offboarding', { version: 1, note: 'اطلعت على قائمة الفحص: لا ذمة ولا بند ولا عقد ساري' }));
  assert.deepEqual({ ...db.prepare('SELECT status,offboarding_id FROM clients WHERE id=?').get(s.client) }, { status: 'closed', offboarding_id: id });
  assert.equal(agency.clientsBoard(db, users.employee).clients.some(x => x.id === s.client), false, 'access removed: the team left the file');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE client_id=?').get(s.client).n, 3, 'the deals are kept as they were');
  const kept = JSON.parse(db.prepare('SELECT retention FROM client_offboardings WHERE id=?').get(id).retention);
  assert.equal(kept.source, 'unset', 'what is kept, and for how long, follows the privacy register — empty here, so nothing is disposed and no period is invented');
  assert.equal(caught(() => tx(() => commercial.createLead(db, users.outsider, { client_id: s.client, source: 'محاولة بعد الإقفال', contact: 'جهة' }))).code, 'client_closed', 'no new deal on a closed file, even for its owner');
  assert.equal(caught(() => tx(() => agency.clientAction(db, users.outsider, s.client, 'add_contact', { name: 'جهة تجريبية بعد الإقفال', title: 'مدير', email: '', phone: '' }))).code, 'client_closed');
});

test('SYN-7001: the whole cycle leaves one unbroken audit chain', () => {
  assert.equal(verifyAudit(w.db), true);
});
