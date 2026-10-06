import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { createCheckin, runDueCheckins, answerCheckin, checkinBoard, convertAnswerToTask } from '../app/collaboration-checkins.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){const db=openDb(':memory:');seed(db,'synthetic-collaboration-checkins');t.after(()=>db.close());const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));return {db,owner,member,space,list:db.prepare('SELECT * FROM work_lists WHERE space_id=?').get(space.id)};}

test('a due weekly check-in creates one Riyadh cycle and keeps named answers out of Pulse',t=>{
  const {db,owner,member,space}=fixture(t);
  const checkin=transaction(db,()=>createCheckin(db,owner,space.id,{question:'وش أنجزت هذا الأسبوع؟',cadence:'weekly',weekday:0,due_time:'09:00',from:'2026-10-02T05:00:00.000Z'}));
  transaction(db,()=>runDueCheckins(db,{at:'2026-10-04T06:01:00.000Z'}));transaction(db,()=>runDueCheckins(db,{at:'2026-10-04T06:02:00.000Z'}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_checkin_cycles WHERE checkin_id=?').get(checkin.id).n,1);
  const answer=transaction(db,()=>answerCheckin(db,member,checkin.id,{body:'أنجزت مهمة تجريبية'}));assert.equal(answer.user_id,member.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pulse_answers').get().n,0);
  const board=checkinBoard(db,owner,space.id);assert.equal(board.checkins[0].cycles[0].responses[0].user_id,member.id);
});

test('a named check-in answer can become a task without writing performance data',t=>{
  const {db,owner,member,space,list}=fixture(t);
  const checkin=transaction(db,()=>createCheckin(db,owner,space.id,{question:'وش يمنعك من التقدم؟',cadence:'daily',due_time:'09:00',from:'2026-10-02T05:00:00.000Z'}));
  transaction(db,()=>runDueCheckins(db,{at:'2026-10-02T06:01:00.000Z'}));const answer=transaction(db,()=>answerCheckin(db,member,checkin.id,{body:'أحتاج نسخة العقد'}));
  const task=transaction(db,()=>convertAnswerToTask(db,owner,answer.id,{list_id:list.id,title:'توفير نسخة العقد',accountable_id:owner.id,due_on:'2099-10-10',acceptance:'نسخة محفوظة في الملفات'}));
  assert.equal(task.title,'توفير نسخة العقد');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM performance_reviews').get().n,0);
});

