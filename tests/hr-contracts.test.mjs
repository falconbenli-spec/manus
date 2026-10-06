import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, capabilitiesFor } from '../app/access.mjs';
import { listContracts, getContract, preparePolicy, decidePolicy, prepareContract, contractAction } from '../app/hr-contracts.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hr-contracts');t.after(()=>db.close());
  // hr-manager يمثل مدير الموارد البشرية مالك القبول؛ hr موظف الموارد البشرية الذي يُعد.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const capability of ['hr.policy.accept','hr.contracts.approve'])transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية مالك القبول (DEC16)'}));
  const policy=(overrides={})=>transaction(db,()=>preparePolicy(db,users.hr,{kind:'pay_components',title:'بنود الراتب المعتمدة',body:'يتكون الراتب الشهري من أساسي وبدل سكن وبدل نقل فقط، بمبالغ شهرية ثابتة بالريال.',basis:'قرار إدارة مصطنع رقم 1 لسنة 2026',effective_from:'2026-01-01',parameters:{components:['basic','housing','transport']},...overrides})).id;
  const accept=id=>transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'راجعت البنود وتطابق عقود الشركة المصطنعة'}));
  const input={user_id:'employee',contract_type:'indefinite',job_title:'مصممة أولى',work_location:'الرياض',start_date:'2026-02-01',weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد مصطنع موقع محفوظ في ملف الموظفة'};
  const prepare=(overrides={},amends=null)=>getContract(db,users.hr,transaction(db,()=>prepareContract(db,users.hr,{...input,...overrides},amends)).id);
  const act=(who,c,action,values={})=>transaction(db,()=>contractAction(db,users[who],c.id,action,{version:c.version,...values}));
  const active=()=>{accept(policy());return act('hr-manager',getContract(db,users['hr-manager'],act('hr',prepare(),'submit_contract').id),'approve_contract');};
  return {db,users,policy,accept,input,prepare,act,active};
}

test('DEC16: no contract exists until the HR manager has accepted the pay-component policy, and the preparer cannot accept it',t=>{
  const {db,users,policy,accept,prepare}=fixture(t);
  assert.throws(()=>prepare(),code('policy_required'));
  const id=policy();
  assert.throws(()=>prepare(),code('policy_required'),'a draft policy authorises nothing');
  assert.throws(()=>transaction(db,()=>decidePolicy(db,users.hr,id,'accept',{note:'اعتماد من المُعد نفسه غير مسموح'})),code('not_permitted'));
  assert.throws(()=>transaction(db,()=>decidePolicy(db,users.admin,id,'accept',{note:'الأدمن الأول لا يعتمد سياسات الموارد البشرية'})),code('not_permitted'));
  const accepted=accept(id);
  assert.equal(accepted.status,'accepted');assert.equal(accepted.decided_by,'hr-manager');
  assert.throws(()=>db.prepare("UPDATE hr_policies SET body='نص آخر بعد الاعتماد لا يجوز تغييره' WHERE id=?").run(id),/replaced by a new dated policy/);
  assert.throws(()=>prepare({pay_lines:[{component:'basic',amount:'8000.00'},{component:'other_allowance',amount:'100.00'}]}),code('component_not_allowed'));
  assert.throws(()=>prepare({start_date:'2025-12-01'}),code('policy_required'),'policy must be effective on the contract start date');
  assert.equal(prepare().monthly_total_minor,1050000);
});

test('a contract is approved by someone other than its preparer and the employee, then only replaced, never edited',t=>{
  const {db,users,accept,policy,prepare,act,input}=fixture(t);
  accept(policy());
  let c=act('hr',prepare(),'submit_contract');
  assert.throws(()=>act('hr',c,'approve_contract'),code('action_unavailable'));
  c=act('hr-manager',getContract(db,users['hr-manager'],c.id),'approve_contract',{note:'طابقت العقد الموقع'});
  assert.equal(c.status,'active');
  assert.throws(()=>prepare(),code('active_contract'));
  assert.throws(()=>db.prepare("UPDATE employment_contracts SET monthly_total_minor=1,version=version+1 WHERE id=?").run(c.id),/replaced by a new contract/);
  // زيادة الراتب عقد معدل بسبب وتاريخ؛ اعتماده ينهي السابق في اليوم الذي يسبقه.
  assert.throws(()=>prepare({start_date:'2026-07-01',pay_lines:[{component:'basic',amount:'9000.00'}]},c.id),code('invalid_text'));
  let next=prepare({start_date:'2026-07-01',pay_lines:[{component:'basic',amount:'9000.00'},{component:'housing',amount:'2250.00'}],change_reason:'زيادة سنوية معتمدة بقرار مصطنع'},c.id);
  next=act('hr-manager',getContract(db,users['hr-manager'],act('hr',next,'submit_contract').id),'approve_contract');
  assert.equal(next.status,'active');assert.equal(next.monthly_total_minor,1125000);
  const old=getContract(db,users.hr,c.id);
  assert.equal(old.status,'ended');assert.equal(old.ended_on,'2026-06-30');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM employment_contracts WHERE user_id='employee' AND status='active'").get().n,1);
  assert.throws(()=>transaction(db,()=>prepareContract(db,users.hr,{...input,user_id:'hr'})),code('separation_of_duties'));
  assert.ok(verifyAudit(db));
  assert.equal(JSON.stringify(db.prepare("SELECT after_json FROM audit_events WHERE entity_type='employment_contract'").all()).includes('8000'),false,'salary amounts stay out of the shared audit trail');
});

test('criterion 11: salaries reach only the employee and explicit HR holders — not the line manager, not the first admin',t=>{
  const {db,users,active}=fixture(t);
  const c=active();
  const own=listContracts(db,users.employee);
  assert.equal(own.contracts.length,1);assert.equal(own.contracts[0].monthly_total_minor,1050000);assert.deepEqual(own.contracts[0].actions,[]);
  assert.equal(listContracts(db,users.manager).contracts.length,0,'the line manager sees no team salaries');
  assert.throws(()=>getContract(db,users.manager,c.id),code('not_found'));
  assert.throws(()=>getContract(db,users.admin,c.id),code('not_found'));
  assert.equal(capabilitiesFor(db,users.admin).list.includes('hr.contracts.manage'),false);
  assert.equal(listContracts(db,users.outsider).contracts.length,0);
  assert.equal(listContracts(db,users.external).contracts.length,0);
  assert.equal(listContracts(db,users.hr).contracts[0].pay_hidden,false);
  assert.equal(JSON.stringify(listContracts(db,users.manager)).includes('1050000'),false);
});

test('fixed-term contracts need an end date, a rejected contract frees the employee for a new one, and ending is dated and reasoned',t=>{
  const {db,users,accept,policy,prepare,act,active}=fixture(t);
  accept(policy());
  assert.throws(()=>prepare({contract_type:'fixed_term'}),code('invalid_date'));
  assert.throws(()=>prepare({contract_type:'fixed_term',end_date:'2026-01-15'}),code('date_order'));
  let c=act('hr',prepare({contract_type:'fixed_term',end_date:'2027-01-31'}),'submit_contract');
  assert.throws(()=>prepare(),code('open_contract'));
  c=act('hr-manager',getContract(db,users['hr-manager'],c.id),'reject_contract',{note:'تاريخ النهاية لا يطابق العقد الموقع'});
  assert.equal(c.status,'rejected');
  c=act('hr-manager',getContract(db,users['hr-manager'],act('hr',prepare(),'submit_contract').id),'approve_contract');
  assert.throws(()=>act('hr-manager',c,'end_contract',{ended_on:'2099-01-01',reason:'تاريخ مستقبلي غير مقبول للإنهاء'}),code('ended_on'));
  c=act('hr-manager',c,'end_contract',{ended_on:c.start_date,reason:'استقالة مقبولة بحسب طلب مصطنع'});
  assert.equal(c.status,'ended');
  assert.throws(()=>db.prepare('DELETE FROM employment_contracts WHERE id=?').run(c.id),/retained/);
});

test('demo contracts seed once and only on synthetic tenants',async t=>{
  const {seedHrDemo}=await import('../scripts/seed-hr-demo.mjs');
  const db=openDb(':memory:');seed(db,'synthetic-hr-demo');t.after(()=>db.close());
  assert.equal(seedHrDemo(db),2);assert.equal(seedHrDemo(db),0);
  assert.deepEqual(db.prepare('SELECT status FROM employment_contracts ORDER BY status').all().map(r=>r.status),['active','pending']);
  db.prepare("UPDATE tenants SET name='شركة حقيقية' WHERE id='36t'").run();
  assert.throws(()=>seedHrDemo(db),/Synthetic tenants only/);
});
