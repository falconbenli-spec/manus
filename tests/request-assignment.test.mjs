import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import * as admin from '../app/admin.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { releaseRequest, reassignRequest, overrideAssignment, sweepDepartedWork, departmentHeldWork, heldWorkBoard } from '../app/request-assignment.mjs';
import { homeBoard } from '../app/home.mjs';
import { obligations } from '../app/obligations.mjs';
import { clearInboxCache } from '../app/inbox.mjs';

// العطب 8: طلب «قيد التنفيذ» عند موظف غادر كان نهائيًا — لا يُلغى إسناده ولا يُعاد ولا يتجاوزه أحد، ولا يسمع به مدير ولا أدمن. كل ما هنا مصطنع.
const code=value=>error=>error.code===value;
const REASON='سبب مكتوب تجريبي لحركة الإسناد';
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-request-assignment');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,active) VALUES('it2','36t','it','it2','منفذ دعم تجريبي ثانٍ','x','it',NULL,1)").run();
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const act=(who,rid,action,note='')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const running=(claimer='it')=>{const d=wf.catalog(db,user('admin')).find(s=>s.code==='IT-SUPPORT');
    const r=tx(()=>wf.createRequest(db,user('employee'),{service_id:d.id,title:'عطل تجريبي قيد التنفيذ',payload:payloadForStored(d.fields,fieldModel('IT-SUPPORT'))}));
    act('employee',r.id,'submit');act('manager',r.id,'approve');act(claimer,r.id,'claim');return r.id;};
  const events=rid=>db.prepare('SELECT kind,from_user_id,to_user_id,actor_id,handling_department_id FROM request_assignment_events WHERE request_id=? ORDER BY created_at,rowid').all(rid).map(x=>({...x}));
  const notes=(who,kind)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=?').all(who,kind);
  return {db,tx,user,row,act,running,events,notes};
}

test('defect 8: the executor can give the work back, with a written reason — it returns to the queue, is recorded, and the other executors are told',t=>{
  const {db,tx,user,row,running,events,notes}=fixture(t),rid=running('it');
  assert.ok(wf.actions(db,user('it'),row(rid)).includes('release'));assert.equal(wf.actions(db,user('it2'),row(rid)).includes('release'),false);
  assert.throws(()=>tx(()=>releaseRequest(db,user('it2'),rid,{version:row(rid).version,reason:REASON})),code('not_your_work'));
  assert.throws(()=>tx(()=>releaseRequest(db,user('it'),rid,{version:row(rid).version,reason:'قصير'})),error=>error.status===400);
  const back=tx(()=>releaseRequest(db,user('it'),rid,{version:row(rid).version,reason:REASON}));
  assert.equal(back.status,'approved');assert.equal(back.assigned_to,null);
  assert.deepEqual(events(rid),[{kind:'released',from_user_id:'it',to_user_id:null,actor_id:'it',handling_department_id:'it'}]);
  assert.equal(notes('it2','execution_released').length,1);assert.equal(notes('it','execution_released').length,0,'the actor is not told of his own act');
  assert.ok(wf.actions(db,user('it2'),row(rid)).includes('claim'),'and the queue can claim it again');
  assert.ok(verifyAudit(db));
});

test('defect 8: the handling department’s head reassigns — only to someone in the request’s own execution chain, never to its requester',t=>{
  const {db,tx,user,row,running,events,notes}=fixture(t),rid=running('it');
  const held=departmentHeldWork(db,user('head-it')),line=held.find(x=>x.id===rid);
  assert.ok(line,'the head sees what his department is executing, and with whom');assert.equal(line.assignee_name,'منفذ الدعم التقني');assert.deepEqual(line.candidates.map(c=>c.id),['it2']);
  assert.equal('payload' in line,false);assert.ok(homeBoard(db,user('head-it')).manager.department_held.some(x=>x.id===rid));
  assert.deepEqual(departmentHeldWork(db,user('manager')),[],'another department’s head sees none of it');
  const input={version:row(rid).version,to_user_id:'it2',reason:REASON};
  assert.throws(()=>tx(()=>reassignRequest(db,user('manager'),rid,input)),code('not_found'));
  assert.throws(()=>tx(()=>reassignRequest(db,user('it'),rid,input)),code('not_found'));
  assert.throws(()=>tx(()=>reassignRequest(db,user('head-it'),rid,{...input,to_user_id:'employee'})),code('not_an_executor'));
  assert.throws(()=>tx(()=>reassignRequest(db,user('head-it'),rid,{...input,to_user_id:'hr'})),code('not_an_executor'));
  tx(()=>reassignRequest(db,user('head-it'),rid,input));
  assert.equal(row(rid).status,'in_progress');assert.equal(row(rid).assigned_to,'it2');
  assert.deepEqual(events(rid),[{kind:'reassigned',from_user_id:'it',to_user_id:'it2',actor_id:'head-it',handling_department_id:'it'}]);
  assert.equal(notes('it2','execution_reassigned').length,1);assert.equal(notes('it','execution_moved_away').length,1);
  assert.ok(wf.actions(db,user('it2'),row(rid)).includes('complete'));assert.equal(wf.actions(db,user('it'),row(rid)).includes('complete'),false);
  clearInboxCache();assert.ok(obligations(db,user('it2'),{watching:false}).items.some(i=>i.id===rid&&i.bucket==='do'),'it is now the new executor’s work in «أنفّذ»');
  assert.ok(verifyAudit(db));
});

test('defect 8: deactivating an account hands its in-progress work back to its department queue in the same transaction, and the department head is told',t=>{
  const {db,tx,user,row,running,events,notes}=fixture(t),rid=running('it2');
  // المعاملة نفسها: إن تراجع الإيقاف تراجع معه كل شيء.
  assert.throws(()=>tx(()=>{admin.updateAccount(db,user('admin'),'it2',{active:false});throw new Error('rollback');}),/rollback/);
  assert.equal(row(rid).status,'in_progress');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_assignment_events').get().n,0);
  tx(()=>admin.updateAccount(db,user('admin'),'it2',{active:false}));
  assert.equal(row(rid).status,'approved');assert.equal(row(rid).assigned_to,null);
  assert.deepEqual(events(rid),[{kind:'departure',from_user_id:'it2',to_user_id:null,actor_id:'admin',handling_department_id:'it'}]);
  assert.equal(notes('it','execution_released').length,1,'the remaining executor is told');
  const told=db.prepare("SELECT * FROM notifications WHERE user_id='head-it' AND kind='executor_departed'").all();
  assert.equal(told.length,1,'the department head is told');assert.match(told[0].title,/أُوقف حساب منفّذه/);
  assert.equal(notes('employee','execution_holder_changed').length,1);
  assert.ok(wf.actions(db,user('it'),row(rid)).includes('claim'));
  assert.equal(JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.executor_departed'").get(rid).after_json).by,'user');
  assert.ok(verifyAudit(db));
});

test('defect 8: an account stopped behind the platform’s back is caught by the sweep, and until then the structure manager can override with a written reason',t=>{
  const {db,tx,user,row,running,events}=fixture(t),first=running('it2'),second=running('it2');
  db.prepare("UPDATE users SET active=0 WHERE id='it2'").run();
  assert.equal(wf.actions(db,user('it'),row(first)).includes('claim'),false,'before the fix this work was final: nobody could take it');
  const board=heldWorkBoard(db,user('admin'));
  assert.deepEqual(board.rows.map(x=>x.id).sort(),[first,second].sort());assert.equal('title' in board.rows[0]&&board.rows[0].title!==''&&board.rows[0].confidential,false);
  assert.equal(heldWorkBoard(db,user('head-it')).visible,false);
  assert.throws(()=>tx(()=>overrideAssignment(db,user('head-it'),first,{reason:REASON})),code('not_permitted'));
  assert.throws(()=>tx(()=>overrideAssignment(db,user('admin'),first,{reason:'قصير'})),error=>error.status===400);
  assert.throws(()=>tx(()=>overrideAssignment(db,user('admin'),first,{to_user_id:'employee',reason:REASON})),code('not_an_executor'));
  tx(()=>overrideAssignment(db,user('admin'),first,{to_user_id:'it',reason:REASON}));
  assert.equal(row(first).assigned_to,'it');assert.equal(row(first).status,'in_progress');
  assert.deepEqual(events(first),[{kind:'admin_override',from_user_id:'it2',to_user_id:'it',actor_id:'admin',handling_department_id:'it'}]);
  const swept=tx(()=>sweepDepartedWork(db,'36t',user('admin')));
  assert.deepEqual(swept,{accounts:1,returned:1,tasks_flagged:0});
  assert.equal(row(second).status,'approved');assert.equal(events(second)[0].actor_id,null,'found by the sweep: no human actor');
  assert.deepEqual(tx(()=>sweepDepartedWork(db,'36t',user('admin'))),{accounts:0,returned:0,tasks_flagged:0},'twice = once');
  assert.equal(heldWorkBoard(db,user('admin')).rows.length,0);
  assert.ok(verifyAudit(db));
});
