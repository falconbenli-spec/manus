#!/usr/bin/env node
// مسح دليل الخدمات طلبًا بطلب: كل بطاقة تُنشأ وتُقدَّم وتمشي مسار اعتمادها ثم تُنفَّذ وتُغلق، على نسخة مؤقتة
// بقاعدة بيانات مصطنعة تُحذف في النهاية. لا يمس هذا الملف قاعدة العمل ولا .env ولا المنافذ 3600/3601/3630.
//
// التشغيل:
//   node scripts/qa-catalog-sweep.mjs                      # الوضعان: كما تُسلَّم المنصة، ثم مفعّلة بالكامل
//   node scripts/qa-catalog-sweep.mjs --mode=ships         # وضع واحد
//   node scripts/qa-catalog-sweep.mjs --only=HR-SALARY-CERT,IT-ACCESS
//   node scripts/qa-catalog-sweep.mjs --port=3730 --out=work/qa/catalog-sweep
//
// «كما تُسلَّم» = لا مقترح سياسة متبنى، ولا مصفوفة أولوية، ولا مهلة إعادة فتح، ولا حد اعتماد.
// «مفعّلة بالكامل» = كل مقترحات policyProposals متبناة داخل القاعدة المصطنعة، ومصفوفة الأولوية معرّفة،
//                    ومهلة إعادة الفتح محددة، وحدود الاعتماد المعرَّفة في الكتالوج مقترحة ومعتمدة.
// كلمة المرور المصطنعة عشوائية ولا تُطبع أبدًا؛ رموز الجلسات تُكتب في ملف 0600 داخل المجلد المؤقت.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORBIDDEN_PORTS = new Set([3600, 3601, 3630]);

// ── توليد قيم صالحة من تعريف الحقل نفسه ───────────────────────────────────────
// كل نص حر يحمل «تجريبي» حتى لا يُخلط ما ولّده المسح ببيانات حقيقية.
const MARK = 'تجريبي';
const pad2 = n => String(n).padStart(2, '0');
const shift = days => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
// حقول تاريخ يقتضي معناها الماضي: تاريخ مصروف، تاريخ واقعة، تاريخ ميلاد الوثيقة.
const PAST_DATE_KEYS = /(expense|incident|issue|from|start|hire|birth|last_)/;
const FUTURE_DATE_KEYS = /(expiry|expire|until|renewal|end|to_date|due|delivery|deadline)/;

function patternValue(field) {
  const p = field.pattern;
  if (!p) return null;
  if (p === '^([01]\\d|2[0-3]):[0-5]\\d$') return field.key.includes('to') ? '17:00' : '09:00';
  if (p === '^\\d{4}-(0[1-9]|1[0-2])$') return shift(0).slice(0, 7);
  if (p === '^\\d{4}$') return shift(0).slice(0, 4);
  return null;
}

function textValue(field) {
  const min = field.min_length ?? 1;
  const max = field.max_length ?? 3000;
  const base = field.type === 'textarea'
    ? `${MARK} — نص مولَّد آليًا لاختبار الخدمة «${field.label}»، ولا يحمل بيانات شخص حقيقي.`
    : `${MARK} ${field.label}`;
  let value = base;
  while (value.length < min) value += ` ${MARK}`;
  if (value.length > max) value = value.slice(0, max).trim();
  // القص قد يهبط بالقيمة تحت الحد الأدنى حين يكون السقف أضيق منه؛ عندها نملأ بحروف عربية بسيطة.
  while (value.length < min) value += 'ـ';
  return value;
}

export function valueFor(field) {
  if (field.type === 'select') {
    // «بدل فاقد» و«استئذان» و«تأخير بعذر» خيارات تحوّل الطلب إلى مسار آخر؛ يُختار غيرها ما وُجد،
    // ويُجرَّب المسار المحوَّل في اختبار منفصل لا في المسار العام.
    const avoid = ['بدل فاقد', 'استئذان', 'تأخير بعذر'];
    return field.options.find(o => !avoid.includes(o)) ?? field.options[0];
  }
  if (field.type === 'date') {
    if (FUTURE_DATE_KEYS.test(field.key)) return shift(30);
    if (PAST_DATE_KEYS.test(field.key)) return shift(-3);
    return shift(7);
  }
  if (field.type === 'number') {
    const max = field.max_length ?? 3000;
    return max < 8 ? '1500' : '1500.00';
  }
  const fromPattern = patternValue(field);
  return fromPattern ?? textValue(field);
}

// شرط الظهور يُقرأ من نموذج الكتالوج (fieldModel) لا من النسخة المخزنة، لأن coreField يجرده منه.
function visible(field, payload, fields) {
  const rule = field?.show_when;
  if (!rule || typeof rule !== 'object' || typeof rule.field !== 'string') return true;
  if (!fields.some(f => f.key === rule.field)) return true;
  const expected = Array.isArray(rule.equals) ? rule.equals : [rule.equals];
  return expected.includes(payload?.[rule.field]);
}

// يولّد حمولة صالحة كاملة لحقول الخدمة، مرتين: مرة لتثبيت قيم الاختيار، ومرة لحقول تظهر بناءً عليها.
export function generatePayload(fields) {
  const payload = {};
  for (const field of fields) if (field.type === 'select') payload[field.key] = valueFor(field);
  for (const field of fields) {
    if (field.type === 'select') continue;
    if (!visible(field, payload, fields)) continue;
    payload[field.key] = valueFor(field);
  }
  // قاعدة validatePayload: النهاية لا تسبق البداية.
  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) payload.end_date = payload.start_date;
  if (payload.from_date && payload.to_date && payload.to_date < payload.from_date) payload.to_date = payload.from_date;
  return payload;
}

// حقول مخفية أو غير مرئية تُحذف قبل الإرسال حتى لا يرفضها validatePayload بـ invalid_fields.
export function payloadForStored(storedFields, modelFields) {
  const model = modelFields ?? storedFields;
  const full = generatePayload(model);
  const allowed = new Set(storedFields.map(f => f.key));
  return Object.fromEntries(Object.entries(full).filter(([k]) => allowed.has(k)));
}

// ── عميل HTTP بسيط بجلسة لكل حساب ────────────────────────────────────────────
class Client {
  constructor(base) { this.base = base; this.sessions = new Map(); this.password = null; }
  async login(username) {
    if (this.sessions.has(username)) return this.sessions.get(username);
    let res = null, lastError = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try {
        res = await fetch(`${this.base}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: this.password })
        });
      } catch (error) { lastError = error; await new Promise(ok => setTimeout(ok, 25 * (attempt + 1))); }
    }
    if (!res) throw new Error(`login ${username}: ${String(lastError?.cause?.code ?? lastError?.message)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(`login ${username}: ${res.status} ${JSON.stringify(body)}`);
    const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('session='));
    const session = { cookie, csrf: body.csrf, user: body.user };
    this.sessions.set(username, session);
    return session;
  }
  async call(username, method, path, body, extra = {}) {
    const s = await this.login(username);
    const headers = { Cookie: s.cookie, ...extra };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
    if (method !== 'GET') headers['X-CSRF-Token'] = s.csrf;
    // إعادة المحاولة مرة واحدة على انقطاع الاتصال: خادم محلي يُغلق اتصالًا مُبقى أحيانًا بين طلبين.
    let res = null, lastError = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch (error) { lastError = error; await new Promise(ok => setTimeout(ok, 25 * (attempt + 1))); }
    }
    if (!res) return { status: 0, ok: false, body: { error: { code: 'network_error', message: String(lastError?.cause?.code ?? lastError?.message ?? lastError) } } };
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: parsed, ok: res.ok };
  }
  get(u, p) { return this.call(u, 'GET', p); }
  post(u, p, b, key) { return this.call(u, 'POST', p, b, key ? { 'Idempotency-Key': key } : {}); }
  patch(u, p, b) { return this.call(u, 'PATCH', p, b); }
}

const idemKey = () => randomBytes(12).toString('hex');
// بوابة الاستقبال تمنع التقديم بلا أثر وعجلة متى عُرِّفت المصفوفة؛ تُستكمل هنا لكل طلب في الوضع المفعّل.
async function ensureIntake(client, mode, who, requestId) {
  if (mode !== 'enabled') return null;
  return client.post(who, `/api/requests/${requestId}/intake`,
    { impact_code: 'medium', urgency_code: 'soon', justification: `${MARK}: مبرر مولَّد آليًا لاستكمال بوابة الاستقبال في المسح.` });
}
const errorOf = r => r.body?.error?.code ?? (r.ok ? null : `http_${r.status}`);
const messageOf = r => r.body?.error?.message ?? '';

// ── تهيئة النسخة المؤقتة ─────────────────────────────────────────────────────
async function boot(port) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-catalog-sweep-'));
  process.env.FIELD_KEY_PATH = join(dir, 'field.key');
  writeFileSync(process.env.FIELD_KEY_PATH, randomBytes(32), { mode: 0o600 });
  const { openDb, transaction } = await import(`${ROOT}/app/db.mjs`);
  const { passwordHash } = await import(`${ROOT}/app/auth.mjs`);
  const { createApp } = await import(`${ROOT}/app/server.mjs`);
  const { seed } = await import(`${ROOT}/scripts/seed.mjs`);
  const catalogModule = await import(`${ROOT}/app/service-catalog.mjs`);

  const dbPath = join(dir, 'synthetic.sqlite');
  const db = openDb(dbPath);
  seed(db, randomBytes(32).toString('base64url'));
  catalogModule.installServiceCatalog(db);

  // كلمة مرور واحدة عشوائية لكل الحسابات المصطنعة، لا تُطبع ولا تُكتب في أي مخرج.
  const password = randomBytes(24).toString('base64url');
  const digest = passwordHash(password);
  db.prepare("UPDATE users SET password_hash=?,must_change_password=0 WHERE tenant_id='36t'").run(digest);

  // ── صاحب طلب من داخل الإدارة المنفذة ────────────────────────────────────────
  // المسح كان يمشي كل خدمة بصاحب طلب واحد خارج الإدارات كلها (employee في الفريق الإبداعي)، فلم يمشِ قط
  // الحالةَ التي تُصعَّد فيها خطوة الاعتماد المكررة إلى مرجع تصعيد الإدارة فيصير المرجعُ معتمِدًا. أعادت
  // مراجعةٌ مستقلة القياسَ بصاحب طلب من الداخل فوقفت أربع خدمات مال ومشتريات عند no_executor. صار المسح
  // يبذر موظفًا في كل إدارة يتبع مديرها، فيمشي المسارَ الذي كشف العطب بدل أن يعمى عنه.
  const insiders = {};
  transaction(db, () => {
    for (const d of catalogModule.companyDepartments) {
      if (d.id === 'ops') continue;
      const lead = db.prepare("SELECT id FROM users WHERE tenant_id='36t' AND department_id=? AND role='manager' AND active=1 ORDER BY id LIMIT 1").get(d.id);
      if (!lead) continue;
      const id = `insider.${d.id}`;
      db.prepare(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,active,must_change_password)
        VALUES(?,'36t',?,?,?,?,'employee',?,1,0)`).run(id, d.id, id, `موظف مسح ${d.name}`, digest, lead.id);
      insiders[d.id] = id;
    }
  });

  const server = createApp(db, {});
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });

  const client = new Client(`http://127.0.0.1:${port}`);
  client.password = password;
  return { dir, dbPath, db, server, client, transaction, catalogModule, insiders };
}

async function shutdown(ctx, keep) {
  await new Promise(ok => ctx.server.close(ok));
  ctx.db.close();
  if (!keep) rmSync(ctx.dir, { recursive: true, force: true });
  return keep ? ctx.dir : null;
}

// ── تفعيل ما هو معلّق على قرار المالك، داخل القاعدة المصطنعة وحدها ─────────────
const BASIS = 'تفعيل مصطنع داخل نسخة اختبار مؤقتة بتاريخ المسح، لقياس أثر القرار المعلّق. ليس قرار مالك إجراء.';

// نائب مرشّح لخدمة: حساب نشط لا يدير المنصة، من إدارة غير الإدارة المنفذة، وليس مرجع تصعيد لأحد
// (فمرجع التصعيد يعتمد الخطوة التنفيذية في بعض المسارات، فيمنعه فصل المهام نفسه عن التنفيذ).
// النائب المنفّذ له مجال: قطاع الإدارة المنفذة نفسه، ودورٌ ينفّذ الخدمة أو رئاسةُ إدارة. المسح يختار
// من داخل هذا المجال لا من خارجه، وإلا قاس رفضًا يستحقه اختياره هو لا المنصة.
function deputyCandidate(ctx, serviceCode) {
  const { db } = ctx;
  const service = db.prepare("SELECT department_id,approval_policy FROM services s WHERE tenant_id='36t' AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.code=s.code AND n.tenant_id=s.tenant_id)").get(serviceCode);
  if (!service) return null;
  const handlerRole = JSON.parse(service.approval_policy).handler_role;
  const row = db.prepare(`SELECT u.id FROM users u JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id
    WHERE u.tenant_id='36t' AND u.active=1 AND u.role<>'admin' AND u.department_id<>?
    AND d.active=1 AND d.sector=(SELECT sector FROM departments WHERE id=? AND tenant_id='36t')
    AND (?='member' OR u.role=? OR u.role='manager')
    AND NOT EXISTS(SELECT 1 FROM department_escalation e WHERE e.user_id=u.id) AND u.id<>? ORDER BY u.id LIMIT 1`)
    .get(service.department_id, service.department_id, handlerRole, handlerRole, REQUESTER);
  return row?.id ?? null;
}
// من يقبل تسمية النائب: ليس النائب نفسه (فالقبول هو ما يمنح حق التنفيذ) ولا من سمّاه. مدير إدارة النائب هو
// الطرف الثالث الطبيعي: هو من يُعير وقت موظفه، ولا يكسب بالقبول تنفيذًا.
function deputyAccepter(ctx, deputyId) {
  const { db } = ctx;
  const person = db.prepare('SELECT department_id FROM users WHERE id=?').get(deputyId);
  if (!person) return null;
  return db.prepare(`SELECT id FROM users WHERE tenant_id='36t' AND department_id=? AND role='manager' AND active=1 AND id<>? ORDER BY id LIMIT 1`)
    .get(person.department_id, deputyId)?.id ?? null;
}

async function enablePlatform(ctx) {
  const { client, catalogModule } = ctx;
  const enabled = { proposals: [], proposals_failed: [], scales: 0, matrix: 0, window: null, thresholds: [] };

  // 1) تبنّي كل مقترحات السياسة (B2 المسار المباشر، B3 فصل المهام).
  for (const proposal of catalogModule.policyProposals) {
    const res = await client.post('admin', `/api/approval-settings/proposals/${proposal.key}/adopt`, { basis: BASIS });
    if (res.ok) enabled.proposals.push(proposal.key);
    else enabled.proposals_failed.push({ key: proposal.key, status: res.status, code: errorOf(res), message: messageOf(res) });
  }

  // 1-ب) ما رفضه حارس التبني لأنه يقطع آخر منفذ: يُسمّى له نائب منفّذ ويقبله شخص ثانٍ، ثم يُعاد التبني.
  // هذا هو الطريق الذي ترسمه رسالة الرفض نفسها، يُمشى هنا بالكامل حتى يكون «مفعّلة بالكامل» مفعّلةً فعلًا.
  enabled.deputies = [];
  for (const failure of [...enabled.proposals_failed]) {
    if (failure.code !== 'adoption_strands_service') continue;
    const proposal = catalogModule.policyProposals.find(p => p.key === failure.key);
    const deputy = deputyCandidate(ctx, proposal.code);
    if (!deputy) continue;
    const named = await client.post('admin', '/api/approval-settings/deputies',
      { service_code: proposal.code, rank: 1, user_id: deputy, basis: BASIS });
    if (!named.ok) { enabled.deputies.push({ code: proposal.code, stage: 'propose', code_error: errorOf(named), message: messageOf(named) }); continue; }
    const accepter = deputyAccepter(ctx, deputy);
    if (!accepter) { enabled.deputies.push({ code: proposal.code, stage: 'accept', code_error: 'no_accepter', message: 'لا مدير لإدارة النائب يقبل التسمية' }); continue; }
    const accepted = await client.post(accepter, '/api/approval-settings/deputies/accept',
      { service_code: proposal.code, rank: 1, note: BASIS });
    if (!accepted.ok) { enabled.deputies.push({ code: proposal.code, stage: 'accept', code_error: errorOf(accepted), message: messageOf(accepted) }); continue; }
    const retry = await client.post('admin', `/api/approval-settings/proposals/${proposal.key}/adopt`, { basis: BASIS });
    enabled.deputies.push({ code: proposal.code, deputy, accepted_by: accepter, adopted_after_naming: retry.ok, code_error: retry.ok ? null : errorOf(retry) });
    if (retry.ok) {
      enabled.proposals.push(proposal.key);
      enabled.proposals_failed = enabled.proposals_failed.filter(f => f.key !== proposal.key);
    }
  }

  // 2) مقاييس الأثر والعجلة ومصفوفة الأولوية (تجعل بوابة الاستقبال تطالب بالأولوية في كل طلب).
  const impact = [['high', 'أثر واسع', 1], ['medium', 'أثر محدود', 2], ['low', 'أثر فردي', 3]];
  const urgency = [['now', 'لا يحتمل التأجيل', 1], ['soon', 'خلال الأسبوع', 2], ['later', 'يحتمل التأجيل', 3]];
  for (const [dimension, rows] of [['impact', impact], ['urgency', urgency]])
    for (const [code, name, rank] of rows) {
      const res = await client.post('admin', '/api/intake/scales',
        { dimension, code, name, guidance: `${name}: درجة مصطنعة عُرّفت لقياس أثر المصفوفة في المسح.`, rank, basis: BASIS }, idemKey());
      if (res.ok) enabled.scales++;
    }
  const days = { 1: 1, 2: 3, 3: 5 };
  for (const [ic, , ir] of impact) for (const [uc, , ur] of urgency) {
    const rank = Math.max(1, Math.min(9, Math.round((ir + ur) / 2)));
    const res = await client.post('admin', '/api/intake/matrix',
      { impact_code: ic, urgency_code: uc, priority: ['حرجة', 'عالية', 'عادية'][rank - 1] ?? 'عادية', priority_rank: rank, target_days: days[rank] ?? 5, basis: BASIS }, idemKey());
    if (res.ok) enabled.matrix++;
  }

  // 3) مهلة إعادة الفتح العامة (بدونها إعادة الفتح غير متاحة أصلًا).
  const win = await client.post('admin', '/api/request-closure/window',
    { scope_code: '*', window_days: 5, basis: BASIS, confirmed_on: shift(0) }, idemKey());
  enabled.window = win.ok ? 5 : { status: win.status, code: errorOf(win), message: messageOf(win) };

  // 4) حدود الاعتماد لكل مفتاح تشترطه خطوة مشروطة في الكتالوج بعد التبني (admin يقترح، الرئاسة تعتمد).
  const settings = await client.get('admin', '/api/approval-settings');
  for (const key of (settings.body?.keys ?? []).map(k => k.key)) {
    const proposed = await client.post('admin', '/api/approval-settings/thresholds',
      { setting_key: key, amount_minor: 500000, basis: BASIS, effective_from: shift(-1) }, idemKey());
    if (!proposed.ok) { enabled.thresholds.push({ key, stage: 'propose', code: errorOf(proposed), message: messageOf(proposed) }); continue; }
    const decided = await client.post('ceo', `/api/approval-settings/thresholds/${proposed.body.id}/decide`,
      { version: 1, decision: 'approve', note: BASIS });
    enabled.thresholds.push({ key, adopted: decided.ok, code: decided.ok ? null : errorOf(decided), message: decided.ok ? '' : messageOf(decided) });
  }
  return enabled;
}

// ── مشي خدمة واحدة من الإنشاء إلى الإغلاق ─────────────────────────────────────
const REQUESTER = 'employee';

async function walk(ctx, service, mode, model, requester = REQUESTER) {
  const { client, db } = ctx;
  const rec = {
    code: service.code, name: service.name_ar, department_id: service.department_id,
    section: service.section ?? '', target_days: service.target_days ?? null,
    policy_steps: service.approval_policy.steps.length,
    handler_role: service.approval_policy.handler_role,
    sod: !!service.approval_policy.sod, confidential: !!service.approval_policy.confidential,
    mode_direct: service.approval_policy.mode === 'direct',
    requester, created: false, submitted: false, steps: [], approvals_done: 0,
    executed: false, closed: false, final_status: null, due_on: null, clock: null,
    notifications: 0, notification_kinds: [], failure: null, verdict: 'fail', notes: []
  };

  const payload = payloadForStored(service.fields, model);
  rec.payload_keys = Object.keys(payload);
  const title = `${MARK} — ${service.name_ar}`.slice(0, 180);

  // 1) الإنشاء
  let created = await client.post(requester, '/api/requests', { service_id: service.id, title, payload }, idemKey());
  if (!created.ok && errorOf(created) === 'use_attendance_screen') {
    rec.notes.push('الخيار الافتراضي يحوّل الطلب إلى شاشة الحضور؛ أُعيدت المحاولة بخيار يبقى في الطلب العام');
    const alt = { ...payload, kind: service.fields.find(f => f.key === 'kind')?.options.find(o => !['استئذان', 'تأخير بعذر'].includes(o)) };
    created = await client.post(requester, '/api/requests', { service_id: service.id, title, payload: alt }, idemKey());
  }
  // الباب الأمامي الواحد (الحزمة 4، P4-CRM-3): الفرصة والخسارة والتسليم صارت سجلاتها المهيكلة، والطلب النصي يُرفض بإشارة إليها.
  if (!created.ok && errorOf(created) === 'use_structured_record') {
    rec.notes.push(`الطلب النصي صار السجل المهيكل نفسه؛ الرفض يشير إلى ${created.body?.error?.details?.refusal?.link ?? 'شاشته'}`);
    rec.structured_record = true; rec.verdict = 'pass';
    return rec;
  }
  if (!created.ok) {
    rec.failure = { stage: 'create', status: created.status, code: errorOf(created), message: messageOf(created), module: 'app/workflow.mjs createRequest' };
    return rec;
  }
  rec.created = true;
  rec.request_id = created.body.id;

  // 2) بيانات الاستقبال حين تكون المصفوفة معرّفة (الوضع المفعّل)
  const intake = await ensureIntake(client, mode, requester, rec.request_id);
  if (intake && !intake.ok) rec.notes.push(`تعذّر حفظ بيانات الاستقبال: ${errorOf(intake)} — ${messageOf(intake)}`);

  // 3) التقديم
  let view = (await client.get(requester, `/api/requests/${rec.request_id}`)).body;
  const submitted = await client.post(requester, `/api/requests/${rec.request_id}/submit`, { version: view.version });
  if (!submitted.ok) {
    rec.failure = { stage: 'submit', status: submitted.status, code: errorOf(submitted), message: messageOf(submitted), module: moduleGuess(errorOf(submitted)) };
    rec.final_status = view.status;
    return rec;
  }
  rec.submitted = true;
  view = submitted.body;
  rec.final_status = view.status;
  rec.approval_notes = view.approval_notes ?? [];
  // الساعة تُقرأ وهي جارية: computeClock يُرجع due_on فارغًا لكل حالة مغلقة، فلو قُرئت بعد الإغلاق لضاع الاستحقاق.
  const live = await client.get(requester, `/api/requests/${rec.request_id}`);
  if (live.ok) { rec.clock = live.body.clock ?? null; rec.due_on = live.body.clock?.due_on ?? null; }

  // 4) مسار الاعتماد: خطوة بخطوة بحساب المعتمد نفسه
  let guard = 0;
  while (view.status === 'pending' && guard++ < 8) {
    const full = (await client.get(requester, `/api/requests/${rec.request_id}`)).body;
    const pending = (full.approvals ?? []).filter(a => a.revision === full.revision && a.status === 'pending').sort((a, b) => a.position - b.position);
    if (!pending.length) { rec.failure = { stage: 'approve', status: 409, code: 'no_pending_step', message: 'الطلب معلّق بلا خطوة معلقة', module: 'app/workflow.mjs transition' }; break; }
    const step = pending[0];
    const approverView = await client.get(step.approver_id, `/api/requests/${rec.request_id}`);
    if (!approverView.ok) {
      rec.failure = { stage: 'approve', status: approverView.status, code: errorOf(approverView), message: `المعتمد ${step.approver_id} لا يرى الطلب`, module: 'app/workflow.mjs visible' };
      break;
    }
    const decided = await client.post(step.approver_id, `/api/requests/${rec.request_id}/approve`, { version: approverView.body.version, note: `${MARK}: اعتماد آلي في المسح` });
    rec.steps.push({ position: step.position, approver: step.approver_id, ok: decided.ok, code: errorOf(decided), message: decided.ok ? '' : messageOf(decided) });
    if (!decided.ok) {
      rec.failure = { stage: 'approve', status: decided.status, code: errorOf(decided), message: messageOf(decided), module: 'app/workflow.mjs transition', position: step.position, approver: step.approver_id };
      break;
    }
    rec.approvals_done++;
    view = decided.body;
    rec.final_status = view.status;
  }
  if (rec.failure) { await measure(ctx, rec); return rec; }
  if (view.status !== 'approved') {
    rec.failure = rec.failure ?? { stage: 'approve', status: 409, code: 'not_approved', message: `الطلب انتهى بحالة ${view.status} بدل «معتمد»`, module: 'app/workflow.mjs transition' };
    await measure(ctx, rec);
    return rec;
  }

  // 5) التنفيذ: من يملك «claim» فعليًا بحسب المحرك نفسه، لا بافتراضنا
  const candidates = executorCandidates(ctx, rec.request_id);
  let executor = null;
  for (const person of candidates) {
    const seen = await client.get(person, `/api/requests/${rec.request_id}`);
    if (seen.ok && (seen.body.actions ?? []).includes('claim')) {
      executor = { id: person, version: seen.body.version };
      // بأي سند وصله التنفيذ: منفذ الإدارة، أو نائب مسمّى، أو مرجع تصعيد الإدارة. يُقرأ من المحرك لا يُفترض.
      const chain = seen.body.execution ?? null;
      rec.execution_basis = chain?.basis ?? null;
      rec.execution_label = chain?.label ?? '';
      rec.execution_fallback = !!chain?.fallback;
      rec.execution_why = chain?.people?.find(p => p.id === person)?.why ?? '';
      break;
    }
  }
  if (!executor) {
    rec.failure = {
      stage: 'execute', status: 409, code: 'no_executor',
      message: `لا حساب في «${service.department_id}» يملك استلام الطلب (المنفذ ${service.approval_policy.handler_role}${service.approval_policy.sod ? ' مع فصل مهام' : ''}); المرشحون: ${candidates.join(', ') || 'لا أحد'}`,
      module: 'app/workflow.mjs actions/executorsFor'
    };
    await measure(ctx, rec);
    return rec;
  }
  const claimed = await client.post(executor.id, `/api/requests/${rec.request_id}/claim`, { version: executor.version });
  if (!claimed.ok) {
    rec.failure = { stage: 'execute', status: claimed.status, code: errorOf(claimed), message: messageOf(claimed), module: 'app/workflow.mjs transition' };
    await measure(ctx, rec);
    return rec;
  }
  rec.executed = true;
  rec.executor = executor.id;
  // الواقعة التي رصدها المسح الأول: من اعتمد هو من نفّذ. تُقاس هنا صراحةً لا تُستنتج.
  rec.decider_executed = rec.steps.some(s => s.approver === executor.id);
  rec.final_status = claimed.body.status;

  // 6) الإغلاق بدليل ما سُلِّم
  const closed = await client.post(executor.id, `/api/request-closure/${rec.request_id}/close`,
    { version: claimed.body.version, delivered: `${MARK}: أُنجز الطلب آليًا في مسح دليل الخدمات، ووُصف هنا بما يكفي دليلًا على ما سُلِّم.` }, idemKey());
  if (!closed.ok) {
    rec.failure = { stage: 'close', status: closed.status, code: errorOf(closed), message: messageOf(closed), module: closureModule(errorOf(closed)) };
    await measure(ctx, rec);
    return rec;
  }
  rec.closed = true;
  rec.final_status = closed.body.request?.status ?? 'completed';
  rec.verdict = 'pass';
  await measure(ctx, rec);
  return rec;
}

function moduleGuess(code) {
  if (code === 'intake_blocked') return 'app/server.mjs submit gate + app/request-intake.mjs submissionGate';
  if (['routing_unavailable', 'escalation_missing', 'escalation_role', 'self_approval', 'beneficiary_approval', 'executive_missing'].includes(code)) return 'app/workflow.mjs resolveStep';
  if (['missing_field', 'invalid_option', 'invalid_number', 'invalid_text', 'invalid_date', 'date_order'].includes(code)) return 'app/validation.mjs validatePayload';
  return 'app/workflow.mjs transition';
}
function closureModule(code) {
  if (['letter_template_required', 'letter_not_issued', 'resignation_open'].includes(code)) return 'app/service-routes.mjs beforeComplete';
  if (code === 'silent_closure') return 'app/request-closure.mjs closeWithEvidence';
  if (code === 'open_tasks') return 'app/workflow.mjs transition';
  return 'app/request-closure.mjs closeWithEvidence';
}

// المرشحون للتنفيذ يُقرأون من القاعدة (قراءة فقط) ثم يُختبر كل واحد عبر الواجهة نفسها.
// السلسلة ثلاث حلقات منذ 21 سبتمبر: فريق الإدارة المنفذة، ثم النواب المقبولون بالرتبة، ثم سُلَّم تصعيد
// الإدارة — مرجعها، فمرجع إدارته، حتى الرئيس التنفيذي. المسح يسأل الحلقات كلها لا الأولى وحدها،
// وإلا قاس غياب منفذٍ حيث الاحتياط قائم. والسُّلَّم يُمشى هنا كما يمشيه المحرك، لا درجةً واحدة منه.
function escalationLadderIds(db, tenantId, departmentId) {
  const ids = [], seen = new Set();
  let current = departmentId;
  for (let depth = 0; depth < 8 && current; depth++) {
    const above = db.prepare(`SELECT u.id,u.department_id FROM department_escalation e JOIN users u ON u.id=e.user_id
      WHERE e.tenant_id=? AND e.department_id=? AND u.active=1 AND u.role<>'admin'`).get(tenantId, current);
    if (!above || seen.has(above.id)) break;
    seen.add(above.id); ids.push(above.id);
    current = above.department_id === current ? null : above.department_id;
  }
  const top = db.prepare("SELECT id FROM users WHERE tenant_id=? AND id='ceo' AND active=1 AND role='manager'").get(tenantId);
  if (top && !seen.has(top.id)) ids.push(top.id);
  return ids;
}
function executorCandidates(ctx, requestId) {
  const { db } = ctx;
  const r = db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
  const s = db.prepare('SELECT * FROM services WHERE id=?').get(r.service_id);
  const departmentId = r.handling_department_id ?? s.department_id;
  const team = db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND active=1 AND role<>'admin' ORDER BY id")
    .all(r.tenant_id, departmentId).map(x => x.id);
  const deputies = db.prepare("SELECT user_id AS id FROM execution_deputies WHERE tenant_id=? AND service_code=? AND status='accepted' ORDER BY rank")
    .all(r.tenant_id, s.code).map(x => x.id);
  return [...new Set([...team, ...deputies, ...escalationLadderIds(db, r.tenant_id, departmentId)])];
}

async function measure(ctx, rec) {
  const { db, client } = ctx;
  const rows = db.prepare('SELECT kind FROM notifications WHERE request_id=?').all(rec.request_id);
  rec.notifications = rows.length;
  rec.notification_kinds = [...new Set(rows.map(x => x.kind))].sort();
  const view = await client.get(REQUESTER, `/api/requests/${rec.request_id}`);
  if (view.ok) {
    rec.clock_final = view.body.clock ?? null;
    rec.final_status = view.body.status;
  }
}

// ── مسارات الرفض التي يجب أن توجد ────────────────────────────────────────────
async function refusalChecks(ctx, catalogList, model, mode) {
  const { client } = ctx;
  const out = [];
  const pick = catalogList.find(s => s.code === 'IT-SUPPORT') ?? catalogList[0];

  // (1) تقديم بحقل مطلوب ناقص
  const fields = pick.fields;
  const full = payloadForStored(fields, model(pick.code));
  const requiredKey = fields.find(f => f.required)?.key;
  const short = { ...full }; delete short[requiredKey];
  const draft = await client.post(REQUESTER, '/api/requests', { service_id: pick.id, title: `${MARK} — حقل ناقص`, payload: short }, idemKey());
  let result = { check: 'missing_required_field', service: pick.code, field: requiredKey };
  if (!draft.ok) Object.assign(result, { refused_at: 'create', status: draft.status, code: errorOf(draft), message: messageOf(draft) });
  else {
    await ensureIntake(client, mode, REQUESTER, draft.body.id);
    const v = (await client.get(REQUESTER, `/api/requests/${draft.body.id}`)).body;
    const sub = await client.post(REQUESTER, `/api/requests/${draft.body.id}/submit`, { version: v.version });
    Object.assign(result, { refused_at: 'submit', status: sub.status, code: errorOf(sub), message: messageOf(sub), refused: !sub.ok, details: sub.body?.error?.details ?? null });
  }
  out.push(result);

  // (2) صاحب الطلب يعتمد طلبه
  const ok = await client.post(REQUESTER, '/api/requests', { service_id: pick.id, title: `${MARK} — اعتماد ذاتي`, payload: full }, idemKey());
  let selfCheck = { check: 'self_approval', service: pick.code };
  if (ok.ok) {
    await ensureIntake(client, mode, REQUESTER, ok.body.id);
    const v = (await client.get(REQUESTER, `/api/requests/${ok.body.id}`)).body;
    const sub = await client.post(REQUESTER, `/api/requests/${ok.body.id}/submit`, { version: v.version });
    if (sub.ok) {
      const after = (await client.get(REQUESTER, `/api/requests/${ok.body.id}`)).body;
      const mine = await client.post(REQUESTER, `/api/requests/${ok.body.id}/approve`, { version: after.version, note: `${MARK}: محاولة اعتماد ذاتي` });
      const approvers = (after.approvals ?? []).filter(a => a.revision === after.revision).map(a => a.approver_id);
      Object.assign(selfCheck, {
        refused: !mine.ok, status: mine.status, code: errorOf(mine), message: messageOf(mine),
        approver_is_requester: approvers.includes(REQUESTER), approvers
      });
      // طرف ثالث لا علاقة له
      const outsider = await client.post('outsider', `/api/requests/${ok.body.id}/approve`, { version: after.version, note: `${MARK}: محاولة من غريب` });
      out.push({ check: 'unrelated_approver', service: pick.code, refused: !outsider.ok, status: outsider.status, code: errorOf(outsider), message: messageOf(outsider) });
    } else Object.assign(selfCheck, { refused: null, note: `تعذر التقديم: ${errorOf(sub)}` });
  }
  out.push(selfCheck);

  // (3) تكرار الإنشاء بنفس مفتاح الثبات
  const key = idemKey();
  const body = { service_id: pick.id, title: `${MARK} — ثبات`, payload: full };
  const first = await client.post(REQUESTER, '/api/requests', body, key);
  const again = await client.post(REQUESTER, '/api/requests', body, key);
  const conflicting = await client.post(REQUESTER, '/api/requests', { ...body, title: `${MARK} — ثبات مختلف` }, key);
  const missingKey = await client.post(REQUESTER, '/api/requests', body);
  out.push({
    check: 'idempotent_resubmit', service: pick.code,
    same_id: first.ok && again.ok && first.body.id === again.body.id,
    first_id: first.body?.id ?? null, second_id: again.body?.id ?? null,
    conflict_status: conflicting.status, conflict_code: errorOf(conflicting),
    missing_key_status: missingKey.status, missing_key_code: errorOf(missingKey)
  });
  return out;
}

// ── عقد الحقل: ما يعد به الكتالوج مقابل ما يفرضه الخادم فعلًا ─────────────────
// coreField يجرّد الحقل من show_when وpattern وmin_length وmax_length قبل تخزينه في نسخة الخدمة،
// وvalidatePayload يقرأ النسخة المخزنة وحدها. هذه الفحوص تقيس الفجوة عبر الواجهة لا بالقراءة.
async function fieldContractChecks(ctx, services, mode, model) {
  const { client } = ctx;
  const out = [];
  const probe = async (code, payload, label, expectation) => {
    const service = services.find(s => s.code === code);
    if (!service) return;
    const created = await client.post(REQUESTER, '/api/requests', { service_id: service.id, title: `${MARK} — ${label}`, payload }, idemKey());
    const row = { check: label, service: code, expectation, create_status: created.status, create_code: errorOf(created) };
    if (created.ok) {
      await ensureIntake(client, mode, REQUESTER, created.body.id);
      const view = (await client.get(REQUESTER, `/api/requests/${created.body.id}`)).body;
      const sub = await client.post(REQUESTER, `/api/requests/${created.body.id}/submit`, { version: view.version });
      Object.assign(row, { submit_status: sub.status, submit_code: errorOf(sub), accepted: sub.ok, stored: sub.ok ? sub.body.payload : null });
    }
    out.push(row);
  };
  // حقل مطلوب بشرطه: النوع «الهوية أو الإقامة» يوجب تاريخ الانتهاء في نموذج الكتالوج.
  await probe('HR-PROFILE-UPDATE', { change_type: 'الهوية أو الإقامة', details: `${MARK}: رقم هوية مولَّد` },
    'conditional_required_field', 'يجب أن يُرفض التقديم لغياب «تاريخ انتهاء الوثيقة»');
  // صيغة الوقت: النموذج يشترط HH:MM.
  await probe('HR-ATTENDANCE-FIX', { kind: 'نسيان بصمة', date: shift(-1), reason: `${MARK}: سبب مولَّد`, from_time: 'قبل الظهر', to_time: '99:99' },
    'pattern_enforcement', 'يجب أن يُرفض وقت لا يطابق HH:MM');
  // إرشاد الحقل كما يصل الموظف من /api/catalog.
  const sample = services.find(s => s.code === 'HR-PROFILE-UPDATE') ?? services[0];
  const modelFields = model(sample.code) ?? [];
  out.push({
    check: 'field_guidance_reaches_form', service: sample.code,
    expectation: 'الإرشاد المكتوب في الكتالوج (why/hint/example) يصل نموذج الموظف',
    model_fields_with_guidance: modelFields.filter(f => f.why || f.hint || f.example).length,
    api_fields_with_guidance: sample.fields.filter(f => f.why || f.hint || f.example).length,
    api_field_keys: sample.fields.flatMap(f => Object.keys(f)).filter((k, i, a) => a.indexOf(k) === i)
  });
  return out;
}

// ── حالات حافة في محرك الاعتماد لا يبلغها الموظف التجريبي (B4 وB5) ────────────
// الموظف التجريبي يتبع «manager» في الفريق الإبداعي، فلا تلتقي عنده خطوة «مديرك» بخطوة «مدير الإدارة المنفذة».
// هنا يُضاف حساب مصطنع داخل إدارة المالية يتبع مدير الإدارة نفسه، فيصير حل الخطوتين إلى شخص واحد ممكنًا.
async function engineChecks(ctx, services, mode) {
  const { db, client } = ctx;
  const out = [];
  const twoStep = services.find(s => s.code === 'FIN-PAYMENT-REQUEST') ?? services.find(s => s.approval_policy.steps.length === 2);
  if (!twoStep) return out;
  const model = null;
  const payload = payloadForStored(twoStep.fields, ctx.model?.(twoStep.code) ?? model);

  const digest = db.prepare("SELECT password_hash FROM users WHERE id='employee'").get().password_hash;
  const inside = 'qa-inside';
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(inside))
    db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,must_change_password) VALUES(?,'36t',?,?,?,?,'employee',?,0)")
      .run(inside, twoStep.department_id, inside, `${MARK}: موظف داخل الإدارة المنفذة`, digest, `head-${twoStep.department_id}`);

  for (const [label, who] of [['duplicate_step_escalation', inside], ['department_head_own_request', `head-${twoStep.department_id}`]]) {
    const created = await client.post(who, '/api/requests', { service_id: twoStep.id, title: `${MARK} — ${label}`, payload }, idemKey());
    const row = { check: label, service: twoStep.code, requester: who };
    if (!created.ok) { Object.assign(row, { stage: 'create', status: created.status, code: errorOf(created), message: messageOf(created) }); out.push(row); continue; }
    await ensureIntake(client, mode, who, created.body.id);
    const view = (await client.get(who, `/api/requests/${created.body.id}`)).body;
    const sub = await client.post(who, `/api/requests/${created.body.id}/submit`, { version: view.version });
    Object.assign(row, {
      stage: 'submit', status: sub.status, ok: sub.ok, code: errorOf(sub), message: messageOf(sub),
      approvers: sub.ok ? (sub.body.approvals ?? []).filter(a => a.revision === sub.body.revision).map(a => a.approver_id) : null,
      approval_notes: sub.ok ? (sub.body.approval_notes ?? []) : null
    });
    row.one_decision_two_approvals = row.approvers ? new Set(row.approvers).size !== row.approvers.length : null;
    out.push(row);
  }
  return out;
}

// ── تشغيل وضع واحد ───────────────────────────────────────────────────────────
async function runMode(mode, options) {
  const ctx = await boot(options.port);
  // مهما انقطع المسح — خطأ في الشبكة أو إشارة إنهاء — لا تبقى قاعدة مصطنعة ولا مفتاح حقل على القرص.
  const rescue = () => { try { ctx.server.close(); ctx.db.close(); } catch { /* أُغلقت */ } rmSync(ctx.dir, { recursive: true, force: true }); };
  process.once('uncaughtException', error => { rescue(); throw error; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { rescue(); process.exit(130); });
  try {
  const { client, catalogModule } = ctx;
  const started = new Date().toISOString();
  let enabled = null;
  if (mode === 'enabled') enabled = await enablePlatform(ctx);

  const catalogRes = await client.get(REQUESTER, '/api/catalog');
  if (!catalogRes.ok) { await shutdown(ctx, false); throw new Error(`catalog read failed: ${catalogRes.status}`); }
  let services = catalogRes.body;
  if (options.only?.length) services = services.filter(s => options.only.includes(s.code));
  if (options.limit) services = services.slice(0, options.limit);

  const model = code => catalogModule.catalogServices.find(s => s.code === code)?.fields ?? null;
  ctx.model = model;
  const results = [];
  for (const service of services) {
    if (options.verbose) process.stderr.write(`[${mode}] ${service.code}\n`);
    try { results.push(await walk(ctx, service, mode, model(service.code))); }
    catch (error) {
      results.push({ code: service.code, name: service.name_ar, department_id: service.department_id, verdict: 'fail', created: false, submitted: false, steps: [], notes: [], failure: { stage: 'harness', status: 500, code: 'harness_error', message: String(error?.message ?? error), module: 'scripts/qa-catalog-sweep.mjs' } });
    }
  }
  // ── الممرّ الثاني: صاحب طلب من داخل الإدارة المنفذة ─────────────────────────
  // يُمشى على الخدمات التي عليها فصل مهام وحدها، لأنها وحدها التي يمكن أن تقف بلا منفذ: صاحب الطلب
  // من الداخل يجعل خطوة «مديرك» تُحل إلى مدير الإدارة، فتُصعَّد الخطوة التالية إلى مرجع تصعيدها،
  // فيصير المرجع معتمِدًا. هذا هو الممرّ الذي لم يمشِه المسح قط، وهو ما كشف وقوف أربع خدمات.
  const insiderResults = [];
  for (const service of services.filter(s => s.approval_policy.sod)) {
    const requester = ctx.insiders[service.department_id];
    if (!requester) continue;
    if (options.verbose) process.stderr.write(`[${mode}] ${service.code} (من الداخل)\n`);
    try { insiderResults.push(await walk(ctx, service, mode, model(service.code), requester)); }
    catch (error) {
      insiderResults.push({ code: service.code, requester, verdict: 'fail', created: false, submitted: false, steps: [], notes: [], failure: { stage: 'harness', status: 500, code: 'harness_error', message: String(error?.message ?? error), module: 'scripts/qa-catalog-sweep.mjs' } });
    }
  }
  const refusals = await refusalChecks(ctx, services, model, mode);
  const engine = await engineChecks(ctx, services, mode);
  const fieldContract = await fieldContractChecks(ctx, services, mode, model);
  // قراءة واحدة تحمل الفحص ولوح المفاتيح معًا: لا طلبان لشيء واحد، ولا رقمان لمصدر واحد.
  const settings = (await client.get('admin', '/api/approval-settings')).body ?? null;
  const health = settings?.health ?? null;
  const availability = settings?.availability ?? null;

  // رموز الجلسات المستخدمة تُحفظ في ملف 0600 داخل المجلد المؤقت، وتُمحى معه.
  writeFileSync(join(ctx.dir, 'sessions.json'),
    JSON.stringify(Object.fromEntries([...client.sessions].map(([k, v]) => [k, v.cookie])), null, 2), { mode: 0o600 });

  // المسح يمشي على GET /api/catalog، وهو منذ الترحيل 129 الدليلُ المرشَّح: الخدمة التي أوقفها المالك لا
  // تصله. فكان عدده يهبط من 142 إلى 141 ويُقرأ التقرير مسحًا كاملًا نظيفًا (مراجعة 22 سبتمبر). يُقال هنا
  // كم أُوقف وبأي رموز، فيُعرف أن الرقم نقص لأن باب الطلب أُغلق لا لأن خدمةً اختفت. المصدر لوح المفاتيح
  // نفسه (availabilityBoard)، فلا عدّ ثانٍ ينحرف عنه.
  const summary = {
    mode, started, finished: new Date().toISOString(), port: options.port,
    services: results.length,
    // الموقوفة لم تُمشَ ولم تُفحص: عددها ورموزها يُقالان بدل أن يُطرحا من «services» صامتين.
    hidden_not_walked: availability?.totals?.services_hidden ?? 0,
    hidden_service_codes: availability?.hidden_service_codes ?? [],
    services_note: (availability?.totals?.services_hidden ?? 0)
      ? `${results.length} خدمة مُشيت، و${availability.totals.services_hidden} موقوفة من إعدادات الخدمات لم تُمشَ (لا يُفتح منها طلب جديد): ${(availability.hidden_service_codes ?? []).join('، ')}`
      : `${results.length} خدمة مُشيت، ولا خدمة موقوفة من إعدادات الخدمات`,
    passed: results.filter(r => r.verdict === 'pass').length,
    failed: results.filter(r => r.verdict !== 'pass').length,
    submitted: results.filter(r => r.submitted).length,
    approved: results.filter(r => r.approvals_done === r.policy_steps && r.submitted).length,
    executed: results.filter(r => r.executed).length,
    closed: results.filter(r => r.closed).length,
    // من نفّذ وبأي سند: الجمع (المقرِّر ينفّذ) يُعدّ، والاحتياط يُعدّ ويُسمّى، والوقوف بلا منفذ يُعدّ.
    executed_by_decider: results.filter(r => r.executed && r.decider_executed).length,
    by_execution_basis: results.reduce((acc, r) => { if (r.executed) acc[r.execution_basis ?? 'unknown'] = (acc[r.execution_basis ?? 'unknown'] ?? 0) + 1; return acc; }, {}),
    no_executor: results.filter(r => r.failure?.code === 'no_executor').length,
    // الممرّ الثاني بأرقامه مستقلةً: ما لم يُعدّ لا يُقال إنه مُشي.
    insider: {
      services: insiderResults.length,
      closed: insiderResults.filter(r => r.closed).length,
      no_executor: insiderResults.filter(r => r.failure?.code === 'no_executor').length,
      executed_by_decider: insiderResults.filter(r => r.executed && r.decider_executed).length,
      by_execution_basis: insiderResults.reduce((acc, r) => { if (r.executed) acc[r.execution_basis ?? 'unknown'] = (acc[r.execution_basis ?? 'unknown'] ?? 0) + 1; return acc; }, {}),
      stopped: insiderResults.filter(r => !r.closed).map(r => ({ code: r.code, requester: r.requester, stage: r.failure?.stage ?? null, code_error: r.failure?.code ?? null }))
    },
    fallback_executions: results.filter(r => r.execution_fallback).map(r => ({ code: r.code, executor: r.executor, basis: r.execution_basis, label: r.execution_label, why: r.execution_why }))
  };
  const kept = await shutdown(ctx, options.keepDb);
  return { summary, enabled, results, insider_results: insiderResults, refusals, engine, field_contract: fieldContract, health, kept };
  } catch (error) { rescue(); throw error; }
}

// ── نقطة التشغيل ─────────────────────────────────────────────────────────────
export async function sweep(options = {}) {
  const port = options.port ?? 3730;
  if (FORBIDDEN_PORTS.has(port)) throw new Error(`Port ${port} belongs to a live instance. The sweep refuses to bind it.`);
  const modes = options.mode === 'both' || !options.mode ? ['ships', 'enabled'] : [options.mode];
  const runs = {};
  for (const mode of modes) runs[mode] = await runMode(mode, { ...options, port });
  return runs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') throw new Error('The catalogue sweep is a synthetic-only harness.');
  const arg = name => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : null; };
  const options = {
    port: Number(arg('port') ?? 3730),
    mode: arg('mode') ?? 'both',
    only: arg('only')?.split(',').map(s => s.trim()).filter(Boolean) ?? null,
    limit: arg('limit') ? Number(arg('limit')) : null,
    keepDb: process.argv.includes("--keep-db"),
    verbose: process.argv.includes("--verbose"),
    out: arg('out') ?? 'work/qa/catalog-sweep'
  };
  const runs = await sweep(options);
  const outDir = resolve(ROOT, options.out);
  mkdirSync(outDir, { recursive: true });
  for (const [mode, run] of Object.entries(runs)) {
    writeFileSync(join(outDir, `sweep-${mode}.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(run.summary));
  }
  console.log(`Reports written to ${outDir}. Temporary databases deleted${options.keepDb ? ' (kept: --keep-db)' : ''}.`);
}
