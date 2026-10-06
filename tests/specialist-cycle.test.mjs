// P4 DOMAIN-5 — دورة المجالات المتخصصة كاملة لعميل تجريبي واحد: SYN-8001.
// من موجز الحملة إلى خطة الصرف، ثم الصرف، ثم عمل الاستوديو وجولات المراجعة، ثم الإنتاج ومعداته، ثم تسليم المؤثرين
// والعلاقات العامة، ثم تقرير العميل. كل خطوة تمرّ بدوال الوحدات نفسها على الحالة التي تركتها الخطوة قبلها، وتثبت التسليم:
// المرحلة تقرأ ما كتبته سابقتها ولا يُعاد إدخاله، وأرقام تقرير العميل تساوي سجلاتها. لا صفّ يُكتب باليد.
//
// كل تسليم غائب اختبارٌ متخطّى بسبب مكتوب يسمّي من يملكه، فلا يُقرأ غيابه نجاحًا (السنّة نفسها في tests/crm-cycle.test.mjs).
// جسم كل اختبار متخطّى هو التسليم المنتظر نفسه، فمن يفكّ التخطّي بعد الدمج يشغّل ما كُتب لا ما سيُكتب:
//   DOMAIN-2  الصرف الإعلامي مصدرًا واحدًا (الترحيل 192، الفرع p4/domain-media-reports): الحملة تقرأ الصرف الذي سُجّل هنا
//   DOMAIN-4  قسما تقرير العميل لتسليم المؤثرين وللتغطية الإعلامية (الفرع نفسه)
// وثلاثة تسليمات كانت غائبة فُكّ تخطّيها على الفرع p4/specialist-handoffs، وتمرّ بدوال الوحدات نفسها:
//   P4-SPEC-1 (4a، الترحيل 187) الاستوديو يُفتح للحملة: يحمل الحملة وعميلها، وموجزه يقرأ هدفها وقنواتها ومستهدفها
//   P4-SPEC-2 (6a، الترحيل 188) الإنتاج يقرأ نسخة المخرج ومسار مراجعتها، ولا يبدأ قبل موافقته ومخصص المشروع (5d)
//   P4-SPEC-3 (5c، الترحيل 189) البند المنشور يحمل النسخة التي وافق عليها المسار وبصمتها، وتقرير العميل يسمّيهما
// الترقيم P4-SPEC اقتراح يعيد القائد تسميته عند الدمج إن شاء. البيانات كلها مصطنعة وموسومة «تجريبي».
//
// الأدوار (حسابات البذرة نفسها، بلا حساب يُضاف باليد):
//   manager   مسؤول حساب العميل وصاحب ملفه، ومنشئ المشروع ومراجع الاستوديو، ويعتمد ما يعدّه غيره
//   employee  عضو فريق الحساب: صاحبة الحملة والخطة والصرف، ومعدّة الاستوديو، والمنتجة، ومنسقة المؤثرين والعلاقات العامة
//   outsider  عضو في المشروع: يفتح مسار المراجعة ويوثّق قرار العميل، ويعتمد مخصص المشروع تحت تفويض مالي مؤرخ (5d)
//   hr        أمينة المخزن: تحجز المعدات وتستلم الإعادة، وحاملة «منح التفويض المالي» تمنح تفويض المخصص لغيرها (5d)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createProject } from '../app/projects.mjs';
import * as campaigns from '../app/campaigns.mjs';
import * as media from '../app/media-spend.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import * as review from '../app/review-rounds.mjs';
import { registerApprover, recordApproval } from '../app/client-approvals.mjs';
import * as production from '../app/production.mjs';
import * as equipment from '../app/equipment.mjs';
import * as influencers from '../app/influencers.mjs';
import * as pr from '../app/pr.mjs';
import * as reports from '../app/client-reports.mjs';
import { grantFinanceAction } from '../app/finance-grants.mjs';
import { grantProjectFinanceAccess, createBudget, budgetAction } from '../app/budgets.mjs';

const riyadh = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const caught = fn => { try { fn(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };
let db, users, s = {};
const tx = run => transaction(db, run);
before(() => {
  db = openDb(':memory:'); seed(db, 'synthetic-specialist-cycle');
  users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  tx(() => {
    for (const [user, capability, department] of [
      ['employee', 'commercial.use', 'creative'], ['manager', 'commercial.use', 'creative'],
      ['employee', 'influencers.manage', ''], ['manager', 'influencers.manage', ''],
      ['employee', 'pr.manage', ''], ['manager', 'pr.manage', ''],
      ['employee', 'production.manage', ''], ['manager', 'production.manage', ''],
      ['hr', 'equipment.manage', ''], ['outsider', 'review.manage', ''], ['manager', 'review.manage', ''], ['outsider', 'approvals.record', '']])
      grantAccess(db, users.admin, { user_id: user, capability, department_id: department, note: 'منح تجريبي لدورة المجالات المتخصصة SYN-8001' });
  });
  users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
});
after(() => db?.close());

const campaignView = (who = 'employee') => campaigns.campaignsBoard(db, users[who]).campaigns.find(c => c.id === s.campaign);
const spendView = (who = 'employee') => media.mediaSpendBoard(db, users[who]).campaigns.find(c => c.id === s.campaign);
const workspace = () => db.prepare('SELECT version FROM studio_workspaces WHERE id=?').get(s.studio).version;
const studio = (who, action, input = {}) => tx(() => studioAction(db, users[who], s.studio, action, { version: workspace(), ...input }));
const route = (who = 'outsider') => review.getRoute(db, users[who], s.route);

test('SYN-8001 step 1 — campaign brief: the client’s campaign carries its objective, channels, target and client-approved budget, and is launched by someone other than its owner', () => {
  s.client = tx(() => createClient(db, users.manager, { legal_name: 'شركة الواحة التجريبية للأغذية', trade_name: 'الواحة التجريبية', sector: 'أغذية', status: 'active' })).id;
  tx(() => clientAction(db, users.manager, s.client, 'add_member', { user_id: 'employee', role: 'منسقة الحساب التجريبية' }));
  s.campaign = tx(() => campaigns.createCampaign(db, users.employee, { client_id: s.client, name: 'حملة إطلاق تجريبية SYN-8001',
    objective: 'تعريف الجمهور بالمنتج التجريبي الجديد خلال عشرين يومًا', channels: ['instagram', 'google_ads'],
    targets: [{ metric: 'نقرات', target: 20000, unit: 'نقرة' }], media_budget: '10000.00', budget_reference: 'بريد اعتماد العميل التجريبي SYN-8001',
    start_date: riyadh(), end_date: riyadh(20) })).id;
  const act = (who, action, input = {}) => tx(() => campaigns.campaignAction(db, users[who], s.campaign, action, { version: campaignView(who).version, ...input }));
  for (const item of campaignView().checklist) act('employee', 'check', { key: item.key, evidence: 'دليل تجريبي لاكتمال البند' });
  act('employee', 'request_launch');
  assert.equal(caught(() => act('employee', 'approve_launch', { note: 'أعتمد إطلاق حملتي بنفسي' })).code, 'invalid_state');
  act('manager', 'approve_launch', { note: 'راجعت الجاهزية والميزانية المعتمدة من العميل' });
  assert.equal(campaignView().status, 'live');
});

test('SYN-8001 step 2 — media plan: the plan is measured against the campaign it was prepared on — its channels, its period and its client-approved budget — and is approved by someone else', () => {
  const line = (channel, planned, value) => ({ channel, start_date: riyadh(), end_date: riyadh(20), planned, target_metric: 'نقرات', target_value: value, target_unit: 'نقرة' });
  // التسليم: الخطة لا تحمل ميزانية ولا قنوات خاصة بها؛ تقرأها من الحملة وتُرفض خارجها.
  assert.equal(caught(() => tx(() => media.prepareMediaPlan(db, users.employee, { campaign_id: s.campaign, budget_reference: 'توزيع خارج قنوات الحملة', lines: [line('tiktok', '1000.00', 100)] }))).code, 'channel');
  assert.equal(caught(() => tx(() => media.prepareMediaPlan(db, users.employee, { campaign_id: s.campaign, budget_reference: 'توزيع يتجاوز الميزانية',
    lines: [line('instagram', '6000.00', 12000), line('google_ads', '5000.00', 8000)] }))).code, 'plan_exceeds_budget');
  s.plan = tx(() => media.prepareMediaPlan(db, users.employee, { campaign_id: s.campaign, budget_reference: 'توزيع معتمد في محضر تجريبي SYN-8001',
    lines: [line('instagram', '6000.00', 12000), line('google_ads', '4000.00', 8000)] })).id;
  assert.equal(caught(() => tx(() => media.mediaPlanAction(db, users.employee, s.plan, 'approve_plan', { version: 1, note: 'أعتمد خطتي بنفسي' }))).code, 'self_approval');
  tx(() => media.mediaPlanAction(db, users.manager, s.plan, 'approve_plan', { version: spendView('manager').draft.version, note: 'راجعت التوزيع مقابل ميزانية العميل المعتمدة' }));
  const plan = { ...db.prepare('SELECT client_id,campaign_id,status FROM media_plans WHERE id=?').get(s.plan) };
  assert.deepEqual(plan, { client_id: s.client, campaign_id: s.campaign, status: 'approved' }, 'the client is read from the campaign, never passed in');
  assert.equal(spendView().pacing.planned_minor, 1000000);
});

test('SYN-8001 step 3 — spend: recorded once against the approved plan line of its channel, with its source, and corrected by a new entry — never typed against a plan by hand', () => {
  const spend = input => tx(() => media.recordMediaSpend(db, users.employee, s.campaign, { spend_date: riyadh(), evidence_kind: 'platform_screenshot',
    evidence_reference: 'لقطة لوحة الإعلانات التجريبية SYN-8001', funding: 'client_direct', ...input }));
  assert.equal(caught(() => spend({ channel: 'tiktok', amount: '100.00' })).code, 'channel', 'a channel outside the approved plan has no line to land on');
  const first = spend({ channel: 'instagram', amount: '1000.00' }).id;
  s.spend = tx(() => media.correctMediaSpend(db, users.employee, first, { amount: '1200.00', evidence_kind: 'account_statement', evidence_reference: 'كشف حساب المنصة التجريبي SYN-8001', reason: 'اللقطة التُقطت قبل اكتمال اليوم' })).id;
  spend({ channel: 'google_ads', amount: '300.00' });
  const entry = { ...db.prepare('SELECT e.plan_id,l.channel FROM media_spend_entries e JOIN media_plan_lines l ON l.id=e.line_id WHERE e.id=?').get(s.spend) };
  assert.deepEqual(entry, { plan_id: s.plan, channel: 'instagram' }, 'the entry lands on the approved plan line of its channel');
  const pacing = spendView().pacing;
  assert.equal(pacing.lines.find(l => l.channel === 'instagram').actual_minor, 120000, 'the corrected entry replaces the first, it does not add to it');
  assert.equal(pacing.actual_minor, 150000);
});

test('SYN-8001 step 3b — the campaign reads the spend recorded in media spend, so both screens show one figure', () => {
  assert.equal(campaignView().spent_minor, spendView().pacing.actual_minor);
});

test('SYN-8001 step 4 — studio: the brief is approved by an independent reviewer, the asset’s rights are inspected by someone else, and the output version passes the five quality checks', () => {
  s.project = tx(() => createProject(db, users.manager, { name: 'مشروع إطلاق تجريبي SYN-8001', brief: 'حساب الواحة التجريبية', member_ids: ['employee', 'outsider'] })).id;
  // العمل يُفتح للحملة: الهدف والقنوات والمستهدفات تُقرأ من سجلها (الخطوة 4a)، ويكتب معدّ العمل ما لا تحمله الحملة.
  s.studio = tx(() => createStudio(db, users.employee, { project_id: s.project, campaign_id: s.campaign, title: 'مساحة منشور الإطلاق SYN-8001',
    audience: 'جمهور مصطنع مهتم بالأغذية', audience_basis: 'افتراض محلي معلن؛ لم يجر بحث ميداني',
    message: 'منتج تجريبي طازج كل يوم', prohibited_messages: 'لا ادعاءات صحية', measurement_source: 'لوحة المنصة الإعلانية التجريبية',
    scope: 'منشور واحد بنسخته العربية' })).id;
  studio('employee', 'submit_brief');
  studio('manager', 'approve_brief', { note: 'الهدف والرسالة والقناة مراجعة' });
  let w = studio('employee', 'add_asset', { name: 'صورة المنتج التجريبية', internal_reference: 'ASSET_SYN_8001', rights_holder: 'الواحة التجريبية',
    rights_basis: 'licensed', rights_evidence: 'ترخيص استخدام تجريبي محفوظ في ملف العميل', valid_from: riyadh(), valid_until: riyadh(365), channels: ['instagram'] });
  s.asset = w.assets[0].id;
  assert.equal(caught(() => studio('employee', 'inspect_asset', { asset_id: s.asset, outcome: 'passed', evidence: 'أفحص أصلي بنفسي' })).code, 'studio_transition');
  studio('manager', 'inspect_asset', { asset_id: s.asset, outcome: 'passed', evidence: 'طابقت الترخيص والقناة والمدة' });
  w = studio('employee', 'create_output', { title: 'منشور الإطلاق التجريبي', channel: 'instagram', format: 'صورة ونص', dimensions: 'مربع 1080×1080',
    language: 'العربية', brand_reference: 'WAHA-DEMO', acceptance: 'مطابقة الرسالة والهوية', content: 'منتج تجريبي طازج كل يوم.', asset_ids: [s.asset] });
  s.output = w.outputs[0].id; s.version = w.outputs[0].current_version_id;
  studio('employee', 'submit_output', { output_id: s.output });
  w = studio('manager', 'approve_output', { output_id: s.output, note: 'اجتازت الفحوص الخمسة',
    quality_checks: { brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' } });
  assert.equal(w.outputs[0].status, 'approved');
  assert.equal(w.outputs[0].current_version.brief_id, w.current_brief_id, 'the output version is tied to the approved brief version');
});

test('SYN-8001 step 4a — the studio brief reads the campaign brief it serves instead of typing it again', () => {
  const row = db.prepare('SELECT * FROM studio_workspaces WHERE id=?').get(s.studio);
  assert.equal(row.campaign_id, s.campaign);
  // التسليم (الترحيل 187): العميل من الحملة لا يُمرَّر، والموجز يقرأ هدفها وقنواتها — «إعلانات قوقل» منها — ومستهدفها.
  assert.equal(row.client_id, s.client, 'the client is read from the campaign, never passed in');
  const brief = JSON.parse(db.prepare('SELECT snapshot FROM studio_brief_versions WHERE id=?').get(row.current_brief_id).snapshot);
  const campaign = campaignView();
  assert.deepEqual({ objective: brief.objective, channels: brief.channels }, { objective: campaign.objective, channels: [...campaign.channels].sort() });
  assert.equal(brief.kpi, campaign.targets.map(t => `${t.metric}: ${t.target} ${t.unit}`).join('؛ '));
  assert.equal(db.prepare('SELECT brief_id FROM studio_output_versions WHERE id=?').get(s.version).brief_id, row.current_brief_id, 'the approved version stands on the brief read from the campaign');
  const retyped = caught(() => tx(() => createStudio(db, users.employee, { project_id: s.project, campaign_id: s.campaign, title: 'مساحة بموجز معاد كتابته',
    objective: 'هدف يُكتب مرة ثانية بدل أن يُقرأ', audience: 'جمهور مصطنع', audience_basis: 'افتراض معلن', message: 'رسالة تجريبية', prohibited_messages: 'لا شيء',
    measurement_source: 'لوحة تجريبية', scope: 'منشور واحد' })));
  assert.equal(retyped.code, 'derived_field', 'retyping the campaign’s objective is refused by name, not ignored');
});

test('SYN-8001 step 5 — review rounds: the route stands on that exact output version, and the client stage closes on the approval documented against the same version', () => {
  s.route = tx(() => review.createRoute(db, users.outsider, { output_version_id: s.version, name: 'مراجعة منشور الإطلاق SYN-8001', owner_id: 'employee', template_id: '',
    stages: [{ position: 1, name: 'مراجعة إبداعية', audience: 'internal', reviewer_ids: ['manager'], due_days: 3, reminder_days: 1, escalation_days: '' },
      { position: 2, name: 'قرار العميل', audience: 'client', reviewer_ids: ['manager'], due_days: '', reminder_days: '', escalation_days: '' }] })).id;
  const version = db.prepare('SELECT revision,digest FROM studio_output_versions WHERE id=?').get(s.version);
  // التسليم: المسار يقرأ النسخة وبصمتها ورقمها من الاستوديو، ولا يُكتب منها شيء باليد.
  assert.deepEqual({ revision: route().output_revision, digest: route().output_digest, output: route().output_id }, { revision: version.revision, digest: version.digest, output: s.output });
  const decide = (stage, decision, extra = {}) => tx(() => review.reviewAction(db, users.manager, s.route, 'decide', { version: route('manager').version,
    stage_id: route('manager').stages.find(x => x.name === stage).id, decision, note: 'قرار تجريبي على النسخة', ...extra }));
  decide('مراجعة إبداعية', 'approved');
  assert.equal(caught(() => decide('قرار العميل', 'approved')).code, 'client_evidence_required');
  const approver = tx(() => registerApprover(db, users.outsider, { project_id: s.project, name: 'مفوضة العميل التجريبية', title: 'مديرة التسويق',
    authority_basis: 'خطاب تفويض تجريبي من العميل محفوظ في ملفه', authority_scope: 'اعتماد مواد الحملة الرقمية', valid_from: riyadh() })).id;
  s.approval = tx(() => recordApproval(db, users.outsider, { output_version_id: s.version, approver_id: approver, decision: 'approved',
    scope_note: 'موافقة على المنشور كما هو بالنسخة المعروضة', channel: 'email', received_on: riyadh(), evidence_reference: 'بريد موافقة تجريبي SYN-8001 محفوظ في ملف العميل' })).id;
  const record = { ...db.prepare('SELECT output_revision,output_digest,project_id FROM external_approvals WHERE id=?').get(s.approval) };
  assert.deepEqual(record, { output_revision: version.revision, output_digest: version.digest, project_id: s.project }, 'the approval reads the version it documents');
  decide('قرار العميل', 'approved', { external_approval_id: s.approval });
  assert.equal(route().status, 'approved');
  assert.equal(db.prepare("SELECT external_approval_id FROM review_decisions WHERE route_id=? AND external_approval_id IS NOT NULL").get(s.route).external_approval_id, s.approval);
});

test('SYN-8001 step 5b — content calendar: the approved post is published on the campaign by its owner, after an internal pass by someone else and the client\u2019s documented approval', () => {
  const content = tx(() => campaigns.createContent(db, users.employee, { client_id: s.client, campaign_id: s.campaign, brand_id: '', channel: 'instagram', format: 'post',
    title: 'منشور الإطلاق المنشور SYN-8001', brief: 'المنشور المعتمد في مسار المراجعة', planned_date: riyadh(), planned_time: '', retainer_id: '', deliverable_type: '' })).id;
  const itemOf = (who = 'employee') => campaigns.contentBoard(db, users[who]).items.find(i => i.id === content);
  const cAct = (who, action, input = {}) => tx(() => campaigns.contentAction(db, users[who], content, action, { version: itemOf(who).version, ...input }));
  // البند يُقدَّم على النسخة التي اعتمدها الاستوديو ووافق عليها مسار الخطوة 5 (الخطوة 5c)، لا على مرجع مكتوب.
  cAct('employee', 'start'); cAct('employee', 'submit', { output_version_id: s.version });
  assert.equal(caught(() => cAct('employee', 'pass', { note: 'أجيز بندي بنفسي' })).code, 'invalid_state');
  cAct('manager', 'pass', { note: 'مطابق للنسخة المعتمدة في مسار المراجعة' });
  // وموافقة العميل تُقرأ من السجل الموثّق على النسخة نفسها في الخطوة 5، فلا يُكتب مرجعها مرة ثانية.
  cAct('employee', 'client_approve', { external_approval_id: s.approval });
  cAct('employee', 'publish', { published_reference: 'https://example.invalid/syn-8001/brand-post', overage_note: '' });
  assert.deepEqual([itemOf().status, itemOf().campaign_id], ['published', s.campaign]);
  s.content = content;
});

test('SYN-8001 step 5c — the post published for the campaign is the output version the review approved', () => {
  const item = db.prepare('SELECT * FROM content_items WHERE id=?').get(s.content);
  assert.equal(item.output_version_id, s.version);
  // التسليم (الترحيل 189): البصمة بصمة النسخة نفسها مقروءة من الاستوديو، والمسار الذي وافق عليها مسار الخطوة 5، والموافقة سجلها.
  const version = db.prepare('SELECT digest FROM studio_output_versions WHERE id=?').get(s.version);
  assert.deepEqual({ digest: item.output_digest, approval: item.client_approval_id, draft: item.draft_reference }, { digest: version.digest, approval: s.approval, draft: '' }, 'nothing about the version is typed');
  assert.equal(db.prepare('SELECT status FROM review_routes WHERE output_version_id=?').get(s.version).status, 'approved');
  assert.match(item.client_approval_reference, /مفوضة العميل التجريبية/, 'the client approval is read from the register, not retyped');
});

test('SYN-8001 step 5d — the shoot’s budget is the project allocation, prepared by one person and approved by another under a dated finance authority', () => {
  // التفويض المالي يمنحه حامل «منح التفويض المالي» لغيره بتاريخ انتهاء، ونطاق المشروع يمنحه منشئه؛ لا صفّ يُكتب باليد.
  tx(() => grantAccess(db, users.admin, { user_id: 'hr', capability: 'finance.grants.manage', department_id: '', note: 'منح تجريبي لتفويض مالية دورة SYN-8001' }));
  for (const [who, action] of [['employee', 'read'], ['employee', 'prepare'], ['outsider', 'read'], ['outsider', 'approve']])
    tx(() => grantFinanceAction(db, users.hr, { user_id: who, action, valid_from: riyadh(), valid_until: riyadh(30), evidence: 'تفويض تجريبي موثق في محضر دورة SYN-8001' }));
  const ends = new Date(Date.now() + 20 * 86400000).toISOString();
  for (const who of ['employee', 'outsider']) tx(() => grantProjectFinanceAccess(db, users.manager, s.project, { user_id: who, ends_at: ends, reason: 'نطاق مالي تجريبي لمشروع SYN-8001' }));
  let budget = tx(() => createBudget(db, users.employee, { project_id: s.project, cost_center: 'SYN-8001-PRD', currency: 'SAR', cap_amount: '20000.00',
    valid_from: riyadh(), valid_until: riyadh(30), evidence: 'مخصص تصوير منشور الإطلاق التجريبي SYN-8001' }));
  budget = tx(() => budgetAction(db, users.employee, budget.id, 'submit', { version: budget.version, note: 'تقديم المخصص للمراجعة' }));
  assert.equal(caught(() => tx(() => budgetAction(db, users.employee, budget.id, 'approve', { version: budget.version, note: 'أعتمد مخصصي بنفسي' }))).code, 'transition_denied');
  budget = tx(() => budgetAction(db, users.outsider, budget.id, 'approve', { version: budget.version, note: 'راجعت المخصص مقابل خطة التصوير' }));
  assert.deepEqual([budget.status, budget.prepared_by, budget.approved_by], ['active', 'employee', 'outsider']);
});

test('SYN-8001 step 6 — production with equipment: the production is opened on the campaign and its client, the booking on the production inherits its project, and the production does not close while the gear is out', () => {
  s.production = tx(() => production.createProduction(db, users.employee, { code: 'PRD-SYN-8001', title: 'تصوير منشور الإطلاق التجريبي', kind: 'social',
    brief: 'تصوير صورة المنتج للمنشور المعتمد', client_id: s.client, campaign_id: s.campaign, project_id: s.project, review_route_id: s.route, shoot_from: riyadh(1), shoot_to: riyadh(2) })).id;
  const of = (who = 'employee') => production.productionsBoard(db, users[who]).productions.find(p => p.id === s.production);
  assert.deepEqual([of().client_name, of().campaign_name, of().project_name], ['الواحة التجريبية', 'حملة إطلاق تجريبية SYN-8001', 'مشروع إطلاق تجريبي SYN-8001']);
  const camera = tx(() => equipment.createItem(db, users.hr, { name: 'كاميرا تجريبية SYN-8001', category: 'camera', serial_no: 'SYN-CAM-8001', condition_state: 'good',
    condition_note: '', home_location: 'مخزن تصوير تجريبي', asset_id: '' })).id;
  s.booking = tx(() => equipment.createBooking(db, users.hr, { item_id: camera, kit_id: '', project_id: '', production_id: s.production, production_ref: '',
    purpose: 'تصوير منشور الإطلاق التجريبي', start_date: riyadh(), end_date: riyadh(2), custodian_id: 'employee' })).id;
  const booking = () => equipment.equipmentBoard(db, users.hr).bookings.find(b => b.id === s.booking);
  // التسليم: الحجز يقرأ مشروعه من الإنتاج، والإنتاج يرى معداته من الحجز؛ لا يُكتب المشروع ولا الإنتاج مرتين.
  assert.equal(db.prepare('SELECT project_id FROM equipment_bookings WHERE id=?').get(s.booking).project_id, s.project);
  assert.equal(booking().production_code, 'PRD-SYN-8001');
  const move = (who, action, input = {}) => tx(() => production.productionAction(db, users[who], s.production, action, { version: of(who).version, ...input }));
  tx(() => equipment.bookingAction(db, users.employee, s.booking, 'hand_out', { version: booking().version, counterpart_id: 'hr', condition_state: 'good',
    condition_note: 'الكاميرا سليمة بعدستها وبطاريتها', acknowledgement: 'استلمت الكاميرا التجريبية بعهدتي' }));
  assert.deepEqual(of().equipment.map(x => [x.item_code, x.status]), [[booking().item_code, 'out']]);
  move('employee', 'start'); move('employee', 'wrap', { wrap_note: 'انتهى التصوير وسُلّمت الصورة الخام للاستوديو' });
  const refused = caught(() => move('manager', 'close', { note: 'المخرجات سُلّمت والتصاريح موثقة' }));
  assert.equal(refused.code, 'equipment_still_out');
  tx(() => equipment.bookingAction(db, users.hr, s.booking, 'hand_in', { version: booking().version, counterpart_id: 'employee', condition_state: 'good',
    condition_note: 'رجعت الكاميرا سليمة كما خرجت', acknowledgement: 'استلمت الكاميرا التجريبية في المخزن' }));
  move('manager', 'close', { note: 'المخرجات سُلّمت والمعدات رجعت المخزن' });
  assert.equal(of().status, 'closed');
});

test('SYN-8001 step 6a — the production starts only on the approved review of what it shoots', () => {
  const row = db.prepare('SELECT * FROM productions WHERE id=?').get(s.production);
  assert.equal(row.review_route_id, s.route);
  // التسليم (الترحيل 188): الإنتاج يقرأ النسخة التي وافق عليها مسار الخطوة 5 وبصمتها، والبدء قام عليها وعلى مخصص الخطوة 5d.
  assert.equal(row.output_version_id, s.version, 'the version is read from the route, never typed');
  const treatment = production.productionsBoard(db, users.employee).productions.find(p => p.id === s.production).treatment;
  assert.deepEqual([treatment.status, treatment.digest], ['approved', db.prepare('SELECT digest FROM studio_output_versions WHERE id=?').get(s.version).digest]);
  const started = JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_type='production' AND entity_id=? AND action='production.start'").get(s.production).after_json);
  assert.deepEqual([started.review_route_id, started.output_version_id], [s.route, s.version], 'the start records the treatment it stood on');
  // وإنتاج على الحملة نفسها بلا معالجة معتمدة لا يبدأ: المخصص يغطيه، والناقص المعالجة وحدها، باسمها ومالكها.
  const bare = tx(() => production.createProduction(db, users.employee, { code: 'PRD-SYN-8001-B', title: 'تصوير بلا معالجة تجريبي', kind: 'social', brief: '',
    client_id: s.client, campaign_id: s.campaign, project_id: s.project, shoot_from: riyadh(3), shoot_to: riyadh(4) })).id;
  const version = production.productionsBoard(db, users.employee).productions.find(p => p.id === bare).version;
  const refused = caught(() => tx(() => production.productionAction(db, users.employee, bare, 'start', { version })));
  assert.equal(refused.code, 'shoot_not_ready');
  assert.deepEqual(refused.details.refusal.missing.map(m => m.doc_key), ['treatment'], 'the allocation covers it; the approved treatment is what is missing');
});

test('SYN-8001 step 7 — influencer delivery: the engagement stands on the client’s live campaign, the content is approved inside then by the client, and the publication proof is verified by someone other than its recorder', () => {
  s.influencer = tx(() => influencers.createInfluencer(db, users.employee, { stage_name: 'مؤثرة تجريبية SYN-8001', category: 'food', contact_mode: 'agency',
    agency_name: 'وكالة تجريبية', contact_name: 'وكيل تجريبي', contact_channel: 'agent@example.invalid', notes: 'ملف تجريبي' })).id;
  const person = () => influencers.influencersBoard(db, users.employee).influencers.find(x => x.id === s.influencer);
  tx(() => influencers.influencerAction(db, users.employee, s.influencer, 'set_status', { version: person().version, status: 'active', note: 'اكتمل الملف التجريبي' }));
  const engagement = { influencer_id: s.influencer, client_id: s.client, title: 'ارتباط إطلاق تجريبي SYN-8001', brief: 'منشور واحد عن المنتج', posts_count: 1, stories_count: 0, videos_count: 0,
    fee: '5000.00', starts_on: riyadh(), ends_on: riyadh(20), cancellation_terms: 'الإلغاء قبل سبعة أيام بلا مقابل', disclosure_requirement: 'وسم إعلان في أول سطر',
    usage_scope: 'organic_only', usage_from: riyadh(), usage_until: riyadh(60), usage_terms: 'استخدام عضوي على حساب المؤثرة خلال المدة' };
  const otherClient = tx(() => createClient(db, users.manager, { legal_name: 'شركة ثانية تجريبية', trade_name: 'الثانية التجريبية', sector: 'تجزئة', status: 'active' })).id;
  const other = tx(() => campaigns.createCampaign(db, users.manager, { client_id: otherClient,
    name: 'حملة عميل آخر تجريبية', objective: 'حملة لعميل آخر للتحقق من الربط', channels: ['instagram'], targets: [{ metric: 'نقرات', target: 1000, unit: 'نقرة' }], media_budget: '0', budget_reference: '', start_date: riyadh(), end_date: riyadh(5) })).id;
  // التسليم: الارتباط يُقبل على حملة قائمة لعميله نفسه فقط.
  assert.equal(caught(() => tx(() => influencers.createEngagement(db, users.employee, { ...engagement, campaign_id: other }))).code, 'campaign_id');
  s.engagement = tx(() => influencers.createEngagement(db, users.employee, { ...engagement, campaign_id: s.campaign })).id;
  const view = (who = 'employee') => influencers.influencerCampaignsBoard(db, users[who]).engagements.find(e => e.id === s.engagement);
  const eAct = (who, action, input = {}) => tx(() => influencers.engagementAction(db, users[who], s.engagement, action, { version: view(who).version, ...input }));
  eAct('employee', 'request_review');
  eAct('manager', 'approve_engagement', { note: 'راجعت المخرجات والحقوق وشروط الإلغاء', licence_ack: 'لا رخصة مسجلة للمؤثرة التجريبية؛ أتحمل المضي وأحلت الأمر للمختص القانوني' });
  assert.equal(view().campaign_name, 'حملة إطلاق تجريبية SYN-8001');
  s.content = tx(() => influencers.addContent(db, users.employee, s.engagement, { version: view().version, kind: 'post', title: 'منشور المؤثرة التجريبي', description: 'صورة المنتج' })).id;
  // مسودة المؤثرة مخرجٌ في عمل الاستوديو المفتوح للحملة نفسها، يعتمده مراجعه بالفحوص الخمسة، فيُقدَّم المحتوى عليه (P4-SPEC-3).
  let w = studio('employee', 'create_output', { title: 'منشور المؤثرة التجريبي', channel: 'instagram', format: 'صورة ونص', dimensions: 'مربع 1080×1080', language: 'العربية',
    brand_reference: 'WAHA-DEMO', acceptance: 'مطابقة الرسالة ووسم الإعلان', content: 'منتج تجريبي طازج كل يوم. إعلان', asset_ids: [s.asset] });
  const influencerOutput = w.outputs.find(o => o.current_version.snapshot.title === 'منشور المؤثرة التجريبي');
  studio('employee', 'submit_output', { output_id: influencerOutput.id });
  studio('manager', 'approve_output', { output_id: influencerOutput.id, note: 'مطابقة للموجز وتحمل وسم الإعلان',
    quality_checks: { brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' } });
  const item = (who = 'employee') => view(who).content.find(c => c.id === s.content);
  const cAct = (who, action, input = {}) => tx(() => influencers.contentAction(db, users[who], s.content, action, { version: item(who).version, ...input }));
  cAct('employee', 'submit_content', { output_version_id: influencerOutput.current_version_id });
  assert.equal(item().output.version_id, influencerOutput.current_version_id, 'the influencer post carries the version the studio approved');
  cAct('manager', 'approve_content', { note: 'مطابق للموجز ويحمل وسم الإعلان' });
  cAct('employee', 'record_client_approval', { approver_name: 'مفوضة العميل التجريبية', channel: 'email', received_on: riyadh(), reference: 'بريد موافقة تجريبي على منشور المؤثرة' });
  cAct('employee', 'record_proof', { post_url: 'https://example.invalid/syn-8001/influencer-post', published_on: riyadh(), screenshot_reference: 'لقطة تجريبية في ملف الحملة',
    disclosure_confirmed: true, disclosure_evidence: 'وسم الإعلان في أول سطر' });
  const proof = item().proof;
  assert.equal(caught(() => tx(() => influencers.verifyProof(db, users.employee, proof.id, { method: 'human_open_link', note: 'أتحقق من إثباتي بنفسي' }))).code, 'separation_of_duties');
  tx(() => influencers.verifyProof(db, users.manager, proof.id, { method: 'human_open_link', note: 'فتحت الرابط وطابقت الوسم واللقطة' }));
  assert.equal(view().deliverables.find(d => d.key === 'post').verified, 1);
  s.post = proof.post_url;
});

test('SYN-8001 step 8 — PR delivery: the pitch is recorded on the campaign, and the coverage takes its client and campaign from the pitch it came from — counted once', () => {
  const contact = tx(() => pr.createContact(db, users.employee, { name: 'صحفية تجريبية SYN-8001', role_title: 'محررة اقتصاد', outlet: 'صحيفة تجريبية', outlet_type: 'print',
    beats: ['الاقتصاد'], language: 'ar', preferences: '', email: 'press@example.invalid', phone: '', lawful_basis: 'public_professional_source',
    basis_note: 'بيانات تواصل منشورة في صفحة الوسيلة التجريبية', collected_on: riyadh(), source: 'صفحة اتصل بنا في موقع الوسيلة التجريبي' })).id;
  const list = tx(() => pr.createList(db, users.employee, { name: 'قائمة إطلاق تجريبية SYN-8001', purpose: 'إطلاق المنتج التجريبي لصحافة الاقتصاد', client_id: s.client, campaign_id: s.campaign })).id;
  const listView = () => pr.prBoard(db, users.employee).lists.find(l => l.id === list);
  tx(() => pr.listAction(db, users.employee, list, 'add', { version: listView().version, contact_id: contact, note: 'تغطي قطاع العميل' }));
  tx(() => pr.listAction(db, users.manager, list, 'lock', { version: listView().version, note: 'راجعت الجهة ومطابقتها لغرض الحملة' }));
  const pitch = tx(() => pr.createPitch(db, users.employee, { contact_id: contact, list_id: list, client_id: s.client, campaign_id: s.campaign, subject: 'إطلاق المنتج التجريبي',
    angle: 'أثر المنتج التجريبي على السوق المحلي', sent_on: riyadh(), sent_via: 'بريد الموظفة خارج المنصة' })).id;
  const pitchView = () => pr.prBoard(db, users.manager).pitches.find(p => p.id === pitch);
  tx(() => pr.pitchAction(db, users.manager, pitch, 'published', { version: pitchView().version, outcome_on: riyadh(), note: 'نُشر الخبر في الصفحة الاقتصادية' }));
  const coverage = { pitch_id: pitch, contact_id: '', client_id: '', campaign_id: '', outlet: 'صحيفة تجريبية', outlet_type: 'print', title: 'الواحة التجريبية تطلق منتجها',
    url: 'https://example.invalid/syn-8001/news', published_on: riyadh(), tone: 'positive', tone_reason: 'العنوان والمتن نقلا الرسالة كما أردناها', highlight: false, highlight_reason: '', summary: '' };
  s.coverage = tx(() => pr.createCoverage(db, users.employee, coverage)).id;
  // التسليم: لا عميل ولا حملة كُتبا على التغطية؛ أخذتهما من مراسلتها.
  const row = { ...db.prepare('SELECT client_id,campaign_id,contact_id FROM pr_coverage WHERE id=?').get(s.coverage) };
  assert.deepEqual(row, { client_id: s.client, campaign_id: s.campaign, contact_id: contact });
  assert.equal(caught(() => tx(() => pr.createCoverage(db, users.manager, coverage))).code, 'duplicate_coverage');
  const report = pr.coverageReport(db, users.employee, { campaign_id: s.campaign });
  assert.deepEqual([report.total, report.pitches.published], [1, 1]);
  s.news = coverage.url;
});

test('SYN-8001 step 9 — client report: generated from a template and a period only, and every figure equals the record it names', () => {
  tx(() => campaigns.campaignAction(db, users.employee, s.campaign, 'result', { version: campaignView().version, entry_date: riyadh(), metric: 'نقرات', value: 1200, source: 'لوحة المنصة التجريبية SYN-8001' }));
  const entry = campaignView().entries.find(e => e.kind === 'result').id;
  tx(() => campaigns.campaignAction(db, users.employee, s.campaign, 'correct', { version: campaignView().version, entry_id: entry, value: 1150, source: 'تصحيح من تقرير المنصة التجريبي النهائي' }));
  const template = tx(() => reports.createTemplate(db, users.manager, { client_id: s.client, name: 'تقرير SYN-8001', cadence: 'campaign_end',
    sections: ['campaign_results', 'content_published', 'media_spend'] })).id;
  // التسليم: لا رقم يُدخل في التوليد؛ القالب والفترة وحدهما.
  const generated = tx(() => reports.generateReport(db, users.employee, { template_id: template, period_start: riyadh(), period_end: riyadh(), title: 'تقرير إطلاق SYN-8001', supersedes_id: '' })).id;
  const body = reports.readClientReport(db, users.manager, generated).body;
  const section = key => body.sections.find(x => x.key === key);
  const results = section('campaign_results').groups.find(g => g.title === 'حملة إطلاق تجريبية SYN-8001').figures[0];
  assert.equal(results.value, campaignView().targets[0].actual, 'campaign result = the campaign entries after correction');
  assert.equal(results.value, 1150);
  const spend = section('media_spend').groups.find(g => g.title === 'حملة إطلاق تجريبية SYN-8001').figures;
  const pacing = spendView('manager').pacing;
  assert.equal(spend.find(f => f.label.startsWith('الميزانية المخططة')).value, pacing.planned_minor);
  for (const line of pacing.lines) assert.equal(spend.find(f => f.label.startsWith(line.channel_name)).value, line.actual_minor, `${line.channel}: report = media spend after correction`);
  assert.match(spend.find(f => f.label.startsWith('إنستغرام')).source, /كشف حساب المنصة التجريبي SYN-8001/, 'the figure names the record it came from');
  const published = section('content_published').groups[0].figures;
  assert.deepEqual(published.map(f => [f.label, f.value]), [['إنستغرام — عدد المنشور', campaigns.contentBoard(db, users.employee).items.filter(i => i.status === 'published').length]]);
  assert.ok(published[0].source.includes(db.prepare('SELECT digest FROM studio_output_versions WHERE id=?').get(s.version).digest.slice(0, 12)), 'the report names the digest of the version the client approved');
  assert.equal(caught(() => tx(() => reports.reportAction(db, users.employee, generated, 'sign_report', { version: 1, confirm: true }))).code, 'action_unavailable');
  tx(() => reports.reportAction(db, users.manager, generated, 'write_commentary', { version: 1, commentary: 'الأداء في يوم الإطلاق التجريبي مطابق للخطة المعتمدة', next_step: '' }));
  tx(() => reports.reportAction(db, users.manager, generated, 'sign_report', { version: 2, confirm: true }));
  assert.equal(reports.readClientReport(db, users.manager, generated).status, 'signed');
  s.report = generated;
});

test('SYN-8001 step 9b — the client report carries the verified influencer post and the PR coverage as figures that name them', () => {
  // قالب بكل الأقسام المعرّفة وقت التشغيل: بعد الدمج يدخل فيه القسمان الجديدان بلا تعديل هنا.
  const template = tx(() => reports.createTemplate(db, users.manager, { client_id: s.client, name: 'تقرير SYN-8001 بكل الأقسام', cadence: 'campaign_end',
    sections: reports.SECTIONS.map(x => x.key) })).id;
  const generated = tx(() => reports.generateReport(db, users.employee, { template_id: template, period_start: riyadh(), period_end: riyadh(), title: 'تقرير إطلاق SYN-8001 بأقسامه المتخصصة', supersedes_id: '' })).id;
  const figures = reports.readClientReport(db, users.manager, generated).body.sections.flatMap(x => x.groups.flatMap(g => g.figures));
  assert.ok(figures.some(f => f.source.includes(s.post)), 'the verified influencer post');
  assert.ok(figures.some(f => f.source.includes(s.news)), 'the PR coverage');
});

test('SYN-8001: the whole specialist cycle leaves one unbroken audit chain', () => {
  assert.equal(verifyAudit(db), true);
});
