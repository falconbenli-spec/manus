import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb,hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

const STAMP='2026-09-24T08:00:00.000Z';

function pre141(t) {
  const directory=mkdtempSync(join(tmpdir(),'pre141-')),path=join(directory,'pre141.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version=Number(file.slice(0,3));
    if(version>=141)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-136');
  raw.prepare("INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES('cc-136','36t','CC-136','مركز ترحيل أسعار مصطنع',1,'admin',?)").run(STAMP);
  raw.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('project-136','36t','مشروع ترحيل أسعار','بيانات مصطنعة لا غير','manager',?)").run(STAMP);
  raw.prepare("INSERT INTO project_members(project_id,user_id) VALUES('project-136','manager'),('project-136','employee')").run();
  raw.prepare(`INSERT INTO procurement_purchases(id,tenant_id,project_id,requester_id,title,specification,cost_center,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at,cost_center_id)
    VALUES('purchase-136','36t','project-136','employee','احتياج سابق لتسعير البنود','خمس وحدات محفوظة قبل جدول أسعار البنود','CC-136','2026-12-01',5,'وحدة','SAR',10000,'مخصص مصطنع محفوظ','draft',1,?,?, 'cc-136')`).run(STAMP,STAMP);
  raw.prepare(`INSERT INTO procurement_purchase_lines(id,purchase_id,line_no,description,quantity,unit,currency,unit_price_minor,price_source,purchase_version,created_at)
    VALUES('line-136','purchase-136',1,'خمس وحدات محفوظة قبل جدول أسعار البنود',5,'وحدة','SAR',NULL,'not_priced',1,?)`).run(STAMP);
  raw.prepare(`INSERT INTO procurement_line_allocations(id,purchase_id,purchase_line_id,position,cost_center_id,cost_center,amount_minor,currency,basis,purchase_version,created_at)
    VALUES('allocation-136','purchase-136','line-136',1,'cc-136','CC-136',10000,'SAR','purchase_budget',1,?)`).run(STAMP);
  raw.prepare("UPDATE procurement_purchases SET status='sourcing',version=2,updated_at=? WHERE id='purchase-136'").run(STAMP);
  raw.prepare(`INSERT INTO procurement_quotes(id,purchase_id,supplier_key,supplier_name,unit_price_minor,total_minor,technical_assessment,financial_terms,delivery_date,evidence,created_by,created_at)
    VALUES('quote-136','purchase-136','SUPPLIER-136','مورد ترحيل مصطنع',1250,6250,'مطابق فنيًا','بعد الاستلام','2026-12-01','عرض قديم مصطنع','employee',?)`).run(STAMP);
  const before=JSON.stringify(raw.prepare("SELECT * FROM procurement_quotes WHERE id='quote-136'").get());
  const audit=raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  raw.close();
  return {path,before,audit};
}

test('الترحيل 141: العرض القديم يصبح له سعر بند دون تغيير رأسه أو اختلاق حدث بشري',t=>{
  const {path,before,audit}=pre141(t);
  const db=openDb(path);
  t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=141').get(),'طُبق الترحيل 141');
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM procurement_quotes WHERE id='quote-136'").get()),before,'رأس العرض لم يتغير');
  const line=db.prepare("SELECT * FROM procurement_quote_lines WHERE quote_id='quote-136'").get();
  assert.equal(line.purchase_line_id,'line-136');
  assert.equal(line.quantity,5);
  assert.equal(line.unit_price_minor,1250);
  assert.equal(line.total_minor,6250);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,audit,'الترحيل لا ينتحل فاعلًا بشريًا');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
