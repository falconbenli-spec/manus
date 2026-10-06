import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb,transaction,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import * as wf from '../app/workflow.mjs';

const password='synthetic-regression-password';
function fixture(t,code='HR-LETTER') {
  const db=openDb(':memory:');seed(db,password);t.after(()=>db.close());
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=wf.catalog(db,user('employee')).find(s=>s.code===code);
  let r=transaction(db,()=>wf.createRequest(db,user('employee'),{service_id:service.id,title:'Security regression',payload:code==='HR-LETTER'?{purpose:'اختبار',recipient:'جهة مصطنعة'}:{issue:'اختبار',impact:'استفسار'}}));
  r=transaction(db,()=>wf.addAttachment(db,user('employee'),r.id,{version:r.version,filename:'test.txt',content:Buffer.from('synthetic content').toString('base64')}));
  const act=(id,action)=>r=transaction(db,()=>wf.transition(db,user(id),r.id,action,{version:r.version,note:'synthetic evidence'}));
  act('employee','submit');return {db,user,act,get r(){return r;}};
}
test('SEC-02: revoked role removes request, search, attachment and notification access',t=>{
  const f=fixture(t);assert.ok(wf.notifications(f.db,f.user('manager')).length);
  f.db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  const u=f.user('manager');
  assert.throws(()=>wf.detail(f.db,u,f.r.id),{code:'not_found'});
  assert.deepEqual(wf.listRequests(f.db,u),[]);
  assert.deepEqual(wf.notifications(f.db,u),[]);
  assert.throws(()=>wf.downloadAttachment(f.db,u,f.r.attachments[0].id),{code:'not_found'});
  assert.throws(()=>f.act('manager','approve'),{code:'not_found'});
});
test('SEC-03: changed reporting line revokes the old manager approval scope',t=>{
  const f=fixture(t);
  f.db.prepare("UPDATE users SET manager_id=NULL WHERE id='employee'").run();
  assert.throws(()=>f.act('manager','approve'),{code:'not_found'});
  assert.equal(f.db.prepare('SELECT status FROM requests WHERE id=?').get(f.r.id).status,'pending');
});
test('SEC-03: HTTP approval rechecks current department with an existing session',async t=>{
  const f=fixture(t);f.act('manager','approve');
  const server=createApp(f.db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'hr',password})});
  const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  f.db.prepare("UPDATE users SET department_id='it' WHERE id='hr'").run();
  for(const action of ['approve','return','reject']) {
    const res=await fetch(base+`/api/requests/${f.r.id}/${action}`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','x-csrf-token':auth.csrf},body:JSON.stringify({version:f.r.version,note:'test decision'})});
    assert.equal(res.status,404);
  }
  assert.equal(f.db.prepare("SELECT status FROM approval_steps WHERE approver_id='hr'").get().status,'pending');
});
test('SEC-05: settled decisions and step identity cannot be rewritten or deleted',t=>{
  const f=fixture(t);f.act('manager','approve');
  assert.throws(()=>f.db.prepare("UPDATE approval_steps SET status='rejected' WHERE approver_id='manager'").run(),/immutable/);
  assert.throws(()=>f.db.prepare("UPDATE approval_steps SET approver_id='it' WHERE approver_id='hr'").run(),/immutable|dated decision/);
  assert.throws(()=>f.db.prepare('DELETE FROM approval_steps').run(),/immutable/);
  f.act('hr','approve');assert.equal(f.r.status,'approved');assert.equal(verifyAudit(f.db),true);
});
test('SEC-04: concurrent HTTP retries create one record and keys cannot change content or bypass visibility',async t=>{
  const f=fixture(t),server=createApp(f.db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function sign(username){const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});return {cookie:res.headers.get('set-cookie').split(';')[0],...await res.json()};}
  const employee=await sign('employee'),manager=await sign('manager'),outsider=await sign('outsider');
  async function post(user,path,input,key){const res=await fetch(base+path,{method:'POST',headers:{Cookie:user.cookie,'Content-Type':'application/json','x-csrf-token':user.csrf,...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(input)});return {status:res.status,body:await res.json()};}
  const input={service_id:f.r.service_id,title:'One attempt',payload:{}};
  assert.equal((await post(employee,'/api/requests',input)).status,400);
  const key=randomUUID();
  const results=await Promise.all(Array.from({length:5},()=>post(employee,'/api/requests',input,key)));
  assert.ok(results.every(r=>r.status===201));assert.equal(new Set(results.map(r=>r.body.id)).size,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM requests WHERE title='One attempt'").get().n,1);
  assert.equal((await post(employee,'/api/requests',{...input,title:'Changed'},key)).status,409);
  const other=await post(outsider,'/api/requests',input,key);assert.equal(other.status,201);assert.notEqual(other.body.id,results[0].body.id);
  const project={name:'One project',brief:'synthetic project',member_ids:['employee']},pkey=randomUUID();
  const p=await post(manager,'/api/projects',project,pkey);assert.equal(p.status,201);
  assert.equal((await post(manager,'/api/projects',project,pkey)).body.id,p.body.id);
  const task={title:'One task',assignee_id:'employee',due_date:'2026-09-15',acceptance:'Synthetic acceptance'},tkey=randomUUID();
  const taskPath=`/api/projects/${p.body.id}/tasks`,createdTask=await post(manager,taskPath,task,tkey);
  assert.equal(createdTask.status,201);assert.equal((await post(manager,taskPath,task,tkey)).body.id,createdTask.body.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,1);
  const admin=await sign('admin'),skey=randomUUID();
  const service={code:'RETRY-TEST',name_ar:'تجربة',name_en:'Test',description:'Synthetic test',department_id:'it',fields:[{key:'note',label:'Note',type:'text',required:true}],approval_policy:{steps:['manager'],handler_role:'it'}};
  const createdService=await post(admin,'/api/catalog',service,skey);assert.equal(createdService.status,201);
  assert.equal((await post(admin,'/api/catalog',service,skey)).body.id,createdService.body.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM services WHERE code='RETRY-TEST'").get().n,1);
  f.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(p.body.id,'manager');
  assert.equal((await post(manager,'/api/projects',project,pkey)).status,404);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,1);
});
