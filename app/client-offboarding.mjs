// إنهاء العلاقة مع العميل وإعادة فتحها (الحزمة 4، P4-CRM-7، الترحيل 186).
//
// إقفال عميل يفحص ما بقي مفتوحًا قبل أي شيء: فرص وصفقات قبل الاتفاق، وبنود متعاقد عليها لم تُسلَّم، واستحقاقات وذمم ومقبوضات
// لم تنحسم، ومال للعميل عندنا لم يُخصَّص ولم يُردّ، وجداول فوترة ومسوداتها، وعقود سارية، وبلاغات مفتوحة. كل بند مفتوح يقف
// برفض يسمّيه ومالكه وخطوته. ومال العميل الذي لم يُخصَّص يقف وحده بسبب آخر: ما في المنصة مسار ردّ — فجوة مالية يملكها مالك
// المالية (ز16)، فلا يُخترع مسار ردّ هنا.
// الإقفال سجلٌّ يطلبه مسؤول الحساب ويقرّه من سمّاه من حملة clients.manage غير الطالب؛ وقرار الإقفال يُخرج فريق الحساب،
// ويوقف جهات الاتصال والعلامات (لا يحذفها)، ويسحب تفويض معتمدي العميل على مشاريعه. وما يُحفظ وكم يُحفظ: من سجل حماية البيانات
// (أنشطة المعالجة وجدول الاحتفاظ)، يُنسخ أساسه في السجل لحظة القرار؛ المنصة لا تتلف شيئًا ولا تحسب مدة من عندها.
// وإعادة الفتح سجلٌّ مثله، يعيد الجهات والعلامات التي أوقفها الإقفال ويترك الفريق ليضيفه المسؤول بقرار.
// الحارس assertClientOpen يقف عليه كل مسار ينشئ عملًا جديدًا لعميل: صفقة، فرصة، تسعير، تقدير، استحقاق، بلاغ، جدولة، تجديد.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { holds, capabilityHolders } from './access.mjs';
import { personName } from './people-read.mjs';
import { notifyMany, SUBJECT_LINKS } from './notices.mjs';
import { riyadhToday } from './riyadh-time.mjs';
import { effectiveTerm } from './contracts-register.mjs';

// إشعار الإقفال وقراره يفتح «العملاء».
Object.assign(SUBJECT_LINKS, { client_offboarding: '#clients' });
export const KINDS = Object.freeze({ close: 'إقفال ملف العميل', reopen: 'إعادة فتح ملف العميل' });
export const STATUS = Object.freeze({ requested: 'ينتظر قرار المعتمد', approved: 'معتمد', rejected: 'مرفوض', withdrawn: 'مسحوب' });
const CANONICAL = Object.freeze({ requested: 'pending', approved: 'approved', rejected: 'rejected', withdrawn: 'cancelled' });
const ACCOUNT_OWNER = 'مسؤول حساب العميل';
const FINANCE = 'المالية — حامل تفويض الاعتماد المالي';
const PRIVACY = 'مسؤول حماية البيانات — من يحمل تصريح privacy.manage';
const PRE_CONTRACT = ['lead', 'qualification_pending', 'qualification_rejected', 'qualified', 'quote_draft', 'quote_pending', 'quote_rejected', 'quote_approved'];

/* ───── الحارس ───── */
// يُستدعى سطرًا واحدًا في كل مسار ينشئ عملًا جديدًا لعميل. ملف مقفل يُرفض باسمه ومالكه، والخطوة: سجل إعادة فتح.
export function assertClientOpen(db, tenantId, clientId, what) {
  if (!clientId) return;
  const c = db.prepare('SELECT code,status,owner_id FROM clients WHERE id=? AND tenant_id=?').get(clientId, tenantId);
  if (!c || c.status !== 'closed') return;
  refuse(409, 'client_closed', { what: `${what}: ملف العميل ${c.code} مقفل`,
    missing: [{ document: 'سجل إعادة فتح ملف العميل معتمد', why: 'الملف انقفل بسجل إقفال معتمد، وما يرجع له عمل جديد إلا بسجل إعادة فتح يقرّه غير طالبه', owner: personName(db, c.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager', doc_key: 'reopening' }],
    next: 'يطلب مسؤول الحساب إعادة فتح الملف من «العملاء»، ثم ارجع لهالخطوة' });
}
// الحارس نفسه بمعرّف الصفقة، لمسار يعرف الصفقة لا العميل (استحقاق العميل في app/receivables.mjs).
// «*» لا اسم العمود: اختبارات الترقية تمرّ بالاستحقاق على مخطط قبل 180، حيث لا client_id على الصفقة، فلا عميل يُفحص.
export function assertDealClientOpen(db, tenantId, caseId, what) {
  const deal = typeof caseId === 'string' ? db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(caseId, tenantId) : null;
  assertClientOpen(db, tenantId, deal?.client_id ?? null, what);
}

/* ───── ما بقي مفتوحًا ───── */
const names = (db, ids) => [...new Set(ids.filter(Boolean))].map(id => personName(db, id)).filter(Boolean).join('، ');
const item = (key, title, rows, { blocking = true, why, owner, owner_role = 'account_manager', next, refs = [] }) =>
  ({ key, title, count: rows.length, blocking: blocking && rows.length > 0, why, owner, owner_role, next, refs });
function dealsOf(db, clientId) { return db.prepare('SELECT * FROM commercial_cases WHERE client_id=? ORDER BY created_at').all(clientId); }
// البنود المتعاقد عليها التي لم يُقبل مخرجها: عدد بنود الاتفاق ناقص البنود المقبولة.
function undelivered(db, deal) {
  const contract = db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(deal.id);
  if (!contract) return 0;
  const lines = JSON.parse(contract.snapshot).lines?.length ?? 0;
  const accepted = db.prepare("SELECT COUNT(DISTINCT d.line_index) AS n FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' WHERE d.case_id=? AND r.status='approved'").get(deal.id).n;
  return Math.max(0, lines - accepted);
}
export function offboardingChecklist(db, tenantId, clientId, today = riyadhToday()) {
  const deals = dealsOf(db, clientId), dealIds = deals.map(d => d.id), marks = dealIds.map(() => '?').join(',');
  const opportunities = db.prepare("SELECT id,name,owner_id FROM opportunities WHERE client_id=? AND status='open'").all(clientId);
  const open = deals.filter(d => PRE_CONTRACT.includes(d.status));
  const short = deals.filter(d => ['contracted', 'project_active'].includes(d.status)).map(d => ({ ...d, missing: undelivered(db, d) })).filter(d => d.missing > 0);
  // مخرج مقبول بلا استحقاق قائم: عمل سلّمناه ولم نطالب به بعد.
  const unbilled = dealIds.length ? db.prepare(`SELECT d.id,k.owner_id FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' JOIN commercial_cases k ON k.id=d.case_id
    WHERE d.case_id IN (${marks}) AND NOT EXISTS(SELECT 1 FROM ar_claims c WHERE c.delivery_id=d.id AND c.status NOT IN ('cancelled','rejected'))`).all(...dealIds) : [];
  const claims = dealIds.length ? db.prepare(`SELECT c.id,c.status,c.case_id,s.net_minor-s.received_minor-s.allocated_minor AS balance FROM ar_claims c JOIN ar_claim_collection s ON s.claim_id=c.id
    WHERE c.case_id IN (${marks}) AND c.status IN ('draft','pending','approved')`).all(...dealIds).filter(c => c.status !== 'approved' || c.balance > 0) : [];
  const receipts = dealIds.length ? db.prepare(`SELECT r.id FROM ar_receipts r JOIN ar_claims c ON c.id=r.claim_id WHERE c.case_id IN (${marks}) AND r.status='pending'`).all(...dealIds) : [];
  // مال العميل عندنا: قبض على الحساب ينتظر المطابقة أو مؤكد بباقٍ غير مخصَّص ولم يرتد، ودفعة مقدمة مسجّلة أو مقبوضة بباقٍ لم يُسحب ولم يرتد.
  const account = dealIds.length ? db.prepare(`SELECT x.id,x.status,CAST(x.amount_minor AS INTEGER)
      -(SELECT COALESCE(SUM(CASE a.kind WHEN 'allocation' THEN CAST(a.amount_minor AS INTEGER) ELSE -CAST(a.amount_minor AS INTEGER) END),0) FROM ar_allocations a WHERE a.account_receipt_id=x.id) AS unallocated,
      EXISTS(SELECT 1 FROM ar_account_reversals r WHERE r.account_receipt_id=x.id AND r.status='approved') AS reversed
    FROM ar_account_receipts x WHERE x.case_id IN (${marks}) AND x.status IN ('pending','confirmed')`).all(...dealIds).filter(x => x.status === 'pending' || (!x.reversed && x.unallocated > 0)) : [];
  const advances = db.prepare(`SELECT a.id,a.status,a.paid_minor-(SELECT COALESCE(SUM(d.applied_minor),0) FROM advance_draws d WHERE d.advance_id=a.id)
      -(SELECT COALESCE(SUM(r.amount_minor),0) FROM advance_reversals r WHERE r.advance_id=a.id) AS balance FROM advance_invoices a WHERE a.client_id=?`).all(clientId)
    .filter(a => a.status === 'recorded' || a.balance > 0);
  const schedules = db.prepare("SELECT id,title,owner_id FROM billing_schedules WHERE client_id=? AND status IN ('active','paused')").all(clientId);
  const drafts = db.prepare("SELECT d.id,s.owner_id FROM billing_drafts d JOIN billing_schedules s ON s.id=d.schedule_id WHERE d.client_id=? AND d.status='pending_review'").all(clientId);
  const contracts = db.prepare("SELECT * FROM contract_records WHERE client_id=? AND party_kind='client' AND status='active'").all(clientId).filter(c => effectiveTerm(db, c).end_date >= today);
  const support = db.prepare("SELECT id,number,handler_id FROM client_support_cases WHERE client_id=? AND status<>'closed'").all(clientId);
  const brands = db.prepare('SELECT id FROM client_brands WHERE client_id=? AND active=1').all(clientId);
  const members = db.prepare('SELECT user_id FROM client_members WHERE client_id=? AND removed_at IS NULL').all(clientId);
  const contacts = db.prepare('SELECT id FROM client_contacts WHERE client_id=? AND active=1').all(clientId);
  const approvers = dealIds.length ? db.prepare(`SELECT a.id FROM client_approvers a JOIN commercial_cases k ON k.project_id=a.project_id WHERE k.id IN (${marks}) AND a.revoked_on IS NULL`).all(...dealIds) : [];
  return [
    item('open_opportunities', 'فرص مفتوحة', opportunities, { why: 'الفرصة المفتوحة توقّع لعمل قادم على عميل نقفله', owner: names(db, opportunities.map(o => o.owner_id)) || 'صاحب الفرصة', next: 'أغلق كل فرصة رابحة أو خاسرة بسببها من «خط الفرص»', refs: opportunities.map(o => o.name) }),
    item('open_deals', 'صفقات قبل الاتفاق', open, { why: 'صفقة ما انتهت ولا انقفلت', owner: names(db, open.map(d => d.owner_id)) || 'صاحب الصفقة', next: 'أغلقها «خسرناها» أو «سحبناها» بسببها من «العملاء والعروض»', refs: open.map(d => d.name) }),
    item('undelivered_lines', 'بنود متعاقد عليها ما انقبل مخرجها', short, { why: `${short.reduce((n, d) => n + d.missing, 0)} بند في الاتفاق ما انسلّم ولا انقبل`, owner: names(db, short.map(d => d.owner_id)) || 'صاحب الصفقة', next: 'سلّم البنود واقبلها، أو سجّل تغيير النطاق المعتمد عليها؛ إنهاء اتفاق قائم مسار ما انبنى بعد (ز16)', refs: short.map(d => d.name) }),
    item('unbilled_deliveries', 'مخرجات مقبولة ما انسجّل استحقاقها', unbilled, { why: 'عمل سلّمناه وقبله العميل ولم نطالب به', owner: FINANCE, owner_role: 'finance', next: 'سجّل الاستحقاق من المخرج المقبول في «مستحقات العملاء»، أو أغلقه بقراره إن كان لا يُطالب به' }),
    item('open_receivables', 'استحقاقات وذمم ما انحسمت', [...claims, ...receipts], { why: 'استحقاق مسودة أو مرفوع أو معتمد بباقٍ، أو قبض ينتظر المطابقة', owner: FINANCE, owner_role: 'finance', next: 'تُسوّى الذمة أو يُلغى الاستحقاق بقراره، وتنحسم المطابقة من «مستحقات العملاء»' }),
    // فجوة لا التفاف: مال للعميل عندنا لا يُقفل الملف عليه، ولا مسار ردّ في المنصة. الرفض يسمّي السبب ومالكه.
    item('unrefunded_money', 'مال للعميل عندنا ما تخصّص ولا انردّ', [...account, ...advances], { why: 'قبض على الحساب أو دفعة مقدمة بباقٍ لم يُخصَّص على استحقاق؛ والمنصة ما فيها مسار ردّ لمال العميل', owner: FINANCE, owner_role: 'finance', next: 'خصّصه على استحقاق مفتوح من «مستحقات العملاء» أو «الفوترة الدورية». وإن كان المال يُرد للعميل، فمسار الرد قرار مالك المالية (ز16) قبل إقفال الملف' }),
    item('billing', 'جدولة فوترة أو مسودة فاتورة قائمة', [...schedules, ...drafts], { why: 'الجدولة تجهّز مسودات فواتير، والمسودة تنتظر إصدارًا أو إلغاء', owner: names(db, [...schedules, ...drafts].map(s => s.owner_id)) || 'مالك الجدولة', owner_role: 'finance', next: 'أنهِ الجدولة بسببها، وأصدر المسودة أو ألغها من «الفوترة الدورية»', refs: schedules.map(s => s.title) }),
    item('contracts_in_force', 'عقود سارية', contracts, { why: 'العقد ساري لين نهايته؛ ملف عميل مقفل ما يحمل عقدًا ساريًا', owner: names(db, contracts.map(c => c.owner_id)) || 'مالك العقد', owner_role: 'legal', next: 'أنهِ العقد بمرجع الإشعار من «سجل العقود»، أو انتظر نهايته', refs: contracts.map(c => c.number) }),
    item('support_cases', 'بلاغات مفتوحة', support, { why: 'بلاغ العميل ما انحل ولا انقرّ حله', owner: names(db, support.map(c => c.handler_id)) || 'مسؤول البلاغ', next: 'يحل المسؤول البلاغ ويقرّه زميله من «دعم العملاء»', refs: support.map(c => c.number) }),
    item('brand_assets', 'علامات العميل وأدلة هويته', brands, { blocking: false, why: 'ملفات العميل عندنا: تُكتب في طلب الإقفال ملاحظة بما صار لها (سُلّمت أو أُرشفت وأين)، وتتوقف بالإقفال ولا تُحذف', owner: ACCOUNT_OWNER, next: 'اكتب في طلب الإقفال ما صار بملفات العلامات' }),
    item('account_team', 'فريق الحساب', members, { blocking: false, why: 'يخرج الفريق من الملف بالإقفال، ويبقى مسؤول الحساب حافظًا له', owner: ACCOUNT_OWNER, next: 'ما يحتاج شي: الخروج تلقائي بالقرار' }),
    item('contacts', 'جهات اتصال العميل', contacts, { blocking: false, why: 'تتوقف بالإقفال وتبقى محفوظة بأساس الاحتفاظ', owner: ACCOUNT_OWNER, next: 'ما يحتاج شي: الإيقاف تلقائي بالقرار' }),
    item('client_approvers', 'معتمدو العميل على المشاريع', approvers, { blocking: false, why: 'تفويضهم يُسحب بالإقفال', owner: ACCOUNT_OWNER, next: 'ما يحتاج شي: السحب تلقائي بالقرار' })
  ];
}
const blockingOf = list => list.filter(i => i.blocking);
function refuseOpen(open, what) {
  refuse(409, 'offboarding_open_items', { what,
    missing: open.map(i => ({ document: `${i.title} (${i.count})`, why: i.refs.length ? `${i.why}: ${i.refs.slice(0, 5).join('، ')}` : i.why, owner: i.owner, owner_role: i.owner_role, doc_key: i.key })),
    next: open.map(i => i.next).join('؛ ') });
}

/* ───── ما يُحفظ وكم يُحفظ: من سجل حماية البيانات ───── */
// نشاط معالجة معتمد يغطي جدول العملاء، وإلا قاعدة احتفاظ فئتها بيانات العملاء. بلا شيء منهما: «ما انسجلت مدة»، ومالكها مسؤول الحماية.
export function retentionBasis(db, tenantId) {
  const activity = db.prepare("SELECT * FROM processing_activities WHERE tenant_id=? AND status='approved' AND (','||source_tables||',') LIKE '%,clients,%' ORDER BY approved_at DESC LIMIT 1").get(tenantId);
  if (activity && activity.retention_period.trim()) return { source: 'processing_activity', reference: activity.name, period: activity.retention_period, basis: activity.retention_source, confirmed_on: activity.retention_confirmed_on, disposal: activity.disposal_action };
  const rule = db.prepare("SELECT * FROM retention_rules WHERE tenant_id=? AND active=1 AND (data_category LIKE '%عملاء%' OR data_category LIKE '%عميل%') AND trim(retention_period)<>'' ORDER BY updated_at DESC LIMIT 1").get(tenantId);
  if (rule) return { source: 'retention_rule', reference: rule.data_category, period: rule.retention_period, basis: rule.retention_source, confirmed_on: rule.confirmed_on, disposal: rule.disposal_action };
  return { source: 'unset', reference: null, period: null, basis: null, confirmed_on: null, disposal: null, owner: PRIVACY,
    text: 'ما انسجلت في سجل حماية البيانات مدة احتفاظ لبيانات العملاء؛ الملف يبقى محفوظًا كاملًا ولا يُتلف منه شي' };
}

/* ───── من يقرأ ويطلب ويقرّ ───── */
function staff(db, supplied) {
  const u = actorOrRefuse(db, supplied);
  if (!['employee', 'manager', 'pm'].includes(u.role)) refuse(403, 'forbidden', { what: 'إقفال ملفات العملاء لفرق التشغيل',
    missing: [{ document: 'حساب موظف في فريق حساب العميل', why: 'الملف يقرؤه فريق حسابه وحده', owner: 'مسؤول المنصة', owner_role: 'admin' }], next: 'ادخل بحسابك الوظيفي' });
  return u;
}
function writing(db) {
  if (!db.isTransaction) refuse(409, 'transaction_required', { what: 'ما انكتب سجل الإقفال: الكتابة خارج معاملة قاعدة بيانات', next: 'نفّذ النداء داخل transaction(db,…)' });
}
const teamOf = (db, client) => [client.owner_id, ...db.prepare('SELECT user_id FROM client_members WHERE client_id=? AND removed_at IS NULL').all(client.id).map(r => r.user_id)];
const onTeam = (db, u, client) => teamOf(db, client).includes(u.id);
// المعتمد: حامل clients.manage نشط في الكيان غير الطالب. وللإقفال: من فريق الحساب، لأنه يقرأ الملف الذي يقرّ إقفاله.
function eligibleApprovers(db, tenantId, client, kind, requesterId) {
  const team = new Set(teamOf(db, client));
  return capabilityHolders(db, tenantId, 'clients.manage').filter(p => p.id !== requesterId && (kind !== 'close' || team.has(p.id))).map(p => ({ id: p.id, name: p.name }));
}
const recordView = (db, r) => ({ id: r.id, number: r.number, kind: r.kind, kind_name: KINDS[r.kind], status: r.status, status_name: STATUS[r.status], canonical: CANONICAL[r.status],
  reason: r.reason, assets_note: r.assets_note, checklist: JSON.parse(r.checklist), retention: JSON.parse(r.retention), version: r.version,
  requested_by_name: personName(db, r.requested_by), requested_at: r.requested_at, approver_id: r.approver_id, approver_name: personName(db, r.approver_id),
  decided_at: r.decided_at, decision_note: r.decision_note });
function recordActions(u, r) {
  if (r.status !== 'requested') return [];
  if (r.approver_id === u.id) return ['approve_offboarding', 'reject_offboarding'];
  if (r.requested_by === u.id) return ['withdraw_offboarding'];
  return [];
}

/* ───── لوحة الإقفال على ملف العميل (app/agency.mjs clientView) ───── */
export function offboardingPanel(db, u, client) {
  const records = db.prepare('SELECT * FROM client_offboardings WHERE client_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 20').all(client.id);
  const pending = records.find(r => r.status === 'requested') ?? null, owner = client.owner_id === u.id;
  const checklist = client.status === 'closed' ? [] : offboardingChecklist(db, u.tenant_id, client.id);
  // الطلب لمسؤول الحساب حين لا طلب معلّقًا؛ والإقفال لا يُعرض زره وفي القائمة ما يقفه — الشاشة تقول ما بقي وعند من.
  const actions = [];
  if (owner && !pending) {
    if (client.status === 'closed') actions.push('request_reopening');
    else if (!blockingOf(checklist).length) actions.push('request_offboarding');
  }
  return { closed: client.status === 'closed', checklist, blocking: blockingOf(checklist).length,
    current: client.offboarding_id ? recordView(db, records.find(r => r.id === client.offboarding_id) ?? db.prepare('SELECT * FROM client_offboardings WHERE id=?').get(client.offboarding_id)) : null,
    records: records.map(r => ({ ...recordView(db, r), actions: recordActions(u, r) })),
    approvers: actions.length ? eligibleApprovers(db, u.tenant_id, client, client.status === 'closed' ? 'reopen' : 'close', u.id) : [],
    retention: retentionBasis(db, u.tenant_id), actions };
}
// ما ينتظر قراري: سجلات إقفال أو إعادة فتح سمّاني طالبها معتمدًا. العنوان رقم السجل ونوعه ورمز العميل.
export function offboardingAwaiting(db, supplied) {
  const u = staff(db, supplied);
  return db.prepare("SELECT o.*,c.code,c.legal_name,c.trade_name FROM client_offboardings o JOIN clients c ON c.id=o.client_id WHERE o.tenant_id=? AND o.approver_id=? AND o.status='requested' ORDER BY o.requested_at").all(u.tenant_id, u.id)
    .map(r => ({ ...recordView(db, r), client: { id: r.client_id, code: r.code, name: r.trade_name || r.legal_name }, title: `${r.number} — ${KINDS[r.kind]} ${r.code}`, created_at: r.requested_at, actions: recordActions(u, r) }));
}

/* ───── الطلب ───── */
const number = (db, tenantId) => 'OFB-' + String(db.prepare("SELECT COALESCE(MAX(CAST(substr(number,5) AS INTEGER)),0)+1 AS n FROM client_offboardings WHERE tenant_id=? AND number LIKE 'OFB-%'").get(tenantId).n).padStart(4, '0');
export function requestOffboarding(db, supplied, clientId, input) {
  writing(db);
  const u = staff(db, supplied);
  v.object(input, ['kind', 'reason', 'assets_note', 'approver_id']);
  const client = typeof clientId === 'string' ? db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(clientId, u.tenant_id) : null;
  if (!client || !onTeam(db, u, client)) refuse(404, 'not_found', { what: 'ملف العميل مو متاح لك', next: 'الإقفال يطلبه مسؤول حساب العميل من ملفه في «العملاء»' });
  const kind = input.kind === 'reopen' ? 'reopen' : input.kind === 'close' ? 'close' : refuse(400, 'kind', { what: 'نوع السجل: إقفال أو إعادة فتح', next: 'اختر «إقفال ملف العميل» أو «إعادة فتح ملف العميل»' });
  if (client.owner_id !== u.id) refuse(403, 'not_permitted', { what: `${KINDS[kind]} يطلبه مسؤول الحساب`,
    missing: [{ document: 'مسؤول حساب العميل', why: 'هو حافظ الملف ومن يجيب عن ما بقي فيه', owner: personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager' }],
    next: 'اطلب من مسؤول الحساب يرفع الطلب' });
  if ((kind === 'close') === (client.status === 'closed')) refuse(409, 'offboarding_kind', { what: kind === 'close' ? `ملف العميل ${client.code} مقفل أصلًا` : `ملف العميل ${client.code} مو مقفل`,
    next: kind === 'close' ? 'إذا رجع العميل، اطلب إعادة فتح الملف' : 'الإقفال طلب ثاني من الملف نفسه' });
  const pending = db.prepare("SELECT number,approver_id FROM client_offboardings WHERE client_id=? AND status='requested'").get(client.id);
  if (pending) refuse(409, 'offboarding_pending', { what: `على الملف طلب قائم: ${pending.number}`,
    missing: [{ document: `قرار على ${pending.number}`, why: 'طلب واحد معلّق لكل عميل', owner: personName(db, pending.approver_id) ?? 'المعتمد المسمّى', owner_role: 'account_manager' }],
    next: 'انتظر القرار، أو اسحب الطلب القائم ثم ارفع غيره' });
  const checklist = kind === 'close' ? offboardingChecklist(db, u.tenant_id, client.id) : [];
  const open = blockingOf(checklist);
  if (open.length) refuseOpen(open, `ما ينقفل ملف العميل ${client.code}: فيه ما بقي مفتوحًا`);
  const brands = checklist.find(i => i.key === 'brand_assets')?.count ?? 0;
  const assets = input.assets_note ? v.text(input.assets_note, 'ما صار بملفات علامات العميل', 2000, 10) : '';
  if (kind === 'close' && brands && !assets) refuse(400, 'assets_note', { what: `للعميل ${brands} علامة عندنا، وطلب الإقفال يقول ما صار بملفاتها`,
    missing: [{ document: 'ملاحظة ما صار بملفات العلامات وأدلة الهوية', why: 'ملفات العميل عندنا؛ تُسلَّم أو تُؤرشف، ويُكتب أين', owner: personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager', doc_key: 'assets_note' }],
    next: 'اكتب الملاحظة وأعد الطلب' });
  const allowed = eligibleApprovers(db, u.tenant_id, client, kind, u.id);
  const approver = typeof input.approver_id === 'string' ? allowed.find(a => a.id === input.approver_id) : null;
  if (!approver) refuse(400, 'approver_id', { what: 'المعتمد لازم يحمل تصريح ملفات العملاء ويكون غيرك' + (kind === 'close' ? ' ومن فريق حساب العميل' : ''),
    missing: [{ document: 'معتمد يحمل clients.manage', why: allowed.length ? `المتاح: ${allowed.map(a => a.name).join('، ')}` : 'ما فيه أحد غيرك يحمله' + (kind === 'close' ? ' في فريق الحساب' : ''), owner: 'مسؤول الصلاحيات', owner_role: 'admin', doc_key: 'approver_id' }],
    next: allowed.length ? 'اختر المعتمد من القائمة' : 'اطلب من مسؤول الصلاحيات منح التصريح لزميل في فريق الحساب' });
  const id = randomUUID(), code = number(db, u.tenant_id), at = now();
  db.prepare("INSERT INTO client_offboardings(id,tenant_id,number,client_id,kind,reason,assets_note,checklist,status,requested_by,requested_at,approver_id) VALUES(?,?,?,?,?,?,?,?,'requested',?,?,?)")
    .run(id, u.tenant_id, code, client.id, kind, v.text(input.reason, kind === 'close' ? 'سبب إنهاء العلاقة' : 'سبب إعادة الفتح', 2000, 10), assets, JSON.stringify(checklist), u.id, at, approver.id);
  audit(db, u, 'client_offboarding', id, 'offboarding.requested', {}, { number: code, client_id: client.id, kind, approver_id: approver.id, checked: checklist.map(i => [i.key, i.count]) });
  notifyMany(db, [approver.id], u.id, { kind: 'client_offboarding_needed', subjectKind: 'client_offboarding', subjectId: id,
    title: `${KINDS[kind]} ${client.code} ينتظر قرارك: ${code}`, body: 'افتح «العملاء» واعتمد السجل أو ارفضه بسببه.' });
  return { id, number: code };
}

/* ───── القرار ───── */
const LABELS = { approve_offboarding: 'اعتماد', reject_offboarding: 'رفض', withdraw_offboarding: 'سحب الطلب' };
export function offboardingAction(db, supplied, recordId, action, input) {
  writing(db);
  const u = staff(db, supplied);
  if (!Object.hasOwn(LABELS, action)) refuse(404, 'action_unknown', { what: `«${String(action).slice(0, 40)}» مو من قرارات سجل الإقفال`, next: 'القرارات: اعتماد، رفض، سحب الطلب' });
  v.object(input, ['version', 'note']);
  const r = typeof recordId === 'string' ? db.prepare('SELECT * FROM client_offboardings WHERE id=? AND tenant_id=?').get(recordId, u.tenant_id) : null;
  if (!r || (r.approver_id !== u.id && r.requested_by !== u.id)) refuse(404, 'not_found', { what: 'سجل الإقفال مو متاح لك', next: 'السجل يقرّه معتمده المسمّى ويسحبه طالبه' });
  v.version(input.version, r.version);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(r.client_id);
  if (!recordActions(u, r).includes(action)) refuse(409, 'offboarding_transition', { what: `ما ينفع «${LABELS[action]}» على ${r.number} (${STATUS[r.status]})`,
    missing: r.status === 'requested' ? [{ document: LABELS[action], why: action === 'withdraw_offboarding' ? 'يسحبه طالبه' : 'يقرّه المعتمد المسمّى، وما يقرّ أحدٌ طلبه', owner: personName(db, action === 'withdraw_offboarding' ? r.requested_by : r.approver_id) ?? 'المعتمد المسمّى', owner_role: 'account_manager' }] : [],
    next: r.status === 'requested' ? 'اطلب من صاحب الخطوة ينفّذها' : 'السجل انحسم؛ الطلب الجديد يُرفع من الملف' });
  const at = now(), bump = (set, values) => {
    if (db.prepare(`UPDATE client_offboardings SET ${set},version=version+1 WHERE id=? AND version=?`).run(...values, r.id, r.version).changes !== 1)
      refuse(409, 'stale_version', { what: 'السجل تغيّر قبل ما ينحفظ قرارك', next: 'حدّث الصفحة وأعد المحاولة' });
  };
  if (action === 'withdraw_offboarding') {
    bump("status='withdrawn'", []);
    audit(db, u, 'client_offboarding', r.id, 'offboarding.withdrawn', { status: 'requested' }, { status: 'withdrawn' }, input.note ? v.text(input.note, 'سبب السحب', 1000) : '');
    return recordView(db, db.prepare('SELECT * FROM client_offboardings WHERE id=?').get(r.id));
  }
  // المعتمد يحمل التصريح لحظة القرار، لا لحظة تسميته فقط.
  if (!holds(db, u, 'clients.manage')) refuse(403, 'not_permitted', { what: `ما تقدر تقرّ ${r.number}: تصريح ملفات العملاء ما عاد معك`,
    missing: [{ document: 'تصريح clients.manage', why: 'إقفال ملف العميل وإعادة فتحه قرار حامله', owner: 'مسؤول الصلاحيات', owner_role: 'admin' }], next: 'يسحب الطالب الطلب ويسمّي معتمدًا يحمل التصريح' });
  const note = v.text(input.note, action === 'approve_offboarding' ? 'أساس الاعتماد: ما اطلعت عليه' : 'سبب الرفض', 2000, 5);
  if (action === 'reject_offboarding') {
    bump("status='rejected',decided_by=?,decided_at=?,decision_note=?", [u.id, at, note]);
    audit(db, u, 'client_offboarding', r.id, 'offboarding.rejected', { status: 'requested' }, { status: 'rejected' }, note);
    notifyMany(db, [r.requested_by], u.id, { kind: 'client_offboarding_decided', subjectKind: 'client_offboarding', subjectId: r.id, title: `انرفض ${r.number}: ${KINDS[r.kind]} ${client.code}`, body: 'السبب مكتوب في السجل على ملف العميل.' });
    return recordView(db, db.prepare('SELECT * FROM client_offboardings WHERE id=?').get(r.id));
  }
  const retention = retentionBasis(db, u.tenant_id), today = riyadhToday();
  let effects = {};
  if (r.kind === 'close') {
    // الفحص يُعاد لحظة القرار: ما فُتح بعد الطلب يقف القرار عليه.
    const open = blockingOf(offboardingChecklist(db, u.tenant_id, client.id, today));
    if (open.length) refuseOpen(open, `ما يُعتمد إقفال ${client.code}: انفتح شي بعد الطلب`);
    const members = db.prepare('SELECT user_id FROM client_members WHERE client_id=? AND removed_at IS NULL').all(client.id).map(m => m.user_id);
    const contacts = db.prepare('SELECT id FROM client_contacts WHERE client_id=? AND active=1').all(client.id).map(x => x.id);
    const brands = db.prepare('SELECT id FROM client_brands WHERE client_id=? AND active=1').all(client.id).map(x => x.id);
    const approvers = db.prepare("SELECT a.id,a.valid_from FROM client_approvers a JOIN commercial_cases k ON k.project_id=a.project_id WHERE k.client_id=? AND a.revoked_on IS NULL").all(client.id);
    effects = { members_removed: members, contacts_deactivated: contacts, brands_deactivated: brands, approvers_revoked: approvers.map(a => a.id) };
    bump("status='approved',decided_by=?,decided_at=?,decision_note=?,effects=?,retention=?", [u.id, at, note, JSON.stringify(effects), JSON.stringify(retention)]);
    db.prepare("UPDATE clients SET status='closed',offboarding_id=?,version=version+1,updated_at=? WHERE id=?").run(r.id, at, client.id);
    db.prepare('UPDATE client_members SET removed_at=? WHERE client_id=? AND removed_at IS NULL').run(at, client.id);
    db.prepare('UPDATE client_contacts SET active=0 WHERE client_id=? AND active=1').run(client.id);
    db.prepare('UPDATE client_brands SET active=0 WHERE client_id=? AND active=1').run(client.id);
    for (const a of approvers) db.prepare('UPDATE client_approvers SET revoked_on=?,revoked_by=?,revoke_reason=? WHERE id=? AND revoked_on IS NULL')
      .run(a.valid_from > today ? a.valid_from : today, u.id, `سُحب التفويض بإقفال ملف العميل ${client.code} (${r.number})`, a.id);
    audit(db, u, 'client', client.id, 'client.closed', { status: client.status, version: client.version }, { status: 'closed', version: client.version + 1, offboarding_id: r.id, ...effects });
  } else {
    // إعادة الفتح ترجع ما أوقفه آخر إقفال من جهات وعلامات؛ والفريق يضيفه المسؤول بقرار.
    const closing = client.offboarding_id ? db.prepare("SELECT effects FROM client_offboardings WHERE id=? AND kind='close'").get(client.offboarding_id) : null;
    const before = closing ? JSON.parse(closing.effects) : {};
    effects = { contacts_restored: before.contacts_deactivated ?? [], brands_restored: before.brands_deactivated ?? [] };
    bump("status='approved',decided_by=?,decided_at=?,decision_note=?,effects=?,retention=?", [u.id, at, note, JSON.stringify(effects), JSON.stringify(retention)]);
    db.prepare("UPDATE clients SET status='active',offboarding_id=?,version=version+1,updated_at=? WHERE id=?").run(r.id, at, client.id);
    for (const id of effects.contacts_restored) db.prepare('UPDATE client_contacts SET active=1 WHERE id=? AND client_id=?').run(id, client.id);
    for (const id of effects.brands_restored) db.prepare('UPDATE client_brands SET active=1 WHERE id=? AND client_id=?').run(id, client.id);
    audit(db, u, 'client', client.id, 'client.reopened', { status: client.status, version: client.version }, { status: 'active', version: client.version + 1, offboarding_id: r.id, ...effects });
  }
  audit(db, u, 'client_offboarding', r.id, 'offboarding.approved', { status: 'requested' }, { status: 'approved', kind: r.kind, retention_source: retention.source }, note);
  notifyMany(db, [r.requested_by], u.id, { kind: 'client_offboarding_decided', subjectKind: 'client_offboarding', subjectId: r.id, title: `انعتمد ${r.number}: ${KINDS[r.kind]} ${client.code}`, body: r.kind === 'close' ? 'الملف مقفل ومحفوظ، وفريق الحساب خرج منه.' : 'الملف مفتوح. أضف فريق الحساب من «العملاء».' });
  if (r.kind === 'close') notifyMany(db, effects.members_removed, u.id, { kind: 'client_access_ended', subjectKind: 'client_offboarding', subjectId: r.id, title: `انقفل ملف العميل ${client.code} وخرجت من فريقه`, body: 'ما يحتاج منك شي. سجل الإقفال عند مسؤول الحساب.' });
  return recordView(db, db.prepare('SELECT * FROM client_offboardings WHERE id=?').get(r.id));
}
