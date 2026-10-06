import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { openDb,transaction,verifyAudit } from '../app/db.mjs';
import { login,authenticate,checkCsrf } from '../app/auth.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import * as projects from '../app/projects.mjs';
import { createApp } from '../app/server.mjs';

const password='synthetic-test-password-only';
function fixture(t) {
  const db=openDb(':memory:');seed(db,password);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const services=wf.catalog(db,users.employee);
  const act=(u,r,action,note='')=>transaction(db,()=>wf.transition(db,users[u],r.id,action,{version:r.version,note}));
  const make=(code='IT-SUPPORT',payload={issue:'تعذر تشغيل الجهاز',impact:'يمنع العمل'})=>transaction(db,()=>wf.createRequest(db,users.employee,{service_id:services.find(s=>s.code===code).id,title:'طلب اختبار',payload}));
  return {db,users,services,act,make};
}
const code=expected=>error=>error.code===expected;

test('PLT-04: request moves from employee to manager to executor with completion evidence',t=>{
  const {db,users,make,act}=fixture(t);
  let r=make();r=act('employee',r,'submit');
  assert.equal(r.status,'pending');assert.equal(wf.listRequests(db,users.manager)[0].needs_me,true);
  r=act('manager',r,'approve');assert.equal(r.status,'approved');
  r=act('it',r,'claim');assert.equal(r.status,'in_progress');
  assert.throws(()=>act('it',r,'complete'),code('invalid_text'));
  r=act('it',r,'complete','تم إصلاح الإعداد واختبار الجهاز');
  assert.equal(r.status,'completed');assert.equal(verifyAudit(db),true);
  assert.equal(db.prepare('SELECT status FROM outbox').get().status,'blocked');
  assert.ok(wf.notifications(db,users.employee).length>=3);
});

test('PLT-04: sequential approval cannot skip HR or overwrite an earlier submitted version',t=>{
  const {db,users,make,act}=fixture(t);
  let r=make('HR-LETTER',{purpose:'إثبات عمل',recipient:'جهة تجريبية'});
  r=act('employee',r,'submit');
  assert.throws(()=>act('hr',r,'approve'),code('transition_denied'));
  r=act('manager',r,'return','يرجى توضيح اسم الجهة');
  r=transaction(db,()=>wf.editRequest(db,users.employee,r.id,{version:r.version,title:'خطاب معدل',payload:{purpose:'إثبات العمل فقط',recipient:'جهة أخرى'}}));
  r=act('employee',r,'submit');assert.equal(r.revision,2);
  assert.equal(r.versions[0].snapshot.payload.recipient,'جهة تجريبية');
  assert.equal(r.versions[1].snapshot.payload.recipient,'جهة أخرى');
  r=act('manager',r,'approve');assert.equal(r.status,'pending');
  r=act('hr',r,'approve');assert.equal(r.status,'approved');
});

test('PLT-01/05/07: tenant, unrelated employee, and technical admin cannot read request, file or search title',t=>{
  const {db,users,make}=fixture(t);let r=make();
  r=transaction(db,()=>wf.addAttachment(db,users.employee,r.id,{version:r.version,filename:'brief.txt',content:Buffer.from('تعليمات مستند ليست صلاحيات').toString('base64')}));
  for(const u of [users.outsider,users.admin,users.external]) {
    assert.throws(()=>wf.getRequest(db,u,r.id),code('not_found'));
    assert.throws(()=>wf.downloadAttachment(db,u,r.attachments[0].id),code('not_found'));
    assert.deepEqual(wf.listRequests(db,u,'طلب'),[]);
  }
  assert.equal(Buffer.from(wf.downloadAttachment(db,users.employee,r.attachments[0].id).content).toString(),'تعليمات مستند ليست صلاحيات');
});

test('PLT-04: creator cannot approve and client cannot choose approver, state, tenant or requester',t=>{
  const {db,users,make,act,services}=fixture(t);let r=act('employee',make(),'submit');
  assert.throws(()=>act('employee',r,'approve'),code('transition_denied'));
  for(const field of ['requester_id','tenant_id','approver_id','status','assigned_to']) assert.throws(()=>transaction(db,()=>wf.createRequest(db,users.employee,{service_id:services[0].id,title:'طلب',payload:{},[field]:'admin'})),code('invalid_fields'));
  assert.throws(()=>transaction(db,()=>wf.editRequest(db,users.employee,r.id,{version:r.version,title:'تغيير بعد الإرسال',payload:{}})),code('immutable_request'));
  assert.throws(()=>act('manager',r,'complete','قفز'),code('transition_denied'));
});

test('PLT-04: self routing and ambiguous approval routing fail without partial records',t=>{
  const {db,users,make,act}=fixture(t);let r=make();
  users.employee.manager_id='employee';db.prepare("UPDATE users SET role='manager' WHERE id='employee'").run();
  assert.throws(()=>act('employee',r,'submit'),code('self_approval'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_steps').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_versions').get().n,0);
  assert.equal(wf.getRequest(db,users.employee,r.id).status,'draft');
  users.employee.manager_id='manager';db.prepare("UPDATE users SET role='employee' WHERE id='employee'").run();
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'hr-second',tenant_id,department_id,'hr-second','Synthetic second approver',password_hash,role FROM users WHERE id='hr'");
  const hr=make('HR-LETTER',{purpose:'اختبار تعدد المعتمدين',recipient:'جهة مصطنعة'});
  assert.throws(()=>act('employee',hr,'submit'),code('routing_unavailable'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_steps').get().n,0);
  assert.equal(wf.getRequest(db,users.employee,hr.id).status,'draft');
});

test('PLT-04/09: stale duplicate decision fails and creates one blocked event',t=>{
  const {db,make,act}=fixture(t);const r=act('employee',make(),'submit');
  const approved=act('manager',r,'approve');
  assert.throws(()=>act('manager',r,'approve'),code('stale_version'));
  assert.throws(()=>act('manager',approved,'approve'),code('transition_denied'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,1);
});

test('PLT-04: cancellation and rejection are terminal and cannot be executed',t=>{
  const {make,act}=fixture(t);
  let r=act('employee',make(),'submit');r=act('manager',r,'reject','خارج نطاق الخدمة');
  assert.throws(()=>act('employee',r,'submit'),code('transition_denied'));
  let c=act('employee',make(),'submit');c=act('manager',c,'approve');c=act('employee',c,'cancel');
  assert.throws(()=>act('it',c,'claim'),code('not_found'));
});

test('PLT-03: required fields and dates validated by server; new catalog service needs no new app',t=>{
  const {db,users,make,act}=fixture(t);
  const r=make('HR-LETTER',{});assert.throws(()=>act('employee',r,'submit'),code('missing_field'));
  const service=transaction(db,()=>wf.createService(db,users.admin,{code:'CUSTOM-REQUEST',name_ar:'خدمة مهيأة',name_en:'Configured service',department_id:'it',description:'خدمة اختبار جديدة',fields:[{key:'date',label:'التاريخ',type:'date',required:true}],approval_policy:{steps:['manager'],handler_role:'it'}}));
  assert.throws(()=>transaction(db,()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'اختبار',payload:{date:'2026-02-30'}})),code('invalid_date'));
  let c=transaction(db,()=>wf.createRequest(db,users.employee,{service_id:service.id,title:'اختبار جديد',payload:{date:'2026-09-10'}}));
  c=act('employee',c,'submit');c=act('manager',c,'approve');assert.equal(c.status,'approved');
  assert.throws(()=>db.prepare('UPDATE services SET name_ar=? WHERE id=?').run('تغيير',service.id),/immutable|version/);
});

test('PLT-07: unsafe filename, wrong signature and post-submit attachment are rejected',t=>{
  const {db,users,make,act}=fixture(t);let r=make();
  for(const filename of ['../file.txt','a/b.txt','test.html','fake.pdf']) assert.throws(()=>transaction(db,()=>wf.addAttachment(db,users.employee,r.id,{version:r.version,filename,content:Buffer.from('not pdf').toString('base64')})));
  r=act('employee',r,'submit');assert.throws(()=>transaction(db,()=>wf.addAttachment(db,users.employee,r.id,{version:r.version,filename:'x.txt',content:'eA=='})),code('immutable_attachment'));
});

test('PLT-06: audit and submitted snapshots cannot be changed or deleted',t=>{
  const {db,make,act}=fixture(t);act('employee',make(),'submit');
  assert.throws(()=>db.exec("UPDATE audit_events SET reason='changed'"),/append only/);
  assert.throws(()=>db.exec('DELETE FROM audit_events'),/append only/);
  assert.throws(()=>db.exec("UPDATE request_versions SET snapshot='{}'"),/immutable/);
  assert.equal(verifyAudit(db),true);
});

test('PMO-01 and access: project membership gates tasks and briefs, completion requires evidence',t=>{
  const {db,users,services}=fixture(t);
  const p=transaction(db,()=>projects.createProject(db,users.manager,{name:'مشروع تجريبي',brief:'تكليف محدد',member_ids:['employee']}));
  const task=transaction(db,()=>projects.createTask(db,users.manager,p.id,{title:'تسليم المحتوى',assignee_id:'employee',due_date:'2026-10-01',acceptance:'نسخة مراجعة موثقة'}));
  assert.deepEqual(projects.listProjects(db,users.outsider),[]);
  assert.throws(()=>projects.completeTask(db,users.outsider,task.id,{version:1,evidence:'مكتمل'}),code('project_not_found'));
  assert.throws(()=>projects.completeTask(db,users.employee,task.id,{version:1,evidence:''}),code('invalid_text'));
  const complete=transaction(db,()=>projects.completeTask(db,users.employee,task.id,{version:1,evidence:'تمت المراجعة في ملف مرفق المشروع'}));assert.equal(complete.status,'completed');
  const r=transaction(db,()=>wf.createRequest(db,users.employee,{service_id:services[0].id,title:'طلب مرتبط',payload:{},project_id:p.id}));assert.equal(r.project_id,p.id);
  assert.throws(()=>transaction(db,()=>wf.createRequest(db,users.outsider,{service_id:services[0].id,title:'طلب متطفل',payload:{},project_id:p.id})),code('project_not_found'));
  assert.throws(()=>db.prepare('INSERT INTO project_members VALUES(?,?)').run(p.id,'external'),/cross tenant/);
});

test('IT-02: password, CSRF, disabled users, expiration and logout are enforced',t=>{
  const {db}=fixture(t);
  assert.throws(()=>login(db,'employee','wrong','test-ip'),code('invalid_credentials'));
  const result=login(db,'employee',password,'test-ip');
  const a=authenticate(db,`session=${result.token}`);checkCsrf(a.session,result.csrf);
  assert.throws(()=>checkCsrf(a.session,'wrong'),code('csrf'));
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
  assert.throws(()=>authenticate(db,`session=${result.token}`),code('session_expired'));
  db.prepare("UPDATE users SET active=1 WHERE id='employee'").run();
  db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.throws(()=>authenticate(db,`session=${result.token}`),code('session_expired'));
});

test('HTTP security and cross-department journey use real local endpoints',async t=>{
  const {db}=fixture(t),server=createApp(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function signin(user) {const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password})});assert.equal(res.status,200);return {cookie:res.headers.get('set-cookie').split(';')[0],...(await res.json())};}
  const employee=await signin('employee'),manager=await signin('manager'),executor=await signin('it'),outsider=await signin('outsider');
  async function api(user,path,method='GET',data) {const res=await fetch(base+path,{method,headers:{Cookie:user.cookie,'Content-Type':'application/json','x-csrf-token':user.csrf,'Idempotency-Key':randomUUID()},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,body:await res.json()};}
  assert.equal((await fetch(base+'/api/requests')).status,401);
  assert.equal((await fetch(base+'/api/requests',{method:'POST',headers:{Cookie:employee.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:employee.cookie,Origin:'https://evil.example'}})).status,403);
  const catalog=await api(employee,'/api/catalog');const service=catalog.body.find(s=>s.code==='IT-SUPPORT');
  // B12 (تدقيق بوابة الموظف 19 سبتمبر): سجل النطاق صفحة تطوير داخلية، لا تصريحًا افتراضيًا لكل موظف؛ الأدمن الأول يقرؤه.
  assert.equal((await api(employee,'/api/requirements')).status,403);
  const scope=await api(await signin('admin'),'/api/requirements');assert.equal(scope.body.length,220);
  assert.ok(scope.body.every(r=>r.implementation_status&&r.acceptance));
  // موظف الكيان الآخر مرفوض: قبل B12 بفحص الكيان (404)، والآن يسبقه فحص التصريح (403).
  const external=await signin('external');assert.ok([403,404].includes((await api(external,'/api/requirements')).status));
  let r=(await api(employee,'/api/requests','POST',{service_id:service.id,title:'HTTP request',payload:{issue:'اختبار كامل',impact:'استفسار'}})).body;
  assert.equal((await api(outsider,`/api/requests/${r.id}`)).status,404);
  r=(await api(employee,`/api/requests/${r.id}/submit`,'POST',{version:r.version})).body;
  r=(await api(manager,`/api/requests/${r.id}/approve`,'POST',{version:r.version})).body;
  r=(await api(executor,`/api/requests/${r.id}/claim`,'POST',{version:r.version})).body;
  r=(await api(executor,`/api/requests/${r.id}/complete`,'POST',{version:r.version,note:'تم التحقق عبر واجهة HTTP'})).body;
  assert.equal(r.status,'completed');
  assert.equal((await api(employee,'/api/not-registered')).status,404);
  assert.equal((await api(employee,'/api/logout','POST',{})).status,200);
  assert.equal((await api(employee,'/api/me')).status,401);
});

test('NFR-04/10: SQLite backup restores requests, attachment bytes, permissions and audit',async t=>{
  const {db,users,make,act}=fixture(t);let r=make();
  r=transaction(db,()=>wf.addAttachment(db,users.employee,r.id,{version:r.version,filename:'evidence.txt',content:Buffer.from('restored content').toString('base64')}));
  r=act('employee',r,'submit');r=act('manager',r,'approve');
  const dir=mkdtempSync(join(tmpdir(),'36t-restore-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  await backup(db,join(dir,'restored.sqlite'));
  const restored=openDb(join(dir,'restored.sqlite'));t.after(()=>restored.close());
  assert.equal(wf.detail(restored,users.employee,r.id).status,'approved');
  assert.equal(Buffer.from(wf.downloadAttachment(restored,users.employee,r.attachments[0].id).content).toString(),'restored content');
  assert.throws(()=>wf.getRequest(restored,users.external,r.id),code('not_found'));
  assert.equal(verifyAudit(restored),true);
});
