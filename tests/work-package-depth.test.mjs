import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, capabilitiesFor } from '../app/access.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor } from './proposal-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createTask } from '../app/projects.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as axes from '../app/project-axes.mjs';

// عقد التنفيذ (30 سبتمبر 2026)، الحزمة 2 البند 5 — حزم العمل متعددة الإدارات، حرفيًا:
//   «Store department, phase, accountable owner, contributors, dependencies, dates, deliverables,
//    acceptance criteria, budget reference, status, and evidence.»
//   «Allow valid cross-department staffing without granting broad finance, payroll, supplier, or client access.»
//   «Detect circular dependencies and prevent completion without required evidence.»
// الإدارة والمرحلة والمسؤول والتواريخ والحالة من 116، والمشاركة بقرار رئيس الإدارة من 142؛ وما هنا يثبت الباقي (165).
// كل البيانات اصطناعية.

const code = value => error => error.code === value;

function fixture(t, password = 'synthetic-work-package-depth') {
  const db = openDb(':memory:');
  seed(db, password);
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('pm-wp','36t','creative','pm-wp','مدير مشروع مصطنع','unused-test-hash','pm','manager'),
    ('ops-head','36t','ops','ops-head','رئيس التشغيل المصطنع','unused-test-hash','manager',NULL),
    ('ops-crew','36t','ops','ops-crew','فنّي تشغيل مصطنع','unused-test-hash','employee','ops-head'),
    ('bill-a','36t','ops','bill-a','مسجّلة دفعة مصطنعة','unused-test-hash','employee','ops-head'),
    ('bill-b','36t','ops','bill-b','مؤكدة قبض مصطنعة','unused-test-hash','employee','ops-head')`);
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار عمق حزمة العمل' }));
  for (const who of ['manager', 'bill-a', 'bill-b']) grant(who, 'billing.recurring.manage');
  grant('employee', 'clients.manage');
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, { name: 'عميل حزم مصطنع', registration_number: 'WP-100', contact: 'جهة اتصال مصطنعة', source: 'اختبار محلي', sector: 'قطاع مصطنع' }));
  c = act('manager', act('employee', c, 'qualify', { need: 'مشروع متعدد الإدارات لاختبار الحزم', budget: '100000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'ضمن التجربة' }), 'approve_qualification', { note: 'تأهيل مصطنع معتمد' });
  c = act('manager', act('employee', act('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجان مصطنعان بمعايير قبول', currency: 'SAR', valid_until: '2099-12-01', lines: [
    { description: 'الهوية', quantity: '1', unit_price: '40000.00', unit_cost: '10000.00', discount: '0', tax_rate: '15', acceptance: 'قبول الهوية بدليل', revisions: 1 },
    { description: 'الفيلم', quantity: '1', unit_price: '60000.00', unit_cost: '15000.00', discount: '0', tax_rate: '15', acceptance: 'قبول الفيلم بدليل', revisions: 1 }] })), 'submit_quote'), 'approve_quote', { note: 'راجعت النطاق والمبالغ' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'مرجع اتفاق مصطنع للاختبار المحلي فقط', customer_representative: 'ممثل عميل مصطنع' });
  c = act('manager', c, 'create_project', { member_ids: ['pm-wp'] });
  const projectId = c.project_id;
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(c.client_id);
  // جاهزية البدء: بنود دفع بدفعة مقدمة، وأمر شراء عميل مؤكد، ودفعة مقدمة مقبوضة — فتُفعَّل الحزم.
  const ready = () => {
    tx(() => axes.recordPaymentTerms(db, users.employee, c.id, { terms: [
      { label: 'دفعة مقدمة 30٪', amount: '34500.00', due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' },
      { label: 'الدفعة الثانية', amount: '80500.00', due_on: '2099-06-01', condition: 'عند القبول', condition_kind: 'acceptance', condition_lines: [0] }] }));
    const po = tx(() => axes.recordClientPurchaseOrder(db, users.employee, c.id, { po_number: 'PO-WP-1', issued_on: '2026-09-01', amount: '115000.00',
      customer_representative: 'مدير مشتريات مصطنع لدى العميل', evidence: 'نسخة أمر شراء عميل مصطنع محفوظة في ملف الاتفاق',
      valid_until: '2099-12-31', scope: 'الهوية والفيلم كما في الاتفاق المصطنع', contract_id: c.contract.id, project_id: projectId, client_id: client.id }));
    tx(() => axes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قابلنا الرقم والقيمة بالأصل' }));
    const adv = tx(() => billing.recordAdvance(db, users['bill-a'], { client_id: client.id, schedule_id: '', project_id: projectId,
      description: 'الدفعة المقدمة المصطنعة', agreement_reference: 'بند 3-1 مصطنع', amount: '34500.00' }));
    tx(() => billing.confirmAdvance(db, users['bill-b'], adv.id, { version: 1, amount: '34500.00', received_on: '2026-09-10', evidence: 'إشعار تحويل مصطنع رقم 7001 مطابق', reference: 'TRF-WP-7001' }));
  };
  // مشروعٌ متعدد الإدارات: التشغيل تُشرَك بقرار رئيسها، ثم عضوان منها.
  const withOps = () => {
    const request = tx(() => axes.requestDepartmentParticipation(db, users.manager, projectId, { department_id: 'ops', basis: 'بند الفيلم في الاتفاق من إنتاج إدارة التشغيل' }));
    tx(() => axes.decideDepartmentParticipation(db, users['ops-head'], request.id, 'accept_participation', { version: 1, note: 'راجعت التشغيل النطاق وقبلت المشاركة' }));
    tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'ops-head', basis: 'مسؤول حزمة الفيلم' }));
    tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'ops-crew', basis: 'فنّي التصوير' }));
  };
  const pack = (codeName, department_id, lead_id, extra = {}) => tx(() => axes.createWorkPackage(db, users.manager, projectId, {
    code: codeName, title: `حزمة ${codeName}`, department_id, phase: 'production', objective: `هدف الحزمة ${codeName} ومخرجها المكتوب`, lead_id,
    planned_start: '2026-10-01', planned_end: '2026-12-01', ...extra }));
  const packageRow = pid => db.prepare('SELECT * FROM work_packages WHERE id=?').get(pid);
  approveVendors(db, ['supplier-a']);
  return { db, users, tx, c, projectId, ready, withOps, pack, packageRow };
}

test('الحزمة تحفظ معايير قبولها ومخرجاتها ومرجع مخصصها — والمخصص من المشروع نفسه وحده', t => {
  const { db, users, tx, projectId, pack, packageRow } = fixture(t);
  const scoped = pack('WP-1', 'creative', 'manager', { acceptance_criteria: 'اعتماد العميل للهوية بدليل مكتوب', deliverables: ['دليل الهوية', 'ملفات الشعار'] });
  const row = packageRow(scoped.id);
  assert.equal(row.acceptance_criteria, 'اعتماد العميل للهوية بدليل مكتوب');
  assert.deepEqual(JSON.parse(row.deliverables), ['دليل الهوية', 'ملفات الشعار']);
  // مخصصٌ لمشروعٍ آخر لا يموّل حزمةً هنا — في الكود، وفي القاعدة لو التفّ عليه أحد.
  db.exec("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('other-project','36t','مشروع آخر مصطنع','وصف مصطنع','manager','2026-09-30T00:00:00.000Z')");
  db.prepare("INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,status,created_at,updated_at) VALUES('foreign-budget','36t','other-project','CC-X','SAR',100000,'2026-01-01','2099-01-01','دليل مصطنع','manager','draft',?,?)").run(now(), now());
  assert.throws(() => pack('WP-2', 'creative', 'manager', { budget_id: 'foreign-budget' }), code('budget_id'));
  assert.throws(() => db.prepare('UPDATE work_packages SET budget_id=?,version=version+1 WHERE id=?').run('foreign-budget', scoped.id), /belongs to its own project/);
  // وتعديل النطاق بسببٍ ونسخة، ويُقيَّد في التدقيق.
  const updated = tx(() => axes.setWorkPackageScope(db, users.manager, scoped.id, { version: row.version, deliverables: ['دليل الهوية', 'ملفات الشعار', 'قوالب العروض'], basis: 'أضاف العميل القوالب في محضر الاجتماع الثاني' }));
  assert.deepEqual(updated.deliverables, ['دليل الهوية', 'ملفات الشعار', 'قوالب العروض']);
  assert.throws(() => tx(() => axes.setWorkPackageScope(db, users.manager, scoped.id, { version: row.version, deliverables: ['قديم'], basis: 'نسخة متقادمة' })), code('stale_version'));
  assert.ok(verifyAudit(db));
});

test('التكليف عبر الإدارات لمساهمٍ مسجّل، ولا يمنح تصريحًا واحدًا — لا مالية ولا رواتب ولا موردين ولا عملاء',t => {
  const { db, users, tx, projectId, withOps, pack } = fixture(t);
  withOps();
  const creative = pack('WP-1', 'creative', 'manager');
  const before = [...capabilitiesFor(db, users['ops-crew']).list].sort();
  // قبل التسجيل: مهمة الحزمة الإبداعية لا تُسند إلى فنّي التشغيل.
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'تصوير لقطات الهوية', assignee_id: 'ops-crew', due_date: '2099-05-01', acceptance: 'لقطات الهوية مسلَّمة ومفحوصة' }));
  assert.throws(() => tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version, work_package_id: creative.id })), code('assignee'));
  // غير العضو لا يكون مساهمًا — في الكود، وفي القاعدة.
  assert.throws(() => tx(() => axes.addWorkPackageContributor(db, users.manager, creative.id, { user_id: 'bill-a', contribution: 'محاولة إشراك غير عضو' })), code('user_id'));
  assert.throws(() => db.prepare("INSERT INTO work_package_contributors(id,tenant_id,package_id,user_id,department_id,contribution,added_by,added_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(randomUUID(), '36t', creative.id, 'bill-a', 'ops', 'التفافٌ على الكود', 'manager', now()), /member of the project/);
  const contribution = tx(() => axes.addWorkPackageContributor(db, users.manager, creative.id, { user_id: 'ops-crew', contribution: 'تصوير لقطات الهوية الحركية' }));
  assert.throws(() => tx(() => axes.addWorkPackageContributor(db, users.manager, creative.id, { user_id: 'ops-crew', contribution: 'تكرار' })), code('already_contributor'));
  tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version, work_package_id: creative.id }));
  // الجوهر: التكليف لم يغيّر تصريحًا واحدًا.
  const after = [...capabilitiesFor(db, users['ops-crew']).list].sort();
  assert.deepEqual(after, before, 'المساهمة سجلُّ عمل لا منحة');
  for (const broad of ['finance.approve', 'payroll.run', 'vendors.manage', 'clients.manage', 'employees.view'])
    assert.ok(!after.includes(broad), `لا ${broad} بالمساهمة`);
  // الإغلاق: لا تُغلق مساهمةٌ وعند صاحبها مهمةٌ مفتوحة، والسجل يبقى.
  assert.throws(() => tx(() => axes.removeWorkPackageContributor(db, users.manager, contribution.id, { reason: 'انتهت الحاجة' })), code('contributor_holds_tasks'));
  assert.throws(() => db.prepare('DELETE FROM work_package_contributors WHERE id=?').run(contribution.id), /retained/);
  assert.throws(() => db.prepare("UPDATE work_package_contributors SET contribution='معدّل' WHERE id=?").run(contribution.id), /only closed/);
  assert.ok(verifyAudit(db));
});

test('التبعية بلا حلقة: الحلقة تُرفض باسم مسارها في الكود، وفي القاعدة لو التفّ عليها أحد',t => {
  const { db, users, tx, withOps, pack } = fixture(t);
  withOps();
  const a = pack('WP-A', 'creative', 'manager'), b = pack('WP-B', 'ops', 'ops-head'), cc = pack('WP-C', 'creative', 'manager');
  tx(() => axes.addWorkPackageDependency(db, users.manager, b.id, { depends_on_id: a.id, basis: 'الفيلم يبدأ بعد اعتماد الهوية' }));
  tx(() => axes.addWorkPackageDependency(db, users.manager, cc.id, { depends_on_id: b.id, basis: 'الحملة تنتظر الفيلم' }));
  // A ← B ← C قائمة؛ و«A تعتمد على C» تُغلق حلقة ثلاثية.
  assert.throws(() => tx(() => axes.addWorkPackageDependency(db, users.manager, a.id, { depends_on_id: cc.id, basis: 'حلقة' })),
    error => error.code === 'dependency_cycle' && /WP-A/.test(error.message) && /WP-C/.test(error.message));
  assert.throws(() => db.prepare("INSERT INTO work_package_dependencies(id,tenant_id,package_id,depends_on_id,basis,added_by,added_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), '36t', a.id, cc.id, 'التفافٌ على الكود', 'manager', now()), /cycle/);
  assert.throws(() => tx(() => axes.addWorkPackageDependency(db, users.manager, a.id, { depends_on_id: a.id, basis: 'نفسها' })), code('depends_on_id'));
  assert.throws(() => tx(() => axes.addWorkPackageDependency(db, users.manager, b.id, { depends_on_id: a.id, basis: 'تكرار' })), code('duplicate_dependency'));
  // التبعية تربط إدارتين، فقرارها لمدير المشروع وحده لا لمسؤول إحدى الحزمتين.
  assert.throws(() => tx(() => axes.addWorkPackageDependency(db, users['ops-head'], b.id, { depends_on_id: cc.id, basis: 'من مسؤول حزمة' })), error => error.status === 403);
  assert.ok(verifyAudit(db));
});

test('لا إنجاز بلا دليل: التسليم يسمّي كل ناقص، ولا يسبق ما يعتمد عليه، والقاعدة ترفضه بلا دليل',t => {
  const { db, users, tx, ready, withOps, pack, packageRow, projectId } = fixture(t);
  ready(); withOps();
  const a = pack('WP-A', 'creative', 'manager'), b = pack('WP-B', 'ops', 'ops-head');
  tx(() => axes.addWorkPackageDependency(db, users.manager, b.id, { depends_on_id: a.id, basis: 'الفيلم بعد الهوية' }));
  for (const p of [a, b]) tx(() => axes.workPackageAction(db, users.manager, p.id, 'activate', { version: packageRow(p.id).version, note: 'انطلقت بعد اكتمال شروط البدء' }));
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'تصوير الفيلم', assignee_id: 'ops-crew', due_date: '2099-05-01', acceptance: 'مواد التصوير مسلَّمة' }));
  tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version, work_package_id: b.id }));
  // B: بلا معايير، بلا مخرجات، تنتظر A، فيها مهمة مفتوحة، وبلا دليل — خمسة نواقص بأسمائها.
  assert.throws(() => tx(() => axes.workPackageAction(db, users['ops-head'], b.id, 'deliver', { version: packageRow(b.id).version, note: 'تسليم مبكر', evidence: 'قصير' })),
    error => error.code === 'package_not_deliverable' && error.details.refusal.missing.length === 5 && /WP-A/.test(error.message));
  // وفي القاعدة: الانتقال إلى «مسلَّمة» بلا دليلٍ يُرفض ولو تجاوز أحدٌ الكود.
  assert.throws(() => db.prepare("UPDATE work_packages SET status='delivered',version=version+1 WHERE id=?").run(a.id), /carries its evidence/);
  // A تُسلَّم بنطاقها ودليلها، ثم B بعد إنجاز مهمتها.
  tx(() => axes.setWorkPackageScope(db, users.manager, a.id, { version: packageRow(a.id).version, acceptance_criteria: 'اعتماد الهوية بمحضر العميل', deliverables: ['دليل الهوية'], basis: 'نطاق الهوية كما في الاتفاق' }));
  tx(() => axes.workPackageAction(db, users.manager, a.id, 'deliver', { version: packageRow(a.id).version, note: 'سُلِّمت الهوية', evidence: 'دليل الهوية النهائي في مجلد التسليم بنسخته الثالثة' }));
  assert.throws(() => db.prepare("UPDATE work_packages SET delivery_evidence='غيره' WHERE id=?").run(a.id), /retained/);
  tx(() => axes.setWorkPackageScope(db, users.manager, b.id, { version: packageRow(b.id).version, acceptance_criteria: 'قبول الفيلم بمحضر العميل', deliverables: ['الفيلم النهائي'], basis: 'نطاق الفيلم كما في الاتفاق' }));
  db.prepare("UPDATE tasks SET status='completed',evidence='مواد التصوير مسلَّمة في مجلد المشروع',version=version+1 WHERE id=?").run(task.id);
  const delivered = tx(() => axes.workPackageAction(db, users['ops-head'], b.id, 'deliver', { version: packageRow(b.id).version, note: 'سُلِّم الفيلم', evidence: 'الفيلم النهائي مرفوع بدقته الكاملة ومرفق محضر الفحص' }));
  assert.equal(delivered.status, 'delivered');
  assert.ok(verifyAudit(db));
});

test('العزل: حزمة كيانٍ لا يمسّها حسابُ كيانٍ آخر، ولا تعتمد حزمةٌ على حزمة مشروعٍ آخر',t => {
  const { db, users, tx, withOps, pack } = fixture(t);
  withOps();
  const a = pack('WP-A', 'creative', 'manager');
  const outsider = db.prepare("SELECT * FROM users WHERE tenant_id<>'36t' LIMIT 1").get();
  assert.ok(outsider, 'البذرة فيها كيانٌ ثانٍ');
  assert.throws(() => tx(() => axes.addWorkPackageContributor(db, outsider, a.id, { user_id: 'ops-crew', contribution: 'من كيان آخر' })), error => [403, 404].includes(error.status));
  db.exec("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('p-other','36t','مشروع آخر مصطنع','وصف مصطنع','manager','2026-09-30T00:00:00.000Z')");
  db.prepare("INSERT INTO work_packages(id,tenant_id,project_id,department_id,code,title,phase,objective,lead_id,planned_start,planned_end,status,created_by,created_at,updated_at) VALUES('wp-other','36t','p-other','creative','WP-X','حزمة مشروع آخر','production','هدف مصطنع لحزمة مشروع آخر','manager','2026-10-01','2026-11-01','planned','manager',?,?)").run(now(), now());
  assert.throws(() => tx(() => axes.addWorkPackageDependency(db, users.manager, a.id, { depends_on_id: 'wp-other', basis: 'عبر المشاريع' })), code('depends_on_id'));
  assert.throws(() => db.prepare("INSERT INTO work_package_dependencies(id,tenant_id,package_id,depends_on_id,basis,added_by,added_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), '36t', a.id, 'wp-other', 'التفافٌ عبر المشاريع', 'manager', now()), /within one project/);
});
