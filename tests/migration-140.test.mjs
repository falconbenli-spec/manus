import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb,hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

const STAMP='2026-09-23T08:00:00.000Z';
const PURCHASE_COLUMNS='id,tenant_id,project_id,requester_id,title,specification,cost_center,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at,cost_center_id';

function pre140(t) {
  const directory=mkdtempSync(join(tmpdir(),'pre140-')),path=join(directory,'pre140.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version=Number(file.slice(0,3));
    if(version>=140)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-135');
  raw.prepare("INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES('cc-135','36t','CC-135','مركز ترحيل البنود المصطنع',1,'admin',?)").run(STAMP);
  raw.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('project-135','36t','مشروع ترحيل البنود','بيانات مصطنعة لا غير','manager',?)").run(STAMP);
  raw.prepare("INSERT INTO project_members(project_id,user_id) VALUES('project-135','manager'),('project-135','employee')").run();
  raw.prepare(`INSERT INTO procurement_purchases(${PURCHASE_COLUMNS}) VALUES('purchase-135','36t','project-135','employee','احتياج سابق للترحيل','خمس وحدات محفوظة قبل نموذج البنود','CC-135','2026-12-01',5,'وحدة','SAR',10000,'مخصص مصطنع محفوظ','draft',1,?,?, 'cc-135')`).run(STAMP,STAMP);
  const before=JSON.stringify(raw.prepare(`SELECT ${PURCHASE_COLUMNS} FROM procurement_purchases WHERE id='purchase-135'`).get());
  const audit=raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  raw.close();
  return {path,before,audit};
}

test('الترحيل 140: الطلب القديم يصبح بندًا واحدًا وتخصيصًا واحدًا دون تغيير كميته أو مخصصه أو حالته',t=>{
  const {path,before,audit}=pre140(t);
  const db=openDb(path);
  t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=140').get(),'طُبق الترحيل 140');
  assert.equal(JSON.stringify(db.prepare(`SELECT ${PURCHASE_COLUMNS} FROM procurement_purchases WHERE id='purchase-135'`).get()),before,'رأس الطلب لم يتغير');
  const line=db.prepare("SELECT * FROM procurement_purchase_lines WHERE purchase_id='purchase-135'").get();
  assert.equal(line.description,'خمس وحدات محفوظة قبل نموذج البنود');
  assert.equal(line.quantity,5);
  assert.equal(line.unit_price_minor,null,'المخصص ليس سعر وحدة ولا يُحوّل إليه');
  assert.equal(line.price_source,'not_priced');
  const allocation=db.prepare('SELECT * FROM procurement_line_allocations WHERE purchase_line_id=?').get(line.id);
  assert.equal(allocation.cost_center_id,'cc-135');
  assert.equal(allocation.amount_minor,10000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,audit,'الترحيل لا ينتحل فاعلًا بشريًا');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
