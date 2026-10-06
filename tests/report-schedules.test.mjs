import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, revokeAccess } from '../app/access.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { reportsIndex, readSnapshot } from '../app/reports.mjs';
import { duePeriod, createSchedule, stopSchedule, schedulesFor, runDueSchedules } from '../app/report-schedules.mjs';

const code=value=>error=>error.code===value;
test('periods: a monthly run captures the month that ended, a weekly run the Sunday-to-Saturday week that ended',()=>{
  assert.deepEqual(duePeriod('monthly','2026-03-01'),{from:'2026-02-01',to:'2026-02-28',next:'2026-04-01'});
  assert.deepEqual(duePeriod('monthly','2027-01-15'),{from:'2026-12-01',to:'2026-12-31',next:'2027-02-01'});
  assert.deepEqual(duePeriod('weekly','2026-09-20'),{from:'2026-09-13',to:'2026-09-19',next:'2026-09-27'},'2026-09-20 is a Sunday');
  assert.deepEqual(duePeriod('weekly','2026-09-23'),{from:'2026-09-13',to:'2026-09-19',next:'2026-09-27'});
});

test('schedules: a due schedule saves one draft snapshot per period under its owner, and stops itself when the owner loses the right to the report',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-schedules');t.after(()=>db.close());seedVendorsDemo(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  assert.ok(reportsIndex(db,users.employee).reports.some(r=>r.key==='R26'));
  assert.throws(()=>tx(()=>createSchedule(db,users.it,{report_key:'R26',cadence:'monthly'})),code('not_found'),'no schedule on a report you cannot open');
  const id=tx(()=>createSchedule(db,users.employee,{report_key:'R26',cadence:'monthly'})).id;
  assert.throws(()=>tx(()=>createSchedule(db,users.employee,{report_key:'R26',cadence:'monthly'})),code('duplicate_schedule'));
  assert.deepEqual(runDueSchedules(db,'2000-01-01'),[],'nothing is due before the first run date');
  const next=schedulesFor(db,users.employee).schedules[0].next_run,first=runDueSchedules(db,next);
  assert.equal(first.length,1);assert.equal(first[0].outcome,'snapshot');
  const snapshot=readSnapshot(db,users.employee,first[0].snapshot_id);
  assert.equal(snapshot.snapshot.status,'draft','a scheduled snapshot still waits for someone else to approve it');assert.deepEqual([snapshot.params.from,snapshot.params.to],[duePeriod('monthly',next).from,duePeriod('monthly',next).to]);
  assert.deepEqual(runDueSchedules(db,next),[],'the same period is not captured twice');
  const grant=db.prepare("SELECT id FROM access_grants WHERE user_id='employee' AND capability='vendors.manage' AND revoked_at IS NULL").get();
  tx(()=>revokeAccess(db,users.admin,grant.id,{reason:'سحب تصريح الموردين لاختبار الجدولة'}));
  const after=schedulesFor(db,users.employee).schedules[0].next_run,second=runDueSchedules(db,after);
  assert.equal(second[0].outcome,'stopped');
  const stopped=db.prepare('SELECT active,stopped_reason FROM report_schedules WHERE id=?').get(id);
  assert.equal(stopped.active,0);assert.match(stopped.stopped_reason,/أوقفها النظام/);
  assert.throws(()=>tx(()=>stopSchedule(db,users.employee,id,{reason:'إيقاف جدولة متوقفة'})),code('not_found'));
  assert.ok(verifyAudit(db));
});
