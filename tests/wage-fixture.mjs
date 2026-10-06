import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { getRun, prepareRun, runAction } from '../app/payroll.mjs';
import { recordEmployeeBank, decideEmployeeBank, proposeAdjustment, decideAdjustment, preparePayrollPayment, payrollPaymentAction, extrasBoard } from '../app/payroll-extras.mjs';
import { addDocument } from '../app/employees.mjs';
import { payrollBooks } from './payroll-books.mjs';

// بيئة مصطنعة مشتركة لاختبارات حماية الأجور: سياسات وعقود ومسيرات وحسابات بنكية ووثائق، كلها بأسماء تجريبية.
export function iban(bban){
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let r=0;for(const d of numeric)r=(r*10+Number(d))%97;
  return 'SA'+String(98-r).padStart(2,'0')+bban;
}
export function fixture(t,password='synthetic-wage'){
  const db=openDb(':memory:');seed(db,password);t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES"+
    "('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused','manager',NULL),"+
    "('reviewer','36t','hr','reviewer','مراجع الرواتب التجريبي','unused','employee','hr-manager'),"+
    "('new-hire','36t','creative','new-hire','موظفة تجريبية جديدة','unused','employee','manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(userId,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:userId,capability,note:'تصريح رواتب تجريبي'}));
  for(const capability of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',capability);
  grant('reviewer','payroll.review');

  const policy=(kind,parameters)=>{
    const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة تجريبي كافٍ الطول لأغراض الاختبار الآلي وحده.',basis:'قرار إدارة تجريبي',effective_from:'2020-01-01',parameters}));
    tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد تجريبي للاختبار'}));
  };
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500});

  const step=(who,contractId,action,values={})=>tx(()=>contractAction(db,users[who],contractId,action,{version:getContract(db,users[who],contractId).version,...values}));
  const contract=(userId,pay_lines=[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],start='2026-01-01')=>{
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id:userId,contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,pay_lines,document_reference:'عقد تجريبي'}));
    step('hr',id,'submit_contract');step('hr-manager',id,'approve_contract');return id;
  };
  const amend=(previousId,userId,pay_lines,start)=>{
    const {id}=tx(()=>prepareContract(db,users.hr,{user_id:userId,contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:0,notice_days:60,pay_lines,document_reference:'عقد تجريبي معدل',change_reason:'تعديل تجريبي موثق للاختبار الآلي'},previousId));
    step('hr',id,'submit_contract');step('hr-manager',id,'approve_contract');return id;
  };
  const endContract=(contractId,endedOn)=>step('hr-manager',contractId,'end_contract',{ended_on:endedOn,reason:'إنهاء تجريبي موثق للاختبار الآلي'});

  const bank=(userId,bban,month='2026-01')=>{
    const {id}=tx(()=>recordEmployeeBank(db,users.hr,{user_id:userId,bank_name:'بنك تجريبي',iban:iban(bban),effective_month:month,evidence:'خطاب بنكي تجريبي باسم الموظف'}));
    tx(()=>decideEmployeeBank(db,users['hr-manager'],id,'verify',{note:'طابقت الخطاب البنكي مع اسم الموظف'}));return id;
  };
  const document=(userId,expires='2030-12-31',docType='national_id')=>tx(()=>addDocument(db,users.hr,userId,{doc_type:docType,reference:'آخر 4 أرقام 1234',issued_on:'2020-01-01',expires_on:expires,note:'وثيقة تجريبية'}));
  const adjustment=(userId,kind,month,amount)=>{
    const {id}=tx(()=>proposeAdjustment(db,users.hr,{user_id:userId,kind,month,amount,reason:'حركة تجريبية موثقة لأغراض الاختبار'}));
    tx(()=>decideAdjustment(db,users['hr-manager'],id,'approve',{note:'اعتماد تجريبي'}));return id;
  };

  const draftRun=month=>getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month})).id);
  const act=(who,run,action,values={})=>tx(()=>runAction(db,users[who],run.id,action,{version:run.version,...values}));
  const approveRun=month=>{
    let run=act('hr',draftRun(month),'submit_run');
    run=getRun(db,users.reviewer,run.id);
    for(const line of run.lines.filter(l=>l.variance_flag))run=act('reviewer',run,'justify',{line_id:line.id,note:'فرق مفسر بحركة معتمدة في هذا الشهر'});
    run=act('reviewer',run,'pass_review',{note:'طابقت الحركات المعتمدة مع السطور'});
    return act('hr-manager',getRun(db,users['hr-manager'],run.id),'approve_run',{note:'اعتماد تجريبي'});
  };
  // تحويل معتمد للمسير (الحزمة 4): يُعدّه hr ويعتمده hr-manager بعد ترحيل قيد المسير بدفاتر تجريبية (D5)؛ ونسخة حماية الأجور تُصدَّر منه (D7).
  const approvedTransfer=run=>{
    const paymentId=tx(()=>preparePayrollPayment(db,users.hr,{run_id:run.id})).id;
    payrollBooks(db).postRun(run.id);
    const version=extrasBoard(db,users['hr-manager']).payments.find(p=>p.id===paymentId).version;
    tx(()=>payrollPaymentAction(db,users['hr-manager'],paymentId,'approve_payment',{version,note:'طابقت الإجمالي مع المسير المعتمد'}));
    return paymentId;
  };
  return {db,users,tx,contract,amend,endContract,bank,document,adjustment,draftRun,approveRun,act,approvedTransfer};
}
