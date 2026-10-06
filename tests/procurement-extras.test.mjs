import { fundProject } from './budget-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { listProcurement, createPurchase, procurementAction } from '../app/procurement.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { declareEmergency, decideEmergency, reviewEmergency, requestOrderChange, decideOrderChange, discloseConflict, decideConflict, procurementExtras } from '../app/procurement-extras.mjs';

const code=value=>error=>error.code===value;
// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-procurement-extras');t.after(()=>db.close());seedVendorsDemo(db);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('legal','36t','ops','legal','مراجع نظامي مصطنع','unused','employee',NULL),('pm2','36t','creative','pm2','مدير مشروع مصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'legal',capability:'vendors.legal',note:'مراجعة نظامية مصطنعة'}));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع طارئ مصطنع',brief:'اختبار استكمال المشتريات',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const input={project_id:project.id,title:'احتياج طباعة مصطنع',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2026-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'};
  const act=(who,p,action,values={})=>tx(()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  const read=(p,who='employee')=>listProcurement(db,users[who]).find(x=>x.id===p.id);
  const quote=(p,key,price='10.00')=>act('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق مواصفات الطباعة المسجلة',financial_terms:'استحقاق بعد استلام الكمية ومطابقة المرجع',delivery_date:'2026-10-20',evidence:'عرض مصطنع محفوظ برقم مرجعي'});
  const sourcing=()=>act('employee',tx(()=>createPurchase(db,users.employee,input)),'submit');
  const award=(p,who='manager')=>act(who,p,'award',{quote_id:p.quotes[0].id,note:'ترسية مصطنعة مع تأكيد المخصص'});
  // بوابة المورد: ما يُتوقع قبول عرضه يحتاج ملفًا. و«not-registered» يبقى بلا ملف عمدًا، فهو ما
  // يُثبت الاختبار رفضَه. و«DEMO-PRINT» يأتي من seedVendorsDemo أعلاه.
  approveVendors(db,['SUPPLIER-A','SUPPLIER-B','SUPPLIER-C','SUPPLIER-X','SUPPLIER-Y','SUPPLIER-Z']);
  return {db,users,tx,act,read,quote,sourcing,award};
}

test('PRC-07: an approved emergency allows an award on one quote, keeps independent approval, and demands a later review by an outside party',t=>{
  const {db,users,tx,read,quote,sourcing,award}=fixture(t);
  let p=quote(sourcing(),'supplier-x');
  assert.throws(()=>award(p),code('comparison_required'));
  const emergency={justification:'تعطلت مطبعة المورد المتعاقد قبل الفعالية بيومين ولا بديل ضمن المسار المعتاد',risk_if_delayed:'فوات موعد فعالية العميل وغرامة تأخير'};
  assert.throws(()=>tx(()=>declareEmergency(db,users.manager,p.id,emergency)),code('invalid_state'));
  tx(()=>declareEmergency(db,users.employee,p.id,emergency));
  assert.throws(()=>award(read(p,'manager')),code('comparison_required'),'a pending declaration changes nothing');
  assert.throws(()=>tx(()=>decideEmergency(db,users.employee,p.id,'approve',{note:'اعتماد ذاتي للطارئ'})),code('invalid_state'));
  tx(()=>decideEmergency(db,users.manager,p.id,'approve',{note:'الفعالية موثقة والمورد الأصلي أكد العطل كتابة'}));
  assert.throws(()=>tx(()=>reviewEmergency(db,users.legal,p.id,{outcome:'justified',note:'مراجعة قبل الترسية لا معنى لها'})),code('not_awarded'));
  p=award(read(p,'manager'));
  assert.equal(p.status,'awarded');assert.equal(p.emergency.status,'approved');assert.ok(p.emergency.review_due);
  assert.throws(()=>tx(()=>reviewEmergency(db,users.manager,p.id,{outcome:'justified',note:'من اعتمد الطارئ يراجعه بنفسه'})),code('not_permitted'));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'vendors.legal',note:'اختبار فصل المهام'}));
  assert.throws(()=>tx(()=>reviewEmergency(db,users.manager,p.id,{outcome:'justified',note:'من اعتمد الطارئ يراجعه بنفسه'})),code('separation_of_duties'));
  assert.deepEqual(procurementExtras(db,users.legal).emergencies[0].actions,['review_emergency']);
  tx(()=>reviewEmergency(db,users.legal,p.id,{outcome:'not_justified',note:'العطل كان معروفًا قبل أسبوع؛ يُدرج مورد بديل في الخطة'}));
  assert.throws(()=>tx(()=>reviewEmergency(db,users.legal,p.id,{outcome:'justified',note:'مراجعة ثانية لتغيير النتيجة الأولى'})),code('not_found'));
  // مراجعة متأخرة تمنع صاحبها من طارئ جديد.
  let second=quote(sourcing(),'supplier-y');
  tx(()=>declareEmergency(db,users.employee,second.id,emergency));tx(()=>decideEmergency(db,users.manager,second.id,'approve',{note:'حالة ثانية موثقة من العميل'}));
  db.exec("DROP TRIGGER procurement_emergencies_fixed");db.prepare("UPDATE procurement_emergencies SET review_due='2020-01-01' WHERE purchase_id=?").run(second.id);
  const third=quote(sourcing(),'supplier-z');
  assert.throws(()=>tx(()=>declareEmergency(db,users.employee,third.id,emergency)),code('review_overdue'));
  assert.equal(procurementExtras(db,users.legal).emergencies.find(e=>e.purchase_id===second.id).review_overdue,true);
  assert.ok(verifyAudit(db));
});

test('PRC-08: the approved order is never rewritten; a date or terms change and a short close are separate records decided by someone else',t=>{
  const {db,users,tx,act,read,quote,sourcing,award}=fixture(t);
  let p=quote(quote(quote(sourcing(),'supplier-a','10.00'),'supplier-b','11.00'),'supplier-c','12.00');
  p=award(p);p=act('manager',p,'approve_order',{terms:'تسليم على دفعتين',delivery_date:'2026-10-20',note:'اعتماد أمر مصطنع'});
  const commencement={start_on:today(),valid_until:'2099-12-31',site_or_channel:'مطبعة المورد المصطنعة',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'};
  p=act('manager',p,'commence',commencement);
  const change={kind:'delivery_date',new_delivery_date:'2026-10-27',new_terms:'',reason:'طلب المورد أسبوعًا إضافيًا لتأخر الورق المستورد',supplier_confirmation:'بريد المورد المصطنع بتاريخ اليوم'};
  assert.throws(()=>tx(()=>requestOrderChange(db,users.manager,p.id,change)),code('invalid_state'));
  assert.throws(()=>tx(()=>requestOrderChange(db,users.employee,p.id,{...change,kind:'close_short'})),code('nothing_received'));
  const id=tx(()=>requestOrderChange(db,users.employee,p.id,change)).id;
  assert.throws(()=>tx(()=>requestOrderChange(db,users.employee,p.id,change)),code('pending_change'));
  assert.throws(()=>tx(()=>decideOrderChange(db,users.employee,id,'approve',{note:'اعتماد ذاتي للتعديل'})),code('not_permitted'));
  assert.equal(read(p).order.effective_delivery_date,'2026-10-20');
  tx(()=>decideOrderChange(db,users.manager,id,'approve',{note:'التأخير لا يمس موعد الفعالية'}));
  const after=read(p);assert.equal(after.order.delivery_date,'2026-10-20','the order row is untouched');assert.equal(after.order.effective_delivery_date,'2026-10-27');assert.equal(after.order_changes.length,1);
  // التعديل المعتمد نسخةٌ جديدة من الأمر (الترحيل 162): إذن المباشرة على النسخة الأولى لا يفتح الاستلام حتى يُستبدل.
  assert.equal(after.order.order_version,2);
  assert.throws(()=>act('employee',after,'receive',{quantity:2,reference:'receipt-1',evidence:'استلام نسختين وفحصهما'}),code('commencement_stale'));
  p=act('manager',after,'replace_commencement',{...commencement,reason:'تعدّل موعد التسليم في الأمر فأُعيد الإذن على نسخته الجديدة'});
  p=act('employee',p,'receive',{quantity:2,reference:'receipt-1',evidence:'استلام نسختين وفحصهما'});
  const close=tx(()=>requestOrderChange(db,users.employee,p.id,{kind:'close_short',new_delivery_date:'',new_terms:'',reason:'توقف المورد عن إنتاج المقاس المطلوب ولن يورد الباقي',supplier_confirmation:'خطاب المورد المصطنع رقم 4'})).id;
  tx(()=>decideOrderChange(db,users.manager,close,'approve',{note:'يُغطى الباقي بطلب شراء جديد'}));
  p=read(p);assert.equal(p.order.closed_short,true);
  assert.throws(()=>act('employee',p,'receive',{quantity:1,reference:'receipt-2',evidence:'محاولة استلام بعد الإقفال'}),code('closed_short'));
  assert.throws(()=>db.prepare("INSERT INTO procurement_receipts VALUES('x',?,1,'R-X','دليل مصطنع كافٍ','employee',9,'2026-01-01T00:00:00.000Z')").run(p.id),/closed short/);
  assert.throws(()=>db.prepare("UPDATE procurement_order_changes SET reason='تعديل صامت لسبب التغيير المعتمد'").run(),/final/);
});

test('conflict of interest: an undecided disclosure or a recusal blocks that person from awarding to the vendor, and only the legal reviewer lifts it',t=>{
  const {db,users,tx,read,quote,sourcing}=fixture(t);
  // الاختبار يقصد المورد محل الإفصاح، لا أول عرض بعد ترتيب الطوابع الزمنية والمعرفات.
  const award=p=>tx(()=>procurementAction(db,users.manager,p.id,'award',{version:p.version,quote_id:p.quotes.find(q=>q.supplier_key==='DEMO-PRINT').id,note:'ترسية مصطنعة على المورد محل الإفصاح'}));
  let p=quote(quote(quote(sourcing(),'DEMO-PRINT','10.00'),'supplier-b','11.00'),'supplier-c','12.00');
  assert.throws(()=>tx(()=>discloseConflict(db,users.manager,{supplier_key:'not-registered',relationship:'family',description:'قريب من الدرجة الأولى يملك حصة في المورد'})),code('vendor_not_found'));
  const id=tx(()=>discloseConflict(db,users.manager,{supplier_key:'demo-print',relationship:'family',description:'قريب من الدرجة الأولى يملك حصة في المورد'})).id;
  assert.throws(()=>tx(()=>discloseConflict(db,users.manager,{supplier_key:'DEMO-PRINT',relationship:'gift_or_benefit',description:'إفصاح ثانٍ عن المورد نفسه قبل البت'})),code('duplicate_disclosure'));
  assert.throws(()=>award(read(p,'manager')),code('conflict_of_interest'));
  assert.equal(procurementExtras(db,users.employee).disclosures.length,0,'colleagues do not see the disclosure');
  assert.throws(()=>tx(()=>decideConflict(db,users.manager,id,'no_conflict',{note:'أقرر بنفسي أنه لا تعارض',conditions:''})),code('invalid_state'));
  assert.throws(()=>tx(()=>decideConflict(db,users.legal,id,'managed',{note:'يُدار بشروط دون ذكرها',conditions:''})),code('invalid_text'));
  tx(()=>decideConflict(db,users.legal,id,'recused',{note:'الحصة مؤثرة؛ يتنحى عن كل قرارات هذا المورد',conditions:''}));
  assert.throws(()=>award(read(p,'manager')),code('conflict_of_interest'));
  assert.throws(()=>tx(()=>decideConflict(db,users.manager,id,'withdraw',{note:'أسحب التنحي عن نفسي',conditions:''})),code('invalid_state'));
  // العرض الآخر غير المتأثر يبقى متاحًا للشخص نفسه.
  const other=read(p,'manager'),awarded=tx(()=>procurementAction(db,users.manager,other.id,'award',{version:other.version,quote_id:other.quotes.find(q=>q.supplier_key==='SUPPLIER-B').id,note:'ترسية على مورد آخر لا علاقة للمراجع به'}));
  assert.equal(awarded.status,'awarded');
  tx(()=>decideConflict(db,users.legal,id,'withdraw',{note:'بِيعت الحصة ووُثق ذلك بخطاب',conditions:''}));
  assert.equal(procurementExtras(db,users.manager).disclosures[0].status,'withdrawn');
  assert.throws(()=>db.prepare("UPDATE vendor_conflict_disclosures SET status='no_conflict'").run(),/decided once/);
  assert.ok(verifyAudit(db));
});
