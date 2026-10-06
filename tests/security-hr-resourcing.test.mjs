import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { resourcingBoard, capacityBoard, createBooking, getBooking, confirmBooking, releaseBooking, createPlaceholder, fillPlaceholder, cancelPlaceholder } from '../app/resourcing.mjs';
import { weekStart, weekEnd } from '../app/resource-weeks.mjs';

// إثبات إغلاق ثغرة الحجوزات خارج النطاق (مراجعة الأمن 2026-09-18). كل البيانات مصطنعة.
const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-resourcing');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع سري تجريبي',brief:'موجز سري للعميل',member_ids:['employee']}));
  const booking=tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:'employee',placeholder_id:null,from_date:weekStart(today()),to_date:weekEnd(weekStart(today())),hours_per_week:24,note:'تنفيذ حملة العميل السري'}));
  const placeholder=tx(()=>createPlaceholder(db,users.manager,{project_id:project.id,role_name:'مصمم',note:''}));
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'resourcing.plan',department_id:null,note:'تخطيط تجريبي'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'resourcing.view',department_id:null,note:'تخطيط تجريبي'}));
  return {db,users,tx,project,booking,placeholder};
}

test('resourcing scope: a planner outside the project and team cannot read, confirm, release, fill or cancel — every path answers «not found»',t=>{
  const {db,users,tx,booking,placeholder}=fixture(t);
  assert.throws(()=>getBooking(db,users.it,booking.id),code('not_found'));
  assert.throws(()=>tx(()=>confirmBooking(db,users.it,booking.id,{version:booking.version,note:'تأكيد من خارج الفريق'})),code('not_found'));
  assert.throws(()=>tx(()=>releaseBooking(db,users.it,booking.id,{version:booking.version,note:'إطلاق من خارج الفريق تمامًا'})),code('not_found'));
  assert.throws(()=>tx(()=>fillPlaceholder(db,users.it,placeholder.id,{version:1,user_id:'it',note:'تعيين من خارج المشروع'})),code('not_found'));
  assert.throws(()=>tx(()=>cancelPlaceholder(db,users.it,placeholder.id,{version:1,note:'إلغاء من خارج المشروع'})),code('not_found'));
  assert.equal(db.prepare('SELECT status FROM resource_bookings WHERE id=?').get(booking.id).status,'tentative');
  // صاحب النطاق ما زال يتصرف.
  assert.equal(tx(()=>confirmBooking(db,users.manager,booking.id,{version:booking.version,note:'أكّده مدير المشروع'})).status,'confirmed');
  assert.ok(verifyAudit(db));
});

test('resourcing board: bookings and placeholders outside the viewer’s projects and people never reach the board',t=>{
  const {db,users}=fixture(t);
  const board=resourcingBoard(db,users.it);
  assert.deepEqual(board.bookings,[],'no booking of a project the planner is not on');
  assert.deepEqual(board.placeholder_records,[]);
  assert.deepEqual(capacityBoard(db,users.it).placeholders,[]);
  assert.ok(!JSON.stringify(board).includes('العميل السري'));
  const own=resourcingBoard(db,users.manager);
  assert.equal(own.bookings.length,1);assert.equal(own.placeholder_records.length,1);
});
