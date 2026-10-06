import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { aiBoard, setAiSettings, setProvider, runAssistant } from '../app/ai.mjs';
import { seedInventory, submitAssessment, decideAssessment, activateAsset, suspendAsset, assetGate } from '../app/ai-governance.mjs';
import { onEveryClock } from './riyadh-clock.mjs';

const input={text:'محضر تجريبي لحملة داخلية، الهدف تعريف الموظفين بالخدمات المتاحة لهم هذا الشهر.'};
function fixture(t,key='brief_gaps'){
  const db=openDb(':memory:');seed(db,'synthetic-ai-runtime');
  t.after(()=>{setProvider(null);db.close();});
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,admin_level) VALUES('governor','36t','ops','governor','مراجع تجريبي','x','admin','scoped')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'governor',capability:'ai.govern',note:'تصريح مراجعة تجريبي مستقل'}));
  tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'تشغيل اختبارات محلية مصطنعة'}));
  let calls=0;
  setProvider({name:'synthetic',async complete(){calls++;return {text:'مسودة مصطنعة',input_tokens:10,output_tokens:5,model:'synthetic'};}});
  const asset=()=>db.prepare("SELECT * FROM ai_assets WHERE tenant_id='36t' AND assistant_key=?").get(key);
  const activate=()=>{
    tx(()=>seedInventory(db,users.admin));let a=asset();
    const {id}=tx(()=>submitAssessment(db,users.admin,a.id,{version:a.version,owner_id:'manager',data_categories:['pasted_text'],data_leaves_kingdom:false,transfer_note:'',risk_level:'low',risk_notes:'بيانات مصطنعة لا تغادر الاختبار ولا تتصل بمزود خارجي',mitigations:'مراجعة بشرية للمسودة'}));
    tx(()=>decideAssessment(db,users.governor,id,{decision:'approve',note:'مراجعة مستقلة لبيانات الاختبار',next_review_on:'2099-01-01'}));a=asset();
    tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'تفعيل محلي للاختبار فقط'}));
  };
  const suspend=()=>{const a=asset();tx(()=>suspendAsset(db,users.manager,a.id,{version:a.version,reason:'إيقاف تجريبي بواسطة مالك المساعد'}));};
  return {db,users,tx,activate,suspend,calls:()=>calls,run:()=>runAssistant(db,users.employee,key,key==='skills_path'?{}:input,transaction)};
}

test('المساعد المجرد غير النشط لا يرسل بيانات للمزود ولا يظهر متاحًا',async t=>{
  const f=fixture(t);f.tx(()=>seedInventory(f.db,f.users.admin));
  assert.equal(aiBoard(f.db,f.users.employee).assistants.find(a=>a.key==='brief_gaps').available,false);
  await assert.rejects(f.run(),e=>e.code==='ai_not_available');
  assert.equal(f.calls(),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_runs').get().n,0);
});

test('إيقاف المساعد النشط يمنع التشغيل اللاحق مع بقاء الإعداد العام مفعلاً',async t=>{
  const f=fixture(t);f.activate();assert.equal((await f.run()).status,'completed');f.suspend();
  await assert.rejects(f.run(),e=>e.code==='ai_not_available');assert.equal(f.calls(),1);
});

// تكلفة الشهر (month_cost_minor) وسقفه يقرآن كل تشغيل في شهر الرياض الجاري. سقطت الحالتان الساعة 02:05 بتوقيت الرياض من 1 أكتوبر:
// التشغيل مختوم 23:05 UTC من 30 سبتمبر، وكانت بداية الشهر تُقارَن نصًّا بـ«2026-10-01» فتقرأ التكلفة صفرًا. فتُشغَّل على ساعات الحد أيضًا.
const costKeptWhileWaiting=key=>async t=>{
  const f=fixture(t,key);f.activate();let release,entered;
  f.tx(()=>setAiSettings(f.db,f.users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'1',input_price_per_mtok:'100000',output_price_per_mtok:'200000',disabled_assistants:[],reason:'تسعير ثابت لاختبار الاستهلاك المحجوب'}));
  const started=new Promise(resolve=>{entered=resolve;});
  setProvider({name:'synthetic',async complete(){entered();await new Promise(resolve=>{release=resolve;});return {text:'ناتج يجب ألا يحفظ',input_tokens:10,output_tokens:5,model:'synthetic'};}});
  const running=f.run();await started;f.suspend();release();
  await assert.rejects(running,e=>e.code==='ai_not_available');
  const row=f.db.prepare('SELECT * FROM ai_runs').get();
  assert.ok(row,'يبقى سجل الاستهلاك بعد رفض الطلب');
  assert.equal(row.status,'refused');assert.equal(row.input_tokens,10);assert.equal(row.output_tokens,5);
  assert.equal(row.cost_minor,200);assert.equal(row.sources,'[]');assert.equal(row.client_id,null);
  assert.doesNotMatch(row.output,/ناتج يجب ألا يحفظ/);assert.match(row.output,/غير نشط/);
  assert.equal(aiBoard(f.db,f.users.admin).admin.month_cost_minor,200);
  assert.equal(aiBoard(f.db,f.users.employee).runs[0].actions.length,0);
  const event=f.db.prepare("SELECT * FROM audit_events WHERE entity_id=? AND action='ai.run'").get(row.id);
  assert.equal(JSON.parse(event.after_json).blocked_by_inventory,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM policy_questions').get().n,0);
  const asset=f.db.prepare("SELECT * FROM ai_assets WHERE tenant_id='36t' AND assistant_key=?").get(key);
  f.tx(()=>activateAsset(f.db,f.users.admin,asset.id,{version:asset.version,reason:'إعادة تفعيل مصطنعة للتحقق من سقف الاستخدام'}));
  await assert.rejects(f.run(),e=>e.code==='cost_cap');
};
for(const key of ['brief_gaps','skills_path']){
  test(`الإيقاف أثناء انتظار ${key} يحفظ التكلفة دون الناتج أو المصادر`,costKeptWhileWaiting(key));
  onEveryClock(test,`الإيقاف أثناء انتظار ${key} يحفظ التكلفة دون الناتج أو المصادر`,costKeptWhileWaiting(key));
}

// كان اسم هذا الاختبار «غياب الجرد يحافظ على السلوك السابق…»، وكان يؤكد أن المساعد غير المجرود يعمل
// إلى نهايته. ذلك «السلوك السابق» هو العطب نفسه: assetGate تُغلق افتراضيًا، وكان مسار التشغيل يلتفّ
// عليها بقراءة محلية متساهلة تعيد «مسموح» عند غياب الأصل — فبقيت البوابة مُختبَرة بلا مستدعٍ، وعلى
// قاعدة التشغيل سبعة مساعدين شغّالين بلا مالك ولا تقييم مخاطر. فانقلب التأكيد: غياب الجرد يمنع.
// وبقي من الاختبار ما هو صحيح ولا يزال: عزل الكيانات.
test('غياب الجرد يمنع التشغيل، وجرد كيان آخر لا يفتح بوابة هذا الكيان',async t=>{
  const f=fixture(t);
  f.db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,admin_level) VALUES('iso-admin','isolated','other','iso-admin','مسؤول تجريبي','x','admin','super')");
  f.db.prepare("INSERT INTO ai_assets(id,tenant_id,assistant_key,name,purpose,origin,created_by,created_at,updated_at) VALUES('other-ai','isolated','brief_gaps','مساعد تجريبي','اختبار العزل','platform','iso-admin','2026-01-01','2026-01-01')").run();
  await assert.rejects(f.run(),e=>e.code==='ai_not_available','جردُ كيانٍ آخر لا يجعل هذا المساعد مجرودًا هنا');
  assert.equal(f.calls(),0,'ولا تغادر بياناته إلى المزود');
  assert.equal(assetGate(f.db,'36t','brief_gaps').allowed,false);
  // ويُفعَّل في 36t وحده: فيعمل هنا، ويبقى الكيان المعزول على حاله.
  f.activate();
  assert.equal((await f.run()).status,'completed');assert.equal(f.calls(),1);
  assert.equal(assetGate(f.db,'isolated','brief_gaps').allowed,false,'التفعيل هنا لا يُفعّل هناك');
});
