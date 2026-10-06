import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { resolveEnvironment } from '../app/environment.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { requestLine, scrubPath, newestBackupAge, healthSnapshot } from '../app/observability.mjs';

// TP2.6 — الرصد. القاعدة الحاكمة: السجل يُقرأ ويُنسخ ويُرسَل حين يُشخَّص عطل، فما وُضع فيه خرج
// من حدود المنصة. ولا يُنقَّح كما تُنقَّح قاعدة، فما دخله بقي.

test('سطر الطلب يحمل ما يُشخَّص به، ولا يحمل قيم الاستعلام ولا حمولة',()=>{
  const line=JSON.parse(requestLine({id:'ab12cd34',method:'POST',path:'/api/employees?q=%D8%B3%D8%A7%D8%B1%D8%A9&page=2',
    status:200,ms:12.7,metrics:{lock_wait_ms:3,transactions:1},env:'local',at:'2026-09-26T10:00:00.000Z'}));
  assert.equal(line.p,'/api/employees','قيم الاستعلام لا تصل السجل — «?q=اسم» بيانٌ شخصي يدخل من حيث لا يُحتسب');
  assert.equal(line.s,200);assert.equal(line.ms,13);assert.equal(line.id,'ab12cd34');
  assert.equal(line.tx,1);assert.equal(line.lock_ms,3);
  // لا اسم ولا معرّف مستخدم ولا حمولة في المفاتيح.
  assert.deepEqual(Object.keys(line).filter(k=>/user|name|payload|body|actor/i.test(k)),[]);
  // بلا معاملة لا يُكتب حقل معاملة أصلًا.
  assert.equal(JSON.parse(requestLine({id:'x',method:'GET',path:'/api/me',status:200,ms:1,metrics:{lock_wait_ms:0,transactions:0},at:'t'})).tx,undefined);
  assert.equal(scrubPath('/a?b=c'),'/a');
});

test('عمر آخر نسخة احتياطية يُقرأ من أحدث ملف، ويغوص في المجلدات الفرعية',t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-observe-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'m0'),{recursive:true});
  const put=(p,seconds)=>{const full=join(dir,p);writeFileSync(full,'x');utimesSync(full,seconds,seconds);};
  put('old.sqlite',1000);
  put('m0/newer.sqlite',5000);
  put('newest.txt',9000);
  const now=5000*1000+7200*1000;   // ساعتان بعد الأحدث
  const age=newestBackupAge([dir],{now});
  assert.equal(age.hours,2,'يُحسب من أحدث ملف sqlite، ولو كان في مجلد فرعي');
  // بلا نسخ: لا رقم يُخترع.
  assert.deepEqual(newestBackupAge([join(dir,'nothing')],{now}),{at:null,hours:null});
});

test('لقطة الصحة تعرض ما يُبنى عليه قرار، ولا تخترع ما لم يُقس',()=>{
  const snap=healthSnapshot({migration:147,schemaDigest:'abc',auditChecked:{ok:true,at:'2026-09-26T09:00:00.000Z'},
    environment:{key:'local'},backupDirs:[],now:1_000_000,startedAt:1_000_000-90_000});
  assert.equal(snap.migration,147);
  assert.equal(snap.audit_chain.ok,true);
  assert.equal(snap.uptime_seconds,90);
  assert.equal(snap.backup.age_hours,null,'لا نسخة فلا رقم — لا صفر يُقرأ «حديثة»');
  // التحقق لا يُعاد حسابه في كل نداء: إن لم يُمرَّر فلا ادعاء.
  assert.equal(healthSnapshot({migration:1,auditChecked:null,environment:{key:'local'}}).audit_chain,null);
});

test('نقطة الصحة خلف تصريح إدارة المنصة، لا مفتوحة',async t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  const password='synthetic-observability';
  seed(db,password);
  const app=createApp(db,{environment:resolveEnvironment({},{root:'/srv/36t'}),
    auditCheckedAtBoot:{ok:true,at:'2026-09-26T09:00:00.000Z'}});
  const open=async who=>{
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username:who,password}});
    return r.headers['Set-Cookie'].split(';')[0];
  };
  // بلا جلسة: النفق عنوانه عام، فنقطةٌ مفتوحة تُقرأ من الخارج.
  assert.equal((await dispatch(app,{path:'/api/health'})).status,401);
  assert.equal((await dispatch(app,{path:'/api/health',headers:{cookie:await open('employee')}})).status,403);
  const admin=await dispatch(app,{path:'/api/health',headers:{cookie:await open('admin')}});
  assert.equal(admin.status,200);
  const body=admin.json();
  assert.equal(body.environment,'local');
  assert.equal(body.audit_chain.ok,true);
  assert.ok(Number.isInteger(body.migration)&&body.migration>100,String(body.migration));
});
