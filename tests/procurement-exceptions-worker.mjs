// عاملٌ لسباق استثناءات المشتريات: عملية مستقلة، اتصال DatabaseSync خاص بها، على ملف القاعدة نفسه.
// يُنادى من tests/procurement-exceptions.test.mjs وحده. يطبع سطر JSON واحدًا ويخرج.
//
// لماذا عمليات لا نداءات في عملية واحدة: الاتصال الواحد لا يتنافس مع نفسه على قفل الكاتب، فيمرّ اختبارٌ لا يقيس شيئًا
// (السبب نفسه في tests/payment-release-worker.mjs). والنسخة «latest» تُقرأ داخل المعاملة بعد أخذ القفل، كما يفعل عميلٌ
// أعاد التحميل قبل أن يضغط: فالخاسر يصل إلى الحارس نفسه (المستلم، والطلب، والقرار) لا إلى «تغيرت المعاملة».
//
//   node tests/procurement-exceptions-worker.mjs <قاعدة> <متى يبدأ (ms منذ الحقبة)> <JSON: action,user,purchase_id,version,input>
import { openDb, transaction } from '../app/db.mjs';
import * as exceptions from '../app/procurement-exceptions.mjs';

const [path,startAtText,jobText]=process.argv.slice(2);
const job=JSON.parse(jobText),startAt=Number(startAtText);
const db=openDb(path);
const out={index:job.index,action:job.action};
try{
  const user=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t'").get(job.user);
  // البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
  while(Date.now()<startAt){/* انتظار نشط مقصود: النوم يخسر دقة الموعد */}
  const result=transaction(db,()=>{
    if(job.action==='note')return exceptions.recordSupplierNote(db,user,job.purchase_id,job.input);
    const version=job.version==='latest'?db.prepare('SELECT version FROM procurement_purchases WHERE id=?').get(job.purchase_id).version:job.version;
    return exceptions.exceptionAction(db,user,job.purchase_id,job.action,{...job.input,version});
  });
  out.ok=true;out.id=result.id;
}catch(error){
  out.ok=false;out.error=error.code??error.message;
}finally{db.close();}
process.stdout.write(JSON.stringify(out)+'\n');
