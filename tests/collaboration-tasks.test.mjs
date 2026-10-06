import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { createList, createSpaceTask, taskBoard, moveTask, completeSpaceTask, reopenSpaceTask, commentOnTask } from '../app/collaboration-tasks.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-collaboration-tasks');t.after(()=>db.close());
  const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));
  const lists={
    todo:db.prepare("SELECT * FROM work_lists WHERE space_id=? AND kind='backlog'").get(space.id),
    doing:db.prepare("SELECT * FROM work_lists WHERE space_id=? AND kind='active'").get(space.id),
    done:db.prepare("SELECT * FROM work_lists WHERE space_id=? AND kind='complete'").get(space.id)
  };
  return {db,owner,member,space,lists};
}

test('list and card views read one task identity, not duplicated records',t=>{
  const {db,owner,member,space,lists}=fixture(t);
  const task=transaction(db,()=>createSpaceTask(db,owner,space.id,{list_id:lists.todo.id,title:'إعداد نموذج العمل',accountable_id:member.id,due_on:'2099-10-08',acceptance:'نموذج منشور ومراجع',priority:'high',contributors:['outsider']}));
  const board=taskBoard(db,member,space.id);
  assert.equal(board.tasks.length,1);assert.equal(board.tasks[0].id,task.id);assert.equal(board.tasks[0].source,'space_task');
  assert.deepEqual(board.tasks[0].contributors,['outsider']);
  assert.equal(board.lists.find(list=>list.id===lists.todo.id).tasks[0].id,task.id);
  const comment=transaction(db,()=>commentOnTask(db,member,space.id,task.id,{body:'أضفت الملاحظات المطلوبة على النموذج'}));
  assert.equal(comment.author_id,member.id);
});

test('card completion requires evidence and stale movement cannot overwrite current order',t=>{
  const {db,owner,member,space,lists}=fixture(t);
  const task=transaction(db,()=>createSpaceTask(db,owner,space.id,{list_id:lists.todo.id,title:'تسليم نسخة مصطنعة',accountable_id:member.id,due_on:'2099-10-08',acceptance:'رابط النسخة المقبولة'}));
  assert.throws(()=>transaction(db,()=>moveTask(db,member,space.id,task.id,{version:task.version,to_list_id:lists.done.id,position:0})),code('evidence_required'));
  const moved=transaction(db,()=>moveTask(db,member,space.id,task.id,{version:task.version,to_list_id:lists.doing.id,position:1}));
  assert.equal(moved.position,1);assert.equal(moved.version,2);
  assert.throws(()=>transaction(db,()=>moveTask(db,member,space.id,task.id,{version:task.version,to_list_id:lists.todo.id,position:0})),code('stale_version'));
  const done=transaction(db,()=>completeSpaceTask(db,member,space.id,task.id,{version:moved.version,evidence:'رابط مصطنع لنسخة التسليم',to_list_id:lists.done.id}));
  assert.equal(done.status,'completed');assert.equal(done.list_id,lists.done.id);
  const reopened=transaction(db,()=>reopenSpaceTask(db,owner,space.id,task.id,{version:done.version,reason:'ظهرت ملاحظة قبول جديدة',to_list_id:lists.doing.id}));
  assert.equal(reopened.status,'open');assert.equal(reopened.evidence,null);
});

test('linked request cards are read-only in the free board',t=>{
  const {db,owner,member,space,lists}=fixture(t);
  const task=transaction(db,()=>createSpaceTask(db,owner,space.id,{list_id:lists.todo.id,title:'طلب مرتبط بالمسار الأصلي',accountable_id:member.id,due_on:'2099-10-08',acceptance:'إكمال الطلب من شاشة الطلب',source_kind:'request',source_id:'request-synthetic'}));
  assert.throws(()=>transaction(db,()=>moveTask(db,owner,space.id,task.id,{version:task.version,to_list_id:lists.doing.id,position:0})),code('source_action_required'));
});
