import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { personName, personDepartment, personAssignment } from './people-read.mjs';
import { isDepartmentHead } from './workflow.mjs';
import { projectManagerOfRecord, requireProjectManager } from './project-authority.mjs';
import { acceptedCertificate, certificateSummaries } from './completion-certificates.mjs';
import { conflictBlock, orderVersion, invoiceState, lineFacts, creditRequests } from './procurement-guards.mjs';
import { projectMarginFigures } from './profitability.mjs';
import { IN_FORCE, closureInForce } from './project-closure-guard.mjs';
import { REQUEST_STATUS_AR } from './static/vocabulary.mjs';
import { CONDITION_KINDS, conditionText } from './entitlement-gates.mjs';

// محاور حالة المشروع الثمانية. الترحيل: app/migrations/116-project-axes.sql
//
// المبدأ: سؤال واحد لكل محور. `commercial_cases.status='project_active'` كان يُسأل ثلاثة
// أسئلة ويجيب عن واحد — أنه فُتح مشروع. هنا يبقى كما هو محورًا تجاريًا، وتُقرأ الأسئلة
// الأخرى من محاورها. أربعة محاور تُشتق من بيانات قائمة ولا تُخزَّن مرة ثانية، وثلاثة
// تُخزَّن لأنه لا مصدر لها في المنصة، والثامن (التجاري) يُقرأ من حقله القائم.

const id = () => randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MAX_MINOR = 999999999999;
const CURRENCIES = new Set(['SAR', 'USD', 'EUR']);
export const PHASES = { discovery: 'استكشاف وتحديد', planning: 'تخطيط', production: 'إنتاج', review: 'مراجعة', delivery: 'تسليم', closeout: 'إغلاق' };
export const WORK_PACKAGE_STATUS = { planned: 'مخططة', active: 'جارية', blocked: 'متوقفة', delivered: 'مسلَّمة', cancelled: 'ملغاة' };

// كل محور: حالاته المعلنة، وصاحبه، ومن أين تُقرأ حالته. لا محور بلا مصدر مسمى.
export const AXES = [
  { key: 'commercial', name: 'الحالة التجارية', owner_role: 'مسؤول الحساب ومديره المباشر', kind: 'derived',
    source: 'commercial_cases.status',
    states: ['lead', 'qualification_pending', 'qualification_rejected', 'qualified', 'quote_draft', 'quote_pending', 'quote_rejected', 'quote_approved', 'contracted', 'project_active', 'lost', 'withdrawn'] },
  { key: 'readiness', name: 'جاهزية البدء', owner_role: 'مدير المشروع، والإعفاء لحامل projects.readiness.waive', kind: 'derived',
    source: 'case_payment_terms + client_purchase_orders + advance_invoices + readiness_waivers',
    states: ['not_required', 'awaiting_client_po', 'awaiting_advance', 'ready_by_waiver', 'ready'] },
  { key: 'execution', name: 'تقدم التنفيذ', owner_role: 'مدير المشروع', kind: 'stored',
    source: 'project_execution_states',
    states: ['not_started', 'mobilising', 'in_progress', 'on_hold', 'delivered'] },
  { key: 'acceptance', name: 'قبول العميل', owner_role: 'المدير المباشر بموافقة عميل موثقة', kind: 'derived',
    source: 'commercial_deliveries + commercial_reviews(delivery) + external_approvals',
    states: ['not_started', 'pending_acceptance', 'partially_accepted', 'accepted'] },
  { key: 'invoicing', name: 'فوترة العميل', owner_role: 'المالية: معد الاستحقاق ومعتمده ومصدر الفاتورة', kind: 'derived',
    source: 'ar_claims + tax_invoices',
    states: ['not_invoiced', 'claims_pending', 'claims_approved', 'partially_invoiced', 'invoiced'] },
  { key: 'collection', name: 'تحصيل العميل', owner_role: 'المالية: مسجل القبض ومطابقه', kind: 'derived',
    source: 'ar_receipts',
    states: ['nothing_due', 'outstanding', 'overdue', 'partially_collected', 'collected'] },
  { key: 'supplier_settlement', name: 'سداد المورد', owner_role: 'المالية: معد أمر الدفع ومعتمده وموثق تنفيذه', kind: 'derived',
    // المصدر الصادق وحده: payment_orders. لا يُقرأ procurement_purchases.payment_status (نص ثابت، B3).
    source: 'procurement_payables + payment_orders',
    states: ['none', 'committed', 'invoiced', 'payment_approved', 'settled'] },
  { key: 'closure', name: 'الإقفال النهائي', owner_role: 'الفني لمدير المشروع، والمالي لحامل تفويض الاعتماد المالي', kind: 'stored',
    source: 'project_closures',
    states: ['open', 'closed_technically', 'closed_financially', 'awaiting_final', 'closed', 'reopened'] }
];
export const AXIS_KEYS = AXES.map(a => a.key);

// أسماء الحالات بالعربية، لكل محور على حدة: الحالة نفسها قد تعني شيئين في محورين
// (`not_started` في التنفيذ غير `not_started` في القبول)، فلا قاموس واحد مسطّح لها.
// تُقرأ حيث تُعرض الحالة على شاشة، فتبقى الشاشة بلا قاموس خاص بها يفترق عن المحرك.
export const AXIS_STATE_NAMES = {
  commercial: { lead: 'عميل محتمل', qualification_pending: 'تأهيل بانتظار القرار', qualification_rejected: 'تأهيل مرفوض', qualified: 'مؤهل',
    quote_draft: 'عرض قيد الإعداد', quote_pending: 'عرض بانتظار الاعتماد', quote_rejected: 'عرض مرفوض داخليًا', quote_approved: 'عرض معتمد',
    contracted: 'تعاقد', project_active: 'مشروع قائم', lost: 'خسرناها', withdrawn: 'سحبناها', not_linked: 'بلا ملف تجاري' },
  readiness: { not_required: 'لا شرط بدء', awaiting_client_po: 'بانتظار أمر شراء العميل', awaiting_advance: 'بانتظار الدفعة المقدمة',
    ready_by_waiver: 'جاهز بإعفاء', ready: 'جاهز' },
  execution: { not_started: 'لم يبدأ', mobilising: 'تعبئة', in_progress: 'جارٍ', on_hold: 'متوقف', delivered: 'سُلّم' },
  acceptance: { not_started: 'لم يبدأ القبول', pending_acceptance: 'بانتظار قبول العميل', partially_accepted: 'مقبول جزئيًا', accepted: 'مقبول' },
  invoicing: { not_invoiced: 'بلا فوترة', claims_pending: 'استحقاقات بانتظار الاعتماد', claims_approved: 'استحقاقات معتمدة بلا فاتورة',
    partially_invoiced: 'مفوتر جزئيًا', invoiced: 'مفوتر' },
  collection: { nothing_due: 'لا مستحق', outstanding: 'قائم', overdue: 'متأخر', partially_collected: 'محصَّل جزئيًا', collected: 'محصَّل' },
  supplier_settlement: { none: 'لا مشتريات', committed: 'التزام بلا فاتورة', invoiced: 'مفوتر من المورد', payment_approved: 'أمر دفع معتمد', settled: 'مسدَّد' },
  closure: { open: 'مفتوح', closed_technically: 'مقفل فنيًا', closed_financially: 'مقفل ماليًا', awaiting_final: 'بانتظار الإقفال النهائي',
    closed: 'مقفل نهائيًا', reopened: 'أُعيد فتحه' }
};
export const axisStateName = (axis, state) => AXIS_STATE_NAMES[axis]?.[state] ?? state;

// ما كان الحقل الواحد يعنيه، وأين صار يُقرأ. يُعرض مع كل قراءة حتى لا يُسأل من جديد عمّا لا يعرفه.
export const LEGACY_STATUS_NOTE = {
  field: 'commercial_cases.status',
  value: 'project_active',
  means: 'فُتح مشروع لهذا الملف التجاري. هذه نهاية المحور التجاري وحدها.',
  no_longer_answers: [
    { question: 'هل بدأ العمل؟', axis: 'readiness' },
    { question: 'هل ما زال العمل جاريًا؟', axis: 'execution' },
    { question: 'هل انتهى المشروع ولم يُقفل؟', axis: 'closure' }
  ]
};

/* ───── أدوات ───── */
function writing(db) { if (!db.isTransaction) fail(500, 'transaction_required', 'تتطلب كتابة محاور المشروع معاملة قاعدة بيانات'); }
function actor(db, supplied) {
  const u = supplied && db.prepare('SELECT id,tenant_id,department_id,role,manager_id,active,name FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id, supplied.tenant_id);
  if (!u) fail(403, 'forbidden', 'الحساب غير متاح');
  return u;
}
// عضوية المشروع كما تقرأها بقية الوحدات، بلا استيراد دائري مع محرك الطلبات.
function projectOf(db, u, projectId) {
  const p = typeof projectId === 'string' && db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(projectId, u.tenant_id, u.id);
  if (!p) fail(404, 'project_not_found', 'المشروع غير متاح لك');
  return p;
}
const person = (db, userId) => userId ? db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name ?? '' : '';
// مدير المشروع هو مدير السجل (app/project-authority.mjs). تُصدَّر لتسألها وحدة شهادة الإنجاز بدل نسخة ثانية من القاعدة.
export function projectManager(db, u, project) {
  return requireProjectManager(db, u, project);
}
function money(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) fail(400, 'invalid_money', `${label}: مبلغ موجب بخانتين عشريتين كحد أقصى`);
  const [whole, fraction = ''] = value.split('.'), minor = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (minor <= 0 || minor > MAX_MINOR) fail(400, 'invalid_money', `${label}: المبلغ خارج الحد المحلي`);
  return minor;
}
const show = minor => `${Math.trunc(minor / 100).toLocaleString('en-US')}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;
const caseOf = (db, project) => db.prepare('SELECT * FROM commercial_cases WHERE project_id=? AND tenant_id=?').get(project.id, project.tenant_id) ?? null;
function contractLines(db, commercialCase) {
  const row = commercialCase && db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(commercialCase.id);
  return row ? JSON.parse(row.snapshot).lines : [];
}
function axisEvent(db, u, projectId, axis, fromState, toState, reason = '') {
  db.prepare('INSERT INTO project_axis_events(id,tenant_id,project_id,axis,from_state,to_state,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(), u.tenant_id, projectId, axis, fromState ?? '', toState, reason, u.id, now());
}

/* ───── جدول الدفعات: مصدر توقّع الدفعة المقدمة وشرط أمر الشراء ───── */
// منذ الترحيل 183 (P4-CRM-4) كل بند يُكتب بنوع شرطه: «مقدمة» تحل بتوثيق الاتفاق، أو «قبول» تحل بقبول بنود بعينها من الاتفاق
// (condition_lines أرقامها من صفر). والجدول يقسم الاتفاق: مجموعه قيمته بالهللة، والبند الواحد من الاتفاق شرطٌ لدفعة واحدة على
// الأكثر، وبنود الدفعة الواحدة بنسبة ضريبة واحدة (فاتورتها بنسبة واحدة). عليه تُقاس الاستحقاقات (app/entitlement-gates.mjs).
const plain = minor => `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;
export function recordPaymentTerms(db, supplied, caseId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['terms', 'requires_client_po']);
  const c = typeof caseId === 'string' && db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(caseId, u.tenant_id);
  if (!c) fail(404, 'not_found', 'الملف التجاري غير متاح');
  if (c.owner_id !== u.id && !(u.role === 'manager' && u.department_id === c.department_id)) fail(403, 'not_permitted', 'جدول الدفعات يسجله مسؤول الملف أو مديره المباشر');
  if (!['quote_approved', 'contracted', 'project_active'].includes(c.status)) fail(409, 'quote_not_approved', 'جدول الدفعات يُسجَّل على عرض معتمد أو اتفاق مسجل');
  if (db.prepare('SELECT 1 FROM case_payment_terms WHERE case_id=?').get(c.id)) fail(409, 'terms_exist', 'لهذا الملف جدول دفعات مسجل؛ الجدول يُستبدل بملف جديد لا يُعدَّل');
  if (!Array.isArray(input.terms) || input.terms.length < 1 || input.terms.length > 40) fail(400, 'terms', 'أدخل بندًا واحدًا إلى أربعين في جدول الدفعات');
  // شرط أمر الشراء يُكتب مع الجدول ولا يُستنتج من وجوده: عميلٌ لا يصدر أوامر شراء كان يُطالَب بأمرٍ أو بإعفاء في كل مشروع.
  // غيابه يبقى «مطلوب» لأن هذا ما كانت تعنيه المنصة بكل جدول قبل الترحيل 160، فلا يتغير نداءٌ قائم.
  if (input.requires_client_po !== undefined && typeof input.requires_client_po !== 'boolean') fail(400, 'requires_client_po', 'حدّد هل يشترط الاتفاق أمر شراء من العميل قبل البدء: نعم أو لا');
  const requiresPo = input.requires_client_po === false ? 0 : 1;
  // الاتفاق الذي يقسمه الجدول: لقطة الاتفاق إن وُثّق، وإلا العرض المعتمد الحالي (الجدول يُسجَّل من «عرض معتمد»).
  const contractRow = db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(c.id);
  const agreement = JSON.parse(contractRow?.snapshot ?? db.prepare('SELECT snapshot FROM commercial_quotes WHERE id=?').get(c.current_quote_id)?.snapshot ?? '{}');
  const lines = agreement.lines ?? [], contractCurrency = agreement.currency ?? 'SAR';
  if (!CURRENCIES.has(contractCurrency)) fail(409, 'currency', 'عملة الاتفاق غير مدعومة');
  const owner = { owner: person(db, c.owner_id) || 'صاحب الصفقة', owner_role: 'account_manager', doc_key: 'payment_schedule' };
  const lineName = index => `البند ${index + 1}${lines[index]?.description ? ` «${lines[index].description}»` : ''}`;
  const conditioned = new Map();
  let advances = 0, time = now();
  const rows = input.terms.map((term, position) => {
    v.object(term, ['label', 'amount', 'due_on', 'condition', 'is_advance', 'condition_kind', 'condition_lines']);
    const label = v.text(term.label, 'وصف بند الدفع', 500, 3);
    // الشرط النصي وحده ما يعرف أي بند من الاتفاق يفتح الدفعة، فما يُقاس عليه استحقاق.
    if (!Object.hasOwn(CONDITION_KINDS, term.condition_kind ?? '')) refuse(400, 'condition_kind_required', { what: `بند الدفع «${label}» ما قال شرطه بنوعه`,
      missing: [{ document: 'نوع شرط البند', why: 'الشرط المكتوب نصًا ما يعرف أي بند من الاتفاق يفتح الدفعة، فما ينقاس عليه استحقاق', ...owner }],
      next: 'اختر لكل بند: دفعة مقدمة عند توقيع الاتفاق، أو عند قبول بنود من الاتفاق وسمّها' });
    const advance = term.condition_kind === 'advance', wanted = term.condition_lines ?? [];
    if (term.is_advance !== undefined && term.is_advance !== advance) refuse(400, 'advance_mismatch', { what: `بند «${label}» موسوم ${term.is_advance ? 'مقدمة' : 'غير مقدمة'} وشرطه ${CONDITION_KINDS[term.condition_kind]}`,
      next: 'المقدمة نوع شرط: اختر «دفعة مقدمة عند توقيع الاتفاق» للمقدمة وحدها' });
    if (!Array.isArray(wanted) || wanted.some(index => !Number.isInteger(index)) || new Set(wanted).size !== wanted.length) refuse(400, 'condition_lines', { what: `بنود شرط «${label}» ما هي أرقام بنود مختلفة من الاتفاق`,
      next: 'اختر بنود الاتفاق اللي قبولها يفتح الدفعة، كل بند مرة' });
    if (advance && wanted.length) refuse(400, 'advance_lines', { what: `المقدمة «${label}» تحل بتوثيق الاتفاق، فما يُسمّى لها بند ينتظر القبول`,
      next: 'احذف البنود من المقدمة؛ وإذا كانت الدفعة تنتظر قبول بند فهي دفعة «عند قبول بنود من الاتفاق»' });
    if (!advance && !wanted.length) refuse(400, 'acceptance_lines_required', { what: `دفعة «${label}» عند القبول ما سمّت بنود الاتفاق اللي تنتظرها`,
      missing: [{ document: 'بنود الاتفاق اللي قبولها يفتح الدفعة', why: 'الاستحقاق ما ينكتب إلا بعد قبول بنود شرطه كلها', ...owner }], next: 'اختر بندًا واحدًا على الأقل من بنود الاتفاق' });
    const unknown = wanted.filter(index => index < 0 || index >= lines.length);
    if (unknown.length) refuse(400, 'unknown_line', { what: `شرط «${label}» يسمّي ${unknown.map(index => `البند ${index + 1}`).join(' و')}، والاتفاق ${lines.length} بنود`,
      next: 'اختر من بنود الاتفاق نفسه' });
    for (const index of wanted) {
      if (conditioned.has(index)) refuse(400, 'line_in_two_terms', { what: `${lineName(index)} شرطٌ لدفعتين: «${conditioned.get(index)}» و«${label}»`,
        next: 'البند الواحد من الاتفاق يفتح دفعة واحدة؛ إذا كانت دفعتان تنتظرانه فاجمعهما في دفعة واحدة' });
      conditioned.set(index, label);
    }
    if (new Set(wanted.map(index => String(lines[index].tax_basis_points))).size > 1) refuse(400, 'mixed_tax_rates', { what: `بنود شرط «${label}» بنسب ضريبة مختلفة`,
      next: 'افصل البنود بنسبها في دفعات: فاتورة الدفعة الواحدة بنسبة ضريبة واحدة' });
    if (advance) advances++;
    return { id: id(), position, label, amount_minor: money(term.amount, 'قيمة بند الدفع'), due_on: v.date(term.due_on), condition: term.condition ? v.text(term.condition, 'شرط استحقاق البند', 1000) : '',
      is_advance: advance ? 1 : 0, condition_kind: term.condition_kind, condition_lines: JSON.stringify([...wanted].sort((a, b) => a - b)) };
  });
  if (advances > 1) fail(400, 'terms', 'بند واحد على الأكثر يوسم بأنه الدفعة المقدمة');
  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0), agreed = Number(agreement.total_minor ?? 0);
  if (total !== agreed) refuse(400, 'terms_total_mismatch', { what: `مجموع الجدول ${plain(total)} ما يساوي قيمة الاتفاق ${plain(agreed)} شاملة الضريبة`,
    missing: [{ document: 'جدول يقسم قيمة الاتفاق كلها', why: 'الجدول تقسيم الاتفاق: ما زاد ما اتفق عليه العميل، وما نقص ما له شرط يُستحق به', ...owner }],
    next: `عدّل مبالغ الدفعات لين يصير مجموعها ${plain(agreed)}` });
  for (const row of rows) db.prepare('INSERT INTO case_payment_terms(id,tenant_id,case_id,position,label,amount_minor,currency,due_on,condition,is_advance,recorded_by,recorded_at,requires_client_po,condition_kind,condition_lines) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, u.tenant_id, c.id, row.position, row.label, row.amount_minor, contractCurrency, row.due_on, row.condition, row.is_advance, u.id, time, requiresPo, row.condition_kind, row.condition_lines);
  audit(db, u, 'commercial', c.id, 'axes.payment_terms_recorded', {}, { terms: rows.length, advance_minor: rows.find(r => r.is_advance)?.amount_minor ?? 0, requires_client_po: requiresPo === 1,
    conditions: rows.map(r => ({ kind: r.condition_kind, lines: JSON.parse(r.condition_lines), amount_minor: r.amount_minor })) });
  return { case_id: c.id, terms: rows.length, advance_minor: rows.find(r => r.is_advance)?.amount_minor ?? null, requires_client_po: requiresPo === 1 };
}
const paymentTerms = (db, caseId) => db.prepare('SELECT * FROM case_payment_terms WHERE case_id=? ORDER BY position').all(caseId);

/* ───── أمر شراء العميل: نسخ مرقّمة لا تُعدَّل (ترحيل 160) ───── */
const ownerName = (db, c) => person(db, c?.owner_id) || 'مسؤول الحساب';
const poChain = (db, tenantId, caseId) => caseId ? db.prepare('SELECT * FROM client_purchase_orders WHERE case_id=? AND tenant_id=? ORDER BY revision').all(caseId, tenantId) : [];
const poExpired = po => !!po?.valid_until && po.valid_until < today();
const poView = (db, po, current) => ({ id: po.id, revision: po.revision, version: po.version, po_number: po.po_number, status: po.status,
  amount_minor: po.amount_minor, currency: po.currency, issued_on: po.issued_on, valid_until: po.valid_until, scope: po.scope, expired: poExpired(po),
  superseded: !current, supersedes_id: po.supersedes_id, recorded_by: po.recorded_by, recorded_by_name: person(db, po.recorded_by), confirmed_by_name: person(db, po.confirmed_by) });

export function recordClientPurchaseOrder(db, supplied, caseId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['po_number', 'issued_on', 'valid_until', 'amount', 'scope', 'customer_representative', 'evidence', 'contract_id', 'project_id', 'client_id', 'supersedes_id']);
  const c = typeof caseId === 'string' && db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(caseId, u.tenant_id);
  if (!c) fail(404, 'not_found', 'الملف التجاري غير متاح');
  if (c.owner_id !== u.id && !(u.role === 'manager' && u.department_id === c.department_id)) fail(403, 'not_permitted', 'أمر شراء العميل يسجله مسؤول الملف أو مديره المباشر');
  const owner = { owner: ownerName(db, c), owner_role: 'account_manager' };
  const contract = db.prepare('SELECT id,snapshot FROM commercial_contracts WHERE case_id=?').get(c.id);
  // أمر الشراء يُربط بالاتفاق الذي صدر عليه؛ قبل توثيق الاتفاق لا شيء يُربط به.
  if (!contract || !['contracted', 'project_active'].includes(c.status)) refuse(409, 'agreement_required', {
    what: 'ما ينسجل أمر شراء العميل قبل ما يتوثّق الاتفاق على الملف',
    missing: [{ document: 'الاتفاق الموثّق على العرض المعتمد', why: 'أمر الشراء يرتبط بالاتفاق اللي صدر عليه، والملف ما عنده اتفاق موثّق', ...owner }],
    next: 'وثّق الاتفاق من «العملاء والعروض»، ثم سجّل أمر الشراء عليه' });
  // الروابط تُطابَق بندًا بندًا مع الملف: النموذج يرسل ما يظنه، والخادم يرفض ما لا يخص هذا الملف بعينه.
  if (input.contract_id !== contract.id) refuse(409, 'wrong_agreement', { what: 'أمر الشراء هذا ما يخص اتفاق هذا الملف',
    missing: [{ document: 'الاتفاق الموثّق على هذا الملف', why: 'الاتفاق اللي وصل مع أمر الشراء غير اتفاق الملف', ...owner }],
    next: 'سجّل أمر الشراء من شاشة الملف نفسه، أو على ملف اتفاقه الصحيح' });
  if ((input.project_id || null) !== (c.project_id ?? null)) refuse(409, 'wrong_project', { what: 'أمر الشراء هذا ما يخص مشروع هذا الملف',
    missing: [{ document: 'المشروع المفتوح على هذا الملف', why: 'المشروع اللي وصل مع أمر الشراء غير مشروع الملف', ...owner }],
    next: 'سجّل أمر الشراء من شاشة الملف نفسه، أو على ملف مشروعه الصحيح' });
  const linked = db.prepare('SELECT client_id FROM client_links WHERE case_id=?').get(c.id)?.client_id ?? null;
  if (!linked) refuse(409, 'client_link_required', { what: 'الملف مو مربوط بملف عميل، فما نقدر نتحقق إن أمر الشراء صادر منه',
    missing: [{ document: 'ربط الملف التجاري بملف العميل', why: 'أمر الشراء يُقبل من عميل الملف وحده', ...owner }],
    next: 'اربط الملف بعميله من شاشة «العملاء»، ثم سجّل أمر الشراء' });
  if (input.client_id !== linked) refuse(409, 'wrong_client', { what: 'أمر الشراء صادر لعميل غير عميل هذا الملف',
    missing: [{ document: 'العميل المربوط بهذا الملف', why: 'أمر الشراء لازم يكون من الجهة نفسها اللي تعاقدنا معها', ...owner }],
    next: 'تأكد من الجهة اللي أصدرت أمر الشراء، وسجّله على ملفها هي' });
  const chain = poChain(db, u.tenant_id, c.id), latest = chain.at(-1) ?? null;
  let supersedes = null;
  if (input.supersedes_id !== undefined && input.supersedes_id !== '') {
    supersedes = typeof input.supersedes_id === 'string' && db.prepare('SELECT * FROM client_purchase_orders WHERE id=? AND tenant_id=?').get(input.supersedes_id, u.tenant_id);
    if (!supersedes || supersedes.case_id !== c.id) refuse(409, 'wrong_opportunity', { what: 'النسخة اللي تبني عليها تخص ملفًا تجاريًا ثانيًا',
      missing: [{ document: 'آخر نسخة من أمر الشراء على هذا الملف', why: 'التصحيح يمدّ سلسلة الملف نفسه ولا يتفرّع من ملف غيره', ...owner }],
      next: 'افتح الملف الصحيح، وابنِ على آخر نسخة من أمر شرائه' });
    // قارئان رأيا النسخة نفسها: الأول يمدّ السلسلة، والثاني يُرفض لا يتفرّع من نسخة فات أوانها.
    if (supersedes.id !== latest?.id) refuse(409, 'stale_version', { what: `انسجّلت النسخة ${latest.revision} من أمر الشراء بعد ما فتحت الصفحة`,
      next: 'حدّث الصفحة وابنِ تصحيحك على آخر نسخة' });
  } else if (latest) refuse(409, 'purchase_order_exists', { what: `لهذا الملف أمر شراء مسجّل (النسخة ${latest.revision})`,
    next: 'سجّل التصحيح نسخة جديدة تحل محل القائمة؛ ما يُضاف أمر ثانٍ بجانبها' });
  const issued = v.date(input.issued_on);
  if (issued > today()) fail(400, 'issued_on', 'تاريخ إصدار أمر الشراء ما يكون في المستقبل');
  const validUntil = v.date(input.valid_until);
  if (validUntil < issued) fail(400, 'valid_until', 'نهاية صلاحية أمر الشراء ما تسبق تاريخ إصداره');
  const number = v.text(input.po_number, 'رقم أمر شراء العميل', 120, 1).normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
  if (db.prepare('SELECT 1 FROM client_purchase_orders WHERE tenant_id=? AND po_number=? AND case_id<>?').get(u.tenant_id, number, c.id)) refuse(409, 'duplicate_purchase_order', {
    what: 'رقم أمر الشراء هذا مسجّل على ملف تجاري ثاني', next: 'تأكد من الرقم في الأصل؛ أمر الشراء الواحد ما يتعلّق على ملفين' });
  const poId = id(), time = now(), revision = (latest?.revision ?? 0) + 1;
  db.prepare("INSERT INTO client_purchase_orders(id,tenant_id,case_id,contract_id,project_id,client_id,revision,supersedes_id,po_number,issued_on,valid_until,scope,currency,amount_minor,customer_representative,evidence,status,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'recorded',?,?)")
    .run(poId, u.tenant_id, c.id, contract.id, c.project_id ?? null, linked, revision, supersedes?.id ?? null, number, issued, validUntil,
      v.text(input.scope, 'نطاق أمر الشراء كما كتبه العميل', 3000, 10), JSON.parse(contract.snapshot).currency, money(input.amount, 'قيمة أمر شراء العميل'),
      v.text(input.customer_representative, 'ممثل العميل الموقّع على أمر الشراء', 300, 3), v.text(input.evidence, 'دليل أمر الشراء ومكان حفظ أصله', 5000, 10), u.id, time);
  audit(db, u, 'client_purchase_order', poId, 'axes.client_po_recorded', supersedes ? { revision: supersedes.revision, id: supersedes.id } : {},
    { case_id: c.id, po_number: number, revision, valid_until: validUntil, contract_id: contract.id, client_id: linked });
  return { id: poId, revision, status: 'recorded' };
}
export function confirmClientPurchaseOrder(db, supplied, poId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'note']);
  const row = typeof poId === 'string' && db.prepare("SELECT * FROM client_purchase_orders WHERE id=? AND tenant_id=? AND status='recorded'").get(poId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'أمر شراء العميل غير متاح للتأكيد');
  v.version(input.version, row.version);
  // من سجّل أنه رأى أمر الشراء لا يشهد بنفسه أنه تأكد. الشهادة لغيره.
  if (row.recorded_by === u.id) fail(403, 'self_approval', 'من سجّل أمر شراء العميل لا يؤكده');
  const c = db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(row.case_id);
  if (!(u.role === 'manager' && u.department_id === c.department_id) && !can(db, u, 'contracts.register.manage')) fail(403, 'not_permitted', 'تأكيد أمر شراء العميل للمدير المباشر أو حامل تصريح سجل العقود');
  // تأكيد نسخة حلّت محلها أخرى اعتمادٌ على ما لم يعد قائمًا؛ المُطلِق في الترحيل 160 يرفضه أيضًا.
  const latest = poChain(db, u.tenant_id, row.case_id).at(-1);
  if (latest.id !== row.id) refuse(409, 'superseded', { what: `النسخة ${row.revision} من أمر الشراء حلّت محلها النسخة ${latest.revision}`,
    next: `قابل النسخة ${latest.revision} بالأصل وأكّدها بدلها` });
  const note = v.text(input.note, 'أساس التأكيد: ما الذي قوبل بالأصل', 2000, 5), time = now();
  db.prepare("UPDATE client_purchase_orders SET status='confirmed',confirmed_by=?,confirmed_at=?,version=version+1 WHERE id=? AND version=?").run(u.id, time, row.id, row.version);
  if (row.project_id) axisEvent(db, u, row.project_id, 'readiness', 'awaiting_client_po', 'client_po_confirmed', note);
  audit(db, u, 'client_purchase_order', row.id, 'axes.client_po_confirmed', { status: 'recorded' }, { status: 'confirmed', po_number: row.po_number, revision: row.revision }, note);
  return { id: row.id, status: 'confirmed', revision: row.revision };
}

/* ───── الإعفاء من شرط البدء: طلبٌ من شخص، واعتمادٌ من غيره ───── */
const WAIVER_CAPABILITY = 'projects.readiness.waive';
const WAIVER_ITEMS = { client_po: 'أمر شراء العميل', advance: 'الدفعة المقدمة' };
function waiverView(db, row) {
  const request = row.request_id ? db.prepare('SELECT requested_by,reason FROM readiness_waiver_requests WHERE id=?').get(row.request_id) : null;
  return { id: row.id, item: row.item, reason: row.reason, waived_by_name: person(db, row.waived_by), waived_at: row.waived_at,
    requested_by_name: request ? person(db, request.requested_by) : '', request_reason: request?.reason ?? '' };
}
// الإعفاء سندٌ قائم يُستهلك مع كل فعل، فيُقرأ لحظة الفعل لا لحظة منحه: غير مسحوب، ومعتمِده ما زال يحمل سلطة الإعفاء.
// هذه قاعدة المخصص نفسها حين يفقد معتمده تفويضه (budget_authority_changed في app/budgets.mjs): السند الذي فقد صاحبُه
// سلطتَه لا يُبنى عليه فعلٌ جديد. ويُعرض «متقادمًا» باسم معتمده بدل أن يختفي، فيُعرف لماذا عاد الشرط.
function waiverOf(db, tenantId, projectId, item) {
  const row = projectId ? db.prepare('SELECT * FROM readiness_waivers WHERE project_id=? AND tenant_id=? AND item=? AND withdrawn_at IS NULL').get(projectId, tenantId, item) : null;
  if (!row) return { live: null, stale: null, row: null };
  const view = waiverView(db, row);
  return can(db, { id: row.waived_by, tenant_id: row.tenant_id }, WAIVER_CAPABILITY) ? { live: view, stale: null, row } : { live: null, stale: view, row };
}
export function requestReadinessWaiver(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['item', 'reason']);
  const project = projectOf(db, u, projectId);
  if (!Object.hasOwn(WAIVER_ITEMS, input.item)) fail(400, 'item', 'الإعفاء يكون لأمر شراء العميل أو للدفعة المقدمة');
  const reason = v.text(input.reason, 'سبب طلب الإعفاء', 2000, 20);
  if (waiverOf(db, u.tenant_id, project.id, input.item).live) refuse(409, 'already_waived', { what: `شرط «${WAIVER_ITEMS[input.item]}» معفى عنه بإعفاء ساري`,
    next: 'ما يحتاج طلب جديد؛ الإعفاء القائم يغطي الشرط' });
  if (db.prepare("SELECT 1 FROM readiness_waiver_requests WHERE project_id=? AND item=? AND status='pending'").get(project.id, input.item)) refuse(409, 'already_requested', {
    what: `فيه طلب إعفاء معلّق لشرط «${WAIVER_ITEMS[input.item]}»`, next: 'انتظر قرار حامل تصريح الإعفاء على الطلب القائم' });
  const requestId = id(), time = now();
  db.prepare("INSERT INTO readiness_waiver_requests(id,tenant_id,project_id,item,reason,requested_by,requested_at,status) VALUES(?,?,?,?,?,?,?,'pending')").run(requestId, u.tenant_id, project.id, input.item, reason, u.id, time);
  audit(db, u, 'project', project.id, 'axes.readiness_waiver_requested', {}, { item: input.item, request_id: requestId }, reason);
  return { id: requestId, item: input.item, status: 'pending' };
}
// الاعتماد: حامل التصريح يعتمد طلبًا معلقًا طلبه غيره. كان الإعفاء يُكتب ويُعتمد بيد واحدة، فمن يحمل التصريح
// ويملك المشروع يرفع الشرط عن مشروعه بنفسه. الطلب سجلٌّ مستقل، والمُطلِق في الترحيل 160 يرفض الإعفاء بلا طلب من غيره.
export function waiveReadiness(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['item', 'reason']);
  const project = projectOf(db, u, projectId);
  if (!can(db, u, WAIVER_CAPABILITY)) fail(403, 'not_permitted', 'إعفاء شرط البدء لحامل تصريحه وحده. اطلبه من مسؤول الصلاحيات');
  if (!Object.hasOwn(WAIVER_ITEMS, input.item)) fail(400, 'item', 'الإعفاء يكون لأمر شراء العميل أو للدفعة المقدمة');
  const current = waiverOf(db, u.tenant_id, project.id, input.item);
  if (current.live) fail(409, 'already_waived', 'يوجد إعفاء ساري لهذا الشرط');
  const request = db.prepare("SELECT * FROM readiness_waiver_requests WHERE project_id=? AND tenant_id=? AND item=? AND status='pending'").get(project.id, u.tenant_id, input.item);
  if (!request) refuse(409, 'exemption_request_required', { what: `ما فيه طلب إعفاء معلّق لشرط «${WAIVER_ITEMS[input.item]}»`,
    missing: [{ document: 'طلب إعفاء بسبب مكتوب', why: 'الإعفاء يطلبه شخص ويعتمده غيره', owner: 'عضو في فريق المشروع', owner_role: 'project_member' }],
    next: 'يطلب الإعفاءَ أحدُ أعضاء المشروع بسببه، ثم تعتمده أنت أو ترفضه' });
  if (request.requested_by === u.id) refuse(403, 'separation_of_duties', { what: 'ما تعتمد إعفاء طلبته بنفسك',
    missing: [{ document: 'اعتماد من حامل تصريح الإعفاء غيرك', why: 'الطالب والمعتمد شخصان، عشان ما يرفع أحد الشرط عن مشروعه بيده', owner: 'حامل تصريح «الإعفاء من شرط الدفعة المقدمة أو أمر شراء العميل» غيرك', owner_role: 'manager' }],
    next: 'اطلب من زميل يحمل التصريح يعتمد الطلب أو يرفضه بسببه' });
  const reason = v.text(input.reason, 'سبب الإعفاء ومن أقرّه', 2000, 20), before = readinessAxis(db, project).state, waiverId = id(), time = now();
  // إعفاءٌ فقد معتمدُه سلطتَه يُغلق بسحبٍ مكتوب قبل أن يحل محله الجديد، فيبقى في السجل لماذا لم يعد يغطي.
  if (current.row) db.prepare('UPDATE readiness_waivers SET withdrawn_by=?,withdrawn_at=?,withdrawn_reason=? WHERE id=?').run(u.id, time, 'حلّ محله إعفاء جديد بعد ما فقد معتمده تصريح الإعفاء', current.row.id);
  db.prepare('INSERT INTO readiness_waivers(id,tenant_id,project_id,item,reason,waived_by,waived_at,request_id) VALUES(?,?,?,?,?,?,?,?)').run(waiverId, u.tenant_id, project.id, input.item, reason, u.id, time, request.id);
  db.prepare("UPDATE readiness_waiver_requests SET status='authorised',decided_by=?,decided_at=?,decision_note=?,waiver_id=? WHERE id=? AND status='pending'").run(u.id, time, reason, waiverId, request.id);
  axisEvent(db, u, project.id, 'readiness', before, readinessAxis(db, project).state, reason);
  audit(db, u, 'project', project.id, 'axes.readiness_waived', { state: before, replaced_waiver_id: current.row?.id ?? null }, { item: input.item, waiver_id: waiverId, request_id: request.id, requested_by: request.requested_by }, reason);
  return readinessAxis(db, project);
}
export function declineReadinessWaiver(db, supplied, requestId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['note']);
  const request = typeof requestId === 'string' && db.prepare('SELECT * FROM readiness_waiver_requests WHERE id=? AND tenant_id=?').get(requestId, u.tenant_id);
  if (!request) fail(404, 'not_found', 'طلب الإعفاء غير متاح لك في هذا الكيان');
  const project = projectOf(db, u, request.project_id);
  if (!can(db, u, WAIVER_CAPABILITY)) fail(403, 'not_permitted', 'رفض طلب الإعفاء لحامل تصريح الإعفاء وحده');
  if (request.status !== 'pending') refuse(409, 'request_closed', { what: 'طلب الإعفاء هذا انحسم من قبل', next: 'حدّث الصفحة لتشوف قراره' });
  if (request.requested_by === u.id) refuse(403, 'separation_of_duties', { what: 'ما تحسم طلب إعفاء طلبته بنفسك',
    missing: [{ document: 'قرار من حامل تصريح الإعفاء غيرك', why: 'الطالب والمقرِّر شخصان', owner: 'حامل تصريح «الإعفاء من شرط الدفعة المقدمة أو أمر شراء العميل» غيرك', owner_role: 'manager' }],
    next: 'اطلب من زميل يحمل التصريح يحسم الطلب' });
  const note = v.text(input.note, 'سبب رفض الإعفاء', 2000, 10), time = now();
  db.prepare("UPDATE readiness_waiver_requests SET status='declined',decided_by=?,decided_at=?,decision_note=? WHERE id=? AND status='pending'").run(u.id, time, note, request.id);
  audit(db, u, 'project', project.id, 'axes.readiness_waiver_declined', {}, { item: request.item, request_id: request.id, requested_by: request.requested_by }, note);
  return { id: request.id, status: 'declined' };
}
export function withdrawReadinessWaiver(db, supplied, waiverId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['reason']);
  const row = typeof waiverId === 'string' && db.prepare('SELECT * FROM readiness_waivers WHERE id=? AND tenant_id=?').get(waiverId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'الإعفاء غير متاح لك في هذا الكيان');
  const project = projectOf(db, u, row.project_id);
  if (!can(db, u, WAIVER_CAPABILITY)) fail(403, 'not_permitted', 'سحب الإعفاء لحامل تصريح الإعفاء وحده');
  if (row.withdrawn_at) refuse(409, 'not_waived', { what: 'الإعفاء هذا مسحوب من قبل', next: 'حدّث الصفحة لتشوف الحالة الحالية' });
  const reason = v.text(input.reason, 'سبب سحب الإعفاء', 2000, 10), before = readinessAxis(db, project).state, time = now();
  db.prepare('UPDATE readiness_waivers SET withdrawn_by=?,withdrawn_at=?,withdrawn_reason=? WHERE id=?').run(u.id, time, reason, row.id);
  axisEvent(db, u, project.id, 'readiness', before, readinessAxis(db, project).state, reason);
  audit(db, u, 'project', project.id, 'axes.readiness_waiver_withdrawn', { state: before }, { item: row.item, waiver_id: row.id }, reason);
  return readinessAxis(db, project);
}

/* ───── البوابة الواحدة: تُقرأ من مصادرها لحظة الفعل ───── */
// البوابة التي تُبنى عليها جاهزية البدء، وهي نفسها التي تستدعيها سلسلة الاستلام (ترحيل 109) بدل أن تسأل وثيقة يعلنها موظف.
// «سجّلت المالية أنها أكدت» ليست «وصل المال»: المصدر صفوف advance_invoices المؤكدة بفصل تفويضاتها، ناقصًا ما ارتدّ منها.
function advanceState(db, tenantId, c, projectId) {
  const term = c ? db.prepare('SELECT * FROM case_payment_terms WHERE case_id=? AND is_advance=1').get(c.id) ?? null : null;
  const rows = (projectId ? db.prepare('SELECT * FROM advance_invoices WHERE tenant_id=? AND project_id=? ORDER BY created_at').all(tenantId, projectId) : [])
    .map(a => ({ ...a, reversed_minor: db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM advance_reversals WHERE advance_id=?').get(a.id).n }));
  const paid = rows.filter(a => a.status === 'paid');
  const received = paid.reduce((sum, a) => sum + a.paid_minor, 0), reversed = paid.reduce((sum, a) => sum + a.reversed_minor, 0), confirmed = received - reversed;
  const expected = term?.amount_minor ?? 0, waiver = waiverOf(db, tenantId, projectId, 'advance');
  return {
    declared: !!term, expected_minor: expected, confirmed_minor: confirmed, received_minor: received, reversed_minor: reversed,
    shortfall_minor: Math.max(0, expected - confirmed),
    term: term ? { id: term.id, label: term.label, due_on: term.due_on } : null,
    advances: rows.map(a => ({ id: a.id, status: a.status, amount_minor: a.amount_minor, paid_minor: a.paid_minor, reversed_minor: a.reversed_minor, received_on: a.received_on,
      receipt_reference: a.receipt_reference, recorded_by_name: person(db, a.recorded_by), confirmed_by_name: person(db, a.confirmed_by) })),
    waiver: waiver.live, stale_waiver: waiver.stale,
    satisfied: !term || confirmed >= expected || !!waiver.live,
    source: 'advance_invoices.status=paid ناقص advance_reversals — قبضٌ أكّده غير من سجّله عبر confirm_advance، وما ارتدّ منه لا يُحسب'
  };
}
function purchaseOrderState(db, tenantId, c, projectId) {
  // شرط أمر الشراء من الجدول نفسه (ترحيل 160)؛ الجداول السابقة له تحمل 1 فتبقى على ما كانت عليه.
  const required = !!c && paymentTerms(db, c.id).some(term => term.requires_client_po === 1);
  const chain = poChain(db, tenantId, c?.id), latest = chain.at(-1) ?? null, waiver = waiverOf(db, tenantId, projectId, 'client_po');
  // آخر نسخة وحدها تغطي: المؤكدة التي حلّت محلها أخرى لا تُحسب، والمنتهية صلاحيتها لا تُحسب ولو أُكّدت.
  const covered = latest?.status === 'confirmed' && !poExpired(latest);
  const current = latest ? poView(db, latest, true) : null;
  return { required, current, purchase_order: current, history: chain.map((po, index) => poView(db, po, index === chain.length - 1)),
    superseded_confirmed: chain.slice(0, -1).some(po => po.status === 'confirmed'),
    waiver: waiver.live, stale_waiver: waiver.stale, satisfied: !required || covered || !!waiver.live };
}
// الجدول الواحد للمشروع (P4-CRM-4): جدول الصفقة إن كان للمشروع صفقة سُجّل عليها جدول — هو ما اتفق عليه العميل، ونموذج التسليم
// المشتق ينسخه منه — وإلا جدول نموذج التسليم المكتوب لمشروع بلا صفقة. دفعة مقدمة واحدة برقم واحد تقرؤه البوابتان: جاهزية البدء
// هنا، وقائمة الاستلام PM-01 (app/project-intake.mjs executionGate). كانت الثانية تقدّم رقم النموذج على جدول الصفقة.
export function agreedAdvance(db, tenantId, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, tenantId);
  const c = project ? caseOf(db, project) : null, terms = c ? paymentTerms(db, c.id) : [];
  if (terms.length) return { source: 'case_payment_terms', amount_minor: terms.find(t => t.is_advance === 1)?.amount_minor ?? 0 };
  const handover = project ? db.prepare('SELECT advance_minor FROM project_handovers WHERE project_id=?').get(project.id) : null;
  return handover ? { source: 'handover_payment_terms', amount_minor: handover.advance_minor } : { source: null, amount_minor: 0 };
}
export function advanceGate(db, tenantId, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, tenantId);
  if (!project) fail(404, 'project_not_found', 'المشروع غير متاح');
  return advanceState(db, tenantId, caseOf(db, project), project.id);
}
export function clientPurchaseOrderGate(db, tenantId, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, tenantId);
  if (!project) fail(404, 'project_not_found', 'المشروع غير متاح');
  return purchaseOrderState(db, tenantId, caseOf(db, project), project.id);
}

const staleNote = waiver => waiver ? ` والإعفاء اللي اعتمده ${waiver.waived_by_name} ما عاد يغطي: معتمده ما عاد يحمل تصريح الإعفاء.` : '';
function purchaseOrderWhy(po) {
  const current = po.current;
  const base = !current ? 'ما انسجّل أمر شراء من العميل على هذا الاتفاق.'
    : current.status === 'void' ? `النسخة ${current.revision} من أمر الشراء ملغاة.`
    : current.status !== 'confirmed' ? `النسخة ${current.revision} من أمر الشراء مسجّلة وما أكّدها أحد غير اللي سجّلها${po.superseded_confirmed ? '، والنسخة المؤكدة قبلها ما عادت تغطي بعد ما حلّت محلها' : ''}.`
    : `النسخة ${current.revision} من أمر الشراء انتهت صلاحيتها في ${current.valid_until}.`;
  return base + staleNote(po.stale_waiver);
}
const advanceWhy = advance => `المؤكَّد ${show(advance.confirmed_minor)} من أصل ${show(advance.expected_minor)} المتفق عليها في جدول الدفعات${advance.reversed_minor ? `، بعد خصم ${show(advance.reversed_minor)} ارتدّت` : ''}.` + staleNote(advance.stale_waiver);

// شكل الرفض مطابق لما تستعمله سلسلة الاستلام (109) ولما يرسمه ui.refusal: {code, doc_key, document, why, owner, owner_role}.
function readinessOf(db, tenantId, c, projectId) {
  const po = purchaseOrderState(db, tenantId, c, projectId), advance = advanceState(db, tenantId, c, projectId), refusals = [];
  if (po.required && !po.satisfied) refusals.push({ code: 'client_po_missing', doc_key: 'client_purchase_order', document: 'أمر شراء العميل',
    why: purchaseOrderWhy(po), owner: ownerName(db, c), owner_role: 'account_manager' });
  if (advance.declared && !advance.satisfied) refusals.push({ code: 'advance_short', doc_key: 'advance_confirmation', document: 'الدفعة المقدمة المؤكدة',
    why: advanceWhy(advance), owner: 'الإدارة المالية', owner_role: 'finance' });
  const waived = (po.required && po.waiver) || (advance.declared && advance.waiver);
  let state = 'ready';
  if (!po.required && !advance.declared) state = 'not_required';
  else if (refusals.some(r => r.code === 'client_po_missing')) state = 'awaiting_client_po';
  else if (refusals.some(r => r.code === 'advance_short')) state = 'awaiting_advance';
  else if (waived) state = 'ready_by_waiver';
  return { state, refusals, client_purchase_order: po, advance,
    allows_paid_execution: refusals.length === 0,
    scoping_note: 'التحديد وما قبل البيع لا تمنعه هذه البوابة إطلاقًا: مشروع بلا جدول دفعات مسجل حرّ تمامًا. الممنوع هو التنفيذ المدفوع.' };
}
export function readinessAxis(db, project) {
  return readinessOf(db, project.tenant_id, caseOf(db, project), project.id);
}
// البوابة كما تُفرض. تُستدعى لحظة كل فعل يلزم مالًا أو يسلّم: ترسية مورد واعتماد أمر شرائه وإذن مباشرته، وتفعيل حزمة عمل،
// وبدء التنفيذ، وتقديم مخرج للقبول، وبدء مهمة تغيير معتمد. تُقرأ من جديد كل مرة، فانعكاس قبضٍ أو سحب إعفاء بعد فعلٍ
// يوقف الفعل الذي يليه — ولا تُخزَّن نتيجتها في أي مكان.
export function assertReadyForPaidExecution(db, tenantId, projectId, what) {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, tenantId);
  if (!project) return;
  const axis = readinessAxis(db, project);
  if (axis.allows_paid_execution) return axis;
  refuse(409, 'advance_required', { what: `${what}: شروط البدء في الاتفاق ما اكتملت`,
    missing: axis.refusals.map(({ document, why, owner, owner_role, doc_key }) => ({ document, why, owner, owner_role, doc_key })),
    next: 'كمّل الناقص، أو اطلب إعفاء بسبب مكتوب يعتمده غيرك ممن يحمل تصريح الإعفاء' });
}

// قراءة الجاهزية على الملف التجاري نفسه، لشاشة «العملاء والعروض»: الناقص ومالكه، ونسخ أمر الشراء، والإعفاءات وطلباتها،
// والأفعال المتاحة لهذا القارئ بقواعد الدوال نفسها. قبل فتح المشروع تُقرأ بلا إعفاءات ولا قبض (كلاهما على المشروع).
export function caseReadiness(db, u, c, { financial = true } = {}) {
  const readiness = readinessOf(db, c.tenant_id, c, c.project_id ?? null), terms = paymentTerms(db, c.id);
  const contract = db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(c.id) ?? null;
  const clientId = db.prepare('SELECT client_id FROM client_links WHERE case_id=?').get(c.id)?.client_id ?? null;
  const member = !!c.project_id && !!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(c.project_id, u.id);
  const writer = c.owner_id === u.id || (u.role === 'manager' && u.department_id === c.department_id);
  const holder = member && can(db, u, WAIVER_CAPABILITY);
  const waivers = c.project_id ? db.prepare('SELECT * FROM readiness_waivers WHERE project_id=? AND tenant_id=? AND withdrawn_at IS NULL ORDER BY waived_at').all(c.project_id, c.tenant_id)
    .map(row => ({ ...waiverView(db, row), valid: can(db, { id: row.waived_by, tenant_id: row.tenant_id }, WAIVER_CAPABILITY) })) : [];
  const requests = c.project_id ? db.prepare("SELECT * FROM readiness_waiver_requests WHERE project_id=? AND tenant_id=? AND status='pending' ORDER BY requested_at").all(c.project_id, c.tenant_id)
    .map(r => ({ id: r.id, item: r.item, item_name: WAIVER_ITEMS[r.item], reason: r.reason, requested_by_name: person(db, r.requested_by), requested_at: r.requested_at, own: r.requested_by === u.id })) : [];
  const current = readiness.client_purchase_order.current, actions = [];
  if (writer && ['quote_approved', 'contracted', 'project_active'].includes(c.status) && !terms.length) actions.push('record_payment_terms');
  if (writer && contract && ['contracted', 'project_active'].includes(c.status)) actions.push('record_client_po');
  if (current?.status === 'recorded' && current.recorded_by !== u.id && ((u.role === 'manager' && u.department_id === c.department_id) || can(db, u, 'contracts.register.manage'))) actions.push('confirm_client_po');
  // يُطلب الإعفاء من شرطٍ ناقص فعلًا، لا معفى عنه بإعفاء ساري ولا عليه طلب معلق؛ وإلا فالزر يفتح نموذجًا بلا خيار.
  const blockedItems = readiness.refusals.map(r => ({ client_po_missing: 'client_po', advance_short: 'advance' })[r.code]).filter(Boolean);
  const requestable = blockedItems.filter(item => !waivers.some(w => w.item === item && w.valid) && !requests.some(r => r.item === item));
  if (member && requestable.length) actions.push('request_readiness_waiver');
  if (holder && requests.some(r => !r.own)) actions.push('authorise_readiness_waiver', 'decline_readiness_waiver');
  if (holder && waivers.length) actions.push('withdraw_readiness_waiver');
  // من لا يرى أرقام الملف (مدير المشروع بعضويته) يرى الناقص ومالكه بلا مبالغ، كما يرى العرض بلا أسعار.
  const blockers = financial ? readiness.refusals : readiness.refusals.map(r => r.code === 'advance_short' ? { ...r, why: 'الدفعة المقدمة ما اكتملت بعد؛ تفاصيل المبلغ عند المالية.' } : r);
  return { state: readiness.state, state_name: axisStateName('readiness', readiness.state), allows_paid_execution: readiness.allows_paid_execution, blockers,
    client_purchase_order: financial ? readiness.client_purchase_order : { required: readiness.client_purchase_order.required, current: current && { revision: current.revision, status: current.status, valid_until: current.valid_until, expired: current.expired }, history: [] },
    advance: financial ? readiness.advance : { declared: readiness.advance.declared },
    terms: financial ? terms.map(t => { const lines = t.condition_kind ? JSON.parse(t.condition_lines) : [];
      return { label: t.label, amount_minor: t.amount_minor, currency: t.currency, due_on: t.due_on, condition: t.condition, is_advance: t.is_advance === 1,
        condition_kind: t.condition_kind ?? null, condition_lines: lines, condition_text: conditionText({ condition_kind: t.condition_kind, lines }) }; }) : [],
    requires_client_po: terms.length ? readiness.client_purchase_order.required : null,
    waivers, requests, requestable, refs: { contract_id: contract?.id ?? null, project_id: c.project_id ?? null, client_id: clientId }, actions };
}

/* ───── محور تقدم التنفيذ ───── */
const EXECUTION_TRANSITIONS = {
  not_started: ['mobilising'], mobilising: ['in_progress', 'on_hold'],
  in_progress: ['on_hold', 'delivered'], on_hold: ['in_progress'], delivered: []
};
const executionRow = (db, projectId) => db.prepare('SELECT * FROM project_execution_states WHERE project_id=?').get(projectId) ?? null;
export function executionAxis(db, project) {
  const row = executionRow(db, project.id);
  const packages = db.prepare('SELECT department_id,status,COUNT(*) AS n FROM work_packages WHERE project_id=? GROUP BY department_id,status').all(project.id);
  const tasks = db.prepare("SELECT COUNT(*) AS open FROM tasks WHERE project_id=? AND status='open'").get(project.id).open;
  return { state: row?.state ?? 'not_started', note: row?.note ?? '', version: row?.version ?? 0,
    changed_by_name: row ? person(db, row.changed_by) : '', changed_at: row?.changed_at ?? null,
    open_tasks: tasks, work_packages: packages, next_states: EXECUTION_TRANSITIONS[row?.state ?? 'not_started'] };
}
export function setExecutionState(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'state', 'note']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const row = executionRow(db, project.id), current = row?.state ?? 'not_started';
  v.version(input.version, row?.version ?? 0);
  if (!EXECUTION_TRANSITIONS[current].includes(input.state)) fail(409, 'transition_denied', `من «${current}» لا يمكن الانتقال إلا إلى: ${EXECUTION_TRANSITIONS[current].join('، ') || 'لا شيء'}`);
  // التنفيذ المدفوع يبدأ عند المباشرة الفعلية، لا عند التعبئة.
  if (input.state === 'in_progress') assertReadyForPaidExecution(db, u.tenant_id, project.id, 'لا يبدأ التنفيذ');
  const note = v.text(input.note, 'أساس تغيير حالة التنفيذ', 2000, 5), time = now();
  if (row) db.prepare('UPDATE project_execution_states SET state=?,note=?,changed_by=?,changed_at=?,version=version+1 WHERE project_id=? AND version=?').run(input.state, note, u.id, time, project.id, row.version);
  else db.prepare('INSERT INTO project_execution_states(project_id,tenant_id,state,note,changed_by,changed_at) VALUES(?,?,?,?,?,?)').run(project.id, u.tenant_id, input.state, note, u.id, time);
  axisEvent(db, u, project.id, 'execution', current, input.state, note);
  audit(db, u, 'project', project.id, 'axes.execution_state', { state: current }, { state: input.state }, note);
  return executionAxis(db, project);
}

/* ───── المحاور المشتقة ───── */
export function acceptanceAxis(db, project) {
  const c = caseOf(db, project), lines = contractLines(db, c);
  if (!c || !lines.length) return { state: 'not_started', accepted_lines: 0, total_lines: 0, pending: 0, outstanding: [], client_evidence: 0 };
  const rows = db.prepare("SELECT d.line_index,r.status FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' WHERE d.case_id=?").all(c.id);
  const accepted = new Set(rows.filter(r => r.status === 'approved').map(r => r.line_index));
  const pending = rows.filter(r => r.status === 'pending').length;
  const evidence = db.prepare("SELECT COUNT(*) AS n FROM external_approvals WHERE tenant_id=? AND project_id=? AND status='verified'").get(project.tenant_id, project.id).n;
  const outstanding = lines.map((line, index) => ({ line_index: index, description: line.description })).filter(line => !accepted.has(line.line_index));
  const state = accepted.size === lines.length ? 'accepted' : accepted.size > 0 ? 'partially_accepted' : pending > 0 ? 'pending_acceptance' : rows.length ? 'pending_acceptance' : 'not_started';
  return { state, accepted_lines: accepted.size, total_lines: lines.length, pending, outstanding, client_evidence: evidence };
}
function claimsOf(db, project) {
  return db.prepare("SELECT * FROM ar_claims WHERE project_id=? AND tenant_id=? AND status<>'cancelled'").all(project.id, project.tenant_id);
}
export function invoicingAxis(db, project) {
  const claims = claimsOf(db, project);
  if (!claims.length) return { state: 'not_invoiced', claims: 0, approved: 0, issued: 0, outstanding: [] };
  const approved = claims.filter(c => c.status === 'approved');
  const issued = approved.filter(c => db.prepare("SELECT 1 FROM tax_invoices WHERE claim_id=? AND kind='invoice' AND status='issued'").get(c.id));
  const state = !approved.length ? 'claims_pending' : !issued.length ? 'claims_approved' : issued.length < approved.length ? 'partially_invoiced' : 'invoiced';
  return { state, claims: claims.length, approved: approved.length, issued: issued.length,
    outstanding: approved.filter(c => !issued.includes(c)).map(c => ({ claim_id: c.id, amount_minor: Number(c.amount_minor), due_date: c.due_date })) };
}
// الصافي بعد الإشعارات الدائنة الصادرة، بالحساب نفسه الذي يسقف به app/receivables.mjs القبض (net):
// استحقاق خُفّض بإشعار دائن كان يبقى هنا «غير محصَّل» بما خُفّض، وهو رصيد لا يقبل القبض أصلًا (over_allocation)،
// فيقف الإقفال المالي على بند لا يُحسم إلا بقرار. و«الصادرة» وحدها تخفض كما هناك: المسودة قد تُرفض.
const creditedOf = (db, claimId) => db.prepare("SELECT COALESCE(SUM(total_minor),0) AS n FROM tax_invoices WHERE claim_id=? AND kind='credit_note' AND status='issued'").get(claimId).n;
const netOf = (db, c) => Math.max(0, Number(c.amount_minor) - creditedOf(db, c.id));
// المحصَّل من منظور التحصيل الواحد (ar_claim_collection، الترحيل 170) بالتعريف نفسه الذي يقرؤه app/receivables.mjs: المؤكد
// غير المرتد من القبض المباشر مع المخصص الحي من القبض على الحساب. القبض المرتد ما عاد محصَّلًا، والتخصيص من مال العميل على
// حسابه محصَّل — وكلاهما كان يُقرأ هنا خطأً حين كان المحصَّل «ar_receipts المؤكدة» وحدها.
const confirmedOf = (db, claimId) => db.prepare('SELECT received_minor+allocated_minor AS n FROM ar_claim_collection WHERE claim_id=?').get(claimId)?.n ?? 0;
export function collectionAxis(db, project) {
  const approved = claimsOf(db, project).filter(c => c.status === 'approved');
  if (!approved.length) return { state: 'nothing_due', due_minor: 0, confirmed_minor: 0, balance_minor: 0, outstanding: [] };
  const outstanding = [];
  let due = 0, confirmed = 0;
  for (const c of approved) {
    const net = netOf(db, c), paid = confirmedOf(db, c.id);
    due += net; confirmed += paid;
    if (paid < net) outstanding.push({ claim_id: c.id, balance_minor: net - paid, due_date: c.due_date, overdue: c.due_date < today() });
  }
  // الحالة من الأرصدة الباقية لا من مجموعين: زيادةٌ على استحقاق لا تسدّ نقصًا على غيره.
  const state = !outstanding.length ? 'collected' : confirmed > 0 ? 'partially_collected' : outstanding.some(o => o.overdue) ? 'overdue' : 'outstanding';
  return { state, due_minor: due, confirmed_minor: confirmed, balance_minor: outstanding.reduce((sum, o) => sum + o.balance_minor, 0), outstanding };
}
// سداد المورد من مصدره الوحيد الصادق: الرؤية payable_balances (الترحيل 166) التي يفرضها قادح الرصيد — المدفوع بسطور الأوامر
// المنفّذة غير الراجعة، والتسويات المعتمدة من المورد، وما في الطريق. لا يُقرأ الحقل الثابت في شاشة المشتريات، ولا «آخر أمر»
// على payment_orders.payable_id: كان المستحق يُعدّ مسدَّدًا متى كان آخر أمر عليه منفّذًا ولو دفع ربعه، والأمر المجمّع يُنسب كله
// لأول مستحق فيه، والتحويل الراجع يبقى «منفّذًا».
const SETTLEMENT_SOURCE = 'payable_balances (payment_orders + payment_order_lines + payment_returns + payable_adjustments) — لا يُقرأ procurement_purchases.payment_status لأنه نص ثابت';
// عبارات BALANCE_STATUS في app/payables.mjs بالحرف: لا تُستورد لأن المدفوعات تستورد المشتريات وهي تستورد هذا الملف (دورة استيراد).
const PAYABLE_STATE = { not_paid: 'ما انحوّل منه شيء', payment_pending: 'عليه أمر دفع ينتظر الاعتماد', payment_approved: 'عليه أمر دفع معتمد ما انحوّل للحين',
  partially_paid: 'انحوّل جزء منه', paid: 'انحوّل كامل', settled: 'ما عليه شيء بعد الإشعارات' };
export function supplierSettlementAxis(db, project) {
  const purchases = db.prepare("SELECT * FROM procurement_purchases WHERE project_id=? AND tenant_id=? AND status NOT IN ('draft','rejected','cancelled')").all(project.id, project.tenant_id);
  if (!purchases.length) return { state: 'none', committed_minor: 0, payable_minor: 0, executed_minor: 0, outstanding: [], source: SETTLEMENT_SOURCE };
  const payables = db.prepare(`SELECT b.*,i.supplier_reference,o.supplier_name FROM procurement_payables pay JOIN payable_balances b ON b.payable_id=pay.id
      JOIN procurement_invoices i ON i.id=pay.invoice_id JOIN procurement_orders o ON o.purchase_id=pay.purchase_id
    WHERE pay.purchase_id IN (${purchases.map(() => '?').join(',')}) ORDER BY pay.created_at,pay.id`).all(...purchases.map(p => p.id));
  const committed = purchases.filter(p => ['ordered', 'part_received', 'received'].includes(p.status)).reduce((sum, p) => sum + p.budget_minor, 0);
  const executed = payables.reduce((sum, p) => sum + p.paid_minor, 0);
  const stateOf = p => p.outstanding_minor <= 0 ? (p.paid_minor > 0 ? 'paid' : 'settled') : p.paid_minor > 0 ? 'partially_paid' : p.approved_minor > 0 ? 'payment_approved' : p.pending_minor > 0 ? 'payment_pending' : 'not_paid';
  const outstanding = payables.filter(p => p.outstanding_minor > 0).map(p => ({ payable_id: p.payable_id, supplier_name: p.supplier_name, supplier_reference: p.supplier_reference,
    amount_minor: p.adjusted_minor, paid_minor: p.paid_minor, in_flight_minor: p.in_flight_minor, outstanding_minor: p.outstanding_minor,
    order_status: p.approved_minor > 0 ? 'approved' : p.pending_minor > 0 ? 'pending' : 'no_order', status: stateOf(p), status_name: PAYABLE_STATE[stateOf(p)] }));
  const state = !payables.length ? 'committed' : !outstanding.length ? 'settled' : outstanding.some(o => o.order_status === 'approved') ? 'payment_approved' : 'invoiced';
  return { state, committed_minor: committed, payable_minor: payables.reduce((sum, p) => sum + p.adjusted_minor, 0), executed_minor: executed, outstanding, source: SETTLEMENT_SOURCE };
}

/* ───── شهادة الإنجاز ───── */
// انتقلت إلى app/completion-certificates.mjs (الترحيل 164): الصادر لا يُعدَّل، وممثل العميل من سجل المفوّضين بسند تفويضه،
// وقبوله دليل خارجي بقناته وحدّها، والتصحيح نسخة جديدة والعكس سجل بسببه. الأسماء باقية هنا لمن يستوردها من المحاور.
export { issueCompletionCertificate, acknowledgeCompletionCertificate, correctCompletionCertificate, reverseCompletionCertificate, getCompletionCertificate } from './completion-certificates.mjs';

/* ───── الإقفال ───── */
// الإقفال سجلات ثابتة (ترحيل 163). كل قفل — فني ثم مالي ثم نهائي — يُكتب صفًا في project_closure_records ومعه
// قائمة تحققه كما قُيِّمت لحظتها: ما فُحص ومن أي مصدر، وكم، وما بقي، وقرار كل باقٍ. الصف لا يُعدَّل ولا يُحذف،
// وإعادة الفتح تنهيه بصف في project_closure_record_ends ولا تمسّه، فيبقى كل إقفال سابق مقروءًا كما كان.
// project_closures إسقاطٌ للحالة الحالية وحدها، ولا يبلغ «مقفل» إلا بسجل ساري يطابقه (قيد project_closures_follow_records).
const closureRow = (db, projectId) => db.prepare('SELECT * FROM project_closures WHERE project_id=?').get(projectId) ?? null;
function ensureClosure(db, u, project) {
  const row = closureRow(db, project.id);
  if (row) return row;
  const c = caseOf(db, project), time = now(), closureId = id();
  db.prepare('INSERT INTO project_closures(id,tenant_id,project_id,case_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(closureId, u.tenant_id, project.id, c?.id ?? null, time, time);
  return closureRow(db, project.id);
}
function closureState(row) {
  if (!row) return 'open';
  if (row.final_state === 'closed') return 'closed';
  if (row.technical_state === 'closed' && row.financial_state === 'closed') return 'awaiting_final';
  if (row.technical_state === 'closed') return 'closed_technically';
  if (row.financial_state === 'closed') return 'closed_financially';
  return 'open';
}
// الحالة وحدها بلا قوائم التحقق: لوحة المحافظ تقرأ حالة كل مشروع، ولا تحتاج أن تعيد تقييم قائمتين لكل صف.
function closureStateOf(db, project) {
  const row = closureRow(db, project.id), state = closureState(row);
  const reopened = row && db.prepare('SELECT 1 FROM project_closure_reopenings WHERE closure_id=? LIMIT 1').get(row.id);
  return reopened && state !== 'closed' ? 'reopened' : state;
}
export const LOCK_NAMES = { technical: 'الإقفال الفني', financial: 'الإقفال المالي', final: 'الإقفال النهائي' };
const latestMargin = (db, projectId) => db.prepare('SELECT * FROM project_margin_acceptances WHERE project_id=? ORDER BY accepted_at DESC,rowid DESC LIMIT 1').get(projectId) ?? null;

// بند قائمة التحقق: ما يُفحص، ومن أين، وكم فُحص، وما بقي بندًا بندًا باسمه ومن يحسمه. decidable يقول هل يُقبل
// في الباقي قرار مكتوب بديلًا عن الحسم («استثناء معتمد» في نص العقد)، وnot_applicable يسمّي ما لا مصدر له في
// المنصة بسببه، فلا يُسكت عنه ولا يُدَّعى أنه فُحص.
const line = (key, label, source, { checked = 0, outstanding = [], decidable = false, not_applicable = [], evidence = null } = {}) =>
  ({ key, label, source, checked, decidable, outstanding, not_applicable, evidence, status: outstanding.length ? 'outstanding' : 'clear' });

// ما يشترطه الإقفال الفني بنص العقد: مخرجات مقبولة، وملاحظات جوهرية معالجة أو مستثناة باعتماد، وحزم عمل مكتملة،
// ودليل محفوظ. المخرج وحزمة العمل والدليل لا تُطوى بقرار: لكلٍّ مساره الذي يحسمه (القبول المستقل، مسار الحزمة،
// الشهادة الموثقة)، والإقفال لا يكون بابًا خلفيًا لتجاوزها. الملاحظة والمهمة تقبلان قرارًا مكتوبًا: الملاحظة لا
// تُغلق في جولة انتهت، والمهمة لا مسار إلغاء لها.
export function technicalChecklist(db, project) {
  const c = caseOf(db, project), acceptance = acceptanceAxis(db, project), manager = person(db, project.created_by) || 'مدير المشروع';
  const deliverables = line('deliverables', 'بنود العقد مقبولة بقرار مستقل', 'commercial_deliveries + commercial_reviews(delivery)', {
    checked: acceptance.total_lines,
    outstanding: acceptance.outstanding.map(l => ({ code: 'deliverable_not_accepted', ref: `line:${l.line_index}`, item: `بند العقد «${l.description}»`,
      why: 'ما انقبل بقرار مستقل للحين.', owner: 'المدير المباشر لمسؤول الحساب', owner_role: 'manager' })),
    not_applicable: c ? [] : [{ topic: 'بنود العقد', reason: 'المشروع بلا ملف تجاري، فما فيه بنود عقد تنقبل' }] });
  const comments = db.prepare(`SELECT a.id,a.body,a.status FROM review_annotations a JOIN review_media m ON m.id=a.media_id JOIN review_routes r ON r.id=m.route_id
      JOIN studio_workspaces w ON w.id=r.studio_id WHERE w.project_id=? AND a.visibility='shared' ORDER BY a.created_at`).all(project.id);
  const defects = line('defects', 'الملاحظات الجوهرية معالجة أو مستثناة باعتماد', 'review_annotations (visibility=shared)', { checked: comments.length, decidable: true,
    outstanding: comments.filter(x => x.status === 'open').map(x => ({ code: 'comment_open', ref: `comment:${x.id}`, item: `ملاحظة جوهرية مفتوحة: «${x.body.slice(0, 60)}»`,
      why: 'تنقفل بمعالجتها في جولة المراجعة، أو باستثناء مكتوب يعتمده اللي يقفل فنيًا.', owner: 'مالك جولة المراجعة', owner_role: 'pm' })) });
  const packages = db.prepare('SELECT id,code,title,status,lead_id FROM work_packages WHERE project_id=? ORDER BY code').all(project.id);
  const workPackages = line('work_packages', 'حزم العمل مسلَّمة أو ملغاة', 'work_packages', { checked: packages.length,
    outstanding: packages.filter(p => ['planned', 'active', 'blocked'].includes(p.status)).map(p => ({ code: 'work_package_open', ref: `work_package:${p.id}`,
      item: `حزمة عمل مفتوحة ${p.code} «${p.title}» (${WORK_PACKAGE_STATUS[p.status]})`, why: 'تتسلّم أو تنلغى من مسار الحزمة نفسه؛ الإقفال ما يطويها بقرار.',
      owner: person(db, p.lead_id) || 'مسؤول الحزمة', owner_role: 'manager' })) });
  const tasks = db.prepare('SELECT id,title,status,assignee_id FROM tasks WHERE project_id=? ORDER BY due_date,id').all(project.id);
  const openTasks = line('tasks', 'مهام المشروع منجزة أو محسومة بقرار', 'tasks', { checked: tasks.length, decidable: true,
    outstanding: tasks.filter(t => t.status === 'open').map(t => ({ code: 'task_open', ref: `task:${t.id}`, item: `مهمة مفتوحة «${t.title}»`,
      why: 'تنقفل بإنجازها من المكلّف، أو بقرار مكتوب إذا ما عاد لها لزوم.', owner: person(db, t.assignee_id) || 'المكلّف بالمهمة', owner_role: 'employee' })) });
  // الشهادة التي يقوم عليها الإقفال (الترحيل 164، app/completion-certificates.mjs): النسخة الحيّة التي قبلها العميل،
  // لا أي صف بحالة «acknowledged» — الصادر لا يُعدَّل، والقبول سجل مستقل بقناته وحدّه، والمستبدلة أو المعكوسة لا تُحسب.
  // والدليل يُنسخ إلى سجل الإقفال نفسه: لو صُحّحت الشهادة بعد إعادة فتح أو تغيّر شيء، يبقى في السجل ما كان محفوظًا يومها.
  const certificate = acceptedCertificate(db, project.id);
  const acceptedBy = certificate ? db.prepare('SELECT * FROM completion_certificate_acceptances WHERE certificate_id=?').get(certificate.id) ?? null : null;
  const accepted = c ? db.prepare(`SELECT d.id,d.line_index,r.id AS review_id,r.evidence_json,r.decided_at FROM commercial_deliveries d
      JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE d.case_id=? ORDER BY d.line_index`).all(c.id) : [];
  const evidence = line('evidence', 'الدليل محفوظ: شهادة إنجاز سارية قبلها العميل، وأدلة القبول', 'completion_certificates (الحيّة) + completion_certificate_acceptances + commercial_reviews(delivery).evidence', {
    checked: accepted.length + (certificate ? 1 : 0),
    outstanding: certificate ? [] : [{ code: 'certificate_missing', ref: 'certificate', item: 'شهادة إنجاز سارية قبلها العميل',
      why: 'تنصدر على المخرجات المقبولة، ويسجّل قبول العميل لها موظف غير اللي أصدرها وغير اللي قبل مخرجاتها.', owner: manager, owner_role: 'pm' }],
    evidence: { certificate: certificate ? { id: certificate.id, number: certificate.number, revision: certificate.revision, scope_summary: certificate.scope_summary,
        evidence: certificate.evidence, approver: JSON.parse(certificate.approver_snapshot || '{}'), customer_representative: certificate.customer_representative,
        delivery_ids: JSON.parse(certificate.delivery_ids),
        // الشهادة الموثقة قبل الترحيل 164 قُبلت بتحديث صفها يومها، فقبولها في صفها لا في سجل مستقل.
        acceptance: acceptedBy ? { channel: acceptedBy.channel, received_on: acceptedBy.received_on, evidence_reference: acceptedBy.evidence_reference,
            limitation: acceptedBy.limitation, recorded_at: acceptedBy.recorded_at, recorded_by_name: person(db, acceptedBy.recorded_by) }
          : { before_164: true, acknowledged_at: certificate.acknowledged_at, evidence_reference: certificate.acknowledgement_evidence } } : null,
      acceptances: accepted.map(a => { const kept = JSON.parse(a.evidence_json); return { delivery_id: a.id, line_index: a.line_index, review_id: a.review_id,
        decided_at: a.decided_at, acceptance_evidence: kept.acceptance_evidence ?? '', customer_representative: kept.customer_representative ?? '' }; }) } });
  return [deliverables, defects, workPackages, openTasks, evidence];
}

const PURCHASE_OPEN = { draft: 'مسودة ما انقدمت', sourcing: 'تجمع العروض', awarded: 'مرسى وما صدر أمره', ordered: 'صدر أمر الشراء وما انستلم', part_received: 'مستلم جزئيًا' };
const JOURNAL_SOURCES = { tax_invoice: 'فاتورة ضريبية', credit_note: 'إشعار دائن', ar_receipt: 'قبض مؤكد', procurement_payable: 'مستحق مورد مطابق',
  supplier_payment: 'دفعة مورد منفذة', expense_claim: 'مطالبة مصروف معتمدة', expense_reimbursement: 'تعويض مصروف',
  ar_receipt_reversal: 'ارتداد قبض', ar_allocation: 'تخصيص قبض على الحساب', ar_allocation_reversal: 'عكس تخصيص', ar_account_receipt: 'قبض على حساب العميل',
  ar_account_reversal: 'ارتداد قبض على الحساب', supplier_payment_return: 'مرتجع دفعة مورد', withholding: 'ضريبة استقطاع',
  advance_receipt: 'قبض دفعة مقدمة', advance_draw: 'سحب من دفعة مقدمة', advance_reversal: 'ارتداد دفعة مقدمة', payable_adjustment: 'إشعار مورد معتمد' };
const MARGIN_OWNER = 'حامل تصريح «ربحية المشاريع والعملاء»';

// ما يشترطه الإقفال المالي بنص العقد، بندًا بندًا من مصدره الحقيقي في المنصة: الذمم المدينة، والتزامات الموردين،
// والمصروفات، والدفعات المقدمة، والأصول، والقيود غير المرحّلة، والضرائب، والإشعارات الدائنة، والمبالغ المستردة،
// ونتيجة الهامش المقبولة. ما لا مصدر له يُسمّى في not_applicable بسببه. الباقي يُحسم من مساره أو بقرار مكتوب يُحفظ
// مع السجل — إلا شرطين لا يُطويان بقرار: الإقفال الفني قبله، والهامش المقبول من غير من يقفل ماليًا.
export function financialChecklist(db, project) {
  const pid = project.id, tid = project.tenant_id, lines = [];
  const technical = closureInForce(db, pid, 'technical');
  lines.push(line('technical', 'المشروع مقفل فنيًا قبل المالي', 'project_closure_records (lock=technical)', { checked: 1,
    outstanding: technical ? [] : [{ code: 'technical_closure_required', ref: 'technical_closure', item: 'الإقفال الفني للمشروع',
      why: 'الإقفال المالي يُبنى على مشروع تسلّم وانقبل وتوثّقت شهادته، فما يسبقه.', owner: person(db, project.created_by) || 'مدير المشروع', owner_role: 'pm' }],
    evidence: technical ? { record_id: technical.id, closed_at: technical.closed_at, closed_by_name: person(db, technical.closed_by) } : null }));

  const claims = db.prepare('SELECT * FROM ar_claims WHERE project_id=? AND tenant_id=? ORDER BY created_at,id').all(pid, tid);
  const invoicing = invoicingAxis(db, project), collection = collectionAxis(db, project);
  // المخرج المقبول بلا استحقاق عمل سُلّم ولم يُطالَب به: ذمة لم تُسجَّل أصلًا، فلا يراها فحص الاستحقاقات وحده.
  // الاستحقاق المرفوض لا يُحتسب مطالبةً (والمنصة لا تقبل استحقاقًا ثانيًا للمخرج نفسه)، فيبقى البند لقرار مكتوب.
  const c = caseOf(db, project), terms = contractLines(db, c);
  const unbilled = c ? db.prepare(`SELECT d.id,d.line_index FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved'
      WHERE d.case_id=? AND NOT EXISTS(SELECT 1 FROM ar_claims a WHERE a.delivery_id=d.id AND a.status NOT IN ('cancelled','rejected')) ORDER BY d.line_index`).all(c.id) : [];
  lines.push(line('receivables', 'الذمم المدينة محسومة: كل مخرج مقبول مطالَب به، وكل استحقاق معتمد مفوتر ومحصَّل صافيه', 'commercial_deliveries + ar_claims + tax_invoices + ar_claim_collection + ar_adjustments + ar_disputes', {
    checked: claims.length + unbilled.length, decidable: true,
    outstanding: [
      ...unbilled.map(d => ({ code: 'delivery_not_billed', ref: `delivery:${d.id}`, item: `مخرج مقبول «${terms[d.line_index]?.description ?? d.line_index + 1}» بلا استحقاق`,
        why: 'ينسجّل استحقاقه ويتفوتر، أو يُقرَّر فيه بسبب مكتوب (مشمول بدفعة ثانية أو متنازل عنه).', owner: 'المالية: معد الاستحقاق', owner_role: 'finance' })),
      ...claims.filter(c => ['draft', 'pending'].includes(c.status)).map(c => ({ code: 'claim_in_progress', ref: `claim:${c.id}`,
        item: `استحقاق (${REQUEST_STATUS_AR[c.status]}) بقيمة ${show(Number(c.amount_minor))}`, why: 'ينعتمد أو ينرفض أو ينلغى قبل الإقفال المالي.',
        owner: 'المالية: معد الاستحقاق ومعتمده', owner_role: 'finance' })),
      ...invoicing.outstanding.map(c => ({ code: 'claim_not_invoiced', ref: `claim:${c.claim_id}`, item: `استحقاق معتمد بلا فاتورة صادرة بقيمة ${show(c.amount_minor)}`,
        why: 'تصدر فاتورته، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: معد الفاتورة ومصدرها', owner_role: 'finance' })),
      ...collection.outstanding.map(c => ({ code: 'claim_not_collected', ref: `claim:${c.claim_id}`, item: `رصيد غير محصَّل ${show(c.balance_minor)} على استحقاق يستحق في ${c.due_date}`,
        why: 'يتحصّل ويتطابق، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: مسجل القبض ومطابقه', owner_role: 'finance' })),
      // الترحيل 170: طلب عكس قبض أو إلغاء استحقاق ينتظر قراره يغيّر ذمة العميل بعد الإقفال إن مرّ، والنزاع المفتوح خلافٌ ما انحسم.
      ...db.prepare("SELECT a.id,a.kind,a.amount_minor FROM ar_adjustments a JOIN ar_claims c ON c.id=a.claim_id WHERE c.project_id=? AND c.tenant_id=? AND a.status='pending' ORDER BY a.created_at,a.rowid").all(pid, tid)
        .map(a => ({ code: a.kind === 'receipt_reversal' ? 'reversal_pending' : 'cancel_pending', ref: `adjustment:${a.id}`,
          item: a.kind === 'receipt_reversal' ? `طلب عكس قبض بقيمة ${show(Number(a.amount_minor))} ينتظر قراره` : 'طلب إلغاء استحقاق ينتظر قراره',
          why: 'ينعتمد أو ينرفض قبل الإقفال المالي؛ قراره يغيّر ذمة العميل.', owner: 'المالية: حامل تفويض الاعتماد غير طالب الطلب', owner_role: 'finance' })),
      ...db.prepare('SELECT d.id,d.amount_minor FROM ar_disputes d JOIN ar_claims c ON c.id=d.claim_id WHERE c.project_id=? AND c.tenant_id=? AND d.resolved_at IS NULL ORDER BY d.opened_at,d.rowid').all(pid, tid)
        .map(d => ({ code: 'dispute_open', ref: `dispute:${d.id}`, item: `نزاع مفتوح مع العميل على ${show(Number(d.amount_minor))}`,
          why: 'يُحسم بسبب مكتوب ودليل من غير اللي فتحه، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: حامل تفويض الاعتماد', owner_role: 'finance' }))] }));

  const purchases = db.prepare("SELECT * FROM procurement_purchases WHERE project_id=? AND tenant_id=? AND status NOT IN ('rejected','cancelled') ORDER BY created_at,id").all(pid, tid);
  // حالة كل فاتورة من وقائعها (الترحيل 169، procurement-guards): المرفوضة والملغاة ليست التزامًا، والموقوفة بفرقٍ بندٌ عند معتمد قرارها
  // لا «فاتورة ما تطابقت»، والمطابَقة محسومة. والمتوقع فوترته ما استُلم ناقص ما رجع، لكل بند من بنود الأمر.
  const invoices = db.prepare(`SELECT i.* FROM procurement_invoices i JOIN procurement_purchases p ON p.id=i.purchase_id WHERE p.project_id=? AND p.tenant_id=? ORDER BY i.created_at,i.id`).all(pid, tid)
    .map(i => ({ ...i, life: invoiceState(db, i) }));
  const orderLines = purchase => db.prepare('SELECT * FROM procurement_order_lines WHERE purchase_id=? ORDER BY line_no').all(purchase.id);
  const quantities = purchase => {
    const lines = orderLines(purchase);
    if (!lines.length) return db.prepare(`SELECT (SELECT COALESCE(SUM(quantity),0) FROM procurement_receipts WHERE purchase_id=?) AS received,
      (SELECT COALESCE(SUM(quantity),0) FROM procurement_invoices WHERE purchase_id=?) AS invoiced`).get(purchase.id, purchase.id);
    const facts = lines.map(line => lineFacts(db, line));
    return { received: facts.reduce((n, f) => n + f.net_received, 0), invoiced: facts.reduce((n, f) => n + Math.min(f.invoiced, f.net_received), 0) };
  };
  const projectPayables = db.prepare(`SELECT y.id,i.supplier_reference FROM procurement_payables y JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_purchases p ON p.id=y.purchase_id
      WHERE p.project_id=? AND p.tenant_id=? ORDER BY y.created_at,y.id`).all(pid, tid);
  const awaitedCredits = projectPayables.flatMap(y => creditRequests(db, y.id).filter(r => r.outstanding_minor > 0).map(r => ({ ...r, supplier_reference: y.supplier_reference })));
  const supplier = supplierSettlementAxis(db, project);
  lines.push(line('supplier_liabilities', 'التزامات الموردين محسومة: لا طلب مفتوح، ولا استلام بلا فاتورة، ولا فاتورة بلا مطابقة، ولا مستحق بلا تحويل',
    'procurement_purchases + procurement_order_lines + procurement_returns + procurement_invoices (حالتها) + procurement_credit_requests + procurement_payables + payable_balances', { checked: purchases.length, decidable: true, outstanding: [
      ...purchases.filter(p => Object.hasOwn(PURCHASE_OPEN, p.status)).map(p => ({ code: 'purchase_open', ref: `purchase:${p.id}`,
        item: `طلب شراء مفتوح «${p.title}» (${PURCHASE_OPEN[p.status]})`, why: 'ينستلم ويتفوتر، أو ينلغى، أو يُقرَّر فيه بسبب مكتوب.',
        owner: person(db, p.requester_id) || 'طالب الشراء', owner_role: 'employee' })),
      ...purchases.filter(p => p.status === 'received').map(p => ({ p, q: quantities(p) })).filter(({ q }) => q.received > q.invoiced).map(({ p, q }) => ({
        code: 'receipt_not_invoiced', ref: `purchase:${p.id}`, item: `استلام من المورد على «${p.title}» بلا فاتورة (${q.received - q.invoiced} من ${q.received})`,
        why: 'تتسجّل فاتورة المورد وتتطابق، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المشتريات: مسجّل فاتورة المورد', owner_role: 'procurement' })),
      ...invoices.filter(i => i.life.state === 'held').map(i => ({ code: 'supplier_invoice_held', ref: `supplier_invoice:${i.id}`,
        item: `فاتورة مورد ${i.supplier_reference} بقيمة ${show(i.amount_minor)} موقوفة بفرق ما انقرر`, why: 'يقرر فيها معتمد مستقل: قبول بمبرر، أو إشعار دائن، أو رفض.',
        owner: 'المشتريات: معتمد قرار فرق الفاتورة', owner_role: 'procurement' })),
      ...invoices.filter(i => i.life.live && !['held', 'matched'].includes(i.life.state)).map(i => ({ code: 'supplier_invoice_unmatched', ref: `supplier_invoice:${i.id}`,
        item: `فاتورة مورد ${i.supplier_reference} بقيمة ${show(i.amount_minor)} ما تطابقت`, why: 'تتطابق مع الأمر والاستلام، أو يُقرَّر فيها بسبب مكتوب.',
        owner: 'المشتريات: مراجع المطابقة', owner_role: 'procurement' })),
      ...awaitedCredits.map(r => ({ code: 'credit_note_awaited', ref: `credit_request:${r.id}`,
        item: `إشعار دائن منتظر من المورد بقيمة ${show(r.outstanding_minor)} على فاتورة ${r.supplier_reference}`, why: 'يصل الإشعار ويُعتمد، أو يُتنازل عن الطلب بسبب مكتوب من معتمده.',
        owner: 'المشتريات: متابع طلب الإشعار الدائن', owner_role: 'procurement' })),
      ...supplier.outstanding.map(pay => ({ code: 'payable_not_settled', ref: `payable:${pay.payable_id}`,
        item: `مستحق مورد ${pay.supplier_name} ${pay.supplier_reference} باقي عليه ${show(pay.outstanding_minor)} من ${show(pay.amount_minor)} (${pay.status_name})`, why: 'يُوثَّق تنفيذ تحويل باقيه، أو يُقرَّر فيه بسبب مكتوب.',
        owner: 'المالية: معد أمر الدفع ومعتمده وموثق تنفيذه', owner_role: 'finance' }))] }));

  const expenses = db.prepare('SELECT id,status,amount_minor,expense_date,custody_id,withdrawn_at FROM expense_claims WHERE project_id=? AND tenant_id=? ORDER BY created_at,id').all(pid, tid);
  lines.push(line('expenses', 'مصروفات المشروع محسومة: معتمدة ومعوَّضة أو مرفوضة', 'expense_claims (project_id)', { checked: expenses.length, decidable: true, outstanding: [
    ...expenses.filter(x => !x.withdrawn_at && ['submitted', 'manager_approved'].includes(x.status)).map(x => ({ code: 'expense_pending', ref: `expense:${x.id}`,
      item: `مطالبة مصروف بقيمة ${show(x.amount_minor)} بتاريخ ${x.expense_date} ${x.status === 'submitted' ? 'عند المدير المباشر' : 'عند المالية'}`,
      why: 'تنعتمد أو تنرفض قبل الإقفال المالي؛ تكلفتها تغيّر هامش المشروع.', owner: x.status === 'submitted' ? 'المدير المباشر لصاحب المطالبة' : 'المالية: معتمد المصروفات',
      owner_role: x.status === 'submitted' ? 'manager' : 'finance' })),
    ...expenses.filter(x => !x.withdrawn_at && x.status === 'finance_approved' && !x.custody_id).map(x => ({ code: 'expense_not_reimbursed', ref: `expense:${x.id}`,
      item: `مصروف معتمد بقيمة ${show(x.amount_minor)} ما تعوّض صاحبه`, why: 'يتوثّق تعويضه، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: موثّق التعويض', owner_role: 'finance' }))] }));

  // المقبوض صافيه بعد الارتداد (الترحيل 160: advance_reversals)، بالقاعدة نفسها التي تقرأ بها البوابة وشاشة الفوترة الرصيد:
  // حوالةٌ ارتدّت ليست مالًا باقيًا ينتظر سحبه على فاتورة، والمرتدّة كلها لا تُبقي بندًا.
  const advances = db.prepare(`SELECT a.*,(SELECT COALESCE(SUM(d.applied_minor),0) FROM advance_draws d WHERE d.advance_id=a.id) AS applied_minor,
      (SELECT COALESCE(SUM(r.amount_minor),0) FROM advance_reversals r WHERE r.advance_id=a.id) AS reversed_minor
      FROM advance_invoices a WHERE a.project_id=? AND a.tenant_id=? ORDER BY a.created_at,a.id`).all(pid, tid);
  // القبض على حساب عميل المشروع (الترحيل 170) مالٌ للعميل عند المنشأة كالدفعة المقدمة: مطابَق ومخصَّص كاملًا على استحقاقاته أو مرتد.
  const accountCash = c ? db.prepare(`SELECT x.id,x.reference,x.status,CAST(x.amount_minor AS INTEGER) AS amount,
      (SELECT COALESCE(SUM(CASE y.kind WHEN 'allocation' THEN CAST(y.amount_minor AS INTEGER) ELSE -CAST(y.amount_minor AS INTEGER) END),0) FROM ar_allocations y WHERE y.account_receipt_id=x.id) AS allocated,
      EXISTS(SELECT 1 FROM ar_account_reversals v WHERE v.account_receipt_id=x.id AND v.status='approved') AS reversed
      FROM ar_account_receipts x WHERE x.case_id=? AND x.tenant_id=? AND x.status<>'rejected' ORDER BY x.created_at,x.rowid`).all(c.id, tid) : [];
  lines.push(line('advances', 'الدفعات المقدمة محسومة: مؤكد قبضها ومسحوبة كاملة على فواتير المشروع', 'advance_invoices (project_id) + advance_draws + advance_reversals + ar_account_receipts + ar_allocations + ar_account_reversals', {
    checked: advances.length + accountCash.length, decidable: true, outstanding: [
      ...accountCash.filter(x => x.status === 'pending').map(x => ({ code: 'account_unconfirmed', ref: `account_receipt:${x.id}`,
        item: `قبض على حساب العميل ${x.reference} بقيمة ${show(x.amount)} ما تطابق`, why: 'يتطابق مع كشف البنك أو ينرفض، أو يُقرَّر فيه بسبب مكتوب.',
        owner: 'المالية: مطابق القبض غير مسجّله', owner_role: 'finance' })),
      ...accountCash.filter(x => x.status === 'confirmed' && !x.reversed && x.amount > x.allocated).map(x => ({ code: 'account_unapplied', ref: `account_receipt:${x.id}`,
        item: `قبض على حساب العميل ${x.reference} باقي منه ${show(x.amount - x.allocated)} ما تخصّص على استحقاق`,
        why: 'يتخصّص على استحقاقات العميل، أو يُقرَّر فيه بسبب مكتوب (رد للعميل أو نقل لاتفاق ثاني).', owner: 'المالية: مخصّص القبض غير مسجّله', owner_role: 'finance' })),
      ...advances.filter(a => a.status === 'recorded').map(a => ({ code: 'advance_unconfirmed', ref: `advance:${a.id}`,
        item: `دفعة مقدمة مسجلة بقيمة ${show(a.amount_minor)} ما تأكد قبضها`, why: 'يتأكد قبضها، أو يُقرَّر فيها بسبب مكتوب.',
        owner: 'المالية: مؤكد قبض الدفعات المقدمة', owner_role: 'finance' })),
      ...advances.filter(a => a.status === 'paid' && a.paid_minor - a.reversed_minor > a.applied_minor).map(a => ({ code: 'advance_unapplied', ref: `advance:${a.id}`,
        item: `دفعة مقدمة مقبوضة بقيمة ${show(a.paid_minor - a.reversed_minor)}${a.reversed_minor ? ` (بعد ارتداد ${show(a.reversed_minor)})` : ''} باقي منها ${show(a.paid_minor - a.reversed_minor - a.applied_minor)} ما انسحب على فاتورة`,
        why: 'تنسحب على فاتورة المشروع، أو يُقرَّر فيها بسبب مكتوب (رد للعميل أو نقل لاتفاق ثاني).', owner: 'المالية: الفوترة الدورية', owner_role: 'finance' }))],
    not_applicable: [
      { topic: 'عهد الموظفين', reason: 'العهدة مربوطة بصاحبها لا بمشروع (custodies بلا project_id)؛ اللي انصرف منها على المشروع يظهر في بند المصروفات' },
      { topic: 'دفعات مقدمة للموردين', reason: 'المنصة ما فيها دفعة مقدمة لمورد: الدفع للمورد يمر من مستحق مطابق فقط' }] }));

  const bookings = db.prepare(`SELECT b.id,b.status,b.custodian_id,i.code,i.name FROM equipment_bookings b JOIN equipment_items i ON i.id=b.item_id
      WHERE b.project_id=? AND b.tenant_id=? ORDER BY b.start_date,b.id`).all(pid, tid);
  lines.push(line('assets', 'أصول الشركة المستعملة على المشروع راجعة', 'equipment_bookings (project_id)', { checked: bookings.length, decidable: true,
    outstanding: bookings.filter(b => ['reserved', 'out'].includes(b.status)).map(b => ({ code: 'equipment_not_returned', ref: `booking:${b.id}`,
      item: `المعدة «${b.name}» (${b.code}) ${b.status === 'out' ? 'طالعة مع المشروع وما رجعت' : 'محجوزة على المشروع'}`,
      why: b.status === 'out' ? 'ترجع وتنستلم، أو ينبلّغ عن فقدها ويُبت فيه.' : 'ينلغى الحجز، أو تطلع المعدة وترجع.',
      owner: person(db, b.custodian_id) || 'صاحب العهدة', owner_role: 'employee' })),
    not_applicable: [{ topic: 'الأصول الثابتة المرسملة على المشروع', reason: 'سجل الأصول الثابتة (fixed_assets) ما يربط الأصل بمشروع، فما فيه أصل مرسمل يتسوّى على مستوى المشروع' }] }));

  // مستندات المشروع التي يبني الدفتر قيدها (app/ledger.mjs وcreateJournalFromPayable)، وقيد كلٍّ منها من رابطه.
  // المستند بلا قيد، أو بقيد لم يُرحَّل، باقٍ — بالقاعدة نفسها التي تحجز بها حزمة إقفال الفترة (R35) الشهر.
  const documents = [
    ...db.prepare("SELECT id,kind,number FROM tax_invoices WHERE project_id=? AND tenant_id=? AND status='issued' ORDER BY issued_at,id").all(pid, tid)
      .map(d => ({ kind: d.kind === 'invoice' ? 'tax_invoice' : 'credit_note', id: d.id, reference: d.number })),
    ...db.prepare("SELECT r.id,r.reference FROM ar_receipts r JOIN ar_claims c ON c.id=r.claim_id WHERE c.project_id=? AND c.tenant_id=? AND r.status='confirmed' ORDER BY r.created_at,r.id").all(pid, tid)
      .map(r => ({ kind: 'ar_receipt', id: r.id, reference: r.reference })),
    // الترحيل 170: ارتداد القبض، والتخصيص وعكسه، والقبض على حساب عميل المشروع وارتداده — مستندات لها قيودها كغيرها.
    ...db.prepare("SELECT a.id,r.reference FROM ar_adjustments a JOIN ar_receipts r ON r.id=a.receipt_id JOIN ar_claims c ON c.id=a.claim_id WHERE c.project_id=? AND c.tenant_id=? AND a.kind='receipt_reversal' AND a.status='approved' ORDER BY a.decided_at,a.rowid").all(pid, tid)
      .map(a => ({ kind: 'ar_receipt_reversal', id: a.id, reference: `REV-${a.reference}` })),
    ...db.prepare('SELECT y.id,y.kind FROM ar_allocations y JOIN ar_claims c ON c.id=y.claim_id WHERE c.project_id=? AND c.tenant_id=? ORDER BY y.created_at,y.rowid').all(pid, tid)
      .map(y => ({ kind: y.kind === 'allocation' ? 'ar_allocation' : 'ar_allocation_reversal', id: y.id, reference: `${y.kind === 'allocation' ? 'ALLOC' : 'ALLOC-REV'}-${y.id.slice(0, 8)}` })),
    ...(c ? db.prepare("SELECT id,reference FROM ar_account_receipts WHERE case_id=? AND tenant_id=? AND status='confirmed' ORDER BY created_at,rowid").all(c.id, tid)
      .map(x => ({ kind: 'ar_account_receipt', id: x.id, reference: x.reference })) : []),
    ...(c ? db.prepare("SELECT v.id,x.reference FROM ar_account_reversals v JOIN ar_account_receipts x ON x.id=v.account_receipt_id WHERE x.case_id=? AND v.tenant_id=? AND v.status='approved' ORDER BY v.decided_at,v.rowid").all(c.id, tid)
      .map(v => ({ kind: 'ar_account_reversal', id: v.id, reference: `REV-${v.reference}` })) : []),
    ...db.prepare(`SELECT y.id,i.supplier_reference FROM procurement_payables y JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_purchases p ON p.id=y.purchase_id
        WHERE p.project_id=? AND p.tenant_id=? ORDER BY y.created_at,y.id`).all(pid, tid).map(y => ({ kind: 'procurement_payable', id: y.id, reference: y.supplier_reference })),
    // إشعار المورد المعتمد (دائن أو مدين أو إلغاء، الترحيل 169) مستندٌ له قيده كغيره، فلا يُقفل المشروع وقيده معلّق.
    ...db.prepare(`SELECT a.id,a.reference FROM payable_adjustments a JOIN procurement_payables y ON y.id=a.payable_id JOIN procurement_purchases p ON p.id=y.purchase_id
        WHERE p.project_id=? AND p.tenant_id=? AND a.status='approved' ORDER BY a.decided_at,a.id`).all(pid, tid).map(a => ({ kind: 'payable_adjustment', id: a.id, reference: a.reference })),
    // دفعة المورد بسطورها (payment_order_lines، الترحيل 166): الأمر المجمّع يمسّ المشروع متى كان أحد سطوره على مستحقٍ منه، لا حين
    // يكون أول سطر فيه فقط (payment_orders.payable_id). والمرتجع وضريبة الاستقطاع على الأمر نفسه مستندان لهما قيداهما.
    ...db.prepare(`SELECT DISTINCT o.id,o.bank_reference,o.created_at FROM payment_orders o JOIN payment_order_lines l ON l.order_id=o.id JOIN procurement_payables y ON y.id=l.payable_id
        JOIN procurement_purchases p ON p.id=y.purchase_id WHERE p.project_id=? AND p.tenant_id=? AND o.status='executed' ORDER BY o.created_at,o.id`).all(pid, tid).map(o => ({ kind: 'supplier_payment', id: o.id, reference: o.bank_reference })),
    ...db.prepare(`SELECT DISTINCT r.id,r.bank_reference,r.created_at FROM payment_returns r JOIN payment_order_lines l ON l.order_id=r.order_id JOIN procurement_payables y ON y.id=l.payable_id
        JOIN procurement_purchases p ON p.id=y.purchase_id WHERE p.project_id=? AND p.tenant_id=? ORDER BY r.created_at,r.id`).all(pid, tid).map(r => ({ kind: 'supplier_payment_return', id: r.id, reference: r.bank_reference })),
    ...db.prepare(`SELECT DISTINCT e.id,e.created_at FROM withholding_entries e JOIN payment_order_lines l ON l.order_id=e.payment_order_id JOIN procurement_payables y ON y.id=l.payable_id
        JOIN procurement_purchases p ON p.id=y.purchase_id WHERE p.project_id=? AND p.tenant_id=? AND e.status IN ('recorded','remitted') AND e.withheld_minor>0 ORDER BY e.created_at,e.id`).all(pid, tid)
      .map(e => ({ kind: 'withholding', id: e.id, reference: `WHT-${e.id.slice(0, 8)}` })),
    // دفعات المشروع المقدمة (advance_invoices.project_id): قبضها، وكل سحب منها على فاتورة، وكل ارتداد — مستندات بقيودها في الدفتر.
    ...db.prepare("SELECT id,receipt_reference FROM advance_invoices WHERE project_id=? AND tenant_id=? AND status='paid' ORDER BY created_at,id").all(pid, tid)
      .map(a => ({ kind: 'advance_receipt', id: a.id, reference: a.receipt_reference ?? `ADV-${a.id.slice(0, 8)}` })),
    ...db.prepare('SELECT x.id,d.target_reference FROM advance_draw_applications x JOIN advance_draws d ON d.id=x.draw_id JOIN advance_invoices a ON a.id=x.advance_id WHERE a.project_id=? AND x.tenant_id=? ORDER BY x.applied_at,x.id').all(pid, tid)
      .map(x => ({ kind: 'advance_draw', id: x.id, reference: x.target_reference })),
    ...db.prepare('SELECT r.id FROM advance_reversals r JOIN advance_invoices a ON a.id=r.advance_id WHERE a.project_id=? AND r.tenant_id=? ORDER BY r.reversed_at,r.id').all(pid, tid)
      .map(r => ({ kind: 'advance_reversal', id: r.id, reference: `ADV-REV-${r.id.slice(0, 8)}` })),
    ...db.prepare("SELECT id,status,receipt_reference,reimbursement_reference FROM expense_claims WHERE project_id=? AND tenant_id=? AND withdrawn_at IS NULL AND status IN ('finance_approved','reimbursed') ORDER BY created_at,id").all(pid, tid)
      .flatMap(x => [{ kind: 'expense_claim', id: x.id, reference: `EXP-${x.receipt_reference}` },
        ...(x.status === 'reimbursed' ? [{ kind: 'expense_reimbursement', id: x.id, reference: x.reimbursement_reference }] : [])])];
  const journalOf = doc => (doc.kind === 'procurement_payable'
    ? db.prepare('SELECT j.id,j.status FROM finance_payable_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.payable_id=?').get(doc.id)
    : db.prepare('SELECT j.id,j.status FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.source_kind=? AND l.source_id=? AND l.tenant_id=?').get(doc.kind, doc.id, tid)) ?? null;
  lines.push(line('journals', 'مستندات المشروع المالية مرحّلة في الدفتر', 'finance_source_links + finance_payable_links + finance_journals', { checked: documents.length, decidable: true,
    outstanding: documents.map(doc => ({ doc, journal: journalOf(doc) })).filter(x => x.journal?.status !== 'posted').map(({ doc, journal }) => journal
      ? { code: 'journal_unposted', ref: `journal:${doc.kind}:${doc.id}`, item: `قيد ${JOURNAL_SOURCES[doc.kind]} ${doc.reference} (${REQUEST_STATUS_AR[journal.status] ?? journal.status}) ما ترحّل`,
          why: 'ينعتمد ويترحّل، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: معتمد القيد ومرحّله', owner_role: 'finance' }
      : { code: 'document_not_journalized', ref: `journal:${doc.kind}:${doc.id}`, item: `${JOURNAL_SOURCES[doc.kind]} ${doc.reference} ما له قيد في الدفتر`,
          why: 'يتولّد قيده من المستند وينعتمد ويترحّل، أو يُقرَّر فيه بسبب مكتوب.', owner: 'المالية: معد القيد', owner_role: 'finance' }) }));

  const untaxed = db.prepare(`SELECT i.id,i.supplier_reference FROM procurement_invoices i JOIN procurement_purchases p ON p.id=i.purchase_id
      WHERE p.project_id=? AND p.tenant_id=? AND NOT EXISTS(SELECT 1 FROM procurement_invoice_tax t WHERE t.invoice_id=i.id AND t.status='verified') ORDER BY i.created_at,i.id`).all(pid, tid);
  // الفاتورة المرفوضة أو الملغاة (الترحيل 169) لا ضريبة مدخلات عليها تُتحقق: ليست التزامًا.
  const liveInvoice = new Set(invoices.filter(i => i.life.live).map(i => i.id));
  lines.push(line('taxes', 'ضريبة مستندات المشروع محسومة', 'procurement_invoice_tax (verified)', { checked: liveInvoice.size, decidable: true,
    outstanding: untaxed.filter(i => liveInvoice.has(i.id)).map(i => ({ code: 'supplier_invoice_untaxed', ref: `invoice:${i.id}`, item: `فاتورة مورد ${i.supplier_reference} بلا سجل ضريبي متحقق منه`,
      why: 'يُتحقق منها، أو يُقرَّر فيها بسبب مكتوب.', owner: 'المالية: مراجع ضريبة المدخلات', owner_role: 'finance' })),
    not_applicable: [
      { topic: 'إقرار ضريبة القيمة المضافة للمشروع', reason: 'الإقرار في المنصة للكيان كله عن فترة (app/tax-returns.mjs) لا لكل مشروع؛ ضريبة فواتير المشروع تدخل إقرار فترتها' },
      { topic: 'تصديق الفواتير الإلكترونية أو الإبلاغ عنها', reason: 'بوابة الفوترة الإلكترونية غير مربوطة (app/einvoice-gateway.mjs)، فما فيه حالة تصديق تنشرط' },
      { topic: 'ضريبة المخرجات على فواتير العميل', reason: 'تنحسب في الفاتورة الضريبية نفسها عند إصدارها؛ الفاتورة اللي ما صدرت تظهر في بند الذمم المدينة' }] }));

  const notes = db.prepare("SELECT id,status,total_minor FROM tax_invoices WHERE project_id=? AND tenant_id=? AND kind='credit_note' ORDER BY created_at,id").all(pid, tid);
  lines.push(line('credits', 'الإشعارات الدائنة محسومة: صادرة أو مرفوضة', 'tax_invoices (kind=credit_note)', { checked: notes.length, decidable: true,
    outstanding: notes.filter(n => ['draft', 'pending'].includes(n.status)).map(n => ({ code: 'credit_note_pending', ref: `credit_note:${n.id}`,
      item: `إشعار دائن (${REQUEST_STATUS_AR[n.status]}) بقيمة ${show(n.total_minor)} ما صدر`, why: 'يصدر أو ينرفض قبل الإقفال المالي؛ يغيّر رصيد العميل وإيراد المشروع.',
      owner: 'المالية: معد الإشعار ومصدره', owner_role: 'finance' })),
    not_applicable: [{ topic: 'إشعارات دائنة من الموردين', reason: 'المنصة ما تسجل إشعارًا دائنًا من مورد؛ تصحيح فاتورة المورد يمر من مطابقتها وسجل ضريبتها' }] }));

  const approved = claims.filter(c => c.status === 'approved');
  const overpaid = approved.map(c => ({ c, net: netOf(db, c), paid: confirmedOf(db, c.id) })).filter(x => x.paid > x.net);
  lines.push(line('refunds', 'ما فيه مبلغ زائد للعميل بلا رد محسوم', 'ar_claim_collection (المؤكد غير المرتد والمخصص الحي) مقابل صافي ar_claims بعد الإشعارات الدائنة الصادرة', { checked: approved.length, decidable: true,
    outstanding: overpaid.map(x => ({ code: 'refund_due', ref: `refund:${x.c.id}`,
      item: `العميل دافع ${show(x.paid)} على استحقاق صافيه ${show(x.net)} بعد الإشعارات الدائنة: له ${show(x.paid - x.net)}`,
      why: 'المنصة ما فيها سجل رد مبلغ؛ الرد يتم في البنك ويُكتب قراره ومرجعه هنا.', owner: 'المالية', owner_role: 'finance' })),
    not_applicable: [{ topic: 'سجل رد المبالغ', reason: 'ما فيه كيان «رد مبلغ» في المنصة، لا للعميل ولا من المورد؛ الزيادة تنكشف هنا من القبض والإشعارات، وحسمها قرار مكتوب في سجل الإقفال' }] }));

  // الرقم نفسه لا يُكتب في القائمة: قائمة الإقفال يقرؤها أعضاء المشروع، والهامش لحامل تصريح الربحية وحده.
  const current = projectMarginFigures(db, tid, pid), accepted = latestMargin(db, pid);
  lines.push(line('margin', 'نتيجة هامش المشروع مقبولة من غير اللي يقفل ماليًا', 'project_margin_acceptances + app/profitability.mjs', { checked: 1,
    outstanding: !accepted ? [{ code: 'margin_not_accepted', ref: 'margin', item: 'نتيجة هامش المشروع',
        why: 'يقبلها حامل تصريح الربحية على الرقم اللي يشوفه، وما يكون هو اللي يقفل ماليًا.', owner: MARGIN_OWNER, owner_role: 'finance' }]
      : accepted.figures_digest !== current.digest ? [{ code: 'margin_stale', ref: 'margin', item: 'نتيجة الهامش المقبولة تغيّرت بعد قبولها',
        why: 'دخلت فاتورة أو تكلفة بعد القبول، فالرقم المقبول ما عاد رقم المشروع؛ ينقبل من جديد.', owner: MARGIN_OWNER, owner_role: 'finance' }] : [],
    evidence: accepted ? { acceptance_id: accepted.id, accepted_by: accepted.accepted_by, accepted_by_name: person(db, accepted.accepted_by),
      accepted_at: accepted.accepted_at, current: accepted.figures_digest === current.digest } : null }));
  return lines;
}
// الشكلان القديمان للقراءة (قائمة الباقي مسطّحة)، لمن يقرؤهما خارج هذه الوحدة: الحساب واحد والعرض اثنان.
export function technicalOutstanding(db, project) {
  const lines = technicalChecklist(db, project);
  return { outstanding: lines.flatMap(l => l.outstanding), certificate: lines.find(l => l.key === 'evidence').evidence.certificate };
}
export const financialOutstanding = (db, project) => financialChecklist(db, project).flatMap(l => l.outstanding);

// بصمة القائمة كما قُيِّمت: البنود، وعدد ما فُحص في كل بند، وكل باقٍ برمزه ومرجعه، ومفتاح الدليل (الشهادة، قبول
// الهامش، سجل الفني). تتغيّر بأي استحقاق أو قيد أو مستند جديد، فيُرفض إقفالٌ على قائمة غير التي راجعها صاحبه
// (checklist_digest)، ويُعرف من السجل أي قائمة أُقفل عليها بالضبط.
function checklistDigest(lines) {
  return hash(JSON.stringify(lines.map(l => [l.key, l.checked, l.outstanding.map(i => [i.code, i.ref]),
    l.evidence?.certificate?.id ?? l.evidence?.acceptance_id ?? l.evidence?.record_id ?? null, l.evidence?.current ?? null])));
}
function expectDigest(lines, input) {
  if (input.checklist_digest === undefined) return;
  if (input.checklist_digest !== checklistDigest(lines)) refuse(409, 'checklist_changed', {
    what: 'قائمة الإقفال تغيّرت بعد ما راجعتها: دخل بند جديد أو انحسم بند',
    next: 'حدّث الشاشة وراجع القائمة كما هي الآن، وبعدها أعد الإقفال' });
}
// «القرار» بديل مقبول عن «الحسم» في البنود التي تقبله، لكنه ليس صمتًا: كل باقٍ يُسمّى ويُعطى قراره، وقرارٌ على بند
// لا يقبله أو لا وجود له يُرد باسمه. الرفض يسمّي كل باقٍ ومن يحسمه، ورمزه رمز أول باقٍ بترتيب القائمة.
function settle(lines, input, lock) {
  if (input.decisions !== undefined && !Array.isArray(input.decisions)) fail(400, 'decisions', 'القرارات قائمة من البنود وقراراتها: [{ref, resolution}]');
  const decisions = input.decisions ?? [];
  if (decisions.length > 60) fail(400, 'decisions', 'حتى ستين قرارًا في الإقفال الواحد');
  const items = new Map(lines.flatMap(l => l.outstanding.map(item => [item.ref, { ...item, decidable: l.decidable }])));
  const decided = new Map();
  for (const decision of decisions) {
    v.object(decision, ['ref', 'resolution']);
    const ref = v.text(decision.ref, 'مرجع البند', 200, 1), resolution = v.text(decision.resolution, 'قرار البند', 2000, 20);
    const target = items.get(ref);
    if (!target) refuse(409, 'decision_unknown_item', { what: `القرار على «${ref}» ما يسمّي بندًا باقيًا في ${LOCK_NAMES[lock]}`,
      next: 'حدّث الشاشة وشوف البنود الباقية الآن، واكتب القرار على بند منها' });
    if (!target.decidable) refuse(409, 'not_decidable', { what: `«${target.item}» ما ينطوي بقرار في ${LOCK_NAMES[lock]}`,
      missing: [{ document: target.item, why: target.why, owner: target.owner, owner_role: target.owner_role, doc_key: target.ref }],
      next: 'احذف القرار عن هذا البند، وخلّ صاحبه يحسمه من مساره' });
    decided.set(ref, resolution);
  }
  const blocking = [...items.values()].filter(item => !decided.has(item.ref));
  if (blocking.length) refuse(409, blocking[0].code, { what: `${LOCK_NAMES[lock]} ما يتم: باقي ${blocking.length} ${blocking.length === 1 ? 'بند' : 'بنود'}`,
    missing: blocking.map(item => ({ document: item.item, why: item.why, owner: item.owner, owner_role: item.owner_role, doc_key: item.ref })),
    next: blocking.some(item => item.decidable) ? 'احسم كل بند من مساره، أو اكتب على البند اللي يقبل قرار قرارًا مسببًا (20 حرفًا على الأقل)' : 'احسم كل بند من مساره، وبعدها أعد الإقفال' });
  return decided;
}
function writeRecord(db, u, project, row, lock, lines, decided, note, { certificate_id = null, margin_acceptance_id = null, same_person_reason = '', extra = {} }, time) {
  const recordId = id(), digest = checklistDigest(lines);
  const checklist = { lock, evaluated_at: time, digest, ...extra, lines: lines.map(l => ({ key: l.key, label: l.label, source: l.source, checked: l.checked, decidable: l.decidable,
    status: l.outstanding.length ? 'decided' : 'clear', not_applicable: l.not_applicable, evidence: l.evidence,
    outstanding: l.outstanding.map(i => ({ code: i.code, ref: i.ref, item: i.item, why: i.why, owner: i.owner, resolution: decided.get(i.ref) ?? '' })) })) };
  db.prepare('INSERT INTO project_closure_records(id,tenant_id,project_id,closure_id,lock,checklist,checklist_digest,note,certificate_id,margin_acceptance_id,same_person_reason,closed_by,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(recordId, u.tenant_id, project.id, row.id, lock, JSON.stringify(checklist), digest, note, certificate_id, margin_acceptance_id, same_person_reason, u.id, time);
  return recordId;
}
// الصف يُحدَّث بنسخته؛ صفر صفوف يعني أن غيره سبقه، فلا يُترك سجلٌ ساري بلا صف يطابقه.
function bumpRow(db, sql, ...args) {
  if (db.prepare(sql).run(...args).changes !== 1) fail(409, 'stale_version', 'تغيّر سجل الإقفال أثناء الحفظ. حدّث الشاشة وأعد المحاولة');
}
// قفلان بيد واحدة (قرار المالك 21 سبتمبر 2026، الخيار «ب»): ممنوع قاعدةً، ويُتجاوز بتصريح حساس وسبب مكتوب.
// يعيد السبب المنقّى إن كان تجاوزًا، وnull إن كان القفلان بيدين مختلفتين. الرفض يسمّي المخرجين معًا:
// شخص آخر يقفل، أو حامل التصريح يتجاوز بسببه — فلا يتجمد الإقفال في شركة يجمع فيها شخص واحد الدورين.
const SAME_PERSON_CAPABILITY = 'projects.closure.same_person';
function samePersonReason(db, u, otherLockBy, input, lockName) {
  if (otherLockBy !== u.id) {
    if (input.same_person_reason !== undefined && input.same_person_reason !== '') fail(400, 'same_person_reason', 'سبب التجاوز يُكتب فقط حين يجتمع القفلان في يد واحدة');
    return null;
  }
  if (input.same_person_reason === undefined || input.same_person_reason === '') refuse(403, 'self_approval', {
    what: `أنت من سجّل القفل الآخر لهذا المشروع، و${lockName} بيدك يجعل القفلين بيد واحدة`,
    missing: [{ document: 'قفل بيد شخص آخر، أو تجاوز بسبب مكتوب', why: 'قفلان بيد واحدة ليسا قفلين', owner: 'حامل تصريح «إقفال المشروع فنيًا وماليًا بيد واحدة»', owner_role: 'manager' }],
    next: `اطلب من شخص آخر مخوَّل أن يسجّل ${lockName}، أو — إن كنت تحمل التصريح — أعد المحاولة واكتب سبب التجاوز (20 حرفًا على الأقل)` });
  if (!can(db, u, SAME_PERSON_CAPABILITY)) refuse(403, 'same_person_not_permitted', {
    what: 'تجاوز قاعدة القفلين بيد واحدة يحتاج تصريحًا حساسًا لا تحمله',
    missing: [{ document: 'تصريح «إقفال المشروع فنيًا وماليًا بيد واحدة»', why: 'التجاوز قرار يُنسب لصاحبه ولا يُفترض لأحد', owner: 'الأدمن الأول', owner_role: 'admin' }],
    next: 'اطلب التصريح من الأدمن الأول، أو اطلب من شخص آخر مخوَّل أن يسجّل القفل' });
  return v.text(input.same_person_reason, 'سبب إقفال المشروع فنيًا وماليًا بيد واحدة', 1000, 20);
}
export function closeTechnically(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['note', 'decisions', 'same_person_reason', 'checklist_digest']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const row = ensureClosure(db, u, project);
  if (row.technical_state === 'closed') fail(409, 'already_closed', 'الإقفال الفني مسجل لهذا المشروع');
  const lines = technicalChecklist(db, project);
  expectDigest(lines, input);
  const decided = settle(lines, input, 'technical');
  // الاتجاه الآخر لقاعدة الشخصين يبقى: إقفال مالي منقول من قبل الترحيل 163 قد يسبق الفني على صف قديم.
  const override = samePersonReason(db, u, row.financial_closed_by, input, 'الإقفال الفني');
  const note = v.text(input.note, 'خلاصة الإقفال الفني', 3000, 20), time = now(), before = closureState(row);
  const certificate = lines.find(l => l.key === 'evidence').evidence.certificate;
  const recordId = writeRecord(db, u, project, row, 'technical', lines, decided, note, { certificate_id: certificate.id, same_person_reason: override ?? '' }, time);
  bumpRow(db, "UPDATE project_closures SET technical_state='closed',technical_closed_by=?,technical_closed_at=?,technical_note=?,certificate_id=?,same_person_reason=?,same_person_at=?,version=version+1,updated_at=? WHERE id=? AND version=?",
    u.id, time, note, certificate.id, override ?? '', override ? time : null, time, row.id, row.version);
  if (override) audit(db, u, 'project', project.id, 'axes.same_person_override', {}, { lock: 'technical', other_lock_by: row.financial_closed_by, record_id: recordId }, override);
  axisEvent(db, u, project.id, 'closure', before, closureState(closureRow(db, project.id)), note);
  audit(db, u, 'project', project.id, 'axes.closed_technically', { closure: before }, { closure: closureState(closureRow(db, project.id)), record_id: recordId,
    certificate: certificate.number, decided: [...decided.keys()] }, note);
  return closureAxis(db, project, u);
}
export function closeFinancially(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['note', 'decisions', 'same_person_reason', 'checklist_digest']);
  // الإقفال المالي سلطة مالية على مستوى الكيان لا عضوية مشروع: المالية لا تُضاف عضوًا
  // في كل مشروع لتقفله، كما لا تُضاف لتعتمد استحقاقه أو أمر دفعه.
  const project = typeof projectId === 'string' && db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, u.tenant_id);
  if (!project) fail(404, 'project_not_found', 'المشروع غير متاح');
  if (!financeCapabilities(db, u).includes('approve')) fail(403, 'financial_action_denied', 'الإقفال المالي لحامل تفويض الاعتماد المالي');
  const row = ensureClosure(db, u, project);
  if (row.financial_state === 'closed') fail(409, 'already_closed', 'الإقفال المالي مسجل لهذا المشروع');
  // نص العقد: لا إقفال مالي قبل الفني. يُرد أولًا وباسمه، قبل أي بند مالي، لأنه لا يُحسم من المالية أصلًا.
  if (!closureInForce(db, project.id, 'technical')) refuse(409, 'technical_closure_required', {
    what: 'ما ينقفل المشروع ماليًا قبل ما ينقفل فنيًا',
    missing: [{ document: 'الإقفال الفني للمشروع', why: 'الإقفال المالي يُبنى على مشروع تسلّم وانقبل وتوثّقت شهادته',
      owner: person(db, project.created_by) || 'مدير المشروع', owner_role: 'pm' }],
    next: 'اطلب من مدير المشروع يقفله فنيًا، وبعدها ارجع للإقفال المالي' });
  const override = samePersonReason(db, u, row.technical_closed_by, input, 'الإقفال المالي');
  const lines = financialChecklist(db, project);
  expectDigest(lines, input);
  const decided = settle(lines, input, 'financial');
  const margin = lines.find(l => l.key === 'margin').evidence;
  // قاعدة الشخصين في المالية: من قبِل نتيجة الهامش لا يقفل عليها. لا تجاوز لها كما لا تجاوز لمعد القيد ومعتمده.
  if (margin.accepted_by === u.id) refuse(403, 'margin_same_person', {
    what: 'أنت اللي قبلت نتيجة الهامش، فما تقفل المشروع ماليًا عليها',
    missing: [{ document: 'إقفال مالي بيد غير اللي قبل الهامش', why: 'القبول والإقفال قراران ماليان، واجتماعهما في يد وحدة يلغي معنى القبول',
      owner: 'حامل تفويض الاعتماد المالي غيرك', owner_role: 'finance' }],
    next: 'اطلب من حامل تفويض اعتماد مالي ثاني يقفل المشروع ماليًا' });
  const note = v.text(input.note, 'خلاصة الإقفال المالي', 3000, 20), time = now(), before = closureState(row);
  const recordId = writeRecord(db, u, project, row, 'financial', lines, decided, note, { margin_acceptance_id: margin.acceptance_id, same_person_reason: override ?? '' }, time);
  bumpRow(db, "UPDATE project_closures SET financial_state='closed',financial_closed_by=?,financial_closed_at=?,financial_note=?,same_person_reason=?,same_person_at=?,version=version+1,updated_at=? WHERE id=? AND version=?",
    u.id, time, note, override ?? '', override ? time : null, time, row.id, row.version);
  if (override) audit(db, u, 'project', project.id, 'axes.same_person_override', {}, { lock: 'financial', other_lock_by: row.technical_closed_by, record_id: recordId }, override);
  axisEvent(db, u, project.id, 'closure', before, closureState(closureRow(db, project.id)), note);
  audit(db, u, 'project', project.id, 'axes.closed_financially', { closure: before }, { closure: closureState(closureRow(db, project.id)), record_id: recordId,
    margin_acceptance_id: margin.acceptance_id, decided: [...decided.keys()] }, note);
  return closureAxis(db, project, u);
}
export function closeFinally(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'profitability_note', 'lessons']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const row = closureRow(db, project.id);
  if (!row) fail(409, 'closure_not_started', 'لم يُقفل هذا المشروع فنيًا ولا ماليًا بعد');
  v.version(input.version, row.version);
  if (row.final_state === 'closed') fail(409, 'already_closed', 'المشروع مقفل نهائيًا');
  const missing = [];
  if (row.technical_state !== 'closed') missing.push({ code: 'technical_open', item: 'الإقفال الفني', why: 'يسبق الإقفال النهائي ولا يُتجاوز.' });
  if (row.financial_state !== 'closed') missing.push({ code: 'financial_open', item: 'الإقفال المالي', why: 'يسبق الإقفال النهائي ولا يُتجاوز.' });
  if (missing.length) fail(409, missing[0].code, `الإقفال النهائي: ${missing.map(m => `${m.item} — ${m.why}`).join(' ')}`);
  const profitability = v.text(input.profitability_note, 'خلاصة الربحية: المخطط والفعلي وسبب الفرق', 5000, 20);
  const lessons = v.text(input.lessons, 'الدروس المستفادة', 5000, 20), time = now(), before = closureState(row);
  const technical = closureInForce(db, project.id, 'technical'), financial = closureInForce(db, project.id, 'financial');
  // الصف لا يبلغ «مقفل» بلا سجل (محفّز 163، والنقل غطّى ما قبله)؛ فغياب السجل هنا عطل يُسمّى لا حالة تُتجاوز.
  if (!technical || !financial) fail(409, 'record_missing', 'الإقفال مسجل في الصف بلا سجل ثابت يطابقه؛ أبلغ مسؤول المنصة قبل الإقفال النهائي');
  const lines = [line('technical', 'الإقفال الفني ساري', 'project_closure_records (lock=technical)', { checked: 1, evidence: { record_id: technical.id, closed_at: technical.closed_at } }),
    line('financial', 'الإقفال المالي ساري', 'project_closure_records (lock=financial)', { checked: 1, evidence: { record_id: financial.id, closed_at: financial.closed_at } })];
  const recordId = writeRecord(db, u, project, row, 'final', lines, new Map(), lessons, { extra: { summary: { profitability_note: profitability, lessons } } }, time);
  bumpRow(db, "UPDATE project_closures SET final_state='closed',final_closed_by=?,final_closed_at=?,profitability_note=?,lessons=?,version=version+1,updated_at=? WHERE id=? AND version=?",
    u.id, time, profitability, lessons, time, row.id, row.version);
  axisEvent(db, u, project.id, 'closure', before, 'closed', lessons);
  audit(db, u, 'project', project.id, 'axes.closed_finally', { closure: before }, { closure: 'closed', record_id: recordId }, profitability);
  return closureAxis(db, project, u);
}
// ما تنهيه إعادة الفتح: السجل الساري من نطاقها، وما بُني عليه. المالي لا يبقى ساريًا على فني أُعيد فتحه
// (نص العقد: لا إقفال مالي قبل الفني)، والنهائي لا يبقى على أيٍّ منهما.
const REOPEN_ENDS = { technical: ['technical', 'financial', 'final'], financial: ['financial', 'final'], final: ['final'] };
export function reopenClosure(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'scope', 'reason']);
  const project = projectOf(db, u, projectId);
  // إعادة الفتح ليست تراجعًا صامتًا: تصريح حساس، وسبب مكتوب، وسجل جديد لا يُمحى، والإقفال السابق باقٍ كما هو.
  if (!can(db, u, 'projects.closure.reopen')) fail(403, 'not_permitted', 'إعادة فتح الإقفال لحامل تصريحها وحده. اطلبه من مسؤول الصلاحيات');
  if (!['technical', 'financial', 'final'].includes(input.scope)) fail(400, 'scope', 'نطاق إعادة الفتح: فني أو مالي أو نهائي');
  const row = closureRow(db, project.id);
  if (!row) fail(404, 'not_found', 'لا سجل إقفال لهذا المشروع');
  v.version(input.version, row.version);
  const reason = v.text(input.reason, 'سبب إعادة الفتح', 3000, 20), before = closureState(row), time = now();
  const closedNow = { technical: row.technical_state, financial: row.financial_state, final: row.final_state }[input.scope];
  if (closedNow !== 'closed') fail(409, 'not_closed', 'هذا النطاق مفتوح أصلًا');
  const ended = REOPEN_ENDS[input.scope].map(lock => closureInForce(db, project.id, lock)).filter(Boolean);
  if (!ended.some(r => r.lock === input.scope)) fail(409, 'record_missing', 'الإقفال مسجل في الصف بلا سجل ثابت يطابقه؛ أبلغ مسؤول المنصة قبل أي إعادة فتح');
  const reopeningId = id();
  db.prepare('INSERT INTO project_closure_reopenings(id,tenant_id,closure_id,scope,from_state,reason,capability,reopened_by,reopened_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(reopeningId, u.tenant_id, row.id, input.scope, before, reason, 'projects.closure.reopen', u.id, time);
  for (const record of ended) db.prepare('INSERT INTO project_closure_record_ends(record_id,reopening_id,tenant_id,cascaded,ended_at) VALUES(?,?,?,?,?)')
    .run(record.id, reopeningId, u.tenant_id, record.lock === input.scope ? 0 : 1, time);
  // فتح ما قبل النهائي يفتح النهائي معه، وفتح الفني يفتح المالي معه: قيد قاعدة البيانات لا يقبل قفلًا فوق ما بُني عليه.
  // وفتح أحد القفلين يُسقط سبب اجتماعهما في يد واحدة عن الصف؛ السبب نفسه باقٍ في سجل الإقفال وفي سجل التدقيق.
  const financialOpen = "financial_state='open',financial_closed_by=NULL,financial_closed_at=NULL,same_person_reason='',same_person_at=NULL";
  const finalOpen = "final_state='open',final_closed_by=NULL,final_closed_at=NULL,profitability_note='',lessons=''";
  const sets = { technical: `technical_state='open',technical_closed_by=NULL,technical_closed_at=NULL,certificate_id=NULL,${financialOpen},${finalOpen}`,
    financial: `${financialOpen},${finalOpen}`, final: finalOpen }[input.scope];
  bumpRow(db, `UPDATE project_closures SET ${sets},version=version+1,updated_at=? WHERE id=? AND version=?`, time, row.id, row.version);
  axisEvent(db, u, project.id, 'closure', before, 'reopened', reason);
  audit(db, u, 'project', project.id, 'axes.closure_reopened', { closure: before }, { scope: input.scope, closure: closureState(closureRow(db, project.id)),
    reopening_id: reopeningId, ended_records: ended.map(r => r.id) }, reason);
  return closureAxis(db, project, u);
}

/* ───── نتيجة الهامش ───── */
// القبول على الرقم الذي رآه القابل بالضبط (figures_digest): إن تغيّر الرقم بين العرض والقبول يُرد ولا يُقبل رقمٌ
// لم يُعرض. تكرار القبول نفسه من الشخص نفسه على الرقم نفسه يعيد القبول القائم ولا يكتب ثانيًا.
export function acceptMargin(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['figures_digest', 'note']);
  const project = typeof projectId === 'string' && db.prepare('SELECT * FROM projects WHERE id=? AND tenant_id=?').get(projectId, u.tenant_id);
  if (!project) fail(404, 'project_not_found', 'المشروع غير متاح في هذا الكيان لحسابك');
  if (!can(db, u, 'profitability.view')) refuse(403, 'not_permitted', { what: 'قبول نتيجة الهامش لحامل تصريح «ربحية المشاريع والعملاء» وحده',
    missing: [{ document: 'تصريح «ربحية المشاريع والعملاء»', why: 'اللي يقبل الرقم لازم يشوفه كاملًا بتحفظاته', owner: 'الأدمن الأول', owner_role: 'admin' }],
    next: 'اطلب التصريح من الأدمن الأول، أو اطلب من حامله يقبل الهامش' });
  if (closureInForce(db, project.id, 'financial')) refuse(409, 'already_closed', { what: 'المشروع مقفل ماليًا، وهامشه انقبل قبل إقفاله',
    next: 'إذا تغيّر شي بعد الإقفال، أعد فتح الإقفال المالي بسبب مكتوب أولًا' });
  const current = projectMarginFigures(db, u.tenant_id, project.id);
  if (input.figures_digest !== current.digest) refuse(409, 'margin_changed', { what: 'أرقام الهامش تغيّرت بعد ما عرضتها الشاشة، أو ما وصلت بصمتها',
    next: 'حدّث الشاشة وراجع الرقم الحالي، وبعدها اقبله' });
  const latest = latestMargin(db, project.id);
  if (latest && latest.accepted_by === u.id && latest.figures_digest === current.digest)
    return { id: latest.id, project_id: project.id, margin_minor: latest.margin_minor, figures_digest: latest.figures_digest, replay: true };
  const note = v.text(input.note, 'أساس قبول الهامش: المخطط والفعلي وسبب الفرق', 3000, 20), time = now(), acceptanceId = id();
  db.prepare('INSERT INTO project_margin_acceptances(id,tenant_id,project_id,figures,figures_digest,margin_minor,note,accepted_by,accepted_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(acceptanceId, u.tenant_id, project.id, JSON.stringify({ ...current.figures, caveats: current.caveats }), current.digest, current.figures.margin_minor, note, u.id, time);
  audit(db, u, 'project', project.id, 'axes.margin_accepted', {}, { acceptance_id: acceptanceId, margin_minor: current.figures.margin_minor, figures_digest: current.digest }, note);
  return { id: acceptanceId, project_id: project.id, margin_minor: current.figures.margin_minor, figures_digest: current.digest, replay: false };
}
// الرقم لحامل تصريح الربحية وحده؛ غيره يقرأ هل قُبل ومن قبله ومتى وهل ما زال هو الرقم الحالي.
function marginView(db, project, u) {
  const latest = latestMargin(db, project.id), current = projectMarginFigures(db, project.tenant_id, project.id);
  const sees = !!u && can(db, u, 'profitability.view');
  return { accepted: !!latest, current: !!latest && latest.figures_digest === current.digest, accepted_by_name: person(db, latest?.accepted_by),
    accepted_at: latest?.accepted_at ?? null, visible: sees,
    ...(sees ? { figures: current.figures, digest: current.digest, caveats: current.caveats, accepted_figures: latest ? JSON.parse(latest.figures) : null, note: latest?.note ?? '' } : {}) };
}
function recordsOf(db, closureId) {
  return db.prepare(`SELECT r.*,e.reopening_id,e.cascaded,e.ended_at FROM project_closure_records r LEFT JOIN project_closure_record_ends e ON e.record_id=r.id
      WHERE r.closure_id=? ORDER BY r.closed_at,r.rowid`).all(closureId).map(r => ({ id: r.id, lock: r.lock, lock_name: LOCK_NAMES[r.lock], origin: r.origin,
    closed_by_name: person(db, r.closed_by), closed_at: r.closed_at, note: r.note, checklist: JSON.parse(r.checklist), checklist_digest: r.checklist_digest,
    certificate_id: r.certificate_id, margin_acceptance_id: r.margin_acceptance_id, same_person_reason: r.same_person_reason,
    in_force: !r.reopening_id, ended: r.reopening_id ? { reopening_id: r.reopening_id, cascaded: !!r.cascaded, ended_at: r.ended_at } : null }));
}
// الإجراءات المعروضة لقارئ بعينه. العرض لا يحرس شيئًا: كل إجراء يُفحص من جديد في دالته، وهذه تقول للشاشة
// أي زر ترسم فقط، بالقواعد نفسها (مدير المشروع للفني والنهائي، تفويض الاعتماد المالي للمالي، الربحية للهامش).
function closureActions(db, u, project) {
  const member = !!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, u.id);
  const manages = member && (project.created_by === u.id || ['manager', 'pm'].includes(u.role));
  const technical = closureInForce(db, project.id, 'technical'), financial = closureInForce(db, project.id, 'financial'), final = closureInForce(db, project.id, 'final');
  const actions = [];
  if (manages && !technical) actions.push('close_technically');
  if (!financial && can(db, u, 'profitability.view')) actions.push('accept_margin');
  if (technical && !financial && financeCapabilities(db, u).includes('approve')) actions.push('close_financially');
  if (manages && technical && financial && !final) actions.push('close_finally');
  if (member && (technical || financial || final) && can(db, u, 'projects.closure.reopen')) actions.push('reopen_closure');
  return actions;
}
export function closureAxis(db, project, u = null) {
  const row = closureRow(db, project.id);
  const reopenings = row ? db.prepare('SELECT * FROM project_closure_reopenings WHERE closure_id=? ORDER BY reopened_at').all(row.id) : [];
  const technical = technicalChecklist(db, project), financial = financialChecklist(db, project);
  const endedBy = row ? db.prepare('SELECT e.reopening_id,e.cascaded,r.lock,r.id FROM project_closure_record_ends e JOIN project_closure_records r ON r.id=e.record_id WHERE r.closure_id=?').all(row.id) : [];
  const shown = lines => lines.map(({ key, label, source, checked, decidable, status, outstanding, not_applicable }) => ({ key, label, source, checked, decidable, status, outstanding, not_applicable }));
  return { state: closureStateOf(db, project), state_name: axisStateName('closure', closureStateOf(db, project)), version: row?.version ?? 0,
    technical_state: row?.technical_state ?? 'open', financial_state: row?.financial_state ?? 'open', final_state: row?.final_state ?? 'open',
    technical_closed_by_name: person(db, row?.technical_closed_by), financial_closed_by_name: person(db, row?.financial_closed_by), final_closed_by_name: person(db, row?.final_closed_by),
    profitability_note: row?.profitability_note ?? '', lessons: row?.lessons ?? '',
    same_person_override: row?.same_person_reason ? { reason: row.same_person_reason, at: row.same_person_at, by_name: person(db, row.financial_closed_by) } : null,
    technical_outstanding: technical.flatMap(l => l.outstanding), financial_outstanding: financial.flatMap(l => l.outstanding),
    technical_checklist: shown(technical), financial_checklist: shown(financial),
    technical_digest: checklistDigest(technical), financial_digest: checklistDigest(financial),
    margin: marginView(db, project, u),
    records: row ? recordsOf(db, row.id) : [],
    reopenings: reopenings.map(r => ({ id: r.id, scope: r.scope, from_state: r.from_state, reason: r.reason, reopened_by_name: person(db, r.reopened_by), reopened_at: r.reopened_at,
      capability: r.capability, ended_records: endedBy.filter(e => e.reopening_id === r.id).map(e => ({ record_id: e.id, lock: e.lock, cascaded: !!e.cascaded })) })),
    allowed_actions: u ? closureActions(db, u, project) : [] };
}
// لوحة الإقفال: مشاريع القارئ، ومعها — لحامل تفويض الاعتماد المالي أو تصريح الربحية — كل مشروع في الكيان أُقفل فنيًا
// ولم يُقفل ماليًا بعد، لأن المالية لا تُضاف عضوًا في كل مشروع لتقفله (وهي القاعدة نفسها في closeFinancially).
export function closureBoard(db, supplied) {
  const u = actor(db, supplied);
  const mine = db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id, u.id);
  const reach = financeCapabilities(db, u).includes('approve') || can(db, u, 'profitability.view');
  const awaiting = reach ? db.prepare(`SELECT p.* FROM projects p WHERE p.tenant_id=? AND EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=p.id AND r.lock='technical' AND ${IN_FORCE})
      AND NOT EXISTS(SELECT 1 FROM project_closure_records r WHERE r.project_id=p.id AND r.lock='financial' AND ${IN_FORCE}) ORDER BY p.created_at DESC`).all(u.tenant_id) : [];
  const seen = new Set(), projects = [];
  for (const project of [...mine, ...awaiting]) if (!seen.has(project.id)) { seen.add(project.id); projects.push(project); }
  return { user_id: u.id, lock_names: LOCK_NAMES,
    projects: projects.map(project => ({ id: project.id, name: project.name, case_id: caseOf(db, project)?.id ?? null, member: mine.some(m => m.id === project.id), closure: closureAxis(db, project, u) })),
    note: 'الإقفال فني ثم مالي ثم نهائي، وكل قفل سجل ثابت بقائمة تحققه كما قُيِّمت يومها. إعادة الفتح سجل جديد بسبب، والإقفال السابق يبقى كما هو.' };
}

/* ───── حزم العمل عبر الإدارات ───── */
export function requestDepartmentParticipation(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['department_id', 'basis']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const department = typeof input.department_id === 'string' && db.prepare('SELECT id,name FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id, u.tenant_id);
  if (!department) fail(400, 'department', 'الإدارة غير موجودة أو مؤرشفة');
  const owning = personDepartment(db, project.created_by);
  if (department.id === owning) fail(409, 'owning_department', 'الإدارة المالكة مشاركة في المشروع أصلًا');
  if (db.prepare('SELECT 1 FROM project_departments WHERE project_id=? AND department_id=?').get(project.id, department.id)) fail(409, 'already_linked', 'هذه الإدارة مشاركة في المشروع أصلًا');
  if (db.prepare("SELECT 1 FROM project_department_requests WHERE project_id=? AND department_id=? AND status='pending'").get(project.id, department.id)) fail(409, 'participation_pending', 'يوجد طلب مشاركة معلّق لهذه الإدارة؛ انتظر قرارها أو راجع الطلب القائم');
  const basis = v.text(input.basis, 'أساس إشراك الإدارة الثانية: أي عمل في المشروع يخصها', 2000, 10), time = now();
  const requestId = id();
  db.prepare('INSERT INTO project_department_requests(id,tenant_id,project_id,department_id,basis,requested_by,requested_at) VALUES(?,?,?,?,?,?,?)')
    .run(requestId, u.tenant_id, project.id, department.id, basis, u.id, time);
  audit(db, u, 'project_department_request', requestId, 'axes.department_participation_requested', {}, { project_id: project.id, department_id: department.id }, basis);
  return { id: requestId, project_id: project.id, department_id: department.id, department_name: department.name, status: 'pending', version: 1 };
}
// الاسم القديم باقٍ لتوافق الاستدعاءات الداخلية، لكن معناه الآن إنشاء طلب ينتظر قرار الإدارة المستقبلة.
export const linkDepartment = requestDepartmentParticipation;

const participationNames = (db, row) => ({ ...row, requested_by_name: personName(db, row.requested_by), decided_by_name: personName(db, row.decided_by) });
const participationRow = (db, requestId) => participationNames(db, db.prepare(`SELECT r.*,p.name AS project_name,d.name AS department_name
  FROM project_department_requests r JOIN projects p ON p.id=r.project_id
  JOIN departments d ON d.id=r.department_id AND d.tenant_id=r.tenant_id
  WHERE r.id=?`).get(requestId));

export function decideDepartmentParticipation(db, supplied, requestId, action, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'note']);
  const row = typeof requestId === 'string' && db.prepare('SELECT * FROM project_department_requests WHERE id=? AND tenant_id=? AND department_id=?').get(requestId, u.tenant_id, u.department_id);
  if (!row || !isDepartmentHead(db, u, row.department_id)) fail(404, 'not_found', 'طلب مشاركة الإدارة غير متاح لك أو لا يقع ضمن صلاحية إدارتك');
  if (row.requested_by === u.id) fail(403, 'self_approval', 'طلب المشاركة منك؛ لازم رئيس إدارة آخر مخوّل يقرر عليه');
  if (row.status !== 'pending') fail(409, 'already_decided', 'صدر قرار على طلب المشاركة ولا يتغير');
  v.version(input.version, row.version);
  const status = { accept_participation: 'accepted', return_participation: 'returned' }[action];
  if (!status) fail(400, 'invalid_action', 'إجراء مشاركة الإدارة غير معروف');
  const note = v.text(input.note, 'سبب قرار المشاركة', 2000, 10), time = now();
  db.prepare(`UPDATE project_department_requests SET status=?,decided_by=?,decided_at=?,decision_note=?,
    decision_role='department_manager',decision_capability='projects.department_participation.decide',version=version+1
    WHERE id=? AND version=?`).run(status, u.id, time, note, row.id, row.version);
  if (status === 'accepted') {
    db.prepare(`INSERT INTO project_departments(project_id,department_id,tenant_id,basis,requested_by,requested_at,approved_by,approved_at,approval_source,request_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(row.project_id, row.department_id, row.tenant_id, row.basis, row.requested_by, row.requested_at, u.id, time, 'actor_decision', row.id);
  }
  audit(db, u, 'project_department_request', row.id, `axes.department_participation_${status}`, { status: row.status, version: row.version }, { status, version: row.version + 1, project_id: row.project_id, department_id: row.department_id }, note);
  const decided = participationRow(db, row.id);
  return { ...decided, status_name: status === 'accepted' ? 'مقبول' : 'معاد للتوضيح', actions: [] };
}
const projectDepartments = (db, project) => {
  const linked = db.prepare('SELECT department_id FROM project_departments WHERE project_id=?').all(project.id).map(r => r.department_id);
  const owning = personDepartment(db, project.created_by);
  return [...new Set([owning, ...linked].filter(Boolean))];
};

export function participationBoard(db, supplied) {
  const u = actor(db, supplied);
  const incoming = isDepartmentHead(db, u, u.department_id)
    ? db.prepare(`SELECT r.*,p.name AS project_name,d.name AS department_name
        FROM project_department_requests r JOIN projects p ON p.id=r.project_id
        JOIN departments d ON d.id=r.department_id AND d.tenant_id=r.tenant_id
        WHERE r.tenant_id=? AND r.department_id=? AND r.status='pending' ORDER BY r.requested_at,r.rowid`).all(u.tenant_id, u.department_id)
      .map(r => ({ ...participationNames(db, r), status_name: 'بانتظار قرار الإدارة', actions: r.requested_by === u.id ? [] : ['accept_participation', 'return_participation'] }))
    : [];
  const projects = db.prepare(`SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id
    WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC`).all(u.tenant_id, u.id).map(project => {
    const manager = projectManagerOfRecord(db, project);
    const requests = db.prepare(`SELECT r.*,d.name AS department_name
      FROM project_department_requests r JOIN departments d ON d.id=r.department_id AND d.tenant_id=r.tenant_id
      WHERE r.project_id=? ORDER BY r.requested_at,r.rowid`).all(project.id).map(r => ({ ...participationNames(db, r),
        status_name: { pending: 'بانتظار قرار الإدارة', accepted: 'مقبول', returned: 'معاد للتوضيح' }[r.status], actions: [] }));
    const links = db.prepare(`SELECT pd.*,d.name AS department_name
      FROM project_departments pd JOIN departments d ON d.id=pd.department_id AND d.tenant_id=pd.tenant_id
      WHERE pd.project_id=? ORDER BY d.name`).all(project.id)
      .map(link => ({ ...link, approved_by_name: personName(db, link.approved_by), source_note: link.approval_source === 'actor_decision' ? 'قرار إلكتروني من الإدارة المستقبلة' : 'سجل سابق لا يثبت قرارًا إلكترونيًا' }));
    const excluded = new Set([...links.map(x => x.department_id), ...requests.filter(x => x.status === 'pending').map(x => x.department_id)]);
    const owning = personDepartment(db, project.created_by);
    if (owning) excluded.add(owning);
    const available_departments = db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id).filter(d => !excluded.has(d.id));
    return { id: project.id, name: project.name, manager, actions: manager.available && manager.id === u.id && available_departments.length ? ['request_participation'] : [], available_departments, requests, links };
  });
  return { user_id: u.id, departments: db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id), incoming, projects,
    note: 'المشاركة لا تبدأ قبل قرار رئيس الإدارة المستقبلة بحسابه. السجلات السابقة تظهر بمصدرها ولا تُنسب إلى قرار إلكتروني بأثر رجعي.' };
}
export function addProjectMember(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['user_id', 'basis']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const member = typeof input.user_id === 'string' && db.prepare("SELECT id,name,department_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id, u.tenant_id);
  if (!member) fail(400, 'user_id', 'الحساب غير متاح');
  if (db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, member.id)) fail(409, 'already_member', 'الحساب عضو في المشروع أصلًا');
  const departments = projectDepartments(db, project);
  if (!departments.includes(member.department_id)) fail(403, 'department_not_linked', `إدارة ${member.name} غير مشاركة في هذا المشروع. أشرِكها أولًا باعتماد مدير منها`);
  const basis = v.text(input.basis, 'أساس إضافة العضو', 1000, 5);
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id, member.id);
  audit(db, u, 'project', project.id, 'axes.member_added', {}, { user_id: member.id, department_id: member.department_id }, basis);
  return { project_id: project.id, user_id: member.id, department_id: member.department_id };
}
export function createWorkPackage(db, supplied, projectId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['code', 'title', 'department_id', 'phase', 'objective', 'lead_id', 'planned_start', 'planned_end', 'acceptance_criteria', 'deliverables', 'budget_id']);
  const project = projectOf(db, u, projectId);
  projectManager(db, u, project);
  const scope = packageScope(db, project, input, { required: false });
  if (!Object.hasOwn(PHASES, input.phase)) fail(400, 'phase', `مرحلة الحزمة إحدى: ${Object.keys(PHASES).join('، ')}`);
  const departments = projectDepartments(db, project);
  if (!departments.includes(input.department_id)) fail(403, 'department_not_linked', 'حزمة العمل تُسند إلى إدارة مشاركة في المشروع. أشرِك الإدارة أولًا باعتماد مدير منها');
  const lead = typeof input.lead_id === 'string' && db.prepare("SELECT id,name,department_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.lead_id, u.tenant_id);
  if (!lead || lead.department_id !== input.department_id) fail(400, 'lead_id', 'مسؤول الحزمة من الإدارة المسؤولة عنها');
  if (!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, lead.id)) fail(400, 'lead_id', `${lead.name} ليس عضوًا في المشروع بعد`);
  const start = v.date(input.planned_start), end = v.date(input.planned_end);
  if (end < start) fail(400, 'planned_end', 'نهاية الحزمة تسبق بدايتها');
  const code = v.text(input.code, 'رمز الحزمة', 40, 1).normalize('NFKC').trim().toUpperCase();
  if (db.prepare('SELECT 1 FROM work_packages WHERE project_id=? AND code=?').get(project.id, code)) fail(409, 'duplicate_code', 'رمز الحزمة مستخدم في هذا المشروع');
  const packageId = id(), time = now();
  db.prepare("INSERT INTO work_packages(id,tenant_id,project_id,department_id,code,title,phase,objective,lead_id,planned_start,planned_end,status,created_by,created_at,updated_at,acceptance_criteria,deliverables,budget_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,'planned',?,?,?,?,?,?)")
    .run(packageId, u.tenant_id, project.id, input.department_id, code, v.text(input.title, 'عنوان الحزمة', 180, 3), input.phase, v.text(input.objective, 'هدف الحزمة ومخرجها', 3000, 10), lead.id, start, end, u.id, time, time,
      scope.acceptance_criteria, JSON.stringify(scope.deliverables), scope.budget_id);
  audit(db, u, 'work_package', packageId, 'axes.work_package_created', {}, { project_id: project.id, department_id: input.department_id, phase: input.phase, code });
  return { id: packageId, code, status: 'planned' };
}
const PACKAGE_TRANSITIONS = { planned: ['active', 'cancelled'], active: ['blocked', 'delivered', 'cancelled'], blocked: ['active', 'cancelled'], delivered: [], cancelled: [] };
export function workPackageAction(db, supplied, packageId, action, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'note', 'evidence']);
  const row = typeof packageId === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND tenant_id=?').get(packageId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'حزمة العمل غير متاحة');
  const project = projectOf(db, u, row.project_id);
  v.version(input.version, row.version);
  const state = { activate: 'active', block: 'blocked', deliver: 'delivered', cancel: 'cancelled' }[action];
  if (!state) fail(400, 'invalid_action', 'إجراء حزمة العمل غير معروف');
  if (!PACKAGE_TRANSITIONS[row.status].includes(state)) fail(409, 'transition_denied', `من «${WORK_PACKAGE_STATUS[row.status]}» لا يمكن الانتقال إلى «${WORK_PACKAGE_STATUS[state]}»`);
  // مسؤول الحزمة يحرّكها داخل إدارته، ومدير المشروع المسجل يحرّك أي حزمة فيه.
  const manager = projectManagerOfRecord(db, project);
  if (row.lead_id !== u.id && (!manager.available || manager.id !== u.id)) fail(403, 'not_permitted', `تحريك هذه الحزمة لمسؤولها ${person(db, row.lead_id)} أو لمدير المشروع المسجل`);
  // تفعيل حزمة عمل إنفاقٌ لوقت مدفوع: تمر ببوابة البدء نفسها التي تمر بها ترسية المورد.
  if (state === 'active') assertReadyForPaidExecution(db, u.tenant_id, project.id, 'لا تُفعَّل حزمة عمل');
  // لا إنجاز بلا دليل (عقد التنفيذ، الحزمة 2 البند 5): التسليم يُقاس على معايير قبولٍ ومخرجاتٍ مكتوبة قبله،
  // ويحمل دليلًا، ولا يسبق ما تعتمد عليه الحزمة، ولا يترك مهمة مفتوحة فيها. والقاعدة تحرس الدليل أيضًا (165).
  const evidence = state === 'delivered' ? deliveryReadiness(db, row, input.evidence) : '';
  const note = v.text(input.note, 'أساس القرار', 2000, 5), time = now();
  if (state === 'delivered') db.prepare('UPDATE work_packages SET status=?,status_note=?,delivery_evidence=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(state, note, evidence, time, row.id, row.version);
  else db.prepare('UPDATE work_packages SET status=?,status_note=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(state, note, time, row.id, row.version);
  audit(db, u, 'work_package', row.id, 'axes.work_package_' + action, { status: row.status }, { status: state }, note);
  return { id: row.id, code: row.code, status: state };
}
export function assignTaskToPackage(db, supplied, taskId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'work_package_id']);
  const task = typeof taskId === 'string' && db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!task) fail(404, 'not_found', 'المهمة غير متاحة');
  const project = projectOf(db, u, task.project_id);
  v.version(input.version, task.version);
  projectManager(db, u, project);
  const pack = typeof input.work_package_id === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND project_id=?').get(input.work_package_id, project.id);
  if (!pack) fail(400, 'work_package_id', 'حزمة العمل لا تتبع هذا المشروع');
  const assignee = db.prepare('SELECT department_id,name FROM users WHERE id=?').get(task.assignee_id);
  // التكليف عبر الإدارات مسموحٌ لمساهمٍ مسجّل في الحزمة — والمساهم عضوٌ في المشروع من إدارةٍ أشركها رئيسها (142).
  // لا يُمنح بهذا تصريحٌ ولا وصولٌ خارج المشروع: التكليف سجلُّ عمل، لا منحة.
  const contributes = db.prepare('SELECT 1 FROM work_package_contributors WHERE package_id=? AND user_id=? AND removed_at IS NULL').get(pack.id, task.assignee_id);
  if (assignee.department_id !== pack.department_id && !contributes) fail(400, 'assignee', `${assignee.name} من إدارة أخرى غير الإدارة المسؤولة عن الحزمة ${pack.code}، وليس مساهمًا مسجّلًا فيها. سجّله مساهمًا أولًا`);
  db.prepare('UPDATE tasks SET work_package_id=?,version=version+1 WHERE id=? AND version=?').run(pack.id, task.id, task.version);
  audit(db, u, 'project', project.id, 'axes.task_assigned_to_package', { task_id: task.id }, { work_package_id: pack.id, code: pack.code });
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
}

/* ───── عمق حزمة العمل: النطاق، والمساهمون، والتبعيات (ترحيل 165) ───── */
// النطاق: معايير القبول والمخرجات ومرجع المخصص. اختيارية عند التخطيط (الحزمة تُبنى على مراحل)،
// ولازمة عند التسليم: لا يُقال «أُنجزت» عن حزمةٍ لم يُكتب ما يُقاس عليه إنجازها.
function packageScope(db, project, input, { required }) {
  const out = { acceptance_criteria: '', deliverables: [], budget_id: null };
  if (input.acceptance_criteria !== undefined || required) out.acceptance_criteria = v.text(input.acceptance_criteria, 'معايير قبول الحزمة', 3000, 10);
  if (input.deliverables !== undefined || required) {
    if (!Array.isArray(input.deliverables) || !input.deliverables.length || input.deliverables.length > 50) fail(400, 'deliverables', 'مخرجات الحزمة قائمة من مخرج واحد إلى خمسين، كلٌّ باسمه');
    out.deliverables = input.deliverables.map((item, index) => v.text(item, `المخرج ${index + 1}`, 300, 3));
  }
  if (input.budget_id !== undefined && input.budget_id !== null) {
    const budget = typeof input.budget_id === 'string' && db.prepare("SELECT id,status FROM project_budgets WHERE id=? AND project_id=? AND tenant_id=?").get(input.budget_id, project.id, project.tenant_id);
    if (!budget) fail(400, 'budget_id', 'المخصص لا يتبع هذا المشروع. اختر مخصصًا من مخصصات المشروع نفسه');
    if (budget.status === 'rejected') fail(409, 'budget_rejected', 'المخصص مرفوض ولا يموّل حزمة. اختر مخصصًا ساريًا أو ما زال ينتظر اعتماده');
    out.budget_id = budget.id;
  }
  return out;
}
export function setWorkPackageScope(db, supplied, packageId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['version', 'acceptance_criteria', 'deliverables', 'budget_id', 'basis']);
  const row = typeof packageId === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND tenant_id=?').get(packageId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'حزمة العمل غير متاحة لك: ليست في مشروعٍ أنت عضوٌ فيه، أو أُغلقت. افتح المشروع وتأكد من رمزها');
  const project = projectOf(db, u, row.project_id);
  v.version(input.version, row.version);
  packageSteward(db, u, project, row);
  if (['delivered', 'cancelled'].includes(row.status)) fail(409, 'package_closed', `الحزمة ${row.code} ${WORK_PACKAGE_STATUS[row.status]}، ونطاقها يبقى كما سُلِّمت عليه`);
  const scope = packageScope(db, project, { acceptance_criteria: input.acceptance_criteria ?? row.acceptance_criteria ?? undefined, deliverables: input.deliverables ?? JSON.parse(row.deliverables || '[]'), budget_id: input.budget_id === undefined ? row.budget_id : input.budget_id }, { required: true });
  const basis = v.text(input.basis, 'أساس تعديل النطاق', 1000, 5), time = now();
  db.prepare('UPDATE work_packages SET acceptance_criteria=?,deliverables=?,budget_id=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(scope.acceptance_criteria, JSON.stringify(scope.deliverables), scope.budget_id, time, row.id, row.version);
  audit(db, u, 'work_package', row.id, 'axes.work_package_scope', { acceptance_criteria: row.acceptance_criteria, deliverables: JSON.parse(row.deliverables || '[]'), budget_id: row.budget_id }, scope, basis);
  return { id: row.id, code: row.code, version: row.version + 1, ...scope };
}
// من يحرّك الحزمة ويعدّل نطاقها ومساهميها: مسؤولها، أو مدير المشروع المسجل.
function packageSteward(db, u, project, row) {
  const manager = projectManagerOfRecord(db, project);
  if (row.lead_id !== u.id && (!manager.available || manager.id !== u.id)) fail(403, 'not_permitted', `هذا لمسؤول الحزمة ${person(db, row.lead_id)} أو لمدير المشروع المسجل`);
}
// جاهزية التسليم: كل ما ينقص يُسمّى بعينه ومن يملكه، لا رفضٌ واحد عام.
// ما ينقص الحزمة لتُسلَّم، سوى الدليل الذي يُكتب لحظة التسليم: تقرؤه بطاقة الحزمة على مسار المشروع فتقول ما بقي قبل
// زر التسليم، ويبني عليه deliveryReadiness رفضه — قائمة واحدة لا اثنتان تفترقان. المخرجات تصل نصًّا من الجدول أو قائمةً من القراءة.
function deliveryGaps(db, row) {
  const missing = [], deliverables = Array.isArray(row.deliverables) ? row.deliverables : JSON.parse(row.deliverables || '[]');
  if (!String(row.acceptance_criteria ?? '').trim()) missing.push({ document: 'معايير قبول الحزمة', owner: person(db, row.lead_id) || 'مسؤول الحزمة', why: 'التسليم يُقاس عليها' });
  if (!deliverables.length) missing.push({ document: 'قائمة مخرجات الحزمة', owner: person(db, row.lead_id) || 'مسؤول الحزمة', why: 'لا تسليم بلا مخرجٍ مسمّى' });
  for (const dep of db.prepare("SELECT w.code,w.status,w.lead_id FROM work_package_dependencies d JOIN work_packages w ON w.id=d.depends_on_id WHERE d.package_id=? AND d.removed_at IS NULL AND w.status<>'delivered' ORDER BY w.code").all(row.id))
    missing.push({ document: `تسليم الحزمة ${dep.code}`, owner: person(db, dep.lead_id) || 'مسؤول تلك الحزمة', why: `هذه الحزمة تعتمد عليها، وحالتها «${WORK_PACKAGE_STATUS[dep.status]}»` });
  const open = db.prepare("SELECT COUNT(*) n FROM tasks WHERE work_package_id=? AND status<>'completed'").get(row.id).n;
  if (open) missing.push({ document: `${open} مهمة مفتوحة في الحزمة`, owner: person(db, row.lead_id) || 'مسؤول الحزمة', why: 'الحزمة تُسلَّم حين تُنجز مهامها' });
  return missing;
}
function deliveryReadiness(db, row, evidenceInput) {
  const missing = deliveryGaps(db, row);
  const evidence = typeof evidenceInput === 'string' ? evidenceInput.trim() : '';
  if (evidence.length < 20) missing.push({ document: 'دليل الإنجاز', owner: person(db, row.lead_id) || 'مسؤول الحزمة', why: 'وصفٌ مكتوب لما سُلِّم وأين يُراجَع — عشرون حرفًا على الأقل' });
  if (missing.length) refuse(409, 'package_not_deliverable', { what: `لا تُسلَّم الحزمة ${row.code} بعد`, missing, next: 'أكمل الناقص ثم سلّم الحزمة بدليلها' });
  return v.text(evidence, 'دليل الإنجاز', 4000, 20);
}
export function addWorkPackageContributor(db, supplied, packageId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['user_id', 'contribution']);
  const row = typeof packageId === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND tenant_id=?').get(packageId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'حزمة العمل غير متاحة لك: ليست في مشروعٍ أنت عضوٌ فيه. افتح المشروع وتأكد من رمزها');
  const project = projectOf(db, u, row.project_id);
  packageSteward(db, u, project, row);
  if (['delivered', 'cancelled'].includes(row.status)) fail(409, 'package_closed', `الحزمة ${row.code} ${WORK_PACKAGE_STATUS[row.status]} ولا يُضاف إليها مساهم`);
  const member = typeof input.user_id === 'string' && db.prepare("SELECT u.id,u.name,u.department_id FROM users u JOIN project_members m ON m.user_id=u.id WHERE u.id=? AND u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND m.project_id=?").get(input.user_id, u.tenant_id, project.id);
  if (!member) fail(400, 'user_id', 'المساهم عضوٌ نشط في المشروع. أضِفه عضوًا أولًا من إدارةٍ مشاركة');
  if (db.prepare('SELECT 1 FROM work_package_contributors WHERE package_id=? AND user_id=? AND removed_at IS NULL').get(row.id, member.id)) fail(409, 'already_contributor', `${member.name} مساهمٌ في الحزمة ${row.code} أصلًا`);
  const contributionId = id(), contribution = v.text(input.contribution, 'دور المساهم في الحزمة', 500, 5);
  db.prepare('INSERT INTO work_package_contributors(id,tenant_id,package_id,user_id,department_id,contribution,added_by,added_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(contributionId, u.tenant_id, row.id, member.id, member.department_id, contribution, u.id, now());
  audit(db, u, 'work_package', row.id, 'axes.work_package_contributor_added', {}, { user_id: member.id, department_id: member.department_id }, contribution);
  return { id: contributionId, package_id: row.id, user_id: member.id, department_id: member.department_id };
}
export function removeWorkPackageContributor(db, supplied, contributionId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['reason']);
  const c = typeof contributionId === 'string' && db.prepare('SELECT * FROM work_package_contributors WHERE id=? AND tenant_id=?').get(contributionId, u.tenant_id);
  if (!c) fail(404, 'not_found', 'المساهمة غير متاحة: لا سجلَّ بهذا المعرّف في حزم مشاريعك. افتح الحزمة واختر المساهم من قائمتها');
  const row = db.prepare('SELECT * FROM work_packages WHERE id=?').get(c.package_id);
  packageSteward(db, u, projectOf(db, u, row.project_id), row);
  if (c.removed_at) fail(409, 'already_removed', 'أُغلقت هذه المساهمة من قبل، وسجلّها باقٍ كما هو');
  // مهمةٌ مسندة إليه في الحزمة لا تُترك بلا مسؤول: تُعاد أولًا ثم تُغلق المساهمة.
  const held = db.prepare("SELECT COUNT(*) n FROM tasks WHERE work_package_id=? AND assignee_id=? AND status<>'completed'").get(row.id, c.user_id).n;
  if (held) fail(409, 'contributor_holds_tasks', `لدى ${person(db, c.user_id)} ${held} مهمة مفتوحة في الحزمة ${row.code}. أعد إسنادها أولًا`);
  const reason = v.text(input.reason, 'سبب إغلاق المساهمة', 1000, 5);
  db.prepare('UPDATE work_package_contributors SET removed_by=?,removed_at=?,removed_reason=? WHERE id=? AND removed_at IS NULL').run(u.id, now(), reason, c.id);
  audit(db, u, 'work_package', row.id, 'axes.work_package_contributor_removed', { user_id: c.user_id }, {}, reason);
  return { id: c.id, removed: true };
}
export function addWorkPackageDependency(db, supplied, packageId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['depends_on_id', 'basis']);
  const row = typeof packageId === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND tenant_id=?').get(packageId, u.tenant_id);
  if (!row) fail(404, 'not_found', 'حزمة العمل غير متاحة لك: ليست في مشروعٍ أنت عضوٌ فيه. افتح المشروع وتأكد من رمزها');
  const project = projectOf(db, u, row.project_id);
  // التبعية تربط إدارتين، فقرارها لمدير المشروع المسجل وحده لا لمسؤول إحدى الحزمتين.
  projectManager(db, u, project);
  const target = typeof input.depends_on_id === 'string' && db.prepare('SELECT * FROM work_packages WHERE id=? AND project_id=? AND tenant_id=?').get(input.depends_on_id, project.id, u.tenant_id);
  if (!target) fail(400, 'depends_on_id', 'الحزمة المعتمَد عليها من هذا المشروع نفسه');
  if (target.id === row.id) fail(400, 'depends_on_id', 'الحزمة لا تعتمد على نفسها. اختر حزمةً أخرى من المشروع تنتظرها هذه');
  if (db.prepare('SELECT 1 FROM work_package_dependencies WHERE package_id=? AND depends_on_id=? AND removed_at IS NULL').get(row.id, target.id)) fail(409, 'duplicate_dependency', `${row.code} تعتمد على ${target.code} أصلًا`);
  // الحلقة تُسمّى بمسارها: من الحزمة المعتمَد عليها رجوعًا إلى هذه. والقاعدة ترفضها أيضًا (165) لو فات هذا.
  const cycle = dependencyPath(db, target.id, row.id);
  if (cycle) fail(409, 'dependency_cycle', `التبعية تُغلق حلقة: ${[row.code, ...cycle].join(' ← ')}. الحزمة لا تنتظر ما ينتظرها`);
  const dependencyId = id(), basis = v.text(input.basis, 'سبب التبعية', 1000, 5);
  db.prepare('INSERT INTO work_package_dependencies(id,tenant_id,package_id,depends_on_id,basis,added_by,added_at) VALUES(?,?,?,?,?,?,?)').run(dependencyId, u.tenant_id, row.id, target.id, basis, u.id, now());
  audit(db, u, 'work_package', row.id, 'axes.work_package_dependency_added', {}, { depends_on_id: target.id, code: target.code }, basis);
  return { id: dependencyId, package_id: row.id, depends_on_id: target.id };
}
export function removeWorkPackageDependency(db, supplied, dependencyId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['reason']);
  const d = typeof dependencyId === 'string' && db.prepare('SELECT * FROM work_package_dependencies WHERE id=? AND tenant_id=?').get(dependencyId, u.tenant_id);
  if (!d) fail(404, 'not_found', 'التبعية غير متاحة: لا سجلَّ بهذا المعرّف في حزم مشاريعك. افتح الحزمة واختر التبعية من قائمتها');
  const row = db.prepare('SELECT * FROM work_packages WHERE id=?').get(d.package_id);
  projectManager(db, u, projectOf(db, u, row.project_id));
  if (d.removed_at) fail(409, 'already_removed', 'أُغلقت هذه التبعية من قبل، وسجلّها باقٍ كما هو');
  const reason = v.text(input.reason, 'سبب إغلاق التبعية', 1000, 5);
  db.prepare('UPDATE work_package_dependencies SET removed_by=?,removed_at=?,removed_reason=? WHERE id=? AND removed_at IS NULL').run(u.id, now(), reason, d.id);
  audit(db, u, 'work_package', row.id, 'axes.work_package_dependency_removed', { depends_on_id: d.depends_on_id }, {}, reason);
  return { id: d.id, removed: true };
}
// مسارٌ من «from» إلى «to» على التبعيات الحية، برموز الحزم — أو null. للرسالة وحدها: الحارس في القاعدة.
function dependencyPath(db, from, to) {
  const edges = db.prepare('SELECT package_id,depends_on_id FROM work_package_dependencies WHERE removed_at IS NULL').all();
  const next = new Map();for (const e of edges) (next.get(e.package_id) ?? next.set(e.package_id, []).get(e.package_id)).push(e.depends_on_id);
  const code = pid => db.prepare('SELECT code FROM work_packages WHERE id=?').get(pid)?.code ?? pid;
  const seen = new Set(), walk = (node, path) => {
    if (node === to) return path;
    if (seen.has(node)) return null; seen.add(node);
    for (const n of next.get(node) ?? []) { const found = walk(n, [...path, code(n)]); if (found) return found; }
    return null;
  };
  return walk(from, [code(from)]);
}

/* ───── أمر المباشرة للمورد ───── */
// أمر الشراء التزامٌ بالشراء، وأمر المباشرة إذنٌ للمورد يبدأ الشغل: في الإنتاج والفعاليات هو الفرق بين «تعاقدنا»
// و«ابدأ التصوير بكرة». صدر أول مرة بالترحيل 116 سجلًّا واحدًا لكل طلب؛ والترحيل 162 جعله تاريخًا لا يُمحى:
// كل إذن مربوط بنسخة أمر الشراء التي صدر عليها، وله أول يوم وآخر يوم يسري فيهما، ودليلُ إبلاغ المورد،
// ويُستبدل بإذن جديد يشير إليه، ويُسحب بسجل مستقل — والقديم يبقى مقروءًا بحاله. «القائم» مشتق لا مخزَّن:
// إذنٌ لم يُسحب ولم يُستبدل، ولا يقوم لطلب واحد إلا إذنٌ واحد. والقاعدة تحرس الشيء نفسه بمُطلِقاتها.
export const COMMENCEMENT_FIELDS = ['start_on', 'valid_until', 'site_or_channel', 'scope_confirmation', 'evidence'];
export const COMMENCEMENT_STATES = { live: 'قائم', replaced: 'مستبدَل', withdrawn: 'مسحوب' };
export const COMMENCEMENT_VALIDITY = { active: 'ساري اليوم', not_started: 'ما بدأ سريانه', expired: 'انتهى سريانه',
  stale: 'على نسخة سابقة من أمر الشراء', incomplete: 'بلا مدة سريان ولا دليل' };
// صاحب القرار في كل رفض أدناه: من يأذن للمورد هو من يوقفه ومن يستبدل إذنه.
const COMMENCEMENT_OWNER = 'مدير الفريق أو مدير المشروع في نطاق الطلب — غير طالب الشراء';
// اليوم الذي يُحسب عليه السريان يوم الرياض، كما تحسبه مُطلِقات الترحيل 162 بـdate(x,'+3 hours').
const riyadhDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// كل أوامر المباشرة على الطلب بترتيب صدورها، ولكل واحد حاله: قائم أو مستبدَل أو مسحوب، ومن حلّ محله، وسجل سحبه.
export function commencementHistory(db, purchaseId) {
  const rows = db.prepare('SELECT * FROM commencement_authorisations WHERE purchase_id=? ORDER BY sequence').all(purchaseId);
  const withdrawals = new Map(db.prepare('SELECT * FROM commencement_withdrawals WHERE purchase_id=?').all(purchaseId).map(w => [w.authorisation_id, w]));
  const replacedBy = new Map(rows.filter(r => r.replaces_id).map(r => [r.replaces_id, r.id]));
  return rows.map(row => {
    const withdrawal = withdrawals.get(row.id) ?? null, state = withdrawal ? 'withdrawn' : replacedBy.has(row.id) ? 'replaced' : 'live';
    return { ...row, state, state_name: COMMENCEMENT_STATES[state], issued_by_name: person(db, row.issued_by), replaced_by: replacedBy.get(row.id) ?? null,
      withdrawal: withdrawal && { ...withdrawal, withdrawn_by_name: person(db, withdrawal.withdrawn_by) } };
  });
}

// هل يفتح الإذن القائم الاستلام اليوم؟ الترتيب يسمّي السبب الأعمق أولًا: إذنٌ بلا مدة ولا دليل، ثم إذنٌ على نسخة أمر
// سابقة، ثم تاريخ بدء لم يحن، ثم سريان انتهى.
function validityOf(db, row, day = today()) {
  const order = db.prepare('SELECT id FROM procurement_orders WHERE purchase_id=?').get(row.purchase_id);
  const current = orderVersion(db, order.id);
  const state = row.valid_until === null ? 'incomplete' : row.order_version !== current ? 'stale'
    : day < row.start_on ? 'not_started' : day > row.valid_until ? 'expired' : 'active';
  return { state, name: COMMENCEMENT_VALIDITY[state], day, order_version: current, satisfies_receipt: state === 'active' };
}

// الإذن القائم ومعه حكم سريانه، أو null. الاسم باقٍ كما صدّره الترحيل 116: تقرؤه المشتريات والاختبارات.
export function commencementOf(db, purchaseId) {
  const live = commencementHistory(db, purchaseId).find(a => a.state === 'live');
  return live ? { ...live, validity: validityOf(db, live) } : null;
}

// من يصدر الإذن أو يستبدله أو يسحبه: بعد أمر شراء معتمد وقبل اكتمال الاستلام، ومراجعٌ غير طالب الشراء (معيار
// approve_order نفسه، الترحيل 005)، وما عنده إفصاح تعارض مع المورد لم يُبت فيه أو قرار تنحٍّ عنه (معيار الترسية
// واعتماد الأمر، procurement-guards.mjs). الطالب والدور يُحرسان في القاعدة أيضًا (الترحيل 162).
function commencementContext(db, u, purchaseId) {
  const purchase = typeof purchaseId === 'string' && db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(purchaseId, u.tenant_id);
  if (!purchase) refuse(404, 'not_found', { what: 'ما لقينا طلب الشراء هذا في نطاقك',
    next: 'افتح الطلب من شاشة المشتريات، وإذا ما ظهر لك فاطلب من مدير المشروع يضيفك لفريقه' });
  projectOf(db, u, purchase.project_id);
  const order = db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(purchase.id);
  if (!order || !['ordered', 'part_received'].includes(purchase.status)) refuse(409, 'order_required', {
    what: purchase.status === 'received' ? 'اكتمل الاستلام على هذا الطلب، فما عاد له أمر مباشرة يصدر أو يتغيّر' : 'أمر المباشرة يلي أمر شراء معتمد وما يسبقه',
    missing: purchase.status === 'received' ? [] : [{ document: 'أمر شراء معتمد على الطلب', why: 'الإذن للمورد يبدأ على أمر معتمد بقيمته وشروطه', owner: 'مراجع المشتريات في نطاق الطلب', owner_role: 'manager' }],
    next: purchase.status === 'received' ? 'راجع محاضر الاستلام في الطلب نفسه' : 'اعتمد أمر الشراء أول، وبعدها أصدر أمر المباشرة' });
  if (purchase.requester_id === u.id) refuse(403, 'self_approval', { what: 'طالب الشراء ما يأذن للمورد يبدأ على طلبه ولا يوقفه',
    missing: [{ document: 'قرار من مراجع غير طالب الشراء', why: 'فصل المهام نفسه اللي في اعتماد أمر الشراء', owner: COMMENCEMENT_OWNER, owner_role: 'manager' }],
    next: 'خلّ مراجع الطلب يتخذ القرار من شاشة المشتريات' });
  if (!['manager', 'pm'].includes(u.role)) refuse(403, 'not_permitted', { what: 'أمر المباشرة يصدره ويستبدله ويسحبه مدير الفريق أو مدير المشروع',
    missing: [{ document: 'قرار من مدير الفريق أو مدير المشروع', why: 'الإذن للمورد يبدأ على مال المشروع', owner: COMMENCEMENT_OWNER, owner_role: 'manager' }],
    next: 'ارفع الطلب لمديرك يتخذ القرار' });
  const block = conflictBlock(db, u.tenant_id, u.id, order.supplier_key);
  if (block) refuse(409, 'conflict_of_interest', { what: 'لك إفصاح تعارض مصالح مع هذا المورد، فما تقرر على أمر مباشرته',
    missing: [{ document: 'قرار من مراجع ما عنده تعارض مع المورد', why: block === 'recused' ? 'تنحّيت عن قرارات هذا المورد بقرار تعارض مصالح' : 'إفصاحك عن علاقتك بالمورد ما انبت فيه بعد',
      owner: 'مراجع ثاني في نطاق الطلب', owner_role: 'manager' }],
    next: 'خلّ مراجعًا ثانيًا يتخذ القرار على أمر المباشرة' });
  return { purchase, order };
}

function commencementDay(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    refuse(400, 'invalid_date', { what: `${label}: التاريخ ناقص أو مو صحيح`, next: 'اكتبه بصيغة سنة-شهر-يوم، مثل 2026-10-04' });
  return value;
}

// ما يُكتب في كل إذن جديد — إصدارًا أو استبدالًا — بعد فحص تواريخه. النسخة والرقم يُحسبان هنا لا يُقبلان من المدخل.
function commencementRecord(db, order, history, input) {
  const start = commencementDay(input.start_on, 'تاريخ بدء المورد'), until = commencementDay(input.valid_until, 'آخر يوم يسري فيه الإذن');
  const ordered = riyadhDay(order.created_at);
  if (start < ordered) refuse(400, 'start_before_order', { what: `تاريخ البدء ${start} قبل اعتماد أمر الشراء في ${ordered}`,
    next: 'المورد ما يبدأ قبل أمر الشراء؛ اكتب تاريخ بدء من يوم اعتماد الأمر أو بعده' });
  if (until < start) refuse(400, 'validity_before_start', { what: `آخر يوم للسريان ${until} قبل تاريخ البدء ${start}`,
    next: 'اكتب آخر يوم يسري فيه الإذن في يوم البدء أو بعده' });
  if (until < today()) refuse(400, 'validity_passed', { what: `آخر يوم للسريان ${until} فات`,
    next: 'اكتب آخر يوم يُسمح فيه للمورد يسلّم على هذا الإذن، من اليوم أو بعده' });
  return { start_on: start, valid_until: until, order_version: orderVersion(db, order.id), sequence: history.length + 1,
    site_or_channel: v.text(input.site_or_channel, 'موقع التنفيذ أو قناته', 300, 3),
    scope_confirmation: v.text(input.scope_confirmation, 'النطاق اللي يبدأ عليه المورد', 3000, 10),
    evidence: v.text(input.evidence, 'دليل إبلاغ المورد بالإذن', 3000, 10) };
}

function insertCommencement(db, u, purchase, order, record, replaces = null, reason = null) {
  const authorisationId = id(), time = now();
  db.prepare('INSERT INTO commencement_authorisations(id,tenant_id,purchase_id,sequence,order_id,order_version,start_on,valid_until,site_or_channel,scope_confirmation,evidence,replaces_id,replacement_reason,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(authorisationId, u.tenant_id, purchase.id, record.sequence, order.id, record.order_version, record.start_on, record.valid_until,
      record.site_or_channel, record.scope_confirmation, record.evidence, replaces, reason, u.id, time);
  return { id: authorisationId, purchase_id: purchase.id, order_id: order.id, sequence: record.sequence, order_version: record.order_version,
    start_on: record.start_on, valid_until: record.valid_until, issued_by_name: u.name };
}

export function authoriseCommencement(db, supplied, purchaseId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, COMMENCEMENT_FIELDS);
  const { purchase, order } = commencementContext(db, u, purchaseId), history = commencementHistory(db, purchase.id);
  const live = history.find(a => a.state === 'live');
  if (live) refuse(409, 'already_commenced', { what: `فيه أمر مباشرة قائم على هذا الطلب (رقم ${live.sequence})، وما يقوم أمران مع بعض`,
    next: 'إذا تغيّر شي في الإذن استبدله، وإذا لازم يوقف المورد اسحبه' });
  assertReadyForPaidExecution(db, u.tenant_id, purchase.project_id, 'لا يُؤذن للمورد بالمباشرة');
  const row = insertCommencement(db, u, purchase, order, commencementRecord(db, order, history, input));
  audit(db, u, 'procurement', purchase.id, 'axes.commencement_authorised', {}, { authorisation_id: row.id, sequence: row.sequence, order_id: order.id,
    order_version: row.order_version, start_on: row.start_on, valid_until: row.valid_until });
  return row;
}

// الاستبدال إصدارٌ جديد يحل محل القائم: فحوص الإصدار كلها، وسبب مكتوب، والقديم يبقى بحاله ويشير إليه الجديد.
export function replaceCommencement(db, supplied, purchaseId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, [...COMMENCEMENT_FIELDS, 'reason']);
  const { purchase, order } = commencementContext(db, u, purchaseId), history = commencementHistory(db, purchase.id);
  const live = history.find(a => a.state === 'live');
  if (!live) refuse(409, 'no_live_commencement', { what: 'ما فيه أمر مباشرة قائم على هذا الطلب تستبدله',
    next: 'إذا المورد بيبدأ، أصدر أمر مباشرة جديد من شاشة الطلب' });
  const reason = v.text(input.reason, 'سبب استبدال أمر المباشرة', 2000, 10);
  assertReadyForPaidExecution(db, u.tenant_id, purchase.project_id, 'لا يُؤذن للمورد بالمباشرة');
  const record = commencementRecord(db, order, history, input);
  if (['order_version', 'start_on', 'valid_until', 'site_or_channel', 'scope_confirmation', 'evidence'].every(key => record[key] === live[key]))
    refuse(409, 'no_change', { what: `الاستبدال ما غيّر شي في أمر المباشرة القائم (رقم ${live.sequence})`,
      next: 'غيّر التاريخ أو الموقع أو النطاق أو الدليل، أو خلّ الأمر القائم كما هو' });
  const row = insertCommencement(db, u, purchase, order, record, live.id, reason);
  audit(db, u, 'procurement', purchase.id, 'axes.commencement_replaced',
    { authorisation_id: live.id, sequence: live.sequence, order_version: live.order_version, start_on: live.start_on, valid_until: live.valid_until },
    { authorisation_id: row.id, sequence: row.sequence, order_version: row.order_version, start_on: row.start_on, valid_until: row.valid_until }, reason);
  return row;
}

// السحب يوقف المورد: سجلٌّ مستقل بسببه ودليل إبلاغ المورد، والإذن نفسه يبقى كما صدر.
export function withdrawCommencement(db, supplied, purchaseId, input) {
  writing(db);
  const u = actor(db, supplied);
  v.object(input, ['reason', 'evidence']);
  const { purchase } = commencementContext(db, u, purchaseId);
  const live = commencementHistory(db, purchase.id).find(a => a.state === 'live');
  if (!live) refuse(409, 'no_live_commencement', { what: 'ما فيه أمر مباشرة قائم على هذا الطلب تسحبه',
    next: 'المورد أصلًا ما عنده إذن قائم؛ راجع سجل أوامر المباشرة في الطلب' });
  const reason = v.text(input.reason, 'سبب سحب أمر المباشرة', 2000, 10), evidence = v.text(input.evidence, 'دليل إبلاغ المورد بالتوقف', 3000, 10), time = now();
  db.prepare('INSERT INTO commencement_withdrawals(authorisation_id,tenant_id,purchase_id,reason,evidence,withdrawn_by,withdrawn_at) VALUES(?,?,?,?,?,?,?)')
    .run(live.id, u.tenant_id, purchase.id, reason, evidence, u.id, time);
  audit(db, u, 'procurement', purchase.id, 'axes.commencement_withdrawn', { authorisation_id: live.id, sequence: live.sequence, state: 'live' },
    { authorisation_id: live.id, sequence: live.sequence, state: 'withdrawn', withdrawn_at: time }, reason);
  return { id: live.id, sequence: live.sequence, withdrawn_at: time };
}

// بوابة بدء المورد: أمر شراء **و** إذن مباشرة قائم يسري اليوم على نسخة الأمر القائمة. تُستدعى لحظة تسجيل الاستلام،
// فالحكم يوم التسجيل لا يوم الإصدار. ورفضها يسمّي السبب بعينه ومن يملكه وما الخطوة التالية.
export function requireSupplierStart(db, purchase) {
  const order = db.prepare('SELECT * FROM procurement_orders WHERE purchase_id=?').get(purchase.id);
  if (!order) refuse(409, 'purchase_order_required', { what: 'ما يبدأ المورد قبل أمر شراء معتمد',
    missing: [{ document: 'أمر شراء معتمد على الطلب', owner: 'مراجع المشتريات في نطاق الطلب', owner_role: 'manager' }],
    next: 'اعتمد أمر الشراء أول، وبعده أمر المباشرة' });
  const history = commencementHistory(db, purchase.id), live = history.find(a => a.state === 'live');
  if (!live) {
    const last = history.at(-1);
    if (last?.state === 'withdrawn') refuse(409, 'commencement_withdrawn', { what: `أمر المباشرة رقم ${last.sequence} مسحوب، فما فيه استلام من المورد`,
      missing: [{ document: 'أمر مباشرة جديد على الطلب', why: `سُحب في ${riyadhDay(last.withdrawal.withdrawn_at)}: ${last.withdrawal.reason}`, owner: COMMENCEMENT_OWNER, owner_role: 'manager' }],
      next: 'إذا رجع المورد للشغل، يصدر المراجع أمر مباشرة جديد وبعدها سجّل الاستلام' });
    refuse(409, 'commencement_required', { what: 'ما نسجّل استلام من المورد قبل أمر المباشرة',
      missing: [{ document: 'أمر مباشرة ساري على نسخة أمر الشراء القائمة', why: 'أمر الشراء التزام بالشراء، مو إذن للمورد يبدأ الشغل', owner: COMMENCEMENT_OWNER, owner_role: 'manager' }],
      next: 'خلّ المراجع يصدر أمر المباشرة من شاشة الطلب، وبعدها سجّل الاستلام' });
  }
  const validity = validityOf(db, live);
  if (validity.satisfies_receipt) return live;
  const refusal = {
    incomplete: { what: `أمر المباشرة رقم ${live.sequence} صدر قبل ما تُسجَّل مدة السريان ودليل إبلاغ المورد`,
      document: 'أمر مباشرة بمدة سريان ودليل إبلاغ', why: 'بلاهما ما نعرف متى ينتهي الإذن ولا إن المورد انبلغ فيه',
      next: 'خلّ المراجع يستبدل الأمر بأمر يحمل مدة السريان والدليل، وبعدها سجّل الاستلام' },
    stale: { what: `أمر المباشرة صدر على النسخة ${live.order_version} من أمر الشراء، والأمر صار على النسخة ${validity.order_version}`,
      document: `أمر مباشرة على النسخة ${validity.order_version} من أمر الشراء`, why: 'تعدّل أمر الشراء بعد الإذن، والمورد يبدأ على الأمر بعد تعديله',
      next: 'خلّ المراجع يستبدل أمر المباشرة بأمر على النسخة الحالية، وبعدها سجّل الاستلام' },
    not_started: { what: `أمر المباشرة يبدأ سريانه ${live.start_on}، واليوم ${validity.day}`,
      document: 'أمر مباشرة يبدأ سريانه اليوم أو قبله', why: 'الاستلام قبل تاريخ البدء معناه إن المورد بدأ قبل ما يُؤذن له',
      next: 'انتظر تاريخ البدء، وإذا بدأ المورد فعلًا خلّ المراجع يستبدل الأمر بتاريخ البدء الصحيح' },
    expired: { what: `أمر المباشرة انتهى سريانه ${live.valid_until}، واليوم ${validity.day}`,
      document: 'أمر مباشرة ساري اليوم', why: 'ما يُستلم من المورد بعد انتهاء الإذن بلا إذن',
      next: 'خلّ المراجع يستبدل الأمر بمدة سريان جديدة، وبعدها سجّل الاستلام' }
  }[validity.state];
  refuse(409, 'commencement_' + validity.state, { what: refusal.what,
    missing: [{ document: refusal.document, why: refusal.why, owner: COMMENCEMENT_OWNER, owner_role: 'manager' }], next: refusal.next });
}

/* ───── القراءة: المحاور الثمانية معًا ───── */
export function axesFor(db, supplied, projectId) {
  const u = actor(db, supplied);
  return projectView(db, u, projectOf(db, u, projectId));
}
// قراءة مشروع واحد بمحاوره الثمانية، بعد projectOf (عضوية القارئ) في المسارين: axesFor ولوحة مسار المشاريع.
function projectView(db, u, project) {
  const c = caseOf(db, project);
  const axes = {
    commercial: { state: c?.status ?? 'not_linked', case_id: c?.id ?? null, case_name: c?.name ?? null },
    readiness: readinessAxis(db, project),
    execution: executionAxis(db, project),
    acceptance: acceptanceAxis(db, project),
    invoicing: invoicingAxis(db, project),
    collection: collectionAxis(db, project),
    supplier_settlement: supplierSettlementAxis(db, project),
    closure: closureAxis(db, project, u)
  };
  return { project: { id: project.id, name: project.name, created_by_name: person(db, project.created_by), manager: projectManagerOfRecord(db, project) },
    definitions: AXES, legacy_status: LEGACY_STATUS_NOTE, axes,
    payment_terms: c ? paymentTerms(db, c.id) : [],
    certificates: certificateSummaries(db, project.id),
    departments: db.prepare('SELECT d.id,d.name,pd.approval_source,pd.request_id FROM departments d JOIN project_departments pd ON pd.department_id=d.id WHERE pd.project_id=?').all(project.id),
    work_packages: db.prepare('SELECT * FROM work_packages WHERE project_id=? ORDER BY code').all(project.id)
      .map(p => ({ ...p, status_name: WORK_PACKAGE_STATUS[p.status], phase_name: PHASES[p.phase], lead_name: person(db, p.lead_id),
        tasks: db.prepare('SELECT id,title,status FROM tasks WHERE work_package_id=?').all(p.id),
        deliverables: JSON.parse(p.deliverables || '[]'),
        contributors: db.prepare('SELECT id,user_id,department_id,contribution,added_at FROM work_package_contributors WHERE package_id=? AND removed_at IS NULL ORDER BY added_at').all(p.id)
          .map(c => ({ ...c, name: person(db, c.user_id) })),
        depends_on: db.prepare('SELECT d.id,d.depends_on_id,w.code,w.status FROM work_package_dependencies d JOIN work_packages w ON w.id=d.depends_on_id WHERE d.package_id=? AND d.removed_at IS NULL ORDER BY w.code').all(p.id) })),
    history: db.prepare('SELECT * FROM project_axis_events WHERE project_id=? ORDER BY created_at,id').all(project.id).map(e => ({ ...e, actor_name: person(db, e.actor_id) })),
    note: 'ثمانية محاور مستقلة: لكل واحد سؤاله وحالاته وصاحبه. المحور التجاري يبقى في حقله القائم، وأربعة تُشتق من بياناتها ولا تُخزَّن مرتين، وثلاثة تُخزَّن لأنه لا مصدر لها. سداد المورد يُقرأ من أوامر الدفع وحدها.' };
}
/* ───── مسار المشروع (خطة التغيير، الموجة 5 «سلسلة المشروع») ───── */
// أول خطوة لم تُنجز على السلسلة من الملف التجاري إلى الإقفال النهائي، ومن يملكها، والشاشة التي تُنجز فيها. تُشتق من
// المحاور الثمانية وقائمتي الإقفال بترتيبهما (technicalChecklist ثم financialChecklist)، فلا قاعدة ثانية تفترق عنها:
// ما تسمّيه الخطوة هنا هو ما يرفض به الخادم لو ضُغط زرُّ ما بعدها. الروابط شاشاتٌ قائمة، ومسار المشروع نفسه للتنفيذ والحزم.
const ITEM_SCREEN = { line: 'file', certificate: 'file', margin: 'file', technical_closure: 'file', work_package: 'spine',
  comment: 'review-rounds', task: 'projects', delivery: 'receivables', claim: 'receivables', refund: 'receivables', credit_note: 'invoices',
  purchase: 'procurement', supplier_invoice: 'procurement', invoice: 'payables', payable: 'payables', expense: 'expenses',
  advance: 'billing-schedules', booking: 'equipment', journal: 'finance' };
const ITEM_AXIS = { line: 'acceptance', certificate: 'acceptance', comment: 'acceptance', task: 'execution', work_package: 'execution',
  delivery: 'invoicing', credit_note: 'invoicing', claim: 'collection', refund: 'collection', purchase: 'supplier_settlement',
  supplier_invoice: 'supplier_settlement', invoice: 'supplier_settlement', payable: 'supplier_settlement' };
export function nextProjectAction(db, project, axes, c = caseOf(db, project)) {
  const manager = projectManagerOfRecord(db, project), pm = manager.name || 'مدير المشروع المسجَّل';
  const spine = `#project-spine?focus=${project.id}`, file = c ? `#commercial?focus=${c.id}` : '#commercial';
  const at = (axis, step, owner, why, link) => ({ axis, axis_name: AXES.find(a => a.key === axis).name, step, owner, why, link });
  const fromItem = item => {
    const kind = String(item.ref ?? '').split(':')[0], screen = ITEM_SCREEN[kind];
    return at(ITEM_AXIS[kind] ?? 'closure', item.item, item.owner, item.why, screen === 'spine' ? spine : !screen || screen === 'file' ? file : `#${screen}`);
  };
  if (c && !['contracted', 'project_active'].includes(axes.commercial.state))
    return at('commercial', 'الملف التجاري يوصل لاتفاق موثّق', person(db, c.owner_id) || 'مسؤول الحساب', 'التنفيذ المدفوع وقبول المخرجات والإقفال كلها تنبني على الاتفاق.', file);
  if (!axes.readiness.allows_paid_execution) {
    const r = axes.readiness.refusals[0] ?? {};
    return at('readiness', r.document ?? 'شروط البدء', r.owner || 'مسؤول الحساب', r.why ?? 'التنفيذ المدفوع ينتظر شروط البدء في الاتفاق.', file);
  }
  if (!manager.available) return at('execution', 'مدير مشروع مسجَّل متاح', 'من يسلّم المشروع ويستلمه', 'مدير المشروع المسجَّل مو متاح أو ما عاد عضوًا، وكل خطوة بعده تنتظره.', '#projects');
  if (axes.execution.state === 'not_started') return at('execution', 'بدء التنفيذ: تعبئة الفريق', pm, 'التنفيذ ما بدأ للحين.', spine);
  if (axes.execution.state === 'on_hold') return at('execution', 'استئناف التنفيذ الموقوف', pm, axes.execution.note || 'التنفيذ موقوف.', spine);
  const closure = axes.closure;
  if (closure.technical_state !== 'closed') {
    const item = closure.technical_outstanding[0];
    return item ? fromItem(item) : at('closure', 'الإقفال الفني', pm, 'المخرجات مقبولة والشهادة قبلها العميل، وما بقي إلا الإقفال الفني.', file);
  }
  if (closure.financial_state !== 'closed') {
    const item = closure.financial_outstanding.find(i => i.code !== 'technical_closure_required');
    return item ? fromItem(item) : at('closure', 'الإقفال المالي', 'حامل تفويض الاعتماد المالي', 'قائمة الإقفال المالي محسومة، وما بقي إلا الإقفال نفسه.', file);
  }
  if (closure.final_state !== 'closed') return at('closure', 'الإقفال النهائي: ملاحظة الربحية والدروس', pm, 'المشروع مقفل فنيًا وماليًا.', file);
  return null;
}

// أزرار القارئ على مسار المشروع: ما يقبله الخادم من هذا الحساب الآن، لا أكثر (الأزرار تقول ما يقوله الرفض). مدير المشروع
// المسجَّل يحرّك التنفيذ ويفتح الحزم ويربط تبعياتها؛ ومسؤول الحزمة يحرّك حزمته ويضبط نطاقها ومساهميها (packageSteward).
// التفعيل يغيب ما دامت شروط البدء ناقصة، والتسليم يغيب ما دام له ناقصٌ غير الدليل — والناقص يُعرض على بطاقة الحزمة بدل زرٍّ يرتدّ.
function spineActions(db, u, view) {
  const manager = view.project.manager, isPm = manager.available && manager.id === u.id;
  const technicalClosed = view.axes.closure.technical_state === 'closed', ready = view.axes.readiness.allows_paid_execution;
  const actions = [];
  if (isPm && !technicalClosed && view.axes.execution.next_states.length) actions.push('set_execution');
  if (isPm && !technicalClosed && view.departments.length) actions.push('create_work_package');
  const work_packages = view.work_packages.map(p => {
    const steward = isPm || p.lead_id === u.id, open = !['delivered', 'cancelled'].includes(p.status), next = PACKAGE_TRANSITIONS[p.status];
    const gaps = p.status === 'active' ? deliveryGaps(db, p) : [], own = [];
    if (steward) {
      if (next.includes('active') && ready) own.push('activate');
      if (next.includes('blocked')) own.push('block');
      if (next.includes('delivered') && !gaps.length) own.push('deliver');
      if (next.includes('cancelled')) own.push('cancel');
      if (open) own.push('set_scope', 'add_contributor');
    }
    if (isPm && open && view.work_packages.some(o => o.id !== p.id && o.status !== 'cancelled')) own.push('add_dependency');
    return { ...p, actions: own, delivery_gaps: gaps,
      contributors: p.contributors.map(c => ({ ...c, actions: steward && open ? ['remove_contributor'] : [] })),
      depends_on: p.depends_on.map(d => ({ ...d, actions: isPm && open ? ['remove_dependency'] : [] })) };
  });
  return { actions, work_packages, manager_of_record: isPm };
}

// فريق المشروع لنماذج الحزم: أعضاؤه النشطون من غير الأدمن، بإداراتهم. الأشخاص يُقرؤون من app/people-read.mjs لا مباشرةً.
function projectTeam(db, project) {
  return db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(project.id)
    .map(m => personAssignment(db, project.tenant_id, m.user_id)).filter(p => p?.active && p.role !== 'admin')
    .map(p => { const department_id = personDepartment(db, p.id);
      return { id: p.id, name: p.name, department_id, department_name: db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(department_id, project.tenant_id)?.name ?? '' }; })
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
// لوحة مسار المشاريع: مشاريع القارئ (عضويته، كلوحة المحافظ)، ولكل مشروع محاوره الثمانية والخطوة الجاية وصاحبها وحزمه
// بأزرارها. الفريق يُقرأ لنماذج الحزم (المسؤول والمساهم من أعضاء المشروع)، ومراكز التكلفة لمدير المشروع المسجَّل وحده بلا مبالغ.
export function spineBoard(db, supplied) {
  const u = actor(db, supplied);
  const projects = db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id, u.id);
  return { today: today(), definitions: AXES, state_names: AXIS_STATE_NAMES, phases: PHASES, work_package_statuses: WORK_PACKAGE_STATUS,
    projects: projects.map(project => {
      const { definitions, legacy_status, note, ...view } = projectView(db, u, project), own = spineActions(db, u, view);
      return { ...view, ...own, next_step: nextProjectAction(db, project, view.axes),
        members: projectTeam(db, project),
        budgets: own.manager_of_record ? db.prepare("SELECT id,cost_center,status FROM project_budgets WHERE project_id=? AND status IN ('draft','pending','active') ORDER BY cost_center").all(project.id) : [] };
    }) };
}

// إسقاط صفّ المشروع في اللوحة. الحاسبات الثمانية تأخذ صف مشروع خامًا لا قارئًا، فالإسقاط
// واحد لا يعرف من يقرأه: لوحة العضوية ولوحة الكيان تقرآن الشيء نفسه بالضبط، ولا يفترقان بالانحراف.
const axesRow = (db, project) => ({ id: project.id, name: project.name,
  axes: { commercial: caseOf(db, project)?.status ?? 'not_linked', readiness: readinessAxis(db, project).state, execution: executionAxis(db, project).state,
    acceptance: acceptanceAxis(db, project).state, invoicing: invoicingAxis(db, project).state, collection: collectionAxis(db, project).state,
    supplier_settlement: supplierSettlementAxis(db, project).state, closure: closureStateOf(db, project) } });
const boardShell = (u, projects, note, extra = {}) => ({ today: today(), user_id: u.id,
  definitions: AXES, legacy_status: LEGACY_STATUS_NOTE, phases: PHASES, work_package_statuses: WORK_PACKAGE_STATUS,
  ...extra, projects, note });

export function axesBoard(db, supplied) {
  const u = actor(db, supplied);
  const projects = db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id, u.id);
  return boardShell(u, projects.map(project => axesRow(db, project)), 'لوحة المحافظ: أي المشاريع جارية وأيها مقفلة، ومن أي محور بالضبط.');
}

// لوحة محافظ الكيان. العلة التي تعالجها: `axesBoard` يصل project_members، فالرئيس التنفيذي
// الذي ليس عضوًا في مشروع واحد يرى محفظة فارغة بدل أن يرى الشركة — أقدم قارئ في المنصة
// يقرأ أقل ما فيها. هذه دالة ثانية ببوابتها، لا علمًا يُرفع على الدالة القائمة، فسلوك
// `axesBoard` لا يتغير بحرف. النطاق هو نطاق R11/R14 نفسه في مكتبة التقارير: العضوية
// تتسع إلى الكيان عند `executive.view` وحده، فهذا فرع موجود في طبقة التقارير يُعطى للوحة.
export function executiveAxesBoard(db, supplied) {
  const u = actor(db, supplied);
  if (!can(db, u, 'executive.view')) fail(403, 'not_permitted', 'محفظة الكيان لحامل تصريح «اللوحة التنفيذية». اطلبه من مسؤول الصلاحيات');
  const projects = db.prepare('SELECT p.* FROM projects p WHERE p.tenant_id=? ORDER BY p.created_at DESC').all(u.tenant_id);
  return boardShell(u, projects.map(project => axesRow(db, project)),
    'محفظة الكيان: كل مشاريع الشركة بمحاورها الثمانية، لا المشاريع التي القارئ عضو فيها. الإسقاط هو إسقاط لوحة المحافظ نفسه.',
    { scope: 'tenant', capability: 'executive.view' });
}
