import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse } from './refusal.mjs';
import { clientFor } from './agency.mjs';

const roles = ['employee', 'manager', 'pm'];
// قنوات الاستوديو وقنوات الحملات معًا: موجز العمل المفتوح لحملة يقرأ قنواتها كما هي (الترحيل 187)، و«إعلانات قوقل» منها.
const channels = ['instagram', 'x', 'linkedin', 'tiktok', 'youtube', 'website', 'internal', 'print', 'video', 'event', 'snapchat', 'google_ads', 'email', 'outdoor', 'other'];
const briefFields = ['objective', 'audience', 'audience_basis', 'message', 'prohibited_messages', 'kpi', 'measurement_source', 'channels', 'scope'];
// ما يقرؤه موجز الحملة من سجلها ولا يُكتب فيه من جديد؛ والحقل المرسَل منها يُرفض باسمه ولا يُتجاهل.
const campaignFields = { objective: 'الهدف', kpi: 'المؤشر المستهدف', channels: 'القنوات' };
const outputFields = ['title', 'channel', 'format', 'dimensions', 'language', 'brand_reference', 'acceptance', 'content', 'asset_ids'];
const qualityFields = ['brand', 'language', 'claims', 'accessibility', 'specification'];
const actionFields = {
  save_brief: briefFields, submit_brief: [], approve_brief: ['note'], return_brief: ['note'],
  add_asset: ['name', 'internal_reference', 'rights_holder', 'rights_basis', 'rights_evidence', 'valid_from', 'valid_until', 'channels'],
  inspect_asset: ['asset_id', 'outcome', 'evidence'], create_output: outputFields, save_output: ['output_id', ...outputFields],
  submit_output: ['output_id'], approve_output: ['output_id', 'note', 'quality_checks'], return_output: ['output_id', 'note'],
  issue_package: ['output_ids', 'use_from', 'use_until', 'exclusions'], accept_package: ['package_id', 'note', 'evidence']
};
const parseRow = row => row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function writing(db) {
  if (!db.isTransaction) fail(500, 'transaction_required', 'كتابة الاستوديو تتطلب معاملة قاعدة بيانات');
}
function actor(db, supplied) {
  if (typeof supplied?.id !== 'string' || typeof supplied?.tenant_id !== 'string') fail(401, 'login_required', 'سجّل الدخول للمتابعة');
  const u = db.prepare('SELECT id,tenant_id,role,active,name FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id, supplied.tenant_id);
  if (!u) fail(401, 'session_expired', 'انتهت الجلسة أو توقف الحساب');
  return u;
}
function projectMember(db, u, projectId) {
  if (!roles.includes(u.role)) return null;
  return db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(projectId, u.tenant_id, u.id);
}
function workspace(db, u, id) {
  if (typeof id !== 'string') fail(404, 'not_found', 'مساحة الاستوديو غير متاحة');
  const s = db.prepare('SELECT * FROM studio_workspaces WHERE id=? AND tenant_id=?').get(id, u.tenant_id);
  if (!s || !projectMember(db, u, s.project_id)) fail(404, 'not_found', 'مساحة الاستوديو غير متاحة');
  return s;
}
function reviewerValid(db, s) {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(s.project_id, s.tenant_id);
  if (!p || p.created_by !== s.reviewer_appointed_by) return false;
  const authorizer = db.prepare("SELECT id,tenant_id,role FROM users WHERE id=? AND active=1 AND role IN ('manager','pm')").get(p.created_by);
  const reviewer = db.prepare('SELECT id,tenant_id,role FROM users WHERE id=? AND active=1 AND role=?').get(s.reviewer_id, s.reviewer_role);
  return !!authorizer && !!reviewer && s.owner_id !== reviewer.id && !!projectMember(db, authorizer, p.id) && !!projectMember(db, reviewer, p.id);
}
function requireReviewer(db, u, s) {
  if (u.id === s.owner_id) fail(403, 'self_approval', 'لا يجوز لمعد العمل اعتماد نسخه أو فحوص أصوله');
  if (s.reviewer_id !== u.id || !reviewerValid(db, s)) fail(403, 'reviewer_scope', 'المراجعة متاحة للمراجع المعين ضمن عضويته ودوره الحاليين');
}
function uniqueIds(value, label, maximum = 30) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum || value.some(id => typeof id !== 'string' || id.length < 1 || id.length > 100) || new Set(value).size !== value.length) fail(400, 'invalid_list', `${label}: اختر قائمة غير مكررة من السجلات المتاحة`);
  return [...value].sort();
}
function cleanChannels(value) {
  const selected = uniqueIds(value, 'القنوات', channels.length);
  if (selected.some(channel => !channels.includes(channel))) fail(400, 'channel', 'القناة غير معرّفة في الاستوديو المحلي');
  return selected;
}
function dates(from, until) {
  const start = v.date(from), end = v.date(until);
  if (end < start) fail(400, 'date_order', 'نهاية المدة تسبق بدايتها');
  return [start, end];
}
// موجز العمل المفتوح لحملة (الترحيل 187): الهدف والقنوات والمستهدفات من سجل الحملة كما هو ساعة كتابة النسخة، وما لا تحمله
// الحملة (الجمهور ودليله والرسالة والمحظورات ومصدر القياس والنطاق) يكتبه معدّ العمل. والنسخة تحفظ ما قرأته من الحملة.
function cleanBrief(input, campaign = null) {
  if (campaign) {
    const retyped = Object.keys(campaignFields).filter(key => Object.hasOwn(input, key));
    if (retyped.length) refuse(400, 'derived_field', { what: `${retyped.map(key => campaignFields[key]).join(' و')}: تنقرأ من حملة «${campaign.name}»، وما تنكتب في الموجز من جديد`,
      next: 'احذف هالحقول من الطلب؛ وتعديلها من شاشة «الحملات» ما دامت الحملة في التخطيط' });
    const targets = JSON.parse(campaign.targets);
    return {
      objective: campaign.objective, audience: v.text(input.audience, 'الجمهور', 2000, 3),
      audience_basis: v.text(input.audience_basis, 'دليل الجمهور والافتراضات', 4000, 3), message: v.text(input.message, 'الرسالة', 3000, 3),
      prohibited_messages: v.text(input.prohibited_messages, 'الرسائل المحظورة', 3000, 3), kpi: targets.map(t => `${t.metric}: ${t.target} ${t.unit}`).join('؛ '),
      measurement_source: v.text(input.measurement_source, 'مصدر القياس وطريقة جمعه', 3000, 3), channels: cleanChannels(JSON.parse(campaign.channels)), scope: v.text(input.scope, 'النطاق والاستثناءات', 5000, 3),
      campaign: { id: campaign.id, name: campaign.name, client_id: campaign.client_id, version: campaign.version, targets, start_date: campaign.start_date, end_date: campaign.end_date }
    };
  }
  return {
    objective: v.text(input.objective, 'هدف العمل', 3000, 3), audience: v.text(input.audience, 'الجمهور', 2000, 3),
    audience_basis: v.text(input.audience_basis, 'دليل الجمهور والافتراضات', 4000, 3), message: v.text(input.message, 'الرسالة', 3000, 3),
    prohibited_messages: v.text(input.prohibited_messages, 'الرسائل المحظورة', 3000, 3), kpi: v.text(input.kpi, 'المؤشر المستهدف وتعريفه', 2000, 3),
    measurement_source: v.text(input.measurement_source, 'مصدر القياس وطريقة جمعه', 3000, 3), channels: cleanChannels(input.channels), scope: v.text(input.scope, 'النطاق والاستثناءات', 5000, 3)
  };
}
// الحملة التي يُفتح لها العمل: من كيان المعدّ، ومن عملاء فريقه وحده، وقائمة لا مقفلة ولا ملغاة. الحملة التي لا يراها لا يُقال عنها شيء.
function campaignFor(db, supplied, u, campaignId) {
  const campaign = typeof campaignId === 'string' && db.prepare('SELECT * FROM campaigns WHERE id=? AND tenant_id=?').get(campaignId, u.tenant_id);
  let visible = false;
  if (campaign) try { clientFor(db, supplied, campaign.client_id); visible = true; } catch (error) { if (error.status !== 404) throw error; }
  if (!visible) refuse(404, 'not_found', { what: 'ما تقدر تفتح عمل استوديو على هالحملة من حسابك',
    missing: [{ document: 'عضوية في فريق حساب عميل الحملة', why: 'الحملة تنقرأ لفريق حساب عميلها وحده', owner: 'مسؤول حساب العميل', owner_role: 'account_owner' }],
    next: 'اطلب من مسؤول حساب العميل يضيفك لفريقه، أو افتح العمل على حملة من عملائك' });
  if (['completed', 'cancelled'].includes(campaign.status)) refuse(409, 'campaign_closed', { what: `حملة «${campaign.name}» ${campaign.status === 'completed' ? 'انقفلت' : 'انلغت'}، فما ينفتح لها عمل استوديو جديد`,
    next: 'افتح العمل على حملة قائمة، أو بلا حملة إذا كان العمل مستقل' });
  return campaign;
}
const campaignOf = (db, s) => s.campaign_id ? db.prepare('SELECT * FROM campaigns WHERE id=? AND tenant_id=?').get(s.campaign_id, s.tenant_id) : null;
function briefOf(db, s) {
  const row = parseRow(db.prepare('SELECT * FROM studio_brief_versions WHERE id=? AND studio_id=?').get(s.current_brief_id, s.id));
  if (!row) fail(409, 'brief_required', 'نسخة الموجز الأصلية غير متاحة');
  return row;
}
function outputOf(db, s, id) {
  const row = db.prepare('SELECT * FROM studio_outputs WHERE id=? AND studio_id=?').get(v.text(id, 'معرف المخرج', 100), s.id);
  if (!row) fail(404, 'not_found', 'المخرج غير متاح لهذه المساحة');
  const current = parseRow(db.prepare('SELECT * FROM studio_output_versions WHERE id=? AND output_id=?').get(row.current_version_id, row.id));
  if (!current) fail(409, 'version_required', 'النسخة الأصلية للمخرج غير متاحة');
  return { ...row, current_version: current };
}
function assetOf(db, s, id) {
  const asset = db.prepare('SELECT * FROM studio_assets WHERE id=? AND studio_id=?').get(v.text(id, 'معرف الأصل', 100), s.id);
  if (!asset) fail(404, 'not_found', 'الأصل غير متاح لهذه المساحة');
  return { ...asset, channels: JSON.parse(asset.channels), inspection: db.prepare('SELECT * FROM studio_asset_checks WHERE asset_id=?').get(id) ?? null };
}
function decisionFor(db, s, kind, versionId) {
  return db.prepare('SELECT r.*,sb.kind,sb.version_id,sb.submitted_by,sb.reviewer_id FROM studio_reviews r JOIN studio_submissions sb ON sb.id=r.submission_id WHERE sb.studio_id=? AND sb.kind=? AND sb.version_id=?').get(s.id, kind, versionId);
}
function approved(db, s, kind, versionId) {
  const review = decisionFor(db, s, kind, versionId);
  if (!review || review.decision !== 'approved' || review.reviewed_by === review.submitted_by) fail(409, 'approval_required', 'تحتاج النسخة الأصلية إلى اعتماد مستقل');
  return review;
}
function submit(db, u, s, kind, versionId) {
  if (!reviewerValid(db, s)) fail(409, 'reviewer_unavailable', 'المراجع المعين غير متاح بصلاحيته الحالية');
  const id = randomUUID();
  db.prepare('INSERT INTO studio_submissions VALUES(?,?,?,?,?,?,?)').run(id, s.id, kind, versionId, u.id, s.reviewer_id, now());
  return { submission_id: id, version_id: versionId };
}
function decide(db, u, s, kind, versionId, decision, note, quality = {}) {
  requireReviewer(db, u, s);
  const submission = db.prepare('SELECT * FROM studio_submissions WHERE studio_id=? AND kind=? AND version_id=?').get(s.id, kind, versionId);
  if (!submission || submission.reviewer_id !== u.id || submission.submitted_by === u.id || decisionFor(db, s, kind, versionId)) fail(409, 'review_closed', 'لا توجد مراجعة معلقة لهذه النسخة');
  const reason = v.text(note, 'سبب القرار', 3000, 3), id = randomUUID();
  db.prepare('INSERT INTO studio_reviews VALUES(?,?,?,?,?,?,?)').run(id, submission.id, decision, reason, JSON.stringify(quality), u.id, now());
  return { review_id: id, version_id: versionId, decision, note: reason, quality_checks: quality };
}
function cleanOutput(db, s, input) {
  const brief = briefOf(db, s);
  approved(db, s, 'brief', brief.id);
  if (typeof input.channel !== 'string' || !brief.snapshot.channels.includes(input.channel)) fail(400, 'brief_channel', 'قناة المخرج يجب أن تكون ضمن الموجز المعتمد');
  const assetIds = uniqueIds(input.asset_ids, 'الأصول المرتبطة');
  for (const id of assetIds) assetOf(db, s, id);
  return { title: v.text(input.title, 'اسم المخرج', 180, 3), channel: input.channel, format: v.text(input.format, 'صيغة المخرج', 100),
    dimensions: v.text(input.dimensions, 'المقاس أو مواصفات الوسيط', 300), language: v.text(input.language, 'اللغة', 100),
    brand_reference: v.text(input.brand_reference, 'مرجع الهوية', 300), acceptance: v.text(input.acceptance, 'معيار القبول', 3000, 3),
    content: v.text(input.content, 'المحتوى أو وصف النسخة', 20000, 3), asset_ids: assetIds };
}
function allowedActions(db, u, s) {
  const owner = u.id === s.owner_id, reviewer = u.id === s.reviewer_id && reviewerValid(db, s), result = [];
  if (owner && ['draft', 'brief_returned'].includes(s.status)) result.push('save_brief');
  if (owner && s.status === 'draft') result.push('submit_brief');
  if (reviewer && s.status === 'brief_pending') result.push('approve_brief', 'return_brief');
  if (s.status !== 'production') return result;
  const outputs = db.prepare('SELECT * FROM studio_outputs WHERE studio_id=?').all(s.id);
  if (owner) {
    result.push('add_asset');
    if (db.prepare('SELECT 1 FROM studio_assets WHERE studio_id=?').get(s.id)) result.push('create_output');
    if (outputs.some(o => ['draft', 'returned'].includes(o.status))) result.push('save_output');
    if (outputs.some(o => o.status === 'draft')) result.push('submit_output');
    if (outputs.some(o => o.status === 'approved')) result.push('issue_package');
  }
  if (reviewer) {
    if (outputs.some(o => o.status === 'pending')) result.push('approve_output', 'return_output');
    if (db.prepare('SELECT 1 FROM studio_assets a LEFT JOIN studio_asset_checks c ON c.asset_id=a.id WHERE a.studio_id=? AND c.id IS NULL').get(s.id)) result.push('inspect_asset');
    if (db.prepare('SELECT 1 FROM studio_packages p LEFT JOIN studio_acceptances a ON a.package_id=p.id WHERE p.studio_id=? AND a.id IS NULL').get(s.id)) result.push('accept_package');
  }
  return result;
}
function publicWorkspace(db, u, s) {
  const briefVersions = db.prepare('SELECT * FROM studio_brief_versions WHERE studio_id=? ORDER BY revision').all(s.id).map(parseRow);
  const outputs = db.prepare('SELECT * FROM studio_outputs WHERE studio_id=? ORDER BY created_at,id').all(s.id).map(output => {
    const versions = db.prepare('SELECT * FROM studio_output_versions WHERE output_id=? ORDER BY revision').all(output.id).map(parseRow);
    return { ...output, versions, current_version: versions.find(version => version.id === output.current_version_id) };
  });
  const assets = db.prepare('SELECT id FROM studio_assets WHERE studio_id=? ORDER BY created_at,id').all(s.id).map(a => assetOf(db, s, a.id));
  const packages = db.prepare('SELECT * FROM studio_packages WHERE studio_id=? ORDER BY issued_at,id').all(s.id).map(row => ({ ...parseRow(row), acceptance: db.prepare('SELECT * FROM studio_acceptances WHERE package_id=?').get(row.id) ?? null }));
  const reviews = db.prepare('SELECT r.*,sb.kind,sb.version_id,sb.submitted_by FROM studio_reviews r JOIN studio_submissions sb ON sb.id=r.submission_id WHERE sb.studio_id=? ORDER BY r.reviewed_at,r.id').all(s.id).map(r => ({ ...r, quality_checks: JSON.parse(r.quality_checks) }));
  const person = id => db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name ?? '';
  const campaign = campaignOf(db, s), client = s.client_id ? db.prepare('SELECT legal_name,trade_name FROM clients WHERE id=?').get(s.client_id) : null;
  return { ...s, project_name: db.prepare('SELECT name FROM projects WHERE id=?').get(s.project_id)?.name,
    campaign_name: campaign?.name ?? null, campaign_status: campaign?.status ?? null, client_name: client ? client.trade_name || client.legal_name : null,
    owner_name: person(s.owner_id), reviewer_name: person(s.reviewer_id), brief_versions: briefVersions, brief: briefVersions.find(b => b.id === s.current_brief_id),
    outputs, assets, packages, reviews, allowed_actions: allowedActions(db, u, s) };
}
function validRights(asset, outputChannel, from, until) {
  const day = today();
  if (!asset.inspection || asset.inspection.outcome !== 'passed' || asset.inspection.checked_by === asset.created_by) fail(409, 'asset_unchecked', 'كل أصل يحتاج فحصًا داخليًا مستقلًا ناجحًا');
  if (asset.valid_from > day || asset.valid_until < day || asset.valid_from > from || asset.valid_until < until) fail(409, 'asset_expired', 'حقوق أحد الأصول لا تغطي اليوم ومدة الاستخدام المطلوبة');
  if (!asset.channels.includes(outputChannel)) fail(409, 'asset_channel', 'حقوق أحد الأصول لا تغطي قناة المخرج');
}

export function listStudio(db, suppliedUser) {
  const u = actor(db, suppliedUser);
  if (!roles.includes(u.role)) return [];
  return db.prepare('SELECT s.* FROM studio_workspaces s JOIN project_members m ON m.project_id=s.project_id WHERE s.tenant_id=? AND m.user_id=? ORDER BY s.updated_at DESC,s.id').all(u.tenant_id, u.id).map(s => publicWorkspace(db, u, s));
}

export function createStudio(db, suppliedUser, input) {
  writing(db); const u = actor(db, suppliedUser);
  v.object(input, ['project_id', 'title', 'reviewer_id', 'campaign_id', ...briefFields]);
  const projectId = v.text(input.project_id, 'المشروع', 100), p = projectMember(db, u, projectId);
  if (!p) fail(404, 'not_found', 'المشروع غير متاح للاستوديو');
  const reviewerId = input.reviewer_id === undefined || input.reviewer_id === '' ? p.created_by : v.text(input.reviewer_id, 'المراجع', 100);
  if (reviewerId !== p.created_by && u.id !== p.created_by) fail(403, 'reviewer_assignment', 'تسمية مراجع بديل متاحة لمنشئ المشروع فقط');
  if (reviewerId === u.id) fail(403, 'self_approval', 'اختر مراجعًا مستقلًا؛ لا يمكن مراجعة العمل الذاتي');
  const reviewer = db.prepare('SELECT id,tenant_id,role FROM users WHERE id=? AND active=1').get(reviewerId);
  if (!reviewer || !projectMember(db, reviewer, p.id)) fail(403, 'reviewer_scope', 'المراجع يجب أن يكون عضوًا نشطًا في المشروع');
  const campaign = input.campaign_id === undefined || input.campaign_id === '' ? null : campaignFor(db, suppliedUser, u, input.campaign_id);
  const id = randomUUID(), briefId = randomUUID(), snapshot = cleanBrief(input, campaign), timestamp = now();
  const s = { id, tenant_id: u.tenant_id, project_id: p.id, owner_id: u.id, reviewer_id: reviewerId, reviewer_role: reviewer.role, reviewer_appointed_by: p.created_by };
  if (!reviewerValid(db, s)) fail(403, 'reviewer_scope', 'سلطة تعيين المراجع غير متاحة حاليًا');
  db.prepare("INSERT INTO studio_workspaces(id,tenant_id,project_id,title,owner_id,reviewer_id,reviewer_role,reviewer_appointed_by,status,version,current_brief_id,created_at,updated_at,client_id,campaign_id) VALUES(?,?,?,?,?,?,?,?,'draft',1,?,?,?,?,?)")
    .run(id, u.tenant_id, p.id, v.text(input.title, 'عنوان مساحة الاستوديو', 180, 3), u.id, reviewerId, reviewer.role, p.created_by, briefId, timestamp, timestamp, campaign?.client_id ?? null, campaign?.id ?? null);
  const serialized = JSON.stringify(snapshot);
  db.prepare('INSERT INTO studio_brief_versions VALUES(?,?,?,?,?,?,?)').run(briefId, id, 1, serialized, hash(serialized), u.id, timestamp);
  audit(db, u, 'studio', id, 'created', {}, { project_id: p.id, brief_id: briefId, reviewer_id: reviewerId, reviewer_appointed_by: p.created_by, version: 1, campaign_id: campaign?.id ?? null, client_id: campaign?.client_id ?? null });
  return publicWorkspace(db, u, workspace(db, u, id));
}

export function studioAction(db, suppliedUser, id, action, input) {
  writing(db); const u = actor(db, suppliedUser), s = workspace(db, u, id);
  if (!Object.hasOwn(actionFields, action)) fail(400, 'unknown_action', 'إجراء الاستوديو غير معروف');
  v.object(input, ['version', ...actionFields[action]]); v.version(input.version, s.version);
  if (!allowedActions(db, u, s).includes(action)) fail(403, 'studio_transition', 'الإجراء غير متاح لحالتك أو دورك في هذه المساحة');
  let status = s.status, briefId = s.current_brief_id, detail = {};
  if (action === 'save_brief') {
    const snapshot = cleanBrief(input, campaignOf(db, s)), serialized = JSON.stringify(snapshot), revision = briefOf(db, s).revision + 1;
    briefId = randomUUID();
    db.prepare('INSERT INTO studio_brief_versions VALUES(?,?,?,?,?,?,?)').run(briefId, s.id, revision, serialized, hash(serialized), u.id, now());
    status = 'draft'; detail = { brief_id: briefId, revision };
  } else if (action === 'submit_brief') {
    detail = submit(db, u, s, 'brief', briefId); status = 'brief_pending';
  } else if (['approve_brief', 'return_brief'].includes(action)) {
    detail = decide(db, u, s, 'brief', briefId, action === 'approve_brief' ? 'approved' : 'returned', input.note);
    status = action === 'approve_brief' ? 'production' : 'brief_returned';
  } else if (action === 'add_asset') {
    const reference = v.text(input.internal_reference, 'مرجع الأصل الداخلي', 80, 3);
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(reference)) fail(400, 'internal_reference', 'استخدم معرف أصل داخليًا، لا رابط تنزيل');
    if (db.prepare('SELECT 1 FROM studio_assets WHERE studio_id=? AND internal_reference=?').get(s.id, reference)) fail(409, 'duplicate_asset', 'مرجع الأصل مسجل في هذه المساحة');
    if (!['owned', 'licensed', 'consent'].includes(input.rights_basis)) fail(400, 'rights_basis', 'حدد أساس حق الاستخدام');
    const [from, until] = dates(input.valid_from, input.valid_until), assetChannels = cleanChannels(input.channels), assetId = randomUUID();
    db.prepare('INSERT INTO studio_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(assetId, s.id, v.text(input.name, 'اسم الأصل', 180, 3), reference,
      v.text(input.rights_holder, 'صاحب الحقوق', 300, 3), input.rights_basis, v.text(input.rights_evidence, 'الإفادة النصية بحق الاستخدام', 5000, 10),
      from, until, JSON.stringify(assetChannels), u.id, now());
    detail = { asset_id: assetId, internal_reference: reference, reference_kind: 'internal_reference_only' };
  } else if (action === 'inspect_asset') {
    requireReviewer(db, u, s); const asset = assetOf(db, s, input.asset_id);
    if (asset.inspection) fail(409, 'inspection_closed', 'سبق تسجيل فحص هذا الأصل؛ سجّل أصلًا جديدًا عند تغيره');
    if (asset.created_by === u.id) fail(403, 'self_approval', 'فحص الأصل يتطلب شخصًا مستقلًا عن مسجله');
    if (!['passed', 'failed'].includes(input.outcome)) fail(400, 'inspection_outcome', 'حدد نتيجة الفحص');
    const evidence = v.text(input.evidence, 'إفادة الفحص الداخلي', 5000, 10), inspectionId = randomUUID();
    db.prepare('INSERT INTO studio_asset_checks VALUES(?,?,?,?,?,?)').run(inspectionId, asset.id, input.outcome, evidence, u.id, now());
    detail = { asset_id: asset.id, inspection_id: inspectionId, outcome: input.outcome };
  } else if (['create_output', 'save_output'].includes(action)) {
    const snapshot = cleanOutput(db, s, input), serialized = JSON.stringify(snapshot), versionId = randomUUID();
    let outputId = randomUUID(), revision = 1;
    if (action === 'save_output') {
      const original = outputOf(db, s, input.output_id);
      if (!['draft', 'returned'].includes(original.status)) fail(409, 'output_locked', 'النسخة المقدمة أو المعتمدة لا تعدل');
      outputId = original.id; revision = original.current_version.revision + 1;
      db.prepare("UPDATE studio_outputs SET current_version_id=?,status='draft' WHERE id=?").run(versionId, outputId);
    } else db.prepare("INSERT INTO studio_outputs VALUES(?,?,?,?,'draft',?)").run(outputId, s.id, u.id, versionId, now());
    db.prepare('INSERT INTO studio_output_versions VALUES(?,?,?,?,?,?,?,?)').run(versionId, outputId, briefId, revision, serialized, hash(serialized), u.id, now());
    detail = { output_id: outputId, version_id: versionId, revision, brief_id: briefId };
  } else if (action === 'submit_output') {
    const output = outputOf(db, s, input.output_id);
    if (output.status !== 'draft') fail(409, 'output_locked', 'يقدم المخرج من حالة المسودة فقط');
    approved(db, s, 'brief', output.current_version.brief_id);
    detail = { output_id: output.id, ...submit(db, u, s, 'output', output.current_version.id) };
    db.prepare("UPDATE studio_outputs SET status='pending' WHERE id=?").run(output.id);
  } else if (['approve_output', 'return_output'].includes(action)) {
    const output = outputOf(db, s, input.output_id);
    if (output.status !== 'pending') fail(409, 'output_locked', 'قرار المخرج يتطلب نسخة معلقة');
    let quality = {};
    if (action === 'approve_output') {
      v.object(input.quality_checks, qualityFields);
      if (qualityFields.some(field => input.quality_checks[field] !== 'passed')) fail(400, 'quality_required', 'اعتماد المخرج يتطلب نجاح فحوص الجودة الخمسة');
      quality = Object.fromEntries(qualityFields.map(field => [field, 'passed']));
    }
    const decision = action === 'approve_output' ? 'approved' : 'returned';
    detail = { output_id: output.id, ...decide(db, u, s, 'output', output.current_version.id, decision, input.note, quality) };
    db.prepare('UPDATE studio_outputs SET status=? WHERE id=?').run(decision, output.id);
  } else if (action === 'issue_package') {
    approved(db, s, 'brief', briefId);
    const outputIds = uniqueIds(input.output_ids, 'مخرجات حزمة التسليم');
    const [from, until] = dates(input.use_from, input.use_until);
    if (from < today()) fail(400, 'past_use', 'بداية الاستخدام يجب ألا تسبق اليوم في الرياض');
    const assets = new Map(), selected = [];
    for (const outputId of outputIds) {
      const output = outputOf(db, s, outputId);
      if (output.status !== 'approved') fail(409, 'unapproved_output', 'لا تضم حزمة التسليم إلا مخرجات معتمدة');
      const review = approved(db, s, 'output', output.current_version.id);
      if (output.current_version.brief_id !== briefId) fail(409, 'brief_mismatch', 'المخرج لا يتبع نسخة الموجز المعتمدة الحالية');
      for (const assetId of output.current_version.snapshot.asset_ids) {
        const asset = assetOf(db, s, assetId); validRights(asset, output.current_version.snapshot.channel, from, until); assets.set(asset.id, asset);
      }
      selected.push({ output_id: output.id, version_id: output.current_version.id, revision: output.current_version.revision, digest: output.current_version.digest, review_id: review.id, snapshot: output.current_version.snapshot });
    }
    const snapshot = { internal_only: true, brief_id: briefId, brief_revision: briefOf(db, s).revision, outputs: selected,
      assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)), use_from: from, use_until: until, exclusions: v.text(input.exclusions, 'الملفات والمخرجات المستثناة وسبب استثنائها', 5000, 3),
      excluded_output_ids: db.prepare('SELECT id FROM studio_outputs WHERE studio_id=? ORDER BY id').all(s.id).map(o => o.id).filter(outputId => !outputIds.includes(outputId)), manifest_kind: 'stored_text_and_internal_references' };
    const serialized = JSON.stringify(snapshot), digest = hash(serialized), packageId = randomUUID();
    if (db.prepare('SELECT 1 FROM studio_packages WHERE studio_id=? AND digest=?').get(s.id, digest)) fail(409, 'duplicate_package', 'سبق إصدار بيان الحزمة نفسه');
    db.prepare('INSERT INTO studio_packages VALUES(?,?,?,?,?,?)').run(packageId, s.id, serialized, digest, u.id, now());
    detail = { package_id: packageId, digest, output_version_ids: selected.map(output => output.version_id), internal_only: true };
  } else if (action === 'accept_package') {
    requireReviewer(db, u, s);
    const pkg = parseRow(db.prepare('SELECT * FROM studio_packages WHERE id=? AND studio_id=?').get(v.text(input.package_id, 'معرف بيان الحزمة', 100), s.id));
    if (!pkg) fail(404, 'not_found', 'بيان الحزمة غير متاح');
    if (db.prepare('SELECT 1 FROM studio_acceptances WHERE package_id=?').get(pkg.id)) fail(409, 'acceptance_closed', 'سبق قبول بيان هذه الحزمة');
    if (pkg.issued_by === u.id) fail(403, 'self_approval', 'قبول الحزمة يتطلب شخصًا مستقلًا');
    for (const output of pkg.snapshot.outputs) for (const assetId of output.snapshot.asset_ids) {
      const asset = assetOf(db, s, assetId); validRights(asset, output.snapshot.channel, pkg.snapshot.use_from, pkg.snapshot.use_until);
    }
    const note = v.text(input.note, 'سبب القبول الداخلي', 3000, 3), evidence = v.text(input.evidence, 'إفادة القبول لبيان الحزمة', 5000, 10), acceptanceId = randomUUID();
    db.prepare('INSERT INTO studio_acceptances VALUES(?,?,?,?,?,?)').run(acceptanceId, pkg.id, note, evidence, u.id, now());
    detail = { package_id: pkg.id, acceptance_id: acceptanceId, internal_only: true };
  }
  db.prepare('UPDATE studio_workspaces SET status=?,current_brief_id=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status, briefId, now(), s.id, s.version);
  audit(db, u, 'studio', s.id, action, { status: s.status, version: s.version }, { status, version: s.version + 1, ...detail }, input.note ?? '');
  return publicWorkspace(db, u, workspace(db, u, s.id));
}
