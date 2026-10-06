import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareRun, getRun } from '../app/payroll.mjs';
import { proposeAdjustment } from '../app/payroll-extras.mjs';
import { preRunChecks } from '../app/payroll-checks.mjs';

test('pre-payroll checks: a draft run shows what could still change it — undecided movements and missing verified salary accounts — and an approved run shows none',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-payroll-checks');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:c,note:'تصريح رواتب مصطنع'}));
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتمدت السياسة المصطنعة'}));};
  policy('pay_components',{components:['basic','housing','transport']});policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const contractId=tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2026-01-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'8000.00'}],document_reference:'عقد مصطنع'})).id;
  for(const [who,action] of [['hr','submit_contract'],['hr-manager','approve_contract']])tx(()=>contractAction(db,users[who],contractId,action,{version:getContract(db,users[who],contractId).version}));
  tx(()=>proposeAdjustment(db,users.hr,{user_id:'employee',kind:'bonus',month:'2026-02',amount:'500.00',reason:'مكافأة مصطنعة لم يُبت فيها بعد'}));
  const run=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month:'2026-02'})).id),checks=preRunChecks(db,users.hr,run);
  assert.ok(checks.some(c=>c.level==='warn'&&/حركة راتب مقترحة/.test(c.title)));
  assert.ok(checks.some(c=>/بلا حساب راتب متحقق/.test(c.title)&&c.detail.includes(users.employee.name)));
  assert.deepEqual(preRunChecks(db,users.hr,{...run,status:'approved'}),[],'a locked run is no longer advised on');
  assert.deepEqual(preRunChecks(db,users.hr,null),[]);
});
