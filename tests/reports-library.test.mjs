import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { seedPayrollDemo } from '../scripts/seed-payroll-demo.mjs';
import { seedOperationsDemo } from '../scripts/seed-operations-demo.mjs';
import { REPORTS, runReport, reportsIndex, exportReport } from '../app/reports.mjs';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-report-library');t.after(()=>db.close());
  seedVendorsDemo(db);seedHrDemo(db);seedPayrollDemo(db);seedOperationsDemo(db);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('accountant','36t','ops','accountant','محاسب مصطنع','unused','employee',NULL),('chief','36t','ops','chief','تنفيذي مصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const action of ['read','configure','prepare'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','accountant','employee',action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'chief',capability:'executive.view',note:'اطلاع تنفيذي مصطنع'}));
  return {db,users};
}

test('report library: every report runs for every role allowed to open it, its rows match its columns, and it exports in both formats',t=>{
  const {db,users}=fixture(t),ran=new Set(),problems=[];
  assert.equal(new Set(REPORTS.map(r=>r.key)).size,REPORTS.length,'report keys are unique');
  for(const who of ['employee','manager','hr','accountant','chief','admin','it']){
    for(const {key} of reportsIndex(db,users[who]).reports){
      try{
        const result=runReport(db,users[who],key,{from:'2026-01-01',to:'2026-12-31'}),keys=new Set(result.columns.map(c=>c.key));
        if(!result.definition||!result.source||!result.notes.length)problems.push(`${who}/${key}: missing definition, source or notes`);
        for(const row of result.rows)for(const field of Object.keys(row))if(!keys.has(field))problems.push(`${who}/${key}: row field ${field} has no column`);
        for(const row of result.rows)for(const c of result.columns){const value=row[c.key];if(value===undefined)problems.push(`${who}/${key}: column ${c.key} is undefined`);if(['number','money'].includes(c.type)&&value!==null&&!Number.isFinite(value))problems.push(`${who}/${key}: column ${c.key} is not a number (${value})`);}
        for(const format of ['csv','xlsx'])if(!exportReport(result,format).content.length)problems.push(`${who}/${key}: empty ${format}`);
        ran.add(key);
      }catch(error){problems.push(`${who}/${key}: ${error.message}`);}
    }
  }
  assert.deepEqual([...new Set(problems)],[]);
  assert.deepEqual(REPORTS.map(r=>r.key).filter(k=>!ran.has(k)),[],'every report was opened by at least one role in this fixture');
});

test('report library: account reports show only the accounts whose team the reader belongs to, and finance figures stay with finance',t=>{
  const {db,users}=fixture(t),range={from:'2026-01-01',to:'2026-12-31'};
  assert.ok(runReport(db,users.employee,'R21',range).rows.length>0);
  assert.equal(reportsIndex(db,users.hr).reports.some(r=>['R19','R20','R21','R22'].includes(r.key)),false,'HR is on no account team');
  assert.equal(reportsIndex(db,users.employee).reports.some(r=>['R04','R12','R33','R35','R39'].includes(r.key)),false);
  const pulse=runReport(db,users.chief,'R01',range);
  assert.equal(pulse.rows.some(r=>r.area==='المالية'),false,'an executive without a finance grant sees no money');
  assert.match(pulse.notes.join(' '),/مخفية/);
  assert.ok(runReport(db,users.accountant,'R35',range).rows.some(r=>r.check==='توازن المركز المالي'));
});
