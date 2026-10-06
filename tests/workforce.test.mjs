import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { workforceBoard, simulateSaudization, recordDemographics, SAUDIZATION_TEXT } from '../app/workforce.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hr-cases-comp');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  return {db,users,tx};
}
const keys=value=>value&&typeof value==='object'?Object.entries(value).flatMap(([k,x])=>[...(Array.isArray(value)?[]:[k]),...keys(x)]):[];

test('workforce: saudization is a ratio from platform records with the mandated wording, and no band, colour or compliance level is computed',t=>{
  const {db,users,tx}=fixture(t);
  for(const who of ['employee','manager','outsider','it'])assert.throws(()=>workforceBoard(db,users[who]),code('not_permitted'));
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:'female',source:'هوية وطنية تجريبية'}));
  tx(()=>recordDemographics(db,users.hr,'outsider',{version:0,nationality_group:'non_saudi',gender:'',source:'إقامة تجريبية'}));
  const board=workforceBoard(db,users.hr),s=board.saudization;
  assert.equal(s.text,'النسبة محسوبة من سجلات المنصة. تصنيف النطاق وأثره يحدده مدير الموارد البشرية من حساب المنشأة لدى الجهة — غير متحقق منه هنا.');
  assert.equal(s.text,SAUDIZATION_TEXT);
  assert.deepEqual({active:s.active,recorded:s.recorded,unrecorded:s.unrecorded,saudi:s.saudi,ratio_bp:s.ratio_bp,complete:s.complete},{active:5,recorded:2,unrecorded:3,saudi:1,ratio_bp:5000,complete:false},'unrecorded people are counted and disclosed, not guessed');
  const names=keys(board);
  assert.ok(!names.some(k=>/band|nitaqat|colou?r|complian|risk|predict|likely|score/i.test(k)),names.filter(k=>/band|colou?r|complian|risk|predict/i.test(k)).join(','));
  assert.equal(board.headcount,5);
  assert.deepEqual(board.departments.map(d=>d.count).reduce((a,b)=>a+b,0),5);
  assert.ok(verifyAudit(db));
});

test('workforce: the hire/leave simulation returns the ratio only, writes nothing and passes no compliance judgement',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:'female',source:'هوية وطنية تجريبية'}));
  tx(()=>recordDemographics(db,users.hr,'outsider',{version:0,nationality_group:'non_saudi',gender:'male',source:'إقامة تجريبية'}));
  const before=db.prepare('SELECT (SELECT COUNT(*) FROM audit_events) AS a,(SELECT COUNT(*) FROM employee_demographics) AS d').get();
  const sim=simulateSaudization(db,users.hr,{hire_saudi:2,hire_non_saudi:0,leave_saudi:0,leave_non_saudi:0});
  assert.equal(sim.before.ratio_bp,5000);assert.equal(sim.after.ratio_bp,7500);
  assert.deepEqual(Object.keys(sim).sort(),['after','before','note','text','unrecorded']);
  assert.deepEqual(db.prepare('SELECT (SELECT COUNT(*) FROM audit_events) AS a,(SELECT COUNT(*) FROM employee_demographics) AS d').get(),before);
  assert.throws(()=>simulateSaudization(db,users.hr,{leave_saudi:3}),code('invalid_number'));
  assert.throws(()=>simulateSaudization(db,users.employee,{hire_saudi:1}),code('not_permitted'));
  assert.ok(verifyAudit(db));
});

test('workforce: joiners, leavers and turnover come from dated records, people without a profile are disclosed rather than guessed',t=>{
  const {db,users}=fixture(t);
  const profile=db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,updated_by,updated_at) VALUES(?,'36t','وظيفة تجريبية','full_time',?,?,'hr','x')");
  profile.run('manager','2020-01-01','active');profile.run('outsider','2021-01-01','left');profile.run('employee','2026-02-01','active');
  db.prepare("INSERT INTO employee_changes(id,tenant_id,user_id,change_type,from_value,to_value,effective_from,reason,created_by,created_at,applied_at) VALUES('left-1','36t','outsider','status','active','left','2026-03-01','مغادرة تجريبية','hr','x','x')").run();
  db.prepare("UPDATE users SET active=0 WHERE id='outsider'").run();
  const m=workforceBoard(db,users.hr,{from:'2026-01-01',to:'2026-06-30'}).movement;
  assert.deepEqual({joiners:m.joiners,leavers:m.leavers,start:m.headcount_start,end:m.headcount_end,turnover_bp:m.turnover_bp,without_profile:m.without_profile},{joiners:1,leavers:1,start:2,end:2,turnover_bp:5000,without_profile:2});
  assert.throws(()=>workforceBoard(db,users.hr,{from:'2026-07-01',to:'2026-01-01'}),code('date_order'));
  assert.ok(verifyAudit(db));
});

test('workforce: nationality is recorded by HR from a document, never by the employee, never with an ID number, with version checks and tenant isolation',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>recordDemographics(db,users.hr,'hr',{version:0,nationality_group:'saudi',source:'هوية وطنية تجريبية'})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("INSERT INTO employee_demographics(user_id,tenant_id,nationality_group,source,recorded_by,updated_at) VALUES('hr','36t','saudi','هوية تجريبية','hr','x')").run(),/CHECK constraint/);
  assert.throws(()=>tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',source:'هوية رقم 1098765432'})),code('reference_number'));
  assert.throws(()=>tx(()=>recordDemographics(db,users.hr,'external',{version:0,nationality_group:'saudi',source:'هوية وطنية تجريبية'})),code('not_found'));
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',source:'هوية وطنية تجريبية'}));
  assert.throws(()=>tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'non_saudi',source:'تصحيح تجريبي'})),code('stale_version'));
  tx(()=>recordDemographics(db,users.hr,'employee',{version:1,nationality_group:'non_saudi',source:'تصحيح بعد الاطلاع على الإقامة'}));
  // حامل تصريح العرض من غير الموارد البشرية يرى ولا يسجل.
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('g-wf','36t','it','hr.workforce.view','تجريبي','admin','x')").run();
  assert.equal(workforceBoard(db,users.it).can_record,false);
  assert.throws(()=>tx(()=>recordDemographics(db,users.it,'manager',{version:0,nationality_group:'saudi',source:'هوية وطنية تجريبية'})),code('not_permitted'));
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('g-wf-x','isolated','external','hr.workforce.view','تجريبي','admin','x')").run();
  const isolated=workforceBoard(db,users.external);
  assert.equal(isolated.headcount,1);assert.ok(!JSON.stringify(isolated).includes(users.employee.name));
  assert.ok(verifyAudit(db));
});
