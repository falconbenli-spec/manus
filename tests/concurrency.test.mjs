import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

// TP2.2 — حزام التزامن والتراجع، بلا تبعيات.
//
// لماذا عمليات لا خيوط: الاختبار داخل عملية واحدة يتشارك اتصال `DatabaseSync` نفسه، فلا يقع تنافسٌ
// على قفل الكاتب أصلًا — ويمرّ اختبارٌ لا يقيس شيئًا. العمليات المستقلة تتنافس فعلًا على الملف.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/concurrency-worker.mjs');

function race(path, job, workers) {
  // موعد مشترك: بلا موعد تنتهي الأولى قبل أن تُقلع الأخيرة، ولا يقع تنافس.
  const startAt = Date.now() + 2500;
  return Promise.all(Array.from({ length: workers }, (unused, index) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, job, String(index), String(startAt)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output' }); } });
  })));
}

function arena(t) {
  const dir = mkdtempSync(join(tmpdir(), '36t-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  const db = openDb(path);
  seed(db, 'synthetic-concurrency');
  db.close();
  return path;
}

test('(أ) ست عمليات ترقّم معًا داخل معاملة: ستة أرقام متمايزة، ولا رقم مكرر',async t=>{
  const path = arena(t);
  const results = await race(path, 'client-code', 6);
  const ok = results.filter(r => r.ok);
  assert.equal(ok.length, 6, 'كل عملية نجحت: ' + JSON.stringify(results.filter(r => !r.ok)));
  const codes = ok.map(r => r.value);
  assert.equal(new Set(codes).size, 6, 'ستة أرقام متمايزة، لا مكرر: ' + codes.sort().join(' '));
  const db = openDb(path); t.after(() => db.close());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clients WHERE tenant_id='36t'").get().n, 6);
  assert.deepEqual(codes.sort(), ['C-0001','C-0002','C-0003','C-0004','C-0005','C-0006'],'متتابعة بلا فجوة');
});

test('(أ) والحماية من قفل الكاتب لا من MAX+1: بلا معاملة يقع التكرار',async t=>{
  // هذا الاختبار يُثبت **لماذا** يمرّ الذي قبله. لولاه لبدا `MAX+1` آمنًا بذاته وليس كذلك.
  const path = arena(t);
  const results = await race(path, 'no-transaction', 6);
  const codes = results.filter(r => r.ok).map(r => r.value);
  const db = openDb(path); t.after(() => db.close());
  const distinct = db.prepare("SELECT COUNT(DISTINCT code) d,COUNT(*) n FROM clients WHERE tenant_id='36t'").get();
  assert.ok(distinct.d < distinct.n || codes.length < results.length,
    `بلا معاملة يقع التكرار أو الفشل. الأرقام: ${codes.sort().join(' ')} · متمايزة ${distinct.d} من ${distinct.n}`);
});

// (ج) نمط التراجع، معمَّمًا من tests/finance.test.mjs: يُحقن فشلٌ عند كتابة التدقيق،
// فإن لم تكن الكتابة كلها في معاملة واحدة بقي نصفها.
export function assertRollsBack(db, t, { count, run, label }) {
  const before = count();
  db.exec("CREATE TEMP TRIGGER concurrency_rollback_probe BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
  try { assert.throws(() => run(), /injected audit failure/, label); }
  finally { db.exec('DROP TRIGGER IF EXISTS concurrency_rollback_probe'); }
  assert.equal(count(), before, `${label}: لم يبقَ أثر بعد التراجع`);
}

test('(ج) فشلٌ مُحقَن عند كتابة التدقيق يعيد كل شيء، ولا يترك نصف كتابة',t=>{
  const db = openDb(':memory:'); t.after(() => db.close());
  seed(db, 'synthetic-concurrency-rollback');
  const count = () => db.prepare("SELECT COUNT(*) n FROM clients WHERE tenant_id='36t'").get().n;
  const insert = () => transaction(db, () => {
    db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,sector,status,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run('rollback-client', '36t', 'C-9999', 'عميل تجريبي للتراجع', 'other', 'active', 'admin', new Date().toISOString(), new Date().toISOString());
    db.prepare("INSERT INTO audit_events(tenant_id,actor_id,entity_type,entity_id,action,before_json,after_json,reason,created_at,policy_version,previous_hash,hash) VALUES('36t','admin','client','rollback-client','client.created','{}','{}','','now','local-policy-v1','','x')").run();
  });
  assertRollsBack(db, t, { count, run: insert, label: 'إنشاء عميل' });
  // وبلا الفشل المُحقَن تمرّ الكتابة، فالاختبار يقيس التراجع لا عجزًا دائمًا.
  insert();
  assert.equal(count(), 1);
});

// ── (ب) عبر HTTP، بخادم حقيقي في عملية فرعية ──────────────────────────────────
// أخطر ما يكسره التزامن هنا **سلسلة التدقيق**: كل حدث يقرأ تجزئة آخر صفّ ثم يكتب صفًّا يحملها.
// فطلبان متزامنان يقرآن التجزئة نفسها يكتبان صفّين يدّعيان السلف نفسه — وسلسلةٌ بفرعين ليست سلسلة.
function serve(t){
  const dir=mkdtempSync(join(tmpdir(),'36t-http-race-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'http.sqlite'),password='synthetic-http-race';
  const child=spawn(process.execPath,[join(ROOT,'tests/concurrency-server.mjs'),path,password],{cwd:ROOT});
  t.after(()=>child.kill('SIGTERM'));
  return new Promise((resolve,reject)=>{
    let out='',err='';
    child.stdout.on('data',chunk=>{out+=chunk;
      const line=out.split('\n').find(l=>l.includes('"port"'));
      if(line)resolve({port:JSON.parse(line).port,path,password});});
    // خطأ الابن يُنقل كما هو: «أُغلق قبل أن يعلن منفذه» وحدها تخفي السبب، وأكثره شيوعًا
    // بيئةٌ تمنع فتح منفذ — وهو ليس عطلًا في الكود، ويجب أن يُقرأ كذلك لا أن يُبحث عنه.
    child.stderr.on('data',chunk=>{err+=chunk;});
    child.on('close',code=>reject(Object.assign(
      new Error('الخادم أُغلق قبل أن يعلن منفذه (رمز '+code+'): '+(err.match(/Error: .*/)?.[0]??'بلا رسالة')),
      {code:/EPERM/.test(err)?'EPERM':undefined})));
  });
}

test('(ب) اثنا عشر دخولًا متزامنًا عبر HTTP: لا رمز 5xx، وسلسلة التدقيق تبقى سلسلة',async t=>{
  const { port, path, password } = await serve(t);
  const login=who=>fetch(`http://127.0.0.1:${port}/api/login`,{method:'POST',
    headers:{'content-type':'application/json','origin':`http://127.0.0.1:${port}`},
    body:JSON.stringify({username:who,password})});
  const who=['admin','employee','manager','hr','it','pm'];
  const responses=await Promise.all(Array.from({length:12},(unused,i)=>login(who[i%who.length])));
  const codes=responses.map(r=>r.status);
  assert.equal(codes.filter(s=>s>=500).length,0,'لا خطأ خادم تحت التزامن: '+codes.join(' '));
  assert.ok(codes.filter(s=>s===200).length>=6,'الدخول نجح لحسابات متمايزة: '+codes.join(' '));
  // السلسلة تُفحص من الخارج بعد أن يهدأ كل شيء.
  const db=openDb(path);t.after(()=>db.close());
  const { verifyAudit }=await import('../app/db.mjs');
  assert.equal(verifyAudit(db),true,'سلسلة التدقيق لم تتفرّع تحت اثني عشر كاتبًا متزامنًا');
  const logins=db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='login'").get().n;
  assert.ok(logins>=6,'كل دخول ناجح ترك حدثه: '+logins);
});
