// دفاتر مصطنعة لمحاسبة الرواتب (الحزمة 4، P4-HR-3): يُركَّب على أي قاعدة اختبار فيها مسير معتمد، فيرحّل قيد المسير بالمسار الحقيقي
// (journalFromSource ثم التقديم والاعتماد والترحيل بيدين). يحتاجه كل اختبار يعتمد تحويل رواتب، لأن التحويل لا يُعتمد قبل ترحيل قيد
// مسيره (D5).
//
// كل ما هنا تجريبي: حسابان ماليان بأسماء «دفاتر تجريبية»، ودليل حسابات برموز scripts/seed-finance-demo.mjs، ومركز تكلفة لكل إدارة
// في الكيان. لا حساب بنكي ولا مبلغ ولا اسم حقيقي.
import { randomUUID } from 'node:crypto';
import { transaction, now } from '../app/db.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import { recordDepartmentCentre, decideDepartmentCentre } from '../app/payroll-ledger.mjs';

// رموز الدليل التجريبي نفسها في scripts/seed-finance-demo.mjs.
export const PAYROLL_CHART={salaries_expense:['5000','رواتب وأجور تجريبية','expense'],social_insurance_employer_expense:['5010','حصة المنشأة في التأمينات تجريبية','expense'],
  salaries_payable:['2100','رواتب مستحقة الدفع تجريبية','liability'],social_insurance_payable:['2110','تأمينات مستحقة تجريبية','liability'],
  employee_advances:['1200','سلف الموظفين تجريبية','asset'],garnishment_payable:['2130','محسوم بأحكام قضائية تجريبي','liability'],
  employee_fines_payable:['2140','غرامات العمال تجريبية','liability'],payroll_deductions_clearing:['2150','حسومات تنتظر توجيهها تجريبية','liability'],
  bank:['1000','البنك التجريبي','asset']};
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};

// departments: {إدارة: رمز مركزها}. ما لا يُذكر يأخذ مركزًا باسمه (CC-<الإدارة>). mapDepartments:false يترك الإدارات بلا مركز.
export function payrollBooks(db,{tenantId='36t',departments={},mapDepartments=true,effectiveFrom='2020-01-01'}={}){
  const tx=run=>transaction(db,run);
  // محاسبان تجريبيان: معدٌّ (قراءة وإعداد وتحضير) ومعتمد مرحِّل (قراءة واعتماد وترحيل). لا يقعان في أدوار المسير.
  for(const [id,name,role] of [['books-preparer','معدّ الدفاتر التجريبي','employee'],['books-approver','معتمد الدفاتر التجريبي','manager']])
    if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))
      db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,?, 'ops',?,?,password_hash,?,NULL FROM users WHERE id='admin'").run(id,tenantId,id,name,role);
  const users=Object.fromEntries(db.prepare("SELECT * FROM users WHERE id IN ('books-preparer','books-approver')").all().map(u=>[u.id,u]));
  const grant=(userId,actions)=>{for(const action of actions)if(!db.prepare('SELECT 1 FROM finance_grants WHERE user_id=? AND action=? AND revoked_at IS NULL').get(userId,action))
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenantId,userId,users[userId].role,action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض دفاتر تجريبي',null,now());};
  grant('books-preparer',['read','configure','prepare']);grant('books-approver',['read','configure','approve','post']);
  const preparer=users['books-preparer'],approver=users['books-approver'];
  const ref=(kind,input)=>tx(()=>f.createFinanceReference(db,preparer,kind,input));
  const accounts=Object.fromEntries(Object.entries(PAYROLL_CHART).map(([purpose,[code,name,type]])=>[purpose,
    db.prepare('SELECT * FROM finance_accounts WHERE tenant_id=? AND code=?').get(tenantId,code)??ref('accounts',{code,name,account_type:type,currency:'SAR'})]));
  const centre=code=>db.prepare('SELECT * FROM finance_cost_centers WHERE tenant_id=? AND code=?').get(tenantId,code)??ref('cost_centers',{code,name:`مركز ${code} التجريبي`});
  const general=centre('GEN');
  for(const [purpose,account] of Object.entries(accounts))if(!db.prepare('SELECT 1 FROM finance_account_mappings WHERE tenant_id=? AND purpose=? AND approved_by IS NOT NULL').get(tenantId,purpose)){
    const {id}=tx(()=>recordMapping(db,preparer,{purpose,account_id:account.id,cost_center_id:general.id,effective_from:'2020-01-01'}));
    tx(()=>approveMapping(db,approver,id,{note:'طابقت الحساب مع الدليل التجريبي'}));
  }
  const mapDepartment=(departmentId,code,effective_from=effectiveFrom)=>{
    const cost_center_id=centre(code).id;
    const {id}=tx(()=>recordDepartmentCentre(db,preparer,{department_id:departmentId,cost_center_id,effective_from,reason:'ربط إدارة تجريبية بمركز تكلفتها'}));
    return tx(()=>decideDepartmentCentre(db,approver,id,'approve',{note:'طابقت المركز مع هيكل الإدارات التجريبي'}));
  };
  if(mapDepartments)for(const d of db.prepare('SELECT id FROM departments WHERE tenant_id=? AND active=1 ORDER BY id').all(tenantId))
    if(!db.prepare("SELECT 1 FROM department_cost_centres WHERE tenant_id=? AND department_id=? AND status='approved'").get(tenantId,d.id))mapDepartment(d.id,departments[d.id]??`CC-${d.id.toUpperCase()}`);
  // فترة محاسبية تغطي الشهر (تُنشأ شهرًا شهرًا عند الحاجة، فلا تتداخل).
  const period=dateOrMonth=>{
    const date=dateOrMonth.length===7?monthEnd(dateOrMonth):dateOrMonth;
    return db.prepare("SELECT * FROM finance_periods WHERE tenant_id=? AND starts_on<=? AND ends_on>=?").get(tenantId,date,date)
      ??ref('periods',{name:`شهر ${date.slice(0,7)} التجريبي`,starts_on:`${date.slice(0,7)}-01`,ends_on:monthEnd(date.slice(0,7))});
  };
  const journal=(kind,id,date)=>{const period_id=period(date).id;return tx(()=>journalFromSource(db,preparer,{source_kind:kind,source_id:id,period_id}));};
  const act=(who,j,action)=>tx(()=>f.journalAction(db,who,j.id,action,{version:j.version,note:'دليل قرار مالي تجريبي'}));
  const post=j=>act(approver,act(approver,act(preparer,j,'submit'),'approve'),'post');
  // قيد المسير: يُجهَّز ويُقدَّم ويُعتمد ويُرحَّل، بتاريخ آخر يوم من شهره.
  const postRun=runId=>{const run=db.prepare('SELECT month FROM payroll_runs WHERE id=?').get(runId);return post(journal('payroll_run',runId,run.month));};
  return {users,preparer,approver,accounts,centre,general,mapDepartment,period,journal,post,postRun,tx};
}
// سطور قيد بصيغة مقروءة: [رمز الحساب، رمز المركز، مدين، دائن].
export const linesOf=(db,journalId)=>db.prepare('SELECT l.debit_minor,l.credit_minor,a.code,c.code AS centre FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY l.position').all(journalId)
  .map(l=>[l.code,l.centre,l.debit_minor,l.credit_minor]);
