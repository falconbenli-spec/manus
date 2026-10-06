import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { grantLeaveOpening, createLeaveRequest, leaveAction } from '../app/leave.mjs';
import { accrualBoard, accrualBalance, accrualSettlementView, decideAccrualPolicy, prepareAccrualPolicy, recordAccrualAdjustment, runAccrualCycle, updateAccrualPolicyDraft } from '../app/leave-accrual.mjs';
import { leaveAccrualUI } from '../app/static/leave-benefits-ui.mjs';

const code=expected=>error=>error.code===expected;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const RULE={leave_type:'synthetic_annual',title:'قاعدة استحقاق مصطنعة للاختبار',
  body:'قاعدة اختبار محلية مصطنعة لا تمثل سياسة شركة ولا نصًا نظاميًا، وضعت لاختبار المحرك فقط.',
  accrual_unit:'month',accrual_days:'2.5',accrual_start:'hire',waiting_days:0,
  carryover_allowed:false,carryover_cap_days:'',cash_on_end_of_service:false,
  basis:'قرار شركة مصطنع رقم 1 لبيئة الاختبار المحلية',basis_confirmed_on:'2026-01-05',effective_from:'2025-01-01'};

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-leave-accrual');t.after(()=>db.close());
  // hr-manager يمثل مدير الموارد البشرية مالك الاعتماد؛ hr الموظفة التي تُعد القواعد.
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'مالك اعتماد قواعد الاستحقاق في الاختبار'}));
  // عقود مصطنعة تحدد تاريخ التعيين وحده؛ المبالغ رمزية ولا يعتمد عليها هذا الاختبار.
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pay-policy','36t','pay_components','بنود راتب مصطنعة','نص سياسة مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{}','سند مصطنع للاختبار المحلي','2025-01-01','accepted','hr','hr-manager',?,?)").run(now(),now());
  const contract=(userId,start)=>db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES(?,'36t',?,'pay-policy','indefinite','وظيفة تجريبية','الرياض',?,40,90,60,'[]',100000,'SAR','مستند تجريبي لا وجود له','active','hr','hr-manager',?,?,?)")
    .run(`contract-${userId}`,userId,start,now(),now(),now());
  contract('employee','2025-01-01');contract('outsider','2026-06-01');
  const policy=(overrides={},who='hr')=>transaction(db,()=>prepareAccrualPolicy(db,users[who],{...RULE,...overrides})).id;
  const accept=(id,who='hr-manager')=>transaction(db,()=>decideAccrualPolicy(db,users[who],id,'accept',{note:'راجعت القاعدة ومصدرها وتاريخ تأكيده قبل الاعتماد'}));
  const run=(input,who='hr-manager')=>transaction(db,()=>runAccrualCycle(db,users[who],{leave_type:'synthetic_annual',note:'تشغيل اختبار مؤرخ مصطنع',...input}));
  const ready=(overrides={})=>{accept(policy(overrides));return overrides.leave_type??'synthetic_annual';};
  return {db,users,policy,accept,run,ready};
}

test('no accrual amount exists until the HR manager accepts a dated rule with its source, and the preparer never accepts it',t=>{
  const {db,users,policy,accept,run}=fixture(t);
  assert.deepEqual(accrualBoard(db,users.hr).policies,[],'the platform starts with no accrual rule at all');
  assert.ok(accrualBoard(db,users.hr).alerts.some(a=>a.kind==='no_policy'));
  assert.throws(()=>run({kind:'accrual',period_key:'2026-01'}),code('policy_required'));
  for(const who of ['employee','manager','admin','external'])
    assert.throws(()=>transaction(db,()=>prepareAccrualPolicy(db,users[who],RULE)),code('not_permitted'),who);
  const id=policy();
  assert.throws(()=>run({kind:'accrual',period_key:'2026-01'}),code('policy_required'),'a draft rule credits nothing');
  assert.throws(()=>transaction(db,()=>decideAccrualPolicy(db,users.hr,id,'accept',{note:'المُعدة لا تعتمد قاعدتها'})),code('not_permitted'));
  assert.throws(()=>transaction(db,()=>decideAccrualPolicy(db,users.admin,id,'accept',{note:'الأدمن الأول لا يعتمد قواعد الموارد البشرية'})),code('not_permitted'));
  accept(id);
  const accepted=accrualBoard(db,users['hr-manager']).policies[0];
  assert.equal(accepted.status,'accepted');
  assert.equal(accepted.accrual_days,'2.5','the amount is exactly what the HR manager entered');
  assert.equal(accepted.basis_confirmed_on,'2026-01-05');
  assert.throws(()=>db.prepare('UPDATE leave_accrual_policies SET accrual_milli=9999,version=version+1 WHERE id=?').run(id),/replaced by a new dated policy/);
  assert.throws(()=>db.prepare('DELETE FROM leave_accrual_policies WHERE id=?').run(id),/retained/);
  assert.equal(verifyAudit(db),true);
});

test('whoever prepares a rule cannot accept it even when holding the acceptance capability',t=>{
  const {db,users,policy}=fixture(t);
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.prepare',note:'اختبار منع الاعتماد الذاتي'}));
  const id=policy({},'hr-manager');
  assert.throws(()=>transaction(db,()=>decideAccrualPolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد ذاتي غير مسموح'})),code('separation_of_duties'));
});

test('an accrual run credits one dated entry per employee per period and re-running the same period changes nothing',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  const first=run({kind:'accrual',period_key:'2026-01'});
  assert.equal(first.employees,1);
  assert.equal(first.days,'2.5');
  assert.ok(first.skipped.some(s=>s.employee_id==='outsider'),'an employee hired inside the period is skipped, not pro-rated by an invented ratio');
  assert.ok(first.skipped.some(s=>s.employee_id==='manager'&&/عقد/.test(s.reason)),'an employee without a recorded contract has no hire date to accrue from');
  const again=run({kind:'accrual',period_key:'2026-01'});
  assert.equal(again.repeated,true);assert.equal(again.id,first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_accrual_entries').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accrual_runs').get().n,1);
  assert.throws(()=>run({kind:'accrual',period_key:'2099-01'}),code('period_open'),'an unfinished period accrues nothing');
  assert.throws(()=>run({kind:'accrual',period_key:'2025'}),code('period_key'),'the period unit follows the accepted rule, not the caller');
  for(const who of ['hr','employee','manager','admin'])
    assert.throws(()=>run({kind:'accrual',period_key:'2026-02'},who),code('not_permitted'),who);
  const balance=accrualBalance(db,'36t','employee','synthetic_annual',2026);
  assert.equal(balance.balance_days,'2.5');
  assert.equal(balance.movements.length,1);
  assert.equal(balance.movements[0].kind,'accrual');
  assert.match(balance.movements[0].source,/قرار شركة مصطنع/,'every movement carries the source of the rule that produced it');
  assert.equal(verifyAudit(db),true);
});

test('the balance is derived line by line: leave taken in the leave module reduces it without a second ledger',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  for(const year of [2026])db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)")
    .run(`creative-${year}`,'36t','creative','hr','تقويم مصطنع للاختبار',`${year}-01-01`,`${year}-12-31`,'[0,1,2,3,4]','[]',now());
  for(const key of ['2026-01','2026-02','2026-03'])run({kind:'accrual',period_key:key});
  assert.equal(accrualBalance(db,'36t','employee','synthetic_annual',2026).balance_days,'7.5');
  transaction(db,()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:12,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:'creative-2026'}));
  let request=transaction(db,()=>createLeaveRequest(db,users.employee,{leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-09-13',end_date:'2026-09-14',reason:'طلب اختبار محلي مصطنع'}));
  request=transaction(db,()=>leaveAction(db,users.manager,request.id,'approve',{version:request.version,note:'اعتماد اختبار'}));
  request=transaction(db,()=>leaveAction(db,users.hr,request.id,'approve',{version:request.version,note:'اعتماد اختبار'}));
  assert.equal(request.status,'approved');
  const balance=accrualBalance(db,'36t','employee','synthetic_annual',2026);
  assert.equal(balance.used_days,'2','usage is read from the leave module ledger, never copied into a second one');
  assert.equal(balance.balance_days,'5.5');
  assert.equal(balance.movements.filter(m=>m.kind==='usage').length,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_accrual_entries WHERE kind='usage'").get().n,0);
  assert.equal(verifyAudit(db),true);
});

test('carryover and expiry never happen quietly: each is a dated run the HR manager accepts, capped by the accepted rule',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  ready({leave_type:'synthetic_carry',accrual_unit:'year',accrual_days:'12',carryover_allowed:true,carryover_cap_days:'5'});
  const carry=input=>run({leave_type:'synthetic_carry',...input});
  carry({kind:'accrual',period_key:'2025'});
  assert.equal(accrualBalance(db,'36t','employee','synthetic_carry',2025).balance_days,'12');
  assert.throws(()=>carry({kind:'expiry',period_key:'2025'}),code('carryover_first'));
  const moved=carry({kind:'carryover',period_key:'2026'});
  assert.equal(moved.days,'5','the cap comes from the accepted rule, not from the code');
  assert.equal(accrualBalance(db,'36t','employee','synthetic_carry',2025).balance_days,'7');
  assert.equal(accrualBalance(db,'36t','employee','synthetic_carry',2026).balance_days,'5');
  const expired=carry({kind:'expiry',period_key:'2025'});
  assert.equal(expired.days,'-7');
  assert.equal(accrualBalance(db,'36t','employee','synthetic_carry',2025).balance_days,'0');
  assert.equal(carry({kind:'expiry',period_key:'2025'}).repeated,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_accrual_entries WHERE kind='expiry'").get().n,1);
  const lines=accrualBalance(db,'36t','employee','synthetic_carry',2025).movements.map(m=>m.kind);
  assert.deepEqual(lines,['accrual','carryover_out','expiry'],'the year reads as a story: credited, carried, expired');
  assert.throws(()=>run({kind:'carryover',period_key:'2026'}),code('carryover_not_allowed'),'a rule that forbids carryover blocks the run');
  assert.equal(verifyAudit(db),true);
});

test('a manual adjustment needs a written reason and an approver who is not its owner, and the ledger is append only',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  run({kind:'accrual',period_key:'2026-01'});
  const adjust=(overrides={},who='hr-manager')=>transaction(db,()=>recordAccrualAdjustment(db,users[who],{employee_id:'employee',leave_type:'synthetic_annual',effective_date:'2026-02-01',days:'1.5',reason:'تصحيح رصيد بقرار مكتوب في ملف الاختبار',...overrides}));
  for(const who of ['hr','employee','manager','admin'])assert.throws(()=>adjust({},who),code('not_permitted'),who);
  assert.throws(()=>adjust({employee_id:'hr-manager'}),code('separation_of_duties'));
  assert.throws(()=>adjust({reason:'قصير'}),code('invalid_text'));
  assert.throws(()=>adjust({leave_type:'synthetic_unknown'}),code('policy_required'));
  assert.equal(adjust().balance_days,'4');
  assert.throws(()=>adjust({days:'-90',effective_date:'2026-03-01'}),/cannot go negative/);
  const entry=db.prepare("SELECT id FROM leave_accrual_entries WHERE kind='adjustment'").get();
  assert.throws(()=>db.prepare('UPDATE leave_accrual_entries SET days_milli=1 WHERE id=?').run(entry.id),/append only/);
  assert.throws(()=>db.prepare('DELETE FROM leave_accrual_entries WHERE id=?').run(entry.id),/append only/);
  assert.equal(verifyAudit(db),true);
});

test('a draft is edited only by its preparer under an optimistic version, and never after acceptance',t=>{
  const {db,users,policy,accept}=fixture(t);
  const id=policy();
  const edit=(input,who='hr')=>transaction(db,()=>updateAccrualPolicyDraft(db,users[who],id,{...RULE,version:1,...input}));
  assert.throws(()=>edit({version:7}),code('stale_version'));
  assert.equal(edit({accrual_days:'3'}).version,2);
  assert.throws(()=>edit({version:1,accrual_days:'4'}),code('stale_version'),'a second editor on a stale copy is refused');
  accept(id);
  assert.throws(()=>edit({version:3,accrual_days:'4'}),code('decided_policy'));
  assert.equal(accrualBoard(db,users['hr-manager']).policies[0].accrual_days,'3');
});

test('each tenant sees only its own accrual: an isolated tenant account reads nothing of the other',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  run({kind:'accrual',period_key:'2026-01'});
  const outside=accrualBoard(db,users.external);
  assert.deepEqual(outside.policies,[]);assert.deepEqual(outside.runs,[]);assert.deepEqual(outside.balances,[]);
  assert.equal(JSON.stringify(outside).includes('synthetic_annual'),false);
  assert.throws(()=>transaction(db,()=>runAccrualCycle(db,users.external,{kind:'accrual',leave_type:'synthetic_annual',period_key:'2026-02',note:'محاولة من كيان آخر'})),code('not_permitted'));
  const own=accrualBoard(db,users.employee);
  assert.equal(own.balances.length,1);assert.deepEqual(own.policies,[],'an employee reads their own balance, not the rule register');
});

test('cash payout stays in payroll: this engine only reports the days to enter in the end-of-service settlement',t=>{
  const {db,users,ready,run}=fixture(t);
  ready({leave_type:'synthetic_cash',accrual_unit:'year',accrual_days:'10',cash_on_end_of_service:true});
  run({kind:'accrual',leave_type:'synthetic_cash',period_key:'2025'});
  const view=accrualSettlementView(db,users['hr-manager'],'employee');
  assert.equal(view.single_type.leave_type,'synthetic_cash');
  assert.equal(view.single_type.days,'10');
  assert.match(view.note,/تسوية نهاية الخدمة/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_adjustments').get().n,0,'no parallel payout path is created here');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_settlements').get().n,0);
  assert.throws(()=>accrualSettlementView(db,users.employee,'employee'),code('not_permitted'));
});

test('the accrual screen renders for every role and every offered button opens a usable form',t=>{
  const {db,users,ready,run}=fixture(t);ready();
  run({kind:'accrual',period_key:'2026-01'});
  for(const who of ['hr-manager','hr','employee','manager']){
    const data=accrualBoard(db,users[who]),buttons=[];
    const html=leaveAccrualUI.render(data,{e,button:(action,id,label)=>{buttons.push([action,id]);return `<button>${e(label)}</button>`;}});
    assert.equal(/\bundefined\b|\bNaN\b|\[object /.test(html.replace(/<[^>]+>/g,' ')),false,who);
    assert.equal(/ style=|<script/.test(html),false,'no inline styles and no scripts under the strict CSP');
    for(const [action,id] of buttons){
      const spec=leaveAccrualUI.form(action,id,data);
      assert.ok(spec.title&&spec.endpoint&&Array.isArray(spec.fields)&&typeof spec.toPayload==='function',`${who}/${action}`);
    }
  }
});
