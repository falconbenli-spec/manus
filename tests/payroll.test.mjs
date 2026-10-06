import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { listPayroll, getRun, prepareRun, runAction, viewPayslip, computeLine } from '../app/payroll.mjs';

const code=value=>error=>error.code===value;
const cycle={pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:500};
function fixture(t,{withCycle=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-payroll');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح رواتب مصطنع'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  grant('reviewer','payroll.review');
  const policy=(kind,parameters,title)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2026-01-01',parameters}));transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']},'بنود الراتب');
  if(withCycle)policy('payroll_cycle',cycle,'دورة الرواتب');
  const contract=(user_id,start,basic='8000.00',housing='2000.00',transport='500.00',amends=null,extra={})=>{
    const {id}=transaction(db,()=>prepareContract(db,users.hr,{...(amends?{}:{user_id}),contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:housing},{component:'transport',amount:transport}],document_reference:'عقد مصطنع',...extra},amends));
    const step=(who,action)=>transaction(db,()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));
    step('hr','submit_contract');step('hr-manager','approve_contract');return id;
  };
  const act=(who,run,action,values={})=>transaction(db,()=>runAction(db,users[who],run.id,action,{version:run.version,...values}));
  const prepare=month=>getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month})).id);
  return {db,users,contract,act,prepare};
}

test('PAY-01/03: the run applies the accepted cycle policy of that month, prorates a mid-month joiner and deducts only confirmed unpaid days',t=>{
  const {db,users,contract,prepare}=fixture(t);
  contract('employee','2026-02-01');contract('outsider','2026-03-16','6000.00','1500.00','300.00');
  db.prepare("INSERT INTO attendance_absences(id,tenant_id,user_id,work_date,reason,status,proposed_by,decided_by,decided_at,created_at) VALUES('a1','36t','employee','2026-03-10','غياب مصطنع معتمد للاختبار','confirmed','hr','hr-manager','2026-03-12T00:00:00.000Z','2026-03-11T00:00:00.000Z'),('a2','36t','employee','2026-03-11','اقتراح لم يُعتمد بعد للاختبار','proposed','hr',NULL,NULL,'2026-03-12T00:00:00.000Z')").run();
  const run=prepare('2026-03');
  assert.equal(run.headcount,2);
  const full=run.lines.find(l=>l.user_id==='employee'),part=run.lines.find(l=>l.user_id==='outsider');
  assert.equal(full.gross_minor,1050000);
  assert.equal(full.unpaid_absence_minor,35000,'one confirmed day at 10500/30; the proposed day deducts nothing');
  assert.equal(full.social_insurance_minor,97500,'9.75% of basic+housing as the accepted policy says');
  assert.equal(full.net_minor,1050000-35000-97500);
  assert.deepEqual(full.basis.parts[0].unpaid_dates,['2026-03-10']);
  assert.equal(part.paid_fraction_bp,5333,'16 of 30 days');
  assert.equal(part.gross_minor,Math.round(600000*0.5333)+Math.round(150000*0.5333)+Math.round(30000*0.5333));
  assert.equal(run.net_minor,full.net_minor+part.net_minor);
  assert.deepEqual(run.missing_contracts.map(m=>m.id).sort(),['hr','hr-manager','it','manager','reviewer']);
  assert.throws(()=>transaction(db,()=>prepareRun(db,users.hr,{month:'2026-03'})),code('run_exists'));
  assert.throws(()=>transaction(db,()=>prepareRun(db,users.hr,{month:'2099-01'})),code('future_month'));
  assert.throws(()=>transaction(db,()=>prepareRun(db,users.hr,{month:'2025-12'})),code('policy_required'),'a month before the policy took effect has no rule to apply');
  const c=db.prepare("SELECT * FROM employment_contracts WHERE user_id='employee'").get();
  assert.equal(computeLine(c,{from:'2026-02-01',to:'2026-02-28',days:28},cycle,[]).paid_fraction_bp,10000,'a whole February is a whole month');
});

test('PAY-05/06: three different people prepare, review and approve; unexplained variances block review; an approved run is locked',t=>{
  const {db,users,contract,act,prepare}=fixture(t);
  const first=contract('employee','2026-02-01');
  let feb=act('hr',prepare('2026-02'),'submit_run');
  assert.throws(()=>act('hr',feb,'pass_review',{note:'مراجعة من المُعد نفسه'}),code('action_unavailable'));
  feb=act('reviewer',getRun(db,users.reviewer,feb.id),'pass_review',{note:'طابقت العقود والأيام مع السجل'});
  assert.throws(()=>act('reviewer',feb,'approve_run'),code('action_unavailable'));
  assert.throws(()=>act('hr',getRun(db,users.hr,feb.id),'approve_run'),code('action_unavailable'));
  feb=act('hr-manager',getRun(db,users['hr-manager'],feb.id),'approve_run',{note:'اعتماد مسير فبراير المصطنع'});
  assert.equal(feb.status,'approved');
  assert.throws(()=>db.prepare("UPDATE payroll_runs SET net_minor=1,gross_minor=1,version=version+1 WHERE id=?").run(feb.id),/locked/);
  assert.throws(()=>db.prepare('DELETE FROM payroll_lines WHERE run_id=?').run(feb.id),/recalculating a draft/);
  assert.throws(()=>db.prepare("UPDATE payroll_lines SET net_minor=1 WHERE run_id=?").run(feb.id),/recalculating a draft/);
  // زيادة في مارس تتجاوز حد 5%: المراجع يبرر قبل أن يجتاز.
  contract('employee','2026-03-01','9000.00','2250.00','500.00',first,{change_reason:'زيادة سنوية مصطنعة معتمدة'});
  let mar=act('hr',prepare('2026-03'),'submit_run');
  const line=mar.lines[0];
  assert.equal(line.variance_flag,true);assert.equal(line.previous_net_minor,feb.lines[0].net_minor);
  mar=getRun(db,users.reviewer,mar.id);
  assert.deepEqual(mar.actions,['justify','return_run']);
  assert.throws(()=>act('reviewer',mar,'pass_review',{note:'اجتياز دون تبرير الفرق'}),code('action_unavailable'));
  mar=act('reviewer',mar,'justify',{line_id:line.id,note:'عقد معدل بزيادة سنوية يسري من أول مارس'});
  mar=act('reviewer',mar,'pass_review',{note:'الفرق مفسر بعقد معدل معتمد'});
  assert.equal(mar.status,'reviewed');
  mar=act('hr-manager',getRun(db,users['hr-manager'],mar.id),'return_run',{note:'أعد الاحتساب بعد تصحيح يوم غياب'});
  assert.equal(mar.status,'draft');assert.equal(mar.reviewed_by,null);
  assert.ok(verifyAudit(db));
  assert.equal(JSON.stringify(db.prepare("SELECT after_json FROM audit_events WHERE entity_type='payroll_run'").all()).includes('net_minor'),false);
});

test('PAY-08: a payslip exists only after approval, only for its owner, and every view is recorded',t=>{
  const {db,users,contract,act,prepare}=fixture(t);
  contract('employee','2026-02-01');contract('outsider','2026-02-01','5000.00','1250.00','300.00');
  let run=act('hr',prepare('2026-02'),'submit_run');
  assert.equal(listPayroll(db,users.employee).payslips.length,0,'no payslip before approval');
  run=act('reviewer',getRun(db,users.reviewer,run.id),'pass_review',{note:'طابقت العقود مع السطور'});
  run=act('hr-manager',getRun(db,users['hr-manager'],run.id),'approve_run');
  const mine=listPayroll(db,users.employee);
  assert.equal(mine.payslips.length,1);assert.equal(mine.runs.length,0,'an employee never sees the run');
  const other=db.prepare("SELECT id FROM payroll_lines WHERE user_id='outsider'").get().id;
  assert.throws(()=>viewPayslip(db,users.employee,other),code('not_found'));
  assert.throws(()=>viewPayslip(db,users.manager,mine.payslips[0].id),code('not_found'),'the line manager cannot open a team payslip');
  assert.throws(()=>getRun(db,users.manager,run.id),code('not_permitted'));
  assert.throws(()=>getRun(db,users.admin,run.id),code('not_permitted'),'the first admin holds no payroll grant by default');
  const slip=viewPayslip(db,users.employee,mine.payslips[0].id);
  assert.equal(slip.net_minor,1050000-97500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payslip_views WHERE user_id=?').get('employee').n,1);
  assert.equal(JSON.stringify(listPayroll(db,users.employee)).includes(String(run.lines.find(l=>l.user_id==='outsider').net_minor)),false);
});

test('no run without a payroll-cycle policy accepted by the HR manager, and an empty month cannot be submitted',t=>{
  const {db,users,act,prepare}=fixture(t,{withCycle:false});
  assert.throws(()=>prepare('2026-02'),code('policy_required'));
  assert.equal(listPayroll(db,users.hr).cycle_policy,null);
  const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind:'payroll_cycle',title:'دورة الرواتب',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار مصطنع',effective_from:'2026-01-01',parameters:cycle}));
  assert.throws(()=>prepare('2026-02'),code('policy_required'),'a draft policy authorises nothing');
  transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار'}));
  const run=prepare('2026-02');
  assert.equal(run.headcount,0);
  assert.throws(()=>act('hr',run,'submit_run'),code('empty_run'));
  assert.equal(act('hr',run,'cancel_run',{note:'لا عقود سارية في هذا الشهر'}).status,'cancelled');
  assert.equal(prepare('2026-02').status,'draft','a cancelled run frees the month');
});
