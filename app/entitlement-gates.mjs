// بوابات الاستحقاق (الحزمة 4، P4-CRM-4، الترحيل 183).
//
// القاعدة في جملة: الفاتورة لا تتجاوز ما أكّده العميل، ولا تسبق ما اتفق عليه.
//   - جدول دفعات الصفقة شروطٌ مكتوبة بأنواعها: «مقدمة» تحل بتوثيق الاتفاق، أو «قبول» تحل بقبول بنود بعينها من الاتفاق. مجموعها
//     قيمة الاتفاق، والبند الواحد من الاتفاق شرطٌ لبند دفع واحد على الأكثر.
//   - الاستحقاق يُنشأ على بند من الجدول وحده: استحقاق المخرج على البند الذي يشترط قبول بنده، بعد قبول كل بنود شرطه، واستحقاق
//     المقدمة على بند المقدمة. والمجموع الحي على البند لا يتجاوزه، ومجموع الصفقة لا يتجاوز جدولها.
//   - آخر نسخة مؤكدة من أمر شراء العميل سقفٌ لمجموع استحقاقات الصفقة، ورقمها يصل الاستحقاق والفاتورة. والجدول الذي يشترط أمرًا
//     لا يُستحق عليه إلا تحت نسخة مؤكدة سارية — ولو أُعفي البدء منه: الإعفاء يفتح العمل، ولا يفتح الفوترة (القرار ز10).
//   - الجدول القديم بلا أنواع (قبل 183) يبقى على مساره: الاستحقاق حتى قيمة بند المخرج، وتحت أمر الشراء المؤكد إن وُجد.
// والمُطلِقات في الترحيل 183 هي الطبقة الأخيرة لكل قاعدة هنا؛ هذه الوحدة تقول قبلها ما الناقص ومن يملكه.
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { riyadhToday } from './riyadh-time.mjs';

export const CONDITION_KINDS = Object.freeze({ acceptance: 'عند قبول بنود من الاتفاق', advance: 'دفعة مقدمة عند توقيع الاتفاق' });
const LIVE = "status NOT IN ('rejected','cancelled')";
const decimal = minor => `${Math.trunc(Number(minor) / 100)}.${String(Math.abs(Number(minor) % 100)).padStart(2, '0')}`;
const parse = text => { try { return JSON.parse(text); } catch { return []; } };

/* ───── القراءة ───── */
export const scheduleOf = (db, caseId) => db.prepare('SELECT * FROM case_payment_terms WHERE case_id=? ORDER BY position').all(caseId)
  .map(t => ({ ...t, lines: t.condition_kind ? parse(t.condition_lines) : [] }));
// الجدول «بشروط» حين كُتب كل بند فيه بنوعه؛ بند واحد بلا نوع يعني جدولًا قبل 183.
export const typedSchedule = terms => terms.length > 0 && terms.every(t => t.condition_kind);
export const linesLabel = lines => lines.map(i => `البند ${i + 1}`).join(' و');
// الشرط كما يُقرأ على الشاشة: «مقدمة عند الاتفاق» أو «عند قبول البند 1 والبند 2».
export const conditionText = term => term.condition_kind === 'advance' ? 'مقدمة عند الاتفاق' : term.condition_kind === 'acceptance' ? `عند قبول ${linesLabel(term.lines)}` : '';
export const termView = term => ({ id: term.id, position: term.position, label: term.label, kind: term.condition_kind, lines: term.lines, amount_minor: term.amount_minor,
  condition: conditionText(term) });
const claimedOnTerm = (db, termId) => db.prepare(`SELECT COALESCE(SUM(CAST(c.amount_minor AS INTEGER)),0) AS n FROM ar_claim_terms x JOIN ar_claims c ON c.id=x.claim_id WHERE x.term_id=? AND c.${LIVE}`).get(termId).n;
const claimedOnCase = (db, caseId) => db.prepare(`SELECT COALESCE(SUM(CAST(amount_minor AS INTEGER)),0) AS n FROM ar_claims WHERE case_id=? AND ${LIVE}`).get(caseId).n;
export const termRoom = (db, term) => term.amount_minor - claimedOnTerm(db, term.id);
const accepted = (db, caseId, line) => !!db.prepare("SELECT 1 FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE d.case_id=? AND d.line_index=?").get(caseId, line);
const latestPurchaseOrder = (db, caseId) => db.prepare('SELECT * FROM client_purchase_orders WHERE case_id=? ORDER BY revision DESC LIMIT 1').get(caseId) ?? null;
const agreementLines = (db, caseId) => {
  const row = db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(caseId);
  return row ? (parse(row.snapshot).lines ?? []) : [];
};
// البند الذي يحل باستحقاق مخرج بنده، في جدول بشروط.
export const termForLine = (terms, line) => terms.find(t => t.condition_kind === 'acceptance' && t.lines.includes(line)) ?? null;

// لماذا لا يغطي أمر الشراء: الرسالة نفسها التي تقولها جاهزية البدء عن النسخة الأخيرة (app/project-axes.mjs).
function purchaseOrderWhy(po, day) {
  if (!po) return 'ما انسجّل أمر شراء من العميل على هذا الاتفاق.';
  if (po.status === 'void') return `النسخة ${po.revision} من أمر الشراء ملغاة.`;
  if (po.status !== 'confirmed') return `النسخة ${po.revision} من أمر الشراء مسجّلة وما أكّدها أحد غير اللي سجّلها، وهي آخر نسخة فهي اللي تغطي.`;
  return `النسخة ${po.revision} من أمر الشراء انتهت صلاحيتها في ${po.valid_until} قبل اليوم ${day}.`;
}

/* ───── البوابة ───── */
// تُسأل قبل كتابة أي استحقاق، في المعاملة نفسها. تعيد البند وأمر الشراء اللذين نشأ تحتهما، أو legacy للجدول القديم.
//   basis: 'delivery' بخط المخرج (line)، أو 'advance'. amount بالهللة رقمًا.
export function entitlementGate(db, c, { basis, line = null, amount }) {
  const terms = scheduleOf(db, c.id), dealOwner = personName(db, c.owner_id) ?? 'صاحب الصفقة', day = riyadhToday();
  const owner = { owner: dealOwner, owner_role: 'account_manager' };
  if (!terms.length) refuse(409, 'payment_terms_required', { what: `صفقة «${c.name}» ما عليها جدول دفعات، فما ينكتب عليها استحقاق`,
    missing: [{ document: 'جدول الدفعات بشروطه على الصفقة', why: 'كل استحقاق ينكتب على بند من جدول الاتفاق: شرطه يقول متى يحل، ومبلغه يقول كم', ...owner, doc_key: 'payment_schedule' }],
    next: 'سجّل جدول الدفعات بشروطه من «العملاء والعروض»، ثم ارجع أنشئ الاستحقاق' });
  const po = latestPurchaseOrder(db, c.id), covering = po?.status === 'confirmed' ? po : null, all = claimedOnCase(db, c.id);
  // أمر الشراء المؤكد سقفٌ لكل جدول، قديمًا كان أو بشروط.
  const ceiling = () => {
    if (covering && all + amount > covering.amount_minor) refuse(409, 'client_po_exceeded', {
      what: `مجموع الاستحقاقات على الصفقة يصير ${decimal(all + amount)}، وأمر شراء العميل ${covering.po_number} المؤكد ${decimal(covering.amount_minor)}`,
      missing: [{ document: `نسخة من أمر الشراء ${covering.po_number} بقيمة تغطي الاستحقاق`, why: 'الفاتورة ما تتجاوز ما أكّده العميل في أمر شرائه، وإلا يردّها', ...owner, doc_key: 'client_purchase_order' }],
      next: `أنشئ الاستحقاق بالباقي تحت أمر الشراء (${decimal(Math.max(0, covering.amount_minor - all))})، أو اطلب من العميل نسخة أمر شراء بالقيمة الجديدة وسجّلها` });
  };
  if (!typedSchedule(terms)) { ceiling(); return { legacy: true, term: null, po: covering }; }
  const term = basis === 'advance' ? terms.find(t => t.condition_kind === 'advance') ?? null : termForLine(terms, line);
  const lines = agreementLines(db, c.id), lineName = i => lines[i]?.description ? `البند ${i + 1} «${lines[i].description}»` : `البند ${i + 1}`;
  if (!term && basis === 'advance') refuse(409, 'no_advance_term', { what: `جدول دفعات «${c.name}» ما فيه دفعة مقدمة`,
    missing: [{ document: 'بند دفعة مقدمة في جدول الاتفاق', why: 'استحقاق المقدمة ينكتب على بندها في الجدول، والجدول ما اتفق على مقدمة', ...owner, doc_key: 'payment_schedule' }],
    next: 'إذا اتفقتم على مقدمة فهي تعديل على الاتفاق بطلب تغيير؛ وإلا فالاستحقاق يجي من قبول المخرجات' });
  if (!term) refuse(409, 'line_not_in_schedule', { what: `${lineName(line)} ما هو شرط لأي دفعة في جدول «${c.name}»`,
    missing: [{ document: 'بند دفع يشترط قبول هذا البند', why: `دفعات الجدول: ${terms.map(t => `«${t.label}» ${conditionText(t)}`).join('، ')}`, ...owner, doc_key: 'payment_schedule' }],
    next: 'أنشئ الاستحقاق على المخرج اللي يكمّل شرط دفعته، أو على المقدمة إن كان مالها في الجدول' });
  if (term.condition_kind === 'acceptance') {
    const open = term.lines.filter(i => !accepted(db, c.id, i));
    if (open.length) refuse(409, 'condition_not_met', { what: `شرط دفعة «${term.label}» ما تحقق: ينتظر قبول ${linesLabel(open)}`,
      missing: open.map(i => ({ document: `قبول ${lineName(i)}`, why: `الدفعة تحل بقبول ${linesLabel(term.lines)} كلها`, owner: `${dealOwner} يقدّمه، ومديره المباشر يعتمد قبوله`, owner_role: 'account_manager', doc_key: 'delivery_acceptance' })),
      next: 'سلّم البند واعتمد قبوله بممثل العميل المفوّض، ثم أنشئ الاستحقاق' });
  }
  const room = termRoom(db, term);
  if (amount > room) refuse(409, 'term_exceeded', { what: `المبلغ ${decimal(amount)} أكبر من الباقي على دفعة «${term.label}»: ${decimal(Math.max(0, room))} من ${decimal(term.amount_minor)}`,
    missing: [{ document: `باقٍ على دفعة «${term.label}» يغطي المبلغ`, why: 'الاستحقاقات على الدفعة الواحدة ما تتجاوز مبلغها في الجدول؛ الملغى وحده يرجّع مكانه', ...owner, doc_key: 'payment_schedule' }],
    next: room > 0 ? `أنشئ الاستحقاق بالباقي (${decimal(room)})` : 'الدفعة استُحقت كاملة؛ أي زيادة تعديل على الاتفاق بطلب تغيير' });
  const total = terms.reduce((n, t) => n + t.amount_minor, 0);
  if (all + amount > total) refuse(409, 'schedule_exceeded', { what: `مجموع الاستحقاقات على الصفقة يصير ${decimal(all + amount)}، وجدولها ${decimal(total)}`,
    missing: [{ document: 'باقٍ في جدول الاتفاق', why: 'استحقاقات سابقة على الصفقة حجزت من الجدول قبل ما تنكتب الشروط', ...owner, doc_key: 'payment_schedule' }],
    next: 'راجع الاستحقاقات القائمة على الصفقة: الملغى وحده يرجّع مكانه' });
  if (terms.some(t => t.requires_client_po === 1) && !(covering && (!covering.valid_until || covering.valid_until >= day))) refuse(409, 'client_po_required', {
    what: `جدول دفعات «${c.name}» يشترط أمر شراء من العميل، وما فيه نسخة مؤكدة سارية يُستحق تحتها`,
    missing: [{ document: 'أمر شراء العميل', why: purchaseOrderWhy(po, day), ...owner, doc_key: 'client_purchase_order' }],
    next: 'سجّل أمر الشراء وخلّ غيرك يقابله بالأصل ويؤكده، ثم أنشئ الاستحقاق. إعفاء البدء ما يكفي: يفتح العمل لا الفوترة' });
  ceiling();
  return { legacy: false, term, po: covering };
}

// ما يدخل لقطة الاستحقاق من البوابة: البند وشرطه، ونسخة أمر الشراء ورقمها.
export const gateSnapshot = gate => ({ ...(gate.term ? { term: termView(gate.term) } : {}), ...(gate.po ? { client_po: { number: gate.po.po_number, revision: gate.po.revision } } : {}) });
// الربط يُكتب قبل الاستحقاق نفسه (المفتاح الأجنبي مؤجّل إلى نهاية المعاملة)، فيقرؤه حارس الكتابة في الترحيل 183.
export function writeTermLink(db, { claimId, tenantId, caseId, gate, time }) {
  if (!gate.term) return;
  db.prepare('INSERT INTO ar_claim_terms(claim_id,tenant_id,case_id,term_id,client_po_id,client_po_number,client_po_revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(claimId, tenantId, caseId, gate.term.id, gate.po?.id ?? null, gate.po?.po_number ?? null, gate.po?.revision ?? null, time);
}

/* ───── لقوائم الشاشة ───── */
// اسم دفعة المخرج في قائمة «إنشاء استحقاق»: البند الذي يحل به، إن كان الجدول بشروط.
export function termLabelForLine(db, caseId, line) {
  const terms = scheduleOf(db, caseId);
  return typedSchedule(terms) ? termForLine(terms, line)?.label ?? null : null;
}
// الصفقات التي يُنشأ عليها استحقاق مقدمة الآن: اتفاق ومشروع، وبند مقدمة في جدول بشروط وباقٍ عليه.
export function advanceSources(db, tenantId) {
  return db.prepare(`SELECT k.id,k.name,t.id AS term_id,t.label,t.amount_minor,t.currency FROM commercial_cases k JOIN commercial_contracts x ON x.case_id=k.id
      JOIN case_payment_terms t ON t.case_id=k.id AND t.condition_kind='advance' WHERE k.tenant_id=? AND k.project_id IS NOT NULL ORDER BY k.name,k.id`).all(tenantId)
    .map(r => ({ case_id: r.id, name: r.name, term_id: r.term_id, term_label: r.label, currency: r.currency, room_minor: r.amount_minor - claimedOnTerm(db, r.term_id) }))
    .filter(r => r.room_minor > 0);
}
