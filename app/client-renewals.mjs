// التجديد في موعده (الحزمة 4، P4-CRM-6، الترحيل 185): فرصة التجديد تُفتح من العقد السابق قبل نهايته، وتحمل نطاقه وبنوده وأسعاره.
//
// كل تجديد يبدأ قبل أن ينتهي الاتفاق القديم ويحمل نطاقه وأسعاره: تاريخ نهاية العقد الساري (بملاحقه المؤكدة) يفتح نافذة تذكير
// بمهلة يضبطها المالك في سجل العقود (contract_alert_settings) — بلا مهلة مضبوطة لا تذكير، كما يقول السجل نفسه. والتذكير يصل
// مرة لكل دورة لمن عليه الفعل: مسؤول حساب العميل وصاحب الصفقة السابقة. الفرصة تُفتح من العقد نفسه، فلا يُكتب العميل ولا النطاق
// ولا الأسعار مرة ثانية؛ وصفقتها تسمّي الصفقة السابقة، وعقد التجديد يسمّي العقد السابق (contract_records.renews_id).
// قاعدة الطلب «تجديد أو توسعة حساب عميل» (ACC-RENEWAL) صارت تفتح هذا المسار لمن في فريق حساب عميل بتصريح المبيعات.
import { audit, now, transaction } from './db.mjs';
import * as v from './validation.mjs';
import { refuse } from './refusal.mjs';
import { personName, personPlacement } from './people-read.mjs';
import { notifySubject, SUBJECT_LINKS } from './notices.mjs';
import { riyadhToday } from './riyadh-time.mjs';
import { seller, sellerClient, decimal } from './pipeline-shared.mjs';
import { createOpportunity } from './pipeline-estimates.mjs';
import { effectiveTerm } from './contracts-register.mjs';
import { FAMILIES } from './agency.mjs';
import { assertClientOpen } from './client-offboarding.mjs';

// تذكير التجديد يفتح «خط الفرص»، حيث تُفتح فرصة التجديد من العقد.
Object.assign(SUBJECT_LINKS, { contract_renewal: '#pipeline' });
const ACCOUNT_OWNER = 'مسؤول حساب العميل';
const minusDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const dealRef = id => String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
function writing(db) {
  if (!db.isTransaction) refuse(409, 'transaction_required', { what: 'ما انكتبت فرصة التجديد: الكتابة خارج معاملة قاعدة بيانات', next: 'نفّذ النداء داخل transaction(db,…)' });
}

/* ───── ما يُنسخ من العقد السابق ───── */
// النطاق والبنود والأسعار من اتفاق الصفقة المسجّل عليها العقد (commercial_contracts)، وإلا موضوع العقد وقيمته الساريان.
// القيمة المتوقعة للفرصة صافي البنود قبل الضريبة (قيمة الفرصة في خط الفرص قبل الضريبة)، وإلا قيمة العقد السارية كما سُجّلت.
export function renewalBasis(db, contract, term = effectiveTerm(db, contract)) {
  const head = { id: contract.id, number: contract.number, subject: contract.subject, start_date: contract.start_date, end_date: term.end_date, value_minor: term.value_minor };
  const agreement = contract.case_id ? db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(contract.case_id) : null;
  if (agreement) {
    const s = JSON.parse(agreement.snapshot);
    return { source: 'agreement', contract: head, deal: { id: contract.case_id, ref: dealRef(contract.case_id) }, scope: s.scope, currency: s.currency,
      lines: s.lines.map(l => ({ description: l.description, quantity: l.quantity, unit_price_minor: l.unit_price_minor, discount_minor: l.discount_minor, tax_basis_points: l.tax_basis_points,
        net_minor: l.net_minor, total_minor: l.total_minor, acceptance: l.acceptance, revisions: l.revisions })),
      net_minor: String(s.net_minor), tax_minor: String(s.tax_minor), total_minor: String(s.total_minor), copied_at: now() };
  }
  const value = term.value_minor === null ? null : String(term.value_minor);
  return { source: 'contract', contract: head, deal: null, scope: contract.subject, currency: 'SAR', lines: [], net_minor: value, tax_minor: null, total_minor: value, copied_at: now() };
}

/* ───── نافذة التذكير ───── */
// العقد المتجدد تلقائيًا: النافذة قبل آخر موعد للإشعار بعدم التجديد (تفويته يجدّد العقد غصبًا). غيره: قبل نهاية المدة.
// المهلتان من إعداد سجل العقود الذي يضبطه المالك بسنده؛ بلا إعداد لا نافذة ولا تذكير.
const settingsOf = (db, tenantId) => db.prepare('SELECT * FROM contract_alert_settings WHERE tenant_id=?').get(tenantId) ?? null;
export function renewalWindow(contract, term, settings) {
  if (!settings) return null;
  if (contract.auto_renew && term.notice_deadline) return { kind: 'notice', due_on: term.notice_deadline, opens_on: minusDays(term.notice_deadline, settings.notice_lead_days) };
  return { kind: 'expiry', due_on: term.end_date, opens_on: minusDays(term.end_date, settings.expiry_lead_days) };
}
const successorOf = (db, contractId) => db.prepare("SELECT id,number,status FROM contract_records WHERE renews_id=? AND status<>'cancelled' ORDER BY created_at LIMIT 1").get(contractId) ?? null;
const renewalOf = (db, contractId) => db.prepare("SELECT id,name,status,owner_id FROM opportunities WHERE renews_contract_id=? AND status<>'lost' LIMIT 1").get(contractId) ?? null;
const decidedFor = (db, contractId, termEnd) => db.prepare('SELECT decision FROM contract_renewal_decisions WHERE contract_id=? AND term_end_date=?').get(contractId, termEnd)?.decision ?? null;

/* ───── عقود قرب نهايتها، في «خط الفرص» ───── */
// عقود العملاء السارية لعملاء القارئ (فريق الحساب)، بنهايتها ونافذة تذكيرها وما يُنسخ منها، وفرصة تجديدها أو عقد تجديدها إن وُجد.
export function renewalsFor(db, supplied) {
  const { u, clients } = seller(db, supplied), today = riyadhToday(), settings = settingsOf(db, u.tenant_id);
  if (!clients.length) return { today, alerts_configured: !!settings, contracts: [] };
  const names = new Map(clients.map(c => [c.id, c.trade_name || c.legal_name]));
  const rows = db.prepare(`SELECT * FROM contract_records WHERE tenant_id=? AND party_kind='client' AND status='active' AND client_id IN (${clients.map(() => '?').join(',')}) ORDER BY end_date,number`).all(u.tenant_id, ...clients.map(c => c.id));
  const contracts = [];
  for (const c of rows) {
    const term = effectiveTerm(db, c);
    if (term.end_date < today) continue;
    const window = renewalWindow(c, term, settings), successor = successorOf(db, c.id), opportunity = renewalOf(db, c.id), closed = db.prepare('SELECT status FROM clients WHERE id=?').get(c.client_id)?.status === 'closed';
    const decision = decidedFor(db, c.id, term.end_date);
    contracts.push({ id: c.id, number: c.number, subject: c.subject, client_id: c.client_id, client_name: names.get(c.client_id), auto_renew: !!c.auto_renew,
      end_date: term.end_date, notice_deadline: term.notice_deadline, days_to_end: daysBetween(today, term.end_date),
      window, in_window: !!window && today >= window.opens_on, decision,
      basis: renewalBasis(db, c, term),
      opportunity: opportunity ? { id: opportunity.id, name: opportunity.name, status: opportunity.status, owner_name: personName(db, opportunity.owner_id) } : null,
      successor: successor ? { id: successor.id, number: successor.number } : null,
      actions: !successor && !opportunity && !closed && decision !== 'do_not_renew' ? ['open_renewal'] : [] });
  }
  return { today, alerts_configured: !!settings, contracts };
}

/* ───── فتح فرصة التجديد ───── */
export function openRenewal(db, supplied, contractId, input) {
  writing(db);
  v.object(input, ['stage_code', 'expected_close_on', 'service_family', 'name']);
  const { u } = seller(db, supplied);
  const contract = typeof contractId === 'string' ? db.prepare('SELECT * FROM contract_records WHERE id=? AND tenant_id=?').get(contractId, u.tenant_id) : null;
  if (!contract || contract.party_kind !== 'client') refuse(404, 'not_found', { what: 'العقد مو متاح لك', next: 'فرصة التجديد تنفتح من عقد عميل أنت في فريق حسابه، من «خط الفرص»' });
  const client = sellerClient(db, u, contract.client_id).c;
  assertClientOpen(db, u.tenant_id, client.id, 'ما تنفتح فرصة تجديد');
  if (contract.status !== 'active') refuse(409, 'contract_not_in_force', { what: `العقد ${contract.number} مو ساري، فما يتجدد`, next: 'التجديد يكمل عقدًا ساريًا. للعميل نفسه افتح فرصة جديدة' });
  const term = effectiveTerm(db, contract), today = riyadhToday();
  // «قبل أن ينتهي»: بعد نهاية العقد ما فيه شي يتجدد — رجوع العميل فرصة جديدة.
  if (term.end_date < today) refuse(409, 'contract_ended', { what: `العقد ${contract.number} انتهى في ${term.end_date}، والتجديد ينفتح قبل نهاية سابقه`,
    missing: [{ document: 'عقد ساري لم تنته مدته', why: 'فرصة التجديد تحمل عقدًا قائمًا إلى مدة ثانية', owner: personName(db, client.owner_id) ?? ACCOUNT_OWNER, owner_role: 'account_manager' }],
    next: 'إذا رجع العميل بعد الانتهاء، افتح له فرصة جديدة من «خط الفرص»' });
  const successor = successorOf(db, contract.id);
  if (successor) refuse(409, 'renewal_exists', { what: `العقد ${contract.number} تجدد بالعقد ${successor.number}`, next: 'تابع عقد التجديد من «سجل العقود»' });
  const existing = renewalOf(db, contract.id);
  if (existing) refuse(409, 'renewal_exists', { what: `للعقد ${contract.number} فرصة تجديد قائمة: «${existing.name}»`,
    missing: [{ document: `فرصة التجديد «${existing.name}»`, why: 'لكل عقد فرصة تجديد قائمة واحدة', owner: personName(db, existing.owner_id) ?? 'صاحب الفرصة', owner_role: 'account_manager', doc_key: 'opportunity' }],
    next: 'كمّل على الفرصة القائمة. وإذا خسرناها والعقد ما زال ساريًا، تنفتح فرصة ثانية' });
  if (decidedFor(db, contract.id, term.end_date) === 'do_not_renew') refuse(409, 'decided_not_to_renew', { what: `انسجّل قرار «عدم التجديد» على العقد ${contract.number} لهذي الدورة`,
    next: 'القرار نهائي لهذي الدورة. إذا تغيّر الموقف، عقدٌ جديد بفرصة جديدة' });
  const basis = renewalBasis(db, contract, term);
  // نوع الخدمة من فرصة الصفقة السابقة إن كانت؛ وإلا يختاره من يفتح التجديد (لا يُخمَّن).
  const before = contract.case_id ? db.prepare('SELECT o.* FROM commercial_cases k JOIN opportunities o ON o.id=k.opportunity_id WHERE k.id=?').get(contract.case_id) : null;
  const family = input.service_family || before?.service_family;
  if (!family || !FAMILIES.some(f => f.key === family)) refuse(400, 'service_family', { what: 'نوع الخدمة مطلوب لفرصة التجديد',
    missing: [{ document: 'نوع الخدمة', why: before ? 'نوع الخدمة في الفرصة السابقة مو من القائمة' : 'العقد السابق ما انفتح من فرصة تقول نوع خدمته', owner: 'من يفتح فرصة التجديد', owner_role: 'account_manager', doc_key: 'service_family' }],
    next: 'اختر نوع الخدمة من القائمة وأعد فتح التجديد' });
  const value = basis.net_minor === null ? '0' : decimal(Number(basis.net_minor));
  const name = input.name ? v.text(input.name, 'اسم فرصة التجديد', 180, 3) : `تجديد ${contract.number} — ${contract.subject}`.slice(0, 180);
  const { id } = createOpportunity(db, u, { client_id: client.id, stage_code: input.stage_code, name, service_family: family, value,
    expected_close_on: input.expected_close_on ? v.date(input.expected_close_on) : term.end_date, decision_maker: before?.decision_maker ?? '',
    budget_note: `قيمة العقد السابق ${contract.number}${basis.source === 'agreement' ? ` حسب بنود اتفاقه (صافي ${decimal(Number(basis.net_minor))} ريال قبل الضريبة)` : basis.net_minor === null ? ' ما انسجلت' : ` كما سُجّلت (${decimal(Number(basis.net_minor))} ريال)`}`,
    next_step: '', next_step_on: '' }, { renewal: { contract_id: contract.id, basis } });
  audit(db, u, 'opportunity', id, 'opportunity.renewal_opened', {}, { contract_id: contract.id, contract_number: contract.number, term_end_date: term.end_date,
    source: basis.source, lines: basis.lines.length, net_minor: basis.net_minor });
  return { id };
}

/* ───── تذكير التجديد ───── */
// يُستدعى من مؤقّت الخادم بلا جلسة (app/server.mjs)، وكل عقد في معاملته. التذكير يصل مرة لكل دورة (العقد، نهاية مدته السارية)،
// ولا يصل لعقد له فرصة تجديد أو عقد تجديد أو قرار مسجّل لهذه الدورة، ولا لعميل مقفل. يصل من عليه الفعل: مسؤول حساب العميل،
// وصاحب الصفقة السابقة إن كان غيره، وحسابهما نشط.
export function runRenewalReminders(db, today = riyadhToday()) {
  const sent = [];
  for (const settings of db.prepare('SELECT * FROM contract_alert_settings').all()) {
    for (const c of db.prepare("SELECT * FROM contract_records WHERE tenant_id=? AND party_kind='client' AND status='active' ORDER BY end_date").all(settings.tenant_id)) {
      const term = effectiveTerm(db, c);
      if (term.end_date < today) continue;
      const window = renewalWindow(c, term, settings);
      if (!window || today < window.opens_on) continue;
      if (db.prepare('SELECT 1 FROM contract_renewal_reminders WHERE contract_id=? AND term_end_date=?').get(c.id, term.end_date)) continue;
      if (successorOf(db, c.id) || renewalOf(db, c.id) || decidedFor(db, c.id, term.end_date)) continue;
      const client = db.prepare('SELECT code,owner_id,status FROM clients WHERE id=?').get(c.client_id);
      if (!client || client.status === 'closed') continue;
      const dealOwner = c.case_id ? db.prepare('SELECT owner_id FROM commercial_cases WHERE id=?').get(c.case_id)?.owner_id : null;
      const recipients = [...new Set([client.owner_id, dealOwner].filter(Boolean))].filter(id => personPlacement(db, c.tenant_id, id)?.active);
      transaction(db, () => {
        db.prepare('INSERT INTO contract_renewal_reminders(contract_id,tenant_id,term_end_date,window_opened_on,recipients,sent_at) VALUES(?,?,?,?,?,?)')
          .run(c.id, c.tenant_id, term.end_date, window.opens_on, JSON.stringify(recipients), now());
        for (const userId of recipients) notifySubject(db, { userId, kind: 'renewal_due', subjectKind: 'contract_renewal', subjectId: c.id, category: 'approvals',
          title: `تجديد العقد ${c.number} يقرب: ${window.kind === 'notice' ? `آخر موعد للإشعار ${window.due_on}` : `ينتهي ${term.end_date}`}`,
          body: 'افتح «خط الفرص» (عقود قرب نهايتها) وافتح فرصة التجديد من العقد: نطاقه وبنوده وأسعاره تنتقل معها.' });
        // الفاعل في السلسلة مالك العقد (كما تُكتب مسودات الفوترة الدورية باسم مالك الجدولة)، والحدث يقول إنه تشغيل آلي.
        audit(db, { id: c.owner_id, tenant_id: c.tenant_id }, 'contract_record', c.id, 'contract.renewal_reminded', {}, { term_end_date: term.end_date, window_opened_on: window.opens_on, window_kind: window.kind, recipients, job: 'renewal_reminders' });
      });
      sent.push({ contract_id: c.id, term_end_date: term.end_date, recipients });
    }
  }
  return sent;
}
