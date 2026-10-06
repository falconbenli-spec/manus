// بصمات مركز الخدمات (الدفعة الثانية) — مرآة tests/ui-golden.test.mjs لشاشاتٍ لا تراها.
//
// الاختبار الذهبي المسجَّل يبصم شاشات operationModules وحدها، وشاشات الدليل (#services وفئاته وصفحة الخدمة ونتيجة
// البحث) يرسمها موجّه app.mjs خارج تلك القائمة — فلا تتحرك لها بصمة هناك مهما تغيّر فيها. هذا الملف يسدّ الثغرة
// **بلا تعديل الملف المسجَّل**: يستورد منه دالة التطبيع نفسها (`normalise`: المعرّفات العشوائية إلى رتبة ظهورها)
// كي لا تفترق طريقتا البصم. وثمن الاستيراد معلوم ومقبول: node:test يسجّل اختبارات الملف المستورد في العملية نفسها،
// فتشغيل هذا الملف وحده يشغّل الأربعة الذهبية معه (نحو عشر ثوانٍ). البديل نسخةٌ ثانية من الدالة تفترق بعد أول تحرير.
//
// حين يتغيّر شكل شاشة عمدًا:
//   UPDATE_CATALOG_GOLDEN=1 node --test tests/catalog-golden.test.mjs   يعيد كتابة tests/catalog-golden.baseline.json
//   git diff tests/catalog-golden.baseline.json                          يسمّي كل (جمهور/شاشة) تحرّكت
//   CATALOG_GOLDEN_DUMP=<مجلد>                                           يكتب HTML المطبَّعة لكل شاشة للمقارنة بـdiff
//
// الثبات: الوقت مجمَّد قبل البذر، فختم الإسقاط (rebuilt_at) الذي يطبعه شريط الإعلان ثابت؛ ومعرّفات الخدمات
// (data-id على زرّ البدء) تُستبدل برتبتها. والجمهوران هما الاثنان اللذان يملكان ترتيبًا مختلفًا (62 و63 بطاقة).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalogTree, servicePage, setLens } from '../app/catalog-home.mjs';
import { kit } from '../app/static/kit.mjs';
import { catalogHome, categoryView, searchResults, journeyLensView } from '../app/static/catalog-home-ui.mjs';
import { servicePageView } from '../app/static/service-page.mjs';
import { normalise } from './ui-golden.test.mjs';

const BASELINE=fileURLToPath(new URL('./catalog-golden.baseline.json',import.meta.url));
const AUDIENCES=['employee','manager'];
// الأحد 20 سبتمبر 2026، التاسعة صباحًا بتوقيت الرياض — التاريخ المجمَّد نفسه في الاختبار الذهبي المسجَّل.
const FROZEN=Date.parse('2026-09-20T06:00:00.000Z');
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={e,ui:kit(e,ar=>ar)};
const digest=text=>createHash('sha256').update(text).digest('hex').slice(0,16);

// الشاشات الخمس لكل جمهور: الدليل (بصفّ «لك» لمن له إشارة)، وفئة «وقتي وحضوري»، وصفحة «تصحيح حضور أو استئذان»،
// ونتيجة «تعريف»، والدليل بعدسة «حسب الرحلة» (الدفعة الرابعة) — تُضبط العدسة للحساب ثم تُعاد إلى الحاجة.
function screensFor(db,user){
  const tree=catalogTree(db,user);
  const screens={
    'services':catalogHome(tree,ctx),
    'services/category/my_time':categoryView(tree,'my_time','tree',ctx),
    'services/HR-ATTENDANCE-FIX':servicePageView(servicePage(db,user,'HR-ATTENDANCE-FIX'),ctx),
    'services/search/تعريف':searchResults(tree,'تعريف',ctx)
  };
  transaction(db,()=>setLens(db,user,{lens:'journey'}));
  const journeyTree=catalogTree(db,user);
  screens['services/lens/journey']=catalogHome(journeyTree,{...ctx,extra:journeyLensView(journeyTree,ctx)});
  transaction(db,()=>setLens(db,user,{lens:'need'}));
  return screens;
}

// الساعة تُجمَّد مرة واحدة في الاختبار (MockTimers لا يُفعَّل مرتين)، ثم يُبذر ويُرسم تحتها.
function renderEverything(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-golden');installServiceCatalog(db);
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const screens={},dump=process.env.CATALOG_GOLDEN_DUMP;
  if(dump)mkdirSync(dump,{recursive:true});
  for(const audience of AUDIENCES)for(const [view,html] of Object.entries(screensFor(db,users[audience]))){
    const key=`${audience}/${view}`,normalised=normalise(html);
    screens[key]=digest(normalised);
    if(dump)writeFileSync(join(dump,key.replaceAll('/','__')+'.html'),normalised);
  }
  return screens;
}

test('بصمات مركز الخدمات: الشاشات الأربع لجمهورَي الموظف والمدير تُرسم إلى HTML نفسها',t=>{
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const screens=renderEverything(t);
  assert.equal(Object.keys(screens).length,AUDIENCES.length*5);
  if(process.env.UPDATE_CATALOG_GOLDEN==='1'){
    writeFileSync(BASELINE,JSON.stringify({note:'بصمات HTML لشاشات مركز الخدمات لكل (جمهور/شاشة). يُعاد توليدها بـ UPDATE_CATALOG_GOLDEN=1 node --test tests/catalog-golden.test.mjs بعد تغيير مقصود، ويُراجَع فرقها.',
      frozen_at:new Date(FROZEN).toISOString(),node:process.versions.node,icu:process.versions.icu,audiences:AUDIENCES,pairs:Object.keys(screens).length,screens},null,1)+'\n');
    t.diagnostic(`baseline rewritten: ${Object.keys(screens).length} pairs`);
    return;
  }
  assert.ok(existsSync(BASELINE),'لا ملف أساس. ولّده مرة: UPDATE_CATALOG_GOLDEN=1 node --test tests/catalog-golden.test.mjs');
  const baseline=JSON.parse(readFileSync(BASELINE,'utf8'));
  const changed=[],added=[],removed=[];
  for(const [key,hash] of Object.entries(screens)){if(!(key in baseline.screens))added.push(key);else if(baseline.screens[key]!==hash)changed.push(`${key}: ${baseline.screens[key]} → ${hash}`);}
  for(const key of Object.keys(baseline.screens))if(!(key in screens))removed.push(key);
  assert.deepEqual({changed,added,removed},{changed:[],added:[],removed:[]},
    'تغيّرت HTML شاشات مركز الخدمات. إن كان التغيير مقصودًا: UPDATE_CATALOG_GOLDEN=1 node --test tests/catalog-golden.test.mjs ثم راجع git diff tests/catalog-golden.baseline.json.');
});

// الثبات نفسه الذي يطلبه الاختبار المسجَّل: رسمان متتاليان من قاعدتين مبذورتين يعطيان البصمات نفسها.
test('بصمات مركز الخدمات: رسمان من بذرتين متطابقتين يعطيان البصمات نفسها (لا معرّف عشوائي يتسرّب)',t=>{
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const first=renderEverything(t),second=renderEverything(t);
  assert.deepEqual(second,first);
});
