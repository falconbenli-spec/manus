import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb,transaction,audit,now } from '../app/db.mjs';
import { createFinanceReference } from '../app/finance.mjs';

export function expandDemo(db,year=Number(now().slice(0,4))){
  if(db.prepare("SELECT name FROM tenants WHERE id='36t'").get()?.name!=='3,6T — بيئة تجريبية')throw Error('Synthetic tenant required');
  if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Invalid synthetic calendar year');
  const changes=[];
  transaction(db,()=>{
    const manager=db.prepare("SELECT * FROM users WHERE id='manager' AND username='manager' AND tenant_id='36t' AND department_id='creative' AND role='manager'").get();
    if(!manager)throw Error('Original synthetic manager required');
    for(const [id,name,role,managerId] of [['deputy','معتمد بديل مصطنع','manager',null],['pm','مدير مشروع مصطنع','pm','manager']]){
      const existing=db.prepare('SELECT * FROM users WHERE id=? OR username=?').get(id,id);
      if(existing){if(existing.tenant_id!=='36t'||existing.username!==id||existing.role!==role||existing.department_id!=='creative')throw Error('Existing account differs; no account was changed');continue;}
      db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES(?,?,?,?,?,?,?,?)').run(id,'36t','creative',id,name,manager.password_hash,role,managerId);
      audit(db,manager,'synthetic_fixture',id,'synthetic.user_added',{}, {role,department_id:'creative'},'حساب اختبار محلي إضافي بنفس بيانات الدخول التجريبية');changes.push(id);
    }
    for(const calendarYear of [year,year+1]){
      const id=`synthetic-creative-${calendarYear}`;
      if(db.prepare('SELECT 1 FROM leave_calendars WHERE id=?').get(id))continue;
      db.prepare("INSERT INTO leave_calendars(id,tenant_id,employee_department_id,hr_department_id,name,effective_from,effective_to,weekdays_json,holidays_json,timezone,synthetic,created_at) VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)").run(id,'36t','creative','hr','تقويم مصطنع للاختبار؛ ليس سياسة الشركة',`${calendarYear}-01-01`,`${calendarYear}-12-31`,'[0,1,2,3,4]','[]',now());
      audit(db,manager,'synthetic_fixture',id,'synthetic.calendar_added',{}, {weekdays:[0,1,2,3,4],holidays:[],year:calendarYear},'أرصدة صفر حتى منح HR افتتاحًا صريحًا');changes.push(id);
    }
  });
  return changes;
}
export function expandPeopleDemo(db,year=Number(now().slice(0,4))){
  if(db.prepare("SELECT name FROM tenants WHERE id='36t'").get()?.name!=='3,6T — بيئة تجريبية')throw Error('Synthetic tenant required');
  const id=`synthetic-hiring-${year}`;
  if(db.prepare('SELECT 1 FROM people_policies WHERE id=?').get(id))return [];
  transaction(db,()=>{
    const actor=db.prepare("SELECT * FROM users WHERE id='manager' AND tenant_id='36t'").get();
    db.prepare('INSERT INTO people_policies VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'36t','creative','hr','نطاق توظيف مصطنع، ليس سياسة الشركة',`${year}-01-01`,`${year}-12-31`,'مرجع خصوصية مصطنع للاختبار المحلي، دون بيانات أشخاص حقيقيين',1,now());
    audit(db,actor,'synthetic_fixture',id,'synthetic.hiring_policy_added',{}, {year},'إعداد تجربة محلية لا ينشئ حسابًا أو تعيينًا فعليًا');
  });
  return [id];
}
export function expandFinanceDemo(db,year=Number(now().slice(0,4))){
  if(db.prepare("SELECT name FROM tenants WHERE id='36t'").get()?.name!=='3,6T — بيئة تجريبية')throw Error('Synthetic tenant required');
  const added=[];
  transaction(db,()=>{
    const manager=db.prepare("SELECT * FROM users WHERE id='manager' AND tenant_id='36t' AND username='manager'").get();if(!manager)throw Error('Synthetic manager required');
    for(const [id,name,actions] of [
      ['finance-preparer','معد قيود مصطنع',['read','prepare','approve','post','source_procurement']],
      ['finance-approver','مراجع قيود مصطنع',['read','configure','prepare','approve','post','reverse','source_procurement']]
    ]){
      const existing=db.prepare('SELECT * FROM users WHERE id=? OR username=?').get(id,id);
      if(existing&&(existing.tenant_id!=='36t'||existing.username!==id||existing.department_id!=='ops'||existing.role!=='employee'))throw Error('Existing finance account differs; no changes applied');
      if(!existing){
        db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES(?,?,?,?,?,?,?)').run(id,'36t','ops',id,name,manager.password_hash,'employee');
        audit(db,manager,'synthetic_fixture',id,'synthetic.finance_user_added',{}, {role:'employee',department_id:'ops'},'حساب تجربة محلية منفصل لإعداد القيود ومراجعتها');added.push(id);
      }
      for(const action of actions){
        const grantId=`synthetic-${id}-${action}-${year}`;
        if(db.prepare('SELECT 1 FROM finance_grants WHERE id=?').get(grantId))continue;
        db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(grantId,'36t',id,'employee',action,`${year}-01-01T00:00:00.000Z`,`${year+1}-01-01T00:00:00.000Z`,'manager','تصريح اختبار محلي مصطنع محدد لسنة التجربة',null,now());
        audit(db,manager,'synthetic_fixture',grantId,'synthetic.finance_grant_added',{}, {user_id:id,action,year},'لا يعدل بيانات أو صلاحيات حسابات حقيقية');added.push(grantId);
      }
    }
    const approver=db.prepare("SELECT * FROM users WHERE id='finance-approver'").get();
    for(const [kind,code,input] of [
      ['accounts','SYN-EXP',{name:'مصروفات تجربة محلية',account_type:'expense',currency:'SAR'}],
      ['accounts','SYN-AP',{name:'التزامات تجربة محلية',account_type:'liability',currency:'SAR'}],
      ['cost_centers','SYN-CC',{name:'مركز تكلفة التجربة'}]
    ])if(!db.prepare(`SELECT 1 FROM finance_${kind} WHERE tenant_id='36t' AND code=?`).get(code)){createFinanceReference(db,approver,kind,{code,...input});added.push(code);}
    if(!db.prepare("SELECT 1 FROM finance_periods WHERE tenant_id='36t' AND starts_on<=? AND ends_on>=?").get(`${year}-12-31`,`${year}-01-01`)){createFinanceReference(db,approver,'periods',{name:`فترة مصطنعة ${year}`,starts_on:`${year}-01-01`,ends_on:`${year}-12-31`});added.push('synthetic-period-'+year);}
  });
  return added;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw Error('Synthetic expansion is disabled in production');
  const db=openDb(resolve('work/local.sqlite'));
  try{console.log(JSON.stringify({environment:'synthetic',added:[...expandDemo(db),...expandPeopleDemo(db),...expandFinanceDemo(db)]}));}finally{db.close();}
}
