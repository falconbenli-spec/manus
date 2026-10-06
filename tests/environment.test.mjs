import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnvironment, environmentBadge, keyNotice, EnvironmentError, ENVIRONMENTS, isLivePath } from '../app/environment.mjs';
import { dbPath, bootPort, BootError } from '../app/boot.mjs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

// TP2.4 — البيئة المسمّاة. الخطر ليس بيئةً لا تقلع، بل نصفُ تبديل: تجهيزٌ يكتب في قاعدة التشغيل،
// أو تجهيزٌ يفكّ الحقول بمفتاح التشغيل فيصير المفتاح الحيّ في يد بيئة تجريبية.
const ROOT='/srv/36t';
const at=env=>resolveEnvironment(env,{root:ROOT});
const refused=pattern=>error=>error instanceof EnvironmentError&&pattern.test(error.message);

test('الافتراضي هو التشغيل، ولا يشتقّ قاعدة من عنده',()=>{
  const local=at({});
  assert.equal(local.key,'local');
  assert.equal(local.isStaging,false);
  assert.equal(local.port,3600);
  // على جهاز المالك ملفُّ work/local.sqlite قائمٌ بجانب قاعدة التشغيل: اشتقاقُ مسارٍ هنا يعيد عطب م1.
  assert.equal(local.dbPath,null,'التشغيل لا قاعدة افتراضية له');
  assert.equal(at({ENV:'  '}).key,'local','الفارغ غير مضبوط لا اسم بيئة');
  // والمسار المُسمّى صراحةً يمرّ كما هو.
  assert.equal(at({LOCAL_DB_PATH:'work/hr-design-preview-20260914.sqlite'}).dbPath,ROOT+'/work/hr-design-preview-20260914.sqlite');
});

test('التجهيز يشتقّ قاعدته ومفتاحه ومنفذه داخل مجلده',()=>{
  const s=at({ENV:'staging'});
  assert.equal(s.key,'staging');
  assert.equal(s.isStaging,true);
  assert.equal(s.port,3620,'منفذ مستقل، فلا يتصادم مع التشغيل');
  assert.equal(s.dir,ROOT+'/work/staging');
  assert.equal(s.dbPath,ROOT+'/work/staging/staging.sqlite');
  assert.equal(s.keyPath,ROOT+'/work/staging/keys/field.key','المفتاح بجانب قاعدته');
  assert.notEqual(s.port,ENVIRONMENTS.local.port);
});

test('المفتاح يتبع القاعدة لا الكود، فيصيب حين يفترق المجلدان',()=>{
  // في التشغيل يفترقان: الخدمة تعمل من 3-6t-live والقاعدة في المجلد الرئيسي. الاشتقاق من مجلد الكود
  // كان يبحث عن المفتاح حيث لا يوجد، والقيمة المختومة مختومةٌ بمفتاح مجلد القاعدة — فلا تُفكّ،
  // وأول ختم جديد يُنشئ مفتاحًا ثانيًا لقاعدة واحدة.
  const split=resolveEnvironment({LOCAL_DB_PATH:'/data/36t/work/platform.sqlite'},{root:'/code/live'});
  assert.equal(split.keyPath,'/data/36t/work/keys/field.key','تبع القاعدة');
  assert.notEqual(split.keyPath,'/code/live/work/keys/field.key');
  // وحين يجتمعان تبقى النتيجة نفسها التي كانت.
  const together=resolveEnvironment({LOCAL_DB_PATH:'work/db.sqlite'},{root:ROOT});
  assert.equal(together.keyPath,ROOT+'/work/keys/field.key');
  // والمسمّى صراحةً يغلب الاثنين.
  assert.equal(resolveEnvironment({LOCAL_DB_PATH:'/data/x.sqlite',FIELD_KEY_PATH:'/keys/mine.key'},{root:ROOT}).keyPath,'/keys/mine.key');
});

test('التجهيز يرفض كل عبور إلى التشغيل: قاعدةً أو مفتاحًا',()=>{
  // قاعدة خارج مجلده.
  assert.throws(()=>at({ENV:'staging',LOCAL_DB_PATH:'work/hr-design-preview-20260914.sqlite'}),refused(/لا يفتح قاعدة خارج/));
  assert.throws(()=>at({ENV:'staging',LOCAL_DB_PATH:'work/local.sqlite'}),refused(/لا يفتح قاعدة خارج/));
  // مجلد التشغيل الحي، ولو بدا داخل الشجرة.
  assert.throws(()=>at({ENV:'staging',LOCAL_DB_PATH:'/Users/x/3-6t-live/work/db.sqlite'}),refused(/لا يفتح قاعدة خارج/));
  // مفتاح خارج مجلده: هذا هو الأخطر — الحقول الحية تُفكّ من بيئة تجريبية.
  assert.throws(()=>at({ENV:'staging',FIELD_KEY_PATH:'work/keys/field.key'}),refused(/مفتاح حقول خارج/));
  // وما كان داخل مجلده يمرّ.
  assert.equal(at({ENV:'staging',LOCAL_DB_PATH:'work/staging/copy.sqlite'}).dbPath,ROOT+'/work/staging/copy.sqlite');
  assert.equal(at({ENV:'staging',FIELD_KEY_PATH:'work/staging/keys/other.key'}).keyPath,ROOT+'/work/staging/keys/other.key');
});

test('اسم بيئة غير معروف يُرفض ولا يُفسَّر تشغيلًا',()=>{
  assert.throws(()=>at({ENV:'production'}),refused(/ليست بيئة معروفة/));
  assert.throws(()=>at({ENV:'prod'}),refused(/ليست بيئة معروفة/));
  // والرسالة تسمّي المعروف.
  assert.throws(()=>at({ENV:'x'}),refused(/local.*staging|staging.*local/s));
});

test('مسار التشغيل الحي يُعرف باسم ملفه أو بمجلده',()=>{
  assert.equal(isLivePath('/a/b/hr-design-preview-20260914.sqlite'),true);
  assert.equal(isLivePath('/Users/x/Documents/Codex/2026-09-09/3-6t-live/app/db.sqlite'),true);
  assert.equal(isLivePath('/srv/36t/work/staging/staging.sqlite'),false);
  assert.equal(isLivePath('/srv/36t/work/local.sqlite'),false,'ليس حيًّا بالاسم — يُمنع بقاعدة المجلد لا بهذه');
});

test('الوسم: التجهيز يُعلن عن نفسه، والتشغيل لا وسم له',()=>{
  const staging=environmentBadge(at({ENV:'staging'}));
  assert.equal(staging.key,'staging');
  assert.match(staging.warn,/بيانات اصطناعية/);
  assert.equal(environmentBadge(at({})).warn,null,'التشغيل هو الأصل فلا يحمل وسمًا');
});

test('الإقلاع يتبع البيئة: قاعدة التجهيز بلا LOCAL_DB_PATH، ومنفذها افتراضه',()=>{
  const exists=()=>true;
  assert.equal(dbPath({ENV:'staging'},{root:ROOT,exists}),ROOT+'/work/staging/staging.sqlite');
  // والتشغيل بلا مسار يبقى موقوفًا، والرسالة تعرض المخرجين.
  assert.throws(()=>dbPath({},{root:ROOT,exists}),e=>e instanceof BootError&&/ENV=staging/.test(e.message));
  // اسم بيئة خاطئ يُحوَّل إلى خطأ إقلاع مقروء لا أثر مكدّس.
  assert.throws(()=>dbPath({ENV:'production'},{root:ROOT,exists}),e=>e instanceof BootError&&/ليست بيئة معروفة/.test(e.message));
  // المنفذ: افتراض البيئة ما لم يُسمَّ، والمسمّى يغلب.
  assert.equal(bootPort({},{fallback:3620}),3620);
  assert.equal(bootPort({PORT:'3700'},{fallback:3620}),3700);
  assert.throws(()=>bootPort({PORT:'80'},{fallback:3620}),e=>e instanceof BootError&&/3620/.test(e.message));
});

// الوسم يصل الواجهة فعلًا: `/api/me` كان يقول 'local' بخط ثابت — وسمٌ ينتظر أن يكذب يوم تقوم بيئة ثانية.
test('غياب ملف المفتاح لا يوقف الإقلاع لكنه لا يمرّ صامتًا',()=>{
  // وقع هذا فعلًا على القاعدة الحية: سرّ تحقق بخطوتين مختومٌ بمفتاح مجلدٍ لا تقرؤه الخدمة،
  // ومجلد التشغيل بلا مفتاح ولا ‎.env — فأول ختم جديد كان سيُنشئ مفتاحًا ثانيًا في قاعدة واحدة.
  const missing=at({ENV:'staging',FIELD_KEY_PATH:'work/staging/keys/nothing-here.key'});
  assert.equal(missing.keyPresent,false);
  const notice=keyNotice(missing);
  assert.match(notice,/لا ملف في/);
  assert.match(notice,/بمفتاحين/,'يقول العاقبة لا الغياب وحده');
  assert.match(notice,/FIELD_KEY_PATH/,'ويقول التصحيح');
  // وما كان موجودًا لا يُنبَّه عليه.
  assert.equal(keyNotice({keyPresent:true,keyPath:'/x'}),null);
});

test('الوسم يصل الواجهة: /api/me و/api/login يحملان البيئة التي أُقلعت بها',async t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  const password='synthetic-environment-badge';
  seed(db,password);
  const login=async app=>{
    const response=await dispatch(app,{method:'POST',path:'/api/login',body:{username:'admin',password}});
    assert.equal(response.status,200);
    return {body:response.json(),cookie:response.headers['Set-Cookie'].split(';')[0]};
  };

  const staging=createApp(db,{environment:resolveEnvironment({ENV:'staging'},{root:ROOT})});
  const opened=await login(staging);
  assert.equal(opened.body.environment.key,'staging','الدخول نفسه يحمل الوسم، فلا تمر شاشة بلا إعلان');
  const me=await dispatch(staging,{path:'/api/me',headers:{cookie:opened.cookie}});
  assert.equal(me.status,200);
  assert.equal(me.json().environment.key,'staging');
  assert.match(me.json().environment.warn,/بيانات اصطناعية/);

  const local=createApp(db,{environment:resolveEnvironment({},{root:ROOT})});
  const localSession=await login(local);
  const localMe=await dispatch(local,{path:'/api/me',headers:{cookie:localSession.cookie}});
  assert.equal(localMe.json().environment.key,'local');
  assert.equal(localMe.json().environment.warn,null);
});
