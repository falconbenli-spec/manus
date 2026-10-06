// المقارنة الظلية وترقية الترحيل 130. هذا هو الاختبار الذي يحمل الوعد كله: **لا أحد يكسب تصريحًا ولا
// أحد يفقده**. لا يقارن مجموعتين مبنيتين هنا، بل يستدعي access.can نفسها — الدالة التي تقرر في الخادم —
// مرتين على كل حساب نشط وكل تصريح: بالمستويات مطفأة وبها مشتعلة. وما يفشل هنا يفشل في المنتج.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as access from '../app/access.mjs';
import * as levels from '../app/department-levels.mjs';
import { shadowReport, printReport } from '../scripts/permission-shadow.mjs';

const PASSWORD='synthetic-permission-shadow';
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function setup(t){const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());return db;}
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'levels-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('SHADOW: الجواب القديم والجواب الجديد متطابقان على كل حساب نشط وكل تصريح',t=>{
  const db=setup(t);
  for(const tenant of ['36t','isolated']){
    const r=levels.shadowCompare(db,tenant);
    assert.ok(r.checks>0,tenant+': لم تُجرَ مقارنة واحدة');
    assert.equal(r.capabilities,access.CAPABILITIES.length,tenant+': لم تُقس كل التصاريح');
    assert.deepEqual(r.differences,[],tenant+': اختلف الجواب');
    assert.equal(r.clean,true,tenant);
  }
  // وبالمفتاح مشتعلًا تبقى الإجابات نفسها، فالمقارنة ليست أثرًا للمفتاح المطفأ.
  transaction(db,()=>levels.setSwitch(db,user(db,'admin'),{enabled:true,basis:'المقارنة الظلية نظيفة في هذا الاختبار المصطنع'}));
  assert.equal(access.levelsEnabled(db,'36t'),true);
  for(const person of ['employee','manager','hr','it','outsider']){
    const u=user(db,person);
    const on=access.capabilitiesFor(db,u,{levels:true}).list.slice().sort();
    const off=access.capabilitiesFor(db,u,{levels:false}).list.slice().sort();
    assert.deepEqual(on,off,person+': تغيّرت قائمة تصاريحه بتشغيل المستويات');
  }
});

test('SHADOW: تقرير السكربت يغطي كل كيان، ويقول «نظيفة» حين تكون كذلك',t=>{
  const db=setup(t),lines=[];
  const report=shadowReport(db);
  assert.deepEqual(report.map(r=>r.tenant_id).sort(),['36t','isolated']);
  assert.equal(printReport(report,line=>lines.push(line)),true);
  assert.ok(lines.some(l=>l.includes('يجوز تشغيل المفتاح')),'التقرير يقول نتيجته بجملة تُقرأ');
});

test('SHADOW: المفتاح لا يُشغَّل والمقارنة ليست نظيفة، والرفض يسمّي من يكسب ماذا',t=>{
  const db=setup(t),first=user(db,'admin');
  // تغيير القالب قبل التشغيل يُحدث فرقًا حقيقيًا، فالمقارنة تتسخ — وهذا هو الشرط بعينه.
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:true}));
  const dirty=levels.shadowCompare(db,'36t');
  assert.equal(dirty.clean,false);
  assert.ok(dirty.gained>0&&dirty.lost===0,'الفرق كسبٌ لا فقدان: المستوى يضيف ولا يسحب');
  assert.throws(()=>transaction(db,()=>levels.setSwitch(db,first,{enabled:true,basis:'أشغّله رغم الفرق'})),error=>{
    assert.equal(error.code,'shadow_not_clean');
    assert.ok(error.details.refusal.missing.length,'الرفض يسمّي من يكسب ماذا');
    return true;
  });
  assert.equal(access.levelsEnabled(db,'36t'),false,'ولم يُشغَّل');
  // بعد التراجع عن التغيير تعود نظيفة ويُشغَّل.
  transaction(db,()=>levels.setTemplate(db,first,{level:'employee',capability:'review.manage',included:false}));
  assert.equal(levels.shadowCompare(db,'36t').clean,true);
  transaction(db,()=>levels.setSwitch(db,first,{enabled:true,basis:'عادت المقارنة نظيفة بعد التراجع'}));
  assert.equal(access.levelsEnabled(db,'36t'),true);
  assert.equal(verifyAudit(db),true);
});

test('SHADOW: ترقية الترحيل 130 على قاعدة سابقة له تزرع المرآة نفسها وتترك سلامة المفاتيح تامة',t=>{
  const path=join(workspace(t),'pre130.sqlite');
  // (1) قاعدة كاملة ببياناتها.
  let db=openDb(path);seed(db,PASSWORD);
  const before=Object.fromEntries(['employee','manager','hr','it','outsider','admin']
    .map(id=>[id,access.capabilitiesFor(db,user(db,id)).list.slice().sort()]));
  // (2) تُعاد إلى ما قبل 130: تُسقط جداوله وقادحه ويُمحى سطره من سجل الترحيلات. هذه هي حال القاعدة
  //     الحية اليوم بالضبط — كيانات وحسابات قائمة، وترحيل لم يُطبَّق بعد.
  db.exec(`DROP TRIGGER permission_level_exceptions_no_delete;
    DROP TABLE permission_level_exceptions; DROP TABLE permission_level_template;
    DROP TABLE user_permission_levels; DROP TABLE permission_level_settings;
    DELETE FROM schema_migrations WHERE version=130;`);
  db.close();
  // (3) تُفتح من جديد، فيجري الترحيل على قاعدة مأهولة.
  db=openDb(path);t.after(()=>db.close());
  assert.equal(db.prepare('SELECT checksum FROM schema_migrations WHERE version=130').get()!==undefined,true,'طُبِّق الترحيل 130');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'لا مفتاح خارجي مكسور بعد الترقية');
  // (4) ما زرعه الترحيل هو ما تزرعه الشيفرة حرفًا بحرف: نصّان يجب ألا يفترقا.
  for(const [level,keys] of Object.entries(levels.COMPANY_TEMPLATE)){
    const rows=db.prepare('SELECT capability FROM permission_level_template WHERE tenant_id=? AND level=? ORDER BY capability').all('36t',level).map(r=>r.capability);
    assert.deepEqual(rows,[...keys].sort(),'قالب '+level+': الترحيل والشيفرة يختلفان');
  }
  // (5) مستوى كل حساب مشتق من دوره، وحساب إدارة المنصة بلا مستوى.
  const assigned=Object.fromEntries(db.prepare('SELECT user_id,level FROM user_permission_levels').all().map(r=>[r.user_id,r.level]));
  assert.equal(assigned.manager,'department_manager');
  assert.equal(assigned.employee,'employee');
  assert.equal(assigned.hr,'employee');
  assert.equal(assigned.admin,undefined,'حساب إدارة المنصة بلا مستوى إدارة');
  // (6) المفتاح مطفأ لكل كيان، والمقارنة نظيفة، ولا حساب تغيّرت قائمته.
  for(const tenant of ['36t','isolated']){
    assert.equal(access.levelsEnabled(db,tenant),false,tenant+': المفتاح يُزرع مطفأً');
    assert.equal(levels.shadowCompare(db,tenant).clean,true,tenant);
  }
  for(const [id,list] of Object.entries(before))
    assert.deepEqual(access.capabilitiesFor(db,user(db,id)).list.slice().sort(),list,id+': تغيّرت قائمة تصاريحه بالترقية');
  assert.equal(verifyAudit(db),true,'الترقية لا تكتب حدث تدقيق ولا تكسر السلسلة');
});
