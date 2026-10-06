import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { createFinanceReference } from '../app/finance.mjs';
import { PURPOSES, recordMapping } from '../app/ledger.mjs';

// دليل حسابات تجريبي مبسط لوكالة خدمات، مع ربط محاسبي مقترح لكل غرض تستخدمه المنصة.
// الربط يُسجل بانتظار الاعتماد عمدًا: اعتماده قرار شخص مالي آخر داخل المنصة. الدليل ليس دليل الشركة المعتمد؛ يراجعه المحاسب قبل أي بيانات حقيقية.
const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};
const CHART=[['1000','البنك — الحساب الجاري','asset','bank'],['1100','ذمم العملاء','asset','receivable'],['1150','ضريبة مدخلات قابلة للخصم','asset','input_vat'],['1200','سلف الموظفين','asset','employee_advances'],['1210','عهد الموظفين','asset','employee_custody'],
  ['1500','الأصول الثابتة','asset',null],['1590','مجمع الإهلاك','asset','accumulated_depreciation'],
  ['2000','ذمم الموردين','liability','payable'],['2100','رواتب مستحقة الدفع','liability','salaries_payable'],['2110','تأمينات مستحقة عن الموظفين','liability','social_insurance_payable'],['2120','مستحقات للموظفين عن مصروفات','liability','employee_payable'],['2130','محسوم من الرواتب بأحكام قضائية','liability','garnishment_payable'],['2140','غرامات العمال المحسومة (سجل خاص)','liability','employee_fines_payable'],['2150','حسومات رواتب تنتظر توجيهها','liability','payroll_deductions_clearing'],['2200','ضريبة مخرجات مستحقة','liability','output_vat'],['2300','استقطاع مستحق للهيئة','liability','withholding_payable'],['2400','دفعات مقدمة من العملاء','liability','customer_advances'],
  ['3000','رأس المال','equity',null],['3900','أرباح مبقاة','equity','retained_earnings'],
  ['4000','إيراد الخدمات','income','revenue'],['4100','عوائد وفوائد بنكية','income','interest_income'],
  ['5000','رواتب وأجور','expense','salaries_expense'],['5010','حصة المنشأة في التأمينات','expense','social_insurance_employer_expense'],['5100','مصروفات تشغيلية','expense','general_expense'],['5200','تكلفة موردين ومستقلين','expense','supplier_cost'],['5300','إيجار ومرافق','expense',null],['5400','اشتراكات برمجية','expense',null],['5500','رسوم ومصاريف بنكية','expense','bank_charges'],['5900','مصروف الإهلاك','expense','depreciation_expense']];
export function seedFinanceDemo(db){
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to add a demo chart of accounts to this database.');
  const holder=action=>db.prepare("SELECT u.* FROM users u WHERE u.tenant_id='36t' AND u.active=1 AND EXISTS(SELECT 1 FROM finance_grants g WHERE g.user_id=u.id AND g.action=? AND g.revoked_at IS NULL AND g.valid_from<=? AND g.valid_until>?) ORDER BY u.id").all(action,new Date().toISOString(),new Date().toISOString());
  const configurer=holder('configure')[0],preparer=holder('prepare')[0];
  if(!configurer||!preparer)return {accounts:0,mappings:0,skipped:'لا يوجد حامل تفويض مالي (إعداد/تحضير) في هذه القاعدة'};
  const tx=f=>transaction(db,f);let accounts=0,mappings=0;
  for(const [code,name,type] of CHART)if(!db.prepare("SELECT 1 FROM finance_accounts WHERE tenant_id='36t' AND code=?").get(code)){tx(()=>createFinanceReference(db,configurer,'accounts',{code,name:`${name} (تجريبي)`,account_type:type,currency:'SAR'}));accounts++;}
  let center=db.prepare("SELECT id FROM finance_cost_centers WHERE tenant_id='36t' AND active=1 ORDER BY code LIMIT 1").get();
  if(!center)center=tx(()=>createFinanceReference(db,configurer,'cost_centers',{code:'GEN',name:'عام (تجريبي)'}));
  const year=new Date().getUTCFullYear();
  if(!db.prepare("SELECT 1 FROM finance_periods WHERE tenant_id='36t' AND starts_on<=? AND ends_on>=?").get(`${year}-06-30`,`${year}-06-30`))tx(()=>createFinanceReference(db,configurer,'periods',{name:`سنة ${year} (تجريبي)`,starts_on:`${year}-01-01`,ends_on:`${year}-12-31`}));
  for(const [code,,,purpose] of CHART){
    if(!purpose||!PURPOSES.some(p=>p.key===purpose)||db.prepare("SELECT 1 FROM finance_account_mappings WHERE tenant_id='36t' AND purpose=?").get(purpose))continue;
    const account=db.prepare("SELECT id FROM finance_accounts WHERE tenant_id='36t' AND code=? AND active=1").get(code);if(!account)continue;
    tx(()=>recordMapping(db,preparer,{purpose,account_id:account.id,cost_center_id:center.id,effective_from:`${year}-01-01`}));mappings++;
  }
  return {accounts,mappings,skipped:null};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo chart of accounts is disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{const r=seedFinanceDemo(db);console.log(r.skipped?`Demo chart of accounts skipped: ${r.skipped}`:`Demo chart of accounts: ${r.accounts} accounts added, ${r.mappings} mappings recorded and awaiting approval.`);}finally{db.close();}
}
