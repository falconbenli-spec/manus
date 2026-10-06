import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareRun, runAction, getRun } from '../app/payroll.mjs';
import { decideAdjustment } from '../app/payroll-extras.mjs';
import { retroCandidates, proposeRetro } from '../app/payroll-retro.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-retro');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح رواتب مصطنع'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);grant('reviewer','payroll.review');
  const policy=(kind,parameters)=>{const {id}=tx(()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2020-01-01',parameters}));tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتمدت السياسة المصطنعة'}));};
  policy('pay_components',{components:['basic','housing','transport']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:1000,social_insurance_base:['basic','housing'],review_threshold_bp:500});
  const lines=basic=>[{component:'basic',amount:basic},{component:'housing',amount:'2000.00'}];
  const approve=id=>{const step=(who,action)=>tx(()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));step('hr','submit_contract');step('hr-manager','approve_contract');};
  const base={contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',weekly_hours:40,probation_days:90,notice_days:60,document_reference:'عقد مصطنع'};
  const contractId=tx(()=>prepareContract(db,users.hr,{...base,user_id:'employee',start_date:'2026-01-01',pay_lines:lines('8000.00')})).id;approve(contractId);
  const run=(who,r,action,values={})=>tx(()=>runAction(db,users[who],r.id,action,{version:r.version,...values}));
  const approveRun=m=>{let r=getRun(db,users.hr,tx(()=>prepareRun(db,users.hr,{month:m})).id);r=run('hr',r,'submit_run');r=getRun(db,users.reviewer,r.id);for(const l of r.lines.filter(l=>l.variance_flag))r=run('reviewer',r,'justify',{line_id:l.id,note:'فرق مفسر بحركة معتمدة في هذا الشهر'});r=run('reviewer',r,'pass_review',{note:'طابقت الحركات المعتمدة مع السطور'});return run('hr-manager',getRun(db,users['hr-manager'],r.id),'approve_run');};
  const amend=(start,basic)=>{const id=tx(()=>prepareContract(db,users.hr,{...base,user_id:'employee',start_date:start,pay_lines:lines(basic),change_reason:'زيادة مصطنعة بأثر رجعي بقرار الإدارة'},contractId)).id;approve(id);return id;};
  return {db,users,tx,approveRun,amend};
}

test('PAY-04: a backdated raise leaves approved runs untouched and surfaces the exact difference per month, proposed once and approved by someone else',t=>{
  const {db,users,tx,approveRun,amend}=fixture(t);
  approveRun('2026-02');approveRun('2026-03');
  assert.deepEqual(retroCandidates(db,users.hr).candidates,[]);
  const paidBefore=db.prepare("SELECT l.net_minor FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE r.month='2026-02' AND l.user_id='employee'").get().net_minor;
  amend('2026-02-16','9000.00');
  assert.equal(db.prepare("SELECT l.net_minor FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE r.month='2026-02' AND l.user_id='employee'").get().net_minor,paidBefore,'the locked run is not rewritten');
  const found=retroCandidates(db,users.hr).candidates.filter(c=>c.user_id==='employee').sort((a,b)=>a.source_month.localeCompare(b.source_month));
  assert.deepEqual(found.map(c=>c.source_month),['2026-02','2026-03']);
  // مارس: زيادة 1000 كاملة، ناقص 10% تأمينات على الأساسي = 900. فبراير: نصف شهر بأساس 30 يومًا.
  assert.equal(found[1].difference_minor,90000);assert.equal(found[0].difference_minor,40000,'half of February at the new rate (+500) less insurance on the newer full monthly base (-100); the two parts add up to one month');
  assert.ok(found[1].reasons.includes('عقد مختلف عن المعتمد وقت المسير'));
  const input={user_id:'employee',source_month:'2026-03',target_month:'2026-04',expected_difference:90000,note:'قرار زيادة مصطنع مؤرخ 16 فبراير'};
  assert.throws(()=>tx(()=>proposeRetro(db,users.reviewer,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>proposeRetro(db,users.hr,{...input,expected_difference:1})),code('stale_difference'));
  assert.throws(()=>tx(()=>proposeRetro(db,users.hr,{...input,target_month:'2026-03'})),code('target_month'));
  const retro=tx(()=>proposeRetro(db,users.hr,input));
  assert.throws(()=>tx(()=>proposeRetro(db,users.hr,input)),code('no_difference'),'the same month is not proposed twice');
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(retro.adjustment_id);
  assert.equal(adjustment.kind,'allowance');assert.equal(adjustment.amount_minor,90000);assert.equal(adjustment.status,'proposed');assert.match(adjustment.reason,/أثر رجعي لشهر 2026-03/);
  assert.throws(()=>tx(()=>decideAdjustment(db,users.hr,adjustment.id,'approve',{note:'اعتماد ذاتي'})),error=>['not_permitted','separation_of_duties'].includes(error.code));
  tx(()=>decideAdjustment(db,users['hr-manager'],adjustment.id,'approve',{note:'مطابق لقرار الزيادة'}));
  const april=approveRun('2026-04'),line=getRun(db,users.hr,april.id).lines.find(l=>l.user_id==='employee');
  assert.equal(line.additions_minor,90000,'the difference is paid once, in the later run');
  assert.deepEqual(retroCandidates(db,users.hr).candidates.map(c=>c.source_month),['2026-02']);
  assert.throws(()=>db.prepare('UPDATE payroll_retro SET difference_minor=1').run(),/immutable/);
  assert.ok(verifyAudit(db));
});

test('PAY-04: a rejected retro movement frees the difference to be proposed again, and an overpayment becomes a proposed deduction',t=>{
  const {db,users,tx,approveRun,amend}=fixture(t);
  approveRun('2026-02');amend('2026-02-01','7000.00');
  const [candidate]=retroCandidates(db,users.hr).candidates;
  assert.equal(candidate.difference_minor,-90000);
  const input={user_id:'employee',source_month:'2026-02',target_month:'2026-03',expected_difference:-90000,note:'تصحيح مصطنع لبند أُدخل بالزيادة'};
  const first=tx(()=>proposeRetro(db,users.hr,input));
  assert.equal(db.prepare('SELECT kind FROM payroll_adjustments WHERE id=?').get(first.adjustment_id).kind,'deduction');
  tx(()=>decideAdjustment(db,users['hr-manager'],first.adjustment_id,'reject',{note:'يُقسط الخصم على شهرين بقرار آخر'}));
  assert.equal(retroCandidates(db,users.hr).candidates[0].difference_minor,-90000);
  tx(()=>proposeRetro(db,users.hr,input));
  assert.equal(retroCandidates(db,users.hr).history.length,2);
});
