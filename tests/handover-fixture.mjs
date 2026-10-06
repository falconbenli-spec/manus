// تسليم مشروعٍ مصطنع بمحضر «سُلِّم»، ليصير المستلم مدير المشروع المسجَّل (app/project-authority.mjs: محضر الاستلام، ثم محضر
// التسليم، ثم منشئ المشروع). يُكتب مسودةً ثم يُسلَّم على نمط tests/project-participation.test.mjs، فلا يولد محضرٌ مسلَّم
// بلا مسودة. بيانات مصطنعة كلها؛ العميل والعقد أسماء اختبار لا تشير إلى أحد.
export function handOverProject(db, projectId, managerId, { preparedBy = 'manager', tenantId = '36t' } = {}) {
  const stamp = new Date().toISOString(), clientId = `client-${projectId}`, handoverId = `handover-${projectId}`;
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES(?,?,?,'عميل تسليم مصطنع','','اختبار','active',?,'',?,?)")
    .run(clientId, tenantId, `C-${projectId.slice(0, 8)}`, preparedBy, stamp, stamp);
  db.prepare(`INSERT INTO project_handovers(id,tenant_id,project_id,client_id,contract_reference,contract_signed_on,kickoff_planned_on,channels,contract_value_minor,advance_minor,advance_claimed_on,project_manager_id,services,timeline_start,timeline_end,milestones,client_contacts,risks,special_requirements,status,prepared_by,created_at,updated_at)
    VALUES(?,?,?,?,'عقد مصطنع للتسليم','2026-09-01',NULL,'البريد والاجتماعات',120000,0,NULL,?,'["خدمة"]','2026-09-01','2099-12-31','[{"name":"تسليم","due_on":"2099-12-31"}]','[{"name":"ممثل","title":"مدير","email":"","phone":"","is_primary":true}]','','','draft',?,?,?)`)
    .run(handoverId, tenantId, projectId, clientId, managerId, preparedBy, stamp, stamp);
  db.prepare("UPDATE project_handovers SET status='handed_over',version=version+1 WHERE id=?").run(handoverId);
  return handoverId;
}
