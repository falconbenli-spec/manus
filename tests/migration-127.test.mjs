import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

// الترحيل 127 يعيد بناء regulation_policies ليضيف نوع «التأمينات الاجتماعية»، والجدول له أربعة أبناء
// (based_on الذاتي، والاستقالات، وسند المخالصة، وقرارات الانتداب). إعادة بناء جدول له أبناء أخطر ما في
// الترحيلات، فيُختبر على قاعدة من قبله فيها صف مقبول للكيان وابن يحيل إليه.
const STAMP='2026-09-21T09:00:00.000Z';

function pre127(t){
  const dir=mkdtempSync(join(tmpdir(),'pre127-')),path=join(dir,'pre127.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=127)continue;
    const sql=readFileSync(new URL('../app/migrations/'+file,import.meta.url),'utf8');
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-127');
  // صف مقبول للكيان مبني على مستخرج مزروع، وابن يحيل إليه: هذان ما تكسره إعادة البناء إن أُخطئت.
  raw.prepare(`INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,based_on,effective_from,decided_by,decided_at,decision_note,created_at)
    VALUES('reg-pre127','36t','resignation','الاستقالة المقبولة قبل الترحيل','["م34/1"]','لائحة تنظيم العمل المصطنعة للاختبار','نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',
    '{"deemed_after_days":30,"deferral_max_days":60,"deferral_anchor":"submission","authority_capability":"hr.contracts.approve","block_during_investigation":true}','[]','accepted','reg-seed-resignation','2026-01-01','manager',?,'إقرار مصطنع بمطابقة القيم قبل الترحيل',?)`).run(STAMP,STAMP);
  raw.prepare(`INSERT INTO resignations(id,tenant_id,user_id,letter_date,submitted_on,reason,proposed_last_day,status,policy_id,created_at,updated_at)
    VALUES('resign-pre127','36t','employee','2026-02-01','2026-02-01','سبب استقالة مصطنع','2026-03-05','submitted','reg-pre127',?,?)`).run(STAMP,STAMP);
  const before={policies:raw.prepare('SELECT * FROM regulation_policies ORDER BY id').all(),
    resignation:JSON.stringify(raw.prepare('SELECT * FROM resignations').all()),
    audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n};
  // النوع الجديد مرفوض قبل الترحيل: هذا ما يفتحه.
  assert.match(raw.prepare("SELECT sql FROM sqlite_master WHERE name='regulation_policies'").get().sql,/'travel_per_diem'\)\)/);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('payroll_lines') WHERE name='employer_insurance_minor'").get().n,0);
  raw.close();
  return {path,before};
}

test('migration 127: a database with an adopted regulation policy and a child pointing at it upgrades in place, keeps every row, and opens the table to the social-insurance kind',t=>{
  const {path,before}=pre127(t),db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=127').get(),'127 is applied by openDb');
  const after=db.prepare("SELECT * FROM regulation_policies WHERE kind<>'social_insurance' ORDER BY id").all();
  assert.deepEqual(after,before.policies,'every carried row is unchanged, column for column');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM resignations').all()),before.resignation,'the child is untouched');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'the migration writes no audit event of its own');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE name='regulation_policies_carry'").get().n,0,'the carry table is gone');
  // المستخرج الجديد مزروع مسودةً بلا كيان وبلا مُعد بشري، وباختياره المعلق.
  const seededRow=db.prepare("SELECT * FROM regulation_policies WHERE id='reg-seed-social-insurance'").get();
  assert.equal(seededRow.tenant_id,null);assert.equal(seededRow.status,'draft');assert.equal(seededRow.prepared_by,null);
  assert.deepEqual(JSON.parse(seededRow.pending_choices),['partial_month_basis']);
  assert.equal(seededRow.created_at,'2026-09-22T00:00:00.000Z','طابع زمني حرفي: ساعة SQL لا تدخل بصمات الشاشات');
  const parameters=JSON.parse(seededRow.parameters);
  assert.deepEqual(Object.keys(parameters.cases),['saudi_previous_law','saudi_new_entrant','non_saudi'],'ثلاث حالات لا رابعة: لا فرع خليجي');
  assert.equal(parameters.partial_month_basis,null,'المقسوم غير المتحقق منه يبقى بلا قيمة حتى يختاره مدير الموارد البشرية');
  assert.ok(parameters.open_questions.length>=5,'ما لم يُتحقق منه مكتوب سؤالًا مفتوحًا لا قيمةً');
  // الجدول قبل النوع الجديد، والمشغّلان والفهرس عادوا عليه.
  const sql=db.prepare("SELECT sql FROM sqlite_master WHERE name='regulation_policies'").get().sql;
  assert.match(sql,/'social_insurance'\)\)/);assert.match(sql,/\)\s*STRICT\s*$/);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='regulation_policies_live'").get());
  assert.throws(()=>db.prepare('DELETE FROM regulation_policies').run(),/retained/);
  assert.throws(()=>db.prepare("UPDATE regulation_policies SET parameters='{}' WHERE id='reg-seed-social-insurance'").run(),/never rewritten/);
  // الابن ما زال يحيل إلى الأب باسمه: قيد جديد يمر ويتيم يُرفض.
  const insert="INSERT INTO resignations(id,tenant_id,user_id,letter_date,submitted_on,reason,proposed_last_day,status,policy_id,created_at,updated_at) VALUES(?,'36t',?,'2026-02-01','2026-02-01','سبب استقالة مصطنع بعد الترحيل','2026-03-05','submitted',?,?,?)";
  db.prepare(insert).run('resign-after','outsider','reg-pre127',STAMP,STAMP);
  assert.throws(()=>db.prepare(insert).run('resign-orphan','it','no-such-policy',STAMP,STAMP),/FOREIGN KEY/);
  // العمود الجديد في سطور المسير: افتراضه صفر، ولا يدخل معادلة الصافي، ومشغّل القفل صار يسمّيه.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('payroll_lines') WHERE name='employer_insurance_minor'").get().n,1);
  // افتراضه صفر: إدراج خام لا يسمّي العمود (كما في اختبارات الدفتر) يمضي كما كان.
  const column=db.prepare("SELECT * FROM pragma_table_info('payroll_lines') WHERE name='employer_insurance_minor'").get();
  assert.equal(column.dflt_value,'0');assert.equal(column.notnull,1);
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_lines'").get().sql,
    /net_minor=[^)]*employer_insurance_minor/,'حصة المنشأة خارج معادلة الصافي: تكلفة لا خصم');
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_lines_locked_update'").get().sql,/employer_insurance_minor/);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='payroll_lines_locked_update'").get().sql,/social_insurance_minor/);
  // الجدولان الجديدان بمشغّلاتهما.
  for(const table of ['employee_insurance_overrides','payroll_pay_date_decisions'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),table+' exists');
  const checksums=JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());db.close();
  const again=openDb(path);t.after(()=>{try{again.close();}catch{}});
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),checksums,'a second start applies nothing');
  assert.deepEqual(again.prepare('PRAGMA foreign_key_check').all(),[]);
});
