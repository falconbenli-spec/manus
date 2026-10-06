import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readCommit, sourceDigest, buildInfo } from '../app/build-info.mjs';
import { healthSnapshot } from '../app/observability.mjs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { resolveEnvironment } from '../app/environment.mjs';
import { dispatch } from './definitions-fixture.mjs';

// عقد تنفيذ 30 سبتمبر 2026، الحزمة 1 البند 5: العملية الجارية تُثبت الالتزام الذي تخدمه، بلا مسار ولا سر.
// والالتزام وحده لا يكفي: مجلد التشغيل يُعدَّل أحيانًا بلا التزام، فالبصمة على ما حُمِّل هي التي تقول الحقيقة.

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const scratch=t=>{const dir=mkdtempSync(join(tmpdir(),'36t-build-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const put=(path,text)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};

test('الالتزام يُقرأ من ملفات git نفسها: مستودعٌ عادي، وشجرة عمل مضافة، ومرجعٌ مضغوط، وHEAD منفصل',t=>{
  // مستودع عادي: .git مجلد، وHEAD يشير إلى مرجعٍ سائب.
  const plain=scratch(t);
  put(join(plain,'.git','HEAD'),'ref: refs/heads/live\n');
  put(join(plain,'.git','refs','heads','live'),A+'\n');
  assert.equal(readCommit(plain),A);

  // شجرة عمل مضافة: .git ملفٌّ يشير إلى دليلها، والمراجع في الدليل المشترك — هنا في packed-refs لا سائبة.
  const common=scratch(t),tree=scratch(t);
  const worktreeDir=join(common,'worktrees','live');
  put(join(tree,'.git'),`gitdir: ${worktreeDir}\n`);
  put(join(worktreeDir,'HEAD'),'ref: refs/heads/live-forms-wave1\n');
  put(join(worktreeDir,'commondir'),'../..\n');
  put(join(common,'packed-refs'),`# pack-refs with: peeled fully-peeled sorted\n${B} refs/heads/live-forms-wave1\n${C} refs/heads/other\n`);
  assert.equal(readCommit(tree),B,'المرجع من packed-refs في الدليل المشترك');

  // HEAD منفصل: الالتزام مكتوب فيه نفسه.
  const detached=scratch(t);
  put(join(detached,'.git','HEAD'),C+'\n');
  assert.equal(readCommit(detached),C);
});

test('ما لا يُقرأ يعيد null لا خطأ، ولا يُتبع مرجعٌ يخرج من دليل git',t=>{
  assert.equal(readCommit(scratch(t)),null,'بلا .git');
  const broken=scratch(t);
  put(join(broken,'.git','HEAD'),'ref: refs/heads/missing\n');
  assert.equal(readCommit(broken),null,'مرجعٌ لا وجود له');
  const hostile=scratch(t);
  put(join(hostile,'.git','HEAD'),'ref: refs/../../../../etc/passwd\n');
  assert.equal(readCommit(hostile),null,'المرجع اسمٌ تحت refs/ لا مسار');
  const garbage=scratch(t);
  put(join(garbage,'.git','HEAD'),'ref: refs/heads/x\n');
  put(join(garbage,'.git','refs','heads','x'),'not-a-sha\n');
  assert.equal(readCommit(garbage),null,'قيمةٌ ليست التزامًا لا تُعاد');
});

test('بصمة الملفات حتمية، وتتغير بتغيّر المحتوى أو الاسم، ولا تحسب ما لا يحمّله الخادم',t=>{
  const root=scratch(t);
  put(join(root,'app','server.mjs'),'export const a=1;\n');
  put(join(root,'app','static','index.html'),'<!doctype html>\n');
  put(join(root,'app','migrations','001-x.sql'),'CREATE TABLE x(id);\n');
  const first=sourceDigest(root);
  assert.match(first.digest,/^[0-9a-f]{64}$/);
  assert.equal(first.files,3);
  assert.equal(sourceDigest(root).digest,first.digest,'حتمية');

  // ما خارج app/ وما يبدأ بنقطة وما ليس من أنواع المخدوم لا يدخل.
  put(join(root,'docs','note.md'),'x');put(join(root,'app','.DS_Store'),'x');put(join(root,'app','notes.txt'),'x');
  assert.equal(sourceDigest(root).digest,first.digest,'الوثائق والملفات المخفية والنصوص لا تُحسب');

  put(join(root,'app','server.mjs'),'export const a=2;\n');
  const edited=sourceDigest(root).digest;
  assert.notEqual(edited,first.digest,'تعديلٌ لم يُلتزم يغيّر البصمة — وهذا غرضها');

  renameSync(join(root,'app','server.mjs'),join(root,'app','main.mjs'));
  assert.notEqual(sourceDigest(root).digest,edited,'المسار داخلٌ في البصمة');
});

test('الصحة تحمل البصمة بلا مسار: الالتزام وبصمة الملفات وعددها ووقت حسابها',t=>{
  const root=scratch(t);
  put(join(root,'.git','HEAD'),'ref: refs/heads/live\n');
  put(join(root,'.git','refs','heads','live'),A+'\n');
  put(join(root,'app','server.mjs'),'x');
  const build=buildInfo(root,{now:()=>new Date('2026-09-30T12:00:00.000Z')});
  assert.deepEqual(Object.keys(build).sort(),['commit','computed_at','files','source_digest']);
  assert.equal(build.commit,A);
  const snapshot=healthSnapshot({migration:159,auditChecked:null,environment:{key:'local'},build});
  assert.deepEqual(snapshot.build,{commit:A,source_digest:build.source_digest,files:1,computed_at:'2026-09-30T12:00:00.000Z'});
  const text=JSON.stringify(snapshot);
  assert.ok(!text.includes(root),'لا يخرج مسار المجلد');
  assert.ok(!/\/Users\/|\/private\/|\/tmp\//.test(text),'ولا أي مسار مطلق');
  assert.equal(healthSnapshot({migration:1,auditChecked:null,environment:{key:'local'}}).build,null,'بلا بصمة: null صريح لا حقلٌ غائب');
});

test('المستودع نفسه: البصمة تُحسب على app/ الحقيقية، والالتزام التزامٌ أو null',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const build=buildInfo(root);
  assert.ok(build.commit===null||/^[0-9a-f]{40}$/.test(build.commit),String(build.commit));
  assert.match(build.source_digest,/^[0-9a-f]{64}$/);
  assert.ok(build.files>400,`عدد الملفات المخدومة ${build.files}`);
});

test('نقطة الصحة تعيد البصمة لمن يملك إدارة المنصة وحده، وبلا جلسة لا شيء',async t=>{
  const db=openDb(':memory:');t.after(()=>db.close());
  const password='synthetic-build-fingerprint';
  seed(db,password);
  const buildAtBoot={commit:A,source_digest:'d'.repeat(64),files:700,computed_at:'2026-09-30T12:00:00.000Z'};
  const app=createApp(db,{environment:resolveEnvironment({},{root:'/srv/36t'}),auditCheckedAtBoot:{ok:true,at:'2026-09-30T12:00:00.000Z'},buildAtBoot});
  const open=async who=>(await dispatch(app,{method:'POST',path:'/api/login',body:{username:who,password}})).headers['Set-Cookie'].split(';')[0];
  assert.equal((await dispatch(app,{path:'/api/health'})).status,401);
  assert.equal((await dispatch(app,{path:'/api/health',headers:{cookie:await open('employee')}})).status,403);
  const admin=await dispatch(app,{path:'/api/health',headers:{cookie:await open('admin')}});
  assert.equal(admin.status,200);
  assert.deepEqual(admin.json().build,buildAtBoot);
});
