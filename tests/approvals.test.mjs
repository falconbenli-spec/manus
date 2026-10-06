import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb,transaction,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import * as d from '../app/delegations.mjs';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-approvals-only');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'deputy',tenant_id,department_id,'deputy','معتمد بديل مصطنع',password_hash,role FROM users WHERE id='manager'");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const act=(u,r,action,note='سبب القرار التجريبي')=>transaction(db,()=>wf.transition(db,users[u],r.id,action,{version:r.version,note}));
  const make=()=>transaction(db,()=>{
    let r=wf.createRequest(db,users.employee,{service_id:wf.catalog(db,users.employee).find(s=>s.code==='HR-LETTER').id,title:'خطاب محلي',payload:{purpose:'اختبار التفويض',recipient:'جهة مصطنعة'}});
    r=wf.addAttachment(db,users.employee,r.id,{version:r.version,filename:'proof.txt',content:Buffer.from('synthetic evidence').toString('base64')});
    return wf.transition(db,users.employee,r.id,'submit',{version:r.version});
  });
  const grant=(overrides={})=>transaction(db,()=>d.createDelegation(db,users.manager,{delegate_id:'deputy',service_code:'HR-LETTER',starts_at:new Date(Date.now()-60_000).toISOString(),ends_at:new Date(Date.now()+60_000).toISOString(),reason:'تغطية غياب تجريبية',...overrides}));
  return {db,users,act,make,grant};
}
test('PLT-04: delegation expiry withdraws read, search, decision and attachment access',t=>{
  const {db,users,act,make,grant}=fixture(t),r=make(),g=grant();
  assert.ok(wf.detail(db,users.deputy,r.id).actions.includes('approve'));
  assert.equal(wf.downloadAttachment(db,users.deputy,r.attachments[0].id).filename,'proof.txt');
  t.mock.method(Date,'now',()=>Date.parse(g.ends_at));
  assert.equal(wf.listRequests(db,users.deputy).length,0);
  assert.throws(()=>wf.detail(db,users.deputy,r.id),{code:'not_found'});
  assert.throws(()=>act('deputy',r,'approve'),{code:'not_found'});
  assert.throws(()=>wf.downloadAttachment(db,users.deputy,r.attachments[0].id),{code:'not_found'});
});
test('PLT-04: delegated decision records both actors and revocation removes remaining access',t=>{
  const {db,users,act,make,grant}=fixture(t);let r=make();const g=grant();
  r=act('deputy',r,'approve');assert.equal(r.status,'pending');
  const decision=r.approvals[0];assert.equal(decision.approver_id,'manager');assert.equal(decision.decided_by,'deputy');assert.equal(decision.delegation_id,g.id);
  assert.throws(()=>db.prepare("UPDATE approval_steps SET decided_by='manager' WHERE id=?").run(decision.id));
  assert.throws(()=>transaction(db,()=>d.revokeDelegation(db,users.deputy,g.id,{version:g.version,note:'إلغاء غير مأذون'})),{code:'forbidden'});
  transaction(db,()=>d.revokeDelegation(db,users.manager,g.id,{version:g.version,note:'انتهت التغطية'}));
  assert.throws(()=>wf.detail(db,users.deputy,r.id),{code:'not_found'});
  assert.equal(act('hr',r,'approve').status,'approved');assert.ok(verifyAudit(db));
});
test('IT-02: delegation cannot cross roles, services, reporting lines or current assignments',t=>{
  const {db,users,make,grant}=fixture(t);const r=make();
  for(const delegate_id of ['manager','employee','external','hr','admin'])assert.throws(()=>grant({delegate_id}));
  const g=grant();assert.throws(()=>grant(),{code:'overlap'});
  const support=transaction(db,()=>wf.createRequest(db,users.employee,{service_id:wf.catalog(db,users.employee).find(s=>s.code==='IT-SUPPORT').id,title:'دعم آخر',payload:{issue:'عطل مصطنع',impact:'يمنع العمل'}}));
  transaction(db,()=>wf.transition(db,users.employee,support.id,'submit',{version:support.version}));
  assert.throws(()=>wf.getRequest(db,users.deputy,support.id),{code:'not_found'});
  db.exec("UPDATE users SET department_id='ops' WHERE id='deputy'");
  assert.throws(()=>wf.detail(db,users.deputy,r.id),{code:'not_found'});
  db.exec("UPDATE users SET department_id='creative' WHERE id='deputy'; UPDATE users SET manager_id='deputy' WHERE id='employee'");
  assert.throws(()=>wf.detail(db,users.deputy,r.id),{code:'not_found'});
  assert.throws(()=>db.prepare('DELETE FROM approval_delegations WHERE id=?').run(g.id));
});
test('PLT-04: delegation never approves the delegate request and cannot be chained',t=>{
  const {db,users,act,make,grant}=fixture(t);const r=make();grant();
  db.exec("UPDATE users SET role='manager' WHERE id='employee'");
  const employeeManager=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  transaction(db,()=>d.createDelegation(db,users.deputy,{delegate_id:'employee',service_code:'HR-LETTER',starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+60_000).toISOString(),reason:'تفويض أصالة فقط'}));
  assert.ok(!wf.detail(db,employeeManager,r.id).actions.includes('approve'));
  assert.throws(()=>act('employee',r,'approve'),{code:'transition_denied'});
  assert.equal(wf.detail(db,users.deputy,r.id).actions.includes('approve'),true);
});
function parallel(db,users){
  transaction(db,()=>wf.createService(db,users.admin,{code:'HR-LETTER',name_ar:'خطاب بموافقتين متوازيتين',name_en:'Parallel review',description:'سياسة مصطنعة للاختبار',department_id:'hr',fields:[{key:'purpose',label:'الغرض',type:'text',required:true},{key:'recipient',label:'الجهة',type:'text',required:true}],approval_policy:{steps:['manager','hr'],handler_role:'hr',mode:'parallel'}}));
}
test('PLT-04: parallel review accepts either order and emits one approval only after all decisions',t=>{
  const {db,users,act,make}=fixture(t);parallel(db,users);let r=make();
  assert.ok(wf.detail(db,users.manager,r.id).actions.includes('approve'));assert.ok(wf.detail(db,users.hr,r.id).actions.includes('approve'));
  const stale=r;r=act('hr',r,'approve');assert.equal(r.status,'pending');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
  assert.throws(()=>act('manager',stale,'approve'),{code:'stale_version'});
  r=act('manager',r,'approve');assert.equal(r.status,'approved');
  assert.equal(r.approvals.filter(s=>s.status==='approved').length,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,1);
  assert.throws(()=>act('manager',r,'approve'),{code:'transition_denied'});assert.ok(verifyAudit(db));
});
test('PLT-04: return closes a parallel round and resubmission preserves prior decisions',t=>{
  const {db,users,act,make}=fixture(t);parallel(db,users);let r=make();
  r=act('hr',r,'return');assert.throws(()=>act('manager',r,'approve'),{code:'transition_denied'});
  r=act('employee',r,'submit');assert.equal(r.revision,2);assert.equal(r.approvals.find(a=>a.revision===1&&a.approver_id==='hr').status,'returned');
  r=act('manager',r,'approve');r=act('hr',r,'reject');assert.equal(r.status,'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
});

// التفويض كان يقبل أي نهاية بعد البداية وبعد الآن، بلا سقف: فمعتمدٌ يفوّض اعتماد خدمته «حتى 2099»
// ويبقى النقل قائمًا بلا مراجعة، ولا يلغيه إلا هو. وهذا نقل صلاحية لا تفويض، وبابه access.mjs بشروطه.
test('التفويض له سقف مدة: الطويل يُرفض بنصّه، وما دون السقف يمر، والحدّ نفسه مقبول',t=>{
  const {db,grant}=fixture(t);
  const start=new Date(Date.now()-60_000).toISOString();
  const after=days=>new Date(Date.parse(start)+days*86400000).toISOString();
  assert.throws(()=>grant({ends_at:'2099-01-01T00:00:00.000Z'}),e=>e.code==='interval'&&/التفويض الدائم نقلُ صلاحية لا تفويض/.test(e.message));
  assert.throws(()=>grant({starts_at:start,ends_at:after(d.MAX_DELEGATION_DAYS+1)}),e=>e.code==='interval');
  // الحدّ نفسه ليس تجاوزًا له.
  const atLimit=grant({starts_at:start,ends_at:after(d.MAX_DELEGATION_DAYS)});
  assert.equal(atLimit.ends_at,after(d.MAX_DELEGATION_DAYS));
  assert.equal(verifyAudit(db),true);
});
