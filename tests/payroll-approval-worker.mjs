// عاملٌ لسباق اعتماد المسير: عملية مستقلة، اتصال DatabaseSync خاص بها، على ملف القاعدة نفسه.
// يُنادى من tests/payroll-input-integrity.test.mjs وحده. يطبع سطر JSON واحدًا ويخرج.
//
// لماذا عمليات لا نداءات في عملية واحدة: الاتصال الواحد لا يتنافس مع نفسه على قفل الكاتب، فيمرّ اختبارٌ لا يقيس شيئًا
// (السبب نفسه في tests/payment-release-worker.mjs). والنسخة تُقرأ قبل الموعد المشترك كما يقرؤها عميلٌ حقيقي.
//
//   node tests/payroll-approval-worker.mjs <قاعدة> <متى يبدأ (ms منذ الحقبة)> <JSON: user,run_id,version,index>
import { openDb, transaction } from '../app/db.mjs';
import { runAction } from '../app/payroll.mjs';

const [path,startAtText,jobText]=process.argv.slice(2);
const job=JSON.parse(jobText),startAt=Number(startAtText);
const db=openDb(path);
const out={index:job.index,user:job.user};
try{
  const user=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t'").get(job.user);
  // البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
  while(Date.now()<startAt){/* انتظار نشط مقصود: النوم يخسر دقة الموعد */}
  const run=transaction(db,()=>runAction(db,user,job.run_id,'approve_run',{version:job.version,note:'اعتماد تجريبي في سباق عمليتين'}));
  out.ok=true;out.status=run.status;out.approved_by=run.approved_by;
}catch(error){
  out.ok=false;out.error=error.code??error.message;
}finally{db.close();}
process.stdout.write(JSON.stringify(out)+'\n');
