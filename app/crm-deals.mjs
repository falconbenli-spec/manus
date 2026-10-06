// الصفقة وفرصتها (الحزمة 4، الترحيلان 180 و181): ما تشترك فيه app/commercial.mjs وapp/pipeline-estimates.mjs حين تُغلق
// إحداهما الأخرى. ملف ثالث صغير حتى لا تستورد إحدى الوحدتين الأخرى (السنة نفسها في app/pipeline-shared.mjs).
//
// القاعدة: الصفقة التي لم يُتعاقد عليها وفرصتها تُغلقان معًا وبالسبب نفسه. خسارة الصفقة أو سحبها يغلق فرصتها المفتوحة خاسرة،
// وخسارة الفرصة تغلق صفقتها التي لم يُتعاقد عليها. والمتعاقد عليها لا تُخسر: الفرصة تُغلق رابحة، وإنهاء العقد مسار آخر.
import { audit, now } from './db.mjs';
import { refuse } from './refusal.mjs';

export const PRE_CONTRACT = Object.freeze(['lead', 'qualification_pending', 'qualification_rejected', 'qualified', 'quote_draft', 'quote_pending', 'quote_rejected', 'quote_approved']);
export const CLOSED_DEAL = Object.freeze(['lost', 'withdrawn']);
export const CONTRACTED = Object.freeze(['contracted', 'project_active']);
export const DEAL_STATUS_NAMES = Object.freeze({ lost: 'خسرناها', withdrawn: 'سحبناها' });
// مرجع الصفقة المقروء: أول ثمانية من معرّفها، كما تُقرأ مراجع الحالات في الإشعارات (notices.caseRef).
export const dealRef = id => String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();

// سبب الخسارة من القائمة السارية التي يديرها مالك الإجراء في «خط الفرص». سبب معطَّل أو من كيان آخر لا يُقبل.
export function lossReason(db, tenantId, reasonId) {
  const reason = typeof reasonId === 'string' && db.prepare('SELECT * FROM pipeline_loss_reasons WHERE id=? AND tenant_id=? AND active=1').get(reasonId, tenantId);
  if (!reason) refuse(400, 'loss_reason_required', { what: 'ما تنقفل الصفقة بلا سبب من قائمة أسباب الخسارة السارية',
    missing: [{ document: 'سبب الخسارة من القائمة', why: 'السبب يدخل تقرير الفوز والخسارة، والقائمة يديرها مالك الإجراء', owner: 'مالك إجراء خط الفرص', owner_role: 'account_manager', doc_key: 'reason_id' }],
    next: 'اختر السبب من القائمة. وإذا ما لقيت سببك، اطلب من مالك الإجراء يضيفه في «خط الفرص»' });
  return reason;
}

// يغلق الصفقة خاسرةً أو مسحوبة. لا يفحص من ينفّذ: المنادي يفحص صلاحيته قبله.
export function closeDealRow(db, u, c, { status, reason, comment, via = null }) {
  if (!CLOSED_DEAL.includes(status)) throw new TypeError('closeDealRow: lost أو withdrawn');
  const time = now();
  const changed = db.prepare('UPDATE commercial_cases SET status=?,closed_reason_id=?,closed_comment=?,closed_at=?,closed_by=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(status, reason.id, comment, time, u.id, time, c.id, c.version).changes;
  if (changed !== 1) refuse(409, 'stale_version', { what: 'الصفقة تغيّرت قبل ما تنقفل', next: 'حدّث الصفحة وأعد المحاولة' });
  audit(db, u, 'commercial', c.id, status === 'lost' ? 'close_lost' : 'withdraw', { status: c.status, version: c.version },
    { status, version: c.version + 1, reason: reason.code, ...(via ? { via } : {}) }, comment);
}
