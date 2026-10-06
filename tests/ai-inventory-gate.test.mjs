import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { aiBoard, setAiSettings, setProvider, runAssistant, ASSISTANTS } from '../app/ai.mjs';
import { assetGate } from '../app/ai-governance.mjs';

/* بوابة جرد الذكاء الاصطناعي — العيب الذي أوجب هذا الملف:
 *
 * `assetGate()` في app/ai-governance.mjs بوابة تُغلق افتراضيًا: مساعدٌ غير مجرود ⇐ `allowed:false`،
 * وtests/platform-ops-ai-governance.test.mjs يؤكد ذلك صراحةً. لكن البوابة كانت **بلا مستدعٍ خارج ملفها
 * وملف اختبارها**: التشغيل في app/ai.mjs كان يستعمل نسخة محلية متساهلة، `inventoryBlock()`، تقرأ حالة
 * الأصل وتعيد `null` حين لا أصل — أي أن «غير مجرود» كان يعني «مسموح».
 *
 * وقياس 29 سبتمبر 2026 على قاعدة التشغيل: جدول `ai_assets` **صفر صفوف**، و**سبعة مساعدين شغّالين بلا
 * جرد ولا مالك بشري ولا تقييم مخاطر معتمد** — وهم الذين يقرؤون سياسات الموارد البشرية وسجل الموظف نفسه.
 * لا تسرّب وقتها (لا مزود مهيأ)، فالخطر حوكمي بحت: **مجموعة الاختبارات كانت خضراء على بوابة لا تعمل.**
 *
 * الثابت المحروس: قرار الجرد له حَكَمٌ واحد هو `assetGate`، والتشغيل يمرّ به — فـ«غير مجرود» = «لا يعمل».
 */

const input={text:'محضر تجريبي لحملة داخلية، الهدف تعريف الموظفين بالخدمات المتاحة لهم هذا الشهر.'};

function fixture(t,key='brief_gaps'){
  const db=openDb(':memory:');seed(db,'synthetic-ai-inventory-gate');
  t.after(()=>{setProvider(null);db.close();});
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'تشغيل اختبارات محلية مصطنعة'}));
  let calls=0;
  setProvider({name:'synthetic',async complete(){calls++;return {text:'مسودة مصطنعة',input_tokens:10,output_tokens:5,model:'synthetic'};}});
  return {db,users,tx,calls:()=>calls,run:()=>runAssistant(db,users.employee,key,key==='skills_path'?{}:input,transaction)};
}

test('المساعد غير المجرود لا يعمل: لا تشغيل ولا وصول للمزود ولا سجل تشغيل', async t => {
  const f=fixture(t);
  // لا جرد أصلًا: هذه حال قاعدة التشغيل بالضبط — ai_assets فارغ.
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_assets').get().n,0,'القاعدة بلا جرد، كقاعدة التشغيل');
  assert.equal(assetGate(f.db,'36t','brief_gaps').allowed,false,'البوابة نفسها تغلق على غير المجرود');

  await assert.rejects(f.run(),e=>e.code==='ai_not_available',
    'مساعدٌ بلا مالك ولا تقييم مخاطر معتمد لا يجوز أن يعمل. كان يعمل لأن التشغيل لم يمرّ بالبوابة.');
  assert.equal(f.calls(),0,'ولا تغادر بيانات الموظف إلى المزود');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ai_runs').get().n,0);
});

test('ولا يظهر متاحًا في اللوحة: كل مساعد غير مجرود محجوب', t => {
  const f=fixture(t);
  const board=aiBoard(f.db,f.users.employee);
  const available=board.assistants.filter(a=>a.available).map(a=>a.key);
  assert.deepEqual(available,[],
    'بلا جرد لا يُعرض مساعد متاحًا. الظهور «متاحًا» مع غياب المالك والتقييم هو العيب نفسه على الشاشة.');
  assert.equal(board.assistants.length,ASSISTANTS.length);
});

test('ورسالة الحجب تسمّي ما ينقص ومن يجرده والخطوة التالية', t => {
  const f=fixture(t);
  const state=aiBoard(f.db,f.users.employee).assistants.find(a=>a.key==='brief_gaps').state;
  assert.match(state,/غير مجرود/,'تسمّي الحال: غير مجرود');
  assert.match(state,/مالك/,'وتسمّي ما ينقص: مالك بشري');
  assert.match(state,/تقييم مخاطر/,'وتقييم مخاطر معتمد');
  assert.match(state,/ai\.govern/,'وتسمّي من يجرده: حامل تصريح حوكمة الذكاء الاصطناعي');
  assert.doesNotMatch(state,/undefined|null/,'ولا تسرّب قيمة فارغة إلى نص يقرؤه موظف');
});

test('وقرار الجرد له حَكَمٌ واحد: ai.mjs يمرّ بـassetGate ولا يعيد بناء القرار محليًا', () => {
  const src=readFileSync(new URL('../app/ai.mjs',import.meta.url),'utf8');
  assert.match(src,/import\s*\{[^}]*\bassetGate\b[^}]*\}\s*from\s*'\.\/ai-governance\.mjs'/,
    'التشغيل يستورد البوابة من وحدة الحوكمة بدل أن يعيد كتابتها.');
  const localReads=[...src.matchAll(/FROM\s+ai_assets/gi)].length;
  assert.equal(localReads,1,
    'قراءةٌ محلية ثانية لجدول ai_assets تعني حَكَمَين على قرار واحد، وهو ما جعل البوابة تُختبر ولا تعمل.\n'
    + 'المتبقية الوحيدة المسموحة هي قراءة modelPermission لصلاحية المزود الخارجي (مراجعة متأخرة تمنع النموذج ولا تمنع التشغيل).');
});
