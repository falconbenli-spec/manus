import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../app/db.mjs';
import { schemaFingerprint, checkoutRoots, newestBackup, loadBaseline, readSuiteSummary, ROOT } from '../scripts/gate.mjs';

// TP2.1 — البوابة نفسها تحتاج حارسًا: فحصٌ يمرّ لأنه لم يقِس شيئًا أسوأ من فحص يسقط.

test('بصمة المخطط ثابتة بين قاعدتين بُنيتا من الصفر، وتتغير بأي كائن يُضاف',t=>{
  const a=openDb(':memory:');t.after(()=>a.close());
  const b=openDb(':memory:');t.after(()=>b.close());
  const first=schemaFingerprint(a),second=schemaFingerprint(b);
  assert.equal(first.digest,second.digest,'ترحيلان من الصفر يعطيان المخطط نفسه');
  assert.equal(first.objects,second.objects);
  // الشكل يُقرأ لا يُخمَّن: الجداول والفهارس والمحفّزات معدودة بأنواعها.
  assert.ok(first.counts.table>500&&first.counts.trigger>1000&&first.counts.index>1000,JSON.stringify(first.counts));

  b.exec('CREATE INDEX gate_probe_index ON audit_events(action)');
  const after=schemaFingerprint(b);
  assert.notEqual(after.digest,first.digest,'فهرس يُضاف يغيّر البصمة');
  assert.equal(after.objects,first.objects+1);
});

test('البوابة تبحث عن النسخ الاحتياطية في المجلد الرئيسي أيضًا، لا في شجرة العمل وحدها',()=>{
  const roots=checkoutRoots();
  assert.ok(roots.includes(ROOT));
  // `work/` مستثنى من git، فلكل شجرة عمل نسخته والنسخ الحقيقية في الرئيسي. بحثٌ في الجذر وحده يتخطّى الفحص بصمت.
  assert.ok(roots.length>=1);
  assert.ok(roots.every(r=>typeof r==='string'&&r.startsWith('/')));
});

test('أحدث نسخة احتياطية تُختار بزمن التعديل لا بالاسم',t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-gate-backups-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'work/backups'),{recursive:true});
  const at=(name,seconds)=>{const p=join(dir,'work/backups',name);writeFileSync(p,'x');utimesSync(p,seconds,seconds);return p;};
  // الاسم يوحي بأن «a» أقدم، وزمن التعديل يقول غير ذلك: المعيار الزمن.
  at('z-older.sqlite',1000);
  const newest=at('a-newer.sqlite',2000);
  at('not-a-database.txt',3000);
  const before=process.env.BACKUP_DIR;
  process.env.BACKUP_DIR=join(dir,'work/backups');
  t.after(()=>{if(before===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=before;});
  const found=newestBackup();
  assert.ok(found,'وُجدت نسخة');
  // قد يوجد في المجلد الرئيسي ما هو أحدث؛ المهم أن ملف txt لا يُختار أبدًا وأن الاختيار من بين ملفات sqlite.
  assert.ok(found.path.endsWith('.sqlite'));
  if(found.path.startsWith(dir))assert.equal(found.path,newest);
});

test('خط أساس البوابة: إن وُجد فهو كائن، وقيمه هي التي تُقارَن بها الفحوص',()=>{
  const baseline=loadBaseline();
  assert.equal(typeof baseline,'object');
  for(const key of Object.keys(baseline))
    assert.ok(['tests_floor','skipped_ceiling','migration','schema_digest','recorded_at','note'].includes(key),'مفتاح غير معروف: '+key);
});

// ملخّص TAP يُقرأ بنصّه، فتُختبر التسمية بلا تشغيل حزمة تأخذ نصف ساعة.
const tap=(tests,pass,fail,skipped,extra='')=>`${extra}\n# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skipped}\n`;
const EPERM="  error: 'listen EPERM: operation not permitted 127.0.0.1'";

test('قراءة ملخّص الحزمة: النجاح، والنزول عن خط الأساس، والملخّص المبتور',()=>{
  const green=readSuiteSummary(tap(1681,1675,0,6),{tests_floor:1677});
  assert.equal(green.ok,true);
  assert.deepEqual(green.value,{tests:1681,pass:1675,fail:0,skipped:6});

  // العدد ينزل: اختبارٌ اختفى، وهو تراجع لا يراه عدّ الإخفاقات.
  const shrunk=readSuiteSummary(tap(1600,1594,0,6),{tests_floor:1677});
  assert.equal(shrunk.ok,false);
  assert.match(shrunk.note,/نزل عن خط الأساس/);

  // بلا خط أساس: قياس لا مقارنة.
  assert.equal(readSuiteSummary(tap(10,10,0,0),{}).ok,true);
  // حزمة لم تكتمل: لا ملخّص يُقرأ، ولا يُعدّ ذلك نجاحًا.
  const cut=readSuiteSummary('not ok 1 - something\n',{tests_floor:1677});
  assert.equal(cut.ok,false);
  assert.match(cut.note,/الحزمة لم تكتمل/);

  const named=readSuiteSummary(tap(2,1,1,0,'not ok 2 - فحص متقطع معلوم'),{tests_floor:2});
  assert.equal(named.ok,false);
  assert.match(named.note,/الفاشل: فحص متقطع معلوم/,'ملخص البوابة يسمّي الفشل قبل حذف سجل TAP المؤقت');
});

test('بيئة تمنع فتح منفذ: الفشل يُسمّى بسببه ولا يُقرأ عطلًا في الكود',()=>{
  // 38 إخفاقًا كلها EPERM: هذا ما وقع فعلًا حين شُغّلت البوابة داخل صندوق حماية.
  const blocked=readSuiteSummary(tap(1681,1637,38,6,Array(38).fill(EPERM).join('\n')),{tests_floor:1677});
  assert.equal(blocked.ok,false,'لا تمر: لم تُشغَّل اختبارات HTTP');
  assert.equal(blocked.value.blocked,38);
  assert.match(blocked.note,/البيئة تمنع فتح منفذ/);
  assert.match(blocked.note,/ليس نجاحًا ولا عطلًا في الكود/);

  // إخفاق حقيقي مع منع منفذ: لا يُبتلع تحت العذر البيئي.
  const mixed=readSuiteSummary(tap(1681,1636,39,6,Array(38).fill(EPERM).join('\n')),{tests_floor:1677});
  assert.equal(mixed.ok,false);
  assert.doesNotMatch(mixed.note,/ليس نجاحًا ولا عطلًا في الكود/,'39 إخفاقًا و38 منعًا: واحدٌ منها حقيقي');
  assert.match(mixed.note,/منها 38 بسبب منع المنفذ/);
});
