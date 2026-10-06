import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { ensureSpace } from '../app/collaboration-space.mjs';
import { scheduleBoard, createEvent, cancelEvent } from '../app/collaboration-schedule.mjs';

const code=value=>error=>error?.code===value;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function fixture(t){const db=openDb(':memory:');seed(db,'synthetic-collaboration-schedule');t.after(()=>db.close());const owner=user(db,'manager'),member=user(db,'employee');
  const space=transaction(db,()=>ensureSpace(db,owner,{kind:'department',id:'creative'}));return {db,owner,member,space};}

test('events use UTC with a declared Riyadh timezone and internal attendees',t=>{
  const {db,owner,member,space}=fixture(t);
  const event=transaction(db,()=>createEvent(db,owner,space.id,{title:'اجتماع متابعة التسليم',description:'مراجعة التقدم والموانع',starts_at:'2026-10-04T06:00:00.000Z',ends_at:'2026-10-04T07:00:00.000Z',location:'غرفة الاجتماع',recurrence:'weekly',attendee_ids:[member.id]}));
  assert.equal(event.timezone,'Asia/Riyadh');assert.equal(event.recurrence_rule,'weekly');
  const board=scheduleBoard(db,member,space.id,{from:'2026-10-01T00:00:00.000Z',to:'2026-10-31T23:59:59.999Z'});
  assert.equal(board.events[0].id,event.id);assert.deepEqual(board.events[0].attendee_ids,['employee']);
  assert.throws(()=>transaction(db,()=>cancelEvent(db,member,space.id,event.id,{version:event.version,reason:'محاولة عضو'})),code('space_forbidden'));
  const cancelled=transaction(db,()=>cancelEvent(db,owner,space.id,event.id,{version:event.version,reason:'تغيّر موعد اجتماع العميل'}));assert.equal(cancelled.status,'cancelled');
});

