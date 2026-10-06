// الدعم بعد البيع (الحزمة 4، P4-CRM-5، الترحيل 184): بلاغ العميل وتصعيده سجلٌّ مربوط بالعميل والصفقة، وبمهلته.
//
// كل بلاغ له عميل وصفقة وساعة: يصل من العميل في لحظة (received_at)، ومنها تبدأ مهلة الرد الأول. والمهلة لا تخترعها المنصة:
// بند العقد المسجّل على الصفقة يقولها، وإلا القيمة المعتمدة crm.support_response_hours، وإلا تبقى «ما تحددت» وتقولها الشاشة
// كما هي (القرار D4 «كلاهما»: العقد يتجاوز، والافتراض فارغ حتى يُعتمد). الضمان مثلها: crm.warranty_days أو بند العقد.
// المسار: مسؤول الحساب يستلم البلاغ (أو من يسنده إليه) ← يسجّل أول رد ← يسجّل الحل ← يقرّه شخص ثانٍ في فريق الحساب ليس من سجّل الحل.
// نص البلاغ لا يدخل إشعارًا (PLT-10): الإشعار يقول إن بلاغًا وصلك ورقمه، والنص في شاشته.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { holds } from './access.mjs';
import { registerAdoption, adopted } from './options.mjs';
import { notifySubject, notifyMany, SUBJECT_LINKS } from './notices.mjs';
import { personName, personPlacement } from './people-read.mjs';
import { riyadhToday, riyadhDateOf } from './riyadh-time.mjs';
import { assertClientOpen } from './client-offboarding.mjs';

export const KINDS = Object.freeze({ complaint: 'شكوى أو ملاحظة عميل', escalation: 'تصعيد حساب عميل' });
export const SEVERITIES = Object.freeze({ high: 'عالية', medium: 'متوسطة', low: 'منخفضة' });
export const RISKS = Object.freeze({ churn: 'خطر فقد العميل', repeated_delay: 'تأخر متكرر', scope_dispute: 'خلاف على النطاق', late_payment: 'تأخر سداد' });
export const CHANNELS = Object.freeze({ email: 'بريد', phone: 'اتصال', meeting: 'اجتماع', message: 'رسالة', other: 'قناة ثانية' });
export const RESOLUTIONS = Object.freeze({ fixed: 'انصلح', warranty_fix: 'انصلح ضمن الضمان', change_request: 'طلب تغيير على النطاق', explained: 'وضّحنا للعميل', no_fault: 'ما فيه خلل من جهتنا' });
// حالة البلاغ بعبارة الوحدة، ومعها الحالة الموحدة التي ترسم بها الشاشة شارتها (app/static/vocabulary.mjs).
export const STATUS = Object.freeze({ open: 'ينتظر أول رد', responded: 'قيد المعالجة', resolved: 'ينتظر إقرار الحل', closed: 'مقفل' });
// المفتوح عند مسؤوله قيد التنفيذ (ينتظر أول رد)، والحل المسجَّل ينتظر اعتماد شخص ثانٍ، والمقفل مكتمل.
const CANONICAL = Object.freeze({ open: 'in_progress', responded: 'in_progress', resolved: 'pending', closed: 'completed' });
const EVENTS = Object.freeze({ opened: 'انفتح البلاغ', responded: 'أول رد للعميل', resolved: 'تسجيل الحل', returned: 'رجع الحل للمعالجة', closed: 'إقرار الحل وإقفال البلاغ', reassigned: 'انتقل البلاغ لمسؤول ثاني' });
const SOURCES = Object.freeze({ contract: 'بند العقد', adopted: 'القيمة المعتمدة', unset: 'ما تحددت' });
const CONTRACTED = ['contracted', 'project_active'];
const ACCOUNT_OWNER = 'مسؤول الحساب في فريق العميل';
const CLIENTS_OWNER = 'مسؤول ملفات العملاء — من يحمل تصريح clients.manage';

// الإشعار يفتح «دعم العملاء». بلا هذا السطر يُسقط حارس notifySubject إشعارات البلاغ بصمت.
Object.assign(SUBJECT_LINKS, { client_support_case: '#client-support' });

/* ───── القيمتان اللتان يملكهما المالك ───── */
// مهلة الرد الأول بالساعات وأيام الضمان: رقمان بلا قياس، فما تخترعهما المنصة. مسجّلتان بلا قيمة حتى يقرّهما حامل
// clients.manage ويعتمدهما شخص ثانٍ (options.adoptionAction). والشكل كائنٌ لأن واصف القيمة لا يقبل null رقمًا.
export const SUPPORT_RESPONSE_HOURS = 'crm.support_response_hours';
registerAdoption({ key: SUPPORT_RESPONSE_HOURS, label: 'مهلة الرد الأول على بلاغ العميل بالساعات', module: 'clients',
  owner: CLIENTS_OWNER, owner_role: 'account_manager', manage_capability: 'clients.manage',
  governance: 'managed', shape: 'object', default: { hours: null },
  basis: 'ما قرّرها أحد بعد، والمنصة ما تخترع مهلة: حتى تُعتمد ما للبلاغ موعد رد إلا إذا قاله بند العقد المسجّل على الصفقة. القيمة {"hours": عدد صحيح من 1 إلى 2160} تُحسب من لحظة وصول البلاغ من العميل' });
export const WARRANTY_DAYS = 'crm.warranty_days';
registerAdoption({ key: WARRANTY_DAYS, label: 'أيام الضمان بعد قبول المخرج', module: 'clients',
  owner: CLIENTS_OWNER, owner_role: 'account_manager', manage_capability: 'clients.manage',
  governance: 'managed', shape: 'object', default: { days: null },
  basis: 'ما قرّرها أحد بعد، والمنصة ما تخترع ضمانًا: حتى تُعتمد ما يُقال عن بلاغ إنه داخل الضمان إلا إذا قاله بند العقد المسجّل على الصفقة. القيمة {"days": عدد صحيح من 0 إلى 3650} تُحسب من آخر قبول مخرج على الصفقة' });

const hoursOf = value => Number.isInteger(value?.hours) && value.hours >= 1 && value.hours <= 2160 ? value.hours : null;
const daysOf = value => Number.isInteger(value?.days) && value.days >= 0 && value.days <= 3650 ? value.days : null;
const plusDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/* ───── من يقرأ ويكتب ───── */
function staff(db, supplied) {
  const u = actorOrRefuse(db, supplied);
  if (!['employee', 'manager', 'pm'].includes(u.role)) refuse(403, 'forbidden', { what: 'دعم العملاء لفرق التشغيل',
    missing: [{ document: 'حساب موظف في فريق حساب عميل', why: 'البلاغ يقرؤه فريق حساب العميل وحده', owner: 'مسؤول المنصة', owner_role: 'admin' }],
    next: 'ادخل بحسابك الوظيفي، أو اطلب من مسؤول الحساب يضيفك لفريقه' });
  return u;
}
function writing(db) {
  if (!db.isTransaction) refuse(409, 'transaction_required', { what: 'ما انكتب البلاغ: الكتابة خارج معاملة قاعدة بيانات', next: 'نفّذ النداء داخل transaction(db,…)' });
}
// فريق حساب العميل: مسؤوله وأعضاؤه الحاليون. عزل الحسابات نفسه في app/agency.mjs: من ليس في الفريق لا يرى البلاغ.
const memberOf = (db, u, clientId) => !!db.prepare('SELECT 1 FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL WHERE c.id=? AND c.tenant_id=? AND (c.owner_id=? OR m.user_id IS NOT NULL)').get(u.id, clientId, u.tenant_id, u.id);
const myClients = (db, u) => db.prepare('SELECT DISTINCT c.id,c.code,c.legal_name,c.trade_name,c.owner_id,c.status FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.removed_at IS NULL WHERE c.tenant_id=? AND (c.owner_id=? OR m.user_id=?) ORDER BY c.code').all(u.tenant_id, u.id, u.id);
const teamIds = (db, client) => [client.owner_id, ...db.prepare('SELECT user_id FROM client_members WHERE client_id=? AND removed_at IS NULL').all(client.id).map(r => r.user_id)];
function clientOf(db, u, clientId) {
  const c = typeof clientId === 'string' && db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(clientId, u.tenant_id);
  if (!c || !memberOf(db, u, c.id)) refuse(404, 'not_found', { what: 'ملف العميل مو متاح لك', next: 'البلاغ ينفتح على عميل أنت في فريق حسابه. اطلب من مسؤول الحساب يضيفك' });
  return c;
}
const clientName = c => c.trade_name || c.legal_name;
// يقرّ الحل غيرُ من سجّله: مسؤول الحساب، أو عضو في فريقه يحمل تصريح ملفات العملاء.
const canConfirm = (db, u, client, row) => row.resolved_by !== u.id && memberOf(db, u, client.id) && (client.owner_id === u.id || holds(db, u, 'clients.manage'));

/* ───── الساعة: من أين تأتي المهلة والضمان ───── */
// سجل العقد الساري المربوط بالصفقة (contract_records.case_id، الترحيل 184): بنده يتجاوز القيمة المعتمدة.
const contractFor = (db, tenantId, dealId) => dealId ? db.prepare("SELECT * FROM contract_records WHERE tenant_id=? AND case_id=? AND status='active'").get(tenantId, dealId) ?? null : null;
export function supportClock(db, tenantId, { dealId = null, at = now() } = {}) {
  const date = riyadhDateOf(at), contract = contractFor(db, tenantId, dealId);
  const hoursDecision = adopted(db, tenantId, SUPPORT_RESPONSE_HOURS, date), daysDecision = adopted(db, tenantId, WARRANTY_DAYS, date);
  const response = contract?.support_response_hours ? { hours: contract.support_response_hours, source: 'contract' }
    : hoursOf(hoursDecision.value) ? { hours: hoursOf(hoursDecision.value), source: 'adopted' } : { hours: null, source: 'unset' };
  const warranty = contract && contract.warranty_days !== null ? { days: contract.warranty_days, source: 'contract' }
    : daysOf(daysDecision.value) !== null ? { days: daysOf(daysDecision.value), source: 'adopted' } : { days: null, source: 'unset' };
  return { contract_id: (response.source === 'contract' || warranty.source === 'contract') ? contract.id : null, contract_number: contract?.number ?? null, response, warranty };
}
// آخر قبول مخرج على الصفقة (يوم رياض): منه يبدأ الضمان. بلا قبول ما بدأ ضمان.
const lastAcceptance = (db, dealId) => {
  const at = dealId ? db.prepare("SELECT MAX(decided_at) AS at FROM commercial_reviews WHERE case_id=? AND kind='delivery' AND status='approved'").get(dealId)?.at : null;
  return at ? riyadhDateOf(at) : null;
};
// اللحظة كما يكتبها النموذج: «2026-10-01T09:30» بتوقيت الرياض، أو طابع ISO كامل بمنطقته.
function instantOf(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text), zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text);
  const ms = local ? Date.parse(`${text}${text.length === 16 ? ':00' : ''}+03:00`) : zoned ? Date.parse(text) : NaN;
  if (!Number.isFinite(ms)) refuse(400, 'received_at', { what: `${label} مو مكتوبة صح`, next: 'اكتب اليوم والساعة اللي وصل فيها البلاغ، مثل 2026-10-01T09:30 بتوقيت الرياض' });
  return new Date(ms).toISOString();
}

/* ───── العرض ───── */
function clockView(row, at = now()) {
  if (!row.response_due_at) return { state: 'unset', source: row.response_source, source_name: SOURCES.unset, hours: null, due_at: null,
    text: 'ما تحددت مهلة رد: لا بند في عقد الصفقة يقولها ولا قيمة معتمدة لها' };
  const met = row.responded_at && row.responded_at <= row.response_due_at, late = row.responded_at ? !met : at > row.response_due_at;
  return { state: row.responded_at ? (met ? 'met' : 'missed') : (late ? 'late' : 'running'), source: row.response_source, source_name: SOURCES[row.response_source],
    hours: row.response_hours, due_at: row.response_due_at,
    text: row.responded_at ? (met ? 'انرد عليه داخل المهلة' : 'انرد عليه بعد المهلة') : (late ? 'فاتت مهلة الرد' : 'المهلة شغّالة') };
}
function warrantyView(row) {
  if (row.warranty_source === 'unset') return { state: 'unset', days: null, until: null, source_name: SOURCES.unset, text: 'ما تحددت مدة ضمان: لا بند في عقد الصفقة يقولها ولا قيمة معتمدة لها' };
  if (!row.warranty_until) return { state: 'not_started', days: row.warranty_days, until: null, source_name: SOURCES[row.warranty_source], text: 'الضمان ما بدأ: ما فيه مخرج مقبول على الصفقة' };
  const inside = riyadhDateOf(row.received_at) <= row.warranty_until;
  return { state: inside ? 'inside' : 'outside', days: row.warranty_days, until: row.warranty_until, source_name: SOURCES[row.warranty_source],
    text: inside ? 'البلاغ وصل داخل الضمان' : 'البلاغ وصل بعد نهاية الضمان' };
}
function actionsFor(db, u, client, row) {
  const out = [];
  if (row.status === 'closed') return out;
  if (row.handler_id === u.id && row.status === 'open') out.push('respond_case');
  if (row.handler_id === u.id && row.status === 'responded') out.push('resolve_case');
  if (row.status === 'resolved' && canConfirm(db, u, client, row)) out.push('confirm_resolution', 'return_resolution');
  if (client.owner_id === u.id) out.push('reassign_case');
  return out;
}
function caseView(db, u, row, client = db.prepare('SELECT * FROM clients WHERE id=?').get(row.client_id)) {
  const deal = row.case_id ? db.prepare('SELECT id,name,status FROM commercial_cases WHERE id=?').get(row.case_id) : null;
  const contract = row.contract_id ? db.prepare('SELECT id,number FROM contract_records WHERE id=?').get(row.contract_id) : null;
  return { id: row.id, number: row.number, version: row.version, kind: row.kind, kind_name: KINDS[row.kind], severity: row.severity, severity_name: SEVERITIES[row.severity],
    risk: row.risk, risk_name: row.risk ? RISKS[row.risk] : null, channel: row.channel, channel_name: CHANNELS[row.channel],
    client: { id: client.id, code: client.code, name: clientName(client), owner_name: personName(db, client.owner_id) },
    deal: deal ? { id: deal.id, ref: deal.id.replace(/-/g, '').slice(0, 8).toUpperCase(), name: deal.name, status: deal.status } : null,
    contract: contract ? { id: contract.id, number: contract.number } : null,
    received_at: row.received_at, statement: row.statement, proposed_action: row.proposed_action,
    status: row.status, status_name: STATUS[row.status], canonical: CANONICAL[row.status],
    handler_id: row.handler_id, handler_name: personName(db, row.handler_id), is_handler: row.handler_id === u.id,
    clock: clockView(row), warranty: warrantyView(row),
    response_note: row.response_note, responded_at: row.responded_at,
    resolution_kind: row.resolution_kind, resolution_name: row.resolution_kind ? RESOLUTIONS[row.resolution_kind] : null,
    resolution: row.resolution, resolution_evidence: row.resolution_evidence, resolved_at: row.resolved_at,
    closure_note: row.closure_note, closed_at: row.closed_at, created_at: row.created_at,
    history: db.prepare('SELECT action,actor_id,note,created_at FROM client_support_events WHERE support_case_id=? ORDER BY created_at,rowid').all(row.id)
      .map(h => ({ action: h.action, action_name: EVENTS[h.action], actor_name: personName(db, h.actor_id), note: h.note, created_at: h.created_at })),
    actions: actionsFor(db, u, client, row) };
}

/* ───── اللوحة ───── */
// ما ينتظر هذا القارئ: أول رد أو تسجيل حل على بلاغ مسند إليه، أو إقرار حل سجّله غيره. العنوان رقم البلاغ وعميله، لا نصه.
const WAITING = ['respond_case', 'resolve_case', 'confirm_resolution'];
export function supportAwaiting(db, supplied) {
  const u = staff(db, supplied), clients = myClients(db, u), out = [];
  for (const client of clients) for (const row of db.prepare("SELECT * FROM client_support_cases WHERE tenant_id=? AND client_id=? AND status<>'closed' ORDER BY received_at").all(u.tenant_id, client.id)) {
    const actions = actionsFor(db, u, client, row).filter(a => WAITING.includes(a));
    if (actions.length) out.push({ id: row.id, title: `${row.number} — ${KINDS[row.kind]} · ${client.code}`, created_at: row.received_at, due_date: row.response_due_at ? riyadhDateOf(row.response_due_at) : null, actions });
  }
  return out;
}
export function supportBoard(db, supplied) {
  const u = staff(db, supplied), clients = myClients(db, u), byId = new Map(clients.map(c => [c.id, c]));
  const rows = clients.length ? db.prepare(`SELECT * FROM client_support_cases WHERE tenant_id=? AND client_id IN (${clients.map(() => '?').join(',')}) ORDER BY status='closed',received_at DESC LIMIT 500`).all(u.tenant_id, ...clients.map(c => c.id)) : [];
  const cases = rows.map(r => caseView(db, u, r, byId.get(r.client_id)));
  const open = clients.filter(c => c.status !== 'closed');
  const deals = open.length ? db.prepare(`SELECT id,client_id,name,status FROM commercial_cases WHERE tenant_id=? AND client_id IN (${open.map(() => '?').join(',')}) AND status NOT IN ('lost','withdrawn') ORDER BY created_at DESC`).all(u.tenant_id, ...open.map(c => c.id)) : [];
  const clock = supportClock(db, u.tenant_id);
  return { today: riyadhToday(), user_id: u.id,
    kinds: KINDS, severities: SEVERITIES, risks: RISKS, channels: CHANNELS, resolutions: RESOLUTIONS, statuses: STATUS,
    clients: open.map(c => ({ id: c.id, code: c.code, name: clientName(c), owner_name: personName(db, c.owner_id),
      team: teamIds(db, c).filter((id, i, all) => all.indexOf(id) === i).map(id => ({ id, name: personName(db, id) })) })),
    deals: deals.map(d => ({ id: d.id, client_id: d.client_id, ref: d.id.replace(/-/g, '').slice(0, 8).toUpperCase(), name: d.name, status: d.status, after_sale: CONTRACTED.includes(d.status) })),
    defaults: { response: { ...clock.response, source_name: SOURCES[clock.response.source] }, warranty: { ...clock.warranty, source_name: SOURCES[clock.warranty.source] },
      owner: CLIENTS_OWNER },
    cases, awaiting_me: cases.filter(c => c.actions.some(a => WAITING.includes(a))).map(c => c.id),
    totals: { open: cases.filter(c => c.status !== 'closed').length, late: cases.filter(c => c.clock.state === 'late').length,
      awaiting_confirmation: cases.filter(c => c.status === 'resolved').length, closed: cases.filter(c => c.status === 'closed').length },
    can_open: open.length > 0 };
}

/* ───── فتح البلاغ ───── */
const number = (db, tenantId) => 'SC-' + String(db.prepare("SELECT COALESCE(MAX(CAST(substr(number,4) AS INTEGER)),0)+1 AS n FROM client_support_cases WHERE tenant_id=? AND number LIKE 'SC-%'").get(tenantId).n).padStart(4, '0');
function event(db, u, row, action, note = '') {
  db.prepare('INSERT INTO client_support_events(id,tenant_id,support_case_id,action,actor_id,note,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), u.tenant_id, row.id, action, u.id, note, now());
}
function pick(map, value, field, label) {
  if (!Object.hasOwn(map, value)) refuse(400, field, { what: `${label}: «${String(value ?? '').slice(0, 40)}» مو من القائمة`, next: `اختر واحد من: ${Object.values(map).join('، ')}` });
  return value;
}
export function openSupportCase(db, supplied, input) {
  writing(db);
  const u = staff(db, supplied);
  v.object(input, ['client_id', 'case_id', 'kind', 'severity', 'risk', 'channel', 'received_at', 'statement', 'proposed_action']);
  const client = clientOf(db, u, input.client_id);
  // P4-CRM-7: العميل المقفل ما ينفتح عليه شي جديد؛ رجوعه بسجل إعادة فتح يعتمده شخص ثانٍ.
  assertClientOpen(db, u.tenant_id, client.id, 'ما ينفتح بلاغ');
  const kind = pick(KINDS, input.kind, 'kind', 'نوع البلاغ'), severity = pick(SEVERITIES, input.severity, 'severity', 'الخطورة'), channel = pick(CHANNELS, input.channel, 'channel', 'القناة');
  const risk = kind === 'escalation' ? pick(RISKS, input.risk, 'risk', 'نوع الخطر') : null;
  if (kind === 'complaint' && input.risk !== undefined && input.risk !== null && input.risk !== '') refuse(400, 'risk', { what: 'نوع الخطر للتصعيد بس', next: 'احذف نوع الخطر من الشكوى، أو اختر «تصعيد حساب عميل»' });
  const receivedAt = instantOf(input.received_at, 'لحظة وصول البلاغ'), at = now();
  if (receivedAt > at) refuse(400, 'received_at', { what: 'لحظة وصول البلاغ في المستقبل', next: 'اكتب اليوم والساعة اللي وصل فيها البلاغ فعلًا' });
  // الصفقة: الشكوى بعد البيع على صفقة متعاقد عليها لهذا العميل؛ والتصعيد يقبل صفقة مفتوحة أو بلا صفقة.
  let deal = null;
  if (input.case_id !== undefined && input.case_id !== null && input.case_id !== '') {
    deal = typeof input.case_id === 'string' ? db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id, u.tenant_id) : null;
    if (!deal || deal.client_id !== client.id) refuse(409, 'deal_other_customer', { what: 'الصفقة لازم تكون صفقة لنفس العميل',
      missing: [{ document: `صفقة لعميل ${client.code}`, why: 'البلاغ يُقرأ على العميل وصفقته معًا', owner: personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager', doc_key: 'case_id' }],
      next: 'اختر الصفقة من صفقات العميل نفسه' });
    if (['lost', 'withdrawn'].includes(deal.status)) refuse(409, 'deal_closed', { what: 'الصفقة مقفلة (خسرناها أو سحبناها)، فما فيه بعد بيع عليها', next: 'سجّل البلاغ تصعيدًا على الحساب بلا صفقة، أو على صفقة قائمة' });
  }
  if (kind === 'complaint' && (!deal || !CONTRACTED.includes(deal.status))) refuse(409, 'after_sale_deal_required', { what: 'الشكوى بعد البيع تنكتب على صفقة متعاقد عليها',
    missing: [{ document: 'صفقة للعميل عليها اتفاق موثّق', why: 'الدعم بعد البيع يُقرأ على العمل اللي اتفقنا عليه', owner: deal ? personName(db, deal.owner_id) ?? ACCOUNT_OWNER : personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager', doc_key: 'case_id' }],
    next: 'اختر الصفقة المتعاقد عليها. وإذا البلاغ عن العلاقة كلها، سجّله «تصعيد حساب عميل»' });
  const clock = supportClock(db, u.tenant_id, { dealId: deal?.id ?? null, at: receivedAt });
  const accepted = deal ? lastAcceptance(db, deal.id) : null;
  const dueAt = clock.response.hours ? new Date(Date.parse(receivedAt) + clock.response.hours * 3600000).toISOString() : null;
  const warrantyUntil = clock.warranty.days !== null && accepted ? plusDays(accepted, clock.warranty.days) : null;
  const statement = v.text(input.statement, 'نص البلاغ كما قاله العميل', 5000, 10);
  const proposed = input.proposed_action ? v.text(input.proposed_action, 'الإجراء المقترح', 3000, 5) : '';
  // المسؤول عن البلاغ: مسؤول حساب العميل، وهو من ينقله لعضو آخر في فريقه إن لزم.
  const handler = personPlacement(db, u.tenant_id, client.owner_id);
  if (!handler?.active) refuse(409, 'handler_unavailable', { what: `مسؤول حساب العميل ${client.code} حسابه موقوف، فما فيه من يستلم البلاغ`,
    missing: [{ document: 'مسؤول حساب نشط للعميل', why: 'البلاغ يُسند لمسؤول الحساب أول ما يوصل', owner: CLIENTS_OWNER, owner_role: 'account_manager' }],
    next: 'انقل ملف العميل لمسؤول حساب نشط، ثم سجّل البلاغ' });
  const id = randomUUID(), code = number(db, u.tenant_id);
  db.prepare(`INSERT INTO client_support_cases(id,tenant_id,number,client_id,case_id,contract_id,kind,severity,risk,channel,received_at,statement,proposed_action,
      response_hours,response_source,response_due_at,warranty_days,warranty_source,warranty_until,handler_id,status,opened_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`)
    .run(id, u.tenant_id, code, client.id, deal?.id ?? null, clock.contract_id, kind, severity, risk, channel, receivedAt, statement, proposed,
      clock.response.hours, clock.response.source, dueAt, clock.warranty.days, clock.warranty.source, warrantyUntil, handler.id, u.id, at, at);
  const row = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(id);
  event(db, u, row, 'opened');
  audit(db, u, 'client_support_case', id, 'support.opened', {}, { number: code, client_id: client.id, case_id: deal?.id ?? null, kind, severity,
    response_source: clock.response.source, response_hours: clock.response.hours, response_due_at: dueAt, warranty_source: clock.warranty.source, warranty_until: warrantyUntil, contract_id: clock.contract_id });
  notifyMany(db, [handler.id], u.id, { kind: 'support_case_assigned', subjectKind: 'client_support_case', subjectId: id, category: 'approvals',
    title: `بلاغ عميل وصلك: ${code}`, body: dueAt ? 'افتحه من «دعم العملاء» وسجّل أول رد قبل موعده. نصه ما يظهر هنا.' : 'افتحه من «دعم العملاء» وسجّل أول رد. نصه ما يظهر هنا.' });
  return { id, number: code };
}

/* ───── خطوات البلاغ ───── */
const FIELDS = { respond_case: ['version', 'note'], resolve_case: ['version', 'resolution_kind', 'resolution', 'evidence'], confirm_resolution: ['version', 'note'],
  return_resolution: ['version', 'note'], reassign_case: ['version', 'handler_id', 'note'] };
const ACTION_NAMES = { respond_case: 'أول رد', resolve_case: 'تسجيل الحل', confirm_resolution: 'إقرار الحل', return_resolution: 'إرجاع الحل للمعالجة', reassign_case: 'نقل البلاغ' };
export function supportAction(db, supplied, caseId, action, input) {
  writing(db);
  const u = staff(db, supplied);
  if (!Object.hasOwn(FIELDS, action)) refuse(404, 'action_unknown', { what: `«${String(action).slice(0, 40)}» مو من خطوات البلاغ`, next: `الخطوات: ${Object.values(ACTION_NAMES).join('، ')}` });
  v.object(input, FIELDS[action]);
  const row = typeof caseId === 'string' && db.prepare('SELECT * FROM client_support_cases WHERE id=? AND tenant_id=?').get(caseId, u.tenant_id);
  if (!row || !memberOf(db, u, row.client_id)) refuse(404, 'not_found', { what: 'البلاغ مو متاح لك', next: 'البلاغ يقرؤه فريق حساب عميله بس' });
  v.version(input.version, row.version);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(row.client_id), allowed = actionsFor(db, u, client, row);
  if (!allowed.includes(action)) {
    const who = row.status === 'resolved' ? 'يقرّه مسؤول الحساب أو عضو في فريقه يحمل تصريح ملفات العملاء، غير اللي سجّل الحل'
      : action === 'reassign_case' ? 'ينقله مسؤول حساب العميل' : `الخطوة على ${personName(db, row.handler_id) ?? 'مسؤول البلاغ'}`;
    refuse(409, 'support_transition', { what: `ما ينفع «${ACTION_NAMES[action]}» على البلاغ ${row.number} الحين (${STATUS[row.status]})`,
      missing: [{ document: ACTION_NAMES[action], why: who, owner: row.status === 'resolved' ? personName(db, client.owner_id) ?? ACCOUNT_OWNER : personName(db, row.handler_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager' }],
      next: allowed.length ? `المتاح لك الحين: ${allowed.map(a => ACTION_NAMES[a]).join('، ')}` : 'حدّث الصفحة وشوف وين وصل البلاغ' });
  }
  const at = now(), bump = (set, values) => {
    const changed = db.prepare(`UPDATE client_support_cases SET ${set},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values, at, row.id, row.version).changes;
    if (changed !== 1) refuse(409, 'stale_version', { what: 'البلاغ تغيّر قبل ما تنحفظ خطوتك', next: 'حدّث الصفحة وأعد المحاولة' });
  };
  let after = {}, note = '';
  if (action === 'respond_case') {
    note = v.text(input.note, 'أول رد: وش قلنا للعميل وكيف', 3000, 10);
    bump("status='responded',responded_at=?,responded_by=?,response_note=?", [at, u.id, note]);
    after = { status: 'responded', responded_at: at, within_clock: row.response_due_at ? at <= row.response_due_at : null };
  } else if (action === 'resolve_case') {
    const kind = pick(RESOLUTIONS, input.resolution_kind, 'resolution_kind', 'نوع الحل');
    // «ضمن الضمان» يعني إصلاحًا بلا مقابل: يُقال فقط إذا الضمان معروف المدة والبلاغ وصل داخله.
    const warranty = warrantyView(row);
    if (kind === 'warranty_fix' && warranty.state !== 'inside') refuse(409, 'outside_warranty', { what: `ما ينقال «انصلح ضمن الضمان» على البلاغ ${row.number}: ${warranty.text}`,
      missing: warranty.state === 'unset' ? [{ document: 'مدة ضمان من بند العقد أو قيمة معتمدة (crm.warranty_days)', why: 'المنصة ما تخترع ضمانًا', owner: CLIENTS_OWNER, owner_role: 'account_manager' }] : [],
      next: 'اختر «طلب تغيير على النطاق» إذا الإصلاح بمقابل، أو «انصلح» إذا ما يمس الضمان' });
    note = v.text(input.resolution, 'الحل: وش انعمل', 3000, 10);
    const evidence = v.text(input.evidence, 'دليل الحل ومكان حفظه', 3000, 10);
    bump("status='resolved',resolution_kind=?,resolution=?,resolution_evidence=?,resolved_at=?,resolved_by=?", [kind, note, evidence, at, u.id]);
    after = { status: 'resolved', resolution_kind: kind };
  } else if (action === 'confirm_resolution') {
    note = v.text(input.note, 'إقرارك بالحل: وش اطلعت عليه', 2000, 5);
    bump("status='closed',closed_at=?,closed_by=?,closure_note=?", [at, u.id, note]);
    after = { status: 'closed' };
  } else if (action === 'return_resolution') {
    note = v.text(input.note, 'ليش يرجع الحل للمعالجة', 2000, 10);
    bump("status='responded',resolution_kind=NULL,resolution='',resolution_evidence='',resolved_at=NULL,resolved_by=NULL", []);
    after = { status: 'responded', returned: true };
  } else {
    const handler = typeof input.handler_id === 'string' ? personPlacement(db, u.tenant_id, input.handler_id) : null;
    if (!handler?.active || !teamIds(db, client).includes(handler.id)) refuse(400, 'handler_id', { what: 'المسؤول الجديد لازم يكون في فريق حساب العميل وحسابه نشط',
      missing: [{ document: 'عضو نشط في فريق الحساب', why: 'البلاغ يقرؤه فريق حساب عميله بس', owner: personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager' }],
      next: 'أضفه لفريق الحساب من «العملاء» أولًا، أو اختر عضوًا قائمًا' });
    if (handler.id === row.handler_id) refuse(409, 'same_handler', { what: 'البلاغ عند هذا المسؤول أصلًا', next: 'اختر عضوًا ثانيًا في فريق الحساب' });
    note = v.text(input.note, 'سبب النقل', 1000, 5);
    bump('handler_id=?', [handler.id]);
    after = { handler_id: handler.id };
  }
  const updated = db.prepare('SELECT * FROM client_support_cases WHERE id=?').get(row.id);
  const kind = { respond_case: 'responded', resolve_case: 'resolved', confirm_resolution: 'closed', return_resolution: 'returned', reassign_case: 'reassigned' }[action];
  // نص الحل يبقى في سجل الأحداث حتى لو رجع للمعالجة ونُظّف من الصف.
  event(db, u, updated, kind, note);
  audit(db, u, 'client_support_case', row.id, 'support.' + kind, { status: row.status, version: row.version, handler_id: row.handler_id }, { ...after, version: row.version + 1 }, note);
  // من عليه الخطوة التالية يُبلَّغ؛ نص البلاغ وحلّه في الشاشة لا في الإشعار.
  if (action === 'resolve_case') {
    const confirmers = teamIds(db, client).filter((id, i, all) => all.indexOf(id) === i && id !== u.id)
      .filter(id => { const p = personPlacement(db, u.tenant_id, id); return p?.active && (id === client.owner_id || holds(db, p, 'clients.manage')); });
    notifyMany(db, confirmers, u.id, { kind: 'support_resolution_awaiting', subjectKind: 'client_support_case', subjectId: row.id, category: 'approvals',
      title: `حل بلاغ ${row.number} ينتظر إقرارك`, body: 'افتح «دعم العملاء»: أقرّ الحل أو رجّعه للمعالجة بسببه.' });
  }
  if (action === 'return_resolution') notifyMany(db, [row.handler_id], u.id, { kind: 'support_resolution_returned', subjectKind: 'client_support_case', subjectId: row.id, category: 'approvals',
    title: `حل بلاغ ${row.number} رجع لك`, body: 'السبب مكتوب في البلاغ. افتحه من «دعم العملاء» وسجّل الحل من جديد.' });
  if (action === 'reassign_case') notifyMany(db, [after.handler_id], u.id, { kind: 'support_case_assigned', subjectKind: 'client_support_case', subjectId: row.id, category: 'approvals',
    title: `بلاغ عميل انتقل لك: ${row.number}`, body: 'افتحه من «دعم العملاء» وكمّل خطوته. نصه ما يظهر هنا.' });
  if (action === 'confirm_resolution') notifyMany(db, [row.handler_id, row.opened_by], u.id, { kind: 'support_case_closed', subjectKind: 'client_support_case', subjectId: row.id,
    title: `انقفل بلاغ العميل ${row.number}`, body: 'الحل انقرّ، والبلاغ وسجله في «دعم العملاء».' });
  return caseView(db, u, updated, client);
}

/* ───── ما يقرؤه غير هذه الشاشة ───── */
// البلاغات المفتوحة على عميل: يقرؤها فحص إقفال ملف العميل (P4-CRM-7) بلا قيد عضوية، فهو يقرأ للعميل كله.
export const openSupportCases = (db, tenantId, clientId) => db.prepare("SELECT id,number,status,handler_id FROM client_support_cases WHERE tenant_id=? AND client_id=? AND status<>'closed' ORDER BY received_at").all(tenantId, clientId);
// تاريخ ما بعد البيع على ملف العميل (app/agency.mjs clientView): رقم البلاغ ونوعه وحالته وصفقته، بلا نص العميل.
export const supportOnClient = (db, clientId) => db.prepare('SELECT id,number,kind,status,case_id,received_at FROM client_support_cases WHERE client_id=? ORDER BY received_at DESC LIMIT 50').all(clientId)
  .map(r => ({ id: r.id, number: r.number, kind: r.kind, kind_name: KINDS[r.kind], status: r.status, status_name: STATUS[r.status], case_id: r.case_id, received_at: r.received_at }));
