import test from 'node:test';
import assert from 'node:assert/strict';
import { dbPath, bootPort, BootError } from '../app/boot.mjs';

// وحدة الإقلاع (م1، البند 1). الخطر المقصود هنا ليس الإقلاع الفاشل بل الإقلاع الناجح على القاعدة الخطأ:
// المسار الافتراضي كان `work/local.sqlite`، وهو ملف قائم فعلًا على جهاز المالك بجانب قاعدة التشغيل.
const boot=code=>error=>error instanceof BootError&&new RegExp(code).test(error.message);
const has=set=>path=>set.has(path);

test('بلا LOCAL_DB_PATH لا يُقلع الخادم ولا يختار قاعدة من عنده',()=>{
  assert.throws(()=>dbPath({},{root:'/srv/36t',exists:()=>true}),boot('لم يُضبط LOCAL_DB_PATH'));
  assert.throws(()=>dbPath({LOCAL_DB_PATH:'   '},{root:'/srv/36t',exists:()=>true}),boot('لم يُضبط LOCAL_DB_PATH'));
  // ولا ينقذه LOCAL_DB_INIT: المتغير يرخّص بإنشاء قاعدة، ولا يسمّي مكانها.
  assert.throws(()=>dbPath({LOCAL_DB_INIT:'1'},{root:'/srv/36t',exists:()=>true}),boot('لم يُضبط LOCAL_DB_PATH'));
});

test('المسار المضبوط يُحلّ على جذر المشروع، ويُقبل المطلق كما هو',()=>{
  const exists=has(new Set(['/srv/36t/work/live.sqlite','/data/other.sqlite']));
  assert.equal(dbPath({LOCAL_DB_PATH:'work/live.sqlite'},{root:'/srv/36t',exists}),'/srv/36t/work/live.sqlite');
  assert.equal(dbPath({LOCAL_DB_PATH:'/data/other.sqlite'},{root:'/srv/36t',exists}),'/data/other.sqlite');
});

test('مسار لا ملف فيه يوقف الإقلاع، فلا تُبنى قاعدة فارغة تبدو منصةً تعمل',()=>{
  const exists=()=>false;
  assert.throws(()=>dbPath({LOCAL_DB_PATH:'work/typo.sqlite'},{root:'/srv/36t',exists}),boot('لا توجد قاعدة في /srv/36t/work/typo.sqlite'));
  // البناء المتعمَّد يُصرَّح به، فيمر المسار نفسه.
  assert.equal(dbPath({LOCAL_DB_PATH:'work/new.sqlite',LOCAL_DB_INIT:'1'},{root:'/srv/36t',exists}),'/srv/36t/work/new.sqlite');
  // وقيمة أخرى لا تُقرأ «نعم»: المتغير إمّا 1 أو لا شيء.
  for(const value of ['0','true','yes',''])
    assert.throws(()=>dbPath({LOCAL_DB_PATH:'work/new.sqlite',LOCAL_DB_INIT:value},{root:'/srv/36t',exists}),boot('لا توجد قاعدة'));
});

test('المنفذ: الافتراضي 3600، وما دون 1024 أو فوق 65535 أو غير الرقم يوقف الإقلاع',()=>{
  assert.equal(bootPort({}),3600);
  assert.equal(bootPort({PORT:'3620'}),3620);
  // الفارغ «غير مضبوط» لا «صفر»، كما في LOCAL_BIND_HOST.
  assert.equal(bootPort({PORT:''}),3600);
  assert.equal(bootPort({PORT:'  '}),3600);
  for(const bad of ['80','1023','65536','0','-1','abc','36.5'])
    assert.throws(()=>bootPort({PORT:bad}),boot('ليس منفذًا محليًا صالحًا'),`PORT=${bad}`);
});
