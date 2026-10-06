// الاستوديو على حملة (الحزمة 4، P4-SPEC-1، الترحيل 187). كانت مساحة الاستوديو تحمل مشروعًا ولا عميل ولا حملة: هدف الحملة
// وقنواتها ومؤشرها يُكتبان في الموجز من جديد (وقائمة قنوات الاستوديو بلا «إعلانات قوقل»)، ولا شيء يربط المخرج بالحملة.
// المساحة المفتوحة لحملة تحمل الحملة وعميلها من سجل الحملة، وموجزها يقرأ الهدف والقنوات والمستهدفات منه، والحقل المعاد
// كتابته يُرفض باسمه لا يُتجاهل. والمساحة الحرة (بلا حملة) تبقى كما كانت. البيانات كلها مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign, campaignAction, campaignsBoard } from '../app/campaigns.mjs';
import { createStudio, studioAction, listStudio } from '../app/studio.mjs';
import { studioUI } from '../app/static/studio-ui.mjs';

const riyadh = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const caught = fn => { try { fn(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };
// ما لا تملكه الحملة من الموجز: الجمهور ودليله والرسالة والمحظورات ومصدر القياس والنطاق — يكتبه معدّ العمل.
const creative = () => ({ audience: 'جمهور مصطنع مهتم بالأغذية', audience_basis: 'افتراض محلي معلن؛ لم يجر بحث ميداني', message: 'منتج تجريبي طازج كل يوم',
  prohibited_messages: 'لا ادعاءات صحية', measurement_source: 'لوحة المنصة الإعلانية التجريبية', scope: 'منشور واحد بنسخته العربية' });
const freeBrief = () => ({ objective: 'هدف مكتوب في موجز حر', ...creative(), kpi: 'نقرات على المنشور', channels: ['instagram'] });

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-studio-campaign'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  const project = tx(() => createProject(db, users.manager, { name: 'مشروع حملة تجريبي', brief: 'استوديو على حملة', member_ids: ['employee', 'outsider'] })).id;
  const client = tx(() => createClient(db, users.manager, { legal_name: 'شركة المرسى التجريبية', trade_name: 'المرسى التجريبية', sector: 'أغذية', status: 'active' })).id;
  tx(() => clientAction(db, users.manager, client, 'add_member', { user_id: 'employee', role: 'منسقة الحساب التجريبية' }));
  const campaignInput = extra => ({ client_id: client, name: 'حملة المرسى التجريبية', objective: 'تعريف الجمهور بالمنتج التجريبي خلال شهر',
    channels: ['instagram', 'google_ads'], targets: [{ metric: 'نقرات', target: 20000, unit: 'نقرة' }], media_budget: '0', budget_reference: '',
    start_date: riyadh(), end_date: riyadh(30), ...extra });
  const campaign = tx(() => createCampaign(db, users.employee, campaignInput())).id;
  const open = (input, who = 'employee') => tx(() => createStudio(db, users[who], { project_id: project, title: 'مساحة منشور المرسى', ...input }));
  const act = (who, s, action, input = {}) => tx(() => studioAction(db, users[who], s.id, action, { version: s.version, ...input }));
  return { db, users, tx, project, client, campaign, campaignInput, open, act };
}

test('P4-SPEC-1 studio on a campaign: the job carries the campaign and its client from the campaign record, and its brief reads the objective, channels and targets from there — a retyped one is refused by name', t => {
  const { db, users, tx, project, client, campaign, campaignInput, open, act } = fixture(t);
  let s = open({ campaign_id: campaign, ...creative() });
  const row = { ...db.prepare('SELECT client_id,campaign_id FROM studio_workspaces WHERE id=?').get(s.id) };
  assert.deepEqual(row, { client_id: client, campaign_id: campaign }, 'the client is read from the campaign, never passed in');
  assert.deepEqual([s.campaign_name, s.client_name], ['حملة المرسى التجريبية', 'المرسى التجريبية']);
  const brief = s.brief.snapshot;
  assert.equal(brief.objective, 'تعريف الجمهور بالمنتج التجريبي خلال شهر', 'the objective is the campaign’s');
  assert.deepEqual(brief.channels, ['google_ads', 'instagram'], 'the channels are the campaign’s, google_ads included');
  assert.equal(brief.kpi, 'نقرات: 20000 نقرة', 'the target is the campaign’s');
  assert.equal(brief.campaign.id, campaign);
  assert.equal(brief.message, 'منتج تجريبي طازج كل يوم', 'what the campaign does not hold is written by the studio author');

  for (const [field, value] of [['objective', 'هدف مكتوب من جديد للمرة الثانية'], ['channels', ['instagram']], ['kpi', 'مؤشر مكتوب من جديد']]) {
    const refused = caught(() => open({ campaign_id: campaign, ...creative(), [field]: value }));
    assert.equal(refused.code, 'derived_field', `${field} is refused by name, not ignored`);
    assert.equal(refused.status, 400);
    assert.ok(refused.details?.refusal?.next, `${field}: the refusal says where it is changed`);
  }

  // حملة عميل لا تعرفه معدّة العمل: لا تُرى ولا يُكشف اسمها.
  const otherClient = tx(() => createClient(db, users.manager, { legal_name: 'شركة أخرى تجريبية', trade_name: 'الأخرى التجريبية', sector: 'تجزئة', status: 'active' })).id;
  const foreign = tx(() => createCampaign(db, users.manager, campaignInput({ client_id: otherClient, name: 'حملة عميل آخر تجريبية' }))).id;
  const hidden = caught(() => open({ campaign_id: foreign, ...creative() }));
  assert.equal(hidden.status, 404);
  assert.equal(hidden.message.includes('حملة عميل آخر'), false, 'the refusal says nothing about the other client’s campaign');
  // الحملة الملغاة لا يُفتح لها عمل جديد.
  const cancelled = tx(() => createCampaign(db, users.employee, campaignInput({ name: 'حملة ملغاة تجريبية' }))).id;
  const view = id => campaignsBoard(db, users.employee).campaigns.find(c => c.id === id);
  tx(() => campaignAction(db, users.employee, cancelled, 'cancel', { version: view(cancelled).version, note: 'ألغى العميل الحملة التجريبية' }));
  assert.equal(caught(() => open({ campaign_id: cancelled, ...creative() })).code, 'campaign_closed');

  // قنوات الحملة تصل المخرج: مخرج على «إعلانات قوقل» يُقبل لأنه من قنوات الموجز المقروءة من الحملة.
  s = act('manager', act('employee', s, 'submit_brief'), 'approve_brief', { note: 'الهدف والقنوات من الحملة، والرسالة مراجعة' });
  s = act('employee', s, 'add_asset', { name: 'صورة المنتج المصطنعة', internal_reference: 'ASSET_MARSA_1', rights_holder: 'المرسى التجريبية', rights_basis: 'licensed',
    rights_evidence: 'ترخيص استخدام تجريبي محفوظ في ملف العميل', valid_from: riyadh(), valid_until: riyadh(365), channels: ['google_ads'] });
  s = act('manager', s, 'inspect_asset', { asset_id: s.assets[0].id, outcome: 'passed', evidence: 'طابقت الترخيص والقناة والمدة' });
  s = act('employee', s, 'create_output', { title: 'إعلان بحث تجريبي', channel: 'google_ads', format: 'نص إعلان', dimensions: 'ثلاثة عناوين ووصفان', language: 'العربية',
    brand_reference: 'MARSA-DEMO', acceptance: 'مطابقة الرسالة والهوية', content: 'منتج تجريبي طازج كل يوم.', asset_ids: [s.assets[0].id] });
  assert.equal(s.outputs[0].current_version.snapshot.channel, 'google_ads');

  // الربط في القاعدة نفسها: يُكتب مرة ولا يتبدل، والعميل عميل الحملة.
  assert.throws(() => db.prepare('UPDATE studio_workspaces SET campaign_id=NULL,client_id=NULL,version=version+1 WHERE id=?').run(s.id), /fixed when it is opened/);
  assert.throws(() => db.prepare("INSERT INTO studio_workspaces(id,tenant_id,project_id,title,owner_id,reviewer_id,reviewer_role,reviewer_appointed_by,status,version,current_brief_id,created_at,updated_at,client_id,campaign_id) VALUES('x-studio','36t',?,'مساحة بعميل غير عميل الحملة','employee','manager','manager','manager','draft',1,'x-brief','2026-10-01','2026-10-01',?,?)").run(project, otherClient, campaign), /its own client/);
  assert.equal(verifyAudit(db), true);
});

test('P4-SPEC-1 studio on a campaign: a new brief revision reads the campaign again, so a channel added to the campaign before launch reaches the brief without retyping', t => {
  const { db, users, tx, campaign, open, act } = fixture(t);
  let s = open({ campaign_id: campaign, ...creative() });
  s = act('manager', act('employee', s, 'submit_brief'), 'return_brief', { note: 'وضّح الرسالة قبل الاعتماد' });
  const view = () => campaignsBoard(db, users.employee).campaigns.find(c => c.id === campaign);
  // الحملة ما زالت في التخطيط: صاحبتها تضيف قناة، والموجز التالي يقرؤها بلا إعادة كتابة.
  tx(() => campaignAction(db, users.employee, campaign, 'edit', { version: view().version, name: view().name, objective: view().objective,
    channels: ['instagram', 'google_ads', 'tiktok'], targets: view().targets.map(({ metric, target, unit }) => ({ metric, target, unit })),
    media_budget: '0', budget_reference: '', start_date: view().start_date, end_date: view().end_date }));
  assert.equal(caught(() => act('employee', s, 'save_brief', { ...creative(), objective: 'هدف معاد كتابته في النسخة الثانية' })).code, 'derived_field');
  s = act('employee', s, 'save_brief', { ...creative(), message: 'منتج تجريبي طازج كل يوم بنسخة أوضح' });
  assert.equal(s.brief.revision, 2);
  assert.deepEqual(s.brief.snapshot.channels, ['google_ads', 'instagram', 'tiktok'], 'the second revision reads the campaign as it stands');
  assert.equal(s.brief.snapshot.message, 'منتج تجريبي طازج كل يوم بنسخة أوضح');
  assert.deepEqual(s.brief_versions[0].snapshot.channels, ['google_ads', 'instagram'], 'the first revision keeps what it read');
  assert.equal(verifyAudit(db), true);
});

test('P4-SPEC-1 free-standing studio job: a job opened without a campaign keeps its own brief as before, and the start form asks for the campaign and hides what it reads from it', t => {
  const { db, users, project, campaign, open, act } = fixture(t);
  const s = open(freeBrief());
  assert.deepEqual([s.campaign_id, s.client_id, s.campaign_name], [null, null, null]);
  assert.equal(s.brief.snapshot.objective, 'هدف مكتوب في موجز حر');
  assert.deepEqual(listStudio(db, users.employee).map(r => r.id), [s.id], 'a free-standing job stays readable');

  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const offered = [];
  const projects = [{ id: project, name: 'مشروع حملة تجريبي', created_by: 'manager', members: [{ id: 'employee', name: users.employee.name }, { id: 'outsider', name: users.outsider.name }] }];
  const data = () => ({ rows: listStudio(db, users.employee), projects, campaigns: campaignsBoard(db, users.employee).campaigns, user: users.employee });
  studioUI.render(data(), { e, button: (action, id, label) => { offered.push([action, id, label]); return `<button>${e(label)}</button>`; } });
  assert.ok(offered.some(([action, id]) => action === 'create' && id === project), 'the start from the project stays');
  const spec = studioUI.form('create', project, data());
  const byName = name => spec.fields.find(f => f.name === name);
  assert.ok(byName('campaign_id').options.some(o => o.value === campaign), 'the campaign is offered in the start form');
  assert.equal(byName('campaign_id').options[0].value, '', 'a job without a campaign stays possible');
  for (const derived of ['objective', 'kpi', ...spec.fields.filter(f => f.name.startsWith('channel_')).map(f => f.name)])
    assert.deepEqual(byName(derived).showWhen, { name: 'campaign_id', equals: [''] }, `${derived} shows only without a campaign — with one it is read from it`);
  const values = Object.fromEntries(spec.fields.map(f => [f.name, f.type === 'select' ? f.options.at(-1).value : 'نص تجريبي كافٍ للحقل']));
  const linked = spec.toPayload({ ...values, campaign_id: campaign });
  assert.equal(linked.campaign_id, campaign);
  for (const derived of ['objective', 'kpi', 'channels']) assert.equal(derived in linked, false, `${derived} is not sent with a campaign`);
  const free = spec.toPayload({ ...values, campaign_id: '' });
  assert.equal('campaign_id' in free, false);
  assert.ok(free.objective && free.kpi && free.channels.length, 'without a campaign the brief is written as before');

  // العمل المفتوح لحملة: بطاقته تسمّي الحملة وعميلها، ونموذج نسخة الموجز لا يطلب ما يُقرأ منها.
  const linkedJob = open({ campaign_id: campaign, ...creative() });
  const returned = act('manager', act('employee', linkedJob, 'submit_brief'), 'return_brief', { note: 'وضّح الرسالة قبل الاعتماد' });
  const html = studioUI.render(data(), { e, button: (action, id, label) => `<button>${e(label)}</button>` });
  assert.match(html, /حملة المرسى التجريبية/);
  assert.match(html, /المرسى التجريبية/);
  const save = studioUI.form('save_brief', returned.id, data());
  assert.equal(save.fields.some(f => ['objective', 'kpi'].includes(f.name) || f.name.startsWith('channel_')), false, 'a campaign job’s brief revision does not ask for what it reads from the campaign');
  const body = save.toPayload(Object.fromEntries(save.fields.map(f => [f.name, String(f.value ?? '')])));
  for (const derived of ['objective', 'kpi', 'channels']) assert.equal(derived in body, false);
  assert.equal(verifyAudit(db), true);
});
