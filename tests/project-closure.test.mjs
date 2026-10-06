// إقفال المشروع فنيًا ثم ماليًا: سجلات ثابتة بقائمتي تحقق (ترحيل 163، app/project-axes.mjs).
// معايير العقد بنصها، ولكلٍّ اختبار يثبتها من مسارها الحقيقي في المنصة لا بإدراج SQL:
//   (1) الإقفال الفني والمالي سجلان ثابتان منفصلان بحالتين منفصلتين.
//   (2) الفني يشترط مخرجات مقبولة، وملاحظات محسومة أو مستثناة باعتماد، وحزم عمل مكتملة، ودليلًا محفوظًا.
//   (3) المالي يشترط حسم الذمم والتزامات الموردين والمصروفات والدفعات المقدمة والأصول والقيود غير المرحّلة
//       والضرائب والإشعارات الدائنة والمبالغ المستردة، ونتيجة هامش مقبولة.
//   (4) لا إقفال مالي قبل الفني.
//   (5) لا إعادة فتح إلا بسجل جديد مخوَّل بسبب، ويبقى كل إقفال سابق.
// وما حول المعايير: الصلاحيات وفصل المهام، والمسارات السالبة، والتكرار، والسباق مع استحقاق أو قيد جديد،
// وسلسلة التدقيق، وعزل الكيان، ونقل الإقفال القائم قبل الترحيل.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, now, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createLead, commercialAction, listCommercial } from '../app/commercial.mjs';
import { createTask } from '../app/projects.mjs';
import { createClaim, claimAction, recordReceipt, receiptAction } from '../app/receivables.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { prepareInvoice, prepareCreditNote, invoiceAction, recordCompanyProfile, approveCompanyProfile, recordCustomerProfile } from '../app/invoices.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { submitClaim, claimAction as expenseAction } from '../app/expenses.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { createItem, createBooking, bookingAction } from '../app/equipment.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { createRoute, getRoute, reviewAction } from '../app/review-rounds.mjs';
import { registerApprover } from '../app/client-approvals.mjs';
import { createFinanceReference, journalAction } from '../app/finance.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import { projectMarginFigures } from '../app/profitability.mjs';
import * as axes from '../app/project-axes.mjs';
import { createApp } from '../app/server.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { PASSWORD, sessionsFor } from './definitions-fixture.mjs';
import { handOverProject } from './handover-fixture.mjs';

const code = value => error => error.code === value;
const caught = run => { try { run(); } catch (error) { return error; } assert.fail('كان يجب أن يُرفض'); };
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const NOTE = { technical: 'سُلّمت المخرجات وقُبلت ووُثّقت شهادة الإنجاز المصطنعة', financial: 'حُسمت البنود المالية أو قُرّر فيها بسبب مكتوب في التجربة',
  profitability: 'الهامش الفعلي مقابل المخطط مكتوب وسبب الفرق واضح في التجربة', lessons: 'توثيق الشهادة قبل الفوترة سهّل الإقفال في التجربة المصطنعة' };
const address = { building: '1234', street: 'شارع مصطنع', district: 'حي مصطنع', city: 'الرياض', postal_code: '12345', country: 'SA' };
const refsOf = error => error.details.refusal.missing.map(m => m.doc_key);

function fixture(t, { password = 'synthetic-project-closure' } = {}) {
  const db = openDb(':memory:');
  seed(db, password);
  t.after(() => db.close());
  // مديرة مشروع في الإدارة المالكة، ومقفل مالي، وقارئة ربحية، وموظفتا دفعة مقدمة، وأمين مخزن: أيدٍ منفصلة.
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('pm-c','36t','creative','pm-c','مديرة مشروع مصطنعة','unused-test-hash','pm','manager'),
    ('closer','36t','ops','closer','مقفل مالي مصطنع','unused-test-hash','employee',NULL),
    ('reader','36t','ops','reader','قارئة الربحية المصطنعة','unused-test-hash','employee',NULL),
    ('billing-a','36t','ops','billing-a','مسجلة الدفعة المقدمة','unused-test-hash','employee',NULL),
    ('billing-b','36t','ops','billing-b','مؤكدة قبض الدفعة','unused-test-hash','employee',NULL),
    ('keeper','36t','ops','keeper','أمين المخزن المصطنع','unused-test-hash','employee',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار الإقفال المصطنع' }));
  const finance = (who, actions) => { for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), users[who].tenant_id, who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مالي مصطنع لاختبار الإقفال', null, now()); };
  finance('employee', ['read', 'prepare', 'configure']);
  finance('manager', ['read', 'approve']);
  finance('closer', ['read', 'approve', 'post']);
  grant('reader', 'profitability.view');
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, { name: 'عميل إقفال مصطنع', registration_number: 'CLOSE-100', contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
  c = act('manager', act('employee', c, 'qualify', { need: 'مخرجان لاختبار الإقفال', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل القرار', service_fit: 'ضمن خدمات التجربة' }), 'approve_qualification', { note: 'تأهيل مصطنع معتمد' });
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجان مصطنعان بمعياري قبول', currency: 'SAR', valid_until: '2099-12-01', lines: [
    { description: 'هوية مصطنعة', quantity: '1', unit_price: '400.00', unit_cost: '100.00', discount: '0', tax_rate: '15', acceptance: 'قبول الهوية بدليل', revisions: 1 },
    { description: 'فيلم مصطنع', quantity: '1', unit_price: '600.00', unit_cost: '150.00', discount: '0', tax_rate: '15', acceptance: 'قبول الفيلم بدليل', revisions: 1 }] }));
  c = act('manager', act('employee', c, 'submit_quote'), 'approve_quote', { note: 'العرض والنطاق والهامش مراجعة' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'محضر اتفاق مصطنع محفوظ في أرشيف التجربة', customer_representative: 'ممثل العميل المصطنع' });
  // منذ الترحيل 183 لا استحقاق بلا جدول دفعات بشروطه: دفعة عند قبول كل بند بقيمته (tests/proposal-fixture.mjs scheduleFor).
  scheduleFor(db, c.id);
  c = act('manager', c, 'create_project', { member_ids: ['employee', 'pm-c'] });
  const caseId = c.id, projectId = c.project_id;
  const live = () => listCommercial(db, users.employee).find(x => x.id === caseId);
  const project = () => db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  const deliver = index => {
    let row = act('employee', live(), 'submit_delivery', { line_index: index, evidence: `تقرير إنجاز المخرج ${index + 1} بمراجعه المسجلة` });
    const pending = row.deliveries.find(d => d.line_index === index && d.review?.status === 'pending');
    row = act('manager', row, 'accept_delivery', { delivery_id: pending.id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول مصطنع محفوظ في أرشيف التجربة', approver_id: approverFor(db, row.project_id) });
    return row.deliveries.find(d => d.line_index === index && d.review?.status === 'approved');
  };
  // الشهادة بمسارها بعد الترحيل 164 (app/completion-certificates.mjs): ممثل العميل من سجل المفوّضين بسنده، والمدير يصدر،
  // ومديرة المشروع — لا من أصدر ولا من قبل المخرجات — تسجّل قبول العميل بقناته.
  const certify = () => {
    const approver = tx(() => registerApprover(db, users['pm-c'], { project_id: projectId, name: 'ممثل العميل المصطنع', title: 'مدير المشاريع لدى العميل',
      authority_basis: 'خطاب تفويض مصطنع محفوظ في ملف الاتفاق', authority_scope: 'قبول المخرجات وشهادة الإنجاز', valid_from: '2026-01-01' }));
    const certificate = tx(() => axes.issueCompletionCertificate(db, users.manager, projectId, { scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق المصطنع',
      approver_id: approver.id, evidence: 'محضر إنجاز مصطنع محفوظ في ملف المشروع' }));
    tx(() => axes.acknowledgeCompletionCertificate(db, users['pm-c'], certificate.id, { version: certificate.version, channel: 'email', received_on: today(),
      evidence: 'بريد العميل المصطنع بقبول شهادة الإنجاز' }));
    return certificate;
  };
  const technicalList = () => axes.technicalChecklist(db, project());
  const financialList = () => axes.financialChecklist(db, project());
  const decideAll = lines => lines.filter(l => l.decidable).flatMap(l => l.outstanding).map(item => ({ ref: item.ref, resolution: `قرار مكتوب في محضر الإقفال المصطنع على ${item.code}` }));
  const technical = (who = 'manager', input = {}) => tx(() => axes.closeTechnically(db, users[who], projectId, { note: NOTE.technical, decisions: [], ...input }));
  const acceptMargin = (who = 'reader', note = 'الهامش الفعلي مقابل المخطط مراجع وسبب الفرق مكتوب') =>
    tx(() => axes.acceptMargin(db, users[who], projectId, { figures_digest: projectMarginFigures(db, '36t', projectId).digest, note }));
  const financial = (who = 'closer', input = {}) => tx(() => axes.closeFinancially(db, users[who], projectId, { note: NOTE.financial, decisions: decideAll(financialList()), ...input }));
  const final = (who = 'manager') => tx(() => axes.closeFinally(db, users[who], projectId, { version: axes.closureAxis(db, project()).version, profitability_note: NOTE.profitability, lessons: NOTE.lessons }));
  const readyTechnical = () => { deliver(0); deliver(1); certify(); return technical(); };
  const records = () => db.prepare('SELECT * FROM project_closure_records WHERE project_id=? ORDER BY closed_at,rowid').all(projectId);
  const profiles = () => {
    const profile = tx(() => recordCompanyProfile(db, users.employee, { legal_name: 'منشأة مصطنعة', vat_number: '310000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' }));
    tx(() => approveCompanyProfile(db, users.manager, profile.id, { note: 'طوبقت البيانات الضريبية للمنشأة' }));
    tx(() => recordCustomerProfile(db, users.employee, { case_id: caseId, legal_name: 'عميل مصطنع', vat_number: '300000000000003', address, source: 'عقد العميل المصطنع' }));
  };
  const claimOn = (deliveryId, amount) => tx(() => createClaim(db, users.employee, { delivery_id: deliveryId, amount, due_date: '2099-12-15', entitlement_evidence: 'محضر القبول وبند العقد المقابل للاستحقاق' }));
  const approveClaim = claim => {
    const submitted = tx(() => claimAction(db, users.employee, claim.id, 'submit', { version: claim.version, note: '' }));
    return tx(() => claimAction(db, users.manager, claim.id, 'approve', { version: submitted.version, note: 'طوبق القبول وبند العقد' }));
  };
  const issue = documentId => {
    const submitted = tx(() => invoiceAction(db, users.employee, documentId, 'submit', { version: 1, note: '' }));
    return tx(() => invoiceAction(db, users.manager, documentId, 'issue', { version: submitted.version, note: 'طوبقت الأرقام والبيانات' }));
  };
  const receive = (claimId, reference, amount) => {
    const receipt = tx(() => recordReceipt(db, users.employee, claimId, { reference, amount, received_on: today(), payer: 'عميل مصطنع', evidence: 'إشعار تحويل مصطنع محفوظ للمراجعة' }));
    tx(() => receiptAction(db, users.manager, claimId, receipt.id, 'confirm', { note: 'طوبق الإشعار بكشف الحساب', matching_evidence: 'كشف بنكي مصطنع يظهر الحركة' }));
    return receipt;
  };
  // الدفتر: الحسابات والمركز والفترة والربط المعتمد، ثم قيدٌ من المستند يعدّه موظف ويعتمده مدير ويرحّله المقفل.
  const ledger = () => {
    const ref = (kind, input) => tx(() => createFinanceReference(db, users.employee, kind, input));
    const account = (codeValue, name, type) => ref('accounts', { code: codeValue, name, account_type: type, currency: 'SAR' });
    const accounts = { receivable: account('1100', 'ذمم العملاء', 'asset'), revenue: account('4000', 'إيراد الخدمات', 'income'), output_vat: account('2200', 'ضريبة مخرجات', 'liability'),
      bank: account('1000', 'البنك', 'asset'), payable: account('2100', 'ذمم الموردين', 'liability') };
    const center = ref('cost_centers', { code: 'CLOSE-GEN', name: 'مركز اختبار الإقفال' }), year = today().slice(0, 4);
    const period = ref('periods', { name: 'سنة اختبار الإقفال', starts_on: `${year}-01-01`, ends_on: `${year}-12-31` });
    for (const purpose of Object.keys(accounts)) {
      const mapping = tx(() => recordMapping(db, users.employee, { purpose, account_id: accounts[purpose].id, cost_center_id: center.id, effective_from: '2026-01-01' }));
      tx(() => approveMapping(db, users.manager, mapping.id, { note: 'طابقت الحساب مع دليل الحسابات' }));
    }
    const draft = (kind, sourceId) => tx(() => journalFromSource(db, users.employee, { source_kind: kind, source_id: sourceId, period_id: period.id }));
    const post = journal => {
      let j = journal;
      for (const [who, action] of [['employee', 'submit'], ['manager', 'approve'], ['closer', 'post']]) j = tx(() => journalAction(db, users[who], j.id, action, { version: j.version, note: 'دليل قرار مالي مصطنع' }));
      return j;
    };
    return { draft, post };
  };
  return { db, users, tx, grant, finance, act, live, project, caseId, projectId, deliver, certify, technicalList, financialList, decideAll,
    technical, acceptMargin, financial, final, readyTechnical, records, profiles, claimOn, approveClaim, issue, receive, ledger };
}

/* ───── المعيار (2): الإقفال الفني ───── */
test('closure (2): each technical blocker is named from its source, and only defects and tasks take a written exception', t => {
  const f = fixture(t), { db, users, tx, grant, projectId } = f;
  // قبل أي تسليم: كل بند عقد يُسمّى، والشهادة ناقصة، ولا يُطوى بند عقد بقرار.
  let error = caught(() => f.technical());
  assert.equal(error.code, 'deliverable_not_accepted');
  assert.match(error.message, /«هوية مصطنعة»/); assert.match(error.message, /«فيلم مصطنع»/);
  assert.ok(refsOf(error).includes('certificate'), 'الشهادة الناقصة تُسمّى مع البنود');
  assert.throws(() => f.technical('manager', { decisions: [{ ref: 'line:0', resolution: 'قرار يحاول طي مخرج لم يُقبل بعد' }] }), code('not_decidable'));
  f.deliver(0); f.deliver(1);
  // حزمة عمل مفتوحة: لا تُطوى بقرار، وتُحسم من مسارها (الإلغاء بقرار مسؤولها).
  const pack = tx(() => axes.createWorkPackage(db, users.manager, projectId, { code: 'WP-C1', title: 'حزمة إقفال مصطنعة', department_id: 'creative', phase: 'delivery',
    objective: 'حزمة مصطنعة لاختبار شرط الحزم المكتملة', lead_id: 'pm-c', planned_start: '2026-10-01', planned_end: '2026-10-30' }));
  error = caught(() => f.technical());
  assert.equal(error.code, 'work_package_open');
  assert.throws(() => f.technical('manager', { decisions: [{ ref: `work_package:${pack.id}`, resolution: 'قرار يحاول طي حزمة عمل مفتوحة' }] }), code('not_decidable'));
  tx(() => axes.workPackageAction(db, users.manager, pack.id, 'cancel', { version: 1, note: 'أُلغيت الحزمة لأن نطاقها دخل في المخرجين المقبولين' }));
  assert.equal(f.technicalList().find(l => l.key === 'work_packages').outstanding.length, 0);
  // مهمة مفتوحة، وملاحظة جوهرية مشتركة من جولة مراجعة حقيقية.
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'تسليم الملفات المصدرية المصطنعة', assignee_id: 'pm-c', due_date: '2099-05-01', acceptance: 'الملفات المصدرية مسلَّمة' }));
  for (const who of ['employee', 'manager', 'pm-c']) grant(who, 'review.manage');
  const sAct = (who, s, action, input = {}) => tx(() => studioAction(db, users[who], s.id, action, { version: s.version, ...input }));
  let s = tx(() => createStudio(db, users.employee, { project_id: projectId, title: 'مساحة إقفال مصطنعة', reviewer_id: '', objective: 'هدف مصطنع', audience: 'جمهور مصطنع',
    audience_basis: 'سند جمهور مصطنع للاختبار', message: 'رسالة مصطنعة', prohibited_messages: 'لا ادعاءات', kpi: 'مؤشر مصطنع', measurement_source: 'مصدر قياس مصطنع', channels: ['instagram'], scope: 'نطاق مصطنع للاختبار' }));
  s = sAct('manager', sAct('employee', s, 'submit_brief'), 'approve_brief', { note: 'الموجز واضح' });
  s = sAct('employee', s, 'add_asset', { name: 'أصل مصطنع', internal_reference: 'CLOSE-ASSET-1', rights_holder: 'الشركة', rights_basis: 'owned', rights_evidence: 'ملكية داخلية مسجلة في أرشيف التجربة', valid_from: today(), valid_until: '2099-12-31', channels: ['instagram'] });
  s = sAct('manager', s, 'inspect_asset', { asset_id: s.assets[0].id, outcome: 'passed', evidence: 'فحص الحقوق والقناة والمدة مطابق' });
  s = sAct('employee', s, 'create_output', { title: 'مخرج مصطنع', channel: 'instagram', format: 'PNG', dimensions: '1080x1080', language: 'ar', brand_reference: 'دليل مصطنع', acceptance: 'مطابقة الدليل', content: 'وصف النسخة', asset_ids: [s.assets[0].id] });
  s = sAct('employee', s, 'submit_output', { output_id: s.outputs[0].id });
  s = sAct('manager', s, 'approve_output', { output_id: s.outputs[0].id, note: 'مطابق', quality_checks: { brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' } });
  const route = tx(() => createRoute(db, users['pm-c'], { output_version_id: s.outputs[0].current_version_id, name: 'جولة إقفال مصطنعة', owner_id: 'manager', template_id: '',
    stages: [{ position: 1, name: 'مراجعة داخلية', audience: 'internal', reviewer_ids: ['manager'], due_days: 3, reminder_days: 1, escalation_days: 5 }] }));
  let r = tx(() => reviewAction(db, users['pm-c'], route.id, 'add_media', { version: getRoute(db, users['pm-c'], route.id).version, kind: 'text', label: 'نص مصطنع للمراجعة', body: 'نص الإعلان المصطنع الخاضع للمراجعة في التجربة' }));
  r = tx(() => reviewAction(db, users.manager, route.id, 'annotate', { version: r.version, media_id: r.media[0].id, anchor: 'text_range', char_start: 0, char_end: 5, visibility: 'shared', body: 'الشعار أصغر من المعتمد في الدليل' }));
  const annotation = r.annotations[0];
  error = caught(() => f.technical());
  assert.deepEqual(error.details.refusal.missing.map(m => m.doc_key).sort(), [`comment:${annotation.id}`, `task:${task.id}`, 'certificate'].sort());
  assert.equal(error.code, 'comment_open', 'الرمز رمز أول باقٍ بترتيب القائمة');
  // قرار على بند لا وجود له يُرد باسمه، ولا يُكتب شيء.
  assert.throws(() => f.technical('manager', { decisions: [{ ref: `task:${randomUUID()}`, resolution: 'قرار على مهمة غير موجودة في المشروع' }] }), code('decision_unknown_item'));
  assert.throws(() => f.technical('manager', { decisions: [{ ref: `task:${task.id}`, resolution: 'قصير' }] }), code('invalid_text'), 'القرار عشرون حرفًا على الأقل');
  const decisions = [{ ref: `task:${task.id}`, resolution: 'أُلغيت المهمة لأن العميل استلم الملفات المصدرية مباشرة' },
    { ref: `comment:${annotation.id}`, resolution: 'استثناء معتمد: الشعار بحجمه الحالي وافق عليه العميل كتابيًا' }];
  error = caught(() => f.technical('manager', { decisions }));
  assert.equal(error.code, 'certificate_missing', 'الشهادة وحدها باقية، ولا تُطوى بقرار');
  const certificate = f.certify();
  const closed = f.technical('manager', { decisions });
  assert.equal(closed.state, 'closed_technically');
  const [record] = f.records();
  assert.equal(record.lock, 'technical'); assert.equal(record.closed_by, 'manager'); assert.equal(record.certificate_id, certificate.id);
  const checklist = JSON.parse(record.checklist);
  assert.deepEqual(checklist.lines.map(l => [l.key, l.status]), [['deliverables', 'clear'], ['defects', 'decided'], ['work_packages', 'clear'], ['tasks', 'decided'], ['evidence', 'clear']]);
  assert.equal(checklist.lines.find(l => l.key === 'deliverables').checked, 2);
  assert.equal(checklist.lines.find(l => l.key === 'work_packages').checked, 1, 'الحزمة الملغاة فُحصت وعُدّت');
  assert.equal(checklist.lines.find(l => l.key === 'defects').outstanding[0].resolution, decisions[1].resolution, 'الاستثناء المعتمد محفوظ بنصه مع السجل');
  const evidence = checklist.lines.find(l => l.key === 'evidence').evidence;
  assert.equal(evidence.certificate.number, certificate.number);
  assert.equal(evidence.certificate.acceptance.channel, 'email', 'قبول العميل بقناته منسوخ إلى السجل');
  assert.equal(evidence.acceptances.length, 2);
  assert.ok(evidence.acceptances.every(a => a.acceptance_evidence.length >= 10), 'دليل كل قبول منسوخ إلى السجل');
  assert.equal(record.checklist_digest, checklist.digest);
  assert.equal(verifyAudit(db), true);
});

/* ───── المعيار (4): لا مالي قبل الفني ───── */
test('closure (4): financial closure before technical closure is refused by name, in the code and in the database', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.deliver(0); f.deliver(1);
  const error = caught(() => f.financial('closer', { decisions: [] }));
  assert.equal(error.code, 'technical_closure_required');
  assert.match(error.message, /قبل ما ينقفل فنيًا/);
  assert.equal(error.details.refusal.missing[0].owner, 'مدير الفريق التجريبي', 'الرفض يسمّي مالك الخطوة الناقصة');
  assert.equal(f.records().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_closures WHERE project_id=?').get(projectId).n, 0, 'الرفض لا يترك صف إقفال');
  // حتى من خارج الشيفرة: سجل مالي بلا فني ساري لا يُكتب.
  tx(() => db.prepare("INSERT INTO project_closures(id,tenant_id,project_id,created_at,updated_at) VALUES('raw-closure','36t',?,?,?)").run(projectId, now(), now()));
  const margin = tx(() => { db.prepare("INSERT INTO project_margin_acceptances(id,tenant_id,project_id,figures,figures_digest,margin_minor,note,accepted_by,accepted_at) VALUES('raw-margin','36t',?,'{}',?,0,'قبول مصطنع مباشر لاختبار القيد','reader',?)").run(projectId, hash('x'), now()); return 'raw-margin'; });
  assert.throws(() => db.prepare("INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,margin_acceptance_id,closed_by,closed_at) VALUES('raw-fin','36t',?,'raw-closure','financial','{}',?,'إقفال مالي مباشر يسبق الفني في التجربة',?,'closer',?)")
    .run(projectId, hash('y'), margin, now()), /technical, then financial/);
  // بعد الفني: المالي يسأل عن الهامش المقبول، ولا يُطوى الهامش بقرار.
  f.certify(); f.technical();
  const marginError = caught(() => f.financial('closer', { decisions: [] }));
  assert.ok(refsOf(marginError).includes('margin'));
  assert.throws(() => f.financial('closer', { decisions: [...f.decideAll(f.financialList()), { ref: 'margin', resolution: 'قرار يحاول طي الهامش غير المقبول' }] }), code('not_decidable'));
  f.acceptMargin();
  const closed = f.financial();
  assert.equal(closed.state, 'awaiting_final');
  assert.deepEqual(f.records().map(r => r.lock), ['technical', 'financial']);
  assert.equal(verifyAudit(db), true);
});

/* ───── المعيار (3): جانب العميل ───── */
test('closure (3): receivables, credits, refunds, journals and the margin are each read from their own source', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.readyTechnical();
  f.profiles();
  const deliveries = f.live().deliveries.filter(d => d.review?.status === 'approved');
  const first = deliveries.find(d => d.line_index === 0), second = deliveries.find(d => d.line_index === 1);
  const receivables = () => f.financialList().find(l => l.key === 'receivables');
  assert.deepEqual(receivables().outstanding.map(i => i.code), ['delivery_not_billed', 'delivery_not_billed'], 'مخرج مقبول بلا استحقاق ذمة لم تُسجل');
  let claim = f.claimOn(first.id, '460.00');
  assert.deepEqual(receivables().outstanding.map(i => i.code), ['delivery_not_billed', 'claim_in_progress']);
  claim = f.approveClaim(claim);
  // الاستحقاق المعتمد بلا فاتورة باقٍ مرتين بالمرجع نفسه: لم يُفوتر ولم يُحصَّل. قرار واحد على المرجع يحسمهما.
  assert.deepEqual(receivables().outstanding.map(i => [i.code, i.ref]), [['delivery_not_billed', `delivery:${second.id}`], ['claim_not_invoiced', `claim:${claim.id}`], ['claim_not_collected', `claim:${claim.id}`]]);
  const invoice = f.issue(tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: today(), vat_category: 'standard', vat_reason: '' })).id);
  assert.deepEqual(receivables().outstanding.map(i => i.code), ['delivery_not_billed', 'claim_not_collected']);
  const journals = () => f.financialList().find(l => l.key === 'journals');
  assert.deepEqual(journals().outstanding.map(i => [i.code, i.ref]), [['document_not_journalized', `journal:tax_invoice:${invoice.id}`]]);
  const receipt = f.receive(claim.id, 'CLOSE-RCPT-1', '460.00');
  assert.deepEqual(receivables().outstanding.map(i => i.code), ['delivery_not_billed'], 'حُصّل صافي الاستحقاق كاملًا');
  // الهامش يُقبل على الرقم كما هو الآن.
  assert.equal(f.acceptMargin().replay, false);
  // إشعار دائن: مسودته بند في «الإشعارات»، وإصداره بعد التحصيل الكامل يجعل للعميل مبلغًا زائدًا.
  const credit = tx(() => prepareCreditNote(db, users.employee, invoice.id, { amount: '115.00', reason: 'خصم متفق عليه بعد مراجعة نطاق التسليم المصطنع' }));
  assert.deepEqual(f.financialList().find(l => l.key === 'credits').outstanding.map(i => [i.code, i.ref]), [['credit_note_pending', `credit_note:${credit.id}`]]);
  f.issue(credit.id);
  assert.equal(f.financialList().find(l => l.key === 'credits').outstanding.length, 0);
  const refunds = f.financialList().find(l => l.key === 'refunds');
  assert.deepEqual(refunds.outstanding.map(i => [i.code, i.ref]), [['refund_due', `refund:${claim.id}`]]);
  assert.match(refunds.outstanding[0].item, /115\.00/, 'الزيادة بمبلغها: 460 مقبوضة على صافٍ 345');
  assert.ok(refunds.not_applicable.some(n => /رد مبلغ/.test(n.topic + n.reason)), 'لا سجل رد في المنصة: مسمّى لا مسكوت عنه');
  assert.equal(axes.collectionAxis(db, f.project()).state, 'collected', 'محور التحصيل يقرأ الصافي بعد الإشعار الدائن');
  // الهامش المقبول قبل الإشعار تغيّر: لا يُحتسب قبوله.
  const stale = f.financialList().find(l => l.key === 'margin');
  assert.deepEqual(stale.outstanding.map(i => i.code), ['margin_stale']);
  // القيد: موجود ولم يُرحَّل بند، وبلا قيد بند.
  const { draft } = f.ledger();
  draft('tax_invoice', invoice.id);
  assert.deepEqual(journals().outstanding.map(i => [i.code, i.ref]).sort(), [
    ['document_not_journalized', `journal:ar_receipt:${receipt.id}`], ['document_not_journalized', `journal:credit_note:${credit.id}`], ['journal_unposted', `journal:tax_invoice:${invoice.id}`]].sort());
  // الإقفال: كل بند قابل للقرار يُعطى قراره، والهامش يُقبل من جديد.
  f.acceptMargin();
  const decisions = f.decideAll(f.financialList());
  const closed = f.financial('closer', { decisions });
  assert.equal(closed.financial_state, 'closed');
  const record = f.records().find(r => r.lock === 'financial');
  const lines = JSON.parse(record.checklist).lines;
  assert.deepEqual(lines.map(l => l.key), ['technical', 'receivables', 'supplier_liabilities', 'expenses', 'advances', 'assets', 'journals', 'taxes', 'credits', 'refunds', 'margin']);
  assert.deepEqual(Object.fromEntries(lines.map(l => [l.key, l.status])), { technical: 'clear', receivables: 'decided', supplier_liabilities: 'clear', expenses: 'clear',
    advances: 'clear', assets: 'clear', journals: 'decided', taxes: 'clear', credits: 'clear', refunds: 'decided', margin: 'clear' });
  assert.ok(lines.find(l => l.key === 'refunds').outstanding.every(i => i.resolution.length >= 20), 'القرار محفوظ بنصه مع البند');
  assert.equal(record.margin_acceptance_id, lines.find(l => l.key === 'margin').evidence.acceptance_id);
  // بعد الإقفال المالي: المخرج غير المطالَب به لا يُفتح عليه استحقاق إلا بإعادة فتح الإقفال — في الشيفرة وفي القاعدة.
  const late = caught(() => f.claimOn(second.id, '690.00'));
  assert.equal(late.code, 'project_financially_closed');
  assert.match(late.message, /إعادة فتح الإقفال المالي/);
  // الكتابة المباشرة تسمّي دفعتها من الجدول (الترحيل 183) فتمرّ بحارس البند، ويردّها حارس الإقفال.
  assert.throws(() => tx(() => {
    const id = randomUUID();
    db.prepare("INSERT INTO ar_claim_terms(claim_id,tenant_id,case_id,term_id,created_at) SELECT ?,'36t',case_id,id,? FROM case_payment_terms WHERE case_id=? AND position=1").run(id, now(), f.caseId);
    db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,delivery_id,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,revision,created_at,updated_at) SELECT ?,'36t',k.id,?,k.case_id,'employee','delivery',?,'','{}','SAR','69000','2099-12-15','استحقاق مباشر بعد الإقفال','draft',1,0,?,? FROM commercial_contracts k WHERE k.case_id=?")
      .run(id, projectId, second.id, now(), now(), f.caseId);
  }), /financially closed/);
  assert.equal(verifyAudit(db), true);
});

/* ───── المعيار (3): جانب المورد ───── */
test('closure (3): supplier liabilities and supplier taxes are read from procurement, payables and payment orders', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.readyTechnical();
  fundProject(db, projectId, 'CLOSE-CC-1', '5000.00');
  approveVendors(db, ['close-a', 'close-b', 'close-c']);
  const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  const supplier = () => f.financialList().find(l => l.key === 'supplier_liabilities');
  let p = tx(() => createPurchase(db, users.employee, { project_id: projectId, title: 'تصوير مصطنع للإقفال', specification: 'يوم تصوير بالمواصفات المسجلة', cost_center: 'CLOSE-CC-1',
    due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '3000.00', budget_evidence: 'مخصص المشروع المعتمد', currency: 'SAR' }));
  assert.deepEqual(supplier().outstanding.map(i => [i.code, i.ref]), [['purchase_open', `purchase:${p.id}`]], 'حتى المسودة طلب مفتوح: لا تتقدم بعد الإقفال بصمت');
  p = pAct('employee', p, 'submit');
  for (const [key, price] of [['close-a', '2500.00'], ['close-b', '2600.00'], ['close-c', '2700.00']])
    p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد إقفال ' + key, unit_price: price, technical_assessment: 'مطابق للمواصفات المسجلة', financial_terms: 'صافي 30 يومًا', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ' });
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'CLOSE-A').id, note: 'أقل سعر مطابق فنيًا ومورد مؤهل' });
  p = pAct('manager', p, 'approve_order', { terms: 'شروط التوريد المصطنعة', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء' });
  p = pAct('manager', p, 'commence', { start_on: today(), valid_until: '2099-10-20', site_or_channel: 'موقع التصوير المصطنع', scope_confirmation: 'أكدت للمورد نطاق العمل وتاريخ البدء قبل إذن المباشرة',
    evidence: 'بريد إذن المباشرة المرسل للمورد المصطنع وردّه بالاستلام' });
  assert.equal(supplier().outstanding[0].code, 'purchase_open');
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'CLOSE-GRN-1', evidence: 'محضر استلام يوم التصوير' });
  assert.deepEqual(supplier().outstanding.map(i => i.code), ['receipt_not_invoiced'], 'استُلم ولم تصل فاتورته: التزام مستحق غير مسجل');
  p = pAct('employee', p, 'record_invoice', { quantity: 1, amount: '2500.00', supplier_reference: 'CLOSE-SINV-1', evidence: 'فاتورة المورد المصطنعة' });
  assert.deepEqual(supplier().outstanding.map(i => [i.code, i.ref]), [['supplier_invoice_unmatched', `supplier_invoice:${p.invoices[0].id}`]]);
  assert.deepEqual(f.financialList().find(l => l.key === 'taxes').outstanding.map(i => [i.code, i.ref]), [['supplier_invoice_untaxed', `invoice:${p.invoices[0].id}`]]);
  p = pAct('manager', p, 'match', { invoice_id: p.invoices[0].id, note: 'طابقت الأمر والاستلام والفاتورة' });
  const payable = p.payables[0];
  assert.deepEqual(supplier().outstanding.map(i => [i.code, i.ref]), [['payable_not_settled', `payable:${payable.id}`]]);
  assert.match(supplier().outstanding[0].item, /مورد إقفال close-a|2,500\.00/);
  assert.deepEqual(f.financialList().find(l => l.key === 'journals').outstanding.map(i => i.ref), [`journal:procurement_payable:${payable.id}`], 'المستحق المطابق بلا قيد');
  f.acceptMargin();
  const refusal = caught(() => f.financial('closer', { decisions: [] }));
  // المخرجان المقبولان بلا استحقاق باقيان من جانب العميل في هذا المشروع؛ ما عداهما بنود المورد وحدها.
  assert.deepEqual(refsOf(refusal).filter(ref => !ref.startsWith('delivery:')).sort(), [`payable:${payable.id}`, `invoice:${p.invoices[0].id}`, `journal:procurement_payable:${payable.id}`].sort(), 'كل باقٍ باسمه ولا شيء غيره');
  assert.equal(refsOf(refusal).filter(ref => ref.startsWith('delivery:')).length, 2);
  const closed = f.financial('closer', { decisions: f.decideAll(f.financialList()) });
  assert.equal(closed.financial_state, 'closed');
  const lines = JSON.parse(f.records().find(r => r.lock === 'financial').checklist).lines;
  assert.equal(lines.find(l => l.key === 'supplier_liabilities').status, 'decided');
  assert.equal(lines.find(l => l.key === 'taxes').status, 'decided');
  assert.ok(lines.find(l => l.key === 'taxes').not_applicable.length >= 2, 'الإقرار لكل مشروع والتصديق الإلكتروني: لا مصدر، مسمّيان بسببهما');
  // لا شراء جديد على مشروع مقفل ماليًا.
  assert.throws(() => tx(() => createPurchase(db, users.employee, { project_id: projectId, title: 'شراء بعد الإقفال المالي', specification: 'مواصفة مصطنعة بعد الإقفال', cost_center: 'CLOSE-CC-1',
    due_date: '2099-10-20', quantity: 1, unit: 'يوم', budget_amount: '100.00', budget_evidence: 'مخصص المشروع المعتمد', currency: 'SAR' })), code('project_financially_closed'));
  assert.equal(verifyAudit(db), true);
});

/* ───── المعيار (3): المصروفات والدفعات المقدمة والأصول ───── */
test('closure (3): expenses, advances and company assets on the project are read from their own records', t => {
  const f = fixture(t), { db, users, tx, grant, projectId } = f;
  f.readyTechnical();
  const line = key => f.financialList().find(l => l.key === key);
  // المصروف: عند المدير، ثم عند المالية، ثم معتمد بلا تعويض، ثم معوَّض.
  let expense = tx(() => submitClaim(db, users.employee, { expense_date: today(), category: 'transport', description: 'مواصلات مصطنعة لموقع التصوير', amount: '80.00', receipt_reference: 'CLOSE-EXP-1', custody_id: '', project_id: projectId }));
  assert.deepEqual(line('expenses').outstanding.map(i => [i.code, i.ref, i.owner]), [['expense_pending', `expense:${expense.id}`, 'المدير المباشر لصاحب المطالبة']]);
  const step = (who, action, input) => { const row = db.prepare('SELECT version FROM expense_claims WHERE id=?').get(expense.id); return tx(() => expenseAction(db, users[who], expense.id, action, { version: row.version, ...input })); };
  step('manager', 'manager_approve', { note: 'الغرض مطابق للمشروع' });
  assert.equal(line('expenses').outstanding[0].code, 'expense_pending');
  step('closer', 'finance_approve', { note: 'المبلغ والإيصال مطابقان' });
  assert.deepEqual(line('expenses').outstanding.map(i => i.code), ['expense_not_reimbursed']);
  step('closer', 'record_reimbursement', { reimbursed_on: today(), reference: 'CLOSE-REIMB-1' });
  assert.equal(line('expenses').outstanding.length, 0);
  assert.deepEqual(line('journals').outstanding.map(i => i.ref).sort(), [`journal:expense_claim:${expense.id}`, `journal:expense_reimbursement:${expense.id}`].sort());
  // الدفعة المقدمة: مسجلة، ثم مقبوضة بلا سحب، ثم مسحوبة كاملة على فاتورة المشروع.
  for (const who of ['manager', 'billing-a', 'billing-b']) grant(who, 'billing.recurring.manage');
  grant('employee', 'clients.manage');
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  const client = db.prepare('SELECT c.* FROM clients c JOIN commercial_cases k ON k.client_id=c.id WHERE k.id=?').get(f.caseId);
  const advance = tx(() => billing.recordAdvance(db, users['billing-a'], { client_id: client.id, schedule_id: '', project_id: projectId, description: 'دفعة مقدمة مصطنعة', agreement_reference: 'بند 3-1 من الاتفاق المصطنع', amount: '300.00' }));
  assert.deepEqual(line('advances').outstanding.map(i => [i.code, i.ref]), [['advance_unconfirmed', `advance:${advance.id}`]]);
  tx(() => billing.confirmAdvance(db, users['billing-b'], advance.id, { version: 1, amount: '300.00', received_on: today(), evidence: 'إشعار تحويل بنكي مصطنع مطابق للمبلغ', reference: 'TRF-CLOSE-300' }));
  assert.deepEqual(line('advances').outstanding.map(i => i.code), ['advance_unapplied']);
  assert.match(line('advances').outstanding[0].item, /300\.00/);
  const draw = tx(() => billing.planDraw(db, users.manager, advance.id, { target_reference: 'فاتورة المشروع الأولى المصطنعة', amount: '300.00' }));
  tx(() => billing.applyDraw(db, users.manager, draw.id, { version: 1, amount: '300.00', note: 'سُحبت الدفعة كاملة على الفاتورة الأولى' }));
  assert.equal(line('advances').outstanding.length, 0);
  assert.deepEqual(line('advances').not_applicable.map(n => n.topic), ['عهد الموظفين', 'دفعات مقدمة للموردين']);
  // الأصول: معدة محجوزة على المشروع بند حتى يُلغى حجزها أو ترجع.
  grant('keeper', 'equipment.manage');
  const item = tx(() => createItem(db, users.keeper, { name: 'كاميرا مصطنعة', category: 'camera', serial_no: '', condition_state: 'good', condition_note: '', home_location: 'المخزن', asset_id: '' }));
  const booking = tx(() => createBooking(db, users.keeper, { item_id: item.id, kit_id: '', project_id: projectId, production_ref: '', purpose: 'تصوير المشروع المصطنع', start_date: today(), end_date: today(), custodian_id: 'employee' }));
  const bookingId = booking.id;
  assert.deepEqual(line('assets').outstanding.map(i => [i.code, i.ref, i.owner]), [['equipment_not_returned', `booking:${bookingId}`, 'الموظفة التجريبية']]);
  assert.ok(line('assets').not_applicable.some(n => /fixed_assets/.test(n.reason)), 'الأصل الثابت بلا ربط بمشروع: مسمّى بسببه');
  tx(() => bookingAction(db, users.keeper, bookingId, 'cancel', { version: 1, note: 'أُلغي الحجز بعد انتهاء التصوير' }));
  assert.equal(line('assets').outstanding.length, 0);
  f.acceptMargin();
  f.financial();
  // مصروف جديد على المشروع بعد إقفاله المالي يُرد ويسمّي الطريق.
  assert.throws(() => tx(() => submitClaim(db, users.employee, { expense_date: today(), category: 'transport', description: 'مواصلات مصطنعة بعد الإقفال المالي', amount: '50.00', receipt_reference: 'CLOSE-EXP-2', custody_id: '', project_id: projectId })), code('project_financially_closed'));
  assert.ok(tx(() => submitClaim(db, users.employee, { expense_date: today(), category: 'transport', description: 'مواصلات مصطنعة بلا ربط بالمشروع', amount: '50.00', receipt_reference: 'CLOSE-EXP-3', custody_id: '', project_id: '' })).id, 'المصروف بلا مشروع يمر');
  assert.equal(verifyAudit(db), true);
});

/* ───── المعيار (5): إعادة الفتح ───── */
test('closure (5): reopening is a new authorised record with a reason, ends the closures built on it, and every earlier closure stays', t => {
  const f = fixture(t), { db, users, tx, grant, projectId } = f;
  f.readyTechnical(); f.acceptMargin(); f.financial(); f.final();
  const before = f.records();
  assert.deepEqual(before.map(r => r.lock), ['technical', 'financial', 'final']);
  const version = () => axes.closureAxis(db, f.project()).version;
  const reopen = (who, input) => tx(() => axes.reopenClosure(db, users[who], projectId, { version: version(), ...input }));
  // من أقفل لا يعيد الفتح بلا السلطة، ولا أحد بلا سبب مكتوب.
  assert.throws(() => reopen('manager', { scope: 'technical', reason: 'عاد العميل بملاحظة جوهرية على الفيلم المصطنع' }), code('not_permitted'));
  grant('manager', 'projects.closure.reopen');
  assert.throws(() => reopen('manager', { scope: 'technical', reason: 'خطأ' }), code('invalid_text'));
  const reopened = reopen('manager', { scope: 'technical', reason: 'عاد العميل بملاحظة جوهرية على الفيلم المصطنع بعد الإقفال' });
  assert.equal(reopened.state, 'reopened');
  assert.deepEqual([reopened.technical_state, reopened.financial_state, reopened.final_state], ['open', 'open', 'open'], 'المالي والنهائي لا يبقيان على فني أُعيد فتحه');
  // كل إقفال سابق باقٍ بنصه وقائمته، ومعلَّم بما أنهاه.
  const after = f.records();
  assert.deepEqual(after.map(r => [r.id, r.checklist, r.note, r.closed_by, r.closed_at]), before.map(r => [r.id, r.checklist, r.note, r.closed_by, r.closed_at]));
  const ends = db.prepare('SELECT * FROM project_closure_record_ends ORDER BY cascaded,record_id').all();
  assert.equal(ends.length, 3);
  assert.deepEqual(ends.map(e => [before.find(r => r.id === e.record_id).lock, e.cascaded]).sort(), [['final', 1], ['financial', 1], ['technical', 0]]);
  assert.ok(ends.every(e => e.reopening_id === reopened.reopenings[0].id));
  assert.equal(reopened.reopenings[0].ended_records.length, 3);
  assert.ok(reopened.records.every(r => !r.in_force));
  // لا تعديل ولا حذف لسجل أو إنهاء، ولا إقفال يُكتب في الصف بلا سجله.
  assert.throws(() => db.prepare("UPDATE project_closure_records SET note='نص معدل بعد الإقفال للتجربة' WHERE id=?").run(before[0].id), /written once/);
  assert.throws(() => db.prepare('DELETE FROM project_closure_records WHERE id=?').run(before[0].id), /retained/);
  assert.throws(() => db.prepare('DELETE FROM project_closure_record_ends').run(), /append only/);
  assert.throws(() => db.prepare("UPDATE project_closure_record_ends SET cascaded=0").run(), /stays ended/);
  const row = db.prepare('SELECT * FROM project_closures WHERE project_id=?').get(projectId);
  assert.throws(() => db.prepare("UPDATE project_closures SET technical_state='closed',technical_closed_by='manager',technical_closed_at=?,certificate_id=?,version=version+1 WHERE id=?")
    .run(now(), before[0].certificate_id, row.id), /follows its records/);
  // إقفال فني جديد سجلٌ رابع؛ الأول باقٍ منتهيًا.
  const again = f.technical('manager', { note: 'عولجت الملاحظة الجوهرية على الفيلم المصطنع وأُعيد الإقفال الفني' });
  assert.equal(again.state, 'reopened', 'إعادة الفتح تبقى مقروءة في المحور حتى الإقفال النهائي');
  assert.deepEqual(f.records().map(r => r.lock), ['technical', 'financial', 'final', 'technical']);
  assert.deepEqual(again.records.map(r => r.in_force), [false, false, false, true]);
  // الهامش لم يتغير فقبوله ما زال قائمًا؛ مالي جديد ثم نهائي جديد.
  f.financial(); f.final();
  assert.equal(axes.closureAxis(db, f.project()).state, 'closed');
  assert.equal(f.records().length, 6);
  const event = db.prepare("SELECT * FROM audit_events WHERE action='axes.closure_reopened'").get();
  assert.deepEqual(JSON.parse(event.after_json).ended_records.sort(), before.map(r => r.id).sort());
  assert.match(event.reason, /ملاحظة جوهرية/);
  assert.equal(verifyAudit(db), true);
});

/* ───── الصلاحيات وفصل المهام ───── */
test('closure: technical, margin and financial are different authorities, enforced on the server', t => {
  const f = fixture(t), { db, users, tx, finance, projectId } = f;
  f.deliver(0); f.deliver(1); f.certify();
  // الإقفال الفني لمدير المشروع المسجَّل (app/project-authority.mjs)، لا لكل من يحمل دور مدير: يُسلَّم المشروع لـpm-c بمحضر.
  handOverProject(db, projectId, 'pm-c');
  assert.throws(() => f.technical('manager'), code('not_project_manager'), 'منشئ المشروع لم يعد مديره بعد التسليم');
  assert.throws(() => f.technical('employee'), code('not_project_manager'), 'عضو المشروع بدور موظف لا يقفل فنيًا');
  assert.throws(() => f.technical('outsider'), code('project_not_found'), 'غير العضو لا يرى المشروع أصلًا');
  f.technical('pm-c');
  assert.throws(() => f.acceptMargin('manager'), code('not_permitted'), 'قبول الهامش لحامل تصريح الربحية وحده');
  assert.throws(() => f.financial('reader', { decisions: [] }), code('financial_action_denied'), 'قارئة الربحية بلا تفويض اعتماد مالي');
  // من قبِل الهامش لا يقفل عليه، ولو حمل التفويض.
  finance('reader', ['read', 'approve']);
  f.acceptMargin('reader');
  const same = caught(() => f.financial('reader'));
  assert.equal(same.code, 'margin_same_person');
  assert.match(same.message, /قبلت نتيجة الهامش/);
  // ومن خارج الشيفرة: القيد نفسه.
  const closure = db.prepare('SELECT id FROM project_closures WHERE project_id=?').get(projectId).id, acceptance = db.prepare('SELECT id FROM project_margin_acceptances').get().id;
  assert.throws(() => db.prepare("INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,margin_acceptance_id,closed_by,closed_at) VALUES('raw-same','36t',?,?,'financial','{}',?,'إقفال مالي مباشر ممن قبل الهامش',?,'reader',?)")
    .run(projectId, closure, hash('z'), acceptance, now()), /accepted by another person/);
  // والقفلان بيد واحدة (قرار المالك «ب»): من أقفل فنيًا يُرد في المالي إلا بتصريح وسبب.
  finance('pm-c', ['read', 'approve']);
  assert.throws(() => f.financial('pm-c'), code('self_approval'));
  const closed = f.financial('closer');
  assert.equal(closed.financial_closed_by_name, 'مقفل مالي مصطنع');
  assert.throws(() => f.final('employee'), code('not_project_manager'));
  assert.equal(f.final('pm-c').state, 'closed');
  assert.equal(verifyAudit(db), true);
});

/* ───── المسارات السالبة والتكرار ───── */
test('closure: negative paths — stale checklist, bad decisions, stale margin, closed scopes — write nothing, and a replay writes nothing twice', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.deliver(0); f.deliver(1); f.certify();
  const board = () => axes.closureAxis(db, f.project(), users.manager);
  assert.throws(() => f.technical('manager', { checklist_digest: hash('قائمة أخرى') }), code('checklist_changed'));
  assert.throws(() => f.technical('manager', { decisions: 'كل شيء محسوم' }), code('decisions'));
  assert.throws(() => f.technical('manager', { note: 'قصير' }), code('invalid_text'));
  assert.equal(f.records().length, 0);
  const closed = f.technical('manager', { checklist_digest: board().technical_digest });
  assert.equal(closed.records.length, 1);
  // التكرار: الإقفال نفسه مرة ثانية يُرد ولا يكتب سجلًا ولا حدثًا.
  const events = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  assert.throws(() => f.technical(), code('already_closed'));
  assert.equal(f.records().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, events);
  // الهامش: بصمة غير المعروض ترد، وتكرار القبول نفسه لا يكتب ثانيًا، وقبول شخص آخر سجلٌ جديد.
  assert.throws(() => tx(() => axes.acceptMargin(db, users.reader, projectId, { figures_digest: hash('رقم آخر'), note: 'قبول على رقم لم يُعرض على الشاشة' })), code('margin_changed'));
  const first = f.acceptMargin('reader'), replay = f.acceptMargin('reader');
  assert.equal(replay.id, first.id); assert.equal(replay.replay, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_margin_acceptances').get().n, 1);
  assert.throws(() => db.prepare("UPDATE project_margin_acceptances SET note='قبول معدل بعد تسجيله للتجربة'").run(), /recorded once/);
  assert.throws(() => db.prepare('DELETE FROM project_margin_acceptances').run(), /retained/);
  assert.throws(() => tx(() => axes.closeFinally(db, users.manager, projectId, { version: board().version, profitability_note: NOTE.profitability, lessons: NOTE.lessons })), code('financial_open'));
  f.financial();
  assert.throws(() => f.acceptMargin('reader'), code('already_closed'), 'الهامش لا يُقبل على مشروع مقفل ماليًا');
  assert.throws(() => f.financial(), code('already_closed'));
  f.grant('manager', 'projects.closure.reopen');
  assert.throws(() => tx(() => axes.reopenClosure(db, users.manager, projectId, { version: board().version, scope: 'final', reason: 'محاولة فتح نطاق مفتوح أصلًا في التجربة' })), code('not_closed'));
  assert.throws(() => tx(() => axes.reopenClosure(db, users.manager, projectId, { version: board().version - 1, scope: 'financial', reason: 'محاولة بنسخة قديمة من سجل الإقفال في التجربة' })), code('stale_version'));
  assert.equal(verifyAudit(db), true);
});

/* ───── السباق: استحقاق أو قيد جديد بين المراجعة والإقفال ───── */
test('closure: a closure racing a new receivable or journal refuses the stale review, and nothing new lands after it', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.readyTechnical(); f.profiles(); f.acceptMargin();
  const deliveries = f.live().deliveries.filter(d => d.review?.status === 'approved');
  const reviewed = () => axes.closureAxis(db, f.project(), users.closer).financial_digest;
  // المراجع يرى القائمة، ثم يُسجَّل استحقاق جديد قبل أن يحفظ: القائمة التي راجعها لم تعد القائمة.
  let digest = reviewed();
  let claim = f.claimOn(deliveries[0].id, '460.00');
  const decisionsNow = () => f.decideAll(f.financialList());
  assert.throws(() => f.financial('closer', { decisions: decisionsNow(), checklist_digest: digest }), code('checklist_changed'));
  // ويُرى أيضًا من جهة الدفتر: قيد يولد من مستند بين المراجعة والحفظ يغيّر القائمة.
  claim = f.approveClaim(claim);
  const invoice = f.issue(tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: today(), vat_category: 'standard', vat_reason: '' })).id);
  f.acceptMargin();
  digest = reviewed();
  const { draft, post } = f.ledger();
  const journal = draft('tax_invoice', invoice.id);
  assert.throws(() => f.financial('closer', { decisions: decisionsNow(), checklist_digest: digest }), code('checklist_changed'));
  assert.equal(f.records().filter(r => r.lock === 'financial').length, 0, 'لا سجل مالي من مراجعة قديمة');
  post(journal);
  // المراجعة الحالية تمر، وبعدها لا استحقاق ولا شراء ولا مصروف جديد على المشروع.
  f.financial('closer', { decisions: decisionsNow(), checklist_digest: reviewed() });
  assert.throws(() => f.claimOn(deliveries[1].id, '690.00'), code('project_financially_closed'));
  // والإقفال المتزامن: الثاني يُرد، وقيد القاعدة يمنع سجلين ساريين للقفل نفسه.
  assert.throws(() => f.financial(), code('already_closed'));
  const closure = db.prepare('SELECT id FROM project_closures WHERE project_id=?').get(projectId).id, certificate = db.prepare('SELECT id FROM completion_certificates').get().id;
  assert.throws(() => db.prepare("INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,certificate_id,closed_by,closed_at) VALUES('raw-twice','36t',?,?,'technical','{}',?,'إقفال فني ثانٍ ساري للمشروع نفسه',?,'manager',?)")
    .run(projectId, closure, hash('w'), certificate, now()), /one of each in force/);
  // إعادة فتح المالي تعيد الباب: الاستحقاق الجديد يُقبل بعدها.
  f.grant('manager', 'projects.closure.reopen');
  tx(() => axes.reopenClosure(db, users.manager, projectId, { version: axes.closureAxis(db, f.project()).version, scope: 'financial', reason: 'ظهر مخرج مقبول لم يُطالب به فأُعيد فتح الإقفال المالي' }));
  assert.equal(f.claimOn(deliveries[1].id, '690.00').status, 'draft');
  assert.equal(verifyAudit(db), true);
});

/* ───── سلسلة التدقيق وعزل الكيان ───── */
test('closure: every closure act is in the audit chain with its record, and another tenant reaches nothing', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.readyTechnical(); f.acceptMargin(); f.financial(); f.final();
  for (const action of ['axes.closed_technically', 'axes.closed_financially', 'axes.closed_finally']) {
    const event = db.prepare('SELECT * FROM audit_events WHERE action=?').get(action);
    const recordId = JSON.parse(event.after_json).record_id;
    assert.ok(db.prepare('SELECT 1 FROM project_closure_records WHERE id=?').get(recordId), `${action} يحمل سجله`);
  }
  assert.equal(JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE action='axes.margin_accepted'").get().after_json).acceptance_id,
    db.prepare('SELECT id FROM project_margin_acceptances').get().id);
  assert.equal(verifyAudit(db), true);
  // كيان آخر: لا قراءة ولا كتابة ولا لوحة.
  const external = users.external;
  assert.throws(() => tx(() => axes.closeTechnically(db, external, projectId, { note: NOTE.technical, decisions: [] })), code('project_not_found'));
  assert.throws(() => tx(() => axes.closeFinancially(db, external, projectId, { note: NOTE.financial, decisions: [] })), code('project_not_found'));
  assert.throws(() => tx(() => axes.acceptMargin(db, external, projectId, { figures_digest: hash('x'), note: 'محاولة قبول هامش من كيان آخر' })), code('project_not_found'));
  assert.throws(() => tx(() => axes.reopenClosure(db, external, projectId, { version: 1, scope: 'final', reason: 'محاولة إعادة فتح من كيان آخر معزول' })), code('project_not_found'));
  assert.deepEqual(axes.closureBoard(db, external).projects, []);
  assert.throws(() => db.prepare("INSERT INTO project_margin_acceptances(id,tenant_id,project_id,figures,figures_digest,margin_minor,note,accepted_by,accepted_at) VALUES('cross','isolated',?,'{}',?,0,'قبول من كيان آخر على مشروع ليس له','external',?)")
    .run(projectId, hash('c'), now()), /FOREIGN KEY/);
});

/* ───── المسارات عبر الخادم ───── */
test('closure: the routes carry the same rules over HTTP — the board, margin acceptance, and the refusals by name', async t => {
  const f = fixture(t, { password: PASSWORD }), { db, users, finance, grant, projectId } = f;
  f.deliver(0); f.deliver(1); f.certify();
  finance('outsider', ['read', 'approve']);
  grant('hr', 'profitability.view');
  const app = createApp(db), { call } = await sessionsFor(app, ['manager', 'outsider', 'hr']);
  const early = await call('outsider', `/projects/${projectId}/close_financially`, { note: NOTE.financial, decisions: [] }, 409);
  assert.equal(early.json().error.code, 'technical_closure_required');
  assert.equal(early.json().error.details.refusal.missing[0].document, 'الإقفال الفني للمشروع');
  const board = (await call('manager', '/project-closures', undefined, 200)).json();
  const mine = board.projects.find(p => p.id === projectId);
  assert.ok(mine.closure.allowed_actions.includes('close_technically'));
  await call('manager', `/projects/${projectId}/close_technically`, { note: NOTE.technical, decisions: [], checklist_digest: mine.closure.technical_digest }, 201);
  const replay = await call('manager', `/projects/${projectId}/close_technically`, { note: NOTE.technical, decisions: [] }, 409);
  assert.equal(replay.json().error.code, 'already_closed');
  const forHr = (await call('hr', '/project-closures', undefined, 200)).json().projects.find(p => p.id === projectId);
  assert.ok(forHr, 'قارئ الربحية يرى المشروع المقفل فنيًا ولو لم يكن عضوًا فيه');
  assert.equal(forHr.closure.margin.visible, true);
  assert.deepEqual(forHr.closure.allowed_actions, ['accept_margin']);
  const accepted = await call('hr', `/projects/${projectId}/accept_margin`, { figures_digest: forHr.closure.margin.digest, note: 'الهامش الفعلي مقابل المخطط مراجع وسبب الفرق مكتوب' }, 201);
  assert.equal(accepted.json().replay, false);
  const forManager = (await call('manager', '/project-closures', undefined, 200)).json().projects.find(p => p.id === projectId);
  assert.equal(forManager.closure.margin.visible, false);
  assert.equal(forManager.closure.margin.figures, undefined, 'الرقم لحامل تصريح الربحية وحده');
  const forFinance = (await call('outsider', '/project-closures', undefined, 200)).json().projects.find(p => p.id === projectId);
  assert.deepEqual(forFinance.closure.allowed_actions, ['close_financially']);
  const closed = await call('outsider', `/projects/${projectId}/close_financially`, { note: NOTE.financial, decisions: f.decideAll(f.financialList()), checklist_digest: forFinance.closure.financial_digest }, 201);
  assert.equal(closed.json().state, 'awaiting_final');
  assert.equal(verifyAudit(db), true);
});

/* ───── الشاشة ───── */
// الشاشة لا تحرس شيئًا، لكن زرًّا يفتح نموذجًا لا يقبله الخادم نقرةٌ ميتة. فكل زر إقفال ترسمه شاشة العملاء والعروض لصاحبه
// يُفتح نموذجه، ويُرسل ما يبنيه إلى الدالة التي يصلها مساره، ويمر.
test('closure: the commercial screen draws each closure button for its holder, and each form builds a payload the server accepts', t => {
  const f = fixture(t), { db, users, tx, grant, projectId } = f;
  f.deliver(0); f.deliver(1); f.certify();
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const button = (action, id, label) => `<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  const screen = who => {
    const data = { rows: listCommercial(db, users[who]), team: [], user: users[who], closures: axes.closureBoard(db, users[who]) };
    return { data, html: commercialUI.render(data, { e, button }) };
  };
  const routes = { close_technically: axes.closeTechnically, accept_margin: axes.acceptMargin, close_financially: axes.closeFinancially, close_finally: axes.closeFinally, reopen_closure: axes.reopenClosure };
  const press = (who, action, values) => {
    const { data, html } = screen(who);
    assert.match(html, new RegExp(`data-operation="${action}" data-id="${projectId}"`), `${who}: زر ${action} مرسوم`);
    const spec = commercialUI.form(action, projectId, data);
    assert.equal(spec.endpoint, `/projects/${projectId}/${action}`, 'المسار نفسه الذي يوجّهه الخادم');
    return tx(() => routes[action](db, users[who], projectId, spec.toPayload(values)));
  };
  assert.doesNotMatch(screen('employee').html, /data-operation="close_technically"/, 'عضو المشروع بدور موظف لا يُرسم له زر الإقفال الفني');
  press('manager', 'close_technically', { note: NOTE.technical, same_person_reason: '' });
  press('reader', 'accept_margin', { note: 'الهامش الفعلي مقابل المخطط مراجع وسبب الفرق مكتوب' });
  // النموذج المالي يعرض كل بند يقبل قرارًا حقلًا باسمه: المخرجان المقبولان بلا مطالبة هنا.
  const financialSpec = commercialUI.form('close_financially', projectId, screen('closer').data);
  const decisionFields = financialSpec.fields.filter(field => field.name.startsWith('decision_'));
  assert.equal(decisionFields.length, 2);
  assert.ok(decisionFields.every(field => /مخرج مقبول/.test(field.label) && field.required === false));
  press('closer', 'close_financially', { note: NOTE.financial, same_person_reason: '',
    ...Object.fromEntries(decisionFields.map(field => [field.name, 'قُرّر المخرج ضمن دفعة الاتفاق الإطاري المصطنع'])) });
  press('manager', 'close_finally', { profitability_note: NOTE.profitability, lessons: NOTE.lessons });
  grant('manager', 'projects.closure.reopen');
  const reopened = press('manager', 'reopen_closure', { scope: 'final', reason: 'أُعيد فتح الإقفال النهائي لتصحيح خلاصة الربحية المصطنعة' });
  assert.equal(reopened.final_state, 'open');
  assert.match(screen('manager').html, /إعادات الفتح \(1\)/);
  assert.equal(verifyAudit(db), true);
});

/* ───── نقل الإقفال القائم قبل الترحيل 163 ───── */
const STAMP = '2026-09-25T09:00:00.000Z';
function pre163(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pre163-')), path = join(dir, 'pre163.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of readdirSync(new URL('../app/migrations/', import.meta.url)).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version = Number(file.slice(0, 3)); if (version >= 163) continue;
    const sql = readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
    raw.exec('BEGIN'); raw.exec(sql); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); raw.exec('COMMIT');
  }
  seed(raw, 'synthetic-pre-163');
  // مشروعان بإقفال بقواعد ما قبل 163: الأول أُقفل فنيًا وماليًا (بيدين) ونهائيًا، والثاني ماليًا قبل الفني — وكان مسموحًا يومها.
  raw.exec(`INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('legacy-a','36t','مشروع مقفل قبل الترحيل','مشروع مصطنع مقفل قبل الترحيل 163','manager','${STAMP}'),
    ('legacy-b','36t','مشروع مالي قبل الفني','مشروع مصطنع أُقفل ماليًا قبل الفني','manager','${STAMP}')`);
  raw.exec(`INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at)
    VALUES('legacy-case','36t','creative','employee','ملف قديم مصطنع','LEGACY-1','جهة','اختبار','تجريبي','project_active','legacy-a','${STAMP}','${STAMP}')`);
  raw.exec(`INSERT INTO completion_certificates(id,tenant_id,case_id,project_id,sequence,number,scope_summary,delivery_ids,our_representative,customer_representative,evidence,status,issued_by,issued_at,acknowledged_by,acknowledged_at,acknowledgement_evidence)
    VALUES('legacy-cert','36t','legacy-case','legacy-a',1,'CERT-00001','أُنجز النطاق المصطنع كاملًا قبل الترحيل','[]','مدير الفريق','ممثل العميل','محضر مصطنع محفوظ قبل الترحيل','acknowledged','manager','${STAMP}','outsider','${STAMP}','بريد مصطنع باستلام الشهادة')`);
  raw.exec(`INSERT INTO project_closures(id,tenant_id,project_id,case_id,technical_state,technical_closed_by,technical_closed_at,technical_note,certificate_id,financial_state,financial_closed_by,financial_closed_at,financial_note,final_state,final_closed_by,final_closed_at,profitability_note,lessons,created_at,updated_at)
    VALUES('legacy-closure-a','36t','legacy-a','legacy-case','closed','manager','${STAMP}','إقفال فني قديم مصطنع قبل الترحيل','legacy-cert','closed','outsider','${STAMP}','إقفال مالي قديم مصطنع قبل الترحيل','closed','manager','${STAMP}','ربحية مصطنعة مكتوبة قبل الترحيل','دروس مصطنعة مكتوبة قبل الترحيل','${STAMP}','${STAMP}')`);
  raw.exec(`INSERT INTO project_closures(id,tenant_id,project_id,financial_state,financial_closed_by,financial_closed_at,financial_note,created_at,updated_at)
    VALUES('legacy-closure-b','36t','legacy-b','closed','outsider','${STAMP}','إقفال مالي سبق الفني قبل الترحيل','${STAMP}','${STAMP}')`);
  raw.exec("INSERT INTO project_members VALUES('legacy-a','manager'),('legacy-b','manager')");
  const before = raw.prepare('SELECT * FROM project_closures ORDER BY id').all();
  raw.close();
  return { path, before };
}
test('migration 163: every lock closed before it becomes a carried record, the old rows are untouched, and legacy closures still reopen', t => {
  const { path, before } = pre163(t), db = openDb(path); t.after(() => { try { db.close(); } catch {} });
  assert.deepEqual(db.prepare('SELECT * FROM project_closures ORDER BY id').all(), before, 'صفوف الإقفال كما هي، عمودًا بعمود');
  const carried = db.prepare('SELECT * FROM project_closure_records ORDER BY id').all();
  assert.deepEqual(carried.map(r => [r.id, r.lock, r.origin, r.closed_by]), [
    ['carried-final-legacy-closure-a', 'final', 'carried', 'manager'], ['carried-financial-legacy-closure-a', 'financial', 'carried', 'outsider'],
    ['carried-financial-legacy-closure-b', 'financial', 'carried', 'outsider'], ['carried-technical-legacy-closure-a', 'technical', 'carried', 'manager']]);
  assert.equal(carried.find(r => r.lock === 'technical').certificate_id, 'legacy-cert');
  assert.match(JSON.parse(carried[0].checklist).note, /لم تكن قائمة التحقق تُحفظ/, 'المنقول لا يدّعي ما فُحص يومها');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const legacyA = db.prepare("SELECT * FROM projects WHERE id='legacy-a'").get(), legacyB = db.prepare("SELECT * FROM projects WHERE id='legacy-b'").get();
  assert.equal(axes.closureAxis(db, legacyA).state, 'closed');
  assert.equal(axes.closureAxis(db, legacyB).state, 'closed_financially', 'ماضٍ لا يُعاد كتابته بقاعدة لاحقة');
  // الإقفال القديم يُعاد فتحه بعد الترحيل: الفني ينهي المنقولات الثلاثة، ولا يمس نصها.
  transaction(db, () => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.reopen', department_id: '', note: 'اختبار إعادة فتح إقفال منقول' }));
  const reopened = transaction(db, () => axes.reopenClosure(db, users.manager, 'legacy-a', { version: 1, scope: 'technical', reason: 'مراجعة لاحقة لإقفال قديم منقول قبل الترحيل 163' }));
  assert.deepEqual([reopened.technical_state, reopened.financial_state, reopened.final_state], ['open', 'open', 'open']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_closure_record_ends').get().n, 3);
  assert.deepEqual(db.prepare("SELECT id,note FROM project_closure_records WHERE project_id='legacy-a' ORDER BY id").all().map(r => ({ id: r.id, note: r.note })), carried.filter(r => r.project_id === 'legacy-a').map(r => ({ id: r.id, note: r.note })));
  const checksums = JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()); db.close();
  const again = openDb(path); t.after(() => { try { again.close(); } catch {} });
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()), checksums, 'التشغيل الثاني لا يطبّق شيئًا ولا ينقل مرتين');
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM project_closure_records').get().n, 4);
});
