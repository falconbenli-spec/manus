// المقارنة الظلية لمستويات الإدارة (ترحيل 130) — يشغّلها القائد على **نسخة** من القاعدة الحية قبل أي تشغيل:
//
//     cp work/local.sqlite /tmp/shadow.sqlite
//     node scripts/permission-shadow.mjs /tmp/shadow.sqlite
//
// ما تفعله: تفتح القاعدة (فتُطبَّق عليها الترحيلات، ومنها 130)، ثم تستدعي access.can نفسها مرتين على كل
// حساب نشط وكل تصريح من المئة — مرةً بالمستويات مطفأة (الجواب القديم) ومرةً بها مشتعلة (الجواب الجديد)،
// وعلى كل إدارة نشطة أيضًا للتصاريح التي تقبل نطاق إدارة. ليست عينة ولا تقديرًا: هي الدالة التي تقرر
// فعلًا في الخادم، لا نسخةٌ منها تُشبهها.
//
// تخرج بالرمز 0 إن لم يختلف جواب واحد، وبالرمز 1 إن اختلف — فتصلح لبوابة قبل تشغيل المفتاح.
// ولا تكتب في القاعدة حرفًا (عدا ما تكتبه الترحيلات عند الفتح، ولهذا تُشغَّل على نسخة لا على الحية).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../app/db.mjs';
import { shadowCompare } from '../app/department-levels.mjs';
import { levelsEnabled } from '../app/access.mjs';

export function shadowReport(db){
  const tenants=db.prepare('SELECT id,name FROM tenants ORDER BY id').all();
  return tenants.map(t=>({tenant_id:t.id,tenant_name:t.name,enabled:levelsEnabled(db,t.id),...shadowCompare(db,t.id)}));
}

export function printReport(report,log=console.log){
  let clean=true;
  for(const r of report){
    log(`\n${r.tenant_id} (${r.tenant_name}) — المفتاح ${r.enabled?'مشتعل':'مطفأ'}`);
    log(`  ${r.users} حسابًا نشطًا × ${r.capabilities} تصريحًا = ${r.checks} مقارنة`);
    if(r.clean){log('  ✔ لا اختلاف واحد: لا أحد يكسب تصريحًا ولا أحد يفقده.');continue;}
    clean=false;
    log(`  ✖ ${r.differences.length} اختلافًا (${r.gained} كسبًا، ${r.lost} فقدانًا):`);
    for(const d of r.differences)log(`     ${d.direction==='gained'?'+':'-'} ${d.user_name} · ${d.capability_name} (${d.capability})${d.department_id?` · ${d.department_id}`:''}`);
  }
  log(clean?'\nالنتيجة: نظيفة. يجوز تشغيل المفتاح.':'\nالنتيجة: ليست نظيفة. صحّح القالب أو استثناءات الإدارات، ولا تشغّل المفتاح.');
  return clean;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const path=process.argv[2];
  if(!path){
    console.error('استعمالها: node scripts/permission-shadow.mjs <مسار نسخة من قاعدة البيانات>');
    console.error('شغّلها على نسخة لا على القاعدة الحية: فتحُ القاعدة يطبّق الترحيلات المعلّقة.');
    process.exit(2);
  }
  const db=openDb(resolve(path));
  try{process.exit(printReport(shadowReport(db))?0:1);}finally{db.close();}
}
