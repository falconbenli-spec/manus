import { randomUUID } from 'node:crypto';
import { transaction, now } from '../app/db.mjs';
import * as budgets from '../app/budgets.mjs';

export function fundProject(db, projectId, costCenter, cap='10000.00') {
  if(db.prepare('PRAGMA database_list').all().find(r=>r.name==='main').file!=='')throw Error('يسمح بهذا المساعد في قاعدة اختبار بالذاكرة فقط');
  const users={};
  for(const key of ['budget-preparer','budget-reviewer']) {
    db.prepare("INSERT OR IGNORE INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT ?,tenant_id,'ops',?, ?,password_hash,'employee' FROM users WHERE id='manager'").run(key,key,'حساب مخصص اختبار');
    users[key]=db.prepare('SELECT * FROM users WHERE id=?').get(key);
    for(const action of ['read','prepare','approve']) if(!db.prepare('SELECT 1 FROM finance_grants WHERE user_id=? AND action=?').get(key,action))db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',key,'employee',action,'2026-01-01T00:00:00.000Z','2099-12-31T00:00:00.000Z','admin','تفويض مصطنع للمخصص',null,now());
  }
  const manager=db.prepare("SELECT * FROM users WHERE id='manager'").get();
  return transaction(db,()=>{
    // 2099-12-31 كان راحةَ تهيئة لا تأكيدًا — ما يُختبر هنا هو المخصص وحجزه وسحب النطاق، لا أن النطاق بلا نهاية.
    // ومع سقف الصلاحيات المؤقتة (MAX_FINANCE_AUTHORITY_DAYS في app/delegations.mjs) صار مرفوضًا، فيُحسب من الآن داخل الأفق.
    const scopeEnds=new Date(Date.now()+30*86400000).toISOString();
    for(const user of Object.values(users)) if(!budgets.hasProjectFinanceAccess(db,user,projectId))budgets.grantProjectFinanceAccess(db,manager,projectId,{user_id:user.id,ends_at:scopeEnds,reason:'تفويض نطاق مشروع الاختبار'});
    let b=budgets.createBudget(db,users['budget-preparer'],{project_id:projectId,cost_center:costCenter,currency:'SAR',cap_amount:cap,valid_from:'2026-01-01',valid_until:'2099-12-31',evidence:'مخصص اختبار صريح'});
    b=budgets.budgetAction(db,users['budget-preparer'],b.id,'submit',{version:b.version,note:'تقديم للمراجعة'});
    return budgets.budgetAction(db,users['budget-reviewer'],b.id,'approve',{version:b.version,note:'اعتماد مستقل للاختبار'});
  });
}
