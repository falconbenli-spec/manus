// توأم سطر الأوامر لنقل تعريفات الصفحات بين بيئتين لا شبكة مشتركة بينهما (اختبار القبول 18).
//
//   node scripts/definitions-transfer.mjs export --db <قاعدة> --as <حساب> --out <حزمة.json> [--label "وصف المصدر"]
//   node scripts/definitions-transfer.mjs check  --db <قاعدة> --as <حساب> --in  <حزمة.json> [--label "وصف المصدر"]
//   node scripts/definitions-transfer.mjs apply  --db <قاعدة> --as <حساب> --import <معرّف الفحص> --note "سبب التطبيق"
//
// الأوامر الثلاثة تستدعي دوال app/definitions-transfer.mjs نفسها التي تستدعيها المسارات، فالتصاريح والفصل بين من فحص ومن طبّق
// وبصمات الساري تُحكم هنا كما تُحكم هناك: --as حسابٌ في القاعدة يحمل التصريح، لا امتياز لسطر الأوامر.
// فتح قاعدة يطبّق عليها الترحيلات الناقصة (openDb)، فهو كتابة دائمًا: لذلك يُرفض فتح قاعدة المعاينة الأصلية
// work/hr-design-preview-*.sqlite ومجلد التشغيل الحي. انسخ القاعدة أولًا واعمل على النسخة.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { exportBundle, checkImport, applyImport } from '../app/definitions-transfer.mjs';
// الوحدات المشاركة تسجّل واصفاتها عند تحميلها؛ بلا هذا الاستيراد لا يعرف السجل كيانًا يفحص الحزمة مقابله.
import '../app/agency.mjs';
import '../app/pipeline-estimates.mjs';
import '../app/pricing.mjs';

export function guardDatabasePath(path){
  const full=resolve(path);
  if(/^hr-design-preview-.*\.sqlite$/.test(basename(full)))throw new Error(`لا تُفتح قاعدة المعاينة الأصلية (${basename(full)}): فتحها يطبّق ترحيلات عليها. انسخها إلى مجلد مؤقت واعمل على النسخة.`);
  if(full.split('/').includes('3-6t-live'))throw new Error('مجلد التشغيل الحي لا يُمسّ من هنا. انسخ القاعدة واعمل على النسخة.');
  if(!existsSync(full))throw new Error(`القاعدة غير موجودة: ${full}`);
  return full;
}
function options(args){
  const out={};
  for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error(`خيار غير مفهوم: ${args[i]}`);
    out[args[i].slice(2)]=args[++i];
  }
  return out;
}
export function run(command,opts,{log=console.log}={}){
  if(!['export','check','apply'].includes(command))throw new Error('الأمر: export أو check أو apply');
  if(!opts.db||!opts.as)throw new Error('يلزم --db <قاعدة> و--as <حساب يحمل التصريح>');
  const db=openDb(guardDatabasePath(opts.db));
  try{
    const u=db.prepare('SELECT * FROM users WHERE (id=? OR username=?) AND active=1').get(opts.as,opts.as);
    if(!u)throw new Error(`لا حساب مفعَّل بهذا المعرّف في القاعدة: ${opts.as}`);
    if(command==='export'){
      if(!opts.out)throw new Error('يلزم --out <ملف الحزمة>');
      const bundle=exportBundle(db,u,{source_label:opts.label??''});
      writeFileSync(resolve(opts.out),JSON.stringify(bundle,null,2));
      log(`صُدّرت ${bundle.entities.length} تعريفات منشورة إلى ${resolve(opts.out)} — بصمة الحزمة ${bundle.bundle_digest}`);
      return bundle;
    }
    if(command==='check'){
      if(!opts.in)throw new Error('يلزم --in <ملف الحزمة>');
      const report=transaction(db,()=>checkImport(db,u,{bundle:JSON.parse(readFileSync(resolve(opts.in),'utf8')),source_label:opts.label??''}));
      log(report.note);
      for(const e of report.entities){
        log(`\n«${e.label}» — ${e.state==='blocked'?'ممنوع':e.state==='unchanged'?'مطابق':`${e.change_class_name} (${e.diff.length} بندًا)`}`);
        for(const b of e.blocking)log(`  ✖ ${b.text}`);
        for(const i of e.diff)log(`  ${i.class==='loosening'?'▼':i.class==='tightening'?'▲':'+'} ${i.kind} · ${i.label} · ${JSON.stringify(i.before)} ← ${JSON.stringify(i.after)}`);
        for(const o of e.options_in_use??[])if(o.records)log(`  ! ${o.records} سجلًا هنا يحمل الخيار المسحوب: ${o.label}`);
      }
      if(report.id)log(`\nمعرّف الفحص: ${report.id}${report.second_person_required?' — تخفيف ضابط: يطبّقه حساب غير الذي فحص':''}`);
      return report;
    }
    if(!opts.import||!opts.note)throw new Error('يلزم --import <معرّف الفحص> و--note "سبب التطبيق"');
    const result=transaction(db,()=>applyImport(db,u,opts.import,{note:opts.note}));
    log(`طُبِّقت الحزمة: ${result.published.map(p=>`${p.entity_key}@${p.version}`).join('، ')||'لا شيء تغيّر'}`);
    return result;
  }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{run(process.argv[2],options(process.argv.slice(3)));}
  catch(error){console.error(error.message);process.exit(1);}
}
