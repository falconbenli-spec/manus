// الترحيل 131: جداول شجرة مركز الخدمات — 22 سبتمبر 2026.
//
// على نمط tests/migration-129.test.mjs حرفيًا: قاعدة كما كانت قبل 131 بالضبط (المخطط وكل ترحيل دونه،
// ثم بذرة تجريبية)، تُفتح بـopenDb في مكانها، فيُقاس ما تغيّر. وما يجب أن يثبت هنا أن الترحيل **أخفّ
// مما يبدو**: ثمانية جداول جديدة فارغة، وأربعة أعمدة على جدولٍ فيه صفر صف، وقادحٌ واحد يُسقَط ويُعاد
// بناؤه أوسع مما كان — ولا صفَّ واحد يتغيّر في services ولا requests ولا service_directory ولا
// benefit_catalog ولا service_availability، ولا حدث تدقيق باسم الترحيل.
//
// وثلاثة من تأكيداته ليست زينة:
//   • **بندٌ من نوع module** (HR-LEAVE، ولا صفَّ له في services) يُوضع في فئة بلا كسر إحالة — وهو
//     الاختبار الذي يمنع سقوط البند الثالث والأربعين بعد المئة، وهو ما يسقط في كل تنفيذ يبني على
//     services وحدها.
//   • **القادح المعاد بناؤه** يرفض تغيير شرط أهلية على بطاقة منشورة. إغفاله كان يفتح الباب الوحيد
//     الذي يسمح بتغيير قاعدة أهلية منشورة بلا نسخة جديدة.
//   • **خدمةٌ أُخفيت بـ129 تبقى مخفيةً بعد 131**: تركيب الشرطين في visibleSql لا يفتح ما أغلقه المالك.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { setAvailability } from '../app/service-availability.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';

const STAMP='2026-09-22T09:00:00.000Z';
const read=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8');
const NEW_TABLES=['catalog_placement','service_synonyms','catalog_search_log','journey_runs','journey_run_steps',
  'catalog_preferences','catalog_hidden_suggestions','catalog_projection_state'];

// قاعدة كما كانت قبل 131 بالضبط: المخطط وكل ترحيل دونه، ثم بذرة تجريبية بخدماتها الثلاث.
function pre131(t){
  const dir=mkdtempSync(join(tmpdir(),'pre131-')),path=join(dir,'pre131.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=read('schema.sql');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=131)continue;
    const sql=read('migrations/'+file);
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-131');
  for(const table of NEW_TABLES)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?").get(table).n,0,`قبل 131 لا جدول ${table}`);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('service_cards') WHERE name='eligibility_rules'").get().n,0,'ولا عمود أهلية');
  const before={
    services:JSON.stringify(raw.prepare('SELECT * FROM services ORDER BY id').all()),
    directory:JSON.stringify(raw.prepare('SELECT * FROM service_directory ORDER BY service_code').all()),
    requests:JSON.stringify(raw.prepare('SELECT * FROM requests ORDER BY id').all()),
    benefits:JSON.stringify(raw.prepare('SELECT benefit_key,revision,status FROM benefit_catalog ORDER BY benefit_key,revision').all()),
    availability:JSON.stringify(raw.prepare('SELECT * FROM service_availability ORDER BY seq').all()),
    cards:raw.prepare('SELECT COUNT(*) AS n FROM service_cards').get().n,
    audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n};
  raw.close();
  return {path,before};
}

test('الترحيل 131: قاعدة من قبله تُفتح في مكانها، فلا صف يتغير ولا إحالة تُكسر، والجداول الثمانية تبدأ فارغة', t=>{
  const {path,before}=pre131(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=131').get(),'openDb طبّق 131');

  assert.equal(JSON.stringify(db.prepare('SELECT * FROM services ORDER BY id').all()),before.services,'الخدمات كما هي، عمودًا بعمود');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM service_directory ORDER BY service_code').all()),before.directory,'دليل الأقسام كما هو');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM requests ORDER BY id').all()),before.requests,'الطلبات كما هي');
  assert.equal(JSON.stringify(db.prepare('SELECT benefit_key,revision,status FROM benefit_catalog ORDER BY benefit_key,revision').all()),before.benefits,'المزايا كما هي');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM service_availability ORDER BY seq').all()),before.availability,'سجل المفتاح كما هو');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'والترحيل لا يكتب حدث تدقيق باسمه');
  assert.ok(verifyAudit(db),'وسلسلة التدقيق المبصومة سليمة بعده');

  for(const table of NEW_TABLES)
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`${table}: الترحيل لا يُدرج صفًّا واحدًا`);
  // أربعة أعمدة على جدولٍ فيه صفر صف، فالإضافة لا تلمس بيانات أحد.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_cards').get().n,before.cards);
  const columns=db.prepare("SELECT name,dflt_value FROM pragma_table_info('service_cards')").all();
  for(const [name,value] of [['short_description',"''"],['eligibility_rules',"'{}'"],['required_documents',"'[]'"],['faq',"'[]'"]])
    assert.equal(columns.find(c=>c.name===name)?.dflt_value,value,`${name}: عمود جديد بقيمته الافتراضية`);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'لا إحالة مكسورة');
  // لا مفتاح أجنبي إلى services من أي جدول جديد: رمز الخدمة ليس فريدًا فيها، ومن يربط بـservices.id
  // يربط بنسخةٍ لا بخدمة. الاختبار نفسه الموجود في 129.
  for(const table of NEW_TABLES)
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM pragma_foreign_key_list('${table}') WHERE "table"='services'`).get().n,0,`${table}: لا مفتاح أجنبي إلى services`);

  // الفتح مرتين لا يغيّر البصمات.
  const digests=JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());
  db.close();
  const again=openDb(path);t.after(()=>{try{again.close();}catch{}});
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),digests,'الفتح مرتين لا يغيّر البصمات');
});

test('الترحيل 131: القيود ترفض ما لم يُعلَن، والسجلات الإلحاقية إلحاقية في القاعدة نفسها', t=>{
  const {path}=pre131(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const place=(audience,kind,key,category,extra='')=>db.prepare(
    `INSERT INTO catalog_placement(tenant_id,audience,item_kind,item_key,category_key,release_version,projected_at${extra?',browse':''}) VALUES('36t',?,?,?,?,0,?${extra?',?':''})`);

  // CHECK ترفض جمهورًا خارج الأربعة، ونوعًا خارج الأربعة، وbrowse خارج الصفر والواحد.
  assert.throws(()=>place().run('partner','service','HR-LETTER','my_time',STAMP),/CHECK/);
  assert.throws(()=>place().run('employee','screen','HR-LETTER','my_time',STAMP),/CHECK/);
  assert.throws(()=>place('','','','',',browse').run('employee','service','HR-LETTER','my_time',STAMP,2),/CHECK/);
  assert.throws(()=>place().run('employee','service','HR-LETTER','My_Time',STAMP),/CHECK/,'مفتاح الفئة أحرف صغيرة وشرطة سفلية');

  // **البند الثالث والأربعون بعد المئة**: نوع module لا صفَّ له في services، ويُوضع في فئة بلا كسر إحالة.
  place().run('employee','module','HR-LEAVE','my_time',STAMP);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM services WHERE code='HR-LEAVE'").get().n,0,'ولا صفَّ له في services أصلًا');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'ومع ذلك لا إحالة مكسورة');
  // والمفتاح يمنع الصف الثاني للبند نفسه في الجمهور نفسه: خدمةٌ في فئتين مستحيلة في القاعدة لا في الأدب.
  assert.throws(()=>place().run('employee','module','HR-LEAVE','my_pay',STAMP),/UNIQUE|PRIMARY/);

  // سجل البحث إلحاقي، ويحمل سؤالًا وعددًا في حدث البحث وبندًا في حدثي الفتح والتقديم.
  const log="INSERT INTO catalog_search_log(tenant_id,search_id,event,audience,query_normalized,result_count,item_kind,item_key,at) VALUES('36t',?,?,?,?,?,?,?,?)";
  const sid='a'.repeat(32);
  db.prepare(log).run(sid,'searched','employee','اجازه',0,null,null,STAMP);
  assert.throws(()=>db.prepare(log).run(sid,'searched','employee','',null,null,null,STAMP),/CHECK/,'بحثٌ بلا سؤال ولا عدد مرفوض');
  assert.throws(()=>db.prepare(log).run(sid,'opened','employee','',null,null,null,STAMP),/CHECK/,'وفتحٌ بلا بند مرفوض');
  assert.throws(()=>db.prepare("UPDATE catalog_search_log SET event='opened'").run(),/append only/);
  assert.throws(()=>db.prepare('DELETE FROM catalog_search_log').run(),/append only/);
  assert.throws(()=>db.prepare(log).run('short','searched','employee','اجازه',0,null,null,STAMP),/CHECK/,'ومعرّف البحث اثنان وثلاثون حرفًا');

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('الترحيل 131: الرحلة المنفَّذة تحفظ ما مشت عليه، وخطوةٌ لم تُنفَّذ تقول سببها', t=>{
  const {path}=pre131(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  const service=db.prepare("SELECT id FROM services WHERE code='IT-SUPPORT'").get().id;
  const request=(id,requester)=>db.prepare(`INSERT INTO requests(id,tenant_id,service_id,requester_id,title,payload,status,created_at,updated_at)
    VALUES(?,'36t',?,?,'طلب تجريبي لاختبار الترحيل 131','{}','draft',?,?)`).run(id,service,requester,STAMP,STAMP);
  request('req-parent','employee');request('req-child','employee');request('req-other','employee');
  db.prepare(`INSERT INTO journey_runs(id,tenant_id,journey_key,definition_version,parent_request_id,requester_id,status,started_at)
    VALUES('run-1','36t','new_joiner',0,'req-parent','employee','open',?)`).run(STAMP);
  // رحلةٌ مشت لا تُمحى، ولا يُعاد إسنادها إلى طلبٍ آخر.
  assert.throws(()=>db.prepare("DELETE FROM journey_runs WHERE id='run-1'").run(),/retained/);
  assert.throws(()=>db.prepare("UPDATE journey_runs SET parent_request_id='req-other' WHERE id='run-1'").run(),/keeps the request/);
  // وطلبٌ أب واحد لرحلة واحدة: لا تُولَّد الرحلة مرتين من زرٍّ ضُغط مرتين.
  assert.throws(()=>db.prepare(`INSERT INTO journey_runs(id,tenant_id,journey_key,definition_version,parent_request_id,requester_id,status,started_at)
    VALUES('run-2','36t','new_joiner',0,'req-parent','employee','open',?)`).run(STAMP),/UNIQUE/);

  const step=(position,outcome,reason,child)=>db.prepare(`INSERT INTO journey_run_steps(run_id,position,tenant_id,step_key,item_kind,item_key,outcome,condition_json,reason,child_request_id,created_at)
    VALUES('run-1',?, '36t','it_account','service','IT-NEW-ACCOUNT',?,'{}',?,?,?)`).run(position,outcome,reason,child,STAMP);
  step(1,'created','','req-child');
  assert.throws(()=>step(2,'created','','req-child'),/UNIQUE/,'الطلب الواحد ابنٌ لخطوة واحدة على الأكثر');
  assert.throws(()=>step(3,'created','',null),/CHECK/,'وcreated بلا طلب ابن مرفوض');
  assert.throws(()=>step(4,'skipped','',null),/CHECK/,'وskipped بلا سبب مكتوب مرفوض');
  step(5,'skipped','لم يتحقق شرط الخطوة: الموظف بلا جهاز مخصص',null);
  assert.throws(()=>db.prepare("DELETE FROM journey_run_steps WHERE run_id='run-1'").run(),/retained/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(admin);
});

test('الترحيل 131: القادح المعاد بناؤه يحرس الأعمدة الأربعة على البطاقة المنشورة', t=>{
  const {path}=pre131(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  db.prepare(`INSERT INTO service_cards(id,tenant_id,service_code,revision,owner_id,service_kind,confidentiality,status,effective_from,prepared_by,published_by,published_at,version,created_at,updated_at,eligibility_rules)
    VALUES('card-1','36t','IT-SUPPORT',1,'it','institutional','internal','published','2026-09-01','hr','manager',?,1,?,?,'{"years_of_service":1}')`).run(STAMP,STAMP,STAMP);
  // البطاقة المنشورة تُستبدل بنسخة جديدة لا تُعدَّل: التحويل إلى superseded مسموح، وتغيير شرط الأهلية معه ممنوع.
  assert.throws(()=>db.prepare("UPDATE service_cards SET status='superseded',version=2,eligibility_rules='{}' WHERE id='card-1'").run(),
    /replaced by a new revision/,'تغيير شرط أهلية منشور بلا نسخة جديدة مرفوض — وهذا هو الباب الذي أغلقه إعادةُ بناء القادح');
  assert.throws(()=>db.prepare("UPDATE service_cards SET status='superseded',version=2,faq='[{\"q\":\"س\"}]' WHERE id='card-1'").run(),/replaced by a new revision/);
  db.prepare("UPDATE service_cards SET status='superseded',version=2 WHERE id='card-1'").run();
  assert.equal(db.prepare("SELECT status FROM service_cards WHERE id='card-1'").get().status,'superseded','وما لم يتغيّر فيه شيء يمرّ كما كان');
});

test('الترحيل 131: خدمةٌ أُخفيت بـ129 تبقى مخفيةً بعده، وتركيب الشرطين لا يفتح ما أغلقه المالك', t=>{
  const {path}=pre131(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  transaction(db,()=>setAvailability(db,admin,{kind:'service',target_key:'IT-SUPPORT',state:'hidden',reason:'تجريبي: قرار مصطنع لاختبار الترحيل 131 وحده'}));
  assert.equal(catalog(db,employee).some(s=>s.code==='IT-SUPPORT'),false,'قبل الإسقاط: موقوفة فلا تُعرض');
  installServiceCatalog(db);
  assert.equal(catalog(db,employee).some(s=>s.code==='IT-SUPPORT'),false,'وبعد الإسقاط: ما زالت موقوفة، والإسناد لا يعيدها');
  assert.ok(catalog(db,employee).some(s=>s.code==='HR-LETTER'),'وما لم يُمسّ باقٍ كما هو');
  // وهي مُسنَدة في الشجرة رغم إيقافها: الإيقاف قرارٌ يُرفع، والإسناد حقيقةٌ في الشجرة لا تُمحى به.
  assert.ok(db.prepare("SELECT 1 FROM catalog_placement WHERE tenant_id='36t' AND item_key='IT-SUPPORT'").get(),'الموقوفة تبقى مُسنَدة فلا تُعدّ «بلا فئة»');
  assert.equal(db.prepare("SELECT items_unplaced FROM catalog_projection_state WHERE tenant_id='36t'").get().items_unplaced,0);
  assert.ok(verifyAudit(db),'وسلسلة التدقيق سليمة بعد التثبيت والإسقاط');
});
