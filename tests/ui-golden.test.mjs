import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { seedPayrollDemo } from '../scripts/seed-payroll-demo.mjs';
import { seedOperationsDemo } from '../scripts/seed-operations-demo.mjs';
import { operationModules,money } from '../app/static/operations.mjs';
import { kit } from '../app/static/kit.mjs';
import { dual } from '../app/static/dates.mjs';
import { dispatch } from './definitions-fixture.mjs';

// البصمات الذهبية (م0 «السور»): كل شاشة في operationModules تُحمَّل من الخادم الحقيقي وتُرسم تحت Node لأربع شخصيات مبذورة،
// وتُجزَّأ HTML الناتجة. الغرض أن يثبت ترحيلٌ لاحق إلى العدّة (app/static/kit.mjs) أنه لم يغيّر بايتًا: تبقى البصمات كما هي،
// أو يتغير منها ما قُصد تغييره فقط ويظهر بأسماء شاشاته في فرق ملف الأساس.
//
// حين يفشل هذا الاختبار بعد تغيير مقصود في شاشة:
//   UPDATE_GOLDEN=1 node --test tests/ui-golden.test.mjs     يعيد كتابة tests/ui-golden.baseline.json
//   git diff tests/ui-golden.baseline.json                    يسمّي كل (شخصية/شاشة) تغيّرت — وهذه هي القائمة التي تُراجَع
// ولمعرفة ما الذي تغيّر داخل شاشة: GOLDEN_DUMP=<مجلد> يكتب HTML المطبَّعة لكل شاشة، فتُقارن نسختان بـdiff.
//
// الثبات: الوقت مجمَّد (كل وقت المنصة من Date في JavaScript)، والمعرّفات العشوائية تُستبدل برتبة ظهورها.
// واستثناءٌ واحد على قاعدة «لا ساعة في SQL»: بذرتا الترحيلين 103 و112 تختمان benefit_catalog وsecondment_allowance_versions
// بـstrftime('%Y-%m-%dT%H:%M:%fZ','now') — ساعة نظام التشغيل، لا يبلغها t.mock.timers ولا يمكن تصحيحها بعد الإنشاء
// (مُطلِق benefit_catalog_fixed يمنع تغيير created_at، ومُطلِق آخر يمنع الحذف، والترحيلان مطبَّقان فلا يُعدَّلان).
// فكانت شاشة hr-policies ترسم تاريخ يوم التشغيل الحقيقي («بلا مُعد مسجل في …») وتتغير بصمتها كل يوم — وهو ما جعل
// بصمتيها تنحرفان قبل هذا العمل. تُقرأ الأختام من القاعدة كما كتبتها هي — لا من ساعة نظام التشغيل — وتُقنَّع في HTML،
// فتثبت البصمة عبر الأيام وتبقى كل التواريخ الأخرى (ومنها التاريخ المجمَّد) مرئية لها.
const BASELINE=fileURLToPath(new URL('./ui-golden.baseline.json',import.meta.url));
const PERSONAS=['employee','manager','hr','admin'];
// الأحد 20 سبتمبر 2026، التاسعة صباحًا بتوقيت الرياض: يوم عمل، فبطاقة «اليوم» والحضور في حالهما المعتاد.
const FROZEN=Date.parse('2026-09-20T06:00:00.000Z');
const PASSWORD='synthetic-ui-golden';

// سياق الرسم مطابق لما تمرره app.mjs في موضعها الواحد: module.render(loaded,{e,button,money,tr,lang,date,ui}).
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tr=ar=>ar;
const date=value=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeZone:'Asia/Riyadh'}).format(new Date(value));
const context=view=>({e,money,tr,lang:'ar',date,ui:kit(e,tr),
  button:(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${e(view)}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`});

// المعرّفات عشوائية في كل تشغيل (randomUUID)، ومراجعها القصيرة أول ثمانية أحرف منها. تُستبدل برتبة أول ظهور داخل الشاشة،
// فتبقى البصمة حساسة لترتيب الصفوف وعددها ولا تتأثر بقيمة المعرّف.
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function normalise(html,clockStamps=[]){
  const seen=new Map();
  // أختام ساعة SQL أولًا وبالأطول فالأقصر، فلا يُقنَّع يومٌ داخل ختم كامل قبل الختم نفسه.
  let out=html;
  for(const stamp of [...clockStamps].sort((a,b)=>b.length-a.length))out=out.split(stamp).join('⟦clock⟧');
  out=out.replace(UUID,id=>{const key=id.toLowerCase();if(!seen.has(key))seen.set(key,seen.size+1);return `⟦id:${seen.get(key)}⟧`;});
  for(const [id,n] of seen)out=out.replace(new RegExp(`\\b${id.slice(0,8)}\\b`,'gi'),`⟦ref:${n}⟧`);
  return out;
}
// الأختام كما كتبتها القاعدة نفسها: الطابع الكامل كما يُخزَّن، وصورته المزدوجة كما تُرسم (dual). لا يُقنَّع اليوم
// وحده مجرَّدًا، فقد يصادف تاريخًا مبذورًا مقصودًا فيخفيه عن البصمة.
export function sqlClockStamps(db){
  const rows=db.prepare(`SELECT created_at AS t FROM benefit_catalog UNION SELECT updated_at FROM benefit_catalog
    UNION SELECT created_at FROM secondment_allowance_versions`).all().map(r=>r.t).filter(t=>typeof t==='string'&&t.length>10);
  const stamps=new Set();
  for(const t of rows){stamps.add(t);stamps.add(dual(t.slice(0,10)));}
  return [...stamps];
}
const digest=text=>createHash('sha256').update(text).digest('hex').slice(0,16);
// رأس الصفحة الذي تبنيه app.mjs فوق ناتج الشاشة، بقاعدته نفسها (app/static/app.mjs، «تعديل هذه الصفحة»): زر درج المحرّر
// يُرسم لحامل تصريح تعديل التعريفات وحده، وعلى شاشة يربطها الخادم بكيان يعمل عليه هذا الحساب، وليس أثناء «جرّب كمستخدم».
// كان خارج البصمة كلها — تُحسب على module.render وحدها — فلم يكن في الأساس ما ينفي ظهور الزر لمن لا يحمل التصريح ولا
// ما يثبت ظهوره لمن يحمله. يُضاف الآن قبل ناتج الشاشة: الخانة الفارغة لا تغيّر بصمة، فما يتحرك في الأساس هو ظهور الزر نفسه.
export function editAction(me,snapshot,view){
  if(!(me?.can??[]).includes('definitions.configure')||me?.view_as)return '';
  const editable=Object.values(snapshot?.entities??{}).filter(entity=>entity.views?.includes(view)&&entity.configurable);
  return editable.length?'<button type="button" class="btn outline" data-action="page-editor">تعديل هذه الصفحة</button>':'';
}

async function renderEverything(t){
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const db=openDb(':memory:');seed(db,PASSWORD);seedVendorsDemo(db);seedHrDemo(db);seedPayrollDemo(db);seedOperationsDemo(db);
  // بلا listen: معالج الطلبات الحقيقي يُستدعى داخل العملية (tests/definitions-fixture.mjs dispatch)، فالجلسة وCSRF والتفويض
  // والمعاملة تجري كما في الشبكة ويمر الاختبار في بيئة معزولة تمنع فتح منفذ — وكان هذا الاختبار بعينه لا يُشغَّل فيها،
  // فيُحرَّر ملف الأساس بلا تشغيل يثبته.
  const app=createApp(db);
  t.after(()=>db.close());
  const clockStamps=sqlClockStamps(db);
  const screens={},dump=process.env.GOLDEN_DUMP;
  if(dump)mkdirSync(dump,{recursive:true});
  for(const persona of PERSONAS){
    const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username:persona,password:PASSWORD}});
    assert.equal(login.status,200,persona);
    const cookie=login.headers['Set-Cookie'].split(';')[0];
    const api=async path=>{const response=await dispatch(app,{path:'/api'+path,headers:{cookie}});const body=response.json();
      if(response.status>=400)throw Object.assign(Error(body.error?.code??String(response.status)),{status:response.status});return body;};
    const me=(await api('/me')).user,snapshot=await api('/definitions/snapshot').catch(()=>null);
    for(const [view,module] of Object.entries(operationModules)){
      const key=`${persona}/${view}`;
      let data;
      // شاشة يرفضها الخادم لهذه الشخصية تُسجَّل برمز رفضها: انفتاح شاشة كانت مغلقة، أو انغلاق مفتوحة، تغيّرٌ يجب أن يُرى.
      try{data=await module.load(api);}catch(error){screens[key]=`refused:${error.status??'error'}`;continue;}
      const html=normalise(editAction(me,snapshot,view)+module.render(data,context(view)),clockStamps);
      screens[key]=digest(html);
      if(dump)writeFileSync(join(dump,key.replace('/','__')+'.html'),html);
    }
  }
  return screens;
}

test('golden: every operational screen renders to the same HTML for four seeded personas',async t=>{
  const screens=await renderEverything(t);
  const rendered=Object.values(screens).filter(v=>!v.startsWith('refused:')).length;
  assert.ok(rendered>200,`rendered ${rendered} persona/screen pairs`);
  if(process.env.UPDATE_GOLDEN==='1'){
    writeFileSync(BASELINE,JSON.stringify({note:'بصمات HTML لكل (شخصية/شاشة). يُعاد توليدها بـ UPDATE_GOLDEN=1 node --test tests/ui-golden.test.mjs بعد تغيير مقصود، ويُراجَع فرقها.',
      frozen_at:new Date(FROZEN).toISOString(),node:process.versions.node,icu:process.versions.icu,personas:PERSONAS,pairs:Object.keys(screens).length,rendered,screens},null,1)+'\n');
    t.diagnostic(`baseline rewritten: ${Object.keys(screens).length} pairs, ${rendered} rendered`);
    return;
  }
  assert.ok(existsSync(BASELINE),'لا ملف أساس. ولّده مرة: UPDATE_GOLDEN=1 node --test tests/ui-golden.test.mjs');
  const baseline=JSON.parse(readFileSync(BASELINE,'utf8'));
  const changed=[],added=[],removed=[];
  for(const [key,hash] of Object.entries(screens)){if(!(key in baseline.screens))added.push(key);else if(baseline.screens[key]!==hash)changed.push(`${key}: ${baseline.screens[key]} → ${hash}`);}
  for(const key of Object.keys(baseline.screens))if(!(key in screens))removed.push(key);
  const environment=baseline.icu!==process.versions.icu?`\nتنبيه: الأساس وُلّد على ICU ${baseline.icu} (Node ${baseline.node}) وهذا التشغيل على ICU ${process.versions.icu} (Node ${process.versions.node})؛ إن كان كل الفرق في تواريخ هجرية فالسبب البيئة لا الكود.`:'';
  assert.deepEqual({changed,added,removed},{changed:[],added:[],removed:[]},
    `تغيّرت HTML شاشات. إن كان التغيير مقصودًا: UPDATE_GOLDEN=1 node --test tests/ui-golden.test.mjs ثم راجع git diff tests/ui-golden.baseline.json.${environment}`);
});

// انحراف قِيس على هذا الفرع: بصمتا hr/hr-policies وmanager/hr-policies كانتا تتغيران كل يوم بلا تغيير في سطر واحد
// من الكود، لأن بذرة الترحيل 103 تختم benefit_catalog بساعة SQL ثم ترسمها الشاشة «بلا مُعد مسجل في <تاريخ اليوم>».
// الاختبار يحرّك الختم يومًا ويطالب بألا تتحرك بصمة شاشة واحدة. يفشل قبل التقنيع، ويمر بعده.
test('golden: moving the SQL wall clock a day forward moves no screen hash',async t=>{
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const shot=async (shiftDay,extraStamps)=>{
    const db=openDb(':memory:');seed(db,PASSWORD);seedHrDemo(db);
    if(shiftDay){
      // «غدًا»: المُطلِقان يمنعان تنقيح ختمٍ وقع بحق، فيُسقَطان في قاعدة في الذاكرة تُغلق بعد سطور — محاكاةُ يومٍ آخر،
      // لا تعديلُ سجل، ولا مساس بالترحيل المطبَّق.
      db.exec('DROP TRIGGER benefit_catalog_fixed; DROP TRIGGER secondment_allowance_versions_fixed');
      db.exec(`UPDATE benefit_catalog SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 day'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+1 day');
        UPDATE secondment_allowance_versions SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 day');`);
    }
    const app=createApp(db);
    // تُقنَّع أختام الساعة من الحالتين معًا لا من الحالة الجارية وحدها: مستخرج مؤرَّخ بتاريخ ثابت في ترحيله قد يصادف
    // يومَ تشغيل الاختبار، فيُقنَّع في اللقطة الأولى ويظهر في الثانية، فيبدو أنه تحرّك وهو لم يتحرّك. والتقنيع الموحّد
    // يُبقي للاختبار قوته: شاشة تعرض قيمة مختلفة فعلًا تظل مختلفة.
    const stamps=[...new Set([...sqlClockStamps(db),...(extraStamps??[])])],out={};
    const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username:'hr',password:PASSWORD}});
    assert.equal(login.status,200);
    const cookie=login.headers['Set-Cookie'].split(';')[0];
    const api=async path=>{const response=await dispatch(app,{path:'/api'+path,headers:{cookie}});const body=response.json();
      if(response.status>=400)throw Object.assign(Error(body.error?.code??String(response.status)),{status:response.status});return body;};
    for(const [view,module] of Object.entries(operationModules)){
      let data;
      try{data=await module.load(api);}catch(error){out[view]=`refused:${error.status??'error'}`;continue;}
      out[view]=digest(normalise(module.render(data,context(view)),stamps));
    }
    db.close();
    return out;
  };
  // اللقطتان تتقاسمان القناع نفسه: أختام اليوم وأختام الغد معًا.
  const probe=openDb(':memory:');seed(probe,PASSWORD);seedHrDemo(probe);
  const base=sqlClockStamps(probe);probe.close();
  const shifted=base.map(t=>/^\d{4}-\d{2}-\d{2}T/.test(t)?new Date(Date.parse(t)+86400000).toISOString():t);
  const all=[...base,...shifted,...shifted.map(t=>dual(String(t).slice(0,10)))];
  const today=await shot(false,all),tomorrow=await shot(true,all);
  const moved=Object.keys(today).filter(view=>today[view]!==tomorrow[view]);
  assert.deepEqual(moved,[],'شاشة تتغير بصمتها بتغيّر يوم ساعة SQL، فالبصمة تقيس اليوم لا الشاشة');
});

test('golden: the normaliser hides random identifiers but stays sensitive to order, count and text',()=>{
  const a='11111111-2222-4333-8444-555555555555',b='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const page=(x,y)=>`<li data-id="${x}">طلب ${x.slice(0,8).toUpperCase()}</li><li data-id="${y}">طلب</li><a href="#request/${x}">فتح</a>`;
  assert.equal(normalise(page(a,b)),normalise(page(b,a)),'قيمة المعرّف لا تغيّر البصمة');
  assert.equal(normalise(page(a,b)),'<li data-id="⟦id:1⟧">طلب ⟦ref:1⟧</li><li data-id="⟦id:2⟧">طلب</li><a href="#request/⟦id:1⟧">فتح</a>');
  assert.notEqual(normalise(page(a,b)),normalise(page(a,a)),'صفّان لسجل واحد غير صفّين لسجلين');
  assert.notEqual(normalise(page(a,b)),normalise(page(a,b).replace('فتح','افتح')),'النص يغيّر البصمة');
});

// (6) الدرج وزرّه كانا خارج البصمة كلها: تُحسب على module.render وحدها، والزر في رأس الصفحة الذي تبنيه app.mjs فوقها.
// فلا الأساس ينفي ظهوره لمن لا يحمل التصريح ولا يثبته لمن يحمله. الاختبار يقيس القاعدة نفسها على الشخصيات المبذورة.
test('golden: the page-editor trigger is outside every seeded persona’s screen, and appears only for a holder of the configure capability',async t=>{
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const db=openDb(':memory:');seed(db,PASSWORD);
  const app=createApp(db);
  t.after(()=>db.close());
  const drawn={};
  for(const persona of PERSONAS){
    const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username:persona,password:PASSWORD}});
    assert.equal(login.status,200,persona);
    const cookie=login.headers['Set-Cookie'].split(';')[0];
    const call=async path=>{const r=await dispatch(app,{path:'/api'+path,headers:{cookie}});return r.status>=400?null:r.json();};
    const me=(await call('/me')).user,snapshot=await call('/definitions/snapshot');
    drawn[persona]=Object.keys(operationModules).filter(view=>editAction(me,snapshot,view));
    const holds=(me.can??[]).includes('definitions.configure');
    // من لا يحمل التصريح لا زر له على شاشة واحدة، وحمولة المحرّر مرفوضة عنده على الخادم لا مخفية في الواجهة.
    if(!holds){
      assert.deepEqual(drawn[persona],[],`${persona}: لا زر درج على أي شاشة`);
      assert.equal(await call('/definitions/client'),null,`${persona}: حمولة المحرّر مرفوضة`);
    }
  }
  assert.deepEqual(drawn.employee,[],'الموظفة');assert.deepEqual(drawn.manager,[],'المدير');assert.deepEqual(drawn.hr,[],'الموارد البشرية');
  // الأدمن الأول يحمل تعديل التعريفات (لا نشرها)، فيرى الزر على الشاشات المربوطة بكيان يعمل عليه وحدها.
  assert.ok(drawn.admin.length>0,'ويراه من يحمله');
  assert.ok(drawn.admin.every(view=>['clients','pipeline','quotations','pricing','commercial'].includes(view)),
    `الشاشات المربوطة بكيان وحدها: ${drawn.admin.join('، ')}`);
  // ومن يحمل التصريح على كيان يعمل عليه يراه — القاعدة تطرح ولا تمنع.
  const holder={can:['definitions.configure'],view_as:null};
  const snapshot={entities:{client:{views:['clients'],configurable:true},opportunity:{views:['pipeline'],configurable:false}}};
  assert.match(editAction(holder,snapshot,'clients'),/data-action="page-editor"/);
  assert.equal(editAction(holder,snapshot,'pipeline'),'','كيان لا يعمل عليه: لا زر');
  assert.equal(editAction(holder,snapshot,'payroll'),'','شاشة بلا كيان مربوط: لا زر');
  assert.equal(editAction({...holder,view_as:'employee'},snapshot,'clients'),'','ولا أثناء «جرّب كمستخدم»');
});
