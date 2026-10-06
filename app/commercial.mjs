import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
// بوابة البدء المدفوع الواحدة (عمود المشروع الفقري، ترحيلا 116 و160): التسليم وبدء التغيير يمرّان بها كما تمرّ بها ترسية المورد.
import { assertReadyForPaidExecution, caseReadiness } from './project-axes.mjs';
// الحزمة 4 (الترحيلان 180 و181، القرار D1): العميل صفُّ clients، والملف التجاري صفقةٌ واحدة له، تنفتح من ملفه أو من فرصته.
import { refuse } from './refusal.mjs';
import { personName, personAssignment, personDepartment } from './people-read.mjs';
import { FAMILIES, clientFor, registrationNumber } from './agency.mjs';
import { notifyMany } from './notices.mjs';
import { PRE_CONTRACT, CLOSED_DEAL, DEAL_STATUS_NAMES, lossReason, closeDealRow, dealRef } from './crm-deals.mjs';
import { loseOpportunityRow } from './pipeline-estimates.mjs';
// الملف المقفل لا تنفتح له صفقة ولا تتحرك صفقاته (P4-CRM-7، الترحيل 186).
import { assertClientOpen } from './client-offboarding.mjs';
// الحزمة 4 (الترحيل 182، القرار D2): نسخة العرض على عرض سعر العميل (FRM-024)، والهامش يُقرأ مع الاعتماد والاتفاق، والعقد المنهى يوقف ما بعده.
import { checkQuoteBinding, writeQuoteBinding, requireProposalForApproval, marginEvidence, requireAcceptedProposal, writeContractBinding,
  proposalView, terminationOf, refuseTerminated } from './proposal-of-record.mjs';
import { assertProposalChecklistApproved, checklistsForQuote, currentProposalChecklist, proposalActionsForCase, proposalQuoteReady, submitProposalChecklist } from './technical-proposal-review.mjs';

const currencies = new Set(['SAR', 'USD', 'EUR']);
const limitMinor = 999999999999n;
const actions = {
  qualify: ['need', 'budget', 'currency', 'timing', 'decision_maker', 'service_fit'],
  approve_qualification: ['note'], reject_qualification: ['note'],
  save_quote: ['scope', 'currency', 'valid_until', 'lines', 'quotation_id'], submit_quote: [],
  approve_quote: ['note'], reject_quote: ['note'],
  register_contract: ['agreement_evidence', 'customer_representative'],
  create_project: ['member_ids'], submit_delivery: ['line_index', 'evidence'],
  // ممثل العميل من سجل مفوّضي المشروع (approver_id)، كما تسمّيه شهادة الإنجاز. الاسم المكتوب (customer_representative) يُرفض باسمه.
  accept_delivery: ['delivery_id', 'note', 'acceptance_evidence', 'approver_id', 'customer_representative'],
  create_change: ['scope', 'additional_price', 'additional_cost', 'extra_days', 'due_date', 'acceptance'],
  approve_change: ['change_id', 'note'], reject_change: ['change_id', 'note'], start_change: ['change_id'],
  // الخسارة والسحب (الترحيل 180): سبب من قائمة أسباب الخسارة السارية، وما حدث وما نتعلم. نهائيتان.
  close_lost: ['reason_id', 'comment'], withdraw: ['reason_id', 'comment']
};

function currentUser(db, supplied) {
  if (typeof supplied?.id !== 'string' || typeof supplied?.tenant_id !== 'string') fail(401, 'login_required', 'سجّل الدخول للمتابعة');
  const user = db.prepare('SELECT id,tenant_id,department_id,role,manager_id,active,name FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id, supplied.tenant_id);
  if (!user) fail(401, 'session_expired', 'انتهت الجلسة أو توقف الحساب');
  return user;
}
function requireTransaction(db) {
  if (!db.isTransaction) fail(500, 'transaction_required', 'تتطلب الكتابة التجارية معاملة قاعدة بيانات');
}
function ownerOf(db, c) {
  return db.prepare("SELECT id,tenant_id,department_id,role,manager_id,active FROM users WHERE id=? AND tenant_id=? AND department_id=? AND active=1 AND role IN ('employee','manager')").get(c.owner_id, c.tenant_id, c.department_id);
}
function isManager(u, c, owner) {
  return !!owner && u.id !== c.owner_id && u.role === 'manager' && u.id === owner.manager_id && u.tenant_id === c.tenant_id && u.department_id === c.department_id;
}
function isMember(db, u, c) {
  return !!c.project_id && !!db.prepare('SELECT 1 FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(c.project_id, u.tenant_id, u.id);
}
function accessLevel(db, u, c) {
  const owner = ownerOf(db, c);
  if (!owner || c.tenant_id !== u.tenant_id) return null;
  if (u.id === c.owner_id && ['employee', 'manager'].includes(u.role)) return 'financial';
  if (isManager(u, c, owner)) return 'financial';
  if (u.role === 'pm' && u.department_id === c.department_id && isMember(db, u, c)) return 'delivery';
  return null;
}
function getCase(db, u, id) {
  if (typeof id !== 'string') fail(404, 'not_found', 'ملف العميل غير متاح');
  const c = db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(id, u.tenant_id);
  if (!c || !accessLevel(db, u, c)) fail(404, 'not_found', 'ملف العميل غير متاح');
  return c;
}
function managerOf(db, c) {
  const owner = ownerOf(db, c);
  const manager = owner?.manager_id && db.prepare("SELECT id,tenant_id,department_id,role,active FROM users WHERE id=? AND active=1 AND role='manager'").get(owner.manager_id);
  if (!manager || !isManager(manager, c, owner)) fail(409, 'approver_unavailable', 'يلزم مدير مباشر نشط من الإدارة نفسها ومستقل عن معد المعاملة');
  return manager;
}
function currency(value) {
  if (!currencies.has(value)) fail(400, 'currency', 'اختر عملة محلية مدعومة: SAR أو USD أو EUR');
  return value;
}
function decimalMinor(value, label, maximum = limitMinor) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) fail(400, 'invalid_money', `${label}: يلزم نص عشري غير سالب بمنزلتين بحد أقصى`);
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > maximum) fail(400, 'money_limit', `${label}: تجاوز الحد المحلي للمبلغ`);
  return minor;
}
function bounded(value) {
  if (value < 0n || value > limitMinor) fail(400, 'money_limit', 'تجاوز المبلغ الحد المحلي');
  return value;
}
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function futureDate(value) {
  const date = v.date(value);
  if (date < today()) fail(400, 'expired_date', 'التاريخ يسبق اليوم في الرياض');
  return date;
}
function quoteSnapshot(input) {
  const quoteCurrency = currency(input.currency);
  const scope = v.text(input.scope, 'نطاق العرض', 5000, 3);
  const validUntil = futureDate(input.valid_until);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 30) fail(400, 'quote_lines', 'يتطلب العرض من بند واحد إلى 30 بندًا');
  let net = 0n, tax = 0n, cost = 0n;
  const lines = input.lines.map(line => {
    v.object(line, ['description', 'quantity', 'unit_price', 'unit_cost', 'discount', 'tax_rate', 'acceptance', 'revisions']);
    if (typeof line.quantity !== 'string' || !/^[1-9]\d{0,5}$/.test(line.quantity)) fail(400, 'quantity', 'الكمية نص عدد صحيح موجب حتى 999999');
    if (!Number.isInteger(line.revisions) || line.revisions < 0 || line.revisions > 20) fail(400, 'revisions', 'عدد المراجعات من صفر إلى 20');
    const quantity = BigInt(line.quantity);
    const unitPrice = decimalMinor(line.unit_price, 'سعر الوحدة');
    const unitCost = decimalMinor(line.unit_cost, 'تكلفة الوحدة');
    const discount = decimalMinor(line.discount, 'خصم البند');
    const taxBasisPoints = decimalMinor(line.tax_rate, 'نسبة الضريبة', 10000n);
    const gross = bounded(unitPrice * quantity);
    if (discount > gross) fail(400, 'discount', 'الخصم يتجاوز قيمة البند');
    const lineNet = gross - discount;
    const lineTax = (lineNet * taxBasisPoints + 5000n) / 10000n;
    const lineCost = bounded(unitCost * quantity);
    net = bounded(net + lineNet); tax = bounded(tax + lineTax); cost = bounded(cost + lineCost);
    return { description: v.text(line.description, 'وصف البند', 500), quantity: line.quantity,
      unit_price_minor: String(unitPrice), unit_cost_minor: String(unitCost), discount_minor: String(discount), tax_basis_points: String(taxBasisPoints),
      net_minor: String(lineNet), tax_minor: String(lineTax), total_minor: String(bounded(lineNet + lineTax)), cost_minor: String(lineCost),
      acceptance: v.text(line.acceptance, 'معيار قبول البند', 2000, 3), revisions: line.revisions };
  });
  return { scope, currency: quoteCurrency, valid_until: validUntil, lines, net_minor: String(net), tax_minor: String(tax), total_minor: String(bounded(net + tax)), cost_minor: String(cost), margin_minor: String(net - cost), rounding: 'per-line-half-up' };
}
function reviewFor(db, c, kind, subjectId) {
  return db.prepare('SELECT * FROM commercial_reviews WHERE case_id=? AND kind=? AND subject_id=?').get(c.id, kind, subjectId);
}
function requireApproved(db, c, kind, subjectId) {
  const review = reviewFor(db, c, kind, subjectId);
  if (!review || review.status !== 'approved' || review.requested_by === review.approver_id) fail(409, 'approval_required', 'يلزم قرار اعتماد مستقل للنسخة الأصلية');
  return review;
}
function addReview(db, u, c, kind, subjectId) {
  const manager = managerOf(db, c);
  if (manager.id === u.id) fail(403, 'self_approval', 'لا يجوز لمعد المعاملة اعتمادها');
  const id = randomUUID();
  db.prepare('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)').run(id, c.id, kind, subjectId, u.id, manager.id, now());
  return id;
}
function decide(db, u, c, kind, subjectId, status, note, evidence = {}) {
  const review = reviewFor(db, c, kind, subjectId);
  if (!review || review.status !== 'pending') fail(409, 'review_closed', 'لا توجد مراجعة معلقة لهذه النسخة');
  if (review.requested_by === u.id) fail(403, 'self_approval', 'لا يجوز لمعد المعاملة اعتمادها');
  if (review.approver_id !== u.id || !isManager(u, c, ownerOf(db, c))) fail(403, 'review_scope', 'القرار متاح للمدير المعين ضمن نطاقه الحالي');
  const cleanNote = v.text(note, 'سبب القرار', 3000, 3);
  db.prepare('UPDATE commercial_reviews SET status=?,note=?,evidence_json=?,decided_at=? WHERE id=?').run(status, cleanNote, JSON.stringify(evidence), now(), review.id);
  return { review_id: review.id, subject_id: subjectId, decision: status, note: cleanNote, ...evidence };
}
function quoteOf(db, c) {
  const quote = db.prepare('SELECT * FROM commercial_quotes WHERE id=? AND case_id=?').get(c.current_quote_id, c.id);
  if (!quote) fail(409, 'quote_required', 'النسخة الأصلية للعرض غير متاحة');
  return { ...quote, snapshot: JSON.parse(quote.snapshot) };
}
function contractOf(db, c) {
  const contract = db.prepare('SELECT * FROM commercial_contracts WHERE case_id=?').get(c.id);
  if (!contract) fail(409, 'contract_required', 'يلزم اتفاق داخلي مسند إلى عرض معتمد');
  return { ...contract, snapshot: JSON.parse(contract.snapshot) };
}
function projectParticipant(db, u, c) {
  return c.status === 'project_active' && isMember(db, u, c) && (u.id === c.owner_id || u.role === 'pm');
}
function allowedActions(db, u, c) {
  const allowed = [];
  const owner = u.id === c.owner_id && accessLevel(db, u, c) === 'financial';
  const manager = isManager(u, c, ownerOf(db, c));
  if (owner && ['lead', 'qualification_rejected'].includes(c.status)) allowed.push('qualify');
  if (owner && ['qualified', 'quote_draft', 'quote_rejected'].includes(c.status)) allowed.push('save_quote');
  if (owner && c.status === 'quote_draft' && proposalQuoteReady(db, c.tenant_id, c.current_quote_id)) allowed.push('submit_quote');
  if (owner && c.status === 'quote_approved') allowed.push('register_contract');
  if (owner && PRE_CONTRACT.includes(c.status)) allowed.push('close_lost', 'withdraw');
  if (manager && c.status === 'contracted') allowed.push('create_project');
  for (const [kind, state] of [['qualification', 'qualification_pending'], ['quote', 'quote_pending']]) {
    const review = reviewFor(db, c, kind, kind === 'quote' ? c.current_quote_id : c.current_qualification_id);
    if (c.status === state && manager && review?.status === 'pending' && review.approver_id === u.id && review.requested_by !== u.id) allowed.push(`approve_${kind}`, `reject_${kind}`);
  }
  // العقد المنهى في سجل العقود (الترحيل 182) يوقف ما بعده: لا مخرج يُقدَّم ولا تغيير يُطلب أو يبدأ. القبول المعلّق يبقى قراره.
  const terminated = c.status === 'project_active' && !!terminationOf(db, c.id);
  if (projectParticipant(db, u, c) && !terminated) {
    const lineCount = quoteOf(db, c).snapshot.lines.length;
    const submitted = db.prepare("SELECT COUNT(DISTINCT d.line_index) AS n FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' WHERE d.case_id=? AND r.status IN ('pending','approved')").get(c.id).n;
    if (submitted < lineCount) allowed.push('submit_delivery');
  }
  if (owner && projectParticipant(db, u, c) && !terminated) {
    allowed.push('create_change');
    if (db.prepare("SELECT 1 FROM commercial_changes ch JOIN commercial_reviews r ON r.subject_id=ch.id AND r.kind='change' LEFT JOIN commercial_change_tasks ct ON ct.change_id=ch.id WHERE ch.case_id=? AND r.status='approved' AND ct.change_id IS NULL").get(c.id)) allowed.push('start_change');
  }
  if (manager && c.status === 'project_active' && isMember(db, u, c)) {
    for (const kind of ['delivery', 'change']) {
      if (db.prepare("SELECT 1 FROM commercial_reviews WHERE case_id=? AND kind=? AND status='pending' AND approver_id=? AND requested_by<>?").get(c.id, kind, u.id, u.id)) allowed.push(...(kind === 'delivery' ? ['accept_delivery'] : ['approve_change', 'reject_change']));
    }
  }
  return allowed;
}
// ما حول الصفقة: عميلها وفرصتها وسابقتها وسبب إغلاقها. أسماء وحالات فقط، بلا مبالغ ولا حقول مخصّصة.
function dealContext(db, c) {
  const client = c.client_id ? db.prepare('SELECT id,code,legal_name,trade_name FROM clients WHERE id=? AND tenant_id=?').get(c.client_id, c.tenant_id) : null;
  const opportunity = c.opportunity_id ? db.prepare('SELECT id,name,status FROM opportunities WHERE id=? AND tenant_id=?').get(c.opportunity_id, c.tenant_id) : null;
  const reason = c.closed_reason_id ? db.prepare('SELECT code,name FROM pipeline_loss_reasons WHERE id=?').get(c.closed_reason_id) : null;
  return {
    client: client ? { id: client.id, code: client.code, name: client.trade_name || client.legal_name } : null,
    opportunity: opportunity ? { id: opportunity.id, name: opportunity.name, status: opportunity.status } : null,
    predecessor: c.predecessor_case_id ? { id: c.predecessor_case_id, ref: dealRef(c.predecessor_case_id) } : null,
    closure: CLOSED_DEAL.includes(c.status) ? { status_name: DEAL_STATUS_NAMES[c.status], reason_code: reason?.code ?? null, reason_name: reason?.name ?? null,
      comment: c.closed_comment, closed_at: c.closed_at, closed_by_name: personName(db, c.closed_by) } : null
  };
}
function readCase(db, u, c) {
  const level = accessLevel(db, u, c);
  const quotes = db.prepare('SELECT * FROM commercial_quotes WHERE case_id=? ORDER BY revision').all(c.id).map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) }));
  const contractRow = db.prepare('SELECT * FROM commercial_contracts WHERE case_id=?').get(c.id);
  const contract = contractRow ? { ...contractRow, snapshot: JSON.parse(contractRow.snapshot) } : null;
  const reviews = db.prepare('SELECT * FROM commercial_reviews WHERE case_id=? ORDER BY requested_at,id').all(c.id).map(r => ({ ...r, evidence: JSON.parse(r.evidence_json), evidence_json: undefined }));
  const deliveries = db.prepare('SELECT * FROM commercial_deliveries WHERE case_id=? ORDER BY line_index,revision').all(c.id).map(r => ({ ...r, review: reviews.find(x => x.kind === 'delivery' && x.subject_id === r.id) ?? null }));
  const changes = db.prepare('SELECT ch.*,ct.task_id FROM commercial_changes ch LEFT JOIN commercial_change_tasks ct ON ct.change_id=ch.id WHERE ch.case_id=? ORDER BY ch.created_at,ch.id').all(c.id).map(r => ({ ...r, snapshot: JSON.parse(r.snapshot), review: reviews.find(x => x.kind === 'change' && x.subject_id === r.id) ?? null }));
  // جاهزية البدء تُقرأ على الملف من اعتماد العرض فصاعدًا: هناك تُسجَّل شروط الاتفاق وأمر الشراء، وهناك يسأل صاحب الملف «ليش وقف التنفيذ؟».
  const readiness = ['quote_approved', 'contracted', 'project_active'].includes(c.status) ? caseReadiness(db, u, c, { financial: level === 'financial' }) : null;
  const allowed = allowedActions(db, u, c), termination = contractRow ? terminationOf(db, c.id) : null;
  if (level === 'delivery') {
    const q = quotes.find(r => r.id === c.current_quote_id);
    return { id: c.id, name: c.name, status: c.status, version: c.version, project_id: c.project_id, access: level,
      current_quote: q ? { id: q.id, revision: q.revision, snapshot: { scope: q.snapshot.scope, lines: q.snapshot.lines.map(({ description, quantity, acceptance, revisions }) => ({ description, quantity, acceptance, revisions })) } } : null,
      contract: contract ? { id: contract.id, quote_id: contract.quote_id, scope: contract.snapshot.scope } : null,
      qualifications: [], quotes: [], reviews: [], deliveries,
      changes: changes.map(r => ({ id: r.id, snapshot: { scope: r.snapshot.scope, extra_days: r.snapshot.extra_days, due_date: r.snapshot.due_date, acceptance: r.snapshot.acceptance }, status: r.review?.status, task_id: r.task_id })),
      readiness, termination, proposal_checklists: [], proposal_checklist: null, proposal_actions: [], allowed_actions: allowed };
  }
  // ممثلو العميل المفوّضون في سجل المشروع، الساريون اليوم: منهم يُسمّى من قبل المخرج عن العميل (accept_delivery).
  const approvers = c.project_id ? db.prepare('SELECT id,name,title,authority_scope,valid_from,revoked_on FROM client_approvers WHERE project_id=? AND tenant_id=? ORDER BY created_at,id').all(c.project_id, c.tenant_id)
    .filter(a => a.valid_from <= today() && (!a.revoked_on || a.revoked_on > today())).map(({ id, name, title, authority_scope }) => ({ id, name, title, authority_scope })) : [];
  return { ...c, access: level, owner_name: db.prepare('SELECT name FROM users WHERE id=?').get(c.owner_id)?.name, ...dealContext(db, c),
    qualifications: db.prepare('SELECT * FROM commercial_qualifications WHERE case_id=? ORDER BY revision').all(c.id).map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) })),
    quotes, current_quote: quotes.find(r => r.id === c.current_quote_id) ?? null, contract, reviews, deliveries, changes,
    proposal: proposalView(db, c, { candidates: allowed.includes('save_quote') }), termination, client_approvers: approvers,
    // قوائم فحص العرض الفني (عمل المالك مع Codex، الترحيل 202) على نسخة العرض الحالية.
    proposal_checklists: c.current_quote_id ? checklistsForQuote(db, c.current_quote_id) : [],
    proposal_checklist: c.current_quote_id ? currentProposalChecklist(db, c.current_quote_id) : null,
    proposal_actions: proposalActionsForCase(db, u, c),
    readiness, allowed_actions: allowed };
}

export function listCommercial(db, suppliedUser) {
  const u = currentUser(db, suppliedUser);
  return db.prepare('SELECT * FROM commercial_cases WHERE tenant_id=? ORDER BY updated_at DESC,id').all(u.tenant_id).filter(c => accessLevel(db, u, c)).map(c => readCase(db, u, c));
}

// صفقة جديدة. من ملف العميل (client_id): الاسم ورقم السجل والقطاع من ملفه ولا تُكتب مرة ثانية، ورقم السجل ما عاد فريدًا لكل
// صفقة — صفقة ثانية لنفس العميل (تجديد أو نطاق ثانٍ) تنفتح وتسمّي سابقتها. وبلا ملف عميل يبقى المسار القديم لشاشة لم تُحدَّث،
// على شرط ألا تكون الجهة معروفة: رقم سجل يملكه عميل يُرد إلى ملفه، ورقم على صفقة قديمة بلا ملف يُرد إلى ربطها بملف.
const CLIENT_FIELDS = { name: 'اسم الجهة', registration_number: 'رقم السجل', sector: 'القطاع' };
export function createLead(db, suppliedUser, input) {
  requireTransaction(db);
  const u = currentUser(db, suppliedUser);
  if (!['employee', 'manager'].includes(u.role)) fail(403, 'commercial_role', 'إنشاء ملف العميل متاح للموظف ومدير الفريق');
  v.object(input, ['client_id', 'predecessor_case_id', 'name', 'registration_number', 'contact', 'source', 'sector']);
  if (input.client_id !== undefined) return readCase(db, u, getCase(db, u, openDealForClient(db, u, input)));
  if (input.predecessor_case_id !== undefined) refuse(400, 'client_required', { what: 'الصفقة السابقة تُذكر على صفقة تنفتح من ملف العميل',
    next: 'اختر العميل من ملفه (client_id) ثم اذكر صفقته السابقة' });
  const registration = registrationNumber(input.registration_number, { required: true });
  const values = { name: v.text(input.name, 'اسم الجهة', 180), contact: v.text(input.contact, 'جهة الاتصال', 500), source: v.text(input.source, 'المصدر', 500), sector: v.text(input.sector, 'القطاع', 180) };
  // قراءة بـ«*» لا بأعمدة 180 بالاسم: اختبار ترقية الترحيل 164 (tests/completion-certificate.test.mjs) يمرّ بهذا المسار على مخطط قبله.
  const owned = db.prepare('SELECT * FROM clients WHERE tenant_id=?').all(u.tenant_id).find(x => x.registration_number === registration);
  if (owned) refuse(409, 'customer_has_file', { what: `رقم السجل ${registration} لعميل له ملف، فالصفقة تنفتح من ملفه`,
    missing: [{ document: `ملف العميل ${owned.code}`, why: 'العميل ملف واحد، وكل صفقة له تنفتح منه فما تنكتب بياناته مرة ثانية', owner: personName(db, owned.owner_id) ?? 'مسؤول ملفات العملاء', owner_role: 'account_manager', doc_key: 'client' }],
    next: 'افتح الصفقة من ملف العميل. وإذا ما كنت في فريق حسابه، اطلب من مسؤوله يضيفك' });
  const earlier = db.prepare('SELECT * FROM commercial_cases WHERE tenant_id=? AND registration_number=? ORDER BY created_at LIMIT 1').get(u.tenant_id, registration);
  const earlierClient = earlier?.client_id ? db.prepare('SELECT code,owner_id FROM clients WHERE id=?').get(earlier.client_id) : null;
  if (earlierClient) refuse(409, 'customer_has_file', { what: `رقم السجل ${registration} على صفقة لعميل له ملف، فالصفقة الجديدة تنفتح من ملفه`,
    missing: [{ document: `ملف العميل ${earlierClient.code}`, why: 'ملف العميل ما فيه رقم السجل بعد، والرقم معروف من صفقته', owner: personName(db, earlierClient.owner_id) ?? 'مسؤول ملفات العملاء', owner_role: 'account_manager', doc_key: 'client' }],
    next: 'يسجّل مسؤول الحساب رقم السجل في ملف العميل، ثم تنفتح الصفقة من ملفه' });
  if (earlier) refuse(409, 'duplicate_registration', { what: `رقم السجل ${registration} عليه صفقة ما ارتبطت بملف عميل`,
    missing: [{ document: 'ملف عميل للجهة مربوط بصفقتها القائمة', why: 'الصفقة الثانية لنفس الجهة تنفتح من ملف العميل، والجهة ما لها ملف بعد', owner: personName(db, earlier.owner_id) ?? 'صاحب الصفقة القائمة', owner_role: 'account_manager', doc_key: 'client' }],
    next: 'أنشئ ملف العميل برقم سجله واربط الصفقة القائمة به من «العملاء»، ثم افتح الصفقة الجديدة من ملفه' });
  const id = randomUUID(), timestamp = now();
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'lead',?,?)").run(id, u.tenant_id, u.department_id, u.id, values.name, registration, values.contact, values.source, values.sector, timestamp, timestamp);
  audit(db, u, 'commercial', id, 'lead.created', {}, { status: 'lead', version: 1, registration_number: registration });
  return readCase(db, u, getCase(db, u, id));
}

// جهة الاتصال من ملف العميل: جهات تواصله النشطة كما سجّلها فريق الحساب.
function clientContact(db, clientId) {
  const rows = db.prepare('SELECT name,title FROM client_contacts WHERE client_id=? AND active=1 ORDER BY created_at,id').all(clientId);
  return rows.length ? rows.map(r => `${r.name} — ${r.title}`).join('، ').slice(0, 500) : null;
}
function requireRegistration(db, client) {
  if (!client.registration_number) refuse(409, 'registration_required', { what: `ملف العميل ${client.code} ما فيه رقم سجل، والصفقة تحتاجه`,
    missing: [{ document: 'رقم السجل التجاري في ملف العميل', why: 'رقم السجل هوية العميل في العقد والفاتورة والشهادة، وينسخ على كل صفقة له', owner: personName(db, client.owner_id) ?? 'مسؤول حساب العميل', owner_role: 'account_manager', doc_key: 'registration_number' }],
    next: 'يسجّله مسؤول الحساب في ملف العميل («رقم السجل»)، ثم افتح الصفقة' });
  return client.registration_number;
}
// يكتب الصفقة وربطها بملف العميل معًا: القرّاء القدامى يقرؤون client_links، والجدد client_id، فيتفقان دائمًا.
function insertDeal(db, actor, { owner, department, client, contact, source, opportunityId = null, predecessorId = null }) {
  const id = randomUUID(), timestamp = now();
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,created_at,updated_at,client_id,opportunity_id,predecessor_case_id) VALUES(?,?,?,?,?,?,?,?,?,'lead',?,?,?,?,?)")
    .run(id, actor.tenant_id, department, owner, client.legal_name, client.registration_number, contact, source, client.sector, timestamp, timestamp, client.id, opportunityId, predecessorId);
  db.prepare('INSERT INTO client_links VALUES(?,?,?,?)').run(client.id, id, actor.id, timestamp);
  audit(db, actor, 'commercial', id, 'lead.created', {}, { status: 'lead', version: 1, registration_number: client.registration_number, client_id: client.id,
    ...(opportunityId ? { opportunity_id: opportunityId } : {}), ...(predecessorId ? { predecessor_case_id: predecessorId } : {}), ...(owner !== actor.id ? { owner_id: owner } : {}) });
  return id;
}
function openDealForClient(db, u, input) {
  const typed = Object.keys(CLIENT_FIELDS).filter(key => input[key] !== undefined);
  if (typed.length) refuse(400, 'client_field_from_file', { what: `${typed.map(key => CLIENT_FIELDS[key]).join(' و')} تجي من ملف العميل، فما تنكتب مرة ثانية`,
    next: 'احذفها من الطلب: الصفقة تاخذ اسم العميل ورقم سجله وقطاعه من ملفه' });
  // عزل فريق الحساب نفسه (app/agency.mjs): من ليس في فريق العميل لا يفتح له صفقة ولا يعرف أن ملفه موجود.
  const client = clientFor(db, u, input.client_id).c;
  assertClientOpen(db, u.tenant_id, client.id, 'ما تنفتح صفقة');
  requireRegistration(db, client);
  let predecessorId = null;
  if (input.predecessor_case_id !== undefined && input.predecessor_case_id !== '') {
    const previous = typeof input.predecessor_case_id === 'string' && db.prepare('SELECT id,client_id FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.predecessor_case_id, u.tenant_id);
    if (!previous || previous.client_id !== client.id) refuse(409, 'predecessor_other_customer', { what: 'الصفقة السابقة لازم تكون صفقة لنفس العميل',
      missing: [{ document: `صفقة سابقة لعميل ${client.code}`, why: 'التجديد والنطاق الثاني يكملان صفقة العميل نفسه', owner: personName(db, client.owner_id) ?? 'مسؤول حساب العميل', owner_role: 'account_manager', doc_key: 'predecessor_case_id' }],
      next: 'اختر السابقة من صفقات العميل نفسه، أو افتح الصفقة بلا سابقة' });
    predecessorId = previous.id;
  }
  const contact = input.contact ? v.text(input.contact, 'جهة الاتصال', 500) : clientContact(db, client.id);
  if (!contact) refuse(409, 'contact_required', { what: `ملف العميل ${client.code} ما فيه جهة تواصل`,
    missing: [{ document: 'جهة تواصل في ملف العميل', why: 'الصفقة تحتاج من نكلّمه عند العميل', owner: personName(db, client.owner_id) ?? 'مسؤول حساب العميل', owner_role: 'account_manager', doc_key: 'contact' }],
    next: 'أضف جهة التواصل في ملف العميل، أو اكتبها مع الصفقة' });
  return insertDeal(db, u, { owner: u.id, department: u.department_id, client, contact, source: v.text(input.source, 'المصدر', 500), predecessorId });
}

// الفرصة تفتح صفقتها (P4-CRM-2، CRM-09): لا حقل يُكتب. العميل من ملفه، والتأهيل يُعبّأ من الفرصة ويرفع لقرار المدير المباشر
// كما يُرفع اليوم. ما ينقص الفرصة يُصلح في الفرصة نفسها، فلا يصير للمعلومة مصدران.
// يفتحها صاحب الفرصة أو مسؤول حساب العميل، والصفقة لصاحب الفرصة في الحالتين. ولكل فرصة صفقة واحدة: الفحص هنا،
// والفهرسان الفريدان (commercial_cases.opportunity_id وopportunities.case_id) يحسمان السباق في القاعدة.
export function createCaseFromOpportunity(db, suppliedUser, opportunityId, input) {
  requireTransaction(db);
  const u = currentUser(db, suppliedUser);
  v.object(input, ['version']);
  const o = typeof opportunityId === 'string' && db.prepare('SELECT * FROM opportunities WHERE id=? AND tenant_id=?').get(opportunityId, u.tenant_id);
  if (!o) refuse(404, 'not_found', { what: 'الفرصة مو متاحة لك', next: 'افتحها من «خط الفرص» في حساب عميل أنت في فريقه' });
  const client = clientFor(db, u, o.client_id).c;
  assertClientOpen(db, u.tenant_id, client.id, 'ما تنفتح صفقة من الفرصة');
  if (o.case_id) {
    const k = db.prepare('SELECT id,owner_id FROM commercial_cases WHERE id=?').get(o.case_id);
    refuse(409, 'already_converted', { what: `الفرصة «${o.name}» انفتحت لها صفقة من قبل`,
      missing: [{ document: `الصفقة ${dealRef(k.id)}`, why: 'لكل فرصة صفقة واحدة', owner: personName(db, k.owner_id) ?? 'صاحب الصفقة', owner_role: 'account_manager', doc_key: 'deal' }],
      next: 'كمّل على الصفقة القائمة من «العملاء والعروض»' });
  }
  if (o.status !== 'open') refuse(409, 'opportunity_closed', { what: `الفرصة «${o.name}» مقفلة (${o.status === 'won' ? 'رابحة' : 'خاسرة'})، فما تنفتح لها صفقة`,
    next: 'إذا رجع العميل بطلب جديد، افتح له فرصة جديدة' });
  if (u.id !== o.owner_id && u.id !== client.owner_id) refuse(403, 'not_permitted', { what: 'فتح صفقة من الفرصة لصاحبها أو لمسؤول حساب العميل',
    missing: [{ document: 'صاحب الفرصة', why: 'الصفقة تصير لصاحب الفرصة، وهو أو مسؤول الحساب يقرر متى تنفتح', owner: personName(db, o.owner_id) ?? 'صاحب الفرصة', owner_role: 'account_manager' }],
    next: 'اطلب من صاحب الفرصة يفتح صفقتها' });
  v.version(input.version, o.version);
  const owner = personAssignment(db, u.tenant_id, o.owner_id);
  if (!owner?.active || !['employee', 'manager'].includes(owner.role)) refuse(409, 'deal_owner_role', { what: 'صاحب الفرصة ما يقدر يمسك صفقة',
    missing: [{ document: 'صاحب فرصة بدور موظف أو مدير فريق، وحسابه نشط', why: 'الصفقة يعتمدها المدير المباشر لصاحبها، فلازم يكون له مدير مباشر في إدارته', owner: personName(db, client.owner_id) ?? 'مسؤول حساب العميل', owner_role: 'account_manager' }],
    next: 'انقل الفرصة لموظف في فريق الحساب، ثم افتح صفقتها' });
  requireRegistration(db, client);
  const missing = [];
  if (!o.decision_maker.trim()) missing.push({ document: 'صاحب القرار لدى العميل', why: 'التأهيل يسمّي من يقرر عند العميل', owner: personName(db, o.owner_id) ?? 'صاحب الفرصة', owner_role: 'account_manager', doc_key: 'decision_maker' });
  if (!o.expected_close_on || o.expected_close_on < today()) missing.push({ document: 'تاريخ الإغلاق المتوقع (اليوم أو بعده)', why: 'التأهيل يحمل توقيت القرار عند العميل', owner: personName(db, o.owner_id) ?? 'صاحب الفرصة', owner_role: 'account_manager', doc_key: 'expected_close_on' });
  if (missing.length) refuse(409, 'opportunity_incomplete', { what: `الفرصة «${o.name}» ناقصة، والتأهيل يتعبّى منها`, missing,
    next: 'عدّل بيانات الفرصة من «خط الفرص»، ثم افتح صفقتها' });
  const family = FAMILIES.find(f => f.key === o.service_family)?.name ?? o.service_family;
  // فرصة التجديد (P4-CRM-6، الترحيل 185): صفقتها تسمّي صفقة العقد الذي تجدّده سابقةً لها، فتبقى سلسلة التجديد مقروءة.
  const renewed = o.kind === 'renewal' && o.renews_contract_id ? db.prepare('SELECT case_id FROM contract_records WHERE id=? AND tenant_id=?').get(o.renews_contract_id, u.tenant_id)?.case_id ?? null : null;
  const caseId = insertDeal(db, u, { owner: o.owner_id, department: personDepartment(db, o.owner_id), client, contact: clientContact(db, client.id) ?? o.decision_maker,
    source: `فرصة «${o.name}» من خط الفرص`, opportunityId: o.id, predecessorId: renewed });
  // التأهيل المعبأ: نفس لقطة «qualify» بحقولها، ومعها من أين جاءت. يرفعه من فتح الصفقة ويقرره المدير المباشر لصاحبها.
  const c = db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(caseId);
  const manager = managerOf(db, c);
  const snapshot = { need: o.name, budget_minor: String(o.value_minor), currency: 'SAR', timing: o.expected_close_on, decision_maker: o.decision_maker, service_fit: family,
    budget_basis: o.budget_note, prefilled_from: { opportunity_id: o.id, opportunity_version: o.version } };
  const qualificationId = randomUUID(), time = now();
  db.prepare('INSERT INTO commercial_qualifications VALUES(?,?,?,?,?,?)').run(qualificationId, c.id, 1, JSON.stringify(snapshot), u.id, time);
  const reviewId = addReview(db, u, c, 'qualification', qualificationId);
  db.prepare("UPDATE commercial_cases SET status='qualification_pending',current_qualification_id=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(qualificationId, time, c.id, c.version);
  audit(db, u, 'commercial', c.id, 'qualify', { status: 'lead', version: c.version }, { status: 'qualification_pending', version: c.version + 1, qualification_id: qualificationId, revision: 1, review_id: reviewId, prefilled_from_opportunity: o.id });
  const linked = db.prepare('UPDATE opportunities SET case_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND case_id IS NULL').run(c.id, time, o.id, o.version).changes;
  if (linked !== 1) refuse(409, 'stale_version', { what: 'الفرصة تغيّرت قبل ما تنفتح صفقتها', next: 'حدّث الصفحة وأعد المحاولة' });
  audit(db, u, 'opportunity', o.id, 'opportunity.case_opened', { version: o.version }, { case_id: c.id, version: o.version + 1 });
  // التسليمان: لصاحب الصفقة إن فتحها غيره، ولمن يقرر التأهيل. notifyMany لا يُشعر الفاعل بفعله.
  notifyMany(db, [o.owner_id], u.id, { kind: 'deal_opened_from_opportunity', subjectKind: 'commercial_case', subjectId: c.id,
    title: `انفتحت صفقة من فرصتك «${o.name}»`, body: 'التأهيل متعبّي من الفرصة وينتظر قرار مديرك المباشر. تابعها من «العملاء والعروض».' });
  notifyMany(db, [manager.id], u.id, { kind: 'commercial_qualification_needed', subjectKind: 'commercial_case', subjectId: c.id,
    title: `تأهيل صفقة ينتظر قرارك: ${client.trade_name || client.legal_name}`, body: 'التأهيل متعبّي من الفرصة. افتح «العملاء والعروض» واعتمده أو ارفضه.' });
  return { id: c.id, status: 'qualification_pending', version: c.version + 1, client_id: client.id, opportunity_id: o.id, owner_id: o.owner_id, qualification_id: qualificationId, review_id: reviewId };
}

// ملخص الصفقة: لمن يرى الصفقة (صاحبها ومديره وأعضاء مشروعها) ولفريق حساب عميلها — فمسؤول الحساب الذي فتحها يقرأ ما فتح.
// حالة وأسماء فقط، بلا مبالغ ولا تأهيل ولا عروض.
export function dealSummary(db, suppliedUser, caseId) {
  const u = currentUser(db, suppliedUser);
  const c = typeof caseId === 'string' && db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(caseId, u.tenant_id);
  const team = c?.client_id && db.prepare('SELECT 1 FROM clients x LEFT JOIN client_members m ON m.client_id=x.id AND m.user_id=? AND m.removed_at IS NULL WHERE x.id=? AND x.tenant_id=? AND (x.owner_id=? OR m.user_id IS NOT NULL)').get(u.id, c.client_id, u.tenant_id, u.id);
  if (!c || (!accessLevel(db, u, c) && !team)) refuse(404, 'not_found', { what: 'الصفقة مو متاحة لك', next: 'افتحها من «العملاء والعروض» أو من ملف عميلها إن كنت في فريقه' });
  return { id: c.id, ref: dealRef(c.id), status: c.status, version: c.version, owner_name: personName(db, c.owner_id), project_id: c.project_id, created_at: c.created_at, ...dealContext(db, c) };
}

export function commercialAction(db, suppliedUser, id, action, input) {
  requireTransaction(db);
  const u = currentUser(db, suppliedUser), c = getCase(db, u, id);
  if (!Object.hasOwn(actions, action)) fail(400, 'unknown_action', 'الإجراء التجاري غير معروف');
  v.object(input, ['version', ...actions[action]]);
  v.version(input.version, c.version);
  assertClientOpen(db, u.tenant_id, c.client_id, 'ما تتحرك صفقة عميل مقفل');
  // العقد المنهى يُقال باسمه قبل «غير متاح»: الزر اختفى لسبب يعرفه صاحبه، لا لأن الحالة لا تسمح.
  const stops = { submit_delivery: 'ما ينقدّم مخرج للقبول', create_change: 'ما ينطلب تغيير على النطاق', start_change: 'ما تبدأ مهمة التغيير المعتمد' };
  if (stops[action]) refuseTerminated(db, c.id, stops[action]);
  if (!allowedActions(db, u, c).includes(action)) fail(403, 'commercial_transition', 'الإجراء غير متاح لحالتك أو نطاقك الحالي');
  if (action === 'close_lost' || action === 'withdraw') {
    // الصفقة وفرصتها تُغلقان معًا وبالسبب نفسه (app/crm-deals.mjs)، فلا تبقى فرصة مفتوحة على صفقة منتهية في التوقع.
    const reason = lossReason(db, u.tenant_id, input.reason_id), comment = v.text(input.comment, 'ماذا حدث وماذا نتعلم', 2000, 10);
    closeDealRow(db, u, c, { status: action === 'close_lost' ? 'lost' : 'withdrawn', reason, comment });
    const o = c.opportunity_id && db.prepare("SELECT * FROM opportunities WHERE id=? AND tenant_id=? AND status='open'").get(c.opportunity_id, c.tenant_id);
    if (o) loseOpportunityRow(db, u, o, { reason, comment, via: { case_id: c.id, action } });
    return readCase(db, u, getCase(db, u, c.id));
  }
  let status = c.status, qualificationId = c.current_qualification_id, quoteId = c.current_quote_id, projectId = c.project_id;
  let detail = {};
  if (action === 'qualify') {
    const snapshot = { need: v.text(input.need, 'الاحتياج', 3000, 3), budget_minor: String(decimalMinor(input.budget, 'ميزانية التأهيل')), currency: currency(input.currency),
      timing: futureDate(input.timing), decision_maker: v.text(input.decision_maker, 'صاحب القرار', 300), service_fit: v.text(input.service_fit, 'ملاءمة الخدمة', 3000, 3) };
    managerOf(db, c);
    qualificationId = randomUUID();
    const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM commercial_qualifications WHERE case_id=?').get(c.id).n;
    db.prepare('INSERT INTO commercial_qualifications VALUES(?,?,?,?,?,?)').run(qualificationId, c.id, revision, JSON.stringify(snapshot), u.id, now());
    detail = { qualification_id: qualificationId, revision, review_id: addReview(db, u, c, 'qualification', qualificationId) };
    status = 'qualification_pending';
  } else if (['approve_qualification', 'reject_qualification'].includes(action)) {
    detail = decide(db, u, c, 'qualification', qualificationId, action.startsWith('approve') ? 'approved' : 'rejected', input.note);
    status = action.startsWith('approve') ? 'qualified' : 'qualification_rejected';
  } else if (action === 'save_quote') {
    requireApproved(db, c, 'qualification', qualificationId);
    const snapshot = quoteSnapshot(input);
    const qualification = JSON.parse(db.prepare('SELECT snapshot FROM commercial_qualifications WHERE id=? AND case_id=?').get(qualificationId, c.id).snapshot);
    if (snapshot.currency !== qualification.currency) fail(400, 'currency_mismatch', 'عملة العرض يجب أن تطابق التأهيل المعتمد؛ لا توجد تحويلات عملة محلية');
    // القرار D2: النسخة تُحفظ على عرض سعر العميل (FRM-024) الذي تساويه، ويُفحص الربط قبل أي كتابة فيُرفض بالاسم.
    const proposal = checkQuoteBinding(db, c, snapshot, input.quotation_id);
    quoteId = randomUUID();
    const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM commercial_quotes WHERE case_id=?').get(c.id).n;
    const serialized = JSON.stringify(snapshot);
    db.prepare('INSERT INTO commercial_quotes VALUES(?,?,?,?,?,?,?,?)').run(quoteId, c.id, qualificationId, revision, serialized, hash(serialized), u.id, now());
    detail = { quote_id: quoteId, revision, total_minor: snapshot.total_minor, currency: snapshot.currency, proposal: writeQuoteBinding(db, u, c, quoteId, proposal) };
    status = 'quote_draft';
  } else if (action === 'submit_quote') {
    const quote = quoteOf(db, c);
    futureDate(quote.snapshot.valid_until);
    requireApproved(db, c, 'qualification', quote.qualification_id);
    assertProposalChecklistApproved(db, c, quote.id);
    detail = { quote_id: quote.id, review_id: addReview(db, u, c, 'quote', quote.id), digest: quote.digest };
    status = 'quote_pending';
  } else if (['approve_quote', 'reject_quote'].includes(action)) {
    const quote = quoteOf(db, c);
    // سلطة الهامش (MOD-BD-03): الاعتماد يقرأ الهامش المستهدف على ورقة التسعير واستثناءه، وتُحفظ القراءة مع القرار. الرفض لا يحتاجها.
    let evidence = {};
    if (action === 'approve_quote') { futureDate(quote.snapshot.valid_until); evidence = marginEvidence(requireProposalForApproval(db, c, quote)); }
    detail = decide(db, u, c, 'quote', quote.id, action === 'approve_quote' ? 'approved' : 'rejected', input.note, evidence);
    status = action === 'approve_quote' ? 'quote_approved' : 'quote_rejected';
  } else if (action === 'register_contract') {
    const quote = quoteOf(db, c);
    requireApproved(db, c, 'quote', quote.id); futureDate(quote.snapshot.valid_until);
    // الاتفاق على عرض السعر الذي قبله العميل بنسخته المربوطة نفسها، والهامش داخل السلطة يوم صدر العرض.
    const accepted = requireAcceptedProposal(db, c, quote);
    const evidence = v.text(input.agreement_evidence, 'دليل الاتفاق الداخلي', 5000, 10);
    const representative = v.text(input.customer_representative, 'ممثل العميل المذكور في الدليل', 300, 3);
    const contractId = randomUUID();
    const snapshot = { ...quote.snapshot, quote_id: quote.id, quote_revision: quote.revision, quote_digest: quote.digest, client_name: c.name, registration_number: c.registration_number, internal_only: true,
      quotation_id: accepted.quotation.id, quotation_code: accepted.quotation.code, quotation_revision: accepted.version.revision, quotation_digest: accepted.version.digest };
    db.prepare('INSERT INTO commercial_contracts VALUES(?,?,?,?,?,?,?,?)').run(contractId, c.id, quote.id, JSON.stringify(snapshot), evidence, representative, u.id, now());
    detail = { contract_id: contractId, quote_id: quote.id, internal_only: true, proposal: writeContractBinding(db, u, c, contractId, quote, accepted) };
    status = 'contracted';
  } else if (action === 'create_project') {
    const contract = contractOf(db, c);
    requireApproved(db, c, 'quote', contract.quote_id);
    if (!Array.isArray(input.member_ids) || input.member_ids.length > 30 || input.member_ids.some(mid => typeof mid !== 'string')) fail(400, 'members', 'قائمة أعضاء المشروع غير صالحة');
    const memberIds = [...new Set([u.id, c.owner_id, ...input.member_ids])];
    for (const memberId of memberIds) {
      if (!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND department_id=? AND active=1 AND role IN ('employee','manager','pm') AND (id=? OR manager_id=?)").get(memberId, u.tenant_id, c.department_id, u.id, u.id)) fail(403, 'member_scope', 'أعضاء المشروع من فريق المدير المباشر فقط');
    }
    projectId = randomUUID();
    db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(projectId, u.tenant_id, c.name, contract.snapshot.scope, u.id, now());
    for (const memberId of memberIds) db.prepare('INSERT INTO project_members VALUES(?,?)').run(projectId, memberId);
    db.prepare('INSERT INTO commercial_project_baselines VALUES(?,?,?,?,?,?)').run(projectId, c.id, contract.id, contract.quote_id, JSON.stringify(contract.snapshot), now());
    audit(db, u, 'project', projectId, 'commercial.created', {}, { case_id: c.id, contract_id: contract.id, quote_id: contract.quote_id, members: memberIds });
    detail = { project_id: projectId, contract_id: contract.id, members: memberIds }; status = 'project_active';
  } else if (action === 'submit_delivery') {
    refuseTerminated(db, c.id, 'ما ينقدّم مخرج للقبول');
    // التسليم تنفيذٌ مدفوع: كان يمضي بعد فتح المشروع مباشرة بلا أي مقبوض (تدقيق 20 سبتمبر، B1). يُفحص لحظة كل تقديم.
    assertReadyForPaidExecution(db, u.tenant_id, c.project_id, 'ما ينقدّم مخرج للقبول');
    const contract = contractOf(db, c);
    if (!Number.isInteger(input.line_index) || input.line_index < 0 || input.line_index >= contract.snapshot.lines.length) fail(400, 'contract_line', 'المخرج يجب أن يرتبط ببند أصلي في العقد');
    if (db.prepare("SELECT 1 FROM commercial_deliveries d JOIN commercial_reviews r ON r.kind='delivery' AND r.subject_id=d.id WHERE d.case_id=? AND d.line_index=? AND r.status IN ('pending','approved')").get(c.id, input.line_index)) fail(409, 'delivery_exists', 'لهذا البند نسخة معلقة أو مقبولة بالفعل');
    const evidence = v.text(input.evidence, 'دليل المخرج', 5000, 10);
    const manager = managerOf(db, c);
    if (!isMember(db, manager, c)) fail(409, 'approver_unavailable', 'مدير القبول يجب أن يكون عضوًا في المشروع');
    const deliveryId = randomUUID();
    const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM commercial_deliveries WHERE case_id=? AND line_index=?').get(c.id, input.line_index).n;
    db.prepare('INSERT INTO commercial_deliveries VALUES(?,?,?,?,?,?,?,?)').run(deliveryId, c.id, contract.id, input.line_index, revision, evidence, u.id, now());
    detail = { delivery_id: deliveryId, line_index: input.line_index, revision, review_id: addReview(db, u, c, 'delivery', deliveryId) };
  } else if (action === 'accept_delivery') {
    const delivery = db.prepare('SELECT * FROM commercial_deliveries WHERE id=? AND case_id=?').get(v.text(input.delivery_id, 'معرف المخرج', 100), c.id);
    if (!delivery) fail(404, 'not_found', 'المخرج غير متاح');
    // ممثل العميل من سجل مفوّضي المشروع، ساريًا اليوم — السجل نفسه الذي تسمّي منه شهادة الإنجاز ممثلها (الترحيل 164). كان اسمًا يُكتب.
    const approver = typeof input.approver_id === 'string' && db.prepare('SELECT * FROM client_approvers WHERE id=? AND tenant_id=? AND project_id=?').get(input.approver_id, u.tenant_id, c.project_id);
    if (input.customer_representative !== undefined || !approver || approver.valid_from > today() || (approver.revoked_on && approver.revoked_on <= today())) refuse(409, 'approver_required', {
      what: input.customer_representative !== undefined ? 'ممثل العميل في قبول المخرج يُختار من سجل مفوّضي المشروع، ما يُكتب اسمًا'
        : approver ? `تفويض «${approver.name}» مو ساري اليوم، فما يُسمّى ممثلًا للعميل في القبول` : 'ممثل العميل في قبول المخرج لازم يكون من سجل مفوّضي هذا المشروع',
      missing: [{ document: 'ممثل عميل مسجّل بسند تفويضه ونطاقه، وتفويضه ساري', why: 'القبول يسمّي من قبل عن العميل وعلى أي أساس، كما تسمّيه شهادة الإنجاز', owner: 'حامل تصريح «توثيق موافقات العملاء الخارجية»', owner_role: 'pm', doc_key: 'approver_id' }],
      next: 'سجّل ممثل العميل وسند تفويضه من «موافقات العملاء»، ثم اختره في القبول' });
    const evidence = { acceptance_evidence: v.text(input.acceptance_evidence, 'دليل القبول', 5000, 10), approver_id: approver.id, customer_representative: approver.name,
      approver_title: approver.title, authority_basis: approver.authority_basis, authority_scope: approver.authority_scope, internal_only: true };
    detail = decide(db, u, c, 'delivery', delivery.id, 'approved', input.note, evidence);
  } else if (action === 'create_change') {
    refuseTerminated(db, c.id, 'ما ينطلب تغيير على النطاق');
    const contract = contractOf(db, c);
    if (!isMember(db, managerOf(db, c), c)) fail(409, 'approver_unavailable', 'مدير اعتماد التغيير يجب أن يكون عضوًا في المشروع');
    const price = decimalMinor(input.additional_price, 'سعر العمل الإضافي'), cost = decimalMinor(input.additional_cost, 'تكلفة العمل الإضافي');
    if (!Number.isInteger(input.extra_days) || input.extra_days < 0 || input.extra_days > 3650) fail(400, 'extra_days', 'أثر المدة عدد أيام من صفر إلى 3650');
    const snapshot = { scope: v.text(input.scope, 'نطاق التغيير', 3000, 3), currency: contract.snapshot.currency, additional_price_minor: String(price), additional_cost_minor: String(cost), margin_delta_minor: String(price - cost), extra_days: input.extra_days,
      due_date: futureDate(input.due_date), acceptance: v.text(input.acceptance, 'معيار قبول العمل الإضافي', 2000, 3), baseline_quote_id: contract.quote_id };
    const changeId = randomUUID();
    db.prepare('INSERT INTO commercial_changes VALUES(?,?,?,?,?,?)').run(changeId, c.id, contract.id, JSON.stringify(snapshot), u.id, now());
    detail = { change_id: changeId, review_id: addReview(db, u, c, 'change', changeId) };
  } else if (['approve_change', 'reject_change', 'start_change'].includes(action)) {
    const change = db.prepare('SELECT * FROM commercial_changes WHERE id=? AND case_id=?').get(v.text(input.change_id, 'معرف التغيير', 100), c.id);
    if (!change) fail(404, 'not_found', 'طلب التغيير غير متاح');
    if (action === 'start_change') {
      refuseTerminated(db, c.id, 'ما تبدأ مهمة التغيير المعتمد');
      // مهمة التغيير المعتمد عملٌ مدفوع إضافي على المشروع نفسه، فتقف حيث يقف التسليم.
      assertReadyForPaidExecution(db, u.tenant_id, c.project_id, 'ما تبدأ مهمة التغيير المعتمد');
      requireApproved(db, c, 'change', change.id);
      if (db.prepare('SELECT 1 FROM commercial_change_tasks WHERE change_id=?').get(change.id)) fail(409, 'change_started', 'سبق إنشاء مهمة لهذا التغيير');
      const snapshot = JSON.parse(change.snapshot), taskId = randomUUID();
      db.prepare('INSERT INTO tasks(id,project_id,title,assignee_id,due_date,acceptance,created_at) VALUES(?,?,?,?,?,?,?)').run(taskId, c.project_id, snapshot.scope.slice(0, 180), u.id, snapshot.due_date, snapshot.acceptance, now());
      db.prepare('INSERT INTO commercial_change_tasks VALUES(?,?,?)').run(change.id, taskId, now());
      audit(db, u, 'project', c.project_id, 'change.task_created', {}, { change_id: change.id, task_id: taskId });
      detail = { change_id: change.id, task_id: taskId };
    } else detail = decide(db, u, c, 'change', change.id, action === 'approve_change' ? 'approved' : 'rejected', input.note);
  }
  db.prepare('UPDATE commercial_cases SET status=?,current_qualification_id=?,current_quote_id=?,project_id=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status, qualificationId, quoteId, projectId, now(), c.id, c.version);
  audit(db, u, 'commercial', c.id, action, { status: c.status, version: c.version }, { status, version: c.version + 1, ...detail }, input.note ?? '');
  return readCase(db, u, getCase(db, u, c.id));
}

export function submitTechnicalProposalChecklist(db, suppliedUser, id, input) {
  requireTransaction(db);
  const u = currentUser(db, suppliedUser), c = getCase(db, u, id);
  return submitProposalChecklist(db, u, c, input);
}
