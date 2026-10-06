import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { CHANNELS } from './client-approvals.mjs';
import { personName } from './people-read.mjs';
import { dual } from './dates.mjs';
import { documentFooter, SYNTHETIC } from './tenant-identity.mjs';
import { acceptanceAxis, projectManager } from './project-axes.mjs';

// شهادة الإنجاز (FRM-030): سجلٌّ مرقّم بنسخته، يشهد بإنجاز بنود اتفاقٍ قُبلت كلها، ويسمّي ممثل العميل بسند تفويضه،
// ويحمل قبول العميل دليلًا خارجيًا بحدّه المكتوب. الترحيلان: 116 (المستند) و164 (الثبات والممثل والقناة والتصحيح والعكس).
//
// لماذا وحدة مستقلة عن app/project-axes.mjs: الشهادة سجلٌّ له دورته (إصدار، قبول، تصحيح بنسخة، عكس) ومستنده، والمحاور
// تسأل عنها سؤالًا واحدًا فقط — «هل للمشروع شهادة حيّة قبلها العميل؟» (acceptedCertificate). وأسماء الإصدار والقبول القديمة
// تبقى مُصدَّرة من المحاور كما كانت، فلا يتغير سطر استيراد عند من يناديها.
//
// ولا توقيع هنا بأي معنى: المنصة ما عندها آلية توقيع معتمدة، والعميل ما يدخلها (قرار المالك، ACC-04 مستبعد). فالقبول دائمًا
// دليل خارجي أدخله موظف باسمه، وكل قراءة تقول ذلك صراحةً (electronic_signature:false وجملة التوثيق)، ولا قناة للتوقيع
// في قيد القاعدة أصلًا. إن اعتُمدت آلية توقيع يومًا، تُبنى معها قناتها ويُرفع هذا الحكم بترحيل، لا بسطر هنا.

const id = () => randomUUID();
const DAY = { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' };
const today = () => new Intl.DateTimeFormat('en-CA', DAY).format(new Date());
// تاريخ الإصدار باليوم الذي عاشه من أصدرها في الرياض، لا بتاريخ UTC: شهادة صدرت الساعة الواحدة فجرًا صدرت «اليوم» لا «أمس».
const riyadhDay = iso => new Intl.DateTimeFormat('en-CA', DAY).format(new Date(iso));

export const SIGNATURE_STATEMENT = 'ما فيه توقيع إلكتروني على هذي الشهادة: المنصة ما عندها آلية توقيع معتمدة، والعميل ما يدخل المنصة. قبول العميل دليل خارجي أدخله موظف باسمه وبالقناة المذكورة معه.';
export const STATE_NAMES = Object.freeze({ issued: 'صادرة وتنتظر قبول العميل', accepted: 'قبلها العميل', superseded: 'استُبدلت بنسخة أحدث', reversed: 'معكوسة' });

// حدّ كل قناة: ما لا يثبته هذا الدليل. يُكتب على سجل القبول وقت تسجيله ويُعرض معه أينما عُرض.
const LIMITS = Object.freeze({
  email: 'بريد وصلنا من ممثل العميل ووثّقه موظف. المنصة ما تحققت من هوية المرسل ولا من سلامة الرسالة، وهو مو توقيع إلكتروني.',
  signed_document: 'مستند يقول إن ممثل العميل وقّعه، وصل خارج المنصة ووثّق مرجعه موظف. المنصة ما تحققت من التوقيع ولا تحفظ صورته، وهو مو توقيع إلكتروني.',
  meeting_minutes: 'محضر اجتماع حضره ممثل العميل ووثّق مرجعه موظف. قوته من المحضر ومن حضره، والمنصة ما تحققت منه، وهو مو توقيع إلكتروني.',
  message: 'رسالة نصية أو من تطبيق تواصل وثّقها موظف. المنصة ما تحققت من رقم المرسل ولا من نص الرسالة، وهو مو توقيع إلكتروني.',
  call: 'اتصال هاتفي ما يترك أثر مكتوب من العميل. المرجع المذكور هو التأكيد المكتوب اللي لحقه، والمنصة ما تحققت منه، وهو مو توقيع إلكتروني.'
});
// القنوات مفاتيح سجل الموافقات الخارجية وأسماؤه نفسها (app/client-approvals.mjs)، فلا تفترق قائمتان على المعنى الواحد.
// تُقرأ عند النداء لا عند التحميل: قيمةٌ من وحدة أخرى تُقرأ في أعلى الملف تعتمد على من كان المدخل (tests/module-standalone.test.mjs).
export const acceptanceChannels = () => CHANNELS.map(channel => ({ ...channel, limitation: LIMITS[channel.key] }));
// من يوثّق قرار عميل وصل خارج المنصة: قاعدة سجل الموافقات الخارجية نفسها — التصريح، وأحد أدوار العمل على المشاريع.
const RECORDER_ROLES = ['employee', 'manager', 'pm'];
const mayRecordAcceptance = (db, u) => RECORDER_ROLES.includes(u.role) && can(db, u, 'approvals.record');

function writing(db) { if (!db.isTransaction) fail(500, 'transaction_required', 'تسجيل شهادة الإنجاز يحتاج معاملة قاعدة بيانات'); }
// عضوية المشروع كما تقرؤها بقية الوحدات. من ليس عضوًا لا يعرف أن للمشروع شهادة أصلًا: 404 لا 403.
function memberProject(db, u, projectId) {
  const project = typeof projectId === 'string' && db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.id=? AND p.tenant_id=? AND m.user_id=?').get(projectId, u.tenant_id, u.id);
  if (!project) fail(404, 'project_not_found', 'المشروع هذا مو متاح لك، أو ما أنت عضو فيه');
  return project;
}
function certificateRow(db, u, certificateId) {
  const row = typeof certificateId === 'string' && db.prepare('SELECT * FROM completion_certificates WHERE id=? AND tenant_id=?').get(certificateId, u.tenant_id);
  // كيانٌ آخر وغيرُ العضو يُرد عليهما بالجملة نفسها: لا يُكشف وجود شهادة لمن لا يراها.
  if (!row || !db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(row.project_id, u.id)) fail(404, 'not_found', 'ما لقينا شهادة الإنجاز هذي في مشاريعك');
  return row;
}
const caseOf = (db, project) => db.prepare('SELECT * FROM commercial_cases WHERE project_id=? AND tenant_id=?').get(project.id, project.tenant_id) ?? null;
// قاعدة «مدير المشروع» واحدة في المنصة (projectManager في app/project-axes.mjs)؛ هنا تُسأل سؤالًا لا رفضًا، لتُبنى بها الأزرار.
function managesProject(db, u, project) {
  // مدير السجل غير المتاح (خرج من المشروع أو أُوقف حسابه) لا يدير أحدٌ بعده حتى يُصحَّح الإسناد: الزر يختفي، والقراءة لا تسقط.
  try { projectManager(db, u, project); return true; } catch (error) { if (['not_project_manager', 'project_manager_unavailable'].includes(error.code)) return false; throw error; }
}

/* ───── الحالة: تُشتق من السجلات، لأن الصف الصادر لا يُعدَّل ───── */
const successorOf = (db, row) => db.prepare('SELECT id,number,revision FROM completion_certificates WHERE supersedes_id=?').get(row.id) ?? null;
const reversalOf = (db, row) => db.prepare('SELECT * FROM completion_certificate_reversals WHERE certificate_id=?').get(row.id) ?? null;
const acceptanceOf = (db, row) => db.prepare('SELECT * FROM completion_certificate_acceptances WHERE certificate_id=?').get(row.id) ?? null;
function stateOf(db, row) {
  // الترتيب مقصود: العكس ثم الاستبدال ثم القبول. والمحفّزات تمنع أن تُعكس نسخةٌ استُبدلت أو تُصحَّح نسخةٌ عُكست.
  // و«void» و«acknowledged» حالتا صفوفٍ كُتبت قبل الترحيل 164 وتُقرآن بمعناهما يومها.
  if (row.status === 'void' || reversalOf(db, row)) return 'reversed';
  if (successorOf(db, row)) return 'superseded';
  if (row.status === 'acknowledged' || acceptanceOf(db, row)) return 'accepted';
  return 'issued';
}
function liveRow(db, projectId) {
  return db.prepare(`SELECT c.* FROM completion_certificates c WHERE c.project_id=? AND c.status<>'void'
    AND NOT EXISTS(SELECT 1 FROM completion_certificates s WHERE s.supersedes_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM completion_certificate_reversals r WHERE r.certificate_id=c.id)
    ORDER BY c.sequence DESC LIMIT 1`).get(projectId) ?? null;
}
// ما يسأله الإقفال الفني (app/project-axes.mjs technicalOutstanding): النسخة الحيّة التي قبلها العميل، أو لا شيء.
// نسخةٌ استُبدلت أو عُكست لا تُحسب حتى لو قُبلت يومًا: الإقفال يقوم على ما يسري الآن.
export function acceptedCertificate(db, projectId) {
  const row = liveRow(db, projectId);
  return row && stateOf(db, row) === 'accepted' ? row : null;
}
// ملخص كل نسخ شهادات المشروع لقراءة المحاور: الحالة المشتقة لا عمود status الذي يبقى «issued» بعد الصدور.
export function certificateSummaries(db, projectId) {
  return db.prepare('SELECT * FROM completion_certificates WHERE project_id=? ORDER BY sequence').all(projectId).map(row => {
    const state = stateOf(db, row);
    return { id: row.id, number: row.number, revision: row.revision, state, state_name: STATE_NAMES[state], issued_at: row.issued_at,
      accepted_at: acceptanceOf(db, row)?.recorded_at ?? row.acknowledged_at ?? null };
  });
}
const closureRests = (db, row) => !!db.prepare("SELECT 1 FROM project_closures WHERE certificate_id=? AND technical_state='closed'").get(row.id);
// من قبل مخرجات الشهادة داخليًا (قرار accept_delivery)؛ لا يسجّل قبول العميل للشهادة نفسها (المحفّز يقول الشيء نفسه).
function acceptorsOf(db, row) {
  return new Set(JSON.parse(row.delivery_ids).map(deliveryId => db.prepare("SELECT approver_id FROM commercial_reviews WHERE kind='delivery' AND subject_id=?").get(deliveryId)?.approver_id).filter(Boolean));
}

/* ───── القراءة ───── */
// كل مخرج بتقرير إنجازه (دليل التسليم) ومحضر قبوله (دليل القرار) ومن قبله: هذا ربط الشهادة بتقرير الإنجاز ومحضر القبول.
// الصفّان ثابتان في القاعدة (محفّزا 004)، فالمعرّف يكفي ولا تُنسخ لقطة ثانية تفترق عن أصلها.
function deliverablesOf(db, row) {
  const contract = db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(row.case_id);
  const lines = contract ? JSON.parse(contract.snapshot).lines : [];
  return JSON.parse(row.delivery_ids).map(deliveryId => {
    const d = db.prepare('SELECT * FROM commercial_deliveries WHERE id=?').get(deliveryId) ?? null;
    const r = db.prepare("SELECT * FROM commercial_reviews WHERE kind='delivery' AND subject_id=?").get(deliveryId) ?? null;
    const decided = r ? JSON.parse(r.evidence_json) : {}, line = d ? lines[d.line_index] : null;
    return { delivery_id: deliveryId, line_index: d?.line_index ?? null, description: line?.description ?? '', acceptance_criterion: line?.acceptance ?? '',
      delivery_revision: d?.revision ?? null, completion_report: d?.evidence ?? '', submitted_by_name: personName(db, d?.created_by), submitted_at: d?.created_at ?? null,
      acceptance_minutes: decided.acceptance_evidence ?? '', customer_representative: decided.customer_representative ?? '',
      accepted_by_name: personName(db, r?.approver_id), accepted_at: r?.decided_at ?? null };
  });
}
function representativeOf(row) {
  // صفٌّ قبل الترحيل 164: الاسم كما كُتب، ولا سند تفويض لأنه ما طُلب يومها. لا يُختلق له سند بأثر رجعي.
  if (!row.approver_id) return { approver_id: null, name: row.customer_representative, title: '', authority_basis: null, authority_scope: '', valid_from: null, registered: false };
  const snapshot = JSON.parse(row.approver_snapshot);
  return { approver_id: row.approver_id, name: snapshot.name, title: snapshot.title, authority_basis: snapshot.authority_basis,
    authority_scope: snapshot.authority_scope, valid_from: snapshot.valid_from ?? null, registered: true };
}
function acceptanceView(db, row) {
  const channelName = key => CHANNELS.find(channel => channel.key === key)?.name ?? key;
  const a = acceptanceOf(db, row);
  if (a) return { channel: a.channel, channel_name: channelName(a.channel), received_on: a.received_on, evidence_reference: a.evidence_reference,
    limitation: a.limitation, source: 'employee_entered_external_evidence', recorded_by_name: personName(db, a.recorded_by), recorded_at: a.recorded_at };
  if (row.status === 'acknowledged') return { channel: null, channel_name: 'ما سُجّلت قناته', received_on: null, evidence_reference: row.acknowledgement_evidence,
    limitation: 'قبولٌ سُجّل قبل ما تُطلب القناة وسند التفويض (الترحيل 164). دليل خارجي أدخله موظف، وهو مو توقيع إلكتروني.',
    source: 'employee_entered_external_evidence', recorded_by_name: personName(db, row.acknowledged_by), recorded_at: row.acknowledged_at };
  return null;
}
function actionsFor(db, u, row, state, project) {
  const out = [];
  if (state === 'issued' && row.approver_id && mayRecordAcceptance(db, u) && u.id !== row.issued_by && !acceptorsOf(db, row).has(u.id)) out.push('accept_certificate');
  if (['issued', 'accepted'].includes(state) && managesProject(db, u, project) && !closureRests(db, row)) out.push('correct_certificate', 'reverse_certificate');
  return out;
}
function view(db, u, row) {
  const state = stateOf(db, row), project = db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  const c = db.prepare('SELECT id,name,registration_number FROM commercial_cases WHERE id=?').get(row.case_id);
  const reversal = reversalOf(db, row);
  return { id: row.id, number: row.number, sequence: row.sequence, revision: row.revision, version: row.version,
    state, state_name: STATE_NAMES[state],
    project: { id: project.id, name: project.name },
    client: { case_id: c.id, name: c.name, registration_number: c.registration_number },
    scope_summary: row.scope_summary, deliverables: deliverablesOf(db, row), client_representative: representativeOf(row),
    evidence: row.evidence, issued_at: row.issued_at, issued_on: riyadhDay(row.issued_at), issued_by_name: personName(db, row.issued_by),
    acceptance: acceptanceView(db, row),
    electronic_signature: false, signature_statement: SIGNATURE_STATEMENT,
    supersedes: row.supersedes_id ? db.prepare('SELECT id,number,revision FROM completion_certificates WHERE id=?').get(row.supersedes_id) : null,
    correction_reason: row.correction_reason, superseded_by: successorOf(db, row),
    reversal: reversal ? { reason: reversal.reason, reversed_by_name: personName(db, reversal.reversed_by), reversed_at: reversal.reversed_at }
      : row.status === 'void' ? { reason: row.void_reason, reversed_by_name: null, reversed_at: null } : null,
    actions: actionsFor(db, u, row, state, project) };
}
export function getCompletionCertificate(db, supplied, certificateId) {
  const u = actorOrRefuse(db, supplied);
  return view(db, u, certificateRow(db, u, certificateId));
}

/* ───── شروط الإصدار: كل رفض يسمّي الناقص ومالكه والخطوة التالية ───── */
const activeOn = (approver, date) => approver.valid_from <= date && (!approver.revoked_on || approver.revoked_on > date);
const activeApprovers = (db, projectId) => db.prepare('SELECT id,name,title,authority_basis,authority_scope,valid_from,revoked_on FROM client_approvers WHERE project_id=? ORDER BY created_at,id').all(projectId).filter(a => activeOn(a, today()));
function acceptedDeliveries(db, project, c) {
  const acceptance = acceptanceAxis(db, project);
  // الشهادة مبنية على القبول القائم لا بديلًا عنه: لا تُصدَر وبندٌ من العقد ما قُبل بقرار مستقل.
  if (acceptance.state !== 'accepted') refuse(409, 'deliverable_not_accepted', {
    what: 'ما تنصدر شهادة إنجاز وفيه بنود من العقد ما قُبلت',
    missing: acceptance.outstanding.map(line => ({ document: `قبول بند «${line.description}»`, why: 'كل بند تشهد به الشهادة لازم يكون مقبول بقرار مستقل قبلها', owner: 'المدير المباشر لمسؤول الملف', owner_role: 'manager' })),
    next: 'قدّم المخرج واطلب قبوله من ملف العميل، وبعد ما تنقبل كل البنود أصدر الشهادة' });
  return db.prepare("SELECT d.id FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE d.case_id=? ORDER BY d.line_index").all(c.id).map(r => r.id);
}
function representative(db, u, project, approverId) {
  const approver = typeof approverId === 'string' && db.prepare('SELECT * FROM client_approvers WHERE id=? AND tenant_id=? AND project_id=?').get(approverId, u.tenant_id, project.id);
  if (!approver || !activeOn(approver, today())) refuse(409, 'approver_required', {
    what: approver ? `تفويض «${approver.name}» مو ساري اليوم، فما تسمّيه الشهادة ممثلًا للعميل` : 'ممثل العميل في الشهادة لازم يكون من سجل مفوّضي هذا المشروع',
    missing: [{ document: 'ممثل عميل مسجّل بسند تفويضه ونطاقه، وتفويضه ساري', why: 'الشهادة تسمّي من يقبلها عن العميل وعلى أي أساس، ما تكتفي باسم يُكتب', owner: 'حامل تصريح «توثيق موافقات العملاء الخارجية»', owner_role: 'pm' }],
    next: 'سجّل ممثل العميل وسند تفويضه من «موافقات العملاء»، ثم أصدر الشهادة باسمه' });
  return approver;
}
function insertCertificate(db, u, { project, c, deliveries, approver, input, revision, supersedes, reason }) {
  const summary = v.text(input.scope_summary, 'وش أُنجز بالضبط (ملخص الإنجاز)', 5000, 20);
  const report = v.text(input.evidence, 'مرجع تقرير إنجاز المشروع', 5000, 10);
  // التسلسل داخل معاملة الكاتب (BEGIN IMMEDIATE): طلبان متزامنان يتسلسلان على القفل فلا يأخذان رقمًا واحدًا،
  // والرقم لا يُستهلك إلا بإصدار تمّ — فلا فجوة. ومحفّز completion_certificates_numbered خط الدفاع الثاني.
  const sequence = db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM completion_certificates WHERE tenant_id=?').get(u.tenant_id).n;
  const number = `CERT-${String(sequence).padStart(5, '0')}`, certificateId = id(), time = now();
  const snapshot = { name: approver.name, title: approver.title, authority_basis: approver.authority_basis, authority_scope: approver.authority_scope, valid_from: approver.valid_from };
  db.prepare(`INSERT INTO completion_certificates(id,tenant_id,case_id,project_id,sequence,number,scope_summary,delivery_ids,our_representative,customer_representative,evidence,status,issued_by,issued_at,
      revision,supersedes_id,correction_reason,approver_id,approver_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,'issued',?,?,?,?,?,?,?)`)
    .run(certificateId, u.tenant_id, c.id, project.id, sequence, number, summary, JSON.stringify(deliveries), u.name, approver.name, report, u.id, time,
      revision, supersedes?.id ?? null, reason, approver.id, JSON.stringify(snapshot));
  return db.prepare('SELECT * FROM completion_certificates WHERE id=?').get(certificateId);
}
// ما يُغيَّر بعد الصدور (تصحيح أو عكس) يكون على النسخة الحيّة وحدها، ولا يمس شهادةً يقوم عليها إقفال فني قائم.
function requireChangeable(db, row, act) {
  const state = stateOf(db, row);
  if (state === 'superseded') { const next = successorOf(db, row); refuse(409, 'certificate_superseded', { what: `الشهادة ${row.number} استُبدلت بالنسخة ${next.number}`, missing: [], next: `${act} يكون على النسخة السارية ${next.number}` }); }
  if (state === 'reversed') refuse(409, 'certificate_reversed', { what: `الشهادة ${row.number} معكوسة وما عادت سارية`, missing: [], next: 'إذا المخرجات لا تزال مقبولة أصدر للمشروع شهادة جديدة' });
  if (closureRests(db, row)) refuse(409, 'closure_rests_on_certificate', {
    what: `الإقفال الفني للمشروع قائم على الشهادة ${row.number}`,
    missing: [{ document: 'إعادة فتح الإقفال الفني بسبب مكتوب', why: 'الشهادة اللي انبنى عليها إقفال قائم ما تتغير تحته', owner: 'حامل تصريح «إعادة فتح إقفال المشروع»', owner_role: 'manager' }],
    next: `أعد فتح الإقفال الفني أولًا، ثم ارجع لـ«${act}»` });
  return state;
}

/* ───── الإصدار ───── */
export function issueCompletionCertificate(db, supplied, projectId, input) {
  writing(db);
  const u = actorOrRefuse(db, supplied);
  v.object(input, ['scope_summary', 'approver_id', 'evidence']);
  const project = memberProject(db, u, projectId);
  projectManager(db, u, project);
  const c = caseOf(db, project);
  if (!c) refuse(409, 'case_required', { what: 'ما تنصدر شهادة إنجاز لمشروع ما له ملف تجاري',
    missing: [{ document: 'ملف تجاري باتفاق مسجّل فُتح منه هذا المشروع', why: 'الشهادة تشهد بإنجاز بنود اتفاق، وبلا اتفاق ما فيه بنود تشهد عليها', owner: 'مسؤول الحساب ومديره المباشر', owner_role: 'manager' }],
    next: 'افتح المشروع من ملف العميل بعد تسجيل الاتفاق، ثم أصدر الشهادة' });
  const live = liveRow(db, project.id);
  if (live) refuse(409, 'certificate_exists', { what: `لهذا المشروع شهادة سارية ${live.number} (الإصدار ${live.revision})`, missing: [],
    next: 'لو فيها خطأ صحّحها بنسخة جديدة، أو اعكسها بسبب مكتوب ثم أصدر غيرها' });
  const deliveries = acceptedDeliveries(db, project, c), approver = representative(db, u, project, input.approver_id);
  const row = insertCertificate(db, u, { project, c, deliveries, approver, input, revision: 1, supersedes: null, reason: '' });
  audit(db, u, 'completion_certificate', row.id, 'axes.certificate_issued', {}, { number: row.number, revision: 1, project_id: project.id, deliveries: deliveries.length, approver_id: approver.id });
  return view(db, u, row);
}

/* ───── قبول العميل: دليل خارجي أدخله موظف، بقناته وحدّها ───── */
// الاسم «acknowledge» والمسار /acknowledge باقيان كما بناهما الترحيل 116 لمن يناديهما. المعنى صار أدق: قبول العميل
// للشهادة كما وصلنا خارج المنصة، لا مجرد «استلامه» لها — والإقفال الفني يسأل عن القبول.
export function acknowledgeCompletionCertificate(db, supplied, certificateId, input) {
  writing(db);
  const u = actorOrRefuse(db, supplied);
  v.object(input, ['version', 'channel', 'received_on', 'evidence']);
  const row = certificateRow(db, u, certificateId);
  v.version(input.version, row.version);
  if (!mayRecordAcceptance(db, u)) refuse(403, 'not_permitted', { what: 'تسجيل قبول العميل للشهادة يحتاج تصريح توثيق موافقات العملاء',
    missing: [{ document: 'تصريح «توثيق موافقات العملاء الخارجية»', why: 'القبول قرار من العميل وصلنا خارج المنصة، ويوثّقه المخوَّل بتوثيق قرارات العملاء', owner: 'مسؤول الصلاحيات', owner_role: 'admin' }],
    next: 'اطلب التصريح من مسؤول الصلاحيات، أو اطلب من زميل يحمله يسجّل القبول' });
  if (row.issued_by === u.id) refuse(403, 'self_approval', { what: 'أنت أصدرت هذي الشهادة، فما تسجّل قبول العميل لها',
    missing: [{ document: 'تسجيل القبول بيد موظف غير اللي أصدرها', why: 'الشهادة وقبولها بيد واحدة ما يشهدان على شيء', owner: 'عضو في المشروع يحمل تصريح توثيق موافقات العملاء', owner_role: 'pm' }],
    next: 'اطلب من زميل في المشروع يحمل التصريح يسجّل قبول العميل' });
  if (acceptorsOf(db, row).has(u.id)) refuse(403, 'delivery_acceptor', { what: 'أنت قبلت مخرجات هذي الشهادة داخليًا، فما تسجّل قبول العميل لها',
    missing: [{ document: 'تسجيل القبول بيد موظف غير اللي قبل المخرجات', why: 'القبول الداخلي وقبول العميل للشهادة بيد واحدة يخلّون كلمة شخص واحد تشهد مرتين', owner: 'عضو في المشروع يحمل تصريح توثيق موافقات العملاء', owner_role: 'pm' }],
    next: 'اطلب من زميل في المشروع غيرك يسجّل قبول العميل' });
  const state = stateOf(db, row);
  if (state !== 'issued') refuse(409, 'certificate_not_open', { what: `الشهادة ${row.number} ${STATE_NAMES[state]}، فما يُسجَّل عليها قبول`, missing: [],
    next: state === 'accepted' ? 'القبول يُسجَّل مرة وحدة؛ لو فيه خطأ صحّح الشهادة بنسخة جديدة وسجّل قبولها' : 'سجّل القبول على النسخة السارية من الشهادة' });
  if (!row.approver_id) refuse(409, 'approver_required', { what: `الشهادة ${row.number} صدرت قبل سجل المفوّضين وما تسمّي ممثل عميل بسند تفويضه`,
    missing: [{ document: 'نسخة مصحّحة تسمّي ممثل العميل من سجل المفوّضين', why: 'القبول يُنسب لممثل معروف تفويضه، لا لاسم يُكتب', owner: 'مدير المشروع', owner_role: 'pm' }],
    next: 'صحّح الشهادة بنسخة جديدة تسمّي ممثل العميل، ثم سجّل قبوله عليها' });
  const channel = acceptanceChannels().find(item => item.key === input.channel);
  if (!channel) refuse(400, 'channel', { what: 'اختر كيف وصلنا قبول العميل من القنوات المعتمدة', missing: [],
    next: `القنوات: ${acceptanceChannels().map(item => item.name).join('، ')}. التوقيع الإلكتروني مو منها لأن المنصة ما عندها آلية توقيع معتمدة` });
  const received = v.date(input.received_on), issuedOn = riyadhDay(row.issued_at);
  if (received > today()) refuse(400, 'received_on', { what: 'تاريخ وصول القبول ما يكون في المستقبل', missing: [], next: 'اكتب اليوم اللي وصلنا فيه قبول العميل فعلًا' });
  if (received < issuedOn) refuse(400, 'received_on', { what: `تاريخ وصول القبول يسبق إصدار الشهادة (${issuedOn})`, missing: [],
    next: 'العميل يقبل شهادة صدرت؛ لو القبول سبقها فهو قبول للمخرجات، ومكانه قرار قبول المخرج في ملف العميل' });
  const approver = db.prepare('SELECT * FROM client_approvers WHERE id=?').get(row.approver_id);
  if (!activeOn(approver, received)) refuse(409, 'approver_not_authorized', { what: `تفويض «${approver.name}» ما كان ساري يوم ${received}`,
    missing: [{ document: 'نسخة مصحّحة تسمّي ممثلًا كان مفوّضًا يوم القبول', why: 'من سُحب تفويضه ما يُنسب له قبول بعد سحبه', owner: 'مدير المشروع', owner_role: 'pm' }],
    next: 'صحّح الشهادة بنسخة تسمّي الممثل المفوّض فعلًا، ثم سجّل قبوله' });
  const evidence = v.text(input.evidence, channel.key === 'call' ? 'مرجع التأكيد المكتوب اللي لحق الاتصال' : 'مرجع دليل القبول الخارجي', 2000, 10);
  db.prepare('INSERT INTO completion_certificate_acceptances(id,tenant_id,certificate_id,channel,received_on,evidence_reference,limitation,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(), u.tenant_id, row.id, channel.key, received, evidence, channel.limitation, u.id, now());
  audit(db, u, 'completion_certificate', row.id, 'axes.certificate_accepted', { state }, { state: 'accepted', number: row.number, revision: row.revision,
    channel: channel.key, received_on: received, source: 'employee_entered_external_evidence', electronic_signature: false }, evidence);
  return view(db, u, row);
}

/* ───── التصحيح بنسخة جديدة، والعكس بسبب ───── */
export function correctCompletionCertificate(db, supplied, certificateId, input) {
  writing(db);
  const u = actorOrRefuse(db, supplied);
  v.object(input, ['version', 'reason', 'scope_summary', 'approver_id', 'evidence']);
  const row = certificateRow(db, u, certificateId);
  v.version(input.version, row.version);
  const project = memberProject(db, u, row.project_id);
  projectManager(db, u, project);
  requireChangeable(db, row, 'التصحيح');
  const reason = v.text(input.reason, 'سبب التصحيح: وش كان غلط في النسخة السابقة', 3000, 20);
  const c = db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(row.case_id);
  const deliveries = acceptedDeliveries(db, project, c), approver = representative(db, u, project, input.approver_id);
  const next = insertCertificate(db, u, { project, c, deliveries, approver, input, revision: row.revision + 1, supersedes: row, reason });
  audit(db, u, 'completion_certificate', next.id, 'axes.certificate_corrected', { number: row.number, revision: row.revision },
    { number: next.number, revision: next.revision, supersedes: row.number, approver_id: approver.id }, reason);
  return view(db, u, next);
}
export function reverseCompletionCertificate(db, supplied, certificateId, input) {
  writing(db);
  const u = actorOrRefuse(db, supplied);
  v.object(input, ['version', 'reason']);
  const row = certificateRow(db, u, certificateId);
  v.version(input.version, row.version);
  const project = memberProject(db, u, row.project_id);
  projectManager(db, u, project);
  const state = requireChangeable(db, row, 'العكس');
  const reason = v.text(input.reason, 'سبب عكس الشهادة', 3000, 20);
  db.prepare('INSERT INTO completion_certificate_reversals(id,tenant_id,certificate_id,reason,reversed_by,reversed_at) VALUES(?,?,?,?,?,?)').run(id(), u.tenant_id, row.id, reason, u.id, now());
  audit(db, u, 'completion_certificate', row.id, 'axes.certificate_reversed', { state }, { state: 'reversed', number: row.number, revision: row.revision }, reason);
  return view(db, u, row);
}

/* ───── لوحة الشاشة التجارية ───── */
// ما يلزم ملف العميل ليرسم شهادة مشروعه: مفتاحه الملف التجاري، لأن الشاشة ترسم ملفًا لا مشروعًا. لا ترفض أحدًا:
// من ليس عضوًا في مشروع تجاري تعود لوحته فارغة، فلا تنكسر شاشة «العملاء والعروض» لشخصية لا تعمل على مشاريع.
function issueReadiness(db, u, project) {
  // ما جاء وقتها بعد: الشاشة ما تلحّ بشهادة قبل قبول كل البنود، ولا تعرض الإصدار إلا لمن يملكه.
  if (!managesProject(db, u, project) || acceptanceAxis(db, project).state !== 'accepted' || liveRow(db, project.id)) return null;
  return activeApprovers(db, project.id).length ? { allowed: true, blocker: null }
    : { allowed: false, blocker: 'كل البنود مقبولة، والشهادة تحتاج ممثل عميل مسجّل بسند تفويضه. سجّله من «موافقات العملاء» ثم أصدرها.' };
}
export function certificatesBoard(db, supplied) {
  const u = actorOrRefuse(db, supplied), cases = {};
  const projects = db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC,p.id').all(u.tenant_id, u.id);
  for (const project of projects) {
    const c = caseOf(db, project);
    if (!c) continue;
    // المفوّضون الساريون لمن يصدر ويصحّح وحده: هما الإجراءان اللذان يختاران ممثل العميل.
    cases[c.id] = { project_id: project.id, approvers: managesProject(db, u, project) ? activeApprovers(db, project.id) : [], issue: issueReadiness(db, u, project),
      certificates: db.prepare('SELECT * FROM completion_certificates WHERE project_id=? ORDER BY sequence DESC').all(project.id).map(row => view(db, u, row)) };
  }
  return { today: today(), channels: acceptanceChannels(), signature_statement: SIGNATURE_STATEMENT, state_names: STATE_NAMES, cases };
}

/* ───── المستند: السجل نفسه بشكل وثيقة ───── */
// المالك يريد العمل إلكترونيًا بلا ورق ولا صورة توقيع، ويريد المستند نفسه حين يحتاج أن يسلّمه: يُولَّد من القيم المخزّنة عند
// الطلب، ويحمل هويات من أصدر وسجّل القبول كما سُجّلت لا خانات توقيع تنتظر قلمًا. والشكل شكل مستندات المنصة (body.doc في
// app/static/report-print.css) كالفاتورة والخطاب: لا نموذج شركة للشهادة في المستودع (المصدر FRM-030 يقول إن العميل مصدرها)،
// فإن سلّم المالك نموذجه طابقه هذا الموضع وحده.
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function standing(d) {
  if (d.state === 'reversed') return `عُكست هذي الشهادة${d.reversal?.reversed_at ? ` بتاريخ ${esc(dual(riyadhDay(d.reversal.reversed_at)))}` : ''}، والسبب: ${esc(d.reversal?.reason)}. النسخة هذي للأرشيف وما عادت سارية.`;
  if (d.state === 'superseded') return `استُبدلت هذي النسخة بالشهادة <bdi dir="ltr">${esc(d.superseded_by?.number)}</bdi> (الإصدار ${esc(d.superseded_by?.revision)}). النسخة هذي للأرشيف وما عادت سارية.`;
  if (d.state === 'accepted') return `قبلها العميل. القبول دليل خارجي أدخله موظف، ومو توقيع إلكتروني.`;
  return 'صادرة وتنتظر قبول العميل: ما سُجّل قبوله عليها بعد.';
}
// كل تاريخ في المستند يوم الرياض: الطوابع مخزّنة بتوقيت UTC، وشريحةٌ من نصها تقول «أمس» عن فعلٍ وقع بعد منتصف الليل.
export function certificateDocument(d, demoData = SYNTHETIC) {
  const r = d.client_representative, a = d.acceptance;
  const rows = d.deliverables.map(x => `<tr><td>${esc((x.line_index ?? 0) + 1)}. ${esc(x.description)}</td><td>${esc(x.acceptance_criterion)}</td><td>${esc(x.completion_report)}</td><td>${esc(x.acceptance_minutes)}</td><td>${esc(x.accepted_by_name)}${x.accepted_at ? `<br><bdi dir="ltr">${esc(riyadhDay(x.accepted_at))}</bdi>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>شهادة إنجاز ${esc(d.number)}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc">
    <header><p class="brand">3,6T</p><h1>شهادة إنجاز <bdi dir="ltr">${esc(d.number)}</bdi></h1><p class="meta">الإصدار ${esc(d.revision)} · تاريخ الإصدار ${esc(dual(d.issued_on))}${d.supersedes ? ` · تحل محل <bdi dir="ltr">${esc(d.supersedes.number)}</bdi>` : ''}</p></header>
    <p class="notice">${standing(d)}</p>
    <div class="parties"><section class="party"><h2>العميل والمشروع</h2><p><strong>${esc(d.client.name)}</strong></p><p>السجل: <bdi dir="ltr">${esc(d.client.registration_number)}</bdi></p><p>المشروع: ${esc(d.project.name)}</p></section>
    <section class="party"><h2>ممثل العميل</h2><p><strong>${esc(r.name)}</strong>${r.title ? ` — ${esc(r.title)}` : ''}</p><p>سند التفويض: ${r.authority_basis ? esc(r.authority_basis) : 'ما سُجّل له سند (صدرت قبل سجل المفوّضين)'}</p>${r.authority_scope ? `<p>نطاق التفويض: ${esc(r.authority_scope)}</p>` : ''}</section></div>
    <h2>وش أُنجز</h2><p>${esc(d.scope_summary)}</p>${d.correction_reason ? `<p class="meta">سبب التصحيح: ${esc(d.correction_reason)}</p>` : ''}
    <h2>المخرجات المقبولة</h2><table><thead><tr><th>البند</th><th>معيار القبول</th><th>تقرير الإنجاز</th><th>محضر القبول</th><th>قبله</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>قبول العميل للشهادة</h2>${a ? `<p>وصل عبر: <strong>${esc(a.channel_name)}</strong>${a.received_on ? ` بتاريخ ${esc(dual(a.received_on))}` : ''} · المرجع: <bdi>${esc(a.evidence_reference)}</bdi></p><p>وثّقه: ${esc(a.recorded_by_name)}${a.recorded_at ? ` يوم ${esc(dual(riyadhDay(a.recorded_at)))}` : ''}</p><p class="meta">حدّ هذا الدليل: ${esc(a.limitation)}</p>` : '<p>ما سُجّل قبول العميل على هذي النسخة بعد.</p>'}
    <h2>التوثيق</h2><p>${esc(d.signature_statement)}</p><p class="meta">أصدرها وسجّلها: ${esc(d.issued_by_name)} · مرجع تقرير إنجاز المشروع: ${esc(d.evidence)}</p>
    <footer>${esc(documentFooter(demoData,{ feminine: true }))}</footer></body></html>`;
}
