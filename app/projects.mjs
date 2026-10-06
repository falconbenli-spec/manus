import { randomUUID } from 'node:crypto';
import { audit,now } from './db.mjs';
import { fail } from './auth.mjs';
import { projectAccess } from './workflow.mjs';
import { intakeSummary, assertExecutionAllowed } from './project-intake.mjs';
import * as v from './validation.mjs';
import { projectManagerOfRecord, requireProjectManager } from './project-authority.mjs';

export function listProjects(db,u) {
  return db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id,u.id).map(p=>{
    const manager=projectManagerOfRecord(db,p);
    return {...p,manager,can_manage:manager.available&&manager.id===u.id,
      tasks:db.prepare('SELECT t.*,u.name AS assignee_name FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE project_id=? ORDER BY due_date').all(p.id),
      // حالة سلسلة الاستلام (PM-01): المشروع الذي لم يكتمل استلامه تظهر مهامه محجوبة بسببها لا بلا سبب.
      intake:intakeSummary(db,u.tenant_id,p.id),
      members:db.prepare('SELECT u.id,u.name FROM users u JOIN project_members m ON u.id=m.user_id WHERE m.project_id=? AND u.active=1').all(p.id)};
  });
}
export function createProject(db,u,input) {
  if(!['manager','pm'].includes(u.role)) fail(403,'forbidden','إنشاء المشروع متاح لمدير المشروع أو الفريق');
  v.object(input,['name','brief','member_ids']);
  if(!Array.isArray(input.member_ids)||input.member_ids.length>30) fail(400,'members','أعضاء المشروع غير صالحين');
  const ids=[...new Set([u.id,...input.member_ids])];
  for(const mid of ids) if(typeof mid!=='string'||!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin' AND (id=? OR manager_id=?)").get(mid,u.tenant_id,u.id,u.id)) fail(403,'member_scope','يمكنك إضافة أعضاء فريقك المباشر فقط');
  const pid=randomUUID();
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(pid,u.tenant_id,v.text(input.name,'اسم المشروع',180),v.text(input.brief,'الموجز',3000),u.id,now());
  for(const mid of ids) db.prepare('INSERT INTO project_members VALUES(?,?)').run(pid,mid);
  audit(db,u,'project',pid,'created',{}, {members:ids});
  return listProjects(db,u).find(p=>p.id===pid);
}
export function createTask(db,u,pid,input) {
  const p=projectAccess(db,u,pid);
  requireProjectManager(db,u,p);
  // بوابة PM-01: مهمة على مشروع مستلَم هي تنفيذ مدفوع. المشروع بلا سجل استلام لا تمسّه البوابة (ما قبل البيع والدراسة).
  assertExecutionAllowed(db,u.tenant_id,p.id,'إسناد مهمة على مشروع مستلَم');
  v.object(input,['title','assignee_id','due_date','acceptance']);
  if(typeof input.assignee_id!=='string'||!db.prepare('SELECT 1 FROM project_members m JOIN users u ON u.id=m.user_id WHERE project_id=? AND user_id=? AND u.active=1').get(pid,input.assignee_id)) fail(400,'assignee','المكلف يجب أن يكون عضوًا نشطًا في المشروع');
  const tid=randomUUID();
  db.prepare('INSERT INTO tasks(id,project_id,title,assignee_id,due_date,acceptance,created_at) VALUES(?,?,?,?,?,?,?)').run(tid,pid,v.text(input.title,'عنوان المهمة',180),input.assignee_id,v.date(input.due_date),v.text(input.acceptance,'معيار القبول',2000),now());
  audit(db,u,'project',pid,'task.created',{}, {task_id:tid,assignee_id:input.assignee_id});
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(tid);
}
export function completeTask(db,u,tid,input) {
  v.object(input,['version','evidence']);
  const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(tid);
  if(!t) fail(404,'not_found','المهمة غير متاحة');
  projectAccess(db,u,t.project_id);v.version(input.version,t.version);
  if(t.assignee_id!==u.id||t.status!=='open') fail(403,'forbidden','إكمال المهمة متاح للمكلف مرة واحدة');
  const evidence=v.text(input.evidence,'دليل الإنجاز',3000,3);
  db.prepare("UPDATE tasks SET status='completed',evidence=?,version=version+1 WHERE id=?").run(evidence,tid);
  audit(db,u,'project',t.project_id,'task.completed',{task_id:tid,status:t.status},{status:'completed',evidence});
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(tid);
}
