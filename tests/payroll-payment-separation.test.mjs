import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { getRun, prepareRun, runAction } from '../app/payroll.mjs';
import { extrasBoard, recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, payrollPaymentAction } from '../app/payroll-extras.mjs';
import { payrollBooks } from './payroll-books.mjs';

/* فصل المهام في مسار صرف الرواتب — العيب الذي أوجب هذا الملف:
 *
 * مسير الرواتب نفسه يفصل ثلاث خطوات على ثلاثة أشخاص، ويفحص **هوية** من سبقه لا تصريحه:
 *   app/payroll.mjs:186 — المراجعة تشترط run.prepared_by !== u.id
 *   app/payroll.mjs:187 — الاعتماد يشترط prepared_by !== u.id **و** reviewed_by !== u.id
 * فحتى من يحمل التصاريح الثلاثة لا يتجاوز خطوتين على المسير. هذا هو المعيار الذي وضعته المنصة لنفسها.
 *
 * ثم يأتي **الصرف** — وهو آخر خطوة، وهي التي تُخرج المال فعلًا — فيسقط الشرط الثاني:
 *   app/payroll-extras.mjs:82 — الاعتماد يشترط prepared_by !== u.id ✔
 *   app/payroll-extras.mjs:83 — تسجيل التنفيذ يشترط prepared_by !== u.id **فقط** ✘
 * فمن يحمل payroll.approve وpayroll.review يعتمد ملف التحويل (وفيه الآيبانات) ثم يسجّل تنفيذه
 * بمرجع بنكي ودليل من كتابته هو. خطوتان من أربع في مسار المال بشخص واحد، بلا إنسان ثانٍ.
 *
 * ومصفوفة `actions` هي التنفيذ لا مجرد العرض: payrollPaymentAction عند :329 يرفض بـ
 * `if(!p.actions.includes(action))` ولا فحص آخر في أي موضع.
 *
 * ونفس الثغرة في المخالصات (:90): من اعتمد المخالصة يسجّل صرف مستحقاتها.
 *
 * وليست فرضية: قياس 29 سبتمبر 2026 على قاعدة التشغيل — أربعة تصاريح رواتب سارية،
 * و**حساب واحد يحمل payroll.approve وpayroll.review معًا**.
 *
 * والاختبار القائم في tests/payroll-extras.test.mjs («PAY-07») يمرّر المسار السعيد بشخصين
 * مختلفين، فلا يلمس هذه الحالة أصلًا.
 */

const code = value => error => error.code === value;
// تاريخ التنفيذ يجب أن يقع بين اعتماد الدفع واليوم — المنصة تفرضه، فيُقرأ من الساعة لا يُثبَّت.
const today = () => new Date(Date.now()+3*3600000).toISOString().slice(0,10);
function iban(bban){const n=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of n)r=(r*10+Number(d))%97;return 'SA'+String(98-r).padStart(2,'0')+bban;}

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-payroll-separation');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES"
    +"('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused','manager',NULL),"
    +"('reviewer','36t','hr','reviewer','مراجع الرواتب التجريبي','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح رواتب تجريبي'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  grant('reviewer','payroll.review');
  // الحالة المقيسة على قاعدة التشغيل: حسابٌ واحد يحمل الاعتماد والمراجعة معًا.
  grant('hr-manager','payroll.review');
  const policy=(kind,parameters)=>{
    const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,
      body:'نص سياسة تجريبي كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة تجريبي لسنة 2026',
      effective_from:'2020-01-01',parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد تجريبي للاختبار'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,
    social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const {id:contractId}=transaction(db,()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',
    job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2026-01-01',weekly_hours:40,probation_days:90,
    notice_days:60,pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],
    document_reference:'عقد تجريبي'}));
  for(const [who,action] of [['hr','submit_contract'],['hr-manager','approve_contract']])
    transaction(db,()=>contractAction(db,users[who],contractId,action,{version:getContract(db,users[who],contractId).version}));
  const step=(who,r,action,values={})=>transaction(db,()=>runAction(db,users[who],r.id,action,{version:r.version,...values}));
  const approveRun=month=>{
    let r=getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month})).id);
    r=step('hr',r,'submit_run');r=getRun(db,users.reviewer,r.id);
    for(const l of r.lines.filter(l=>l.variance_flag))r=step('reviewer',r,'justify',{line_id:l.id,note:'فرق مفسر بحركة معتمدة في هذا الشهر'});
    r=step('reviewer',r,'pass_review',{note:'طابقت الحركات المعتمدة مع السطور'});
    return step('hr-manager',getRun(db,users['hr-manager'],r.id),'approve_run');};
  return {db,users,approveRun};
}

test('من اعتمد صرف الرواتب لا يسجّل تنفيذه، ولو حمل تصريح المراجعة',t=>{
  const {db,users,approveRun}=fixture(t);
  const run=approveRun('2026-02');
  const bankId=transaction(db,()=>recordEmployeeBank(db,users.hr,{user_id:'employee',bank_name:'بنك تجريبي',
    iban:iban('80000000000000000021'),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم الموظفة'})).id;
  transaction(db,()=>decideEmployeeBank(db,users['hr-manager'],bankId,'verify',{note:'طابقت الخطاب البنكي مع اسم الموظفة'}));
  const paymentId=transaction(db,()=>preparePayrollPayment(db,users.hr,{run_id:run.id})).id;
  const act=(who,action,values={})=>transaction(db,()=>payrollPaymentAction(db,users[who],paymentId,action,
    {version:extrasBoard(db,users[who]).payments[0].version,...values}));

  // المُعِدّ لا يعتمد — الشرط القائم، ويجب أن يبقى.
  assert.throws(()=>act('hr','approve_payment',{note:'اعتماد من المُعد'}),code('action_unavailable'));
  // الحزمة 4 (P4-HR-3، D5): التحويل لا يُعتمد قبل ترحيل قيد مسيره؛ يُرحَّل بدفاتر تجريبية قبل الاعتماد.
  payrollBooks(db).postRun(run.id);
  act('hr-manager','approve_payment',{note:'طابقت الإجمالي مع المسير المعتمد'});

  // وهنا العيب: المعتمِد نفسه يسجّل التنفيذ لأن الشرط لا يفحص إلا المُعِدّ.
  assert.throws(()=>act('hr-manager','record_payment_execution',
    {executed_on:today(),bank_reference:'PAY-TRX-SELF',evidence:'إشعار تنفيذ تجريبي من بنك الشركة'}),
    code('action_unavailable'),
    'من اعتمد ملف التحويل — وفيه آيبانات الموظفين — سجّل تنفيذه بنفسه بمرجع بنكي ودليل من كتابته. '
    + 'مسير الرواتب يفحص المُعِدّ والمراجع معًا (app/payroll.mjs:187)؛ والصرف نسي الشرط الثاني.');

  // ومن لم يعتمد يسجّله كما كان: الحصر يحصر ولا يشلّ.
  const done=act('reviewer','record_payment_execution',
    {executed_on:today(),bank_reference:'pay-trx-1',evidence:'إشعار تنفيذ تجريبي من بنك الشركة'});
  assert.equal(done.status,'executed');
});
