import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor } from './proposal-fixture.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createTask, completeTask } from '../app/projects.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as axes from '../app/project-axes.mjs';
import { projectSpineUI } from '../app/static/project-spine-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { createApp } from '../app/server.mjs';
import { PASSWORD, sessionsFor, dispatch } from './definitions-fixture.mjs';

// مسار المشاريع (خطة التغيير، الموجة 5 «سلسلة المشروع»): الخطوة الجاية تمشي السلسلة بترتيبها وتسمّي صاحبها، والأزرار
// تقول ما يقبله الخادم من كل حساب لا أكثر، والشاشة ترسم ما وصلها مهرَّبًا. البيانات كلها اصطناعية.

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, PASSWORD);
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('pm-sp','36t','creative','pm-sp','مديرة مشروع مصطنعة','unused-test-hash','pm','manager'),
    ('ops-head','36t','ops','ops-head','رئيس التشغيل المصطنع','unused-test-hash','manager',NULL),
    ('ops-crew','36t','ops','ops-crew','فنّي تشغيل مصطنع','unused-test-hash','employee','ops-head'),
    ('bill-a','36t','ops','bill-a','مسجّلة دفعة مصطنعة','unused-test-hash','employee','ops-head'),
    ('bill-b','36t','ops','bill-b','مؤكدة قبض مصطنعة','unused-test-hash','employee','ops-head'),
    ('iso-reader','isolated','other','iso-reader','قارئ الكيان المعزول','unused-test-hash','manager',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار مسار المشاريع' }));
  for (const who of ['manager', 'bill-a', 'bill-b']) grant(who, 'billing.recurring.manage');
  grant('employee', 'clients.manage');
  const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(() => dealFor(db, users.employee, { name: 'عميل مسار مصطنع', registration_number: 'SPINE-100', contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
  c = act('manager', act('employee', c, 'qualify', { need: 'مشروع متعدد الإدارات لاختبار المسار', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل مصطنع', service_fit: 'ضمن التجربة' }), 'approve_qualification', { note: 'تأهيل مصطنع مراجع' });
  c = act('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجان مصطنعان بمعياري قبول', currency: 'SAR', valid_until: '2099-12-01', lines: [
    { description: 'هوية مصطنعة', quantity: '1', unit_price: '400.00', unit_cost: '100.00', discount: '0', tax_rate: '15', acceptance: 'قبول الهوية بدليل', revisions: 1 },
    { description: 'فيلم مصطنع', quantity: '1', unit_price: '600.00', unit_cost: '150.00', discount: '0', tax_rate: '15', acceptance: 'قبول الفيلم بدليل', revisions: 1 }] }));
  c = act('manager', act('employee', c, 'submit_quote'), 'approve_quote', { note: 'العرض والنطاق مراجعان' });
  c = act('employee', c, 'register_contract', { agreement_evidence: 'محضر اتفاق مصطنع محفوظ في أرشيف التجربة', customer_representative: 'ممثل العميل المصطنع' });
  c = act('manager', c, 'create_project', { member_ids: ['pm-sp'] });
  const projectId = c.project_id, caseId = c.id;
  // ملف العميل الذي فُتحت منه الصفقة (dealFor): العميل مسجّل قبل الصفقة، لا يُربط بعدها.
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(c.client_id);
  const live = () => db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(caseId);
  // شروط الدفع بدفعة مقدمة وأمر شراء مطلوب: البوابة تمنع التنفيذ المدفوع حتى يكتملا.
  const terms = () => tx(() => axes.recordPaymentTerms(db, users.employee, caseId, { terms: [
    { label: 'دفعة مقدمة 30٪', amount: '345.00', due_on: '2099-01-01', condition: 'عند التوقيع', condition_kind: 'advance' },
    { label: 'الدفعة الثانية', amount: '805.00', due_on: '2099-06-01', condition: 'عند القبول', condition_kind: 'acceptance', condition_lines: [0] }] }));
  const satisfy = () => {
    const contract = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(caseId);
    const po = tx(() => axes.recordClientPurchaseOrder(db, users.employee, caseId, { po_number: 'PO-SPINE-1', issued_on: '2026-09-01', amount: '1150.00',
      customer_representative: 'مدير مشتريات مصطنع', evidence: 'نسخة أمر شراء عميل مصطنع محفوظة في ملف الاتفاق', valid_until: '2099-12-31',
      scope: 'الهوية والفيلم كما في الاتفاق المصطنع', contract_id: contract.id, project_id: projectId, client_id: client.id }));
    tx(() => axes.confirmClientPurchaseOrder(db, users.manager, po.id, { version: 1, note: 'قابلنا الرقم والقيمة بالأصل المصطنع' }));
    const adv = tx(() => billing.recordAdvance(db, users['bill-a'], { client_id: client.id, schedule_id: '', project_id: projectId,
      description: 'الدفعة المقدمة المصطنعة', agreement_reference: 'بند 3-1 مصطنع', amount: '345.00' }));
    tx(() => billing.confirmAdvance(db, users['bill-b'], adv.id, { version: 1, amount: '345.00', received_on: '2026-09-10', evidence: 'إشعار تحويل مصطنع رقم 8801 مطابق', reference: 'TRF-SPINE-8801' }));
  };
  // التشغيل تُشرَك بقرار رئيسها، ثم رئيسها وفنّيها عضوان.
  const withOps = () => {
    const request = tx(() => axes.requestDepartmentParticipation(db, users.manager, projectId, { department_id: 'ops', basis: 'بند الفيلم في الاتفاق من إنتاج إدارة التشغيل' }));
    tx(() => axes.decideDepartmentParticipation(db, users['ops-head'], request.id, 'accept_participation', { version: 1, note: 'راجعت التشغيل النطاق وقبلت المشاركة' }));
    tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'ops-head', basis: 'مسؤول حزمة الفيلم' }));
    tx(() => axes.addProjectMember(db, users.manager, projectId, { user_id: 'ops-crew', basis: 'فنّي التصوير' }));
  };
  const pack = (codeName, department_id, lead_id, extra = {}) => tx(() => axes.createWorkPackage(db, users.manager, projectId, {
    code: codeName, title: `حزمة ${codeName}`, department_id, phase: 'production', objective: `هدف الحزمة ${codeName} ومخرجها المكتوب`, lead_id,
    planned_start: '2026-10-01', planned_end: '2026-12-01', acceptance_criteria: `قبول مخرجات ${codeName} بدليل مكتوب`, deliverables: [`مخرج ${codeName}`], ...extra }));
  const deliver = index => {
    let row = act('employee', live(), 'submit_delivery', { line_index: index, evidence: `تقرير إنجاز المخرج ${index + 1} المصطنع` });
    const pending = row.deliveries.find(d => d.line_index === index && d.review?.status === 'pending');
    act('manager', row, 'accept_delivery', { delivery_id: pending.id, note: 'مطابق لمعيار القبول', acceptance_evidence: 'محضر قبول مصطنع', approver_id: approverFor(db, row.project_id) });
  };
  const board = who => axes.spineBoard(db, users[who]);
  const mine = who => board(who).projects.find(p => p.project.id === projectId);
  return { db, users, tx, projectId, caseId, terms, satisfy, withOps, pack, deliver, board, mine };
}

test('الخطوة الجاية تمشي السلسلة بترتيبها: الجاهزية ثم التنفيذ ثم القبول والحزم ثم الشهادة، وتسمّي صاحب كل خطوة وشاشتها', t => {
  const f = fixture(t), { db, users, tx, projectId, caseId } = f;
  // بلا شروط دفع: الجاهزية غير مطلوبة، فأول ما بقي بدء التنفيذ عند مدير المشروع المسجَّل (منشئه).
  let step = f.mine('manager').next_step;
  assert.equal(step.axis, 'execution');
  assert.equal(step.step, 'بدء التنفيذ: تعبئة الفريق');
  assert.equal(step.owner, users.manager.name);
  assert.equal(step.link, `#project-spine?focus=${projectId}`);
  // بدفعة مقدمة وأمر شراء مطلوب: الجاهزية تسبق التنفيذ، والخطوة بنص البوابة نفسها وصاحبها.
  f.terms();
  step = f.mine('manager').next_step;
  assert.equal(step.axis, 'readiness');
  assert.equal(step.step, 'أمر شراء العميل');
  assert.equal(step.owner, users.employee.name, 'أمر الشراء عند مسؤول الملف');
  assert.equal(step.link, `#commercial?focus=${caseId}`);
  f.satisfy();
  assert.equal(f.mine('manager').next_step.axis, 'execution');
  tx(() => axes.setExecutionState(db, users.manager, projectId, { version: 0, state: 'mobilising', note: 'تعبئة الفريق بعد اكتمال الشروط' }));
  // بعد البدء: قائمة الإقفال الفني بترتيبها — البند غير المقبول أولًا، عند المدير المباشر لمسؤول الحساب.
  step = f.mine('manager').next_step;
  assert.equal(step.axis, 'acceptance');
  assert.equal(step.step, 'بند العقد «هوية مصطنعة»');
  assert.equal(step.owner, 'المدير المباشر لمسؤول الحساب');
  f.deliver(0); f.deliver(1);
  // حزمة مفتوحة تسبق الشهادة، ورابطها المسار نفسه.
  const wp = f.pack('WP-1', 'creative', 'manager');
  step = f.mine('manager').next_step;
  assert.equal(step.axis, 'execution');
  assert.match(step.step, /WP-1/);
  assert.equal(step.link, `#project-spine?focus=${projectId}`);
  tx(() => axes.workPackageAction(db, users.manager, wp.id, 'cancel', { version: 1, note: 'أُلغيت الحزمة المصطنعة لاختبار الترتيب' }));
  step = f.mine('manager').next_step;
  assert.equal(step.axis, 'acceptance');
  assert.equal(step.step, 'شهادة إنجاز سارية قبلها العميل');
  assert.equal(step.owner, users.manager.name);
  // القارئ الثاني يرى الخطوة نفسها: الخطوة صفة المشروع لا القارئ.
  assert.deepEqual(f.mine('pm-sp').next_step, step);
  assert.equal(verifyAudit(db), true);
});

test('الأزرار تقول ما يقبله الخادم: مدير المشروع المسجَّل، ومسؤول الحزمة، والعضو، ومن خارج المشروع والكيان', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.withOps();
  const creative = f.pack('WP-1', 'creative', 'manager'), ops = f.pack('WP-2', 'ops', 'ops-head');
  const packOf = (who, id) => f.mine(who).work_packages.find(p => p.id === id);
  // مدير المشروع المسجَّل: التنفيذ وفتح الحزم، وكل أفعال الحزمة، والتبعيات.
  const pm = f.mine('manager');
  assert.deepEqual(pm.actions, ['set_execution', 'create_work_package']);
  assert.equal(pm.manager_of_record, true);
  assert.deepEqual(packOf('manager', ops.id).actions, ['activate', 'cancel', 'set_scope', 'add_contributor', 'add_dependency']);
  // مسؤول الحزمة: حزمته وحدها، بلا تبعيات ولا تنفيذ.
  const lead = f.mine('ops-head');
  assert.deepEqual(lead.actions, []);
  assert.deepEqual(packOf('ops-head', ops.id).actions, ['activate', 'cancel', 'set_scope', 'add_contributor']);
  assert.deepEqual(packOf('ops-head', creative.id).actions, []);
  assert.deepEqual(lead.budgets, [], 'مراكز التكلفة لمدير المشروع المسجَّل وحده');
  // العضو بلا مسؤولية: يقرأ ولا يرى زرًا.
  assert.deepEqual(f.mine('ops-crew').actions, []);
  assert.ok(f.mine('ops-crew').work_packages.every(p => p.actions.length === 0));
  // من خارج المشروع لا يراه، ومن خارج الكيان كذلك.
  assert.equal(f.mine('outsider'), undefined);
  assert.deepEqual(f.board('iso-reader').projects, []);
  // شروط البدء الناقصة تُخفي التفعيل عن الاثنين، وتبقى الخطوة الجاية تسمّيها.
  f.terms();
  assert.ok(!packOf('manager', ops.id).actions.includes('activate'));
  assert.ok(!packOf('ops-head', ops.id).actions.includes('activate'));
  assert.equal(f.mine('ops-head').next_step.axis, 'readiness');
  f.satisfy();
  // كل زر ظاهر ينجح على الخادم بما يرسله نموذجه: التفعيل من نموذج المسؤول نفسه.
  const data = f.board('ops-head');
  const activate = projectSpineUI.form('activate', ops.id, data);
  assert.equal(activate.endpoint, `/work-packages/${ops.id}/activate`);
  tx(() => axes.workPackageAction(db, users['ops-head'], ops.id, 'activate', activate.toPayload({ note: 'فُعّلت حزمة الفيلم بعد اكتمال الشروط' })));
  // حزمة جارية لها ناقص: التسليم يغيب، والناقص يُعرض بأصحابه — المهمة المفتوحة والحزمة التي تعتمد عليها.
  tx(() => axes.addWorkPackageDependency(db, users.manager, ops.id, { depends_on_id: creative.id, basis: 'الفيلم يبنى على الهوية المعتمدة' }));
  const task = tx(() => createTask(db, users.manager, projectId, { title: 'تصوير المشهد المصطنع', assignee_id: 'ops-crew', due_date: '2099-01-10', acceptance: 'لقطات مسلمة' }));
  tx(() => axes.assignTaskToPackage(db, users.manager, task.id, { version: task.version, work_package_id: ops.id }));
  let row = packOf('ops-head', ops.id);
  assert.ok(!row.actions.includes('deliver'));
  assert.deepEqual(row.delivery_gaps.map(g => g.document), ['تسليم الحزمة WP-1', '1 مهمة مفتوحة في الحزمة']);
  assert.equal(row.delivery_gaps[0].owner, users.manager.name);
  // يُحسم الناقص فيظهر التسليم، وينجح بدليله من النموذج.
  tx(() => completeTask(db, users['ops-crew'], task.id, { version: db.prepare('SELECT version FROM tasks WHERE id=?').get(task.id).version, evidence: 'لقطات المشهد المصطنع مسلمة في المجلد' }));
  const first = packOf('manager', creative.id);
  tx(() => axes.workPackageAction(db, users.manager, creative.id, 'activate', { version: first.version, note: 'بدأت حزمة الهوية المصطنعة' }));
  tx(() => axes.workPackageAction(db, users.manager, creative.id, 'deliver', { version: first.version + 1, note: 'سُلّمت الهوية المصطنعة', evidence: 'دليل الهوية المصطنع مسلّم في ملف المشروع للمراجعة' }));
  row = packOf('ops-head', ops.id);
  assert.deepEqual(row.delivery_gaps, []);
  assert.ok(row.actions.includes('deliver'));
  const deliver = projectSpineUI.form('deliver', ops.id, f.board('ops-head'));
  assert.deepEqual(deliver.fields.map(x => x.name), ['note', 'evidence']);
  tx(() => axes.workPackageAction(db, users['ops-head'], ops.id, 'deliver', deliver.toPayload({ note: 'سُلّم الفيلم المصطنع', evidence: 'الفيلم المصطنع مسلّم في مجلد المشروع بنسخته النهائية' })));
  assert.equal(packOf('manager', ops.id).status, 'delivered');
  assert.deepEqual(packOf('manager', ops.id).actions, [], 'الحزمة المسلَّمة لا زر عليها');
  assert.equal(verifyAudit(db), true);
});

test('الشاشة ترسم ما وصلها مهرَّبًا، ونماذجها تذهب لمسارات الخادم بنسخها، وتعديل النطاق لا يفك مركز تكلفة لم يُعرض', t => {
  const f = fixture(t), { db, users, tx, projectId } = f;
  f.withOps();
  const budget = 'budget-spine-1';
  db.prepare("INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(budget, '36t', projectId, 'SPINE-CC-1', 'SAR', 50000, '2026-01-01', '2099-12-31', 'مخصص مصطنع للاختبار', 'manager', 'draft', new Date().toISOString(), new Date().toISOString());
  const ops = f.pack('WP-2', 'ops', 'ops-head', { title: 'حزمة <img src=x onerror=alert(1)> الفيلم', budget_id: budget });
  const e = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const button = (action, id, label) => `<button data-action="operation" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  const helpers = { e, button, ui: kit(e) };
  const html = projectSpineUI.render(f.board('manager'), helpers);
  assert.ok(html.includes('الخطوة الجاية: بدء التنفيذ: تعبئة الفريق'));
  for (const axis of axes.AXES) assert.ok(html.includes(`<dt>${axis.name}</dt>`), `المرحلة ${axis.name} في الشريط`);
  assert.ok(html.includes('<bdi>WP-2</bdi>'), 'رمز الحزمة معزول الاتجاه');
  assert.ok(html.includes('&lt;img') && !html.includes('<img src=x'), 'اسم الحزمة يُهرَّب');
  assert.ok(!/<button[^>]*><\/button>/.test(html), 'لا زر بلا عنوان');
  assert.ok(html.includes(`data-focus-id="${projectId}"`), 'الرابط ‎#project-spine?focus=‎ يقف على المشروع');
  // نماذج مدير المشروع: التنفيذ بنسخة محوره، والحزمة الجديدة بمخرجات سطرًا سطرًا ومركز تكلفة اختياري.
  const pmData = f.board('manager');
  const execution = projectSpineUI.form('set_execution', projectId, pmData);
  assert.equal(execution.endpoint, `/projects/${projectId}/execution`);
  assert.deepEqual(execution.toPayload({ state: 'mobilising', note: 'تعبئة' }), { version: 0, state: 'mobilising', note: 'تعبئة' });
  const create = projectSpineUI.form('create_work_package', projectId, pmData);
  assert.equal(create.endpoint, `/projects/${projectId}/work-packages`);
  assert.equal(create.idempotent, true);
  assert.deepEqual(create.toPayload({ code: 'WP-3', deliverables: 'مخرج أول\n\n مخرج ثاني ', budget_id: '' }).deliverables, ['مخرج أول', 'مخرج ثاني']);
  assert.equal(create.toPayload({ budget_id: '' }).budget_id, undefined, 'بلا ربط لا يُرسل معرّفًا فارغًا');
  // مدير المشروع يرى مركز التكلفة القائم في نموذج النطاق، والمسؤول لا يراه فيبقى الربط كما هو.
  const pmScope = projectSpineUI.form('set_scope', ops.id, pmData);
  assert.equal(pmScope.fields.find(x => x.name === 'budget_id').value, budget);
  const leadScope = projectSpineUI.form('set_scope', ops.id, f.board('ops-head'));
  assert.equal(leadScope.fields.some(x => x.name === 'budget_id'), false);
  const payload = leadScope.toPayload({ acceptance_criteria: 'قبول الفيلم المصطنع بنسخته النهائية', deliverables: 'الفيلم\nالنسخة القصيرة', basis: 'أُضيفت النسخة القصيرة بطلب العميل' });
  assert.equal('budget_id' in payload, false);
  tx(() => axes.setWorkPackageScope(db, users['ops-head'], ops.id, payload));
  assert.equal(db.prepare('SELECT budget_id FROM work_packages WHERE id=?').get(ops.id).budget_id, budget, 'تعديل المسؤول أبقى مركز التكلفة');
  // زر ما عاد متاحًا: النموذج يقول ذلك بدل أن يرسل طلبًا يرتدّ.
  assert.throws(() => projectSpineUI.form('set_execution', projectId, f.board('ops-head')), /ما عاد متاح/);
  assert.equal(verifyAudit(db), true);
});

test('HTTP: ‎/api/project-spine‎ يقرؤه عضو المشروع، ومن خارج المشروع يقرأ لوحةً بلا مشاريعه، وبلا جلسة لا شيء', async t => {
  const f = fixture(t), { db, projectId } = f;
  const app = createApp(db), { call } = await sessionsFor(app, ['manager', 'outsider']);
  const board = (await call('manager', '/project-spine', undefined, 200)).json();
  assert.ok(board.projects.some(p => p.project.id === projectId));
  assert.equal(board.projects.find(p => p.project.id === projectId).next_step.axis, 'execution');
  assert.equal((await call('outsider', '/project-spine', undefined, 200)).json().projects.some(p => p.project.id === projectId), false);
  assert.equal((await dispatch(app, { path: '/api/project-spine' })).status, 401, 'بلا جلسة لا لوحة');
});
