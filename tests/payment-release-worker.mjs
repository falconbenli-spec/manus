// عاملٌ لسباق تحرير الدفع: عملية مستقلة، اتصال DatabaseSync خاص بها، على ملف القاعدة نفسه.
// يُنادى من tests/payment-release.test.mjs وحده. يطبع سطر JSON واحدًا ويخرج.
//
// لماذا عمليات لا نداءات في عملية واحدة: الاتصال الواحد لا يتنافس مع نفسه على قفل الكاتب، فيمرّ اختبارٌ لا يقيس
// شيئًا (السبب نفسه في tests/concurrency.test.mjs وtests/completion-certificate-worker.mjs).
// والنسخة تُقرأ قبل الموعد المشترك كما يقرؤها عميلٌ حقيقي، فالعمليات المتسابقة تحمل النسخة نفسها.
//
//   node tests/payment-release-worker.mjs <قاعدة> <متى يبدأ (ms منذ الحقبة)> <JSON: action,user,…>
import { openDb, transaction } from '../app/db.mjs';
import * as payables from '../app/payables.mjs';

const [path,startAtText,jobText]=process.argv.slice(2);
const job=JSON.parse(jobText),startAt=Number(startAtText);
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const db=openDb(path);
const out={index:job.index,action:job.action};
try{
  const user=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t'").get(job.user);
  // البدء المتزامن: العمليات تُطلق متتابعة، فبلا موعد مشترك تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
  while(Date.now()<startAt){/* انتظار نشط مقصود: النوم يخسر دقة الموعد */}
  const result=transaction(db,()=>{
    if(job.action==='prepare')return payables.preparePayment(db,user,job.amount?{payable_id:job.payable_id,amount:job.amount}:{payable_id:job.payable_id});
    if(job.action==='execute')return payables.paymentAction(db,user,job.order_id,'record_execution',{version:job.version,executed_on:today(),bank_reference:job.reference,evidence:'إشعار تحويل بنكي مصطنع لسباق التوثيق'});
    if(job.action==='return')return payables.paymentAction(db,user,job.order_id,'record_return',{version:job.version,returned_on:today(),bank_reference:job.reference,credited:'550.00',reason:'رجع التحويل في سباق المرتجع المصطنع',evidence:'إشعار إرجاع مصطنع لسباق المرتجع'});
    if(job.action==='release')return payables.paymentAction(db,user,job.order_id,'release_first_payment',{version:job.version,note:'إطلاق أول دفعة في سباق مصطنع'});
    throw new Error('unknown race action '+job.action);
  });
  out.ok=true;out.id=result.id;
}catch(error){
  out.ok=false;out.error=error.code??error.message;
}finally{db.close();}
process.stdout.write(JSON.stringify(out)+'\n');
