// شجرة مركز الخدمات: ما ليس مخططًا — 22 سبتمبر 2026.
//
// الترحيل 131 يختبره tests/migration-131.test.mjs. هذا الملف يختبر **القواعد التي تحكم الشجرة نفسها**،
// وأولها قاعدةُ عدٍّ ملزمة: عدّاد الترويسة = مجموع عدّادات بطاقات الفئات، وكلاهما من **جملة واحدة**.
// وسابقة هذا العطب مكتوبة في تاريخ المنصة: مسح 20 سبتمبر (S-04) وجد catalogBrowser يطبع «142 خدمة»
// فوق «كل الخدمات 127» في الشاشة نفسها. فالرقمان هنا يُقارنان حرفيًا لكل جمهور.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, verifyAudit, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, catalogServices, SERVICE_VARIANTS } from '../app/service-catalog.mjs';
import { CATEGORIES, PLACEMENT, MANAGER_DELTA, MY_TEAM_LENS, CATALOG_RENAMES, FIXED_NAMES, RANKING,
  RANKING_ZERO_REASONS, fillReason, GROUP_MODULES, groupMembers, isGroupCode, placementRows, placementFor, audiencesFor } from '../app/catalog-tree.mjs';
import { MODULE_SERVICES } from '../app/static/module-services.mjs';
import { normalize } from '../app/arabic-text.mjs';
import { catalog } from '../app/workflow.mjs';
import { setAvailability, visibleSql, AUDIENCES } from '../app/service-availability.mjs';
import { searchAll, refreshIndex } from '../app/search.mjs';
import { usedServices } from '../app/routing.mjs';

// الأرقام المرجعية. كل رقم على كل شاشة لاحقة يعود إلى هذا الجدول، وهو **مقيس من الكود والقاعدة** لا مكتوب.
// مراجعة 23 سبتمبر: IT-NEW-ACCOUNT عادت إلى إسناد الموظف (الاختبارات المسجَّلة تثبّت دليلَ موظفٍ كاملًا: 142 خدمة)، ففرق
// المدير فارغ والجمهوران يريان الشجرة نفسها: 8 فئات · 63 بطاقة · 143 بندًا.
const EMPLOYEE={categories:8,cards:63,items:143};
const MANAGER={categories:8,cards:63,items:143};
const CARDS_BY_CATEGORY=[4,5,6,11,8,12,7,10];
const ITEMS_BY_CATEGORY=[4,8,7,22,8,59,13,22];
// الخيار الذي يحمل preset ليس الخدمة بل نموذجها مُعبَّأً مسبقًا («العنوان الوطني» فوق «تحديث البيانات
// والوثائق الشخصية»)، فله اسمه بحقّ. وهذه عشرة تسميات عرضٍ في المجموعات الست المشحونة قبل قرار
// «اسم واحد لكل رمز» — إرثٌ مسمّى لا سابقةٌ يُبنى عليها، ويُغلق في دفعة الشاشات حين تتحرك بصماتها.
// وVAR-LETTER/employment «تعريف بالعمل» فوق HR-LETTER «طلب خطاب وظيفي»: تسمية معالج الخطابات القائمة منذ ea7f2fa، عادت ظاهرةً
// حين بقيت الخدمة المبذورة باسمها (مراجعة 23 سبتمبر)؛ تُغلق يوم يقرّر المالك إعادة تسمية HR-LETTER أو تسمية الخيار باسمها.
const LEGACY_OPTION_LABELS=['VAR-ADMIN/supplies','VAR-ADMIN/visitor','VAR-ADMIN/card','VAR-ADMIN/vehicle',
  'VAR-IT/device','VAR-IT/repair','VAR-IT/access','VAR-IT/software','VAR-IT/password','VAR-BENEFITS/medical','VAR-PROFILE/bank','VAR-LETTER/employment'];

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-tree');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users};
}

/* ───── العدّ ───────────────────────────────────────────────────────────────── */

test('الشجرة: عدّاد الترويسة هو مجموع بطاقات الفئات، لكل جمهور، ومن جملة واحدة', t=>{
  const {db}=fixture(t);
  for(const [label,audiences,expected] of [['الموظف',['employee'],EMPLOYEE],['المدير',['employee','manager'],MANAGER]]){
    const view=placementFor(db,'36t',audiences);
    assert.equal(view.totals.categories,expected.categories,`${label}: عدد الفئات`);
    assert.equal(view.totals.cards,expected.cards,`${label}: مجموع البطاقات`);
    assert.equal(view.totals.items,expected.items,`${label}: مجموع البنود`);
    // الترويسة **هي** مجموع البطاقات بالبناء لا بالمصادفة: الرقمان من الصفوف نفسها.
    assert.equal(view.categories.reduce((n,c)=>n+c.cards,0),view.totals.cards,`${label}: «143 في الترويسة و134 في البطاقات» مستحيلة`);
    assert.equal(view.categories.reduce((n,c)=>n+c.items,0),view.totals.items);
    assert.equal(view.items_unplaced,0,`${label}: لا بند بلا فئة`);
  }
  const employee=placementFor(db,'36t',['employee']);
  assert.deepEqual(employee.categories.map(c=>c.cards),CARDS_BY_CATEGORY,'بطاقات كل فئة بترتيب الشجرة');
  assert.deepEqual(employee.categories.map(c=>c.items),ITEMS_BY_CATEGORY,'وبنود كل فئة');
  // قاعدة المالك: ٦–٩ فئات، وتُدمج الفئة دون ٣ بطاقات وتُقسَّم فوق ١٢.
  assert.ok(CATEGORIES.length>=6&&CATEGORIES.length<=9,'عدد الفئات بين ٦ و٩');
  for(const category of employee.categories){
    assert.ok(category.cards>=3,`${category.key}: ${category.cards} بطاقة — دون الثلاث تُدمج`);
    assert.ok(category.cards<=12,`${category.key}: ${category.cards} بطاقة — فوق الاثنتي عشرة تُقسَّم`);
  }
});

test('الشجرة: كل بند من البنود مُسنَد مرة واحدة، والمجموعة تحلّ محل أعضائها في التصفّح لا في العدّ', t=>{
  const {db}=fixture(t);
  const rows=db.prepare("SELECT * FROM catalog_placement WHERE tenant_id='36t'").all();
  const employee=rows.filter(r=>r.audience==='employee');
  assert.equal(employee.filter(r=>r.item_kind==='group').length,26,'ست وعشرون مجموعة خيارات');
  assert.equal(employee.filter(r=>r.item_kind!=='group'&&r.browse===1).length,37,'وسبعٌ وثلاثون بطاقة مفردة');
  assert.equal(employee.filter(r=>r.browse===0).length,106,'ومئة وستة أعضاء مجموعات: 105 خدمة وHR-LEAVE');
  // عضو المجموعة يبقى **مُسنَدًا**: browse=0 يخرجه من الشبكة ولا يخرجه من العدّ ولا من items_unplaced.
  for(const row of employee.filter(r=>r.browse===0))
    assert.ok(row.group_key&&isGroupCode(row.group_key),`${row.item_key}: عضوٌ بلا مجموعة`);
  for(const row of employee.filter(r=>r.browse===1))assert.equal(row.group_key,'','البطاقة المرئية بلا مجموعة تسكنها');

  // كل رمز في services مُسنَد، ولا رمز مرتين. والمفتاح يحرس الثانية، وهذا يحرس الأولى.
  const codes=db.prepare("SELECT DISTINCT code FROM services WHERE tenant_id='36t'").all().map(r=>r.code);
  assert.equal(codes.length,142,'مئة واثنتان وأربعون رمزًا في الدليل');
  const placed=rows.filter(r=>r.item_kind==='service').map(r=>r.item_key);
  assert.deepEqual([...codes].sort().filter(c=>!placed.includes(c)),[],'لا رمز بلا موضع');
  assert.equal(new Set(placed).size,placed.length,'ولا رمز في موضعين');
  // والبند الذي ليس صفًّا في services: HR-LEAVE. سقوطه هو العطب الذي يقع في كل تنفيذ يبني على services وحدها.
  const leave=rows.find(r=>r.item_key==='HR-LEAVE');
  assert.ok(leave,'HR-LEAVE مُسنَد');
  assert.equal(leave.item_kind,'module');
  assert.equal(leave.group_key,'VAR-LEAVE','ويسكن مجموعة الإجازة');
  assert.deepEqual(GROUP_MODULES['VAR-LEAVE'],['HR-LEAVE']);
  assert.ok(MODULE_SERVICES.some(m=>m.code==='HR-LEAVE'));
  assert.equal(EMPLOYEE.items,codes.length-MANAGER_DELTA.length+1,'143 = 142 رمزًا − صفّ المدير (صفر اليوم) + بند الإجازة');
});

test('الشجرة: الإسقاط ثابت عند التكرار، ومبنيّ في الذاكرة قبل أي كتابة', t=>{
  const {db}=fixture(t);
  const strip=json=>json.replace(/"projected_at":"[^"]*"/g,'');
  const read=()=>strip(JSON.stringify(db.prepare('SELECT * FROM catalog_placement ORDER BY audience,item_kind,item_key').all()));
  const before=read();
  installServiceCatalog(db);
  assert.equal(read(),before,'تشغيلتان تعطيان الصفوف نفسها بالضبط');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM services WHERE tenant_id='36t'").get().n,142,'ولا نسخة خدمة تُولد من إعادة التثبيت (ولا من التثبيت الأول على البذرة: المثبّت المسجَّل يثبّت revised:0)');
  // ومواضع القراءة بترتيب الشجرة المكتوب لا بترتيب الإدراج.
  const rows=placementRows();
  assert.equal(rows.length,db.prepare("SELECT COUNT(*) AS n FROM catalog_placement WHERE tenant_id='36t'").get().n);
  assert.ok(verifyAudit(db),'وسلسلة التدقيق سليمة');
});

/* ───── التسمية ─────────────────────────────────────────────────────────────── */

test('التسمية: تسع عشرة رمزًا بالضبط، ولكلٍّ اسمه القديم مرادفًا يجده البحث، والمبذورة باقية باسمها وكلمة الطالب مرادفٌ لها', t=>{
  const {db}=fixture(t);
  // تسع عشرة لا عشرون (مراجعة 23 سبتمبر): HR-LETTER المبذورة لا تُعاد تسميتها — اختبار المثبّت المسجَّل يثبّت revised:0 على البذرة،
  // واختبار مساعد الموظف المسجَّل يثبّت أن «خطاب وظيفي» يجدها بالبذرة وحدها. فتبقى «طلب خطاب وظيفي»، و«تعريف بالعمل» مرادفٌ لها.
  assert.equal(CATALOG_RENAMES.length,19,'تسع عشرة إعادة تسمية');
  assert.equal(new Set(CATALOG_RENAMES.map(r=>r.code)).size,19);
  assert.ok(!CATALOG_RENAMES.some(r=>r.seeded||r.code==='HR-LETTER'),'لا خدمة مبذورة تُعاد تسميتها');
  assert.equal(db.prepare("SELECT name_ar FROM services WHERE tenant_id='36t' AND code='HR-LETTER' ORDER BY version DESC LIMIT 1").get().name_ar,'طلب خطاب وظيفي');
  assert.ok(db.prepare("SELECT 1 FROM service_synonyms WHERE tenant_id='36t' AND item_kind='service' AND item_key='HR-LETTER' AND normalized=?").get(normalize('تعريف بالعمل')),'«تعريف بالعمل» مرادفٌ لها من الكود');
  const byCode=new Map(catalogServices.map(s=>[s.code,s]));
  for(const rename of CATALOG_RENAMES){
    assert.notEqual(rename.from,rename.to,`${rename.code}: إعادة تسمية لا تغيّر شيئًا`);
    // الاسم الحيّ في القاعدة هو الاسم النهائي، وهو نسخة خدمة جديدة كتبها createService.
    const stored=db.prepare(`SELECT name_ar FROM services s WHERE tenant_id='36t' AND code=?
      AND version=(SELECT MAX(v.version) FROM services v WHERE v.tenant_id=s.tenant_id AND v.code=s.code)`).get(rename.code);
    assert.equal(stored?.name_ar,rename.to,`${rename.code}: الاسم المخزَّن هو النهائي`);
    assert.equal(byCode.get(rename.code)?.name_ar,rename.to,`${rename.code}: وتعريف الكود يقوله كذلك`);
    // **والاسم القديم يبقى مكتشَفًا**: catalog يقرأ أحدث نسخة، فبلا المرادف يختفي الاسم القديم من البحث.
    const synonym=db.prepare("SELECT term FROM service_synonyms WHERE tenant_id='36t' AND item_kind='service' AND item_key=? AND normalized=?")
      .get(rename.code,normalize(rename.from));
    assert.equal(synonym?.term,rename.from,`${rename.code}: الاسم القديم «${rename.from}» بلا مرادف يجده البحث`);
    // وبالصورة المطبَّعة التي يُبحث بها: الاسم القديم يقود إلى رمزه وحده لا إلى رمزين، وإلا صار البحث به التباسًا.
    const hits=db.prepare("SELECT DISTINCT item_key FROM service_synonyms WHERE tenant_id='36t' AND normalized=?").all(normalize(rename.from)).map(h=>h.item_key);
    assert.deepEqual(hits,[rename.code],`${rename.code}: «${rename.from}» يقود إلى رمز واحد`);
  }
  // ما لا يقوله هذا الاختبار، فلا يُدَّعى: لا مسار بحث يقرأ service_synonyms بعد (البحث العام يفهرس
  // services وحدها، وضمّ المرادفات إلى الاستعلام موضعه الدفعة الثالثة — STATUS.md). المحفوظ هنا البيانات.
  // HR-LETTER مبذورة بنسخة واحدة: لا نسخة ثانية تُولد على البذرة. ومعالج الخطابات مربوط بالرمز لا بالاسم.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM services WHERE tenant_id='36t' AND code='HR-LETTER'").get().n,1);
});

test('التسمية: اسم واحد لكل رمز، وخمس كلمات إلا التسعة المثبَّتة', t=>{
  const {db}=fixture(t);
  const words=name=>String(name).trim().split(/\s+/).length;
  const live=db.prepare(`SELECT code,name_ar FROM services s WHERE tenant_id='36t'
    AND version=(SELECT MAX(v.version) FROM services v WHERE v.tenant_id=s.tenant_id AND v.code=s.code)`).all();
  for(const service of live){
    if(FIXED_NAMES.includes(service.code))continue;
    assert.ok(words(service.name_ar)<=5,`${service.code}: «${service.name_ar}» ${words(service.name_ar)} كلمات`);
  }
  assert.equal(FIXED_NAMES.length,9,'تسعة أسماء مثبَّتة نظاميًا');
  // وواحدٌ منها وحده يتجاوز الخمس اليوم: الاستثناء رخصةٌ لا يُتوسَّع فيها.
  assert.deepEqual(live.filter(s=>words(s.name_ar)>5).map(s=>s.code),['FIN-TAX-QUERY']);
  for(const code of FIXED_NAMES)assert.ok(live.some(s=>s.code===code),`${code}: اسم مثبَّت لرمز غير موجود`);

  // **اسم واحد لكل رمز**: خيار المجموعة يحمل اسم خدمته بالحرف، إلا ما يحمل preset (فهو نموذج مُعبَّأ
  // لا الخدمة) وإلا العشرة الموروثة المسمّاة أعلاه.
  const name=new Map(live.map(s=>[s.code,s.name_ar]));
  const divergent=[];
  for(const group of SERVICE_VARIANTS){
    if(!Array.isArray(group.options))continue;
    for(const option of group.options){
      if(!option.service||option.preset)continue;
      if(name.get(option.service)!==option.name_ar)divergent.push(`${group.code}/${option.code}`);
    }
  }
  assert.deepEqual(divergent.sort(),[...LEGACY_OPTION_LABELS].sort(),'لا اسم عرضٍ ثانٍ لخدمة خارج الإرث المسمّى');
  // و«تغيير وظيفي» اسمٌ واحد: «تغيير وظيفي لعضو في الفريق» لا وجود له، و«فريقي» عدسة على التعريف نفسه.
  assert.equal(name.get('HR-JOB-CHANGE'),'تغيير وظيفي');
  assert.equal(JSON.stringify([...name.values()]).includes('لعضو في الفريق'),false);
});

/* ───── المجموعات والمرادفات ───────────────────────────────────────────────── */

test('المجموعات: ستّ وعشرون، أعضاؤها مشتقّون من SERVICE_VARIANTS لا من جدول عضوية ثانٍ', t=>{
  const {db}=fixture(t);
  assert.equal(SERVICE_VARIANTS.length,26,'ستّ مشحونة وعشرون تُضاف بالآلية نفسها');
  const groups=PLACEMENT.flatMap(p=>p.cards).filter(isGroupCode);
  assert.equal(groups.length,26);
  assert.deepEqual([...groups].sort(),[...SERVICE_VARIANTS.map(g=>g.code)].sort(),'كل مجموعة مُسنَدة، ولا مجموعة بلا فئة');
  let members=0;
  for(const code of groups){
    const derived=groupMembers(code);
    assert.ok(derived.length>=1,`${code}: مجموعة بلا عضو`);
    members+=derived.length;
    const stored=db.prepare("SELECT item_key FROM catalog_placement WHERE tenant_id='36t' AND audience='employee' AND group_key=?").all(code).map(r=>r.item_key);
    assert.deepEqual([...stored].sort(),derived.map(m=>m.key).sort(),`${code}: عضوية الإسقاط هي عضوية الكود`);
  }
  assert.equal(members,106,'مئة وستة أعضاء: 105 خدمة وبند الإجازة');
  // وdocs الخيارات الجديدة فارغة عمدًا: لم يعتمد أحد قائمة مستندات، ولا يُرسم عنوان فوق فراغ.
  const fresh=SERVICE_VARIANTS.filter(g=>!['VAR-LETTER','VAR-LEAVE','VAR-PROFILE','VAR-ADMIN','VAR-IT','VAR-BENEFITS'].includes(g.code));
  assert.equal(fresh.length,20);
  for(const group of fresh)for(const option of group.options)assert.deepEqual(option.docs,[],`${group.code}/${option.code}: مستندات مخترعة`);
});

test('المرادفات: من الكود وحده، وما كتبه إنسان لا يمسّه الإسقاط', t=>{
  const {db}=fixture(t);
  const count=()=>db.prepare("SELECT COUNT(*) AS n FROM service_synonyms WHERE tenant_id='36t'").get().n;
  assert.ok(count()>=400,'مرادفات المجموعات والخيارات والإجازة والأسماء القديمة');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM service_synonyms WHERE tenant_id='36t' AND source<>'from_code'").get().n,0);
  // كل مرادف مطبَّع بصورة واحدة: الوحدة تحرس الثبات، وهذا يثبته.
  for(const row of db.prepare("SELECT term,normalized FROM service_synonyms WHERE tenant_id='36t'").all())
    assert.equal(row.normalized,normalize(row.term),`«${row.term}»: صورة مطبَّعة تخالف normalize`);
  // كلمات وحدة الإجازة منقولة إلى البند module لا إلى خدمة.
  assert.ok(db.prepare("SELECT 1 FROM service_synonyms WHERE tenant_id='36t' AND item_kind='module' AND item_key='HR-LEAVE' AND normalized='اجازه'").get());
  // وما كتبه إنسان يبقى بعد إسقاطٍ ثانٍ.
  db.prepare("INSERT INTO service_synonyms(tenant_id,item_kind,item_key,term,normalized,source,note,added_by,added_at) VALUES('36t','service','IT-SUPPORT','النظام واقف',?,'curated','كلمة مسؤول الدليل','admin','2026-09-22T09:00:00.000Z')").run(normalize('النظام واقف'));
  installServiceCatalog(db);
  assert.ok(db.prepare("SELECT 1 FROM service_synonyms WHERE tenant_id='36t' AND source='curated'").get(),'الإسقاط يمحو from_code وحدها');
});

/* ───── الجمهور ─────────────────────────────────────────────────────────────── */

test('الجمهور: فرقٌ لا نسخة — صفوف الفرق وحدها للمدير (صفرٌ اليوم بقرار مكتوب)، والموظف يجد IT-NEW-ACCOUNT تصفّحًا وبحثًا كما يثبّته المسجَّل', t=>{
  const {db,users}=fixture(t);
  // مراجعة 23 سبتمبر: الفرق فارغ حتى يقرّر المالك تضييق ظهور خدمةٍ على الموظف ويعيد تسجيل الاختبارات الخمسة باسمه.
  assert.equal(MANAGER_DELTA.length,0,'لا صفّ فرقٍ اليوم، ولا 142 صفًّا مكررًا لكل جمهور');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalog_placement WHERE tenant_id='36t' AND audience='manager'").get().n,0);
  // ولا صفَّ لعميل ولا لمورّد: العمود يحملهما منذ اليوم الأول، ولا دور لهما في users.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalog_placement WHERE audience IN ('client','vendor')").get().n,0);
  // وجمهورٌ في المخطط بلا صفوف يردّ دليلًا فارغًا صريحًا — لا سطحَ له ولا مسار، وهذا ما تقوله الأرقام.
  const client=placementFor(db,'36t',['client']);
  assert.deepEqual(client.categories,[]);
  assert.deepEqual(client.totals,{categories:0,cards:0,items:0});
  assert.throws(()=>placementFor(db,'36t',['partner']),/audience/,'وجمهورٌ خارج الأربعة يُرفض لا يُقرأ فارغًا');

  assert.deepEqual(audiencesFor(users.employee),['employee']);
  assert.deepEqual(audiencesFor(users.manager),['employee','manager']);
  assert.deepEqual(audiencesFor(users.hr),['employee','manager'],'من يطلب نيابةً عن غيره يرى دليل المدير');

  assert.ok(catalog(db,users.employee).some(s=>s.code==='IT-NEW-ACCOUNT'),'الموظف يجدها في التصفّح: الدليل كامل كما يثبّته المسجَّل');
  assert.ok(catalog(db,users.manager).some(s=>s.code==='IT-NEW-ACCOUNT'),'والمدير يجدها');
  assert.equal(catalog(db,users.employee).length,142);
  assert.equal(catalog(db,users.manager).length,142);

  // والبحث يتبع التصفّح: الشرط واحد داخل visibleSql، فلا تظهر في أحدهما وتغيب عن الآخر. يُقاس بصفّ فرقٍ **اصطناعي**
  // (نقل صفّ IT-NEW-ACCOUNT إلى جمهور المدير بالجملة مباشرة) لا بقرارٍ في الكود لم يتخذه المالك.
  db.prepare("UPDATE catalog_placement SET audience='manager' WHERE tenant_id='36t' AND item_key='IT-NEW-ACCOUNT'").run();
  assert.equal(catalog(db,users.employee).some(s=>s.code==='IT-NEW-ACCOUNT'),false,'صفٌّ لجمهور المدير وحده يخفيها عن الموظف تصفّحًا');
  transaction(db,()=>refreshIndex(db,users.admin,{explicit:true,maxAgeMs:0}));
  const hit=who=>{
    const group=searchAll(db,who,'تجهيز حسابات موظف',{limit:50}).groups.find(g=>g.key==='service');
    return (group?.results??[]).some(r=>r.title==='تجهيز حسابات موظف جديد');
  };
  assert.equal(hit(users.employee),false,'ولا في البحث');
  assert.ok(hit(users.manager),'ويجدها المدير في البحث');
});

test('الجمهور: الشرط الواحد يسمح ويرفض بالضبط للجماهير الأربعة، ويرفض خامسًا، ولا يمسّ المزايا', t=>{
  const {db,users}=fixture(t);
  assert.deepEqual([...AUDIENCES],['employee','manager','client','vendor']);
  // الشرط نفسه الذي يُحقن في مسارات القراءة الأربعة، مقيسًا على جدول services مباشرة لا عبر شاشة.
  const seen=audiences=>db.prepare(`SELECT COUNT(DISTINCT s.code) AS n FROM services s WHERE s.tenant_id='36t' AND s.active=1
    AND ${visibleSql('s','code','service',audiences)}`).get().n;
  assert.equal(seen(['employee']),142,'الموظف: الدليل كله (لا صفّ فرقٍ للمدير اليوم)');
  assert.equal(seen(['employee','manager']),142,'المدير: الاتحاد الذي يردّه audiencesFor');
  // جمهور المدير **فرقٌ لا نسخة**: مقروءًا وحده يعطي صفوف فرقه وحدها — صفرٌ اليوم. لا يقرؤه أحدٌ وحده — audiencesFor
  // يردّ الاتحاد دائمًا — وهذا يثبت أن الفرق فرقٌ في القاعدة لا في الأدب.
  assert.equal(seen(['manager']),0);
  // العميل والمورّد: في القائمة منذ اليوم الأول، وبلا صفٍّ واحد، فلا يريان شيئًا — لا دليلًا كاملًا بالخطأ.
  assert.equal(seen(['client']),0);
  assert.equal(seen(['vendor']),0);
  assert.equal(seen(['client','vendor']),0);
  // وجمهورٌ خامس يُرفض من البابين بالجملة نفسها: كان الشرط يسقط إلى شرط 129 وحده فيرى «partner» الدليل كاملًا.
  assert.throws(()=>visibleSql('s','code','service',['partner']),/audience/);
  assert.throws(()=>visibleSql('s','code','service',[]),/audience/);
  assert.throws(()=>placementFor(db,'36t',['partner']),/audience/);
  // والمزايا لا شجرة لها: تُبلَغ من «مزاياي» ولا تدخل catalog_placement، فلا يُركَّب عليها شرط جمهور يطرحها كلها.
  assert.equal(visibleSql('b','benefit_key','benefit',['client']).includes('catalog_placement'),false);
  assert.equal(visibleSql('b','benefit_key','benefit',['partner']).includes('catalog_placement'),false);

  // من يقرأ بأي جمهور: الموظف بلا صفة وحده يقرأ جمهور الموظف؛ وكل من يطلب نيابةً عن غيره يقرأ الاتحاد.
  for(const role of ['manager','hr','it','admin','pm'])assert.deepEqual(audiencesFor({role}),['employee','manager'],role);
  assert.deepEqual(audiencesFor({role:'employee'}),['employee']);
  assert.deepEqual(audiencesFor(null),['employee'],'وبلا حساب: أضيق جمهور لا أوسعه');
  // ولا يستطيع أحد أن يكون عميلًا أو مورّدًا في users أصلًا: الجمهوران في المخطط بلا باب دخول، والقيد يقوله.
  for(const role of ['client','vendor'])
    assert.throws(()=>db.prepare(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES('x-${role}','36t',?,'x-${role}','حساب تجريبي','x',?)`)
      .run(users.employee.department_id,role),/CHECK/,`${role}: لا دور له في users`);

  // والمسار الثالث (الأزرار السريعة: usedServices) يتبع الشرط نفسه، فلا يفتح زرٌّ في الرئيسية ما لا يراه الدليل.
  // يُقاس بصفّ فرقٍ اصطناعي (IT-NEW-ACCOUNT إلى جمهور المدير بالجملة مباشرة)، لا بقرارٍ في الكود لم يتخذه المالك.
  db.prepare("UPDATE catalog_placement SET audience='manager' WHERE tenant_id='36t' AND item_key='IT-NEW-ACCOUNT'").run();
  const service=db.prepare(`SELECT id FROM services s WHERE tenant_id='36t' AND code='IT-NEW-ACCOUNT'
    AND version=(SELECT MAX(v.version) FROM services v WHERE v.tenant_id=s.tenant_id AND v.code=s.code)`).get().id;
  for(const who of ['employee','manager'])
    db.prepare(`INSERT INTO requests(id,tenant_id,service_id,requester_id,title,payload,status,created_at,updated_at)
      VALUES(?,'36t',?,?,'طلب تجريبي لاختبار جمهور الزر السريع','{}','draft','2026-09-22T09:00:00.000Z','2026-09-22T09:00:00.000Z')`).run('req-aud-'+who,service,who);
  const employeeButton=usedServices(db,users.employee).find(s=>s.code==='IT-NEW-ACCOUNT');
  const managerButton=usedServices(db,users.manager).find(s=>s.code==='IT-NEW-ACCOUNT');
  assert.equal(employeeButton.available,false,'الموظف: الزر يبقى في تاريخه ولا يفتح');
  assert.equal(employeeButton.service_id,null);
  assert.equal(employeeButton.hidden,false,'وليس «موقوفة»: لا قرار إيقاف عليها، بل خارج جمهوره');
  assert.equal(managerButton.available,true,'والمدير: يفتح');
  assert.equal(managerButton.service_id,service);
});

test('الجمهور: خدمةٌ لا صفَّ لها في الإسقاط تبقى ظاهرة للجميع، ولا تختفي بالصمت', t=>{
  const {db,users}=fixture(t);
  // القاعدة التي تمنع أخطر ما في هذا الشرط: الإسقاط يضيّق على ما أُسنِد وحده. خدمةٌ أُنشئت بعد آخر
  // إسقاط — أو مستأجرٌ لم يُسقَط له شيء — يبقى دليلُه كما هو، ويُقال نقصُه في items_unplaced لا يُطرح.
  const before=catalog(db,users.employee).length;
  db.prepare("DELETE FROM catalog_placement WHERE tenant_id='36t' AND item_key='HR-OVERTIME'").run();
  assert.equal(catalog(db,users.employee).length,before,'الخدمة بلا موضع لا تسقط من الدليل');
  assert.ok(catalog(db,users.employee).some(s=>s.code==='HR-OVERTIME'));
  db.prepare("DELETE FROM catalog_placement WHERE tenant_id='36t'").run();
  assert.equal(catalog(db,users.employee).length,142,'ومستأجرٌ بلا إسقاط يرى دليله كما كان قبل 131');
  assert.equal(catalog(db,users.manager).length,142);
});

test('الجمهور: الموقوفة بـ129 لا تدخل عدّاد الترويسة ولا عدّاد البطاقات، وتُذكر رقمًا ثالثًا', t=>{
  const {db,users}=fixture(t);
  transaction(db,()=>setAvailability(db,users.admin,{kind:'service',target_key:'HR-OVERTIME',state:'hidden',reason:'تجريبي: قرار مصطنع لاختبار عدّاد الشجرة'}));
  const view=placementFor(db,'36t',['employee']);
  assert.equal(view.totals.items,EMPLOYEE.items-1,'الموقوفة تخرج من البنود');
  assert.equal(view.totals.cards,EMPLOYEE.cards-1,'ومن البطاقات');
  assert.equal(view.categories.reduce((n,c)=>n+c.cards,0),view.totals.cards,'والرقمان يبقيان واحدًا');
  assert.equal(view.items_unplaced,0,'والإيقاف ليس «بلا فئة»: صفّها في الإسقاط كما هو');

  // ومجموعةٌ أُوقف كل أعضائها لا تبقى بطاقةً فارغة: الترويسة تقول ما ترسمه الشبكة لا أكثر.
  for(const code of ['GOV-OBJECTIVE','GOV-INITIATIVE'])
    transaction(db,()=>setAvailability(db,users.admin,{kind:'service',target_key:code,state:'hidden',reason:'تجريبي: إيقاف كل أعضاء مجموعة لاختبار البطاقة الفارغة'}));
  const after=placementFor(db,'36t',['employee']);
  assert.equal(after.rows.some(r=>r.item_key==='VAR-STRATEGY'),false,'بطاقة المجموعة تسقط مع آخر أعضائها');
  assert.equal(after.totals.cards,EMPLOYEE.cards-2,'بطاقة مفردة موقوفة وبطاقة مجموعة فرغت');
  assert.equal(after.totals.items,EMPLOYEE.items-3,'وثلاثة بنود موقوفة');
  assert.equal(after.categories.reduce((n,c)=>n+c.cards,0),after.totals.cards,'والرقمان يبقيان واحدًا');
});

/* ───── العدسة والأوزان ─────────────────────────────────────────────────────── */

test('«فريقي»: عدسة لا تضيف إلى أي عدّاد، وفيها بطاقة خدمة حقيقية واحدة', t=>{
  const {db}=fixture(t);
  assert.equal(MY_TEAM_LENS.length,5);
  const manager=placementFor(db,'36t',['employee','manager']);
  // كل رمز في العدسة مُسنَد في فئةٍ من الثماني، ولا فئة تاسعة له، ولا صفّ ثانٍ.
  for(const code of MY_TEAM_LENS){
    const rows=db.prepare("SELECT category_key FROM catalog_placement WHERE tenant_id='36t' AND item_key=?").all(code);
    assert.equal(rows.length,1,`${code}: العدسة لا تُنتج صفًّا ثانيًا`);
    assert.ok(CATEGORIES.some(c=>c.key===rows[0].category_key));
  }
  assert.equal(manager.totals.cards,MANAGER.cards,'والعدسة لا ترفع عدّاد البطاقات');
  assert.equal(manager.totals.categories,8,'ولا تصير فئةً تاسعة');
  // والخمس كلها عدسات على فئاتهنّ: لا صفّ فرقٍ للمدير اليوم، فلا بطاقة في العدسة تخصّه وحده.
  assert.deepEqual(MY_TEAM_LENS.filter(code=>MANAGER_DELTA.some(d=>d.key===code)),[]);
});

test('الأوزان: تُشحن بقيمها، وصفراها مكتوبٌ سببهما لا مسكوتٌ عنه', ()=>{
  assert.equal(RANKING.usage_30d,0,'«الأكثر طلبًا في 30 يومًا» يُشحن صفرًا');
  assert.equal(RANKING.seasonal,0);
  assert.equal(RANKING.pinned,100);
  assert.equal(RANKING.audience_match,40);
  assert.equal(RANKING.my_usage,20);
  assert.equal(RANKING.not_eligible,-30);
  // والسبب نصٌّ يُعرض على شاشة الإعدادات، لا تعليقٌ في الكود: صفرٌ بلا سبب معروض زينةٌ لا قرار.
  for(const key of ['usage_30d','seasonal']){
    assert.ok(RANKING_ZERO_REASONS[key]?.length>=80,`${key}: سبب الصفر مكتوب`);
    assert.match(RANKING_ZERO_REASONS[key],/الوزن صفر/);
  }
  // والرقم لا يُكتب في النصّ الثابت: موضعان يُحقنان عند القراءة بالمقيس لحظته (مراجعة 23 سبتمبر).
  assert.match(RANKING_ZERO_REASONS.usage_30d,/\{employees\}/);assert.match(RANKING_ZERO_REASONS.usage_30d,/\{completed\}/);
  assert.doesNotMatch(RANKING_ZERO_REASONS.usage_30d,/29 موظفًا|طلبان مكتملان/,'لا رقم مكتوب');
  const filled=fillReason(RANKING_ZERO_REASONS.usage_30d,{employees:'24 حسابًا نشطًا',completed:'صفر'});
  assert.ok(filled.includes('24 حسابًا نشطًا')&&filled.includes('صفر')&&!filled.includes('{'),'الحقن يملأ الموضعين');
  assert.equal(fillReason('x {unknown} y',{}),'x {unknown} y','الموضع بلا قيمة يبقى ظاهرًا لا يُمحى بصمت');
});
