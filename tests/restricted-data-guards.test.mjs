// ثلاث ثغرات حول البيانات الشخصية المقيدة، كلٌّ منها مثبَّتة هنا بالسلوك الذي كان يمرّ قبل الإصلاح:
//   1) حارس رقم الهوية في مرجع وثيقة الموظف كان يُكسَر بفاصل (فراغ، شرطة، رقم غير لاتيني).
//   2) حساب راتب الموظف لم يكن في القاعدة ما يمنع أن يسجّله صاحبه.
//   3) كشف آيبان المورد كان يمرّ بلا أثر في سجل التدقيق.
// أرقام الهوية والآيبان هنا مصطنعة بالكامل، والأسماء أسماء بذرة الاختبار لا أسماء موظفين.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { addDocument } from '../app/employees.mjs';
import { createVendor, getVendor, listVendors, vendorAction } from '../app/vendors.mjs';

const errorCode=expected=>error=>error.code===expected;
const day=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));
function fixture(t){
  const db=openDb(':memory:');
  seed(db,'synthetic-restricted-data-only');
  t.after(()=>db.close());
  return {db,users:Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]))};
}

/* ───── 1) مرجع الوثيقة: الفاصل لا يمشي برقم الهوية ───── */

test('PII-01: a full identity number is refused in a document reference however its digits are separated',t=>{
  const {db,users}=fixture(t);
  const add=reference=>transaction(db,()=>addDocument(db,users.hr,'employee',{doc_type:'iqama',reference,expires_on:day(90)}));
  // الحارس السابق كان يبحث عن ست خانات **متلاصقة** بعد أن يعدّ الخانات كلها، فكل صورة من هذه الصور كانت تمرّ
  // ويُخزَّن رقم كامل يعود بطيّ فاصله. كلها الآن مرفوضة.
  for(const bypass of ['1 0 9 8 7 6 5 4 3 2','109-876-5432','109 876 5432','1.0.9.8.7.6.5.4.3.2','١٠٩٨٧٦٥٤٣٢','１０９８７６５４３２','109​8765432','109­8765432'])
    assert.throws(()=>add(bypass),errorCode('reference_number'),`separated identity number must be refused: ${JSON.stringify(bypass)}`);
  // وما كان مرفوضًا يبقى مرفوضًا.
  assert.throws(()=>add('1098765432'),errorCode('reference_number'));
  // والرفض مكتوب: ما رُفض، وما الناقص ومن يملكه، والخطوة التالية.
  const refusal=(()=>{try{add('109-876-5432');}catch(error){return error;}})();
  assert.equal(refusal.status,400);
  assert.ok(refusal.details.refusal.what.includes('مرجع الوثيقة'),'the refusal names the field that was refused');
  assert.equal(refusal.details.refusal.missing.length,1);
  assert.ok(refusal.details.refusal.missing[0].owner.length>3,'the refusal names who supplies what is missing');
  assert.ok(refusal.details.refusal.next.length>3,'the refusal names the next step');
});

test('PII-02: the tighter guard still accepts the short labels the field is for',t=>{
  const {db,users}=fixture(t);
  const add=reference=>transaction(db,()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference,expires_on:day(120)}));
  // الحروف حاجز، فالتسمية المختصرة تمرّ كما كانت تمرّ قبل الإصلاح.
  for(const legitimate of ['آخر 4 أرقام 1234','عقد 2024','جواز السفر','آخر أربع خانات 9031','<b>وسم</b> 4412'])
    assert.ok(add(legitimate).documents.some(d=>d.reference===legitimate),`a short label must still be accepted: ${legitimate}`);
});

/* ───── 2) حساب راتب الموظف: قاعدة الشخصين في القاعدة لا في الكود ───── */

test('PII-03: the database itself refuses a salary account recorded by its own owner',t=>{
  const {db}=fixture(t);
  const row=(id,userId,recordedBy)=>db.prepare("INSERT INTO employee_bank_accounts(id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,effective_month,created_at) VALUES(?,'36t',?,'بنك مصطنع','enc:v1:synthetic','6519','خطاب بنكي مصطنع مرفق بالطلب','pending',?,'2026-09',?)")
    .run(id,userId,recordedBy,new Date().toISOString());
  // إدخال مباشر يتجاوز app/payroll-extras.mjs كله: لا حارس كود بينه وبين الجدول.
  assert.throws(()=>row('own-account','employee','employee'),/CHECK constraint failed: recorded_by<>user_id/,'nobody records their own salary account');
  // والصفّ الذي سجّله شخص آخر يُقبل كما كان.
  row('other-account','employee','hr');
  const saved=db.prepare('SELECT user_id,recorded_by FROM employee_bank_accounts WHERE id=?').get('other-account');
  assert.equal(saved.user_id,'employee');
  assert.equal(saved.recorded_by,'hr');
  // وقاعدتا 031 باقيتان: المسجِّل لا يتحقق من تسجيله، والصفّ لا يُحذف.
  assert.throws(()=>db.prepare("UPDATE employee_bank_accounts SET status='verified',decided_by='hr',decided_at=? WHERE id=?").run(new Date().toISOString(),'other-account'),/bank records keep their history|CHECK constraint failed/);
  assert.throws(()=>db.prepare('DELETE FROM employee_bank_accounts WHERE id=?').run('other-account'),/bank records keep their history/);
});

/* ───── 3) كشف آيبان المورد يترك أثرًا ───── */

// آيبان مصطنع بخانتي تحقق صحيحتين؛ لا يمثل حسابًا حقيقيًا.
function syntheticIban(bban){
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of numeric)remainder=(remainder*10+Number(digit))%97;
  return 'SA'+String(98-remainder).padStart(2,'0')+bban;
}
const IBAN=syntheticIban('80000000000000000007');

function vendorWithBank(t){
  const {db,users}=fixture(t);
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع'}));
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr',capability:'vendors.bank',note:'تصريح اختبار مصطنع'}));
  const {id}=transaction(db,()=>createVendor(db,users.employee,{legal_name:'شركة التوريد المصطنعة',trade_name:'مورد الاختبار',entity_type:'company',country:'SA',entity_ref:'1010000007',vat_number:'300000000000003',categories:['print_gifts'],regions:'الرياض',payment_terms:'ثلاثون يومًا بعد المطابقة',data_source:'نموذج تسجيل مصطنع'}));
  const before=getVendor(db,users.employee,id);
  transaction(db,()=>vendorAction(db,users.employee,id,'propose_bank',{version:before.version,bank_name:'بنك مصطنع',account_holder:'شركة التوريد المصطنعة',iban:IBAN,reason:'تسجيل الحساب الأول للمورد'}));
  return {db,users,vendorId:id};
}
const reveals=(db,vendorId)=>db.prepare("SELECT actor_id,entity_type,entity_id,after_json FROM audit_events WHERE action='vendor.bank_iban_revealed' AND entity_id=? ORDER BY seq").all(vendorId);

test('PII-04: revealing a vendor IBAN writes exactly one audit event naming the actor and the vendor',t=>{
  const {db,users,vendorId}=vendorWithBank(t);
  const start=reveals(db,vendorId).length;
  const view=getVendor(db,users.hr,vendorId);
  assert.equal(view.bank[0].iban,IBAN,'the finance reviewer reads the full account');
  assert.equal(view.bank[0].masked,false);
  const written=reveals(db,vendorId).slice(start);
  assert.equal(written.length,1,'one reveal, one record');
  assert.equal(written[0].actor_id,'hr','the record names who asked');
  assert.equal(written[0].entity_type,'vendor');
  assert.equal(written[0].entity_id,vendorId,'the record names which vendor');
  const after=JSON.parse(written[0].after_json);
  assert.equal(after.accounts,1);
  assert.deepEqual(after.bank_account_ids,[view.bank[0].id]);
  assert.ok(!JSON.stringify(after).includes(IBAN),'the record says that the account was opened, never what it is');
  assert.ok(verifyAudit(db),'the audit chain stays intact');
});

test('PII-05: a refused reveal writes nothing, and an action records the reveal once',t=>{
  const {db,users,vendorId}=vendorWithBank(t);
  // بلا تصريح التحقق المالي: آخر أربع خانات لا الآيبان — وهذا امتناع عن الكشف، فلا يُسجَّل.
  const start=reveals(db,vendorId).length;
  const masked=getVendor(db,users.manager,vendorId);
  assert.equal(masked.bank[0].masked,true);
  assert.ok(!masked.bank[0].iban.includes(IBAN.slice(4)),'a masked account never carries the number');
  listVendors(db,users.manager);
  assert.equal(reveals(db,vendorId).length,start,'a refused reveal leaves no record');
  // وفعلٌ يقوم به صاحب التصريح المالي يبني التفاصيل مرتين — بوابةً ثم ردًّا — ويُسجَّل الكشف مرة واحدة.
  const current=getVendor(db,users.hr,vendorId);
  const beforeAction=reveals(db,vendorId).length;
  transaction(db,()=>vendorAction(db,users.hr,vendorId,'verify_bank',{version:current.version,bank_id:current.bank[0].id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع يطابق اسم صاحب الحساب',effective_from:day(0)}));
  assert.equal(reveals(db,vendorId).length-beforeAction,1,'the gate does not decrypt; only the response does');
  assert.ok(verifyAudit(db));
});
