import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb,hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

const STAMP='2026-09-24T08:00:00.000Z';
const ARCHIVED_HASHES=new Map([
  [135,'3e11dec9a22da75eae9873bbf2bdd54e80334a83cd25d3df289fed77923fa9c4'],
  [137,'f7bffa8520fa937af33df4f1df67063e401d118129f8f9273e5494318a8cdf64'],
  [138,'86090f7034f21f6e93243bdd3de05fbbc7e3ab455b1338ae84f586a07d15a71a']
]);

function apply(raw,version,sql) {
  raw.exec('BEGIN');
  try {
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));
    raw.exec('COMMIT');
  } catch(error) {
    raw.exec('ROLLBACK');
    throw error;
  }
}

function archivedIntegrationDatabase(t) {
  const directory=mkdtempSync(join(tmpdir(),'a0d7898-procurement-upgrade-'));
  const path=join(directory,'synthetic-a0d7898.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version=Number(file.slice(0,3));
    if(version>=135)continue;
    apply(raw,version,readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8'));
  }
  seed(raw,'synthetic-a0d7898-upgrade-test-only');
  for(const file of readdirSync(new URL('./fixtures/a0d7898-migrations/',import.meta.url)).sort()) {
    const version=Number(file.slice(0,3));
    const sql=readFileSync(new URL('./fixtures/a0d7898-migrations/'+file,import.meta.url),'utf8');
    assert.equal(hash(sql),ARCHIVED_HASHES.get(version),`بصمة الترحيل المؤرشف ${version} تطابق a0d7898`);
    apply(raw,version,sql);
  }
  raw.prepare("INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES('cc-live-upgrade','36t','CC-LIVE-UPGRADE','مركز اختبار ترقية مصطنع',1,'admin',?)").run(STAMP);
  raw.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('project-live-upgrade','36t','مشروع ترقية مصطنع','لا بيانات حقيقية في هذا الأرشيف','manager',?)").run(STAMP);
  raw.prepare("INSERT INTO project_members(project_id,user_id) VALUES('project-live-upgrade','manager'),('project-live-upgrade','employee')").run();
  raw.prepare(`INSERT INTO procurement_purchases(id,tenant_id,project_id,requester_id,title,specification,cost_center,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at,cost_center_id)
    VALUES('purchase-live-upgrade','36t','project-live-upgrade','employee','احتياج قبل ترقية 140','أربع وحدات محفوظة في أرشيف تكامل مصطنع','CC-LIVE-UPGRADE','2026-12-01',4,'وحدة','SAR',10000,'مخصص مصطنع محفوظ','draft',1,?,?, 'cc-live-upgrade')`).run(STAMP,STAMP);
  raw.prepare("UPDATE procurement_purchases SET status='sourcing',version=2,updated_at=? WHERE id='purchase-live-upgrade'").run(STAMP);
  raw.prepare(`INSERT INTO procurement_quotes(id,purchase_id,supplier_key,supplier_name,unit_price_minor,total_minor,technical_assessment,financial_terms,delivery_date,evidence,created_by,created_at)
    VALUES('quote-live-upgrade','purchase-live-upgrade','SUPPLIER-LIVE-UPGRADE','مورد ترقية مصطنع',1250,5000,'مطابق فنيًا','بعد الاستلام','2026-12-01','عرض مصطنع محفوظ','employee',?)`).run(STAMP);
  const audit=raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  raw.close();
  return {path,audit};
}

test('الترحيلان 140/141: يترقيان فوق أرشيف a0d7898 المسجل فيه 135 و137 و138 دون تخطي أساس البنود',t=>{
  const {path,audit}=archivedIntegrationDatabase(t);
  const db=openDb(path);
  t.after(()=>{try{db.close();}catch{}});
  const versions=new Map(db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all().map(row=>[row.version,row.checksum]));
  for(const [version,checksum] of ARCHIVED_HASHES)assert.equal(versions.get(version),checksum,`ظل الترحيل الحي ${version} ببصمته`);
  assert.ok(versions.has(140),'طُبق أساس البنود بعد الترحيلات الحية');
  assert.ok(versions.has(141),'طُبقت الدورة متعددة البنود بعد الأساس');
  assert.equal(versions.has(139),false,'لم يُستخدم الرقم القديم');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='payroll_deduction_basis_consent_owner_insert'").get(),'حارس م51 المؤرشف باقٍ');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_gate'").get(),'بوابات الخدمة المؤرشفة باقية');
  const line=db.prepare("SELECT * FROM procurement_purchase_lines WHERE purchase_id='purchase-live-upgrade'").get();
  assert.equal(line.quantity,4);
  assert.equal(line.unit_price_minor,null);
  const quoteLine=db.prepare("SELECT * FROM procurement_quote_lines WHERE quote_id='quote-live-upgrade'").get();
  assert.equal(quoteLine.purchase_line_id,line.id);
  assert.equal(quoteLine.unit_price_minor,1250);
  assert.equal(quoteLine.total_minor,5000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,audit,'ترقية المخطط لا تنتحل فاعلًا بشريًا');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
