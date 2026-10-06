import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy } from '../app/hr-contracts.mjs';

// تجهيز عرض الحضور والرواتب: تصاريح للحسابات التجريبية، ومسودة سياسة دورة رواتب تنتظر اعتماد مدير الموارد البشرية.
// لا تُعتمد السياسة هنا عمدًا: الاعتماد قرار مدير الموارد البشرية داخل المنصة.
const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};
export function seedPayrollDemo(db){
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to add demo payroll setup to this database.');
  if(db.prepare("SELECT 1 FROM hr_policies WHERE tenant_id='36t' AND kind='payroll_cycle'").get())return 0;
  const user=(...ids)=>{for(const id of ids){const u=db.prepare("SELECT * FROM users WHERE id=? AND tenant_id='36t' AND active=1").get(id);if(u)return u;}throw new Error('Missing synthetic account: '+ids.join('/'));};
  const admin=user('admin'),officer=user('hr'),manager=user('head-hr','manager'),reviewer=user('head-finance','outsider');
  const grant=(u,capability)=>{try{transaction(db,()=>grantAccess(db,admin,{user_id:u.id,capability,note:'تصريح عرض تجريبي للحضور والرواتب'}));}catch(error){if(!['already_granted','already_default'].includes(error.code))throw error;}};
  grant(manager,'hr.attendance.approve');grant(manager,'payroll.approve');grant(reviewer,'payroll.review');
  transaction(db,()=>preparePolicy(db,officer,{kind:'payroll_cycle',title:'دورة الرواتب (تجريبي)',body:'يُعد المسير شهريًا ويُصرف في اليوم السابع والعشرين. أساس اليوم ثلاثون يومًا. نسبة الاستقطاع المدخلة هنا قيمة عرض تجريبية يجب أن يستبدلها مدير الموارد البشرية بالنسبة النظامية السارية وسندها قبل أي بيانات حقيقية.',basis:'مسودة عرض تجريبية؛ ليست قرارًا فعليًا ولا نسبة نظامية مؤكدة',effective_from:'2026-01-01',parameters:{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:500}}));
  return 1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo payroll setup is disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{console.log(`Demo payroll setup: ${seedPayrollDemo(db)?'draft policy and grants added':'already present'}.`);}finally{db.close();}
}
