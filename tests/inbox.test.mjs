import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { seedPayrollDemo } from '../scripts/seed-payroll-demo.mjs';
import { seedOperationsDemo } from '../scripts/seed-operations-demo.mjs';
import { inbox, inboxCount, clearInboxCache } from '../app/inbox.mjs';
import { obligations } from '../app/obligations.mjs';
import { decideMission } from '../app/attendance-extras.mjs';
import { attendanceExtras } from '../app/attendance-extras.mjs';

test('inbox: a manager sees every pending decision across modules in one place, the requester sees none of them, and a decision removes its item',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-inbox');t.after(()=>db.close());seedVendorsDemo(db);seedHrDemo(db);seedPayrollDemo(db);seedOperationsDemo(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const manager=inbox(db,users.manager),kinds=manager.groups.flatMap(g=>g.items.map(i=>i.kind));
  for(const kind of ['مهمة عمل','عمل إضافي','تدريب','خارج النطاق'])assert.ok(kinds.includes(kind),`the manager is told about: ${kind}`);
  assert.equal(manager.total,manager.groups.reduce((n,g)=>n+g.items.length,0));assert.deepEqual(manager.unavailable,[],'no board failed to load');
  assert.ok(manager.groups.every(g=>g.link===`#${g.key}`&&g.items.every(i=>i.actions.length&&i.title)));
  const mine=inbox(db,users.employee);
  assert.equal(mine.groups.flatMap(g=>g.items).some(i=>['مهمة عمل','عمل إضافي','تدريب'].includes(i.kind)),false,'your own requests are not your decisions');
  assert.equal(inbox(db,users.it).total,0);
  const mission=attendanceExtras(db,users.manager).missions.find(m=>m.actions.includes('approve_mission'));
  transaction(db,()=>decideMission(db,users.manager,mission.id,'approve',{note:'ضمن خطة المشروع'}));
  assert.equal(inbox(db,users.manager).total,manager.total-1);
  // العداد محفوظ لعشرين ثانية لكل مستخدم، ويُمسح عند أي كتابة ناجحة في الخادم.
  clearInboxCache();const first=inboxCount(db,users.manager);assert.equal(first.total,manager.total-1);assert.equal(inboxCount(db,users.manager),first);
  // الموجة 1 «ما عليّ»: الرقم رقم obligations، وكل بند له معرّف يفتح سجله لا شاشته، والعدّ قبل القطع.
  assert.equal(first.total,obligations(db,users.manager).counts.decide,'the badge, the inbox and «أقرّر» are one number');
  const again=inbox(db,users.manager);
  for(const g of again.groups){
    assert.equal(g.total,g.items.length,`${g.key}: nothing is cut below the page size`);assert.equal(g.truncated,false);
    for(const i of g.items){
      assert.ok(i.action_keys.length,'the raw action names travel with the label');
      if(i.id){assert.ok(i.link.includes(encodeURIComponent(i.id)),`${g.key}: «${i.title}» opens ${i.link}, not its record`);assert.notEqual(i.link,g.link,'the record link is not overwritten with the screen key');}
      assert.equal(typeof i.overdue,'boolean');assert.equal(i.late,i.overdue);assert.ok(i.age_days===null||Number.isInteger(i.age_days));
    }
  }
  assert.match(again.late_note,/أيام عمل/,'lateness is stated in working days, not «three days»');
  assert.ok(Array.isArray(again.respond),'what awaits my reply travels beside what awaits my decision, never inside its count');
  assert.equal(again.total,again.groups.reduce((n,g)=>n+g.total,0));
});
