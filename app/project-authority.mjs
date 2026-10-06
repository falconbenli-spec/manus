import { personAssignment } from './people-read.mjs';
import { fail } from './auth.mjs';

// المرجع الأعلى أولوية هو محضر الاستلام، ثم محضر التسليم، ثم منشئ المشروع القديم.
// إذا وُجد مرجع أعلى لكنه غير صالح فلا نسقط بصمت إلى سجل أقدم.
export function projectManagerOfRecord(db, project) {
  const receipt = db.prepare('SELECT received_by FROM project_receipts WHERE project_id=?').get(project.id);
  const handover = receipt ? null : db.prepare("SELECT project_manager_id FROM project_handovers WHERE project_id=? AND status IN ('handed_over','received')").get(project.id);
  const selected = receipt
    ? { id: receipt.received_by, source: 'receipt' }
    : handover
      ? { id: handover.project_manager_id, source: 'handover' }
      : { id: project.created_by, source: 'created_by' };
  const user = personAssignment(db, project.tenant_id, selected.id);
  const member = user && db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, user.id);
  return { id: selected.id, name: user?.name ?? '', source: selected.source,
    available: !!(user?.active && ['manager', 'pm'].includes(user.role) && member) };
}

export function requireProjectManager(db, actor, project) {
  const manager = projectManagerOfRecord(db, project);
  if (!manager.available) fail(409, 'project_manager_unavailable', 'مدير المشروع المسجل غير متاح أو لم يعد عضوًا في المشروع. صحّح الإسناد قبل متابعة العمل');
  if (manager.id !== actor.id) fail(403, 'not_project_manager', `هذا الإجراء لمدير المشروع: ${manager.name}`);
  return manager;
}
