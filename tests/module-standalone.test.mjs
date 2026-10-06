import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// كل وحدة خادم يجب أن تُحمَّل وحدها.
//
// وحدات المنصة يستورد بعضها بعضًا في دورات — وهذا مقبول في ESM ما دام ما يُقرأ عند التحميل جاهزًا. لكن قراءةَ
// قيمةٍ من وحدة في الدورة **في أعلى الملف** تعتمد على من كان المدخل: تنجح حين تُحمَّل هذه أولًا، وترمي
// `Cannot access '…' before initialization` حين تُحمَّل الأخرى أولًا.
//
// وقع ذلك فعلًا: app/leave.mjs كان يبني خريطة أسماء الإجازات عند التحميل من REGULATION_LEAVE_TYPES في
// app/leave-types.mjs، والدورة leave → leave-types → payroll-extras → leave. فكان app/server.mjs ينجو
// بترتيب استيراده وحده، بينما hr-policies.mjs وleave-types.mjs لا يُحمَّلان منفردين — فلا يُقرآن في اختبار
// ولا في سكربت، ولا يُعرف العطب إلا حين يُغيَّر ترتيب استيراد في الخادم فتسقط المنصة عند الإقلاع.
//
// الحارس يحمّل كل وحدة في عملية مستقلة، فتكون هي المدخل. عمليةٌ لكل وحدة لأن ESM يخزّن ما حمّله: الاستيراد
// الثاني في العملية نفسها لا يعيد التحميل، فلا يكشف شيئًا.
const here=dirname(fileURLToPath(import.meta.url));
const appDir=join(here,'..','app');
const modules=readdirSync(appDir).filter(f=>f.endsWith('.mjs')).sort();
const load=file=>new Promise(resolve=>{
  execFile(process.execPath,['-e',`import(${JSON.stringify(join(appDir,file))}).then(()=>process.exit(0),e=>{console.error(String(e&&e.message||e));process.exit(1);})`],
    // تحذير SQLite التجريبي يسبق الخطأ في stderr، فيُتخطى: المطلوب أول سطر يقول ما العطب.
    {timeout:30000},(error,_out,stderr)=>resolve(error?{file,why:String(stderr||error.message).split('\n')
      .filter(l=>l.trim()&&!/ExperimentalWarning|trace-warnings/.test(l))[0]??String(error.message).slice(0,80)}:null));
});

test('كل وحدة خادم تُحمَّل وحدها، فلا تعتمد قيمةٌ عند التحميل على من كان المدخل',{timeout:300000},async()=>{
  assert.ok(modules.length>100,'الوحدات تُقرأ من app/ فعلًا');
  const failures=[];
  for(let i=0;i<modules.length;i+=8)
    for(const r of await Promise.all(modules.slice(i,i+8).map(load))) if(r)failures.push(r);
  assert.deepEqual(failures.map(f=>`${f.file}: ${f.why}`),[],'وحدات لا تُحمَّل منفردة');
});
