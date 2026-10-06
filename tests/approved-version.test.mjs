// النشر على النسخة المعتمدة (الحزمة 4، P4-SPEC-3، الترحيل 189). كان بند المحتوى المنشور وبند محتوى المؤثر يحملان مرجعًا نصيًا يكتبه
// الموظف (draft_reference)، فلا شيء يثبت أن المنشور هو النسخة التي اعتُمدت. البند الآن يُقدَّم على نسخة مخرج اعتمدها الاستوديو، فيحمل
// معرّفها وبصمتها مقروءين لا مكتوبين؛ والنسخة غير المعتمدة أو التي ردّها مسار مراجعة أو من حملة أخرى تُرفض باسمها؛ ولا يُنشر بند
// ومسار مراجعة نسخته جارٍ أو ردّها؛ وتقرير العميل يسمّي النسخة وبصمتها. البيانات كلها مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard, createContent, contentAction, contentBoard } from '../app/campaigns.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { registerApprover, recordApproval } from '../app/client-approvals.mjs';
import { createInfluencer, influencerAction, influencersBoard, createEngagement, engagementAction, addContent, contentAction as influencerContentAction, influencerCampaignsBoard } from '../app/influencers.mjs';
import { createTemplate, generateReport, readClientReport } from '../app/client-reports.mjs';
import { approvedVersion, reviewRoute } from './studio-fixture.mjs';
import { contentUI } from '../app/static/campaigns-ui.mjs';
import { influencerCampaignsUI } from '../app/static/influencers-ui.mjs';
import { filesIndex } from '../app/files.mjs';

const riyadh = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const caught = fn => { try { fn(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-approved-version'); t.after(() => db.close());
  let users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  for (const [who, capability, department] of [['employee', 'commercial.use', 'creative'], ['manager', 'commercial.use', 'creative'], ['employee', 'influencers.manage', ''],
    ['manager', 'influencers.manage', ''], ['outsider', 'approvals.record', '']])
    tx(() => grantAccess(db, users.admin, { user_id: who, capability, department_id: department, note: 'منح تجريبي لاختبار النشر على النسخة المعتمدة' }));
  users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const project = tx(() => createProject(db, users.manager, { name: 'مشروع النشر التجريبي', brief: 'مخرجات حملة تجريبية', member_ids: ['employee', 'outsider'] })).id;
  const client = tx(() => createClient(db, users.manager, { legal_name: 'شركة النخبة التجريبية', trade_name: 'النخبة التجريبية', sector: 'تجزئة', status: 'active' })).id;
  tx(() => clientAction(db, users.manager, client, 'add_member', { user_id: 'employee', role: 'منسقة الحساب التجريبية' }));
  const campaignInput = extra => ({ client_id: client, name: 'حملة النخبة التجريبية', objective: 'تعريف الجمهور بالمجموعة التجريبية الجديدة', channels: ['instagram', 'google_ads'],
    targets: [{ metric: 'نقرات', target: 5000, unit: 'نقرة' }], media_budget: '0', budget_reference: '', start_date: riyadh(), end_date: riyadh(30), ...extra });
  const campaign = tx(() => createCampaign(db, users.employee, campaignInput())).id;
  const view = id => campaignsBoard(db, users.employee).campaigns.find(c => c.id === id);
  const launch = id => {
    const act = (who, action, input = {}) => tx(() => campaignAction(db, users[who], id, action, { version: view(id).version, ...input }));
    for (const item of view(id).checklist) act('employee', 'check', { key: item.key, evidence: 'دليل تجريبي لاكتمال البند' });
    act('employee', 'request_launch'); act('manager', 'approve_launch', { note: 'راجعت الجاهزية التجريبية' });
  };
  launch(campaign);
  const content = (input = {}) => tx(() => createContent(db, users.employee, { client_id: client, campaign_id: campaign, brand_id: '', channel: 'instagram', format: 'post',
    title: 'منشور النخبة التجريبي', brief: '', planned_date: riyadh(), planned_time: '', retainer_id: '', deliverable_type: '', ...input })).id;
  const item = id => contentBoard(db, users.employee).items.find(i => i.id === id);
  const cAct = (who, id, action, input = {}) => tx(() => contentAction(db, users[who], id, action, { version: item(id).version, ...input }));
  const documented = version => {
    const approver = tx(() => registerApprover(db, users.outsider, { project_id: project, name: 'مفوضة العميل التجريبية', title: 'مديرة التسويق',
      authority_basis: 'خطاب تفويض تجريبي من العميل', authority_scope: 'اعتماد مواد الحملة الرقمية', valid_from: riyadh() })).id;
    return tx(() => recordApproval(db, users.outsider, { output_version_id: version, approver_id: approver, decision: 'approved', scope_note: 'موافقة على المنشور كما هو بالنسخة المعروضة',
      channel: 'email', received_on: riyadh(), evidence_reference: 'بريد موافقة تجريبي محفوظ في ملف العميل' })).id;
  };
  return { db, users, tx, project, client, campaign, campaignInput, launch, content, item, cAct, documented };
}

test('P4-SPEC-3 published content: a calendar item is submitted on an output version the studio approved — its id and digest are read, never typed — and a version that is unapproved, turned down, of another campaign or another channel is refused by name', t => {
  const { db, users, tx, project, campaign, content, item, cAct, documented } = fixture(t);
  const approved = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور النخبة المعتمد' });
  const id = content();
  cAct('employee', id, 'start');
  const typed = caught(() => cAct('employee', id, 'submit', { draft_reference: 'ملف التصميم في المجلد المشترك v1' }));
  assert.equal(typed.code, 'version_required', 'a typed reference is no longer what is submitted');
  assert.ok(typed.details?.refusal?.next);

  // نسخة لم يعتمدها الاستوديو بعد، ونسخة من عمل حرّ بلا حملة، ونسخة على قناة غير قناة البند، ونسخة ردّها مسار مراجعة.
  let s = tx(() => createStudio(db, users.employee, { project_id: project, campaign_id: campaign, title: 'مساحة مسودة تجريبية', audience: 'جمهور مصطنع', audience_basis: 'افتراض معلن',
    message: 'رسالة تجريبية', prohibited_messages: 'لا شيء', measurement_source: 'لوحة تجريبية', scope: 'مخرج واحد' }));
  const step = (who, action, input = {}) => (s = tx(() => studioAction(db, users[who], s.id, action, { version: s.version, ...input })));
  step('employee', 'submit_brief'); step('manager', 'approve_brief', { note: 'معتمد للاختبار' });
  step('employee', 'add_asset', { name: 'أصل المسودة', internal_reference: 'ASSET_DRAFT_1', rights_holder: 'صاحب حق مصطنع', rights_basis: 'owned', rights_evidence: 'إفادة ملكية مصطنعة',
    valid_from: riyadh(), valid_until: riyadh(365), channels: ['instagram'] });
  step('manager', 'inspect_asset', { asset_id: s.assets[0].id, outcome: 'passed', evidence: 'طابقت الحقوق' });
  step('employee', 'create_output', { title: 'مسودة لم تُعتمد', channel: 'instagram', format: 'صورة', dimensions: 'مربع', language: 'العربية', brand_reference: 'X', acceptance: 'مطابقة',
    content: 'نص مسودة', asset_ids: [s.assets[0].id] });
  const draft = s.outputs[0].current_version_id;
  const free = approvedVersion(db, users, { project, title: 'مخرج عمل حرّ' }).version;
  const otherChannel = approvedVersion(db, users, { project, campaign, channel: 'google_ads', title: 'إعلان بحث' }).version;
  const turnedDown = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور طُلب تعديله' }).version;
  reviewRoute(db, users, { version: turnedDown, decision: 'changes_required' });
  for (const [version, expected] of [[draft, 'version_not_approved'], [free, 'version_mismatch'], [otherChannel, 'version_mismatch'], [turnedDown, 'version_rejected']])
    assert.equal(caught(() => cAct('employee', id, 'submit', { output_version_id: version })).code, expected, expected);

  cAct('employee', id, 'submit', { output_version_id: approved.version });
  const row = { ...db.prepare('SELECT output_version_id,output_digest,draft_reference FROM content_items WHERE id=?').get(id) };
  assert.deepEqual(row, { output_version_id: approved.version, output_digest: approved.digest, draft_reference: '' }, 'the version and its digest are read from the studio, nothing is typed');
  assert.deepEqual([item(id).output.title, item(id).output.revision, item(id).output.digest], ['منشور النخبة المعتمد', approved.revision, approved.digest]);
  assert.throws(() => db.prepare("UPDATE content_items SET output_digest='not-the-digest',version=version+1 WHERE id=?").run(id), /digest of that very version/);

  // موافقة العميل تُقرأ من سجل الموافقات الموثّقة على النسخة نفسها، ولا يُعاد كتابة مرجعها.
  cAct('manager', id, 'pass', { note: 'مطابق للنسخة المعتمدة' });
  const other = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور آخر موثّق' }).version;
  assert.equal(caught(() => cAct('employee', id, 'client_approve', { external_approval_id: documented(other) })).code, 'approval_mismatch', 'an approval documented on another version does not count');
  const approval = documented(approved.version);
  cAct('employee', id, 'client_approve', { external_approval_id: approval });
  assert.match(item(id).client_approval_reference, /مفوضة العميل التجريبية/);
  // مسار مراجعة يُفتح على النسخة بعد ربطها وما زال جاريًا: لا نشر قبل قراره.
  reviewRoute(db, users, { version: approved.version, decision: null });
  assert.equal(caught(() => cAct('employee', id, 'publish', { published_reference: 'https://example.invalid/elite/1', overage_note: '' })).code, 'review_running');
  assert.ok(verifyAudit(db));
});

test('P4-SPEC-3 published content: the post published for the campaign is the version the review approved, and the client report names that version and its digest', t => {
  const { db, users, tx, project, client, campaign, content, item, cAct, documented } = fixture(t);
  const approved = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور النخبة المعتمد' });
  reviewRoute(db, users, { version: approved.version });
  const id = content();
  cAct('employee', id, 'start'); cAct('employee', id, 'submit', { output_version_id: approved.version });
  cAct('manager', id, 'pass', { note: 'مطابق للنسخة المعتمدة' }); cAct('employee', id, 'client_approve', { external_approval_id: documented(approved.version) });
  cAct('employee', id, 'publish', { published_reference: 'https://example.invalid/elite/2', overage_note: '' });
  assert.deepEqual([item(id).status, item(id).output_version_id], ['published', approved.version]);
  const template = tx(() => createTemplate(db, users.manager, { client_id: client, name: 'تقرير النخبة التجريبي', cadence: 'campaign_end', sections: ['content_published'] })).id;
  const report = tx(() => generateReport(db, users.employee, { template_id: template, period_start: riyadh(), period_end: riyadh(), title: 'تقرير النشر التجريبي', supersedes_id: '' })).id;
  const figure = readClientReport(db, users.manager, report).body.sections.find(x => x.key === 'content_published').groups[0].figures[0];
  assert.equal(figure.value, 1);
  assert.match(figure.source, new RegExp(`النسخة ${approved.revision}`));
  assert.ok(figure.source.includes(approved.digest.slice(0, 12)), 'the report names the digest of the version the client approved');
  assert.ok(verifyAudit(db));
});

test('P4-SPEC-3 influencer content: the influencer’s post is submitted on an approved version of a studio job opened for the engagement’s campaign, read with its digest, and nothing is published while that version’s review is still running', t => {
  const { db, users, tx, project, client, campaign } = fixture(t);
  const influencer = tx(() => createInfluencer(db, users.employee, { stage_name: 'مؤثرة النخبة التجريبية', category: 'food', contact_mode: 'direct', agency_name: '',
    contact_name: 'مؤثرة تجريبية', contact_channel: 'creator@example.invalid', notes: '' })).id;
  const person = () => influencersBoard(db, users.employee).influencers.find(x => x.id === influencer);
  tx(() => influencerAction(db, users.employee, influencer, 'set_status', { version: person().version, status: 'active', note: 'اكتمل الملف التجريبي' }));
  const engagement = tx(() => createEngagement(db, users.employee, { influencer_id: influencer, client_id: client, campaign_id: campaign, title: 'ارتباط النخبة التجريبي', brief: '',
    posts_count: 1, stories_count: 0, videos_count: 0, fee: '3000.00', starts_on: riyadh(), ends_on: riyadh(20), cancellation_terms: 'الإلغاء قبل سبعة أيام بلا مقابل',
    disclosure_requirement: 'وسم إعلان في أول سطر', usage_scope: 'organic_only', usage_from: riyadh(), usage_until: riyadh(60), usage_terms: 'استخدام عضوي خلال المدة المتفق عليها' })).id;
  const eView = () => influencerCampaignsBoard(db, users.employee).engagements.find(e => e.id === engagement);
  const eAct = (who, action, input = {}) => tx(() => engagementAction(db, users[who], engagement, action, { version: eView().version, ...input }));
  eAct('employee', 'request_review');
  eAct('manager', 'approve_engagement', { note: 'راجعت المخرجات والحقوق', licence_ack: 'لا رخصة مسجلة للمؤثرة التجريبية؛ أتحمل المضي وأحلت الأمر للمختص' });
  const contentId = tx(() => addContent(db, users.employee, engagement, { version: eView().version, kind: 'post', title: 'منشور المؤثرة التجريبي', description: '' })).id;
  const item = () => eView().content.find(c => c.id === contentId);
  const act = (who, action, input = {}) => tx(() => influencerContentAction(db, users[who], contentId, action, { version: item().version, ...input }));
  assert.equal(caught(() => act('employee', 'submit_content', { draft_reference: 'مسودة المؤثرة في المجلد v1' })).code, 'version_required');
  assert.equal(caught(() => act('employee', 'submit_content', { output_version_id: approvedVersion(db, users, { project, title: 'مخرج عمل حرّ' }).version })).code, 'version_mismatch',
    'the influencer’s post comes from a studio job opened for the engagement’s campaign');
  const approved = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور المؤثرة المعتمد' });
  act('employee', 'submit_content', { output_version_id: approved.version });
  assert.deepEqual({ ...db.prepare('SELECT output_version_id,output_digest FROM influencer_content WHERE id=?').get(contentId) }, { output_version_id: approved.version, output_digest: approved.digest });
  assert.equal(item().output.digest, approved.digest);
  act('manager', 'approve_content', { note: 'مطابق للنسخة المعتمدة ويحمل وسم الإعلان' });
  act('employee', 'record_client_approval', { approver_name: 'مفوضة العميل التجريبية', channel: 'email', received_on: riyadh(), reference: 'بريد موافقة تجريبي على منشور المؤثرة' });
  reviewRoute(db, users, { version: approved.version, decision: null });
  const proof = { post_url: 'https://example.invalid/elite/influencer', published_on: riyadh(), screenshot_reference: 'لقطة تجريبية في ملف الحملة', disclosure_confirmed: true, disclosure_evidence: 'وسم الإعلان في أول سطر' };
  assert.equal(caught(() => act('employee', 'record_proof', proof)).code, 'review_running');
  assert.ok(verifyAudit(db));
});

test('P4-SPEC-3 screens: the submit forms offer only the approved versions that fit the item, the client approval form offers the approval documented on that version, and a recorded proof carries its file block', t => {
  const { db, users, tx, project, client, campaign, content, item, cAct, documented } = fixture(t);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const offered = [], button = (action, id, label) => { offered.push([action, id]); return `<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`; };
  const fit = approvedVersion(db, users, { project, campaign, channel: 'instagram', title: 'منشور يطابق البند' }).version;
  const otherChannel = approvedVersion(db, users, { project, campaign, channel: 'google_ads', title: 'إعلان بحث لا يطابق' }).version;
  const free = approvedVersion(db, users, { project, title: 'مخرج عمل حرّ لا يطابق' }).version;
  const id = content(); cAct('employee', id, 'start');
  let data = contentBoard(db, users.employee);
  const submit = contentUI.form('submit_internal', id, data);
  const options = submit.fields.find(f => f.name === 'output_version_id').options.map(o => o.value);
  assert.ok(options.includes(fit), 'the version that fits the item is offered');
  for (const other of [otherChannel, free]) assert.equal(options.includes(other), false, 'a version of another channel or campaign is not offered');
  assert.deepEqual(submit.toPayload({ output_version_id: fit }), { version: item(id).version, output_version_id: fit });
  cAct('employee', id, 'submit', submit.toPayload({ output_version_id: fit }));
  cAct('manager', id, 'pass', { note: 'مطابق للنسخة المعتمدة' });
  const approval = documented(fit);
  data = contentBoard(db, users.employee);
  const html = contentUI.render(data, { e, button });
  assert.match(html, /النسخة \d+ من «منشور يطابق البند»/);
  const approve = contentUI.form('record_client_approval', id, data);
  assert.ok(approve.fields.find(f => f.name === 'external_approval_id').options.some(o => o.value === approval), 'the approval documented on the version is offered');
  assert.deepEqual(approve.toPayload({ external_approval_id: approval, reference: '' }), { version: item(id).version, external_approval_id: approval });

  // محتوى المؤثر: النموذج يعرض نسخ حملة الارتباط وحدها، والإثبات المسجّل يحمل كتلة ملفاته.
  const influencer = tx(() => createInfluencer(db, users.employee, { stage_name: 'مؤثرة شاشة تجريبية', category: 'food', contact_mode: 'direct', agency_name: '', contact_name: 'مؤثرة', contact_channel: 'c@example.invalid', notes: '' })).id;
  tx(() => influencerAction(db, users.employee, influencer, 'set_status', { version: influencersBoard(db, users.employee).influencers.find(x => x.id === influencer).version, status: 'active', note: 'اكتمل الملف التجريبي' }));
  const engagement = tx(() => createEngagement(db, users.employee, { influencer_id: influencer, client_id: client, campaign_id: campaign, title: 'ارتباط شاشة تجريبي', brief: '', posts_count: 1, stories_count: 0, videos_count: 0,
    fee: '1000.00', starts_on: riyadh(), ends_on: riyadh(10), cancellation_terms: 'الإلغاء قبل سبعة أيام بلا مقابل', disclosure_requirement: 'وسم إعلان', usage_scope: 'organic_only',
    usage_from: riyadh(), usage_until: riyadh(30), usage_terms: 'استخدام عضوي خلال المدة المتفق عليها' })).id;
  const board = () => influencerCampaignsBoard(db, users.employee), eView = () => board().engagements.find(g => g.id === engagement);
  tx(() => engagementAction(db, users.employee, engagement, 'request_review', { version: eView().version }));
  tx(() => engagementAction(db, users.manager, engagement, 'approve_engagement', { version: eView().version, note: 'راجعت المخرجات', licence_ack: 'لا رخصة مسجلة؛ أتحمل المضي وأحلت الأمر للمختص القانوني' }));
  const contentId = tx(() => addContent(db, users.employee, engagement, { version: eView().version, kind: 'post', title: 'منشور شاشة المؤثرة', description: '' })).id;
  const form = influencerCampaignsUI.form('submit_content', contentId, board());
  const choices = form.fields.find(f => f.name === 'output_version_id').options.map(o => o.value);
  assert.ok(choices.includes(fit) && !choices.includes(free), 'the influencer form offers the versions of the engagement’s campaign only');
  const step = (who, action, input = {}) => tx(() => influencerContentAction(db, users[who], contentId, action, { version: eView().content.find(c => c.id === contentId).version, ...input }));
  step('employee', 'submit_content', form.toPayload({ output_version_id: fit }));
  step('manager', 'approve_content', { note: 'مطابق للنسخة المعتمدة' });
  step('employee', 'record_client_approval', { approver_name: 'مفوضة تجريبية', channel: 'email', received_on: riyadh(), reference: 'بريد موافقة تجريبي محفوظ' });
  step('employee', 'record_proof', { post_url: 'https://example.invalid/screen/1', published_on: riyadh(), screenshot_reference: 'لقطة تجريبية', disclosure_confirmed: true, disclosure_evidence: 'وسم الإعلان' });
  const loaded = board(), proofId = loaded.engagements.find(g => g.id === engagement).content.find(c => c.id === contentId).proof.id;
  const withFiles = { ...loaded, files: filesIndex(db, users.employee, 'influencer_proof', [proofId]).index };
  offered.length = 0;
  const page = influencerCampaignsUI.render(withFiles, { e, button, money: x => String(x) });
  assert.match(page, /النسخة المعتمدة: منشور يطابق البند/);
  assert.ok(offered.some(([action, target]) => action === 'upload_file' && target === proofId), 'the recorder is offered the proof screenshot upload');
  assert.equal(influencerCampaignsUI.form('upload_file', proofId, withFiles).toPayload({ label: 'لقطة', file: { filename: 'p.png', content: 'AAAA' } }).entity_type, 'influencer_proof');
});

