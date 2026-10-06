// الترحيل 174 (الحزمة 4، P4-HR-3): مركز تكلفة الإدارة بيدين، وصرف السلفة مرة واحدة.
// يُطبَّق من الصفر، وعلى قاعدة تجريبية متوقفة عند 173 فيها سلف بحالاتها الثلاث، فلا يتغيّر صفٌّ قائم ويعمل كل قيد جديد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { migrateTo } from './crm-rebuild-fixture.mjs';
import { snapshot } from '../scripts/crm-rebuild-parity.mjs';

const STAMP='2026-09-20T09:00:00.000Z';
const ADVANCE_COLUMNS=['id','tenant_id','user_id','amount_minor','installments','first_month','reason','status','proposed_by','decided_by','decided_at','decision_note','created_at'];
function pre174(t){
  const dir=mkdtempSync(join(tmpdir(),'36t-migration-174-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'pre174.sqlite'),db=new DatabaseSync(path);
  migrateTo(db,173);seed(db,'synthetic-migration-174');
  const advance=(id,status,decided)=>db.prepare('INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,decided_by,decided_at,decision_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'36t','employee',120000,2,'2026-09','سلفة تجريبية سابقة للترحيل 174',status,'hr',decided?'manager':null,decided?STAMP:null,decided?'قرار تجريبي سابق':'',STAMP);
  advance('syn-adv-proposed','proposed',false);advance('syn-adv-approved','approved',true);advance('syn-adv-rejected','rejected',true);
  const before=snapshot(db,['salary_advances'],{salary_advances:ADVANCE_COLUMNS});
  db.close();
  return {path,before};
}
const payout=(db,id,{by='it',on='2026-09-21',reference='SYN-PAY-1',evidence='إشعار تحويل تجريبي محفوظ'}={})=>
  db.prepare('UPDATE salary_advances SET disbursed_on=?,disbursement_reference=?,disbursement_evidence=?,disbursed_by=?,disbursement_recorded_at=? WHERE id=?').run(on,reference,evidence,by,STAMP,id);

test('migration 174: applies from an empty database and on one stopped at 173, keeps every advance as it was, and the foreign keys and audit chain stay clean',t=>{
  const fresh=openDb(':memory:');t.after(()=>fresh.close());
  for(const name of ['department_cost_centres','department_cost_centres_fixed','department_cost_centres_no_delete','salary_advances_fixed','salary_advances_payout_shape','salary_advances_payout_insert'])
    assert.ok(fresh.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name),`${name} exists`);
  const {path,before}=pre174(t);
  const db=openDb(path);t.after(()=>db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=174').get());
  assert.deepEqual(snapshot(db,['salary_advances'],{salary_advances:ADVANCE_COLUMNS}),before,'every advance keeps every value');
  assert.deepEqual(db.prepare('SELECT DISTINCT disbursed_on,disbursement_reference,disbursement_evidence,disbursed_by FROM salary_advances').all().map(r=>({...r})),[{disbursed_on:null,disbursement_reference:null,disbursement_evidence:'',disbursed_by:null}],'no advance was paid out by the migration');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(verifyAudit(db),true);
});

test('migration 174: an approved advance is paid out once, whole, on or after its approval day, by someone other than the employee, its proposer and its approver — a proposed or rejected one never',t=>{
  const {path}=pre174(t);
  const db=openDb(path);t.after(()=>db.close());
  assert.throws(()=>payout(db,'syn-adv-proposed'),/final|paid out/,'a proposed advance is not paid out');
  assert.throws(()=>payout(db,'syn-adv-rejected'),/final/,'a rejected advance is not paid out');
  for(const [who,why] of [['employee','its owner'],['hr','its proposer'],['manager','its approver']])assert.throws(()=>payout(db,'syn-adv-approved',{by:who}),/someone other/,`not by ${why}`);
  assert.throws(()=>payout(db,'syn-adv-approved',{on:'2026-09-19'}),/approval day/,'not before the Riyadh day of its approval');
  assert.throws(()=>payout(db,'syn-adv-approved',{evidence:'قصير'}),/whole/,'not without its evidence');
  payout(db,'syn-adv-approved');
  assert.throws(()=>payout(db,'syn-adv-approved',{on:'2026-09-22'}),/final/,'once');
  assert.throws(()=>db.prepare("UPDATE salary_advances SET reason='سبب مختلف بعد القرار تمامًا' WHERE id='syn-adv-approved'").run(),/final/);
  assert.throws(()=>db.prepare("INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,created_at,disbursed_on) VALUES('syn-adv-new','36t','outsider',1000,1,'2026-10','سلفة تجريبية جديدة للاختبار','proposed','hr',?,'2026-09-21')").run(STAMP),/after it is approved/);
  assert.throws(()=>db.prepare("DELETE FROM salary_advances WHERE id='syn-adv-approved'").run(),/retained/);
});

test('migration 174: a department cost centre is recorded once per department at a time, decided by a second person, and never rewritten or deleted',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-migration-174-centres');t.after(()=>db.close());
  db.prepare("INSERT INTO finance_cost_centers(id,tenant_id,code,name,created_by,created_at) VALUES('syn-cc-a','36t','CC-A','مركز تجريبي أ','manager',?),('syn-cc-b','36t','CC-B','مركز تجريبي ب','manager',?),('syn-cc-iso','isolated','CC-I','مركز معزول تجريبي','external',?)").run(STAMP,STAMP,STAMP);
  const insert=(id,department='creative',centre='syn-cc-a',tenant='36t',by='employee')=>db.prepare("INSERT INTO department_cost_centres(id,tenant_id,department_id,cost_center_id,effective_from,reason,status,recorded_by,created_at) VALUES(?,?,?,?,'2026-01-01','ربط تجريبي للإدارة بمركزها','pending',?,?)").run(id,tenant,department,centre,by,STAMP);
  insert('syn-dc-1');
  assert.throws(()=>insert('syn-dc-2'),/UNIQUE/,'one waits per department');
  assert.throws(()=>insert('syn-dc-x','hr','syn-cc-iso'),/FOREIGN KEY/,'a centre of another tenant');
  assert.throws(()=>insert('syn-dc-y','other'),/FOREIGN KEY/,'a department of another tenant');
  const decide=(id,by,status='approved')=>db.prepare("UPDATE department_cost_centres SET status=?,decided_by=?,decided_at=?,decision_note='قرار تجريبي' WHERE id=?").run(status,by,STAMP,id);
  assert.throws(()=>decide('syn-dc-1','employee'),/CHECK/,'the recorder does not decide');
  decide('syn-dc-1','manager');
  assert.throws(()=>db.prepare("UPDATE department_cost_centres SET cost_center_id='syn-cc-b' WHERE id='syn-dc-1'").run(),/decided once/);
  assert.throws(()=>decide('syn-dc-1','manager','rejected'),/decided once/);
  assert.throws(()=>db.prepare("DELETE FROM department_cost_centres WHERE id='syn-dc-1'").run(),/retained/);
  insert('syn-dc-2','creative','syn-cc-b');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM department_cost_centres WHERE department_id='creative'").get().n,2,'a decided row frees the department for the next dated one');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
