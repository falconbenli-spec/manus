// الترحيل 134: جداول الخيارات المُدارة، وعمود معرّف مركز التكلفة على المشتريات والمخصصات — 23 سبتمبر 2026.
//
// ما يجب أن يثبت هنا هو **أن اليوم الأول لا يتغيّر**: قاعدة قائمة عليها مشتريات ومخصصات وموردون وربط محاسبي
// تُفتح على 134، فلا صفّ يتغيّر عمودًا بعمود، ولا حدث تدقيق يُكتب باسم الترحيل، والجداول الثلاثة تبدأ فارغة،
// والطلب الذي أُنشئ قبل الترحيل يبقى محجوزًا على صفّ المخصص نفسه.
//
// والكتابة الوحيدة المصرَّح بها: ملء cost_center_id حيث طابق **مركز نشط واحد لا غير**. الملتبس وغير المطابق
// يبقيان NULL — لأن تخمين مركز التكلفة هو بالضبط العيب الذي جاء الترحيل ليقفله، فلا يُفتتح بتخمين أوسع منه.
//
// الصفوف هنا مُدرَجة بـSQL خام قصدًا: كود ما بعد 134 يكتب العمود الجديد، فلا يمكن أن يبني قاعدة ما قبله.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

const STAMP='2026-09-23T09:00:00.000Z';
const read=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8');
// الأعمدة كما كانت قبل 134 بالحرف: المقارنة «عمودًا بعمود» لا تُقارن العمود الذي أضافه الترحيل نفسه.
const PURCHASE_COLUMNS='id,tenant_id,project_id,requester_id,title,specification,cost_center,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at';
const BUDGET_COLUMNS='id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,approved_by,status,revision,version,created_at,updated_at';

function pre134(t,{collide=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'pre134-')),path=join(dir,'pre134.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const raw=new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema=read('schema.sql');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()){
    const version=Number(file.slice(0,3));if(version>=134)continue;
    const sql=read('migrations/'+file);
    raw.exec('BEGIN');raw.exec(sql);raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,hash(sql));raw.exec('COMMIT');
  }
  seed(raw,'synthetic-pre-134');
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='option_values'").get().n,0,'قبل 134 لا جدول خيارات');
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('procurement_purchases') WHERE name='cost_center_id'").get().n,0,'ولا عمود معرّف مركز');

  // بيانات تجريبية بالحرف: مركزان، مشروع، مخصص، أربعة طلبات شراء بأربع كتابات لمركز التكلفة، ومورد ووثيقته وربط محاسبي.
  raw.exec('BEGIN');
  const run=(sql,...args)=>raw.prepare(sql).run(...args);
  run("INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES('cc-mkt','36t','CC-MARKETING','مركز التسويق التجريبي',1,'admin',?)",STAMP);
  run("INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES('cc-old','36t','CC-OLD','مركز تجريبي غير نشط',0,'admin',?)",STAMP);
  run("INSERT INTO finance_accounts(id,tenant_id,code,name,account_type,currency,active,created_by,created_at) VALUES('acc-bank','36t','1010','البنك التجريبي','asset','SAR',1,'admin',?)",STAMP);
  run("INSERT INTO finance_account_mappings(id,tenant_id,purpose,account_id,cost_center_id,effective_from,recorded_by,approved_by,approved_at,created_at) VALUES('map-bank','36t','bank','acc-bank','cc-mkt','2026-01-01','manager','admin',?,?)",STAMP,STAMP);
  run("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('prj-1','36t','مشروع تجريبي للترحيل 134','بيانات تجريبية لا غير','manager',?)",STAMP);
  run("INSERT INTO project_members(project_id,user_id) VALUES('prj-1','manager'),('prj-1','employee')");
  // المخصص يبدأ مسودة غير معتمدة (القادح project_budget_initial، الترحيل 010) ثم يُعتمد: المسار نفسه الذي يسلكه الكود.
  run("INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,approved_by,status,revision,version,created_at,updated_at) VALUES('bud-1','36t','prj-1','CC-MARKETING','SAR',1000000,'2026-01-01','2099-12-31','مخصص تجريبي','employee',NULL,'draft',1,1,?,?)",STAMP,STAMP);
  run("UPDATE project_budgets SET status='pending',version=version+1 WHERE id='bud-1'");
  run("INSERT INTO project_budget_decisions(budget_id,revision,actor_id,decision,snapshot,evidence,created_at) VALUES('bud-1',1,'manager','approve','{}','اعتماد تجريبي مستقل',?)",STAMP);
  run("UPDATE project_budgets SET status='active',approved_by='manager',version=version+1 WHERE id='bud-1'");
  // كل طلب شراء يبدأ مسودة بالنسخة الأولى (القادح procurement_initial، الترحيل 005)، ثم يتقدّم بتحديث — كما يفعل الكود.
  const purchase=(id,center,status)=>{
    run(`INSERT INTO procurement_purchases(${PURCHASE_COLUMNS}) VALUES(?,'36t','prj-1','employee','احتياج تجريبي','مواصفات تجريبية',?,'2026-12-01',1,'نسخة','SAR',10000,'دليل تجريبي','draft',1,?,?)`,id,center,STAMP,STAMP);
    if(status!=='draft')run('UPDATE procurement_purchases SET status=?,version=version+1 WHERE id=?',status,id);
  };
  purchase('pur-exact','CC-MARKETING','sourcing');      // يطابق مركزًا نشطًا واحدًا، وغادر المسودة
  purchase('pur-case','cc-marketing','draft');          // يطابقه بعد رفع الحروف، وهو تطبيع الكود نفسه
  purchase('pur-arabic','التسويق','draft');             // لا يطابق شيئًا: قرار إنسان لا تخمين
  purchase('pur-inactive','CC-OLD','draft');            // يطابق مركزًا غير نشط: لا يُملأ
  // الحجز يبدأ «محجوزًا» بيد غير طالب الشراء (القادح budget_reservation_insert)، ثم يصير التزامًا.
  run("INSERT INTO project_budget_reservations(purchase_id,budget_id,budget_revision,amount_minor,status,created_by,created_at,updated_at,version) VALUES('pur-exact','bud-1',1,10000,'reserved','manager',?,?,1)",STAMP,STAMP);
  run("UPDATE project_budget_reservations SET status='committed',version=version+1 WHERE purchase_id='pur-exact'");
  run("INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,legal_name_en,trade_name,entity_type,country,entity_ref,vat_number,categories,data_source,status,registered_by,created_at,updated_at) VALUES('ven-1','36t','V-0001','SUPPLIER-A','مورد تجريبي','','','company','SA','1010000009','300000000000003',?,'مصدر تجريبي','approved','manager',?,?)",JSON.stringify(['print_gifts']),STAMP,STAMP);
  run("INSERT INTO vendor_documents(id,vendor_id,kind,reference,verification,added_by,created_at) VALUES('doc-1','ven-1','commercial_registration','مرجع تجريبي محفوظ','verified','manager',?)",STAMP);
  // مخصّص ثانٍ على المركز نفسه بكتابة أخرى: يمرّ من UNIQUE(project_id,cost_center) لأن النصّين مختلفان حرفيًا،
  // ويتصادم مع الأول على المعرّف بعد الملء. هذه هي الحالة التي كانت تمنع فتح القاعدة كلها.
  if(collide)run("INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,approved_by,status,revision,version,created_at,updated_at) VALUES('bud-2','36t','prj-1','cc-marketing','SAR',500000,'2026-01-01','2099-12-31','مخصص تجريبي ثانٍ بكتابة أخرى للمركز','employee',NULL,'draft',1,1,?,?)",STAMP,STAMP);
  raw.exec('COMMIT');

  const snap=sql=>JSON.stringify(raw.prepare(sql).all());
  const before={
    purchases:snap(`SELECT ${PURCHASE_COLUMNS} FROM procurement_purchases ORDER BY id`),
    budgets:snap(`SELECT ${BUDGET_COLUMNS} FROM project_budgets ORDER BY id`),
    reservations:snap('SELECT * FROM project_budget_reservations ORDER BY purchase_id'),
    vendors:snap('SELECT * FROM vendors ORDER BY id'),
    documents:snap('SELECT * FROM vendor_documents ORDER BY id'),
    mappings:snap('SELECT * FROM finance_account_mappings ORDER BY id'),
    centers:snap('SELECT * FROM finance_cost_centers ORDER BY id'),
    audit:raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n
  };
  raw.close();
  return {path,before};
}

test('الترحيل 134: قاعدة من قبله تُفتح في مكانها، فلا صفّ يتغيّر ولا حدث تدقيق يُكتب باسمه',t=>{
  const {path,before}=pre134(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=134').get(),'openDb طبّق 134');
  const snap=sql=>JSON.stringify(db.prepare(sql).all());

  // (أ) لا صفّ تغيّر في الجداول التي يمسّها الترحيل، عمودًا بعمود على أعمدة ما قبله.
  assert.equal(snap(`SELECT ${PURCHASE_COLUMNS} FROM procurement_purchases ORDER BY id`),before.purchases,'طلبات الشراء كما هي');
  assert.equal(snap(`SELECT ${BUDGET_COLUMNS} FROM project_budgets ORDER BY id`),before.budgets,'المخصصات كما هي');
  assert.equal(snap('SELECT * FROM project_budget_reservations ORDER BY purchase_id'),before.reservations,'الحجوزات كما هي');
  assert.equal(snap('SELECT * FROM vendors ORDER BY id'),before.vendors,'الموردون كما هم');
  assert.equal(snap('SELECT * FROM vendor_documents ORDER BY id'),before.documents,'وثائق الموردين كما هي');
  assert.equal(snap('SELECT * FROM finance_account_mappings ORDER BY id'),before.mappings,'الربط المحاسبي كما هو');
  assert.equal(snap('SELECT * FROM finance_cost_centers ORDER BY id'),before.centers,'مراكز التكلفة كما هي');
  // (ب) الترحيل لا يكتب حدثًا باسمه: من غيّر شيئًا هو إنسان، والترحيل ليس إنسانًا.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before.audit,'عدّ أحداث التدقيق كما هو');
  // (و) والسلسلة تبقى متصلة.
  assert.equal(verifyAudit(db),true,'سلسلة التدقيق سليمة بعد الترقية');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'لا إحالة مكسورة');
});

test('الترحيل 134: الجداول الثلاثة تبدأ فارغة — النسخة 0 هي افتراضات الكود',t=>{
  const {path}=pre134(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  for(const table of ['option_values','option_changes','option_adoptions'])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`${table} لا يبذره الترحيل`);
});

test('الترحيل 134: معرّف المركز يُملأ عند مطابقة واحدة لا غير، والملتبس يبقى قرارًا معلَّقًا',t=>{
  const {path}=pre134(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const center=id=>db.prepare('SELECT cost_center_id FROM procurement_purchases WHERE id=?').get(id).cost_center_id;
  assert.equal(center('pur-exact'),'cc-mkt','المطابقة الحرفية تُملأ');
  assert.equal(center('pur-case'),'cc-mkt','ورفع الحروف هو تطبيع الكود نفسه');
  assert.equal(center('pur-arabic'),null,'نصّ لا يطابق رمزًا يبقى NULL: قرار إنسان لا تخمين');
  assert.equal(center('pur-inactive'),null,'ومركز غير نشط ليس مطابقة');
  assert.equal(db.prepare("SELECT cost_center_id FROM project_budgets WHERE id='bud-1'").get().cost_center_id,'cc-mkt','والمخصص كذلك');
  // (هـ) الطلب الذي أُنشئ قبل الترحيل يبقى محجوزًا على صفّ المخصص نفسه، ومعرّفا المركز صارا متطابقين.
  const reservation=db.prepare("SELECT * FROM project_budget_reservations WHERE purchase_id='pur-exact'").get();
  assert.equal(reservation.budget_id,'bud-1','الحجز على المخصص نفسه');
  assert.equal(center('pur-exact'),db.prepare("SELECT cost_center_id FROM project_budgets WHERE id='bud-1'").get().cost_center_id,'ويشتركان في المركز نفسه');
  // القادح الجديد: العمود يُجمَّد بعد مغادرة المسودة. القادح المطبَّق procurement_frozen لا يعرفه، فكان سيبقى مفتوحًا بعد التقديم.
  assert.throws(()=>db.prepare("UPDATE procurement_purchases SET cost_center_id='cc-old',version=version+1 WHERE id='pur-exact'").run(),/submitted purchase is immutable/);
  // والمسودة تبقى قابلة للتعديل كما كانت، فالتجميد على ما غادر المسودة لا على كل شيء.
  db.prepare("UPDATE procurement_purchases SET cost_center_id='cc-mkt',version=version+1 WHERE id='pur-arabic'").run();
  assert.equal(center('pur-arabic'),'cc-mkt');
});

// أخطر ما يمكن أن يفعله ترحيل: أن يمنع فتح القاعدة. الفهرس الفريد كان يسبق الملء، والملء يطابق بـupper(trim)
// بينما القيد القائم UNIQUE(project_id,cost_center) يطابق تطبيع budgets.center — فمخصّصان بكتابتين للمركز نفسه
// يمرّان القيد القديم ويتصادمان على المعرّف، فيتراجع الترحيل كاملًا وتسقط المنصة برسالة لا تسمّي صفًّا.
test('الترحيل 134: مخصّصان بكتابتين لمركز واحد لا يمنعان فتح القاعدة، ويبقيان قرارًا معلَّقًا',t=>{
  const {path}=pre134(t,{collide:true});
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const rows=db.prepare("SELECT id,cost_center,cost_center_id FROM project_budgets WHERE project_id='prj-1' ORDER BY id").all();
  assert.deepEqual(rows.map(r=>r.cost_center_id),[null,null],'المتصادمان يبقيان NULL: قرار إنسان لا تخمين ولا سقوط');
  assert.deepEqual(rows.map(r=>r.cost_center),['CC-MARKETING','cc-marketing'],'والنصّ يبقى كما كُتب في الصفّين');
  // والطلب غير المتصادم يُملأ كما هو مقصود: الحارس يخصّ المتصادم وحده.
  assert.equal(db.prepare("SELECT cost_center_id FROM procurement_purchases WHERE id='pur-exact'").get().cost_center_id,'cc-mkt');
  // والفهرس الفريد قائم بعد الملء، فمخصّصان على المعرّف نفسه ممنوعان من الآن فصاعدًا.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='project_budgets_center_id'").get().n,1);
  db.prepare("UPDATE project_budgets SET cost_center_id='cc-mkt',version=version+1 WHERE id='bud-2'").run();
  assert.throws(()=>db.prepare("INSERT INTO project_budgets(id,tenant_id,project_id,cost_center,currency,cap_minor,valid_from,valid_until,evidence,prepared_by,approved_by,status,revision,version,created_at,updated_at,cost_center_id) VALUES('bud-3','36t','prj-1','CC MARKETING','SAR',100,'2026-01-01','2099-12-31','مخصص تجريبي ثالث','employee',NULL,'draft',1,1,?,?,'cc-mkt')")
    .run(STAMP,STAMP),/UNIQUE constraint failed/,'ومخصّص ثالث على المعرّف نفسه ممنوع من الآن فصاعدًا');
});

test('الترحيل 134: الخيار المستعمَل يُعطَّل ولا يُحذف، والسجل إلحاقي، والقيمة المعتمدة تُجمَّد بعد اعتمادها',t=>{
  const {path}=pre134(t);
  const db=openDb(path);t.after(()=>{try{db.close();}catch{}});
  const insert=(sql,...args)=>db.prepare(sql).run(...args);
  insert("INSERT INTO option_values(id,tenant_id,list_key,value,origin,label,sort_order,state,added_by,added_at) VALUES('opt-1','36t','procurement.unit','نسخة','owner','نسخة',0,'active','manager',?)",STAMP);
  assert.throws(()=>insert("DELETE FROM option_values WHERE id='opt-1'"),/disabled, never deleted/,'لا حذف لخيار');
  assert.throws(()=>insert("UPDATE option_values SET value='أخرى' WHERE id='opt-1'"),/keeps its key/,'ولا تبديل لقيمته');
  assert.throws(()=>insert("UPDATE option_values SET label='اسم آخر' WHERE id='opt-1'"),/raises the version/,'وكل كتابة ترفع النسخة مرة واحدة');
  insert("UPDATE option_values SET label='نسخة مطبوعة',version=version+1 WHERE id='opt-1'");
  assert.equal(db.prepare("SELECT label FROM option_values WHERE id='opt-1'").get().label,'نسخة مطبوعة');
  // «معطَّل» و«من أي تاريخ» وجهان لواقعة واحدة.
  assert.throws(()=>insert("UPDATE option_values SET state='disabled',version=version+1 WHERE id='opt-1'"),/CHECK/);
  // ومن أضاف لا يعتمد.
  assert.throws(()=>insert("UPDATE option_values SET approved_by='manager',approved_at=?,version=version+1 WHERE id='opt-1'",STAMP),/CHECK/);

  const change="INSERT INTO option_changes(id,tenant_id,list_key,value,change,class,reason_code,reason,effective_on,actor_id,created_at) VALUES(?,'36t','procurement.unit','نسخة',?,?,?,?,'2026-09-23','manager',?)";
  insert(change,'chg-1','disabled','tightening','superseded','حلّت محلها وحدة أدق في قائمة الوحدات',STAMP);
  assert.throws(()=>insert("UPDATE option_changes SET reason='نصّ آخر' WHERE id='chg-1'"),/append only/);
  assert.throws(()=>insert("DELETE FROM option_changes WHERE id='chg-1'"),/retained/);
  // «أخرى» ليست سببًا: من اختارها يكتب السبب كاملًا.
  assert.throws(()=>insert(change,'chg-2','disabled','tightening','other','سبب قصير',STAMP),/CHECK/);

  const adoption="INSERT INTO option_adoptions(id,tenant_id,key,value,basis,article,effective_from,recorded_by,created_at) VALUES('adp-1','36t','procurement.minimum_quotes','3','قرار داخلي تجريبي مكتوب بالكامل','','2026-09-23','manager',?)";
  insert(adoption,STAMP);
  assert.throws(()=>insert("UPDATE option_adoptions SET recorded_by='manager',approved_by='manager',approved_at=? WHERE id='adp-1'",STAMP),/CHECK/,'من سجّل لا يعتمد');
  insert("UPDATE option_adoptions SET approved_by='admin',approved_at=? WHERE id='adp-1'",STAMP);
  assert.throws(()=>insert("UPDATE option_adoptions SET basis='أساس مختلف تمامًا' WHERE id='adp-1'"),/approved once/,'وتُجمَّد بعد الاعتماد');
  assert.throws(()=>insert("DELETE FROM option_adoptions WHERE id='adp-1'"),/retained/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
