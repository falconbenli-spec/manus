import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject, createTask } from '../app/projects.mjs';
import { projectManagerOfRecord } from '../app/project-authority.mjs';
import { templatesBoard, createTemplate, applyTemplate } from '../app/agency.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import * as axes from '../app/project-axes.mjs';

const code=value=>error=>error.code===value;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-project-participation-only');t.after(()=>db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('pm-one','36t','creative','pm-one','مديرة مشروع مصطنعة','unused-test-hash','pm','manager'),
    ('ops-head','36t','ops','ops-head','مدير التشغيل المصطنع','unused-test-hash','manager',NULL),
    ('ops-head-2','36t','ops','ops-head-2','مدير تشغيل بديل','unused-test-hash','manager',NULL),
    ('ops-member','36t','ops','ops-member','منفذة تشغيل مصطنعة','unused-test-hash','employee','ops-head'),
    ('hr-head','36t','hr','hr-head','مديرة موارد بشرية مصطنعة','unused-test-hash','manager',NULL)`);
  const users=Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u=>[u.id,u]));
  const tx=run=>transaction(db,run);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع مشاركة الإدارات',brief:'مشروع مصطنع لاختبار قبول الإدارة المستقبلة',member_ids:['employee','pm-one']}));
  return {db,users,tx,project};
}

test('AXIS-05: asking for another department stays pending until its current head acts',t=>{
  const {db,users,tx,project}=fixture(t);
  assert.throws(()=>tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'تتولى إدارة التشغيل إنتاج المخرج المسجل',approver_id:'ops-head'})),code('invalid_fields'),'the requester never supplies the approver identity');
  const pending=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'تتولى إدارة التشغيل إنتاج المخرج المسجل'}));
  assert.equal(pending.status,'pending');
  assert.throws(()=>tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'طلب ثانٍ متزامن على الإدارة نفسها'})),code('participation_pending'),'the database-backed pending request is single per project and department');
  assert.throws(()=>db.prepare(`INSERT INTO project_department_requests(id,tenant_id,project_id,department_id,basis,requested_by,requested_at)
    VALUES('duplicate-pending','36t',?,'ops','طلب مكرر يتجاوز التطبيق مباشرة','manager',?)`).run(project.id,now()),/UNIQUE constraint failed/,'the unique pending index closes the concurrent insert race');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_departments WHERE project_id=?').get(project.id).n,0,'a request is not an accepted link');
  assert.throws(()=>tx(()=>axes.addProjectMember(db,users.manager,project.id,{user_id:'ops-member',basis:'تنفيذ مخرج التشغيل في المشروع'})),code('department_not_linked'));
  assert.throws(()=>tx(()=>axes.createWorkPackage(db,users.manager,project.id,{code:'OPS-1',title:'حزمة التشغيل',department_id:'ops',phase:'production',objective:'إنتاج المخرج التشغيلي وفق معيار قبوله',lead_id:'ops-head',planned_start:'2099-01-01',planned_end:'2099-02-01'})),code('department_not_linked'));

  const receiving=axes.participationBoard(db,users['ops-head']);
  assert.deepEqual(receiving.incoming.map(r=>r.id),[pending.id]);
  assert.deepEqual(receiving.incoming[0].actions,['accept_participation','return_participation']);
  assert.deepEqual(axes.participationBoard(db,users['hr-head']).incoming,[],'another department sees no request details');
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users['hr-head'],pending.id,'accept_participation',{version:1,note:'محاولة قبول من إدارة أخرى'})),code('not_found'));
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users['ops-head'],pending.id,'accept_participation',{version:2,note:'نسخة قديمة لا تقبل'})),code('stale_version'));

  const accepted=tx(()=>axes.decideDepartmentParticipation(db,users['ops-head'],pending.id,'accept_participation',{version:1,note:'قبلت الإدارة النطاق بعد مراجعة المطلوب والسعة'}));
  assert.equal(accepted.status,'accepted');
  const link=db.prepare('SELECT * FROM project_departments WHERE project_id=? AND department_id=?').get(project.id,'ops');
  assert.equal(link.approved_by,'ops-head');
  assert.equal(link.request_id,pending.id);
  assert.equal(link.approval_source,'actor_decision');
  assert.equal(db.prepare("SELECT actor_id FROM audit_events WHERE entity_id=? AND action='axes.department_participation_accepted'").get(pending.id).actor_id,'ops-head');

  tx(()=>axes.addProjectMember(db,users.manager,project.id,{user_id:'ops-member',basis:'تنفيذ مخرج التشغيل في المشروع'}));
  tx(()=>axes.addProjectMember(db,users.manager,project.id,{user_id:'ops-head',basis:'مسؤول حزمة التشغيل في المشروع'}));
  const pack=tx(()=>axes.createWorkPackage(db,users.manager,project.id,{code:'OPS-1',title:'حزمة التشغيل',department_id:'ops',phase:'production',objective:'إنتاج المخرج التشغيلي وفق معيار قبوله',lead_id:'ops-head',planned_start:'2099-01-01',planned_end:'2099-02-01'}));
  assert.equal(pack.status,'planned');
  assert.equal(verifyAudit(db),true);
});

test('returned participation stays in history and a fresh request can later be accepted',t=>{
  const {db,users,tx,project}=fixture(t);
  const first=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'تتولى إدارة التشغيل إنتاج المخرج الأول'}));
  const returned=tx(()=>axes.decideDepartmentParticipation(db,users['ops-head'],first.id,'return_participation',{version:1,note:'أعد تحديد موعد التسليم ومعيار القبول قبل الالتزام'}));
  assert.equal(returned.status,'returned');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_departments WHERE project_id=?').get(project.id).n,0);
  const second=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'تتولى إدارة التشغيل المخرج قبل نهاية فبراير ومعيار القبول مرفق'}));
  assert.notEqual(second.id,first.id);
  tx(()=>axes.decideDepartmentParticipation(db,users['ops-head-2'],second.id,'accept_participation',{version:1,note:'راجعنا الموعد ومعيار القبول ونقبل المشاركة'}));
  const rows=db.prepare('SELECT id,status,decision_note,decided_by FROM project_department_requests WHERE project_id=? ORDER BY requested_at,rowid').all(project.id);
  assert.deepEqual(rows.map(r=>r.status),['returned','accepted']);
  assert.match(rows[0].decision_note,/موعد التسليم/);
  assert.equal(rows[1].decided_by,'ops-head-2');
  assert.throws(()=>db.prepare("UPDATE project_department_requests SET basis='تغيير صامت',version=version+1 WHERE id=?").run(first.id),/immutable|transition/i);
  assert.throws(()=>db.prepare('DELETE FROM project_department_requests WHERE id=?').run(first.id),/retained|append-only/i);
});

test('department decisions recheck the actor, tenant, routing and active state at decision time',t=>{
  const {db,users,tx,project}=fixture(t);
  const pending=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'طلب مشاركة إدارة التشغيل في مخرج مصطنع'}));
  db.prepare("INSERT INTO department_routing(tenant_id,department_id,step_role,user_id,assigned_by,assigned_at) VALUES('36t','ops','department_manager','ops-head','admin',?)").run(now());
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users['ops-head-2'],pending.id,'accept_participation',{version:1,note:'مدير غير معين في التوجيه'})),code('not_found'));
  db.prepare("UPDATE users SET active=0 WHERE id='ops-head'").run();
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users['ops-head'],pending.id,'accept_participation',{version:1,note:'حساب موقوف لا يقرر'})),code('forbidden'));
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users.external,pending.id,'accept_participation',{version:1,note:'كيان آخر لا يرى الطلب'})),code('not_found'));
  assert.equal(db.prepare('SELECT status FROM project_department_requests WHERE id=?').get(pending.id).status,'pending');
});

test('one project manager of record governs tasks and project axes without role-wide escalation',t=>{
  const {db,users,tx,project}=fixture(t);
  assert.deepEqual(projectManagerOfRecord(db,project),{id:'manager',name:'مدير الفريق التجريبي',source:'created_by',available:true});
  assert.throws(()=>tx(()=>createTask(db,users['pm-one'],project.id,{title:'مهمة بلا تفويض مشروع',assignee_id:'employee',due_date:'2099-01-10',acceptance:'مخرج مصطنع مقبول'})),code('not_project_manager'));
  assert.throws(()=>tx(()=>axes.setExecutionState(db,users['pm-one'],project.id,{version:0,state:'mobilising',note:'محاولة مدير مشروع بلا سجل إسناد'})),code('not_project_manager'));

  const stamp=now();
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('client-pm','36t','C-PM','عميل مدير المشروع','','اختبار','active','employee','',?,?)").run(stamp,stamp);
  db.prepare(`INSERT INTO project_handovers(id,tenant_id,project_id,client_id,contract_reference,contract_signed_on,kickoff_planned_on,channels,contract_value_minor,advance_minor,advance_claimed_on,project_manager_id,services,timeline_start,timeline_end,milestones,client_contacts,risks,special_requirements,status,prepared_by,created_at,updated_at)
    VALUES('handover-pm','36t',?,'client-pm','عقد مصطنع رقم 1','2026-09-01',NULL,'البريد والاجتماعات',100000,0,NULL,'pm-one','["خدمة"]','2026-09-01','2099-12-31','[{"name":"تسليم","due_on":"2099-12-31"}]','[{"name":"ممثل","title":"مدير","email":"","phone":"","is_primary":true}]','','','draft','manager',?,?)`).run(project.id,stamp,stamp);
  assert.equal(projectManagerOfRecord(db,project).id,'manager','المسودة لا تنقل صلاحية مدير المشروع');
  assert.ok(templatesBoard(db,users.manager).projects.some(p=>p.id===project.id));
  assert.ok(!templatesBoard(db,users['pm-one']).projects.some(p=>p.id===project.id));
  db.prepare("UPDATE project_handovers SET status='handed_over',version=version+1 WHERE id='handover-pm'").run();
  assert.deepEqual(projectManagerOfRecord(db,project),{id:'pm-one',name:'مديرة مشروع مصطنعة',source:'handover',available:true});
  assert.ok(templatesBoard(db,users['pm-one']).projects.some(p=>p.id===project.id),'مدير المشروع المسند يرى مشروعه في القوالب');
  assert.ok(!templatesBoard(db,users.manager).projects.some(p=>p.id===project.id),'المنشئ السابق لا يرى إجراء لم يعد يملكه');
  assert.throws(()=>tx(()=>createTask(db,users.manager,project.id,{title:'مهمة بعد التسليم',assignee_id:'employee',due_date:'2099-01-10',acceptance:'مخرج مصطنع مقبول'})),code('not_project_manager'));
  const template=tx(()=>createTemplate(db,users['pm-one'],{name:'قالب المدير الجديد',service_kind:'تصميم',phases:[{name:'التجهيز',tasks:[{title:'تحضير التسليم',offset_days:0,acceptance:'تسليم مصطنع واضح'}]}]}));
  assert.throws(()=>tx(()=>applyTemplate(db,users.manager,template.id,{project_id:project.id,start_date:'2099-01-10',assignee_id:'employee'})),code('not_project_manager'));
  assert.equal(tx(()=>applyTemplate(db,users['pm-one'],template.id,{project_id:project.id,start_date:'2099-01-10',assignee_id:'employee'})).tasks_created,1);
  const task=tx(()=>createTask(db,users['pm-one'],project.id,{title:'مهمة المدير المسند',assignee_id:'employee',due_date:'2099-01-10',acceptance:'مخرج مصطنع مقبول'}));
  assert.equal(task.assignee_id,'employee');

  db.prepare("UPDATE users SET active=0 WHERE id='pm-one'").run();
  const unavailable=projectManagerOfRecord(db,project);
  assert.equal(unavailable.id,'pm-one');assert.equal(unavailable.available,false);assert.equal(unavailable.source,'handover');
  assert.throws(()=>tx(()=>createTask(db,users.manager,project.id,{title:'لا سقوط صامت للمالك القديم',assignee_id:'employee',due_date:'2099-01-11',acceptance:'لا ينشأ عند غياب المدير'})),code('project_manager_unavailable'));
});


test('صاحب طلب المشاركة لا يعتمد طلبه حتى إذا انتقل إلى رئاسة الإدارة المستقبلة',t=>{
  const {db,users,tx,project}=fixture(t);
  const request=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'مشاركة مصطنعة قبل تغيير إدارة مقدم الطلب'}));
  db.prepare("UPDATE users SET department_id='ops' WHERE id='manager'").run();
  db.prepare("DELETE FROM department_routing WHERE tenant_id='36t' AND department_id='ops' AND step_role='department_manager'").run();
  const row=axes.participationBoard(db,users.manager).incoming.find(r=>r.id===request.id);
  assert.deepEqual(row.actions,[]);
  assert.throws(()=>tx(()=>axes.decideDepartmentParticipation(db,users.manager,request.id,'accept_participation',{version:1,note:'محاولة اعتماد طلب المشاركة ذاتيًا'})),code('self_approval'));
  assert.equal(db.prepare('SELECT status FROM project_department_requests WHERE id=?').get(request.id).status,'pending');
});

test('قاعدة البيانات ترفض اختلاق قرار مشاركة مباشرة عند الإنشاء',t=>{
  const {db,project}=fixture(t);
  for(const status of ['accepted','returned'])assert.throws(()=>db.prepare(`INSERT INTO project_department_requests(id,tenant_id,project_id,department_id,basis,status,requested_by,requested_at,decided_by,decided_at,decision_note,decision_role,decision_capability)
    VALUES(?, '36t',?,'ops','مشاركة مصطنعة لاختبار الحارس',?,'manager',?,'employee',?,'قرار مصطنع من شخص غير مخول','department_manager','projects.department_participation.decide')`).run('forged-'+status,project.id,status,now(),now()),/starts pending/);
});

test('رابط المشاركة يحتاج قرارًا مقبولًا مطابقًا ولا يقبل اختلاق سجل قديم',t=>{
  const {db,users,tx,project}=fixture(t);
  const request=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'نطاق مصطنع لاختبار تطابق قرار المشاركة'}));
  const insert=source=>db.prepare(`INSERT INTO project_departments(project_id,department_id,tenant_id,basis,requested_by,requested_at,approved_by,approved_at,approval_source,request_id)
    VALUES(?,'ops','36t','نطاق مصطنع لاختبار تطابق قرار المشاركة','manager',?,'ops-head',?,?,?)`).run(project.id,now(),now(),source,source==='actor_decision'?request.id:null);
  assert.throws(()=>insert('actor_decision'),/matching accepted/);
  assert.throws(()=>insert('legacy_declared'),/matching accepted/);
  tx(()=>axes.decideDepartmentParticipation(db,users['ops-head'],request.id,'accept_participation',{version:1,note:'قبول الإدارة المستقبلة للنطاق المصطنع'}));
  assert.throws(()=>db.prepare("UPDATE project_departments SET approved_by='ops-head-2' WHERE project_id=?").run(project.id),/retained/);
  assert.throws(()=>db.prepare('DELETE FROM project_departments WHERE project_id=?').run(project.id),/retained/);
});


test('مسار HTTP يرفض الاعتماد الذاتي حتى مع جلسة صالحة وCSRF صحيح',async t=>{
  const {db,users,tx,project}=fixture(t);
  const request=tx(()=>axes.requestDepartmentParticipation(db,users.manager,project.id,{department_id:'ops',basis:'مشاركة مصطنعة للتحقق من حارس HTTP'}));
  db.prepare("UPDATE users SET department_id='ops' WHERE id='manager'").run();
  db.prepare("DELETE FROM department_routing WHERE tenant_id='36t' AND department_id='ops' AND step_role='department_manager'").run();
  const app=createApp(db);
  const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username:'manager',password:'synthetic-project-participation-only'}});
  assert.equal(login.status,200);
  const response=await dispatch(app,{method:'POST',path:`/api/project-department-requests/${request.id}/accept_participation`,headers:{cookie:login.headers['Set-Cookie'].split(';')[0],'x-csrf-token':login.json().csrf},body:{version:1,note:'محاولة تجاوز الزر بطلب مباشر إلى الخادم'}});
  assert.equal(response.status,403);
  assert.equal(response.json().error.code,'self_approval');
  assert.equal(db.prepare('SELECT status FROM project_department_requests WHERE id=?').get(request.id).status,'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_departments WHERE project_id=?').get(project.id).n,0);
});
