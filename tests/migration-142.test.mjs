import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb,hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

const STAMP='2026-09-24T08:00:00.000Z';

function pre142(t){
  const directory=mkdtempSync(join(tmpdir(),'pre142-')),path=join(directory,'pre142.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(name=>/^\d{3}-.+\.sql$/.test(name)).sort()){
    const version=Number(file.slice(0,3));if(version===142)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-142');
  raw.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('legacy-ops-head','36t','ops','legacy-ops-head','مدير تشغيل لسجل قديم','unused-test-hash','manager',NULL)").run();
  raw.prepare("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('legacy-project','36t','مشروع مشاركة قديم','بيانات مصطنعة لا غير','manager',?)").run(STAMP);
  raw.prepare("INSERT INTO project_members(project_id,user_id) VALUES('legacy-project','manager')").run();
  raw.prepare(`INSERT INTO project_departments(project_id,department_id,tenant_id,basis,requested_by,requested_at,approved_by,approved_at)
    VALUES('legacy-project','ops','36t','سجل مشاركة أُنشئ قبل مسار القرار الإلكتروني','manager',?,'legacy-ops-head',?)`).run(STAMP,STAMP);
  const before=raw.prepare(`SELECT project_id,department_id,tenant_id,basis,requested_by,requested_at,approved_by,approved_at
    FROM project_departments WHERE project_id='legacy-project'`).get();
  const audit=raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;raw.close();
  return {path,before,audit};
}

test('الترحيل 142 بعد 153 يحفظ روابط الإدارات السابقة ويصف مصدرها من دون اختلاق قرار أو حدث بشري',t=>{
  const {path,before,audit}=pre142(t),db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=142').get(),'طُبق الترحيل 142');
  const after=db.prepare(`SELECT project_id,department_id,tenant_id,basis,requested_by,requested_at,approved_by,approved_at
    FROM project_departments WHERE project_id='legacy-project'`).get();
  assert.deepEqual(after,before,'قيم السجل السابق لم تتغير');
  const provenance=db.prepare("SELECT approval_source,request_id FROM project_departments WHERE project_id='legacy-project'").get();
  assert.equal(provenance.approval_source,'legacy_declared');
  assert.equal(provenance.request_id,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_department_requests').get().n,0,'لم يُختلق طلب قرار قديم');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,audit,'الترحيل لا ينتحل فاعلًا بشريًا');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
