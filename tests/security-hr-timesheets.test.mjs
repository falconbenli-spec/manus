import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { logTime } from '../app/agency.mjs';
import { timesheetsBoard, submitTimesheet, decideTimesheet, setLockWindow, lockDuePeriods } from '../app/timesheets.mjs';
import { weekStart, addDays } from '../app/resource-weeks.mjs';

// إثبات إغلاق ثغرة القفل على مستوى الكيان (مراجعة الأمن 2026-09-18). كل البيانات مصطنعة.
const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-security-timesheets');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع الساعات التجريبي',brief:'موجز تجريبي',member_ids:['employee','outsider']}));
  const past=addDays(weekStart(today()),-14);
  const week=who=>{tx(()=>logTime(db,users[who],{project_id:project.id,work_date:past,minutes:120,billable:true,note:'عمل تجريبي حقيقي'}));return tx(()=>submitTimesheet(db,users[who],{week_start:past,note:''}));};
  return {db,users,tx,week};
}

test('timesheet lock window: a tenant-wide setting only a platform admin enters — a team approver from another team cannot',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'timesheets.approve',department_id:null,note:'مدير فريق آخر تجريبي'}));
  for(const who of ['it','manager','hr','employee'])
    assert.throws(()=>tx(()=>setLockWindow(db,users[who],{lock_after_days:1,basis:'قررته وحدي بلا سند من المالك',version:0})),code('not_permitted'));
  assert.equal(tx(()=>setLockWindow(db,users.admin,{lock_after_days:1,basis:'قرار المالك الموثق في محضر تجريبي',version:0})).lock_after_days,1);
  assert.ok(verifyAudit(db));
});

test('timesheet locking: an approver locks only their direct team, and never a submitted week awaiting its decision — in code and by a trigger',t=>{
  const {db,users,tx,week}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'timesheets.approve',department_id:null,note:'مدير فريق آخر تجريبي'}));
  const submitted=week('employee');
  tx(()=>setLockWindow(db,users.admin,{lock_after_days:1,basis:'قرار المالك الموثق في محضر تجريبي',version:0}));
  // مدير فريق آخر: لا يقفل أسبوع موظفة ليست في فريقه.
  assert.deepEqual(tx(()=>lockDuePeriods(db,users.it,{basis:'قفل كل الكيان من مدير فريق آخر'})),{locked:0,cutoff:addDays(today(),-1),locked_without_approval:0});
  assert.equal(timesheetsBoard(db,users.it).lockable_periods,0);
  // مديرها المباشر: الأسبوع المرسل ينتظر قراره، فلا يقفله القفل المجدول.
  assert.equal(tx(()=>lockDuePeriods(db,users.manager,{basis:'تنفيذ القفل الدوري وفق قرار المالك'})).locked,0);
  assert.equal(db.prepare('SELECT status FROM timesheet_periods WHERE id=?').get(submitted.id).status,'submitted');
  assert.throws(()=>db.prepare("UPDATE timesheet_periods SET status='locked',locked_by='it',locked_at='x',lock_basis='قفل مباشر في القاعدة',version=version+1 WHERE id=?").run(submitted.id),/awaits its manager decision/);
  const approved=tx(()=>decideTimesheet(db,users.manager,submitted.id,'approve',{version:submitted.version,note:'',entries:submitted.entries.map(e=>({entry_id:e.id,billable:true}))}));
  assert.equal(approved.status,'approved','the real manager still decides the week');
  assert.equal(tx(()=>lockDuePeriods(db,users.manager,{basis:'تنفيذ القفل الدوري وفق قرار المالك'})).locked,1,'after the decision the week locks');
  assert.ok(verifyAudit(db));
});
