import { refuse } from './refusal.mjs';

// حارس الإقفال المالي (ترحيل 163). وحدة صغيرة بلا تبعيات ثقيلة عمدًا: تستوردها المستحقات والمشتريات
// والمصروفات لتقول «المشروع مقفل ماليًا» قبل أن يرفض قيد قاعدة البيانات بنص خام، ولو استوردت
// app/project-axes.mjs لجرّت معها وحدة الربحية والوكالة وسلسلة الاستلام ودارت الاستيرادات على نفسها.
//
// «ساري» تعريف واحد في موضع واحد: سجل إقفال لم تنهه إعادة فتح. تستعمله الشيفرة هنا وفي محاور المشروع،
// وتستعمله قيود الترحيل 163 بالنص نفسه، فلا تفترق الشاشة عن القاعدة في معنى «مقفل».
export const IN_FORCE = 'NOT EXISTS(SELECT 1 FROM project_closure_record_ends e WHERE e.record_id=r.id)';

export function closureInForce(db, projectId, lock) {
  if (typeof projectId !== 'string' || !projectId) return null;
  return db.prepare(`SELECT r.* FROM project_closure_records r WHERE r.project_id=? AND r.lock=? AND ${IN_FORCE} ORDER BY r.closed_at DESC LIMIT 1`).get(projectId, lock) ?? null;
}

// يُستدعى قبل كتابة أي مستند مالي جديد على مشروع: استحقاق عميل، أو طلب شراء، أو مطالبة مصروف.
// ما يسوّي بندًا قائمًا (قبض، أمر دفع، قيد، فاتورة على استحقاق قائم) لا يمر من هنا: هو حسمٌ لما قرّره
// الإقفال لا التزامٌ جديد بعده.
export function assertFinanciallyOpen(db, projectId, what) {
  const record = closureInForce(db, projectId, 'financial');
  if (!record) return;
  refuse(409, 'project_financially_closed', {
    what,
    missing: [{ document: 'إعادة فتح الإقفال المالي للمشروع بسبب مكتوب',
      why: `المشروع مقفل ماليًا من ${record.closed_at.slice(0, 10)}، وأي مستند مالي جديد عليه يغيّر اللي انقفل عليه`,
      owner: 'حامل تصريح «إعادة فتح إقفال المشروع»', owner_role: 'manager' }],
    next: 'اطلب إعادة فتح الإقفال المالي بسبب مكتوب، وبعدها سجّل المستند؛ أو سجّله بدون ربطه بهالمشروع إذا ما يخصه'
  });
}
