// الترحيل 129: جدول مفتاح تفعيل الخدمة وإخفائها — 22 سبتمبر 2026.
//
// الترحيل يضيف جدولًا جديدًا ولا يعيد بناء شيئًا ولا يُدرج صفًّا: أخفّ الترحيلات أثرًا، وما يجب أن يثبت فيه
// هو بالضبط أنه كذلك — قاعدة قائمة عليها خدمات وطلبات ومزايا تُفتح على 129 فلا يتغير فيها صف، ولا تُكسر
// إحالة، ولا يُكتب حدث تدقيق باسم الترحيل، وتبدأ كل خدمة وكل ميزة «متاحة» لأن الغياب هو الافتراض.
//
// ولماذا جدول مستقل لا عمود في services: صفوف الخدمة نسخٌ لا تُعدَّل ولا تُحذف (القادحان
// service_no_update وservice_no_delete في app/schema.sql)، فـ«UPDATE services SET active=0» يُجهَض.
// هذا مثبَّت هنا بنصه، لأنه سبب وجود الجدول لا حاشية عليه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { setAvailability, stateOf } from '../app/service-availability.mjs';

const STAMP='2026-09-22T09:00:00.000Z';
const read=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8');

// قاعدة كما كانت قبل 129 بالضبط: المخطط وكل ترحيل دونه، ثم بذرة تجريبية بخدماتها الثلاث.
function pre129(t){
  const dir=mkdtempSync(join(tmpdir(),'pre129-')),path=join(dir,'pre129.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=read('schema.sql');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=129)continue;
    const sql=read('migrations/'+file);
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-129');
  // الجدول غير موجود قبل الترحيل: هذا ما يفتحه 129 ولا شيء غيره.
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='service_availability'").get().n,0,'قبل 129 لا جدول');
  const before={
    services:JSON.stringify(raw.prepare('SELECT * FROM services ORDER BY id').all()),
    benefits:JSON.stringify(raw.prepare('SELECT benefit_key,revision,status FROM benefit_catalog ORDER BY benefit_key,revision').all()),
    directory:JSON.stringify(raw.prepare('SELECT * FROM service_directory ORDER BY service_code').all()),
    audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n};
  raw.close();
  return {path,before};
}

test('الترحيل 129: قاعدة من قبله تُفتح في مكانها، فلا صف يتغير ولا إحالة تُكسر، والجدول يبدأ فارغًا', t=>{
  const {path,before}=pre129(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=129').get(),'openDb طبّق 129');

  // لا صف تغيّر في الجداول التي يمسّها المفتاح قراءةً.
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM services ORDER BY id').all()),before.services,'الخدمات كما هي، عمودًا بعمود');
  assert.equal(JSON.stringify(db.prepare('SELECT benefit_key,revision,status FROM benefit_catalog ORDER BY benefit_key,revision').all()),before.benefits,'المزايا كما هي');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM service_directory ORDER BY service_code').all()),before.directory,'دليل الأقسام كما هو');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'والترحيل لا يكتب حدث تدقيق باسمه');

  // الجدول الجديد فارغ: الافتراضي بلا صف «متاحة»، فلا خدمة تغيّرت حالتها بالترقية.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_availability').get().n,0,'الترحيل لا يُدرج صفًّا واحدًا');
  assert.equal(stateOf(db,'36t','service','IT-SUPPORT'),'available');
  assert.equal(stateOf(db,'36t','benefit','air_ticket'),'available');

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'لا إحالة مكسورة');
});

test('الترحيل 129: الجدول إلحاقي في القاعدة نفسها، ويرفض التكرار والقيم خارج قائمته', t=>{
  const {path}=pre129(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  const reason='تجريبي: قرار مصطنع لاختبار الترحيل 129 وحده';
  transaction(db,()=>setAvailability(db,admin,{kind:'service',target_key:'IT-SUPPORT',state:'hidden',reason}));

  // إلحاقي: لا تعديل ولا حذف، ولو من SQL خام.
  assert.throws(()=>db.prepare("UPDATE service_availability SET state='available' WHERE target_key='IT-SUPPORT'").run(),/append only/);
  assert.throws(()=>db.prepare("DELETE FROM service_availability WHERE target_key='IT-SUPPORT'").run(),/append only/);
  // وصفٌّ لا يغيّر شيئًا يُردّ في القاعدة كما يُردّ في الوحدة، فلا يمتلئ السجل بإخفاءٍ فوق إخفاء.
  const insert="INSERT INTO service_availability(tenant_id,kind,target_key,state,reason,decided_by,decided_at) VALUES('36t',?,?,?,?,'admin',?)";
  assert.throws(()=>db.prepare(insert).run('service','IT-SUPPORT','hidden',reason,STAMP),/already the current state/);
  // والقيم خارج القائمة مرفوضة: STRICT وCHECK يحرسان النوع والحالة وطول السبب.
  assert.throws(()=>db.prepare(insert).run('screen','IT-SUPPORT','hidden',reason,STAMP),/CHECK/);
  assert.throws(()=>db.prepare(insert).run('service','HR-LETTER','off',reason,STAMP),/CHECK/);
  assert.throws(()=>db.prepare(insert).run('service','HR-LETTER','hidden','لا',STAMP),/CHECK/);
  // ومن قرر لا بد أن يكون حسابًا قائمًا في الكيان نفسه.
  assert.throws(()=>db.prepare("INSERT INTO service_availability(tenant_id,kind,target_key,state,reason,decided_by,decided_at) VALUES('36t','service','HR-LETTER','hidden',?,'no-such-user',?)").run(reason,STAMP),/FOREIGN KEY/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('الترحيل 129: صف الخدمة يبقى غير قابل للتعديل، وهو سبب وجود الجدول المستقل', t=>{
  const {path}=pre129(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  // لو كان المفتاح عمودًا في services لكان هذا هو نداؤه — وهو مُجهَض في القاعدة.
  assert.throws(()=>db.prepare("UPDATE services SET active=0 WHERE code='IT-SUPPORT'").run(),/create a new service version/);
  assert.throws(()=>db.prepare("DELETE FROM services WHERE code='IT-SUPPORT'").run(),/service versions are immutable/);
  // والجدول لا يحمل مفتاحًا أجنبيًا إلى services: رمز الخدمة ليس فريدًا فيها (فريدها tenant_id+code+version)،
  // فالمفتاح يُمسك بالرمز كما يفعل service_directory قبله، ويحتمل رمزًا بلا صف.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_list('service_availability') WHERE \"table\"='services'").get().n,0);
});
