import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { createSpaceTask } from '../app/collaboration-tasks.mjs';
import { publishTopic } from '../app/collaboration-messages.mjs';
import { activityFeed, workspaceReport } from '../app/collaboration-reports.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
test('workspace report counts drill into the exact rows and labels workload as task count',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-collaboration-report');t.after(()=>db.close());const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'})),list=db.prepare('SELECT * FROM work_lists WHERE space_id=?').get(space.id);
  transaction(db,()=>createSpaceTask(db,owner,space.id,{list_id:list.id,title:'مهمة تقرير مصطنعة',accountable_id:member.id,due_on:'2099-10-10',acceptance:'مخرج قابل للمراجعة'}));
  transaction(db,()=>publishTopic(db,owner,space.id,{title:'تحديث تقرير مصطنع',body:'نص التقرير'}));
  const report=workspaceReport(db,owner,space.id,{from:'2020-01-01T00:00:00.000Z',to:'2099-12-31T23:59:59.999Z'});
  assert.equal(report.counts.tasks,report.rows.tasks.length);assert.equal(report.counts.topics,report.rows.topics.length);
  assert.equal(report.workload.label,'عدد المهام المفتوحة');assert.equal(report.workload.by_accountable.find(row=>row.accountable_id===member.id).task_count,1);
  const feed=activityFeed(db,member,space.id,{limit:2});assert.equal(feed.items.length,2);assert.ok(feed.next_cursor);
});

